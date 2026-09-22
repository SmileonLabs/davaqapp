import {
  pgTable,
  uuid,
  text,
  integer,
  jsonb,
  timestamp,
  boolean,
  primaryKey,
  uniqueIndex,
  index,
} from "drizzle-orm/pg-core";
import { usersTable } from "./users";
import { chatRoomsTable } from "./chat";
import { exchangeListingsTable } from "./exchange";
const at = (name: string) =>
  timestamp(name, { withTimezone: true }).notNull().defaultNow();
export const exchangeRelaysTable = pgTable(
  "exchange_relays",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    creatorId: uuid("creator_id")
      .notNull()
      .references(() => usersTable.id),
    roomId: uuid("room_id")
      .notNull()
      .unique()
      .references(() => chatRoomsTable.id),
    status: text("status").notNull().default("negotiating"),
    pathKey: text("path_key").notNull(),
    goalContext: jsonb("goal_context"),
    version: integer("version").notNull().default(1),
    terms: jsonb("terms").notNull(),
    requestKey: text("request_key").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: at("created_at"),
    updatedAt: at("updated_at"),
  },
  (t) => [
    uniqueIndex("exchange_relays_creator_request").on(
      t.creatorId,
      t.requestKey,
    ),
  ],
);
export const exchangeRelayMembersTable = pgTable(
  "exchange_relay_members",
  {
    relayId: uuid("relay_id")
      .notNull()
      .references(() => exchangeRelaysTable.id),
    userId: uuid("user_id")
      .notNull()
      .references(() => usersTable.id),
    position: integer("position").notNull(),
    listingId: uuid("listing_id")
      .notNull()
      .references(() => exchangeListingsTable.id),
    snapshot: jsonb("snapshot").notNull(),
    acceptedVersion: integer("accepted_version"),
    cancelAccepted: boolean("cancel_accepted").notNull().default(false),
    providedAt: timestamp("provided_at", { withTimezone: true }),
    receivedAt: timestamp("received_at", { withTimezone: true }),
    evidence: text("evidence").notNull().default(""),
  },
  (t) => [
    primaryKey({ columns: [t.relayId, t.userId] }),
    uniqueIndex("exchange_relay_member_position").on(t.relayId, t.position),
    uniqueIndex("exchange_relay_member_listing").on(t.relayId, t.listingId),
    index("exchange_relay_members_user").on(t.userId, t.relayId),
  ],
);
export const exchangeRelayReservationsTable = pgTable(
  "exchange_relay_reservations",
  {
    relayId: uuid("relay_id")
      .notNull()
      .references(() => exchangeRelaysTable.id),
    listingId: uuid("listing_id")
      .notNull()
      .references(() => exchangeListingsTable.id),
    providerId: uuid("provider_id")
      .notNull()
      .references(() => usersTable.id),
    receiverId: uuid("receiver_id")
      .notNull()
      .references(() => usersTable.id),
    startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
    endsAt: timestamp("ends_at", { withTimezone: true }).notNull(),
    kind: text("kind").notNull(),
    active: boolean("active").notNull().default(true),
  },
  (t) => [primaryKey({ columns: [t.relayId, t.listingId] })],
);
export const exchangeRelayEventsTable = pgTable(
  "exchange_relay_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    relayId: uuid("relay_id")
      .notNull()
      .references(() => exchangeRelaysTable.id),
    actorId: uuid("actor_id")
      .notNull()
      .references(() => usersTable.id),
    kind: text("kind").notNull(),
    data: jsonb("data").notNull().default({}),
    requestKey: text("request_key").notNull(),
    createdAt: at("created_at"),
  },
  (t) => [
    uniqueIndex("exchange_relay_event_request").on(
      t.relayId,
      t.actorId,
      t.requestKey,
    ),
    index("exchange_relay_events_relay").on(t.relayId, t.createdAt),
  ],
);
