import express, {
  Router,
  type IRouter,
  type Request,
  type Response,
} from "express";
import { z } from "zod/v4";
import { pool } from "@workspace/db";
import { requireAuth } from "../lib/auth";
import { hasAdminRole } from "../lib/adminRbac";
import { isKnowledgeAdmin } from "../lib/knowledge/validation";
import { rateLimit } from "../lib/rateLimit";
import { ObjectStorageService } from "../lib/objectStorage";
import { ExchangeError, demand, transaction } from "../lib/exchangeService";
import {
  brandConfig,
  answerMap,
  eventInput,
  preferenceInput,
  encryptCode,
  decryptCode,
  fingerprint,
} from "../lib/brandRules";
import {
  listBrandExchanges,
  getCampaign,
  startBrand,
  leaseBrand,
  brandEvent,
  getParticipation,
  participationDto,
  rewardList,
  brandPreferences,
} from "../lib/brandExchange";
import { brandMp4Info } from "../lib/brandMp4";
const router: IRouter = Router(),
  uuid = z.uuid();
const run =
  (fn: (req: Request, res: Response) => Promise<void>) =>
  async (req: Request, res: Response) => {
    try {
      res.set("Cache-Control", "no-store");
      await fn(req, res);
    } catch (e) {
      if (e instanceof z.ZodError) {
        res
          .status(400)
          .json({
            message: e.issues
              .map((i) => i.path.join(".") + ": " + i.message)
              .join("\n"),
          });
        return;
      }
      if (e instanceof ExchangeError) {
        res.status(e.status).json({ message: e.message });
        return;
      }
      req.log?.warn(
        { error: e instanceof Error ? e.name : "Error" },
        "Brand exchange request failed",
      );
      res
        .status(500)
        .json({
          message: "처리를 완료하지 못했어요. 잠시 후 다시 시도해 주세요.",
        });
    }
  };
const admin = async (req: Request, write = false) => {
  demand(
    isKnowledgeAdmin(req.dbUser!) ||
      (await hasAdminRole(
        req.dbUser!.id,
        write
          ? ["super_admin", "operations"]
          : ["super_admin", "operations", "support", "analyst"],
      )),
    403,
    "브랜드 운영 권한이 필요해요.",
  );
};
router.use(
  ["/brand-exchanges", "/brand-rewards", "/brand-preferences", "/brand-admin"],
  requireAuth,
);
router.get(
  "/brand-exchanges",
  run(async (req, res) => {
    res.json(
      await listBrandExchanges(
        req.dbUser!.id,
        req.query.recommended === "true",
      ),
    );
  }),
);
router.get(
  "/brand-exchanges/participations",
  run(async (req, res) => {
    const rows = (
      await pool.query(
        "SELECT p.*,v.config,v.answers,c.id claim_id FROM brand_participations p JOIN brand_versions v ON v.id=p.version_id LEFT JOIN brand_claims c ON c.participation_id=p.id WHERE p.user_id=$1 ORDER BY p.created_at DESC LIMIT 50",
        [req.dbUser!.id],
      )
    ).rows;
    res.json({ items: rows.map(participationDto) });
  }),
);
router.get(
  "/brand-exchanges/participations/:id",
  run(async (req, res) => {
    res.json(
      participationDto(
        await getParticipation(uuid.parse(req.params.id), req.dbUser!.id),
      ),
    );
  }),
);
router.post(
  "/brand-exchanges/participations/:id/lease",
  rateLimit({ name: "brand-lease", limit: 20, windowSeconds: 60 }),
  run(async (req, res) => {
    res.json(await leaseBrand(uuid.parse(req.params.id), req.dbUser!.id));
  }),
);
router.post(
  "/brand-exchanges/participations/:id/events",
  rateLimit({ name: "brand-event", limit: 180, windowSeconds: 60 }),
  run(async (req, res) => {
    res.json(
      await brandEvent(
        uuid.parse(req.params.id),
        req.dbUser!.id,
        eventInput.parse(req.body),
      ),
    );
  }),
);
router.get(
  "/brand-exchanges/:id",
  run(async (req, res) => {
    res.json(await getCampaign(uuid.parse(req.params.id), req.dbUser!.id));
  }),
);
router.post(
  "/brand-exchanges/:id/start",
  rateLimit({ name: "brand-start", limit: 10, windowSeconds: 60 }),
  run(async (req, res) => {
    res.json(
      await startBrand(
        uuid.parse(req.params.id),
        req.dbUser!.id,
        z.object({ requestKey: uuid }).parse(req.body).requestKey,
      ),
    );
  }),
);
router.get(
  "/brand-preferences",
  run(async (req, res) => {
    const prefs = await brandPreferences(req.dbUser!.id);
    const n = (
      await pool.query(
        "SELECT count(DISTINCT p.campaign_id)::int n FROM brand_claims c JOIN brand_participations p ON p.id=c.participation_id WHERE c.user_id=$1 AND c.status='issued'",
        [req.dbUser!.id],
      )
    ).rows[0].n;
    res.json({ ...prefs, discoveries: n });
  }),
);
router.patch(
  "/brand-preferences",
  run(async (req, res) => {
    const b = preferenceInput.parse(req.body);
    await brandPreferences(req.dbUser!.id);
    const result = await pool.query(
      "UPDATE brand_preferences SET categories=$2,region=$3,personalized=$4,version=version+1,updated_at=now() WHERE user_id=$1 AND version=$5 RETURNING *",
      [
        req.dbUser!.id,
        JSON.stringify(b.categories),
        b.region,
        b.personalized,
        b.version,
      ],
    );
    demand(
      result.rows[0],
      409,
      "설정이 변경됐어요. 새로고침 후 저장해 주세요.",
    );
    res.json(result.rows[0]);
  }),
);
router.get(
  "/brand-rewards",
  run(async (req, res) => {
    res.json({ items: await rewardList(req.dbUser!.id) });
  }),
);
router.get(
  "/brand-rewards/:id",
  run(async (req, res) => {
    const r = (await rewardList(req.dbUser!.id, uuid.parse(req.params.id)))[0];
    demand(r, 404, "내 혜택을 찾을 수 없어요.");
    res.json(r);
  }),
);
router.post(
  "/brand-rewards/:id/reveal",
  rateLimit({ name: "brand-code", limit: 20, windowSeconds: 60 }),
  run(async (req, res) => {
    const r = (
      await pool.query(
        "SELECT u.encrypted_code FROM brand_claims c JOIN brand_units u ON u.id=c.unit_id WHERE c.id=$1 AND c.user_id=$2 AND c.status='issued' AND u.valid_until>now()",
        [uuid.parse(req.params.id), req.dbUser!.id],
      )
    ).rows[0];
    demand(r, 404, "지금 확인할 수 있는 내 쿠폰이 없어요.");
    res.json({ code: decryptCode(r.encrypted_code) });
  }),
);
router.post(
  "/brand-rewards/:id/actions",
  run(async (req, res) => {
    const b = z
      .object({
        action: z.enum(["used", "unused", "issue"]),
        note: z.string().trim().max(1000).default(""),
      })
      .parse(req.body);
    demand(
      b.action !== "issue" || b.note.length >= 5,
      400,
      "문제 상황을 5자 이상 적어 주세요.",
    );
    const r = await pool.query(
      `UPDATE brand_claims SET ${b.action === "issue" ? "issue=$3,resolution=''" : b.action === "used" ? "self_used_at=now()" : "self_used_at=NULL"} WHERE id=$1 AND user_id=$2 RETURNING id`,
      b.action === "issue"
        ? [uuid.parse(req.params.id), req.dbUser!.id, b.note]
        : [uuid.parse(req.params.id), req.dbUser!.id],
    );
    demand(r.rows[0], 404, "내 혜택을 찾을 수 없어요.");
    res.json({ ok: true });
  }),
);
router.get(
  "/brand-admin",
  run(async (req, res) => {
    await admin(req);
    const canManage =
      isKnowledgeAdmin(req.dbUser!) ||
      (await hasAdminRole(req.dbUser!.id, ["super_admin", "operations"]));
    const campaigns = (
      await pool.query(`SELECT c.id,c.status,c.budget,c.held,c.spent,v.config->>'title' title,v.config->>'brand' brand,
 (SELECT count(*)::int FROM brand_units u WHERE u.campaign_id=c.id AND u.state='available' AND u.valid_until>now()+interval '7 days') available,
 (SELECT count(*)::int FROM brand_participations p WHERE p.campaign_id=c.id) starts,
 (SELECT count(*)::int FROM (SELECT DISTINCT p.id,e.response->>'attempt' attempt FROM brand_participations p JOIN brand_events e ON e.participation_id=p.id WHERE p.campaign_id=c.id AND e.action='finish' AND (e.response->>'progress')::double precision>=29.8) complete_attempts) completed_playbacks,
 (SELECT count(*)::int FROM brand_participations p WHERE p.campaign_id=c.id AND p.attempt=2) retries,
 (SELECT count(*)::int FROM brand_participations p WHERE p.campaign_id=c.id AND p.status='succeeded') successes,
 (SELECT count(*)::int FROM brand_claims r JOIN brand_participations p ON p.id=r.participation_id WHERE p.campaign_id=c.id AND r.status='issued') issued,
 (SELECT count(*)::int FROM brand_claims r JOIN brand_participations p ON p.id=r.participation_id WHERE p.campaign_id=c.id AND r.self_used_at IS NOT NULL) self_reported_used
 FROM brand_campaigns c JOIN brand_versions v ON v.id=c.current_version_id ORDER BY c.created_at DESC LIMIT 100`)
    ).rows;
    const issues = (
      await pool.query(
        "SELECT c.id,c.status,c.issue,c.resolution,c.created_at,v.config->>'rewardTitle' title FROM brand_claims c JOIN brand_participations p ON p.id=c.participation_id JOIN brand_versions v ON v.id=p.version_id WHERE (c.issue<>'' AND c.resolution='') OR c.status='needs_reconciliation' ORDER BY c.created_at LIMIT 100",
      )
    ).rows;
    res.json({ canManage, campaigns, issues });
  }),
);
router.post(
  "/brand-admin/uploads",
  rateLimit({ name: "brand-upload", limit: 10, windowSeconds: 3600 }),
  async (req, res, next) => {
    try {
      await admin(req, true);
      next();
    } catch {
      res.status(403).json({ message: "브랜드 운영 권한이 필요해요." });
    }
  },
  express.raw({ type: "video/mp4", limit: "25mb" }),
  run(async (req, res) => {
    const b = Buffer.isBuffer(req.body) ? req.body : null;
    demand(
      b && b.length > 16 && b.toString("ascii", 4, 8) === "ftyp",
      400,
      "25MB 이하 MP4 동영상을 선택해 주세요.",
    );
    let info: ReturnType<typeof brandMp4Info>;
    try {
      info = brandMp4Info(b);
    } catch {
      throw new ExchangeError(
        400,
        "H.264 형식, 30초 길이, 최대 1920px의 MP4 영상을 등록해 주세요.",
      );
    }
    const objectPath = await new ObjectStorageService().uploadObjectEntity(
      b,
      "video/mp4",
    );
    await pool.query(
      "INSERT INTO brand_media(object_path,owner_id,width,height,duration) VALUES($1,$2,$3,$4,$5)",
      [objectPath, req.dbUser!.id, info.width, info.height, info.seconds],
    );
    res.status(201).json({ objectPath });
  }),
);
router.post(
  "/brand-admin/campaigns",
  run(async (req, res) => {
    await admin(req, true);
    const b = z
      .object({
        config: brandConfig,
        answers: answerMap,
        budget: z.number().int().min(0).max(1000000000),
        requestKey: uuid,
      })
      .parse(req.body);
    demand(
      b.config.videoA !== b.config.videoB,
      400,
      "서로 다른 원본과 수정 영상을 등록해 주세요.",
    );
    demand(
      new Date(b.config.endsAt).getTime() > Date.now(),
      400,
      "종료일을 미래로 설정해 주세요.",
    );
    const result = await transaction(async (sql) => {
      await sql.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
        "brand-create:" + req.dbUser!.id + ":" + b.requestKey,
      ]);
      const old = (
        await sql.query(
          "SELECT target_id FROM admin_audit_logs WHERE actor_user_id=$1 AND action='brand_create' AND after_json->>'requestKey'=$2",
          [req.dbUser!.id, b.requestKey],
        )
      ).rows[0];
      if (old) return { id: old.target_id };
      const media = (
        await sql.query(
          "SELECT object_path,width,height FROM brand_media WHERE owner_id=$1 AND object_path IN($2,$3)",
          [req.dbUser!.id, b.config.videoA, b.config.videoB],
        )
      ).rows;
      demand(media.length === 2, 403, "직접 업로드한 두 영상을 사용해 주세요.");
      demand(
        media[0].width === media[1].width &&
          media[0].height === media[1].height,
        400,
        "두 영상의 가로·세로 크기를 동일하게 맞춰 주세요.",
      );
      const c = (
        await sql.query(
          "INSERT INTO brand_campaigns(created_by,budget) VALUES($1,$2) RETURNING id",
          [req.dbUser!.id, b.budget],
        )
      ).rows[0];
      const v = (
        await sql.query(
          "INSERT INTO brand_versions(campaign_id,config,answers) VALUES($1,$2,$3) RETURNING id",
          [c.id, JSON.stringify(b.config), JSON.stringify(b.answers)],
        )
      ).rows[0];
      await sql.query(
        "UPDATE brand_campaigns SET current_version_id=$2 WHERE id=$1",
        [c.id, v.id],
      );
      await sql.query(
        "INSERT INTO brand_budget_ledger(campaign_id,kind,amount) VALUES($1,'fund',$2)",
        [c.id, b.budget],
      );
      await sql.query(
        "INSERT INTO admin_audit_logs(actor_user_id,action,target_type,target_id,reason,after_json) VALUES($1,'brand_create','brand_campaign',$2,'소재 권리 및 보상·예산 확보 확인',$3)",
        [req.dbUser!.id, c.id, JSON.stringify({ requestKey: b.requestKey })],
      );
      return { id: c.id };
    });
    res.status(201).json(result);
  }),
);
router.post(
  "/brand-admin/campaigns/:id/inventory",
  run(async (req, res) => {
    await admin(req, true);
    const id = uuid.parse(req.params.id),
      b = z
        .object({
          codes: z.array(z.string().trim().min(4).max(500)).min(1).max(100),
          validUntil: z.iso.datetime(),
        })
        .parse(req.body);
    demand(
      new Date(b.validUntil).getTime() > Date.now() + 7 * 86400000,
      400,
      "유효기간이 7일보다 많이 남은 보상을 등록해 주세요.",
    );
    const codes = [...new Set(b.codes)];
    const count = await transaction(async (sql) => {
      const c = (
        await sql.query(
          "SELECT v.config FROM brand_campaigns c JOIN brand_versions v ON v.id=c.current_version_id WHERE c.id=$1 FOR UPDATE OF c",
          [id],
        )
      ).rows[0];
      demand(c, 404, "캠페인을 찾을 수 없어요.");
      let n = 0;
      for (const code of codes) {
        n +=
          (
            await sql.query(
              "INSERT INTO brand_units(campaign_id,encrypted_code,fingerprint,valid_until) VALUES($1,$2,$3,$4) ON CONFLICT(fingerprint) DO NOTHING",
              [
                id,
                encryptCode(code),
                fingerprint(c.config.brand, code),
                b.validUntil,
              ],
            )
          ).rowCount ?? 0;
      }
      await sql.query(
        "INSERT INTO admin_audit_logs(actor_user_id,action,target_type,target_id,reason,after_json) VALUES($1,'brand_inventory','brand_campaign',$2,'확보한 고유 보상 등록',$3)",
        [req.dbUser!.id, id, JSON.stringify({ count: n })],
      );
      return n;
    });
    res.json({ added: count });
  }),
);
router.post(
  "/brand-admin/campaigns/:id/actions",
  run(async (req, res) => {
    await admin(req, true);
    const id = uuid.parse(req.params.id),
      b = z
        .object({
          status: z.enum(["published", "paused", "ended"]),
          reason: z.string().trim().min(5).max(500),
          budget: z.number().int().min(0).max(1000000000).optional(),
        })
        .parse(req.body);
    await transaction(async (sql) => {
      const c = (
        await sql.query(
          "SELECT c.*,v.config FROM brand_campaigns c JOIN brand_versions v ON v.id=c.current_version_id WHERE c.id=$1 FOR UPDATE OF c",
          [id],
        )
      ).rows[0];
      demand(c, 404, "캠페인을 찾을 수 없어요.");
      const budget = b.budget ?? c.budget;
      demand(
        budget >= c.held + c.spent,
        409,
        "확보·지급한 보상 예산보다 줄일 수 없어요.",
      );
      if (b.status === "published") {
        const available = (
          await sql.query(
            "SELECT 1 FROM brand_units WHERE campaign_id=$1 AND state='available' AND valid_until>now()+interval '7 days' LIMIT 1",
            [id],
          )
        ).rows[0];
        demand(
          available &&
            budget >= c.held + c.spent + c.config.cost &&
            new Date(c.config.endsAt).getTime() > Date.now(),
          409,
          "사용 가능한 보상 재고, 예산과 종료일을 확인해 주세요.",
        );
      }
      await sql.query(
        "UPDATE brand_campaigns SET status=$2,budget=$3 WHERE id=$1",
        [id, b.status, budget],
      );
      if (budget !== c.budget)
        await sql.query(
          "INSERT INTO brand_budget_ledger(campaign_id,kind,amount) VALUES($1,'fund',$2)",
          [id, budget - c.budget],
        );
      await sql.query(
        "INSERT INTO admin_audit_logs(actor_user_id,action,target_type,target_id,reason,after_json) VALUES($1,'brand_status','brand_campaign',$2,$3,$4)",
        [
          req.dbUser!.id,
          id,
          b.reason,
          JSON.stringify({ status: b.status, budget }),
        ],
      );
    });
    res.json({ ok: true });
  }),
);
router.post(
  "/brand-admin/rewards/:id/resolve",
  run(async (req, res) => {
    await admin(req, true);
    const id = uuid.parse(req.params.id),
      b = z
        .object({
          reason: z.string().trim().min(5).max(1000),
          retry: z.boolean().default(false),
        })
        .parse(req.body);
    await transaction(async (sql) => {
      const c = (
        await sql.query("SELECT * FROM brand_claims WHERE id=$1 FOR UPDATE", [
          id,
        ])
      ).rows[0];
      demand(c, 404, "혜택을 찾을 수 없어요.");
      await sql.query("UPDATE brand_claims SET resolution=$2 WHERE id=$1", [
        id,
        b.reason,
      ]);
      if (b.retry) {
        demand(
          c.status === "needs_reconciliation",
          409,
          "확인이 필요한 지급만 재처리할 수 있어요.",
        );
        await sql.query(
          "UPDATE brand_claims SET status='pending' WHERE id=$1",
          [id],
        );
        await sql.query(
          "UPDATE brand_outbox SET done_at=NULL WHERE claim_id=$1",
          [id],
        );
      }
      await sql.query(
        "INSERT INTO admin_audit_logs(actor_user_id,action,target_type,target_id,reason) VALUES($1,'brand_support','brand_claim',$2,$3)",
        [req.dbUser!.id, id, b.reason],
      );
    });
    res.json({ ok: true });
  }),
);
export default router;
