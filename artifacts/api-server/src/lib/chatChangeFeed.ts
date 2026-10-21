import { and, desc, eq, inArray, isNull, or, sql } from "drizzle-orm";
import { db, chatRoomMembersTable, messagesTable } from "@workspace/db";
export const CHANGE_PAGE_SIZE = 200;
export function parseChangeRevision(value: unknown): string | null | undefined {
  if (value === undefined) return null; // Snapshot baseline for a new local cache.
  if (typeof value !== "string" || !/^(0|[1-9][0-9]{0,18})$/.test(value))
    return undefined;
  return BigInt(value) <= 9223372036854775807n ? value : undefined;
}
export function sqlRows<T>(result: unknown): T[] {
  if (Array.isArray(result)) return result as T[];
  return (result as { rows: T[] }).rows;
}

export async function readRoomChangePage(
  database: Pick<typeof db, "transaction">,
  roomId: string,
  userId: string,
  profileId: string,
  after: string | null,
) {
  return database.transaction(
    async (tx) => {
      const [member] = await tx
        .select({ id: chatRoomMembersTable.id })
        .from(chatRoomMembersTable)
        .where(
          and(
            eq(chatRoomMembersTable.roomId, roomId),
            eq(chatRoomMembersTable.userId, userId),
            or(
              eq(chatRoomMembersTable.profileId, profileId),
              isNull(chatRoomMembersTable.profileId),
            ),
          ),
        );
      if (!member) return null;
      const headRows = sqlRows<{ revision: string; snapshotRoomSeq: number }>(
        await tx.execute(sql`
      SELECT COALESCE((SELECT revision FROM chat_sync_rooms WHERE room_id = ${roomId}::uuid), 0)::text AS revision,
        COALESCE((SELECT max(room_seq) FROM messages WHERE room_id = ${roomId}::uuid), 0) AS "snapshotRoomSeq"`),
      );
      const head = headRows[0]?.revision ?? "0";
      const reset = after === null || BigInt(after) > BigInt(head);
      const changes = reset
        ? []
        : sqlRows<{
            revision: string;
            messageId: string | null;
            audienceUserId: string | null;
          }>(
            await tx.execute(sql`
      SELECT revision::text AS revision, message_id AS "messageId", audience_user_id AS "audienceUserId"
      FROM chat_changes WHERE room_id = ${roomId}::uuid AND revision > ${after}::bigint
        AND revision <= ${head}::bigint ORDER BY chat_changes.revision LIMIT ${CHANGE_PAGE_SIZE}`),
          );
      const revision = reset ? head : (changes.at(-1)?.revision ?? after!);
      const ids = [
        ...new Set(
          changes
            .filter((c) => !c.audienceUserId || c.audienceUserId === userId)
            .flatMap((c) => (c.messageId ? [c.messageId] : [])),
        ),
      ];
      const messages = reset
        ? (
            await tx
              .select()
              .from(messagesTable)
              .where(
                and(
                  eq(messagesTable.roomId, roomId),
                  sql`NOT EXISTS (
          SELECT 1 FROM message_deletions md WHERE md.message_id = ${messagesTable.id} AND md.user_id = ${userId}::uuid)`,
                ),
              )
              .orderBy(desc(messagesTable.roomSeq), desc(messagesTable.id))
              .limit(50)
          ).reverse()
        : ids.length
          ? await tx
              .select()
              .from(messagesTable)
              .where(
                and(
                  eq(messagesTable.roomId, roomId),
                  inArray(messagesTable.id, ids),
                ),
              )
          : [];
      return {
        reset,
        revision,
        snapshotRoomSeq: headRows[0]?.snapshotRoomSeq ?? 0,
        hasMore: BigInt(revision) < BigInt(head),
        ids,
        messages,
      };
    },
    { isolationLevel: "repeatable read", accessMode: "read only" },
  );
}
