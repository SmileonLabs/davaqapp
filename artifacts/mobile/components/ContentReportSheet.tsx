import React from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { Feather } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useColors } from "@/hooks/useColors";
import {
  contentReportError,
  reportReasonError,
  submitContentReport,
  type ContentReportTarget,
} from "@/lib/contentReports";

export function ContentReportSheet({
  target,
  onClose,
  presentation = "modal",
}: {
  target: ContentReportTarget | null;
  onClose: () => void;
  presentation?: "modal" | "inline";
}) {
  const c = useColors(),
    insets = useSafeAreaInsets();
  const [reason, setReason] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState("");
  const [receipt, setReceipt] = React.useState(false);
  const lock = React.useRef(false);
  React.useEffect(() => {
    setReason("");
    setError("");
    setReceipt(false);
  }, [target?.targetType, target?.targetId]);
  const close = () => {
    if (!lock.current) onClose();
  };
  const submit = async () => {
    if (!target || lock.current) return;
    const validation = reportReasonError(reason);
    if (validation) {
      setError(validation);
      return;
    }
    lock.current = true;
    setBusy(true);
    setError("");
    try {
      await submitContentReport(target, reason);
      setReceipt(true);
    } catch (failure) {
      setError(contentReportError(failure));
    } finally {
      lock.current = false;
      setBusy(false);
    }
  };
  const content = (
    <KeyboardAvoidingView
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      style={[s.overlay, { paddingTop: insets.top + 16 }]}
    >
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="신고 창 닫기"
        disabled={busy}
        onPress={close}
        style={StyleSheet.absoluteFill}
      />
      <View
        accessibilityViewIsModal
        style={[
          s.sheet,
          {
            backgroundColor: c.card,
            borderColor: c.border,
            paddingBottom: Math.max(insets.bottom, 20),
          },
        ]}
      >
        <View style={s.header}>
          <Text style={[s.title, { color: c.foreground }]}>
            {receipt ? "신고를 접수했어요" : "콘텐츠 신고"}
          </Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="신고 창 닫기"
            disabled={busy}
            onPress={close}
            style={s.close}
          >
            <Feather name="x" size={22} color={c.foreground} />
          </Pressable>
        </View>
        <ScrollView
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={s.content}
        >
          {receipt ? (
            <>
              <Text
                accessibilityLiveRegion="polite"
                style={[s.copy, { color: c.foreground }]}
              >
                운영팀이 내용을 확인할 예정이에요. 신고만으로 콘텐츠가 바로
                삭제되지는 않아요.
              </Text>
              <Pressable
                accessibilityRole="button"
                onPress={close}
                style={[s.button, { backgroundColor: c.primary }]}
              >
                <Text style={{ color: c.primaryForeground, fontWeight: "600" }}>
                  확인
                </Text>
              </Pressable>
            </>
          ) : (
            <>
              <Text style={[s.copy, { color: c.mutedForeground }]}>
                스팸, 괴롭힘, 부적절한 콘텐츠 등 문제가 되는 내용을 알려 주세요.
                비밀번호나 연락처는 적지 마세요.
              </Text>
              <TextInput
                accessibilityLabel="신고 사유"
                placeholder="어떤 문제가 있었나요? (5자 이상)"
                placeholderTextColor={c.mutedForeground}
                value={reason}
                onChangeText={setReason}
                editable={!busy}
                multiline
                maxLength={2000}
                textAlignVertical="top"
                style={[
                  s.input,
                  {
                    color: c.foreground,
                    backgroundColor: c.input,
                    borderColor: c.border,
                  },
                ]}
              />
              <Text style={[s.counter, { color: c.mutedForeground }]}>
                {reason.length}/2,000
              </Text>
              {!!error && (
                <Text
                  accessibilityRole="alert"
                  style={[s.copy, { color: c.destructive }]}
                >
                  {error}
                </Text>
              )}
              <Pressable
                accessibilityRole="button"
                accessibilityState={{
                  disabled: busy || !!reportReasonError(reason),
                  busy,
                }}
                disabled={busy || !!reportReasonError(reason)}
                onPress={() => void submit()}
                style={[
                  s.button,
                  {
                    backgroundColor: c.primary,
                    opacity: busy || !!reportReasonError(reason) ? 0.5 : 1,
                  },
                ]}
              >
                {busy ? (
                  <ActivityIndicator color={c.primaryForeground} />
                ) : (
                  <Text
                    style={{ color: c.primaryForeground, fontWeight: "600" }}
                  >
                    신고 보내기
                  </Text>
                )}
              </Pressable>
            </>
          )}
        </ScrollView>
      </View>
    </KeyboardAvoidingView>
  );
  if (presentation === "inline")
    return target ? <View style={s.inline}>{content}</View> : null;
  return (
    <Modal
      transparent
      visible={!!target}
      animationType="fade"
      onRequestClose={close}
    >
      {content}
    </Modal>
  );
}
const s = StyleSheet.create({
  inline: { ...StyleSheet.absoluteFillObject, zIndex: 1000, elevation: 20 },
  overlay: {
    flex: 1,
    justifyContent: "flex-end",
    backgroundColor: "rgba(0,0,0,0.4)",
  },
  sheet: {
    width: "100%",
    maxWidth: 560,
    alignSelf: "center",
    maxHeight: "100%",
    borderWidth: 1,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingLeft: 22,
    paddingRight: 10,
    paddingTop: 8,
  },
  title: { fontSize: 18, fontWeight: "700" },
  close: {
    minHeight: 48,
    minWidth: 48,
    alignItems: "center",
    justifyContent: "center",
  },
  content: { padding: 22, paddingTop: 8, gap: 14 },
  copy: { fontSize: 14, lineHeight: 21 },
  input: {
    minHeight: 128,
    maxHeight: 240,
    borderWidth: 1,
    borderRadius: 14,
    padding: 14,
    fontSize: 15,
    lineHeight: 22,
  },
  counter: { fontSize: 12, textAlign: "right" },
  button: {
    minHeight: 48,
    padding: 14,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
});
