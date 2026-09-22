import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
export async function testMap({ pool, request, ok, listing }) {
  const users = [];
  for (let i = 0; i < 4; i++) {
    const id = randomUUID();
    users.push(id);
    await pool.query(
      "INSERT INTO users(id,clerk_id,email,nickname) VALUES($1,$2,$3,$4)",
      [id, "map_it_" + id, id + "@example.invalid", "지도 검증 " + i],
    );
  }
  const [a, b, c, x] = users;
  const point = {
    lat: 37.561234,
    lng: 126.981234,
    label: "서울 중구",
    precision: "area",
  };
  const add = async (user, title, extra = {}) => {
    const r = await request(user, "/exchange/listings", "POST", {
      ...listing(title, "voice", ["photo"]),
      kind: "goods",
      delivery: "offline",
      location: "서울 중구",
      geo: point,
      ...extra,
    });
    assert.equal(r.status, 201, JSON.stringify(r));
    return r.data;
  };
  let la = await add(a, "지도 카메라");
  const lb = await add(b, "지도 사진", {
    category: "photo",
    wantedCategories: ["voice"],
    geo: {
      ...point,
      precision: "place",
      lat: 37.57,
      lng: 126.99,
      label: "공개 만남 장소",
    },
  });
  const hidden = await add(c, "비공개 카메라", { status: "draft" }),
    paused = await add(c, "숨긴 카메라", { status: "paused" }),
    online = await add(c, "온라인 카메라", { delivery: "online" }),
    far = await add(c, "부산 카메라", {
      geo: { ...point, lat: 35.18, lng: 129.08, label: "부산" },
    }),
    want = await add(c, "카메라 원해요", { mode: "want" });
  const search = (u = a, extra = {}) =>
    request(u, "/exchange/map/search", "POST", {
      lat: 37.56,
      lng: 126.98,
      radiusKm: 5,
      ...extra,
    });
  ok(
    (await search(null)).status === 401 &&
      (await request(null, "/exchange/map/config")).status === 401,
    "map searches and configuration require authentication",
  );
  ok(
    la.geo.lat === 37.56 && la.geo.lng === 126.98,
    "public neighborhood coordinates are coarsened before returning",
  );
  const stored = (
    await pool.query(
      "SELECT map_lat,map_lng FROM exchange_listings WHERE id=$1",
      [la.id],
    )
  ).rows[0];
  ok(
    stored.map_lat === 37.56 && stored.map_lng === 126.98,
    "raw neighborhood coordinates are never stored",
  );
  ok(online.geo === null, "online exchanges do not expose map coordinates");
  let found = await search();
  assert.equal(found.status, 200, JSON.stringify(found));
  ok(
    found.data.items.some((l) => l.id === la.id) &&
      found.data.items.some((l) => l.id === lb.id),
    "nearby published exchanges appear on the map",
  );
  ok(
    !found.data.items.some((l) =>
      [hidden.id, paused.id, online.id, far.id, want.id].includes(l.id),
    ),
    "map excludes drafts, hidden, online, distant and wrong-mode listings",
  );
  ok(
    found.data.items.every(
      (l, i, ls) => i === 0 || l.distanceKm >= ls[i - 1].distanceKm,
    ),
    "nearby results are ordered by distance",
  );
  ok(
    (await search(a, { q: "지도 카메라" })).data.items.length === 1,
    "map keyword search filters published items",
  );
  ok(
    !(await search(a, { q: "%" })).data.items.length,
    "wildcard characters in map search are literal",
  );
  ok(
    (await search(a, { category: "photo" })).data.items.every(
      (l) => l.category === "photo",
    ),
    "map category filter is respected",
  );
  ok(
    (await search(a, { mode: "want" })).data.items.some(
      (l) => l.id === want.id,
    ),
    "users can find nearby wanted listings",
  );
  await pool.query(
    "INSERT INTO blocked_users(blocker_user_id,blocked_user_id) VALUES($1,$2)",
    [b, a],
  );
  ok(
    !(await search()).data.items.some((l) => l.id === lb.id),
    "reverse blocks remove map markers and their data",
  );
  await pool.query(
    "DELETE FROM blocked_users WHERE blocker_user_id=$1 AND blocked_user_id=$2",
    [b, a],
  );
  ok(
    (await search(a, { lat: 91 })).status === 400 &&
      (await search(a, { radiusKm: 100 })).status === 400,
    "invalid map coordinates and unbounded radius are rejected",
  );
  ok(
    (
      await request(a, "/exchange/listings", "POST", {
        ...listing("잘못된 위치", "voice", ["photo"]),
        geo: { ...point, lat: Infinity },
      })
    ).status === 400,
    "invalid listing coordinates are rejected",
  );
  const updateBody = {
    ...listing("지도 카메라 수정", "voice", ["photo"]),
    kind: "goods",
    delivery: "offline",
    location: "서울 중구",
    version: 1,
  };
  delete updateBody.requestKey;
  const legacy = await request(
    a,
    "/exchange/listings/" + la.id,
    "PATCH",
    updateBody,
  );
  assert.equal(legacy.status, 200, JSON.stringify(legacy));
  ok(
    legacy.data.geo.lat === 37.56,
    "legacy listing updates preserve an existing map point",
  );
  la = legacy.data;
  const time = new Date(Date.now() + 10 * 86400000).toISOString(),
    terms = {
      offerStartsAt: time,
      requestedStartsAt: new Date(
        Date.now() + 10 * 86400000 + 3600000,
      ).toISOString(),
      location: "공개 출입구",
      meetingPoint: {
        lat: 37.5623456,
        lng: 126.9812345,
        label: "서로 정한 출입구",
      },
      note: "약속 장소 확인",
      cancellation: "상호 합의 후 취소합니다.",
    };
  const proposal = await request(a, "/exchange/proposals", "POST", {
    offerId: la.id,
    requestedId: lb.id,
    terms,
    requestKey: randomUUID(),
  });
  assert.equal(proposal.status, 201, JSON.stringify(proposal));
  ok(
    proposal.data.terms.meetingPoint.lat === 37.56235,
    "private meeting points persist in proposal terms at bounded precision",
  );
  ok(
    (await request(x, "/exchange/proposals/" + proposal.data.id)).status ===
      404,
    "nonparticipants cannot read a private meeting point",
  );
  const action = (u, action, extra = {}) =>
    request(u, "/exchange/proposals/" + proposal.data.id + "/actions", "POST", {
      action,
      version: 1,
      requestKey: randomUUID(),
      ...extra,
    });
  await action(a, "accept");
  const revise = await action(b, "revise", {
    terms: {
      ...terms,
      meetingPoint: { ...terms.meetingPoint, label: "다른 출입구" },
    },
  });
  assert.equal(revise.status, 200, JSON.stringify(revise));
  ok(
    revise.data.version === 2 && !revise.data.acceptances.length,
    "changing a meeting point requires renewed consent",
  );
  for (const u of [a, b])
    assert.equal(
      (
        await request(
          u,
          "/exchange/proposals/" + proposal.data.id + "/actions",
          "POST",
          { action: "accept", version: 2, requestKey: randomUUID() },
        )
      ).status,
      200,
    );
  ok(
    !(await search()).data.items.some((l) => [la.id, lb.id].includes(l.id)),
    "reserved goods disappear from map discovery",
  );
  const clear = await request(c, "/exchange/listings/" + far.id, "PATCH", {
    ...listing("부산 카메라", "voice", ["photo"]),
    kind: "goods",
    delivery: "offline",
    location: "부산",
    version: 1,
    geo: null,
  });
  assert.equal(clear.status, 200);
  ok(clear.data.geo === null, "owners can remove published map coordinates");
  const switchOnline = await request(
    c,
    "/exchange/listings/" + want.id,
    "PATCH",
    {
      ...listing("온라인으로 받고 싶어요", "voice", ["photo"]),
      mode: "want",
      version: 1,
      delivery: "online",
    },
  );
  assert.equal(switchOnline.status, 200);
  ok(
    switchOnline.data.geo === null,
    "switching to online removes old coordinates",
  );
  await pool.query(
    "INSERT INTO exchange_listings(owner_id,mode,kind,category,title,status,delivery,location,map_lat,map_lng,map_precision,map_label) SELECT $1,'offer','service','voice','지도 범위 검사 '||i,'published','offline','서울',37.56,126.98,'area','서울 중구' FROM generate_series(1,81) i",
    [c],
  );
  found = await search();
  ok(
    found.data.items.length === 80 && found.data.limited,
    "map responses cap dense areas and disclose truncation",
  );
  const config = await request(a, "/exchange/map/config");
  ok(
    config.data.tileUrl === "https://tile.openstreetmap.org/{z}/{x}/{y}.png" &&
      config.data.attribution.includes("OpenStreetMap"),
    "map provider and attribution are configured without secret keys",
  );
}
