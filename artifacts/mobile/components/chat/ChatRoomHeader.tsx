import { Feather } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Avatar } from "@/components/Avatar";
import { useColors } from "@/hooks/useColors";

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
}: {
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
  const colors = useColors();
  const insets = useSafeAreaInsets();

  return (
    <View style={[styles.header, { paddingTop: insets.top + 6, borderBottomColor: colors.border }]}>
      <Pressable
        onPress={onBack}
        hitSlop={10}
        style={({ pressed }) => [styles.headerBack, { opacity: pressed ? 0.6 : 1 }]}
      >
        <Feather name="chevron-left" size={28} color={colors.primary} />
      </Pressable>

      <View style={styles.headerCenter}>
        <View>
          {avatar ?? (isGroupRoom || isDungeon ? (
            <View style={[styles.headerIconAvatar, { backgroundColor: colors.accent }]}>
              <Feather name={isDungeon ? "compass" : "users"} size={19} color={colors.primary} />
            </View>
          ) : (
            <Avatar
              uri={avatarUri}
              name={title}
              size={40}
              crop="face"
              characterType={avatarCharacterType ?? "fan"}
            />
          ))}
          {isDirect && isOtherOnline ? (
            <View style={[styles.onlineDot, { backgroundColor: colors.online, borderColor: colors.background }]} />
          ) : null}
        </View>
        <View style={styles.headerTextWrap}>
          <View style={styles.headerNameRow}>
            <Text style={[styles.headerName, { color: colors.foreground }]} numberOfLines={1}>
              {title}
            </Text>
            {isDirect && isOtherOnline ? (
              <View style={[styles.nameDot, { backgroundColor: colors.online }]} />
            ) : null}
          </View>
          <Text style={[styles.headerSubtitle, { color: colors.mutedForeground }]} numberOfLines={1}>
            {subtitle}
          </Text>
        </View>
      </View>

      <View style={styles.headerActions}>
        {showAnotherMeToggle ? (
          <Pressable
            accessibilityRole="switch"
            accessibilityState={{ checked: anotherMeEnabled, disabled: anotherMePending }}
            hitSlop={10}
            onPress={() => onToggleAnotherMe(!anotherMeEnabled)}
            disabled={anotherMePending}
            style={({ pressed }) => [
              styles.headerAiToggle,
              {
                backgroundColor: anotherMeEnabled ? colors.accent : colors.muted,
                borderColor: anotherMeEnabled ? colors.primary : colors.border,
                opacity: pressed || anotherMePending ? 0.6 : 1,
              },
            ]}
          >
            <Feather name="cpu" size={13} color={anotherMeEnabled ? colors.primary : colors.mutedForeground} />
            <Text style={[styles.headerAiText, { color: anotherMeEnabled ? colors.primary : colors.mutedForeground }]}>
              AI
            </Text>
            <View style={[styles.headerAiTrack, { backgroundColor: anotherMeEnabled ? colors.primary : colors.border }]}>
              <View
                style={[
                  styles.headerAiThumb,
                  {
                    backgroundColor: anotherMeEnabled ? colors.primaryForeground : colors.card,
                    transform: [{ translateX: anotherMeEnabled ? 14 : 0 }],
                  },
                ]}
              />
            </View>
          </Pressable>
        ) : null}
        {canCall ? (
          <>
            <Pressable hitSlop={10} onPress={() => onStartCall("audio")} style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}>
              <Feather name="phone" size={22} color={colors.foreground} />
            </Pressable>
            <Pressable hitSlop={10} onPress={() => onStartCall("video")} style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}>
              <Feather name="video" size={22} color={colors.foreground} />
            </Pressable>
          </>
        ) : null}
        {isGroupRoom ? (
          <Pressable hitSlop={10} onPress={onInvite} style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}>
            <Feather name="user-plus" size={22} color={colors.foreground} />
          </Pressable>
        ) : null}
        <Pressable hitSlop={10} onPress={onOpenOptions} style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}>
          <Feather name="more-horizontal" size={24} color={colors.foreground} />
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 8,
    paddingBottom: 10,
    gap: 2,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  headerBack: { padding: 4 },
  headerCenter: { flex: 1, flexDirection: "row", alignItems: "center", gap: 10 },
  headerIconAvatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
  },
  onlineDot: {
    position: "absolute",
    right: -1,
    bottom: -1,
    width: 12,
    height: 12,
    borderRadius: 6,
    borderWidth: 2,
  },
  headerTextWrap: { flex: 1, gap: 1 },
  headerNameRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  headerName: { fontSize: 17, fontFamily: "Inter_600SemiBold", flexShrink: 1 },
  nameDot: { width: 7, height: 7, borderRadius: 3.5 },
  headerSubtitle: { fontSize: 12, fontFamily: "Inter_400Regular" },
  headerActions: { flexDirection: "row", alignItems: "center", gap: 18, paddingHorizontal: 8 },
  headerAiToggle: {
    alignItems: "center",
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
    flexDirection: "row",
    gap: 4,
    minHeight: 28,
    paddingLeft: 8,
    paddingRight: 6,
  },
  headerAiText: { fontFamily: "Inter_700Bold", fontSize: 11 },
  headerAiTrack: { borderRadius: 999, height: 16, padding: 2, width: 30 },
  headerAiThumb: { borderRadius: 6, height: 12, width: 12 },
});
