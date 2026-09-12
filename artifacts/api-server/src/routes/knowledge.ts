import { randomUUID } from "node:crypto";
import { Router, type IRouter, type Request, type Response } from "express";
import type { Logger } from "pino";
import { and, desc, eq, ne, sql } from "drizzle-orm";
import {
  aiCampaignsTable,
  db,
  knowledgeDocumentsTable,
  knowledgeExtractionJobsTable,
  knowledgeReviewEventsTable,
  knowledgeReviewItemsTable,
  knowledgeSourcesTable,
  userAiMemoriesTable,
  type KnowledgeReviewItem,
} from "@workspace/db";
import { requireAuth } from "../lib/auth";
import { BIBI_OFFICIAL_USER_ID } from "../lib/officialAccounts";
import { BIBI_ARTIST_ENTITY_ID, BIBI_GRAPH_TENANT_ID } from "../lib/knowledgeGraph/bibiSeed";
import { runKnowledgeGraphRead } from "../lib/knowledgeGraph/client";
import { upsertClaim, upsertEntity, upsertSource } from "../lib/knowledgeGraph/core";
import { queueAiCampaignDelivery } from "../lib/campaignEngine";
import { CHAT_KNOWLEDGE_ITEM_TYPE } from "../lib/chatKnowledge";
import { enqueueUserAiMemoryOntologySyncSafe } from "../lib/ontologySync";
import { rateLimit } from "../lib/rateLimit";
import {
  confidenceValue,
  GOOGLE_SEARCH_ENDPOINT,
  GOOGLE_SEARCH_MAX_RESULTS,
  normalizeGoogleSearchItem,
  parsePositiveInt,
  requireGoogleSearchConfig,
  routeParam,
  stringValue,
  textValue,
  validateImportUrl,
  type GoogleSearchResult,
} from "../lib/knowledge/validation";
import { hasAdminAccess } from "../lib/adminRbac";
import {
  checksum,
  extractCandidateSentences,
  MAX_SOURCE_BODY,
  stripHtml,
} from "../lib/knowledge/sourceText";

const router: IRouter = Router();
async function requireKnowledgeAdmin(req: Request, res: Response): Promise<boolean> {
  if (!req.dbUser || !(await hasAdminAccess(req.dbUser))) {
    res.status(403).json({ error: "Knowledge admin access required" });
    return false;
  }
  return true;
}

function rowsOf<T extends Record<string, unknown>>(result: unknown): T[] {
  return ((result as { rows?: T[] }).rows ?? []) as T[];
}

function numberValue(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (value && typeof (value as { toNumber?: unknown }).toNumber === "function") {
    return (value as { toNumber: () => number }).toNumber();
  }
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

async function collectSourceBody(source: typeof knowledgeSourcesTable.$inferSelect): Promise<string> {
  if (source.body?.trim()) return source.body.slice(0, MAX_SOURCE_BODY);
  if (!source.url) return "";
  const response = await fetch(source.url, {
    redirect: "follow",
    headers: {
      "user-agent": "Mozilla/5.0 (compatible; AnotherMeKnowledgeBot/1.0; +https://davaq.anothermeai.app)",
      accept: "text/html,application/xhtml+xml,application/xml;q=0.9,text/plain;q=0.8,*/*;q=0.7",
      "accept-language": "ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7",
    },
  });
  if (!response.ok) {
    throw new Error(`URL fetch failed: HTTP ${response.status}. 원본 사이트가 서버 수집을 차단했을 수 있습니다. 본문 직접 입력을 사용하세요.`);
  }
  const text = await response.text();
  return stripHtml(text).slice(0, MAX_SOURCE_BODY);
}

function reviewPayloadForSentence(args: {
  tenantId: string;
  graphSourceId: string;
  graphClaimId: string;
  sourceType: string;
  sourceTitle: string;
  sourceUrl: string | null;
  sentence: string;
}) {
  return {
    entity: {
      id: BIBI_ARTIST_ENTITY_ID,
      tenantId: args.tenantId,
      type: "Artist",
      name: "BIBI",
      aliases: ["비비", "BIBI Official"],
    },
    source: {
      id: args.graphSourceId,
      tenantId: args.tenantId,
      sourceType: args.sourceType,
      title: args.sourceTitle,
      url: args.sourceUrl,
    },
    claim: {
      id: args.graphClaimId,
      tenantId: args.tenantId,
      subjectEntityId: BIBI_ARTIST_ENTITY_ID,
      predicate: "source_claim",
      text: args.sentence,
      confidence: 0.72,
      priority: 30,
      status: "approved",
      visibility: "official_public",
    },
    sourceIds: [args.graphSourceId],
  };
}

async function getGraphPreview(tenantId: string) {
  const graph = await runKnowledgeGraphRead(async (tx) => {
    const tenantResult = await tx.run(
      `
      MATCH (tenant:GraphTenant {id: $tenantId})
      RETURN tenant {
        .id,
        .type,
        .ownerId,
        .handle,
        .status,
        .ontologySchemaId,
        .relationshipSchemaId
      } AS tenant
      `,
      { tenantId },
    );

    const countsResult = await tx.run(
      `
      MATCH (tenant:GraphTenant {id: $tenantId})
      OPTIONAL MATCH (tenant)-[:OWNS]->(entity:Entity)
      WITH tenant, count(entity) AS entityCount
      OPTIONAL MATCH (tenant)-[:OWNS]->(source:Source)
      WITH tenant, entityCount, count(source) AS sourceCount
      OPTIONAL MATCH (tenant)-[:OWNS]->(:Entity)-[:HAS_CLAIM]->(claim:Claim)
      RETURN entityCount, sourceCount, count(claim) AS claimCount
      `,
      { tenantId },
    );

    const sourceResult = await tx.run(
      `
      MATCH (:GraphTenant {id: $tenantId})-[:OWNS]->(source:Source)
      OPTIONAL MATCH (claim:Claim)-[:SUPPORTED_BY]->(source)
      RETURN source.id AS id,
             source.title AS title,
             source.sourceType AS sourceType,
             source.url AS url,
             source.updatedAt AS updatedAt,
             count(claim) AS claimCount
      ORDER BY claimCount DESC, title ASC
      LIMIT 20
      `,
      { tenantId },
    );

    const entityResult = await tx.run(
      `
      MATCH (:GraphTenant {id: $tenantId})-[:OWNS]->(entity:Entity)
      OPTIONAL MATCH (entity)-[rel]->(target:Entity)
      WITH entity,
           [item IN collect(DISTINCT CASE WHEN target.id IS NULL THEN null ELSE {
             type: type(rel),
             targetId: target.id,
             targetType: target.type,
             targetName: target.name
           } END) WHERE item IS NOT NULL][0..5] AS relations
      RETURN entity.id AS id,
             entity.type AS type,
             entity.name AS name,
             entity.aliases AS aliases,
             relations
      ORDER BY entity.type ASC, entity.name ASC
      LIMIT 30
      `,
      { tenantId },
    );

    const claimResult = await tx.run(
      `
      MATCH (:GraphTenant {id: $tenantId})-[:OWNS]->(entity:Entity)-[:HAS_CLAIM]->(claim:Claim)
      OPTIONAL MATCH (claim)-[:SUPPORTED_BY]->(source:Source)
      WITH entity,
           claim,
           [item IN collect(DISTINCT CASE WHEN source.id IS NULL THEN null ELSE {
             title: source.title,
             sourceType: source.sourceType,
             url: source.url
           } END) WHERE item IS NOT NULL][0..3] AS sources
      RETURN claim.id AS id,
             entity.name AS entityName,
             entity.type AS entityType,
             claim.predicate AS predicate,
             claim.text AS text,
             claim.status AS status,
             claim.visibility AS visibility,
             claim.confidence AS confidence,
             claim.priority AS priority,
             sources
      ORDER BY claim.priority DESC, claim.confidence DESC, claim.updatedAt DESC
      LIMIT 40
      `,
      { tenantId },
    );

    const tenant = tenantResult.records[0]?.get("tenant") ?? null;
    const countsRecord = countsResult.records[0];
    return {
      tenant,
      counts: {
        entities: countsRecord ? numberValue(countsRecord.get("entityCount")) : 0,
        sources: countsRecord ? numberValue(countsRecord.get("sourceCount")) : 0,
        claims: countsRecord ? numberValue(countsRecord.get("claimCount")) : 0,
      },
      sources: sourceResult.records.map((record) => ({
        id: String(record.get("id") ?? ""),
        title: String(record.get("title") ?? "Untitled source"),
        sourceType: String(record.get("sourceType") ?? "unknown"),
        url: stringValue(record.get("url")),
        claimCount: numberValue(record.get("claimCount")),
      })),
      entities: entityResult.records.map((record) => ({
        id: String(record.get("id") ?? ""),
        type: String(record.get("type") ?? "Entity"),
        name: String(record.get("name") ?? ""),
        aliases: (record.get("aliases") as unknown[] | null ?? []).filter((value): value is string => typeof value === "string"),
        relations: record.get("relations") ?? [],
      })),
      claims: claimResult.records.map((record) => ({
        id: String(record.get("id") ?? ""),
        entityName: String(record.get("entityName") ?? ""),
        entityType: String(record.get("entityType") ?? "Entity"),
        predicate: String(record.get("predicate") ?? "related"),
        text: String(record.get("text") ?? ""),
        status: String(record.get("status") ?? "unknown"),
        visibility: String(record.get("visibility") ?? "unknown"),
        confidence: numberValue(record.get("confidence")),
        priority: numberValue(record.get("priority")),
        sources: record.get("sources") ?? [],
      })).filter((claim) => claim.text.length > 0),
    };
  });

  return graph
    ? { available: true, ...graph }
    : {
        available: false,
        tenant: null,
        counts: { entities: 0, sources: 0, claims: 0 },
        sources: [],
        entities: [],
        claims: [],
      };
}

async function getKnowledgePreview(tenantId: string) {
  const [sourceResult, reviewCountResult, recentReviewResult, latestJobResult, graph] = await Promise.all([
    db.execute(sql`
      SELECT
        s.id,
        s.title,
        s.url,
        s.source_type AS "sourceType",
        s.status,
        s.collected_at AS "collectedAt",
        s.created_at AS "createdAt",
        count(DISTINCT d.id)::int AS "documentCount",
        coalesce(max(length(d.content)), 0)::int AS "documentChars",
        count(DISTINCT ri.id) FILTER (WHERE ri.status = 'draft')::int AS "draftReviewCount",
        count(DISTINCT ri.id) FILTER (WHERE ri.status = 'approved')::int AS "approvedReviewCount",
        count(DISTINCT ri.id) FILTER (WHERE ri.status = 'rejected')::int AS "rejectedReviewCount"
      FROM knowledge_sources s
      LEFT JOIN knowledge_documents d ON d.source_id = s.id
      LEFT JOIN knowledge_review_items ri ON ri.source_id = s.id
      WHERE s.tenant_id = ${tenantId}
        AND s.status <> 'archived'
      GROUP BY s.id
      ORDER BY s.created_at DESC
      LIMIT 30
    `),
    db.execute(sql`
      SELECT status, count(*)::int AS count
      FROM knowledge_review_items
      WHERE tenant_id = ${tenantId}
        AND status <> 'archived'
      GROUP BY status
    `),
    db.execute(sql`
      SELECT
        ri.id,
        ri.title,
        ri.body,
        ri.status,
        ri.created_at AS "createdAt",
        s.title AS "sourceTitle",
        s.url AS "sourceUrl"
      FROM knowledge_review_items ri
      LEFT JOIN knowledge_sources s ON s.id = ri.source_id
      WHERE ri.tenant_id = ${tenantId}
        AND ri.status <> 'archived'
      ORDER BY ri.created_at DESC
      LIMIT 8
    `),
    db.execute(sql`
      SELECT
        j.id,
        j.status,
        j.error,
        j.stats_json AS "statsJson",
        j.completed_at AS "completedAt",
        j.created_at AS "createdAt",
        s.title AS "sourceTitle"
      FROM knowledge_extraction_jobs j
      LEFT JOIN knowledge_sources s ON s.id = j.source_id
      WHERE j.tenant_id = ${tenantId}
        AND (s.id IS NULL OR s.status <> 'archived')
      ORDER BY j.created_at DESC
      LIMIT 5
    `),
    getGraphPreview(tenantId),
  ]);

  const reviewCounts = rowsOf<{ status: string; count: number }>(reviewCountResult).reduce<Record<string, number>>((acc, row) => {
    acc[String(row.status)] = numberValue(row.count);
    return acc;
  }, {});

  return {
    tenantId,
    generatedAt: new Date().toISOString(),
    sources: rowsOf(sourceResult),
    reviewCounts,
    recentReviewItems: rowsOf(recentReviewResult),
    latestJobs: rowsOf(latestJobResult),
    graph,
  };
}

async function approveReviewItem(item: KnowledgeReviewItem, log: Logger): Promise<void> {
  const payload = item.payloadJson as any;
  if (payload?.memory) {
    const memory = payload.memory as Record<string, unknown>;
    const userId = textValue(memory.userId);
    const text = textValue(memory.text).slice(0, 1000);
    if (userId && text) {
      const source = textValue(memory.source, "chat_review");
      const [existing] = await db
        .select()
        .from(userAiMemoriesTable)
        .where(and(
          eq(userAiMemoriesTable.userId, userId),
          eq(userAiMemoriesTable.text, text),
          eq(userAiMemoriesTable.source, source),
          eq(userAiMemoriesTable.status, "approved"),
        ))
        .limit(1);
      const memoryRow = existing ?? (await db.insert(userAiMemoriesTable).values({
        userId,
        memoryType: textValue(memory.memoryType, "preference"),
        text,
        privacyScope: textValue(memory.privacyScope, "user_private") as any,
        status: "approved",
        confidence: confidenceValue(memory.confidence),
        source,
      }).returning())[0];
      if (memoryRow) await enqueueUserAiMemoryOntologySyncSafe(memoryRow, log);
    }
  }
  if (payload?.entity) await upsertEntity(payload.entity);
  if (payload?.source) await upsertSource(payload.source);
  if (payload?.claim) await upsertClaim(payload.claim, Array.isArray(payload.sourceIds) ? payload.sourceIds : []);
}

router.get("/knowledge/admin/me", requireAuth, async (req, res): Promise<void> => {
  res.json({ isAdmin: !!req.dbUser && (await hasAdminAccess(req.dbUser)) });
});

router.get("/knowledge/admin/sources", requireAuth, async (req, res): Promise<void> => {
  if (!(await requireKnowledgeAdmin(req, res))) return;
  const result = await db.execute(sql`
    SELECT
      s.id,
      s.tenant_id AS "tenantId",
      s.source_type AS "sourceType",
      s.title,
      s.url,
      s.body,
      s.status,
      s.collected_at AS "collectedAt",
      s.created_at AS "createdAt",
      count(DISTINCT d.id)::int AS "documentCount",
      coalesce(max(length(d.content)), 0)::int AS "documentChars",
      count(DISTINCT ri.id)::int AS "reviewCount",
      count(DISTINCT ri.id) FILTER (WHERE ri.status = 'draft')::int AS "draftReviewCount",
      count(DISTINCT ri.id) FILTER (WHERE ri.status = 'approved')::int AS "approvedReviewCount",
      (array_agg(j.status ORDER BY j.created_at DESC) FILTER (WHERE j.id IS NOT NULL))[1] AS "latestJobStatus",
      (array_agg(j.error ORDER BY j.created_at DESC) FILTER (WHERE j.id IS NOT NULL))[1] AS "latestJobError",
      (array_agg(j.created_at ORDER BY j.created_at DESC) FILTER (WHERE j.id IS NOT NULL))[1] AS "latestJobCreatedAt"
    FROM knowledge_sources s
    LEFT JOIN knowledge_documents d ON d.source_id = s.id
    LEFT JOIN knowledge_review_items ri ON ri.source_id = s.id
    LEFT JOIN knowledge_extraction_jobs j ON j.source_id = s.id
    WHERE s.status <> 'archived'
    GROUP BY s.id
    ORDER BY s.created_at DESC
    LIMIT 50
  `);
  res.json(rowsOf(result));
});

router.get("/knowledge/admin/ontology-preview", requireAuth, async (req, res): Promise<void> => {
  if (!(await requireKnowledgeAdmin(req, res))) return;
  const tenantId = textValue(req.query.tenantId, BIBI_GRAPH_TENANT_ID);
  res.json(await getKnowledgePreview(tenantId));
});

router.post("/knowledge/admin/google-search", requireAuth, rateLimit({ name: "knowledge-google-search", limit: 10, windowSeconds: 60, requireRedis: true }), async (req, res): Promise<void> => {
  if (!(await requireKnowledgeAdmin(req, res))) return;
  const config = requireGoogleSearchConfig();
  if (!config) {
    res.status(503).json({
      error: "google_search_not_configured",
      message: "GOOGLE_SEARCH_API_KEY and GOOGLE_SEARCH_ENGINE_ID are required.",
    });
    return;
  }

  const query = textValue(req.body?.query);
  if (!query) {
    res.status(400).json({ error: "query required" });
    return;
  }

  const url = new URL(GOOGLE_SEARCH_ENDPOINT);
  url.searchParams.set("key", config.apiKey);
  url.searchParams.set("cx", config.searchEngineId);
  url.searchParams.set("q", query);
  url.searchParams.set("num", String(parsePositiveInt(req.body?.num, 5, GOOGLE_SEARCH_MAX_RESULTS)));
  url.searchParams.set("safe", "active");
  url.searchParams.set("hl", "ko");
  url.searchParams.set("lr", "lang_ko");
  const siteSearch = textValue(req.body?.siteSearch);
  if (siteSearch) url.searchParams.set("siteSearch", siteSearch);

  const response = await fetch(url, { headers: { accept: "application/json" } });
  const json = await response.json().catch(() => null) as Record<string, unknown> | null;
  if (!response.ok) {
    const message = textValue((json?.error as Record<string, unknown> | undefined)?.message, `Google search failed: HTTP ${response.status}`);
    res.status(response.status >= 500 ? 502 : response.status).json({ error: "google_search_failed", message });
    return;
  }

  const queries = json?.queries as Record<string, unknown> | undefined;
  const requestInfo = Array.isArray(queries?.request) ? queries.request[0] as Record<string, unknown> | undefined : undefined;
  const searchInformation = json?.searchInformation as Record<string, unknown> | undefined;
  const results = (Array.isArray(json?.items) ? json.items : [])
    .map((item) => normalizeGoogleSearchItem((item ?? {}) as Record<string, unknown>))
    .filter((item): item is GoogleSearchResult => item !== null);

  res.json({
    query,
    totalResults: stringValue(requestInfo?.totalResults),
    searchTime: searchInformation?.searchTime ?? null,
    results,
  });
});

router.post("/knowledge/admin/google-search/import", requireAuth, rateLimit({ name: "knowledge-google-import", limit: 10, windowSeconds: 60, requireRedis: true }), async (req, res): Promise<void> => {
  if (!(await requireKnowledgeAdmin(req, res))) return;
  const title = textValue(req.body?.title).slice(0, 200);
  const url = validateImportUrl(textValue(req.body?.url));
  if (!title || !url) {
    res.status(400).json({ error: "title and valid url required" });
    return;
  }

  const tenantId = textValue(req.body?.tenantId, BIBI_GRAPH_TENANT_ID);
  const [existing] = await db
    .select()
    .from(knowledgeSourcesTable)
    .where(and(eq(knowledgeSourcesTable.tenantId, tenantId), eq(knowledgeSourcesTable.url, url), ne(knowledgeSourcesTable.status, "archived")))
    .limit(1);
  if (existing) {
    res.json(existing);
    return;
  }

  const [created] = await db.insert(knowledgeSourcesTable).values({
    tenantId,
    sourceType: "google_search_url",
    title,
    url,
    body: null,
    status: "draft",
    metadataJson: {
      importedFrom: "google_programmable_search",
      query: textValue(req.body?.query) || null,
      snippet: textValue(req.body?.snippet).slice(0, 1000) || null,
      displayLink: textValue(req.body?.displayLink) || null,
      formattedUrl: textValue(req.body?.formattedUrl) || null,
    },
    createdByUserId: req.dbUser!.id,
  }).returning();
  res.status(201).json(created);
});

router.post("/knowledge/admin/sources", requireAuth, async (req, res): Promise<void> => {
  if (!(await requireKnowledgeAdmin(req, res))) return;
  const body = req.body ?? {};
  const title = textValue(body.title);
  const url = textValue(body.url) || null;
  const sourceBody = textValue(body.body) || null;
  if (!title || (!url && !sourceBody)) {
    res.status(400).json({ error: "title and url/body required" });
    return;
  }
  const [created] = await db.insert(knowledgeSourcesTable).values({
    tenantId: textValue(body.tenantId, BIBI_GRAPH_TENANT_ID),
    sourceType: textValue(body.sourceType, url ? "url" : "manual"),
    title,
    url,
    body: sourceBody?.slice(0, MAX_SOURCE_BODY) ?? null,
    status: "draft",
    createdByUserId: req.dbUser!.id,
  }).returning();
  res.status(201).json(created);
});

router.delete("/knowledge/admin/sources/:sourceId", requireAuth, async (req, res): Promise<void> => {
  if (!(await requireKnowledgeAdmin(req, res))) return;
  const sourceId = routeParam(req.params.sourceId);
  const archivedAt = new Date();

  const updated = await db.transaction(async (tx) => {
    const [source] = await tx.select().from(knowledgeSourcesTable).where(eq(knowledgeSourcesTable.id, sourceId)).limit(1);
    if (!source) return null;
    if (source.status === "archived") return source;

    await tx.update(knowledgeReviewItemsTable).set({
      status: "archived",
      reviewedByUserId: req.dbUser!.id,
      reviewedAt: archivedAt,
      updatedAt: archivedAt,
    }).where(and(eq(knowledgeReviewItemsTable.sourceId, source.id), ne(knowledgeReviewItemsTable.status, "approved")));

    const [archived] = await tx.update(knowledgeSourcesTable).set({
      status: "archived",
      updatedAt: archivedAt,
    }).where(eq(knowledgeSourcesTable.id, source.id)).returning();
    return archived;
  });

  if (!updated) {
    res.status(404).json({ error: "source not found" });
    return;
  }
  res.json(updated);
});

router.post("/knowledge/admin/sources/:sourceId/extract", requireAuth, rateLimit({ name: "knowledge-extract", limit: 10, windowSeconds: 60, requireRedis: true }), async (req, res): Promise<void> => {
  if (!(await requireKnowledgeAdmin(req, res))) return;
  const sourceId = routeParam(req.params.sourceId);
  const [source] = await db.select().from(knowledgeSourcesTable).where(eq(knowledgeSourcesTable.id, sourceId)).limit(1);
  if (!source) {
    res.status(404).json({ error: "source not found" });
    return;
  }
  if (source.status === "archived") {
    res.status(410).json({ error: "source has been deleted" });
    return;
  }

  const [job] = await db.insert(knowledgeExtractionJobsTable).values({
    tenantId: source.tenantId,
    sourceId: source.id,
    status: "running",
    createdByUserId: req.dbUser!.id,
    startedAt: new Date(),
  }).returning();

  try {
    const content = await collectSourceBody(source);
    if (!content) throw new Error("source has no extractable content");
    const [document] = await db.insert(knowledgeDocumentsTable).values({
      sourceId: source.id,
      content,
      checksum: checksum(content),
      status: "draft",
    }).returning();
    const sentences = extractCandidateSentences(content);
    const graphSourceId = `${source.tenantId}:source:${source.id}`;
    const items = sentences.map((sentence, index) => {
      const graphClaimId = `${source.tenantId}:claim:${randomUUID()}`;
      return {
        tenantId: source.tenantId,
        sourceId: source.id,
        jobId: job.id,
        itemType: "claim",
        graphId: graphClaimId,
        title: `${source.title} 후보 ${index + 1}`,
        body: sentence,
        status: "draft" as const,
        createdByUserId: req.dbUser!.id,
        payloadJson: reviewPayloadForSentence({
          tenantId: source.tenantId,
          graphSourceId,
          graphClaimId,
          sourceType: source.sourceType,
          sourceTitle: source.title,
          sourceUrl: source.url,
          sentence,
        }),
      };
    });
    if (items.length > 0) await db.insert(knowledgeReviewItemsTable).values(items);
    const [updatedJob] = await db.update(knowledgeExtractionJobsTable).set({
      status: "completed",
      completedAt: new Date(),
      statsJson: { documentId: document.id, reviewItemCount: items.length },
    }).where(eq(knowledgeExtractionJobsTable.id, job.id)).returning();
    await db.update(knowledgeSourcesTable).set({ status: "draft", collectedAt: new Date() }).where(eq(knowledgeSourcesTable.id, source.id));
    res.json({ job: updatedJob, reviewItemCount: items.length });
  } catch (err) {
    const message = err instanceof Error ? err.message : "extraction failed";
    await db.update(knowledgeExtractionJobsTable).set({ status: "failed", error: message, completedAt: new Date() }).where(eq(knowledgeExtractionJobsTable.id, job.id));
    res.status(500).json({ error: message });
  }
});

router.get("/knowledge/admin/review-items", requireAuth, async (req, res): Promise<void> => {
  if (!(await requireKnowledgeAdmin(req, res))) return;
  const status = textValue(req.query.status, "draft");
  const result = await db.execute(sql`
    SELECT
      ri.id,
      ri.tenant_id AS "tenantId",
      ri.source_id AS "sourceId",
      ri.job_id AS "jobId",
      ri.item_type AS "itemType",
      ri.graph_id AS "graphId",
      ri.title,
      ri.body,
      ri.status,
      ri.reviewed_at AS "reviewedAt",
      ri.created_at AS "createdAt",
      s.title AS "sourceTitle",
      s.url AS "sourceUrl",
      s.source_type AS "sourceType"
    FROM knowledge_review_items ri
    LEFT JOIN knowledge_sources s ON s.id = ri.source_id
    WHERE (${status} = 'all' OR ri.status = ${status})
    ORDER BY COALESCE(ri.reviewed_at, ri.created_at) DESC
    LIMIT 100
  `);
  res.json(rowsOf(result));
});

router.get("/knowledge/admin/chat-candidates", requireAuth, async (req, res): Promise<void> => {
  if (!(await requireKnowledgeAdmin(req, res))) return;
  const status = textValue(req.query.status, "all");
  const result = await db.execute(sql`
    SELECT
      ri.id,
      ri.tenant_id AS "tenantId",
      ri.source_id AS "sourceId",
      ri.job_id AS "jobId",
      ri.item_type AS "itemType",
      ri.graph_id AS "graphId",
      ri.title,
      ri.body,
      ri.status,
      ri.reviewed_at AS "reviewedAt",
      ri.created_at AS "createdAt",
      u.nickname AS "userNickname",
      u.email AS "userEmail",
      ri.payload_json -> 'memory' ->> 'memoryType' AS "memoryType",
      (ri.payload_json -> 'memory' ->> 'confidence')::int AS "confidence",
      ri.payload_json -> 'chatSource' ->> 'roomId' AS "sourceRoomId",
      ri.payload_json -> 'chatSource' ->> 'messageId' AS "sourceMessageId",
      ri.payload_json -> 'chatSource' ->> 'snippet' AS "sourceSnippet"
    FROM knowledge_review_items ri
    LEFT JOIN users u ON u.id = ri.created_by_user_id
    WHERE ri.item_type = ${CHAT_KNOWLEDGE_ITEM_TYPE}
      AND (${status} = 'all' OR ri.status = ${status})
    ORDER BY COALESCE(ri.reviewed_at, ri.created_at) DESC
    LIMIT 100
  `);
  res.json(rowsOf(result));
});

router.post("/knowledge/admin/review-items/:id/approve", requireAuth, async (req, res): Promise<void> => {
  if (!(await requireKnowledgeAdmin(req, res))) return;
  const reviewItemId = routeParam(req.params.id);
  const [item] = await db.select().from(knowledgeReviewItemsTable).where(eq(knowledgeReviewItemsTable.id, reviewItemId)).limit(1);
  if (!item) {
    res.status(404).json({ error: "review item not found" });
    return;
  }
  if (item.status === "approved") {
    res.json(item);
    return;
  }
  await approveReviewItem(item, req.log);
  const [updated] = await db.update(knowledgeReviewItemsTable).set({ status: "approved", reviewedByUserId: req.dbUser!.id, reviewedAt: new Date() }).where(eq(knowledgeReviewItemsTable.id, item.id)).returning();
  await db.insert(knowledgeReviewEventsTable).values({ reviewItemId: item.id, actorUserId: req.dbUser!.id, action: "approved", note: textValue(req.body?.note) || null });
  res.json(updated);
});

router.post("/knowledge/admin/review-items/:id/reject", requireAuth, async (req, res): Promise<void> => {
  if (!(await requireKnowledgeAdmin(req, res))) return;
  const reviewItemId = routeParam(req.params.id);
  const [updated] = await db.update(knowledgeReviewItemsTable).set({ status: "rejected", reviewedByUserId: req.dbUser!.id, reviewedAt: new Date() }).where(eq(knowledgeReviewItemsTable.id, reviewItemId)).returning();
  if (!updated) {
    res.status(404).json({ error: "review item not found" });
    return;
  }
  await db.insert(knowledgeReviewEventsTable).values({ reviewItemId: updated.id, actorUserId: req.dbUser!.id, action: "rejected", note: textValue(req.body?.note) || null });
  res.json(updated);
});

router.get("/knowledge/admin/campaigns", requireAuth, async (req, res): Promise<void> => {
  if (!(await requireKnowledgeAdmin(req, res))) return;
  const rows = await db.select().from(aiCampaignsTable).orderBy(desc(aiCampaignsTable.createdAt)).limit(50);
  res.json(rows);
});

router.post("/knowledge/admin/campaigns", requireAuth, async (req, res): Promise<void> => {
  if (!(await requireKnowledgeAdmin(req, res))) return;
  const title = textValue(req.body?.title);
  const messageTemplate = textValue(req.body?.messageTemplate);
  if (!title || !messageTemplate) {
    res.status(400).json({ error: "title and messageTemplate required" });
    return;
  }
  const [created] = await db.insert(aiCampaignsTable).values({
    tenantId: textValue(req.body?.tenantId, BIBI_GRAPH_TENANT_ID),
    ownerUserId: textValue(req.body?.ownerUserId, BIBI_OFFICIAL_USER_ID),
    title,
    status: textValue(req.body?.status, "draft"),
    triggerType: textValue(req.body?.triggerType, "manual"),
    conditionJson: typeof req.body?.conditionJson === "object" && req.body.conditionJson ? req.body.conditionJson : {},
    messageTemplate,
    cooldownHours: Number(req.body?.cooldownHours ?? 24),
    maxPerUser: Number(req.body?.maxPerUser ?? 1),
    createdByUserId: req.dbUser!.id,
  }).returning();
  res.status(201).json(created);
});

router.post("/knowledge/admin/campaigns/:id/test-delivery", requireAuth, async (req, res): Promise<void> => {
  if (!(await requireKnowledgeAdmin(req, res))) return;
  const targetUserId = textValue(req.body?.targetUserId);
  if (!targetUserId) {
    res.status(400).json({ error: "targetUserId required" });
    return;
  }
  const campaignId = routeParam(req.params.id);
  const [campaign] = await db.select().from(aiCampaignsTable).where(eq(aiCampaignsTable.id, campaignId)).limit(1);
  if (!campaign) {
    res.status(404).json({ error: "campaign not found" });
    return;
  }
  const result = await queueAiCampaignDelivery({
    campaign,
    targetUserId,
    roomId: textValue(req.body?.roomId) || null,
  });
  res.status(result.queued ? 201 : 200).json(result);
});

router.get("/knowledge/memories", requireAuth, async (req, res): Promise<void> => {
  const rows = await db.select().from(userAiMemoriesTable).where(and(eq(userAiMemoriesTable.userId, req.dbUser!.id), eq(userAiMemoriesTable.status, "approved"))).orderBy(desc(userAiMemoriesTable.createdAt)).limit(100);
  res.json(rows);
});

router.post("/knowledge/memories", requireAuth, async (req, res): Promise<void> => {
  const text = textValue(req.body?.text);
  if (!text) {
    res.status(400).json({ error: "text required" });
    return;
  }
  const [created] = await db.insert(userAiMemoriesTable).values({
    userId: req.dbUser!.id,
    memoryType: textValue(req.body?.memoryType, "preference"),
    text,
    privacyScope: textValue(req.body?.privacyScope, "user_private") as any,
    status: "approved",
    source: "manual",
  }).returning();
  await enqueueUserAiMemoryOntologySyncSafe(created, req.log);
  res.status(201).json(created);
});

router.patch("/knowledge/memories/:id", requireAuth, async (req, res): Promise<void> => {
  const memoryId = routeParam(req.params.id);
  const patch: Record<string, unknown> = {};
  if (typeof req.body?.text === "string") patch.text = req.body.text.trim();
  if (typeof req.body?.privacyScope === "string") patch.privacyScope = req.body.privacyScope;
  if (typeof req.body?.status === "string") patch.status = req.body.status;
  patch.updatedAt = new Date();
  const [updated] = await db.update(userAiMemoriesTable).set(patch as any).where(and(eq(userAiMemoriesTable.id, memoryId), eq(userAiMemoriesTable.userId, req.dbUser!.id))).returning();
  if (!updated) {
    res.status(404).json({ error: "memory not found" });
    return;
  }
  await enqueueUserAiMemoryOntologySyncSafe(updated, req.log);
  res.json(updated);
});

router.delete("/knowledge/memories/:id", requireAuth, async (req, res): Promise<void> => {
  const memoryId = routeParam(req.params.id);
  const [updated] = await db.update(userAiMemoriesTable).set({ status: "archived", updatedAt: new Date() }).where(and(eq(userAiMemoriesTable.id, memoryId), eq(userAiMemoriesTable.userId, req.dbUser!.id))).returning();
  if (!updated) {
    res.status(404).json({ error: "memory not found" });
    return;
  }
  res.json(updated);
});

export default router;
