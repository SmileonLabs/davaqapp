import React from 'react';
import {createRoot} from 'react-dom/client';
import {ShopPriceHistoryChart} from './ShopPriceHistoryChart';
createRoot(document.getElementById('root')!).render(<ShopPriceHistoryChart points={(window as any).__DAVAQ_POINTS__}/>);
new ResizeObserver(()=>{const h=document.documentElement.scrollHeight;window.parent.postMessage({type:'davaq-chart-height',height:h},'*');(window as any).ReactNativeWebView?.postMessage(JSON.stringify({height:h}));}).observe(document.body);
