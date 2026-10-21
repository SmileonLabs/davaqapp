import React from "react";
import { StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { CustomScrollView } from "@/components/CustomScroll";
import { useColors } from "@/hooks/useColors";
import { SocialLoginButtons } from "@/components/davaq/SocialLoginButtons";

export default function SignInScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  return (
    <CustomScrollView contentContainerStyle={[styles.container, { backgroundColor: colors.background, paddingTop: insets.top + 48, paddingBottom: insets.bottom + 32 }]}>
      <View style={styles.header}>
        <Text style={[styles.brand, { color: colors.foreground }]}>DAVAQ</Text>
        <Text style={[styles.title, { color: colors.foreground }]}>Google·Apple로 계속하기</Text>
        <Text style={[styles.subtitle, { color: colors.mutedForeground }]}>가입할 때 사용한 이메일과 같은 계정을 선택해 주세요. 기존 카드와 채팅 기록을 그대로 이어갑니다.</Text>
      </View>
      <SocialLoginButtons />
    </CustomScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flexGrow: 1, justifyContent: "center", paddingHorizontal: 24, gap: 32 },
  header: { alignItems: "center", gap: 16 },
  brand: { fontSize: 40, fontWeight: "900", letterSpacing: -1.5 },
  title: { fontSize: 24, fontWeight: "700", textAlign: "center" },
  subtitle: { fontSize: 14, lineHeight: 22, textAlign: "center" },
});
