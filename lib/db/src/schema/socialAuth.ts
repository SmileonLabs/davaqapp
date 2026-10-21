import { boolean, pgTable, primaryKey, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";
import { usersTable } from "./users";
export const socialAccountsTable = pgTable("davaq_social_accounts", {
  provider: text("provider").notNull(), subject: text("subject").notNull(),
  userId: uuid("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, table => [primaryKey({ columns: [table.provider, table.subject] }), unique().on(table.provider, table.userId)]);
export const socialAttemptsTable = pgTable("davaq_social_attempts", {
  stateHash: text("state_hash").primaryKey(), provider: text("provider").notNull(), challenge: text("challenge").notNull(),
  linkUserId: uuid("link_user_id").references(() => usersTable.id, { onDelete: "cascade" }),
  email: text("email"), subject: text("subject"), verified: boolean("verified"), error: text("error"),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
export const socialSessionsTable = pgTable("davaq_social_sessions", {
  id: uuid("id").primaryKey(), userId: uuid("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  refreshHash: text("refresh_hash").notNull().unique(), expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
export const socialAccessTokensTable = pgTable("davaq_social_access_tokens", {
  tokenHash: text("token_hash").primaryKey(), sessionId: uuid("session_id").notNull().references(() => socialSessionsTable.id, { onDelete: "cascade" }),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
});
