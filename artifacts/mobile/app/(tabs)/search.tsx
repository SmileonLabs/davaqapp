import { Feather } from "@expo/vector-icons";
import { useListUsers } from "@workspace/api-client-react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Image } from "expo-image";
import { LinearGradient } from "expo-linear-gradient";
import { useRouter } from "expo-router";
import React from "react";
import { ActivityIndicator, Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Avatar } from "@/components/Avatar";
import { CustomScrollView } from "@/components/CustomScroll";
import { NeonBackdrop } from "@/components/NeonUI";
import { neon } from "@/constants/colors";
import { useStarFeed, type StarFeedPost, type StarFeedPostKind } from "@/hooks/useStarFeed";
import { mediaUri } from "@/lib/apiBase";
import { customFetch } from "@workspace/api-client-react";
import SearchScreenV2 from "@/components/SearchScreenV2";

type SearchUser = { id: string; nickname: string; profileImageUrl: string | null; statusMessage: string | null; isMe: boolean; profileType?: string; handle?: string };
type SearchResponse = { users: SearchUser[]; starProfiles: Array<{ id: string; profileId: string; ownerId: string | null; displayName: string; imageUrl: string | null; stage: string; isMine: boolean; followedByMe: boolean }>; posts: Array<{ id: string; title: string; body: string; kind: string; createdAt: string }>; nextCursor: string | null };
type TrendingResponse = { items: Array<{ term: string; rank: number; change: number; resultCount: number }>; generatedAt: string };
type SearchType = "all" | "users" | "stars" | "posts";

const SEARCH_FILTERS: Array<{ key: SearchType; label: string; icon: React.ComponentProps<typeof Feather>["name"] }> = [
  { key: "all", label: "전체", icon: "search" },
  { key: "users", label: "사용자", icon: "user" },
  { key: "stars", label: "STAR", icon: "star" },
  { key: "posts", label: "게시물", icon: "file-text" },
];

const POST_TAGS: Record<StarFeedPostKind, string[]> = {
  official: ["DavaQ", "공식"],
  event: ["이벤트", "미션"],
  fan: ["비비", "팬아트"],
  star: ["STAR", "콘텐츠"],
  growth: ["성장", "기록"],
  profile_update: ["프로필", "성장"],
  talk_diary: ["대화일기", "오늘"],
};

function relativeTime(value: string) {
  const time = new Date(value).getTime();
  if (!Number.isFinite(time)) return "방금 전";
  const minutes = Math.max(0, Math.floor((Date.now() - time) / 60_000));
  if (minutes < 1) return "방금 전";
  if (minutes < 60) return `${minutes}분 전`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}시간 전`;
  return `${Math.floor(hours / 24)}일 전`;
}

function postImageUri(post: StarFeedPost) {
  const metadata = post.metadata ?? {};
  const value = ["imageUrl", "thumbnailUrl", "coverImageUrl", "newProfileImageUrl"]
    .map((key) => metadata[key])
    .find((item): item is string => typeof item === "string" && item.trim().length > 0);
  return value ? mediaUri(value) : null;
}

function SearchSection({
  icon,
  title,
  action,
  children,
}: {
  icon: React.ComponentProps<typeof Feather>["name"];
  title: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <LinearGradient
      colors={["rgba(10,10,25,0.98)", "rgba(5,5,16,0.98)"]}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 1 }}
      style={styles.sectionCard}
    >
      <View pointerEvents="none" style={styles.sectionGlow} />
      <View style={styles.sectionHead}>
        <View style={styles.sectionTitleRow}>
          <Feather name={icon} size={15} color={neon.magenta} />
          <Text style={styles.sectionTitle}>{title}</Text>
        </View>
        {action}
      </View>
      {children}
    </LinearGradient>
  );
}

function FeedPreview({ post, onPress }: { post: StarFeedPost; onPress: () => void }) {
  const tags = POST_TAGS[post.kind];
  const imageUri = postImageUri(post);
  const [imageFailed, setImageFailed] = React.useState(false);

  React.useEffect(() => {
    setImageFailed(false);
  }, [imageUri]);

  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.postPressable, pressed && styles.pressed]}>
      <LinearGradient
        colors={["rgba(12,12,28,0.98)", "rgba(5,6,18,0.98)"]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={styles.postCard}
      >
        <View pointerEvents="none" style={styles.postGlow} />
        <Avatar
          uri={post.author.profileImageUrl}
          name={post.author.nickname}
          size={58}
          crop="face"
          characterType={post.author.activityProfile?.type}
        />
        <View style={styles.postCopy}>
          <View style={styles.postMetaRow}>
            <Text style={styles.postAuthor} numberOfLines={1}>{post.author.nickname}</Text>
            <View style={styles.verified}><Feather name="check" size={8} color="#FFFFFF" /></View>
            <Text style={styles.postTime}>{relativeTime(post.createdAt)}</Text>
          </View>
          <Text style={styles.postTitle} numberOfLines={1}>{post.title}</Text>
          <View style={styles.tagRow}>
            {tags.map((tag) => <Text key={tag} style={styles.tag}># {tag}</Text>)}
          </View>
        </View>
        {imageUri && !imageFailed ? (
          <View style={styles.postVisual}>
            <Image
              source={{ uri: imageUri }}
              style={styles.postImage}
              contentFit="cover"
              onError={() => setImageFailed(true)}
            />
            <View style={styles.postCounts}>
              <Feather name="heart" size={12} color={neon.muted} />
              <Text style={styles.postCount}>{post.reactionCount}</Text>
              <Feather name="message-circle" size={12} color={neon.muted} />
              <Text style={styles.postCount}>{post.commentCount}</Text>
            </View>
          </View>
        ) : (
          <View style={styles.postCountsOnly}>
            <Feather name="heart" size={12} color={neon.muted} />
            <Text style={styles.postCount}>{post.reactionCount}</Text>
            <Feather name="message-circle" size={12} color={neon.muted} />
            <Text style={styles.postCount}>{post.commentCount}</Text>
          </View>
        )}
        <Feather name="more-horizontal" size={16} color={neon.text} style={styles.moreIcon} />
      </LinearGradient>
    </Pressable>
  );
}

function SearchPostCard({ post, onPress }: { post: SearchResponse["posts"][number]; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.postPressable, pressed && styles.pressed]}>
      <LinearGradient colors={["rgba(12,12,28,0.98)", "rgba(5,6,18,0.98)"]} style={styles.searchPostCard}>
        <View style={styles.postCopy}>
          <View style={styles.postMetaRow}><Text style={styles.postAuthor}>{post.kind}</Text><Text style={styles.postTime}>{relativeTime(post.createdAt)}</Text></View>
          <Text style={styles.postTitle} numberOfLines={2}>{post.title || post.body}</Text>
          {post.title && post.body ? <Text style={styles.searchPostBody} numberOfLines={1}>{post.body}</Text> : null}
        </View>
        <Feather name="chevron-right" size={16} color={neon.muted} />
      </LinearGradient>
    </Pressable>
  );
}

function LegacySearchScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [query, setQuery] = React.useState("");
  const [debouncedQuery, setDebouncedQuery] = React.useState("");
  const [searchType, setSearchType] = React.useState<SearchType>("all");
  const [pendingSearchType, setPendingSearchType] = React.useState<SearchType>("all");
  const [filterOpen, setFilterOpen] = React.useState(false);
  React.useEffect(() => {
    const timer = setTimeout(() => setDebouncedQuery(query.trim()), 300);
    return () => clearTimeout(timer);
  }, [query]);
  const normalized = debouncedQuery.toLocaleLowerCase();
  const { data: users = [], isLoading: usersLoading } = useListUsers();
  const { posts, isLoading: feedLoading } = useStarFeed();
  const [followOverrides, setFollowOverrides] = React.useState<Record<string, boolean>>({});
  const followMutation = useMutation({
    mutationFn: ({ id, following }: { id: string; following: boolean }) => customFetch<{ following: boolean }>(`/api/star-feed/star-profiles/${id}/follow`, { method: following ? "DELETE" : "POST", responseType: "json" }),
    onSuccess: (result, variables) => setFollowOverrides((current) => ({ ...current, [variables.id]: result.following })),
  });
  const searchQuery = useQuery({
    queryKey: ["global-search", normalized, searchType],
    enabled: normalized.length >= 2,
    queryFn: () => customFetch<SearchResponse>(`/api/search?q=${encodeURIComponent(normalized)}&type=${searchType}&limit=20`, { responseType: "json" }),
    staleTime: 30_000,
  });
  const trendingQuery = useQuery({
    queryKey: ["search-trending"],
    queryFn: () => customFetch<TrendingResponse>("/api/search/trending?limit=5", { responseType: "json" }),
    staleTime: 5 * 60_000,
  });

  const matchedUsers = React.useMemo(
    () => normalized.length >= 2
      ? (searchQuery.data?.users ?? []).slice(0, 4)
      : users.filter((user) => `${user.nickname} ${user.statusMessage ?? ""}`.toLocaleLowerCase().includes(normalized)).slice(0, 4).map((user) => ({ ...user, isMe: false })),
    [normalized, searchQuery.data?.users, users],
  );
  const matchedPosts = React.useMemo(
    () => searchType === "all" ? posts.filter((post) => !normalized || `${post.title} ${post.body} ${post.author.nickname}`.toLocaleLowerCase().includes(normalized)).slice(0, 6) : [],
    [normalized, posts, searchType],
  );

  const selectedFilterLabel = SEARCH_FILTERS.find((item) => item.key === searchType)?.label ?? "전체";
  const applyFilter = () => {
    setSearchType(pendingSearchType);
    setFilterOpen(false);
  };

  return (
    <NeonBackdrop>
      <CustomScrollView
        style={styles.scroll}
        contentContainerStyle={[styles.content, { paddingTop: insets.top + 6 }]}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.searchBox}>
          <Feather name="search" size={22} color="#8F8C9E" />
          <TextInput
            value={query}
            editable={false}
            selectTextOnFocus={false}
            placeholder="검색 기능 준비 중"
            placeholderTextColor="#777486"
            style={styles.input}
            autoCapitalize="none"
            returnKeyType="search"
          />
          <Pressable disabled accessibilityState={{ disabled: true }} accessibilityLabel="검색 필터 준비 중" hitSlop={12}>
            <Feather name="sliders" size={19} color="#5F5969" />
          </Pressable>
        </View>

        {!normalized ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="연습생 STAR 미션으로 이동"
            onPress={() => router.push("/(tabs)/persona" as never)}
            style={({ pressed }) => [styles.heroCrop, pressed && styles.pressed]}
          >
            <Image
              source={require("../../assets/images/search-star-banner.png")}
              style={styles.heroSprite}
              contentFit="cover"
              contentPosition={{ top: "15%" }}
            />
            <View pointerEvents="none" style={styles.heroBannerOverlay}>
              <View style={styles.heroBannerCopy}>
                <View style={styles.heroBannerEyebrow}><Feather name="star" size={14} color="#FFD84D" /><Text style={styles.heroBannerEyebrowText}>STAR 성장 시스템</Text></View>
                <Text style={styles.heroBannerTitle}>NFT로 STAR 소환</Text>
                <Text style={styles.heroBannerSubtitle}>나만의 STAR를 성장 시키세요.</Text>
                <View style={styles.heroBannerCta}><Text style={styles.heroBannerCtaText}>STAR 등록하기</Text><Feather name="arrow-right" size={14} color="#FFFFFF" /></View>
              </View>
            </View>
          </Pressable>
        ) : null}

        <SearchSection
          icon="zap"
          title="인기 검색어"
          action={<Pressable onPress={() => setQuery("")}><Text style={styles.more}>더보기 〉</Text></Pressable>}
        >
          {trendingQuery.isLoading ? <ActivityIndicator color={neon.purple} style={styles.trendingLoader} /> : trendingQuery.data?.items.length ? <View style={styles.trendingRow}>
            {trendingQuery.data.items.map((item) => (
              <Pressable key={item.term} disabled accessibilityState={{ disabled: true }} style={styles.trendingItem}>
                <Text style={styles.trendingRank}>{item.rank}.</Text>
                <Text style={styles.trendingText} numberOfLines={1}>{item.term}</Text>
                {item.change > 0 ? <Feather name="arrow-up-right" size={12} color={neon.magenta} /> : item.change < 0 ? <Feather name="arrow-down-right" size={12} color={neon.cyan} /> : null}
              </Pressable>
            ))}
          </View> : <Text style={styles.emptyTrending}>아직 인기 검색어가 없습니다.</Text>}
        </SearchSection>

        <SearchSection
          icon="star"
          title={normalized ? "검색 결과" : "추천 STAR / FAN"}
          action={<Pressable onPress={() => router.push("/friends/add")}><Text style={styles.more}>더보기 〉</Text></Pressable>}
        >
          {usersLoading ? <ActivityIndicator color={neon.purple} style={styles.loader} /> : (
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.peopleRow}
              keyboardShouldPersistTaps="handled"
            >
              {matchedUsers.map((user) => (
                <Pressable key={user.id} onPress={() => router.push(user.isMe ? "/(tabs)/persona" : ("profileType" in user && user.profileType ? { pathname: "/(tabs)/character/[profileId]", params: { profileId: user.id } } : { pathname: "/profile/[userId]", params: { userId: user.id } }) as never)} style={({ pressed }) => [styles.personCard, pressed && styles.pressed]}>
                  <View style={styles.personAvatarWrap}>
                    <Avatar
                      uri={user.profileImageUrl}
                      name={user.nickname}
                      size={44}
                      crop="face"
                      characterType={
                        "profileType" in user
                          ? user.profileType
                          : "profile" in user
                            ? user.profile?.type
                            : undefined
                      }
                    />
                    <View style={styles.verified}><Feather name="check" size={8} color="#FFFFFF" /></View>
                  </View>
                  <Text style={styles.personName} numberOfLines={1}>{user.nickname}</Text>
                  <Text style={styles.personRole}>{user.isMe ? "내 프로필" : "사용자"}</Text>
                </Pressable>
              ))}
            </ScrollView>
          )}
          {normalized.length >= 2 && searchQuery.isFetching ? <ActivityIndicator color={neon.purple} style={styles.loader} /> : null}
          {normalized.length >= 2 && searchQuery.data?.starProfiles.length ? (
            <View style={styles.starResultRow}>
              {searchQuery.data.starProfiles.slice(0, 4).map((star) => (
                <View key={star.id} style={styles.starResultCard}>
                <Pressable
                  key={star.id}
                  onPress={() => router.push({ pathname: "/(tabs)/character/[profileId]", params: { profileId: star.profileId } } as never)}
                  style={({ pressed }) => [styles.starResultMain, pressed && styles.pressed]}
                >
                  <Image source={star.imageUrl ? { uri: mediaUri(star.imageUrl) } : require("../../assets/images/star-character-cutout.png")} style={styles.starResultImage} contentFit="cover" />
                  <View style={styles.personCopy}>
                    <Text style={styles.personName} numberOfLines={1}>{star.displayName}</Text>
                    <Text style={styles.personRole}>{star.stage === "promoted" ? "공식 STAR" : "연습생 STAR"}</Text>
                  </View>
                </Pressable>
                {star.ownerId ? <Pressable onPress={() => followMutation.mutate({ id: star.id, following: followOverrides[star.id] ?? star.followedByMe })} style={styles.followButton}><Text style={styles.followButtonText}>{(followOverrides[star.id] ?? star.followedByMe) ? "팔로잉" : "팔로우"}</Text></Pressable> : null}
                </View>
              ))}
            </View>
          ) : null}
        </SearchSection>

        {normalized.length >= 2 ? searchQuery.isLoading ? <ActivityIndicator color={neon.purple} style={styles.loader} /> : searchQuery.data?.posts.length ? (
          <View style={styles.feedList}>{searchQuery.data.posts.slice(0, 6).map((post) => <SearchPostCard key={post.id} post={post} onPress={() => router.push({ pathname: "/post/[postId]", params: { postId: post.id } } as never)} />)}</View>
        ) : <Text style={styles.empty}>{selectedFilterLabel} 검색 결과가 없어요.</Text> : feedLoading ? <ActivityIndicator color={neon.purple} style={styles.loader} /> : matchedPosts.length ? (
          <View style={styles.feedList}>
            {matchedPosts.map((post) => <FeedPreview key={post.id} post={post} onPress={() => router.push("/(tabs)/feed" as never)} />)}
          </View>
        ) : <Text style={styles.empty}>검색 결과가 없습니다.</Text>}
      </CustomScrollView>
      <Modal visible={filterOpen} transparent animationType="slide" onRequestClose={() => setFilterOpen(false)}>
        <View style={styles.modalOverlay}>
          <Pressable style={StyleSheet.absoluteFill} onPress={() => setFilterOpen(false)} accessibilityLabel="필터 닫기" />
          <View style={styles.filterSheet}>
            <View style={styles.sheetHandle} />
            <View style={styles.sheetHeader}>
              <Text style={styles.sheetTitle}>검색 필터</Text>
              <Pressable onPress={() => setFilterOpen(false)} hitSlop={12}><Feather name="x" size={20} color={neon.muted} /></Pressable>
            </View>
            {SEARCH_FILTERS.map((filter) => {
              const active = pendingSearchType === filter.key;
              return <Pressable key={filter.key} onPress={() => setPendingSearchType(filter.key)} style={[styles.filterOption, active && styles.filterOptionActive]}>
                <View style={styles.filterOptionLabel}><Feather name={filter.icon} size={17} color={active ? neon.purple : neon.muted} /><Text style={[styles.filterOptionText, active && styles.filterOptionTextActive]}>{filter.label}</Text></View>
                <Feather name={active ? "check-circle" : "circle"} size={18} color={active ? neon.purple : neon.muted} />
              </Pressable>;
            })}
            <Pressable onPress={applyFilter} style={styles.applyFilterButton}><Text style={styles.applyFilterText}>적용</Text></Pressable>
          </View>
        </View>
      </Modal>
    </NeonBackdrop>
  );
}

const styles = StyleSheet.create({
  scroll: { flex: 1 },
  content: { paddingHorizontal: 11, paddingBottom: 112, gap: 10 },
  pressed: { opacity: 0.78, transform: [{ scale: 0.995 }] },
  searchBox: {
    minHeight: 45,
    borderRadius: 24,
    borderWidth: 1,
    borderColor: "rgba(136,68,214,0.36)",
    backgroundColor: "rgba(7,7,18,0.94)",
    paddingHorizontal: 16,
    flexDirection: "row",
    alignItems: "center",
    gap: 11,
  },
  input: { flex: 1, color: neon.text, fontFamily: "Inter_400Regular", fontSize: 13, paddingVertical: 9 },
  heroCrop: {
    alignSelf: "stretch",
    height: 151,
    marginHorizontal: -11,
    overflow: "hidden",
    backgroundColor: "#050410",
  },
  heroSprite: { width: "100%", height: "100%" },
  heroBannerOverlay: { ...StyleSheet.absoluteFillObject, justifyContent: "center", paddingHorizontal: 18, backgroundColor: "rgba(5,4,16,0.32)" },
  heroBannerCopy: { gap: 4 },
  heroBannerEyebrow: { flexDirection: "row", alignItems: "center", gap: 6 },
  heroBannerEyebrowText: { color: "#FFD84D", fontFamily: "Inter_600SemiBold", fontSize: 10 },
  heroBannerTitle: { color: "#FFFFFF", fontFamily: "Inter_700Bold", fontSize: 21, letterSpacing: -0.4 },
  heroBannerSubtitle: { color: "#D8D0EC", fontFamily: "Inter_400Regular", fontSize: 12 },
  heroBannerCta: { alignSelf: "flex-start", flexDirection: "row", alignItems: "center", gap: 5, marginTop: 7, paddingHorizontal: 11, paddingVertical: 6, borderRadius: 12, backgroundColor: "#7138FF" },
  heroBannerCtaText: { color: "#FFFFFF", fontFamily: "Inter_600SemiBold", fontSize: 10 },
  sectionCard: {
    borderRadius: 13,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "rgba(103,65,165,0.28)",
    paddingHorizontal: 11,
    paddingTop: 8,
    paddingBottom: 10,
    overflow: "hidden",
  },
  sectionGlow: { position: "absolute", right: -45, top: -55, width: 130, height: 120, borderRadius: 65, backgroundColor: "rgba(66,29,149,0.10)" },
  sectionHead: { minHeight: 22, flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  sectionTitleRow: { flexDirection: "row", alignItems: "center", gap: 7 },
  sectionTitle: { color: neon.text, fontFamily: "Inter_600SemiBold", fontSize: 14 },
  more: { color: "#918B9E", fontFamily: "Inter_400Regular", fontSize: 10 },
  trendingRow: { flexDirection: "row", alignItems: "center", borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: "rgba(126,79,185,0.18)", paddingTop: 8, marginTop: 3 },
  trendingLoader: { minHeight: 34 },
  emptyTrending: { color: neon.muted, fontFamily: "Inter_400Regular", fontSize: 10, paddingVertical: 12, textAlign: "center" },
  trendingItem: { minWidth: 0, flex: 1, flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 2 },
  trendingRank: { color: neon.magenta, fontFamily: "Inter_700Bold", fontSize: 11 },
  trendingText: { color: "#B9B5C1", fontFamily: "Inter_400Regular", fontSize: 10, flexShrink: 1 },
  peopleRow: { flexDirection: "row", gap: 8, paddingRight: 2, paddingTop: 4 },
  starResultRow: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 8 },
  starResultCard: { flex: 1, minWidth: "46%", minHeight: 58, paddingHorizontal: 7, flexDirection: "row", alignItems: "center", gap: 7, borderRadius: 12, backgroundColor: "rgba(6,6,18,0.78)", borderWidth: StyleSheet.hairlineWidth, borderColor: "rgba(126,72,198,0.25)" },
  starResultMain: { flex: 1, minWidth: 0, flexDirection: "row", alignItems: "center", gap: 7 },
  starResultImage: { width: 44, height: 44, borderRadius: 10, backgroundColor: "#111020" },
  personCopy: { flex: 1, minWidth: 0, gap: 2 },
  followButton: { borderRadius: 10, paddingHorizontal: 7, paddingVertical: 5, backgroundColor: "rgba(123,53,255,0.20)", borderWidth: StyleSheet.hairlineWidth, borderColor: "rgba(164,111,255,0.55)" },
  followButtonText: { color: neon.text, fontFamily: "Inter_500Medium", fontSize: 9 },
  personCard: {
    width: 68,
    minHeight: 88,
    paddingHorizontal: 4,
    paddingVertical: 7,
    alignItems: "center",
    justifyContent: "flex-start",
    gap: 3,
    borderRadius: 12,
    backgroundColor: "rgba(6,6,18,0.78)",
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "rgba(126,72,198,0.25)",
  },
  personAvatarWrap: { position: "relative", width: 44, height: 44, marginBottom: 1 },
  personName: { width: "100%", color: neon.text, fontFamily: "Inter_500Medium", fontSize: 9, textAlign: "center" },
  personRole: { color: neon.magenta, fontFamily: "Inter_500Medium", fontSize: 8, textAlign: "center" },
  verified: { position: "absolute", right: -2, top: -2, width: 12, height: 12, borderRadius: 6, alignItems: "center", justifyContent: "center", backgroundColor: "#7B35FF" },
  loader: { minHeight: 56, justifyContent: "center" },
  feedList: { gap: 8 },
  postPressable: { borderRadius: 13 },
  postCard: {
    minHeight: 100,
    borderRadius: 13,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "rgba(82,68,142,0.28)",
    paddingHorizontal: 13,
    paddingVertical: 11,
    flexDirection: "row",
    alignItems: "center",
    gap: 11,
    overflow: "hidden",
  },
  searchPostCard: { minHeight: 78, borderRadius: 13, borderWidth: StyleSheet.hairlineWidth, borderColor: "rgba(82,68,142,0.28)", paddingHorizontal: 13, paddingVertical: 11, flexDirection: "row", alignItems: "center", gap: 8 },
  searchPostBody: { color: neon.muted, fontFamily: "Inter_400Regular", fontSize: 10, marginTop: 4 },
  postGlow: { position: "absolute", left: 40, top: -70, width: 150, height: 120, borderRadius: 70, backgroundColor: "rgba(77,38,177,0.08)" },
  postCopy: { flex: 1, minWidth: 0, alignSelf: "stretch", justifyContent: "center" },
  postMetaRow: { flexDirection: "row", alignItems: "center", gap: 5 },
  postAuthor: { color: neon.text, fontFamily: "Inter_500Medium", fontSize: 12, maxWidth: "56%" },
  postTime: { color: "#777283", fontFamily: "Inter_400Regular", fontSize: 9 },
  postTitle: { color: "#D8D4DF", fontFamily: "Inter_400Regular", fontSize: 12, marginTop: 8 },
  tagRow: { flexDirection: "row", gap: 5, marginTop: 8 },
  tag: { color: "#A16BCF", fontFamily: "Inter_400Regular", fontSize: 9, borderWidth: StyleSheet.hairlineWidth, borderColor: "rgba(129,67,189,0.30)", borderRadius: 10, paddingHorizontal: 7, paddingVertical: 3 },
  postVisual: { width: 119, alignSelf: "stretch", justifyContent: "space-between", paddingTop: 2 },
  postImage: { width: "100%", height: 61, borderRadius: 9, backgroundColor: "#111020" },
  postCounts: { height: 18, flexDirection: "row", alignItems: "center", justifyContent: "flex-end", gap: 4 },
  postCountsOnly: { position: "absolute", right: 8, bottom: 7, height: 18, flexDirection: "row", alignItems: "center", gap: 4 },
  postCount: { color: neon.muted, fontFamily: "Inter_400Regular", fontSize: 9, marginRight: 7 },
  moreIcon: { position: "absolute", right: 9, top: 7 },
  empty: { color: neon.muted, textAlign: "center", paddingVertical: 28 },
  modalOverlay: { flex: 1, justifyContent: "flex-end", backgroundColor: "rgba(0,0,0,0.62)" },
  filterSheet: { paddingHorizontal: 18, paddingTop: 9, paddingBottom: 30, borderTopLeftRadius: 24, borderTopRightRadius: 24, backgroundColor: "#0B0A18", borderWidth: 1, borderColor: "rgba(139,82,229,0.38)" },
  sheetHandle: { alignSelf: "center", width: 42, height: 4, borderRadius: 2, backgroundColor: "rgba(218,205,255,0.28)", marginBottom: 16 },
  sheetHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 12 },
  sheetTitle: { color: neon.text, fontFamily: "Inter_700Bold", fontSize: 17 },
  filterOption: { minHeight: 50, paddingHorizontal: 13, borderRadius: 12, flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: 7, borderWidth: 1, borderColor: "rgba(126,72,198,0.16)" },
  filterOptionActive: { backgroundColor: "rgba(123,53,255,0.16)", borderColor: "rgba(164,111,255,0.62)" },
  filterOptionLabel: { flexDirection: "row", alignItems: "center", gap: 10 },
  filterOptionText: { color: neon.muted, fontFamily: "Inter_500Medium", fontSize: 13 },
  filterOptionTextActive: { color: neon.text },
  applyFilterButton: { minHeight: 48, marginTop: 18, borderRadius: 14, alignItems: "center", justifyContent: "center", backgroundColor: neon.purple },
  applyFilterText: { color: "#FFFFFF", fontFamily: "Inter_700Bold", fontSize: 14 },
});

export default SearchScreenV2;
