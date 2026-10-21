import React, { useState } from "react";
import { View, Pressable } from "react-native";
import { useRouter } from "expo-router";
import {
  Frame,
  Txt,
  Field,
  Button,
  Notice,
  S,
  C,
  Icon,
} from "@/components/davaq/UI";
import { api, errorText, type Listing } from "@/lib/tcg";
import { ListingRow } from "./Cards";
export function AgentConversation({
  embedded = false,
  onBack,
}: {
  embedded?: boolean;
  onBack?: () => void;
}) {
  const [text, setText] = useState(""),
    [history, setHistory] = useState<
      { text: string; reply: string; candidates: Listing[] }[]
    >([]),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  async function send() {
    if (!text.trim() || busy) return;
    setBusy(true);
    setError("");
    const prompt = text;
    try {
      const result = await api<{ reply: string; candidates: Listing[] }>(
        "/tcg/assistant",
        "POST",
        { text: prompt },
      );
      setHistory((p) => [...p, { text: prompt, ...result }]);
      setText("");
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }
  const content = (
    <>
      <Notice>
        큐가 실제 카드 거래 후보와 등록 조건을 정리해 드립니다. 거래 확정은 직접
        확인해 주세요.
      </Notice>
      {history.map((h, i) => (
        <View key={i} style={{ gap: 12 }}>
          <View style={[S.card, { backgroundColor: C.soft }]}>
            <Txt>{h.text}</Txt>
          </View>
          <View style={S.card}>
            <Txt>{h.reply}</Txt>
          </View>
          {h.candidates.map((l) => (
            <ListingRow key={l.id} listing={l} />
          ))}
        </View>
      ))}
      <Field
        label="큐에게 물어보기"
        value={text}
        onChangeText={setText}
        multiline
        placeholder="내 희망 카드에 맞는 거래를 찾아줘"
      />
      <Button
        label="보내기"
        busy={busy}
        disabled={!text.trim()}
        onPress={() => void send()}
      />
      {error && <Notice error>{error}</Notice>}
    </>
  );
  return (
    <Frame
      title="카드 거래 도우미 큐"
      back={!embedded}
      right={
        embedded && onBack ? (
          <Button small secondary label="닫기" onPress={onBack} />
        ) : undefined
      }
    >
      {content}
    </Frame>
  );
}
export function PinnedAgentConversation({
  onPress,
  selected,
  compact,
}: {
  onPress?: () => void;
  selected?: boolean;
  compact?: boolean;
}) {
  const r = useRouter();
  return (
    <Pressable
      style={[
        S.card,
        S.row,
        {
          margin: compact ? 12 : 0,
          backgroundColor: selected ? C.soft : C.white,
        },
      ]}
      onPress={onPress ?? (() => r.push("/agent/chat"))}
    >
      <Icon name="cpu" size={28} />
      <View>
        <Txt bold>큐 · TCG 거래 도우미</Txt>
        <Txt size={12} color={C.muted}>
          카드 등록과 거래 후보를 함께 확인해요
        </Txt>
      </View>
    </Pressable>
  );
}
export function TcgChatCard({ tradeId }: { tradeId: string }) {
  const r = useRouter();
  return (
    <Pressable
      style={S.card}
      onPress={() => r.push(("/tcg/trade/" + tradeId) as any)}
    >
      <Txt bold>TCG 거래 제안</Txt>
      <Txt size={13} color={C.purple}>
        조건 확인·거래 진행 →
      </Txt>
    </Pressable>
  );
}
