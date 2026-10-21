import { useColors } from "@/hooks/useColors";
import React from "react";
import { View, Text, ScrollView } from "react-native";
import {
  RoomContext,
  useTracks,
  useParticipants,
  VideoTrack,
  type TrackReference,
} from "@livekit/react-native";
import { Track, type Room } from "livekit-client";
export function GroupCallVideo({ room,compact=false }: { room: Room;compact?:boolean }) {
  return (
    <RoomContext.Provider value={room}>
      <Grid compact={compact}/>
    </RoomContext.Provider>
  );
}
function Grid({compact}:{compact:boolean}) {
  const participants=useParticipants();
  const colors = useColors();
  const tracks = useTracks([Track.Source.Camera], {
    onlySubscribed: true,
  }).filter((ref): ref is TrackReference => !!ref.publication?.track);
  const displayed=compact?participants.filter(p=>!p.isLocal).slice(0,1):participants;
  const tiles=displayed.map(participant=>{
    const ref=tracks.find(ref=>ref.participant.identity===participant.identity);
    const enabled=!!ref&&!ref.publication.isMuted;
    return <View key={participant.identity} style={{width:compact?'100%':'47%',height:compact?'100%':180,backgroundColor:colors.card,borderRadius:14,overflow:'hidden',borderWidth:participant.isSpeaking?2:0,borderColor:colors.primary}}>
      {enabled?<VideoTrack trackRef={ref!} style={{width:'100%',flex:1}} objectFit="cover" mirror={participant.isLocal}/>:<View style={{flex:1,alignItems:'center',justifyContent:'center'}}><Text style={{color:colors.mutedForeground,fontSize:12}}>카메라 꺼짐</Text></View>}
      <Text numberOfLines={1} style={{color:colors.foreground,padding:4,fontSize:12}}>{participant.name||'참여자'}{participant.isSpeaking?' · 말하는 중':!participant.isMicrophoneEnabled?' · 음소거':''}</Text>
    </View>;
  });
  return compact?<View style={{flex:1,width:'100%'}}>{tiles}</View>:<ScrollView style={{flex:1}} contentContainerStyle={{flexDirection:'row',flexWrap:'wrap',gap:8}}>{tiles}</ScrollView>;
}
