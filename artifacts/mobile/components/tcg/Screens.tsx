import { PriceChart } from "./PriceChart";
import React, { useState, useEffect } from "react";
import { View, Pressable, Linking, Platform, AppState } from "react-native";
import { useRouter, useLocalSearchParams } from "expo-router";
import { useGetMe } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/lib/davaqAuth";
import {
  registrationId,
  registrationReturnHref,
  registrationCatalogHref,
  registrationOwnedHref,
  withRegistrationItem,
} from "@/lib/tcgRegistration";
import { pickAndUploadImage } from "@/lib/uploadImage";
import {
  Frame,
  Txt,
  Button,
  Field,
  Chip,
  Section,
  Notice,
  Empty,
  QueryState,
  S,
  C,
  Icon,
} from "@/components/davaq/UI";
import {
  api,
  useDavaq,
  useDavaqMutation,
  key,
  errorText,
  CONDITIONS,
  conditionName,
  money,
  statusName,
  cardLink,
  type Page,
  type CatalogCard,
  type Detail,
  type Owned,
  type Want,
  type Listing,
  type Trade,
} from "@/lib/tcg";
import { CardArt, CollectionCardArt, CatalogRow, ListingRow } from "./Cards";
import { ListingComments } from "./ListingComments";
import { useUgcConsent, UgcConsentPrompt } from "@/components/UgcConsentPrompt";
import { ExchangeMap, MapPicker } from "./Map";
import { type Coordinate } from "@/lib/maps";
import { preloadPublicCardImages } from "@/hooks/useExchangeFeed";
function useAction() {
  const mutation = useDavaqMutation<any>(),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  return {
    error,
    failure: (e: unknown) => setError(errorText(e)),
    notice,
    busy: mutation.isPending,
    run: async (path: string, body?: unknown, method = "POST") => {
      setError("");
      setNotice("");
      try {
        return await mutation.mutateAsync({ path, body, method });
      } catch (e) {
        setError(errorText(e));
        return null;
      }
    },
    success: (s: string) => setNotice(s),
    feedback: (
      <>
        {error && <Notice error>{error}</Notice>}
        {notice && <Notice>{notice}</Notice>}
      </>
    ),
  };
}
export function HomeScreen() {
  const [homeGame, setHomeGame] = useState("");
  const r = useRouter(),
    publicListings = useDavaq<Page<Listing>>("/tcg/listings"),
    onePiece = useDavaq<Page<CatalogCard>>(
      "/tcg/catalog?game=one_piece&market=KR&page=1",
      !homeGame,
    ),
    yugioh = useDavaq<Page<CatalogCard>>(
      "/tcg/catalog?game=yugioh&market=KR&page=1",
      !homeGame,
    ),
    magic = useDavaq<Page<CatalogCard>>(
      "/tcg/catalog?game=magic&market=US&page=1",
      !homeGame,
    ),
    m = useDavaq<Page<Listing>>("/tcg/matches"),
    own = useDavaq<Page<Listing>>("/tcg/listings?mine=true"),
    catalog = useDavaq<Page<CatalogCard>>(
      "/tcg/catalog?game=" + homeGame + "&market=KR&page=1",
    );
  const featuredCards = React.useMemo(() => {
    const pools = [
      catalog.data?.items ?? [],
      onePiece.data?.items ?? [],
      yugioh.data?.items ?? [],
      magic.data?.items ?? [],
    ];
    return homeGame
      ? pools[0]
      : Array.from({ length: 3 }, (_, i) =>
          pools.flatMap((p) => (p[i] ? [p[i]] : [])),
        )
          .flat()
          .filter(
            (card, index, all) =>
              all.findIndex((value) => value.saveId === card.saveId) === index,
          );
  }, [
    homeGame,
    catalog.data?.items,
    onePiece.data?.items,
    yugioh.data?.items,
    magic.data?.items,
  ]);
  useEffect(() => {
    let active = true;
    preloadPublicCardImages(
      featuredCards.slice(0, 4).map((card) => card.imageSrc),
      () =>
        active &&
        (Platform.OS === "web"
          ? typeof document !== "undefined" &&
            document.visibilityState === "visible" &&
            navigator.onLine !== false
          : AppState.currentState === "active"),
    );
    return () => {
      active = false;
    };
  }, [featuredCards]);
  return (
    <Frame
      title="DAVAQ"
      right={
        <Button
          secondary
          small
          label="알림"
          icon="bell"
          onPress={() => r.push("/tcg/notifications" as any)}
        />
      }
      onRefresh={() => {
        void Promise.allSettled([
          m.refetch(),
          own.refetch(),
          catalog.refetch(),
          publicListings.refetch(),
          ...(!homeGame
            ? [onePiece.refetch(), yugioh.refetch(), magic.refetch()]
            : []),
        ]);
      }}
    >
      <View style={S.row}>
        <Chip label="추천" active />
        <Chip label="내 매칭" onPress={() => r.push("/(tabs)/exchanges")} />
        <Chip label="교환 장터" onPress={() => r.push("/(tabs)/search")} />
      </View>
      <View style={{ paddingVertical: 12, gap: 12 }}>
        <Txt size={12} bold color={C.muted}>
          COLLECT. CONNECT. EXCHANGE.
        </Txt>
        <Txt size={28} bold>
          내 카드로, 갖고 싶던 카드를.
        </Txt>
        <Txt size={14} color={C.muted}>
          보유 카드와 희망 카드가 만나는 카드 교환
        </Txt>
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            gap: 12,
            paddingVertical: 8,
          }}
        >
          {featuredCards.slice(0, 2).map((c, i) => (
            <React.Fragment key={c.saveId}>
              {i === 1 && <Icon name="repeat" size={22} />}
              <View
                style={{
                  flex: 1,
                  backgroundColor: "transparent",
                  borderRadius: 8,
                  padding: 0,
                }}
              >
                <CardArt src={c.imageSrc} large catalog priority="high" />
              </View>
            </React.Fragment>
          ))}
        </View>
        <Button
          label="교환 피드 둘러보기"
          onPress={() => r.push("/(tabs)/search")}
        />
        <Button
          secondary
          label="내 카드 등록하기"
          onPress={() => r.push("/tcg/catalog" as any)}
        />
      </View>
      <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
        {[
          ["보유 카드", "layers", "/(tabs)/exchanges"],
          ["희망 카드", "heart", "/(tabs)/exchanges"],
          [
            Platform.OS === "web" ? "카드 검색" : "스캔 등록",
            Platform.OS === "web" ? "search" : "maximize",
            Platform.OS === "web" ? "/tcg/catalog" : "/tcg/live-scan",
          ],
          ["교환 지도", "map", "/tcg/market?view=map"],
        ].map(([label, icon, path]) => (
          <Pressable
            key={label}
            accessibilityRole="button"
            onPress={() => r.push(path as any)}
            style={{ alignItems: "center", gap: 8, padding: 8 }}
          >
            <View
              style={{ padding: 16, borderRadius: 40, backgroundColor: C.soft }}
            >
              <Icon name={icon} />
            </View>
            <Txt size={12}>{label}</Txt>
          </Pressable>
        ))}
      </View>
      <Section title="서로 원하는 카드가 있어요" />
      <QueryState query={m} />
      {m.data?.items.map((l) => {
        const offer = own.data?.items.find(
          (v) =>
            v.mode !== "sale" &&
            l.wanted_card_ids.includes(v.card_id) &&
            v.wanted_card_ids.includes(l.card_id),
        );
        return offer ? (
          <View key={l.id} style={S.card}>
            <View style={[S.row, { justifyContent: "space-around" }]}>
              <View style={{ flex: 1, alignItems: "center", gap: 6 }}>
                <CollectionCardArt card={offer} large={false} />
                <Txt bold size={13}>
                  내가 줄 카드
                </Txt>
                <Txt size={12} lines={2}>
                  {offer.card_name}
                </Txt>
              </View>
              <Icon name="repeat" size={28} />
              <View style={{ flex: 1, alignItems: "center", gap: 6 }}>
                <CollectionCardArt card={l} large={false} />
                <Txt bold size={13}>
                  내가 받을 카드
                </Txt>
                <Txt size={12} lines={2}>
                  {l.card_name}
                </Txt>
              </View>
            </View>
            <Txt size={12} color={C.muted}>
              상대도 내 카드를 찾고 있어요
            </Txt>
            <Button
              label="교환 제안하기"
              onPress={() => r.push(("/tcg/listing/" + l.id) as any)}
            />
          </View>
        ) : (
          <ListingRow key={l.id} listing={l} />
        );
      })}
      {m.isSuccess && !m.data?.items.length && (
        <Empty
          title="첫 교환을 준비해 볼까요?"
          body="보유 카드와 희망 카드를 등록하면 서로 조건이 맞는 교환 후보를 알려드려요."
          action="희망 카드 등록"
          onPress={() => r.push("/tcg/catalog" as any)}
        />
      )}
      <Section
        title="지금 교환할 수 있는 카드"
        action="교환 장터"
        onPress={() => r.push("/(tabs)/search")}
      />
      <QueryState query={publicListings} />
      <View style={S.grid}>
        {publicListings.data?.items.slice(0, 6).map((l) => (
          <View key={l.id} style={{ width: "48%" }}>
            <ListingRow listing={l} />
          </View>
        ))}
      </View>
      {publicListings.isSuccess && !publicListings.data?.items.length && (
        <Notice>
          아직 등록된 교환 매물이 없어요. 첫 교환 카드를 등록해 보세요.
        </Notice>
      )}
      <Section
        title="TCG 카드 둘러보기"
        action="카드 검색"
        onPress={() => r.push("/tcg/catalog" as any)}
      />
      <Txt size={12} color={C.muted}>
        아래는 카드 정보입니다. 실제 교환 매물은 위 교환 장터에서 확인하세요.
      </Txt>
      <View style={S.wrap}>
        {[
          ["", "전체"],
          ["pokemon", "포켓몬"],
          ["one_piece", "원피스"],
          ["yugioh", "유희왕"],
          ["magic", "매직"],
          ["riftbound", "리프트바운드"],
        ].map(([code, label]) => (
          <Chip
            key={code}
            label={label}
            active={homeGame === code}
            onPress={() => setHomeGame(code)}
          />
        ))}
      </View>
      <QueryState query={catalog} />
      <View style={S.grid}>
        {featuredCards
          .filter(
            (c) =>
              !featuredCards
                .slice(0, 2)
                .some((hero) => hero.saveId === c.saveId),
          )
          .slice(0, 8)
          .map((c) => (
            <View key={c.saveId} style={{ width: "48%" }}>
              <CatalogRow card={c} />
            </View>
          ))}
      </View>
    </Frame>
  );
}
export function MarketScreen() {
  const { cardId, view } = useLocalSearchParams<{
    cardId: string;
    view: string;
  }>();
  const [mapView, setMapView] = useState(view === "map");
  const [q, setQ] = useState(""),
    [search, setSearch] = useState(""),
    [offset, setOffset] = useState(0),
    query = useDavaq<Page<Listing>>(
      "/tcg/listings?q=" +
        encodeURIComponent(search) +
        "&offset=" +
        offset +
        (cardId ? "&cardId=" + encodeURIComponent(cardId) : ""),
    );
  return (
    <Frame
      back={!!view}
      title="교환 장터"
      subtitle="내 카드와 상대의 희망 카드를 연결해요"
      onRefresh={() => void query.refetch()}
    >
      <Field
        label="매물 검색"
        value={q}
        onChangeText={setQ}
        placeholder="찾는 카드 이름"
        onSubmitEditing={() => {
          setSearch(q);
          setOffset(0);
        }}
      />
      <Button
        label="검색"
        onPress={() => {
          setSearch(q);
          setOffset(0);
        }}
      />
      <View style={S.row}>
        <Chip
          label="목록"
          active={!mapView}
          onPress={() => setMapView(false)}
        />
        <Chip label="지도" active={mapView} onPress={() => setMapView(true)} />
      </View>
      {mapView ? (
        <ExchangeMap search={search} />
      ) : (
        <>
          <QueryState query={query} />
          <View style={S.grid}>
            {query.data?.items.map((l) => (
              <View key={l.id} style={{ width: "48%" }}>
                <ListingRow listing={l} />
              </View>
            ))}
          </View>
          {query.isSuccess && !query.data?.items.length && (
            <Empty
              title="등록된 매물이 없어요"
              body="내 컬렉션에서 거래 가능한 카드를 등록해 주세요."
            />
          )}
          <View style={S.row}>
            {offset > 0 && (
              <Button
                secondary
                label="이전"
                onPress={() => setOffset(Math.max(0, offset - 50))}
              />
            )}{" "}
            {query.data?.items.length === 50 && (
              <Button label="다음" onPress={() => setOffset(offset + 50)} />
            )}
          </View>
        </>
      )}
    </Frame>
  );
}
export function RegisterScreen() {
  const params = useLocalSearchParams<{
    publish?: string;
    offerListing?: string;
  }>();
  const offerListing = registrationId(params.offerListing);
  const publish = params.publish === "1" || !!offerListing;
  const r = useRouter(),
    [q, setQ] = useState(""),
    [search, setSearch] = useState(""),
    [game, setGame] = useState("pokemon"),
    [market, setMarket] = useState("KR"),
    [page, setPage] = useState(1),
    query = useDavaq<
      Page<CatalogCard> & {
        pages: number;
        games: { code: string; label: string }[];
      }
    >(
      "/tcg/catalog?q=" +
        encodeURIComponent(search) +
        "&game=" +
        game +
        "&market=" +
        market +
        "&page=" +
        page,
    );
  return (
    <Frame
      title="카드 찾기·등록"
      subtitle="TCGIndex의 최신 카드 정보를 사용해요"
    >
      {publish && (
        <Notice>
          1/2 · 보유 카드 등록 → 2/2 · 교환·나눔 공개. 카드를 고르면 사진과
          상태를 등록한 뒤 바로 이어집니다.
        </Notice>
      )}
      <View style={S.row}>
        {["KR", "US", "EU"].map((v) => (
          <Chip
            key={v}
            label={
              { KR: "한국 자료", US: "미국 자료", EU: "유럽 자료" }[v] ?? v
            }
            active={market === v}
            onPress={() => {
              setMarket(v);
              setPage(1);
            }}
          />
        ))}
      </View>
      <View style={S.wrap}>
        {(
          query.data?.games ?? [
            { code: "pokemon", label: "포켓몬" },
            { code: "one_piece", label: "원피스" },
            { code: "magic", label: "매직" },
          ]
        ).map((v) => (
          <Chip
            key={v.code}
            label={v.label}
            active={game === v.code}
            onPress={() => {
              setGame(v.code);
              setPage(1);
            }}
          />
        ))}
      </View>
      <Field
        label="카드 이름·번호·세트"
        value={q}
        onChangeText={setQ}
        onSubmitEditing={() => {
          setSearch(q);
          setPage(1);
        }}
      />
      <Button
        label="카드 검색"
        icon="search"
        onPress={() => {
          setSearch(q);
          setPage(1);
        }}
      />
      <View style={S.row}>
        {Platform.OS !== "web" && (
          <Button
            secondary
            label="카메라 스캔"
            icon="camera"
            onPress={() => r.push("/tcg/live-scan" as any)}
          />
        )}
        <Button
          secondary
          label="없는 카드 추가"
          onPress={() => r.push("/tcg/request" as any)}
        />
      </View>
      <QueryState query={query} />
      <View style={[S.wrap, { alignItems: "stretch" }]}>
        {query.data?.items
          .filter((c) => c.saveAllowed !== false)
          .map((c) => (
            <View key={c.id} style={{ width: "48%" }}>
              <CatalogRow
                card={c}
                onPress={
                  publish
                    ? () =>
                        r.push(
                          (cardLink(c.saveId, c.title) +
                            "&publish=1" +
                            (offerListing
                              ? "&offerListing=" +
                                encodeURIComponent(offerListing)
                              : "")) as any,
                        )
                    : undefined
                }
              />
            </View>
          ))}
      </View>
      {query.isSuccess && !query.data?.items.length && (
        <Empty
          title="찾는 카드가 없나요?"
          body="언어·세트·번호를 바꿔 검색하거나 카드 추가를 요청해 주세요."
        />
      )}
      <View style={S.row}>
        {page > 1 && (
          <Button secondary label="이전" onPress={() => setPage(page - 1)} />
        )}{" "}
        {page < (query.data?.pages ?? 1) && (
          <Button label="다음" onPress={() => setPage(page + 1)} />
        )}
      </View>
    </Frame>
  );
}
export function CollectionScreen() {
  const { registered } = useLocalSearchParams<{ registered?: string }>();
  const registeredId = registrationId(registered);
  const r = useRouter(),
    [tab, setTab] = useState("owned"),
    [registeredNotice, setRegisteredNotice] = useState(false),
    owned = useDavaq<Page<Owned>>("/tcg/collection"),
    wants = useDavaq<Page<Want>>("/tcg/wants"),
    list = useDavaq<Page<Listing>>("/tcg/listings?mine=true"),
    trades = useDavaq<Page<Trade>>("/tcg/trades"),
    a = useAction();
  useEffect(() => {
    if (!registeredId) return;
    setTab("owned");
    setRegisteredNotice(true);
    const timer = setTimeout(() => setRegisteredNotice(false), 3500);
    return () => clearTimeout(timer);
  }, [registeredId]);
  return (
    <Frame title="내 컬렉션" footer={<Button secondary label="설정" icon="settings" onPress={() => r.push("/settings")} />} >
      {registeredNotice && (
        <Notice>
          보유 카드에 등록했습니다. 교환·나눔으로 공개하려면 카드의 교환 등록을
          눌러 주세요.
        </Notice>
      )}
      <View style={S.wrap}>
        {[
          ["owned", "보유"],
          ["want", "희망"],
          ["listing", "내 매물"],
          ["trade", "거래 기록"],
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
        label="카드 추가"
        icon="plus"
        onPress={() => r.push("/tcg/catalog" as any)}
      />
      {a.feedback}
      {tab === "owned" && (
        <>
          <QueryState query={owned} />
          <View style={[S.wrap, { alignItems: "stretch" }]}>
            {" "}
            {owned.data?.items.map((c) => (
              <View key={c.id} style={[S.card, { width: "48%", padding: 10 }]}>
                <Pressable
                  onPress={() => r.push(cardLink(c.card_id, c.card_name))}
                  style={{ gap: 10 }}
                >
                  <CollectionCardArt card={c} />
                  <View style={{ flex: 1 }}>
                    <Txt bold>{c.card_name}</Txt>
                    <Txt size={12}>
                      {conditionName(c.condition)} · {c.quantity}장 · 예약{" "}
                      {c.reserved}장
                    </Txt>
                    <Txt size={12} color={C.muted}>
                      {c.folder} {c.note}
                    </Txt>
                  </View>
                </Pressable>
                <View style={S.row}>
                  <Button
                    small
                    secondary
                    label="관리"
                    onPress={() => r.push(("/tcg/manage?id=" + c.id) as any)}
                  />
                  {!c.listing_id && c.quantity > c.reserved && (
                    <Button
                      small
                      label="교환 등록"
                      onPress={() =>
                        r.push(("/tcg/sell?collection=" + c.id) as any)
                      }
                    />
                  )}
                </View>
              </View>
            ))}
          </View>
        </>
      )}
      {tab === "want" && (
        <>
          <QueryState query={wants} />
          {wants.data?.items.map((w) => (
            <View style={S.card} key={w.id}>
              <Pressable
                onPress={() => r.push(cardLink(w.card_id, w.card_name))}
              >
                <CollectionCardArt card={w} large={false} />
                <Txt bold>{w.card_name}</Txt>
                <Txt size={12}>
                  {w.quantity}장 · {w.conditions.join(" / ")} ·{" "}
                  {w.mode === "buy"
                    ? "구매"
                    : w.mode === "swap"
                      ? "교환"
                      : "구매·교환"}
                </Txt>
                <Txt size={12}>
                  최대 {w.max_price == null ? "가격 협의" : money(w.max_price)}
                </Txt>
              </Pressable>
              <Button
                small
                secondary
                label="희망 해제"
                onPress={() =>
                  void a.run("/tcg/wants/" + w.id, undefined, "DELETE")
                }
              />
            </View>
          ))}
        </>
      )}
      {tab === "listing" && (
        <>
          <QueryState query={list} />
          {list.data?.items.map((l) => (
            <ListingRow key={l.id} listing={l} />
          ))}
        </>
      )}
      {tab === "trade" && (
        <>
          <QueryState query={trades} />
          {trades.data?.items.map((t) => (
            <TradeRow key={t.id} trade={t} />
          ))}
        </>
      )}
      {((tab === "owned" && owned.data?.items.length === 0) ||
        (tab === "want" && wants.data?.items.length === 0) ||
        (tab === "listing" && list.data?.items.length === 0) ||
        (tab === "trade" && trades.data?.items.length === 0)) && (
        <Empty
          title="아직 등록된 기록이 없어요"
          body="카드 검색으로 첫 카드를 등록해 보세요."
        />
      )}
    </Frame>
  );
}
export function CardDetailScreen() {
  const consent = useUgcConsent(useGetMe().data?.id ?? null);
  const params = useLocalSearchParams<{
    id: string;
    name: string;
    publish?: string;
    offerListing?: string;
  }>();
  const { id, name } = params;
  const offerListing = registrationId(params.offerListing);
  const publish = params.publish === "1" || !!offerListing;
  const client = useQueryClient();
  const { userId } = useAuth();
  const [saving, setSaving] = useState(false);
  const r = useRouter(),
    query = useDavaq<Detail>(
      "/tcg/catalog/detail?id=" +
        encodeURIComponent(id ?? "") +
        "&name=" +
        encodeURIComponent(name ?? ""),
    ),
    d = query.data?.target,
    [mode, setMode] = useState("owned"),
    [quantity, setQuantity] = useState("1"),
    [condition, setCondition] = useState("NM"),
    [allowed, setAllowed] = useState<string[]>(["NM", "LP"]),
    [photo, setPhoto] = useState<string[]>([]),
    [max, setMax] = useState(""),
    [folder, setFolder] = useState(""),
    [note, setNote] = useState(""),
    [wantMode, setWantMode] = useState("swap"),
    [region, setRegion] = useState(""),
    [delivery, setDelivery] = useState("either"),
    [requestKey, setRequestKey] = useState(key()),
    a = useAction();
  async function save() {
    if (!d || saving || a.busy) return;
    if (publish && mode === "owned" && !photo.length) {
      a.failure(
        new Error("교환·나눔에 사용할 실물 사진을 한 장 이상 추가해 주세요."),
      );
      return;
    }
    setSaving(true);
    try {
      if (!(await consent.ensureConsent())) return;
      const result = await a.run(
        mode === "owned" ? "/tcg/collection" : "/tcg/wants",
        mode === "owned"
          ? {
              cardId: id,
              cardName: d.name,
              quantity: Number(quantity),
              condition,
              photos: photo,
              folder,
              note,
              requestKey,
            }
          : {
              cardId: id,
              cardName: d.name,
              quantity: Number(quantity),
              conditions: allowed,
              maxPrice: max ? Number(max) : null,
              mode: wantMode,
              region,
              delivery,
            },
      );
      if (result) {
        if (mode === "owned") {
          if (!registrationId(result.id))
            throw new Error(
              "카드는 저장됐지만 등록 정보를 확인하지 못했습니다. 내 컬렉션에서 확인해 주세요.",
            );
          const collectionKey = ["davaq", userId, "/tcg/collection"];
          client.setQueryData<Page<Owned>>(collectionKey, (previous) =>
            withRegistrationItem(previous, result as Owned),
          );
          await client.invalidateQueries({
            queryKey: collectionKey,
            exact: true,
          });
          r.dismissTo(
            registrationOwnedHref(publish, offerListing, result.id) as any,
          );
          return;
        }
        a.success("희망 카드에 등록했습니다.");
        setRequestKey(key());
      }
    } catch (error) {
      a.failure(error);
    } finally {
      setSaving(false);
    }
  }
  return (
    <Frame back title="카드 상세">
      <QueryState query={query} />
      {d && (
        <>
          {publish && (
            <Notice>
              1/2 · 보유 카드 등록 → 2/2 · 교환·나눔 공개. 저장하면 이 카드로
              공개 설정을 이어갑니다.
            </Notice>
          )}
          <View style={[S.card, { borderWidth: 0, padding: 8, gap: 24 }]}>
            <View style={{ width: "100%", maxWidth: 320, alignSelf: "center" }}>
              <CardArt src={d.imageSrc} large catalog />
            </View>
            <View style={{ flex: 1 }}>
              <Txt bold size={20}>
                {d.name}
              </Txt>
              <Txt size={12}>
                {d.set} · {d.number}
              </Txt>
              <Txt size={12} color={C.muted}>
                {(
                  {
                    KR: "한국 시장",
                    US: "미국 시장",
                    EU: "유럽 시장",
                  } as Record<string, string>
                )[d.region] ?? d.region}
                {d.condition === "SOURCE_PRODUCT"
                  ? " · 상품별 참고 가격"
                  : CONDITIONS.some(([code]) => code === d.condition)
                    ? " · " + conditionName(d.condition)
                    : ""}
              </Txt>
              <Txt bold size={22}>
                {money(d.value, d.currency)}
              </Txt>
              <Txt size={11}>
                참고 가격 · {d.observedAt?.slice(0, 10) ?? "관측일 미확인"}
              </Txt>
            </View>
          </View>
          <Notice>
            언어·세트·번호·판본이 내 카드와 일치하는지 확인해 주세요. 참고
            이미지는 실물 상태를 나타내지 않습니다.
          </Notice>
          <Section title="내 목록에 등록" />
          <View style={S.row}>
            <Chip
              label="보유 카드"
              active={mode === "owned"}
              onPress={() => setMode("owned")}
            />
            {!publish && (
              <Chip
                label="갖고 싶은 카드"
                active={mode === "want"}
                onPress={() => setMode("want")}
              />
            )}
          </View>
          <Field
            label="수량"
            value={quantity}
            onChangeText={setQuantity}
            keyboardType="numeric"
          />
          {mode === "owned" ? (
            <>
              <View style={S.wrap}>
                {CONDITIONS.map(([v, l]) => (
                  <Chip
                    key={v}
                    label={v + " · " + l}
                    active={condition === v}
                    onPress={() => setCondition(v)}
                  />
                ))}
              </View>
              <Button
                secondary
                label={
                  photo.length
                    ? "실물 사진 " + photo.length + "장 · 추가"
                    : "실물 사진 추가"
                }
                onPress={async () => {
                  if (!(await consent.ensureConsent())) return;
                  void pickAndUploadImage().then(
                    (v) =>
                      v && setPhoto((p) => [...p, v.objectPath].slice(0, 8)),
                  );
                }}
              />
              <View style={S.wrap}>
                {photo.map((p) => (
                  <Pressable
                    key={p}
                    onPress={() => setPhoto((v) => v.filter((x) => x !== p))}
                  >
                    <CardArt src={p} />
                    <Txt size={11}>눌러서 제외</Txt>
                  </Pressable>
                ))}
              </View>
              <Field label="폴더" value={folder} onChangeText={setFolder} />
              <Field label="메모" value={note} onChangeText={setNote} />
            </>
          ) : (
            <>
              <Txt>허용하는 상태</Txt>
              <View style={S.wrap}>
                {CONDITIONS.map(([v, l]) => (
                  <Chip
                    key={v}
                    label={v + " · " + l}
                    active={allowed.includes(v)}
                    onPress={() =>
                      setAllowed((p) =>
                        p.includes(v) ? p.filter((x) => x !== v) : [...p, v],
                      )
                    }
                  />
                ))}
              </View>
              <Field
                label="참고 가치 상한 (원·선택)"
                value={max}
                onChangeText={setMax}
                keyboardType="numeric"
              />
              <View style={S.wrap}>
                {[
                  ["swap", "교환"],
                  ["either", "둘 다"],
                ].map(([v, l]) => (
                  <Chip
                    key={v}
                    label={l}
                    active={wantMode === v}
                    onPress={() => setWantMode(v)}
                  />
                ))}
              </View>
              <Field
                label="거래 지역 (선택)"
                value={region}
                onChangeText={setRegion}
              />
              <Delivery value={delivery} onChange={setDelivery} />
            </>
          )}
          <Button
            label={
              mode === "owned"
                ? publish
                  ? "등록하고 공개 설정하기"
                  : "보유 카드 등록"
                : "희망 카드 등록·수정"
            }
            busy={a.busy || saving}
            onPress={() => void save()}
          />
          {a.feedback}
          <Button
            secondary
            label="이 카드의 거래 매물 보기"
            onPress={() => {
              r.push(("/tcg/market?cardId=" + encodeURIComponent(id)) as any);
            }}
          />
          <PricePanel detail={query.data!} />
        </>
      )}
      <UgcConsentPrompt {...consent.promptProps} />
    </Frame>
  );
}
function Delivery({
  value,
  onChange,
}: {
  value: string;
  onChange: (s: string) => void;
}) {
  return (
    <View style={S.wrap}>
      {[
        ["meet", "직거래"],
        ["ship", "배송"],
        ["either", "둘 다"],
      ].map(([v, l]) => (
        <Chip
          key={v}
          label={l}
          active={value === v}
          onPress={() => onChange(v)}
        />
      ))}
    </View>
  );
}
function PricePanel({ detail }: { detail: Detail }) {
  const d = detail.target,
    [amount, setAmount] = useState(""),
    [direction, setDirection] = useState("below"),
    a = useAction();
  return (
    <>
      <Section title="가격 추이·알림" />
      {detail.history.length ? (
        <PriceChart detail={detail} />
      ) : (
        <Txt size={13} color={C.muted}>
          이 판본의 가격 이력 자료가 없습니다.
        </Txt>
      )}
      <Field
        label={"가격 조건 (" + d.currency + ")"}
        value={amount}
        onChangeText={setAmount}
        keyboardType="numeric"
      />
      <View style={S.row}>
        <Chip
          label="이하"
          active={direction === "below"}
          onPress={() => setDirection("below")}
        />
        <Chip
          label="이상"
          active={direction === "above"}
          onPress={() => setDirection("above")}
        />
      </View>
      <Button
        secondary
        label="가격 알림 설정"
        busy={a.busy}
        onPress={() =>
          void a
            .run("/tcg/price-alerts", {
              cardId: d.id,
              cardName: d.name,
              amount: Number(amount),
              direction,
              currency: d.currency,
            })
            .then((v) => v && a.success("가격 알림을 설정했습니다."))
        }
      />
      {a.feedback}
    </>
  );
}
export function TradeRow({ trade: t }: { trade: Trade }) {
  const r = useRouter();
  return (
    <Pressable
      style={S.card}
      onPress={() => r.push(("/tcg/trade/" + t.id) as any)}
    >
      <Txt size={12} color={C.purple}>
        {statusName(t.status)} ·{" "}
        {t.kind === "gift" ? "무료 나눔" : t.kind === "buy" ? "구매" : "교환"}
      </Txt>
      <CollectionCardArt card={t.snapshot.target} large={false} />
      <Txt bold>
        {t.snapshot.target.card_name} · {t.quantity}장
      </Txt>
      {t.snapshot.offered && (
        <Txt size={13}>
          ↔ {t.snapshot.offered.card_name} · {t.offered_quantity}장
        </Txt>
      )}
      {t.kind !== "gift" && (t.kind === "buy" || t.cash > 0) && (
        <Txt size={13}>
          {money(t.cash)} {t.kind === "swap" ? "차액" : ""}
        </Txt>
      )}
    </Pressable>
  );
}
export function ManageScreen() {
  const consent = useUgcConsent(useGetMe().data?.id ?? null);
  const {
    id,
    publish,
    offerListing: returnOffer,
  } = useLocalSearchParams<{
    id: string;
    publish?: string;
    offerListing?: string;
  }>();
  const offerListing = registrationId(returnOffer),
    returnToPublish = publish === "1";
  const client = useQueryClient(),
    { userId } = useAuth(),
    r = useRouter();
  const [saving, setSaving] = useState(false);
  const query = useDavaq<Page<Owned>>("/tcg/collection"),
    c = query.data?.items.find((v) => v.id === id),
    [quantity, setQuantity] = useState(""),
    [cond, setCond] = useState("NM"),
    [purchase, setPurchase] = useState(""),
    [folder, setFolder] = useState(""),
    [note, setNote] = useState(""),
    [photos, setPhotos] = useState<string[]>([]),
    a = useAction();
  useEffect(() => {
    if (c) {
      setQuantity(String(c.quantity));
      setCond(c.condition);
      setPurchase(c.purchase_price == null ? "" : String(c.purchase_price));
      setFolder(c.folder);
      setNote(c.note);
      setPhotos(c.photos);
    }
  }, [c?.id]);
  async function save() {
    if (!c || saving || a.busy) return;
    if (returnToPublish && !photos.length) {
      a.failure(
        new Error("공개할 카드의 실물 사진을 한 장 이상 추가해 주세요."),
      );
      return;
    }
    setSaving(true);
    try {
      if (!(await consent.ensureConsent())) return;
      const result = await a.run(
        "/tcg/collection/" + id,
        {
          quantity: Number(quantity),
          condition: cond,
          purchasePrice: purchase ? Number(purchase) : null,
          folder,
          note,
          photos,
        },
        "PATCH",
      );
      if (!result) return;
      if (returnToPublish) {
        const collectionKey = ["davaq", userId, "/tcg/collection"];
        client.setQueryData<Page<Owned>>(collectionKey, (previous) =>
          withRegistrationItem(previous, { ...c, ...result, id: c.id, photos }),
        );
        await client.invalidateQueries({
          queryKey: collectionKey,
          exact: true,
        });
        r.dismissTo(registrationOwnedHref(true, offerListing, c.id) as any);
      } else a.success("보유 카드 정보를 저장했습니다.");
    } catch (error) {
      a.failure(error);
    } finally {
      setSaving(false);
    }
  }
  return (
    <Frame back title="보유 카드 관리">
      <QueryState query={query} />
      {c && (
        <>
          <Txt bold>{c.card_name}</Txt>
          <Field
            label="보유 수량"
            value={quantity}
            onChangeText={setQuantity}
            keyboardType="numeric"
          />
          <View style={S.wrap}>
            {CONDITIONS.map(([v, l]) => (
              <Chip
                key={v}
                label={v + " · " + l}
                active={cond === v}
                onPress={() => setCond(v)}
              />
            ))}
          </View>
          <Field
            label="한 장당 구입가 (원)"
            value={purchase}
            onChangeText={setPurchase}
            keyboardType="numeric"
          />
          <Field label="폴더" value={folder} onChangeText={setFolder} />
          <Field label="메모" value={note} onChangeText={setNote} />
          <View style={S.wrap}>
            {photos.map((p) => (
              <Pressable
                key={p}
                onPress={() => setPhotos((v) => v.filter((x) => x !== p))}
              >
                <CardArt src={p} />
                <Txt size={11}>눌러서 제외</Txt>
              </Pressable>
            ))}
          </View>
          <Button
            secondary
            label="실물 사진 추가"
            onPress={async () => {
              if (!(await consent.ensureConsent())) return;
              void pickAndUploadImage().then(
                (v) => v && setPhotos((p) => [...p, v.objectPath].slice(0, 8)),
              );
            }}
          />
          <Button
            secondary
            label="보유 목록에서 제거"
            busy={a.busy}
            onPress={() =>
              void a
                .run("/tcg/collection/" + id, undefined, "DELETE")
                .then(
                  (v) => v !== null && a.success("보유 목록에서 제거했습니다."),
                )
            }
          />
          <Button
            label={returnToPublish ? "저장하고 공개 설정 계속하기" : "저장"}
            busy={a.busy || saving}
            onPress={() => void save()}
          />
          {a.feedback}
        </>
      )}
      <UgcConsentPrompt {...consent.promptProps} />
    </Frame>
  );
}
export function SellScreen() {
  const consent = useUgcConsent(useGetMe().data?.id ?? null);
  const params = useLocalSearchParams<{
    collection?: string;
    offerListing?: string;
  }>();
  const collection = registrationId(params.collection);
  const offerListing = registrationId(params.offerListing);
  const client = useQueryClient();
  const { userId } = useAuth();
  const [publishing, setPublishing] = useState(false);
  const query = useDavaq<Page<Owned>>("/tcg/collection"),
    c = query.data?.items.find((v) => v.id === collection),
    wants = useDavaq<Page<Want>>("/tcg/wants"),
    [choice, setChoice] = useState<"direct" | "offers" | "gift">("offers"),
    [quantity, setQuantity] = useState("1"),
    [wanted, setWanted] = useState<string[]>([]),
    [mapPoint, setMapPoint] = useState<Coordinate | null>(null),
    [region, setRegion] = useState(""),
    [delivery, setDelivery] = useState("meet"),
    [description, setDescription] = useState(""),
    requestKey = React.useMemo(() => key(), [collection]),
    a = useAction(),
    r = useRouter();
  const mode = choice === "gift" ? "gift" : "swap";
  useEffect(() => {
    if (offerListing && choice === "gift") setChoice("offers");
  }, [offerListing, choice]);
  const available = c ? Math.max(0, c.quantity - c.reserved) : 0;
  const unlistedCards =
    query.data?.items.filter((v) => !v.listing_id && v.quantity > v.reserved) ??
    [];
  const listedCards = query.data?.items.filter((v) => !!v.listing_id) ?? [];
  const submit = async () => {
    if (publishing || a.busy) return;
    if (offerListing && choice === "gift") {
      a.failure(
        new Error("교환 제안에 사용할 카드는 교환 방식으로 공개해 주세요."),
      );
      return;
    }
    if (c?.listing_id) {
      a.failure(
        new Error(
          "이미 공개 중인 카드입니다. 기존 거래 카드에서 확인해 주세요.",
        ),
      );
      return;
    }
    const count = Number(quantity);
    if (!c || !Number.isInteger(count) || count < 1 || count > available) {
      a.failure(new Error("거래 가능한 수량 안에서 1장 이상 입력해 주세요."));
      return;
    }
    if (!c.photos.length) {
      a.failure(
        new Error("보유 카드 관리에서 실물 사진을 한 장 이상 추가해 주세요."),
      );
      return;
    }
    if (choice === "direct" && !wanted.length) {
      a.failure(new Error("바로 교환으로 받고 싶은 카드를 선택해 주세요."));
      return;
    }
    setPublishing(true);
    try {
      if (!(await consent.ensureConsent())) return;
      const result = await a.run("/tcg/listings", {
        collectionId: c.id,
        quantity: count,
        mode,
        price: null,
        wantedCardIds: choice === "direct" ? wanted : [],
        mapPoint: delivery === "ship" ? null : mapPoint,
        region,
        delivery,
        description,
        requestKey,
      });
      if (!result) return;
      if (!registrationId(result.id))
        throw new Error(
          "공개 정보를 확인하지 못했습니다. 내 거래 카드에서 확인해 주세요.",
        );
      const listing: Listing = {
        ...result,
        card_id: c.card_id,
        card_name: c.card_name,
        condition: c.condition,
        photos: c.photos,
        owner_name: "나",
        available: Math.min(count, available),
        wanted_card_names: (wants.data?.items ?? [])
          .filter((w) => wanted.includes(w.card_id))
          .map((w) => w.card_name),
      };
      const collectionKey = ["davaq", userId, "/tcg/collection"];
      const listingKey = ["davaq", userId, "/tcg/listings?mine=true"];
      client.setQueryData<Page<Owned>>(collectionKey, (previous) =>
        withRegistrationItem(previous, { ...c, listing_id: result.id }),
      );
      client.setQueryData<Page<Listing>>(listingKey, (previous) =>
        withRegistrationItem(previous, listing),
      );
      client.setQueryData(
        ["davaq", userId, "/tcg/listings/" + result.id],
        listing,
      );
      await Promise.all([
        client.invalidateQueries({ queryKey: collectionKey, exact: true }),
        client.invalidateQueries({ queryKey: listingKey, exact: true }),
      ]);
      r.dismissTo(registrationReturnHref(offerListing, result.id) as any);
    } catch (error) {
      a.failure(error);
    } finally {
      setPublishing(false);
    }
  };
  return (
    <Frame back title="내 카드 올리기">
      <Notice>
        {collection
          ? "2/2 · 교환·나눔 공개. 공개를 마치면 " +
            (offerListing
              ? "원래 카드의 교환 제안으로 돌아갑니다."
              : "교환 피드에서 바로 확인할 수 있어요.")
          : "보유 카드 등록 → 교환·나눔 공개. 이미 등록한 카드는 선택해서 이어가세요."}
      </Notice>
      <QueryState query={query} />
      {!collection && query.data && (
        <>
          <Txt bold size={20}>
            어떤 카드를 올릴까요?
          </Txt>
          <Txt color={C.muted}>내 보유 카드에서 선택해 주세요.</Txt>
          {unlistedCards.map((v) => (
            <Pressable
              key={v.id}
              accessibilityRole="button"
              accessibilityLabel={v.card_name + " 거래 등록"}
              style={[S.card, S.row]}
              onPress={() =>
                r.replace(
                  registrationOwnedHref(true, offerListing, v.id) as any,
                )
              }
            >
              <CollectionCardArt card={v} large={false} />
              <View style={{ flex: 1, gap: 6 }}>
                <Txt bold>{v.card_name}</Txt>
                <Txt size={13} color={C.muted}>
                  {conditionName(v.condition)} · {v.quantity - v.reserved}장
                </Txt>
              </View>
              <Icon name="chevron-right" />
            </Pressable>
          ))}
          {!unlistedCards.length && (
            <Empty
              title={
                listedCards.length
                  ? "다른 카드를 올려 보세요"
                  : "먼저 내 카드를 등록해 주세요"
              }
              body={
                listedCards.length
                  ? "이미 공개 중인 카드는 아래에서 확인할 수 있어요. 새 카드를 등록해 교환이나 나눔을 시작하세요."
                  : "카드를 찾아 사진과 상태를 추가하면 교환이나 나눔을 시작할 수 있어요."
              }
            />
          )}
          {!!listedCards.length && <Section title="이미 공개 중인 카드" />}
          {listedCards.map((v) => (
            <View key={v.id} style={S.card}>
              <View style={S.row}>
                <CollectionCardArt card={v} large={false} />
                <View style={{ flex: 1, gap: 6 }}>
                  <Txt bold>{v.card_name}</Txt>
                  <Txt size={13} color={C.purple}>
                    이미 공개 중
                  </Txt>
                </View>
              </View>
              <View style={S.wrap}>
                <Button
                  secondary
                  small
                  label={
                    offerListing
                      ? "이 카드로 교환 제안하기"
                      : "기존 거래 카드 보기"
                  }
                  onPress={() =>
                    offerListing
                      ? r.dismissTo(
                          registrationReturnHref(
                            offerListing,
                            v.listing_id,
                          ) as any,
                        )
                      : r.push(("/tcg/listing/" + v.listing_id) as any)
                  }
                />
                <Button
                  secondary
                  small
                  label="보유 카드 관리"
                  onPress={() => r.push(("/tcg/manage?id=" + v.id) as any)}
                />
              </View>
            </View>
          ))}
          <Button
            secondary
            label="새 카드 등록하기"
            icon="plus"
            onPress={() => r.push(registrationCatalogHref(offerListing) as any)}
          />
        </>
      )}
      {collection && query.data && !c && (
        <Notice error>
          선택한 보유 카드를 찾지 못했습니다. 내 카드 목록에서 다시 선택해
          주세요.
        </Notice>
      )}
      {c && (
        <>
          <View style={[S.card, S.row]}>
            <CollectionCardArt card={c} large={false} />
            <View style={{ flex: 1, gap: 8 }}>
              <Txt bold size={20}>
                {c.card_name}
              </Txt>
              <Txt>
                거래 가능 {available}장 · {conditionName(c.condition)}
              </Txt>
              <Button
                secondary
                small
                label="사진·상태 확인"
                onPress={() =>
                  r.push(
                    ("/tcg/manage?id=" +
                      c.id +
                      "&publish=1" +
                      (offerListing
                        ? "&offerListing=" + encodeURIComponent(offerListing)
                        : "")) as any,
                  )
                }
              />
            </View>
          </View>
          {c.listing_id && (
            <>
              <Notice>
                이미 공개 중인 카드입니다. 새로 등록하지 않고 기존 거래 카드에서
                확인해 주세요.
              </Notice>
              <Button
                secondary
                label={
                  offerListing
                    ? "이 카드로 교환 제안하기"
                    : "기존 거래 카드 보기"
                }
                onPress={() =>
                  offerListing
                    ? r.dismissTo(
                        registrationReturnHref(
                          offerListing,
                          c.listing_id,
                        ) as any,
                      )
                    : r.push(("/tcg/listing/" + c.listing_id) as any)
                }
              />
            </>
          )}
          {!c.listing_id && (
            <>
              <Txt bold>어떻게 나눌까요?</Txt>
              {(
                [
                  [
                    "direct",
                    "바로 교환",
                    "원하는 카드가 있어요. 그 카드를 가진 분의 교환 요청을 받아요.",
                  ],
                  [
                    "offers",
                    "제안 받기",
                    "어떤 카드든 좋아요. 받은 제안을 보고 직접 결정해요.",
                  ],
                  [
                    "gift",
                    "무료 나눔",
                    "카드 대가 없이 드려요. 배송비·전달 방법만 협의해요.",
                  ],
                ] as const
              )
                .filter(([value]) => !offerListing || value !== "gift")
                .map(([value, label, detail]) => (
                  <Pressable
                    key={value}
                    accessibilityRole="radio"
                    accessibilityState={{ checked: choice === value }}
                    onPress={() => setChoice(value)}
                    style={[
                      S.card,
                      {
                        borderWidth: 1.5,
                        borderColor: choice === value ? C.purple : C.line,
                        backgroundColor: choice === value ? C.soft : C.white,
                      },
                    ]}
                  >
                    <View style={[S.row, { justifyContent: "space-between" }]}>
                      <Txt bold color={choice === value ? C.purple : C.ink}>
                        {label}
                      </Txt>
                      <Icon
                        name={choice === value ? "check-circle" : "circle"}
                        size={20}
                        color={choice === value ? C.purple : C.muted}
                      />
                    </View>
                    <Txt size={13} color={C.muted}>
                      {detail}
                    </Txt>
                  </Pressable>
                ))}
              <Field
                label="올릴 수량"
                value={quantity}
                onChangeText={setQuantity}
                keyboardType="numeric"
              />
              {choice === "direct" && (
                <>
                  <Txt bold>교환으로 받고 싶은 카드</Txt>
                  <QueryState query={wants} />
                  <View style={S.wrap}>
                    {wants.data?.items.map((w) => (
                      <Chip
                        key={w.id}
                        label={w.card_name}
                        active={wanted.includes(w.card_id)}
                        onPress={() =>
                          setWanted((p) =>
                            p.includes(w.card_id)
                              ? p.filter((x) => x !== w.card_id)
                              : [...p, w.card_id],
                          )
                        }
                      />
                    ))}
                  </View>
                  <Button
                    secondary
                    small
                    label="원하는 카드 추가하기"
                    onPress={() => r.push("/tcg/catalog" as any)}
                  />
                </>
              )}
              <Field
                label="거래 지역"
                value={region}
                onChangeText={setRegion}
                placeholder="예: 서울 강남구"
              />
              <Delivery value={delivery} onChange={setDelivery} />
              {delivery !== "ship" && (
                <MapPicker value={mapPoint} onChange={setMapPoint} />
              )}
              <Field
                label="카드 상태·전달 방법"
                value={description}
                onChangeText={setDescription}
                placeholder={
                  choice === "gift"
                    ? "카드 상태와 배송비·전달 조건을 알려 주세요."
                    : "카드 상태와 거래 조건을 알려 주세요."
                }
                multiline
              />
              <Notice>
                실물 사진과 하자 설명을 확인해 주세요. 사진은 보유 카드 관리에서
                추가할 수 있어요.
              </Notice>
            </>
          )}
          <Button
            label={
              c.listing_id
                ? "이미 공개 중"
                : choice === "gift"
                  ? "나눔 카드 올리기"
                  : "교환 카드 올리기"
            }
            busy={a.busy || publishing}
            disabled={available < 1 || !!c.listing_id}
            onPress={() => void submit()}
          />
        </>
      )}
      {a.feedback}
      <UgcConsentPrompt {...consent.promptProps} />
    </Frame>
  );
}
export function ListingScreen() {
  const consent = useUgcConsent(useGetMe().data?.id ?? null);
  const { id, offer } = useLocalSearchParams<{ id: string; offer?: string }>(),
    query = useDavaq<Listing>("/tcg/listings/" + id),
    l = query.data,
    me = useGetMe(),
    own = useDavaq<Page<Listing>>("/tcg/listings?mine=true"),
    [quantity, setQuantity] = useState("1"),
    [offeredId, setOfferedId] = useState(offer ?? ""),
    [offeredQuantity, setOfferedQuantity] = useState("1"),
    [note, setNote] = useState(""),
    requestKey = React.useMemo(() => key(), [id]),
    [report, setReport] = useState(""),
    a = useAction(),
    r = useRouter();
  const isGift = l?.mode === "gift";
  const kind = isGift ? "gift" : l?.mode === "sale" ? "buy" : "swap";
  const ownCards =
    own.data?.items.filter(
      (v) =>
        (v.mode === "swap" || v.mode === "both") &&
        v.status === "active" &&
        v.available > 0 &&
        (!l?.wanted_card_ids.length || l.wanted_card_ids.includes(v.card_id)),
    ) ?? [];
  const offered = ownCards.find((v) => v.id === offeredId) ?? null;
  useEffect(() => {
    setOfferedId(offer ?? "");
    setQuantity("1");
    setOfferedQuantity("1");
    setNote("");
  }, [id, offer]);
  const submit = async () => {
    if (!l) return;
    const count = Number(quantity),
      offerCount = Number(offeredQuantity);
    if (
      l.status !== "active" ||
      !Number.isInteger(count) ||
      count < 1 ||
      count > l.available
    ) {
      a.failure(new Error("거래 가능한 수량 안에서 1장 이상 입력해 주세요."));
      return;
    }
    if (
      kind === "swap" &&
      (!offered ||
        !Number.isInteger(offerCount) ||
        offerCount < 1 ||
        offerCount > offered.available)
    ) {
      a.failure(new Error("내가 줄 카드와 거래 가능한 수량을 선택해 주세요."));
      return;
    }
    if (!(await consent.ensureConsent())) return;
    void a
      .run("/tcg/trades", {
        listingId: id,
        listingVersion: l.version,
        kind,
        quantity: count,
        ...(kind === "swap" && offered
          ? {
              offeredListingId: offered.id,
              offeredVersion: offered.version,
              offeredQuantity: offerCount,
            }
          : {}),
        cash: 0,
        note,
        requestKey,
      })
      .then((v) => v && r.push(("/tcg/trade/" + v.id) as any));
  };
  return (
    <Frame
      back
      title={isGift ? "나눔 카드" : "교환 카드"}
      onRefresh={() => {
        void query.refetch();
        void own.refetch();
      }}
    >
      <QueryState query={query} />
      {l && (
        <>
          <View style={S.card}>
            <Txt size={22} bold>
              {l.card_name}
            </Txt>
            <View style={S.wrap}>
              {l.photos.map((p) => (
                <CardArt key={p} src={p} />
              ))}
            </View>
            <Txt>
              {conditionName(l.condition)} · 거래 가능{" "}
              {Math.max(0, l.available)}장
            </Txt>
            <Txt bold size={22} color={C.purple}>
              {isGift
                ? "무료 나눔"
                : l.mode === "swap"
                  ? l.wanted_card_ids.length
                    ? "바로 교환"
                    : "제안 받는 중"
                  : money(l.price)}
            </Txt>
            {!!l.wanted_card_names?.length && (
              <Txt>원하는 카드: {l.wanted_card_names.join(", ")}</Txt>
            )}
            <Txt>
              {l.owner_name} · {l.region || "지역 협의"} ·{" "}
              {l.delivery === "meet"
                ? "직거래"
                : l.delivery === "ship"
                  ? "배송"
                  : "직거래·배송"}
            </Txt>
            {!!l.description && <Txt>{l.description}</Txt>}
            <Button
              secondary
              label="카드 정보 확인"
              onPress={() => r.push(cardLink(l.card_id, l.card_name))}
            />
          </View>
          {l.owner_id === me.data?.id ? (
            <Button
              secondary
              label="거래 카드 내리기"
              busy={a.busy}
              disabled={l.status !== "active"}
              onPress={() =>
                void a
                  .run("/tcg/listings/" + id, undefined, "DELETE")
                  .then((v) => {
                    if (v !== null) {
                      a.success("거래 카드를 내렸습니다.");
                      void query.refetch();
                    }
                  })
              }
            />
          ) : l.status !== "active" || l.available < 1 ? (
            <Notice>
              현재 거래할 수 없는 카드입니다. 다른 카드를 둘러보세요.
            </Notice>
          ) : (
            <>
              <Section title={isGift ? "나눔 신청" : "내 카드로 제안하기"} />
              {isGift && (
                <Notice>
                  대가로 줄 카드 없이 신청할 수 있어요. 상대가 수락하면 전달
                  방법을 함께 정해요.
                </Notice>
              )}
              <Field
                label={isGift ? "받고 싶은 수량" : "받을 수량"}
                value={quantity}
                onChangeText={setQuantity}
                keyboardType="numeric"
              />
              {kind === "swap" && (
                <>
                  <Txt bold>내가 줄 카드</Txt>
                  <QueryState query={own} />
                  <View style={S.wrap}>
                    {ownCards.map((v) => (
                      <Chip
                        key={v.id}
                        label={v.card_name}
                        active={offered?.id === v.id}
                        onPress={() => setOfferedId(v.id)}
                      />
                    ))}
                  </View>
                  {!own.isPending && !ownCards.length && (
                    <Notice>
                      {l.wanted_card_ids.length
                        ? "상대가 원하는 카드와 맞는 내 교환 카드가 아직 없어요. 해당 카드를 보유하고 있다면 먼저 올려 주세요."
                        : "교환으로 올린 카드가 아직 없어요. 내 보유 카드에서 먼저 한 장을 올려 주세요."}
                    </Notice>
                  )}
                  <Button
                    secondary
                    small
                    label={
                      ownCards.length
                        ? "다른 내 카드 올리기"
                        : "내 카드 선택·등록하기"
                    }
                    icon="plus"
                    onPress={() =>
                      r.push(
                        ("/tcg/sell" +
                          (registrationId(id)
                            ? "?offerListing=" + encodeURIComponent(id)
                            : "")) as any,
                      )
                    }
                  />
                  {offered && (
                    <View style={[S.card, S.row]}>
                      <CollectionCardArt card={offered} large={false} />
                      <View style={{ flex: 1, gap: 8 }}>
                        <Txt bold>{offered.card_name}</Txt>
                        <Txt size={13} color={C.muted}>
                          {conditionName(offered.condition)} ·{" "}
                          {offered.available}장 가능
                        </Txt>
                        <Field
                          label="내가 줄 수량"
                          value={offeredQuantity}
                          onChangeText={setOfferedQuantity}
                          keyboardType="numeric"
                        />
                      </View>
                    </View>
                  )}
                </>
              )}
              <Field
                label="한마디 (선택)"
                value={note}
                onChangeText={setNote}
                placeholder={
                  isGift
                    ? "필요한 이유나 가능한 전달 방법을 알려 주세요."
                    : "상대에게 전할 말을 남겨 주세요."
                }
                multiline
              />
              <Notice>
                상대가 수락하면 채팅에서 전달 방법을 정해요. 앱은 배송비나
                대금을 보관하지 않습니다.
              </Notice>
              <Button
                label={
                  isGift
                    ? "나눔 신청하기"
                    : l.wanted_card_ids.length
                      ? "교환 요청하기"
                      : "교환 제안 보내기"
                }
                busy={a.busy}
                disabled={kind === "swap" && !offered}
                onPress={submit}
              />
              <Field
                label="신고 사유"
                value={report}
                onChangeText={setReport}
              />
              <Button
                secondary
                small
                label="신고 접수"
                disabled={!report.trim()}
                onPress={() =>
                  void a
                    .run("/tcg/reports", { listingId: id, reason: report })
                    .then((v) => v && a.success("신고를 접수했습니다."))
                }
              />
            </>
          )}
          <ListingComments key={l.id} listingId={l.id} canComment={l.status === "active"} />
          {a.feedback}
        </>
      )}
      <UgcConsentPrompt {...consent.promptProps} />
    </Frame>
  );
}
export function TradeScreen() {
  const [revQty, setRevQty] = useState("1"),
    [revOffer, setRevOffer] = useState("1"),
    [revCash, setRevCash] = useState("0"),
    [revNote, setRevNote] = useState("");
  const { id } = useLocalSearchParams<{ id: string }>(),
    q = useDavaq<Trade>("/tcg/trades/" + id),
    t = q.data,
    a = useAction(),
    r = useRouter();
  useEffect(() => {
    if (t) {
      setRevQty(String(t.quantity));
      setRevOffer(String(t.offered_quantity || 1));
      setRevCash(String(t.cash));
      setRevNote(t.note);
    }
  }, [t?.id, t?.version]);
  const isGift = t?.kind === "gift";
  const canRevise = !!t && (!isGift || t.viewerId === t.buyer_id);
  const canAccept = !!t && (!isGift || t.viewerId === t.seller_id);
  const revise = () => {
    if (!t || !canRevise) return;
    const quantity = Number(revQty),
      offeredQuantity = Number(revOffer),
      cash = isGift ? 0 : Number(revCash);
    if (
      !Number.isInteger(quantity) ||
      quantity < 1 ||
      (t.kind === "swap" &&
        (!Number.isInteger(offeredQuantity) || offeredQuantity < 1)) ||
      !Number.isSafeInteger(cash) ||
      cash < 0 ||
      cash > 100000000
    ) {
      a.failure(
        new Error(
          isGift
            ? "받고 싶은 수량을 1장 이상 입력해 주세요."
            : "수량은 1장 이상, 금액은 0원부터 1억 원까지 입력해 주세요.",
        ),
      );
      return;
    }
    void a.run(
      "/tcg/trades/" + id,
      {
        version: t.version,
        quantity,
        ...(t.kind === "swap" ? { offeredQuantity } : {}),
        cash,
        note: revNote,
      },
      "PATCH",
    );
  };
  return (
    <Frame
      back
      title={isGift ? "나눔 진행" : "거래 진행"}
      onRefresh={() => void q.refetch()}
    >
      <QueryState query={q} />
      {t && (
        <>
          <TradeRow trade={t} />
          <Notice>
            {t.note ||
              (isGift
                ? "전달 장소·시간과 배송비를 채팅에서 합의하세요."
                : "장소·시간·결제 방법을 채팅에서 합의하세요.")}
          </Notice>
          <Button
            label={isGift ? "나눔 채팅" : "거래 채팅"}
            icon="message-circle"
            onPress={() => r.push(("/chat/" + t.room_id) as any)}
          />
          <Txt size={12}>
            동의: {t.actions?.filter((v) => v.kind === "accept").length ?? 0}/2
            · 전달: {t.actions?.filter((v) => v.kind === "sent").length ?? 0} ·
            수령: {t.actions?.filter((v) => v.kind === "received").length ?? 0}
          </Txt>
          {t.status === "proposed" && (
            <>
              {canRevise && (
                <>
                  <Section
                    title={isGift ? "나눔 신청 수정" : "제안 조건 수정"}
                  />
                  <Field
                    label={isGift ? "받고 싶은 수량" : "받을 수량"}
                    value={revQty}
                    onChangeText={setRevQty}
                    keyboardType="numeric"
                  />
                  {t.kind === "swap" && (
                    <Field
                      label="제공 수량"
                      value={revOffer}
                      onChangeText={setRevOffer}
                      keyboardType="numeric"
                    />
                  )}
                  {!isGift && (
                    <Field
                      label="합의 금액·차액 (원)"
                      value={revCash}
                      onChangeText={setRevCash}
                      keyboardType="numeric"
                    />
                  )}
                  <Field
                    label="조건·장소·시간"
                    value={revNote}
                    onChangeText={setRevNote}
                  />
                  <Button
                    secondary
                    label={isGift ? "나눔 신청 수정하기" : "수정 제안 보내기"}
                    busy={a.busy}
                    onPress={revise}
                  />
                </>
              )}
              {isGift && t.viewerId === t.buyer_id && (
                <Notice>
                  나눔 등록자의 수락을 기다리고 있어요. 전달 방법은 채팅에서
                  이야기해 주세요.
                </Notice>
              )}
              {canAccept && (
                <Button
                  label={isGift ? "나눔 신청 수락" : "제안 조건 동의"}
                  busy={a.busy}
                  onPress={() =>
                    void a.run("/tcg/trades/" + id + "/actions", {
                      kind: "accept",
                      version: t.version,
                    })
                  }
                />
              )}
              {(!isGift || t.viewerId === t.seller_id) && (
                <Button
                  secondary
                  label={isGift ? "나눔 신청 거절" : "제안 거절"}
                  onPress={() =>
                    void a.run("/tcg/trades/" + id + "/actions", {
                      kind: "decline",
                      version: t.version,
                    })
                  }
                />
              )}
            </>
          )}
          {t.status === "confirmed" && (
            <>
              {(t.kind === "swap" || t.viewerId === t.seller_id) && (
                <Button
                  label="카드 전달했어요"
                  onPress={() =>
                    void a.run("/tcg/trades/" + id + "/actions", {
                      kind: "sent",
                      version: t.version,
                    })
                  }
                />
              )}{" "}
              {(t.kind === "swap" || t.viewerId === t.buyer_id) && (
                <Button
                  label="카드 수령 확인"
                  onPress={() =>
                    void a.run("/tcg/trades/" + id + "/actions", {
                      kind: "received",
                      version: t.version,
                    })
                  }
                />
              )}
              <Button
                secondary
                label="분쟁 확인 요청"
                onPress={() =>
                  void a.run("/tcg/trades/" + id + "/actions", {
                    kind: "dispute",
                    version: t.version,
                  })
                }
              />
            </>
          )}
          {["proposed", "confirmed"].includes(t.status) && (
            <Button
              secondary
              label={
                t.status === "confirmed"
                  ? "전달 전 취소 요청·동의"
                  : isGift
                    ? "나눔 신청 취소"
                    : "제안 취소"
              }
              onPress={() =>
                void a.run("/tcg/trades/" + id + "/actions", {
                  kind: "cancel",
                  version: t.version,
                })
              }
            />
          )}{" "}
          {t.status === "disputed" && (
            <Notice>
              자동 완료를 중지했습니다. 운영 문의로 합의·반환 내용을 확인해
              주세요.
            </Notice>
          )}
          {a.feedback}
        </>
      )}
    </Frame>
  );
}
export function NotificationsScreen() {
  const q = useDavaq<Page<any>>("/tcg/notifications"),
    alerts = useDavaq<Page<any>>("/tcg/price-alerts"),
    a = useAction(),
    r = useRouter();
  return (
    <Frame back title="알림·가격 조건" onRefresh={() => void q.refetch()}>
      <QueryState query={q} />
      {q.data?.items.map((n) => (
        <Pressable
          key={n.id}
          style={S.card}
          onPress={() => {
            void a.run("/tcg/notifications/" + n.id + "/read");
            if (n.trade_id) r.push(("/tcg/trade/" + n.trade_id) as any);
            else if (n.listing_id)
              r.push(("/tcg/listing/" + n.listing_id) as any);
            else if (n.kind === "card_request") r.push("/tcg/request" as any);
          }}
        >
          <Txt bold>
            {n.title}
            {!n.seen_at ? " · 새 알림" : ""}
          </Txt>
          <Txt size={13}>{n.body}</Txt>
          <Txt size={11} color={C.muted}>
            {n.created_at?.slice(0, 16)}
          </Txt>
        </Pressable>
      ))}
      {q.isSuccess && !q.data?.items.length && (
        <Empty
          title="새 알림이 없습니다"
          body="희망 카드에 맞는 새 매물과 가격 조건을 확인하면 알려드려요."
        />
      )}
      <Section title="설정한 가격 알림" />
      {alerts.data?.items.map((v) => (
        <View key={v.id} style={S.card}>
          <Txt bold>{v.card_name}</Txt>
          <Txt>
            {money(Number(v.amount), v.currency)}{" "}
            {v.direction === "below" ? "이하" : "이상"}
          </Txt>
          <Button
            small
            secondary
            label="알림 해제"
            onPress={() =>
              void a.run("/tcg/price-alerts/" + v.id, undefined, "DELETE")
            }
          />
        </View>
      ))}
      {a.feedback}
    </Frame>
  );
}
export function RequestScreen() {
  const consent = useUgcConsent(useGetMe().data?.id ?? null);
  const r = useRouter();
  const [name, setName] = useState(""),
    [game, setGame] = useState("pokemon"),
    [number, setNumber] = useState(""),
    [language, setLanguage] = useState("ko"),
    [purpose, setPurpose] = useState("owned"),
    [photo, setPhoto] = useState(""),
    [note, setNote] = useState(""),
    [quantity, setQuantity] = useState("1"),
    a = useAction(),
    requests = useDavaq<Page<any>>("/tcg/card-requests");
  return (
    <Frame back title="미등록 카드 요청">
      <Notice>
        등록 요청은 확인 전까지 임시 기록으로 보관합니다. 공통 카드 DB에 연결된
        뒤 정확한 거래 매물로 등록할 수 있습니다.
      </Notice>
      <Field label="카드 이름" value={name} onChangeText={setName} />
      <Field
        label="수량"
        value={quantity}
        onChangeText={setQuantity}
        keyboardType="numeric"
      />
      <Field label="게임 코드" value={game} onChangeText={setGame} />
      <Field label="카드 번호·세트" value={number} onChangeText={setNumber} />
      <Field label="언어" value={language} onChangeText={setLanguage} />
      <View style={S.row}>
        <Chip
          label="보유"
          active={purpose === "owned"}
          onPress={() => setPurpose("owned")}
        />
        <Chip
          label="희망"
          active={purpose === "want"}
          onPress={() => setPurpose("want")}
        />
      </View>
      <Button
        secondary
        label={photo ? "사진 교체" : "실물 사진 추가"}
        onPress={async () => {
          if (!(await consent.ensureConsent())) return;
          void pickAndUploadImage()
            .then((v) => v && setPhoto(v.objectPath))
            .catch(a.failure);
        }}
      />
      {photo && <CardArt src={photo} />}
      <Field label="메모" value={note} onChangeText={setNote} />
      <Button
        label="등록 요청"
        busy={a.busy}
        onPress={async () => {
          if (!(await consent.ensureConsent())) return;
          void a
            .run("/tcg/card-requests", {
              name,
              game,
              number,
              language,
              purpose,
              photo,
              note,
              quantity: Number(quantity),
            })
            .then((v) => v && a.success("검토 요청을 저장했습니다."));
        }}
      />
      {a.feedback}
      <Section title="내 요청" />
      {requests.data?.items.map((v) => (
        <View key={v.id} style={S.card}>
          <Txt bold>{v.name}</Txt>
          <Txt size={12}>
            {v.number} ·{" "}
            {v.status === "pending"
              ? "확인 대기"
              : v.status === "ready"
                ? "판본 연결 완료"
                : v.status === "registered"
                  ? "등록 완료"
                  : v.status}
          </Txt>
          {v.status === "ready" && (
            <>
              <Button
                secondary
                label="연결된 판본 확인"
                onPress={() => r.push(cardLink(v.resolved_card_id, v.name))}
              />
              <Button
                label="확인했고 내 목록에 등록"
                onPress={() =>
                  void a
                    .run("/tcg/card-requests/" + v.id + "/confirm")
                    .then((x) => x && a.success("내 목록에 등록했습니다."))
                }
              />
            </>
          )}
        </View>
      ))}
      <UgcConsentPrompt {...consent.promptProps} />
    </Frame>
  );
}
export { ScanScreen } from "./Scan";
