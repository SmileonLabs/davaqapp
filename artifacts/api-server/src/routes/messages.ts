import { Router, type IRouter } from "express";
import { and, asc, desc, eq, gt, inArray, isNull, lt, or, sql } from "drizzle-orm";
import { db } from "@workspace/db";
import {
  chatRoomMembersTable,
  chatRoomsTable,
  messageDeletionsTable,
  messageLinkPreviewsTable,
  messageStickersTable,
  messagesTable,
  characterProfilesTable,
  usersTable,
} from "@workspace/db";
import { requireAuth } from "../lib/auth";
import { publicAccountKind } from "../lib/publicUser";
import { scheduleLinkPreview } from "../lib/linkPreview";
import { safeLinkPreviewImageUrl } from "../lib/linkPreviewImagePolicy";
import { buildLinkPreviewRoomFailureLog } from "../lib/linkPreviewLogging";
import { sendPushToUsers } from "../lib/push";
import { getTypingUserIds, markTyping } from "../lib/typing";
import { runDungeonTurn } from "../lib/dungeon";
import { publishRealtimeEvent } from "../lib/realtime";
import { handleAnotherMeAfterUserMessage } from "../lib/anotherMe";
import { enqueueChatKnowledgeCandidateFromMessage } from "../lib/chatKnowledge";
import {
  hasMatchingMessagePayload,
  isValidStickerCode,
  parseMessagePage,
  validateClientMessageId,
  validateUserMessage,
} from "../lib/chatMessagePolicy";
import {
  getDirectRoomPeer,
  getRoomDeliveryRecipients,
  lockAndCheckDirectRoomBlock,
} from "../lib/chatDelivery";
import {
  advanceMemberReadSeq,
  allocateRoomMessageSeq,
  getMessageReadTarget,
  getRoomMemberReadSeqs,
  setMemberReadSeq,
  type ReadTarget,
} from "../lib/readReceipts";
import {
  ensureCharacterProfileState,
  getActiveCharacterIdentityMap,
  resolveCharacterProfileActor,
} from "../lib/characterProfiles";
import type { CharacterProfileView } from "../lib/characterProfiles";

const router: IRouter = Router();

const FORWARDABLE_TYPES = new Set(["text", "image", "file", "sticker"]);

type RoomRealtimeType =
  | "message.created"
  | "message.updated"
  | "message.read"
  | "typing.updated"
  | "room.updated";

type DbMessage = typeof messagesTable.$inferSelect;
type DbUser = typeof usersTable.$inferSelect;

interface PublicUserPayload {
  id: string;
  nickname: string;
  accountKind: "user" | "official" | "system";
  profileImageUrl: string | null;
  statusMessage: string | null;
  profile?: {
    id: string;
    type: string;
    handle: string;
    displayName: string;
    profileImageUrl: string | null;
    statusMessage?: string | null;
  } | null;
}

interface MessagePayload {
  id: string;
  roomId: string;
  roomSeq: number;
  senderId: string;
  authorKind: string;
  type: string;
  content: string;
  replyToMessageId: string | null;
  anotherMeSessionId: string | null;
  callId: string | null;
  metadata: Record<string, unknown> | null;
  clientMessageId: string | null;
  deletedAt: string | null;
  createdAt: string;
  readCount: number;
  sender: PublicUserPayload | null;
  senderProfile: {
    id: string;
    type: string;
    handle: string;
    displayName: string;
    profileImageUrl: string | null;
  } | null;
  replyTo: {
    id: string;
    senderId: string;
    senderName: string | null;
    type: string;
    content: string;
    deletedAt: string | null;
  } | null;
  stickerBadges: Array<{
    id: string;
    code: string;
    userId: string;
    createdAt: string;
    user: PublicUserPayload | null;
  }>;
  linkPreview: {
    url: string;
    domain: string | null;
    title: string | null;
    description: string | null;
    imageUrl: string | null;
  } | null;
}

function toPublicUser(user: DbUser | undefined): PublicUserPayload | null {
  if (!user) return null;
  return {
    id: user.id,
    nickname: user.nickname,
    accountKind: publicAccountKind(user),
    profileImageUrl: null,
    statusMessage: user.statusMessage ?? null,
  };
}

function previewForMessage(type: string, content: string): string {
  return type === "image"
    ? "사진"
    : type === "sticker"
      ? "스티커"
      : type === "file"
        ? "파일"
        : content;
}

function replyPreviewContent(message: DbMessage): string {
  if (message.deletedAt) return "삭제된 메시지";
  return previewForMessage(message.type, message.content);
}

async function serializeMessages(
  messages: DbMessage[],
  viewerUserId: string,
  memberReadSeqs: Array<{
    userId: string;
    lastReadSeq: number;
    isReadReceiptParticipant: boolean;
  }>,
): Promise<MessagePayload[]> {
  if (messages.length === 0) return [];

  const messageIds = messages.map((m) => m.id);
  const replyIds = Array.from(
    new Set(
      messages
        .map((m) => m.replyToMessageId)
        .filter((id): id is string => !!id),
    ),
  );
  const profileIds = Array.from(new Set(messages.flatMap((message) => message.senderProfileId ? [message.senderProfileId] : [])));
  const [deletedRows, replyRows, stickerRows, linkRows, profiles] = await Promise.all([
    db
      .select({ messageId: messageDeletionsTable.messageId })
      .from(messageDeletionsTable)
      .where(
        and(
          inArray(messageDeletionsTable.messageId, [
            ...messageIds,
            ...replyIds,
          ]),
          eq(messageDeletionsTable.userId, viewerUserId),
        ),
      ),
    replyIds.length > 0
      ? db
          .select()
          .from(messagesTable)
          .where(inArray(messagesTable.id, replyIds))
      : Promise.resolve([]),
    db
      .select()
      .from(messageStickersTable)
      .where(inArray(messageStickersTable.messageId, messageIds)),
    db
      .select()
      .from(messageLinkPreviewsTable)
      .where(inArray(messageLinkPreviewsTable.messageId, messageIds)),
    profileIds.length > 0
      ? db.select().from(characterProfilesTable).where(inArray(characterProfilesTable.id, profileIds))
      : Promise.resolve([]),
  ]);

  const deletedForViewer = new Set(deletedRows.map((row) => row.messageId));
  const replyById = new Map(replyRows.map((row) => [row.id, row]));
  const stickersByMessage = new Map<string, typeof stickerRows>();
  for (const sticker of stickerRows) {
    const list = stickersByMessage.get(sticker.messageId) ?? [];
    list.push(sticker);
    stickersByMessage.set(sticker.messageId, list);
  }
  const linkByMessage = new Map(linkRows.map((row) => [row.messageId, row]));

  const userIds = new Set<string>();
  for (const message of messages) userIds.add(message.senderId);
  for (const reply of replyRows) userIds.add(reply.senderId);
  for (const sticker of stickerRows) userIds.add(sticker.userId);
  const users =
    userIds.size > 0
      ? await db
          .select()
          .from(usersTable)
          .where(inArray(usersTable.id, Array.from(userIds)))
      : [];
  const userById = new Map(users.map((user) => [user.id, user]));
  const profileById = new Map(profiles.map((profile) => [profile.id, profile]));
  const activeIdentityByUserId = await getActiveCharacterIdentityMap(Array.from(userIds));

  return messages
    .filter((message) => !deletedForViewer.has(message.id))
    .map((message) => {
      const deleted = !!message.deletedAt;
      const readCount = memberReadSeqs.filter(
        (mr) =>
          mr.isReadReceiptParticipant &&
          mr.userId !== message.senderId &&
          mr.lastReadSeq >= message.roomSeq,
      ).length;
      const reply = message.replyToMessageId
        ? replyById.get(message.replyToMessageId)
        : null;
      const replyDeletedForViewer = reply
        ? deletedForViewer.has(reply.id)
        : false;
      const link = linkByMessage.get(message.id);
      const senderProfile =
        (message.senderProfileId ? profileById.get(message.senderProfileId) : null) ??
        activeIdentityByUserId.get(message.senderId) ??
        null;
      return {
        id: message.id,
        roomId: message.roomId,
        roomSeq: message.roomSeq,
        senderId: message.senderId,
        authorKind: message.authorKind ?? "user",
        type: message.type,
        content: deleted ? "" : message.content,
        replyToMessageId: message.replyToMessageId ?? null,
        anotherMeSessionId: message.anotherMeSessionId ?? null,
        callId: message.callId ?? null,
        metadata:
          (message.metadata as Record<string, unknown> | null | undefined) ??
          null,
        clientMessageId: message.clientMessageId ?? null,
        deletedAt: message.deletedAt?.toISOString() ?? null,
        createdAt: message.createdAt.toISOString(),
        readCount,
        sender: toPublicUser(userById.get(message.senderId)),
        senderProfile: senderProfile
          ? { id: senderProfile.id, type: senderProfile.type, handle: senderProfile.handle, displayName: senderProfile.displayName, profileImageUrl: senderProfile.profileImageUrl }
          : null,
        replyTo: reply
          ? {
              id: reply.id,
              senderId: reply.senderId,
              senderName: activeIdentityByUserId.get(reply.senderId)?.displayName ?? userById.get(reply.senderId)?.nickname ?? null,
              type: reply.type,
              content: replyDeletedForViewer
                ? "삭제된 메시지"
                : replyPreviewContent(reply),
              deletedAt: reply.deletedAt?.toISOString() ?? null,
            }
          : null,
        stickerBadges: (stickersByMessage.get(message.id) ?? []).map(
          (sticker) => ({
            id: sticker.id,
            code: sticker.code,
            userId: sticker.userId,
            createdAt: sticker.createdAt.toISOString(),
            user: (() => {
              const user = userById.get(sticker.userId);
              const profile = activeIdentityByUserId.get(sticker.userId) ?? null;
              return user ? {
                ...toPublicUser(user)!,
                nickname: profile?.displayName ?? user.nickname,
                profileImageUrl: profile?.profileImageUrl ?? null,
                profile,
              } : null;
            })(),
          }),
        ),
        linkPreview:
          !deleted && link?.status === "ready"
            ? {
                url: link.url,
                domain: link.domain ?? null,
                title: link.title ?? null,
                description: link.description ?? null,
                // Historical rows may contain publisher-controlled OG image
                // URLs. Never expose them to recipients until a same-origin,
                // authenticated image proxy exists.
                imageUrl: safeLinkPreviewImageUrl(link.imageUrl),
              }
            : null,
      };
    });
}

async function serializeMessage(
  message: DbMessage,
  viewerUserId: string,
  memberReadSeqs: Array<{
    userId: string;
    lastReadSeq: number;
    isReadReceiptParticipant: boolean;
  }>,
): Promise<MessagePayload> {
  const [serialized] = await serializeMessages(
    [message],
    viewerUserId,
    memberReadSeqs,
  );
  return serialized;
}

// A newly-created message is already rendered optimistically by the client.
// Returning the fully hydrated history representation here used to add several
// extra DB round-trips (deletions, replies, stickers, link previews, users and
// read receipts) to every send. Those enrichments arrive through the realtime
// invalidation immediately after the write, so the POST response can safely use
// this small representation and keep the send acknowledgement fast.
function serializeCreatedMessage(
  message: DbMessage,
  sender: DbUser | undefined,
  senderProfile: CharacterProfileView,
): MessagePayload {
  return {
    id: message.id,
    roomId: message.roomId,
    roomSeq: message.roomSeq,
    senderId: message.senderId,
    authorKind: message.authorKind ?? "user",
    type: message.type,
    content: message.deletedAt ? "" : message.content,
    replyToMessageId: message.replyToMessageId ?? null,
    anotherMeSessionId: message.anotherMeSessionId ?? null,
    callId: message.callId ?? null,
    metadata:
      (message.metadata as Record<string, unknown> | null | undefined) ?? null,
    clientMessageId: message.clientMessageId ?? null,
    deletedAt: message.deletedAt?.toISOString() ?? null,
    createdAt: message.createdAt.toISOString(),
    readCount: 0,
    sender: toPublicUser(sender),
    senderProfile: {
      id: senderProfile.id,
      type: senderProfile.type,
      handle: senderProfile.handle,
      displayName: senderProfile.displayName,
      profileImageUrl: senderProfile.profileImageUrl,
    },
    replyTo: null,
    stickerBadges: [],
    linkPreview: null,
  };
}

async function publishRoomRealtimeEvent(
  roomId: string,
  actorUserId: string,
  type: RoomRealtimeType,
  data?: Record<string, unknown>,
): Promise<void> {
  const recipients = await getRoomDeliveryRecipients(roomId, actorUserId);
  if (!recipients.realtimeUserIds.includes(actorUserId)) return;
  await publishRealtimeEvent({
    type,
    roomId,
    actorUserId,
    userIds: recipients.realtimeUserIds,
    data,
  });
}

function dispatchMessageRealtimeAndPush(args: {
  roomId: string;
  actorUserId: string;
  message: DbMessage;
  sender: DbUser | undefined;
  preview: string;
  log: { error: (obj: unknown, msg?: string) => void };
}): void {
  const { roomId, actorUserId, message, sender, preview, log } = args;
  void (async () => {
    try {
      const recipients = await getRoomDeliveryRecipients(roomId, actorUserId);
      await publishRealtimeEvent({
        type: "message.created",
        roomId,
        actorUserId,
        userIds: recipients.realtimeUserIds,
        data: {
          messageId: message.id,
          messageType: message.type,
          roomSeq: message.roomSeq,
        },
      });
      if (recipients.pushUserIds.length === 0) return;
      await sendPushToUsers(recipients.pushUserIds, {
        title: sender?.nickname ?? "새 메시지",
        body: preview.length > 80 ? `${preview.slice(0, 80)}...` : preview,
        url: `/chat/${roomId}`,
        tag: `room-${roomId}`,
      });
    } catch (err) {
      log.error({ err }, "Failed to dispatch message push");
    }
  })();
}

// Monotonically advance a member's read pointer toward `target`, NEVER moving it
// backward. Read state is seq-based (`roomSeq` / `lastReadSeq`) so equal
// timestamps can never skew unread/read-count computation.
async function advanceReadPointer(
  roomId: string,
  userId: string,
  target: ReadTarget,
): Promise<boolean> {
  return advanceMemberReadSeq(roomId, userId, target);
}

router.get(
  "/rooms/:id/messages",
  requireAuth,
  async (req, res): Promise<void> => {
    const userId = req.dbUser!.id;
    const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const actorProfile = await resolveCharacterProfileActor(userId, req.header("x-character-profile-id"));

    const [member] = await db
      .select()
      .from(chatRoomMembersTable)
      .where(
        and(
          eq(chatRoomMembersTable.roomId, raw),
          eq(chatRoomMembersTable.userId, userId),
          or(eq(chatRoomMembersTable.profileId, actorProfile.id), isNull(chatRoomMembersTable.profileId)),
        ),
      );

    if (!member) {
      res.status(403).json({ error: "Not a member" });
      return;
    }

    const page = parseMessagePage(req.query as Record<string, unknown>);
    if (!page.ok) {
      res.status(400).json({ error: page.error });
      return;
    }

    const messages = await db
      .select()
      .from(messagesTable)
      .where(
        and(
          eq(messagesTable.roomId, raw),
          page.beforeSeq === null
            ? undefined
            : lt(messagesTable.roomSeq, page.beforeSeq),
          page.afterSeq === null
            ? undefined
            : gt(messagesTable.roomSeq, page.afterSeq),
          sql`NOT EXISTS (
          SELECT 1
          FROM message_deletions AS md
          WHERE md.message_id = ${messagesTable.id}
            AND md.user_id = ${userId}
        )`,
        ),
      )
      .orderBy(...(
        page.afterSeq === null
          ? [
              desc(messagesTable.roomSeq),
              desc(messagesTable.createdAt),
              desc(messagesTable.id),
            ]
          : [
              asc(messagesTable.roomSeq),
              asc(messagesTable.createdAt),
              asc(messagesTable.id),
            ]
      ))
      .limit(page.limit);

    const memberReadSeqs = await getRoomMemberReadSeqs(raw);
    const result = await serializeMessages(messages, userId, memberReadSeqs);

    // Latest/history pages are selected newest-first and reversed for display.
    // Catch-up pages are selected oldest-first so the client can advance the
    // roomSeq cursor without skipping a gap larger than one page.
    res.json(page.afterSeq === null ? result.reverse() : result);
  },
);

router.post(
  "/rooms/:id/messages",
  requireAuth,
  async (req, res): Promise<void> => {
    const userId = req.dbUser!.id;
    const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const actorProfile = await resolveCharacterProfileActor(userId, req.header("x-character-profile-id"));

    const [member] = await db
      .select()
      .from(chatRoomMembersTable)
      .where(
        and(
          eq(chatRoomMembersTable.roomId, raw),
          eq(chatRoomMembersTable.userId, userId),
          or(eq(chatRoomMembersTable.profileId, actorProfile.id), isNull(chatRoomMembersTable.profileId)),
        ),
      );

    if (!member) {
      res.status(403).json({ error: "Not a member" });
      return;
    }

    const parsed = validateUserMessage(req.body);
    if (!parsed.ok) {
      res.status(400).json({ error: parsed.error });
      return;
    }
    const input = parsed.value;

    if (input.replyToMessageId) {
      const [replyMessage] = await db
        .select({ id: messagesTable.id })
        .from(messagesTable)
        .where(
          and(
            eq(messagesTable.id, input.replyToMessageId),
            eq(messagesTable.roomId, raw),
          ),
        );
      if (!replyMessage) {
        res.status(400).json({ error: "reply target not in room" });
        return;
      }
    }

    // For non-text messages the content holds an opaque value (image object path,
    // sticker code, or file metadata), so room previews and push notifications
    // use a label.
    const preview = previewForMessage(input.type, input.content);
    const activeProfileId = actorProfile.id;
    const directRoom = await getDirectRoomPeer(raw, userId);
    if (directRoom.isDirect && !directRoom.peerId) {
      res.status(409).json({ error: "Invalid direct room membership" });
      return;
    }

    const createdResult = await db.transaction(async (tx) => {
      // The client key lock makes a retry safe even before the unique index is
      // present on every production replica during a rolling migration.
      if (input.clientMessageId) {
        await tx.execute(
          sql`SELECT pg_advisory_xact_lock(hashtext(${`message:${raw}:${userId}:${input.clientMessageId}`}))`,
        );
        const [existing] = await tx
          .select()
          .from(messagesTable)
          .where(
            and(
              eq(messagesTable.roomId, raw),
              eq(messagesTable.senderId, userId),
              eq(messagesTable.clientMessageId, input.clientMessageId),
            ),
          );
        if (existing) {
          return {
            message: existing,
            created: false,
            idempotencyConflict: !hasMatchingMessagePayload(existing, input),
            blocked: false,
          };
        }
      }

      if (
        directRoom.isDirect &&
        (await lockAndCheckDirectRoomBlock(tx, userId, directRoom.peerId))
      ) {
        return {
          message: null,
          created: false,
          idempotencyConflict: false,
          blocked: true,
        };
      }

      const roomSeq = await allocateRoomMessageSeq(tx, raw);
      const [created] = await tx
        .insert(messagesTable)
        .values({
          roomId: raw,
          senderId: userId,
          senderProfileId: activeProfileId,
          content: input.content,
          type: input.type,
          replyToMessageId: input.replyToMessageId,
          metadata: input.metadata,
          clientMessageId: input.clientMessageId,
          roomSeq,
        })
        .returning();

      await tx
        .update(chatRoomsTable)
        .set({ lastMessage: preview, lastMessageAt: new Date() })
        .where(eq(chatRoomsTable.id, raw));

      // A new message resurfaces the room for anyone who previously hid (left) it.
      await tx
        .update(chatRoomMembersTable)
        .set({ hiddenAt: null })
        .where(eq(chatRoomMembersTable.roomId, raw));

      // The sender has implicitly read their own message — advance their read marker
      // so it never counts as unread (prevents self-notifications across devices).
      await setMemberReadSeq(tx, raw, userId, { id: created.id, roomSeq });
      return {
        message: created,
        created: true,
        idempotencyConflict: false,
        blocked: false,
      };
    });

    if (createdResult.blocked) {
      res
        .status(403)
        .json({ error: "Blocked users cannot message each other" });
      return;
    }
    if (createdResult.idempotencyConflict) {
      res.status(409).json({
        error: "clientMessageId was already used for a different message",
      });
      return;
    }
    const message = createdResult.message!;

    const [[sender], [room]] = await Promise.all([
      db.select().from(usersTable).where(eq(usersTable.id, userId)),
      db
        .select({ type: chatRoomsTable.type })
        .from(chatRoomsTable)
        .where(eq(chatRoomsTable.id, raw)),
    ]);
    // Idempotent retries may return an older row that was not rendered
    // optimistically in this request. Hydrate those responses fully; the common
    // newly-created path only needs the lightweight acknowledgement above.
    const payload = createdResult.created
      ? serializeCreatedMessage(message, sender, actorProfile)
      : await serializeMessage(
          message,
          userId,
          await getRoomMemberReadSeqs(raw),
        );

    res.status(201).json(payload);

    // In a dungeon room, a player's text message is an in-game action: let the
    // AI Dungeon Master respond (fire-and-forget, serialized per room).
    if (
      createdResult.created &&
      room?.type === "dungeon" &&
      input.type === "text"
    ) {
      void runDungeonTurn(
        raw,
        { userId, name: sender?.nickname ?? "모험가", text: input.content },
        req.log,
      ).catch((err) =>
        req.log.error({ err, roomId: raw }, "Dungeon turn failed"),
      );
    }

    if (createdResult.created && input.type === "text") {
      void scheduleLinkPreview(
        raw,
        message.id,
        input.content,
        userId,
        req.log,
      ).catch((err) =>
        req.log.error(
          buildLinkPreviewRoomFailureLog(err, raw, message.id),
          "Failed to schedule link preview",
        ),
      );

      void enqueueChatKnowledgeCandidateFromMessage({
        messageId: message.id,
        roomId: raw,
        roomType: room?.type,
        senderUserId: userId,
        content: input.content,
        log: req.log,
      });
    }

    if (
      createdResult.created &&
      room?.type === "direct" &&
      input.type === "text"
    ) {
      void handleAnotherMeAfterUserMessage({
        roomId: raw,
        senderUserId: userId,
        content: input.content,
        log: req.log,
      }).catch((err) =>
        req.log.error(
          { err, roomId: raw, messageId: message.id },
          "DavaQ message hook failed",
        ),
      );
    }

    if (createdResult.created) {
      dispatchMessageRealtimeAndPush({
        roomId: raw,
        actorUserId: userId,
        message,
        sender,
        preview,
        log: req.log,
      });
    }
  },
);

router.post(
  "/rooms/:id/messages/:messageId/delete",
  requireAuth,
  async (req, res): Promise<void> => {
    const userId = req.dbUser!.id;
    const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const messageId = Array.isArray(req.params.messageId)
      ? req.params.messageId[0]
      : req.params.messageId;
    const scope = req.body?.scope ?? "me";

    if (scope !== "me" && scope !== "everyone") {
      res.status(400).json({ error: "invalid scope" });
      return;
    }

    const [member] = await db
      .select({ id: chatRoomMembersTable.id })
      .from(chatRoomMembersTable)
      .where(
        and(
          eq(chatRoomMembersTable.roomId, raw),
          eq(chatRoomMembersTable.userId, userId),
        ),
      );
    if (!member) {
      res.status(403).json({ error: "Not a member" });
      return;
    }

    const [message] = await db
      .select()
      .from(messagesTable)
      .where(
        and(eq(messagesTable.id, messageId), eq(messagesTable.roomId, raw)),
      );
    if (!message) {
      res.status(404).json({ error: "Message not found" });
      return;
    }

    if (scope === "everyone") {
      if (message.senderId !== userId) {
        res
          .status(403)
          .json({ error: "Only the sender can delete for everyone" });
        return;
      }
      await db.transaction(async (tx) => {
        await tx
          .update(messagesTable)
          .set({ deletedAt: new Date() })
          .where(
            and(eq(messagesTable.id, messageId), eq(messagesTable.roomId, raw)),
          );

        const [room] = await tx
          .select({
            lastMessageSeq: chatRoomsTable.lastMessageSeq,
            pinnedMessageId: chatRoomsTable.pinnedMessageId,
          })
          .from(chatRoomsTable)
          .where(eq(chatRoomsTable.id, raw));
        if (room?.pinnedMessageId === messageId) {
          await tx
            .update(chatRoomsTable)
            .set({ pinnedMessageId: null })
            .where(eq(chatRoomsTable.id, raw));
        }
        if (room?.lastMessageSeq === message.roomSeq) {
          await tx
            .update(chatRoomsTable)
            .set({ lastMessage: "삭제된 메시지", lastMessageAt: new Date() })
            .where(eq(chatRoomsTable.id, raw));
        }
      });

      void publishRoomRealtimeEvent(raw, userId, "message.updated", {
        messageId,
        scope,
      }).catch((err) =>
        req.log.error(
          { err, roomId: raw, messageId },
          "Failed to publish delete realtime event",
        ),
      );
      void publishRoomRealtimeEvent(raw, userId, "room.updated", {
        messageId,
      }).catch((err) =>
        req.log.error(
          { err, roomId: raw, messageId },
          "Failed to publish room realtime event",
        ),
      );
      res.sendStatus(204);
      return;
    }

    await db
      .insert(messageDeletionsTable)
      .values({ messageId, userId })
      .onConflictDoNothing();
    void publishRealtimeEvent({
      type: "message.updated",
      roomId: raw,
      actorUserId: userId,
      userIds: [userId],
      data: { messageId, scope },
    }).catch((err) =>
      req.log.error(
        { err, roomId: raw, messageId },
        "Failed to publish personal delete realtime event",
      ),
    );
    res.sendStatus(204);
  },
);

router.post("/rooms/:id/pin", requireAuth, async (req, res): Promise<void> => {
  const userId = req.dbUser!.id;
  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const { messageId } = req.body ?? {};

  if (typeof messageId !== "string") {
    res.status(400).json({ error: "messageId required" });
    return;
  }

  const [member] = await db
    .select({ id: chatRoomMembersTable.id })
    .from(chatRoomMembersTable)
    .where(
      and(
        eq(chatRoomMembersTable.roomId, raw),
        eq(chatRoomMembersTable.userId, userId),
      ),
    );
  if (!member) {
    res.status(403).json({ error: "Not a member" });
    return;
  }

  const [message] = await db
    .select({ id: messagesTable.id, deletedAt: messagesTable.deletedAt })
    .from(messagesTable)
    .where(and(eq(messagesTable.id, messageId), eq(messagesTable.roomId, raw)));
  if (!message || message.deletedAt) {
    res.status(404).json({ error: "Message not found" });
    return;
  }

  await db
    .update(chatRoomsTable)
    .set({ pinnedMessageId: messageId })
    .where(eq(chatRoomsTable.id, raw));
  void publishRoomRealtimeEvent(raw, userId, "room.updated", {
    pinnedMessageId: messageId,
  }).catch((err) =>
    req.log.error(
      { err, roomId: raw, messageId },
      "Failed to publish pin realtime event",
    ),
  );
  res.sendStatus(204);
});

router.delete(
  "/rooms/:id/pin",
  requireAuth,
  async (req, res): Promise<void> => {
    const userId = req.dbUser!.id;
    const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;

    const [member] = await db
      .select({ id: chatRoomMembersTable.id })
      .from(chatRoomMembersTable)
      .where(
        and(
          eq(chatRoomMembersTable.roomId, raw),
          eq(chatRoomMembersTable.userId, userId),
        ),
      );
    if (!member) {
      res.status(403).json({ error: "Not a member" });
      return;
    }

    await db
      .update(chatRoomsTable)
      .set({ pinnedMessageId: null })
      .where(eq(chatRoomsTable.id, raw));
    void publishRoomRealtimeEvent(raw, userId, "room.updated", {
      pinnedMessageId: null,
    }).catch((err) =>
      req.log.error(
        { err, roomId: raw },
        "Failed to publish unpin realtime event",
      ),
    );
    res.sendStatus(204);
  },
);

router.post(
  "/rooms/:id/messages/:messageId/forward",
  requireAuth,
  async (req, res): Promise<void> => {
    const userId = req.dbUser!.id;
    const sourceRoomId = Array.isArray(req.params.id)
      ? req.params.id[0]
      : req.params.id;
    const messageId = Array.isArray(req.params.messageId)
      ? req.params.messageId[0]
      : req.params.messageId;
    const { targetRoomId, clientMessageId: rawClientMessageId } =
      req.body ?? {};

    if (typeof targetRoomId !== "string") {
      res.status(400).json({ error: "targetRoomId required" });
      return;
    }
    const clientMessageId = validateClientMessageId(rawClientMessageId);
    if (clientMessageId === undefined) {
      res.status(400).json({ error: "invalid clientMessageId" });
      return;
    }

    const [sourceMember, targetMember] = await Promise.all([
      db
        .select({ id: chatRoomMembersTable.id })
        .from(chatRoomMembersTable)
        .where(
          and(
            eq(chatRoomMembersTable.roomId, sourceRoomId),
            eq(chatRoomMembersTable.userId, userId),
          ),
        ),
      db
        .select({ id: chatRoomMembersTable.id })
        .from(chatRoomMembersTable)
        .where(
          and(
            eq(chatRoomMembersTable.roomId, targetRoomId),
            eq(chatRoomMembersTable.userId, userId),
          ),
        ),
    ]);
    if (!sourceMember[0] || !targetMember[0]) {
      res.status(403).json({ error: "Not a member" });
      return;
    }

    const [source] = await db
      .select()
      .from(messagesTable)
      .where(
        and(
          eq(messagesTable.id, messageId),
          eq(messagesTable.roomId, sourceRoomId),
        ),
      );
    if (!source || source.deletedAt || !FORWARDABLE_TYPES.has(source.type)) {
      res.status(404).json({ error: "Message not found" });
      return;
    }
    const [deletedForMe] = await db
      .select({ id: messageDeletionsTable.id })
      .from(messageDeletionsTable)
      .where(
        and(
          eq(messageDeletionsTable.messageId, messageId),
          eq(messageDeletionsTable.userId, userId),
        ),
      );
    if (deletedForMe) {
      res.status(404).json({ error: "Message not found" });
      return;
    }

    const forwarded = validateUserMessage({
      content: source.content,
      type: source.type,
      replyToMessageId: null,
      metadata: null,
      clientMessageId,
    });
    if (!forwarded.ok) {
      res.status(400).json({ error: "Message cannot be forwarded" });
      return;
    }

    const preview = previewForMessage(
      forwarded.value.type,
      forwarded.value.content,
    );
    const activeProfileId = (await ensureCharacterProfileState(userId)).activeProfile.id;
    const directRoom = await getDirectRoomPeer(targetRoomId, userId);
    if (directRoom.isDirect && !directRoom.peerId) {
      res.status(409).json({ error: "Invalid direct room membership" });
      return;
    }

    const createdResult = await db.transaction(async (tx) => {
      if (forwarded.value.clientMessageId) {
        await tx.execute(
          sql`SELECT pg_advisory_xact_lock(hashtext(${`message:${targetRoomId}:${userId}:${forwarded.value.clientMessageId}`}))`,
        );
        const [existing] = await tx
          .select()
          .from(messagesTable)
          .where(
            and(
              eq(messagesTable.roomId, targetRoomId),
              eq(messagesTable.senderId, userId),
              eq(
                messagesTable.clientMessageId,
                forwarded.value.clientMessageId,
              ),
            ),
          );
        if (existing) {
          return {
            message: existing,
            created: false,
            idempotencyConflict: !hasMatchingMessagePayload(
              existing,
              forwarded.value,
            ),
            blocked: false,
          };
        }
      }

      if (
        directRoom.isDirect &&
        (await lockAndCheckDirectRoomBlock(tx, userId, directRoom.peerId))
      ) {
        return {
          message: null,
          created: false,
          idempotencyConflict: false,
          blocked: true,
        };
      }

      const roomSeq = await allocateRoomMessageSeq(tx, targetRoomId);
      const [created] = await tx
        .insert(messagesTable)
        .values({
          roomId: targetRoomId,
          senderId: userId,
          senderProfileId: activeProfileId,
          content: forwarded.value.content,
          type: forwarded.value.type,
          clientMessageId: forwarded.value.clientMessageId,
          roomSeq,
        })
        .returning();
      await tx
        .update(chatRoomsTable)
        .set({ lastMessage: preview, lastMessageAt: new Date() })
        .where(eq(chatRoomsTable.id, targetRoomId));
      await tx
        .update(chatRoomMembersTable)
        .set({ hiddenAt: null })
        .where(eq(chatRoomMembersTable.roomId, targetRoomId));
      await setMemberReadSeq(tx, targetRoomId, userId, {
        id: created.id,
        roomSeq,
      });
      return {
        message: created,
        created: true,
        idempotencyConflict: false,
        blocked: false,
      };
    });

    if (createdResult.blocked) {
      res
        .status(403)
        .json({ error: "Blocked users cannot message each other" });
      return;
    }
    if (createdResult.idempotencyConflict) {
      res.status(409).json({
        error: "clientMessageId was already used for a different message",
      });
      return;
    }
    const message = createdResult.message!;

    const [sender] = await db
      .select()
      .from(usersTable)
      .where(eq(usersTable.id, userId));
    const memberReadSeqs = await getRoomMemberReadSeqs(targetRoomId);
    const payload = await serializeMessage(message, userId, memberReadSeqs);
    res.status(201).json(payload);

    if (createdResult.created && forwarded.value.type === "text") {
      void scheduleLinkPreview(
        targetRoomId,
        message.id,
        forwarded.value.content,
        userId,
        req.log,
      ).catch((err) =>
        req.log.error(
          buildLinkPreviewRoomFailureLog(err, targetRoomId, message.id),
          "Failed to schedule forwarded link preview",
        ),
      );
    }
    if (createdResult.created) {
      dispatchMessageRealtimeAndPush({
        roomId: targetRoomId,
        actorUserId: userId,
        message,
        sender,
        preview,
        log: req.log,
      });
    }
  },
);

router.post(
  "/rooms/:id/messages/:messageId/sticker",
  requireAuth,
  async (req, res): Promise<void> => {
    const userId = req.dbUser!.id;
    const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const messageId = Array.isArray(req.params.messageId)
      ? req.params.messageId[0]
      : req.params.messageId;
    const { code } = req.body ?? {};

    if (typeof code !== "string" || !isValidStickerCode(code)) {
      res.status(400).json({ error: "invalid sticker" });
      return;
    }

    const [member] = await db
      .select({ id: chatRoomMembersTable.id })
      .from(chatRoomMembersTable)
      .where(
        and(
          eq(chatRoomMembersTable.roomId, raw),
          eq(chatRoomMembersTable.userId, userId),
        ),
      );
    if (!member) {
      res.status(403).json({ error: "Not a member" });
      return;
    }

    const [message] = await db
      .select({ id: messagesTable.id, deletedAt: messagesTable.deletedAt })
      .from(messagesTable)
      .where(
        and(eq(messagesTable.id, messageId), eq(messagesTable.roomId, raw)),
      );
    if (!message || message.deletedAt) {
      res.status(404).json({ error: "Message not found" });
      return;
    }

    const now = new Date();
    await db
      .insert(messageStickersTable)
      .values({ messageId, userId, code, createdAt: now })
      .onConflictDoUpdate({
        target: [messageStickersTable.messageId, messageStickersTable.userId],
        set: { code, createdAt: now },
      });
    void publishRoomRealtimeEvent(raw, userId, "message.updated", {
      messageId,
    }).catch((err) =>
      req.log.error(
        { err, roomId: raw, messageId },
        "Failed to publish sticker realtime event",
      ),
    );
    res.sendStatus(204);
  },
);

router.patch(
  "/rooms/:id/read",
  requireAuth,
  async (req, res): Promise<void> => {
    const userId = req.dbUser!.id;
    const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const { messageId } = req.body;
    if (!messageId) {
      res.status(400).json({ error: "messageId required" });
      return;
    }

    const [member] = await db
      .select({ id: chatRoomMembersTable.id })
      .from(chatRoomMembersTable)
      .where(
        and(
          eq(chatRoomMembersTable.roomId, raw),
          eq(chatRoomMembersTable.userId, userId),
        ),
      );
    if (!member) {
      res.status(403).json({ error: "Not a member" });
      return;
    }

    // The read marker must point at a message that actually belongs to this room,
    // otherwise a cross-room id would corrupt readCount computation elsewhere.
    const target = await getMessageReadTarget(raw, messageId);
    if (!target) {
      res.status(400).json({ error: "messageId not in room" });
      return;
    }

    // Monotonic advance only — a stale poll cycle must never regress the pointer.
    const changed = await advanceReadPointer(raw, userId, target);
    if (changed)
      void publishRoomRealtimeEvent(raw, userId, "message.read", {
        messageId,
        lastReadSeq: target.roomSeq,
      }).catch((err) =>
        req.log.error(
          { err, roomId: raw, messageId },
          "Failed to publish read realtime event",
        ),
      );
    res.sendStatus(204);
  },
);

router.post(
  "/rooms/:id/typing",
  requireAuth,
  async (req, res): Promise<void> => {
    const userId = req.dbUser!.id;
    const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;

    const [member] = await db
      .select()
      .from(chatRoomMembersTable)
      .where(
        and(
          eq(chatRoomMembersTable.roomId, raw),
          eq(chatRoomMembersTable.userId, userId),
        ),
      );

    if (!member) {
      res.status(403).json({ error: "Not a member" });
      return;
    }

    await markTyping(raw, userId);

    // Typing is only a presence/UX signal. Do not advance read receipts here:
    // an AI/persona reply or background composer heartbeat must never make the
    // other side look like they read messages they did not actually open.
    // Do not echo typing back to the actor. The old echo caused the sender to
    // invalidate and GET the same typing list on every heartbeat, even though
    // that endpoint deliberately excludes the current user.
    void (async () => {
      const recipients = await getRoomDeliveryRecipients(raw, userId);
      const userIds = recipients.realtimeUserIds.filter((id) => id !== userId);
      if (userIds.length === 0) return;
      await publishRealtimeEvent({
        type: "typing.updated",
        roomId: raw,
        actorUserId: userId,
        userIds,
        data: { expiresAt: new Date(Date.now() + 5_000).toISOString() },
      });
    })().catch((err) =>
      req.log.error({ err, roomId: raw }, "Failed to publish typing realtime event"),
    );
    res.sendStatus(204);
  },
);

router.get(
  "/rooms/:id/typing",
  requireAuth,
  async (req, res): Promise<void> => {
    const userId = req.dbUser!.id;
    const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;

    const [member] = await db
      .select()
      .from(chatRoomMembersTable)
      .where(
        and(
          eq(chatRoomMembersTable.roomId, raw),
          eq(chatRoomMembersTable.userId, userId),
        ),
      );

    if (!member) {
      res.status(403).json({ error: "Not a member" });
      return;
    }

    const ids = await getTypingUserIds(raw, userId);
    if (ids.length === 0) {
      res.json([]);
      return;
    }

    const users = await db
      .select()
      .from(usersTable)
      .where(inArray(usersTable.id, ids));
    res.json(
      users.map((u) => ({
        id: u.id,
        nickname: u.nickname,
        accountKind: publicAccountKind(u),
        profileImageUrl: null,
        statusMessage: u.statusMessage ?? null,
      })),
    );
  },
);

export default router;
