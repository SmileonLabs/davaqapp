import {registerCollectorDirectRoom} from "./collectorProfiles";
import { publicDavaqAvatar } from "../lib/davaqAvatarPolicy";
import { Router, type IRouter } from "express";
import { z } from "zod/v4";
import { and, eq, inArray, isNull, or, sql } from "drizzle-orm";
import { db } from "@workspace/db";
import { activeCharacterProfilesTable, characterProfilesTable, chatRoomsTable, chatRoomMembersTable, friendshipsTable, messageDeletionsTable, messagesTable, usersTable } from "@workspace/db";
import { requireAuth } from "../lib/auth";
import { toPublicUser } from "../lib/publicUser";
import { allocateRoomMessageSeq, getRoomUnreadMeta } from "../lib/readReceipts";
import { hasMutualBlockBetween, lockUserPair } from "../lib/chatDelivery";
import { ensureCharacterProfileState, resolveCharacterProfileActor } from "../lib/characterProfiles";

const router: IRouter = Router();
const MAX_ROOM_MEMBERS = 100;
const ROOM_CATEGORIES = [
  "direct",
  "fanclub",
  "counseling",
  "friend_finding",
  "meetup",
  "casual",
  "peer",
  "karaoke",
  "growth_rpg",
  "talk_battle",
] as const;
const muteRoomSchema = z.object({ muted: z.boolean() }).strict();
const addMembersSchema = z.object({ memberIds: z.array(z.uuid()).min(1).max(50) }).strict();
const createRoomSchema = z.object({
  type: z.enum(["direct", "group"]),
  name: z.string().trim().min(1).max(30).nullable().optional(),
  category: z.enum(ROOM_CATEGORIES).optional(),
  visibility: z.enum(["private", "invite_only"]).optional(),
  memberIds: z.array(z.uuid()).max(MAX_ROOM_MEMBERS),
}).strict();

function messagePreview(type: string, content: string, deleted: boolean): string {
  if (deleted) return "삭제된 메시지";
  return type === "image"
    ? "사진"
    : type === "sticker"
      ? "스티커"
      : type === "file"
        ? "파일"
        : content;
}

export async function roomWithMeta(roomId: string, userId: string) {
  const room = (await db.select().from(chatRoomsTable).where(eq(chatRoomsTable.id, roomId)))[0];
  if (!room) return null;

  const memberRows = await db
    .select()
    .from(chatRoomMembersTable)
    .where(eq(chatRoomMembersTable.roomId, roomId));

  const myMember = memberRows.find((m) => m.userId === userId);
  // Batch-load every member's user record in ONE query instead of N per-member
  // round-trips (this runs for every room on each 3s /rooms poll).
  const memberUserIds = memberRows.map((m) => m.userId);
  const userRows = memberUserIds.length
    ? await db.select().from(usersTable).where(inArray(usersTable.id, memberUserIds))
    : [];
  const userById = new Map(userRows.map((u) => [u.id, u]));
  // Older room memberships may not have profile_id. Resolve those through the
  // member's currently active character profile instead of leaking the account
  // photo into character-facing chat UI.
  const activeProfileRows = memberUserIds.length
    ? await db
        .select()
        .from(activeCharacterProfilesTable)
        .where(inArray(activeCharacterProfilesTable.userId, memberUserIds))
    : [];
  const activeProfileIdByUserId = new Map(
    activeProfileRows.map((row) => [row.userId, row.activeProfileId]),
  );
  const memberProfileIds = [
    ...new Set(
      memberRows.flatMap((member) => {
        const profileId = member.profileId ?? activeProfileIdByUserId.get(member.userId);
        return profileId ? [profileId] : [];
      }),
    ),
  ];
  const profileRows = memberProfileIds.length
    ? await db.select().from(characterProfilesTable).where(inArray(characterProfilesTable.id, memberProfileIds))
    : [];
  const profileById = new Map(profileRows.map((profile) => [profile.id, profile]));
  const aliasByUserId = new Map<string, string | null>();
  if (memberUserIds.length > 0) {
    const friendships = await db
      .select()
      .from(friendshipsTable)
      .where(or(eq(friendshipsTable.userAId, userId), eq(friendshipsTable.userBId, userId)));
    const memberIdSet = new Set(memberUserIds);
    for (const friendship of friendships) {
      const otherId = friendship.userAId === userId ? friendship.userBId : friendship.userAId;
      if (!memberIdSet.has(otherId)) continue;
      aliasByUserId.set(
        otherId,
        friendship.userAId === userId
          ? friendship.userAFriendAlias ?? null
          : friendship.userBFriendAlias ?? null,
      );
    }
  }
  const members = memberRows
    .map((m) => userById.get(m.userId))
    .filter((u): u is NonNullable<typeof u> => !!u)
    .map((u) => {
      const membership = memberRows.find((member) => member.userId === u.id);
      const effectiveProfileId = membership?.profileId ?? activeProfileIdByUserId.get(u.id);
      const profile = effectiveProfileId ? profileById.get(effectiveProfileId) : null;
      const friendAlias = aliasByUserId.get(u.id) ?? null;
      const characterProfileImageUrl = publicDavaqAvatar(
        profile?.type === "fan" && profile.profileImageUrl === u.profileImageUrl ? null : profile?.profileImageUrl,
        profile?.metadata, profile?.id,
      );
      return {
        ...toPublicUser(u),
        profile: profile ? { id: profile.id, type: profile.type, handle: profile.handle, displayName: profile.displayName, profileImageUrl: characterProfileImageUrl } : null,
        profileImageUrl: profile ? characterProfileImageUrl : null,
        friendAlias,
        displayName: friendAlias || profile?.displayName || u.nickname,
      };
    });

  let unreadCount = 0;
  let firstUnreadMessageId: string | null = null;
  if (myMember) {
    const unread = await getRoomUnreadMeta(roomId, userId, myMember.lastReadSeq ?? 0);
    unreadCount = unread.unreadCount;
    firstUnreadMessageId = unread.firstUnreadMessageId;
  }

  let pinnedMessage: {
    id: string;
    senderId: string;
    senderName: string | null;
    type: string;
    content: string;
    createdAt: string;
    deletedAt: string | null;
  } | null = null;
  if (room.pinnedMessageId) {
    const [pin] = await db
      .select()
      .from(messagesTable)
      .where(and(eq(messagesTable.id, room.pinnedMessageId), eq(messagesTable.roomId, roomId)));
    const [deletedForMe] = await db
      .select({ id: messageDeletionsTable.id })
      .from(messageDeletionsTable)
      .where(and(eq(messageDeletionsTable.messageId, room.pinnedMessageId), eq(messageDeletionsTable.userId, userId)));
    if (pin && !deletedForMe) {
      pinnedMessage = {
        id: pin.id,
        senderId: pin.senderId,
        senderName: aliasByUserId.get(pin.senderId) || userById.get(pin.senderId)?.nickname || null,
        type: pin.type,
        content: messagePreview(pin.type, pin.content, !!pin.deletedAt),
        createdAt: pin.createdAt.toISOString(),
        deletedAt: pin.deletedAt?.toISOString() ?? null,
      };
    }
  }

  return {
    id: room.id,
    type: room.type,
    category: room.category,
    visibility: room.visibility,
    name: room.name ?? null,
    ownerId: room.ownerId ?? null,
    lastMessage: room.lastMessage ?? null,
    lastMessageAt: room.lastMessageAt?.toISOString() ?? null,
    lastMessageSeq: room.lastMessageSeq,
    pinnedMessageId: room.pinnedMessageId ?? null,
    pinnedMessage,
    unreadCount,
    firstUnreadMessageId,
    muted: myMember?.muted ?? false,
    createdAt: room.createdAt.toISOString(),
    members: members.filter(Boolean),
  };
}

router.get("/rooms", requireAuth, async (req, res): Promise<void> => {
  const userId = req.dbUser!.id;
  const actorProfile = await resolveCharacterProfileActor(userId, req.header("x-character-profile-id"));
  const memberRows = await db
    .select()
    .from(chatRoomMembersTable)
    .where(and(
      eq(chatRoomMembersTable.userId, userId),
      isNull(chatRoomMembersTable.hiddenAt),
      or(eq(chatRoomMembersTable.profileId, actorProfile.id), isNull(chatRoomMembersTable.profileId)),
    ));

  const rooms = await Promise.all(memberRows.map((m) => roomWithMeta(m.roomId, userId)));
  const validRooms = rooms.filter(Boolean);
  validRooms.sort((a, b) => {
    const aTime = a?.lastMessageAt ?? a?.createdAt ?? "";
    const bTime = b?.lastMessageAt ?? b?.createdAt ?? "";
    return bTime.localeCompare(aTime);
  });
  res.json(validRooms);
});

router.post("/rooms", requireAuth, async (req, res): Promise<void> => {
  const userId = req.dbUser!.id;
  const parsed = createRoomSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "type and memberIds are required" });
    return;
  }
  const { type, name, memberIds } = parsed.data;
  if (memberIds.includes(userId)) {
    res.status(400).json({ error: "ROOM_MEMBER_SELF", message: "요청자 본인은 memberIds에서 제외해야 합니다." });
    return;
  }
  if (type === "group" && parsed.data.category === "direct") {
    res.status(400).json({ error: "INVALID_ROOM_CATEGORY", message: "그룹 채팅에는 direct 분류를 사용할 수 없습니다." });
    return;
  }
  const category = type === "direct" ? "direct" : parsed.data.category ?? "casual";
  const visibility = type === "direct" ? "private" : parsed.data.visibility ?? "invite_only";

  const allMemberIds = Array.from(new Set([userId, ...memberIds]));
  const existingMembers = await db
    .select({ id: usersTable.id })
    .from(usersTable)
    .where(inArray(usersTable.id, allMemberIds));
  if (existingMembers.length !== allMemberIds.length) {
    res.status(400).json({ error: "All room members must exist" });
    return;
  }
  const actorProfile = await resolveCharacterProfileActor(userId, req.header("x-character-profile-id"));
  const profileByUserId = new Map<string, string>();
  for (const memberId of allMemberIds) {
    const profile = memberId === userId ? actorProfile : (await ensureCharacterProfileState(memberId)).activeProfile;
    profileByUserId.set(memberId, profile.id);
  }

  // Helper: find an existing direct room shared by exactly the given two users.
  const findDirectRoom = async (
    tx: Pick<typeof db, "select">,
    a: string,
    b: string,
    aProfileId: string,
    bProfileId: string,
  ): Promise<string | null> => {
    const directRooms = await tx
      .select({ id: chatRoomsTable.id })
      .from(chatRoomsTable)
      .where(eq(chatRoomsTable.type, "direct"));
    for (const room of directRooms) {
      const members = await tx
        .select({ userId: chatRoomMembersTable.userId, profileId: chatRoomMembersTable.profileId })
        .from(chatRoomMembersTable)
        .where(eq(chatRoomMembersTable.roomId, room.id));
      if (members.length !== 2) continue;
      const aMember = members.find((member) => member.userId === a);
      const bMember = members.find((member) => member.userId === b);
      if (aMember?.profileId === aProfileId && bMember?.profileId === bProfileId) return room.id;
    }
    return null;
  };

  if (type === "direct") {
    if (allMemberIds.length !== 2) {
      res.status(400).json({ error: "Direct rooms must have exactly 2 members" });
      return;
    }
    const [a, b] = [...allMemberIds].sort();
    const aProfileId = profileByUserId.get(a);
    const bProfileId = profileByUserId.get(b);
    if (!aProfileId || !bProfileId) {
      res.status(400).json({ error: "All room members must have an active profile" });
      return;
    }

    // Serialize concurrent creation for this user pair with a transaction-scoped
    // advisory lock so two simultaneous requests can't both create a room.
    const roomId = await db.transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`direct:${a}:${b}`}))`);
      // Blocking and direct-room creation share this pair lock, so a newly
      // created/re-entered room cannot race with a block request.
      await lockUserPair(tx, a, b);
      if (await hasMutualBlockBetween(tx, a, b)) return null;

      const existingId = await findDirectRoom(tx, a, b, aProfileId, bProfileId);
      if (existingId) {
        // Re-entering a room this user previously left: un-hide it so it
        // reappears in their list with the existing history intact.
        await tx
          .update(chatRoomMembersTable)
          .set({ hiddenAt: null, profileId: actorProfile.id })
          .where(
            and(
              eq(chatRoomMembersTable.roomId, existingId),
              eq(chatRoomMembersTable.userId, userId),
            ),
          );
        return existingId;
      }

      const [created] = await tx
        .insert(chatRoomsTable)
        .values({ type, category, visibility, name: null, ownerId: null })
        .returning();
      await tx
        .insert(chatRoomMembersTable)
        .values(allMemberIds.map((mid) => ({ roomId: created.id, userId: mid, profileId: profileByUserId.get(mid) })));
      return created.id;
    });

    if (!roomId) {
      res.status(403).json({ error: "Blocked users cannot create or re-enter a direct room" });
      return;
    }

    await registerCollectorDirectRoom(roomId,userId);
    const result = await roomWithMeta(roomId, userId);
    res.status(201).json(result);
    return;
  }

  for (const memberId of memberIds) {
    if (await hasMutualBlockBetween(db, userId, memberId)) {
      res.status(403).json({ error: "BLOCKED_MEMBER", message: "차단 관계인 사용자는 그룹에 초대할 수 없습니다." });
      return;
    }
    const [friendship] = await db
      .select({ id: friendshipsTable.id })
      .from(friendshipsTable)
      .where(or(
        and(eq(friendshipsTable.userAId, userId), eq(friendshipsTable.userBId, memberId)),
        and(eq(friendshipsTable.userAId, memberId), eq(friendshipsTable.userBId, userId)),
      ))
      .limit(1);
    if (!friendship) {
      res.status(403).json({ error: "FRIEND_REQUIRED", message: "친구만 그룹에 초대할 수 있습니다." });
      return;
    }
  }

  const room = await db.transaction(async (tx) => {
    const [created] = await tx
      .insert(chatRoomsTable)
      .values({ type, category, visibility, name: name ?? null, ownerId: userId })
      .returning();
    await tx.insert(chatRoomMembersTable).values(
      allMemberIds.map((mid) => ({ roomId: created.id, userId: mid, profileId: profileByUserId.get(mid) })),
    );
    return created;
  });

  const result = await roomWithMeta(room.id, userId);
  res.status(201).json(result);
});

router.get("/rooms/:id", requireAuth, async (req, res): Promise<void> => {
  const userId = req.dbUser!.id;
  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;

  const [member] = await db
    .select()
    .from(chatRoomMembersTable)
    .where(and(eq(chatRoomMembersTable.roomId, raw), eq(chatRoomMembersTable.userId, userId)));

  if (!member) {
    res.status(404).json({ error: "Room not found" });
    return;
  }

  const room = await roomWithMeta(raw, userId);
  res.json(room);
});

router.post("/rooms/:id/leave", requireAuth, async (req, res): Promise<void> => {
  const userId = req.dbUser!.id;
  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;

  await db.transaction(async (tx) => {
    // Serialize concurrent leaves of the same room so the "both parties hidden →
    // delete" garbage-collection check below sees a consistent membership view.
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`room:${raw}`}))`);

    const [room] = await tx
      .select()
      .from(chatRoomsTable)
      .where(eq(chatRoomsTable.id, raw));
    if (!room) return;

    // Must be a member to leave.
    const [member] = await tx
      .select()
      .from(chatRoomMembersTable)
      .where(and(eq(chatRoomMembersTable.roomId, raw), eq(chatRoomMembersTable.userId, userId)));
    if (!member) return;

    // Direct (1:1) rooms: leaving must NOT destroy the other party's history.
    // Soft-hide this user's membership so the room disappears from their list
    // only. It is restored (un-hidden) when they re-open the chat or a new
    // message arrives. If both parties have hidden it, garbage-collect the room.
    if (room.type === "direct") {
      await tx
        .update(chatRoomMembersTable)
        .set({ hiddenAt: new Date() })
        .where(and(eq(chatRoomMembersTable.roomId, raw), eq(chatRoomMembersTable.userId, userId)));

      const visible = await tx
        .select({ id: chatRoomMembersTable.id })
        .from(chatRoomMembersTable)
        .where(and(eq(chatRoomMembersTable.roomId, raw), isNull(chatRoomMembersTable.hiddenAt)));
      if (visible.length === 0) {
        await tx.delete(chatRoomsTable).where(eq(chatRoomsTable.id, raw));
      }
      return;
    }

    // Group rooms: fully remove this user's membership.
    await tx
      .delete(chatRoomMembersTable)
      .where(and(eq(chatRoomMembersTable.roomId, raw), eq(chatRoomMembersTable.userId, userId)));

    const remaining = await tx
      .select({ userId: chatRoomMembersTable.userId, joinedAt: chatRoomMembersTable.joinedAt })
      .from(chatRoomMembersTable)
      .where(eq(chatRoomMembersTable.roomId, raw));

    // An empty group is orphaned — delete it (messages cascade).
    if (remaining.length === 0) {
      await tx.delete(chatRoomsTable).where(eq(chatRoomsTable.id, raw));
      return;
    }

    // If the owner left, hand ownership to the earliest-joined remaining member
    // so the room always has a valid owner.
    if (room.ownerId === userId) {
      const nextOwner = [...remaining].sort(
        (a, b) => a.joinedAt.getTime() - b.joinedAt.getTime(),
      )[0];
      await tx
        .update(chatRoomsTable)
        .set({ ownerId: nextOwner.userId })
        .where(eq(chatRoomsTable.id, raw));
    }
  });

  res.sendStatus(204);
});

router.patch("/rooms/:id/mute", requireAuth, async (req, res): Promise<void> => {
  const userId = req.dbUser!.id;
  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const parsed = muteRoomSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid mute setting" });
    return;
  }
  const { muted } = parsed.data;
  const [updated] = await db
    .update(chatRoomMembersTable)
    .set({ muted })
    .where(and(eq(chatRoomMembersTable.roomId, raw), eq(chatRoomMembersTable.userId, userId)))
    .returning();
  res.json({ id: updated.id, roomId: updated.roomId, userId: updated.userId, joinedAt: updated.joinedAt.toISOString(), muted: updated.muted });
});

router.get("/rooms/:id/members", requireAuth, async (req, res): Promise<void> => {
  const userId = req.dbUser!.id;
  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;

  const [member] = await db
    .select()
    .from(chatRoomMembersTable)
    .where(and(eq(chatRoomMembersTable.roomId, raw), eq(chatRoomMembersTable.userId, userId)));

  if (!member) {
    res.status(404).json({ error: "Room not found" });
    return;
  }

  const memberRows = await db
    .select()
    .from(chatRoomMembersTable)
    .where(eq(chatRoomMembersTable.roomId, raw));

  const members = await Promise.all(
    memberRows.map(async (m) => {
      const [u] = await db.select().from(usersTable).where(eq(usersTable.id, m.userId));
      return u ? toPublicUser(u) : null;
    }),
  );

  res.json(members.filter(Boolean));
});

router.post("/rooms/:id/members", requireAuth, async (req, res): Promise<void> => {
  const userId = req.dbUser!.id;
  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const parsed = addMembersSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid memberIds" });
    return;
  }
  const { memberIds } = parsed.data;

  // Only an existing member of a GROUP room may invite others.
  const [room] = await db.select().from(chatRoomsTable).where(eq(chatRoomsTable.id, raw));
  if (!room) {
    res.status(404).json({ error: "Room not found" });
    return;
  }
  const [member] = await db
    .select()
    .from(chatRoomMembersTable)
    .where(and(eq(chatRoomMembersTable.roomId, raw), eq(chatRoomMembersTable.userId, userId)));
  if (!member) {
    res.status(404).json({ error: "Room not found" });
    return;
  }
  if (room.type !== "group") {
    res.status(400).json({ error: "Only group rooms can be invited to" });
    return;
  }

  const added = await db.transaction(async (tx) => {
    // Serialize concurrent invites of the same room so the "already a member"
    // check and insert see a consistent membership view (no duplicate rows).
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`room:${raw}`}))`);

    const existing = await tx
      .select({ userId: chatRoomMembersTable.userId })
      .from(chatRoomMembersTable)
      .where(eq(chatRoomMembersTable.roomId, raw));
    const existingIds = new Set(existing.map((m) => m.userId));

    // Only invite real users the inviter is actually friends with, and who
    // aren't already members. This mirrors the friends-only invite convention
    // and the group-create UI (which lists friends only).
    const candidateIds = Array.from(new Set(memberIds)).filter((mid) => !existingIds.has(mid));
    const newlyAdded: string[] = [];
    for (const mid of candidateIds) {
      const [friendship] = await tx
        .select({ id: friendshipsTable.id })
        .from(friendshipsTable)
        .where(
          or(
            and(eq(friendshipsTable.userAId, userId), eq(friendshipsTable.userBId, mid)),
            and(eq(friendshipsTable.userAId, mid), eq(friendshipsTable.userBId, userId)),
          ),
        );
      if (!friendship) continue;
      const invitedProfile = (await ensureCharacterProfileState(mid)).activeProfile;
      await tx.insert(chatRoomMembersTable).values({ roomId: raw, userId: mid, profileId: invitedProfile.id });
      newlyAdded.push(mid);
    }
    return newlyAdded;
  });

  // Announce the new members with a system message so everyone sees who joined.
  if (added.length > 0) {
    const [inviter] = await db.select().from(usersTable).where(eq(usersTable.id, userId));
    const addedUsers = await Promise.all(
      added.map(async (mid) => {
        const [u] = await db.select({ nickname: usersTable.nickname }).from(usersTable).where(eq(usersTable.id, mid));
        return u?.nickname ?? "알 수 없음";
      }),
    );
    const names = addedUsers.join(", ");
    await db.transaction(async (tx) => {
      const roomSeq = await allocateRoomMessageSeq(tx, raw);
      await tx.insert(messagesTable).values({
        roomId: raw,
        senderId: userId,
        type: "system",
        content: `${inviter?.nickname ?? "누군가"}님이 ${names}님을 초대했습니다`,
        roomSeq,
      });
      await tx
        .update(chatRoomsTable)
        .set({ lastMessage: `${names}님이 참여했습니다`, lastMessageAt: new Date() })
        .where(eq(chatRoomsTable.id, raw));
    });
  }

  const result = await roomWithMeta(raw, userId);
  res.json(result);
});

export default router;
