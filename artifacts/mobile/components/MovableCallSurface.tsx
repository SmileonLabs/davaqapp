import React,{useEffect,useMemo,useRef} from 'react';
import {Animated,PanResponder} from 'react-native';
import {clampCallPosition} from '@/lib/callPresentation';
export function MovableCallSurface({width,height,bounds,children,onDrag}:{width:number;height:number;bounds:{width:number;height:number};children:React.ReactNode;onDrag?:()=>void}){
 const drag=useRef(onDrag);drag.current=onDrag;
 const position=useRef({x:Math.max(0,bounds.width-width-12),y:Math.max(0,bounds.height-height-12)});
 const origin=useRef(position.current);const value=useRef(new Animated.ValueXY(position.current)).current;
 const size=useRef({width,height,bounds});size.current={width,height,bounds};
 useEffect(()=>{const next=clampCallPosition(position.current.x,position.current.y,bounds.width,bounds.height,width,height);position.current=next;value.setValue(next);},[bounds.width,bounds.height,width,height,value]);
 const responder=useMemo(()=>PanResponder.create({
  onStartShouldSetPanResponder:()=>false,
  onMoveShouldSetPanResponder:(_,g)=>Math.abs(g.dx)+Math.abs(g.dy)>8,
  onMoveShouldSetPanResponderCapture:(_,g)=>Math.abs(g.dx)+Math.abs(g.dy)>8,
  onPanResponderGrant:()=>{drag.current?.();origin.current=position.current;},
  onPanResponderMove:(_,g)=>{drag.current?.();const s=size.current;const next=clampCallPosition(origin.current.x+g.dx,origin.current.y+g.dy,s.bounds.width,s.bounds.height,s.width,s.height);position.current=next;value.setValue(next);},
  onPanResponderRelease:()=>drag.current?.(),
  onPanResponderTerminate:()=>drag.current?.(),
  onPanResponderTerminationRequest:()=>true,
 }),[value]);
 return <Animated.View {...responder.panHandlers} style={{position:'absolute',left:0,top:0,width,height,transform:value.getTranslateTransform(),zIndex:2000,elevation:20}}>{children}</Animated.View>;
}
