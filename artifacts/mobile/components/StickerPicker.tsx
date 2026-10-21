import React, { useMemo, useRef, useState } from "react";
import {
  Linking,
  Animated,
  Platform,
  PanResponder,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useReducedMotion } from "react-native-reanimated";
import { ANIMATED_STICKERS } from "@/constants/animatedStickers";
import { stickerPage, STICKER_PAGE_SIZE } from "@/lib/stickerPickerPolicy";
import { StickerImage } from "./StickerImage";
import { useColors } from "@/hooks/useColors";

const categories = [
  "전체",
  ...new Set(ANIMATED_STICKERS.map((item) => item.category)),
];
export function StickerPicker({
  onSelect,
}: {
  onSelect: (code: string, origin?: { x: number; y: number }) => void;
}) {
  const colors = useColors();
  const reducedMotion = useReducedMotion();
  const [category, setCategory] = useState("전체"),
    [query, setQuery] = useState(""),
    [page, setPage] = useState(0);
  const result = useMemo(
    () => stickerPage(ANIMATED_STICKERS, category, query, page),
    [category, query, page],
  );
  const offset = useRef(new Animated.Value(0)).current;
  const [pageWidth, setPageWidth] = useState(320);
  const changing = useRef(false);
  const changePage = (next: number) => {
    next = Math.max(0, Math.min(result.pages - 1, next));
    if (changing.current) return;
    changing.current = true;
    Animated.timing(offset, {
      toValue: (result.page - next) * pageWidth,
      duration: reducedMotion ? 0 : 180,
      useNativeDriver: Platform.OS !== "web",
    }).start(({ finished }) => {
      if (finished) setPage(next);
      offset.setValue(0);
      changing.current = false;
    });
  };
  const swipe = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponderCapture: (_, g) =>
          Math.abs(g.dx) > 14 && Math.abs(g.dx) > Math.abs(g.dy) * 1.5,
        onMoveShouldSetPanResponder: (_, g) =>
          Math.abs(g.dx) > 14 && Math.abs(g.dx) > Math.abs(g.dy) * 1.5,
        onPanResponderMove: (_, g) => {
          const blocked =
            (result.page === 0 && g.dx > 0) ||
            (result.page === result.pages - 1 && g.dx < 0);
          offset.setValue(
            Math.max(
              -pageWidth,
              Math.min(pageWidth, g.dx * (blocked ? 0.18 : 1)),
            ),
          );
        },
        onPanResponderTerminate: () => changePage(result.page),
        onPanResponderRelease: (_, g) => {
          if (Math.abs(g.dx) >= 48 && Math.abs(g.dx) > Math.abs(g.dy) * 1.5)
            changePage(result.page + (g.dx < 0 ? 1 : -1));
          else changePage(result.page);
        },
      }),
    [result.page, result.pages, pageWidth, reducedMotion],
  );
  const button = (title: string, onPress: () => void, disabled = false) => (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={title}
      disabled={disabled}
      onPress={onPress}
      style={{ padding: 6, opacity: disabled ? 0.35 : 1 }}
    >
      <Text style={{ color: colors.primary }}>{title}</Text>
    </Pressable>
  );
  return (
    <View
      style={[
        styles.wrap,
        { backgroundColor: colors.card, borderTopColor: colors.border },
      ]}
    >
      <TextInput
        accessibilityLabel="애니메이션 스티커 검색"
        placeholder="움직이는 스티커 검색"
        placeholderTextColor={colors.mutedForeground}
        value={query}
        onChangeText={(value) => {
          offset.stopAnimation();
          changing.current = false;
          setQuery(value);
          setPage(0);
        }}
        style={{
          height: 34,
          paddingHorizontal: 12,
          marginHorizontal: 8,
          borderRadius: 10,
          color: colors.foreground,
          backgroundColor: colors.muted,
        }}
      />
      <ScrollView
        horizontal
        style={{ flexGrow: 0 }}
        contentContainerStyle={{
          paddingHorizontal: 8,
          gap: 6,
          alignItems: "center",
        }}
        showsHorizontalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        {categories.map((name) => (
          <Pressable
            key={name}
            accessibilityRole="button"
            accessibilityLabel={name + " 스티커 분류"}
            accessibilityState={{ selected: category === name }}
            onPress={() => {
              offset.stopAnimation();
              changing.current = false;
              setCategory(name);
              setPage(0);
            }}
            style={{
              paddingHorizontal: 10,
              paddingVertical: 8,
              borderRadius: 14,
              backgroundColor:
                category === name ? colors.accent : "transparent",
            }}
          >
            <Text
              style={{
                color:
                  category === name ? colors.primary : colors.mutedForeground,
                fontSize: 12,
              }}
            >
              {name}
            </Text>
          </Pressable>
        ))}
      </ScrollView>
      <View
        onLayout={(event) => setPageWidth(event.nativeEvent.layout.width)}
        style={{ overflow: "hidden" }}
        {...swipe.panHandlers}
      >
        <Animated.View
          style={{
            flexDirection: "row",
            width: pageWidth * 3,
            marginLeft: -pageWidth,
            transform: [{ translateX: offset }],
          }}
        >
          {[-1, 0, 1].map((delta) => (
            <View key={delta} style={[styles.grid, { width: pageWidth }]}>
              {result.page + delta >= 0 && result.page + delta < result.pages
                ? stickerPage(
                    ANIMATED_STICKERS,
                    category,
                    query,
                    result.page + delta,
                  ).items.map((item) => (
                    <Pressable
                      key={item.code}
                      accessibilityElementsHidden={delta !== 0}
                      importantForAccessibility={
                        delta !== 0 ? "no-hide-descendants" : "auto"
                      }
                      disabled={delta !== 0}
                      accessibilityRole="button"
                      accessibilityLabel={item.label + " 움직이는 스티커"}
                      onPress={(event) =>
                        onSelect(
                          item.code,
                          event
                            ? {
                                x: event.nativeEvent.pageX - 27,
                                y: event.nativeEvent.pageY - 27,
                              }
                            : undefined,
                        )
                      }
                      style={({ pressed }) => [
                        styles.cell,
                        { opacity: pressed ? 0.5 : 1 },
                      ]}
                    >
                      <StickerImage
                        code={item.code}
                        size={54}
                        autoplay={delta === 0}
                      />
                    </Pressable>
                  ))
                : null}
            </View>
          ))}
        </Animated.View>
        {!result.total ? (
          <Text style={{ color: colors.mutedForeground, padding: 20 }}>
            검색 결과가 없어요.
          </Text>
        ) : null}
      </View>
      <View style={styles.pager}>
        {button("이전", () => changePage(result.page - 1), result.page === 0)}
        <Text
          accessibilityLiveRegion="polite"
          style={{ color: colors.mutedForeground, fontSize: 12 }}
        >
          {result.page + 1} / {result.pages} · {result.total}개
        </Text>
        {button(
          "다음",
          () => changePage(result.page + 1),
          (result.page + 1) * STICKER_PAGE_SIZE >= result.total,
        )}
      </View>
      <View style={{ flexDirection: "row", justifyContent: "center", gap: 6 }}>
        <Text
          onPress={() =>
            void Linking.openURL(
              "https://googlefonts.github.io/noto-emoji-animation/",
            )
          }
          accessibilityRole="link"
          style={{ fontSize: 10, color: colors.mutedForeground }}
        >
          Google Noto Animated Emoji
        </Text>
        <Text
          onPress={() =>
            void Linking.openURL("https://creativecommons.org/licenses/by/4.0/")
          }
          accessibilityRole="link"
          style={{ fontSize: 10, color: colors.mutedForeground }}
        >
          CC BY 4.0
        </Text>
      </View>
    </View>
  );
}
const styles = StyleSheet.create({
  wrap: {
    height: 318,
    paddingVertical: 6,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  grid: {
    flexDirection: "row",
    flexWrap: "wrap",
    paddingHorizontal: 8,
    height: 180,
  },
  cell: {
    width: "25%",
    height: 60,
    alignItems: "center",
    justifyContent: "center",
  },
  pager: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 10,
  },
});
