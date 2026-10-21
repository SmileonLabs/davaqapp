import { sql } from "drizzle-orm";
import {
  bigint,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { chatRoomsTable } from "./chat";

export const chatSyncRoomsTable = pgTable("chat_sync_rooms", {
  roomId: uuid("room_id")
    .primaryKey()
    .references(() => chatRoomsTable.id, { onDelete: "cascade" }),
  revision: bigint("revision", { mode: "bigint" }).notNull().default(0n),
});
export const chatChangesTable = pgTable(
  "chat_changes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    roomId: uuid("room_id")
      .notNull()
      .references(() => chatRoomsTable.id, { onDelete: "cascade" }),
    revision: bigint("revision", { mode: "bigint" }).notNull(),
    kind: text("kind").notNull(),
    messageId: uuid("message_id"),
    actorUserId: uuid("actor_user_id"),
    audienceUserId: uuid("audience_user_id"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("chat_changes_room_id_revision_key").on(t.roomId, t.revision),
  ],
);
export const chatDeliveryOutboxTable = pgTable(
  "chat_delivery_outbox",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    dedupeKey: text("dedupe_key").notNull().unique(),
    roomId: uuid("room_id")
      .notNull()
      .references(() => chatRoomsTable.id, { onDelete: "cascade" }),
    actorUserId: uuid("actor_user_id"),
    audienceUserId: uuid("audience_user_id"),
    channel: text("channel").notNull(),
    payload: jsonb("payload").notNull().$type<Record<string, unknown>>(),
    attempts: integer("attempts").notNull().default(0),
    availableAt: timestamp("available_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    leaseUntil: timestamp("lease_until", { withTimezone: true }),
    claimToken: uuid("claim_token"),
    deliveredAt: timestamp("delivered_at", { withTimezone: true }),
    lastError: text("last_error"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    check(
      "chat_delivery_outbox_channel_check",
      sql`${t.channel} IN ('realtime', 'push')`,
    ),
    index("chat_delivery_outbox_pending_idx")
      .on(t.availableAt, t.createdAt)
      .where(sql`${t.deliveredAt} IS NULL`),
  ],
);
