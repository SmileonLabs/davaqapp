import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { customFetch, createRequestId } from "@workspace/api-client-react";
import { useFocusEffect } from "expo-router";
import { useAuth } from "@/lib/davaqAuth";
import { useCallback } from "react";
export const key = createRequestId;
export function errorText(error: unknown): string {
  const e = error as { data?: { message?: string }; message?: string };
  return e?.data?.message ?? e?.message ?? "잠시 후 다시 시도해 주세요.";
}
export function api<T>(path: string, method = "GET", body?: unknown) {
  return customFetch<T>("/api" + path, {
    method,
    timeoutMs: method === "GET" ? 15000 : 30000,
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
}
export function useDavaq<T>(path: string, enabled = true) {
  const { userId, isSignedIn } = useAuth();
  const query = useQuery({
    queryKey: ["davaq", userId, path],
    queryFn: ({ signal }) => customFetch<T>("/api" + path, { signal, timeoutMs: 15000 }),
    enabled: enabled && !!isSignedIn,
    staleTime: 15000,
  });
  useFocusEffect(
    useCallback(() => {
      if (enabled && isSignedIn) void query.refetch();
    }, [path, enabled, isSignedIn, query.refetch]),
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
