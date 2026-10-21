export {
  api,
  useDavaq,
  useDavaqMutation,
  key,
  errorText,
  dateLabel,
} from "./davaq";
export type CatalogCard = {
  id: string;
  saveId: string;
  saveAllowed?: boolean;
  title: string;
  identifier?: string;
  imageSrc?: string;
  amount: number | null;
  price?: string;
  priceLabel?: string;
  observedAt?: string;
  gameCode: string;
  badges?: string[];
};
export type Detail = {
  target: {
    id: string;
    name: string;
    href: string;
    game: string;
    number: string | null;
    set: string | null;
    region: string;
    currency: string;
    condition: string;
    value: number | null;
    observedAt: string | null;
    imageSrc?: string;
    priceType: string;
  };
  history: { date: string; amount: number; currency: string }[];
};
export type Owned = {
  id: string;
  card_id: string;
  card_name: string;
  quantity: number;
  reserved: number;
  condition: string;
  photos: string[];
  image_src?: string | null;
  purchase_price: number | null;
  folder: string;
  note: string;
  listing_id?: string;
};
export type Want = {
  image_src?: string | null;
  id: string;
  card_id: string;
  card_name: string;
  quantity: number;
  conditions: string[];
  max_price: number | null;
  mode: string;
  region: string;
  delivery: string;
};
export type Listing = {
  map_lat?: number | null;
  map_lng?: number | null;
  id: string;
  owner_id: string;
  owner_name: string;
  collection_id: string;
  card_id: string;
  card_name: string;
  condition: string;
  photos: string[];
  quantity: number;
  available: number;
  price: number | null;
  mode: string;
  wanted_card_ids: string[];
  wanted_card_names?: string[];
  region: string;
  delivery: string;
  description: string;
  status: string;
  version: number;
};
export type Trade = {
  id: string;
  buyer_id: string;
  seller_id: string;
  room_id: string;
  status: string;
  version: number;
  kind: string;
  quantity: number;
  offered_quantity: number;
  cash: number;
  note: string;
  snapshot: { target: Listing; offered: Listing | null };
  actions?: { user_id: string; kind: string }[];
  viewerId?: string;
};
export type Page<T> = { items: T[] };
export const CONDITIONS = [
  ["NM", "상태 좋음"],
  ["LP", "가벼운 사용감"],
  ["MP", "사용감 있음"],
  ["HP", "손상 있음"],
  ["DMG", "큰 손상"],
] as const;
export const conditionName = (c: string) =>
  CONDITIONS.find((v) => v[0] === c)?.[1] ?? c;
export const statusName = (c: string) =>
  ({
    proposed: "제안·협의 중",
    confirmed: "거래 확정",
    completed: "완료",
    cancelled: "취소",
    declined: "거절",
    disputed: "분쟁 확인 중",
  })[c] ?? c;
export const money = (n: number | null | undefined, c = "KRW") =>
  n == null
    ? "가격 미확인"
    : new Intl.NumberFormat("ko-KR", {
        style: "currency",
        currency: c,
        maximumFractionDigits: c === "KRW" ? 0 : 2,
      }).format(n);
export const cardImage = (s: string | undefined | null) =>
  s ? (s.startsWith("/") ? "https://tcgindex.org" + s : s) : undefined;
export const cardLink = (id: string, name: string) =>
  ("/tcg/card/detail?id=" +
    encodeURIComponent(id) +
    "&name=" +
    encodeURIComponent(name)) as any;
