import { sql } from "drizzle-orm";
import {
  pgTable,
  uuid,
  text,
  timestamp,
  uniqueIndex,
  primaryKey,
} from "drizzle-orm/pg-core";
import { usersTable } from "./users";
import { chatRoomsTable } from "./chat";
export const groupCallsTable = pgTable(
  "davaq_group_calls",
  {
    id: uuid("id").primaryKey(),
    roomId: uuid("room_id")
      .notNull()
      .references(() => chatRoomsTable.id, { onDelete: "cascade" }),
    creatorId: uuid("creator_id")
      .notNull()
      .references(() => usersTable.id),
    roomName: text("room_name").notNull(),
    media: text("media").notNull(),
    status: text("status").notNull().default("active"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    endedAt: timestamp("ended_at", { withTimezone: true }),
    roomTerminatedAt: timestamp("room_terminated_at", { withTimezone: true }),
  },
  (t) => [
    uniqueIndex("davaq_group_call_active_room_idx")
      .on(t.roomId)
      .where(sql`${t.status} = 'active'`),
  ],
);
export const groupCallParticipantsTable = pgTable(
  "davaq_group_call_participants",
  {
    callId: uuid("call_id")
      .notNull()
      .references(() => groupCallsTable.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    state: text("state").notNull().default("invited"),
    joinedAt: timestamp("joined_at", { withTimezone: true }),
    heartbeatAt: timestamp("heartbeat_at", { withTimezone: true }),
  },
  (t) => [
    primaryKey({ columns: [t.callId, t.userId] }),
    uniqueIndex("davaq_group_call_joined_user_idx")
      .on(t.userId)
      .where(sql`${t.state} = 'joined'`),
  ],
);
