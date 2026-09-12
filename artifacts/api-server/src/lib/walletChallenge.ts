export function buildChallengeMessage(params: {
  walletAddress: string;
  requestId: string;
  nonce: string;
  domain: string;
  uri: string;
  chainId: number;
  issuedAt: Date;
  expiresAt: Date;
}) {
  return [
    `${params.domain} wants you to sign in with your Ethereum account:`,
    params.walletAddress,
    "",
    "Verify wallet ownership to unlock eligible DavaQ STAR NFTs.",
    "This request does not grant token transfer permission and costs no gas.",
    "",
    `URI: ${params.uri}`,
    "Version: 1",
    `Chain ID: ${params.chainId}`,
    `Nonce: ${params.nonce}`,
    `Issued At: ${params.issuedAt.toISOString()}`,
    `Expiration Time: ${params.expiresAt.toISOString()}`,
    `Request ID: ${params.requestId}`,
    "Resources:",
    "- urn:anotherme:wallet-verification",
  ].join("\n");
}
