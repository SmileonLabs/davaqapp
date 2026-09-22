CREATE TABLE exchange_wishes (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 title text NOT NULL, description text NOT NULL DEFAULT '', keywords jsonb NOT NULL DEFAULT '[]'::jsonb,
 kind text NOT NULL CHECK(kind IN('goods','service','experience')), category text NOT NULL,
 image_key text, status text NOT NULL DEFAULT 'active' CHECK(status IN('active','paused','fulfilled','deleted')),
 version integer NOT NULL DEFAULT 1 CHECK(version>0), request_key text NOT NULL, creation_hash text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 last_searched_at timestamptz, next_search_at timestamptz NOT NULL DEFAULT now(), candidate_count integer NOT NULL DEFAULT 0,
 candidate_keys jsonb NOT NULL DEFAULT '[]'::jsonb, last_notified_at timestamptz, search_lease uuid,
 CONSTRAINT exchange_wishes_user_request UNIQUE(user_id,request_key),
 CHECK(jsonb_typeof(keywords)='array' AND jsonb_array_length(keywords)<=6),
 CHECK(status='deleted' OR (char_length(title) BETWEEN 2 AND 80 AND jsonb_array_length(keywords)>=1))
);
--> statement-breakpoint
CREATE INDEX exchange_wishes_owner ON exchange_wishes(user_id,updated_at DESC) WHERE status<>'deleted';
CREATE INDEX exchange_wishes_due ON exchange_wishes(next_search_at) WHERE status='active';
--> statement-breakpoint
ALTER TABLE exchange_relays ADD COLUMN goal_context jsonb;
