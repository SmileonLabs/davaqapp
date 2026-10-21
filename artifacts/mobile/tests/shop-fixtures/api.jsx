import { useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useFocusEffect } from "./router";
export const key = () => crypto.randomUUID();
export const errorText = (e) => e?.message ?? String(e);
export async function api(path, method = "GET", body) {
  const r = await fetch("/api" + path, {
    method,
    headers: {
      "content-type": "application/json",
      "x-fixture-actor": window.fixtureActor,
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  if (!r.ok) throw Error((await r.json()).message ?? r.statusText);
  if (r.status === 204) return null;
  return r.json();
}
export function useDavaq(path, enabled = true) {
  const q = useQuery({
    queryKey: ["davaq", window.fixtureActor, path],
    queryFn: () => api(path),
    enabled,
    staleTime: 15000,
    retry: false,
  });
  useFocusEffect(
    useCallback(() => {
      if (enabled) void q.refetch();
    }, [path, enabled, q.refetch]),
  );
  return q;
}
export function useDavaqMutation() {
  const c = useQueryClient();
  return useMutation({
    mutationFn: ({ path, method, body }) => api(path, method, body),
    onSuccess: () => c.invalidateQueries({ queryKey: ["davaq"] }),
  });
}
