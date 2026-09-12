export { default } from "@/components/FeedScreenV2";
/*
import { Feather } from "@expo/vector-icons";
import { Image } from "expo-image";
import { LinearGradient } from "expo-linear-gradient";
import React, { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Alert, Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useGetMe } from "@workspace/api-client-react";

import { Avatar } from "@/components/Avatar";
import { CustomScrollView } from "@/components/CustomScroll";
import { NeonBackdrop } from "@/components/NeonUI";
import { neon } from "@/constants/colors";
import { useColors } from "@/hooks/useColors";
import { usePlayMode } from "@/hooks/usePlayMode";
import { useCharacterProfiles } from "@/hooks/useCharacterProfiles";
import {
  useStarFeed,
  type StarFeedAuthor,
  type StarFeedPost,
  type StarFeedPostKind,
  type StarFeedWritableKind,
} from "@/hooks/useStarFeed";
import { mediaUri } from "@/lib/apiBase";
import FeedScreenV2 from "@/components/FeedScreenV2";

type ColorTokens = ReturnType<typeof useColors>;

const KIND_META: Record<StarFeedPostKind, { label: string; tags: string[] }> = {
  official: { label: "STAR", tags: ["공식", "DavaQ"] },
  event: { label: "STAR", tags: ["이벤트", "미션"] },
  fan: { label: "FAN", tags: ["응원해요", "비비"] },
  star: { label: "STAR", tags: ["STAR", "성장"] },
  growth: { label: "STAR", tags: ["성장", "기록"] },
  profile_update: { label: "FAN", tags: ["프로필", "새소식"] },
  talk_diary: { label: "FAN", tags: ["대화일기", "오늘"] },
};

function metadataString(metadata: Record<string, unknown> | null | undefined, key: string) {
  const value = metadata?.[key];
  return typeof value === "string" && value.trim() ? value : null;
}

function metadataStringArray(metadata: Record<string, unknown> | null | undefined, key: string) {
  const value = metadata?.[key];
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function errorMessage(err: unknown, fallback: string) {
  if (err && typeof err === "object" && "data" in err) {
    const data = (err as { data?: { message?: unknown } }).data;
    if (typeof data?.message === "string") return data.message;
  }
  return fallback;
}

function relativeTime(value: string) {
  const timestamp = new Date(value).getTime();
  if (!Number.isFinite(timestamp)) return "방금 전";
  const minutes = Math.max(0, Math.floor((Date.now() - timestamp) / 60_000));
  if (minutes < 1) return "방금 전";
  if (minutes < 60) return `${minutes}분 전`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}시간 전`;
  return `${Math.floor(hours / 24)}일 전`;
}

function postVisualSource(post: StarFeedPost): { uri: string } | null {
  const mediaImage = (post.media ?? []).find((item) => item.mediaType === "image")?.objectPath;
  const explicit =
    mediaImage ??
    metadataString(post.metadata, "imageUrl") ??
    metadataString(post.metadata, "thumbnailUrl") ??
    metadataString(post.metadata, "coverImageUrl") ??
    metadataString(post.metadata, "newProfileImageUrl");
  return explicit ? { uri: mediaUri(explicit) } : null;
}

function StoryItem({ author, index, isOwn, onPress }: { author: StarFeedAuthor; index: number; isOwn: boolean; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={`${author.nickname} 프로필 보기`} style={({ pressed }) => [styles.storyItem, pressed && styles.pressed]}>
      <LinearGradient colors={["#F044D0", "#7B35FF", "#24D6E8"]} style={styles.storyRing}>
        <View style={styles.storyAvatarInset}>
          <Avatar
            uri={author.profileImageUrl}
            name={author.nickname}
            size={50}
            crop="face"
            characterType={author.activityProfile?.type}
          />
        </View>
        {isOwn ? <View style={styles.storyPlus}><Feather name="plus" size={12} color="#FFFFFF" /></View> : null}
      </LinearGradient>
      <View style={styles.storyNameRow}>
        <Text style={styles.storyName} numberOfLines={1}>{isOwn ? "내 스토리" : author.nickname}</Text>
        {index === 1 ? <View style={styles.verified}><Feather name="check" size={7} color="#FFFFFF" /></View> : null}
      </View>
      {index > 0 ? <Text style={styles.storyRole}>{index < 3 ? "STAR" : "FAN"}</Text> : null}
    </Pressable>
  );
}

function FeedPostCard({
  post,
  colors,
  commentDraft,
  isCheering,
  isCommenting,
  onCheer,
  onCommentDraft,
  onSubmitComment,
  onSetFollowing,
  isSettingFollowing,
  onReport,
  onRepost,
  onProfilePress,
}: {
  post: StarFeedPost;
  colors: ColorTokens;
  commentDraft: string;
  isCheering: boolean;
  isCommenting: boolean;
  onCheer: (postId: string) => void;
  onCommentDraft: (postId: string, value: string) => void;
  onSubmitComment: (postId: string) => void;
  onSetFollowing: (starProfileId: string, following: boolean) => void;
  isSettingFollowing: boolean;
  onReport: (postId: string, reason: "spam" | "harassment" | "sexual" | "violence" | "copyright" | "other") => void;
  onRepost: (postId: string) => void;
  onProfilePress: (author: StarFeedAuthor) => void;
}) {
  const [commentsOpen, setCommentsOpen] = useState(false);
  // Older production rows may contain a feed kind added after this client was
  // built. Keep the card renderable instead of crashing the whole feed screen.
  const meta = KIND_META[post.kind] ?? { label: "FAN", tags: ["DavaQ", "새 소식"] };
  const keywordTags = metadataStringArray(post.metadata, "keywords").slice(0, 2);
  const tags = keywordTags.length ? keywordTags : meta.tags;
  const canComment = commentDraft.trim().length > 0 && !isCommenting;
  const visualSource = postVisualSource(post);
  const [visualFailed, setVisualFailed] = useState(false);

  useEffect(() => {
    setVisualFailed(false);
  }, [visualSource?.uri]);

  return (
    <LinearGradient
      colors={["rgba(10,10,26,0.99)", "rgba(4,6,18,0.99)"]}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 1 }}
      style={styles.feedCard}
    >
      <View pointerEvents="none" style={styles.cardGlow} />
      <View style={styles.feedHeader}>
        <Pressable onPress={() => onProfilePress(post.author)} accessibilityRole="button" accessibilityLabel={`${post.author.nickname} 프로필 보기`} style={styles.avatarRing}>
          <Avatar
            uri={post.author.profileImageUrl}
            name={post.author.nickname}
            size={44}
            crop="face"
            characterType={post.author.activityProfile?.type}
          />
        </Pressable>
        <View style={styles.feedIdentity}>
          <View style={styles.authorRow}>
            <Text style={styles.feedAuthor} numberOfLines={1}>{post.author.nickname}</Text>
            <View style={styles.verified}><Feather name="check" size={7} color="#FFFFFF" /></View>
            <Text style={styles.feedRole}>{meta.label}</Text>
          </View>
          <Text style={styles.feedTime}>{relativeTime(post.createdAt)}</Text>
        </View>
        {post.author.starProfile ? (
          <Pressable
            disabled={isSettingFollowing}
            onPress={() => onSetFollowing(post.author.starProfile!.id, post.author.starProfile!.followedByMe)}
            style={[styles.followButton, post.author.starProfile.followedByMe && styles.followButtonActive]}
          >
            <Text style={styles.followButtonText}>{post.author.starProfile.followedByMe ? "팔로잉" : "팔로우"}</Text>
          </Pressable>
        ) : null}
        <Pressable onPress={() => Alert.alert("게시물 신고", "신고 사유를 선택해주세요.", [
          { text: "스팸", onPress: () => onReport(post.id, "spam") },
          { text: "괴롭힘", onPress: () => onReport(post.id, "harassment") },
          { text: "부적절한 콘텐츠", onPress: () => onReport(post.id, "other") },
          { text: "취소", style: "cancel" },
        ])} accessibilityLabel="게시물 신고"><Feather name="more-vertical" size={18} color="#9C98A6" /></Pressable>
      </View>

      <View style={styles.feedMain}>
        <View style={styles.feedCopy}>
          <Text style={styles.feedTitle} numberOfLines={2}>{post.title}</Text>
          <Text style={styles.feedBody} numberOfLines={3}>{post.body}</Text>
          {post.targetStarProfile ? <Text style={styles.targetLabel}>응원 STAR · {post.targetStarProfile.displayName}</Text> : null}
          <View style={styles.tagRow}>
            {tags.map((tag) => <Text key={tag} style={styles.tag}>#{tag}</Text>)}
          </View>
        </View>
        {visualSource && !visualFailed ? (
          <View style={styles.visualWrap}>
            <Image
              source={visualSource}
              style={styles.feedVisual}
              contentFit="cover"
              onError={() => setVisualFailed(true)}
            />
            {post.kind === "event" ? <View style={styles.playButton}><Feather name="play" size={18} color="#FFFFFF" /></View> : null}
          </View>
        ) : null}
      </View>

      <View style={styles.actionRow}>
        <Pressable
          disabled={post.reactedByMe || isCheering}
          onPress={() => onCheer(post.id)}
          style={({ pressed }) => [styles.actionButton, pressed && styles.pressed]}
        >
          <Feather name="heart" size={20} color={post.reactedByMe ? neon.magenta : "#B847FF"} />
          <Text style={styles.actionCount}>{post.reactionCount}</Text>
        </Pressable>
        <Pressable onPress={() => setCommentsOpen((open) => !open)} style={({ pressed }) => [styles.actionButton, pressed && styles.pressed]}>
          <Feather name="message-circle" size={19} color="#B9B4C3" />
          <Text style={styles.actionCount}>{post.commentCount}</Text>
        </Pressable>
        <Pressable onPress={() => onRepost(post.id)} style={({ pressed }) => [styles.shareButton, pressed && styles.pressed]} accessibilityLabel="리포스트">
          <Feather name="share-2" size={18} color="#B9B4C3" />
        </Pressable>
      </View>

      {commentsOpen ? (
        <View style={styles.commentsPanel}>
          {post.recentComments.map((comment) => (
            <View key={comment.id} style={styles.commentRow}>
              <Text style={styles.commentAuthor}>{comment.author.nickname}</Text>
              <Text style={styles.commentBody}>{comment.body}</Text>
            </View>
          ))}
          <View style={styles.commentInputRow}>
            <TextInput
              value={commentDraft}
              onChangeText={(value) => onCommentDraft(post.id, value)}
              placeholder="댓글로 응원하기"
              placeholderTextColor={colors.mutedForeground}
              style={styles.commentInput}
              maxLength={240}
            />
            <Pressable
              disabled={!canComment}
              onPress={() => onSubmitComment(post.id)}
              style={[styles.commentSubmit, { opacity: canComment ? 1 : 0.42 }]}
            >
              <Feather name="send" size={15} color="#FFFFFF" />
            </Pressable>
          </View>
        </View>
      ) : null}
    </LinearGradient>
  );
}

function LegacyFeedScreen() {
  const router = useRouter();
  const { postId } = useLocalSearchParams<{ postId?: string }>();
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { data: me } = useGetMe();
  const { mode, equippedStar } = usePlayMode();
  const { activeProfile, profiles: characterProfiles, activateProfile } = useCharacterProfiles();
  const [feedMode, setFeedMode] = useState<StarFeedWritableKind>(mode);
  const [selectedProfile, setSelectedProfile] = useState<StarFeedAuthor | null>(null);
  const {
    posts,
    isLoading,
    isFetching,
    error,
    refetch,
    cheerPost,
    commentPost,
    setStarFollowing,
    reportPost,
    repostPost,
    resultDrafts,
    approveResultDraft,
    discardResultDraft,
    isResolvingResultDraft,
    isCheering,
    isCommenting,
    isSettingStarFollowing,
  } = useStarFeed("recommended");
  const visiblePosts = useMemo(() => {
    const modePosts = posts.filter((post) =>
      feedMode === "star"
        ? ["official", "event", "star", "growth"].includes(post.kind)
        : ["fan", "profile_update", "talk_diary"].includes(post.kind),
    );
    if (!postId) return modePosts;
    const target = modePosts.find((post) => post.id === postId);
    return target ? [target, ...modePosts.filter((post) => post.id !== postId)] : modePosts;
  }, [feedMode, postId, posts]);
  const [commentDrafts, setCommentDrafts] = useState<Record<string, string>>({});
  const [feedback, setFeedback] = useState<string | null>(null);

  useEffect(() => {
    setFeedMode(mode);
  }, [mode]);

  const selectFeedMode = (nextMode: StarFeedWritableKind) => {
    setFeedMode(nextMode);
    const candidate = nextMode === "star"
      ? characterProfiles.find((profile) => profile.id === equippedStar?.id && profile.status === "active")
      : characterProfiles.find((profile) => profile.type === "fan" && profile.status === "active");
    if (candidate && candidate.id !== activeProfile?.id) void activateProfile(candidate.id);
  };

  const storyAuthors = useMemo(() => {
    const unique = new Map<string, StarFeedAuthor>();
    posts.forEach((post) => {
      const key = post.author.id ?? post.author.nickname;
      if (!unique.has(key)) unique.set(key, post.author);
    });
    const own = me?.id && activeProfile?.id
      ? { id: activeProfile.id, nickname: activeProfile.displayName ?? me.nickname, profileImageUrl: activeProfile.profileImageUrl ?? null, activityProfile: activeProfile, starProfile: null }
      : null;
    const others = [...unique.values()].filter((author) => author.id !== activeProfile?.id);
    return (own ? [own, ...others] : others).slice(0, 7);
  }, [posts, me, activeProfile]);
  function openProfile(author: StarFeedAuthor) {
    if (author.activityProfile?.id) {
      router.push({ pathname: "/(tabs)/character/[profileId]", params: { profileId: author.activityProfile.id } } as never);
      return;
    }
    if (author.id) {
      router.push({ pathname: "/profile/[userId]", params: { userId: author.id } } as never);
    } else {
      setSelectedProfile(author);
    }
  }

  async function cheer(postId: string) {
    try {
      await cheerPost(postId);
    } catch {
      setFeedback("응원 반응을 남기지 못했어요.");
    }
  }

  async function submitComment(postId: string) {
    const body = (commentDrafts[postId] ?? "").trim();
    if (!body) return;
    try {
      await commentPost({ postId, body });
      setCommentDrafts((prev) => ({ ...prev, [postId]: "" }));
    } catch {
      setFeedback("댓글을 남기지 못했어요.");
    }
  }

  async function setFollowing(starProfileId: string, following: boolean) {
    try {
      await setStarFollowing({ starProfileId, following });
    } catch (err) {
      setFeedback(errorMessage(err, "팔로우 상태를 변경하지 못했습니다."));
    }
  }

  async function report(postId: string, reason: "spam" | "harassment" | "sexual" | "violence" | "copyright" | "other") {
    try {
      await reportPost({ postId, reason });
      setFeedback("신고가 접수되어 게시물을 검토 대상으로 전환했습니다.");
    } catch (err) {
      setFeedback(errorMessage(err, "신고를 접수하지 못했습니다."));
    }
  }

  async function resolveResultDraft(id: string, approve: boolean) {
    try {
      if (approve) await approveResultDraft(id); else await discardResultDraft(id);
      setFeedback(approve ? "결과 카드를 STAR 피드에 게시했습니다." : "결과 카드 초안을 폐기했습니다.");
    } catch (err) { setFeedback(errorMessage(err, "결과 카드를 처리하지 못했습니다.")); }
  }

  async function repost(postId: string) {
    try { await repostPost(postId); setFeedback("리포스트했습니다."); }
    catch (err) { setFeedback(errorMessage(err, "리포스트하지 못했습니다.")); }
  }

  return (
    <NeonBackdrop style={styles.container}>
      <View style={[styles.header, { paddingTop: insets.top + 6 }]}>
        <View style={styles.feedTabs}>
          {(["star", "fan"] as const).map((item) => {
            const active = feedMode === item;
            return (
              <Pressable key={item} onPress={() => selectFeedMode(item)} style={styles.feedTabPressable}>
                {active ? (
                  <LinearGradient colors={["#481378", "#1B0737"]} style={styles.feedTabActive}>
                    <Text style={styles.feedTabActiveText}>{item === "star" ? "STAR" : "FAN"}</Text>
                  </LinearGradient>
                ) : <Text style={styles.feedTabText}>{item === "star" ? "STAR" : "FAN"}</Text>}
              </Pressable>
            );
          })}
        </View>
        <Pressable
          onPress={() => router.push({ pathname: "/feed/write", params: { kind: feedMode } } as never)}
          style={({ pressed }) => [styles.writeButton, pressed && styles.pressed]}
        >
          <Feather name="plus" size={19} color="#B84CFF" />
          <Text style={styles.writeButtonText}>글쓰기</Text>
        </Pressable>
      </View>

      <CustomScrollView contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 100 }]}>
        {resultDrafts.filter((draft) => draft.status === "DRAFT").map((draft) => (
          <View key={draft.id} style={styles.resultDraftCard}>
            <Text style={styles.resultDraftEyebrow}>STAR 결과 카드 초안</Text>
            <Text style={styles.resultDraftTitle}>{draft.title}</Text>
            <Text style={styles.resultDraftBody} numberOfLines={2}>{draft.body}</Text>
            <View style={styles.resultDraftActions}>
              <Pressable disabled={isResolvingResultDraft} onPress={() => void resolveResultDraft(draft.id, false)} style={styles.resultDraftDiscard}><Text style={styles.resultDraftDiscardText}>폐기</Text></Pressable>
              <Pressable disabled={isResolvingResultDraft} onPress={() => void resolveResultDraft(draft.id, true)} style={styles.resultDraftApprove}><Text style={styles.resultDraftApproveText}>승인 후 게시</Text></Pressable>
            </View>
          </View>
        ))}
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.stories}>
          {storyAuthors.map((author, index) => <StoryItem key={author.id ?? `${author.nickname}-${index}`} author={author} index={index} isOwn={author.id === me?.id} onPress={() => openProfile(author)} />)}
        </ScrollView>

        {feedback ? <Text style={styles.feedbackBanner}>{feedback}</Text> : null}

        {isLoading || isFetching ? (
          <View style={styles.stateBox}><ActivityIndicator color={neon.purple} /><Text style={styles.stateText}>피드를 불러오는 중이에요.</Text></View>
        ) : error ? (
          <Pressable onPress={() => void refetch()} style={styles.stateBox}><Text style={styles.stateTitle}>피드를 불러오지 못했어요</Text><Text style={styles.stateText}>눌러서 다시 시도해 주세요.</Text></Pressable>
        ) : visiblePosts.length === 0 ? (
          <View style={styles.stateBox}><Text style={styles.stateTitle}>{feedMode === "star" ? "아직 STAR 기록이 없어요" : "아직 FAN 피드가 비어 있어요"}</Text><Text style={styles.stateText}>{feedMode === "star" ? "STAR 활동과 성장 결과가 여기에 모입니다." : "첫 FAN 응원글을 남겨보세요."}</Text></View>
        ) : (
          <View style={styles.feedList}>
            {visiblePosts.map((post) => (
              <FeedPostCard
                key={post.id}
                post={post}
                colors={colors}
                commentDraft={commentDrafts[post.id] ?? ""}
                isCheering={isCheering}
                isCommenting={isCommenting}
                onCheer={(postId) => void cheer(postId)}
                onCommentDraft={(postId, value) => setCommentDrafts((prev) => ({ ...prev, [postId]: value }))}
                onSubmitComment={(postId) => void submitComment(postId)}
                onSetFollowing={(starProfileId, following) => void setFollowing(starProfileId, following)}
                isSettingFollowing={isSettingStarFollowing}
                onReport={(postId, reason) => void report(postId, reason)}
                onRepost={(postId) => void repost(postId)}
                onProfilePress={openProfile}
              />
            ))}
          </View>
        )}
      </CustomScrollView>
      <Modal visible={!!selectedProfile} transparent animationType="slide" onRequestClose={() => setSelectedProfile(null)}>
        {selectedProfile ? (
          <View style={styles.profileSheetBackdrop}>
            <View style={styles.profileSheet}>
              <Pressable onPress={() => setSelectedProfile(null)} style={styles.profileClose}><Feather name="x" size={20} color="#D8D2E0" /></Pressable>
              <View style={styles.profileHero}><View style={styles.profileAvatar}><Avatar uri={selectedProfile.profileImageUrl} name={selectedProfile.nickname} size={72} crop="face" characterType={selectedProfile.activityProfile?.type} /></View><Text style={styles.profileName}>{selectedProfile.nickname}</Text><Text style={styles.profileRole}>{selectedProfile.starProfile ? `STAR · ${selectedProfile.starProfile.displayName}` : "FAN"}</Text></View>
              {selectedProfile.starProfile ? <Text style={styles.profileMeta}>NFT 단계: {selectedProfile.starProfile.stage === "promoted" ? "PROMOTED" : "ASPIRING"}</Text> : null}
              {selectedProfile.id === me?.id ? (
                <Pressable onPress={() => { setSelectedProfile(null); router.push("/profile/edit"); }} style={styles.profileFollow}><Text style={styles.profileFollowText}>내 프로필 관리</Text></Pressable>
              ) : (
                <Pressable disabled={!selectedProfile.starProfile || isSettingStarFollowing} onPress={() => selectedProfile.starProfile && void setFollowing(selectedProfile.starProfile.id, selectedProfile.starProfile.followedByMe)} style={[styles.profileFollow, (!selectedProfile.starProfile || isSettingStarFollowing) && styles.profileFollowDisabled]}><Text style={styles.profileFollowText}>{selectedProfile.starProfile?.followedByMe ? "팔로잉" : "팔로우"}</Text></Pressable>
              )}
              <Text style={styles.profileSectionTitle}>공개 피드</Text>
              <ScrollView style={styles.profilePosts} contentContainerStyle={styles.profilePostsContent}>{posts.filter((post) => post.author.id === selectedProfile.id).slice(0, 10).map((post) => <View key={post.id} style={styles.profilePost}><Text style={styles.profilePostTitle}>{post.title}</Text><Text style={styles.profilePostBody} numberOfLines={2}>{post.body}</Text></View>)}{posts.every((post) => post.author.id !== selectedProfile.id) ? <Text style={styles.profileEmpty}>표시할 공개 게시물이 없어요.</Text> : null}</ScrollView>
            </View>
          </View>
        ) : null}
      </Modal>
    </NeonBackdrop>
  );
}

export default FeedScreenV2;

const styles = StyleSheet.create({
  container: { flex: 1 },
  pressed: { opacity: 0.78, transform: [{ scale: 0.99 }] },
  header: { minHeight: 55, paddingHorizontal: 13, paddingBottom: 7, flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  feedTabs: { width: 193, height: 39, padding: 3, borderRadius: 22, borderWidth: 1, borderColor: "rgba(123,53,255,0.26)", backgroundColor: "rgba(6,6,18,0.9)", flexDirection: "row" },
  feedTabPressable: { flex: 1, alignItems: "center", justifyContent: "center", borderRadius: 19, overflow: "hidden" },
  feedTabActive: { width: "100%", height: "100%", borderRadius: 19, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: "rgba(182,75,255,0.62)", shadowColor: "#A64DFF", shadowOpacity: 0.7, shadowRadius: 8 },
  feedTabActiveText: { color: "#F4E9FF", fontFamily: "Inter_600SemiBold", fontSize: 12 },
  feedTabText: { color: "#9A94A6", fontFamily: "Inter_500Medium", fontSize: 12 },
  writeButton: { height: 39, paddingHorizontal: 16, borderRadius: 22, borderWidth: 1, borderColor: "rgba(92,69,157,0.26)", backgroundColor: "rgba(13,13,30,0.94)", flexDirection: "row", alignItems: "center", gap: 8 },
  writeButtonText: { color: "#D8D2E0", fontFamily: "Inter_500Medium", fontSize: 12 },
  content: { paddingHorizontal: 7, gap: 8 },
  stories: { gap: 10, paddingHorizontal: 4, paddingVertical: 7 },
  storyItem: { width: 61, alignItems: "center" },
  storyRing: { width: 58, height: 58, borderRadius: 29, padding: 2, alignItems: "center", justifyContent: "center" },
  storyAvatarInset: { width: 54, height: 54, borderRadius: 27, backgroundColor: "#05040D", padding: 2, alignItems: "center", justifyContent: "center" },
  storyPlus: { position: "absolute", right: -2, bottom: 1, width: 18, height: 18, borderRadius: 9, alignItems: "center", justifyContent: "center", backgroundColor: "#8A39FF", borderWidth: 2, borderColor: "#05040D" },
  storyNameRow: { maxWidth: 61, flexDirection: "row", alignItems: "center", gap: 3, marginTop: 6 },
  storyName: { color: "#C4BFCA", fontFamily: "Inter_400Regular", fontSize: 9, maxWidth: 52 },
  storyRole: { color: "#C047FF", fontFamily: "Inter_500Medium", fontSize: 9, marginTop: 2 },
  verified: { width: 11, height: 11, borderRadius: 6, alignItems: "center", justifyContent: "center", backgroundColor: "#7B35FF" },
  profileSheetBackdrop: { flex: 1, justifyContent: "flex-end", backgroundColor: "rgba(0,0,0,0.62)" },
  profileSheet: { maxHeight: "78%", minHeight: 360, borderTopLeftRadius: 26, borderTopRightRadius: 26, backgroundColor: "#0D0A1D", borderWidth: 1, borderColor: "rgba(166,77,255,0.42)", padding: 20 },
  profileClose: { alignSelf: "flex-end", padding: 4 },
  profileHero: { alignItems: "center", marginTop: -8, marginBottom: 10 },
  profileAvatar: { width: 82, height: 82, borderRadius: 41, padding: 4, borderWidth: 1, borderColor: "#B84CFF", backgroundColor: "#21143B" },
  profileName: { color: "#F0EDF4", fontFamily: "Inter_700Bold", fontSize: 18, marginTop: 9 },
  profileRole: { color: "#C48AFF", fontFamily: "Inter_500Medium", fontSize: 11, marginTop: 3 },
  profileMeta: { color: "#A9A3BA", fontFamily: "Inter_400Regular", fontSize: 11, textAlign: "center" },
  profileFollow: { alignSelf: "center", marginTop: 12, borderRadius: 999, paddingHorizontal: 28, paddingVertical: 9, backgroundColor: "#7E36D7" },
  profileFollowDisabled: { opacity: 0.5 },
  profileFollowText: { color: "#FFFFFF", fontFamily: "Inter_600SemiBold", fontSize: 12 },
  profileSectionTitle: { color: "#F0EDF4", fontFamily: "Inter_700Bold", fontSize: 14, marginTop: 18, marginBottom: 8 },
  profilePosts: { flex: 1 },
  profilePostsContent: { gap: 8, paddingBottom: 20 },
  profilePost: { borderRadius: 12, borderWidth: 1, borderColor: "rgba(123,53,255,0.24)", backgroundColor: "rgba(30,18,55,0.72)", padding: 11 },
  profilePostTitle: { color: "#EDE5FA", fontFamily: "Inter_600SemiBold", fontSize: 12 },
  profilePostBody: { color: "#B9B1C7", fontFamily: "Inter_400Regular", fontSize: 11, lineHeight: 16, marginTop: 4 },
  profileEmpty: { color: "#8D879A", fontFamily: "Inter_400Regular", fontSize: 11, textAlign: "center", paddingVertical: 20 },
  feedList: { gap: 8 },
  feedCard: { borderRadius: 13, borderWidth: StyleSheet.hairlineWidth, borderColor: "rgba(61,56,113,0.42)", padding: 11, overflow: "hidden" },
  cardGlow: { position: "absolute", right: -80, top: -90, width: 230, height: 190, borderRadius: 120, backgroundColor: "rgba(43,34,126,0.10)" },
  feedHeader: { height: 46, flexDirection: "row", alignItems: "center", gap: 9 },
  avatarRing: { width: 48, height: 48, padding: 2, borderRadius: 24, borderWidth: 1, borderColor: "#A63CFF", alignItems: "center", justifyContent: "center" },
  feedIdentity: { flex: 1 },
  followButton: { borderWidth: 1, borderColor: "#7E36D7", borderRadius: 999, paddingHorizontal: 10, paddingVertical: 6 },
  followButtonActive: { borderColor: "#4F4A58", backgroundColor: "#211D29" },
  followButtonText: { color: "#E1C7FF", fontFamily: "Inter_600SemiBold", fontSize: 11 },
  resultDraftCard: { backgroundColor: "#191126", borderColor: "#7138A2", borderWidth: 1, borderRadius: 16, padding: 14, gap: 6 },
  resultDraftEyebrow: { color: "#D7A7FF", fontFamily: "Inter_700Bold", fontSize: 11 },
  resultDraftTitle: { color: "#F2EDF7", fontFamily: "Inter_700Bold", fontSize: 15 },
  resultDraftBody: { color: "#B9B2C1", fontFamily: "Inter_400Regular", fontSize: 13 },
  resultDraftActions: { flexDirection: "row", justifyContent: "flex-end", gap: 8, marginTop: 4 },
  resultDraftDiscard: { paddingHorizontal: 12, paddingVertical: 8 },
  resultDraftDiscardText: { color: "#B9B2C1", fontFamily: "Inter_600SemiBold", fontSize: 12 },
  resultDraftApprove: { backgroundColor: "#7736B7", borderRadius: 9, paddingHorizontal: 12, paddingVertical: 8 },
  resultDraftApproveText: { color: "#FFFFFF", fontFamily: "Inter_700Bold", fontSize: 12 },
  authorRow: { flexDirection: "row", alignItems: "center", gap: 5 },
  feedAuthor: { color: "#E6E2EB", fontFamily: "Inter_500Medium", fontSize: 12, maxWidth: "58%" },
  feedRole: { color: "#C143FF", fontFamily: "Inter_500Medium", fontSize: 9 },
  feedTime: { color: "#777181", fontFamily: "Inter_400Regular", fontSize: 9, marginTop: 3 },
  feedMain: { flexDirection: "row", gap: 10, marginTop: 8 },
  feedCopy: { flex: 1, minWidth: 0, paddingVertical: 2 },
  feedTitle: { color: "#F0EDF4", fontFamily: "Inter_500Medium", fontSize: 12, lineHeight: 17 },
  feedBody: { color: "#C0BAC6", fontFamily: "Inter_400Regular", fontSize: 11, lineHeight: 16, marginTop: 5 },
  targetLabel: { color: "#C98CFF", fontFamily: "Inter_600SemiBold", fontSize: 10, marginTop: 6 },
  tagRow: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 7 },
  tag: { color: "#9563B9", fontFamily: "Inter_400Regular", fontSize: 9 },
  visualWrap: { width: "48%", height: 112, borderRadius: 10, overflow: "hidden", backgroundColor: "#100D23", borderWidth: StyleSheet.hairlineWidth, borderColor: "rgba(123,53,255,0.24)" },
  feedVisual: { width: "100%", height: "100%" },
  playButton: { position: "absolute", left: 10, bottom: 10, width: 36, height: 36, borderRadius: 18, backgroundColor: "rgba(5,4,13,0.78)", borderWidth: 1, borderColor: "rgba(83,224,232,0.65)", alignItems: "center", justifyContent: "center" },
  actionRow: { height: 30, flexDirection: "row", alignItems: "center", marginTop: 7, paddingLeft: 2 },
  actionButton: { flexDirection: "row", alignItems: "center", gap: 7, paddingRight: 23 },
  actionCount: { color: "#AAA5B2", fontFamily: "Inter_400Regular", fontSize: 10 },
  shareButton: { marginLeft: 2 },
  commentsPanel: { marginTop: 8, paddingTop: 9, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: "rgba(112,70,161,0.22)", gap: 7 },
  commentRow: { flexDirection: "row", gap: 7 },
  commentAuthor: { color: neon.text, fontFamily: "Inter_600SemiBold", fontSize: 10 },
  commentBody: { flex: 1, color: neon.muted, fontFamily: "Inter_400Regular", fontSize: 10 },
  commentInputRow: { height: 37, flexDirection: "row", gap: 7 },
  commentInput: { flex: 1, borderRadius: 19, borderWidth: 1, borderColor: "rgba(122,64,168,0.35)", backgroundColor: "#0B0A16", color: neon.text, paddingHorizontal: 12, fontFamily: "Inter_400Regular", fontSize: 11 },
  commentSubmit: { width: 37, height: 37, borderRadius: 19, backgroundColor: "#6A3DA8", alignItems: "center", justifyContent: "center" },
  feedbackBanner: { color: "#FF7770", backgroundColor: "rgba(80,20,32,0.35)", borderRadius: 10, padding: 10, fontFamily: "Inter_500Medium", fontSize: 11 },
  stateBox: { minHeight: 120, borderRadius: 16, borderWidth: 1, borderColor: "rgba(80,62,124,0.35)", backgroundColor: "rgba(9,9,22,0.94)", alignItems: "center", justifyContent: "center", gap: 8 },
  stateTitle: { color: neon.text, fontFamily: "Inter_700Bold", fontSize: 14 },
  stateText: { color: neon.muted, fontFamily: "Inter_400Regular", fontSize: 11 },
});
*/
