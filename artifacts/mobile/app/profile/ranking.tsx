import { CustomScrollView } from "@/components/CustomScroll";
import { useRouter } from "expo-router";
import React from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { Feather } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useQuery } from "@tanstack/react-query";
import { customFetch, useGetMe } from "@workspace/api-client-react";
import { Avatar } from "@/components/Avatar";
import { useColors } from "@/hooks/useColors";
import { useThemeMode } from "@/hooks/useThemeMode";
import { gradients, gradientsDark } from "@/constants/colors";

type RankingScope = "persona" | "fan" | "star" | "battle";
type ArchetypeKey =
  | "strategist"
  | "harmonizer"
  | "explorer"
  | "pioneer"
  | "sage"
  | "entertainer"
  | "activist"
  | "observer";

interface ServiceRankingItem {
  id: string;
  rank: number;
  userId: string;
  displayName: string;
  avatarUrl: string | null;
  level: number;
  title: string;
  subTitle: string;
  badgeLabel: string;
  score: number;
  primaryStatLabel: string;
  primaryStatValue: number;
}

interface ServiceRankingResult {
  scope: RankingScope;
  type: string;
  archetype: ArchetypeKey | null;
  items: ServiceRankingItem[];
  myRank: {
    rank: number;
    score: number;
    pointsToNextRank: number;
  } | null;
}

const SCOPE_TABS: { key: RankingScope; label: string; subtitle: string; icon: keyof typeof Feather.glyphMap }[] = [
  { key: "fan", label: "FAN", subtitle: "응원 성장", icon: "heart" },
  { key: "star", label: "STAR", subtitle: "NFT 캐릭터", icon: "star" },
  { key: "battle", label: "배틀", subtitle: "Talk Point", icon: "mic" },
];

const METRICS: Record<RankingScope, { key: string; label: string }[]> = {
  persona: [
    { key: "overall", label: "종합" },
    { key: "persuasion", label: "설득" },
    { key: "logic", label: "논리" },
    { key: "empathy", label: "공감" },
    { key: "strategy", label: "전략" },
    { key: "archetype", label: "아키타입" },
  ],
  fan: [
    { key: "overall", label: "종합" },
    { key: "fan_power", label: "매력" },
    { key: "support_power", label: "응원력" },
    { key: "empathy", label: "유대감" },
    { key: "story", label: "영향력" },
  ],
  star: [
    { key: "overall", label: "종합" },
    { key: "charm", label: "매력" },
    { key: "stage_presence", label: "스타성" },
    { key: "bond", label: "유대감" },
    { key: "lore", label: "영향력" },
  ],
  battle: [
    { key: "overall", label: "TP" },
    { key: "wins", label: "승리" },
    { key: "win_rate", label: "승률" },
    { key: "streak", label: "연승" },
  ],
};

const ARCHETYPES: { key: ArchetypeKey; label: string }[] = [
  { key: "strategist", label: "전략가형" },
  { key: "harmonizer", label: "조율자형" },
  { key: "explorer", label: "탐험가형" },
  { key: "pioneer", label: "개척자형" },
  { key: "sage", label: "현자형" },
  { key: "entertainer", label: "재담꾼형" },
  { key: "activist", label: "행동가형" },
  { key: "observer", label: "관찰자형" },
];

const MEDAL_COLORS: Record<number, string> = {
  1: "#F5B301",
  2: "#A8B0BD",
  3: "#CD7F32",
};

const SCOPE_COPY: Record<RankingScope, { title: string; subtitle: string; empty: string; cta: string }> = {
  persona: {
    title: "DavaQ 랭킹",
    subtitle: "자아 동기화, 말하기, 선택의 누적 기록을 확인해보세요.",
    empty: "토크배틀을 플레이하거나 활동 기록을 쌓아 랭킹에 도전해보세요.",
    cta: "토크배틀 하러가기",
  },
  fan: {
    title: "FAN 랭킹",
    subtitle: "응원력과 팬 활동으로 성장한 FAN 지표를 비교해보세요.",
    empty: "토크배틀 결과와 응원 활동으로 FAN XP를 쌓아보세요.",
    cta: "토크배틀 하러가기",
  },
  star: {
    title: "STAR 랭킹",
    subtitle: "연습생 STAR와 공식 STAR의 캐릭터 성장을 확인해보세요.",
    empty: "STAR NFT를 장착하고 STAR 미션을 플레이하면 랭킹에 표시돼요.",
    cta: "STAR 미션 가기",
  },
  battle: {
    title: "토크배틀 랭킹",
    subtitle: "Talk Point, 승률, 연승 기록으로 실력을 비교해보세요.",
    empty: "첫 토크배틀을 끝내면 TP 랭킹에 표시돼요.",
    cta: "토크배틀 하러가기",
  },
};

function metricForScope(scope: RankingScope, metric: string): string {
  return METRICS[scope].some((item) => item.key === metric) ? metric : "overall";
}

function formatScore(score: number, scope: RankingScope, metric: string): string {
  if (scope === "battle" && metric === "win_rate") return `${Math.round(score / 10)}%`;
  return score.toLocaleString();
}

function formatGap(score: number, scope: RankingScope, metric: string): string {
  if (scope === "battle" && metric === "win_rate") return `${Math.round(score / 10)}%p`;
  return `${score.toLocaleString()}점`;
}

function formatPrimaryValue(item: ServiceRankingItem, scope: RankingScope, metric: string): string {
  if (scope === "battle" && metric === "win_rate") return `${item.primaryStatValue}%`;
  return item.primaryStatValue.toLocaleString();
}

export default function RankingScreen() {
  const router = useRouter();
  const colors = useColors();
  const { scheme } = useThemeMode();
  const isDark = scheme === "dark";
  const insets = useSafeAreaInsets();

  const [scope, setScope] = React.useState<RankingScope>("fan");
  const [metric, setMetric] = React.useState("overall");
  const [archetype, setArchetype] = React.useState<ArchetypeKey>("strategist");

  const activeMetric = metricForScope(scope, metric);
  const copy = SCOPE_COPY[scope];

  const { data: me } = useGetMe();
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ["service-rankings", scope, activeMetric, archetype],
    queryFn: () => {
      const params = new URLSearchParams({ scope, type: activeMetric, limit: "100" });
      if (scope === "persona" && activeMetric === "archetype") params.set("archetype", archetype);
      return customFetch<ServiceRankingResult>(`/api/users/rankings?${params.toString()}`, {
        responseType: "json",
      });
    },
  });

  const items = data?.items ?? [];
  const myRank = data?.myRank ?? null;
  const isEmpty = !isLoading && !isError && items.length === 0;

  const goToPrimaryAction = () => {
    if (scope === "star") router.push("/(tabs)/dungeon");
    else router.push({ pathname: "/battle/create", params: { mode: "ai" } });
  };

  return (
    <View style={[styles.container, { backgroundColor: colors.muted }]}>
      <CustomScrollView contentContainerStyle={{ paddingBottom: insets.bottom + 32 }}>
        <LinearGradient
          colors={(isDark ? gradientsDark : gradients).soft}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={styles.hero}
        >
          <Text style={[styles.heroTitle, { color: colors.foreground }]}>{copy.title}</Text>
          <Text style={[styles.heroSubtitle, { color: colors.mutedForeground }]}>{copy.subtitle}</Text>
        </LinearGradient>

        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.scopeRow}>
          {SCOPE_TABS.map((item) => {
            const active = scope === item.key;
            return (
              <Pressable
                key={item.key}
                onPress={() => setScope(item.key)}
                style={[
                  styles.scopeChip,
                  {
                    backgroundColor: active ? colors.foreground : colors.background,
                    borderColor: active ? colors.foreground : colors.border,
                  },
                ]}
              >
                <Feather name={item.icon} size={15} color={active ? colors.background : colors.primary} />
                <View>
                  <Text style={[styles.scopeLabel, { color: active ? colors.background : colors.foreground }]}>
                    {item.label}
                  </Text>
                  <Text style={[styles.scopeSub, { color: active ? colors.background : colors.mutedForeground }]}>
                    {item.subtitle}
                  </Text>
                </View>
              </Pressable>
            );
          })}
        </ScrollView>

        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.tabRow}>
          {METRICS[scope].map((item) => {
            const active = activeMetric === item.key;
            return (
              <Pressable
                key={item.key}
                onPress={() => setMetric(item.key)}
                style={[
                  styles.tabChip,
                  {
                    backgroundColor: active ? colors.foreground : colors.background,
                    borderColor: active ? colors.foreground : colors.border,
                  },
                ]}
              >
                <Text style={[styles.tabChipText, { color: active ? colors.background : colors.mutedForeground }]}>
                  {item.label}
                </Text>
              </Pressable>
            );
          })}
        </ScrollView>

        {scope === "persona" && activeMetric === "archetype" ? (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.subFilterRow}>
            {ARCHETYPES.map((item) => {
              const active = archetype === item.key;
              return (
                <Pressable
                  key={item.key}
                  onPress={() => setArchetype(item.key)}
                  style={[
                    styles.subChip,
                    {
                      backgroundColor: active ? `${colors.primary}18` : colors.background,
                      borderColor: active ? colors.primary : colors.border,
                    },
                  ]}
                >
                  <Text style={[styles.subChipText, { color: active ? colors.primary : colors.mutedForeground }]}>
                    {item.label}
                  </Text>
                </Pressable>
              );
            })}
          </ScrollView>
        ) : null}

        {myRank ? (
          <View style={[styles.myCard, { backgroundColor: colors.background }]}>
            <View style={styles.myCol}>
              <Text style={[styles.myColLabel, { color: colors.mutedForeground }]}>내 순위</Text>
              <Text style={[styles.myRankValue, { color: colors.foreground }]}>{myRank.rank}위</Text>
            </View>
            <View style={[styles.myDivider, { backgroundColor: colors.border }]} />
            <View style={styles.myCol}>
              <Text style={[styles.myColLabel, { color: colors.mutedForeground }]}>내 점수</Text>
              <Text style={[styles.myColValue, { color: colors.foreground }]}>
                {formatScore(myRank.score, scope, activeMetric)}
              </Text>
            </View>
            <View style={[styles.myDivider, { backgroundColor: colors.border }]} />
            <View style={styles.myCol}>
              <Text style={[styles.myColLabel, { color: colors.mutedForeground }]}>다음 순위까지</Text>
              <Text style={[styles.myColValue, { color: colors.primary }]}>
                {myRank.rank <= 1
                  ? "최고 순위"
                  : formatGap(myRank.pointsToNextRank, scope, activeMetric)}
              </Text>
            </View>
          </View>
        ) : null}

        {isLoading ? (
          <View style={styles.center}>
            <ActivityIndicator color={colors.primary} />
          </View>
        ) : isError ? (
          <View style={styles.center}>
            <Text style={[styles.emptyText, { color: colors.mutedForeground }]}>랭킹을 불러오지 못했어요.</Text>
            <Pressable onPress={() => refetch()} style={[styles.retryBtn, { backgroundColor: colors.primary }]}>
              <Text style={styles.retryText}>다시 시도</Text>
            </Pressable>
          </View>
        ) : isEmpty ? (
          <View style={[styles.emptyCard, { backgroundColor: colors.background }]}>
            <Feather name="bar-chart-2" size={28} color={colors.mutedForeground} />
            <Text style={[styles.emptyTitle, { color: colors.foreground }]}>아직 랭킹 데이터가 부족합니다.</Text>
            <Text style={[styles.emptyText, { color: colors.mutedForeground }]}>{copy.empty}</Text>
            <Pressable onPress={goToPrimaryAction} style={[styles.ctaBtn, { backgroundColor: colors.foreground }]}>
              <Feather name={scope === "star" ? "compass" : "zap"} size={15} color={colors.background} />
              <Text style={[styles.ctaText, { color: colors.background }]}>{copy.cta}</Text>
            </Pressable>
          </View>
        ) : (
          <View style={[styles.listCard, { backgroundColor: colors.background }]}>
            {items.map((item, index) => (
              <RankingRow
                key={item.id}
                item={item}
                scope={scope}
                metric={activeMetric}
                isMe={item.userId === me?.id}
                first={index === 0}
                colors={colors}
              />
            ))}
          </View>
        )}
      </CustomScrollView>
    </View>
  );
}

function RankingRow({
  item,
  scope,
  metric,
  isMe,
  first,
  colors,
}: {
  item: ServiceRankingItem;
  scope: RankingScope;
  metric: string;
  isMe: boolean;
  first: boolean;
  colors: ReturnType<typeof useColors>;
}) {
  const medal = MEDAL_COLORS[item.rank];
  return (
    <View
      style={[
        styles.row,
        {
          borderTopColor: colors.border,
          borderTopWidth: first ? 0 : StyleSheet.hairlineWidth,
          backgroundColor: isMe ? `${colors.primary}10` : "transparent",
        },
      ]}
    >
      <View style={styles.rankCol}>
        {medal ? (
          <View style={[styles.medal, { backgroundColor: medal }]}>
            <Text style={styles.medalText}>{item.rank}</Text>
          </View>
        ) : (
          <Text style={[styles.rankNum, { color: colors.mutedForeground }]}>{item.rank}</Text>
        )}
      </View>
      <Avatar
        uri={item.avatarUrl}
        name={item.displayName}
        size={40}
        crop="face"
        characterType={scope === "star" ? "star" : "fan"}
      />
      <View style={styles.rowBody}>
        <Text style={[styles.rowName, { color: colors.foreground }]} numberOfLines={1}>
          {item.displayName}
          {isMe ? " (나)" : ""}
        </Text>
        <Text style={[styles.rowMeta, { color: colors.mutedForeground }]} numberOfLines={1}>
          Lv.{item.level} · {item.subTitle}
        </Text>
      </View>
      <View style={styles.rowScoreCol}>
        <Text style={[styles.rowScore, { color: colors.foreground }]}>{formatScore(item.score, scope, metric)}</Text>
        <Text style={[styles.rowStat, { color: colors.mutedForeground }]} numberOfLines={1}>
          {item.primaryStatLabel} {formatPrimaryValue(item, scope, metric)}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  center: { paddingTop: 60, alignItems: "center", gap: 16 },

  hero: { margin: 16, marginBottom: 8, borderRadius: 22, padding: 24, alignItems: "center" },
  heroTitle: { fontSize: 22, fontFamily: "Inter_700Bold" },
  heroSubtitle: { fontSize: 13, fontFamily: "Inter_500Medium", marginTop: 6, textAlign: "center" },

  scopeRow: { paddingHorizontal: 16, paddingVertical: 8, gap: 10 },
  scopeChip: {
    minWidth: 132,
    flexDirection: "row",
    alignItems: "center",
    gap: 9,
    paddingHorizontal: 14,
    paddingVertical: 11,
    borderRadius: 18,
    borderWidth: StyleSheet.hairlineWidth,
  },
  scopeLabel: { fontSize: 14, fontFamily: "Inter_700Bold" },
  scopeSub: { fontSize: 11, fontFamily: "Inter_500Medium", marginTop: 1 },

  tabRow: { paddingHorizontal: 16, paddingVertical: 8, gap: 8 },
  tabChip: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
    borderWidth: StyleSheet.hairlineWidth,
  },
  tabChipText: { fontSize: 13, fontFamily: "Inter_600SemiBold" },

  subFilterRow: { paddingHorizontal: 16, paddingBottom: 8, gap: 8 },
  subChip: {
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
  },
  subChipText: { fontSize: 12, fontFamily: "Inter_600SemiBold" },

  myCard: {
    marginHorizontal: 16,
    marginTop: 8,
    marginBottom: 4,
    borderRadius: 16,
    padding: 16,
    flexDirection: "row",
    alignItems: "center",
  },
  myCol: { flex: 1, alignItems: "center", gap: 4 },
  myColLabel: { fontSize: 11, fontFamily: "Inter_500Medium" },
  myRankValue: { fontSize: 20, fontFamily: "Inter_700Bold" },
  myColValue: { fontSize: 15, fontFamily: "Inter_700Bold" },
  myDivider: { width: StyleSheet.hairlineWidth, height: 32 },

  listCard: { marginHorizontal: 16, marginTop: 8, borderRadius: 16, overflow: "hidden" },
  row: { flexDirection: "row", alignItems: "center", paddingHorizontal: 14, paddingVertical: 12, gap: 12 },
  rankCol: { width: 30, alignItems: "center" },
  rankNum: { fontSize: 15, fontFamily: "Inter_700Bold" },
  medal: { width: 26, height: 26, borderRadius: 13, alignItems: "center", justifyContent: "center" },
  medalText: { fontSize: 13, fontFamily: "Inter_700Bold", color: "#fff" },
  rowBody: { flex: 1, gap: 2 },
  rowName: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
  rowMeta: { fontSize: 12, fontFamily: "Inter_400Regular" },
  rowScoreCol: { alignItems: "flex-end", gap: 2, maxWidth: 110 },
  rowScore: { fontSize: 15, fontFamily: "Inter_700Bold" },
  rowStat: { fontSize: 11, fontFamily: "Inter_500Medium" },

  emptyCard: { margin: 16, marginTop: 8, borderRadius: 16, padding: 28, alignItems: "center", gap: 10 },
  emptyTitle: { fontSize: 15, fontFamily: "Inter_700Bold", textAlign: "center" },
  emptyText: { fontSize: 13, fontFamily: "Inter_400Regular", textAlign: "center", lineHeight: 19 },
  ctaBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 16,
    paddingVertical: 11,
    borderRadius: 12,
    marginTop: 10,
  },
  ctaText: { fontSize: 13, fontFamily: "Inter_600SemiBold" },

  retryBtn: { paddingHorizontal: 20, paddingVertical: 10, borderRadius: 12 },
  retryText: { color: "#fff", fontSize: 14, fontFamily: "Inter_600SemiBold" },
});
