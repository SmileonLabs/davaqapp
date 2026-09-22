import { describe, it, expect } from "vitest";
import {
  findRelayCycles,
  canonicalRelay,
  relayEdge,
  type RelayListing,
} from "./relayRules";
const offer = (
  id: string,
  category: string,
  wants: string[],
  owner = id,
): RelayListing => ({
  id,
  owner_id: owner,
  mode: "offer",
  kind: "service",
  category,
  title: category + " 레슨",
  description: "",
  wanted_text: "",
  wanted_categories: wants,
  delivery: "online",
  location: "",
  available_days: [],
  status: "published",
  version: 1,
  duration_minutes: 30,
});
describe("relay graph", () => {
  it("finds a directed three-person cycle even when no pair is reciprocal", () => {
    const a = offer("a", "voice", ["tech"]),
      b = offer("b", "photo", ["voice"]),
      c = offer("c", "tech", ["photo"]);
    expect(relayEdge(a, c)).toBeNull();
    expect(
      findRelayCycles([a, b, c], "a").items[0].listings.map((l) => l.id),
    ).toEqual(["a", "b", "c"]);
  });
  it("finds four-person cycles and normalizes rotations without reversing direction", () => {
    const all = [
      offer("a", "voice", ["tech"]),
      offer("b", "photo", ["voice"]),
      offer("c", "music", ["photo"]),
      offer("d", "tech", ["music"]),
    ];
    expect(findRelayCycles(all, "a").items).toHaveLength(1);
    expect(findRelayCycles(all, "c").items[0].id).toBe(
      canonicalRelay(["a", "b", "c", "d"]),
    );
    expect(canonicalRelay(["a", "d", "c", "b"])).not.toBe(
      canonicalRelay(["a", "b", "c", "d"]),
    );
  });
  it("does not invent a closing edge, repeat owners, include private offers or bypass blocks", () => {
    const a = offer("a", "voice", ["tech"]),
      b = offer("b", "photo", ["voice"]),
      c = offer("c", "tech", ["photo"]);
    expect(
      findRelayCycles([a, b, { ...c, wanted_categories: ["music"] }], "a")
        .items,
    ).toHaveLength(0);
    expect(
      findRelayCycles([a, b, { ...c, owner_id: "a" }], "a").items,
    ).toHaveLength(0);
    expect(
      findRelayCycles([a, b, { ...c, status: "draft" }], "a").items,
    ).toHaveLength(0);
    expect(
      findRelayCycles([a, b, c], "a", (x, y) => x.id === "a" && y.id === "c")
        .items,
    ).toHaveLength(0);
  });
  it("excludes incompatible offline regions and days; broad category matches remain tentative", () => {
    const a = offer("a", "goods", ["music"]),
      b = offer("b", "music", ["goods"]);
    expect(
      relayEdge(
        { ...a, delivery: "offline", location: "서울" },
        { ...b, delivery: "offline", location: "부산" },
      ),
    ).toBeNull();
    expect(
      relayEdge({ ...a, available_days: [1] }, { ...b, available_days: [2] }),
    ).toBeNull();
    expect(relayEdge(a, b)?.pending).toContain("품목");
  });
});
