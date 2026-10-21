import { customFetch } from "@workspace/api-client-react";
import type { QueryClient } from "@tanstack/react-query";

export type ContentReportTarget = {
  targetType: "user" | "card_comment" | "listing_comment" | "message";
  targetId: string;
};
export type ContentReportReceipt = { id: string; status: "pending" };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TARGET_TYPES = new Set([
  "user",
  "card_comment",
  "listing_comment",
  "message",
]);

export function reportReasonError(reason: string): string | null {
  const length = reason.trim().length;
  return length < 5 || length > 2000
    ? "신고 사유를 5자 이상 2,000자 이하로 입력해 주세요."
    : null;
}

export async function submitContentReport(
  target: ContentReportTarget,
  reason: string,
): Promise<ContentReportReceipt> {
  if (!TARGET_TYPES.has(target.targetType) || !UUID.test(target.targetId))
    throw new Error("신고할 대상을 다시 열어 주세요.");
  const validation = reportReasonError(reason);
  if (validation) throw new Error(validation);
  const result = await customFetch<ContentReportReceipt>(
    "/api/tcg/content-reports",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...target, reason: reason.trim() }),
      responseType: "json",
      timeoutMs: 20000,
    },
  );
  if (!result || !UUID.test(result.id) || result.status !== "pending")
    throw new Error(
      "접수 여부를 확인하지 못했어요. 같은 사유로 다시 시도해 주세요.",
    );
  return result;
}

export function contentReportError(error: unknown): string {
  const value = error as { status?: number; data?: { error?: string } };
  if (value?.status === 401)
    return "로그인이 만료됐어요. 다시 로그인한 뒤 신고해 주세요.";
  if (value?.status === 404 || value?.data?.error === "target_unavailable")
    return "이 콘텐츠를 더 이상 확인할 수 없어요. 화면을 새로고침해 주세요.";
  if (value?.status === 429 || value?.data?.error === "rate_limited")
    return "신고 요청이 많아요. 잠시 후 다시 시도해 주세요. 입력한 사유는 유지돼요.";
  if (value?.data?.error === "self_report")
    return "내가 작성한 콘텐츠는 신고할 수 없어요.";
  if (value?.status === 400 || value?.data?.error === "invalid_input")
    return "신고할 대상과 사유를 확인해 주세요. 내 콘텐츠는 신고할 수 없어요. 입력한 사유는 유지돼요.";
  return "신고를 접수하지 못했어요. 연결을 확인하고 다시 시도해 주세요. 입력한 사유는 유지돼요.";
}

// Clear content whose visibility changes after a block; keep private collections
// and other signed-in owners' caches intact.
export function isBlockSensitiveQuery(
  queryKey: readonly unknown[],
  ownerId: string | null | undefined,
): boolean {
  const path = queryKey[0];
  if (
    typeof path === "string" &&
    /^\/api\/(rooms|friends|blocked)(\/|$)/.test(path)
  )
    return true;
  if (path !== "davaq" || queryKey[1] !== ownerId) return false;
  const resource = queryKey[2];
  return (
    typeof resource === "string" &&
    (resource === "public-profile" ||
      resource === "exchange-card-feed" ||
      /^\/tcg\/(listings|feed|cards|card-feed)(\/|\?|$)/.test(resource))
  );
}

export async function clearBlockedUserCaches(
  client: QueryClient,
  ownerId: string | null | undefined,
) {
  const filter = {
    predicate: (query: { queryKey: readonly unknown[] }) =>
      isBlockSensitiveQuery(query.queryKey, ownerId),
  };
  await client.cancelQueries(filter).catch(() => undefined);
  // Removing a query with mounted observers can strand the previous screen on
  // its old object. Reset those observers in place, then evict only inactive data.
  void client
    .resetQueries({ ...filter, type: "active" })
    .catch(() => undefined);
  client.removeQueries({ ...filter, type: "inactive" });
}
