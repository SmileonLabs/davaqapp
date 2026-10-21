import React from "react";
import { View, Text, Pressable, ActivityIndicator } from "react-native";
import { useQuery } from "@tanstack/react-query";
import { customFetch } from "@workspace/api-client-react";
import { router } from "expo-router";
import { Avatar } from "./Avatar";
import {CollectorProfileScreen,collectorIds} from "./davaq/CollectorProfile";
export function PublicCharacterProfileScreen({
  profileId,
}: {
  profileId: string;
}) {
  return collectorIds.includes(profileId) ? <CollectorProfileScreen collectorId={profileId}/> : <RegularCharacterProfileScreen profileId={profileId}/>;
}
function RegularCharacterProfileScreen({profileId}:{profileId:string}) {
  const query = useQuery({
    queryKey: ["davaq-public-profile", profileId],
    queryFn: () =>
      customFetch<{
        profile: {
          displayName: string;
          profileImageUrl: string | null;
          statusMessage: string | null;
        };
      }>(`/api/profiles/${encodeURIComponent(profileId)}`, {
        responseType: "json",
      }),
    enabled: !!profileId,
  });
  const profile = query.data?.profile;
  return (
    <View
      style={{
        flex: 1,
        backgroundColor: "#F7F3FF",
        justifyContent: "center",
        alignItems: "center",
        gap: 20,
        padding: 24,
      }}
    >
      {query.isLoading ? (
        <ActivityIndicator color="#7651D6" />
      ) : profile ? (
        <>
          <Avatar
            name={profile.displayName}
            uri={profile.profileImageUrl}
            size={140}
          />
          <Text style={{ fontSize: 26, fontWeight: "700" }}>
            {profile.displayName}
          </Text>
          <Text>{profile.statusMessage ?? ""}</Text>
        </>
      ) : (
        <Text>프로필을 불러오지 못했습니다.</Text>
      )}
      <Pressable onPress={() => router.back()}>
        <Text style={{ color: "#7651D6", padding: 16 }}>뒤로</Text>
      </Pressable>
    </View>
  );
}
