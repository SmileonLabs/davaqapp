import type { Listing, Match } from "./davaq";
import type { RelayCandidate } from "./relay";

export type Wish = {
  id: string;
  title: string;
  description: string;
  keywords: string[];
  category: string;
  kind: "goods" | "service" | "experience";
  imageKey: string | null;
  status: "active" | "paused" | "fulfilled" | "deleted";
  version: number;
  createdAt: string;
  updatedAt: string;
  lastSearchedAt: string | null;
  candidateCount: number;
};
export type WishDraft = Pick<
  Wish,
  "title" | "description" | "keywords" | "category" | "kind"
> & { questions: string[] };
export type WishCandidates = {
  direct: Match[];
  relays: RelayCandidate[];
  targets: Listing[];
  offersCount: number;
  targetCount: number;
  scannedCount: number;
  limited: boolean;
  searchedAt: string;
};
export const wishStatus = (status: Wish["status"]) =>
  ({
    active: "교환 찾기",
    paused: "잠시 쉬기",
    fulfilled: "구했어요",
    deleted: "삭제됨",
  })[status];
export const wishPath = (id: string) =>
  "/exchange/wishes/" + encodeURIComponent(id);
