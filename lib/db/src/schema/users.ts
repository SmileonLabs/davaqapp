import { boolean, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const usersTable = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  clerkId: text("clerk_id").notNull().unique(),
  email: text("email").notNull().unique(),
  nickname: text("nickname").notNull(),
  profileImageUrl: text("profile_image_url"),
  statusMessage: text("status_message"),
  pushToken: text("push_token"),
  // Native credentials, stored as a JSON string array: legacy opaque FCM
  // tokens plus apns:<environment>:<hex> and voip:<environment>:<hex> for iOS.
  // Apple credentials retain the same exclusive-owner locking and cleanup.
  // Web-push subscription objects remain separate in pushToken.
  fcmTokens: text("fcm_tokens"),
  notificationEnabled: boolean("notification_enabled").notNull().default(true),
  talkAnalysisEnabled: boolean("talk_analysis_enabled").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertUserSchema = createInsertSchema(usersTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof usersTable.$inferSelect;
