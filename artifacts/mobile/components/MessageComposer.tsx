import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Keyboard,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  type DimensionValue,
  View,
} from "react-native";
import { Feather, MaterialCommunityIcons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { StickerPicker } from "./StickerPicker";
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
  /** Whether an image/file upload is in progress, for the inline spinners. */
  uploading: "image" | "file" | null;
  uploadProgress?: number | null;
  onCancelUpload?: () => void;
  placeholder?: string;
  draft?: { key: number; text: string };
  /**
   * Sends the trimmed text. Returns true on success; on false the composer
   * restores the text so the user doesn't lose their message.
   */
  onSend: (content: string) => Promise<boolean>;
  /** Fired (already throttled here) while the user is typing. */
  onTyping: () => void;
  onPickImage: () => void;
  onPickFile: () => void;
  onSendSticker: (code: string) => void;
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
  uploading,
  uploadProgress = null,
  onCancelUpload,
  placeholder = "메시지",
  draft,
  onSend,
  onTyping,
  onPickImage,
  onPickFile,
  onSendSticker,
  replyPreview,
  onCancelReply,
}: MessageComposerProps) {
  noteChatRender("composerRenders");
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const pwaBottom = usePwaBottomInset();
  const [text, setText] = useState("");
  const [showStickers, setShowStickers] = useState(false);
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

  const handleContentSizeChange = useCallback((event: any) => {
    const next = Math.min(
      INPUT_MAX_HEIGHT,
      Math.max(INPUT_MIN_HEIGHT, event.nativeEvent.contentSize.height),
    );
    setInputHeight((current) => (current === next ? current : next));
  }, []);

  const submit = useCallback(async () => {
    const content = text.trim();
    if (!content || sending || submittingRef.current) return;
    submittingRef.current = true;
    setText("");
    setInputHeight(INPUT_MIN_HEIGHT);
    lastTypingSentRef.current = 0;
    try {
      const ok = await onSend(content);
      if (!ok) setText(content);
    } finally {
      submittingRef.current = false;
    }
  }, [text, sending, onSend]);

  const handleChangeText = useCallback(
    (value: string) => {
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
          Date.now() - lastCompositionEndAtRef.current < SAFARI_COMPOSITION_END_GUARD_MS;
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
    setText(draft.text);
    inputRef.current?.focus();
  }, [draft]);

  const hasText = text.trim().length > 0;
  const uploadLabel = uploading === "image" ? "사진 업로드 중" : uploading === "file" ? "파일 업로드 중" : null;
  const progressText = typeof uploadProgress === "number" ? `${uploadProgress}%` : "준비 중";
  const progressWidth = `${Math.max(6, uploadProgress ?? 12)}%` as DimensionValue;

  return (
    <>
      {replyPreview ? (
        <View
          style={[
            styles.replyPreview,
            { backgroundColor: colors.background, borderTopColor: colors.border },
          ]}
        >
          <View style={[styles.replyAccent, { backgroundColor: colors.primary }]} />
          <View style={styles.replyTextWrap}>
            <Text style={[styles.replyLabel, { color: colors.primary }]} numberOfLines={1}>
              {replyPreview.senderName ? `${replyPreview.senderName}에게 답장` : "답장"}
            </Text>
            <Text style={[styles.replyText, { color: colors.mutedForeground }]} numberOfLines={1}>
              {replyPreview.content}
            </Text>
          </View>
          <Pressable
            onPress={onCancelReply}
            hitSlop={8}
            style={({ pressed }) => [styles.replyClose, { opacity: pressed ? 0.5 : 1 }]}
          >
            <Feather name="x" size={18} color={colors.mutedForeground} />
          </Pressable>
        </View>
      ) : null}
      {uploading ? (
        <View
          style={[
            styles.uploadStatus,
            { backgroundColor: colors.background, borderTopColor: colors.border },
          ]}
        >
          <View style={styles.uploadStatusTop}>
            <View style={styles.uploadStatusTextWrap}>
              <Text style={[styles.uploadStatusLabel, { color: colors.foreground }]} numberOfLines={1}>
                {uploadLabel}
              </Text>
              <Text style={[styles.uploadStatusProgress, { color: colors.mutedForeground }]}>
                {progressText}
              </Text>
            </View>
            {onCancelUpload ? (
              <Pressable onPress={onCancelUpload} hitSlop={8} style={({ pressed }) => ({ opacity: pressed ? 0.55 : 1 })}>
                <Text style={[styles.uploadCancel, { color: colors.primary }]}>취소</Text>
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
            backgroundColor: colors.background,
            borderTopColor: colors.border,
            paddingBottom: (insets.bottom > 0 ? insets.bottom : 10) + pwaBottom,
          },
        ]}
      >
        <View style={[styles.inputField, { backgroundColor: colors.input }]}>
          <Pressable
            style={({ pressed }) => [styles.fieldBtn, { opacity: pressed ? 0.5 : 1 }]}
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
          <TextInput
            ref={inputRef}
            style={[
              styles.input,
              {
                color: colors.foreground,
                // react-native-web synchronously reads scrollHeight/scrollWidth
                // whenever onContentSizeChange is present. On iOS Safari that
                // forces a full-page layout on every keystroke and becomes very
                // expensive once the chat contains media-rich rows. Keep the
                // PWA composer at one line with its own scroll area; native keeps
                // the expanding composer behavior.
                height: Platform.OS === "web" ? INPUT_MIN_HEIGHT : inputHeight,
              },
            ]}
            value={text}
            onChangeText={handleChangeText}
            onContentSizeChange={Platform.OS === "web" ? undefined : handleContentSizeChange}
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
            numberOfLines={1}
            maxLength={2000}
            blurOnSubmit={false}
            scrollEnabled={Platform.OS === "web" || inputHeight >= INPUT_MAX_HEIGHT}
          />
          <Pressable
            style={({ pressed }) => [styles.fieldBtn, { opacity: pressed ? 0.5 : 1 }]}
            accessibilityRole="button"
            accessibilityLabel="사진 첨부"
            onPress={onPickImage}
            disabled={!!uploading || sending}
            hitSlop={6}
          >
            {uploading === "image" ? (
              <ActivityIndicator size="small" color={colors.primary} />
            ) : (
              <Feather name="image" size={22} color={colors.mutedForeground} />
            )}
          </Pressable>
          <Pressable
            style={({ pressed }) => [styles.fieldBtn, styles.fieldBtnLast, { opacity: pressed ? 0.5 : 1 }]}
            accessibilityRole="button"
            accessibilityLabel="파일 첨부"
            onPress={onPickFile}
            disabled={!!uploading || sending}
            hitSlop={6}
          >
            {uploading === "file" ? (
              <ActivityIndicator size="small" color={colors.primary} />
            ) : (
              <Feather name="paperclip" size={22} color={colors.mutedForeground} />
            )}
          </Pressable>
        </View>
        <Pressable
          style={({ pressed }) => [
            styles.sendBtn,
            {
              backgroundColor: hasText ? colors.primary : colors.muted,
              opacity: pressed ? 0.85 : 1,
            },
          ]}
          accessibilityRole="button"
          accessibilityLabel="메시지 보내기"
          onPress={() => void submit()}
          disabled={!hasText || sending}
        >
          <Feather name="send" size={19} color={hasText ? "#fff" : colors.mutedForeground} />
        </Pressable>
      </View>

      {showStickers ? <StickerPicker onSelect={onSendSticker} /> : null}
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
    paddingHorizontal: 8,
    paddingTop: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  inputField: {
    flex: 1,
    flexDirection: "row",
    alignItems: "flex-end",
    borderRadius: 22,
    minHeight: 44,
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
  input: {
    flex: 1,
    minHeight: 44,
    maxHeight: 120,
    paddingHorizontal: 4,
    paddingTop: 12,
    paddingBottom: 12,
    fontSize: 16,
    lineHeight: 20,
    fontFamily: "Inter_400Regular",
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
