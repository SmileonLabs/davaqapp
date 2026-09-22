import React from "react";
import {
  Pressable,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from "react-native";
import { Feather } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Avatar } from "@/components/Avatar";
import { useColors } from "@/hooks/useColors";
import { MessengerIconButton } from "./MessengerUI";
type CallMedia = "audio" | "video";
export function ChatRoomHeader({
  title,
  subtitle,
  avatarUri,
  avatar,
  avatarCharacterType,
  isDirect,
  isGroupRoom,
  isDungeon,
  isOtherOnline,
  canCall,
  showAnotherMeToggle,
  anotherMeEnabled,
  anotherMePending,
  onBack,
  onToggleAnotherMe,
  onStartCall,
  onInvite,
  onOpenOptions,
  embedded = false,
}: {
  embedded?: boolean;
  title: string;
  subtitle: string;
  avatarUri?: string | null;
  avatar?: import("react").ReactNode;
  avatarCharacterType?: "fan" | "star" | "official_ai" | string | null;
  isDirect: boolean;
  isGroupRoom: boolean;
  isDungeon: boolean;
  isOtherOnline: boolean;
  canCall: boolean;
  showAnotherMeToggle: boolean;
  anotherMeEnabled: boolean;
  anotherMePending: boolean;
  onBack: () => void;
  onToggleAnotherMe: (enabled: boolean) => void;
  onStartCall: (media: CallMedia) => void;
  onInvite: () => void;
  onOpenOptions: () => void;
}) {
  const c = useColors(),
    insets = useSafeAreaInsets(),
    { width } = useWindowDimensions();
  return (
    <View
      style={[
        s.header,
        {
          backgroundColor: c.card,
          borderBottomColor: c.border,
          paddingTop: embedded ? 8 : insets.top + 6,
        },
      ]}
    >
      <MessengerIconButton
        icon={embedded ? "sidebar" : "chevron-left"}
        label={embedded ? "대화 닫기" : "채팅 목록으로"}
        onPress={onBack}
      />
      <View style={s.center}>
        <View>
          {avatar ??
            (isGroupRoom || isDungeon ? (
              <View style={[s.group, { backgroundColor: c.accent }]}>
                <Feather
                  name={isDungeon ? "compass" : "users"}
                  size={19}
                  color={c.primary}
                />
              </View>
            ) : (
              <Avatar
                uri={avatarUri}
                name={title}
                size={36}
                crop="face"
                characterType={avatarCharacterType ?? "fan"}
              />
            ))}
          {isDirect && isOtherOnline && (
            <View
              style={[
                s.online,
                { backgroundColor: c.online, borderColor: c.card },
              ]}
            />
          )}
        </View>
        <View style={{ flex: 1, minWidth: 0, gap: 3 }}>
          <Text numberOfLines={1} style={[s.name, { color: c.foreground }]}>
            {title}
          </Text>
          <Text
            numberOfLines={1}
            style={[
              s.subtitle,
              { color: isOtherOnline ? c.online : c.mutedForeground },
            ]}
          >
            {subtitle}
          </Text>
        </View>
      </View>
      <View style={s.actions}>
        {showAnotherMeToggle && width > 640 && (
          <Pressable
            accessibilityRole="switch"
            accessibilityLabel="이 방의 AI 소환 허용"
            accessibilityState={{
              checked: anotherMeEnabled,
              disabled: anotherMePending,
            }}
            onPress={() => onToggleAnotherMe(!anotherMeEnabled)}
            disabled={anotherMePending}
            style={[
              s.ai,
              { backgroundColor: anotherMeEnabled ? c.accent : c.muted },
            ]}
          >
            <Feather
              name="cpu"
              size={16}
              color={anotherMeEnabled ? c.primary : c.mutedForeground}
            />
            <Text
              style={{
                fontSize: 11,
                fontWeight: "700",
                color: anotherMeEnabled ? c.primary : c.mutedForeground,
              }}
            >
              AI
            </Text>
          </Pressable>
        )}
        {canCall && (
          <>
            <MessengerIconButton
              icon="phone"
              label="음성 통화"
              onPress={() => onStartCall("audio")}
            />
            <MessengerIconButton
              icon="video"
              label="영상 통화"
              onPress={() => onStartCall("video")}
            />
          </>
        )}
        {isGroupRoom && (
          <MessengerIconButton
            icon="user-plus"
            label="그룹에 친구 초대"
            onPress={onInvite}
          />
        )}
        <MessengerIconButton
          icon="more-horizontal"
          label="대화 설정"
          onPress={onOpenOptions}
        />
      </View>
    </View>
  );
}
const s = StyleSheet.create({
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 6,
    paddingBottom: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    minHeight: 64,
    gap: 4,
  },
  center: {
    flex: 1,
    minWidth: 0,
    flexDirection: "row",
    alignItems: "center",
    gap: 9,
  },
  group: {
    width: 36,
    height: 36,
    borderRadius: 15,
    alignItems: "center",
    justifyContent: "center",
  },
  name: { fontSize: 16, fontWeight: "600" },
  subtitle: { fontSize: 11 },
  actions: { flexDirection: "row", alignItems: "center", gap: 0 },
  online: {
    position: "absolute",
    right: 0,
    bottom: 0,
    width: 10,
    height: 10,
    borderRadius: 5,
    borderWidth: 2,
  },
  ai: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    borderRadius: 14,
    paddingHorizontal: 9,
    height: 32,
    marginRight: 4,
  },
});
