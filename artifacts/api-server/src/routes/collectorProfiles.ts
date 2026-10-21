import { Router } from "express";
import { pool } from "@workspace/db";
import { requireAuth } from "../lib/auth";
import { rateLimit } from "../lib/rateLimit";
import { resolveCharacterProfileActor } from "../lib/characterProfiles";
import { COLLECTORS } from "../lib/collectorLounge/policy";
const router = Router();
router.use("/collector-lounge/characters/:id", (req, res, next) => {
  if (process.env.COLLECTOR_LOUNGE_ENABLED !== "true") {
    res.sendStatus(404);
    return;
  }
  next();
});
router.get(
  "/collector-lounge/characters/:id/relationship",
  requireAuth,
  async (req, res) => {
    const actor = COLLECTORS.find((a) => a.id === req.params.id);
    if (!actor) {
      res.sendStatus(404);
      return;
    }
    const result = await pool.query(
      "SELECT id FROM friendships WHERE (user_a_id=$1 AND user_b_id=$2) OR (user_a_id=$2 AND user_b_id=$1) LIMIT 1",
      [req.dbUser!.id, actor.id],
    );
    res.json({ isFriend: !!result.rows.length });
  },
);
router.post(
  "/collector-lounge/characters/:id/friend",
  requireAuth,
  rateLimit({
    name: "collector-friend",
    limit: 10,
    windowSeconds: 60,
    requireRedis: true,
  }),
  async (req, res) => {
    const actor = COLLECTORS.find((a) => a.id === req.params.id);
    const me = req.dbUser!.id;
    if (!actor || me === actor.id) {
      res.sendStatus(400);
      return;
    }
    const c = await pool.connect();
    try {
      await c.query("BEGIN");
      await c.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
        `chat-policy:${[me, actor.id].sort().join(":")}`,
      ]);
      const blocked = await c.query(
        "SELECT id FROM blocked_users WHERE (blocker_user_id=$1 AND blocked_user_id=$2) OR (blocker_user_id=$2 AND blocked_user_id=$1) LIMIT 1",
        [me, actor.id],
      );
      if (blocked.rows.length) {
        await c.query("ROLLBACK");
        res.sendStatus(403);
        return;
      }
      await c.query(
        "INSERT INTO friendships(user_a_id,user_b_id) SELECT $1,$2 WHERE NOT EXISTS(SELECT 1 FROM friendships WHERE (user_a_id=$1 AND user_b_id=$2) OR (user_a_id=$2 AND user_b_id=$1))",
        [me, actor.id],
      );
      await c.query("COMMIT");
      res.json({ isFriend: true });
    } catch (e) {
      await c.query("ROLLBACK");
      throw e;
    } finally {
      c.release();
    }
  },
);
router.post(
  "/collector-lounge/characters/:id/chat",
  requireAuth,
  rateLimit({
    name: "collector-direct",
    limit: 10,
    windowSeconds: 60,
    requireRedis: true,
  }),
  async (req, res) => {
    const actor = COLLECTORS.find((a) => a.id === req.params.id);
    const me = req.dbUser!.id;
    if (
      !actor ||
      me === actor.id ||
      req.body?.acknowledgeAiProcessing !== true
    ) {
      res.status(400).json({ error: "ai_notice_required" });
      return;
    }
    const profile = await resolveCharacterProfileActor(me, req.body?.profileId);
    if (!profile) {
      res.sendStatus(403);
      return;
    }
    const c = await pool.connect();
    try {
      await c.query("BEGIN");
      const pair = [me, actor.id].sort().join(":");
      await c.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
        `chat-policy:${pair}`,
      ]);
      await c.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
        `direct:${pair}`,
      ]);
      const blocked = await c.query(
        "SELECT id FROM blocked_users WHERE (blocker_user_id=$1 AND blocked_user_id=$2) OR (blocker_user_id=$2 AND blocked_user_id=$1) LIMIT 1",
        [me, actor.id],
      );
      if (blocked.rows.length) {
        await c.query("ROLLBACK");
        res.sendStatus(403);
        return;
      }
      let room = (
        await c.query(
          `SELECT r.id FROM chat_rooms r JOIN chat_room_members a ON a.room_id=r.id JOIN chat_room_members b ON b.room_id=r.id WHERE r.type='direct' AND a.user_id=$1 AND a.profile_id=$3 AND b.user_id=$2 AND b.profile_id=$2 AND (SELECT count(*) FROM chat_room_members x WHERE x.room_id=r.id)=2 LIMIT 1`,
          [me, actor.id, profile.id],
        )
      ).rows[0];
      if (!room) {
        room = (
          await c.query(
            "INSERT INTO chat_rooms(type,category,visibility) VALUES('direct','collector_ai','private') RETURNING id",
          )
        ).rows[0];
        await c.query(
          "INSERT INTO chat_room_members(room_id,user_id,profile_id) VALUES($1,$2,$3),($1,$4,$4)",
          [room.id, me, profile.id, actor.id],
        );
      } else
        await c.query(
          "UPDATE chat_room_members SET hidden_at=NULL WHERE room_id=$1 AND user_id=$2",
          [room.id, me],
        );
      await c.query(
        "INSERT INTO collector_direct_chats(room_id,owner_id,collector_id) VALUES($1,$2,$3) ON CONFLICT(room_id) DO NOTHING",
        [room.id, me, actor.id],
      );
      await c.query("COMMIT");
      res.json({ roomId: room.id });
    } catch (e) {
      await c.query("ROLLBACK");
      throw e;
    } finally {
      c.release();
    }
  },
);
export default router;

export async function registerCollectorDirectRoom(
  roomId: string,
  ownerId: string,
) {
  if (process.env.COLLECTOR_LOUNGE_ENABLED !== "true") return;
  await pool.query(
    `INSERT INTO collector_direct_chats(room_id,owner_id,collector_id)
 SELECT r.id,a.user_id,b.user_id FROM chat_rooms r JOIN chat_room_members a ON a.room_id=r.id JOIN chat_room_members b ON b.room_id=r.id
 WHERE r.id=$1 AND r.type='direct' AND a.user_id=$2 AND b.user_id=ANY($3::uuid[]) AND a.user_id<>b.user_id AND (SELECT count(*) FROM chat_room_members x WHERE x.room_id=r.id)=2 ON CONFLICT(room_id) DO NOTHING`,
    [roomId, ownerId, COLLECTORS.map((a) => a.id)],
  );
}
