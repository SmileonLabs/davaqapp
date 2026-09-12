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
import { Stack, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useMediaUri } from "@/hooks/useMediaUri";
import {
  categories,
  categoryName,
  kindName,
  statusName,
  dateLabel,
  errorText,
  type Listing,
  type Match,
  type Proposal,
} from "@/lib/davaq";
export const C = {
  purple: "#6D4AFF",
  ink: "#242438",
  muted: "#7B7891",
  bg: "#F7F6FB",
  white: "#FFFFFF",
  line: "#E9E6F3",
  soft: "#EEE9FF",
  green: "#198A63",
  red: "#BC4056",
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
    borderRadius: 22,
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
  onRefresh,
  refreshing = false,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  back?: boolean;
  right?: React.ReactNode;
  onRefresh?: () => void;
  refreshing?: boolean;
}) {
  const insets = useSafeAreaInsets(),
    router = useRouter();
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
          paddingBottom: back ? 40 + insets.bottom : 110 + insets.bottom,
          gap: 20,
        }}
      >
        <View style={S.between}>
          <View style={[S.row, { flex: 1 }]}>
            {back && (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="뒤로"
                onPress={() =>
                  router.canGoBack() ? router.back() : router.replace("/(tabs)")
                }
                style={{ paddingVertical: 8, paddingRight: 6 }}
              >
                <Icon name="arrow-left" color={C.ink} />
              </Pressable>
            )}
            <View style={{ flex: 1 }}>
              <Txt
                size={title === "DavaQ" ? 32 : 26}
                bold
                color={title === "DavaQ" ? "#351485" : C.ink}
              >
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
          borderRadius: small ? 12 : 16,
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
        placeholderTextColor="#A09BAF"
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
      <View style={{ backgroundColor: C.soft, padding: 13, borderRadius: 20 }}>
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
export function ListingImage({
  listing,
  height = 130,
}: {
  listing: Listing;
  height?: number;
}) {
  const uri = useMediaUri(listing.imageKey);
  return uri ? (
    <Image
      source={{ uri }}
      style={{ width: "100%", height }}
      resizeMode="cover"
    />
  ) : (
    <LinearGradient
      colors={
        listing.kind === "experience"
          ? ["#E6DCF9", "#C6B5EF"]
          : ["#F0EDF8", "#E2DCF3"]
      }
      style={{ height, alignItems: "center", justifyContent: "center", gap: 8 }}
    >
      <Icon
        name={categories.find((c) => c[0] === listing.category)?.[2] ?? "gift"}
        size={36}
        color="#8064BE"
      />
      <Txt size={12} color="#8064BE">
        {categoryName(listing.category)}
      </Txt>
    </LinearGradient>
  );
}
export function ListingCard({
  listing,
  compact = false,
}: {
  listing: Listing;
  compact?: boolean;
}) {
  const router = useRouter();
  return (
    <Pressable
      accessibilityRole="button"
      onPress={() => router.push(("/exchange/listings/" + listing.id) as never)}
      style={{
        borderRadius: 18,
        overflow: "hidden",
        backgroundColor: C.white,
        borderWidth: 1,
        borderColor: C.line,
        flex: compact ? 1 : undefined,
        minWidth: compact ? 140 : undefined,
      }}
    >
      <ListingImage listing={listing} height={compact ? 115 : 165} />
      <View style={{ padding: 13, gap: 6 }}>
        <Txt bold size={15} lines={2}>
          {listing.title}
        </Txt>
        <Txt color={C.muted} size={12}>
          {kindName(listing.kind)} · {listing.durationMinutes}분
          {listing.ev ? " · EV " + listing.ev : ""}
        </Txt>
        <View style={{ backgroundColor: C.soft, borderRadius: 8, padding: 7 }}>
          <Txt color={C.purple} size={12} lines={2}>
            ⇄{" "}
            {listing.wantedText ||
              listing.wantedCategories.map(categoryName).join(" · ") ||
              "교환 조건 협의"}
          </Txt>
        </View>
        <Txt color={C.muted} size={12} lines={1}>
          {listing.delivery === "online"
            ? "온라인"
            : listing.location || "지역 협의"}
          {listing.availableDays.length
            ? " · " +
              listing.availableDays.map((d) => "일월화수목금토"[d]).join("·")
            : ""}
        </Txt>
        {listing.status !== "published" && (
          <Txt size={12} color={C.purple}>
            {statusName(listing.status)}
          </Txt>
        )}
      </View>
    </Pressable>
  );
}
export function PairCard({ match }: { match: Match }) {
  const router = useRouter();
  return (
    <Pressable
      accessibilityRole="button"
      onPress={() => router.push(("/exchange/matches/" + match.id) as never)}
      style={S.card}
    >
      <View style={S.row}>
        <View style={{ flex: 1, gap: 6 }}>
          <Txt size={11} color={C.muted}>
            내가 줄 수 있는 것
          </Txt>
          <Txt bold>{match.offer.title}</Txt>
        </View>
        <Icon name="repeat" size={26} />
        <View style={{ flex: 1, gap: 6 }}>
          <Txt size={11} color={C.muted}>
            받고 싶은 경험
          </Txt>
          <Txt bold>{match.target.title}</Txt>
        </View>
      </View>
      <Txt color={C.purple} size={13}>
        {match.reasons[0]} ↗
      </Txt>
    </Pressable>
  );
}
export function ProposalCard({ proposal: p }: { proposal: Proposal }) {
  const router = useRouter();
  return (
    <Pressable
      accessibilityRole="button"
      onPress={() => router.push(("/exchange/proposals/" + p.id) as never)}
      style={S.card}
    >
      <View style={S.between}>
        <Txt color={C.purple} bold size={12}>
          {statusName(p.status)}
        </Txt>
        <Txt color={C.muted} size={12}>
          조건 v{p.version}
        </Txt>
      </View>
      <Txt bold>
        {p.snapshots.offer.title} ⇄ {p.snapshots.requested.title}
      </Txt>
      <Txt size={13} color={C.muted}>
        {dateLabel(p.terms.offerStartsAt)} · {p.terms.location}
      </Txt>
      <Txt size={13} color={C.purple}>
        {p.status === "negotiating"
          ? p.acceptances.length + "/2명 동의"
          : "내용 확인"}{" "}
        ›
      </Txt>
    </Pressable>
  );
}
