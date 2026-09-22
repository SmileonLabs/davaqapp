ALTER TABLE agent_messages ADD COLUMN reply_to_message_id uuid REFERENCES agent_messages(id);
ALTER TABLE agent_messages ADD COLUMN deleted_at timestamptz;
ALTER TABLE agent_messages ADD COLUMN hidden_at timestamptz;
CREATE TABLE agent_conversation_settings(user_id uuid PRIMARY KEY REFERENCES users(id), pinned_message_id uuid REFERENCES agent_messages(id));
