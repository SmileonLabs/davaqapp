import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { customFetch, getGetMyPersonaCardQueryKey, getGetMyPersonaQueryKey } from "@workspace/api-client-react";
import { starFeedQueryKey } from "@/hooks/useStarFeed";

export type DailyTalkRewardVisibility = "PRIVATE" | "FRIENDS" | "PUBLIC";
export type DailyTalkRewardOntologySyncStatus = "none" | "pending" | "processing" | "processed" | "retrying" | "failed";

export function dailyTalkRewardSyncLabel(status: DailyTalkRewardOntologySyncStatus | undefined | null): string {
  switch (status) {
    case "pending":
      return "동기화 대기 중";
    case "processing":
      return "분석 반영 중";
    case "processed":
      return "DavaQ 반영 완료";
    case "retrying":
      return "다시 시도 예정";
    case "failed":
      return "동기화 확인 필요";
    case "none":
    default:
      return "동기화 전";
  }
}

export function dailyTalkRewardSyncDescription(status: DailyTalkRewardOntologySyncStatus | undefined | null): string {
  switch (status) {
    case "pending":
      return "동기화 요청이 접수됐어요. 곧 DavaQ에 반영돼요.";
    case "processing":
      return "대화 요약과 평가 점수를 DavaQ 프로필에 반영하는 중이에요.";
    case "processed":
      return "요약/키워드/평가 점수가 DavaQ에 반영됐어요.";
    case "retrying":
      return "일시적인 문제로 잠시 후 자동으로 다시 시도해요.";
    case "failed":
      return "동기화가 완료되지 않았어요. 나중에 다시 확인해 주세요.";
    case "none":
    default:
      return "STAR Point를 받으면 원문 없이 요약/키워드/평가 점수만 동기화돼요.";
  }
}

export interface DailyTalkRewardScores {
  empathy: number;
  communication: number;
  trust: number;
  positivity: number;
  contribution: number;
  spamRisk: number;
  qualityScore: number;
}

export interface DailyTalkRewardAbuse {
  messageCount: number;
  userMessageCount: number;
  otherMessageCount: number;
  counterpartCount: number;
  repeatedMessageRatio: number;
  shortMessageRatio: number;
  selfMessageRatio: number;
  rewardMultiplier: number;
  reductions: string[];
}

export interface DailyTalkRewardStatus {
  canClaim: boolean;
  reason: string | null;
  claimedToday: boolean;
  messageCount: number;
  minMessageCount: number;
  streak: number;
  rewardId: string | null;
  status: string | null;
}

export interface DailyTalkReward {
  id: string;
  rewardDate: string;
  status: string;
  title: string;
  mood: string;
  keywords: string[];
  diary: string;
  summary: string;
  scores: DailyTalkRewardScores;
  grade: string;
  qualityScore: number;
  spamRisk: number;
  pvtAmount: number;
  estimatedPvtAmount: number;
  visibility: DailyTalkRewardVisibility;
  feedPostId: string | null;
  abuse: DailyTalkRewardAbuse | null;
  ontologySyncStatus: DailyTalkRewardOntologySyncStatus;
  ontologySyncedAt: string | null;
  rewardedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export const dailyTalkRewardStatusQueryKey = ["daily-talk-reward", "status"] as const;
export const dailyTalkRewardHistoryQueryKey = ["daily-talk-reward", "history"] as const;
export const dailyTalkRewardQueryKey = (id: string) => ["daily-talk-reward", id] as const;

export function useDailyTalkRewardStatus() {
  return useQuery({
    queryKey: dailyTalkRewardStatusQueryKey,
    queryFn: () => customFetch<DailyTalkRewardStatus>("/api/daily-talk-reward/status", { responseType: "json" }),
  });
}

export function useDailyTalkReward(id: string | undefined) {
  return useQuery({
    queryKey: dailyTalkRewardQueryKey(id ?? ""),
    enabled: !!id,
    queryFn: () => customFetch<DailyTalkReward>(`/api/daily-talk-reward/${id}`, { responseType: "json" }),
  });
}

export function useDailyTalkRewardHistory() {
  return useQuery({
    queryKey: dailyTalkRewardHistoryQueryKey,
    queryFn: () => customFetch<DailyTalkReward[]>("/api/daily-talk-reward/history", { responseType: "json" }),
  });
}

export function useGenerateDailyTalkReward() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => customFetch<DailyTalkReward>("/api/daily-talk-reward/generate", { method: "POST", responseType: "json" }),
    onSuccess: (reward) => {
      queryClient.setQueryData(dailyTalkRewardQueryKey(reward.id), reward);
      queryClient.invalidateQueries({ queryKey: dailyTalkRewardStatusQueryKey });
      queryClient.invalidateQueries({ queryKey: dailyTalkRewardHistoryQueryKey });
      queryClient.invalidateQueries({ queryKey: getGetMyPersonaQueryKey() });
      queryClient.invalidateQueries({ queryKey: getGetMyPersonaCardQueryKey() });
    },
  });
}

export function useUpdateDailyTalkReward() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...body }: { id: string; title?: string; diary?: string; visibility?: DailyTalkRewardVisibility }) =>
      customFetch<DailyTalkReward>(`/api/daily-talk-reward/${id}`, {
        method: "PATCH",
        responseType: "json",
        body: JSON.stringify(body),
      }),
    onSuccess: (reward) => {
      queryClient.setQueryData(dailyTalkRewardQueryKey(reward.id), reward);
      queryClient.invalidateQueries({ queryKey: dailyTalkRewardHistoryQueryKey });
    },
  });
}

export function useSaveDailyTalkReward() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => customFetch<DailyTalkReward>(`/api/daily-talk-reward/${id}/save`, { method: "POST", responseType: "json" }),
    onSuccess: (reward) => {
      queryClient.setQueryData(dailyTalkRewardQueryKey(reward.id), reward);
      queryClient.invalidateQueries({ queryKey: dailyTalkRewardStatusQueryKey });
      queryClient.invalidateQueries({ queryKey: dailyTalkRewardHistoryQueryKey });
      queryClient.invalidateQueries({ queryKey: getGetMyPersonaQueryKey() });
      queryClient.invalidateQueries({ queryKey: getGetMyPersonaCardQueryKey() });
    },
  });
}

export function usePostDailyTalkRewardToFeed() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => customFetch<DailyTalkReward>(`/api/daily-talk-reward/${id}/post-to-feed`, { method: "POST", responseType: "json" }),
    onSuccess: (reward) => {
      queryClient.setQueryData(dailyTalkRewardQueryKey(reward.id), reward);
      queryClient.invalidateQueries({ queryKey: dailyTalkRewardStatusQueryKey });
      queryClient.invalidateQueries({ queryKey: dailyTalkRewardHistoryQueryKey });
      queryClient.invalidateQueries({ queryKey: starFeedQueryKey });
      queryClient.invalidateQueries({ queryKey: getGetMyPersonaQueryKey() });
      queryClient.invalidateQueries({ queryKey: getGetMyPersonaCardQueryKey() });
    },
  });
}
