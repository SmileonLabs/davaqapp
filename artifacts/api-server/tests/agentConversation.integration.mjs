import { randomUUID } from "node:crypto";
import {
  processAgentConversationBatch,
  listAgentConversation,
} from "../src/lib/agentConversation.ts";
export async function testAgentConversation({ pool, request, ok, users }) {
  const [a, b] = users,
    endpoint = "/agents/me/conversation/messages";
  ok(
    (await request(null, endpoint)).status === 401,
    "Q messenger requires authentication",
  );
  const operation = randomUUID(),
    input = { type: "sticker", content: "hello", clientMessageId: operation };
  const sends = await Promise.all([
    request(a, endpoint, "POST", input),
    request(a, endpoint, "POST", input),
  ]);
  ok(
    sends.every((r) => r.status === 200) &&
      sends[0].data.id === sends[1].data.id,
    "concurrent Q sends acknowledge exactly one durable message",
  );
  const sent = sends[0].data;
  ok(
    sent.roomSeq > 0 &&
      sent.clientMessageId === operation &&
      sent.metadata.replyState === "queued",
    "Q acknowledges delivery before AI processing",
  );
  ok(
    (await request(a, endpoint, "POST", { ...input, content: "changed" }))
      .status === 409,
    "Q rejects changed content under a reused operation ID",
  );
  ok(
    !(await request(b, endpoint)).data.some((m) => m.id === sent.id),
    "Q conversation is private to its owner",
  );
  const next = (
    await request(a, endpoint, "POST", {
      ...input,
      clientMessageId: randomUUID(),
      content: "thanks",
    })
  ).data;
  await Promise.all([
    processAgentConversationBatch(),
    processAgentConversationBatch(),
  ]);
  let replies = (
    await pool.query(
      "SELECT * FROM agent_messages WHERE user_id=$1 AND role='assistant' AND request_key=ANY($2::text[])",
      [a, [operation, next.clientMessageId]],
    )
  ).rows;
  ok(
    replies.length >= 1 &&
      replies.length <= 2 &&
      replies.some((r) => r.request_key === operation) &&
      new Set(replies.map((r) => r.request_key)).size === replies.length,
    "concurrent Q workers never duplicate an answer",
  );
  await processAgentConversationBatch();
  replies = (
    await pool.query(
      "SELECT * FROM agent_messages WHERE user_id=$1 AND role='assistant' AND request_key=ANY($2::text[])",
      [a, [operation, next.clientMessageId]],
    )
  ).rows;
  ok(
    replies.length === 2,
    "the next Q message is answered after the first finishes",
  );
  const retry = await request(a, endpoint, "POST", input);
  ok(
    retry.data.id === sent.id && retry.data.metadata.replyState === "done",
    "network retry after a completed answer stays idempotent",
  );
  const after = (
    await request(a, endpoint + "?afterSeq=" + sent.roomSeq + "&limit=2")
  ).data;
  ok(
    after.length === 2 &&
      after.every((m) => m.roomSeq > sent.roomSeq) &&
      after[0].roomSeq < after[1].roomSeq,
    "Q catch-up uses ordered sequence pages",
  );
  ok(
    (await request(a, endpoint + "?limit=101")).status === 400,
    "Q bounds catch-up page sizes",
  );
  ok(
    (
      await request(a, endpoint, "POST", {
        type: "image",
        content: "https://outside.invalid/p.jpg",
        clientMessageId: randomUUID(),
      })
    ).status === 400,
    "Q rejects external attachment URLs",
  );
  ok(
    (
      await request(a, endpoint, "POST", {
        type: "file",
        content: "{broken",
        clientMessageId: randomUUID(),
      })
    ).status === 400,
    "Q rejects malformed file metadata without a server error",
  );
  const imagePath = "/objects/uploads/" + randomUUID();
  await pool.query(
    "INSERT INTO chat_upload_owners(object_path,user_id,content_type) VALUES($1,$2,'image/jpeg')",
    [imagePath, a],
  );
  ok(
    (
      await request(b, endpoint, "POST", {
        type: "image",
        content: imagePath,
        clientMessageId: randomUUID(),
      })
    ).status === 403,
    "Q rejects another account’s attachment",
  );
  const photo = (
    await request(a, endpoint, "POST", {
      type: "image",
      content: imagePath,
      clientMessageId: randomUUID(),
    })
  ).data;
  ok(
    photo.type === "image",
    "Q accepts owned photos through the common messenger pipeline",
  );
  await pool.query(
    "UPDATE agent_messages SET reply_state='running',processing_started_at=now()-interval '3 minutes',lease_token=$2 WHERE id=$1",
    [photo.id, randomUUID()],
  );
  await processAgentConversationBatch();
  ok(
    (
      await pool.query(
        "SELECT count(*)::int n FROM agent_messages WHERE user_id=$1 AND role='assistant' AND request_key=$2",
        [a, photo.clientMessageId],
      )
    ).rows[0].n === 1,
    "an interrupted Q worker recovers its expired lease",
  );
  const mid = randomUUID();
  await pool.query(
    "INSERT INTO agent_memories(id,user_id,label,source_type,source_id,consent_version) VALUES($1,$2,'온라인 교환 선호','chat',$3,1)",
    [mid, a, randomUUID()],
  );
  const cardMessage = (
    await pool.query(
      "INSERT INTO agent_messages(user_id,role,content,request_key,metadata) VALUES($1,'assistant','기억해둘까요?',$2,$3) RETURNING *",
      [
        a,
        randomUUID(),
        JSON.stringify({
          memoryId: mid,
          matchIds: [randomUUID()],
          brandIds: [randomUUID()],
        }),
      ],
    )
  ).rows[0];
  let card = (await listAgentConversation(a, 50)).find(
    (m) => m.id === cardMessage.id,
  );
  ok(
    card.metadata.cards.length === 1 &&
      card.metadata.cards[0].kind === "memory",
    "Q cards include only live owned memories and available matches/rewards",
  );
  await request(a, "/agents/me/memories/" + mid, "PATCH", {
    status: "rejected",
  });
  card = (await listAgentConversation(a, 50)).find(
    (m) => m.id === cardMessage.id,
  );
  ok(
    card.metadata.cards.length === 0,
    "rejected memories disappear from Q conversation cards",
  );
  const coupon = (await request(b,endpoint,'POST',{type:'text',content:'브랜드 쿠폰 혜택을 찾아줘',clientMessageId:randomUUID()})).data;
  await processAgentConversationBatch();
  const couponReply=(await pool.query("SELECT * FROM agent_messages WHERE user_id=$1 AND role='assistant' AND request_key=$2",[b,coupon.clientMessageId])).rows[0];
  ok(!!couponReply&&Array.isArray(couponReply.metadata.brandIds)&&couponReply.content.includes('브랜드'), 'queued Q text reply preserves the grounded brand recommendation flow');
  const legacy=(await request(b,'/agents/me/messages','POST',{text:'쿠폰 혜택을 찾아줘',requestKey:randomUUID()}));
  ok(legacy.status===200&&legacy.data.message.role==='user'&&!!legacy.data.message.created_at,'older Q clients receive a compatible acknowledgement');
  await processAgentConversationBatch();
  const prior = Number(
    (
      await pool.query(
        "SELECT count(*) n FROM agent_messages WHERE user_id=$1 AND role='user' AND created_at>now()-interval '1 hour'",
        [a],
      )
    ).rows[0].n,
  );
  for (let i = prior; i < 20; i++)
    await pool.query(
      "INSERT INTO agent_messages(user_id,role,content,request_key) VALUES($1,'user','quota fixture',$2)",
      [a, randomUUID()],
    );
  ok(
    (
      await request(a, endpoint, "POST", {
        ...input,
        clientMessageId: randomUUID(),
      })
    ).status === 429,
    "Q enforces per-account accepted-message quota",
  );
  ok(
    (await request(a, endpoint, "POST", input)).status === 200,
    "Q permits idempotent delivery retries after quota is reached",
  );
}
