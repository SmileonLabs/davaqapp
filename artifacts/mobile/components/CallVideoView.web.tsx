import {CallVideoLayout} from './CallVideoLayout';
import React, { useEffect, useRef, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import {
  RoomEvent,
  Track,
  type LocalVideoTrack,
  type RemoteVideoTrack,
  type Room,
} from "livekit-client";
import { useColors } from "@/hooks/useColors";
import { attachCallVideoPlayback } from "@/lib/callVideoPlayback";

type VideoTrackLike = LocalVideoTrack | RemoteVideoTrack;

export function CallVideoView({
  room,
  cameraOn,
  onToggleControls,
}: {
  room: Room | null;
  cameraOn: boolean;
  onToggleControls?:()=>void;
}) {
  const [tracks, setTracks] = useState(() => findVideoTracks(room));

  useEffect(() => {
    if (!room) {
      setTracks(findVideoTracks(null));
      return;
    }
    const update = () => setTracks(findVideoTracks(room));
    update();
    const events = [
      RoomEvent.TrackPublished,
      RoomEvent.TrackSubscribed,
      RoomEvent.TrackUnpublished,
      RoomEvent.TrackUnsubscribed,
      RoomEvent.TrackSubscriptionFailed,
      RoomEvent.TrackSubscriptionPermissionChanged,
      RoomEvent.TrackSubscriptionStatusChanged,
      RoomEvent.LocalTrackPublished,
      RoomEvent.LocalTrackUnpublished,
      RoomEvent.ParticipantConnected,
      RoomEvent.ParticipantDisconnected,
      RoomEvent.TrackMuted,
      RoomEvent.TrackUnmuted,
    ];
    events.forEach((event) => room.on(event, update));
    let ticks = 0;
    const timer = setInterval(() => {
      ticks += 1;
      update();
      if (ticks >= 20) clearInterval(timer);
    }, 500);
    return () => {
      clearInterval(timer);
      events.forEach((event) => room.off(event, update));
    };
  }, [room]);

  return <CallVideoLayout onToggleControls={onToggleControls} remote={tracks.remote?<VideoElement key={tracks.remote.sid} track={tracks.remote} muted style={videoFillStyle}/>:<VideoPlaceholder label={room?'상대방 카메라가 꺼져 있거나 연결 중이에요':'영상 연결 중...'}/>} local={cameraOn&&tracks.local?<VideoElement key={tracks.local.sid} track={tracks.local} muted mirror style={videoFillStyle}/>:undefined}/>;
}

function findVideoTracks(room: Room | null): { local: VideoTrackLike | null; remote: VideoTrackLike | null } {
  if (!room) return { local: null, remote: null };
  const local = room.localParticipant.getTrackPublication(Track.Source.Camera)?.videoTrack ?? null;
  let remote: VideoTrackLike | null = null;
  for (const participant of room.remoteParticipants.values()) {
    const track = participant.getTrackPublication(Track.Source.Camera)?.videoTrack;
    if (track && !participant.getTrackPublication(Track.Source.Camera)?.isMuted) {
      remote = track;
      break;
    }
  }
  return { local, remote };
}

function VideoElement({
  track,
  muted = false,
  mirror = false,
  style,
}: {
  track: VideoTrackLike;
  muted?: boolean;
  mirror?: boolean;
  style: React.CSSProperties;
}) {
  const ref = useRef<HTMLVideoElement | null>(null);
  const playbackRef = useRef<ReturnType<typeof attachCallVideoPlayback> | null>(null);
  const [playbackBlocked, setPlaybackBlocked] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    setPlaybackBlocked(false);
    const playback = attachCallVideoPlayback(track, el, {
      muted,
      onBlocked: setPlaybackBlocked,
    });
    playbackRef.current = playback;
    return () => {
      playback.dispose();
      if (playbackRef.current === playback) playbackRef.current = null;
    };
  }, [muted, track]);

  return (
    <>
      <video
        ref={ref}
        muted={muted}
        playsInline
        style={{ ...style, transform: mirror ? "scaleX(-1)" : undefined }}
      />
      {playbackBlocked && (
        <View style={styles.playbackRecovery}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="영상 재생"
            onPress={() => playbackRef.current?.play()}
            style={styles.playbackButton}
          >
            <Text style={styles.playbackButtonText}>영상 재생</Text>
          </Pressable>
        </View>
      )}
    </>
  );
}

function VideoPlaceholder({ label }: { label: string }) {
  const colors = useColors();
  return (
    <View style={[styles.placeholder, { backgroundColor: colors.muted }]}>
      <Text style={[styles.placeholderText, { color: colors.mutedForeground }]}>{label}</Text>
    </View>
  );
}

const videoFillStyle: React.CSSProperties = {
  width: "100%",
  height: "100%",
  objectFit: "cover",
};

const styles = StyleSheet.create({
  wrap: {
    width: "100%",
    height: "100%",
    overflow: "hidden",
    borderRadius: 24,
    backgroundColor: "#050505",
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
  playbackRecovery: {
    ...StyleSheet.absoluteFillObject,
    alignItems: "center",
    justifyContent: "center",
  },
  playbackButton: {
    backgroundColor: "#6D35D5",
    borderRadius: 24,
    paddingVertical: 12,
    paddingHorizontal: 20,
  },
  playbackButtonText: { color: "#fff", fontSize: 14, fontFamily: "Inter_600SemiBold" },
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
