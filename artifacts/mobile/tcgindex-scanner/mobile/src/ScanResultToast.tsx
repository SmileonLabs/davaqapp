import {Text} from './app/Localized';
import React,{useEffect,useRef,useState} from 'react';
import {AccessibilityInfo, Animated, Pressable, StyleSheet, View} from 'react-native';
import type {Card} from './scanner';
import {CardImage} from './app/CardImage';
import {formatScanPrice,scanEstimateLabel,scanResultImage,type LocalEstimate} from './scanner-library';
import {scannerPriceText,type ScannerPriceState} from './scanner-live-price';
const languages:Record<string,string>={ko:'한국어',ja:'일본어',en:'영어'};

export function ScanResultToast({card,estimate=null,priceStatus,onPress,fullScreen}:{card:Card;estimate?:LocalEstimate|null;priceStatus?:ScannerPriceState['status'];onPress:()=>void;fullScreen:boolean}){
 const appear=useRef(new Animated.Value(0)).current,opacity=useRef(new Animated.Value(0)).current,press=useRef(new Animated.Value(1)).current;
 const [reduceMotion,setReduceMotion]=useState(false);
 useEffect(()=>{let current=true;void AccessibilityInfo.isReduceMotionEnabled().then(v=>{if(current)setReduceMotion(v);});const subscription=AccessibilityInfo.addEventListener('reduceMotionChanged',setReduceMotion);return()=>{current=false;subscription.remove();};},[]);
 useEffect(()=>{
  appear.stopAnimation();opacity.stopAnimation();appear.setValue(reduceMotion?1:0);opacity.setValue(0);
  const animation=Animated.parallel([
   Animated.timing(opacity,{toValue:1,duration:140,useNativeDriver:true}),
   ...(reduceMotion?[]:[Animated.spring(appear,{toValue:1,stiffness:280,damping:12,mass:.8,useNativeDriver:true})]),
  ]);
  animation.start();return()=>animation.stop();
 },[card.id,reduceMotion,appear,opacity]);
 const touch=(toValue:number)=>{if(!reduceMotion)Animated.spring(press,{toValue,stiffness:360,damping:18,mass:.5,useNativeDriver:true}).start();};
 const image=scanResultImage(card,estimate);
 const observedAt=estimate?.observedAt??card.price?.observedAt;
 const priceText=scannerPriceText(card,estimate,priceStatus,formatScanPrice);
 return <Animated.View style={[styles.toast,fullScreen&&{bottom:82,left:16,right:16,padding:12},
  {opacity,transform:[{translateY:appear.interpolate({inputRange:[0,1],outputRange:[38,0]})},{scaleX:Animated.multiply(press,appear.interpolate({inputRange:[0,1],outputRange:[.86,1]}))},{scaleY:Animated.multiply(press,appear.interpolate({inputRange:[0,1],outputRange:[.66,1]}))}]}]}>
  <Pressable accessibilityRole="button" accessibilityLabel={`${card.name}, ${priceText}, 검색 결과 보기`} onPress={onPress} onPressIn={()=>touch(.97)} onPressOut={()=>touch(1)}>
   <View style={{flexDirection:'row',justifyContent:'space-between',gap:8}}><Text style={[styles.arrived,{flex:1}]}>{estimate?'≈ '+scanEstimateLabel(estimate):card.matchLevel==='card'?'카드 그림 확인 · 판본 미확정':'✓ 카드를 찾았어요'}</Text><Text style={[styles.link,{marginTop:0,fontSize:11}]}>상세 · 등록 ›</Text></View>
   <View style={styles.row}><View style={{width:58}}><CardImage accessibilityLabel={estimate?'유사 카드 참고 이미지':'인식한 카드 이미지'} src={image} style={styles.image}/>{estimate&&<Text style={[styles.meta,{fontSize:10,textAlign:'center'}]}>참고 이미지</Text>}</View><View style={{flex:1}}>
    <Text translate={false} style={styles.name} numberOfLines={1}>{card.name}</Text><Text style={styles.meta} numberOfLines={1}>{card.number} · {languages[card.language]??card.language}{card.setName||card.setCode?' · '+(card.setName||card.setCode):''}</Text>
    <Text accessibilityLiveRegion="polite" style={styles.price}>{priceText}</Text><Text style={styles.meta} numberOfLines={1}>{estimate?(estimate.source??`같은 세트·희귀도 ${estimate.count}장 비교`):card.price?`${card.price.type==='LISTED'?'등록가':card.price.type==='SOLD'?'거래가':'시장 참고가'} · ${card.price.source}`:priceStatus==='withdrawn'?'데이터 상태가 변경되었습니다. 상세에서 다시 확인해 주세요.':priceStatus==='pending'?'카드 인식 완료 · 최신 시장 자료 확인 중':priceStatus==='unavailable'?'카드 인식 완료 · 인터넷 연결 후 다시 확인':'해당 시장 가격 근거 없음'}</Text>
    {observedAt&&<Text style={styles.meta}>가격 관측일 · {observedAt.slice(0,10)}</Text>}
   </View></View>
  </Pressable>
 </Animated.View>;
}
const styles=StyleSheet.create({toast:{position:'absolute',bottom:10,left:10,right:10,backgroundColor:'#151515f5',borderRadius:22,padding:14,borderWidth:1,borderColor:'#ff263866',elevation:8,shadowColor:'#000',shadowOpacity:.25,shadowRadius:16,shadowOffset:{width:0,height:8}},arrived:{color:'#ff2638',fontSize:12,fontWeight:'700',marginBottom:10},row:{flexDirection:'row',alignItems:'center',gap:12},image:{width:58,height:82,resizeMode:'contain'},name:{color:'#f5f5f5',fontSize:15,fontWeight:'700'},meta:{color:'#a6a6a6',fontSize:12,marginTop:5},price:{color:'#ff2638',fontSize:22,fontWeight:'800',marginTop:6},link:{color:'#ff6874',fontSize:13,marginTop:12}});
