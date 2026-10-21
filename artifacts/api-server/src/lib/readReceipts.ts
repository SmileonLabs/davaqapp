import { sql, type SQL } from "drizzle-orm";
import { db } from "@workspace/db";

type Executor = { execute: (query: SQL) => Promise<unknown> };

export interface ReadTarget {
  id: string;
  roomSeq: number;
}

function rowsOf<Row>(result: unknown): Row[] {
  if (Array.isArray(result)) return result as Row[];
  const maybeRows = (result as { rows?: unknown[] } | null)?.rows;
  return Array.isArray(maybeRows) ? (maybeRows as Row[]) : [];
}

function rowCountOf(result: unknown): number {
  if (Array.isArray(result)) return result.length;
  const count = (result as { rowCount?: unknown } | null)?.rowCount;
  return typeof count === "number" ? count : rowsOf<unknown>(result).length;
}

async function query<Row>(executor: Executor, statement: SQL): Promise<Row[]> {
  return rowsOf<Row>(await executor.execute(statement));
}

function intValue(value: unknown): number {
  if (typeof value === "number") return value;
  if (typeof value === "string") return Number(value);
  return 0;
}

export async function ensureReadReceiptSchema(): Promise<void> {
  await db.execute(
    sql`SELECT pg_advisory_lock(hashtext('anotherme:read-receipts-v1'))`,
  );
  try {
    await db.execute(
      sql`ALTER TABLE messages ADD COLUMN IF NOT EXISTS room_seq integer NOT NULL DEFAULT 0`,
    );
    await db.execute(
      sql`ALTER TABLE chat_rooms ADD COLUMN IF NOT EXISTS last_message_seq integer NOT NULL DEFAULT 0`,
    );
    await db.execute(
      sql`ALTER TABLE chat_room_members ADD COLUMN IF NOT EXISTS last_read_seq integer NOT NULL DEFAULT 0`,
    );

    await db.execute(sql`
      WITH numbered AS (
        SELECT
          id,
          row_number() OVER (PARTITION BY room_id ORDER BY created_at, id)::integer AS seq
        FROM messages
      )
      UPDATE messages AS m
      SET room_seq = numbered.seq
      FROM numbered
      WHERE m.id = numbered.id
        AND m.room_seq = 0
    `);

    await db.execute(sql`
      UPDATE chat_rooms AS r
      SET last_message_seq = seqs.max_seq
      FROM (
        SELECT room_id, max(room_seq)::integer AS max_seq
        FROM messages
        GROUP BY room_id
      ) AS seqs
      WHERE r.id = seqs.room_id
        AND r.last_message_seq < seqs.max_seq
    `);

    await db.execute(sql`
      UPDATE chat_room_members AS m
      SET last_read_seq = msg.room_seq
      FROM messages AS msg
      WHERE m.last_read_message_id = msg.id
        AND m.last_read_seq < msg.room_seq
    `);

    await db.execute(
      sql`CREATE INDEX IF NOT EXISTS messages_room_id_room_seq_idx ON messages (room_id, room_seq)`,
    );
    await db.execute(
      sql`CREATE UNIQUE INDEX IF NOT EXISTS messages_room_id_room_seq_unique_idx ON messages (room_id, room_seq) WHERE room_seq > 0`,
    );
    await db.execute(
      sql`CREATE INDEX IF NOT EXISTS chat_room_members_room_id_last_read_seq_idx ON chat_room_members (room_id, last_read_seq)`,
    );
  } finally {
    await db.execute(
      sql`SELECT pg_advisory_unlock(hashtext('anotherme:read-receipts-v1'))`,
    );
  }
}

export async function allocateRoomMessageSeq(
  executor: Executor,
  roomId: string,
): Promise<number> {
  const rows = await query<{ nextSeq: number | string }>(
    executor,
    sql`
    UPDATE chat_rooms
    SET last_message_seq = last_message_seq + 1
    WHERE id = ${roomId}
    RETURNING last_message_seq AS "nextSeq"
  `,
  );
  const nextSeq = intValue(rows[0]?.nextSeq);
  if (nextSeq <= 0)
    throw new Error(`Unable to allocate message sequence for room ${roomId}`);
  return nextSeq;
}

export async function setMemberReadSeq(
  executor: Executor,
  roomId: string,
  userId: string,
  target: ReadTarget,
): Promise<void> {
  await executor.execute(sql`
    UPDATE chat_room_members
    SET last_read_message_id = ${target.id}, last_read_seq = GREATEST(last_read_seq, ${target.roomSeq})
    WHERE room_id = ${roomId}
      AND user_id = ${userId}
  `);
}

export async function advanceMemberReadSeq(
  roomId: string,
  userId: string,
  target: ReadTarget,
): Promise<boolean> {
  const result = await db.execute(sql`
    UPDATE chat_room_members
    SET last_read_message_id = ${target.id}, last_read_seq = ${target.roomSeq}
    WHERE room_id = ${roomId}
      AND user_id = ${userId}
      AND last_read_seq < ${target.roomSeq}
    RETURNING id
  `);
  return rowCountOf(result) > 0;
}

export async function getMessageReadTarget(
  roomId: string,
  messageId: string,
): Promise<ReadTarget | null> {
  const rows = await query<{ id: string; roomSeq: number | string }>(
    db,
    sql`
    SELECT id, room_seq AS "roomSeq"
    FROM messages
    WHERE id = ${messageId}
      AND room_id = ${roomId}
    LIMIT 1
  `,
  );
  const row = rows[0];
  return row ? { id: row.id, roomSeq: intValue(row.roomSeq) } : null;
}

export async function getLatestMessageReadTarget(
  roomId: string,
): Promise<ReadTarget | null> {
  const rows = await query<{ id: string; roomSeq: number | string }>(
    db,
    sql`
    SELECT id, room_seq AS "roomSeq"
    FROM messages
    WHERE room_id = ${roomId}
    ORDER BY room_seq DESC, created_at DESC, id DESC
    LIMIT 1
  `,
  );
  const row = rows[0];
  return row ? { id: row.id, roomSeq: intValue(row.roomSeq) } : null;
}

export async function getRoomMemberReadSeqs(
  roomId: string,
): Promise<
  Array<{
    userId: string;
    lastReadSeq: number;
    isReadReceiptParticipant: boolean;
  }>
> {
  const rows = await query<{
    userId: string;
    lastReadSeq: number | string;
    isReadReceiptParticipant: boolean;
  }>(
    db,
    sql`
    SELECT
      crm.user_id AS "userId",
      crm.last_read_seq AS "lastReadSeq",
      (
        u.clerk_id NOT LIKE 'system:%'
        AND u.clerk_id NOT LIKE 'official:%'
        AND lower(u.email) NOT LIKE '%@todotalk.system'
        AND lower(u.email) NOT LIKE '%@anotherme.local'
      ) AS "isReadReceiptParticipant"
    FROM chat_room_members crm
    INNER JOIN users u ON u.id = crm.user_id
    WHERE crm.room_id = ${roomId}
  `,
  );
  return rows.map((row) => ({
    userId: row.userId,
    lastReadSeq: intValue(row.lastReadSeq),
    isReadReceiptParticipant: row.isReadReceiptParticipant,
  }));
}

export async function getRoomUnreadMeta(
  roomId: string,
  userId: string,
  lastReadSeq: number,
): Promise<{ unreadCount: number; firstUnreadMessageId: string | null }> {
  // The room list calls this for every visible room. Keep the unread count and
  // first-unread lookup in one statement instead of paying two round-trips per
  // room on every fallback refresh.
  const rows = await query<{
    value: number | string;
    firstUnreadMessageId: string | null;
  }>(
    db,
    sql`
    SELECT
      count(*)::integer AS value,
      (
        SELECT m.id
        FROM messages AS m
        WHERE m.room_id = ${roomId}
          AND m.sender_id <> ${userId}
          AND m.deleted_at IS NULL
          AND m.room_seq > ${lastReadSeq}
          AND NOT EXISTS (
            SELECT 1
            FROM message_deletions AS md
            WHERE md.message_id = m.id
              AND md.user_id = ${userId}
          )
        ORDER BY m.room_seq ASC, m.created_at ASC, m.id ASC
        LIMIT 1
      ) AS "firstUnreadMessageId"
    FROM messages
    WHERE room_id = ${roomId}
      AND sender_id <> ${userId}
      AND deleted_at IS NULL
      AND room_seq > ${lastReadSeq}
      AND NOT EXISTS (
        SELECT 1
        FROM message_deletions AS md
        WHERE md.message_id = messages.id
          AND md.user_id = ${userId}
      )
  `,
  );
  const row = rows[0];
  return {
    unreadCount: intValue(row?.value),
    firstUnreadMessageId: row?.firstUnreadMessageId ?? null,
  };
}
