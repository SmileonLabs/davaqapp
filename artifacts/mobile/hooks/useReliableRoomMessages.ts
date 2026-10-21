import { loadChatHistory, saveChatHistory, chatHistoryGeneration } from "@/lib/chatHistoryStore";
import { ChatChangeRecovery } from "@/lib/chatChangeRecovery";
import { fetchChatChanges } from "@/lib/chatTransport";
import { refreshLatestRoomMessages } from "@/lib/chatLatestRefresh";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient, type QueryClient, replaceEqualDeep } from "@tanstack/react-query";
import {
  getFetchRoomMessagesQueryKey,
  getGetRoomQueryKey,
  getListRoomsQueryKey,
  type Message,
} from "@workspace/api-client-react";
import {
  fetchAllMessagesAfter,
  catchUpCoversLatestWindow, latestWindowCoversCursor,
  ConfirmedCatchUpCursor,
  ConfirmedCatchUpCursorRegistry,
  confirmedCatchUpIsCommitted,
  maxConfirmedRoomSeq,
  mergeConcurrentChatWrites,
  mergeChatMessages,
  reconcileLatestMessageWindow,
} from "@/lib/chatMessageReliability";
import {
  loadConfirmedChatCursor,
  saveConfirmedChatCursor,
} from "@/lib/chatConfirmedCursorStore";
import {
  noteChatRender,
  noteChatResource,
} from "@/lib/chatPerformanceDiagnostics";

import { fetchChatMessages as fetchRoomMessages } from "@/lib/chatTransport";

const LATEST_WINDOW_SIZE = 50;
const CATCH_UP_PAGE_SIZE = 100;
const confirmedCursors = new ConfirmedCatchUpCursorRegistry();
const changeRecoveries = new WeakMap<object, Map<string, ChatChangeRecovery<Message>>>();
function rememberChangeRecovery(client: QueryClient, key: string, state: ChatChangeRecovery<Message>) {
  const query = client.getQueryCache().find({ queryKey: getFetchRoomMessagesQueryKey(state.roomId), exact: true });
  if (!query) return;
  let scopes = changeRecoveries.get(query);
  if (!scopes) { scopes = new Map(); changeRecoveries.set(query, scopes); }
  scopes.delete(key);
  scopes.set(key, state);
  while (scopes.size > 128) scopes.delete(scopes.keys().next().value!);
}
function changeRecoveryForCache(client: QueryClient, key: string, roomId: string) {
  // A receive position is reusable only while the corresponding cache exists.
  const query = client.getQueryCache().find({ queryKey: getFetchRoomMessagesQueryKey(roomId), exact: true });
  const existing = query && client.getQueryData(getFetchRoomMessagesQueryKey(roomId))
    ? changeRecoveries.get(query)?.get(key) : undefined;
  const state = existing ?? new ChatChangeRecovery<Message>(roomId);
  rememberChangeRecovery(client, key, state);
  return state;
}


/**
 * Reconciles the latest server window with every row after the last confirmed
 * roomSeq. This is intentionally different from a plain 50-row refetch: if the
 * socket was offline while 51+ messages arrived, every intermediate page is
 * fetched before the query cache is replaced.
 */
export function useReliableRoomMessages(
  roomId: string,
  identity: { userId?: string | null; profileId?: string | null; pollInterval?: number; enabled?: boolean },
) {
  const queryClient = useQueryClient();
  const queryKey = getFetchRoomMessagesQueryKey(roomId);
  const cursorKey = useMemo(
    () =>
      roomId && identity.userId && identity.profileId
        ? `${identity.userId}\u0000${identity.profileId}\u0000${roomId}`
        : null,
    [identity.profileId, identity.userId, roomId],
  );
  const [hydratedCursorKey, setHydratedCursorKey] = useState<string | null>(null);
  const continuationTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingCommitRef = useRef<{
    key: string;
    cursorState: { key: string; cursor: ConfirmedCatchUpCursor };
    catchUpMessages: Message[];
    lastSeq: number;
    complete: boolean;
  } | null>(null);
  const pendingChangesRef = useRef<{
    key: string; next: ChatChangeRecovery<Message>; result: Message[]; snapshot: Message[];
    accepted?: Message[]; hasMore: boolean; changed: boolean;
  } | null>(null);
  const changeRecoveryRef = useRef<{ key: string; client: QueryClient; state: ChatChangeRecovery<Message>; historyGeneration: number } | null>(null);
  if (cursorKey && (changeRecoveryRef.current?.key !== cursorKey || changeRecoveryRef.current?.client !== queryClient)) {
    changeRecoveryRef.current = { key: cursorKey, client: queryClient, state: changeRecoveryForCache(queryClient, cursorKey, roomId), historyGeneration: chatHistoryGeneration(identity.userId!) };
    pendingChangesRef.current = null;
  }
  const pendingStructuralMergeRef = useRef<{
    result: Message[];
    snapshot: Message[];
  } | null>(null);
  const cursorRef = useRef<{
    key: string;
    cursor: ConfirmedCatchUpCursor;
  } | null>(null);

  // Fetch the visible window immediately; durable storage may be queued behind
  // other room writes and must not gate the first visible message.
  useEffect(() => {
    if (identity.enabled === false || !cursorKey) return;
    const controller = new AbortController();
    void refreshLatestRoomMessages(queryClient, roomId, controller.signal).catch(() => {});
    return () => controller.abort();
  }, [cursorKey, identity.enabled, queryClient, roomId]);

  useEffect(() => {
    let cancelled = false;
    setHydratedCursorKey(null);
    if (!cursorKey || !identity.userId || !identity.profileId || !roomId) {
      cursorRef.current = null;
      return () => {
        cancelled = true;
      };
    }

    const state = {
      key: cursorKey,
      cursor: confirmedCursors.forRoom(cursorKey),
    };
    cursorRef.current = state;
    const recovery = changeRecoveryRef.current;
    void Promise.all([
      loadConfirmedChatCursor(identity.userId, identity.profileId, roomId),
      loadChatHistory(identity.userId, identity.profileId, roomId).catch(() => null),
    ]).then(([persisted, history]) => {
        if (cancelled || cursorRef.current !== state) return;
        // Persisted values were advanced only after a successful server page.
        // Taking max with a live in-memory cursor is therefore safe.
        if (history && recovery && changeRecoveryRef.current === recovery &&
            recovery.historyGeneration === chatHistoryGeneration(history.userId) &&
            recovery.state.revision === null && !(queryClient.getQueryData<Message[]>(queryKey)?.length)) {
          const restored = recovery.state.prepare([], { protocol: 1, reset: true, hasMore: false,
            revision: history.revision, snapshotRoomSeq: history.snapshotRoomSeq,
            messages: history.messages, removedMessageIds: [], readCursors: [] });
          recovery.state = restored.next;
          queryClient.setQueryData(queryKey, restored.data);
          rememberChangeRecovery(queryClient, cursorKey, restored.next);
        }
        state.cursor.advance(persisted);
        setHydratedCursorKey(cursorKey);
      })
      .catch(() => {
        if (cancelled || cursorRef.current !== state) return;
        // Storage can be unavailable in private browsing. Starting from zero
        // (or the still-live confirmed cursor) causes redundant fetches, not a
        // skipped interval.
        setHydratedCursorKey(cursorKey);
      });

    return () => {
      cancelled = true;
    };
  }, [cursorKey, identity.profileId, identity.userId, roomId]);

  useEffect(
    () => () => {
      if (continuationTimerRef.current) {
        clearTimeout(continuationTimerRef.current);
        continuationTimerRef.current = null;
        noteChatResource("timers", -1);
      }
    },
    [cursorKey],
  );

  const query = useQuery<Message[]>({
    queryKey,
    enabled: identity.enabled !== false && !!cursorKey && hydratedCursorKey === cursorKey,
    staleTime: 0,
    refetchOnReconnect: true,
    refetchInterval: identity.pollInterval ? (q) => q.state.data?.some(m => ["queued", "running"].includes(String(m.metadata?.replyState ?? ""))) ? identity.pollInterval! : 15000 : false,
    refetchIntervalInBackground: false,
    structuralSharing: (oldData, newData) => {
      const change = pendingChangesRef.current;
      if (change?.key === cursorKey && change.result === newData) {
        const accepted = change.next.project(mergeConcurrentChatWrites(
          change.snapshot, Array.isArray(oldData) ? oldData as Message[] : [], change.result,
        ) as Message[]);
        change.accepted = accepted;
        return accepted;
      }
      const pending = pendingStructuralMergeRef.current;
      if (!pending || pending.result !== newData) return newData;
      pendingStructuralMergeRef.current = null;
      return mergeConcurrentChatWrites(
        pending.snapshot,
        Array.isArray(oldData) ? (oldData as Message[]) : [],
        newData as Message[],
      ) as Message[];
    },
    queryFn: async ({ signal }) => {
      const current = queryClient.getQueryData<Message[]>(queryKey) ?? [];
      const cursorState = cursorRef.current;
      if (!cursorState || cursorState.key !== cursorKey) {
        throw new Error("room catch-up cursor changed during synchronisation");
      }
      const lastSeq = cursorState.cursor.current;

      const recovery = changeRecoveryRef.current;
      if (recovery?.key === cursorKey && typeof fetchChatChanges === "function") {
        try {
          const page = await fetchChatChanges(roomId, recovery.state.revision, signal);
          if (signal.aborted || changeRecoveryRef.current !== recovery) throw new Error("Room change sync cancelled");
          const prepared = recovery.state.prepare(current, page);
          pendingChangesRef.current = { key: cursorKey!, next: prepared.next, result: prepared.data, snapshot: current, hasMore: prepared.hasMore, changed: recovery.state.revision !== prepared.next.revision };
          return prepared.data;
        } catch (error) {
          // Rolling deployment compatibility only. Network/auth/server failures
          // must not advance a cursor or silently downgrade to partial recovery.
          if (!error || typeof error !== "object" || !("status" in error) || error.status !== 404) throw error;
          recovery.state = new ChatChangeRecovery<Message>(roomId);
          rememberChangeRecovery(queryClient, cursorKey!, recovery.state);
          pendingChangesRef.current = null;
        }
      }

      const latest = await fetchRoomMessages(roomId,{limit:LATEST_WINDOW_SIZE},{signal});
      const covered=latestWindowCoversCursor(latest,lastSeq,LATEST_WINDOW_SIZE);
      // Latest rows must reach the screen before replaying a long offline gap.
      // This cache projection does not advance the contiguous receive cursor.
      if (lastSeq > 0 && !covered && !signal.aborted && cursorRef.current === cursorState) {
        queryClient.setQueryData<Message[]>(queryKey, (live = []) =>
          mergeConcurrentChatWrites(current, live, reconcileLatestMessageWindow(current, latest, LATEST_WINDOW_SIZE)) as Message[],
        );
      }
      const catchUp = lastSeq>0 ? covered ? {messages:latest.filter(m=>Number(m.roomSeq??0)>lastSeq),lastSeq:Math.max(lastSeq,maxConfirmedRoomSeq(latest)),complete:true,pages:0} : await fetchAllMessagesAfter<Message>(lastSeq,(afterSeq,limit)=>fetchRoomMessages(roomId,{afterSeq,limit},{signal}),{pageSize:CATCH_UP_PAGE_SIZE}) : null;
      const reconciledLatest = reconcileLatestMessageWindow(
        current,
        latest,
        LATEST_WINDOW_SIZE,
      );

      // A zero cursor means this installation has no proof of a contiguous
      // receive position. Bootstrap from the authoritative latest window and
      // commit that window as the baseline; replaying an entire mature room
      // (potentially tens of thousands of rows) would make first-open memory
      // and render cost grow without bound. Older history belongs to a separate
      // backward-pagination path, not reconnect recovery.
      if (lastSeq === 0) {
        const baselineSeq = maxConfirmedRoomSeq(latest);
        if (!signal.aborted && cursorRef.current === cursorState) {
          pendingCommitRef.current = {
            key: cursorKey!,
            cursorState,
            catchUpMessages: latest,
            lastSeq: baselineSeq,
            complete: true,
          };
        }
        noteChatRender("catchUpPages", 0);
        const result = mergeConcurrentChatWrites(
          current,
          queryClient.getQueryData<Message[]>(queryKey) ?? [],
          reconciledLatest,
        ) as Message[];
        pendingStructuralMergeRef.current = { result, snapshot: current };
        return result;
      }

      if (!catchUp) {
        throw new Error("known room cursor requires a catch-up result");
      }
      noteChatRender("catchUpPages", catchUp.pages);
      const reconciled = mergeChatMessages(
        reconciledLatest,
        catchUp.messages,
      ) as Message[];
      if (!signal.aborted && cursorRef.current === cursorState) {
        // React Query may still discard this result if the request is aborted
        // during return/unmount. Cursor persistence happens in the commit
        // effect below, only after dataUpdatedAt proves the cache accepted it.
        pendingCommitRef.current = {
          key: cursorKey!,
          cursorState,
          catchUpMessages: catchUp.messages,
          lastSeq: catchUp.lastSeq,
          complete: catchUpCoversLatestWindow(catchUp, latest),
        };
      }
      const result = mergeConcurrentChatWrites(
        current,
        queryClient.getQueryData<Message[]>(queryKey) ?? [],
        reconciled,
      ) as Message[];
      pendingStructuralMergeRef.current = { result, snapshot: current };
      return result;
    },
  });

  useEffect(() => {
    if (!query.isSuccess || !query.dataUpdatedAt) return;
    const pending = pendingCommitRef.current;
    if (
      !pending ||
      pending.key !== cursorKey ||
      cursorRef.current !== pending.cursorState ||
      !confirmedCatchUpIsCommitted(query.data ?? [], pending.catchUpMessages) ||
      !identity.userId ||
      !identity.profileId
    ) {
      return;
    }
    pendingCommitRef.current = null;
    pending.cursorState.cursor.advance(pending.lastSeq);
    void saveConfirmedChatCursor(
      identity.userId,
      identity.profileId,
      roomId,
      pending.cursorState.cursor.current,
    ).catch(() => {
      // A stale persisted cursor causes duplicate catch-up, never a gap.
    });

    if (!pending.complete && continuationTimerRef.current === null) {
          // Continue a deliberately bounded sync even if no realtime event
          // arrives. The identity/cursor fence prevents an old room timer from
          // refetching a newly opened room.
          continuationTimerRef.current = setTimeout(() => {
            continuationTimerRef.current = null;
            noteChatResource("timers", -1);
            if (cursorRef.current !== pending.cursorState) return;
            void queryClient.invalidateQueries({ queryKey, exact: true });
          }, 1_000);
          noteChatResource("timers", 1);
        } else if (pending.complete && continuationTimerRef.current) {
          clearTimeout(continuationTimerRef.current);
          continuationTimerRef.current = null;
          noteChatResource("timers", -1);
    }
  }, [
    cursorKey,
    identity.profileId,
    identity.userId,
    query.dataUpdatedAt,
    query.isSuccess,
    queryClient,
    queryKey,
    roomId,
  ]);

  useEffect(() => {
    const pending = pendingChangesRef.current;
    const recovery = changeRecoveryRef.current;
    if (!query.isSuccess || !pending || pending.key !== cursorKey || recovery?.key !== cursorKey ||
      !pending.accepted || query.data !== pending.accepted) return;
    recovery.state = pending.next;
    rememberChangeRecovery(queryClient, cursorKey!, pending.next);
    pendingChangesRef.current = null;
    if (pending.changed && identity.userId && identity.profileId && pending.next.revision !== null) {
      void saveChatHistory({ version: 1, userId: identity.userId, profileId: identity.profileId,
        roomId, revision: pending.next.revision, snapshotRoomSeq: pending.next.snapshotRoomSeq,
        savedAt: Date.now(), messages: pending.next.project(pending.accepted) }, recovery.historyGeneration).catch(() => {});
    }
    // Read events also change this account's room-list badges on other devices.
    if (pending.changed) {
      void queryClient.invalidateQueries({ queryKey: getListRoomsQueryKey() });
      void queryClient.invalidateQueries({ queryKey: getGetRoomQueryKey(roomId) });
    }
    if (pending.hasMore && continuationTimerRef.current === null) {
      continuationTimerRef.current = setTimeout(() => {
        continuationTimerRef.current = null;
        noteChatResource("timers", -1);
        if (changeRecoveryRef.current !== recovery) return;
        void queryClient.invalidateQueries({ queryKey, exact: true });
      }, 0);
      noteChatResource("timers", 1);
    }
  }, [cursorKey, query.data, query.dataUpdatedAt, query.isSuccess, queryClient, queryKey, roomId]);

  const [olderStatus, setOlderStatus] = useState({ key: cursorKey, loading: false, done: false, error: "" });
  const olderDoneEpochRef = useRef<object | undefined>(undefined);
  const olderRequestRef = useRef<{ key: string; controller: AbortController; promise: Promise<number> } | null>(null);
  useEffect(() => () => { olderRequestRef.current?.controller.abort(); olderRequestRef.current = null; }, [cursorKey]);
  const loadOlder = useCallback((): Promise<number> => {
    if (!cursorKey || identity.enabled === false || hydratedCursorKey !== cursorKey) return Promise.resolve(0);
    if (olderRequestRef.current?.key === cursorKey) return olderRequestRef.current.promise;
    if (olderStatus.key === cursorKey && olderStatus.done && olderDoneEpochRef.current === changeRecoveryRef.current?.state.historyEpoch) return Promise.resolve(0);
    const current = queryClient.getQueryData<Message[]>(queryKey) ?? [];
    const sequences = current.filter(m => m.roomSeq > 0 && !m.id.startsWith("temp-")).map(m => m.roomSeq);
    if (!sequences.length) return Promise.resolve(0);
    const beforeSeq = Math.min(...sequences);
    const recovery = changeRecoveryRef.current;
    const epoch = recovery?.state.historyEpoch;
    const controller = new AbortController();
    setOlderStatus({ key: cursorKey, loading: true, done: false, error: "" });
    const request = { key: cursorKey, controller, promise: Promise.resolve(0) };
    request.promise = (async () => {
      try {
        const page = await fetchRoomMessages(roomId, { beforeSeq, limit: LATEST_WINDOW_SIZE }, { signal: controller.signal });
        if (controller.signal.aborted || changeRecoveryRef.current !== recovery || recovery?.state.historyEpoch !== epoch) return 0;
        if (page.some(m => m.roomId !== roomId || !Number.isSafeInteger(m.roomSeq) || m.roomSeq <= 0 || m.roomSeq >= beforeSeq)) throw new Error("Invalid room history page");
        recovery?.state.admitHistory(page);
        queryClient.setQueryData<Message[]>(queryKey, live => {
          // Live writes and authoritative changes win against a delayed older page.
          const merged = mergeChatMessages(page, live ?? []) as Message[];
          return recovery ? recovery.state.project(merged) : merged;
        });
        if (recovery?.state.revision !== null && recovery?.state.revision !== undefined && identity.userId && identity.profileId) {
          void saveChatHistory({ version: 1, userId: identity.userId, profileId: identity.profileId,
            roomId, revision: recovery.state.revision, snapshotRoomSeq: recovery.state.snapshotRoomSeq,
            savedAt: Date.now(), messages: recovery.state.project(queryClient.getQueryData<Message[]>(queryKey) ?? []) }, recovery.historyGeneration).catch(() => {});
        }
        olderDoneEpochRef.current = epoch;
        setOlderStatus({ key: cursorKey, loading: false, done: page.length < LATEST_WINDOW_SIZE, error: "" });
        return page.length;
      } catch (error) {
        if (!controller.signal.aborted && changeRecoveryRef.current === recovery) {
          setOlderStatus({ key: cursorKey, loading: false, done: false, error: "이전 메시지를 불러오지 못했습니다. 다시 시도해 주세요." });
        }
        throw error;
      } finally {
        if (olderRequestRef.current === request) {
          olderRequestRef.current = null;
          setOlderStatus(status => status.key === cursorKey && status.loading ? { ...status, loading: false } : status);
        }
      }
    })();
    olderRequestRef.current = request;
    return request.promise;
  }, [cursorKey, hydratedCursorKey, identity.enabled, identity.userId, identity.profileId, queryClient, roomId, olderStatus.key, olderStatus.done]);
  const dataRef = useRef<Message[] | undefined>(undefined);
  const refetch = useCallback((options?: Parameters<typeof query.refetch>[0]) => {
    // Focus/push recovery may fire before account and cursor hydration finish.
    // The enabled query will fetch automatically once ready; do not create a
    // transient error (or an unauthorised request) in the meantime.
    if (identity.enabled === false || !cursorKey || hydratedCursorKey !== cursorKey) return Promise.resolve(query);
    return query.refetch(options);
  }, [cursorKey, hydratedCursorKey, identity.enabled, query.refetch]);
  // A cache commit renders before its cursor-commit effect. Project with the
  // accepted state now; otherwise an old overlay can mask the just-committed edit.
  const acceptedChange = pendingChangesRef.current;
  const effectiveRecovery = acceptedChange?.key === cursorKey && acceptedChange.accepted === query.data
    ? acceptedChange.next : changeRecoveryRef.current?.state;
  const data = useMemo(() => {
    const projected = query.data && effectiveRecovery ? effectiveRecovery.project(query.data) : query.data;
    dataRef.current = replaceEqualDeep(dataRef.current, projected);
    return dataRef.current;
  }, [cursorKey, query.data, query.dataUpdatedAt, queryClient]);
  return { ...query, data, refetch, loadOlder,
    loadingOlder: olderStatus.key === cursorKey && olderStatus.loading,
    hasOlder: olderStatus.key !== cursorKey || !olderStatus.done || olderDoneEpochRef.current !== effectiveRecovery?.historyEpoch,
    olderError: olderStatus.key === cursorKey ? olderStatus.error : "",
  };
}
