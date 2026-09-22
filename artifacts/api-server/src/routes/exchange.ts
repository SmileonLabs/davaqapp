import express, {
  Router,
  type IRouter,
  type Request,
  type Response,
} from "express";
import { z } from "zod/v4";
import { pool } from "@workspace/db";
import { requireAuth } from "../lib/auth";
import { hasAdminAccess, hasAdminRole } from "../lib/adminRbac";
import { isKnowledgeAdmin } from "../lib/knowledge/validation";
import { rateLimit } from "../lib/rateLimit";
import { ObjectStorageService } from "../lib/objectStorage";
import {
  categories,
  listingInput,
  termsInput,
  categoryEligible,
} from "../lib/exchangeRules";
import {
  demand,
  ExchangeError,
  transaction,
  getListing,
  listingDto,
  findMatches,
  getProposal,
  createProposal,
  actOnProposal,
  notifyProposal,
  proposalMessage,
  growth,
  enqueueSearch,
} from "../lib/exchangeService";
import { resolveRelay, notifyRelay } from "../lib/relayService";
const router: IRouter = Router();
router.use("/exchange", requireAuth);
const idInput = z.uuid();
const keyInput = z.string().min(8).max(100);
export const handle =
  (run: (req: Request, res: Response) => Promise<void>) =>
  async (req: Request, res: Response) => {
    try {
      await run(req, res);
    } catch (e) {
      if (e instanceof z.ZodError) {
        res
          .status(400)
          .json({
            error: "invalid",
            message: "입력 내용을 확인해 주세요.",
            fields: e.issues.map((i) => ({
              path: i.path.join("."),
              message: i.message,
            })),
          });
        return;
      }
      if (e instanceof ExchangeError) {
        res.status(e.status).json({ error: "exchange", message: e.message });
        return;
      }
      req.log?.error({ err: e }, "DavaQ request failed");
      res
        .status(500)
        .json({
          error: "unavailable",
          message: "요청을 처리하지 못했어요. 잠시 후 다시 시도해 주세요.",
        });
    }
  };
router.get(
  "/exchange/listings",
  handle(async (req, res) => {
    const input = z
      .object({
        q: z.string().max(80).optional(),
        kind: z.enum(["goods", "service", "experience"]).optional(),
        category: z.enum(categories).optional(),
        mode: z.enum(["offer", "want"]).default("offer"),
        mine: z.enum(["true", "false"]).default("false"),
        delivery: z.enum(["online", "offline"]).optional(),
        location: z.string().max(80).optional(),
        today: z.enum(["true", "false"]).optional(),
        short: z.enum(["true", "false"]).optional(),
        offset: z.coerce.number().int().min(0).max(10000).default(0),
      })
      .parse(req.query);
    const params: any[] = [req.dbUser!.id];
    const conditions: string[] = [];
    const bind = (value: any) => {
      params.push(value);
      return "$" + params.length;
    };
    conditions.push(
      input.mine === "true" ? "l.owner_id=$1" : "l.status='published'",
    );
    if (input.mine !== "true") conditions.push("l.mode=" + bind(input.mode));
    if (input.q)
      conditions.push(
        "(l.title ILIKE " +
          bind("%" + input.q + "%") +
          " OR l.description ILIKE $" +
          params.length +
          ")",
      );
    if (input.category) conditions.push("l.category=" + bind(input.category));
    if (input.kind) conditions.push("l.kind=" + bind(input.kind));
    if (input.delivery)
      conditions.push(
        "(l.delivery=" + bind(input.delivery) + " OR l.delivery='either')",
      );
    if (input.location)
      conditions.push("l.location ILIKE " + bind("%" + input.location + "%"));
    if (input.short === "true") conditions.push("l.duration_minutes<=30");
    if (input.today === "true")
      conditions.push(
        "l.available_days @> " +
          bind(
            JSON.stringify([new Date(Date.now() + 9 * 3600000).getUTCDay()]),
          ) +
          "::jsonb",
      );
    conditions.push(
      "NOT EXISTS(SELECT 1 FROM blocked_users b WHERE (b.blocker_user_id=$1 AND b.blocked_user_id=l.owner_id) OR (b.blocked_user_id=$1 AND b.blocker_user_id=l.owner_id))",
    );
    params.push(input.offset);
    const rows = (
      await pool.query(
        `SELECT l.*,u.nickname owner_name,EXISTS(SELECT 1 FROM exchange_favorites f WHERE f.user_id=$1 AND f.listing_id=l.id) favorite FROM exchange_listings l JOIN users u ON u.id=l.owner_id WHERE ${conditions.join(" AND ")} ORDER BY l.created_at DESC,l.id LIMIT 25 OFFSET $${params.length}`,
        params,
      )
    ).rows;
    res.json({
      items: rows.map(listingDto),
      nextOffset: rows.length === 25 ? input.offset + 25 : null,
    });
  }),
);
router.get(
  "/exchange/listings/:id",
  handle(async (req, res) => {
    res.json(
      listingDto(
        await getListing(idInput.parse(req.params.id), req.dbUser!.id),
      ),
    );
  }),
);
router.post(
  "/exchange/listings",
  rateLimit({ name: "exchange-create", limit: 15, windowSeconds: 3600 }),
  handle(async (req, res) => {
    const input = listingInput.parse(req.body),
      user = req.dbUser!.id;
    demand(
      input.delivery !== "offline" || input.location.length >= 2,
      400,
      "만날 지역을 입력해 주세요.",
    );
    if (input.imageKey)
      demand(
        (
          await pool.query(
            "SELECT 1 FROM exchange_media WHERE owner_id=$1 AND object_path=$2",
            [user, input.imageKey],
          )
        ).rows[0],
        403,
        "내가 올린 사진을 선택해 주세요.",
      );
    const state =
      input.status === "published" && !categoryEligible(input)
        ? "pending"
        : input.status;
    const row = await transaction(async (sql) => {
      if (input.requestKey) {
        await sql.query(
          "SELECT pg_advisory_xact_lock(hashtextextended($1,0))",
          ["davaq-listing:" + user + ":" + input.requestKey],
        );
        const prior = (
          await sql.query(
            "SELECT * FROM exchange_listings WHERE owner_id=$1 AND request_key=$2",
            [user, input.requestKey],
          )
        ).rows[0];
        if (prior) return prior;
      }
      const l = (
        await sql.query(
          `INSERT INTO exchange_listings(owner_id,mode,kind,category,title,description,wanted_text,wanted_categories,location,delivery,duration_minutes,available_days,ev,image_key,status,terms,request_key)
  VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17) RETURNING *`,
          [
            user,
            input.mode,
            input.kind,
            input.category,
            input.title,
            input.description,
            input.wantedText,
            JSON.stringify(input.wantedCategories),
            input.location,
            input.delivery,
            input.durationMinutes,
            JSON.stringify([...new Set(input.availableDays)]),
            input.ev,
            input.imageKey,
            state,
            input.terms,
            input.requestKey ?? null,
          ],
        )
      ).rows[0];
      if (state === "published")
        await growth(sql, user, "listing_published", l.id);
      await enqueueSearch(undefined, sql);
      return l;
    });
    res.status(201).json(listingDto(row));
  }),
);
router.patch(
  "/exchange/listings/:id",
  handle(async (req, res) => {
    const id = idInput.parse(req.params.id),
      input = listingInput.parse(req.body),
      user = req.dbUser!.id;
    demand(input.version, 400, "항목 버전이 필요해요.");
    demand(
      input.delivery !== "offline" || input.location.length >= 2,
      400,
      "만날 지역을 입력해 주세요.",
    );
    if (input.imageKey)
      demand(
        (
          await pool.query(
            "SELECT 1 FROM exchange_media WHERE owner_id=$1 AND object_path=$2",
            [user, input.imageKey],
          )
        ).rows[0],
        403,
        "내가 올린 사진을 선택해 주세요.",
      );
    const row = await transaction(async (sql) => {
      const old = (
        await sql.query(
          "SELECT * FROM exchange_listings WHERE id=$1 AND owner_id=$2 FOR UPDATE",
          [id, user],
        )
      ).rows[0];
      demand(old, 404, "항목을 찾을 수 없어요.");
      demand(!(await sql.query("SELECT 1 FROM exchange_relay_reservations WHERE listing_id=$1 AND active LIMIT 1",[id])).rows.length,409,"확정된 이어 바꾸기에 참여 중이에요. 교환을 마친 뒤 수정해 주세요.");
      demand(
        old.version === input.version,
        409,
        "다른 곳에서 수정했어요. 새로고침해 주세요.",
      );
      const state =
        input.status === "published" && !categoryEligible(input)
          ? "pending"
          : input.status;
      const l = (
        await sql.query(
          `UPDATE exchange_listings SET mode=$3,kind=$4,category=$5,title=$6,description=$7,wanted_text=$8,wanted_categories=$9,location=$10,delivery=$11,duration_minutes=$12,available_days=$13,ev=$14,image_key=$15,status=$16,terms=$17,version=version+1,updated_at=now() WHERE id=$1 AND owner_id=$2 RETURNING *`,
          [
            id,
            user,
            input.mode,
            input.kind,
            input.category,
            input.title,
            input.description,
            input.wantedText,
            JSON.stringify(input.wantedCategories),
            input.location,
            input.delivery,
            input.durationMinutes,
            JSON.stringify(input.availableDays),
            input.ev,
            input.imageKey,
            state,
            input.terms,
          ],
        )
      ).rows[0];
      if (state === "published")
        await growth(sql, user, "listing_published", id);
      await enqueueSearch(undefined, sql);
      return l;
    });
    res.json(listingDto(row));
  }),
);
router.post(
  "/exchange/listings/:id/favorite",
  handle(async (req, res) => {
    const id = idInput.parse(req.params.id),
      user = req.dbUser!.id;
    const input = z.object({ favorite: z.boolean() }).strict().parse(req.body);
    await getListing(id, user);
    if (input.favorite)
      await pool.query(
        "INSERT INTO exchange_favorites(user_id,listing_id) VALUES($1,$2) ON CONFLICT DO NOTHING",
        [user, id],
      );
    else
      await pool.query(
        "DELETE FROM exchange_favorites WHERE user_id=$1 AND listing_id=$2",
        [user, id],
      );
    res.json({ favorite: input.favorite });
  }),
);
router.get(
  "/exchange/matches",
  handle(async (req, res) => {
    res.json({ items: await findMatches(req.dbUser!.id) });
  }),
);
router.post(
  "/exchange/matches/:id/feedback",
  handle(async (req, res) => {
    const id = idInput.parse(req.params.id),
      user = req.dbUser!.id;
    const input = z
      .object({
        reason: z.enum(["not_interested", "schedule", "location", "scope"]),
      })
      .strict()
      .parse(req.body);
    await getListing(id, user);
    await pool.query(
      "INSERT INTO agent_match_feedback(user_id,listing_id,reason) VALUES($1,$2,$3) ON CONFLICT(user_id,listing_id) DO UPDATE SET reason=excluded.reason,created_at=now()",
      [user, id, input.reason],
    );
    await enqueueSearch(user);
    res.json({ ok: true });
  }),
);
router.get(
  "/exchange/proposals",
  handle(async (req, res) => {
    const user = req.dbUser!.id,
      roomId = req.query.roomId ? idInput.parse(req.query.roomId) : null;
    const rows = (
      await pool.query(
        "SELECT id FROM exchange_proposals WHERE $1 IN(proposer_id,recipient_id) AND ($2::uuid IS NULL OR room_id=$2) ORDER BY updated_at DESC LIMIT 50",
        [user, roomId],
      )
    ).rows;
    res.json({
      items: await Promise.all(rows.map((r) => getProposal(r.id, user))),
    });
  }),
);
router.get(
  "/exchange/proposals/:id",
  handle(async (req, res) => {
    res.json(await getProposal(idInput.parse(req.params.id), req.dbUser!.id));
  }),
);
router.post(
  "/exchange/proposals",
  rateLimit({ name: "exchange-propose", limit: 20, windowSeconds: 3600 }),
  handle(async (req, res) => {
    const input = z
      .object({
        offerId: idInput,
        requestedId: idInput,
        terms: termsInput,
        requestKey: keyInput,
      })
      .strict()
      .parse(req.body);
    const p = await createProposal(
      req.dbUser!.id,
      input.offerId,
      input.requestedId,
      input.terms,
      input.requestKey,
    );
    await notifyProposal(p, req.dbUser!.id);
    res.status(201).json(await getProposal(p.id, req.dbUser!.id));
  }),
);
router.post(
  "/exchange/proposals/:id/actions",
  handle(async (req, res) => {
    const id = idInput.parse(req.params.id),
      input = z
        .object({
          action: z.enum([
            "accept",
            "revise",
            "decline",
            "cancel",
            "approve_cancel",
            "dispute",
            "provided",
            "received",
          ]),
          version: z.number().int().positive(),
          requestKey: keyInput,
          terms: termsInput.optional(),
          note: z.string().trim().max(1500).optional(),
        })
        .strict()
        .parse(req.body);
    const p = await actOnProposal(id, req.dbUser!.id, input);
    await notifyProposal(p, req.dbUser!.id);
    res.json(await getProposal(id, req.dbUser!.id));
  }),
);
router.post(
  "/exchange/proposals/:id/reviews",
  handle(async (req, res) => {
    const id = idInput.parse(req.params.id),
      user = req.dbUser!.id,
      input = z
        .object({
          text: z.string().trim().min(2).max(1000),
          feedback: z.string().trim().max(250).default(""),
        })
        .strict()
        .parse(req.body);
    await transaction(async (sql) => {
      const p = await getProposal(id, user, sql);
      demand(
        p.status === "completed",
        409,
        "교환 완료 후 후기를 남길 수 있어요.",
      );
      await sql.query(
        "INSERT INTO exchange_reviews(proposal_id,author_id,text,feedback) VALUES($1,$2,$3,$4) ON CONFLICT(proposal_id,author_id) DO UPDATE SET text=excluded.text,feedback=excluded.feedback",
        [id, user, input.text, input.feedback],
      );
      const s = (
        await sql.query(
          "SELECT * FROM agent_settings WHERE user_id=$1 FOR UPDATE",
          [user],
        )
      ).rows[0];
      if (s?.activity_learning && input.feedback)
        await sql.query(
          "INSERT INTO agent_memories(user_id,label,source_type,source_id,consent_version) VALUES($1,$2,'feedback',$3,$4) ON CONFLICT(user_id,source_type,source_id) DO NOTHING",
          [user, input.feedback, id, s.consent_version],
        );
      await enqueueSearch(user, sql);
    });
    res.json({ ok: true });
  }),
);
router.post(
  "/exchange/uploads",
  rateLimit({ name: "exchange-upload", limit: 20, windowSeconds: 3600 }),
  express.raw({
    type: ["image/jpeg", "image/png", "image/webp"],
    limit: "8mb",
  }),
  handle(async (req, res) => {
    const body = Buffer.isBuffer(req.body) ? req.body : null;
    demand(
      body && body.length > 12,
      400,
      "JPEG, PNG, WebP 사진을 선택해 주세요.",
    );
    const type = req.get("content-type")?.split(";")[0];
    const png = body
      .subarray(0, 8)
      .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
    const jpeg = body[0] === 255 && body[1] === 216 && body[2] === 255;
    const webp =
      body.toString("ascii", 0, 4) === "RIFF" &&
      body.toString("ascii", 8, 12) === "WEBP";
    demand(
      (type === "image/png" && png) ||
        (type === "image/jpeg" && jpeg) ||
        (type === "image/webp" && webp),
      400,
      "사진 형식이 올바르지 않아요.",
    );
    const objectPath = await new ObjectStorageService().uploadObjectEntity(
      body,
      type!,
    );
    await pool.query(
      "INSERT INTO exchange_media(owner_id,object_path) VALUES($1,$2)",
      [req.dbUser!.id, objectPath],
    );
    res.status(201).json({ objectPath });
  }),
);
router.get(
  "/exchange/admin",
  handle(async (req, res) => {
    demand(await hasAdminAccess(req.dbUser!), 403, "운영자 권한이 필요해요.");
    const listings = (
      await pool.query(
        "SELECT l.*,u.nickname owner_name FROM exchange_listings l JOIN users u ON u.id=l.owner_id WHERE l.status='pending' ORDER BY l.created_at LIMIT 50",
      )
    ).rows;
    const disputes = (
      await pool.query(
        "SELECT p.*,(SELECT coalesce(jsonb_agg(e),'[]'::jsonb) FROM exchange_events e WHERE e.proposal_id=p.id) events,(SELECT coalesce(jsonb_agg(f),'[]'::jsonb) FROM exchange_fulfillments f WHERE f.proposal_id=p.id) fulfillments,a.nickname proposer_name,b.nickname recipient_name FROM exchange_proposals p JOIN users a ON a.id=p.proposer_id JOIN users b ON b.id=p.recipient_id WHERE p.status IN('disputed','cancel_requested') ORDER BY p.updated_at DESC LIMIT 50",
      )
    ).rows;
    const relays=(await pool.query("SELECT r.*,(SELECT coalesce(jsonb_agg(m ORDER BY m.position),'[]'::jsonb) FROM exchange_relay_members m WHERE m.relay_id=r.id) members,(SELECT coalesce(jsonb_agg(e ORDER BY e.created_at DESC),'[]'::jsonb) FROM exchange_relay_events e WHERE e.relay_id=r.id) events FROM exchange_relays r WHERE r.status IN('disputed','cancel_requested') ORDER BY r.updated_at DESC LIMIT 50")).rows;
    res.json({ listings: listings.map(listingDto), disputes, relays });
  }),
);
router.post(
  "/exchange/admin/:id",
  handle(async (req, res) => {
    demand(
      isKnowledgeAdmin(req.dbUser!) ||
        (await hasAdminRole(req.dbUser!.id, [
          "super_admin",
          "operations",
          "support",
        ])),
      403,
      "운영 처리 권한이 필요해요.",
    );
    const id = idInput.parse(req.params.id),
      input = z
        .object({
          kind: z.enum(["listing", "proposal", "relay"]),
          action: z.enum(["approve", "reject", "cancel", "resume"]),
          reason: z.string().trim().min(5).max(1000),
        })
        .strict()
        .parse(req.body);
    await transaction(async (sql) => {
      if(input.kind === "relay") {
        await resolveRelay(sql,id,req.dbUser!.id,input.action,input.reason);
      } else if (input.kind === "listing") {
        demand(
          ["approve", "reject"].includes(input.action),
          400,
          "올바른 처리 동작을 선택해 주세요.",
        );
        const l = (
          await sql.query(
            "SELECT * FROM exchange_listings WHERE id=$1 FOR UPDATE",
            [id],
          )
        ).rows[0];
        demand(l, 404, "항목이 없어요.");
        demand(
          l.status === "pending",
          409,
          "검토 대기 중인 항목만 처리할 수 있어요.",
        );
        demand(
          input.action !== "approve" ||
            categoryEligible({
              category: l.category,
              title: l.title,
              description: l.description,
              wantedText: l.wanted_text,
            }),
          400,
          "출시 허용 범위로 내용을 수정한 뒤 승인해 주세요.",
        );
        await sql.query(
          "UPDATE exchange_listings SET status=$2,review_note=$3,version=version+1,updated_at=now() WHERE id=$1",
          [
            id,
            input.action === "approve" ? "published" : "paused",
            input.reason,
          ],
        );
      } else {
        demand(
          ["cancel", "resume"].includes(input.action),
          400,
          "올바른 처리 동작을 선택해 주세요.",
        );
        const p = (
          await sql.query(
            "SELECT * FROM exchange_proposals WHERE id=$1 FOR UPDATE",
            [id],
          )
        ).rows[0];
        demand(
          p && ["disputed", "cancel_requested"].includes(p.status),
          409,
          "검토 대기 중인 교환만 처리할 수 있어요.",
        );
        await sql.query(
          "UPDATE exchange_proposals SET status=$2,updated_at=now() WHERE id=$1",
          [id, input.action === "cancel" ? "cancelled" : "in_progress"],
        );
        if (input.action === "cancel")
          await sql.query(
            "UPDATE exchange_reservations SET active=false WHERE proposal_id=$1",
            [id],
          );
        await sql.query(
          "INSERT INTO exchange_events(proposal_id,actor_id,kind,data,request_key) VALUES($1,$2,'admin_resolution',$3,$4)",
          [id, req.dbUser!.id, JSON.stringify(input), "admin-" + Date.now()],
        );
        await proposalMessage(
          sql,
          p,
          req.dbUser!.id,
          "운영 검토 결과: " + input.reason,
        );
      }
      await sql.query(
        "INSERT INTO admin_audit_logs(actor_user_id,action,target_type,target_id,reason,after_json) VALUES($1,'exchange_review',$2,$3,$4,$5)",
        [
          req.dbUser!.id,
          input.kind,
          id,
          input.reason,
          JSON.stringify({ action: input.action }),
        ],
      );
      await enqueueSearch(undefined, sql);
    });
    if(input.kind==='relay') {
      const relay=(await pool.query('SELECT id,room_id FROM exchange_relays WHERE id=$1',[id])).rows[0];
      await notifyRelay(relay,req.dbUser!.id);
    }
    res.json({ ok: true });
  }),
);
export default router;
