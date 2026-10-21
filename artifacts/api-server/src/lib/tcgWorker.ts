import { pool } from "@workspace/db";
import { matches } from "./tcgService";
import { resolveCard } from "./tcgCatalog";
import { sendPushToUser } from "./push";
import { readScan, submitScan } from "./tcgScans";
import { logger } from "./logger";
let running = false;
export async function runTcgWorker() {
  if (running) return;
  running = true;
  const c = await pool.connect();
  let locked = false;
  try {
    locked = (await c.query("SELECT pg_try_advisory_lock(7410040) AS locked"))
      .rows[0].locked;
    if (!locked) return;
    const users = (
      await c.query(
        "SELECT owner_id FROM tcg_wants WHERE active GROUP BY owner_id ORDER BY min(last_checked_at) ASC NULLS FIRST LIMIT 25",
      )
    ).rows;
    for (const { owner_id: user } of users) {
      for (const l of await matches(user))
        await c.query(
          "INSERT INTO tcg_notifications(owner_id,listing_id,dedupe_key,title,body) VALUES($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING",
          [
            user,
            l.id,
            "match:" + l.id + ":" + l.version,
            "찾던 카드의 거래 후보가 있어요",
            l.card_name,
          ],
        );
      await c.query(
        "UPDATE tcg_wants SET last_checked_at=now() WHERE owner_id=$1",
        [user],
      );
    }
    const alerts = (
      await c.query(
        "SELECT * FROM tcg_price_alerts WHERE active ORDER BY last_checked_at ASC NULLS FIRST LIMIT 25",
      )
    ).rows;
    for (const a of alerts) {
      try {
        const { target: p } = await resolveCard(a.card_id, a.card_name);
        if (
          p.value != null &&
          p.currency === a.currency &&
          p.observedAt &&
          ((a.direction === "below" && p.value <= Number(a.amount)) ||
            (a.direction === "above" && p.value >= Number(a.amount)))
        )
          await c.query(
            "INSERT INTO tcg_notifications(owner_id,kind,dedupe_key,title,body) VALUES($1,'price',$2,$3,$4) ON CONFLICT DO NOTHING",
            [
              a.owner_id,
              "price:" + a.id + ":" + p.observedAt,
              "카드 가격 조건에 도달했어요",
              p.name +
                " · " +
                p.value +
                " " +
                p.currency +
                " · " +
                p.observedAt,
            ],
          );
        await c.query(
          "UPDATE tcg_price_alerts SET last_observed=$2,last_checked_at=now() WHERE id=$1",
          [a.id, p.observedAt],
        );
      } catch (err) {
        logger.warn({ err, alertId: a.id }, "TCG price check unavailable");
        await c.query(
          "UPDATE tcg_price_alerts SET last_checked_at=now() WHERE id=$1",
          [a.id],
        );
      }
    }
    const requests = (
      await c.query(
        "SELECT * FROM tcg_card_requests WHERE status='pending' ORDER BY last_checked_at ASC NULLS FIRST LIMIT 5",
      )
    ).rows;
    for (const r of requests) {
      try {
        let scanId = r.scan_id;
        if (!scanId) {
          const scan = await submitScan(r.owner_id, {
            photo: r.photo,
            game: r.game,
            name: r.name,
            number: r.number,
            requestKey: "request:" + r.id,
          });
          scanId = scan.id;
          await c.query(
            "UPDATE tcg_card_requests SET scan_id=$2,upstream_request_id=$3 WHERE id=$1",
            [r.id, scanId, scan.upstream_id],
          );
        }
        const scan = await readScan(r.owner_id, scanId);
        if (scan.result?.targetId) {
          await resolveCard(scan.result.targetId, scan.result.name);
          await c.query(
            "UPDATE tcg_card_requests SET status='ready',resolved_card_id=$2 WHERE id=$1",
            [r.id, scan.result.targetId],
          );
          await c.query(
            "INSERT INTO tcg_notifications(owner_id,kind,dedupe_key,title,body) VALUES($1,'card_request',$2,$3,$4) ON CONFLICT DO NOTHING",
            [
              r.owner_id,
              "request:" + r.id,
              "요청한 카드 판본을 찾았어요",
              r.name + " · 등록 화면에서 확인해 주세요.",
            ],
          );
        }
      } catch (err) {
        logger.warn({ err, requestId: r.id }, "Shared card request pending");
      } finally {
        await c.query(
          "UPDATE tcg_card_requests SET last_checked_at=now() WHERE id=$1",
          [r.id],
        );
      }
    }
    const notifications = (
      await c.query(
        "SELECT * FROM tcg_notifications WHERE push_attempted_at IS NULL ORDER BY created_at LIMIT 50",
      )
    ).rows;
    for (const n of notifications) {
      if (
        n.listing_id &&
        !(await matches(n.owner_id)).some((l) => l.id === n.listing_id)
      ) {
        await c.query(
          "UPDATE tcg_notifications SET push_attempted_at=now() WHERE id=$1",
          [n.id],
        );
        continue;
      }
      // Claim before external delivery; ambiguous failures are never repeatedly pushed.
      await c.query(
        "UPDATE tcg_notifications SET push_attempted_at=now() WHERE id=$1",
        [n.id],
      );
      await sendPushToUser(n.owner_id, {
        title: n.title,
        body: n.body,
        url: n.trade_id
          ? "/tcg/trade/" + n.trade_id
          : n.listing_id
            ? "/tcg/listing/" + n.listing_id
            : "/tcg/notifications",
        tag: "tcg:" + n.id,
        type: "tcg",
      }).catch((err) =>
        logger.warn({ err }, "TCG push failed; inbox retained"),
      );
    }
  } catch (err) {
    logger.error({ err }, "TCG worker failed");
  } finally {
    if (locked) await c.query("SELECT pg_advisory_unlock(7410040)");
    c.release();
    running = false;
  }
}
export function startTcgWorker() {
  const timer = setInterval(() => void runTcgWorker(), 60000);
  timer.unref();
  return timer;
}
