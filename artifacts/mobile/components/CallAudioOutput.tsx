import React from 'react';
import {Alert,Pressable,Text} from 'react-native';
import {AudioSession} from '@livekit/react-native';
import {useColors} from '@/hooks/useColors';
export function CallAudioOutput({callId}:{callId?:string}){const colors=useColors();return <Pressable accessibilityRole="button" accessibilityLabel="스피커, 이어폰, 블루투스 출력 장치 선택" onPress={()=>{void AudioSession.showAudioRoutePicker().catch(()=>Alert.alert('오디오 장치','기기의 오디오 출력 장치를 확인해 주세요.'));}} style={{padding:14,minHeight:48,borderRadius:16,backgroundColor:colors.muted}}><Text style={{color:colors.foreground}}>오디오 · 장치 선택</Text></Pressable>;}
