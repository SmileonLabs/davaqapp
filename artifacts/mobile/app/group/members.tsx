import React from "react";
import { ActivityIndicator, FlatList, Pressable, Text, View } from "react-native";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { getGetRoomQueryKey, useGetRoom } from "@workspace/api-client-react";
import { Avatar } from "@/components/Avatar";
import { useColors } from "@/hooks/useColors";
import { userDisplayName } from "@/lib/friendNames";

export default function GroupMembersScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const colors = useColors();
  const room = useGetRoom(id, { query: { queryKey: getGetRoomQueryKey(id), enabled: !!id } });
  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <Stack.Screen options={{ headerShown: true, title: `참여자 ${room.data?.members?.length ?? ""}` }} />
      {room.data === undefined ? (
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
          {room.isError ? <Pressable onPress={() => void room.refetch()} accessibilityRole="button"><Text style={{ color: colors.primary }}>참여자를 불러오지 못했습니다. 다시 시도</Text></Pressable> : <ActivityIndicator color={colors.primary} />}
        </View>
      ) : (
        <FlatList
          data={room.data.members ?? []}
          keyExtractor={(member) => member.id}
          contentContainerStyle={{ padding: 16 }}
          renderItem={({ item }) => (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={userDisplayName(item, "참여자") + " 프로필 보기"}
              onPress={() => router.push({ pathname: "/profile/[userId]", params: { userId: item.id } })}
              style={({ pressed }) => ({ flexDirection: "row", alignItems: "center", gap: 14, padding: 14, borderRadius: 16, backgroundColor: pressed ? colors.muted : colors.card, marginBottom: 8 })}
            >
              <Avatar uri={item.profileImageUrl} name={userDisplayName(item, "참여자")} size={48} />
              <Text style={{ flex: 1, color: colors.foreground, fontSize: 16 }}>{userDisplayName(item, "참여자")}</Text>
            </Pressable>
          )}
        />
      )}
    </View>
  );
}
