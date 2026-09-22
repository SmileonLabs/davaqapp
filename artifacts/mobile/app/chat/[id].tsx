import { useLocalSearchParams, useRouter } from "expo-router";
import React, { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Animated,
  Easing,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from "react-native";
import { Feather } from "@expo/vector-icons";
import { useQueryClient } from "@tanstack/react-query";
import {
  getFetchRoomMessagesQueryKey,
  getGetDungeonStateQueryKey,
  getGetRoomQueryKey,
  getListRoomsQueryKey,
  useGetDungeonState,
  useGetMe,
  useGetRoom,
  useGetTypingUsers,
  useLeaveRoom,
  useListRooms,
  setTyping as signalTyping,
  type Message,
  type MessageStickerBadge,
} from "@workspace/api-client-react";
import { MessageBubble } from "@/components/MessageBubble";
import { ExchangeChatCard } from "@/components/davaq/ProposalScreens";
import { ChatRoomContextBar } from "@/components/chat/ChatRoomContextBar";
import { ChatRoomSheets } from "@/components/chat/ChatRoomSheets";
import { FadeInView } from "@/components/FadeInView";
import { EmptyState } from "@/components/EmptyState";
import {TypingIndicator} from "@/components/chat/MessengerUI";
import { ChatRoomHeader } from "@/components/chat/ChatRoomHeader";
import { MessageComposer } from "@/components/MessageComposer";
import { useColors } from "@/hooks/useColors";
import { useChatPolling } from "@/hooks/useChatPolling";
import { useChatSendHandlers } from "@/hooks/useChatSendHandlers";
import { useReliableRoomMessages } from "@/hooks/useReliableRoomMessages";
import { useEphemeralSignal } from "@/hooks/useEphemeralSignal";
import { useInvertedChatListController } from "@/hooks/useInvertedChatListController";
import { useChatRoomIdentity } from "@/hooks/useChatRoomIdentity";
import {
  useAnotherMeRoomSettings,
  useAnotherMeSummonStatus,
  useDismissAnotherMeSession,
  useSummonAnotherMe,
  useUpdateAnotherMeRoomSettings,
} from "@/hooks/useAnotherMe";
import { useCall } from "@/components/CallProvider";
import { usePlayMode } from "@/hooks/usePlayMode";
import { useCharacterProfiles } from "@/hooks/useCharacterProfiles";
import { crossAlert } from "@/lib/crossAlert";
import { mediaUri } from "@/lib/apiBase";
import { userDisplayName } from "@/lib/friendNames";
import {
  formatDayLabel,
  formatMsgTime,
  isReadReceiptParticipant,
  isSystemAccount,
  isSameDay,
  summarizeMessage,
} from "@/lib/chatScreenUtils";
import {
  addMessageStickerBadge,
  deleteMessage,
  forwardMessage,
  pinMessage,
  unpinMessage,
  type DeleteMessageScope,
} from "@/lib/messageActions";
import { chatDiagnosticVariantEnabled } from "@/lib/chatPerformanceDiagnostics";

const EMPTY_STICKER_BADGES: MessageStickerBadge[] = [];

// Delay between each staggered dungeon line ("당~ 당~ 당~").
const REVEAL_INTERVAL = 480;

// Rotating flavor text shown while the AI dungeon master generates a turn.
const DM_THINKING_LINES = [
  "성장RPG 마스터가 주사위를 굴리는 중...",
  "운명의 실을 엮는 중...",
  "어둠 속에서 무언가 움직인다...",
  "다음 장면을 그리는 중...",
  "주변의 공기가 무거워진다...",
];

function getIsIOSStandalonePwa() {
  if (Platform.OS !== "web" || typeof window === "undefined") return false;
  const nav = window.navigator as unknown as {
    standalone?: boolean;
    userAgent: string;
    platform?: string;
    maxTouchPoints?: number;
  };
  const isIOS =
    /iPad|iPhone|iPod/.test(nav.userAgent) ||
    (nav.platform === "MacIntel" && (nav.maxTouchPoints ?? 0) > 1);
  const standalone =
    nav.standalone === true || window.matchMedia("(display-mode: standalone)").matches;
  return isIOS && standalone;
}

import { RelayRoomBanner } from "@/components/davaq/RelayScreens";

export default function ChatScreen({roomId,onBack,embedded=false}:{roomId?:string;onBack?:()=>void;embedded?:boolean}={}) {
  const params = useLocalSearchParams<{ id: string }>();
  const id=roomId??params.id;
  const router = useRouter();
  const queryClient = useQueryClient();
  const colors = useColors();
  const { width: viewportWidth } = useWindowDimensions();
  const [isIOSStandalonePwa, setIsIOSStandalonePwa] = useState(() => getIsIOSStandalonePwa());
  const shouldAnimatePanel = !embedded && Platform.OS === "web" && !isIOSStandalonePwa;

  const [forwardTarget, setForwardTarget] = useState<Message | null>(null);

  const { data: me } = useGetMe();
  const { activeProfile } = useCharacterProfiles();
  const { data: room } = useGetRoom(id);
  const { data: roomsForForward = [] } = useListRooms({
    query: { enabled: !!forwardTarget, queryKey: getListRoomsQueryKey() },
  });
  const { data: messages = [], refetch } = useReliableRoomMessages(id, {
    userId: me?.id,
    profileId: activeProfile?.id,
  });
  const { data: typingUsers = [], refetch: refetchTyping } = useGetTypingUsers(id);
  const leaveRoom = useLeaveRoom();
  const summonAnotherMe = useSummonAnotherMe();
  const dismissAnotherMe = useDismissAnotherMeSession();
  const updateRoomAnotherMeSettings = useUpdateAnotherMeRoomSettings(id);
  const { startCall, joinFromCard, supported: callSupported } = useCall();

  const [replyTo, setReplyTo] = useState<Message | null>(null);
  const [actionMessage, setActionMessage] = useState<Message | null>(null);
  const [roomOptionsVisible, setRoomOptionsVisible] = useState(false);
  const [selectedMessageId, setSelectedMessageId] = useState<string | null>(null);
  const [stickerBadgeTarget, setStickerBadgeTarget] = useState<Message | null>(null);
  const [panelReady, setPanelReady] = useState(!shouldAnimatePanel);
  const panelTranslateX = useRef(
    new Animated.Value(shouldAnimatePanel ? Math.max(48, viewportWidth || 360) : 0),
  ).current;

  // --- Dungeon: sequential message reveal + DM "thinking" loader ---
  const [dmThinking, setDmThinking] = useState(false);
  const [thinkIdx, setThinkIdx] = useState(0);
  const [revealTick, setRevealTick] = useState(0);
  const revealedIdsRef = useRef<Set<string>>(new Set());
  const staggeredIdsRef = useRef<Set<string>>(new Set());
  // Maps a server message id -> the temp id we first rendered it under, so the
  // optimistic→real swap keeps a stable React key (no row remount = no scroll
  // jump / "팅김" when refetch replaces the temp message with the persisted one).
  const clientKeyRef = useRef<Map<string, string>>(new Map());
  const revealQueueRef = useRef<string[]>([]);
  const revealTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const initializedRef = useRef(false);
  const dmThinkTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearDmThinking = React.useCallback(() => {
    setDmThinking(false);
    if (dmThinkTimeoutRef.current) {
      clearTimeout(dmThinkTimeoutRef.current);
      dmThinkTimeoutRef.current = null;
    }
  }, []);

  // Reveals queued DM/system lines one at a time so a turn "lands" gradually
  // (시스템 메시지 당~ 당~ 당~ → DM 내러티브) instead of all at once.
  const pumpReveal = React.useCallback(() => {
    if (revealTimerRef.current) return;
    const step = () => {
      const next = revealQueueRef.current.shift();
      if (next === undefined) {
        revealTimerRef.current = null;
        return;
      }
      revealedIdsRef.current.add(next);
      staggeredIdsRef.current.add(next);
      clearDmThinking();
      setRevealTick((t) => t + 1);
      // Stop animating this id once its entrance finishes so FlatList recycling
      // (scrolling through history) doesn't re-fade an already-seen line.
      setTimeout(() => staggeredIdsRef.current.delete(next), 1200);
      revealTimerRef.current = setTimeout(step, REVEAL_INTERVAL);
    };
    revealTimerRef.current = setTimeout(step, REVEAL_INTERVAL);
  }, [clearDmThinking]);

  const isGroupRoom = room?.type === "group";
  const isDungeon = room?.type === "dungeon";
  const isMultiParty = isGroupRoom || isDungeon;
  const readReceiptOtherCount = ((room?.members as any[]) ?? []).filter(
    (member) => member.id !== me?.id && isReadReceiptParticipant(member),
  ).length;

  const { data: dungeon, refetch: refetchDungeon } = useGetDungeonState(id, {
    query: { enabled: isDungeon, queryKey: getGetDungeonStateQueryKey(id) },
  });

  const flashOpacity = useRef(new Animated.Value(0)).current;
  const enemyFlashOpacity = useRef(new Animated.Value(0)).current;
  const [enemyShakeToken, setEnemyShakeToken] = useState(0);
  const prevTurnRef = useRef<number | null>(null);

  // Reset combat-animation state when switching rooms so a stale turn counter
  // from a previous room can't suppress (or misfire) the next room's effects.
  useEffect(() => {
    prevTurnRef.current = null;
    // Reset reveal state when switching rooms.
    revealedIdsRef.current = new Set();
    staggeredIdsRef.current = new Set();
    clientKeyRef.current.clear();
    revealQueueRef.current = [];
    if (revealTimerRef.current) {
      clearTimeout(revealTimerRef.current);
      revealTimerRef.current = null;
    }
    initializedRef.current = false;
    setReplyTo(null);
    setActionMessage(null);
    setSelectedMessageId(null);
    setForwardTarget(null);
    setStickerBadgeTarget(null);
    setRevealTick((t) => t + 1);
    clearDmThinking();
  }, [id, clearDmThinking]);

  // The API only keeps the latest message window in this screen. Do not retain
  // optimistic React keys for messages that have already fallen out of that
  // window during a long-running room session.
  useEffect(() => {
    const activeIds = new Set(messages.map((message) => message.id));
    for (const messageId of clientKeyRef.current.keys()) {
      if (!activeIds.has(messageId)) clientKeyRef.current.delete(messageId);
    }
  }, [messages]);

  useEffect(() => {
    if (!isDungeon) return;
    const timer = setInterval(() => refetchDungeon(), 3000);
    return () => clearInterval(timer);
  }, [isDungeon, refetchDungeon]);

  // When a new turn arrives, replay combat feedback from that turn's events:
  // a red screen flash + bubble shake on player hits, an enemy-card shake on
  // monster hits.
  useEffect(() => {
    if (!isDungeon || !dungeon) return;
    const turn = dungeon.turn;
    if (prevTurnRef.current === null) {
      prevTurnRef.current = turn;
      return;
    }
    if (turn <= prevTurnRef.current) return;
    prevTurnRef.current = turn;

    const events = dungeon.lastTurnEvents ?? [];
    let playerHurt = false;
    let enemyStruck = false;
    for (const ev of events) {
      if (ev.kind === "playerHit") {
        playerHurt = true;
      } else if (ev.kind === "enemyHit") {
        enemyStruck = true;
      } else if (ev.kind === "death") {
        // A death with a targetUserId is a party member dying (player hurt);
        // without one it's a monster dying (a hit we landed).
        if (ev.targetUserId) playerHurt = true;
        else enemyStruck = true;
      }
    }

    if (playerHurt) {
      // Player took damage: the red screen flash is the whole signal. We no
      // longer jolt the player's message bubble — the shake landed on their own
      // action text and read as "my message shook" rather than "I got hit".
      const useNative = Platform.OS !== "web";
      flashOpacity.setValue(0);
      Animated.sequence([
        Animated.timing(flashOpacity, { toValue: 0.5, duration: 80, useNativeDriver: useNative }),
        Animated.timing(flashOpacity, { toValue: 0, duration: 340, useNativeDriver: useNative }),
      ]).start();
    }
    if (enemyStruck) {
      // Same feedback as a player hit, but a green flash to signal we struck the
      // monster (an attack landing) rather than the party taking damage.
      const useNative = Platform.OS !== "web";
      enemyFlashOpacity.setValue(0);
      Animated.sequence([
        Animated.timing(enemyFlashOpacity, { toValue: 0.5, duration: 80, useNativeDriver: useNative }),
        Animated.timing(enemyFlashOpacity, { toValue: 0, duration: 340, useNativeDriver: useNative }),
      ]).start();
      setEnemyShakeToken((t) => t + 1);
    }
  }, [isDungeon, dungeon, flashOpacity, enemyFlashOpacity]);

  const handleLeave = React.useCallback(() => {
    if (leaveRoom.isPending) return;
    setRoomOptionsVisible(false);
    const isGroup = room?.type === "group";
    const message = isGroup
      ? "이 그룹 채팅방에서 나가시겠습니까?\n다시 들어오려면 초대가 필요합니다."
      : "이 대화방을 목록에서 숨기시겠습니까?\n상대가 새 메시지를 보내거나 다시 대화를 시작하면 다시 나타납니다.";

    const doLeave = async () => {
      try {
        await leaveRoom.mutateAsync({ id });
        await queryClient.invalidateQueries({ queryKey: getListRoomsQueryKey() });
        if (router.canGoBack()) {
          router.back();
        } else {
          router.replace("/(tabs)/chats");
        }
      } catch {
        if (Platform.OS === "web") {
          window.alert("채팅방을 나가지 못했습니다. 다시 시도해주세요.");
        } else {
          Alert.alert("오류", "채팅방을 나가지 못했습니다. 다시 시도해주세요.");
        }
      }
    };

    if (Platform.OS === "web") {
      if (window.confirm(message)) void doLeave();
    } else {
      Alert.alert("채팅방 나가기", message, [
        { text: "취소", style: "cancel" },
        { text: "나가기", style: "destructive", onPress: () => void doLeave() },
      ]);
    }
  }, [id, leaveRoom, room?.type, router, queryClient]);

  useChatPolling({
    isDungeon,
    dungeonThinking: dmThinking,
    refetchMessages: refetch,
    refetchTyping,
    refetchDungeon,
  });

  // Progressive reveal: the first load shows existing history at once; after
  // that, new dungeon DM/system lines stagger in one by one while the player's
  // own messages (and every non-dungeon message) appear immediately.
  useEffect(() => {
    if (!isDungeon) return;
    if (messages.length === 0) return;
    const revealed = revealedIdsRef.current;
    const activeIds = new Set(messages.map((message) => message.id));
    for (const messageId of revealed) {
      if (!activeIds.has(messageId)) revealed.delete(messageId);
    }
    revealQueueRef.current = revealQueueRef.current.filter((messageId) => activeIds.has(messageId));
    if (!initializedRef.current) {
      for (const m of messages) revealed.add(m.id);
      initializedRef.current = true;
      setRevealTick((t) => t + 1);
      return;
    }
    const queued = new Set(revealQueueRef.current);
    let queuedAny = false;
    for (const m of messages) {
      if (revealed.has(m.id) || queued.has(m.id)) continue;
      const isDM = isSystemAccount(m.sender);
      const isTemp = String(m.id).startsWith("temp-");
      if (isDM && !isTemp) {
        revealQueueRef.current.push(m.id);
        queuedAny = true;
      } else {
        revealed.add(m.id);
      }
    }
    if (queuedAny) setRevealTick((t) => t + 1);
    if (queuedAny) pumpReveal();
  }, [messages, isDungeon, pumpReveal]);

  // Rotate the DM "thinking" flavor text while we wait for the AI.
  useEffect(() => {
    if (!dmThinking) return;
    setThinkIdx(0);
    const t = setInterval(
      () => setThinkIdx((i) => (i + 1) % DM_THINKING_LINES.length),
      1600,
    );
    return () => clearInterval(t);
  }, [dmThinking]);

  // Clear pending timers on unmount.
  useEffect(
    () => () => {
      if (revealTimerRef.current) clearTimeout(revealTimerRef.current);
      if (dmThinkTimeoutRef.current) clearTimeout(dmThinkTimeoutRef.current);
    },
    [],
  );

  const visibleMessages = React.useMemo(
    () => {
      // Only dungeon DM narrative lines are intentionally staggered (revealed one
      // by one). Everything else — every non-dungeon message and the player's own
      // dungeon messages — must show immediately. Gating ALL messages on the
      // reveal set caused a one-frame flicker on send: refetch() swaps the
      // optimistic temp message for the real one, but the real id isn't in the
      // reveal set until the reveal effect runs (after render), so the bubble
      // briefly vanished and reappeared.
      if (!isDungeon) return messages;
      return messages.filter((m) => {
        if (revealedIdsRef.current.has(m.id)) return true;
        const isDM = isSystemAccount(m.sender);
        const isTemp = String(m.id).startsWith("temp-");
        return !(isDM && !isTemp);
      });
    },
    // revealTick re-derives the list as queued items are revealed.
    [messages, isDungeon, revealTick],
  );

  // Inverted FlatList wants newest-first data. This makes the latest message live
  // at offset 0, so long/late-measured bubbles grow upward instead of forcing an
  // entry-time scroll correction.
  const listMessages = React.useMemo(() => [...visibleMessages].reverse(), [visibleMessages]);
  const listMessagesRef = useRef(listMessages);
  listMessagesRef.current = listMessages;

  // Choices must never appear before the current turn's story. The dungeon-state
  // poll and the messages poll are independent, so a new turn's `choices` can
  // arrive before that turn's narrative bubble has been fetched or revealed —
  // especially for party members who didn't take the action (no local
  // `dmThinking`). The server stamps each turn's narrative message id into the
  // dungeon state, so we only show choices once that exact message is the last
  // one on screen. This is order-independent and works within the 50-message
  // window. Fall back to "last visible is a DM narrative" for sessions created
  // before the field existed (resolves itself after one more turn).
  const lastVisible = visibleMessages[visibleMessages.length - 1];
  const narrativeLanded =
    !!lastVisible &&
    lastVisible.type === "text" &&
    isSystemAccount(lastVisible.sender);
  const choicesSynced = dungeon?.lastNarrativeMessageId
    ? lastVisible?.id === dungeon.lastNarrativeMessageId
    : narrativeLanded;

  const goBack = React.useCallback(() => {
    if(onBack){onBack();return;}
    if (router.canGoBack()) router.back();
    else router.replace("/(tabs)/chats");
  }, [router,onBack]);

  const { isDirect, otherMember, otherDisplayName, isOtherOnline, headerTitle, headerSubtitle } = useChatRoomIdentity({
    room,
    meId: me?.id,
    isGroupRoom,
    isDungeon,
  });
  const { equippedStar } = usePlayMode();
  const myChatIdentity = equippedStar ? `내 프로필 · STAR ${equippedStar.displayName}` : "내 프로필 · FAN";
  const { data: targetAnotherMeStatus, refetch: refetchTargetAnotherMeStatus } = useAnotherMeSummonStatus(
    isDirect ? id : undefined,
    otherMember?.id,
    isDirect && !!otherMember,
  );
  const { data: myAnotherMeStatus, refetch: refetchMyAnotherMeStatus } = useAnotherMeSummonStatus(
    isDirect ? id : undefined,
    me?.id,
    isDirect && !!me,
  );
  const { data: roomAnotherMeSettings, refetch: refetchRoomAnotherMeSettings } = useAnotherMeRoomSettings(
    isDirect ? id : undefined,
  );
  const activeAnotherMeSession = myAnotherMeStatus?.activeSession ?? targetAnotherMeStatus?.activeSession ?? null;
  const canSummonAnotherMe = !!targetAnotherMeStatus?.canSummon && !activeAnotherMeSession;
  const roomSummonOverride = roomAnotherMeSettings?.summonEnabled ?? null;
  const roomSummonExplicitlyEnabled = roomSummonOverride === true;
  const roomSummonStatusLabel = roomSummonOverride == null
    ? "전역 설정 사용"
    : roomSummonOverride
      ? "이 방에서 허용"
      : "이 방에서 차단";
  const refreshAnotherMeRoomState = React.useCallback(async () => {
    await Promise.all([
      refetchRoomAnotherMeSettings(),
      refetchTargetAnotherMeStatus(),
      refetchMyAnotherMeStatus(),
    ]);
  }, [refetchMyAnotherMeStatus, refetchRoomAnotherMeSettings, refetchTargetAnotherMeStatus]);

  const handleRoomAnotherMeToggle = React.useCallback(
    async (value: boolean) => {
      if (!isDirect || updateRoomAnotherMeSettings.isPending) return;
      try {
        await updateRoomAnotherMeSettings.mutateAsync({ summonEnabled: value });
        await refreshAnotherMeRoomState();
      } catch {
        crossAlert("오류", "이 방의 DavaQ 설정을 변경하지 못했습니다.");
      }
    },
    [isDirect, refreshAnotherMeRoomState, updateRoomAnotherMeSettings],
  );

  const handleRoomAnotherMeUseGlobal = React.useCallback(async () => {
    if (!isDirect || updateRoomAnotherMeSettings.isPending) return;
    try {
      await updateRoomAnotherMeSettings.mutateAsync({ summonEnabled: null });
      await refreshAnotherMeRoomState();
    } catch {
      crossAlert("오류", "이 방의 DavaQ 설정을 변경하지 못했습니다.");
    }
  }, [isDirect, refreshAnotherMeRoomState, updateRoomAnotherMeSettings]);

  const canCall = isDirect && callSupported && !!otherMember;

  useEffect(() => {
    if (Platform.OS !== "web" || typeof window === "undefined") return;
    const update = () => setIsIOSStandalonePwa(getIsIOSStandalonePwa());
    const mq = window.matchMedia("(display-mode: standalone)");
    update();
    mq.addEventListener?.("change", update);
    window.addEventListener("pageshow", update);
    document.addEventListener("visibilitychange", update);
    return () => {
      mq.removeEventListener?.("change", update);
      window.removeEventListener("pageshow", update);
      document.removeEventListener("visibilitychange", update);
    };
  }, []);

  useEffect(() => {
    if (shouldAnimatePanel) return;
    panelTranslateX.stopAnimation();
    panelTranslateX.setValue(0);
    setPanelReady(true);
  }, [panelTranslateX, shouldAnimatePanel]);

  useEffect(() => {
    if (!shouldAnimatePanel) return;
    if (!panelReady) return;
    Animated.timing(panelTranslateX, {
      toValue: 0,
      duration: 220,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [panelReady, panelTranslateX, shouldAnimatePanel]);

  useEffect(() => {
    if (shouldAnimatePanel) {
      panelTranslateX.stopAnimation();
      panelTranslateX.setValue(Math.max(48, viewportWidth || 360));
      setPanelReady(false);
    } else {
      panelTranslateX.stopAnimation();
      panelTranslateX.setValue(0);
      setPanelReady(true);
    }
  }, [id, panelTranslateX, shouldAnimatePanel, viewportWidth]);

  const revealPanelAfterInitialScroll = React.useCallback(() => {
    if (shouldAnimatePanel) setPanelReady(true);
  }, [shouldAnimatePanel]);

  const {
    listRef,
    listReady,
    showScrollDown,
    scrollToBottom,
    scrollToMessage: scrollToListMessage,
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
    scrollbar,
  } = useInvertedChatListController({
    roomId: id,
    room,
    viewerId: me?.id,
    messages,
    visibleMessages,
    listMessages,
    isDungeon,
    onInitialScrollReady: revealPanelAfterInitialScroll,
  });

  const beginDungeonThinking = React.useCallback(() => {
    setDmThinking(true);
    if (dmThinkTimeoutRef.current) clearTimeout(dmThinkTimeoutRef.current);
    dmThinkTimeoutRef.current = setTimeout(() => setDmThinking(false), 30000);
  }, []);

  const scrollToMessage = React.useCallback(
    (messageId: string) => {
      if (!scrollToListMessage(messageId)) {
        crossAlert("안내", "현재 화면에 불러온 메시지에서 찾을 수 없습니다.");
        return false;
      }
      setSelectedMessageId(messageId);
      setTimeout(() => setSelectedMessageId((current) => (current === messageId ? null : current)), 1400);
      return true;
    },
    [scrollToListMessage],
  );

  useEffect(() => {
    if (!isDirect || !otherMember?.id || !lastRealMessageId) return;
    void refetchTargetAnotherMeStatus();
    void refetchMyAnotherMeStatus();
  }, [isDirect, lastRealMessageId, otherMember?.id, refetchMyAnotherMeStatus, refetchTargetAnotherMeStatus]);

  useEffect(() => {
    if (!isDirect || targetAnotherMeStatus?.reason !== "waiting") return;
    const remainingSeconds = targetAnotherMeStatus.remainingSeconds ?? 0;
    const delayMs = Math.min(Math.max(remainingSeconds * 1000 + 250, 500), 60_000);
    const timer = setTimeout(() => {
      void refetchTargetAnotherMeStatus();
    }, delayMs);
    return () => clearTimeout(timer);
  }, [isDirect, refetchTargetAnotherMeStatus, targetAnotherMeStatus?.reason, targetAnotherMeStatus?.remainingSeconds]);

  // On web/PWA the OS push fires the instant a message is inserted, but this
  // screen only polls every 3s — so the banner/sound would beat the on-screen
  // message. When the service worker reports a push for THIS room, refetch right
  // away so the message lands in step with the notification.
  useEffect(() => {
    if (Platform.OS !== "web") return;
    if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;
    const onMessage = (e: MessageEvent) => {
      const data = e.data;
      if (data?.type !== "data-changed") return;
      // Only react to a push for THIS room. Non-chat pushes (friend request, etc.)
      // carry no roomId, so this also skips needless refetches for them.
      if (data.roomId !== id) return;
      void refetch();
      // Dungeon HP/choices live in a separate query — keep them in lockstep so the
      // party panel doesn't lag the freshly-refetched message lines.
      if (isDungeon) void refetchDungeon();
    };
    navigator.serviceWorker.addEventListener("message", onMessage);
    return () => navigator.serviceWorker.removeEventListener("message", onMessage);
  }, [id, refetch, isDungeon, refetchDungeon]);

  const clearReply = React.useCallback(() => {
    setReplyTo(null);
  }, []);

  const {
    isSending,
    uploadTask,
    isWebDraggingUpload,
    sendText,
    handleSendSticker,
    handlePickImage,
    handlePickFile,
    handleCancelUpload,
    retryMessage,
  } = useChatSendHandlers({
    roomId: id,
    me,
    senderProfile: activeProfile,
    replyTo,
    clearReply,
    clientKeyRef,
    forceStickToBottom,
    isDungeon,
    beginDungeonThinking,
    clearDungeonThinking: clearDmThinking,
  });

  // Typing is a disposable heartbeat: never queue stale signals, never allow
  // more than one request in flight, and abandon a stalled cellular request.
  const handleTyping = useEphemeralSignal(
    (signal) =>
      chatDiagnosticVariantEnabled("disableTyping")
        ? Promise.resolve()
        : signalTyping(id, { signal }),
    {
      minIntervalMs: 2_000,
      timeoutMs: 4_000,
      operationKey: id,
      diagnosticName: "typing",
    },
  );

  const handleSummonAnotherMe = React.useCallback(async () => {
    if (!otherMember?.id || summonAnotherMe.isPending) return;
    try {
      await summonAnotherMe.mutateAsync({ roomId: id, targetUserId: otherMember.id });
      await Promise.all([refetch(), refetchTargetAnotherMeStatus(), refetchMyAnotherMeStatus()]);
    } catch {
      crossAlert("소환 실패", "아직 DavaQ를 소환할 수 없거나 상대가 허용하지 않았어요.");
    }
  }, [id, otherMember?.id, refetch, refetchMyAnotherMeStatus, refetchTargetAnotherMeStatus, summonAnotherMe]);

  const handleDismissAnotherMe = React.useCallback(async () => {
    if (!activeAnotherMeSession || dismissAnotherMe.isPending) return;
    try {
      await dismissAnotherMe.mutateAsync(activeAnotherMeSession.id);
      await Promise.all([refetch(), refetchTargetAnotherMeStatus(), refetchMyAnotherMeStatus()]);
    } catch {
      crossAlert("오류", "DavaQ를 퇴장시키지 못했습니다.");
    }
  }, [activeAnotherMeSession, dismissAnotherMe, refetch, refetchMyAnotherMeStatus, refetchTargetAnotherMeStatus]);

  // Stable handler for the in-chat call card so memoized message bubbles don't
  // re-render every poll.
  const handleJoinCall = React.useCallback(
    (cid: string, media: "audio" | "video") =>
      joinFromCard(cid, otherDisplayName, media),
    [joinFromCard, otherDisplayName],
  );

  const refreshCurrentRoom = React.useCallback(async () => {
    await Promise.all([
      refetch(),
      queryClient.invalidateQueries({ queryKey: getGetRoomQueryKey(id) }),
      queryClient.invalidateQueries({ queryKey: getListRoomsQueryKey() }),
    ]);
  }, [id, queryClient, refetch]);

  const handleCopyMessage = React.useCallback(async (message: Message) => {
    if ((message as any).deletedAt) return;
    const text = message.type === "text" ? message.content : summarizeMessage(message);
    try {
      const Clipboard = await import("expo-clipboard");
      await Clipboard.setStringAsync(text);
      crossAlert("복사됨", "메시지를 복사했습니다.");
    } catch {
      crossAlert("오류", "메시지를 복사하지 못했습니다.");
    }
  }, []);

  const performDelete = React.useCallback(
    async (message: Message, scope: DeleteMessageScope) => {
      try {
        setActionMessage(null);
        await deleteMessage(id, message.id, scope);
        if (replyTo?.id === message.id) setReplyTo(null);
        await refreshCurrentRoom();
      } catch {
        crossAlert("오류", "메시지를 삭제하지 못했습니다. 다시 시도해주세요.");
      }
    },
    [id, refreshCurrentRoom, replyTo?.id],
  );

  const performPin = React.useCallback(
    async (message: Message) => {
      const doPin = async () => {
        try {
          setActionMessage(null);
          await pinMessage(id, message.id);
          await refreshCurrentRoom();
        } catch {
          crossAlert("오류", "메시지를 고정하지 못했습니다.");
        }
      };

      const currentPinnedId = (room as any)?.pinnedMessageId as string | null | undefined;
      if (currentPinnedId && currentPinnedId !== message.id) {
        const prompt = "이미 고정된 메시지가 있습니다. 이 메시지로 교체할까요?";
        if (Platform.OS === "web") {
          if (window.confirm(prompt)) await doPin();
        } else {
          Alert.alert("고정 메시지 교체", prompt, [
            { text: "취소", style: "cancel" },
            { text: "교체", onPress: () => void doPin() },
          ]);
        }
        return;
      }
      await doPin();
    },
    [id, refreshCurrentRoom, room],
  );

  const performUnpin = React.useCallback(async () => {
    try {
      setActionMessage(null);
      await unpinMessage(id);
      await refreshCurrentRoom();
    } catch {
      crossAlert("오류", "고정을 해제하지 못했습니다.");
    }
  }, [id, refreshCurrentRoom]);

  const performForward = React.useCallback(
    async (targetRoomId: string) => {
      if (!forwardTarget) return;
      try {
        const created = await forwardMessage(id, forwardTarget.id, targetRoomId);
        setForwardTarget(null);
        await Promise.all([
          queryClient.invalidateQueries({ queryKey: getFetchRoomMessagesQueryKey(targetRoomId) }),
          queryClient.invalidateQueries({ queryKey: getGetRoomQueryKey(targetRoomId) }),
          queryClient.invalidateQueries({ queryKey: getListRoomsQueryKey() }),
        ]);
        if (targetRoomId === id && created?.id) jumpToBottom();
      } catch {
        crossAlert("오류", "메시지를 전달하지 못했습니다.");
      }
    },
    [forwardTarget, id, queryClient, jumpToBottom],
  );

  const performStickerBadge = React.useCallback(
    async (code: string, target=stickerBadgeTarget) => {
      if (!target) return;
      try {
        await addMessageStickerBadge(id, target.id, code);
        setActionMessage(null);
        setStickerBadgeTarget(null);
        await refreshCurrentRoom();
      } catch {
        crossAlert("오류", "스티커를 붙이지 못했습니다.");
      }
    },
    [id, refreshCurrentRoom, stickerBadgeTarget],
  );

  const typingLabel =
    typingUsers.length === 0
      ? null
      : typingUsers.length === 1
        ? `${typingUsers[0].nickname}님이 입력 중...`
        : `${typingUsers[0].nickname}님 외 ${typingUsers.length - 1}명이 입력 중...`;
  const pinnedMessageId = ((room as any)?.pinnedMessageId ?? null) as string | null;
  const actionIsMine = !!actionMessage && actionMessage.senderId === me?.id;
  const actionIsDeleted = !!(actionMessage as any)?.deletedAt;
  const actionIsPinned = !!actionMessage && pinnedMessageId === actionMessage.id;
  const composerReplyPreview = React.useMemo(
    () => replyTo ? { senderName: userDisplayName(replyTo.sender as any, ""), content: summarizeMessage(replyTo) } : null,
    [replyTo],
  );
  const handleCancelReply = React.useCallback(() => setReplyTo(null), []);
  const handleMessageLongPress = React.useCallback((messageId: string) => {
    const message = listMessagesRef.current.find((item) => item.id === messageId);
    if (message) setActionMessage(message);
  }, []);

  const renderMessageItem = React.useCallback(
    ({ item, index }: { item: Message; index: number }) => {
      const authorKind = ((item as any).authorKind ?? "user") as string;
      const isUserMessage = authorKind === "user";
      const isAnotherMe = authorKind === "another_me";
      const isMe = item.senderId === me?.id;
      const isDM = isSystemAccount(item.sender);
      const prevMsg = listMessages[index + 1];
      const anotherMeOwnerName = ((item as any).metadata?.ownerName as string | undefined) ?? userDisplayName(item.sender as any, "상대");
      const compact=!!prevMsg&&prevMsg.senderId===item.senderId&&prevMsg.authorKind===item.authorKind&&isSameDay(prevMsg.createdAt,item.createdAt)&&Math.abs(Date.parse(item.createdAt)-Date.parse(prevMsg.createdAt))<300000;
      const showSender = !compact&&(isAnotherMe || (isMultiParty && !isMe && !isDM));
      const showDate = !prevMsg || !isSameDay(prevMsg.createdAt, item.createdAt);
      let readLabel: string | undefined;
      const deliveryState = (item as any)._deliveryState as
        | "pending"
        | "failed"
        | undefined;
      if (isMe && isUserMessage) {
        if (deliveryState === "failed") {
          readLabel = "전송 실패";
        } else if (deliveryState === "pending" || (item as any)._pending) {
          readLabel = "전송 중";
        } else if (!isDungeon && readReceiptOtherCount > 0) {
          const readCount = item.readCount ?? 0;
          if (isGroupRoom) {
            const unread = Math.max(0, readReceiptOtherCount - readCount);
            readLabel = unread > 0 ? `안읽음 ${unread}` : "읽음";
          } else {
            readLabel = readCount >= 1 ? "읽음" : "안읽음";
          }
        }
      }
      const canActOnMessage =
        !String(item.id).startsWith("temp-") && item.type !== "system" && !isDM && !isAnotherMe;
      const bubble = (
        <>
          {item.id === anchorMsgId ? (
            <View style={styles.unreadDivider}>
              <View style={[styles.unreadLine, { backgroundColor: colors.primary }]} />
              <Text style={[styles.unreadText, { color: colors.primary }]}>새 메시지</Text>
              <View style={[styles.unreadLine, { backgroundColor: colors.primary }]} />
            </View>
          ) : null}
          {showDate ? (
            <View style={styles.dateRow}>
              <View style={[styles.datePill, { backgroundColor: colors.muted }]}>
                <Text style={[styles.dateText, { color: colors.mutedForeground }]}>
                  {formatDayLabel(item.createdAt)}
                </Text>
              </View>
            </View>
          ) : null}
          {(item as any).metadata?.exchangeProposalId && !(item as any).deletedAt ? <ExchangeChatCard proposalId={(item as any).metadata.exchangeProposalId} version={(item as any).metadata.exchangeVersion ?? 1}/> : null}
          <MessageBubble
            messageId={item.id}
            content={item.content}
            isMe={isMe}
            isDM={isDM}
            isAnotherMe={isAnotherMe}
            senderName={isAnotherMe ? anotherMeOwnerName : (item.senderProfile?.displayName ?? userDisplayName(item.sender as any, ""))}
            senderAvatar={item.senderProfile?.profileImageUrl ?? null}
            senderCharacterType={item.senderProfile?.type as "fan" | "star" | "official_ai" | undefined}
            time={formatMsgTime(item.createdAt)}
            type={item.type}
            imageUri={item.type === "image" ? item.content : undefined}
            showSender={showSender}
            compact={compact}
            readLabel={readLabel}
            onJoinCall={handleJoinCall}
            onLongPress={canActOnMessage ? handleMessageLongPress : undefined}
            selected={selectedMessageId === item.id}
            deletedAt={(item as any).deletedAt ?? null}
            replyTo={(item as any).replyTo ?? null}
            stickerBadges={(item as any).stickerBadges ?? EMPTY_STICKER_BADGES}
            linkPreview={(item as any).linkPreview ?? null}
            onPressReply={scrollToMessage}
            retryClientMessageId={
              deliveryState === "failed" ? item.clientMessageId : null
            }
            onRetryMessage={retryMessage}
          />
        </>
      );
      // In dungeons, freshly-revealed lines fade/slide in; history and
      // non-dungeon messages render instantly.
      return isDungeon ? (
        <FadeInView animate={staggeredIdsRef.current.has(item.id)}>{bubble}</FadeInView>
      ) : (
        <View>{bubble}</View>
      );
    },
    [
      anchorMsgId,
      colors.muted,
      colors.mutedForeground,
      colors.primary,
      handleJoinCall,
      handleMessageLongPress,
      isDungeon,
      isGroupRoom,
      isMultiParty,
      listMessages,
      me?.id,
      readReceiptOtherCount,
      retryMessage,
      scrollToMessage,
      selectedMessageId,
    ],
  );

  return (
    <Animated.View
      style={[
        styles.container,
        { backgroundColor: colors.background },
        shouldAnimatePanel
          ? { transform: [{ translateX: panelTranslateX }] }
          : null,
      ]}
    >
      <ChatRoomHeader
        title={headerTitle}
        subtitle={headerSubtitle}
        embedded={embedded}
        avatarUri={otherMember?.profileImageUrl}
        avatarCharacterType={otherMember?.profile?.type}
        isDirect={isDirect}
        isGroupRoom={isGroupRoom}
        isDungeon={isDungeon}
        isOtherOnline={isOtherOnline}
        canCall={canCall}
        showAnotherMeToggle={isDirect && !!otherMember}
        anotherMeEnabled={roomSummonExplicitlyEnabled}
        anotherMePending={updateRoomAnotherMeSettings.isPending}
        onBack={goBack}
        onToggleAnotherMe={(enabled) => void handleRoomAnotherMeToggle(enabled)}
        onStartCall={(media) => {
          if (otherMember) startCall(otherMember.id, otherDisplayName, id, media);
        }}
        onInvite={() => router.push({ pathname: "/group/invite", params: { id } })}
        onOpenOptions={() => setRoomOptionsVisible(true)}
      />

      <RelayRoomBanner roomId={id} />
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        keyboardVerticalOffset={0}
      >
      <View pointerEvents="none" style={styles.wallpaper}>
        <View style={[styles.wallpaperOrb, styles.wallpaperOrbOne, { backgroundColor: colors.primary }]} />
        <View style={[styles.wallpaperOrb, styles.wallpaperOrbTwo, { backgroundColor: colors.accent }]} />
        <View style={[styles.wallpaperGrid, { borderColor: colors.border }]} />
      </View>
      <ChatRoomContextBar
        pinnedMessage={(room as any)?.pinnedMessage ?? null}
        onOpenPinnedMessage={scrollToMessage}
        onUnpin={() => void performUnpin()}
        isDungeon={isDungeon}
        dungeon={dungeon}
        enemyShakeToken={enemyShakeToken}
        activeAnotherMeSession={activeAnotherMeSession}
        otherDisplayName={otherDisplayName}
        anotherMeDismissPending={dismissAnotherMe.isPending}
        onDismissAnotherMe={() => void handleDismissAnotherMe()}
        canSummonAnotherMe={canSummonAnotherMe}
        anotherMeSummonPending={summonAnotherMe.isPending}
        onSummonAnotherMe={() => void handleSummonAnotherMe()}
      />
      <FlatList
        key={id}
        ref={listRef}
        data={listMessages}
        inverted
        keyExtractor={(item) =>
          clientKeyRef.current.get(item.id) ?? item.clientMessageId ?? item.id
        }
        style={[styles.flex, { opacity: listReady ? 1 : 0 }]}
        contentContainerStyle={styles.messageList}
        ListEmptyComponent={
          <View style={styles.emptyInvertedFix}>
            {isDungeon ? (
              <EmptyState
                icon="compass"
                title="성장RPG가 시작되는 중..."
                subtitle="성장RPG 마스터가 첫 장면을 준비하고 있습니다."
              />
            ) : (
              <EmptyState
                icon="message-circle"
                title="아직 메시지가 없습니다"
                subtitle="첫 번째 메시지를 보내보세요"
              />
            )}
          </View>
        }
        renderItem={renderMessageItem}
        initialNumToRender={12}
        maxToRenderPerBatch={8}
        updateCellsBatchingPeriod={40}
        windowSize={5}
        ListHeaderComponent={
          isDungeon ? (
            <View style={styles.footerWrap}>
              {dmThinking ? (
                <View style={styles.thinkingRow}>
                  <ActivityIndicator size="small" color={colors.primary} />
                  <Text style={[styles.thinkingText, { color: colors.mutedForeground }]}>
                    {DM_THINKING_LINES[thinkIdx]}
                  </Text>
                </View>
              ) : null}
              {!dmThinking &&
              revealQueueRef.current.length === 0 &&
              choicesSynced &&
              !dungeon?.ended &&
              (dungeon?.choices?.length ?? 0) > 0 ? (
                <View style={styles.choicesInline}>
                  {dungeon!.choices.map((c, i) => (
                    <FadeInView key={`${i}-${c}`} delay={i * 160}>
                      <Pressable
                        onPress={() => void sendText(c)}
                        disabled={isSending}
                        style={({ pressed }) => [
                          styles.choiceLine,
                          {
                            backgroundColor: colors.card,
                            borderColor: colors.border,
                            opacity: pressed || isSending ? 0.55 : 1,
                          },
                        ]}
                      >
                        <Text style={[styles.choiceBullet, { color: colors.primary }]}>›</Text>
                        <Text style={[styles.choiceLineText, { color: colors.foreground }]}>{c}</Text>
                      </Pressable>
                    </FadeInView>
                  ))}
                </View>
              ) : null}
            </View>
          ) : null
        }
        onScrollToIndexFailed={onScrollToIndexFailed}
        onContentSizeChange={onContentSizeChange}
        onViewableItemsChanged={onViewableItemsChanged}
        viewabilityConfig={viewabilityConfig}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="always"
        keyboardDismissMode={Platform.OS==="ios"?"interactive":"on-drag"}
        onScroll={onScroll}
        scrollEventThrottle={16}
        onLayout={onLayout}
      />

      {scrollbar.track.height > 0 ? (
        <Animated.View
          pointerEvents="none"
          style={[
            styles.scrollbarTrack,
            {
              top: scrollbar.track.top,
              height: scrollbar.track.height,
              opacity: scrollbar.opacity,
            },
          ]}
        >
          <Animated.View
            style={[
              styles.scrollbarThumb,
              {
                backgroundColor: colors.mutedForeground,
                height: scrollbar.thumbHeight,
                transform: [{ translateY: scrollbar.thumbY }],
              },
            ]}
          />
        </Animated.View>
      ) : null}

      {entryUnreadCount > 0 && anchorMsgId ? (
        <Pressable
          onPress={() => {
            if (scrollToMessage(anchorMsgId)) clearEntryUnread();
          }}
          style={[
            styles.unreadJumpBtn,
            { backgroundColor: colors.card, borderColor: colors.primary },
          ]}
          hitSlop={8}
        >
          <Feather name="arrow-up" size={15} color={colors.primary} />
          <Text style={[styles.unreadJumpText, { color: colors.foreground }]} numberOfLines={1}>
            새 메시지 {entryUnreadCount}개
          </Text>
        </Pressable>
      ) : null}

      {showScrollDown ? (
        <Pressable
          onPress={jumpToBottom}
          style={[
            styles.scrollDownBtn,
            { backgroundColor: colors.card, borderColor: colors.border },
          ]}
          hitSlop={8}
        >
          <Feather name="chevron-down" size={22} color={colors.foreground} />
        </Pressable>
      ) : null}

      {isWebDraggingUpload && !isDungeon ? (
        <View pointerEvents="none" style={styles.dropOverlay}>
          <View style={[styles.dropCard, { backgroundColor: colors.card, borderColor: colors.primary }]}>
            <Feather name="upload-cloud" size={34} color={colors.primary} />
            <Text style={[styles.dropTitle, { color: colors.foreground }]}>여기에 놓아 전송</Text>
            <Text style={[styles.dropSubtitle, { color: colors.mutedForeground }]}>이미지는 사진으로, 그 외 파일은 파일로 전송됩니다</Text>
          </View>
        </View>
      ) : null}

      {typingLabel ? <TypingIndicator label={typingLabel}/> : null}

      {/* Dungeon is played entirely via the AI's choice buttons — no free-text
          input bar. Every other room keeps the composer. The composer owns its
          own text state so typing never re-renders this screen / message list. */}
      {!isDungeon ? (
        <MessageComposer
          key={`${me?.id}:${activeProfile?.id}:${id}`}
          draftKey={me?.id&&activeProfile?.id?`${me.id}:${activeProfile.id}:${id}`:undefined}
          sending={isSending}
          uploading={uploadTask?.kind ?? null}
          uploadProgress={uploadTask?.progress ?? null}
          onCancelUpload={uploadTask ? handleCancelUpload : undefined}
          onSend={sendText}
          onTyping={handleTyping}
          onPickImage={handlePickImage}
          onPickFile={handlePickFile}
          onSendSticker={handleSendSticker}
          replyPreview={composerReplyPreview}
          onCancelReply={handleCancelReply}
        />
      ) : null}

      <ChatRoomSheets
        roomOptions={{
          visible: roomOptionsVisible,
          title: headerTitle,
          isDirect,
          anotherMeEnabled: roomSummonExplicitlyEnabled,
          anotherMeStatusLabel: roomSummonStatusLabel,
          anotherMeUsesOverride: roomSummonOverride != null,
          anotherMePending: updateRoomAnotherMeSettings.isPending,
          onClose: () => setRoomOptionsVisible(false),
          onToggleAnotherMe: (enabled) => void handleRoomAnotherMeToggle(enabled),
          onUseGlobalAnotherMe: () => void handleRoomAnotherMeUseGlobal(),
          onLeave: handleLeave,
        }}
        messageActions={{
          message: actionMessage,
          isDeleted: actionIsDeleted,
          isMine: actionIsMine,
          isPinned: actionIsPinned,
          onClose: () => setActionMessage(null),
          onReply: (message) => {
            setReplyTo(message);
            setActionMessage(null);
          },
          onCopy: (message) => {
            setActionMessage(null);
            void handleCopyMessage(message);
          },
          onSelect: (message) => {
            setSelectedMessageId(message.id);
            setActionMessage(null);
          },
          onTogglePin: (message) => {
            if (actionIsPinned) void performUnpin();
            else void performPin(message);
          },
          onForward: (message) => {
            setForwardTarget(message);
            setActionMessage(null);
          },
          onReact:(message,code)=>void performStickerBadge(code,message),
          onSticker: (message) => {
            setStickerBadgeTarget(message);
            setActionMessage(null);
          },
          onDelete: (message, scope) => void performDelete(message, scope),
        }}
        stickerBadge={{
          target: stickerBadgeTarget,
          onClose: () => setStickerBadgeTarget(null),
          onSelect: (code) => void performStickerBadge(code),
        }}
        forward={{
          target: forwardTarget,
          rooms: roomsForForward,
          viewerId: me?.id,
          onClose: () => setForwardTarget(null),
          onForward: (roomId) => void performForward(roomId),
        }}
      />
      </KeyboardAvoidingView>
      <Animated.View
        pointerEvents="none"
        style={[styles.flash, { opacity: flashOpacity }]}
      />
      <Animated.View
        pointerEvents="none"
        style={[styles.flashEnemy, { opacity: enemyFlashOpacity }]}
      />
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  flex: { flex: 1 },
  wallpaper: {
    ...StyleSheet.absoluteFillObject,
    overflow: "hidden",
  },
  wallpaperOrb: {
    position: "absolute",
    width: 220,
    height: 220,
    borderRadius: 110,
    opacity: 0.025,
  },
  wallpaperOrbOne: {
    right: -80,
    top: 60,
  },
  wallpaperOrbTwo: {
    left: -120,
    bottom: 120,
  },
  wallpaperGrid: {
    position: "absolute",
    left: 22,
    right: 22,
    top: 32,
    bottom: 32,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 28,
    opacity: 0.04,
    transform: [{ rotate: "-1.5deg" }],
  },
  messageList: {
    paddingTop: 16,
    paddingBottom: 12,
    flexGrow: 1,
    justifyContent: "flex-start",
  },
  emptyInvertedFix: {
    flex: 1,
    transform: [{ scaleY: -1 }],
  },
  dateRow: {
    alignItems: "center",
    marginVertical: 12,
  },
  datePill: {
    paddingHorizontal: 14,
    paddingVertical: 5,
    borderRadius: 12,
  },
  dateText: {
    fontSize: 12,
    fontFamily: "Inter_500Medium",
  },
  typingRow: {
    paddingHorizontal: 18,
    paddingBottom: 4,
  },
  typingText: {
    fontSize: 12,
    fontStyle: "italic",
    fontFamily: "Inter_400Regular",
  },
  unreadDivider: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginVertical: 12,
    paddingHorizontal: 16,
  },
  unreadLine: {
    flex: 1,
    height: StyleSheet.hairlineWidth,
    opacity: 0.5,
  },
  unreadText: {
    fontSize: 12,
    fontFamily: "Inter_600SemiBold",
  },
  scrollbarTrack: {
    position: "absolute",
    right: 2,
    width: 4,
  },
  scrollbarThumb: {
    position: "absolute",
    left: 0,
    right: 0,
    width: 4,
    borderRadius: 2,
    opacity: 0.55,
  },
  scrollDownBtn: {
    position: "absolute",
    right: 16,
    bottom: 84,
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: StyleSheet.hairlineWidth,
    shadowColor: "#000",
    shadowOpacity: 0.15,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 4,
  },
  unreadJumpBtn: {
    position: "absolute",
    left: 72,
    right: 72,
    bottom: 86,
    minHeight: 38,
    borderRadius: 19,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 14,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    shadowColor: "#000",
    shadowOpacity: 0.14,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 4,
  },
  unreadJumpText: {
    fontSize: 13,
    fontFamily: "Inter_700Bold",
  },
  dropOverlay: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 70,
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
    backgroundColor: "rgba(0,0,0,0.18)",
  },
  dropCard: {
    alignItems: "center",
    gap: 8,
    maxWidth: 360,
    width: "100%",
    borderWidth: 2,
    borderStyle: "dashed",
    borderRadius: 24,
    paddingHorizontal: 24,
    paddingVertical: 28,
    shadowColor: "#000",
    shadowOpacity: 0.16,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 6,
  },
  dropTitle: {
    fontSize: 17,
    fontFamily: "Inter_700Bold",
  },
  dropSubtitle: {
    textAlign: "center",
    fontSize: 13,
    lineHeight: 18,
    fontFamily: "Inter_400Regular",
  },
  flash: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "#FF3B30",
    zIndex: 50,
  },
  flashEnemy: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "#34C759",
    zIndex: 50,
  },
  footerWrap: {
    paddingHorizontal: 12,
    paddingTop: 8,
  },
  thinkingRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingVertical: 16,
  },
  thinkingText: {
    fontSize: 13,
    fontStyle: "italic",
    fontFamily: "Inter_400Regular",
  },
  choicesInline: {
    gap: 8,
    paddingTop: 4,
    paddingBottom: 6,
  },
  choiceLine: {
    flexDirection: "row",
    gap: 8,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 11,
  },
  choiceBullet: {
    fontSize: 16,
    lineHeight: 20,
    fontFamily: "Inter_600SemiBold",
  },
  choiceLineText: {
    flex: 1,
    fontSize: 14,
    lineHeight: 20,
    fontFamily: "Inter_400Regular",
  },
});
