import { ShopInboxLink } from '@/components/shop/ShopInboxLink';
import { useMemo } from "react";
import { useColors } from "@/hooks/useColors";
import { interaction, fonts, fontSizes, radii } from "@/constants/designSystem";
import { Avatar } from "@/components/Avatar";
import { NeonBackdrop } from "@/components/NeonUI";
import { useDailyTalkRewardStatus } from "@/hooks/useDailyTalkReward";
import { userDisplayName } from "@/lib/friendNames";
import {
  markMyCharacterProfileNotificationRead,
  useGetMe,
  useGetMyCharacterProfileNotifications,
  useListRooms,
  type ChatRoom,
} from "@workspace/api-client-react";
import { Feather } from "@expo/vector-icons";
import { useFocusEffect, useRouter } from "expo-router";
import React from "react";
import {
  ActivityIndicator,
  FlatList,
  Image,
  Modal,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

type RoomCategory =
  | "all"
  | "unread"
  | "group"
  | "fanclub"
  | "counseling"
  | "friend_finding"
  | "meetup"
  | "casual"
  | "peer"
  | "karaoke";

type CategorizedRoom = ChatRoom & {
  category?: string;
  visibility?: string;
};

type RewardNoticeReason =
  | "analysis_disabled"
  | "insufficient_messages"
  | "insufficient_counterparts"
  | "status_error";

const FILTERS: Array<{ key: RoomCategory; label: string }> = [
  { key: "all", label: "전체" },
  { key: "unread", label: "안 읽음" },
  { key: "group", label: "그룹" },
  { key: "fanclub", label: "팬클럽" },
  { key: "counseling", label: "고민상담" },
  { key: "friend_finding", label: "친구찾기" },
  { key: "meetup", label: "번개·만남" },
  { key: "casual", label: "잡담" },
  { key: "peer", label: "또래방" },
  { key: "karaoke", label: "노래방" },
];

const CATEGORY_ICON: Record<string, keyof typeof Feather.glyphMap> = {
  fanclub: "heart",
  counseling: "coffee",
  friend_finding: "user-plus",
  meetup: "zap",
  casual: "message-circle",
  peer: "users",
  karaoke: "mic",
  growth_rpg: "compass",
  talk_battle: "radio",
};

function roomName(room: CategorizedRoom, myId?: string) {
  if (room.name?.trim()) return room.name.trim();
  if (room.type === "direct") {
    return userDisplayName(room.members?.find((member) => member.id !== myId), "채팅방");
  }
  return room.members?.map((member) => userDisplayName(member)).join(", ") || "그룹 채팅";
}

function roomAvatar(room: CategorizedRoom, myId?: string) {
  if (room.type !== "direct") return { uri: null, type: null };
  const other = room.members?.find((member) => member.id !== myId) as
    | (NonNullable<CategorizedRoom["members"]>[number] & {
        profile?: {
          profileImageUrl?: string | null;
          type?: string | null;
        } | null;
      })
    | undefined;
  // The legacy top-level field can contain the member's account photo. Chat is
  // character-scoped, so only render the explicitly resolved character image.
  return {
    uri: other?.profile?.profileImageUrl ?? null,
    type: other?.profile?.type ?? "fan",
  };
}

function formatTime(value?: string | null) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const now = new Date();
  if (date.toDateString() === now.toDateString()) {
    return date.toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" });
  }
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (date.toDateString() === yesterday.toDateString()) return "어제";
  return date.toLocaleDateString("ko-KR", { month: "long", day: "numeric" });
}

function notificationCopy(type: string) {
  if (type === "profile.followed") {
    return { title: "새로운 팔로워", body: "새로운 사용자가 내 프로필을 팔로우했습니다." };
  }
  return { title: "운영 알림", body: "새로운 알림이 도착했습니다." };
}

export default function ChatsScreenV2() {
  const styleColors = useColors();
  const styles = useMemo(() => makeStyles(styleColors), [styleColors]);

  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { data: me } = useGetMe();
  const roomsQuery = useListRooms();
  const [refreshing, setRefreshing] = React.useState(false);
  const refresh = async () => {
    if (refreshing) return;
    setRefreshing(true);
    try { await Promise.all([roomsQuery.refetch(), notificationQuery.refetch(), rewardStatusQuery.refetch()]); }
    finally { setRefreshing(false); }
  };
  const notificationQuery = useGetMyCharacterProfileNotifications();
  const rewardStatusQuery = useDailyTalkRewardStatus();
  const rooms = (roomsQuery.data ?? []) as CategorizedRoom[];
  const notifications = notificationQuery.data?.items ?? [];
  const latestNotification = notifications[0];
  const unreadNotifications = notifications.filter((item) => !item.readAt).length;
  const [filter, setFilter] = React.useState<RoomCategory>("all");
  const [rewardNotice, setRewardNotice] = React.useState<RewardNoticeReason | null>(null);

  useFocusEffect(
    React.useCallback(() => {
      void Promise.all([
        roomsQuery.refetch(),
        notificationQuery.refetch(),
        rewardStatusQuery.refetch(),
      ]);
    }, [notificationQuery.refetch, rewardStatusQuery.refetch, roomsQuery.refetch]),
  );

  React.useEffect(() => {
    const timer = setInterval(() => void roomsQuery.refetch(), 30_000);
    return () => clearInterval(timer);
  }, [roomsQuery.refetch]);

  const filteredRooms = React.useMemo(
    () =>
      rooms.filter((room) => {
        if (filter === "unread") return (room.unreadCount ?? 0) > 0;
        if (filter === "group") return room.type === "group";
        if (filter === "all") return true;
        return room.category === filter;
      }),
    [filter, rooms],
  );

  const openDailyTalkReward = React.useCallback(() => {
    const status = rewardStatusQuery.data;
    if (rewardStatusQuery.isError || !status) {
      setRewardNotice("status_error");
      return;
    }
    if (status.claimedToday) {
      router.push("/pvt/wallet" as never);
      return;
    }
    if (status.rewardId && status.status === "GENERATED") {
      router.push(`/daily-talk-reward/${status.rewardId}` as never);
      return;
    }
    if (status.canClaim) {
      router.push("/daily-talk-reward/generate" as never);
      return;
    }
    if (
      status.reason === "analysis_disabled" ||
      status.reason === "insufficient_counterparts"
    ) {
      setRewardNotice(status.reason);
      return;
    }
    setRewardNotice("insufficient_messages");
  }, [
    rewardStatusQuery.data,
    rewardStatusQuery.isError,
    router,
  ]);

  const rewardNoticeCopy = React.useMemo(() => {
    const status = rewardStatusQuery.data;
    switch (rewardNotice) {
      case "analysis_disabled":
        return {
          title: "대화 분석이 꺼져 있어요",
          body: "알림·분석 설정에서 Talk to Earn 대화 분석을 켜 주세요.",
          action: "설정으로 이동",
        };
      case "insufficient_counterparts":
        return {
          title: "실제 대화 상대가 필요해요",
          body: "오늘 친구 또는 그룹 채팅에서 다른 사용자와 대화한 뒤 다시 확인해 주세요.",
          action: "확인",
        };
      case "insufficient_messages":
        return {
          title: "오늘의 대화가 아직 부족해요",
          body: `현재 ${status?.messageCount ?? 0}/${status?.minMessageCount ?? 10}개가 집계됐어요. 매일 00시에 초기화되며, 조건을 채우면 Talk to Earn을 시작할 수 있어요.`,
          action: "확인",
        };
      case "status_error":
        return {
          title: "Talk to Earn 상태를 확인하지 못했어요",
          body: "네트워크 연결을 확인한 뒤 다시 불러와 주세요.",
          action: "다시 불러오기",
        };
      default:
        return null;
    }
  }, [rewardNotice, rewardStatusQuery.data]);

  const handleRewardNoticeAction = React.useCallback(() => {
    const reason = rewardNotice;
    setRewardNotice(null);
    if (reason === "analysis_disabled") {
      router.push("/settings/notifications" as never);
      return;
    }
    if (reason === "status_error") {
      void rewardStatusQuery.refetch();
    }
  }, [rewardNotice, rewardStatusQuery, router]);

  const openLatestNotification = React.useCallback(async () => {
    if (latestNotification?.type === "profile.followed") {
      const unreadFollowerNotifications = notifications.filter(
        (item) => item.type === "profile.followed" && !item.readAt,
      );
      if (unreadFollowerNotifications.length > 0) {
        await Promise.allSettled(
          unreadFollowerNotifications.map((item) =>
            markMyCharacterProfileNotificationRead(item.id),
          ),
        );
        await notificationQuery.refetch();
      }
      router.push("/profiles/social?tab=followers" as never);
      return;
    }
    router.push("/settings/notifications" as never);
  }, [
    latestNotification?.type,
    notificationQuery.refetch,
    notifications,
    router,
  ]);

  return (
    <NeonBackdrop style={styles.screen}>
      <View style={[styles.header, { paddingTop: insets.top + 12 }]}>
        <Text style={styles.title}>채팅</Text>
        <View style={styles.headerActions}>
          <Pressable
            accessibilityLabel="친구 추가"
            hitSlop={10}
            onPress={() => router.push("/friends/add")}
            style={styles.headerButton}
          >
            <Feather name="user-plus" size={27} color={styleColors.foreground} />
          </Pressable>
          <Pressable
            accessibilityLabel="친구 목록"
            hitSlop={10}
            onPress={() => router.push("/friends")}
            style={styles.headerButton}
          >
            <Feather name="users" size={28} color={styleColors.foreground} />
          </Pressable>
          <Pressable
            accessibilityLabel="그룹 채팅 만들기"
            hitSlop={10}
            onPress={() => router.push("/group/create")}
            style={styles.headerButton}
          >
            <Feather name="edit-3" size={27} color={styleColors.foreground} />
          </Pressable>
        </View>
      </View>

      <ScrollView
        horizontal
        directionalLockEnabled
        nestedScrollEnabled
        decelerationRate="fast"
        alwaysBounceHorizontal={false}
        alwaysBounceVertical={false}
        contentInsetAdjustmentBehavior="never"
        showsHorizontalScrollIndicator={false}
        style={styles.filterScroller}
        contentContainerStyle={styles.filters}
      >
        {FILTERS.map((item) => {
          const active = filter === item.key;
          return (
            <Pressable
              key={item.key}
              onPress={() => setFilter(item.key)}
              style={[styles.filter, active && styles.filterActive]}
            >
              <Text style={[styles.filterText, active && styles.filterTextActive]}>
                {item.label}
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>

      <FlatList
        style={{ flex: 1 }}
        contentInsetAdjustmentBehavior="never"
        automaticallyAdjustContentInsets={false}
        data={filteredRooms}
        keyExtractor={(item) => item.id}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => void refresh()}
            tintColor={styleColors.primary}
          />
        }
        contentContainerStyle={styles.list}
        ListHeaderComponent={
          filter === "all" ? (
            <View style={styles.listHeader}>
              <ShopInboxLink />
              <Pressable
                accessibilityRole="button"
                disabled={rewardStatusQuery.isLoading}
                onPress={openDailyTalkReward}
                style={({ pressed }) => [styles.rewardBannerButton, pressed && styles.pressed]}
              >
                <Image
                  accessibilityLabel="톡투언, 대화를 나누면 STAR Point를 얻을 수 있어요"
                  resizeMode="cover"
                  source={require("@/assets/images/chat/talk-to-earn-star-point-banner.png")}
                  style={styles.rewardBannerImage}
                />
                {rewardStatusQuery.isLoading ? (
                  <View style={styles.rewardStatusLoading}>
                    <ActivityIndicator size="small" color={styleColors.foreground} />
                  </View>
                ) : null}
              </Pressable>

              {latestNotification ? (
                <Pressable
                  onPress={openLatestNotification}
                  style={({ pressed }) => [styles.notificationCard, pressed && styles.pressed]}
                >
                  <View style={styles.notificationIcon}>
                    <Feather name="bell" size={23} color={styleColors.primary} />
                  </View>
                  <View style={styles.notificationCopy}>
                    <Text style={styles.notificationTitle}>
                      {notificationCopy(latestNotification.type).title}
                    </Text>
                    <Text style={styles.notificationBody} numberOfLines={1}>
                      {notificationCopy(latestNotification.type).body}
                    </Text>
                  </View>
                  <Text style={styles.notificationTime}>
                    {formatTime(latestNotification.createdAt)}
                  </Text>
                  {unreadNotifications > 0 ? (
                    <View style={styles.unreadBadge}>
                      <Text style={styles.unreadBadgeText}>
                        {unreadNotifications > 99 ? "99+" : unreadNotifications}
                      </Text>
                    </View>
                  ) : null}
                </Pressable>
              ) : null}
            </View>
          ) : null
        }
        ListEmptyComponent={
          roomsQuery.isLoading ? (
            <ActivityIndicator color={styleColors.primary} style={styles.loading} />
          ) : (
            <View style={styles.empty}>
              <Feather name="message-circle" size={34} color={styleColors.mutedForeground} />
              <Text style={styles.emptyTitle}>표시할 채팅방이 없어요</Text>
              <Text style={styles.emptyBody}>
                {filter === "all"
                  ? "친구를 찾거나 새 그룹 채팅을 만들어보세요."
                  : "다른 분류를 선택해 채팅방을 확인해보세요."}
              </Text>
            </View>
          )
        }
        renderItem={({ item }) => {
          const name = roomName(item, me?.id);
          const avatar = roomAvatar(item, me?.id);
          const unread = item.unreadCount ?? 0;
          const icon = CATEGORY_ICON[item.category ?? ""] ?? "users";
          return (
            <Pressable
              onPress={() =>
                router.push({
                  pathname: item.type === "battle" ? "/battle/[id]" : "/chat/[id]",
                  params: { id: item.id },
                })
              }
              style={({ pressed }) => [styles.roomCard, pressed && styles.pressed]}
            >
              {item.type === "direct" ? (
                <Avatar
                  uri={avatar.uri}
                  name={name}
                  size={58}
                  crop="face"
                  characterType={avatar.type}
                />
              ) : (
                <View style={styles.roomIcon}>
                  <Feather name={icon} size={26} color={styleColors.primary} />
                </View>
              )}
              <View style={styles.roomCopy}>
                <Text style={styles.roomName} numberOfLines={1}>{name}</Text>
                <Text style={styles.roomPreview} numberOfLines={1}>
                  {item.lastMessage || "아직 메시지가 없습니다."}
                </Text>
              </View>
              <View style={styles.roomMeta}>
                <Text style={styles.roomTime}>{formatTime(item.lastMessageAt)}</Text>
                {unread > 0 ? (
                  <View style={styles.unreadBadge}>
                    <Text style={styles.unreadBadgeText}>{unread > 99 ? "99+" : unread}</Text>
                  </View>
                ) : null}
              </View>
            </Pressable>
          );
        }}
      />
      <Modal
        transparent
        animationType="fade"
        visible={rewardNotice !== null}
        onRequestClose={() => setRewardNotice(null)}
      >
        <View style={styles.rewardNoticeBackdrop}>
          <View style={styles.rewardNoticeCard}>
            <View style={styles.rewardNoticeIcon}>
              <Feather name="message-circle" size={25} color={styleColors.primary} />
            </View>
            <Text style={styles.rewardNoticeTitle}>{rewardNoticeCopy?.title}</Text>
            <Text style={styles.rewardNoticeBody}>{rewardNoticeCopy?.body}</Text>
            <Pressable
              accessibilityRole="button"
              onPress={handleRewardNoticeAction}
              style={({ pressed }) => [
                styles.rewardNoticeButton,
                pressed && styles.pressed,
              ]}
            >
              <Text style={styles.rewardNoticeButtonText}>{rewardNoticeCopy?.action}</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    </NeonBackdrop>
  );
}

const makeStyles = (styleColors: ReturnType<typeof useColors>) => StyleSheet.create({
  screen: { flex: 1, backgroundColor: styleColors.background },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 20,
    paddingBottom: 14,
  },
  title: { color: styleColors.foreground, fontSize: fontSizes.banner, fontFamily: fonts.bold, letterSpacing: -1 },
  headerActions: { flexDirection: "row", alignItems: "center", gap: 17 },
  headerButton: { width: interaction.minTarget, height: interaction.minTarget, alignItems: "center", justifyContent: "center" },
  filterScroller: {
    flexGrow: 0,
    flexShrink: 0,
    width: "100%",
    height: 62,
  },
  filters: {
    alignItems: "center",
    paddingHorizontal: 16,
    paddingTop: 6,
    paddingBottom: 12,
    gap: 9,
  },
  filter: {
    height: interaction.minTarget,
    paddingHorizontal: 20,
    borderRadius: 23,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: styleColors.card,
    borderWidth: 1,
    borderColor: styleColors.border,
  },
  filterActive: {
    backgroundColor: styleColors.primary,
    borderColor: styleColors.primary,
    shadowColor: styleColors.primary,
    shadowOpacity: 0.55,
    shadowRadius: 12,
  },
  filterText: { color: styleColors.mutedForeground, fontSize: fontSizes.body, fontFamily: fonts.semibold },
  filterTextActive: { color: styleColors.primaryForeground },
  list: { paddingHorizontal: 16, paddingBottom: 130, flexGrow: 1 },
  listHeader: { gap: 13, marginBottom: 4 },
  rewardBannerButton: {
    width: "100%",
    aspectRatio: 2.72,
    borderRadius: 24,
    overflow: "hidden",
    backgroundColor: styleColors.card,
  },
  rewardBannerImage: {
    width: "100%",
    height: "100%",
  },
  rewardStatusLoading: {
    ...StyleSheet.absoluteFillObject,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: styleColors.card,
  },
  rewardNoticeBackdrop: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
    backgroundColor: styleColors.scrim,
  },
  rewardNoticeCard: {
    width: "100%",
    maxWidth: 420,
    alignItems: "center",
    gap: 13,
    padding: 24,
    borderRadius: 24,
    borderWidth: 1,
    borderColor: styleColors.border,
    backgroundColor: styleColors.card,
  },
  rewardNoticeIcon: {
    width: 54,
    height: 54,
    borderRadius: 27,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: styleColors.primary,
  },
  rewardNoticeTitle: {
    color: styleColors.foreground,
    fontSize: fontSizes.titleSmall,
    fontFamily: fonts.bold,
    textAlign: "center",
  },
  rewardNoticeBody: {
    color: styleColors.mutedForeground,
    fontSize: fontSizes.label,
    lineHeight: 21,
    fontFamily: fonts.regular,
    textAlign: "center",
  },
  rewardNoticeButton: {
    width: "100%",
    minHeight: 46,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 3,
    borderRadius: 15,
    backgroundColor: styleColors.primary,
  },
  rewardNoticeButtonText: {
    color: styleColors.primaryForeground,
    fontSize: fontSizes.body,
    fontFamily: fonts.bold,
  },
  notificationCard: {
    minHeight: 88,
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 18,
    borderRadius: 22,
    borderWidth: 1,
    borderColor: styleColors.border,
    backgroundColor: styleColors.card,
  },
  notificationIcon: {
    width: 50,
    height: 50,
    borderRadius: 25,
    backgroundColor: styleColors.secondary,
    alignItems: "center",
    justifyContent: "center",
  },
  notificationCopy: { flex: 1, paddingHorizontal: 14, gap: 4 },
  notificationTitle: { color: styleColors.foreground, fontSize: fontSizes.headingSmall, fontFamily: fonts.semibold },
  notificationBody: { color: styleColors.mutedForeground, fontSize: fontSizes.detail, fontFamily: fonts.regular },
  notificationTime: { color: styleColors.mutedForeground, fontSize: fontSizes.caption },
  roomCard: {
    minHeight: 96,
    marginTop: 12,
    paddingHorizontal: 15,
    flexDirection: "row",
    alignItems: "center",
    borderRadius: 23,
    borderWidth: 1,
    borderColor: styleColors.border,
    backgroundColor: styleColors.card,
  },
  roomIcon: {
    width: 58,
    height: 58,
    borderRadius: 29,
    backgroundColor: styleColors.secondary,
    alignItems: "center",
    justifyContent: "center",
  },
  roomCopy: { flex: 1, paddingHorizontal: 15, gap: 6 },
  roomName: { color: styleColors.foreground, fontSize: fontSizes.titleSmall, fontFamily: fonts.semibold },
  roomPreview: { color: styleColors.mutedForeground, fontSize: fontSizes.label, fontFamily: fonts.regular },
  roomMeta: { height: 56, justifyContent: "space-between", alignItems: "flex-end" },
  roomTime: { color: styleColors.mutedForeground, fontSize: fontSizes.caption },
  unreadBadge: {
    minWidth: 32,
    height: 32,
    borderRadius: 16,
    paddingHorizontal: 8,
    backgroundColor: styleColors.primary,
    alignItems: "center",
    justifyContent: "center",
  },
  unreadBadgeText: { color: styleColors.primaryForeground, fontSize: fontSizes.detail, fontFamily: fonts.bold },
  loading: { marginTop: 50 },
  empty: { alignItems: "center", paddingVertical: 58, gap: 10 },
  emptyTitle: { color: styleColors.mutedForeground, fontSize: fontSizes.input, fontFamily: fonts.semibold },
  emptyBody: { color: styleColors.mutedForeground, fontSize: fontSizes.detail, textAlign: "center" },
  pressed: { opacity: 0.72 },
});
