ALTER TABLE exchange_listings ADD COLUMN map_lat double precision, ADD COLUMN map_lng double precision,
 ADD COLUMN map_precision text, ADD COLUMN map_label text;
ALTER TABLE exchange_listings ADD CONSTRAINT exchange_listings_map_valid CHECK (
 (map_lat IS NULL AND map_lng IS NULL AND map_precision IS NULL AND map_label IS NULL) OR
 (map_lat IS NOT NULL AND map_lng IS NOT NULL AND map_precision IS NOT NULL AND map_label IS NOT NULL AND
  map_lat BETWEEN -85 AND 85 AND map_lng BETWEEN -180 AND 180 AND map_precision IN ('area','place') AND char_length(map_label) BETWEEN 2 AND 80 AND delivery<>'online' AND
  (map_precision='place' OR (map_lat=round(map_lat::numeric,2)::double precision AND map_lng=round(map_lng::numeric,2)::double precision)))
);
--> statement-breakpoint
CREATE INDEX exchange_listings_map_area ON exchange_listings(map_lat,map_lng) WHERE status='published' AND map_lat IS NOT NULL;
