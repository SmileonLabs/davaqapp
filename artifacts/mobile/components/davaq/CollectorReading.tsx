import React, { memo, useState } from "react";
import { View, Text, Pressable, ScrollView, Linking } from "react-native";
import { useQuery } from "@tanstack/react-query";
import { customFetch } from "@workspace/api-client-react";
import { useColors } from "@/hooks/useColors";
const LOUNGE = "00000000-0000-4000-8000-00000000c100";
type Item = {
  id: string;
  kind: string;
  title: string;
  facts: string[];
  url: string;
  sourceLabel: string;
  region: string;
  publishedAt?: string;
  checkedAt: string;
};
type Digest = {
  day: string;
  items: Item[];
  market: {
    reason: string;
    observation?: {
      name: string;
      fromDate: string;
      toDate: string;
      from: number;
      to: number;
      changePercent: number;
      conditionLabel: string;
      observedAt?: string;
      sourceLabel: string;
      url: string;
    };
  };
};
const labels: Record<string, string> = {
  official_news: "공식 소식",
  card: "오늘의 카드",
  collector_basics: "수집가 잡학",
};
const hosts = new Set([
  "onepiece-cardgame.kr",
  "www.pokemon-card.com",
  "help.tcgplayer.com",
  "davaq.app",
]);
export const CollectorReading = memo(function CollectorReading({
  roomId,
}: {
  roomId: string;
}) {
  const c = useColors();
  const [open, setOpen] = useState(false);
  const info = useQuery({
    queryKey: ["collector-lounge"],
    queryFn: () =>
      customFetch<{ presentation?: { readingEnabled?: boolean } }>(
        "/api/collector-lounge",
        { responseType: "json" },
      ),
    enabled: roomId === LOUNGE,
    staleTime: 15000,
    refetchInterval: 30000,
    retry: false,
  });
  const readingEnabled =
    roomId === LOUNGE && info.data?.presentation?.readingEnabled === true;
  const q = useQuery({
    queryKey: ["collector-reading"],
    queryFn: () =>
      customFetch<Digest>("/api/collector-lounge/reading", {
        responseType: "json",
      }),
    enabled: readingEnabled,
    staleTime: 15 * 60000,
    refetchInterval: 15 * 60000,
    retry: false,
  });
  if (!readingEnabled) return null;
  const visit = (url: string) => {
    try {
      const u = new URL(url);
      if (
        u.protocol === "https:" &&
        hosts.has(u.hostname) &&
        !u.username &&
        !u.password &&
        !u.port
      )
        void Linking.openURL(url).catch(() => {});
    } catch {}
  };
  return (
    <View
      style={{
        backgroundColor: c.background,
        borderBottomWidth: 1,
        borderBottomColor: c.muted,
      }}
    >
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        accessibilityLabel={
          open ? "오늘 읽을 거리 접기" : "오늘 읽을 거리 펼치기"
        }
        onPress={() => setOpen((v) => !v)}
        style={{
          minHeight: 44,
          paddingHorizontal: 16,
          paddingVertical: 12,
          flexDirection: "row",
          justifyContent: "space-between",
          gap: 8,
        }}
      >
        <Text style={{ color: c.foreground, fontWeight: "600" }}>
          오늘 읽을 거리
          {q.data?.items.length ? " · " + q.data.items.length : ""}
        </Text>
        <Text style={{ color: c.mutedForeground }}>
          {open ? "접기" : "펼치기"}
        </Text>
      </Pressable>
      {open ? (
        <ScrollView
          style={{ maxHeight: 250 }}
          contentContainerStyle={{
            paddingHorizontal: 16,
            paddingBottom: 14,
            gap: 12,
          }}
          nestedScrollEnabled
        >
          {q.isPending ? (
            <Text style={{ color: c.mutedForeground }}>
              읽을 거리를 확인하고 있어요.
            </Text>
          ) : q.isError || !q.data?.items.length ? (
            <Text style={{ color: c.mutedForeground }}>
              지금 확인할 수 있는 읽을 거리가 없어요. 잠시 후 다시 열어 주세요.
            </Text>
          ) : (
            <>
              <Text style={{ color: c.mutedForeground, fontSize: 12 }}>
                {q.data.day} · 공식 소식과 수집 상식
              </Text>
              {q.data.items.map((item) => (
                <View
                  key={item.id}
                  style={{
                    backgroundColor: c.muted,
                    borderRadius: 12,
                    padding: 12,
                    gap: 5,
                  }}
                >
                  <Text
                    style={{
                      color: c.primary,
                      fontSize: 12,
                      fontWeight: "600",
                    }}
                  >
                    {labels[item.kind] ?? "읽을 거리"}
                    {item.kind === "official_news" ? " · " + item.region : ""}
                  </Text>
                  <Text
                    style={{
                      color: c.foreground,
                      fontWeight: "600",
                      lineHeight: 21,
                    }}
                  >
                    {item.title}
                  </Text>
                  {item.kind !== "official_news"
                    ? item.facts
                        .filter(
                          (f) =>
                            !f.startsWith("카드 이름:") &&
                            !f.startsWith("카탈로그 지역 표기:"),
                        )
                        .slice(0, 2)
                        .map((fact, i) => (
                          <Text
                            key={i}
                            style={{
                              color: c.foreground,
                              fontSize: 13,
                              lineHeight: 20,
                            }}
                          >
                            {fact}
                          </Text>
                        ))
                    : null}
                  <Pressable
                    accessibilityRole="link"
                    accessibilityLabel={item.title + " 출처 열기"}
                    onPress={() => visit(item.url)}
                    style={{ paddingVertical: 5 }}
                  >
                    <Text style={{ color: c.primary, fontSize: 12 }}>
                      {item.sourceLabel}
                      {item.publishedAt ? " · " + item.publishedAt : ""} ↗
                    </Text>
                  </Pressable>
                </View>
              ))}
              <Text
                style={{
                  color: c.mutedForeground,
                  fontSize: 12,
                  lineHeight: 18,
                }}
              >
                {q.data.market.reason}
              </Text>
              {q.data.market.observation ? (
                <View
                  style={{
                    backgroundColor: c.muted,
                    borderRadius: 12,
                    padding: 12,
                    gap: 5,
                  }}
                >
                  <Text style={{ color: c.foreground, fontWeight: "600" }}>
                    판매 호가 관측 · {q.data.market.observation.name}
                  </Text>
                  <Text style={{ color: c.mutedForeground, fontSize: 12 }}>
                    {q.data.market.observation.fromDate} →{" "}
                    {q.data.market.observation.toDate}
                  </Text>
                  <Text style={{ color: c.foreground, fontSize: 13 }}>
                    {q.data.market.observation.from.toLocaleString("ko-KR")}원 →{" "}
                    {q.data.market.observation.to.toLocaleString("ko-KR")}원 (
                    {q.data.market.observation.changePercent > 0 ? "+" : ""}
                    {q.data.market.observation.changePercent}%)
                  </Text>
                  <Text style={{ color: c.mutedForeground, fontSize: 12 }}>
                    {q.data.market.observation.conditionLabel}
                  </Text>
                  {q.data.market.observation.observedAt ? (
                    <Text style={{ color: c.mutedForeground, fontSize: 12 }}>
                      관측 시각:{" "}
                      {new Date(
                        new Date(
                          q.data.market.observation.observedAt,
                        ).getTime() +
                          9 * 3600000,
                      )
                        .toISOString()
                        .slice(0, 16)
                        .replace("T", " ")}{" "}
                      (한국시간)
                    </Text>
                  ) : null}
                  <Pressable
                    accessibilityRole="link"
                    accessibilityLabel="판매 호가 원문 차트 열기"
                    onPress={() => visit(q.data!.market.observation!.url)}
                    style={{ paddingVertical: 5 }}
                  >
                    <Text style={{ color: c.primary, fontSize: 12 }}>
                      {q.data.market.observation.sourceLabel} ↗
                    </Text>
                  </Pressable>
                </View>
              ) : null}
            </>
          )}
        </ScrollView>
      ) : null}
    </View>
  );
});
