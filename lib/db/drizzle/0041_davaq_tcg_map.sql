ALTER TABLE tcg_listings ADD COLUMN map_lat double precision, ADD COLUMN map_lng double precision;
ALTER TABLE tcg_listings ADD CONSTRAINT tcg_map_coordinates CHECK ((map_lat IS NULL AND map_lng IS NULL) OR (map_lat IS NOT NULL AND map_lng IS NOT NULL AND map_lat BETWEEN -85 AND 85 AND map_lng BETWEEN -180 AND 180 AND abs(map_lat*100-round(map_lat*100))<0.000001 AND abs(map_lng*100-round(map_lng*100))<0.000001 AND delivery<>'ship'));
CREATE INDEX tcg_public_map ON tcg_listings(map_lat,map_lng) WHERE status='active' AND map_lat IS NOT NULL;
