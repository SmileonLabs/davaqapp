import { describe, it } from "node:test";
import assert from "node:assert/strict";
function expect(value) {
  return {
    toEqual: (other) => assert.deepEqual(value, other),
    toBe: (other) => assert.equal(value, other),
    toBeNull: () => assert.equal(value, null),
    toContain: (part) => assert.ok(value.includes(part)),
    not: { toContain: (part) => assert.ok(!value.includes(part)) },
  };
}

import {
  shopScanContext,
  shopScanHref,
  shopScannerHref,
  validShopScanCard,
} from "./shopScan.ts";
import { shopEventTargets, shopQueryAffected } from "./shopRealtime.ts";
import { notifyShopPush, subscribeShopPush } from "./shopPushRefresh.ts";
const shopId = "11111111-1111-4111-8111-111111111111",
  quoteId = "22222222-2222-4222-8222-222222222222";
describe("shop scan and notification navigation", () => {
  it("retains the same quote across photo/live/review navigation", () => {
    const c = shopScanContext({ shopId, quoteId });
    expect(c).toEqual({ shopId, quoteId });
    expect(shopScannerHref(c)).toContain(
      `/tcg/scan?shopId=${shopId}&quoteId=${quoteId}`,
    );
    expect(shopScannerHref(c, true)).toContain("/tcg/live-scan?");
    const url = new URL(
      shopScanHref(c, "kream:123", quoteId),
      "https://example.test",
    );
    expect(url.searchParams.get("quoteId")).toBe(quoteId);
    expect(url.searchParams.get("cardId")).toBe("kream:123");
    expect(url.searchParams.get("scanId")).toBe(quoteId);
  });
  it("rejects external paths, malformed ids, and array parameters", () => {
    expect(shopScanContext({ shopId: "/chat/other", quoteId })).toBeNull();
    expect(shopScanContext({ shopId: [shopId], quoteId })).toBeNull();
    expect(validShopScanCard("https://evil.test")).toBe(false);
    expect(shopScanHref({ shopId, quoteId }, "/personal")).not.toContain(
      "cardId",
    );
  });
  it("invalidates only shop queries on validated authenticated events", () => {
    expect(
      shopEventTargets("shop.message.created", { shopId, threadId: quoteId }),
    ).toEqual({ shopId, threadId: quoteId });
    expect(
      shopEventTargets("message.created", { shopId, threadId: quoteId }),
    ).toBeNull();
    expect(
      shopEventTargets("shop.message.created", { shopId, threadId: "bad" }),
    ).toBeNull();
    expect(
      shopQueryAffected(
        ["davaq", "user", `/shops/${shopId}/threads/${quoteId}`],
        shopId,
      ),
    ).toBe(true);
    expect(shopQueryAffected(["davaq", "user", "/shops/inbox"], shopId)).toBe(
      true,
    );
    expect(
      shopQueryAffected(["davaq", "user", `/shops/${quoteId}/threads`], shopId),
    ).toBe(false);
    expect(
      shopQueryAffected(["davaq", "user", "/tcg/collection"], shopId),
    ).toBe(false);
  });
  it("refreshes native push subscribers and removes listeners on session cleanup", () => {
    const values = [];
    const stop = subscribeShopPush((id) => values.push(id));
    notifyShopPush({ shopId, threadId: quoteId });
    notifyShopPush({ shopId, threadId: "bad" });
    stop();
    notifyShopPush({ shopId, threadId: quoteId });
    expect(values).toEqual([shopId]);
  });
});
