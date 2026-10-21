import { useReducedMotion } from "react-native-reanimated";
import { SwipeToReply } from "./chat/SwipeToReply";
import { groupReactions } from "@/lib/chatInteractionPolicy";
import { useQueryClient } from "@tanstack/react-query";
import { crossAlert } from "@/lib/crossAlert";
import { Image as CachedImage } from "expo-image";
import { ChatCachedImage } from "./ChatCachedImage";
import { ChatVideoViewer } from "./ChatVideoViewer";
import { ChatAlbum } from "./ChatAlbum";
import type { ChatAlbumImage } from "@/lib/chatAlbumPolicy";
import { ChatImageViewer } from "./ChatImageViewer";
import React, { useState } from "react";
import {
  Image,
  Animated,
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
  imageThumbnail?: string;
  imageAlbum?: ChatAlbumImage[];
  imageCaption?: string;
  imageAspect?: number;
  videoDuration?: number;
  senderName?: string;
  senderAvatar?: string | null;
  senderAvatarNode?: React.ReactNode;
  senderCharacterType?: "fan" | "star" | "official_ai";
  onPressSender?: () => void;
  time: string;
  showSender?: boolean;
  compact?: boolean;
  readLabel?: string;
  isDM?: boolean;
  isAnotherMe?: boolean;
  onJoinCall?: (callId: string, media: "audio" | "video") => void;
  onLongPress?: (
    messageId: string,
    anchor?: { x: number; y: number; width: number; height: number },
    preview?: React.ReactNode,
  ) => void;
  onReply?: (messageId: string) => void;
  onTouchMessage?: () => void;
  selectionMode?: boolean;
  onSelect?: (messageId: string) => void;
  viewerId?: string;
  onReact?: (messageId: string, code: string) => void;
  selected?: boolean;
  deletedAt?: string | null;
  replyTo?: MessageReplyPreview | null;
  stickerBadges?: MessageStickerBadge[];
  linkPreview?: MessageLinkPreview | null;
  onPressReply?: (messageId: string) => void;
  retryClientMessageId?: string | null;
  onRetryMessage?: (clientMessageId: string) => void;
  onCancelMessage?: (clientMessageId: string) => void;
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
  imageThumbnail,
  imageAlbum,
  imageCaption,
  imageAspect,
  videoDuration,
  senderName,
  senderAvatar,
  senderAvatarNode,
  senderCharacterType,
  onPressSender,
  time,
  showSender = false,
  compact = false,
  readLabel,
  isDM = false,
  isAnotherMe = false,
  onJoinCall,
  onLongPress,
  onReply,
  onTouchMessage,
  selectionMode = false,
  onSelect,
  viewerId,
  onReact,
  selected = false,
  deletedAt,
  replyTo,
  stickerBadges = [],
  linkPreview,
  onPressReply,
  retryClientMessageId,
  onRetryMessage,
  onCancelMessage,
}: MessageBubbleProps) {
  noteChatRender("bubbleRenders");
  const colors = useColors();
  const mediaQueryClient = useQueryClient();
  const [imageRetry, setImageRetry] = React.useState(0);
  const [imageError, setImageError] = useState(false);
  const [videoUri, setVideoUri] = useState<string | null>(null);
  const [imageOpen, setImageOpen] = useState(false);
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
  const [aspect, setAspect] = useState(
    imageAspect && imageAspect > 0 ? imageAspect : 1,
  );
  const replyToMessage = React.useCallback(
    () => onReply?.(messageId),
    [onReply, messageId],
  );
  const bodyRef = React.useRef<View>(null);
  const pressScale = React.useRef(new Animated.Value(1)).current;
  const reducedMotion = useReducedMotion();
  React.useEffect(() => () => pressScale.stopAnimation(), [pressScale]);
  const pressFeedback = React.useCallback(
    (pressed: boolean) => {
      if (reducedMotion || selectionMode || !onLongPress) return;
      Animated.spring(pressScale, {
        toValue: pressed ? 0.965 : 1,
        stiffness: 420,
        damping: pressed ? 30 : 12,
        mass: 0.6,
        useNativeDriver: Platform.OS !== "web",
      }).start();
    },
    [pressScale, reducedMotion, selectionMode, onLongPress],
  );
  const focusPreview = React.useRef<React.ReactNode>(null);
  const handleLongPress = React.useCallback(() => {
    if (selectionMode) {
      onSelect?.(messageId);
      return;
    }
    bodyRef.current?.measureInWindow((x, y, width, height) => {
      if (width > 0 && height > 0)
        onLongPress?.(messageId, { x, y, width, height }, focusPreview.current);
    });
  }, [messageId, onLongPress, selectionMode, onSelect]);
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
          onTouchStart={onTouchMessage}
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
    if (imageError) {
      setImageRetry((value) => value + 1);
      setImageError(false);
      void mediaQueryClient
        .invalidateQueries({ queryKey: ["media-url", imageUri] })
        .catch(() => {});
      return;
    }
    if (imageUri) setImageOpen(true);
  };

  const openFile = async () => {
    if (!fileMeta) return;
    if (fileMeta.mime?.startsWith("video/")) {
      setVideoUri(fileMeta.path);
      return;
    }
    let uri: string;
    try {
      uri = await resolveMediaUri(fileMeta.path);
    } catch {
      crossAlert("파일 열기 실패", "연결을 확인한 뒤 다시 눌러 주세요.");
      return;
    }
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
          <View style={{ gap: 10 }}>
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
            {onCancelMessage ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="실패한 메시지 전송 취소"
                hitSlop={8}
                onPress={() => onCancelMessage(retryClientMessageId)}
              >
                <Text style={[styles.read, { color: colors.mutedForeground }]}>
                  전송 취소
                </Text>
              </Pressable>
            ) : null}
          </View>
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
  ) : isImage && imageAlbum ? (
    <ChatAlbum images={imageAlbum} />
  ) : isImage ? (
    <Pressable
      onPress={openImage}
      onLongPress={longPressHandler}
      style={({ pressed }) => ({ opacity: pressed ? 0.85 : 1 })}
    >
      <ChatCachedImage
        objectPath={imageUri}
        autoplay
        retryKey={imageRetry}
        thumbnail={imageThumbnail}
        contentFit="cover"
        style={[
          styles.image,
          {
            width: IMAGE_WIDTH,
            height: Math.min(IMAGE_WIDTH / aspect, IMAGE_MAX_HEIGHT),
            backgroundColor: colors.muted,
          },
        ]}
        onError={() => setImageError(true)}
        onLoad={(event) => {
          setImageError(false);
          if (event.source.width && event.source.height)
            setAspect(event.source.width / event.source.height);
        }}
      />
      {imageError ? (
        <Text style={{ padding: 8, color: colors.primary }}>
          사진 다시 불러오기 ↻
        </Text>
      ) : null}
    </Pressable>
  ) : fileMeta ? (
    <View>
      {fileMeta.mime?.startsWith("video/") &&
      imageThumbnail?.startsWith("data:image/jpeg;base64,") &&
      imageThumbnail.length < 10000 ? (
        <Pressable onPress={openFile} accessibilityLabel="영상 재생">
          <CachedImage
            source={imageThumbnail}
            contentFit="cover"
            style={{ width: IMAGE_WIDTH, height: 124, borderRadius: 12 }}
          />
        </Pressable>
      ) : null}
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
            {fileMeta.mime?.startsWith("video/") ? "▶ " : ""}
            {fileMeta.name}
            {videoDuration ? ` · ${Math.round(videoDuration)}초` : ""}
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
    </View>
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
        {groupReactions(stickerBadges, viewerId).map((reaction) => (
          <Pressable
            key={reaction.code}
            accessibilityRole="button"
            accessibilityLabel={`${reaction.count}명 반응${reaction.mine ? ", 내 반응 취소" : ""}`}
            accessibilityState={{ selected: reaction.mine }}
            disabled={!onReact || selectionMode}
            onPress={() => onReact?.(messageId, reaction.code)}
            style={[
              styles.stickerBadge,
              {
                backgroundColor: reaction.mine ? colors.accent : colors.card,
                borderColor: reaction.mine ? colors.primary : colors.border,
                flexDirection: "row",
                gap: 4,
              },
            ]}
          >
            {staticStickers ? (
              <Text>🙂</Text>
            ) : (
              <StickerImage code={reaction.code} size={22} />
            )}
            <Text style={{ color: colors.foreground }}>{reaction.count}</Text>
          </Pressable>
        ))}
      </View>
    ) : null;

  focusPreview.current = body;
  return (
    <View
      testID={"message-" + messageId}
      style={[
        styles.row,
        { marginTop: compact ? 1 : 9, marginBottom: 2 },
        isMe ? styles.rowMe : styles.rowOther,
        selected && { backgroundColor: colors.accent },
      ]}
    >
      {selectionMode && (
        <Pressable
          accessibilityLabel={selected ? "메시지 선택 해제" : "메시지 선택"}
          accessibilityRole="checkbox"
          accessibilityState={{ checked: selected }}
          onPress={() => onSelect?.(messageId)}
          style={{ padding: 8 }}
        >
          <Text style={{ color: colors.primary }}>{selected ? "☑" : "☐"}</Text>
        </Pressable>
      )}
      {!isMe &&
        (compact ? (
          <View style={{ width: 32 }} />
        ) : (
          (<Pressable disabled={!onPressSender} onPress={onPressSender} accessibilityRole={onPressSender ? "button" : undefined} accessibilityLabel={onPressSender ? `${senderName ?? ""} 프로필 보기` : undefined}>{senderAvatarNode ??
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
          ))}</Pressable>)
        ))}
      <View style={[styles.bubbleWrap, isMe && styles.bubbleWrapMe]}>
        {!isMe && showSender && senderName ? (
          <Text onPress={onPressSender} accessibilityRole={onPressSender ? "button" : undefined} style={[styles.senderName, { color: colors.mutedForeground }]}>
            {senderName}
          </Text>
        ) : null}
        <View style={[styles.bubbleLine, isMe && styles.bubbleLineMe]}>
          {isMe ? meta : null}
          <SwipeToReply
            onReply={!selectionMode && onReply ? replyToMessage : undefined}
          >
            <Pressable
              onTouchStart={onTouchMessage}
              onPressIn={() => pressFeedback(true)}
              onPressOut={() => pressFeedback(false)}
              ref={bodyRef}
              collapsable={false}
              style={styles.bodyWrap}
              onLongPress={longPressHandler}
              delayLongPress={320}
              accessibilityActions={[
                { name: "menu", label: "메시지 메뉴 열기" },
              ]}
              onAccessibilityAction={(event) => {
                if (event.nativeEvent.actionName === "menu") handleLongPress();
              }}
              onPress={selectionMode ? () => onSelect?.(messageId) : undefined}
              {...(Platform.OS === "web" && longPressHandler
                ? {
                    tabIndex: 0,
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
                  }
                : {})}
            >
              <Animated.View
                style={{ transform: [{ scale: pressScale }] }}
                pointerEvents={selectionMode ? "none" : "auto"}
              >
                {body}
              </Animated.View>
              {stickerBadgeOverlay}
            </Pressable>
          </SwipeToReply>
          {!isMe ? meta : null}
        </View>
      </View>
      {videoUri ? (
        <ChatVideoViewer uri={videoUri} onClose={() => setVideoUri(null)} />
      ) : null}
      {(isImage || fileMeta) && imageCaption ? (
        <Text style={{ padding: 8, color: colors.foreground }}>
          {imageCaption}
        </Text>
      ) : null}
      {imageOpen && imageUri && (
        <ChatImageViewer
          uri={imageUri}
          thumbnails={[imageThumbnail]}
          onClose={() => setImageOpen(false)}
        />
      )}
    </View>
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
    position: "relative",
    flexDirection: "row",
    flexWrap: "wrap",
    marginTop: 4,
    gap: 4,
  },
  stickerBadgesMe: {
    right: -6,
  },
  stickerBadgesOther: {
    left: -6,
  },
  stickerBadge: {
    minWidth: 42,
    paddingHorizontal: 6,
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
