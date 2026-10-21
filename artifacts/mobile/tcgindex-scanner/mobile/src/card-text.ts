import {NitroModules,type HybridObject} from 'react-native-nitro-modules';
import { NativeModules } from 'react-native';
import {cardQuad, type CardQuad} from './card-detection';

const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
function base64(bytes: Uint8Array): string {
  const parts: string[] = [];
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i], b = bytes[i + 1] ?? 0, c = bytes[i + 2] ?? 0;
    parts.push(alphabet[a >> 2] + alphabet[((a & 3) << 4) | (b >> 4)] +
      (i + 1 < bytes.length ? alphabet[((b & 15) << 2) | (c >> 6)] : '=') +
      (i + 2 < bytes.length ? alphabet[c & 63] : '='));
  }
  return parts.join('');
}

export async function readCardText(jpeg: ArrayBuffer): Promise<string> {
  const module = NativeModules.TCGCardText as { recognizeImage(image: string): Promise<string> } | undefined;
  if (!module) throw new Error('카드 번호 OCR 모듈이 설치되지 않았습니다. 최신 APK를 설치해 주세요.');
  return module.recognizeImage(base64(new Uint8Array(jpeg)));
}

interface NativeInputs extends HybridObject<{ios:'c++'}> { read(token:string):ArrayBuffer; }
let nativeInputs:NativeInputs|undefined;
function nativePixels(token:string):Float32Array {
 nativeInputs??=NitroModules.createHybridObject<NativeInputs>('TCGNativeInputs');
 return new Float32Array(nativeInputs.read(token));
}
export type Detection = { pixels?:Float32Array; corners: CardQuad; rgb?: string; footer?: string; detectionMs: number;frameAt?:number;session?:number;clear:boolean;tracked:boolean;source:'guide'|'edge'|'tracked';alternatives?:Detection[] };
export type DetectionHint={guide:CardQuad;previous:CardQuad|null;redetect:boolean;searchBorders:boolean};
type NativeDetection={inputToken?:string;frameAt?:number;session?:number;corners?:unknown;rgb?:string;footer?:string;detectionMs:number;clear?:boolean;tracked?:boolean;source?:string;candidates?:NativeDetection[]};
function parseDetection(result:NativeDetection,includeImage:boolean):Detection|null {
  if(!result)return null;
  if(result.candidates){const regions=result.candidates.slice(0,4).map(c=>parseDetection({...c,detectionMs:result.detectionMs,frameAt:result.frameAt,session:result.session,candidates:undefined},includeImage)).filter((c):c is Detection=>!!c);return regions.length?{...regions[0],alternatives:regions.slice(1)}:null;}
  const corners=cardQuad(result.corners);
  if(!corners)return null;
  if(includeImage&&(!(result.rgb||result.inputToken)||!result.footer))throw new Error('카드 비교 이미지를 만들지 못했습니다.');
  return {corners,pixels:result.inputToken?nativePixels(result.inputToken):undefined,frameAt:result.frameAt,session:result.session,rgb:result.rgb,footer:result.footer,detectionMs:result.detectionMs,clear:result.clear===true,tracked:result.tracked===true,source:result.source==='guide'?'guide':result.tracked?'tracked':'edge'};
}
export async function captureCardPreview(includeImage:boolean,hint:DetectionHint):Promise<Detection|null>{
  return parseDetection(await NativeModules.TCGCardText.capturePreview(includeImage,JSON.stringify(hint)),includeImage);
}
export async function detectCard(jpeg: ArrayBuffer,includeImage:boolean,hint:DetectionHint): Promise<Detection | null> {
  const module = NativeModules.TCGCardText as {detectCard(image:string,includeImage:boolean,hint:string):Promise<{corners:unknown;rgb?:string;footer?:string;detectionMs:number;clear?:boolean;tracked?:boolean}>} | undefined;
  if (!module?.detectCard) throw new Error('카드 테두리 모듈이 설치되지 않았습니다. 최신 앱을 설치해 주세요.');
  const result = await module.detectCard(base64(new Uint8Array(jpeg)),includeImage,JSON.stringify(hint));
  return parseDetection(result,includeImage);
}

export async function readCardFooter(encoded: string): Promise<string> {
  return NativeModules.TCGCardText.recognizeImage(encoded);
}
