import { useMemo } from "react";
import { useColors } from "@/hooks/useColors";
import { fonts, fontSizes, radii } from "@/constants/designSystem";
import { Feather } from "@expo/vector-icons";
import { Image } from "expo-image";
import { LinearGradient } from "expo-linear-gradient";
import { useLocalSearchParams, useRouter } from "expo-router";
import React from "react";
import {
  ActivityIndicator,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Avatar } from "@/components/Avatar";
import { NeonBackdrop } from "@/components/NeonUI";
import { useCharacterProfiles } from "@/hooks/useCharacterProfiles";
import { useMediaUri } from "@/hooks/useMediaUri";
import { useStarFeed, type StarFeedAuthor, type StarFeedPost } from "@/hooks/useStarFeed";
import { crossAlert } from "@/lib/crossAlert";
import { pickAndUploadImages, type UploadedImage } from "@/lib/uploadImage";

type Scope = "recommended" | "following";

const roleOf = (author: StarFeedAuthor) => author.activityProfile?.type === "star" ? "STAR" : "FAN";
const displayNameOf = (author: StarFeedAuthor) => author.activityProfile?.displayName || author.nickname;

function relativeTime(value: string) {
  const minutes = Math.max(0, Math.floor((Date.now() - new Date(value).getTime()) / 60_000));
  if (minutes < 1) return "방금 전";
  if (minutes < 60) return `${minutes}분 전`;
  if (minutes < 1_440) return `${Math.floor(minutes / 60)}시간 전`;
  return `${Math.floor(minutes / 1_440)}일 전`;
}

function compactNumber(value: number) {
  if (value < 1_000) return String(value);
  return `${(value / 1_000).toFixed(value < 10_000 ? 1 : 0)}K`;
}

function FeedMediaImage({
  objectPath,
  accessibilityLabel,
  style,
}: {
  objectPath: string;
  accessibilityLabel: string;
  style: object;
}) {
  const uri = useMediaUri(objectPath);
  return uri ? (
    <Image source={{ uri }} contentFit="cover" accessibilityLabel={accessibilityLabel} style={style} />
  ) : (
    <View style={style} />
  );
}

function MediaGrid({ post }: { post: StarFeedPost }) {
  const styleColors = useColors();
  const styles = useMemo(() => makeStyles(styleColors), [styleColors]);

  const images = (post.media ?? []).filter((item) => item.mediaType === "image").slice(0, 4);
  if (!images.length) return null;
  return (
    <View style={[styles.mediaGrid, images.length === 1 && styles.mediaGridSingle]}>
      {images.map((item, index) => (
        <FeedMediaImage
          key={`${item.objectPath}-${index}`}
          objectPath={item.objectPath}
          accessibilityLabel={item.altText || `${displayNameOf(post.author)} 게시물 이미지 ${index + 1}`}
          style={[
            styles.mediaImage,
            images.length === 1 && styles.mediaSingle,
            images.length === 2 && styles.mediaTwo,
            images.length === 3 && index === 0 && styles.mediaThreeLead,
            images.length === 3 && index > 0 && styles.mediaThreeTail,
          ]}
        />
      ))}
    </View>
  );
}

function ProfileRail({ posts, onOpen }: { posts: StarFeedPost[]; onOpen: (author: StarFeedAuthor) => void }) {
  const styleColors = useColors();
  const styles = useMemo(() => makeStyles(styleColors), [styleColors]);

  const authors = React.useMemo(() => {
    const map = new Map<string, StarFeedAuthor>();
    for (const post of posts) {
      const key = post.author.activityProfile?.id || post.author.id || post.author.nickname;
      if (!map.has(key)) map.set(key, post.author);
    }
    return [...map.values()].slice(0, 4);
  }, [posts]);

  if (!authors.length) return null;
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.profileRail}>
      {authors.map((author) => (
        <Pressable key={author.activityProfile?.id || author.nickname} onPress={() => onOpen(author)} style={styles.profileItem}>
          <LinearGradient colors={["#D855FF", "#7129F5", "#332078"]} style={styles.profileRing}>
            <Avatar
              uri={author.profileImageUrl}
              name={displayNameOf(author)}
              size={72}
              crop="face"
              characterType={author.activityProfile?.type}
            />
          </LinearGradient>
          <Text numberOfLines={1} style={styles.profileName}>{displayNameOf(author)}</Text>
          <View style={styles.rolePill}><Text style={styles.rolePillText}>{roleOf(author)}</Text></View>
        </Pressable>
      ))}
    </ScrollView>
  );
}

function Composer({
  activeProfile,
  supportTargets,
  onClose,
  onPublished,
}: {
  activeProfile: ReturnType<typeof useCharacterProfiles>["activeProfile"];
  supportTargets: StarFeedAuthor[];
  onClose: () => void;
  onPublished: (xp: number) => void;
}) {
  const styleColors = useColors();
  const styles = useMemo(() => makeStyles(styleColors), [styleColors]);

  const { createPost, isCreatingPost } = useStarFeed("recommended");
  const [body, setBody] = React.useState("");
  const [media, setMedia] = React.useState<UploadedImage[]>([]);
  const [uploading, setUploading] = React.useState(false);
  const [targetId, setTargetId] = React.useState<string | null>(null);
  const kind = activeProfile?.type === "star" ? "star" : "fan";
  const canPost = !!body.trim() && !uploading && !isCreatingPost;

  const addImages = async () => {
    if (uploading || media.length >= 4) return;
    setUploading(true);
    try {
      const selected = await pickAndUploadImages();
      if (selected) setMedia((current) => [...current, ...selected].slice(0, 4));
    } catch {
      crossAlert("사진 업로드 실패", "사진을 업로드하지 못했습니다.");
    } finally {
      setUploading(false);
    }
  };

  const publish = async () => {
    if (!canPost) return;
    try {
      const result = await createPost({
        kind,
        body: body.trim(),
        media: media.map((item) => ({ objectPath: item.objectPath, mediaType: "image" })),
        targetStarProfileId: kind === "fan" ? targetId : null,
      });
      onPublished(result.reward?.granted ? result.reward.xp : 0);
      setBody("");
      setMedia([]);
      setTargetId(null);
      onClose();
    } catch {
      crossAlert("게시 실패", "게시물을 올리지 못했습니다. 잠시 후 다시 시도해 주세요.");
    }
  };

  return (
    <LinearGradient colors={[styleColors.card, styleColors.card]} style={styles.composer}>
      <View style={styles.composerIdentity}>
        <Avatar
          uri={activeProfile?.profileImageUrl}
          name={activeProfile?.displayName || "DavaQ"}
          size={48}
          crop="face"
          characterType={activeProfile?.type}
        />
        <Text style={styles.composerName}>{activeProfile?.displayName || "내 프로필"}</Text>
        <View style={styles.authorRole}><Text style={styles.authorRoleText}>{kind.toUpperCase()}</Text></View>
      </View>
      <View style={styles.inputBox}>
        <TextInput
          value={body}
          onChangeText={setBody}
          multiline
          maxLength={500}
          placeholder="오늘 당신의 이야기를 들려주세요."
          placeholderTextColor={styleColors.mutedForeground}
          style={styles.composerInput}
        />
        <View style={styles.composerMediaRow}>
          <Pressable onPress={() => void addImages()} disabled={uploading || media.length >= 4} style={styles.photoButton}>
            {uploading ? <ActivityIndicator color={styleColors.foreground} /> : <Feather name="image" size={18} color={styleColors.foreground} />}
            <Text style={styles.photoText}>사진 {media.length}/4</Text>
          </Pressable>
          {media.map((item) => (
            <Pressable key={item.objectPath} onPress={() => setMedia((items) => items.filter((image) => image.objectPath !== item.objectPath))}>
              <Image source={{ uri: item.localUri }} style={styles.composerPreview} contentFit="cover" />
            </Pressable>
          ))}
        </View>
      </View>
      {kind === "fan" ? (
        <View>
          <Text style={styles.supportTitle}>응원 대상 선택 <Text style={styles.optional}>(선택사항)</Text></Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.supportRail}>
            <Pressable onPress={() => setTargetId(null)} style={styles.supportItem}>
              <View style={[styles.supportAvatar, targetId === null && styles.supportSelected]}><Feather name="user-plus" size={27} color={styleColors.foreground} /></View>
              <Text style={styles.supportName}>선택 안함</Text>
            </Pressable>
            {supportTargets.map((author) => {
              const legacyId = author.starProfile?.id;
              if (!legacyId) return null;
              return (
                <Pressable key={legacyId} onPress={() => setTargetId(legacyId)} style={styles.supportItem}>
                  <View style={[styles.supportAvatar, targetId === legacyId && styles.supportSelected]}>
                    <Avatar
                      uri={author.profileImageUrl}
                      name={displayNameOf(author)}
                      size={58}
                      crop="face"
                      characterType={author.activityProfile?.type}
                    />
                  </View>
                  <Text numberOfLines={1} style={styles.supportName}>{displayNameOf(author)}</Text>
                </Pressable>
              );
            })}
          </ScrollView>
        </View>
      ) : null}
      <Pressable disabled={!canPost} onPress={() => void publish()} style={[styles.publishButton, !canPost && styles.disabled]}>
        <LinearGradient colors={["#7D36F6", "#A14EFF"]} style={styles.publishGradient}>
          {isCreatingPost ? <ActivityIndicator color={styleColors.foreground} /> : <Text style={styles.publishText}>게시하기</Text>}
        </LinearGradient>
      </Pressable>
    </LinearGradient>
  );
}

function FeedCard({
  post,
  onOpen,
  onProfile,
  onToggleReaction,
  onReport,
}: {
  post: StarFeedPost;
  onOpen: (id: string) => void;
  onProfile: (author: StarFeedAuthor) => void;
  onToggleReaction: (post: StarFeedPost) => void;
  onReport: (id: string) => void;
}) {
  const styleColors = useColors();
  const styles = useMemo(() => makeStyles(styleColors), [styleColors]);

  const share = async () => {
    const url = Platform.OS === "web" && typeof window !== "undefined"
      ? `${window.location.origin}/app/feed?postId=${post.id}`
      : `https://davaq.app/app/feed?postId=${post.id}`;
    try {
      await Share.share({ title: `${displayNameOf(post.author)}님의 게시물`, message: `${post.body}\n${url}`, url });
    } catch {
      crossAlert("공유 실패", "게시물을 공유하지 못했습니다.");
    }
  };

  return (
    <View style={styles.card}>
      <View style={styles.cardHeader}>
        <Pressable onPress={() => onProfile(post.author)} style={styles.cardAvatar}>
          <Avatar
            uri={post.author.profileImageUrl}
            name={displayNameOf(post.author)}
            size={44}
            crop="face"
            characterType={post.author.activityProfile?.type}
          />
        </Pressable>
        <View style={styles.cardIdentity}>
          <View style={styles.cardNameRow}>
            <Text style={styles.cardName}>{displayNameOf(post.author)}</Text>
            <View style={styles.authorRole}><Text style={styles.authorRoleText}>{roleOf(post.author)}</Text></View>
          </View>
          <Text style={styles.cardTime}>{relativeTime(post.createdAt)}</Text>
        </View>
        <Pressable
          onPress={() => onReport(post.id)}
          hitSlop={10}
          style={styles.moreButton}
          accessibilityRole="button"
          accessibilityLabel={`${displayNameOf(post.author)} 게시물 더보기`}
        >
          <Feather name="more-vertical" size={21} color={styleColors.mutedForeground} />
        </Pressable>
      </View>
      <Pressable
        onPress={() => onOpen(post.id)}
        accessibilityRole="button"
        accessibilityLabel={`${displayNameOf(post.author)} 게시물 상세 보기`}
        style={({ pressed }) => pressed && styles.pressed}
      >
        <Text style={styles.cardBody}>{post.body}</Text>
        {post.hashtags?.length ? <Text style={styles.hashtags}>{post.hashtags.map((tag) => `#${tag}`).join("  ")}</Text> : null}
        <MediaGrid post={post} />
      </Pressable>
      <View style={styles.actions}>
        <Pressable onPress={() => onToggleReaction(post)} style={styles.action}>
          <Feather name="heart" size={22} color={post.reactedByMe ? "#D44DFF" : "#AAA5B2"} />
          <Text style={styles.actionText}>{compactNumber(post.reactionCount)}</Text>
        </Pressable>
        <View style={styles.action}><Feather name="message-circle" size={21} color={styleColors.mutedForeground} /><Text style={styles.actionText}>{compactNumber(post.commentCount)}</Text></View>
        <Pressable onPress={() => void share()} style={styles.action}><Feather name="share-2" size={20} color={styleColors.mutedForeground} /><Text style={styles.actionText}>공유</Text></Pressable>
      </View>
    </View>
  );
}

export default function FeedScreenV2() {
  const styleColors = useColors();
  const styles = useMemo(() => makeStyles(styleColors), [styleColors]);

  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { compose } = useLocalSearchParams<{ compose?: string }>();
  const { activeProfile } = useCharacterProfiles();
  const [scope, setScope] = React.useState<Scope>("recommended");
  const [writing, setWriting] = React.useState(compose === "1");
  const [feedback, setFeedback] = React.useState<string | null>(null);
  const [menuPostId, setMenuPostId] = React.useState<string | null>(null);
  const feed = useStarFeed(scope);
  const supportTargets = React.useMemo(() => {
    const map = new Map<string, StarFeedAuthor>();
    for (const post of feed.posts) {
      if (post.author.activityProfile?.type !== "star" || !post.author.starProfile?.id) continue;
      map.set(post.author.starProfile.id, post.author);
    }
    return [...map.values()].slice(0, 8);
  }, [feed.posts]);

  const openProfile = (author: StarFeedAuthor) => {
    const id = author.activityProfile?.id;
    if (id) router.push({ pathname: "/(tabs)/character/[profileId]", params: { profileId: id } } as never);
  };

  const report = (id: string) => setMenuPostId(id);

  const submitReport = async (reason: "spam" | "harassment" | "sexual" | "violence" | "copyright" | "other") => {
    const postId = menuPostId;
    if (!postId || feed.isReportingPost) return;
    try {
      await feed.reportPost({ postId, reason });
      setFeedback("신고가 접수되었습니다.");
      setMenuPostId(null);
    } catch {
      setFeedback("신고를 접수하지 못했습니다.");
      setMenuPostId(null);
    }
  };

  return (
    <NeonBackdrop style={styles.screen}>
      <View style={[styles.shell, { paddingTop: insets.top + 8 }]}>
        <View style={styles.header}>
          <View style={styles.tabs}>
            {(["recommended", "following"] as const).map((item) => (
              <Pressable key={item} onPress={() => setScope(item)} style={[styles.tab, scope === item && styles.tabActive]}>
                <Text style={[styles.tabText, scope === item && styles.tabTextActive]}>{item === "recommended" ? "추천" : "팔로잉"}</Text>
              </Pressable>
            ))}
          </View>
          <Pressable onPress={() => setWriting((value) => !value)} style={[styles.write, writing && styles.close]}>
            <Feather name={writing ? "x" : "edit-3"} size={20} color={writing ? "#BE55FF" : "#F5F1F8"} />
            <Text style={styles.writeText}>{writing ? "닫기" : "글쓰기"}</Text>
          </Pressable>
        </View>
        <ScrollView
          contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 104 }]}
          onScroll={({ nativeEvent }) => {
            const remaining = nativeEvent.contentSize.height - nativeEvent.layoutMeasurement.height - nativeEvent.contentOffset.y;
            if (remaining < 500 && feed.hasNextPage && !feed.isFetchingNextPage) void feed.fetchNextPage();
          }}
          scrollEventThrottle={180}
        >
          {writing ? <Composer activeProfile={activeProfile} supportTargets={supportTargets} onClose={() => setWriting(false)} onPublished={(xp) => setFeedback(xp ? `FAN 글을 게시했고 FAN XP ${xp}를 획득했어요.` : "게시물을 등록했습니다.")} /> : null}
          {!writing ? <ProfileRail posts={feed.posts} onOpen={openProfile} /> : null}
          {feedback ? <Pressable onPress={() => setFeedback(null)} style={styles.feedback}><Feather name="volume-2" size={19} color={styleColors.primary} /><Text style={styles.feedbackText}>{feedback}</Text><Feather name="chevron-right" size={20} color={styleColors.primary} /></Pressable> : null}
          {feed.isLoading ? <View style={styles.state}><ActivityIndicator color={styleColors.primary} /><Text style={styles.stateText}>피드를 불러오는 중이에요.</Text></View> : null}
          {!feed.isLoading && feed.error ? <Pressable onPress={() => void feed.refetch()} style={styles.state}><Text style={styles.stateTitle}>피드를 불러오지 못했어요.</Text><Text style={styles.stateText}>눌러서 다시 시도해 주세요.</Text></Pressable> : null}
          {!feed.isLoading && !feed.error && !feed.posts.length ? <View style={styles.state}><Text style={styles.stateTitle}>{scope === "following" ? "팔로잉 피드가 비어 있어요." : "아직 게시물이 없어요."}</Text><Text style={styles.stateText}>관심 있는 프로필을 팔로우하거나 첫 이야기를 남겨보세요.</Text></View> : null}
          {feed.posts.map((post) => (
            <FeedCard
              key={post.id}
              post={post}
              onOpen={(id) => router.push({ pathname: "/post/[postId]", params: { postId: id } } as never)}
              onProfile={openProfile}
              onReport={report}
              onToggleReaction={(item) => void feed.toggleReaction({ postId: item.id, reacted: item.reactedByMe }).catch(() => setFeedback("반응을 변경하지 못했습니다."))}
            />
          ))}
          {feed.isFetchingNextPage ? <ActivityIndicator style={styles.moreLoader} color={styleColors.primary} /> : null}
        </ScrollView>
        <Modal
          visible={menuPostId !== null}
          transparent
          animationType="fade"
          onRequestClose={() => setMenuPostId(null)}
        >
          <Pressable
            style={styles.menuBackdrop}
            onPress={() => setMenuPostId(null)}
            accessibilityRole="button"
            accessibilityLabel="게시물 메뉴 닫기"
          >
            <Pressable
              style={styles.postMenu}
              onPress={(event) => event.stopPropagation()}
              accessibilityRole="menu"
            >
              <View style={styles.menuHandle} />
              <Text style={styles.menuTitle}>게시물 신고</Text>
              <Text style={styles.menuDescription}>신고 사유를 선택해 주세요.</Text>
              {([
                ["spam", "스팸 또는 광고"],
                ["harassment", "괴롭힘 또는 혐오 표현"],
                ["sexual", "부적절한 성적 콘텐츠"],
                ["violence", "폭력적이거나 위험한 콘텐츠"],
                ["copyright", "저작권 침해"],
                ["other", "기타 사유"],
              ] as const).map(([reason, label]) => (
                <Pressable
                  key={reason}
                  disabled={feed.isReportingPost}
                  onPress={() => void submitReport(reason)}
                  style={({ pressed }) => [styles.menuItem, pressed && styles.menuItemPressed]}
                  accessibilityRole="menuitem"
                  accessibilityLabel={label}
                >
                  <Text style={styles.menuItemText}>{label}</Text>
                  {feed.isReportingPost
                    ? <ActivityIndicator size="small" color={styleColors.primary} />
                    : <Feather name="chevron-right" size={19} color={styleColors.mutedForeground} />}
                </Pressable>
              ))}
              <Pressable
                onPress={() => setMenuPostId(null)}
                style={({ pressed }) => [styles.menuCancel, pressed && styles.menuItemPressed]}
                accessibilityRole="button"
                accessibilityLabel="신고 메뉴 취소"
              >
                <Text style={styles.menuCancelText}>취소</Text>
              </Pressable>
            </Pressable>
          </Pressable>
        </Modal>
      </View>
    </NeonBackdrop>
  );
}

const makeStyles = (styleColors: ReturnType<typeof useColors>) => StyleSheet.create({
  screen: { flex: 1, backgroundColor: styleColors.background },
  shell: { flex: 1, width: "100%", maxWidth: 520, alignSelf: "center", backgroundColor: styleColors.card },
  header: { minHeight: 64, paddingHorizontal: 15, paddingBottom: 10, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 14 },
  tabs: { flex: 1, maxWidth: 290, height: 46, padding: 4, borderRadius: 25, borderWidth: 1, borderColor: styleColors.border, backgroundColor: styleColors.card, flexDirection: "row" },
  tab: { flex: 1, borderRadius: 21, alignItems: "center", justifyContent: "center" },
  tabActive: { backgroundColor: styleColors.primary, borderWidth: 1, borderColor: styleColors.primary },
  tabText: { color: styleColors.mutedForeground, fontSize: fontSizes.body, fontFamily: fonts.semibold },
  tabTextActive: { color: styleColors.primaryForeground },
  write: { minWidth: 104, height: 46, paddingHorizontal: 15, borderRadius: 24, borderWidth: 1, borderColor: styleColors.border, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, shadowColor: styleColors.primary, shadowOpacity: 0.65, shadowRadius: 10 },
  close: { shadowOpacity: 0 },
  writeText: { color: styleColors.foreground, fontSize: fontSizes.body, fontFamily: fonts.semibold },
  content: { paddingHorizontal: 13, gap: 10 },
  profileRail: { width: "100%", justifyContent: "space-between", gap: 13, paddingVertical: 8 },
  profileItem: { width: 105, alignItems: "center" },
  profileRing: { width: 80, height: 80, borderRadius: 40, padding: 3, alignItems: "center", justifyContent: "center" },
  profileName: { color: styleColors.foreground, fontSize: fontSizes.detail, fontFamily: fonts.bold, marginTop: 7, maxWidth: 100 },
  rolePill: { minWidth: 52, borderRadius: 5, backgroundColor: styleColors.secondary, alignItems: "center", paddingHorizontal: 8, paddingVertical: 2, marginTop: 3 },
  rolePillText: { color: styleColors.mutedForeground, fontSize: fontSizes.tiny, fontFamily: fonts.bold },
  feedback: { minHeight: 48, borderRadius: radii.control, paddingHorizontal: 15, borderWidth: 1, borderColor: styleColors.border, backgroundColor: styleColors.card, flexDirection: "row", alignItems: "center", gap: 12 },
  feedbackText: { flex: 1, color: styleColors.primary, fontSize: fontSizes.detail, fontFamily: fonts.medium },
  card: { borderRadius: 16, borderWidth: 1, borderColor: styleColors.border, backgroundColor: styleColors.card, padding: 13, gap: 9, overflow: "hidden" },
  cardHeader: { flexDirection: "row", alignItems: "center", gap: 10 },
  cardAvatar: { width: 50, height: 50, borderRadius: 25, padding: 2, borderWidth: 1, borderColor: styleColors.border, alignItems: "center", justifyContent: "center" },
  cardIdentity: { flex: 1 },
  cardNameRow: { flexDirection: "row", alignItems: "center", gap: 7 },
  cardName: { color: styleColors.foreground, fontSize: fontSizes.input, fontFamily: fonts.bold },
  authorRole: { borderRadius: 5, paddingHorizontal: 8, paddingVertical: 3, backgroundColor: styleColors.primary },
  authorRoleText: { color: styleColors.foreground, fontSize: fontSizes.tiny, fontFamily: fonts.bold },
  cardTime: { color: styleColors.mutedForeground, fontSize: fontSizes.caption, marginTop: 2 },
  moreButton: { width: 36, height: 36, borderRadius: 18, alignItems: "center", justifyContent: "center" },
  cardBody: { color: styleColors.foreground, fontSize: fontSizes.body, lineHeight: 22, fontFamily: fonts.regular },
  hashtags: { color: styleColors.primary, fontSize: fontSizes.detail, lineHeight: 19 },
  mediaGrid: { height: 220, flexDirection: "row", flexWrap: "wrap", gap: 3, borderRadius: 10, overflow: "hidden" },
  mediaGridSingle: { height: 290 },
  mediaImage: { width: "49.5%", height: "49.5%", backgroundColor: styleColors.card },
  mediaSingle: { width: "100%", height: "100%" },
  mediaTwo: { width: "49.5%", height: "100%" },
  mediaThreeLead: { width: "100%", height: "59%" },
  mediaThreeTail: { width: "49.5%", height: "39.5%" },
  actions: { flexDirection: "row", alignItems: "center", gap: 28, paddingTop: 2 },
  action: { flexDirection: "row", alignItems: "center", gap: 8 },
  actionText: { color: styleColors.mutedForeground, fontSize: fontSizes.detail },
  state: { minHeight: 150, borderRadius: 16, alignItems: "center", justifyContent: "center", gap: 9, borderWidth: 1, borderColor: styleColors.border, backgroundColor: styleColors.card },
  stateTitle: { color: styleColors.foreground, fontSize: fontSizes.body, fontFamily: fonts.bold },
  stateText: { color: styleColors.mutedForeground, fontSize: fontSizes.caption },
  moreLoader: { marginVertical: 16 },
  composer: { borderRadius: 22, borderWidth: 1, borderColor: styleColors.border, padding: 15, gap: 15 },
  composerIdentity: { flexDirection: "row", alignItems: "center", gap: 10 },
  composerName: { color: styleColors.foreground, fontSize: fontSizes.headingSmall, fontFamily: fonts.bold },
  inputBox: { minHeight: 180, borderRadius: 16, borderWidth: 1, borderColor: styleColors.border, backgroundColor: styleColors.card, padding: 13 },
  composerInput: { minHeight: 115, color: styleColors.foreground, fontSize: fontSizes.input, lineHeight: 23, textAlignVertical: "top" },
  composerMediaRow: { flexDirection: "row", gap: 7, alignItems: "center" },
  photoButton: { height: 40, paddingHorizontal: 12, borderRadius: 10, borderWidth: 1, borderColor: styleColors.border, flexDirection: "row", alignItems: "center", gap: 7 },
  photoText: { color: styleColors.mutedForeground, fontSize: fontSizes.caption },
  composerPreview: { width: 40, height: 40, borderRadius: radii.small },
  supportTitle: { color: styleColors.foreground, fontSize: fontSizes.label, marginBottom: 10 },
  optional: { color: styleColors.mutedForeground, fontSize: fontSizes.caption },
  supportRail: { gap: 14, paddingBottom: 2 },
  supportItem: { width: 68, alignItems: "center", gap: 5 },
  supportAvatar: { width: 62, height: 62, borderRadius: 31, borderWidth: 1, borderColor: styleColors.border, alignItems: "center", justifyContent: "center", overflow: "hidden" },
  supportSelected: { borderWidth: 3, borderColor: styleColors.primary },
  supportName: { color: styleColors.mutedForeground, fontSize: fontSizes.tiny, maxWidth: 66 },
  publishButton: { height: 54, borderRadius: 15, overflow: "hidden" },
  publishGradient: { flex: 1, alignItems: "center", justifyContent: "center" },
  publishText: { color: styleColors.primaryForeground, fontSize: fontSizes.headingSmall, fontFamily: fonts.bold },
  disabled: { opacity: 0.45 },
  menuBackdrop: {
    flex: 1,
    justifyContent: "flex-end",
    backgroundColor: styleColors.scrim,
  },
  postMenu: {
    width: "100%",
    maxWidth: 520,
    alignSelf: "center",
    paddingHorizontal: 18,
    paddingTop: 10,
    paddingBottom: 24,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    borderWidth: 1,
    borderBottomWidth: 0,
    borderColor: styleColors.border,
    backgroundColor: styleColors.card,
  },
  menuHandle: {
    width: 42,
    height: 4,
    marginBottom: 17,
    borderRadius: 2,
    alignSelf: "center",
    backgroundColor: styleColors.secondary,
  },
  menuTitle: { color: styleColors.foreground, fontSize: fontSizes.titleSmall, fontFamily: fonts.bold },
  menuDescription: { color: styleColors.mutedForeground, fontSize: fontSizes.detail, marginTop: 5, marginBottom: 12 },
  menuItem: {
    minHeight: 50,
    paddingHorizontal: 4,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: styleColors.border,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  menuItemPressed: { opacity: 0.62 },
  menuItemText: { color: styleColors.foreground, fontSize: fontSizes.body, fontFamily: fonts.medium },
  menuCancel: {
    height: 50,
    marginTop: 14,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: styleColors.border,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: styleColors.card,
  },
  menuCancelText: { color: styleColors.mutedForeground, fontSize: fontSizes.body, fontFamily: fonts.semibold },
  pressed: { opacity: 0.66 },
});
