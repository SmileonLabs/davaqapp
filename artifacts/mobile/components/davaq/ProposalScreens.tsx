import React, { useEffect, useRef, useState } from "react";
import { View, Pressable } from "react-native";
import { useRouter, useLocalSearchParams } from "expo-router";
import { useGetMe } from "@workspace/api-client-react";
import {
  useDavaq,
  useDavaqMutation,
  key,
  errorText,
  statusName,
  dateLabel,
  type Page,
  type Listing,
  type Proposal,
  type Terms,
} from "@/lib/davaq";
import {
  C,
  S,
  Txt,
  Frame,
  Button,
  Chip,
  Field,
  Section,
  Empty,
  QueryState,
  Notice,
  ProposalCard,
} from "./UI";
type TermForm = {
  offerDate: string;
  requestedDate: string;
  location: string;
  note: string;
  cancellation: string;
};
const blankTerms: TermForm = {
  offerDate: "",
  requestedDate: "",
  location: "",
  note: "",
  cancellation:
    "일정 변경과 취소는 상대방과 협의하고, 이미 제공한 내용은 운영 검토를 요청합니다.",
};
function localDate(value: string) {
  const d = new Date(value);
  if (Number.isNaN(d.valueOf())) return "";
  return new Date(d.valueOf() + 9 * 3600000)
    .toISOString()
    .slice(0, 16)
    .replace("T", " ");
}
function formTerms(t: Terms): TermForm {
  return {
    offerDate: localDate(t.offerStartsAt),
    requestedDate: localDate(t.requestedStartsAt),
    location: t.location,
    note: t.note,
    cancellation: t.cancellation,
  };
}
function parsedTerms(f: TermForm): Terms {
  const parse = (value: string) => {
    if (!/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(value))
      throw new Error("날짜와 시간을 예시처럼 입력해 주세요.");
    const d = new Date(value.replace(" ", "T") + ":00+09:00");
    if (
      Number.isNaN(d.valueOf()) ||
      localDate(d.toISOString()) !== value ||
      d.valueOf() <= Date.now()
    )
      throw new Error("미래의 올바른 날짜와 시간을 입력해 주세요.");
    return d.toISOString();
  };
  if (f.location.trim().length < 2)
    throw new Error("만날 장소나 온라인 진행 방식을 입력해 주세요.");
  if (f.cancellation.trim().length < 5)
    throw new Error("취소·변경 조건을 적어주세요.");
  return {
    offerStartsAt: parse(f.offerDate),
    requestedStartsAt: parse(f.requestedDate),
    location: f.location.trim(),
    note: f.note.trim(),
    cancellation: f.cancellation.trim(),
  };
}
function TermsEditor({
  value: f,
  onChange,
  offer,
  requested,
}: {
  value: TermForm;
  onChange: (v: TermForm) => void;
  offer: string;
  requested: string;
}) {
  return (
    <>
      <Field
        label={offer + " · 시작 일정"}
        placeholder="예: 2026-09-20 14:00"
        hint="한국 시간 · 연-월-일 시:분"
        value={f.offerDate}
        onChangeText={(v) => onChange({ ...f, offerDate: v })}
      />
      <Field
        label={requested + " · 시작 일정"}
        placeholder="예: 2026-09-21 15:00"
        hint="한국 시간 · 각 제공 일정은 따로 정할 수 있어요"
        value={f.requestedDate}
        onChangeText={(v) => onChange({ ...f, requestedDate: v })}
      />
      <Field
        label="장소 또는 온라인 진행 방식"
        placeholder="예: 온라인 화상 / 서울 ○○ 스튜디오"
        value={f.location}
        onChangeText={(v) => onChange({ ...f, location: v })}
      />
      <Field
        label="서로 확인할 제공 범위"
        multiline
        placeholder="인원, 횟수, 포함·제외 항목을 적어 주세요."
        value={f.note}
        onChangeText={(v) => onChange({ ...f, note: v })}
      />
      <Field
        label="일정 변경·취소 조건"
        multiline
        value={f.cancellation}
        onChangeText={(v) => onChange({ ...f, cancellation: v })}
      />
    </>
  );
}
export function ProposalEditor() {
  const params = useLocalSearchParams<{ target: string; offer?: string }>(),
    router = useRouter(),
    target = useDavaq<Listing>("/exchange/listings/" + params.target),
    own = useDavaq<Page<Listing>>("/exchange/listings?mine=true"),
    [offerId, setOfferId] = useState(params.offer ?? ""),
    [terms, setTerms] = useState<TermForm>(blankTerms),
    [error, setError] = useState(""),
    mutation = useDavaqMutation<Proposal>(),
    requestKey = useRef(key());
  const offers =
      own.data?.items.filter(
        (l) => l.mode === "offer" && l.status === "published",
      ) ?? [],
    selected = offers.find((l) => l.id === offerId);
  async function send() {
    setError("");
    try {
      if (!selected) throw new Error("교환할 내 제공 항목을 선택해 주세요.");
      const p = await mutation.mutateAsync({
        path: "/exchange/proposals",
        body: {
          offerId,
          requestedId: params.target,
          terms: parsedTerms(terms),
          requestKey: requestKey.current,
        },
      });
      router.replace(("/chat/" + p.room_id) as never);
    } catch (e) {
      setError(errorText(e));
    }
  }
  return (
    <Frame back title="교환 제안 작성">
      <QueryState query={target} />
      <QueryState query={own} />
      {target.data && (
        <>
          <View style={S.card}>
            <Txt color={C.muted} size={12}>
              받고 싶은 경험
            </Txt>
            <Txt bold size={21}>
              {target.data.title}
            </Txt>
            <Txt size={13}>
              {target.data.ownerName} · {target.data.durationMinutes}분
            </Txt>
          </View>
          <Section title="대신 내가 줄 수 있는 것" />
          {offers.map((l) => (
            <Pressable
              key={l.id}
              accessibilityRole="radio"
              accessibilityState={{ checked: offerId === l.id }}
              onPress={() => setOfferId(l.id)}
              style={[
                S.card,
                {
                  borderColor: offerId === l.id ? C.purple : C.line,
                  backgroundColor: offerId === l.id ? C.soft : C.white,
                },
              ]}
            >
              <Txt bold>
                {offerId === l.id ? "● " : "○ "}
                {l.title}
              </Txt>
              <Txt size={13} color={C.muted}>
                {l.durationMinutes}분 · {l.description.slice(0, 100)}
              </Txt>
            </Pressable>
          ))}
          {own.isSuccess && !offers.length && (
            <Empty
              title="제공할 항목을 먼저 등록해요"
              body="공개한 내 물건·재능·경험으로 교환을 제안할 수 있어요."
              action="내 교환 등록"
              onPress={() => router.push("/exchange/new")}
            />
          )}
          <TermsEditor
            value={terms}
            onChange={setTerms}
            offer={selected?.title ?? "내 제공"}
            requested={target.data.title}
          />
          <Notice>
            제안을 보내면 상대방과 채팅방이 열려요. 양쪽 모두 같은 버전의 조건에
            동의해야 예약이 확정돼요.
          </Notice>
          {error && <Notice error>{error}</Notice>}
          <Button
            label="이 조건으로 제안 보내기"
            busy={mutation.isPending}
            disabled={!selected}
            onPress={() => void send()}
          />
        </>
      )}
    </Frame>
  );
}
const eventLabel: Record<string, string> = {
  created: "교환 제안",
  revise: "조건 수정",
  accept: "조건 동의",
  decline: "제안 거절",
  cancel: "취소 요청",
  approve_cancel: "취소 동의",
  dispute: "분쟁 접수",
  provided: "제공 완료",
  received: "수령 확인",
  admin_resume: "운영 검토 종료",
  admin_cancel: "운영 취소",
  expired: "제안 만료",
};
export function ProposalDetail() {
  const { id } = useLocalSearchParams<{ id: string }>(),
    router = useRouter(),
    query = useDavaq<Proposal>("/exchange/proposals/" + id),
    me = useGetMe(),
    mutation = useDavaqMutation<Proposal>(),
    [error, setError] = useState(""),
    [editing, setEditing] = useState(false),
    [terms, setTerms] = useState(blankTerms),
    [checked, setChecked] = useState(false),
    [note, setNote] = useState(""),
    [review, setReview] = useState(""),
    [feedback, setFeedback] = useState(""),
    [notice, setNotice] = useState("");
  const p = query.data,
    myId = me.data?.id,
    own = p?.fulfillments.find((f) => f.provider_id === myId),
    other = p?.fulfillments.find((f) => f.provider_id !== myId),
    request = useRef<{ signature: string; key: string } | null>(null);
  useEffect(() => {
    setChecked(false);
    setEditing(false);
    if (p) setTerms(formTerms(p.terms));
  }, [p?.version]);
  async function act(action: string) {
    if (!p) return;
    setError("");
    setNotice("");
    try {
      const body = {
          action,
          version: p.version,
          note,
          ...(action === "revise" ? { terms: parsedTerms(terms) } : {}),
        },
        signature = JSON.stringify(body);
      if (request.current?.signature !== signature)
        request.current = { signature, key: key() };
      await mutation.mutateAsync({
        path: "/exchange/proposals/" + id + "/actions",
        body: { ...body, requestKey: request.current!.key },
      });
      request.current = null;
      setEditing(false);
      setNote("");
    } catch (e) {
      setError(errorText(e));
      void query.refetch();
    }
  }
  async function sendReview() {
    setError("");
    try {
      await mutation.mutateAsync({
        path: "/exchange/proposals/" + id + "/reviews",
        body: { text: review, feedback },
      });
      setNotice(
        "후기를 저장했어요. 큐에게 알려준 취향은 학습을 켠 경우 확인할 기억 후보가 돼요.",
      );
    } catch (e) {
      setError(errorText(e));
    }
  }
  return (
    <Frame back title="교환 조건" onRefresh={() => void query.refetch()}>
      <QueryState query={query} />
      {p && (
        <>
          <View style={S.between}>
            <Txt color={C.purple} bold>
              {statusName(p.status)}
            </Txt>
            <Txt color={C.muted} size={13}>
              조건 v{p.version}
            </Txt>
          </View>
          <View style={S.card}>
            {(["offer", "requested"] as const).map((side, i) => (
              <View key={side} style={{ gap: 6 }}>
                {i === 1 && (
                  <Txt size={24} color={C.purple}>
                    ⇅
                  </Txt>
                )}
                <Txt size={12} color={C.muted}>
                  {side === "offer" ? p.proposer_name : p.recipient_name}님의
                  제공
                </Txt>
                <Txt bold size={20}>
                  {p.snapshots[side].title}
                </Txt>
                <Txt size={13}>{p.snapshots[side].description}</Txt>
                <Txt size={13} color={C.muted}>
                  {p.snapshots[side].durationMinutes}분 ·{" "}
                  {dateLabel(
                    side === "offer"
                      ? p.terms.offerStartsAt
                      : p.terms.requestedStartsAt,
                  )}
                </Txt>
                {p.snapshots[side].terms && (
                  <Txt size={12} color={C.muted}>
                    {p.snapshots[side].terms}
                  </Txt>
                )}
              </View>
            ))}
          </View>
          <View style={S.card}>
            <Txt bold>장소 · 진행 방식</Txt>
            <Txt>{p.terms.location}</Txt>
            <Txt bold>추가 제공 조건</Txt>
            <Txt>{p.terms.note || "추가 조건 없음"}</Txt>
            <Txt bold>일정 변경 · 취소</Txt>
            <Txt size={13}>{p.terms.cancellation}</Txt>
          </View>
          <Button
            secondary
            label="채팅으로 이야기하기"
            onPress={() => router.push(("/chat/" + p.room_id) as never)}
          />
          {p.status === "negotiating" && (
            <>
              <Notice>
                {p.acceptances.length}/2명 동의 · {dateLabel(p.expires_at)}까지
                유효해요. 조건이 바뀌면 동의를 다시 받아요.
              </Notice>
              <View style={S.row}>
                {[p.proposer_id, p.recipient_id].map((uid, i) => (
                  <Chip
                    key={uid}
                    label={
                      (i === 0 ? p.proposer_name : p.recipient_name) +
                      (p.acceptances.includes(uid)
                        ? " · 동의 완료"
                        : " · 확인 대기")
                    }
                    active={p.acceptances.includes(uid)}
                  />
                ))}
              </View>
              {!editing ? (
                <>
                  <Pressable
                    accessibilityRole="checkbox"
                    accessibilityState={{ checked }}
                    onPress={() => setChecked(!checked)}
                    style={[S.card, S.row]}
                  >
                    <Txt color={C.purple} size={23}>
                      {checked ? "☑" : "☐"}
                    </Txt>
                    <View style={{ flex: 1 }}>
                      <Txt size={14}>
                        제공 범위·일정·취소 조건 v{p.version}을 확인했어요.
                      </Txt>
                    </View>
                  </Pressable>
                  <Button
                    label={
                      p.acceptances.includes(myId ?? "")
                        ? "상대방 동의 대기 중"
                        : "현재 조건에 동의"
                    }
                    disabled={!checked || p.acceptances.includes(myId ?? "")}
                    busy={mutation.isPending}
                    onPress={() => void act("accept")}
                  />
                  <View style={S.row}>
                    <Button
                      secondary
                      style={{ flex: 1 }}
                      label="조건 수정"
                      onPress={() => setEditing(true)}
                    />
                    <Button
                      secondary
                      style={{ flex: 1 }}
                      label="제안 거절"
                      busy={mutation.isPending}
                      onPress={() => void act("decline")}
                    />
                  </View>
                </>
              ) : (
                <>
                  <TermsEditor
                    value={terms}
                    onChange={setTerms}
                    offer={p.snapshots.offer.title}
                    requested={p.snapshots.requested.title}
                  />
                  <Button
                    label="새 조건으로 보내기"
                    busy={mutation.isPending}
                    onPress={() => void act("revise")}
                  />
                  <Button
                    secondary
                    label="수정 닫기"
                    onPress={() => setEditing(false)}
                  />
                </>
              )}
            </>
          )}
          {["reserved", "in_progress"].includes(p.status) && (
            <>
              <Section title="교환 이행 확인" />
              <View style={S.card}>
                <Txt bold>내 제공</Txt>
                <Txt size={13}>
                  {own?.provided_at
                    ? "제공 완료 · " + dateLabel(own.provided_at)
                    : "예약 시간 이후 제공 완료를 표시해 주세요."}
                </Txt>
                <Txt size={13} color={C.muted}>
                  {own?.received_at
                    ? "상대가 수령을 확인했어요."
                    : "상대의 수령 확인을 기다려요."}
                </Txt>
                <Button
                  label="내 제공 완료"
                  disabled={!!own?.provided_at}
                  busy={mutation.isPending}
                  onPress={() => void act("provided")}
                />
              </View>
              <View style={S.card}>
                <Txt bold>상대의 제공</Txt>
                <Txt size={13}>
                  {other?.provided_at
                    ? "상대가 제공을 완료했어요."
                    : "상대의 제공을 기다리고 있어요."}
                </Txt>
                {other?.evidence && (
                  <Txt size={13} color={C.muted}>
                    {other.evidence}
                  </Txt>
                )}
                <Button
                  label={
                    other?.received_at
                      ? "수령 확인 완료"
                      : "직접 받고 확인했어요"
                  }
                  disabled={!other?.provided_at || !!other.received_at}
                  busy={mutation.isPending}
                  onPress={() => void act("received")}
                />
              </View>
            </>
          )}
          {[
            "negotiating",
            "reserved",
            "in_progress",
            "cancel_requested",
          ].includes(p.status) && (
            <>
              <Field
                label="전달할 내용 · 제공 기록 / 취소·문의 사유"
                multiline
                value={note}
                onChangeText={setNote}
                placeholder="제공한 내용이나 변경이 필요한 이유를 남겨주세요."
              />
              <View style={S.wrap}>
                {p.status !== "cancel_requested" && (
                  <Button
                    secondary
                    small
                    label={
                      p.status === "negotiating" ? "제안 취소" : "취소 요청"
                    }
                    busy={mutation.isPending}
                    disabled={note.trim().length < 2}
                    onPress={() => void act("cancel")}
                  />
                )}{" "}
                {p.status === "cancel_requested" &&
                  p.events.find((e) => e.kind === "cancel")?.actor_id !==
                    myId && (
                    <Button
                      secondary
                      label="취소 요청에 동의"
                      busy={mutation.isPending}
                      onPress={() => void act("approve_cancel")}
                    />
                  )}{" "}
                {p.status !== "negotiating" && (
                  <Button
                    secondary
                    small
                    label="운영 검토 요청"
                    disabled={note.trim().length < 5}
                    busy={mutation.isPending}
                    onPress={() => void act("dispute")}
                  />
                )}
              </View>
            </>
          )}
          {p.status === "cancel_requested" && (
            <Notice>
              취소가 확정될 때까지 예약은 유지돼요. 제공한 내용이 있다면 운영
              검토를 요청해 주세요.
            </Notice>
          )}
          {p.status === "disputed" && (
            <Notice>
              운영자가 접수 내용을 확인하고 있어요. 검토 중에는 예약을 유지하며
              이행 상태 변경을 잠시 멈춰요.
            </Notice>
          )}
          {p.status === "completed" && (
            <>
              <Notice>
                서로의 제공을 확인했어요. 함께 만든 경험이 큐의 성장 기록에
                남아요.
              </Notice>
              <Field
                label="교환 후기"
                multiline
                value={review}
                onChangeText={setReview}
                placeholder="어떤 경험이었나요?"
              />
              <Field
                label="다음 추천에 반영할 내 취향 · 선택"
                multiline
                value={feedback}
                onChangeText={setFeedback}
                placeholder="예: 실습이 있는 경험이 좋아요."
              />
              <Button
                label="후기 저장"
                busy={mutation.isPending}
                disabled={review.trim().length < 2}
                onPress={() => void sendReview()}
              />
              {p.reviews.map((r) => (
                <View key={r.author_id} style={S.card}>
                  <Txt size={12} color={C.purple}>
                    {r.author_id === myId ? "내 후기" : "상대의 후기"}
                  </Txt>
                  <Txt>{r.text}</Txt>
                </View>
              ))}
              <Button
                secondary
                label="새로운 교환 찾아보기"
                onPress={() => router.push("/(tabs)/search")}
              />
            </>
          )}
          {error && <Notice error>{error}</Notice>}
          {notice && <Notice>{notice}</Notice>}
          <Section title="진행 기록" />
          {p.events.map((e) => (
            <View
              key={e.id}
              style={{
                gap: 4,
                paddingVertical: 8,
                borderBottomWidth: 1,
                borderBottomColor: C.line,
              }}
            >
              <View style={S.between}>
                <Txt bold size={13}>
                  {eventLabel[e.kind] ?? "상태 변경"}
                </Txt>
                <Txt size={11} color={C.muted}>
                  {dateLabel(e.created_at)}
                </Txt>
              </View>
              {e.data.note && (
                <Txt size={13} color={C.muted}>
                  {e.data.note}
                </Txt>
              )}
            </View>
          ))}
        </>
      )}
    </Frame>
  );
}
export function ExchangeChatCard({
  proposalId,
  version,
}: {
  proposalId: string;
  version: number;
}) {
  const router = useRouter();
  return (
    <Pressable
      accessibilityRole="button"
      onPress={() =>
        router.push(("/exchange/proposals/" + proposalId) as never)
      }
      style={[
        S.card,
        { marginHorizontal: 18, marginBottom: 10, backgroundColor: C.soft },
      ]}
    >
      <Txt bold color={C.purple}>
        ⇄ 교환 조건 · v{version}
      </Txt>
      <Txt size={13}>제공 범위와 일정을 확인하고 동의해 주세요.</Txt>
      <Txt size={12} color={C.purple}>
        최신 교환 조건 열기 ›
      </Txt>
    </Pressable>
  );
}
