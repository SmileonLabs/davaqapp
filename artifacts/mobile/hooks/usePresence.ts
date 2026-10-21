import { useEffect, useMemo, useRef } from "react";
import { AppState, Platform } from "react-native";
import { useAuth } from "@/lib/davaqAuth";
import { usePathname } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import { customFetch } from "@workspace/api-client-react";
import { EphemeralRequestGate } from "@/lib/ephemeralRequestGate";
import {
  noteChatPending,
  noteChatResource,
} from "@/lib/chatPerformanceDiagnostics";

const HEARTBEAT_INTERVAL_MS = 25_000;

export interface PresenceState {
  userId: string;
  online: boolean;
  lastSeenAt: string | null;
  platform: string | null;
  roomId: string | null;
}

interface PresenceResponse {
  users: PresenceState[];
}

function getRoomIdFromPath(pathname: string | null): string | null {
  if (!pathname) return null;
  const match = pathname.match(/^\/chat\/([^/?#]+)/);
  return match?.[1] ? decodeURIComponent(match[1]) : null;
}

function getPlatformLabel(): string {
  if (Platform.OS !== "web") return Platform.OS;
  if (typeof window === "undefined") return "web";
  const nav = window.navigator as unknown as { standalone?: boolean };
  const standalone = nav.standalone === true || window.matchMedia("(display-mode: standalone)").matches;
  return standalone ? "pwa" : "web";
}

async function sendPresenceHeartbeat(
  roomId: string | null,
  signal: AbortSignal,
): Promise<void> {
  await customFetch("/api/presence/heartbeat", {
    method: "POST",
    body: JSON.stringify({ roomId, platform: getPlatformLabel() }),
    signal,
  });
}

export function usePresenceHeartbeat(): void {
  const { isSignedIn } = useAuth();
  const pathname = usePathname();
  const roomIdRef = useRef<string | null>(null);
  roomIdRef.current = getRoomIdFromPath(pathname);

  useEffect(() => {
    if (!isSignedIn) return;

    let stopped = false;
    let appActive = true;
    const gate = new EphemeralRequestGate({
      minIntervalMs: 10_000,
      timeoutMs: 6_000,
      onPendingChange: (pending) => noteChatPending("presence", pending ? 1 : -1),
    });
    const beat = () => {
      if (stopped) return;
      if (Platform.OS === "web" && typeof document !== "undefined") {
        if (document.visibilityState !== "visible" || navigator.onLine === false) return;
      } else if (!appActive) {
        return;
      }
      gate.tryRun((signal) => sendPresenceHeartbeat(roomIdRef.current, signal));
    };

    beat();
    const timer = setInterval(beat, HEARTBEAT_INTERVAL_MS);
    noteChatResource("timers", 1);

    if (Platform.OS === "web" && typeof document !== "undefined") {
      const onVisible = () => {
        if (document.visibilityState === "visible") beat();
      };
      document.addEventListener("visibilitychange", onVisible);
      window.addEventListener("pageshow", beat);
      noteChatResource("listeners", 2);
      return () => {
        stopped = true;
        gate.dispose();
        clearInterval(timer);
        document.removeEventListener("visibilitychange", onVisible);
        window.removeEventListener("pageshow", beat);
        noteChatResource("timers", -1);
        noteChatResource("listeners", -2);
      };
    }

    const sub = AppState.addEventListener("change", (state) => {
      appActive = state === "active";
      if (appActive) beat();
    });
    noteChatResource("listeners", 1);
    return () => {
      stopped = true;
      gate.dispose();
      clearInterval(timer);
      sub.remove();
      noteChatResource("timers", -1);
      noteChatResource("listeners", -1);
    };
  }, [isSignedIn]);
}

export const presenceUsersQueryKey = (userIds: string[]) => ["presence", "users", [...userIds].sort().join(",")] as const;

export function usePresenceUsers(userIds: Array<string | null | undefined>) {
  const ids = useMemo(() => Array.from(new Set(userIds.filter((id): id is string => !!id))), [userIds]);
  return useQuery({
    queryKey: presenceUsersQueryKey(ids),
    enabled: ids.length > 0,
    refetchInterval: 15_000,
    queryFn: () =>
      customFetch<PresenceResponse>(`/api/presence/users?ids=${encodeURIComponent(ids.join(","))}`, {
        responseType: "json",
      }),
  });
}
