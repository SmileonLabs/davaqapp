import React, { useEffect, useRef } from "react";
import {
  AccessibilityInfo,
  Animated,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from "react-native";
import { Feather } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useColors } from "@/hooks/useColors";

export function MessengerIconButton({
  icon,
  label,
  onPress,
  active = false,
  disabled = false,
}: {
  icon: React.ComponentProps<typeof Feather>["name"];
  label: string;
  onPress: () => void;
  active?: boolean;
  disabled?: boolean;
}) {
  const c = useColors();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      hitSlop={4}
      style={({ pressed, ...state }) => [
        m.iconButton,
        {
          backgroundColor: active
            ? c.accent
            : pressed || (state as any).hovered
              ? c.muted
              : "transparent",
          opacity: disabled ? 0.45 : 1,
        },
      ]}
    >
      <Feather
        name={icon}
        size={21}
        color={active ? c.primary : c.mutedForeground}
      />
    </Pressable>
  );
}
export function MessengerSheet({
  visible,
  title,
  onClose,
  children,
}: {
  visible: boolean;
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  const c = useColors(),
    { width } = useWindowDimensions(),
    insets = useSafeAreaInsets();
  return (
    <Modal
      transparent
      visible={visible}
      animationType="fade"
      onRequestClose={onClose}
    >
      <View
        style={[
          m.overlay,
          { justifyContent: width >= 760 ? "center" : "flex-end" },
        ]}
      >
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="메뉴 닫기"
          style={StyleSheet.absoluteFill}
          onPress={onClose}
        />
        <View
          accessibilityViewIsModal
          style={[
            m.sheet,
            {
              backgroundColor: c.card,
              borderColor: c.border,
              borderRadius: width >= 760 ? 24 : 0,
              borderTopLeftRadius: 24,
              borderTopRightRadius: 24,
              paddingBottom: Math.max(16, insets.bottom),
            },
          ]}
        >
          <View style={m.sheetHeader}>
            <Text style={[m.title, { color: c.foreground }]}>{title}</Text>
            <MessengerIconButton icon="x" label="닫기" onPress={onClose} />
          </View>
          <ScrollView
            bounces={false}
            keyboardShouldPersistTaps="handled"
            style={{ flexGrow: 0 }}
          >
            {children}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}
export function MessengerAction({
  icon,
  title,
  subtitle,
  onPress,
  destructive = false,
}: {
  icon: React.ComponentProps<typeof Feather>["name"];
  title: string;
  subtitle?: string;
  onPress: () => void;
  destructive?: boolean;
}) {
  const c = useColors();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={title}
      onPress={onPress}
      style={({ pressed, ...state }) => [
        m.action,
        {
          backgroundColor:
            pressed || (state as any).hovered ? c.muted : "transparent",
        },
      ]}
    >
      <View
        style={[
          m.actionIcon,
          { backgroundColor: destructive ? c.destructiveMuted : c.accent },
        ]}
      >
        <Feather
          name={icon}
          size={21}
          color={destructive ? c.destructive : c.primary}
        />
      </View>
      <View style={{ flex: 1, gap: 3 }}>
        <Text
          style={[
            m.actionTitle,
            { color: destructive ? c.destructive : c.foreground },
          ]}
        >
          {title}
        </Text>
        {subtitle && (
          <Text style={[m.subtitle, { color: c.mutedForeground }]}>
            {subtitle}
          </Text>
        )}
      </View>
      <Feather name="chevron-right" size={16} color={c.mutedForeground} />
    </Pressable>
  );
}
export function TypingIndicator({ label }: { label: string }) {
  const c = useColors(),
    pulse = useRef(new Animated.Value(0.45)).current;
  useEffect(() => {
    let animation: Animated.CompositeAnimation | undefined,
      active = true;
    const start = (reduced: boolean) => {
      animation?.stop();
      if (reduced || !active) {
        pulse.setValue(0.7);
        return;
      }
      animation = Animated.loop(
        Animated.sequence([
          Animated.timing(pulse, {
            toValue: 1,
            duration: 650,
            useNativeDriver: true,
          }),
          Animated.timing(pulse, {
            toValue: 0.4,
            duration: 650,
            useNativeDriver: true,
          }),
        ]),
      );
      animation.start();
    };
    void AccessibilityInfo.isReduceMotionEnabled().then(start).catch(() => start(true));
    const sub = AccessibilityInfo.addEventListener(
      "reduceMotionChanged",
      start,
    );
    return () => {
      active = false;
      animation?.stop();
      sub.remove();
    };
  }, [pulse]);
  return (
    <View accessibilityLiveRegion="polite" style={m.typing}>
      <Animated.View style={{ opacity: pulse, flexDirection: "row", gap: 3 }}>
        {[0, 1, 2].map((i) => (
          <View
            key={i}
            style={{
              width: 5,
              height: 5,
              borderRadius: 3,
              backgroundColor: c.primary,
            }}
          />
        ))}
      </Animated.View>
      <Text
        numberOfLines={1}
        style={[m.subtitle, { color: c.mutedForeground }]}
      >
        {label}
      </Text>
    </View>
  );
}
const m = StyleSheet.create({
  iconButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
  },
  overlay: {
    flex: 1,
    alignItems: "center",
    backgroundColor: "rgba(15,18,32,.28)",
    paddingHorizontal: Platform.OS === "web" ? 12 : 0,
  },
  sheet: {
    width: "100%",
    maxWidth: 420,
    maxHeight: "82%",
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 12,
    overflow: "hidden",
  },
  sheetHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingLeft: 10,
    paddingTop: 8,
    paddingBottom: 4,
  },
  title: { fontSize: 18, fontWeight: "700" },
  action: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    padding: 10,
    borderRadius: 14,
    minHeight: 64,
  },
  actionIcon: {
    width: 42,
    height: 42,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
  },
  actionTitle: { fontSize: 15, fontWeight: "600" },
  subtitle: { fontSize: 12, lineHeight: 17 },
  typing: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 20,
    paddingVertical: 9,
  },
});
