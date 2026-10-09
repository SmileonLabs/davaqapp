import React from "react";
import { Alert, Linking, Platform, Pressable, Text, View } from "react-native";

export function LegalLinks({ color }: { color: string }) {
  if (Platform.OS !== "android") return null;
  const links = [
    ["개인정보처리방침", "privacy.html"],
    ["계정·데이터 삭제 요청", "delete-account.html"],
  ];
  return (
    <View style={{ flexDirection: "row", flexWrap: "wrap", justifyContent: "center", gap: 16 }}>
      {links.map(([label, page]) => (
        <Pressable key={page} accessibilityRole="link" style={{ paddingVertical: 12 }}
          onPress={() => { void Linking.openURL("https://smileonlabs.github.io/davaqapp/" + page)
            .catch(() => Alert.alert("안내", "안내 페이지를 열지 못했어요. contact@smileon.app으로 문의해 주세요.")); }}>
          <Text style={{ color, fontSize: 13, textDecorationLine: "underline" }}>{label}</Text>
        </Pressable>
      ))}
    </View>
  );
}
