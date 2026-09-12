import { pool } from "@workspace/db";
import { randomBytes } from "node:crypto";
import { transaction, demand, type Sql } from "./exchangeService";
import {
  brandEnabled,
  brandStartsEnabled,
  hash,
  inside,
  decryptCode,
  type eventInput,
} from "./brandRules";
import type { z } from "zod/v4";
import { logger } from "./logger";
const active = ["held", "playing", "paused"];
export async function brandPreferences(user: string, sql: Sql = pool) {
  await sql.query(
    "INSERT INTO brand_preferences(user_id) VALUES($1) ON CONFLICT DO NOTHING",
    [user],
  );
  return (
    await sql.query("SELECT * FROM brand_preferences WHERE user_id=$1", [user])
  ).rows[0];
}
export function campaignDto(r: any) {
  const { videoA, videoB, rightsConfirmed, fundingConfirmed, cost, ...config } =
    r.config;
  return {
    id: r.id,
    versionId: r.current_version_id,
    status: r.status,
    ...config,
    differences: r.differences,
    available: Number(r.available ?? 0),
    participationId: r.participation_id ?? null,
    participationStatus: r.participation_status ?? null,
  };
}
export async function listBrandExchanges(user: string, recommended = false) {
  if (
    !brandEnabled() ||
    (recommended && process.env.BRAND_EXCHANGE_Q_ENABLED !== "true")
  )
    return { items: [], enabled: false };
  const prefs = await brandPreferences(user);
  const rows = (
    await pool.query(
      `SELECT c.*,v.config,jsonb_array_length(v.answers) differences,
 (SELECT count(*) FROM brand_units u WHERE u.campaign_id=c.id AND u.state='available' AND u.valid_until>now()+interval '7 days') available,
 p.id participation_id,p.status participation_status
 FROM brand_campaigns c JOIN brand_versions v ON v.id=c.current_version_id
 LEFT JOIN brand_participations p ON p.campaign_id=c.id AND p.user_id=$1
 WHERE c.status='published' AND (v.config->>'endsAt')::timestamptz>now() ORDER BY c.created_at DESC LIMIT 100`,
      [user],
    )
  ).rows;
  let items = rows
    .filter(
      (r) =>
        r.available > 0 &&
        r.held + r.spent + Number(r.config.cost) <= r.budget &&
        !r.participation_id,
    )
    .map(campaignDto);
  if (recommended) {
    items = items.filter(
      (r) =>
        (!prefs.categories.length || prefs.categories.includes(r.category)) &&
        (r.online || !prefs.region || r.region.includes(prefs.region)),
    );
    let memoryCategories: string[] = [];
    if (prefs.personalized) {
      const memoryRows = (
        await pool.query(
          "SELECT m.label FROM agent_memories m JOIN brand_preferences s ON s.user_id=m.user_id WHERE m.user_id=$1 AND m.status='confirmed' AND (m.expires_at IS NULL OR m.expires_at>now()) AND s.personalized AND s.version=$2 ORDER BY m.updated_at DESC LIMIT 20",
          [user, prefs.version],
        )
      ).rows;
      const text = memoryRows
        .map((m) => m.label)
        .filter(
          (t) =>
            !/(싫|안 좋아|원하지|건강|병원|질환|정치|종교|대출|수입)/.test(t),
        )
        .join(" ");
      memoryCategories = Object.entries({
        food: /커피|카페|디저트|음식/,
        culture: /공연|전시|영화|음악|취미/,
        learning: /배우|레슨|수업|영어|경험/,
        life: /생활|집 꾸미|문구/,
      })
        .filter(([, pattern]) => pattern.test(text))
        .map(([category]) => category);
      // Fence a concurrent opt-out before returning a memory-derived rank or explanation.
      const current = (
        await pool.query(
          "SELECT 1 FROM brand_preferences WHERE user_id=$1 AND personalized AND version=$2",
          [user, prefs.version],
        )
      ).rows[0];
      if (!current) memoryCategories = [];
      items.sort(
        (a, b) =>
          Number(memoryCategories.includes(b.category)) -
          Number(memoryCategories.includes(a.category)),
      );
    }
    items = items.map((r) => ({
      ...r,
      reason: memoryCategories.includes(r.category)
        ? "활용에 동의한 큐의 기억에 관심 분야가 있어요."
        : prefs.categories.includes(r.category)
          ? "직접 선택한 관심 혜택이에요."
          : r.online
            ? "온라인으로 사용할 수 있는 혜택이에요."
            : "지금 참여할 수 있는 브랜드 교환이에요.",
    }));
  }
  return { items: items.slice(0, recommended ? 3 : 100), enabled: true };
}
export async function getCampaign(id: string, user: string) {
  const r = (
    await pool.query(
      `SELECT c.*,v.config,jsonb_array_length(v.answers) differences,
 (SELECT count(*) FROM brand_units u WHERE u.campaign_id=c.id AND u.state='available' AND u.valid_until>now()+interval '7 days') available,
 p.id participation_id,p.status participation_status
 FROM brand_campaigns c JOIN brand_versions v ON v.id=c.current_version_id LEFT JOIN brand_participations p ON p.campaign_id=c.id AND p.user_id=$2
 WHERE c.id=$1 AND (c.status IN('published','paused','ended') OR p.id IS NOT NULL)`,
      [id, user],
    )
  ).rows[0];
  demand(r, 404, "브랜드 교환을 찾을 수 없어요.");
  return {
    ...campaignDto(r),
    canStart:
      brandStartsEnabled() &&
      r.status === "published" &&
      new Date(r.config.endsAt).getTime() > Date.now() &&
      r.available > 0 &&
      r.held + r.spent + r.config.cost <= r.budget &&
      !r.participation_id,
  };
}
export function participationDto(p: any) {
  return {
    id: p.id,
    campaignId: p.campaign_id,
    status: p.status,
    attempt: p.attempt,
    sequence: p.sequence,
    progress: p.progress,
    found: p.found.length,
    clicks: p.clicks,
    expiresAt: p.expires_at,
    claimId: p.claim_id ?? null,
    ...(p.config
      ? {
          title: p.config.title,
          rewardTitle: p.config.rewardTitle,
          videoA: p.config.videoA,
          videoB: p.config.videoB,
          duration: p.config.duration,
          differences: p.answers.length,
        }
      : {}),
  };
}
export async function getParticipation(
  id: string,
  user: string,
  sql: Sql = pool,
) {
  const p = (
    await sql.query(
      "SELECT p.*,v.config,v.answers,c.id claim_id FROM brand_participations p JOIN brand_versions v ON v.id=p.version_id LEFT JOIN brand_claims c ON c.participation_id=p.id WHERE p.id=$1 AND p.user_id=$2",
      [id, user],
    )
  ).rows[0];
  demand(p, 404, "내 참여 기록을 찾을 수 없어요.");
  return p;
}
async function release(sql: Sql, p: any, status: string) {
  if (!active.includes(p.status)) return;
  await sql.query(
    "UPDATE brand_participations SET status=$2,lease_hash=NULL WHERE id=$1",
    [p.id, status],
  );
  await sql.query(
    "UPDATE brand_units SET state='available' WHERE id=$1 AND state='held'",
    [p.unit_id],
  );
  await sql.query("UPDATE brand_campaigns SET held=held-$2 WHERE id=$1", [
    p.campaign_id,
    p.cost,
  ]);
  await sql.query(
    "INSERT INTO brand_budget_ledger(campaign_id,participation_id,kind,amount) VALUES($1,$2,'release',$3) ON CONFLICT DO NOTHING",
    [p.campaign_id, p.id, -p.cost],
  );
  p.status = status;
}
export async function startBrand(id: string, user: string, key: string) {
  demand(brandStartsEnabled(), 409, "새로운 참여를 잠시 준비 중이에요.");
  return transaction(async (sql) => {
    await sql.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
      "brand-user:" + user,
    ]);
    const old = (
      await sql.query(
        "SELECT * FROM brand_participations WHERE user_id=$1 AND (campaign_id=$2 OR request_key=$3)",
        [user, id, key],
      )
    ).rows[0];
    if (old) {
      demand(
        old.campaign_id === id,
        409,
        "이미 다른 참여에 사용된 요청이에요.",
      );
      return participationDto(await getParticipation(old.id, user, sql));
    }
    const c = (
      await sql.query(
        "SELECT c.*,v.config FROM brand_campaigns c JOIN brand_versions v ON v.id=c.current_version_id WHERE c.id=$1 FOR UPDATE OF c",
        [id],
      )
    ).rows[0];
    demand(
      c &&
        c.status === "published" &&
        new Date(c.config.endsAt).getTime() > Date.now(),
      409,
      "지금 참여할 수 없는 교환이에요.",
    );
    demand(
      c.held + c.spent + c.config.cost <= c.budget,
      409,
      "준비한 참여 예산이 모두 소진됐어요.",
    );
    const daily = (
      await sql.query(
        "SELECT count(*)::int n FROM brand_participations WHERE user_id=$1 AND created_at>now()-interval '24 hours'",
        [user],
      )
    ).rows[0].n;
    demand(
      daily < 5,
      429,
      "브랜드 교환은 24시간 동안 최대 5회 참여할 수 있어요.",
    );
    const u = (
      await sql.query(
        "SELECT * FROM brand_units WHERE campaign_id=$1 AND state='available' AND valid_until>now()+interval '7 days' ORDER BY valid_until,id LIMIT 1 FOR UPDATE SKIP LOCKED",
        [id],
      )
    ).rows[0];
    demand(u, 409, "준비한 혜택이 모두 소진됐어요.");
    const p = (
      await sql.query(
        "INSERT INTO brand_participations(user_id,campaign_id,version_id,unit_id,request_key,cost) VALUES($1,$2,$3,$4,$5,$6) RETURNING *",
        [user, id, c.current_version_id, u.id, key, c.config.cost],
      )
    ).rows[0];
    await sql.query("UPDATE brand_units SET state='held' WHERE id=$1", [u.id]);
    await sql.query("UPDATE brand_campaigns SET held=held+$2 WHERE id=$1", [
      id,
      c.config.cost,
    ]);
    await sql.query(
      "INSERT INTO brand_budget_ledger(campaign_id,participation_id,kind,amount) VALUES($1,$2,'hold',$3)",
      [id, p.id, c.config.cost],
    );
    return participationDto(await getParticipation(p.id, user, sql));
  });
}
export async function leaseBrand(id: string, user: string) {
  return transaction(async (sql) => {
    const p = (
      await sql.query(
        "SELECT * FROM brand_participations WHERE id=$1 AND user_id=$2 FOR UPDATE",
        [id, user],
      )
    ).rows[0];
    demand(p, 404, "참여 기록을 찾을 수 없어요.");
    if (new Date(p.expires_at).getTime() <= Date.now()) {
      await release(sql, p, "expired");
      return {
        participation: participationDto(await getParticipation(id, user, sql)),
        lease: null,
      };
    }
    demand(active.includes(p.status), 409, "종료된 참여예요.");
    demand(
      !p.lease_until || new Date(p.lease_until).getTime() <= Date.now(),
      409,
      "다른 화면에서 참여 중이에요. 해당 화면을 닫고 15초 후 다시 시도해 주세요.",
    );
    const lease = randomBytes(32).toString("hex");
    await sql.query(
      "UPDATE brand_participations SET lease_hash=$2,lease_until=now()+interval '15 seconds',status='paused',last_tick=NULL WHERE id=$1",
      [id, hash(lease)],
    );
    return {
      participation: participationDto(await getParticipation(id, user, sql)),
      lease,
    };
  });
}
export async function brandEvent(
  id: string,
  user: string,
  e: z.infer<typeof eventInput>,
) {
  return transaction(async (sql) => {
    const p = (
      await sql.query(
        "SELECT p.*,v.config,v.answers FROM brand_participations p JOIN brand_versions v ON v.id=p.version_id WHERE p.id=$1 AND p.user_id=$2 FOR UPDATE OF p",
        [id, user],
      )
    ).rows[0];
    demand(p, 404, "참여 기록을 찾을 수 없어요.");
    const previous = (
      await sql.query(
        "SELECT response FROM brand_events WHERE participation_id=$1 AND request_key=$2",
        [id, e.requestKey],
      )
    ).rows[0];
    if (previous) return previous.response;
    demand(active.includes(p.status), 409, "종료된 참여예요.");
    if (new Date(p.expires_at).getTime() <= Date.now()) {
      await release(sql, p, "expired");
      return participationDto(p);
    }
    demand(
      p.lease_hash === hash(e.lease) &&
        new Date(p.lease_until).getTime() > Date.now(),
      409,
      "참여 연결이 만료됐어요. 다시 연결해 주세요.",
    );
    demand(
      e.sequence === p.sequence + 1,
      409,
      "참여 순서가 달라요. 다시 연결해 주세요.",
    );
    const elapsed = p.last_tick
      ? (Date.now() - new Date(p.last_tick).getTime()) / 1000
      : 0;
    const advance = e.position - p.progress;
    const earned =
      p.credit +
      (p.status === "playing" ? Math.max(0, Math.min(elapsed, 3.5)) : 0);
    const synchronized = Math.abs(e.position - e.positionB) <= 0.35;
    const valid =
      p.status === "playing" &&
      synchronized &&
      advance >= -0.15 &&
      advance <= Math.min(elapsed + 0.18, 3.5) &&
      e.position <= earned + 0.18;
    if (["tick", "answer", "finish", "pause"].includes(e.action)) {
      demand(
        valid ||
          (["pause", "finish"].includes(e.action) &&
            Math.abs(advance) < 0.15 &&
            synchronized),
        409,
        "영상 재생을 확인하지 못했어요. 다시 연결해 주세요.",
      );
      p.progress = Math.max(p.progress, e.position);
      p.credit = earned;
    }
    let notice = "";
    if (e.action === "play") {
      demand(
        Math.abs(advance) < 0.2 && synchronized,
        409,
        "확인된 재생 위치부터 시작해 주세요.",
      );
      p.status = "playing";
    }
    if (e.action === "pause" || e.action === "keepalive") p.status = "paused";
    if (e.action === "answer") {
      demand(
        e.x !== undefined && e.y !== undefined && p.clicks < 8,
        409,
        "이번 시도의 선택 횟수를 모두 사용했어요.",
      );
      p.clicks++;
      const found = p.answers.findIndex(
        (a: any, i: number) =>
          !p.found.includes(i) && inside(a, e.position, e.x!, e.y!),
      );
      if (found >= 0) {
        p.found.push(found);
        notice = "찾았어요!";
      } else notice = "조금 더 살펴보세요.";
    }
    if (e.action === "retry") {
      demand(
        p.attempt < 2 && p.progress >= 29.8,
        409,
        "두 영상을 끝까지 본 후 한 번 더 도전할 수 있어요.",
      );
      p.attempt++;
      p.progress = 0;
      p.credit = 0;
      p.found = [];
      p.clicks = 0;
      p.status = "paused";
    }
    if (e.action === "finish") {
      demand(p.progress >= 29.8, 409, "두 영상을 끝까지 확인해 주세요.");
      if (p.found.length === p.answers.length) {
        p.status = "succeeded";
        const claim = (
          await sql.query(
            "INSERT INTO brand_claims(participation_id,user_id,unit_id) VALUES($1,$2,$3) RETURNING id",
            [id, user, p.unit_id],
          )
        ).rows[0];
        p.claim_id = claim.id;
        await sql.query("INSERT INTO brand_outbox(claim_id) VALUES($1)", [
          claim.id,
        ]);
      } else if (p.attempt === 2) await release(sql, p, "failed");
      else {
        p.status = "paused";
        notice = "한 번 더 도전할 수 있어요. 추가로 약 30초가 필요해요.";
      }
    }
    if (e.action === "abandon") await release(sql, p, "abandoned");
    p.sequence = e.sequence;
    await sql.query(
      "UPDATE brand_participations SET status=$2,attempt=$3,progress=$4,found=$5,clicks=$6,sequence=$7,last_tick=now(),lease_until=now()+interval '15 seconds',credit=$8 WHERE id=$1",
      [
        id,
        p.status,
        p.attempt,
        p.progress,
        JSON.stringify(p.found),
        p.clicks,
        p.sequence,
        p.credit,
      ],
    );
    const response = { ...participationDto(p), notice };
    await sql.query(
      "INSERT INTO brand_events(participation_id,request_key,response,action) VALUES($1,$2,$3,$4)",
      [id, e.requestKey, JSON.stringify(response), e.action],
    );
    return response;
  });
}
export async function settleBrandRewards() {
  // Locks participation before campaign everywhere, including expiry, avoiding reversed lock order.
  const ids = (
    await pool.query(
      "SELECT p.id FROM brand_participations p WHERE (p.status IN('held','playing','paused') AND p.expires_at<now()) OR (p.status='succeeded' AND EXISTS(SELECT 1 FROM brand_claims c JOIN brand_outbox o ON o.claim_id=c.id WHERE c.participation_id=p.id AND o.done_at IS NULL)) ORDER BY p.created_at LIMIT 50",
    )
  ).rows;
  for (const { id } of ids)
    await transaction(async (sql) => {
      const p = (
        await sql.query(
          "SELECT * FROM brand_participations WHERE id=$1 FOR UPDATE",
          [id],
        )
      ).rows[0];
      if (
        active.includes(p.status) &&
        new Date(p.expires_at).getTime() <= Date.now()
      ) {
        await release(sql, p, "expired");
        return;
      }
      if (p.status !== "succeeded") return;
      const c = (
        await sql.query(
          "SELECT c.*,o.done_at FROM brand_claims c JOIN brand_outbox o ON o.claim_id=c.id WHERE c.participation_id=$1 FOR UPDATE OF c,o",
          [id],
        )
      ).rows[0];
      if (!c || c.done_at) return;
      const u = (
        await sql.query("SELECT * FROM brand_units WHERE id=$1 FOR UPDATE", [
          p.unit_id,
        ])
      ).rows[0];
      try {
        demand(
          u.state === "held" && new Date(u.valid_until).getTime() > Date.now(),
          409,
          "reward unavailable",
        );
        decryptCode(u.encrypted_code);
      } catch {
        await sql.query(
          "UPDATE brand_claims SET status='needs_reconciliation' WHERE id=$1",
          [c.id],
        );
        await sql.query(
          "UPDATE brand_outbox SET attempts=attempts+1,done_at=now() WHERE claim_id=$1",
          [c.id],
        );
        return;
      }
      await sql.query("UPDATE brand_units SET state='issued' WHERE id=$1", [
        u.id,
      ]);
      await sql.query(
        "UPDATE brand_claims SET status='issued',issued_at=now() WHERE id=$1",
        [c.id],
      );
      await sql.query(
        "UPDATE brand_campaigns SET held=held-$2,spent=spent+$2 WHERE id=$1",
        [p.campaign_id, p.cost],
      );
      await sql.query(
        "INSERT INTO brand_budget_ledger(campaign_id,participation_id,kind,amount) VALUES($1,$2,'spend',$3) ON CONFLICT DO NOTHING",
        [p.campaign_id, p.id, p.cost],
      );
      await sql.query(
        "UPDATE brand_outbox SET attempts=attempts+1,done_at=now() WHERE claim_id=$1",
        [c.id],
      );
    });
}
export async function rewardList(user: string, id?: string) {
  const rows = (
    await pool.query(
      `SELECT c.*,u.valid_until,v.config FROM brand_claims c JOIN brand_units u ON u.id=c.unit_id JOIN brand_participations p ON p.id=c.participation_id JOIN brand_versions v ON v.id=p.version_id WHERE c.user_id=$1 ${id ? "AND c.id=$2" : ""} ORDER BY c.created_at DESC LIMIT 100`,
      id ? [user, id] : [user],
    )
  ).rows;
  return rows.map((r) => ({
    id: r.id,
    status: r.status,
    participationId: r.participation_id,
    title: r.config.rewardTitle,
    brand: r.config.brand,
    terms: r.config.terms,
    extraCost: r.config.extraCost,
    support: r.config.support,
    validUntil: r.valid_until,
    issuedAt: r.issued_at,
    selfUsedAt: r.self_used_at,
    issue: r.issue,
    resolution: r.resolution,
  }));
}
export function startBrandWorker() {
  const timer = setInterval(() => {
    void settleBrandRewards().catch(() =>
      logger.warn("Brand reward worker retry pending"),
    );
  }, 15000);
  timer.unref();
}
