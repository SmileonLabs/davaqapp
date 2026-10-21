import type { NextFunction, Request, Response } from "express";
import { getRedis } from "./redis";
import { logger } from "./logger";

interface RateLimitOptions {
  name: string;
  limit: number;
  windowSeconds: number;
  requireRedis?: boolean;
}

const localCounters = new Map<string, { count: number; resetAt: number }>();

function subject(req: Request): string {
  return req.dbUser?.id ?? req.ip ?? "unknown";
}

function checkLocal(key: string, limit: number, windowSeconds: number): { count: number; ttl: number } {
  const now = Date.now();
  const current = localCounters.get(key);
  if (!current || current.resetAt <= now) {
    localCounters.set(key, { count: 1, resetAt: now + windowSeconds * 1_000 });
    return { count: 1, ttl: windowSeconds };
  }
  current.count += 1;
  return { count: current.count, ttl: Math.max(1, Math.ceil((current.resetAt - now) / 1_000)) };
}

export function rateLimit(options: RateLimitOptions) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const key = `davaq:rate-limit:${options.name}:${subject(req)}`;
    let result: { count: number; ttl: number };
    const redis = getRedis();

    if (!redis && options.requireRedis) {
      res.status(503).json({ error: "Rate limiting is temporarily unavailable" });
      return;
    }

    try {
      if (redis) {
        const raw = await redis.eval(
          "local count=redis.call('INCR',KEYS[1]); if count==1 then redis.call('EXPIRE',KEYS[1],ARGV[1]); end; return {count,redis.call('TTL',KEYS[1])}",
          1,
          key,
          options.windowSeconds,
        ) as [number, number];
        result = { count: Number(raw[0]), ttl: Math.max(1, Number(raw[1])) };
      } else {
        result = checkLocal(key, options.limit, options.windowSeconds);
      }
    } catch (err) {
      logger.error({ err, limiter: options.name }, "Distributed rate limiter failed");
      if (options.requireRedis) {
        res.status(503).json({ error: "Rate limiting is temporarily unavailable" });
        return;
      }
      result = checkLocal(key, options.limit, options.windowSeconds);
    }

    res.set("X-RateLimit-Limit", String(options.limit));
    res.set("X-RateLimit-Remaining", String(Math.max(0, options.limit - result.count)));
    if (result.count > options.limit) {
      res.set("Retry-After", String(result.ttl));
      res.status(429).json({ error: "Too many requests", retryAfter: result.ttl });
      return;
    }
    next();
  };
}
