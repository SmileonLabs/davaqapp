import { useMemo } from "react";
import { useColors } from "@/hooks/useColors";
import { fonts, fontSizes, radii } from "@/constants/designSystem";
import { CustomScrollView } from "@/components/CustomScroll";
import { Avatar } from "@/components/Avatar";
import { CharacterAvatar } from "@/components/CharacterAvatar";
import { ProfileSwitcher } from "@/components/home/ProfileSwitcher";
import { FAN_STAT_META, readFanStat } from "@/constants/fanStats";
import {
  type CharacterProfileView,
  useCharacterProfiles,
} from "@/hooks/useCharacterProfiles";
import { useMediaUri } from "@/hooks/useMediaUri";
import { usePlayMode } from "@/hooks/usePlayMode";
import { crossAlert } from "@/lib/crossAlert";
import { useQueryClient } from "@tanstack/react-query";
import {
  getGetMyQuestsQueryKey,
  type Quest,
  useGetMe,
  useGetMyQuests,
  useListIncomingFriendRequests,
} from "@workspace/api-client-react";
import { Feather } from "@expo/vector-icons";
import { Image } from "expo-image";
import { LinearGradient } from "expo-linear-gradient";
import { useFocusEffect, useRouter } from "expo-router";
import React from "react";
import {
  Linking,
  Platform,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

const FAN_CHARACTER_SCENE = require("../../assets/images/home-v2/fan-character-scene.png");
const STAR_SCENE = require("../../assets/images/star_bg.png");
const STAR_CHARACTER = require("../../assets/images/star-character-cutout.png");
const STAR_RANDOM_BOX = require("../../assets/images/star-random-box.png");
const RARE_ON_BANNER = require("../../assets/images/home-v2/rare-on-banner.png");
const RARE_ON_URL = "https://www.rare-on.com/";

type PlayModeChoice = "fan" | "star";
type FeatherName = React.ComponentProps<typeof Feather>["name"];

interface MissionPresentation {
  key: string;
  title: string;
  description: string;
  icon: FeatherName;
  route: string;
  fallbackTarget: number;
}

const homeMissions: readonly MissionPresentation[] = [
  {
    key: "daily_talk",
    title: "채팅 참여",
    description: "채팅에서 메시지를 보내보세요.",
    icon: "zap",
    route: "/(tabs)/chats",
    fallbackTarget: 1,
  },
  {
    key: "daily_like",
    title: "좋아요 미션",
    description: "피드에서 마음에 드는 글을 응원해보세요.",
    icon: "heart",
    route: "/(tabs)/feed",
    fallbackTarget: 1,
  },
  {
    key: "daily_attendance",
    title: "출석 미션",
    description: "오늘 접속하고 출석 포인트를 받아보세요.",
    icon: "calendar",
    route: "/(tabs)/quests",
    fallbackTarget: 1,
  },
] as const;

const starStats = (styleColors: ReturnType<typeof useColors>) => [
  { key: "charm", label: "매력", icon: "heart" as const, color: styleColors.primary },
  {
    key: "stagePresence",
    label: "스타성",
    icon: "star" as const,
    color: styleColors.primary,
  },
  {
    key: "bond",
    label: "유대감",
    icon: "message-circle" as const,
    color: styleColors.primary,
  },
  { key: "lore", label: "영향력", icon: "award" as const, color: styleColors.primary },
] as const;

function xpFloor(level: number): number {
  if (level <= 1) return 0;
  return 50 * (level - 1) * level;
}

function safeStat(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function readableJob(
  jobKey: string | null | undefined,
  fallback: string,
): string {
  if (!jobKey) return fallback;
  return jobKey
    .split(/[_-]/g)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function findMission(
  quests: Quest[],
  definition: MissionPresentation,
): Quest | undefined {
  return quests.find((quest) => quest.key === definition.key);
}

export default function HomeV2() {
  const styleColors = useColors();
  const styles = useMemo(() => makeStyles(styleColors), [styleColors]);

  const router = useRouter();
  const queryClient = useQueryClient();
  const insets = useSafeAreaInsets();
  const { height, width } = useWindowDimensions();
  const compact = height < 730 || width < 360;

  const { data: me, refetch: refetchMe } = useGetMe();
  const {
    activeProfile,
    profiles,
    activateProfile,
    refetch: refetchProfiles,
  } = useCharacterProfiles();
  const { data: quests = [], refetch: refetchQuests } = useGetMyQuests({
    query: {
      enabled: Boolean(activeProfile?.id),
      queryKey: [
        ...getGetMyQuestsQueryKey(),
        activeProfile?.id ?? "profile-pending",
      ],
    },
    request: {
      headers: activeProfile?.id
        ? { "x-character-profile-id": activeProfile.id }
        : undefined,
    },
  });
  const { data: incomingRequests = [], refetch: refetchRequests } =
    useListIncomingFriendRequests();
  const {
    mode,
    fanProfile,
    equippedStar,
    isChanging,
    refetch: refetchPlayMode,
    setMode,
  } = usePlayMode();
  const [selectedMode, setSelectedMode] = React.useState<PlayModeChoice>("fan");
  const [refreshing, setRefreshing] = React.useState(false);
  const [profileSwitcherOpen, setProfileSwitcherOpen] = React.useState(false);
  const [switchingProfileId, setSwitchingProfileId] = React.useState<
    string | null
  >(null);
  const starImageUri = useMediaUri(equippedStar?.imageUrl);
  // Legacy FAN profiles copied the member account photo during initialization.
  // A character-facing avatar must never be replaced by that account image.
  const characterProfileImageUrl =
    activeProfile?.profileImageUrl &&
    activeProfile.profileImageUrl !== me?.profileImageUrl
      ? activeProfile.profileImageUrl
      : null;
  const openRareOn = React.useCallback(() => {
    if (Platform.OS === "web") {
      window.open(RARE_ON_URL, "_blank", "noopener,noreferrer");
      return;
    }
    void Linking.openURL(RARE_ON_URL).catch(() => {
      crossAlert("RARE ON을 열 수 없어요", "잠시 후 다시 시도해 주세요.");
    });
  }, []);

  React.useEffect(() => {
    if (activeProfile?.type === "star" || activeProfile?.type === "fan") {
      setSelectedMode(activeProfile.type);
      return;
    }
    setSelectedMode(mode === "star" && equippedStar ? "star" : "fan");
  }, [activeProfile?.type, equippedStar, mode]);

  const refreshAll = React.useCallback(async () => {
    setRefreshing(true);
    try {
      await Promise.all([
        refetchMe(),
        refetchQuests(),
        refetchRequests(),
        refetchPlayMode(),
        refetchProfiles(),
      ]);
      await queryClient.invalidateQueries({
        queryKey: getGetMyQuestsQueryKey(),
      });
    } finally {
      setRefreshing(false);
    }
  }, [
    queryClient,
    refetchMe,
    refetchPlayMode,
    refetchProfiles,
    refetchQuests,
    refetchRequests,
  ]);

  useFocusEffect(
    React.useCallback(() => {
      void Promise.all([
        refetchMe(),
        refetchQuests(),
        refetchRequests(),
        refetchPlayMode(),
        refetchProfiles(),
      ]);
    }, [
      refetchMe,
      refetchPlayMode,
      refetchProfiles,
      refetchQuests,
      refetchRequests,
    ]),
  );

  const selectMode = React.useCallback(
    async (nextMode: PlayModeChoice) => {
      setSelectedMode(nextMode);
      const candidate =
        nextMode === "star"
          ? profiles.find(
              (profile) =>
                profile.type === "star" &&
                (profile.status === "active" || profile.status === "torimia") &&
                (profile.id === equippedStar?.id || !equippedStar),
            )
          : profiles.find(
              (profile) =>
                profile.type === "fan" &&
                (profile.status === "active" || profile.status === "torimia"),
            );

      if (candidate && candidate.id !== activeProfile?.id) {
        await activateProfile(candidate.id);
        return;
      }
      if (nextMode !== mode) await setMode(nextMode);
    },
    [activateProfile, activeProfile?.id, equippedStar, mode, profiles, setMode],
  );

  const isStar = selectedMode === "star";
  const starLocked = isStar && !equippedStar;
  const level = isStar
    ? activeProfile?.type === "star"
      ? activeProfile.level
      : (equippedStar?.level ?? 1)
    : activeProfile?.type === "fan"
      ? activeProfile.level
      : (fanProfile?.level ?? 1);
  const xp = isStar
    ? activeProfile?.type === "star"
      ? activeProfile.xp
      : (equippedStar?.xp ?? 0)
    : activeProfile?.type === "fan"
      ? activeProfile.xp
      : (fanProfile?.xp ?? 0);
  const floor = xpFloor(level);
  const nextTarget = Math.max(1, xpFloor(level + 1) - floor);
  const xpIntoLevel = Math.max(0, xp - floor);
  const xpPercent = Math.min(100, Math.round((xpIntoLevel / nextTarget) * 100));
  const profileName = isStar
    ? (equippedStar?.displayName ?? "STAR 미장착")
    : (activeProfile?.displayName ?? me?.nickname ?? "FAN");
  const jobName = isStar
    ? equippedStar
      ? readableJob(activeProfile?.jobKey, "STAR")
      : "NFT 장착 필요"
    : readableJob(activeProfile?.jobKey, "팬클럽 회원");

  const stats = isStar
    ? starStats(styleColors).map((stat) => ({
        ...stat,
        value: safeStat(equippedStar?.stats[stat.key]),
      }))
    : FAN_STAT_META.map((stat) => ({
        ...stat,
        value: readFanStat(
          activeProfile?.type === "fan"
            ? activeProfile.stats
            : fanProfile?.stats,
          stat.key,
        ),
      }));

  const switchProfile = React.useCallback(
    async (profile: CharacterProfileView) => {
      if (profile.id === activeProfile?.id || switchingProfileId) {
        setProfileSwitcherOpen(false);
        return;
      }

      setSwitchingProfileId(profile.id);
      try {
        const state = await activateProfile(profile.id);
        setSelectedMode(state.activeProfile.type === "star" ? "star" : "fan");
        setProfileSwitcherOpen(false);
      } catch {
        crossAlert(
          "프로필을 바꾸지 못했어요",
          profile.status === "active"
            ? "잠시 후 다시 시도해 주세요."
            : "현재 사용할 수 없는 프로필이에요.",
        );
      } finally {
        setSwitchingProfileId(null);
      }
    },
    [activateProfile, activeProfile?.id, switchingProfileId],
  );

  const openProfileManagement = React.useCallback(() => {
    setProfileSwitcherOpen(false);
    router.push("/profiles" as never);
  }, [router]);

  const openAvatarCustomization = React.useCallback(
    (profile: CharacterProfileView) => {
      setProfileSwitcherOpen(false);
      router.push({
        pathname: "/profile/avatar",
        params: { profileId: profile.id },
      } as never);
    },
    [router],
  );

  const openProfileCreation = React.useCallback(() => {
    setProfileSwitcherOpen(false);
    router.push(
      (selectedMode === "fan"
        ? "/profile/create-fan"
        : "/profiles/summon-star") as never,
    );
  }, [router, selectedMode]);

  React.useEffect(() => {
    if (!profileSwitcherOpen) {
      setSwitchingProfileId(null);
    }
  }, [profileSwitcherOpen]);

  const contentMinHeight = Math.max(
    0,
    height - insets.top - insets.bottom - 70,
  );

  return (
    <View style={styles.screen}>
      <CustomScrollView
        contentContainerStyle={[
          styles.scrollContent,
          {
            minHeight: contentMinHeight,
            paddingTop: Math.max(insets.top, 8) + 8,
            paddingBottom: Math.max(insets.bottom, 8) + 92,
          },
        ]}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={refreshAll}
            tintColor={styleColors.primary}
          />
        }
      >
        <View style={styles.content}>
          <View style={styles.topBar}>
            <View style={styles.modeTabs}>
              <ModeButton
                mode="star"
                active={isStar}
                disabled={isChanging}
                onPress={() => void selectMode("star")}
              />
              <ModeButton
                mode="fan"
                active={!isStar}
                disabled={isChanging}
                onPress={() => void selectMode("fan")}
              />
            </View>

            <View style={styles.topActions}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="알림"
                hitSlop={10}
                onPress={() => router.push("/settings/notifications")}
                style={({ pressed }) => [
                  styles.bellButton,
                  pressed && styles.pressed,
                ]}
              >
                <Feather
                  name="bell"
                  size={29}
                  color={styleColors.foreground}
                  strokeWidth={1.6}
                />
                {incomingRequests.length > 0 ? (
                  <View style={styles.notificationDot} />
                ) : null}
              </Pressable>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="활동 프로필 전환"
                accessibilityState={{ expanded: profileSwitcherOpen }}
                onPress={() => setProfileSwitcherOpen((open) => !open)}
                style={({ pressed }) => [
                  styles.avatarRing,
                  pressed && styles.pressed,
                ]}
              >
                <Avatar
                  uri={characterProfileImageUrl}
                  name={activeProfile?.displayName ?? me?.nickname ?? "FAN"}
                  size={39}
                  crop="face"
                  characterType={
                    activeProfile?.type ?? (isStar ? "star" : "fan")
                  }
                />
              </Pressable>
            </View>
          </View>

          <ProfileSwitcher
            visible={profileSwitcherOpen}
            profileType={selectedMode}
            profiles={profiles.map((profile) => ({
              ...profile,
              profileImageUrl:
                profile.profileImageUrl === me?.profileImageUrl
                  ? null
                  : profile.profileImageUrl,
            }))}
            activeProfileId={activeProfile?.id ?? null}
            switchingProfileId={switchingProfileId}
            topInset={insets.top}
            onClose={() => setProfileSwitcherOpen(false)}
            onSelect={(profile) => void switchProfile(profile)}
            onCustomize={openAvatarCustomization}
            onAdd={openProfileCreation}
            onManage={openProfileManagement}
          />

          <View
            style={[
              styles.characterCard,
              compact && styles.characterCardCompact,
              isStar && starLocked && styles.lockedStarCard,
            ]}
          >
            {isStar && !starLocked ? (
              <Image
                source={STAR_SCENE}
                style={StyleSheet.absoluteFill}
                contentFit="cover"
              />
            ) : !isStar ? (
              <View style={styles.fanSceneLayer}>
                <CharacterAvatar
                  uri={characterProfileImageUrl}
                  fallbackSource={FAN_CHARACTER_SCENE}
                  crop="full"
                  style={StyleSheet.absoluteFillObject}
                />
              </View>
            ) : null}
            <LinearGradient
              colors={[styleColors.card, styleColors.card + "EB", styleColors.card + "00"]}
              locations={isStar ? [0, 0.48, 1] : [0, 0.43, 0.64]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 0 }}
              style={StyleSheet.absoluteFill}
            />
            <View style={styles.characterCopy}>
              <Text style={[styles.level, compact && styles.levelCompact]}>
                Lv. {level}
              </Text>
              <View style={styles.xpTrack}>
                <View style={[styles.xpFill, { width: `${xpPercent}%` }]} />
              </View>
              <Text style={styles.xpText}>
                {xpIntoLevel.toLocaleString()} / {nextTarget.toLocaleString()}{" "}
                {isStar ? "STAR XP" : "FAN XP"}
              </Text>
              <Text style={styles.identity} numberOfLines={1}>
                이름: {profileName}{" "}
                <Text style={styles.identityDivider}>│</Text> 직업: {jobName}
              </Text>
              <View style={styles.statDivider} />
              <View style={styles.statList}>
                {stats.map((stat) => (
                  <View key={stat.key} style={styles.statRow}>
                    <Feather
                      name={stat.icon}
                      size={22}
                      color={stat.color}
                      strokeWidth={1.7}
                    />
                    <Text style={styles.statLabel}>{stat.label}</Text>
                    <Text style={styles.statValue}>
                      {stat.value.toLocaleString()}
                    </Text>
                  </View>
                ))}
              </View>
            </View>

            {isStar ? (
              <View
                style={[
                  styles.characterStage,
                  starLocked && styles.lockedCharacterStage,
                ]}
              >
                {!starLocked ? <View style={styles.stageGlow} /> : null}
                {starLocked ? (
                  <Image
                    source={STAR_RANDOM_BOX}
                    style={[
                      styles.characterImage,
                      compact && styles.characterImageCompact,
                      styles.starCharacterImage,
                      styles.lockedRandomBoxImage,
                    ]}
                    contentFit="contain"
                    contentPosition="center"
                  />
                ) : (
                  <CharacterAvatar
                    uri={characterProfileImageUrl ?? starImageUri}
                    fallbackSource={STAR_CHARACTER}
                    crop="full"
                    style={[
                      styles.characterImage,
                      compact && styles.characterImageCompact,
                      styles.starCharacterImage,
                    ]}
                  />
                )}
                {starLocked ? (
                  <Pressable
                    onPress={() =>
                      router.push({
                        pathname: "/(tabs)/persona",
                        params: { focus: "star-nft" },
                      })
                    }
                    style={({ pressed }) => [
                      styles.starLockBadge,
                      pressed && styles.pressed,
                    ]}
                  >
                    <Feather name="lock" size={13} color={styleColors.foreground} />
                    <Text style={styles.starLockText}>NFT 장착하기</Text>
                  </Pressable>
                ) : null}
              </View>
            ) : null}
          </View>

          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>오늘의 미션</Text>
            <Pressable
              accessibilityRole="button"
              onPress={() => router.push("/(tabs)/quests" as never)}
              style={({ pressed }) => [
                styles.moreButton,
                pressed && styles.pressed,
              ]}
            >
              <Text style={styles.moreText}>더보기</Text>
              <Feather name="chevron-right" size={20} color={styleColors.primary} />
            </Pressable>
          </View>

          <View style={styles.missionRow}>
            {homeMissions.map((definition) => {
              const quest = findMission(quests, definition);
              return (
                <MissionCard
                  key={definition.key}
                  definition={definition}
                  progress={
                    quest?.progress ??
                    (definition.key === "daily_attendance" ? 1 : 0)
                  }
                  target={quest?.target ?? definition.fallbackTarget}
                  onPress={() => router.push(definition.route as never)}
                />
              );
            })}
          </View>

          <Pressable
            accessibilityRole="button"
            accessibilityLabel="RARE ON 쇼핑하러 가기"
            onPress={openRareOn}
            style={({ pressed }) => [
              styles.banner,
              pressed && styles.bannerPressed,
            ]}
          >
            <Image
              source={RARE_ON_BANNER}
              style={StyleSheet.absoluteFill}
              contentFit="cover"
            />
            <LinearGradient
              colors={[
                styleColors.card,
                styleColors.card,
                styleColors.card,
              ]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 0 }}
              style={StyleSheet.absoluteFill}
            />
            <View style={styles.bannerCopy}>
              <View style={styles.bannerEyebrow}>
                <Feather name="award" size={15} color={styleColors.mutedForeground} />
                <Text style={styles.bannerEyebrowText}>
                  스타 리미티드 에디션 쇼핑몰
                </Text>
              </View>
              <Text style={styles.bannerTitle}>RARE ON</Text>
              <Text style={styles.bannerDescription} numberOfLines={1}>
                오직 스타를 위한 특별한 아이템을 만나보세요.
              </Text>
              <View style={styles.bannerCta}>
                <Text style={styles.bannerCtaText}>RARE ON 쇼핑하러 가기</Text>
                <Feather name="chevron-right" size={18} color={styleColors.foreground} />
              </View>
            </View>
          </Pressable>
        </View>
      </CustomScrollView>
    </View>
  );
}

function ModeButton({
  mode,
  active,
  disabled,
  onPress,
}: {
  mode: PlayModeChoice;
  active: boolean;
  disabled: boolean;
  onPress: () => void;
}) {
  const styleColors = useColors();
  const styles = useMemo(() => makeStyles(styleColors), [styleColors]);

  const isStar = mode === "star";
  return (
    <Pressable
      accessibilityRole="tab"
      accessibilityState={{ selected: active, disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.modeButton,
        active && styles.modeButtonActive,
        pressed && styles.pressed,
      ]}
    >
      <Feather
        name={isStar ? "star" : "heart"}
        size={22}
        color={active ? styleColors.primaryForeground : styleColors.mutedForeground}
        strokeWidth={1.8}
      />
      <Text style={[styles.modeText, active && styles.modeTextActive]}>
        {isStar ? "STAR" : "FAN"}
      </Text>
    </Pressable>
  );
}

function MissionCard({
  definition,
  progress,
  target,
  onPress,
}: {
  definition: MissionPresentation;
  progress: number;
  target: number;
  onPress: () => void;
}) {
  const styleColors = useColors();
  const styles = useMemo(() => makeStyles(styleColors), [styleColors]);

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${definition.title} 바로가기`}
      onPress={onPress}
      style={({ pressed }) => [
        styles.missionPressable,
        pressed && styles.missionPressed,
      ]}
    >
      <LinearGradient
        colors={[styleColors.accent, styleColors.card, styleColors.card]}
        start={{ x: 0, y: 0 }}
        end={{ x: 0.9, y: 1 }}
        style={[styles.missionCard, { borderColor: styleColors.border }]}
      >
        <View
          style={[
            styles.missionIcon,
            { backgroundColor: styleColors.secondary },
          ]}
        >
          <Feather
            name={definition.icon}
            size={26}
            color={styleColors.primary}
            strokeWidth={1.6}
          />
        </View>
        <Text style={styles.missionTitle} numberOfLines={1}>
          {definition.title}
        </Text>
        <Text style={styles.missionDescription} numberOfLines={3}>
          {definition.description}
        </Text>
        <Text style={styles.missionProgress}>
          {Math.min(progress, target)} / {target}
        </Text>
      </LinearGradient>
    </Pressable>
  );
}

const makeStyles = (styleColors: ReturnType<typeof useColors>) => StyleSheet.create({
  screen: { flex: 1, backgroundColor: styleColors.background },
  scrollContent: { flexGrow: 1, backgroundColor: styleColors.card },
  content: {
    width: "100%",
    maxWidth: 480,
    alignSelf: "center",
    paddingHorizontal: 15,
    gap: 0,
  },
  topBar: {
    height: 55,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 12,
    marginBottom: 10,
  },
  modeTabs: { flexDirection: "row", gap: 5 },
  modeButton: {
    width: 79,
    height: 39,
    borderRadius: radii.control,
    borderWidth: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    backgroundColor: styleColors.card,
  },
  modeButtonActive: {
    backgroundColor: styleColors.primary,
    shadowColor: styleColors.primary,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.52,
    shadowRadius: 10,
    elevation: 5,
  },
  modeText: { color: styleColors.mutedForeground, fontFamily: fonts.medium, fontSize: fontSizes.body },
  modeTextActive: { color: styleColors.primaryForeground, fontFamily: fonts.semibold },
  topActions: { flexDirection: "row", alignItems: "center", gap: 22 },
  bellButton: {
    width: 39,
    height: 39,
    alignItems: "center",
    justifyContent: "center",
    position: "relative",
  },
  notificationDot: {
    position: "absolute",
    right: 3,
    top: 3,
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: styleColors.primary,
    borderWidth: 1,
  },
  avatarRing: {
    width: 43,
    height: 43,
    borderRadius: 22,
    padding: 2,
    backgroundColor: styleColors.secondary,
    borderWidth: 1.5,
    overflow: "hidden",
  },
  avatarFaceCrop: {
    position: "absolute",
    width: "170%",
    height: "170%",
    left: "-35%",
    top: 0,
  },
  characterCard: {
    height: 276,
    borderRadius: 18,
    overflow: "hidden",
    borderWidth: 1,
    backgroundColor: styleColors.card,
    flexDirection: "row",
  },
  characterCardCompact: { height: 248 },
  lockedStarCard: { backgroundColor: styleColors.card },
  fanSceneLayer: {
    position: "absolute",
    top: 0,
    right: 0,
    bottom: 0,
    width: "58%",
    overflow: "hidden",
  },
  characterCopy: {
    width: "49%",
    zIndex: 4,
    paddingTop: 17,
    paddingLeft: 20,
    paddingBottom: 10,
  },
  level: {
    color: styleColors.foreground,
    fontFamily: fonts.semibold,
    fontSize: fontSizes.display,
    letterSpacing: -1.4,
    textShadowColor: "rgba(150,86,255,0.68)",
    textShadowOffset: { width: 0, height: 0 },
    textShadowRadius: 9,
  },
  levelCompact: { fontSize: fontSizes.displayMedium },
  xpTrack: {
    width: "100%",
    height: 6,
    marginTop: 4,
    borderRadius: 5,
    borderWidth: 1,
    backgroundColor: styleColors.card,
    overflow: "hidden",
  },
  xpFill: {
    minWidth: 7,
    height: "100%",
    borderRadius: 4,
    backgroundColor: styleColors.primary,
    shadowColor: styleColors.primary,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 1,
    shadowRadius: 5,
  },
  xpText: {
    color: styleColors.mutedForeground,
    fontFamily: fonts.regular,
    fontSize: fontSizes.small,
    marginTop: 5,
  },
  identity: {
    color: styleColors.mutedForeground,
    fontFamily: fonts.regular,
    fontSize: fontSizes.small,
    marginTop: 7,
  },
  identityDivider: { color: styleColors.mutedForeground },
  statDivider: {
    width: "100%",
    height: StyleSheet.hairlineWidth,
    backgroundColor: styleColors.secondary,
    marginTop: 7,
    marginBottom: 5,
  },
  statList: { gap: 0 },
  statRow: {
    height: 31,
    flexDirection: "row",
    alignItems: "center",
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: styleColors.border,
  },
  statLabel: {
    flex: 1,
    color: styleColors.mutedForeground,
    fontFamily: fonts.regular,
    fontSize: fontSizes.detail,
    marginLeft: 10,
  },
  statValue: {
    color: styleColors.mutedForeground,
    fontFamily: fonts.regular,
    fontSize: fontSizes.detail,
    paddingRight: 4,
  },
  characterStage: {
    position: "absolute",
    top: 7,
    right: -2,
    bottom: 0,
    width: "58%",
    alignItems: "center",
    justifyContent: "flex-end",
  },
  stageGlow: {
    position: "absolute",
    left: "13%",
    right: "2%",
    bottom: 9,
    height: 18,
    borderRadius: 100,
    backgroundColor: styleColors.primary,
    shadowColor: styleColors.primary,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.9,
    shadowRadius: 15,
  },
  characterImage: { width: "94%", height: "96%", zIndex: 2 },
  characterImageCompact: { height: "95%" },
  starCharacterImage: { width: "89%" },
  lockedCharacterStage: {
    top: 0,
    right: 0,
    bottom: 0,
    width: "51%",
    justifyContent: "center",
    paddingVertical: 18,
  },
  lockedRandomBoxImage: {
    width: "68%",
    height: "58%",
    opacity: 0.82,
  },
  starLockBadge: {
    zIndex: 4,
    height: 30,
    marginTop: 4,
    paddingHorizontal: 12,
    borderRadius: 15,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: styleColors.primary,
    borderWidth: 1,
  },
  starLockText: {
    color: styleColors.primaryForeground,
    fontFamily: fonts.semibold,
    fontSize: fontSizes.small,
  },
  sectionHeader: {
    height: 49,
    flexDirection: "row",
    alignItems: "flex-end",
    justifyContent: "space-between",
    paddingHorizontal: 3,
    paddingBottom: 10,
  },
  sectionTitle: {
    color: styleColors.foreground,
    fontFamily: fonts.medium,
    fontSize: fontSizes.titleSmall,
  },
  moreButton: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 3,
  },
  moreText: {
    color: styleColors.mutedForeground,
    fontFamily: fonts.regular,
    fontSize: fontSizes.label,
    marginRight: 4,
  },
  missionRow: { flexDirection: "row", gap: 8 },
  missionPressable: { flex: 1 },
  missionCard: {
    height: 151,
    borderRadius: 16,
    borderWidth: 1,
    overflow: "hidden",
    alignItems: "center",
    paddingHorizontal: 8,
    paddingTop: 10,
    paddingBottom: 8,
  },
  missionIcon: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 7,
  },
  missionTitle: {
    color: styleColors.foreground,
    fontFamily: fonts.semibold,
    fontSize: fontSizes.label,
    textAlign: "center",
  },
  missionDescription: {
    minHeight: 35,
    color: styleColors.mutedForeground,
    fontFamily: fonts.regular,
    fontSize: 10.5,
    lineHeight: 14,
    textAlign: "center",
    marginTop: 5,
  },
  missionProgress: {
    color: styleColors.mutedForeground,
    fontFamily: fonts.regular,
    fontSize: fontSizes.small,
    marginTop: "auto",
  },
  missionPressed: { opacity: 0.78, transform: [{ scale: 0.985 }] },
  banner: {
    height: 145,
    borderRadius: 18,
    overflow: "hidden",
    borderWidth: 1,
    backgroundColor: styleColors.card,
    marginTop: 14,
  },
  bannerPressed: { opacity: 0.88 },
  bannerCopy: {
    position: "absolute",
    left: "49%",
    right: 10,
    top: 18,
    bottom: 14,
    alignItems: "center",
  },
  bannerEyebrow: { flexDirection: "row", alignItems: "center", gap: 5 },
  bannerEyebrowText: {
    color: styleColors.mutedForeground,
    fontFamily: fonts.regular,
    fontSize: 10.5,
  },
  bannerTitle: {
    color: styleColors.foreground,
    fontFamily: fonts.medium,
    fontSize: 30,
    letterSpacing: 1.2,
    marginTop: 1,
    textShadowColor: styleColors.primary,
    textShadowOffset: { width: 0, height: 0 },
    textShadowRadius: 8,
  },
  bannerDescription: {
    width: "100%",
    color: styleColors.mutedForeground,
    fontFamily: fonts.regular,
    fontSize: 9.5,
    textAlign: "center",
    marginTop: 2,
  },
  bannerCta: {
    width: "92%",
    height: 30,
    borderRadius: 15,
    borderWidth: 1,
    backgroundColor: styleColors.primary,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    marginTop: "auto",
  },
  bannerCtaText: {
    color: styleColors.foreground,
    fontFamily: fonts.medium,
    fontSize: fontSizes.small,
  },
  pressed: { opacity: 0.7 },
});
