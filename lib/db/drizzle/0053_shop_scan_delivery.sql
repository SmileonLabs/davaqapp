-- Shop scanner provenance and retry-safe insertion.
ALTER TABLE davaq_shop_quote_items ADD COLUMN source_scan_id uuid REFERENCES tcg_scans(id);
ALTER TABLE davaq_shop_quote_items ADD COLUMN request_key text NOT NULL DEFAULT gen_random_uuid()::text;
CREATE UNIQUE INDEX davaq_shop_quote_item_request ON davaq_shop_quote_items(quote_id,request_key);
-- Globally monotonic message cursor: never infer ordering from device clocks or UUIDs.
ALTER TABLE davaq_shop_messages ADD COLUMN seq bigint;
WITH ordered AS (SELECT id,row_number() OVER(ORDER BY created_at,id) AS seq FROM davaq_shop_messages)
UPDATE davaq_shop_messages m SET seq=o.seq FROM ordered o WHERE o.id=m.id;
CREATE SEQUENCE davaq_shop_message_seq_counter OWNED BY davaq_shop_messages.seq;
SELECT setval('davaq_shop_message_seq_counter',COALESCE(max(seq),1),count(*)>0) FROM davaq_shop_messages;
ALTER TABLE davaq_shop_messages ALTER COLUMN seq SET DEFAULT nextval('davaq_shop_message_seq_counter');
ALTER TABLE davaq_shop_messages ALTER COLUMN seq SET NOT NULL;
CREATE UNIQUE INDEX davaq_shop_message_seq ON davaq_shop_messages(seq);
CREATE INDEX davaq_shop_thread_seq ON davaq_shop_messages(thread_id,seq);
CREATE TABLE davaq_shop_thread_readers (
 thread_id uuid NOT NULL REFERENCES davaq_shop_threads(id), user_id uuid NOT NULL REFERENCES users(id),
 last_read_seq bigint NOT NULL DEFAULT 0 CHECK(last_read_seq>=0), muted boolean NOT NULL DEFAULT false,
 PRIMARY KEY(thread_id,user_id)
);
CREATE TABLE davaq_shop_delivery_jobs (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), message_id uuid NOT NULL REFERENCES davaq_shop_messages(id),
 recipient_id uuid NOT NULL REFERENCES users(id), channel text NOT NULL CHECK(channel IN('realtime','push')),
 attempts integer NOT NULL DEFAULT 0, available_at timestamptz NOT NULL DEFAULT now(),
 lease_token uuid, leased_until timestamptz, delivered_at timestamptz, failed_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(message_id,recipient_id,channel)
);
CREATE INDEX davaq_shop_delivery_due ON davaq_shop_delivery_jobs(available_at) WHERE delivered_at IS NULL AND failed_at IS NULL;
