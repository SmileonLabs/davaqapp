import {Text} from './app/Localized';
import React, {useCallback,useEffect,useMemo,useRef,useState} from 'react';
import {ActivityIndicator,AppState, Linking, NativeModules, Platform, Pressable, StyleSheet, Vibration, View} from 'react-native';
import {launchImageLibraryAsync} from 'expo-image-picker';
import {localEstimate,type LocalEstimate} from './scanner-library';
import {InterfaceIcon} from './app/InterfaceIcon';
import {Camera,type CameraRef} from 'react-native-vision-camera';
import {IOSScannerCamera} from './IOSScannerCamera';
import {Images,NitroImage,type Image as AnalysisImage} from 'react-native-nitro-image';
import type {TfliteModel} from 'react-native-fast-tflite';
import {API_BASE} from './catalog';
import {applyCameraZoom,isInactiveCameraError} from './camera-control';
import {captureCardPreview,detectCard,readCardFooter,type Detection} from './card-text';
import {advanceScanProgress,emptyScanProgress,initialCardGuide,decodeCardRgb,emptyQuadTrack,trackCardQuad,predictedCardQuad,type CardQuad} from './card-detection';
import {CardOutline} from './CardOutline';
import {ScanResultToast} from './ScanResultToast';
import {useScannerPrice} from './app/useScannerPrice';
import {ScannerLoadingBar} from './app/ScannerLoadingBar';
import type {ScannerResult} from './scanner-live-price';
import {SimilarCardsToast} from './SimilarCardsToast';
import {type IndexCard,type IndexHint} from './scanner-index';
import {alignedCardQuad,chooseScanRegion} from './scanner-regions';
import {artworkReference,confirmCardNumber,confirmImageHint,cropInputRegion,emptyStability,findArtworkMatches,findCardAlignment,findMatches,INPUT_SIZE,inputToRgba,matchCardNumber,MIN_SCORE,nextStability,scannerLookupNumber,STABLE_FRAMES,type Card,type Match,type Reference} from './scanner';

// Camera owns the preview output. Keep extra outputs stable and never restart it on a result update.
const OUTPUTS: [] = [];
const ScannerCamera=Platform.OS==='ios'?IOSScannerCamera:Camera;
type Reading = {matches:Match[];samples:number;processingMs:number;inferenceMs:number;ocrMs:number;ocrText:string;hint?:string;stable:boolean;at:number};
type Props = {model:TfliteModel|null;references:Reference[];index?:IndexCard[];onError:(message:string)=>void;onOpenCard?:(href:string,id?:string,number?:string,game?:string,market?:string,name?:string)=>void;onNumber?:(text:string)=>void|boolean;onSimilarCandidates?:(candidates:IndexHint[])=>void;similarCards?:Card[];similarStatus?:string;preparing?:boolean;status?:string;fullScreen?:boolean;diagnostics?:boolean;getReferences?:(hints:IndexHint[],text:string)=>Reference[];localCards?:Card[];market?:string;onResult?:(value:ScannerResult|null)=>void;onGalleryError?:(message:string)=>void};

export function LiveScanner({model,references,index=[],onError,onOpenCard,onNumber,onSimilarCandidates,similarCards=[],similarStatus='',preparing=false,status='',fullScreen=false,diagnostics=false,getReferences,localCards=[],market='KR',onResult,onGalleryError}:Props) {
  const [active,setActive]=useState(AppState.currentState==='active'),[streaming,setStreaming]=useState(false);
  const [reading,setReading]=useState<Reading|null>(null),[quad,setQuad]=useState<CardQuad|null>(null);
  const [confirmed,setConfirmed]=useState<{match:Match;at:number}|null>(null);
  const [layout,setLayout]=useState({width:0,height:0}),[inspection,setInspection]=useState<AnalysisImage|null>(null);
  const [phase,setPhase]=useState('카메라를 시작하고 있습니다…');
  const [attempts,setAttempts]=useState(0);
  const [zoom,setZoom]=useState(1),[selectedPhoto,setSelectedPhoto]=useState<AnalysisImage|null>(null);
  const ocrBusy=useRef(false),ocrCache=useRef({text:'',at:0}),photoRef=useRef<AnalysisImage|null>(null);photoRef.current=selectedPhoto;
  const camera=useRef<CameraRef>(null),mounted=useRef(true),processing=useRef(false),recognizing=useRef(false),recognitionAt=useRef(0),stability=useRef(emptyStability()),samples=useRef(0),detectedAt=useRef(0),inspectedAt=useRef(0);
  const nativeCapture=useRef(true),captureFailures=useRef(0);
  const sessionEpoch=useRef(0);
  useEffect(()=>{
    sessionEpoch.current++;
    if(Platform.OS==='ios'&&active&&!selectedPhoto)void NativeModules.TCGCardText.beginScanner();
    return()=>{sessionEpoch.current++;if(Platform.OS==='ios')NativeModules.TCGCardText.endScanner();};
  },[active,selectedPhoto]);
  const progress=useRef(emptyScanProgress()),candidates=useRef<IndexHint[]>([]),fallbackAsked=useRef(false),trackedQuad=useRef<CardQuad|null>(null),redetectedAt=useRef(0),confirmedAt=useRef(0);
  const scene=useRef({id:'',pending:'',count:0,version:0});
  const outlineTrack=useRef(emptyQuadTrack());
  const [detection,setDetection]=useState({ms:0,tracked:false,clear:false});
  const runtime=useRef({model,references,index,preparing,onNumber,onError,onSimilarCandidates,diagnostics,layout,getReferences});runtime.current={model,references,index,preparing,onNumber,onError,onSimilarCandidates,diagnostics,layout,getReferences};
  // Tracking loss resets analysis, while the last confirmed result stays visible.
  const resetScene=useCallback(()=>{progress.current=emptyScanProgress();candidates.current=[];fallbackAsked.current=false;ocrCache.current={text:'',at:0};scene.current={id:'',pending:'',count:0,version:scene.current.version+1};stability.current=emptyStability();runtime.current.onSimilarCandidates?.([]);},[]);
  const notified=useRef('');
  useEffect(()=>{const id=confirmed?.match.card.id;if(id&&id!==notified.current){notified.current=id;Vibration.vibrate(35);}},[confirmed?.match.card.id]);
  useEffect(()=>()=>inspection?.dispose(),[inspection]);
  useEffect(()=>()=>selectedPhoto?.dispose(),[selectedPhoto]);
  useEffect(()=>{
    mounted.current=true;
    const subscription=AppState.addEventListener('change',state=>{setActive(state==='active');if(state!=='active')setStreaming(false);resetScene();setReading(null);setQuad(null);trackedQuad.current=null;detectedAt.current=0;});
    return()=>{mounted.current=false;subscription.remove();};
  },[resetScene]);
  useEffect(()=>{
    if(!active||!streaming||selectedPhoto)return;
    let canceled=false;
    void applyCameraZoom(camera.current?.controller,zoom,()=>!canceled&&mounted.current&&AppState.currentState==='active'&&!photoRef.current)
      .catch(error=>runtime.current.onError(`카메라 배율을 변경하지 못했습니다. ${String(error).split('\n')[0].slice(0,180)}`));
    return()=>{canceled=true;};
  },[active,streaming,selectedPhoto,zoom]);

  const recognize=useCallback(async(detected:Detection,started:number)=>{
    const epoch=sessionEpoch.current;
    try {
      const choice=chooseScanRegion([detected,...detected.alternatives??[]].filter(d=>d.pixels||d.rgb).map(d=>({detected:d,source:d.source,pixels:d.pixels??decodeCardRgb(d.rgb!)})),runtime.current.index,(ranked,text)=>runtime.current.getReferences?.(ranked,text)??runtime.current.references,ocrCache.current.text);
      if(!choice)return;
      detected=choice.region.detected;
      const pixels=choice.region.pixels;
      if(runtime.current.diagnostics&&Date.now()-inspectedAt.current>=1000){
        inspectedAt.current=Date.now();setInspection(Images.loadFromRawPixelData({buffer:inputToRgba(pixels).buffer as ArrayBuffer,width:INPUT_SIZE,height:INPUT_SIZE,pixelFormat:'RGBA'},false));
      }
      const {ranked,hint}=choice;
      // Ambiguous nearest-neighbour changes are not a change of physical card.
      const sceneId=hint?.id??'';
      if(sceneId&&scene.current.id&&sceneId!==scene.current.id){
        const old=scene.current;old.count=old.pending===sceneId?old.count+1:1;old.pending=sceneId;
        if(old.count>=2){const continuous=progress.current;resetScene();progress.current=continuous;scene.current.id=sceneId;}
      }else if(sceneId){scene.current.id=sceneId;scene.current.pending='';scene.current.count=0;}
      candidates.current=ranked.filter(c=>c.distance<=.48);
      const sceneVersion=scene.current.version;
      // A unique picture candidate has an exact catalog ID, including cards
      // without a modern fraction number. OCR is the fallback for other frames.
      let ocrText=ocrCache.current.text,ocrMs=0;
      if(epoch!==sessionEpoch.current||!mounted.current||AppState.currentState!=='active'||sceneVersion!==scene.current.version)return;
      const {model,preparing,onNumber,diagnostics}=runtime.current;
      let references=choice.references;
      let ocrNumber=scannerLookupNumber(ocrText);
      const requested=onNumber?.(hint?.id??ocrNumber??'');
      const publish=(matches:Match[],inferenceMs:number)=>{
        if(epoch!==sessionEpoch.current||!mounted.current||AppState.currentState!=='active'||sceneVersion!==scene.current.version)return;
        const now=Date.now(),next=nextStability(stability.current,matches[0],now);stability.current=next;
        setReading({matches,samples:++samples.current,processingMs:performance.now()-started,inferenceMs,ocrMs,ocrText,hint:hint?.number,stable:next.count>=STABLE_FRAMES,at:now});
        if(next.count>=STABLE_FRAMES&&matches[0]){setConfirmed({match:matches[0],at:now});confirmedAt.current=now;if(fallbackAsked.current){fallbackAsked.current=false;runtime.current.onSimilarCandidates?.([]);}}
      };
      // OCR runs independently: new frames and image inference never await it.
      if(detected.footer&&!ocrBusy.current&&Date.now()-ocrCache.current.at>=900){
        ocrBusy.current=true;const ocrStarted=performance.now(),footer=detected.footer;
        void readCardFooter(footer).then(text=>{
          if(epoch!==sessionEpoch.current||!mounted.current||AppState.currentState!=='active'||sceneVersion!==scene.current.version)return;
          ocrCache.current={text,at:Date.now()};
          const number=scannerLookupNumber(text);if(number)runtime.current.onNumber?.(number);
          if(runtime.current.diagnostics)setReading(old=>old?{...old,ocrText:text,ocrMs:performance.now()-ocrStarted}:old);
        }).catch(()=>{
          if(epoch===sessionEpoch.current&&sceneVersion===scene.current.version)ocrCache.current.at=Date.now();
        }).finally(()=>{ocrBusy.current=false;});
      }
      if(requested||preparing||!model||!references.length){
        publish([],0);setPhase(!model?'인식 모델을 준비하고 있습니다…':ocrNumber||hint?'카드 인식 데이터를 준비하고 있습니다…':'일치하는 카드 그림을 찾고 있습니다. 카드 전체를 비춰 주세요');return;
      }
      const hintId=hint?.id.startsWith('catalog:')?hint.id.slice(8):hint?.id;
      let numbered=matchCardNumber(ocrText,references),indexed=hint?references.find(r=>r.card.id===hintId):null;
      let inspectionPixels=pixels,inferenceStarted=performance.now();
      const outputs=await model.run([pixels.buffer as ArrayBuffer]);
      if(epoch!==sessionEpoch.current||!mounted.current||AppState.currentState!=='active')return;
      let inferenceMs=performance.now()-inferenceStarted,matches=findMatches(new Float32Array(outputs[0]),references);
      let alignment=choice.alignment;
      matches=matches.map(m=>({...m,accepted:m.accepted&&!!alignment&&alignment.scores[0].id===m.card.id&&alignment.scores[0].score>=MIN_SCORE}));
      if(ocrNumber&&!numbered)matches=matches.map(m=>({...m,accepted:false}));
      if(indexed&&hint){
        const verified=confirmImageHint({...hint,id:hintId!},new Float32Array(outputs[0]),references,alignment);
        matches=matches.map(m=>({...m,accepted:false}));
        if(verified)matches=[verified,...matches.filter(m=>m.card.id!==verified.card.id).slice(0,2)];
      }
      if(numbered){
        const verified=confirmCardNumber(numbered,new Float32Array(outputs[0]),references,alignment,ocrText);
        if(verified)matches=[verified,...matches.filter(m=>m.card.id!==verified.card.id).slice(0,2)];
      }
      if((!ocrNumber||numbered)&&!matches[0]?.accepted&&alignment&&alignment.scores[0].score>=MIN_SCORE){
        inspectionPixels=cropInputRegion(pixels,alignment.region);inferenceStarted=performance.now();
        const artOutputs=await model.run([inspectionPixels.buffer as ArrayBuffer]);inferenceMs+=performance.now()-inferenceStarted;
        const artMatches=findArtworkMatches(new Float32Array(artOutputs[0]),references,alignment);
        if(artMatches[0]?.accepted)matches=artMatches;
      }
      if(epoch!==sessionEpoch.current||!mounted.current||AppState.currentState!=='active')return;
      // A rectangle alone cannot move the outline. First verify the picture,
      // then use its artwork position to recover the actual card border.
      if(matches[0]?.accepted&&alignment){
        const now=Date.now(),corners=alignedCardQuad(detected.corners,alignment),photo=photoRef.current,size=runtime.current.layout;
        detectedAt.current=now;trackedQuad.current=corners;
        const display=photo?corners.map(p=>{const scale=Math.max(size.width/photo.width,size.height/photo.height);return{x:(p.x*photo.width*scale-(photo.width*scale-size.width)/2)/size.width,y:(p.y*photo.height*scale-(photo.height*scale-size.height)/2)/size.height};}) as CardQuad:corners;
        if(Platform.OS==='ios'&&!photo&&detected.frameAt&&detected.session!==undefined)NativeModules.TCGCardText.seedScanner(JSON.stringify(corners),detected.frameAt,detected.session);
        else{outlineTrack.current=trackCardQuad(outlineTrack.current,display,now);setQuad(predictedCardQuad(outlineTrack.current));}
        setDetection({ms:detected.detectionMs,tracked:detected.tracked,clear:detected.clear});
      }
      if(diagnostics&&Date.now()-inspectedAt.current>=1000){
        inspectedAt.current=Date.now();setInspection(Images.loadFromRawPixelData({buffer:inputToRgba(inspectionPixels).buffer as ArrayBuffer,width:INPUT_SIZE,height:INPUT_SIZE,pixelFormat:'RGBA'},false));
      }
      publish(matches.map(m=>m.accepted&&m.method!=='number'?{...m,card:artworkReference(m.card)}:m),inferenceMs);
      setPhase(matches[0]?.accepted?(numbered?'번호와 그림을 확인하고 있습니다…':'그림을 연속 확인하고 있습니다…'):numbered?'번호를 읽었습니다. 같은 그림인지 확인 중입니다':indexed?'그림 후보를 찾았습니다. 같은 카드인지 확인 중입니다':'일치하는 카드 그림을 찾고 있습니다. 카드 전체를 비춰 주세요');
    }catch(error){if(epoch===sessionEpoch.current&&mounted.current&&AppState.currentState==='active')runtime.current.onError(`카드 인식 처리에 실패했습니다. ${String(error)}`);}
  },[resetScene]);

  const analyze=useCallback(async()=>{
      if(processing.current||!camera.current||AppState.currentState!=='active')return;
    processing.current=true;
    let snapshot:AnalysisImage|null=null,resized:AnalysisImage|null=null;
    const started=performance.now(),epoch=sessionEpoch.current;
    try {
      const size=runtime.current.layout;if(!size.width||!size.height)return;
      if(Platform.OS==='ios'&&!photoRef.current&&(recognizing.current||performance.now()-recognitionAt.current<180))return;
      const includeImage=!recognizing.current&&performance.now()-recognitionAt.current>=110;
      const redetect=Date.now()-redetectedAt.current>450;
      const photo=photoRef.current;
      const hint={guide:initialCardGuide(photo?.width??size.width,photo?.height??size.height),previous:Date.now()-detectedAt.current<600?trackedQuad.current:null,redetect,searchBorders:samples.current>0&&(!stability.current.count||redetect)};
      if(redetect)redetectedAt.current=Date.now();
      let detected:Detection|null;
      if(nativeCapture.current&&!photoRef.current){
        try{detected=await captureCardPreview(includeImage,hint);captureFailures.current=0;}
        catch(error){if(Platform.OS==='ios')throw error;if(!String(error).includes('already running')&&++captureFailures.current>=3)nativeCapture.current=false;return;}
      }else{
      // Photo input and Android compatibility fallback; iOS live input stays native.
      snapshot=photoRef.current??await camera.current.takeSnapshot();
      const scale=Math.min(1,(includeImage?1600:900)/Math.max(snapshot.width,snapshot.height));
      const image=scale<1?await snapshot.resizeAsync(Math.round(snapshot.width*scale),Math.round(snapshot.height*scale)):snapshot;
      if(image!==snapshot)resized=image;
      const jpeg=await image.toEncodedImageDataAsync('jpg',90);
      detected=await detectCard(jpeg.buffer,includeImage,hint);
      }
      if(epoch!==sessionEpoch.current||!mounted.current||AppState.currentState!=='active')return;
      setAttempts(previous=>previous+1);
      if(!detected){
        progress.current=emptyScanProgress();
        if(Date.now()-detectedAt.current>600){setQuad(null);trackedQuad.current=null;setReading(null);if(scene.current.id||fallbackAsked.current||confirmedAt.current)resetScene();}
        setPhase('가이드 안에 카드 전체를 맞춰 주세요');
        return;
      }
      const now=Date.now(),guide=[detected,...detected.alternatives??[]].find(d=>d.source==='guide')??detected;
      if(Platform.OS!=='ios'&&detected.tracked&&now-detectedAt.current<500&&!photo){outlineTrack.current=trackCardQuad(outlineTrack.current,detected.corners,now);setQuad(predictedCardQuad(outlineTrack.current));}
      setDetection({ms:detected.detectionMs,tracked:detected.tracked,clear:guide.clear});
      progress.current=advanceScanProgress(progress.current,guide.corners,guide.clear,now);
      if(!detected.clear)setPhase('카드를 조금 더 선명하게 비춰 주세요');
      if(!runtime.current.preparing&&runtime.current.model&&progress.current.elapsed>=4000&&!confirmedAt.current&&!fallbackAsked.current&&candidates.current.length){fallbackAsked.current=true;runtime.current.onSimilarCandidates?.(candidates.current);}
      if(!samples.current)setPhase('카드 번호를 읽고 있습니다…');
      if(includeImage){recognizing.current=true;recognitionAt.current=performance.now();void recognize(detected,started).finally(()=>{recognizing.current=false;});}
    }catch(error){if(epoch===sessionEpoch.current&&mounted.current&&AppState.currentState==='active')runtime.current.onError(`카드 인식 처리에 실패했습니다. ${String(error)}`);}
    finally{resized?.dispose();if(snapshot!==photoRef.current)snapshot?.dispose();processing.current=false;}
  },[recognize,resetScene]);

  useEffect(()=>{
    if(!active||(!streaming&&!selectedPhoto))return;
    let canceled=false,timer:ReturnType<typeof setTimeout>;
    const tick=async()=>{const started=performance.now();await analyze();if(!canceled)timer=setTimeout(()=>void tick(),Math.max(20,67-(performance.now()-started)));};
    void tick();
    const expire=setInterval(()=>{if(Date.now()-detectedAt.current>900){setQuad(null);trackedQuad.current=null;}},400);
    return()=>{canceled=true;clearTimeout(timer);clearInterval(expire);};
  },[active,streaming,selectedPhoto,analyze,resetScene]);

  const currentBest=reading?.matches[0],best=confirmed?.match,show=!!best;
  const local=useMemo(()=>best&&!best.card.price?localEstimate(best.card,localCards,market):null,[best?.card.id,best?.card.price?.amount,localCards,market]);
  const {displayCard,estimate,priceStatus,checking}=useScannerPrice(best?.card??null,local,market);
  const resultCallback=useRef(onResult);resultCallback.current=onResult;
  useEffect(()=>{resultCallback.current?.(displayCard?{card:displayCard,estimate,priceStatus}:null);},[displayCard,estimate,priceStatus]);
  const pickPhoto=async()=>{try{const value=await launchImageLibraryAsync({mediaTypes:['images'],quality:.9,allowsEditing:false});if(value.canceled)return;const image=await Images.loadFromFileAsync(decodeURIComponent(value.assets[0].uri.replace(/^file:\/\//,'')));resetScene();setSelectedPhoto(image);}catch(e){onGalleryError?.(`사진을 열지 못했습니다. ${String(e)}`);}};
  return <View style={fullScreen?{flex:1}:undefined}>
    <View style={[styles.preview,fullScreen&&{flex:1,aspectRatio:undefined,borderRadius:0}]}>
      <ScannerCamera nativeID="tcgindex-camera-preview" ref={camera} style={StyleSheet.absoluteFill} device="back" isActive={active&&!selectedPhoto} outputs={OUTPUTS} orientationSource="interface" resizeMode="cover" implementationMode={Platform.OS==='android'?'compatible':undefined}
        onLayout={event=>setLayout(event.nativeEvent.layout)} onPreviewStarted={()=>{setStreaming(true);setPhase('가이드 안에 카드 전체를 맞춰 주세요');}} onPreviewStopped={()=>setStreaming(false)} enableNativeTapToFocusGesture onError={error=>{if(!isInactiveCameraError(error))onError(`카메라 오류: ${error.message.split('\n')[0].slice(0,180)}`);}}/>
      {selectedPhoto&&<NitroImage image={selectedPhoto} style={StyleSheet.absoluteFill} resizeMode="cover"/>}
      {!streaming&&!selectedPhoto&&<View pointerEvents="none" style={[StyleSheet.absoluteFill,{alignItems:'center',justifyContent:'center',gap:12}]}><ActivityIndicator size="large" color="#ff2638"/><Text accessibilityLiveRegion="polite" style={{color:'#fff',fontSize:16}}>카메라를 준비하고 있어요</Text></View>}
      <CardOutline live={!selectedPhoto} quad={quad} width={layout.width} height={layout.height} confirmed={!!reading?.stable&&currentBest?.card.id===best?.card.id}/>
      {!show&&!similarCards.length&&!checking&&<Text accessibilityLiveRegion="polite" style={[styles.guideLabel,fullScreen&&{top:154,bottom:undefined,padding:7,fontSize:12}]}>{status||similarStatus||(quad?'카드를 확인하고 있어요':'가이드 안에 카드 전체를 맞춰 주세요')}</Text>}
      {show&&best&&displayCard&&<ScanResultToast card={displayCard} estimate={estimate} priceStatus={priceStatus} fullScreen={fullScreen} onPress={()=>onOpenCard?onOpenCard(best.card.href,best.card.id,best.card.number,best.card.game,market,best.card.name):void Linking.openURL(new URL(best.card.href,API_BASE).toString())}/>}
      {!show&&similarCards.length>0&&<SimilarCardsToast cards={similarCards} market={market} bottom={82} onPress={card=>onOpenCard?.(card.href,card.id,card.number,card.game,market,card.name)}/>}
      {checking&&<ScannerLoadingBar progress={{stage:'pricing',completedBytes:0,totalBytes:0}}/>}
      {fullScreen&&<><View style={styles.zoom}>{[1,2,3].map(value=><Pressable key={value} accessibilityLabel={`${value}배 확대`} onPress={()=>{setZoom(value);resetScene();}} style={[styles.zoomButton,zoom===value&&{backgroundColor:'#ff2638'}]}><Text style={{fontWeight:'700',color:zoom===value?'#fff':'#fff'}}>{value}×</Text></Pressable>)}</View><Pressable accessibilityLabel={selectedPhoto?'카메라로 돌아가기':'사진 선택'} onPress={()=>selectedPhoto?(resetScene(),setSelectedPhoto(null)):void pickPhoto()} style={styles.gallery}><InterfaceIcon name={selectedPhoto?'camera':'image'} color="#fff" size={26}/></Pressable></>}
      {fullScreen&&diagnostics&&<View pointerEvents="none" style={styles.diagnostics}>
        <Text numberOfLines={1} style={{color:'#a6a6a6',fontSize:9}}>분석 {attempts}회 · 추적 {Math.round(detection.ms)}ms · {reading?`처리 ${Math.round(reading.processingMs)}ms · OCR ${Math.round(reading.ocrMs)}ms`:'카드 확인 중'}</Text>
      </View>}
    </View>
    {!fullScreen&&diagnostics&&<Text style={styles.metrics}>{reading?`분석 ${reading.samples}회 · 처리 ${Math.round(reading.processingMs)}ms · OCR ${Math.round(reading.ocrMs)}ms · 추론 ${Math.round(reading.inferenceMs)}ms`:streaming?'카드 테두리를 찾고 있습니다…':'카메라를 시작하고 있습니다…'}</Text>}
    {!fullScreen&&diagnostics&&reading&&<Text style={styles.resultMeta}>번호 OCR: {reading.ocrText.replace(/\s+/g,' ').slice(0,140)||'아직 읽지 못했습니다'}</Text>}
    {!fullScreen&&diagnostics&&inspection&&<View style={styles.inspection}><NitroImage image={inspection} resizeMode="stretch" style={styles.inspectionImage}/><View style={{flex:1}}><Text style={styles.resultTitle}>실제 비교 영역</Text><Text style={styles.resultMeta}>검출한 카드의 원근을 보정한 영상입니다.</Text></View></View>}
    {!fullScreen&&diagnostics&&currentBest&&!show&&<Text style={styles.resultMeta}>후보 {currentBest.card.number} · 유사도 {(currentBest.score*100).toFixed(1)} · {currentBest.accepted?'연속 확인 중':'그림 확인 중'}</Text>}
  </View>;
}
const styles=StyleSheet.create({
  preview:{width:'100%',aspectRatio:1,backgroundColor:'#090909',borderRadius:20,overflow:'hidden'},
  guideLabel:{position:'absolute',bottom:60,left:24,right:24,textAlign:'center',color:'#fff',fontSize:14,backgroundColor:'#151515bb',padding:12,borderRadius:8},
  overlay:{position:'absolute',bottom:10,left:10,right:10,backgroundColor:'#151515e8',borderRadius:12,padding:12},
  resultTitle:{color:'#f5f5f5',fontWeight:'700',fontSize:15},resultMeta:{color:'#a6a6a6',fontSize:12,marginTop:5},price:{color:'#f5f5f5',fontSize:17,fontWeight:'700',marginTop:7},
  metrics:{color:'#f5f5f5',fontSize:12,marginTop:12},inspection:{flexDirection:'row',gap:12,alignItems:'center',marginTop:12},inspectionImage:{width:90,height:90,borderRadius:5,backgroundColor:'#090909'},
  diagnostics:{position:'absolute',bottom:0,left:12,right:12,paddingHorizontal:5,paddingVertical:2,borderRadius:5,backgroundColor:'#15151599'},
  zoom:{position:'absolute',bottom:26,alignSelf:'center',flexDirection:'row',gap:2,padding:4,borderRadius:22,backgroundColor:'#151515bb'},zoomButton:{height:30,width:28,alignItems:'center',justifyContent:'center',borderRadius:16},gallery:{position:'absolute',bottom:18,left:18,width:46,height:46,borderRadius:24,backgroundColor:'#151515dd',alignItems:'center',justifyContent:'center'},
  thumbnail:{width:58,height:82,resizeMode:'contain',backgroundColor:'#fff',borderRadius:5},link:{color:'#f5f5f5',fontSize:13},
});
