CREATE TABLE tcg_collection (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), owner_id uuid NOT NULL REFERENCES users(id),
 card_id text NOT NULL, card_name text NOT NULL DEFAULT '', quantity integer NOT NULL CHECK(quantity>=0 AND quantity<=9999),
 reserved integer NOT NULL DEFAULT 0 CHECK(reserved>=0 AND reserved<=quantity),
 condition text NOT NULL CHECK(condition IN('NM','LP','MP','HP','DMG')), photos jsonb NOT NULL DEFAULT '[]',
 purchase_price integer CHECK(purchase_price>=0), folder text NOT NULL DEFAULT '', note text NOT NULL DEFAULT '',
 request_key text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(owner_id,request_key)
);
CREATE TABLE tcg_wants (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), owner_id uuid NOT NULL REFERENCES users(id),card_id text NOT NULL,card_name text NOT NULL DEFAULT '',
 quantity integer NOT NULL CHECK(quantity>0),conditions jsonb NOT NULL DEFAULT '["NM","LP"]',max_price integer CHECK(max_price>=0),
 mode text NOT NULL CHECK(mode IN('buy','swap','either')),region text NOT NULL DEFAULT '',delivery text NOT NULL DEFAULT 'either' CHECK(delivery IN('meet','ship','either')),
 active boolean NOT NULL DEFAULT true,created_at timestamptz NOT NULL DEFAULT now(),UNIQUE(owner_id,card_id)
);
CREATE TABLE tcg_listings (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),owner_id uuid NOT NULL REFERENCES users(id),collection_id uuid NOT NULL REFERENCES tcg_collection(id),
 quantity integer NOT NULL CHECK(quantity>=0),mode text NOT NULL CHECK(mode IN('sale','swap','both')),price integer CHECK(price>=0),
 wanted_card_ids jsonb NOT NULL DEFAULT '[]',region text NOT NULL DEFAULT '',delivery text NOT NULL CHECK(delivery IN('meet','ship','either')),
 description text NOT NULL DEFAULT '',status text NOT NULL DEFAULT 'active' CHECK(status IN('active','closed')),version integer NOT NULL DEFAULT 1,
 request_key text NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),UNIQUE(owner_id,request_key),
 CHECK(mode='swap' OR price IS NOT NULL)
);
CREATE UNIQUE INDEX tcg_one_active_listing ON tcg_listings(collection_id) WHERE status='active';
CREATE INDEX tcg_listings_owner ON tcg_listings(owner_id,status);
CREATE INDEX tcg_collection_card ON tcg_collection(card_id);
CREATE TABLE tcg_trades (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),buyer_id uuid NOT NULL REFERENCES users(id),seller_id uuid NOT NULL REFERENCES users(id),
 listing_id uuid NOT NULL REFERENCES tcg_listings(id),offered_listing_id uuid REFERENCES tcg_listings(id),room_id uuid NOT NULL REFERENCES chat_rooms(id),
 kind text NOT NULL CHECK(kind IN('buy','swap')),quantity integer NOT NULL CHECK(quantity>0),offered_quantity integer NOT NULL DEFAULT 0 CHECK(offered_quantity>=0),
 cash integer NOT NULL DEFAULT 0 CHECK(cash>=0),note text NOT NULL DEFAULT '',snapshot jsonb NOT NULL,
 status text NOT NULL DEFAULT 'proposed' CHECK(status IN('proposed','confirmed','completed','cancelled','declined','disputed')),
 version integer NOT NULL DEFAULT 1,request_key text NOT NULL,expires_at timestamptz NOT NULL DEFAULT now()+interval '7 days',
 created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),UNIQUE(buyer_id,request_key),CHECK(buyer_id<>seller_id),
 CHECK((kind='buy' AND offered_listing_id IS NULL AND offered_quantity=0) OR (kind='swap' AND offered_listing_id IS NOT NULL AND offered_quantity>0))
);
CREATE TABLE tcg_trade_actions (
 trade_id uuid NOT NULL REFERENCES tcg_trades(id),user_id uuid NOT NULL REFERENCES users(id),version integer NOT NULL,
 kind text NOT NULL CHECK(kind IN('accept','sent','received','cancel')),created_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(trade_id,user_id,version,kind)
);
CREATE TABLE tcg_reports (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),owner_id uuid NOT NULL REFERENCES users(id),listing_id uuid REFERENCES tcg_listings(id),trade_id uuid REFERENCES tcg_trades(id),
 reason text NOT NULL,status text NOT NULL DEFAULT 'open',created_at timestamptz NOT NULL DEFAULT now(),CHECK(num_nonnulls(listing_id,trade_id)=1)
);
CREATE TABLE tcg_notifications (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),owner_id uuid NOT NULL REFERENCES users(id),listing_id uuid REFERENCES tcg_listings(id),
 kind text NOT NULL DEFAULT 'match',dedupe_key text NOT NULL,title text NOT NULL,body text NOT NULL DEFAULT '',seen_at timestamptz,push_attempted_at timestamptz,created_at timestamptz NOT NULL DEFAULT now(),UNIQUE(owner_id,dedupe_key)
);
CREATE TABLE tcg_price_alerts (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),owner_id uuid NOT NULL REFERENCES users(id),card_id text NOT NULL,card_name text NOT NULL DEFAULT '',
 direction text NOT NULL CHECK(direction IN('below','above')),amount numeric NOT NULL CHECK(amount>0),currency text NOT NULL CHECK(currency IN('KRW','USD','EUR')),
 last_observed text,active boolean NOT NULL DEFAULT true,created_at timestamptz NOT NULL DEFAULT now(),UNIQUE(owner_id,card_id,direction,amount,currency)
);
CREATE TABLE tcg_card_requests (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),owner_id uuid NOT NULL REFERENCES users(id),purpose text NOT NULL CHECK(purpose IN('owned','want')),
 name text NOT NULL,game text NOT NULL,number text NOT NULL DEFAULT '',language text NOT NULL DEFAULT '',photo text NOT NULL DEFAULT '',note text NOT NULL DEFAULT '',
 status text NOT NULL DEFAULT 'pending',resolved_card_id text,upstream_request_id text,created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE tcg_wants ADD COLUMN last_checked_at timestamptz;
ALTER TABLE tcg_price_alerts ADD COLUMN last_checked_at timestamptz;
CREATE TABLE tcg_scans (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),owner_id uuid NOT NULL REFERENCES users(id),object_path text NOT NULL,
 upstream_id uuid,status text NOT NULL DEFAULT 'queued',result jsonb,request_key text NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),UNIQUE(owner_id,request_key)
);
ALTER TABLE tcg_card_requests ADD COLUMN scan_id uuid REFERENCES tcg_scans(id);
ALTER TABLE tcg_card_requests ADD COLUMN details jsonb NOT NULL DEFAULT '{}';
CREATE TABLE tcg_operation_events (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),actor_id uuid NOT NULL REFERENCES users(id),target_id uuid NOT NULL,
 action text NOT NULL,reason text NOT NULL,data jsonb NOT NULL DEFAULT '{}',created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE tcg_card_requests ADD COLUMN last_checked_at timestamptz;
ALTER TABLE tcg_notifications ADD COLUMN trade_id uuid REFERENCES tcg_trades(id);
