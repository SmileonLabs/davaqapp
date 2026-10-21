-- Match the existing profile-scoped personal deletion schema on migrated databases.
-- Nullable preserves historical user-scoped deletions and existing unique keys.
ALTER TABLE "message_deletions"
  ADD COLUMN IF NOT EXISTS "profile_id" uuid
  REFERENCES "character_profiles"("id") ON DELETE SET NULL;
