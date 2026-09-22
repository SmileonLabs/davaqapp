import { Router, type IRouter } from "express";
import { z } from "zod/v4";
import { requireAuth } from "../lib/auth";
import { rateLimit } from "../lib/rateLimit";
import { handle } from "./exchange";
import { relayTermsInput } from "../lib/relayRules";
import {
  findRelayCandidates,
  listRelays,
  getRelay,
  createRelay,
  actOnRelay,
  notifyRelay,
} from "../lib/relayService";
const router: IRouter = Router();
router.use("/exchange/relays", requireAuth);
router.get(
  "/exchange/relays/candidates",
  rateLimit({ name: "relay-search", limit: 30, windowSeconds: 60 }),
  handle(async (req, res) => {
    res.json(await findRelayCandidates(req.dbUser!.id));
  }),
);
router.get(
  "/exchange/relays",
  handle(async (req, res) => {
    res.json(
      await listRelays(
        req.dbUser!.id,
        req.query.roomId ? z.uuid().parse(req.query.roomId) : null,
      ),
    );
  }),
);
router.post(
  "/exchange/relays",
  rateLimit({ name: "relay-create", limit: 10, windowSeconds: 3600 }),
  handle(async (req, res) => {
    const i = z
      .object({
        listingIds: z.array(z.uuid()).min(3).max(4),
        wishId: z.uuid().optional(),
        terms: relayTermsInput,
        requestKey: z.string().min(8).max(100),
      })
      .strict()
      .parse(req.body);
    const p = await createRelay(
      req.dbUser!.id,
      i.listingIds,
      i.terms,
      i.requestKey,
      i.wishId,
    );
    await notifyRelay(p, req.dbUser!.id);
    res.status(201).json(await getRelay(p.id, req.dbUser!.id));
  }),
);
router.get(
  "/exchange/relays/:id",
  handle(async (req, res) => {
    res.json(await getRelay(z.uuid().parse(req.params.id), req.dbUser!.id));
  }),
);
router.post(
  "/exchange/relays/:id/actions",
  rateLimit({ name: "relay-action", limit: 60, windowSeconds: 60 }),
  handle(async (req, res) => {
    const i = z
      .object({
        action: z.enum([
          "accept",
          "revise",
          "decline",
          "cancel",
          "approve_cancel",
          "provided",
          "received",
          "dispute",
        ]),
        version: z.number().int().positive(),
        requestKey: z.string().min(8).max(100),
        terms: relayTermsInput.optional(),
        note: z.string().trim().max(1500).optional(),
      })
      .strict()
      .parse(req.body);
    const p = await actOnRelay(
      z.uuid().parse(req.params.id),
      req.dbUser!.id,
      i,
    );
    await notifyRelay(p, req.dbUser!.id);
    res.json(await getRelay(p.id, req.dbUser!.id));
  }),
);
export default router;
