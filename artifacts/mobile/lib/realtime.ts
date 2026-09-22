import { useEffect } from "react";
import { AppState, Platform } from "react-native";
import NetInfo from "@react-native-community/netinfo";
import { useAuth } from "@clerk/expo";
import { useQueryClient } from "@tanstack/react-query";
import {
  getFetchRoomMessagesQueryKey,
  getGetCallQueryKey,
  getGetRoomQueryKey,
  getGetTypingUsersQueryKey,
  getListIncomingCallsQueryKey,
  getListRoomsQueryKey,
} from "@workspace/api-client-react";
import { getApiBase } from "@/lib/apiBase";
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
  | "message.created"
  | "message.updated"
  | "message.read"
  | "typing.updated"
  | "room.updated"
  | "call.created"
  | "call.updated";

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
  "message.created",
  "message.updated",
  "message.read",
  "typing.updated",
  "room.updated",
  "call.created",
  "call.updated",
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
      void queryClient.invalidateQueries({ queryKey: getFetchRoomMessagesQueryKey(roomId) });
    };

    const invalidateRoomMeta = (roomId: string) => {
      void queryClient.invalidateQueries({ queryKey: getGetRoomQueryKey(roomId) });
      void queryClient.invalidateQueries({ queryKey: getListRoomsQueryKey() });
    };

    const handleEvent = (event: RealtimeEvent) => {
      if(event.data?.exchangeProposalId || event.data?.relayId){void queryClient.invalidateQueries({queryKey:["davaq"]});if(event.roomId)invalidateRoomMessages(event.roomId);}
      if (event.type === "message.created") {
        noteChatRealtimeDeliveryAge(event.createdAt);
      }
      if (event.roomId) {
        if (
          event.type === "message.created" ||
          event.type === "message.updated"
        ) {
          invalidateRoomMessages(event.roomId);
          invalidateRoomMeta(event.roomId);
        }
        if (event.type === "message.read") {
          invalidateRoomMessages(event.roomId);
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
        void queryClient.invalidateQueries({ queryKey: getListIncomingCallsQueryKey() });
        if (event.callId) {
          void queryClient.invalidateQueries({ queryKey: getGetCallQueryKey(event.callId) });
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
        else pauseNewConnections(false);
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
        else pauseNewConnections(false);
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
      removeEnvironmentListeners();
      clearRetryTimer();
      abortAttempt();
      closeSocket();
    };
  }, [isSignedIn, getToken, queryClient]);
}
