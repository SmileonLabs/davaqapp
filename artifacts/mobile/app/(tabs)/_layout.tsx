import React from "react";
import { Tabs, Redirect, useSegments } from "expo-router";
import { useAuth } from "@/lib/davaqAuth";
import { Platform, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { usePwaBottomInset } from "@/hooks/usePwaBottomInset";
import { useUnreadMessageCount } from "@/hooks/useUnreadMessageCount";
import { C, Txt } from "@/components/davaq/UI";
import {
  ExchangeIcon as Icon,
  type ExchangeIconName,
} from "@/components/tcg/ExchangeIcon";
import { useWarmExchangeFeed } from "@/hooks/useExchangeFeed";
export default function TabLayout() {
  useWarmExchangeFeed();
  const segments = useSegments();
  const immersive = segments[segments.length - 1] === "search";
  const { isLoaded, isSignedIn } = useAuth(),
    insets = useSafeAreaInsets(),
    pwa = usePwaBottomInset(),
    { count } = useUnreadMessageCount(),
    bottom = Platform.OS === "web" ? pwa : insets.bottom;
  if (!isLoaded) return null;
  if (!isSignedIn) return <Redirect href="/(auth)/sign-in" />;
  const tab = (title: string, name: string) => ({
    title,
    tabBarIcon: ({ focused }: { focused: boolean }) => (
      <View
        style={{
          width: 44,
          height: 30,
          borderRadius: 10,
          backgroundColor: focused
            ? immersive
              ? "rgba(255,255,255,0.18)"
              : "#111111"
            : "transparent",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <Icon
          name={name as ExchangeIconName}
          color={
            immersive
              ? focused
                ? "#FFFFFF"
                : "rgba(255,255,255,0.68)"
              : focused
                ? "#FFFFFF"
                : "#8A8A8A"
          }
          size={22}
        />
      </View>
    ),
    tabBarLabel: ({ focused }: { focused: boolean }) => (
      <Txt
        size={11}
        bold={focused}
        color={
          immersive
            ? focused
              ? "#FFFFFF"
              : "rgba(255,255,255,0.68)"
            : focused
              ? "#111111"
              : "#8A8A8A"
        }
        style={{ marginTop: 4 }}
      >
        {title}
      </Txt>
    ),
  });
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        sceneStyle: { backgroundColor: C.bg },
        tabBarActiveTintColor: C.purple,
        tabBarInactiveTintColor: C.muted,
        tabBarLabelStyle: {
          fontSize: 11,
          lineHeight: 16,
          flexShrink: 0,
          fontWeight: "600",
          marginTop: 2,
        },
        tabBarItemStyle: { paddingVertical: 0 },
        tabBarStyle: {
          position: "absolute",
          height: 72 + bottom,
          paddingTop: 10,
          paddingBottom: Math.max(10, bottom),
          backgroundColor: immersive ? "rgba(9,8,17,0.14)" : "white",
          borderTopColor: immersive ? "transparent" : C.line,
          shadowOpacity: 0,
          elevation: 0,
        },
      }}
    >
      <Tabs.Screen name="index" options={tab("홈", "home")} />
      <Tabs.Screen name="search" options={tab("교환", "repeat")} />
      <Tabs.Screen
        name="chats"
        options={{
          ...tab("채팅", "message-circle"),
          tabBarBadge: count > 0 ? (count > 99 ? "99+" : count) : undefined,
          tabBarBadgeStyle: { backgroundColor: C.purple, color: "white" },
        }}
      />
      <Tabs.Screen
        name="agent"
        options={{
          ...tab(
            Platform.OS === "web" ? "검색" : "스캔",
            Platform.OS === "web" ? "search" : "maximize",
          ),
          ...(Platform.OS !== "web"
            ? { tabBarStyle: { display: "none" as const } }
            : {}),
        }}
      />
      <Tabs.Screen name="exchanges" options={tab("컬렉션", "layers")} />
      <Tabs.Screen name="settings" options={tab("설정", "settings")} />
      {[
        "feed",
        "battle",
        "dungeon",
        "quests",
        "persona",
        "character/[profileId]",
      ].map((name) => (
        <Tabs.Screen key={name} name={name} options={{ href: null }} />
      ))}
    </Tabs>
  );
}
