import { describe, it, expect } from "vitest";
import {
  listingGeoInput,
  meetingPointInput,
  listingGeoDto,
  searchBounds,
} from "./geoRules";
describe("location disclosure", () => {
  it("rounds area data before storage and preserves explicitly public places", () => {
    const p = { lat: 37.561234, lng: 126.987654, label: "선택한 동네" };
    expect(listingGeoInput.parse({ ...p, precision: "area" })).toMatchObject({
      lat: 37.56,
      lng: 126.99,
    });
    expect(listingGeoInput.parse({ ...p, precision: "place" })).toMatchObject({
      lat: 37.56123,
      lng: 126.98765,
    });
  });
  it("rejects nonfinite/out of range coordinates and arbitrary extra fields", () => {
    for (const lat of [NaN, Infinity, 86])
      expect(
        meetingPointInput.safeParse({ lat, lng: 127, label: "장소" }).success,
      ).toBe(false);
    expect(
      meetingPointInput.safeParse({
        lat: 37,
        lng: 127,
        label: "장소",
        url: "x",
      }).success,
    ).toBe(false);
  });
  it("does not expose online or invalid legacy map data", () => {
    expect(
      listingGeoDto({
        delivery: "online",
        map_lat: 37,
        map_lng: 127,
        map_label: "장소",
        map_precision: "place",
      }),
    ).toBeNull();
    expect(listingGeoDto({ delivery: "offline", map_lat: 37 })).toBeNull();
  });
  it("bounds radius searches including high latitudes", () => {
    expect(searchBounds(37, 127, 5).north).toBeGreaterThan(37);
    expect(searchBounds(85, 180, 50).north).toBe(85);
    expect(searchBounds(85, 180, 50).deltaLng).toBeLessThanOrEqual(180);
  });
});
