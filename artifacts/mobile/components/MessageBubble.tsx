import React, { useState } from "react";
import {
  Image,
  Linking,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { Feather } from "@expo/vector-icons";
import type {
  MessageLinkPreview,
  MessageReplyPreview,
  MessageStickerBadge,
} from "@workspace/api-client-react";
import { Avatar } from "./Avatar";
import { StickerImage } from "./StickerImage";
import { useColors } from "@/hooks/useColors";
import { resolveMediaUri, useMediaUri } from "@/hooks/useMediaUri";
import { parseFileContent, formatFileSize } from "@/lib/fileMessage";
import {
  chatDiagnosticVariantEnabled,
  noteChatRender,
} from "@/lib/chatPerformanceDiagnostics";
import { linkPreviewThumbnailUri } from "@/lib/linkPreviewThumbnailPolicy";

const IMAGE_WIDTH = 220;
const IMAGE_MAX_HEIGHT = 300;
const STICKER_SIZE = 128;
const WEB_LONG_TEXT_STYLE = Platform.select({
  web: {
    overflowWrap: "anywhere",
    wordBreak: "break-word",
  } as any,
  default: undefined,
});

interface MessageBubbleProps {
  messageId: string;
  content: string;
  isMe: boolean;
  type?: string;
  imageUri?: string;
  senderName?: string;
  senderAvatar?: string | null;
  senderAvatarNode?: React.ReactNode;
  senderCharacterType?: "fan" | "star" | "official_ai";
  time: string;
  showSender?: boolean;
  compact?: boolean;
  readLabel?: string;
  isDM?: boolean;
  isAnotherMe?: boolean;
  onJoinCall?: (callId: string, media: "audio" | "video") => void;
  onLongPress?: (messageId: string) => void;
  selected?: boolean;
  deletedAt?: string | null;
  replyTo?: MessageReplyPreview | null;
  stickerBadges?: MessageStickerBadge[];
  linkPreview?: MessageLinkPreview | null;
  onPressReply?: (messageId: string) => void;
  retryClientMessageId?: string | null;
  onRetryMessage?: (clientMessageId: string) => void;
}

// A "call" message carries { callId, status, media, durationSec? } JSON so the
// in-chat card can show a join button while ringing/active and flip to a
// distinct result card (종료/부재중/거절/취소) once finished.
function parseCallContent(raw: string): {
  callId: string;
  status: string;
  media: "audio" | "video";
  durationSec?: number;
} | null {
  try {
    const obj = JSON.parse(raw);
    if (
      obj &&
      typeof obj.callId === "string" &&
      typeof obj.status === "string"
    ) {
      return {
        callId: obj.callId,
        status: obj.status,
        media: obj.media === "video" ? "video" : "audio",
        durationSec:
          typeof obj.durationSec === "number" ? obj.durationSec : undefined,
      };
    }
  } catch {}
  return null;
}

// "3분 5초" / "12초" — Korean, minutes only when present.
function formatCallDuration(sec: number): string {
  const s = Math.max(0, Math.round(sec));
  const m = Math.floor(s / 60);
  const r = s % 60;
  if (m > 0) return r > 0 ? `${m}분 ${r}초` : `${m}분`;
  return `${r}초`;
}

function MessageBubbleComponent({
  messageId,
  content,
  isMe,
  type = "text",
  imageUri,
  senderName,
  senderAvatar,
  senderAvatarNode,
  senderCharacterType,
  time,
  showSender = false,
  compact = false,
  readLabel,
  isDM = false,
  isAnotherMe = false,
  onJoinCall,
  onLongPress,
  selected = false,
  deletedAt,
  replyTo,
  stickerBadges = [],
  linkPreview,
  onPressReply,
  retryClientMessageId,
  onRetryMessage,
}: MessageBubbleProps) {
  noteChatRender("bubbleRenders");
  const colors = useColors();
  const authorizedImageUri = useMediaUri(imageUri);
  const safeLinkPreviewThumbnail = linkPreviewThumbnailUri(
    linkPreview?.imageUrl,
  );
  const isDeleted = !!deletedAt;
  const isImage = !isDeleted && type === "image" && !!imageUri;
  const isSticker = !isDeleted && type === "sticker";
  const simpleAvatars = chatDiagnosticVariantEnabled("simpleAvatars");
  const staticStickers = chatDiagnosticVariantEnabled("staticStickers");
  if (!isMe) noteChatRender("avatarRenders");
  if (isSticker) noteChatRender("stickerRenders");
  if (isImage) noteChatRender("imageRenders");
  const fileMeta =
    !isDeleted && type === "file" ? parseFileContent(content) : null;
  const [aspect, setAspect] = useState(1);
  const handleLongPress = React.useCallback(() => {
    onLongPress?.(messageId);
  }, [messageId, onLongPress]);
  const longPressHandler = onLongPress ? handleLongPress : undefined;
  const handleRetry = React.useCallback(() => {
    if (retryClientMessageId) onRetryMessage?.(retryClientMessageId);
  }, [onRetryMessage, retryClientMessageId]);

  // System lines (dungeon state changes) read as small centered notices, not
  // chat bubbles.
  if (type === "system") {
    return (
      <View style={styles.systemRow}>
        <Text style={[styles.systemText, { color: colors.mutedForeground }]}>
          {content}
        </Text>
      </View>
    );
  }

  // Voice-call card. While ringing/active it is a centered notice either party
  // can tap to join; once finished it flips to a distinct result card per final
  // status (종료 + 통화 시간 / 부재중 / 거절 / 취소), worded for caller vs callee.
  if (type === "call" && !isDeleted) {
    const call = parseCallContent(content);
    const status = call?.status ?? "ended";
    const live = !!call && (status === "ringing" || status === "active");

    const media = call?.media ?? "audio";
    const mediaLabel = media === "video" ? "영상통화" : "보이스톡";
    let icon: React.ComponentProps<typeof Feather>["name"] = "phone-off";
    let title: string;
    let subtitle = time;

    if (live) {
      icon = media === "video" ? "video" : "phone-call";
      title = isMe ? `${mediaLabel} 발신` : `${mediaLabel} 수신`;
    } else if (status === "ended") {
      icon = media === "video" ? "video" : "phone";
      title = mediaLabel;
      if (typeof call?.durationSec === "number") {
        subtitle = `통화 시간 ${formatCallDuration(call.durationSec)} · ${time}`;
      }
    } else if (status === "missed") {
      icon = "phone-missed";
      title = isMe ? "응답 없음" : "부재중 전화";
    } else if (status === "declined") {
      icon = "phone-off";
      title = isMe ? "상대가 통화를 거절함" : "통화 거절";
    } else if (status === "cancelled") {
      icon = "phone-missed";
      title = isMe ? "통화 취소" : "부재중 전화";
    } else {
      // failed / unknown terminal state
      icon = "phone-off";
      title = `${mediaLabel} 종료`;
    }

    const accent = live ? colors.primary : colors.mutedForeground;
    const iconBg = live ? colors.accent : colors.muted;

    return (
      <View style={styles.callRow}>
        <View
          style={[
            styles.callCard,
            { backgroundColor: colors.card, borderColor: colors.border },
          ]}
        >
          <View style={[styles.callIcon, { backgroundColor: iconBg }]}>
            <Feather name={icon} size={18} color={accent} />
          </View>
          <View style={styles.callInfo}>
            <Text style={[styles.callTitle, { color: colors.foreground }]}>
              {title}
            </Text>
            <Text style={[styles.callTime, { color: colors.mutedForeground }]}>
              {subtitle}
            </Text>
          </View>
          {live && call && onJoinCall ? (
            <Pressable
              onPress={() => onJoinCall(call.callId, media)}
              style={({ pressed }) => [
                styles.callJoinBtn,
                {
                  backgroundColor: colors.primary,
                  opacity: pressed ? 0.85 : 1,
                },
              ]}
            >
              <Feather
                name={media === "video" ? "video" : "phone"}
                size={14}
                color={colors.primaryForeground}
              />
              <Text
                style={[
                  styles.callJoinText,
                  { color: colors.primaryForeground },
                ]}
              >
                통화 참여
              </Text>
            </Pressable>
          ) : null}
        </View>
      </View>
    );
  }

  const openImage = () => {
    if (!authorizedImageUri) return;
    if (Platform.OS === "web") {
      window.open(authorizedImageUri, "_blank");
    } else {
      Linking.openURL(authorizedImageUri).catch(() => {});
    }
  };

  const openFile = async () => {
    if (!fileMeta) return;
    const uri = await resolveMediaUri(fileMeta.path);
    if (Platform.OS === "web") {
      const a = document.createElement("a");
      a.href = uri;
      a.download = fileMeta.name;
      a.rel = "noopener";
      document.body.appendChild(a);
      a.click();
      a.remove();
    } else {
      try {
        const WebBrowser = await import("expo-web-browser");
        await WebBrowser.openBrowserAsync(uri);
      } catch {
        Linking.openURL(uri).catch(() => {});
      }
    }
  };

  const openLinkPreview = () => {
    if (!linkPreview?.url) return;
    if (Platform.OS === "web") {
      window.open(linkPreview.url, "_blank", "noopener,noreferrer");
    } else {
      Linking.openURL(linkPreview.url).catch(() => {});
    }
  };

  // The AI Dungeon Master narrates in a distinct full-width "parchment" card so
  // its storytelling reads differently from ordinary chat bubbles.
  if (isDM) {
    return (
      <View style={styles.dmRow}>
        <View
          style={[
            styles.dmCard,
            { backgroundColor: colors.accent, borderLeftColor: colors.primary },
          ]}
        >
          <View style={styles.dmHeader}>
            <Text style={styles.dmEmoji}>🎲</Text>
            <Text style={[styles.dmLabel, { color: colors.accentForeground }]}>
              성장RPG 마스터
            </Text>
            <Text style={[styles.dmTime, { color: colors.mutedForeground }]}>
              {time}
            </Text>
          </View>
          <Text style={[styles.dmText, { color: colors.foreground }]}>
            {content}
          </Text>
        </View>
      </View>
    );
  }

  const meta = (
    <View
      style={[styles.metaSide, isMe ? styles.metaSideMe : styles.metaSideOther]}
    >
      {isMe && readLabel ? (
        retryClientMessageId && onRetryMessage ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="메시지 다시 보내기"
            hitSlop={8}
            onPress={handleRetry}
          >
            <Text style={[styles.read, { color: colors.destructive }]}>
              다시 시도
            </Text>
          </Pressable>
        ) : ["읽음", "안읽음", "전송됨", "전송 중"].includes(readLabel) ? (
          <View
            accessible
            accessibilityLabel={readLabel}
            style={{ flexDirection: "row", alignItems: "center", height: 14 }}
          >
            <Feather
              name={readLabel === "전송 중" ? "clock" : "check"}
              size={13}
              color={
                readLabel === "읽음" ? colors.primary : colors.mutedForeground
              }
            />
            {readLabel === "읽음" && (
              <Feather
                name="check"
                size={13}
                color={colors.primary}
                style={{ marginLeft: -8 }}
              />
            )}
          </View>
        ) : (
          <Text style={[styles.read, { color: colors.primary }]}>
            {readLabel}
          </Text>
        )
      ) : null}
      <Text style={[styles.time, { color: colors.mutedForeground }]}>
        {time}
      </Text>
    </View>
  );

  const replyBlock = replyTo ? (
    <Pressable
      onPress={() => onPressReply?.(replyTo.id)}
      style={({ pressed }) => [
        styles.replyBlock,
        {
          borderLeftColor: isMe ? "rgba(255,255,255,0.75)" : colors.primary,
          opacity: pressed ? 0.7 : 1,
        },
      ]}
    >
      <Text
        style={[
          styles.replyName,
          { color: isMe ? colors.myBubbleText : colors.primary },
        ]}
        numberOfLines={1}
      >
        {replyTo.senderName ?? "답장"}
      </Text>
      <Text
        style={[
          styles.replyContent,
          {
            color: isMe ? colors.myBubbleText : colors.mutedForeground,
            opacity: isMe ? 0.82 : 1,
          },
        ]}
        numberOfLines={1}
      >
        {replyTo.content || "삭제된 메시지"}
      </Text>
    </Pressable>
  ) : null;

  const linkPreviewBlock = linkPreview ? (
    <Pressable
      onPress={openLinkPreview}
      style={({ pressed }) => [
        styles.linkPreview,
        {
          borderColor: isMe ? "rgba(255,255,255,0.24)" : colors.border,
          backgroundColor: isMe ? "rgba(255,255,255,0.10)" : colors.card,
          opacity: pressed ? 0.8 : 1,
        },
      ]}
    >
      {safeLinkPreviewThumbnail ? (
        <Image
          source={{ uri: safeLinkPreviewThumbnail }}
          style={styles.linkThumb}
          resizeMode="cover"
        />
      ) : null}
      <View style={styles.linkInfo}>
        {linkPreview.domain ? (
          <Text
            style={[
              styles.linkDomain,
              { color: isMe ? colors.myBubbleText : colors.primary },
            ]}
            numberOfLines={1}
          >
            {linkPreview.domain}
          </Text>
        ) : null}
        {linkPreview.title ? (
          <Text
            style={[
              styles.linkTitle,
              { color: isMe ? colors.myBubbleText : colors.foreground },
            ]}
            numberOfLines={2}
          >
            {linkPreview.title}
          </Text>
        ) : null}
        {linkPreview.description ? (
          <Text
            style={[
              styles.linkDescription,
              {
                color: isMe ? colors.myBubbleText : colors.mutedForeground,
                opacity: isMe ? 0.78 : 1,
              },
            ]}
            numberOfLines={2}
          >
            {linkPreview.description}
          </Text>
        ) : null}
      </View>
    </Pressable>
  ) : null;

  const body = isSticker ? (
    <View
      style={[styles.sticker, isMe ? styles.stickerMe : styles.stickerOther]}
    >
      {staticStickers ? (
        <Text style={{ fontSize: STICKER_SIZE * 0.6 }}>🙂</Text>
      ) : (
        <StickerImage code={content} size={STICKER_SIZE} />
      )}
    </View>
  ) : isImage ? (
    <Pressable
      onPress={openImage}
      onLongPress={longPressHandler}
      style={({ pressed }) => ({ opacity: pressed ? 0.85 : 1 })}
    >
      <Image
        source={{ uri: authorizedImageUri }}
        style={[
          styles.image,
          {
            width: IMAGE_WIDTH,
            height: Math.min(IMAGE_WIDTH / aspect, IMAGE_MAX_HEIGHT),
            backgroundColor: colors.muted,
          },
        ]}
        resizeMode="cover"
        onLoad={(e) => {
          const src: any = e.nativeEvent?.source;
          if (src?.width && src?.height) setAspect(src.width / src.height);
        }}
      />
    </Pressable>
  ) : fileMeta ? (
    <Pressable
      onPress={openFile}
      onLongPress={longPressHandler}
      style={({ pressed }) => [
        styles.fileCard,
        {
          backgroundColor: isMe ? colors.myBubble : colors.otherBubble,
          opacity: pressed ? 0.85 : 1,
        },
      ]}
    >
      <View
        style={[
          styles.fileIcon,
          { backgroundColor: isMe ? "rgba(255,255,255,0.18)" : colors.muted },
        ]}
      >
        <Feather
          name="file"
          size={22}
          color={isMe ? colors.myBubbleText : colors.foreground}
        />
      </View>
      <View style={styles.fileInfo}>
        <Text
          numberOfLines={1}
          style={[
            styles.fileName,
            { color: isMe ? colors.myBubbleText : colors.otherBubbleText },
          ]}
        >
          {fileMeta.name}
        </Text>
        {formatFileSize(fileMeta.size) ? (
          <Text
            style={[
              styles.fileSize,
              {
                color: isMe ? colors.myBubbleText : colors.mutedForeground,
                opacity: isMe ? 0.8 : 1,
              },
            ]}
          >
            {formatFileSize(fileMeta.size)}
          </Text>
        ) : null}
      </View>
      <Feather
        name="download"
        size={18}
        color={isMe ? colors.myBubbleText : colors.mutedForeground}
      />
    </Pressable>
  ) : (
    <View
      style={[
        styles.bubble,
        isMe
          ? [styles.bubbleMe, { backgroundColor: colors.myBubble }]
          : [styles.bubbleOther, { backgroundColor: colors.card }],
        compact && {
          borderTopLeftRadius: isMe ? 18 : 6,
          borderTopRightRadius: isMe ? 6 : 18,
        },
      ]}
    >
      {replyBlock}
      {isAnotherMe ? (
        <View
          style={[styles.anotherMeLabel, { backgroundColor: colors.accent }]}
        >
          <Feather name="cpu" size={11} color={colors.primary} />
          <Text style={[styles.anotherMeLabelText, { color: colors.primary }]}>
            AI 분신 응답
          </Text>
        </View>
      ) : null}
      <Text
        style={[
          styles.text,
          WEB_LONG_TEXT_STYLE,
          isDeleted && styles.deletedText,
          { color: isMe ? colors.myBubbleText : colors.otherBubbleText },
        ]}
      >
        {isDeleted ? "삭제된 메시지입니다" : content}
      </Text>
      {linkPreviewBlock}
    </View>
  );

  const stickerBadgeOverlay =
    !isDeleted && stickerBadges.length > 0 ? (
      <View
        style={[
          styles.stickerBadges,
          isMe ? styles.stickerBadgesMe : styles.stickerBadgesOther,
        ]}
      >
        {stickerBadges.slice(0, 3).map((badge) => (
          <View
            key={badge.id}
            style={[
              styles.stickerBadge,
              { backgroundColor: colors.card, borderColor: colors.border },
            ]}
          >
            {staticStickers ? (
              <Text style={{ fontSize: 15 }}>🙂</Text>
            ) : (
              <StickerImage code={badge.code} size={22} />
            )}
          </View>
        ))}
      </View>
    ) : null;

  // A disabled Pressable also disables nested retry/media controls on web.
  const Row = longPressHandler ? Pressable : View;
  return (
    <Row
      testID={"message-" + messageId}
      {...(longPressHandler
        ? { onLongPress: longPressHandler, delayLongPress: 320 }
        : {})}
      {...(Platform.OS === "web" && longPressHandler
        ? {
            onContextMenu: (event: any) => {
              event.preventDefault();
              longPressHandler();
            },
            onKeyDown: (event: any) => {
              if (
                event.key === "ContextMenu" ||
                (event.shiftKey && event.key === "F10")
              ) {
                event.preventDefault();
                longPressHandler();
              }
            },
            tabIndex: 0,
          }
        : ({} as any))}
      style={[
        styles.row,
        { marginTop: compact ? 1 : 9, marginBottom: 2 },
        isMe ? styles.rowMe : styles.rowOther,
        selected && { backgroundColor: colors.accent },
      ]}
    >
      {!isMe &&
        (compact ? (
          <View style={{ width: 32 }} />
        ) : (
          (senderAvatarNode ??
          (simpleAvatars ? (
            <View
              style={{
                width: 32,
                height: 32,
                borderRadius: 16,
                backgroundColor: colors.muted,
              }}
            />
          ) : (
            <Avatar
              uri={senderAvatar}
              name={senderName ?? "?"}
              size={32}
              crop="face"
              characterType={senderCharacterType}
            />
          )))
        ))}
      <View style={[styles.bubbleWrap, isMe && styles.bubbleWrapMe]}>
        {!isMe && showSender && senderName ? (
          <Text style={[styles.senderName, { color: colors.mutedForeground }]}>
            {senderName}
          </Text>
        ) : null}
        <View style={[styles.bubbleLine, isMe && styles.bubbleLineMe]}>
          {isMe ? meta : null}
          <View style={styles.bodyWrap}>
            {body}
            {stickerBadgeOverlay}
          </View>
          {!isMe ? meta : null}
        </View>
      </View>
    </Row>
  );
}

// Memoized so a parent re-render (e.g. the chat screen's 3s poll, or any state
// change) doesn't re-render every visible bubble — only ones whose props change.
// Props are primitives derived from the message + a stable onJoinCall callback,
// so shallow comparison is correct. Theme changes still flow via useColors().
export const MessageBubble = React.memo(MessageBubbleComponent);

const styles = StyleSheet.create({
  systemRow: {
    alignItems: "center",
    paddingHorizontal: 24,
    marginVertical: 6,
  },
  systemText: {
    fontSize: 12,
    fontFamily: "Inter_500Medium",
    textAlign: "center",
    lineHeight: 17,
  },
  callRow: {
    alignItems: "center",
    paddingHorizontal: 24,
    marginVertical: 6,
  },
  callCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    paddingVertical: 9,
    paddingHorizontal: 12,
    maxWidth: 300,
  },
  callIcon: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: "center",
    justifyContent: "center",
  },
  callInfo: {
    gap: 2,
  },
  callTitle: {
    fontSize: 14,
    fontFamily: "Inter_600SemiBold",
  },
  callTime: {
    fontSize: 11,
    fontFamily: "Inter_400Regular",
  },
  callJoinBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    borderRadius: 18,
    paddingVertical: 7,
    paddingHorizontal: 13,
    marginLeft: 4,
  },
  callJoinText: {
    fontSize: 13,
    fontFamily: "Inter_600SemiBold",
  },
  dmRow: {
    paddingHorizontal: 12,
    marginVertical: 5,
  },
  dmCard: {
    borderRadius: 14,
    borderLeftWidth: 3,
    paddingHorizontal: 14,
    paddingVertical: 11,
    gap: 6,
  },
  dmHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  dmEmoji: {
    fontSize: 14,
  },
  dmLabel: {
    fontSize: 13,
    fontFamily: "Inter_700Bold",
    flex: 1,
  },
  dmTime: {
    fontSize: 11,
    fontFamily: "Inter_400Regular",
  },
  dmText: {
    fontSize: 15,
    fontFamily: "Inter_400Regular",
    lineHeight: 23,
  },
  row: {
    flexDirection: "row",
    alignItems: "flex-end",
    marginVertical: 2,
    paddingHorizontal: 12,
    gap: 8,
  },
  rowMe: {
    justifyContent: "flex-end",
  },
  rowOther: {
    justifyContent: "flex-start",
  },
  bubbleWrap: {
    maxWidth: "86%",
    minWidth: 0,
    gap: 3,
  },
  bubbleWrapMe: {
    alignItems: "flex-end",
  },
  bubbleLine: {
    flexDirection: "row",
    alignItems: "flex-end",
    maxWidth: "100%",
    minWidth: 0,
    gap: 6,
  },
  bubbleLineMe: {
    justifyContent: "flex-end",
  },
  bodyWrap: {
    flexShrink: 1,
    maxWidth: "100%",
    minWidth: 0,
    position: "relative",
  },
  bubble: {
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: 18,
    maxWidth: "100%",
    minWidth: 0,
  },
  bubbleMe: {
    borderBottomRightRadius: 4,
  },
  bubbleOther: {
    borderBottomLeftRadius: 4,
  },
  image: {
    borderRadius: 14,
    maxWidth: "100%",
  },
  fileCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 16,
    maxWidth: 250,
  },
  fileIcon: {
    width: 40,
    height: 40,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  fileInfo: {
    flexShrink: 1,
  },
  fileName: {
    fontSize: 15,
    fontWeight: "600",
  },
  fileSize: {
    fontSize: 12,
    marginTop: 2,
  },
  sticker: {
    paddingVertical: 2,
  },
  stickerMe: {
    alignItems: "flex-end",
  },
  stickerOther: {
    alignItems: "flex-start",
  },
  text: {
    fontSize: 15,
    fontFamily: "Inter_400Regular",
    lineHeight: 23,
    maxWidth: "100%",
    minWidth: 0,
  },
  deletedText: {
    fontStyle: "italic",
    opacity: 0.72,
  },
  replyBlock: {
    borderLeftWidth: 3,
    paddingLeft: 8,
    marginBottom: 6,
    maxWidth: 240,
  },
  anotherMeLabel: {
    alignItems: "center",
    alignSelf: "flex-start",
    borderRadius: 999,
    flexDirection: "row",
    gap: 4,
    marginBottom: 6,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  anotherMeLabelText: {
    fontFamily: "Inter_700Bold",
    fontSize: 11,
  },
  replyName: {
    fontSize: 12,
    fontFamily: "Inter_600SemiBold",
  },
  replyContent: {
    marginTop: 1,
    fontSize: 12,
    fontFamily: "Inter_400Regular",
  },
  linkPreview: {
    marginTop: 8,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 12,
    overflow: "hidden",
    flexDirection: "row",
    maxWidth: 270,
  },
  linkThumb: {
    width: 72,
    minHeight: 72,
  },
  linkInfo: {
    flex: 1,
    minWidth: 0,
    paddingHorizontal: 9,
    paddingVertical: 8,
    gap: 2,
  },
  linkDomain: {
    fontSize: 11,
    fontFamily: "Inter_600SemiBold",
    textTransform: "uppercase",
  },
  linkTitle: {
    fontSize: 13,
    lineHeight: 17,
    fontFamily: "Inter_600SemiBold",
  },
  linkDescription: {
    fontSize: 12,
    lineHeight: 16,
    fontFamily: "Inter_400Regular",
  },
  stickerBadges: {
    position: "absolute",
    bottom: -10,
    flexDirection: "row",
  },
  stickerBadgesMe: {
    right: -6,
  },
  stickerBadgesOther: {
    left: -6,
  },
  stickerBadge: {
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: StyleSheet.hairlineWidth,
    marginLeft: -5,
    shadowColor: "#000",
    shadowOpacity: 0.14,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 1 },
    elevation: 2,
  },
  senderName: {
    fontSize: 12,
    fontFamily: "Inter_500Medium",
    marginLeft: 4,
  },
  metaSide: {
    justifyContent: "flex-end",
    paddingBottom: 2,
    gap: 1,
  },
  metaSideMe: {
    alignItems: "flex-end",
  },
  metaSideOther: {
    alignItems: "flex-start",
  },
  time: {
    fontSize: 11,
    fontFamily: "Inter_400Regular",
  },
  read: {
    fontSize: 11,
    fontFamily: "Inter_500Medium",
  },
});
