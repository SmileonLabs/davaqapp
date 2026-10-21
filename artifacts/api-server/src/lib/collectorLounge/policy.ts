import {randomInt} from 'node:crypto';
export const COLLECTORS = [
  {
    key: "catalog",
    id: "00000000-0000-4000-8000-00000000c101",
    name: "팩깡너구리",
    bio: "카드 이야기라면 언제든 끼어드는 수다쟁이.",
    style:
      "작은 모순이나 뜻밖의 선택을 발견하면 짧게 짚는 호기심 많은 성격. 추상적인 분위기 칭찬보다 구체적인 차이를 좋아한다. 카드 외에도 음식·취미·일상 이야기를 편하게 한다. 정확한 정보 질문에는 자료를 먼저 본다. 매번 수집 완성 이야기를 꺼내지는 않는다.",
  },
  {
    key: "art",
    id: "00000000-0000-4000-8000-00000000c102",
    name: "반짝수달",
    bio: "마음에 드는 한 장을 만나면 말이 많아져요.",
    style:
      "상대의 생각에서 뜻밖의 가능성을 찾는 성격. 엉뚱한 가정도 즐기지만 매번 비유나 물건 의인화로 답하지 않는다. 상대의 기분과 농담을 섬세하게 받는다. 공감 문구만 반복하지 않고 앞말에 구체적으로 반응한다. 억지 감탄·취향 대결은 하지 않는다.",
  },
  {
    key: "market",
    id: "00000000-0000-4000-8000-00000000c103",
    name: "슬리브도깨비",
    bio: "취향은 달라도 카드 얘기는 못 참죠.",
    style:
      "말을 길게 늘이지 않고 생활의 작은 불편과 웃긴 구석을 건조하게 짚는 성격. 때로 장난스럽지만 매번 농담하거나 조언하지 않는다. 휴식·주말·음식 이야기도 자연스럽게 받으며 정리·슬리브 잔소리로 돌아가지 않는다.",
  },
] as const;
export const LOUNGE_ID = "00000000-0000-4000-8000-00000000c100";
export type CollectorKey = (typeof COLLECTORS)[number]["key"];
export type LoungeMessage = {
  id: string;
  sender_id: string;
  author_kind: string;
  content: string;
  type: string;
  room_seq: number;
  created_at: Date | string;
  metadata?: Record<string, unknown> | null;
};
export function freeCollectorSpeaker(history:LoungeMessage[],pick:(max:number)=>number=randomInt){
 const last=history.at(-1);const addressed=COLLECTORS.find(c=>last?.content.includes(c.name)&&c.id!==last.sender_id);
 if(addressed)return addressed;
 const previous=history.filter(m=>COLLECTORS.some(c=>c.id===m.sender_id)).at(-1);
 const choices=COLLECTORS.filter(c=>c.id!==previous?.sender_id);
 return choices[pick(choices.length)];
}
export function redact(text: string): string {
  return text
    .replace(/[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/g, "[이메일]")
    .replace(/(?:\+?82[- ]?)?0?1[016789][- ]?\d{3,4}[- ]?\d{4}/g, "[전화번호]")
    .slice(0, 600);
}
export function eligibleSpeakers(messages: LoungeMessage[]): CollectorKey[] {
  const last = messages.at(-1);
  return COLLECTORS.filter((c) => c.id !== last?.sender_id).map((c) => c.key);
}
export function decideResult(
  raw: unknown,
  eligible: CollectorKey[],
  threshold = 0.65,
): CollectorKey | null {
  const a = (raw as any)?.answers;
  const gate = a?.speak;
  const choice = a?.speaker;
  if (
    gate?.choice !== "speak" ||
    !Number.isFinite(gate.confidence) ||
    gate.confidence < threshold || gate.confidence > 1
  )
    return null;
  if (
    !eligible.includes(choice?.choice) ||
    !Number.isFinite(choice.confidence) ||
    choice.confidence < 0.3 || choice.confidence > 1
  )
    return null;
  return choice.choice;
}
export function messageStillCurrent(expected: number, latest: number) {
  return expected === latest;
}
export function canStartTurn(args: {
  paused: boolean;
  calls: number;
  limit: number;
  turns: number;
  humanPending: boolean;
  humanConversation: boolean;
}) {
  return (
    !args.paused &&
    args.calls < args.limit &&
    !args.humanConversation &&
    (args.humanPending || args.turns < 4)
  );
}

export function collectorPublicImage(value:unknown, origin:string):string|null {
 if(typeof value!=="string")return null;
 try {const u=new URL(value,origin);return u.protocol==="https:"&&u.origin===new URL(origin).origin&&u.pathname.startsWith("/market/images/")&&!u.search&&!u.hash?u.href:null;} catch {return null;}
}

export function collectorReplyAllowed(text: string): boolean {
  // Keep generated monetary assertions out of public chat; the card detail owns
  // edition/market/time and price-state presentation.
  return !/(?:[₩$€¥]\s*\d|\d[\d,.]*\s*(?:만\s*)?(?:원|달러|엔|USD|KRW|JPY)|(?:가격|가치|시세).{0,12}(?:오를|오른|상승|높아질|올려)|사운드\s*기능|희소성|희귀성|일본\s*특유)/i.test(text);
}

export function normalizeCollectorReply(text: string): string {
  const sentences=stripCollectorSalutation(text).match(/[^.!?。]+[.!?。]?/g) ?? [];
  const short=sentences.slice(0,4).join("").trim();
  if(short.length<=420)return short;
  const clipped=short.slice(0,417);
  return clipped.slice(0,Math.max(clipped.lastIndexOf(" "),360)).trim()+"…";
}

export function stripCollectorSalutation(text: string): string {
 return text.trim().replace(/^(?:(?:도감파|일러스트파|일러스타|시세파)(?:\s*AI)?|팩깡너구리|반짝수달|슬리브도깨비)\s*(?:님|야|아)?\s*[,，:：!]\s*/u, "").trim();
}
