import React, { useState } from "react";
import { useAuth } from "@clerk/expo";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Frame, Txt, Button, Notice } from "@/components/davaq/UI";
import { parseInviteCode, savePendingInvite } from "@/lib/inviteLinks";
export default function InviteScreen() {
  const { code } = useLocalSearchParams<{ code: string }>(),
    auth = useAuth(),
    router = useRouter(),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const valid = parseInviteCode(typeof code === "string" ? code : "");
  async function next() {
    if (!valid) return;
    setBusy(true);
    try {
      await savePendingInvite(valid);
      router.replace(
        auth.isSignedIn
          ? { pathname: "/friends/add", params: { code: valid } }
          : "/(auth)/sign-in",
      );
    } catch {
      setError("초대를 준비하지 못했어요. 다시 시도해 주세요.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <Frame back title="DavaQ 친구 초대">
      <Txt>친구와 함께 물건·재능·경험을 바꿔보세요.</Txt>
      {valid ? (
        <>
          <Txt>로그인 후 초대 코드를 확인하고 친구 요청을 보낼 수 있어요.</Txt>
          <Button
            label={auth.isSignedIn ? "초대 확인하기" : "로그인하고 계속"}
            busy={busy}
            disabled={!auth.isLoaded}
            onPress={() => void next()}
          />
        </>
      ) : (
        <Notice error>올바르지 않은 초대 링크입니다.</Notice>
      )}
      {!!error && <Notice error>{error}</Notice>}
    </Frame>
  );
}
