export const KREAM_GAME_OPTIONS = [
  { code: "pokemon", label: "포켓몬" },
  { code: "one_piece", label: "원피스" },
  { code: "yugioh", label: "유희왕" },
  { code: "dragon_ball", label: "드래곤볼" },
  { code: "union_arena", label: "유니온 아레나" },
  { code: "riftbound", label: "리프트바운드" },
  { code: "cookie_run", label: "쿠키런" },
  { code: "duel_masters", label: "듀얼마스터즈" },
  { code: "gundam", label: "건담" },
  { code: "kaikai_kiki", label: "카이카이키키" },
  { code: "magic", label: "매직: 더 개더링" },
  { code: "zutomayo", label: "즛토마요" },
  { code: "digimon", label: "디지몬" },
  { code: "lorcana", label: "디즈니 로르카나" },
] as const;

export type KreamGameCode = (typeof KREAM_GAME_OPTIONS)[number]["code"];

// Photo recognition also covers games without a domestic market category.
export const PHOTO_GAME_OPTIONS = [
  ...KREAM_GAME_OPTIONS,
  { code: "weiss_schwarz", label: "바이스 슈바르츠" },
] as const;

export function marketSearchPlaceholder(game: KreamGameCode, koreanMarket: boolean): string {
  const examples: Partial<Record<KreamGameCode, readonly [string, string]>> = {
    pokemon: ["예: 피카츄, 리자몽, SV2a", "예: Pikachu, Charizard"],
    one_piece: ["예: 루피, 조로, OP01", "예: Monkey.D.Luffy, Roronoa Zoro"],
    yugioh: ["예: 푸른 눈의 백룡, 블랙 매지션", "예: Blue-Eyes White Dragon, Dark Magician"],
    dragon_ball: ["예: 손오공, 베지터", "예: Son Goku, Vegeta"],
    riftbound: ["예: 징크스, 야스오", "예: Jinx, Yasuo"],
    magic: ["예: Black Lotus, Lightning Bolt", "예: Black Lotus, Lightning Bolt"],
  };
  return (
    examples[game]?.[koreanMarket ? 0 : 1] ??
    (koreanMarket ? "이 카테고리의 카드명 또는 카드 번호" : "이 카테고리의 영문 카드명")
  );
}
