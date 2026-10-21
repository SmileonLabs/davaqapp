// @ts-nocheck -- exercised by the API workspace's Vitest runner.
import { afterEach, describe, expect, it, vi } from "vitest";

const storage = vi.hoisted(() => new Map<string, string>());
const customFetch = vi.hoisted(() => vi.fn());

vi.mock("@react-native-async-storage/async-storage", () => ({
  default: {
    getItem: vi.fn(async (key: string) => storage.get(key) ?? null),
    setItem: vi.fn(async (key: string, value: string) => {
      storage.set(key, value);
    }),
    removeItem: vi.fn(async (key: string) => {
      storage.delete(key);
    }),
  },
}));

vi.mock("@workspace/api-client-react", () => ({ customFetch }));

const {
  configureCallReliabilityOwner,
  flushCallDiagnostics,
  joinTrackedCall,
  reportCallDiagnostic,
  resolveTrackedCallAttempt,
  installCallReliabilityFlushTriggers,
} = await import("./callApi");

describe("call reliability queue ownership", () => {
  afterEach(() => {
    configureCallReliabilityOwner(null);
    storage.clear();
    customFetch.mockReset();
    vi.unstubAllGlobals();
  });

  it("mounts and cleans up on React Native where window has no DOM functions", () => {
    vi.stubGlobal("window", {});
    const cleanup = installCallReliabilityFlushTriggers();
    expect(() => cleanup()).not.toThrow();
  });

  it("still flushes on browser reconnect and removes its listener", () => {
    const addEventListener = vi.fn();
    const removeEventListener = vi.fn();
    vi.stubGlobal("window", { addEventListener, removeEventListener });
    const cleanup = installCallReliabilityFlushTriggers();
    expect(addEventListener).toHaveBeenCalledWith("online", expect.any(Function));
    cleanup();
    expect(removeEventListener).toHaveBeenCalledWith("online", addEventListener.mock.calls[0][1]);
  });

  it("aborts account A's in-flight flush before account B can inherit it", async () => {
    let resolveB: (() => void) | undefined;
    customFetch.mockImplementation((_path: string, init: RequestInit) => {
      if (customFetch.mock.calls.length > 1) {
        return new Promise<void>((resolve) => {
          resolveB = resolve;
        });
      }
      return new Promise((_resolve, reject) => {
        const signal = init.signal;
        if (signal?.aborted) {
          reject(new Error("aborted"));
          return;
        }
        signal?.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
      });
    });

    configureCallReliabilityOwner("user-a");
    reportCallDiagnostic(null, {
      attemptId: "10000000-0000-4000-8000-000000000001",
      phase: "preflight_failed",
      platform: "ios",
    });

    await vi.waitFor(() => expect(customFetch).toHaveBeenCalledTimes(1));
    const signal = customFetch.mock.calls[0][1].signal as AbortSignal;
    expect(signal.aborted).toBe(false);

    configureCallReliabilityOwner("user-b");
    await vi.waitFor(() => expect(signal.aborted).toBe(true));
    reportCallDiagnostic(null, {
      attemptId: "10000000-0000-4000-8000-000000000002",
      phase: "rejoin_started",
      platform: "ios",
    });
    await vi.waitFor(() => expect(customFetch).toHaveBeenCalledTimes(2));

    // A's rejected promise may finish now, but it must not clear B's active
    // single-flight and cause a duplicate third send.
    const existingBFlush = flushCallDiagnostics();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(customFetch).toHaveBeenCalledTimes(2);
    resolveB?.();
    await existingBFlush;
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(customFetch).toHaveBeenCalledTimes(2);
    expect([...storage.keys()]).toContain("anotherme.call-diagnostics.v2.user-a");
    expect(storage.has("anotherme.call-diagnostics.v2.user-b")).toBe(false);
    expect(storage.has("anotherme.call-diagnostics.v2")).toBe(false);
  });

  it("resolves an existing call with a header-free read and reuses only its durable attempt", async () => {
    customFetch
      .mockResolvedValueOnce({ attemptId: "10000000-0000-4000-8000-000000000003" })
      .mockResolvedValueOnce({ attemptId: null });

    await expect(resolveTrackedCallAttempt("call-new")).resolves.toMatchObject({
      attemptId: "10000000-0000-4000-8000-000000000003",
    });
    await expect(resolveTrackedCallAttempt("call-legacy")).resolves.toMatchObject({
      attemptId: undefined,
    });

    expect(customFetch.mock.calls[0]).toEqual([
      "/api/calls/call-new",
      expect.objectContaining({ method: "GET", responseType: "json" }),
    ]);
    expect(customFetch.mock.calls[0][1].headers).toBeUndefined();
  });

  it("does not run a control retry after account ownership changes", async () => {
    customFetch.mockRejectedValueOnce(new Error("network_down"));
    configureCallReliabilityOwner("user-a");

    const request = joinTrackedCall(
      "call-a",
      "10000000-0000-4000-8000-000000000004",
    );
    await vi.waitFor(() => expect(customFetch).toHaveBeenCalledTimes(1));
    configureCallReliabilityOwner("user-b");

    await expect(request).rejects.toThrow("network_down");
    expect(customFetch).toHaveBeenCalledTimes(1);
  });
});
