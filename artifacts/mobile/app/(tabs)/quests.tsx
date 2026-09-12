import { CustomScrollView } from "@/components/CustomScroll";
import { EmptyState } from "@/components/EmptyState";
import React from "react";
import {
  ActivityIndicator,
  Modal,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { Feather } from "@expo/vector-icons";
import { Image } from "expo-image";
import { LinearGradient } from "expo-linear-gradient";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  getGetMyAchievementsQueryKey,
  getGetMyQuestsQueryKey,
  getGetMyRewardsSummaryQueryKey,
  useClaimAchievementReward,
  useClaimQuestReward,
  useGetMyAchievements,
  useGetMyQuests,
  type Achievement,
  type Quest,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useColors } from "@/hooks/useColors";
import { NeonBackdrop } from "@/components/NeonUI";
import { playModeQueryKey } from "@/hooks/usePlayMode";
import { useCharacterProfiles } from "@/hooks/useCharacterProfiles";
import {
  pvtTransactionsQueryKey,
  pvtWalletQueryKey,
  usePvtWallet,
} from "@/hooks/usePvtWallet";

type TabKey = "daily" | "weekly" | "achievements";
const TORIMIA_GATE_COST = 5_000;

const TABS: { key: TabKey; label: string }[] = [
  { key: "daily", label: "일일" },
  { key: "weekly", label: "주간" },
  { key: "achievements", label: "업적" },
];

const CATEGORY_ICON: Record<Achievement["category"], keyof typeof Feather.glyphMap> = {
  chat: "message-circle",
  battle: "mic",
  dungeon: "compass",
  clan: "shield",
  persona: "user",
};

const BASE_DAILY_QUESTS: readonly Quest[] = [
  {
    key: "daily_talk",
    type: "daily",
    title: "채팅 참여",
    description: "채팅에서 메시지를 한 번 보내세요.",
    progress: 0,
    target: 1,
    completed: false,
    rewardClaimed: false,
    rewardExp: 10,
  },
  {
    key: "daily_like",
    type: "daily",
    title: "좋아요 미션",
    description: "피드에서 마음에 드는 글을 한 번 응원하세요.",
    progress: 0,
    target: 1,
    completed: false,
    rewardClaimed: false,
    rewardExp: 10,
  },
  {
    key: "daily_attendance",
    type: "daily",
    title: "출석 미션",
    description: "오늘 DavaQ에 접속하세요.",
    progress: 0,
    target: 1,
    completed: false,
    rewardClaimed: false,
    rewardExp: 10,
  },
] as const;

const STAR_DAILY_QUEST: Quest = {
  key: "daily_dungeon",
  type: "daily",
  title: "STAR 미션",
  description: "STAR 미션에서 3번 선택하세요.",
  progress: 0,
  target: 3,
  completed: false,
  rewardClaimed: false,
  rewardExp: 15,
};

const STAR_WEEKLY_QUESTS: readonly Quest[] = [
  {
    key: "weekly_dungeon",
    type: "weekly",
    title: "STAR 미션 마스터",
    description: "STAR 미션에서 20번 선택하세요.",
    progress: 0,
    target: 20,
    completed: false,
    rewardClaimed: false,
    rewardExp: 100,
  },
] as const;

const FAN_WEEKLY_QUESTS: readonly Quest[] = [
  {
    key: "weekly_clan",
    type: "weekly",
    title: "팬클럽의 기둥",
    description: "팬클럽 활동을 5번 하세요.",
    progress: 0,
    target: 5,
    completed: false,
    rewardClaimed: false,
    rewardExp: 120,
  },
  {
    key: "weekly_growth",
    type: "weekly",
    title: "꾸준한 팬 활동",
    description: "일일 미션을 5개 완료하세요.",
    progress: 0,
    target: 5,
    completed: false,
    rewardClaimed: false,
    rewardExp: 150,
  },
] as const;

function mergeQuestCatalog(catalog: readonly Quest[], serverQuests: Quest[]): Quest[] {
  const byKey = new Map(serverQuests.map((quest) => [quest.key, quest]));
  return catalog.map((definition) => {
    const serverQuest = byKey.get(definition.key);
    if (!serverQuest) return { ...definition };
    return {
      ...definition,
      progress: serverQuest.progress,
      target: serverQuest.target,
      completed: serverQuest.completed,
      rewardClaimed: serverQuest.rewardClaimed,
      rewardExp: serverQuest.rewardExp,
    };
  });
}

export default function QuestsScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();
  const router = useRouter();
  const {
    activeProfile,
    isLoading: profilesLoading,
    isError: profilesError,
    refetch: refetchProfiles,
  } = useCharacterProfiles();
  const starPointWallet = usePvtWallet();
  const profileId = activeProfile?.id;
  const profileQuestQueryKey = [
    ...getGetMyQuestsQueryKey(),
    profileId ?? "profile-pending",
  ] as const;
  const profileAchievementQueryKey = [
    ...getGetMyAchievementsQueryKey(),
    profileId ?? "profile-pending",
  ] as const;

  const [tab, setTab] = React.useState<TabKey>("daily");
  const [gateNotice, setGateNotice] = React.useState<{
    title: string;
    message: string;
  } | null>(null);

  const {
    data: quests = [],
    isLoading: questsLoading,
    isError: questsError,
    refetch: refetchQuests,
    isRefetching: questsRefetching,
  } = useGetMyQuests({
    query: {
      enabled: Boolean(profileId),
      queryKey: profileQuestQueryKey,
    },
    request: {
      headers: profileId
        ? { "x-character-profile-id": profileId }
        : undefined,
    },
  });
  const {
    data: achievements = [],
    isLoading: achLoading,
    isError: achError,
    refetch: refetchAchievements,
    isRefetching: achRefetching,
  } = useGetMyAchievements({
    query: {
      enabled: Boolean(profileId),
      queryKey: profileAchievementQueryKey,
    },
    request: {
      headers: profileId
        ? { "x-character-profile-id": profileId }
        : undefined,
    },
  });

  const [claimingKey, setClaimingKey] = React.useState<string | null>(null);

  const invalidateAll = React.useCallback(() => {
    queryClient.invalidateQueries({ queryKey: getGetMyQuestsQueryKey() });
    queryClient.invalidateQueries({ queryKey: getGetMyAchievementsQueryKey() });
    queryClient.invalidateQueries({ queryKey: getGetMyRewardsSummaryQueryKey() });
    queryClient.invalidateQueries({ queryKey: playModeQueryKey });
    queryClient.invalidateQueries({ queryKey: pvtWalletQueryKey });
    queryClient.invalidateQueries({ queryKey: pvtTransactionsQueryKey });
  }, [queryClient]);

  const { mutate: claimQuest } = useClaimQuestReward({
    request: {
      headers: profileId
        ? { "x-character-profile-id": profileId }
        : undefined,
    },
    mutation: {
      onMutate: (v) => setClaimingKey(`quest:${v.questKey}`),
      onSettled: () => setClaimingKey(null),
      onSuccess: (result) => {
        invalidateAll();
        setGateNotice({
          title: "보상 수령 완료",
          message: `+${result.rewardExp} STAR Point를 받았어요.`,
        });
      },
      onError: () => {
        setGateNotice({
          title: "보상을 받지 못했어요",
          message: "미션 상태를 새로고침한 뒤 다시 시도해 주세요.",
        });
      },
    },
  });
  const { mutate: claimAchievement } = useClaimAchievementReward({
    request: {
      headers: profileId
        ? { "x-character-profile-id": profileId }
        : undefined,
    },
    mutation: {
      onMutate: (v) => setClaimingKey(`ach:${v.achievementKey}`),
      onSettled: () => setClaimingKey(null),
      onSuccess: (result) => {
        invalidateAll();
        setGateNotice({
          title: "보상 수령 완료",
          message: `+${result.rewardExp} XP를 받았어요.`,
        });
      },
      onError: () => {
        setGateNotice({
          title: "보상을 받지 못했어요",
          message: "업적 상태를 새로고침한 뒤 다시 시도해 주세요.",
        });
      },
    },
  });

  const isStarProfile = activeProfile?.type === "star";
  const visibleQuests = quests
    .filter((quest) => {
      if (["daily_battle", "daily_clan", "daily_analysis"].includes(quest.key)) return false;
      if (quest.key === "weekly_debater") return false;
      if (isStarProfile && ["weekly_clan", "weekly_growth"].includes(quest.key)) return false;
      if (!isStarProfile && ["daily_dungeon", "weekly_dungeon"].includes(quest.key)) return false;
      return true;
    })
    .map((quest) =>
      quest.key === "daily_talk"
        ? {
            ...quest,
            title: "채팅 참여",
            description: "채팅에서 메시지를 한 번 보내세요.",
          }
        : quest,
    );
  const starAchievementKeys = ["first_dungeon", "first_dungeon_goal"];
  const fanAchievementKeys = [
    "first_clan_join",
    "first_clan_memory",
    "first_clan_war_win",
    "clan_create",
  ];
  const visibleAchievements = achievements.filter((achievement) =>
    (isStarProfile ? starAchievementKeys : fanAchievementKeys).includes(achievement.key),
  );
  const serverQuestKeys = new Set(visibleQuests.map((quest) => quest.key));
  const dailyQuests = mergeQuestCatalog(
    isStarProfile ? [...BASE_DAILY_QUESTS, STAR_DAILY_QUEST] : BASE_DAILY_QUESTS,
    visibleQuests,
  );
  const weeklyQuests = mergeQuestCatalog(
    isStarProfile ? STAR_WEEKLY_QUESTS : FAN_WEEKLY_QUESTS,
    visibleQuests,
  );

  const refetchActive = React.useCallback(async () => {
    if (!activeProfile) {
      await Promise.all([refetchProfiles(), starPointWallet.refetch()]);
      return;
    }
    if (tab === "achievements") {
      await Promise.all([refetchAchievements(), starPointWallet.refetch()]);
      return;
    }
    await Promise.all([refetchQuests(), starPointWallet.refetch()]);
  }, [activeProfile, refetchAchievements, refetchProfiles, refetchQuests, starPointWallet.refetch, tab]);
  const isRefetching =
    starPointWallet.isRefetching ||
    (tab === "achievements" ? achRefetching : questsRefetching);
  const starPointBalance = Math.max(0, starPointWallet.data?.balance ?? 0);
  const torimiaProgress = Math.min(
    100,
    Math.floor((starPointBalance / TORIMIA_GATE_COST) * 100),
  );
  const torimiaRemaining = Math.max(0, TORIMIA_GATE_COST - starPointBalance);
  const tryOpenTorimiaGate = React.useCallback(() => {
    if (starPointBalance < TORIMIA_GATE_COST) {
      setGateNotice({
        title: "STAR Point가 부족해요",
        message: `현재 ${starPointBalance.toLocaleString()} Point를 보유하고 있어요.\n토르미아 문을 열려면 ${torimiaRemaining.toLocaleString()} Point가 더 필요해요.`,
      });
      return;
    }
    setGateNotice({
      title: "토르미아 문 열기",
      message: "5,000 STAR Point를 달성했어요. 실제 문 열기 기능은 추후 업데이트될 예정이에요.",
    });
  }, [starPointBalance, torimiaRemaining]);

  return (
    <NeonBackdrop style={styles.container}>
      <View style={[styles.header, { paddingTop: insets.top + 8 }]}>
        <Text style={styles.headerTitle}>미션</Text>
      </View>

      <CustomScrollView
        contentContainerStyle={[
          styles.scroll,
          { paddingBottom: insets.bottom + 100 },
        ]}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={isRefetching}
            onRefresh={refetchActive}
            tintColor={colors.primary}
          />
        }
      >
        <View style={styles.missionHero}>
          <Image
            source={require("../../assets/images/torimia-portal-scene.png")}
            style={StyleSheet.absoluteFill}
            contentFit="cover"
            contentPosition="right"
          />
          <LinearGradient
            colors={["rgba(5,4,13,0.98)", "rgba(7,5,20,0.82)", "rgba(7,4,18,0.12)"]}
            locations={[0, 0.48, 1]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 0 }}
            style={StyleSheet.absoluteFill}
          />
          <View pointerEvents="none" style={styles.heroGlow} />
          <View style={styles.missionHeroCopy}>
            <Text style={styles.missionHeroTitle}>토르미아 문 열기</Text>
            <Text style={styles.missionHeroBody}>5,000 STAR Point를 모아{`\n`}토르미아의 문을 여세요.</Text>
            <Text style={styles.missionPercent}>{torimiaProgress}%</Text>
            <View style={styles.missionTrack}><View style={[styles.missionFill, { width: `${torimiaProgress}%` }]} /></View>
            <Text style={styles.missionBalance}>
              {starPointBalance.toLocaleString()} / {TORIMIA_GATE_COST.toLocaleString()} STAR Point
            </Text>
            <Text style={styles.missionRemain}>
              문 열기까지 {torimiaRemaining.toLocaleString()} Point 남았어요
            </Text>
          </View>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="토르미아 문 열기 시도"
            onPress={tryOpenTorimiaGate}
            style={({ pressed }) => [styles.gateButton, pressed && { opacity: 0.78 }]}
          >
            <Text style={styles.gateButtonText}>문 열기 시도</Text>
            <Feather name="chevron-right" size={20} color="#FFFFFF" />
          </Pressable>
        </View>

        <View style={styles.tabBar}>
          {TABS.map((t) => {
            const active = tab === t.key;
            return (
              <Pressable key={t.key} onPress={() => setTab(t.key)} style={[styles.tabItem, active && styles.tabItemActive]}>
                <Text style={[styles.tabLabel, active && styles.tabLabelActive]}>{t.label}</Text>
              </Pressable>
            );
          })}
        </View>

        {tab === "achievements" ? (
          profilesLoading || (!activeProfile && !profilesError) || achLoading ? (
            <Loading colors={colors} />
          ) : profilesError || achError ? (
            <ErrorBlock colors={colors} onRetry={refetchActive} />
          ) : visibleAchievements.length === 0 ? (
            <View style={styles.emptyWrap}>
              <EmptyState
                icon="award"
                title="업적이 없어요"
                subtitle="활동을 쌓으면 업적이 열립니다."
              />
            </View>
          ) : (
            <>
              <Text style={[styles.intro, { color: colors.mutedForeground }]}>
                {isStarProfile
                  ? "STAR 미션으로 잠금 해제하고 STAR XP 보상을 받으세요."
                  : "팬클럽 활동으로 잠금 해제하고 FAN XP 보상을 받으세요."}
              </Text>
              {visibleAchievements.map((a) => (
                <AchievementRow
                  key={a.key}
                  achievement={a}
                  colors={colors}
                  claiming={claimingKey === `ach:${a.key}`}
                  onClaim={() => claimAchievement({ achievementKey: a.key })}
                />
              ))}
            </>
          )
        ) : profilesLoading || (!activeProfile && !profilesError) || questsLoading ? (
          <Loading colors={colors} />
        ) : profilesError || questsError ? (
          <ErrorBlock colors={colors} onRetry={refetchActive} />
        ) : (
          (() => {
            const list = tab === "daily" ? dailyQuests : weeklyQuests;
            if (list.length === 0) {
              return (
                <View style={styles.emptyWrap}>
                  <EmptyState
                    icon="check-circle"
                    title="퀘스트가 없어요"
                    subtitle="잠시 후 다시 확인해 주세요."
                  />
                </View>
              );
            }
            return (
              <>
                <Text style={styles.listTitle}>{tab === "daily" ? "데일리 미션" : "주간 미션"}</Text>
                {list.map((q) => (
                  <QuestRow
                    key={q.key}
                    quest={q}
                    claimSupported={serverQuestKeys.has(q.key)}
                    colors={colors}
                    claiming={claimingKey === `quest:${q.key}`}
                    onClaim={() => claimQuest({ questKey: q.key })}
                    onOpen={() => {
                      const destination = questDestination(q);
                      if (destination) {
                        router.push(destination as never);
                        return;
                      }
                      setGateNotice({
                        title: q.rewardClaimed
                          ? "완료한 미션이에요"
                          : "자동으로 집계되는 미션이에요",
                        message: q.rewardClaimed
                          ? "이 미션의 보상을 이미 받았어요."
                          : "조건을 달성하면 진행 상태가 자동으로 반영돼요.",
                      });
                    }}
                    onUnavailable={() => {
                      setGateNotice({
                        title: "미션 상태 동기화가 필요해요",
                        message: "화면을 아래로 당겨 새로고침한 뒤 다시 시도해 주세요.",
                      });
                    }}
                  />
                ))}
              </>
            );
          })()
        )}
      </CustomScrollView>
      <Modal
        transparent
        animationType="fade"
        visible={gateNotice !== null}
        onRequestClose={() => setGateNotice(null)}
      >
        <View style={styles.noticeBackdrop}>
          <View style={styles.noticeCard}>
            <View style={styles.noticeIcon}>
              <Feather name="star" size={25} color="#C873FF" />
            </View>
            <Text style={styles.noticeTitle}>{gateNotice?.title}</Text>
            <Text style={styles.noticeMessage}>{gateNotice?.message}</Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="토르미아 안내 확인"
              onPress={() => setGateNotice(null)}
              style={({ pressed }) => [styles.noticeButton, pressed && { opacity: 0.78 }]}
            >
              <Text style={styles.noticeButtonText}>확인</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    </NeonBackdrop>
  );
}

function Loading({ colors }: { colors: ReturnType<typeof useColors> }) {
  return (
    <View style={styles.center}>
      <ActivityIndicator color={colors.primary} />
    </View>
  );
}

function ErrorBlock({
  colors,
  onRetry,
}: {
  colors: ReturnType<typeof useColors>;
  onRetry: () => void;
}) {
  return (
    <View style={styles.center}>
      <Text style={[styles.errorText, { color: colors.mutedForeground }]}>
        불러오지 못했어요.
      </Text>
      <Pressable
        onPress={onRetry}
        style={({ pressed }) => [
          styles.retryBtn,
          { backgroundColor: colors.primary, opacity: pressed ? 0.85 : 1 },
        ]}
      >
        <Text style={styles.retryText}>다시 시도</Text>
      </Pressable>
    </View>
  );
}

function questIcon(quest: Quest): keyof typeof Feather.glyphMap {
  const source = `${quest.key} ${quest.title} ${quest.description}`.toLocaleLowerCase();
  if (source.includes("대화") || source.includes("chat") || source.includes("talk")) return "message-circle";
  if (source.includes("게시") || source.includes("post") || source.includes("feed")) return "edit-3";
  if (source.includes("좋아요") || source.includes("응원") || source.includes("reaction")) return "star";
  if (source.includes("배틀") || source.includes("battle")) return "mic";
  if (source.includes("분석") || source.includes("analysis")) return "activity";
  return "zap";
}

function questDestination(quest: Quest): string | null {
  const source = `${quest.key} ${quest.title} ${quest.description}`.toLocaleLowerCase();
  if (source.includes("배틀") || source.includes("battle")) return "/(tabs)/battle";
  if (source.includes("star 미션") || source.includes("dungeon")) return "/(tabs)/dungeon";
  if (source.includes("팬클럽") || source.includes("clan")) return "/clan";
  if (source.includes("분석") || source.includes("analysis")) return "/settings/ontology";
  if (source.includes("대화") || source.includes("chat") || source.includes("talk")) return "/(tabs)/chats";
  if (source.includes("게시") || source.includes("post") || source.includes("feed") || source.includes("응원")) return "/(tabs)/feed";
  return null;
}

function QuestRow({
  quest,
  claimSupported,
  colors,
  claiming,
  onClaim,
  onOpen,
  onUnavailable,
}: {
  quest: Quest;
  claimSupported: boolean;
  colors: ReturnType<typeof useColors>;
  claiming: boolean;
  onClaim: () => void;
  onOpen: () => void;
  onUnavailable: () => void;
}) {
  const ratio = Math.min(100, Math.round((quest.progress / (quest.target || 1)) * 100));
  const handlePress = () => {
    if (quest.completed && !quest.rewardClaimed) {
      if (claimSupported) {
        onClaim();
      } else {
        onUnavailable();
      }
      return;
    }
    onOpen();
  };
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={
        quest.completed && !quest.rewardClaimed
          ? `${quest.title} 보상 받기`
          : `${quest.title} 콘텐츠로 이동`
      }
      onPress={handlePress}
      style={({ pressed }) => [styles.cardPressable, pressed && { opacity: 0.78 }]}
    >
      <LinearGradient
        colors={["rgba(11,11,27,0.99)", "rgba(5,6,18,0.99)"]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={styles.card}
      >
        <View style={styles.cardTop}>
          <View style={styles.questIconWrap}>
            <Feather name={questIcon(quest)} size={34} color="#B24CFF" />
            <View pointerEvents="none" style={styles.questIconGlow} />
          </View>
          <View style={styles.cardInfo}>
            <Text style={[styles.cardTitle, { color: colors.foreground }]} numberOfLines={1}>
              {quest.title}
            </Text>
            <Text style={[styles.cardDesc, { color: colors.mutedForeground }]} numberOfLines={2}>
              {quest.description}
            </Text>
          </View>
          <RewardBadge
            exp={quest.rewardExp}
            colors={colors}
            claimed={quest.rewardClaimed}
          />
        </View>

        <View style={styles.progressTrack}>
          <View
            style={{
              width: `${ratio}%`,
              height: "100%",
              borderRadius: 4,
              backgroundColor: quest.completed ? "#35E6E0" : "#5918FF",
            }}
          />
        </View>

        <View style={styles.cardBottom}>
          <Text style={[styles.progressText, { color: colors.mutedForeground }]}>
            {Math.min(quest.progress, quest.target)} / {quest.target}
          </Text>
          {claimSupported && (quest.completed || quest.rewardClaimed) ? (
            <ClaimButton
              completed={quest.completed}
              claimed={quest.rewardClaimed}
              claiming={claiming}
              colors={colors}
              onClaim={onClaim}
            />
          ) : null}
        </View>
      </LinearGradient>
    </Pressable>
  );
}

function AchievementRow({
  achievement,
  colors,
  claiming,
  onClaim,
}: {
  achievement: Achievement;
  colors: ReturnType<typeof useColors>;
  claiming: boolean;
  onClaim: () => void;
}) {
  const icon = CATEGORY_ICON[achievement.category] ?? "award";
  return (
    <View style={[styles.card, { backgroundColor: colors.background }]}>
      <View style={styles.cardTop}>
        <View
          style={[
            styles.achIcon,
            {
              backgroundColor: achievement.unlocked
                ? `${colors.primary}18`
                : colors.muted,
            },
          ]}
        >
          <Feather
            name={achievement.unlocked ? icon : "lock"}
            size={18}
            color={achievement.unlocked ? colors.primary : colors.mutedForeground}
          />
        </View>
        <View style={styles.cardInfo}>
          <Text style={[styles.cardTitle, { color: colors.foreground }]} numberOfLines={1}>
            {achievement.title}
          </Text>
          <Text style={[styles.cardDesc, { color: colors.mutedForeground }]} numberOfLines={2}>
            {achievement.description}
          </Text>
        </View>
        <RewardBadge
          exp={achievement.rewardExp}
          colors={colors}
          claimed={achievement.rewardClaimed}
        />
      </View>

      <View style={styles.cardBottom}>
        <Text style={[styles.progressText, { color: colors.mutedForeground }]}>
          {achievement.unlocked ? "달성 완료" : "미달성"}
        </Text>
        <ClaimButton
          completed={achievement.unlocked}
          claimed={achievement.rewardClaimed}
          claiming={claiming}
          colors={colors}
          onClaim={onClaim}
        />
      </View>
    </View>
  );
}

function RewardBadge({
  exp,
  colors,
  claimed,
}: {
  exp: number;
  colors: ReturnType<typeof useColors>;
  claimed: boolean;
}) {
  return (
    <View
      style={[
        styles.rewardBadge,
        { backgroundColor: claimed ? colors.muted : `${colors.primary}14` },
      ]}
    >
      <Feather
        name="star"
        size={15}
        color={claimed ? colors.mutedForeground : colors.primary}
      />
      <Text
        style={[
          styles.rewardText,
          { color: claimed ? colors.mutedForeground : colors.primary },
        ]}
      >
        +{exp} STAR
      </Text>
    </View>
  );
}

function ClaimButton({
  completed,
  claimed,
  claiming,
  colors,
  onClaim,
}: {
  completed: boolean;
  claimed: boolean;
  claiming: boolean;
  colors: ReturnType<typeof useColors>;
  onClaim: () => void;
}) {
  if (claimed) {
    return (
      <View style={[styles.claimBtn, styles.claimedBtn, { borderColor: colors.border }]}>
        <Feather name="check" size={14} color={colors.mutedForeground} />
        <Text style={[styles.claimedText, { color: colors.mutedForeground }]}>받음</Text>
      </View>
    );
  }
  const disabled = !completed || claiming;
  return (
    <Pressable
      onPress={(event) => {
        event.stopPropagation();
        onClaim();
      }}
      disabled={disabled}
      style={({ pressed }) => [
        styles.claimBtn,
        {
          backgroundColor: completed ? colors.foreground : colors.muted,
          opacity: disabled && !claiming ? 0.55 : pressed ? 0.85 : 1,
        },
      ]}
    >
      {claiming ? (
        <ActivityIndicator size="small" color={colors.background} />
      ) : (
        <Text
          style={[
            styles.claimText,
            { color: completed ? colors.background : colors.mutedForeground },
          ]}
        >
          {completed ? "보상 받기" : "진행 중"}
        </Text>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    alignItems: "center",
    justifyContent: "center",
    paddingBottom: 12,
  },
  headerTitle: { color: "#F7F5FF", fontSize: 20, fontFamily: "Inter_700Bold", textAlign: "center" },
  tabBar: {
    height: 38,
    flexDirection: "row",
    gap: 5,
    padding: 3,
    borderRadius: 20,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "rgba(112,62,169,0.30)",
    backgroundColor: "rgba(8,7,19,0.92)",
  },
  tabItem: { flex: 1, alignItems: "center", justifyContent: "center", borderRadius: 17 },
  tabItemActive: { backgroundColor: "rgba(84,32,165,0.36)", borderWidth: 1, borderColor: "rgba(177,76,255,0.42)" },
  tabLabel: { color: "#777181", fontSize: 11, fontFamily: "Inter_500Medium" },
  tabLabelActive: { color: "#E8DCFF", fontFamily: "Inter_700Bold" },
  scroll: { paddingHorizontal: 5, gap: 10 },
  missionHero: { minHeight: 290, borderRadius: 16, borderWidth: 1, borderColor: "rgba(177,76,255,0.58)", overflow: "hidden", backgroundColor: "#070512" },
  heroGlow: { position: "absolute", right: 45, top: 26, width: 180, height: 180, borderRadius: 90, backgroundColor: "rgba(103,39,255,0.12)" },
  missionHeroCopy: { width: "54%", paddingLeft: 28, paddingTop: 27, zIndex: 1 },
  missionHeroTitle: { color: "#F7F5FF", fontFamily: "Inter_700Bold", fontSize: 23, lineHeight: 30 },
  missionHeroBody: { color: "#A9A3BA", fontFamily: "Inter_400Regular", fontSize: 12, lineHeight: 19, marginTop: 14 },
  missionPercent: { color: "#FFFFFF", fontFamily: "Inter_700Bold", fontSize: 46, lineHeight: 55, marginTop: 22, textShadowColor: "rgba(178,76,255,0.35)", textShadowRadius: 10 },
  missionTrack: { width: "100%", height: 10, borderRadius: 5, backgroundColor: "rgba(100,91,133,0.24)", overflow: "hidden", marginTop: 5 },
  missionFill: { height: "100%", borderRadius: 5, backgroundColor: "#5918FF" },
  missionBalance: { color: "#C7BED5", fontFamily: "Inter_600SemiBold", fontSize: 10.5, marginTop: 9 },
  missionRemain: { color: "#8E879A", fontFamily: "Inter_400Regular", fontSize: 10, marginTop: 3 },
  gateButton: { position: "absolute", right: 14, bottom: 18, width: "38%", height: 48, paddingHorizontal: 16, borderRadius: 25, flexDirection: "row", alignItems: "center", justifyContent: "space-between", backgroundColor: "#4F12E8", borderWidth: 1, borderColor: "#8A52FF", shadowColor: "#6D28FF", shadowOpacity: 0.55, shadowRadius: 12 },
  gateButtonText: { color: "#FFFFFF", fontFamily: "Inter_600SemiBold", fontSize: 14 },
  noticeBackdrop: { flex: 1, alignItems: "center", justifyContent: "center", paddingHorizontal: 24, backgroundColor: "rgba(1,1,8,0.78)" },
  noticeCard: { width: "100%", maxWidth: 360, alignItems: "center", paddingHorizontal: 24, paddingTop: 25, paddingBottom: 20, borderRadius: 22, borderWidth: 1, borderColor: "rgba(181,91,255,0.62)", backgroundColor: "#0D0918", shadowColor: "#8B35FF", shadowOpacity: 0.35, shadowRadius: 18 },
  noticeIcon: { width: 52, height: 52, alignItems: "center", justifyContent: "center", borderRadius: 26, backgroundColor: "rgba(115,38,214,0.24)" },
  noticeTitle: { marginTop: 14, color: "#FFFFFF", fontFamily: "Inter_700Bold", fontSize: 19 },
  noticeMessage: { marginTop: 9, color: "#B8B0C4", fontFamily: "Inter_400Regular", fontSize: 13, lineHeight: 20, textAlign: "center" },
  noticeButton: { width: "100%", height: 46, marginTop: 20, alignItems: "center", justifyContent: "center", borderRadius: 23, backgroundColor: "#7132E8" },
  noticeButtonText: { color: "#FFFFFF", fontFamily: "Inter_700Bold", fontSize: 14 },
  listTitle: { color: "#F0ECF5", fontFamily: "Inter_700Bold", fontSize: 17, marginTop: 7, marginBottom: 2 },
  intro: { fontSize: 13, fontFamily: "Inter_400Regular", marginBottom: 2 },
  center: { paddingVertical: 80, alignItems: "center", gap: 14 },
  errorText: { fontSize: 14, fontFamily: "Inter_400Regular" },
  retryBtn: { paddingHorizontal: 20, paddingVertical: 10, borderRadius: 12 },
  retryText: { color: "#fff", fontSize: 14, fontFamily: "Inter_600SemiBold" },
  emptyWrap: { paddingVertical: 80 },
  card: { minHeight: 140, borderRadius: 15, borderWidth: StyleSheet.hairlineWidth, borderColor: "rgba(61,56,113,0.48)", padding: 18, gap: 12, overflow: "hidden" },
  cardPressable: { borderRadius: 15 },
  cardTop: { flexDirection: "row", alignItems: "center", gap: 15 },
  cardInfo: { flex: 1, gap: 3 },
  cardTitle: { fontSize: 17, fontFamily: "Inter_600SemiBold" },
  cardDesc: { fontSize: 11, fontFamily: "Inter_400Regular", lineHeight: 17, marginTop: 3 },
  questIconWrap: { width: 72, height: 62, borderRadius: 18, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(59,20,113,0.25)" },
  questIconGlow: { position: "absolute", width: 50, height: 50, borderRadius: 25, backgroundColor: "rgba(164,59,255,0.14)", shadowColor: "#B24CFF", shadowOpacity: 0.9, shadowRadius: 14 },
  achIcon: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: "center",
    justifyContent: "center",
  },
  rewardBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 13,
    paddingVertical: 7,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "rgba(177,76,255,0.64)",
  },
  rewardText: { fontSize: 12, fontFamily: "Inter_600SemiBold" },
  progressTrack: { height: 8, borderRadius: 4, overflow: "hidden", backgroundColor: "rgba(83,78,111,0.16)" },
  cardBottom: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  progressText: { fontSize: 12, fontFamily: "Inter_500Medium" },
  claimBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 10,
    minWidth: 92,
  },
  claimText: { fontSize: 13, fontFamily: "Inter_600SemiBold" },
  claimedBtn: { backgroundColor: "transparent", borderWidth: StyleSheet.hairlineWidth },
  claimedText: { fontSize: 13, fontFamily: "Inter_600SemiBold" },
});
