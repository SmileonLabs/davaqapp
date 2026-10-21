import { shopScanHref, validShopScanId } from "@/lib/shopScan";
import * as ExpoLinking from "expo-linking";
import React, { useCallback, useEffect, useState } from "react";
import { View, Share, Platform, AppState } from "react-native";
import { useLocalSearchParams, useRouter, useFocusEffect } from "expo-router";
import {
  Frame,
  Txt,
  Button,
  Field,
  Chip,
  Notice,
  S,
} from "@/components/davaq/UI";
import { api, useDavaq, key, errorText } from "@/lib/davaq";
import { CONDITIONS, type Detail } from "@/lib/tcg";
import type { EngineScan } from "@/lib/tcgEngineResult";

type Shop = {
  id: string;
  name: string;
  role: "owner" | "staff";
  address: string;
  description: string;
};
type Item = {
  id: string;
  card_id: string;
  card_name: string;
  condition: string;
  quantity: number;
  unit_price: number;
  decision: string;
  reason: string;
  location: string;
};
export type Quote = {
  id: string;
  customer_label: string;
  status: string;
  version: number;
  total?: string;
  items: Item[];
  payment_status: string;
};
type Stock = {
  id: string;
  card_id: string;
  card_name: string;
  condition: string;
  quantity: number;
  unit_cost: number;
  location: string;
};
type Thread = {
  id: string;
  customer_name: string;
  status: string;
  unread_count?: number;
};
type Conversation = {
  id: string;
  viewerKind: "shop" | "customer";
  status: string;
  ai_consent: boolean;
  muted: boolean;
  messages: {
    id: string;
    sender_kind: string;
    content: string;
    created_at: string;
    seq: number;
  }[];
  wants: {
    id: string;
    card_name: string;
    quantity: number;
    max_price: number | null;
    active: boolean;
  }[];
};
const money = (n: number | string) => `${Number(n).toLocaleString("ko-KR")}원`;
const quoteLabel = (s: string) =>
  ({ draft: "작성 중", confirmed: "매입 확정", cancelled: "취소" })[s] ?? s;
function useAction(refresh: () => unknown) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  async function run(fn: () => Promise<unknown>) {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await fn();
      await refresh();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }
  return { busy, error, run };
}
export function ShopHome() {
  const r = useRouter(),
    config = useDavaq<{ available: boolean }>("/shops/config");
  const inbox = useDavaq<{
    items: {
      id: string;
      shop_id: string;
      shop_name: string;
      status: string;
      unread_count?: number;
    }[];
  }>("/shops/inbox", config.data?.available === true);
  const shops = useDavaq<{ items: Shop[] }>(
    "/shops",
    config.data?.available === true,
  );
  const [name, setName] = useState(""),
    [address, setAddress] = useState(""),
    [token, setToken] = useState("");
  const a = useAction(() => shops.refetch());
  return (
    <Frame
      back
      title="무료 매장 모드"
      subtitle="개인 카드와 분리된 매장 업무 공간"
      onRefresh={() => {
        void shops.refetch();
      }}
    >
      {config.error && <Notice error>{errorText(config.error)}</Notice>}
      {config.data && !config.data.available ? (
        <Notice>
          매장 모드는 준비 중입니다. 파일럿 공개 후 이용할 수 있습니다.
        </Notice>
      ) : (
        config.data?.available && (
          <>
            <Txt bold>내 매장 상담</Txt>
            {inbox.data?.items.map((t) => (
              <Button
                key={t.id}
                secondary
                label={`${t.shop_name} · ${t.status === "open" ? "상담 진행" : "처리 완료"}${t.unread_count ? ` · 새 메시지 ${t.unread_count}` : ""}`}
                onPress={() =>
                  r.push(
                    `/shop/conversation?shopId=${t.shop_id}&threadId=${t.id}` as any,
                  )
                }
              />
            ))}
            <Button
              secondary
              label="개인 모드로 돌아가기"
              onPress={() => r.replace("/(tabs)" as any)}
            />
            {shops.error && <Notice error>{errorText(shops.error)}</Notice>}
            {shops.data?.items.map((s) => (
              <View key={s.id} style={S.card}>
                <Txt bold>
                  {s.name} · {s.role === "owner" ? "점주" : "직원"}
                </Txt>
                <Txt>{s.address}</Txt>
                <Button
                  label="매장 업무 열기"
                  onPress={() => r.push(`/shop/${s.id}` as any)}
                />
              </View>
            ))}
            <View style={S.card}>
              <Txt bold>매장 개설</Txt>
              <Field
                label="매장명"
                value={name}
                onChangeText={setName}
                maxLength={80}
              />
              <Field
                label="매장 주소"
                value={address}
                onChangeText={setAddress}
                maxLength={200}
              />
              <Button
                busy={a.busy}
                disabled={!name.trim()}
                label="무료 매장 개설"
                onPress={() =>
                  void a.run(async () => {
                    const s = await api<Shop>("/shops", "POST", {
                      name,
                      address,
                    });
                    r.push(`/shop/${s.id}` as any);
                  })
                }
              />
            </View>
            <View style={S.card}>
              <Field
                label="직원 초대 코드"
                value={token}
                onChangeText={setToken}
                autoCapitalize="none"
              />
              <Button
                busy={a.busy}
                label="직원으로 참여"
                disabled={token.length !== 48}
                onPress={() =>
                  void a.run(async () => {
                    await api("/shops/join", "POST", { token });
                    setToken("");
                  })
                }
              />
            </View>
          </>
        )
      )}
      {a.error && <Notice error>{a.error}</Notice>}
    </Frame>
  );
}
export function ShopDesk() {
  const { shopId: raw, quoteId: requestedQuote } = useLocalSearchParams<{
      shopId: string;
      quoteId?: string;
    }>(),
    shop = String(raw),
    base = `/shops/${shop}`,
    r = useRouter();
  const mine = useDavaq<{ items: Shop[] }>("/shops"),
    current = mine.data?.items.find((s) => s.id === shop);
  const [tab, setTab] = useState("매입"),
    [label, setLabel] = useState("현장 고객"),
    [active, setActive] = useState(
      typeof requestedQuote === "string" ? requestedQuote : "",
    );
  useEffect(() => {
    if (validShopScanId(requestedQuote)) setActive(requestedQuote);
  }, [requestedQuote]);
  const quotes = useDavaq<{ items: Quote[] }>(`${base}/quotes`, !!current);
  const detail = useDavaq<Quote>(
    `${base}/quotes/${active}`,
    !!active && !!current,
  );
  const stock = useDavaq<{ items: Stock[] }>(`${base}/stock`, !!current);
  const threads = useDavaq<{ items: Thread[] }>(`${base}/threads`, !!current);
  const matches = useDavaq<{
    items: {
      id: string;
      thread_id: string;
      card_name: string;
      customer_name: string;
      available: number;
    }[];
  }>(`${base}/matches`, !!current);
  const members = useDavaq<{
    items: { user_id: string; role: string; nickname: string }[];
  }>(`${base}/members`, current?.role === "owner");
  const [invite, setInvite] = useState(""),
    [draft, setDraft] = useState(""),
    [aiAck, setAiAck] = useState(false),
    [exportText, setExportText] = useState("");
  const refresh = async () => {
    await Promise.all([
      quotes.refetch(),
      stock.refetch(),
      threads.refetch(),
      matches.refetch(),
      ...(active ? [detail.refetch()] : []),
      ...(current?.role === "owner" ? [members.refetch()] : []),
    ]);
  };
  const a = useAction(refresh),
    q = detail.data;
  async function exportStock() {
    const csv = await api<string>(`${base}/export`);
    if (Platform.OS === "web") {
      const blob = new Blob([csv], { type: "text/csv;charset=utf-8" }),
        url = URL.createObjectURL(blob),
        el = document.createElement("a");
      el.href = url;
      el.download = "shop-stock.csv";
      el.click();
      URL.revokeObjectURL(url);
    } else {
      setExportText(csv);
      await Share.share({ message: csv });
    }
  }
  return (
    <Frame
      back
      title={current?.name ?? "매장 데스크"}
      subtitle="무료 파일럿 · 매입 / 재고 / 고객"
      onRefresh={() => void refresh()}
    >
      <Button
        secondary
        small
        label="개인·다른 매장으로 전환"
        onPress={() => r.push("/shop" as any)}
      />
      {mine.error && <Notice error>{errorText(mine.error)}</Notice>}
      {mine.data && !current ? (
        <Notice error>매장 접근 권한이 없습니다.</Notice>
      ) : (
        current && (
          <>
            <View style={S.wrap}>
              {["매입", "재고", "고객", "관리"].map((t) => (
                <Chip
                  key={t}
                  label={t}
                  active={tab === t}
                  onPress={() => {
                    setTab(t);
                    setDraft("");
                  }}
                />
              ))}
            </View>
            {[
              quotes.error,
              stock.error,
              threads.error,
              matches.error,
              active && detail.error,
            ]
              .filter(Boolean)
              .map((e, i) => (
                <Notice key={i} error>
                  {errorText(e)}
                </Notice>
              ))}
            {tab === "매입" && (
              <>
                <View style={S.card}>
                  <Field
                    label="고객 구분 (연락처 없이 시작 가능)"
                    value={label}
                    onChangeText={setLabel}
                    maxLength={80}
                  />
                  <Button
                    busy={a.busy}
                    label="새 매입 견적"
                    onPress={() =>
                      void a.run(async () => {
                        const v = await api<Quote>(`${base}/quotes`, "POST", {
                          customerLabel: label,
                        });
                        setActive(v.id);
                      })
                    }
                  />
                </View>
                <View style={S.wrap}>
                  {quotes.data?.items.map((v) => (
                    <Chip
                      key={v.id}
                      active={active === v.id}
                      label={`${v.customer_label} · ${quoteLabel(v.status)} · ${money(v.total ?? 0)}`}
                      onPress={() => setActive(v.id)}
                    />
                  ))}
                </View>
                {q && (
                  <View style={S.card}>
                    <Txt bold>
                      {q.customer_label} · {quoteLabel(q.status)}
                    </Txt>
                    <Txt>
                      매입 합계{" "}
                      {money(
                        q.items
                          .filter((i) => i.decision === "buy")
                          .reduce((s, i) => s + i.quantity * i.unit_price, 0),
                      )}
                    </Txt>
                    {q.items.map((i) => (
                      <View key={i.id} style={S.card}>
                        <Txt bold>{i.card_name}</Txt>
                        <Txt>
                          {i.condition} · {i.quantity}장 × {money(i.unit_price)}{" "}
                          · {i.decision === "buy" ? "매입" : "반환"}
                        </Txt>
                        <Txt>
                          {i.location} {i.reason}
                        </Txt>
                        {q.status === "draft" && (
                          <Button
                            secondary
                            small
                            label="항목 제거 후 다시 입력"
                            busy={a.busy}
                            onPress={() =>
                              void a.run(() =>
                                api(
                                  `${base}/quotes/${q.id}/items/${i.id}`,
                                  "DELETE",
                                  { version: q.version },
                                ),
                              )
                            }
                          />
                        )}
                      </View>
                    ))}
                    {q.status === "draft" && (
                      <>
                        <CardEntry shop={shop} quote={q} onSaved={refresh} />
                        <Notice>
                          점주는 고객에게 카드별 금액과 총액을 확인받은 후
                          확정합니다. 확정하면 재고에 입고되며 견적 원본은
                          잠깁니다.
                        </Notice>
                        {current.role === "owner" ? (
                          <ConfirmQuote
                            busy={a.busy}
                            onConfirm={() =>
                              void a.run(() =>
                                api(`${base}/quotes/${q.id}/confirm`, "POST", {
                                  version: q.version,
                                  customerConfirmed: true,
                                }),
                              )
                            }
                          />
                        ) : (
                          <Notice>매입 확정은 점주가 처리합니다.</Notice>
                        )}
                        <Button
                          secondary
                          label="견적 취소"
                          busy={a.busy}
                          onPress={() =>
                            void a.run(() =>
                              api(`${base}/quotes/${q.id}/cancel`, "POST", {
                                version: q.version,
                                reason: "직원 취소",
                              }),
                            )
                          }
                        />
                      </>
                    )}
                    {q.status === "confirmed" && (
                      <>
                        <Txt>
                          지급 상태:{" "}
                          {q.payment_status === "recorded_paid"
                            ? "직원이 지급 완료로 기록"
                            : "미지급"}
                        </Txt>
                        <Notice>송금·결제를 검증한 내역이 아닙니다.</Notice>
                        {current.role === "owner" && (
                          <Button
                            secondary
                            busy={a.busy}
                            label={
                              q.payment_status === "recorded_paid"
                                ? "미지급으로 정정"
                                : "실제 지급 후 완료 기록"
                            }
                            onPress={() =>
                              void a.run(() =>
                                api(`${base}/quotes/${q.id}/payment`, "POST", {
                                  status:
                                    q.payment_status === "recorded_paid"
                                      ? "unpaid"
                                      : "recorded_paid",
                                }),
                              )
                            }
                          />
                        )}
                      </>
                    )}
                  </View>
                )}
              </>
            )}
            {tab === "재고" && (
              <>
                <Notice>
                  매입 입고 건별 원가를 보존합니다. 원가는 판매가격이 아닙니다.
                </Notice>
                {stock.data?.items.map((s) => (
                  <StockRow
                    key={s.id}
                    base={base}
                    stock={s}
                    onSaved={refresh}
                  />
                ))}
              </>
            )}
            {tab === "고객" && (
              <>
                <Notice>
                  매장 상담 전용 공간입니다. 고객의 개인 대화와 컬렉션은
                  공개되지 않습니다. 고객이 기존 DavaQ 계정으로 매장 문의 화면을
                  열면 상담이 생성됩니다.
                </Notice>
                <Field
                  label="고객 문의 링크"
                  value={ExpoLinking.createURL("shop/contact", {
                    queryParams: { shopId: shop },
                  })}
                  editable={false}
                />
                <Button
                  secondary
                  label="고객 문의 링크 공유"
                  onPress={() =>
                    void Share.share({
                      message: ExpoLinking.createURL("shop/contact", {
                        queryParams: { shopId: shop },
                      }),
                    })
                  }
                />
                <Txt bold>
                  찾는 카드 입고 후보 · 판매가격과 상태는 별도 확인
                </Txt>
                {matches.data?.items.map((m) => (
                  <Button
                    key={m.id}
                    secondary
                    label={`${m.customer_name} · ${m.card_name} · ${m.available}장`}
                    onPress={() =>
                      r.push(
                        `/shop/conversation?shopId=${shop}&threadId=${m.thread_id}` as any,
                      )
                    }
                  />
                ))}
                <Txt bold>매장 상담</Txt>
                {threads.data?.items.map((t) => (
                  <Button
                    key={t.id}
                    secondary
                    label={`${t.customer_name} · ${t.status === "open" ? "답변 진행" : "처리 완료"}${t.unread_count ? ` · 새 메시지 ${t.unread_count}` : ""}`}
                    onPress={() =>
                      r.push(
                        `/shop/conversation?shopId=${shop}&threadId=${t.id}` as any,
                      )
                    }
                  />
                ))}
              </>
            )}
            {tab === "관리" && (
              <>
                <Notice>
                  AI는 초안만 만들며 고객에게 자동 발송하지 않습니다. 상담 AI는
                  고객이 동의한 대화만 사용합니다.
                </Notice>
                <Chip
                  label="선택한 재고 정보를 외부 AI에 보내 초안 생성에 동의"
                  active={aiAck}
                  onPress={() => setAiAck(!aiAck)}
                />
                <Button
                  busy={a.busy}
                  disabled={
                    !aiAck || !stock.data?.items.some((s) => s.quantity > 0)
                  }
                  label="입고 안내 초안 만들기 (최근 재고 최대 10건)"
                  onPress={() =>
                    void a.run(async () => {
                      const v = await api<{ draft: string }>(
                        `${base}/ai-draft`,
                        "POST",
                        {
                          purpose: "promotion",
                          stockIds: stock
                            .data!.items.filter((s) => s.quantity > 0)
                            .slice(0, 10)
                            .map((s) => s.id),
                          acknowledgeExternalAi: true,
                        },
                      );
                      setDraft(v.draft);
                    })
                  }
                />
                {draft && (
                  <Field
                    label="직원 검토용 홍보 초안 · 자동 발송 안 됨"
                    multiline
                    value={draft}
                    onChangeText={setDraft}
                  />
                )}
                {current.role === "owner" && (
                  <>
                    <Button
                      secondary
                      busy={a.busy}
                      label="직원 초대 코드 발급 (24시간·1회)"
                      onPress={() =>
                        void a.run(async () => {
                          const v = await api<{ token: string }>(
                            `${base}/invites`,
                            "POST",
                            {},
                          );
                          setInvite(v.token);
                        })
                      }
                    />
                    {invite && (
                      <Field
                        label="초대 코드 · 직원에게만 전달"
                        value={invite}
                        editable={false}
                      />
                    )}
                    {members.data?.items.map((m) => (
                      <View key={m.user_id} style={S.card}>
                        <Txt>
                          {m.nickname} · {m.role === "owner" ? "점주" : "직원"}
                        </Txt>
                        {m.role === "staff" && (
                          <Button
                            secondary
                            busy={a.busy}
                            label="직원 접근 해제"
                            onPress={() =>
                              void a.run(() =>
                                api(`${base}/members/${m.user_id}`, "DELETE"),
                              )
                            }
                          />
                        )}
                      </View>
                    ))}
                    <Button
                      secondary
                      busy={a.busy}
                      label="재고 CSV 내보내기"
                      onPress={() => void a.run(exportStock)}
                    />
                    {exportText && (
                      <Field
                        label="CSV"
                        value={exportText}
                        multiline
                        editable={false}
                      />
                    )}
                  </>
                )}
              </>
            )}
          </>
        )
      )}
      {a.error && <Notice error>{a.error}</Notice>}
    </Frame>
  );
}
function ConfirmQuote({
  busy,
  onConfirm,
}: {
  busy: boolean;
  onConfirm: () => void;
}) {
  const [yes, setYes] = useState(false);
  return (
    <>
      <Chip
        label="고객에게 최종 금액과 카드 목록을 확인받았습니다"
        active={yes}
        onPress={() => setYes(!yes)}
      />
      <Button
        label="매입 확정·재고 입고"
        disabled={!yes}
        busy={busy}
        onPress={onConfirm}
      />
    </>
  );
}
export function CardEntry({
  shop,
  quote: q,
  onSaved,
  initialCardId = "",
  sourceScanId,
  scanReview = false,
}: {
  shop: string;
  quote: Quote;
  onSaved: () => unknown;
  initialCardId?: string;
  sourceScanId?: string;
  scanReview?: boolean;
}) {
  const base = `/shops/${shop}`,
    r = useRouter();
  const [search, setSearch] = useState(""),
    [query, setQuery] = useState(""),
    [id, setId] = useState(initialCardId);
  const cards = useDavaq<{
    items: { id: string; saveId: string; title: string }[];
  }>(`/tcg/catalog?q=${encodeURIComponent(query)}`, !!query);
  const detail = useDavaq<Detail>(
    `/tcg/catalog/detail?id=${encodeURIComponent(id)}`,
    !!id,
  );
  const scans = useDavaq<{ items: EngineScan[] }>("/tcg/scans");
  const prices = useDavaq<{ items: { card_id: string; unit_price: number }[] }>(
    `${base}/prices`,
  );
  const [count, setCount] = useState("1"),
    [price, setPrice] = useState(""),
    [cond, setCond] = useState("NM"),
    [location, setLocation] = useState(""),
    [reason, setReason] = useState(""),
    [reject, setReject] = useState(false),
    [checked, setChecked] = useState(false);
  const [itemKey, setItemKey] = useState(key);
  const a = useAction(onSaved);
  useEffect(() => {
    setChecked(false);
    const v = prices.data?.items.find((p) => p.card_id === id);
    setPrice(v ? String(v.unit_price) : "");
  }, [id, prices.data]);
  return (
    <View style={S.card}>
      <Txt bold>카드 추가</Txt>
      {!scanReview && (
        <>
          <Button
            secondary
            label="스캔해서 이 견적에 바로 추가"
            onPress={() =>
              r.push(shopScanHref({ shopId: shop, quoteId: q.id }) as any)
            }
          />
          {scans.data?.items
            .filter((s) => s.result?.targetId)
            .slice(0, 8)
            .map((s) => (
              <Chip
                key={s.id}
                label={`스캔: ${s.result?.name ?? s.result?.targetId}`}
                active={id === s.result?.targetId}
                onPress={() => setId(s.result!.targetId!)}
              />
            ))}
        </>
      )}
      <Field label="카드명·번호 검색" value={search} onChangeText={setSearch} />
      <Button
        secondary
        label="카드 찾기"
        onPress={() => setQuery(search.trim())}
      />
      {cards.error && <Notice error>{errorText(cards.error)}</Notice>}
      {cards.data?.items.slice(0, 15).map((c) => (
        <Chip
          key={c.id}
          label={c.title}
          active={id === (c.saveId || c.id)}
          onPress={() => setId(c.saveId || c.id)}
        />
      ))}
      {detail.error && <Notice error>{errorText(detail.error)}</Notice>}
      {detail.data && (
        <>
          <Txt bold>{detail.data.target.name}</Txt>
          <Txt>
            {detail.data.target.game} · {detail.data.target.number} ·{" "}
            {detail.data.target.set} · {detail.data.target.region}
          </Txt>
          <Txt>
            참고 {detail.data.target.value ?? "자료 없음"}{" "}
            {detail.data.target.currency} · {detail.data.target.priceType} ·{" "}
            {detail.data.target.observedAt ?? "시점 미확인"}
          </Txt>
          <Chip
            label="실물과 언어·판본·번호가 일치함을 확인"
            active={checked}
            onPress={() => setChecked(!checked)}
          />
          <View style={S.wrap}>
            {CONDITIONS.map(([v, label]) => (
              <Chip
                key={v}
                label={`${v} ${label}`}
                active={cond === v}
                onPress={() => setCond(v)}
              />
            ))}
          </View>
          <Field
            label="수량"
            keyboardType="numeric"
            value={count}
            onChangeText={setCount}
          />
          <Field
            label="장당 매입 제안가 (원)"
            keyboardType="numeric"
            value={price}
            onChangeText={setPrice}
          />
          <Field
            label="보관 위치"
            value={location}
            onChangeText={setLocation}
          />
          <Field
            label="검수·거절 사유"
            value={reason}
            onChangeText={setReason}
          />
          <Chip
            label={reject ? "매입 거절·반환 대상" : "매입 대상"}
            active={!reject}
            onPress={() => setReject(!reject)}
          />
          <Button
            secondary
            busy={a.busy}
            label="이 금액을 매장 기본 매입가로 저장 (점주)"
            disabled={!/^\d+$/.test(price)}
            onPress={() =>
              void a.run(() =>
                api(`${base}/prices`, "POST", {
                  cardId: id,
                  unitPrice: Number(price),
                }),
              )
            }
          />
          <Button
            busy={a.busy}
            label="견적에 담기"
            disabled={
              !checked ||
              !/^\d+$/.test(price) ||
              !/^\d+$/.test(count) ||
              Number(count) < 1
            }
            onPress={() =>
              void a.run(async () => {
                await api(`${base}/quotes/${q.id}/items`, "POST", {
                  cardId: id,
                  requestKey: itemKey,
                  ...(sourceScanId
                    ? { scanId: sourceScanId, printingConfirmed: checked }
                    : {}),
                  version: q.version,
                  quantity: Number(count),
                  condition: cond,
                  unitPrice: Number(price),
                  location,
                  reason,
                  decision: reject ? "reject" : "buy",
                });
                setItemKey(key());
                setId("");
                setReason("");
              })
            }
          />
        </>
      )}
      {a.error && <Notice error>{a.error}</Notice>}
    </View>
  );
}
function StockRow({
  base,
  stock: s,
  onSaved,
}: {
  base: string;
  stock: Stock;
  onSaved: () => unknown;
}) {
  const [movementKey, setMovementKey] = useState(key);
  const [delta, setDelta] = useState("-1"),
    [reason, setReason] = useState("현장 판매"),
    a = useAction(onSaved);
  return (
    <View style={S.card}>
      <Txt bold>
        {s.card_name} · {s.condition}
      </Txt>
      <Txt>
        {s.quantity}장 · 원가 {money(s.unit_cost)} ·{" "}
        {s.location || "위치 미입력"}
      </Txt>
      <Field
        label="수량 증감 (판매는 음수)"
        value={delta}
        onChangeText={(v) => {
          setDelta(v);
          setMovementKey(key());
        }}
        keyboardType="numbers-and-punctuation"
      />
      <Field
        label="판매·재고 조정 사유"
        value={reason}
        onChangeText={(v) => {
          setReason(v);
          setMovementKey(key());
        }}
      />
      <Button
        secondary
        busy={a.busy}
        disabled={
          !/^-?\d+$/.test(delta) || Number(delta) === 0 || !reason.trim()
        }
        label="수량 변경 기록"
        onPress={() =>
          void a.run(() =>
            api(`${base}/stock/${s.id}/movements`, "POST", {
              delta: Number(delta),
              reason,
              requestKey: movementKey,
            }).then((value) => {
              setMovementKey(key());
              return value;
            }),
          )
        }
      />
      {a.error && <Notice error>{a.error}</Notice>}
    </View>
  );
}
export function ShopContact() {
  const { shopId: raw } = useLocalSearchParams<{ shopId: string }>(),
    shop = String(raw),
    r = useRouter();
  const s = useDavaq<Shop>(`/shops/${shop}/public`),
    a = useAction(() => {});
  return (
    <Frame back title={s.data?.name ?? "매장 문의"}>
      <Txt>{s.data?.address}</Txt>
      <Txt>{s.data?.description}</Txt>
      {s.error && <Notice error>{errorText(s.error)}</Notice>}
      <Button
        busy={a.busy}
        disabled={!s.data}
        label="매장 공식 상담 시작"
        onPress={() =>
          void a.run(async () => {
            const t = await api<Thread>(`/shops/${shop}/contact`, "POST", {});
            r.replace(
              `/shop/conversation?shopId=${shop}&threadId=${t.id}` as any,
            );
          })
        }
      />
      {a.error && <Notice error>{a.error}</Notice>}
    </Frame>
  );
}
export function ShopConversation() {
  const p = useLocalSearchParams<{ shopId: string; threadId: string }>(),
    base = `/shops/${p.shopId}`,
    path = `${base}/threads/${p.threadId}`;
  const q = useDavaq<Conversation>(path),
    [messageKey, setMessageKey] = useState(key),
    [message, setMessage] = useState(""),
    [draft, setDraft] = useState(""),
    [aiAck, setAiAck] = useState(false),
    [wantId, setWantId] = useState(""),
    [wantCount, setWantCount] = useState("1"),
    [maxPrice, setMaxPrice] = useState("");
  const [search, setSearch] = useState(""),
    [query, setQuery] = useState("");
  const cards = useDavaq<{
    items: { id: string; saveId: string; title: string }[];
  }>(`/tcg/catalog?q=${encodeURIComponent(query)}`, !!query);
  const a = useAction(() => q.refetch());
  useFocusEffect(
    useCallback(() => {
      const refresh = () => {
        if (AppState.currentState === "active") void q.refetch();
      };
      const t = setInterval(refresh, 30000);
      const sub = AppState.addEventListener("change", (state) => {
        if (state === "active") void q.refetch();
      });
      return () => {
        clearInterval(t);
        sub.remove();
      };
    }, [path, q.refetch]),
  );
  const c = q.data;
  const throughSeq = c?.messages.at(-1)?.seq ?? 0;
  useFocusEffect(
    useCallback(() => {
      if (!throughSeq) return;
      const read = () => {
        if (AppState.currentState === "active")
          void api(`${path}/read`, "POST", { throughSeq }).catch(() => {});
      };
      read();
      const sub = AppState.addEventListener("change", (state) => {
        if (state === "active") read();
      });
      return () => sub.remove();
    }, [path, throughSeq]),
  );
  return (
    <Frame
      back
      title="매장 공식 상담"
      subtitle="매장 직원이 함께 응대합니다. 개인 대화와는 분리됩니다."
      onRefresh={() => void q.refetch()}
    >
      {q.error && <Notice error>{errorText(q.error)}</Notice>}
      {c && (
        <>
          <Txt>{c.status === "done" ? "처리 완료" : "상담 진행 중"}</Txt>
          <Chip
            label={c.muted ? "이 상담 푸시 꺼짐" : "이 상담 푸시 켜짐"}
            active={!c.muted}
            onPress={() =>
              void a.run(() =>
                api(`${path}/notifications`, "PATCH", { muted: !c.muted }),
              )
            }
          />
          <Notice>
            실시간 연결이 끊기면 화면 복귀·주기적 확인으로 새 메시지를
            불러옵니다.
          </Notice>
          {c.messages.map((m) => (
            <View key={m.id} style={S.card}>
              <Txt bold>{m.sender_kind === "shop" ? "매장" : "고객"}</Txt>
              <Txt>{m.content}</Txt>
            </View>
          ))}
          <Field
            label="메시지"
            value={message}
            onChangeText={(v) => {
              setMessage(v);
              setMessageKey(key());
            }}
            multiline
            maxLength={2000}
          />
          <Button
            busy={a.busy}
            disabled={!message.trim()}
            label="메시지 보내기"
            onPress={() =>
              void a.run(async () => {
                await api(`${path}/messages`, "POST", {
                  content: message,
                  requestKey: messageKey,
                });
                setMessage("");
                setMessageKey(key());
              })
            }
          />
          {c.viewerKind === "customer" ? (
            <>
              <Notice>
                AI 상담 활용을 켜면 이 상담의 최근 메시지가 외부 AI에 전달되어
                직원용 답변·요약 초안에 사용됩니다. 언제든 끌 수 있습니다.
              </Notice>
              <Chip
                label={
                  c.ai_consent
                    ? "AI 상담 활용 동의 켜짐"
                    : "AI 상담 활용 동의 꺼짐"
                }
                active={c.ai_consent}
                onPress={() =>
                  void a.run(() =>
                    api(path, "PATCH", { aiConsent: !c.ai_consent }),
                  )
                }
              />
              <Txt bold>찾는 카드 남기기</Txt>
              <Field
                label="카드명·번호"
                value={search}
                onChangeText={setSearch}
              />
              <Button
                secondary
                label="검색"
                onPress={() => setQuery(search.trim())}
              />
              {cards.data?.items.slice(0, 10).map((v) => (
                <Chip
                  key={v.id}
                  label={v.title}
                  active={wantId === (v.saveId || v.id)}
                  onPress={() => setWantId(v.saveId || v.id)}
                />
              ))}
              <Field
                label="원하는 수량"
                value={wantCount}
                onChangeText={setWantCount}
                keyboardType="numeric"
              />
              <Field
                label="장당 희망 상한가 (선택)"
                value={maxPrice}
                onChangeText={setMaxPrice}
                keyboardType="numeric"
              />
              <Button
                secondary
                busy={a.busy}
                disabled={
                  !wantId ||
                  !/^\d+$/.test(wantCount) ||
                  (!!maxPrice && !/^\d+$/.test(maxPrice))
                }
                label="카드 요청 저장"
                onPress={() =>
                  void a.run(async () => {
                    await api(`${path}/wants`, "POST", {
                      cardId: wantId,
                      quantity: Number(wantCount),
                      maxPrice: maxPrice ? Number(maxPrice) : null,
                    });
                    setWantId("");
                  })
                }
              />
            </>
          ) : (
            <>
              <Button
                secondary
                busy={a.busy}
                label={
                  c.status === "done" ? "상담 다시 열기" : "처리 완료로 표시"
                }
                onPress={() =>
                  void a.run(() =>
                    api(path, "PATCH", {
                      status: c.status === "done" ? "open" : "done",
                    }),
                  )
                }
              />
              <Chip
                label="외부 AI로 상담을 보내 초안 생성에 동의"
                active={aiAck}
                onPress={() => setAiAck(!aiAck)}
              />
              {(["reply", "summary"] as const).map((purpose) => (
                <Button
                  key={purpose}
                  secondary
                  busy={a.busy}
                  disabled={!c.ai_consent || !aiAck}
                  label={purpose === "reply" ? "AI 답변 초안" : "AI 상담 요약"}
                  onPress={() =>
                    void a.run(async () => {
                      const v = await api<{ draft: string }>(
                        `${base}/ai-draft`,
                        "POST",
                        {
                          purpose,
                          threadId: p.threadId,
                          acknowledgeExternalAi: true,
                        },
                      );
                      setDraft(v.draft);
                    })
                  }
                />
              ))}
              {!c.ai_consent && (
                <Notice>
                  고객이 AI 상담 활용에 동의하면 초안을 만들 수 있습니다.
                </Notice>
              )}
              {draft && (
                <>
                  <Field
                    label="직원 검토용 AI 초안"
                    multiline
                    value={draft}
                    onChangeText={setDraft}
                  />
                  <Button
                    secondary
                    label="초안을 메시지 입력란에 넣기"
                    onPress={() => {
                      setMessage(draft);
                      setMessageKey(key());
                    }}
                  />
                </>
              )}
            </>
          )}
          <Txt bold>찾는 카드 요청</Txt>
          {c.wants
            .filter((w) => w.active)
            .map((w) => (
              <View key={w.id} style={S.card}>
                <Txt>
                  {w.card_name} · {w.quantity}장 ·{" "}
                  {w.max_price === null ? "가격 협의" : money(w.max_price)}
                </Txt>
                <Button
                  secondary
                  small
                  busy={a.busy}
                  label="요청 종료"
                  onPress={() =>
                    void a.run(() => api(`${path}/wants/${w.id}`, "DELETE"))
                  }
                />
              </View>
            ))}
        </>
      )}
      {a.error && <Notice error>{a.error}</Notice>}
    </Frame>
  );
}
