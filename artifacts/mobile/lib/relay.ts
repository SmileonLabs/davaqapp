import type { Listing } from "./davaq";
export type RelayCandidate = {
  id: string;
  listings: Listing[];
  reasons: string[];
  pending: string[];
};
export type RelaySearch = {
  items: RelayCandidate[];
  offersCount: number;
  scannedCount: number;
  limited: boolean;
};
export type RelayTerms = {
  legs: { listingId: string; startsAt: string; location: string }[];
  note: string;
  cancellation: string;
};
export type RelayMember = {
  user_id: string;
  position: number;
  listing_id: string;
  snapshot: Listing;
  accepted_version: number | null;
  cancel_accepted: boolean;
  provided_at: string | null;
  received_at: string | null;
  evidence: string;
};
export type Relay = {
  id: string;
  creator_id: string;
  room_id: string;
  status: string;
  version: number;
  terms: RelayTerms;
  expires_at: string;
  updated_at: string;
  members: RelayMember[];
  events: {
    id: string;
    actor_id: string;
    kind: string;
    data: { note?: string };
    created_at: string;
  }[];
};
export const relayStatus = (s: string) =>
  ({
    negotiating: "모두의 동의를 기다려요",
    reserved: "연결 완성 · 교환 준비",
    in_progress: "약속대로 주고받는 중",
    completed: "모두 원하는 것을 받았어요",
    cancel_requested: "취소 동의 대기",
    cancelled: "취소된 연결",
    declined: "다른 연결을 찾아봐요",
    expired: "동의 기간이 끝났어요",
    disputed: "도움 요청 확인 중",
  })[s] ?? s;
export function rotateForViewer(listings: Listing[], user?: string) {
  const i = listings.findIndex((l) => l.ownerId === user);
  return i > 0 ? [...listings.slice(i), ...listings.slice(0, i)] : listings;
}
