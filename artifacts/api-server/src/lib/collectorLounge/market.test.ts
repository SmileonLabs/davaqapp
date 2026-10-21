import { it, expect, vi } from "vitest";
vi.mock("../tcgCatalog", () => ({ tcgRead: vi.fn() }));
import { marketObservation } from "./market";
const now = new Date("2026-10-20T04:00:00Z");
function sample() {
  return {
    target: {
      id: "kream:42",
      name: "카드 판본 A",
      currency: "KRW",
      priceType: "LISTED",
      condition: "SOURCE_PRODUCT",
      observedAt: "2026-10-20T01:00:00Z",
    },
    history: Array.from({ length: 8 }, (_, i) => ({
      date: `2026-10-${String(13 + i).padStart(2, "0")}`,
      amount: 10000 + i * 1000,
      currency: "KRW",
    })),
  };
}
it("calculates only a same-product KRW listing observation, never sales or popularity", () => {
  expect(marketObservation("kream:42", sample(), now)).toMatchObject({
    priceType: "LISTED",
    scope: "source_product",
    fromDate: "2026-10-13",
    toDate: "2026-10-20",
    from: 10000,
    to: 17000,
    changePercent: 70,
    points: 8,
    conditionLabel: "원문 상품 기준 · 상태/등급 미분리",
  });
  expect(marketObservation("kream:42", sample(), now)).not.toHaveProperty(
    "salesVolume",
  );
});
it("rejects another card, unsupported currency or a price type that could mislabel the series", () => {
  const data = sample();
  expect(marketObservation("kream:99", data, now)).toBeNull();
  data.target.priceType = "SOLD";
  expect(marketObservation("kream:42", data, now)).toBeNull();
  data.target.priceType = "LISTED";
  data.target.currency = "USD";
  expect(marketObservation("kream:42", data, now)).toBeNull();
});
it("requires fresh provenance and enough dated observations", () => {
  let data = sample();
  data.target.observedAt = "2026-10-10T00:00:00Z";
  expect(marketObservation("kream:42", data, now)).toBeNull();
  data = sample();
  data.target.observedAt = "2026-10-22T00:00:00Z";
  expect(marketObservation("kream:42", data, now)).toBeNull();
  data = sample();
  data.history = data.history.slice(4);
  expect(marketObservation("kream:42", data, now)).toBeNull();
});
it("rejects conflicting dates and missing currency evidence instead of selecting a convenient price", () => {
  let data = sample();
  data.history.push({ ...data.history[0], amount: 50000 });
  expect(marketObservation("kream:42", data, now)).toBeNull();
  data = sample();
  data.history = data.history.map((p) => ({ ...p, currency: "USD" }));
  expect(marketObservation("kream:42", data, now)).toBeNull();
});
it("does not compare zero, invalid or future amounts and stale end dates", () => {
  let data = sample();
  data.history[0].amount = 0;
  expect(marketObservation("kream:42", data, now)).toBeNull();
  data = sample();
  data.history[7].date = "2026-10-25";
  expect(marketObservation("kream:42", data, now)).toBeNull();
  data = sample();
  data.history = data.history.map((p) => ({
    ...p,
    date: p.date.replace("2026-10", "2026-09"),
  }));
  expect(marketObservation("kream:42", data, now)).toBeNull();
});
