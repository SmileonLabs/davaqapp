import { randomUUID } from "node:crypto";
import { Router, type Request, type Response } from "express";
import { and, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod/v4";
import { AccessToken, RoomServiceClient } from "livekit-server-sdk";
import {
  db,
  groupCallsTable as sessions,
  groupCallParticipantsTable as participants,
  chatRoomsTable,
  chatRoomMembersTable,
  usersTable,
  callUserLocksTable,
  blockedUsersTable,
} from "@workspace/db";
import { requireAuth } from "../lib/auth";
import { rateLimit } from "../lib/rateLimit";
import { callTokenGrant } from "../lib/callLifecycle";
import {
  sendCallPush,
  sendCallTerminalPush,
  incomingCallData,
} from "../lib/push";
import { publishRealtimeEvent } from "../lib/realtime";
import { logger } from "../lib/logger";
import {
  GROUP_CALL_LIMIT,
  GROUP_INVITE_MS,
  GROUP_HEARTBEAT_GRACE_MS,
} from "../lib/groupCallPolicy";
const router = Router();
const limited = rateLimit({
  name: "davaq-group-calls",
  limit: 120,
  windowSeconds: 60,
});
const configured = () =>
  !!(
    process.env.LIVEKIT_URL &&
    process.env.LIVEKIT_API_KEY &&
    process.env.LIVEKIT_API_SECRET
  );
const admin = () =>
  new RoomServiceClient(
    process.env.LIVEKIT_URL!.replace(/^ws/, "http"),
    process.env.LIVEKIT_API_KEY!,
    process.env.LIVEKIT_API_SECRET!,
    { requestTimeout: 8 },
  );
const pathId = (raw: string | string[]) => (Array.isArray(raw) ? raw[0] : raw);
class GroupError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
async function member(roomId: string, userId: string) {
  const [row] = await db
    .select()
    .from(chatRoomMembersTable)
    .where(
      and(
        eq(chatRoomMembersTable.roomId, roomId),
        eq(chatRoomMembersTable.userId, userId),
      ),
    );
  return !!row;
}
async function snapshot(call: typeof sessions.$inferSelect) {
  const rows = await db
    .select({
      userId: participants.userId,
      state: participants.state,
      name: usersTable.nickname,
    })
    .from(participants)
    .innerJoin(usersTable, eq(usersTable.id, participants.userId))
    .where(eq(participants.callId, call.id));
  const [room] = await db
    .select({ name: chatRoomsTable.name })
    .from(chatRoomsTable)
    .where(eq(chatRoomsTable.id, call.roomId));
  return {
    ...call,
    name: room?.name ?? "그룹 통화",
    participants: rows,
    expiresAt: call.createdAt.getTime() + GROUP_INVITE_MS,
  };
}
async function publish(
  call: typeof sessions.$inferSelect,
  type: "group_call.created" | "group_call.updated",
) {
  const users = await db
    .select({ userId: chatRoomMembersTable.userId })
    .from(chatRoomMembersTable)
    .where(eq(chatRoomMembersTable.roomId, call.roomId));
  await publishRealtimeEvent({
    type,
    callId: call.id,
    roomId: call.roomId,
    userIds: users.map((x) => x.userId),
    data: { call: await snapshot(call) },
  });
}
async function authorize(id: string, userId: string) {
  if (!z.uuid().safeParse(id).success)
    throw new GroupError(404, "통화를 찾을 수 없습니다");
  const [call] = await db.select().from(sessions).where(eq(sessions.id, id));
  if (!call || !(await member(call.roomId, userId)))
    throw new GroupError(404, "통화를 찾을 수 없습니다");
  return call;
}
async function grant(id: string, userId: string, name: string) {
  const result = await db.transaction(async (tx) => {
    // Same user row lock is used by direct-call creation; prevents overlapping audio sessions.
    await tx
      .select({ id: usersTable.id })
      .from(usersTable)
      .where(eq(usersTable.id, userId))
      .for("update");
    const [call] = await tx
      .select()
      .from(sessions)
      .where(eq(sessions.id, id))
      .for("update");
    if (!call || call.status !== "active")
      throw new GroupError(409, "종료된 통화입니다");
    const [membership] = await tx
      .select()
      .from(chatRoomMembersTable)
      .where(
        and(
          eq(chatRoomMembersTable.roomId, call.roomId),
          eq(chatRoomMembersTable.userId, userId),
        ),
      );
    if (!membership) throw new GroupError(404, "통화를 찾을 수 없습니다");
    const locks = await tx
      .select()
      .from(callUserLocksTable)
      .where(eq(callUserLocksTable.userId, userId));
    const joined = await tx
      .select()
      .from(participants)
      .where(
        and(eq(participants.userId, userId), eq(participants.state, "joined")),
      );
    if (locks.length || joined.some((x) => x.callId !== id))
      throw new GroupError(409, "다른 통화에 참여 중입니다");
    const roster = await tx
      .select()
      .from(participants)
      .where(
        and(eq(participants.callId, id), eq(participants.state, "joined")),
      );
    if (
      roster.length >= GROUP_CALL_LIMIT &&
      !roster.some((x) => x.userId === userId)
    )
      throw new GroupError(409, "최대 16명까지 참여할 수 있습니다");
    const blocks = await tx
      .select()
      .from(blockedUsersTable)
      .where(
        sql`(${blockedUsersTable.blockerUserId} = ${userId} AND ${blockedUsersTable.blockedUserId} IN (SELECT user_id FROM davaq_group_call_participants WHERE call_id=${id} AND state='joined')) OR (${blockedUsersTable.blockedUserId} = ${userId} AND ${blockedUsersTable.blockerUserId} IN (SELECT user_id FROM davaq_group_call_participants WHERE call_id=${id} AND state='joined'))`,
      );
    if (blocks.length)
      throw new GroupError(403, "차단한 사용자와는 통화할 수 없습니다");
    const now = new Date();
    await tx
      .insert(participants)
      .values({
        callId: id,
        userId,
        state: "joined",
        joinedAt: now,
        heartbeatAt: now,
      })
      .onConflictDoUpdate({
        target: [participants.callId, participants.userId],
        set: { state: "joined", joinedAt: now, heartbeatAt: now },
      });
    const token = new AccessToken(
      process.env.LIVEKIT_API_KEY!,
      process.env.LIVEKIT_API_SECRET!,
      { identity: userId, name, ttl: 120 },
    );
    token.addGrant(
      callTokenGrant(
        call.roomName,
        call.media === "video" ? "video" : "audio",
        true,
      ),
    );
    return { call, token: await token.toJwt(), url: process.env.LIVEKIT_URL };
  });
  return { ...result, call: await snapshot(result.call) };
}
function route(fn: (req: Request, res: Response) => Promise<void>) {
  return async (req: Request, res: Response) => {
    try {
      await fn(req, res);
    } catch (error) {
      if (error instanceof GroupError)
        res.status(error.status).json({ error: error.message });
      else throw error;
    }
  };
}
router.get(
  "/group-calls/incoming",
  requireAuth,
  route(async (req, res) => {
    const rows = await db
      .select({ call: sessions })
      .from(participants)
      .innerJoin(sessions, eq(sessions.id, participants.callId))
      .innerJoin(
        chatRoomMembersTable,
        and(
          eq(chatRoomMembersTable.roomId, sessions.roomId),
          eq(chatRoomMembersTable.userId, participants.userId),
        ),
      )
      .where(
        and(
          eq(participants.userId, req.dbUser!.id),
          eq(participants.state, "invited"),
          eq(sessions.status, "active"),
        ),
      );
    res.json(
      await Promise.all(
        rows
          .filter(
            (x) => Date.now() - x.call.createdAt.getTime() < GROUP_INVITE_MS,
          )
          .map((x) => snapshot(x.call)),
      ),
    );
  }),
);
router.get(
  "/rooms/:roomId/group-call",
  requireAuth,
  route(async (req, res) => {
    const roomId = pathId(req.params.roomId);
    if (
      !z.uuid().safeParse(roomId).success ||
      !(await member(roomId, req.dbUser!.id))
    )
      throw new GroupError(404, "방을 찾을 수 없습니다");
    const [call] = await db
      .select()
      .from(sessions)
      .where(and(eq(sessions.roomId, roomId), eq(sessions.status, "active")));
    res.json(call ? await snapshot(call) : null);
  }),
);
router.post(
  "/rooms/:roomId/group-call",
  requireAuth,
  limited,
  route(async (req, res) => {
    if (!configured())
      throw new GroupError(503, "통화 서버가 설정되지 않았습니다");
    const roomId = pathId(req.params.roomId),
      userId = req.dbUser!.id;
    const parsed = z
      .object({ media: z.enum(["audio", "video"]) })
      .strict()
      .safeParse(req.body);
    if (!z.uuid().safeParse(roomId).success || !parsed.success)
      throw new GroupError(400, "잘못된 통화 요청입니다");
    const result = await db.transaction(async (tx) => {
      const [room] = await tx
        .select()
        .from(chatRoomsTable)
        .where(eq(chatRoomsTable.id, roomId))
        .for("update");
      const members = await tx
        .select()
        .from(chatRoomMembersTable)
        .where(eq(chatRoomMembersTable.roomId, roomId));
      if (room?.type !== "group" || !members.some((x) => x.userId === userId))
        throw new GroupError(404, "그룹을 찾을 수 없습니다");
      const [existing] = await tx
        .select()
        .from(sessions)
        .where(and(eq(sessions.roomId, roomId), eq(sessions.status, "active")));
      if (existing)
        return { call: existing, recipients: [] as string[], created: false };
      const blocks = await tx
        .select()
        .from(blockedUsersTable)
        .where(
          sql`${blockedUsersTable.blockerUserId} = ${userId} OR ${blockedUsersTable.blockedUserId} = ${userId}`,
        );
      const blocked = new Set(
        blocks.map((x) =>
          x.blockerUserId === userId ? x.blockedUserId : x.blockerUserId,
        ),
      );
      const recipients = members
        .map((x) => x.userId)
        .filter((id) => id !== userId && !blocked.has(id));
      const id = "da7a0001" + randomUUID().slice(8);
      const [call] = await tx
        .insert(sessions)
        .values({
          id,
          roomId,
          creatorId: userId,
          roomName: `davaq_group_${id}`,
          media: parsed.data.media,
        })
        .returning();
      await tx.insert(participants).values(
        [userId, ...recipients].map((id) => ({
          callId: call.id,
          userId: id,
          state: "invited",
        })),
      );
      return { call, recipients, created: true };
    });
    let session;
    try {
      session = await grant(result.call.id, userId, req.dbUser!.nickname);
    } catch (error) {
      if (result.created)
        await db
          .update(sessions)
          .set({ status: "ended", endedAt: new Date() })
          .where(eq(sessions.id, result.call.id));
      throw error;
    }
    if (result.created) {
      void Promise.allSettled(
        result.recipients.map((id) =>
          sendCallPush(id, {
            title: "그룹 통화",
            body: `${req.dbUser!.nickname}님이 그룹 통화를 시작했습니다`,
            url: `/chat/${roomId}`,
            tag: `call-${result.call.id}`,
            data: incomingCallData({
              callId: result.call.id,
              chatRoomId: roomId,
              callerUserId: userId,
              callerName: `${req.dbUser!.nickname} · 그룹 통화`,
              media: parsed.data.media,
              expiresAt: result.call.createdAt.getTime() + GROUP_INVITE_MS,
            }),
          }),
        ),
      );
    }
    await publish(
      result.call,
      result.created ? "group_call.created" : "group_call.updated",
    );
    res.status(result.created ? 201 : 200).json(session);
  }),
);
router.get(
  "/group-calls/:id",
  requireAuth,
  route(async (req, res) => {
    res.json(
      await snapshot(await authorize(pathId(req.params.id), req.dbUser!.id)),
    );
  }),
);
router.post(
  "/group-calls/:id/join",
  requireAuth,
  limited,
  route(async (req, res) => {
    if (!configured())
      throw new GroupError(503, "통화 서버가 설정되지 않았습니다");
    const call = await authorize(pathId(req.params.id), req.dbUser!.id);
    const session = await grant(call.id, req.dbUser!.id, req.dbUser!.nickname);
    await publish(call, "group_call.updated");
    res.json(session);
  }),
);
router.post(
  "/group-calls/:id/heartbeat",
  requireAuth,
  route(async (req, res) => {
    const call = await authorize(pathId(req.params.id), req.dbUser!.id);
    const rows = await db
      .update(participants)
      .set({ heartbeatAt: new Date() })
      .where(
        and(
          eq(participants.callId, call.id),
          eq(participants.userId, req.dbUser!.id),
          eq(participants.state, "joined"),
        ),
      )
      .returning();
    if (call.status !== "active" || !rows.length)
      throw new GroupError(409, "통화가 종료됐습니다");
    res.status(204).end();
  }),
);
for (const action of ["leave", "decline"] as const)
  router.post(
    `/group-calls/:id/${action}`,
    requireAuth,
    limited,
    route(async (req, res) => {
      const call = await authorize(pathId(req.params.id), req.dbUser!.id);
      const changed = await db.transaction(async (tx) => {
        await tx
          .select()
          .from(sessions)
          .where(eq(sessions.id, call.id))
          .for("update");
        const changed = await tx
          .update(participants)
          .set({ state: action === "decline" ? "declined" : "left" })
          .where(
            and(
              eq(participants.callId, call.id),
              eq(participants.userId, req.dbUser!.id),
              ...(action === "decline"
                ? [eq(participants.state, "invited")]
                : []),
            ),
          )
          .returning();
        if (!changed.length) return false;
        const remaining = await tx
          .select()
          .from(participants)
          .where(
            and(
              eq(participants.callId, call.id),
              eq(participants.state, "joined"),
            ),
          );
        if (!remaining.length)
          await tx
            .update(sessions)
            .set({ status: "ended", endedAt: new Date() })
            .where(eq(sessions.id, call.id));
        return true;
      });
      if (!changed) {
        res.json(await snapshot(call));
        return;
      }
      try {
        await admin().removeParticipant(call.roomName, req.dbUser!.id);
      } catch (err) {
        logger.warn({ callId: call.id }, "Group participant removal deferred");
      }
      await sendCallTerminalPush([req.dbUser!.id], {
        callId: call.id,
        status: "ended",
        chatRoomId: call.roomId,
        media: call.media === "video" ? "video" : "audio",
      });
      const [fresh] = await db
        .select()
        .from(sessions)
        .where(eq(sessions.id, call.id));
      await publish(fresh, "group_call.updated");
      res.json(await snapshot(fresh));
    }),
  );
export async function processGroupCallLifecycle() {
  const active = await db
    .select()
    .from(sessions)
    .where(eq(sessions.status, "active"))
    .limit(50);
  for (const call of active) {
    const roster = await db
      .select()
      .from(participants)
      .where(
        and(eq(participants.callId, call.id), eq(participants.state, "joined")),
      );
    const stale = roster.filter(
      (x) =>
        Date.now() - (x.heartbeatAt?.getTime() ?? call.createdAt.getTime()) >
        GROUP_HEARTBEAT_GRACE_MS,
    );
    const currentMembers = await db
      .select({ userId: chatRoomMembersTable.userId })
      .from(chatRoomMembersTable)
      .where(eq(chatRoomMembersTable.roomId, call.roomId));
    const memberIds = new Set(currentMembers.map((x) => x.userId));
    const revoked = roster.filter((x) => !memberIds.has(x.userId));
    if (configured() && (stale.length || revoked.length)) {
      const live = await admin()
        .listParticipants(call.roomName)
        .catch((error) =>
          (error as { code?: number }).code === 5 ? [] as { identity: string }[] : null,
        );
      for (const user of roster) {
        if (!memberIds.has(user.userId)) {
          try {
            await admin().removeParticipant(call.roomName, user.userId);
          } catch (error) {
            if ((error as { code?: number }).code !== 5) continue;
          }
        } else if (
          !stale.some((x) => x.userId === user.userId) ||
          !live ||
          live.some((x) => x.identity === user.userId)
        )
          continue;
        await db
          .update(participants)
          .set({ state: "left" })
          .where(
            and(
              eq(participants.callId, call.id),
              eq(participants.userId, user.userId),
              eq(participants.state, "joined"),
              eq(participants.heartbeatAt, user.heartbeatAt!),
            ),
          );
      }
    }
    await db.transaction(async (tx) => {
      await tx
        .select()
        .from(sessions)
        .where(eq(sessions.id, call.id))
        .for("update");
      const remaining = await tx
        .select()
        .from(participants)
        .where(
          and(
            eq(participants.callId, call.id),
            eq(participants.state, "joined"),
          ),
        );
      if (
        !remaining.length &&
        Date.now() - call.createdAt.getTime() > GROUP_INVITE_MS
      )
        await tx
          .update(sessions)
          .set({ status: "ended", endedAt: new Date() })
          .where(eq(sessions.id, call.id));
    });
  }
  const ended = await db
    .select()
    .from(sessions)
    .where(
      sql`${sessions.status}='ended' AND ${sessions.roomTerminatedAt} IS NULL`,
    )
    .limit(25);
  for (const call of ended) {
    await db
      .update(participants)
      .set({ state: "left" })
      .where(
        and(eq(participants.callId, call.id), eq(participants.state, "joined")),
      );
    const roster = await db
      .select()
      .from(participants)
      .where(eq(participants.callId, call.id));
    await sendCallTerminalPush(
      roster.map((x) => x.userId),
      {
        callId: call.id,
        status: "ended",
        chatRoomId: call.roomId,
        media: call.media === "video" ? "video" : "audio",
      },
    );
    if (!configured()) continue;
    try {
      await admin().deleteRoom(call.roomName);
    } catch (error) {
      if ((error as { code?: number }).code !== 5) continue;
    }
    await db
      .update(sessions)
      .set({ roomTerminatedAt: new Date() })
      .where(eq(sessions.id, call.id));
    await publish(call, "group_call.updated");
  }
}
export default router;
