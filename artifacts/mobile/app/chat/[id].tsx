import {CollectorReading} from '@/components/davaq/CollectorReading';
import { CollectorCardAttachment } from '@/components/davaq/CollectorCardAttachment';
import { useCollectorPresentation } from '@/hooks/useCollectorPresentation';
import {collectorIds} from '@/components/davaq/CollectorProfile';
import { ChatBackPreview } from "@/components/chat/ChatBackPreview";
import {
  runScopedMessageBatch,
  toggleMessageSelection,
  type MessageAnchor,
} from "@/lib/chatInteractionPolicy";
import { Image } from "react-native";
import { ChatMediaPreview } from "@/components/ChatMediaPreview";
import { collectChatAlbums } from "@/lib/chatAlbumPolicy";
import {
  Stack,
  useLocalSearchParams,
  useRouter,
  useNavigation,
} from "expo-router";
import React, { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Animated,
  Easing,
  FlatList,
  Keyboard,
  KeyboardAvoidingView as SystemKeyboardAvoidingView,
  Platform,
  BackHandler,
  PanResponder,
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
import { KeyboardAvoidingView as SmoothKeyboardAvoidingView } from "react-native-keyboard-controller";
import {
  shouldCaptureChatEdgeBack,
  shouldCompleteChatEdgeBack,
} from "@/lib/chatEdgeBackPolicy";
import { MessageBubble } from "@/components/MessageBubble";
import { TcgChatCard } from "@/components/tcg/Assistant";
import { ChatRoomContextBar } from "@/components/chat/ChatRoomContextBar";
import { ChatRoomSheets } from "@/components/chat/ChatRoomSheets";
import { useUgcConsent, UgcConsentPrompt } from "@/components/UgcConsentPrompt";
import { FadeInView } from "@/components/FadeInView";
import { EmptyState } from "@/components/EmptyState";
import { TypingIndicator } from "@/components/chat/MessengerUI";
import { ChatRoomHeader } from "@/components/chat/ChatRoomHeader";
import { MessageComposer } from "@/components/MessageComposer";
import { useColors } from "@/hooks/useColors";
import { useChatPolling } from "@/hooks/useChatPolling";
import { useChatSendHandlers } from "@/hooks/useChatSendHandlers";
import { useReliableRoomMessages } from "@/hooks/useReliableRoomMessages";
import { useEphemeralSignal } from "@/hooks/useEphemeralSignal";
import { useInvertedChatListController } from "@/hooks/useInvertedChatListController";
import { useChatReadingPosition } from "@/hooks/useChatReadingPosition";
import { useChatRoomIdentity } from "@/hooks/useChatRoomIdentity";
import {
  useAnotherMeRoomSettings,
  useAnotherMeSummonStatus,
  useDismissAnotherMeSession,
  useSummonAnotherMe,
  useUpdateAnotherMeRoomSettings,
} from "@/hooks/useAnotherMe";
import {
  useGroupCall,
  RoomGroupCallBanner,
} from "@/components/GroupCallProvider";
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

const KeyboardAvoidingView =
  Platform.OS === "web"
    ? SystemKeyboardAvoidingView
    : SmoothKeyboardAvoidingView;

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
    nav.standalone === true ||
    window.matchMedia("(display-mode: standalone)").matches;
  return isIOS && standalone;
}

export default function ChatScreen({
  roomId,
  onBack,
  embedded = false,
}: { roomId?: string; onBack?: () => void; embedded?: boolean } = {}) {
  const params = useLocalSearchParams<{ id: string }>();
  const id = roomId ?? params.id;
  const router = useRouter();
  const navigation = useNavigation();
  const backPreviewAllowed = useRef(false);
  const queryClient = useQueryClient();
  const colors = useColors();
  const { width: viewportWidth } = useWindowDimensions();
  const [isIOSStandalonePwa, setIsIOSStandalonePwa] = useState(() =>
    getIsIOSStandalonePwa(),
  );
  const shouldAnimatePanel =
    !embedded && Platform.OS === "web" && !isIOSStandalonePwa;

  const [forwardTarget, setForwardTarget] = useState<Message | null>(null);

  const { data: me } = useGetMe();
  const ugcConsent = useUgcConsent(me?.id ?? null);
  const { activeProfile } = useCharacterProfiles();
  const writeScope = `${me?.id ?? ""}\u0000${activeProfile?.id ?? ""}\u0000${id}`;
  const writeScopeRef = useRef({ scope: writeScope, generation: 0 });
  if (writeScopeRef.current.scope !== writeScope) {
    writeScopeRef.current = {
      scope: writeScope,
      generation: writeScopeRef.current.generation + 1,
    };
  }
  const { data: room } = useGetRoom(id);
  const collectorMessageLabel = useCollectorPresentation(id);
  const { data: roomsForForward = [] } = useListRooms({
    query: { enabled: !!forwardTarget, queryKey: getListRoomsQueryKey() },
  });
  const messagesQuery = useReliableRoomMessages(id, {
    userId: me?.id,
    profileId: activeProfile?.id,
  });
  const { data: messages = [], refetch } = messagesQuery;
  const reading = useChatReadingPosition(
    me?.id && activeProfile?.id ? writeScope : null,
  );
  const { data: typingUsers = [], refetch: refetchTyping } =
    useGetTypingUsers(id);
  const leaveRoom = useLeaveRoom();
  const summonAnotherMe = useSummonAnotherMe();
  const dismissAnotherMe = useDismissAnotherMeSession();
  const updateRoomAnotherMeSettings = useUpdateAnotherMeRoomSettings(id);
  const { startCall, joinFromCard, supported: callSupported } = useCall();
  const groupCall = useGroupCall();

  const [replyTo, setReplyTo] = useState<Message | null>(null);
  const [actionMessage, setActionMessage] = useState<Message | null>(null);
  const [roomOptionsVisible, setRoomOptionsVisible] = useState(false);
  const [focus, setFocus] = useState<{
    anchor?: MessageAnchor;
    preview?: React.ReactNode;
  }>({});
  const [selectionIds, setSelectionIds] = useState<string[]>([]);
  const [batchBusy, setBatchBusy] = useState(false);
  const batchLock = useRef(false);
  const forwardBatch = useRef<Message[]>([]);
  const forwardKeys = useRef(new Map<string, string>());
  const reactionLocks = useRef(new Set<string>());
  useEffect(() => {
    setBatchBusy(false);
    setSelectionIds([]);
    setActionMessage(null);
    setFocus({});
    setForwardTarget(null);
    forwardBatch.current = [];
    forwardKeys.current.clear();
  }, [writeScope]);
  const toggleSelection = React.useCallback(
    (messageId: string) =>
      setSelectionIds((ids) => toggleMessageSelection(ids, messageId)),
    [],
  );
  const [selectedMessageId, setSelectedMessageId] = useState<string | null>(
    null,
  );
  const [stickerBadgeTarget, setStickerBadgeTarget] = useState<Message | null>(
    null,
  );
  const [panelReady, setPanelReady] = useState(!shouldAnimatePanel);
  const panelTranslateX = useRef(
    new Animated.Value(
      shouldAnimatePanel ? Math.max(48, viewportWidth || 360) : 0,
    ),
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
        Animated.timing(flashOpacity, {
          toValue: 0.5,
          duration: 80,
          useNativeDriver: useNative,
        }),
        Animated.timing(flashOpacity, {
          toValue: 0,
          duration: 340,
          useNativeDriver: useNative,
        }),
      ]).start();
    }
    if (enemyStruck) {
      // Same feedback as a player hit, but a green flash to signal we struck the
      // monster (an attack landing) rather than the party taking damage.
      const useNative = Platform.OS !== "web";
      enemyFlashOpacity.setValue(0);
      Animated.sequence([
        Animated.timing(enemyFlashOpacity, {
          toValue: 0.5,
          duration: 80,
          useNativeDriver: useNative,
        }),
        Animated.timing(enemyFlashOpacity, {
          toValue: 0,
          duration: 340,
          useNativeDriver: useNative,
        }),
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
        await queryClient.invalidateQueries({
          queryKey: getListRoomsQueryKey(),
        });
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
    hasTypingUsers: typingUsers.length > 0,
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
    revealQueueRef.current = revealQueueRef.current.filter((messageId) =>
      activeIds.has(messageId),
    );
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
  const albumGroupsRef = useRef<
    ReturnType<typeof collectChatAlbums> | undefined
  >(undefined);
  const albumGroups = React.useMemo(() => {
    const next = collectChatAlbums(visibleMessages, albumGroupsRef.current);
    albumGroupsRef.current = next;
    return next;
  }, [visibleMessages]);
  const listMessages = React.useMemo(() => {
    const displayed = visibleMessages.filter(
      (item) => !albumGroups.hidden.has(item.id) && !(collectorIds.includes(item.senderId) && (item as any).deletedAt),
    );
    return Platform.OS === "web" ? displayed : displayed.reverse();
  }, [visibleMessages, albumGroups]);
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

  useEffect(() => {
    if (!selectionIds.length || Platform.OS === "web") return;
    const subscription = BackHandler.addEventListener(
      "hardwareBackPress",
      () => {
        setSelectionIds([]);
        return true;
      },
    );
    return () => subscription.remove();
  }, [selectionIds.length]);
  const goBack = React.useCallback(() => {
    if (selectionIds.length) {
      setSelectionIds([]);
      return;
    }
    if (onBack) {
      onBack();
      return;
    }
    if (router.canGoBack()) router.back();
    else router.replace("/(tabs)/chats");
  }, [router, onBack, selectionIds.length]);

  const [backPreviewVisible, setBackPreviewVisible] = useState(false);
  const edgeBackX = useRef(new Animated.Value(0)).current;
  const [composerDismissRequest, setComposerDismissRequest] = useState(0);
  const backgroundTouch = useRef({ x: 0, y: 0 });
  const gestureOnMessage = useRef(true);
  const touchMessage = React.useCallback(() => {
    gestureOnMessage.current = true;
  }, []);
  const edgeBackEnabled =
    (Platform.OS !== "web" || (Platform.OS === "web" && viewportWidth < 960)) &&
    !embedded &&
    !selectionIds.length &&
    !actionMessage &&
    router.canGoBack();
  const edgeBack = React.useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponderCapture: () => {
          gestureOnMessage.current = true;
          return false;
        },
        onMoveShouldSetPanResponderCapture: (_, gesture) =>
          edgeBackEnabled &&
          !(Platform.OS === "ios" && gesture.x0 <= 24) &&
          !gestureOnMessage.current &&
          shouldCaptureChatEdgeBack(gesture, true),
        onPanResponderGrant: () => {
          const state = navigation.getState();
          const routes = state?.routes ?? [];
          const previous = routes[(state?.index ?? routes.length - 1) - 1];
          const nested = previous?.state;
          backPreviewAllowed.current =
            previous?.name === "(tabs)" &&
            nested?.routes[nested.index ?? 0]?.name === "chats";
          if (backPreviewAllowed.current)
            navigation.setOptions({ animation: "none" });
          setBackPreviewVisible(backPreviewAllowed.current);
          Keyboard.dismiss();
        },
        onPanResponderMove: (_, gesture) => {
          if (!backPreviewAllowed.current) return;
          edgeBackX.setValue(Math.max(0, Math.min(viewportWidth, gesture.dx)));
        },
        onPanResponderRelease: (_, gesture) => {
          const complete = shouldCompleteChatEdgeBack(gesture, viewportWidth);
          if (complete && !backPreviewAllowed.current) {
            goBack();
            return;
          }
          if (complete)
            Animated.timing(edgeBackX, {
              toValue: viewportWidth,
              duration: 160,
              useNativeDriver: Platform.OS !== "web",
            }).start(({ finished }) => {
              if (finished) goBack();
            });
          else
            Animated.spring(edgeBackX, {
              toValue: 0,
              useNativeDriver: Platform.OS !== "web",
              overshootClamping: true,
            }).start(({ finished }) => {
              if (!finished) return;
              if (backPreviewAllowed.current)
                navigation.setOptions({
                  animation:
                    Platform.OS === "web" ? "none" : "slide_from_right",
                });
              setBackPreviewVisible(false);
            });
        },
        onPanResponderTerminate: () =>
          Animated.spring(edgeBackX, {
            toValue: 0,
            useNativeDriver: Platform.OS !== "web",
            overshootClamping: true,
          }).start(({ finished }) => {
            if (!finished) return;
            if (backPreviewAllowed.current)
              navigation.setOptions({
                animation: Platform.OS === "web" ? "none" : "slide_from_right",
              });
            setBackPreviewVisible(false);
          }),
      }),
    [edgeBackEnabled, edgeBackX, viewportWidth, goBack, navigation],
  );
  useEffect(() => {
    edgeBackX.setValue(0);
    return () => edgeBackX.stopAnimation();
  }, [id, edgeBackX]);

  const {
    isDirect,
    otherMember,
    otherDisplayName,
    isOtherOnline,
    headerTitle,
    headerSubtitle,
  } = useChatRoomIdentity({
    room,
    meId: me?.id,
    isGroupRoom,
    isDungeon,
  });
  const { equippedStar } = usePlayMode();
  const myChatIdentity = equippedStar
    ? `내 프로필 · STAR ${equippedStar.displayName}`
    : "내 프로필 · FAN";
  const { data: targetAnotherMeStatus, refetch: refetchTargetAnotherMeStatus } =
    useAnotherMeSummonStatus(
      isDirect ? id : undefined,
      otherMember?.id,
      isDirect && !!otherMember,
    );
  const { data: myAnotherMeStatus, refetch: refetchMyAnotherMeStatus } =
    useAnotherMeSummonStatus(
      isDirect ? id : undefined,
      me?.id,
      isDirect && !!me,
    );
  const { data: roomAnotherMeSettings, refetch: refetchRoomAnotherMeSettings } =
    useAnotherMeRoomSettings(isDirect ? id : undefined);
  const activeAnotherMeSession =
    myAnotherMeStatus?.activeSession ??
    targetAnotherMeStatus?.activeSession ??
    null;
  const canSummonAnotherMe =
    !!targetAnotherMeStatus?.canSummon && !activeAnotherMeSession;
  const roomSummonOverride = roomAnotherMeSettings?.summonEnabled ?? null;
  const roomSummonExplicitlyEnabled = roomSummonOverride === true;
  const roomSummonStatusLabel =
    roomSummonOverride == null
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
  }, [
    refetchMyAnotherMeStatus,
    refetchRoomAnotherMeSettings,
    refetchTargetAnotherMeStatus,
  ]);

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

  const canCall =
    callSupported &&
    !groupCall.busy &&
    ((isDirect && !!otherMember) || isGroupRoom);

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
    loadPrevious,
    restoreError,
    retryRestore,
    skipRestore,
    awayFromLatest,
    scrollToBottom,
    scrollToMessage: scrollToListMessage,
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
    messagesReady:
      !!me?.id && !!activeProfile?.id && messagesQuery.data !== undefined,
    positionScope: writeScope,
    positionReady: reading.ready,
    readingPosition: reading.position,
    savePosition: reading.save,
    loadOlder: messagesQuery.loadOlder,
    hasOlder: messagesQuery.hasOlder,
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
      setTimeout(
        () =>
          setSelectedMessageId((current) =>
            current === messageId ? null : current,
          ),
        1400,
      );
      return true;
    },
    [scrollToListMessage],
  );

  useEffect(() => {
    if (!isDirect || !otherMember?.id || !lastRealMessageId) return;
    void refetchTargetAnotherMeStatus();
    void refetchMyAnotherMeStatus();
  }, [
    isDirect,
    lastRealMessageId,
    otherMember?.id,
    refetchMyAnotherMeStatus,
    refetchTargetAnotherMeStatus,
  ]);

  useEffect(() => {
    if (!isDirect || targetAnotherMeStatus?.reason !== "waiting") return;
    const remainingSeconds = targetAnotherMeStatus.remainingSeconds ?? 0;
    const delayMs = Math.min(
      Math.max(remainingSeconds * 1000 + 250, 500),
      60_000,
    );
    const timer = setTimeout(() => {
      void refetchTargetAnotherMeStatus();
    }, delayMs);
    return () => clearTimeout(timer);
  }, [
    isDirect,
    refetchTargetAnotherMeStatus,
    targetAnotherMeStatus?.reason,
    targetAnotherMeStatus?.remainingSeconds,
  ]);

  // On web/PWA the OS push fires the instant a message is inserted, but this
  // screen only polls every 3s — so the banner/sound would beat the on-screen
  // message. When the service worker reports a push for THIS room, refetch right
  // away so the message lands in step with the notification.
  useEffect(() => {
    if (Platform.OS !== "web") return;
    if (typeof navigator === "undefined" || !("serviceWorker" in navigator))
      return;
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
    return () =>
      navigator.serviceWorker.removeEventListener("message", onMessage);
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
    handleSendGif,
    handlePickImage,
    mediaPreview,
    uploadPreviews,
    failedPhotoCount,
    retryPhotos,
    discardFailedPhotos,
    handlePickFile,
    handleCancelUpload,
    retryMessage,
    cancelFailedMessage,
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
    ensureUgcConsent: ugcConsent.ensureConsent,
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
      await summonAnotherMe.mutateAsync({
        roomId: id,
        targetUserId: otherMember.id,
      });
      await Promise.all([
        refetch(),
        refetchTargetAnotherMeStatus(),
        refetchMyAnotherMeStatus(),
      ]);
    } catch {
      crossAlert(
        "소환 실패",
        "아직 DavaQ를 소환할 수 없거나 상대가 허용하지 않았어요.",
      );
    }
  }, [
    id,
    otherMember?.id,
    refetch,
    refetchMyAnotherMeStatus,
    refetchTargetAnotherMeStatus,
    summonAnotherMe,
  ]);

  const handleDismissAnotherMe = React.useCallback(async () => {
    if (!activeAnotherMeSession || dismissAnotherMe.isPending) return;
    try {
      await dismissAnotherMe.mutateAsync(activeAnotherMeSession.id);
      await Promise.all([
        refetch(),
        refetchTargetAnotherMeStatus(),
        refetchMyAnotherMeStatus(),
      ]);
    } catch {
      crossAlert("오류", "DavaQ를 퇴장시키지 못했습니다.");
    }
  }, [
    activeAnotherMeSession,
    dismissAnotherMe,
    refetch,
    refetchMyAnotherMeStatus,
    refetchTargetAnotherMeStatus,
  ]);

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
    const text =
      message.type === "text" ? message.content : summarizeMessage(message);
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

      const currentPinnedId = (room as any)?.pinnedMessageId as
        | string
        | null
        | undefined;
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
      if (
        !forwardTarget ||
        batchLock.current ||
        writeScopeRef.current.scope !== writeScope
      )
        return;
      batchLock.current = true;
      setBatchBusy(true);
      const scope = writeScopeRef.current;
      try {
        const targets = forwardBatch.current.length
          ? [...forwardBatch.current]
          : [forwardTarget];
        let created: Message | undefined;
        const completed = await runScopedMessageBatch({
          items: targets,
          isCurrent: () => writeScopeRef.current === scope,
          send: async (target) => {
            const key = `${targetRoomId}:${target.id}`;
            if (!forwardKeys.current.has(key))
              forwardKeys.current.set(
                key,
                `m-${Date.now()}-${Math.random().toString(36).slice(2)}`,
              );
            created = await forwardMessage(
              id,
              target.id,
              targetRoomId,
              forwardKeys.current.get(key),
            );
          },
          onCommitted: (target) => {
            forwardBatch.current = forwardBatch.current.filter(
              (item) => item.id !== target.id,
            );
            setSelectionIds((ids) =>
              ids.filter((value) => value !== target.id),
            );
          },
        });
        if (!completed) return;
        if (writeScopeRef.current !== scope) return;
        setForwardTarget(null);
        await Promise.all([
          queryClient.invalidateQueries({
            queryKey: getFetchRoomMessagesQueryKey(targetRoomId),
          }),
          queryClient.invalidateQueries({
            queryKey: getGetRoomQueryKey(targetRoomId),
          }),
          queryClient.invalidateQueries({ queryKey: getListRoomsQueryKey() }),
        ]);
        if (targetRoomId === id && created?.id) jumpToBottom();
      } catch {
        if (writeScopeRef.current === scope)
          crossAlert(
            "오류",
            "전달하지 못한 메시지가 남아 있습니다. 다시 시도해주세요.",
          );
      } finally {
        batchLock.current = false;
        if (writeScopeRef.current === scope) setBatchBusy(false);
      }
    },
    [forwardTarget, id, queryClient, jumpToBottom, writeScope],
  );

  const performStickerBadge = React.useCallback(
    async (code: string, target = stickerBadgeTarget) => {
      if (
        !target ||
        reactionLocks.current.has(target.id) ||
        writeScopeRef.current.scope !== writeScope
      )
        return;
      const scope = writeScopeRef.current;
      reactionLocks.current.add(target.id);
      try {
        const latest =
          listMessagesRef.current.find((message) => message.id === target.id) ??
          target;
        const remove =
          latest.stickerBadges?.some(
            (badge) => badge.userId === me?.id && badge.code === code,
          ) ?? false;
        await addMessageStickerBadge(id, target.id, code, remove);
        if (writeScopeRef.current !== scope) return;
        setActionMessage(null);
        setStickerBadgeTarget(null);
        await refreshCurrentRoom();
      } catch {
        if (writeScopeRef.current === scope)
          crossAlert("오류", "반응을 변경하지 못했습니다. 다시 시도해주세요.");
      } finally {
        reactionLocks.current.delete(target.id);
      }
    },
    [id, refreshCurrentRoom, stickerBadgeTarget, me?.id, writeScope],
  );

  const typingLabel =
    typingUsers.length === 0
      ? null
      : typingUsers.length === 1
        ? `${typingUsers[0].nickname}님이 입력 중...`
        : `${typingUsers[0].nickname}님 외 ${typingUsers.length - 1}명이 입력 중...`;
  const pinnedMessageId = ((room as any)?.pinnedMessageId ?? null) as
    | string
    | null;
  const webScrollViewportRef = useRef<any>(null);
  useEffect(() => {
    if (Platform.OS !== "web") return;
    const element = webScrollViewportRef.current;
    element?.addEventListener("wheel", onWebWheel, { passive: true });
    return () => element?.removeEventListener("wheel", onWebWheel);
  }, [onWebWheel]);

  const actionIsMine = !!actionMessage && actionMessage.senderId === me?.id;
  const actionIsDeleted = !!(actionMessage as any)?.deletedAt;
  const actionIsPinned =
    !!actionMessage && pinnedMessageId === actionMessage.id;
  const composerReplyPreview = React.useMemo(
    () =>
      replyTo
        ? {
            senderName: userDisplayName(replyTo.sender as any, ""),
            content: summarizeMessage(replyTo),
          }
        : null,
    [replyTo],
  );
  const handleCancelReply = React.useCallback(() => setReplyTo(null), []);
  const handleMessageLongPress = React.useCallback(
    (messageId: string, anchor?: MessageAnchor, preview?: React.ReactNode) => {
      const message = listMessagesRef.current.find(
        (item) => item.id === messageId,
      );
      if (message) {
        setFocus({ anchor, preview });
        setActionMessage(message);
      }
    },
    [],
  );
  const replyToMessage = React.useCallback((messageId: string) => {
    const message = listMessagesRef.current.find(
      (item) => item.id === messageId,
    );
    if (message && !(message as any).deletedAt) setReplyTo(message);
  }, []);
  const handleReaction = React.useCallback(
    (messageId: string, code: string) => {
      const message = listMessagesRef.current.find(
        (item) => item.id === messageId,
      );
      if (message) void performStickerBadge(code, message);
    },
    [performStickerBadge],
  );
  useEffect(() => {
    if (
      actionMessage &&
      !listMessages.some(
        (message) =>
          message.id === actionMessage.id && !(message as any).deletedAt,
      )
    )
      setActionMessage(null);
  }, [listMessages, actionMessage]);
  const deleteSelected = async () => {
    if (batchLock.current || writeScopeRef.current.scope !== writeScope) return;
    batchLock.current = true;
    setBatchBusy(true);
    const scope = writeScopeRef.current;
    try {
      const completed = await runScopedMessageBatch({
        items: selectionIds,
        isCurrent: () => writeScopeRef.current === scope,
        send: (messageId) => deleteMessage(id, messageId, "me"),
        onCommitted: (messageId) =>
          setSelectionIds((ids) => ids.filter((value) => value !== messageId)),
      });
      if (!completed) return;
      await refreshCurrentRoom();
    } catch {
      if (writeScopeRef.current === scope) {
        await refreshCurrentRoom();
        crossAlert(
          "오류",
          "삭제하지 못한 메시지가 선택되어 있습니다. 다시 시도해주세요.",
        );
      }
    } finally {
      batchLock.current = false;
      if (writeScopeRef.current === scope) setBatchBusy(false);
    }
  };
  const confirmDeleteSelected = () => {
    const prompt = `${selectionIds.length}개 메시지를 나에게만 삭제할까요?`;
    if (Platform.OS === "web") {
      if (window.confirm(prompt)) void deleteSelected();
    } else
      Alert.alert("선택 메시지 삭제", prompt, [
        { text: "취소", style: "cancel" },
        {
          text: "삭제",
          style: "destructive",
          onPress: () => void deleteSelected(),
        },
      ]);
  };
  const forwardSelected = async () => {
    if (writeScopeRef.current.scope !== writeScope) return;
    const scope = writeScopeRef.current;
    if (!(await ugcConsent.ensureConsent()) || writeScopeRef.current !== scope)
      return;
    const selected = new Set(selectionIds);
    const messages = listMessagesRef.current.filter((message) =>
      selected.has(message.id),
    );
    if (
      !messages.length ||
      messages.some(
        (message) =>
          !["text", "image", "file", "sticker"].includes(message.type) ||
          (message as any).deletedAt,
      )
    ) {
      crossAlert("전달 불가", "텍스트·사진·파일·스티커 메시지만 선택해주세요.");
      return;
    }
    forwardKeys.current.clear();
    forwardBatch.current = messages.sort(
      (a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt),
    );
    setForwardTarget(forwardBatch.current[0]);
  };

  const replyNavigationRef = useRef({
    scrollToMessage,
    representatives: albumGroups.representativeById,
  });
  replyNavigationRef.current = {
    scrollToMessage,
    representatives: albumGroups.representativeById,
  };
  const handlePressReply = React.useCallback((messageId: string) => {
    const current = replyNavigationRef.current;
    current.scrollToMessage(
      current.representatives.get(messageId) ?? messageId,
    );
  }, []);

  const renderMessageItem = React.useCallback(
    ({ item, index }: { item: Message; index: number }) => {
      const authorKind = ((item as any).authorKind ?? "user") as string;
      const isUserMessage = authorKind === "user";
      const isAnotherMe = authorKind === "another_me";
      const isMe = item.senderId === me?.id;
      const isDM = isSystemAccount(item.sender);
      const prevMsg = listMessages[index + (Platform.OS === "web" ? -1 : 1)];
      const anotherMeOwnerName =
        ((item as any).metadata?.ownerName as string | undefined) ??
        userDisplayName(item.sender as any, "상대");
      const compact =
        !!prevMsg &&
        prevMsg.senderId === item.senderId &&
        prevMsg.authorKind === item.authorKind &&
        isSameDay(prevMsg.createdAt, item.createdAt) &&
        Math.abs(Date.parse(item.createdAt) - Date.parse(prevMsg.createdAt)) <
          300000;
      const showSender =
        !compact && (isAnotherMe || (isMultiParty && !isMe && !isDM));
      const showDate =
        !prevMsg || !isSameDay(prevMsg.createdAt, item.createdAt);
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
        !String(item.id).startsWith("temp-") &&
        item.type !== "system" &&
        !isDM &&
        !isAnotherMe;
      const bubble = (
        <>
          {item.id === anchorMsgId ||
          (anchorMsgId &&
            albumGroups.representativeById.get(anchorMsgId) === item.id) ? (
            <View style={styles.unreadDivider}>
              <View
                style={[styles.unreadLine, { backgroundColor: colors.primary }]}
              />
              <Text style={[styles.unreadText, { color: colors.primary }]}>
                새 메시지
              </Text>
              <View
                style={[styles.unreadLine, { backgroundColor: colors.primary }]}
              />
            </View>
          ) : null}
          {showDate ? (
            <View style={styles.dateRow}>
              <View
                style={[styles.datePill, { backgroundColor: colors.muted }]}
              >
                <Text
                  style={[styles.dateText, { color: colors.mutedForeground }]}
                >
                  {formatDayLabel(item.createdAt)}
                </Text>
              </View>
            </View>
          ) : null}
          {(item as any).metadata?.tcgTradeId && !(item as any).deletedAt ? (
            <View onTouchStart={touchMessage}>
              <TcgChatCard tradeId={(item as any).metadata.tcgTradeId} />
            </View>
          ) : null}
          {collectorMessageLabel && (item as any).authorKind === "bot" && (item as any).metadata?.collectorAi === true && !(item as any).deletedAt ? <Text style={{color:colors.mutedForeground,fontSize:11,marginHorizontal:16,marginTop:8}}>{collectorMessageLabel}</Text> : null}
          {(item as any).authorKind === "bot" && typeof (item as any).metadata?.topicCardId === "string" && !(item as any).deletedAt ? <CollectorCardAttachment id={(item as any).metadata.topicCardId} /> : null}
          <MessageBubble
            messageId={item.id}
            content={item.content}
            isMe={isMe}
            isDM={isDM}
            isAnotherMe={isAnotherMe}
            senderName={
              isAnotherMe
                ? anotherMeOwnerName
                : (item.senderProfile?.displayName ??
                  userDisplayName(item.sender as any, ""))
            }
            senderAvatar={item.senderProfile?.profileImageUrl ?? null}
            onPressSender={collectorIds.includes(item.senderId) ? ()=>router.push(("/collector/"+item.senderId) as never) : undefined}
            senderCharacterType={
              item.senderProfile?.type as
                | "fan"
                | "star"
                | "official_ai"
                | undefined
            }
            time={formatMsgTime(item.createdAt)}
            type={item.type}
            imageUri={item.type === "image" ? item.content : undefined}
            imageAlbum={albumGroups.albums.get(item.id)}
            imageCaption={
              albumGroups.captions.get(item.id) ??
              (item as any).metadata?.caption
            }
            imageThumbnail={
              (item as any).metadata?.imageThumbnail ??
              (item as any).metadata?.videoThumbnail
            }
            videoDuration={(item as any).metadata?.videoDurationSec}
            imageAspect={
              (item as any).metadata?.imageWidth /
              (item as any).metadata?.imageHeight
            }
            showSender={showSender}
            compact={compact}
            readLabel={readLabel}
            onJoinCall={handleJoinCall}
            onLongPress={canActOnMessage ? handleMessageLongPress : undefined}
            onTouchMessage={touchMessage}
            onReply={
              canActOnMessage &&
              !(item as any).deletedAt &&
              !actionMessage &&
              !selectionIds.length
                ? replyToMessage
                : undefined
            }
            selectionMode={selectionIds.length > 0 && canActOnMessage}
            onSelect={toggleSelection}
            viewerId={me?.id}
            onReact={canActOnMessage ? handleReaction : undefined}
            selected={
              selectionIds.includes(item.id) || selectedMessageId === item.id
            }
            deletedAt={(item as any).deletedAt ?? null}
            replyTo={(item as any).replyTo ?? null}
            stickerBadges={(item as any).stickerBadges ?? EMPTY_STICKER_BADGES}
            linkPreview={(item as any).linkPreview ?? null}
            onPressReply={handlePressReply}
            retryClientMessageId={
              deliveryState === "failed" ? item.clientMessageId : null
            }
            onRetryMessage={retryMessage}
            onCancelMessage={cancelFailedMessage}
          />
        </>
      );
      // In dungeons, freshly-revealed lines fade/slide in; history and
      // non-dungeon messages render instantly.
      return isDungeon ? (
        <FadeInView animate={staggeredIdsRef.current.has(item.id)}>
          {bubble}
        </FadeInView>
      ) : (
        <View>{bubble}</View>
      );
    },
    [
      anchorMsgId,
      collectorMessageLabel,
      router,
      colors.muted,
      colors.mutedForeground,
      colors.primary,
      handleJoinCall,
      handleMessageLongPress,
      isDungeon,
      isGroupRoom,
      isMultiParty,
      listMessages,
      albumGroups,
      me?.id,
      readReceiptOtherCount,
      retryMessage,
      cancelFailedMessage,
      handlePressReply,
      touchMessage,
      replyToMessage,
      selectedMessageId,
      selectionIds,
      toggleSelection,
      handleReaction,
      actionMessage,
    ],
  );

  return (
    <KeyboardAvoidingView
      style={styles.flex}
      behavior={Platform.OS === "ios" ? "padding" : "height"}
      keyboardVerticalOffset={0}
    >
      {!embedded ? (
        <Stack.Screen
          options={{
            gestureEnabled:
              Platform.OS === "ios" && !selectionIds.length && !actionMessage,
            fullScreenGestureEnabled: false,
          }}
        />
      ) : null}
      {edgeBackEnabled && backPreviewVisible ? <ChatBackPreview /> : null}
      <Animated.View
        {...(edgeBackEnabled ? edgeBack.panHandlers : {})}
        style={[
          styles.container,
          { backgroundColor: colors.background },
          edgeBackEnabled ? { transform: [{ translateX: edgeBackX }] } : null,
          shouldAnimatePanel
            ? {
                transform: [
                  { translateX: Animated.add(panelTranslateX, edgeBackX) },
                ],
              }
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
          showAnotherMeToggle={false}
          anotherMeEnabled={roomSummonExplicitlyEnabled}
          anotherMePending={updateRoomAnotherMeSettings.isPending}
          onOpenIdentity={() => {
            if (isGroupRoom)
              router.push({ pathname: "/group/members", params: { id } });
            else if (otherMember)
              router.push({
                pathname: "/profile/[userId]",
                params: { userId: otherMember.id },
              });
          }}
          onBack={goBack}
          onToggleAnotherMe={(enabled) =>
            void handleRoomAnotherMeToggle(enabled)
          }
          onStartCall={(media) => {
            if (isGroupRoom) void groupCall.start(id, media);
            else if (otherMember)
              startCall(otherMember.id, otherDisplayName, id, media);
          }}
          onInvite={() =>
            router.push({ pathname: "/group/invite", params: { id } })
          }
          onOpenOptions={() => setRoomOptionsVisible(true)}
        />

        {selectionIds.length > 0 && (
          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              gap: 16,
              padding: 12,
              backgroundColor: colors.card,
            }}
          >
            <Text style={{ color: colors.foreground, flex: 1 }}>
              {selectionIds.length}개 선택{batchBusy ? " · 처리 중" : ""}
            </Text>
            <Pressable
              disabled={batchBusy}
              accessibilityLabel="선택 메시지 복사"
              onPress={() => {
                const ids = new Set(selectionIds);
                const messages = listMessagesRef.current
                  .filter(
                    (message) =>
                      ids.has(message.id) && !(message as any).deletedAt,
                  )
                  .sort(
                    (a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt),
                  );
                if (messages.length)
                  void handleCopyMessage({
                    ...messages[0],
                    type: "text",
                    content: messages.map(summarizeMessage).join("\n"),
                  });
              }}
            >
              <Text style={{ color: colors.primary }}>복사</Text>
            </Pressable>
            <Pressable
              disabled={batchBusy}
              accessibilityLabel="선택 메시지 전달"
              onPress={() => void forwardSelected()}
            >
              <Text style={{ color: colors.primary }}>전달</Text>
            </Pressable>
            <Pressable
              disabled={batchBusy}
              accessibilityLabel="선택 메시지 나에게만 삭제"
              onPress={confirmDeleteSelected}
            >
              <Text style={{ color: colors.destructive }}>삭제</Text>
            </Pressable>
            <Pressable
              disabled={batchBusy}
              accessibilityLabel="메시지 선택 취소"
              onPress={() => setSelectionIds([])}
            >
              <Text style={{ color: colors.primary }}>취소</Text>
            </Pressable>
          </View>
        )}
        {isGroupRoom && <RoomGroupCallBanner roomId={id} />}

        <View pointerEvents="none" style={styles.wallpaper}>
          <View
            style={[
              styles.wallpaperOrb,
              styles.wallpaperOrbOne,
              { backgroundColor: colors.primary },
            ]}
          />
          <View
            style={[
              styles.wallpaperOrb,
              styles.wallpaperOrbTwo,
              { backgroundColor: colors.accent },
            ]}
          />
          <View
            style={[styles.wallpaperGrid, { borderColor: colors.border }]}
          />
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
        <CollectorReading key={id} roomId={id} />
        <View
          onStartShouldSetResponderCapture={(event) => {
            gestureOnMessage.current = false;
            backgroundTouch.current = {
              x: event.nativeEvent.pageX,
              y: event.nativeEvent.pageY,
            };
            return false;
          }}
          onTouchEnd={(event) => {
            const { pageX, pageY } = event.nativeEvent;
            if (
              !gestureOnMessage.current &&
              Math.hypot(
                pageX - backgroundTouch.current.x,
                pageY - backgroundTouch.current.y,
              ) < 8
            ) {
              setComposerDismissRequest((value) => value + 1);
            }
          }}
          ref={webScrollViewportRef}
          style={{ flex: 1, minHeight: 0, position: "relative" }}
          {...(Platform.OS === "web"
            ? ({
                onPointerDown: onScrollBeginDrag,
                onPointerUp: onScrollEndDrag,
              } as any)
            : {})}
        >
          <FlatList
            key={id}
            ref={listRef}
            data={listMessages}
            inverted={Platform.OS !== "web"}
            contentInsetAdjustmentBehavior="never"
            automaticallyAdjustContentInsets={false}
            automaticallyAdjustKeyboardInsets={false}
            maintainVisibleContentPosition={
              Platform.OS === "web" ? undefined : { minIndexForVisible: 0 }
            }
            keyExtractor={(item) =>
              clientKeyRef.current.get(item.id) ??
              item.clientMessageId ??
              item.id
            }
            style={[styles.flex, { opacity: listReady ? 1 : 0 }]}
            contentContainerStyle={styles.messageList}
            renderItem={renderMessageItem}
            initialNumToRender={12}
            maxToRenderPerBatch={8}
            updateCellsBatchingPeriod={40}
            removeClippedSubviews={false}
            windowSize={7}
            {...{
              [Platform.OS === "web"
                ? "ListFooterComponent"
                : "ListHeaderComponent"]: isDungeon ? (
                <View style={styles.footerWrap}>
                  {dmThinking ? (
                    <View style={styles.thinkingRow}>
                      <ActivityIndicator size="small" color={colors.primary} />
                      <Text
                        style={[
                          styles.thinkingText,
                          { color: colors.mutedForeground },
                        ]}
                      >
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
                            <Text
                              style={[
                                styles.choiceBullet,
                                { color: colors.primary },
                              ]}
                            >
                              ›
                            </Text>
                            <Text
                              style={[
                                styles.choiceLineText,
                                { color: colors.foreground },
                              ]}
                            >
                              {c}
                            </Text>
                          </Pressable>
                        </FadeInView>
                      ))}
                    </View>
                  ) : null}
                </View>
              ) : null,
            }}
            {...{
              [Platform.OS === "web"
                ? "ListHeaderComponent"
                : "ListFooterComponent"]:
                messages.length > 0 && messagesQuery.hasOlder ? (
                  <Pressable
                    accessibilityRole="button"
                    disabled={messagesQuery.loadingOlder}
                    onPress={() => {
                      void loadPrevious().catch(() => {});
                    }}
                    style={{ padding: 16, alignItems: "center" }}
                  >
                    {messagesQuery.loadingOlder ? (
                      <ActivityIndicator color={colors.primary} />
                    ) : null}
                    <Text style={{ color: colors.primary }}>
                      {messagesQuery.olderError ||
                        (messagesQuery.loadingOlder
                          ? "이전 메시지 불러오는 중…"
                          : "이전 메시지 더 보기")}
                    </Text>
                  </Pressable>
                ) : null,
            }}
            onEndReached={
              Platform.OS !== "web" && listReady && messagesQuery.hasOlder
                ? () => {
                    void loadPrevious().catch(() => {});
                  }
                : undefined
            }
            onEndReachedThreshold={0.2}
            onScrollToIndexFailed={onScrollToIndexFailed}
            onContentSizeChange={onContentSizeChange}
            onViewableItemsChanged={onViewableItemsChanged}
            viewabilityConfig={viewabilityConfig}
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="always"
            onTouchEnd={
              Platform.OS === "web" ? undefined : () => Keyboard.dismiss()
            }
            onScrollBeginDrag={onScrollBeginDrag}
            onScrollEndDrag={onScrollEndDrag}
            onMomentumScrollBegin={onMomentumScrollBegin}
            onMomentumScrollEnd={onMomentumScrollEnd}
            keyboardDismissMode={
              Platform.OS === "web"
                ? "none"
                : Platform.OS === "ios"
                  ? "interactive"
                  : "on-drag"
            }
            onScroll={onScroll}
            scrollEventThrottle={16}
            onLayout={onLayout}
          />

          {!listReady && !restoreError ? (
            <View style={{ padding: 16, alignItems: "center" }}>
              <ActivityIndicator color={colors.primary} />
              <Text style={{ color: colors.mutedForeground }}>
                대화 위치 불러오는 중…
              </Text>
            </View>
          ) : null}
          {restoreError ? (
            <View style={{ padding: 16, backgroundColor: colors.card }}>
              <Text style={{ color: colors.foreground }}>{restoreError}</Text>
              <Pressable accessibilityRole="button" onPress={retryRestore}>
                <Text style={{ padding: 12, color: colors.primary }}>
                  이전 위치 계속 불러오기
                </Text>
              </Pressable>
              <Pressable accessibilityRole="button" onPress={skipRestore}>
                <Text style={{ padding: 12, color: colors.primary }}>
                  최신 메시지로 이동
                </Text>
              </Pressable>
            </View>
          ) : null}
          {messagesQuery.data !== undefined && listMessages.length === 0 ? (
            <View pointerEvents="none" style={StyleSheet.absoluteFillObject}>
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
          ) : null}
          {messagesQuery.data === undefined ? (
            <View
              style={{
                ...StyleSheet.absoluteFillObject,
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              {messagesQuery.isError ? (
                <Pressable
                  accessibilityRole="button"
                  onPress={() => void refetch()}
                  style={{ padding: 20 }}
                >
                  <Text style={{ color: colors.primary }}>
                    메시지를 불러오지 못했습니다. 다시 시도
                  </Text>
                </Pressable>
              ) : (
                <ActivityIndicator color={colors.primary} />
              )}
            </View>
          ) : null}
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
              <Text
                style={[styles.unreadJumpText, { color: colors.foreground }]}
                numberOfLines={1}
              >
                새 메시지 {entryUnreadCount}개
              </Text>
            </Pressable>
          ) : null}

          {awayFromLatest ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="최신 메시지로 이동"
              onPress={jumpToBottom}
              style={[
                styles.scrollDownBtn,
                {
                  backgroundColor: colors.secondary + "E8",
                  borderColor: colors.border,
                },
              ]}
              hitSlop={8}
            >
              <Feather
                name="chevron-down"
                size={18}
                color={colors.foreground}
              />
              <Text style={{ color: colors.foreground, fontSize: 12 }}>
                최신 메시지
              </Text>
            </Pressable>
          ) : null}
        </View>

        {isWebDraggingUpload && !isDungeon ? (
          <View pointerEvents="none" style={styles.dropOverlay}>
            <View
              style={[
                styles.dropCard,
                { backgroundColor: colors.card, borderColor: colors.primary },
              ]}
            >
              <Feather name="upload-cloud" size={34} color={colors.primary} />
              <Text style={[styles.dropTitle, { color: colors.foreground }]}>
                여기에 놓아 전송
              </Text>
              <Text
                style={[styles.dropSubtitle, { color: colors.mutedForeground }]}
              >
                이미지는 사진으로, 그 외 파일은 파일로 전송됩니다
              </Text>
            </View>
          </View>
        ) : null}

        {typingLabel ? <TypingIndicator label={typingLabel} /> : null}

        {/* Dungeon is played entirely via the AI's choice buttons — no free-text
          input bar. Every other room keeps the composer. The composer owns its
          own text state so typing never re-renders this screen / message list. */}
        {!isDungeon ? (
          <>
            <ChatMediaPreview request={mediaPreview} />
            {uploadPreviews.length ? (
              <View
                accessibilityLabel="전송 중인 사진"
                style={{
                  flexDirection: "row",
                  padding: 8,
                  gap: 8,
                  backgroundColor: colors.card,
                }}
              >
                <Text style={{ color: colors.mutedForeground }}>
                  사진 {uploadPreviews.length}장 전송 중
                </Text>
                {uploadPreviews.slice(0, 4).map((uri, index) => (
                  <Image
                    key={`${uri}-${index}`}
                    source={{ uri }}
                    style={{ width: 40, height: 40, borderRadius: 8 }}
                  />
                ))}
              </View>
            ) : null}
            {failedPhotoCount ? (
              <View
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  padding: 8,
                  backgroundColor: colors.card,
                }}
              >
                <Text style={{ flex: 1, color: colors.foreground }}>
                  사진 {failedPhotoCount}장 전송 실패
                </Text>
                <Pressable
                  accessibilityRole="button"
                  onPress={retryPhotos}
                  style={{
                    minHeight: 48,
                    justifyContent: "center",
                    paddingHorizontal: 12,
                  }}
                >
                  <Text style={{ color: colors.primary }}>재시도</Text>
                </Pressable>
                <Pressable
                  accessibilityRole="button"
                  onPress={discardFailedPhotos}
                  style={{
                    minHeight: 48,
                    justifyContent: "center",
                    paddingHorizontal: 12,
                  }}
                >
                  <Text style={{ color: colors.mutedForeground }}>취소</Text>
                </Pressable>
              </View>
            ) : null}
            <MessageComposer
              key={`${me?.id}:${activeProfile?.id}:${id}`}
              draftKey={
                me?.id && activeProfile?.id
                  ? `${me.id}:${activeProfile.id}:${id}`
                  : undefined
              }
              sending={isSending}
              uploading={uploadTask?.kind ?? null}
              uploadProgress={uploadTask?.progress ?? null}
              onCancelUpload={uploadTask ? handleCancelUpload : undefined}
              onSend={sendText}
              onTyping={handleTyping}
              onPickImage={handlePickImage}
              onPickFile={handlePickFile}
              dismissRequest={composerDismissRequest}
              onSendSticker={handleSendSticker}
              onSendGif={handleSendGif}
              replyPreview={composerReplyPreview}
              onCancelReply={handleCancelReply}
            />
          </>
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
            onToggleAnotherMe: (enabled) =>
              void handleRoomAnotherMeToggle(enabled),
            onUseGlobalAnotherMe: () => void handleRoomAnotherMeUseGlobal(),
            onLeave: handleLeave,
          }}
          messageActions={{
            message: actionMessage,
            anchor: focus.anchor,
            preview: focus.preview,
            viewerId: me?.id,
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
              setSelectionIds([message.id]);
              setActionMessage(null);
            },
            onTogglePin: (message) => {
              if (actionIsPinned) void performUnpin();
              else void performPin(message);
            },
            onForward: async (message) => {
              if (writeScopeRef.current.scope !== writeScope) return;
              const expectedScope = writeScopeRef.current;
              if (
                !(await ugcConsent.ensureConsent()) ||
                writeScopeRef.current !== expectedScope
              )
                return;
              forwardBatch.current = [];
              forwardKeys.current.clear();
              setForwardTarget(message);
            },
            onReact: (message, code) => void performStickerBadge(code, message),
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
            onClose: () => {
              if (!batchLock.current) {
                setForwardTarget(null);
                forwardBatch.current = [];
                forwardKeys.current.clear();
              }
            },
            onForward: (roomId) => void performForward(roomId),
          }}
        />
        <UgcConsentPrompt {...ugcConsent.promptProps} />

        <Animated.View
          pointerEvents="none"
          style={[styles.flash, { opacity: flashOpacity }]}
        />
        <Animated.View
          pointerEvents="none"
          style={[styles.flashEnemy, { opacity: enemyFlashOpacity }]}
        />
      </Animated.View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, minHeight: 0 },
  flex: { flex: 1, minHeight: 0 },
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
    right: 12,
    bottom: 12,
    paddingHorizontal: 12,
    minHeight: 36,
    borderRadius: 18,
    flexDirection: "row",
    gap: 6,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: StyleSheet.hairlineWidth,
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
