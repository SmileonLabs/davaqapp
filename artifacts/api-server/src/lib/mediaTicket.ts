import { createHash, randomBytes } from "node:crypto";
import { getRedis } from "./redis";

const MEDIA_TICKET_PREFIX = "davaq:media-ticket:";
export const MEDIA_TICKET_TTL_SECONDS = 300;

function key(ticket: string): string {
  return `${MEDIA_TICKET_PREFIX}${createHash("sha256").update(ticket).digest("hex")}`;
}

export async function issueMediaTicket(userId: string, objectPath: string): Promise<string> {
  const redis = getRedis();
  if (!redis) throw new Error("Redis is required for media tickets");
  const ticket = randomBytes(32).toString("base64url");
  const result = await redis.set(
    key(ticket),
    JSON.stringify({ userId, objectPath }),
    "EX",
    MEDIA_TICKET_TTL_SECONDS,
    "NX",
  );
  if (result !== "OK") throw new Error("Could not store media ticket");
  return ticket;
}

export async function validateMediaTicket(ticket: string, objectPath: string): Promise<boolean> {
  if (ticket.length < 32) return false;
  const redis = getRedis();
  if (!redis) return false;
  const value = await redis.get(key(ticket));
  if (!value) return false;
  try {
    const payload = JSON.parse(value) as { objectPath?: unknown };
    return payload.objectPath === objectPath;
  } catch {
    return false;
  }
}
