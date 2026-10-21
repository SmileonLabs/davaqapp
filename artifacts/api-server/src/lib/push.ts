import { sendApplePushToUser } from "./applePush";
import webpush, { type PushSubscription } from "web-push";
import { asc, eq, inArray, isNotNull, or, sql } from "drizzle-orm";
import { db, usersTable } from "@workspace/db";
import { logger } from "./logger";
import {
  addFcmToken,
  removeFcmToken,
  sendFcmCallToUser,
  sendFcmNotificationToUser,
} from "./fcm";
import {
  rebindExclusiveDevice,
  removeOwnedDevice,
} from "./pushOwnershipPolicy";
import { buildPushFailureLog } from "./pushLogging";

const publicKey = process.env.VAPID_PUBLIC_KEY;
const privateKey = process.env.VAPID_PRIVATE_KEY;
const subject = process.env.VAPID_SUBJECT || "mailto:support@todotalk.app";

let configured = false;
if (publicKey && privateKey) {
  webpush.setVapidDetails(subject, publicKey, privateKey);
  configured = true;
} else {
  logger.warn("VAPID keys not set — web push disabled");
}

/** Max distinct device subscriptions kept per user. */
const MAX_DEVICES = 10;

export interface PushPayload {
  title: string;
  body: string;
  url?: string;
  tag?: string;
  /** When "call", the service worker keeps the banner up even while focused. */
  type?: string;
  /**
   * Structured payload the service worker forwards to the app on notification
   * tap. For incoming calls: { type:"incoming_call", callId, chatRoomId,
   * callerUserId, callerName, media } so the client can open the ringing/
   * incoming screen directly.
   */
  data?: Record<string, unknown>;
}

function roomIdFromChatUrl(url: string | undefined): string | null {
  if (!url) return null;
  const match = url.match(/^\/chat\/([^/?#]+)/);
  return match ? decodeURIComponent(match[1]) : null;
}

function fcmNotificationData(payload: PushPayload): Record<string, string> | undefined {
  const data: Record<string, string> = {};
  for (const [key, value] of Object.entries(payload.data ?? {})) {
    if (typeof value === "string" || typeof value === "number") data[key] = String(value);
  }
  if (payload.url) data.url = payload.url;
  if (payload.tag) data.tag = payload.tag;
  const roomId = roomIdFromChatUrl(payload.url);
  if (roomId) data.roomId = roomId;
  return Object.keys(data).length > 0 ? data : undefined;
}

function isValidSubscription(obj: unknown): obj is PushSubscription {
  const sub = obj as PushSubscription | null;
  return (
    !!sub &&
    typeof sub.endpoint === "string" &&
    !!sub.keys?.p256dh &&
    !!sub.keys?.auth
  );
}

/**
 * Parse the stored push token into a list of subscriptions. Supports both the
 * current multi-device array format and the legacy single-object format so old
 * rows keep working without a migration.
 */
export function parseSubscriptions(raw: string | null | undefined): PushSubscription[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return parsed.filter(isValidSubscription);
    }
    if (isValidSubscription(parsed)) return [parsed];
  } catch {
    // not JSON (legacy opaque token) — nothing to send to
  }
  return [];
}

function serializeSubscriptions(subs: PushSubscription[]): string | null {
  return subs.length > 0 ? JSON.stringify(subs) : null;
}

/**
 * Register a device subscription for a user. Merges the incoming subscription
 * into the user's device list (deduped by endpoint), capped to MAX_DEVICES.
 * Runs in a row-locked transaction so concurrent registrations from different
 * devices don't clobber each other.
 */
export async function addSubscription(userId: string, rawToken: string): Promise<void> {
  let incoming: PushSubscription | null = null;
  try {
    const parsed = JSON.parse(rawToken);
    if (isValidSubscription(parsed)) incoming = parsed;
  } catch {
    incoming = null;
  }
  if (!incoming) {
    // Not a valid web-push subscription. The mobile app registers a raw native
    // FCM device token here (an opaque string, not a subscription object), so
    // route it to native FCM storage instead of dropping it.
    await addFcmToken(userId, rawToken);
    return;
  }
  const sub = incoming;
  await db.transaction(async (tx) => {
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${`web-push:${sub.endpoint}`}, 0))`,
    );
    const candidateRows = await tx
      .select({ id: usersTable.id, pushToken: usersTable.pushToken })
      .from(usersTable)
      .where(or(eq(usersTable.id, userId), isNotNull(usersTable.pushToken)));
    const affectedIds = Array.from(
      new Set([
        userId,
        ...candidateRows
          .filter((row) =>
            parseSubscriptions(row.pushToken).some(
              (candidate) => candidate.endpoint === sub.endpoint,
            ),
          )
          .map((row) => row.id),
      ]),
    ).sort();
    const locked = await tx
      .select({ id: usersTable.id, pushToken: usersTable.pushToken })
      .from(usersTable)
      .where(inArray(usersTable.id, affectedIds))
      .orderBy(asc(usersTable.id))
      .for("update");
    if (!locked.some((row) => row.id === userId)) return;
    const updates = rebindExclusiveDevice(
      locked.map((row) => ({
        userId: row.id,
        values: parseSubscriptions(row.pushToken),
      })),
      userId,
      sub,
      (value) => value.endpoint,
      MAX_DEVICES,
    );
    for (const [ownerId, subscriptions] of updates) {
      await tx
        .update(usersTable)
        .set({ pushToken: serializeSubscriptions(subscriptions) })
        .where(eq(usersTable.id, ownerId));
    }
  });
}

/** Remove one device credential from only the authenticated owner. */
export async function removeSubscription(userId: string, rawToken: string): Promise<void> {
  let incoming: PushSubscription | null = null;
  try {
    const parsed = JSON.parse(rawToken);
    if (isValidSubscription(parsed)) incoming = parsed;
  } catch {
    incoming = null;
  }
  if (!incoming) {
    await removeFcmToken(userId, rawToken);
    return;
  }

  const endpoint = incoming.endpoint;
  await db.transaction(async (tx) => {
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${`web-push:${endpoint}`}, 0))`,
    );
    const [row] = await tx
      .select({ pushToken: usersTable.pushToken })
      .from(usersTable)
      .where(eq(usersTable.id, userId))
      .for("update");
    if (!row) return;
    const remaining = removeOwnedDevice(
      parseSubscriptions(row.pushToken),
      endpoint,
      (value) => value.endpoint,
    );
    await tx
      .update(usersTable)
      .set({ pushToken: serializeSubscriptions(remaining) })
      .where(eq(usersTable.id, userId));
  });
}

/**
 * Remove specific (stale) endpoints from a user's device list, row-locked so it
 * doesn't drop a device that was concurrently registered.
 */
async function removeEndpoints(userId: string, staleEndpoints: Set<string>): Promise<void> {
  if (staleEndpoints.size === 0) return;
  try {
    await db.transaction(async (tx) => {
      const [row] = await tx
        .select({ pushToken: usersTable.pushToken })
        .from(usersTable)
        .where(eq(usersTable.id, userId))
        .for("update");
      if (!row) return;
      const remaining = parseSubscriptions(row.pushToken).filter(
        (s) => !staleEndpoints.has(s.endpoint),
      );
      await tx
        .update(usersTable)
        .set({ pushToken: serializeSubscriptions(remaining) })
        .where(eq(usersTable.id, userId));
    });
  } catch (err) {
    logger.error(
      { ...buildPushFailureLog(err), userId },
      "Failed to prune stale push subscriptions",
    );
  }
}

/**
 * Send a web push notification to all of a user's devices. Best-effort: never
 * throws. Respects notificationEnabled and prunes stale (404/410) subscriptions.
 */
export async function sendPushToUser(
  userId: string,
  payload: PushPayload,
  opts: { force?: boolean; strict?: boolean } = {},
): Promise<void> {
  try {
    const [user] = await db.select().from(usersTable).where(eq(usersTable.id, userId));
    if (!user) return;
    // Voice-call pushes (force) must fire even when the user disabled
    // notifications — an incoming call is too important to silently drop.
    if (!opts.force && !user.notificationEnabled) return;

    // Native (Android FCM) and web push are independent delivery channels — a
    // user can have either or both — so fire each on its own. Native is NOT
    // gated on VAPID being configured (the two have separate credentials).
    // Skip the call type: incoming calls have their own data-only full-screen
    // native path in sendCallPush (sendFcmCallToUser), so sending a tray
    // notification here too would double-notify native devices.
    let nativeFailed = false;
    if (payload.type !== "call") {
      const deliveryOptions: [] | [{ strict: true }] = opts.strict ? [{ strict: true }] : [];
      const nativeResults = await Promise.allSettled([
        sendApplePushToUser(userId, { title: payload.title, body: payload.body, data: fcmNotificationData(payload) }, ...deliveryOptions),
        sendFcmNotificationToUser(userId, {
        title: payload.title,
        body: payload.body,
        tag: payload.tag,
        data: fcmNotificationData(payload),
        }, ...deliveryOptions),
      ]);
      nativeFailed = nativeResults.some(result => result.status === "rejected");
    }

    // Web push (VAPID). Only runs when VAPID keys are configured.
    if (!configured) {
      if (opts.strict && (nativeFailed || parseSubscriptions(user.pushToken ?? null).length > 0)) throw new Error("Push provider unavailable");
      return;
    }
    const subscriptions = parseSubscriptions(user.pushToken ?? null);
    if (subscriptions.length === 0) {
      if (opts.strict && nativeFailed) throw new Error("Native push delivery failed");
      return;
    }

    // The service worker validates this server-owned recipient against the
    // locally active account before displaying anything. Never trust a caller
    // supplied value for this ownership fence.
    const body = JSON.stringify({ ...payload, recipientUserId: userId });
    const stale = new Set<string>();
    let failed = false;
    await Promise.allSettled(
      subscriptions.map(async (sub) => {
        try {
          await webpush.sendNotification(sub, body, { timeout: 10_000 });
        } catch (err: unknown) {
          const statusCode = (err as { statusCode?: number })?.statusCode;
          if (statusCode === 404 || statusCode === 410) {
            stale.add(sub.endpoint);
          } else {
            failed = true;
            logger.error(
              { ...buildPushFailureLog(err), userId },
              "Failed to send web push to a device",
            );
          }
        }
      }),
    );
    await removeEndpoints(userId, stale);
    if (opts.strict && (failed || nativeFailed)) throw new Error("Push delivery failed");
  } catch (err) {
    logger.error(
      { ...buildPushFailureLog(err), userId },
      "Failed to send push",
    );
    if (opts.strict) throw err;
  }
}

/** Send the same notification to multiple users concurrently (best-effort). */
export async function sendPushToUsers(userIds: string[], payload: PushPayload, opts: { strict?: boolean } = {}): Promise<void> {
  const results = await Promise.allSettled(userIds.map((id) => sendPushToUser(id, payload, opts)));
  if (opts.strict && results.some(result => result.status === "rejected")) throw new Error("Push delivery failed");
}

/**
 * Send a voice-call push. Unlike regular notifications these ALWAYS fire: they
 * ignore the user's notificationEnabled toggle (force) and, via data.type="call",
 * tell the service worker to keep the OS banner up even when the app is focused.
 */
export async function sendCallPush(
  userId: string,
  payload: Omit<PushPayload, "type">,
): Promise<void> {
  // Start all transports independently: a slow web endpoint must not delay
  // the iPhone/Android ringtone until the server's ringing window expires.
  const data = payload.data ?? {};
  await Promise.allSettled([
    sendPushToUser(userId, { ...payload, type: "call" }, { force: true }),
    sendApplePushToUser(userId, { title: payload.title, body: payload.body, data }),
    sendFcmCallToUser(userId, {
    title: payload.title,
    body: payload.body,
    tag: payload.tag,
    data: {
      type: typeof data.type === "string" ? data.type : "incoming_call",
      callId: typeof data.callId === "string" ? data.callId : "",
      chatRoomId: typeof data.chatRoomId === "string" ? data.chatRoomId : "",
      callerUserId: typeof data.callerUserId === "string" ? data.callerUserId : "",
      media: data.media === "video" ? "video" : "audio",
      callerName: typeof data.callerName === "string" ? data.callerName : payload.title,
      ...(typeof data.expiresAt === "number" ? { expiresAt: String(data.expiresAt) } : {}),
    },
    }),
  ]);
}

/**
 * Terminal call events are native data messages only. They let killed Android
 * clients stop a full-screen ringing notification without creating a new tray
 * notification or waking the web push call UI.
 */
export async function sendCallTerminalPush(
  userIds: string[],
  data: {
    callId: string;
    status: "ended" | "declined" | "missed" | "cancelled" | "failed";
    chatRoomId: string | null;
    media: "audio" | "video";
  },
): Promise<void> {
  await Promise.allSettled(
    Array.from(new Set(userIds)).map(async (userId) => {
      await Promise.allSettled([
        sendApplePushToUser(userId, { title: "통화 종료", body: "", data: { ...data, type: `call_${data.status}` } }),
        sendFcmCallToUser(userId, {
        title: "통화 종료",
        body: "통화가 종료되었습니다.",
        tag: `call-${data.callId}`,
        data: {
          type: `call_${data.status}`,
          status: data.status,
          callId: data.callId,
          chatRoomId: data.chatRoomId ?? "",
          media: data.media,
        },
        }),
      ]);
    }),
  );
}

/** Build the structured data payload for an incoming-call push. */
export function incomingCallData(args: {
  expiresAt?: number;
  callId: string;
  chatRoomId: string | null;
  callerUserId: string;
  callerName?: string;
  media?: "audio" | "video";
}): Record<string, unknown> {
  return {
    type: "incoming_call",
    ...(args.expiresAt !== undefined ? { expiresAt: args.expiresAt } : {}),
    callId: args.callId,
    chatRoomId: args.chatRoomId,
    callerUserId: args.callerUserId,
    callerName: args.callerName,
    media: args.media ?? "audio",
  };
}
