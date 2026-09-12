import { describe, beforeEach, expect, it, vi } from "vitest";

process.env.DATABASE_URL ??= "postgres://anotherme:test@127.0.0.1:5432/anotherme";

const query = vi.fn();
const redisReady = vi.fn();

vi.mock("@workspace/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@workspace/db")>();
  return { ...actual, pool: { query } };
});
vi.mock("./lib/redis", () => ({ redisReady }));
vi.mock("@clerk/express", () => ({
  clerkMiddleware: () => (_req: unknown, _res: unknown, next: () => void) => next(),
  getAuth: () => ({ userId: null }),
  clerkClient: { users: { getUser: vi.fn() } },
}));
vi.mock("@clerk/shared/keys", () => ({ publishableKeyFromHost: () => undefined }));

const { default: request } = await import("supertest");
const { default: app } = await import("./app");

describe("API readiness and CORS", () => {
  beforeEach(() => {
    query.mockReset();
    redisReady.mockReset();
    query.mockResolvedValue({ rows: [{ ok: 1 }] });
    redisReady.mockResolvedValue(true);
  });

  it("returns ready only when PostgreSQL and Redis are available", async () => {
    const ready = await request(app).get("/api/healthz");
    expect(ready.status).toBe(200);
    expect(ready.body).toEqual({ status: "ok" });

    redisReady.mockResolvedValue(false);
    const unavailable = await request(app).get("/api/healthz");
    expect(unavailable.status).toBe(503);
    expect(unavailable.body).toEqual({ status: "unavailable" });
  });

  it("allows the configured PWA origin and rejects arbitrary browser origins", async () => {
    const allowed = await request(app)
      .get("/api/healthz")
      .set("Origin", "https://davaq.anothermeai.app");
    expect(allowed.status).toBe(200);
    expect(allowed.headers["access-control-allow-origin"]).toBe("https://davaq.anothermeai.app");
    expect(allowed.headers["access-control-expose-headers"]).toContain(
      "X-Edge-Request-Id",
    );

    const denied = await request(app)
      .get("/api/healthz")
      .set("Origin", "https://untrusted.example");
    expect(denied.status).toBe(403);
    expect(denied.headers["access-control-allow-origin"]).toBeUndefined();
  });

  it("preserves safe request ids and replaces untrusted correlation headers", async () => {
    const preserved = await request(app)
      .get("/api/healthz")
      .set("X-Request-Id", "request_12345678");
    expect(preserved.headers["x-request-id"]).toBe("request_12345678");

    const replaced = await request(app)
      .get("/api/healthz")
      .set("X-Request-Id", "user@example.com-not-safe");
    expect(replaced.headers["x-request-id"]).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
  });
});
