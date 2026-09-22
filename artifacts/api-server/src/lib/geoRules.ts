import { z } from "zod/v4";
export const coordinateInput = z.object({
  lat: z.number().finite().min(-85).max(85),
  lng: z.number().finite().min(-180).max(180),
});
export const meetingPointInput = coordinateInput
  .extend({ label: z.string().trim().min(2).max(80) })
  .strict()
  .transform((p) => ({
    ...p,
    lat: Number(p.lat.toFixed(5)),
    lng: Number(p.lng.toFixed(5)),
  }));
export const listingGeoInput = coordinateInput
  .extend({
    label: z.string().trim().min(2).max(80),
    precision: z.enum(["area", "place"]),
  })
  .strict()
  .transform((p) => ({
    ...p,
    lat: Number(p.lat.toFixed(p.precision === "area" ? 2 : 5)),
    lng: Number(p.lng.toFixed(p.precision === "area" ? 2 : 5)),
  }));
export function listingGeoDto(row: any) {
  if (row.delivery === "online" || row.map_lat == null || row.map_lng == null)
    return null;
  const parsed = listingGeoInput.safeParse({
    lat: Number(row.map_lat),
    lng: Number(row.map_lng),
    label: row.map_label,
    precision: row.map_precision,
  });
  return parsed.success ? parsed.data : null;
}
export function searchBounds(lat: number, lng: number, radius: number) {
  const deltaLat = radius / 110.5,
    deltaLng = Math.min(
      180,
      radius / (110.5 * Math.max(0.01, Math.cos((lat * Math.PI) / 180))),
    );
  return {
    south: Math.max(-85, lat - deltaLat),
    north: Math.min(85, lat + deltaLat),
    deltaLng,
  };
}
