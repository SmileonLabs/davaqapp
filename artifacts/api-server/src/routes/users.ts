import { Router, type IRouter } from "express";
import { z } from "zod/v4";
import { and, count, desc, eq, ilike, inArray, lt, notInArray, or, sql } from "drizzle-orm";
import { db } from "@workspace/db";
import {
  profileUpdateHistoryTable,
  starFeedPostsTable,
  usersTable,
  type ProfileUpdateHistoryKind,
  fanProfilesTable,
  starProfilesTable,
  starProfileFollowsTable,
  starGrowthEventsTable,
  battleSessionsTable,
  chatRoomMembersTable,
  blockedUsersTable,
  characterProfilesTable,
  characterProfileFollowsTable,
} from "@workspace/db";
import { requireAuth } from "../lib/auth";
import {
  getActiveCharacterIdentityMap,
  resolveCharacterProfileActor,
} from "../lib/characterProfiles";
import { addSubscription, removeSubscription } from "../lib/push";
import { toPublicUser } from "../lib/publicUser";
import { rateLimit } from "../lib/rateLimit";
import { listPublicStarFeedPostsByAuthor } from "../lib/starFeed";
import { getTrendingSearches, recordSearchQuery } from "../lib/searchTrending";
import { DAILY_QUESTS, WEEKLY_QUESTS } from "../lib/questDefinitions";

const router: IRouter = Router();

const updateMeSchema = z.object({
  nickname: z.string().trim().min(1).max(30).optional(),
  statusMessage: z.string().trim().max(200).nullable().optional(),
  notificationEnabled: z.boolean().optional(),
  talkAnalysisEnabled: z.boolean().optional(),
}).strict().refine((value) => Object.keys(value).length > 0, "At least one field is required");
const pushTokenSchema = z.object({ token: z.string().min(1).max(8_192) }).strict();
const userSearchSchema = z.object({ email: z.email().max(320).transform((value) => value.trim().toLowerCase()) });
const globalSearchSchema = z.object({
  q: z.string().trim().min(2).max(80),
  type: z.enum(["all", "users", "stars", "fans", "posts", "missions"]).default("all"),
  limit: z.coerce.number().int().min(1).max(30).default(20),
});
const recommendationSearchSchema = z.object({
  limit: z.coerce.number().int().min(4).max(30).default(12),
});
const publicProfileParams = z.object({ userId: z.string().uuid() });
const PUBLIC_PAGE_DEFAULT_LIMIT = 30;
const PUBLIC_PAGE_MAX_LIMIT = 100;

async function isProfileBlocked(viewerUserId: string, targetUserId: string): Promise<boolean> {
  if (viewerUserId === targetUserId) return false;
  const [row] = await db.select({ id: blockedUsersTable.id }).from(blockedUsersTable).where(sql`(${blockedUsersTable.blockerUserId} = ${viewerUserId} AND ${blockedUsersTable.blockedUserId} = ${targetUserId}) OR (${blockedUsersTable.blockerUserId} = ${targetUserId} AND ${blockedUsersTable.blockedUserId} = ${viewerUserId})`).limit(1);
  return !!row;
}

function profileUpdateKind(args: {
  profileImageChanged: boolean;
  statusMessageChanged: boolean;
}): ProfileUpdateHistoryKind {
  if (args.profileImageChanged && args.statusMessageChanged) return "profile_update";
  return args.profileImageChanged ? "profile_image" : "status_message";
}

function profileUpdateTitle(args: {
  profileImageChanged: boolean;
  statusMessageChanged: boolean;
}): string {
  if (args.profileImageChanged && args.statusMessageChanged) return "프로필을 업데이트했습니다";
  return args.profileImageChanged ? "프로필 사진을 변경했습니다" : "상태 메시지를 변경했습니다";
}

function profileUpdateBody(args: {
  profileImageChanged: boolean;
  statusMessageChanged: boolean;
  newStatusMessage: string | null;
}): string {
  if (args.profileImageChanged && args.statusMessageChanged) {
    return args.newStatusMessage
      ? `프로필 사진과 상태 메시지를 변경했습니다.\n${args.newStatusMessage}`
      : "프로필 사진을 변경하고 상태 메시지를 비웠습니다.";
  }
  if (args.profileImageChanged) return "프로필 사진을 변경했습니다.";
  return args.newStatusMessage ? args.newStatusMessage : "상태 메시지를 비웠습니다.";
}

function serializeProfileHistory(row: typeof profileUpdateHistoryTable.$inferSelect) {
  return {
    id: row.id,
    userId: row.userId,
    kind: row.kind,
    oldProfileImageUrl: row.oldProfileImageUrl ?? null,
    newProfileImageUrl: row.newProfileImageUrl ?? null,
    oldStatusMessage: row.oldStatusMessage ?? null,
    newStatusMessage: row.newStatusMessage ?? null,
    feedPostId: row.feedPostId ?? null,
    isVisible: row.isVisible,
    createdAt: row.createdAt.toISOString(),
  };
}

router.get("/search", requireAuth, rateLimit({ name: "global-search", limit: 30, windowSeconds: 60 }), async (req, res): Promise<void> => {
  const parsed = globalSearchSchema.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid", message: "검색어는 2~80자로 입력해 주세요." });
    return;
  }
  const { q, type, limit } = parsed.data;
  const actorProfile = await resolveCharacterProfileActor(req.dbUser!.id, req.header("x-character-profile-id"));
  const blocked = await db.select({ blockerUserId: blockedUsersTable.blockerUserId, blockedUserId: blockedUsersTable.blockedUserId }).from(blockedUsersTable).where(or(eq(blockedUsersTable.blockerUserId, req.dbUser!.id), eq(blockedUsersTable.blockedUserId, req.dbUser!.id)));
  const blockedIds = blocked.map((row) => row.blockerUserId === req.dbUser!.id ? row.blockedUserId : row.blockerUserId);
  const users = type === "posts" || type === "missions" ? [] : await db
    .select({ id: characterProfilesTable.id, ownerUserId: characterProfilesTable.ownerUserId, nickname: characterProfilesTable.displayName, handle: characterProfilesTable.handle, profileImageUrl: characterProfilesTable.profileImageUrl, accountProfileImageUrl: usersTable.profileImageUrl, statusMessage: characterProfilesTable.statusMessage, profileType: characterProfilesTable.type })
    .from(characterProfilesTable)
    .innerJoin(usersTable, eq(usersTable.id, characterProfilesTable.ownerUserId))
    .where(and(
      notInArray(characterProfilesTable.ownerUserId, [req.dbUser!.id, ...blockedIds]),
      eq(characterProfilesTable.status, "active"),
      type === "fans"
        ? eq(characterProfilesTable.type, "fan")
        : type === "stars"
          ? inArray(characterProfilesTable.type, ["star", "official_ai"])
          : undefined,
      or(ilike(characterProfilesTable.displayName, `%${q}%`), ilike(characterProfilesTable.handle, `%${q}%`), ilike(characterProfilesTable.statusMessage, `%${q}%`)),
    ))
    .limit(limit);
  const followedProfileRows = users.length ? await db
    .select({ profileId: characterProfileFollowsTable.followedProfileId })
    .from(characterProfileFollowsTable)
    .where(and(
      eq(characterProfileFollowsTable.followerProfileId, actorProfile.id),
      inArray(characterProfileFollowsTable.followedProfileId, users.map((profile) => profile.id)),
    )) : [];
  const followedProfileSet = new Set(followedProfileRows.map((row) => row.profileId));
  const stars = type !== "all" && type !== "stars" ? [] : await db
    .select({ id: starProfilesTable.id, displayName: starProfilesTable.displayName, starKey: starProfilesTable.starKey, imageUrl: starProfilesTable.imageUrl, stage: starProfilesTable.stage, ownerId: starProfilesTable.userId })
    .from(starProfilesTable)
    .where(or(ilike(starProfilesTable.displayName, `%${q}%`), ilike(starProfilesTable.starKey, `%${q}%`)))
    .limit(limit);
  const followedStarIds = stars.length ? await db.select({ starProfileId: characterProfileFollowsTable.followedProfileId }).from(characterProfileFollowsTable).where(and(eq(characterProfileFollowsTable.followerProfileId, actorProfile.id), inArray(characterProfileFollowsTable.followedProfileId, stars.map((star) => star.id)))) : [];
  const followedSet = new Set(followedStarIds.map((row) => row.starProfileId));
  const posts = type !== "all" && type !== "posts" ? [] : await db
    .select({ id: starFeedPostsTable.id, title: starFeedPostsTable.title, body: starFeedPostsTable.body, kind: starFeedPostsTable.kind, createdAt: starFeedPostsTable.createdAt, authorProfileId: starFeedPostsTable.authorProfileId, targetStarProfileId: starFeedPostsTable.targetStarProfileId })
    .from(starFeedPostsTable)
    .where(and(eq(starFeedPostsTable.status, "PUBLISHED"), eq(starFeedPostsTable.visibility, "PUBLIC"), or(ilike(starFeedPostsTable.title, `%${q}%`), ilike(starFeedPostsTable.body, `%${q}%`))))
    .orderBy(desc(starFeedPostsTable.createdAt))
    .limit(limit);
  const normalizedQuery = q.toLocaleLowerCase();
  const missions = type !== "all" && type !== "missions"
    ? []
    : [...DAILY_QUESTS, ...WEEKLY_QUESTS]
      .filter((mission) => `${mission.title} ${mission.description}`.toLocaleLowerCase().includes(normalizedQuery))
      .slice(0, limit);
  void recordSearchQuery({ term: q, userId: req.dbUser!.id, resultCount: users.length + stars.length + posts.length + missions.length }).catch(() => undefined);
  res.json({
    query: q,
    type,
    users: users.map(({ ownerUserId, accountProfileImageUrl, ...profile }) => ({
      ...profile,
      profileImageUrl:
        profile.profileType === "fan" && profile.profileImageUrl === accountProfileImageUrl
          ? null
          : profile.profileImageUrl,
      isMe: ownerUserId === req.dbUser!.id,
      followedByMe: followedProfileSet.has(profile.id),
    })),
    starProfiles: stars.map((star) => ({ id: star.id, displayName: star.displayName, starKey: star.starKey, imageUrl: star.imageUrl, stage: star.stage, profileId: star.id, ownerId: star.ownerId === req.dbUser!.id ? null : star.id, isMine: star.ownerId === req.dbUser!.id, followedByMe: followedSet.has(star.id) })),
    posts: posts.map((post) => ({ ...post, createdAt: post.createdAt.toISOString() })),
    missions,
    nextCursor: null,
  });
});

router.get("/search/recommendations", requireAuth, rateLimit({ name: "search-recommendations", limit: 60, windowSeconds: 60 }), async (req, res): Promise<void> => {
  const parsed = recommendationSearchSchema.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid", message: "추천 목록 요청이 올바르지 않습니다." });
    return;
  }
  const actorProfile = await resolveCharacterProfileActor(req.dbUser!.id, req.header("x-character-profile-id"));
  const blocked = await db
    .select({ blockerUserId: blockedUsersTable.blockerUserId, blockedUserId: blockedUsersTable.blockedUserId })
    .from(blockedUsersTable)
    .where(or(eq(blockedUsersTable.blockerUserId, req.dbUser!.id), eq(blockedUsersTable.blockedUserId, req.dbUser!.id)));
  const blockedIds = blocked.map((row) => row.blockerUserId === req.dbUser!.id ? row.blockedUserId : row.blockerUserId);
  const profiles = await db
    .select({
      id: characterProfilesTable.id,
      type: characterProfilesTable.type,
      handle: characterProfilesTable.handle,
      displayName: characterProfilesTable.displayName,
      profileImageUrl: characterProfilesTable.profileImageUrl,
      accountProfileImageUrl: usersTable.profileImageUrl,
      statusMessage: characterProfilesTable.statusMessage,
      level: characterProfilesTable.level,
    })
    .from(characterProfilesTable)
    .innerJoin(usersTable, eq(usersTable.id, characterProfilesTable.ownerUserId))
    .where(and(
      notInArray(characterProfilesTable.ownerUserId, [req.dbUser!.id, ...blockedIds]),
      eq(characterProfilesTable.status, "active"),
    ))
    .orderBy(
      sql`CASE ${characterProfilesTable.type} WHEN 'star' THEN 0 WHEN 'official_ai' THEN 1 ELSE 2 END`,
      desc(characterProfilesTable.updatedAt),
    )
    .limit(parsed.data.limit);
  const followedRows = profiles.length ? await db
    .select({ profileId: characterProfileFollowsTable.followedProfileId })
    .from(characterProfileFollowsTable)
    .where(and(
      eq(characterProfileFollowsTable.followerProfileId, actorProfile.id),
      inArray(characterProfileFollowsTable.followedProfileId, profiles.map((profile) => profile.id)),
    )) : [];
  const followedSet = new Set(followedRows.map((row) => row.profileId));
  res.json({
    items: profiles.map(({ accountProfileImageUrl, ...profile }) => ({
      ...profile,
      profileImageUrl:
        profile.type === "fan" && profile.profileImageUrl === accountProfileImageUrl
          ? null
          : profile.profileImageUrl,
      followedByMe: followedSet.has(profile.id),
      recommendationReason: profile.statusMessage?.trim()
        || (profile.type === "fan" ? "함께 응원할 새로운 친구" : profile.type === "official_ai" ? "공식 AI STAR" : "추천 STAR"),
    })),
  });
});

router.get("/search/trending", requireAuth, rateLimit({ name: "search-trending", limit: 30, windowSeconds: 60 }), async (req, res): Promise<void> => {
  const limit = z.coerce.number().int().min(1).max(10).catch(5).parse(req.query.limit);
  res.json({ items: await getTrendingSearches(limit), generatedAt: new Date().toISOString() });
});

router.get("/users", requireAuth, async (req, res): Promise<void> => {
  const users = await db.select().from(usersTable).limit(1000);
  const visibleUsers = users.filter((u) => u.id !== req.dbUser!.id);
  const identities = await getActiveCharacterIdentityMap(visibleUsers.map((user) => user.id));
  res.json(visibleUsers.map((user) => {
    const profile = identities.get(user.id) ?? null;
    return {
      ...toPublicUser(user),
      nickname: profile?.displayName ?? user.nickname,
      profileImageUrl: profile?.profileImageUrl ?? null,
      statusMessage: profile?.statusMessage ?? user.statusMessage ?? null,
      profile,
    };
  }));
});

router.get("/users/me", requireAuth, async (req, res): Promise<void> => {
  const user = req.dbUser!;
  res.json({
    id: user.id,
    clerkId: user.clerkId,
    email: user.email,
    nickname: user.nickname,
    profileImageUrl: null,
    statusMessage: user.statusMessage ?? null,
    pushToken: user.pushToken ?? null,
    notificationEnabled: user.notificationEnabled,
    talkAnalysisEnabled: user.talkAnalysisEnabled,
    createdAt: user.createdAt.toISOString(),
  });
});

router.get("/users/:userId/profile", requireAuth, async (req, res): Promise<void> => {
  const parsed = publicProfileParams.safeParse(req.params);
  if (!parsed.success) { res.status(400).json({ error: "invalid", message: "Invalid user id" }); return; }
  const userId = parsed.data.userId;
  if (await isProfileBlocked(req.dbUser!.id, userId)) { res.status(404).json({ error: "not_found", message: "Profile not found" }); return; }
  const [user] = await db.select({ id: usersTable.id, nickname: usersTable.nickname, statusMessage: usersTable.statusMessage, createdAt: usersTable.createdAt }).from(usersTable).where(eq(usersTable.id, userId)).limit(1);
  if (!user) { res.status(404).json({ error: "not_found", message: "Profile not found" }); return; }
  const [fan] = await db.select({ level: fanProfilesTable.level, xp: fanProfilesTable.xp, stats: fanProfilesTable.stats }).from(fanProfilesTable).where(eq(fanProfilesTable.userId, userId)).limit(1);
  const stars = await db.select({ id: starProfilesTable.id, displayName: starProfilesTable.displayName, starKey: starProfilesTable.starKey, imageUrl: starProfilesTable.imageUrl, stage: starProfilesTable.stage, level: starProfilesTable.level, xp: starProfilesTable.xp, equippedAt: starProfilesTable.equippedAt }).from(starProfilesTable).where(eq(starProfilesTable.userId, userId)).orderBy(desc(starProfilesTable.equippedAt), desc(starProfilesTable.createdAt));
  const [followers] = await db.select({ value: count() }).from(starProfileFollowsTable).innerJoin(starProfilesTable, eq(starProfilesTable.id, starProfileFollowsTable.starProfileId)).where(eq(starProfilesTable.userId, userId));
  const [following] = await db.select({ value: count() }).from(starProfileFollowsTable).where(eq(starProfileFollowsTable.followerUserId, userId));
  const followedStarIds = stars.length ? await db.select({ starProfileId: starProfileFollowsTable.starProfileId }).from(starProfileFollowsTable).where(and(eq(starProfileFollowsTable.followerUserId, req.dbUser!.id), eq(starProfileFollowsTable.starProfileId, stars[0].id))) : [];
  const activeProfile = (await getActiveCharacterIdentityMap([userId])).get(userId) ?? null;
  res.json({ id: user.id, nickname: activeProfile?.displayName ?? user.nickname, profileImageUrl: activeProfile?.profileImageUrl ?? null, statusMessage: activeProfile?.statusMessage ?? user.statusMessage ?? null, profileType: activeProfile?.type ?? "fan", activeProfile, createdAt: user.createdAt.toISOString(), fan: fan ?? { level: 1, xp: 0, stats: null }, stars, followerCount: Number(followers?.value ?? 0), followingCount: Number(following?.value ?? 0), followedStarIds: followedStarIds.map((item) => item.starProfileId) });
});

router.get("/users/:userId/posts", requireAuth, async (req, res): Promise<void> => {
  const parsed = publicProfileParams.safeParse(req.params);
  if (!parsed.success) { res.status(400).json({ error: "invalid", message: "Invalid user id" }); return; }
  if (await isProfileBlocked(req.dbUser!.id, parsed.data.userId)) { res.status(404).json({ error: "not_found", message: "Profile not found" }); return; }
  const limit = z.coerce.number().int().min(1).max(PUBLIC_PAGE_MAX_LIMIT).catch(PUBLIC_PAGE_DEFAULT_LIMIT).parse(req.query.limit);
  const cursor = typeof req.query.cursor === "string" && !Number.isNaN(Date.parse(req.query.cursor)) ? req.query.cursor : undefined;
  const starProfileId = typeof req.query.starId === "string" && z.string().uuid().safeParse(req.query.starId).success ? req.query.starId : undefined;
  res.json(await listPublicStarFeedPostsByAuthor(req.dbUser!.id, parsed.data.userId, limit, starProfileId, cursor));
});

router.get("/users/:userId/growth-records", requireAuth, async (req, res): Promise<void> => {
  const parsed = publicProfileParams.safeParse(req.params);
  if (!parsed.success) { res.status(400).json({ error: "invalid", message: "Invalid user id" }); return; }
  if (await isProfileBlocked(req.dbUser!.id, parsed.data.userId)) { res.status(404).json({ error: "not_found", message: "Profile not found" }); return; }
  const limit = z.coerce.number().int().min(1).max(PUBLIC_PAGE_MAX_LIMIT).catch(PUBLIC_PAGE_DEFAULT_LIMIT).parse(req.query.limit);
  const cursor = typeof req.query.cursor === "string" && !Number.isNaN(Date.parse(req.query.cursor)) ? new Date(req.query.cursor) : undefined;
  const rows = await db.select({ id: starGrowthEventsTable.id, starProfileId: starGrowthEventsTable.starProfileId, eventType: starGrowthEventsTable.eventType, xpDelta: starGrowthEventsTable.xpDelta, reason: starGrowthEventsTable.reason, createdAt: starGrowthEventsTable.createdAt }).from(starGrowthEventsTable).where(and(eq(starGrowthEventsTable.userId, parsed.data.userId), ...(cursor ? [lt(starGrowthEventsTable.createdAt, cursor)] : []))).orderBy(desc(starGrowthEventsTable.createdAt)).limit(limit);
  res.json({ items: rows.map((row) => ({ ...row, createdAt: row.createdAt.toISOString() })), nextCursor: rows.length === limit ? rows[rows.length - 1].createdAt.toISOString() : null });
});

router.get("/users/:userId/battle-results", requireAuth, async (req, res): Promise<void> => {
  const parsed = publicProfileParams.safeParse(req.params);
  if (!parsed.success) { res.status(400).json({ error: "invalid", message: "Invalid user id" }); return; }
  if (await isProfileBlocked(req.dbUser!.id, parsed.data.userId)) { res.status(404).json({ error: "not_found", message: "Profile not found" }); return; }
  const limit = z.coerce.number().int().min(1).max(PUBLIC_PAGE_MAX_LIMIT).catch(PUBLIC_PAGE_DEFAULT_LIMIT).parse(req.query.limit);
  const cursor = typeof req.query.cursor === "string" && !Number.isNaN(Date.parse(req.query.cursor)) ? new Date(req.query.cursor) : undefined;
  const sessions = await db.select({ roomId: battleSessionsTable.roomId, state: battleSessionsTable.state, updatedAt: battleSessionsTable.updatedAt }).from(battleSessionsTable).innerJoin(chatRoomMembersTable, and(eq(chatRoomMembersTable.roomId, battleSessionsTable.roomId), eq(chatRoomMembersTable.userId, parsed.data.userId))).where(and(eq(battleSessionsTable.status, "ended"), ...(cursor ? [lt(battleSessionsTable.updatedAt, cursor)] : []))).orderBy(desc(battleSessionsTable.updatedAt)).limit(limit);
  res.json({ items: sessions.map(({ roomId, state, updatedAt }) => {
    const me = state.participants.find((participant) => participant.userId === parsed.data.userId);
    const opponent = state.participants.find((participant) => participant.userId !== parsed.data.userId);
    const outcome = state.winnerUserId === null ? "draw" : state.winnerUserId === parsed.data.userId ? "win" : "loss";
    return { roomId, topic: state.topic, category: state.category, outcome, myScore: me?.totalScore ?? 0, opponentScore: opponent?.totalScore ?? 0, opponentName: opponent?.name ?? "상대", completedAt: updatedAt.toISOString() };
  }), nextCursor: sessions.length === limit ? sessions[sessions.length - 1].updatedAt.toISOString() : null });
});

router.get("/users/me/profile-history", requireAuth, async (req, res): Promise<void> => {
  const rows = await db
    .select()
    .from(profileUpdateHistoryTable)
    .where(eq(profileUpdateHistoryTable.userId, req.dbUser!.id))
    .orderBy(desc(profileUpdateHistoryTable.createdAt))
    .limit(100);
  res.json(rows.map(serializeProfileHistory));
});

router.patch("/users/me", requireAuth, async (req, res): Promise<void> => {
  const user = req.dbUser!;
  const parsed = updateMeSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid profile update" });
    return;
  }
  const { nickname, statusMessage, notificationEnabled, talkAnalysisEnabled } = parsed.data;

  const updates: Record<string, unknown> = {};
  if (nickname !== undefined) updates.nickname = nickname;
  if (statusMessage !== undefined) updates.statusMessage = statusMessage;
  if (notificationEnabled !== undefined) updates.notificationEnabled = notificationEnabled;
  if (talkAnalysisEnabled !== undefined) updates.talkAnalysisEnabled = talkAnalysisEnabled;

  const statusMessageChanged =
    statusMessage !== undefined && (statusMessage ?? null) !== (user.statusMessage ?? null);
  const shouldRecordProfileUpdate = statusMessageChanged && process.env.DAVAQ_LEGACY_PERSONA_ENABLED === "true";

  const updated = await db.transaction(async (tx) => {
    const [updatedUser] = Object.keys(updates).length > 0
      ? await tx
          .update(usersTable)
          .set(updates)
          .where(eq(usersTable.id, user.id))
          .returning()
      : await tx.select().from(usersTable).where(eq(usersTable.id, user.id));

    if (shouldRecordProfileUpdate) {
      const newStatusMessage = updatedUser.statusMessage ?? null;
      const kind = profileUpdateKind({ profileImageChanged: false, statusMessageChanged });
      const [post] = await tx
        .insert(starFeedPostsTable)
        .values({
          authorUserId: user.id,
          kind: "profile_update",
          title: profileUpdateTitle({ profileImageChanged: false, statusMessageChanged }),
          body: profileUpdateBody({ profileImageChanged: false, statusMessageChanged, newStatusMessage }),
          metadata: {
            type: "profile_update",
            profileImageChanged: false,
            statusMessageChanged,
            newStatusMessage,
          },
        })
        .returning({ id: starFeedPostsTable.id });

      await tx.insert(profileUpdateHistoryTable).values({
        userId: user.id,
        kind,
        oldProfileImageUrl: null,
        newProfileImageUrl: null,
        oldStatusMessage: statusMessageChanged ? user.statusMessage ?? null : null,
        newStatusMessage: statusMessageChanged ? newStatusMessage : null,
        feedPostId: post.id,
      });
    }

    return updatedUser;
  });

  res.json({
    id: updated.id,
    clerkId: updated.clerkId,
    email: updated.email,
    nickname: updated.nickname,
    profileImageUrl: null,
    statusMessage: updated.statusMessage ?? null,
    pushToken: updated.pushToken ?? null,
    notificationEnabled: updated.notificationEnabled,
    talkAnalysisEnabled: updated.talkAnalysisEnabled,
    createdAt: updated.createdAt.toISOString(),
  });
});

router.delete("/users/me", requireAuth, async (req, res): Promise<void> => {
  const user = req.dbUser!;
  await db.delete(usersTable).where(eq(usersTable.id, user.id));
  res.sendStatus(204);
});

router.post(
  "/users/me/push-token",
  requireAuth,
  rateLimit({ name: "push-token-register", limit: 20, windowSeconds: 60 }),
  async (req, res): Promise<void> => {
    const user = req.dbUser!;
    const parsed = pushTokenSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid token" });
      return;
    }
    const { token } = parsed.data;
    await addSubscription(user.id, token);
    const [updated] = await db
      .select()
      .from(usersTable)
      .where(eq(usersTable.id, user.id));

    res.json({
      id: updated.id,
      clerkId: updated.clerkId,
      email: updated.email,
      nickname: updated.nickname,
      profileImageUrl: null,
      statusMessage: updated.statusMessage ?? null,
      pushToken: updated.pushToken ?? null,
      notificationEnabled: updated.notificationEnabled,
      talkAnalysisEnabled: updated.talkAnalysisEnabled,
      createdAt: updated.createdAt.toISOString(),
    });
  },
);

router.delete(
  "/users/me/push-token",
  requireAuth,
  rateLimit({ name: "push-token-revoke", limit: 20, windowSeconds: 60 }),
  async (req, res): Promise<void> => {
    const parsed = pushTokenSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid token" });
      return;
    }
    await removeSubscription(req.dbUser!.id, parsed.data.token);
    res.sendStatus(204);
  },
);

router.get("/users/search", requireAuth, rateLimit({ name: "user-search", limit: 20, windowSeconds: 60 }), async (req, res): Promise<void> => {
  const parsed = userSearchSchema.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: "Valid email query param required" });
    return;
  }
  const { email } = parsed.data;
  const users = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.email, email))
    .limit(1);

  const visibleUsers = users.filter((u) => u.id !== req.dbUser!.id);
  const identities = await getActiveCharacterIdentityMap(visibleUsers.map((user) => user.id));
  res.json(visibleUsers.map((user) => {
    const profile = identities.get(user.id) ?? null;
    return {
      ...toPublicUser(user),
      nickname: profile?.displayName ?? user.nickname,
      profileImageUrl: profile?.profileImageUrl ?? null,
      statusMessage: profile?.statusMessage ?? user.statusMessage ?? null,
      profile,
    };
  }));
});

export default router;
