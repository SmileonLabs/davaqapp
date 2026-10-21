import {Text} from './Localized';
import React,{useEffect,useRef} from 'react';
import {ActivityIndicator, Animated, StyleSheet, View} from 'react-native';
import {scannerLoadPercent,type ScannerLoadProgress} from '../scanner-load-progress';
import {colors} from './ui';
const labels={checking:'카드 데이터 변경 확인 중',downloading:'카드 데이터 다운로드',verifying:'받은 데이터 검증 중',opening:'최신 카드 데이터 적용 중',ready:'최신 카드 데이터 준비 완료',pricing:'최신 참고가를 확인하고 있어요'};
export function ScannerLoadingBar({progress}:{progress:ScannerLoadProgress|null}){
 const motion=useRef(new Animated.Value(0)).current;
 const indefinite=!!progress&&scannerLoadPercent(progress)===null;
 useEffect(()=>{if(!indefinite)return;const animation=Animated.loop(Animated.sequence([Animated.timing(motion,{toValue:1,duration:850,useNativeDriver:true}),Animated.timing(motion,{toValue:0,duration:850,useNativeDriver:true})]));animation.start();return()=>animation.stop();},[indefinite,motion]);
 if(!progress)return null;
 const percent=scannerLoadPercent(progress);
 return <View pointerEvents="none" style={styles.panel} accessibilityRole="progressbar" accessibilityLabel={labels[progress.stage]} accessibilityValue={percent===null?{text:labels[progress.stage]}:{min:0,max:100,now:percent}}>
  <View style={styles.row}><Text style={styles.label}>{labels[progress.stage]}</Text>{percent===null?<ActivityIndicator size="small" color={colors.accent}/>:<Text style={styles.label}>{percent}%</Text>}</View>
  <View style={styles.track}>{percent===null?<Animated.View style={[styles.fill,{width:'100%',opacity:motion.interpolate({inputRange:[0,1],outputRange:[.2,.9]})}]}/>:<View style={[styles.fill,{width:`${percent}%`}]}/>}</View>
  {progress.updating&&progress.stage!=='ready'&&<Text style={styles.note}>저장된 데이터로 스캔을 계속할 수 있어요</Text>}
 </View>;
}
const styles=StyleSheet.create({panel:{position:'absolute',top:154,left:24,right:24,padding:10,backgroundColor:'#151515ee',borderRadius:8,borderWidth:1,borderColor:colors.line},row:{flexDirection:'row',justifyContent:'space-between',alignItems:'center',marginBottom:7},label:{color:colors.text,fontSize:11,fontWeight:'600'},note:{color:colors.muted,fontSize:10,marginTop:6},track:{height:4,borderRadius:2,backgroundColor:colors.line,overflow:'hidden'},fill:{height:4,backgroundColor:colors.accent,borderRadius:2}});
