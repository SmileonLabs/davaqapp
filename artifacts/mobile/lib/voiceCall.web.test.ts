// @ts-nocheck -- browser/LiveKit fault injection, run with the API Vitest binary.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ rooms: [], capturedMicrophones: [], microphone: vi.fn(), microphonePublish: vi.fn(), publish: vi.fn(), cameraSet: vi.fn() }));

vi.mock("livekit-client", async () => {
  const { EventEmitter } = await import("node:events");
  class FakeRoom extends EventEmitter {
    state = "connected";
    canPlaybackAudio = true;
    remoteParticipants = new Map();
    localParticipant;
    connect = vi.fn(async () => {});
    startAudio = vi.fn(async () => {});
    disconnect = vi.fn(async () => { this.state = "disconnected"; });
    constructor() {
      super();
      const publications = new Map();
      const local = {
        trackPublications: publications,
        isMicrophoneEnabled: true,
        isCameraEnabled: false,
        getTrackPublication: (source) => publications.get(source),
        setMicrophoneEnabled: vi.fn(async () => {
          await mocks.microphone();
          const mediaStreamTrack = new EventTarget();
          Object.assign(mediaStreamTrack, { readyState: "live", enabled: true, muted: false, stop: vi.fn() });
          publications.set("microphone", { track: { mediaStreamTrack } });
        }),
        setCameraEnabled: vi.fn(async (enabled) => {
          await mocks.cameraSet(enabled);
          const publication = publications.get("camera");
          if (publication) {
            publication.isMuted = !enabled;
            publication.track.mediaStreamTrack.enabled = enabled;
          }
          local.isCameraEnabled = enabled;
        }),
        publishTrack: vi.fn(async (input, options) => {
          const source = options?.source ?? "camera";
          await (source === "microphone" ? mocks.microphonePublish() : mocks.publish());
          const track = input.mediaStreamTrack ? input : { mediaStreamTrack: input };
          const publication = { track, isMuted: false };
          publications.set(source, publication);
          if (source === "camera") local.isCameraEnabled = true;
          this.emit("LocalTrackPublished", publication);
          return publication;
        }),
        unpublishTrack: vi.fn(async (track) => {
          if (publications.get("camera")?.track === track) publications.delete("camera");
          if (publications.get("microphone")?.track === track) publications.delete("microphone");
        }),
      };
      this.localParticipant = local;
      mocks.rooms.push(this);
    }
  }
  return {
    createLocalAudioTrack: vi.fn(async () => {
      await mocks.microphone();
      const mediaStreamTrack = new EventTarget();
      Object.assign(mediaStreamTrack, { kind: "audio", readyState: "live", enabled: true, muted: false });
      const track = { mediaStreamTrack, stop: vi.fn(() => { mediaStreamTrack.readyState = "ended"; }) };
      mocks.capturedMicrophones.push(track);
      return track;
    }),
    Room: FakeRoom,
    RoomEvent: new Proxy({}, { get: (_target, property) => property }),
    Track: { Source: { Camera: "camera", Microphone: "microphone" }, Kind: { Audio: "audio", Video: "video" } },
  };
});

vi.mock("nosleep.js", () => ({ default: class { isEnabled = false; disable() {} } }));

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

function cameraStream() {
  const track = new EventTarget();
  Object.assign(track, { kind: "video", readyState: "live", enabled: true, muted: false });
  track.stop = vi.fn(() => { track.readyState = "ended"; });
  return { track, getTracks: () => [track], getVideoTracks: () => [track] };
}

async function flush() {
  for (let i = 0; i < 20; i += 1) await Promise.resolve();
}

let api;
let getUserMedia;

beforeEach(async () => {
  vi.resetModules();
  vi.useFakeTimers();
  mocks.rooms.length = 0;
  mocks.capturedMicrophones.length = 0;
  mocks.microphone.mockReset().mockResolvedValue(undefined);
  mocks.microphonePublish.mockReset().mockResolvedValue(undefined);
  mocks.publish.mockReset().mockResolvedValue(undefined);
  mocks.cameraSet.mockReset().mockResolvedValue(undefined);
  getUserMedia = vi.fn();
  vi.stubGlobal("navigator", { mediaDevices: { getUserMedia } });
  vi.stubGlobal("document", Object.assign(new EventTarget(), {
    hidden: false,
    visibilityState: "visible",
    querySelectorAll: () => [],
  }));
  vi.stubGlobal("window", new EventTarget());
  api = await import("./voiceCall.web");
});

afterEach(async () => {
  await api.leaveCall();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("web video call acquisition failure paths", () => {
  it("joins room and microphone while camera permission is unanswered, then reports its deadline", async () => {
    const capture = deferred();
    getUserMedia.mockReturnValue(capture.promise);
    const diagnostic = vi.fn();
    void api.prepareVideoCall(diagnostic);
    const joined = await api.joinCall("wss://test", "test-token", { media: "video", onDiagnostic: diagnostic });
    expect(joined).toMatchObject({ microphonePublished: true, cameraPublished: false, cameraPending: true });
    expect(joined.room.connect).toHaveBeenCalledOnce();
    expect(getUserMedia).toHaveBeenCalledOnce();

    await vi.advanceTimersByTimeAsync(12_000);
    expect(diagnostic).toHaveBeenCalledWith("web_camera_capture_failed", { errorName: "CameraCaptureTimeout" });
    expect(diagnostic).toHaveBeenCalledWith("web_camera_publish_result", { cameraPublished: false });
    expect(joined.room.disconnect).not.toHaveBeenCalled();
    const late = cameraStream();
    capture.resolve(late);
    await flush();
    expect(late.track.stop).toHaveBeenCalled();
    expect(joined.room.localParticipant.publishTrack.mock.calls.filter(([, options]) => options?.source === "camera")).toHaveLength(0);
  });

  it("keeps gesture capture ownership across room creation and publishes its eventual track", async () => {
    const capture = deferred();
    getUserMedia.mockReturnValue(capture.promise);
    const diagnostic = vi.fn();
    void api.prepareVideoCall(diagnostic);
    const joined = await api.joinCall("wss://test", "test-token", { media: "video", onDiagnostic: diagnostic });
    const stream = cameraStream();
    capture.resolve(stream);
    await flush();
    expect(getUserMedia).toHaveBeenCalledOnce();
    expect(stream.track.stop).not.toHaveBeenCalled();
    expect(joined.room.localParticipant.publishTrack).toHaveBeenCalledWith(stream.track, { source: "camera" });
    expect(diagnostic).toHaveBeenCalledWith("web_camera_publish_result", { cameraPublished: true });
  });

  it("keeps camera denial from ending available audio", async () => {
    const denial = new Error("not logged");
    denial.name = "NotAllowedError";
    getUserMedia.mockRejectedValue(denial);
    const diagnostic = vi.fn();
    const joined = await api.joinCall("wss://test", "test-token", { media: "video", onDiagnostic: diagnostic });
    await flush();
    expect(joined.microphonePublished).toBe(true);
    expect(joined.room.disconnect).not.toHaveBeenCalled();
    expect(diagnostic).toHaveBeenCalledWith("web_camera_capture_failed", { errorName: "NotAllowedError" });
    expect(diagnostic).toHaveBeenCalledWith("web_camera_publish_result", { cameraPublished: false });
    expect(getUserMedia).toHaveBeenCalledOnce();
  });

  it("never launches a second capture while the timed-out browser request is still pending", async () => {
    const capture = deferred();
    getUserMedia.mockReturnValue(capture.promise);
    const first = api.prepareVideoCall();
    await vi.advanceTimersByTimeAsync(12_000);
    await first;
    await api.prepareVideoCall();
    expect(getUserMedia).toHaveBeenCalledOnce();
    capture.resolve(cameraStream());
    await flush();
    getUserMedia.mockResolvedValue(cameraStream());
    await api.prepareVideoCall();
    expect(getUserMedia).toHaveBeenCalledTimes(2);
  });

  it("stops a permission result arriving after hangup and does not publish it into the next call", async () => {
    const capture = deferred();
    getUserMedia.mockReturnValue(capture.promise);
    void api.prepareVideoCall();
    await api.joinCall("wss://test", "call-a", { media: "video" });
    await api.leaveCall();
    const next = await api.joinCall("wss://test", "call-b", { media: "audio" });
    const late = cameraStream();
    capture.resolve(late);
    await flush();
    expect(late.track.stop).toHaveBeenCalled();
    expect(next.room.localParticipant.publishTrack.mock.calls.filter(([, options]) => options?.source === "camera")).toHaveLength(0);
    expect(next.room.disconnect).not.toHaveBeenCalled();
  });

  it("bounds an unanswered microphone permission request and stops a late unpublished capture", async () => {
    const microphone = deferred();
    mocks.microphone.mockReturnValue(microphone.promise);
    const diagnostic = vi.fn();
    const join = api.joinCall("wss://test", "test-token", { onDiagnostic: diagnostic });
    const rejected = expect(join).rejects.toThrow("MicrophoneCaptureTimeout");
    await flush();
    await vi.advanceTimersByTimeAsync(45_000);
    await rejected;
    expect(mocks.rooms[0].disconnect).toHaveBeenCalledOnce();
    expect(diagnostic).toHaveBeenCalledWith("web_microphone_capture_start");
    expect(diagnostic).toHaveBeenCalledWith("web_microphone_publish_failed", { errorName: "MicrophoneCaptureTimeout" });
    microphone.resolve();
    await flush();
    expect(mocks.capturedMicrophones[0].stop).toHaveBeenCalled();
    expect(mocks.rooms[0].localParticipant.getTrackPublication("microphone")).toBeUndefined();
  });

  it("stops captured audio when publication stalls and removes its late publication", async () => {
    const publication = deferred();
    mocks.microphonePublish.mockReturnValue(publication.promise);
    const join = api.joinCall("wss://test", "test-token");
    const rejected = expect(join).rejects.toThrow("MicrophonePublishTimeout");
    await flush();
    await vi.advanceTimersByTimeAsync(20_000);
    await rejected;
    expect(mocks.capturedMicrophones[0].stop).toHaveBeenCalled();
    publication.resolve();
    await flush();
    expect(mocks.rooms[0].localParticipant.getTrackPublication("microphone")).toBeUndefined();
  });

  it("allows a user to answer the microphone prompt after thirty seconds", async () => {
    const permission = deferred();
    mocks.microphone.mockReturnValue(permission.promise);
    const join = api.joinCall("wss://test", "test-token");
    await flush();
    await vi.advanceTimersByTimeAsync(30_000);
    expect(mocks.rooms[0].disconnect).not.toHaveBeenCalled();
    permission.resolve();
    const result = await join;
    expect(result.microphonePublished).toBe(true);
  });

  it("stops microphone permission granted after hangup without touching a newer call", async () => {
    const permission = deferred();
    mocks.microphone.mockReturnValueOnce(permission.promise);
    const first = api.joinCall("wss://test", "call-a");
    const rejected = expect(first).rejects.toThrow("stale_join_attempt");
    await flush();
    await api.leaveCall();
    const next = await api.joinCall("wss://test", "call-b");
    const nextMicrophone = next.room.localParticipant.getTrackPublication("microphone").track;
    permission.resolve();
    await rejected;
    expect(mocks.capturedMicrophones[1].stop).toHaveBeenCalled();
    expect(nextMicrophone.stop).not.toHaveBeenCalled();
    expect(next.room.disconnect).not.toHaveBeenCalled();
  });

  it("actually unmutes a retained live camera track after OFF then ON", async () => {
    getUserMedia.mockResolvedValue(cameraStream());
    const joined = await api.joinCall("wss://test", "test-token", { media: "video" });
    await flush();
    expect(await api.setCameraEnabled(false)).toBe(true);
    const publication = joined.room.localParticipant.getTrackPublication("camera");
    expect(publication.track.mediaStreamTrack.enabled).toBe(false);
    expect(await api.setCameraEnabled(true)).toBe(true);
    expect(joined.room.localParticipant.setCameraEnabled).toHaveBeenLastCalledWith(true, expect.any(Object));
    expect(publication.track.mediaStreamTrack.enabled).toBe(true);
    expect(publication.isMuted).toBe(false);
  });

  it("stops and unpublishes a camera publication that resolves after its deadline", async () => {
    const publish = deferred();
    mocks.publish.mockReturnValue(publish.promise);
    const stream = cameraStream();
    getUserMedia.mockResolvedValue(stream);
    const diagnostic = vi.fn();
    const joined = await api.joinCall("wss://test", "test-token", { media: "video", onDiagnostic: diagnostic });
    await flush();
    await vi.advanceTimersByTimeAsync(12_000);
    expect(stream.track.stop).toHaveBeenCalled();
    expect(joined.room.disconnect).not.toHaveBeenCalled();
    publish.resolve();
    await flush();
    expect(joined.room.localParticipant.getTrackPublication("camera")).toBeUndefined();
    expect(diagnostic).toHaveBeenCalledWith("web_camera_publish_result", { cameraPublished: false });
  });

  it("switches camera through the bounded acquisition path without replacing the microphone", async () => {
    const first = cameraStream();
    const second = cameraStream();
    getUserMedia.mockResolvedValueOnce(first).mockResolvedValueOnce(second);
    const joined = await api.joinCall("wss://test", "test-token", { media: "video" });
    await flush();
    const microphone = joined.room.localParticipant.getTrackPublication("microphone");
    expect(await api.switchCamera()).toBe("environment");
    expect(first.track.stop).toHaveBeenCalled();
    expect(second.track.stop).not.toHaveBeenCalled();
    expect(getUserMedia).toHaveBeenLastCalledWith({
      audio: false,
      video: expect.objectContaining({ facingMode: "environment" }),
    });
    expect(joined.room.localParticipant.getTrackPublication("camera").track.mediaStreamTrack).toBe(second.track);
    expect(joined.room.localParticipant.getTrackPublication("microphone")).toBe(microphone);
    expect(joined.room.localParticipant.publishTrack).toHaveBeenCalledWith(microphone.track, { source: "microphone" });
  });

  it("replaces an ended, muted camera with a live unmuted publication on ON", async () => {
    const first = cameraStream();
    const second = cameraStream();
    getUserMedia.mockResolvedValueOnce(first).mockResolvedValueOnce(second);
    const joined = await api.joinCall("wss://test", "test-token", { media: "video" });
    await flush();
    await api.setCameraEnabled(false);
    const old = joined.room.localParticipant.getTrackPublication("camera");
    first.track.stop();
    expect(old.isMuted).toBe(true);
    expect(await api.setCameraEnabled(true)).toBe(true);
    const replacement = joined.room.localParticipant.getTrackPublication("camera");
    expect(replacement).not.toBe(old);
    expect(replacement.isMuted).toBe(false);
    expect(replacement.track.mediaStreamTrack).toBe(second.track);
    expect(second.track.enabled).toBe(true);
    expect(second.track.readyState).toBe("live");
  });

  it("does not reuse an invalidated camera capture result after OFF then ON", async () => {
    const capture = deferred();
    const replacement = cameraStream();
    getUserMedia.mockReturnValueOnce(capture.promise).mockResolvedValueOnce(replacement);
    const diagnostic = vi.fn();
    const joined = await api.joinCall("wss://test", "test-token", { media: "video", onDiagnostic: diagnostic });
    await api.setCameraEnabled(false);
    const enabled = api.setCameraEnabled(true);
    const old = cameraStream();
    capture.resolve(old);
    expect(await enabled).toBe(true);
    expect(old.track.stop).toHaveBeenCalled();
    expect(replacement.track.stop).not.toHaveBeenCalled();
    expect(getUserMedia).toHaveBeenCalledTimes(2);
    expect(joined.room.localParticipant.getTrackPublication("camera").track.mediaStreamTrack).toBe(replacement.track);
    expect(diagnostic).not.toHaveBeenCalledWith("web_camera_publish_result", { cameraPublished: false });
  });

  it("discards a superseded publication before fulfilling the newest ON intent", async () => {
    const pending = deferred();
    mocks.publish.mockReturnValueOnce(pending.promise);
    const old = cameraStream();
    const replacement = cameraStream();
    getUserMedia.mockResolvedValueOnce(old).mockResolvedValueOnce(replacement);
    const joined = await api.joinCall("wss://test", "test-token", { media: "video" });
    await flush();
    await api.setCameraEnabled(false);
    const enabled = api.setCameraEnabled(true);
    pending.resolve();
    expect(await enabled).toBe(true);
    expect(old.track.stop).toHaveBeenCalled();
    const current = joined.room.localParticipant.getTrackPublication("camera");
    expect(current.track.mediaStreamTrack).toBe(replacement.track);
    expect(current.isMuted).toBe(false);
  });

  it("waits for an earlier SDK OFF before unmuting the retained camera for the latest ON", async () => {
    getUserMedia.mockResolvedValue(cameraStream());
    const joined = await api.joinCall("wss://test", "test-token", { media: "video" });
    await flush();
    const pending = deferred();
    mocks.cameraSet.mockReturnValueOnce(pending.promise);
    const disabled = api.setCameraEnabled(false);
    const enabled = api.setCameraEnabled(true);
    await flush();
    expect(joined.room.localParticipant.setCameraEnabled).toHaveBeenCalledTimes(1);
    pending.resolve();
    await disabled;
    expect(await enabled).toBe(true);
    const current = joined.room.localParticipant.getTrackPublication("camera");
    expect(current.isMuted).toBe(false);
    expect(current.track.mediaStreamTrack.enabled).toBe(true);
  });

  it("does not allow a late SDK ON to re-enable video after a newer OFF", async () => {
    getUserMedia.mockResolvedValue(cameraStream());
    const joined = await api.joinCall("wss://test", "test-token", { media: "video" });
    await flush();
    await api.setCameraEnabled(false);
    const pending = deferred();
    mocks.cameraSet.mockReturnValueOnce(pending.promise);
    const enabled = api.setCameraEnabled(true);
    await api.setCameraEnabled(false);
    pending.resolve();
    expect(await enabled).toBe(false);
    await flush();
    const current = joined.room.localParticipant.getTrackPublication("camera");
    expect(current.isMuted).toBe(true);
    expect(current.track.mediaStreamTrack.enabled).toBe(false);
  });

  it("does not overlap a retry with an SDK publication still pending after its deadline", async () => {
    const pending = deferred();
    mocks.publish.mockReturnValueOnce(pending.promise);
    getUserMedia.mockImplementation(async () => cameraStream());
    const joined = await api.joinCall("wss://test", "test-token", { media: "video" });
    await flush();
    await vi.advanceTimersByTimeAsync(12_000);
    expect(await api.setCameraEnabled(true)).toBe(false);
    expect(joined.room.localParticipant.publishTrack.mock.calls.filter(([, options]) => options?.source === "camera")).toHaveLength(1);
    pending.resolve();
    await flush();
    expect(await api.setCameraEnabled(true)).toBe(true);
    expect(joined.room.localParticipant.publishTrack.mock.calls.filter(([, options]) => options?.source === "camera")).toHaveLength(2);
    const current = joined.room.localParticipant.getTrackPublication("camera");
    expect(current.track.mediaStreamTrack.readyState).toBe("live");
  });
});
