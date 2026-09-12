import {
  boolean,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { usersTable } from "./users";
import { chatRoomsTable, messagesTable } from "./chat";
const at = (name: string) =>
  timestamp(name, { withTimezone: true }).notNull().defaultNow();

export const exchangeMediaTable = pgTable("exchange_media", {
  objectPath: text("object_path").primaryKey(),
  ownerId: uuid("owner_id")
    .notNull()
    .references(() => usersTable.id),
  createdAt: at("created_at"),
});
export const agentLearningObservationsTable = pgTable(
  "agent_learning_observations",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => usersTable.id),
    messageId: uuid("message_id")
      .notNull()
      .references(() => messagesTable.id),
    createdAt: at("created_at"),
  },
  (t) => [primaryKey({ columns: [t.userId, t.messageId] })],
);

export const exchangeListingsTable = pgTable("exchange_listings", {
  id: uuid("id").primaryKey().defaultRandom(),
  ownerId: uuid("owner_id")
    .notNull()
    .references(() => usersTable.id),
  mode: text("mode").notNull(),
  kind: text("kind").notNull(),
  category: text("category").notNull(),
  title: text("title").notNull(),
  description: text("description").notNull().default(""),
  wantedText: text("wanted_text").notNull().default(""),
  wantedCategories: jsonb("wanted_categories")
    .$type<string[]>()
    .notNull()
    .default([]),
  location: text("location").notNull().default(""),
  delivery: text("delivery").notNull().default("online"),
  durationMinutes: integer("duration_minutes").notNull().default(30),
  availableDays: jsonb("available_days")
    .$type<number[]>()
    .notNull()
    .default([]),
  ev: integer("ev"),
  imageKey: text("image_key"),
  reviewNote: text("review_note").notNull().default(""),
  requestKey: text("request_key"),
  status: text("status").notNull().default("draft"),
  terms: text("terms").notNull().default(""),
  version: integer("version").notNull().default(1),
  createdAt: at("created_at"),
  updatedAt: at("updated_at"),
});
export const exchangeFavoritesTable = pgTable(
  "exchange_favorites",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => usersTable.id),
    listingId: uuid("listing_id")
      .notNull()
      .references(() => exchangeListingsTable.id),
    createdAt: at("created_at"),
  },
  (t) => [primaryKey({ columns: [t.userId, t.listingId] })],
);
export const exchangeProposalsTable = pgTable("exchange_proposals", {
  id: uuid("id").primaryKey().defaultRandom(),
  proposerId: uuid("proposer_id")
    .notNull()
    .references(() => usersTable.id),
  recipientId: uuid("recipient_id")
    .notNull()
    .references(() => usersTable.id),
  offerId: uuid("offer_id")
    .notNull()
    .references(() => exchangeListingsTable.id),
  requestedId: uuid("requested_id")
    .notNull()
    .references(() => exchangeListingsTable.id),
  roomId: uuid("room_id")
    .notNull()
    .references(() => chatRoomsTable.id),
  version: integer("version").notNull().default(1),
  status: text("status").notNull().default("negotiating"),
  terms: jsonb("terms").notNull(),
  snapshots: jsonb("snapshots").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: at("created_at"),
  updatedAt: at("updated_at"),
});
export const exchangeProposalVersionsTable = pgTable(
  "exchange_proposal_versions",
  {
    proposalId: uuid("proposal_id")
      .notNull()
      .references(() => exchangeProposalsTable.id),
    version: integer("version").notNull(),
    actorId: uuid("actor_id")
      .notNull()
      .references(() => usersTable.id),
    terms: jsonb("terms").notNull(),
    snapshots: jsonb("snapshots").notNull(),
    createdAt: at("created_at"),
  },
  (t) => [primaryKey({ columns: [t.proposalId, t.version] })],
);
export const exchangeAcceptancesTable = pgTable(
  "exchange_acceptances",
  {
    proposalId: uuid("proposal_id")
      .notNull()
      .references(() => exchangeProposalsTable.id),
    version: integer("version").notNull(),
    userId: uuid("user_id")
      .notNull()
      .references(() => usersTable.id),
    createdAt: at("created_at"),
  },
  (t) => [primaryKey({ columns: [t.proposalId, t.version, t.userId] })],
);
export const exchangeReservationsTable = pgTable(
  "exchange_reservations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    proposalId: uuid("proposal_id")
      .notNull()
      .references(() => exchangeProposalsTable.id),
    listingId: uuid("listing_id")
      .notNull()
      .references(() => exchangeListingsTable.id),
    ownerId: uuid("owner_id")
      .notNull()
      .references(() => usersTable.id),
    startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
    endsAt: timestamp("ends_at", { withTimezone: true }).notNull(),
    active: boolean("active").notNull().default(true),
  },
  (t) => [
    uniqueIndex("exchange_reservation_unique").on(t.proposalId, t.listingId),
  ],
);
export const exchangeEventsTable = pgTable(
  "exchange_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    proposalId: uuid("proposal_id")
      .notNull()
      .references(() => exchangeProposalsTable.id),
    actorId: uuid("actor_id")
      .notNull()
      .references(() => usersTable.id),
    kind: text("kind").notNull(),
    data: jsonb("data").notNull().default({}),
    requestKey: text("request_key").notNull(),
    createdAt: at("created_at"),
  },
  (t) => [
    uniqueIndex("exchange_event_request_unique").on(
      t.proposalId,
      t.actorId,
      t.requestKey,
    ),
  ],
);
export const exchangeFulfillmentsTable = pgTable(
  "exchange_fulfillments",
  {
    proposalId: uuid("proposal_id")
      .notNull()
      .references(() => exchangeProposalsTable.id),
    providerId: uuid("provider_id")
      .notNull()
      .references(() => usersTable.id),
    providedAt: timestamp("provided_at", { withTimezone: true }),
    receivedAt: timestamp("received_at", { withTimezone: true }),
    evidence: text("evidence").notNull().default(""),
  },
  (t) => [primaryKey({ columns: [t.proposalId, t.providerId] })],
);
export const exchangeReviewsTable = pgTable(
  "exchange_reviews",
  {
    proposalId: uuid("proposal_id")
      .notNull()
      .references(() => exchangeProposalsTable.id),
    authorId: uuid("author_id")
      .notNull()
      .references(() => usersTable.id),
    text: text("text").notNull(),
    feedback: text("feedback").notNull().default(""),
    createdAt: at("created_at"),
  },
  (t) => [primaryKey({ columns: [t.proposalId, t.authorId] })],
);
export const agentSettingsTable = pgTable("agent_settings", {
  userId: uuid("user_id")
    .primaryKey()
    .references(() => usersTable.id),
  name: text("name").notNull().default("큐"),
  tone: text("tone").notNull().default("warm"),
  activityLearning: boolean("activity_learning").notNull().default(false),
  chatLearning: boolean("chat_learning").notNull().default(false),
  autoSearch: boolean("auto_search").notNull().default(false),
  allowedRoomIds: jsonb("allowed_room_ids")
    .$type<string[]>()
    .notNull()
    .default([]),
  consentVersion: integer("consent_version").notNull().default(1),
  updatedAt: at("updated_at"),
});
export const agentMemoriesTable = pgTable(
  "agent_memories",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => usersTable.id),
    label: text("label").notNull(),
    kind: text("kind").notNull().default("preference"),
    status: text("status").notNull().default("candidate"),
    sourceType: text("source_type").notNull(),
    sourceId: text("source_id").notNull(),
    consentVersion: integer("consent_version").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    createdAt: at("created_at"),
    updatedAt: at("updated_at"),
  },
  (t) => [
    uniqueIndex("agent_memory_source_unique").on(
      t.userId,
      t.sourceType,
      t.sourceId,
    ),
  ],
);
export const agentGrowthEventsTable = pgTable(
  "agent_growth_events",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => usersTable.id),
    kind: text("kind").notNull(),
    sourceId: text("source_id").notNull(),
    createdAt: at("created_at"),
  },
  (t) => [primaryKey({ columns: [t.userId, t.kind, t.sourceId] })],
);
export const agentMessagesTable = pgTable(
  "agent_messages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => usersTable.id),
    processingStartedAt: timestamp("processing_started_at", {
      withTimezone: true,
    }),
    role: text("role").notNull(),
    content: text("content").notNull(),
    requestKey: text("request_key").notNull(),
    createdAt: at("created_at"),
  },
  (t) => [
    uniqueIndex("agent_message_request_unique").on(
      t.userId,
      t.role,
      t.requestKey,
    ),
  ],
);
export const agentSearchJobsTable = pgTable("agent_search_jobs", {
  userId: uuid("user_id")
    .primaryKey()
    .references(() => usersTable.id),
  status: text("status").notNull().default("pending"),
  requestedAt: at("requested_at"),
  startedAt: timestamp("started_at", { withTimezone: true }),
  finishedAt: timestamp("finished_at", { withTimezone: true }),
  consentVersion: integer("consent_version").notNull().default(1),
  result: jsonb("result").notNull().default([]),
  error: text("error"),
});
export const agentMatchFeedbackTable = pgTable(
  "agent_match_feedback",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => usersTable.id),
    listingId: uuid("listing_id")
      .notNull()
      .references(() => exchangeListingsTable.id),
    reason: text("reason").notNull(),
    createdAt: at("created_at"),
  },
  (t) => [primaryKey({ columns: [t.userId, t.listingId] })],
);
