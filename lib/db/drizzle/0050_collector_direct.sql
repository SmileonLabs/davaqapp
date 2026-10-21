CREATE TABLE IF NOT EXISTS collector_direct_chats (
 room_id uuid PRIMARY KEY REFERENCES chat_rooms(id) ON DELETE CASCADE,
 owner_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 collector_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 last_processed_seq integer NOT NULL DEFAULT 0,
 lease_token uuid,
 lease_until timestamptz,
 next_at timestamptz NOT NULL DEFAULT now(),
 daily_date date NOT NULL DEFAULT CURRENT_DATE,
 daily_calls integer NOT NULL DEFAULT 0,
 attempt_seq integer NOT NULL DEFAULT 0,
 attempts integer NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS collector_direct_due_idx ON collector_direct_chats(next_at);
