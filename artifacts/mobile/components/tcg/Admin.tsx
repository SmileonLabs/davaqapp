import React, { useState } from "react";
import { View } from "react-native";
import {
  Frame,
  Txt,
  Field,
  Button,
  Notice,
  Section,
  QueryState,
  S,
} from "@/components/davaq/UI";
import { useDavaq, useDavaqMutation, errorText } from "@/lib/tcg";
export function AdminScreen() {
  const q = useDavaq<{ reports: any[]; requests: any[] }>("/tcg/admin"),
    m = useDavaqMutation(),
    [reason, setReason] = useState(""),
    [cardId, setCardId] = useState(""),
    [cardName, setCardName] = useState(""),
    [error, setError] = useState(""),
    [verified, setVerified] = useState(false);
  async function act(path: string, body: unknown) {
    setError("");
    try {
      await m.mutateAsync({ path, body });
    } catch (e) {
      setError(errorText(e));
    }
  }
  return (
    <Frame back title="TCG 운영 검토" onRefresh={() => void q.refetch()}>
      <QueryState query={q} />
      <Field
        label="처리 근거·확인 내용"
        value={reason}
        onChangeText={setReason}
        multiline
      />
      <Field
        label="연결할 TCGIndex 카드 ID"
        value={cardId}
        onChangeText={setCardId}
      />
      <Field
        label="카드 이름 (해외 자료 조회용)"
        value={cardName}
        onChangeText={setCardName}
      />
      {error && <Notice error>{error}</Notice>}
      <Section title="카드 등록 요청" />
      {q.data?.requests.map((v) => (
        <View style={S.card} key={v.id}>
          <Txt bold>{v.name}</Txt>
          <Txt size={13}>
            {v.game} · {v.number} · {v.language} · {v.status}
          </Txt>
          <Notice>
            공통 카탈로그에서 정확한 판본을 확인한 카드 ID만 연결합니다.
          </Notice>
          <Button
            label="판본 연결"
            disabled={m.isPending || !cardId || reason.length < 5}
            onPress={() =>
              void act("/tcg/admin/requests/" + v.id + "/link", {
                cardId,
                cardName,
                reason,
              })
            }
          />
        </View>
      ))}
      <Section title="신고·분쟁" />
      {q.data?.reports.map((v) => (
        <View style={S.card} key={v.id}>
          <Txt bold>{v.trade_id ? "거래 분쟁" : "매물 신고"}</Txt>
          <Txt>{v.reason}</Txt>
          {v.trade_id ? (
            <>
              <Button
                secondary
                label={
                  verified
                    ? "합의·반환 증빙 확인함"
                    : "합의·반환 증빙을 확인했어요"
                }
                onPress={() => setVerified(!verified)}
              />
              <Button
                label="합의에 따라 거래 재개"
                disabled={!verified || reason.length < 5 || m.isPending}
                onPress={() =>
                  void act("/tcg/admin/trades/" + v.trade_id + "/resolve", {
                    action: "resume",
                    verified: true,
                    reason,
                  })
                }
              />
              <Button
                secondary
                label="미전달·전체 반환 확인 후 취소"
                disabled={!verified || reason.length < 5 || m.isPending}
                onPress={() =>
                  void act("/tcg/admin/trades/" + v.trade_id + "/resolve", {
                    action: "cancel",
                    verified: true,
                    reason,
                  })
                }
              />
            </>
          ) : (
            <>
              <Button
                label="매물 닫기·신고 처리"
                disabled={reason.length < 5 || m.isPending}
                onPress={() =>
                  void act("/tcg/admin/reports/" + v.id + "/resolve", {
                    action: "close_listing",
                    reason,
                  })
                }
              />
              <Button
                secondary
                label="검토 완료"
                disabled={reason.length < 5 || m.isPending}
                onPress={() =>
                  void act("/tcg/admin/reports/" + v.id + "/resolve", {
                    action: "reviewed",
                    reason,
                  })
                }
              />
            </>
          )}
        </View>
      ))}
    </Frame>
  );
}
