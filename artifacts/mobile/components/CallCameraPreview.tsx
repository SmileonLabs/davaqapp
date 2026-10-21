import React,{useEffect,useRef,useState} from 'react';
import {ActivityIndicator,AppState,Modal,Pressable,Text,View} from 'react-native';
import {createLocalVideoTrack,type LocalVideoTrack} from 'livekit-client';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import {LocalCameraPreview} from './LocalCameraPreview';
import {useCallScreenAwake} from '@/hooks/useCallScreenAwake';
export function CallCameraPreview({visible,onConfirm,onCancel,onAudioOnly,confirmLabel='카메라 켜기',embedded=false}:{visible:boolean;onConfirm:()=>void;onCancel:()=>void;onAudioOnly?:()=>void;confirmLabel?:string;embedded?:boolean}){
 const [track,setTrack]=useState<LocalVideoTrack|null>(null);const [error,setError]=useState(false);const current=useRef<LocalVideoTrack|null>(null);const committing=useRef(false);const acceptingCapture=useRef(false);const cancel=useRef(onCancel);cancel.current=onCancel;const insets=useSafeAreaInsets();
 useCallScreenAwake(visible);
 useEffect(()=>{
  if(!visible)return;let disposed=false;acceptingCapture.current=true;committing.current=false;setError(false);setTrack(null);
  void createLocalVideoTrack({facingMode:'user'}).then(value=>{if(disposed||!acceptingCapture.current){value.stop();return;}current.current=value;setTrack(value);}).catch(()=>{if(!disposed)setError(true);});
  const app=AppState.addEventListener('change',state=>{if(state==='background'){acceptingCapture.current=false;current.current?.stop();current.current=null;cancel.current();}});
  return()=>{disposed=true;acceptingCapture.current=false;app.remove();current.current?.stop();current.current=null;};
 },[visible]);
 const finish=(callback:()=>void)=>{if(committing.current)return;committing.current=true;acceptingCapture.current=false;current.current?.stop();current.current=null;setTrack(null);callback();};
 const contents=<View style={{flex:1,paddingTop:insets.top+12,paddingBottom:insets.bottom+16,backgroundColor:'#101014',gap:16,paddingHorizontal:20}}>
  <Text style={{color:'white',fontSize:22,fontWeight:'600'}}>카메라 미리보기</Text><Text style={{color:'#ddd'}}>확인하기 전에는 상대에게 영상이 전송되지 않아요.</Text>
  <View style={{flex:1,borderRadius:22,overflow:'hidden',backgroundColor:'#222',alignItems:'stretch',justifyContent:'center'}}>{track?<LocalCameraPreview track={track}/>:error?<Text style={{color:'white',padding:24,textAlign:'center'}}>카메라를 사용할 수 없어요. 기기 설정에서 권한을 확인해 주세요.</Text>:<ActivityIndicator color="white"/>}</View>
  <Pressable accessibilityRole="button" disabled={!track} onPress={()=>finish(onConfirm)} style={{padding:16,borderRadius:16,backgroundColor:track?'#6d35d5':'#444'}}><Text style={{color:'white',textAlign:'center',fontWeight:'600'}}>{confirmLabel}</Text></Pressable>
  {onAudioOnly&&<Pressable accessibilityRole="button" onPress={()=>finish(onAudioOnly)} style={{padding:14}}><Text style={{color:'white',textAlign:'center'}}>카메라 없이 음성으로 받기</Text></Pressable>}
  <Pressable accessibilityRole="button" onPress={()=>finish(onCancel)} style={{padding:14}}><Text style={{color:'#ddd',textAlign:'center'}}>취소</Text></Pressable>
 </View>;
 if(embedded)return visible?<View style={{position:'absolute',top:0,left:0,right:0,bottom:0,zIndex:5000,elevation:50}}>{contents}</View>:null;
 return <Modal visible={visible} animationType="slide" onRequestClose={()=>finish(onCancel)}>{contents}</Modal>;
}
