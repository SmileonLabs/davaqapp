/** Kept independent of process globals so crash/lease behaviour runs against SQL in tests. */
export interface OutboxSql {
  query(text: string, values?: any[]): Promise<{ rows: any[] }>;
}
export interface ChatDeliveryJob {
  id: string;
  room_id: string;
  actor_user_id: string | null;
  audience_user_id: string | null;
  channel: "realtime" | "push";
  payload: Record<string, any>;
  attempts: number;
  claim_token: string;
}
export async function claimChatDelivery(
  sql: OutboxSql,
  channel: "realtime" | "push" | null = null,
): Promise<ChatDeliveryJob | null> {
  const { rows } = await sql.query(
    `
    WITH candidate AS (
      SELECT id FROM chat_delivery_outbox
      WHERE delivered_at IS NULL AND available_at <= now()
        AND ($1::text IS NULL OR channel = $1)
        AND (lease_until IS NULL OR lease_until < now())
      ORDER BY available_at, created_at, id FOR UPDATE SKIP LOCKED LIMIT 1
    )
    UPDATE chat_delivery_outbox o SET claim_token = gen_random_uuid(),
      lease_until = now() + interval '60 seconds', attempts = attempts + 1
    FROM candidate c WHERE o.id = c.id RETURNING o.*`,
    [channel],
  );
  return rows[0] ?? null;
}
export async function finishChatDelivery(
  sql: OutboxSql,
  job: ChatDeliveryJob,
  failed = false,
): Promise<void> {
  await sql.query(
    `UPDATE chat_delivery_outbox SET
    delivered_at = CASE WHEN $3::boolean THEN NULL ELSE now() END,
    payload = CASE WHEN $3::boolean THEN payload ELSE '{}'::jsonb END,
    available_at = CASE WHEN $3::boolean THEN now() + ($4::integer * interval '1 second') ELSE available_at END,
    last_error = CASE WHEN $3::boolean THEN 'delivery_failed' ELSE NULL END,
    lease_until = NULL, claim_token = NULL
    WHERE id = $1 AND claim_token = $2 AND delivered_at IS NULL`,
    [
      job.id,
      job.claim_token,
      failed,
      Math.min(300, 2 ** Math.min(job.attempts, 8)),
    ],
  );
}
export async function deliverOneChatJob(
  sql: OutboxSql,
  deliver: (job: ChatDeliveryJob) => Promise<void>,
  timeoutMs = 30_000,
  channel: "realtime" | "push" | null = null,
): Promise<boolean> {
  const job = await claimChatDelivery(sql, channel);
  if (!job) return false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      deliver(job),
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error("delivery_timeout")),
          timeoutMs,
        );
      }),
    ]);
  } catch {
    await finishChatDelivery(sql, job, true);
    return true;
  } finally {
    if (timer) clearTimeout(timer);
  }
  // If acknowledgement fails the lease survives; another worker retries it.
  await finishChatDelivery(sql, job);
  return true;
}
