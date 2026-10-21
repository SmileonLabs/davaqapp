-- Preserve existing sale/swap listings while adding the simple giveaway flow.
ALTER TABLE tcg_listings DROP CONSTRAINT tcg_listings_mode_check;
ALTER TABLE tcg_listings DROP CONSTRAINT tcg_listings_check;
ALTER TABLE tcg_listings ADD CONSTRAINT tcg_listings_mode_check CHECK(mode IN('sale','swap','both','gift'));
ALTER TABLE tcg_listings ADD CONSTRAINT tcg_listings_price_mode_check CHECK(mode IN('swap','gift') OR price IS NOT NULL);
ALTER TABLE tcg_listings ADD CONSTRAINT tcg_listings_gift_price_check CHECK(mode<>'gift' OR price IS NULL OR price=0);
ALTER TABLE tcg_trades DROP CONSTRAINT tcg_trades_kind_check;
ALTER TABLE tcg_trades DROP CONSTRAINT tcg_trades_check1;
ALTER TABLE tcg_trades ADD CONSTRAINT tcg_trades_kind_check CHECK(kind IN('buy','swap','gift'));
ALTER TABLE tcg_trades ADD CONSTRAINT tcg_trades_offer_check CHECK(
 (kind IN('buy','gift') AND offered_listing_id IS NULL AND offered_quantity=0)
 OR (kind='swap' AND offered_listing_id IS NOT NULL AND offered_quantity>0)
);
ALTER TABLE tcg_trades ADD CONSTRAINT tcg_trades_gift_cash_check CHECK(kind<>'gift' OR cash=0);

CREATE TABLE tcg_listing_likes (
 listing_id uuid NOT NULL REFERENCES tcg_listings(id) ON DELETE CASCADE,
 owner_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(listing_id,owner_id)
);
CREATE TABLE tcg_listing_comments (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 listing_id uuid NOT NULL REFERENCES tcg_listings(id) ON DELETE CASCADE,
 owner_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 body text NOT NULL CHECK(char_length(btrim(body)) BETWEEN 1 AND 500),
 request_key text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(owner_id,request_key)
);
CREATE INDEX tcg_listing_comments_page ON tcg_listing_comments(listing_id,created_at DESC,id DESC);
CREATE INDEX tcg_listings_feed_page ON tcg_listings(created_at DESC,id DESC) WHERE status='active' AND mode IN('swap','both','gift') AND quantity>0;
CREATE INDEX tcg_trade_feed_offers ON tcg_trades(listing_id,expires_at) WHERE status='proposed';

-- Freeze only the active-offer bucket, keeping the rest of the feed paginated.
-- This preserves swipe order across accept/cancel/revise actions without
-- reconstructing old trade states or introducing another cache dependency.
CREATE TABLE tcg_feed_snapshots (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 owner_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 q text NOT NULL DEFAULT '',
 card_id text,
 as_of timestamptz NOT NULL DEFAULT now(),
 offer_listing_ids uuid[] NOT NULL DEFAULT '{}',
 expires_at timestamptz NOT NULL DEFAULT now()+interval '30 minutes'
);
CREATE INDEX tcg_feed_snapshots_expiry ON tcg_feed_snapshots(expires_at);
