ALTER TABLE exchange_listings ADD COLUMN review_note text NOT NULL DEFAULT '';
ALTER TABLE agent_messages ADD COLUMN processing_started_at timestamptz;
