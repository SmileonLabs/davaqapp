import { pgTable, text, uuid, timestamp } from "drizzle-orm/pg-core";
import { usersTable } from "./users";
const at = (name: string) =>
  timestamp(name, { withTimezone: true }).notNull().defaultNow();
export const chatUploadOwnersTable = pgTable("chat_upload_owners", {
  objectPath: text("object_path").primaryKey(),
  userId: uuid("user_id")
    .notNull()
    .references(() => usersTable.id),
  contentType: text("content_type").notNull(),
  createdAt: at("created_at"),
});
