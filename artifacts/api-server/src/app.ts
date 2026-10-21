import express, { type Express } from "express";
import { randomUUID } from "node:crypto";
import cors from "cors";
import pinoHttp from "pino-http";
import { clerkMiddleware } from "@clerk/express";
import { publishableKeyFromHost } from "@clerk/shared/keys";
import {
  CLERK_PROXY_PATH,
  clerkProxyMiddleware,
  getClerkProxyHost,
} from "./middlewares/clerkProxyMiddleware";
import healthRouter from "./routes/health";
import router from "./routes";
import { logger } from "./lib/logger";
import { isAllowedOrigin } from "./lib/origins";
import livekitWebhookRouter from "./routes/livekitWebhooks";

const app: Express = express();

function validCorrelationId(value: string | string[] | undefined): string | undefined {
  const candidate = Array.isArray(value) ? value[0] : value;
  if (!candidate) return undefined;
  return /^[A-Za-z0-9_-]{8,80}$/.test(candidate) ? candidate : undefined;
}

app.use(
  pinoHttp({
    logger,
    genReqId(req, res) {
      const requestId = validCorrelationId(req.headers["x-request-id"]) ?? randomUUID();
      res.setHeader("X-Request-Id", requestId);
      return requestId;
    },
    customProps(req) {
      const callAttemptId = validCorrelationId(req.headers["x-call-attempt-id"]);
      const edgeRequestId = validCorrelationId(req.headers["x-edge-request-id"]);
      return {
        ...(callAttemptId ? { callAttemptId } : {}),
        ...(edgeRequestId ? { edgeRequestId } : {}),
      };
    },
    serializers: {
      req(req) {
        return { id: req.id, method: req.method, url: req.url?.split("?")[0] };
      },
      res(res) {
        return { statusCode: res.statusCode };
      },
    },
  }),
);

app.use(CLERK_PROXY_PATH, clerkProxyMiddleware());
app.use((req, res, next) => {
  const origin = req.get("origin");
  const appleReturn = req.method === "POST" && req.path === "/api/auth/social/apple/callback" && origin === "https://appleid.apple.com";
  if (origin && !isAllowedOrigin(origin) && !appleReturn) {
    res.status(403).json({ error: "Origin is not allowed" });
    return;
  }
  next();
});
app.use(
  cors({
    credentials: true,
    exposedHeaders: ["X-Request-Id", "X-Edge-Request-Id"],
    // The preceding middleware rejects untrusted browser origins. React Native
    // requests have no Origin header and remain supported.
    origin: true,
  }),
);
// LiveKit verifies the signature over the exact request bytes, so this endpoint
// must be mounted before the global JSON parser. It is intentionally outside
// Clerk auth; WebhookReceiver authenticates the LiveKit Authorization token.
app.use("/api", livekitWebhookRouter);
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use("/api", healthRouter);

const legacyClerkMiddleware = clerkMiddleware((req) => ({
    publishableKey: publishableKeyFromHost(
      getClerkProxyHost(req) ?? "",
      process.env.CLERK_PUBLISHABLE_KEY,
    ),
  }));
app.use((req, res, next) => {
  const publicSocial = req.path.startsWith("/api/auth/social/") && req.path !== "/api/auth/social/link";
  if (publicSocial || req.get("authorization")?.startsWith("Bearer dvq_")) { next(); return; }
  legacyClerkMiddleware(req, res, next);
});

app.use("/api", router);

export default app;
