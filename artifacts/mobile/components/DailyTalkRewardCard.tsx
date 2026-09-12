import { Feather } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import React from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import { useColors } from "@/hooks/useColors";
import { useDailyTalkRewardStatus } from "@/hooks/useDailyTalkReward";
import { usePvtWallet } from "@/hooks/usePvtWallet";

interface Props {
  onClaim: () => void;
  onOpenDraft: (id: string) => void;
  onOpenWallet: () => void;
  onOpenHistory: () => void;
}

function reasonText(reason: string | null | undefined): string {
  if (reason === "claimed") {
    return "오늘의 톡 리워드를 이미 받았어요. 내일 다시 새로운 일기와 DavaQ 동기화를 받을 수 있어요.";
  }
  if (reason === "analysis_disabled") {
    return "대화 분석이 꺼져 있어요. 설정에서 다시 켜면 톡 리워드를 받을 수 있어요.";
  }
  if (reason === "insufficient_counterparts") {
    return "실제 대화 상대가 아직 부족해요. 친구와 조금 더 대화한 뒤 리워드를 받을 수 있어요.";
  }
  return "아직 분석할 대화가 부족해요. 조금 더 대화한 뒤 오늘의 톡 리워드를 받을 수 있어요.";
}

export function DailyTalkRewardCard({ onClaim, onOpenDraft, onOpenWallet, onOpenHistory }: Props) {
  const colors = useColors();
  const { data: status, isLoading, isError, refetch } = useDailyTalkRewardStatus();
  const { data: wallet } = usePvtWallet();
  const [expanded, setExpanded] = React.useState(false);
  const hasDraft = !!status?.rewardId && !status.claimedToday && status.status === "GENERATED";
  const progress = status ? Math.min(1, status.messageCount / Math.max(1, status.minMessageCount)) : 0;
  const canPress = !!status && (status.canClaim || hasDraft);
  const canCollapseDetails = !!status && !isError;
  const showDetails = !canCollapseDetails || expanded;

  const title = status?.claimedToday
    ? "오늘의 톡 리워드 완료"
    : status?.canClaim || hasDraft
      ? "오늘의 톡 리워드가 도착했어요"
      : "대화를 더 쌓아볼까요?";
  const description = status?.canClaim || hasDraft
    ? "AI가 오늘의 대화를 요약하고, 보상 수령 시 DavaQ 동기화 데이터로 반영해요."
    : reasonText(status?.reason);
  const buttonLabel = hasDraft ? "일기 확인하기" : status?.claimedToday ? "내 STAR Point 보기" : "STAR Point 받고 동기화";

  function handlePress() {
    if (hasDraft && status?.rewardId) {
      onOpenDraft(status.rewardId);
      return;
    }
    if (status?.claimedToday) {
      onOpenWallet();
      return;
    }
    onClaim();
  }

  return (
    <LinearGradient colors={["#20124D", "#5236A4", "#6D4BFF"]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.card}>
      <View style={styles.headerRow}>
        <View style={styles.iconBubble}>
          <Feather name="message-circle" size={20} color="#FFFFFF" />
        </View>
        <View style={styles.titleBlock}>
          <Text style={styles.kicker}>Talk to Earn</Text>
          <Text style={styles.title}>{title}</Text>
        </View>
        <Pressable onPress={onOpenWallet} style={styles.walletPill}>
          <Feather name="database" size={13} color="#FDE68A" />
          <Text style={styles.walletText}>{(wallet?.balance ?? 0).toLocaleString()} STAR Point</Text>
        </Pressable>
      </View>

      <Text style={styles.copy}>오늘 대화 요약을 제공하고 STAR Point와 DavaQ 동기화를 받습니다.</Text>

      {canCollapseDetails ? (
        <Pressable onPress={() => setExpanded((value) => !value)} style={styles.expandButton}>
          <Text style={styles.expandText}>{expanded ? "접기" : "자세히 보기"}</Text>
          <Feather name={expanded ? "chevron-up" : "chevron-down"} size={15} color="#FFFFFF" />
        </Pressable>
      ) : null}

      {showDetails ? (
        <>
          <Text style={styles.description}>{isError ? "오늘의 톡 리워드를 불러오지 못했어요." : description}</Text>

          <View style={styles.metricsRow}>
            <View style={styles.metricBox}>
              <Text style={styles.metricLabel}>분석 메시지</Text>
              <Text style={styles.metricValue}>{status ? `${status.messageCount}/${status.minMessageCount}` : "-"}</Text>
            </View>
            <View style={styles.metricBox}>
              <Text style={styles.metricLabel}>연속 청구</Text>
              <Text style={styles.metricValue}>{status ? `${status.streak}일` : "-"}</Text>
            </View>
          </View>

          <View style={styles.progressTrack}>
            <View style={[styles.progressFill, { width: `${progress * 100}%` }]} />
          </View>

          <View style={styles.actionsRow}>
            <Pressable
              disabled={isLoading || (!canPress && !isError)}
              onPress={isError ? () => void refetch() : handlePress}
              style={({ pressed }) => [
                styles.primaryButton,
                { opacity: pressed ? 0.78 : isLoading || (!canPress && !isError) ? 0.55 : 1 },
              ]}
            >
              {isLoading ? <ActivityIndicator size="small" color="#20124D" /> : null}
              <Text style={styles.primaryButtonText}>{isError ? "다시 불러오기" : buttonLabel}</Text>
              <Feather name="arrow-right" size={15} color="#20124D" />
            </Pressable>
            <Pressable onPress={onOpenHistory} style={styles.historyButton}>
              <Text style={[styles.hintText, { color: colors.primaryForeground }]}>히스토리</Text>
              <Feather name="chevron-right" size={13} color="#FFFFFF" />
            </Pressable>
          </View>
        </>
      ) : null}
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: 26,
    gap: 12,
    marginBottom: 16,
    overflow: "hidden",
    padding: 18,
  },
  headerRow: { alignItems: "center", flexDirection: "row", gap: 12 },
  iconBubble: {
    alignItems: "center",
    backgroundColor: "rgba(255,255,255,0.16)",
    borderRadius: 16,
    height: 46,
    justifyContent: "center",
    width: 46,
  },
  titleBlock: { flex: 1, gap: 2 },
  kicker: { color: "#C4B5FD", fontFamily: "Inter_700Bold", fontSize: 11, letterSpacing: 1.1 },
  title: { color: "#FFFFFF", fontFamily: "Inter_700Bold", fontSize: 18, letterSpacing: -0.3 },
  walletPill: {
    alignItems: "center",
    backgroundColor: "rgba(255,255,255,0.14)",
    borderRadius: 999,
    flexDirection: "row",
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 7,
  },
  walletText: { color: "#FFFFFF", fontFamily: "Inter_700Bold", fontSize: 12 },
  copy: { color: "#FDE68A", fontFamily: "Inter_700Bold", fontSize: 14, lineHeight: 20 },
  description: { color: "#EDE9FE", fontFamily: "Inter_500Medium", fontSize: 13, lineHeight: 19 },
  expandButton: { alignItems: "center", alignSelf: "flex-start", flexDirection: "row", gap: 4, paddingVertical: 2 },
  expandText: { color: "#FFFFFF", fontFamily: "Inter_700Bold", fontSize: 12 },
  metricsRow: { flexDirection: "row", gap: 10 },
  metricBox: {
    backgroundColor: "rgba(255,255,255,0.12)",
    borderRadius: 16,
    flex: 1,
    gap: 3,
    padding: 12,
  },
  metricLabel: { color: "#C4B5FD", fontFamily: "Inter_600SemiBold", fontSize: 11 },
  metricValue: { color: "#FFFFFF", fontFamily: "Inter_700Bold", fontSize: 18 },
  progressTrack: { backgroundColor: "rgba(255,255,255,0.16)", borderRadius: 999, height: 8, overflow: "hidden" },
  progressFill: { backgroundColor: "#FDE68A", height: "100%" },
  actionsRow: { alignItems: "center", flexDirection: "row", gap: 10 },
  primaryButton: {
    alignItems: "center",
    backgroundColor: "#FDE68A",
    borderRadius: 999,
    flexDirection: "row",
    gap: 7,
    minHeight: 42,
    paddingHorizontal: 14,
  },
  primaryButtonText: { color: "#20124D", fontFamily: "Inter_700Bold", fontSize: 13 },
  historyButton: { alignItems: "center", flexDirection: "row", gap: 2, marginLeft: "auto" },
  hintText: { fontFamily: "Inter_600SemiBold", fontSize: 11, opacity: 0.82 },
});
