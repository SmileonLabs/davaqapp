import { useQuery } from "@tanstack/react-query";
import { customFetch } from "@workspace/api-client-react";
import { mediaUri } from "@/lib/apiBase";

interface MediaUrlResponse {
  url: string;
}

function isPrivateObjectPath(value: string | null | undefined): value is string {
  return typeof value === "string" && value.startsWith("/objects/");
}

export async function resolveMediaUri(value: string): Promise<string> {
  if (!isPrivateObjectPath(value)) return mediaUri(value);
  const result = await customFetch<MediaUrlResponse>("/api/storage/media-url", {
    method: "POST",
    body: JSON.stringify({ objectPath: value }),
    responseType: "json",
  });
  return mediaUri(result.url);
}

export function useMediaResource(value: string | null | undefined) {
  const privateObject = isPrivateObjectPath(value);
  const query = useQuery({
    queryKey: ["media-url", value],
    queryFn: () => resolveMediaUri(value!),
    enabled: privateObject,
    staleTime: 4 * 60_000,
    gcTime: 5 * 60_000,
    retry: 1,
  });
  return { uri: !value ? undefined : privateObject ? query.data : mediaUri(value), error: privateObject ? query.error : null, refresh: query.refetch };
}

export function useMediaUri(value: string | null | undefined): string | undefined {
  return useMediaResource(value).uri;
}
