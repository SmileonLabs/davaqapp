import { randomUUID } from "node:crypto";
import { pool } from "@workspace/db";
import { z } from "zod/v4";
import { transaction, demand, findMatches } from "./exchangeService";
import { agentReply } from "./davaqAgent";
import { findRelayCandidates } from "./relayService";
import { listBrandExchanges } from "./brandExchange";
import { logger } from "./logger";

export const agentSendSchema = z
  .object({
    content: z.string().trim().min(1).max(3000),
    type: z.enum(["text", "image", "file", "sticker"]).default("text"),
    clientMessageId: z.string().min(8).max(100),
    replyToMessageId: z.string().uuid().nullable().optional(),
  })
  .strict();
const objectPath = z.string().regex(/^\/objects\/[a-zA-Z0-9/_-]+$/);
export function agentAttachmentPath(
  type: string,
  content: string,
): string | null {
  if (type === "image") return objectPath.parse(content);
  let file: unknown;
  if (type === "file") {
    try {
      file = JSON.parse(content);
    } catch {
      demand(false, 400, "올바른 파일을 첨부해 주세요.");
    }
  }
  if (type === "file")
    return z
      .object({
        path: objectPath,
        name: z.string().min(1).max(255),
        size: z
          .number()
          .nonnegative()
          .max(25 * 1024 * 1024),
        mime: z.string().max(200).optional(),
      })
      .strict()
      .parse(file).path;
  return null;
}
export function agentMessageDto(row: any) {
  return {
    id: row.id,
    roomId: `davaq-agent:${row.user_id}`,
    roomSeq: Number(row.seq),
    senderId: row.user_id,
    senderProfileId: null,
    senderProfile: null,
    authorKind: row.role === "user" ? "user" : "another_me",
    type: row.type,
    content:
      row.deleted_at || row.hidden_at ? "삭제된 메시지입니다." : row.content,
    deletedAt:
      row.deleted_at || row.hidden_at
        ? new Date(row.deleted_at || row.hidden_at).toISOString()
        : null,
    replyToMessageId: row.reply_to_message_id ?? null,
    replyTo: row.reply_preview ?? null,
    stickerBadges:
      row.deleted_at || row.hidden_at
        ? []
        : (row.metadata?.stickerBadges ?? []),
    createdAt: new Date(row.created_at).toISOString(),
    clientMessageId: row.role === "user" ? row.request_key : null,
    readCount: 0,
    metadata: {
      agentRole: row.role,
      replyState: row.reply_state,
      hidden: !!row.hidden_at,
    },
  };
}

export async function enqueueAgentMessage(
  user: string,
  input: z.infer<typeof agentSendSchema>,
) {
  return transaction(async (sql) => {
    // Serializes quota checks and equal request IDs, including multiple tabs.
    await sql.query("SELECT id FROM users WHERE id=$1 FOR UPDATE", [user]);
    const prior = (
      await sql.query(
        "SELECT * FROM agent_messages WHERE user_id=$1 AND role='user' AND request_key=$2",
        [user, input.clientMessageId],
      )
    ).rows[0];
    if (prior) {
      demand(
        prior.content === input.content &&
          prior.type === input.type &&
          (prior.reply_to_message_id ?? null) ===
            (input.replyToMessageId ?? null),
        409,
        "이미 전송한 메시지와 내용이 달라요.",
      );
      return agentMessageDto(prior);
    }
    const count = (
      await sql.query(
        "SELECT count(*)::int n FROM agent_messages WHERE user_id=$1 AND role='user' AND created_at>now()-interval '1 hour'",
        [user],
      )
    ).rows[0].n;
    demand(
      count < 20,
      429,
      "큐와의 대화는 시간당 20회까지 이용할 수 있어요. 잠시 후 다시 보내주세요.",
    );
    if (input.replyToMessageId) {
      const target = (
        await sql.query(
          "SELECT id FROM agent_messages WHERE id=$1 AND user_id=$2 AND deleted_at IS NULL AND hidden_at IS NULL",
          [input.replyToMessageId, user],
        )
      ).rows[0];
      demand(target, 404, "답장할 메시지를 찾지 못했어요.");
    }
    const path = agentAttachmentPath(input.type, input.content);
    if (path) {
      const owned = (
        await sql.query(
          "SELECT content_type FROM chat_upload_owners WHERE user_id=$1 AND object_path=$2",
          [user, path],
        )
      ).rows[0];
      demand(
        owned,
        403,
        "내가 첨부한 파일만 큐에게 보낼 수 있어요. 다시 첨부해 주세요.",
      );
      if (input.type === "image")
        demand(
          /^image\//.test(owned.content_type),
          400,
          "사진 파일을 선택해 주세요.",
        );
    }
    const row = (
      await sql.query(
        "INSERT INTO agent_messages(user_id,role,content,request_key,type,reply_state,reply_to_message_id) VALUES($1,'user',$2,$3,$4,'queued',$5) RETURNING *",
        [
          user,
          input.content,
          input.clientMessageId,
          input.type,
          input.replyToMessageId ?? null,
        ],
      )
    ).rows[0];
    return agentMessageDto(row);
  });
}

const replyPreviewSql = `CASE WHEN r.id IS NULL THEN NULL ELSE json_build_object('id',r.id,'senderId',r.user_id,'senderName',CASE WHEN r.role='assistant' THEN '큐' ELSE '나' END,'type',r.type,'content',CASE WHEN r.deleted_at IS NOT NULL OR r.hidden_at IS NOT NULL THEN '삭제된 메시지입니다.' ELSE left(r.content,500) END,'deletedAt',COALESCE(r.deleted_at,r.hidden_at)) END AS reply_preview`;

export async function getAgentMessage(user: string, id: string) {
  const row = (
    await pool.query(
      `SELECT m.*, ${replyPreviewSql} FROM agent_messages m LEFT JOIN agent_messages r ON r.id=m.reply_to_message_id AND r.user_id=m.user_id WHERE m.user_id=$1 AND m.id=$2 AND m.hidden_at IS NULL`,
      [user, id],
    )
  ).rows[0];
  demand(row, 404, "메시지를 찾지 못했어요.");
  return agentMessageDto(row);
}
export async function getAgentPin(user: string) {
  const row = (
    await pool.query(
      "SELECT m.* FROM agent_conversation_settings s JOIN agent_messages m ON m.id=s.pinned_message_id AND m.user_id=s.user_id WHERE s.user_id=$1 AND m.deleted_at IS NULL AND m.hidden_at IS NULL",
      [user],
    )
  ).rows[0];
  return row ? agentMessageDto(row) : null;
}
export async function changeAgentMessage(
  user: string,
  id: string,
  action: "delete" | "pin" | "sticker",
  value?: string,
) {
  return transaction(async (sql) => {
    await sql.query("SELECT id FROM users WHERE id=$1 FOR UPDATE", [user]);
    const row = (
      await sql.query(
        "SELECT * FROM agent_messages WHERE user_id=$1 AND id=$2 FOR UPDATE",
        [user, id],
      )
    ).rows[0];
    demand(row, 404, "메시지를 찾지 못했어요.");
    if (action === "delete") {
      demand(
        value === "me" || row.role === "user",
        403,
        "큐의 답변은 내 화면에서 삭제할 수 있어요.",
      );
      await sql.query(
        value === "me"
          ? "UPDATE agent_messages SET hidden_at=COALESCE(hidden_at,now()),reply_state='done',lease_token=NULL WHERE id=$1"
          : "UPDATE agent_messages SET deleted_at=COALESCE(deleted_at,now()),reply_state='done',lease_token=NULL WHERE id=$1",
        [id],
      );
      await sql.query(
        "UPDATE agent_conversation_settings SET pinned_message_id=NULL WHERE user_id=$1 AND pinned_message_id=$2",
        [user, id],
      );
    } else {
      demand(!row.deleted_at && !row.hidden_at, 404, "삭제된 메시지입니다.");
      if (action === "pin")
        await sql.query(
          "INSERT INTO agent_conversation_settings(user_id,pinned_message_id) VALUES($1,$2) ON CONFLICT(user_id) DO UPDATE SET pinned_message_id=EXCLUDED.pinned_message_id",
          [user, id],
        );
      else
        await sql.query(
          "UPDATE agent_messages SET metadata=jsonb_set(metadata,'{stickerBadges}',$2::jsonb) WHERE id=$1",
          [
            id,
            JSON.stringify([
              {
                id: randomUUID(),
                code: value,
                userId: user,
                createdAt: new Date().toISOString(),
              },
            ]),
          ],
        );
    }
    return agentMessageDto(
      (await sql.query("SELECT * FROM agent_messages WHERE id=$1", [id]))
        .rows[0],
    );
  });
}
export async function clearAgentPin(user: string) {
  await pool.query(
    "UPDATE agent_conversation_settings SET pinned_message_id=NULL WHERE user_id=$1",
    [user],
  );
}

export async function listAgentConversation(
  user: string,
  limit: number,
  afterSeq?: number,
  preview = false,
) {
  const rows = (
    await pool.query(
      `SELECT m.*, ${replyPreviewSql} FROM agent_messages m LEFT JOIN agent_messages r ON r.id=m.reply_to_message_id AND r.user_id=m.user_id WHERE m.user_id=$1 ${preview ? "AND m.hidden_at IS NULL" : ""} ${afterSeq == null ? "" : "AND m.seq>$3"} ORDER BY m.seq ${afterSeq == null ? "DESC" : "ASC"} LIMIT $2`,
      afterSeq == null ? [user, limit] : [user, limit, afterSeq],
    )
  ).rows;
  if (afterSeq == null) rows.reverse();
  // Resolve saved IDs against current availability/consent. Never return stale
  // listing snapshots after a block/unpublish, or a rejected/deleted memory.
  if (preview) return rows.map(agentMessageDto);
  const visible = rows.filter((r) => !r.deleted_at && !r.hidden_at);
  const needsMatches = visible.some((r) => r.metadata?.matchIds?.length);
  const needsBrands = visible.some((r) => r.metadata?.brandIds?.length);
  const needsMemories = visible.some((r) => r.metadata?.memoryId);
  const [matches, brands, memories, relays] = await Promise.all([
    needsMatches ? findMatches(user) : [],
    needsBrands ? listBrandExchanges(user, true) : { items: [] },
    needsMemories
      ? pool.query(
          "SELECT id,label,status FROM agent_memories WHERE user_id=$1 AND status IN('candidate','confirmed') AND (expires_at IS NULL OR expires_at>now())",
          [user],
        )
      : { rows: [] },
    visible.some(r=>r.metadata?.relayIds?.length) ? findRelayCandidates(user) : {items:[] as Awaited<ReturnType<typeof findRelayCandidates>>["items"]},
  ]);
  const matchesById = new Map(matches.map((m) => [m.id, m]));
  const brandsById = new Map(brands.items.map((m: any) => [m.id, m]));
  const memoriesById = new Map(memories.rows.map((m) => [m.id, m]));
  return rows.map((row) => {
    if (row.deleted_at || row.hidden_at) return agentMessageDto(row);
    const cards: any[] = [];
    for(const id of (row.metadata?.relayIds??[]).slice(0,2)){const candidate=relays.items.find(r=>r.id===id);if(candidate)cards.push({kind:"relay",candidate});}
    for (const id of (row.metadata?.matchIds ?? []).slice(0, 3)) {
      const match = matchesById.get(id);
      if (match) cards.push({ kind: "match", match });
    }
    for (const id of (row.metadata?.brandIds ?? []).slice(0, 3)) {
      const campaign = brandsById.get(id);
      if (campaign) cards.push({ kind: "brand", campaign });
    }
    const memory = memoriesById.get(row.metadata?.memoryId);
    if (memory) cards.push({ kind: "memory", memory });
    if (row.role === "assistant" && row.metadata?.registrationText)
      cards.push({
        kind: "register",
        text: String(row.metadata.registrationText).slice(0, 3000),
      });
    const result = agentMessageDto(row);
    return { ...result, metadata: { ...result.metadata, cards } };
  });
}

export async function processAgentConversationBatch() {
  // Claim one earliest operation per account. A fencing token prevents a
  // restarted/slow worker from committing a second answer after lease recovery.
  const jobs = await transaction(async (sql) => {
    const rows = (
      await sql.query(`SELECT m.* FROM agent_messages m WHERE m.role='user' AND m.deleted_at IS NULL AND m.hidden_at IS NULL
      AND (m.reply_state='queued' OR (m.reply_state='running' AND m.processing_started_at<now()-interval '2 minutes'))
      AND NOT EXISTS(SELECT 1 FROM agent_messages older WHERE older.user_id=m.user_id AND older.role='user' AND older.reply_state<>'done' AND older.seq<m.seq)
      ORDER BY m.seq LIMIT 3 FOR UPDATE SKIP LOCKED`)
    ).rows;
    for (const row of rows) {
      row.lease_token = randomUUID();
      await sql.query(
        "UPDATE agent_messages SET reply_state='running',processing_started_at=now(),lease_token=$2 WHERE id=$1",
        [row.id, row.lease_token],
      );
    }
    return rows;
  });
  await Promise.all(
    jobs.map(async (row) => {
      let content =
          "지금은 큐의 연결이 원활하지 않아요. 잠시 후 다시 말해주세요.",
        answer: Awaited<ReturnType<typeof agentReply>> | null = null;
      const metadata: Record<string, unknown> = {};
      try {
        if (row.type === "text") {
          const reference = row.reply_to_message_id
            ? (
                await pool.query(
                  "SELECT content FROM agent_messages WHERE id=$1 AND user_id=$2 AND deleted_at IS NULL AND hidden_at IS NULL",
                  [row.reply_to_message_id, row.user_id],
                )
              ).rows[0]?.content
            : null;
          answer = await agentReply(
            row.user_id,
            reference
              ? "[답장 대상] " +
                  String(reference).slice(0, 1000) +
                  "\n[새 메시지] " +
                  row.content
              : row.content,
            true,
            Number(row.seq),
          );
          content = answer.data.reply;
          metadata.matchIds = answer.matchIds;
          metadata.brandIds = answer.brandIds;
          metadata.relayIds = answer.relayIds;
          if (
            !/쿠폰|브랜드|1분|리워드/.test(row.content) &&
            /줄 수|해줄|해주|제공|등록|대신|받고 싶|바꾸고|바꿀/.test(
              row.content,
            )
          )
            metadata.registrationText = row.content;
        } else {
          content =
            row.type === "image"
              ? "사진을 받았어요. 어떤 물건인지, 상태와 받고 싶은 것을 함께 알려주시면 교환 등록을 도와드릴게요."
              : row.type === "file"
                ? "파일을 받았어요. 파일 내용은 아직 자동으로 읽지 않아요. 교환에 필요한 내용을 메시지로 알려주세요."
                : "마음을 전해주셨네요! 오늘은 어떤 것을 바꿔볼까요?";
        }
      } catch (error) {
        logger.warn(
          { error: error instanceof Error ? error.name : "Error" },
          "Q reply unavailable",
        );
      }
      await transaction(async (sql) => {
        await sql.query("SELECT id FROM users WHERE id=$1 FOR UPDATE", [
          row.user_id,
        ]);
        const current = (
          await sql.query(
            "SELECT * FROM agent_messages WHERE id=$1 FOR UPDATE",
            [row.id],
          )
        ).rows[0];
        if (
          !current ||
          current.reply_state !== "running" ||
          current.lease_token !== row.lease_token
        )
          return;
        if (answer?.chatLearning && answer.data.memory) {
          const settings = (
            await sql.query(
              "SELECT * FROM agent_settings WHERE user_id=$1 FOR UPDATE",
              [row.user_id],
            )
          ).rows[0];
          if (
            settings?.chat_learning &&
            settings.consent_version === answer.consentVersion
          ) {
            const memory = (
              await sql.query(
                "INSERT INTO agent_memories(user_id,label,source_type,source_id,consent_version) VALUES($1,$2,'chat',$3,$4) ON CONFLICT DO NOTHING RETURNING id",
                [
                  row.user_id,
                  answer.data.memory,
                  "agent:" + row.id,
                  settings.consent_version,
                ],
              )
            ).rows[0];
            if (memory) metadata.memoryId = memory.id;
          }
        }
        await sql.query(
          "INSERT INTO agent_messages(user_id,role,content,request_key,metadata) VALUES($1,'assistant',$2,$3,$4) ON CONFLICT(user_id,role,request_key) DO NOTHING",
          [row.user_id, content, row.request_key, JSON.stringify(metadata)],
        );
        await sql.query(
          "UPDATE agent_messages SET reply_state='done',lease_token=NULL WHERE id=$1",
          [row.id],
        );
      });
    }),
  );
  return jobs.length;
}
let busy = false;
export function startAgentConversationWorker() {
  const tick = async () => {
    if (busy) return;
    busy = true;
    try {
      await processAgentConversationBatch();
    } catch (error) {
      logger.warn(
        { error: error instanceof Error ? error.name : "Error" },
        "Q chat worker unavailable",
      );
    } finally {
      busy = false;
    }
  };
  const timer = setInterval(() => void tick(), 1500);
  timer.unref();
  void tick();
}
