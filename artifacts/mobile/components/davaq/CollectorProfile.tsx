import React, { useState } from "react";
import {
  View,
  Text,
  Pressable,
  ScrollView,
  ActivityIndicator,
} from "react-native";
import { Stack, useRouter } from "expo-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { customFetch, getListRoomsQueryKey } from "@workspace/api-client-react";
import { useAuth } from "@/lib/davaqAuth";
import { useColors } from "@/hooks/useColors";
import { Avatar } from "@/components/Avatar";
export const collectorIds = [
  "00000000-0000-4000-8000-00000000c101",
  "00000000-0000-4000-8000-00000000c102",
  "00000000-0000-4000-8000-00000000c103",
];
export function CollectorProfileScreen({
  collectorId,
}: {
  collectorId: string;
}) {
  const c = useColors(),
    r = useRouter(),
    cache = useQueryClient();
  const { isSignedIn, userId } = useAuth();
  const [consent, setConsent] = useState(false);
  const [error, setError] = useState("");
  const q = useQuery({
    queryKey: ["collector-lounge"],
    queryFn: () =>
      customFetch<any>("/api/collector-lounge", { responseType: "json" }),
  });
  const actor = q.data?.characters?.find((a: any) => a.id === collectorId);
  const base =
    "/api/collector-lounge/characters/" + encodeURIComponent(collectorId);
  const rel = useQuery({
    queryKey: ["collector-relationship", userId, collectorId],
    queryFn: () =>
      customFetch<{ isFriend: boolean }>(base + "/relationship", {
        responseType: "json",
      }),
    enabled: !!isSignedIn,
    retry: false,
  });
  const friend = useMutation({
    mutationFn: () =>
      customFetch(base + "/friend", { method: "POST", responseType: "json" }),
    onSuccess: async () => {
      await cache.invalidateQueries({
        queryKey: ["collector-relationship", userId, collectorId],
      });
      await cache.invalidateQueries({
        predicate: (q) =>
          q.queryKey.some(
            (k) => typeof k === "string" && k.includes("friends"),
          ),
      });
    },
    onError: () =>
      setError("친구로 등록하지 못했습니다. 차단 상태나 연결을 확인해 주세요."),
  });
  const chat = useMutation({
    mutationFn: () =>
      customFetch<{ roomId: string }>(base + "/chat", {
        method: "POST",
        responseType: "json",
        body: JSON.stringify({ acknowledgeAiProcessing: consent }),
      }),
    onSuccess: async ({ roomId }) => {
      await cache.invalidateQueries({ queryKey: getListRoomsQueryKey() });
      r.push(("/chat/" + roomId) as never);
    },
    onError: () =>
      setError("대화방을 열지 못했습니다. 연결과 로그인 상태를 확인해 주세요."),
  });
  return (
    <>
      <Stack.Screen
        options={{ headerShown: true, title: actor?.name ?? "친구 프로필" }}
      />
      <ScrollView
        style={{ flex: 1, backgroundColor: c.background }}
        contentContainerStyle={{ padding: 24, gap: 20, alignItems: "center" }}
      >
        {q.isPending ? (
          <ActivityIndicator />
        ) : actor ? (
          <>
            <Avatar name={actor.name} size={100} />
            <Text
              style={{ color: c.foreground, fontSize: 28, fontWeight: "700" }}
            >
              {actor.name}
            </Text>
            <Text style={{ color: c.mutedForeground }}>
              {actor.description}
            </Text>
            <Text style={{ color: c.mutedForeground }}>
              DAVAQ의 AI 친구 · 카드 이야기와 수집 취향을 나눠요.
            </Text>
            {!isSignedIn ? (
              <Pressable onPress={() => r.push("/" as never)}>
                <Text style={{ color: c.foreground }}>
                  로그인하고 친구 맺기
                </Text>
              </Pressable>
            ) : (
              <>
                <Pressable
                  disabled={friend.isPending || rel.data?.isFriend}
                  onPress={() => friend.mutate()}
                  style={{
                    backgroundColor: c.foreground,
                    padding: 16,
                    borderRadius: 12,
                    width: "100%",
                  }}
                >
                  <Text style={{ color: c.background, textAlign: "center" }}>
                    {rel.data?.isFriend
                      ? "친구로 등록됨"
                      : friend.isPending
                        ? "등록 중…"
                        : "친구 추가"}
                  </Text>
                </Pressable>
                <Text style={{ color: c.mutedForeground, lineHeight: 22 }}>
                  1:1 대화의 최근 내용은 답변을 위해 AI 서비스에 전달됩니다.
                  다른 회원이나 공개 수다방에 공유되지 않습니다. 올린 사진과
                  설명은 AI가 함께 확인합니다. 흐리거나 일부만 보이는 카드는
                  확인을 요청할 수 있으며 영상은 자동 판독하지 않습니다. 답변은
                  하루 최대 20회이며 사용량에 따라 제한될 수 있습니다.
                </Text>
                <Pressable
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: consent }}
                  onPress={() => setConsent(!consent)}
                >
                  <Text style={{ color: c.foreground }}>
                    {consent ? "☑" : "☐"} AI 개인 대화 안내를 확인했습니다.
                  </Text>
                </Pressable>
                <Pressable
                  disabled={!consent || chat.isPending}
                  onPress={() => chat.mutate()}
                  style={{
                    padding: 16,
                    borderWidth: 1,
                    borderColor: c.mutedForeground,
                    borderRadius: 12,
                    width: "100%",
                    opacity: consent ? 1 : 0.4,
                  }}
                >
                  <Text style={{ color: c.foreground, textAlign: "center" }}>
                    {chat.isPending ? "열고 있어요…" : "1:1 대화하기"}
                  </Text>
                </Pressable>
              </>
            )}
          </>
        ) : (
          <Text style={{ color: c.foreground }}>
            프로필을 불러오지 못했습니다.
          </Text>
        )}
        {!!error && <Text style={{ color: c.foreground }}>{error}</Text>}
      </ScrollView>
    </>
  );
}
