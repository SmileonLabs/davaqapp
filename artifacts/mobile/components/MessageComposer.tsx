import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Animated,
  Modal,
  useWindowDimensions,
  Keyboard,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  type DimensionValue,
  View,
} from "react-native";
import * as Haptics from "expo-haptics";
import { Feather, MaterialCommunityIcons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useReducedMotion } from "react-native-reanimated";
import { StickerImage } from "./StickerImage";
import { GifPicker } from "./GifPicker";
import type { GifResult } from "@/lib/gifSearch";
import { StickerPicker } from "./StickerPicker";
import { MessengerAction, MessengerSheet } from "./chat/MessengerUI";
import { chatDrafts } from "@/lib/chatDrafts";
import { useColors } from "@/hooks/useColors";
import { usePwaBottomInset } from "@/hooks/usePwaBottomInset";
import {
  chatPerformanceDiagnosticsEnabled,
  chatPerformanceNow,
  noteChatInputCommit,
  noteChatRender,
} from "@/lib/chatPerformanceDiagnostics";

const INPUT_MIN_HEIGHT = 44;
const INPUT_MAX_HEIGHT = 124;
// Safari can dispatch the Enter key that commits an IME composition immediately
// after compositionend, with isComposing already reset to false. Treat that key
// as part of the composition instead of a send action.
const SAFARI_COMPOSITION_END_GUARD_MS = 80;

interface MessageComposerProps {
  /** Whether a send mutation is currently in flight (disables the composer). */
  sending: boolean;
  dismissRequest?: number;
  /** Whether an image/file upload is in progress, for the inline spinners. */
  uploading: "image" | "file" | null;
  uploadProgress?: number | null;
  onCancelUpload?: () => void;
  placeholder?: string;
  draft?: { key: number; text: string };
  draftKey?: string;
  /**
   * Sends the trimmed text. Returns true on success; on false the composer
   * restores the text so the user doesn't lose their message.
   */
  onSend: (content: string) => Promise<boolean>;
  /** Fired (already throttled here) while the user is typing. */
  onTyping: () => void;
  onPickImage: (camera?: boolean, original?: boolean) => void;
  onPickFile: (video?: "camera" | "library") => void;
  onSendSticker: (code: string) => void;
  onSendGif?: (gif: GifResult) => Promise<void>;
  replyPreview?: { senderName?: string | null; content: string } | null;
  onCancelReply?: () => void;
}

/**
 * The chat input bar lives in its own component with LOCAL text state so that
 * each keystroke only re-renders the composer — never the parent chat screen or
 * its (potentially large) message list. This is the fix for typing lag: when
 * `text` lived on the chat screen, every character re-rendered every message
 * bubble.
 */
function MessageComposerComponent({
  sending,
  dismissRequest = 0,
  uploading,
  uploadProgress = null,
  onCancelUpload,
  placeholder = "메시지",
  draft,
  draftKey,
  onSend,
  onTyping,
  onPickImage,
  onPickFile,
  onSendSticker,
  onSendGif,
  replyPreview,
  onCancelReply,
}: MessageComposerProps) {
  noteChatRender("composerRenders");
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const pwaBottom = usePwaBottomInset();
  const [text, setText] = useState("");
  const { width: windowWidth } = useWindowDimensions();
  const reducedMotion = useReducedMotion();
  const [flight, setFlight] = useState<{
    code: string;
    x: number;
    y: number;
  } | null>(null);
  const flightProgress = useRef(new Animated.Value(0)).current;
  const pickerAnchor = useRef<View>(null);
  useEffect(() => () => flightProgress.stopAnimation(), [flightProgress]);
  const selectSticker = useCallback(
    (code: string, origin?: { x: number; y: number }) => {
      onSendSticker(code);
      if (reducedMotion || !origin) return;
      flightProgress.stopAnimation();
      flightProgress.setValue(0);
      pickerAnchor.current?.measureInWindow((_x, y) => {
        setFlight({ code, x: origin.x, y: origin.y });
        flightTarget.current = {
          x: windowWidth - 108,
          y: Math.max(80, y - 120),
        };
        Animated.timing(flightProgress, {
          toValue: 1,
          duration: 380,
          useNativeDriver: Platform.OS !== "web",
        }).start(({ finished }) => {
          if (finished) setFlight(null);
        });
      });
    },
    [onSendSticker, reducedMotion, flightProgress, windowWidth],
  );
  const flightTarget = useRef({ x: 0, y: 0 });
  const [mediaTab, setMediaTab] = useState<"sticker" | "gif">("sticker");
  const gifBusyRef = useRef(false);
  const [gifBusy, setGifBusy] = useState(false);
  const [showStickers, setShowStickers] = useState(false);
  const [showAttachments, setShowAttachments] = useState(false);
  useEffect(() => {
    setShowStickers(false);
    setShowAttachments(false);
    Keyboard.dismiss();
  }, [dismissRequest]);
  const [draftReady, setDraftReady] = useState(false);
  const edited = useRef(false),
    textRef = useRef(text),
    alive = useRef(true);
  textRef.current = text;
  useEffect(() => {
    alive.current = true;
    let active = true;
    if (!draftKey) {
      setDraftReady(true);
      return;
    }
    void chatDrafts
      .read(draftKey)
      .then((value) => {
        if (active && !edited.current) {
          textRef.current = value;
          setText(value);
        }
      })
      .catch(() => {})
      .finally(() => {
        if (active) setDraftReady(true);
      });
    return () => {
      active = false;
      alive.current = false;
      if (edited.current)
        void chatDrafts.write(draftKey, textRef.current).catch(() => {});
    };
  }, [draftKey]);
  useEffect(() => {
    if (!draftKey || !draftReady || !edited.current) return;
    const timer = setTimeout(
      () => void chatDrafts.write(draftKey, text).catch(() => {}),
      300,
    );
    return () => clearTimeout(timer);
  }, [draftKey, draftReady, text]);
  const [inputHeight, setInputHeight] = useState(INPUT_MIN_HEIGHT);
  const inputRef = useRef<TextInput>(null);
  const lastTypingSentRef = useRef(0);
  const composingRef = useRef(false);
  const lastCompositionEndAtRef = useRef(0);
  const submittingRef = useRef(false);
  const inputStartedAtRef = useRef<number | null>(null);

  useEffect(() => {
    const startedAt = inputStartedAtRef.current;
    if (startedAt === null) return;
    inputStartedAtRef.current = null;
    if (typeof requestAnimationFrame === "function") {
      // Do not cancel the previous sample when another key lands before the
      // frame. Cancelling systematically hides the worst bursts on a busy iPhone.
      requestAnimationFrame(() => noteChatInputCommit(startedAt));
      return;
    }
    noteChatInputCommit(startedAt);
  }, [text]);

  const handleInputMeasure = useCallback((event: any) => {
    const next = Math.min(
      INPUT_MAX_HEIGHT,
      Math.max(INPUT_MIN_HEIGHT, event.nativeEvent.layout.height),
    );
    setInputHeight((current) => (current === next ? current : next));
  }, []);

  const submit = useCallback(async () => {
    const content = text.trim();
    if (!content || content.length > 2000 || sending || submittingRef.current)
      return;
    submittingRef.current = true;
    // Focus during the user gesture: iOS PWA cannot reopen its keyboard after
    // awaiting the send request, and the send button otherwise takes focus.
    if (Platform.OS === "web") inputRef.current?.focus();
    if (Platform.OS !== "web")
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(
        () => {},
      );
    edited.current = true;
    textRef.current = "";
    setText("");
    if (draftKey) void chatDrafts.write(draftKey, "").catch(() => {});
    setInputHeight(INPUT_MIN_HEIGHT);
    lastTypingSentRef.current = 0;
    try {
      const ok = await onSend(content);
      if (!ok && alive.current)
        setText((current) => {
          const next = content + (current ? "\n" + current : "");
          textRef.current = next;
          return next;
        });
    } catch {
      if (alive.current)
        setText((current) => {
          const next = content + (current ? "\n" + current : "");
          textRef.current = next;
          return next;
        });
    } finally {
      submittingRef.current = false;
    }
  }, [text, sending, onSend, draftKey]);

  const handleChangeText = useCallback(
    (value: string) => {
      edited.current = true;
      textRef.current = value;
      setText(value);
      if (!value.trim()) return;
      const now = Date.now();
      if (now - lastTypingSentRef.current > 2000) {
        lastTypingSentRef.current = now;
        onTyping();
      }
    },
    [onTyping],
  );

  // Telegram-style emoji/keyboard toggle: opening the sticker panel dismisses the
  // soft keyboard so the panel takes its place; closing it restores the keyboard.
  const toggleStickers = useCallback(() => {
    if (showStickers) {
      setShowStickers(false);
      inputRef.current?.focus();
    } else {
      inputRef.current?.blur();
      Keyboard.dismiss();
      setShowStickers(true);
    }
  }, [showStickers]);

  const handleCompositionStart = useCallback(() => {
    composingRef.current = true;
  }, []);

  const handleCompositionEnd = useCallback(() => {
    composingRef.current = false;
    lastCompositionEndAtRef.current = Date.now();
  }, []);

  // Web: Enter sends, Shift+Enter inserts a newline. Enter also commits Korean,
  // Japanese, and Chinese IME composition, so never send while that composition
  // is active (or during Safari's compositionend -> key event handoff).
  const handleKeyPress = useCallback(
    (e: any) => {
      if (Platform.OS !== "web") return;
      const key = e?.key ?? e?.nativeEvent?.key;
      const isShift = !!(e?.shiftKey ?? e?.nativeEvent?.shiftKey);
      if (key === "Enter" && !isShift) {
        const nativeEvent = e?.nativeEvent ?? e;
        const isComposing =
          composingRef.current ||
          nativeEvent?.isComposing === true ||
          nativeEvent?.keyCode === 229 ||
          nativeEvent?.which === 229 ||
          Date.now() - lastCompositionEndAtRef.current <
            SAFARI_COMPOSITION_END_GUARD_MS;
        if (isComposing) return;
        e.preventDefault?.();
        void submit();
      }
    },
    [submit],
  );

  const handleDiagnosticKeyDown = useCallback(() => {
    if (!chatPerformanceDiagnosticsEnabled()) return;
    inputStartedAtRef.current = chatPerformanceNow();
  }, []);

  useEffect(() => {
    if (!draft) return;
    edited.current = true;
    textRef.current = draft.text;
    setText(draft.text);
    inputRef.current?.focus();
  }, [draft]);

  useEffect(() => {
    if (replyPreview) inputRef.current?.focus();
  }, [replyPreview]);
  const hasText = text.trim().length > 0;
  const uploadLabel =
    uploading === "image"
      ? "사진 업로드 중"
      : uploading === "file"
        ? "파일 업로드 중"
        : null;
  const progressText =
    typeof uploadProgress === "number" ? `${uploadProgress}%` : "준비 중";
  const progressWidth =
    `${Math.max(6, uploadProgress ?? 12)}%` as DimensionValue;

  return (
    <>
      {replyPreview ? (
        <View
          style={[
            styles.replyPreview,
            {
              backgroundColor: colors.background,
              borderTopColor: colors.border,
            },
          ]}
        >
          <View
            style={[styles.replyAccent, { backgroundColor: colors.primary }]}
          />
          <View style={styles.replyTextWrap}>
            <Text
              style={[styles.replyLabel, { color: colors.primary }]}
              numberOfLines={1}
            >
              {replyPreview.senderName
                ? `${replyPreview.senderName}에게 답장`
                : "답장"}
            </Text>
            <Text
              style={[styles.replyText, { color: colors.mutedForeground }]}
              numberOfLines={1}
            >
              {replyPreview.content}
            </Text>
          </View>
          <Pressable
            onPress={onCancelReply}
            accessibilityRole="button"
            accessibilityLabel="답장 취소"
            hitSlop={8}
            style={({ pressed }) => [
              styles.replyClose,
              { opacity: pressed ? 0.5 : 1 },
            ]}
          >
            <Feather name="x" size={18} color={colors.mutedForeground} />
          </Pressable>
        </View>
      ) : null}
      {uploading ? (
        <View
          style={[
            styles.uploadStatus,
            {
              backgroundColor: colors.background,
              borderTopColor: colors.border,
            },
          ]}
        >
          <View style={styles.uploadStatusTop}>
            <View style={styles.uploadStatusTextWrap}>
              <Text
                style={[styles.uploadStatusLabel, { color: colors.foreground }]}
                numberOfLines={1}
              >
                {uploadLabel}
              </Text>
              <Text
                style={[
                  styles.uploadStatusProgress,
                  { color: colors.mutedForeground },
                ]}
              >
                {progressText}
              </Text>
            </View>
            {onCancelUpload ? (
              <Pressable
                onPress={onCancelUpload}
                hitSlop={8}
                style={({ pressed }) => ({ opacity: pressed ? 0.55 : 1 })}
              >
                <Text style={[styles.uploadCancel, { color: colors.primary }]}>
                  취소
                </Text>
              </Pressable>
            ) : null}
          </View>
          <View style={[styles.uploadTrack, { backgroundColor: colors.muted }]}>
            <View
              style={[
                styles.uploadFill,
                { backgroundColor: colors.primary, width: progressWidth },
              ]}
            />
          </View>
        </View>
      ) : null}
      <View
        style={[
          styles.inputRow,
          {
            backgroundColor: colors.card,
            borderTopColor: colors.border,
            paddingBottom: (insets.bottom > 0 ? insets.bottom : 10) + pwaBottom,
          },
        ]}
      >
        <View style={[styles.inputField, { backgroundColor: colors.input }]}>
          <Pressable
            style={({ pressed }) => [
              styles.fieldBtn,
              { opacity: pressed ? 0.5 : 1 },
            ]}
            accessibilityRole="button"
            accessibilityLabel="스티커"
            onPress={toggleStickers}
            hitSlop={6}
          >
            {showStickers ? (
              <MaterialCommunityIcons
                name="keyboard-outline"
                size={24}
                color={colors.primary}
              />
            ) : (
              <Feather name="smile" size={23} color={colors.mutedForeground} />
            )}
          </Pressable>
          <View style={styles.inputWrap}>
            <Text
              accessible={false}
              accessibilityElementsHidden
              importantForAccessibility="no-hide-descendants"
              pointerEvents="none"
              style={styles.inputMeasure}
              onLayout={handleInputMeasure}
            >
              {text + "\u200b"}
            </Text>
            <TextInput
              ref={inputRef}
              accessibilityLabel="메시지 입력"
              style={[
                styles.input,
                {
                  color: colors.foreground,
                  height: inputHeight,
                },
              ]}
              value={text}
              onChangeText={handleChangeText}
              onKeyPress={handleKeyPress}
              {...(Platform.OS === "web"
                ? ({
                    onCompositionStart: handleCompositionStart,
                    onCompositionEnd: handleCompositionEnd,
                    onKeyDown: handleDiagnosticKeyDown,
                  } as object)
                : {})}
              onFocus={() => setShowStickers(false)}
              placeholder={placeholder}
              placeholderTextColor={colors.mutedForeground}
              multiline
              maxLength={2000}
              blurOnSubmit={false}
              scrollEnabled={
                Platform.OS === "web" || inputHeight >= INPUT_MAX_HEIGHT
              }
            />
          </View>
          <Pressable
            style={({ pressed }) => [
              styles.fieldBtn,
              styles.fieldBtnLast,
              { opacity: pressed ? 0.5 : 1 },
            ]}
            accessibilityRole="button"
            accessibilityLabel="첨부 파일 선택"
            disabled={!!uploading || sending}
            onPress={() => setShowAttachments(true)}
            hitSlop={6}
          >
            {uploading ? (
              <ActivityIndicator size="small" color={colors.primary} />
            ) : (
              <Feather
                name="paperclip"
                size={22}
                color={colors.mutedForeground}
              />
            )}
          </Pressable>
        </View>
        <Pressable
          style={({ pressed }) => [
            styles.sendBtn,
            {
              backgroundColor: hasText ? colors.primary : colors.muted,
              opacity: pressed ? 0.85 : 1,
              transform: [{ scale: pressed ? 0.92 : 1 }],
            },
          ]}
          accessibilityRole="button"
          accessibilityLabel="메시지 보내기"
          onPressIn={() => {
            if (Platform.OS === "web") inputRef.current?.focus();
          }}
          onPress={() => void submit()}
          {...(Platform.OS === "web"
            ? { onMouseDown: (e: any) => e.preventDefault() }
            : ({} as any))}
          disabled={!hasText || sending || text.trim().length > 2000}
        >
          <Feather
            name="send"
            size={19}
            color={hasText ? "#fff" : colors.mutedForeground}
          />
        </Pressable>
      </View>

      {text.length > 1900 && (
        <Text
          accessibilityLiveRegion="polite"
          style={{
            paddingHorizontal: 16,
            paddingBottom: 4,
            textAlign: "right",
            fontSize: 11,
            color:
              text.length > 2000 ? colors.destructive : colors.mutedForeground,
          }}
        >
          {text.length} / 2000
        </Text>
      )}
      {flight ? (
        <Modal transparent visible animationType="none">
          <View pointerEvents="none" style={{ flex: 1 }}>
            <Animated.View
              style={{
                position: "absolute",
                left: flight.x,
                top: flight.y,
                transform: [
                  {
                    translateX: flightProgress.interpolate({
                      inputRange: [0, 1],
                      outputRange: [0, flightTarget.current.x - flight.x],
                    }),
                  },
                  {
                    translateY: flightProgress.interpolate({
                      inputRange: [0, 1],
                      outputRange: [0, flightTarget.current.y - flight.y],
                    }),
                  },
                  {
                    scale: flightProgress.interpolate({
                      inputRange: [0, 0.7, 1],
                      outputRange: [1, 1.7, 1.8],
                    }),
                  },
                ],
                opacity: flightProgress.interpolate({
                  inputRange: [0, 0.85, 1],
                  outputRange: [1, 1, 0],
                }),
              }}
            >
              <StickerImage code={flight.code} size={54} />
            </Animated.View>
          </View>
        </Modal>
      ) : null}
      {showStickers ? (
        <View ref={pickerAnchor} collapsable={false}>
          <View style={{ flexDirection: "row", backgroundColor: colors.card }}>
            {(["sticker", "gif"] as const).map((tab) => (
              <Pressable
                key={tab}
                accessibilityRole="tab"
                accessibilityState={{ selected: mediaTab === tab }}
                onPress={() => setMediaTab(tab)}
                style={{ padding: 12 }}
              >
                <Text
                  style={{
                    color:
                      mediaTab === tab
                        ? colors.primary
                        : colors.mutedForeground,
                  }}
                >
                  {tab === "gif" ? "GIF" : "스티커"}
                </Text>
              </Pressable>
            ))}
          </View>
          {mediaTab === "gif" ? (
            <GifPicker
              onPickLocal={() => onPickImage(false, true)}
              busy={gifBusy}
              onSelect={async (gif) => {
                if (gifBusyRef.current || !onSendGif) return;
                gifBusyRef.current = true;
                setGifBusy(true);
                try {
                  await onSendGif(gif);
                } finally {
                  gifBusyRef.current = false;
                  setGifBusy(false);
                }
              }}
            />
          ) : (
            <StickerPicker onSelect={selectSticker} />
          )}
        </View>
      ) : null}
      <MessengerSheet
        visible={showAttachments}
        title="대화에 첨부"
        onClose={() => setShowAttachments(false)}
      >
        <MessengerAction
          icon="image"
          title="사진 첨부"
          subtitle="사진을 골라 대화에 보내기"
          onPress={() => {
            setShowAttachments(false);
            onPickImage();
          }}
        />
        <MessengerAction
          icon="camera"
          title="카메라"
          subtitle="직접 찍어서 보내기"
          onPress={() => {
            setShowAttachments(false);
            onPickImage(true);
          }}
        />
        <MessengerAction
          icon="image"
          title="원본 사진"
          subtitle="압축 없이 원본 보내기"
          onPress={() => {
            setShowAttachments(false);
            onPickImage(false, true);
          }}
        />
        <MessengerAction
          icon="video"
          title="영상 첨부"
          subtitle="동영상을 골라 보내기"
          onPress={() => {
            setShowAttachments(false);
            onPickFile("library");
          }}
        />
        <MessengerAction
          icon="video"
          title="영상 촬영"
          subtitle="카메라로 동영상 찍기"
          onPress={() => {
            setShowAttachments(false);
            onPickFile("camera");
          }}
        />
        <MessengerAction
          icon="file"
          title="파일 첨부"
          subtitle="문서와 파일 공유하기"
          onPress={() => {
            setShowAttachments(false);
            onPickFile();
          }}
        />
      </MessengerSheet>
    </>
  );
}

export const MessageComposer = React.memo(MessageComposerComponent);

const styles = StyleSheet.create({
  replyPreview: {
    flexDirection: "row",
    alignItems: "center",
    gap: 9,
    paddingHorizontal: 12,
    paddingTop: 8,
    paddingBottom: 7,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  replyAccent: {
    width: 3,
    alignSelf: "stretch",
    borderRadius: 2,
  },
  replyTextWrap: {
    flex: 1,
    minWidth: 0,
  },
  replyLabel: {
    fontSize: 12,
    fontFamily: "Inter_600SemiBold",
  },
  replyText: {
    marginTop: 1,
    fontSize: 12,
    fontFamily: "Inter_400Regular",
  },
  replyClose: {
    width: 30,
    height: 30,
    alignItems: "center",
    justifyContent: "center",
  },
  uploadStatus: {
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 12,
    paddingTop: 8,
    paddingBottom: 7,
    gap: 7,
  },
  uploadStatusTop: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
  },
  uploadStatusTextWrap: {
    flex: 1,
    minWidth: 0,
  },
  uploadStatusLabel: {
    fontSize: 13,
    fontFamily: "Inter_600SemiBold",
  },
  uploadStatusProgress: {
    marginTop: 1,
    fontSize: 12,
    fontFamily: "Inter_400Regular",
  },
  uploadCancel: {
    fontSize: 13,
    fontFamily: "Inter_700Bold",
  },
  uploadTrack: {
    height: 3,
    overflow: "hidden",
    borderRadius: 999,
  },
  uploadFill: {
    height: "100%",
    borderRadius: 999,
  },
  inputRow: {
    flexDirection: "row",
    alignItems: "flex-end",
    gap: 8,
    paddingHorizontal: 12,
    paddingTop: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  inputField: {
    flex: 1,
    flexDirection: "row",
    alignItems: "flex-end",
    borderRadius: 23,
    minHeight: 46,
    paddingHorizontal: 2,
  },
  fieldBtn: {
    width: 38,
    height: 44,
    alignItems: "center",
    justifyContent: "center",
  },
  fieldBtnLast: {
    marginRight: 2,
  },
  inputWrap: {
    flex: 1,
    minWidth: 0,
  },
  // Measure unconstrained wrapped text separately: Android's content-size event
  // can report the already constrained input height. Also handles pasted text,
  // restored drafts and browsers without CSS field-sizing support.
  inputMeasure: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    opacity: 0,
    paddingHorizontal: 4,
    paddingVertical: 12,
    fontSize: 16,
    lineHeight: 20,
    fontFamily: "Inter_400Regular",
    includeFontPadding: false,
  },
  input: {
    minHeight: 44,
    maxHeight: INPUT_MAX_HEIGHT,
    paddingHorizontal: 4,
    paddingTop: 12,
    paddingBottom: 12,
    fontSize: 16,
    lineHeight: 20,
    fontFamily: "Inter_400Regular",
    includeFontPadding: false,
    textAlignVertical: "top",
    ...(Platform.OS === "web"
      ? {
          outlineStyle: "none" as any,
          overflowY: "auto" as any,
          resize: "none" as any,
        }
      : null),
  },
  sendBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
  },
});
