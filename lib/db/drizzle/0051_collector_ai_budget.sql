-- Shared by lounge + private AI, all replicas, generation + review + repairs.
-- Reservations survive crashes and are only reduced on confirmed API usage.
CREATE TABLE IF NOT EXISTS collector_ai_spend_daily (
 day date PRIMARY KEY,
 microusd bigint NOT NULL CHECK (microusd BETWEEN 0 AND 1000000)
);
