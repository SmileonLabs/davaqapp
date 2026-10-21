import {useColors} from '@/hooks/useColors';
import React,{useRef} from 'react';
import {Pressable,Text,View,useWindowDimensions} from 'react-native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import {Feather} from '@expo/vector-icons';
import {MovableCallSurface} from './MovableCallSurface';
export function FloatingCall({name,video,status,onRestore,onEnd,children}:{name:string;video:boolean;status?:string;onRestore:()=>void;onEnd:()=>void;children?:React.ReactNode}){
 const lastDrag=useRef(0);const restore=()=>{if(Date.now()-lastDrag.current>350)onRestore();};const end=()=>{if(Date.now()-lastDrag.current>350)onEnd();};
 const colors=useColors();const insets=useSafeAreaInsets();const window=useWindowDimensions();
 const body=<View style={{...(video?{flex:1}:{}),borderRadius:video?16:0,overflow:'hidden',backgroundColor:colors.card,borderWidth:1,borderColor:colors.border}}>
  {video&&<Pressable accessibilityRole="button" accessibilityLabel="영상통화 화면으로 돌아가기" onPress={restore} style={{height:144}}><View pointerEvents="none" style={{flex:1}}>{children}</View></Pressable>}
  <View style={{flexDirection:'row',alignItems:'center',minHeight:52}}>
   <Pressable accessibilityRole="button" accessibilityLabel="통화 화면으로 돌아가기" onPress={restore} style={{flex:1,flexDirection:'row',alignItems:'center',gap:8,paddingHorizontal:12,minHeight:52}}><Feather name={video?'maximize-2':'phone'} size={18} color={colors.primary}/><View style={{flex:1}}><Text numberOfLines={1} style={{color:colors.foreground,fontSize:13}}>{name}</Text><Text numberOfLines={1} style={{color:colors.mutedForeground,fontSize:11}}>{status??'통화 중 · 눌러서 돌아가기'}</Text></View></Pressable>
   <Pressable accessibilityRole="button" accessibilityLabel="통화 종료" onPress={end} style={{width:44,minHeight:52,alignItems:'center',justifyContent:'center',backgroundColor:colors.destructive}}><Feather name="phone-off" size={18} color="white"/></Pressable>
  </View>
 </View>;
 if(!video)return <View style={{paddingTop:insets.top,backgroundColor:colors.card}}>{body}</View>;
 const bounds={width:window.width-24,height:Math.max(208,window.height-insets.top-insets.bottom-32)};
 return <View pointerEvents="box-none" style={{position:'absolute',top:insets.top+12,left:12,width:bounds.width,height:bounds.height,zIndex:2000,elevation:20}}><MovableCallSurface onDrag={()=>{lastDrag.current=Date.now();}} width={Math.min(160,bounds.width)} height={198} bounds={bounds}>{body}</MovableCallSurface></View>;
}
