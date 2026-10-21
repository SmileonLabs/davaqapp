import { sql } from "drizzle-orm";
import { check, index, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { usersTable } from "./users";

export const CONTENT_REPORT_TARGETS = ["user", "card_comment", "listing_comment", "message"] as const;
export const CONTENT_REPORT_STATUSES = ["pending", "resolved", "dismissed"] as const;
export const contentReportsTable = pgTable("davaq_content_reports", {
  id: uuid("id").primaryKey().defaultRandom(),
  reporterId: uuid("reporter_id").references(() => usersTable.id, { onDelete: "set null" }),
  targetType: text("target_type").$type<(typeof CONTENT_REPORT_TARGETS)[number]>().notNull(),
  targetId: uuid("target_id").notNull(),
  targetOwnerId: uuid("target_owner_id").references(() => usersTable.id, { onDelete: "set null" }),
  reason: text("reason").notNull(),
  status: text("status").$type<(typeof CONTENT_REPORT_STATUSES)[number]>().notNull().default("pending"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
  reviewerId: uuid("reviewer_id").references(() => usersTable.id, { onDelete: "set null" }),
  reviewNote: text("review_note"),
}, (t) => [
  check("davaq_content_reports_target_type_check", sql`${t.targetType} IN ('user','card_comment','listing_comment','message')`),
  check("davaq_content_reports_status_check", sql`${t.status} IN ('pending','resolved','dismissed')`),
  check("davaq_content_reports_reason_check", sql`char_length(btrim(${t.reason})) BETWEEN 5 AND 2000`),
  check("davaq_content_reports_review_note_check", sql`${t.reviewNote} IS NULL OR char_length(btrim(${t.reviewNote})) BETWEEN 5 AND 2000`),
  check("davaq_content_reports_review_state_check", sql`(${t.status}='pending' AND ${t.reviewedAt} IS NULL AND ${t.reviewerId} IS NULL AND ${t.reviewNote} IS NULL) OR (${t.status}<>'pending' AND ${t.reviewedAt} IS NOT NULL AND ${t.reviewNote} IS NOT NULL)`),
  uniqueIndex("davaq_content_reports_pending_unique").on(t.reporterId, t.targetType, t.targetId).where(sql`${t.status}='pending'`),
  index("davaq_content_reports_queue").on(t.status, t.createdAt, t.id),
  index("davaq_content_reports_reporter_rate").on(t.reporterId, t.createdAt),
]);
export const contentReportActionsTable = pgTable("davaq_content_report_actions", {
  id: uuid("id").primaryKey().defaultRandom(),
  reportId: uuid("report_id").notNull().references(() => contentReportsTable.id),
  actorId: uuid("actor_id").references(() => usersTable.id, { onDelete: "set null" }),
  action: text("action").$type<"reviewed" | "remove_content" | "dismissed">().notNull(),
  note: text("note").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  check("davaq_content_report_actions_action_check", sql`${t.action} IN ('reviewed','remove_content','dismissed')`),
  check("davaq_content_report_actions_note_check", sql`char_length(btrim(${t.note})) BETWEEN 5 AND 2000`),
  index("davaq_content_report_actions_report").on(t.reportId, t.createdAt, t.id),
]);
