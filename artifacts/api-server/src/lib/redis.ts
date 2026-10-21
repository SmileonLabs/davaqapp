import { EventEmitter } from "node:events";
import Redis from "ioredis";
import { logger } from "./logger";

let commandClient: Redis | null = null;
let subscriberClient: Redis | null = null;
const localBus = new EventEmitter();

function createRedisClient(role: string): Redis | null {
  const url = process.env.REDIS_URL;
  if (!url) return null;
  const client = new Redis(url, {
    maxRetriesPerRequest: 2,
  });
  client.on("error", (err) => {
    logger.error({ err, role }, "Redis client error");
  });
  return client;
}

export function getRedis(): Redis | null {
  if (commandClient !== null) return commandClient;
  commandClient = createRedisClient("command");
  return commandClient;
}

export async function redisReady(): Promise<boolean> {
  const redis = getRedis();
  if (!redis) return false;
  try {
    return (await redis.ping()) === "PONG";
  } catch (err) {
    logger.error({ err }, "Redis readiness check failed");
    return false;
  }
}

export async function closeRedisClients(): Promise<void> {
  const clients = [commandClient, subscriberClient].filter((client): client is Redis => client !== null);
  commandClient = null;
  subscriberClient = null;
  await Promise.all(clients.map((client) => client.quit().catch(() => client.disconnect())));
}

export async function redisPublish(channel: string, payload: string, options: { durable?: boolean } = {}): Promise<void> {
  const redis = getRedis();
  if (!redis) {
    if (options.durable) throw new Error("Redis unavailable for durable delivery");
    localBus.emit(channel, payload);
    return;
  }
  try {
    await redis.publish(channel, payload);
  } catch (err) {
    logger.error({ err, channel }, "Failed to publish Redis message");
    if (options.durable) throw err;
    localBus.emit(channel, payload);
  }
}

export function redisSubscribe(channel: string, handler: (payload: string) => void): () => void {
  const redisUrl = process.env.REDIS_URL;
  if (!redisUrl) {
    localBus.on(channel, handler);
    return () => localBus.off(channel, handler);
  }

  if (!subscriberClient) {
    subscriberClient = createRedisClient("subscriber");
    if (subscriberClient) {
      subscriberClient.on("message", (receivedChannel, payload) => {
        localBus.emit(receivedChannel, payload);
      });
      void subscriberClient.subscribe(channel).catch((err) => {
        logger.error({ err, channel }, "Failed to subscribe Redis channel");
      });
    }
  }

  localBus.on(channel, handler);
  return () => localBus.off(channel, handler);
}
