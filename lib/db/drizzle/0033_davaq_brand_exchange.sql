
CREATE TABLE brand_campaigns (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), status text NOT NULL DEFAULT 'draft' CHECK(status IN('draft','published','paused','ended')),
 current_version_id uuid, budget integer NOT NULL DEFAULT 0 CHECK(budget>=0),
 held integer NOT NULL DEFAULT 0 CHECK(held>=0), spent integer NOT NULL DEFAULT 0 CHECK(spent>=0),
 created_by uuid NOT NULL REFERENCES users(id), created_at timestamptz NOT NULL DEFAULT now(),
 CHECK(held+spent<=budget)
);
CREATE TABLE brand_versions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), campaign_id uuid NOT NULL REFERENCES brand_campaigns(id),
 config jsonb NOT NULL, answers jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE brand_campaigns ADD CONSTRAINT brand_current_version_fk FOREIGN KEY(current_version_id) REFERENCES brand_versions(id);
CREATE TABLE brand_media (
 object_path text PRIMARY KEY, owner_id uuid NOT NULL REFERENCES users(id), width integer NOT NULL, height integer NOT NULL, duration double precision NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE brand_units (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), campaign_id uuid NOT NULL REFERENCES brand_campaigns(id),
 encrypted_code text NOT NULL, fingerprint text NOT NULL UNIQUE, valid_until timestamptz NOT NULL,
 state text NOT NULL DEFAULT 'available' CHECK(state IN('available','held','issued')),
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX brand_available_units ON brand_units(campaign_id,valid_until) WHERE state='available';
CREATE TABLE brand_participations (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL REFERENCES users(id),
 campaign_id uuid NOT NULL REFERENCES brand_campaigns(id), version_id uuid NOT NULL REFERENCES brand_versions(id),
 unit_id uuid NOT NULL REFERENCES brand_units(id), request_key text NOT NULL, cost integer NOT NULL CHECK(cost>=0),
 status text NOT NULL DEFAULT 'held' CHECK(status IN('held','playing','paused','succeeded','failed','abandoned','expired')),
 attempt integer NOT NULL DEFAULT 1 CHECK(attempt BETWEEN 1 AND 2),
 lease_hash text, lease_until timestamptz, sequence integer NOT NULL DEFAULT 0,
 progress double precision NOT NULL DEFAULT 0, credit double precision NOT NULL DEFAULT 0, found jsonb NOT NULL DEFAULT '[]', clicks integer NOT NULL DEFAULT 0,
 last_tick timestamptz, expires_at timestamptz NOT NULL DEFAULT now()+interval '20 minutes',
 created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(user_id,campaign_id), UNIQUE(user_id,request_key)
);
CREATE INDEX brand_participation_expiry ON brand_participations(expires_at) WHERE status IN('held','playing','paused');
CREATE UNIQUE INDEX brand_active_unit ON brand_participations(unit_id) WHERE status IN('held','playing','paused','succeeded');
CREATE TABLE brand_events (
 participation_id uuid NOT NULL REFERENCES brand_participations(id), request_key text NOT NULL, action text NOT NULL,
 response jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(participation_id,request_key)
);
CREATE TABLE brand_claims (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), participation_id uuid NOT NULL UNIQUE REFERENCES brand_participations(id),
 user_id uuid NOT NULL REFERENCES users(id), unit_id uuid NOT NULL UNIQUE REFERENCES brand_units(id),
 status text NOT NULL DEFAULT 'pending' CHECK(status IN('pending','issued','needs_reconciliation')),
 self_used_at timestamptz, issue text NOT NULL DEFAULT '', resolution text NOT NULL DEFAULT '',
 issued_at timestamptz, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE brand_outbox (
 claim_id uuid PRIMARY KEY REFERENCES brand_claims(id), done_at timestamptz, attempts integer NOT NULL DEFAULT 0
);
CREATE TABLE brand_budget_ledger (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), campaign_id uuid NOT NULL REFERENCES brand_campaigns(id),
 participation_id uuid REFERENCES brand_participations(id), kind text NOT NULL,
 amount integer NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(participation_id,kind)
);
CREATE TABLE brand_preferences (
 user_id uuid PRIMARY KEY REFERENCES users(id), categories jsonb NOT NULL DEFAULT '[]',
 region text NOT NULL DEFAULT '', personalized boolean NOT NULL DEFAULT false,
 version integer NOT NULL DEFAULT 1, updated_at timestamptz NOT NULL DEFAULT now()
);
