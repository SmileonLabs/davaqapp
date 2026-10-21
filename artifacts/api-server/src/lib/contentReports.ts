import { pool } from "@workspace/db";
import { blocked, transaction, visibleListing, type Sql } from "./tcgService";
import { TcgError, demand } from "./tcgCatalog";

export type ContentReportTarget = "user" | "card_comment" | "listing_comment" | "message";
export type ContentReportStatus = "pending" | "resolved" | "dismissed";
export const REMOVED_COMMENT = "운영 정책에 따라 삭제된 댓글입니다.";
const unavailable = () => demand(false, 404, "신고할 수 있는 대상을 찾지 못했습니다.");

/** Authorize the original target, never a caller-supplied author or room ID. */
async function targetOwner(sql: Sql, viewer: string, type: ContentReportTarget, id: string): Promise<string> {
  let owner: string | undefined;
  if (type === "user") {
    owner = (await sql.query("SELECT id FROM users WHERE id=$1", [id])).rows[0]?.id;
  } else if (type === "card_comment") {
    owner = (await sql.query("SELECT owner_id FROM tcg_card_comments WHERE id=$1 AND body<>$2", [id, REMOVED_COMMENT])).rows[0]?.owner_id;
  } else if (type === "listing_comment") {
    const comment = (await sql.query("SELECT owner_id,listing_id FROM tcg_listing_comments WHERE id=$1 AND body<>$2", [id, REMOVED_COMMENT])).rows[0];
    if (!comment) unavailable();
    // Exactly the public/owner/trade-party visibility policy used by the
    // existing listing and comment read routes, including blocked sellers.
    try { await visibleListing(sql, comment.listing_id, viewer); }
    catch (error) { if (error instanceof TcgError && error.status === 404) unavailable(); else throw error; }
    owner = comment.owner_id;
  } else {
    const message = (await sql.query(
      `SELECT m.sender_id FROM messages m
       WHERE m.id=$1 AND m.deleted_at IS NULL AND m.author_kind='user'
       AND EXISTS(SELECT 1 FROM chat_room_members member WHERE member.room_id=m.room_id AND member.user_id=$2)
       AND NOT EXISTS(SELECT 1 FROM message_deletions d WHERE d.message_id=m.id AND d.user_id=$2)`,
      [id, viewer],
    )).rows[0];
    owner = message?.sender_id;
  }
  if (!owner) unavailable();
  demand(owner !== viewer, 400, "내 계정이나 내가 작성한 내용은 신고할 수 없습니다.");
  if (await blocked(sql, viewer, owner!)) unavailable();
  return owner!;
}

export async function createContentReport(user: string, input: { targetType: ContentReportTarget; targetId: string; reason: string }) {
  return transaction(async (sql) => {
    // A database lock also enforces the bound across workers/replicas when
    // Redis is unavailable. This does not lock or modify the reported account.
    const reporter = (await sql.query("SELECT id FROM users WHERE id=$1 FOR UPDATE", [user])).rows[0];
    demand(reporter, 401, "로그인이 필요합니다.");
    const owner = await targetOwner(sql, user, input.targetType, input.targetId);
    const prior = (await sql.query(
      "SELECT id,status FROM davaq_content_reports WHERE reporter_id=$1 AND target_type=$2 AND target_id=$3 AND status='pending'",
      [user, input.targetType, input.targetId],
    )).rows[0];
    if (prior) return prior as { id: string; status: "pending" };
    const recent = (await sql.query(
      "SELECT count(*)::int AS n FROM davaq_content_reports WHERE reporter_id=$1 AND created_at>now()-interval '1 hour'", [user],
    )).rows[0].n;
    demand(recent < 20, 429, "신고가 많이 접수됐습니다. 잠시 후 다시 시도해 주세요.");
    return (await sql.query(
      "INSERT INTO davaq_content_reports(reporter_id,target_type,target_id,target_owner_id,reason) VALUES($1,$2,$3,$4,$5) RETURNING id,status",
      [user, input.targetType, input.targetId, owner, input.reason],
    )).rows[0] as { id: string; status: "pending" };
  });
}

const reportColumns = `r.id,r.reporter_id,r.target_type,r.target_id,r.target_owner_id,r.reason,r.status,r.created_at,r.reviewed_at,r.reviewer_id,r.review_note,
 reporter.nickname AS reporter_name,owner.nickname AS target_owner_name`;
const reportJoins = `FROM davaq_content_reports r LEFT JOIN users reporter ON reporter.id=r.reporter_id LEFT JOIN users owner ON owner.id=r.target_owner_id`;
export async function listContentReports(status: ContentReportStatus, after: string | null) {
  const rows = (await pool.query(
    `SELECT ${reportColumns} ${reportJoins} WHERE r.status=$1
     AND ($2::uuid IS NULL OR (r.created_at,r.id)>(SELECT created_at,id FROM davaq_content_reports WHERE id=$2))
     ORDER BY r.created_at,r.id LIMIT 51`, [status, after],
  )).rows;
  const items = rows.slice(0, 50);
  return { items, nextCursor: rows.length > 50 ? items.at(-1)!.id : null };
}

/** Explicit moderator inspection: no media URLs, metadata or message history. */
export async function inspectContentReport(id: string) {
  const report = (await pool.query(`SELECT ${reportColumns} ${reportJoins} WHERE r.id=$1`, [id])).rows[0];
  demand(report, 404, "신고를 찾지 못했습니다.");
  let target: Record<string, unknown> | null = null;
  if (report.target_type === "user") {
    target = (await pool.query("SELECT id,nickname,status_message FROM users WHERE id=$1", [report.target_id])).rows[0] ?? null;
  } else if (report.target_type === "message") {
    const message = (await pool.query("SELECT id,room_id,sender_id,type,content,deleted_at FROM messages WHERE id=$1", [report.target_id])).rows[0];
    if (message) target = { id: message.id, room_id: message.room_id, owner_id: message.sender_id, type: message.type, removed: Boolean(message.deleted_at), body: message.type === "text" ? message.content.slice(0, 1000) : "미디어 메시지 (이 화면에서는 파일을 열지 않습니다.)" };
  } else {
    const table = report.target_type === "card_comment" ? "tcg_card_comments" : "tcg_listing_comments";
    const comment = (await pool.query(`SELECT id,owner_id,body FROM ${table} WHERE id=$1`, [report.target_id])).rows[0];
    if (comment) target = { ...comment, removed: comment.body === REMOVED_COMMENT };
  }
  const actions = (await pool.query("SELECT id,actor_id,action,note,created_at FROM davaq_content_report_actions WHERE report_id=$1 ORDER BY created_at,id", [id])).rows;
  return { report, target, actions };
}

export async function reviewContentReport(actor: string, id: string, input: { status: "resolved" | "dismissed"; action: "reviewed" | "remove_content"; note: string }) {
  return transaction(async (sql) => {
    const report = (await sql.query("SELECT * FROM davaq_content_reports WHERE id=$1 FOR UPDATE", [id])).rows[0];
    demand(report, 404, "신고를 찾지 못했습니다.");
    demand(report.status === "pending", 409, "이미 처리된 신고입니다. 목록을 새로고침해 주세요.");
    let changedRoom: { roomId: string; messageId: string } | null = null;
    if (input.action === "remove_content") {
      demand(input.status === "resolved" && report.target_type !== "user", 400, "사용자 신고는 별도 검토 후 처리해 주세요.");
      if (report.target_type === "message") {
        const message = (await sql.query("UPDATE messages SET deleted_at=COALESCE(deleted_at,now()) WHERE id=$1 RETURNING room_id,room_seq", [report.target_id])).rows[0];
        if (message) {
          await sql.query(
            `UPDATE chat_rooms SET pinned_message_id=CASE WHEN pinned_message_id=$2 THEN NULL ELSE pinned_message_id END,
             last_message=CASE WHEN last_message_seq=$3 THEN '삭제된 메시지' ELSE last_message END,
             updated_at=now() WHERE id=$1`, [message.room_id, report.target_id, message.room_seq],
          );
          changedRoom = { roomId: message.room_id, messageId: report.target_id };
        }
      } else {
        // Legacy listing comments and card comments share IDs when mirrored.
        // Keep idempotency keys as tombstones so delayed send retries cannot
        // recreate removed content through either endpoint.
        await sql.query("UPDATE tcg_card_comments SET body=$2 WHERE id=$1", [report.target_id, REMOVED_COMMENT]);
        await sql.query("UPDATE tcg_listing_comments SET body=$2 WHERE id=$1", [report.target_id, REMOVED_COMMENT]);
      }
    }
    const action = input.status === "dismissed" ? "dismissed" : input.action;
    await sql.query("INSERT INTO davaq_content_report_actions(report_id,actor_id,action,note) VALUES($1,$2,$3,$4)", [id, actor, action, input.note]);
    const updated = (await sql.query(
      "UPDATE davaq_content_reports SET status=$2,reviewed_at=now(),reviewer_id=$3,review_note=$4 WHERE id=$1 RETURNING id,status,reviewed_at", [id, input.status, actor, input.note],
    )).rows[0];
    return { ...updated, changedRoom };
  });
}
