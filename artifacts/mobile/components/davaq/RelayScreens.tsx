import React, { useRef, useState } from "react";
import { View, Pressable, StyleSheet, useWindowDimensions } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useGetMe } from "@workspace/api-client-react";
import {
  useDavaq,
  useDavaqMutation,
  key,
  errorText,
  dateLabel,
  type Listing,
  type Page,
} from "@/lib/davaq";
import {
  type Relay,
  type RelayCandidate,
  type RelaySearch,
  type RelayTerms,
  relayStatus,
  rotateForViewer,
} from "@/lib/relay";
import {
  C,
  S,
  Txt,
  Frame,
  Button,
  Chip,
  Field,
  Notice,
  QueryState,
  Section,
  Cue,
} from "./UI";

import {GeoPicker,PlaceMap} from "./MapScreens";

export function RelayEntry({ compact = false }: { compact?: boolean }) {
  const narrow = useWindowDimensions().width < 360;
  const router = useRouter();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="이어 바꾸기 알아보기"
      onPress={() => router.push("/relay" as any)}
      style={[s.hero, compact && { padding: 14 }]}
    >
      <View style={{ flex: 1, gap: 8 }}>
        <Txt color={C.purple} size={12} bold>
          Q의 이어 바꾸기 · 3~4명이 함께
        </Txt>
        <Txt bold size={compact ? 16 : 23}>
          한 번 더 이어서,{compact ? " " : "\n"}내가 원하던 것으로
        </Txt>
        <Txt size={13} color={C.muted}>
          내가 줄 것 하나가 여러 사람을 거쳐{compact ? " " : "\n"}원하는
          교환으로 이어져요.
        </Txt>
        <Txt color={C.purple} bold size={13}>
          어떻게 연결될까요? →
        </Txt>
      </View>
      {!compact && !narrow && <Cue size={100} />}
    </Pressable>
  );
}
function Outcome({ listings, user }: { listings: Listing[]; user?: string }) {
  const path = rotateForViewer(listings, user);
  if (!path.length) return null;
  return (
    <View style={s.outcome}>
      <View style={{ flex: 1, gap: 5 }}>
        <Txt size={11} color={C.muted}>
          내가 주는 것
        </Txt>
        <Txt bold>{path[0].title}</Txt>
      </View>
      <View style={s.pill}>
        <Txt bold color={C.purple} size={12}>
          {path.length}명{"\n"}이어져요 →
        </Txt>
      </View>
      <View style={{ flex: 1, gap: 5 }}>
        <Txt size={11} color={C.purple}>
          내가 받는 것
        </Txt>
        <Txt color={C.purple} bold>
          {path.at(-1)!.title}
        </Txt>
      </View>
    </View>
  );
}
function Path({
  listings,
  user,
  people,
}: {
  listings: Listing[];
  user?: string;
  people?: Relay["members"];
}) {
  const path = rotateForViewer(listings, user);
  return (
    <View style={{ gap: 2 }}>
      {path.map((l, i) => {
        const receiver = path[(i + 1) % path.length],
          m = people?.find((p) => p.listing_id === l.id);
        return (
          <View key={l.id} style={s.pathRow}>
            <View
              style={[
                s.node,
                { backgroundColor: m?.received_at ? "#E3F7ED" : C.soft },
              ]}
            >
              <Txt bold color={m?.received_at ? C.green : C.purple}>
                {m?.received_at ? "✓" : i + 1}
              </Txt>
            </View>
            <View style={{ flex: 1, gap: 4 }}>
              <Txt bold size={13}>
                {l.ownerId === user ? "나" : l.ownerName || "참여자"}{" "}
                <Txt size={13} color={C.muted}>
                  →
                </Txt>{" "}
                {receiver.ownerId === user
                  ? "나"
                  : receiver.ownerName || "참여자"}
              </Txt>
              <Txt size={13}>{l.title}</Txt>
              <Txt size={11} color={m?.received_at ? C.green : C.muted}>
                {m?.received_at
                  ? "받은 분 확인 완료"
                  : m?.provided_at
                    ? "전달 완료 · 받는 분 확인 중"
                    : "약속한 제공을 이 분에게 전달해요"}
              </Txt>
            </View>
          </View>
        );
      })}
      <View style={[s.pill, { alignSelf: "center", marginTop: 8 }]}>
        <Txt color={C.purple} size={12} bold>
          끝의 교환이 다시 나에게 돌아와요 ↺
        </Txt>
      </View>
    </View>
  );
}
function Demo() {
  const [step, setStep] = useState(0);
  const things = ["📷 카메라", "⛳ 골프채", "🎮 게임기", "🏨 숙박권"];
  return (
    <View style={S.card}>
      <View style={S.between}>
        <Txt bold>30초 만에 이해하기</Txt>
        <Chip label="설명용 예시" />
      </View>
      <Txt size={13} color={C.muted}>
        나는 카메라를 주고 숙박권을 받고 싶어요.
      </Txt>
      <View style={s.demoGrid}>
        {things.map((x, i) => (
          <View
            key={x}
            style={[
              s.demoTile,
              {
                backgroundColor: i <= step ? C.soft : C.bg,
                borderColor: i === step ? C.purple : C.line,
              },
            ]}
          >
            <Txt size={12} color={C.muted}>
              {
                [
                  "나",
                  "카메라가 필요한 B",
                  "골프채가 필요한 C",
                  "게임기가 필요한 D",
                ][i]
              }
            </Txt>
            <Txt size={17} bold>
              {x}
            </Txt>
            <Txt size={11} color={i < step ? C.green : C.muted}>
              {step === 3
                ? "원하는 교환 연결 ✓"
                : i < step
                  ? "다음 사람에게 연결 ✓"
                  : i === step
                    ? "여기까지 연결했어요"
                    : "다음 연결을 기다려요"}
            </Txt>
          </View>
        ))}
      </View>
      <View style={[s.outcome, { minHeight: 65 }]}>
        <Txt bold color={C.purple}>
          {
            [
              "B는 내 카메라를 원해요. B의 골프채는 누가 원할까요?",
              "C가 골프채를 원해요! C의 게임기를 이어볼까요?",
              "D가 게임기를 원해요. D에게는 내가 원한 숙박권이 있어요!",
              "연결 완성! 나는 카메라를 주고 숙박권을 받아요. 모두 원하는 것을 하나씩 받아요.",
            ][step]
          }
        </Txt>
      </View>
      <Button
        label={step === 3 ? "다시 이어보기" : "다음 사람과 이어보기 →"}
        onPress={() => setStep((step + 1) % 4)}
        secondary={step === 3}
      />
      <Txt size={11} color={C.muted}>
        원리를 보여주는 예시예요. 실제 교환은 연결 후보와 전원의 동의가
        필요해요.
      </Txt>
    </View>
  );
}
export function RelayCandidateCard({
  candidate: c,
}: {
  candidate: RelayCandidate;
}) {
  const me = useGetMe(),
    router = useRouter();
  return (
    <View style={S.card}>
      <View style={S.between}>
        <Chip label={c.listings.length + "명이 이어지는 후보"} />
        <Txt size={11} color={C.muted}>
          조건 확인 전
        </Txt>
      </View>
      <Outcome listings={c.listings} user={me.data?.id} />
      <Txt size={12} color={C.muted}>
        {c.pending[0]}
      </Txt>
      <Button
        label="내 교환 경로 보기"
        onPress={() =>
          router.push(
            ("/relay/new?ids=" + c.listings.map((l) => l.id).join(",")) as any,
          )
        }
      />
    </View>
  );
}
export function RelayHubScreen() {
  const narrow = useWindowDimensions().width < 360;
  const candidates = useDavaq<RelaySearch>("/exchange/relays/candidates"),
    relays = useDavaq<Page<Relay>>("/exchange/relays"),
    router = useRouter(),
    me = useGetMe();
  const [tab, setTab] = useState("find");
  const refresh = () => {
    void candidates.refetch();
    void relays.refetch();
  };
  return (
    <Frame
      back
      title="이어 바꾸기"
      subtitle="내가 줄 것 하나로, 원하는 것까지 연결해요"
      onRefresh={refresh}
      refreshing={candidates.isRefetching || relays.isRefetching}
    >
      <View style={s.hero}>
        <View style={{ flex: 1, gap: 8 }}>
          <Txt size={narrow ? 21 : 25} bold>
            원하는 것까지,{"\n"}Q와 이어봐요.
          </Txt>
          <Txt color={C.muted} size={13}>
            중간 물건을 직접 받아 되팔 필요 없이{"\n"}각자 필요한 사람에게
            전달해요.
          </Txt>
        </View>
        <Cue size={narrow ? 54 : 94} />
      </View>
      <View style={S.wrap}>
        {[
          ["find", "연결 찾기"],
          ["mine", "내 연결 " + (relays.data?.items.length ?? 0)],
          ["how", "어떻게 바꾸나요?"],
        ].map(([id, label]) => (
          <Chip
            key={id}
            label={label}
            active={tab === id}
            onPress={() => setTab(id)}
          />
        ))}
      </View>
      {tab === "how" ? (
        <Demo />
      ) : tab === "mine" ? (
        <>
          <QueryState query={relays} />
          {relays.data?.items.map((r) => (
            <Pressable
              accessibilityRole="button"
              key={r.id}
              onPress={() => router.push(("/relay/" + r.id) as any)}
              style={S.card}
            >
              <Txt bold color={C.purple}>
                {relayStatus(r.status)}
              </Txt>
              <Outcome
                listings={r.members.map((m) => m.snapshot)}
                user={me.data?.id}
              />
              <Txt size={12} color={C.muted}>
                {
                  r.members.filter((m) => m.accepted_version === r.version)
                    .length
                }
                /{r.members.length}명 동의 · 자세히 보기 →
              </Txt>
            </Pressable>
          ))}
          {relays.isSuccess && !relays.data?.items.length && (
            <Notice>
              아직 참여 중인 연결이 없어요. ‘연결 찾기’에서 내가 주고받을 후보를
              살펴보세요.
            </Notice>
          )}
        </>
      ) : (
        <>
          <View style={s.steps}>
            {[
              "1 · 내 것 등록",
              "2 · Q가 연결",
              "3 · 모두 동의",
              "4 · 원하는 것 받기",
            ].map((l, i) => (
              <View
                key={l}
                style={[s.miniStep, i === 0 && { backgroundColor: C.soft }]}
              >
                <Txt size={11} color={i === 0 ? C.purple : C.muted} bold>
                  {l}
                </Txt>
              </View>
            ))}
          </View>
          <QueryState query={candidates} />
          {candidates.isSuccess && candidates.data?.offersCount === 0 ? (
            <View style={S.card}>
              <Txt bold size={21}>
                시작은 내가 줄 수 있는 것 하나
              </Txt>
              <Txt color={C.muted}>
                물건·재능·경험과 받고 싶은 것을 함께 적어주세요. Q가 3~4명이
                이어지는 후보를 찾아요.
              </Txt>
              <Button
                label="내 것과 받고 싶은 것 등록"
                onPress={() => router.push("/exchange/new?mode=offer" as any)}
              />
              <Button
                secondary
                label="예시로 먼저 해보기"
                onPress={() => setTab("how")}
              />
            </View>
          ) : (
            <>
              <View style={S.between}>
                <Section
                  title={
                    candidates.data?.items.length
                      ? "Q가 찾은 연결 후보"
                      : "새로운 연결을 찾아요"
                  }
                />
                <Button
                  small
                  secondary
                  busy={candidates.isFetching}
                  label="다시 찾기"
                  onPress={() => void candidates.refetch()}
                />
              </View>
              {candidates.data?.items.map((c) => (
                <RelayCandidateCard key={c.id} candidate={c} />
              ))}
              {candidates.isSuccess && !candidates.data?.items.length && (
                <View style={S.card}>
                  <Txt size={19} bold>
                    아직 마지막 연결을 찾는 중이에요
                  </Txt>
                  <Txt color={C.muted}>
                    지금 살펴본 등록에서 완성되는 연결은 없어요. 받고 싶은
                    품목과 가능한 지역·요일을 구체적으로 적으면 다음 탐색에
                    도움이 돼요.
                  </Txt>
                  <Txt size={12} color={C.purple}>
                    내 제공 등록 {candidates.data?.offersCount}개 · 최근 등록{" "}
                    {candidates.data?.scannedCount}개에서 탐색
                  </Txt>
                  <Button
                    label="내 등록 살펴보기"
                    secondary
                    onPress={() => router.push("/(tabs)/exchanges")}
                  />
                  <Button
                    label="Q에게 이어 바꾸기 물어보기"
                    onPress={() => router.push("/agent/chat")}
                  />
                </View>
              )}
              {candidates.data?.limited && (
                <Txt size={11} color={C.muted}>
                  최근 공개 항목 중심으로 탐색했어요. 새로운 등록과 함께 다른
                  연결이 생길 수 있어요.
                </Txt>
              )}
            </>
          )}
          <Notice>
            후보의 제공 범위와 일정을 확인하고, 모두 같은 조건에 동의하면 교환이
            확정돼요.
          </Notice>
        </>
      )}
    </Frame>
  );
}
const localDate = (iso: string) => {
  const d = new Date(iso);
  return Number.isNaN(d.valueOf())
    ? ""
    : new Date(d.getTime() + 9 * 3600000)
        .toISOString()
        .slice(0, 16)
        .replace("T", " ");
};
function initialTerms(listings: Listing[]): RelayTerms {
  let next = Date.now() + 3 * 86400000;
  return {
    legs: listings.map((l) => {
      const start = new Date(next).toISOString();
      next += (l.durationMinutes + 30) * 60000;
      return {
        listingId: l.id,
        startsAt: start,
        location:
          l.delivery === "online"
            ? "온라인 · 채팅에서 접속 방법 확인"
            : l.location || "장소를 함께 정해 주세요",
      };
    }),
    note: "",
    cancellation:
      "제공 시작 전에는 모두의 동의로 취소합니다. 제공 후 문제가 생기면 도움 요청으로 해결합니다.",
  };
}
function TermsEditor({
  listings,
  initial,
  busy,
  onSave,
  label,
  onCancel,
}: {
  listings: Listing[];
  initial: RelayTerms;
  busy: boolean;
  onSave: (t: RelayTerms) => void;
  label: string;
  onCancel?: () => void;
}) {
  const [terms, setTerms] = useState(initial),
    [dates, setDates] = useState(
      initial.legs.map((l) => localDate(l.startsAt)),
    ),
    [error, setError] = useState("");
  const save = () => {
    setError("");
    const parsed = dates.map(
      (d) => new Date(d.trim().replace(" ", "T") + ":00+09:00"),
    );
    if (
      parsed.some(
        (d, i) =>
          !/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(dates[i].trim()) ||
          Number.isNaN(d.valueOf()) ||
          localDate(d.toISOString()) !== dates[i].trim() ||
          d.valueOf() <= Date.now(),
      )
    ) {
      setError("각 날짜를 YYYY-MM-DD HH:mm 형식의 미래 일정으로 적어주세요.");
      return;
    }
    onSave({
      ...terms,
      legs: terms.legs.map((l, i) => ({
        ...l,
        startsAt: parsed[i].toISOString(),
      })),
    });
  };
  return (
    <View style={S.card}>
      <Txt bold size={19}>
        함께 확인할 약속
      </Txt>
      <Txt size={12} color={C.muted}>
        아래 일정은 시작용 초안이에요. 각 제공 시간과 장소를 조정하세요.
        상대방도 조건을 수정할 수 있어요. 시간은 한국 기준입니다.
      </Txt>
      {terms.legs.map((leg, i) => (
        <View
          key={leg.listingId}
          style={{
            gap: 9,
            paddingVertical: 10,
            borderBottomWidth: 1,
            borderBottomColor: C.line,
          }}
        >
          <Txt bold size={13}>
            {i + 1}. {listings.find((l) => l.id === leg.listingId)?.title}
          </Txt>
          <Field
            label="제공 시작 · 한국 시간"
            value={dates[i]}
            onChangeText={(text) =>
              setDates((old) => old.map((s, j) => (i === j ? text : s)))
            }
            placeholder="2026-10-01 14:00"
          />
          <Field
            label="전달 장소 또는 접속 방법"
            value={leg.location}
            onChangeText={(location) =>
              setTerms((t) => ({
                ...t,
                legs: t.legs.map((l, j) => (i === j ? { ...l, location } : l)),
              }))
            }
            maxLength={200}
          />
          <GeoPicker privatePlace value={leg.meetingPoint} onChange={point=>{const meetingPoint=point?{lat:point.lat,lng:point.lng,label:point.label}:null;setTerms(t=>({...t,legs:t.legs.map((l,j)=>i===j?{...l,meetingPoint,...(meetingPoint?{location:meetingPoint.label}:{})}:l)}));}}/>
        </View>
      ))}
      <Field
        label="함께 지킬 조건"
        multiline
        value={terms.note}
        onChangeText={(note) => setTerms((t) => ({ ...t, note }))}
        maxLength={1500}
        placeholder="제공 범위, 물품 상태, 이동 방법 등을 적어주세요."
      />
      <Field
        label="변경·취소 약속"
        multiline
        value={terms.cancellation}
        onChangeText={(cancellation) =>
          setTerms((t) => ({ ...t, cancellation }))
        }
        maxLength={1000}
      />
      {!!error && <Notice error>{error}</Notice>}
      <Button label={label} busy={busy} onPress={save} />
      {onCancel && <Button label="수정 닫기" secondary onPress={onCancel} />}
    </View>
  );
}
export function RelayNewScreen() {
  const { ids } = useLocalSearchParams<{ ids: string }>(),
    search = useDavaq<RelaySearch>("/exchange/relays/candidates"),
    me = useGetMe(),
    router = useRouter(),
    mutation = useDavaqMutation<Relay>(),
    request = useRef(key()),
    [error, setError] = useState("");
  const candidate = search.data?.items.find(
    (c) => c.listings.map((l) => l.id).join(",") === ids,
  );
  const submit = async (terms: RelayTerms) => {
    if (!candidate) return;
    setError("");
    try {
      const r = await mutation.mutateAsync({
        path: "/exchange/relays",
        body: {
          listingIds: candidate.listings.map((l) => l.id),
          terms,
          requestKey: request.current,
        },
      });
      router.replace(("/relay/" + r.id) as any);
    } catch (e) {
      setError(errorText(e));
    }
  };
  return (
    <Frame
      back
      title="이렇게 이어져요"
      subtitle="내가 주는 것과 받는 것을 먼저 확인해요"
    >
      <QueryState query={search} />
      {candidate ? (
        <>
          <Outcome listings={candidate.listings} user={me.data?.id} />
          <View style={S.card}>
            <Txt bold>서로의 다음 교환을 연결해요</Txt>
            <Path listings={candidate.listings} user={me.data?.id} />
          </View>
          <Notice>{candidate.pending.join("\n")}</Notice>
          <TermsEditor
            key={candidate.id}
            listings={candidate.listings}
            initial={initialTerms(candidate.listings)}
            busy={mutation.isPending}
            onSave={(t) => void submit(t)}
            label={candidate.listings.length + "명이 함께할 교환 제안하기"}
          />
          <Txt size={12} color={C.muted}>
            제안하면 참여자들의 그룹 채팅이 열려요. 제안만으로 동의되거나 교환이
            확정되지는 않아요.
          </Txt>
        </>
      ) : search.isSuccess ? (
        <Notice>
          이 후보의 상태가 달라졌어요. 이어 바꾸기에서 최신 연결을 다시
          찾아주세요.
        </Notice>
      ) : null}
      {!!error && <Notice error>{error}</Notice>}
    </Frame>
  );
}
export function RelayDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>(),
    query = useDavaq<Relay>("/exchange/relays/" + id, !!id),
    mutation = useDavaqMutation<Relay>(),
    me = useGetMe(),
    router = useRouter(),
    [error, setError] = useState(""),
    [editing, setEditing] = useState(false),
    [note, setNote] = useState("");
  const r = query.data,
    people = r?.members ?? [],
    mine = people.find((m) => m.user_id === me.data?.id),
    previous = mine
      ? people[(mine.position + people.length - 1) % people.length]
      : undefined;
  const accepted = people.filter(
      (m) => m.accepted_version === r?.version,
    ).length,
    received = people.filter((m) => m.received_at).length;
  const terminal =
    r && ["completed", "cancelled", "declined", "expired"].includes(r.status);
  async function act(action: string, terms?: RelayTerms) {
    if (!r) return;
    setError("");
    try {
      await mutation.mutateAsync({
        path: "/exchange/relays/" + id + "/actions",
        body: {
          action,
          version: r.version,
          requestKey: key(),
          ...(terms ? { terms } : {}),
          note,
        },
      });
      setEditing(false);
      await query.refetch();
    } catch (e) {
      setError(errorText(e));
      void query.refetch();
    }
  }
  return (
    <Frame
      back
      title="우리의 이어 바꾸기"
      onRefresh={() => void query.refetch()}
      refreshing={query.isRefetching}
    >
      <QueryState query={query} />
      {r && (
        <>
          <View
            style={[s.hero, { flexDirection: "column", alignItems: "stretch" }]}
          >
            <Txt size={12} color={C.purple} bold>
              {people.length}명이 함께 만드는 교환
            </Txt>
            <Txt size={25} bold>
              {relayStatus(r.status)}
            </Txt>
            <Outcome
              listings={people.map((m) => m.snapshot)}
              user={me.data?.id}
            />
            {r.status === "completed" ? (
              <Txt color={C.green} bold>
                🎉 {people.length}명 모두 받기 완료! 나의 제공이 모두의 바람을
                이었어요.
              </Txt>
            ) : (
              <Txt size={13} color={C.muted}>
                {r.status === "negotiating"
                  ? `${accepted}/${people.length}명 동의 · ${dateLabel(r.expires_at)}까지 확인`
                  : `${received}/${people.length}명 받기 완료`}
              </Txt>
            )}
          </View>
          <View style={s.steps}>
            {["연결 발견", "모두 동의", "전달 중", "모두 받기"].map(
              (label, i) => {
                const stage =
                  r.status === "completed"
                    ? 3
                    : [
                          "reserved",
                          "in_progress",
                          "cancel_requested",
                          "disputed",
                        ].includes(r.status)
                      ? 2
                      : accepted > 0
                        ? 1
                        : 0;
                return (
                  <View
                    key={label}
                    style={[
                      s.miniStep,
                      { backgroundColor: i <= stage ? C.soft : C.white },
                    ]}
                  >
                    <Txt size={12} bold color={i <= stage ? C.purple : C.muted}>
                      {i < stage ? "✓ " : ""}
                      {label}
                    </Txt>
                  </View>
                );
              },
            )}
          </View>
          {!!error && <Notice error>{error}</Notice>}
          {r.status === "negotiating" && (
            <View style={S.card}>
              <Txt bold>내가 받을 제공 범위까지 확인했나요?</Txt>
              <Txt size={13} color={C.muted}>
                아래 모든 항목과 일정에 전원이 동의하면 확정돼요. 조건이
                수정되면 동의도 새로 받아요.
              </Txt>
              <Button
                busy={mutation.isPending}
                disabled={mine?.accepted_version === r.version}
                label={
                  mine?.accepted_version === r.version
                    ? "동의했어요 · 다른 분을 기다려요"
                    : "확인했어요 · 이 조건에 동의"
                }
                onPress={() => void act("accept")}
              />
              <View style={S.wrap}>
                <Button
                  small
                  secondary
                  label="조건 수정"
                  onPress={() => setEditing(!editing)}
                />
                <Button
                  small
                  secondary
                  busy={mutation.isPending}
                  label="이번 연결은 어려워요"
                  onPress={() => void act("decline")}
                />
              </View>
            </View>
          )}
          {editing && (
            <TermsEditor
              key={r.version}
              listings={people.map((m) => m.snapshot)}
              initial={r.terms}
              busy={mutation.isPending}
              label="수정하고 모두에게 다시 확인받기"
              onSave={(t) => void act("revise", t)}
              onCancel={() => setEditing(false)}
            />
          )}
          {["reserved", "in_progress"].includes(r.status) && mine && (
            <View style={S.card}>
              <Txt bold>내 교환 체크리스트</Txt>
              <Txt size={13}>주는 것 · {mine.snapshot.title}</Txt>
              <Button
                label={
                  mine.provided_at
                    ? "전달 완료를 표시했어요"
                    : "약속한 제공을 완료했어요"
                }
                disabled={!!mine.provided_at}
                busy={mutation.isPending}
                onPress={() => void act("provided")}
              />
              <Txt size={13}>받는 것 · {previous?.snapshot.title}</Txt>
              <Button
                label={
                  previous?.received_at
                    ? "내가 받기 완료했어요"
                    : !previous?.provided_at
                      ? "내게 주는 분의 전달을 기다려요"
                      : "원하던 것을 받았어요"
                }
                disabled={!previous?.provided_at || !!previous?.received_at}
                busy={mutation.isPending}
                secondary
                onPress={() => void act("received")}
              />
            </View>
          )}
          {r.status === "cancel_requested" && (
            <View style={S.card}>
              <Txt bold>모두 취소에 동의하면 연결이 닫혀요</Txt>
              <Txt>
                {people.filter((m) => m.cancel_accepted).length}/{people.length}
                명 취소 동의
              </Txt>
              <Button
                busy={mutation.isPending}
                disabled={mine?.cancel_accepted}
                label={
                  mine?.cancel_accepted ? "취소에 동의했어요" : "취소에 동의"
                }
                onPress={() => void act("approve_cancel")}
              />
            </View>
          )}
          {r.status === "disputed" && (
            <Notice>
              전달을 멈추고 그룹 채팅에서 상황을 확인해 주세요. 운영 검토
              목록에도 도움 요청이 접수됐어요.
            </Notice>
          )}
          <Button
            label="함께 이야기하기 · 그룹 채팅"
            secondary
            icon="message-circle"
            onPress={() => router.push(("/chat/" + r.room_id) as any)}
          />
          <View style={S.card}>
            <Txt bold size={19}>
              모두의 연결 지도
            </Txt>
            <Path
              listings={people.map((m) => m.snapshot)}
              user={me.data?.id}
              people={people}
            />
          </View>
          <View style={S.card}>
            <Txt bold>확인한 조건 · {r.version}번째 버전</Txt>
            {people.map((m) => {
              const leg = r.terms.legs.find(
                (l) => l.listingId === m.listing_id,
              );
              return (
                <View
                  key={m.user_id}
                  style={{
                    gap: 4,
                    paddingVertical: 9,
                    borderBottomWidth: 1,
                    borderBottomColor: C.line,
                  }}
                >
                  <Txt bold size={14}>
                    {m.user_id === me.data?.id ? "나" : m.snapshot.ownerName} ·{" "}
                    {m.snapshot.title}
                  </Txt>
                  <Txt
                    size={12}
                    color={m.accepted_version === r.version ? C.green : C.muted}
                  >
                    {m.accepted_version === r.version
                      ? "✓ 이 조건에 동의했어요"
                      : "동의 대기"}
                  </Txt>
                  <Txt size={13}>{m.snapshot.description}</Txt>
                  {!!m.snapshot.terms && (
                    <Txt size={12}>{m.snapshot.terms}</Txt>
                  )}
                  <Txt size={12} color={C.muted}>
                    {dateLabel(leg?.startsAt)} · {m.snapshot.durationMinutes}분
                    {"\n"}
                    {leg?.location}
                  </Txt>
                  <PlaceMap point={leg?.meetingPoint} title="이 제공의 약속 장소"/>
                </View>
              );
            })}
            {!!r.terms.note && <Txt size={13}>{r.terms.note}</Txt>}
            <Txt size={12} color={C.muted}>
              변경·취소: {r.terms.cancellation}
            </Txt>
          </View>
          {!terminal && r.status !== "disputed" && (
            <View style={S.card}>
              <Txt bold>계획이 달라졌나요?</Txt>
              <Field
                label="취소 이유 또는 도움이 필요한 상황"
                value={note}
                onChangeText={setNote}
                multiline
                maxLength={1500}
              />
              <View style={S.wrap}>
                {r.status !== "cancel_requested" && (
                  <Button
                    small
                    secondary
                    label="취소 요청"
                    disabled={note.trim().length < 2}
                    busy={mutation.isPending}
                    onPress={() => void act("cancel")}
                  />
                )}
                <Button
                  small
                  secondary
                  label="도움 요청"
                  disabled={
                    r.status === "negotiating" || note.trim().length < 5
                  }
                  busy={mutation.isPending}
                  onPress={() => void act("dispute")}
                />
              </View>
            </View>
          )}
          {!!r.events.length && (
            <View style={S.card}>
              <Txt bold>함께 남긴 기록</Txt>
              {r.events.slice(0, 8).map((e) => (
                <View key={e.id} style={{ gap: 3 }}>
                  <Txt size={12}>
                    {(
                      {
                        created: "연결 제안",
                        accept: "조건 동의",
                        revise: "조건 수정",
                        provided: "전달 완료",
                        received: "받기 완료",
                        cancel: "취소 요청",
                        approve_cancel: "취소 동의",
                        decline: "참여 어려움",
                        dispute: "도움 요청",
                        admin_resolution: "운영 검토 결과",
                      } as Record<string, string>
                    )[e.kind] ?? e.kind}{" "}
                    · {dateLabel(e.created_at)}
                  </Txt>
                  {!!e.data.note && (
                    <Txt size={12} color={C.muted}>
                      {e.data.note}
                    </Txt>
                  )}
                </View>
              ))}
            </View>
          )}
          {terminal && (
            <Button
              label={
                r.status === "completed"
                  ? "다음 바람도 이어볼까요?"
                  : "다른 연결 다시 찾기"
              }
              onPress={() => router.replace("/relay" as any)}
            />
          )}
        </>
      )}
    </Frame>
  );
}
export function RelayRoomBanner({ roomId }: { roomId: string }) {
  const query = useDavaq<Page<Relay>>(
      "/exchange/relays?roomId=" + roomId,
      !!roomId,
    ),
    router = useRouter();
  const r = query.data?.items[0];
  if (!r) return null;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="이 대화의 이어 바꾸기 확인"
      onPress={() => router.push(("/relay/" + r.id) as any)}
      style={{ padding: 12, backgroundColor: C.soft }}
    >
      <Txt color={C.purple} size={13} bold>
        ↺ 이어 바꾸기 · {relayStatus(r.status)} →
      </Txt>
    </Pressable>
  );
}
const s = StyleSheet.create({
  hero: {
    backgroundColor: C.soft,
    borderRadius: 26,
    padding: 22,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  outcome: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    backgroundColor: C.white,
    borderRadius: 17,
    padding: 15,
  },
  pill: {
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderRadius: 12,
    backgroundColor: C.soft,
  },
  steps: { flexDirection: "row", gap: 5 },
  miniStep: {
    flex: 1,
    paddingVertical: 12,
    paddingHorizontal: 4,
    borderRadius: 12,
    alignItems: "center",
  },
  pathRow: {
    flexDirection: "row",
    gap: 14,
    paddingVertical: 14,
    alignItems: "center",
  },
  node: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
  },
  demoGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  demoTile: {
    width: "48%",
    flexGrow: 1,
    padding: 13,
    gap: 8,
    borderRadius: 17,
    borderWidth: 1,
  },
});
