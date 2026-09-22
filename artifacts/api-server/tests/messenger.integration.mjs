import { randomUUID } from "node:crypto";
export async function testMessenger({ pool, request, ok }) {
  const users = [];
  for (let i = 0; i < 3; i++) {
    const id = randomUUID();
    users.push(id);
    await pool.query(
      "INSERT INTO users(id,clerk_id,email,nickname) VALUES($1,$2,$3,$4)",
      [id, "messenger_" + id, id + "@example.invalid", "메신저 검증 " + i],
    );
  }
  const [a, b, c] = users;
  const invite = await request(a, "/invites", "POST");
  ok(invite.status === 201, "a user can create a DavaQ friend invitation");
  const redemption = await request(b, "/invites/redeem", "POST", {
    inviteCode: invite.data.inviteCode,
  });
  ok(redemption.status === 200, "invite redemption creates a friend request");
  ok(
    (
      await request(
        a,
        "/friend-requests/" + redemption.data.id + "/accept",
        "PATCH",
      )
    ).status === 200,
    "inviter can accept a friend request",
  );
  ok(
    (await request(a, "/friends")).data.some((f) => f.id === b),
    "accepted friend appears in the friend list",
  );
  const req = await request(c, "/friend-requests", "POST", { toUserId: a });
  await request(a, "/friend-requests/" + req.data.id + "/accept", "PATCH");
  const group = await request(a, "/rooms", "POST", {
    type: "group",
    name: "초대 검증 그룹",
    memberIds: [b],
    category: "casual",
  });
  ok(
    group.status === 201 || group.status === 200,
    "friends can create a group conversation",
  );
  const groupId = group.data.id;
  ok(!!groupId, "group has a persistent room ID");
  ok(
    (
      await request(a, "/rooms/" + groupId + "/members", "POST", {
        memberIds: [c],
      })
    ).status < 300,
    "existing group member can invite a friend",
  );
  ok(
    (await request(c, "/rooms/" + groupId)).status === 200,
    "invited friend can enter the group",
  );
  const sent = await request(a, "/rooms/" + groupId + "/messages", "POST", {
    content: "그룹 메시지",
    type: "text",
    clientMessageId: randomUUID(),
  });
  ok(sent.status === 201 || sent.status === 200, "group message send succeeds");
  ok(
    (await request(c, "/rooms/" + groupId + "/messages")).data.some(
      (m) => m.id === sent.data.id,
    ),
    "invited friend receives the group message",
  );
  ok(
    (
      await request(a, "/rooms/" + groupId + "/pin", "POST", {
        messageId: sent.data.id,
      })
    ).status < 300,
    "normal chat retains message pinning",
  );
  const direct = await request(a, "/rooms", "POST", {
    type: "direct",
    memberIds: [b],
  });
  const room = direct.data.id;
  ok(!!room, "friends can open a direct conversation");
  // Use a real owned Q source; the client forwards through this same durable normal-message endpoint.
  const q = (
    await pool.query(
      "INSERT INTO agent_messages(user_id,role,content,request_key) VALUES($1,'assistant','공유할 교환 추천',$2) RETURNING id",
      [a, randomUUID()],
    )
  ).rows[0];
  const source = await request(a, "/agents/me/conversation/messages/" + q.id);
  const key = randomUUID();
  const payload = {
    content: source.data.content,
    type: "text",
    clientMessageId: key,
  };
  const forwards = await Promise.all([
    request(a, "/rooms/" + room + "/messages", "POST", payload),
    request(a, "/rooms/" + room + "/messages", "POST", payload),
  ]);
  ok(
    forwards.every((r) => r.status < 300) &&
      forwards[0].data.id === forwards[1].data.id,
    "forwarding Q text retries without creating duplicate messages",
  );
  ok(
    (await request(c, "/rooms/" + room + "/messages", "POST", payload))
      .status === 403,
    "outsider cannot forward into a private room",
  );
  const reply = await request(b, "/rooms/" + room + "/messages", "POST", {
    type: "text",
    content: "답장 확인",
    replyToMessageId: forwards[0].data.id,
    clientMessageId: randomUUID(),
  });
  ok(reply.status < 300, "normal chat retains replies");
  ok(
    (
      await request(
        a,
        "/rooms/" + room + "/messages/" + forwards[0].data.id + "/sticker",
        "POST",
        { code: "1f44d" },
      )
    ).status < 300,
    "normal chat retains sticker reactions",
  );
  ok(
    (
      await request(
        a,
        "/rooms/" + room + "/messages/" + forwards[0].data.id + "/delete",
        "POST",
        { scope: "everyone" },
      )
    ).status < 300,
    "normal chat retains everyone deletion",
  );
  // Explicit active sessions continue even while passive legacy learning is disabled.
  process.env.DAVAQ_LEGACY_PERSONA_ENABLED = "false";
  await request(b, "/another-me/settings", "PATCH", {
    summonEnabled: true,
    autoReplyEnabled: true,
    allowFriends: true,
  });
  await request(b, "/another-me/rooms/" + room + "/settings", "PATCH", {
    summonEnabled: true,
    relationshipType: "FRIEND",
  });
  const session = (
    await pool.query(
      "INSERT INTO another_me_sessions(room_id,owner_user_id,summoned_by_user_id,status,summoned_at,last_activity_at,expires_at) VALUES($1,$2,$3,'ACTIVE',now(),now(),now()+interval '10 minutes') RETURNING id",
      [room, b, a],
    )
  ).rows[0];
  await request(b, "/another-me/rooms/" + room + "/settings", "PATCH", {
    summonEnabled: false,
  });
  await request(a, "/rooms/" + room + "/messages", "POST", {
    type: "text",
    content: "허용 철회 확인",
    clientMessageId: randomUUID(),
  });
  for (let i = 0; i < 40; i++) {
    if (
      (
        await pool.query("SELECT status FROM another_me_sessions WHERE id=$1", [
          session.id,
        ])
      ).rows[0].status !== "ACTIVE"
    )
      break;
    await new Promise((r) => setTimeout(r, 100));
  }
  ok(
    (
      await pool.query("SELECT status FROM another_me_sessions WHERE id=$1", [
        session.id,
      ])
    ).rows[0].status !== "ACTIVE",
    "normal message invokes summoned-session hook even with passive learning off; revoked consent dismisses AI",
  );
  await request(b, "/another-me/rooms/" + room + "/settings", "PATCH", {
    summonEnabled: true,
  });
  const active = (
    await pool.query(
      "INSERT INTO another_me_sessions(room_id,owner_user_id,summoned_by_user_id,status,summoned_at,last_activity_at,expires_at) VALUES($1,$2,$3,'ACTIVE',now(),now(),now()+interval '10 minutes') RETURNING id",
      [room, b, a],
    )
  ).rows[0];
  await request(a, "/rooms/" + room + "/messages", "POST", {
    type: "text",
    content: "교환 일정에 대해 이야기하고 싶어요",
    clientMessageId: randomUUID(),
  });
  let received = false;
  for (let i = 0; i < 100; i++) {
    received =
      (
        await pool.query(
          "SELECT count(*)::int n FROM messages WHERE another_me_session_id=$1 AND author_kind='another_me'",
          [active.id],
        )
      ).rows[0].n > 0;
    if (received) break;
    await new Promise((r) => setTimeout(r, 100));
  }
  ok(
    received,
    "explicit AI summon produces a follow-up response with legacy learning disabled",
  );
  await request(b, "/rooms/" + room + "/messages", "POST", {
    type: "text",
    content: "제가 직접 이어서 이야기할게요",
    clientMessageId: randomUUID(),
  });
  for (let i = 0; i < 40; i++) {
    if (
      (
        await pool.query("SELECT status FROM another_me_sessions WHERE id=$1", [
          active.id,
        ])
      ).rows[0].status !== "ACTIVE"
    )
      break;
    await new Promise((r) => setTimeout(r, 100));
  }
  ok(
    (
      await pool.query("SELECT status FROM another_me_sessions WHERE id=$1", [
        active.id,
      ])
    ).rows[0].status !== "ACTIVE",
    "owner returning dismisses the summoned AI",
  );
  // Allow the simulated reply's paced message chunks to finish before dropping the schema.
  await new Promise((r) => setTimeout(r, 2500));
  ok(
    (
      await pool.query(
        "SELECT count(*)::int n FROM user_ai_memories WHERE user_id=ANY($1::uuid[])",
        [users],
      )
    ).rows[0].n === 0,
    "restoring summoned chat does not turn on passive legacy memory collection",
  );
}
