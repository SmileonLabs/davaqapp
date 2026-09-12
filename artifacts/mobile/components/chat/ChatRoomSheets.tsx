import { Feather } from "@expo/vector-icons";
import type { Message } from "@workspace/api-client-react";
import type React from "react";
import { Modal, Pressable, ScrollView, StyleSheet, Switch, Text, View } from "react-native";
import { StickerPicker } from "@/components/StickerPicker";
import { roomDisplayName, summarizeMessage } from "@/lib/chatScreenUtils";
import type { DeleteMessageScope } from "@/lib/messageActions";
import { useColors } from "@/hooks/useColors";

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
  onDelete: (message: Message, scope: DeleteMessageScope) => void;
};

type StickerBadgeSheet = {
  target: Message | null;
  onClose: () => void;
  onSelect: (code: string) => void;
};

type ForwardSheet = {
  target: Message | null;
  rooms: Array<{ id: string; name?: string | null; type?: string; members?: unknown[]; lastMessage?: string | null }>;
  viewerId?: string;
  onClose: () => void;
  onForward: (roomId: string) => void;
};

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
  const colors = useColors();
  const message = messageActions.message;

  return (
    <>
      <Modal visible={roomOptions.visible} transparent animationType="fade" onRequestClose={roomOptions.onClose}>
        <Pressable style={styles.modalOverlay} onPress={roomOptions.onClose}>
          <Pressable style={[styles.actionSheet, { backgroundColor: colors.card, borderColor: colors.border }]} onPress={() => {}}>
            <Text style={[styles.actionTitle, { color: colors.foreground }]}>채팅방 설정</Text>
            <Text style={[styles.actionPreview, { color: colors.mutedForeground }]} numberOfLines={2}>
              {roomOptions.title}
            </Text>

            <View style={[styles.roomSettingCard, { backgroundColor: colors.background, borderColor: colors.border }]}>
              <View style={styles.roomSettingHeader}>
                <View style={[styles.roomSettingIcon, { backgroundColor: colors.accent }]}>
                  <Feather name="cpu" size={17} color={colors.primary} />
                </View>
                <View style={styles.roomSettingText}>
                  <Text style={[styles.roomSettingTitle, { color: colors.foreground }]}>DavaQ 소환</Text>
                  <Text style={[styles.roomSettingSub, { color: colors.mutedForeground }]}>현재 상태: {roomOptions.anotherMeStatusLabel}</Text>
                </View>
                {roomOptions.isDirect ? (
                  <Switch
                    value={roomOptions.anotherMeEnabled}
                    onValueChange={roomOptions.onToggleAnotherMe}
                    disabled={roomOptions.anotherMePending}
                    trackColor={{ false: colors.border, true: colors.primary }}
                    thumbColor="#fff"
                  />
                ) : null}
              </View>

              {roomOptions.isDirect ? (
                <>
                  <Text style={[styles.roomSettingHelp, { color: colors.mutedForeground }]}>
                    켜면 이 방에서는 전역 설정과 별개로 상대가 내 DavaQ를 소환할 수 있습니다. 끄면 이 방에서는 소환되지 않습니다.
                  </Text>
                  {roomOptions.anotherMeUsesOverride ? (
                    <Pressable
                      onPress={roomOptions.onUseGlobalAnotherMe}
                      disabled={roomOptions.anotherMePending}
                      style={({ pressed }) => [styles.useGlobalButton, { opacity: pressed || roomOptions.anotherMePending ? 0.55 : 1 }]}
                    >
                      <Feather name="rotate-ccw" size={14} color={colors.primary} />
                      <Text style={[styles.useGlobalText, { color: colors.primary }]}>전역 설정 사용</Text>
                    </Pressable>
                  ) : null}
                </>
              ) : (
                <Text style={[styles.roomSettingHelp, { color: colors.mutedForeground }]}>MVP에서는 1:1 채팅방에서만 DavaQ 소환을 지원합니다.</Text>
              )}
            </View>

            <View style={[styles.actionDivider, { backgroundColor: colors.border }]} />
            <Pressable style={({ pressed }) => [styles.roomOptionRow, { opacity: pressed ? 0.55 : 1 }]} onPress={roomOptions.onLeave}>
              <Feather name="log-out" size={18} color={colors.destructive} />
              <Text style={[styles.roomOptionText, { color: colors.destructive }]}>채팅방 나가기</Text>
            </Pressable>
            <Pressable style={({ pressed }) => [styles.roomOptionRow, { opacity: pressed ? 0.55 : 1 }]} onPress={roomOptions.onClose}>
              <Feather name="x" size={18} color={colors.foreground} />
              <Text style={[styles.roomOptionText, { color: colors.foreground }]}>닫기</Text>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>

      <Modal visible={!!message} transparent animationType="fade" onRequestClose={messageActions.onClose}>
        <Pressable style={styles.modalOverlay} onPress={messageActions.onClose}>
          <Pressable style={[styles.actionSheet, { backgroundColor: colors.card, borderColor: colors.border }]} onPress={() => {}}>
            {message ? (
              <>
                <Text style={[styles.actionTitle, { color: colors.foreground }]}>메시지</Text>
                <Text style={[styles.actionPreview, { color: colors.mutedForeground }]} numberOfLines={2}>
                  {summarizeMessage(message)}
                </Text>
                <View style={styles.actionGrid}>
                  {!messageActions.isDeleted ? <ActionItem icon="corner-up-left" label="답장" color={colors.foreground} onPress={() => messageActions.onReply(message)} /> : null}
                  {!messageActions.isDeleted ? <ActionItem icon="copy" label="복사" color={colors.foreground} onPress={() => messageActions.onCopy(message)} /> : null}
                  <ActionItem icon="check-square" label="선택" color={colors.foreground} onPress={() => messageActions.onSelect(message)} />
                  {!messageActions.isDeleted ? <ActionItem icon="bookmark" label={messageActions.isPinned ? "고정 해제" : "고정"} color={colors.foreground} onPress={() => messageActions.onTogglePin(message)} /> : null}
                  {!messageActions.isDeleted && ["text", "image", "file", "sticker"].includes(message.type) ? <ActionItem icon="send" label="전달" color={colors.foreground} onPress={() => messageActions.onForward(message)} /> : null}
                  {!messageActions.isDeleted ? <ActionItem icon="smile" label="스티커" color={colors.foreground} onPress={() => messageActions.onSticker(message)} /> : null}
                </View>
                <View style={[styles.actionDivider, { backgroundColor: colors.border }]} />
                {messageActions.isMine ? (
                  <View style={styles.actionGrid}>
                    <ActionItem icon="trash-2" label="나에게만 삭제" color={colors.destructive} onPress={() => messageActions.onDelete(message, "me")} />
                    <ActionItem icon="trash" label="모두에게 삭제" color={colors.destructive} onPress={() => messageActions.onDelete(message, "everyone")} />
                  </View>
                ) : (
                  <ActionItem icon="trash-2" label="나에게만 삭제" color={colors.destructive} onPress={() => messageActions.onDelete(message, "me")} />
                )}
              </>
            ) : null}
          </Pressable>
        </Pressable>
      </Modal>

      <Modal visible={!!stickerBadge.target} transparent animationType="slide" onRequestClose={stickerBadge.onClose}>
        <Pressable style={styles.modalOverlay} onPress={stickerBadge.onClose}>
          <Pressable style={[styles.pickerSheet, { backgroundColor: colors.card }]} onPress={() => {}}>
            <Text style={[styles.pickerTitle, { color: colors.foreground }]}>말풍선에 붙일 스티커</Text>
            <StickerPicker onSelect={stickerBadge.onSelect} />
          </Pressable>
        </Pressable>
      </Modal>

      <Modal visible={!!forward.target} transparent animationType="slide" onRequestClose={forward.onClose}>
        <Pressable style={styles.modalOverlay} onPress={forward.onClose}>
          <Pressable style={[styles.forwardSheet, { backgroundColor: colors.card }]} onPress={() => {}}>
            <Text style={[styles.actionTitle, { color: colors.foreground }]}>전달할 채팅방</Text>
            <ScrollView style={styles.forwardList} keyboardShouldPersistTaps="handled">
              {forward.rooms.map((room) => (
                <Pressable
                  key={room.id}
                  style={({ pressed }) => [styles.forwardRoom, { borderBottomColor: colors.border, opacity: pressed ? 0.55 : 1 }]}
                  onPress={() => forward.onForward(room.id)}
                >
                  <Text style={[styles.forwardRoomName, { color: colors.foreground }]} numberOfLines={1}>
                    {roomDisplayName(room, forward.viewerId)}
                  </Text>
                  <Text style={[styles.forwardRoomLast, { color: colors.mutedForeground }]} numberOfLines={1}>
                    {room.lastMessage ?? "메시지 없음"}
                  </Text>
                </Pressable>
              ))}
            </ScrollView>
          </Pressable>
        </Pressable>
      </Modal>
    </>
  );
}

function ActionItem({
  icon,
  label,
  color,
  onPress,
}: {
  icon: React.ComponentProps<typeof Feather>["name"];
  label: string;
  color: string;
  onPress: () => void;
}) {
  return (
    <Pressable style={({ pressed }) => [styles.actionItem, { opacity: pressed ? 0.55 : 1 }]} onPress={onPress}>
      <Feather name={icon} size={18} color={color} />
      <Text style={[styles.actionText, { color }]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  modalOverlay: { flex: 1, justifyContent: "flex-end", backgroundColor: "rgba(0,0,0,0.34)" },
  actionSheet: { borderTopLeftRadius: 22, borderTopRightRadius: 22, borderWidth: StyleSheet.hairlineWidth, paddingHorizontal: 16, paddingTop: 16, paddingBottom: 24 },
  actionTitle: { fontSize: 16, fontFamily: "Inter_700Bold" },
  actionPreview: { marginTop: 4, marginBottom: 12, fontSize: 13, lineHeight: 18, fontFamily: "Inter_400Regular" },
  actionGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  actionItem: { minWidth: "31%", flexGrow: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 7, paddingHorizontal: 10, paddingVertical: 11, borderRadius: 14 },
  actionText: { fontSize: 13, fontFamily: "Inter_600SemiBold" },
  actionDivider: { height: StyleSheet.hairlineWidth, marginVertical: 12 },
  roomSettingCard: { borderRadius: 16, borderWidth: StyleSheet.hairlineWidth, gap: 10, padding: 14 },
  roomSettingHeader: { alignItems: "center", flexDirection: "row", gap: 10 },
  roomSettingIcon: { alignItems: "center", borderRadius: 15, height: 30, justifyContent: "center", width: 30 },
  roomSettingText: { flex: 1, gap: 2 },
  roomSettingTitle: { fontFamily: "Inter_700Bold", fontSize: 14 },
  roomSettingSub: { fontFamily: "Inter_400Regular", fontSize: 12 },
  roomSettingHelp: { fontFamily: "Inter_400Regular", fontSize: 12, lineHeight: 17 },
  useGlobalButton: { alignItems: "center", alignSelf: "flex-start", flexDirection: "row", gap: 5, paddingVertical: 3 },
  useGlobalText: { fontFamily: "Inter_700Bold", fontSize: 12 },
  roomOptionRow: { alignItems: "center", borderRadius: 14, flexDirection: "row", gap: 9, paddingHorizontal: 10, paddingVertical: 12 },
  roomOptionText: { fontFamily: "Inter_700Bold", fontSize: 14 },
  pickerSheet: { borderTopLeftRadius: 22, borderTopRightRadius: 22, overflow: "hidden", paddingTop: 14 },
  pickerTitle: { paddingHorizontal: 16, paddingBottom: 10, fontSize: 16, fontFamily: "Inter_700Bold" },
  forwardSheet: { maxHeight: "70%", borderTopLeftRadius: 22, borderTopRightRadius: 22, paddingHorizontal: 16, paddingTop: 16, paddingBottom: 20 },
  forwardList: { marginTop: 8 },
  forwardRoom: { paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth },
  forwardRoomName: { fontSize: 15, fontFamily: "Inter_600SemiBold" },
  forwardRoomLast: { marginTop: 2, fontSize: 12, fontFamily: "Inter_400Regular" },
});
