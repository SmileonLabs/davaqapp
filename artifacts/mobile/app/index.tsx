import React, { useEffect, useState } from "react";
import { useAuth } from "@clerk/expo";
import { Redirect } from "expo-router";
import { ActivityIndicator, View } from "react-native";
import { C, Cue, Txt } from "@/components/davaq/UI";
import { loadPendingInvite } from "@/lib/inviteLinks";
export default function Index() {
  const { isLoaded, isSignedIn } = useAuth(),
    [pending, setPending] = useState<string | null | undefined>();
  useEffect(() => {
    if (isLoaded && isSignedIn)
      void loadPendingInvite()
        .then(setPending)
        .catch(() => setPending(null));
  }, [isLoaded, isSignedIn]);
  if (!isLoaded || (isSignedIn && pending === undefined))
    return (
      <View
        style={{
          flex: 1,
          alignItems: "center",
          justifyContent: "center",
          gap: 20,
          backgroundColor: C.bg,
        }}
      >
        <Cue size={150} />
        <Txt bold size={24}>
          새로운 경험을 만나는 중
        </Txt>
        <ActivityIndicator color={C.purple} />
      </View>
    );
  return (
    <Redirect
      href={
        !isSignedIn
          ? "/(auth)/sign-in"
          : pending
            ? { pathname: "/friends/add", params: { code: pending } }
            : "/(tabs)"
      }
    />
  );
}
