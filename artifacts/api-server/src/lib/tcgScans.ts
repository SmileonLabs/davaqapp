import { pool } from "@workspace/db";
import { upstream, demand, TcgError } from "./tcgCatalog";
import { ObjectStorageService } from "./objectStorage";
import { validatePhotos } from "./tcgService";
const storage = new ObjectStorageService();
async function bridge(
  path: string,
  init: RequestInit = {},
  params: Record<string, string> = {},
) {
  const secret = process.env.TCG_DAVAQ_SHARED_KEY;
  demand(
    secret && secret.length >= 32,
    503,
    "TCGIndex 공통 인식 연결이 설정되지 않았습니다.",
  );
  const url = new URL("/api/mobile/v1/davaq/" + path, upstream);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const res = await fetch(url, {
    ...init,
    headers: { ...init.headers, authorization: "Bearer " + secret },
    signal: AbortSignal.timeout(30000),
    redirect: "error",
  });
  if (!res.ok)
    throw new TcgError(
      res.status === 413 ? 413 : 503,
      "TCGIndex 공통 인식 요청을 처리하지 못했습니다.",
    );
  return res.json() as Promise<any>;
}
export async function submitScan(
  user: string,
  input: {
    photo: string;
    requestKey: string;
    game?: string;
    name?: string;
    number?: string;
    market?: string;
  },
) {
  await validatePhotos(pool, user, [input.photo]);
  const c = await pool.connect();
  try {
    await c.query("SELECT pg_advisory_lock(hashtext($1))", [
      user + ":scan:" + input.requestKey,
    ]);
    let row = (
      await c.query(
        "SELECT * FROM tcg_scans WHERE owner_id=$1 AND request_key=$2",
        [user, input.requestKey],
      )
    ).rows[0];
    if (row?.upstream_id) return row;
    if (!row)
      row = (
        await c.query(
          "INSERT INTO tcg_scans(owner_id,object_path,request_key) VALUES($1,$2,$3) RETURNING *",
          [user, input.photo, input.requestKey],
        )
      ).rows[0];
    const response = await storage.downloadObject(
      await storage.getObjectEntityFile(input.photo),
    );
    const reader = response.body!.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    while (true) {
      const p = await reader.read();
      if (p.done) break;
      total += p.value.byteLength;
      if (total > 850000) {
        await reader.cancel();
        throw new TcgError(413, "인식 사진은 850KB 이하 JPEG로 촬영해 주세요.");
      }
      chunks.push(p.value);
    }
    const bytes = Buffer.concat(chunks);
    demand(
      bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255,
      400,
      "JPEG 사진을 선택해 주세요.",
    );
    const result = await bridge(
      "photos",
      {
        method: "POST",
        headers: { "content-type": "image/jpeg" },
        body: new Uint8Array(bytes),
      },
      {
        game: input.game ?? "",
        name: input.name ?? "",
        number: input.number ?? "",
        market: input.market ?? "KR",
      },
    );
    return (
      await c.query(
        "UPDATE tcg_scans SET upstream_id=$2,status='processing' WHERE id=$1 RETURNING *",
        [row.id, result.id],
      )
    ).rows[0];
  } finally {
    await c.query("SELECT pg_advisory_unlock(hashtext($1))", [
      user + ":scan:" + input.requestKey,
    ]);
    c.release();
  }
}
export async function readScan(user: string, id: string) {
  const row = (
    await pool.query("SELECT * FROM tcg_scans WHERE id=$1 AND owner_id=$2", [
      id,
      user,
    ])
  ).rows[0];
  demand(row, 404, "내 스캔 기록을 찾지 못했습니다.");
  if (!row.upstream_id) return row;
  const result = await bridge("photos/" + row.upstream_id);
  await pool.query("UPDATE tcg_scans SET result=$2,status=$3 WHERE id=$1", [
    id,
    JSON.stringify(result),
    result.targetId ? "identified" : (result.status ?? "processing"),
  ]);
  return {
    ...row,
    result,
    status: result.targetId ? "identified" : (result.status ?? "processing"),
  };
}
