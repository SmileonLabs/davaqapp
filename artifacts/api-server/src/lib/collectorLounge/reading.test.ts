import { it, expect, vi, afterEach } from "vitest";
vi.mock("@workspace/db", () => ({
  pool: { query: vi.fn(async () => ({ rows: [] })) },
}));
vi.mock("../redis", () => ({ getRedis: () => null }));
import {
  parseOfficialNews,
  READING_SOURCES,
  buildReadingDigest,
  readingDay,
  selectReading,
  readingForQuestion,
  getReadingDigest,
  readingQuestion,
  readingForReply,
  extractOfficialFacts,
  type ReadingDigest,
} from "./reading";
import type { LoungeMessage } from "./policy";
const now = new Date("2026-10-19T15:10:00Z");
const html = (href = "topics/view.do?brdno=1", date = "2026-10-19") =>
  `<a href="${href}"><span class="tit">신제품 &amp; 사용 규정 공개</span><span class="date">${date}</span></a>`;
const news = parseOfficialNews(html(), READING_SOURCES[0], now)[0];
afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});
it("keeps official source, publication date and region distinct from fetch time", () => {
  expect(readingDay(now)).toBe("2026-10-20");
  expect(news).toMatchObject({
    kind: "official_news",
    publishedAt: "2026-10-19",
    region: "한국",
    title: "신제품 & 사용 규정 공개",
    url: "https://onepiece-cardgame.kr/topics/view.do?brdno=1",
  });
  expect(news.facts.join(" ")).toContain("확인되지 않음");
});
it("fails closed on external links, redirects, invalid dates, future and stale news", () => {
  for (const [url, date] of [
    ["https://evil.example/article", "2026-10-19"],
    ["https://onepiece-cardgame.kr.evil.example/x", "2026-10-19"],
    ["https://a:b@onepiece-cardgame.kr/x", "2026-10-19"],
    ["http://onepiece-cardgame.kr/x", "2026-10-19"],
    ["/x", "2026-10-21"],
    ["/x", "2025-01-01"],
    ["/x", "2026-02-31"],
  ])
    expect(parseOfficialNews(html(url, date), READING_SOURCES[0], now)).toEqual(
      [],
    );
});
it("extracts Japanese official headlines without presenting them as Korean releases", () => {
  const s =
    '<a href="/info/005001.html"><img alt="新商品の発売！"><div><span class="Date Date-small">2026.10.16</span></div></a>';
  expect(parseOfficialNews(s, READING_SOURCES[1], now)[0]).toMatchObject({
    region: "일본",
    title: "新商品の発売！",
    publishedAt: "2026-10-16",
  });
});
it("does not parse anchors hidden inside script markup and deduplicates repeated links", () => {
  const h = "<script>" + html("/fake") + "</script>" + html() + html();
  expect(parseOfficialNews(h, READING_SOURCES[0], now)).toHaveLength(1);
});
it("provides honest basics when official sources or catalog fail, never fabricated trends", async () => {
  const digest = await buildReadingDigest({
    now: () => now,
    read: async () => {
      throw Error("offline");
    },
    card: async () => {
      throw Error("offline");
    },
  });
  expect(digest.items).toHaveLength(1);
  expect(digest.items[0].kind).toBe("collector_basics");
  expect(digest.sources.every((s) => s.state === "unavailable")).toBe(true);
  expect(digest.market.state).toBe("unavailable");
  expect(JSON.stringify(digest)).not.toMatch(/상승률.*\d+%/);
});
it("includes only exact catalog identity and no private attributes or price snapshots", async () => {
  const digest = await buildReadingDigest({
    now: () => now,
    read: async () => html(),
    card: async () => ({
      state: "found",
      query: "",
      cards: [
        {
          id: "kream:42",
          name: "확인된 카드",
          source: "local_catalog",
          number: "001",
          checkedAt: now.toISOString(),
          url: "https://davaq.app/app/tcg/card/detail?id=kream%3A42",
        },
      ],
    }),
  });
  expect(digest.items).toHaveLength(3);
  expect(digest.items.find((i) => i.kind === "card")).toMatchObject({
    cardId: "kream:42",
    sourceLabel: "저장된 공개 카드 카탈로그",
  });
  expect(digest.items.find((i) => i.kind === "card")?.facts).toContain(
    "카드 번호: 001",
  );
});
const digest: ReadingDigest = {
  day: "2026-10-20",
  checkedAt: now.toISOString(),
  items: [
    news,
    {
      ...news,
      id: "basics:1",
      kind: "collector_basics",
      title: "호가와 실거래가",
      region: "일반",
    },
  ],
  sources: [],
  market: { state: "unavailable", reason: "없음" },
};
function message(
  id: string,
  n: number,
  content = "앞 발언",
  kind = "bot",
): LoungeMessage {
  return {
    id: String(n),
    sender_id: "ai",
    author_kind: kind,
    content,
    type: "text",
    room_seq: n,
    created_at: now,
    metadata: { collectorReadingId: id },
  };
}
it("continues sourced material for a bounded conversation then changes material instead of replaying it", () => {
  expect(selectReading(digest, [], now)?.id).toBe(news.id);
  const h = [message(news.id, 1), message(news.id, 2)];
  expect(selectReading(digest, h, now)?.id).toBe(news.id);
  h.push(message(news.id, 3));
  expect(selectReading(digest, h, now)?.id).toBe("basics:1");
  h.push(
    message("basics:1", 4),
    message("basics:1", 5),
    message("basics:1", 6),
  );
  expect(selectReading(digest, h, now)).toBeNull();
});
it("respects a member changing the topic and does not answer one game with another game news", () => {
  expect(
    selectReading(
      digest,
      [message("", 1, "카드 말고 일상 얘기 하자.", "user")],
      now,
    ),
  ).toBeNull();
  expect(readingForQuestion(digest, "요즘 포켓몬 카드 소식 알려줘")).toBeNull();
  expect(readingForQuestion(digest, "원피스 최신 소식")?.region).toBe("한국");
  expect(readingForQuestion(digest, "호가와 실거래 차이")?.kind).toBe(
    "collector_basics",
  );
  expect(readingQuestion("카드 시장 흐름이 궁금해")).toBe(true);
});
it("coalesces simultaneous refreshes and rolls over the Korean date without an AI call", async () => {
  vi.useFakeTimers();
  vi.setSystemTime(now);
  const fetcher = vi
    .spyOn(globalThis, "fetch")
    .mockImplementation(
      async () =>
        new Response(html(), { headers: { "content-type": "text/html" } }),
    );
  const a = await Promise.all([
    getReadingDigest(),
    getReadingDigest(),
    getReadingDigest(),
  ]);
  expect(fetcher).toHaveBeenCalledTimes(3);
  expect(a[0]).toBe(a[1]);
  await getReadingDigest();
  expect(fetcher).toHaveBeenCalledTimes(3);
  vi.setSystemTime(new Date("2026-10-20T15:10:00Z"));
  expect((await getReadingDigest()).day).toBe("2026-10-21");
  expect(fetcher).toHaveBeenCalledTimes(6);
});

it("extracts only the matching official article body, excluding navigation and next articles", () => {
  const detail =
    '<h1>신제품 &amp; 사용 규정 공개</h1><div class="pre_wrap"><p>신규 번호 카드는 특정 점포예선에서 정해진 날짜까지 사용할 수 없습니다.</p></div><div class="pagi_move_wrap"><p>이전 기사에서 모든 카드가 무료라고 주장하는 관련 없는 문장.</p></div>';
  expect(extractOfficialFacts(news, detail)).toHaveLength(1);
  expect(extractOfficialFacts(news, detail)[0]).not.toContain("무료");
  expect(extractOfficialFacts({ ...news, title: "다른 기사" }, detail)).toEqual(
    [],
  );
});

it("does not intercept an exact card price lookup and can answer other-game news outside the daily shortlist", () => {
  expect(readingQuestion("요즘 피카츄 카드 가격 얼마야?")).toBe(false);
  expect(readingQuestion("최신 포켓몬 카드 뉴스 알려줘")).toBe(true);
  const full = {
    ...digest,
    news: [
      {
        ...news,
        id: "pokemon:1",
        sourceLabel: "포켓몬 카드게임 일본 공식",
        region: "일본",
      },
    ],
  };
  expect(readingForQuestion(full, "포켓몬 카드 소식")?.region).toBe("일본");
  expect(
    readingForQuestion(
      { ...digest, items: [] },
      "호가랑 실거래가 차이",
    )?.facts.join(" "),
  ).toContain("완료 거래");
});

it("does not reintroduce yesterday official news as a new story after the short context window", () => {
  const previous = {
    ...message(news.id, 1),
    created_at: new Date(now.getTime() - 2 * 86400000),
  };
  expect(selectReading(digest, [previous], now)?.id).toBe("basics:1");
});

it("grounds a follow-up only in a known public source from this room, not an arbitrary pasted source", () => {
  expect(
    readingForReply(digest, "그럼 한국 기준이야?", [message(news.id, 1)])
      ?.region,
  ).toBe("한국");
  expect(
    readingForReply(digest, "그럼 한국 기준이야?", [
      message("https://evil.example", 1),
    ]),
  ).toBeNull();
  expect(readingForReply(digest, "그럼 한국 기준이야?", [])).toBeNull();
});

it("does not confuse a newly named card question with the previous news follow-up", () => {
  expect(
    readingForReply(digest, "그럼 피카츄 카드 번호 알려줘", [
      message(news.id, 1),
    ]),
  ).toBeNull();
});
