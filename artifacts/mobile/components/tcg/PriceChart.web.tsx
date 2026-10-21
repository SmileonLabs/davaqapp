import React,{useEffect,useMemo,useRef,useState} from 'react';
import type {Detail} from '@/lib/tcg';
import {chartHtml} from './chart/html';
export function PriceChart({detail}:{detail:Detail}) {
  const html=useMemo(()=>chartHtml(detail),[detail]), ref=useRef<HTMLIFrameElement>(null);
  const [height,setHeight]=useState(1100);
  useEffect(()=>{const listener=(e:MessageEvent)=>{if(e.source===ref.current?.contentWindow&&e.data?.type==='davaq-chart-height'&&Number.isFinite(e.data.height))setHeight(Math.max(300,Math.min(4000,e.data.height)));};window.addEventListener('message',listener);return()=>window.removeEventListener('message',listener);},[]);
  return <iframe ref={ref} title="TCGIndex 가격 변화 차트" srcDoc={html} sandbox="allow-scripts allow-same-origin allow-popups" style={{width:'100%',height,border:0,display:'block'}}/>;
}
