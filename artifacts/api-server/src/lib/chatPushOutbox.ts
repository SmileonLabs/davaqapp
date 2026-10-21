import { sql } from "drizzle-orm";
import type { db } from "@workspace/db";

// One durable job per recipient: a failing device/account does not retry peers.
export async function enqueueMessagePush(
  tx: Pick<typeof db, "execute">,
  message: {
    id: string;
    roomId: string;
    senderId: string;
    roomSeq: number;
    createdAt: Date;
  },
  title: string,
  preview: string,
): Promise<void> {
  const payload = JSON.stringify({
    title,
    body: preview.length > 80 ? `${preview.slice(0, 80)}...` : preview,
    url: `/chat/${message.roomId}`,
    tag: `room-${message.roomId}`,
    data: {
      type: "chat_message",
      messageId: message.id,
      messageSeq: message.roomSeq,
      messageCreatedAt: message.createdAt.toISOString(),
    },
  });
  await tx.execute(sql`INSERT INTO chat_delivery_outbox
    (dedupe_key, room_id, actor_user_id, audience_user_id, channel, payload)
    SELECT ${`push:${message.id}:`} || user_id::text, ${message.roomId}::uuid,
      ${message.senderId}::uuid, user_id, 'push', ${payload}::jsonb
    FROM chat_room_members WHERE room_id = ${message.roomId}::uuid
      AND user_id <> ${message.senderId}::uuid AND NOT muted
    ON CONFLICT(dedupe_key) DO NOTHING`);
}
