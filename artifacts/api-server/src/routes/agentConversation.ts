import { Router } from "express";
import { z } from "zod/v4";
import { requireAuth } from "../lib/auth";
import { rateLimit } from "../lib/rateLimit";
import { handle } from "./exchange";
import {
  agentSendSchema,
  enqueueAgentMessage,
  listAgentConversation,
} from "../lib/agentConversation";
const router = Router();
router.use("/agents/me/conversation", requireAuth);
router.get(
  "/agents/me/conversation/messages",
  handle(async (req, res) => {
    const query = z
      .object({
        limit: z.coerce.number().int().min(1).max(100).default(50),
        afterSeq: z.coerce.number().int().nonnegative().optional(),
      })
      .parse(req.query);
    res.set("Cache-Control", "private, no-store");
    res.json(
      await listAgentConversation(req.dbUser!.id, query.limit, query.afterSeq),
    );
  }),
);
router.post(
  "/agents/me/conversation/messages",
  rateLimit({ name: "agent-messenger", limit: 60, windowSeconds: 60 }),
  handle(async (req, res) => {
    res.set("Cache-Control", "private, no-store");
    res.json(
      await enqueueAgentMessage(
        req.dbUser!.id,
        agentSendSchema.parse(req.body),
      ),
    );
  }),
);
export default router;
