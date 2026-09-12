import { randomBytes, randomUUID } from "node:crypto";
import { and, desc, eq, isNotNull, isNull } from "drizzle-orm";
import {
  db,
  nftCollectionsTable,
  userWalletsTable,
  walletVerificationChallengesTable,
  type UserWallet,
} from "@workspace/db";
import { getAddress, verifyMessage, type Address, type Hex } from "viem";
import { ensurePlayModeState } from "./fanStar";
import { getNftConfig } from "./nft";
import { listAddressNftInventory } from "./nftInventory";
import { buildChallengeMessage } from "./walletChallenge";

const CHALLENGE_TTL_MS = 10 * 60 * 1000;
const DEFAULT_CHAIN_ID = 56;

function getSignInContext() {
  const configuredUri = process.env.WALLET_SIGN_IN_URI ?? "https://davaq.anothermeai.app";
  try {
    const uri = new URL(configuredUri);
    if (uri.protocol !== "https:") throw new Error("wallet sign-in URI must use HTTPS");
    return {
      domain: process.env.WALLET_SIGN_IN_DOMAIN?.trim() || uri.host,
      uri: uri.origin,
    };
  } catch {
    return { domain: "davaq.anothermeai.app", uri: "https://davaq.anothermeai.app" };
  }
}

export interface WalletStatus {
  walletAddress: string | null;
  chainId: number | null;
  walletVerified: boolean;
  nftVerified: boolean;
  lastCheckedAt: string | null;
  nftContractAddress: string | null;
  nftChainId: number | null;
  nftConfigured: boolean;
  starUnlocked: boolean;
}

export interface WalletChallengeView {
  id: string;
  walletAddress: string;
  message: string;
  expiresAt: string;
  nftContractAddress: string | null;
  nftChainId: number | null;
  chainId: number;
  domain: string;
  uri: string;
}

export interface VerifyWalletResult {
  ok: true;
  status: WalletStatus;
  nftOwned: boolean;
  balance: string | null;
  configMissing: boolean;
}

export class WalletVerificationError extends Error {
  constructor(
    readonly code:
      | "invalid_wallet"
      | "invalid_signature"
      | "challenge_not_found"
      | "challenge_expired"
      | "wallet_claimed"
      | "nft_check_failed",
    message: string,
  ) {
    super(message);
  }
}

function normalizeWalletAddress(value: string): Address {
  try {
    return getAddress(value.trim());
  } catch {
    throw new WalletVerificationError("invalid_wallet", "올바른 EVM 지갑 주소를 입력해 주세요.");
  }
}

async function getPublishedNftSummary(): Promise<{
  configured: boolean;
  contractAddress: string | null;
  chainId: number | null;
}> {
  const collections = await db.select({
    contractAddress: nftCollectionsTable.contractAddress,
    chainId: nftCollectionsTable.chainId,
    rpcUrl: nftCollectionsTable.rpcUrl,
  }).from(nftCollectionsTable)
    .where(eq(nftCollectionsTable.status, "published"))
    .orderBy(desc(nftCollectionsTable.updatedAt))
    .limit(100);
  const configured = collections.filter((collection) =>
    Boolean(collection.rpcUrl && collection.contractAddress && collection.chainId > 0)
  );
  if (configured.length === 0) {
    const legacy = getNftConfig();
    return {
      configured: legacy.configured,
      contractAddress: legacy.contractAddress,
      chainId: legacy.chainId,
    };
  }
  return {
    configured: true,
    contractAddress: configured.length === 1 ? configured[0]!.contractAddress : null,
    chainId: configured.length === 1 ? configured[0]!.chainId : null,
  };
}

function serializeWalletStatus(
  row: UserWallet | undefined,
  starUnlocked: boolean,
  config: Awaited<ReturnType<typeof getPublishedNftSummary>>,
): WalletStatus {
  return {
    walletAddress: row?.walletAddress ?? null,
    chainId: row?.chainId ?? config.chainId,
    walletVerified: row?.verifiedAt != null,
    nftVerified: row?.nftVerifiedAt != null,
    lastCheckedAt: row?.lastCheckedAt?.toISOString() ?? null,
    nftContractAddress: config.contractAddress,
    nftChainId: config.chainId,
    nftConfigured: config.configured,
    starUnlocked,
  };
}

export async function getWalletStatus(userId: string): Promise<WalletStatus> {
  const [wallet] = await db
    .select()
    .from(userWalletsTable)
    .where(eq(userWalletsTable.userId, userId))
    .orderBy(desc(userWalletsTable.updatedAt))
    .limit(1);
  const [playMode, config] = await Promise.all([
    ensurePlayModeState(userId),
    getPublishedNftSummary(),
  ]);
  return serializeWalletStatus(wallet, playMode.starUnlocked, config);
}

export async function createWalletChallenge(params: {
  userId: string;
  walletAddress: string;
  chainId?: number;
}): Promise<WalletChallengeView> {
  const walletAddress = normalizeWalletAddress(params.walletAddress);
  const config = await getPublishedNftSummary();
  const chainId = params.chainId ?? config.chainId ?? DEFAULT_CHAIN_ID;
  if (!Number.isInteger(chainId) || chainId <= 0 || chainId > 2_147_483_647) {
    throw new WalletVerificationError("invalid_wallet", "지원하지 않는 네트워크입니다.");
  }
  const context = getSignInContext();
  const challengeId = randomUUID();
  const nonce = randomBytes(16).toString("hex");
  const issuedAt = new Date();
  const expiresAt = new Date(issuedAt.getTime() + CHALLENGE_TTL_MS);
  const message = buildChallengeMessage({
    walletAddress,
    requestId: challengeId,
    nonce,
    domain: context.domain,
    uri: context.uri,
    chainId,
    issuedAt,
    expiresAt,
  });

  const [challenge] = await db
    .insert(walletVerificationChallengesTable)
    .values({
      id: challengeId,
      userId: params.userId,
      walletAddress,
      chainId,
      domain: context.domain,
      uri: context.uri,
      nonce,
      message,
      expiresAt,
    })
    .returning();

  if (!challenge) throw new Error("wallet challenge create failed");
  return {
    id: challenge.id,
    walletAddress,
    message,
    expiresAt: expiresAt.toISOString(),
    nftContractAddress: config.contractAddress,
    nftChainId: config.chainId,
    chainId,
    domain: context.domain,
    uri: context.uri,
  };
}

export async function verifyWalletChallenge(params: {
  userId: string;
  walletAddress: string;
  challengeId: string;
  signature: string;
}): Promise<VerifyWalletResult> {
  const walletAddress = normalizeWalletAddress(params.walletAddress);
  const [challenge] = await db
    .select()
    .from(walletVerificationChallengesTable)
    .where(
      and(
        eq(walletVerificationChallengesTable.id, params.challengeId),
        eq(walletVerificationChallengesTable.userId, params.userId),
        eq(walletVerificationChallengesTable.walletAddress, walletAddress),
        isNull(walletVerificationChallengesTable.consumedAt),
      ),
    )
    .limit(1);

  if (!challenge) {
    throw new WalletVerificationError("challenge_not_found", "인증 메시지를 다시 생성해 주세요.");
  }
  if (challenge.expiresAt.getTime() <= Date.now()) {
    throw new WalletVerificationError("challenge_expired", "인증 메시지가 만료됐어요. 다시 생성해 주세요.");
  }

  const signature = params.signature.trim() as Hex;
  let valid = false;
  try {
    valid = await verifyMessage({ address: walletAddress, message: challenge.message, signature });
  } catch {
    valid = false;
  }
  if (!valid) {
    throw new WalletVerificationError("invalid_signature", "서명이 지갑 주소와 일치하지 않아요.");
  }

  const [existing] = await db
    .select()
    .from(userWalletsTable)
    .where(eq(userWalletsTable.walletAddress, walletAddress))
    .limit(1);
  if (existing && existing.userId !== params.userId) {
    throw new WalletVerificationError("wallet_claimed", "이미 다른 계정에 연결된 지갑이에요.");
  }

  let inventory;
  try {
    inventory = await listAddressNftInventory(walletAddress);
  } catch {
    throw new WalletVerificationError("nft_check_failed", "NFT 보유 여부를 확인하지 못했어요.");
  }

  const now = new Date();
  await db.transaction(async (tx) => {
    const consumed = await tx
      .update(walletVerificationChallengesTable)
      .set({ consumedAt: now })
      .where(
        and(
          eq(walletVerificationChallengesTable.id, challenge.id),
          isNull(walletVerificationChallengesTable.consumedAt),
        ),
      )
      .returning({ id: walletVerificationChallengesTable.id });
    if (consumed.length !== 1) {
      throw new WalletVerificationError("challenge_not_found", "이미 사용된 인증 메시지예요. 다시 생성해 주세요.");
    }

    const linkedWallet = await tx
      .insert(userWalletsTable)
      .values({
        userId: params.userId,
        walletAddress,
        chainId: challenge.chainId,
        verifiedAt: now,
        nftVerifiedAt: inventory.hasEligibleNft ? now : null,
        lastCheckedAt: now,
      })
      .onConflictDoUpdate({
        target: userWalletsTable.walletAddress,
        set: {
          verifiedAt: now,
          chainId: challenge.chainId,
          nftVerifiedAt: inventory.hasEligibleNft ? now : null,
          lastCheckedAt: now,
          updatedAt: now,
        },
      })
      .returning({ userId: userWalletsTable.userId });
    if (linkedWallet[0]?.userId !== params.userId) {
      throw new WalletVerificationError("wallet_claimed", "이미 다른 계정에 연결된 지갑이에요.");
    }
  });

  return {
    ok: true,
    status: await getWalletStatus(params.userId),
    nftOwned: inventory.hasEligibleNft,
    balance: String(inventory.totalOwned),
    configMissing: inventory.configuredCollectionCount === 0,
  };
}

export async function refreshWalletNft(userId: string): Promise<VerifyWalletResult> {
  const [wallet] = await db
    .select()
    .from(userWalletsTable)
    .where(and(eq(userWalletsTable.userId, userId), isNotNull(userWalletsTable.verifiedAt)))
    .orderBy(desc(userWalletsTable.updatedAt))
    .limit(1);
  if (!wallet) {
    throw new WalletVerificationError("challenge_not_found", "먼저 지갑을 인증해 주세요.");
  }

  let inventory;
  try {
    inventory = await listAddressNftInventory(normalizeWalletAddress(wallet.walletAddress));
  } catch {
    throw new WalletVerificationError("nft_check_failed", "NFT 보유 여부를 확인하지 못했어요.");
  }

  const now = new Date();
  await db
    .update(userWalletsTable)
    .set({
      nftVerifiedAt: inventory.hasEligibleNft ? now : null,
      lastCheckedAt: now,
      updatedAt: now,
    })
    .where(eq(userWalletsTable.id, wallet.id));
  return {
    ok: true,
    status: await getWalletStatus(userId),
    nftOwned: inventory.hasEligibleNft,
    balance: String(inventory.totalOwned),
    configMissing: inventory.configuredCollectionCount === 0,
  };
}
