// SQL migration 0033 is the canonical source for constraints, defaults and indexes.
import {
  pgTable,
  uuid,
  text,
  integer,
  boolean,
  jsonb,
  timestamp,
  doublePrecision,
  primaryKey,
} from "drizzle-orm/pg-core";
export const brandCampaignsTable = pgTable("brand_campaigns", {
  id: uuid("id").notNull().primaryKey(),
  status: text("status").notNull(),
  currentVersionId: uuid("current_version_id"),
  budget: integer("budget").notNull(),
  held: integer("held").notNull(),
  spent: integer("spent").notNull(),
  createdBy: uuid("created_by").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
});
export const brandVersionsTable = pgTable("brand_versions", {
  id: uuid("id").notNull().primaryKey(),
  campaignId: uuid("campaign_id").notNull(),
  config: jsonb("config").notNull(),
  answers: jsonb("answers").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
});
export const brandMediaTable = pgTable("brand_media", {
  width: integer("width").notNull(),
  height: integer("height").notNull(),
  duration: doublePrecision("duration").notNull(),
  objectPath: text("object_path").notNull().primaryKey(),
  ownerId: uuid("owner_id").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
});
export const brandUnitsTable = pgTable("brand_units", {
  id: uuid("id").notNull().primaryKey(),
  campaignId: uuid("campaign_id").notNull(),
  encryptedCode: text("encrypted_code").notNull(),
  fingerprint: text("fingerprint").notNull(),
  validUntil: timestamp("valid_until", { withTimezone: true }).notNull(),
  state: text("state").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
});
export const brandParticipationsTable = pgTable("brand_participations", {
  id: uuid("id").notNull().primaryKey(),
  userId: uuid("user_id").notNull(),
  campaignId: uuid("campaign_id").notNull(),
  versionId: uuid("version_id").notNull(),
  unitId: uuid("unit_id").notNull(),
  requestKey: text("request_key").notNull(),
  cost: integer("cost").notNull(),
  status: text("status").notNull(),
  attempt: integer("attempt").notNull(),
  leaseHash: text("lease_hash"),
  leaseUntil: timestamp("lease_until", { withTimezone: true }),
  sequence: integer("sequence").notNull(),
  progress: doublePrecision("progress").notNull(),
  credit: doublePrecision("credit").notNull(),
  found: jsonb("found").notNull(),
  clicks: integer("clicks").notNull(),
  lastTick: timestamp("last_tick", { withTimezone: true }),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
});
export const brandEventsTable = pgTable(
  "brand_events",
  {
    action: text("action").notNull(),
    participationId: uuid("participation_id").notNull(),
    requestKey: text("request_key").notNull(),
    response: jsonb("response").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  },
  (t) => [primaryKey({ columns: [t.participationId, t.requestKey] })],
);
export const brandClaimsTable = pgTable("brand_claims", {
  id: uuid("id").notNull().primaryKey(),
  participationId: uuid("participation_id").notNull(),
  userId: uuid("user_id").notNull(),
  unitId: uuid("unit_id").notNull(),
  status: text("status").notNull(),
  selfUsedAt: timestamp("self_used_at", { withTimezone: true }),
  issue: text("issue").notNull(),
  resolution: text("resolution").notNull(),
  issuedAt: timestamp("issued_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
});
export const brandOutboxTable = pgTable("brand_outbox", {
  claimId: uuid("claim_id").notNull().primaryKey(),
  doneAt: timestamp("done_at", { withTimezone: true }),
  attempts: integer("attempts").notNull(),
});
export const brandBudgetLedgerTable = pgTable("brand_budget_ledger", {
  id: uuid("id").notNull().primaryKey(),
  campaignId: uuid("campaign_id").notNull(),
  participationId: uuid("participation_id"),
  kind: text("kind").notNull(),
  amount: integer("amount").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
});
export const brandPreferencesTable = pgTable("brand_preferences", {
  userId: uuid("user_id").notNull().primaryKey(),
  categories: jsonb("categories").notNull(),
  region: text("region").notNull(),
  personalized: boolean("personalized").notNull(),
  version: integer("version").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
});
