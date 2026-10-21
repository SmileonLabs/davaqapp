import React, { useState, useCallback } from "react";
import { View, Pressable, Text } from "react-native";
import { useRouter, useLocalSearchParams } from "expo-router";
import {
  shopScanContext,
  shopScanHref,
  validShopScanCard,
} from "@/lib/shopScan";
import { useFocusEffect } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ScannerScreen } from "../../tcgindex-scanner/mobile/src/app/ScannerScreen";
import { cardLink } from "@/lib/tcg";
export function LiveScanScreen() {
  const context = shopScanContext(useLocalSearchParams());
  const router = useRouter(),
    insets = useSafeAreaInsets();
  const [focused, setFocused] = useState(true);
  useFocusEffect(
    useCallback(() => {
      setFocused(true);
      return () => setFocused(false);
    }, []),
  );
  const [diagnostics, setDiagnostics] = useState(false);
  if (!focused) return <View style={{ flex: 1, backgroundColor: "#090909" }} />;
  return (
    <View
      style={{
        flex: 1,
        paddingTop: insets.top,
        paddingBottom: insets.bottom,
        backgroundColor: "#090909",
      }}
    >
      <ScannerScreen
        diagnostics={diagnostics}
        onDiagnostics={setDiagnostics}
        onClose={() =>
          router.replace((context ? shopScanHref(context) : "/(tabs)") as any)
        }
        onMyCards={() =>
          router.push(
            (context
              ? `/shop/${context.shopId}?quoteId=${context.quoteId}`
              : "/(tabs)/exchanges") as any,
          )
        }
        onOpenCard={(_href, id, _number, _game, _market, name) => {
          if (context && validShopScanCard(id)) {
            router.replace(shopScanHref(context, id) as any);
            return;
          }
          if (context) {
            router.replace(shopScanHref(context) as any);
            return;
          }
          if (id) router.push(cardLink(id, name ?? ""));
          else router.push("/tcg/catalog" as any);
        }}
      />
      <Pressable
        accessibilityRole="button"
        onPress={() =>
          router.replace(
            (context ? shopScanHref(context) : "/tcg/catalog") as any,
          )
        }
        style={{
          padding: 12,
          alignItems: "center",
          backgroundColor: "#151515",
        }}
      >
        <Text style={{ color: "white", fontWeight: "600" }}>
          카드 이름으로 검색
        </Text>
      </Pressable>
    </View>
  );
}
