import { publicDavaqAvatar } from "../lib/davaqAvatarPolicy";
import { Router, type IRouter } from "express";
import { z } from "zod/v4";
import { and, eq, inArray, or } from "drizzle-orm";
import { db } from "@workspace/db";
import { activeCharacterProfilesTable, characterProfilesTable, friendRequestsTable, friendshipsTable, usersTable } from "@workspace/db";
import { requireAuth } from "../lib/auth";
import { sendPushToUser } from "../lib/push";
import { toPublicUser } from "../lib/publicUser";
import { getActiveCharacterIdentityMap } from "../lib/characterProfiles";

const router: IRouter = Router();
const friendRequestSchema = z.object({ toUserId: z.uuid() }).strict();
const friendAliasSchema = z.object({ alias: z.string().trim().max(30).nullable() }).strict();

const toPublic = (u: typeof usersTable.$inferSelect, friendAlias?: string | null) => ({
  ...toPublicUser(u),
  friendAlias: friendAlias ?? null,
  displayName: friendAlias || u.nickname,
});

function aliasForViewer(friendship: typeof friendshipsTable.$inferSelect, viewerUserId: string): string | null {
  return friendship.userAId === viewerUserId
    ? friendship.userAFriendAlias ?? null
    : friendship.userBFriendAlias ?? null;
}

function normalizeAlias(input: unknown): string | null | undefined {
  if (input === null) return null;
  if (typeof input !== "string") return undefined;
  const trimmed = input.trim();
  return trimmed ? trimmed : null;
}

router.get("/friends", requireAuth, async (req, res): Promise<void> => {
  const userId = req.dbUser!.id;
  const friendships = await db
    .select()
    .from(friendshipsTable)
    .where(or(eq(friendshipsTable.userAId, userId), eq(friendshipsTable.userBId, userId)));

  const friendRowById = new Map<string, { userId: string; alias: string | null }>();
  for (const friendship of friendships) {
    const friendId = friendship.userAId === userId ? friendship.userBId : friendship.userAId;
    if (!friendRowById.has(friendId)) {
      friendRowById.set(friendId, { userId: friendId, alias: aliasForViewer(friendship, userId) });
    }
  }
  const friendRows = Array.from(friendRowById.values());
  const friendIds = [...new Set(friendRows.map((f) => f.userId))];

  if (friendIds.length === 0) {
    res.json([]);
    return;
  }

  const [friendUsers, activeProfiles] = await Promise.all([
    db.select().from(usersTable).where(inArray(usersTable.id, friendIds)),
    db
      .select()
      .from(activeCharacterProfilesTable)
      .where(inArray(activeCharacterProfilesTable.userId, friendIds)),
  ]);
  const activeProfileIdByUserId = new Map(
    activeProfiles.map((row) => [row.userId, row.activeProfileId]),
  );
  const activeProfileIds = activeProfiles.map((row) => row.activeProfileId);
  const characterProfiles = activeProfileIds.length
    ? await db
        .select()
        .from(characterProfilesTable)
        .where(inArray(characterProfilesTable.id, activeProfileIds))
    : [];
  const characterProfileById = new Map(
    characterProfiles.map((profile) => [profile.id, profile]),
  );
  const friendUserById = new Map(friendUsers.map((user) => [user.id, user]));
  const friends = friendRows.map(({ userId: friendId, alias }) => {
    const user = friendUserById.get(friendId);
    if (!user) return null;
    const profileId = activeProfileIdByUserId.get(friendId);
    const profile = profileId ? characterProfileById.get(profileId) : null;
    const characterProfileImageUrl = publicDavaqAvatar(
      profile?.type === "fan" && profile.profileImageUrl === user.profileImageUrl ? null : profile?.profileImageUrl,
      profile?.metadata, profile?.id,
    );
    return {
      ...toPublic(user, alias),
      profileImageUrl: characterProfileImageUrl,
      displayName: alias || profile?.displayName || user.nickname,
      profile: profile
        ? {
            id: profile.id,
            type: profile.type,
            handle: profile.handle,
            displayName: profile.displayName,
            profileImageUrl: characterProfileImageUrl,
          }
        : null,
    };
  });

  res.json(friends.filter(Boolean));
});

router.patch("/friends/:userId/alias", requireAuth, async (req, res): Promise<void> => {
  const myId = req.dbUser!.id;
  const raw = Array.isArray(req.params.userId) ? req.params.userId[0] : req.params.userId;
  const otherId = raw;
  const parsed = friendAliasSchema.safeParse(req.body);
  const alias = parsed.success ? normalizeAlias(parsed.data.alias) : undefined;

  if (!otherId || otherId === myId || alias === undefined) {
    res.status(400).json({ error: "Invalid alias" });
    return;
  }
  if (alias && alias.length > 50) {
    res.status(400).json({ error: "Alias too long" });
    return;
  }

  const [friendship] = await db
    .select()
    .from(friendshipsTable)
    .where(
      or(
        and(eq(friendshipsTable.userAId, myId), eq(friendshipsTable.userBId, otherId)),
        and(eq(friendshipsTable.userAId, otherId), eq(friendshipsTable.userBId, myId)),
      ),
    );

  if (!friendship) {
    res.status(404).json({ error: "Friend not found" });
    return;
  }

  await db
    .update(friendshipsTable)
    .set(
      friendship.userAId === myId
        ? { userAFriendAlias: alias }
        : { userBFriendAlias: alias },
    )
    .where(eq(friendshipsTable.id, friendship.id));

  const [friend] = await db.select().from(usersTable).where(eq(usersTable.id, otherId));
  if (!friend) {
    res.status(404).json({ error: "Friend not found" });
    return;
  }

  res.json(toPublic(friend, alias));
});

router.delete("/friends/:userId", requireAuth, async (req, res): Promise<void> => {
  const myId = req.dbUser!.id;
  const raw = Array.isArray(req.params.userId) ? req.params.userId[0] : req.params.userId;
  const otherId = raw;
  await db
    .delete(friendshipsTable)
    .where(
      or(
        and(eq(friendshipsTable.userAId, myId), eq(friendshipsTable.userBId, otherId)),
        and(eq(friendshipsTable.userAId, otherId), eq(friendshipsTable.userBId, myId)),
      ),
    );
  res.sendStatus(204);
});

router.post("/friend-requests", requireAuth, async (req, res): Promise<void> => {
  const myId = req.dbUser!.id;
  const parsed = friendRequestSchema.safeParse(req.body);
  if (!parsed.success || parsed.data.toUserId === myId) {
    res.status(400).json({ error: "Invalid toUserId" });
    return;
  }
  const { toUserId } = parsed.data;

  const alreadyFriends = await db
    .select()
    .from(friendshipsTable)
    .where(
      or(
        and(eq(friendshipsTable.userAId, myId), eq(friendshipsTable.userBId, toUserId)),
        and(eq(friendshipsTable.userAId, toUserId), eq(friendshipsTable.userBId, myId)),
      ),
    );

  if (alreadyFriends.length > 0) {
    res.status(400).json({ error: "Already friends" });
    return;
  }

  // If the OTHER person already sent ME a pending request, "adding them back"
  // should simply accept it (we become friends) instead of erroring — otherwise
  // a reciprocal add hits the duplicate-request guard and surfaces as an error.
  const [incoming] = await db
    .select()
    .from(friendRequestsTable)
    .where(
      and(
        eq(friendRequestsTable.fromUserId, toUserId),
        eq(friendRequestsTable.toUserId, myId),
        eq(friendRequestsTable.status, "pending"),
      ),
    );

  if (incoming) {
    // Atomically transition pending -> accepted; only the winner creates the
    // friendship (idempotent, race-safe — mirrors the accept route).
    const [updated] = await db
      .update(friendRequestsTable)
      .set({ status: "accepted" })
      .where(and(eq(friendRequestsTable.id, incoming.id), eq(friendRequestsTable.status, "pending")))
      .returning();

    if (updated) {
      const [existingFriendship] = await db
        .select()
        .from(friendshipsTable)
        .where(
          or(
            and(eq(friendshipsTable.userAId, incoming.fromUserId), eq(friendshipsTable.userBId, incoming.toUserId)),
            and(eq(friendshipsTable.userAId, incoming.toUserId), eq(friendshipsTable.userBId, incoming.fromUserId)),
          ),
        );
      if (!existingFriendship) {
        await db.insert(friendshipsTable).values({ userAId: incoming.fromUserId, userBId: incoming.toUserId });
      }
    }

    res.status(200).json({
      id: incoming.id,
      fromUserId: incoming.fromUserId,
      toUserId: incoming.toUserId,
      status: "accepted",
      createdAt: incoming.createdAt.toISOString(),
    });

    // Notify the original requester that their request was accepted.
    void (async () => {
      try {
        const [me] = await db.select().from(usersTable).where(eq(usersTable.id, myId));
        await sendPushToUser(toUserId, {
          title: "친구 요청 수락",
          body: `${me?.nickname ?? "상대방"}님이 친구 요청을 수락했습니다`,
          url: "/friends",
          tag: "friend-accepted",
        });
      } catch (err) {
        req.log.error({ err }, "Failed to dispatch friend-accept push");
      }
    })();
    return;
  }

  // Do I already have an outgoing pending request to them? (true duplicate)
  const [outgoing] = await db
    .select()
    .from(friendRequestsTable)
    .where(
      and(
        eq(friendRequestsTable.fromUserId, myId),
        eq(friendRequestsTable.toUserId, toUserId),
        eq(friendRequestsTable.status, "pending"),
      ),
    );

  if (outgoing) {
    res.status(400).json({ error: "Request already exists" });
    return;
  }

  const [request] = await db
    .insert(friendRequestsTable)
    .values({ fromUserId: myId, toUserId })
    .returning();

  res.status(201).json({
    id: request.id,
    fromUserId: request.fromUserId,
    toUserId: request.toUserId,
    status: request.status,
    createdAt: request.createdAt.toISOString(),
  });

  // Fire-and-forget push to the recipient
  void (async () => {
    try {
      const [me] = await db.select().from(usersTable).where(eq(usersTable.id, myId));
      await sendPushToUser(toUserId, {
        title: "새 친구 요청",
        body: `${me?.nickname ?? "누군가"}님이 친구 요청을 보냈습니다`,
        url: "/friends/requests",
        tag: "friend-request",
      });
    } catch (err) {
      req.log.error({ err }, "Failed to dispatch friend-request push");
    }
  })();
});

router.get("/friend-requests/incoming", requireAuth, async (req, res): Promise<void> => {
  const myId = req.dbUser!.id;
  const requests = await db
    .select()
    .from(friendRequestsTable)
    .where(and(eq(friendRequestsTable.toUserId, myId), eq(friendRequestsTable.status, "pending")));

  const identities = await getActiveCharacterIdentityMap(requests.map((request) => request.fromUserId));
  const result = await Promise.all(
    requests.map(async (r) => {
      const [u] = await db.select().from(usersTable).where(eq(usersTable.id, r.fromUserId));
      return {
        id: r.id,
        fromUserId: r.fromUserId,
        toUserId: r.toUserId,
        status: r.status,
        createdAt: r.createdAt.toISOString(),
        user: u ? {
          ...toPublicUser(u),
          nickname: identities.get(u.id)?.displayName ?? u.nickname,
          profileImageUrl: identities.get(u.id)?.profileImageUrl ?? null,
          profile: identities.get(u.id) ?? null,
        } : null,
      };
    }),
  );

  res.json(result.filter((r) => r.user !== null));
});

router.get("/friend-requests/outgoing", requireAuth, async (req, res): Promise<void> => {
  const myId = req.dbUser!.id;
  const requests = await db
    .select()
    .from(friendRequestsTable)
    .where(and(eq(friendRequestsTable.fromUserId, myId), eq(friendRequestsTable.status, "pending")));

  const identities = await getActiveCharacterIdentityMap(requests.map((request) => request.toUserId));
  const result = await Promise.all(
    requests.map(async (r) => {
      const [u] = await db.select().from(usersTable).where(eq(usersTable.id, r.toUserId));
      return {
        id: r.id,
        fromUserId: r.fromUserId,
        toUserId: r.toUserId,
        status: r.status,
        createdAt: r.createdAt.toISOString(),
        user: u ? {
          ...toPublicUser(u),
          nickname: identities.get(u.id)?.displayName ?? u.nickname,
          profileImageUrl: identities.get(u.id)?.profileImageUrl ?? null,
          profile: identities.get(u.id) ?? null,
        } : null,
      };
    }),
  );

  res.json(result.filter((r) => r.user !== null));
});

router.patch("/friend-requests/:id/accept", requireAuth, async (req, res): Promise<void> => {
  const myId = req.dbUser!.id;
  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;

  const [request] = await db
    .select()
    .from(friendRequestsTable)
    .where(and(eq(friendRequestsTable.id, raw), eq(friendRequestsTable.toUserId, myId)));

  if (!request) {
    res.status(404).json({ error: "Request not found" });
    return;
  }

  // Atomically transition pending -> accepted. Only the caller that wins this
  // conditional update proceeds to create the friendship, which makes accept
  // idempotent and prevents duplicate friendships from double-taps / races.
  const [updated] = await db
    .update(friendRequestsTable)
    .set({ status: "accepted" })
    .where(and(eq(friendRequestsTable.id, raw), eq(friendRequestsTable.status, "pending")))
    .returning();

  if (updated) {
    const [existingFriendship] = await db
      .select()
      .from(friendshipsTable)
      .where(
        or(
          and(eq(friendshipsTable.userAId, request.fromUserId), eq(friendshipsTable.userBId, request.toUserId)),
          and(eq(friendshipsTable.userAId, request.toUserId), eq(friendshipsTable.userBId, request.fromUserId)),
        ),
      );

    if (!existingFriendship) {
      await db.insert(friendshipsTable).values({ userAId: request.fromUserId, userBId: request.toUserId });
    }
  }

  res.json({
    id: request.id,
    fromUserId: request.fromUserId,
    toUserId: request.toUserId,
    status: "accepted",
    createdAt: request.createdAt.toISOString(),
  });

  // Fire-and-forget push to the original requester
  void (async () => {
    try {
      const [me] = await db.select().from(usersTable).where(eq(usersTable.id, myId));
      await sendPushToUser(request.fromUserId, {
        title: "친구 요청 수락",
        body: `${me?.nickname ?? "상대방"}님이 친구 요청을 수락했습니다`,
        url: "/friends",
        tag: "friend-accepted",
      });
    } catch (err) {
      req.log.error({ err }, "Failed to dispatch friend-accept push");
    }
  })();
});

router.patch("/friend-requests/:id/reject", requireAuth, async (req, res): Promise<void> => {
  const myId = req.dbUser!.id;
  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;

  const [request] = await db
    .select()
    .from(friendRequestsTable)
    .where(and(eq(friendRequestsTable.id, raw), eq(friendRequestsTable.toUserId, myId)));

  if (!request) {
    res.status(404).json({ error: "Request not found" });
    return;
  }

  const [updated] = await db
    .update(friendRequestsTable)
    .set({ status: "rejected" })
    .where(eq(friendRequestsTable.id, raw))
    .returning();

  res.json({
    id: updated.id,
    fromUserId: updated.fromUserId,
    toUserId: updated.toUserId,
    status: updated.status,
    createdAt: updated.createdAt.toISOString(),
  });
});

export default router;
