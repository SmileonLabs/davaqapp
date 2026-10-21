import { describe, it, expect, vi, afterEach } from "vitest";
import {
  COLLECTORS,
  redact,
  eligibleSpeakers,
  decideResult,
  messageStillCurrent,
} from "./policy";
import { selectCollector } from "./jev";
afterEach(() => vi.unstubAllEnvs());
describe("collector decision boundaries", () => {
  it("fails closed for unknown actor, low confidence, missing or nonfinite values", () => {
    const ok = {
      answers: {
        speak: { choice: "speak", confidence: 0.9 },
        speaker: { choice: "art", confidence: 0.9 },
      },
    };
    expect(decideResult(ok, ["art", "market"])).toBe("art");
    expect(decideResult(ok, ["catalog", "market"])).toBeNull();
    for (const confidence of [0.6, NaN, undefined, 2])
      expect(
        decideResult(
          {
            answers: { ...ok.answers, speak: { choice: "speak", confidence } },
          },
          ["art"],
        ),
      ).toBeNull();
    expect(
      decideResult(
        {
          answers: { ...ok.answers, speak: { choice: "wait", confidence: 1 } },
        },
        ["art"],
      ),
    ).toBeNull();
  });
  it("avoids successive turns by the same character and rejects stale snapshots", () => {
    expect(
      eligibleSpeakers([
        {
          id: "x",
          sender_id: COLLECTORS[0].id,
          author_kind: "bot",
          content: "x",
          type: "text",
          room_seq: 1,
          created_at: new Date(),
        },
      ]),
    ).toEqual(["art", "market"]);
    expect(messageStillCurrent(5, 6)).toBe(false);
    expect(messageStillCurrent(5, 5)).toBe(true);
  });
  it("redacts contact details and never forwards image object paths", async () => {
    vi.stubEnv("JEV_AI_API_KEY", "test-key");
    let request: any;
    const fetcher = vi.fn(async (url, init) => {
      request = { url, init, body: JSON.parse(init.body) };
      return new Response(
        JSON.stringify({
          answers: {
            speak: { choice: "wait", confidence: 1 },
            speaker: { choice: "art", confidence: 1 },
          },
          usage: { input_tokens: 30 },
        }),
      );
    }) as unknown as typeof fetch;
    await selectCollector(
      [
        {
          id: "x",
          sender_id: "u",
          author_kind: "user",
          content: "/objects/private.jpg",
          type: "image",
          room_seq: 1,
          created_at: new Date(),
        },
      ],
      ["art", "market"],
      "test",
      fetcher,
    );
    expect(request.url).toBe("https://jev-ai.pro/api/v1/systemone");
    expect(request.init.redirect).toBe("error");
    expect(JSON.stringify(request.body)).not.toContain("/objects/");
    expect(redact("test@example.com 010-1234-5678")).not.toMatch(
      /example|1234/,
    );
  });
  it("does not retry failed or malformed provider responses", async () => {
    vi.stubEnv("JEV_AI_API_KEY", "test-key");
    const fetcher = vi.fn(
      async () => new Response("{}", { status: 402 }),
    ) as unknown as typeof fetch;
    await expect(
      selectCollector([], ["art", "market"], "x", fetcher),
    ).rejects.toThrow("collector_jev_http_402");
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});
it('only forwards public catalog images from the configured card server',async()=>{
 const {collectorPublicImage}=await import('./policy');
 expect(collectorPublicImage('/market/images/kream/abc','https://tcgindex.org')).toBe('https://tcgindex.org/market/images/kream/abc');
 for(const src of ['/objects/private.jpg','https://evil.example/market/images/x','http://tcgindex.org/market/images/x','/market/images/x?token=secret'])expect(collectorPublicImage(src,'https://tcgindex.org')).toBeNull();
});

it("rejects generated monetary and speculative value assertions", async () => {
 const {collectorReplyAllowed}=await import("./policy");
 expect(collectorReplyAllowed("이 카드 가격은 451,000원이야")).toBe(false);
 expect(collectorReplyAllowed("가치가 높아질 것 같아")).toBe(false);
 expect(collectorReplyAllowed("같은 판본인지 먼저 맞추고 카드 상세에서 호가와 확정 가격을 구분하자")).toBe(true);
});

it("allows varied conversation lengths within the payload budget", async () => {
 const {normalizeCollectorReply}=await import("./policy");
 expect(normalizeCollectorReply("그림이 좋아. 도감파는 어때? 다음 이야기." )).toBe("그림이 좋아. 도감파는 어때? 다음 이야기.");
 expect(normalizeCollectorReply("가나다라 ".repeat(100)).length).toBeLessThanOrEqual(420);
});

it("removes role and nickname salutations without changing ordinary sentences", async () => {
 const {stripCollectorSalutation}=await import("./policy");
 expect(stripCollectorSalutation("도감파 AI, 이 카드 어때?")).toBe("이 카드 어때?");
 expect(stripCollectorSalutation("반짝수달, 난 이 그림이 좋아.")).toBe("난 이 그림이 좋아.");
 expect(stripCollectorSalutation("이 카드 번호는 132/106이야.")).toBe("이 카드 번호는 132/106이야.");
});

it('lets different AIs take the next turn and respects a directly addressed peer',async()=>{
 const {freeCollectorSpeaker,COLLECTORS}=await import('./policy');const last={id:'x',sender_id:COLLECTORS[0].id,author_kind:'bot',content:'오늘 노래 이야기 하자',type:'text',room_seq:1,created_at:new Date()};
 expect(freeCollectorSpeaker([last],()=>0).id).toBe(COLLECTORS[1].id);expect(freeCollectorSpeaker([last],()=>1).id).toBe(COLLECTORS[2].id);expect(freeCollectorSpeaker([{...last,content:'슬리브도깨비는 어때?'}],()=>0).id).toBe(COLLECTORS[2].id);
});
