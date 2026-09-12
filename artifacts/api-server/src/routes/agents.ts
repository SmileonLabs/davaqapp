import { Router, type IRouter } from "express";
import { randomUUID } from "node:crypto";
import { z } from "zod/v4";
import { pool } from "@workspace/db";
import { requireAuth } from "../lib/auth";
import { rateLimit } from "../lib/rateLimit";
import { handle } from "./exchange";
import {
  demand,
  transaction,
  growth,
  enqueueSearch,
  findMatches,
} from "../lib/exchangeService";
import { settingsFor, agentReply, registerDraft } from "../lib/davaqAgent";
const router: IRouter = Router();
router.use("/agents", requireAuth);
router.get(
  "/agents/me",
  handle(async (req, res) => {
    const user = req.dbUser!.id,
      settings = await settingsFor(user);
    const memories = (
      await pool.query(
        "SELECT * FROM agent_memories WHERE user_id=$1 AND status IN('candidate','confirmed') AND (expires_at IS NULL OR expires_at>now()) ORDER BY updated_at DESC LIMIT 100",
        [user],
      )
    ).rows;
    const events = (
      await pool.query(
        "SELECT kind,source_id,created_at FROM agent_growth_events WHERE user_id=$1 ORDER BY created_at DESC LIMIT 30",
        [user],
      )
    ).rows;
    const job =
      (
        await pool.query(
          "SELECT status,requested_at,finished_at,error,jsonb_array_length(result) result_count FROM agent_search_jobs WHERE user_id=$1",
          [user],
        )
      ).rows[0] ?? null;
    const milestones = (
      await pool.query(
        "SELECT DISTINCT kind FROM agent_growth_events WHERE user_id=$1",
        [user],
      )
    ).rows;
    const hasCompleted = milestones.some(
        (e) => e.kind === "exchange_completed",
      ),
      hasMemory = milestones.some((e) => e.kind === "memory_confirmed"),
      hasListing = milestones.some((e) => e.kind === "listing_published");
    res.json({
      settings,
      memories,
      events,
      job,
      level: hasCompleted ? 3 : hasMemory ? 2 : 1,
      stage: hasCompleted
        ? "경험 연결가"
        : hasMemory
          ? "취향 탐험가"
          : "새싹 파트너",
      hasListing,
    });
  }),
);
router.patch(
  "/agents/me/settings",
  handle(async (req, res) => {
    const user = req.dbUser!.id,
      input = z
        .object({
          name: z.string().trim().min(1).max(20),
          tone: z.enum(["warm", "brief"]),
          activityLearning: z.boolean(),
          chatLearning: z.boolean(),
          autoSearch: z.boolean(),
          allowedRoomIds: z.array(z.uuid()).max(20),
          consentVersion: z.number().int().positive(),
        })
        .strict()
        .parse(req.body);
    await settingsFor(user);
    await transaction(async (sql) => {
      const s = (
        await sql.query(
          "SELECT * FROM agent_settings WHERE user_id=$1 FOR UPDATE",
          [user],
        )
      ).rows[0];
      demand(
        s.consent_version === input.consentVersion,
        409,
        "다른 곳에서 설정을 변경했어요. 새로고침해 주세요.",
      );
      if (input.allowedRoomIds.length) {
        const owned = (
          await sql.query(
            "SELECT DISTINCT room_id FROM chat_room_members WHERE user_id=$1 AND room_id=ANY($2::uuid[])",
            [user, input.allowedRoomIds],
          )
        ).rows;
        demand(
          owned.length === new Set(input.allowedRoomIds).size,
          403,
          "내가 참여한 대화만 선택해 주세요.",
        );
      }
      await sql.query(
        "UPDATE agent_settings SET name=$2,tone=$3,activity_learning=$4,chat_learning=$5,auto_search=$6,allowed_room_ids=$7,consent_version=consent_version+1,updated_at=now() WHERE user_id=$1",
        [
          user,
          input.name,
          input.tone,
          input.activityLearning,
          input.chatLearning,
          input.autoSearch,
          JSON.stringify([...new Set(input.allowedRoomIds)]),
        ],
      );
      await sql.query(
        "UPDATE agent_memories SET status='deleted',label='',updated_at=now() WHERE user_id=$1 AND status='candidate' AND ((source_type='chat' AND $2=false) OR (source_type='feedback' AND $3=false))",
        [user, input.chatLearning, input.activityLearning],
      );
      await sql.query(
        "UPDATE agent_memories am SET status='deleted',label='',updated_at=now() WHERE am.user_id=$1 AND am.status='candidate' AND am.source_type='chat' AND EXISTS(SELECT 1 FROM messages m WHERE m.id::text=am.source_id AND NOT ($2::jsonb ? m.room_id::text))",
        [user, JSON.stringify(input.allowedRoomIds)],
      );
      await sql.query("DELETE FROM agent_search_jobs WHERE user_id=$1", [user]);
      await enqueueSearch(user, sql);
    });
    res.json(await settingsFor(user));
  }),
);
router.post(
  "/agents/me/memories",
  handle(async (req, res) => {
    const user = req.dbUser!.id,
      input = z
        .object({
          label: z.string().trim().min(2).max(160),
          kind: z
            .enum(["preference", "tone", "availability"])
            .default("preference"),
          expiresAt: z.iso.datetime({ offset: true }).nullable().default(null),
        })
        .strict()
        .parse(req.body);
    await settingsFor(user);
    await transaction(async (sql) => {
      const s = (
        await sql.query(
          "SELECT * FROM agent_settings WHERE user_id=$1 FOR UPDATE",
          [user],
        )
      ).rows[0];
      const row = (
        await sql.query(
          "INSERT INTO agent_memories(user_id,label,kind,status,source_type,source_id,consent_version,expires_at) VALUES($1,$2,$3,'confirmed','manual',$4,$5,$6) RETURNING id",
          [
            user,
            input.label,
            input.kind,
            randomUUID(),
            s.consent_version,
            input.expiresAt,
          ],
        )
      ).rows[0];
      await growth(sql, user, "memory_confirmed", row.id);
      await enqueueSearch(user, sql);
    });
    res.status(201).json({ ok: true });
  }),
);
router.patch(
  "/agents/me/memories/:id",
  handle(async (req, res) => {
    const id = z.uuid().parse(req.params.id),
      user = req.dbUser!.id,
      input = z
        .object({
          status: z.enum(["confirmed", "rejected", "deleted"]),
          label: z.string().trim().min(2).max(160).optional(),
        })
        .strict()
        .parse(req.body);
    await transaction(async (sql) => {
      await sql.query(
        "SELECT user_id FROM agent_settings WHERE user_id=$1 FOR UPDATE",
        [user],
      );
      const prior = (
        await sql.query(
          "SELECT * FROM agent_memories WHERE id=$1 AND user_id=$2 FOR UPDATE",
          [id, user],
        )
      ).rows[0];
      demand(
        prior && prior.status !== "deleted",
        404,
        "기억을 찾을 수 없어요.",
      );
      await sql.query(
        "UPDATE agent_memories SET status=$3,label=$4,updated_at=now() WHERE id=$1 AND user_id=$2",
        [
          id,
          user,
          input.status,
          input.status === "deleted" ? "" : (input.label ?? prior.label),
        ],
      );
      if (input.status === "confirmed")
        await growth(sql, user, "memory_confirmed", id);
      await sql.query(
        "UPDATE agent_search_jobs SET result='[]'::jsonb WHERE user_id=$1",
        [user],
      );
      await enqueueSearch(user, sql);
    });
    res.json({ ok: true });
  }),
);
router.post(
  "/agents/me/search",
  rateLimit({ name: "agent-search", limit: 12, windowSeconds: 60 }),
  handle(async (req, res) => {
    const user = req.dbUser!.id,
      s = await settingsFor(user),
      items = await findMatches(user);
    await pool.query(
      "INSERT INTO agent_search_jobs(user_id,status,finished_at,result,consent_version) VALUES($1,'done',now(),$2,$3) ON CONFLICT(user_id) DO UPDATE SET status='done',finished_at=now(),requested_at=now(),result=excluded.result,consent_version=excluded.consent_version,error=NULL",
      [user, JSON.stringify(items.map((m) => m.id)), s.consent_version],
    );
    res.json({ items });
  }),
);
router.get(
  "/agents/me/messages",
  handle(async (req, res) => {
    res.json({
      items: (
        await pool.query(
          "SELECT id,role,content,created_at FROM agent_messages WHERE user_id=$1 ORDER BY created_at DESC LIMIT 60",
          [req.dbUser!.id],
        )
      ).rows.reverse(),
    });
  }),
);
router.post(
  "/agents/me/messages",
  rateLimit({ name: "agent-chat", limit: 20, windowSeconds: 3600 }),
  handle(async (req, res) => {
    const user = req.dbUser!.id,
      input = z
        .object({
          text: z.string().trim().min(1).max(3000),
          requestKey: z.string().min(8).max(100),
        })
        .strict()
        .parse(req.body);
    const exists = (
      await pool.query(
        "SELECT * FROM agent_messages WHERE user_id=$1 AND request_key=$2 AND role='assistant'",
        [user, input.requestKey],
      )
    ).rows[0];
    if (exists) {
      res.json({ message: exists });
      return;
    }
    const claimed = (
      await pool.query(
        "INSERT INTO agent_messages(user_id,role,content,request_key,processing_started_at) VALUES($1,'user',$2,$3,now()) ON CONFLICT(user_id,role,request_key) DO UPDATE SET processing_started_at=now() WHERE agent_messages.processing_started_at<now()-interval '2 minutes' AND agent_messages.content=excluded.content RETURNING id",
        [user, input.text, input.requestKey],
      )
    ).rows[0];
    demand(
      claimed,
      409,
      "큐가 답변을 준비 중이에요. 잠시 후 대화를 새로고침해 주세요.",
    );
    let content =
        "지금은 AI 연결이 원활하지 않아요. 교환 등록에서 내용을 직접 작성하거나 잠시 후 다시 말해주세요.",
      available = false;
    try {
      const answer = await agentReply(user, input.text);
      content = answer.data.reply;
      available = true;
      if (answer.chatLearning && answer.data.memory)
        await transaction(async (sql) => {
          const s = (
            await sql.query(
              "SELECT * FROM agent_settings WHERE user_id=$1 FOR UPDATE",
              [user],
            )
          ).rows[0];
          if (s.chat_learning && s.consent_version === answer.consentVersion)
            await sql.query(
              "INSERT INTO agent_memories(user_id,label,source_type,source_id,consent_version) VALUES($1,$2,'chat',$3,$4) ON CONFLICT DO NOTHING",
              [
                user,
                answer.data.memory,
                "agent:" + claimed.id,
                s.consent_version,
              ],
            );
        });
    } catch (e) {
      req.log?.warn(
        { error: e instanceof Error ? e.name : "Error" },
        "DavaQ assistant unavailable",
      );
    }
    const message = (
      await pool.query(
        "INSERT INTO agent_messages(user_id,role,content,request_key) VALUES($1,'assistant',$2,$3) RETURNING id,role,content,created_at",
        [user, content, input.requestKey],
      )
    ).rows[0];
    res.json({ message, available });
  }),
);
router.post(
  "/agents/me/registration-draft",
  rateLimit({ name: "agent-draft", limit: 15, windowSeconds: 3600 }),
  handle(async (req, res) => {
    const input = z
      .object({ text: z.string().trim().min(5).max(3000) })
      .strict()
      .parse(req.body);
    try {
      res.json(await registerDraft(input.text));
    } catch (e) {
      req.log?.warn(
        { error: e instanceof Error ? e.name : "Error" },
        "Draft generation unavailable",
      );
      res
        .status(503)
        .json({
          error: "ai_unavailable",
          message: "AI 연결이 원활하지 않아요. 아래에서 직접 입력할 수 있어요.",
        });
    }
  }),
);
export default router;
