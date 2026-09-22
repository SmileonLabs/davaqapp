import { randomUUID } from "node:crypto";
import { pool } from "@workspace/db";
import { z } from "zod/v4";
import { transaction, demand, findMatches } from "./exchangeService";
import { agentReply } from "./davaqAgent";
import { listBrandExchanges } from "./brandExchange";
import { logger } from "./logger";

export const agentSendSchema = z
  .object({
    content: z.string().trim().min(1).max(3000),
    type: z.enum(["text", "image", "file", "sticker"]).default("text"),
    clientMessageId: z.string().min(8).max(100),
    replyToMessageId: z.null().optional(),
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
    content: row.content,
    createdAt: new Date(row.created_at).toISOString(),
    clientMessageId: row.role === "user" ? row.request_key : null,
    readCount: 0,
    metadata: { agentRole: row.role, replyState: row.reply_state },
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
        prior.content === input.content && prior.type === input.type,
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
        "INSERT INTO agent_messages(user_id,role,content,request_key,type,reply_state) VALUES($1,'user',$2,$3,$4,'queued') RETURNING *",
        [user, input.content, input.clientMessageId, input.type],
      )
    ).rows[0];
    return agentMessageDto(row);
  });
}

export async function listAgentConversation(
  user: string,
  limit: number,
  afterSeq?: number,
) {
  const rows = (
    await pool.query(
      `SELECT * FROM agent_messages WHERE user_id=$1 ${afterSeq == null ? "" : "AND seq>$3"} ORDER BY seq ${afterSeq == null ? "DESC" : "ASC"} LIMIT $2`,
      afterSeq == null ? [user, limit] : [user, limit, afterSeq],
    )
  ).rows;
  if (afterSeq == null) rows.reverse();
  // Resolve saved IDs against current availability/consent. Never return stale
  // listing snapshots after a block/unpublish, or a rejected/deleted memory.
  const needsMatches = rows.some((r) => r.metadata?.matchIds?.length);
  const needsBrands = rows.some((r) => r.metadata?.brandIds?.length);
  const needsMemories = rows.some((r) => r.metadata?.memoryId);
  const [matches, brands, memories] = await Promise.all([
    needsMatches ? findMatches(user) : [],
    needsBrands ? listBrandExchanges(user, true) : { items: [] },
    needsMemories
      ? pool.query(
          "SELECT id,label,status FROM agent_memories WHERE user_id=$1 AND status IN('candidate','confirmed') AND (expires_at IS NULL OR expires_at>now())",
          [user],
        )
      : { rows: [] },
  ]);
  return rows.map((row) => {
    const cards: any[] = [];
    for (const id of (row.metadata?.matchIds ?? []).slice(0, 3)) {
      const match = matches.find((m) => m.id === id);
      if (match) cards.push({ kind: "match", match });
    }
    for (const id of (row.metadata?.brandIds ?? []).slice(0, 3)) {
      const campaign = brands.items.find((c: any) => c.id === id);
      if (campaign) cards.push({ kind: "brand", campaign });
    }
    const memory = memories.rows.find((m) => m.id === row.metadata?.memoryId);
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
      await sql.query(`SELECT m.* FROM agent_messages m WHERE m.role='user'
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
          answer = await agentReply(
            row.user_id,
            row.content,
            true,
            Number(row.seq),
          );
          content = answer.data.reply;
          metadata.matchIds = answer.matchIds;
          metadata.brandIds = answer.brandIds;
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
