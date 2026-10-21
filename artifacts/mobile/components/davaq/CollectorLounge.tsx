import {CollectorReading} from './CollectorReading';
import {saveCollectorLoungeEntry,clearCollectorLoungeEntry} from '@/lib/collectorLoungeEntry';
import React, { useState, useEffect } from "react";
import {
  View,
  Text,
  Pressable,
  ScrollView,
  TextInput,
  Share,
  ActivityIndicator,
} from "react-native";
import { useRouter, Stack } from "expo-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { customFetch, getListRoomsQueryKey } from "@workspace/api-client-react";
import { useAuth } from "@/lib/davaqAuth";
import { useColors } from "@/hooks/useColors";
const infoKey = ["collector-lounge"];
function useLounge() {
  return useQuery({
    queryKey: infoKey,
    queryFn: () =>
      customFetch<any>("/api/collector-lounge", { responseType: "json" }),
    retry: false,
    staleTime: 30000,
  });
}
export function CollectorLoungeShortcut({joined=false,unreadCount=0,onOpen}:{joined?:boolean;unreadCount?:number;onOpen?:()=>void}) {
  const q = useLounge();
  const router = useRouter();
  const c = useColors();
  if (q.data?.available === false) return null;
  return (
    <Pressable
      accessibilityRole="button"
      onPress={() => joined && onOpen ? onOpen() : router.push("/collector-lounge" as never)}
      style={{
        margin: 12,
        padding: 18,
        borderRadius: 16,
        backgroundColor: c.muted,
        gap: 6,
      }}
    >
      <Text style={{ color: c.foreground, fontWeight: "700", fontSize: 16 }}>
        수집AI수다방 {unreadCount>0?` · ${unreadCount}`:""} ↗
      </Text>
      <Text style={{ color: c.mutedForeground, fontSize: 13 }}>
        공식 소식과 카드 잡학, 읽고 함께 이야기해요.
      </Text>
    </Pressable>
  );
}
export default function CollectorLoungeScreen() {
  const c = useColors();
  const router = useRouter();
  const auth = useAuth();
  const q = useLounge();
  const cache = useQueryClient();
  const [consent, setConsent] = useState(false);
  const [error, setError] = useState("");
  useEffect(()=>{if(auth.isSignedIn)void clearCollectorLoungeEntry();},[auth.isSignedIn]);
  const join = useMutation({
    mutationFn: () =>
      customFetch<{ roomId: string }>("/api/collector-lounge/join", {
        method: "POST",
        responseType: "json",
        body: JSON.stringify({ acknowledgePublicAi: true }),
      }),
    onSuccess: async (r) => {
      await cache.invalidateQueries({ queryKey: getListRoomsQueryKey() });
      router.push(("/chat/" + r.roomId) as never);
    },
    onError: () =>
      setError(
        "입장하지 못했습니다. 로그인 상태와 방 정원을 확인하고 다시 시도해주세요.",
      ),
  });
  return (
    <>
      <Stack.Screen
        options={{ headerShown: true, title: "수집AI수다방" }}
      />
      <ScrollView
        style={{ flex: 1, backgroundColor: c.background }}
        contentContainerStyle={{
          padding: 22,
          gap: 18,
          maxWidth: 680,
          width: "100%",
          alignSelf: "center",
        }}
      >
        <Text style={{ color: c.foreground, fontSize: 28, fontWeight: "700" }}>
          카드 이야기, 같이 해요.
        </Text>
        <Text style={{ color: c.mutedForeground, lineHeight: 23 }}>
          개성 있는 AI 친구들이 이야기를 나누는 공식 그룹방입니다. 읽기만
          해도 좋고, 내 카드나 질문으로 끼어들어도 좋아요.
        </Text>
        {q.isPending ? (
          <ActivityIndicator />
        ) : q.isError ? (
          <Text style={{ color: c.foreground }}>
            라운지 정보를 불러오지 못했습니다.
          </Text>
        ) : !q.data?.available ? (
          <Text style={{ color: c.foreground }}>
            라운지를 준비하고 있습니다.
          </Text>
        ) : (
          <>
            <CollectorReading roomId={q.data.room_id} />
            {q.data.characters.map((a: any) => (
              <Pressable onPress={()=>router.push(("/collector/"+a.id) as never)} accessibilityRole="button" accessibilityLabel={a.name+" 프로필 보기"}
                key={a.key}
                style={{
                  backgroundColor: c.muted,
                  padding: 18,
                  borderRadius: 14,
                  gap: 7,
                }}
              >
                <Text style={{ color: c.foreground, fontWeight: "700" }}>
                  {a.name}
                </Text>
                <Text style={{ color: c.mutedForeground, lineHeight: 21 }}>
                  {a.description}
                </Text>
              </Pressable>
            ))}
            {q.data.preview?.length > 0 && (
              <View style={{ gap: 12 }}>
                <Text style={{ color: c.foreground, fontWeight: "700" }}>
                  지금 나누는 이야기
                </Text>
                {q.data.preview.map((m: any) => (
                  <View
                    key={m.id}
                    style={{
                      backgroundColor: c.muted,
                      padding: 14,
                      borderRadius: 12,
                      gap: 6,
                    }}
                  >
                    <Text style={{ color: c.foreground, fontWeight: "600" }}>
                      {m.nickname} · AI
                    </Text>
                    <Text style={{ color: c.foreground, lineHeight: 22 }}>
                      {m.content}
                    </Text>
                  </View>
                ))}
              </View>
            )}
            <Text style={{ color: c.foreground }}>
              오늘의 이야기 · {q.data.topic}
            </Text>
            {q.data.paused && (
              <Text style={{ color: c.mutedForeground }}>
                지금은 AI가 쉬고 있어요. 회원끼리 대화할 수 있습니다.
              </Text>
            )}
            <Text style={{ color: c.mutedForeground, lineHeight: 21 }}>
              {q.data.notice} AI는 실물 보유자가 아니며, 진위·등급·수익을
              보증하지 않습니다. 기본 알림은 꺼져 있습니다.
            </Text>
            <Pressable
              accessibilityRole="checkbox"
              accessibilityState={{ checked: consent }}
              onPress={() => setConsent(!consent)}
            >
              <Text style={{ color: c.foreground }}>
                {consent ? "☑" : "☐"} 공개 대화와 AI 처리 안내를 확인했습니다.
              </Text>
            </Pressable>
            <Pressable
              disabled={!consent || join.isPending}
              onPress={() =>
                auth.isSignedIn ? join.mutate() : void saveCollectorLoungeEntry().then(()=>router.push("/(auth)/sign-in"))
              }
              style={{
                padding: 17,
                borderRadius: 12,
                backgroundColor: c.foreground,
                opacity: consent ? 1 : 0.4,
              }}
            >
              <Text
                style={{
                  color: c.background,
                  textAlign: "center",
                  fontWeight: "700",
                }}
              >
                {join.isPending
                  ? "입장 중…"
                  : auth.isSignedIn
                    ? "그룹방 입장"
                    : "로그인하고 참여"}
              </Text>
            </Pressable>
            <Pressable
              onPress={() =>
                void Share.share({
                  message:
                    "DAVAQ 수집AI수다방 https://davaq.app/app/collector-lounge",
                })
              }
            >
              <Text style={{ color: c.foreground, textAlign: "center" }}>
                초대 링크 공유
              </Text>
            </Pressable>
          </>
        )}
        {!!error && <Text style={{ color: c.foreground }}>{error}</Text>}
        <CollectorLoungeAdmin />
      </ScrollView>
    </>
  );
}
function CollectorLoungeAdmin() {
  const c = useColors();
  const { isSignedIn } = useAuth();
  const q = useQuery({
    queryKey: ["collector-lounge-admin"],
    queryFn: () =>
      customFetch<any>("/api/admin/collector-lounge", { responseType: "json" }),
    enabled: !!isSignedIn,
    retry: false,
  });
  const [topic, setTopic] = useState("");
  const [card, setCard] = useState("");
  const [note, setNote] = useState("");
  const [messageLabel, setMessageLabel] = useState<string | null>(null);
  const cache = useQueryClient();
  const refresh = async () => {
    await cache.invalidateQueries({ queryKey: ["collector-lounge-admin"] });
    await cache.invalidateQueries({ queryKey: infoKey });
  };
  const action = useMutation({
    mutationFn: async (paused: boolean) => {
      if (!q.data?.lounge)
        return customFetch("/api/admin/collector-lounge/provision", {
          method: "POST",
          responseType: "json",
        });
      return customFetch("/api/admin/collector-lounge", {
        method: "PATCH",
        responseType: "json",
        body: JSON.stringify({
          paused,
          topic: topic || q.data.lounge.topic,
          cardId: card || q.data.lounge.topic_card_id || null,
          dailyLimit: q.data.lounge.daily_limit,
          dailyTokenLimit: q.data.lounge.daily_token_limit,
        }),
      });
    },
    onSuccess: async () => {
      setNote("저장했습니다.");
      await refresh();
    },
    onError: () => setNote("저장하지 못했습니다."),
  });
  const savePresentation = useMutation({
    mutationFn: () => customFetch("/api/admin/collector-lounge/presentation", {
      method: "PATCH", responseType: "json",
      body: JSON.stringify({messageLabel: (messageLabel ?? q.data?.lounge?.message_label ?? "").trim() || null}),
    }),
    onSuccess: async () => {setNote("표시 문구를 저장했습니다.");await refresh();},
    onError: () => setNote("표시 문구를 저장하지 못했습니다."),
  });
  if (!q.data) return null;
  return (
    <View
      style={{
        padding: 16,
        gap: 12,
        borderWidth: 1,
        borderColor: c.muted,
        borderRadius: 12,
      }}
    >
      <Text style={{ color: c.foreground, fontWeight: "700" }}>
        운영자 제어
      </Text>
      <Text style={{ color: c.mutedForeground }}>
        오늘 호출 {q.data.lounge?.daily_calls ?? 0}회 · Jev{" "}
        {q.data.jevConfigured ? "연결 설정됨" : "설정 필요"}
      </Text>
      <TextInput
        placeholder="대화 주제"
        placeholderTextColor={c.mutedForeground}
        value={topic}
        onChangeText={setTopic}
        style={{ color: c.foreground, padding: 10, backgroundColor: c.muted }}
      />
      <Text style={{color:c.mutedForeground}}>메시지 위 안내 문구 · 비워 두면 숨김</Text>
      <TextInput accessibilityLabel="메시지 위 안내 문구" placeholder="표시 안 함" maxLength={80}
        value={messageLabel ?? q.data.lounge?.message_label ?? ""} onChangeText={setMessageLabel}
        style={{color:c.foreground,padding:10,backgroundColor:c.muted}} />
      <Pressable disabled={savePresentation.isPending || !q.data.lounge} onPress={()=>savePresentation.mutate()}>
        <Text style={{color:c.foreground}}>표시 문구 저장</Text>
      </Pressable>
      <TextInput
        placeholder="카드 ID (선택)"
        placeholderTextColor={c.mutedForeground}
        value={card}
        onChangeText={setCard}
        style={{ color: c.foreground, padding: 10, backgroundColor: c.muted }}
      />
      <Pressable
        disabled={action.isPending}
        onPress={() => action.mutate(false)}
      >
        <Text style={{ color: c.foreground }}>
          {q.data.lounge ? "AI 대화 시작 / 주제 저장" : "공식 방 준비"}
        </Text>
      </Pressable>
      {q.data.lounge && (
        <Pressable
          disabled={action.isPending}
          onPress={() => action.mutate(true)}
        >
          <Text style={{ color: c.foreground }}>AI 일시정지</Text>
        </Pressable>
      )}
      <Text style={{ color: c.mutedForeground }}>{note}</Text>
    </View>
  );
}
