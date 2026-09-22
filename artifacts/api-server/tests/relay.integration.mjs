import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
export async function testRelays({ request, pool, ok, listing, analyst }) {
  const users = [];
  for (let i = 0; i < 5; i++) {
    const id = randomUUID();
    users.push(id);
    await pool.query(
      "INSERT INTO users(id,clerk_id,email,nickname) VALUES($1,$2,$3,$4)",
      [id, "relay_it_" + id, id + "@example.invalid", "릴레이 검증 " + i],
    );
  }
  const [a, b, c, d, x] = users;
  const add = async (user, title, category, wants, extra = {}) => {
    const r = await request(user, "/exchange/listings", "POST", {
      ...listing(title, category, wants),
      ...extra,
    });
    assert.equal(r.status, 201, JSON.stringify(r));
    return r.data;
  };
  const la = await add(a, "발성 제공", "voice", ["tech"]),
    lb = await add(b, "사진 제공", "photo", ["voice"]),
    lc = await add(c, "개발 제공", "tech", ["photo"]),
    ld = await add(d, "음악 제공", "music", ["photo"]),
    le = await add(c, "개발 다른 연결", "tech", ["music"]);
  const ids = [la.id, lb.id, lc.id],
    termsFor = (path, days = 10) => ({
      legs: path.map((l, i) => ({
        listingId: l,
        startsAt: new Date(
          Date.now() + days * 86400000 + i * 3600000,
        ).toISOString(),
        location: "서로 합의한 장소",
        meetingPoint: {
          lat: 37.5712345,
          lng: 126.9812345,
          label: "릴레이 약속 장소 " + i,
        },
      })),
      note: "모두 확인할 제공 범위",
      cancellation: "시작 전 모두 동의하면 취소합니다.",
    });
  const terms = termsFor(ids);
  const create = async (path = ids, terms = termsFor(path)) =>
    request(a, "/exchange/relays", "POST", {
      listingIds: path,
      terms,
      requestKey: randomUUID(),
    });
  const action = (u, id, act, v = 1, extra = {}) =>
    request(u, "/exchange/relays/" + id + "/actions", "POST", {
      action: act,
      version: v,
      requestKey: randomUUID(),
      ...extra,
    });
  ok(
    (await request(null, "/exchange/relays/candidates")).status === 401,
    "relay search requires authentication",
  );
  const candidates = (await request(a, "/exchange/relays/candidates")).data;
  ok(
    candidates.items.some(
      (r) => r.listings.map((l) => l.id).join(",") === ids.join(","),
    ),
    "three-way directed route is discovered",
  );
  ok(
    candidates.items.some(
      (r) =>
        r.listings.map((l) => l.id).join(",") ===
        [la.id, lb.id, ld.id, le.id].join(","),
    ),
    "four-way directed route is discovered",
  );
  await pool.query(
    "INSERT INTO blocked_users(blocker_user_id,blocked_user_id) VALUES($1,$2)",
    [b, c],
  );
  ok(
    !(await request(a, "/exchange/relays/candidates")).data.items.some(
      (r) =>
        r.listings.some((l) => l.ownerId === b) &&
        r.listings.some((l) => l.ownerId === c),
    ),
    "a block between other participants excludes the whole cycle",
  );
  ok(
    (await create()).status === 403,
    "a forged blocked route cannot be created",
  );
  await pool.query(
    "DELETE FROM blocked_users WHERE blocker_user_id=$1 AND blocked_user_id=$2",
    [b, c],
  );
  ok(
    (await create([la.id, lb.id, lb.id])).status === 400,
    "repeated listings cannot form a route",
  );
  const body = { listingIds: ids, terms, requestKey: randomUUID() };
  let made = await request(a, "/exchange/relays", "POST", body);
  assert.equal(made.status, 201, JSON.stringify(made));
  let p = made.data;
  ok(
    p.terms.legs.every((l) => l.meetingPoint.lat === 37.57123),
    "relay legs preserve participant-only meeting points",
  );
  ok(
    p.members.length === 3 &&
      p.members.every((m) => m.accepted_version === null),
    "creating a relay does not imply any participant consent",
  );
  ok(
    (await request(a, "/exchange/relays", "POST", body)).data.id === p.id,
    "relay create retries do not duplicate proposals or chat rooms",
  );
  ok(
    (
      await request(b, "/exchange/relays", "POST", {
        listingIds: [lb.id, lc.id, la.id],
        terms,
        requestKey: randomUUID(),
      })
    ).data.id === p.id,
    "rotated proposals reuse the same active participant cycle",
  );
  ok(
    (await request(x, "/exchange/relays/" + p.id)).status === 404 &&
      (await action(x, p.id, "accept")).status === 404,
    "nonparticipants cannot read or mutate a relay",
  );
  ok(
    (await action(a, p.id, "accept", 99)).status === 409,
    "relay approvals reject stale versions",
  );
  const retryKey = randomUUID();
  await action(a, p.id, "accept", 1, { requestKey: retryKey });
  await action(a, p.id, "accept", 1, { requestKey: retryKey });
  ok(
    (
      await pool.query(
        "SELECT count(*)::int n FROM exchange_relay_events WHERE relay_id=$1 AND request_key=$2",
        [p.id, retryKey],
      )
    ).rows[0].n === 1,
    "relay actions are idempotent",
  );
  await action(b, p.id, "accept");
  await pool.query(
    "UPDATE exchange_listings SET version=version+1 WHERE id=$1",
    [lc.id],
  );
  ok(
    (await action(c, p.id, "accept")).status === 409,
    "listing edits invalidate previously captured relay terms",
  );
  terms.legs[0].meetingPoint.label = "변경한 릴레이 약속 장소";
  let revised = await action(a, p.id, "revise", 1, { terms });
  assert.equal(revised.status, 200, JSON.stringify(revised));
  p = revised.data;
  ok(
    p.version === 2 &&
      p.members.every((m) => !m.accepted_version) &&
      p.terms.legs[0].meetingPoint.label === "변경한 릴레이 약속 장소",
    "revising refreshes snapshots and resets every approval",
  );
  const accepted = await Promise.all(
    [a, b, c].map((u) => action(u, p.id, "accept", 2)),
  );
  assert.ok(
    accepted.every((r) => r.status === 200),
    JSON.stringify(accepted),
  );
  p = (await request(a, "/exchange/relays/" + p.id)).data;
  ok(
    p.status === "reserved" && p.members.every((m) => m.accepted_version === 2),
    "concurrent unanimous approval reserves the complete relay",
  );
  ok(
    (
      await pool.query(
        "SELECT count(*)::int n FROM exchange_relay_reservations WHERE relay_id=$1",
        [p.id],
      )
    ).rows[0].n === 3,
    "exactly one reservation exists for each directed leg",
  );
  ok(
    (
      await request(a, "/exchange/listings/" + la.id, "PATCH", {
        ...listing("바뀐 제공", "voice", ["tech"]),
        version: 1,
      })
    ).status === 409,
    "reserved relay listings cannot be edited mid-exchange",
  );
  const lx = await add(x, "새 발성 제공", "voice", ["tech"]);
  const direct = (
    await request(x, "/exchange/proposals", "POST", {
      offerId: lx.id,
      requestedId: lc.id,
      terms: {
        offerStartsAt: terms.legs[2].startsAt,
        requestedStartsAt: terms.legs[2].startsAt,
        location: "온라인",
        note: "충돌 검사",
        cancellation: "상호 합의 후 취소합니다.",
      },
      requestKey: randomUUID(),
    })
  ).data;
  const da = (u) =>
    request(u, "/exchange/proposals/" + direct.id + "/actions", "POST", {
      action: "accept",
      version: 1,
      requestKey: randomUUID(),
    });
  await da(x);
  ok(
    (await da(c)).status === 409,
    "direct trades cannot overlap active relay participant times",
  );
  ok(
    (await action(a, p.id, "provided", 2)).status === 409,
    "relay fulfillment cannot be claimed before the scheduled time",
  );
  await pool.query(
    "UPDATE exchange_relay_reservations SET starts_at=now()-interval '1 hour',ends_at=now()-interval '30 minutes' WHERE relay_id=$1",
    [p.id],
  );
  await action(a, p.id, "provided", 2);
  ok(
    (await action(c, p.id, "received", 2)).status === 409,
    "receipt belongs only to the incoming provider edge",
  );
  await action(b, p.id, "received", 2);
  ok(
    (await request(a, "/exchange/relays/" + p.id)).data.status ===
      "in_progress",
    "one receipt never completes the whole relay",
  );
  ok(
    (await action(b, p.id, "cancel", 2, { note: "계획 변경" })).status === 409,
    "partial delivery cannot be cancelled without operator review",
  );
  await action(b, p.id, "provided", 2);
  await action(c, p.id, "received", 2);
  await action(c, p.id, "provided", 2);
  await action(a, p.id, "received", 2);
  p = (await request(a, "/exchange/relays/" + p.id)).data;
  ok(
    p.status === "completed" && p.members.every((m) => m.received_at),
    "all directed receipts complete the relay",
  );
  ok(
    !(
      await pool.query(
        "SELECT 1 FROM exchange_relay_reservations WHERE relay_id=$1 AND active",
        [p.id],
      )
    ).rows.length,
    "completion releases all reservations",
  );
  let cancelled = (await create(ids, termsFor(ids, 12))).data;
  await Promise.all([a, b, c].map((u) => action(u, cancelled.id, "accept")));
  await action(a, cancelled.id, "cancel", 1, { note: "다른 날짜가 필요해요" });
  await action(b, cancelled.id, "approve_cancel");
  ok(
    (await request(a, "/exchange/relays/" + cancelled.id)).data.status ===
      "cancel_requested",
    "two of three cannot cancel a confirmed relay",
  );
  await action(c, cancelled.id, "approve_cancel");
  ok(
    (await request(a, "/exchange/relays/" + cancelled.id)).data.status ===
      "cancelled",
    "all participants must consent to cancellation",
  );
  const declined = (await create(ids, termsFor(ids, 14))).data;
  await action(b, declined.id, "decline");
  ok(
    (await action(a, declined.id, "accept")).status === 409,
    "declining closes the entire unconfirmed route",
  );
  const exp = (await create(ids, termsFor(ids, 15))).data;
  await pool.query(
    "UPDATE exchange_relays SET expires_at=now()-interval '1 hour' WHERE id=$1",
    [exp.id],
  );
  ok(
    (await request(a, "/exchange/relays/" + exp.id)).data.status ===
      "expired" && (await action(a, exp.id, "accept")).status === 409,
    "expired routes cannot be approved",
  );
  const disputed = (await create(ids, termsFor(ids, 16))).data;
  await Promise.all([a, b, c].map((u) => action(u, disputed.id, "accept")));
  await action(a, disputed.id, "dispute", 1, {
    note: "전달 조건에 문제가 생겼어요",
  });
  ok(
    (
      await request(analyst, "/exchange/admin/" + disputed.id, "POST", {
        kind: "relay",
        action: "cancel",
        reason: "운영 검토 테스트입니다.",
      })
    ).status === 403,
    "read-only operators cannot resolve relay disputes",
  );
  await pool.query(
    "INSERT INTO admin_roles(user_id,role) VALUES($1,'operations') ON CONFLICT DO NOTHING",
    [d],
  );
  ok(
    (await request(d, "/exchange/admin")).data.relays.some(
      (r) => r.id === disputed.id,
    ),
    "relay help requests appear in the operator queue",
  );
  ok(
    (
      await request(d, "/exchange/admin/" + disputed.id, "POST", {
        kind: "relay",
        action: "cancel",
        reason: "전달 전 전원 확인 후 취소합니다.",
      })
    ).status === 200,
    "authorized operators can resolve a relay with an audit reason",
  );
  // Opposite race direction: an existing direct reservation must block a relay.
  const direct2 = (
    await request(x, "/exchange/proposals", "POST", {
      offerId: lx.id,
      requestedId: lc.id,
      terms: {
        offerStartsAt: termsFor(ids, 20).legs[2].startsAt,
        requestedStartsAt: termsFor(ids, 20).legs[2].startsAt,
        location: "온라인",
        note: "역방향 충돌 검사",
        cancellation: "상호 합의 후 취소합니다.",
      },
      requestKey: randomUUID(),
    })
  ).data;
  for (const u of [x, c])
    assert.equal(
      (
        await request(
          u,
          "/exchange/proposals/" + direct2.id + "/actions",
          "POST",
          { action: "accept", version: 1, requestKey: randomUUID() },
        )
      ).status,
      200,
    );
  const blocked = (await create(ids, termsFor(ids, 20))).data;
  await action(a, blocked.id, "accept");
  await action(b, blocked.id, "accept");
  ok(
    (await action(c, blocked.id, "accept")).status === 409,
    "relay reservation rejects a conflicting direct reservation",
  );
  ok(
    !(
      await pool.query(
        "SELECT 1 FROM exchange_relay_reservations WHERE relay_id=$1",
        [blocked.id],
      )
    ).rows.length,
    "failed final approval leaves no partial relay reservations",
  );

  // A four-person chain containing a unique good cannot reserve that good twice,
  // even at a different time, and closes it after all four receipts.
  const good = await add(a, "양도 가능한 책 한 권", "goods", ["tech"], {
    kind: "goods",
  });
  const gb = await add(b, "책 교환 사진 촬영", "photo", ["goods"]);
  const four = [good.id, gb.id, ld.id, le.id];
  const fourRelay = (await create(four, termsFor(four, 30))).data;
  for (const u of [a, b, d, c])
    assert.equal((await action(u, fourRelay.id, "accept")).status, 200);
  ok(
    (await request(a, "/exchange/relays/" + fourRelay.id)).data.status ===
      "reserved",
    "four participants can reserve a complete chain",
  );
  ok(
    !(await request(a, "/exchange/relays/candidates")).data.items.some((r) =>
      r.listings.some((l) => l.id === good.id),
    ),
    "own reserved goods are excluded from new candidates",
  );
  const wish = await add(x, "물건을 원하는 개발 제공", "tech", ["goods"]);
  const double = (
    await request(x, "/exchange/proposals", "POST", {
      offerId: wish.id,
      requestedId: good.id,
      terms: {
        offerStartsAt: termsFor(four, 40).legs[0].startsAt,
        requestedStartsAt: termsFor(four, 40).legs[1].startsAt,
        location: "온라인",
        note: "물건 중복 방지",
        cancellation: "상호 합의 후 취소합니다.",
      },
      requestKey: randomUUID(),
    })
  ).data;
  assert.ok(double.id);
  await request(x, "/exchange/proposals/" + double.id + "/actions", "POST", {
    action: "accept",
    version: 1,
    requestKey: randomUUID(),
  });
  ok(
    (
      await request(
        a,
        "/exchange/proposals/" + double.id + "/actions",
        "POST",
        { action: "accept", version: 1, requestKey: randomUUID() },
      )
    ).status === 409,
    "reserved goods cannot be double-booked in direct trades at another time",
  );
  await pool.query(
    "UPDATE exchange_relay_reservations SET starts_at=now()-interval '1 hour',ends_at=now()-interval '30 minutes' WHERE relay_id=$1",
    [fourRelay.id],
  );
  for (const u of [a, b, d, c])
    assert.equal((await action(u, fourRelay.id, "provided")).status, 200);
  for (const u of [a, b, d, c])
    assert.equal((await action(u, fourRelay.id, "received")).status, 200);
  ok(
    (await request(a, "/exchange/relays/" + fourRelay.id)).data.status ===
      "completed",
    "four-person chain completes only after every incoming receipt",
  );
  ok(
    (
      await pool.query("SELECT status FROM exchange_listings WHERE id=$1", [
        good.id,
      ])
    ).rows[0].status === "closed",
    "completed relay closes the exchanged good",
  );
}
