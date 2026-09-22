import { pool } from "@workspace/db";
import { publishRealtimeEvent } from "./realtime";
import {
  transaction,
  demand,
  listingDto,
  growth,
  type Sql,
} from "./exchangeService";
import { interval } from "./exchangeRules";
import {
  relayEligible,
  relayEdge,
  findRelayCycles,
  canonicalRelay,
  type RelayTerms,
  type RelayListing,
} from "./relayRules";

import {
  goalRelayEdge,
  loadActiveWishContext,
  wishGoalContextInput,
  type WishGoalContext,
} from "./wishMatching";

type RelayCandidateDto = {
  id: string;
  listings: ReturnType<typeof listingDto>[];
  reasons: string[];
  pending: string[];
};
export async function findRelayCandidates(
  userId: string,
  sql: Sql = pool,
): Promise<{
  items: RelayCandidateDto[];
  offersCount: number;
  scannedCount: number;
  limited: boolean;
}> {
  const mine = (
    await sql.query(
      "SELECT l.*,u.nickname owner_name FROM exchange_listings l JOIN users u ON u.id=l.owner_id WHERE l.owner_id=$1 AND l.mode='offer' AND l.status='published' AND NOT EXISTS(SELECT 1 FROM exchange_relay_reservations r WHERE r.active AND r.listing_id=l.id AND r.kind='goods') AND NOT EXISTS(SELECT 1 FROM exchange_reservations r WHERE r.active AND r.listing_id=l.id AND l.kind='goods') ORDER BY l.updated_at DESC LIMIT 20",
      [userId],
    )
  ).rows;
  if (!mine.length)
    return { items: [], offersCount: 0, scannedCount: 0, limited: false };
  const others = (
    await sql.query(
      `SELECT l.*,u.nickname owner_name FROM exchange_listings l JOIN users u ON u.id=l.owner_id WHERE l.owner_id<>$1 AND l.mode='offer' AND l.status='published'
    AND NOT EXISTS(SELECT 1 FROM blocked_users b WHERE (b.blocker_user_id=$1 AND b.blocked_user_id=l.owner_id) OR (b.blocked_user_id=$1 AND b.blocker_user_id=l.owner_id))
    AND NOT EXISTS(SELECT 1 FROM exchange_relay_reservations r WHERE r.active AND r.listing_id=l.id AND r.kind='goods')
    AND NOT EXISTS(SELECT 1 FROM exchange_reservations r WHERE r.active AND r.listing_id=l.id AND l.kind='goods') ORDER BY l.updated_at DESC,l.id LIMIT 300`,
      [userId],
    )
  ).rows;
  const all = [...mine, ...others],
    owners = [...new Set(all.map((l) => l.owner_id))];
  const blocks = (
    await sql.query(
      "SELECT blocker_user_id,blocked_user_id FROM blocked_users WHERE blocker_user_id=ANY($1::uuid[]) AND blocked_user_id=ANY($1::uuid[])",
      [owners],
    )
  ).rows;
  const excluded = new Set(
    blocks.flatMap((b) => [
      b.blocker_user_id + ":" + b.blocked_user_id,
      b.blocked_user_id + ":" + b.blocker_user_id,
    ]),
  );
  const graph = findRelayCycles(all, userId, (a, b) =>
    excluded.has(a.owner_id + ":" + b.owner_id),
  );
  return {
    items: graph.items.map((c) => ({
      id: c.id,
      listings: c.listings.map(listingDto),
      reasons: c.listings.map(
        (l, i) => relayEdge(l, c.listings[(i + 1) % c.listings.length])!.reason,
      ),
      pending: [
        ...new Set(
          c.listings.map(
            (l, i) =>
              relayEdge(l, c.listings[(i + 1) % c.listings.length])!.pending,
          ),
        ),
      ],
    })),
    offersCount: mine.length,
    scannedCount: all.length,
    limited: graph.capped || others.length === 300,
  };
}
async function members(sql: Sql, id: string) {
  return (
    await sql.query(
      "SELECT * FROM exchange_relay_members WHERE relay_id=$1 ORDER BY position",
      [id],
    )
  ).rows;
}
export async function getRelay(id: string, user: string, sql: Sql = pool) {
  const p = (
    await sql.query(
      "SELECT r.* FROM exchange_relays r WHERE r.id=$1 AND EXISTS(SELECT 1 FROM exchange_relay_members m WHERE m.relay_id=r.id AND m.user_id=$2)",
      [id, user],
    )
  ).rows[0];
  demand(p, 404, "이어 바꾸기를 찾을 수 없어요.");
  const [people, events] = await Promise.all([
    members(sql, id),
    sql.query(
      "SELECT id,actor_id,kind,data,created_at FROM exchange_relay_events WHERE relay_id=$1 ORDER BY created_at DESC,id DESC LIMIT 40",
      [id],
    ),
  ]);
  const { goal_context: _privateGoal, ...publicRelay } = p;
  return {
    ...publicRelay,
    status:
      p.status === "negotiating" && new Date(p.expires_at) <= new Date()
        ? "expired"
        : p.status,
    members: people,
    events: events.rows,
  };
}
export async function listRelays(user: string, roomId: string | null = null) {
  const rows = (
    await pool.query(
      "SELECT r.id FROM exchange_relays r JOIN exchange_relay_members m ON m.relay_id=r.id AND m.user_id=$1 WHERE ($2::uuid IS NULL OR r.room_id=$2) ORDER BY r.updated_at DESC LIMIT 30",
      [user, roomId],
    )
  ).rows;
  return { items: await Promise.all(rows.map((r) => getRelay(r.id, user))) };
}
async function validate(
  sql: Sql,
  ids: string[],
  terms: RelayTerms,
  expected?: any[],
  goal?: WishGoalContext,
) {
  demand(
    ids.length >= 3 && ids.length <= 4 && new Set(ids).size === ids.length,
    400,
    "서로 다른 제공 항목 3~4개를 연결해 주세요.",
  );
  const rows = (
    await sql.query(
      "SELECT l.*,u.nickname owner_name FROM exchange_listings l JOIN users u ON u.id=l.owner_id WHERE l.id=ANY($1::uuid[]) ORDER BY l.id FOR UPDATE OF l",
      [ids],
    )
  ).rows;
  const path = ids.map((id) => rows.find((l) => l.id === id));
  demand(
    path.every((l) => l && relayEligible(l)),
    409,
    "공개된 항목인지 다시 확인해 주세요. 숨김·마감된 항목은 연결할 수 없어요.",
  );
  demand(
    new Set(path.map((l) => l.owner_id)).size === path.length,
    400,
    "각기 다른 사람이 한 번씩 참여해야 해요.",
  );
  const owners = path.map((l) => l.owner_id);
  demand(
    !(
      await sql.query(
        "SELECT 1 FROM blocked_users WHERE blocker_user_id=ANY($1::uuid[]) AND blocked_user_id=ANY($1::uuid[]) LIMIT 1",
        [owners],
      )
    ).rows.length,
    403,
    "참여자 관계가 바뀌어 이 연결을 진행할 수 없어요.",
  );
  if (goal)
    demand(
      path[0].owner_id === goal.ownerId,
      403,
      "내 목표는 내 제공에서 시작하는 연결에만 사용할 수 있어요.",
    );
  demand(
    path.every((l, i) =>
      goal
        ? goalRelayEdge(goal, l, path[(i + 1) % path.length])
        : relayEdge(l, path[(i + 1) % path.length]),
    ),
    409,
    "목표 상품이나 원하는 분야·지역·요일이 바뀌었어요. 연결을 다시 찾아 주세요.",
  );
  demand(
    terms.legs.length === path.length &&
      new Set(terms.legs.map((l) => l.listingId)).size === path.length &&
      terms.legs.every((l) => ids.includes(l.listingId)),
    400,
    "모든 참여자의 제공 일정과 장소가 필요해요.",
  );
  for (const l of path) {
    if (expected) {
      const old = expected.find((m) => m.listing_id === l.id);
      demand(
        old?.snapshot.version === l.version && old.user_id === l.owner_id,
        409,
        "등록 내용이 바뀌었어요. 최신 내용으로 조건을 수정하고 다시 동의해 주세요.",
      );
    }
    const leg = terms.legs.find((s) => s.listingId === l.id)!;
    demand(
      new Date(leg.startsAt) > new Date(),
      409,
      "앞으로 진행할 일정으로 정해 주세요.",
    );
  }
  return path as RelayListing[];
}
async function message(sql: Sql, p: any, actor: string, text: string) {
  const seq = (
    await sql.query(
      "UPDATE chat_rooms SET last_message_seq=last_message_seq+1,last_message=$2,last_message_at=now(),updated_at=now() WHERE id=$1 RETURNING last_message_seq",
      [p.room_id, text],
    )
  ).rows[0].last_message_seq;
  await sql.query(
    "INSERT INTO messages(room_id,sender_id,author_kind,type,content,metadata,room_seq) VALUES($1,$2,'system','text',$3,$4,$5)",
    [
      p.room_id,
      actor,
      text,
      JSON.stringify({ relayId: p.id, relayVersion: p.version }),
      seq,
    ],
  );
  await sql.query(
    "UPDATE chat_room_members SET hidden_at=NULL WHERE room_id=$1",
    [p.room_id],
  );
}
export async function notifyRelay(p: any, actor: string) {
  const people = await members(pool, p.id);
  await publishRealtimeEvent({
    type: "room.updated",
    roomId: p.room_id,
    userIds: people.map((m) => m.user_id),
    actorUserId: actor,
    data: { relayId: p.id },
  }).catch(() => {});
}
export async function createRelay(
  user: string,
  ids: string[],
  terms: RelayTerms,
  requestKey: string,
  wishId?: string,
) {
  return transaction(async (sql) => {
    await sql.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
      "davaq-relay-create:" + user + ":" + requestKey,
    ]);
    const prior = (
      await sql.query(
        "SELECT * FROM exchange_relays WHERE creator_id=$1 AND request_key=$2",
        [user, requestKey],
      )
    ).rows[0];
    if (prior) return prior;
    const pathKey = canonicalRelay(ids);
    await sql.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
      "davaq-relay-path:" + pathKey,
    ]);
    const goal = wishId
      ? await loadActiveWishContext(sql, user, wishId)
      : undefined;
    const path = await validate(sql, ids, terms, undefined, goal);
    demand(
      path[0].owner_id === user,
      403,
      "내 제공 항목에서 시작하는 연결만 제안할 수 있어요.",
    );
    const active = (
      await sql.query(
        "SELECT * FROM exchange_relays WHERE path_key=$1 AND ((status='negotiating' AND expires_at>now()) OR status IN('reserved','in_progress','cancel_requested','disputed')) LIMIT 1",
        [pathKey],
      )
    ).rows[0];
    if (active) return active;
    const room = (
      await sql.query(
        "INSERT INTO chat_rooms(type,name,category,visibility,owner_id) VALUES('group',$2,'casual','private',$1) RETURNING id",
        [user, "이어 바꾸기 · " + path.length + "명"],
      )
    ).rows[0];
    const p = (
      await sql.query(
        "INSERT INTO exchange_relays(creator_id,room_id,terms,request_key,path_key,goal_context) VALUES($1,$2,$3,$4,$5,$6) RETURNING *",
        [
          user,
          room.id,
          JSON.stringify(terms),
          requestKey,
          pathKey,
          goal ? JSON.stringify(goal) : null,
        ],
      )
    ).rows[0];
    for (let i = 0; i < path.length; i++) {
      const l = path[i];
      await sql.query(
        "INSERT INTO exchange_relay_members(relay_id,user_id,position,listing_id,snapshot) VALUES($1,$2,$3,$4,$5)",
        [p.id, l.owner_id, i, l.id, JSON.stringify(listingDto(l))],
      );
      await sql.query(
        "INSERT INTO chat_room_members(room_id,user_id) VALUES($1,$2)",
        [room.id, l.owner_id],
      );
    }
    await sql.query(
      "INSERT INTO exchange_relay_events(relay_id,actor_id,kind,request_key) VALUES($1,$2,'created',$3)",
      [p.id, user, requestKey],
    );
    await message(
      sql,
      p,
      user,
      `이어 바꾸기 제안이 도착했어요. ${path.length}명이 각자 주고받을 항목을 확인하고 모두 동의하면 확정돼요. 채팅 위의 ‘이어 바꾸기’를 눌러 확인해 주세요.`,
    );
    return p;
  });
}
async function reserve(sql: Sql, p: any, people: any[]) {
  for (const user of people.map((m) => m.user_id).sort())
    await sql.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
      "davaq-reservation:" + user,
    ]);
  const path = await validate(
    sql,
    people.map((m) => m.listing_id),
    p.terms,
    people,
    p.goal_context ? wishGoalContextInput.parse(p.goal_context) : undefined,
  );
  const slots = path.map((l, i) => ({
    l,
    receiver: path[(i + 1) % path.length].owner_id,
    ...interval(
      p.terms.legs.find((s: any) => s.listingId === l.id).startsAt,
      l.duration_minutes,
    ),
  }));
  for (let i = 0; i < slots.length; i++) {
    const slot = slots[i],
      users = [slot.l.owner_id, slot.receiver];
    for (const other of slots.slice(0, i))
      demand(
        !(
          users.some((u) => [other.l.owner_id, other.receiver].includes(u)) &&
          slot.from < other.to &&
          other.from < slot.to
        ),
        409,
        "같은 사람이 주고받는 시간이 겹쳐요. 각 제공 일정을 나누어 주세요.",
      );
    const direct = (
      await sql.query(
        `SELECT 1 FROM exchange_reservations r JOIN exchange_proposals p ON p.id=r.proposal_id WHERE r.active AND ((r.listing_id=$1 AND $5='goods') OR ($2::uuid[] && ARRAY[p.proposer_id,p.recipient_id] AND r.starts_at<$4 AND r.ends_at>$3)) LIMIT 1`,
        [slot.l.id, users, slot.from, slot.to, slot.l.kind],
      )
    ).rows[0];
    const relay = (
      await sql.query(
        `SELECT 1 FROM exchange_relay_reservations r WHERE r.active AND r.relay_id<>$6 AND ((r.listing_id=$1 AND ($5='goods' OR r.kind='goods')) OR ($2::uuid[] && ARRAY[r.provider_id,r.receiver_id] AND r.starts_at<$4 AND r.ends_at>$3)) LIMIT 1`,
        [slot.l.id, users, slot.from, slot.to, slot.l.kind, p.id],
      )
    ).rows[0];
    demand(
      !direct && !relay,
      409,
      "이미 예약된 물건이나 시간이 있어요. 조건을 수정하거나 다른 연결을 찾아 주세요.",
    );
    await sql.query(
      "INSERT INTO exchange_relay_reservations(relay_id,listing_id,provider_id,receiver_id,starts_at,ends_at,kind) VALUES($1,$2,$3,$4,$5,$6,$7)",
      [
        p.id,
        slot.l.id,
        slot.l.owner_id,
        slot.receiver,
        slot.from,
        slot.to,
        slot.l.kind,
      ],
    );
  }
}
export async function actOnRelay(
  id: string,
  user: string,
  input: {
    action: string;
    version: number;
    requestKey: string;
    terms?: RelayTerms;
    note?: string;
  },
) {
  return transaction(async (sql) => {
    const p = (
      await sql.query("SELECT * FROM exchange_relays WHERE id=$1 FOR UPDATE", [
        id,
      ])
    ).rows[0];
    const people = await members(sql, id),
      me = people.find((m) => m.user_id === user);
    demand(p && me, 404, "이어 바꾸기를 찾을 수 없어요.");
    if (
      (
        await sql.query(
          "SELECT 1 FROM exchange_relay_events WHERE relay_id=$1 AND actor_id=$2 AND request_key=$3",
          [id, user, input.requestKey],
        )
      ).rows[0]
    )
      return p;
    demand(
      input.version === p.version,
      409,
      "조건이 바뀌었어요. 최신 내용을 다시 확인해 주세요.",
    );
    const a = input.action;
    if (["accept", "revise", "decline"].includes(a))
      demand(
        p.status === "negotiating" && new Date(p.expires_at) > new Date(),
        409,
        "동의 기간이 끝났거나 이미 확정된 연결이에요.",
      );
    if (a === "revise") {
      demand(input.terms, 400, "수정할 조건을 입력해 주세요.");
      const path = await validate(
        sql,
        people.map((m) => m.listing_id),
        input.terms,
        undefined,
        p.goal_context ? wishGoalContextInput.parse(p.goal_context) : undefined,
      );
      p.version++;
      p.terms = input.terms;
      for (const l of path)
        await sql.query(
          "UPDATE exchange_relay_members SET accepted_version=NULL,snapshot=$3 WHERE relay_id=$1 AND listing_id=$2",
          [id, l.id, JSON.stringify(listingDto(l))],
        );
      await sql.query(
        "UPDATE exchange_relays SET version=$2,terms=$3,expires_at=now()+interval '7 days' WHERE id=$1",
        [id, p.version, JSON.stringify(p.terms)],
      );
    } else if (a === "accept") {
      for (const owner of people.map((m) => m.user_id).sort())
        await sql.query(
          "SELECT pg_advisory_xact_lock(hashtextextended($1,0))",
          ["davaq-reservation:" + owner],
        );
      await validate(
        sql,
        people.map((m) => m.listing_id),
        p.terms,
        people,
        p.goal_context ? wishGoalContextInput.parse(p.goal_context) : undefined,
      );
      await sql.query(
        "UPDATE exchange_relay_members SET accepted_version=$3 WHERE relay_id=$1 AND user_id=$2",
        [id, user, p.version],
      );
      if (
        people.every(
          (m) => m.user_id === user || m.accepted_version === p.version,
        )
      ) {
        await reserve(sql, p, people);
        p.status = "reserved";
      }
    } else if (a === "decline") {
      p.status = "declined";
    } else if (a === "cancel") {
      demand(
        ["negotiating", "reserved", "in_progress"].includes(p.status),
        409,
        "취소를 요청할 수 없는 상태예요.",
      );
      demand((input.note ?? "").length >= 2, 400, "취소 이유를 알려 주세요.");
      demand(
        !people.some((m) => m.provided_at),
        409,
        "이미 전달한 내용이 있어요. 도움 요청으로 해결을 진행해 주세요.",
      );
      p.status = p.status === "negotiating" ? "cancelled" : "cancel_requested";
      await sql.query(
        "UPDATE exchange_relay_members SET cancel_accepted=(user_id=$2) WHERE relay_id=$1",
        [id, user],
      );
    } else if (a === "approve_cancel") {
      demand(
        p.status === "cancel_requested" && !people.some((m) => m.provided_at),
        409,
        "현재는 취소 동의를 할 수 없어요.",
      );
      await sql.query(
        "UPDATE exchange_relay_members SET cancel_accepted=true WHERE relay_id=$1 AND user_id=$2",
        [id, user],
      );
      if (people.every((m) => m.user_id === user || m.cancel_accepted))
        p.status = "cancelled";
    } else if (a === "dispute") {
      demand(
        ["reserved", "in_progress", "cancel_requested"].includes(p.status),
        409,
        "확정된 교환에서 도움을 요청해 주세요.",
      );
      demand(
        (input.note ?? "").length >= 5,
        400,
        "어려운 상황을 5자 이상 알려 주세요.",
      );
      p.status = "disputed";
    } else if (a === "provided") {
      demand(
        ["reserved", "in_progress"].includes(p.status),
        409,
        "모두 동의한 뒤 전달할 수 있어요.",
      );
      const slot = (
        await sql.query(
          "SELECT starts_at FROM exchange_relay_reservations WHERE relay_id=$1 AND provider_id=$2",
          [id, user],
        )
      ).rows[0];
      demand(
        slot && new Date(slot.starts_at) <= new Date(),
        409,
        "약속 시간이 된 뒤 전달 완료를 표시해 주세요.",
      );
      await sql.query(
        "UPDATE exchange_relay_members SET provided_at=coalesce(provided_at,now()),evidence=$3 WHERE relay_id=$1 AND user_id=$2",
        [id, user, input.note ?? ""],
      );
      p.status = "in_progress";
    } else if (a === "received") {
      demand(
        ["reserved", "in_progress"].includes(p.status),
        409,
        "지금은 받기 완료를 표시할 수 없어요.",
      );
      const previous =
        people[(me.position + people.length - 1) % people.length];
      demand(
        previous.provided_at,
        409,
        "내게 주는 분이 전달 완료를 표시한 뒤 확인해 주세요.",
      );
      await sql.query(
        "UPDATE exchange_relay_members SET received_at=coalesce(received_at,now()) WHERE relay_id=$1 AND user_id=$2",
        [id, previous.user_id],
      );
      p.status = people.every(
        (m) => m.user_id === previous.user_id || m.received_at,
      )
        ? "completed"
        : "in_progress";
      if (p.status === "completed") {
        await sql.query(
          "UPDATE exchange_listings SET status='closed',updated_at=now() WHERE id=ANY($1::uuid[])",
          [
            people
              .filter((m) => m.snapshot.kind === "goods")
              .map((m) => m.listing_id),
          ],
        );
        for (const m of people)
          await growth(sql, m.user_id, "exchange_completed", id);
      }
    } else demand(false, 400, "알 수 없는 동작이에요.");
    await sql.query(
      "UPDATE exchange_relays SET status=$2,updated_at=now() WHERE id=$1",
      [id, p.status],
    );
    if (["completed", "cancelled"].includes(p.status))
      await sql.query(
        "UPDATE exchange_relay_reservations SET active=false WHERE relay_id=$1",
        [id],
      );
    await sql.query(
      "INSERT INTO exchange_relay_events(relay_id,actor_id,kind,data,request_key) VALUES($1,$2,$3,$4,$5)",
      [
        id,
        user,
        a,
        JSON.stringify({
          version: p.version,
          note: input.note ?? "",
          ...(a === "revise" ? { terms: p.terms } : {}),
        }),
        input.requestKey,
      ],
    );
    const labels: Record<string, string> = {
      accept:
        p.status === "reserved"
          ? "모두 동의했어요! 이제 약속한 순서로 주고받아요."
          : "한 분이 이어 바꾸기 조건에 동의했어요.",
      revise: "조건을 수정했어요. 모든 참여자가 새 조건에 다시 동의해 주세요.",
      decline:
        "참여가 어려운 분이 있어 이번 연결을 닫았어요. Q와 다른 연결을 찾아보세요.",
      cancel: "이어 바꾸기 취소를 요청했어요.",
      approve_cancel:
        p.status === "cancelled"
          ? "모두 취소에 동의해 연결을 닫았어요."
          : "취소 요청에 동의했어요.",
      provided: "약속한 제공을 완료했어요. 받는 분이 확인해 주세요.",
      received:
        p.status === "completed"
          ? "모두 원하는 것을 받았어요! 이어 바꾸기가 완료됐어요."
          : "한 분이 받기 완료를 확인했어요.",
      dispute:
        "도움 요청을 접수했어요. 전달을 멈추고 함께 상황을 확인해 주세요.",
    };
    await message(sql, p, user, labels[a]);
    return p;
  });
}

export async function resolveRelay(
  sql: Sql,
  id: string,
  actor: string,
  action: string,
  reason: string,
) {
  demand(
    ["cancel", "resume"].includes(action),
    400,
    "처리 동작을 확인해 주세요.",
  );
  const p = (
    await sql.query("SELECT * FROM exchange_relays WHERE id=$1 FOR UPDATE", [
      id,
    ])
  ).rows[0];
  demand(
    p && ["disputed", "cancel_requested"].includes(p.status),
    409,
    "검토 대기 중인 연결만 처리할 수 있어요.",
  );
  p.status = action === "cancel" ? "cancelled" : "in_progress";
  await sql.query(
    "UPDATE exchange_relays SET status=$2,updated_at=now() WHERE id=$1",
    [id, p.status],
  );
  if (action === "cancel")
    await sql.query(
      "UPDATE exchange_relay_reservations SET active=false WHERE relay_id=$1",
      [id],
    );
  await sql.query(
    "INSERT INTO exchange_relay_events(relay_id,actor_id,kind,data,request_key) VALUES($1,$2,'admin_resolution',$3,$4)",
    [
      id,
      actor,
      JSON.stringify({ note: reason, action }),
      "admin-" + Date.now(),
    ],
  );
  await message(sql, p, actor, "이어 바꾸기 운영 검토 결과: " + reason);
}
