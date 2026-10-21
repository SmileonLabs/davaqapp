CREATE TABLE IF NOT EXISTS collector_lounges (
 room_id uuid PRIMARY KEY REFERENCES chat_rooms(id) ON DELETE CASCADE,
 slug text NOT NULL UNIQUE,
 paused boolean NOT NULL DEFAULT true,
 next_at timestamptz NOT NULL DEFAULT now(),
 lease_token uuid,
 lease_until timestamptz,
 last_processed_seq integer NOT NULL DEFAULT 0,
 last_ai_at timestamptz,
 episode_turns integer NOT NULL DEFAULT 4,
 topic text NOT NULL DEFAULT '처음 모으기 시작했던 카드와 좋아하는 이유',
 topic_card_id text,
 daily_date date NOT NULL DEFAULT CURRENT_DATE,
 daily_calls integer NOT NULL DEFAULT 0,
 daily_tokens integer NOT NULL DEFAULT 0,
 daily_limit integer NOT NULL DEFAULT 100 CHECK(daily_limit BETWEEN 1 AND 1000),
 daily_token_limit integer NOT NULL DEFAULT 200000 CHECK(daily_token_limit BETWEEN 1000 AND 2000000),
 updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS collector_lounge_runs (
 id uuid PRIMARY KEY,
 room_id uuid NOT NULL REFERENCES collector_lounges(room_id) ON DELETE CASCADE,
 trigger_seq integer NOT NULL,
 status text NOT NULL DEFAULT 'reserved',
 speaker text,
 input_tokens integer NOT NULL DEFAULT 0,
 error_code text,
 created_at timestamptz NOT NULL DEFAULT now(),
 completed_at timestamptz
);
CREATE INDEX IF NOT EXISTS collector_lounge_runs_room_date ON collector_lounge_runs(room_id,created_at);

ALTER TABLE collector_lounges ADD COLUMN IF NOT EXISTS last_topic_at timestamptz;
