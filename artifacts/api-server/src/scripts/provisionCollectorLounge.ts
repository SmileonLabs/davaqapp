import { resolveCard } from "../lib/tcgCatalog";
import { COLLECTORS } from "../lib/collectorLounge/policy";
import { pool } from "@workspace/db";
import { provisionCollectorLounge } from "../routes/collectorLounge";
import {
  closeKnowledgeGraphDriver,
  verifyKnowledgeGraphConnection,
} from "../lib/knowledgeGraph/client";
try {
  const admin = (
    await pool.query(
      `SELECT u.id FROM users u JOIN admin_roles a ON a.user_id=u.id WHERE a.role='super_admin' ORDER BY u.created_at LIMIT 1`,
    )
  ).rows[0];
  // A system-managed room can be owned by its official bot without granting any human admin access.
  const ownerId = admin?.id ?? COLLECTORS[0].id;
  if (!(await verifyKnowledgeGraphConnection()))
    throw new Error("Knowledge graph must be available before provisioning");
  await provisionCollectorLounge(ownerId);
  try {
    const detail = await resolveCard("kream:649512");
    await pool.query(
      "UPDATE collector_lounges SET topic=$2,topic_card_id=$3 WHERE room_id=$1 AND topic_card_id IS NULL AND last_ai_at IS NULL",
      [
        "00000000-0000-4000-8000-00000000c100",
        detail.target.name + " — 그림과 판본, 수집 취향을 이야기해요.",
        "kream:649512",
      ],
    );
  } catch {
    /* Keep the general collecting topic if the upstream card is unavailable. */
  }
  console.log(
    "Collector lounge provisioned, paused, with official AI profiles and graph persona knowledge.",
  );
} finally {
  await closeKnowledgeGraphDriver();
  await pool.end();
}
