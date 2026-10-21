import React,{useEffect,useState} from 'react';
import {Modal,Pressable,Text,View} from 'react-native';
import {useColors} from '@/hooks/useColors';
import {callEndLabel,formatCallDuration} from '@/lib/callPresentation';
export type CallOutcome={name:string;peerId:string;roomId?:string;media:'audio'|'video';reason:string;seconds:number};
export function CallEndSheet({outcome,onClose,onRetry,retryLabel='다시 전화하기'}:{outcome:CallOutcome|null;onClose:()=>void;onRetry:()=>void;retryLabel?:string}){
 const colors=useColors();const [shown,setShown]=useState(false);useEffect(()=>{setShown(false);if(!outcome)return;const timer=setTimeout(()=>setShown(true),350);return()=>clearTimeout(timer);},[outcome]);return <Modal transparent visible={!!outcome&&shown} animationType="fade" onRequestClose={onClose}><View style={{flex:1,backgroundColor:'#0008',justifyContent:'flex-end'}}><View style={{padding:28,paddingBottom:40,gap:16,borderTopLeftRadius:24,borderTopRightRadius:24,backgroundColor:colors.card}}>
  <Text style={{fontSize:22,color:colors.foreground,fontWeight:'600'}}>{callEndLabel(outcome?.reason??'ended')}</Text><Text style={{color:colors.mutedForeground}}>{outcome?.name}{outcome?.seconds?` · ${formatCallDuration(outcome.seconds)}`:''}</Text>
  {!!outcome?.peerId&&<Pressable accessibilityRole="button" onPress={onRetry} style={{padding:16,borderRadius:16,backgroundColor:colors.primary}}><Text style={{color:'white',textAlign:'center',fontWeight:'600'}}>{retryLabel}</Text></Pressable>}
  <Pressable accessibilityRole="button" onPress={onClose} style={{padding:14}}><Text style={{color:colors.foreground,textAlign:'center'}}>닫기</Text></Pressable>
 </View></View></Modal>;
}
