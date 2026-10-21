import palette from "@/constants/colors";
import { typography, radii, interaction } from "@/constants/designSystem";
import React from "react";
import {
  ActivityIndicator,
  Image,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  type TextInputProps,
  type ViewStyle,
} from "react-native";
import { Feather } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { Stack, useRouter, useSegments } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useMediaUri } from "@/hooks/useMediaUri";
import { errorText } from "@/lib/davaq";
export const C = {
  purple: palette.light.primary,
  ink: palette.light.foreground,
  muted: palette.light.mutedForeground,
  bg: palette.light.background,
  white: palette.light.card,
  line: palette.light.border,
  soft: palette.light.secondary,
  green: palette.light.online,
  red: palette.light.destructive,
};
export const S = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", gap: 10 },
  between: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
  },
  card: {
    backgroundColor: C.white,
    borderRadius: 12,
    padding: 18,
    borderWidth: 1,
    borderColor: C.line,
    gap: 12,
  },
  input: {
    minHeight: 50,
    borderWidth: 1,
    borderColor: C.line,
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 13,
    fontSize: 15,
    color: C.ink,
    backgroundColor: C.white,
  },
  wrap: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: 12 },
});
export function Txt({
  children,
  size = 15,
  bold = false,
  color = C.ink,
  style,
  lines,
}: {
  children: React.ReactNode;
  size?: number;
  bold?: boolean;
  color?: string;
  style?: any;
  lines?: number;
}) {
  return (
    <Text
      numberOfLines={lines}
      style={[
        {
          fontSize: size,
          lineHeight: Math.round(size * 1.48),
          color,
          fontWeight: bold ? "700" : "400",
          letterSpacing: -0.35,
        },
        style,
      ]}
    >
      {children}
    </Text>
  );
}
export function Icon({
  name,
  size = 20,
  color = C.purple,
}: {
  name: string;
  size?: number;
  color?: string;
}) {
  return <Feather name={name as any} size={size} color={color} />;
}
export function Frame({
  title,
  subtitle,
  children,
  back = false,
  right,
  footer,
  onRefresh,
  refreshing = false,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  back?: boolean;
  right?: React.ReactNode;
  footer?: React.ReactNode;
  onRefresh?: () => void;
  refreshing?: boolean;
}) {
  const insets = useSafeAreaInsets(),
    router = useRouter(),
    segments = useSegments();
  const inTabs = segments.some(segment => segment === "(tabs)");
  const showBack = back || (!inTabs && !segments.some(segment => segment === "(auth)"));
  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      <Stack.Screen options={{ headerShown: false }} />
      <ScrollView
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
        refreshControl={
          onRefresh ? (
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              tintColor={C.purple}
            />
          ) : undefined
        }
        contentContainerStyle={{
          width: "100%",
          maxWidth: 740,
          alignSelf: "center",
          paddingHorizontal: 20,
          paddingTop: insets.top + 18,
          paddingBottom: showBack ? 40 + insets.bottom : 110 + insets.bottom,
          gap: 20,
        }}
      >
        <View style={S.between}>
          <View style={[S.row, { flex: 1 }]}>
            {showBack && (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="뒤로가기"
                onPress={() =>
                  router.canGoBack() ? router.back() : router.replace("/(tabs)")
                }
                style={{ paddingVertical: 8, paddingRight: 6 }}
              >
                <Icon name="arrow-left" color={C.ink} />
              </Pressable>
            )}
            <View style={{ flex: 1 }}>
              <Txt size={title === "DAVAQ" ? 32 : 26} bold color={C.ink}>
                {title}
              </Txt>
              {subtitle && (
                <Txt color={C.muted} size={13}>
                  {subtitle}
                </Txt>
              )}
            </View>
          </View>
          {right}
        </View>
        {children}
      </ScrollView>
      {footer ? <View style={{ paddingHorizontal: 20, paddingVertical: 10, paddingBottom: (inTabs ? 82 : 10) + insets.bottom, backgroundColor: C.bg, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: C.line }}>{footer}</View> : null}
    </View>
  );
}
export function Button({
  label,
  onPress,
  secondary = false,
  busy = false,
  disabled = false,
  icon,
  small = false,
  style,
}: {
  label: string;
  onPress: () => void;
  secondary?: boolean;
  busy?: boolean;
  disabled?: boolean;
  icon?: string;
  small?: boolean;
  style?: ViewStyle;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: disabled || busy, busy }}
      disabled={disabled || busy}
      onPress={onPress}
      style={({ pressed }) => [
        {
          minHeight: small ? 40 : 50,
          borderRadius: 10,
          paddingHorizontal: small ? 13 : 18,
          paddingVertical: 10,
          backgroundColor: secondary ? C.soft : C.purple,
          alignItems: "center",
          justifyContent: "center",
          flexDirection: "row",
          gap: 7,
          opacity: disabled ? 0.45 : pressed ? 0.8 : 1,
        },
        style,
      ]}
    >
      {busy ? (
        <ActivityIndicator color={secondary ? C.purple : C.white} />
      ) : (
        icon && (
          <Icon name={icon} size={18} color={secondary ? C.purple : C.white} />
        )
      )}
      <Txt bold size={small ? 13 : 15} color={secondary ? C.purple : C.white}>
        {label}
      </Txt>
    </Pressable>
  );
}
export function Chip({
  label,
  active = false,
  onPress,
}: {
  label: string;
  active?: boolean;
  onPress?: () => void;
}) {
  return (
    <Pressable
      accessibilityRole={onPress ? "button" : undefined}
      accessibilityState={{ selected: active }}
      onPress={onPress}
      style={{
        borderRadius: 30,
        paddingHorizontal: 15,
        paddingVertical: 9,
        backgroundColor: active ? C.purple : C.white,
        borderWidth: 1,
        borderColor: active ? C.purple : C.line,
      }}
    >
      <Txt size={13} color={active ? C.white : C.muted} bold={active}>
        {label}
      </Txt>
    </Pressable>
  );
}
export function Field({
  label,
  hint,
  ...props
}: TextInputProps & { label: string; hint?: string }) {
  return (
    <View style={{ gap: 6 }}>
      <Txt bold size={14}>
        {label}
      </Txt>
      <TextInput
        accessibilityLabel={label}
        placeholderTextColor="#999999"
        {...props}
        style={[
          S.input,
          props.multiline && { minHeight: 92, textAlignVertical: "top" },
          props.style,
        ]}
      />
      {hint && (
        <Txt size={12} color={C.muted}>
          {hint}
        </Txt>
      )}
    </View>
  );
}
export function Section({
  title,
  action,
  onPress,
}: {
  title: string;
  action?: string;
  onPress?: () => void;
}) {
  return (
    <View style={S.between}>
      <Txt size={19} bold>
        {title}
      </Txt>
      {action && (
        <Pressable
          accessibilityRole="button"
          onPress={onPress}
          style={{ padding: 6 }}
        >
          <Txt size={13} color={C.purple}>
            {action} ›
          </Txt>
        </Pressable>
      )}
    </View>
  );
}
export function Cue({ size = 150 }: { size?: number }) {
  return (
    <Image
      accessibilityLabel="보라색 스카프를 두른 나의 AI 큐"
      source={require("@/assets/images/davaq/queue.png")}
      style={{ width: size, height: size }}
      resizeMode="contain"
    />
  );
}
export function Empty({
  title,
  body,
  action,
  onPress,
  icon = "compass",
}: {
  title: string;
  body: string;
  action?: string;
  onPress?: () => void;
  icon?: string;
}) {
  return (
    <View style={[S.card, { alignItems: "center", paddingVertical: 26 }]}>
      <View
        style={{
          backgroundColor: C.soft,
          padding: 13,
          borderRadius: radii.card,
        }}
      >
        <Icon name={icon} size={24} />
      </View>
      <Txt bold size={16} style={{ textAlign: "center" }}>
        {title}
      </Txt>
      <Txt
        color={C.muted}
        size={13}
        style={{ textAlign: "center", maxWidth: 320 }}
      >
        {body}
      </Txt>
      {action && onPress && (
        <Button label={action} secondary small onPress={onPress} />
      )}
    </View>
  );
}
export function QueryState({
  query,
}: {
  query: {
    isPending: boolean;
    isError: boolean;
    error: unknown;
    refetch: () => unknown;
  };
}) {
  if (query.isPending)
    return (
      <View style={{ padding: 24, alignItems: "center", gap: 10 }}>
        <ActivityIndicator color={C.purple} />
        <Txt color={C.muted} size={13}>
          불러오는 중이에요
        </Txt>
      </View>
    );
  if (query.isError)
    return (
      <Empty
        title="다시 연결해 주세요"
        body={errorText(query.error)}
        action="다시 시도"
        onPress={() => void query.refetch()}
        icon="wifi-off"
      />
    );
  return null;
}
export function Notice({
  children,
  error = false,
}: {
  children: React.ReactNode;
  error?: boolean;
}) {
  return (
    <View
      accessibilityRole={error ? "alert" : undefined}
      style={{
        padding: 14,
        borderRadius: 14,
        backgroundColor: error ? "#FFF0F2" : C.soft,
      }}
    >
      <Txt size={13} color={error ? C.red : C.purple}>
        {children}
      </Txt>
    </View>
  );
}
