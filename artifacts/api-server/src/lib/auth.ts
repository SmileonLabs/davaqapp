import { getAuth, clerkClient } from "@clerk/express";
import type { Request, Response, NextFunction } from "express";
import { db } from "@workspace/db";
import { usersTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import type { User } from "@workspace/db";
import { logger } from "./logger";
import { ensureBibiFriendshipForUser } from "./officialAccounts";
import { resolveSocialBearer } from "./socialSessions";

declare global {
  namespace Express {
    interface Request {
      clerkUserId?: string;
      dbUser?: User;
    }
  }
}

export async function requireAuth(req: Request, res: Response, next: NextFunction): Promise<void> {
  if (req.get("authorization")?.startsWith("Bearer dvq_")) {
    const identity = await resolveSocialBearer(req);
    if (!identity) { res.status(401).json({ error: "Unauthorized" }); return; }
    const [user] = await db.select().from(usersTable).where(eq(usersTable.id, identity.id));
    if (!user) { res.status(401).json({ error: "Unauthorized" }); return; }
    req.dbUser = user;
    req.clerkUserId = user.clerkId;
    next();
    return;
  }
  const auth = getAuth(req);
  if (!auth?.userId) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const clerkUserId = auth.userId;
  req.clerkUserId = clerkUserId;

  let [user] = await db.select().from(usersTable).where(eq(usersTable.clerkId, clerkUserId));
  let provisionedInThisRequest = false;

  if (!user) {
    try {
      const clerkUser = await clerkClient.users.getUser(clerkUserId);

      // Anchor identity on the verified PRIMARY email only. Using
      // emailAddresses[0] (which may be unverified or non-primary) as the
      // relink key would let someone claim another user's account by adding
      // their email. Require a verified primary email before provisioning.
      const primaryEmail = clerkUser.emailAddresses.find(
        (e) => e.id === clerkUser.primaryEmailAddressId,
      );
      const email = primaryEmail?.emailAddress ?? "";
      const isVerified = primaryEmail?.verification?.status === "verified";

      if (!email || !isVerified) {
        logger.error(
          { clerkUserId },
          "Cannot provision user without a verified primary email",
        );
        res.status(403).json({ error: "A verified email is required" });
        return;
      }

      const nickname =
        clerkUser.firstName ??
        clerkUser.username ??
        email.split("@")[0] ??
        "User";

      // A user with this verified email may already exist from a previous
      // Clerk instance (test -> live migration), which changes the clerk_id
      // while the email stays the same. The email column is unique, so a plain
      // insert would fail with a duplicate-key error. Relink the existing row
      // to the current clerk_id instead of inserting.
      const [existing] = await db
        .select()
        .from(usersTable)
        .where(eq(usersTable.email, email));
      if (existing?.clerkId.startsWith("davaq_social_")) {
        res.status(403).json({ error: "SOCIAL_SIGNUP_REQUIRED" });
        return;
      }
      if (existing) {
        [user] = await db
          .update(usersTable)
          .set({ clerkId: clerkUserId })
          .where(eq(usersTable.id, existing.id))
          .returning();
        provisionedInThisRequest = true;
      } else {
        // Clerk remains a bridge for existing members, never a new signup path.
        if (process.env.DAVAQ_SOCIAL_AUTH_ENABLED !== "true") {
          [user] = await db.insert(usersTable).values({ clerkId: clerkUserId, email, nickname }).returning();
          provisionedInThisRequest = true;
        } else {
        res.status(403).json({ error: "SOCIAL_SIGNUP_REQUIRED", message: "신규 가입은 Google 또는 Apple로 진행해 주세요." });
        return;
        }
      }
    } catch (err) {
      logger.error({ err }, "Failed to provision user");
      res.status(500).json({ error: "Failed to provision user" });
      return;
    }
  }

  if (provisionedInThisRequest && process.env.DAVAQ_LEGACY_PERSONA_ENABLED === "true") {
    try {
      await ensureBibiFriendshipForUser(user.id);
    } catch (err) {
      logger.error({ err, userId: user.id }, "Failed to attach BIBI Official friend");
    }
  }

  req.dbUser = user;
  next();
}
