import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

export async function testWishes({ pool, request, ok, listing }) {
  const users = [];
  for (let i = 0; i < 5; i++) {
    const id = randomUUID();
    users.push(id);
    await pool.query(
      "INSERT INTO users(id,clerk_id,email,nickname) VALUES($1,$2,$3,$4)",
      [id, "wish_it_" + id, id + "@example.invalid", "위시 검증 " + i],
    );
  }
  const [a, b, c, d, x] = users;
  const input = () => ({
    title: "갖고 싶은 Sony WH-1000XM5",
    description: "모델과 상태는 직접 확인합니다.",
    keywords: ["WH-1000XM5"],
    kind: "goods",
    category: "goods",
    requestKey: randomUUID(),
  });
  const addWish = async (user = a, extra = {}) => {
    const r = await request(user, "/exchange/wishes", "POST", {
      ...input(),
      ...extra,
    });
    assert.equal(r.status, 201, JSON.stringify(r));
    return r.data;
  };
  const countListings = async () =>
    (
      await pool.query(
        "SELECT count(*)::int n FROM exchange_listings WHERE owner_id=$1",
        [a],
      )
    ).rows[0].n;
  ok(
    (await request(null, "/exchange/wishes")).status === 401 &&
      (
        await request(null, "/exchange/wishes/draft", "POST", {
          text: "헤드폰",
        })
      ).status === 401,
    "wish list and draft require authentication",
  );
  ok(
    (await request(a, "/exchange/wishes/draft", "POST", {})).status === 400,
    "wish draft requires text or an owned image",
  );
  ok(
    (
      await request(a, "/exchange/wishes/draft", "POST", {
        text: "x".repeat(2001),
      })
    ).status === 400,
    "wish draft rejects unbounded text before model work",
  );
  const before = await countListings();
  const draft = await request(a, "/exchange/wishes/draft", "POST", {
    text: "Sony WH-1000XM5 헤드폰을 원해요",
  });
  assert.equal(draft.status, 200, JSON.stringify(draft));
  ok(
    draft.data.title.includes("WH-1000XM5") &&
      Array.isArray(draft.data.questions),
    "private model draft returns editable goal and confirmation questions",
  );
  ok(
    (await countListings()) === before &&
      !(await request(a, "/exchange/wishes")).data.items.length,
    "drafting never creates a public listing or saves a wish automatically",
  );

  const image = "/objects/uploads/" + randomUUID();
  await pool.query(
    "INSERT INTO exchange_media(object_path,owner_id) VALUES($1,$2)",
    [image, b],
  );
  ok(
    (await request(a, "/exchange/wishes/draft", "POST", { imageKey: image }))
      .status === 403,
    "another user's image cannot be sent to the draft model",
  );
  ok(
    (
      await request(a, "/exchange/wishes", "POST", {
        ...input(),
        imageKey: image,
      })
    ).status === 403,
    "another user's image cannot be attached to a saved wish",
  );
  ok(
    (
      await request(a, "/exchange/wishes/draft", "POST", {
        imageKey: "https://example.invalid/private-image.png",
      })
    ).status === 400,
    "wish drafts never fetch arbitrary external image URLs",
  );
  const ownImage = "/objects/uploads/" + randomUUID();
  await pool.query(
    "INSERT INTO exchange_media(object_path,owner_id) VALUES($1,$2)",
    [ownImage, a],
  );
  const body = { ...input(), imageKey: ownImage };
  let w = (await request(a, "/exchange/wishes", "POST", body)).data;
  assert.ok(w.id, JSON.stringify(w));
  ok(
    w.status === "active" &&
      w.version === 1 &&
      w.imageKey === ownImage &&
      (await countListings()) === before,
    "saving a private wish does not publish an offer or wanted listing",
  );
  const duplicate = await request(a, "/exchange/wishes", "POST", body);
  ok(
    duplicate.data.id === w.id &&
      (await request(a, "/exchange/wishes")).data.items.length === 1,
    "wish creation retries return the same goal",
  );
  ok(
    (
      await request(a, "/exchange/wishes", "POST", {
        ...body,
        title: "다른 구매 목표",
      })
    ).status === 409,
    "reusing a wish request key with different content is rejected",
  );
  ok(
    !(await request(b, "/exchange/wishes")).data.items.some(
      (v) => v.id === w.id,
    ) && (await request(b, "/exchange/wishes/" + w.id)).status === 404,
    "wish collection and details stay private to their owner",
  );
  ok(
    (
      await request(b, "/exchange/wishes/" + w.id, "PATCH", {
        version: 1,
        title: "변조한 구매 목표",
      })
    ).status === 404 &&
      (await request(b, "/exchange/wishes/" + w.id + "/candidates")).status ===
        404,
    "nonowners cannot update a goal or search its candidates",
  );
  ok(
    (
      await request(a, "/exchange/wishes/" + w.id, "PATCH", {
        version: 1,
        imageKey: image,
      })
    ).status === 403,
    "goal updates enforce image ownership as well",
  );
  const patch = await request(a, "/exchange/wishes/" + w.id, "PATCH", {
    version: 1,
    description: "확인할 상태와 구성품",
  });
  assert.equal(patch.status, 200, JSON.stringify(patch));
  w = patch.data;
  ok(
    w.version === 2 && w.description === "확인할 상태와 구성품",
    "goal edits increment the version",
  );
  ok(
    w.imageKey === ownImage,
    "editing a goal description preserves its screenshot reference",
  );
  ok(
    (
      await request(a, "/exchange/wishes/" + w.id, "PATCH", {
        version: w.version,
      })
    ).status === 400,
    "a version-only PATCH cannot silently clear private goal fields",
  );
  ok(
    (
      await request(a, "/exchange/wishes/" + w.id, "PATCH", {
        version: 1,
        title: "오래된 수정",
      })
    ).status === 409,
    "stale wish updates cannot overwrite a newer goal",
  );
  ok(
    (await request(a, "/exchange/wishes", "POST", { ...input(), keywords: [] }))
      .status === 400 &&
      (
        await request(a, "/exchange/wishes", "POST", {
          ...input(),
          keywords: Array(7).fill("헤드폰"),
        })
      ).status === 400,
    "goal search terms must be explicit and bounded",
  );

  const add = async (user, title, category, wants, extra = {}) => {
    const r = await request(user, "/exchange/listings", "POST", {
      ...listing(title, category, wants),
      ...extra,
    });
    assert.equal(r.status, 201, JSON.stringify(r));
    return r.data;
  };
  const la = await add(a, "위시 발성 수업", "voice", ["tech"]);
  const lb = await add(b, "위시 프로필 사진 촬영", "photo", ["voice"]);
  const lc = await add(c, "Sony WH-1000XM5 헤드폰", "goods", ["photo"], {
    kind: "goods",
  });
  const ld = await add(d, "Sony WH-1000XM5 헤드폰 블랙", "goods", ["voice"], {
    kind: "goods",
  });
  const wrong = await add(c, "Sony WH-1000XM4 헤드폰", "goods", ["voice"], {
    kind: "goods",
    description: "Sony WH-1000XM5 헤드폰과 비교한 이전 모델입니다.",
  });
  const longer = await add(
    c,
    "Sony WH-1000XM50 테스트 모델",
    "goods",
    ["voice"],
    { kind: "goods" },
  );
  const hidden = await add(
    c,
    "Sony WH-1000XM5 헤드폰 비공개",
    "goods",
    ["voice"],
    { kind: "goods", status: "draft" },
  );
  const paused = await add(
    c,
    "Sony WH-1000XM5 헤드폰 숨김",
    "goods",
    ["voice"],
    { kind: "goods", status: "paused" },
  );
  const want = await add(
    c,
    "Sony WH-1000XM5 헤드폰 구해요",
    "goods",
    ["voice"],
    { kind: "goods", mode: "want" },
  );
  const search = () => request(a, "/exchange/wishes/" + w.id + "/candidates");
  let found = await search();
  assert.equal(found.status, 200, JSON.stringify(found));
  const routeIds = [la.id, lb.id, lc.id];
  const routeMatches = (r) =>
    r.listings.map((l) => l.id).join(",") === routeIds.join(",");
  ok(
    found.data.direct.some(
      (m) => m.offer.id === la.id && m.target.id === ld.id,
    ),
    "a saved purchase goal finds a reciprocal direct exchange",
  );
  ok(
    found.data.relays.some(routeMatches),
    "a goal finds a real three-person route even when the original offer wanted another category",
  );
  const discovered = (result) => [
    ...result.targets,
    ...result.direct.map((m) => m.target),
    ...result.relays.map((r) => r.listings[r.listings.length - 1]),
  ];
  ok(
    discovered(found.data).some((t) => t.id === lc.id) &&
      discovered(found.data).some((t) => t.id === ld.id),
    "actual target items appear in the corresponding search result sections",
  );
  ok(
    !discovered(found.data).some((t) =>
      [wrong.id, longer.id, hidden.id, paused.id, want.id].includes(t.id),
    ),
    "goal targets exclude other model numbers, drafts, paused and wanted listings",
  );
  ok(
    found.data.offersCount === 1 &&
      found.data.targetCount >= 2 &&
      Number.isFinite(Date.parse(found.data.searchedAt)),
    "search reports actual offer coverage and search time",
  );
  const laAfter = (await request(a, "/exchange/listings/" + la.id)).data;
  ok(
    laAfter.wantedCategories.join(",") === "tech" &&
      laAfter.version === la.version,
    "goal matching never rewrites the owner's original offer preferences",
  );
  const noOffers = await addWish(x);
  const empty = await request(
    x,
    "/exchange/wishes/" + noOffers.id + "/candidates",
  );
  ok(
    empty.data.offersCount === 0 &&
      !empty.data.direct.length &&
      !empty.data.relays.length &&
      empty.data.targets.length > 0,
    "users without offers see target items without fabricated exchange routes",
  );

  const terms = {
    legs: routeIds.map((listingId, i) => ({
      listingId,
      startsAt: new Date(
        Date.now() + 20 * 86400000 + i * 3600000,
      ).toISOString(),
      location: "위시 격리 검증 장소",
    })),
    note: "조건을 확인하고 동의합니다.",
    cancellation: "모두 합의한 뒤 취소합니다.",
  };
  const createRelay = (extra = {}) =>
    request(a, "/exchange/relays", "POST", {
      listingIds: routeIds,
      terms,
      requestKey: randomUUID(),
      wishId: w.id,
      ...extra,
    });
  await pool.query(
    "INSERT INTO blocked_users(blocker_user_id,blocked_user_id) VALUES($1,$2)",
    [b, c],
  );
  found = await search();
  ok(
    !found.data.relays.some(routeMatches),
    "a block between other members removes the entire goal route",
  );
  ok(
    (await createRelay()).status === 403,
    "forging a blocked wish relay does not bypass member protections",
  );
  await pool.query(
    "DELETE FROM blocked_users WHERE blocker_user_id=$1 AND blocked_user_id=$2",
    [b, c],
  );
  await pool.query(
    "INSERT INTO blocked_users(blocker_user_id,blocked_user_id) VALUES($1,$2)",
    [d, a],
  );
  found = await search();
  ok(
    !found.data.targets.some((t) => t.id === ld.id) &&
      !found.data.direct.some((m) => m.target.id === ld.id),
    "reverse blocks remove goal targets and direct routes",
  );
  await pool.query(
    "DELETE FROM blocked_users WHERE blocker_user_id=$1 AND blocked_user_id=$2",
    [d, a],
  );
  ok(
    (await createRelay({ wishId: noOffers.id })).status === 404,
    "another user's private goal cannot authorize relay creation",
  );
  const unrelated = await addWish(a, {
    title: "갖고 싶은 카메라",
    keywords: ["EOS-R5"],
  });
  ok(
    (await createRelay({ wishId: unrelated.id })).status === 409,
    "a goal cannot authorize a relay that does not return its requested item",
  );
  let p = await request(a, "/exchange/wishes/" + w.id, "PATCH", {
    version: w.version,
    status: "paused",
  });
  assert.equal(p.status, 200, JSON.stringify(p));
  w = p.data;
  ok(
    w.description === "확인할 상태와 구성품" && w.imageKey === ownImage,
    "status-only goal updates preserve the existing description and screenshot",
  );
  ok(
    (await search()).status === 409 && (await createRelay()).status === 404,
    "paused goals cannot start searches or new relays",
  );
  p = await request(a, "/exchange/wishes/" + w.id, "PATCH", {
    version: w.version,
    status: "active",
  });
  assert.equal(p.status, 200, JSON.stringify(p));
  w = p.data;

  const relayResult = await createRelay();
  assert.equal(relayResult.status, 201, JSON.stringify(relayResult));
  let relay = relayResult.data;
  ok(
    relay.members.every((m) => m.accepted_version === null),
    "a goal suggestion does not imply participant consent",
  );
  const goal = (
    await pool.query("SELECT goal_context FROM exchange_relays WHERE id=$1", [
      relay.id,
    ])
  ).rows[0].goal_context;
  ok(
    Boolean(goal) && JSON.stringify(goal).includes("WH-1000XM5"),
    "goal relay captures the original requested item privately",
  );
  for (const user of [a, b, c]) {
    const value = (await request(user, "/exchange/relays/" + relay.id)).data;
    assert.equal(value.goal_context, undefined);
    assert.equal(value.goalContext, undefined);
    assert.ok(!JSON.stringify(value).includes(ownImage));
  }
  ok(
    true,
    "relay participants receive exchange terms without the private wish screenshot or goal context",
  );
  const deleted = await request(a, "/exchange/wishes/" + w.id, "PATCH", {
    version: w.version,
    status: "deleted",
  });
  assert.equal(deleted.status, 200, JSON.stringify(deleted));
  const wiped = (
    await pool.query("SELECT * FROM exchange_wishes WHERE id=$1", [w.id])
  ).rows[0];
  ok(
    wiped.title === "" &&
      wiped.description === "" &&
      !wiped.keywords.length &&
      wiped.image_key === null,
    "deleting a saved wish removes its private text and screenshot reference",
  );
  ok(
    (await request(a, "/exchange/wishes/" + w.id)).status === 404 &&
      (await search()).status === 404 &&
      !(await request(a, "/exchange/wishes")).data.items.some(
        (v) => v.id === w.id,
      ),
    "deleted wishes disappear from detail, search and collection",
  );
  const action = (user, act, version = 1, extra = {}) =>
    request(user, "/exchange/relays/" + relay.id + "/actions", "POST", {
      action: act,
      version,
      requestKey: randomUUID(),
      ...extra,
    });
  for (const user of [a, b])
    assert.equal((await action(user, "accept")).status, 200);
  relay = (await request(a, "/exchange/relays/" + relay.id)).data;
  ok(
    relay.status === "negotiating",
    "a partial set of approvals cannot reserve a goal relay",
  );
  const final = await action(c, "accept");
  assert.equal(final.status, 200, JSON.stringify(final));
  relay = final.data;
  ok(
    relay.status === "reserved" &&
      relay.members.every((m) => m.accepted_version === 1),
    "unanimous approval reserves the captured goal relay even after the original private wish is deleted",
  );
  const later = await addWish(a);
  const afterReserve = await request(
    a,
    "/exchange/wishes/" + later.id + "/candidates",
  );
  ok(
    !afterReserve.data.targets.some((t) => t.id === lc.id) &&
      !afterReserve.data.relays.some((r) =>
        r.listings.some((l) => l.id === lc.id),
      ),
    "reserved goods cannot be recommended again as goal targets or relay legs",
  );
  for (let n = 0; n < 48; n++)
    await addWish(x, { title: "격리 한도 확인 " + n });
  const raced = await Promise.all([
    request(x, "/exchange/wishes", "POST", input()),
    request(x, "/exchange/wishes", "POST", input()),
  ]);
  ok(
    raced.filter((r) => r.status === 201).length === 1 &&
      raced.filter((r) => r.status === 409).length === 1 &&
      (await request(x, "/exchange/wishes")).data.items.length === 50,
    "concurrent creation cannot exceed the private goal limit",
  );
  await pool.query(
    "UPDATE exchange_wishes SET status='fulfilled' WHERE user_id=$1",
    [x],
  );
}

export async function testWishWorker({ pool, request, ok, listing }) {
  const { runWishSearches } = await import("../src/lib/wishWorker.ts");
  const { listAgentConversation } =
    await import("../src/lib/agentConversation.ts");
  // Every row in this connection belongs to this disposable integration schema.
  // Keep earlier fixtures out of the batch so only the due worker cases compete.
  await pool.query(
    "UPDATE exchange_wishes SET next_search_at=now()+interval '1 day'",
  );
  const users = [];
  for (let n = 0; n < 3; n++) {
    const id = randomUUID();
    users.push(id);
    await pool.query(
      "INSERT INTO users(id,clerk_id,email,nickname) VALUES($1,$2,$3,$4)",
      [
        id,
        "wish_worker_it_" + id,
        id + "@example.invalid",
        "소원 재검색 검증 " + n,
      ],
    );
  }
  const [owner, targetOwner, disabledOwner] = users;
  const save = async (user, extra = {}) => {
    const r = await request(user, "/exchange/wishes", "POST", {
      title: "Weaver ZX-9300 헤드폰",
      description: "격리 worker fixture",
      keywords: ["ZX-9300"],
      kind: "goods",
      category: "goods",
      requestKey: randomUUID(),
      ...extra,
    });
    assert.equal(r.status, 201, JSON.stringify(r));
    return r.data;
  };
  const add = async (user, title, category, wants, extra = {}) => {
    const r = await request(user, "/exchange/listings", "POST", {
      ...listing(title, category, wants),
      ...extra,
    });
    assert.equal(r.status, 201, JSON.stringify(r));
    return r.data;
  };
  await add(owner, "재검색 발성 교환", "voice", ["tech"]);
  await add(disabledOwner, "꺼진 재검색 발성 교환", "voice", ["tech"]);
  const target = await add(
    targetOwner,
    "Weaver ZX-9300 헤드폰",
    "goods",
    ["voice"],
    { kind: "goods" },
  );
  const active = await save(owner),
    off = await save(disabledOwner),
    paused = await save(owner),
    deleted = await save(owner);
  const foreign = await save(targetOwner, {
    title: "다른 계정만 볼 수 있는 구매 목표",
    keywords: ["외부비공개"],
  });
  assert.equal(
    (
      await request(owner, "/exchange/wishes/" + paused.id, "PATCH", {
        version: 1,
        status: "paused",
      })
    ).status,
    200,
  );
  assert.equal(
    (
      await request(owner, "/exchange/wishes/" + deleted.id, "PATCH", {
        version: 1,
        status: "deleted",
      })
    ).status,
    200,
  );
  const goalIds = [active.id, off.id, paused.id, deleted.id, foreign.id];
  const notifications = async () =>
    (
      await pool.query(
        "SELECT * FROM agent_messages WHERE request_key LIKE 'wish-match:%' AND metadata->>'wishId'=ANY($1::text[])",
        [goalIds],
      )
    ).rows;
  const goalRow = async (id) =>
    (await pool.query("SELECT * FROM exchange_wishes WHERE id=$1", [id]))
      .rows[0];
  const setSearch = async (user, enabled) => {
    const me = await request(user, "/agents/me");
    assert.equal(me.status, 200, JSON.stringify(me));
    const s = me.data.settings;
    const r = await request(user, "/agents/me/settings", "PATCH", {
      name: s.name,
      tone: s.tone,
      activityLearning: false,
      chatLearning: false,
      autoSearch: enabled,
      allowedRoomIds: [],
      consentVersion: s.consent_version,
    });
    assert.equal(r.status, 200, JSON.stringify(r));
  };
  const beforeTrades = (
    await pool.query(
      "SELECT (SELECT count(*) FROM exchange_proposals)::int proposals,(SELECT count(*) FROM exchange_relays)::int relays",
    )
  ).rows[0];
  ok(
    (await runWishSearches()) === 0 &&
      (await notifications()).length === 0 &&
      (await goalRow(active.id)).last_searched_at === null &&
      (await goalRow(off.id)).last_searched_at === null,
    "automatic goal search stays off until the owner enables it",
  );
  await setSearch(owner, true);
  const runs = await Promise.all([runWishSearches(), runWishSearches()]);
  let notices = await notifications();
  const searched = await goalRow(active.id);
  ok(
    runs.reduce((a, b) => a + b, 0) === 1 &&
      searched.last_searched_at !== null &&
      searched.candidate_count > 0 &&
      searched.candidate_keys.some((k) => k.includes(target.id)),
    "concurrent goal workers claim one due goal and find an actual exchange candidate",
  );
  ok(
    notices.length === 1 &&
      notices[0].user_id === owner &&
      notices[0].role === "assistant" &&
      notices[0].metadata.wishId === active.id,
    "new goal candidates produce exactly one private Q message for their owner",
  );
  const afterTrades = (
    await pool.query(
      "SELECT (SELECT count(*) FROM exchange_proposals)::int proposals,(SELECT count(*) FROM exchange_relays)::int relays",
    )
  ).rows[0];
  ok(
    afterTrades.proposals === beforeTrades.proposals &&
      afterTrades.relays === beforeTrades.relays,
    "background suggestions never send an exchange proposal or create a relay automatically",
  );
  ok(
    (await goalRow(off.id)).last_searched_at === null &&
      (await goalRow(paused.id)).last_searched_at === null &&
      (await goalRow(deleted.id)).last_searched_at === null,
    "disabled, paused and deleted goals are excluded from background searches",
  );
  ok(
    (
      await pool.query(
        "SELECT count(*)::int n FROM agent_messages WHERE user_id=ANY($1::uuid[]) AND request_key LIKE 'wish-match:%'",
        [[targetOwner, disabledOwner]],
      )
    ).rows[0].n === 0,
    "goal candidate notifications are never delivered to counterparties or another user",
  );

  await pool.query(
    "UPDATE exchange_wishes SET next_search_at=now()-interval '1 second',last_notified_at=now()-interval '2 hours' WHERE id=$1",
    [active.id],
  );
  assert.equal(await runWishSearches(), 1);
  ok(
    (await notifications()).length === 1,
    "repeated discovery of the same goal route does not duplicate Q messages after the notification cooldown",
  );
  const baselineKeys = (await goalRow(active.id)).candidate_keys;
  const second = await add(
    targetOwner,
    "Weaver ZX-9300 헤드폰 두 번째 후보",
    "goods",
    ["voice"],
    { kind: "goods" },
  );
  await pool.query(
    "UPDATE exchange_wishes SET next_search_at=now()-interval '1 second',last_notified_at=now() WHERE id=$1",
    [active.id],
  );
  assert.equal(await runWishSearches(), 1);
  const cooling = await goalRow(active.id);
  ok(
    (await notifications()).length === 1 &&
      cooling.candidate_count > searched.candidate_count &&
      !cooling.candidate_keys.some((k) => k.includes(second.id)),
    "cooldown updates the live candidate count without consuming an unseen candidate notification",
  );
  await pool.query(
    "UPDATE exchange_wishes SET next_search_at=now()-interval '1 second',last_notified_at=now()-interval '2 hours' WHERE id=$1",
    [active.id],
  );
  assert.equal(await runWishSearches(), 1);
  ok(
    (await notifications()).length === 2 &&
      (await goalRow(active.id)).candidate_keys.some((k) =>
        k.includes(second.id),
      ),
    "a candidate discovered during cooldown receives one Q notification after the cooldown ends",
  );
  await pool.query(
    "UPDATE exchange_wishes SET next_search_at=now()-interval '1 second',last_notified_at=now()-interval '2 hours' WHERE id=$1",
    [active.id],
  );
  assert.equal(await runWishSearches(), 1);
  ok(
    (await notifications()).length === 2,
    "delayed goal notifications stay deduplicated on later searches",
  );
  await pool.query(
    "UPDATE exchange_wishes SET candidate_keys=$2,next_search_at=now()-interval '1 second',last_notified_at=now()-interval '2 hours' WHERE id=$1",
    [active.id, JSON.stringify(baselineKeys)],
  );
  assert.equal(await runWishSearches(), 1);
  ok(
    (await notifications()).length === 2 &&
      (await goalRow(active.id)).candidate_keys.some((k) =>
        k.includes(second.id),
      ),
    "an already-issued notification fingerprint still advances the candidate baseline without a duplicate message",
  );
  // Even a corrupted or stale message reference must not disclose another user's wish.
  await pool.query(
    "INSERT INTO agent_messages(user_id,role,content,request_key,metadata) VALUES($1,'assistant','격리된 잘못된 카드 참조',$2,$3)",
    [
      owner,
      "wish-forged:" + randomUUID(),
      JSON.stringify({ wishId: foreign.id }),
    ],
  );
  let conversation = await listAgentConversation(owner, 100);
  const cards = (messages) =>
    messages
      .flatMap((m) => m.metadata?.cards ?? [])
      .filter((c) => c.kind === "wish");
  ok(
    cards(conversation).some((c) => c.wish.id === active.id) &&
      cards(conversation).every((c) => c.wish.id === active.id),
    "Q wish cards resolve only the owner's currently active goal",
  );
  ok(
    !JSON.stringify(conversation).includes(foreign.title) &&
      !cards(await listAgentConversation(targetOwner, 100)).some(
        (c) => c.wish.id === active.id,
      ),
    "foreign wish references reveal neither private titles nor another owner's cards",
  );

  await setSearch(owner, false);
  await add(targetOwner, "Weaver ZX-9300 헤드폰 새 후보", "goods", ["voice"], {
    kind: "goods",
  });
  await pool.query(
    "UPDATE exchange_wishes SET next_search_at=now()-interval '1 second' WHERE id=$1",
    [active.id],
  );
  const searchTime = (await goalRow(active.id)).last_searched_at.toISOString();
  ok(
    (await runWishSearches()) === 0 &&
      (await goalRow(active.id)).last_searched_at.toISOString() ===
        searchTime &&
      (await notifications()).length === 2,
    "revoking automatic search stops later searches and notifications even when a new candidate exists",
  );
  assert.equal(
    (
      await request(owner, "/exchange/wishes/" + active.id, "PATCH", {
        version: active.version,
        status: "paused",
      })
    ).status,
    200,
  );
  await setSearch(owner, true);
  ok(
    (await runWishSearches()) === 0 &&
      cards(await listAgentConversation(owner, 100)).length === 0,
    "pausing the last active goal stops its worker and hides all of its old Q cards",
  );
}
