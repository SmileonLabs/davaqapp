-- Additive pilot schema. Shop stock never shares ownership with personal collections.
CREATE TABLE davaq_shops (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text NOT NULL CHECK(length(name) BETWEEN 1 AND 80),
 owner_id uuid NOT NULL REFERENCES users(id), address text NOT NULL DEFAULT '', description text NOT NULL DEFAULT '',
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE davaq_shop_members (
 shop_id uuid NOT NULL REFERENCES davaq_shops(id), user_id uuid NOT NULL REFERENCES users(id),
 role text NOT NULL CHECK(role IN('owner','staff')), PRIMARY KEY(shop_id,user_id)
);
CREATE TABLE davaq_shop_invites (
 token_hash text PRIMARY KEY, shop_id uuid NOT NULL REFERENCES davaq_shops(id),
 expires_at timestamptz NOT NULL DEFAULT now()+interval '1 day', used_by uuid REFERENCES users(id)
);
CREATE TABLE davaq_shop_quotes (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), shop_id uuid NOT NULL REFERENCES davaq_shops(id),
 actor_id uuid NOT NULL REFERENCES users(id), customer_label text NOT NULL DEFAULT '현장 고객',
 status text NOT NULL DEFAULT 'draft' CHECK(status IN('draft','confirmed','cancelled')),
 version integer NOT NULL DEFAULT 1, confirmed_at timestamptz, customer_confirmed_at timestamptz,
 payment_status text NOT NULL DEFAULT 'unpaid' CHECK(payment_status IN('unpaid','recorded_paid')),
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE davaq_shop_quote_items (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), quote_id uuid NOT NULL REFERENCES davaq_shop_quotes(id),
 card_id text NOT NULL, card_name text NOT NULL, snapshot jsonb NOT NULL,
 condition text NOT NULL CHECK(condition IN('NM','LP','MP','HP','DMG')),
 quantity integer NOT NULL CHECK(quantity BETWEEN 1 AND 9999), unit_price integer NOT NULL CHECK(unit_price BETWEEN 0 AND 100000000),
 decision text NOT NULL DEFAULT 'buy' CHECK(decision IN('buy','reject')), reason text NOT NULL DEFAULT '', location text NOT NULL DEFAULT ''
);
CREATE TABLE davaq_shop_stock (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), shop_id uuid NOT NULL REFERENCES davaq_shops(id),
 quote_item_id uuid NOT NULL UNIQUE REFERENCES davaq_shop_quote_items(id), card_id text NOT NULL, card_name text NOT NULL,
 condition text NOT NULL, quantity integer NOT NULL CHECK(quantity>=0), unit_cost integer NOT NULL,
 location text NOT NULL DEFAULT '', created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE davaq_shop_stock_events (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), stock_id uuid NOT NULL REFERENCES davaq_shop_stock(id),
 actor_id uuid NOT NULL REFERENCES users(id), delta integer NOT NULL, reason text NOT NULL,
 request_key text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(stock_id,request_key)
);
CREATE TABLE davaq_shop_buy_prices (
 shop_id uuid NOT NULL REFERENCES davaq_shops(id), card_id text NOT NULL, card_name text NOT NULL,
 unit_price integer NOT NULL CHECK(unit_price BETWEEN 0 AND 100000000), updated_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(shop_id,card_id)
);
-- Scoped store inbox: no access to a customer's unrelated personal messenger history.
CREATE TABLE davaq_shop_threads (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), shop_id uuid NOT NULL REFERENCES davaq_shops(id),
 customer_id uuid NOT NULL REFERENCES users(id), status text NOT NULL DEFAULT 'open' CHECK(status IN('open','done')),
 ai_consent boolean NOT NULL DEFAULT false, created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(shop_id,customer_id)
);
CREATE TABLE davaq_shop_messages (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), thread_id uuid NOT NULL REFERENCES davaq_shop_threads(id),
 sender_id uuid NOT NULL REFERENCES users(id), sender_kind text NOT NULL CHECK(sender_kind IN('customer','shop')),
 content text NOT NULL CHECK(length(content) BETWEEN 1 AND 2000), request_key text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(thread_id,sender_id,request_key)
);
CREATE TABLE davaq_shop_wants (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), thread_id uuid NOT NULL REFERENCES davaq_shop_threads(id),
 card_id text NOT NULL, card_name text NOT NULL, quantity integer NOT NULL CHECK(quantity BETWEEN 1 AND 9999),
 max_price integer CHECK(max_price BETWEEN 0 AND 100000000), active boolean NOT NULL DEFAULT true,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE davaq_shop_events (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), shop_id uuid NOT NULL REFERENCES davaq_shops(id),
 actor_id uuid NOT NULL REFERENCES users(id), action text NOT NULL, target_id uuid NOT NULL, data jsonb NOT NULL DEFAULT '{}',
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE davaq_shop_ai_usage (
 shop_id uuid NOT NULL REFERENCES davaq_shops(id), day date NOT NULL DEFAULT CURRENT_DATE,
 requests integer NOT NULL CHECK(requests BETWEEN 1 AND 20), PRIMARY KEY(shop_id,day)
);
CREATE INDEX davaq_shop_quotes_shop ON davaq_shop_quotes(shop_id,created_at DESC);
CREATE INDEX davaq_shop_stock_shop ON davaq_shop_stock(shop_id,card_id);
CREATE INDEX davaq_shop_messages_thread ON davaq_shop_messages(thread_id,created_at,id);
