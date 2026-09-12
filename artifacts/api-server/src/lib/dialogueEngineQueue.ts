import type { Logger } from "pino";
import { sql } from "drizzle-orm";
import { db } from "@workspace/db";
import { logger as defaultLogger } from "./logger";
import type { AnotherMeReplyJob, QueuedAnotherMeReplyJob } from "./dialogueEngine";
import { StatefulPersonaDialogueEngine } from "./dialogueEngine";

const DEFAULT_BATCH_SIZE = 4;
const DEFAULT_INTERVAL_MS = 1500;
const DEFAULT_MAX_ATTEMPTS = 5;
const LOCK_TIMEOUT_SECONDS = 90;

export interface EnqueueAnotherMeReplyJobInput {
  roomId: string;
  personaUserId: string;
  targetUserId: string;
  latestMessageId: string;
  userInput: string;
}

function rowsOf<T extends Record<string, unknown>>(result: unknown): T[] {
  return ((result as { rows?: T[] }).rows ?? []) as T[];
}

function envNumber(name: string, fallback: number): number {
  const parsed = Number(process.env[name] ?? NaN);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function errorText(err: unknown): string {
  if (err instanceof Error) return err.message.slice(0, 2000);
  return String(err).slice(0, 2000);
}

function backoffMs(attempts: number): number {
  return Math.min(60_000, Math.max(1000, 1000 * 2 ** Math.max(0, attempts - 1)));
}

function toQueuedJob(row: Record<string, unknown>): QueuedAnotherMeReplyJob {
  return {
    id: String(row.id),
    roomId: String(row.roomId),
    personaUserId: String(row.personaUserId),
    targetUserId: String(row.targetUserId),
    latestMessageId: String(row.latestMessageId),
    userInput: String(row.userInput ?? ""),
    status: String(row.status ?? "queued") as QueuedAnotherMeReplyJob["status"],
    attempts: Number(row.attempts ?? 0),
    error: typeof row.error === "string" ? row.error : null,
    createdAt: new Date(String(row.createdAt)).toISOString(),
    startedAt: row.startedAt ? new Date(String(row.startedAt)).toISOString() : null,
    completedAt: row.completedAt ? new Date(String(row.completedAt)).toISOString() : null,
  };
}

export async function enqueueAnotherMeReplyJob(input: EnqueueAnotherMeReplyJobInput): Promise<QueuedAnotherMeReplyJob> {
  const result = await db.execute(sql`
    INSERT INTO another_me_reply_jobs (
      room_id,
      persona_user_id,
      target_user_id,
      latest_message_id,
      user_input,
      status
    ) VALUES (
      ${input.roomId},
      ${input.personaUserId},
      ${input.targetUserId},
      ${input.latestMessageId},
      ${input.userInput},
      'queued'
    )
    RETURNING
      id,
      room_id AS "roomId",
      persona_user_id AS "personaUserId",
      target_user_id AS "targetUserId",
      latest_message_id AS "latestMessageId",
      user_input AS "userInput",
      status,
      attempts,
      error,
      created_at AS "createdAt",
      started_at AS "startedAt",
      completed_at AS "completedAt"
  `);
  const [job] = rowsOf<Record<string, unknown>>(result).map(toQueuedJob);
  if (!job) throw new Error("failed to enqueue another me reply job");
  return job;
}

async function claimJobs(limit: number, maxAttempts: number): Promise<AnotherMeReplyJob[]> {
  const result = await db.execute(sql`
    UPDATE another_me_reply_jobs
    SET status = 'processing',
        attempts = attempts + 1,
        locked_at = now(),
        started_at = coalesce(started_at, now()),
        updated_at = now()
    WHERE id IN (
      SELECT id
      FROM another_me_reply_jobs
      WHERE status IN ('queued', 'failed')
        AND attempts < ${maxAttempts}
        AND available_at <= now()
        AND (locked_at IS NULL OR locked_at < now() - (${LOCK_TIMEOUT_SECONDS} * interval '1 second'))
      ORDER BY available_at ASC, created_at ASC
      LIMIT ${limit}
      FOR UPDATE SKIP LOCKED
    )
    RETURNING
      id,
      room_id AS "roomId",
      persona_user_id AS "personaUserId",
      target_user_id AS "targetUserId",
      latest_message_id AS "latestMessageId",
      user_input AS "userInput"
  `);

  return rowsOf<Record<string, unknown>>(result).map((row) => ({
    id: String(row.id),
    roomId: String(row.roomId),
    personaUserId: String(row.personaUserId),
    targetUserId: String(row.targetUserId),
    latestMessageId: String(row.latestMessageId),
    userInput: String(row.userInput ?? ""),
  }));
}

async function markCompleted(jobId: string): Promise<void> {
  await db.execute(sql`
    UPDATE another_me_reply_jobs
    SET status = 'completed',
        locked_at = NULL,
        completed_at = now(),
        updated_at = now(),
        error = NULL
    WHERE id = ${jobId}
  `);
}

async function markFailed(jobId: string, err: unknown): Promise<void> {
  await db.execute(sql`
    UPDATE another_me_reply_jobs
    SET status = 'failed',
        locked_at = NULL,
        available_at = ${new Date(Date.now() + backoffMs(1))},
        error = ${errorText(err)},
        updated_at = now()
    WHERE id = ${jobId}
  `);
}

export async function processAnotherMeReplyJobBatch(engine: StatefulPersonaDialogueEngine, log: Logger = defaultLogger): Promise<number> {
  const batchSize = envNumber("ANOTHER_ME_REPLY_JOB_BATCH_SIZE", DEFAULT_BATCH_SIZE);
  const maxAttempts = envNumber("ANOTHER_ME_REPLY_JOB_MAX_ATTEMPTS", DEFAULT_MAX_ATTEMPTS);
  const jobs = await claimJobs(batchSize, maxAttempts);
  for (const job of jobs) {
    try {
      await engine.processReplyJob(job);
      await markCompleted(job.id);
    } catch (err) {
      log.warn({ err, jobId: job.id, roomId: job.roomId }, "DavaQ dialogue job failed");
      await markFailed(job.id, err);
    }
  }
  return jobs.length;
}

export function startAnotherMeReplyJobWorker(engine: StatefulPersonaDialogueEngine, log: Logger = defaultLogger): void {
  if (process.env.ANOTHER_ME_REPLY_WORKER_ENABLED === "false") return;
  const intervalMs = envNumber("ANOTHER_ME_REPLY_JOB_INTERVAL_MS", DEFAULT_INTERVAL_MS);
  let running = false;
  const tick = () => {
    if (running) return;
    running = true;
    void processAnotherMeReplyJobBatch(engine, log)
      .catch((err) => log.warn({ err }, "DavaQ dialogue worker tick failed"))
      .finally(() => {
        running = false;
      });
  };
  tick();
  const timer = setInterval(tick, intervalMs);
  timer.unref?.();
}
