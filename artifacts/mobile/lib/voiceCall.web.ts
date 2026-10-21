import {
  Room,
  RoomEvent,
  Track,
  createLocalAudioTrack,
  type LocalAudioTrack,
  type LocalVideoTrack,
  type RemoteTrack,
} from "livekit-client";
import NoSleep from "nosleep.js";

export const voiceCallSupported = true;
export type CallMedia = "audio" | "video";
export type CallDiagnostic = (phase: string, details?: Record<string, unknown>) => void;
export interface CallJoinResult {
  room: Room;
  media: CallMedia;
  microphonePublished: boolean;
  cameraPublished: boolean;
  cameraPending?: boolean;
}

let room: Room | null = null;
let roomGeneration = 0;
const roomDisconnects = new WeakMap<Room, Promise<void>>();
let unlockHandler: (() => void) | null = null;
let visibilityHandler: (() => void) | null = null;
let micTrack: MediaStreamTrack | null = null;
let removeMicTrackListeners: (() => void) | null = null;
let micRestarting = false;
let micLost = false;
let cameraTrack: MediaStreamTrack | null = null;
let removeCameraTrackListeners: (() => void) | null = null;
let cameraRestartOperation: { room: Room; captureGeneration: number; promise: Promise<boolean> } | null = null;
let cameraLost = false;
let cameraEnabledIntent = false;
let cameraRecoveryTimer: ReturnType<typeof setTimeout> | null = null;
let cameraFacingMode: "user" | "environment" = "user";
let videoPreparePromise: Promise<void> | null = null;
let preparedVideoTrack: MediaStreamTrack | null = null;
let videoPrepareGeneration = 0;
let cameraCaptureInFlight: Promise<MediaStream> | null = null;
let cameraPublishInFlight: { room: Room; promise: Promise<unknown> } | null = null;
let cameraEnableOperation: { room: Room; captureGeneration: number; promise: Promise<boolean> } | null = null;
let cameraDisableOperation: { room: Room; promise: Promise<unknown> } | null = null;
let callDiagnostic: CallDiagnostic = () => {};

// Mobile browsers route WebRTC remote audio through the quiet earpiece/call
// channel and an <audio> element's `volume` is hard-capped at 1.0, so on a phone
// the call sounds far too quiet. To make it audible we route the remote stream
// through the Web Audio graph and amplify it past 1.0 with a GainNode. Keeping
// the (now-muted) <audio> element attached is still required: some browsers only
// let a MediaStreamAudioSourceNode pull audio from a remote track while that
// track is also attached to a playing media element, and the element remains the
// surface our iOS interruption-recovery logic watches.
let audioCtx: AudioContext | null = null;
// Per-track Web Audio nodes so we can disconnect exactly the right ones on
// unsubscribe without tearing down the whole graph. A compressor sits before the
// gain so we can push perceived loudness up hard without the makeup gain clipping
// into distortion on louder speech.
const gainNodes = new Map<
  RemoteTrack,
  {
    src: MediaStreamAudioSourceNode;
    compressor: DynamicsCompressorNode;
    gain: GainNode;
  }
>();
// Elements whose audio is being played through the gain graph. They are muted
// ONLY while the context is actually running (so the boosted graph is the single
// sound source); whenever the context is suspended they are un-muted so the call
// is never fully silent — the #1 cause of "한쪽은 안 들림".
const boostedEls = new Set<HTMLAudioElement>();
const audioElementRooms = new WeakMap<HTMLAudioElement, Room>();
// Makeup gain applied AFTER compression. With the compressor taming peaks this
// can be pushed past the old 1.0 element cap for a genuinely louder phone call
// without the distortion a raw 2x+ gain would cause.
const REMOTE_GAIN = 3.0;
const ROOM_DISCONNECT_TIMEOUT_MS = 4_000;
const CAMERA_CAPTURE_TIMEOUT_MS = 12_000;
const CAMERA_PUBLISH_TIMEOUT_MS = 12_000;
const MICROPHONE_PUBLISH_TIMEOUT_MS = 20_000;
const MICROPHONE_CAPTURE_TIMEOUT_MS = 45_000;

function mediaDeadline<T>(operation: Promise<T>, timeoutMs: number, name: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      const error = new Error(name);
      error.name = name;
      reject(error);
    }, timeoutMs);
    operation.then(
      (value) => { clearTimeout(timer); resolve(value); },
      (error) => { clearTimeout(timer); reject(error); },
    );
  });
}

async function settleWithin(promise: Promise<unknown>, timeoutMs: number): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  try {
    return await Promise.race([
      promise.then(() => true, () => true),
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

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function micDiagnosticDetails(track: MediaStreamTrack | null = micTrack): Record<string, unknown> {
  if (!track) return { hasMicTrack: false };
  return {
    hasMicTrack: true,
    micEnabled: track.enabled,
    micMuted: track.muted,
    micReadyState: track.readyState,
  };
}

function cameraDiagnosticDetails(
  track: MediaStreamTrack | null = cameraTrack,
): Record<string, unknown> {
  if (!track) return { hasCameraTrack: false, cameraEnabledIntent };
  return {
    hasCameraTrack: true,
    cameraEnabledIntent,
    cameraEnabled: track.enabled,
    cameraMuted: track.muted,
    cameraReadyState: track.readyState,
  };
}

function callStateDetails(): Record<string, unknown> {
  return {
    audioContextState: audioCtx?.state,
    canPlaybackAudio: room?.canPlaybackAudio,
    hidden: document.hidden,
    microphoneEnabled: room?.localParticipant.isMicrophoneEnabled,
    cameraEnabled: room?.localParticipant.isCameraEnabled,
    visibilityState: document.visibilityState,
    ...micDiagnosticDetails(),
    ...cameraDiagnosticDetails(),
  };
}

// The (un-)muted state of every boosted element tracks the context's run state:
// muted while running (graph is the sound source), audible while suspended (graph
// is silent, so fall back to the raw element). Re-run on every statechange.
function syncBoostedMute(): void {
  const running = audioCtx?.state === "running";
  boostedEls.forEach((el) => {
    if (el.isConnected) el.muted = running;
  });
}

function getAudioCtx(): AudioContext | null {
  try {
    if (!audioCtx) {
      const Ctor =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext?: typeof AudioContext })
          .webkitAudioContext;
      if (!Ctor) return null;
      audioCtx = new Ctor();
      // Keep every boosted element's mute state in lockstep with the run state,
      // so a resume (loud graph → mute element) or a suspend (silent graph →
      // un-mute element) never leaves the call silent.
      audioCtx.addEventListener("statechange", syncBoostedMute);
    }
    // iOS suspends the context on any interruption; nudge it back awake. Safe to
    // call repeatedly.
    if (audioCtx.state === "suspended") void audioCtx.resume().catch(() => {});
    return audioCtx;
  } catch {
    return null;
  }
}

// Build src -> gain -> destination for a remote audio track. Returns true only
// if the graph was wired up, so the caller knows it's safe to mute the element
// (muting it when this returns false would leave the call silent).
function attachGain(track: RemoteTrack): boolean {
  try {
    const ctx = getAudioCtx();
    if (!ctx) return false;
    const mst = track.mediaStreamTrack;
    if (!mst) return false;
    // A network reconnect can re-fire TrackSubscribed for a track we already
    // wired up. Tear the old nodes down first so we never stack two src->gain
    // chains on the destination (which would double the audio, drift the volume,
    // and leak the orphaned nodes).
    detachGain(track);
    const src = ctx.createMediaStreamSource(new MediaStream([mst]));
    // Compress first so loud speech is reined in, then apply makeup gain — this
    // raises perceived loudness far more than a bare gain could before the
    // destination starts hard-clipping.
    const compressor = ctx.createDynamicsCompressor();
    const gain = ctx.createGain();
    gain.gain.value = REMOTE_GAIN;
    src.connect(compressor);
    compressor.connect(gain);
    gain.connect(ctx.destination);
    gainNodes.set(track, { src, compressor, gain });
    return true;
  } catch {
    return false;
  }
}

function detachGain(track: RemoteTrack): void {
  const node = gainNodes.get(track);
  if (!node) return;
  try {
    node.src.disconnect();
    node.compressor.disconnect();
    node.gain.disconnect();
  } catch {
    // already torn down
  }
  gainNodes.delete(track);
}

function teardownAudioGraph(): void {
  // Disconnect the per-track nodes and forget the boosted elements, but DO NOT
  // close the shared AudioContext.
  //
  // joinCall() calls leaveCall() (→ here) at its very start, milliseconds after
  // primeAudioPlayback() created + resumed audioCtx on the genuine call-button
  // gesture. Closing it would throw that gesture-unlocked "running" state away.
  // The remote track then arrives seconds later — after the callee accepts,
  // outside any gesture — so getAudioCtx() would have to build a FRESH context,
  // which iOS leaves SUSPENDED and refuses to resume() without a gesture. A
  // suspended context = silent gain graph, so that side drops to no / very faint
  // audio. This is a prime cause of the intermittent "한쪽만 안 들림".
  //
  // Keeping one persistent, gesture-primed context means the gain graph is live
  // the instant the remote track subscribes — no extra tap required. Between
  // calls it is harmless: no nodes are connected, so it produces no sound, and
  // its statechange listener is a no-op while boostedEls is empty.
  [...gainNodes.keys()].forEach((track) => detachGain(track));
  gainNodes.clear();
  boostedEls.clear();
}

// Screen Wake Lock keeps the display from auto-dimming/locking during a call.
// iOS Safari (16.4+) freezes the page's JS and WebRTC audio the moment the
// screen locks, which silences the call — the single most common cause being
// the screen simply timing out while the user is talking. Holding a wake lock
// prevents that auto-lock. (It cannot stop a manual power-button lock; recovery
// for that path happens on unlock via the visibility handler.)
type WakeLockLike = {
  release: () => Promise<void>;
  addEventListener?: (type: "release", cb: () => void) => void;
};
let wakeLock: WakeLockLike | null = null;
let noSleep: NoSleep | null = null;
// Bumped on every release/invalidate so an in-flight request() that resolves
// after teardown (or is superseded by a newer request) drops its sentinel
// instead of leaking it.
let wakeLockGen = 0;

function enableNoSleepFallback(): void {
  try {
    noSleep ??= new NoSleep();
    if (!noSleep.isEnabled) void noSleep.enable().catch(() => {});
  } catch {
    // Unsupported or blocked. Screen Wake Lock remains as the primary path.
  }
}

function disableNoSleepFallback(): void {
  try {
    noSleep?.disable();
  } catch {}
}

async function requestWakeLock(): Promise<void> {
  const wl = (
    navigator as Navigator & {
      wakeLock?: { request: (type: "screen") => Promise<WakeLockLike> };
    }
  ).wakeLock;
  if (!wl || wakeLock) return;
  const gen = ++wakeLockGen;
  try {
    const sentinel = await wl.request("screen");
    // The call may have ended (or a newer request started) while we awaited —
    // if so this sentinel is stale, so release it immediately rather than keep
    // it around.
    if (gen !== wakeLockGen || !room) {
      void sentinel.release().catch(() => {});
      return;
    }
    wakeLock = sentinel;
    // The OS auto-releases the lock whenever the page is hidden; clear our
    // reference so the visibility handler re-acquires a fresh one on return.
    sentinel.addEventListener?.("release", () => {
      if (wakeLock === sentinel) wakeLock = null;
    });
  } catch {
    // Denied or unsupported — best effort only.
  }
}

function releaseWakeLock(): void {
  // Invalidate any in-flight request so its sentinel is dropped on resolve.
  wakeLockGen++;
  if (wakeLock) {
    void wakeLock.release().catch(() => {});
    wakeLock = null;
  }
}

// A ~50ms silent WAV. Playing this from a real button gesture (BEFORE any
// network await) grants the document media-playback engagement, so the remote
// track's <audio> element — which only arrives seconds later, after the callee
// accepts, when the original gesture's transient activation is long gone — can
// autoplay without an extra tap. This is the structural fix for the "한쪽만
// 들리거나 둘 다 안 들림" autoplay block: the in-call startAudio() pre-auth runs
// after createCall/acceptCall awaits, by which point the activation is already
// spent, so priming must happen on the genuine gesture instead.
const SILENT_WAV =
  "data:audio/wav;base64,UklGRrQBAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YZABAACAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICA";

let primeEl: HTMLAudioElement | null = null;

// Must be called SYNCHRONOUSLY at the top of a user-gesture handler (call/accept
// button press) before any await. Best-effort; silently no-ops if blocked.
export function primeAudioPlayback(): void {
  try {
    // NoSleep's video fallback must be started from the same real user gesture
    // as the call button. It only prevents auto-lock; it cannot keep WebRTC alive
    // after a manual lock or iOS background suspension.
    enableNoSleepFallback();
    if (!primeEl) {
      primeEl = document.createElement("audio");
      primeEl.setAttribute("playsinline", "true");
      (primeEl as unknown as { playsInline: boolean }).playsInline = true;
      primeEl.src = SILENT_WAV;
      primeEl.load();
    }
    primeEl.currentTime = 0;
    void primeEl.play().catch(() => {});
    // Create + resume the Web Audio context HERE, on the genuine gesture, so it's
    // already "running" by the time the remote track arrives (after the accept
    // await). Otherwise iOS leaves it suspended → the gain graph is silent and we
    // fall back to the quiet raw element ("아직도 작게 들림").
    getAudioCtx();
  } catch {
    // best effort
  }
}

// Ringback tone (통화 연결음). Generated with Web Audio oscillators so no audio
// asset file is needed. Plays the standard 440+480 Hz dual tone in a 1s-on /
// 2s-off cadence while the caller waits for the callee to answer.
//
// It runs on its OWN dedicated AudioContext, deliberately separate from the
// shared call `audioCtx`. joinCall() begins with leaveCall() →
// teardownAudioGraph(), which closes the shared context; if the ringback shared
// it, the tone would die the instant we join the LiveKit room — i.e. right at
// the start of the waiting period when it most needs to play. A private context
// is unaffected by that teardown and is fully owned by stop/startRingback.
let ringbackCtx: AudioContext | null = null;
let ringbackOscillators: OscillatorNode[] = [];
let ringbackGain: GainNode | null = null;
let ringbackTimer: ReturnType<typeof setInterval> | null = null;
let ringbackActive = false;

function ringbackBurst(): void {
  if (!ringbackGain || !ringbackCtx) return;
  const now = ringbackCtx.currentTime;
  const g = ringbackGain.gain;
  // ~1s audible burst, ramped at both ends so it doesn't click on/off.
  // exponentialRampToValueAtTime can't target exactly 0, so use a tiny floor.
  g.cancelScheduledValues(now);
  g.setValueAtTime(0.0001, now);
  g.exponentialRampToValueAtTime(0.16, now + 0.05);
  g.setValueAtTime(0.16, now + 0.95);
  g.exponentialRampToValueAtTime(0.0001, now + 1.0);
}

// Must be called SYNCHRONOUSLY within the call-button gesture (before any await)
// so the freshly created context is allowed to start running.
export function startRingback(): void {
  if (ringbackActive) return;
  let ctx: AudioContext | null = null;
  try {
    const Ctor =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext })
        .webkitAudioContext;
    if (!Ctor) return;
    ctx = new Ctor();
    void ctx.resume().catch(() => {});
    const gain = ctx.createGain();
    gain.gain.value = 0.0001;
    gain.connect(ctx.destination);
    const o1 = ctx.createOscillator();
    const o2 = ctx.createOscillator();
    o1.frequency.value = 440;
    o2.frequency.value = 480;
    o1.connect(gain);
    o2.connect(gain);
    o1.start();
    o2.start();
    ringbackCtx = ctx;
    ringbackOscillators = [o1, o2];
    ringbackGain = gain;
    ringbackActive = true;
    ringbackBurst();
    // 1s on + 2s off = 3s cadence.
    ringbackTimer = setInterval(ringbackBurst, 3000);
  } catch {
    // best effort — a silent ringback never blocks the call itself. Close any
    // partially-created context so it doesn't leak when setup throws midway.
    ringbackActive = false;
    if (ctx) {
      void ctx.close().catch(() => {});
    }
  }
}

export function stopRingback(): void {
  ringbackActive = false;
  if (ringbackTimer) {
    clearInterval(ringbackTimer);
    ringbackTimer = null;
  }
  ringbackOscillators.forEach((o) => {
    try {
      o.stop();
    } catch {
      // already stopped
    }
    try {
      o.disconnect();
    } catch {
      // already disconnected
    }
  });
  ringbackOscillators = [];
  if (ringbackGain) {
    try {
      ringbackGain.disconnect();
    } catch {
      // already disconnected
    }
    ringbackGain = null;
  }
  if (ringbackCtx) {
    void ringbackCtx.close().catch(() => {});
    ringbackCtx = null;
  }
}

// Incoming-call ringtone (벨소리) for the CALLEE — deliberately distinct from
// the caller's ringback tone above so the two ends sound different. A brisk
// "double-ring" cadence (two short bursts, then a gap) on a higher pair of
// tones. Like the ringback it runs on its OWN dedicated AudioContext so it is
// never torn down by the call audio graph, and is fully owned by
// start/stopRingtone.
//
// NOTE: browsers may block this from starting without a prior user gesture
// (autoplay policy). It is best-effort: a silent ringtone never blocks the
// incoming UI, and the visible incoming modal is always shown regardless.
let ringtoneCtx: AudioContext | null = null;
let ringtoneOscillators: OscillatorNode[] = [];
let ringtoneGain: GainNode | null = null;
let ringtoneTimer: ReturnType<typeof setInterval> | null = null;
let ringtoneActive = false;

function ringtoneBurst(): void {
  if (!ringtoneGain || !ringtoneCtx) return;
  const now = ringtoneCtx.currentTime;
  const g = ringtoneGain.gain;
  g.cancelScheduledValues(now);
  // Two short "rings" (0.35s on / 0.18s gap) then the interval's longer silence.
  const ring = (start: number) => {
    g.setValueAtTime(0.0001, start);
    g.exponentialRampToValueAtTime(0.2, start + 0.04);
    g.setValueAtTime(0.2, start + 0.3);
    g.exponentialRampToValueAtTime(0.0001, start + 0.35);
  };
  ring(now);
  ring(now + 0.53);
}

export function startRingtone(): void {
  if (ringtoneActive) return;
  let ctx: AudioContext | null = null;
  try {
    const Ctor =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext })
        .webkitAudioContext;
    if (!Ctor) return;
    ctx = new Ctor();
    void ctx.resume().catch(() => {});
    const gain = ctx.createGain();
    gain.gain.value = 0.0001;
    gain.connect(ctx.destination);
    const o1 = ctx.createOscillator();
    const o2 = ctx.createOscillator();
    // Higher, brighter pair than the 440/480 ringback so the callee's ringtone
    // is clearly a different sound.
    o1.frequency.value = 660;
    o2.frequency.value = 550;
    o1.connect(gain);
    o2.connect(gain);
    o1.start();
    o2.start();
    ringtoneCtx = ctx;
    ringtoneOscillators = [o1, o2];
    ringtoneGain = gain;
    ringtoneActive = true;
    ringtoneBurst();
    // double-ring (~0.9s) + ~1.1s silence = 2s cadence.
    ringtoneTimer = setInterval(ringtoneBurst, 2000);
  } catch {
    ringtoneActive = false;
    if (ctx) void ctx.close().catch(() => {});
  }
}

export function stopRingtone(): void {
  ringtoneActive = false;
  if (ringtoneTimer) {
    clearInterval(ringtoneTimer);
    ringtoneTimer = null;
  }
  ringtoneOscillators.forEach((o) => {
    try {
      o.stop();
    } catch {
      // already stopped
    }
    try {
      o.disconnect();
    } catch {
      // already disconnected
    }
  });
  ringtoneOscillators = [];
  if (ringtoneGain) {
    try {
      ringtoneGain.disconnect();
    } catch {
      // already disconnected
    }
    ringtoneGain = null;
  }
  if (ringtoneCtx) {
    void ringtoneCtx.close().catch(() => {});
    ringtoneCtx = null;
  }
}

const AUDIO_ATTR = "data-livekit-audio";

function getAudioElements(targetRoom?: Room): HTMLAudioElement[] {
  const elements = Array.from(
    document.querySelectorAll<HTMLAudioElement>(`[${AUDIO_ATTR}="true"]`),
  );
  return targetRoom
    ? elements.filter((element) => audioElementRooms.get(element) === targetRoom)
    : elements;
}

function clearAudioElements(targetRoom?: Room) {
  getAudioElements(targetRoom).forEach((el) => {
    boostedEls.delete(el);
    audioElementRooms.delete(el);
    el.pause();
    el.srcObject = null;
    el.remove();
  });
}

// When the browser blocks audio playback, it can only be resumed from a real
// user gesture. Listen once for the next tap/click and resume via startAudio().
function installUnlockHandler(r: Room) {
  if (unlockHandler) return;
  unlockHandler = () => {
    void resumeRoomAudio(r);
  };
  document.addEventListener("click", unlockHandler, true);
  document.addEventListener("touchend", unlockHandler, true);
}

function removeUnlockHandler() {
  if (!unlockHandler) return;
  document.removeEventListener("click", unlockHandler, true);
  document.removeEventListener("touchend", unlockHandler, true);
  unlockHandler = null;
}

async function resumeRoomAudio(r: Room): Promise<boolean> {
  if (room !== r) return false;
  const diagnostic = callDiagnostic;
  try {
    if (audioCtx?.state === "suspended") await audioCtx.resume();
    if (room !== r) return false;
    await r.startAudio();
    if (room !== r) return false;
    await Promise.all(getAudioElements(r).map((el) => el.play()));
    if (room !== r) return false;
    const playing = r.canPlaybackAudio && getAudioElements(r).every((el) => !el.paused);
    if (playing) {
      diagnostic("web_audio_unlocked", callStateDetails());
      removeUnlockHandler();
    } else {
      diagnostic("web_audio_unlock_incomplete", callStateDetails());
      diagnostic("web_audio_playback_blocked", {
        source: "resume_incomplete",
        ...callStateDetails(),
      });
      installUnlockHandler(r);
    }
    return playing;
  } catch (err) {
    if (room !== r) return false;
    diagnostic("web_audio_unlock_failed", {
      errorName: err instanceof Error ? err.name : "unknown",
      ...callStateDetails(),
    });
    diagnostic("web_audio_playback_blocked", {
      source: "resume_rejected",
      errorName: err instanceof Error ? err.name : "unknown",
      ...callStateDetails(),
    });
    installUnlockHandler(r);
    return false;
  }
}

/** Must be invoked from a visible user gesture when Safari blocks autoplay. */
export async function resumeCallAudio(): Promise<boolean> {
  const current = room;
  return current ? resumeRoomAudio(current) : false;
}

// iOS Safari pauses WebRTC <audio> elements mid-call on any interruption —
// screen lock, an incoming system sound, or briefly switching apps — and often
// does NOT fire AudioPlaybackStatusChanged, so the element silently stays paused
// for the rest of the call (the user thinks the call "went mute"). Fight back:
// whenever something pauses the element while the call is still live, replay it.
function keepPlaying(el: HTMLAudioElement, owningRoom: Room) {
  el.addEventListener("pause", () => {
    // Only resume while the call is active and the element is still attached;
    // during teardown `room` is nulled first so we don't resurrect dead audio.
    if (
      room === owningRoom &&
      audioElementRooms.get(el) === owningRoom &&
      el.isConnected
    ) {
      void el.play().catch((err) => {
        if (
          room !== owningRoom ||
          audioElementRooms.get(el) !== owningRoom ||
          !el.isConnected
        ) return;
        callDiagnostic("web_audio_playback_blocked", {
          source: "audio_element_paused",
          errorName: err instanceof Error ? err.name : "unknown",
          ...callStateDetails(),
        });
        installUnlockHandler(owningRoom);
      });
    }
  });
}

// Re-arm playback for every attached track. Used when the page returns to the
// foreground (iOS suspends the audio while backgrounded) or playback is allowed
// again.
function resumeAllAudio() {
  const currentRoom = room;
  if (!currentRoom) return;
  // resumeRoomAudio reports a blocked path and installs the gesture handler on
  // every rejection, including Safari's silent foreground-resume failure.
  void resumeRoomAudio(currentRoom);
}

// The OTHER half of the iOS problem: when iOS interrupts the audio session it
// also kills the LOCAL microphone MediaStreamTrack (it goes "muted" or "ended")
// and never revives it, so the remote side keeps receiving the published track
// but it carries silence — the peer stops hearing this device mid-call. Watch
// the live mic track for those events and re-acquire it via restartTrack().
function armMicRecovery() {
  if (!room) return;
  const armedRoom = room;
  const armedGeneration = roomGeneration;
  const pub = armedRoom.localParticipant.getTrackPublication(Track.Source.Microphone);
  const mst = pub?.track?.mediaStreamTrack ?? null;
  if (mst === micTrack) return;
  removeMicTrackListeners?.();
  removeMicTrackListeners = null;
  micTrack = mst;
  if (!mst) return;
  callDiagnostic("web_microphone_track_armed", micDiagnosticDetails(mst));
  const onLost = (event: Event) => {
    if (
      room !== armedRoom ||
      roomGeneration !== armedGeneration ||
      micTrack !== mst
    ) return;
    micLost = true;
    callDiagnostic("web_microphone_track_lost", {
      eventType: event.type,
      ...callStateDetails(),
      ...micDiagnosticDetails(mst),
    });
    // Only recover if the user still intends the mic to be on (don't override a
    // deliberate mute).
    if (armedRoom.localParticipant.isMicrophoneEnabled) {
      void restartMic();
    }
  };
  mst.addEventListener("mute", onLost);
  mst.addEventListener("ended", onLost);
  removeMicTrackListeners = () => {
    mst.removeEventListener("mute", onLost);
    mst.removeEventListener("ended", onLost);
  };
}

// True only when the mic actually looks dead — so a plain app-switch return that
// left the mic healthy doesn't trigger a needless re-acquire (which would cause
// a brief audible gap).
function micNeedsRecovery(): boolean {
  if (micLost) return true;
  if (!micTrack) return false;
  return micTrack.readyState === "ended" || micTrack.muted;
}

async function restartMic() {
  if (!room || micRestarting) return;
  const activeRoom = room;
  const generation = roomGeneration;
  const diagnostic = callDiagnostic;
  if (!activeRoom.localParticipant.isMicrophoneEnabled) return;
  micRestarting = true;
  let succeeded = false;
  diagnostic("web_microphone_restart_start", callStateDetails());
  try {
    const pub = activeRoom.localParticipant.getTrackPublication(Track.Source.Microphone);
    const track = pub?.track as LocalAudioTrack | undefined;
    if (track && typeof track.restartTrack === "function") {
      // Re-runs getUserMedia with the same constraints and swaps in a fresh
      // MediaStreamTrack on the existing publication — the LiveKit-recommended
      // way to recover from an OS audio-session interruption.
      await track.restartTrack();
    } else {
      // Fallback: unpublish + republish forces a new getUserMedia.
      await activeRoom.localParticipant.setMicrophoneEnabled(false);
      if (room !== activeRoom || generation !== roomGeneration) return;
      await activeRoom.localParticipant.setMicrophoneEnabled(true);
    }
    succeeded = true;
  } catch (err) {
    if (room === activeRoom && generation === roomGeneration) {
      diagnostic("web_microphone_restart_failed", {
        message: errorMessage(err),
        ...callStateDetails(),
      });
    }
    // best effort
  } finally {
    if (room === activeRoom && generation === roomGeneration) {
      micRestarting = false;
      micLost = false;
      // The underlying track changed; re-arm listeners on the fresh one.
      micTrack = null;
      armMicRecovery();
      if (succeeded) diagnostic("web_microphone_restart_succeeded", callStateDetails());
    }
  }
}

function armCameraRecovery() {
  if (!room) return;
  const armedRoom = room;
  const armedGeneration = roomGeneration;
  const pub = armedRoom.localParticipant.getTrackPublication(Track.Source.Camera);
  const mst = pub?.track?.mediaStreamTrack ?? null;
  if (mst === cameraTrack) return;
  removeCameraTrackListeners?.();
  removeCameraTrackListeners = null;
  cameraTrack = mst;
  if (!mst) return;
  callDiagnostic("web_camera_track_armed", cameraDiagnosticDetails(mst));
  const onLost = (event: Event) => {
    if (
      room !== armedRoom ||
      roomGeneration !== armedGeneration ||
      cameraTrack !== mst
    ) return;
    cameraLost = true;
    callDiagnostic("web_camera_track_lost", {
      eventType: event.type,
      ...callStateDetails(),
      ...cameraDiagnosticDetails(mst),
    });
    // A brief mute is normal while WebKit changes capture state. Wait before
    // replacing the track, and never re-acquire while the PWA is hidden.
    if (cameraRecoveryTimer) clearTimeout(cameraRecoveryTimer);
    cameraRecoveryTimer = setTimeout(() => {
      cameraRecoveryTimer = null;
      if (
        room === armedRoom &&
        roomGeneration === armedGeneration &&
        cameraTrack === mst &&
        cameraEnabledIntent &&
        document.visibilityState === "visible" &&
        (mst.muted || mst.readyState === "ended")
      ) {
        void restartCamera();
      }
    }, 750);
  };
  const onRecovered = () => {
    if (
      room !== armedRoom ||
      roomGeneration !== armedGeneration ||
      cameraTrack !== mst
    ) return;
    cameraLost = false;
    if (cameraRecoveryTimer) {
      clearTimeout(cameraRecoveryTimer);
      cameraRecoveryTimer = null;
    }
    callDiagnostic("web_camera_track_recovered", cameraDiagnosticDetails(mst));
  };
  mst.addEventListener("mute", onLost);
  mst.addEventListener("ended", onLost);
  mst.addEventListener("unmute", onRecovered);
  removeCameraTrackListeners = () => {
    mst.removeEventListener("mute", onLost);
    mst.removeEventListener("ended", onLost);
    mst.removeEventListener("unmute", onRecovered);
  };
}

function cameraNeedsRecovery(): boolean {
  if (!cameraEnabledIntent) return false;
  if (cameraLost) return true;
  if (!cameraTrack) return true;
  return cameraTrack.readyState === "ended" || cameraTrack.muted;
}

async function restartCamera(): Promise<boolean> {
  if (!room || !cameraEnabledIntent) return false;
  const activeRoom = room;
  const generation = roomGeneration;
  const captureGeneration = videoPrepareGeneration;
  const diagnostic = callDiagnostic;
  const isCurrent = () => room === activeRoom && generation === roomGeneration &&
    captureGeneration === videoPrepareGeneration && cameraEnabledIntent;
  const existing = cameraRestartOperation;
  if (existing?.room === activeRoom) {
    if (existing.captureGeneration === captureGeneration) return existing.promise;
    await existing.promise.catch(() => false);
    if (!isCurrent()) return false;
    if (cameraRestartOperation?.room === activeRoom && cameraRestartOperation.captureGeneration === captureGeneration) {
      return cameraRestartOperation.promise;
    }
  }
  const operation = (async () => {
    let succeeded = false;
    diagnostic("web_camera_restart_start", callStateDetails());
    try {
      const pub = activeRoom.localParticipant.getTrackPublication(Track.Source.Camera);
      const track = pub?.track as LocalVideoTrack | undefined;
      if (track) {
        // Keep every acquisition in the bounded coordinator. SDK restartTrack()
        // would start a separate unbounded getUserMedia operation internally.
        track.mediaStreamTrack.stop();
        await mediaDeadline(
          activeRoom.localParticipant.unpublishTrack(track, true),
          CAMERA_PUBLISH_TIMEOUT_MS,
          "CameraUnpublishTimeout",
        );
      }
      if (!isCurrent()) return false;
      releasePreparedVideoTrack();
      succeeded = await enableCameraForRoom(activeRoom, generation);
      if (!succeeded) throw new Error("camera_republish_failed");
    } catch (error) {
      if (isCurrent()) {
        diagnostic("web_camera_restart_failed", {
          errorName: error instanceof Error ? error.name : "unknown",
          ...callStateDetails(),
        });
      }
    } finally {
      if (isCurrent()) {
        cameraLost = false;
        cameraTrack = null;
        armCameraRecovery();
        if (succeeded) diagnostic("web_camera_restart_succeeded", callStateDetails());
      }
    }
    return succeeded && isCurrent();
  })();
  const current = { room: activeRoom, captureGeneration, promise: operation };
  cameraRestartOperation = current;
  try {
    return await operation;
  } finally {
    if (cameraRestartOperation === current) cameraRestartOperation = null;
  }
}

function installVisibilityHandler() {
  if (visibilityHandler) return;
  visibilityHandler = (event?: Event) => {
    if (room) {
      callDiagnostic("web_visibility_change", {
        eventType: event?.type,
        ...callStateDetails(),
      });
    }
    if (document.visibilityState === "visible") {
      resumeAllAudio();
      // The OS releases the wake lock whenever the page is hidden, so re-acquire
      // it every time we return to the foreground while a call is live.
      if (room) {
        enableNoSleepFallback();
        void requestWakeLock();
      }
      // Coming back to the foreground is the most reliable moment to rescue a
      // mic the OS suspended while we were away — but only if it actually looks
      // dead, so a healthy app-switch return doesn't cause a needless gap.
      if (room && room.localParticipant.isMicrophoneEnabled && micNeedsRecovery()) {
        void restartMic();
      }
      if (room && cameraEnabledIntent && cameraNeedsRecovery()) {
        void restartCamera();
      }
    }
  };
  document.addEventListener("visibilitychange", visibilityHandler);
  window.addEventListener("focus", visibilityHandler);
}

function removeVisibilityHandler() {
  if (!visibilityHandler) return;
  document.removeEventListener("visibilitychange", visibilityHandler);
  window.removeEventListener("focus", visibilityHandler);
  visibilityHandler = null;
}

function cameraOptions() {
  return {
    facingMode: cameraFacingMode,
    width: { ideal: 640 },
    height: { ideal: 360 },
    frameRate: { ideal: 15, max: 20 },
  };
}

export function prepareVideoCall(onDiagnostic: CallDiagnostic = callDiagnostic): Promise<void> {
  if (preparedVideoTrack?.readyState === "live") return Promise.resolve();
  if (videoPreparePromise) return videoPreparePromise;
  // getUserMedia cannot be cancelled. A timed-out browser permission request
  // must not be followed by concurrent acquisitions fighting for the camera.
  if (cameraCaptureInFlight) {
    onDiagnostic("web_camera_capture_still_pending");
    return Promise.resolve();
  }
  const prepareGeneration = videoPrepareGeneration;
  let accepted = true;
  const operation = (async () => {
    const gum = navigator.mediaDevices?.getUserMedia;
    if (!gum) {
      onDiagnostic("web_camera_capture_unavailable");
      return;
    }
    let stream: MediaStream | null = null;
    try {
      onDiagnostic("web_camera_capture_start");
      const capture = gum.call(navigator.mediaDevices, {
        video: cameraOptions(),
        audio: false,
      });
      cameraCaptureInFlight = capture;
      // The rejection handler also consumes a late permission rejection after
      // the deadline. A late stream belongs to the expired attempt and is stopped.
      void capture.then((result) => {
        if (!accepted || prepareGeneration !== videoPrepareGeneration) {
          result.getTracks().forEach((track) => track.stop());
        }
      }, () => {}).finally(() => {
        if (cameraCaptureInFlight === capture) cameraCaptureInFlight = null;
      });
      stream = await mediaDeadline(capture, CAMERA_CAPTURE_TIMEOUT_MS, "CameraCaptureTimeout");
      const track = stream.getVideoTracks()[0];
      if (!track) return;
      // Permission UI/getUserMedia can resolve after the user ended the call.
      // Do not keep a late camera track alive or let it bleed into call B.
      if (prepareGeneration !== videoPrepareGeneration) {
        track.stop();
        return;
      }
      releasePreparedVideoTrack();
      preparedVideoTrack = track;
      onDiagnostic("web_camera_capture_ready", { cameraReadyState: track.readyState });
      track.addEventListener(
        "ended",
        () => {
          if (preparedVideoTrack === track) preparedVideoTrack = null;
        },
        { once: true },
      );
    } catch (error) {
      onDiagnostic("web_camera_capture_failed", {
        errorName: error instanceof Error ? error.name : "unknown",
      });
      return;
    } finally {
      accepted = false;
      stream
        ?.getTracks()
        .filter((track) => track.kind !== "video" || track !== preparedVideoTrack)
        .forEach((track) => track.stop());
    }
  })();
  const bounded = operation.finally(() => {
    if (videoPreparePromise === bounded) videoPreparePromise = null;
  });
  videoPreparePromise = bounded;
  return bounded;
}

function releasePreparedVideoTrack(): void {
  if (preparedVideoTrack) {
    try {
      preparedVideoTrack.stop();
    } catch {}
    preparedVideoTrack = null;
  }
}

async function publishPreparedVideoTrack(r: Room, generation: number, captureGeneration: number): Promise<boolean> {
  if (cameraPublishInFlight?.room === r) {
    releasePreparedVideoTrack();
    callDiagnostic("web_camera_publish_still_pending");
    return false;
  }
  const track = preparedVideoTrack;
  if (!track || track.readyState !== "live") {
    preparedVideoTrack = null;
    return false;
  }
  preparedVideoTrack = null;
  track.enabled = true;
  let valid = true;
  const isCurrent = () => valid && room === r && generation === roomGeneration &&
    captureGeneration === videoPrepareGeneration && cameraEnabledIntent;
  const discard = () => {
    try { track.stop(); } catch {}
    try {
      const publication = r.localParticipant.getTrackPublication(Track.Source.Camera);
      if (publication?.track?.mediaStreamTrack === track) {
        void r.localParticipant.unpublishTrack(publication.track, true).catch(() => {});
      }
    } catch {}
  };
  try {
    const publish = r.localParticipant.publishTrack(track, { source: Track.Source.Camera });
    const publishing = { room: r, promise: publish };
    cameraPublishInFlight = publishing;
    void publish.then(() => { if (!isCurrent()) discard(); }, () => {}).finally(() => {
      if (cameraPublishInFlight === publishing) cameraPublishInFlight = null;
    });
    await mediaDeadline(publish, CAMERA_PUBLISH_TIMEOUT_MS, "CameraPublishTimeout");
    if (!isCurrent()) {
      discard();
      return false;
    }
    const publication = r.localParticipant.getTrackPublication(Track.Source.Camera);
    if (publication?.isMuted && publication.track) {
      await mediaDeadline(
        (publication.track as LocalVideoTrack).unmute(),
        CAMERA_PUBLISH_TIMEOUT_MS,
        "CameraResumeTimeout",
      );
    }
    if (!isCurrent()) { discard(); return false; }
    return !!publication?.track && !publication.isMuted && track.enabled && track.readyState === "live";
  } catch (error) {
    valid = false;
    discard();
    if (room === r && generation === roomGeneration) {
      callDiagnostic("web_camera_publish_failed", {
        errorName: error instanceof Error ? error.name : "unknown",
      });
    }
    return false;
  }
}

async function enableCameraForRoom(
  r: Room,
  generation = roomGeneration,
): Promise<boolean> {
  const captureGeneration = videoPrepareGeneration;
  const isCurrent = () => room === r && generation === roomGeneration &&
    captureGeneration === videoPrepareGeneration && cameraEnabledIntent;
  const existing = cameraEnableOperation;
  if (existing?.room === r) {
    if (existing.captureGeneration === captureGeneration) return existing.promise;
    // OFF invalidates the old acquisition/publication. A subsequent ON waits
    // for that bounded operation to settle, then acquires for the NEW intent.
    // Reusing its old false result would silently undo the user's latest ON.
    await existing.promise.catch(() => false);
    if (!isCurrent()) return false;
    if (cameraEnableOperation?.room === r && cameraEnableOperation.captureGeneration === captureGeneration) {
      return cameraEnableOperation.promise;
    }
  }
  const operation = (async () => {
    await prepareVideoCall();
    if (!isCurrent()) return false;
    return publishPreparedVideoTrack(r, generation, captureGeneration);
  })();
  const current = { room: r, captureGeneration, promise: operation };
  cameraEnableOperation = current;
  try {
    return await operation;
  } finally {
    if (cameraEnableOperation === current) cameraEnableOperation = null;
  }
}

function hasLocalTrack(r: Room, source: Track.Source): boolean {
  return !!r.localParticipant.getTrackPublication(source)?.track;
}

export async function joinCall(
  url: string,
  token: string,
  options: { callId?: string; media?: CallMedia; cameraEnabled?: boolean; onDiagnostic?: CallDiagnostic } = {},
): Promise<CallJoinResult> {
  const media = options.media ?? "audio";
  const cameraRequested = media === "video" && options.cameraEnabled !== false;
  const generation = ++roomGeneration;
  // Keep the camera track prepared by the genuine call/accept gesture. Stopping
  // it here made the camera indicator turn on while discarding the exact track
  // that was supposed to be published, followed by a slower second acquisition.
  await cleanupCall({
    releaseNoSleep: false,
    preservePreparedVideo: cameraRequested,
    invalidateGeneration: false,
  });
  if (generation !== roomGeneration) throw new Error("stale_join_attempt");
  const diagnostic = options.onDiagnostic ?? (() => {});
  callDiagnostic = diagnostic;
  cameraFacingMode = "user";
  cameraEnabledIntent = cameraRequested;
  diagnostic("web_join_start", { media, cameraRequested });

  // Explicit voice-call audio processing. Without echo cancellation the remote
  // side hears their own voice bounced back off this device's loudspeaker —
  // which sounds like "스피커폰이 켜진 것처럼" echoey/distant audio. Auto gain
  // keeps the captured mic level steady so the peer doesn't hear you too quiet.
  // Setting them on the Room defaults guarantees they're re-applied on EVERY mic
  // (re)acquisition — initial publish, restartTrack(), and the republish
  // fallback — not just the first one.
  const r = new Room({
    adaptiveStream: media === "video",
    dynacast: media === "video",
    videoCaptureDefaults: cameraOptions(),
    audioCaptureDefaults: {
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
    },
  });
  const isCurrentRoom = () => room === r && generation === roomGeneration;

  r.on(RoomEvent.TrackSubscribed, (track: RemoteTrack) => {
    if (!isCurrentRoom()) {
      track.detach().forEach((element) => element.remove());
      return;
    }
    diagnostic("web_remote_track_subscribed", {
      kind: track.kind,
      source: track.source,
      readyState: track.mediaStreamTrack?.readyState,
    });
    if (track.kind === Track.Kind.Audio) {
      // On a network reconnect LiveKit can fire TrackSubscribed again for a
      // track that still has a live <audio> element attached. Detach any prior
      // elements for THIS track first so we never stack two players for the same
      // remote stream — duplicated playback sounds louder and phase-combs into a
      // speakerphone-like echo.
      track.detach().forEach((old) => {
        boostedEls.delete(old as HTMLAudioElement);
        audioElementRooms.delete(old as HTMLAudioElement);
        old.remove();
      });
      const el = track.attach() as HTMLAudioElement;
      el.setAttribute(AUDIO_ATTR, "true");
      audioElementRooms.set(el, r);
      el.autoplay = true;
      // playsInline keeps iOS from hijacking playback into a fullscreen player.
      el.setAttribute("playsinline", "true");
      (el as unknown as { playsInline: boolean }).playsInline = true;
      el.volume = 1;
      document.body.appendChild(el);
      // Amplify the remote audio past the element's 1.0 cap so it's loud enough
      // on a phone. Mute the element only while the gain graph is actually running
      // (single sound source); if the graph never wired up OR the context is
      // suspended, the un-boosted element stays audible so the call is never fully
      // silent. syncBoostedMute() keeps this in lockstep as the context resumes.
      if (attachGain(track)) {
        boostedEls.add(el);
        el.muted = audioCtx?.state === "running";
      } else {
        el.muted = false;
      }
      keepPlaying(el, r);
      // The caller only subscribes to the remote track AFTER the callee accepts,
      // which is long after the click that started the call — so the browser's
      // autoplay activation has lapsed and play() is blocked, leaving the caller
      // in silence. Try to play; if blocked, the AudioPlaybackStatusChanged
      // handler below arms a one-shot gesture unlock.
      void el
        .play()
        .then(() => diagnostic("web_remote_audio_playing", callStateDetails()))
        .catch((err) => {
          diagnostic("web_remote_audio_play_blocked", {
            message: errorMessage(err),
            ...callStateDetails(),
          });
          installUnlockHandler(r);
        });
    }
  });
  // Publish the in-flight Room immediately so leaveCall() can cancel and fully
  // clean a connection attempt that is still awaiting signaling/ICE.
  room = r;

  r.on(RoomEvent.TrackSubscriptionFailed, (trackSid: string, _participant, reason) => {
    diagnostic("web_track_subscription_failed", {
      trackSid,
      reason: reason == null ? undefined : String(reason),
    });
  });

  r.on(RoomEvent.TrackStreamStateChanged, (publication, streamState) => {
    diagnostic("web_track_stream_state_changed", {
      kind: publication.kind,
      source: publication.source,
      streamState,
    });
  });

  r.on(RoomEvent.ParticipantConnected, () => {
    diagnostic("web_remote_participant_connected", { connectionState: r.state });
  });

  r.on(RoomEvent.ParticipantActive, () => {
    diagnostic("web_remote_participant_active", { connectionState: r.state });
  });

  r.on(RoomEvent.TrackUnsubscribed, (track: RemoteTrack) => {
    detachGain(track);
    track.detach().forEach((el) => {
      boostedEls.delete(el as HTMLAudioElement);
      audioElementRooms.delete(el as HTMLAudioElement);
      el.remove();
    });
  });

  // Fires when the browser blocks (or later allows) audio playback. When
  // blocked, audio must be resumed from a user gesture; when allowed again,
  // drop the pending unlock listener and replay any paused elements.
  r.on(RoomEvent.AudioPlaybackStatusChanged, () => {
    if (!isCurrentRoom()) return;
    if (!r.canPlaybackAudio) {
      diagnostic("web_audio_playback_blocked", callStateDetails());
      installUnlockHandler(r);
    } else {
      diagnostic("web_audio_playback_allowed", callStateDetails());
      removeUnlockHandler();
      void resumeRoomAudio(r);
    }
  });

  // Whenever the local mic (re)publishes, attach interruption listeners to the
  // new underlying track.
  r.on(RoomEvent.LocalTrackPublished, () => {
    if (!isCurrentRoom()) return;
    armMicRecovery();
    armCameraRecovery();
  });

  r.on(RoomEvent.LocalTrackUnpublished, (publication) => {
    diagnostic("web_local_track_unpublished", {
      kind: publication.kind,
      source: publication.source,
    });
  });

  r.on(RoomEvent.Reconnected, () => {
    if (!isCurrentRoom()) return;
    diagnostic("web_room_reconnected", { connectionState: r.state });
    void resumeRoomAudio(r);
    armMicRecovery();
    armCameraRecovery();
    if (r.localParticipant.isMicrophoneEnabled && micNeedsRecovery()) void restartMic();
    if (cameraEnabledIntent && cameraNeedsRecovery()) void restartCamera();
  });

  try {
    await r.connect(url, token);
    if (generation !== roomGeneration || room !== r) throw new Error("stale_join_attempt");
    diagnostic("web_room_connected", { connectionState: r.state });
    let capturedMicrophone: LocalAudioTrack | null = null;
    let acceptCapture = true;
    try {
      // Own capture separately from publication. A browser permission request
      // cannot be cancelled; stop a late result even if it was never published.
      diagnostic("web_microphone_capture_start");
      const capture = createLocalAudioTrack({
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      });
      void capture.then((track) => {
        if (!acceptCapture || !isCurrentRoom()) track.stop();
      }, () => {});
      capturedMicrophone = await mediaDeadline(capture, MICROPHONE_CAPTURE_TIMEOUT_MS, "MicrophoneCaptureTimeout");
      acceptCapture = false;
      if (!isCurrentRoom()) throw new Error("stale_join_attempt");
      diagnostic("web_microphone_capture_ready");
      diagnostic("web_microphone_publish_start");
      const ownedMicrophone = capturedMicrophone;
      const publishMicrophone = r.localParticipant.publishTrack(ownedMicrophone, { source: Track.Source.Microphone });
      void publishMicrophone.then(() => {
        if (!isCurrentRoom()) {
          ownedMicrophone.stop();
          void r.localParticipant.unpublishTrack(ownedMicrophone, true).catch(() => {});
        }
      }, () => {});
      await mediaDeadline(publishMicrophone, MICROPHONE_PUBLISH_TIMEOUT_MS, "MicrophonePublishTimeout");
    } catch (err) {
      acceptCapture = false;
      capturedMicrophone?.stop();
      diagnostic("web_microphone_publish_failed", {
        errorName: err instanceof Error ? err.name : "unknown",
      });
      throw err;
    }
    if (generation !== roomGeneration || room !== r) throw new Error("stale_join_attempt");
    const microphonePublished = hasLocalTrack(r, Track.Source.Microphone);
    diagnostic("web_microphone_publish_result", { microphonePublished });
    let cameraPending = cameraRequested;
    if (cameraRequested) {
      const cameraGeneration = videoPrepareGeneration;
      // A browser can leave camera permission/capture pending indefinitely.
      // Expose the connected Room and audio immediately; publish video separately.
      void enableCameraForRoom(r, generation).then((published) => {
        cameraPending = false;
        if (!isCurrentRoom() || cameraGeneration !== videoPrepareGeneration) return;
        diagnostic("web_camera_publish_result", { cameraPublished: published });
        armCameraRecovery();
      }).catch((error) => {
        cameraPending = false;
        if (!isCurrentRoom() || cameraGeneration !== videoPrepareGeneration) return;
        diagnostic("web_camera_publish_failed", {
          errorName: error instanceof Error ? error.name : "unknown",
        });
        diagnostic("web_camera_publish_result", { cameraPublished: false });
      });
    }
    // Secondary pre-authorization. The button-gesture activation is already spent
    // by the createCall/acceptCall await that precedes this — primeAudioPlayback()
    // (called on that gesture in CallProvider) is what actually unlocks playback.
    if (!r.canPlaybackAudio) {
      // Playback promises can also remain pending in Safari. The connected UI
      // must already be available so its explicit resume button can be tapped.
      void resumeRoomAudio(r).then((playbackStarted) => {
        if (isCurrentRoom() && !playbackStarted) {
          diagnostic("web_audio_playback_blocked", callStateDetails());
        }
      });
    }
    armMicRecovery();
    installVisibilityHandler();
    void requestWakeLock();
    return {
      room: r,
      media,
      microphonePublished,
      cameraPublished: hasLocalTrack(r, Track.Source.Camera),
      cameraPending,
    };
  } catch (err) {
    diagnostic("web_join_cleanup_after_failure", {
      errorName: err instanceof Error ? err.name : "unknown",
      generationCurrent: generation === roomGeneration,
    });
    if (room === r) {
      await cleanupCall({ releaseNoSleep: true, invalidateGeneration: false });
    } else {
      await disconnectRoom(r);
    }
    throw err;
  }
}

export async function ensureCallKeepAlive(
  _media: CallMedia,
  _reason: string,
  _onDiagnostic: CallDiagnostic = () => {},
): Promise<void> {}

export async function setMuted(muted: boolean): Promise<void> {
  if (!room) return;
  const r = room;
  const generation = roomGeneration;
  await r.localParticipant.setMicrophoneEnabled(!muted);
  if (room !== r || generation !== roomGeneration) return;
  // The publication's track changes when re-enabled; keep recovery armed.
  micTrack = null;
  armMicRecovery();
}

export async function setCameraEnabled(enabled: boolean): Promise<boolean> {
  cameraEnabledIntent = enabled;
  if (room) {
    const r = room;
    const generation = roomGeneration;
    if (enabled) {
      const captureGeneration = videoPrepareGeneration;
      if (cameraDisableOperation?.room === r) {
        await cameraDisableOperation.promise;
        if (room !== r || generation !== roomGeneration || captureGeneration !== videoPrepareGeneration || !cameraEnabledIntent) {
          return false;
        }
      }
      const publication = r.localParticipant.getTrackPublication(Track.Source.Camera);
      const current = publication?.track?.mediaStreamTrack;
      if (current?.readyState === "live" && !current.muted && current.enabled && !publication?.isMuted) {
        cameraTrack = current;
        cameraLost = false;
        return true;
      }
      if (publication?.isMuted && current?.readyState === "live") {
        const resume = r.localParticipant.setCameraEnabled(true, cameraOptions());
        void resume.then(() => {
          // SDK operations also outlive local deadlines. A late ON must not
          // re-enable a camera after the user pressed OFF or ended this call.
          if (room !== r || generation !== roomGeneration) {
            current.stop();
          } else if (!cameraEnabledIntent) {
            current.enabled = false;
            void r.localParticipant.setCameraEnabled(false, cameraOptions()).catch(() => {});
          }
        }, () => {});
        await mediaDeadline(
          resume,
          CAMERA_CAPTURE_TIMEOUT_MS,
          "CameraResumeTimeout",
        );
        if (room !== r || generation !== roomGeneration || captureGeneration !== videoPrepareGeneration || !cameraEnabledIntent) return false;
        armCameraRecovery();
        const resumed = r.localParticipant.getTrackPublication(Track.Source.Camera);
        const resumedTrack = resumed?.track?.mediaStreamTrack;
        return !!resumedTrack && resumedTrack.readyState === "live" && resumedTrack.enabled &&
          !resumedTrack.muted && !resumed?.isMuted;
      }
      if (current) return restartCamera();
      const published = await enableCameraForRoom(r, generation);
      if (room !== r || generation !== roomGeneration) return false;
      cameraTrack = null;
      armCameraRecovery();
      return published;
    } else {
      videoPrepareGeneration += 1;
      releasePreparedVideoTrack();
      if (cameraRecoveryTimer) {
        clearTimeout(cameraRecoveryTimer);
        cameraRecoveryTimer = null;
      }
      const disabled = {
        room: r,
        promise: mediaDeadline(
          r.localParticipant.setCameraEnabled(false, cameraOptions()),
          CAMERA_PUBLISH_TIMEOUT_MS,
          "CameraDisableTimeout",
        ),
      };
      cameraDisableOperation = disabled;
      try {
        await disabled.promise;
      } finally {
        if (cameraDisableOperation === disabled) cameraDisableOperation = null;
      }
      if (room !== r || generation !== roomGeneration) return false;
      cameraTrack = null;
      cameraLost = false;
      return true;
    }
  }
  return false;
}

export async function switchCamera(): Promise<"user" | "environment"> {
  cameraFacingMode = cameraFacingMode === "user" ? "environment" : "user";
  if (room && cameraEnabledIntent) {
    const restored = await restartCamera();
    if (!restored) throw new Error("camera_switch_failed");
  }
  return cameraFacingMode;
}

function detachRoomRemoteMedia(r: Room): void {
  for (const participant of r.remoteParticipants.values()) {
    for (const publication of participant.trackPublications.values()) {
      const track = publication.track as RemoteTrack | undefined;
      if (!track) continue;
      if (track.kind === Track.Kind.Audio) detachGain(track);
      try {
        track.detach().forEach((element) => {
          boostedEls.delete(element as HTMLAudioElement);
          audioElementRooms.delete(element as HTMLAudioElement);
          element.remove();
        });
      } catch {}
    }
  }
  clearAudioElements(r);
}

async function disconnectRoom(r: Room): Promise<void> {
  const existing = roomDisconnects.get(r);
  if (existing) return existing;
  const operation = (async () => {
    r.removeAllListeners();
    detachRoomRemoteMedia(r);
    let disconnect: Promise<unknown>;
    try {
      disconnect = Promise.resolve(r.disconnect()).catch(() => {});
    } catch {
      disconnect = Promise.resolve();
    }
    await settleWithin(disconnect, ROOM_DISCONNECT_TIMEOUT_MS);
    // `disconnect()` normally stops these tracks. Stop them explicitly as a
    // final fence when the SDK cleanup stalls or returns before device teardown.
    stopRoomMediaTracks(r);
  })();
  roomDisconnects.set(r, operation);
  return operation;
}

async function cleanupCall({
  releaseNoSleep,
  preservePreparedVideo = false,
  invalidateGeneration = true,
}: {
  releaseNoSleep: boolean;
  preservePreparedVideo?: boolean;
  invalidateGeneration?: boolean;
}): Promise<void> {
  if (invalidateGeneration) roomGeneration += 1;
  removeUnlockHandler();
  removeVisibilityHandler();
  releaseWakeLock();
  if (releaseNoSleep) disableNoSleepFallback();
  // Null `room` before disconnecting so keepPlaying()'s pause handler and the
  // mic-recovery listeners don't try to resurrect tracks as they're torn down.
  const r = room;
  room = null;
  removeMicTrackListeners?.();
  removeMicTrackListeners = null;
  micTrack = null;
  micRestarting = false;
  micLost = false;
  removeCameraTrackListeners?.();
  removeCameraTrackListeners = null;
  cameraTrack = null;
  cameraLost = false;
  if (cameraRecoveryTimer) {
    clearTimeout(cameraRecoveryTimer);
    cameraRecoveryTimer = null;
  }
  if (!preservePreparedVideo) {
    cameraEnabledIntent = false;
    videoPrepareGeneration += 1;
  }
  callDiagnostic = () => {};
  if (!preservePreparedVideo) releasePreparedVideoTrack();
  clearAudioElements();
  teardownAudioGraph();
  if (r) {
    await disconnectRoom(r);
  }
}

export async function leaveCall(expectedRoom?: Room): Promise<void> {
  if (expectedRoom && room !== expectedRoom) {
    await disconnectRoom(expectedRoom);
    return;
  }
  await cleanupCall({ releaseNoSleep: true });
}
