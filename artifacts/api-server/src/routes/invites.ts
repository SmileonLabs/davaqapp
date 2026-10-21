import { Router, type IRouter } from "express";
import { z } from "zod/v4";
import { and, eq, gt, isNull, lte, or } from "drizzle-orm";
import { db } from "@workspace/db";
import { invitesTable, friendRequestsTable, friendshipsTable } from "@workspace/db";
import { requireAuth } from "../lib/auth";

const router: IRouter = Router();
const redeemInviteSchema = z.object({ inviteCode: z.string().trim().min(8).max(128) }).strict();

function generateCode(): string {
  return Date.now().toString(36) + Math.random().toString(36).substring(2, 9);
}

router.post("/invites", requireAuth, async (req, res): Promise<void> => {
  const userId = req.dbUser!.id;
  const expiredAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
  const [invite] = await db
    .insert(invitesTable)
    .values({ inviteCode: generateCode(), inviterUserId: userId, expiredAt })
    .returning();

  res.status(201).json({
    id: invite.id,
    inviteCode: invite.inviteCode,
    inviterUserId: invite.inviterUserId,
    status: invite.status,
    createdAt: invite.createdAt.toISOString(),
    expiredAt: invite.expiredAt?.toISOString() ?? null,
  });
});

router.post("/invites/redeem", requireAuth, async (req, res): Promise<void> => {
  const userId = req.dbUser!.id;
  const parsed = redeemInviteSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "inviteCode required" });
    return;
  }
  const { inviteCode } = parsed.data;

  const [invite] = await db
    .select()
    .from(invitesTable)
    .where(and(eq(invitesTable.inviteCode, inviteCode), eq(invitesTable.status, "active")));

  if (!invite) {
    res.status(400).json({ error: "Invalid or expired invite" });
    return;
  }

  if (invite.expiredAt && invite.expiredAt <= new Date()) {
    // An earlier request may already have consumed this invite while this
    // request waited. Never overwrite a committed "used" state with "expired".
    await db.update(invitesTable).set({ status: "expired" }).where(and(
      eq(invitesTable.id, invite.id), eq(invitesTable.status, "active"),
      lte(invitesTable.expiredAt, new Date()),
    ));
    res.status(400).json({ error: "Invite expired" });
    return;
  }

  if (invite.inviterUserId === userId) {
    res.status(400).json({ error: "Cannot use your own invite" });
    return;
  }

  const request = await db.transaction(async tx => {
    const [consumed] = await tx.update(invitesTable)
      .set({ status: "used", usedByUserId: userId })
      .where(and(eq(invitesTable.id, invite.id), eq(invitesTable.status, "active"),
        or(isNull(invitesTable.expiredAt), gt(invitesTable.expiredAt, new Date()))))
      .returning();
    if (!consumed) return null;
    const [created] = await tx.insert(friendRequestsTable)
      .values({ fromUserId: userId, toUserId: consumed.inviterUserId }).returning();
    return created;
  });
  if (!request) {
    res.status(400).json({ error: "Invalid or expired invite" });
    return;
  }

  res.json({
    id: request.id,
    fromUserId: request.fromUserId,
    toUserId: request.toUserId,
    status: request.status,
    createdAt: request.createdAt.toISOString(),
  });
});

export default router;
