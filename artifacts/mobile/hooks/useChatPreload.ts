import { useSyncExternalStore } from "react";
import { getChatRealtimeConnected, subscribeChatRealtimeStatus, chatRoomListPollInterval } from "@/lib/chatRealtimeStatus";
import { useEffect, useState } from "react";
import { AppState, Platform } from "react-native";
import { useQueryClient } from "@tanstack/react-query";
import { getListRoomsQueryKey, getFetchRoomMessagesQueryKey, useGetMe, useListRooms, type Message } from "@workspace/api-client-react";
import { useCharacterProfiles } from "@/hooks/useCharacterProfiles";
import { fetchChatMessages } from "@/lib/chatTransport";
import { mergeConcurrentChatWrites, reconcileLatestMessageWindow } from "@/lib/chatMessageReliability";
import { selectPreloadRooms } from "@/lib/chatPreloadPolicy";

/** Warm bounded latest windows only; opening a room still performs cursor catch-up. */
export function useChatPreload() {
  const live = useSyncExternalStore(subscribeChatRealtimeStatus,getChatRealtimeConnected,()=>false);
  const client = useQueryClient();
  const { data: me } = useGetMe();
  const { activeProfile } = useCharacterProfiles();
  const [active, setActive] = useState(Platform.OS === "web" ? typeof document !== "undefined" && document.visibilityState === "visible" : AppState.currentState === "active");
  useEffect(() => {
    if (Platform.OS === "web") {
      if (typeof document === "undefined") return;
      const update = () => setActive(document.visibilityState === "visible");
      document.addEventListener("visibilitychange", update);
      return () => document.removeEventListener("visibilitychange", update);
    }
    const sub = AppState.addEventListener("change", state => setActive(state === "active"));
    return () => sub.remove();
  }, []);
  const rooms = useListRooms({ query: { queryKey: getListRoomsQueryKey(), enabled: active && !!me?.id && !!activeProfile?.id, staleTime: 15000, refetchInterval: active ? chatRoomListPollInterval(live) : false, refetchIntervalInBackground: false } });
  useEffect(() => {
    if (!active || !me?.id || !activeProfile?.id || !rooms.data) return;
    const controller = new AbortController();
    const selected = selectPreloadRooms(rooms.data);
    let next = 0;
    const worker = async () => {
      while (!controller.signal.aborted && next < selected.length) {
        const room = selected[next++];
        const key = getFetchRoomMessagesQueryKey(room.id);
        const query = client.getQueryCache().find({ queryKey: key, exact: true });
        // The mounted conversation owns full reliable synchronisation.
        if (query?.getObserversCount() || query?.state.fetchStatus === "fetching") continue;
        if (query && !query.state.isInvalidated && Date.now() - query.state.dataUpdatedAt < 20000) continue;
        const cached = client.getQueryData<Message[]>(key);
        // A warm window with the same server head needs no identical GET.
        // Opening the room still replays all mutations via the change log.
        if (cached && Number.isSafeInteger(room.lastMessageSeq) &&
            (room.lastMessageSeq === 0 || cached.some(m=>m.roomSeq === room.lastMessageSeq))) continue;
        const snapshot = cached ?? [];
        try {
          const latest = await fetchChatMessages(room.id, { limit: 50 }, { signal: controller.signal });
          if (controller.signal.aborted) return;
          client.setQueryData<Message[]>(key, live => mergeConcurrentChatWrites(snapshot, live ?? [], reconcileLatestMessageWindow(snapshot, latest, 50)) as Message[]);
          // No read request and no contiguous receive cursor advancement here.
        } catch { /* Opening a room retries through its authoritative query. */ }
      }
    };
    void Promise.all([worker(), worker()]);
    return () => controller.abort();
  }, [active, me?.id, activeProfile?.id, rooms.data, client]);
}
