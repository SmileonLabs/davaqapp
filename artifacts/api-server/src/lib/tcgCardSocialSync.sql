-- Run only while the DavaQ API is quiesced. Retain direct card likes and all
-- legacy rows; synchronize only legacy-derived state after a rollback window.
INSERT INTO tcg_card_catalog(card_id,card)
 SELECT DISTINCT ON(c.card_id) c.card_id,
 jsonb_build_object('id',c.card_id,'saveId',c.card_id,'saveAllowed',true,'title',c.card_name,'imageSrc',null,'amount',null,'gameCode','')
 FROM tcg_listings l JOIN tcg_collection c ON c.id=l.collection_id
 ORDER BY c.card_id,l.created_at DESC,l.id DESC ON CONFLICT DO NOTHING;
DELETE FROM tcg_card_likes a WHERE a.source='legacy' AND NOT EXISTS(
 SELECT 1 FROM tcg_listing_likes old JOIN tcg_listings l ON l.id=old.listing_id JOIN tcg_collection c ON c.id=l.collection_id
 WHERE c.card_id=a.card_id AND old.owner_id=a.owner_id
);
INSERT INTO tcg_card_likes(card_id,owner_id,source,created_at)
 SELECT c.card_id,a.owner_id,'legacy',min(a.created_at)
 FROM tcg_listing_likes a JOIN tcg_listings l ON l.id=a.listing_id JOIN tcg_collection c ON c.id=l.collection_id
 GROUP BY c.card_id,a.owner_id ON CONFLICT DO NOTHING;
INSERT INTO tcg_card_comments(id,card_id,owner_id,body,request_key,created_at)
 SELECT a.id,c.card_id,a.owner_id,a.body,a.request_key,a.created_at
 FROM tcg_listing_comments a JOIN tcg_listings l ON l.id=a.listing_id JOIN tcg_collection c ON c.id=l.collection_id
 WHERE true ON CONFLICT DO NOTHING;
