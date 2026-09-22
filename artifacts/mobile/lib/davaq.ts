import type {ListingGeo,MeetingPoint} from "./maps";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { customFetch, createRequestId } from "@workspace/api-client-react";
import { useFocusEffect } from "expo-router";
import { useCallback } from "react";

export type Listing = {
  id: string;
  ownerId: string;
  ownerName: string;
  mode: "offer" | "want";
  kind: "goods" | "service" | "experience";
  category: string;
  title: string;
  description: string;
  wantedText: string;
  wantedCategories: string[];
  location: string;
  geo?:ListingGeo|null;
  delivery: "online" | "offline" | "either";
  durationMinutes: number;
  availableDays: number[];
  ev: number | null;
  imageKey: string | null;
  reviewNote?: string;
  status: string;
  terms: string;
  version: number;
  favorite: boolean;
};
export type Terms = {
  meetingPoint?:MeetingPoint|null;
  offerStartsAt: string;
  requestedStartsAt: string;
  location: string;
  note: string;
  cancellation: string;
};
export type Match = {
  id: string;
  offer: Listing;
  target: Listing;
  reasons: string[];
  pending: string[];
};
export type Proposal = {
  id: string;
  proposer_id: string;
  recipient_id: string;
  proposer_name: string;
  recipient_name: string;
  room_id: string;
  offer_id: string;
  requested_id: string;
  version: number;
  status: string;
  terms: Terms;
  snapshots: { offer: Listing; requested: Listing };
  expires_at: string;
  updated_at: string;
  acceptances: string[];
  fulfillments: {
    provider_id: string;
    provided_at: string | null;
    received_at: string | null;
    evidence: string;
  }[];
  events: {
    id: string;
    actor_id: string;
    kind: string;
    data: { note?: string; version?: number };
    created_at: string;
  }[];
  reviews: {
    author_id: string;
    text: string;
    feedback: string;
    created_at: string;
  }[];
};
export type Memory = {
  id: string;
  label: string;
  kind: string;
  status: string;
  source_type: string;
  source_id: string;
  expires_at: string | null;
  updated_at: string;
};
export type Agent = {
  settings: {
    name: string;
    tone: "warm" | "brief";
    activity_learning: boolean;
    chat_learning: boolean;
    auto_search: boolean;
    allowed_room_ids: string[];
    consent_version: number;
  };
  memories: Memory[];
  events: { kind: string; source_id: string; created_at: string }[];
  level: number;
  stage: string;
  hasListing: boolean;
  job: null | {
    status: string;
    requested_at: string;
    finished_at: string | null;
    error: string | null;
    result_count: number;
  };
};
export type Page<T> = { items: T[]; nextOffset?: number | null };
export const categories = [
  ["voice", "목소리·발성", "mic"],
  ["photo", "사진·영상", "camera"],
  ["design", "디자인", "pen-tool"],
  ["language", "언어", "globe"],
  ["tech", "IT·개발", "code"],
  ["music", "음악", "music"],
  ["goods", "물건", "box"],
  ["business", "경영·멘토링", "briefcase"],
  ["other", "기타", "more-horizontal"],
] as const;
export const categoryName = (key: string) =>
  categories.find((c) => c[0] === key)?.[1] ?? key;
export const kindName = (kind: string) =>
  ({ goods: "물건", service: "재능", experience: "경험" })[kind] ?? kind;
export const statusName = (status: string) =>
  ({
    draft: "임시 저장",
    pending: "검토 중",
    published: "공개 중",
    paused: "잠시 숨김",
    closed: "마감",
    negotiating: "제안 · 동의 대기",
    reserved: "예약 확정",
    in_progress: "교환 진행 중",
    cancel_requested: "취소 동의 대기",
    cancelled: "취소됨",
    declined: "거절됨",
    expired: "만료됨",
    disputed: "운영 검토 중",
    completed: "교환 완료",
  })[status] ?? status;
export const key = createRequestId;
export function errorText(error: unknown): string {
  const e = error as { data?: { message?: string }; message?: string };
  return e?.data?.message ?? e?.message ?? "잠시 후 다시 시도해 주세요.";
}
export function api<T>(path: string, method = "GET", body?: unknown) {
  return customFetch<T>("/api" + path, {
    method,
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
}
export function useDavaq<T>(path: string, enabled = true) {
  const query = useQuery({
    queryKey: ["davaq", path],
    queryFn: ({ signal }) => customFetch<T>("/api" + path, { signal }),
    enabled,
    staleTime: 15000,
  });
  useFocusEffect(
    useCallback(() => {
      if (enabled) void query.refetch();
    }, [path, enabled, query.refetch]),
  );
  return query;
}
export function useDavaqMutation<T = unknown>() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({
      path,
      method = "POST",
      body,
    }: {
      path: string;
      method?: string;
      body?: unknown;
    }) => api<T>(path, method, body),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ["davaq"] });
      void client.invalidateQueries({ queryKey: ["/api/rooms"] });
    },
  });
}
export function dateLabel(value: string | null | undefined) {
  if (!value) return "일정 협의";
  const date = new Date(value);
  return Number.isNaN(date.valueOf())
    ? "일정 확인 필요"
    : date.toLocaleString("ko-KR", {
        month: "short",
        day: "numeric",
        weekday: "short",
        hour: "2-digit",
        minute: "2-digit",
        timeZone: "Asia/Seoul",
      });
}
export function listingBody(l: Listing, status = l.status) {
  return {
    mode: l.mode,
    kind: l.kind,
    category: l.category,
    title: l.title,
    description: l.description,
    wantedText: l.wantedText,
    wantedCategories: l.wantedCategories,
    location: l.location,
    geo:l.delivery==='online'?null:l.geo??null,
    delivery: l.delivery,
    durationMinutes: l.durationMinutes,
    availableDays: l.availableDays,
    ev: l.ev,
    imageKey: l.imageKey,
    terms: l.terms,
    status,
    version: l.version,
  };
}
