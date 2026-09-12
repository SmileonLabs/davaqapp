import React, { useEffect, useState } from "react";
import { View } from "react-native";
import { useRouter } from "expo-router";
import { useAuth } from "@clerk/expo";
import { useGetMe } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { clearChatOutboxForOwner } from "@/lib/chatMessageOutbox";
import { useKnowledgeAdminMe } from "@/hooks/useKnowledge";
import {
  useDavaq,
  useDavaqMutation,
  errorText,
  type Listing,
  type Proposal,
} from "@/lib/davaq";
import {
  C,
  S,
  Txt,
  Frame,
  Button,
  Field,
  Section,
  QueryState,
  Notice,
  ListingCard,
  Cue,
} from "./UI";
export function SettingsScreen() {
  const router = useRouter(),
    me = useGetMe(),
    { signOut } = useAuth(),
    admin = useKnowledgeAdminMe(),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  async function logout() {
    setBusy(true);
    try {
      if (me.data?.id) await clearChatOutboxForOwner(me.data.id);
      await signOut();
      if (me.data?.id) await clearChatOutboxForOwner(me.data.id);
      router.replace("/(auth)/sign-in");
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Frame back title="내 설정">
      <View style={[S.card, S.row]}>
        <Cue size={72} />
        <View style={{ flex: 1 }}>
          <Txt bold size={21}>
            {me.data?.nickname ?? "내 프로필"}
          </Txt>
          <Txt color={C.muted} size={13}>
            {me.data?.statusMessage || "내 경험을 소개해 주세요."}
          </Txt>
        </View>
      </View>
      <Button
        secondary
        label="이름·소개 수정"
        onPress={() => router.push("/profile/edit")}
      />
      <Button
        secondary
        label="큐 학습·자동 탐색 설정"
        onPress={() => router.push("/agent/settings")}
      />
      <Button
        secondary
        label="큐의 기억 관리"
        onPress={() => router.push("/agent/memories")}
      />
      <Button
        secondary
        label="차단한 사용자"
        onPress={() => router.push("/settings/blocked")}
      />
      {admin.data?.isAdmin && (
        <Button
          secondary
          label="브랜드 교환 운영"
          onPress={() => router.push("/brand-admin" as any)}
        />
      )}
      {admin.data?.isAdmin && (
        <Button
          secondary
          label="DavaQ 운영 검토"
          onPress={() => router.push("/exchange/admin")}
        />
      )}
      <Notice>
        DavaQ는 AnotherMe와 로그인 계정만 함께 사용해요. 프로필·메시지·교환·큐의
        기억은 DavaQ에 별도로 저장돼요.
      </Notice>
      <Button
        secondary
        label="로그아웃"
        busy={busy}
        onPress={() => void logout()}
      />
      {error && <Notice error>{error}</Notice>}
    </Frame>
  );
}
export function ProfileEditor() {
  const me = useGetMe(),
    mutation = useDavaqMutation(),
    client = useQueryClient(),
    [name, setName] = useState(""),
    [bio, setBio] = useState(""),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  useEffect(() => {
    if (me.data) {
      setName(me.data.nickname);
      setBio(me.data.statusMessage ?? "");
    }
  }, [me.data?.id]);
  async function save() {
    setError("");
    try {
      await mutation.mutateAsync({
        path: "/users/me",
        method: "PATCH",
        body: { nickname: name, statusMessage: bio },
      });
      await client.invalidateQueries({ queryKey: ["/api/users/me"] });
      setNotice("DavaQ 프로필을 저장했어요.");
    } catch (e) {
      setError(errorText(e));
    }
  }
  return (
    <Frame back title="내 프로필">
      <QueryState query={me} />
      <Field label="이름" value={name} onChangeText={setName} maxLength={30} />
      <Field
        label="나의 경험 소개"
        value={bio}
        onChangeText={setBio}
        multiline
        maxLength={200}
        placeholder="내가 잘하는 것과 함께 나눌 경험을 알려주세요."
      />
      <Button
        label="저장"
        busy={mutation.isPending}
        disabled={!name.trim()}
        onPress={() => void save()}
      />
      {error && <Notice error>{error}</Notice>}
      {notice && <Notice>{notice}</Notice>}
    </Frame>
  );
}
export function ExchangeAdminScreen() {
  const query = useDavaq<{ listings: Listing[]; disputes: Proposal[] }>(
      "/exchange/admin",
    ),
    mutation = useDavaqMutation(),
    [reason, setReason] = useState(""),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  async function resolve(id: string, kind: string, action: string) {
    setError("");
    setNotice("");
    try {
      await mutation.mutateAsync({
        path: "/exchange/admin/" + id,
        body: { kind, action, reason },
      });
      setNotice("검토 결과와 처리 사유를 기록했어요.");
    } catch (e) {
      setError(errorText(e));
    }
  }
  return (
    <Frame back title="운영 검토">
      <QueryState query={query} />
      {query.data && (
        <>
          <Field
            label="처리 사유 · 당사자에게 안내할 내용"
            multiline
            value={reason}
            onChangeText={setReason}
            placeholder="5자 이상 구체적으로 적어주세요."
          />
          <Section title={"공개 검토 · " + query.data.listings.length} />
          {query.data.listings.map((l) => (
            <View key={l.id} style={S.card}>
              <Txt bold>{l.title}</Txt>
              <Txt>{l.description}</Txt>
              <Txt size={13}>{l.wantedText}</Txt>
              <View style={S.row}>
                <Button
                  label="승인"
                  disabled={reason.trim().length < 5}
                  busy={mutation.isPending}
                  onPress={() => void resolve(l.id, "listing", "approve")}
                />
                <Button
                  secondary
                  label="반려"
                  disabled={reason.trim().length < 5}
                  busy={mutation.isPending}
                  onPress={() => void resolve(l.id, "listing", "reject")}
                />
              </View>
            </View>
          ))}
          <Section title={"교환 검토 · " + query.data.disputes.length} />
          {query.data.disputes.map((p) => (
            <View key={p.id} style={S.card}>
              <Txt bold>
                {p.proposer_name} ⇄ {p.recipient_name}
              </Txt>
              <Txt>
                {p.snapshots.offer.title} ⇄ {p.snapshots.requested.title}
              </Txt>
              <Txt size={13}>{p.terms.note}</Txt>
              <Txt size={13}>취소 조건: {p.terms.cancellation}</Txt>
              {p.events?.map((e) => (
                <Txt key={e.id} size={13}>
                  {e.data.note}
                </Txt>
              ))}
              <View style={S.row}>
                <Button
                  label="교환 재개"
                  disabled={reason.trim().length < 5}
                  busy={mutation.isPending}
                  onPress={() => void resolve(p.id, "proposal", "resume")}
                />
                <Button
                  secondary
                  label="취소 처리"
                  disabled={reason.trim().length < 5}
                  busy={mutation.isPending}
                  onPress={() => void resolve(p.id, "proposal", "cancel")}
                />
              </View>
            </View>
          ))}
        </>
      )}
      {error && <Notice error>{error}</Notice>}
      {notice && <Notice>{notice}</Notice>}
    </Frame>
  );
}
