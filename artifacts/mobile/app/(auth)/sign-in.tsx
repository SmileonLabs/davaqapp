import { CustomScrollView } from "@/components/CustomScroll";
import { useSignIn } from "@clerk/expo";
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

function authErrorMessage(error: unknown): string {
  if (error && typeof error === "object") {
    const err = error as {
      message?: string;
      longMessage?: string;
      long_message?: string;
      errors?: Array<{ message?: string; longMessage?: string; long_message?: string }>;
    };
    const first = err.errors?.[0];
    return (
      first?.longMessage ??
      first?.long_message ??
      first?.message ??
      err.longMessage ??
      err.long_message ??
      err.message ??
      "로그인 요청에 실패했어요. 잠시 후 다시 시도해 주세요."
    );
  }
  return "로그인 요청에 실패했어요. 잠시 후 다시 시도해 주세요.";
}

export default function SignInScreen() {
  const { signIn, errors, fetchStatus } = useSignIn();
  const router = useRouter();
  const colors = useColors();
  const { scheme } = useThemeMode();
  const insets = useSafeAreaInsets();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [formError, setFormError] = useState<string | null>(null);

  const handleSignIn = async () => {
    setFormError(null);
    try {
      const { error } = await signIn.password({ identifier: email.trim(), password });
      if (error) {
        setFormError(authErrorMessage(error));
        return;
      }

      if (signIn.status === "complete") {
        await signIn.finalize({
          navigate: ({ session, decorateUrl }) => {
            if (session?.currentTask) return;
            const url = decorateUrl("/");
            if (url.startsWith("http")) {
              if (typeof window !== "undefined") window.location.href = url;
            } else {
              router.replace(url as Href);
            }
          },
        });
        return;
      }

      if (signIn.status === "needs_client_trust") {
        const emailCodeFactor = signIn.supportedSecondFactors?.find(
          (f) => f.strategy === "email_code",
        );
        if (emailCodeFactor) {
          await signIn.mfa.sendEmailCode();
          return;
        }
      }

      setFormError(`로그인을 완료하지 못했어요. 현재 상태: ${signIn.status ?? "unknown"}`);
    } catch (err) {
      setFormError(authErrorMessage(err));
    }
  };

  const handleVerify = async () => {
    setFormError(null);
    try {
      await signIn.mfa.verifyEmailCode({ code });
      if (signIn.status === "complete") {
        await signIn.finalize({
          navigate: ({ session, decorateUrl }) => {
            if (session?.currentTask) return;
            const url = decorateUrl("/");
            if (url.startsWith("http")) {
              if (typeof window !== "undefined") window.location.href = url;
            } else {
              router.replace(url as Href);
            }
          },
        });
      } else {
        setFormError(`인증을 완료하지 못했어요. 현재 상태: ${signIn.status ?? "unknown"}`);
      }
    } catch (err) {
      setFormError(authErrorMessage(err));
    }
  };

  if (signIn.status === "needs_client_trust") {
    return (
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : "height"} style={{ flex: 1 }}>
        <View
          style={[styles.container, { backgroundColor: colors.background, paddingTop: insets.top + 40, paddingBottom: insets.bottom + 20 }]}
        >
          <Text style={[styles.title, { color: colors.foreground }]}>인증 코드 확인</Text>
          <Text style={[styles.subtitle, { color: colors.mutedForeground }]}>
            이메일로 전송된 코드를 입력해주세요
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
          {formError ? (
            <Text style={[styles.error, { color: colors.destructive }]}>{formError}</Text>
          ) : null}
          <Pressable
            style={({ pressed }) => [styles.button, { backgroundColor: colors.primary, opacity: pressed ? 0.85 : 1 }]}
            onPress={handleVerify}
            disabled={fetchStatus === "fetching"}
          >
            {fetchStatus === "fetching" ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={[styles.buttonText, { color: colors.primaryForeground }]}>확인</Text>
            )}
          </Pressable>
          <Pressable onPress={() => signIn.mfa.sendEmailCode()}>
            <Text style={[styles.resend, { color: colors.primary }]}>코드 재전송</Text>
          </Pressable>
          <Pressable onPress={() => signIn.reset()}>
            <Text style={[styles.resend, { color: colors.mutedForeground }]}>처음으로</Text>
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    );
  }

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === "ios" ? "padding" : "height"}
      style={{ flex: 1 }}
    >
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
          <Text style={[styles.subtitle, { color: colors.mutedForeground }]}>
            계속하려면 로그인하세요
          </Text>
        </View>

        <View style={styles.form}>
          <View>
            <Text style={[styles.label, { color: colors.foreground }]}>이메일 또는 아이디</Text>
            <TextInput
              style={[styles.input, { backgroundColor: colors.input, color: colors.foreground, borderColor: colors.border }]}
              value={email}
              onChangeText={setEmail}
              placeholder="이메일 주소 또는 아이디"
              placeholderTextColor={colors.mutedForeground}
              keyboardType="email-address"
              autoCapitalize="none"
              autoComplete="username"
            />
            {errors?.fields?.identifier ? (
              <Text style={[styles.error, { color: colors.destructive }]}>{errors.fields.identifier.message}</Text>
            ) : null}
          </View>
          <View>
            <Text style={[styles.label, { color: colors.foreground }]}>비밀번호</Text>
            <TextInput
              style={[styles.input, { backgroundColor: colors.input, color: colors.foreground, borderColor: colors.border }]}
              value={password}
              onChangeText={setPassword}
              placeholder="비밀번호"
              placeholderTextColor={colors.mutedForeground}
              secureTextEntry
              autoComplete="password"
            />
            {errors?.fields?.password ? (
              <Text style={[styles.error, { color: colors.destructive }]}>{errors.fields.password.message}</Text>
            ) : null}
          </View>

          {formError ? (
            <Text style={[styles.error, { color: colors.destructive }]}>{formError}</Text>
          ) : null}

          <Link href="/(auth)/forgot-password" asChild>
            <Pressable>
              <Text style={[styles.forgot, { color: colors.primary }]}>비밀번호를 잊으셨나요?</Text>
            </Pressable>
          </Link>

          <Pressable
            style={({ pressed }) => [
              styles.button,
              { backgroundColor: colors.primary, opacity: !email.trim() || !password || fetchStatus === "fetching" || pressed ? 0.7 : 1 },
            ]}
            onPress={handleSignIn}
            disabled={!email.trim() || !password || fetchStatus === "fetching"}
          >
            {fetchStatus === "fetching" ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={[styles.buttonText, { color: colors.primaryForeground }]}>로그인</Text>
            )}
          </Pressable>
        </View>

        <View style={styles.footer}>
          <Text style={[styles.footerText, { color: colors.mutedForeground }]}>계정이 없으신가요? </Text>
          <Link href="/(auth)/sign-up" asChild>
            <Pressable>
              <Text style={[styles.footerLink, { color: colors.primary }]}>회원가입</Text>
            </Pressable>
          </Link>
        </View>
      </CustomScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flexGrow: 1, paddingHorizontal: 24, gap: 32 },
  header: { alignItems: "center", gap: 12 },
  title: { fontSize: 28, fontFamily: "Inter_700Bold" },
  subtitle: { fontSize: 15, fontFamily: "Inter_400Regular" },
  form: { gap: 16 },
  label: { fontSize: 14, fontFamily: "Inter_500Medium", marginBottom: 6 },
  input: { height: 52, borderRadius: 12, paddingHorizontal: 16, fontSize: 15, fontFamily: "Inter_400Regular", borderWidth: 1 },
  error: { fontSize: 12, fontFamily: "Inter_400Regular", marginTop: 4 },
  forgot: { fontSize: 14, fontFamily: "Inter_500Medium", textAlign: "right" },
  button: { height: 52, borderRadius: 14, alignItems: "center", justifyContent: "center" },
  buttonText: { fontSize: 16, fontFamily: "Inter_600SemiBold" },
  resend: { fontSize: 14, fontFamily: "Inter_500Medium", textAlign: "center" },
  footer: { flexDirection: "row", justifyContent: "center", alignItems: "center" },
  footerText: { fontSize: 14, fontFamily: "Inter_400Regular" },
  footerLink: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
});
