import {shopEventTargets,shopQueryAffected} from './shopRealtime';
import { ChatInvalidationBatch, ChatRealtimeEventDeduper } from "./chatInvalidationBatch";
import { setChatRealtimeConnected } from "./chatRealtimeStatus";
import { projectRoomRead } from "./chatUnreadProjection";
import { useEffect } from "react";
import { AppState, Platform } from "react-native";
import NetInfo from "@react-native-community/netinfo";
import { useAuth } from "@/lib/davaqAuth";
import { useQueryClient } from "@tanstack/react-query";
import {
  getFetchRoomMessagesQueryKey,
  getGetMeQueryKey,
  type ChatRoom,
  getGetCallQueryKey,
  getGetRoomQueryKey,
  getGetTypingUsersQueryKey,
  getListIncomingCallsQueryKey,
  getListRoomsQueryKey,
} from "@workspace/api-client-react";
import { getApiBase } from "@/lib/apiBase";
import { projectRealtimeCall } from "./callRealtimeProjection";
import type { Call, Message } from "@workspace/api-client-react";
import { projectCreatedMessage, projectReadCursors, type ReadCursor } from "./chatRealtimeProjection";
import {
  noteChatRealtimeDeliveryAge,
  noteChatResource,
} from "@/lib/chatPerformanceDiagnostics";
import {
  canStartRealtimeConnection,
  REALTIME_SOCKET_OPEN_TIMEOUT_MS,
  REALTIME_TICKET_TIMEOUT_MS,
  realtimeReconnectDelayMs,
  RealtimeGenerationFence,
  runWithAbortDeadline,
} from "@/lib/realtimeConnectionPolicy";

type RealtimeEventType =
  | "shop.message.created"
  | "shop.thread.updated"
  | "message.created"
  | "message.updated"
  | "message.read"
  | "typing.updated"
  | "room.updated"
  | "call.created"
  | "call.updated"
  | "group_call.created"
  | "group_call.updated";

interface RealtimeEvent {
  type: RealtimeEventType;
  userIds: string[];
  roomId?: string | null;
  callId?: string | null;
  actorUserId?: string | null;
  data?: Record<string, unknown>;
  createdAt: string;
}

const EVENT_TYPES = new Set<RealtimeEventType>([
  "shop.message.created",
  "shop.thread.updated",
  "message.created",
  "message.updated",
  "message.read",
  "typing.updated",
  "room.updated",
  "call.created",
  "call.updated",
  "group_call.created",
  "group_call.updated",
]);

function getRealtimeUrl(ticket: string): string | null {
  const apiBase = getApiBase();
  const origin =
    apiBase ||
    (typeof window !== "undefined" && window.location?.origin ? window.location.origin : "");
  if (!origin) return null;

  const url = new URL("/api/realtime", origin);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  url.searchParams.set("ticket", ticket);
  return url.toString();
}

async function getRealtimeTicket(
  token: string,
  parentSignal: AbortSignal,
): Promise<string | null> {
  try {
    return await runWithAbortDeadline(async (signal) => {
      const response = await fetch(`${getApiBase()}/api/realtime/ticket`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        signal,
      });
      if (!response.ok) return null;
      const payload = (await response.json()) as { ticket?: unknown };
      return typeof payload.ticket === "string" ? payload.ticket : null;
    }, REALTIME_TICKET_TIMEOUT_MS, parentSignal);
  } catch {
    return null;
  }
}

function parseRealtimeEvent(raw: unknown): RealtimeEvent | null {
  if (typeof raw !== "string") return null;
  try {
    const parsed = JSON.parse(raw) as Partial<RealtimeEvent>;
    if (!parsed.type || !EVENT_TYPES.has(parsed.type)) return null;
    return parsed as RealtimeEvent;
  } catch {
    return null;
  }
}

export function useRealtimeInvalidation(): void {
  const { isSignedIn, getToken } = useAuth();
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!isSignedIn || typeof WebSocket === "undefined") return;

    let disposed = false;
    setChatRealtimeConnected(false);
    const invalidations = new ChatInvalidationBatch();
    const deduper = new ChatRealtimeEventDeduper();
    let appActive =
      Platform.OS === "web" ||
      (AppState.currentState !== "background" &&
        AppState.currentState !== "inactive");
    let networkOnline =
      Platform.OS !== "web" ||
      typeof navigator === "undefined" ||
      navigator.onLine !== false;
    const fence = new RealtimeGenerationFence();
    let socketState: { socket: WebSocket; generation: number } | null = null;
    let attemptController: AbortController | null = null;
    let attemptGeneration: number | null = null;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    let socketOpenTimer: ReturnType<typeof setTimeout> | null = null;
    let retryAttempt = 0;

    const invalidateRoomMessages = (roomId: string) => {
      invalidations.enqueue("messages:"+roomId, () => { void queryClient.invalidateQueries({ queryKey: getFetchRoomMessagesQueryKey(roomId) }); });
    };

    const invalidateRoomMeta = (roomId: string) => {
      invalidations.enqueue("room:"+roomId, () => { void queryClient.invalidateQueries({ queryKey: getGetRoomQueryKey(roomId) }); });
      invalidations.enqueue("rooms", () => { void queryClient.invalidateQueries({ queryKey: getListRoomsQueryKey() }); });
    };

    const handleEvent = (event: RealtimeEvent) => {
      if (!deduper.accept(event.type,event.roomId??"",event.data)) return;
      const shop=shopEventTargets(event.type,event.data);
      if(shop){
        invalidations.enqueue(`shop:${shop.shopId}`,()=>{void queryClient.invalidateQueries({predicate:q=>shopQueryAffected(q.queryKey,shop.shopId)});});
        return;
      }
      if(event.data?.exchangeProposalId || event.data?.relayId){void queryClient.invalidateQueries({queryKey:["davaq"]});if(event.roomId)invalidateRoomMessages(event.roomId);}
      if (event.type === "message.created") {
        noteChatRealtimeDeliveryAge(event.createdAt);
      }
      if (event.type.startsWith("group_call.")) {
        void queryClient.invalidateQueries({ queryKey: ["davaq-group-incoming"] });
        void queryClient.invalidateQueries({ queryKey: ["davaq-room-group-call"] });
      }
      if (event.roomId) {
        const roomId = event.roomId;
        if (event.type === "message.created" && event.data?.message) {
          queryClient.setQueriesData<Message[]>({ queryKey: getFetchRoomMessagesQueryKey(roomId) }, current =>
            current ? projectCreatedMessage(current, event.data!.message as unknown as Message, roomId) : current);
        }
        if (event.type === "message.read" && Array.isArray(event.data?.readCursors)) {
          const me = queryClient.getQueryData<{id:string}>(getGetMeQueryKey());
          const own = (event.data.readCursors as ReadCursor[]).find(r=>r.userId===me?.id);
          if (own) {
            queryClient.setQueriesData<ChatRoom[]>({queryKey:getListRoomsQueryKey()}, rooms=>rooms?.map(r=>projectRoomRead(r,roomId,own.lastReadSeq)));
            queryClient.setQueriesData<ChatRoom>({queryKey:getGetRoomQueryKey(roomId)}, r=>r?projectRoomRead(r,roomId,own.lastReadSeq):r);
          }
          queryClient.setQueriesData<Message[]>({ queryKey: getFetchRoomMessagesQueryKey(roomId) }, current =>
            current ? projectReadCursors(current, event.data!.readCursors as ReadCursor[]) : current);
        }
        if (
          event.type === "message.created" ||
          event.type === "message.updated"
        ) {
          invalidateRoomMessages(event.roomId);
          invalidateRoomMeta(event.roomId);
        }
        if (event.type === "message.read") {
          invalidateRoomMessages(event.roomId);
          invalidateRoomMeta(event.roomId);
        }
        if (
          event.type === "room.updated" ||
          event.type === "call.created" ||
          event.type === "call.updated"
        ) {
          invalidateRoomMeta(event.roomId);
        }
        if (event.type === "typing.updated") {
          const explicitExpiry = Date.parse(String(event.data?.expiresAt ?? ""));
          const createdAt = Date.parse(event.createdAt);
          // Current servers attach expiresAt. The createdAt fallback also
          // protects clients during a rolling deploy and for AI typing events.
          const expiresAt = Number.isFinite(explicitExpiry)
            ? explicitExpiry
            : createdAt + 5_000;
          if (Number.isFinite(expiresAt) && expiresAt <= Date.now()) return;
          void queryClient.invalidateQueries({ queryKey: getGetTypingUsersQueryKey(event.roomId) });
        }
      }

      if (event.type === "call.created" || event.type === "call.updated") {
        void queryClient.invalidateQueries({ queryKey: getListIncomingCallsQueryKey() }, { cancelRefetch: false });
        if (event.callId) {
          const callId = event.callId;
          const snapshot = projectRealtimeCall(undefined, callId, event.data?.call);
          const queryKey = getGetCallQueryKey(callId);
          if (snapshot) {
            // The authenticated event already carries the server's call state.
            // Cancel an older HTTP read before applying it so a slow active
            // response cannot overwrite the terminal event after hangup.
            void queryClient.cancelQueries({ queryKey, exact: true }).then(() => {
              if (!disposed) queryClient.setQueryData<Call>(queryKey,
                current => projectRealtimeCall(current, callId, snapshot));
            });
          } else {
            void queryClient.invalidateQueries({ queryKey }, { cancelRefetch: false });
          }
        }
      }
    };

    const connectionAllowed = () =>
      canStartRealtimeConnection({
        online:
          networkOnline &&
          (typeof navigator === "undefined" || navigator.onLine !== false),
        visible:
          Platform.OS !== "web" ||
          typeof document === "undefined" ||
          document.visibilityState === "visible",
        appActive,
      });

    const clearRetryTimer = () => {
      if (retryTimer === null) return;
      clearTimeout(retryTimer);
      retryTimer = null;
      noteChatResource("timers", -1);
    };

    const clearSocketOpenTimer = () => {
      if (socketOpenTimer === null) return;
      clearTimeout(socketOpenTimer);
      socketOpenTimer = null;
      noteChatResource("timers", -1);
    };

    const abortAttempt = () => {
      if (attemptGeneration === null) return;
      if (fence.isCurrent(attemptGeneration)) fence.invalidate();
      attemptGeneration = null;
      const controller = attemptController;
      attemptController = null;
      controller?.abort();
    };

    const closeSocket = () => {
      setChatRealtimeConnected(false);
      const current = socketState;
      if (!current) return;
      socketState = null;
      clearSocketOpenTimer();
      if (fence.isCurrent(current.generation)) fence.invalidate();
      current.socket.onopen = null;
      current.socket.onmessage = null;
      current.socket.onerror = null;
      current.socket.onclose = null;
      if (
        current.socket.readyState === WebSocket.CONNECTING ||
        current.socket.readyState === WebSocket.OPEN
      ) {
        current.socket.close();
      }
    };

    const hasUsableSocket = () => {
      if (!socketState) return false;
      if (
        socketState.socket.readyState === WebSocket.CONNECTING ||
        socketState.socket.readyState === WebSocket.OPEN
      ) {
        return true;
      }
      closeSocket();
      return false;
    };

    let connect: () => Promise<void>;

    const scheduleReconnect = () => {
      if (
        disposed ||
        retryTimer !== null ||
        attemptGeneration !== null ||
        !connectionAllowed() ||
        hasUsableSocket()
      ) {
        return;
      }
      const delay = realtimeReconnectDelayMs(retryAttempt);
      retryAttempt += 1;
      retryTimer = setTimeout(() => {
        retryTimer = null;
        noteChatResource("timers", -1);
        void connect();
      }, delay);
      noteChatResource("timers", 1);
    };

    connect = async () => {
      if (
        disposed ||
        !connectionAllowed() ||
        attemptGeneration !== null ||
        hasUsableSocket()
      ) {
        return;
      }

      clearRetryTimer();
      const generation = fence.begin();
      const controller = new AbortController();
      attemptGeneration = generation;
      attemptController = controller;
      let shouldRetry = false;
      try {
        // getToken is normally cached, but fence it as well so an auth SDK stall
        // cannot monopolise the single logical connection attempt forever.
        const token = await runWithAbortDeadline(
          async () => getToken(),
          REALTIME_TICKET_TIMEOUT_MS,
          controller.signal,
        );
        if (
          disposed ||
          !fence.isCurrent(generation) ||
          !connectionAllowed()
        ) {
          return;
        }
        if (!token) {
          shouldRetry = true;
          return;
        }

        const ticket = await getRealtimeTicket(token, controller.signal);
        if (disposed || !fence.isCurrent(generation)) return;
        if (!connectionAllowed()) return;
        if (!ticket) {
          shouldRetry = true;
          return;
        }
        const url = getRealtimeUrl(ticket);
        if (!url) {
          shouldRetry = true;
          return;
        }

        const socket = new WebSocket(url);
        if (
          disposed ||
          !fence.isCurrent(generation) ||
          !connectionAllowed()
        ) {
          socket.close();
          return;
        }
        socketState = { socket, generation };
        const isCurrentSocket = () =>
          !disposed &&
          fence.isCurrent(generation) &&
          socketState?.socket === socket;

        socket.onopen = () => {
          if (!isCurrentSocket()) {
            socket.close();
            return;
          }
          clearSocketOpenTimer();
          retryAttempt = 0;
          setChatRealtimeConnected(true);
          void queryClient.invalidateQueries({predicate:q=>shopQueryAffected(q.queryKey)});
          // Repair messages/read markers missed while the app was suspended.
          void queryClient.invalidateQueries({ predicate: query => typeof query.queryKey[0] === "string" && /^\/api\/rooms\/[^/]+\/messages$/.test(query.queryKey[0]) });
          void queryClient.invalidateQueries({ queryKey: getListRoomsQueryKey() });
        };
        socket.onmessage = (message) => {
          if (!isCurrentSocket()) return;
          const event = parseRealtimeEvent(message.data);
          if (event) handleEvent(event);
        };
        socket.onclose = () => {
          if (!isCurrentSocket()) return;
          clearSocketOpenTimer();
          socketState = null;
          setChatRealtimeConnected(false);
          fence.invalidate();
          scheduleReconnect();
        };
        socket.onerror = () => {
          if (isCurrentSocket()) socket.close();
        };

        socketOpenTimer = setTimeout(() => {
          if (isCurrentSocket() && socket.readyState !== WebSocket.OPEN) {
            closeSocket();
            scheduleReconnect();
          }
        }, REALTIME_SOCKET_OPEN_TIMEOUT_MS);
        noteChatResource("timers", 1);
      } catch {
        shouldRetry =
          !disposed &&
          fence.isCurrent(generation) &&
          !controller.signal.aborted &&
          connectionAllowed();
      } finally {
        if (attemptGeneration === generation) attemptGeneration = null;
        if (attemptController === controller) attemptController = null;
        if (shouldRetry && fence.isCurrent(generation)) scheduleReconnect();
      }
    };

    const pauseNewConnections = (closeEstablishedSocket: boolean) => {
      clearRetryTimer();
      abortAttempt();
      if (
        closeEstablishedSocket ||
        socketState?.socket.readyState === WebSocket.CONNECTING
      ) {
        closeSocket();
      }
    };

    const reconnectImmediately = () => {
      if (disposed || !connectionAllowed()) return;
      clearRetryTimer();
      if (attemptGeneration !== null || hasUsableSocket()) return;
      void connect();
    };

    let removeEnvironmentListeners = () => {};
    if (Platform.OS === "web" && typeof window !== "undefined") {
      const onOffline = () => {
        networkOnline = false;
        pauseNewConnections(true);
      };
      const onNetworkRestored = () => {
        networkOnline = true;
        reconnectImmediately();
      };
      const onPageShow = () => reconnectImmediately();
      const onVisibilityChange = () => {
        if (document.visibilityState === "visible") reconnectImmediately();
        else pauseNewConnections(true);
      };
      window.addEventListener("online", onNetworkRestored);
      window.addEventListener("offline", onOffline);
      window.addEventListener("pageshow", onPageShow);
      document.addEventListener("visibilitychange", onVisibilityChange);
      noteChatResource("listeners", 4);
      removeEnvironmentListeners = () => {
        window.removeEventListener("online", onNetworkRestored);
        window.removeEventListener("offline", onOffline);
        window.removeEventListener("pageshow", onPageShow);
        document.removeEventListener("visibilitychange", onVisibilityChange);
        noteChatResource("listeners", -4);
      };
    } else {
      const appStateSubscription = AppState.addEventListener("change", (state) => {
        appActive = state === "active";
        if (appActive) reconnectImmediately();
        else pauseNewConnections(true);
      });
      const unsubscribeNetwork = NetInfo.addEventListener((state) => {
        networkOnline =
          state.isConnected !== false && state.isInternetReachable !== false;
        if (networkOnline) reconnectImmediately();
        else pauseNewConnections(true);
      });
      noteChatResource("listeners", 2);
      removeEnvironmentListeners = () => {
        appStateSubscription.remove();
        unsubscribeNetwork();
        noteChatResource("listeners", -2);
      };
    }

    reconnectImmediately();

    return () => {
      disposed = true;
      invalidations.dispose();
      setChatRealtimeConnected(false);
      removeEnvironmentListeners();
      clearRetryTimer();
      abortAttempt();
      closeSocket();
    };
  }, [isSignedIn, getToken, queryClient]);
}
