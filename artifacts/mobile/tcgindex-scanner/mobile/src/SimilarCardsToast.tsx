import {Text} from './app/Localized';
import React,{useEffect,useRef} from 'react';
import {AccessibilityInfo, Animated, Pressable, StyleSheet, View} from 'react-native';
import type {Card} from './scanner';
import {CardImage} from './app/CardImage';
import {localEstimate,formatScanPrice} from './scanner-library';

export function SimilarCardsToast({cards,market='KR',bottom,onPress}:{cards:Card[];market?:string;bottom:number;onPress:(card:Card)=>void}) {
 const arrive=useRef(new Animated.Value(0)).current;
 const key=cards.map(c=>c.id).join(',');
 useEffect(()=>{let canceled=false;arrive.setValue(0);void AccessibilityInfo.isReduceMotionEnabled().then(reduce=>{if(!canceled){if(reduce)arrive.setValue(1);else Animated.spring(arrive,{toValue:1,stiffness:280,damping:16,mass:.8,useNativeDriver:true}).start();}});return()=>{canceled=true;arrive.stopAnimation();};},[key,arrive]);
 return <Animated.View accessibilityLiveRegion="polite" style={[styles.toast,{bottom,opacity:arrive,transform:[{translateY:arrive.interpolate({inputRange:[0,1],outputRange:[30,0]})},{scaleY:arrive.interpolate({inputRange:[0,1],outputRange:[.8,1]})}]}]}>
   <Text style={styles.title}>유사 후보 · 번호와 판본을 확인해 주세요</Text>
   <View style={styles.row}>{cards.slice(0,3).map(card=>{const estimate=card.price?null:localEstimate(card,[],market);return <Pressable key={card.id} accessibilityRole="button" accessibilityLabel={`${card.name}, ${card.number}. 유사 후보 검색 결과 열기`} style={styles.item} onPress={()=>onPress(card)}>
     <CardImage src={card.image} style={styles.image}/><Text translate={false} numberOfLines={1} style={styles.name}>{card.name}</Text><Text numberOfLines={1} style={styles.number}>{card.number}</Text>
     <Text numberOfLines={1} style={styles.price}>{formatScanPrice(estimate??card.price)}</Text>
   </Pressable>;})}</View>
 </Animated.View>;
}
const styles=StyleSheet.create({toast:{position:'absolute',left:16,right:16,padding:12,borderRadius:22,backgroundColor:'#151515f5',borderWidth:1,borderColor:'#ff263866'},title:{color:'#f5f5f5',fontSize:12,fontWeight:'700'},row:{flexDirection:'row',gap:10,marginTop:8},item:{flex:1,minWidth:0},image:{height:58,width:'100%',resizeMode:'contain'},name:{color:'#f5f5f5',fontSize:12,marginTop:5},number:{color:'#a6a6a6',fontSize:10,marginTop:3},price:{color:'#ff2638',fontSize:12,fontWeight:'600',marginTop:3}});
