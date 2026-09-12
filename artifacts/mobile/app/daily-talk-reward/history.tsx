import { Feather } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import React from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { CustomScrollView } from "@/components/CustomScroll";
import { useColors } from "@/hooks/useColors";
import { dailyTalkRewardSyncLabel, useDailyTalkRewardHistory, type DailyTalkReward } from "@/hooks/useDailyTalkReward";

function formatDate(value: string) {
  const date = new Date(`${value}T00:00:00+09:00`);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString("ko-KR", { month: "long", day: "numeric", weekday: "short" });
}

function syncTone(status: DailyTalkReward["ontologySyncStatus"], colors: ReturnType<typeof useColors>) {
  if (status === "processed") return { backgroundColor: "#16A34A22", borderColor: "#16A34A44", color: "#16A34A" };
  if (status === "processing") return { backgroundColor: `${colors.primary}18`, borderColor: `${colors.primary}44`, color: colors.primary };
  if (status === "pending" || status === "retrying") return { backgroundColor: "#F59E0B22", borderColor: "#F59E0B44", color: "#D97706" };
  if (status === "failed") return { backgroundColor: `${colors.destructive}18`, borderColor: `${colors.destructive}44`, color: colors.destructive };
  return { backgroundColor: colors.muted, borderColor: colors.border, color: colors.mutedForeground };
}

export default function DailyTalkRewardHistoryScreen() {
  const router = useRouter();
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { data: history = [], isLoading, isError, refetch } = useDailyTalkRewardHistory();

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <CustomScrollView contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 90 }}>
        <View style={styles.headerBlock}>
          <Text style={[styles.kicker, { color: colors.primary }]}>Talk to Earn</Text>
          <Text style={[styles.title, { color: colors.foreground }]}>톡 리워드 히스토리</Text>
          <Text style={[styles.subtitle, { color: colors.mutedForeground }]}>AI가 정리한 하루 대화 일기, STAR Point 지급 기록, DavaQ 동기화 기록입니다.</Text>
        </View>

        {isLoading ? (
          <View style={styles.stateBox}>
            <ActivityIndicator color={colors.primary} />
            <Text style={[styles.stateText, { color: colors.mutedForeground }]}>히스토리를 불러오는 중이에요.</Text>
          </View>
        ) : isError ? (
          <Pressable onPress={() => void refetch()} style={[styles.stateBox, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Text style={[styles.stateTitle, { color: colors.foreground }]}>불러오지 못했어요</Text>
            <Text style={[styles.stateText, { color: colors.mutedForeground }]}>눌러서 다시 시도해 주세요.</Text>
          </Pressable>
        ) : history.length === 0 ? (
          <View style={[styles.stateBox, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Text style={[styles.stateTitle, { color: colors.foreground }]}>아직 기록이 없어요</Text>
            <Text style={[styles.stateText, { color: colors.mutedForeground }]}>오늘 대화 후 첫 톡 리워드를 받아보세요.</Text>
          </View>
        ) : (
          history.map((item) => {
            const tone = syncTone(item.ontologySyncStatus, colors);
            return (
              <Pressable key={item.id} onPress={() => router.push(`/daily-talk-reward/${item.id}` as never)} style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
                <View style={styles.cardTop}>
                  <View style={[styles.icon, { backgroundColor: colors.accent }]}>
                    <Feather name="book-open" size={17} color={colors.primary} />
                  </View>
                  <View style={styles.cardTitleBlock}>
                    <Text style={[styles.cardDate, { color: colors.mutedForeground }]}>{formatDate(item.rewardDate)}</Text>
                    <Text style={[styles.cardTitle, { color: colors.foreground }]} numberOfLines={1}>{item.title}</Text>
                  </View>
                  <Text style={[styles.pvtText, { color: colors.primary }]}>{item.pvtAmount} STAR Point</Text>
                </View>
                <Text style={[styles.cardBody, { color: colors.mutedForeground }]} numberOfLines={2}>{item.summary || item.diary}</Text>
                <View style={styles.metaRow}>
                  <Text style={[styles.metaText, { color: colors.mutedForeground }]}>품질 {item.qualityScore}점</Text>
                  <Text style={[styles.metaText, { color: colors.mutedForeground }]}>{item.mood}</Text>
                  <Text style={[styles.metaText, { color: colors.mutedForeground }]}>{item.visibility === "PRIVATE" ? "나만 보기" : item.visibility === "FRIENDS" ? "친구 공개" : "전체 공개"}</Text>
                </View>
                <View style={[styles.syncBadge, { backgroundColor: tone.backgroundColor, borderColor: tone.borderColor }]}>
                  <Feather name={item.ontologySyncStatus === "processed" ? "check-circle" : "refresh-cw"} size={13} color={tone.color} />
                  <Text style={[styles.syncBadgeText, { color: tone.color }]}>{dailyTalkRewardSyncLabel(item.ontologySyncStatus)}</Text>
                </View>
              </Pressable>
            );
          })
        )}
      </CustomScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  headerBlock: { gap: 5, marginBottom: 14 },
  kicker: { fontFamily: "Inter_700Bold", fontSize: 11, letterSpacing: 1.1 },
  title: { fontFamily: "Inter_700Bold", fontSize: 26, letterSpacing: -0.6 },
  subtitle: { fontFamily: "Inter_400Regular", fontSize: 13, lineHeight: 19 },
  stateBox: { alignItems: "center", borderRadius: 18, borderWidth: StyleSheet.hairlineWidth, gap: 8, padding: 20 },
  stateTitle: { fontFamily: "Inter_700Bold", fontSize: 15 },
  stateText: { fontFamily: "Inter_400Regular", fontSize: 13, textAlign: "center" },
  card: { borderRadius: 18, borderWidth: StyleSheet.hairlineWidth, gap: 10, marginBottom: 10, padding: 14 },
  cardTop: { alignItems: "center", flexDirection: "row", gap: 10 },
  icon: { alignItems: "center", borderRadius: 14, height: 40, justifyContent: "center", width: 40 },
  cardTitleBlock: { flex: 1, gap: 2 },
  cardDate: { fontFamily: "Inter_500Medium", fontSize: 11 },
  cardTitle: { fontFamily: "Inter_700Bold", fontSize: 15 },
  pvtText: { fontFamily: "Inter_700Bold", fontSize: 13 },
  cardBody: { fontFamily: "Inter_400Regular", fontSize: 13, lineHeight: 19 },
  metaRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  metaText: { fontFamily: "Inter_600SemiBold", fontSize: 11 },
  syncBadge: { alignItems: "center", alignSelf: "flex-start", borderRadius: 999, borderWidth: StyleSheet.hairlineWidth, flexDirection: "row", gap: 5, paddingHorizontal: 9, paddingVertical: 6 },
  syncBadgeText: { fontFamily: "Inter_700Bold", fontSize: 11 },
});
