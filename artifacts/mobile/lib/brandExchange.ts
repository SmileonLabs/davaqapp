import { useDavaq } from "./davaq";
export type BrandCampaign = {
  id: string;
  versionId: string;
  title: string;
  brand: string;
  description: string;
  category: string;
  rewardType: string;
  rewardTitle: string;
  terms: string;
  extraCost: string;
  support: string;
  region: string;
  online: boolean;
  endsAt: string;
  duration: number;
  differences: number;
  available: number;
  canStart?: boolean;
  status: string;
  reason?: string;
  participationId: string | null;
  participationStatus: string | null;
};
export type BrandParticipation = {
  id: string;
  campaignId: string;
  status: string;
  attempt: number;
  sequence: number;
  progress: number;
  found: number;
  clicks: number;
  expiresAt: string;
  claimId: string | null;
  title: string;
  rewardTitle: string;
  videoA: string;
  videoB: string;
  duration: number;
  differences: number;
  notice?: string;
};
export type BrandReward = {
  id: string;
  status: string;
  participationId: string;
  title: string;
  brand: string;
  terms: string;
  extraCost: string;
  support: string;
  validUntil: string;
  issuedAt: string | null;
  selfUsedAt: string | null;
  issue: string;
  resolution: string;
};
export type BrandPreferences = {
  categories: string[];
  region: string;
  personalized: boolean;
  version: number;
  discoveries?: number;
};
export const rewardCategories = [
  ["food", "음식·카페"],
  ["culture", "문화·취미"],
  ["learning", "배움·경험"],
  ["life", "생활"],
] as const;
export const rewardTypes: Record<string, string> = {
  coupon: "쿠폰",
  product: "상품 교환권",
  experience: "체험권",
};
export const brandState = (s: string) =>
  ({
    held: "보상 확보됨",
    playing: "참여 중",
    paused: "이어하기",
    succeeded: "교환 성공",
    failed: "도전 종료",
    abandoned: "참여 종료",
    expired: "시간 만료",
    pending: "지급 준비 중",
    issued: "지급 완료",
    needs_reconciliation: "지급 확인 중",
  })[s] ?? s;
export const useBrandRecommendations = () =>
  useDavaq<{ items: BrandCampaign[]; enabled: boolean }>(
    "/brand-exchanges?recommended=true",
  );
