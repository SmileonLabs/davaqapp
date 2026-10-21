import React, { useEffect, useRef, useState } from "react";
import { View, Text, ScrollView } from "react-native";
import {
  RoomEvent,
  Track,
  type Room,
  type LocalVideoTrack,
  type RemoteVideoTrack,
} from "livekit-client";
type Video = LocalVideoTrack | RemoteVideoTrack;
function VideoTile({ track, name,compact=false }: { track: Video; name: string;compact?:boolean }) {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    track.attach(element);
    element.play().catch(() => {});
    return () => {
      track.detach(element);
    };
  }, [track]);
  return (
    <View style={{ width: compact?"100%":"47%", height: compact?"100%":180 }}>
      <video
        ref={ref}
        autoPlay
        playsInline
        muted
        style={{
          width: "100%",
          height: compact?"80%":150,
          objectFit: "cover",
          borderRadius: 14,
        }}
      />
      <Text style={{ color: "white" }}>{name}</Text>
    </View>
  );
}
export function GroupCallVideo({ room,compact=false }: { room: Room;compact?:boolean }) {
  const [version, update] = useState(0);
  useEffect(() => {
    const listener = () => update((x) => x + 1);
    const events = [
      RoomEvent.TrackMuted,
      RoomEvent.TrackUnmuted,
      RoomEvent.TrackSubscribed,
      RoomEvent.TrackUnsubscribed,
      RoomEvent.LocalTrackPublished,
      RoomEvent.LocalTrackUnpublished,
      RoomEvent.ParticipantDisconnected,
    ];
    events.forEach((e) => room.on(e, listener));
    return () => {
      events.forEach((e) => room.off(e, listener));
    };
  }, [room]);
  const tracks = [
    room.localParticipant,
    ...room.remoteParticipants.values(),
  ].flatMap((p) => {
    const track = p.getTrackPublication(Track.Source.Camera)?.track;
    return track && !track.isMuted
      ? [{ track: track as Video, name: p.name ?? "참여자", id: p.identity }]
      : [];
  });
  return (
    <View style={{ flex: 1, flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
      {(compact?tracks.filter(x=>x.id!==room.localParticipant.identity).slice(0,1):tracks).map((x) => (
        <VideoTile compact={compact} key={x.id} track={x.track} name={x.name} />
      ))}
    </View>
  );
}
