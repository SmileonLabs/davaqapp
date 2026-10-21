CREATE TABLE davaq_group_calls (
 id uuid PRIMARY KEY, room_id uuid NOT NULL REFERENCES chat_rooms(id) ON DELETE CASCADE,
 creator_id uuid NOT NULL REFERENCES users(id), room_name text NOT NULL,
 media text NOT NULL CHECK (media IN ('audio','video')), status text NOT NULL DEFAULT 'active' CHECK(status IN ('active','ended')),
 created_at timestamptz NOT NULL DEFAULT now(), ended_at timestamptz, room_terminated_at timestamptz
);
CREATE UNIQUE INDEX davaq_group_call_active_room_idx ON davaq_group_calls(room_id) WHERE status='active';
CREATE TABLE davaq_group_call_participants (
 call_id uuid NOT NULL REFERENCES davaq_group_calls(id) ON DELETE CASCADE,
 user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 state text NOT NULL DEFAULT 'invited' CHECK(state IN ('invited','joined','left','declined')),
 joined_at timestamptz, heartbeat_at timestamptz, PRIMARY KEY(call_id,user_id)
);
CREATE UNIQUE INDEX davaq_group_call_joined_user_idx ON davaq_group_call_participants(user_id) WHERE state='joined';
