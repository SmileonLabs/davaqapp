import React,{useMemo,useEffect} from 'react';
import {RTCView,MediaStream} from '@livekit/react-native-webrtc';
import type {LocalVideoTrack} from 'livekit-client';
export function LocalCameraPreview({track}:{track:LocalVideoTrack}){
 const stream=useMemo(()=>new MediaStream([track.mediaStreamTrack as any]),[track]);
 useEffect(()=>()=>stream.release(false),[stream]);
 return <RTCView streamURL={stream.toURL()} mirror objectFit="cover" style={{flex:1}}/>;
}
