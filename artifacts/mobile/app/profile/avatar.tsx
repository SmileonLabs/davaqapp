import { useCharacterProfiles } from "@/hooks/useCharacterProfiles";
import React, { useState } from "react";
import { View, Text, Pressable, Alert } from "react-native";
import { router } from "expo-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { customFetch } from "@workspace/api-client-react";
import { Avatar } from "@/components/Avatar";
import { pickAndUploadImage } from "@/lib/uploadImage";
type State = {
  activeProfile: {
    id: string;
    displayName: string;
    profileImageUrl: string | null;
  };
};
export default function DavaQAvatarSettings() {
  const client = useQueryClient();
  const [busy, setBusy] = useState(false);
  const profileState = useCharacterProfiles();
  const query = { data: profileState.state };
  const save = async (photo: boolean) => {
    if (!query.data || busy) return;
    setBusy(true);
    try {
      const image = photo ? await pickAndUploadImage() : null;
      if (photo && !image) return;
      await customFetch(
        `/api/users/me/profiles/${query.data.activeProfile.id}`,
        {
          method: "PATCH",
          body: JSON.stringify({ profileImageUrl: image?.objectPath ?? null }),
          responseType: "json",
        },
      );
      await client.invalidateQueries();
      router.back();
    } catch {
      Alert.alert("프로필 저장 실패", "연결을 확인한 후 다시 시도해 주세요.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <View
      style={{
        flex: 1,
        backgroundColor: "#F7F3FF",
        alignItems: "center",
        justifyContent: "center",
        padding: 24,
        gap: 20,
      }}
    >
      <Avatar
        name={query.data?.activeProfile.displayName ?? "큐"}
        uri={query.data?.activeProfile.profileImageUrl}
        size={140}
      />
      <Text style={{ fontSize: 24, fontWeight: "700", color: "#5730A6" }}>
        DavaQ 프로필
      </Text>
      <Pressable
        disabled={busy || !query.data}
        onPress={() => {
          void save(true);
        }}
        style={{ backgroundColor: "#7651D6", padding: 16, borderRadius: 16 }}
      >
        <Text style={{ color: "white" }}>
          {busy ? "저장 중…" : "사진 선택"}
        </Text>
      </Pressable>
      <Pressable
        disabled={busy || !query.data}
        onPress={() => {
          void save(false);
        }}
      >
        <Text style={{ color: "#5730A6" }}>기본 큐 캐릭터 사용</Text>
      </Pressable>
      <Pressable onPress={() => router.back()}>
        <Text>뒤로</Text>
      </Pressable>
    </View>
  );
}
