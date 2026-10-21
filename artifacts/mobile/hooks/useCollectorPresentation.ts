import { useQuery } from "@tanstack/react-query";
import { customFetch } from "@workspace/api-client-react";

// One server-controlled presentation contract shared by web and native.
// Empty/missing settings hide the label; failures never restore old fixed copy.
export function useCollectorPresentation(roomId: string) {
  const q = useQuery({
    queryKey: ["collector-lounge"],
    queryFn: () =>
      customFetch<{ presentation?: { messageLabel?: string | null } }>(
        "/api/collector-lounge",
        { responseType: "json" },
      ),
    enabled: !!roomId,
    staleTime: 15000,
    refetchInterval: 30000,
    refetchOnWindowFocus: true,
    retry: false,
  });
  const value = q.data?.presentation?.messageLabel;
  return typeof value === "string" ? value.trim().slice(0, 80) : "";
}
