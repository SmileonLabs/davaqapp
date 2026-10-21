import {Text} from './app/Localized';
import React, {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {DeviceEventEmitter, NativeEventEmitter, Linking, Platform, Pressable, StyleSheet, Vibration, View} from 'react-native';
import {Camera,type CameraOutput} from 'react-native-vision-camera';
import {NitroModules} from 'react-native-nitro-modules';
import {Images, NitroImage, type Image as AnalysisImage} from 'react-native-nitro-image';
import {launchImageLibraryAsync} from 'expo-image-picker';
import type {CardScanner} from '../native-scanner/CardScanner.nitro';
import {CardOutline} from './CardOutline';
import {ScanResultToast} from './ScanResultToast';
import {SimilarCardsToast} from './SimilarCardsToast';
import {InterfaceIcon} from './app/InterfaceIcon';
import {ScannerLoadingBar} from './app/ScannerLoadingBar';
import {nativeVision, NATIVE_VISION_EVENT, type NativeVisionEvent} from './app/native-vision';
import {useScannerCameraSession} from './app/useScannerCameraSession';
import {useVisualScannerLibrary} from './app/useVisualScannerLibrary';
import {useCompactScannerLibrary} from './app/useCompactScannerLibrary';
import {nextScannerResults, type ScannerResults} from './compact-library';
import {localEstimate, localMarketCard, type LocalEstimate} from './scanner-library';
import type {Card} from './scanner';
import {useScannerPrice} from './app/useScannerPrice';
import type {ScannerResult} from './scanner-live-price';

type Props = {
  game: string;
  market: string;
  language: string;
  syncKey: number;
  diagnostics?: boolean;
  onError: (message: string) => void;
  onResult: (value: ScannerResult | null) => void;
  onOpenCard: (href: string, id?: string, number?: string, game?: string, market?: string, name?: string) => void;
};

export function NativeLiveScannerAndroid({game, market, language, syncKey, diagnostics, onError, onResult, onOpenCard}: Props) {
  const [layout, setLayout] = useState({width: 0, height: 0});
  const [reading, setReading] = useState<NativeVisionEvent | null>(null);
  const [photoRevision,setPhotoRevision]=useState(0);
  const [recognitionRevision,setRecognitionRevision]=useState(0);
  const [results, setResults] = useState<ScannerResults>({card: null, comparables: [], similar: []});
  const [zoom, setZoom] = useState(1);
  const [photo, setPhoto] = useState<AnalysisImage | null>(null);
  const [photoPath, setPhotoPath] = useState('');
  const start = useRef(Date.now());
  const lastHaptic = useRef('');
  const alive = useRef(true);
  const photoRequest = useRef(0);
  const callbacks = useRef({onError, onResult});
  callbacks.current = {onError, onResult};

  const compact = useCompactScannerLibrary(game, language, syncKey, onError);
  const {data, cards, cardMap, ready: legacyReady, setReady,progress:legacyProgress} = useVisualScannerLibrary(game, language, syncKey, onError, compact.fallback);
  const ready = compact.fallback ? legacyReady : compact.ready;
  const session = useScannerCameraSession(photoPath, zoom, onError, ready>0);
  const output = useMemo(() => Platform.OS==='ios'
    ? NitroModules.createHybridObject<CameraOutput>('TCGNativeCameraOutput')
    : NitroModules.createHybridObject<CardScanner>('CardScanner').createOutput(), []);
  const outputs = useMemo(() => [output], [output]);
  const runtime = useRef({cardMap, ready, fallback: compact.fallback, receiveFrames: session.receiveFrames});
  runtime.current = {cardMap, ready, fallback: compact.fallback, receiveFrames: session.receiveFrames};

  useEffect(() => { nativeVision.setViewport(layout.width, layout.height); }, [layout.width, layout.height]);
  useEffect(() => () => output.dispose(), [output]);
  useEffect(() => () => photo?.dispose(), [photo]);
  useEffect(() => {
    alive.current = true;
    return () => {alive.current = false; photoRequest.current++;};
  }, []);

  useEffect(() => {
    setResults({card: null, comparables: [], similar: []});
    setReading(null);
    lastHaptic.current = '';
    start.current = Date.now();
  }, [game, language]);

  useEffect(() => {
    if (results.card && lastHaptic.current !== results.card.id) {
      lastHaptic.current = results.card.id;
      Vibration.vibrate(35);
    }
  }, [results.card?.id]);

  const receive = useCallback((event: NativeVisionEvent, fromPhoto = false) => {
    const state = runtime.current;
    if (!fromPhoto) {
      if (state.fallback && event.ready > 0) setReady(event.ready);
      state.receiveFrames(event.frames);
    }
    if (event.message) {callbacks.current.onError(event.message); return;}
    setReading(event);
    const showSimilar = fromPhoto || (event.searched && state.ready > 0 && Date.now() - start.current > 3500);
    setResults(previous => nextScannerResults(previous, event, state.fallback ? state.cardMap : undefined, showSimilar));
  }, [setReady]);

  useEffect(() => {
    // RCTEventEmitter starts native delivery only after addListener is called.
    const emitter = Platform.OS === 'ios' ? new NativeEventEmitter(nativeVision) : DeviceEventEmitter;
    const subscription = emitter.addListener(NATIVE_VISION_EVENT, (event: NativeVisionEvent) => receive(event));
    return () => subscription.remove();
  }, [receive]);

  useEffect(() => {
    if (!photoPath || !ready || !layout.width) return;
    let canceled = false;
    void nativeVision.analyzePhoto(photoPath, layout.width, layout.height).then(event => {
      if (canceled) return;
      if(event.confirmed)setRecognitionRevision(value=>value+1);
      receive(event, true);
    }).catch(error => { if (!canceled) callbacks.current.onError(String(error)); });
    return () => { canceled = true; };
  }, [photoPath, photoRevision, ready, layout.width, layout.height, receive]);

  const rawCard = useMemo(() => results.card ? localMarketCard(results.card,market) : null, [results.card, market]);
  const localCards = useMemo(() => compact.fallback ? cards.map(value => value.card) : results.comparables, [cards, results.comparables, compact.fallback]);
  const local = useMemo(() => rawCard && !rawCard.price ? localEstimate(rawCard, localCards, market) : null, [rawCard, localCards, market]);
  const {displayCard:card,estimate,priceStatus,checking} = useScannerPrice(rawCard,local,market,compact.dataVersion+':'+syncKey,recognitionRevision);
  useEffect(() => { callbacks.current.onResult(card ? {card, estimate,priceStatus} : null); }, [card, estimate,priceStatus]);

  const open = (value: Card) => onOpenCard(value.href, value.id, value.number, value.game, market, value.name);
  const pick = async () => {
    const request = ++photoRequest.current;
    try {
      const value = await launchImageLibraryAsync({mediaTypes: ['images'], quality: 1, allowsEditing: false});
      if (value.canceled || !alive.current || request !== photoRequest.current) return;
      const path = decodeURIComponent(value.assets[0].uri.replace(/^file:\/\//, ''));
      const image = await Images.loadFromFileAsync(path);
      if (!alive.current || request !== photoRequest.current) {image.dispose(); return;}
      setResults({card:null,comparables:[],similar:[]});
      setReading(null);
      setPhotoRevision(value=>value+1);
      setPhoto(image);
      setPhotoPath(path);
      start.current = Date.now();
    } catch (error) {if (alive.current && request === photoRequest.current) callbacks.current.onError(String(error));}
  };
  const resultBottom = 82;
  const similarCards = results.similar.map(value=>localMarketCard(value,market));

  return (
    <View style={styles.screen} onLayout={event => setLayout(event.nativeEvent.layout)}>
      {session.mounted && (
        <Camera
          key={session.key}
          ref={session.camera}
          device="back"
          isActive={session.active && !photoPath}
          outputs={outputs}
          style={StyleSheet.absoluteFill}
          resizeMode="cover"
          orientationSource="interface"
          implementationMode={Platform.OS==='android'?'compatible':undefined}
          enableNativeTapToFocusGesture
          onStarted={session.onStarted}
          onStopped={session.onStopped}
          onError={session.onCameraError}
        />
      )}
      {photo && <NitroImage image={photo} resizeMode="contain" style={StyleSheet.absoluteFill} />}
      <CardOutline quad={null} width={layout.width} height={layout.height} confirmed={false} />

      {!!session.status && (
        <View style={styles.guide}>
          <Text style={styles.status}>{session.status}</Text>
          {session.canRetry && (
            <View style={styles.recoveryActions}>
              <Pressable onPress={session.retry}><Text style={styles.metric}>다시 시도</Text></Pressable>
              <Pressable onPress={() => void Linking.openSettings()}><Text style={styles.metric}>권한 설정</Text></Pressable>
            </View>
          )}
        </View>
      )}
      {!session.status && !compact.progress && !legacyProgress && !card && !similarCards.length && (
        <Text style={styles.guide}>{!ready ? (compact.fallback ? data.status : compact.status) || '저장된 카드 데이터를 열고 있어요' : photoPath ? reading?.searched ? '판독 미확정 · 카드 번호와 그림이 선명한 사진으로 다시 확인해 주세요' : '사진을 분석하고 있어요' : '가이드 안에 카드 전체를 비춰 주세요'}</Text>
      )}
      <ScannerLoadingBar progress={(compact.fallback?legacyProgress:compact.progress)??(checking?{stage:'pricing',completedBytes:0,totalBytes:0}:null)}/>
      {card && <ScanResultToast card={card} estimate={estimate} priceStatus={priceStatus} fullScreen onPress={() => open(card)} />}
      {!card && similarCards.length > 0 && <SimilarCardsToast cards={similarCards} market={market} bottom={resultBottom} onPress={open} />}

      <View style={styles.zoom}>
        {[1, 2, 3].map(value => (
          <Pressable key={value} accessibilityLabel={`${value}배 확대`} onPress={() => setZoom(value)} style={[styles.zoomButton, zoom === value && styles.zoomSelected]}>
            <Text style={[styles.zoomLabel, zoom === value && styles.zoomLabelSelected]}>{value}×</Text>
          </Pressable>
        ))}
      </View>
      <Pressable
        accessibilityLabel={photo ? '카메라로 돌아가기' : '사진 선택'}
        style={styles.gallery}
        onPress={() => {if (photo) {photoRequest.current++; setPhoto(null); setPhotoPath('');} else void pick();}}
      >
        <InterfaceIcon name={photo ? 'camera' : 'image'} color="#fff" size={26} />
      </Pressable>

      {diagnostics && (
        <View style={styles.diagnostics} pointerEvents="none">
          <Text numberOfLines={1} style={styles.note}>{(compact.fallback ? data.status : compact.status) || `${ready.toLocaleString('ko-KR')}장 · 프레임 ${reading?.frames ?? 0} · 처리 ${Math.round(reading?.processingMs ?? 0)}ms · 추적 ${Math.round(reading?.trackingMs ?? 0)}ms · OCR ${Math.round(reading?.ocrMs??0)}ms`}</Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {flex: 1, backgroundColor: '#090909'},
  guide: {position: 'absolute', top: 154, left: 24, right: 24, textAlign: 'center', color: '#fff', fontSize: 12, backgroundColor: '#151515bb', padding: 7, borderRadius: 8},
  status: {color: '#fff', textAlign: 'center'},
  recoveryActions: {flexDirection: 'row', justifyContent: 'center', gap: 20, marginTop: 12},
  zoom: {position: 'absolute', bottom: 26, alignSelf: 'center', flexDirection: 'row', gap: 2, padding: 4, borderRadius: 22, backgroundColor: '#151515bb'},
  zoomButton: {height: 30, width: 28, alignItems: 'center', justifyContent: 'center', borderRadius: 16},
  zoomSelected: {backgroundColor: '#ff2638'},
  zoomLabel: {color: '#fff', fontWeight: '800', fontSize: 12},
  zoomLabelSelected: {color: '#ffffff'},
  gallery: {position: 'absolute', bottom: 18, left: 18, width: 46, height: 46, borderRadius: 24, backgroundColor: '#151515dd', alignItems: 'center', justifyContent: 'center'},
  diagnostics: {position: 'absolute', bottom: 0, left: 12, right: 12, paddingHorizontal: 5, paddingVertical: 2, borderRadius: 5, backgroundColor: '#15151599'},
  metric: {color: '#f5f5f5', fontSize: 12},
  note: {color: '#a6a6a6', fontSize: 9},
});
