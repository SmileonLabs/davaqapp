import React, { useEffect, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { waitForSocialCompletion } from "@/lib/davaqAuth";
export default function SocialCallback() {
 const router = useRouter(), insets = useSafeAreaInsets();
 const [error, setError] = useState(""), [attempt, setAttempt] = useState(0);
 useEffect(() => {
   const controller = new AbortController();
   setError("");
   void waitForSocialCompletion({ signal: controller.signal }).then(done => {
     if (controller.signal.aborted) return;
     if (done) router.replace("/");
     else setError("로그인 요청을 확인하지 못했어요. 원래 로그인한 브라우저나 앱에서 다시 시도해 주세요.");
   }).catch(e => { if (!controller.signal.aborted) setError(e.message || "로그인을 완료하지 못했어요."); });
   return () => controller.abort();
 }, [attempt, router]);
 return <View style={[styles.container, {paddingTop: insets.top + 24, paddingBottom: insets.bottom + 24}]}>
   <Text style={styles.brand}>DAVAQ</Text>
   {error ? <>
     <Text accessibilityRole="alert" style={styles.message}>{error}</Text>
     <Pressable accessibilityRole="button" style={styles.button} onPress={() => setAttempt(value => value + 1)}><Text style={styles.buttonText}>인증 결과 다시 확인</Text></Pressable>
     <Pressable accessibilityRole="button" style={styles.back} onPress={() => router.replace("/(auth)/sign-in")}><Text style={styles.message}>로그인으로 돌아가기</Text></Pressable>
   </> : <><ActivityIndicator color="#111" accessibilityLabel="로그인 확인 중"/><Text style={styles.message}>로그인을 마무리하고 있어요.</Text></>}
 </View>;
}
const styles = StyleSheet.create({container:{flex:1,backgroundColor:"#fff",paddingHorizontal:24,alignItems:"center",justifyContent:"center",gap:20},brand:{fontSize:32,fontWeight:"900",color:"#111",letterSpacing:-1},message:{fontSize:15,lineHeight:23,color:"#444",textAlign:"center",maxWidth:400},button:{minHeight:48,paddingHorizontal:24,borderRadius:12,backgroundColor:"#111",justifyContent:"center"},buttonText:{color:"#fff",fontSize:15,fontWeight:"600"},back:{padding:14}});
