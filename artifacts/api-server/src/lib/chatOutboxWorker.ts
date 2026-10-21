import {
  pool,
  db,
  chatRoomMembersTable,
  messagesTable,
  messageDeletionsTable,
} from "@workspace/db";
import { and, eq, inArray } from "drizzle-orm";
import { getRoomDeliveryRecipients } from "./chatDelivery";
import { publishRealtimeEvent, type RealtimeEvent } from "./realtime";
import { sendPushToUsers, type PushPayload } from "./push";
import { logger } from "./logger";
import { deliverOneChatJob, type ChatDeliveryJob } from "./chatOutboxStore";

export async function deliverChatJob(job: ChatDeliveryJob) {
  const members = await db
    .select({
      userId: chatRoomMembersTable.userId,
      lastReadSeq: chatRoomMembersTable.lastReadSeq,
    })
    .from(chatRoomMembersTable)
    .where(eq(chatRoomMembersTable.roomId, job.room_id));
  const memberIds = new Set(members.map((m) => m.userId));
  const recipients =
    job.actor_user_id && memberIds.has(job.actor_user_id)
      ? await getRoomDeliveryRecipients(job.room_id, job.actor_user_id)
      : { realtimeUserIds: [...memberIds], pushUserIds: [] };
  if (job.channel === "realtime") {
    const userIds = job.audience_user_id
      ? [...memberIds].filter((id) => id === job.audience_user_id)
      : recipients.realtimeUserIds;
    await publishRealtimeEvent(
      {
        ...(job.payload as Omit<RealtimeEvent, "createdAt" | "userIds">),
        userIds,
      },
      { durable: true },
    );
    return;
  }
  // Do not notify about a message deleted while its job was delayed.
  const [message] = await db
    .select()
    .from(messagesTable)
    .where(
      and(
        eq(messagesTable.id, String(job.payload.data?.messageId)),
        eq(messagesTable.roomId, job.room_id),
      ),
    );
  if (!message || message.deletedAt) return;
  const ids = job.audience_user_id
    ? recipients.pushUserIds.filter((id) => id === job.audience_user_id)
    : recipients.pushUserIds;
  const unreadIds = ids.filter(
    (id) =>
      (members.find((m) => m.userId === id)?.lastReadSeq ?? 0) <
      message.roomSeq,
  );
  if (unreadIds.length === 0) return;
  const deletions = await db
    .select({ userId: messageDeletionsTable.userId })
    .from(messageDeletionsTable)
    .where(
      and(
        eq(messageDeletionsTable.messageId, message.id),
        inArray(messageDeletionsTable.userId, unreadIds),
      ),
    );
  const hidden = new Set(deletions.map((row) => row.userId));
  await sendPushToUsers(
    unreadIds.filter((id) => !hidden.has(id)),
    job.payload as PushPayload,
    { strict: true },
  );
}
export function startChatOutboxWorker(): () => void {
  const running = new Set<"realtime" | "push">();
  let stopped = false;
  const tick = async (channel: "realtime" | "push") => {
    if (running.has(channel) || stopped) return;
    running.add(channel);
    try {
      for (let i = 0; i < 20 && !stopped; i++) {
        if (
          !(await deliverOneChatJob(
            pool,
            async (job) => {
              try {
                await deliverChatJob(job);
              } catch (err) {
                logger.warn(
                  {
                    jobId: job.id,
                    channel: job.channel,
                    attempt: job.attempts,
                  },
                  "Chat delivery will retry",
                );
                throw err;
              }
            },
            30_000,
            channel,
          ))
        )
          break;
      }
    } catch (err) {
      logger.error(
        { err },
        "Chat outbox worker failed; durable jobs remain pending",
      );
    } finally {
      running.delete(channel);
    }
  };
  const runBoth = () => {
    void tick("realtime");
    void tick("push");
  };
  const timer = setInterval(runBoth, 1_000);
  timer.unref();
  runBoth();
  return () => {
    stopped = true;
    clearInterval(timer);
  };
}
