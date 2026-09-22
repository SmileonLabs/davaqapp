import { createHash } from "node:crypto";
import { pool } from "@workspace/db";
import type { z } from "zod/v4";
import { demand, transaction, type Sql } from "./exchangeService";
import {
  createWishInput,
  updateWishInput,
  wishDraftInput,
  wishDraftOutput,
} from "./wishInput";
import { draftWishContent } from "./wishDraft";
import { ObjectStorageService } from "./objectStorage";
import { findWishCandidates, type WishGoal } from "./wishMatching";
export function wishDto(r: any) {
  return {
    id: r.id,
    title: r.title,
    description: r.description,
    keywords: r.keywords,
    kind: r.kind,
    category: r.category,
    imageKey: r.image_key,
    status: r.status,
    version: r.version,
    createdAt: new Date(r.created_at).toISOString(),
    updatedAt: new Date(r.updated_at).toISOString(),
    lastSearchedAt: r.last_searched_at
      ? new Date(r.last_searched_at).toISOString()
      : null,
    candidateCount: r.candidate_count ?? 0,
  };
}
export function wishGoal(r: any): WishGoal {
  return {
    id: r.id,
    ownerId: r.user_id,
    title: r.title,
    description: r.description,
    keywords: r.keywords,
    kind: r.kind,
    category: r.category,
  };
}
export async function ownedWish(user: string, id: string, sql: Sql = pool) {
  const r = (
    await sql.query(
      "SELECT * FROM exchange_wishes WHERE id=$1 AND user_id=$2 AND status<>'deleted'",
      [id, user],
    )
  ).rows[0];
  demand(r, 404, "소원을 찾을 수 없어요.");
  return r;
}
async function ownImage(
  user: string,
  path: string | null | undefined,
  sql: Sql = pool,
) {
  if (!path) return;
  const own = (
    await sql.query(
      "SELECT 1 FROM exchange_media WHERE owner_id=$1 AND object_path=$2",
      [user, path],
    )
  ).rows[0];
  demand(own, 403, "내가 올린 상품 사진만 선택해 주세요.");
}
export async function imageDataForWish(user: string, path: string) {
  await ownImage(user, path);
  const store = new ObjectStorageService(),
    file = await store.getObjectEntityFile(path),
    response = await store.downloadObject(file, 0);
  const type = (response.headers.get("content-type") ?? "")
      .split(";")[0]
      .toLowerCase(),
    limit = 8 * 1024 * 1024;
  if (!["image/jpeg", "image/png", "image/webp"].includes(type)) {
    await response.body?.cancel();
    demand(false, 400, "JPEG, PNG, WebP 사진을 선택해 주세요.");
  }
  if (Number(response.headers.get("content-length")) > limit) {
    await response.body?.cancel();
    demand(false, 400, "8MB 이하의 사진을 선택해 주세요.");
  }
  const reader = response.body?.getReader();
  demand(reader, 400, "사진을 읽지 못했어요. 다시 첨부해 주세요.");
  const chunks: Buffer[] = [];
  let size = 0;
  try {
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > limit) {
        await reader.cancel();
        demand(false, 400, "8MB 이하의 사진을 선택해 주세요.");
      }
      chunks.push(Buffer.from(chunk.value));
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = Buffer.concat(chunks);
  const png = bytes
      .subarray(0, 8)
      .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])),
    jpeg = bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255,
    webp =
      bytes.toString("ascii", 0, 4) === "RIFF" &&
      bytes.toString("ascii", 8, 12) === "WEBP";
  demand(
    size > 12 &&
      ((type === "image/png" && png) ||
        (type === "image/jpeg" && jpeg) ||
        (type === "image/webp" && webp)),
    400,
    "사진 형식을 확인해 주세요.",
  );
  return "data:" + type + ";base64," + bytes.toString("base64");
}
export async function draftWish(
  user: string,
  input: z.infer<typeof wishDraftInput>,
) {
  const imageDataUrl = input.imageKey
    ? await imageDataForWish(user, input.imageKey)
    : undefined;
  return wishDraftOutput.parse(
    await draftWishContent({ text: input.text, imageDataUrl }),
  );
}
export async function createWish(
  user: string,
  i: z.infer<typeof createWishInput>,
) {
  const hash = createHash("sha256")
    .update(
      JSON.stringify({
        title: i.title,
        description: i.description,
        keywords: i.keywords,
        kind: i.kind,
        category: i.category,
        imageKey: i.imageKey,
      }),
    )
    .digest("hex");
  return transaction(async (sql) => {
    await sql.query("SELECT id FROM users WHERE id=$1 FOR UPDATE", [user]);
    const prior = (
      await sql.query(
        "SELECT * FROM exchange_wishes WHERE user_id=$1 AND request_key=$2",
        [user, i.requestKey],
      )
    ).rows[0];
    if (prior) {
      demand(
        prior.creation_hash === hash && prior.status !== "deleted",
        409,
        "이미 저장한 요청과 내용이 달라요. 새로 확인해 주세요.",
      );
      return wishDto(prior);
    }
    const count = (
      await sql.query(
        "SELECT count(*)::int n FROM exchange_wishes WHERE user_id=$1 AND status<>'deleted'",
        [user],
      )
    ).rows[0].n;
    demand(
      count < 50,
      409,
      "소원함은 50개까지 담을 수 있어요. 끝난 소원을 정리해 주세요.",
    );
    await ownImage(user, i.imageKey, sql);
    const row = (
      await sql.query(
        "INSERT INTO exchange_wishes(user_id,title,description,keywords,kind,category,image_key,request_key,creation_hash) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *",
        [
          user,
          i.title,
          i.description,
          JSON.stringify(i.keywords),
          i.kind,
          i.category,
          i.imageKey,
          i.requestKey,
          hash,
        ],
      )
    ).rows[0];
    await sql.query(
      "INSERT INTO agent_settings(user_id) VALUES($1) ON CONFLICT DO NOTHING",
      [user],
    );
    await sql.query(
      "INSERT INTO agent_messages(user_id,role,content,request_key,metadata) VALUES($1,'assistant',$2,$3,$4) ON CONFLICT(user_id,role,request_key) DO NOTHING",
      [
        user,
        "사고 싶은 것을 소원함에 담았어요. 내가 줄 것과 받을 것을 함께 확인하고, 맞는 후보가 있으면 직접 제안할 수 있어요.",
        "wish-created:" + row.id,
        JSON.stringify({ wishId: row.id }),
      ],
    );
    return wishDto(row);
  });
}
export async function updateWish(
  user: string,
  id: string,
  i: z.infer<typeof updateWishInput>,
) {
  return transaction(async (sql) => {
    const row = (
      await sql.query(
        "SELECT * FROM exchange_wishes WHERE id=$1 AND user_id=$2 AND status<>'deleted' FOR UPDATE",
        [id, user],
      )
    ).rows[0];
    demand(row, 404, "소원을 찾을 수 없어요.");
    demand(
      row.version === i.version,
      409,
      "다른 곳에서 소원을 수정했어요. 새로고침해 주세요.",
    );
    await ownImage(user, i.imageKey, sql);
    const status = i.status ?? row.status,
      deleted = status === "deleted";
    const next = (
      await sql.query(
        "UPDATE exchange_wishes SET title=$3,description=$4,keywords=$5,kind=$6,category=$7,image_key=$8,status=$9,version=version+1,updated_at=now(),candidate_count=0,candidate_keys='[]',last_searched_at=NULL,next_search_at=now(),search_lease=NULL WHERE id=$1 AND user_id=$2 RETURNING *",
        [
          id,
          user,
          deleted ? "" : (i.title ?? row.title),
          deleted ? "" : (i.description ?? row.description),
          JSON.stringify(deleted ? [] : (i.keywords ?? row.keywords)),
          i.kind ?? row.kind,
          i.category ?? row.category,
          deleted
            ? null
            : i.imageKey === undefined
              ? row.image_key
              : i.imageKey,
          status,
        ],
      )
    ).rows[0];
    return wishDto(next);
  });
}
export function wishCandidateKeys(
  result: Awaited<ReturnType<typeof findWishCandidates>>,
) {
  return [
    ...result.direct.map((m) => "direct:" + m.offer.id + ":" + m.target.id),
    ...result.relays.map((m) => "relay:" + m.id),
  ].sort();
}
export async function searchWish(user: string, id: string) {
  const row = await ownedWish(user, id);
  demand(
    row.status === "active",
    409,
    "소원을 다시 켠 뒤 교환 후보를 찾아주세요.",
  );
  const found = await findWishCandidates(user, wishGoal(row)),
    keys = wishCandidateKeys(found);
  const updated = await pool.query(
    "UPDATE exchange_wishes SET last_searched_at=now(),next_search_at=now()+interval '15 minutes',candidate_count=$4,candidate_keys=$5,search_lease=NULL WHERE id=$1 AND user_id=$2 AND version=$3 AND status='active'",
    [id, user, row.version, keys.length, JSON.stringify(keys)],
  );
  demand(updated.rowCount, 409, "소원 조건이 바뀌었어요. 새로고침해 주세요.");
  return found;
}
