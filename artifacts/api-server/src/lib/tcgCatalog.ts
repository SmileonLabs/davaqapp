import { z } from "zod/v4";
export class TcgError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
export function demand(
  value: unknown,
  status: number,
  message: string,
): asserts value {
  if (!value) throw new TcgError(status, message);
}
export const upstream = new URL(
  process.env.TCGINDEX_ORIGIN ?? "https://tcgindex.org",
);
if (upstream.protocol !== "https:" && upstream.hostname !== "localhost")
  throw Error("TCGINDEX_ORIGIN must use HTTPS");
export const cardId = z
  .string()
  .max(200)
  .regex(
    /^(kream:\d+|justtcg:[a-f0-9-]{36}|cardmarket:[a-z_]+:\d+:(regular|foil))$/,
  );
export async function tcgRead(
  path: string,
  params: Record<string, string> = {},
  timeoutMs = 15000,
) {
  const url = new URL(path, upstream);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const response = await fetch(url, {
    signal: AbortSignal.timeout(timeoutMs),
    redirect: "error",
    headers: { accept: "application/json" },
  });
  if (!response.ok)
    throw new TcgError(
      response.status === 404 ? 404 : 503,
      "TCGIndex 카드 정보를 불러오지 못했습니다.",
    );
  return response.json() as Promise<any>;
}
export async function resolveCard(id: string, name = "") {
  cardId.parse(id);
  const data = await tcgRead("/api/mobile/v1/cards/detail", { id, name });
  demand(data.target?.id === id, 503, "카드 식별 정보가 일치하지 않습니다.");
  return data;
}
export const absoluteCardUrl = (path: string | null | undefined) =>
  path ? new URL(path, upstream).href : null;
