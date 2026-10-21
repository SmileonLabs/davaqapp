import { createHash, randomBytes } from "node:crypto";
import type { Server } from "node:http";
import type { Duplex } from "node:stream";
import { WebSocketServer, type WebSocket } from "ws";
import { logger } from "./logger";
import { isAllowedOrigin, normalizeOrigin } from "./origins";
import { getRedis, redisPublish, redisSubscribe } from "./redis";

const REALTIME_CHANNEL = "davaq:realtime:v1";
const HEARTBEAT_MS = 30_000;
const REALTIME_TICKET_TTL_SECONDS = 60;
const REALTIME_TICKET_PREFIX = "davaq:realtime-ticket:";

export type RealtimeEventType =
  | "shop.message.created"
  | "shop.thread.updated"
  | "message.created"
  | "message.updated"
  | "message.read"
  | "typing.updated"
  | "room.updated"
  | "call.created"
  | "call.updated"
  | "group_call.created"
  | "group_call.updated";

export interface RealtimeEvent {
  type: RealtimeEventType;
  userIds: string[];
  roomId?: string | null;
  callId?: string | null;
  actorUserId?: string | null;
  data?: Record<string, unknown>;
  createdAt: string;
}

type AuthedSocket = WebSocket & { userId?: string; alive?: boolean };

interface RealtimeTicketPayload {
  userId: string;
  origin: string | null;
}

export class RealtimeTicketUnavailableError extends Error {}

let socketsByUser = new Map<string, Set<AuthedSocket>>();
let attached = false;

export async function publishRealtimeEvent(
  event: Omit<RealtimeEvent, "createdAt" | "userIds"> & { userIds: string[] },
  options: { durable?: boolean } = {},
): Promise<void> {
  const userIds = Array.from(new Set(event.userIds.filter(Boolean)));
  if (userIds.length === 0) return;
  await redisPublish(
    REALTIME_CHANNEL,
    JSON.stringify({ ...event, userIds, createdAt: new Date().toISOString() }),
    options,
  );
}

function ticketKey(ticket: string): string {
  const hash = createHash("sha256").update(ticket).digest("hex");
  return `${REALTIME_TICKET_PREFIX}${hash}`;
}

export async function issueRealtimeTicket(userId: string, origin: string | null): Promise<string> {
  const redis = getRedis();
  if (!redis) throw new RealtimeTicketUnavailableError("Redis is required for realtime tickets");

  const ticket = randomBytes(32).toString("base64url");
  const payload: RealtimeTicketPayload = { userId, origin };
  try {
    const result = await redis.set(
      ticketKey(ticket),
      JSON.stringify(payload),
      "EX",
      REALTIME_TICKET_TTL_SECONDS,
      "NX",
    );
    if (result !== "OK") throw new Error("Ticket storage collision");
    return ticket;
  } catch (err) {
    logger.error({ err }, "Failed to issue realtime ticket");
    throw new RealtimeTicketUnavailableError("Realtime ticket storage is unavailable");
  }
}

async function consumeRealtimeTicket(ticket: string, origin: string | null): Promise<string | null> {
  if (ticket.length < 32) return null;
  const redis = getRedis();
  if (!redis) throw new RealtimeTicketUnavailableError("Redis is required for realtime tickets");

  try {
    const value = await redis.eval(
      "local value=redis.call('GET', KEYS[1]); if value then redis.call('DEL', KEYS[1]); end; return value",
      1,
      ticketKey(ticket),
    );
    if (typeof value !== "string") return null;
    const payload = JSON.parse(value) as Partial<RealtimeTicketPayload>;
    if (typeof payload.userId !== "string" || payload.origin !== origin) return null;
    return payload.userId;
  } catch (err) {
    logger.error({ err }, "Failed to consume realtime ticket");
    throw new RealtimeTicketUnavailableError("Realtime ticket storage is unavailable");
  }
}

function rejectUpgrade(socket: Duplex, statusCode: number, message: string): void {
  socket.write(
    `HTTP/1.1 ${statusCode} ${message}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`,
  );
  socket.destroy();
}

export function attachRealtimeServer(server: Server): void {
  if (attached) return;
  attached = true;

  const wss = new WebSocketServer({ noServer: true });

  server.on("upgrade", (req, socket, head) => {
    const url = new URL(req.url ?? "", "http://localhost");
    if (url.pathname !== "/api/realtime") {
      rejectUpgrade(socket, 404, "Not Found");
      return;
    }

    void (async () => {
      const rawOrigin = req.headers.origin;
      const origin = normalizeOrigin(rawOrigin);
      if (rawOrigin && (!origin || !isAllowedOrigin(origin))) {
        rejectUpgrade(socket, 403, "Forbidden");
        return;
      }

      const ticket = url.searchParams.get("ticket") ?? "";
      try {
        const userId = await consumeRealtimeTicket(ticket, origin);
        if (!userId) {
          rejectUpgrade(socket, 401, "Unauthorized");
          return;
        }
        wss.handleUpgrade(req, socket, head, (ws) => {
          (ws as AuthedSocket).userId = userId;
          wss.emit("connection", ws, req);
        });
      } catch (err) {
        if (err instanceof RealtimeTicketUnavailableError) {
          rejectUpgrade(socket, 503, "Service Unavailable");
          return;
        }
        logger.error({ err }, "Realtime upgrade failed");
        rejectUpgrade(socket, 500, "Internal Server Error");
      }
    })();
  });

  wss.on("connection", (ws: AuthedSocket) => {
    const userId = ws.userId;
    if (!userId) {
      ws.close(4401, "Unauthorized");
      return;
    }
    ws.alive = true;
    ws.on("pong", () => {
      ws.alive = true;
    });
    let userSockets = socketsByUser.get(userId);
    if (!userSockets) {
      userSockets = new Set();
      socketsByUser.set(userId, userSockets);
    }
    userSockets.add(ws);
    ws.send(JSON.stringify({ type: "connected", userId }));
    ws.on("close", () => removeSocket(userId, ws));
    ws.on("error", () => removeSocket(userId, ws));
  });

  const heartbeat = setInterval(() => {
    for (const ws of wss.clients as Set<AuthedSocket>) {
      if (ws.alive === false) {
        ws.terminate();
        continue;
      }
      ws.alive = false;
      ws.ping();
    }
  }, HEARTBEAT_MS);
  wss.on("close", () => clearInterval(heartbeat));

  redisSubscribe(REALTIME_CHANNEL, (payload) => {
    try {
      const event = JSON.parse(payload) as RealtimeEvent;
      deliverEvent(event);
    } catch (err) {
      logger.error({ err }, "Failed to parse realtime event");
    }
  });
}

function removeSocket(userId: string, ws: AuthedSocket): void {
  const userSockets = socketsByUser.get(userId);
  if (!userSockets) return;
  userSockets.delete(ws);
  if (userSockets.size === 0) socketsByUser.delete(userId);
}

function deliverEvent(event: RealtimeEvent): void {
  const data = JSON.stringify(event);
  for (const userId of event.userIds) {
    const userSockets = socketsByUser.get(userId);
    if (!userSockets) continue;
    for (const ws of userSockets) {
      if (ws.readyState === ws.OPEN) ws.send(data);
    }
  }
}
