import React,{useEffect,useRef} from 'react';
import type {LocalVideoTrack} from 'livekit-client';
export function LocalCameraPreview({track}:{track:LocalVideoTrack}){
 const ref=useRef<HTMLVideoElement|null>(null);
 useEffect(()=>{const el=ref.current;if(!el)return;track.attach(el);void el.play().catch(()=>{});return()=>{track.detach(el);};},[track]);
 return <video ref={ref} muted autoPlay playsInline style={{height:'100%',width:'100%',objectFit:'cover',transform:'scaleX(-1)'}}/>;
}
