import { Redirect, Stack } from "expo-router";
import { useAuth, useSession } from "@clerk/expo";
import { Platform } from "react-native";
import React from "react";
import { neon } from "@/constants/colors";

export default function AuthLayout() {
  const { isLoaded, isSignedIn } = useAuth();
  const { session } = useSession();
  // ApiAuthBridge remounts navigation when the session changes. Wait for that
  // transition instead of dispatching REPLACE from the old login navigator.
  if (Platform.OS === "android" && isLoaded && isSignedIn && !session?.currentTask) {
    return <Redirect href="/" />;
  }
  return (
    <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: neon.background } }}>
      <Stack.Screen name="sign-in" />
      <Stack.Screen name="sign-up" />
      <Stack.Screen name="forgot-password" />
    </Stack>
  );
}
