-- Public card identity is separate from a member's private collection/listing.
CREATE TABLE tcg_card_catalog (
 card_id text PRIMARY KEY, card jsonb NOT NULL,
 updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE tcg_card_likes (
 card_id text NOT NULL REFERENCES tcg_card_catalog(card_id) ON DELETE CASCADE,
 owner_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 source text NOT NULL DEFAULT 'card' CHECK(source IN('card','legacy')),
 created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(card_id,owner_id)
);
CREATE TABLE tcg_card_comments (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 card_id text NOT NULL REFERENCES tcg_card_catalog(card_id) ON DELETE CASCADE,
 owner_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 body text NOT NULL CHECK(char_length(btrim(body)) BETWEEN 1 AND 500),
 request_key text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(owner_id,request_key)
);
CREATE INDEX tcg_card_comments_page ON tcg_card_comments(card_id,created_at DESC,id DESC);
CREATE TABLE tcg_card_feed_snapshots (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 owner_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 q text NOT NULL DEFAULT '', card_id text, seed text NOT NULL,
 offer_card_ids text[] NOT NULL DEFAULT '{}', offer_offset integer NOT NULL DEFAULT 0,
 catalog_state jsonb NOT NULL, next_position integer NOT NULL DEFAULT 0,
 version integer NOT NULL DEFAULT 0,
 expires_at timestamptz NOT NULL DEFAULT now()+interval '30 minutes'
);
CREATE INDEX tcg_card_feed_snapshots_expiry ON tcg_card_feed_snapshots(expires_at);
CREATE TABLE tcg_card_feed_items (
 snapshot_id uuid NOT NULL REFERENCES tcg_card_feed_snapshots(id) ON DELETE CASCADE,
 position integer NOT NULL, card_id text NOT NULL, card jsonb NOT NULL,
 PRIMARY KEY(snapshot_id,position), UNIQUE(snapshot_id,card_id)
);
-- Successful pages are immutable even if a later catalog request fills more
-- positions. Failed empty responses are deliberately not cached, enabling retry.
CREATE TABLE tcg_card_feed_pages (
 snapshot_id uuid NOT NULL REFERENCES tcg_card_feed_snapshots(id) ON DELETE CASCADE,
 page_offset integer NOT NULL, item_count integer NOT NULL,
 finished boolean NOT NULL, catalog_unavailable boolean NOT NULL DEFAULT false,
 PRIMARY KEY(snapshot_id,page_offset)
);

-- Copy rather than move existing interactions. One member's likes on multiple
-- listings of the same card become one card like; original endpoints retain
-- their own rows. Comment identities and timestamps remain unchanged.
INSERT INTO tcg_card_catalog(card_id,card)
 SELECT DISTINCT ON(c.card_id) c.card_id,
 jsonb_build_object('id',c.card_id,'saveId',c.card_id,'saveAllowed',true,'title',c.card_name,'imageSrc',null,'amount',null,'gameCode','')
 FROM tcg_listings l JOIN tcg_collection c ON c.id=l.collection_id
 ORDER BY c.card_id,l.created_at DESC,l.id DESC;
INSERT INTO tcg_card_likes(card_id,owner_id,source,created_at)
 SELECT c.card_id,a.owner_id,'legacy',min(a.created_at)
 FROM tcg_listing_likes a JOIN tcg_listings l ON l.id=a.listing_id JOIN tcg_collection c ON c.id=l.collection_id
 GROUP BY c.card_id,a.owner_id;
INSERT INTO tcg_card_comments(id,card_id,owner_id,body,request_key,created_at)
 SELECT a.id,c.card_id,a.owner_id,a.body,a.request_key,a.created_at
 FROM tcg_listing_comments a JOIN tcg_listings l ON l.id=a.listing_id JOIN tcg_collection c ON c.id=l.collection_id;
