import React, { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Linking,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";
import { Image } from "expo-image";
import { searchGifs, type GifResult } from "@/lib/gifSearch";
import { useColors } from "@/hooks/useColors";
export function GifPicker({
  onSelect,
  busy,
  onPickLocal,
}: {
  onPickLocal?: () => void;
  onSelect: (gif: GifResult) => void;
  busy?: boolean;
}) {
  const c = useColors(),
    [query, setQuery] = useState(""),
    [items, setItems] = useState<GifResult[]>([]),
    [loading, setLoading] = useState(false),
    [error, setError] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    const timer = setTimeout(() => {
      setLoading(true);
      setError("");
      searchGifs(query, controller.signal)
        .then((value) => {
          if (!controller.signal.aborted) setItems(value);
        })
        .catch(() => {
          if (!controller.signal.aborted)
            setError("검색하지 못했어요. 검색어를 바꿔 다시 시도해 주세요.");
        })
        .finally(() => {
          if (!controller.signal.aborted) setLoading(false);
        });
    }, 350);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [query]);
  return (
    <View style={{ padding: 10, backgroundColor: c.card }}>
      <Pressable
        accessibilityRole="button"
        onPress={onPickLocal}
        disabled={busy}
      >
        <Text style={{ color: c.primary, paddingBottom: 8 }}>
          기기에서 GIF 선택
        </Text>
      </Pressable>
      <TextInput
        maxLength={80}
        value={query}
        onChangeText={setQuery}
        placeholder="GIF 검색 (cat, dance, happy…)"
        accessibilityLabel="GIF 검색"
        style={{
          color: c.foreground,
          backgroundColor: c.muted,
          padding: 10,
          borderRadius: 10,
        }}
      />
      {loading || busy ? (
        <ActivityIndicator
          accessibilityLabel={busy ? "GIF 전송 준비 중" : "GIF 검색 중"}
        />
      ) : null}
      {error ? <Text style={{ color: c.foreground }}>{error}</Text> : null}
      <ScrollView
        style={{ height: 220 }}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ flexDirection: "row", flexWrap: "wrap" }}
      >
        {items.map((gif) => (
          <View key={gif.id} style={{ width: "50%", padding: 4 }}>
            <Pressable
              disabled={busy}
              accessibilityLabel={gif.title + " GIF 보내기"}
              onPress={() => onSelect(gif)}
            >
              <Image
                source={{ uri: gif.url }}
                autoplay
                contentFit="contain"
                style={{ height: 100, width: "100%" }}
              />
              <Text
                numberOfLines={1}
                style={{ color: c.foreground, fontSize: 11 }}
              >
                {gif.title}
              </Text>
            </Pressable>
            <Text
              onPress={() => void Linking.openURL(gif.source)}
              accessibilityRole="link"
              style={{ color: c.primary, fontSize: 10 }}
            >
              {gif.license} · 출처
            </Text>
          </View>
        ))}
        {!loading && !error && !items.length ? (
          <Text style={{ color: c.mutedForeground }}>
            검색 결과가 없어요. 다른 검색어를 입력해 주세요.
          </Text>
        ) : null}
      </ScrollView>
      <Text style={{ color: c.mutedForeground, fontSize: 10 }}>
        Wikimedia Commons · 검색어가 공급자에 전송됩니다.
      </Text>
    </View>
  );
}
