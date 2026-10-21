import React from 'react';
import {Image} from 'react-native';
import Svg,{Path,Circle,Rect} from 'react-native-svg';
// Same paths and stroke as the mobile web InterfaceIcon.
const paths={settings:'M10 3h4l1 3 3-1 2 3-2 2 2 2-2 3-3-1-1 3h-4l-1-3-3 1-2-3 2-2-2-2 2-3 3 1z',market:'M4 20V11h4v9m2 0V4h4v16m2 0V8h4v12',scan:'M8 3H4v5m12-5h4v5M4 16v5h4m12-5v5h-4M8 9h8v6H8z',star:'m12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2-5.6-2.9-5.6 2.9 1.1-6.2L3 9.6l6.2-.9z',menu:'M4 5h16M4 12h16M4 19h16',search:'m16 16 5 5',camera:'M4 7h4l2-3h4l2 3h4v13H4z',image:'m3 17 6-6 4 4 3-3 5 5',close:'M6 6l12 12M6 18 18 6'};
export function InterfaceIcon({name,color,size=22}:{name:keyof typeof paths;color:string;size?:number}){return <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round"><Path d={paths[name]}/>{name==='settings'&&<Circle cx={12} cy={11} r={3}/>}{name==='search'&&<Circle cx={10.5} cy={10.5} r={6.5}/>}{name==='camera'&&<Circle cx={12} cy={13} r={4}/>}{name==='image'&&<><Rect x={3} y={3} width={18} height={18} rx={1}/><Circle cx={8} cy={8} r={1}/></>}</Svg>;}
