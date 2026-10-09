import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import {
  ActivityIndicator,
  AppState,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { Feather } from "@expo/vector-icons";
import { useAuth } from "@clerk/expo";
import { DisconnectReason, RoomEvent, Track, type Room } from "livekit-client";
import { type Call, type CallWithCaller } from "@workspace/api-client-react";
import {
  ensureCallKeepAlive,
  joinCall,
  leaveCall,
  prepareVideoCall,
  primeAudioPlayback,
  resumeCallAudio,
  setCameraEnabled,
  setMuted,
  switchCamera,
  startRingback,
  startRingtone,
  stopRingback,
  stopRingtone,
  type CallMedia,
  voiceCallSupported,
} from "@/lib/voiceCall.android";
import { cancelIncomingCallNotification } from "@/lib/callNotifications";
import { useColors } from "@/hooks/useColors";
import { Avatar } from "@/components/Avatar";
import { CallVideoView } from "@/components/CallVideoView";
import {
  acceptTrackedCall,
  configureCallReliabilityOwner,
  createCallAttemptId,
  createTrackedCall,
  declineTrackedCall,
  enqueueCallTermination,
  flushPendingCallReliability,
  getTrackedCall,
  installCallReliabilityFlushTriggers,
  joinTrackedCall,
  markCallFailed,
  reportCallDiagnostic,
  resolveTrackedCallAttempt,
} from "@/lib/callApi";
import { crossAlert } from "@/lib/crossAlert";
import { isTerminalCallStatus, type CallMode } from "@/lib/callLifecycle";
import { canApplyCallCardAction } from "@/lib/callAttemptPolicy";
import {
  CALL_STATUS_CONFIRM_DELAYS_MS,
  INITIAL_REMOTE_AUDIO_OBSERVE_MS,
  classifyAudioPath,
  classifyVideoPath,
  connectionRecoverySignal,
  shouldAttemptFinalRejoin,
  type AudioPathState,
  type CallMediaSnapshot,
  type VideoPathState,
} from "@/lib/callRecoveryPolicy";
import { useCallPolling } from "@/hooks/useCallPolling";
import { usePlayMode } from "@/hooks/usePlayMode";

import {
  activateSystemCall,
  registerSystemCall,
  endSystemCall,
} from "@/lib/androidTelecom";
import { AndroidCallControls } from "@/components/AndroidCallControls";
const RING_TIMEOUT_MS = 45_000;
const KEEPALIVE_MIN_INTERVAL_MS = 8000;
const MEDIA_STATS_TIMEOUT_MS = 4_000;

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function settleWithin<T>(
  promise: Promise<T>,
  timeoutMs: number,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_resolve, reject) => {
        timer = setTimeout(
          () => reject(new Error("operation_timeout")),
          timeoutMs,
        );
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function remoteMediaSnapshot(room: Room): CallMediaSnapshot {
  let remoteMicrophonePublished = false;
  let remoteMicrophoneSubscribed = false;
  let remoteMicrophoneMuted = false;
  let remoteMicrophoneLive = false;
  let remoteCameraPublished = false;
  let remoteCameraSubscribed = false;
  let remoteCameraMuted = false;
  let remoteCameraLive = false;
  let participantCount = 0;

  for (const participant of room.remoteParticipants.values()) {
    participantCount += 1;
    const microphone = participant.getTrackPublication(Track.Source.Microphone);
    const camera = participant.getTrackPublication(Track.Source.Camera);
    // Auto-subscribe is enabled, but explicitly re-request a missing subscription
    // after a transient failure/reconnect instead of leaving the call silent.
    // A subscription request can race with a disconnect/reconnect transition.
    // Treat that as "not ready yet" and let the room events retry the snapshot
    // instead of failing the entire join from this synchronous readiness check.
    try {
      if (microphone && !microphone.track) microphone.setSubscribed(true);
      if (camera && !camera.track) camera.setSubscribed(true);
    } catch {}
    remoteMicrophonePublished ||= !!microphone;
    remoteMicrophoneSubscribed ||= !!microphone?.track;
    remoteMicrophoneMuted ||= !!microphone?.isMuted;
    remoteMicrophoneLive ||=
      microphone?.track?.mediaStreamTrack?.readyState === "live";
    remoteCameraPublished ||= !!camera;
    remoteCameraSubscribed ||= !!camera?.track;
    remoteCameraMuted ||= !!camera?.isMuted;
    remoteCameraLive ||= camera?.track?.mediaStreamTrack?.readyState === "live";
  }

  const localMicrophone = room.localParticipant.getTrackPublication(
    Track.Source.Microphone,
  );
  const localMicrophoneTrack = localMicrophone?.track?.mediaStreamTrack;
  return {
    participantCount,
    localMicrophonePublished: !!localMicrophone?.track,
    localMicrophoneMuted:
      !!localMicrophone?.isMuted || !!localMicrophoneTrack?.muted,
    localMicrophoneLive: localMicrophoneTrack?.readyState === "live",
    remoteMicrophonePublished,
    remoteMicrophoneSubscribed,
    remoteMicrophoneMuted,
    remoteMicrophoneLive,
    remoteCameraPublished,
    remoteCameraSubscribed,
    remoteCameraMuted,
    remoteCameraLive,
    playbackAllowed: Platform.OS !== "web" || room.canPlaybackAudio,
  };
}

function disconnectReasonName(reason: unknown): string {
  if (typeof reason === "number") {
    return (
      (DisconnectReason as unknown as Record<number, string>)[reason] ??
      String(reason)
    );
  }
  return reason == null ? "unknown" : String(reason);
}

type StatsTrack = {
  getRTCStatsReport?: () => Promise<unknown>;
};

type MediaFlowCounters = {
  audioBytesSent: number | null;
  audioBytesReceived: number | null;
  videoBytesSent: number | null;
  videoBytesReceived: number | null;
};

function counterFromStats(
  report: unknown,
  statsType: "outbound-rtp" | "inbound-rtp",
  field: "bytesSent" | "bytesReceived",
): number | null {
  let total = 0;
  let found = false;
  const visit = (raw: unknown) => {
    if (!raw || typeof raw !== "object") return;
    const stat = raw as Record<string, unknown>;
    if (stat.type !== statsType) return;
    const value = stat[field];
    if (typeof value !== "number" || !Number.isFinite(value)) return;
    total += value;
    found = true;
  };
  const iterable = report as {
    forEach?: (callback: (value: unknown) => void) => void;
    values?: () => Iterable<unknown>;
  } | null;
  if (typeof iterable?.forEach === "function") iterable.forEach(visit);
  else if (typeof iterable?.values === "function") {
    for (const value of iterable.values()) visit(value);
  }
  return found ? total : null;
}

async function trackCounter(
  track: StatsTrack | null | undefined,
  statsType: "outbound-rtp" | "inbound-rtp",
  field: "bytesSent" | "bytesReceived",
): Promise<number | null> {
  if (typeof track?.getRTCStatsReport !== "function") return null;
  try {
    return counterFromStats(
      await settleWithin(track.getRTCStatsReport(), MEDIA_STATS_TIMEOUT_MS),
      statsType,
      field,
    );
  } catch {
    return null;
  }
}

async function mediaFlowCounters(room: Room): Promise<MediaFlowCounters> {
  const localMicrophone = room.localParticipant.getTrackPublication(
    Track.Source.Microphone,
  )?.track as StatsTrack | undefined;
  const localCamera = room.localParticipant.getTrackPublication(
    Track.Source.Camera,
  )?.track as StatsTrack | undefined;
  const remoteMicrophones: StatsTrack[] = [];
  const remoteCameras: StatsTrack[] = [];
  for (const participant of room.remoteParticipants.values()) {
    const microphone = participant.getTrackPublication(
      Track.Source.Microphone,
    )?.track;
    const camera = participant.getTrackPublication(Track.Source.Camera)?.track;
    if (microphone) remoteMicrophones.push(microphone as StatsTrack);
    if (camera) remoteCameras.push(camera as StatsTrack);
  }
  const sumRemote = async (
    tracks: StatsTrack[],
    field: "bytesSent" | "bytesReceived",
  ) => {
    const counters = await Promise.all(
      tracks.map((track) => trackCounter(track, "inbound-rtp", field)),
    );
    const available = counters.filter(
      (value): value is number => value != null,
    );
    return available.length > 0
      ? available.reduce((sum, value) => sum + value, 0)
      : null;
  };
  const [
    audioBytesSent,
    audioBytesReceived,
    videoBytesSent,
    videoBytesReceived,
  ] = await Promise.all([
    trackCounter(localMicrophone, "outbound-rtp", "bytesSent"),
    sumRemote(remoteMicrophones, "bytesReceived"),
    trackCounter(localCamera, "outbound-rtp", "bytesSent"),
    sumRemote(remoteCameras, "bytesReceived"),
  ]);
  return {
    audioBytesSent,
    audioBytesReceived,
    videoBytesSent,
    videoBytesReceived,
  };
}

function counterDelta(
  current: number | null,
  previous: number | null,
): number | null {
  if (current == null || previous == null) return null;
  return Math.max(0, current - previous);
}

function callFailureCode(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err);
  if (message === "call_foreground_service_unavailable")
    return "native_module_unavailable";
  if (message === "microphone_permission_denied")
    return "microphone_permission_denied";
  if (message === "audio_session_start_failed")
    return "audio_session_start_failed";
  if (message === "microphone_publish_failed")
    return "microphone_publish_failed";
  if (/network|websocket|signal|connect/i.test(message))
    return "transport_connect_failed";
  return "unknown_join_failure";
}

interface CallContextValue {
  startCall: (
    calleeId: string,
    calleeName: string,
    roomId?: string,
    media?: CallMedia,
  ) => Promise<void>;
  joinFromCard: (
    callId: string,
    peerName: string,
    media?: CallMedia,
  ) => Promise<boolean>;
  declineFromCard: (callId: string) => Promise<boolean>;
  supported: boolean;
}

const CallContext = createContext<CallContextValue | null>(null);

export function useCall(): CallContextValue {
  const ctx = useContext(CallContext);
  if (!ctx) throw new Error("useCall must be used within CallProvider");
  return ctx;
}

export function CallProvider({ children }: { children: React.ReactNode }) {
  const { isSignedIn, userId } = useAuth();

  useEffect(() => {
    configureCallReliabilityOwner(isSignedIn ? userId : null);
  }, [isSignedIn, userId]);

  return (
    <CallContext.Provider
      value={{
        startCall: async () => {},
        joinFromCard: async () => false,
        declineFromCard: async () => false,
        supported: voiceCallSupported,
      }}
    >
      {isSignedIn ? <CallManager>{children}</CallManager> : children}
    </CallContext.Provider>
  );
}

function CallManager({ children }: { children: React.ReactNode }) {
  const { equippedStar } = usePlayMode();
  const callIdentityLabel = equippedStar
    ? `통화 프로필 · STAR ${equippedStar.displayName}`
    : "통화 프로필 · FAN";
  const colors = useColors();

  const [minimized, setMinimized] = useState(false);
  const [mode, setMode] = useState<CallMode>("idle");
  const [activeCall, setActiveCall] = useState<Call | null>(null);
  const [incoming, setIncoming] = useState<CallWithCaller | null>(null);
  const [peerName, setPeerName] = useState("");
  const [muted, setMutedState] = useState(false);
  const [callMedia, setCallMedia] = useState<CallMedia>("audio");
  const [liveRoom, setLiveRoom] = useState<Room | null>(null);
  const [cameraOn, setCameraOnState] = useState(true);
  const [cameraPreparing, setCameraPreparing] = useState(false);
  const [cameraIssue, setCameraIssue] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [audioPath, setAudioPath] = useState<AudioPathState>(
    "waiting_for_participant",
  );
  const [videoPath, setVideoPath] = useState<VideoPathState>("not_requested");
  const [audioPlaybackBlocked, setAudioPlaybackBlocked] = useState(false);
  const [recoveryStage, setRecoveryStage] = useState<
    "none" | "sdk" | "validating" | "rejoining"
  >("none");

  const modeRef = useRef(mode);
  modeRef.current = mode;
  const activeCallRef = useRef(activeCall);
  activeCallRef.current = activeCall;
  const incomingRef = useRef(incoming);
  incomingRef.current = incoming;
  const liveRoomRef = useRef(liveRoom);
  liveRoomRef.current = liveRoom;
  const mutedRef = useRef(muted);
  mutedRef.current = muted;
  const cameraWantedRef = useRef(true);
  const cameraActionRef = useRef(0);
  const cameraOutcomeRef = useRef<{
    generation: number;
    published: boolean;
  } | null>(null);
  const expectedDisconnectRef = useRef(false);
  const disconnectHandlingRef = useRef(false);
  const joinedCallIdRef = useRef<string | null>(null);
  const mediaJoinCallIdRef = useRef<string | null>(null);
  // Server generation and local diagnostic correlation are deliberately
  // separate for legacy calls whose durable attempt_id is null.
  const attemptIdRef = useRef<string | undefined>(undefined);
  const diagnosticAttemptIdRef = useRef(createCallAttemptId());
  const sessionGenerationRef = useRef(0);
  const finalRejoinAttemptsRef = useRef(0);
  const appStateRef = useRef(AppState.currentState);
  const mediaAppStateRef = useRef(AppState.currentState);
  const lastKeepAliveAtRef = useRef(0);
  const expectedDisconnectTimerRef = useRef<ReturnType<
    typeof setTimeout
  > | null>(null);

  // Realtime events drive incoming calls; this is a slow fallback for reconnect gaps.
  const { incomingList, refetchIncoming, watched, refetchWatched, watchId } =
    useCallPolling({
      mode,
      activeCallId: activeCall?.id,
      incomingCallId: incoming?.id,
    });

  useEffect(() => {
    if (modeRef.current !== "idle") return;
    const next = incomingList?.[0];
    if (next) {
      sessionGenerationRef.current += 1;
      const serverAttemptId = (next as CallWithCaller & { attemptId?: string })
        .attemptId;
      attemptIdRef.current = serverAttemptId ?? undefined;
      diagnosticAttemptIdRef.current = serverAttemptId ?? createCallAttemptId();
      finalRejoinAttemptsRef.current = 0;
      setIncoming(next);
      setPeerName(next.caller.nickname);
      setCallMedia(next.media ?? "audio");
      setCameraOnState((next.media ?? "audio") === "video");
      cameraWantedRef.current = (next.media ?? "audio") === "video";
      setMode("incoming");
      void registerSystemCall(next, next.caller.nickname ?? "DavaQ").catch(
        () => {},
      );
    }
  }, [incomingList]);

  useEffect(() => installCallReliabilityFlushTriggers(), []);

  // Poll the relevant call to detect remote accept/decline/end/expiry.
  // - outgoing/joining/active: watch our active call
  // - incoming: watch the ringing call so we can auto-dismiss if the caller hangs up

  // Timers and realtime events can be paused while the app is backgrounded.
  // Refresh both the call currently on screen and incoming-call fallback data as
  // soon as Android/iOS wakes the app so terminal states do not linger in UI.
  useEffect(() => {
    const sub = AppState.addEventListener("change", (state) => {
      const previousState = appStateRef.current;
      appStateRef.current = state;
      if (previousState !== "active" && state === "active") {
        flushPendingCallReliability();
        void refetchIncoming();
        if (watchId) void refetchWatched();
      }
    });
    return () => sub.remove();
  }, [refetchIncoming, refetchWatched, watchId]);

  const clearDisconnectHandling = useCallback(() => {
    disconnectHandlingRef.current = false;
  }, []);

  const reset = useCallback(
    async (expectedGeneration?: number): Promise<boolean> => {
      if (
        expectedGeneration !== undefined &&
        expectedGeneration !== sessionGenerationRef.current
      ) {
        return false;
      }
      const oldSystemCallId =
        activeCallRef.current?.id ??
        incomingRef.current?.id ??
        mediaJoinCallIdRef.current;
      const resetGeneration = ++sessionGenerationRef.current;
      if (oldSystemCallId) void endSystemCall(oldSystemCallId).catch(() => {});
      setMinimized(false);
      clearDisconnectHandling();
      expectedDisconnectRef.current = true;
      if (expectedDisconnectTimerRef.current) {
        clearTimeout(expectedDisconnectTimerRef.current);
        expectedDisconnectTimerRef.current = null;
      }
      stopRingback();
      stopRingtone();
      joinedCallIdRef.current = null;
      mediaJoinCallIdRef.current = null;
      liveRoomRef.current = null;
      lastKeepAliveAtRef.current = 0;
      finalRejoinAttemptsRef.current = 0;
      attemptIdRef.current = undefined;
      diagnosticAttemptIdRef.current = createCallAttemptId();
      setActiveCall(null);
      setIncoming(null);
      setPeerName("");
      setCallMedia("audio");
      setLiveRoom(null);
      setCameraOnState(true);
      setCameraPreparing(false);
      setCameraIssue(null);
      cameraWantedRef.current = true;
      mutedRef.current = false;
      setMutedState(false);
      setConnecting(false);
      setRecoveryStage("none");
      setAudioPath("waiting_for_participant");
      setVideoPath("not_requested");
      setAudioPlaybackBlocked(false);
      await Promise.allSettled([leaveCall(), cancelIncomingCallNotification()]);
      setMode("idle");
      expectedDisconnectTimerRef.current = setTimeout(() => {
        if (sessionGenerationRef.current === resetGeneration) {
          expectedDisconnectRef.current = false;
        }
        expectedDisconnectTimerRef.current = null;
      }, 1000);
      return true;
    },
    [clearDisconnectHandling],
  );

  // A signed-out/unmounted call manager must not leave the Android foreground
  // service running after its React owner disappears.
  useEffect(() => {
    return () => {
      sessionGenerationRef.current += 1;
      clearDisconnectHandling();
      expectedDisconnectRef.current = true;
      if (expectedDisconnectTimerRef.current) {
        clearTimeout(expectedDisconnectTimerRef.current);
        expectedDisconnectTimerRef.current = null;
      }
      stopRingback();
      stopRingtone();
      const systemId =
        activeCallRef.current?.id ??
        incomingRef.current?.id ??
        mediaJoinCallIdRef.current;
      if (systemId) void endSystemCall(systemId).catch(() => {});
      void Promise.allSettled([leaveCall(), cancelIncomingCallNotification()]);
    };
  }, [clearDisconnectHandling]);

  const diagnosticFor = useCallback(
    (
      callId: string,
      role: string,
      generation = sessionGenerationRef.current,
    ) => {
      const attemptId = diagnosticAttemptIdRef.current;
      return (phase: string, details?: Record<string, unknown>) => {
        reportCallDiagnostic(callId, {
          attemptId,
          phase,
          platform: Platform.OS,
          role,
          details,
        });
        if (generation !== sessionGenerationRef.current) return;
        if (phase === "web_camera_capture_start") setCameraIssue(null);
        if (phase === "web_camera_capture_failed") {
          setCameraIssue(
            details?.errorName === "NotAllowedError"
              ? "카메라 권한을 허용한 뒤 카메라 버튼을 눌러주세요."
              : "카메라를 켜지 못했어요. 권한과 다른 앱의 카메라 사용을 확인한 뒤 다시 눌러주세요.",
          );
        }
        if (phase === "web_camera_capture_still_pending") {
          setCameraIssue(
            "카메라 권한 창을 확인해 주세요. 계속 대기하면 통화를 마친 뒤 앱을 다시 열어주세요.",
          );
        }
        if (phase === "web_camera_publish_still_pending") {
          setCameraIssue(
            "카메라 영상 전송 준비가 지연되고 있어요. 잠시 후 카메라 버튼을 다시 눌러주세요.",
          );
        }
        if (phase === "web_camera_publish_result") {
          cameraOutcomeRef.current = {
            generation,
            published: details?.cameraPublished === true,
          };
          setCameraPreparing(false);
          if (details?.cameraPublished === true) setCameraIssue(null);
          if (cameraWantedRef.current)
            setCameraOnState(details?.cameraPublished === true);
        }
        if (
          phase === "web_remote_audio_play_blocked" ||
          phase === "web_audio_playback_blocked"
        ) {
          setAudioPlaybackBlocked(true);
        }
        if (
          phase === "web_remote_audio_playing" ||
          phase === "web_audio_unlocked" ||
          phase === "web_audio_playback_allowed"
        ) {
          setAudioPlaybackBlocked(false);
        }
      };
    },
    [],
  );

  const validateJoinResult = useCallback(
    (
      result: Awaited<ReturnType<typeof joinCall>>,
      callId: string,
      role: string,
      cameraExpected = true,
    ) => {
      reportCallDiagnostic(callId, {
        attemptId: diagnosticAttemptIdRef.current,
        phase: "join_result",
        platform: Platform.OS,
        role,
        details: {
          media: result.media,
          microphonePublished: result.microphonePublished,
          cameraPublished: result.cameraPublished,
        },
      });
      if (!result.microphonePublished)
        throw new Error("microphone_publish_failed");
      if (
        cameraExpected &&
        result.media === "video" &&
        !result.cameraPublished &&
        !result.cameraPending
      ) {
        reportCallDiagnostic(callId, {
          attemptId: diagnosticAttemptIdRef.current,
          phase: "local_camera_unavailable_audio_continues",
          platform: Platform.OS,
          role,
          details: { media: result.media },
        });
      }
    },
    [],
  );

  const applyJoinedCameraState = useCallback(
    (result: Awaited<ReturnType<typeof joinCall>>) => {
      const publication = result.room.localParticipant.getTrackPublication(
        Track.Source.Camera,
      );
      const published = !!publication?.track && !publication.isMuted;
      const outcome =
        cameraOutcomeRef.current?.generation === sessionGenerationRef.current
          ? cameraOutcomeRef.current
          : null;
      const pending =
        result.media === "video" &&
        !!result.cameraPending &&
        !published &&
        !outcome;
      const wanted =
        result.media === "video" &&
        (published || result.cameraPublished || pending);
      setCameraPreparing(pending);
      setCameraOnState(wanted);
      cameraWantedRef.current = wanted;
    },
    [],
  );

  const failCallLocally = useCallback(
    async (
      callId: string | null,
      role: string,
      err: unknown,
      generation?: number,
    ) => {
      if (
        generation !== undefined &&
        generation !== sessionGenerationRef.current
      )
        return;
      if (callId) {
        const message = err instanceof Error ? err.message : String(err);
        reportCallDiagnostic(callId, {
          attemptId: diagnosticAttemptIdRef.current,
          phase: "join_failed",
          platform: Platform.OS,
          role,
          details: { code: callFailureCode(err), message },
        });
        await markCallFailed(callId, attemptIdRef.current);
      }
      const didReset = await reset(generation);
      if (!didReset) return;
      crossAlert(
        "통화 연결 실패",
        "통화 연결에 실패했습니다. 잠시 후 다시 시도해주세요.",
      );
    },
    [reset],
  );

  // Ring the incoming ringtone (벨소리) while the incoming modal is up, and stop
  // it the moment we leave the incoming state (accept/decline/timeout/cancel).
  useEffect(() => {
    if (mode === "incoming") {
      startRingtone();
      return () => stopRingtone();
    }
  }, [mode]);

  // Local safety net for missed realtime/poll updates. The server remains
  // authoritative, but the phone should never keep ringing past its ring window.
  useEffect(() => {
    if (mode !== "incoming" || !incoming?.createdAt) return;
    const createdAt = new Date(incoming.createdAt).getTime();
    if (!Number.isFinite(createdAt)) return;
    const remaining = Math.max(0, RING_TIMEOUT_MS - (Date.now() - createdAt));
    const timer = setTimeout(() => {
      if (modeRef.current !== "incoming") return;
      stopRingtone();
      void cancelIncomingCallNotification();
      setIncoming(null);
      setMode("idle");
      void endSystemCall(incoming.id).catch(() => {});
    }, remaining);
    return () => clearTimeout(timer);
  }, [mode, incoming?.createdAt]);

  const joinAcceptedOutgoing = useCallback(
    async (call: Call) => {
      if (
        joinedCallIdRef.current === call.id ||
        mediaJoinCallIdRef.current === call.id
      )
        return;
      const generation = sessionGenerationRef.current;
      mediaJoinCallIdRef.current = call.id;
      stopRingback();
      const media = call.media ?? callMedia;
      const isCurrentJoin = () =>
        generation === sessionGenerationRef.current &&
        mediaJoinCallIdRef.current === call.id &&
        modeRef.current !== "idle";
      setActiveCall(call);
      setCallMedia(media);
      setCameraOnState(media === "video");
      cameraWantedRef.current = media === "video";
      setMode("joining");
      setConnecting(true);
      let shouldMarkFailed = false;
      try {
        const session = await joinTrackedCall(call.id, attemptIdRef.current);
        shouldMarkFailed = true;
        if (!isCurrentJoin()) return;
        const joinedMedia = session.call.media ?? media;
        if (joinedMedia === "video")
          void prepareVideoCall(
            diagnosticFor(call.id, "caller", generation),
          ).catch(() => {});
        if (!isCurrentJoin()) return;
        setActiveCall(session.call);
        setCallMedia(joinedMedia);
        setCameraOnState(joinedMedia === "video");
        cameraWantedRef.current = joinedMedia === "video";
        const onDiagnostic = diagnosticFor(call.id, "caller", generation);
        await activateSystemCall(session.call, peerName || "DavaQ");
        if (generation !== sessionGenerationRef.current) {
          await endSystemCall(session.call.id);
          throw new Error("stale_join_attempt");
        }
        const joined = await joinCall(session.url, session.token, {
          callId: session.call.id,
          media: joinedMedia,
          onDiagnostic,
        });
        if (!isCurrentJoin()) {
          await leaveCall(joined.room);
          return;
        }
        validateJoinResult(joined, call.id, "caller");
        liveRoomRef.current = joined.room;
        setLiveRoom(joined.room);
        applyJoinedCameraState(joined);
        joinedCallIdRef.current = call.id;
        setConnecting(false);
        setRecoveryStage("none");
        setMode("active");
      } catch (err) {
        if (!isCurrentJoin()) return;
        if (shouldMarkFailed)
          await failCallLocally(call.id, "caller", err, generation);
        else await reset(generation);
      } finally {
        if (mediaJoinCallIdRef.current === call.id)
          mediaJoinCallIdRef.current = null;
      }
    },
    [
      applyJoinedCameraState,
      callMedia,
      diagnosticFor,
      failCallLocally,
      reset,
      validateJoinResult,
    ],
  );

  useEffect(() => {
    if (!watched || watched.id !== watchId) return;
    const generation = sessionGenerationRef.current;
    const ended = isTerminalCallStatus(watched.status);

    if (modeRef.current === "incoming") {
      // Caller cancelled/hung up, the call expired, or another device answered →
      // dismiss the modal and any full-screen notification on this device.
      if (ended || watched.status !== "ringing") {
        stopRingtone();
        void cancelIncomingCallNotification();
        setIncoming(null);
        setMode("idle");
      }
      return;
    }

    if (watched.status === "active" && modeRef.current === "outgoing") {
      // Callee answered — only now join media so the caller does not burn CPU or
      // hold camera/mic while the other side is still ringing.
      void joinAcceptedOutgoing(watched);
      return;
    }

    if (ended) {
      void reset(generation);
    }
  }, [watchId, watched, joinAcceptedOutgoing, reset]);

  useEffect(() => {
    if (callMedia !== "video" || mode !== "active" || connecting || !liveRoom)
      return;
    const generation = sessionGenerationRef.current;
    let disposed = false;
    const sub = AppState.addEventListener("change", (state) => {
      if (state !== "active" || !cameraWantedRef.current) return;
      const cameraAction = cameraActionRef.current;
      void setCameraEnabled(true)
        .then((ok) => {
          if (
            disposed ||
            generation !== sessionGenerationRef.current ||
            liveRoomRef.current !== liveRoom ||
            cameraAction !== cameraActionRef.current ||
            !cameraWantedRef.current
          )
            return;
          setCameraOnState(ok);
        })
        .catch(() => {});
    });
    return () => {
      disposed = true;
      sub.remove();
    };
  }, [callMedia, connecting, liveRoom, mode]);

  useEffect(() => {
    if (!activeCall?.id || !liveRoom || mode !== "active") return;
    const callId = activeCall.id;
    const generation = sessionGenerationRef.current;
    const diagnostic = diagnosticFor(callId, "media-path", generation);
    let lastAudio: AudioPathState | null = null;
    let lastVideo: VideoPathState | null = null;
    const observe = () => {
      if (
        generation !== sessionGenerationRef.current ||
        liveRoomRef.current !== liveRoom ||
        activeCallRef.current?.id !== callId
      ) {
        return;
      }
      const snapshot = remoteMediaSnapshot(liveRoom);
      const nextAudio = classifyAudioPath(snapshot);
      const nextVideo = classifyVideoPath(snapshot, callMedia === "video");
      setAudioPath(nextAudio);
      setVideoPath(nextVideo);
      if (nextAudio !== lastAudio || nextVideo !== lastVideo) {
        lastAudio = nextAudio;
        lastVideo = nextVideo;
        diagnostic("media_path_changed", {
          audioPath: nextAudio,
          videoPath: nextVideo,
          ...snapshot,
        });
      }
    };
    const events = [
      RoomEvent.ParticipantConnected,
      RoomEvent.ParticipantDisconnected,
      RoomEvent.ParticipantActive,
      RoomEvent.TrackPublished,
      RoomEvent.TrackSubscribed,
      RoomEvent.TrackUnsubscribed,
      RoomEvent.TrackMuted,
      RoomEvent.TrackUnmuted,
      RoomEvent.AudioPlaybackStatusChanged,
      RoomEvent.Reconnected,
    ] as const;
    events.forEach((event) => liveRoom.on(event, observe));
    const timer = setTimeout(() => {
      if (
        generation !== sessionGenerationRef.current ||
        liveRoomRef.current !== liveRoom
      )
        return;
      const snapshot = remoteMediaSnapshot(liveRoom);
      const currentAudio = classifyAudioPath(snapshot);
      if (currentAudio !== "ready" && currentAudio !== "remote_muted") {
        diagnostic("initial_remote_audio_observation_elapsed", {
          timeoutMs: INITIAL_REMOTE_AUDIO_OBSERVE_MS,
          audioPath: currentAudio,
          ...snapshot,
        });
      }
    }, INITIAL_REMOTE_AUDIO_OBSERVE_MS);
    observe();
    return () => {
      clearTimeout(timer);
      events.forEach((event) => liveRoom.off(event, observe));
    };
  }, [activeCall?.id, callMedia, diagnosticFor, liveRoom, mode]);

  useEffect(() => {
    if (!activeCall?.id || !liveRoom || mode !== "active") return;
    const callId = activeCall.id;
    const generation = sessionGenerationRef.current;
    const diagnostic = diagnosticFor(callId, "media-flow", generation);
    let previous: MediaFlowCounters | null = null;
    let sampledAt = Date.now();
    let timer: ReturnType<typeof setTimeout> | null = null;
    let cancelled = false;
    const isCurrent = () =>
      !cancelled &&
      generation === sessionGenerationRef.current &&
      liveRoomRef.current === liveRoom &&
      activeCallRef.current?.id === callId;
    const sample = async () => {
      if (!isCurrent()) return;
      const current = await mediaFlowCounters(liveRoom);
      if (!isCurrent()) return;
      const now = Date.now();
      const prior = previous;
      const hadPrevious = prior !== null;
      if (prior) {
        const audioBytesSentDelta = counterDelta(
          current.audioBytesSent,
          prior.audioBytesSent,
        );
        const audioBytesReceivedDelta = counterDelta(
          current.audioBytesReceived,
          prior.audioBytesReceived,
        );
        const videoBytesSentDelta = counterDelta(
          current.videoBytesSent,
          prior.videoBytesSent,
        );
        const videoBytesReceivedDelta = counterDelta(
          current.videoBytesReceived,
          prior.videoBytesReceived,
        );
        // A subscribed/live track is not proof that packets are flowing. Record
        // actual RTP byte movement in both directions without terminating an
        // otherwise-valid silent or camera-off call when a sample is zero.
        diagnostic("media_flow_sample", {
          sampleMs: now - sampledAt,
          audioBytesSentDelta,
          audioBytesReceivedDelta,
          videoBytesSentDelta,
          videoBytesReceivedDelta,
          audioOutboundObserved:
            audioBytesSentDelta == null ? null : audioBytesSentDelta > 0,
          audioInboundObserved:
            audioBytesReceivedDelta == null
              ? null
              : audioBytesReceivedDelta > 0,
          videoOutboundObserved:
            videoBytesSentDelta == null ? null : videoBytesSentDelta > 0,
          videoInboundObserved:
            videoBytesReceivedDelta == null
              ? null
              : videoBytesReceivedDelta > 0,
          playbackAllowed: Platform.OS !== "web" || liveRoom.canPlaybackAudio,
        });
      }
      previous = current;
      sampledAt = now;
      timer = setTimeout(sample, hadPrevious ? 30_000 : 5_000);
    };
    // Capture a baseline now, a first useful delta after five seconds, then keep
    // low-frequency samples for long-call/reconnect diagnosis.
    void sample();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [activeCall?.id, diagnosticFor, liveRoom, mode]);

  useEffect(() => {
    if (!activeCall?.id || !liveRoom || mode !== "active") return;
    const callId = activeCall.id;
    const generation = sessionGenerationRef.current;
    const attemptId = attemptIdRef.current;
    const diagnosticAttemptId = diagnosticAttemptIdRef.current;
    const report = (phase: string, details?: Record<string, unknown>) => {
      reportCallDiagnostic(callId, {
        attemptId: diagnosticAttemptId,
        phase,
        platform: Platform.OS,
        role: "in-call",
        details,
      });
    };
    const connectionDetails = () => ({
      appState: AppState.currentState,
      callMode: modeRef.current,
      connectionState: liveRoom.state,
    });
    const isCurrent = () =>
      generation === sessionGenerationRef.current &&
      liveRoomRef.current === liveRoom &&
      activeCallRef.current?.id === callId &&
      modeRef.current === "active";
    const onReconnecting = () => {
      if (!isCurrent()) return;
      setConnecting(true);
      setRecoveryStage("sdk");
      report("livekit_reconnecting", connectionDetails());
    };
    const onReconnected = () => {
      if (!isCurrent()) return;
      clearDisconnectHandling();
      finalRejoinAttemptsRef.current = 0;
      setConnecting(false);
      setRecoveryStage("none");
      report("livekit_reconnected", connectionDetails());
    };
    const onDisconnected = (reason?: unknown) => {
      if (!isCurrent()) return;
      const expected =
        expectedDisconnectRef.current || modeRef.current === "idle";
      const reasonName = disconnectReasonName(reason);
      report("livekit_disconnected", {
        ...connectionDetails(),
        expected,
        reason: reasonName,
      });
      if (expected || disconnectHandlingRef.current) return;
      disconnectHandlingRef.current = true;
      setConnecting(true);
      setRecoveryStage("validating");
      report("final_disconnect_status_validation_started", connectionDetails());
      void (async () => {
        let currentCall: Call | null = null;
        for (const delayMs of CALL_STATUS_CONFIRM_DELAYS_MS) {
          if (delayMs > 0) await wait(delayMs);
          if (!isCurrent() || expectedDisconnectRef.current) return;
          try {
            currentCall = await getTrackedCall(callId, attemptId);
            break;
          } catch (err) {
            report("final_disconnect_status_validation_failed", {
              delayMs,
              errorName: err instanceof Error ? err.name : "unknown",
            });
          }
        }
        if (!isCurrent() || expectedDisconnectRef.current) return;
        if (currentCall && isTerminalCallStatus(currentCall.status)) {
          report("final_disconnect_terminal", { status: currentCall.status });
          await reset(generation);
          return;
        }
        if (
          !shouldAttemptFinalRejoin({
            expectedDisconnect: expectedDisconnectRef.current,
            mode: modeRef.current,
            serverStatus: currentCall?.status,
            finalRejoinAttempts: finalRejoinAttemptsRef.current,
            disconnectReason: reasonName,
          })
        ) {
          report("final_disconnect_not_rejoinable", {
            reason: reasonName,
            status: currentCall?.status,
            finalRejoinAttempts: finalRejoinAttemptsRef.current,
          });
          const didReset = await reset(generation);
          if (didReset) {
            crossAlert(
              "통화 연결 끊김",
              "연결이 종료되었습니다. 잠시 후 다시 시도해주세요.",
            );
          }
          return;
        }

        finalRejoinAttemptsRef.current += 1;
        const rejoinGeneration = ++sessionGenerationRef.current;
        setRecoveryStage("rejoining");
        report("final_disconnect_rejoin_started", {
          attempt: finalRejoinAttemptsRef.current,
          reason: reasonName,
        });
        try {
          const session = await joinTrackedCall(callId, attemptId);
          if (
            rejoinGeneration !== sessionGenerationRef.current ||
            expectedDisconnectRef.current ||
            modeRef.current !== "active"
          ) {
            return;
          }
          const media = session.call.media ?? callMedia;
          if (media === "video" && cameraWantedRef.current) {
            void prepareVideoCall(
              diagnosticFor(callId, "rejoin", rejoinGeneration),
            ).catch(() => {});
          }
          await activateSystemCall(session.call, peerName || "DavaQ");
          if (rejoinGeneration !== sessionGenerationRef.current) {
            await endSystemCall(session.call.id);
            throw new Error("stale_join_attempt");
          }
          const joined = await joinCall(session.url, session.token, {
            callId: session.call.id,
            media,
            cameraEnabled: cameraWantedRef.current,
            onDiagnostic: diagnosticFor(callId, "rejoin", rejoinGeneration),
          });
          if (
            rejoinGeneration !== sessionGenerationRef.current ||
            expectedDisconnectRef.current ||
            modeRef.current !== "active"
          ) {
            await leaveCall(joined.room);
            return;
          }
          validateJoinResult(joined, callId, "rejoin", cameraWantedRef.current);
          if (mutedRef.current) await setMuted(true);
          if (
            rejoinGeneration !== sessionGenerationRef.current ||
            expectedDisconnectRef.current ||
            modeRef.current !== "active"
          ) {
            await leaveCall(joined.room);
            return;
          }
          liveRoomRef.current = joined.room;
          setLiveRoom(joined.room);
          setActiveCall(session.call);
          setCallMedia(media);
          applyJoinedCameraState(joined);
          setConnecting(false);
          setRecoveryStage("none");
          disconnectHandlingRef.current = false;
          report("final_disconnect_rejoin_succeeded", {
            attempt: finalRejoinAttemptsRef.current,
          });
        } catch (err) {
          if (rejoinGeneration !== sessionGenerationRef.current) return;
          report("final_disconnect_rejoin_failed", {
            attempt: finalRejoinAttemptsRef.current,
            errorName: err instanceof Error ? err.name : "unknown",
          });
          await markCallFailed(callId, attemptId);
          const didReset = await reset(rejoinGeneration);
          if (didReset) {
            crossAlert(
              "통화 연결 끊김",
              "연결을 복구하지 못했습니다. 다시 걸어주세요.",
            );
          }
        }
      })().finally(() => {
        if (generation === sessionGenerationRef.current) {
          disconnectHandlingRef.current = false;
        }
      });
    };
    liveRoom.on(RoomEvent.Reconnecting, onReconnecting);
    liveRoom.on(RoomEvent.Reconnected, onReconnected);
    liveRoom.on(RoomEvent.Disconnected, onDisconnected);
    // A final disconnect can happen after joinCall() resolves but before React
    // commits this effect. Attach first, then inspect the current state so that
    // neither side of that listener-registration window can lose recovery.
    const observedState = connectionRecoverySignal(liveRoom.state);
    if (observedState === "reconnecting") {
      onReconnecting();
    } else if (observedState === "disconnected") {
      report("livekit_disconnected_observed_on_attach", connectionDetails());
      onDisconnected("state_observed_disconnected");
    }
    return () => {
      liveRoom.off(RoomEvent.Reconnecting, onReconnecting);
      liveRoom.off(RoomEvent.Reconnected, onReconnected);
      liveRoom.off(RoomEvent.Disconnected, onDisconnected);
    };
  }, [
    activeCall?.id,
    callMedia,
    clearDisconnectHandling,
    diagnosticFor,
    liveRoom,
    mode,
    reset,
    applyJoinedCameraState,
    validateJoinResult,
  ]);

  useEffect(() => {
    if (!activeCall?.id || !liveRoom || mode !== "active") return;
    const callId = activeCall.id;
    const attemptId = diagnosticAttemptIdRef.current;
    const diagnostic = (phase: string, details?: Record<string, unknown>) => {
      reportCallDiagnostic(callId, {
        attemptId,
        phase,
        platform: Platform.OS,
        role: "in-call",
        details,
      });
    };
    const sub = AppState.addEventListener("change", (state) => {
      const previousState = mediaAppStateRef.current;
      mediaAppStateRef.current = state;
      diagnostic("app_state_change", {
        previousState,
        state,
        callMode: modeRef.current,
        connectionState: liveRoom.state,
      });
      const returnedToForeground =
        previousState !== "active" && state === "active";
      const now = Date.now();
      if (
        Platform.OS === "android" &&
        returnedToForeground &&
        now - lastKeepAliveAtRef.current >= KEEPALIVE_MIN_INTERVAL_MS
      ) {
        lastKeepAliveAtRef.current = now;
        void ensureCallKeepAlive(callMedia, `app_state_${state}`, diagnostic);
      }
    });
    return () => sub.remove();
  }, [activeCall?.id, callMedia, liveRoom, mode]);

  const startCall = useCallback(
    async (
      calleeId: string,
      calleeName: string,
      roomId?: string,
      media: CallMedia = "audio",
    ) => {
      if (!voiceCallSupported) {
        return;
      }
      if (modeRef.current !== "idle") return;
      const generation = ++sessionGenerationRef.current;
      const attemptId = createCallAttemptId();
      attemptIdRef.current = attemptId;
      diagnosticAttemptIdRef.current = attemptId;
      finalRejoinAttemptsRef.current = 0;
      expectedDisconnectRef.current = false;
      // Grab media-playback permission NOW, on the genuine button gesture —
      // the createCall await below would otherwise spend the activation before
      // joinCall() can pre-authorize audio, leaving the caller silent.
      primeAudioPlayback();
      // Ringback (통화 연결음) while we wait for the callee to answer. The button
      // gesture just unlocked the AudioContext, so this actually sounds.
      startRingback();
      setPeerName(calleeName);
      setCallMedia(media);
      setCameraOnState(media === "video");
      cameraWantedRef.current = media === "video";
      setMode("outgoing");
      setConnecting(true);
      setRecoveryStage("none");
      reportCallDiagnostic(null, {
        attemptId,
        phase: "create_call_api_start",
        platform: Platform.OS,
        role: "caller",
        details: { media, hasRoomId: !!roomId },
      });
      let createdCallId: string | undefined;
      try {
        const session = await createTrackedCall(
          { calleeId, roomId, media },
          attemptId,
        );
        if (
          generation !== sessionGenerationRef.current ||
          String(modeRef.current) !== "outgoing"
        ) {
          // The user may have cancelled while the create response was in flight.
          // End the exact late call A; the server's call-id fence prevents this
          // cleanup from touching a newer call B.
          await enqueueCallTermination(session.call.id, attemptId).catch(
            () => {},
          );
          return;
        }
        reportCallDiagnostic(session.call.id, {
          attemptId,
          phase: "create_call_api_succeeded",
          platform: Platform.OS,
          role: "caller",
          details: { media: session.call.media },
        });
        createdCallId = session.call.id;
        setActiveCall(session.call);
        await registerSystemCall(session.call, calleeName);
        if (generation !== sessionGenerationRef.current) {
          await endSystemCall(session.call.id);
          await enqueueCallTermination(session.call.id, attemptId).catch(
            () => {},
          );
          return;
        }
        setConnecting(false);
      } catch (err) {
        if (createdCallId)
          await enqueueCallTermination(createdCallId, attemptId).catch(
            () => {},
          );
        if (generation !== sessionGenerationRef.current) return;
        reportCallDiagnostic(null, {
          attemptId,
          phase: "create_call_api_failed",
          platform: Platform.OS,
          role: "caller",
          details: { errorName: err instanceof Error ? err.name : "unknown" },
        });
        await reset(generation);
      }
    },
    [reset],
  );

  // Join an existing call from the in-chat call card. Either party may tap the
  // card; the callee joining a ringing call also accepts it (server-side).
  const joinFromCard = useCallback(
    async (callId: string, peer: string, media: CallMedia = "audio") => {
      if (!voiceCallSupported) return false;
      if (
        !canApplyCallCardAction(
          modeRef.current,
          incomingRef.current?.id,
          callId,
        )
      )
        return false;
      // Already in a call (outgoing/joining/active) → ignore. If a matching incoming
      // modal is up, clear it so we don't show both the modal and the overlay.
      if (
        modeRef.current === "outgoing" ||
        modeRef.current === "joining" ||
        modeRef.current === "active"
      ) {
        return true;
      }
      if (modeRef.current === "incoming") {
        setIncoming(null);
        void cancelIncomingCallNotification();
      }
      const generation = ++sessionGenerationRef.current;
      attemptIdRef.current = undefined;
      diagnosticAttemptIdRef.current = createCallAttemptId();
      finalRejoinAttemptsRef.current = 0;
      expectedDisconnectRef.current = false;
      // Unlock audio on the card-tap gesture, before the join await.
      primeAudioPlayback();
      if (media === "video") void prepareVideoCall().catch(() => {});
      setPeerName(peer);
      setCallMedia(media);
      setCameraOnState(media === "video");
      cameraWantedRef.current = media === "video";
      mediaJoinCallIdRef.current = callId;
      const isCurrentJoin = () =>
        generation === sessionGenerationRef.current &&
        mediaJoinCallIdRef.current === callId &&
        modeRef.current !== "idle";
      setMode("joining");
      setConnecting(true);
      let shouldMarkFailed = false;
      try {
        const resolved = await resolveTrackedCallAttempt(callId);
        if (!isCurrentJoin()) return false;
        const attemptId = resolved.attemptId;
        attemptIdRef.current = attemptId;
        diagnosticAttemptIdRef.current = attemptId ?? createCallAttemptId();
        const session = await joinTrackedCall(callId, attemptId);
        shouldMarkFailed = true;
        if (!isCurrentJoin()) return false;
        const joinedMedia = session.call.media ?? media;
        if (joinedMedia === "video" && media !== "video")
          void prepareVideoCall().catch(() => {});
        if (!isCurrentJoin()) return false;
        setActiveCall(session.call);
        setCallMedia(joinedMedia);
        setCameraOnState(joinedMedia === "video");
        cameraWantedRef.current = joinedMedia === "video";
        const onDiagnostic = diagnosticFor(callId, "join-card", generation);
        await activateSystemCall(session.call, peerName || "DavaQ");
        if (generation !== sessionGenerationRef.current) {
          await endSystemCall(session.call.id);
          throw new Error("stale_join_attempt");
        }
        const joined = await joinCall(session.url, session.token, {
          callId: session.call.id,
          media: joinedMedia,
          onDiagnostic,
        });
        if (!isCurrentJoin()) {
          await leaveCall(joined.room);
          return false;
        }
        validateJoinResult(joined, callId, "join-card");
        liveRoomRef.current = joined.room;
        setLiveRoom(joined.room);
        applyJoinedCameraState(joined);
        joinedCallIdRef.current = callId;
        setConnecting(false);
        setRecoveryStage("none");
        setMode("active");
        return true;
      } catch (err) {
        if (!isCurrentJoin()) return false;
        if (shouldMarkFailed)
          await failCallLocally(callId, "join-card", err, generation);
        else await reset(generation);
        return false;
      } finally {
        if (mediaJoinCallIdRef.current === callId)
          mediaJoinCallIdRef.current = null;
      }
    },
    [
      applyJoinedCameraState,
      diagnosticFor,
      failCallLocally,
      reset,
      validateJoinResult,
    ],
  );

  // Decline an incoming call straight from a notification action (no modal up).
  // Records the proper "declined" terminal state server-side instead of letting
  // the call ring out to "missed".
  const declineFromCard = useCallback(async (callId: string) => {
    if (
      !canApplyCallCardAction(modeRef.current, incomingRef.current?.id, callId)
    )
      return false;
    if (modeRef.current === "incoming") {
      setIncoming(null);
      setMode("idle");
      void cancelIncomingCallNotification();
    }
    try {
      const resolved = await resolveTrackedCallAttempt(callId);
      const attemptId = resolved.attemptId;
      await declineTrackedCall(callId, attemptId);
      await endSystemCall(callId);
      return true;
    } catch {
      return false;
    }
  }, []);

  const handleAccept = useCallback(async () => {
    if (!incoming) return;
    const currentIncoming = incoming;
    const generation = sessionGenerationRef.current;
    const attemptId = attemptIdRef.current;
    expectedDisconnectRef.current = false;
    // Unlock audio on the accept-button gesture, before the accept await.
    primeAudioPlayback();
    const initialMedia = currentIncoming.media ?? "audio";
    const onDiagnostic = diagnosticFor(
      currentIncoming.id,
      "callee",
      generation,
    );
    onDiagnostic("accept_gesture", { media: initialMedia });
    if (initialMedia === "video")
      void prepareVideoCall(onDiagnostic).catch(() => {});
    setIncoming(null);
    setActiveCall(currentIncoming);
    setCallMedia(initialMedia);
    setCameraOnState(initialMedia === "video");
    cameraWantedRef.current = initialMedia === "video";
    stopRingtone();
    void cancelIncomingCallNotification();
    mediaJoinCallIdRef.current = currentIncoming.id;
    const isCurrentJoin = () =>
      generation === sessionGenerationRef.current &&
      mediaJoinCallIdRef.current === currentIncoming.id &&
      modeRef.current !== "idle";
    setMode("joining");
    setConnecting(true);
    let shouldMarkFailed = false;
    try {
      const session = await acceptTrackedCall(currentIncoming.id, attemptId);
      onDiagnostic("accept_api_succeeded", { media: session.call.media });
      shouldMarkFailed = true;
      if (!isCurrentJoin()) return;
      const media = session.call.media ?? currentIncoming.media ?? "audio";
      if (media === "video" && initialMedia !== "video")
        void prepareVideoCall(onDiagnostic).catch(() => {});
      if (!isCurrentJoin()) return;
      setActiveCall(session.call);
      setCallMedia(media);
      setCameraOnState(media === "video");
      cameraWantedRef.current = media === "video";
      await activateSystemCall(session.call, peerName || "DavaQ");
      if (generation !== sessionGenerationRef.current) {
        await endSystemCall(session.call.id);
        throw new Error("stale_join_attempt");
      }
      const joined = await joinCall(session.url, session.token, {
        callId: session.call.id,
        media,
        onDiagnostic,
      });
      if (!isCurrentJoin()) {
        await leaveCall(joined.room);
        return;
      }
      validateJoinResult(joined, currentIncoming.id, "callee");
      liveRoomRef.current = joined.room;
      setLiveRoom(joined.room);
      applyJoinedCameraState(joined);
      joinedCallIdRef.current = currentIncoming.id;
      setConnecting(false);
      setRecoveryStage("none");
      setMode("active");
    } catch (err) {
      if (!isCurrentJoin()) return;
      if (shouldMarkFailed)
        await failCallLocally(currentIncoming.id, "callee", err, generation);
      else await reset(generation);
    } finally {
      if (mediaJoinCallIdRef.current === currentIncoming.id)
        mediaJoinCallIdRef.current = null;
    }
  }, [
    incoming,
    applyJoinedCameraState,
    diagnosticFor,
    failCallLocally,
    reset,
    validateJoinResult,
  ]);

  const handleDecline = useCallback(async () => {
    const id = incoming?.id;
    const attemptId = attemptIdRef.current;
    setIncoming(null);
    setMode("idle");
    void cancelIncomingCallNotification();
    if (id) {
      await endSystemCall(id).catch(() => {});
      try {
        await declineTrackedCall(id, attemptId);
      } catch {}
    }
  }, [incoming]);

  const handleEnd = useCallback(async () => {
    if (expectedDisconnectRef.current) return;
    expectedDisconnectRef.current = true;
    const generation = sessionGenerationRef.current;
    // join-from-card knows the call id before its accept/join response returns.
    // Use that id as a fallback so a user hangup during the request is not lost.
    const id = activeCall?.id ?? mediaJoinCallIdRef.current ?? incoming?.id;
    try {
      if (id) {
        // `/end` is server-idempotent and maps a still-ringing caller hangup to
        // `cancelled`. Persist first so force-close/offline cannot silently drop it.
        await enqueueCallTermination(id, attemptIdRef.current);
      }
    } catch {
      if (id) {
        reportCallDiagnostic(id, {
          attemptId: diagnosticAttemptIdRef.current,
          phase: "termination_outbox_persist_failed",
          platform: Platform.OS,
          role: "in-call",
        });
      }
    } finally {
      await reset(generation);
    }
  }, [activeCall?.id, incoming?.id, reset]);

  const toggleMute = useCallback(async () => {
    const next = !muted;
    mutedRef.current = next;
    setMutedState(next);
    try {
      await setMuted(next);
    } catch {
      mutedRef.current = !next;
      setMutedState(!next);
      if (activeCall?.id) {
        reportCallDiagnostic(activeCall.id, {
          attemptId: diagnosticAttemptIdRef.current,
          phase: "microphone_toggle_failed",
          platform: Platform.OS,
          role: "in-call",
          details: { requestedMuted: next },
        });
      }
    }
  }, [activeCall?.id, muted]);

  const toggleCamera = useCallback(async () => {
    const generation = sessionGenerationRef.current;
    const cameraAction = ++cameraActionRef.current;
    const next = !cameraOn;
    cameraWantedRef.current = next;
    setCameraOnState(next);
    setCameraPreparing(next);
    setCameraIssue(null);
    try {
      const ok = await setCameraEnabled(next);
      if (
        generation !== sessionGenerationRef.current ||
        cameraAction !== cameraActionRef.current ||
        cameraWantedRef.current !== next
      )
        return;
      if (next && !ok) throw new Error("camera_toggle_failed");
    } catch {
      if (
        generation !== sessionGenerationRef.current ||
        cameraAction !== cameraActionRef.current ||
        cameraWantedRef.current !== next
      )
        return;
      cameraWantedRef.current = !next;
      setCameraOnState(!next);
      setCameraIssue(
        "카메라를 켜지 못했어요. 권한과 다른 앱의 카메라 사용을 확인해 주세요.",
      );
      if (activeCall?.id) {
        reportCallDiagnostic(activeCall.id, {
          attemptId: diagnosticAttemptIdRef.current,
          phase: "camera_toggle_failed",
          platform: Platform.OS,
          role: "in-call",
          details: { requested: next },
        });
      }
    } finally {
      if (
        generation === sessionGenerationRef.current &&
        cameraAction === cameraActionRef.current
      ) {
        setCameraPreparing(false);
      }
    }
  }, [activeCall?.id, cameraOn]);

  const handleSwitchCamera = useCallback(async () => {
    if (!cameraOn) return;
    try {
      await switchCamera();
    } catch {}
  }, [cameraOn]);

  const handleResumeAudio = useCallback(async () => {
    const restored = await resumeCallAudio();
    setAudioPlaybackBlocked(!restored);
    if (activeCall?.id) {
      reportCallDiagnostic(activeCall.id, {
        attemptId: diagnosticAttemptIdRef.current,
        phase: restored
          ? "manual_audio_resume_succeeded"
          : "manual_audio_resume_failed",
        platform: Platform.OS,
        role: "in-call",
      });
    }
  }, [activeCall?.id]);

  const visibleMedia =
    mode === "incoming" ? (incoming?.media ?? callMedia) : callMedia;
  const isVideoCall = visibleMedia === "video";
  const showWebCallHint = Platform.OS === "web" && mode === "active";
  const needsAudioGesture =
    Platform.OS === "web" &&
    mode === "active" &&
    (audioPlaybackBlocked || audioPath === "playback_blocked");
  const activeStatus = (() => {
    if (recoveryStage === "sdk") return "네트워크 연결 복구 중...";
    if (recoveryStage === "validating") return "통화 상태 확인 중...";
    if (recoveryStage === "rejoining") return "통화 재연결 중...";
    if (needsAudioGesture)
      return "상대방 소리를 재생하려면 아래 버튼을 눌러주세요.";
    if (muted) return "내 마이크 음소거 중";
    if (audioPath === "waiting_for_participant")
      return "상대방 연결 대기 중...";
    if (audioPath === "waiting_for_remote_microphone")
      return "상대방 음성 대기 중...";
    if (audioPath === "waiting_for_audio_subscription")
      return "상대방 음성 연결 중...";
    if (audioPath === "remote_audio_track_unavailable")
      return "상대방 음성 복구 중...";
    if (audioPath === "remote_muted") return "상대방이 음소거했습니다.";
    if (audioPath === "local_muted") return "내 마이크 음소거 중";
    if (audioPath === "local_microphone_missing")
      return "내 마이크를 확인해주세요.";
    if (isVideoCall && !cameraOn) return "음성 통화 중 · 내 카메라 꺼짐";
    if (isVideoCall && videoPath !== "ready")
      return "음성 통화 중 · 상대 영상 대기 중";
    return isVideoCall ? "영상통화 중" : "통화 중";
  })();

  return (
    <CallContext.Provider
      value={{
        startCall,
        joinFromCard,
        declineFromCard,
        supported: voiceCallSupported,
      }}
    >
      {children}
      {minimized && mode === "active" && (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="통화 화면으로 돌아가기"
          onPress={() => setMinimized(false)}
          style={{
            position: "absolute",
            top: 48,
            left: 16,
            right: 16,
            zIndex: 1000,
            padding: 14,
            borderRadius: 16,
            backgroundColor: "#6D35D5",
          }}
        >
          <Text style={{ color: "white", fontWeight: "700" }}>
            {peerName} · 통화 중 — 돌아가기
          </Text>
        </Pressable>
      )}
      <AndroidCallControls
        callId={activeCall?.id ?? incoming?.id}
        onEnd={handleEnd}
        onMute={async (value) => {
          await setMuted(value);
          mutedRef.current = value;
          setMutedState(value);
        }}
        hidden
      />

      {/* Incoming call modal */}
      <Modal visible={mode === "incoming"} transparent animationType="fade">
        <View style={styles.overlay}>
          <View style={[styles.card, { backgroundColor: colors.card }]}>
            <Avatar
              name={incoming?.caller.nickname ?? ""}
              uri={incoming?.caller.profileImageUrl ?? undefined}
              size={88}
              crop="face"
              characterType={incoming?.caller.profile?.type}
            />
            <Text style={[styles.name, { color: colors.foreground }]}>
              {peerName}
            </Text>
            <Text style={[styles.sub, { color: colors.mutedForeground }]}>
              {isVideoCall ? "영상통화 수신..." : "수신 전화..."}
            </Text>
            <View style={styles.actionRow}>
              <CallButton
                color="#E5484D"
                icon="phone-off"
                label="거절"
                onPress={handleDecline}
              />
              <CallButton
                color="#30A46C"
                icon={isVideoCall ? "video" : "phone"}
                label="수락"
                onPress={handleAccept}
              />
            </View>
          </View>
        </View>
      </Modal>

      {/* Outgoing / active call overlay */}
      <Modal
        visible={
          !minimized &&
          (mode === "outgoing" || mode === "joining" || mode === "active")
        }
        transparent
        animationType="fade"
        onRequestClose={() => {
          if (mode === "active") setMinimized(true);
        }}
      >
        <View style={[styles.overlay, { backgroundColor: "rgba(0,0,0,0.82)" }]}>
          {isVideoCall ? (
            <View style={styles.videoCallBody}>
              <CallVideoView room={liveRoom} cameraOn={cameraOn} />
              <View style={styles.videoHeaderText}>
                <Text style={[styles.name, styles.nameLight]}>{peerName}</Text>
                <Text style={styles.statusLight}>
                  {mode === "outgoing"
                    ? connecting
                      ? "통화 생성 중..."
                      : "영상통화 연결 중..."
                    : mode === "joining"
                      ? "영상통화 연결 중..."
                      : activeStatus}
                </Text>
                <Text style={styles.identityLight}>{callIdentityLabel}</Text>
                {cameraPreparing && (
                  <Text style={styles.webCallHint}>
                    카메라를 준비하고 있어요. 음성 통화는 계속할 수 있어요.
                  </Text>
                )}
                {cameraIssue && (
                  <Text style={styles.webCallHint}>{cameraIssue}</Text>
                )}
                {showWebCallHint && (
                  <Text style={styles.webCallHint}>
                    웹/PWA는 화면을 내리면 마이크가 멈출 수 있어요.
                  </Text>
                )}
                {connecting && (
                  <ActivityIndicator color="#fff" style={{ marginTop: 12 }} />
                )}
              </View>
            </View>
          ) : (
            <View style={styles.callBody}>
              <Avatar
                name={peerName}
                size={104}
                crop="face"
                characterType="fan"
              />
              <Text style={[styles.name, styles.nameLight]}>{peerName}</Text>
              <Text style={styles.statusLight}>
                {mode === "outgoing"
                  ? connecting
                    ? "통화 생성 중..."
                    : "통화 연결 중..."
                  : mode === "joining"
                    ? "통화 연결 중..."
                    : activeStatus}
              </Text>
              <Text style={styles.identityLight}>{callIdentityLabel}</Text>
              {showWebCallHint && (
                <Text style={styles.webCallHint}>
                  웹/PWA는 화면을 내리면 마이크가 멈출 수 있어요.
                </Text>
              )}
              {connecting && (
                <ActivityIndicator color="#fff" style={{ marginTop: 12 }} />
              )}
            </View>
          )}
          <View style={styles.bottomControls}>
            {mode === "active" && (
              <CallButton
                color="#3A3A3A"
                icon="minimize-2"
                label="채팅 보기"
                onPress={() => setMinimized(true)}
              />
            )}
            <View style={{ width: "100%" }}>
              <AndroidCallControls
                callId={activeCall?.id}
                onEnd={handleEnd}
                onMute={async (value) => {
                  await setMuted(value);
                  mutedRef.current = value;
                  setMutedState(value);
                }}
                controlsOnly
              />
            </View>
            {needsAudioGesture && (
              <CallButton
                color="#6D35D5"
                icon="volume-2"
                label="소리 재생"
                onPress={handleResumeAudio}
              />
            )}
            {isVideoCall && (
              <>
                <CallButton
                  color={cameraOn ? "#3A3A3A" : "#7A7A7A"}
                  icon={cameraOn ? "video" : "video-off"}
                  label={cameraOn ? "카메라" : "꺼짐"}
                  onPress={toggleCamera}
                />
                <CallButton
                  color="#3A3A3A"
                  icon="rotate-cw"
                  label="전환"
                  onPress={handleSwitchCamera}
                />
              </>
            )}
            {mode === "active" && (
              <CallButton
                color={muted ? "#7A7A7A" : "#3A3A3A"}
                icon={muted ? "mic-off" : "mic"}
                label={muted ? "음소거됨" : "마이크"}
                onPress={toggleMute}
              />
            )}
            <CallButton
              color="#E5484D"
              icon="phone-off"
              label="종료"
              onPress={handleEnd}
            />
          </View>
        </View>
      </Modal>
    </CallContext.Provider>
  );
}

function CallButton({
  color,
  icon,
  label,
  onPress,
}: {
  color: string;
  icon: React.ComponentProps<typeof Feather>["name"];
  label: string;
  onPress: () => void;
}) {
  return (
    <Pressable style={styles.btnWrap} onPress={onPress}>
      {({ pressed }) => (
        <>
          <View
            style={[
              styles.btn,
              { backgroundColor: color, opacity: pressed ? 0.8 : 1 },
            ]}
          >
            <Feather name={icon} size={26} color="#fff" />
          </View>
          <Text style={styles.btnLabel}>{label}</Text>
        </>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(0,0,0,0.5)",
    padding: 24,
  },
  card: {
    width: "100%",
    maxWidth: 340,
    borderRadius: 24,
    paddingVertical: 32,
    paddingHorizontal: 24,
    alignItems: "center",
  },
  callBody: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  videoCallBody: {
    flex: 1,
    width: "100%",
    paddingTop: Platform.OS === "ios" ? 72 : 48,
    paddingBottom: 24,
  },
  videoHeaderText: {
    position: "absolute",
    top: Platform.OS === "ios" ? 82 : 58,
    left: 24,
    right: 24,
    alignItems: "center",
  },
  name: {
    fontSize: 24,
    fontFamily: "Inter_700Bold",
    marginTop: 18,
  },
  nameLight: { color: "#fff" },
  sub: {
    fontSize: 15,
    fontFamily: "Inter_400Regular",
    marginTop: 6,
  },
  statusLight: {
    fontSize: 15,
    fontFamily: "Inter_400Regular",
    color: "rgba(255,255,255,0.7)",
    marginTop: 8,
  },
  identityLight: {
    fontSize: 12,
    fontFamily: "Inter_600SemiBold",
    color: "rgba(201,140,255,0.95)",
    marginTop: 6,
  },
  webCallHint: {
    maxWidth: 280,
    marginTop: 10,
    color: "rgba(255,255,255,0.72)",
    fontSize: 12,
    fontFamily: "Inter_500Medium",
    lineHeight: 17,
    textAlign: "center",
  },
  actionRow: {
    flexDirection: "row",
    gap: 48,
    marginTop: 32,
  },
  bottomControls: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 24,
    width: "100%",
    justifyContent: "center",
    paddingBottom: Platform.OS === "ios" ? 48 : 36,
  },
  btnWrap: { alignItems: "center", gap: 8 },
  btn: {
    width: 64,
    height: 64,
    borderRadius: 32,
    alignItems: "center",
    justifyContent: "center",
  },
  btnLabel: {
    fontSize: 13,
    fontFamily: "Inter_500Medium",
    color: "#fff",
  },
});
