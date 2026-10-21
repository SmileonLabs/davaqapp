import {CallVideoLayout} from './CallVideoLayout';
import React, { useEffect } from "react";
import { StyleSheet, Text, View } from "react-native";
import {
  RoomContext,
  useTracks,
  VideoTrack,
  type TrackReference,
} from "@livekit/react-native";
import { RoomEvent, Track, type Room } from "livekit-client";
import { useColors } from "@/hooks/useColors";

const VIDEO_TRACK_EVENTS = [
  RoomEvent.ParticipantConnected,
  RoomEvent.ParticipantDisconnected,
  RoomEvent.TrackPublished,
  RoomEvent.TrackSubscribed,
  RoomEvent.TrackUnpublished,
  RoomEvent.TrackUnsubscribed,
  RoomEvent.TrackMuted,
  RoomEvent.TrackUnmuted,
  RoomEvent.TrackSubscriptionFailed,
  RoomEvent.TrackSubscriptionPermissionChanged,
  RoomEvent.TrackSubscriptionStatusChanged,
  RoomEvent.LocalTrackPublished,
  RoomEvent.LocalTrackUnpublished,
];

const REMOTE_CAMERA_SUBSCRIBE_RETRY_MS = 500;
const REMOTE_CAMERA_SUBSCRIBE_RETRY_COUNT = 12;

export function CallVideoView({
  room,
  cameraOn,
  onToggleControls,
}: {
  room: Room | null;
  cameraOn: boolean;
  onToggleControls?:()=>void;
}) {
  if (!room) return <VideoPlaceholder label="영상 연결 중..." />;
  return (
    <RoomContext.Provider value={room}>
      <RemoteCameraSubscriber room={room} />
      <CallVideoTracks cameraOn={cameraOn} onToggleControls={onToggleControls}/>
    </RoomContext.Provider>
  );
}

function CallVideoTracks({ cameraOn,onToggleControls }: { cameraOn: boolean;onToggleControls?:()=>void }) {
  const refs = useTracks([Track.Source.Camera], {
    onlySubscribed: false,
    updateOnlyOn: VIDEO_TRACK_EVENTS,
  });
  const trackRefs = refs.filter((ref): ref is TrackReference => !!ref.publication?.track);
  const remoteRef = trackRefs.find((ref) => !ref.participant.isLocal);
  const localRef = trackRefs.find((ref) => ref.participant.isLocal);

  const remoteOff=refs.some(ref=>!ref.participant.isLocal&&ref.publication?.isMuted);
  return <CallVideoLayout onToggleControls={onToggleControls} remote={remoteRef&&!remoteRef.publication.isMuted?<VideoTrack trackRef={remoteRef} style={styles.remoteVideo} objectFit="cover" zOrder={0}/>:<VideoPlaceholder label={remoteOff?'상대방 카메라가 꺼져 있어요':'상대방 영상을 기다리는 중...'}/>} local={cameraOn&&localRef&&!localRef.publication.isMuted?<VideoTrack trackRef={localRef} style={styles.localVideo} objectFit="cover" mirror zOrder={1}/>:undefined}/>;
}

function subscribeRemoteCameraTracks(room: Room): void {
  room.remoteParticipants.forEach((participant) => {
    participant.trackPublications.forEach((publication) => {
      if (publication.source !== Track.Source.Camera) return;
      if (publication.isSubscribed) return;
      try {
        publication.setSubscribed(true);
      } catch {}
    });
  });
}

function RemoteCameraSubscriber({ room }: { room: Room }) {
  useEffect(() => {
    let retryCount = 0;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    const update = () => subscribeRemoteCameraTracks(room);
    const clearRetry = () => {
      if (!retryTimer) return;
      clearTimeout(retryTimer);
      retryTimer = null;
    };
    const scheduleRetry = () => {
      clearRetry();
      retryCount = 0;
      const retry = () => {
        update();
        retryCount += 1;
        if (retryCount < REMOTE_CAMERA_SUBSCRIBE_RETRY_COUNT) {
          retryTimer = setTimeout(retry, REMOTE_CAMERA_SUBSCRIBE_RETRY_MS);
        }
      };
      retryTimer = setTimeout(retry, REMOTE_CAMERA_SUBSCRIBE_RETRY_MS);
    };
    const onTrackEvent = () => {
      update();
      scheduleRetry();
    };
    update();
    scheduleRetry();
    VIDEO_TRACK_EVENTS.forEach((event) => room.on(event, onTrackEvent));
    return () => {
      clearRetry();
      VIDEO_TRACK_EVENTS.forEach((event) => room.off(event, onTrackEvent));
    };
  }, [room]);
  return null;
}

function VideoPlaceholder({ label }: { label: string }) {
  const colors = useColors();
  return (
    <View style={[styles.placeholder, { backgroundColor: colors.muted }]}>
      <Text style={[styles.placeholderText, { color: colors.mutedForeground }]}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    width: "100%",
    height: "100%",
    overflow: "hidden",
    borderRadius: 24,
    backgroundColor: "#050505",
  },
  remoteVideo: {
    width: "100%",
    height: "100%",
  },
  localPreview: {
    position: "absolute",
    right: 16,
    bottom: 16,
    width: 108,
    height: 152,
    borderRadius: 18,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.35)",
    backgroundColor: "#111",
  },
  localVideo: {
    width: "100%",
    height: "100%",
  },
  placeholder: {
    width: "100%",
    height: "100%",
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
  },
  placeholderText: {
    fontSize: 15,
    fontFamily: "Inter_500Medium",
    textAlign: "center",
  },
});
