import React from "react";
import { View, Text, Pressable } from "react-native";
import { useRouter } from "expo-router";
import { CardArt } from "@/components/tcg/Cards";
import { useDavaq, type Detail } from "@/lib/tcg";
import { useColors } from "@/hooks/useColors";
export function CollectorCardAttachment({ id }: { id: string }) {
  const c = useColors();
  const r = useRouter();
  const q = useDavaq<Detail>(
    "/tcg/catalog/detail?id=" + encodeURIComponent(id),
  );
  if (!q.data) return null;
  const t = q.data.target;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={t.name + " 카드 상세"}
      onPress={() =>
        r.push(("/tcg/card/detail?id=" + encodeURIComponent(id)) as never)
      }
      style={{
        margin: 12,
        padding: 12,
        borderRadius: 14,
        backgroundColor: c.muted,
        alignSelf: "flex-start",
        width: 190,
      }}
    >
      <View style={{ width: "100%", aspectRatio: 63 / 88, flexShrink: 0 }}>
        <CardArt src={t.imageSrc} catalog large />
      </View>
      <Text style={{ color: c.foreground, fontWeight: "600", marginTop: 10 }}>
        {t.name}
      </Text>
      <Text style={{ color: c.mutedForeground, fontSize: 12, marginTop: 5 }}>
        {[t.game, t.number, t.region].filter(Boolean).join(" · ")}
      </Text>
    </Pressable>
  );
}
