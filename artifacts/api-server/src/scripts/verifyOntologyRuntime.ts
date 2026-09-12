import { and, desc, eq, sql } from "drizzle-orm";
import {
  db,
  ontologySyncJobsTable,
  userAiMemoriesTable,
  usersTable,
} from "@workspace/db";
import { logger } from "../lib/logger";
import { enqueueUserAiMemoryOntologySyncSafe, processOntologySyncBatch } from "../lib/ontologySync";
import { getPersonaOntologyProfile, getPersonaOntologyPromptLines } from "../lib/personaOntology";

function argValue(name: string): string | null {
  const index = process.argv.indexOf(name);
  if (index < 0) return null;
  return process.argv[index + 1] ?? null;
}

function hasFlag(name: string): boolean {
  return process.argv.includes(name);
}

function usage(): string {
  return [
    "Usage:",
    "  pnpm --filter @workspace/scripts run verify:ontology -- --user-id <uuid>",
    "  pnpm --filter @workspace/scripts run verify:ontology -- --email <email>",
    "",
    "Optional flags:",
    "  --summary-only          Print counts/statuses only; omit profile text and prompt lines.",
    "  --create-memory-sample  Insert one approved user AI memory and enqueue ontology sync.",
    "  --process-batch         Process one ontology outbox batch in this process.",
    "",
    "Env alternatives:",
    "  ONTOLOGY_VERIFY_USER_ID=<uuid>",
    "  ONTOLOGY_VERIFY_EMAIL=<email>",
    "  ONTOLOGY_VERIFY_SUMMARY_ONLY=true",
    "  ONTOLOGY_VERIFY_CREATE_SAMPLE=true",
    "  ONTOLOGY_VERIFY_PROCESS_BATCH=true",
  ].join("\n");
}

const userId = argValue("--user-id") ?? process.env.ONTOLOGY_VERIFY_USER_ID ?? null;
const email = argValue("--email") ?? process.env.ONTOLOGY_VERIFY_EMAIL ?? null;
const summaryOnly = hasFlag("--summary-only") || process.env.ONTOLOGY_VERIFY_SUMMARY_ONLY === "true";
const createMemorySample = hasFlag("--create-memory-sample") || process.env.ONTOLOGY_VERIFY_CREATE_SAMPLE === "true";
const processBatch = hasFlag("--process-batch") || process.env.ONTOLOGY_VERIFY_PROCESS_BATCH === "true";

if (!userId && !email) {
  console.error(usage());
  process.exit(1);
}

const [user] = await db
  .select({ id: usersTable.id, email: usersTable.email })
  .from(usersTable)
  .where(userId ? eq(usersTable.id, userId) : eq(usersTable.email, email!))
  .limit(1);
if (!user) {
  console.error(`User not found: ${userId ?? email}`);
  process.exit(1);
}
const verifiedUserId = user.id;

let sampleMemoryId: string | null = null;
if (createMemorySample) {
  const [memory] = await db
    .insert(userAiMemoriesTable)
    .values({
      userId: verifiedUserId,
      memoryType: "preference",
      text: `런타임 검증용 AI 기억입니다. DavaQ는 답변을 짧고 명확하게 정리하는 방식을 선호합니다. ${new Date().toISOString()}`,
      privacyScope: "user_private",
      status: "approved",
      source: "runtime_verify",
    })
    .returning();
  sampleMemoryId = memory.id;
  await enqueueUserAiMemoryOntologySyncSafe(memory, logger);
}

const processedBatchCount = processBatch ? await processOntologySyncBatch(logger) : 0;

const [memoryCount] = await db
  .select({ count: sql<number>`count(*)::int` })
  .from(userAiMemoriesTable)
  .where(and(eq(userAiMemoriesTable.userId, verifiedUserId), eq(userAiMemoriesTable.status, "approved")));

const jobStatusRows = await db
  .select({ status: ontologySyncJobsTable.status, count: sql<number>`count(*)::int` })
  .from(ontologySyncJobsTable)
  .where(eq(ontologySyncJobsTable.userId, verifiedUserId))
  .groupBy(ontologySyncJobsTable.status);

const jobSourceRows = await db
  .select({ sourceType: ontologySyncJobsTable.sourceType, count: sql<number>`count(*)::int` })
  .from(ontologySyncJobsTable)
  .where(eq(ontologySyncJobsTable.userId, verifiedUserId))
  .groupBy(ontologySyncJobsTable.sourceType);

const recentJobs = await db
  .select({
    id: ontologySyncJobsTable.id,
    sourceType: ontologySyncJobsTable.sourceType,
    sourceId: ontologySyncJobsTable.sourceId,
    sourceKey: ontologySyncJobsTable.sourceKey,
    status: ontologySyncJobsTable.status,
    attempts: ontologySyncJobsTable.attempts,
    lastError: ontologySyncJobsTable.lastError,
    processedAt: ontologySyncJobsTable.processedAt,
    createdAt: ontologySyncJobsTable.createdAt,
  })
  .from(ontologySyncJobsTable)
  .where(eq(ontologySyncJobsTable.userId, verifiedUserId))
  .orderBy(desc(ontologySyncJobsTable.createdAt))
  .limit(10);

const [profile, promptLines] = await Promise.all([
  getPersonaOntologyProfile(verifiedUserId),
  getPersonaOntologyPromptLines(verifiedUserId),
]);

if (summaryOnly) {
  console.log(JSON.stringify({
    userId: verifiedUserId,
    email: user.email,
    sampleMemoryCreated: Boolean(sampleMemoryId),
    processedBatchCount,
    approvedMemoryCount: memoryCount?.count ?? 0,
    jobStatusCounts: Object.fromEntries(jobStatusRows.map((row) => [row.status, row.count])),
    jobSourceCounts: Object.fromEntries(jobSourceRows.map((row) => [row.sourceType, row.count])),
    recentJobs: recentJobs.map((job) => ({
      id: job.id,
      sourceType: job.sourceType,
      status: job.status,
      attempts: job.attempts,
      hasLastError: Boolean(job.lastError),
      processedAt: job.processedAt?.toISOString() ?? null,
      createdAt: job.createdAt.toISOString(),
    })),
    personaProfile: profile
      ? {
          archetypeKey: profile.archetypeKey,
          archetypeLabel: profile.archetypeLabel,
          confidence: profile.confidence,
          status: profile.status,
          updatedAt: profile.updatedAt,
          sourceCounts: profile.sourceCounts,
          itemCounts: {
            traitTags: profile.traitTags.length,
            communicationStyles: profile.communicationStyles.length,
            preferences: profile.preferences.length,
            capabilities: profile.capabilities.length,
            conflictStyles: profile.conflictStyles.length,
            evidenceSummary: profile.evidenceSummary.length,
          },
        }
      : null,
    promptLineCount: promptLines.length,
    notes: [
      "기본 실행은 read-only입니다.",
      "summary-only 출력은 profile text와 prompt lines를 생략합니다.",
      "Neo4j 미설정/장애 시 promptLineCount가 0이어도 Postgres fallback 상태는 확인됩니다.",
    ],
  }, null, 2));
  process.exit(0);
}

console.log(JSON.stringify({
  userId: verifiedUserId,
  email: user.email,
  sampleMemoryId,
  processedBatchCount,
  approvedMemoryCount: memoryCount?.count ?? 0,
  jobStatusCounts: Object.fromEntries(jobStatusRows.map((row) => [row.status, row.count])),
  jobSourceCounts: Object.fromEntries(jobSourceRows.map((row) => [row.sourceType, row.count])),
  recentJobs: recentJobs.map((job) => ({
    ...job,
    lastError: job.lastError ? job.lastError.slice(0, 240) : null,
    processedAt: job.processedAt?.toISOString() ?? null,
    createdAt: job.createdAt.toISOString(),
  })),
  personaProfile: profile,
  promptLines,
  notes: [
    "기본 실행은 read-only입니다.",
    "샘플 생성 후 worker가 비활성화되어 있으면 --process-batch 또는 서버 worker 실행이 필요합니다.",
    "Neo4j 미설정/장애 시 job은 pending/failed로 남고 기존 서비스 요청은 실패하지 않아야 정상입니다.",
  ],
}, null, 2));
