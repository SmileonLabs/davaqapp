import { projectRoomRead } from "@/lib/chatUnreadProjection";
import { useFocusEffect } from "expo-router";
import React, { useEffect, useRef, useState } from "react";
import { AppState, Platform, type ViewToken } from "react-native";
import { useQueryClient } from "@tanstack/react-query";
import {
  getListRoomsQueryKey,
  getGetRoomQueryKey,
  type ChatRoom,
  useMarkRoomRead,
  type Message,
} from "@workspace/api-client-react";
import { visibleReadTarget } from "@/lib/chatReadVisibility";
import { clearChatNotifications } from "@/lib/chatNotifications";

export type ScrollPhase = "initializing" | "positioning" | "ready";

export type RoomReadState = {
  unreadCount?: number | null;
  firstUnreadMessageId?: string | null;
};

export function useChatReadTracking({
  roomId,
  room,
  viewerId,
  messages,
  visibleMessages,
  isDungeon,
  scrollPhaseRef,
  stickToBottomRef,
  listReady,
}: {
  roomId: string;
  room: RoomReadState | undefined;
  viewerId: string | undefined;
  messages: readonly Message[];
  visibleMessages: readonly Message[];
  isDungeon: boolean;
  scrollPhaseRef: React.MutableRefObject<ScrollPhase>;
  stickToBottomRef: React.MutableRefObject<boolean>;
  listReady: boolean;
}) {
  const queryClient = useQueryClient();
  const markRead = useMarkRoomRead();
  const [appIsVisible, setAppIsVisible] = useState(() => {
    if (Platform.OS === "web" && typeof document !== "undefined") {
      return document.visibilityState === "visible";
    }
    return AppState.currentState === "active";
  });
  const [screenIsFocused, setScreenIsFocused] = useState(false);
  const visibilityRef = useRef({ active: appIsVisible, focused: screenIsFocused });
  visibilityRef.current = { active: appIsVisible, focused: screenIsFocused };
  const visibleIdsRef = useRef(new Set<string>());
  const messagesRef = useRef(messages);
  messagesRef.current = messages;
  const readTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const entryCapturedRef = useRef(false);
  const lastRealMessageIdRef = useRef<string | null>(null);
  const lastMarkedReadMessageIdRef = useRef<string | null>(null);
  const markReadToMessageRef = useRef<(messageId: string | null) => void>(() => {});
  const viewabilityConfigRef = useRef({ itemVisiblePercentThreshold: 45, minimumViewTime: 120 });
  const [captured, setCaptured] = useState(false);
  const [anchorMsgId, setAnchorMsgId] = useState<string | null>(null);
  const [entryUnreadCount, setEntryUnreadCount] = useState(0);

  useEffect(() => {
    if (Platform.OS === "web" && typeof document !== "undefined") {
      const update = () => {
        const active = document.visibilityState === "visible" && document.hasFocus();
        visibilityRef.current.active = active;
        setAppIsVisible(active);
      };
      update();
      document.addEventListener("visibilitychange", update);
      window.addEventListener("focus", update);
      window.addEventListener("blur", update);
      return () => {
        document.removeEventListener("visibilitychange", update);
        window.removeEventListener("focus", update);
        window.removeEventListener("blur", update);
      };
    }

    const subscription = AppState.addEventListener("change", (state) => {
      visibilityRef.current.active = state === "active";
      setAppIsVisible(state === "active");
    });
    return () => subscription.remove();
  }, []);

  useFocusEffect(
    React.useCallback(() => {
      visibilityRef.current.focused = true;
      setScreenIsFocused(true);
      return () => {
        visibilityRef.current.focused = false;
        setScreenIsFocused(false);
      };
    }, []),
  );


  useEffect(() => {
    entryCapturedRef.current = false;
    lastRealMessageIdRef.current = null;
    lastMarkedReadMessageIdRef.current = null;
    visibleIdsRef.current.clear();
    setCaptured(false);
    setAnchorMsgId(null);
    setEntryUnreadCount(0);
  }, [roomId, viewerId]);

  // Capture the entry read-position once before the server pointer advances.
  useEffect(() => {
    if (entryCapturedRef.current || !room) return;
    const unread = room.unreadCount ?? 0;
    let anchor: string | null = null;
    if (!isDungeon && unread > 0) {
      if (visibleMessages.length === 0) return;
      const firstUnreadMessageId = room.firstUnreadMessageId ?? null;
      if (firstUnreadMessageId && visibleMessages.some((message) => message.id === firstUnreadMessageId)) {
        anchor = firstUnreadMessageId;
      } else if (firstUnreadMessageId) {
        anchor = visibleMessages[0]?.id ?? null;
      }
    }
    entryCapturedRef.current = true;
    setAnchorMsgId(anchor);
    setEntryUnreadCount(isDungeon ? 0 : unread);
    setCaptured(true);
  }, [isDungeon, room, visibleMessages]);

  // The newest persisted id must ignore optimistic rows: those ids do not exist
  // server-side, and an optimistic-to-real replacement need not change length.
  const lastRealMessageId = React.useMemo(() => {
    for (let index = messages.length - 1; index >= 0; index--) {
      if (!String(messages[index].id).startsWith("temp-")) return messages[index].id;
    }
    return null;
  }, [messages]);

  useEffect(() => {
    lastRealMessageIdRef.current = lastRealMessageId;
  }, [lastRealMessageId]);

  const markReadToMessage = React.useCallback(
    (messageId: string | null) => {
      if (!viewerId || !messageId || !visibilityRef.current.active || !visibilityRef.current.focused ||
          scrollPhaseRef.current !== "ready" || !visibleIdsRef.current.has(messageId)) return;
      if (lastMarkedReadMessageIdRef.current === messageId) return;
      lastMarkedReadMessageIdRef.current = messageId;

      const target = messagesRef.current.find(message => message.id === messageId);
      markRead.mutate(
        { id: roomId, data: { messageId } },
        {
          onSuccess: () => {
            if (target?.roomSeq) {
              queryClient.setQueriesData<ChatRoom[]>({queryKey:getListRoomsQueryKey()}, rooms => rooms?.map(r => projectRoomRead(r,roomId,target.roomSeq)));
              queryClient.setQueriesData<ChatRoom>({queryKey:getGetRoomQueryKey(roomId)}, r => r ? projectRoomRead(r,roomId,target.roomSeq) : r);
            }
            void clearChatNotifications(roomId, { readThroughSeq: target?.roomSeq, readThroughAt: target?.createdAt, ownerId: viewerId });
            void queryClient.invalidateQueries({ queryKey: getListRoomsQueryKey() });
          },
          onError: () => {
            if (lastMarkedReadMessageIdRef.current === messageId) {
              lastMarkedReadMessageIdRef.current = null;
            }
          },
        },
      );
    },
    [appIsVisible, markRead, queryClient, roomId, screenIsFocused, viewerId],
  );

  useEffect(() => {
    markReadToMessageRef.current = markReadToMessage;
  }, [markReadToMessage]);

  const scheduleVisibleRead = React.useCallback(() => {
    if (readTimerRef.current) clearTimeout(readTimerRef.current);
    readTimerRef.current = setTimeout(() => {
      readTimerRef.current = null;
      const target = visibleReadTarget(messagesRef.current, visibleIdsRef.current, {
        ...visibilityRef.current, ready: scrollPhaseRef.current === "ready",
      });
      if (target) markReadToMessageRef.current(target.id);
    }, 300);
  }, [scrollPhaseRef]);

  useEffect(() => {
    scheduleVisibleRead();
    return () => {
      if (readTimerRef.current) clearTimeout(readTimerRef.current);
    };
  }, [appIsVisible, screenIsFocused, lastRealMessageId, listReady, roomId, viewerId, scheduleVisibleRead]);

  const onViewableItemsChanged = React.useCallback(({ viewableItems }: { viewableItems: ViewToken[] }) => {
    visibleIdsRef.current = new Set(viewableItems
      .filter((entry) => entry.isViewable)
      .map((entry) => (entry.item as Message).id));
    scheduleVisibleRead();
  }, [scheduleVisibleRead]);

  const markLatestRead = scheduleVisibleRead;

  const clearEntryUnread = React.useCallback(() => {
    setEntryUnreadCount(0);
  }, []);

  return {
    captured,
    anchorMsgId,
    entryUnreadCount,
    lastRealMessageId,
    clearEntryUnread,
    markLatestRead,
    onViewableItemsChanged,
    viewabilityConfig: viewabilityConfigRef.current,
  };
}
