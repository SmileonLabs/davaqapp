import { z } from "zod/v4";
import { meetingPointInput } from "./geoRules";
import { categoryEligible, type MatchListing } from "./exchangeRules";

export const relayTermsInput = z
  .object({
    legs: z
      .array(
        z
          .object({
            listingId: z.uuid(),
            startsAt: z.iso.datetime({ offset: true }),
            location: z.string().trim().min(2).max(200),
            meetingPoint: meetingPointInput.nullable().optional(),
          })
          .strict(),
      )
      .min(3)
      .max(4),
    note: z.string().trim().max(1500).default(""),
    cancellation: z.string().trim().min(5).max(1000),
  })
  .strict();
export type RelayTerms = z.infer<typeof relayTermsInput>;
export type RelayListing = MatchListing & {
  status: string;
  version: number;
  duration_minutes: number;
  owner_name?: string;
};
export function relayEligible(l: RelayListing) {
  return (
    l.mode === "offer" &&
    l.status === "published" &&
    categoryEligible({
      category: l.category,
      title: l.title,
      description: l.description,
      wantedText: l.wanted_text,
    })
  );
}
/** A directed edge: the next owner receives this owner's offer. */
export function relayEdge(giver: RelayListing, receiver: RelayListing) {
  if (
    giver.owner_id === receiver.owner_id ||
    !receiver.wanted_categories.includes(giver.category)
  )
    return null;
  const online =
    giver.delivery !== "offline" && receiver.delivery !== "offline";
  if (
    !online &&
    giver.location &&
    receiver.location &&
    giver.location.split(" ")[0] !== receiver.location.split(" ")[0]
  )
    return null;
  if (
    giver.available_days.length &&
    receiver.available_days.length &&
    !giver.available_days.some((d) => receiver.available_days.includes(d))
  )
    return null;
  const tokens = receiver.wanted_text
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter(
      (w) =>
        w.length >= 2 &&
        !/^(원해|원하는|싶어|있어요|교환|받고|가능|해주세요)/.test(w),
    );
  const concrete = tokens.some((t) =>
    (giver.title + " " + giver.description).toLowerCase().includes(t),
  );
  return {
    score: 10 + (online ? 2 : 0) + (concrete ? 4 : 0),
    reason: concrete
      ? "받고 싶은 내용과 관련된 제공이에요"
      : "받고 싶은 분야가 연결돼요",
    pending: concrete
      ? "세부 제공 범위와 일정을 확인해 주세요"
      : "분야가 맞는 후보예요. 원하는 품목·제공 범위를 확인해 주세요",
  };
}
export function canonicalRelay(ids: string[]) {
  return ids
    .map((_, i) => [...ids.slice(i), ...ids.slice(0, i)].join("."))
    .sort()[0];
}
export function findRelayCycles(
  listings: RelayListing[],
  viewer: string,
  excluded: (giver: RelayListing, receiver: RelayListing) => boolean = () =>
    false,
  edgeFor: typeof relayEdge = relayEdge,
) {
  const eligible = listings.filter(relayEligible);
  const edges = new Map<string, { listing: RelayListing; score: number }[]>();
  // A bounded graph keeps search responsive even when a broad category is popular.
  let pruned = false;
  for (const a of eligible) {
    const outgoing = eligible
      .flatMap((b) => {
        const e = edgeFor(a, b);
        return e && !excluded(a, b) ? [{ listing: b, score: e.score }] : [];
      })
      .sort(
        (a, b) => b.score - a.score || a.listing.id.localeCompare(b.listing.id),
      )
      .slice(0, 25);
    pruned ||= outgoing.length > 24;
    edges.set(a.id, outgoing.slice(0, 24));
  }
  const found = new Map<
    string,
    { id: string; listings: RelayListing[]; score: number }
  >();
  let visited = 0;
  for (const start of eligible
    .filter((l) => l.owner_id === viewer)
    .slice(0, 20)) {
    const walk = (path: RelayListing[], score: number) => {
      if (++visited > 40000) return;
      const last = path[path.length - 1];
      if (path.length >= 3) {
        const edge = edgeFor(last, start);
        if (edge && !excluded(last, start)) {
          const id = canonicalRelay(path.map((l) => l.id));
          if (!found.has(id))
            found.set(id, { id, listings: path, score: score + edge.score });
        }
      }
      if (path.length === 4) return;
      for (const e of edges.get(last.id) ?? []) {
        if (
          path.some((l) => l.owner_id === e.listing.owner_id) ||
          path.some((l) => excluded(l, e.listing) || excluded(e.listing, l))
        )
          continue;
        walk([...path, e.listing], score + e.score);
      }
    };
    walk([start], 0);
  }
  return {
    items: [...found.values()]
      .sort(
        (a, b) =>
          b.score / b.listings.length - a.score / a.listings.length ||
          a.listings.length - b.listings.length ||
          a.id.localeCompare(b.id),
      )
      .slice(0, 12),
    capped: pruned || visited > 40000,
  };
}
