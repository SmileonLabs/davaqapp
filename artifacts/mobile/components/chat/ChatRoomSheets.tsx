import React, { useState } from "react";
import {
  Pressable,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from "react-native";
import { Feather } from "@expo/vector-icons";
import type { Message } from "@workspace/api-client-react";
import { StickerPicker } from "@/components/StickerPicker";
import { roomDisplayName, summarizeMessage } from "@/lib/chatScreenUtils";
import type { DeleteMessageScope } from "@/lib/messageActions";
import { useColors } from "@/hooks/useColors";
import { MessengerAction, MessengerSheet } from "./MessengerUI";
type RoomOptionSheet = {
  visible: boolean;
  title: string;
  isDirect: boolean;
  anotherMeEnabled: boolean;
  anotherMeStatusLabel: string;
  anotherMeUsesOverride: boolean;
  anotherMePending: boolean;
  onClose: () => void;
  onToggleAnotherMe: (enabled: boolean) => void;
  onUseGlobalAnotherMe: () => void;
  onLeave: () => void;
};

type MessageActionSheet = {
  message: Message | null;
  isDeleted: boolean;
  isMine: boolean;
  isPinned: boolean;
  onClose: () => void;
  onReply: (message: Message) => void;
  onCopy: (message: Message) => void;
  onSelect: (message: Message) => void;
  onTogglePin: (message: Message) => void;
  onForward: (message: Message) => void;
  onSticker: (message: Message) => void;
  onReact?: (message: Message, code: string) => void;
  onDelete: (message: Message, scope: DeleteMessageScope) => void;
};

type StickerBadgeSheet = {
  target: Message | null;
  onClose: () => void;
  onSelect: (code: string) => void;
};

type ForwardSheet = {
  target: Message | null;
  rooms: Array<{
    id: string;
    name?: string | null;
    type?: string;
    members?: unknown[];
    lastMessage?: string | null;
  }>;
  viewerId?: string;
  onClose: () => void;
  onForward: (roomId: string) => void;
};

const reactions = [
  ["1f44d", "👍", "좋아요"],
  ["2764_fe0f", "❤️", "하트"],
  ["1f602", "😂", "웃음"],
  ["1f389", "🎉", "축하"],
  ["1f64f", "🙏", "감사"],
];
export function ChatRoomSheets({
  roomOptions,
  messageActions,
  stickerBadge,
  forward,
}: {
  roomOptions: RoomOptionSheet;
  messageActions: MessageActionSheet;
  stickerBadge: StickerBadgeSheet;
  forward: ForwardSheet;
}) {
  const c = useColors(),
    message = messageActions.message,
    [search, setSearch] = useState("");
  return (
    <>
      <MessengerSheet
        visible={roomOptions.visible}
        title="대화 설정"
        onClose={roomOptions.onClose}
      >
        <Text style={[s.preview, { color: c.mutedForeground }]}>
          {roomOptions.title}
        </Text>
        {roomOptions.isDirect && (
          <View style={[s.setting, { backgroundColor: c.muted }]}>
            <View
              style={{ flexDirection: "row", alignItems: "center", gap: 12 }}
            >
              <Feather name="cpu" size={21} color={c.primary} />
              <View style={{ flex: 1, gap: 4 }}>
                <Text
                  style={{
                    fontSize: 15,
                    fontWeight: "600",
                    color: c.foreground,
                  }}
                >
                  AI 소환 허용
                </Text>
                <Text style={{ fontSize: 12, color: c.mutedForeground }}>
                  {roomOptions.anotherMeStatusLabel}
                </Text>
              </View>
              <Switch
                accessibilityLabel="이 방의 AI 소환 허용"
                value={roomOptions.anotherMeEnabled}
                onValueChange={roomOptions.onToggleAnotherMe}
                disabled={roomOptions.anotherMePending}
                trackColor={{ false: c.border, true: c.primary }}
                thumbColor="white"
              />
            </View>
            <Text
              style={{
                fontSize: 12,
                lineHeight: 19,
                color: c.mutedForeground,
                marginTop: 12,
              }}
            >
              내가 자리를 비웠을 때 상대가 내 AI와 대화를 이어갈 수 있어요.
            </Text>
            {roomOptions.anotherMeUsesOverride && (
              <Pressable
                accessibilityRole="button"
                onPress={roomOptions.onUseGlobalAnotherMe}
                disabled={roomOptions.anotherMePending}
                style={{ paddingTop: 12 }}
              >
                <Text
                  style={{ color: c.primary, fontWeight: "600", fontSize: 12 }}
                >
                  전체 대화의 기본 설정 사용
                </Text>
              </Pressable>
            )}
          </View>
        )}
        <MessengerAction
          icon="log-out"
          title="채팅방 나가기"
          destructive
          onPress={roomOptions.onLeave}
        />
      </MessengerSheet>
      <MessengerSheet
        visible={!!message}
        title="메시지"
        onClose={messageActions.onClose}
      >
        {message && (
          <>
            <Text
              numberOfLines={2}
              style={[s.preview, { color: c.mutedForeground }]}
            >
              {summarizeMessage(message)}
            </Text>
            {!messageActions.isDeleted && messageActions.onReact && (
              <View style={[s.reactions, { backgroundColor: c.muted }]}>
                {reactions.map(([code, emoji, label]) => (
                  <Pressable
                    key={code}
                    accessibilityRole="button"
                    accessibilityLabel={label + " 반응"}
                    onPress={() => messageActions.onReact!(message, code)}
                    style={({ pressed }) => [
                      s.reaction,
                      { backgroundColor: pressed ? c.accent : "transparent" },
                    ]}
                  >
                    <Text style={{ fontSize: 25 }}>{emoji}</Text>
                  </Pressable>
                ))}
              </View>
            )}
            <View style={s.grid}>
              {!messageActions.isDeleted && (
                <>
                  <Action
                    icon="corner-up-left"
                    label="답장"
                    onPress={() => messageActions.onReply(message)}
                  />
                  <Action
                    icon="copy"
                    label="복사"
                    onPress={() => messageActions.onCopy(message)}
                  />
                  <Action
                    icon="bookmark"
                    label={messageActions.isPinned ? "고정 해제" : "고정"}
                    onPress={() => messageActions.onTogglePin(message)}
                  />
                  {["text", "image", "file", "sticker"].includes(
                    message.type,
                  ) && (
                    <Action
                      icon="send"
                      label="전달"
                      onPress={() => messageActions.onForward(message)}
                    />
                  )}
                  <Action
                    icon="smile"
                    label="스티커"
                    onPress={() => messageActions.onSticker(message)}
                  />
                </>
              )}
              <Action
                icon="check-square"
                label="선택"
                onPress={() => messageActions.onSelect(message)}
              />
            </View>
            <View style={[s.divider, { backgroundColor: c.border }]} />
            <Action
              icon="trash-2"
              label="나에게만 삭제"
              destructive
              onPress={() => messageActions.onDelete(message, "me")}
            />
            {messageActions.isMine && !messageActions.isDeleted && (
              <Action
                icon="trash"
                label="모두에게 삭제"
                destructive
                onPress={() => messageActions.onDelete(message, "everyone")}
              />
            )}
          </>
        )}
      </MessengerSheet>
      <MessengerSheet
        visible={!!stickerBadge.target}
        title="스티커 반응"
        onClose={stickerBadge.onClose}
      >
        <StickerPicker onSelect={stickerBadge.onSelect} />
      </MessengerSheet>
      <MessengerSheet
        visible={!!forward.target}
        title="메시지 전달"
        onClose={forward.onClose}
      >
        <TextInput
          accessibilityLabel="전달할 대화 검색"
          placeholder="전달할 대화 검색"
          placeholderTextColor={c.mutedForeground}
          value={search}
          onChangeText={setSearch}
          style={[s.search, { backgroundColor: c.input, color: c.foreground }]}
        />
        {forward.rooms
          .filter((r) =>
            roomDisplayName(r, forward.viewerId)
              .toLocaleLowerCase()
              .includes(search.trim().toLocaleLowerCase()),
          )
          .map((room) => (
            <MessengerAction
              key={room.id}
              icon={room.type === "group" ? "users" : "message-circle"}
              title={roomDisplayName(room, forward.viewerId)}
              onPress={() => forward.onForward(room.id)}
            />
          ))}
        {!forward.rooms.length && (
          <Text style={[s.preview, { color: c.mutedForeground }]}>
            아직 전달할 대화가 없어요. 친구와 대화를 먼저 시작해 주세요.
          </Text>
        )}
      </MessengerSheet>
    </>
  );
}
function Action({
  icon,
  label,
  onPress,
  destructive = false,
}: {
  icon: React.ComponentProps<typeof Feather>["name"];
  label: string;
  onPress: () => void;
  destructive?: boolean;
}) {
  const c = useColors();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={({ pressed, ...state }) => [
        s.action,
        {
          backgroundColor:
            pressed || (state as any).hovered ? c.muted : "transparent",
        },
      ]}
    >
      <Feather
        name={icon}
        size={19}
        color={destructive ? c.destructive : c.primary}
      />
      <Text
        style={{
          fontSize: 14,
          fontWeight: "500",
          color: destructive ? c.destructive : c.foreground,
        }}
      >
        {label}
      </Text>
    </Pressable>
  );
}
const s = StyleSheet.create({
  preview: {
    fontSize: 13,
    lineHeight: 20,
    paddingHorizontal: 12,
    marginBottom: 12,
  },
  setting: { padding: 16, borderRadius: 16, margin: 6 },
  grid: { flexDirection: "row", flexWrap: "wrap", paddingVertical: 6 },
  action: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 15,
    minWidth: "49%",
    borderRadius: 12,
  },
  reactions: {
    flexDirection: "row",
    justifyContent: "space-around",
    marginHorizontal: 6,
    padding: 4,
    borderRadius: 20,
  },
  reaction: {
    height: 44,
    width: 50,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 18,
  },
  divider: {
    height: StyleSheet.hairlineWidth,
    marginVertical: 6,
    marginHorizontal: 12,
  },
  search: {
    height: 44,
    borderRadius: 12,
    paddingHorizontal: 14,
    margin: 8,
    fontSize: 15,
  },
});
