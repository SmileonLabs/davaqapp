import { describe, expect, it, vi } from "vitest";
vi.mock("@workspace/db", () => ({ pool: { query: vi.fn() } }));
vi.mock("./realtime", () => ({ publishRealtimeEvent: vi.fn() }));
import {
  matchesWish,
  goalRelayEdge,
  wishGoalContextInput,
  type WishGoalContext,
} from "./wishMatching";
import { findRelayCycles, type RelayListing } from "./relayRules";
const owner = "d3e5dd36-a54c-45cf-9802-33aef30d196c";
const goal: WishGoalContext = {
  id: "8194a8b6-572c-4bcd-b92f-0dd282a6c70e",
  ownerId: owner,
  title: "Sony WH-1000XM5 헤드폰",
  keywords: ["WH-1000XM5"],
  kind: "goods",
  category: "goods",
};
const offer = (
  id: string,
  category: string,
  wants: string[],
  user = id,
  extra: Partial<RelayListing> = {},
): RelayListing => ({
  id,
  owner_id: user,
  mode: "offer",
  kind: "service",
  category,
  title: category + " 제공",
  description: "",
  wanted_text: "",
  wanted_categories: wants,
  delivery: "online",
  location: "",
  available_days: [],
  status: "published",
  version: 1,
  duration_minutes: 30,
  ...extra,
});
const headphone = offer("c", "goods", ["photo"], "c", {
  kind: "goods",
  title: "Sony WH-1000XM5 헤드폰",
  description: "본체와 케이스를 제공합니다",
});
describe("wish identity matching", () => {
  it("requires a real item identity, not merely the same broad category", () => {
    expect(matchesWish(goal, headphone)).not.toBeNull();
    expect(matchesWish(goal, { ...headphone, title: "캠핑 의자" })).toBeNull();
    expect(matchesWish(goal, { ...headphone, category: "tech" })).toBeNull();
    expect(matchesWish(goal, { ...headphone, kind: "service" })).toBeNull();
  });
  it("keeps model generations distinct and ignores a comparison in the description", () => {
    expect(
      matchesWish(goal, {
        ...headphone,
        title: "Sony WH-1000XM4 헤드폰",
        description: "WH-1000XM5보다 저렴해요",
      }),
    ).toBeNull();
    expect(
      matchesWish(goal, { ...headphone, title: "Sony WH-1000XM50 헤드폰" }),
    ).toBeNull();
    expect(
      matchesWish(goal, { ...headphone, title: "Sony WH1000XM5 헤드폰" }),
    ).not.toBeNull();
  });
  it("does not confuse wanted items with the offered item or accept incidental description-only mentions", () => {
    expect(
      matchesWish(goal, {
        ...headphone,
        title: "중고 가방",
        description: headphone.title,
      }),
    ).toBeNull();
    expect(
      matchesWish(goal, {
        ...headphone,
        title: "Sony 헤드폰",
        description: "",
        wanted_text: "WH-1000XM5 원해요",
      }),
    ).toBeNull();
  });
  it("preserves standalone generation numbers and explicit product keywords", () => {
    const g = { ...goal, title: "에어팟 프로 2", keywords: [] };
    expect(
      matchesWish(g, { ...headphone, title: "애플 에어팟 프로2" }),
    ).not.toBeNull();
    expect(matchesWish(g, { ...headphone, title: "에어팟 프로20" })).toBeNull();
    expect(
      matchesWish(
        { ...g, keywords: ["미개봉"] },
        { ...headphone, title: "에어팟 프로2", description: "사용한 제품" },
      ),
    ).toBeNull();
  });
  it("rejects an empty or ineligible goal and emits verification language", () => {
    expect(
      matchesWish({ ...goal, title: "갖고 싶어요", keywords: [] }, headphone),
    ).toBeNull();
    expect(
      matchesWish(goal, {
        ...headphone,
        title: headphone.title + " 와인 포함",
      }),
    ).toBeNull();
    expect(matchesWish(goal, headphone)?.pending).toContain("정확한 모델");
  });
});
describe("accessory exclusions", () => {
  it("does not treat a compatible case or empty box as the wished-for product", () => {
    expect(
      matchesWish(goal, {
        ...headphone,
        title: "Sony WH-1000XM5 헤드폰 케이스",
      }),
    ).toBeNull();
    expect(
      matchesWish(goal, {
        ...headphone,
        title: "Sony WH-1000XM5 헤드폰",
        description: "본체 없음. 케이스만 제공",
      }),
    ).toBeNull();
    expect(
      matchesWish(goal, {
        ...headphone,
        title: "Sony WH-1000XM5 헤드폰 본체 + 케이스",
      }),
    ).not.toBeNull();
    expect(
      matchesWish(
        { ...goal, title: goal.title + " 케이스" },
        { ...headphone, title: goal.title + " 케이스" },
      ),
    ).not.toBeNull();
  });
});
describe("goal-specific relay closing edge", () => {
  const a = offer("a", "voice", ["tech"], owner),
    b = offer("b", "photo", ["voice"]);
  const edge = (giver: RelayListing, receiver: RelayListing) =>
    goalRelayEdge(goal, giver, receiver);
  it("finds a goal-specific three-way path without changing the public offer preference", () => {
    expect(findRelayCycles([a, b, headphone], owner).items).toHaveLength(0);
    expect(
      findRelayCycles(
        [a, b, headphone],
        owner,
        () => false,
        edge,
      ).items[0].listings.map((l) => l.id),
    ).toEqual(["a", "b", "c"]);
    expect(a.wanted_categories).toEqual(["tech"]);
  });
  it("does not override another participant's preferences or invent a goal endpoint", () => {
    expect(
      findRelayCycles(
        [a, { ...b, wanted_categories: ["music"] }, headphone],
        owner,
        () => false,
        edge,
      ).items,
    ).toHaveLength(0);
    expect(
      findRelayCycles(
        [a, b, { ...headphone, title: "Sony WH-1000XM4 헤드폰" }],
        owner,
        () => false,
        edge,
      ).items,
    ).toHaveLength(0);
  });
  it("retains all-participant block checks and receiver availability constraints", () => {
    expect(
      findRelayCycles(
        [a, b, headphone],
        owner,
        (x, y) => x.owner_id === "b" && y.owner_id === "c",
        edge,
      ).items,
    ).toHaveLength(0);
    expect(
      edge(
        { ...headphone, available_days: [2] },
        { ...a, available_days: [1] },
      ),
    ).toBeNull();
    expect(
      edge(
        { ...headphone, delivery: "offline", location: "서울" },
        { ...a, delivery: "offline", location: "부산" },
      ),
    ).toBeNull();
  });
  it("supports four-way paths with the same goal and keeps private screenshots out of the snapshot", () => {
    const c = offer("middle", "music", ["photo"]);
    expect(
      findRelayCycles(
        [a, b, c, { ...headphone, wanted_categories: ["music"] }],
        owner,
        () => false,
        edge,
      ).items[0].listings.map((l) => l.id),
    ).toEqual(["a", "b", "middle", "c"]);
    expect(
      wishGoalContextInput.safeParse({ ...goal, imageKey: "private.png" })
        .success,
    ).toBe(false);
    expect(
      wishGoalContextInput.safeParse({ ...goal, description: "private notes" })
        .success,
    ).toBe(false);
  });
});
