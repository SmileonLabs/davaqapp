import {
  Inter_400Regular,
  Inter_500Medium,
  Inter_600SemiBold,
  Inter_700Bold,
  useFonts,
} from "@expo-google-fonts/inter";
import { ClerkProvider, useAuth } from "@clerk/expo";
import { tokenCache } from "@clerk/expo/token-cache";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Stack, useRouter } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { StatusBar } from "expo-status-bar";
import React, { useEffect, useState } from "react";
import { Feather } from "@expo/vector-icons";
import { ActivityIndicator, Platform, Pressable, Text, View } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { KeyboardProvider } from "react-native-keyboard-controller";
import { SafeAreaProvider } from "react-native-safe-area-context";

import {
  setAuthTokenGetter,
  setBaseUrl,
  setCharacterProfileIdGetter,
} from "@workspace/api-client-react";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { CallProvider } from "@/components/CallProvider";
import { PushRegistrar } from "@/components/PushRegistrar";
import { NativePushRegistrar } from "@/components/NativePushRegistrar";
import { ForegroundNotifier } from "@/components/ForegroundNotifier";
import { UnreadBadgeSync } from "@/components/UnreadBadgeSync";
import { ChatOutboxDrainer } from "@/components/ChatOutboxDrainer";
import { ThemeModeContext, ThemeModeProvider, useThemeMode } from "@/hooks/useThemeMode";
import { useColors } from "@/hooks/useColors";
import { getApiBase } from "@/lib/apiBase";
import { useRealtimeInvalidation } from "@/lib/realtime";
import { usePresenceHeartbeat } from "@/hooks/usePresence";
import { WalletConnectionProvider } from "@/lib/walletConnection";

const apiBase = getApiBase();
if (apiBase) setBaseUrl(apiBase);

const publishableKey = process.env.EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY!;
const rawProxyUrl = process.env.EXPO_PUBLIC_CLERK_PROXY_URL || undefined;
const proxyUrl = publishableKey?.startsWith("pk_live_") ? rawProxyUrl : undefined;

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
    nav.standalone === true || window.matchMedia("(display-mode: standalone)").matches;
  return isIOS && standalone;
}

// SplashScreen is native-only; ignore errors on web
try {
  SplashScreen.preventAutoHideAsync();
} catch {}

function createSessionQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        retry: 1,
        staleTime: 5000,
      },
    },
  });
}

function RealtimeInvalidator() {
  useRealtimeInvalidation();
  return null;
}

function PresenceHeartbeat() {
  usePresenceHeartbeat();
  return null;
}

function ApiAuthBridge({ children }: { children: React.ReactNode }) {
  const { isLoaded, isSignedIn, getToken, userId, sessionId } = useAuth();
  const authState = !isLoaded
    ? null
    : isSignedIn
      ? `signed-in:${sessionId ?? userId ?? "pending"}`
      : "signed-out";
  const [readyState, setReadyState] = useState<string | null>(null);

  useEffect(() => {
    if (!isLoaded) {
      setAuthTokenGetter(null);
      setCharacterProfileIdGetter(null);
      setReadyState(null);
      return;
    }

    if (!isSignedIn) {
      setAuthTokenGetter(null);
      setCharacterProfileIdGetter(null);
      setReadyState(authState);
      return;
    }

    // Descendant queries can start as soon as they mount. Do not render them
    // until the bearer-token getter is installed, otherwise the first wave of
    // /users/me and /admin requests races this effect and receives 401.
    setAuthTokenGetter(() => getToken());
    setReadyState(authState);
    return () => {
      setAuthTokenGetter(null);
      setCharacterProfileIdGetter(null);
      setReadyState(null);
    };
  }, [isLoaded, isSignedIn, getToken, sessionId, userId]);

  if (!authState || readyState !== authState) {
    return (
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
        <ActivityIndicator size="large" color="#8B5CF6" />
      </View>
    );
  }

  return <>{children}</>;
}

function SessionQueryProvider({ children }: { children: React.ReactNode }) {
  const { isSignedIn, userId, sessionId } = useAuth();
  const sessionKey = isSignedIn
    ? sessionId ?? userId ?? "signed-in-pending"
    : "signed-out";
  const client = React.useMemo(createSessionQueryClient, [sessionKey]);

  useEffect(
    () => () => {
      void client.cancelQueries();
      client.clear();
    },
    [client],
  );

  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

function RootStackNav() {
  const colors = useColors();
  const { scheme } = useThemeMode();
  const router = useRouter();
  const [isIOSStandalonePwa, setIsIOSStandalonePwa] = useState(() => getIsIOSStandalonePwa());

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

  const useChatOverlay = Platform.OS === "web" && !isIOSStandalonePwa;

  return (
    <>
      <StatusBar
        style={scheme === "dark" ? "light" : "dark"}
        backgroundColor={colors.background}
      />
      <Stack
      screenOptions={{
        headerStyle: { backgroundColor: colors.background },
        headerTintColor: colors.foreground,
        headerTitleStyle: { color: colors.foreground },
        headerShadowVisible: false,
        headerLeft: ({ canGoBack }) =>
          canGoBack ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="뒤로가기"
              hitSlop={10}
              onPress={() => router.back()}
              style={({ pressed }) => ({ opacity: pressed ? 0.55 : 1, marginLeft: 4 })}
            >
              <Feather name="chevron-left" size={27} color={colors.foreground} />
            </Pressable>
          ) : null,
        contentStyle: { backgroundColor: colors.background },
      }}
    >
      <Stack.Screen name="index" options={{ headerShown: false }} />
      <Stack.Screen name="(auth)" options={{ headerShown: false }} />
      <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
      <Stack.Screen name="onboarding" options={{ headerShown: false }} />
      <Stack.Screen name="post/[postId]" options={{ headerShown: false }} />
      <Stack.Screen
        name="chat/[id]"
        options={{
          headerShown: false,
          animation: Platform.OS === "web" ? "none" : "slide_from_right",
          presentation: useChatOverlay ? "transparentModal" : "card",
          contentStyle: {
            backgroundColor: useChatOverlay ? "transparent" : colors.background,
          },
          gestureEnabled: true,
        }}
      />
      <Stack.Screen
        name="friends/add"
        options={{ title: "친구 추가", headerBackTitle: "Back" }}
      />
      <Stack.Screen
        name="friends/requests"
        options={{ title: "친구 요청", headerBackTitle: "Back" }}
      />
      <Stack.Screen
        name="group/create"
        options={{ headerShown: false }}
      />
      <Stack.Screen
        name="group/invite"
        options={{ title: "친구 초대", headerBackTitle: "Back" }}
      />
      <Stack.Screen name="dungeon/[id]" options={{ headerShown: false }} />
      <Stack.Screen
        name="battle/create"
        options={{ title: "토크배틀", headerBackTitle: "Back" }}
      />
      <Stack.Screen
        name="battle/topic"
        options={{ title: "주제 선택", headerBackTitle: "Back" }}
      />
      <Stack.Screen name="battle/[id]" options={{ headerShown: false }} />
      <Stack.Screen
        name="profile/edit"
        options={{ title: "프로필 수정", headerBackTitle: "Back" }}
      />
      <Stack.Screen name="profile/avatar" options={{ headerShown: false }} />
      <Stack.Screen name="profile/create-fan" options={{ headerShown: false }} />
      <Stack.Screen name="profiles/index" options={{ headerShown: false }} />
      <Stack.Screen name="profiles/summon-star" options={{ headerShown: false }} />
      <Stack.Screen name="profiles/social" options={{ headerShown: false }} />
      <Stack.Screen name="profile/[userId]" options={{ headerShown: false }} />
      <Stack.Screen
        name="profile/history"
        options={{ title: "프로필 히스토리", headerBackTitle: "Back" }}
      />
      <Stack.Screen
        name="daily-talk-reward/generate"
        options={{ title: "Talk to Earn", headerBackTitle: "Back" }}
      />
      <Stack.Screen
        name="daily-talk-reward/history"
        options={{ title: "톡 리워드 히스토리", headerBackTitle: "Back" }}
      />
      <Stack.Screen
        name="daily-talk-reward/[id]"
        options={{ title: "오늘의 대화 일기", headerBackTitle: "Back" }}
      />
      <Stack.Screen
        name="pvt/wallet"
        options={{ headerShown: false }}
      />
      <Stack.Screen name="friends/index" options={{ headerShown: false }} />
      <Stack.Screen name="settings/index" options={{ headerShown: false }} />
      <Stack.Screen
        name="profile/ranking"
        options={{ title: "랭킹", headerBackTitle: "Back" }}
      />
      <Stack.Screen
        name="clan/index"
        options={{ title: "팬클럽", headerBackTitle: "Back" }}
      />
      <Stack.Screen
        name="clan/create"
        options={{ title: "팬클럽 만들기", headerBackTitle: "Back" }}
      />
      <Stack.Screen
        name="clan/browse"
        options={{ title: "팬클럽 찾기", headerBackTitle: "Back" }}
      />
      <Stack.Screen
        name="clan/memories"
        options={{ title: "팬클럽 기억", headerBackTitle: "Back" }}
      />
      <Stack.Screen
        name="clan/memory-new"
        options={{ title: "기억 남기기", headerBackTitle: "Back" }}
      />
      <Stack.Screen
        name="clan/wars"
        options={{ title: "팬클럽전", headerBackTitle: "Back" }}
      />
      <Stack.Screen
        name="clan/war-create"
        options={{ title: "팬클럽전 만들기", headerBackTitle: "Back" }}
      />
      <Stack.Screen
        name="clan/war/[id]"
        options={{ title: "팬클럽전", headerBackTitle: "Back" }}
      />
      <Stack.Screen
        name="settings/notifications"
        options={{ title: "알림 설정", headerBackTitle: "Back" }}
      />
      <Stack.Screen
        name="settings/blocked"
        options={{ title: "차단 목록", headerBackTitle: "Back" }}
      />
      <Stack.Screen
        name="settings/another-me"
        options={{ title: "DavaQ 소환", headerBackTitle: "Back" }}
      />
      <Stack.Screen
        name="settings/ai-memories"
        options={{ title: "내 AI 기억", headerBackTitle: "Back" }}
      />
      <Stack.Screen name="settings/ontology" options={{ headerShown: false }} />
      <Stack.Screen
        name="settings/nft-admin"
        options={{ title: "NFT 컬렉션 관리", headerBackTitle: "Back" }}
      />
      <Stack.Screen
        name="settings/knowledge-admin"
        options={{ title: "AI 지식 관리자", headerBackTitle: "Back" }}
      />
      </Stack>
    </>
  );
}

function RootLayoutNav() {
  const { isSignedIn } = useAuth();
  const themeMode = useThemeMode();
  const authenticatedTheme = React.useMemo(
    () =>
      isSignedIn
        ? { ...themeMode, mode: "dark" as const, scheme: "dark" as const }
        : themeMode,
    [isSignedIn, themeMode],
  );

  return (
    <ThemeModeContext.Provider value={authenticatedTheme}>
      <RootStackNav />
    </ThemeModeContext.Provider>
  );
}

export default function RootLayout() {
  const [fontTimeout, setFontTimeout] = useState(false);
  const [fontsLoaded, fontError] = useFonts({
    Inter_400Regular,
    Inter_500Medium,
    Inter_600SemiBold,
    Inter_700Bold,
  });

  useEffect(() => {
    const timer = setTimeout(() => setFontTimeout(true), 3000);
    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (fontsLoaded || fontError || fontTimeout) {
      try { SplashScreen.hideAsync(); } catch {}
    }
  }, [fontsLoaded, fontError, fontTimeout]);

  // On web, useFonts loads via CSS and may never flip to true —
  // don't block rendering; proceed immediately.
  if (Platform.OS !== "web" && !fontsLoaded && !fontError && !fontTimeout) return null;

  if (!publishableKey) {
    return (
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center", padding: 24 }}>
        <Text style={{ fontSize: 16, fontWeight: "700", textAlign: "center" }}>
          Clerk publishable key가 설정되지 않았습니다.
        </Text>
      </View>
    );
  }

  return (
    <ErrorBoundary>
      <ThemeModeProvider>
        <ClerkProvider
          publishableKey={publishableKey}
          // tokenCache uses expo-secure-store which is native-only
          tokenCache={Platform.OS !== "web" ? tokenCache : undefined}
          proxyUrl={proxyUrl}
        >
          <ApiAuthBridge>
            <SafeAreaProvider>
              <SessionQueryProvider>
                <WalletConnectionProvider>
                  <GestureHandlerRootView style={{ flex: 1 }}>
                    <CallProvider>
                    <RealtimeInvalidator />
                    <PresenceHeartbeat />
                    <ChatOutboxDrainer />
                    <UnreadBadgeSync />
                    {Platform.OS === "web" ? (
                      <>
                        <PushRegistrar />
                        <RootLayoutNav />
                        <ForegroundNotifier />
                      </>
                    ) : (
                      <KeyboardProvider>
                        <NativePushRegistrar />
                        <RootLayoutNav />
                      </KeyboardProvider>
                    )}
                    </CallProvider>
                  </GestureHandlerRootView>
                </WalletConnectionProvider>
              </SessionQueryProvider>
            </SafeAreaProvider>
          </ApiAuthBridge>
        </ClerkProvider>
      </ThemeModeProvider>
    </ErrorBoundary>
  );
}
