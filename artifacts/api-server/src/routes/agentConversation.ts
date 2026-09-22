import { Router } from "express";
import { z } from "zod/v4";
import { requireAuth } from "../lib/auth";
import { isValidStickerCode } from "../lib/chatMessagePolicy";
import { rateLimit } from "../lib/rateLimit";
import { handle } from "./exchange";
import {
  agentSendSchema,
  enqueueAgentMessage,
  listAgentConversation,
  getAgentMessage,
  getAgentPin,
  changeAgentMessage,
  clearAgentPin,
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
        preview: z.enum(["true", "false"]).optional(),
      })
      .parse(req.query);
    res.set("Cache-Control", "private, no-store");
    res.json(
      await listAgentConversation(
        req.dbUser!.id,
        query.limit,
        query.afterSeq,
        query.preview === "true",
      ),
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
const messageId = (value: unknown) => z.string().uuid().parse(value);
router.get(
  "/agents/me/conversation/pin",
  handle(async (req, res) => {
    res.set("Cache-Control", "private, no-store");
    res.json(await getAgentPin(req.dbUser!.id));
  }),
);
router.delete(
  "/agents/me/conversation/pin",
  handle(async (req, res) => {
    await clearAgentPin(req.dbUser!.id);
    res.json({ ok: true });
  }),
);
router.get(
  "/agents/me/conversation/messages/:messageId",
  handle(async (req, res) => {
    res.set("Cache-Control", "private, no-store");
    res.json(
      await getAgentMessage(req.dbUser!.id, messageId(req.params.messageId)),
    );
  }),
);
router.post(
  "/agents/me/conversation/messages/:messageId/delete",
  handle(async (req, res) => {
    const { scope } = z
      .object({ scope: z.enum(["me", "everyone"]) })
      .strict()
      .parse(req.body);
    res.json(
      await changeAgentMessage(
        req.dbUser!.id,
        messageId(req.params.messageId),
        "delete",
        scope,
      ),
    );
  }),
);
router.post(
  "/agents/me/conversation/messages/:messageId/pin",
  handle(async (req, res) => {
    res.json(
      await changeAgentMessage(
        req.dbUser!.id,
        messageId(req.params.messageId),
        "pin",
      ),
    );
  }),
);
router.post(
  "/agents/me/conversation/messages/:messageId/sticker",
  handle(async (req, res) => {
    const { code } = z
      .object({
        code: z
          .string()
          .refine(isValidStickerCode, "올바른 스티커를 선택해 주세요."),
      })
      .strict()
      .parse(req.body);
    res.json(
      await changeAgentMessage(
        req.dbUser!.id,
        messageId(req.params.messageId),
        "sticker",
        code,
      ),
    );
  }),
);
export default router;
