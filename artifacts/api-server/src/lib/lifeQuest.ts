import type { Logger } from "pino";
import {
  LIFE_QUEST_THEMES,
  type LifeQuestChoice,
  type LifeQuestRiskLevel,
  type LifeQuestStage,
  type LifeQuestTheme,
  type StarStats,
} from "@workspace/db";
import { getOpenAI } from "./aiClient";

const LIFE_QUEST_MODEL = "gpt-5-mini";

/** The STAR stats a mission choice may move. */
const STAT_KEYS: (keyof StarStats)[] = ["charm", "stagePresence", "bond", "lore"];

const RISK_LEVELS: LifeQuestRiskLevel[] = ["low", "medium", "high"];

/** Korean labels for each theme — keys are kept for compatibility, copy is trainee-focused by default. */
export const LIFE_QUEST_THEME_LABELS: Record<LifeQuestTheme, string> = {
  work: "무대 기초 연습",
  relationship: "첫 팬 반응",
  money: "연습 자원 관리",
  health: "연습생 루틴",
  study: "표현 기초 훈련",
  conflict: "기대 조율",
  startup: "데뷔 준비 노트",
  daily: "콘셉트 씨앗",
};

const PROMOTED_THEME_LABELS: Record<LifeQuestTheme, string> = {
  work: "공식 무대 준비",
  relationship: "팬클럽 소통",
  money: "활동 예산 운영",
  health: "공식 STAR 루틴",
  study: "표현 고도화",
  conflict: "팬덤 조율",
  startup: "컴백 프로젝트",
  daily: "세계관 확장",
};

/** A theme-specific seed for pre-Torimia trainee STAR missions. */
const THEME_HINTS: Record<LifeQuestTheme, string> = {
  work: "공식 무대가 아니라 연습실, 셀프 리허설, 짧은 테스트 영상, 무대 기초 감각을 다지는 상황.",
  relationship: "팬클럽이 열리기 전 단계의 소수 팬 반응, 응원 댓글, 첫 관심을 조심스럽게 받아들이는 상황.",
  money: "연습실 시간, 소품, 간단한 콘텐츠 제작처럼 작은 연습 자원을 계획하는 상황. 구체적 투자 조언은 금지.",
  health: "수면, 발성 전 휴식, 연습 루틴, 멘탈 회복처럼 연습생 STAR 활동을 지속하기 위한 루틴 상황. 의학적 조언은 금지.",
  study: "보컬, 표정, 멘트, 짧은 퍼포먼스처럼 공식 데뷔 전 표현 기초를 훈련하는 상황.",
  conflict: "연습 방향, 첫 팬 기대, 자기 의심, 팀원 의견 차이를 차분히 조율하는 상황. 폭력·혐오 조장 금지.",
  startup: "데뷔 티저 전의 콘셉트 초안, 첫 콘텐츠 테스트, 토르미아를 향한 준비 노트를 만드는 상황.",
  daily: "캐릭터의 말투, 색, 상징, 세계관 조각을 발견하며 연습생 STAR 콘셉트의 씨앗을 다듬는 상황.",
};

const PROMOTED_THEME_HINTS: Record<LifeQuestTheme, string> = {
  work: "공식 무대, 세트리스트, 리허설, 무대 위 존재감처럼 공식 STAR 활동을 준비하는 상황.",
  relationship: "팬클럽 공지, 팬미팅, 응원 메시지 답장처럼 공식 팬덤과 관계를 키우는 상황.",
  money: "굿즈 샘플, 콘텐츠 제작비, 활동 예산처럼 공식 활동 자원을 계획하는 상황. 구체적 투자 조언은 금지.",
  health: "스케줄 전 컨디션, 발성 관리, 회복 루틴처럼 공식 STAR 활동을 지속하기 위한 루틴 상황. 의학적 조언은 금지.",
  study: "라이브, 무대 멘트, 표정, 퍼포먼스 디테일처럼 공식 STAR의 표현력을 고도화하는 상황.",
  conflict: "팬덤 오해, 악성 댓글, 팀 운영 이슈처럼 공식 STAR답게 갈등을 조율하는 상황. 폭력·혐오 조장 금지.",
  startup: "컴백 티저, 새 콘텐츠, 팬클럽 이벤트처럼 공식 프로젝트를 시작하는 상황.",
  daily: "공식 STAR의 말투, 색, 상징, 세계관을 팬들이 알아볼 수 있게 확장하는 상황.",
};

/** The raw shape the model returns (ids/risk normalization happens after). */
interface GeneratedChoice {
  label: string;
  description: string;
  resultText: string;
  statChanges: Record<string, number>;
  riskLevel: string;
}
interface GeneratedStage {
  title: string;
  situation: string;
  choices: GeneratedChoice[];
}
interface GeneratedScenario {
  title: string;
  goal: string;
  summary: string;
  stages: GeneratedStage[];
}

export interface LifeQuestScenario {
  title: string;
  theme: LifeQuestTheme;
  goal: string;
  summary: string;
  stages: LifeQuestStage[];
}

export interface LifeQuestScenarioContext {
  starName?: string | null;
  promoted?: boolean;
  ipName?: string | null;
  category?: string | null;
  roleName?: string | null;
  worldStyle?: string | null;
  missions?: Array<{ title: string; description: string; xp: number }>;
}

function pickRandomTheme(): LifeQuestTheme {
  return LIFE_QUEST_THEMES[Math.floor(Math.random() * LIFE_QUEST_THEMES.length)]!;
}

/** Coerce the model's free-form theme input to a known theme (or random). */
export function normalizeTheme(input?: string | null): LifeQuestTheme {
  if (input && (LIFE_QUEST_THEMES as string[]).includes(input)) {
    return input as LifeQuestTheme;
  }
  return pickRandomTheme();
}

/** JSON schema (strict) for the one-shot scenario generation call. */
const scenarioSchema = {
  type: "object",
  additionalProperties: false,
  required: ["title", "goal", "summary", "stages"],
  properties: {
    title: { type: "string" },
    goal: { type: "string" },
    summary: { type: "string" },
    stages: {
      type: "array",
      minItems: 4,
      maxItems: 6,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["title", "situation", "choices"],
        properties: {
          title: { type: "string" },
          situation: { type: "string" },
          choices: {
            type: "array",
            minItems: 3,
            maxItems: 4,
            items: {
              type: "object",
              additionalProperties: false,
              required: ["label", "description", "resultText", "statChanges", "riskLevel"],
              properties: {
                label: { type: "string" },
                description: { type: "string" },
                resultText: { type: "string" },
                riskLevel: { type: "string", enum: RISK_LEVELS },
                statChanges: {
                  type: "object",
                  additionalProperties: false,
                  required: [...STAT_KEYS],
                  properties: Object.fromEntries(
                    STAT_KEYS.map((k) => [k, { type: "integer" }]),
                  ),
                },
              },
            },
          },
        },
      },
    },
  },
} as const;

export function buildSystemPrompt(theme: LifeQuestTheme, context: LifeQuestScenarioContext = {}): string {
  const starName = context.starName?.trim() || "장착한 STAR";
  const missionName = context.promoted ? "공식 STAR 미션" : "성장 RPG 미션";
  const themeLabel = context.promoted ? PROMOTED_THEME_LABELS[theme] : LIFE_QUEST_THEME_LABELS[theme];
  const themeHint = context.promoted ? PROMOTED_THEME_HINTS[theme] : THEME_HINTS[theme];
  const ipName = context.ipName?.trim() || starName;
  const category = context.category?.trim() || "character";
  const roleName = context.roleName?.trim() || "캐릭터";
  const worldStyle = context.worldStyle?.trim() || "해당 NFT의 원작 정체성과 분위기";
  const missionBriefs = (context.missions ?? [])
    .slice(0, 8)
    .map((mission, index) => `${index + 1}. ${mission.title}: ${mission.description}`)
    .join("\n");
  const phase = context.promoted
    ? "토르미아의 문이 열린 공식 STAR 활동 단계"
    : "토르미아의 문을 열기 전, 연습생 STAR로 꿈을 키우는 준비 단계";
  return [
    `너는 '다바꿔(DavaQ)'라는 한국어 STAR 성장 앱의 '${missionName}' 시나리오 작가다.`,
    `이번 미션의 주인공은 '${starName}'이며, 현재 단계는 '${phase}'이다.`,
    `장착 NFT IP는 '${ipName}', 분류는 '${category}', 역할은 '${roleName}'이다.`,
    `세계관 방향은 '${worldStyle}'이다. 아이돌로 고정하지 말고 이 분류와 역할에 맞는 활동으로 구성한다.`,
    missionBriefs
      ? `관리자가 검토한 성장 RPG 미션 소재 중 적어도 하나를 자연스럽게 반영한다:\n${missionBriefs}`
      : "관리자 미션 소재가 없으면 NFT의 분류·역할·세계관에 맞는 안전한 성장 활동을 만든다.",
    context.promoted
      ? "공식 STAR 미션은 팬클럽과 무대, 콘텐츠, 세계관을 키우며 공식 STAR 활동을 확장하는 선택형 성장 미션이다."
      : "성장 RPG 미션은 장착한 NFT의 역할과 세계관에 맞는 활동을 통해 캐릭터를 성장시키는 선택형 미션이다.",
    "",
    `## 이번 미션 테마: ${themeLabel}`,
    themeHint,
    "",
    "## 시나리오 작성 규칙",
    "- 전체 시나리오(4~6개 스테이지, 각 스테이지 3~4개 선택지)를 한 번에 완성한다.",
    context.promoted
      ? "- 각 스테이지는 공식 STAR 활동과 직접 연결된 현실적인 상황(situation)과 짧은 제목(title)을 가진다."
      : "- 각 스테이지는 장착 NFT의 역할과 세계관에 맞는 성장 상황(situation)과 짧은 제목(title)을 가진다.",
    "- 각 선택지에는 label(짧은 행동 요약), description(한 줄 부연), resultText(선택 후 벌어지는 결과 묘사)를 쓴다.",
    "- 선택지는 서로 '성향'이 달라야 한다. 정답/오답은 없으며, 각 선택에는 장점과 트레이드오프가 있다.",
    "- 모든 텍스트는 자연스러운 한국어. 모바일 화면에 맞게 간결하게(situation 2~3문장, resultText 1~2문장).",
    "- 마지막 스테이지는 이야기가 자연스럽게 마무리되도록 한다.",
    context.promoted
      ? "- 팬클럽, 공식 무대, 팬덤 운영 같은 승급 후 요소를 사용할 수 있다."
      : "- 팬클럽 생성, 공식 무대 데뷔, 대규모 팬덤 운영처럼 승급 후에만 가능한 사건은 아직 일어나지 않은 것으로 작성한다.",
    "",
    "## statChanges 규칙 (매우 중요)",
    `- 사용 가능한 STAR 스탯은 정확히 4개뿐: ${STAT_KEYS.join(", ")}.`,
    "- 의미: charm(매력), stagePresence(무대감), bond(팬 유대), lore(서사).",
    "- statChanges에는 항상 4개 스탯 키를 모두 포함한다. 실제로 올릴 스탯만 +1~+3을 주고, 나머지 스탯은 반드시 0으로 둔다.",
    "- 각 선택지는 1~3개 스탯만 실제로 올린다(0보다 큰 값은 1~3개). 음수는 사용하지 않는다(감소 없음).",
    "- 선택의 성향에 맞는 스탯을 준다. (예: 팬에게 진심을 전하면 bond, 콘셉트를 깊게 만들면 lore, 무대를 장악하면 stagePresence)",
    "",
    "## 금지 사항",
    "- NFT 원작과 관리자가 검토한 세계관 밖의 설정을 임의로 추가하지 않는다. 전투·마법 등은 해당 IP 설정에 있을 때만 비폭력적 성장 맥락으로 사용한다.",
    "- 의학적 진단·치료, 법률 자문, 구체적 투자·재테크 종목 추천 금지.",
    "- 자해·폭력·혐오·성적 콘텐츠, 실존 인물 비방, 개인정보 요구 금지.",
    "- 도박이나 불법 행위를 권하는 선택지 금지.",
  ].join("\n");
}

/**
 * Generate a complete Life Quest scenario in ONE OpenAI call. All stages,
 * choices, result text and stat changes are authored up-front; the rest of the
 * run never calls AI. Choice ids and risk levels are normalized server-side.
 *
 * Throws if the model returns nothing parseable — the route turns that into a
 * clean 502 so the client can retry, and nothing is persisted.
 */
export async function generateLifeQuestScenario(
  theme: LifeQuestTheme,
  log: Logger,
  context: LifeQuestScenarioContext = {},
): Promise<LifeQuestScenario> {
  const completion = await getOpenAI().chat.completions.create({
    model: LIFE_QUEST_MODEL,
    // gpt-5-mini is a reasoning model: reasoning tokens share the budget with the
    // (sizeable) full-scenario JSON. Give ample headroom so it isn't truncated.
    max_completion_tokens: 8000,
    reasoning_effort: "low",
    messages: [
      { role: "system", content: buildSystemPrompt(theme, context) },
      {
        role: "user",
        content: `위 테마로 새로운 ${context.promoted ? "공식 STAR 미션" : "연습생 STAR 미션"} 시나리오를 하나 만들어줘. 4~6개의 스테이지와 각 스테이지마다 3~4개의 선택지를 포함해.`,
      },
    ],
    response_format: {
      type: "json_schema",
      json_schema: { name: "life_quest_scenario", strict: true, schema: scenarioSchema },
    },
  });

  const choice = completion.choices[0];
  const raw = choice?.message?.content;
  if (!raw) {
    log.error(
      { theme, finishReason: choice?.finish_reason, usage: completion.usage },
      "Life Quest AI returned empty content",
    );
    throw new Error("life quest generation returned no content");
  }

  let parsed: GeneratedScenario;
  try {
    parsed = JSON.parse(raw) as GeneratedScenario;
  } catch (err) {
    log.error(
      { err, theme, finishReason: choice?.finish_reason, rawLength: raw.length },
      "Life Quest AI returned unparseable JSON",
    );
    throw new Error("life quest generation returned invalid JSON");
  }

  return normalizeScenario(parsed, theme);
}

/** Clamp a model stat delta to a sane positive integer (defends against bad output). */
function cleanStatChanges(input: Record<string, number> | undefined): Record<string, number> {
  const out: Record<string, number> = {};
  if (!input) return out;
  for (const k of STAT_KEYS) {
    const v = input[k];
    if (typeof v === "number" && Number.isFinite(v) && v > 0) {
      out[k] = Math.min(3, Math.trunc(v));
    }
  }
  return out;
}

/** Assign deterministic stage numbers + choice ids and sanitize stat changes. */
function normalizeScenario(parsed: GeneratedScenario, theme: LifeQuestTheme): LifeQuestScenario {
  const stages: LifeQuestStage[] = (parsed.stages ?? []).map((stage, si) => {
    const stageNumber = si + 1;
    const choices: LifeQuestChoice[] = (stage.choices ?? []).map((c, ci) => ({
      id: `s${stageNumber}-c${ci + 1}`,
      label: c.label,
      description: c.description,
      resultText: c.resultText,
      statChanges: cleanStatChanges(c.statChanges),
      riskLevel: (RISK_LEVELS as string[]).includes(c.riskLevel)
        ? (c.riskLevel as LifeQuestRiskLevel)
        : "medium",
    }));
    return { stageNumber, title: stage.title, situation: stage.situation, choices };
  });

  return {
    title: parsed.title?.trim() || "이름 없는 STAR 미션",
    theme,
    goal: parsed.goal?.trim() || "오늘의 선택을 통해 나를 성장시키기",
    summary: parsed.summary?.trim() || "",
    stages,
  };
}
