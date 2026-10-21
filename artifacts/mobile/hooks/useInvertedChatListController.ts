import React, { useEffect, useRef, useState } from "react";
import { Animated, FlatList, Keyboard, Platform, type FlatListProps } from "react-native";
import { type Message } from "@workspace/api-client-react";
import {
  useChatReadTracking,
  type RoomReadState,
  type ScrollPhase,
} from "@/hooks/useChatReadTracking";

import type { ChatReadingPosition } from "@/lib/chatReadingPosition";

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
  messagesReady = true,
  positionReady = true,
  readingPosition = null,
  savePosition,
  loadOlder,
  hasOlder = false,
  positionScope = roomId,
}: {
  roomId: string;
  room: RoomReadState | undefined;
  viewerId: string | undefined;
  messages: readonly Message[];
  visibleMessages: readonly Message[];
  listMessages: readonly Message[];
  isDungeon: boolean;
  onInitialScrollReady: () => void;
  messagesReady?: boolean;
  positionReady?: boolean;
  readingPosition?: ChatReadingPosition | null;
  savePosition?: (position: ChatReadingPosition) => void;
  loadOlder?: () => Promise<number>;
  hasOlder?: boolean;
  positionScope?: string;
}) {
  const isWeb = Platform.OS === "web";
  const listRef = useRef<FlatList<Message>>(null);
  const listMessagesRef = useRef(listMessages);
  listMessagesRef.current = listMessages;
  const didInitialScrollRef = useRef(false);
  const scrollPhaseRef = useRef<ScrollPhase>("initializing");
  const stickToBottomRef = useRef(true);
  const jumpingToLatestRef = useRef(false);
  const userScrollingRef = useRef(false);
  const scrollIntentRef = useRef(0);
  const [listReady, setListReady] = useState(false);
  const [showScrollDown, setShowScrollDown] = useState(false);
  const [hasNewMessages, setHasNewMessages] = useState(false);
  const latestSeenRef = useRef<{ roomId: string; id: string } | null>(null);
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
          if (isWeb) listRef.current?.scrollToEnd({ animated });
          else listRef.current?.scrollToOffset({ offset: 0, animated });
      });
    });
  }, []);

  useEffect(() => {
    const settle = () => {
      if (stickToBottomRef.current) scrollToBottom(false);
    };
    const shown = Keyboard.addListener("keyboardDidShow", settle);
    const hidden = Keyboard.addListener("keyboardDidHide", settle);
    return () => { shown.remove(); hidden.remove(); };
  }, [scrollToBottom]);

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
      const visualRatio = isWeb ? ratio : 1 - ratio;
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

  useEffect(() => {
    scrollPhaseRef.current = "initializing";
    didInitialScrollRef.current = false;
    jumpingToLatestRef.current = false;
    userScrollingRef.current = false;
    scrollIntentRef.current += 1;
    stickToBottomRef.current = true;
    setShowScrollDown(false);
    setHasNewMessages(false);
    setListReady(false);
    hideScrollbarNow(false);
  }, [hideScrollbarNow, positionScope]);

  const {
    anchorMsgId,
    entryUnreadCount,
    lastRealMessageId,
    clearEntryUnread,
    markLatestRead,
    onViewableItemsChanged: trackViewableItems,
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

  const [restoreTick, setRestoreTick] = useState(0);
  const [restoreError, setRestoreError] = useState("");
  const restoringRef = useRef(false);
  const positionScopeRef = useRef(positionScope); positionScopeRef.current = positionScope;
  const attemptsRef = useRef(0);
  const activePositionRef = useRef<ChatReadingPosition | null>(null);
  const expectedPositionRef = useRef<{ id: string; index: number; tries: number } | null>(null);
  const indexRetryTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const metricsRef = useRef({ offset: 0, height: 0 });
  const prependRef = useRef<{ offset: number; height: number; oldestId: string | undefined } | null>(null);
  const savePositionRef = useRef(savePosition); savePositionRef.current = savePosition;
  const onViewableItemsChanged = React.useCallback((info: Parameters<NonNullable<ListProps["onViewableItemsChanged"]>>[0]) => {
    trackViewableItems?.(info);
    if (scrollPhaseRef.current === "positioning" && expectedPositionRef.current && info.viewableItems.some(v => v.isViewable && v.item.id === expectedPositionRef.current?.id)) {
      expectedPositionRef.current = null;
      if (indexRetryTimer.current) clearTimeout(indexRetryTimer.current);
      markScrollReady();
    }
    if (scrollPhaseRef.current !== "ready") return;
    const visible = info.viewableItems.filter(v => v.isViewable && (v.item as Message).roomSeq > 0)
      .sort((a, b) => isWeb ? (a.index ?? 0) - (b.index ?? 0) : (b.index ?? 0) - (a.index ?? 0));
    const item = visible[0]?.item as Message | undefined;
    if (item) {
      const position = { messageId: item.id, roomSeq: item.roomSeq, atLatest: stickToBottomRef.current, savedAt: Date.now() };
      activePositionRef.current = position;
      savePositionRef.current?.(position);
    }
  }, [trackViewableItems, markScrollReady]);
  const loadPrevious = React.useCallback(async () => {
    if (!loadOlder) return 0;
    if (isWeb && !stickToBottomRef.current && !prependRef.current) prependRef.current = { ...metricsRef.current, oldestId: listMessagesRef.current[0]?.id };
    try { const count = await loadOlder(); if (!count) prependRef.current = null; return count; }
    catch (error) { prependRef.current = null; throw error; }
  }, [loadOlder]);
  useEffect(() => {
    activePositionRef.current = null;
    attemptsRef.current = 0;
    restoringRef.current = false;
    prependRef.current = null;
    expectedPositionRef.current = null;
    if (indexRetryTimer.current) clearTimeout(indexRetryTimer.current);
    setRestoreError("");
  }, [positionScope]);
  useEffect(() => {
    if (!messagesReady || !positionReady || restoringRef.current || restoreError) return;
    // An authoritative reset may evict the currently read history window.
    // Re-fetch it, instead of letting the list jump to the latest fifty rows.
    if (didInitialScrollRef.current && !stickToBottomRef.current && activePositionRef.current &&
        !listMessages.some(m => m.id === activePositionRef.current?.messageId)) {
      didInitialScrollRef.current = false;
      scrollPhaseRef.current = "initializing";
      setListReady(false);
    }
    if (didInitialScrollRef.current) return;
    const position = activePositionRef.current ?? readingPosition;
    const target = position && !position.atLatest ? position : null;
    const index = target ? listMessages.findIndex(m => m.id === target.messageId) : -1;
    const oldest = Math.min(...listMessages.filter(m => m.roomSeq > 0).map(m => m.roomSeq));
    if (target && index < 0 && Number.isFinite(oldest) && oldest > target.roomSeq && hasOlder && loadOlder) {
      if (attemptsRef.current >= 20) { setRestoreError("이전 위치까지 메시지를 더 불러와야 합니다."); return; }
      attemptsRef.current++;
      restoringRef.current = true;
      const requestScope = positionScope;
      const requestIntent = scrollIntentRef.current;
      void loadOlder().catch(() => { if (positionScopeRef.current === requestScope && scrollIntentRef.current === requestIntent) setRestoreError("읽던 위치를 불러오지 못했습니다."); }).finally(() => {
        if (positionScopeRef.current !== requestScope) return;
        restoringRef.current = false;
        if (scrollIntentRef.current === requestIntent) setRestoreTick(t => t + 1);
      });
      return;
    }
    scrollPhaseRef.current = "positioning";
    didInitialScrollRef.current = true;
    stickToBottomRef.current = !target;
    let cancelled = false;
    requestAnimationFrame(() => requestAnimationFrame(() => {
      if (cancelled) return;
      if (target && listMessages.length) {
        // Deleted/hidden album members fall back to the closest retained sequence.
        const nearest = index >= 0 ? index : listMessages.reduce((best, m, i) =>
          Math.abs(m.roomSeq - target.roomSeq) < Math.abs(listMessages[best].roomSeq - target.roomSeq) ? i : best, 0);
        expectedPositionRef.current = { id: listMessages[nearest].id, index: nearest, tries: 0 };
        listRef.current?.scrollToIndex({ index: nearest, animated: false, viewPosition: isWeb ? 0 : 1 });
        // scrollToIndex reports an unmeasured row synchronously. Very tall rows
        // may never meet the read-receipt viewability percentage, so readiness
        // must also accept a measured, successful positioning operation.
        if (!indexRetryTimer.current) expectedPositionRef.current = null;
      } else if (isWeb) listRef.current?.scrollToEnd({ animated: false });
      else listRef.current?.scrollToOffset({ offset: 0, animated: false });
      setShowScrollDown(!!target);
      setHasNewMessages(false);
      requestAnimationFrame(() => { if (!cancelled && !expectedPositionRef.current) markScrollReady(); });
    }));
    return () => {
      cancelled = true;
      if (scrollPhaseRef.current !== "ready") {
        didInitialScrollRef.current = false;
        expectedPositionRef.current = null;
        if (indexRetryTimer.current) { clearTimeout(indexRetryTimer.current); indexRetryTimer.current = null; }
      }
    };
  }, [messagesReady, positionReady, readingPosition, listMessages, hasOlder, loadOlder, restoreTick, restoreError, roomId, positionScope, markScrollReady]);
  const retryRestore = React.useCallback(() => { didInitialScrollRef.current = false; expectedPositionRef.current = null; attemptsRef.current = 0; setRestoreError(""); setRestoreTick(t => t + 1); }, []);
  useEffect(() => () => { if (indexRetryTimer.current) clearTimeout(indexRetryTimer.current); }, [positionScope]);
  const skipRestore = React.useCallback(() => {
    scrollIntentRef.current += 1;
    didInitialScrollRef.current = true;
    expectedPositionRef.current = null;
    activePositionRef.current = null;
    if (indexRetryTimer.current) clearTimeout(indexRetryTimer.current);
    setRestoreError("");
    stickToBottomRef.current = true;
    markScrollReady();
    scrollToBottom(false);
  }, [markScrollReady, scrollToBottom]);

  useEffect(() => {
    if (scrollPhaseRef.current !== "ready") return;
    if (visibleMessages.length > 0 && stickToBottomRef.current)
      scrollToBottom(false);
  }, [scrollToBottom, visibleMessages.length]);

  useEffect(() => {
    const persisted = messages.filter(
      (message) => !message.id.startsWith("temp-"),
    );
    const latest = persisted[persisted.length - 1];
    if (!latest) return;
    const previous = latestSeenRef.current;
    latestSeenRef.current = { roomId, id: latest.id };
    if (!previous || previous.roomId !== roomId || previous.id === latest.id)
      return;
    const previousIndex = persisted.findIndex(
      (message) => message.id === previous.id,
    );
    // History pagination and replacement windows must not count as incoming delivery.
    if (previousIndex < 0) return;
    const incoming = persisted
      .slice(previousIndex + 1)
      .some((message) => message.senderId !== viewerId);
    if (incoming && !stickToBottomRef.current) setHasNewMessages(true);
  }, [messages, roomId, viewerId]);

  const forceStickToBottom = React.useCallback(() => {
    // Sending is an explicit navigation to the latest row, including while an
    // older reading position is still being restored.
    scrollIntentRef.current += 1;
    didInitialScrollRef.current = true;
    expectedPositionRef.current = null;
    activePositionRef.current = null;
    if (indexRetryTimer.current) clearTimeout(indexRetryTimer.current);
    setRestoreError("");
    markScrollReady();
    userScrollingRef.current = false;
    stickToBottomRef.current = true;
    setShowScrollDown(false);
    setHasNewMessages(false);
    scrollToBottom(false);
  }, [scrollToBottom, markScrollReady]);

  const jumpToBottom = React.useCallback(() => {
    cancelScheduledScroll();
    scrollIntentRef.current += 1;
    jumpingToLatestRef.current = true;
    activePositionRef.current = null;
    prependRef.current = null;
    stickToBottomRef.current = true;
    if (isWeb) listRef.current?.scrollToEnd({ animated: true });
    else listRef.current?.scrollToOffset({ offset: 0, animated: true });
  }, [cancelScheduledScroll]);

  const onScrollBeginDrag = React.useCallback(() => {
    prependRef.current = null;
    jumpingToLatestRef.current = false;
    userScrollingRef.current = true;
    if (isWeb) stickToBottomRef.current = false;
    scrollIntentRef.current += 1;
    cancelScheduledScroll();
  }, [cancelScheduledScroll]);

  const wheelTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onWebWheel = React.useCallback(() => {
    onScrollBeginDrag();
    if (wheelTimerRef.current) clearTimeout(wheelTimerRef.current);
    wheelTimerRef.current = setTimeout(() => {
      userScrollingRef.current = false;
      wheelTimerRef.current = null;
    }, 180);
  }, [onScrollBeginDrag]);
  useEffect(() => () => {
    if (wheelTimerRef.current) clearTimeout(wheelTimerRef.current);
  }, [roomId]);

  const onScrollEndDrag = React.useCallback(() => {
    userScrollingRef.current = false;
  }, []);
  const onMomentumScrollBegin = React.useCallback(() => {
    userScrollingRef.current = true;
  }, []);
  const onMomentumScrollEnd = onScrollEndDrag;

  const scrollToMessage = React.useCallback(
    (messageId: string) => {
      const index = listMessagesRef.current.findIndex(
        (message) => message.id === messageId,
      );
      if (index < 0) return false;
      cancelScheduledScroll();
      scrollIntentRef.current += 1;
      jumpingToLatestRef.current = false;
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
      const intent = scrollIntentRef.current;
      if (indexRetryTimer.current) clearTimeout(indexRetryTimer.current);
      const expected = expectedPositionRef.current;
      if (expected && expected.tries++ >= 5) { setRestoreError("읽던 메시지 위치를 표시하지 못했습니다."); return; }
      // Bring an unmeasured row into the render window before retrying its exact index.
      listRef.current?.scrollToOffset({ offset: Math.max(0, info.averageItemLength * info.index), animated: false });
      indexRetryTimer.current = setTimeout(() => {
        indexRetryTimer.current = null;
        if (intent !== scrollIntentRef.current || jumpingToLatestRef.current)
          return;
        try {
          listRef.current?.scrollToIndex({
            index: info.index,
            animated: false,
            viewPosition: expected ? (isWeb ? 0 : 1) : 0.5,
          });
          if (expected && !indexRetryTimer.current) expectedPositionRef.current = null;
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
        if (scrollPhaseRef.current === "positioning" && !expectedPositionRef.current)
          requestAnimationFrame(markScrollReady);
      }, 60);
    },
    [markScrollReady],
  );

  const onContentSizeChange = React.useCallback<
    NonNullable<ListProps["onContentSizeChange"]>
  >((_width, height) => {
    const prepend = prependRef.current;
    if (isWeb && prepend && listMessagesRef.current[0]?.id !== prepend.oldestId && height !== prepend.height) {
      prependRef.current = null;
      if (!stickToBottomRef.current) listRef.current?.scrollToOffset({ offset: Math.max(0, prepend.offset + height - prepend.height), animated: false });
    }
    metricsRef.current.height = height;
    if (scrollPhaseRef.current === "ready" && stickToBottomRef.current)
      scrollToBottom(false);
  }, [scrollToBottom]);

  const onScroll = React.useCallback<NonNullable<ListProps["onScroll"]>>(
    (event) => {
      const { contentOffset, contentSize, layoutMeasurement } =
        event.nativeEvent;
      metricsRef.current = { offset: contentOffset.y, height: contentSize.height };
      if (scrollPhaseRef.current !== "ready") return;
      // Inverted FlatList: offset 0 is the visual bottom/latest message.
      const distanceFromLatest = isWeb
        ? contentSize.height - layoutMeasurement.height - contentOffset.y
        : contentOffset.y;
      const nearBottom = Math.max(0, distanceFromLatest) < 48;
      if (jumpingToLatestRef.current && !nearBottom) return;
      jumpingToLatestRef.current = false;
      // Keyboard/composer resizing can emit offsets before the layout settles.
      // Only a drag may take a following conversation away from the latest row.
      if (stickToBottomRef.current && !nearBottom && !userScrollingRef.current) {
        if (!isWeb) scrollToBottom(false);
        return;
      }
      stickToBottomRef.current = nearBottom;
      if (!nearBottom) cancelScheduledScroll();
      else {
        const latest = listMessagesRef.current[isWeb ? listMessagesRef.current.length - 1 : 0];
        if (latest?.roomSeq > 0) savePositionRef.current?.({ messageId: latest.id, roomSeq: latest.roomSeq, atLatest: true, savedAt: Date.now() });
      }
      setShowScrollDown((previous) =>
        previous === !nearBottom ? previous : !nearBottom,
      );
      if (nearBottom) {
        setHasNewMessages(false);
        markLatestRead();
      }
      if (listReady)
        updateScrollbar(
          contentOffset.y,
          contentSize.height,
          layoutMeasurement.height,
        );
    },
    [listReady, markLatestRead, updateScrollbar, cancelScheduledScroll, scrollToBottom],
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
    loadPrevious,
    restoreError,
    retryRestore,
    skipRestore,
    awayFromLatest: showScrollDown,
    showScrollDown: showScrollDown && hasNewMessages,
    scrollToBottom,
    scrollToMessage,
    forceStickToBottom,
    jumpToBottom,
    onScrollBeginDrag,
    onWebWheel,
    onScrollEndDrag,
    onMomentumScrollBegin,
    onMomentumScrollEnd,
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
