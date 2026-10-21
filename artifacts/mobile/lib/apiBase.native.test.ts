// @ts-nocheck -- exercised with the API workspace's Vitest runner.
import { afterEach, expect, it, vi } from "vitest";
const platform = vi.hoisted(() => ({ OS: "ios" }));
vi.mock("react-native", () => ({ Platform: platform }));
const { getApiBase } = await import("./apiBase");
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); platform.OS = "ios"; });
it("uses the configured server on native even when window exists", () => {
  vi.stubGlobal("window", {});
  vi.stubEnv("EXPO_PUBLIC_API_BASE_URL", "https://api.example.test/");
  expect(getApiBase()).toBe("https://api.example.test");
});
it("keeps browser requests on the current origin", () => {
  platform.OS = "web";
  vi.stubGlobal("window", { location: { origin: "https://web.example.test" } });
  vi.stubEnv("EXPO_PUBLIC_API_BASE_URL", "https://api.example.test");
  expect(getApiBase()).toBe("https://web.example.test");
});
