// Android LiveKit media engine. Core-Telecom owns system audio focus, routes
// and foreground-service lifetime; iOS keeps the existing default implementation.

import {
  AudioSession,
  AndroidAudioTypePresets,
  registerGlobals,
} from "@livekit/react-native";
import { Room, RoomEvent, Track, type LocalVideoTrack } from "livekit-client";
import { telecom } from "./androidTelecom.android";
import { PermissionsAndroid, Platform } from "react-native";

// Patch the global WebRTC objects (RTCPeerConnection, mediaDevices, …) onto the
// JS runtime so livekit-client's browser code paths work on React Native. Must
// run once, before any Room is constructed — module top-level guarantees that.
registerGlobals();

let currentSystemCallId: string | null = null;
export const voiceCallSupported = true;
export type CallMedia = "audio" | "video";
export type CallDiagnostic = (
  phase: string,
  details?: Record<string, unknown>,
) => void;
export interface CallJoinResult {
  room: Room;
  media: CallMedia;
  microphonePublished: boolean;
  cameraPublished: boolean;
  cameraPending?: boolean;
}

type Diagnostic = CallDiagnostic | undefined;

let room: Room | null = null;
let roomGeneration = 0;
const roomGenerations = new WeakMap<Room, number>();
const roomDisconnects = new WeakMap<Room, Promise<void>>();
let audioSessionActive = false;
let audioSessionGeneration: number | null = null;
let foregroundServiceGeneration: number | null = null;
let nativeResourceOperations: Promise<void> = Promise.resolve();
let cameraFacingMode: "user" | "environment" = "user";
let videoPreparePromise: Promise<void> | null = null;

const ROOM_DISCONNECT_TIMEOUT_MS = 4_000;

function serializeNativeResource<T>(operation: () => Promise<T>): Promise<T> {
  const result = nativeResourceOperations.then(operation, operation);
  nativeResourceOperations = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
}

async function settleWithin(
  promise: Promise<unknown>,
  timeoutMs: number,
): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  try {
    return await Promise.race([
      promise.then(
        () => true,
        () => true,
      ),
      new Promise<boolean>((resolve) => {
        timer = setTimeout(() => resolve(false), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function stopRoomMediaTracks(r: Room): void {
  for (const publication of r.localParticipant.trackPublications.values()) {
    try {
      publication.track?.mediaStreamTrack?.stop();
    } catch {}
  }
}

async function disconnectRoom(r: Room): Promise<void> {
  const existing = roomDisconnects.get(r);
  if (existing) return existing;
  const operation = (async () => {
    r.removeAllListeners();
    let disconnect: Promise<unknown>;
    try {
      disconnect = Promise.resolve(r.disconnect()).catch(() => {});
    } catch {
      disconnect = Promise.resolve();
    }
    await settleWithin(disconnect, ROOM_DISCONNECT_TIMEOUT_MS);
    stopRoomMediaTracks(r);
    roomGenerations.delete(r);
  })();
  roomDisconnects.set(r, operation);
  return operation;
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function localMicrophoneDetails(
  r: Room | null = room,
): Record<string, unknown> {
  const pub = r?.localParticipant.getTrackPublication(Track.Source.Microphone);
  const track = pub?.track?.mediaStreamTrack;
  return {
    audioSessionActive,
    connectionState: r?.state,
    hasMicrophonePublication: !!pub,
    hasMicrophoneTrack: !!pub?.track,
    microphoneEnabled: r?.localParticipant.isMicrophoneEnabled,
    microphoneMuted: pub?.isMuted,
    microphoneTrackMuted: track?.muted,
    microphoneTrackReadyState: track?.readyState,
  };
}

function publicationDetails(
  publication: { kind?: unknown; source?: unknown; trackSid?: unknown },
  participant: { identity?: unknown; isLocal?: boolean },
  r: Room,
): Record<string, unknown> {
  return {
    connectionState: r.state,
    participantIdentity: participant.identity,
    participantIsLocal: participant.isLocal,
    source: publication.source,
    trackKind: publication.kind,
    trackSid: publication.trackSid,
    ...localMicrophoneDetails(r),
  };
}

function microphoneNeedsRepublish(r: Room): boolean {
  if (!r.localParticipant.isMicrophoneEnabled) return false;
  const pub = r.localParticipant.getTrackPublication(Track.Source.Microphone);
  const track = pub?.track?.mediaStreamTrack;
  return !pub?.track || !!pub.isMuted || track?.readyState === "ended";
}

function preferredAudioOutputs(
  media: CallMedia,
): ("speaker" | "earpiece" | "headset" | "bluetooth")[] {
  return media === "video"
    ? ["bluetooth", "headset", "speaker", "earpiece"]
    : ["bluetooth", "headset", "earpiece"];
}

async function configureNativeAudio(
  media: CallMedia,
  diagnostic: CallDiagnostic,
  phase: string,
  generation = roomGeneration,
): Promise<void> {
  await serializeNativeResource(async () => {
    if (generation !== roomGeneration) return;
    const preferredOutputList = preferredAudioOutputs(media);
    try {
      await AudioSession.configureAudio({
        android: {
          preferredOutputList,
          audioTypeOptions: {
            ...AndroidAudioTypePresets.communication,
            manageAudioFocus: false,
            forceHandleAudioRouting: false,
          },
        },
        ios: { defaultOutput: media === "video" ? "speaker" : "earpiece" },
      });
      if (generation === roomGeneration)
        diagnostic(phase, { media, preferredOutputList });
    } catch (err) {
      if (generation === roomGeneration) {
        diagnostic(`${phase}_failed`, {
          media,
          message: errorMessage(err),
          preferredOutputList,
        });
      }
    }
  });
}

async function startNativeAudioSession(
  diagnostic: CallDiagnostic,
  phase: string,
  generation = roomGeneration,
): Promise<boolean> {
  return serializeNativeResource(async () => {
    if (generation !== roomGeneration) return false;
    try {
      // Core-Telecom exclusively owns audio focus and routing on Android.
      // Do not start LiveKit AudioSwitch; it would compete with Telecom.
      if (generation !== roomGeneration) {
        // Telecom releases its own audio session.
        if (audioSessionGeneration === generation) {
          audioSessionActive = false;
          audioSessionGeneration = null;
        }
        return false;
      }
      audioSessionActive = true;
      audioSessionGeneration = generation;
      diagnostic(phase, { audioSessionActive });
      return true;
    } catch (err) {
      if (
        audioSessionGeneration === generation ||
        audioSessionGeneration == null
      ) {
        audioSessionActive = false;
        audioSessionGeneration = null;
      }
      if (generation === roomGeneration) {
        diagnostic(`${phase}_failed`, { message: errorMessage(err) });
      }
      throw err;
    }
  });
}

async function startOwnedForegroundService(
  media: CallMedia,
  generation: number,
): Promise<boolean> {
  return serializeNativeResource(async () => {
    if (generation !== roomGeneration) return false;
    if (!telecom) throw new Error("android_telecom_unavailable");
    if (!currentSystemCallId) throw new Error("missing_system_call_id");
    await telecom.mediaStarted(currentSystemCallId, media);
    if (generation !== roomGeneration) {
      // CallProvider ends the call-scoped Telecom service.
      if (foregroundServiceGeneration === generation) {
        foregroundServiceGeneration = null;
      }
      return false;
    }
    foregroundServiceGeneration = generation;
    return true;
  });
}

async function stopOwnedForegroundService(
  expectedGeneration?: number,
): Promise<void> {
  await serializeNativeResource(async () => {
    if (
      expectedGeneration !== undefined &&
      foregroundServiceGeneration !== expectedGeneration
    )
      return;
    if (foregroundServiceGeneration == null) return;
    foregroundServiceGeneration = null;
    // CallProvider ends the call-scoped Telecom service.
  });
}

// Core-Telecom owns both tones for the lifetime of the native call. Ringback
// uses Android call volume and ends on activation, cancellation or service teardown.
// Do not create a second media player/audio focus owner here.
export function primeAudioPlayback(): void {}
export function startRingback(): void {}
export function stopRingback(): void {}
export function startRingtone(): void {}
export function stopRingtone(): void {}

function cameraOptions() {
  return { facingMode: cameraFacingMode };
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function prepareVideoCall(
  _onDiagnostic?: CallDiagnostic,
): Promise<void> {
  if (videoPreparePromise) return videoPreparePromise;
  videoPreparePromise = (async () => {
    if (Platform.OS !== "android") return;
    try {
      await PermissionsAndroid.requestMultiple([
        PermissionsAndroid.PERMISSIONS.CAMERA,
        PermissionsAndroid.PERMISSIONS.RECORD_AUDIO,
      ]);
    } catch {}
  })().finally(() => {
    videoPreparePromise = null;
  });
  return videoPreparePromise;
}

async function ensureAndroidCallPermissions(
  media: CallMedia,
): Promise<boolean> {
  if (Platform.OS !== "android") return true;
  const permissions = [
    PermissionsAndroid.PERMISSIONS.RECORD_AUDIO,
    ...(media === "video" ? [PermissionsAndroid.PERMISSIONS.CAMERA] : []),
  ];
  const result = await PermissionsAndroid.requestMultiple(permissions);
  const microphoneGranted =
    result[PermissionsAndroid.PERMISSIONS.RECORD_AUDIO] ===
    PermissionsAndroid.RESULTS.GRANTED;
  if (!microphoneGranted) throw new Error("microphone_permission_denied");
  return !(
    media === "video" &&
    result[PermissionsAndroid.PERMISSIONS.CAMERA] !==
      PermissionsAndroid.RESULTS.GRANTED
  );
}

async function enableCameraWithRetry(
  r: Room,
  generation = roomGeneration,
): Promise<boolean> {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    if (room !== r || generation !== roomGeneration) return false;
    try {
      await r.localParticipant.setCameraEnabled(true, cameraOptions());
      if (r.localParticipant.getTrackPublication(Track.Source.Camera)?.track)
        return true;
    } catch {}
    await delay(350 + attempt * 250);
  }
  return (
    room === r &&
    generation === roomGeneration &&
    !!r.localParticipant.getTrackPublication(Track.Source.Camera)?.track
  );
}

function hasLocalTrack(r: Room, source: Track.Source): boolean {
  return !!r.localParticipant.getTrackPublication(source)?.track;
}

async function cleanupCurrentCall(
  invalidateGeneration: boolean,
): Promise<void> {
  if (invalidateGeneration) roomGeneration += 1;
  const currentRoom = room;
  const audioOwner = audioSessionGeneration;
  const foregroundOwner = foregroundServiceGeneration;
  room = null;
  await Promise.allSettled([
    ...(currentRoom ? [disconnectRoom(currentRoom)] : []),
    ...(audioOwner != null ? [releaseAudioSession(audioOwner)] : []),
    ...(foregroundOwner != null
      ? [stopOwnedForegroundService(foregroundOwner)]
      : []),
  ]);
}

async function cleanupJoinAttempt(
  targetRoom: Room | null,
  generation: number,
): Promise<void> {
  if (targetRoom && room === targetRoom) room = null;
  await Promise.allSettled([
    ...(targetRoom ? [disconnectRoom(targetRoom)] : []),
    releaseAudioSession(generation),
    stopOwnedForegroundService(generation),
  ]);
}

export async function joinCall(
  url: string,
  token: string,
  options: {
    callId?: string;
    media?: CallMedia;
    cameraEnabled?: boolean;
    onDiagnostic?: CallDiagnostic;
  } = {},
): Promise<CallJoinResult> {
  // Claim the generation before awaiting cleanup. A leave/new join that happens
  // while cleanup is pending advances the fence, so this attempt can never
  // resume and adopt the newer call's generation.
  const generation = ++roomGeneration;
  await cleanupCurrentCall(false);
  if (generation !== roomGeneration) throw new Error("stale_join_attempt");
  currentSystemCallId = options.callId ?? null;
  const media = options.media ?? "audio";
  const cameraRequested = media === "video" && options.cameraEnabled !== false;
  const diagnostic = options.onDiagnostic ?? (() => {});
  cameraFacingMode = "user";
  diagnostic("native_join_start", { media, platform: Platform.OS });
  let r: Room | null = null;
  try {
    if (generation !== roomGeneration) throw new Error("stale_join_attempt");
    // The shared UI starts camera preparation without blocking the web join.
    // Android's native permission dialogs must still be serialized.
    if (videoPreparePromise) await videoPreparePromise;
    if (generation !== roomGeneration) throw new Error("stale_join_attempt");
    let cameraPermissionGranted = true;
    cameraPermissionGranted = await ensureAndroidCallPermissions(
      cameraRequested ? "video" : "audio",
    );
    diagnostic("native_permissions_granted", {
      media,
      cameraPermissionGranted,
      cameraRequested,
    });
    if (cameraRequested && !cameraPermissionGranted) {
      diagnostic("native_camera_permission_denied_audio_continues", { media });
    }
    if (generation !== roomGeneration) throw new Error("stale_join_attempt");

    // Activate the process-wide native audio resources in one serialized lane.
    // This prevents a late stop from call A racing past call B's start.
    await configureNativeAudio(
      media,
      diagnostic,
      "native_audio_configured",
      generation,
    );
    if (generation !== roomGeneration) throw new Error("stale_join_attempt");
    let audioStarted = false;
    try {
      audioStarted = await startNativeAudioSession(
        diagnostic,
        "native_audio_session_started",
        generation,
      );
    } catch {
      throw new Error("audio_session_start_failed");
    }
    if (!audioStarted || generation !== roomGeneration) {
      throw new Error("stale_join_attempt");
    }

    r = new Room({
      adaptiveStream: media === "video",
      dynacast: media === "video",
      videoCaptureDefaults: {
        resolution: { width: 640, height: 360, frameRate: 15 },
      },
      audioCaptureDefaults: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
    });
    if (generation !== roomGeneration) throw new Error("stale_join_attempt");
    room = r;
    roomGenerations.set(r, generation);

    r.on(RoomEvent.Reconnecting, () => {
      diagnostic("native_room_reconnecting", { connectionState: r?.state });
    });
    r.on(RoomEvent.Reconnected, () => {
      diagnostic("native_room_reconnected", { connectionState: r?.state });
    });
    r.on(RoomEvent.TrackMuted, (publication, participant) => {
      if (r)
        diagnostic(
          "native_track_muted",
          publicationDetails(publication, participant, r),
        );
    });
    r.on(RoomEvent.TrackUnmuted, (publication, participant) => {
      if (r)
        diagnostic(
          "native_track_unmuted",
          publicationDetails(publication, participant, r),
        );
    });
    r.on(RoomEvent.LocalTrackUnpublished, (publication, participant) => {
      if (r)
        diagnostic(
          "native_local_track_unpublished",
          publicationDetails(publication, participant, r),
        );
    });
    r.on(RoomEvent.LocalAudioSilenceDetected, (publication) => {
      diagnostic("native_local_audio_silence_detected", {
        source: publication.source,
        trackKind: publication.kind,
        trackSid: publication.trackSid,
        ...localMicrophoneDetails(r),
      });
    });
    r.on(RoomEvent.Disconnected, (reason?: unknown) => {
      diagnostic("native_room_disconnected", {
        connectionState: r?.state,
        reason: reason == null ? undefined : String(reason),
      });
    });

    diagnostic("native_foreground_service_ready", {
      available: Boolean(telecom),
      media,
    });
    let foregroundStarted = false;
    try {
      foregroundStarted = await startOwnedForegroundService(
        cameraRequested && cameraPermissionGranted ? "video" : "audio",
        generation,
      );
    } catch (err) {
      diagnostic("native_foreground_service_start_failed", {
        media,
        message: errorMessage(err),
      });
      throw err;
    }
    if (!foregroundStarted || generation !== roomGeneration || room !== r) {
      throw new Error("stale_join_attempt");
    }
    diagnostic("native_foreground_service_started", { media });
    await r.connect(url, token);
    if (generation !== roomGeneration || room !== r)
      throw new Error("stale_join_attempt");
    diagnostic("native_room_connected", { connectionState: r.state });
    try {
      await r.localParticipant.setMicrophoneEnabled(true);
    } catch (err) {
      diagnostic("native_microphone_publish_failed", {
        errorName: err instanceof Error ? err.name : "unknown",
      });
      throw err;
    }
    if (generation !== roomGeneration || room !== r)
      throw new Error("stale_join_attempt");
    const microphonePublished = hasLocalTrack(r, Track.Source.Microphone);
    diagnostic("native_microphone_publish_result", { microphonePublished });
    let cameraPublished = false;
    if (cameraRequested && cameraPermissionGranted) {
      cameraPublished = await enableCameraWithRetry(r, generation);
      if (generation !== roomGeneration || room !== r)
        throw new Error("stale_join_attempt");
      diagnostic("native_camera_publish_result", { cameraPublished });
    }
    return { room: r, media, microphonePublished, cameraPublished };
  } catch (err) {
    const message = errorMessage(err);
    if (message === "microphone_permission_denied") {
      diagnostic("native_permissions_failed", { media, message });
    } else if (message !== "stale_join_attempt") {
      diagnostic("native_join_failed", {
        errorName: err instanceof Error ? err.name : "unknown",
        generationCurrent: generation === roomGeneration,
      });
    }
    await cleanupJoinAttempt(r, generation);
    throw err;
  }
}

export async function resumeCallAudio(): Promise<boolean> {
  return true;
}

export async function ensureCallKeepAlive(
  media: CallMedia,
  reason: string,
  onDiagnostic: Diagnostic = () => {},
): Promise<void> {
  if (Platform.OS !== "android" || !room) return;
  const r = room;
  const generation = roomGeneration;
  const isCurrent = () => room === r && generation === roomGeneration;
  const diagnostic = onDiagnostic ?? (() => {});
  diagnostic("native_keepalive_start", {
    media,
    reason,
    ...localMicrophoneDetails(r),
  });
  if (!isCurrent()) return;
  await configureNativeAudio(
    media,
    diagnostic,
    "native_audio_keepalive_configured",
    generation,
  );
  if (!isCurrent()) return;
  try {
    const foregroundStarted = await startOwnedForegroundService(
      r.localParticipant.isCameraEnabled ? "video" : "audio",
      generation,
    );
    if (!foregroundStarted || !isCurrent()) {
      await stopOwnedForegroundService(generation).catch(() => {});
      return;
    }
    diagnostic("native_foreground_service_keepalive_started", {
      media,
      reason,
      ...localMicrophoneDetails(r),
    });
  } catch (err) {
    diagnostic("native_foreground_service_keepalive_failed", {
      media,
      reason,
      message: errorMessage(err),
      ...localMicrophoneDetails(r),
    });
  }
  try {
    const audioStarted = await startNativeAudioSession(
      diagnostic,
      "native_audio_session_keepalive_started",
      generation,
    );
    if (!audioStarted) return;
  } catch {
    return;
  }
  if (!isCurrent()) {
    await Promise.allSettled([
      releaseAudioSession(generation),
      stopOwnedForegroundService(generation),
    ]);
    return;
  }
  if (microphoneNeedsRepublish(r)) {
    try {
      await r.localParticipant.setMicrophoneEnabled(false);
      if (!isCurrent()) return;
      await r.localParticipant.setMicrophoneEnabled(true);
      diagnostic("native_microphone_keepalive_republished", {
        reason,
        ...localMicrophoneDetails(r),
      });
    } catch (err) {
      diagnostic("native_microphone_keepalive_republish_failed", {
        reason,
        message: errorMessage(err),
        ...localMicrophoneDetails(r),
      });
    }
  }
  diagnostic("native_keepalive_done", {
    media,
    reason,
    ...localMicrophoneDetails(r),
  });
}

export async function setMuted(muted: boolean): Promise<void> {
  if (room) {
    await room.localParticipant.setMicrophoneEnabled(!muted);
  }
}

export async function setCameraEnabled(enabled: boolean): Promise<boolean> {
  if (room) {
    const r = room;
    const generation = roomGeneration;
    if (enabled) {
      await prepareVideoCall();
      if (room !== r || generation !== roomGeneration) return false;
      await startOwnedForegroundService("video", generation);
      if (room !== r || generation !== roomGeneration) return false;
      return enableCameraWithRetry(r, generation);
    } else {
      await r.localParticipant.setCameraEnabled(false, cameraOptions());
      return true;
    }
  }
  return false;
}

export async function switchCamera(): Promise<"user" | "environment"> {
  cameraFacingMode = cameraFacingMode === "user" ? "environment" : "user";
  if (room) {
    const r = room;
    const generation = roomGeneration;
    const pub = r.localParticipant.getTrackPublication(Track.Source.Camera);
    const track = pub?.track as LocalVideoTrack | undefined;
    if (track) {
      await track.restartTrack(cameraOptions());
    } else {
      await prepareVideoCall();
      if (room === r && generation === roomGeneration) {
        await enableCameraWithRetry(r, generation);
      }
    }
  }
  return cameraFacingMode;
}

async function releaseAudioSession(expectedGeneration?: number): Promise<void> {
  await serializeNativeResource(async () => {
    if (
      expectedGeneration !== undefined &&
      audioSessionGeneration !== expectedGeneration
    )
      return;
    if (!audioSessionActive || audioSessionGeneration == null) return;
    audioSessionActive = false;
    audioSessionGeneration = null;
    try {
      // Telecom releases its own audio session.
    } catch {}
  });
}

export async function leaveCall(expectedRoom?: Room): Promise<void> {
  // A stale Provider continuation must dispose only the Room it produced. If a
  // newer call already owns the module globals, never invalidate or stop it.
  if (expectedRoom && room !== expectedRoom) {
    const generation = roomGenerations.get(expectedRoom);
    await Promise.allSettled([
      disconnectRoom(expectedRoom),
      ...(generation != null ? [releaseAudioSession(generation)] : []),
      ...(generation != null ? [stopOwnedForegroundService(generation)] : []),
    ]);
    return;
  }
  await cleanupCurrentCall(true);
}
