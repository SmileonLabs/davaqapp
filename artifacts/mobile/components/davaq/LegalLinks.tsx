import React from "react";
import { Alert, Linking, Platform, Pressable, Text, View } from "react-native";
import { DAVAQ_LEGAL_LINK_ERROR, DAVAQ_LEGAL_URLS } from "@/lib/davaqLegal";

export function LegalLinks({ color }: { color: string }) {
  if (Platform.OS !== "android") return null;
  const links = [
    ["개인정보처리방침", DAVAQ_LEGAL_URLS.privacy],
    ["계정·데이터 삭제 요청", DAVAQ_LEGAL_URLS.accountDeletion],
  ];
  return (
    <View style={{ flexDirection: "row", flexWrap: "wrap", justifyContent: "center", gap: 16 }}>
      {links.map(([label, url]) => (
        <Pressable key={url} accessibilityRole="link" style={{ paddingVertical: 12 }}
          onPress={() => { void Linking.openURL(url)
            .catch(() => Alert.alert("안내", DAVAQ_LEGAL_LINK_ERROR)); }}>
          <Text style={{ color, fontSize: 13, textDecorationLine: "underline" }}>{label}</Text>
        </Pressable>
      ))}
    </View>
  );
}
