import React, {useMemo, useState} from 'react';
import { Linking, View } from 'react-native';
import {WebView} from 'react-native-webview';
import type {Detail} from '@/lib/tcg';
import {chartHtml} from './chart/html';
export function PriceChart({detail}:{detail:Detail}) {
  const html=useMemo(()=>chartHtml(detail),[detail]);
  const [height,setHeight]=useState(1100);
  return <View style={{height, width: "100%"}}><WebView source={{html}} originWhitelist={['about:*']} style={{flex: 1, backgroundColor:'white'}} scrollEnabled={false}
    onMessage={e=>{try{const h=JSON.parse(e.nativeEvent.data).height;if(Number.isFinite(h))setHeight(Math.max(300,Math.min(4000,h)));}catch{}}}
    onShouldStartLoadWithRequest={request=>{if(request.url==='about:blank')return true;if(request.url.startsWith('https://www.tradingview.com/')||request.url.startsWith('https://github.com/tradingview/'))void Linking.openURL(request.url);return false;}}/></View>;
}
