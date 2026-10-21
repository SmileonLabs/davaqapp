import { afterEach, expect, it, vi } from "vitest";
vi.stubEnv("REDIS_URL", "redis://fixture.invalid:6379");
vi.mock("ioredis", () => ({
  default: class {
    on() {
      return this;
    }
    async subscribe() {}
    async publish() {
      throw new Error("fixture Redis outage");
    }
    async quit() {}
  },
}));
vi.mock("./logger", () => ({ logger: { error: vi.fn(), warn: vi.fn() } }));
import { closeRedisClients, redisPublish, redisSubscribe } from "./redis";
import { publishRealtimeEvent } from "./realtime";
afterEach(async () => {
  await closeRedisClients();
});
it("durable realtime rejects broker failure instead of acknowledging a local-only fallback", async () => {
  const receive = vi.fn();
  const unsubscribe = redisSubscribe("davaq:realtime:v1", receive);
  try {
    await expect(
      publishRealtimeEvent(
        { type: "message.created", userIds: ["member"], roomId: "room" },
        { durable: true },
      ),
    ).rejects.toThrow("fixture Redis outage");
    expect(receive).not.toHaveBeenCalled();
  } finally {
    unsubscribe();
  }
});
it("existing nondurable callers retain their local fallback", async () => {
  const receive = vi.fn();
  const unsubscribe = redisSubscribe("compatibility", receive);
  try {
    await redisPublish("compatibility", "event");
    expect(receive).toHaveBeenCalledWith("event");
  } finally {
    unsubscribe();
  }
});
