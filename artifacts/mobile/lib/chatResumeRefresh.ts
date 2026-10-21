import type { QueryClient } from "@tanstack/react-query";
import { listRooms, getListRoomsQueryKey } from "@workspace/api-client-react";
import { refreshLatestRoomMessages } from "./chatLatestRefresh";
import { selectPreloadRooms } from "./chatPreloadPolicy";

/** Fresh inbox first; all unread rooms next, with two concurrent requests. */
export async function refreshChatsOnResume(client: QueryClient, signal: AbortSignal) {
  if (signal.aborted) return;
  const rooms = await listRooms({ signal });
  if (signal.aborted) return;
  client.setQueryData(getListRoomsQueryKey(), rooms);
  const unread = rooms.filter(room => (room.unreadCount ?? 0) > 0);
  const selected = [...new Map([...unread, ...selectPreloadRooms(rooms)].map(room => [room.id, room])).values()];
  let next = 0;
  const worker = async () => {
    while (!signal.aborted && next < selected.length) {
      const room = selected[next++];
      try { await refreshLatestRoomMessages(client, room.id, signal); }
      catch { /* Room entry and realtime recovery remain authoritative. */ }
    }
  };
  await Promise.all([worker(), worker()]);
}
