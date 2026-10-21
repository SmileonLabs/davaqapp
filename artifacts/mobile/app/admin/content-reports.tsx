import React, { useState } from "react";
import { ActivityIndicator, Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { customFetch } from "@workspace/api-client-react";
import { useColors } from "@/hooks/useColors";
import { useKnowledgeAdminMe } from "@/hooks/useKnowledge";

type Status = "pending" | "resolved" | "dismissed";
type Report = { id: string; target_type: "user" | "card_comment" | "listing_comment" | "message"; target_id: string; reason: string; status: Status; created_at: string; reporter_name: string | null; target_owner_name: string | null; review_note: string | null };
type Page = { items: Report[]; nextCursor: string | null };
type Detail = { report: Report; target: { nickname?: string; status_message?: string; body?: string; removed?: boolean } | null; actions: { id: string; action: string; note: string; created_at: string }[] };
const labels = { user: "사용자", card_comment: "카드 댓글", listing_comment: "거래 댓글", message: "채팅 메시지" };
const statusLabels: Record<Status, string> = { pending: "대기", resolved: "처리 완료", dismissed: "기각" };
const base = "/api/tcg/admin/content-reports";
const queryKey = ["admin", "davaq-content-reports"] as const;

export default function ContentReportsScreen() {
  const colors = useColors();
  const client = useQueryClient();
  const { data: admin, isLoading: checkingAdmin } = useKnowledgeAdminMe();
  const [status, setStatus] = useState<Status>("pending");
  const [selected, setSelected] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const reports = useInfiniteQuery({
    queryKey: [...queryKey, "list", status], enabled: admin?.isAdmin === true,
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) => customFetch<Page>(`${base}?status=${status}${pageParam ? `&cursor=${encodeURIComponent(pageParam)}` : ""}`, { responseType: "json" }),
    getNextPageParam: (page) => page.nextCursor ?? undefined, gcTime: 0, retry: false,
  });
  const detail = useQuery({
    queryKey: [...queryKey, "detail", selected], enabled: admin?.isAdmin === true && selected !== null,
    queryFn: () => customFetch<Detail>(`${base}/${selected}`, { responseType: "json" }), gcTime: 0, retry: false,
  });
  const review = useMutation({
    mutationFn: (input: { status: "resolved" | "dismissed"; action: "reviewed" | "remove_content" }) => customFetch(`${base}/${selected}`, { method: "PATCH", responseType: "json", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...input, note: note.trim() }) }),
    onSuccess: async () => { setSelected(null); setNote(""); setConfirmRemove(false); setError(null); await client.invalidateQueries({ queryKey }); },
    onError: () => setError("처리 결과를 저장하지 못했습니다. 목록을 새로고침해 현재 상태를 확인해 주세요."),
  });
  const select = (id: string | null) => { setSelected(id); setNote(""); setConfirmRemove(false); setError(null); };
  const text = { color: colors.foreground };
  const muted = { color: colors.mutedForeground };
  const button = [styles.button, { backgroundColor: colors.secondary }];
  if (checkingAdmin) return <ActivityIndicator style={styles.loading} color={colors.primary} />;
  if (!admin?.isAdmin) return <View style={styles.container}><Text style={text}>신고 검토 권한이 필요합니다.</Text></View>;
  return <ScrollView style={{ flex: 1, backgroundColor: colors.background }} contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
    <Text style={[styles.title, text]}>DavaQ 신고 검토</Text>
    <Text style={muted}>운영·지원 권한으로 신고된 대상만 확인합니다. 채팅의 다른 메시지나 미디어 파일은 열지 않습니다.</Text>
    <View style={styles.actions}>{(["pending", "resolved", "dismissed"] as Status[]).map((value) => <Pressable key={value} onPress={() => { setStatus(value); select(null); }} style={[...button, value === status && { borderColor: colors.primary, borderWidth: 1 }]}><Text style={text}>{statusLabels[value]}</Text></Pressable>)}<Pressable onPress={() => void reports.refetch()} style={button}><Text style={text}>새로고침</Text></Pressable></View>
    {reports.isLoading ? <ActivityIndicator color={colors.primary} /> : reports.isError ? <Text style={text}>신고 목록을 불러오지 못했습니다. 운영·지원 권한과 서버 연결을 확인해 주세요.</Text> : reports.data?.pages[0]?.items.length === 0 ? <Text style={muted}>해당 상태의 신고가 없습니다.</Text> : null}
    {reports.data?.pages.flatMap((page) => page.items).map((report) => <Pressable key={report.id} onPress={() => select(report.id)} style={[styles.card, { borderColor: selected === report.id ? colors.primary : colors.border, backgroundColor: colors.card }]}>
      <Text style={[styles.label, text]}>{labels[report.target_type]} · {report.target_owner_name ?? "탈퇴한 사용자"}</Text>
      <Text style={text}>{report.reason}</Text>
      <Text style={muted}>신고자 {report.reporter_name ?? "탈퇴한 사용자"} · {new Date(report.created_at).toLocaleString()}</Text>
      <Text style={muted}>상세 검토 열기</Text>
    </Pressable>)}
    {reports.hasNextPage ? <Pressable disabled={reports.isFetchingNextPage} style={button} onPress={() => void reports.fetchNextPage()}><Text style={text}>{reports.isFetchingNextPage ? "불러오는 중…" : "신고 더 보기"}</Text></Pressable> : null}
    <Modal visible={selected !== null} animationType="slide" onRequestClose={() => select(null)}>
      <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }}><ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
      <View style={[styles.card, { borderColor: colors.primary, backgroundColor: colors.card }]}>
      <View style={styles.actions}><Text style={[styles.label, text]}>신고 대상 상세</Text><Pressable style={button} onPress={() => select(null)}><Text style={text}>닫기</Text></Pressable></View>
      {detail.isFetching ? <ActivityIndicator color={colors.primary} /> : detail.isError ? <Text style={text}>상세 정보를 불러오지 못했습니다.</Text> : detail.data ? <>
        <Text style={muted}>대상 ID: {detail.data.report.target_id}</Text>
        {detail.data.target ? <Text selectable style={text}>{detail.data.target.nickname ?? detail.data.target.body ?? "대상 내용 없음"}{detail.data.target.status_message ? `\n${detail.data.target.status_message}` : ""}{detail.data.target.removed ? "\n[이미 삭제된 내용]" : ""}</Text> : <Text style={muted}>대상이 이미 삭제되었거나 계정이 탈퇴했습니다.</Text>}
        {detail.data.report.target_type === "user" ? <Text style={muted}>사용자 신고는 검토 사유를 기록합니다. 이 화면은 계정 이용 정지나 삭제를 수행하지 않습니다.</Text> : null}
        {detail.data.report.status === "pending" ? <>
          <TextInput accessibilityLabel="신고 처리 사유" placeholder="검토 결과와 처리 사유 (5자 이상)" placeholderTextColor={colors.mutedForeground} value={note} onChangeText={(value) => { setNote(value); setConfirmRemove(false); }} multiline maxLength={2000} style={[styles.input, text, { borderColor: colors.border }]} />
          {error ? <Text accessibilityRole="alert" style={text}>{error}</Text> : null}
          <View style={styles.actions}>
            <Pressable style={button} disabled={note.trim().length < 5 || review.isPending} onPress={() => review.mutate({ status: "resolved", action: "reviewed" })}><Text style={text}>검토 완료</Text></Pressable>
            <Pressable style={button} disabled={note.trim().length < 5 || review.isPending} onPress={() => review.mutate({ status: "dismissed", action: "reviewed" })}><Text style={text}>기각</Text></Pressable>
            {detail.data.report.target_type !== "user" ? <Pressable style={button} disabled={note.trim().length < 5 || review.isPending || detail.data.target === null} onPress={() => setConfirmRemove(true)}><Text style={text}>내용 삭제…</Text></Pressable> : null}
          </View>
          {confirmRemove ? <View style={styles.confirm}><Text style={text}>신고된 댓글 또는 메시지가 모든 사용자에게 삭제 처리됩니다. 원본 내용으로 되돌리는 기능은 없습니다.</Text><View style={styles.actions}><Pressable disabled={review.isPending} onPress={() => review.mutate({ status: "resolved", action: "remove_content" })} style={[styles.button, { backgroundColor: colors.primary }]}><Text style={{ color: colors.primaryForeground }}>삭제 확정</Text></Pressable><Pressable onPress={() => setConfirmRemove(false)} style={button}><Text style={text}>취소</Text></Pressable></View></View> : null}
          {review.isPending ? <ActivityIndicator color={colors.primary} /> : null}
        </> : <Text style={text}>처리 사유: {detail.data.report.review_note}</Text>}
        {detail.data.actions.map((action) => <Text key={action.id} style={muted}>{new Date(action.created_at).toLocaleString()} · {action.action} · {action.note}</Text>)}
      </> : null}
      </View></ScrollView></SafeAreaView>
    </Modal>
  </ScrollView>;
}
const styles = StyleSheet.create({ container: { padding: 18, gap: 14 }, loading: { padding: 32 }, title: { fontSize: 23, fontWeight: "800" }, label: { fontSize: 16, fontWeight: "700" }, card: { padding: 15, borderRadius: 16, borderWidth: 1, gap: 10 }, actions: { flexDirection: "row", flexWrap: "wrap", gap: 8, alignItems: "center" }, button: { paddingHorizontal: 12, paddingVertical: 10, borderRadius: 9 }, input: { minHeight: 90, maxHeight: 200, padding: 12, borderWidth: 1, borderRadius: 10, textAlignVertical: "top" }, confirm: { gap: 12 } });
