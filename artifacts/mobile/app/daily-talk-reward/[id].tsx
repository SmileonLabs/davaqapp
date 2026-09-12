import { Feather } from "@expo/vector-icons";
import { useLocalSearchParams, useRouter } from "expo-router";
import React from "react";
import { ActivityIndicator, Modal, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { CustomScrollView } from "@/components/CustomScroll";
import { useColors } from "@/hooks/useColors";
import {
  dailyTalkRewardSyncDescription,
  dailyTalkRewardSyncLabel,
  useDailyTalkReward,
  usePostDailyTalkRewardToFeed,
  useSaveDailyTalkReward,
  useUpdateDailyTalkReward,
  type DailyTalkReward,
  type DailyTalkRewardVisibility,
} from "@/hooks/useDailyTalkReward";

const VISIBILITIES: Array<{ value: DailyTalkRewardVisibility; label: string; description: string }> = [
  { value: "PRIVATE", label: "나만 보기", description: "내 기록에만 저장" },
  { value: "FRIENDS", label: "친구 공개", description: "친구에게만 공개" },
  { value: "PUBLIC", label: "전체 공개", description: "피드 전체 공개" },
];

const SCORE_META: Array<{ key: keyof DailyTalkReward["scores"]; label: string }> = [
  { key: "empathy", label: "공감력" },
  { key: "communication", label: "소통력" },
  { key: "trust", label: "신뢰도" },
  { key: "positivity", label: "긍정성" },
  { key: "contribution", label: "관계 기여도" },
  { key: "spamRisk", label: "스팸 위험도" },
];

function syncTone(status: DailyTalkReward["ontologySyncStatus"], colors: ReturnType<typeof useColors>) {
  if (status === "processed") return { backgroundColor: "#16A34A22", borderColor: "#16A34A44", color: "#16A34A" };
  if (status === "processing") return { backgroundColor: `${colors.primary}18`, borderColor: `${colors.primary}44`, color: colors.primary };
  if (status === "pending" || status === "retrying") return { backgroundColor: "#F59E0B22", borderColor: "#F59E0B44", color: "#D97706" };
  if (status === "failed") return { backgroundColor: `${colors.destructive}18`, borderColor: `${colors.destructive}44`, color: colors.destructive };
  return { backgroundColor: colors.muted, borderColor: colors.border, color: colors.mutedForeground };
}

function errorMessage(err: unknown, fallback: string): string {
  const data = (err as { data?: { message?: string } } | null)?.data;
  return data?.message ?? fallback;
}

export default function DailyTalkRewardPreviewScreen() {
  const router = useRouter();
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { id } = useLocalSearchParams<{ id: string }>();
  const rewardId = Array.isArray(id) ? id[0] : id;
  const { data: reward, isLoading, isError, refetch } = useDailyTalkReward(rewardId);
  const updateReward = useUpdateDailyTalkReward();
  const saveReward = useSaveDailyTalkReward();
  const postReward = usePostDailyTalkRewardToFeed();

  const [title, setTitle] = React.useState("");
  const [diary, setDiary] = React.useState("");
  const [visibility, setVisibility] = React.useState<DailyTalkRewardVisibility>("PRIVATE");
  const [feedback, setFeedback] = React.useState<string | null>(null);
  const [result, setResult] = React.useState<DailyTalkReward | null>(null);

  React.useEffect(() => {
    if (!reward) return;
    setTitle(reward.title);
    setDiary(reward.diary);
    setVisibility(reward.visibility ?? "PRIVATE");
  }, [reward]);

  const isDone = !!reward?.rewardedAt;
  const isSubmitting = updateReward.isPending || saveReward.isPending || postReward.isPending;
  const rewardSyncTone = reward ? syncTone(reward.ontologySyncStatus, colors) : null;

  async function persistDraft(nextVisibility = visibility) {
    if (!rewardId) throw new Error("missing reward id");
    return updateReward.mutateAsync({ id: rewardId, title, diary, visibility: nextVisibility });
  }

  async function savePrivate() {
    if (!rewardId || isSubmitting) return;
    setFeedback(null);
    try {
      await persistDraft("PRIVATE");
      const saved = await saveReward.mutateAsync(rewardId);
      setResult(saved);
    } catch (err) {
      setFeedback(errorMessage(err, "저장 또는 STAR Point 지급에 실패했어요."));
    }
  }

  async function postToFeed() {
    if (!rewardId || isSubmitting) return;
    setFeedback(null);
    try {
      await persistDraft(visibility);
      const posted = await postReward.mutateAsync(rewardId);
      setResult(posted);
    } catch (err) {
      setFeedback(errorMessage(err, "피드 업로드 또는 STAR Point 지급에 실패했어요."));
    }
  }

  if (isLoading) {
    return (
      <View style={[styles.stateContainer, { backgroundColor: colors.background }]}>
        <ActivityIndicator color={colors.primary} />
        <Text style={[styles.stateText, { color: colors.mutedForeground }]}>일기를 불러오는 중이에요.</Text>
      </View>
    );
  }

  if (isError || !reward) {
    return (
      <View style={[styles.stateContainer, { backgroundColor: colors.background }]}>
        <Text style={[styles.stateTitle, { color: colors.foreground }]}>일기를 불러오지 못했어요</Text>
        <Pressable onPress={() => void refetch()} style={[styles.primaryButton, { backgroundColor: colors.primary }]}>
          <Text style={[styles.primaryButtonText, { color: colors.primaryForeground }]}>다시 시도</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <CustomScrollView contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 120 }}>
        <View style={[styles.hero, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Text style={[styles.kicker, { color: colors.primary }]}>오늘의 대화 일기</Text>
          <Text style={[styles.heroTitle, { color: colors.foreground }]}>대화 품질 점수는 {reward.qualityScore}점이에요.</Text>
          <Text style={[styles.heroBody, { color: colors.mutedForeground }]}>예상 리워드는 {reward.pvtAmount} STAR Point이며, 수령 시 DavaQ 동기화에 반영돼요.</Text>
          <View style={styles.heroPills}>
            <View style={[styles.pill, { backgroundColor: colors.muted }]}>
              <Feather name="smile" size={14} color={colors.primary} />
              <Text style={[styles.pillText, { color: colors.foreground }]}>{reward.mood}</Text>
            </View>
            <View style={[styles.pill, { backgroundColor: colors.muted }]}>
              <Feather name="award" size={14} color={colors.primary} />
              <Text style={[styles.pillText, { color: colors.foreground }]}>Grade {reward.grade}</Text>
            </View>
          </View>
        </View>

        <View style={[styles.section, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Text style={[styles.sectionTitle, { color: colors.foreground }]}>오늘의 제목</Text>
          <TextInput value={title} onChangeText={setTitle} editable={!isDone} maxLength={80} style={[styles.titleInput, { color: colors.foreground, borderColor: colors.border, backgroundColor: colors.input }]} />
          <Text style={[styles.sectionTitle, { color: colors.foreground }]}>AI 일기 본문</Text>
          <TextInput
            value={diary}
            onChangeText={setDiary}
            editable={!isDone}
            multiline
            maxLength={1200}
            textAlignVertical="top"
            style={[styles.diaryInput, { color: colors.foreground, borderColor: colors.border, backgroundColor: colors.input }]}
          />
        </View>

        <View style={[styles.section, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Text style={[styles.sectionTitle, { color: colors.foreground }]}>오늘의 키워드</Text>
          <View style={styles.keywordRow}>
            {reward.keywords.map((keyword) => (
              <View key={keyword} style={[styles.keywordPill, { backgroundColor: colors.muted }]}>
                <Text style={[styles.keywordText, { color: colors.primary }]}>{keyword}</Text>
              </View>
            ))}
          </View>
          <Text style={[styles.summaryText, { color: colors.mutedForeground }]}>{reward.summary}</Text>
        </View>

        {rewardSyncTone ? (
          <View style={[styles.section, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <View style={styles.syncHeaderRow}>
              <Text style={[styles.sectionTitle, { color: colors.foreground }]}>DavaQ 동기화</Text>
              <View style={[styles.syncBadge, { backgroundColor: rewardSyncTone.backgroundColor, borderColor: rewardSyncTone.borderColor }]}>
                <Feather name={reward.ontologySyncStatus === "processed" ? "check-circle" : "refresh-cw"} size={13} color={rewardSyncTone.color} />
                <Text style={[styles.syncBadgeText, { color: rewardSyncTone.color }]}>{dailyTalkRewardSyncLabel(reward.ontologySyncStatus)}</Text>
              </View>
            </View>
            <Text style={[styles.notice, { color: colors.mutedForeground }]}>{dailyTalkRewardSyncDescription(reward.ontologySyncStatus)}</Text>
            {reward.ontologySyncedAt ? (
              <Text style={[styles.syncTime, { color: colors.mutedForeground }]}>반영 시각 {new Date(reward.ontologySyncedAt).toLocaleString("ko-KR")}</Text>
            ) : null}
          </View>
        ) : null}

        <View style={[styles.section, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Text style={[styles.sectionTitle, { color: colors.foreground }]}>세부 평가</Text>
          {SCORE_META.map(({ key, label }) => {
            const value = reward.scores[key];
            return (
              <View key={key} style={styles.scoreRow}>
                <Text style={[styles.scoreLabel, { color: colors.mutedForeground }]}>{label}</Text>
                <View style={[styles.scoreTrack, { backgroundColor: colors.muted }]}>
                  <View style={[styles.scoreFill, { width: `${Math.min(100, value)}%`, backgroundColor: key === "spamRisk" ? colors.destructive : colors.primary }]} />
                </View>
                <Text style={[styles.scoreValue, { color: colors.foreground }]}>{value}</Text>
              </View>
            );
          })}
        </View>

        <View style={[styles.section, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Text style={[styles.sectionTitle, { color: colors.foreground }]}>공개 범위</Text>
          <Text style={[styles.notice, { color: colors.mutedForeground }]}>기본값은 나만 보기입니다. 원문 채팅은 저장하지 않고, 요약/키워드/평가 점수만 DavaQ 동기화 데이터로 반영돼요.</Text>
          <View style={styles.visibilityList}>
            {VISIBILITIES.map((item) => {
              const active = visibility === item.value;
              return (
                <Pressable key={item.value} disabled={isDone} onPress={() => setVisibility(item.value)} style={[styles.visibilityOption, { borderColor: active ? colors.primary : colors.border, backgroundColor: active ? colors.accent : colors.input }]}>
                  <Text style={[styles.visibilityLabel, { color: colors.foreground }]}>{item.label}</Text>
                  <Text style={[styles.visibilityDesc, { color: colors.mutedForeground }]}>{item.description}</Text>
                </Pressable>
              );
            })}
          </View>
        </View>

        {feedback ? <Text style={[styles.feedback, { color: colors.destructive }]}>{feedback}</Text> : null}

        <View style={styles.bottomActions}>
          <Pressable disabled={isDone || isSubmitting} onPress={savePrivate} style={[styles.secondaryButton, { borderColor: colors.border, opacity: isDone || isSubmitting ? 0.55 : 1 }]}>
            <Text style={[styles.secondaryButtonText, { color: colors.foreground }]}>나만 보기로 STAR Point 받고 동기화</Text>
          </Pressable>
          <Pressable disabled={isDone || isSubmitting} onPress={postToFeed} style={[styles.primaryButton, { backgroundColor: colors.primary, opacity: isDone || isSubmitting ? 0.55 : 1 }]}>
            {isSubmitting ? <ActivityIndicator size="small" color={colors.primaryForeground} /> : null}
            <Text style={[styles.primaryButtonText, { color: colors.primaryForeground }]}>{isDone ? "리워드 완료" : "피드에 올리고 STAR Point+동기화"}</Text>
          </Pressable>
        </View>
      </CustomScrollView>

      <Modal visible={!!result} transparent animationType="fade" onRequestClose={() => setResult(null)}>
        <View style={styles.modalBackdrop}>
          <View style={[styles.modalCard, { backgroundColor: colors.card }]}>
            <Text style={[styles.modalTitle, { color: colors.foreground }]}>오늘의 톡 리워드 완료!</Text>
            <Text style={[styles.modalBody, { color: colors.mutedForeground }]}>대화 품질 점수: {result?.qualityScore ?? 0}점</Text>
            <Text style={[styles.modalReward, { color: colors.primary }]}>{result?.pvtAmount ?? 0} STAR Point를 획득했습니다.</Text>
            <Text style={[styles.modalBody, { color: colors.mutedForeground }]}>동기화 요청이 접수됐어요. 곧 DavaQ에 반영돼요.</Text>
            <View style={styles.modalActions}>
              <Pressable onPress={() => setResult(null)} style={[styles.modalButton, { backgroundColor: colors.muted }]}>
                <Text style={[styles.modalButtonText, { color: colors.foreground }]}>확인</Text>
              </Pressable>
                <Pressable onPress={() => { setResult(null); router.push("/pvt/wallet" as never); }} style={[styles.modalButton, { backgroundColor: colors.primary }]}>
                <Text style={[styles.modalButtonText, { color: colors.primaryForeground }]}>내 STAR Point 보기</Text>
              </Pressable>
              {result?.feedPostId ? (
                <Pressable onPress={() => { setResult(null); router.push("/(tabs)/feed" as never); }} style={[styles.modalButton, { backgroundColor: colors.primary }]}>
                  <Text style={[styles.modalButtonText, { color: colors.primaryForeground }]}>피드 보러가기</Text>
                </Pressable>
              ) : null}
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  stateContainer: { alignItems: "center", flex: 1, gap: 12, justifyContent: "center", padding: 24 },
  stateTitle: { fontFamily: "Inter_700Bold", fontSize: 18 },
  stateText: { fontFamily: "Inter_500Medium", fontSize: 14 },
  hero: { borderRadius: 22, borderWidth: StyleSheet.hairlineWidth, gap: 8, padding: 18 },
  kicker: { fontFamily: "Inter_700Bold", fontSize: 11, letterSpacing: 1.1 },
  heroTitle: { fontFamily: "Inter_700Bold", fontSize: 22, letterSpacing: -0.5 },
  heroBody: { fontFamily: "Inter_500Medium", fontSize: 14 },
  heroPills: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 4 },
  pill: { alignItems: "center", borderRadius: 999, flexDirection: "row", gap: 5, paddingHorizontal: 10, paddingVertical: 7 },
  pillText: { fontFamily: "Inter_700Bold", fontSize: 12 },
  section: { borderRadius: 20, borderWidth: StyleSheet.hairlineWidth, gap: 12, marginTop: 12, padding: 16 },
  sectionTitle: { fontFamily: "Inter_700Bold", fontSize: 15 },
  titleInput: { borderRadius: 14, borderWidth: StyleSheet.hairlineWidth, fontFamily: "Inter_700Bold", fontSize: 16, padding: 12 },
  diaryInput: { borderRadius: 14, borderWidth: StyleSheet.hairlineWidth, fontFamily: "Inter_400Regular", fontSize: 14, lineHeight: 21, minHeight: 220, padding: 12 },
  keywordRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  keywordPill: { borderRadius: 999, paddingHorizontal: 10, paddingVertical: 7 },
  keywordText: { fontFamily: "Inter_700Bold", fontSize: 12 },
  summaryText: { fontFamily: "Inter_400Regular", fontSize: 13, lineHeight: 19 },
  syncHeaderRow: { alignItems: "center", flexDirection: "row", gap: 10, justifyContent: "space-between" },
  syncBadge: { alignItems: "center", borderRadius: 999, borderWidth: StyleSheet.hairlineWidth, flexDirection: "row", gap: 5, paddingHorizontal: 9, paddingVertical: 6 },
  syncBadgeText: { fontFamily: "Inter_700Bold", fontSize: 11 },
  syncTime: { fontFamily: "Inter_500Medium", fontSize: 11 },
  scoreRow: { alignItems: "center", flexDirection: "row", gap: 10 },
  scoreLabel: { fontFamily: "Inter_600SemiBold", fontSize: 12, width: 78 },
  scoreTrack: { borderRadius: 999, flex: 1, height: 8, overflow: "hidden" },
  scoreFill: { height: "100%" },
  scoreValue: { fontFamily: "Inter_700Bold", fontSize: 12, textAlign: "right", width: 34 },
  notice: { fontFamily: "Inter_400Regular", fontSize: 12, lineHeight: 17 },
  visibilityList: { gap: 8 },
  visibilityOption: { borderRadius: 14, borderWidth: StyleSheet.hairlineWidth, gap: 2, padding: 12 },
  visibilityLabel: { fontFamily: "Inter_700Bold", fontSize: 14 },
  visibilityDesc: { fontFamily: "Inter_400Regular", fontSize: 12 },
  feedback: { fontFamily: "Inter_600SemiBold", fontSize: 13, marginTop: 12 },
  bottomActions: { gap: 10, marginTop: 14 },
  primaryButton: { alignItems: "center", borderRadius: 16, flexDirection: "row", gap: 8, justifyContent: "center", minHeight: 50, paddingHorizontal: 14 },
  primaryButtonText: { fontFamily: "Inter_700Bold", fontSize: 14, textAlign: "center" },
  secondaryButton: { alignItems: "center", borderRadius: 16, borderWidth: StyleSheet.hairlineWidth, justifyContent: "center", minHeight: 50, paddingHorizontal: 14 },
  secondaryButtonText: { fontFamily: "Inter_700Bold", fontSize: 14, textAlign: "center" },
  modalBackdrop: { alignItems: "center", backgroundColor: "rgba(0,0,0,0.45)", flex: 1, justifyContent: "center", padding: 22 },
  modalCard: { borderRadius: 24, gap: 10, padding: 20, width: "100%" },
  modalTitle: { fontFamily: "Inter_700Bold", fontSize: 20, textAlign: "center" },
  modalBody: { fontFamily: "Inter_500Medium", fontSize: 14, lineHeight: 20, textAlign: "center" },
  modalReward: { fontFamily: "Inter_700Bold", fontSize: 24, textAlign: "center" },
  modalActions: { gap: 8, marginTop: 6 },
  modalButton: { alignItems: "center", borderRadius: 14, paddingVertical: 12 },
  modalButtonText: { fontFamily: "Inter_700Bold", fontSize: 14 },
});
