import { beforeEach, describe, expect, it, vi } from "vitest";
import { privateKeyToAccount } from "viem/accounts";
import { buildChallengeMessage } from "./walletChallenge";

const mocks = vi.hoisted(() => {
  const tables = {
    challenges: { id: "challenge.id", userId: "challenge.userId", walletAddress: "challenge.walletAddress", consumedAt: "challenge.consumedAt" },
    wallets: { id: "wallet.id", userId: "wallet.userId", walletAddress: "wallet.walletAddress", verifiedAt: "wallet.verifiedAt", updatedAt: "wallet.updatedAt" },
    collections: { status: "collection.status", contractAddress: "collection.contractAddress", chainId: "collection.chainId", rpcUrl: "collection.rpcUrl", updatedAt: "collection.updatedAt" },
  };
  const state = {
      challenge: null as Record<string, any> | null,
      consumed: false,
      existingWallet: null as Record<string, any> | null,
      savedWallet: null as Record<string, any> | null,
      inventory: {
        walletAddress: "",
        collections: [],
        totalOwned: 1,
        hasEligibleNft: true,
        configuredCollectionCount: 1,
        checkedAt: new Date().toISOString(),
      },
      inventoryError: false,
  };
  function resultFor(table: unknown) {
    if (table === tables.challenges) {
      return state.challenge && !state.consumed ? [state.challenge] : [];
    }
    if (table === tables.wallets) {
      return state.savedWallet
        ? [state.savedWallet]
        : state.existingWallet
          ? [state.existingWallet]
          : [];
    }
    return [];
  }
  function queryResult(table: unknown) {
    return {
      where: () => ({
        orderBy: () => ({ limit: async () => resultFor(table) }),
        limit: async () => resultFor(table),
      }),
    };
  }
  const db: any = {
    select: () => ({
      from: (table: unknown) => queryResult(table),
    }),
    update: (table: unknown) => ({
      set: (values: Record<string, unknown>) => ({
        where: () => ({
          returning: async () => {
            if (table === tables.challenges) {
              if (state.consumed) return [];
              state.consumed = true;
              return [{ id: state.challenge?.id }];
            }
            if (table === tables.wallets && state.savedWallet) {
              state.savedWallet = { ...state.savedWallet, ...values };
            }
            return [];
          },
        }),
      }),
    }),
    insert: (table: unknown) => ({
      values: (values: Record<string, any>) => ({
        onConflictDoUpdate: () => ({
          returning: async () => {
            if (table !== tables.wallets) return [];
            state.savedWallet = {
              id: "wallet-row",
              ...values,
              updatedAt: new Date(),
            };
            return [{ userId: values.userId }];
          },
        }),
      }),
    }),
    transaction: async <T>(callback: (tx: any) => Promise<T>) => callback(db),
  };
  return { tables, state, db };
});

vi.mock("drizzle-orm", () => ({
  and: (...values: unknown[]) => values,
  desc: (value: unknown) => value,
  eq: (...values: unknown[]) => values,
  isNotNull: (value: unknown) => value,
  isNull: (value: unknown) => value,
}));

vi.mock("@workspace/db", () => ({
  db: mocks.db,
  userWalletsTable: mocks.tables.wallets,
  walletVerificationChallengesTable: mocks.tables.challenges,
  nftCollectionsTable: mocks.tables.collections,
}));

vi.mock("./fanStar", () => ({
  ensurePlayModeState: async () => ({ starUnlocked: false }),
}));

vi.mock("./nft", () => ({
  getNftConfig: () => ({
    configured: true,
    contractAddress: "0x2222222222222222222222222222222222222222",
    chainId: 56,
    rpcUrl: "https://rpc.invalid",
  }),
}));

vi.mock("./nftInventory", () => ({
  listAddressNftInventory: async () => {
    if (mocks.state.inventoryError) throw new Error("rpc unavailable");
    return mocks.state.inventory;
  },
}));

import {
  WalletVerificationError,
  verifyWalletChallenge,
} from "./walletVerification";

const owner = privateKeyToAccount(
  "0x1000000000000000000000000000000000000000000000000000000000000001",
);
const attacker = privateKeyToAccount(
  "0x2000000000000000000000000000000000000000000000000000000000000002",
);
const userId = "11111111-1111-4111-8111-111111111111";
const challengeId = "22222222-2222-4222-8222-222222222222";

function seedChallenge(expiresAt = new Date(Date.now() + 10 * 60_000)) {
  const issuedAt = new Date(expiresAt.getTime() - 10 * 60_000);
  const message = buildChallengeMessage({
    walletAddress: owner.address,
    requestId: challengeId,
    nonce: "0123456789abcdef0123456789abcdef",
    domain: "davaq.anothermeai.app",
    uri: "https://davaq.anothermeai.app",
    chainId: 56,
    issuedAt,
    expiresAt,
  });
  mocks.state.challenge = {
    id: challengeId,
    userId,
    walletAddress: owner.address,
    chainId: 56,
    domain: "davaq.anothermeai.app",
    uri: "https://davaq.anothermeai.app",
    nonce: "0123456789abcdef0123456789abcdef",
    message,
    expiresAt,
    consumedAt: null,
  };
  return message;
}

beforeEach(() => {
  mocks.state.challenge = null;
  mocks.state.consumed = false;
  mocks.state.existingWallet = null;
  mocks.state.savedWallet = null;
  mocks.state.inventoryError = false;
  mocks.state.inventory = {
    walletAddress: owner.address,
    collections: [],
    totalOwned: 1,
    hasEligibleNft: true,
    configuredCollectionCount: 1,
    checkedAt: new Date().toISOString(),
  };
});

describe("wallet ownership verification flow", () => {
  it("accepts the matching wallet signature and records NFT ownership", async () => {
    const message = seedChallenge();
    const signature = await owner.signMessage({ message });

    const result = await verifyWalletChallenge({
      userId,
      walletAddress: owner.address,
      challengeId,
      signature,
    });

    expect(result.ok).toBe(true);
    expect(result.nftOwned).toBe(true);
    expect(result.status.walletVerified).toBe(true);
    expect(result.status.nftVerified).toBe(true);
    expect(mocks.state.consumed).toBe(true);
  });

  it("rejects a signature made by a different wallet without consuming the challenge", async () => {
    const message = seedChallenge();
    const signature = await attacker.signMessage({ message });

    await expect(
      verifyWalletChallenge({ userId, walletAddress: owner.address, challengeId, signature }),
    ).rejects.toMatchObject({ code: "invalid_signature" });
    expect(mocks.state.consumed).toBe(false);
  });

  it("rejects an expired challenge", async () => {
    const message = seedChallenge(new Date(Date.now() - 1));
    const signature = await owner.signMessage({ message });

    await expect(
      verifyWalletChallenge({ userId, walletAddress: owner.address, challengeId, signature }),
    ).rejects.toMatchObject({ code: "challenge_expired" });
  });

  it("blocks replay after a successful verification", async () => {
    const message = seedChallenge();
    const signature = await owner.signMessage({ message });
    await verifyWalletChallenge({ userId, walletAddress: owner.address, challengeId, signature });

    await expect(
      verifyWalletChallenge({ userId, walletAddress: owner.address, challengeId, signature }),
    ).rejects.toMatchObject({ code: "challenge_not_found" });
  });

  it("blocks a wallet already linked to another account", async () => {
    const message = seedChallenge();
    const signature = await owner.signMessage({ message });
    mocks.state.existingWallet = {
      id: "existing-wallet",
      userId: "33333333-3333-4333-8333-333333333333",
      walletAddress: owner.address,
    };

    await expect(
      verifyWalletChallenge({ userId, walletAddress: owner.address, challengeId, signature }),
    ).rejects.toMatchObject({ code: "wallet_claimed" });
    expect(mocks.state.consumed).toBe(false);
  });

  it("returns a service error when NFT ownership RPC fails", async () => {
    const message = seedChallenge();
    const signature = await owner.signMessage({ message });
    mocks.state.inventoryError = true;

    await expect(
      verifyWalletChallenge({ userId, walletAddress: owner.address, challengeId, signature }),
    ).rejects.toMatchObject({ code: "nft_check_failed" });
    expect(mocks.state.consumed).toBe(false);
  });

  it("verifies the wallet but keeps NFT access locked when no eligible NFT is owned", async () => {
    const message = seedChallenge();
    const signature = await owner.signMessage({ message });
    mocks.state.inventory = {
      ...mocks.state.inventory,
      totalOwned: 0,
      hasEligibleNft: false,
    };

    const result = await verifyWalletChallenge({
      userId,
      walletAddress: owner.address,
      challengeId,
      signature,
    });

    expect(result.status.walletVerified).toBe(true);
    expect(result.status.nftVerified).toBe(false);
    expect(result.nftOwned).toBe(false);
  });
});
