CREATE TABLE exchange_listings (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), owner_id uuid NOT NULL REFERENCES users(id),
 mode text NOT NULL CHECK(mode IN ('offer','want')), kind text NOT NULL CHECK(kind IN ('goods','service','experience')),
 category text NOT NULL, title text NOT NULL, description text NOT NULL DEFAULT '', wanted_text text NOT NULL DEFAULT '',
 wanted_categories jsonb NOT NULL DEFAULT '[]', location text NOT NULL DEFAULT '', delivery text NOT NULL DEFAULT 'online' CHECK(delivery IN ('online','offline','either')),
 duration_minutes integer NOT NULL DEFAULT 30 CHECK(duration_minutes BETWEEN 5 AND 1440), available_days jsonb NOT NULL DEFAULT '[]',
 ev integer CHECK(ev BETWEEN 1 AND 100000), image_key text, status text NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','pending','published','paused','closed')),
 terms text NOT NULL DEFAULT '', version integer NOT NULL DEFAULT 1, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX exchange_listings_browse_idx ON exchange_listings(status,mode,category,created_at DESC);
CREATE INDEX exchange_listings_owner_idx ON exchange_listings(owner_id,updated_at DESC);
CREATE TABLE exchange_favorites (
 user_id uuid NOT NULL REFERENCES users(id), listing_id uuid NOT NULL REFERENCES exchange_listings(id), created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(user_id,listing_id)
);
CREATE TABLE exchange_proposals (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), proposer_id uuid NOT NULL REFERENCES users(id), recipient_id uuid NOT NULL REFERENCES users(id),
 offer_id uuid NOT NULL REFERENCES exchange_listings(id), requested_id uuid NOT NULL REFERENCES exchange_listings(id),
 room_id uuid NOT NULL REFERENCES chat_rooms(id), version integer NOT NULL DEFAULT 1,
 status text NOT NULL DEFAULT 'negotiating' CHECK(status IN ('negotiating','reserved','in_progress','completed','cancel_requested','cancelled','declined','expired','disputed')),
 terms jsonb NOT NULL, snapshots jsonb NOT NULL, expires_at timestamptz NOT NULL DEFAULT now()+interval '7 days',
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), CHECK(proposer_id<>recipient_id), CHECK(offer_id<>requested_id)
);
CREATE INDEX exchange_proposals_participants_idx ON exchange_proposals(proposer_id,recipient_id,updated_at DESC);
CREATE INDEX exchange_proposals_room_idx ON exchange_proposals(room_id);
CREATE TABLE exchange_proposal_versions (
 proposal_id uuid NOT NULL REFERENCES exchange_proposals(id), version integer NOT NULL, actor_id uuid NOT NULL REFERENCES users(id),
 terms jsonb NOT NULL, snapshots jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(proposal_id,version)
);
CREATE TABLE exchange_acceptances (
 proposal_id uuid NOT NULL REFERENCES exchange_proposals(id), version integer NOT NULL, user_id uuid NOT NULL REFERENCES users(id), created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(proposal_id,version,user_id), FOREIGN KEY(proposal_id,version) REFERENCES exchange_proposal_versions(proposal_id,version)
);
CREATE TABLE exchange_reservations (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), proposal_id uuid NOT NULL REFERENCES exchange_proposals(id), listing_id uuid NOT NULL REFERENCES exchange_listings(id),
 owner_id uuid NOT NULL REFERENCES users(id), starts_at timestamptz NOT NULL, ends_at timestamptz NOT NULL, active boolean NOT NULL DEFAULT true,
 CHECK(ends_at>starts_at), UNIQUE(proposal_id,listing_id)
);
CREATE INDEX exchange_reservations_owner_idx ON exchange_reservations(owner_id,starts_at,ends_at) WHERE active;
CREATE INDEX exchange_reservations_listing_idx ON exchange_reservations(listing_id) WHERE active;
CREATE TABLE exchange_events (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), proposal_id uuid NOT NULL REFERENCES exchange_proposals(id), actor_id uuid NOT NULL REFERENCES users(id),
 kind text NOT NULL, data jsonb NOT NULL DEFAULT '{}', request_key text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(proposal_id,actor_id,request_key)
);
CREATE TABLE exchange_fulfillments (
 proposal_id uuid NOT NULL REFERENCES exchange_proposals(id), provider_id uuid NOT NULL REFERENCES users(id),
 provided_at timestamptz, received_at timestamptz, evidence text NOT NULL DEFAULT '', PRIMARY KEY(proposal_id,provider_id)
);
CREATE TABLE exchange_reviews (
 proposal_id uuid NOT NULL REFERENCES exchange_proposals(id), author_id uuid NOT NULL REFERENCES users(id), text text NOT NULL,
 feedback text NOT NULL DEFAULT '', created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(proposal_id,author_id)
);
CREATE TABLE agent_settings (
 user_id uuid PRIMARY KEY REFERENCES users(id), name text NOT NULL DEFAULT '큐', tone text NOT NULL DEFAULT 'warm',
 activity_learning boolean NOT NULL DEFAULT false, chat_learning boolean NOT NULL DEFAULT false, auto_search boolean NOT NULL DEFAULT false,
 allowed_room_ids jsonb NOT NULL DEFAULT '[]', consent_version integer NOT NULL DEFAULT 1, updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE agent_memories (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL REFERENCES users(id), label text NOT NULL,
 kind text NOT NULL DEFAULT 'preference', status text NOT NULL DEFAULT 'candidate' CHECK(status IN ('candidate','confirmed','rejected','deleted')),
 source_type text NOT NULL, source_id text NOT NULL, consent_version integer NOT NULL, expires_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), UNIQUE(user_id,source_type,source_id)
);
CREATE TABLE agent_growth_events (
 user_id uuid NOT NULL REFERENCES users(id), kind text NOT NULL, source_id text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(user_id,kind,source_id)
);
CREATE TABLE agent_messages (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL REFERENCES users(id), role text NOT NULL CHECK(role IN ('user','assistant')),
 content text NOT NULL, request_key text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(user_id,role,request_key)
);
CREATE INDEX agent_messages_owner_idx ON agent_messages(user_id,created_at DESC);
CREATE TABLE agent_search_jobs (
 user_id uuid PRIMARY KEY REFERENCES users(id), status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','running','done','failed')),
 requested_at timestamptz NOT NULL DEFAULT now(), started_at timestamptz, finished_at timestamptz, consent_version integer NOT NULL DEFAULT 1,
 result jsonb NOT NULL DEFAULT '[]', error text
);
CREATE TABLE agent_match_feedback (
 user_id uuid NOT NULL REFERENCES users(id), listing_id uuid NOT NULL REFERENCES exchange_listings(id),
 reason text NOT NULL CHECK(reason IN ('not_interested','schedule','location','scope')), created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(user_id,listing_id)
);
