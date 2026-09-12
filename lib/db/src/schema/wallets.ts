import { index, integer, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { usersTable } from "./users";

export const userWalletsTable = pgTable(
  "user_wallets",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    walletAddress: text("wallet_address").notNull(),
    chainId: integer("chain_id").notNull().default(1),
    verifiedAt: timestamp("verified_at", { withTimezone: true }),
    nftVerifiedAt: timestamp("nft_verified_at", { withTimezone: true }),
    lastCheckedAt: timestamp("last_checked_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    uniqueIndex("user_wallets_wallet_address_idx").on(t.walletAddress),
    index("user_wallets_user_id_idx").on(t.userId),
    index("user_wallets_user_id_nft_verified_idx").on(t.userId, t.nftVerifiedAt),
  ],
);

export const walletVerificationChallengesTable = pgTable(
  "wallet_verification_challenges",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    walletAddress: text("wallet_address").notNull(),
    chainId: integer("chain_id").notNull().default(56),
    domain: text("domain").notNull().default("davaq.anothermeai.app"),
    uri: text("uri").notNull().default("https://davaq.anothermeai.app"),
    nonce: text("nonce").notNull().unique(),
    message: text("message").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    consumedAt: timestamp("consumed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("wallet_challenges_user_wallet_idx").on(t.userId, t.walletAddress),
    index("wallet_challenges_expires_at_idx").on(t.expiresAt),
  ],
);

export type UserWallet = typeof userWalletsTable.$inferSelect;
export type WalletVerificationChallenge = typeof walletVerificationChallengesTable.$inferSelect;
