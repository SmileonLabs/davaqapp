ALTER TABLE exchange_listings ADD COLUMN request_key text;
CREATE UNIQUE INDEX exchange_listing_request_unique ON exchange_listings(owner_id,request_key) WHERE request_key IS NOT NULL;
