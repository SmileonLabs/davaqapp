import {
  boolean,
  date,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { chatRoomsTable } from "./chat";
import { usersTable } from "./users";
export const collectorLoungesTable = pgTable("collector_lounges", {
  roomId: uuid("room_id")
    .primaryKey()
    .references(() => chatRoomsTable.id, { onDelete: "cascade" }),
  slug: text("slug").notNull().unique(),
  paused: boolean("paused").notNull().default(true),
  nextAt: timestamp("next_at", { withTimezone: true }).notNull().defaultNow(),
  leaseToken: uuid("lease_token"),
  leaseUntil: timestamp("lease_until", { withTimezone: true }),
  lastProcessedSeq: integer("last_processed_seq").notNull().default(0),
  lastTopicAt: timestamp("last_topic_at", { withTimezone: true }),
  lastAiAt: timestamp("last_ai_at", { withTimezone: true }),
  episodeTurns: integer("episode_turns").notNull().default(4),
  topic: text("topic")
    .notNull()
    .default("처음 모으기 시작했던 카드와 좋아하는 이유"),
  topicCardId: text("topic_card_id"),
  messageLabel: text("message_label"),
  dailyDate: date("daily_date").notNull().defaultNow(),
  dailyCalls: integer("daily_calls").notNull().default(0),
  dailyTokens: integer("daily_tokens").notNull().default(0),
  dailyLimit: integer("daily_limit").notNull().default(100),
  dailyTokenLimit: integer("daily_token_limit").notNull().default(200000),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});
export const collectorLoungeRunsTable = pgTable(
  "collector_lounge_runs",
  {
    id: uuid("id").primaryKey(),
    roomId: uuid("room_id")
      .notNull()
      .references(() => collectorLoungesTable.roomId, { onDelete: "cascade" }),
    triggerSeq: integer("trigger_seq").notNull(),
    status: text("status").notNull().default("reserved"),
    speaker: text("speaker"),
    inputTokens: integer("input_tokens").notNull().default(0),
    errorCode: text("error_code"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
  },
  (t) => [index("collector_lounge_runs_room_date").on(t.roomId, t.createdAt)],
);
export const collectorDirectChatsTable=pgTable("collector_direct_chats",{
 roomId:uuid("room_id").primaryKey().references(()=>chatRoomsTable.id,{onDelete:"cascade"}),
 ownerId:uuid("owner_id").notNull().references(()=>usersTable.id,{onDelete:"cascade"}),
 collectorId:uuid("collector_id").notNull().references(()=>usersTable.id,{onDelete:"cascade"}),
 lastProcessedSeq:integer("last_processed_seq").notNull().default(0),
 leaseToken:uuid("lease_token"),leaseUntil:timestamp("lease_until",{withTimezone:true}),
 nextAt:timestamp("next_at",{withTimezone:true}).notNull().defaultNow(),
 dailyDate:date("daily_date").notNull().defaultNow(),dailyCalls:integer("daily_calls").notNull().default(0),
 attemptSeq:integer("attempt_seq").notNull().default(0),attempts:integer("attempts").notNull().default(0),
},t=>[index("collector_direct_due_idx").on(t.nextAt)]);
