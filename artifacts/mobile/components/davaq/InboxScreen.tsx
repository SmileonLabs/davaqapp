import React, {
  useMemo,
  useState,
  useCallback,
  useDeferredValue,
  useEffect,
  useRef,
} from "react";
import {
  FlatList,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from "react-native";
import { Stack, useRouter, useFocusEffect } from "expo-router";
import { Feather } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  useGetMe,
  useListRooms,
  getListRoomsQueryKey,
  type ChatRoom,
} from "@workspace/api-client-react";
import { useScreenActive } from "@/hooks/useScreenActive";
import { useColors } from "@/hooks/useColors";
import { usePwaBottomInset } from "@/hooks/usePwaBottomInset";
import { useDavaq, statusName, type Page, type Proposal } from "@/lib/davaq";
import { roomDisplayName, isSameDay } from "@/lib/chatScreenUtils";
import { Avatar } from "@/components/Avatar";
import ChatScreen from "@/app/chat/[id]";
import {
  MessengerAction,
  MessengerIconButton,
  MessengerSheet,
} from "@/components/chat/MessengerUI";
import {
  AgentConversation,
  PinnedAgentConversation,
} from "./AgentConversation";

const mainFilters = [
  ["all", "전체"],
  ["unread", "안 읽음"],
  ["group", "그룹"],
  ["proposal", "제안"],
  ["ongoing", "진행 중"],
];
const categories = [
  ["fanclub", "팬클럽"],
  ["counseling", "고민상담"],
  ["friend_finding", "친구찾기"],
  ["meetup", "번개·만남"],
  ["casual", "잡담"],
  ["peer", "또래방"],
  ["karaoke", "노래방"],
];
function timeLabel(value: string) {
  const d = new Date(value);
  return isSameDay(value, new Date().toISOString())
    ? d.toLocaleTimeString("ko-KR", {
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
      })
    : d.toLocaleDateString("ko-KR", { month: "numeric", day: "numeric" });
}
const RoomRow = React.memo(function RoomRow({
  room,
  viewerId,
  proposal,
  selected,
  onOpen,
}: {
  room: ChatRoom;
  viewerId?: string;
  proposal?: Proposal;
  selected: boolean;
  onOpen: (id: string) => void;
}) {
  const c = useColors(),
    name = roomDisplayName(room, viewerId),
    other = room.members?.find((m) => m.id !== viewerId),
    unread = room.unreadCount ?? 0;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={name + " 대화 열기"}
      accessibilityState={{ selected }}
      onPress={() => onOpen(room.id)}
      style={({ pressed, ...state }) => [
        s.room,
        {
          backgroundColor: selected
            ? c.accent
            : pressed || (state as any).hovered
              ? c.muted
              : c.card,
        },
      ]}
    >
      {room.type === "group" ? (
        <View style={[s.groupAvatar, { backgroundColor: c.accent }]}>
          <Feather name="users" size={23} color={c.primary} />
        </View>
      ) : (
        <Avatar uri={other?.profileImageUrl} name={name} size={50} />
      )}
      <View style={[s.roomText, { borderBottomColor: c.border }]}>
        <View style={s.between}>
          <Text
            numberOfLines={1}
            style={[
              s.roomName,
              { color: c.foreground, fontWeight: unread ? "700" : "600" },
            ]}
          >
            {name}
          </Text>
          {!!room.lastMessageAt && (
            <Text
              style={[
                s.time,
                { color: unread ? c.primary : c.mutedForeground },
              ]}
            >
              {timeLabel(room.lastMessageAt)}
            </Text>
          )}
        </View>
        <View style={s.between}>
          <Text
            numberOfLines={1}
            style={[
              s.preview,
              { color: unread ? c.foreground : c.mutedForeground },
            ]}
          >
            {room.lastMessage || "첫 인사를 나눠보세요"}
          </Text>
          {unread > 0 && (
            <View style={[s.badge, { backgroundColor: c.primary }]}>
              <Text style={s.badgeText}>{unread > 99 ? "99+" : unread}</Text>
            </View>
          )}
        </View>
        {proposal && (
          <Text style={{ fontSize: 11, color: c.primary, marginTop: 3 }}>
            {statusName(proposal.status)}
          </Text>
        )}
      </View>
    </Pressable>
  );
});
export function InboxScreen() {
  const c = useColors(),
    router = useRouter(),
    focused = useScreenActive(),
    insets = useSafeAreaInsets(),
    pwa = usePwaBottomInset(),
    { width } = useWindowDimensions(),
    wide = Platform.OS === "web" && width >= 960;
  const me = useGetMe(),
    rooms = useListRooms({
      query: {
        queryKey: getListRoomsQueryKey(),
        enabled: focused,
        staleTime: 15000,
        refetchInterval: focused ? 30000 : false,
        refetchIntervalInBackground: false,
      },
    }),
    proposals = useDavaq<Page<Proposal>>("/exchange/proposals", focused);
  const [filter, setFilter] = useState("all"),
    [text, setText] = useState(""),
    [menu, setMenu] = useState(false),
    [categoryMenu, setCategoryMenu] = useState(false),
    [selected, setSelected] = useState<string | null>("q");
  useEffect(() => {
    setSelected("q");
    setText("");
    setFilter("all");
  }, [me.data?.id]);
  const searchRef = useRef<TextInput>(null),
    search = useDeferredValue(text.trim().toLocaleLowerCase("ko-KR"));
  const proposalByRoom = useMemo(
    () => new Map((proposals.data?.items ?? []).map((p) => [p.room_id, p])),
    [proposals.data],
  );
  const rows = useMemo(
    () =>
      (rooms.data ?? []).filter((r) => {
        const p = proposalByRoom.get(r.id);
        return (
          (filter === "all" ||
            (filter === "unread" && (r.unreadCount ?? 0) > 0) ||
            (filter === "group" && r.type === "group") ||
            (filter === "proposal" && p?.status === "negotiating") ||
            (filter === "ongoing" &&
              p &&
              ["reserved", "in_progress"].includes(p.status)) ||
            (r as ChatRoom & { category?: string }).category === filter) &&
          (!search ||
            [roomDisplayName(r, me.data?.id), r.lastMessage]
              .join(" ")
              .toLocaleLowerCase("ko-KR")
              .includes(search))
        );
      }),
    [rooms.data, proposalByRoom, filter, search, me.data?.id],
  );
  const unreadRooms = useMemo(
    () => (rooms.data ?? []).filter((r) => (r.unreadCount ?? 0) > 0).length,
    [rooms.data],
  );
  const refresh = useCallback(() => {
    void rooms.refetch();
    void proposals.refetch();
  }, [rooms.refetch, proposals.refetch]);
  useFocusEffect(
    useCallback(() => {
      void rooms.refetch();
    }, [rooms.refetch]),
  );
  useEffect(() => {
    if (!focused || Platform.OS !== "web") return;
    const key = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        searchRef.current?.focus();
      }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [focused]);
  const open = useCallback(
    (id: string) => {
      if (wide) setSelected(id);
      else router.push((id === "q" ? "/agent/chat" : "/chat/" + id) as never);
    },
    [router, wide],
  );
  const renderItem = useCallback(
    ({ item }: { item: ChatRoom }) => (
      <RoomRow
        room={item}
        viewerId={me.data?.id}
        proposal={proposalByRoom.get(item.id)}
        selected={wide && selected === item.id}
        onOpen={open}
      />
    ),
    [me.data?.id, proposalByRoom, wide, selected, open],
  );
  const navigate = (path: string) => {
    setMenu(false);
    router.push(path as never);
  };
  const bottom = 72 + (Platform.OS === "web" ? pwa : insets.bottom);
  return (
    <View style={[s.root, { backgroundColor: c.card, paddingBottom: bottom }]}>
      <Stack.Screen options={{ headerShown: false }} />
      <View
        testID="messenger-sidebar"
        style={[
          s.sidebar,
          {
            width: wide ? 350 : "100%",
            borderRightWidth: wide ? StyleSheet.hairlineWidth : 0,
            borderRightColor: c.border,
          },
        ]}
      >
        <View style={[s.header, { paddingTop: insets.top + 10 }]}>
          <View style={{ flex: 1 }}>
            <Text style={[s.title, { color: c.foreground }]}>채팅</Text>
            <Text style={[s.subtitle, { color: c.mutedForeground }]}>
              {unreadRooms
                ? `새로운 대화 ${unreadRooms}개`
                : "대화에서 시작되는 새로운 교환"}
            </Text>
          </View>
          <MessengerIconButton
            icon="users"
            label="친구 목록"
            onPress={() => router.push("/friends")}
          />
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="새 대화"
            onPress={() => setMenu(true)}
            style={({ pressed }) => [
              s.compose,
              { backgroundColor: c.primary, opacity: pressed ? 0.8 : 1 },
            ]}
          >
            <Feather name="edit-2" size={19} color="white" />
          </Pressable>
        </View>
        <View style={[s.search, { backgroundColor: c.input }]}>
          <Feather name="search" size={18} color={c.mutedForeground} />
          <TextInput
            ref={searchRef}
            accessibilityLabel="대화 검색"
            placeholder="이름, 최근 메시지 검색"
            placeholderTextColor={c.mutedForeground}
            value={text}
            onChangeText={setText}
            style={[s.searchInput, { color: c.foreground }]}
            returnKeyType="search"
            autoCorrect={false}
          />
          {text ? (
            <MessengerIconButton
              icon="x"
              label="검색 지우기"
              onPress={() => setText("")}
            />
          ) : wide ? (
            <Text style={[s.shortcut, { color: c.mutedForeground }]}>⌘ K</Text>
          ) : null}
        </View>
        <View style={[s.filterLine, { borderBottomColor: c.border }]}>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={{ paddingHorizontal: 12, gap: 4 }}
            style={{ flex: 1 }}
          >
            {mainFilters.map(([id, label]) => (
              <Pressable
                key={id}
                accessibilityRole="tab"
                accessibilityState={{ selected: filter === id }}
                onPress={() => setFilter(id)}
                style={s.filter}
              >
                <Text
                  style={{
                    color: filter === id ? c.primary : c.mutedForeground,
                    fontWeight: "600",
                    fontSize: 13,
                  }}
                >
                  {label}
                  {id === "unread" && unreadRooms ? ` ${unreadRooms}` : ""}
                </Text>
                <View
                  style={{
                    height: 3,
                    borderRadius: 3,
                    backgroundColor: filter === id ? c.primary : "transparent",
                    marginTop: 10,
                  }}
                />
              </Pressable>
            ))}
          </ScrollView>
          <MessengerIconButton
            icon="sliders"
            label="대화 분류"
            active={categories.some(([id]) => id === filter)}
            onPress={() => setCategoryMenu(true)}
          />
        </View>
        {categories.some(([id]) => id === filter) && (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="분류 해제"
            onPress={() => setFilter("all")}
            style={[s.category, { backgroundColor: c.accent }]}
          >
            <Text style={{ color: c.primary, fontSize: 12 }}>
              {categories.find(([id]) => id === filter)?.[1]}
            </Text>
            <Feather name="x" size={14} color={c.primary} />
          </Pressable>
        )}
        <FlatList
          showsVerticalScrollIndicator={false}
          testID="conversation-list"
          data={rows}
          keyExtractor={(r) => r.id}
          renderItem={renderItem}
          initialNumToRender={14}
          maxToRenderPerBatch={8}
          windowSize={5}
          keyboardShouldPersistTaps="handled"
          refreshing={rooms.isRefetching}
          onRefresh={refresh}
          contentContainerStyle={{ paddingBottom: 20 }}
          ListHeaderComponent={
            filter === "all" && !search ? (
              <PinnedAgentConversation
                compact
                selected={wide && selected === "q"}
                onPress={() => open("q")}
              />
            ) : null
          }
          ListEmptyComponent={
            rooms.isPending ? (
              <View style={{ padding: 16, gap: 20 }}>
                {[0, 1, 2, 3].map((i) => (
                  <View
                    key={i}
                    style={{
                      flexDirection: "row",
                      gap: 12,
                      alignItems: "center",
                    }}
                  >
                    <View
                      style={{
                        width: 50,
                        height: 50,
                        borderRadius: 25,
                        backgroundColor: c.muted,
                      }}
                    />
                    <View style={{ gap: 10, flex: 1 }}>
                      <View
                        style={{
                          height: 12,
                          width: "50%",
                          borderRadius: 5,
                          backgroundColor: c.muted,
                        }}
                      />
                      <View
                        style={{
                          height: 10,
                          width: "80%",
                          borderRadius: 5,
                          backgroundColor: c.muted,
                        }}
                      />
                    </View>
                  </View>
                ))}
              </View>
            ) : (
              <View style={s.empty}>
                <View style={[s.emptyIcon, { backgroundColor: c.accent }]}>
                  <Feather
                    name={
                      rooms.isError
                        ? "wifi-off"
                        : search
                          ? "search"
                          : "message-circle"
                    }
                    size={26}
                    color={c.primary}
                  />
                </View>
                <Text style={[s.emptyTitle, { color: c.foreground }]}>
                  {rooms.isError
                    ? "대화를 불러오지 못했어요"
                    : search
                      ? "검색 결과가 없어요"
                      : filter !== "all"
                        ? "이 분류의 대화가 없어요"
                        : "첫 대화를 시작해 보세요"}
                </Text>
                <Text style={[s.emptyText, { color: c.mutedForeground }]}>
                  {search
                    ? "다른 이름이나 최근 메시지로 찾아보세요."
                    : filter === "all"
                      ? "친구를 초대하거나 큐에게 교환을 이야기해 보세요."
                      : "다른 분류에서 대화를 확인할 수 있어요."}
                </Text>
                <Pressable
                  accessibilityRole="button"
                  onPress={
                    rooms.isError
                      ? refresh
                      : () =>
                          search || filter !== "all"
                            ? (setText(""), setFilter("all"))
                            : setMenu(true)
                  }
                  style={[s.emptyAction, { backgroundColor: c.accent }]}
                >
                  <Text
                    style={{
                      color: c.primary,
                      fontWeight: "600",
                      fontSize: 13,
                    }}
                  >
                    {rooms.isError
                      ? "다시 불러오기"
                      : search || filter !== "all"
                        ? "전체 대화 보기"
                        : "새 대화 시작"}
                  </Text>
                </Pressable>
              </View>
            )
          }
        />
      </View>
      {wide && (
        <View
          testID="messenger-detail"
          style={[s.detail, { backgroundColor: c.background }]}
        >
          {selected === "q" ? (
            <AgentConversation embedded onBack={() => setSelected(null)} />
          ) : selected ? (
            <ChatScreen
              key={selected}
              roomId={selected}
              embedded
              onBack={() => setSelected(null)}
            />
          ) : (
            <View style={[s.empty, { flex: 1, justifyContent: "center" }]}>
              <Feather name="message-circle" size={44} color={c.primary} />
              <Text style={[s.emptyTitle, { color: c.foreground }]}>
                대화를 선택해 주세요
              </Text>
              <Text style={[s.emptyText, { color: c.mutedForeground }]}>
                친구와 이야기를 나누거나 큐와 새로운 교환을 찾아보세요.
              </Text>
            </View>
          )}
        </View>
      )}
      <MessengerSheet
        visible={menu}
        title="새 대화"
        onClose={() => setMenu(false)}
      >
        <MessengerAction
          icon="cpu"
          title="나의 큐"
          subtitle="교환 추천과 브랜드 혜택 이야기하기"
          onPress={() => {
            setMenu(false);
            open("q");
          }}
        />
        <MessengerAction
          icon="user-plus"
          title="친구 추가·초대"
          subtitle="이메일로 찾거나 초대 링크 공유하기"
          onPress={() => navigate("/friends/add")}
        />
        <MessengerAction
          icon="users"
          title="친구"
          subtitle="친구와 1:1 대화 시작하기"
          onPress={() => navigate("/friends")}
        />
        <MessengerAction
          icon="user-check"
          title="친구 요청"
          onPress={() => navigate("/friends/requests")}
        />
        <MessengerAction
          icon="message-square"
          title="그룹 만들기"
          subtitle="친구들과 함께 대화하기"
          onPress={() => navigate("/group/create")}
        />
        <MessengerAction
          icon="bell"
          title="알림 설정"
          onPress={() => navigate("/settings/notifications")}
        />
      </MessengerSheet>
      <MessengerSheet
        visible={categoryMenu}
        title="대화 분류"
        onClose={() => setCategoryMenu(false)}
      >
        {categories.map(([id, label]) => (
          <MessengerAction
            key={id}
            icon={filter === id ? "check-circle" : "hash"}
            title={label}
            onPress={() => {
              setFilter(id);
              setCategoryMenu(false);
            }}
          />
        ))}
      </MessengerSheet>
    </View>
  );
}
const s = StyleSheet.create({
  root: { flex: 1, flexDirection: "row", minHeight: 0 },
  sidebar: { minHeight: 0 },
  detail: { flex: 1, minWidth: 0, overflow: "hidden" },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 20,
    paddingBottom: 14,
  },
  title: { fontSize: 25, fontWeight: "700", letterSpacing: -0.8 },
  subtitle: { fontSize: 12, marginTop: 4 },
  compose: {
    width: 38,
    height: 38,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    marginLeft: 3,
  },
  search: {
    height: 42,
    marginHorizontal: 16,
    borderRadius: 13,
    flexDirection: "row",
    alignItems: "center",
    paddingLeft: 12,
    marginBottom: 8,
    gap: 9,
  },
  searchInput: {
    flex: 1,
    minWidth: 0,
    height: 42,
    fontSize: 14,
    ...(Platform.OS === "web" ? { outlineStyle: "none" as any } : {}),
  },
  shortcut: { fontSize: 11, marginRight: 12 },
  filterLine: {
    flexDirection: "row",
    alignItems: "center",
    borderBottomWidth: StyleSheet.hairlineWidth,
    paddingRight: 6,
  },
  filter: { paddingHorizontal: 10, paddingTop: 12 },
  room: {
    flexDirection: "row",
    alignItems: "center",
    paddingLeft: 16,
    gap: 12,
    minHeight: 80,
  },
  roomText: {
    flex: 1,
    minWidth: 0,
    borderBottomWidth: StyleSheet.hairlineWidth,
    paddingVertical: 18,
    paddingRight: 16,
    gap: 6,
    minHeight: 80,
  },
  groupAvatar: {
    width: 50,
    height: 50,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
  },
  between: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    justifyContent: "space-between",
  },
  roomName: { fontSize: 15, flex: 1, minWidth: 0 },
  time: { fontSize: 11 },
  preview: { fontSize: 13, lineHeight: 18, flex: 1, minWidth: 0 },
  badge: {
    minWidth: 20,
    height: 20,
    paddingHorizontal: 6,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  badgeText: { fontSize: 11, fontWeight: "700", color: "white" },
  category: {
    alignSelf: "flex-start",
    flexDirection: "row",
    gap: 8,
    margin: 10,
    padding: 8,
    borderRadius: 10,
  },
  empty: {
    alignItems: "center",
    paddingHorizontal: 32,
    paddingVertical: 38,
    gap: 12,
  },
  emptyIcon: {
    width: 62,
    height: 62,
    borderRadius: 24,
    alignItems: "center",
    justifyContent: "center",
  },
  emptyTitle: { fontSize: 16, fontWeight: "600", textAlign: "center" },
  emptyText: {
    fontSize: 13,
    lineHeight: 21,
    textAlign: "center",
    maxWidth: 300,
  },
  emptyAction: {
    paddingHorizontal: 18,
    paddingVertical: 11,
    borderRadius: 20,
    marginTop: 5,
  },
});
