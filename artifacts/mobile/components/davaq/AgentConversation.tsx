import React, {
  useCallback,
  useEffect,
  useRef,
  useState,
  useMemo,
} from "react";
import {
  View,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Pressable,
} from "react-native";
import { useScreenActive as useIsFocused } from "@/hooks/useScreenActive";
import { ChatRoomSheets } from "@/components/chat/ChatRoomSheets";
import { Stack, useFocusEffect, useRouter } from "expo-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  useGetMe,
  useListRooms,
  customFetch,
  sendMessage,
  createRequestId,
  getListRoomsQueryKey,
  getFetchRoomMessagesQueryKey,
  type Message,
} from "@workspace/api-client-react";
import { MessageBubble } from "@/components/MessageBubble";
import { MessageComposer } from "@/components/MessageComposer";
import { ChatRoomHeader } from "@/components/chat/ChatRoomHeader";
import { useChatSendHandlers } from "@/hooks/useChatSendHandlers";
import { useReliableRoomMessages } from "@/hooks/useReliableRoomMessages";
import { useInvertedChatListController } from "@/hooks/useInvertedChatListController";
import { useCharacterProfiles } from "@/hooks/useCharacterProfiles";
import { useColors } from "@/hooks/useColors";
import { agentConversationId, fetchChatMessages } from "@/lib/chatTransport";
import {
  formatMsgTime,
  formatDayLabel,
  isSameDay,
  summarizeMessage,
} from "@/lib/chatScreenUtils";
import {
  useDavaq,
  useDavaqMutation,
  type Agent,
  type Match,
  errorText,
} from "@/lib/davaq";
import type { BrandCampaign } from "@/lib/brandExchange";
import { C, S, Txt, Cue, Chip, Button, Notice, QueryState, Icon } from "./UI";

const noop = () => {};
type Card =
  | { kind: "match"; match: Match }
  | { kind: "brand"; campaign: BrandCampaign }
  | { kind: "memory"; memory: { id: string; label: string; status: string } }
  | { kind: "register"; text: string };
type CueMetadata = { agentRole?: string; replyState?: string; cards?: Card[] };
const metadata = (m: Message) => (m.metadata ?? {}) as CueMetadata;

function ConversationCards({
  cards,
  onChange,
}: {
  cards: Card[];
  onChange: () => void;
}) {
  const router = useRouter(),
    mutation = useDavaqMutation(),
    [error, setError] = useState("");
  async function remember(id: string, status: string) {
    setError("");
    try {
      await mutation.mutateAsync({
        path: "/agents/me/memories/" + id,
        method: "PATCH",
        body: { status },
      });
      onChange();
    } catch (e) {
      setError(errorText(e));
    }
  }
  return (
    <View
      style={{
        gap: 10,
        marginHorizontal: 16,
        marginLeft: 48,
        marginBottom: 12,
        maxWidth: 540,
      }}
    >
      {cards.map((card, i) => {
        if (card.kind === "match")
          return (
            <View key={card.match.id} style={S.card}>
              <Txt color={C.purple} size={12} bold>
                큐가 찾은 교환
              </Txt>
              <Txt bold>
                {card.match.offer.title} ⇄ {card.match.target.title}
              </Txt>
              <Txt size={13} color={C.muted}>
                {card.match.reasons.join(" · ")}
              </Txt>
              {!!card.match.pending.length && (
                <Txt size={12} color={C.muted}>
                  함께 확인할 것: {card.match.pending.join(" · ")}
                </Txt>
              )}
              <Button
                small
                label="교환 제안하기"
                onPress={() =>
                  router.push(
                    ("/exchange/propose?target=" +
                      card.match.target.id +
                      "&offer=" +
                      card.match.offer.id) as never,
                  )
                }
              />
            </View>
          );
        if (card.kind === "brand")
          return (
            <View key={card.campaign.id} style={S.card}>
              <Txt color={C.purple} size={12} bold>
                브랜드 혜택 · 내 1분 바꾸기
              </Txt>
              <Txt bold>
                {card.campaign.brand} · {card.campaign.rewardTitle}
              </Txt>
              <Txt color={C.muted} size={13}>
                {card.campaign.reason}
              </Txt>
              <Button
                small
                secondary
                label="조건 확인하고 참여하기"
                onPress={() =>
                  router.push(("/brand-exchanges/" + card.campaign.id) as never)
                }
              />
            </View>
          );
        if (card.kind === "memory")
          return (
            <View key={card.memory.id} style={S.card}>
              <Txt bold>
                {card.memory.status === "confirmed"
                  ? "큐가 기억하고 있어요"
                  : "이렇게 기억해둘까요?"}
              </Txt>
              <Txt size={14}>{card.memory.label}</Txt>
              {card.memory.status === "candidate" ? (
                <View style={S.wrap}>
                  <Button
                    small
                    label="기억해줘"
                    busy={mutation.isPending}
                    onPress={() => void remember(card.memory.id, "confirmed")}
                  />
                  <Button
                    small
                    secondary
                    label="괜찮아요"
                    disabled={mutation.isPending}
                    onPress={() => void remember(card.memory.id, "rejected")}
                  />
                </View>
              ) : (
                <Chip
                  label="기억 관리"
                  onPress={() => router.push("/agent/memories")}
                />
              )}
            </View>
          );
        return (
          <View key={"register" + i} style={S.card}>
            <Txt bold>이 대화로 교환을 준비해볼까요?</Txt>
            <Txt color={C.muted} size={13}>
              말씀하신 내용을 초안으로 정리하고, 확인한 뒤 공개할 수 있어요.
            </Txt>
            <Button
              small
              secondary
              label="교환 등록 초안 만들기"
              onPress={() =>
                router.push(
                  ("/exchange/new?text=" +
                    encodeURIComponent(card.text)) as never,
                )
              }
            />
          </View>
        );
      })}
      {!!error && <Notice error>{error}</Notice>}
    </View>
  );
}

export function AgentConversation() {
  const router = useRouter(),
    colors = useColors(),
    queryClient = useQueryClient(),
    me = useGetMe(),
    { activeProfile } = useCharacterProfiles();
  const focused = useIsFocused();
  const agent = useDavaq<Agent>("/agents/me", focused);
  const [replyTo, setReplyTo] = useState<Message | null>(null),
    [actionMessage, setActionMessage] = useState<Message | null>(null),
    [selectedId, setSelectedId] = useState<string | null>(null),
    [forwardTarget, setForwardTarget] = useState<Message | null>(null),
    [stickerTarget, setStickerTarget] = useState<Message | null>(null),
    [actionError, setActionError] = useState("");
  const busy = useRef(false),
    forwardIds = useRef(new Map<string, string>());
  const clearReply = useCallback(() => setReplyTo(null), []);
  const roomsForForward = useListRooms({
    query: {
      queryKey: getListRoomsQueryKey(),
      enabled: focused && !!forwardTarget,
    },
  });
  const roomId = me.data?.id ? agentConversationId(me.data.id) : "";
  const query = useReliableRoomMessages(roomId, {
    userId: me.data?.id,
    profileId: activeProfile?.id,
    pollInterval: 1500,
    enabled: focused,
  });
  const messages = useMemo(
    () => (query.data ?? []).filter((m) => !m.metadata?.hidden),
    [query.data],
  );
  const listMessages = useMemo(() => [...messages].reverse(), [messages]);
  const clientKeyRef = useRef(new Map<string, string>());
  const [draft, setDraft] = useState<{ key: number; text: string }>();
  const list = useInvertedChatListController({
    roomId,
    room: undefined,
    viewerId: undefined,
    messages,
    visibleMessages: messages,
    listMessages,
    isDungeon: false,
    onInitialScrollReady: noop,
  });
  const sender = useChatSendHandlers({
    roomId,
    me: me.data,
    senderProfile: activeProfile,
    replyTo,
    clearReply,
    clientKeyRef,
    forceStickToBottom: list.forceStickToBottom,
    isDungeon: false,
    beginDungeonThinking: noop,
    clearDungeonThinking: noop,
  });
  useFocusEffect(
    useCallback(() => {
      if (roomId) void query.refetch();
    }, [roomId, query.refetch]),
  );
  useEffect(() => {
    const ids = new Set(messages.map((m) => m.id));
    for (const id of clientKeyRef.current.keys())
      if (!ids.has(id)) clientKeyRef.current.delete(id);
  }, [messages]);
  const refreshCards = useCallback(() => {
    void queryClient.invalidateQueries({
      queryKey: getFetchRoomMessagesQueryKey(roomId),
    });
  }, [queryClient, roomId]);
  const pin = useQuery({
    queryKey: ["davaq-agent-pin", me.data?.id],
    enabled: focused && !!me.data?.id,
    queryFn: ({ signal }) =>
      customFetch<Message | null>("/api/agents/me/conversation/pin", {
        signal,
      }),
    refetchInterval: focused ? 30000 : false,
    refetchIntervalInBackground: false,
  });
  const ownerRoom = useRef(roomId);
  ownerRoom.current = roomId;
  useEffect(() => {
    setReplyTo(null);
    setActionMessage(null);
    setForwardTarget(null);
    setStickerTarget(null);
    setSelectedId(null);
    setActionError("");
    forwardIds.current.clear();
  }, [roomId]);
  async function action(
    id: string,
    kind: "delete" | "pin" | "sticker",
    body?: unknown,
  ) {
    if (busy.current) return;
    busy.current = true;
    setActionError("");
    const captured = roomId;
    try {
      const result = await customFetch<Message>(
        "/api/agents/me/conversation/messages/" + id + "/" + kind,
        { method: "POST", body: JSON.stringify(body ?? {}) },
      );
      if (ownerRoom.current !== captured) return;
      queryClient.setQueryData<Message[]>(
        getFetchRoomMessagesQueryKey(captured),
        (old) =>
          (old ?? []).map((m) => (m.id === id ? { ...m, ...result } : m)),
      );
      if (kind === "delete" && replyTo?.id === id) setReplyTo(null);
      setActionMessage(null);
      setStickerTarget(null);
      await Promise.all([query.refetch(), pin.refetch()]);
    } catch (e) {
      if (ownerRoom.current === captured) setActionError(errorText(e));
    } finally {
      busy.current = false;
    }
  }
  async function unpin() {
    try {
      await customFetch("/api/agents/me/conversation/pin", {
        method: "DELETE",
      });
      await pin.refetch();
      setActionMessage(null);
    } catch (e) {
      setActionError(errorText(e));
    }
  }
  async function copy(message: Message) {
    try {
      const Clipboard = await import("expo-clipboard");
      await Clipboard.setStringAsync(
        message.type === "text" ? message.content : summarizeMessage(message),
      );
      setActionMessage(null);
    } catch (e) {
      setActionError(errorText(e));
    }
  }
  async function forward(target: string) {
    if (!forwardTarget || busy.current) return;
    busy.current = true;
    setActionError("");
    const sourceId = forwardTarget.id,
      captured = roomId,
      key = sourceId + ":" + target;
    try {
      const source = await customFetch<Message>(
        "/api/agents/me/conversation/messages/" + sourceId,
      );
      if (ownerRoom.current !== captured) return;
      if (source.deletedAt)
        throw new Error("삭제된 메시지는 전달할 수 없어요.");
      let operation = forwardIds.current.get(key);
      if (!operation) {
        operation = createRequestId();
        forwardIds.current.set(key, operation);
      }
      await sendMessage(target, {
        content: source.content,
        type: source.type as "text" | "image" | "file" | "sticker",
        clientMessageId: operation,
        replyToMessageId: null,
      });
      if (ownerRoom.current !== captured) return;
      forwardIds.current.delete(key);
      setForwardTarget(null);
      void queryClient.invalidateQueries({ queryKey: getListRoomsQueryKey() });
      void queryClient.invalidateQueries({
        queryKey: getFetchRoomMessagesQueryKey(target),
      });
    } catch (e) {
      if (ownerRoom.current === captured) setActionError(errorText(e));
    } finally {
      busy.current = false;
    }
  }
  async function reveal(id: string) {
    let rows = messages;
    try {
      if (!rows.some((m) => m.id === id)) {
        const row = await customFetch<Message>(
          "/api/agents/me/conversation/messages/" + id,
        );
        rows = [...rows, row].sort((a, b) => a.roomSeq - b.roomSeq);
        queryClient.setQueryData(getFetchRoomMessagesQueryKey(roomId), rows);
      }
      setSelectedId(id);
      const index = [...rows].reverse().findIndex((m) => m.id === id);
      if (index >= 0)
        requestAnimationFrame(() =>
          list.listRef.current?.scrollToIndex({ index, animated: true }),
        );
    } catch (e) {
      setActionError(errorText(e));
    }
  }
  const longPress = useCallback(
    (id: string) => {
      const m = messages.find((v) => v.id === id);
      if (
        m &&
        !m.clientMessageId?.startsWith("optimistic:") &&
        !(m as any)._deliveryState
      )
        setActionMessage(m);
    },
    [messages],
  );
  const thinking = messages.some(
    (m) =>
      metadata(m).agentRole === "user" &&
      ["queued", "running"].includes(metadata(m).replyState ?? ""),
  );
  const name = agent.data?.settings.name || "큐";
  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      style={{ flex: 1, backgroundColor: colors.background }}
    >
      <Stack.Screen options={{ headerShown: false }} />
      <ChatRoomHeader
        title={"나의 " + name}
        subtitle={
          thinking
            ? "큐가 교환을 살펴보고 있어요…"
            : "나를 알아가는 교환 파트너"
        }
        avatar={<Cue size={40} />}
        isDirect={false}
        isGroupRoom={false}
        isDungeon={false}
        isOtherOnline={false}
        canCall={false}
        showAnotherMeToggle={false}
        anotherMeEnabled={false}
        anotherMePending={false}
        onBack={() =>
          router.canGoBack() ? router.back() : router.replace("/(tabs)/chats")
        }
        onToggleAnotherMe={noop}
        onStartCall={noop}
        onInvite={noop}
        onOpenOptions={() => router.push("/agent/settings")}
      />
      <View
        style={{
          paddingHorizontal: 14,
          paddingVertical: 8,
          backgroundColor: colors.card,
        }}
      >
        <View style={S.wrap}>
          <Chip
            label="교환 추천"
            onPress={() =>
              setDraft({ key: Date.now(), text: "나에게 맞는 교환을 찾아줘" })
            }
          />
          <Chip
            label="내 1분 바꾸기"
            onPress={() =>
              setDraft({
                key: Date.now(),
                text: "나에게 맞는 브랜드 혜택을 찾아줘",
              })
            }
          />
          <Chip
            label="큐의 기억"
            onPress={() => router.push("/agent/memories")}
          />
        </View>
      </View>
      {!!actionError && (
        <View style={{ padding: 10 }}>
          <Notice error>{actionError}</Notice>
        </View>
      )}
      {pin.data && (
        <View
          style={[
            S.row,
            {
              paddingHorizontal: 16,
              paddingVertical: 10,
              backgroundColor: C.soft,
            },
          ]}
        >
          <Pressable
            accessibilityLabel="고정 메시지 보기"
            style={{ flex: 1 }}
            onPress={() => void reveal(pin.data!.id)}
          >
            <Txt color={C.purple} bold size={12}>
              고정 메시지
            </Txt>
            <Txt lines={1} size={13}>
              {summarizeMessage(pin.data)}
            </Txt>
          </Pressable>
          <Pressable
            accessibilityLabel="고정 해제"
            onPress={() => void unpin()}
          >
            <Icon name="x" />
          </Pressable>
        </View>
      )}
      {query.isError && (
        <View style={{ padding: 12 }}>
          <Notice error>
            대화를 불러오지 못했어요. 전송 대기 중인 메시지는 다시 연결되면
            이어서 보냅니다.
          </Notice>
          <Button
            small
            secondary
            label="다시 연결"
            onPress={() => void query.refetch()}
          />
        </View>
      )}
      <FlatList<Message>
        ref={list.listRef}
        data={listMessages}
        inverted
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingVertical: 12 }}
        keyExtractor={(m) =>
          clientKeyRef.current.get(m.id) ?? m.clientMessageId ?? m.id
        }
        initialNumToRender={12}
        maxToRenderPerBatch={8}
        windowSize={5}
        keyboardShouldPersistTaps="handled"
        onScroll={list.onScroll}
        onLayout={list.onLayout}
        onContentSizeChange={list.onContentSizeChange}
        scrollEventThrottle={32}
        onScrollToIndexFailed={({ averageItemLength, index }) =>
          list.listRef.current?.scrollToOffset({
            offset: averageItemLength * index,
            animated: true,
          })
        }
        ListEmptyComponent={
          <View style={{ alignItems: "center", padding: 28, gap: 16 }}>
            <QueryState query={query} />
            {query.isSuccess && (
              <>
                <Cue size={110} />
                <Txt bold size={21}>
                  무엇을 바꿔볼까요?
                </Txt>
                <Txt color={C.muted} style={{ textAlign: "center" }}>
                  내가 줄 수 있는 것과 받고 싶은 것을 말해주세요. 이 대화에서
                  함께 찾아볼게요.
                </Txt>
                {[
                  "성악 레슨을 해주고 프로필 사진을 받고 싶어",
                  "주말에 할 수 있는 교환을 찾아줘",
                ].map((text) => (
                  <Chip
                    key={text}
                    label={text}
                    onPress={() => setDraft({ key: Date.now(), text })}
                  />
                ))}
              </>
            )}
          </View>
        }
        ListHeaderComponent={
          thinking ? (
            <View style={{ paddingHorizontal: 20, paddingBottom: 10 }}>
              <Txt size={12} color={C.muted}>
                큐가 생각하고 있어요… 다른 메시지를 보내도 괜찮아요.
              </Txt>
            </View>
          ) : null
        }
        renderItem={({ item, index }) => {
          const mine =
            metadata(item).agentRole === "user" || item.authorKind === "user";
          const delivery = (item as Message & { _deliveryState?: string })
            ._deliveryState;
          const older = listMessages[index + 1];
          return (
            <View>
              {(!older || !isSameDay(older.createdAt, item.createdAt)) && (
                <View style={{ alignItems: "center", paddingVertical: 12 }}>
                  <Txt size={11} color={C.muted}>
                    {formatDayLabel(item.createdAt)}
                  </Txt>
                </View>
              )}
              <MessageBubble
                messageId={item.id}
                content={item.content}
                type={item.type}
                imageUri={item.type === "image" ? item.content : undefined}
                isMe={mine}
                senderName={name}
                senderAvatarNode={<Cue size={32} />}
                senderCharacterType="official_ai"
                showSender={!mine}
                time={formatMsgTime(item.createdAt)}
                readLabel={
                  delivery === "pending"
                    ? "전송 중"
                    : delivery === "failed"
                      ? "전송 실패"
                      : undefined
                }
                retryClientMessageId={
                  delivery === "failed" ? item.clientMessageId : null
                }
                onRetryMessage={sender.retryMessage}
                onLongPress={delivery ? undefined : longPress}
                selected={selectedId === item.id}
                deletedAt={item.deletedAt}
                replyTo={item.replyTo}
                stickerBadges={item.stickerBadges}
                onPressReply={(id) => void reveal(id)}
              />
              {!!metadata(item).cards?.length && (
                <ConversationCards
                  cards={metadata(item).cards!}
                  onChange={refreshCards}
                />
              )}
            </View>
          );
        }}
      />
      {list.showScrollDown && (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="최신 메시지로 이동"
          onPress={() => list.scrollToBottom(true)}
          style={{
            alignSelf: "center",
            backgroundColor: colors.card,
            padding: 10,
            borderRadius: 22,
            marginBottom: 8,
          }}
        >
          <Icon name="arrow-down" />
          <Txt size={11}>최신 메시지</Txt>
        </Pressable>
      )}
      {sender.isWebDraggingUpload && (
        <View style={{ padding: 10 }}>
          <Notice>사진이나 파일을 놓아주세요.</Notice>
        </View>
      )}
      <MessageComposer
        sending={!me.data?.id || !activeProfile?.id}
        uploading={sender.uploadTask?.kind ?? null}
        uploadProgress={sender.uploadTask?.progress ?? null}
        onCancelUpload={sender.handleCancelUpload}
        placeholder="큐에게 말해주세요"
        draft={draft}
        replyPreview={
          replyTo
            ? {
                senderName:
                  metadata(replyTo).agentRole === "assistant" ? name : "나",
                content: summarizeMessage(replyTo),
              }
            : null
        }
        onCancelReply={clearReply}
        onSend={sender.sendText}
        onTyping={noop}
        onPickImage={sender.handlePickImage}
        onPickFile={sender.handlePickFile}
        onSendSticker={sender.handleSendSticker}
      />
      <ChatRoomSheets
        roomOptions={{
          visible: false,
          title: name,
          isDirect: false,
          anotherMeEnabled: false,
          anotherMeStatusLabel: "",
          anotherMeUsesOverride: false,
          anotherMePending: false,
          onClose: noop,
          onToggleAnotherMe: noop,
          onUseGlobalAnotherMe: noop,
          onLeave: noop,
        }}
        messageActions={{
          message: actionMessage,
          isDeleted: !!actionMessage?.deletedAt,
          isMine:
            !!actionMessage && metadata(actionMessage).agentRole === "user",
          isPinned: !!actionMessage && pin.data?.id === actionMessage.id,
          onClose: () => setActionMessage(null),
          onReply: (m) => {
            setReplyTo(m);
            setActionMessage(null);
          },
          onCopy: (m) => void copy(m),
          onSelect: (m) => {
            setSelectedId(m.id);
            setActionMessage(null);
          },
          onTogglePin: (m) => {
            if (pin.data?.id === m.id) void unpin();
            else void action(m.id, "pin");
          },
          onForward: (m) => {
            setForwardTarget(m);
            setActionMessage(null);
          },
          onSticker: (m) => {
            setStickerTarget(m);
            setActionMessage(null);
          },
          onDelete: (m, scope) => void action(m.id, "delete", { scope }),
        }}
        stickerBadge={{
          target: stickerTarget,
          onClose: () => setStickerTarget(null),
          onSelect: (code) => {
            if (stickerTarget)
              void action(stickerTarget.id, "sticker", { code });
          },
        }}
        forward={{
          target: forwardTarget,
          rooms: roomsForForward.data ?? [],
          viewerId: me.data?.id,
          onClose: () => setForwardTarget(null),
          onForward: (id) => void forward(id),
        }}
      />
    </KeyboardAvoidingView>
  );
}

export function PinnedAgentConversation() {
  const focused = useIsFocused();
  const router = useRouter(),
    me = useGetMe(),
    agent = useDavaq<Agent>("/agents/me");
  const query = useQuery({
    queryKey: ["davaq-agent-preview", me.data?.id],
    enabled: focused && !!me.data?.id,
    queryFn: ({ signal }) =>
      customFetch<Message[]>(
        "/api/agents/me/conversation/messages?limit=1&preview=true",
        { signal },
      ),
    staleTime: 15000,
    refetchInterval: focused ? 30000 : false,
    refetchIntervalInBackground: false,
  });
  useFocusEffect(
    useCallback(() => {
      if (me.data?.id) void query.refetch();
    }, [me.data?.id, query.refetch]),
  );
  const last = query.data?.[0];
  return (
    <Pressable
      accessibilityRole="button"
      onPress={() => router.push("/agent/chat")}
      style={[S.card, S.row, { backgroundColor: C.soft }]}
    >
      <Cue size={48} />
      <View style={{ flex: 1, gap: 4 }}>
        <View style={S.between}>
          <Txt bold>
            나의 {agent.data?.settings.name || "큐"}{" "}
            <Txt size={11} color={C.purple}>
              AI 파트너 · 고정
            </Txt>
          </Txt>
          {last && (
            <Txt size={11} color={C.muted}>
              {formatMsgTime(last.createdAt)}
            </Txt>
          )}
        </View>
        <Txt size={13} color={C.muted} lines={1}>
          {last
            ? summarizeMessage(last)
            : "줄 수 있는 것, 받고 싶은 것을 말해주세요."}
        </Txt>
      </View>
      <Icon name="chevron-right" />
    </Pressable>
  );
}
