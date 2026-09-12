import React, { useEffect, useRef, useState } from "react";
import { View, Pressable, Switch, Platform } from "react-native";
import { useRouter, useLocalSearchParams } from "expo-router";
import { useFocusEffect } from "expo-router";
import {
  api,
  key,
  errorText,
  useDavaq,
  useDavaqMutation,
  dateLabel,
} from "@/lib/davaq";
import {
  brandState,
  rewardCategories,
  rewardTypes,
  useBrandRecommendations,
  type BrandCampaign,
  type BrandParticipation,
  type BrandReward,
  type BrandPreferences,
} from "@/lib/brandExchange";
import {
  C,
  S,
  Frame,
  Txt,
  Button,
  Chip,
  Field,
  Section,
  Notice,
  QueryState,
  Empty,
  Cue,
  Icon,
} from "./UI";
import BrandVideo from "./BrandVideo";
export function BrandCard({ item }: { item: BrandCampaign }) {
  const router = useRouter();
  return (
    <Pressable
      accessibilityRole="button"
      onPress={() => router.push(("/brand-exchanges/" + item.id) as any)}
      style={[S.card, { borderColor: "#CBE8E1", overflow: "hidden" }]}
    >
      <View style={S.between}>
        <View
          style={{
            backgroundColor: "#E7F5EF",
            paddingHorizontal: 10,
            paddingVertical: 5,
            borderRadius: 8,
          }}
        >
          <Txt color="#16745B" size={11} bold>
            브랜드 교환 · 광고
          </Txt>
        </View>
        <Txt size={12} color={C.muted}>
          약 1분
        </Txt>
      </View>
      <Txt size={13} color={C.muted}>
        {item.brand} · {item.online ? "온라인" : item.region}
      </Txt>
      <Txt bold size={21}>
        {item.rewardTitle}
      </Txt>
      <Txt size={13}>{item.reason ?? item.description}</Txt>
      <View
        style={{
          borderTopWidth: 1,
          borderStyle: "dashed",
          borderColor: C.line,
          paddingTop: 12,
        }}
      >
        <Txt size={13} bold color={C.purple}>
          내 시간 ↔ {rewardTypes[item.rewardType]} ›
        </Txt>
      </View>
    </Pressable>
  );
}
export function BrandHomeSection() {
  const q = useBrandRecommendations(),
    router = useRouter();
  if (q.data?.enabled === false) return null;
  return (
    <View style={{ gap: 12 }}>
      <Section
        title="내 1분 바꾸기"
        action="둘러보기"
        onPress={() => router.push("/brand-exchanges" as any)}
      />
      <Txt size={13} color={C.muted}>
        브랜드가 준비한 혜택과 짧은 시간을 교환해요.
      </Txt>
      {q.data?.items.slice(0, 1).map((item) => (
        <BrandCard key={item.id} item={item} />
      ))}
      {q.isSuccess && !q.data.items.length && (
        <View
          style={[
            S.card,
            { backgroundColor: "#EFF8F4", borderColor: "#DDEEE5" },
          ]}
        >
          <Txt bold>다음 1분의 교환을 준비하고 있어요</Txt>
          <Txt size={13} color={C.muted}>
            실제로 받을 수 있는 쿠폰과 경험이 준비되면 큐가 소개할게요.
          </Txt>
          <Button
            secondary
            small
            label="받고 싶은 혜택 고르기"
            onPress={() => router.push("/brand-preferences" as any)}
          />
        </View>
      )}
    </View>
  );
}
export function BrandBrowseScreen() {
  const router = useRouter(),
    q = useDavaq<{ items: BrandCampaign[]; enabled: boolean }>(
      "/brand-exchanges",
    ),
    [category, setCategory] = useState(""),
    [online, setOnline] = useState(false),
    [region, setRegion] = useState(""),
    [type, setType] = useState("");
  const items =
    q.data?.items.filter(
      (i) =>
        (!category || i.category === category) &&
        (!online || i.online) &&
        (!region || i.online || i.region.includes(region)) &&
        (!type || i.rewardType === type),
    ) ?? [];
  return (
    <Frame
      back
      title="내 1분 바꾸기"
      subtitle="내 시간과 브랜드의 혜택이 만나는 곳"
      onRefresh={() => void q.refetch()}
    >
      <View style={[S.card, { backgroundColor: "#EAF6F0" }]}>
        <View style={S.row}>
          <Cue size={68} />
          <View style={{ flex: 1, gap: 4 }}>
            <Txt bold size={19}>
              오늘은 어떤 혜택을 바꿀까요?
            </Txt>
            <Txt size={13}>
              두 영상의 다른 부분을 찾고, 안내된 조건을 달성하면 혜택을 받아요.
            </Txt>
          </View>
        </View>
        <Txt size={12} color={C.muted}>
          광고 참여 · 30초 영상 2개 동시 재생 · 안내 포함 약 1분
        </Txt>
      </View>
      <View style={S.wrap}>
        <Chip label="전체" active={!category} onPress={() => setCategory("")} />
        {rewardCategories.map(([v, l]) => (
          <Chip
            key={v}
            label={l}
            active={category === v}
            onPress={() => setCategory(v)}
          />
        ))}
      </View>
      <View style={S.wrap}>
        <Chip label="모든 혜택" active={!type} onPress={() => setType("")} />
        {Object.entries(rewardTypes).map(([v, l]) => (
          <Chip
            key={v}
            label={l}
            active={type === v}
            onPress={() => setType(v)}
          />
        ))}
      </View>
      <View style={S.row}>
        <Chip
          label="온라인 사용"
          active={online}
          onPress={() => setOnline(!online)}
        />
        <Button
          small
          secondary
          label="추천 설정"
          onPress={() => router.push("/brand-preferences" as any)}
        />
      </View>
      <Field
        label="사용 지역"
        placeholder="지역 검색 (온라인 혜택 포함)"
        value={region}
        onChangeText={setRegion}
      />
      <QueryState query={q} />
      {items.map((item) => (
        <BrandCard key={item.id} item={item} />
      ))}
      {q.isSuccess && !items.length && (
        <Empty
          icon="gift"
          title="아직 맞는 혜택이 없어요"
          body="사용 가능한 보상이 확보된 브랜드 교환만 보여드려요. 관심 혜택을 골라두면 다음 탐색에 활용해요."
        />
      )}
    </Frame>
  );
}
export function BrandDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>(),
    q = useDavaq<BrandCampaign>("/brand-exchanges/" + id),
    m = useDavaqMutation<BrandParticipation>(),
    router = useRouter(),
    requestKey = useRef(key()),
    [error, setError] = useState("");
  async function start() {
    try {
      setError("");
      const p = await m.mutateAsync({
        path: "/brand-exchanges/" + id + "/start",
        body: { requestKey: requestKey.current },
      });
      router.push(("/brand-exchanges/play/" + p.id) as any);
    } catch (e) {
      setError(errorText(e));
    }
  }
  const c = q.data;
  return (
    <Frame back title="브랜드 교환" onRefresh={() => void q.refetch()}>
      <QueryState query={q} />
      {c && (
        <>
          <BrandCard item={c} />
          <Txt bold size={24}>
            {c.title}
          </Txt>
          <Txt>{c.description}</Txt>
          <View style={S.card}>
            <Txt bold>내가 주는 것</Txt>
            <Txt>
              영상 2개를 동시에 30초 동안 보고, 다른 부분 {c.differences}개를
              찾아요.
            </Txt>
            <Txt size={13} color={C.muted}>
              안내와 결과 확인까지 약 1분이에요. 한 번 더 도전하면 약 30초가
              추가돼요.
            </Txt>
          </View>
          <View style={S.card}>
            <Txt bold>내가 받는 것</Txt>
            <Txt bold color={C.green}>
              {c.rewardTitle}
            </Txt>
            <Txt>{c.terms}</Txt>
            <Txt size={13}>추가 결제·비용: {c.extraCost}</Txt>
            <Txt size={13}>
              참여 시작 시 유효기간이 7일 이상 남은 보상을 확보해요. 지급 후
              정확한 만료일을 확인할 수 있어요.
            </Txt>
            <Txt size={13}>사용 범위: {c.online ? "온라인" : c.region}</Txt>
          </View>
          <Notice>
            캠페인당 한 번 참여하며, 최대 2번 도전할 수 있어요. 한 시도에 8번
            선택할 수 있고, 끝까지 시청하며 모든 차이를 찾아야 성공해요. 시작할
            때 보상을 확보하며 20분 안에 완료해 주세요. 화면을 벗어나면 영상이
            멈춰요. 24시간 동안 최대 5개 캠페인에 참여할 수 있어요.
          </Notice>
          <Txt size={13}>
            참여 마감: {dateLabel(c.endsAt)}
            {"\n"}브랜드·혜택 문의: {c.support}
          </Txt>
          {c.participationId ? (
            <Button
              label="내 참여 확인"
              onPress={() =>
                router.push(
                  ("/brand-exchanges/play/" + c.participationId) as any,
                )
              }
            />
          ) : (
            <Button
              icon="play"
              label={
                c.canStart
                  ? "조건 확인 · 보상 확보하고 참여"
                  : "지금은 참여할 수 없어요"
              }
              disabled={!c.canStart || Platform.OS !== "web"}
              busy={m.isPending}
              onPress={() => void start()}
            />
          )}
          {Platform.OS !== "web" && (
            <Notice>
              영상 비교 참여는 현재 DavaQ 웹에서 이용할 수 있어요.
            </Notice>
          )}
          {error && <Notice error>{error}</Notice>}
        </>
      )}
    </Frame>
  );
}
export function BrandPlayScreen() {
  const { participationId } = useLocalSearchParams<{
      participationId: string;
    }>(),
    q = useDavaq<BrandParticipation>(
      "/brand-exchanges/participations/" + participationId,
    ),
    router = useRouter();
  return (
    <Frame back title="다른 장면 찾기">
      <QueryState query={q} />
      {q.data && (
        <>
          <Txt size={20} bold>
            {q.data.rewardTitle}
          </Txt>
          {["held", "playing", "paused"].includes(q.data.status) ? (
            <BrandVideo initial={q.data} onComplete={() => void q.refetch()} />
          ) : (
            <View style={S.card}>
              <Cue size={90} />
              <Txt bold size={24}>
                {brandState(q.data.status)}
              </Txt>
              <Txt>
                {q.data.status === "succeeded"
                  ? "영상 확인과 찾기를 완료했어요. 확보한 혜택의 지급 상태를 확인해 주세요."
                  : "이번 참여가 종료됐어요. 다른 브랜드 교환을 찾아보세요."}
              </Txt>
              {q.data.claimId && (
                <Button
                  label="받은 혜택 확인"
                  onPress={() =>
                    router.replace(("/brand-rewards/" + q.data!.claimId) as any)
                  }
                />
              )}
              <Button
                secondary
                label="다른 교환 둘러보기"
                onPress={() => router.replace("/brand-exchanges" as any)}
              />
            </View>
          )}
        </>
      )}
    </Frame>
  );
}
export function BrandRewardsScreen() {
  const q = useDavaq<{ items: BrandReward[] }>("/brand-rewards"),
    p = useDavaq<{ items: BrandParticipation[] }>(
      "/brand-exchanges/participations",
    ),
    router = useRouter();
  return (
    <Frame
      back
      title="받은 혜택"
      subtitle="내 시간으로 교환한 작은 즐거움"
      onRefresh={() => {
        void q.refetch();
        void p.refetch();
      }}
    >
      <QueryState query={q} />
      {q.data?.items.map((r) => (
        <Pressable
          key={r.id}
          accessibilityRole="button"
          style={S.card}
          onPress={() => router.push(("/brand-rewards/" + r.id) as any)}
        >
          <View style={S.between}>
            <Txt color={C.green} size={12} bold>
              {new Date(r.validUntil).getTime() < Date.now()
                ? "유효기간 만료"
                : r.selfUsedAt
                  ? "사용 표시 · 직접 기록"
                  : brandState(r.status)}
            </Txt>
            <Icon name="gift" />
          </View>
          <Txt size={13} color={C.muted}>
            {r.brand}
          </Txt>
          <Txt bold size={20}>
            {r.title}
          </Txt>
          <Txt size={12} color={C.muted}>
            {dateLabel(r.validUntil)}까지
          </Txt>
        </Pressable>
      ))}
      {q.isSuccess && !q.data.items.length && (
        <Empty
          icon="gift"
          title="첫 번째 혜택을 기다리고 있어요"
          body="브랜드와의 교환이 성공하면 쿠폰과 체험권을 이곳에서 확인할 수 있어요."
          action="내 1분 바꾸기"
          onPress={() => router.push("/brand-exchanges" as any)}
        />
      )}
      <Section title="참여 기록" />
      <QueryState query={p} />
      {p.data?.items
        .filter((i) => i.status !== "succeeded")
        .map((i) => (
          <Button
            key={i.id}
            secondary
            label={i.rewardTitle + " · " + brandState(i.status)}
            onPress={() =>
              router.push(("/brand-exchanges/play/" + i.id) as any)
            }
          />
        ))}
    </Frame>
  );
}
export function BrandRewardScreen() {
  const { id } = useLocalSearchParams<{ id: string }>(),
    q = useDavaq<BrandReward>("/brand-rewards/" + id),
    m = useDavaqMutation(),
    [code, setCode] = useState(""),
    [note, setNote] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    generation = useRef(0);
  useFocusEffect(
    React.useCallback(() => {
      return () => {
        generation.current++;
        setCode("");
      };
    }, []),
  );
  useEffect(() => {
    if (Platform.OS !== "web") return;
    const clear = () => {
      if (document.hidden) {
        generation.current++;
        setCode("");
      }
    };
    document.addEventListener("visibilitychange", clear);
    return () => document.removeEventListener("visibilitychange", clear);
  }, []);
  useEffect(() => {
    if (!q.data || q.data.status === "issued") return;
    const t = setInterval(() => void q.refetch(), 5000);
    return () => clearInterval(t);
  }, [q.data?.status]);
  async function reveal() {
    const g = generation.current;
    setBusy(true);
    try {
      setError("");
      const r = await api<{ code: string }>(
        "/brand-rewards/" + id + "/reveal",
        "POST",
      );
      if (g === generation.current) setCode(r.code);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }
  async function action(action: string) {
    try {
      setError("");
      await m.mutateAsync({
        path: "/brand-rewards/" + id + "/actions",
        body: { action, note },
      });
      setNote("");
    } catch (e) {
      setError(errorText(e));
    }
  }
  const r = q.data;
  return (
    <Frame back title="내 혜택" onRefresh={() => void q.refetch()}>
      <QueryState query={q} />
      {r && (
        <>
          <View
            style={[
              S.card,
              {
                backgroundColor: "#EAF6F0",
                alignItems: "center",
                paddingVertical: 30,
              },
            ]}
          >
            <Icon name="gift" size={40} color={C.green} />
            <Txt size={13}>{r.brand}</Txt>
            <Txt size={25} bold>
              {r.title}
            </Txt>
            <Txt color={C.green} bold>
              {brandState(r.status)}
            </Txt>
          </View>
          {r.status === "issued" &&
            new Date(r.validUntil).getTime() > Date.now() && (
              <View style={S.card}>
                <Txt bold>나만의 교환 코드</Txt>
                {code ? (
                  <>
                    <Txt size={23} bold style={{ fontFamily: "monospace" }}>
                      {code}
                    </Txt>
                    <Button
                      small
                      secondary
                      label="코드 숨기기"
                      onPress={() => setCode("")}
                    />
                  </>
                ) : (
                  <Button
                    label="교환 코드 확인"
                    busy={busy}
                    onPress={() => void reveal()}
                  />
                )}
                <Txt size={12} color={C.muted}>
                  코드를 타인에게 전달하지 마세요. 화면을 벗어나면 다시
                  숨겨져요.
                </Txt>
              </View>
            )}
          {r.status !== "issued" && (
            <Notice>
              보상을 확보해 두었어요. 지급 처리 또는 운영 확인이 끝나면 이
              화면에서 코드를 확인할 수 있어요.
            </Notice>
          )}
          <View style={S.card}>
            <Txt bold>사용 안내</Txt>
            <Txt>{r.terms}</Txt>
            <Txt>추가 결제·비용: {r.extraCost}</Txt>
            <Txt>유효기간: {dateLabel(r.validUntil)}</Txt>
            <Txt>문의: {r.support}</Txt>
          </View>
          {r.status === "issued" && (
            <>
              <Button
                secondary
                label={
                  r.selfUsedAt
                    ? "직접 표시한 사용 기록 취소"
                    : "사용했어요 · 직접 기록"
                }
                busy={m.isPending}
                onPress={() => void action(r.selfUsedAt ? "unused" : "used")}
              />
              <Txt size={12} color={C.muted}>
                사용 표시는 나의 기록이며, 브랜드가 확인한 실제 사용 내역과
                달라요.
              </Txt>
            </>
          )}
          <Section title="혜택에 문제가 있나요?" />
          {r.issue && (
            <Notice>
              접수 내용: {r.issue}
              {r.resolution
                ? "\n운영 답변: " + r.resolution
                : "\n운영자가 확인 중이에요."}
            </Notice>
          )}
          <Field
            label="문제 상황"
            multiline
            placeholder="문제 상황을 적어 주세요. 쿠폰 코드는 적지 않아도 돼요."
            value={note}
            onChangeText={setNote}
          />
          <Button
            secondary
            label="문제 접수"
            disabled={note.trim().length < 5}
            busy={m.isPending}
            onPress={() => void action("issue")}
          />
          {error && <Notice error>{error}</Notice>}
        </>
      )}
    </Frame>
  );
}
export function BrandPreferencesScreen() {
  const q = useDavaq<BrandPreferences>("/brand-preferences"),
    m = useDavaqMutation(),
    [draft, setDraft] = useState<BrandPreferences | null>(null),
    [message, setMessage] = useState("");
  useEffect(() => {
    if (q.data && !draft) setDraft(q.data);
  }, [q.data]);
  async function save() {
    try {
      await m.mutateAsync({
        path: "/brand-preferences",
        method: "PATCH",
        body: draft,
      });
      setDraft(null);
      setMessage("추천 설정을 저장했어요.");
    } catch (e) {
      setMessage(errorText(e));
    }
  }
  return (
    <Frame
      back
      title="큐의 혜택 취향"
      onRefresh={() => {
        setDraft(null);
        void q.refetch();
      }}
    >
      <QueryState query={q} />
      <View style={[S.card, S.row]}>
        <Cue size={84} />
        <View style={{ flex: 1 }}>
          <Txt bold size={19}>
            취향을 알려주면 더 잘 찾아요
          </Txt>
          <Txt size={13}>
            실제로 교환한 브랜드 혜택 {q.data?.discoveries ?? 0}개
          </Txt>
        </View>
      </View>
      {draft && (
        <>
          <Txt bold>받고 싶은 혜택</Txt>
          <View style={S.wrap}>
            {rewardCategories.map(([v, l]) => (
              <Chip
                key={v}
                label={l}
                active={draft.categories.includes(v)}
                onPress={() =>
                  setDraft({
                    ...draft,
                    categories: draft.categories.includes(v)
                      ? draft.categories.filter((x) => x !== v)
                      : [...draft.categories, v],
                  })
                }
              />
            ))}
          </View>
          <Field
            label="관심 지역"
            value={draft.region}
            onChangeText={(region) => setDraft({ ...draft, region })}
            placeholder="관심 지역 · 예: 서울"
          />
          <View style={S.card}>
            <View style={S.between}>
              <View style={{ flex: 1 }}>
                <Txt bold>확인한 기억도 추천에 활용</Txt>
                <Txt size={12} color={C.muted}>
                  큐에게 저장한 관심 분야에서 음식·문화·배움·생활 취향을 찾아요.
                  대화 원문과 민감한 정보는 광고주에게 전달하지 않아요.
                </Txt>
              </View>
              <Switch
                value={draft.personalized}
                onValueChange={(personalized) =>
                  setDraft({ ...draft, personalized })
                }
                trackColor={{ true: C.purple }}
              />
            </View>
            <Txt size={12} color={C.muted}>
              기본은 꺼짐이에요. 꺼도 직접 고른 관심 혜택으로 추천받을 수
              있어요. 광고 참여만으로 취향을 확정하지 않아요.
            </Txt>
          </View>
          <Button
            label="추천 설정 저장"
            busy={m.isPending}
            onPress={() => void save()}
          />
          {message && <Notice>{message}</Notice>}
        </>
      )}
    </Frame>
  );
}
