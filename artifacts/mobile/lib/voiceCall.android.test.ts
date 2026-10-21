// @ts-nocheck -- native media fault injection, run with the API Vitest binary.
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ rooms: [], capture: vi.fn(), publish: vi.fn(), mediaStarted: vi.fn() }));
vi.mock("@livekit/react-native", () => ({ registerGlobals: vi.fn(), AudioSession: { configureAudio: vi.fn(async () => {}) }, AndroidAudioTypePresets: { communication: {} } }));
vi.mock("react-native", () => ({ Platform: { OS: "android" }, PermissionsAndroid: {
  PERMISSIONS: { CAMERA: "camera", RECORD_AUDIO: "mic" }, RESULTS: { GRANTED: "granted" },
  requestMultiple: vi.fn(async list => Object.fromEntries(list.map(p => [p, "granted"]))),
} }));
vi.mock("./androidTelecom.android", () => ({ telecom: { mediaStarted: mocks.mediaStarted } }));
vi.mock("livekit-client", async () => {
  const { EventEmitter } = await import("node:events");
  class Room extends EventEmitter {
    state = "connected";
    remoteParticipants = new Map();
    connect = vi.fn(async () => {});
    disconnect = vi.fn(async () => { this.state = "disconnected"; });
    localParticipant;
    constructor() {
      super(); const publications = new Map();
      this.localParticipant = {
        trackPublications: publications, isMicrophoneEnabled: true, isCameraEnabled: false,
        getTrackPublication: source => publications.get(source),
        setMicrophoneEnabled: vi.fn(async () => { publications.set("microphone", { track: { mediaStreamTrack: { stop: vi.fn(), readyState: "live" } } }); }),
        setCameraEnabled: vi.fn(async enabled => { this.localParticipant.isCameraEnabled = enabled; }),
        publishTrack: vi.fn(async (track, options) => {
          await mocks.publish(); const publication = { track, isMuted: false };
          publications.set(options.source, publication); this.localParticipant.isCameraEnabled = true;
          return publication;
        }),
        unpublishTrack: vi.fn(async track => {
          if (publications.get("camera")?.track === track) publications.delete("camera");
        }),
      }; mocks.rooms.push(this);
    }
  }
  return { Room, createLocalVideoTrack: (...args) => mocks.capture(...args), Track: { Source: { Camera: "camera", Microphone: "microphone" } }, RoomEvent: new Proxy({}, { get: (_, name) => name }) };
});
function deferred() { let resolve; const promise = new Promise(res => { resolve = res; }); return { promise, resolve }; }
function camera() { const mediaStreamTrack = { readyState: "live", stop: vi.fn() }; return { mediaStreamTrack, stop: vi.fn(() => { mediaStreamTrack.readyState = "ended"; }) }; }
async function flush() { for (let i = 0; i < 40; i++) await Promise.resolve(); }
let api;
beforeEach(async () => {
  vi.resetModules(); vi.useFakeTimers(); mocks.rooms.length = 0;
  mocks.capture.mockReset(); mocks.publish.mockReset().mockResolvedValue(undefined); mocks.mediaStarted.mockReset().mockResolvedValue(undefined);
  api = await import("./voiceCall.android");
});
afterEach(async () => { await api.leaveCall(); vi.useRealTimers(); });
it("exposes a connected room and microphone while native camera capture remains pending", async () => {
  const capture = deferred(); mocks.capture.mockReturnValue(capture.promise);
  let result; const joining = api.joinCall("wss://test.invalid", "test", { callId: "test-call", media: "video" }).then(value => { result = value; });
  await flush(); expect(result?.microphonePublished).toBe(true); expect(result?.cameraPending).toBe(true);
  const track = camera(); capture.resolve(track); await joining; await flush();
  expect(result.room.localParticipant.publishTrack).toHaveBeenCalledWith(track, { source: "camera" });
});
it("times out camera capture without ending audio and stops a later camera result", async () => {
  const capture = deferred(), diagnostic = vi.fn(); mocks.capture.mockReturnValue(capture.promise);
  const result = await api.joinCall("wss://test.invalid", "test", { callId: "test-call", media: "video", onDiagnostic: diagnostic });
  await vi.advanceTimersByTimeAsync(12_001); expect(result.room.disconnect).not.toHaveBeenCalled();
  expect(diagnostic).toHaveBeenCalledWith("native_camera_publish_result", { cameraPublished: false });
  const late = camera(); capture.resolve(late); await flush();
  expect(late.stop).toHaveBeenCalled(); expect(result.room.localParticipant.publishTrack).not.toHaveBeenCalled();
});
it("late capture after hangup cannot publish into or stop the next call", async () => {
  const capture = deferred(); mocks.capture.mockReturnValue(capture.promise);
  const old = await api.joinCall("wss://test.invalid", "test", { callId: "old", media: "video" });
  await api.leaveCall(old.room);
  const next = await api.joinCall("wss://test.invalid", "test", { callId: "next", media: "audio" });
  const late = camera(); capture.resolve(late); await flush();
  expect(late.stop).toHaveBeenCalled(); expect(old.room.localParticipant.publishTrack).not.toHaveBeenCalled();
  expect(next.room.disconnect).not.toHaveBeenCalled();
});
it("camera disabled while opening stops the pending track before it publishes", async () => {
  const capture = deferred(); mocks.capture.mockReturnValue(capture.promise);
  const result = await api.joinCall("wss://test.invalid", "test", { callId: "test-call", media: "video" });
  await api.setCameraEnabled(false); const late = camera(); capture.resolve(late); await flush();
  expect(late.stop).toHaveBeenCalled(); expect(result.room.localParticipant.publishTrack).not.toHaveBeenCalled();
});
it("a late publish after its timeout is unpublished while microphone stays connected", async () => {
  const publish = deferred(), track = camera(); mocks.capture.mockResolvedValue(track); mocks.publish.mockReturnValue(publish.promise);
  const result = await api.joinCall("wss://test.invalid", "test", { callId: "test-call", media: "video" });
  await flush(); await vi.advanceTimersByTimeAsync(20_001); publish.resolve(); await flush();
  expect(track.stop).toHaveBeenCalled(); expect(result.room.localParticipant.unpublishTrack).toHaveBeenCalledWith(track);
  expect(result.room.disconnect).not.toHaveBeenCalled();
});
