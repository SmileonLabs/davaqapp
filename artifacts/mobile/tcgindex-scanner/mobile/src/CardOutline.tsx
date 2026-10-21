import React,{useEffect,useState} from 'react';
import {AccessibilityInfo,Platform,requireNativeComponent,StyleSheet,type ViewProps} from 'react-native';
import {initialCardGuide,type CardQuad} from './card-detection';
const Outline=requireNativeComponent<ViewProps&{corners:string;live?:boolean;confirmed:boolean;reduceMotion:boolean}>('TCGCardOutline');
export function CardOutline({quad,width,height,confirmed,live=true}:{quad:CardQuad|null;width:number;height:number;confirmed:boolean;live?:boolean}) {
 const [reduceMotion,setReduceMotion]=useState(false);
 useEffect(()=>{void AccessibilityInfo.isReduceMotionEnabled().then(setReduceMotion);const sub=AccessibilityInfo.addEventListener('reduceMotionChanged',setReduceMotion);return()=>sub.remove();},[]);
 if(!width||!height)return null;
 return <Outline pointerEvents="none" style={StyleSheet.absoluteFill} corners={JSON.stringify(quad??initialCardGuide(width,height))} {...(Platform.OS==='ios'?{live}:{})} confirmed={confirmed} reduceMotion={reduceMotion}/>;
}
