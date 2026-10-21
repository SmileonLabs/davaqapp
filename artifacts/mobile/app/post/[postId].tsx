import { useMemo } from "react";
import { useColors } from "@/hooks/useColors";
import { fonts, fontSizes, radii } from "@/constants/designSystem";
import { Feather } from "@expo/vector-icons";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { customFetch } from "@workspace/api-client-react";
import { Image } from "expo-image";
import { useLocalSearchParams, useRouter } from "expo-router";
import React from "react";
import {
  ActivityIndicator,
  Platform,
  Pressable,
  RefreshControl,
  Share,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Avatar } from "@/components/Avatar";
import { CustomScrollView } from "@/components/CustomScroll";
import { useMediaUri } from "@/hooks/useMediaUri";
import type { StarFeedPost } from "@/hooks/useStarFeed";
import { crossAlert } from "@/lib/crossAlert";

type StarFeedListWireResponse =
  | StarFeedPost[]
  | { items?: StarFeedPost[]; nextCursor?: string | null };

function postsFromWire(response: StarFeedListWireResponse): StarFeedPost[] {
  if (Array.isArray(response)) return response.filter(Boolean);
  return Array.isArray(response.items) ? response.items.filter(Boolean) : [];
}

async function loadPostDetail(postId: string): Promise<StarFeedPost> {
  try {
    return await customFetch<StarFeedPost>(`/api/star-feed/posts/${postId}`, {
      responseType: "json",
    });
  } catch (detailError) {
    // The production API deployed before the detail endpoint existed. Keep
    // local/test PWA navigation compatible by resolving the post from the
    // existing feed-list contract until the API rollout catches up.
    const scopes = ["recommended", "following"] as const;
    const pages = await Promise.allSettled(
      scopes.map((scope) =>
        customFetch<StarFeedListWireResponse>(
          `/api/star-feed/posts?scope=${scope}&limit=100`,
          { responseType: "json" },
        ),
      ),
    );
    for (const page of pages) {
      if (page.status !== "fulfilled") continue;
      const post = postsFromWire(page.value).find((item) => item.id === postId);
      if (post) return post;
    }
    throw detailError;
  }
}

function displayName(post: StarFeedPost) {
  return post.author.activityProfile?.displayName || post.author.nickname;
}

function roleLabel(post: StarFeedPost) {
  return post.author.activityProfile?.type === "star" ? "STAR" : "FAN";
}

function formattedDate(value: string) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "";
  return new Intl.DateTimeFormat("ko-KR", {
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function PostMediaImage({
  objectPath,
  accessibilityLabel,
}: {
  objectPath: string;
  accessibilityLabel: string;
}) {
  const styleColors = useColors();
  const styles = useMemo(() => makeStyles(styleColors), [styleColors]);

  const uri = useMediaUri(objectPath);
  return uri ? (
    <Image
      source={{ uri }}
      contentFit="cover"
      transition={180}
      style={styles.media}
      accessibilityLabel={accessibilityLabel}
    />
  ) : (
    <View style={styles.media} />
  );
}

export default function PostDetailScreen() {
  const styleColors = useColors();
  const styles = useMemo(() => makeStyles(styleColors), [styleColors]);

  const router = useRouter();
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();
  const { postId } = useLocalSearchParams<{ postId?: string }>();
  const queryKey = ["star-feed", "post", postId] as const;
  const [comment, setComment] = React.useState("");

  const query = useQuery({
    queryKey,
    enabled: !!postId,
    queryFn: () => loadPostDetail(postId!),
  });

  const reaction = useMutation({
    mutationFn: (post: StarFeedPost) =>
      customFetch<StarFeedPost>(`/api/star-feed/posts/${post.id}/reactions`, {
        method: post.reactedByMe ? "DELETE" : "POST",
        responseType: "json",
      }),
    onSuccess: (post) => queryClient.setQueryData(queryKey, post),
  });

  const submitComment = useMutation({
    mutationFn: (body: string) =>
      customFetch<StarFeedPost>(`/api/star-feed/posts/${postId}/comments`, {
        method: "POST",
        responseType: "json",
        body: JSON.stringify({ body }),
      }),
    onSuccess: (post) => {
      queryClient.setQueryData(queryKey, post);
      setComment("");
    },
  });

  const goBack = React.useCallback(() => {
    if (router.canGoBack()) router.back();
    else router.replace("/(tabs)/feed" as never);
  }, [router]);

  const share = async () => {
    const post = query.data;
    if (!post) return;
    const url = Platform.OS === "web" && typeof window !== "undefined"
      ? `${window.location.origin}/app/post/${post.id}`
      : `https://davaq.app/app/post/${post.id}`;
    try {
      await Share.share({ title: `${displayName(post)}님의 게시물`, message: `${post.body}\n${url}`, url });
    } catch {
      crossAlert("공유 실패", "게시물을 공유하지 못했습니다.");
    }
  };

  const post = query.data;
  const canComment = comment.trim().length > 0 && !submitComment.isPending;

  return (
    <View style={styles.screen}>
      <View style={[styles.header, { paddingTop: insets.top + 8 }]}>
        <Pressable onPress={goBack} hitSlop={12} style={styles.headerButton} accessibilityRole="button" accessibilityLabel="뒤로가기">
          <Feather name="arrow-left" size={27} color={styleColors.foreground} />
        </Pressable>
        <Text style={styles.headerTitle}>게시물</Text>
        <Pressable onPress={() => void share()} disabled={!post} hitSlop={12} style={styles.headerButton} accessibilityRole="button" accessibilityLabel="게시물 공유">
          <Feather name="share-2" size={22} color={post ? styleColors.foreground : styleColors.mutedForeground} />
        </Pressable>
      </View>

      {query.isLoading ? (
        <View style={styles.center}><ActivityIndicator size="large" color={styleColors.primary} /><Text style={styles.muted}>게시물을 불러오는 중이에요.</Text></View>
      ) : query.error || !post ? (
        <View style={styles.center}>
          <Feather name="alert-circle" size={42} color={styleColors.mutedForeground} />
          <Text style={styles.errorTitle}>게시물을 불러오지 못했어요.</Text>
          <Text style={styles.muted}>삭제되었거나 볼 수 없는 게시물일 수 있어요.</Text>
          <Pressable onPress={() => void query.refetch()} style={styles.retryButton}><Text style={styles.retryText}>다시 시도</Text></Pressable>
        </View>
      ) : (
        <CustomScrollView
          refreshControl={<RefreshControl refreshing={query.isRefetching} onRefresh={() => void query.refetch()} tintColor={styleColors.primary} />}
          contentContainerStyle={[styles.content, { paddingBottom: Math.max(insets.bottom, 10) + 28 }]}
        >
          <View style={styles.authorRow}>
            <Pressable
              onPress={() => post.author.activityProfile?.id && router.push({ pathname: "/(tabs)/character/[profileId]", params: { profileId: post.author.activityProfile.id } } as never)}
              accessibilityRole="button"
              accessibilityLabel={`${displayName(post)} 프로필 열기`}
            >
              <Avatar uri={post.author.profileImageUrl} name={displayName(post)} size={52} crop="face" characterType={post.author.activityProfile?.type} />
            </Pressable>
            <View style={styles.authorIdentity}>
              <View style={styles.nameRow}>
                <Text style={styles.authorName}>{displayName(post)}</Text>
                <View style={styles.roleBadge}><Text style={styles.roleText}>{roleLabel(post)}</Text></View>
              </View>
              <Text style={styles.date}>{formattedDate(post.createdAt)}</Text>
            </View>
          </View>

          {post.title ? <Text style={styles.title}>{post.title}</Text> : null}
          <Text style={styles.body}>{post.body}</Text>
          {post.hashtags?.length ? <Text style={styles.hashtags}>{post.hashtags.map((tag) => `#${tag}`).join("  ")}</Text> : null}

          {(post.media ?? []).filter((item) => item.mediaType === "image").map((item, index) => (
            <PostMediaImage
              key={`${item.objectPath}-${index}`}
              objectPath={item.objectPath}
              accessibilityLabel={item.altText || `게시물 이미지 ${index + 1}`}
            />
          ))}

          <View style={styles.actions}>
            <Pressable
              disabled={reaction.isPending}
              onPress={() => reaction.mutate(post)}
              style={({ pressed }) => [styles.action, pressed && styles.pressed]}
              accessibilityRole="button"
              accessibilityLabel={post.reactedByMe ? "좋아요 취소" : "좋아요"}
            >
              <Feather name="heart" size={23} color={post.reactedByMe ? styleColors.primary : styleColors.mutedForeground} />
              <Text style={[styles.actionText, post.reactedByMe && styles.actionActive]}>{post.reactionCount.toLocaleString()}</Text>
            </Pressable>
            <View style={styles.action}><Feather name="message-circle" size={22} color={styleColors.mutedForeground} /><Text style={styles.actionText}>{post.commentCount.toLocaleString()}</Text></View>
            <Pressable onPress={() => void share()} style={({ pressed }) => [styles.action, pressed && styles.pressed]} accessibilityRole="button" accessibilityLabel="공유">
              <Feather name="share-2" size={21} color={styleColors.mutedForeground} /><Text style={styles.actionText}>공유</Text>
            </Pressable>
          </View>

          <View style={styles.divider} />
          <Text style={styles.commentsTitle}>댓글 {post.commentCount.toLocaleString()}</Text>
          <View style={styles.commentInputRow}>
            <TextInput
              value={comment}
              onChangeText={setComment}
              maxLength={240}
              placeholder="댓글을 입력해 주세요."
              placeholderTextColor={styleColors.mutedForeground}
              style={styles.commentInput}
              returnKeyType="send"
              onSubmitEditing={() => canComment && submitComment.mutate(comment.trim())}
            />
            <Pressable
              disabled={!canComment}
              onPress={() => submitComment.mutate(comment.trim())}
              style={[styles.sendButton, !canComment && styles.disabled]}
              accessibilityRole="button"
              accessibilityLabel="댓글 등록"
            >
              {submitComment.isPending ? <ActivityIndicator size="small" color={styleColors.foreground} /> : <Feather name="send" size={18} color={styleColors.foreground} />}
            </Pressable>
          </View>
          {submitComment.isError ? <Text style={styles.commentError}>댓글을 등록하지 못했어요. 다시 시도해 주세요.</Text> : null}

          {post.recentComments.length ? post.recentComments.map((item) => (
            <View key={item.id} style={styles.comment}>
              <Avatar uri={item.author.profileImageUrl} name={item.author.activityProfile?.displayName || item.author.nickname} size={36} crop="face" characterType={item.author.activityProfile?.type} />
              <View style={styles.commentCopy}>
                <Text style={styles.commentAuthor}>{item.author.activityProfile?.displayName || item.author.nickname}</Text>
                <Text style={styles.commentBody}>{item.body}</Text>
                <Text style={styles.commentDate}>{formattedDate(item.createdAt)}</Text>
              </View>
            </View>
          )) : <Text style={styles.emptyComments}>첫 댓글을 남겨보세요.</Text>}
          {post.commentCount > post.recentComments.length ? <Text style={styles.commentNotice}>최근 댓글부터 표시하고 있어요.</Text> : null}
        </CustomScrollView>
      )}
    </View>
  );
}

const makeStyles = (styleColors: ReturnType<typeof useColors>) => StyleSheet.create({
  screen: { flex: 1, backgroundColor: styleColors.background },
  header: { minHeight: 62, paddingHorizontal: 12, paddingBottom: 8, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: styleColors.border, flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  headerButton: { width: 44, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center" },
  headerTitle: { color: styleColors.foreground, fontSize: fontSizes.heading, fontFamily: fonts.bold },
  center: { flex: 1, paddingHorizontal: 24, alignItems: "center", justifyContent: "center", gap: 12 },
  errorTitle: { color: styleColors.foreground, fontSize: fontSizes.heading, fontFamily: fonts.bold },
  muted: { color: styleColors.mutedForeground, fontSize: fontSizes.detail, textAlign: "center" },
  retryButton: { minWidth: 128, height: 44, marginTop: 5, borderRadius: 22, backgroundColor: styleColors.primary, alignItems: "center", justifyContent: "center" },
  retryText: { color: styleColors.primaryForeground, fontSize: fontSizes.label, fontFamily: fonts.bold },
  content: { width: "100%", maxWidth: 520, alignSelf: "center", paddingHorizontal: 16, paddingTop: 17 },
  authorRow: { flexDirection: "row", alignItems: "center", gap: 11 },
  authorIdentity: { flex: 1 },
  nameRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  authorName: { color: styleColors.foreground, fontSize: fontSizes.headingSmall, fontFamily: fonts.bold },
  roleBadge: { borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3, backgroundColor: styleColors.primary },
  roleText: { color: styleColors.mutedForeground, fontSize: fontSizes.tiny, fontFamily: fonts.bold },
  date: { color: styleColors.mutedForeground, fontSize: fontSizes.small, marginTop: 3 },
  title: { color: styleColors.foreground, fontSize: fontSizes.titleLarge, lineHeight: 29, fontFamily: fonts.bold, marginTop: 20 },
  body: { color: styleColors.foreground, fontSize: fontSizes.input, lineHeight: 25, fontFamily: fonts.regular, marginTop: 18 },
  hashtags: { color: styleColors.primary, fontSize: fontSizes.label, lineHeight: 21, marginTop: 11 },
  media: { width: "100%", aspectRatio: 1, marginTop: 14, borderRadius: 15, backgroundColor: styleColors.card },
  actions: { minHeight: 58, flexDirection: "row", alignItems: "center", gap: 30 },
  action: { minHeight: 44, flexDirection: "row", alignItems: "center", gap: 8 },
  actionText: { color: styleColors.mutedForeground, fontSize: fontSizes.label },
  actionActive: { color: styleColors.primary },
  pressed: { opacity: 0.62 },
  disabled: { opacity: 0.42 },
  divider: { height: StyleSheet.hairlineWidth, backgroundColor: styleColors.card },
  commentsTitle: { color: styleColors.foreground, fontSize: fontSizes.headingSmall, fontFamily: fonts.bold, marginTop: 18 },
  commentInputRow: { minHeight: 50, marginTop: 12, borderRadius: 25, borderWidth: 1, borderColor: styleColors.border, backgroundColor: styleColors.card, flexDirection: "row", alignItems: "center", paddingLeft: 16, paddingRight: 5 },
  commentInput: { flex: 1, minHeight: 48, color: styleColors.foreground, fontSize: fontSizes.label },
  sendButton: { width: 40, height: 40, borderRadius: radii.card, backgroundColor: styleColors.primary, alignItems: "center", justifyContent: "center" },
  commentError: { color: styleColors.primary, fontSize: fontSizes.caption, marginTop: 8 },
  comment: { paddingVertical: 15, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: styleColors.border, flexDirection: "row", alignItems: "flex-start", gap: 10 },
  commentCopy: { flex: 1 },
  commentAuthor: { color: styleColors.foreground, fontSize: fontSizes.detail, fontFamily: fonts.bold },
  commentBody: { color: styleColors.mutedForeground, fontSize: fontSizes.label, lineHeight: 20, marginTop: 4 },
  commentDate: { color: styleColors.mutedForeground, fontSize: fontSizes.tiny, marginTop: 5 },
  emptyComments: { color: styleColors.mutedForeground, fontSize: fontSizes.detail, textAlign: "center", paddingVertical: 28 },
  commentNotice: { color: styleColors.mutedForeground, fontSize: fontSizes.small, textAlign: "center", marginTop: 14 },
});
