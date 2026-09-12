CREATE TABLE exchange_media (
 object_path text PRIMARY KEY, owner_id uuid NOT NULL REFERENCES users(id), created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE agent_learning_observations (
 user_id uuid NOT NULL REFERENCES users(id), message_id uuid NOT NULL REFERENCES messages(id), created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(user_id,message_id)
);
