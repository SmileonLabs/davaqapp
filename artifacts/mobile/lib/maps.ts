export type Coordinate = { lat: number; lng: number };
export type MeetingPoint = Coordinate & { label: string };
export type ListingGeo = MeetingPoint & { precision: "area" | "place" };
export type MapMarker = Coordinate & {
  id: string;
  title: string;
  precision?: "area" | "place";
};
export type MapCanvasProps = {
  center: Coordinate;
  markers: MapMarker[];
  selectedId?: string;
  pickable?: boolean;
  height?: number;
  zoom?: number;
  focusToken?: number;
  onSelect?: (id: string) => void;
  onPick?: (p: Coordinate) => void;
  onMove?: (p: Coordinate) => void;
};
export const regions = [
  { label: "서울", lat: 37.57, lng: 126.98 },
  { label: "강남", lat: 37.5, lng: 127.03 },
  { label: "성수", lat: 37.54, lng: 127.06 },
  { label: "홍대", lat: 37.56, lng: 126.92 },
  { label: "잠실", lat: 37.51, lng: 127.1 },
  { label: "부산", lat: 35.18, lng: 129.08 },
  { label: "인천", lat: 37.46, lng: 126.7 },
  { label: "대구", lat: 35.87, lng: 128.6 },
  { label: "대전", lat: 36.35, lng: 127.38 },
  { label: "광주", lat: 35.16, lng: 126.85 },
  { label: "울산", lat: 35.54, lng: 129.31 },
  { label: "세종", lat: 36.48, lng: 127.29 },
  { label: "수원", lat: 37.26, lng: 127.03 },
  { label: "성남", lat: 37.42, lng: 127.13 },
  { label: "고양", lat: 37.66, lng: 126.83 },
  { label: "춘천", lat: 37.88, lng: 127.73 },
  { label: "강릉", lat: 37.75, lng: 128.88 },
  { label: "청주", lat: 36.64, lng: 127.49 },
  { label: "천안", lat: 36.82, lng: 127.15 },
  { label: "전주", lat: 35.82, lng: 127.15 },
  { label: "여수", lat: 34.76, lng: 127.66 },
  { label: "포항", lat: 36.02, lng: 129.34 },
  { label: "창원", lat: 35.23, lng: 128.68 },
  { label: "제주", lat: 33.5, lng: 126.53 },
];
export const approximate = (p: Coordinate): Coordinate => ({
  lat: Number(p.lat.toFixed(2)),
  lng: Number(p.lng.toFixed(2)),
});
export const validCoordinate = (p: any): p is Coordinate =>
  !!p &&
  Number.isFinite(p.lat) &&
  Number.isFinite(p.lng) &&
  Math.abs(p.lat) <= 85 &&
  Math.abs(p.lng) <= 180;
export const directionUrl = (p: MeetingPoint) =>
  "https://map.kakao.com/link/to/" +
  encodeURIComponent(p.label) +
  "," +
  p.lat +
  "," +
  p.lng;
