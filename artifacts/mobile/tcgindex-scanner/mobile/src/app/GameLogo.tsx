import React from 'react';
import Svg,{Circle,Path,Text as SvgText} from 'react-native-svg';

// Compact, offline game marks; the full game name is always shown with selection.
export function GameLogo({game,color='#fff'}:{game:string;color?:string}){
 const words:Record<string,string[]>={one_piece:['ONE','PIECE'],yugioh:['遊','戯王'],union_arena:['UNION','ARENA'],riftbound:['RIFT','BOUND'],cookie_run:['COOKIE','RUN'],duel_masters:['DUEL','MASTERS'],gundam:['GUN','DAM'],kaikai_kiki:['Kaikai','Kiki'],digimon:['DIGI','MON'],lorcana:['LOR','CANA']};
 return <Svg width={34} height={34} viewBox="0 0 40 40">
  {game==='pokemon'?<><Circle cx={20} cy={20} r={15} stroke={color} strokeWidth={3} fill="none"/><Path d="M5 20h30" stroke={color} strokeWidth={3}/><Circle cx={20} cy={20} r={5} fill="#151515" stroke={color} strokeWidth={3}/></>:game==='magic'?<Path d="M5 35 11 10l4 16 2-25 4 18 3-15 3 22 4-16 4 25-8-7-7 10-7-10z" fill={color}/>:game==='dragon_ball'?<><Circle cx={20} cy={20} r={16} fill="#ffb13b"/><Path d="m20 8 3.4 7 7.6 1-5.5 5.4 1.3 7.6-6.8-3.6-6.8 3.6 1.3-7.6L9 16l7.6-1z" fill="#e22b28"/></>:<>{(words[game]??[game.slice(0,4).toUpperCase()]).map((word,i)=><SvgText key={i} x={20} y={words[game]?17+i*12:24} textAnchor="middle" fill={color} fontWeight="900" fontSize={game==='yugioh'?16:9}>{word}</SvgText>)}</>}
 </Svg>;
}
