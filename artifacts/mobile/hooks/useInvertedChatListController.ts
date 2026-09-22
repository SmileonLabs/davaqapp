import React, { useEffect, useRef, useState } from "react";
import { Animated, FlatList, type FlatListProps } from "react-native";
import { type Message } from "@workspace/api-client-react";
import {
  useChatReadTracking,
  type RoomReadState,
  type ScrollPhase,
} from "@/hooks/useChatReadTracking";

const SCROLLBAR_PAD = 4;
const SCROLLBAR_MIN_THUMB = 36;

type ListProps = FlatListProps<Message>;

export function useInvertedChatListController({
  roomId,
  room,
  viewerId,
  messages,
  visibleMessages,
  listMessages,
  isDungeon,
  onInitialScrollReady,
}: {
  roomId: string;
  room: RoomReadState | undefined;
  viewerId: string | undefined;
  messages: readonly Message[];
  visibleMessages: readonly Message[];
  listMessages: readonly Message[];
  isDungeon: boolean;
  onInitialScrollReady: () => void;
}) {
  const listRef = useRef<FlatList<Message>>(null);
  const listMessagesRef = useRef(listMessages);
  listMessagesRef.current = listMessages;
  const didInitialScrollRef = useRef(false);
  const scrollPhaseRef = useRef<ScrollPhase>("initializing");
  const stickToBottomRef = useRef(true);
  const [listReady, setListReady] = useState(false);
  const [showScrollDown, setShowScrollDown] = useState(false);
  const [scrollTrack, setScrollTrack] = useState({ top: 0, height: 0 });
  const scrollThumbHeight = useRef(new Animated.Value(0)).current;
  const scrollThumbY = useRef(new Animated.Value(0)).current;
  const scrollbarOpacity = useRef(new Animated.Value(0)).current;
  const scrollbarVisibleRef = useRef(false);
  const scrollbarHideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const scrollFrame = useRef<number | null>(null);
  const cancelScheduledScroll = React.useCallback(() => {
    if (scrollFrame.current !== null) {
      cancelAnimationFrame(scrollFrame.current);
      scrollFrame.current = null;
    }
  }, []);
  useEffect(() => cancelScheduledScroll, [roomId, cancelScheduledScroll]);
  const scrollToBottom = React.useCallback((animated = false) => {
    // One pending frame for layout, optimistic delivery and content-size updates.
    if (scrollFrame.current !== null) return;
    scrollFrame.current = requestAnimationFrame(() => {
      scrollFrame.current = requestAnimationFrame(() => {
        scrollFrame.current = null;
        if (stickToBottomRef.current)
          listRef.current?.scrollToOffset({ offset: 0, animated });
      });
    });
  }, []);

  const hideScrollbarNow = React.useCallback(
    (animated: boolean) => {
      if (scrollbarHideTimer.current) {
        clearTimeout(scrollbarHideTimer.current);
        scrollbarHideTimer.current = null;
      }
      scrollbarVisibleRef.current = false;
      scrollbarOpacity.stopAnimation();
      if (animated) {
        Animated.timing(scrollbarOpacity, {
          toValue: 0,
          duration: 300,
          useNativeDriver: true,
        }).start();
      } else {
        scrollbarOpacity.setValue(0);
      }
    },
    [scrollbarOpacity],
  );

  const updateScrollbar = React.useCallback(
    (offsetY: number, contentHeight: number, viewHeight: number) => {
      if (contentHeight <= viewHeight + 1 || viewHeight <= 0) {
        if (scrollbarVisibleRef.current) hideScrollbarNow(false);
        return;
      }
      const trackHeight = Math.max(0, viewHeight - SCROLLBAR_PAD * 2);
      const thumbHeight = Math.max(
        SCROLLBAR_MIN_THUMB,
        (viewHeight / contentHeight) * trackHeight,
      );
      const maxOffset = contentHeight - viewHeight;
      const maxThumbY = Math.max(0, trackHeight - thumbHeight);
      const ratio =
        maxOffset > 0 ? Math.min(1, Math.max(0, offsetY / maxOffset)) : 0;
      // Inverted data puts the newest row at offset 0, so the thumb mapping is reversed.
      const visualRatio = 1 - ratio;
      scrollThumbHeight.setValue(thumbHeight);
      scrollThumbY.setValue(SCROLLBAR_PAD + visualRatio * maxThumbY);
      if (!scrollbarVisibleRef.current) {
        scrollbarVisibleRef.current = true;
        scrollbarOpacity.stopAnimation();
        scrollbarOpacity.setValue(1);
      }
      if (scrollbarHideTimer.current) clearTimeout(scrollbarHideTimer.current);
      scrollbarHideTimer.current = setTimeout(
        () => hideScrollbarNow(true),
        250,
      );
    },
    [hideScrollbarNow, scrollThumbHeight, scrollThumbY, scrollbarOpacity],
  );

  useEffect(
    () => () => {
      if (scrollbarHideTimer.current) clearTimeout(scrollbarHideTimer.current);
    },
    [],
  );

  const markScrollReady = React.useCallback(() => {
    scrollPhaseRef.current = "ready";
    setListReady(true);
    onInitialScrollReady();
  }, [onInitialScrollReady]);

  // Keep the list hidden through one offset-0 paint so opening a room cannot flash
  // at the oldest row. The timer handles empty lists whose layout events never fire.
  useEffect(() => {
    scrollPhaseRef.current = "initializing";
    didInitialScrollRef.current = false;
    stickToBottomRef.current = true;
    setShowScrollDown(false);
    setListReady(false);
    hideScrollbarNow(false);
    const timer = setTimeout(() => {
      if (didInitialScrollRef.current) return;
      didInitialScrollRef.current = true;
      scrollToBottom(false);
      markScrollReady();
    }, 1500);
    return () => clearTimeout(timer);
  }, [hideScrollbarNow, markScrollReady, roomId, scrollToBottom]);

  const {
    captured,
    anchorMsgId,
    entryUnreadCount,
    lastRealMessageId,
    clearEntryUnread,
    markLatestRead,
    onViewableItemsChanged,
    viewabilityConfig,
  } = useChatReadTracking({
    roomId,
    room,
    viewerId,
    messages,
    visibleMessages,
    isDungeon,
    scrollPhaseRef,
    stickToBottomRef,
    listReady,
  });

  useEffect(() => {
    if (!captured || didInitialScrollRef.current) return;
    scrollPhaseRef.current = "positioning";
    didInitialScrollRef.current = true;
    stickToBottomRef.current = true;
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        listRef.current?.scrollToOffset({ offset: 0, animated: false });
        setShowScrollDown(false);
        requestAnimationFrame(markScrollReady);
      }),
    );
  }, [captured, markScrollReady]);

  useEffect(() => {
    if (scrollPhaseRef.current !== "ready") return;
    if (visibleMessages.length > 0 && stickToBottomRef.current)
      scrollToBottom(false);
  }, [scrollToBottom, visibleMessages.length]);

  const forceStickToBottom = React.useCallback(() => {
    stickToBottomRef.current = true;
    setShowScrollDown(false);
  }, []);

  const jumpToBottom = React.useCallback(() => {
    stickToBottomRef.current = true;
    setShowScrollDown(false);
    scrollToBottom(true);
  }, [scrollToBottom]);

  const scrollToMessage = React.useCallback(
    (messageId: string) => {
      const index = listMessagesRef.current.findIndex(
        (message) => message.id === messageId,
      );
      if (index < 0) return false;
      cancelScheduledScroll();
      stickToBottomRef.current = false;
      setShowScrollDown(true);
      listRef.current?.scrollToIndex({
        index,
        animated: true,
        viewPosition: 0.5,
      });
      return true;
    },
    [cancelScheduledScroll],
  );

  const onScrollToIndexFailed = React.useCallback<
    NonNullable<ListProps["onScrollToIndexFailed"]>
  >(
    (info) => {
      setTimeout(() => {
        try {
          listRef.current?.scrollToIndex({
            index: info.index,
            animated: false,
            viewPosition: 0.5,
          });
        } catch {
          const fallbackIndex = Math.max(
            0,
            Math.min(info.index, Math.max(0, info.highestMeasuredFrameIndex)),
          );
          try {
            listRef.current?.scrollToIndex({
              index: fallbackIndex,
              animated: false,
              viewPosition: 0.5,
            });
          } catch {}
        }
        if (scrollPhaseRef.current === "positioning")
          requestAnimationFrame(markScrollReady);
      }, 60);
    },
    [markScrollReady],
  );

  const onContentSizeChange = React.useCallback<
    NonNullable<ListProps["onContentSizeChange"]>
  >(() => {
    if (scrollPhaseRef.current === "ready" && stickToBottomRef.current)
      scrollToBottom(false);
  }, [scrollToBottom]);

  const onScroll = React.useCallback<NonNullable<ListProps["onScroll"]>>(
    (event) => {
      const { contentOffset, contentSize, layoutMeasurement } =
        event.nativeEvent;
      if (scrollPhaseRef.current !== "ready") return;
      // Inverted FlatList: offset 0 is the visual bottom/latest message.
      const nearBottom = Math.max(0, contentOffset.y) < 120;
      stickToBottomRef.current = nearBottom;
      if (!nearBottom) cancelScheduledScroll();
      setShowScrollDown((previous) =>
        previous === !nearBottom ? previous : !nearBottom,
      );
      if (nearBottom) markLatestRead();
      if (listReady)
        updateScrollbar(
          contentOffset.y,
          contentSize.height,
          layoutMeasurement.height,
        );
    },
    [listReady, markLatestRead, updateScrollbar, cancelScheduledScroll],
  );

  const onLayout = React.useCallback<NonNullable<ListProps["onLayout"]>>(
    (event) => {
      const { y, height } = event.nativeEvent.layout;
      setScrollTrack((previous) =>
        previous.top === y && previous.height === height
          ? previous
          : { top: y, height },
      );
      if (scrollPhaseRef.current === "ready" && stickToBottomRef.current)
        scrollToBottom(false);
    },
    [scrollToBottom],
  );

  return {
    listRef,
    listReady,
    showScrollDown,
    scrollToBottom,
    scrollToMessage,
    forceStickToBottom,
    jumpToBottom,
    lastRealMessageId,
    anchorMsgId,
    entryUnreadCount,
    clearEntryUnread,
    onScroll,
    onLayout,
    onContentSizeChange,
    onScrollToIndexFailed,
    onViewableItemsChanged,
    viewabilityConfig,
    scrollbar: {
      track: scrollTrack,
      opacity: scrollbarOpacity,
      thumbHeight: scrollThumbHeight,
      thumbY: scrollThumbY,
    },
  };
}
