CREATE TABLE IF NOT EXISTS davaq_social_accounts (
  provider text NOT NULL CHECK (provider IN ('google','apple')),
  subject text NOT NULL,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(provider, subject), UNIQUE(provider, user_id)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS davaq_social_attempts (
  state_hash text PRIMARY KEY,
  provider text NOT NULL CHECK (provider IN ('google','apple')),
  challenge text NOT NULL,
  link_user_id uuid REFERENCES users(id) ON DELETE CASCADE,
  email text, subject text, verified boolean,
  error text,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS davaq_social_sessions (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  refresh_hash text NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS davaq_social_access_tokens (
  token_hash text PRIMARY KEY,
  session_id uuid NOT NULL REFERENCES davaq_social_sessions(id) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL
);
