import React from "react";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Frame, Notice, Button, Txt } from "@/components/davaq/UI";
import { useDavaq, errorText } from "@/lib/davaq";
import {
  shopScanContext,
  shopScanHref,
  validShopScanCard,
  validShopScanId,
} from "@/lib/shopScan";
import { ScanScreen } from "@/components/tcg/Scan";
import { CardEntry, type Quote } from "./ShopDesk";
export function ShopQuoteScan() {
  const p = useLocalSearchParams(),
    r = useRouter(),
    context = shopScanContext(p);
  const q = useDavaq<Quote>(
    context
      ? `/shops/${context.shopId}/quotes/${context.quoteId}`
      : "/shops/config",
    !!context,
  );
  if (!context)
    return (
      <Frame back title="매입 스캔">
        <Notice error>올바른 매장 견적에서 스캔을 시작해 주세요.</Notice>
      </Frame>
    );
  if (q.error)
    return (
      <Frame back title="매입 스캔">
        <Notice error>{errorText(q.error)}</Notice>
        <Button label="다시 확인" onPress={() => void q.refetch()} />
      </Frame>
    );
  if (!q.data)
    return (
      <Frame back title="매입 스캔">
        <Txt>견적을 확인하고 있습니다.</Txt>
      </Frame>
    );
  if (q.data.status !== "draft")
    return (
      <Frame back title="매입 스캔">
        <Notice>이미 확정·취소된 견적입니다.</Notice>
        <Button
          label="매장으로 돌아가기"
          onPress={() => r.replace(`/shop/${context.shopId}` as any)}
        />
      </Frame>
    );
  if (p.cardId !== undefined && !validShopScanCard(p.cardId))
    return (
      <Frame back title="매입 스캔">
        <Notice error>
          이 인식 결과는 지원하는 카드 판본과 연결되지 않았습니다.
        </Notice>
        <Button
          label="다시 스캔"
          onPress={() => r.replace(shopScanHref(context) as any)}
        />
      </Frame>
    );
  if (p.scanId !== undefined && !validShopScanId(p.scanId))
    return (
      <Frame back title="매입 스캔">
        <Notice error>스캔 기록이 올바르지 않습니다.</Notice>
      </Frame>
    );
  if (!validShopScanCard(p.cardId)) return <ScanScreen />;
  return (
    <Frame
      back
      title="스캔 카드 매입 확인"
      subtitle={`견적: ${q.data.customer_label}`}
    >
      <Notice>
        실물의 언어·판본·상태와 매입 단가를 확인한 후 담아 주세요. 저장하면 같은
        견적에서 다음 카드를 스캔할 수 있습니다.
      </Notice>
      <CardEntry
        key={`${p.cardId}:${p.scanId ?? "live"}`}
        shop={context.shopId}
        quote={q.data}
        initialCardId={p.cardId}
        sourceScanId={typeof p.scanId === "string" ? p.scanId : undefined}
        scanReview
        onSaved={async () => {
          await q.refetch();
          r.replace(shopScanHref(context) as any);
        }}
      />
      <Button
        secondary
        label="이 카드 건너뛰고 다음 스캔"
        onPress={() => r.replace(shopScanHref(context) as any)}
      />
      <Button
        secondary
        label="견적 전체 보기"
        onPress={() =>
          r.replace(`/shop/${context.shopId}?quoteId=${context.quoteId}` as any)
        }
      />
    </Frame>
  );
}
