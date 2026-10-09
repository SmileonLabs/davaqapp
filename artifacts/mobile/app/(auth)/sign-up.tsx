import { LegalLinks } from "@/components/davaq/LegalLinks";
import { CustomScrollView } from "@/components/CustomScroll";
import { useSignUp } from "@clerk/expo";
import { Link, useRouter, type Href } from "expo-router";
import React, { useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useColors } from "@/hooks/useColors";
import { useThemeMode } from "@/hooks/useThemeMode";

export default function SignUpScreen() {
  const { signUp, errors, fetchStatus } = useSignUp();
  const router = useRouter();
  const colors = useColors();
  const { scheme } = useThemeMode();
  const insets = useSafeAreaInsets();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [editingEmail, setEditingEmail] = useState(false);

  const handleSignUp = async () => {
    setEditingEmail(false);
    const { error } = await signUp.password({ emailAddress: email, password });
    if (error) return;
    if (!error) await signUp.verifications.sendEmailCode();
  };

  const handleEditEmail = async () => {
    await signUp.reset();
    setCode("");
    setEditingEmail(true);
  };

  const handleVerify = async () => {
    await signUp.verifications.verifyEmailCode({ code });
    if (signUp.status === "complete") {
      await signUp.finalize({
        navigate: ({ session, decorateUrl }) => {
          if (session?.currentTask) return;
          // Android auth layout redirects after the authenticated navigator mounts.
          if (Platform.OS === "android") return;
          const url = decorateUrl("/");
          if (url.startsWith("http")) {
            if (typeof window !== "undefined") window.location.href = url;
          } else {
            router.replace(url as Href);
          }
        },
      });
    }
  };

  if (
    !editingEmail &&
    signUp.status === "missing_requirements" &&
    signUp.unverifiedFields?.includes("email_address") &&
    signUp.missingFields?.length === 0
  ) {
    return (
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : "height"} style={{ flex: 1 }}>
        <CustomScrollView
          contentContainerStyle={[
            styles.container,
            { backgroundColor: colors.background, paddingTop: insets.top + 40, paddingBottom: insets.bottom + 20 },
          ]}
          keyboardShouldPersistTaps="handled"
        >
          <Text style={[styles.title, { color: colors.foreground }]}>이메일 인증</Text>
          <Text style={[styles.subtitle, { color: colors.mutedForeground }]}>
            {email}로 전송된 6자리 코드를 입력해주세요
          </Text>
          <TextInput
            style={[styles.input, { backgroundColor: colors.input, color: colors.foreground, borderColor: colors.border }]}
            value={code}
            onChangeText={setCode}
            placeholder="인증 코드"
            placeholderTextColor={colors.mutedForeground}
            keyboardType="numeric"
            autoFocus
          />
          {errors?.fields?.code ? (
            <Text style={[styles.error, { color: colors.destructive }]}>{errors.fields.code.message}</Text>
          ) : null}
          <Pressable
            style={({ pressed }) => [styles.button, { backgroundColor: colors.primary, opacity: pressed ? 0.85 : 1 }]}
            onPress={handleVerify}
            disabled={fetchStatus === "fetching"}
          >
            {fetchStatus === "fetching" ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={[styles.buttonText, { color: colors.primaryForeground }]}>인증하기</Text>
            )}
          </Pressable>
          <Pressable onPress={() => signUp.verifications.sendEmailCode()} disabled={fetchStatus === "fetching"}>
            <Text style={[styles.resend, { color: colors.primary }]}>코드 재전송</Text>
          </Pressable>
          <Pressable onPress={handleEditEmail} disabled={fetchStatus === "fetching"}>
            <Text style={[styles.resend, { color: colors.mutedForeground }]}>← 이메일 주소 수정하기</Text>
          </Pressable>
          <LegalLinks color={colors.primary} />
      </CustomScrollView>
      </KeyboardAvoidingView>
    );
  }

  return (
    <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : "height"} style={{ flex: 1 }}>
      <CustomScrollView
        contentContainerStyle={[
          styles.container,
          { backgroundColor: colors.background, paddingTop: insets.top + 40, paddingBottom: insets.bottom + 20 },
        ]}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.header}>
          {scheme === "dark" ? (
            <Text style={{ fontSize: 40, fontWeight: "900", color: colors.text, letterSpacing: -1.5 }}>DavaQ</Text>
          ) : (
            <Text style={{ fontSize: 40, fontWeight: "900", color: colors.text, letterSpacing: -1.5 }}>DavaQ</Text>
          )}
          <Text style={[styles.title, { color: colors.foreground }]}>회원가입</Text>
          <Text style={[styles.subtitle, { color: colors.mutedForeground }]}>
            새 계정을 만들어보세요
          </Text>
        </View>

        <View style={styles.form}>
          <View>
            <Text style={[styles.label, { color: colors.foreground }]}>이메일</Text>
            <TextInput
              style={[styles.input, { backgroundColor: colors.input, color: colors.foreground, borderColor: colors.border }]}
              value={email}
              onChangeText={setEmail}
              placeholder="이메일 주소"
              placeholderTextColor={colors.mutedForeground}
              keyboardType="email-address"
              autoCapitalize="none"
            />
            {errors?.fields?.emailAddress ? (
              <Text style={[styles.error, { color: colors.destructive }]}>{errors.fields.emailAddress.message}</Text>
            ) : null}
          </View>
          <View>
            <Text style={[styles.label, { color: colors.foreground }]}>비밀번호</Text>
            <TextInput
              style={[styles.input, { backgroundColor: colors.input, color: colors.foreground, borderColor: colors.border }]}
              value={password}
              onChangeText={setPassword}
              placeholder="비밀번호 (8자 이상)"
              placeholderTextColor={colors.mutedForeground}
              secureTextEntry
            />
            {errors?.fields?.password ? (
              <Text style={[styles.error, { color: colors.destructive }]}>{errors.fields.password.message}</Text>
            ) : null}
          </View>

          <Pressable
            style={({ pressed }) => [
              styles.button,
              { backgroundColor: colors.primary, opacity: !email || !password || fetchStatus === "fetching" || pressed ? 0.7 : 1 },
            ]}
            onPress={handleSignUp}
            disabled={!email || !password || fetchStatus === "fetching"}
          >
            {fetchStatus === "fetching" ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={[styles.buttonText, { color: colors.primaryForeground }]}>계속하기</Text>
            )}
          </Pressable>
        </View>

        <View style={styles.footer}>
          <Text style={[styles.footerText, { color: colors.mutedForeground }]}>이미 계정이 있나요? </Text>
          <Link href="/(auth)/sign-in" asChild>
            <Pressable>
              <Text style={[styles.footerLink, { color: colors.primary }]}>로그인</Text>
            </Pressable>
          </Link>
        </View>
        <View nativeID="clerk-captcha" />
        <LegalLinks color={colors.primary} />
      </CustomScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flexGrow: 1, paddingHorizontal: 24, gap: 28 },
  header: { alignItems: "center", gap: 12 },
  title: { fontSize: 28, fontFamily: "Inter_700Bold" },
  subtitle: { fontSize: 15, fontFamily: "Inter_400Regular", textAlign: "center" },
  form: { gap: 16 },
  label: { fontSize: 14, fontFamily: "Inter_500Medium", marginBottom: 6 },
  input: { height: 52, borderRadius: 12, paddingHorizontal: 16, fontSize: 15, fontFamily: "Inter_400Regular", borderWidth: 1 },
  error: { fontSize: 12, fontFamily: "Inter_400Regular", marginTop: 4 },
  button: { height: 52, borderRadius: 14, alignItems: "center", justifyContent: "center" },
  buttonText: { fontSize: 16, fontFamily: "Inter_600SemiBold" },
  resend: { fontSize: 14, fontFamily: "Inter_500Medium", textAlign: "center" },
  footer: { flexDirection: "row", justifyContent: "center", alignItems: "center" },
  footerText: { fontSize: 14, fontFamily: "Inter_400Regular" },
  footerLink: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
});
