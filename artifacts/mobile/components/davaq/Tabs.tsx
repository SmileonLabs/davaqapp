import React, { useState } from "react";
import { Pressable, View } from "react-native";
import { useRouter, useLocalSearchParams } from "expo-router";
import { useGetMe, useListRooms } from "@workspace/api-client-react";
import {
  useDavaq,
  useDavaqMutation,
  categories,
  statusName,
  dateLabel,
  type Page,
  type Listing,
  type Match,
  type Agent,
  type Proposal,
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
  Cue,
  Empty,
  QueryState,
  Notice,
  ListingCard,
  PairCard,
  ProposalCard,
  Icon,
} from "./UI";

import { PinnedAgentConversation } from "./AgentConversation";
import { BrandHomeSection } from "./BrandExchangeScreens";
import { RelayEntry } from "./RelayScreens";

export function HomeScreen() {
  const router = useRouter(),
    matches = useDavaq<Page<Match>>("/exchange/matches"),
    agent = useDavaq<Agent>("/agents/me"),
    short = useDavaq<Page<Listing>>("/exchange/listings?short=true&today=true"),
    me = useGetMe();
  const items = matches.data?.items ?? [];
  return (
    <Frame
      title="DavaQ"
      subtitle="경험이 이어지는, 더 특별한 하루"
      onRefresh={() => {
        void matches.refetch();
        void agent.refetch();
        void short.refetch();
      }}
      right={
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="내 교환 알림 확인"
          onPress={() => router.push("/(tabs)/exchanges")}
          style={{ padding: 10 }}
        >
          <Icon name="bell" color={C.ink} />
        </Pressable>
      }
    >
      <View>
        <Txt size={29} bold>
          오늘,
        </Txt>
        <Txt size={29} bold>
          무엇을 바꿔볼까요?
        </Txt>
      </View>
      <Pressable
        accessibilityRole="button"
        onPress={() =>
          router.push(items.length ? "/agent/searches" : "/agent/chat")
        }
        style={{
          backgroundColor: C.soft,
          borderRadius: 24,
          minHeight: 160,
          overflow: "hidden",
          padding: 20,
          flexDirection: "row",
          alignItems: "center",
        }}
      >
        <View style={{ flex: 1, gap: 8, zIndex: 1 }}>
          <Txt bold size={19}>
            {items.length
              ? "큐가 " + items.length + "개의\n교환 후보를 찾았어요"
              : "첫 교환을\n큐와 함께 찾아봐요"}
          </Txt>
          <Txt color={C.muted} size={12}>
            {items.length
              ? "서로 원하는 분야와 조건을 살펴봤어요."
              : "줄 수 있는 것과 받고 싶은 것을 알려주세요."}
          </Txt>
          <Txt color={C.purple} bold size={14}>
            {items.length ? "추천 보기" : "큐에게 말하기"} ›
          </Txt>
        </View>
        <View style={{ width: 115, alignItems: "center" }}>
          <Cue size={160} />
        </View>
      </Pressable>
      <View style={S.row}>
        <Button
          style={{ flex: 1, minHeight: 88 }}
          label="줄 수 있어요"
          icon="plus"
          onPress={() => router.push("/exchange/new?mode=offer")}
        />
        <Button
          style={{ flex: 1, minHeight: 88 }}
          secondary
          label="받고 싶어요"
          icon="heart"
          onPress={() => router.push("/exchange/new?mode=want")}
        />
      </View>
      <RelayEntry />
      <BrandHomeSection />
      <Section
        title="나에게 맞는 교환"
        action="더보기"
        onPress={() => router.push("/agent/searches")}
      />
      <QueryState query={matches} />
      {items.slice(0, 2).map((m) => (
        <PairCard key={m.id} match={m} />
      ))}
      {matches.isSuccess && !items.length && (
        <Empty
          title="나의 첫 교환을 준비해요"
          body="내가 제공할 수 있는 것과 희망 분야를 등록하면, 서로 조건이 맞는 상대를 찾아드려요."
          action="교환 등록하기"
          onPress={() => router.push("/exchange/new")}
        />
      )}
      <Section
        title="오늘 30분 바꿀래요?"
        action="둘러보기"
        onPress={() => router.push("/(tabs)/search")}
      />
      <QueryState query={short} />
      <View style={S.grid}>
        {short.data?.items.slice(0, 2).map((l) => (
          <ListingCard key={l.id} listing={l} compact />
        ))}
      </View>
      {short.isSuccess && !short.data?.items.length && (
        <Notice>
          아직 오늘 가능한 짧은 교환이 없어요. 나의 30분을 먼저 등록해볼까요?
        </Notice>
      )}
      <View style={[S.card, S.row]}>
        <Cue size={60} />
        <View style={{ flex: 1, gap: 3 }}>
          <Txt bold>
            {me.data?.nickname ?? "회원"}님의 큐 · Lv.{agent.data?.level ?? 1}
          </Txt>
          <Txt size={12} color={C.muted}>
            {agent.data?.stage ?? "새싹 파트너"} · 확인한 취향으로 조금씩 배워요
          </Txt>
        </View>
      </View>
    </Frame>
  );
}

export function DiscoverScreen() {
  const router = useRouter(),
    params = useLocalSearchParams<{ category?: string }>(),
    [kind, setKind] = useState(""),
    [mode, setMode] = useState("offer"),
    [category, setCategory] = useState(params.category ?? ""),
    [text, setText] = useState(""),
    [q, setQ] = useState(""),
    [online, setOnline] = useState(false),
    [today, setToday] = useState(false),
    [region, setRegion] = useState(""),
    [location, setLocation] = useState(""),
    [offset, setOffset] = useState(0);
  const search = new URLSearchParams({ offset: String(offset), mode });
  if (kind) search.set("kind", kind);
  if (category) search.set("category", category);
  if (q) search.set("q", q);
  if (online) search.set("delivery", "online");
  if (today) search.set("today", "true");
  if (location) search.set("location", location);
  const query = useDavaq<Page<Listing>>(
      "/exchange/listings?" + search.toString(),
    ),
    items = query.data?.items ?? [];
  const choose = (fn: () => void) => {
    fn();
    setOffset(0);
  };
  return (
    <Frame
      title="둘러보기"
      onRefresh={() => void query.refetch()}
      right={
        <Button
          small
          label="등록"
          icon="plus"
          onPress={() => router.push("/exchange/new")}
        />
      }
    >
      <Button
        secondary
        icon="gift"
        label="내 1분으로 브랜드 혜택 바꾸기"
        onPress={() => router.push("/brand-exchanges" as any)}
      />
      <View style={S.row}>
        <View style={{ flex: 1 }}>
          <Field
            label="어떤 경험을 찾으세요?"
            placeholder="사진 촬영, 발성, 디자인…"
            value={text}
            onChangeText={setText}
            returnKeyType="search"
            onSubmitEditing={() => choose(() => setQ(text.trim()))}
          />
        </View>
        <Button
          label="검색"
          small
          onPress={() => choose(() => setQ(text.trim()))}
        />
      </View>
      <View style={S.wrap}>
        <Chip
          label="줄 수 있는 것"
          active={mode === "offer"}
          onPress={() => choose(() => setMode("offer"))}
        />
        <Chip
          label="받고 싶은 것"
          active={mode === "want"}
          onPress={() => choose(() => setMode("want"))}
        />
      </View>
      <View style={S.wrap}>
        {[
          ["", "전체"],
          ["goods", "물건"],
          ["service", "재능"],
          ["experience", "경험"],
        ].map(([v, l]) => (
          <Chip
            key={v}
            label={l}
            active={kind === v}
            onPress={() => choose(() => setKind(v))}
          />
        ))}
      </View>
      <View style={S.wrap}>
        <Chip
          label="온라인"
          active={online}
          onPress={() => choose(() => setOnline(!online))}
        />
        <Chip
          label="오늘 가능한 요일"
          active={today}
          onPress={() => choose(() => setToday(!today))}
        />
        <Chip
          label="필터 초기화"
          onPress={() =>
            choose(() => {
              setCategory("");
              setKind("");
              setOnline(false);
              setToday(false);
              setLocation("");
              setRegion("");
              setQ("");
              setText("");
            })
          }
        />
      </View>
      <View style={S.row}>
        <View style={{ flex: 1 }}>
          <Field
            label="활동 지역"
            placeholder="예: 서울 강남"
            value={region}
            onChangeText={setRegion}
            onSubmitEditing={() => choose(() => setLocation(region.trim()))}
          />
        </View>
        <Button
          small
          secondary
          label="적용"
          onPress={() => choose(() => setLocation(region.trim()))}
        />
      </View>
      <View style={S.wrap}>
        {categories.map(([v, l]) => (
          <Chip
            key={v}
            label={l}
            active={category === v}
            onPress={() => choose(() => setCategory(category === v ? "" : v))}
          />
        ))}
      </View>
      {!kind && !q && !category && offset === 0 && (
        <Pressable
          accessibilityRole="button"
          onPress={() => router.push("/exchange/new?template=voice")}
          style={{
            borderRadius: 23,
            padding: 24,
            backgroundColor: "#392459",
            gap: 10,
          }}
        >
          <Txt size={12} color="#DBCBFF">
            EXPERIENCE · 등록 템플릿
          </Txt>
          <Icon name="mic" size={40} color="#D7C2FC" />
          <Txt size={24} bold color="white">
            CEO VOICE
          </Txt>
          <Txt color="#E5D9F3" size={14}>
            나의 목소리로, 더 멀리 나아가는 시간
          </Txt>
          <Txt color="#E5D9F3" size={12}>
            90분 · 희망 EV 100 · 직접 제공할 수 있다면 등록해요
          </Txt>
          <Txt bold color="white" size={14}>
            내 경험으로 작성하기 ↗
          </Txt>
        </Pressable>
      )}
      <Section title={q ? "‘" + q + "’ 검색 결과" : "이런 교환은 어떠세요?"} />
      <QueryState query={query} />
      <View style={S.grid}>
        {items.map((l) => (
          <View
            key={l.id}
            style={{ width: "48%", flexGrow: 1, maxWidth: "100%" }}
          >
            <ListingCard listing={l} compact />
          </View>
        ))}
      </View>
      {query.isSuccess && !items.length && (
        <Empty
          title="아직 등록된 교환이 없어요"
          body="필터를 바꿔보거나 받고 싶은 경험을 등록해 주세요."
          action="받고 싶은 것 등록"
          onPress={() => router.push("/exchange/new?mode=want")}
        />
      )}
      <View style={S.between}>
        {offset > 0 ? (
          <Button
            secondary
            small
            label="이전"
            onPress={() => setOffset(Math.max(0, offset - 25))}
          />
        ) : (
          <View />
        )}
        {query.data?.nextOffset != null && (
          <Button
            small
            label="다음"
            onPress={() => setOffset(query.data!.nextOffset!)}
          />
        )}
      </View>
    </Frame>
  );
}

export function AgentScreen() {
  const router = useRouter(),
    query = useDavaq<Agent>("/agents/me"),
    a = query.data;
  return (
    <Frame
      title="내 AI"
      onRefresh={() => void query.refetch()}
      right={
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="큐 설정"
          onPress={() => router.push("/agent/settings")}
          style={{ padding: 8 }}
        >
          <Icon name="settings" color={C.ink} />
        </Pressable>
      }
    >
      <View style={{ alignItems: "center", gap: 4 }}>
        <Cue size={235} />
        <Txt size={25} bold>
          나의 {a?.settings.name ?? "큐"}
        </Txt>
        <Txt color={C.purple} bold>
          Lv.{a?.level ?? 1} · {a?.stage ?? "새싹 파트너"}
        </Txt>
      </View>
      <QueryState query={query} />
      <View style={[S.between, { paddingHorizontal: 12 }]}>
        {["첫 만남", "취향 발견", "첫 교환"].map((label, i) => (
          <View key={label} style={{ alignItems: "center", gap: 8 }}>
            <View
              style={{
                backgroundColor: (a?.level ?? 1) > i ? C.purple : C.line,
                padding: 10,
                borderRadius: 24,
              }}
            >
              <Icon
                name={i === 2 ? "star" : "check"}
                color={(a?.level ?? 1) > i ? C.white : C.muted}
              />
            </View>
            <Txt size={12}>{label}</Txt>
          </View>
        ))}
      </View>
      <Notice>
        {a?.level === 3
          ? "함께 교환을 완료했어요. 다음 경험도 같이 찾아봐요."
          : a?.level === 2
            ? "내가 확인해 준 취향을 추천에 반영하고 있어요."
            : "큐에게 나의 취향 하나를 알려주세요. 확인한 기억으로 성장해요."}
      </Notice>
      <Button
        label="큐와 이야기하기"
        icon="message-circle"
        onPress={() => router.push("/agent/chat")}
      />
      <Button
        secondary
        icon="gift"
        label="큐의 혜택 취향·발견 기록"
        onPress={() => router.push("/brand-preferences" as any)}
      />
      <Section
        title="새로 알게 된 취향"
        action="기억 관리"
        onPress={() => router.push("/agent/memories")}
      />
      {a?.memories.slice(0, 3).map((m) => (
        <View key={m.id} style={[S.card, S.between]}>
          <View style={{ flex: 1 }}>
            <Txt size={14}>{m.label}</Txt>
            <Txt size={11} color={C.muted}>
              {m.source_type === "manual"
                ? "직접 입력"
                : m.source_type === "feedback"
                  ? "교환 후기에서"
                  : "허용한 대화에서"}
            </Txt>
          </View>
          <Txt size={12} color={m.status === "confirmed" ? C.green : C.purple}>
            {m.status === "confirmed" ? "내가 확인" : "확인 대기"}
          </Txt>
        </View>
      ))}
      {a && !a.memories.length && (
        <Empty
          title="아직 저장한 기억이 없어요"
          body="‘주말에 온라인 교환이 좋아요’처럼 취향을 직접 알려줄 수 있어요."
          action="기억 추가"
          onPress={() => router.push("/agent/memories")}
          icon="heart"
        />
      )}
      <Section
        title="큐의 탐색 기록"
        action="더보기"
        onPress={() => router.push("/agent/searches")}
      />
      <View style={S.card}>
        <View style={S.row}>
          <Icon name={a?.job?.status === "running" ? "search" : "compass"} />
          <Txt bold>
            {a?.job?.status === "running"
              ? "조건에 맞는 후보를 찾는 중"
              : a?.job?.status === "pending"
                ? "새로운 탐색을 준비 중"
                : a?.job?.status === "done"
                  ? "최근 탐색 완료"
                  : a?.job?.status === "failed"
                    ? "탐색을 다시 시도해 주세요"
                    : "첫 탐색을 기다리고 있어요"}
          </Txt>
        </View>
        <Txt size={13} color={C.muted}>
          {a?.job?.finished_at
            ? dateLabel(a.job.finished_at) +
              " · " +
              a.job.result_count +
              "개 후보 확인"
            : "자동 탐색은 큐 설정에서 켤 수 있어요."}
        </Txt>
        <Button
          secondary
          label="찾아온 교환 보기"
          onPress={() => router.push("/agent/searches")}
        />
      </View>
    </Frame>
  );
}

export { InboxScreen } from "./InboxScreen";
export function MyExchangesScreen() {
  const router = useRouter(),
    [tab, setTab] = useState("ongoing"),
    proposals = useDavaq<Page<Proposal>>("/exchange/proposals"),
    listings = useDavaq<Page<Listing>>("/exchange/listings?mine=true");
  const items =
    proposals.data?.items.filter((p) =>
      tab === "completed"
        ? ["completed", "cancelled", "declined", "expired"].includes(p.status)
        : !["completed", "cancelled", "declined", "expired"].includes(p.status),
    ) ?? [];
  return (
    <Frame
      title="내 교환"
      onRefresh={() => {
        void proposals.refetch();
        void listings.refetch();
      }}
      right={
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="내 설정"
          onPress={() => router.push("/settings")}
          style={{ padding: 8 }}
        >
          <Icon name="settings" color={C.ink} />
        </Pressable>
      }
    >
      <View style={S.wrap}>
        {[
          ["ongoing", "진행 중"],
          ["listings", "내 등록"],
          ["completed", "완료·지난 교환"],
        ].map(([v, l]) => (
          <Chip
            key={v}
            label={l}
            active={tab === v}
            onPress={() => setTab(v)}
          />
        ))}
      </View>
      <Button
        secondary
        icon="gift"
        label="받은 혜택 · 브랜드 교환 기록"
        onPress={() => router.push("/brand-rewards" as any)}
      />
      <RelayEntry compact />
      {tab === "listings" ? (
        <>
          <Button
            label="새 교환 등록"
            icon="plus"
            onPress={() => router.push("/exchange/new")}
          />
          <QueryState query={listings} />
          {listings.data?.items.map((l) => (
            <ListingCard key={l.id} listing={l} />
          ))}
          {listings.isSuccess && !listings.data?.items.length && (
            <Empty
              title="나만의 첫 교환을 등록해요"
              body="물건 하나, 잘하는 일 하나, 함께할 경험 하나면 충분해요."
            />
          )}
        </>
      ) : (
        <>
          <QueryState query={proposals} />
          {items.map((p) => (
            <ProposalCard key={p.id} proposal={p} />
          ))}
          {proposals.isSuccess && !items.length && (
            <Empty
              title={
                tab === "completed"
                  ? "아직 완료한 교환이 없어요"
                  : "아직 진행 중인 교환이 없어요"
              }
              body="서로의 조건에 동의한 뒤 일정을 확정하고, 각자 제공한 내용을 확인하면 교환이 완료돼요."
              action="교환 둘러보기"
              onPress={() => router.push("/(tabs)/search")}
              icon="repeat"
            />
          )}
        </>
      )}
    </Frame>
  );
}
