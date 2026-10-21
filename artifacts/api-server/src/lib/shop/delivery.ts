import { randomUUID } from "node:crypto";
import { pool } from "@workspace/db";
import { transaction, type Sql } from "../tcgService";
import { publishRealtimeEvent } from "../realtime";
import { sendPushToUser } from "../push";
import { logger } from "../logger";
import { demand } from "../tcgCatalog";
import { threadAccess } from "./service";

export async function createShopMessage(
  shop: string,
  thread: string,
  user: string,
  content: string,
  requestKey: string,
) {
  return transaction(async (sql) => {
    const a = await threadAccess(shop, thread, user, sql, true);
    const old = (
      await sql.query(
        "SELECT * FROM davaq_shop_messages WHERE thread_id=$1 AND sender_id=$2 AND request_key=$3",
        [thread, user, requestKey],
      )
    ).rows[0];
    if (old) {
      demand(
        old.content === content,
        409,
        "동일 요청 키의 메시지 내용이 다릅니다.",
      );
      return { id: old.id, seq: Number(old.seq) };
    }
    const saved = (
      await sql.query(
        "INSERT INTO davaq_shop_messages(thread_id,sender_id,sender_kind,content,request_key) VALUES($1,$2,$3,$4,$5) RETURNING *",
        [thread, user, a.kind, content, requestKey],
      )
    ).rows[0];
    await sql.query("UPDATE davaq_shop_threads SET status='open' WHERE id=$1", [
      thread,
    ]);
    const users = (
      await sql.query(
        "SELECT user_id FROM davaq_shop_members WHERE shop_id=$1 UNION SELECT customer_id AS user_id FROM davaq_shop_threads WHERE id=$2",
        [shop, thread],
      )
    ).rows.map((r) => r.user_id as string);
    for (const recipient of users) {
      await sql.query(
        "INSERT INTO davaq_shop_delivery_jobs(message_id,recipient_id,channel) VALUES($1,$2,'realtime')",
        [saved.id, recipient],
      );
      if (recipient !== user)
        await sql.query(
          "INSERT INTO davaq_shop_delivery_jobs(message_id,recipient_id,channel,available_at) VALUES($1,$2,'push',now()+interval '3 seconds')",
          [saved.id, recipient],
        );
    }
    return { id: saved.id, seq: Number(saved.seq) };
  });
}
export type ShopJob = {
  id: string;
  message_id: string;
  recipient_id: string;
  channel: "realtime" | "push";
  attempts: number;
  lease_token: string;
};
export async function deliverShopJob(job: ShopJob) {
  // Recheck authorization at delivery time. Never embed message content in realtime/push.
  const m = (
    await pool.query(
      `SELECT m.id,m.seq,m.sender_id,t.id thread_id,t.shop_id,t.customer_id,s.name shop_name,r.last_read_seq,r.muted FROM davaq_shop_messages m JOIN davaq_shop_threads t ON t.id=m.thread_id JOIN davaq_shops s ON s.id=t.shop_id LEFT JOIN davaq_shop_thread_readers r ON r.thread_id=t.id AND r.user_id=$2 WHERE m.id=$1 AND ($2=t.customer_id OR EXISTS(SELECT 1 FROM davaq_shop_members sm WHERE sm.shop_id=t.shop_id AND sm.user_id=$2))`,
      [job.message_id, job.recipient_id],
    )
  ).rows[0];
  if (!m) return;
  if (job.channel === "realtime") {
    await publishRealtimeEvent(
      {
        type: "shop.message.created",
        userIds: [job.recipient_id],
        actorUserId: m.sender_id,
        data: {
          eventId: job.id,
          shopId: m.shop_id,
          threadId: m.thread_id,
          messageId: m.id,
        },
      },
      { durable: true },
    );
    return;
  }
  if (
    m.sender_id === job.recipient_id ||
    m.muted ||
    Number(m.last_read_seq ?? 0) >= Number(m.seq)
  )
    return;
  await sendPushToUser(
    job.recipient_id,
    {
      title: "DavaQ 매장 상담",
      body: "매장 상담에 새 메시지가 도착했습니다.",
      url: `/shop/conversation?shopId=${m.shop_id}&threadId=${m.thread_id}`,
      tag: `shop-thread-${m.thread_id}`,
      type: "shop_message",
      data: {
        type: "shop_message",
        shopId: m.shop_id,
        threadId: m.thread_id,
        messageId: m.id,
        recipientUserId: job.recipient_id,
      },
    },
    { strict: true },
  );
}
export async function processShopDelivery(
  channel: "realtime" | "push",
  deliver = deliverShopJob,
) {
  const token = randomUUID();
  const job = await transaction(async (sql) => {
    const j = (
      await sql.query(
        `SELECT * FROM davaq_shop_delivery_jobs WHERE channel=$1 AND delivered_at IS NULL AND failed_at IS NULL AND available_at<=now() AND (leased_until IS NULL OR leased_until<now()) ORDER BY available_at,id LIMIT 1 FOR UPDATE SKIP LOCKED`,
        [channel],
      )
    ).rows[0];
    if (!j) return null;
    return (
      await sql.query(
        "UPDATE davaq_shop_delivery_jobs SET lease_token=$2,leased_until=now()+interval '2 minutes',attempts=attempts+1 WHERE id=$1 RETURNING *",
        [j.id, token],
      )
    ).rows[0] as ShopJob;
  });
  if (!job) return false;
  try {
    await deliver(job);
    await pool.query(
      "UPDATE davaq_shop_delivery_jobs SET delivered_at=now(),lease_token=NULL,leased_until=NULL WHERE id=$1 AND lease_token=$2",
      [job.id, token],
    );
  } catch (err) {
    await pool.query(
      `UPDATE davaq_shop_delivery_jobs SET lease_token=NULL,leased_until=NULL,available_at=now()+($3::integer*interval '1 second'),failed_at=CASE WHEN attempts>=10 THEN now() ELSE NULL END WHERE id=$1 AND lease_token=$2`,
      [job.id, token, Math.min(300, 2 ** job.attempts)],
    );
    logger.warn(
      { jobId: job.id, channel: job.channel, attempts: job.attempts },
      "Shop delivery retry scheduled",
    );
  }
  return true;
}
export function startShopDeliveryWorker() {
  let stopped = false;
  const running = new Set<string>();
  const tick = async (channel: "realtime" | "push") => {
    if (
      stopped ||
      running.has(channel) ||
      process.env.DAVAQ_SHOPS_ENABLED !== "true"
    )
      return;
    running.add(channel);
    try {
      for (let i = 0; i < 20 && !stopped; i++)
        if (!(await processShopDelivery(channel))) break;
    } catch (err) {
      logger.error({ err, channel }, "Shop delivery worker failed");
    } finally {
      running.delete(channel);
    }
  };
  const timers = [
    setInterval(() => void tick("realtime"), 500),
    setInterval(() => void tick("push"), 1500),
  ];
  for (const t of timers) t.unref();
  return () => {
    stopped = true;
    timers.forEach(clearInterval);
  };
}
