import { Router, type IRouter } from "express";
import { z } from "zod/v4";
import { pool } from "@workspace/db";
import { requireAuth } from "../lib/auth";
import { rateLimit } from "../lib/rateLimit";
import { handle } from "./exchange";
import {
  createWishInput,
  updateWishInput,
  wishDraftInput,
} from "../lib/wishInput";
import {
  createWish,
  updateWish,
  ownedWish,
  wishDto,
  draftWish,
  searchWish,
} from "../lib/wishService";
const router: IRouter = Router();
router.use("/exchange/wishes", requireAuth);
router.get(
  "/exchange/wishes",
  handle(async (req, res) => {
    res.json({
      items: (
        await pool.query(
          "SELECT * FROM exchange_wishes WHERE user_id=$1 AND status<>'deleted' ORDER BY updated_at DESC,id LIMIT 50",
          [req.dbUser!.id],
        )
      ).rows.map(wishDto),
    });
  }),
);
router.post(
  "/exchange/wishes/draft",
  rateLimit({ name: "wish-draft", limit: 12, windowSeconds: 3600 }),
  handle(async (req, res) => {
    res.json(await draftWish(req.dbUser!.id, wishDraftInput.parse(req.body)));
  }),
);
router.post(
  "/exchange/wishes",
  rateLimit({ name: "wish-create", limit: 30, windowSeconds: 3600 }),
  handle(async (req, res) => {
    res
      .status(201)
      .json(await createWish(req.dbUser!.id, createWishInput.parse(req.body)));
  }),
);
router.get(
  "/exchange/wishes/:id/candidates",
  rateLimit({ name: "wish-candidates", limit: 20, windowSeconds: 60 }),
  handle(async (req, res) => {
    res.json(await searchWish(req.dbUser!.id, z.uuid().parse(req.params.id)));
  }),
);
router.get(
  "/exchange/wishes/:id",
  handle(async (req, res) => {
    res.json(
      wishDto(await ownedWish(req.dbUser!.id, z.uuid().parse(req.params.id))),
    );
  }),
);
router.patch(
  "/exchange/wishes/:id",
  handle(async (req, res) => {
    res.json(
      await updateWish(
        req.dbUser!.id,
        z.uuid().parse(req.params.id),
        updateWishInput.parse(req.body),
      ),
    );
  }),
);
export default router;
