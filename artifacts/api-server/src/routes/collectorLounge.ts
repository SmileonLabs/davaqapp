import {getReadingDigest} from '../lib/collectorLounge/reading';
import { Router, type IRouter } from "express";
import collectorProfiles from "./collectorProfiles";
import { pool } from "@workspace/db";
import { requireAuth } from "../lib/auth";
import { hasAdminRole } from "../lib/adminRbac";
import { resolveCharacterProfileActor } from "../lib/characterProfiles";
import { rateLimit } from "../lib/rateLimit";
import { z } from "zod/v4";
import { COLLECTORS, LOUNGE_ID } from "../lib/collectorLounge/policy";
import {
  upsertGraphTenant,
  upsertEntity,
  upsertClaim,
} from "../lib/knowledgeGraph/core";
import { isKnowledgeAdmin } from "../lib/knowledge/validation";
import { cardId } from "../lib/tcgCatalog";
const router: IRouter = Router();
async function canManage(user: any) {
  return (
    isKnowledgeAdmin(user) ||
    (await hasAdminRole(user.id, ["super_admin", "operations"]))
  );
}
const available = () => process.env.COLLECTOR_LOUNGE_ENABLED === "true";
router.get("/collector-lounge", async (_req, res) => {
  if (!available()) {
    res.json({ available: false });
    return;
  }
  const l = (
    await pool.query(
      "SELECT room_id,paused,topic,topic_card_id,message_label FROM collector_lounges WHERE room_id=$1",
      [LOUNGE_ID],
    )
  ).rows[0];
  const preview = l
    ? (
        await pool.query(
          `SELECT m.id,m.content,m.created_at,u.nickname FROM messages m JOIN users u ON u.id=m.sender_id WHERE m.room_id=$1 AND m.author_kind='bot' AND m.metadata->>'collectorAi'='true' AND m.deleted_at IS NULL ORDER BY m.room_seq DESC LIMIT 6`,
          [LOUNGE_ID],
        )
      ).rows.reverse()
    : [];
  res.json({
    available: !!l,
    name: "수집AI수다방",
    description: "AI 수집가들의 카드 수다를 구경하고 함께 이야기하세요.",
    ...l,
    presentation: { messageLabel: l?.message_label?.trim() || null, readingEnabled: !!l },
    preview,
    characters: COLLECTORS.map(({ key, id, name, bio }) => ({
      key,
      id,
      name,
      description: bio,
    })),
    notice:
      "공개 그룹방입니다. AI 응답을 위해 최근 대화가 외부 AI 서비스에 전달됩니다. 비공개 대화·개인 기억은 사용하지 않습니다.",
  });
});
router.get('/collector-lounge/reading',async(_req,res)=>{
 if(!available()){res.status(404).json({error:'not_available'});return;}
 const digest=await getReadingDigest();res.setHeader('Cache-Control','public, max-age=60');res.json(digest);
});
router.post(
  "/collector-lounge/join",
  requireAuth,
  rateLimit({
    name: "collector-join",
    limit: 10,
    windowSeconds: 60,
    requireRedis: true,
  }),
  async (req, res) => {
    if (!available()) {
      res.status(404).json({ error: "not_available" });
      return;
    }
    if (req.body?.acknowledgePublicAi !== true) {
      res.status(400).json({ error: "public_ai_notice_required" });
      return;
    }
    const actor = await resolveCharacterProfileActor(req.dbUser!.id);
    const c = await pool.connect();
    try {
      await c.query("BEGIN");
      const l = (
        await c.query(
          "SELECT room_id FROM collector_lounges WHERE room_id=$1 FOR UPDATE",
          [LOUNGE_ID],
        )
      ).rows[0];
      if (!l) {
        await c.query("ROLLBACK");
        res.status(404).json({ error: "not_available" });
        return;
      }
      const existing = (
        await c.query(
          "SELECT id FROM chat_room_members WHERE room_id=$1 AND user_id=$2",
          [LOUNGE_ID, req.dbUser!.id],
        )
      ).rows[0];
      if (existing)
        await c.query(
          "UPDATE chat_room_members SET hidden_at=NULL,profile_id=$3 WHERE room_id=$1 AND user_id=$2",
          [LOUNGE_ID, req.dbUser!.id, actor.id],
        );
      else {
        const count = (
          await c.query(
            "SELECT count(*)::int AS count FROM chat_room_members WHERE room_id=$1",
            [LOUNGE_ID],
          )
        ).rows[0].count;
        if (count >= 100) {
          await c.query("ROLLBACK");
          res.status(409).json({ error: "room_full" });
          return;
        }
        await c.query(
          "INSERT INTO chat_room_members(room_id,user_id,profile_id,muted) VALUES($1,$2,$3,true)",
          [LOUNGE_ID, req.dbUser!.id, actor.id],
        );
      }
      await c.query("COMMIT");
      res.json({ roomId: LOUNGE_ID });
    } catch (e) {
      await c.query("ROLLBACK");
      throw e;
    } finally {
      c.release();
    }
  },
);
export async function provisionCollectorLounge(ownerId: string) {
  const c = await pool.connect();
  try {
    await c.query("BEGIN");
    await c.query(
      "SELECT pg_advisory_xact_lock(hashtext('collector-lounge-provision'))",
    );
    for (const a of COLLECTORS) {
      await c.query(
        `INSERT INTO users(id,clerk_id,email,nickname,status_message,notification_enabled,talk_analysis_enabled) VALUES($1,$2,$3,$4,$5,false,false) ON CONFLICT(id) DO UPDATE SET nickname=EXCLUDED.nickname,status_message=EXCLUDED.status_message`,
        [
          a.id,
          `official:collector:${a.key}`,
          `collector-${a.key}@davaq.local`,
          a.name,
          a.bio,
        ],
      );
      await c.query(
        `INSERT INTO official_ai_accounts(id,slug,display_name,account_kind,status,description,official_user_id,knowledge_tenant_id,persona_json,published_at) VALUES($1,$2,$3,'collector','published',$4,$1,$5,$6::jsonb,now()) ON CONFLICT(slug) DO UPDATE SET display_name=EXCLUDED.display_name,description=EXCLUDED.description,persona_json=EXCLUDED.persona_json`,
        [
          a.id,
          `collector-${a.key}`,
          a.name,
          a.bio,
          `collector-room:${LOUNGE_ID}`,
          JSON.stringify({ style: a.style, ai: true }),
        ],
      );
      await c.query(
        `INSERT INTO character_profiles(id,owner_user_id,type,handle,display_name,status_message,status,metadata) VALUES($1,$1,'official_ai',$2,$3,$4,'active','{"collectorAi":true}') ON CONFLICT(id) DO UPDATE SET display_name=EXCLUDED.display_name,status_message=EXCLUDED.status_message`,
        [a.id, `collector-${a.key}`, a.name, a.bio],
      );
      await c.query(
        `INSERT INTO official_ai_character_profiles(profile_id,official_ai_account_id) VALUES($1,$1) ON CONFLICT DO NOTHING`,
        [a.id],
      );
      await c.query(
        `INSERT INTO active_character_profiles(user_id,active_profile_id,last_star_profile_id) VALUES($1,$1,$1) ON CONFLICT(user_id) DO NOTHING`,
        [a.id],
      );
    }
    await c.query(
      `INSERT INTO chat_rooms(id,type,category,visibility,name,owner_id) VALUES($1,'group','collector_ai','invite_only','수집AI수다방',$2) ON CONFLICT(id) DO UPDATE SET category='collector_ai',name='수집AI수다방'`,
      [LOUNGE_ID, ownerId],
    );
    for (const a of COLLECTORS)
      await c.query(
        `INSERT INTO chat_room_members(room_id,user_id,profile_id,muted) SELECT $1,$2,$2,true WHERE NOT EXISTS(SELECT 1 FROM chat_room_members WHERE room_id=$1 AND user_id=$2)`,
        [LOUNGE_ID, a.id],
      );
    await c.query(
      `INSERT INTO collector_lounges(room_id,slug) VALUES($1,'collectors') ON CONFLICT DO NOTHING`,
      [LOUNGE_ID],
    );
    await c.query("COMMIT");
  } catch (e) {
    await c.query("ROLLBACK");
    throw e;
  } finally {
    c.release();
  }
  const tenant = `collector-room:${LOUNGE_ID}`;
  await upsertGraphTenant({
    id: tenant,
    type: "community",
    ownerId: LOUNGE_ID,
  });
  for (const a of COLLECTORS) {
    await upsertEntity({
      id: `${tenant}:${a.key}`,
      tenantId: tenant,
      type: "CollectorPersona",
      name: a.name,
    });
    await upsertClaim({
      id: `${tenant}:${a.key}:style`,
      tenantId: tenant,
      subjectEntityId: `${tenant}:${a.key}`,
      predicate: "fictional_persona_style",
      text: a.style,
      status: "approved",
      visibility: "official_public",
    });
  }
  return { roomId: LOUNGE_ID, paused: true };
}
router.post(
  "/admin/collector-lounge/provision",
  requireAuth,
  async (req, res) => {
    if (!(await canManage(req.dbUser!))) {
      res.status(403).json({ error: "admin_required" });
      return;
    }
    res.json(await provisionCollectorLounge(req.dbUser!.id));
  },
);
router.get("/admin/collector-lounge", requireAuth, async (req, res) => {
  if (!(await canManage(req.dbUser!))) {
    res.status(403).json({ error: "admin_required" });
    return;
  }
  const l =
    (
      await pool.query("SELECT * FROM collector_lounges WHERE room_id=$1", [
        LOUNGE_ID,
      ])
    ).rows[0] ?? null;
  const runs = (
    await pool.query(
      "SELECT id,status,speaker,input_tokens,error_code,created_at FROM collector_lounge_runs WHERE room_id=$1 ORDER BY created_at DESC LIMIT 30",
      [LOUNGE_ID],
    )
  ).rows;
  res.json({ lounge: l, runs, jevConfigured: !!process.env.JEV_AI_API_KEY });
});
router.patch("/admin/collector-lounge/presentation", requireAuth, async (req, res) => {
  if (!(await canManage(req.dbUser!))) {
    res.status(403).json({ error: "admin_required" });
    return;
  }
  const parsed = z.object({ messageLabel: z.string().trim().max(80).nullable() }).strict().safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid_presentation" });
    return;
  }
  const label = parsed.data.messageLabel || null;
  await pool.query("UPDATE collector_lounges SET message_label=$2,updated_at=now() WHERE room_id=$1", [LOUNGE_ID,label]);
  res.json({ presentation: { messageLabel: label } });
});
router.patch("/admin/collector-lounge", requireAuth, async (req, res) => {
  if (!(await canManage(req.dbUser!))) {
    res.status(403).json({ error: "admin_required" });
    return;
  }
  const parsed = z
    .object({
      paused: z.boolean(),
      topic: z.string().trim().min(1).max(300),
      cardId: cardId.nullable(),
      dailyLimit: z.number().int().min(1).max(1000),
      dailyTokenLimit: z.number().int().min(1000).max(2000000),
    })
    .strict()
    .safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid_settings" });
    return;
  }
  const p = parsed.data;
  await pool.query(
    `UPDATE collector_lounges SET paused=$2,topic=$3,topic_card_id=$4,daily_limit=$5,daily_token_limit=$6,next_at=now(),lease_token=NULL,lease_until=NULL,episode_turns=4,updated_at=now() WHERE room_id=$1`,
    [LOUNGE_ID, p.paused, p.topic, p.cardId, p.dailyLimit, p.dailyTokenLimit],
  );
  res.json({ ok: true });
});
router.use(collectorProfiles);
export default router;
