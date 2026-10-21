import React,{useState,useRef} from 'react';
import {Platform,Pressable,Text,View} from 'react-native';
import {MovableCallSurface} from './MovableCallSurface';
export function CallVideoLayout({remote,local,onToggleControls}:{remote:React.ReactNode;local?:React.ReactNode;onToggleControls?:()=>void}){
 const lastDrag=useRef(0);
 const [bounds,setBounds]=useState({width:0,height:0});const [swapped,setSwapped]=useState(false);
 const canSwap=!!local;const swap=swapped&&canSwap;const front=swap?local:remote;const back=swap?remote:local;const main=Platform.OS!=='web'&&React.isValidElement(front)?React.cloneElement(front as React.ReactElement<any>,{zOrder:0}):front;const preview=Platform.OS!=='web'&&React.isValidElement(back)?React.cloneElement(back as React.ReactElement<any>,{zOrder:1}):back;
 return <View onLayout={e=>setBounds(e.nativeEvent.layout)} style={{flex:1,width:'100%',height:'100%',overflow:'hidden',borderRadius:24,backgroundColor:'#050505'}}>
  <Pressable accessibilityRole="button" accessibilityLabel="통화 조작 버튼 표시 또는 숨기기" onPress={onToggleControls} style={{flex:1}}>{main}</Pressable>
  {!!preview&&bounds.width>0&&<MovableCallSurface onDrag={()=>{lastDrag.current=Date.now();}} width={Math.min(108,bounds.width*.32)} height={Math.min(152,bounds.height*.38)} bounds={bounds}>
   <Pressable accessibilityRole="button" accessibilityLabel="내 영상과 상대 영상 맞바꾸기. 길게 끌어 위치 이동" onPress={()=>{if(Date.now()-lastDrag.current>350)setSwapped(s=>!s);}} style={{flex:1,borderRadius:16,overflow:'hidden',borderWidth:1,borderColor:'#ffffff66',backgroundColor:'#111'}}>{preview}<Text pointerEvents="none" style={{position:'absolute',bottom:6,right:6,fontSize:11,color:'white',backgroundColor:'#0008',padding:3,borderRadius:4}}>맞바꾸기</Text></Pressable>
  </MovableCallSurface>}
 </View>;
}
