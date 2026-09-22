import { pool } from "@workspace/db";
import { randomUUID } from "node:crypto";
import { publishRealtimeEvent } from "./realtime";
import {
  matchPair,
  participantSide,
  interval,
  categoryEligible,
  type ExchangeTerms,
} from "./exchangeRules";
export interface Sql {
  query(
    text: string,
    values?: any[],
  ): Promise<{ rows: any[]; rowCount: number | null }>;
}
export class ExchangeError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
export function demand(
  condition: unknown,
  status: number,
  message: string,
): asserts condition {
  if (!condition) throw new ExchangeError(status, message);
}
export async function transaction<T>(
  run: (sql: Sql) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await run(client);
    await client.query("COMMIT");
    return result;
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
}
export async function blocked(sql: Sql, a: string, b: string) {
  const result = await sql.query(
    "SELECT 1 FROM blocked_users WHERE (blocker_user_id=$1 AND blocked_user_id=$2) OR (blocker_user_id=$2 AND blocked_user_id=$1) LIMIT 1",
    [a, b],
  );
  return !!result.rows[0];
}
export function listingDto(row: any) {
  return {
    id: row.id,
    ownerId: row.owner_id,
    ownerName: row.owner_name ?? "",
    mode: row.mode,
    kind: row.kind,
    category: row.category,
    title: row.title,
    description: row.description,
    wantedText: row.wanted_text,
    wantedCategories: row.wanted_categories ?? [],
    location: row.location,
    delivery: row.delivery,
    durationMinutes: row.duration_minutes,
    availableDays: row.available_days ?? [],
    ev: row.ev,
    imageKey: row.image_key,
    status: row.status,
    terms: row.terms,
    reviewNote: row.review_note ?? "",
    version: row.version,
    favorite: !!row.favorite,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
export async function getListing(id: string, userId: string, sql: Sql = pool) {
  const { rows } = await sql.query(
    `SELECT l.*,u.nickname owner_name,EXISTS(SELECT 1 FROM exchange_favorites f WHERE f.user_id=$2 AND f.listing_id=l.id) favorite
 FROM exchange_listings l JOIN users u ON u.id=l.owner_id WHERE l.id=$1 AND
 (l.owner_id=$2 OR l.status='published' OR EXISTS(SELECT 1 FROM exchange_proposals p WHERE (p.offer_id=l.id OR p.requested_id=l.id) AND $2 IN(p.proposer_id,p.recipient_id)))`,
    [id, userId],
  );
  demand(rows[0], 404, "항목을 찾을 수 없어요.");
  if (rows[0].owner_id !== userId)
    demand(
      !(await blocked(sql, userId, rows[0].owner_id)),
      403,
      "접근할 수 없는 항목이에요.",
    );
  return rows[0];
}
export async function enqueueSearch(userId?: string, sql: Sql = pool) {
  await sql.query(
    `INSERT INTO agent_search_jobs(user_id,consent_version)
 SELECT user_id,consent_version FROM agent_settings WHERE auto_search=true ${userId ? "AND user_id=$1" : ""}
 ON CONFLICT(user_id) DO UPDATE SET requested_at=now(),status=CASE WHEN agent_search_jobs.status='running' THEN 'running' ELSE 'pending' END,error=NULL,consent_version=excluded.consent_version`,
    userId ? [userId] : [],
  );
}
export async function growth(
  sql: Sql,
  userId: string,
  kind: string,
  sourceId: string,
) {
  await sql.query(
    "INSERT INTO agent_growth_events(user_id,kind,source_id) VALUES($1,$2,$3) ON CONFLICT DO NOTHING",
    [userId, kind, sourceId],
  );
}
export async function findMatches(userId: string, sql: Sql = pool) {
  const offers = (
    await sql.query(
      "SELECT * FROM exchange_listings WHERE owner_id=$1 AND mode='offer' AND status='published' ORDER BY updated_at DESC LIMIT 30",
      [userId],
    )
  ).rows;
  const targets = (
    await sql.query(
      `SELECT l.*,u.nickname owner_name FROM exchange_listings l JOIN users u ON u.id=l.owner_id
 WHERE l.owner_id<>$1 AND l.mode='offer' AND l.status='published'
 AND NOT EXISTS(SELECT 1 FROM blocked_users b WHERE (b.blocker_user_id=$1 AND b.blocked_user_id=l.owner_id) OR (b.blocked_user_id=$1 AND b.blocker_user_id=l.owner_id))
 AND NOT EXISTS(SELECT 1 FROM agent_match_feedback f WHERE f.user_id=$1 AND f.listing_id=l.id AND (f.reason='not_interested' OR f.created_at>now()-interval '7 days'))
 ORDER BY l.updated_at DESC LIMIT 250`,
      [userId],
    )
  ).rows;
  const memories = (
    await sql.query(
      "SELECT label FROM agent_memories WHERE user_id=$1 AND status='confirmed' AND (expires_at IS NULL OR expires_at>now()) ORDER BY updated_at DESC LIMIT 20",
      [userId],
    )
  ).rows;
  const best = new Map<string, any>();
  for (const target of targets)
    for (const offer of offers) {
      if (
        !categoryEligible({
          category: target.category,
          title: target.title,
          description: target.description,
          wantedText: target.wanted_text,
        }) ||
        !categoryEligible({
          category: offer.category,
          title: offer.title,
          description: offer.description,
          wantedText: offer.wanted_text,
        })
      )
        continue;
      const matched = matchPair(offer, target);
      if (!matched) continue;
      const haystack = [
        target.title,
        target.description,
        target.category,
        target.location,
      ]
        .join(" ")
        .toLowerCase();
      const memory = memories.find((m) =>
        String(m.label)
          .split(/\s+/)
          .filter((w: string) => w.length >= 2)
          .some((word: string) => haystack.includes(word.toLowerCase())),
      );
      if (memory) {
        matched.score += 1;
        matched.reasons.push("내가 확인한 기억과 관련된 내용이 있어요");
      }
      const candidate = {
        id: target.id,
        offer: listingDto(offer),
        target: listingDto(target),
        reasons: matched.reasons,
        pending: matched.pending,
        score: matched.score,
      };
      if (!best.has(target.id) || best.get(target.id).score < candidate.score)
        best.set(target.id, candidate);
    }
  return [...best.values()]
    .sort((a, b) => b.score - a.score)
    .slice(0, 24)
    .map(({ score, ...rest }) => rest);
}
export async function getProposal(id: string, userId: string, sql: Sql = pool) {
  const p = (
    await sql.query(
      "SELECT p.*,a.nickname proposer_name,b.nickname recipient_name FROM exchange_proposals p JOIN users a ON a.id=p.proposer_id JOIN users b ON b.id=p.recipient_id WHERE p.id=$1 AND $2 IN(p.proposer_id,p.recipient_id)",
      [id, userId],
    )
  ).rows[0];
  demand(p, 404, "교환을 찾을 수 없어요.");
  const acceptances = (
    await sql.query(
      "SELECT user_id FROM exchange_acceptances WHERE proposal_id=$1 AND version=$2",
      [id, p.version],
    )
  ).rows.map((r) => r.user_id);
  const fulfillments = (
    await sql.query(
      "SELECT * FROM exchange_fulfillments WHERE proposal_id=$1",
      [id],
    )
  ).rows;
  const events = (
    await sql.query(
      "SELECT id,actor_id,kind,data,created_at FROM exchange_events WHERE proposal_id=$1 ORDER BY created_at DESC LIMIT 40",
      [id],
    )
  ).rows;
  const reviews = (
    await sql.query(
      "SELECT author_id,text,CASE WHEN author_id=$2 THEN feedback ELSE '' END feedback,created_at FROM exchange_reviews WHERE proposal_id=$1",
      [id, userId],
    )
  ).rows;
  return { ...p, acceptances, fulfillments, events, reviews };
}
export async function lockedProposal(sql: Sql, id: string, userId: string) {
  const p = (
    await sql.query("SELECT * FROM exchange_proposals WHERE id=$1 FOR UPDATE", [
      id,
    ])
  ).rows[0];
  demand(p && participantSide(p, userId), 404, "교환을 찾을 수 없어요.");
  return p;
}
export async function proposalMessage(
  sql: Sql,
  p: any,
  actor: string,
  content: string,
) {
  const seq = (
    await sql.query(
      "UPDATE chat_rooms SET last_message_seq=last_message_seq+1,last_message=$2,last_message_at=now(),updated_at=now() WHERE id=$1 RETURNING last_message_seq",
      [p.room_id, content],
    )
  ).rows[0].last_message_seq;
  await sql.query(
    "INSERT INTO messages(room_id,sender_id,author_kind,type,content,metadata,room_seq) VALUES($1,$2,'system','text',$3,$4,$5)",
    [
      p.room_id,
      actor,
      content,
      JSON.stringify({ exchangeProposalId: p.id, exchangeVersion: p.version }),
      seq,
    ],
  );
  await sql.query(
    "UPDATE chat_room_members SET hidden_at=NULL WHERE room_id=$1",
    [p.room_id],
  );
}
export async function notifyProposal(p: any, actor: string) {
  const { sendPushToUser } = await import("./push");
  for (const userId of [p.proposer_id, p.recipient_id].filter(
    (id) => id !== actor,
  ))
    void sendPushToUser(userId, {
      title: "DavaQ 교환 알림",
      body: "새로운 교환 제안이나 조건 변경이 있어요. 내용을 확인해 주세요.",
      url: "/chat/" + p.room_id,
      tag: "exchange:" + p.id,
      type: "exchange",
    }).catch(() => {});
  await publishRealtimeEvent({
    type: "room.updated",
    userIds: [p.proposer_id, p.recipient_id],
    roomId: p.room_id,
    actorUserId: actor,
    data: { exchangeProposalId: p.id },
  }).catch(() => {});
}
export async function reserveProposal(sql: Sql, p: any) {
  const participants = [p.proposer_id, p.recipient_id].sort();
  for (const user of participants)
    await sql.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
      "davaq-reservation:" + user,
    ]);
  const listings = (
    await sql.query(
      "SELECT * FROM exchange_listings WHERE id=ANY($1::uuid[]) ORDER BY id FOR UPDATE",
      [[p.offer_id, p.requested_id]],
    )
  ).rows;
  const offer = listings.find((l) => l.id === p.offer_id),
    target = listings.find((l) => l.id === p.requested_id);
  demand(
    offer &&
      target &&
      offer.mode === "offer" &&
      target.mode === "offer" &&
      offer.status === "published" &&
      target.status === "published",
    409,
    "공개 상태가 바뀌었어요. 항목을 다시 확인해 주세요.",
  );
  demand(
    offer.owner_id === p.proposer_id && target.owner_id === p.recipient_id,
    409,
    "제공자가 변경됐어요.",
  );
  demand(
    offer.version === p.snapshots.offer.version &&
      target.version === p.snapshots.requested.version,
    409,
    "등록 내용이 바뀌었어요. 제안 조건을 새로 저장해 주세요.",
  );
  demand(
    !(await blocked(sql, p.proposer_id, p.recipient_id)),
    403,
    "차단 관계에서는 새 교환을 확정할 수 없어요.",
  );
  for (const listing of listings)
    demand(
      categoryEligible({
        category: listing.category,
        title: listing.title,
        description: listing.description,
        wantedText: listing.wanted_text,
      }),
      409,
      "운영 검토가 필요한 항목이에요.",
    );
  const slots = [
    { listing: offer, start: p.terms.offerStartsAt },
    { listing: target, start: p.terms.requestedStartsAt },
  ];
  for (const { listing, start } of slots) {
    const slot = interval(start, listing.duration_minutes);
    demand(slot.from > new Date(), 409, "미래 일정으로 다시 정해주세요.");
    const overlap = (
      await sql.query(
        `SELECT 1 FROM exchange_reservations r JOIN exchange_proposals existing ON existing.id=r.proposal_id WHERE r.active AND
   ((r.listing_id=$1 AND $6='goods') OR (($2::uuid[] && ARRAY[existing.proposer_id,existing.recipient_id]) AND r.starts_at<$4 AND r.ends_at>$3)) AND r.proposal_id<>$5 LIMIT 1`,
        [listing.id, participants, slot.from, slot.to, p.id, listing.kind],
      )
    ).rows[0];
    const relayOverlap=(await sql.query(`SELECT 1 FROM exchange_relay_reservations r WHERE r.active AND ((r.listing_id=$1 AND ($5='goods' OR r.kind='goods')) OR ($2::uuid[] && ARRAY[r.provider_id,r.receiver_id] AND r.starts_at<$4 AND r.ends_at>$3)) LIMIT 1`,[listing.id,participants,slot.from,slot.to,listing.kind])).rows[0];
    demand(
      !overlap && !relayOverlap,
      409,
      "이미 예약된 물건이나 시간이에요. 다른 일정을 선택해 주세요.",
    );
    await sql.query(
      "INSERT INTO exchange_reservations(proposal_id,listing_id,owner_id,starts_at,ends_at) VALUES($1,$2,$3,$4,$5)",
      [p.id, listing.id, listing.owner_id, slot.from, slot.to],
    );
    await sql.query(
      "INSERT INTO exchange_fulfillments(proposal_id,provider_id) VALUES($1,$2)",
      [p.id, listing.owner_id],
    );
  }
  await sql.query(
    "UPDATE exchange_proposals SET status='reserved',updated_at=now() WHERE id=$1",
    [p.id],
  );
}
export async function createProposal(
  userId: string,
  offerId: string,
  requestedId: string,
  terms: ExchangeTerms,
  requestKey: string,
) {
  return transaction(async (sql) => {
    await sql.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
      "davaq-create:" + userId + ":" + requestKey,
    ]);
    const prior = (
      await sql.query(
        "SELECT p.* FROM exchange_proposals p JOIN exchange_events e ON e.proposal_id=p.id WHERE e.actor_id=$1 AND e.kind='created' AND e.request_key=$2",
        [userId, requestKey],
      )
    ).rows[0];
    if (prior) return prior;
    const offers = (
      await sql.query(
        "SELECT * FROM exchange_listings WHERE id=ANY($1::uuid[]) ORDER BY id FOR UPDATE",
        [[offerId, requestedId]],
      )
    ).rows;
    const offer = offers.find((r) => r.id === offerId),
      requested = offers.find((r) => r.id === requestedId);
    demand(
      offer?.owner_id === userId &&
        offer.mode === "offer" &&
        offer.status === "published",
      400,
      "내가 공개한 제공 항목을 선택해 주세요.",
    );
    demand(
      requested &&
        requested.owner_id !== userId &&
        requested.mode === "offer" &&
        requested.status === "published",
      400,
      "교환할 상대 항목을 확인해 주세요.",
    );
    demand(
      !(await blocked(sql, userId, requested.owner_id)),
      403,
      "교환을 제안할 수 없는 사용자예요.",
    );
    for (const l of offers)
      demand(
        categoryEligible({
          category: l.category,
          title: l.title,
          description: l.description,
          wantedText: l.wanted_text,
        }),
        400,
        "검토가 필요한 항목이에요.",
      );
    const room = (
      await sql.query(
        "INSERT INTO chat_rooms(type,category,visibility,owner_id) VALUES('direct','casual','private',$1) RETURNING id",
        [userId],
      )
    ).rows[0];
    await sql.query(
      "INSERT INTO chat_room_members(room_id,user_id) VALUES($1,$2),($1,$3)",
      [room.id, userId, requested.owner_id],
    );
    const snapshots = {
      offer: listingDto(offer),
      requested: listingDto(requested),
    };
    const p = (
      await sql.query(
        "INSERT INTO exchange_proposals(proposer_id,recipient_id,offer_id,requested_id,room_id,terms,snapshots) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *",
        [
          userId,
          requested.owner_id,
          offerId,
          requestedId,
          room.id,
          JSON.stringify(terms),
          JSON.stringify(snapshots),
        ],
      )
    ).rows[0];
    await sql.query(
      "INSERT INTO exchange_proposal_versions(proposal_id,version,actor_id,terms,snapshots) VALUES($1,1,$2,$3,$4)",
      [p.id, userId, JSON.stringify(terms), JSON.stringify(snapshots)],
    );
    await sql.query(
      "INSERT INTO exchange_events(proposal_id,actor_id,kind,request_key) VALUES($1,$2,'created',$3)",
      [p.id, userId, requestKey],
    );
    await proposalMessage(
      sql,
      p,
      userId,
      "교환 제안: " +
        offer.title +
        " ↔ " +
        requested.title +
        " · 조건을 확인해 주세요.",
    );
    return p;
  });
}
export async function actOnProposal(
  id: string,
  userId: string,
  input: {
    action: string;
    version: number;
    requestKey: string;
    terms?: ExchangeTerms;
    note?: string;
  },
) {
  return transaction(async (sql) => {
    const p = await lockedProposal(sql, id, userId);
    const prior = (
      await sql.query(
        "SELECT 1 FROM exchange_events WHERE proposal_id=$1 AND actor_id=$2 AND request_key=$3",
        [id, userId, input.requestKey],
      )
    ).rows[0];
    if (prior) return p;
    demand(
      p.version === input.version,
      409,
      "새로운 제안이 있어요. 최신 조건을 확인해 주세요.",
    );
    const action = input.action;
    if (["accept", "revise"].includes(action)) {
      demand(
        p.status === "negotiating",
        409,
        "현재 상태에서는 조건을 변경하거나 수락할 수 없어요.",
      );
      demand(
        new Date(p.expires_at) > new Date(),
        409,
        "만료된 제안이에요. 새로 제안해 주세요.",
      );
      demand(
        !(await blocked(sql, p.proposer_id, p.recipient_id)),
        403,
        "교환을 진행할 수 없는 사용자예요.",
      );
    }
    if (action === "revise") {
      demand(input.terms, 400, "조건이 필요해요.");
      const offer = await getListing(p.offer_id, userId, sql),
        requested = await getListing(p.requested_id, userId, sql);
      demand(
        offer.status === "published" && requested.status === "published",
        409,
        "공개된 항목인지 확인해 주세요.",
      );
      p.version++;
      p.terms = input.terms;
      p.snapshots = {
        offer: listingDto(offer),
        requested: listingDto(requested),
      };
      await sql.query(
        "UPDATE exchange_proposals SET version=$2,terms=$3,snapshots=$4,expires_at=now()+interval '7 days',updated_at=now() WHERE id=$1",
        [id, p.version, JSON.stringify(p.terms), JSON.stringify(p.snapshots)],
      );
      await sql.query(
        "INSERT INTO exchange_proposal_versions(proposal_id,version,actor_id,terms,snapshots) VALUES($1,$2,$3,$4,$5)",
        [
          id,
          p.version,
          userId,
          JSON.stringify(p.terms),
          JSON.stringify(p.snapshots),
        ],
      );
    } else if (action === "accept") {
      await sql.query(
        "INSERT INTO exchange_acceptances(proposal_id,version,user_id) VALUES($1,$2,$3) ON CONFLICT DO NOTHING",
        [id, p.version, userId],
      );
      const accepted = (
        await sql.query(
          "SELECT user_id FROM exchange_acceptances WHERE proposal_id=$1 AND version=$2",
          [id, p.version],
        )
      ).rows;
      if (accepted.length === 2) {
        await reserveProposal(sql, p);
        p.status = "reserved";
      }
    } else if (action === "decline") {
      demand(
        p.status === "negotiating",
        409,
        "확정 후에는 취소 요청을 이용해 주세요.",
      );
      p.status = "declined";
    } else if (action === "cancel") {
      demand(
        ["negotiating", "reserved", "in_progress"].includes(p.status),
        409,
        "취소를 요청할 수 없는 상태예요.",
      );
      demand(
        input.note && input.note.length >= 2,
        400,
        "취소 이유를 적어주세요.",
      );
      p.status = p.status === "negotiating" ? "cancelled" : "cancel_requested";
    } else if (action === "approve_cancel") {
      demand(p.status === "cancel_requested", 409, "취소 요청이 없어요.");
      const requester = (
        await sql.query(
          "SELECT actor_id FROM exchange_events WHERE proposal_id=$1 AND kind='cancel' ORDER BY created_at DESC LIMIT 1",
          [id],
        )
      ).rows[0];
      demand(
        requester && requester.actor_id !== userId,
        403,
        "상대방이 취소 요청을 확인해야 해요.",
      );
      const provided = (
        await sql.query(
          "SELECT 1 FROM exchange_fulfillments WHERE proposal_id=$1 AND provided_at IS NOT NULL LIMIT 1",
          [id],
        )
      ).rows[0];
      demand(
        !provided,
        409,
        "이미 제공한 내용이 있어요. 분쟁 접수로 운영 검토를 요청해 주세요.",
      );
      p.status = "cancelled";
    } else if (action === "dispute") {
      demand(
        ["reserved", "in_progress", "cancel_requested"].includes(p.status),
        409,
        "현재 상태에서는 분쟁을 접수할 수 없어요.",
      );
      demand(
        input.note && input.note.length >= 5,
        400,
        "상황을 5자 이상 적어주세요.",
      );
      p.status = "disputed";
    } else if (action === "provided") {
      demand(
        ["reserved", "in_progress"].includes(p.status),
        409,
        "제공을 확인할 수 없는 상태예요.",
      );
      const reservation = (
        await sql.query(
          "SELECT starts_at FROM exchange_reservations WHERE proposal_id=$1 AND owner_id=$2",
          [id, userId],
        )
      ).rows[0];
      demand(
        reservation && new Date(reservation.starts_at) <= new Date(),
        409,
        "예약 시간이 된 뒤 제공 완료를 확인해 주세요.",
      );
      await sql.query(
        "UPDATE exchange_fulfillments SET provided_at=coalesce(provided_at,now()),evidence=$3 WHERE proposal_id=$1 AND provider_id=$2",
        [id, userId, input.note ?? ""],
      );
      p.status = "in_progress";
    } else if (action === "received") {
      demand(
        ["reserved", "in_progress"].includes(p.status),
        409,
        "수령을 확인할 수 없는 상태예요.",
      );
      const provider =
        p.proposer_id === userId ? p.recipient_id : p.proposer_id;
      const f = (
        await sql.query(
          "SELECT * FROM exchange_fulfillments WHERE proposal_id=$1 AND provider_id=$2",
          [id, provider],
        )
      ).rows[0];
      demand(f?.provided_at, 409, "상대방이 먼저 제공 완료를 표시해야 해요.");
      await sql.query(
        "UPDATE exchange_fulfillments SET received_at=coalesce(received_at,now()) WHERE proposal_id=$1 AND provider_id=$2",
        [id, provider],
      );
      const done = (
        await sql.query(
          "SELECT count(*)::int n FROM exchange_fulfillments WHERE proposal_id=$1 AND received_at IS NOT NULL",
          [id],
        )
      ).rows[0].n;
      p.status = done === 2 ? "completed" : "in_progress";
      if (done === 2) {
        await sql.query(
          "UPDATE exchange_listings SET status='closed',updated_at=now() WHERE kind='goods' AND id IN($1,$2)",
          [p.offer_id, p.requested_id],
        );
        for (const user of [p.proposer_id, p.recipient_id])
          await growth(sql, user, "exchange_completed", id);
      }
    } else throw new ExchangeError(400, "알 수 없는 동작이에요.");
    await sql.query(
      "UPDATE exchange_proposals SET status=$2,updated_at=now() WHERE id=$1",
      [id, p.status],
    );
    if (["cancelled", "completed"].includes(p.status))
      await sql.query(
        "UPDATE exchange_reservations SET active=false WHERE proposal_id=$1",
        [id],
      );
    await sql.query(
      "INSERT INTO exchange_events(proposal_id,actor_id,kind,data,request_key) VALUES($1,$2,$3,$4,$5)",
      [
        id,
        userId,
        action,
        JSON.stringify({ note: input.note ?? "", version: p.version }),
        input.requestKey,
      ],
    );
    const labels: Record<string, string> = {
      revise: "교환 조건을 수정했어요. 새 조건을 확인해 주세요.",
      accept:
        p.status === "reserved"
          ? "양쪽 동의가 완료되어 교환을 예약했어요."
          : "교환 조건에 동의했어요.",
      decline: "제안을 거절했어요.",
      cancel: "교환 취소를 요청했어요.",
      approve_cancel: "교환 취소에 동의했어요.",
      dispute: "운영 검토를 요청했어요.",
      provided: "내가 제공할 내용을 완료했어요.",
      received:
        p.status === "completed"
          ? "양쪽 제공을 확인해 교환이 완료됐어요."
          : "상대방의 제공을 확인했어요.",
    };
    await proposalMessage(sql, p, userId, labels[action] ?? action);
    return p;
  });
}
