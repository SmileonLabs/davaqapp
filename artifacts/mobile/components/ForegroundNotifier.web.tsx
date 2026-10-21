import React, { useCallback, useEffect, useRef, useState } from "react";
import { Animated, Pressable, StyleSheet, Text, View } from "react-native";
import { usePathname, useRouter } from "expo-router";
import { useAuth } from "@/lib/davaqAuth";
import {
  getListIncomingFriendRequestsQueryKey,
  getListRoomsQueryKey,
  useGetMe,
  useListIncomingFriendRequests,
  useListRooms,
} from "@workspace/api-client-react";
import { Avatar } from "@/components/Avatar";
import { useColors } from "@/hooks/useColors";
import { userDisplayName } from "@/lib/friendNames";

type ToastData = {
  key: number;
  title: string;
  body: string;
  url: string;
  avatarName: string;
  avatarUri: string | null;
  avatarCharacterType: "fan" | "star" | "official_ai" | string | null;
};

type NotifyInput = Omit<ToastData, "key"> & { dedupeKey: string };

/**
 * Cross-tab de-duplication. When the app is open in several tabs they each poll
 * independently; this localStorage stamp lets only the first tab to observe an
 * event surface it, so the user never sees the same popup twice.
 */
function claimEvent(dedupeKey: string): boolean {
  try {
    const k = `tt_notif_${dedupeKey}`;
    const now = Date.now();
    const prev = Number(localStorage.getItem(k) || "0");
    if (now - prev < 15000) return false;
    localStorage.setItem(k, String(now));
    return true;
  } catch {
    return true; // localStorage unavailable — don't block the notification
  }
}

function isVisible(): boolean {
  return (
    typeof document === "undefined" || document.visibilityState === "visible"
  );
}

// "Actively using" = this window is BOTH visible and focused. While true the
// user is looking at the app and must NOT be interrupted by any notification —
// notifications should only arrive once they've left the screen (switched
// window/app, minimized, or backgrounded the tab).
function isActivelyUsing(): boolean {
  if (typeof document === "undefined") return false;
  const focused =
    typeof document.hasFocus === "function" ? document.hasFocus() : true;
  return document.visibilityState === "visible" && focused;
}

function vibrate(): void {
  try {
    navigator.vibrate?.([120, 60, 120]);
  } catch {
    // not supported — ignore
  }
}

let audioCtx: AudioContext | null = null;
function playChime(): void {
  try {
    const Ctx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext })
        .webkitAudioContext;
    if (!Ctx) return;
    if (!audioCtx) audioCtx = new Ctx();
    const ctx = audioCtx;
    if (ctx.state === "suspended") void ctx.resume();
    const now = ctx.currentTime;
    const tones = [880, 1175]; // two-note rising chime
    tones.forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.value = freq;
      const start = now + i * 0.14;
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(0.18, start + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.22);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(start);
      osc.stop(start + 0.24);
    });
  } catch {
    // autoplay blocked or unsupported — ignore
  }
}

function roomDisplayName(room: any, myId?: string): string {
  if (room.name) return room.name;
  if (room.type === "direct") {
    const other = room.members?.find((m: any) => m.id !== myId);
    return userDisplayName(other, "채팅방");
  }
  return (
    room.members?.map((m: any) => userDisplayName(m, "사용자")).join(", ") ??
    "그룹 채팅"
  );
}

function roomAvatar(room: any, myId?: string) {
  if (room.type === "direct") {
    const other = room.members?.find((m: any) => m.id !== myId);
    return {
      uri: other?.profile?.profileImageUrl ?? null,
      type: other?.profile?.type ?? "fan",
    };
  }
  return { uri: null, type: null };
}

/**
 * Web-only new-message / friend-request notifier.
 *
 * Notification policy is keyed on ACTIVE USE (window focused + visible):
 * - Actively using the app → surface nothing (the chat updates live).
 * - Left the screen (unfocused / minimized / backgrounded tab) → notify.
 *
 * The "away" notification is owned by the service worker's OS push (which only
 * shows once a window loses focus). This in-app toast is a FALLBACK that fires
 * only when push can't be delivered (no permission / no subscription), so the
 * two never produce duplicate popups.
 */
export function ForegroundNotifier() {
  const { isSignedIn } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const colors = useColors();
  // Kept in a ref so the message-detection effect can read the live route
  // without re-subscribing every navigation.
  const pathnameRef = useRef(pathname);
  pathnameRef.current = pathname;

  const { data: me } = useGetMe();
  const { data: rooms, refetch: refetchRooms } = useListRooms({
    query: { enabled: !!isSignedIn, queryKey: getListRoomsQueryKey() },
  });
  const { data: requests, refetch: refetchRequests } =
    useListIncomingFriendRequests({
      query: {
        enabled: !!isSignedIn,
        queryKey: getListIncomingFriendRequestsQueryKey(),
      },
    });

  const prevUnread = useRef<Map<string, number> | null>(null);
  const prevRequestIds = useRef<Set<string> | null>(null);

  // Whether an OS push notification can actually be delivered (permission
  // granted AND an active push subscription exists). When true the service
  // worker owns the "away" notification and the in-app toast stays silent to
  // avoid duplicates; when false the toast is the only fallback. Re-checked on
  // mount, tab focus, and visibility changes since permission/subscription can
  // change at runtime. Seed optimistically from permission so the async check
  // below doesn't leave a load-race window where an away event briefly shows
  // BOTH a toast and the SW banner — when permission is granted a subscription
  // almost always exists (PushRegistrar keeps it live); the async check then
  // confirms/corrects.
  const pushReady = useRef(
    typeof Notification !== "undefined" &&
      Notification.permission === "granted",
  );
  useEffect(() => {
    let cancelled = false;
    const check = async () => {
      try {
        if (
          typeof Notification === "undefined" ||
          Notification.permission !== "granted" ||
          typeof navigator === "undefined" ||
          !("serviceWorker" in navigator)
        ) {
          if (!cancelled) pushReady.current = false;
          return;
        }
        const reg = await navigator.serviceWorker.ready;
        const sub = await reg.pushManager.getSubscription();
        if (!cancelled) pushReady.current = !!sub;
      } catch {
        if (!cancelled) pushReady.current = false;
      }
    };
    void check();
    const onFocus = () => void check();
    const onVis = () => {
      if (document.visibilityState === "visible") void check();
    };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVis);
    return () => {
      cancelled = true;
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, []);

  const [toast, setToast] = useState<ToastData | null>(null);
  const toastKey = useRef(0);
  const dismissTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const slide = useRef(new Animated.Value(-120)).current;

  // WebSocket events refresh room data immediately. Keep a slow fallback poll
  // for reconnect gaps without hammering the expensive room-metadata endpoint.
  useEffect(() => {
    if (!isSignedIn) return;
    const t = setInterval(() => {
      refetchRooms();
      refetchRequests();
    }, 30000);
    return () => clearInterval(t);
  }, [isSignedIn, refetchRooms, refetchRequests]);

  // When the user taps an OS push notification, the service worker focuses this
  // window and posts the target URL. Navigate in-app (no reload / new window).
  useEffect(() => {
    if (typeof navigator === "undefined" || !("serviceWorker" in navigator))
      return;
    const onMessage = (e: MessageEvent) => {
      const data = e.data;
      if (data?.type === "data-changed") {
        // A push just arrived; refresh the list/badges immediately so they update
        // together with the OS notification instead of on the next 5s poll.
        refetchRooms();
        refetchRequests();
        return;
      }
      if (
        data?.type === "notification-navigate" &&
        typeof data.url === "string"
      ) {
        // Avoid stacking a duplicate route when we're already on the target page.
        if (
          typeof location !== "undefined" &&
          location.pathname.endsWith(data.url)
        )
          return;
        // navigate() (not push()) so repeated taps don't pile up duplicate screens.
        router.navigate(data.url as any);
      }
    };
    navigator.serviceWorker.addEventListener("message", onMessage);
    return () =>
      navigator.serviceWorker.removeEventListener("message", onMessage);
  }, [router, refetchRooms, refetchRequests]);

  // Reset baselines on sign-out so a later sign-in doesn't replay old state.
  useEffect(() => {
    if (!isSignedIn) {
      prevUnread.current = null;
      prevRequestIds.current = null;
    }
  }, [isSignedIn]);

  const dismiss = useCallback(() => {
    if (dismissTimer.current) clearTimeout(dismissTimer.current);
    Animated.timing(slide, {
      toValue: -120,
      duration: 220,
      useNativeDriver: true,
    }).start(() => {
      setToast(null);
    });
  }, [slide]);

  const showToast = useCallback(
    (data: Omit<ToastData, "key">) => {
      toastKey.current += 1;
      setToast({ ...data, key: toastKey.current });
      slide.setValue(-120);
      Animated.spring(slide, {
        toValue: 0,
        useNativeDriver: true,
        friction: 8,
      }).start();
      if (dismissTimer.current) clearTimeout(dismissTimer.current);
      dismissTimer.current = setTimeout(dismiss, 5000);
    },
    [slide, dismiss],
  );

  const notificationsOn = me?.notificationEnabled ?? true;

  const notify = useCallback(
    ({ dedupeKey, ...data }: NotifyInput) => {
      // Respect the user's notification setting — nothing when it's off.
      if (!notificationsOn) return;
      // Never interrupt active use: if this window is focused AND visible the
      // user is looking at the app, so we surface nothing (the chat updates
      // live). Notifications only arrive once they've left the screen.
      if (isActivelyUsing()) return;
      // When OS push can deliver (permission granted + active subscription) the
      // service worker shows the system notification for the away case — so the
      // in-app toast stays silent to avoid a duplicate popup. The toast is only
      // a FALLBACK for when push can't be delivered.
      if (pushReady.current) return;
      // A toast is only seen on a visible tab; if the tab is hidden/minimized
      // there's nothing to show (and no push to fall back on).
      if (!isVisible()) return;
      if (!claimEvent(dedupeKey)) return;
      playChime();
      vibrate();
      showToast(data);
    },
    [showToast, notificationsOn],
  );

  // Detect new messages via per-room unread count increases.
  useEffect(() => {
    if (!isSignedIn || !rooms) return;
    const next = new Map<string, number>();
    for (const room of rooms as any[]) next.set(room.id, room.unreadCount ?? 0);

    if (prevUnread.current === null) {
      prevUnread.current = next; // seed baseline silently
      return;
    }

    const prev = prevUnread.current;
    let latest: { room: any; at: string } | null = null;
    for (const room of rooms as any[]) {
      const before = prev.get(room.id) ?? 0;
      const after = room.unreadCount ?? 0;
      if (after > before) {
        // Don't pop a toast for the room that's already open on screen — the chat
        // view will mark it read momentarily. Without this, a dungeon's DM reply
        // (which always follows the player's own turn) fires a toast for the very
        // room the player is actively reading.
        if (pathnameRef.current === `/chat/${room.id}`) continue;
        const at = room.lastMessageAt ?? room.createdAt ?? "";
        if (!latest || at.localeCompare(latest.at) > 0) latest = { room, at };
      }
    }
    prevUnread.current = next;

    if (latest) {
      const r = latest.room;
      const avatar = roomAvatar(r, me?.id);
      notify({
        title: roomDisplayName(r, me?.id),
        body: r.lastMessage ?? "새 메시지가 도착했습니다",
        url: `/chat/${r.id}`,
        avatarName: roomDisplayName(r, me?.id),
        avatarUri: avatar.uri,
        avatarCharacterType: avatar.type,
        dedupeKey: `msg_${r.id}_${latest.at}`,
      });
    }
  }, [rooms, isSignedIn, me?.id, notify]);

  // Detect new incoming friend requests.
  useEffect(() => {
    if (!isSignedIn || !requests) return;
    const list = requests as any[];
    const nextIds = new Set<string>(list.map((r) => r.id));

    if (prevRequestIds.current === null) {
      prevRequestIds.current = nextIds; // seed baseline silently
      return;
    }

    const prev = prevRequestIds.current;
    const fresh = list.filter((r) => !prev.has(r.id));
    prevRequestIds.current = nextIds;

    if (fresh.length > 0) {
      const r = fresh[fresh.length - 1];
      const name = r.user?.nickname ?? "누군가";
      notify({
        title: "새 친구 요청",
        body: `${name}님이 친구 요청을 보냈습니다`,
        url: "/friends/requests",
        avatarName: name,
        avatarUri: r.user?.profile?.profileImageUrl ?? null,
        avatarCharacterType: r.user?.profile?.type ?? "fan",
        dedupeKey: `req_${r.id}`,
      });
    }
  }, [requests, isSignedIn, notify]);

  useEffect(() => {
    return () => {
      if (dismissTimer.current) clearTimeout(dismissTimer.current);
    };
  }, []);

  if (!toast) return null;

  return (
    <Animated.View
      pointerEvents="box-none"
      style={[styles.wrap, { transform: [{ translateY: slide }] }]}
    >
      <Pressable
        onPress={() => {
          // navigate() de-dupes existing routes instead of stacking a new screen
          // every tap; skip entirely if we're already on the target page.
          if (
            typeof location === "undefined" ||
            !location.pathname.endsWith(toast.url)
          ) {
            router.navigate(toast.url as any);
          }
          dismiss();
        }}
        style={({ pressed }) => [
          styles.card,
          {
            backgroundColor: colors.card,
            borderColor: colors.border,
            opacity: pressed ? 0.92 : 1,
          },
        ]}
      >
        <Avatar
          uri={toast.avatarUri}
          name={toast.avatarName}
          size={42}
          crop="face"
          characterType={toast.avatarCharacterType}
        />
        <View style={styles.text}>
          <Text
            style={[styles.title, { color: colors.foreground }]}
            numberOfLines={1}
          >
            {toast.title}
          </Text>
          <Text
            style={[styles.body, { color: colors.mutedForeground }]}
            numberOfLines={2}
          >
            {toast.body}
          </Text>
        </View>
        <Pressable hitSlop={10} onPress={dismiss} style={styles.close}>
          <Text style={[styles.closeText, { color: colors.mutedForeground }]}>
            ✕
          </Text>
        </Pressable>
      </Pressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: "absolute",
    top: 16,
    left: 0,
    right: 0,
    alignItems: "center",
    zIndex: 9999,
  },
  card: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    width: "92%",
    maxWidth: 420,
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    shadowColor: "#000",
    shadowOpacity: 0.18,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 6 },
    elevation: 6,
  },
  text: { flex: 1 },
  title: { fontSize: 15, fontFamily: "Inter_600SemiBold", marginBottom: 2 },
  body: { fontSize: 13, fontFamily: "Inter_400Regular", lineHeight: 18 },
  close: { paddingHorizontal: 4, paddingVertical: 2 },
  closeText: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
});
