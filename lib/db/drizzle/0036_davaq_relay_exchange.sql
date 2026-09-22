CREATE TABLE exchange_relays (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), creator_id uuid NOT NULL REFERENCES users(id),
 room_id uuid NOT NULL UNIQUE REFERENCES chat_rooms(id),
 status text NOT NULL DEFAULT 'negotiating' CHECK(status IN('negotiating','reserved','in_progress','cancel_requested','cancelled','declined','expired','disputed','completed')),
 path_key text NOT NULL, version integer NOT NULL DEFAULT 1, terms jsonb NOT NULL, request_key text NOT NULL,
 expires_at timestamptz NOT NULL DEFAULT now()+interval '7 days', created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(creator_id,request_key)
);
--> statement-breakpoint
CREATE TABLE exchange_relay_members (
 relay_id uuid NOT NULL REFERENCES exchange_relays(id), user_id uuid NOT NULL REFERENCES users(id),
 position integer NOT NULL CHECK(position BETWEEN 0 AND 3), listing_id uuid NOT NULL REFERENCES exchange_listings(id), snapshot jsonb NOT NULL,
 accepted_version integer, cancel_accepted boolean NOT NULL DEFAULT false,
 provided_at timestamptz, received_at timestamptz, evidence text NOT NULL DEFAULT '',
 PRIMARY KEY(relay_id,user_id), UNIQUE(relay_id,position), UNIQUE(relay_id,listing_id)
);
CREATE INDEX exchange_relay_members_user ON exchange_relay_members(user_id,relay_id);
--> statement-breakpoint
CREATE TABLE exchange_relay_reservations (
 relay_id uuid NOT NULL REFERENCES exchange_relays(id), listing_id uuid NOT NULL REFERENCES exchange_listings(id),
 provider_id uuid NOT NULL REFERENCES users(id), receiver_id uuid NOT NULL REFERENCES users(id),
 starts_at timestamptz NOT NULL, ends_at timestamptz NOT NULL, kind text NOT NULL, active boolean NOT NULL DEFAULT true,
 PRIMARY KEY(relay_id,listing_id), CHECK(ends_at>starts_at), CHECK(provider_id<>receiver_id)
);
CREATE INDEX exchange_relay_reservations_listing ON exchange_relay_reservations(listing_id) WHERE active;
CREATE INDEX exchange_relay_reservations_provider ON exchange_relay_reservations(provider_id,starts_at) WHERE active;
CREATE INDEX exchange_relay_reservations_receiver ON exchange_relay_reservations(receiver_id,starts_at) WHERE active;
--> statement-breakpoint
CREATE TABLE exchange_relay_events (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), relay_id uuid NOT NULL REFERENCES exchange_relays(id), actor_id uuid NOT NULL REFERENCES users(id),
 kind text NOT NULL, data jsonb NOT NULL DEFAULT '{}', request_key text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(relay_id,actor_id,request_key)
);
CREATE INDEX exchange_relay_events_relay ON exchange_relay_events(relay_id,created_at);
CREATE INDEX exchange_relays_negotiating_expiry ON exchange_relays(expires_at) WHERE status='negotiating';
