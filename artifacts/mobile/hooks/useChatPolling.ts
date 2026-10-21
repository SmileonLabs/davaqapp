import { useSyncExternalStore } from "react";
import { getChatRealtimeConnected, subscribeChatRealtimeStatus, chatMessagePollInterval } from "@/lib/chatRealtimeStatus";
import { useCallback, useEffect, useRef } from "react";
import NetInfo from "@react-native-community/netinfo";
import { useFocusEffect } from "expo-router";
import { AppState, Platform } from "react-native";
import { noteChatResource } from "@/lib/chatPerformanceDiagnostics";

type Refetch = () => unknown;

function canPollNow(): boolean {
  if (Platform.OS !== "web") return AppState.currentState === "active";
  if (typeof document === "undefined") return false;
  return document.visibilityState === "visible" && navigator.onLine !== false;
}

export function useChatPolling({
  isDungeon,
  dungeonThinking,
  hasTypingUsers = false,
  refetchMessages,
  refetchTyping,
  refetchDungeon,
}: {
  isDungeon: boolean;
  dungeonThinking: boolean;
  hasTypingUsers?: boolean;
  refetchMessages: Refetch;
  refetchTyping: Refetch;
  refetchDungeon: Refetch;
}) {
  const live = useSyncExternalStore(subscribeChatRealtimeStatus,getChatRealtimeConnected,()=>false);
  const focused = useRef(false);
  const online = useRef(true);
  const canPoll = () => online.current && canPollNow();
  useFocusEffect(useCallback(() => {
    focused.current = true;
    if (canPoll()) {
      void refetchMessages();
      void refetchTyping();
      if (isDungeon) void refetchDungeon();
    }
    return () => { focused.current = false; };
  }, [isDungeon, refetchMessages, refetchTyping, refetchDungeon]));
  useEffect(() => {
    // Realtime invalidates immediately; this catches reconnect gaps and older
    // deployments where a socket event is missed.
    const timer = setInterval(() => {
      if (focused.current && canPoll()) void refetchMessages();
    }, chatMessagePollInterval(live));
    noteChatResource("timers", 1);
    return () => {
      clearInterval(timer);
      noteChatResource("timers", -1);
    };
  }, [refetchMessages, live]);

  useEffect(() => {
    // Once a realtime typing event reveals a user, keep TTL cleanup polling
    // until the list empties. Idle connected conversations need no typing GET.
    if (live && !hasTypingUsers) return;
    const timer = setInterval(() => {
      if (focused.current && canPoll()) void refetchTyping();
    }, 5_000);
    noteChatResource("timers", 1);
    return () => {
      clearInterval(timer);
      noteChatResource("timers", -1);
    };
  }, [refetchTyping, live, hasTypingUsers]);

  useEffect(() => {
    if (!isDungeon || !dungeonThinking) return;
    const timer = setInterval(() => {
      if (!focused.current || !canPoll()) return;
      void refetchMessages();
      void refetchDungeon();
    }, 1_200);
    noteChatResource("timers", 1);
    return () => {
      clearInterval(timer);
      noteChatResource("timers", -1);
    };
  }, [dungeonThinking, isDungeon, refetchDungeon, refetchMessages]);

  useEffect(() => {
    const catchUp = () => {
      if (!focused.current || !canPoll()) return;
      void refetchMessages();
      void refetchTyping();
      if (isDungeon) void refetchDungeon();
    };
    if (Platform.OS !== "web") {
      const subscription = AppState.addEventListener("change", (state) => {
        if (state === "active") catchUp();
      });
      const unsubscribeNetwork = NetInfo.addEventListener(state => {
        const wasOnline = online.current;
        online.current = state.isConnected !== false && state.isInternetReachable !== false;
        if (!wasOnline && online.current) catchUp();
      });
      return () => { subscription.remove(); unsubscribeNetwork(); };
    }
    if (typeof window === "undefined") return;
    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") catchUp();
    };
    window.addEventListener("online", catchUp);
    window.addEventListener("pageshow", catchUp);
    document.addEventListener("visibilitychange", onVisibilityChange);
    noteChatResource("listeners", 3);
    return () => {
      window.removeEventListener("online", catchUp);
      window.removeEventListener("pageshow", catchUp);
      document.removeEventListener("visibilitychange", onVisibilityChange);
      noteChatResource("listeners", -3);
    };
  }, [isDungeon, refetchDungeon, refetchMessages, refetchTyping]);
}
