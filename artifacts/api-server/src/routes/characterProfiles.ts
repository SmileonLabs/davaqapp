import { Router, type IRouter } from "express";
import { z } from "zod/v4";
import { and, desc, eq, isNull } from "drizzle-orm";
import {
  characterProfileFollowsTable,
  characterProfileInventoryTable,
  characterProfileNotificationsTable,
  characterProfilesTable,
  db,
} from "@workspace/db";
import { requireAuth } from "../lib/auth";
import {
  activateCharacterProfile,
  ensureCharacterProfileState,
  updateCharacterProfile,
  getPublicCharacterProfile,
  setCharacterProfileFollowing,
  archiveCharacterProfile,
  createFanCharacterProfile,
  resolveCharacterProfileActor,
} from "../lib/characterProfiles";
import { listPublicStarFeedPostsByAuthor } from "../lib/starFeed";
import { equipAvatarItem, listAvatarCatalog, purchaseAvatarItem } from "../lib/avatarCatalog";

const router: IRouter = Router();
router.use((req, res, next) => {
  if (process.env.DAVAQ_LEGACY_PERSONA_ENABLED !== "true" && (/\/(avatar|inventory)(\/|$)/.test(req.path) || (req.method === "POST" && req.path === "/users/me/profiles"))) { res.status(404).json({ error: "DAVAQ_FEATURE_NOT_AVAILABLE" }); return; }
  next();
});
const activateSchema = z.object({ profileId: z.uuid() });
const publicProfileQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(60).optional().default(30),
  cursor: z.iso.datetime().optional(),
});
const socialScopeQuerySchema = z.object({
  scope: z.enum(["followers", "following"]).optional().default("followers"),
});
const updateSchema = z.object({
  displayName: z.string().trim().min(1).max(30).optional(),
  profileImageUrl: z.string().max(1024).nullable().optional(),
  statusMessage: z.string().trim().max(100).nullable().optional(),
}).refine((body) => Object.keys(body).length > 0, { message: "At least one field is required" });
const createFanSchema = z.object({
  displayName: z.string().trim().min(1).max(30),
  handle: z.string().trim().min(3).max(24).optional(),
  profileImageUrl: z.string().max(1024).nullable().optional(),
  customizeDefault: z.boolean().optional().default(false),
  customization: z.object({
    ageStyle: z.string().trim().min(1).max(30).optional(),
    hairStyle: z.string().trim().min(1).max(30).optional(),
    skinTone: z.string().trim().min(1).max(30).optional(),
    genderExpression: z.string().trim().min(1).max(30).optional(),
    gender: z.enum(["man", "woman"]).optional(),
    baseKey: z.string().trim().min(1).max(120).optional(),
    headKey: z.string().trim().min(1).max(120).optional(),
    wearKey: z.string().trim().min(1).max(120).optional(),
  }).passthrough(),
});
const avatarItemSchema = z.object({ itemKey: z.string().trim().min(1).max(120) });

function avatarErrorResponse(error: unknown): { status: number; code: string } {
  const code = (error as Error & { code?: string }).code ?? "AVATAR_UPDATE_FAILED";
  if (code === "PROFILE_NOT_FOUND" || code === "AVATAR_ITEM_NOT_FOUND") return { status: 404, code };
  if (code === "PROFILE_NOT_OWNED") return { status: 403, code };
  return { status: 409, code };
}

router.get("/users/me/profiles", requireAuth, async (req, res): Promise<void> => {
  res.json(await ensureCharacterProfileState(req.dbUser!.id));
});

router.get("/users/me/profile-context", requireAuth, async (req, res): Promise<void> => {
  try {
    const requested = req.header("x-character-profile-id");
    res.json(await resolveCharacterProfileActor(req.dbUser!.id, requested));
  } catch (error) {
    const code = (error as Error & { code?: string }).code;
    res.status(code === "PROFILE_NOT_OWNED" ? 403 : 409).json({ error: code ?? "PROFILE_CONTEXT_INVALID" });
  }
});

router.post("/users/me/fan-profiles", requireAuth, async (req, res): Promise<void> => {
  const parsed = createFanSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "INVALID_FAN_PROFILE" }); return; }
  try {
    res.status(201).json(await createFanCharacterProfile(req.dbUser!.id, parsed.data));
  } catch (error) {
    const code = (error as Error & { code?: string }).code;
    if (code === "FAN_EXPANSION_LOCKED") { res.status(409).json({ error: code }); return; }
    if ((error as { code?: string }).code === "23505") { res.status(409).json({ error: "PROFILE_HANDLE_TAKEN" }); return; }
    throw error;
  }
});

router.patch("/users/me/active-profile", requireAuth, async (req, res): Promise<void> => {
  const parsed = activateSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "A valid profileId is required" });
    return;
  }
  try {
    res.json(await activateCharacterProfile(req.dbUser!.id, parsed.data.profileId));
  } catch (error) {
    const code = (error as Error & { code?: string }).code;
    if (code === "PROFILE_NOT_FOUND") {
      res.status(404).json({ error: code });
      return;
    }
    if (code === "PROFILE_UNAVAILABLE") {
      res.status(409).json({ error: code });
      return;
    }
    throw error;
  }
});

router.patch("/users/me/profiles/:profileId", requireAuth, async (req, res): Promise<void> => {
  const profileId = Array.isArray(req.params.profileId) ? req.params.profileId[0] : req.params.profileId;
  const parsedId = z.uuid().safeParse(profileId);
  const parsedBody = updateSchema.safeParse(req.body);
  if (!parsedId.success || !parsedBody.success) {
    res.status(400).json({ error: "Invalid profile update" });
    return;
  }
  try {
    res.json(await updateCharacterProfile(req.dbUser!.id, parsedId.data, parsedBody.data));
  } catch (error) {
    if ((error as Error & { code?: string }).code === "INVALID_DAVAQ_AVATAR") { res.status(400).json({ error: "INVALID_DAVAQ_AVATAR" }); return; }
    if ((error as Error & { code?: string }).code === "PROFILE_NOT_FOUND") {
      res.status(404).json({ error: "PROFILE_NOT_FOUND" });
      return;
    }
    throw error;
  }
});

router.delete("/users/me/profiles/:profileId", requireAuth, async (req, res): Promise<void> => {
  const profileId = Array.isArray(req.params.profileId) ? req.params.profileId[0] : req.params.profileId;
  if (!z.uuid().safeParse(profileId).success) { res.status(400).json({ error: "INVALID_PROFILE_ID" }); return; }
  try {
    res.json(await archiveCharacterProfile(req.dbUser!.id, profileId));
  } catch (error) {
    const code = (error as Error & { code?: string }).code;
    if (code === "PROFILE_NOT_FOUND") { res.status(404).json({ error: code }); return; }
    if (code === "LAST_PROFILE_REQUIRED" || code === "REPLACEMENT_PROFILE_REQUIRED") { res.status(409).json({ error: code }); return; }
    throw error;
  }
});

router.get("/users/me/profiles/:profileId/inventory", requireAuth, async (req, res): Promise<void> => {
  const profileId = Array.isArray(req.params.profileId) ? req.params.profileId[0] : req.params.profileId;
  if (!z.uuid().safeParse(profileId).success) { res.status(400).json({ error: "INVALID_PROFILE_ID" }); return; }
  try {
    await resolveCharacterProfileActor(req.dbUser!.id, profileId);
  } catch {
    res.status(403).json({ error: "PROFILE_NOT_OWNED" });
    return;
  }
  const items = await db.select().from(characterProfileInventoryTable)
    .where(eq(characterProfileInventoryTable.profileId, profileId))
    .orderBy(desc(characterProfileInventoryTable.updatedAt));
  res.json({ profileId, items });
});

router.get("/users/me/profiles/:profileId/avatar", requireAuth, async (req, res): Promise<void> => {
  const profileId = Array.isArray(req.params.profileId) ? req.params.profileId[0] : req.params.profileId;
  if (!z.uuid().safeParse(profileId).success) { res.status(400).json({ error: "INVALID_PROFILE_ID" }); return; }
  try {
    await resolveCharacterProfileActor(req.dbUser!.id, profileId);
    const result = await listAvatarCatalog(profileId);
    if (!result) { res.status(404).json({ error: "AVATAR_NOT_AVAILABLE" }); return; }
    res.json(result);
  } catch (error) {
    const response = avatarErrorResponse(error);
    res.status(response.status).json({ error: response.code });
  }
});

router.post("/users/me/profiles/:profileId/avatar/purchase", requireAuth, async (req, res): Promise<void> => {
  const profileId = Array.isArray(req.params.profileId) ? req.params.profileId[0] : req.params.profileId;
  const parsed = avatarItemSchema.safeParse(req.body);
  if (!z.uuid().safeParse(profileId).success || !parsed.success) { res.status(400).json({ error: "INVALID_AVATAR_PURCHASE" }); return; }
  try {
    res.json(await purchaseAvatarItem(req.dbUser!.id, profileId, parsed.data.itemKey));
  } catch (error) {
    const response = avatarErrorResponse(error);
    res.status(response.status).json({ error: response.code });
  }
});

router.patch("/users/me/profiles/:profileId/avatar/equipment", requireAuth, async (req, res): Promise<void> => {
  const profileId = Array.isArray(req.params.profileId) ? req.params.profileId[0] : req.params.profileId;
  const parsed = avatarItemSchema.safeParse(req.body);
  if (!z.uuid().safeParse(profileId).success || !parsed.success) { res.status(400).json({ error: "INVALID_AVATAR_EQUIPMENT" }); return; }
  try {
    res.json(await equipAvatarItem(req.dbUser!.id, profileId, parsed.data.itemKey));
  } catch (error) {
    const response = avatarErrorResponse(error);
    res.status(response.status).json({ error: response.code });
  }
});

router.get("/users/me/profile-notifications", requireAuth, async (req, res): Promise<void> => {
  const actor = await resolveCharacterProfileActor(req.dbUser!.id, req.header("x-character-profile-id"));
  const items = await db.select().from(characterProfileNotificationsTable)
    .where(eq(characterProfileNotificationsTable.profileId, actor.id))
    .orderBy(desc(characterProfileNotificationsTable.createdAt))
    .limit(100);
  res.json({ profileId: actor.id, items });
});

router.patch("/users/me/profile-notifications/:notificationId/read", requireAuth, async (req, res): Promise<void> => {
  const notificationId = Array.isArray(req.params.notificationId) ? req.params.notificationId[0] : req.params.notificationId;
  if (!z.uuid().safeParse(notificationId).success) { res.status(400).json({ error: "INVALID_NOTIFICATION_ID" }); return; }
  const actor = await resolveCharacterProfileActor(req.dbUser!.id, req.header("x-character-profile-id"));
  const [updated] = await db.update(characterProfileNotificationsTable).set({ readAt: new Date() })
    .where(and(eq(characterProfileNotificationsTable.id, notificationId), eq(characterProfileNotificationsTable.profileId, actor.id)))
    .returning();
  if (!updated) { res.status(404).json({ error: "NOTIFICATION_NOT_FOUND" }); return; }
  res.json(updated);
});

router.get("/users/me/profile-social", requireAuth, async (req, res): Promise<void> => {
  const parsedQuery = socialScopeQuerySchema.safeParse(req.query);
  if (!parsedQuery.success) {
    res.status(400).json({ error: "INVALID_SOCIAL_SCOPE" });
    return;
  }

  const actor = await resolveCharacterProfileActor(req.dbUser!.id, req.header("x-character-profile-id"));
  const isFollowers = parsedQuery.data.scope === "followers";
  const profiles = await db
    .select({
      id: characterProfilesTable.id,
      type: characterProfilesTable.type,
      handle: characterProfilesTable.handle,
      displayName: characterProfilesTable.displayName,
      profileImageUrl: characterProfilesTable.profileImageUrl,
      statusMessage: characterProfilesTable.statusMessage,
      followedAt: characterProfileFollowsTable.createdAt,
    })
    .from(characterProfileFollowsTable)
    .innerJoin(
      characterProfilesTable,
      eq(
        characterProfilesTable.id,
        isFollowers
          ? characterProfileFollowsTable.followerProfileId
          : characterProfileFollowsTable.followedProfileId,
      ),
    )
    .where(
      and(
        eq(
          isFollowers
            ? characterProfileFollowsTable.followedProfileId
            : characterProfileFollowsTable.followerProfileId,
          actor.id,
        ),
        eq(characterProfilesTable.status, "active"),
        isNull(characterProfilesTable.archivedAt),
      ),
    )
    .orderBy(desc(characterProfileFollowsTable.createdAt))
    .limit(100);

  res.json({ profileId: actor.id, scope: parsedQuery.data.scope, profiles });
});

router.get("/profiles/:profileId", requireAuth, async (req, res): Promise<void> => {
  const profileId = Array.isArray(req.params.profileId) ? req.params.profileId[0] : req.params.profileId;
  const parsedId = z.uuid().safeParse(profileId);
  if (!parsedId.success) {
    res.status(400).json({ error: "Invalid profile id" });
    return;
  }
  const parsedQuery = publicProfileQuerySchema.safeParse(req.query);
  if (!parsedQuery.success) {
    res.status(400).json({ error: "Invalid profile query" });
    return;
  }
  const profile = await getPublicCharacterProfile(req.dbUser!.id, parsedId.data);
  if (!profile) {
    res.status(404).json({ error: "PROFILE_NOT_FOUND" });
    return;
  }
  const posts = await listPublicStarFeedPostsByAuthor(
    req.dbUser!.id,
    profile.ownerUserId,
    parsedQuery.data.limit,
    undefined,
    parsedQuery.data.cursor,
    profile.id,
  );
  const { ownerUserId: _ownerUserId, ...publicProfile } = profile;
  res.json({ profile: publicProfile, posts });
});

router.post("/profiles/:profileId/follow", requireAuth, async (req, res): Promise<void> => {
  const profileId = Array.isArray(req.params.profileId) ? req.params.profileId[0] : req.params.profileId;
  if (!z.uuid().safeParse(profileId).success) {
    res.status(400).json({ error: "Invalid profile id" });
    return;
  }
  try {
    const result = await setCharacterProfileFollowing(req.dbUser!.id, profileId, true);
    if (!result) { res.status(404).json({ error: "PROFILE_NOT_FOUND" }); return; }
    res.json(result);
  } catch (error) {
    if ((error as Error & { code?: string }).code === "OWN_PROFILE") { res.status(409).json({ error: "OWN_PROFILE" }); return; }
    throw error;
  }
});

router.delete("/profiles/:profileId/follow", requireAuth, async (req, res): Promise<void> => {
  const profileId = Array.isArray(req.params.profileId) ? req.params.profileId[0] : req.params.profileId;
  if (!z.uuid().safeParse(profileId).success) {
    res.status(400).json({ error: "Invalid profile id" });
    return;
  }
  try {
    const result = await setCharacterProfileFollowing(req.dbUser!.id, profileId, false);
    if (!result) { res.status(404).json({ error: "PROFILE_NOT_FOUND" }); return; }
    res.json(result);
  } catch (error) {
    if ((error as Error & { code?: string }).code === "OWN_PROFILE") { res.status(409).json({ error: "OWN_PROFILE" }); return; }
    throw error;
  }
});

export default router;
