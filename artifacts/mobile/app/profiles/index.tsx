import { useMemo } from "react";
import { useColors } from "@/hooks/useColors";
import { fonts, fontSizes, radii } from "@/constants/designSystem";
import { Feather } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import React from "react";
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useGetMe } from "@workspace/api-client-react";
import { NeonBackdrop } from "@/components/NeonUI";
import { Avatar } from "@/components/Avatar";
import {
  type CharacterProfileType,
  type CharacterProfileView,
  useCharacterProfiles,
} from "@/hooks/useCharacterProfiles";
import { crossAlert } from "@/lib/crossAlert";

type ProfileMode = Extract<CharacterProfileType, "fan" | "star">;

function ProfileRow({
  profile,
  accountProfileImageUrl,
  busy,
  onActivate,
  onEdit,
  onCustomize,
  onArchive,
}: {
  profile: CharacterProfileView;
  accountProfileImageUrl?: string | null;
  busy: boolean;
  onActivate: () => void;
  onEdit: () => void;
  onCustomize: () => void;
  onArchive: () => void;
}) {
  const styleColors = useColors();
  const styles = useMemo(() => makeStyles(styleColors), [styleColors]);

  const characterImageUrl = profile.profileImageUrl !== accountProfileImageUrl ? profile.profileImageUrl : null;
  const status =
    profile.status === "torimia"
      ? "토르미아"
      : profile.status === "locked"
        ? "사용 잠김"
        : profile.isActive
          ? "현재 사용 중"
          : "사용 가능";

  return (
    <View style={[styles.profileCard, profile.isActive && styles.profileCardActive]}>
      <View style={styles.profileMain}>
        <View style={[styles.avatarRing, profile.isActive && styles.avatarRingActive]}>
          <Avatar uri={characterImageUrl} name={profile.displayName} size={62} crop="face" characterType={profile.type} />
        </View>
        <View style={styles.identity}>
          <View style={styles.nameRow}>
            <Text style={styles.profileName} numberOfLines={1}>{profile.displayName}</Text>
            <View style={styles.typeBadge}>
              <Text style={styles.typeBadgeText}>{profile.type.toUpperCase()}</Text>
            </View>
          </View>
          <Text style={styles.handle}>@{profile.handle}</Text>
          <Text style={styles.meta}>Lv.{profile.level} · {status}</Text>
        </View>
      </View>
      <View style={styles.actions}>
        <Pressable
          disabled={
            busy ||
            profile.isActive ||
            (profile.status !== "active" && profile.status !== "torimia")
          }
          onPress={onActivate}
          style={({ pressed }) => [
            styles.primaryAction,
            (busy ||
              profile.isActive ||
              (profile.status !== "active" && profile.status !== "torimia")) &&
              styles.disabled,
            pressed && styles.pressed,
          ]}
        >
          <Text style={styles.primaryActionText}>{profile.isActive ? "사용 중" : "이 프로필 사용"}</Text>
        </Pressable>
        {profile.type === "fan" || profile.profileImageUrl?.startsWith("anotherme-avatar:") ? <Pressable disabled={busy} onPress={onCustomize} style={({ pressed }) => [styles.iconAction, pressed && styles.pressed]}>
          <Feather name="sliders" size={17} color={styleColors.mutedForeground} />
        </Pressable> : null}
        <Pressable disabled={busy} onPress={onEdit} style={({ pressed }) => [styles.iconAction, pressed && styles.pressed]}>
          <Feather name="edit-2" size={17} color={styleColors.mutedForeground} />
        </Pressable>
        <Pressable disabled={busy} onPress={onArchive} style={({ pressed }) => [styles.iconAction, pressed && styles.pressed]}>
          <Feather name="archive" size={17} color={styleColors.mutedForeground} />
        </Pressable>
      </View>
    </View>
  );
}

export default function ProfilesScreen() {
  const styleColors = useColors();
  const styles = useMemo(() => makeStyles(styleColors), [styleColors]);

  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { data: me } = useGetMe();
  const {
    activeProfile,
    profiles,
    isLoading,
    isActivating,
    isArchiving,
    activateProfile,
    archiveProfile,
    refetch,
  } = useCharacterProfiles();
  const [mode, setMode] = React.useState<ProfileMode>(activeProfile?.type === "star" ? "star" : "fan");
  const [refreshing, setRefreshing] = React.useState(false);
  const busy = isActivating || isArchiving;
  const goBack = React.useCallback(() => {
    if (router.canGoBack()) {
      router.back();
      return;
    }
    router.replace("/(tabs)" as never);
  }, [router]);

  React.useEffect(() => {
    if (activeProfile?.type === "fan" || activeProfile?.type === "star") setMode(activeProfile.type);
  }, [activeProfile?.type]);

  const visibleProfiles = profiles.filter((profile) => profile.type === mode && profile.status !== "archived");
  const canAddFan =
    profiles.every((profile) => profile.type !== "fan") ||
    profiles.some(
      (profile) =>
        profile.type === "fan" &&
        (profile.status === "torimia" || profile.level >= 50),
    );
  const openCreation = () => {
    if (mode === "fan" && !canAddFan) {
      crossAlert(
        "FAN 추가 잠김",
        "기존 FAN이 토르미아 또는 Lv.50에 도달하면 새 FAN을 추가할 수 있어요. 기존 프로필은 변경되지 않습니다.",
      );
      return;
    }
    router.push((mode === "fan" ? "/profile/create-fan" : "/profiles/summon-star") as never);
  };
  const refresh = async () => {
    setRefreshing(true);
    try { await refetch(); } finally { setRefreshing(false); }
  };
  const activate = async (profile: CharacterProfileView) => {
    try { await activateProfile(profile.id); }
    catch { crossAlert("프로필 전환 실패", "현재 사용할 수 있는 프로필인지 확인해 주세요."); }
  };
  const archive = (profile: CharacterProfileView) => {
    crossAlert(
      "프로필 보관",
      `${profile.displayName} 프로필을 보관할까요?\n게시물과 채팅 기록은 삭제되지 않습니다.`,
      [
        {
          text: "보관",
          style: "destructive",
          onPress: () => void archiveProfile(profile.id).catch(() =>
            crossAlert("보관 실패", "마지막 프로필은 보관할 수 없어요."),
          ),
        },
        { text: "취소", style: "cancel" },
      ],
    );
  };

  return (
    <NeonBackdrop style={styles.root}>
      <View style={[styles.header, { paddingTop: insets.top + 8 }]}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="홈으로 돌아가기"
          hitSlop={12}
          onPress={goBack}
        >
          <Feather name="arrow-left" size={29} color={styleColors.foreground} />
        </Pressable>
        <Text style={styles.title}>프로필 관리</Text>
        <View style={{ width: 29 }} />
      </View>
      <ScrollView
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 40 }]}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={styleColors.primary} />}
      >
        <Text style={styles.lead}>활동할 모드를 선택한 뒤, 그 모드 안에서 캐릭터 프로필을 전환하세요.</Text>
        <View style={styles.tabs}>
          {(["fan", "star"] as const).map((item) => (
            <Pressable key={item} onPress={() => setMode(item)} style={[styles.tab, mode === item && styles.tabActive]}>
              <Feather name={item === "fan" ? "heart" : "star"} size={17} color={mode === item ? styleColors.primaryForeground : styleColors.mutedForeground} />
              <Text style={[styles.tabText, mode === item && styles.tabTextActive]}>{item.toUpperCase()}</Text>
            </Pressable>
          ))}
        </View>
        <View style={styles.sectionHeader}>
          <View style={styles.sectionCopy}>
            <Text style={styles.sectionTitle}>{mode.toUpperCase()} 프로필</Text>
            <Text style={styles.sectionSub}>
              {mode === "fan" ? "응원과 소셜 활동을 위한 독립 캐릭터" : "NFT 소유권으로 소환한 성장 캐릭터"}
            </Text>
          </View>
          <Pressable
            onPress={openCreation}
            style={({ pressed }) => [
              styles.addButton,
              mode === "fan" && !canAddFan && styles.addButtonLocked,
              pressed && styles.pressed,
            ]}
          >
            <Feather
              name={mode === "fan" && !canAddFan ? "lock" : "plus"}
              size={16}
              color={styleColors.foreground}
            />
            <Text style={styles.addButtonText}>
              {mode === "fan"
                ? canAddFan
                  ? "FAN 추가"
                  : "추가 잠김"
                : "STAR 소환"}
            </Text>
          </Pressable>
        </View>
        {isLoading ? (
          <View style={styles.center}><ActivityIndicator color={styleColors.primary} /></View>
        ) : visibleProfiles.length ? (
          <View style={styles.list}>
            {visibleProfiles.map((profile) => (
              <ProfileRow
                key={profile.id}
                profile={profile}
                accountProfileImageUrl={me?.profileImageUrl}
                busy={busy}
                onActivate={() => void activate(profile)}
                onCustomize={() => router.push({ pathname: "/profile/avatar", params: { profileId: profile.id } } as never)}
                onEdit={() => router.push({ pathname: "/profile/edit", params: { profileId: profile.id } } as never)}
                onArchive={() => archive(profile)}
              />
            ))}
          </View>
        ) : (
          <View style={styles.empty}>
            <Feather name={mode === "fan" ? "heart" : "star"} size={29} color={styleColors.primary} />
            <Text style={styles.emptyTitle}>{mode.toUpperCase()} 프로필이 없어요</Text>
            <Text style={styles.emptyBody}>
              {mode === "fan"
                ? "새 FAN 캐릭터를 만들어 활동을 시작하세요."
                : "지갑을 연결하고 허용 NFT의 소유권을 확인하면 STAR를 소환할 수 있어요."}
            </Text>
          </View>
        )}
      </ScrollView>
    </NeonBackdrop>
  );
}

const makeStyles = (styleColors: ReturnType<typeof useColors>) => StyleSheet.create({
  root: { flex: 1, backgroundColor: styleColors.background },
  header: { minHeight: 62, paddingHorizontal: 18, paddingBottom: 12, flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  title: { color: styleColors.foreground, fontSize: fontSizes.titleLarge, fontFamily: fonts.bold },
  content: { paddingHorizontal: 18, gap: 18 },
  lead: { color: styleColors.mutedForeground, fontSize: fontSizes.detail, lineHeight: 20 },
  tabs: { padding: 4, borderRadius: 16, borderWidth: 1, borderColor: styleColors.border, backgroundColor: styleColors.card, flexDirection: "row" },
  tab: { flex: 1, minHeight: 46, borderRadius: 13, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 7 },
  tabActive: { backgroundColor: styleColors.primary },
  tabText: { color: styleColors.mutedForeground, fontFamily: fonts.bold, fontSize: fontSizes.label },
  tabTextActive: { color: styleColors.primaryForeground },
  sectionHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12 },
  sectionCopy: { flex: 1 },
  sectionTitle: { color: styleColors.foreground, fontFamily: fonts.bold, fontSize: fontSizes.heading },
  sectionSub: { color: styleColors.mutedForeground, fontSize: fontSizes.small, marginTop: 4 },
  addButton: { minHeight: 40, paddingHorizontal: 13, borderRadius: radii.control, backgroundColor: styleColors.primary, flexDirection: "row", alignItems: "center", gap: 5 },
  addButtonLocked: { backgroundColor: styleColors.secondary },
  addButtonText: { color: styleColors.primaryForeground, fontFamily: fonts.bold, fontSize: fontSizes.caption },
  list: { gap: 12 },
  profileCard: { padding: 14, borderRadius: 18, borderWidth: 1, borderColor: styleColors.border, backgroundColor: styleColors.card, gap: 13 },
  profileCardActive: { borderColor: styleColors.primary, backgroundColor: styleColors.secondary },
  profileMain: { flexDirection: "row", alignItems: "center", gap: 13 },
  avatarRing: { width: 66, height: 66, borderRadius: 33, overflow: "hidden", borderWidth: 1, borderColor: styleColors.border, backgroundColor: styleColors.secondary },
  avatarRingActive: { borderColor: styleColors.primary, borderWidth: 2 },
  avatar: { width: "100%", height: "100%" },
  fanAvatarFaceCrop: {
    position: "absolute",
    width: "175%",
    height: "175%",
    left: "-37.5%",
    top: 0,
  },
  identity: { flex: 1, minWidth: 0 },
  nameRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  profileName: { flexShrink: 1, color: styleColors.foreground, fontFamily: fonts.bold, fontSize: fontSizes.headingSmall },
  typeBadge: { borderRadius: 7, backgroundColor: styleColors.primary, paddingHorizontal: 7, paddingVertical: 3 },
  typeBadgeText: { color: styleColors.primaryForeground, fontFamily: fonts.bold, fontSize: fontSizes.tiny },
  handle: { color: styleColors.mutedForeground, fontSize: fontSizes.caption, marginTop: 4 },
  meta: { color: styleColors.mutedForeground, fontSize: fontSizes.small, marginTop: 4 },
  actions: { flexDirection: "row", alignItems: "center", gap: 8 },
  primaryAction: { flex: 1, minHeight: 40, borderRadius: 11, backgroundColor: styleColors.primary, alignItems: "center", justifyContent: "center" },
  primaryActionText: { color: styleColors.primaryForeground, fontFamily: fonts.bold, fontSize: fontSizes.caption },
  iconAction: { width: 40, height: 40, borderRadius: 11, borderWidth: 1, borderColor: styleColors.border, alignItems: "center", justifyContent: "center" },
  center: { minHeight: 180, alignItems: "center", justifyContent: "center" },
  empty: { minHeight: 210, padding: 28, borderRadius: radii.card, borderWidth: 1, borderColor: styleColors.border, backgroundColor: styleColors.card, alignItems: "center", justifyContent: "center", gap: 9 },
  emptyTitle: { color: styleColors.foreground, fontFamily: fonts.bold, fontSize: fontSizes.input },
  emptyBody: { color: styleColors.mutedForeground, fontSize: fontSizes.caption, lineHeight: 18, textAlign: "center" },
  disabled: { opacity: 0.45 },
  pressed: { opacity: 0.72 },
});
