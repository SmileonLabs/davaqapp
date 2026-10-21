import React, { useEffect, useRef, useState } from "react";
import { ActivityIndicator, AppState, Platform, Pressable, StyleSheet, Text, View } from "react-native";
import * as WebBrowser from "expo-web-browser";
import { useRouter } from "expo-router";
import { startSocial, useAuth, waitForSocialCompletion } from "@/lib/davaqAuth";
import { getApiBase } from "@/lib/apiBase";
export async function loadSocialProviders(signal: AbortSignal) {
  const response = await fetch(`${getApiBase()}/api/auth/social/providers`, { signal });
  if (!response.ok) throw new Error("로그인 서비스에 연결하지 못했어요.");
  const value = await response.json();
  if (typeof value.google !== "boolean" || typeof value.apple !== "boolean") throw new Error("로그인 정보를 확인하지 못했어요.");
  return { google: value.google, apple: value.apple };
}
export function SocialLoginButtons({ link = false }: { link?: boolean }) {
  const auth = useAuth(), router = useRouter(), lock = useRef(false);
  const lifecycle = useRef(new AbortController());
  const [busy, setBusy] = useState(false), [notice, setNotice] = useState("");
  const [ready, setReady] = useState({ google: false, apple: false });
  const [providerError, setProviderError] = useState("");
  const [providerLoading, setProviderLoading] = useState(true);
  const [providerRequest, setProviderRequest] = useState(0);
  useEffect(() => {
    let live = true;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);
    setProviderLoading(true); setProviderError("");
    void loadSocialProviders(controller.signal).then(value => {
      if (!live) return;
      setReady(value);
      if (!value.google && !value.apple) setProviderError("로그인 서비스가 준비되지 않았어요. 잠시 후 다시 확인해 주세요.");
    }).catch(() => { if (live) setProviderError("로그인 서비스에 연결하지 못했어요. 네트워크를 확인하고 다시 시도해 주세요."); })
      .finally(() => { clearTimeout(timeout); if (live) setProviderLoading(false); });
    return () => { live = false; clearTimeout(timeout); controller.abort(); };
  }, [providerRequest]);
  async function check(showIncomplete = false) {
    const signal = lifecycle.current.signal;
    try {
      const done = await waitForSocialCompletion({ signal });
      if (signal.aborted) return;
      if (done) router.replace("/");
      else if (showIncomplete) setNotice("인증이 아직 완료되지 않았어요. 로그인 결과를 다시 확인하거나 로그인을 다시 시작해 주세요.");
    } catch (e: any) { if (!signal.aborted) setNotice(e.message); }
  }
  useEffect(() => {
    lifecycle.current = new AbortController();
    const sub = AppState.addEventListener("change", state => { if (state === "active") void check(); });
    return () => { lifecycle.current.abort(); sub.remove(); };
  }, []);
  async function start(provider: "google" | "apple") {
    if (lock.current) return;
    const signal = lifecycle.current.signal;
    lock.current = true; setBusy(true); setNotice("");
    try {
      const token = link ? await auth.getToken() : null;
      if (signal.aborted) return;
      if (link && !token) throw new Error("기존 계정으로 먼저 로그인해 주세요.");
      const url = await startSocial(provider, token, { signal });
      if (signal.aborted) return;
      if (Platform.OS === "web") { window.location.assign(url); return; }
      await WebBrowser.openAuthSessionAsync(url, "davaq://sso-callback");
      await check(true);
    } catch (e: any) { if (!signal.aborted) setNotice(e.message || "로그인을 완료하지 못했어요."); }
    finally { lock.current = false; if (!signal.aborted) setBusy(false); }
  }
  return <View style={styles.group}>
    {(["google", "apple"] as const).map(provider => <Pressable key={provider} accessibilityRole="button" disabled={!auth.isLoaded || busy || !ready[provider]}
      onPress={() => void start(provider)} style={({ pressed }) => [styles.button, provider === "apple" && styles.apple, (pressed || busy || !ready[provider]) && { opacity: 0.55 }]}>
      {busy ? <ActivityIndicator color={provider === "apple" ? "#fff" : "#111"} /> : <Text style={[styles.label, provider === "apple" && { color: "#fff" }]}>{provider === "google" ? "Google" : "Apple"}{link ? " 계정 연결" : "로 계속하기"}{!ready[provider] ? " · 준비 중" : ""}</Text>}
    </Pressable>)}
    <Text style={styles.help}>{link ? "SNS를 현재 계정에 연결합니다. 카드와 채팅 기록은 그대로 유지됩니다." : "같은 이메일의 기존 계정은 그대로 이어집니다. Apple 이메일 숨기기는 다른 주소이므로, 기존 계정에 로그인한 뒤 내 설정에서 연결해 주세요."}</Text>
    {!!providerError && <View style={{ gap: 8 }}><Text accessibilityRole="alert" style={styles.notice}>{providerError}</Text><Pressable accessibilityRole="button" disabled={providerLoading} onPress={() => setProviderRequest(value => value + 1)}><Text style={styles.retry}>{providerLoading ? "로그인 연결 확인 중" : "로그인 연결 다시 확인"}</Text></Pressable></View>}
    <Pressable onPress={() => void check(true)} accessibilityRole="button"><Text style={styles.help}>인증 결과 다시 확인</Text></Pressable>
    {!!notice && <Text accessibilityRole="alert" style={styles.notice}>{notice}</Text>}
  </View>;
}
const styles = StyleSheet.create({group: { gap: 12 }, button: { height: 52, backgroundColor: "#fff", borderColor: "#ddd", borderWidth: 1, borderRadius: 12, alignItems: "center", justifyContent: "center" }, apple: { backgroundColor: "#000", borderColor: "#000" }, label: { fontSize: 16, fontWeight: "600", color: "#111" }, help: { fontSize: 12, lineHeight: 19, color: "#777" }, notice: { fontSize: 13, lineHeight: 20, color: "#b42318" }, retry: { fontSize: 14, fontWeight: "600", color: "#6544E8", paddingVertical: 10, textAlign: "center" }});
