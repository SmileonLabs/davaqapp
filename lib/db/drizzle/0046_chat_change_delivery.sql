-- Deferred capture observes the final transaction state. The per-room row lock
-- serializes revisions until COMMIT: a cursor can never skip an uncommitted event.
CREATE TABLE chat_sync_rooms (
  room_id uuid PRIMARY KEY REFERENCES chat_rooms(id) ON DELETE CASCADE,
  revision bigint NOT NULL DEFAULT 0
);
--> statement-breakpoint
CREATE TABLE chat_changes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id uuid NOT NULL REFERENCES chat_rooms(id) ON DELETE CASCADE,
  revision bigint NOT NULL,
  kind text NOT NULL,
  message_id uuid,
  actor_user_id uuid,
  audience_user_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(room_id, revision)
);
--> statement-breakpoint
CREATE TABLE chat_delivery_outbox (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  dedupe_key text NOT NULL UNIQUE,
  room_id uuid NOT NULL REFERENCES chat_rooms(id) ON DELETE CASCADE,
  actor_user_id uuid,
  audience_user_id uuid,
  channel text NOT NULL CHECK (channel IN ('realtime', 'push')),
  payload jsonb NOT NULL,
  attempts integer NOT NULL DEFAULT 0,
  available_at timestamptz NOT NULL DEFAULT now(),
  lease_until timestamptz,
  claim_token uuid,
  delivered_at timestamptz,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX chat_delivery_outbox_pending_idx ON chat_delivery_outbox(available_at, created_at) WHERE delivered_at IS NULL;
--> statement-breakpoint
CREATE FUNCTION capture_chat_change() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  row_data jsonb; old_data jsonb; rid uuid; mid uuid; actor uuid;
  audience uuid; event_kind text; rev bigint; event_id uuid;
BEGIN
  row_data := CASE WHEN TG_OP = 'DELETE' THEN to_jsonb(OLD) ELSE to_jsonb(NEW) END;
  old_data := CASE WHEN TG_OP = 'UPDATE' THEN to_jsonb(OLD) ELSE NULL END;
  IF TG_OP = 'UPDATE' AND row_data = old_data THEN RETURN NULL; END IF;
  IF TG_TABLE_NAME = 'messages' THEN
    rid := (row_data->>'room_id')::uuid; mid := (row_data->>'id')::uuid;
    actor := (row_data->>'sender_id')::uuid;
    event_kind := CASE WHEN TG_OP = 'INSERT' THEN 'message.created' ELSE 'message.updated' END;
  ELSIF TG_TABLE_NAME IN ('message_deletions', 'message_stickers', 'message_link_previews') THEN
    mid := (row_data->>'message_id')::uuid;
    SELECT room_id, sender_id INTO rid, actor FROM messages WHERE id = mid;
    event_kind := 'message.updated';
    IF TG_TABLE_NAME = 'message_deletions' THEN
      audience := (row_data->>'user_id')::uuid;
    END IF;
  ELSIF TG_TABLE_NAME = 'chat_room_members' THEN
    rid := (row_data->>'room_id')::uuid; actor := (row_data->>'user_id')::uuid;
    event_kind := CASE WHEN TG_OP = 'UPDATE' AND row_data->'last_read_seq' IS DISTINCT FROM old_data->'last_read_seq'
      THEN 'message.read' ELSE 'room.updated' END;
  ELSE
    rid := (row_data->>'id')::uuid;
    -- The counter/preview writes from message insertion are already covered.
    IF TG_OP = 'UPDATE' AND
      (row_data - ARRAY['last_message','last_message_at','last_message_seq','updated_at']) IS NOT DISTINCT FROM
      (old_data - ARRAY['last_message','last_message_at','last_message_seq','updated_at']) THEN RETURN NULL; END IF;
    event_kind := 'room.updated';
  END IF;
  -- Cascading room deletion must not recreate its state or delivery jobs.
  IF rid IS NULL OR NOT EXISTS(SELECT 1 FROM chat_rooms WHERE id = rid) THEN RETURN NULL; END IF;
  INSERT INTO chat_sync_rooms(room_id, revision) VALUES(rid, 1)
    ON CONFLICT(room_id) DO UPDATE SET revision = chat_sync_rooms.revision + 1
    RETURNING revision INTO rev;
  INSERT INTO chat_changes(room_id, revision, kind, message_id, actor_user_id, audience_user_id)
    VALUES(rid, rev, event_kind, mid, actor, audience) RETURNING id INTO event_id;
  INSERT INTO chat_delivery_outbox(dedupe_key,room_id,actor_user_id,audience_user_id,channel,payload)
    VALUES('realtime:' || event_id, rid, actor, audience, 'realtime',
      jsonb_build_object('type',event_kind,'roomId',rid,'actorUserId',actor,
        'data',jsonb_build_object('eventId',event_id,'changeRevision',rev::text,'messageId',mid)));
  RETURN NULL;
END $$;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER messages_change_capture AFTER INSERT OR UPDATE OR DELETE ON messages
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION capture_chat_change();
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER message_deletions_change_capture AFTER INSERT OR UPDATE OR DELETE ON message_deletions
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION capture_chat_change();
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER message_stickers_change_capture AFTER INSERT OR UPDATE OR DELETE ON message_stickers
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION capture_chat_change();
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER message_link_previews_change_capture AFTER INSERT OR UPDATE OR DELETE ON message_link_previews
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION capture_chat_change();
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER chat_members_change_capture AFTER INSERT OR UPDATE OR DELETE ON chat_room_members
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION capture_chat_change();
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER chat_rooms_change_capture AFTER UPDATE ON chat_rooms
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION capture_chat_change();
