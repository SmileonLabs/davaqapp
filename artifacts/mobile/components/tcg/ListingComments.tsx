import React from "react";
import { ActivityIndicator, Pressable, View } from "react-native";
import { Feather } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import {
  useInfiniteQuery,
  useQueryClient,
  type InfiniteData,
} from "@tanstack/react-query";
import { useGetMe } from "@workspace/api-client-react";
import { useAuth } from "@/lib/davaqAuth";
import { api, errorText, key } from "@/lib/tcg";
import { C, S, Txt, Button, Field, Notice } from "@/components/davaq/UI";
import { ContentReportSheet } from "@/components/ContentReportSheet";
import { useUgcConsent, UgcConsentPrompt } from "@/components/UgcConsentPrompt";
import type { ContentReportTarget } from "@/lib/contentReports";

type Comment = {
  id: string;
  owner_id: string;
  owner_name: string;
  body: string;
  created_at: string;
};
type CommentsPage = {
  items: Comment[];
  nextCursor: string | null;
  comment_count: number;
};

export function ListingComments({
  listingId,
  canComment,
}: {
  listingId: string;
  canComment: boolean;
}) {
  const { userId } = useAuth(),
    { data: me } = useGetMe(),
    router = useRouter(),
    client = useQueryClient();
  const path = `/tcg/listings/${listingId}/comments`;
  const consent = useUgcConsent(me?.id ?? null);
  const queryKey = ["davaq", userId, path];
  const query = useInfiniteQuery({
    queryKey,
    initialPageParam: "",
    staleTime: 15000,
    queryFn: ({ pageParam }) =>
      api<CommentsPage>(
        path + (pageParam ? "?cursor=" + encodeURIComponent(pageParam) : ""),
      ),
    getNextPageParam: (page) => page.nextCursor ?? undefined,
  });
  const [body, setBody] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState("");
  const [reportTarget, setReportTarget] =
    React.useState<ContentReportTarget | null>(null);
  const lock = React.useRef(false);
  const request = React.useRef<{ body: string; key: string } | null>(null);
  const items = [
    ...new Map(
      query.data?.pages
        .flatMap((page) => page.items)
        .map((item) => [item.id, item]),
    ).values(),
  ];
  const submit = async () => {
    const text = body.trim();
    if (!text || !canComment || lock.current) return;
    lock.current = true;
    setBusy(true);
    setError("");
    if (!request.current || request.current.body !== text)
      request.current = { body: text, key: key() };
    try {
      if (!(await consent.ensureConsent())) return;
      const result = await api<{ item: Comment; comment_count: number }>(
        path,
        "POST",
        { body: text, requestKey: request.current.key },
      );
      client.setQueryData<InfiniteData<CommentsPage>>(queryKey, (old) =>
        old
          ? {
              ...old,
              pages: old.pages.map((page, index) => ({
                ...page,
                comment_count: result.comment_count,
                items: [
                  ...(index === 0 ? [result.item] : []),
                  ...page.items.filter((item) => item.id !== result.item.id),
                ],
              })),
            }
          : {
              pages: [
                {
                  items: [result.item],
                  nextCursor: null,
                  comment_count: result.comment_count,
                },
              ],
              pageParams: [""],
            },
      );
      void client.invalidateQueries({
        predicate: (query) =>
          query.queryKey[0] === "davaq" &&
          query.queryKey[1] === userId &&
          query.queryKey[2] === "exchange-card-feed",
      });
      setBody("");
      request.current = null;
    } catch (failure) {
      setError(errorText(failure));
    } finally {
      lock.current = false;
      setBusy(false);
    }
  };
  return (
    <View style={[S.card, { gap: 14 }]}>
      <Txt bold size={18}>
        댓글
      </Txt>
      {query.isPending && <ActivityIndicator color={C.purple} />}
      {query.isError && (
        <>
          <Notice error>댓글을 불러오지 못했어요.</Notice>
          <Button
            secondary
            label="댓글 다시 불러오기"
            onPress={() => void query.refetch()}
          />
        </>
      )}
      {query.isSuccess && !items.length && (
        <Txt color={C.muted}>이 오퍼에 첫 댓글을 남겨 보세요.</Txt>
      )}
      {items.map((item) => (
        <View
          key={item.id}
          style={{
            gap: 6,
            borderBottomWidth: 1,
            borderColor: C.line,
            paddingBottom: 10,
          }}
        >
          <View style={S.between}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`${item.owner_name || "컬렉터"} 프로필 보기`}
              onPress={() =>
                router.push({
                  pathname: "/profile/[userId]",
                  params: { userId: item.owner_id },
                })
              }
            >
              <Txt bold size={13}>
                {item.owner_name || "컬렉터"}
              </Txt>
            </Pressable>
            <Txt color={C.muted} size={11}>
              {new Date(item.created_at).toLocaleDateString("ko-KR")}
            </Txt>
          </View>
          <Txt>{item.body}</Txt>
          {me?.id && item.owner_id !== me.id && (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="오퍼 댓글 신고"
              onPress={() =>
                setReportTarget({
                  targetType: "listing_comment",
                  targetId: item.id,
                })
              }
              style={{
                alignSelf: "flex-end",
                flexDirection: "row",
                alignItems: "center",
                gap: 5,
                minHeight: 44,
                paddingHorizontal: 8,
              }}
            >
              <Feather name="flag" size={14} color={C.muted} />
              <Txt color={C.muted} size={12}>
                신고
              </Txt>
            </Pressable>
          )}
        </View>
      ))}
      {query.hasNextPage && (
        <Button
          secondary
          label={
            query.isFetchNextPageError ? "댓글 다시 불러오기" : "이전 댓글 보기"
          }
          busy={query.isFetchingNextPage}
          onPress={() => void query.fetchNextPage()}
        />
      )}
      {canComment && (
        <>
          <Field
            label="댓글 남기기"
            value={body}
            onChangeText={setBody}
            maxLength={500}
            multiline
            placeholder="카드나 거래 조건을 질문해 보세요"
          />
          {!!error && <Notice error>{error}</Notice>}
          <Button
            label="댓글 등록"
            disabled={!body.trim()}
            busy={busy}
            onPress={() => void submit()}
          />
        </>
      )}
      <ContentReportSheet
        target={reportTarget}
        onClose={() => setReportTarget(null)}
      />
      <UgcConsentPrompt {...consent.promptProps} />
    </View>
  );
}
