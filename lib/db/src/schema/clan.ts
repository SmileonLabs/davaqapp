import { date, integer, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { usersTable } from "./users";

/**
 * A Clan ("가문") — a group of "DavaQ" personas with a shared identity and
 * growth direction. This phase implements creation/join/leave/lookup only; Clan
 * War / Clan Memory / Clan Ranking are intentionally out of scope. `level`/`exp`
 * exist for a later phase and are never mutated by the existing XP system — they
 * track the clan itself, not any user's persona.
 */
export const clansTable = pgTable("clans", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull().unique(),
  description: text("description"),
  emblemUrl: text("emblem_url"),
  ownerUserId: uuid("owner_user_id")
    .notNull()
    .references(() => usersTable.id, { onDelete: "cascade" }),
  level: integer("level").notNull().default(1),
  exp: integer("exp").notNull().default(0),
  memberCount: integer("member_count").notNull().default(1),
  /** Free-text shared values / "대표 가치관". */
  clanValues: text("clan_values"),
  /** Short summary, seeded from description on creation. */
  clanSummary: text("clan_summary"),
  /** Preferred persona archetype KEY (e.g. "strategist"); matches persona keys. */
  preferredArchetype: text("preferred_archetype"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

/**
 * Membership of a user in a clan. A user can belong to at most one clan, enforced
 * by the UNIQUE constraint on `user_id` (leaving deletes the row rather than
 * soft-flagging). `role` is one of owner/elder/member. `contributionExp` is a
 * placeholder for a later Clan-XP phase and is not driven by the persona XP system.
 */
export const clanMembersTable = pgTable("clan_members", {
  id: uuid("id").primaryKey().defaultRandom(),
  clanId: uuid("clan_id")
    .notNull()
    .references(() => clansTable.id, { onDelete: "cascade" }),
  userId: uuid("user_id")
    .notNull()
    .unique()
    .references(() => usersTable.id, { onDelete: "cascade" }),
  /** owner | elder | member */
  role: text("role").notNull().default("member"),
  contributionExp: integer("contribution_exp").notNull().default(0),
  /**
   * UTC date (YYYY-MM-DD) the member last received the ranking Top-10 clan-EXP
   * bonus. Used purely for once-per-day idempotency of that bonus; null until the
   * member first lands in the overall Top 10 while viewing rankings.
   */
  lastRankBonusOn: date("last_rank_bonus_on"),
  joinedAt: timestamp("joined_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

export type ClanRole = "owner" | "elder" | "member";

export const insertClanSchema = createInsertSchema(clansTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertClan = z.infer<typeof insertClanSchema>;
export type Clan = typeof clansTable.$inferSelect;

export const insertClanMemberSchema = createInsertSchema(clanMembersTable).omit({
  id: true,
  joinedAt: true,
  updatedAt: true,
});
export type InsertClanMember = z.infer<typeof insertClanMemberSchema>;
export type ClanMember = typeof clanMembersTable.$inferSelect;
