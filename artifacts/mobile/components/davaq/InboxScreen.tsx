import React, { useMemo, useState, useCallback } from "react";
import { FlatList, View, Pressable } from "react-native";
import { Stack, useRouter, useFocusEffect } from "expo-router";
import { useScreenActive as useIsFocused } from "@/hooks/useScreenActive";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  useGetMe,
  useListRooms,
  getListRoomsQueryKey,
  type ChatRoom,
} from "@workspace/api-client-react";
import { useDavaq, statusName, type Page, type Proposal } from "@/lib/davaq";
import { roomDisplayName, formatMsgTime } from "@/lib/chatScreenUtils";
import { Avatar } from "@/components/Avatar";
import { PinnedAgentConversation } from "./AgentConversation";
import { C, S, Txt, Button, Chip, Field, QueryState, Empty, Icon } from "./UI";
type Room = ChatRoom;
const filters = [
  ["all", "전체"],
  ["unread", "안 읽음"],
  ["group", "그룹"],
  ["proposal", "제안"],
  ["ongoing", "진행 중"],
  ["fanclub", "팬클럽"],
  ["counseling", "고민상담"],
  ["friend_finding", "친구찾기"],
  ["meetup", "번개·만남"],
  ["casual", "잡담"],
  ["peer", "또래방"],
  ["karaoke", "노래방"],
];
const RoomRow = React.memo(function RoomRow({
  room,
  viewerId,
  proposal,
}: {
  room: Room;
  viewerId?: string;
  proposal?: Proposal;
}) {
  const router = useRouter(),
    other = room.members?.find((m) => m.id !== viewerId),
    name = roomDisplayName(room, viewerId);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={name + " 대화 열기"}
      onPress={() => router.push(("/chat/" + room.id) as never)}
      style={[S.card, S.row, { marginBottom: 10 }]}
    >
      {room.type === "group" ? (
        <Icon name="users" size={34} />
      ) : (
        <Avatar uri={other?.profileImageUrl} name={name} size={48} />
      )}
      <View style={{ flex: 1, gap: 4 }}>
        <View style={S.between}>
          <Txt bold lines={1} style={{ flex: 1 }}>
            {name}
          </Txt>
          {!!room.lastMessageAt && (
            <Txt size={11} color={C.muted}>
              {formatMsgTime(room.lastMessageAt)}
            </Txt>
          )}
          {!!room.unreadCount && (
            <Txt color={C.purple} bold>
              {room.unreadCount > 99 ? "99+" : room.unreadCount}
            </Txt>
          )}
        </View>
        <Txt size={13} color={C.muted} lines={1}>
          {room.lastMessage || "첫 인사를 나눠보세요."}
        </Txt>
        {proposal && (
          <Txt size={11} color={C.purple}>
            {statusName(proposal.status)}
          </Txt>
        )}
      </View>
    </Pressable>
  );
});
export function InboxScreen() {
  const router = useRouter(),
    focused = useIsFocused(),
    insets = useSafeAreaInsets(),
    me = useGetMe(),
    rooms = useListRooms({
      query: {
        queryKey: getListRoomsQueryKey(),
        enabled: focused,
        staleTime: 15000,
        refetchInterval: focused ? 30000 : false,
        refetchIntervalInBackground: false,
      },
    }),
    proposals = useDavaq<Page<Proposal>>("/exchange/proposals", focused),
    [filter, setFilter] = useState("all"),
    [text, setText] = useState("");
  const proposalByRoom = useMemo(
    () => new Map((proposals.data?.items ?? []).map((p) => [p.room_id, p])),
    [proposals.data],
  );
  const rows = useMemo(() => {
    const query = text.trim().toLocaleLowerCase("ko-KR");
    return (rooms.data ?? []).filter((r) => {
      const p = proposalByRoom.get(r.id);
      return (
        (filter === "all" ||
          (filter === "unread" && (r.unreadCount ?? 0) > 0) ||
          (filter === "group" && r.type === "group") ||
          (filter === "proposal" && p?.status === "negotiating") ||
          (filter === "ongoing" &&
            p &&
            ["reserved", "in_progress"].includes(p.status)) ||
          (r as Room & { category?: string }).category === filter) &&
        (!query ||
          [roomDisplayName(r, me.data?.id), r.lastMessage]
            .join(" ")
            .toLocaleLowerCase("ko-KR")
            .includes(query))
      );
    });
  }, [rooms.data, proposalByRoom, filter, text, me.data?.id]);
  const refresh = useCallback(() => {
    void rooms.refetch();
    void proposals.refetch();
  }, [rooms.refetch, proposals.refetch]);
  useFocusEffect(
    useCallback(() => {
      void rooms.refetch();
    }, [rooms.refetch]),
  );
  const renderItem = useCallback(
    ({ item }: { item: Room }) => (
      <RoomRow
        room={item}
        viewerId={me.data?.id}
        proposal={proposalByRoom.get(item.id)}
      />
    ),
    [me.data?.id, proposalByRoom],
  );
  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      <Stack.Screen options={{ headerShown: false }} />
      <FlatList
        data={rows}
        keyExtractor={(r) => r.id}
        renderItem={renderItem}
        initialNumToRender={12}
        maxToRenderPerBatch={8}
        windowSize={5}
        keyboardShouldPersistTaps="handled"
        refreshing={rooms.isRefetching}
        onRefresh={refresh}
        contentContainerStyle={{
          width: "100%",
          maxWidth: 740,
          alignSelf: "center",
          paddingHorizontal: 20,
          paddingTop: insets.top + 18,
          paddingBottom: 110 + insets.bottom,
        }}
        ListHeaderComponent={
          <View style={{ gap: 16, marginBottom: 16 }}>
            <View style={S.between}>
              <View>
                <Txt bold size={26}>
                  채팅
                </Txt>
                <Txt size={13} color={C.muted}>
                  친구와 대화하고 새로운 교환을 만나요
                </Txt>
              </View>
              <Pressable
                accessibilityLabel="알림 설정"
                onPress={() => router.push("/settings/notifications")}
              >
                <Icon name="bell" />
              </Pressable>
            </View>
            <View style={S.wrap}>
              <Button
                small
                secondary
                label="친구 추가·초대"
                icon="user-plus"
                onPress={() => router.push("/friends/add")}
              />
              <Button
                small
                secondary
                label="친구"
                icon="users"
                onPress={() => router.push("/friends")}
              />
              <Button
                small
                secondary
                label="친구 요청"
                icon="user-check"
                onPress={() => router.push("/friends/requests")}
              />
              <Button
                small
                label="그룹 만들기"
                icon="message-circle"
                onPress={() => router.push("/group/create")}
              />
            </View>
            <PinnedAgentConversation />
            <Field
              label="대화 검색"
              placeholder="이름이나 최근 메시지"
              value={text}
              onChangeText={setText}
            />
            <View style={S.wrap}>
              {filters.map(([v, label]) => (
                <Chip
                  key={v}
                  label={label}
                  active={filter === v}
                  onPress={() => setFilter(v)}
                />
              ))}
            </View>
            <QueryState query={rooms} />
          </View>
        }
        ListEmptyComponent={
          rooms.isSuccess ? (
            <Empty
              title="대화를 시작해 보세요"
              body="친구를 초대하거나 교환 제안으로 대화를 시작할 수 있어요."
              action="친구 추가·초대"
              onPress={() => router.push("/friends/add")}
              icon="message-circle"
            />
          ) : null
        }
      />
    </View>
  );
}
