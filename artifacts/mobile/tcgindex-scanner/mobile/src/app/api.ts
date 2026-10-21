const origin = "https://tcgindex.org";
export async function api<T>(
  path: string,
  options: { signal?: AbortSignal } = {},
): Promise<T> {
  const res = await fetch(origin + "/api/mobile/v1/" + path, {
    signal: options.signal,
    redirect: "error",
  });
  if (!res.ok) throw Object.assign(Error("TCGIndex 카드 정보를 확인하지 못했습니다."), {status: res.status});
  return res.json() as Promise<T>;
}
export const imageUrl = (path: string | null | undefined) =>
  !path ? undefined : path.startsWith("http") ? path : origin + path;
