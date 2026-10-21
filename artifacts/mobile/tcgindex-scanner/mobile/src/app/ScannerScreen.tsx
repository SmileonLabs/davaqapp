import {Text} from './Localized';
import React,{useCallback,useEffect,useMemo,useRef,useState} from 'react';
import {Linking, Modal, Platform, Pressable, ScrollView, StyleSheet, Switch, View} from 'react-native';
import {NativeLiveScannerAndroid} from '../NativeLiveScannerAndroid';
import {useCameraPermission} from 'react-native-vision-camera';
import {localMarketCard,formatScanPrice,scanEstimateLabel,type LibraryCard,type LocalEstimate} from '../scanner-library';
import {InterfaceIcon} from './InterfaceIcon';
import {GameLogo} from './GameLogo';
import {KREAM_GAME_OPTIONS} from '../../../web/src/lib/game-options';
import {scannerPriceText,type ScannerResult} from '../scanner-live-price';
import {SCANNER_GAMES} from '../scanner-games';

const scanGames=SCANNER_GAMES.map(code=>KREAM_GAME_OPTIONS.find(g=>g.code===code)!);
type Props={onClose:()=>void;onMyCards:()=>void;onOpenCard:(href:string,id?:string,number?:string,game?:string,market?:string,name?:string)=>void;diagnostics?:boolean;onDiagnostics:(value:boolean)=>void};
export function ScannerScreen(props:Props) {
 const [game,setGame]=useState('pokemon');
 const [market,setMarket]=useState('KR');
 const [language,setLanguage]=useState('all');
 const [choosing,setChoosing]=useState<'market'|'settings'|null>(null);
 const [syncKey,setSyncKey]=useState(0);
 const gameLabel=KREAM_GAME_OPTIONS.find(g=>g.code===game)?.label??game;
 return <View style={styles.screen}>
  <ScannerSession key={game} {...props} game={game} market={market} language={language} syncKey={syncKey} gameLabel={gameLabel} onMarket={()=>setChoosing('market')} onSettings={()=>setChoosing('settings')}/>
  <ScannerGames game={game} onGame={setGame}/>
  <Modal transparent animationType="slide" visible={!!choosing} onRequestClose={()=>setChoosing(null)}>
   <View style={styles.backdrop}>
    <Pressable accessibilityLabel="선택창 닫기" style={{flex:1}} onPress={()=>setChoosing(null)}/>
    <View style={styles.sheet}>
     <View style={styles.row}>
      <Text style={styles.title}>{choosing==='market'?'가격 시장 · 카드 언어':'스캔 설정'}</Text>
      <Pressable onPress={()=>setChoosing(null)} accessibilityLabel="닫기"><InterfaceIcon name="close" color="#fff"/></Pressable>
     </View>
     <ScrollView>
      {choosing==='market'?<>
       <Text style={styles.note}>시장은 가격 통화만 바꿉니다. 카드 인식은 선택한 게임과 카드 언어를 기준으로 합니다.</Text>
       {[['KR','한국 · KRW'],['US','미국 · USD'],['EU','유럽 · EUR']].map(([value,label])=>
        <Pressable key={value} onPress={()=>setMarket(value)} style={styles.option}><Text style={styles.text}>{label}{market===value?' ✓':''}</Text></Pressable>
       )}
       <Text style={[styles.note,{marginTop:16}]}>카드 언어</Text>
       {[['all','모든 언어'],['ko','한국어'],['ja','일본어'],['en','영어']].map(([value,label])=>
        <Pressable key={value} onPress={()=>setLanguage(value)} style={styles.option}><Text style={styles.text}>{label}{language===value?' ✓':''}</Text></Pressable>
       )}
      </>:<>
       <View style={[styles.row,styles.option]}><Text style={[styles.text,{flex:1}]}>스캔 진단 모드</Text><Switch value={props.diagnostics===true} onValueChange={props.onDiagnostics}/></View>
       <Pressable style={styles.option} onPress={()=>{setSyncKey(value=>value+1);setChoosing(null);}}><Text style={styles.text}>카드 · 가격 데이터 업데이트</Text></Pressable>
       <Text style={styles.note}>카드 데이터는 새 버전이 있으면 변경된 부분만 갱신합니다. 최신 참고가는 인터넷으로 확인하며, 연결이 없어도 저장된 데이터로 스캔할 수 있습니다. 카메라 영상과 선택한 사진은 서버로 전송하지 않습니다.</Text>
       <Text style={styles.note}>정확한 판본과 가격 근거가 부족하면 추정가 대신 유사 후보를 표시합니다.</Text>
      </>}
     </ScrollView>
    </View>
   </View>
  </Modal>
 </View>;
}
function ScannerGames({game,onGame}:{game:string;onGame:(game:string)=>void}){
 const scroll=useRef<ScrollView>(null),[width,setWidth]=useState(0);
 const center=useCallback((animated:boolean)=>{const i=scanGames.findIndex(g=>g.code===game);if(i>=0&&width>0)scroll.current?.scrollTo({x:Math.max(0,16+i*88+37-width/2),animated});},[game,width]);
 useEffect(()=>center(true),[center]);
 return <ScrollView ref={scroll} horizontal showsHorizontalScrollIndicator={false} onLayout={e=>setWidth(e.nativeEvent.layout.width)} onContentSizeChange={()=>center(false)} style={styles.games} contentContainerStyle={{paddingHorizontal:16,gap:14}}>{scanGames.map(g=><Pressable key={g.code} accessibilityRole="button" accessibilityLabel={g.label} accessibilityState={{selected:game===g.code}} onPress={()=>{onGame(g.code);if(g.code===game)center(true);}} style={{width:74,alignItems:'center',gap:4}}><View style={[styles.gameLogo,game===g.code&&styles.selectedGame]}><GameLogo game={g.code} color={game===g.code?'#ff2638':'#fff'}/></View><Text numberOfLines={1} style={{color:game===g.code?'#ff2638':'#ddd',fontSize:11,maxWidth:74,fontWeight:game===g.code?'800':'500'}}>{g.code==='magic'?'매직개더링':g.label}{game===g.code?' ✓':''}</Text></Pressable>)}</ScrollView>;
}
function ScannerSession({onClose,onMyCards,onOpenCard,diagnostics=true,game,market,language,syncKey,gameLabel,onMarket,onSettings}:Props&{game:string;market:string;language:string;syncKey:number;gameLabel:string;onMarket:()=>void;onSettings:()=>void}){
 const permission=useCameraPermission(),[error,setError]=useState(''),[result,setResult]=useState<ScannerResult|null>(null);
 const asked=useRef(false);
 useEffect(()=>{if(!permission.hasPermission&&permission.canRequestPermission&&!asked.current){asked.current=true;void permission.requestPermission();}},[permission.hasPermission,permission.canRequestPermission,permission.requestPermission]);
 return <View style={styles.screen}>
  {permission.hasPermission?<NativeLiveScannerAndroid key={language+market} game={game} market={market} language={language} syncKey={syncKey} diagnostics={diagnostics} onError={setError} onResult={value=>{setResult(value);if(value)setError('');}} onOpenCard={onOpenCard}/>:<View style={styles.permission}><InterfaceIcon name="camera" color="#fff" size={42}/><Text style={styles.text}>카드 스캔을 위한 카메라 권한이 필요합니다.</Text><Pressable style={styles.option} onPress={()=>void(permission.canRequestPermission?permission.requestPermission():Linking.openSettings())}><Text style={styles.text}>{permission.canRequestPermission?'카메라 허용':'권한 설정 열기'}</Text></Pressable></View>}
  <View style={styles.header}><Pressable accessibilityLabel="스캔 닫기" style={styles.round} onPress={onClose}><InterfaceIcon name="close" size={27} color="#fff"/></Pressable><Text style={[styles.text,{flex:1}]}>{gameLabel}</Text><Pressable accessibilityLabel="가격 시장과 카드 언어 선택" onPress={onMarket} style={styles.pill}><Text style={styles.text}>{market} · {language==='all'?'전체':language.toUpperCase()} ▾</Text></Pressable></View>
  {result&&<View pointerEvents="none" style={styles.largePrice}><Text style={styles.note}>{result.estimate?scanEstimateLabel(result.estimate):result.card.price?.type==='LISTED'?'참고 등록가':result.card.price?'시장 참고가':result.card.matchLevel==='card'||result.card.artworkSpecific===false?'카드 확인 · 판본 추가 확인 필요':'카드 확인'}</Text><Text style={styles.price}>{scannerPriceText(result.card,result.estimate,result.priceStatus,formatScanPrice)}</Text></View>}
  <View style={styles.bottom}><Pressable accessibilityLabel="스캔 설정" style={styles.round} onPress={onSettings}><InterfaceIcon name="settings" color="#fff" size={25}/></Pressable><Pressable accessibilityLabel="내 카드로 이동" style={styles.pill} onPress={onMyCards}><InterfaceIcon name="star" color="#fff" size={22}/><Text style={styles.text}>내 카드 ›</Text></Pressable></View>
  {!!error&&<Pressable style={styles.error} onPress={()=>setError('')}><Text style={styles.text}>{error}</Text><Text style={styles.note}>눌러서 닫기</Text></Pressable>}
</View>;
}
const styles=StyleSheet.create({screen:{flex:1,backgroundColor:'#090909'},row:{flexDirection:'row',alignItems:'center',justifyContent:'space-between',gap:12},games:{position:'absolute',top:68,left:0,right:0,maxHeight:80},gameLogo:{width:52,height:52,borderRadius:26,borderWidth:2,borderColor:'#555',backgroundColor:'#151515dd',alignItems:'center',justifyContent:'center'},selectedGame:{borderColor:'#ff2638',backgroundColor:'#301115ee',transform:[{scale:1.05}]},header:{position:'absolute',top:12,left:16,right:16,flexDirection:'row',alignItems:'center',gap:8},round:{width:46,height:46,borderRadius:23,backgroundColor:'#151515dd',alignItems:'center',justifyContent:'center'},pill:{paddingHorizontal:13,paddingVertical:12,borderRadius:26,backgroundColor:'#151515dd',flexDirection:'row',alignItems:'center',gap:8,flexShrink:1},title:{color:'#fff',fontSize:19,fontWeight:'700',marginBottom:10},text:{color:'#fff',fontSize:14,fontWeight:'600'},note:{color:'#c3c7d0',fontSize:12,lineHeight:19,marginTop:8},largePrice:{position:'absolute',top:216,right:20,alignItems:'flex-end',maxWidth:'90%'},price:{color:'#fff',fontSize:34,fontWeight:'800',textShadowColor:'#0008',textShadowRadius:8},bottom:{position:'absolute',bottom:18,left:80,right:18,flexDirection:'row',alignItems:'center',justifyContent:'space-between'},permission:{flex:1,alignItems:'center',justifyContent:'center',padding:28,gap:20},error:{position:'absolute',top:215,left:16,right:16,backgroundColor:'#522833ee',borderRadius:12,padding:16},backdrop:{flex:1,backgroundColor:'#0008'},sheet:{backgroundColor:'#151515',padding:24,paddingBottom:32,borderTopLeftRadius:26,borderTopRightRadius:26,maxHeight:'78%'},option:{paddingVertical:15,borderBottomWidth:1,borderBottomColor:'#303030'}});
