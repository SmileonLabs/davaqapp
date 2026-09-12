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
      : `https://davaq.anothermeai.app/app/post/${post.id}`;
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
          <Feather name="arrow-left" size={27} color="#F7F4FA" />
        </Pressable>
        <Text style={styles.headerTitle}>게시물</Text>
        <Pressable onPress={() => void share()} disabled={!post} hitSlop={12} style={styles.headerButton} accessibilityRole="button" accessibilityLabel="게시물 공유">
          <Feather name="share-2" size={22} color={post ? "#F7F4FA" : "#5D5865"} />
        </Pressable>
      </View>

      {query.isLoading ? (
        <View style={styles.center}><ActivityIndicator size="large" color="#A84CFF" /><Text style={styles.muted}>게시물을 불러오는 중이에요.</Text></View>
      ) : query.error || !post ? (
        <View style={styles.center}>
          <Feather name="alert-circle" size={42} color="#8D8498" />
          <Text style={styles.errorTitle}>게시물을 불러오지 못했어요.</Text>
          <Text style={styles.muted}>삭제되었거나 볼 수 없는 게시물일 수 있어요.</Text>
          <Pressable onPress={() => void query.refetch()} style={styles.retryButton}><Text style={styles.retryText}>다시 시도</Text></Pressable>
        </View>
      ) : (
        <CustomScrollView
          refreshControl={<RefreshControl refreshing={query.isRefetching} onRefresh={() => void query.refetch()} tintColor="#A84CFF" />}
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
              <Feather name="heart" size={23} color={post.reactedByMe ? "#D64FFF" : "#AAA3B2"} />
              <Text style={[styles.actionText, post.reactedByMe && styles.actionActive]}>{post.reactionCount.toLocaleString()}</Text>
            </Pressable>
            <View style={styles.action}><Feather name="message-circle" size={22} color="#AAA3B2" /><Text style={styles.actionText}>{post.commentCount.toLocaleString()}</Text></View>
            <Pressable onPress={() => void share()} style={({ pressed }) => [styles.action, pressed && styles.pressed]} accessibilityRole="button" accessibilityLabel="공유">
              <Feather name="share-2" size={21} color="#AAA3B2" /><Text style={styles.actionText}>공유</Text>
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
              placeholderTextColor="#756E80"
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
              {submitComment.isPending ? <ActivityIndicator size="small" color="#FFFFFF" /> : <Feather name="send" size={18} color="#FFFFFF" />}
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

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: "#020208" },
  header: { minHeight: 62, paddingHorizontal: 12, paddingBottom: 8, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: "#282037", flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  headerButton: { width: 44, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center" },
  headerTitle: { color: "#F7F4FA", fontSize: 18, fontFamily: "Inter_700Bold" },
  center: { flex: 1, paddingHorizontal: 24, alignItems: "center", justifyContent: "center", gap: 12 },
  errorTitle: { color: "#F5F1F8", fontSize: 18, fontFamily: "Inter_700Bold" },
  muted: { color: "#938B9C", fontSize: 13, textAlign: "center" },
  retryButton: { minWidth: 128, height: 44, marginTop: 5, borderRadius: 22, backgroundColor: "#7733E9", alignItems: "center", justifyContent: "center" },
  retryText: { color: "#FFFFFF", fontSize: 14, fontFamily: "Inter_700Bold" },
  content: { width: "100%", maxWidth: 520, alignSelf: "center", paddingHorizontal: 16, paddingTop: 17 },
  authorRow: { flexDirection: "row", alignItems: "center", gap: 11 },
  authorIdentity: { flex: 1 },
  nameRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  authorName: { color: "#F7F4FA", fontSize: 17, fontFamily: "Inter_700Bold" },
  roleBadge: { borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3, backgroundColor: "#52208E" },
  roleText: { color: "#E8D6FF", fontSize: 10, fontFamily: "Inter_700Bold" },
  date: { color: "#8E8797", fontSize: 11, marginTop: 3 },
  title: { color: "#FFFFFF", fontSize: 21, lineHeight: 29, fontFamily: "Inter_700Bold", marginTop: 20 },
  body: { color: "#EEE9F2", fontSize: 16, lineHeight: 25, fontFamily: "Inter_400Regular", marginTop: 18 },
  hashtags: { color: "#BB58EA", fontSize: 14, lineHeight: 21, marginTop: 11 },
  media: { width: "100%", aspectRatio: 1, marginTop: 14, borderRadius: 15, backgroundColor: "#100D19" },
  actions: { minHeight: 58, flexDirection: "row", alignItems: "center", gap: 30 },
  action: { minHeight: 44, flexDirection: "row", alignItems: "center", gap: 8 },
  actionText: { color: "#AAA3B2", fontSize: 14 },
  actionActive: { color: "#D64FFF" },
  pressed: { opacity: 0.62 },
  disabled: { opacity: 0.42 },
  divider: { height: StyleSheet.hairlineWidth, backgroundColor: "#2B2436" },
  commentsTitle: { color: "#F0ECF3", fontSize: 17, fontFamily: "Inter_700Bold", marginTop: 18 },
  commentInputRow: { minHeight: 50, marginTop: 12, borderRadius: 25, borderWidth: 1, borderColor: "#3A3048", backgroundColor: "#0B0913", flexDirection: "row", alignItems: "center", paddingLeft: 16, paddingRight: 5 },
  commentInput: { flex: 1, minHeight: 48, color: "#F1ECF4", fontSize: 14 },
  sendButton: { width: 40, height: 40, borderRadius: 20, backgroundColor: "#7834ED", alignItems: "center", justifyContent: "center" },
  commentError: { color: "#F06B85", fontSize: 12, marginTop: 8 },
  comment: { paddingVertical: 15, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: "#241F2D", flexDirection: "row", alignItems: "flex-start", gap: 10 },
  commentCopy: { flex: 1 },
  commentAuthor: { color: "#EEEAF1", fontSize: 13, fontFamily: "Inter_700Bold" },
  commentBody: { color: "#C8C1CF", fontSize: 14, lineHeight: 20, marginTop: 4 },
  commentDate: { color: "#756E7D", fontSize: 10, marginTop: 5 },
  emptyComments: { color: "#817989", fontSize: 13, textAlign: "center", paddingVertical: 28 },
  commentNotice: { color: "#77707F", fontSize: 11, textAlign: "center", marginTop: 14 },
});
