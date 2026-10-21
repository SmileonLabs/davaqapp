import { getRedis } from "./redis";
import { logger } from "./logger";

const TTL_MS = 5000;
const TTL_SECONDS = Math.ceil(TTL_MS / 1000) + 1;

const rooms = new Map<string, Map<string, number>>();

function key(roomId: string): string {
  return `davaq:typing:${roomId}`;
}

function markLocalTyping(roomId: string, userId: string, expiresAt: number): void {
  let room = rooms.get(roomId);
  if (!room) {
    room = new Map();
    rooms.set(roomId, room);
  }
  room.set(userId, expiresAt);
}

function clearLocalTyping(roomId: string, userId: string): void {
  const room = rooms.get(roomId);
  if (!room) return;
  room.delete(userId);
  if (room.size === 0) rooms.delete(roomId);
}

function getLocalTypingUserIds(roomId: string, excludeUserId: string, now: number): string[] {
  const room = rooms.get(roomId);
  if (!room) return [];
  const active: string[] = [];
  for (const [userId, expiresAt] of room) {
    if (expiresAt <= now) {
      room.delete(userId);
      continue;
    }
    if (userId !== excludeUserId) active.push(userId);
  }
  if (room.size === 0) rooms.delete(roomId);
  return active;
}

export async function markTyping(roomId: string, userId: string): Promise<void> {
  const redis = getRedis();
  const expiresAt = Date.now() + TTL_MS;
  if (redis) {
    try {
      await redis.zadd(key(roomId), expiresAt, userId);
      await redis.expire(key(roomId), TTL_SECONDS);
      return;
    } catch (err) {
      logger.error({ err, roomId }, "Failed to write typing state to Redis");
    }
  }

  markLocalTyping(roomId, userId, expiresAt);
}

export async function clearTyping(roomId: string, userId: string): Promise<void> {
  const redis = getRedis();
  if (redis) {
    try {
      await redis.zrem(key(roomId), userId);
      return;
    } catch (err) {
      logger.error({ err, roomId }, "Failed to clear typing state from Redis");
    }
  }

  clearLocalTyping(roomId, userId);
}

export async function getTypingUserIds(roomId: string, excludeUserId: string): Promise<string[]> {
  const redis = getRedis();
  const now = Date.now();
  if (redis) {
    try {
      await redis.zremrangebyscore(key(roomId), 0, now);
      const ids = await redis.zrangebyscore(key(roomId), now + 1, "+inf");
      return ids.filter((id) => id !== excludeUserId);
    } catch (err) {
      logger.error({ err, roomId }, "Failed to read typing state from Redis");
    }
  }

  return getLocalTypingUserIds(roomId, excludeUserId, now);
}
