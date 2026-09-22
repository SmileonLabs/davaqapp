import { z } from "zod/v4";
import {listingGeoInput,meetingPointInput} from "./geoRules";
export const categories = [
  "voice",
  "photo",
  "design",
  "language",
  "tech",
  "music",
  "goods",
  "business",
  "other",
] as const;
export const listingInput = z
  .object({
    mode: z.enum(["offer", "want"]),
    kind: z.enum(["goods", "service", "experience"]),
    category: z.enum(categories),
    title: z.string().trim().min(2).max(80),
    description: z.string().trim().max(3000).default(""),
    wantedText: z.string().trim().max(500).default(""),
    wantedCategories: z.array(z.enum(categories)).max(9).default([]),
    location: z.string().trim().max(80).default(""),
    geo:listingGeoInput.nullable().optional(),
    delivery: z.enum(["online", "offline", "either"]).default("online"),
    durationMinutes: z.number().int().min(5).max(1440).default(30),
    availableDays: z.array(z.number().int().min(0).max(6)).max(7).default([]),
    ev: z.number().int().min(1).max(100000).nullable().default(null),
    imageKey: z.string().max(500).nullable().default(null),
    terms: z.string().trim().max(1500).default(""),
    status: z.enum(["draft", "published", "paused", "closed"]).default("draft"),
    version: z.number().int().positive().optional(),
    requestKey: z.string().min(8).max(100).optional(),
  })
  .strict();
export const termsInput = z
  .object({
    offerStartsAt: z.iso.datetime({ offset: true }),
    requestedStartsAt: z.iso.datetime({ offset: true }),
    location: z.string().trim().min(2).max(200),
    meetingPoint:meetingPointInput.nullable().optional(),
    note: z.string().trim().max(1500).default(""),
    cancellation: z.string().trim().min(5).max(1000),
  })
  .strict();
export type ExchangeTerms = z.infer<typeof termsInput>;
export interface MatchListing {
  id: string;
  owner_id: string;
  mode: string;
  kind: string;
  category: string;
  title: string;
  description: string;
  wanted_text: string;
  wanted_categories: string[];
  delivery: string;
  location: string;
  available_days: number[];
}
export function categoryEligible(input: {
  category: string;
  title: string;
  description: string;
  wantedText?: string;
}) {
  const text = [input.title, input.description, input.wantedText ?? ""].join(
    " ",
  );
  return (
    input.category !== "other" &&
    !/(위스키|와인|주류|담배|전자담배|의약품|처방약|마약|주식\s*추천|투자\s*권유|의료\s*상담|법률\s*자문)/i.test(
      text,
    )
  );
}
export function matchPair(offer: MatchListing, target: MatchListing) {
  if (
    offer.owner_id === target.owner_id ||
    offer.mode !== "offer" ||
    target.mode !== "offer"
  )
    return null;
  if (
    !offer.wanted_categories.includes(target.category) ||
    !target.wanted_categories.includes(offer.category)
  )
    return null;
  const reasons = ["서로의 희망 분야가 맞아요"],
    pending: string[] = [];
  let score = 10;
  const canOnline =
    offer.delivery !== "offline" && target.delivery !== "offline";
  if (canOnline) {
    reasons.push("온라인으로 교환할 수 있어요");
    score += 2;
  } else if (offer.location && target.location) {
    const a = offer.location.split(" ")[0],
      b = target.location.split(" ")[0];
    if (a !== b) return null;
    reasons.push("활동 지역이 맞아요");
    score += 2;
  } else pending.push("만날 지역 확인이 필요해요");
  if (offer.available_days.length && target.available_days.length) {
    if (!offer.available_days.some((d) => target.available_days.includes(d)))
      return null;
    reasons.push("가능한 요일이 겹쳐요");
    score += 2;
  } else pending.push("가능한 날짜를 확인해 주세요");
  pending.push("세부 제공 범위와 일정을 합의해 주세요");
  return { score, reasons, pending };
}
export function participantSide(
  p: { proposer_id: string; recipient_id: string },
  userId: string,
) {
  if (p.proposer_id === userId) return "offer";
  if (p.recipient_id === userId) return "requested";
  return null;
}
export function interval(start: string, minutes: number) {
  const from = new Date(start);
  return { from, to: new Date(from.getTime() + minutes * 60000) };
}
export function overlaps(
  a: { from: Date; to: Date },
  b: { from: Date; to: Date },
) {
  return a.from < b.to && b.from < a.to;
}
export function confirmedMemoryUsable(
  m: { status: string; expires_at?: string | Date | null },
  now = new Date(),
) {
  return (
    m.status === "confirmed" && (!m.expires_at || new Date(m.expires_at) > now)
  );
}
