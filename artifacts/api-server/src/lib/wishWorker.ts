import { randomUUID, createHash } from "node:crypto";
import { pool } from "@workspace/db";
import { transaction } from "./exchangeService";
import { findWishCandidates } from "./wishMatching";
import { wishGoal, wishCandidateKeys } from "./wishService";
import { logger } from "./logger";
export async function runWishSearches() {
  const jobs = await transaction(async (sql) => {
    const rows = (
      await sql.query(
        `SELECT w.*,s.consent_version FROM exchange_wishes w JOIN agent_settings s ON s.user_id=w.user_id WHERE w.status='active' AND s.auto_search AND w.next_search_at<=now() ORDER BY w.next_search_at,w.id LIMIT 2 FOR UPDATE OF w SKIP LOCKED`,
      )
    ).rows;
    for (const row of rows) {
      row.search_lease = randomUUID();
      await sql.query(
        "UPDATE exchange_wishes SET search_lease=$2,next_search_at=now()+interval '15 minutes' WHERE id=$1",
        [row.id, row.search_lease],
      );
    }
    return rows;
  });
  for (const row of jobs) {
    try {
      const result = await findWishCandidates(row.user_id, wishGoal(row)),
        keys = wishCandidateKeys(result);
      await transaction(async (sql) => {
        const current = (
          await sql.query(
            "SELECT w.*,s.auto_search,s.consent_version FROM exchange_wishes w JOIN agent_settings s ON s.user_id=w.user_id WHERE w.id=$1 FOR UPDATE OF w",
            [row.id],
          )
        ).rows[0];
        if (
          !current ||
          current.status !== "active" ||
          current.version !== row.version ||
          current.search_lease !== row.search_lease ||
          !current.auto_search ||
          current.consent_version !== row.consent_version
        )
          return;
        const added = keys.some((k) => !current.candidate_keys.includes(k));
        const canNotify =
          !current.last_notified_at ||
          new Date(current.last_notified_at).getTime() < Date.now() - 3600000;
        let notified = false;
        if (added && canNotify) {
          const fingerprint = createHash("sha256")
            .update(keys.join("|"))
            .digest("hex")
            .slice(0, 24);
          const inserted = await sql.query(
            "INSERT INTO agent_messages(user_id,role,content,request_key,metadata) VALUES($1,'assistant',$2,$3,$4) ON CONFLICT(user_id,role,request_key) DO NOTHING RETURNING id",
            [
              row.user_id,
              "소원으로 이어지는 새 교환 후보를 찾았어요. 내가 줄 것과 받을 것, 아직 확인할 조건을 소원함에서 살펴보세요. 상대방에게 제안은 보내지 않았어요.",
              "wish-match:" + row.id + ":" + fingerprint,
              JSON.stringify({ wishId: row.id }),
            ],
          );
          notified = !!inserted.rows[0];
        }
        await sql.query(
          "UPDATE exchange_wishes SET last_searched_at=now(),candidate_count=$2,candidate_keys=$3,search_lease=NULL,last_notified_at=CASE WHEN $4 THEN now() ELSE last_notified_at END WHERE id=$1",
          // Preserve unseen candidates during the cooldown. Once notification is allowed,
          // advance the baseline even if the same fingerprint was already inserted.
          [
            row.id,
            keys.length,
            JSON.stringify(added && !canNotify ? current.candidate_keys : keys),
            notified,
          ],
        );
      });
    } catch (e) {
      await pool.query(
        "UPDATE exchange_wishes SET search_lease=NULL,next_search_at=now()+interval '5 minutes' WHERE id=$1 AND search_lease=$2",
        [row.id, row.search_lease],
      );
      logger.warn(
        { error: e instanceof Error ? e.name : "Error" },
        "DavaQ wish search unavailable",
      );
    }
  }
  return jobs.length;
}
