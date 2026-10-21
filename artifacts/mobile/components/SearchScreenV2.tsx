import { useMemo } from "react";
import { useColors } from "@/hooks/useColors";
import { fonts, fontSizes, radii } from "@/constants/designSystem";
import { Feather } from "@expo/vector-icons";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Image } from "expo-image";
import { LinearGradient } from "expo-linear-gradient";
import { useRouter } from "expo-router";
import React from "react";
import { ActivityIndicator, Alert, Modal, Pressable, StyleSheet, Text, TextInput, View, useWindowDimensions } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Avatar } from "@/components/Avatar";
import { CustomScrollView } from "@/components/CustomScroll";
import { NeonBackdrop } from "@/components/NeonUI";
import { customFetch } from "@workspace/api-client-react";

type ProfileType = "fan" | "star" | "official_ai";
type SearchType = "all" | "users" | "stars" | "fans" | "posts" | "missions";
type Profile = {
  id: string;
  type: ProfileType;
  handle: string;
  displayName: string;
  profileImageUrl: string | null;
  statusMessage: string | null;
  level: number;
  followedByMe: boolean;
  recommendationReason: string;
};
type SearchResponse = {
  users: Array<{
    id: string;
    nickname: string;
    profileImageUrl: string | null;
    statusMessage: string | null;
    profileType?: ProfileType;
    handle?: string;
    followedByMe?: boolean;
  }>;
  posts: Array<{ id: string; title: string; body: string; kind: string; createdAt: string }>;
  missions?: Array<{ key: string; type: "daily" | "weekly"; title: string; description: string; target: number; rewardExp: number }>;
};
type TrendingResponse = { items: Array<{ term: string; rank: number; change: number; resultCount: number }> };

const FILTERS: Array<{ key: SearchType; label: string; icon: React.ComponentProps<typeof Feather>["name"] }> = [
  { key: "all", label: "전체", icon: "search" },
  { key: "users", label: "프로필", icon: "users" },
  { key: "stars", label: "STAR", icon: "star" },
  { key: "fans", label: "FAN", icon: "heart" },
  { key: "posts", label: "게시물", icon: "file-text" },
  { key: "missions", label: "미션", icon: "flag" },
];

function modeLabel(type: ProfileType) {
  return type === "fan" ? "FAN" : type === "official_ai" ? "OFFICIAL" : "STAR";
}

function More({ open, onPress }: { open?: boolean; onPress: () => void }) {
  const styleColors = useColors();
  const styles = useMemo(() => makeStyles(styleColors), [styleColors]);

  return (
    <Pressable onPress={onPress} hitSlop={10} style={styles.more}>
      <Text style={styles.moreText}>{open ? "접기" : "더보기"}</Text>
      <Feather name={open ? "chevron-up" : "chevron-right"} size={17} color={styleColors.mutedForeground} />
    </Pressable>
  );
}

function Section({ icon, title, action, children, style }: {
  icon: React.ComponentProps<typeof Feather>["name"];
  title: string;
  action?: React.ReactNode;
  children: React.ReactNode;
  style?: object;
}) {
  const styleColors = useColors();
  const styles = useMemo(() => makeStyles(styleColors), [styleColors]);

  return (
    <LinearGradient colors={[styleColors.card, styleColors.card]} style={[styles.section, style]}>
      <View pointerEvents="none" style={styles.glow} />
      <View style={styles.sectionHead}>
        <View style={styles.sectionTitleRow}>
          <Feather name={icon} size={18} color={styleColors.primary} />
          <Text style={styles.sectionTitle}>{title}</Text>
        </View>
        {action}
      </View>
      {children}
    </LinearGradient>
  );
}

function ProfileAvatar({ profile, size }: { profile: Profile; size: number }) {
  const styleColors = useColors();
  const styles = useMemo(() => makeStyles(styleColors), [styleColors]);

  return (
    <View style={[styles.avatarRing, { width: size + 4, height: size + 4, borderRadius: (size + 4) / 2 }]}>
      <Avatar
        uri={profile.profileImageUrl}
        name={profile.displayName}
        size={size}
        crop="face"
        characterType={profile.type}
      />
      <View style={styles.typeBadge}>
        <Feather name={profile.type === "fan" ? "user" : "star"} size={11} color={styleColors.primaryForeground} />
      </View>
    </View>
  );
}

function ProfileRow({ profile, following, pending, onOpen, onFollow, last }: {
  profile: Profile;
  following: boolean;
  pending: boolean;
  onOpen: () => void;
  onFollow: () => void;
  last: boolean;
}) {
  const styleColors = useColors();
  const styles = useMemo(() => makeStyles(styleColors), [styleColors]);

  return (
    <View style={[styles.profileRow, !last && styles.divider]}>
      <Pressable onPress={onOpen} style={({ pressed }) => [styles.profileMain, pressed && styles.pressed]}>
        <ProfileAvatar profile={profile} size={54} />
        <View style={styles.profileCopy}>
          <Text style={styles.profileName} numberOfLines={1}>{profile.displayName}</Text>
          <Text style={styles.profileReason} numberOfLines={1}>{profile.recommendationReason}</Text>
        </View>
      </Pressable>
      <Pressable disabled={pending} onPress={onFollow} style={[styles.follow, following && styles.following]}>
        {pending ? <ActivityIndicator size="small" color={styleColors.primary} /> : (
          <Text style={[styles.followText, following && styles.followingText]}>{following ? "팔로잉" : "팔로우"}</Text>
        )}
      </Pressable>
    </View>
  );
}

export default function SearchScreenV2() {
  const styleColors = useColors();
  const styles = useMemo(() => makeStyles(styleColors), [styleColors]);

  const insets = useSafeAreaInsets();
  const router = useRouter();
  const queryClient = useQueryClient();
  const { width } = useWindowDimensions();
  const [text, setText] = React.useState("");
  const [query, setQuery] = React.useState("");
  const [filter, setFilter] = React.useState<SearchType>("all");
  const [pendingFilter, setPendingFilter] = React.useState<SearchType>("all");
  const [filterOpen, setFilterOpen] = React.useState(false);
  const [allTrending, setAllTrending] = React.useState(false);
  const [allProfiles, setAllProfiles] = React.useState(false);
  const [followState, setFollowState] = React.useState<Record<string, boolean>>({});

  React.useEffect(() => {
    const timer = setTimeout(() => setQuery(text.trim()), 300);
    return () => clearTimeout(timer);
  }, [text]);

  const searching = query.length >= 2;
  const avatarSize = Math.max(54, Math.min(72, Math.floor((width - 104) / 4)));
  const recommendations = useQuery({
    queryKey: ["search-recommendations"],
    queryFn: () => customFetch<{ items: Profile[] }>("/api/search/recommendations?limit=12", { responseType: "json" }),
    staleTime: 60_000,
  });
  const trending = useQuery({
    queryKey: ["search-trending"],
    queryFn: () => customFetch<TrendingResponse>("/api/search/trending?limit=10", { responseType: "json" }),
    staleTime: 300_000,
  });
  const results = useQuery({
    queryKey: ["global-search", query.toLocaleLowerCase(), filter],
    enabled: searching,
    queryFn: () => customFetch<SearchResponse>(`/api/search?q=${encodeURIComponent(query)}&type=${filter}&limit=20`, { responseType: "json" }),
    staleTime: 30_000,
  });
  const follow = useMutation({
    mutationFn: ({ id, next }: { id: string; next: boolean }) => customFetch<{ following: boolean }>(`/api/profiles/${id}/follow`, {
      method: next ? "POST" : "DELETE",
      responseType: "json",
    }),
    onMutate: ({ id, next }) => setFollowState((state) => ({ ...state, [id]: next })),
    onError: (_error, variables) => {
      setFollowState((state) => {
        const next = { ...state };
        delete next[variables.id];
        return next;
      });
      Alert.alert("팔로우하지 못했어요", "잠시 후 다시 시도해 주세요.");
    },
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["search-recommendations"] }),
        queryClient.invalidateQueries({ queryKey: ["global-search"] }),
      ]);
    },
  });

  const profiles = recommendations.data?.items ?? [];
  const searchProfiles: Profile[] = (results.data?.users ?? []).map((item) => ({
    id: item.id,
    type: item.profileType ?? "fan",
    handle: item.handle ?? "",
    displayName: item.nickname,
    profileImageUrl: item.profileImageUrl,
    statusMessage: item.statusMessage,
    level: 1,
    followedByMe: item.followedByMe ?? false,
    recommendationReason: item.statusMessage || (item.profileType === "fan" ? "함께 응원할 새로운 친구" : "추천 STAR"),
  }));
  const searchPosts = results.data?.posts ?? [];
  const searchMissions = results.data?.missions ?? [];
  const openProfile = (id: string) => router.push({ pathname: "/(tabs)/character/[profileId]", params: { profileId: id } } as never);
  const toggleFollow = (profile: Profile) => {
    const current = followState[profile.id] ?? profile.followedByMe;
    follow.mutate({ id: profile.id, next: !current });
  };
  const renderRows = (items: Profile[]) => items.map((profile, index) => (
    <ProfileRow
      key={profile.id}
      profile={profile}
      following={followState[profile.id] ?? profile.followedByMe}
      pending={follow.isPending && follow.variables?.id === profile.id}
      onOpen={() => openProfile(profile.id)}
      onFollow={() => toggleFollow(profile)}
      last={index === items.length - 1}
    />
  ));

  return (
    <NeonBackdrop>
      <CustomScrollView
        style={styles.scroll}
        contentContainerStyle={[styles.content, { paddingTop: insets.top + 10 }]}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.searchBox}>
          <Feather name="search" size={25} color={styleColors.mutedForeground} />
          <TextInput
            value={text}
            onChangeText={setText}
            accessibilityLabel="통합 검색"
            placeholder="비비, 팬아트, 팬, 미션 검색"
            placeholderTextColor={styleColors.mutedForeground}
            style={styles.input}
            autoCapitalize="none"
            autoCorrect={false}
            returnKeyType="search"
          />
          {text ? <Pressable accessibilityRole="button" accessibilityLabel="검색어 지우기" onPress={() => setText("")} hitSlop={10}><Feather name="x-circle" size={20} color={styleColors.mutedForeground} /></Pressable> : null}
          <Pressable accessibilityRole="button" accessibilityLabel="검색 필터 열기" onPress={() => { setPendingFilter(filter); setFilterOpen(true); }} hitSlop={10}>
            <Feather name="sliders" size={23} color={styleColors.primary} />
          </Pressable>
        </View>

        {!searching ? (
          <>
            <Pressable accessibilityRole="button" accessibilityLabel="STAR 등록하기" onPress={() => router.push("/pvt/wallet" as never)} style={({ pressed }) => [styles.hero, pressed && styles.pressed]}>
              <Image source={require("../assets/images/search-star-banner.png")} style={styles.heroImage} contentFit="cover" contentPosition={{ top: "15%" }} />
              <LinearGradient colors={[styleColors.card, styleColors.card + "E8", styleColors.card + "00"]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={styles.heroOverlay}>
                <Text style={styles.heroTitle}>NFT로 STAR 소환</Text>
                <Text style={styles.heroSubtitle}>나만의 STAR를 생성 시작해보세요.</Text>
                <View style={styles.heroCta}><Text style={styles.heroCtaText}>STAR 등록하기</Text><Feather name="chevron-right" size={19} color={styleColors.primaryForeground} /></View>
              </LinearGradient>
            </Pressable>

            <Section icon="zap" title="인기 검색어" style={styles.trendingSection} action={<More open={allTrending} onPress={() => setAllTrending((value) => !value)} />}>
              {trending.isLoading ? <ActivityIndicator color={styleColors.primary} style={styles.loader} /> : (trending.data?.items.length ?? 0) > 0 ? (
                <View style={styles.trendingList}>
                  {(trending.data?.items ?? []).slice(0, allTrending ? 10 : 5).map((item) => (
                    <Pressable key={item.term} onPress={() => setText(item.term)} style={styles.trendingItem}>
                      <Text style={styles.rank}>{item.rank}</Text><Text style={styles.term} numberOfLines={1}>{item.term}</Text>
                      {item.change ? <Feather name={item.change > 0 ? "arrow-up" : "arrow-down"} size={13} color={item.change > 0 ? "#F05AFF" : "#52E7FF"} /> : <Text style={styles.same}>-</Text>}
                    </Pressable>
                  ))}
                </View>
              ) : <Text style={styles.emptyTrending}>아직 인기 검색어가 없습니다.</Text>}
            </Section>

            <Section icon="star" title="추천 STAR / FAN" style={styles.featuredSection} action={<More open={allProfiles} onPress={() => setAllProfiles((value) => !value)} />}>
              {recommendations.isLoading ? <ActivityIndicator color={styleColors.primary} style={styles.featuredLoader} /> : profiles.length ? (
                <View style={styles.featuredRow}>
                  {profiles.slice(0, 4).map((profile) => (
                    <Pressable key={profile.id} onPress={() => openProfile(profile.id)} style={styles.featuredProfile}>
                      <ProfileAvatar profile={profile} size={avatarSize} />
                      <Text style={styles.featuredName} numberOfLines={1}>{profile.displayName}</Text>
                      <Text style={styles.featuredType}>{modeLabel(profile.type)}</Text>
                    </Pressable>
                  ))}
                </View>
              ) : <Text style={styles.emptyTrending}>추천할 프로필을 준비하고 있습니다.</Text>}
            </Section>

            {profiles.length ? <LinearGradient colors={[styleColors.card, styleColors.card]} style={styles.profileCard}>
              {renderRows(allProfiles ? profiles : profiles.slice(0, 4))}
            </LinearGradient> : null}
          </>
        ) : (
          <>
            <View style={styles.summary}>
              <Text style={styles.summaryText}><Text style={styles.summaryStrong}>‘{query}’</Text> {FILTERS.find((item) => item.key === filter)?.label} 검색 결과</Text>
              {results.isFetching ? <ActivityIndicator size="small" color={styleColors.primary} /> : null}
            </View>
            {results.isError ? <View style={styles.emptySearch}><Text style={styles.emptyTitle}>검색 결과를 불러오지 못했어요.</Text><Pressable onPress={() => results.refetch()} style={styles.retry}><Text style={styles.retryText}>다시 시도</Text></Pressable></View>
              : results.isLoading ? <ActivityIndicator color={styleColors.primary} style={styles.searchLoader} />
                : <>
                  {searchProfiles.length ? <Section icon="users" title="프로필"><View style={styles.resultList}>{renderRows(searchProfiles)}</View></Section> : null}
                  {searchPosts.length ? <Section icon="file-text" title="게시물"><View style={styles.resultList}>{searchPosts.map((post) => (
                    <Pressable key={post.id} onPress={() => router.push({ pathname: "/post/[postId]", params: { postId: post.id } } as never)} style={styles.resultRow}>
                      <View style={styles.resultIcon}><Feather name="file-text" size={19} color={styleColors.primary} /></View>
                      <View style={styles.resultCopy}><Text style={styles.resultTitle} numberOfLines={1}>{post.title || post.body}</Text><Text style={styles.resultDesc} numberOfLines={2}>{post.body}</Text></View>
                      <Feather name="chevron-right" size={18} color={styleColors.mutedForeground} />
                    </Pressable>
                  ))}</View></Section> : null}
                  {searchMissions.length ? <Section icon="flag" title="미션"><View style={styles.resultList}>{searchMissions.map((mission) => (
                    <Pressable key={mission.key} onPress={() => router.push("/(tabs)/persona" as never)} style={styles.resultRow}>
                      <View style={styles.resultIcon}><Feather name="flag" size={19} color={styleColors.primary} /></View>
                      <View style={styles.resultCopy}><Text style={styles.resultTitle}>{mission.title}</Text><Text style={styles.resultDesc} numberOfLines={2}>{mission.description}</Text></View>
                      <Text style={styles.reward}>+{mission.rewardExp} XP</Text>
                    </Pressable>
                  ))}</View></Section> : null}
                  {!searchProfiles.length && !searchPosts.length && !searchMissions.length ? <View style={styles.emptySearch}><Feather name="search" size={30} color={styleColors.mutedForeground} /><Text style={styles.emptyTitle}>검색 결과가 없습니다.</Text><Text style={styles.emptyBody}>다른 검색어나 필터를 사용해 보세요.</Text></View> : null}
                </>}
          </>
        )}
      </CustomScrollView>

      <Modal visible={filterOpen} transparent animationType="slide" onRequestClose={() => setFilterOpen(false)}>
        <View style={styles.modalOverlay}>
          <Pressable style={StyleSheet.absoluteFill} onPress={() => setFilterOpen(false)} />
          <View style={[styles.sheet, { paddingBottom: Math.max(28, insets.bottom + 18) }]}>
            <View style={styles.handle} />
            <View style={styles.sheetHead}><Text style={styles.sheetTitle}>검색 필터</Text><Pressable onPress={() => setFilterOpen(false)}><Feather name="x" size={22} color={styleColors.mutedForeground} /></Pressable></View>
            <View style={styles.filterGrid}>{FILTERS.map((item) => {
              const active = pendingFilter === item.key;
              return <Pressable key={item.key} onPress={() => setPendingFilter(item.key)} style={[styles.filterOption, active && styles.filterActive]}>
                <Feather name={item.icon} size={18} color={active ? "#C653FF" : styleColors.mutedForeground} /><Text style={[styles.filterText, active && styles.filterTextActive]}>{item.label}</Text>
              </Pressable>;
            })}</View>
            <Pressable onPress={() => { setFilter(pendingFilter); setFilterOpen(false); }} style={styles.apply}><Text style={styles.applyText}>적용</Text></Pressable>
          </View>
        </View>
      </Modal>
    </NeonBackdrop>
  );
}

const makeStyles = (styleColors: ReturnType<typeof useColors>) => StyleSheet.create({
  scroll: { flex: 1 },
  content: { paddingHorizontal: 14, paddingBottom: 118, gap: 12 },
  pressed: { opacity: 0.72 },
  searchBox: { minHeight: 45, borderRadius: 24, borderWidth: 1, borderColor: styleColors.border, backgroundColor: styleColors.card, paddingHorizontal: 16, flexDirection: "row", alignItems: "center", gap: 12 },
  input: { flex: 1, color: styleColors.foreground, fontFamily: fonts.regular, fontSize: fontSizes.body, paddingVertical: 10 },
  hero: { height: 154, borderRadius: 15, borderWidth: StyleSheet.hairlineWidth, borderColor: styleColors.border, overflow: "hidden", backgroundColor: styleColors.card },
  heroImage: { width: "100%", height: "100%" },
  heroOverlay: { ...StyleSheet.absoluteFillObject, justifyContent: "center", paddingHorizontal: 22, gap: 7 },
  heroTitle: { width: "60%", color: styleColors.foreground, fontFamily: fonts.bold, fontSize: fontSizes.title, letterSpacing: -0.7 },
  heroSubtitle: { width: "60%", color: styleColors.mutedForeground, fontFamily: fonts.regular, fontSize: fontSizes.label },
  heroCta: { alignSelf: "flex-start", minHeight: 38, flexDirection: "row", alignItems: "center", gap: 4, marginTop: 7, paddingHorizontal: 16, borderRadius: radii.card, backgroundColor: styleColors.primary },
  heroCtaText: { color: styleColors.primaryForeground, fontFamily: fonts.semibold, fontSize: fontSizes.label },
  section: { borderRadius: 14, borderWidth: StyleSheet.hairlineWidth, borderColor: styleColors.border, paddingHorizontal: 14, paddingTop: 12, paddingBottom: 14, overflow: "hidden" },
  glow: { position: "absolute", right: -50, top: -55, width: 145, height: 130, borderRadius: 72, backgroundColor: styleColors.primary },
  sectionHead: { minHeight: 28, flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  sectionTitleRow: { flexDirection: "row", alignItems: "center", gap: 9 },
  sectionTitle: { color: styleColors.foreground, fontFamily: fonts.semibold, fontSize: fontSizes.headingSmall },
  more: { flexDirection: "row", alignItems: "center", gap: 2, paddingVertical: 3 },
  moreText: { color: styleColors.mutedForeground, fontFamily: fonts.regular, fontSize: fontSizes.detail },
  trendingSection: { minHeight: 82 },
  loader: { minHeight: 42 },
  emptyTrending: { color: styleColors.mutedForeground, fontFamily: fonts.regular, fontSize: fontSizes.label, paddingTop: 18, paddingBottom: 3, textAlign: "center" },
  trendingList: { marginTop: 8, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: styleColors.border },
  trendingItem: { minHeight: 34, flexDirection: "row", alignItems: "center", gap: 9 },
  rank: { width: 18, color: styleColors.primary, fontFamily: fonts.bold, fontSize: fontSizes.detail },
  term: { flex: 1, color: styleColors.mutedForeground, fontFamily: fonts.regular, fontSize: fontSizes.detail },
  same: { color: styleColors.mutedForeground, fontSize: fontSizes.detail },
  featuredSection: { minHeight: 164 },
  featuredLoader: { minHeight: 116 },
  featuredRow: { minHeight: 118, flexDirection: "row", alignItems: "flex-start", paddingTop: 10 },
  featuredProfile: { flex: 1, minWidth: 0, alignItems: "center", gap: 4 },
  avatarRing: { alignItems: "center", justifyContent: "center", borderWidth: 2, borderColor: styleColors.border, backgroundColor: styleColors.secondary },
  typeBadge: { position: "absolute", right: -2, top: -2, width: 23, height: 23, borderRadius: radii.control, alignItems: "center", justifyContent: "center", backgroundColor: styleColors.primary, borderWidth: 2, borderColor: styleColors.border },
  featuredName: { width: "100%", paddingHorizontal: 2, color: styleColors.foreground, fontFamily: fonts.medium, fontSize: fontSizes.detail, textAlign: "center" },
  featuredType: { color: styleColors.primary, fontFamily: fonts.medium, fontSize: fontSizes.caption },
  profileCard: { borderRadius: 14, borderWidth: StyleSheet.hairlineWidth, borderColor: styleColors.border, paddingHorizontal: 14, overflow: "hidden" },
  profileRow: { minHeight: 78, flexDirection: "row", alignItems: "center", gap: 12 },
  divider: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: styleColors.border },
  profileMain: { flex: 1, minWidth: 0, flexDirection: "row", alignItems: "center", gap: 13, paddingVertical: 10 },
  profileCopy: { flex: 1, minWidth: 0, gap: 5 },
  profileName: { color: styleColors.foreground, fontFamily: fonts.semibold, fontSize: fontSizes.input },
  profileReason: { color: styleColors.mutedForeground, fontFamily: fonts.regular, fontSize: fontSizes.detail },
  follow: { width: 79, minHeight: 39, borderRadius: radii.small, borderWidth: 1, borderColor: styleColors.border, alignItems: "center", justifyContent: "center", backgroundColor: styleColors.primary },
  following: { borderColor: styleColors.border, backgroundColor: styleColors.secondary },
  followText: { color: styleColors.primary, fontFamily: fonts.semibold, fontSize: fontSizes.body },
  followingText: { color: styleColors.mutedForeground },
  summary: { minHeight: 42, flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 4 },
  summaryText: { color: styleColors.mutedForeground, fontFamily: fonts.regular, fontSize: fontSizes.label },
  summaryStrong: { color: styleColors.foreground, fontFamily: fonts.semibold },
  searchLoader: { paddingVertical: 80 },
  resultList: { marginTop: 8 },
  resultRow: { minHeight: 72, flexDirection: "row", alignItems: "center", gap: 12, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: styleColors.border },
  resultIcon: { width: 42, height: 42, borderRadius: 13, alignItems: "center", justifyContent: "center", backgroundColor: styleColors.primary },
  resultCopy: { flex: 1, minWidth: 0, gap: 4 },
  resultTitle: { color: styleColors.foreground, fontFamily: fonts.semibold, fontSize: fontSizes.label },
  resultDesc: { color: styleColors.mutedForeground, fontFamily: fonts.regular, fontSize: fontSizes.caption, lineHeight: 17 },
  reward: { color: styleColors.primary, fontFamily: fonts.semibold, fontSize: fontSizes.caption },
  emptySearch: { alignItems: "center", paddingVertical: 70, gap: 9 },
  emptyTitle: { color: styleColors.mutedForeground, fontFamily: fonts.semibold, fontSize: fontSizes.input },
  emptyBody: { color: styleColors.mutedForeground, fontFamily: fonts.regular, fontSize: fontSizes.detail },
  retry: { minWidth: 100, minHeight: 40, borderRadius: radii.card, alignItems: "center", justifyContent: "center", backgroundColor: styleColors.primary },
  retryText: { color: styleColors.primaryForeground, fontFamily: fonts.semibold, fontSize: fontSizes.detail },
  modalOverlay: { flex: 1, justifyContent: "flex-end", backgroundColor: styleColors.scrim },
  sheet: { paddingHorizontal: 18, paddingTop: 9, borderTopLeftRadius: 24, borderTopRightRadius: 24, backgroundColor: styleColors.card, borderWidth: 1, borderColor: styleColors.border },
  handle: { alignSelf: "center", width: 42, height: 4, borderRadius: 2, backgroundColor: styleColors.secondary, marginBottom: 16 },
  sheetHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 14 },
  sheetTitle: { color: styleColors.foreground, fontFamily: fonts.bold, fontSize: fontSizes.heading },
  filterGrid: { flexDirection: "row", flexWrap: "wrap", gap: 9 },
  filterOption: { width: "31%", minHeight: 68, borderRadius: 13, alignItems: "center", justifyContent: "center", gap: 7, borderWidth: 1, borderColor: styleColors.border },
  filterActive: { backgroundColor: styleColors.primary, borderColor: styleColors.primary },
  filterText: { color: styleColors.mutedForeground, fontFamily: fonts.medium, fontSize: fontSizes.detail },
  filterTextActive: { color: styleColors.foreground },
  apply: { minHeight: 49, marginTop: 18, borderRadius: 14, alignItems: "center", justifyContent: "center", backgroundColor: styleColors.primary },
  applyText: { color: styleColors.primaryForeground, fontFamily: fonts.bold, fontSize: fontSizes.body },
});
