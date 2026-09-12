import React, { useEffect, useRef, useState } from "react";
import {
  View,
  Pressable,
  Switch,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
} from "react-native";
import { useRouter, Stack } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useListRooms, useGetMe } from "@workspace/api-client-react";
import {
  useDavaq,
  useDavaqMutation,
  errorText,
  key,
  dateLabel,
  type Agent,
  type Memory,
  type Match,
  type Page,
} from "@/lib/davaq";
import {
  C,
  S,
  Txt,
  Frame,
  Button,
  Chip,
  Field,
  Section,
  Cue,
  Empty,
  QueryState,
  Notice,
  PairCard,
  Icon,
} from "./UI";
export function AgentChatScreen() {
  const router = useRouter(),
    insets = useSafeAreaInsets(),
    scroll = useRef<ScrollView>(null),
    query = useDavaq<
      Page<{ id: string; role: string; content: string; created_at: string }>
    >("/agents/me/messages"),
    mutation = useDavaqMutation(),
    [text, setText] = useState(""),
    [error, setError] = useState(""),
    pendingKey = useRef<{ text: string; key: string } | null>(null);
  async function send() {
    const value = text.trim();
    if (!value || mutation.isPending) return;
    setError("");
    if (pendingKey.current?.text !== value)
      pendingKey.current = { text: value, key: key() };
    try {
      await mutation.mutateAsync({
        path: "/agents/me/messages",
        body: { text: value, requestKey: pendingKey.current.key },
      });
      pendingKey.current = null;
      setText("");
    } catch (e) {
      setError(errorText(e));
    }
  }
  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      style={{ flex: 1, backgroundColor: C.bg }}
    >
      <Stack.Screen options={{ headerShown: false }} />
      <View
        style={[
          S.row,
          {
            paddingTop: insets.top + 12,
            paddingHorizontal: 20,
            paddingBottom: 12,
            backgroundColor: "white",
          },
        ]}
      >
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="뒤로"
          onPress={() => router.back()}
          style={{ padding: 8 }}
        >
          <Icon name="arrow-left" color={C.ink} />
        </Pressable>
        <Cue size={48} />
        <View style={{ flex: 1 }}>
          <Txt bold size={18}>
            나의 큐
          </Txt>
          <Txt color={C.muted} size={12}>
            나와 함께 교환을 찾는 AI 파트너
          </Txt>
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="학습 설정"
          onPress={() => router.push("/agent/settings")}
        >
          <Icon name="settings" />
        </Pressable>
      </View>
      <ScrollView
        ref={scroll}
        keyboardShouldPersistTaps="handled"
        onContentSizeChange={() =>
          scroll.current?.scrollToEnd({ animated: true })
        }
        contentContainerStyle={{
          padding: 20,
          gap: 16,
          maxWidth: 740,
          width: "100%",
          alignSelf: "center",
          flexGrow: 1,
        }}
      >
        <Button
          small
          secondary
          icon="gift"
          label="큐가 찾은 브랜드 혜택 보기"
          onPress={() => router.push("/brand-exchanges" as any)}
        />
        <QueryState query={query} />
        {query.isSuccess && !query.data?.items.length && (
          <View style={{ alignItems: "center", paddingVertical: 25, gap: 15 }}>
            <Cue size={150} />
            <Txt bold size={22}>
              안녕하세요, 저는 큐예요.
            </Txt>
            <Txt color={C.muted} style={{ textAlign: "center" }}>
              내가 줄 수 있는 것과 받고 싶은 것을 말해주세요. 함께 교환을
              준비해볼게요.
            </Txt>
            {[
              "영어 회화를 도와줄 수 있어요",
              "새로운 취미를 경험하고 싶어요",
              "나에게 맞는 교환을 찾아줘",
            ].map((t) => (
              <Chip key={t} label={t} onPress={() => setText(t)} />
            ))}
          </View>
        )}
        {query.data?.items.map((m) => (
          <View
            key={m.id}
            style={{
              alignSelf: m.role === "user" ? "flex-end" : "flex-start",
              maxWidth: "90%",
              backgroundColor: m.role === "user" ? C.purple : C.white,
              borderRadius: 20,
              borderTopLeftRadius: m.role === "user" ? 20 : 4,
              borderBottomRightRadius: m.role === "user" ? 4 : 20,
              padding: 16,
              borderWidth: 1,
              borderColor: m.role === "user" ? C.purple : C.line,
            }}
          >
            <Txt color={m.role === "user" ? "white" : C.ink}>{m.content}</Txt>
          </View>
        ))}
        {mutation.isPending && <Notice>큐가 생각하고 있어요…</Notice>}
        {error && <Notice error>{error}</Notice>}
      </ScrollView>
      <View
        style={{
          backgroundColor: "white",
          borderTopWidth: 1,
          borderColor: C.line,
          paddingHorizontal: 18,
          paddingTop: 12,
          paddingBottom: insets.bottom + 12,
          gap: 10,
        }}
      >
        <View style={S.wrap}>
          <Chip
            label="교환 등록"
            onPress={() =>
              router.push(
                ("/exchange/new" +
                  (text ? "?text=" + encodeURIComponent(text) : "")) as never,
              )
            }
          />
          <Chip
            label="추천 보기"
            onPress={() => router.push("/agent/searches")}
          />
          <Chip
            label="기억 확인"
            onPress={() => router.push("/agent/memories")}
          />
        </View>
        <View style={[S.row, { alignItems: "flex-end" }]}>
          <View style={{ flex: 1 }}>
            <Field
              label="큐에게 말하기"
              placeholder="어떤 것을 바꿔볼까요?"
              value={text}
              onChangeText={setText}
              multiline
              maxLength={3000}
              style={{ minHeight: 48, maxHeight: 120 }}
            />
          </View>
          <Button
            label="전송"
            busy={mutation.isPending}
            disabled={!text.trim()}
            onPress={() => void send()}
          />
        </View>
      </View>
    </KeyboardAvoidingView>
  );
}
function MemoryRow({
  memory: m,
  onError,
}: {
  memory: Memory;
  onError: (e: string) => void;
}) {
  const [editing, setEditing] = useState(false),
    [label, setLabel] = useState(m.label),
    mutation = useDavaqMutation();
  async function update(status: string) {
    try {
      await mutation.mutateAsync({
        path: "/agents/me/memories/" + m.id,
        method: "PATCH",
        body: { status, ...(status !== "deleted" ? { label } : {}) },
      });
      setEditing(false);
    } catch (e) {
      onError(errorText(e));
    }
  }
  return (
    <View style={S.card}>
      {editing ? (
        <Field
          label="기억 수정"
          value={label}
          onChangeText={setLabel}
          maxLength={160}
          multiline
        />
      ) : (
        <Txt bold>{m.label}</Txt>
      )}
      <Txt size={12} color={C.muted}>
        {m.source_type === "manual"
          ? "내가 직접 입력"
          : m.source_type === "feedback"
            ? "교환 후기에서 발견"
            : "학습을 허용한 내 대화에서 발견"}{" "}
        · {dateLabel(m.updated_at)}
        {m.expires_at ? " · " + dateLabel(m.expires_at) + "까지" : ""}
      </Txt>
      <Txt size={12} color={m.status === "confirmed" ? C.green : C.purple}>
        {m.status === "confirmed"
          ? "확인한 기억 · 추천에 사용"
          : "확인 대기 · 추천에 아직 사용하지 않아요"}
      </Txt>
      <View style={S.wrap}>
        {(m.status === "candidate" || editing) && (
          <Button
            small
            label={editing ? "수정하고 확인" : "맞아요"}
            busy={mutation.isPending}
            onPress={() => void update("confirmed")}
          />
        )}{" "}
        {!editing && (
          <Button
            secondary
            small
            label="수정"
            onPress={() => setEditing(true)}
          />
        )}{" "}
        {m.status === "candidate" && (
          <Button
            secondary
            small
            label="아니에요"
            busy={mutation.isPending}
            onPress={() => void update("rejected")}
          />
        )}
        <Button
          secondary
          small
          label="기억 삭제"
          busy={mutation.isPending}
          onPress={() => void update("deleted")}
        />
      </View>
    </View>
  );
}
export function MemoriesScreen() {
  const query = useDavaq<Agent>("/agents/me"),
    mutation = useDavaqMutation(),
    [text, setText] = useState(""),
    [kind, setKind] = useState("preference"),
    [error, setError] = useState(""),
    [expiration, setExpiration] = useState(""),
    [tab, setTab] = useState("all");
  async function add() {
    setError("");
    try {
      let expiresAt: string | null = null;
      if (expiration) {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(expiration))
          throw new Error("기억할 마지막 날짜를 연-월-일로 입력해 주세요.");
        const date = new Date(expiration + "T23:59:59+09:00");
        if (Number.isNaN(date.valueOf()) || date <= new Date())
          throw new Error("미래의 올바른 날짜를 입력해 주세요.");
        expiresAt = date.toISOString();
      }
      await mutation.mutateAsync({
        path: "/agents/me/memories",
        body: { label: text, kind, expiresAt },
      });
      setText("");
      setExpiration("");
    } catch (e) {
      setError(errorText(e));
    }
  }
  return (
    <Frame back title="큐의 기억">
      <Notice>
        내가 확인한 기억만 추천에 사용해요. 삭제한 기억은 이후 추천에서
        제외돼요.
      </Notice>
      <Field
        label="큐에게 알려줄 나의 취향"
        placeholder="예: 주말 오후에 온라인으로 배우고 싶어요."
        value={text}
        onChangeText={setText}
        multiline
        maxLength={160}
      />
      <View style={S.wrap}>
        {[
          ["preference", "취향"],
          ["availability", "가능한 시간"],
          ["tone", "대화 스타일"],
        ].map(([v, l]) => (
          <Chip
            key={v}
            label={l}
            active={kind === v}
            onPress={() => setKind(v)}
          />
        ))}
      </View>
      <Field
        label="이 날짜까지만 기억 · 선택"
        placeholder="예: 2026-10-31"
        value={expiration}
        onChangeText={setExpiration}
      />
      <Button
        label="확인한 기억으로 추가"
        disabled={text.trim().length < 2}
        busy={mutation.isPending}
        onPress={() => void add()}
      />
      {error && <Notice error>{error}</Notice>}
      <Section title="나에 대해 알게 된 것" />
      <View style={S.wrap}>
        {[
          ["all", "전체"],
          ["candidate", "확인 대기"],
          ["confirmed", "확인한 기억"],
        ].map(([v, l]) => (
          <Chip
            key={v}
            label={l}
            active={tab === v}
            onPress={() => setTab(v)}
          />
        ))}
      </View>
      <QueryState query={query} />
      {query.data?.memories
        .filter((m) => tab === "all" || m.status === tab)
        .map((m) => (
          <MemoryRow key={m.id} memory={m} onError={setError} />
        ))}
      {query.isSuccess && !query.data?.memories.length && (
        <Empty
          title="나의 취향부터 하나씩"
          body="짧은 선호 하나가 더 나은 교환을 찾는 단서가 돼요."
          icon="heart"
        />
      )}
    </Frame>
  );
}
export function AgentSettingsScreen() {
  const query = useDavaq<Agent>("/agents/me"),
    rooms = useListRooms(),
    me = useGetMe(),
    mutation = useDavaqMutation(),
    [form, setForm] = useState<Agent["settings"] | null>(null),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  useEffect(() => {
    if (query.data) setForm(query.data.settings);
  }, [query.data?.settings.consent_version]);
  async function save() {
    if (!form) return;
    setError("");
    setNotice("");
    try {
      await mutation.mutateAsync({
        path: "/agents/me/settings",
        method: "PATCH",
        body: {
          name: form.name,
          tone: form.tone,
          activityLearning: form.activity_learning,
          chatLearning: form.chat_learning,
          autoSearch: form.auto_search,
          allowedRoomIds: form.allowed_room_ids,
          consentVersion: form.consent_version,
        },
      });
      setNotice("큐의 설정을 저장했어요.");
    } catch (e) {
      setError(errorText(e));
    }
  }
  return (
    <Frame back title="큐 설정">
      <QueryState query={query} />
      {form && (
        <>
          <Field
            label="나의 AI 이름"
            value={form.name}
            maxLength={20}
            onChangeText={(name) => setForm({ ...form, name })}
          />
          <View style={S.wrap}>
            <Chip
              label="다정하게"
              active={form.tone === "warm"}
              onPress={() => setForm({ ...form, tone: "warm" })}
            />
            <Chip
              label="간결하게"
              active={form.tone === "brief"}
              onPress={() => setForm({ ...form, tone: "brief" })}
            />
          </View>
          {(
            [
              [
                "activity_learning",
                "활동으로 취향 배우기",
                "교환 후 내가 남긴 피드백에서 기억 후보를 만들어요.",
              ],
              [
                "chat_learning",
                "대화로 취향 배우기",
                "나와 큐의 대화와 아래에서 선택한 대화방에서, 설정 이후 내가 직접 보낸 메시지만 살펴봐요.",
              ],
              [
                "auto_search",
                "새로운 교환 자동 탐색",
                "등록 내용이나 취향이 바뀌면 조건이 맞는 후보를 다시 찾아요. 제안 전송과 수락은 내가 해요.",
              ],
            ] as const
          ).map(([field, label, body]) => (
            <View key={field} style={[S.card, S.row]}>
              <View style={{ flex: 1, gap: 6 }}>
                <Txt bold>{label}</Txt>
                <Txt size={13} color={C.muted}>
                  {body}
                </Txt>
              </View>
              <Switch
                accessibilityLabel={label}
                value={form[field]}
                onValueChange={(v) => setForm({ ...form, [field]: v })}
                trackColor={{ false: C.line, true: C.purple }}
                thumbColor="white"
              />
            </View>
          ))}
          {form.chat_learning && (
            <>
              <Section title="학습할 대화방 선택" />
              <Txt size={13} color={C.muted}>
                상대방의 메시지는 학습하지 않아요. 선택하지 않은 대화방과
                AnotherMe 데이터는 사용하지 않아요.
              </Txt>
              <QueryState query={rooms} />
              {rooms.data?.map((r) => {
                const selected = form.allowed_room_ids.includes(r.id),
                  name =
                    r.name ||
                    r.members?.find((m) => m.id !== me.data?.id)?.nickname ||
                    "교환 대화";
                return (
                  <Chip
                    key={r.id}
                    label={(selected ? "✓ " : "") + name}
                    active={selected}
                    onPress={() =>
                      setForm({
                        ...form,
                        allowed_room_ids: selected
                          ? form.allowed_room_ids.filter((id) => id !== r.id)
                          : [...form.allowed_room_ids, r.id].slice(0, 20),
                      })
                    }
                  />
                );
              })}
              {rooms.isSuccess && !rooms.data?.length && (
                <Notice>
                  아직 선택할 대화방이 없어요. 큐와의 개인 대화부터 학습할 수
                  있어요.
                </Notice>
              )}
            </>
          )}
          <Notice>
            학습을 끄면 새 기억 후보 생성을 멈춰요. 이미 확인한 기억은 ‘큐의
            기억’에서 개별 삭제할 수 있어요.
          </Notice>
          {error && <Notice error>{error}</Notice>}
          {notice && <Notice>{notice}</Notice>}
          <Button
            label="설정 저장"
            disabled={!form.name.trim()}
            busy={mutation.isPending}
            onPress={() => void save()}
          />
        </>
      )}
    </Frame>
  );
}
export function SearchesScreen() {
  const query = useDavaq<Page<Match>>("/exchange/matches"),
    agent = useDavaq<Agent>("/agents/me"),
    mutation = useDavaqMutation(),
    router = useRouter(),
    [error, setError] = useState("");
  return (
    <Frame
      back
      title="큐의 탐색"
      right={
        <Button
          small
          label="다시 찾기"
          busy={mutation.isPending}
          onPress={() => {
            setError("");
            void mutation
              .mutateAsync({ path: "/agents/me/search" })
              .catch((e) => setError(errorText(e)));
          }}
        />
      }
    >
      <View style={{ alignItems: "center" }}>
        <Cue size={130} />
        <Txt bold size={23}>
          {query.data?.items.length
            ? "새로운 연결을 찾았어요"
            : "어떤 경험을 바꿔볼까요?"}
        </Txt>
      </View>
      <Notice>
        서로의 희망 분야·활동 지역·가능한 요일과 확인한 기억을 살펴봐요. 최종
        조건은 두 사람이 함께 정해요.
      </Notice>
      {agent.data?.job?.finished_at && (
        <Txt color={C.muted} size={12}>
          최근 탐색 · {dateLabel(agent.data.job.finished_at)}
        </Txt>
      )}
      <QueryState query={query} />
      {query.data?.items.map((m) => (
        <PairCard key={m.id} match={m} />
      ))}
      {query.isSuccess && !query.data?.items.length && (
        <Empty
          title="지금 조건에 맞는 상대를 찾고 있어요"
          body="공개한 제공 항목과 받고 싶은 분야를 확인해 주세요. 새로운 등록이 생기면 후보도 달라질 수 있어요."
          action="내 등록 확인"
          onPress={() => router.push("/(tabs)/exchanges")}
        />
      )}{" "}
      {error && <Notice error>{error}</Notice>}
    </Frame>
  );
}
