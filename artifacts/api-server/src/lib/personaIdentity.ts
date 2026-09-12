import {
  DEFAULT_PERSONA_STATS,
  type PersonaStats,
} from "@workspace/db";
import { computeLevel, ensurePersona } from "./growth";
import { getPersonaOntologyProfile, type PersonaProfileView } from "./personaOntology";

type StatKey = keyof PersonaStats;

/** Korean label for each stat as a noun ("능력치"). */
export const STAT_LABEL: Record<StatKey, string> = {
  logic: "논리력",
  empathy: "공감력",
  wit: "순발력",
  knowledge: "지식",
  conviction: "신념",
  emotion: "감정 표현",
  decisiveness: "결단력",
};

/** Per-stat phrase used when this stat is the user's weakest growth area. */
const GROWTH_HINT: Record<StatKey, string> = {
  logic: "논리적으로 근거를 정리하는 연습을 더하면",
  empathy: "상대의 감정에 한 번 더 귀 기울이면",
  wit: "가볍게 분위기를 풀어주는 여유를 더하면",
  knowledge: "다양한 분야의 지식을 넓혀가면",
  conviction: "자신의 신념을 분명하게 표현하면",
  emotion: "감정을 솔직하게 드러내는 연습을 하면",
  decisiveness: "조금 더 과감하게 결정하고 행동하면",
};

interface ArchetypeDef {
  key: string;
  /** Display name, e.g. "전략가형". */
  name: string;
  /** Short rank title used on the card, e.g. "전략가". */
  title: string;
  /** The two signature stats that define this archetype. */
  signature: [StatKey, StatKey];
  /** Characteristic Korean traits. */
  traits: string[];
  /** Short first-person motto for the shareable card. */
  motto: string;
}

/**
 * Rule-based archetypes. NO AI is used — the archetype is chosen purely from the
 * persona's deterministic stats. Each archetype is defined by a pair of signature
 * stats; the persona is matched to the archetype whose signature stats it scores
 * highest in. `observer` is the balanced/low-activity fallback and has no
 * signature (it is never scored, only used as a default).
 */
const ARCHETYPES: ArchetypeDef[] = [
  {
    key: "strategist",
    name: "전략가형",
    title: "전략가",
    signature: ["logic", "conviction"],
    traits: ["논리적", "분석적", "주도적"],
    motto: "나는 생각으로 길을 여는 또 다른 자아입니다.",
  },
  {
    key: "harmonizer",
    name: "조율자형",
    title: "조율자",
    signature: ["empathy", "emotion"],
    traits: ["공감적", "따뜻한", "배려심 깊은"],
    motto: "나는 마음과 마음을 잇는 또 다른 자아입니다.",
  },
  {
    key: "explorer",
    name: "탐험가형",
    title: "탐험가",
    signature: ["wit", "knowledge"],
    traits: ["호기심 많은", "창의적인", "재치 있는"],
    motto: "나는 호기심으로 세상을 넓혀가는 또 다른 자아입니다.",
  },
  {
    key: "pioneer",
    name: "개척자형",
    title: "개척자",
    signature: ["conviction", "decisiveness"],
    traits: ["추진력 있는", "단호한", "도전적인"],
    motto: "나는 망설임 없이 나아가는 또 다른 자아입니다.",
  },
  {
    key: "sage",
    name: "현자형",
    title: "현자",
    signature: ["knowledge", "logic"],
    traits: ["사려 깊은", "박식한", "침착한"],
    motto: "나는 깊이로 답을 찾아가는 또 다른 자아입니다.",
  },
  {
    key: "entertainer",
    name: "재담꾼형",
    title: "재담꾼",
    signature: ["wit", "empathy"],
    traits: ["유쾌한", "친화적인", "순발력 있는"],
    motto: "나는 분위기를 밝히는 또 다른 자아입니다.",
  },
  {
    key: "activist",
    name: "행동가형",
    title: "행동가",
    signature: ["decisiveness", "emotion"],
    traits: ["열정적인", "실행력 있는", "솔직한"],
    motto: "나는 행동으로 증명하는 또 다른 자아입니다.",
  },
];

const OBSERVER: ArchetypeDef = {
  key: "observer",
  name: "관찰자형",
  title: "관찰자",
  signature: ["logic", "empathy"], // unused (fallback)
  traits: ["균형 잡힌", "신중한", "관찰력 있는"],
  motto: "나는 현실의 나를 닮아 성장하는 또 다른 자아입니다.",
};

/** Below this total of stat points the persona is still "forming" → observer. */
const MIN_TOTAL_FOR_ARCHETYPE = 5;

export interface PersonaIdentity {
  archetypeKey: string;
  /** Display archetype name, e.g. "전략가형". */
  archetype: string;
  /** Short rank title, e.g. "전략가". */
  title: string;
  primaryTraits: string[];
  /** Top stats as ability nouns, strongest first. */
  strengths: string[];
  /** Weakest stats framed as growth areas. */
  weaknesses: string[];
  growthDirection: string;
  motto: string;
}

/** Sort stat keys by value, strongest first (stable on ties by fixed order). */
function rankedStats(stats: PersonaStats): { key: StatKey; value: number }[] {
  const order: StatKey[] = [
    "logic",
    "empathy",
    "wit",
    "knowledge",
    "conviction",
    "emotion",
    "decisiveness",
  ];
  return order
    .map((key) => ({ key, value: stats[key] ?? 0 }))
    .sort((a, b) => b.value - a.value);
}

/**
 * Derive the persona's identity from its deterministic stats (rule-based, no AI).
 * Picks the archetype whose two signature stats sum highest; falls back to
 * "관찰자형" when the persona has too little activity or no clear strength.
 */
export function computeIdentity(stats: PersonaStats): PersonaIdentity {
  const safeStats: PersonaStats = { ...DEFAULT_PERSONA_STATS, ...stats };
  const total = Object.values(safeStats).reduce((a, b) => a + (b ?? 0), 0);
  const ranked = rankedStats(safeStats);

  let chosen: ArchetypeDef = OBSERVER;
  if (total >= MIN_TOTAL_FOR_ARCHETYPE && ranked[0].value > 0) {
    let bestScore = -1;
    for (const def of ARCHETYPES) {
      const score = def.signature.reduce((sum, k) => sum + (safeStats[k] ?? 0), 0);
      if (score > bestScore) {
        bestScore = score;
        chosen = def;
      }
    }
  }

  // Strengths: up to 3 strongest stats with any points.
  const strengths = ranked
    .filter((s) => s.value > 0)
    .slice(0, 3)
    .map((s) => STAT_LABEL[s.key]);

  // Weaknesses / growth areas: the 2 lowest stats (ascending).
  const ascending = [...ranked].reverse();
  const weaknesses =
    total > 0 ? ascending.slice(0, 2).map((s) => STAT_LABEL[s.key]) : [];

  // Growth direction: target the single weakest stat with a concrete hint.
  let growthDirection: string;
  if (total < MIN_TOTAL_FOR_ARCHETYPE) {
    growthDirection =
      "채팅·배틀·성장RPG로 다양한 활동을 시작하면 당신만의 정체성이 또렷해질 거예요.";
  } else {
    const weakest = ascending[0].key;
    growthDirection = `${GROWTH_HINT[weakest]} 더 균형 잡힌 어나더 미로 성장할 수 있어요.`;
  }

  return {
    archetypeKey: chosen.key,
    archetype: chosen.name,
    title: chosen.title,
    primaryTraits: chosen.traits,
    strengths,
    weaknesses,
    growthDirection,
    motto: chosen.motto,
  };
}

export interface PersonaCard {
  source: "ontology";
  syncState: "not_started" | "forming" | "synced";
  name: string;
  level: number;
  displayLevelLabel: string | null;
  title: string;
  archetype: string;
  archetypeKey: string;
  strengths: string[];
  weaknesses: string[];
  primaryTraits: string[];
  growthDirection: string;
  motto: string;
  houseName: string | null;
  nextActions: string[];
  syncTimeline: { label: string; createdAt: string | null }[];
  ontologyProfile: PersonaProfileView | null;
}

function ontologySyncState(profile: PersonaProfileView | null): PersonaCard["syncState"] {
  if (!profile) return "not_started";
  const sourceTotal = Object.values(profile.sourceCounts ?? {}).reduce((sum, count) => sum + (count ?? 0), 0);
  return profile.confidence >= 60 && sourceTotal >= 2 ? "synced" : "forming";
}

function ontologyNextActions(profile: PersonaProfileView | null): string[] {
  if (!profile) {
    return [
      "Talk to Earn 보상을 수령하면 대화 요약과 키워드가 반영돼요.",
      "AI 기억을 추가하면 선호와 말투 기준이 더 또렷해져요.",
      "토크배틀에 참여하면 표현 방식과 설득 스타일이 반영돼요.",
    ];
  }

  const counts = profile.sourceCounts ?? {};
  const actions: string[] = [];
  if (!counts.chat) actions.push("Talk to Earn 보상을 수령해 대화 스타일 근거를 추가해 보세요.");
  if (!counts.memory) actions.push("AI 기억을 추가해 DavaQ가 선호와 말투를 더 정확히 참고하게 해보세요.");
  if (!counts.battle) actions.push("토크배틀 발언 평가를 반영하면 표현 역량이 더 입체적으로 정리돼요.");
  if (profile.confidence < 70) actions.push("서로 다른 출처가 2개 이상 쌓이면 신뢰도가 더 안정적으로 올라가요.");

  return (actions.length > 0 ? actions : ["최근 반영 근거를 유지하려면 톡 리워드와 AI 기억을 꾸준히 동기화해 주세요."]).slice(0, 3);
}

function ontologySyncTimeline(profile: PersonaProfileView | null): PersonaCard["syncTimeline"] {
  if (!profile) return [];
  return profile.evidenceSummary.slice(0, 3).map((label) => ({ label, createdAt: profile.updatedAt }));
}

/**
 * Build the persona card for a user from ontology data only. Returning null when
 * the ontology snapshot is missing is intentional: stale legacy stats must not
 * masquerade as a valid DavaQ profile.
 */
export async function getPersonaCard(
  userId: string,
  displayName: string,
): Promise<PersonaCard | null> {
  const persona = await ensurePersona(userId);
  if (!persona) return null;

  const level = computeLevel(persona.xp);
  const ontologyProfile = await getPersonaOntologyProfile(userId);
  if (!ontologyProfile) return null;

  const identity: PersonaIdentity = {
    archetypeKey: ontologyProfile.archetypeKey,
    archetype: ontologyProfile.archetypeLabel,
    title: ontologyProfile.archetypeLabel,
    primaryTraits: ontologyProfile.traitTags.length > 0
      ? ontologyProfile.traitTags.slice(0, 3)
      : ontologyProfile.communicationStyles.slice(0, 3),
    strengths: [
      ...ontologyProfile.capabilities,
      ...ontologyProfile.conflictStyles,
    ].slice(0, 3),
    weaknesses: [],
    growthDirection: ontologyProfile.capabilities.length > 0 || ontologyProfile.communicationStyles.length > 0
      ? "대화와 토크배틀 evidence가 쌓일수록 DavaQ가 말투와 표현 방식을 더 안전하게 동기화합니다."
      : "직접 AI 기억을 추가하거나 토크배틀에서 발언하면 자아 프로필이 더 또렷해집니다.",
    motto: "나는 점수보다 맥락으로 성장하는 또 다른 자아입니다.",
  };

  return {
    source: "ontology",
    syncState: ontologySyncState(ontologyProfile),
    name: `${displayName}의 어나더 미`,
    level,
    displayLevelLabel: null,
    title: identity.title,
    archetype: identity.archetype,
    archetypeKey: identity.archetypeKey,
    strengths: identity.strengths,
    weaknesses: identity.weaknesses,
    primaryTraits: identity.primaryTraits,
    growthDirection: identity.growthDirection,
    motto: identity.motto,
    houseName: null,
    nextActions: ontologyNextActions(ontologyProfile),
    syncTimeline: ontologySyncTimeline(ontologyProfile),
    ontologyProfile,
  };
}
