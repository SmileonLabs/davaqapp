import { Feather } from "@expo/vector-icons";
import React from "react";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { CustomScrollView } from "@/components/CustomScroll";
import { useColors } from "@/hooks/useColors";
import { crossAlert } from "@/lib/crossAlert";
import {
  useCreateUserAiMemory,
  useDeleteUserAiMemory,
  useUserAiMemories,
} from "@/hooks/useKnowledge";

export default function AiMemoriesScreen() {
  const colors = useColors();
  const { data: memories, isLoading } = useUserAiMemories();
  const createMemory = useCreateUserAiMemory();
  const deleteMemory = useDeleteUserAiMemory();
  const [text, setText] = React.useState("");

  const handleCreate = async () => {
    const value = text.trim();
    if (!value) return;
    try {
      await createMemory.mutateAsync({ text: value });
      setText("");
    } catch {
      crossAlert("오류", "AI 기억을 저장하지 못했습니다.");
    }
  };

  const handleDelete = (id: string) => {
    crossAlert("기억 삭제", "이 기억을 더 이상 AI가 참고하지 않게 할까요?", [
      { text: "취소", style: "cancel" },
      {
        text: "삭제",
        style: "destructive",
        onPress: () => {
          void deleteMemory
            .mutateAsync(id)
            .catch(() => crossAlert("오류", "AI 기억을 삭제하지 못했습니다."));
        },
      },
    ]);
  };

  return (
    <View style={[styles.container, { backgroundColor: colors.muted }]}>
      <CustomScrollView contentContainerStyle={styles.content}>
        <View
          style={[
            styles.hero,
            { backgroundColor: colors.background, borderColor: colors.border },
          ]}
        >
          <View style={[styles.heroIcon, { backgroundColor: colors.accent }]}>
            <Feather name="database" size={22} color={colors.primary} />
          </View>
          <Text style={[styles.heroTitle, { color: colors.foreground }]}>
            내 AI 기억
          </Text>
          <Text style={[styles.heroBody, { color: colors.mutedForeground }]}>
            DavaQ가 참고해도 되는 취향, 선호, 말투 힌트를 직접 관리합니다.
            삭제하면 더 이상 응답에 사용하지 않습니다.
          </Text>
        </View>

        <View
          style={[
            styles.editor,
            { backgroundColor: colors.background, borderColor: colors.border },
          ]}
        >
          <TextInput
            value={text}
            onChangeText={setText}
            placeholder="예: 나는 짧고 바로 실행 가능한 답변을 선호해"
            placeholderTextColor={colors.mutedForeground}
            multiline
            style={[styles.input, { color: colors.foreground }]}
          />
          <Pressable
            onPress={() => void handleCreate()}
            disabled={!text.trim() || createMemory.isPending}
            style={[
              styles.primaryButton,
              {
                backgroundColor: colors.primary,
                opacity: !text.trim() || createMemory.isPending ? 0.55 : 1,
              },
            ]}
          >
            {createMemory.isPending ? (
              <ActivityIndicator
                size="small"
                color={colors.primaryForeground}
              />
            ) : (
              <Feather name="plus" size={16} color={colors.primaryForeground} />
            )}
            <Text
              style={[styles.primaryText, { color: colors.primaryForeground }]}
            >
              기억 추가
            </Text>
          </Pressable>
        </View>

        <Text style={[styles.sectionTitle, { color: colors.mutedForeground }]}>
          저장된 기억
        </Text>
        {isLoading ? (
          <ActivityIndicator color={colors.primary} />
        ) : memories?.length ? (
          <View style={styles.memoryList}>
            {memories.map((memory) => (
              <View
                key={memory.id}
                style={[
                  styles.memoryCard,
                  {
                    backgroundColor: colors.background,
                    borderColor: colors.border,
                  },
                ]}
              >
                <View style={styles.memoryTextBlock}>
                  <Text
                    style={[styles.memoryText, { color: colors.foreground }]}
                  >
                    {memory.text}
                  </Text>
                  <Text
                    style={[
                      styles.memoryMeta,
                      { color: colors.mutedForeground },
                    ]}
                  >
                    {memory.privacyScope === "user_private"
                      ? "나만의 AI 기억"
                      : memory.privacyScope}
                  </Text>
                </View>
                <Pressable
                  accessibilityLabel="기억 삭제"
                  hitSlop={8}
                  onPress={() => handleDelete(memory.id)}
                >
                  <Feather
                    name="trash-2"
                    size={18}
                    color={colors.destructive}
                  />
                </Pressable>
              </View>
            ))}
          </View>
        ) : (
          <View
            style={[
              styles.empty,
              {
                backgroundColor: colors.background,
                borderColor: colors.border,
              },
            ]}
          >
            <Text style={[styles.emptyText, { color: colors.mutedForeground }]}>
              아직 저장된 AI 기억이 없습니다.
            </Text>
          </View>
        )}
      </CustomScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { gap: 14, padding: 16, paddingBottom: 36 },
  hero: {
    borderRadius: 20,
    borderWidth: StyleSheet.hairlineWidth,
    gap: 8,
    padding: 18,
  },
  heroIcon: {
    alignItems: "center",
    borderRadius: 16,
    height: 44,
    justifyContent: "center",
    width: 44,
  },
  heroTitle: { fontFamily: "Inter_700Bold", fontSize: 22, letterSpacing: -0.5 },
  heroBody: { fontFamily: "Inter_400Regular", fontSize: 13, lineHeight: 20 },
  editor: {
    borderRadius: 18,
    borderWidth: StyleSheet.hairlineWidth,
    gap: 12,
    padding: 14,
  },
  input: {
    fontFamily: "Inter_400Regular",
    fontSize: 14,
    minHeight: 88,
    textAlignVertical: "top",
  },
  primaryButton: {
    alignItems: "center",
    alignSelf: "flex-start",
    borderRadius: 999,
    flexDirection: "row",
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 11,
  },
  primaryText: { fontFamily: "Inter_700Bold", fontSize: 14 },
  sectionTitle: {
    fontFamily: "Inter_600SemiBold",
    fontSize: 13,
    paddingHorizontal: 4,
  },
  memoryList: { gap: 10 },
  memoryCard: {
    alignItems: "center",
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    flexDirection: "row",
    gap: 12,
    padding: 14,
  },
  memoryTextBlock: { flex: 1, gap: 5 },
  memoryText: { fontFamily: "Inter_600SemiBold", fontSize: 14, lineHeight: 20 },
  memoryMeta: { fontFamily: "Inter_400Regular", fontSize: 12 },
  empty: {
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    padding: 16,
  },
  emptyText: {
    fontFamily: "Inter_400Regular",
    fontSize: 13,
    textAlign: "center",
  },
});
