-- Preserve Q conversation history while adopting messenger delivery/catch-up.
ALTER TABLE agent_messages ADD COLUMN seq bigserial;
WITH ordered AS (
 SELECT id,row_number() OVER(ORDER BY created_at,CASE role WHEN 'user' THEN 0 ELSE 1 END,id) n FROM agent_messages
) UPDATE agent_messages m SET seq=o.n FROM ordered o WHERE o.id=m.id;
SELECT setval(pg_get_serial_sequence('agent_messages','seq'),COALESCE((SELECT max(seq) FROM agent_messages),0)+1,false);
CREATE UNIQUE INDEX agent_messages_seq_idx ON agent_messages(seq);
CREATE INDEX agent_messages_owner_seq_idx ON agent_messages(user_id,seq);
ALTER TABLE agent_messages ADD COLUMN type text NOT NULL DEFAULT 'text' CHECK(type IN('text','image','file','sticker'));
ALTER TABLE agent_messages ADD COLUMN metadata jsonb NOT NULL DEFAULT '{}';
ALTER TABLE agent_messages ADD COLUMN reply_state text NOT NULL DEFAULT 'done' CHECK(reply_state IN('queued','running','done'));
ALTER TABLE agent_messages ADD COLUMN lease_token uuid;
CREATE INDEX agent_messages_queue_idx ON agent_messages(seq) WHERE reply_state<>'done';
CREATE TABLE chat_upload_owners (
 object_path text PRIMARY KEY, user_id uuid NOT NULL REFERENCES users(id), content_type text NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX chat_upload_owners_user_idx ON chat_upload_owners(user_id);
