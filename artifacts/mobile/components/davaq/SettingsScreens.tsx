import { Avatar } from "@/components/Avatar";
import { useCharacterProfiles } from "@/hooks/useCharacterProfiles";
import { Image as CachedImage } from "expo-image";
import { clearChatVideoCache } from "@/lib/chatVideoCache";
import React, { useCallback, useEffect, useState } from "react";
import { AppState, Linking, Platform, Pressable, View } from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import { useAuth } from "@/lib/davaqAuth";
import { useGetMe } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { clearChatOutboxForOwner } from "@/lib/chatMessageOutbox";
import { getExistingNativePushToken } from "@/lib/nativePush";
import { getApplePushCredentials } from "@/lib/applePush";
import { revokePushRegistrationWithBearer } from "@/lib/pushOwnership";
import {
  getFullScreenCallAccess,
  openFullScreenCallSettings,
  type FullScreenCallAccess,
} from "@/lib/androidTelecom";
import { DAVAQ_LEGAL_LINK_ERROR, DAVAQ_LEGAL_URLS } from "@/lib/davaqLegal";
import { UgcConsentPrompt, useUgcConsent } from "@/components/UgcConsentPrompt";
import { SocialLoginButtons } from "./SocialLoginButtons";
import { useKnowledgeAdminMe } from "@/hooks/useKnowledge";
import { useDavaq, useDavaqMutation, errorText } from "@/lib/davaq";
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
  Cue,
} from "./UI";
export function SettingsScreen({ tab = false }: { tab?: boolean } = {}) {
  const { activeProfile, refetch: refreshProfile } = useCharacterProfiles();
  useFocusEffect(
    useCallback(() => {
      void refreshProfile();
    }, [refreshProfile]),
  );
  const shopConfig = useDavaq<{ available: boolean }>("/shops/config");
  const router = useRouter(),
    me = useGetMe(),
    { signOut, getToken } = useAuth(),
    admin = useKnowledgeAdminMe(),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [callAccess, setCallAccess] = useState<FullScreenCallAccess | null>(null),
    [openingCallSettings, setOpeningCallSettings] = useState(false);
  useEffect(() => {
    if (Platform.OS !== "android") return;
    let mounted = true;
    const refresh = async () => {
      const access = await getFullScreenCallAccess().catch(() => null);
      if (mounted) setCallAccess(access);
    };
    void refresh();
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") void refresh();
    });
    return () => {
      mounted = false;
      subscription.remove();
    };
  }, []);
  async function openCallSettings() {
    setOpeningCallSettings(true);
    setError("");
    try {
      if (!(await openFullScreenCallSettings())) {
        setError(
          "수신 전화 화면 설정을 열지 못했습니다. Android 설정의 DavaQ 특별 접근 권한에서 확인해 주세요.",
        );
      }
    } catch {
      setError(
        "수신 전화 화면 설정을 열지 못했습니다. 일반 수신 전화 알림은 계속 사용할 수 있습니다.",
      );
    } finally {
      setOpeningCallSettings(false);
    }
  }
  async function openLegalPage(url: string) {
    setError("");
    try {
      await Linking.openURL(url);
    } catch {
      setError(DAVAQ_LEGAL_LINK_ERROR);
    }
  }
  async function clearMediaCache() {
    setBusy(true);
    setError("");
    try {
      await CachedImage.clearMemoryCache();
      await CachedImage.clearDiskCache();
      await clearChatVideoCache();
      setError(
        "미디어 캐시를 정리했습니다. 갤러리에 저장한 파일과 대화는 유지됩니다.",
      );
    } catch {
      setError("캐시를 정리하지 못했습니다. 다시 시도해 주세요.");
    } finally {
      setBusy(false);
    }
  }
  async function logout() {
    setBusy(true);
    try {
      if (me.data?.id) await clearChatOutboxForOwner(me.data.id);
      // Revoke while the old session can still refresh its short-lived bearer.
      if (Platform.OS !== "web") {
        const bearer = await getToken().catch(() => null);
        const tokens =
          Platform.OS === "ios"
            ? await getApplePushCredentials().catch(() => [])
            : [await getExistingNativePushToken().catch(() => null)];
        const results = await Promise.all(
          tokens
            .filter(Boolean)
            .map((token) => revokePushRegistrationWithBearer(token, bearer)),
        );
        if (results.some((result) => !result))
          console.warn(
            "Push logout revocation incomplete; local owner will be cleared",
          );
      }
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
    <Frame back={!tab} title={tab ? "설정" : "내 설정"}>
      {shopConfig.data?.available && <Button secondary label="무료 매장 모드" icon="briefcase" onPress={() => router.push("/shop" as any)} />}
      <View style={[S.card, S.row]}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="프로필 사진 변경"
          onPress={() => router.push("/profile/avatar")}
        >
          <Avatar
            uri={activeProfile?.profileImageUrl ?? me.data?.profileImageUrl}
            name={me.data?.nickname ?? "내 프로필"}
            size={72}
          />
        </Pressable>
        <View style={{ flex: 1 }}>
          <Txt bold size={21}>
            {me.data?.nickname ?? "내 프로필"}
          </Txt>
          <Txt color={C.muted} size={13}>
            {me.data?.statusMessage ||
              "좋아하는 TCG와 수집 목표를 소개해 주세요."}
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
        label="알림 설정"
        onPress={() => router.push("/settings/notifications")}
      />
      {Platform.OS === "android" && callAccess?.supported ? (
        <>
          <Button
            secondary
            label="수신 전화 전체 화면 설정"
            busy={openingCallSettings}
            onPress={() => void openCallSettings()}
          />
          <Notice>
            {callAccess.granted
              ? "전체 화면 수신 전화가 허용되어 있습니다. "
              : "잠금 화면에서 수신 전화를 전체 화면으로 보려면 Android 설정에서 허용해 주세요. "}
            허용하지 않아도 일반 수신 전화 알림으로 전화를 받을 수 있습니다.
          </Notice>
        </>
      ) : null}
      <Button
        secondary
        label="채팅방 AI 소환 설정"
        onPress={() => router.push("/settings/another-me")}
      />
      {Platform.OS !== "web" ? (
        <Button
          secondary
          label={busy ? "처리 중…" : "사진·영상 캐시 정리"}
          onPress={() => {
            if (!busy) void clearMediaCache();
          }}
        />
      ) : null}
      <Button
        secondary
        label="친구·초대 관리"
        onPress={() => router.push("/friends")}
      />
      <Button
        secondary
        label="차단한 사용자"
        onPress={() => router.push("/settings/blocked")}
      />
      <Button
        secondary
        label="카드 요청·가격 알림"
        onPress={() => router.push("/tcg/notifications" as any)}
      />
      {admin.data?.isAdmin && (
        <Button
          secondary
          label="TCG 운영 검토"
          onPress={() => router.push("/tcg/admin" as any)}
        />
      )}
      <Section title="로그인 계정 연결" />
      <SocialLoginButtons link />
      <Notice>
        Google·Apple 로그인 계정을 현재 DAVAQ 계정에 연결해요. 카드와 채팅
        기록은 그대로 유지돼요.
      </Notice>
      <Section title="개인정보·계정" />
      <Button
        secondary
        label="개인정보처리방침"
        onPress={() => void openLegalPage(DAVAQ_LEGAL_URLS.privacy)}
      />
      <Button
        secondary
        label="계정·데이터 삭제 요청"
        onPress={() => void openLegalPage(DAVAQ_LEGAL_URLS.accountDeletion)}
      />
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
  const consent = useUgcConsent(me.data?.id);
  useEffect(() => {
    if (me.data) {
      setName(me.data.nickname);
      setBio(me.data.statusMessage ?? "");
    }
  }, [me.data?.id]);
  async function save() {
    setError("");
    if (!(await consent.ensureConsent())) return;
    try {
      await mutation.mutateAsync({
        path: "/users/me",
        method: "PATCH",
        body: { nickname: name, statusMessage: bio },
      });
      await client.invalidateQueries({ queryKey: ["/api/users/me"] });
      setNotice("DAVAQ 프로필을 저장했어요.");
    } catch (e) {
      setError(errorText(e));
    }
  }
  return (
    <Frame back title="내 프로필">
      <QueryState query={me} />
      <Field label="이름" value={name} onChangeText={setName} maxLength={30} />
      <Field
        label="수집가 소개"
        value={bio}
        onChangeText={setBio}
        multiline
        maxLength={200}
        placeholder="좋아하는 카드와 거래 스타일을 알려주세요."
      />
      <Button
        label="저장"
        busy={mutation.isPending}
        disabled={!name.trim()}
        onPress={() => void save()}
      />
      {error && <Notice error>{error}</Notice>}
      {notice && <Notice>{notice}</Notice>}
      <UgcConsentPrompt {...consent.promptProps} />
    </Frame>
  );
}
