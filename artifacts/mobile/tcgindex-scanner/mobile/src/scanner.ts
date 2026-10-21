export const INPUT_SIZE = 224;
export const PREVIEW_SIZE = 320;
export const GUIDE = { left: 0.185, top: 0.06, width: 0.63, height: 0.88 };
export const MIN_SCORE = 0.88;
export const MIN_MARGIN = 0.035;
export const STABLE_FRAMES = 3;

export type Card = {
  id: string; name: string; number: string; language: string; game?: string;
  image: string; pixels: string; href: string;
  price: null | { amount: number; currency: string; type: string; source: string; observedAt: string };
  setCode?: string; setName?: string; rarity?: string; finish?: string; artworkSpecific?: boolean;
  prices?: NonNullable<Card['price']>[];
  valuations?: {amount:number;low:number;high:number;currency:string;sourceCurrency?:string;converted?:boolean;priceType?:string;referenceKind?:'other_printing';sourceLanguage?:string;sourceNumber?:string;observedAt:string;source:string;count:number;method:'ai'|'market_reference'|'catalog_reference'}[];
  matchLevel?: 'printing'|'card'; referenceId?: string;
  referenceThumbnail?: {image:string;href:string;name:string};
};
export type Reference = { card: Card; vector: number[]; artVector?: number[]; artDescriptor?: number[] };
export type Match = { card: Card; score: number; margin: number; accepted: boolean; method?: 'embedding' | 'artwork' | 'number'; modelScore?: number };
export type Stability = { id: string | null; count: number; startedAt: number; lastAt: number; confirmedAt: number };
export const emptyStability = (): Stability => ({ id: null, count: 0, startedAt: 0, lastAt: 0, confirmedAt: 0 });

export function normalizePixels(bytes: Uint8Array): Float32Array {
  'worklet';
  if (bytes.length !== INPUT_SIZE * INPUT_SIZE * 3) throw new Error('기준 이미지 크기가 맞지 않습니다.');
  // The bundled model's TFLITE_METADATA specifies mean=0, std=255.
  const input = new Float32Array(bytes.length);
  for (let i = 0; i < bytes.length; i++) input[i] = bytes[i]! / 255;
  return input;
}

export function cropCameraPixels(bytes: Uint8Array): Float32Array {
  'worklet';
  if (bytes.length !== PREVIEW_SIZE * PREVIEW_SIZE * 3) throw new Error('카메라 RGB 크기가 맞지 않습니다.');
  const input = new Float32Array(INPUT_SIZE * INPUT_SIZE * 3);
  for (let y = 0; y < INPUT_SIZE; y++) {
    const sy = Math.min(PREVIEW_SIZE - 1, Math.floor((GUIDE.top + ((y + 0.5) / INPUT_SIZE) * GUIDE.height) * PREVIEW_SIZE));
    for (let x = 0; x < INPUT_SIZE; x++) {
      const sx = Math.min(PREVIEW_SIZE - 1, Math.floor((GUIDE.left + ((x + 0.5) / INPUT_SIZE) * GUIDE.width) * PREVIEW_SIZE));
      const source = (sy * PREVIEW_SIZE + sx) * 3;
      const target = (y * INPUT_SIZE + x) * 3;
      input[target] = bytes[source]! / 255;
      input[target + 1] = bytes[source + 1]! / 255;
      input[target + 2] = bytes[source + 2]! / 255;
    }
  }
  return input;
}

export function cropRgbaPixels(bytes: Uint8Array, width: number, height: number, bytesPerRow: number,
  corners: readonly { x: number; y: number }[]): Float32Array {
  'worklet';
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0 ||
      !Number.isInteger(bytesPerRow) || bytesPerRow < width * 4 || bytes.length < (height - 1) * bytesPerRow + width * 4) {
    throw new Error('카메라 RGBA 크기가 맞지 않습니다.');
  }
  if (corners.length !== 4 || !corners.every((p) => Number.isFinite(p.x) && Number.isFinite(p.y))) throw new Error('카메라 가이드 좌표가 올바르지 않습니다.');
  const [tl, tr, bl, br] = corners as readonly [{x:number;y:number},{x:number;y:number},{x:number;y:number},{x:number;y:number}];
  const left = Math.min(tl.x, tr.x, bl.x, br.x), right = Math.max(tl.x, tr.x, bl.x, br.x);
  const top = Math.min(tl.y, tr.y, bl.y, br.y), bottom = Math.max(tl.y, tr.y, bl.y, br.y);
  if (Math.min(width, right) <= Math.max(0, left) || Math.min(height, bottom) <= Math.max(0, top)) throw new Error('카메라 가이드가 분석 영상 밖에 있습니다.');
  const input = new Float32Array(INPUT_SIZE * INPUT_SIZE * 3);
  for (let y = 0; y < INPUT_SIZE; y++) {
    const v = (y + 0.5) / INPUT_SIZE;
    const lx = tl.x + v * (bl.x - tl.x), ly = tl.y + v * (bl.y - tl.y);
    const rx = tr.x + v * (br.x - tr.x), ry = tr.y + v * (br.y - tr.y);
    for (let x = 0; x < INPUT_SIZE; x++) {
      const u = (x + 0.5) / INPUT_SIZE;
      // Following TL/TR/BL/BR makes the crop upright even when the sensor buffer is sideways.
      const sx = Math.max(0, Math.min(width - 1, Math.floor(lx + u * (rx - lx))));
      const sy = Math.max(0, Math.min(height - 1, Math.floor(ly + u * (ry - ly))));
      const source = sy * bytesPerRow + sx * 4, target = (y * INPUT_SIZE + x) * 3;
      // CameraX OUTPUT_IMAGE_FORMAT_RGBA_8888 has one R,G,B,A plane, including row padding.
      input[target] = bytes[source]! / 255;
      input[target + 1] = bytes[source + 1]! / 255;
      input[target + 2] = bytes[source + 2]! / 255;
    }
  }
  return input;
}

export function inputToRgba(input: Float32Array): Uint8Array {
  if (input.length !== INPUT_SIZE * INPUT_SIZE * 3) throw new Error('분석 이미지 크기가 맞지 않습니다.');
  const rgba = new Uint8Array(INPUT_SIZE * INPUT_SIZE * 4);
  for (let source = 0, target = 0; source < input.length; source += 3, target += 4) {
    rgba[target] = Math.round(input[source]! * 255);
    rgba[target + 1] = Math.round(input[source + 1]! * 255);
    rgba[target + 2] = Math.round(input[source + 2]! * 255);
    rgba[target + 3] = 255;
  }
  return rgba;
}

export const OCR_WIDTH = 512, OCR_HEIGHT = 256;
export function cropRgbaForOcr(bytes: Uint8Array, width: number, height: number, bytesPerRow: number,
  corners: readonly { x: number; y: number }[]): Uint8Array {
  'worklet';
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0 ||
      !Number.isInteger(bytesPerRow) || bytesPerRow < width * 4 || bytes.length < (height - 1) * bytesPerRow + width * 4 ||
      corners.length !== 4 || !corners.every(p => Number.isFinite(p.x) && Number.isFinite(p.y))) throw new Error('카메라 번호 영역이 올바르지 않습니다.');
  const [tl, tr, bl, br] = corners as readonly [{x:number;y:number},{x:number;y:number},{x:number;y:number},{x:number;y:number}];
  const result = new Uint8Array(OCR_WIDTH * OCR_HEIGHT * 4).fill(255);
  // The card may occupy only part of the guide. Include the lower 40%, rather
  // than cutting off a collector number above the guide's last 14%.
  // Preserve the sensor-space aspect ratio so narrow digits aren't stretched.
  const spanWidth = (Math.hypot(tr.x - tl.x, tr.y - tl.y) + Math.hypot(br.x - bl.x, br.y - bl.y)) * 0.48;
  const spanHeight = (Math.hypot(bl.x - tl.x, bl.y - tl.y) + Math.hypot(br.x - tr.x, br.y - tr.y)) * 0.20;
  if (!(spanWidth > 0 && spanHeight > 0)) throw new Error('번호 영역 좌표가 올바르지 않습니다.');
  const scale = Math.min(OCR_WIDTH / spanWidth, OCR_HEIGHT / spanHeight);
  const contentWidth = Math.max(1, Math.round(spanWidth * scale)), contentHeight = Math.max(1, Math.round(spanHeight * scale));
  const offsetX = Math.floor((OCR_WIDTH - contentWidth) / 2), offsetY = Math.floor((OCR_HEIGHT - contentHeight) / 2);
  for (let y = 0; y < contentHeight; y++) {
    const v = 0.60 + 0.40 * (y + 0.5) / contentHeight;
    const lx = tl.x + v * (bl.x - tl.x), ly = tl.y + v * (bl.y - tl.y);
    const rx = tr.x + v * (br.x - tr.x), ry = tr.y + v * (br.y - tr.y);
    for (let x = 0; x < contentWidth; x++) {
      const u = 0.02 + 0.96 * (x + 0.5) / contentWidth;
      const sx = Math.max(0, Math.min(width - 1, Math.floor(lx + u * (rx - lx))));
      const sy = Math.max(0, Math.min(height - 1, Math.floor(ly + u * (ry - ly))));
      const source = sy * bytesPerRow + sx * 4, target = ((y + offsetY) * OCR_WIDTH + x + offsetX) * 4;
      result[target] = bytes[source]!; result[target + 1] = bytes[source + 1]!; result[target + 2] = bytes[source + 2]!; result[target + 3] = 255;
    }
  }
  return result;
}

function collectorText(text:string):string {
  // Repair number-shaped tokens only beside an explicit fraction separator.
  return text.normalize('NFKC').toUpperCase().replace(/[⁄∕]/g,'/').replace(/(?<![A-Z0-9])([0-9OILB]{2,3})\s*[/|\-]\s*([0-9OILB]{2,3})/g,(original,a:string,b:string)=>{
    if((a.match(/\d/g)?.length??0)<2||(b.match(/\d/g)?.length??0)<2)return original;
    const digits=(value:string)=>value.replace(/O/g,'0').replace(/[IL]/g,'1').replace(/B/g,'8');
    return `${digits(a)}/${digits(b)}`;
  });
}
function fullCollectorNumbers(upper:string):string[] {
  const pokemon=[...upper.matchAll(/\b((?:SV|SM|XY|BW|DP|S|M)\d{1,2}[A-Z]{0,2}(?:\s*-\s*P)?)\s*-?\s*(\d{1,3})\s*[\/-]\s*(\d{1,3})\b/g)]
    .filter(m=>Number(m[2]!)>0&&Number(m[3]!)>0).map(m=>`${m[1]!.replace(/\s+/g,'')}${m[2]!.padStart(3,'0')}-${m[3]!.padStart(3,'0')}`);
  const riot=[...upper.matchAll(/\b(OGN|SFD|OGS|VEN|UNL)\s*-\s*(\d{3})([A-Z]?)\s*[\/-]\s*(\d{3})(?:\s*-\s*(S))?(?:\s*-\s*(F))?\b/g)]
    .map(m=>`${m[1]}-${m[2]}${m[3]}-${m[4]}${m[5]?'-S':''}${m[6]?'-F':''}`);
  const promos=[...upper.matchAll(/\b(?:PROMO\s*)?(\d{1,4})\s*[\/-]\s*(SV-P|SM-P|XY-P|BW-P|DP-P|L-P|ADV-P|PCG-P|S-P)\b/g)].map(m=>`PROMO${m[1]}-${m[2]}`);
  const englishPromos=[...upper.matchAll(/\b(SWSH|HGSS|SM|XY|BW|DP)\s*-?\s*(\d{1,4})(?!\s*[\/-]\s*[A-Z0-9])\b/g)].filter(m=>!pokemon.some(number=>number.startsWith(`${m[1]}${m[2]}`))).map(m=>`${m[1]}${m[2]}`);
  const onePiece=[...upper.matchAll(/\b((?:(?:OP|ST|EB|PRB)\d{2}|P))\s*[-/]\s*(\d{3})(?!\d)/g)].map(m=>`${m[1]}-${m[2]}`);
  const yugioh=[...upper.matchAll(/\b((?:RD\s*\/\s*)?[A-Z0-9]{2,8})\s*-\s*((?:KR|JP|EN|AE|DE|FR|IT|SP|PT|K|E|J|S)(?:\d{3}|S\d{2}))\b/g)].map(m=>`${m[1]!.replace(/\s+/g,'')}-${m[2]}`);
  return [...new Set([...pokemon,...riot,...promos,...englishPromos,...onePiece,...yugioh])];
}

/** Title lookup only widens the visual shortlist; it never confirms a printing. */
export function matchCardNames(text:string,references:readonly Reference[]):Reference[]{
 if(!text.trim())return [];
 const normalize=(s:string)=>s.normalize('NFKC').toUpperCase().replace(/[^\p{L}\p{N}]/gu,'');
 const seen=normalize(text);
 return references.filter(r=>r.card.name.split(' // ').some(name=>{
  const title=normalize(name),native=/[가-힣ぁ-ヿ一-鿿]/.test(title);
  if(title.length<(native?2:3)||!seen.includes(title))return false;
  return native||new RegExp('(?<![A-Z0-9])'+name.normalize('NFKC').toUpperCase().replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+'(?![A-Z0-9])').test(text.normalize('NFKC').toUpperCase());
 })).slice(0,8);
}
// A complete printed code may replace a passcode, or be assembled from complete metadata fields.
export function scannerCardNumber(card:Pick<Card,'number'|'game'|'setCode'>):string {
  const set=collectorText(card.setCode??'').replace(/\s+/g,'');
  if(card.game==='yugioh'){
    if(/^(?:RD\/)?[A-Z0-9]{2,8}-(?:KR|JP|EN|AE|DE|FR|IT|SP|PT|K|E|J|S)(?:\d{3}|S\d{2})$/.test(set))return set;
    if(/^\d{3}$/.test(card.number)&&/^(?:RD\/)?[A-Z0-9]{2,8}-(?:KR|JP|EN|AE|DE|FR|IT|SP|PT|K|E|J|S)$/.test(set))return set+card.number;
  }
  return card.number;
}
export function scannerMarketName(name:string,market:string){return market!=='KR'&&/이야후\s*ex/i.test(name)?'Munkidori ex':name;}
export function scannerLookupNumber(text:string):string|null {
  const upper=collectorText(text),full=fullCollectorNumbers(upper);
  // Printed set+collector IDs outrank commemorative numbers elsewhere on a card.
  if(full.length)return full.length===1?full[0]!:null;
  const fractions=[...upper.matchAll(/(?:^|[^0-9])(\d{1,3})\s*[\/-]\s*(\d{1,3})\b/g)].filter(m=>Number(m[1]!)>0&&Number(m[2]!)>0);
  const unique=[...new Set(fractions.map(m=>`${m[1]!.padStart(3,'0')}-${m[2]!.padStart(3,'0')}`))];
  return unique.length===1?unique[0]!:null;
}
export function matchCardNumber(text: string, references: readonly Reference[]): Reference | null {
  const upper = collectorText(text);
  const full=fullCollectorNumbers(upper);
  if(full.length){
    if(full.length!==1)return null;
    const found=references.filter(r=>fullCollectorNumbers(collectorText(scannerCardNumber(r.card))).includes(full[0]!));
    return found.length===1?found[0]!:null;
  }
  const fractions = [...upper.matchAll(/(?:^|[^0-9])(\d{1,3})\s*[\/\-]\s*(\d{1,3})\b/g)]
    .filter((m) => Number(m[1]!) > 0 && Number(m[2]!) > 0).map((m) => `${m[1]!.padStart(3, '0')}-${m[2]!.padStart(3, '0')}`);
  const sets = [...upper.matchAll(/\b((?:SV|SM|S|M)\d{1,2}[A-Z]{0,2})(?=\s|\d{3}[\/\-]|$)/g)].map((m) => m[1]!);
  const found = references.filter(({ card }) => {
    const number = /^([A-Z][A-Z0-9]*?)(\d{3})-(\d{3})$/.exec(card.number.toUpperCase());
    if(number)return fractions.includes(`${number[2]!}-${number[3]!}`)&&(!sets.length||sets.includes(number[1]!));
    if(sets.length)return false;
    const fraction=/^(\d{1,3})[\/-](\d{1,3})$/.exec(card.number);
    if(fraction)return fractions.includes(`${fraction[1]!.padStart(3,'0')}-${fraction[2]!.padStart(3,'0')}`);
    return /^\d{1,3}$/.test(card.number)&&fractions.some(f=>f.split('-')[0]===card.number.padStart(3,'0'));
  });
  return found.length === 1 ? found[0]! : null;
}

export const OCR_IMAGE_MIN_SCORE = 0.50;
export function confirmCardNumber(reference: Reference, values: ArrayLike<number>, references: readonly Reference[], alignment: CardAlignment | null,text=''): Match | null {
  // OCR numbers must agree with independent visual evidence. A number alone can
  // belong to another set or be printed on the surrounding webpage.
  const aligned = alignment?.scores[0];
  if (!references.some((r) => r.card.id === reference.card.id) || !alignment || !aligned || aligned.id !== reference.card.id ||
      aligned.score < 0.70 || alignment.margin < ART_MARGIN) return null;
  const named=matchCardNames(text,references),number=scannerLookupNumber(scannerCardNumber(reference.card));
  if(named.length&&!named.some(r=>r.card.id===reference.card.id||number&&scannerLookupNumber(scannerCardNumber(r.card))===number))return null;
  // ImageNet similarity ranks several unrelated cards close together. Verify
  // the uniquely read number's candidate directly; artwork still has to agree.
  const image = findMatches(values, [reference])[0];
  if (!image || image.score < OCR_IMAGE_MIN_SCORE) return null;
  return { ...image, margin: alignment.margin, method: 'number', accepted: true, modelScore: image.score };
}

export function artworkReference(card:Card):Card{
 const valuations=[...(card.valuations??[])];
 for(const price of [...(card.prices??[]),...(card.price?[card.price]:[])])if(Number.isFinite(price.amount)&&price.amount>0){
  valuations.push({amount:price.amount,low:price.amount,high:price.amount,currency:price.currency,observedAt:price.observedAt,source:price.source,count:1,method:'catalog_reference',referenceKind:'other_printing',sourceLanguage:card.language,sourceNumber:card.number});
 }
 return {...card,price:null,prices:[],valuations,matchLevel:'card',artworkSpecific:false};
}

export function confirmImageHint(hint:{id:string;distance:number;margin:number},values:ArrayLike<number>,references:readonly Reference[],alignment:CardAlignment|null):Match|null {
 const reference=references.find(r=>r.card.id===hint.id);
  if(!reference||hint.distance>.34||hint.margin<.02)return null;
 const match=confirmCardNumber(reference,values,references,alignment);
 return match&&match.score>=.60?{...match,method:'artwork'}:null;
}

export function unitVector(values: ArrayLike<number>): number[] {
  let squared = 0;
  for (let i = 0; i < values.length; i++) squared += values[i]! * values[i]!;
  const norm = Math.sqrt(squared);
  if (!values.length || !Number.isFinite(norm) || norm <= 1e-8) throw new Error('모델이 유효한 특징 벡터를 반환하지 않았습니다.');
  return Array.from(values, (v) => v / norm);
}

export function findMatches(values: ArrayLike<number>, references: readonly Reference[]): Match[] {
  const vector = unitVector(values);
  const scores = references.map(({ card, vector: reference }) => {
    if (reference.length !== vector.length) throw new Error('모델과 기준 카드의 특징 벡터 차원이 다릅니다.');
    let score = 0;
    for (let i = 0; i < vector.length; i++) score += vector[i]! * reference[i]!;
    return { card, score: Math.max(-1, Math.min(1, score)) };
  }).sort((a, b) => b.score - a.score);
  return scores.slice(0, 3).map((item, index) => {
    const margin = item.score - (scores[index + 1]!?.score ?? -1);
    return { ...item, margin, accepted: index === 0 && item.score >= MIN_SCORE && margin >= MIN_MARGIN };
  });
}

// Spatial artwork matching tolerates camera blur and missing text, while TFLite
// independently checks the selected picture. Neither proves language or printing.
export type ImageRegion = { left: number; top: number; width: number; height: number };
export const ART_REGION: ImageRegion = { left: 0.08, top: 0.10, width: 0.84, height: 0.55 };
export type CardAlignment = { region: ImageRegion; scores: { id: string; score: number }[]; margin: number };
const DESCRIPTOR_WIDTH = 8, DESCRIPTOR_HEIGHT = 12;
const ART_MARGIN = 0.08, ART_MODEL_SCORE = 0.60, ART_MODEL_MARGIN = 0.05;

function pixelIntegral(input: Float32Array): Float64Array {
  if (input.length !== INPUT_SIZE ** 2 * 3) throw new Error('분석 이미지 크기가 맞지 않습니다.');
  const stride = INPUT_SIZE + 1;
  const sums = new Float64Array(stride ** 2 * 3);
  for (let y = 0; y < INPUT_SIZE; y++) {
    const row = [0, 0, 0];
    for (let x = 0; x < INPUT_SIZE; x++) for (let c = 0; c < 3; c++) {
      row[c]! += input[(y * INPUT_SIZE + x) * 3 + c]!;
      const to = ((y + 1) * stride + x + 1) * 3 + c;
      sums[to] = sums[to - stride * 3]! + row[c]!;
    }
  }
  return sums;
}

function regionDescriptor(sums: Float64Array, region: ImageRegion): number[] | null {
  const stride = INPUT_SIZE + 1, cells = DESCRIPTOR_WIDTH * DESCRIPTOR_HEIGHT;
  const values = new Array<number>(cells * 3), means = [0, 0, 0], norms = [0, 0, 0];
  for (let y = 0; y < DESCRIPTOR_HEIGHT; y++) for (let x = 0; x < DESCRIPTOR_WIDTH; x++) {
    const l = Math.max(0, Math.min(INPUT_SIZE - 1, Math.round((region.left + region.width * x / DESCRIPTOR_WIDTH) * INPUT_SIZE)));
    const r = Math.max(l + 1, Math.min(INPUT_SIZE, Math.round((region.left + region.width * (x + 1) / DESCRIPTOR_WIDTH) * INPUT_SIZE)));
    const t = Math.max(0, Math.min(INPUT_SIZE - 1, Math.round((region.top + region.height * y / DESCRIPTOR_HEIGHT) * INPUT_SIZE)));
    const b = Math.max(t + 1, Math.min(INPUT_SIZE, Math.round((region.top + region.height * (y + 1) / DESCRIPTOR_HEIGHT) * INPUT_SIZE)));
    for (let c = 0; c < 3; c++) {
      const v = (sums[(b * stride + r) * 3 + c]! - sums[(t * stride + r) * 3 + c]! - sums[(b * stride + l) * 3 + c]! + sums[(t * stride + l) * 3 + c]!) / ((r - l) * (b - t));
      values[(y * DESCRIPTOR_WIDTH + x) * 3 + c] = v; means[c]! += v / cells;
    }
  }
  for (let i = 0; i < values.length; i++) { values[i]! -= means[i % 3]!; norms[i % 3]! += values[i]! ** 2; }
  // A blank wall or flat screen has no usable spatial evidence.
  if (norms.some((n) => !Number.isFinite(n) || Math.sqrt(n / cells) < 0.015)) return null;
  for (let i = 0; i < values.length; i++) values[i]! /= Math.sqrt(norms[i % 3]! * 3);
  return values;
}

export function artworkDescriptor(input: Float32Array): number[] | undefined {
  return regionDescriptor(pixelIntegral(input), ART_REGION) ?? undefined;
}

export function cropInputRegion(input: Float32Array, region: ImageRegion): Float32Array {
  if (input.length !== INPUT_SIZE ** 2 * 3 || ![region.left, region.top, region.width, region.height].every(Number.isFinite) || region.width <= 0 || region.height <= 0) throw new Error('그림 영역이 올바르지 않습니다.');
  const result = new Float32Array(input.length);
  for (let y = 0; y < INPUT_SIZE; y++) for (let x = 0; x < INPUT_SIZE; x++) {
    const sx = Math.max(0, Math.min(INPUT_SIZE - 1, (region.left + region.width * (x + 0.5) / INPUT_SIZE) * INPUT_SIZE - 0.5));
    const sy = Math.max(0, Math.min(INPUT_SIZE - 1, (region.top + region.height * (y + 0.5) / INPUT_SIZE) * INPUT_SIZE - 0.5));
    const x0 = Math.floor(sx), y0 = Math.floor(sy), x1 = Math.min(INPUT_SIZE - 1, x0 + 1), y1 = Math.min(INPUT_SIZE - 1, y0 + 1);
    const fx = sx - x0, fy = sy - y0;
    for (let c = 0; c < 3; c++) {
      const top = input[(y0 * INPUT_SIZE + x0) * 3 + c]! * (1 - fx) + input[(y0 * INPUT_SIZE + x1) * 3 + c]! * fx;
      const bottom = input[(y1 * INPUT_SIZE + x0) * 3 + c]! * (1 - fx) + input[(y1 * INPUT_SIZE + x1) * 3 + c]! * fx;
      result[(y * INPUT_SIZE + x) * 3 + c] = top * (1 - fy) + bottom * fy;
    }
  }
  return result;
}

export function findCardAlignment(input: Float32Array, references: readonly Reference[], minimumScore = MIN_SCORE): CardAlignment | null {
  const refs = references.filter((r) => r.artDescriptor?.length === DESCRIPTOR_WIDTH * DESCRIPTOR_HEIGHT * 3);
  if (!refs.length) return null;
  const sums = pixelIntegral(input);
  // Exact image-ID lookup normally prepares one reference. A strong match at
  // the rectified position needs no exhaustive framing search.
  if(refs.length){
    const descriptor=regionDescriptor(sums,ART_REGION);
    if(descriptor){const scores=refs.map(r=>{let score=0;for(let i=0;i<descriptor.length;i++)score+=descriptor[i]!*r.artDescriptor![i]!;return{id:r.card.id,score:Math.min(1,score)};}).sort((a,b)=>b.score-a.score),margin=scores[0]!.score-(scores[1]?.score??-1);
      if(scores[0]!.score>=Math.max(.90,minimumScore)&&margin>=ART_MARGIN)return {region:ART_REGION,scores,margin};
    }
  }
  const best = refs.map((r) => ({ id: r.card.id, score: -1, region: ART_REGION }));
  for (const left of [-0.08, 0, 0.08, 0.16]) for (const width of [0.8, 0.9, 1, 1.1]) {
    if (left + width < 0.75 || left + width > 1.15) continue;
    for (const top of [-0.15, -0.10, -0.05, 0, 0.05]) for (const height of [0.75, 0.85, 0.95, 1, 1.05]) {
      const region = { left: left + width * ART_REGION.left, top: top + height * ART_REGION.top, width: width * ART_REGION.width, height: height * ART_REGION.height };
      const descriptor = regionDescriptor(sums, region);
      if (!descriptor) continue;
      for (let r = 0; r < refs.length; r++) {
        const reference = refs[r]!.artDescriptor!;
        let score = 0;
        for (let i = 0; i < descriptor.length; i++) score += descriptor[i]! * reference[i]!;
        if (score > best[r]!.score) best[r] = { id: refs[r]!.card.id, score: Math.max(-1, Math.min(1, score)), region };
      }
    }
  }
  best.sort((a, b) => b.score - a.score);
  // Refine promising candidates instead of multiplying a dense search by all
  // references. The old 8%-wide position steps missed correctly framed cards.
  for (const item of best.slice(0, 3)) {
    const reference = refs.find((r) => r.card.id === item.id)!.artDescriptor!;
    for (const step of [1, 0.5]) {
      const baseWidth = item.region.width / ART_REGION.width, baseHeight = item.region.height / ART_REGION.height;
      const baseLeft = item.region.left - baseWidth * ART_REGION.left, baseTop = item.region.top - baseHeight * ART_REGION.top;
      for (const dx of [-0.04, 0, 0.04]) for (const dy of [-0.05, 0, 0.05])
        for (const dw of [-0.10, 0, 0.10]) for (const dh of [-0.10, 0, 0.10]) {
          const left = baseLeft + dx * step, top = baseTop + dy * step;
          const width = baseWidth + dw * step, height = baseHeight + dh * step;
          if (left < -0.15 || top < -0.25 || left + width > 1.20 || top + height > 1.20 || width < 0.60 || height < 0.60) continue;
          const region = { left: left + width * ART_REGION.left, top: top + height * ART_REGION.top, width: width * ART_REGION.width, height: height * ART_REGION.height };
          const descriptor = regionDescriptor(sums, region);
          if (!descriptor) continue;
          let score = 0;
          for (let i = 0; i < descriptor.length; i++) score += descriptor[i]! * reference[i]!;
          if (score > item.score) { item.score = Math.max(-1, Math.min(1, score)); item.region = region; }
        }
    }
  }
  best.sort((a, b) => b.score - a.score);
  if (best[0]!.score < minimumScore) return null;
  const margin = best[0]!.score - (best[1]!?.score ?? -1);
  if (margin < ART_MARGIN) return null;
  return { region: best[0]!.region, scores: best.map(({ id, score }) => ({ id, score })), margin };
}

export function findArtworkMatches(values: ArrayLike<number>, references: readonly Reference[], alignment: CardAlignment): Match[] {
  const vector = unitVector(values);
  const matches = alignment.scores.map(({ id, score }) => {
    const reference = references.find((r) => r.card.id === id)!;
    const art = reference.artVector;
    let modelScore = -1;
    if (art?.length === vector.length) { modelScore = 0; for (let i = 0; i < vector.length; i++) modelScore += art[i]! * vector[i]!; }
    return { card: reference.card, score, modelScore };
  });
  const modelBest = [...matches].sort((a, b) => b.modelScore - a.modelScore);
  if (!modelBest.length) return [];
  const modelMargin = modelBest[0]!.modelScore - (modelBest[1]?.modelScore ?? -1);
  return matches.slice(0, 3).map((item, index) => ({ ...item, method: 'artwork', margin: item.score - (matches[index + 1]?.score ?? -1),
    accepted: index === 0 && item.score >= MIN_SCORE && alignment.margin >= ART_MARGIN && item.modelScore >= ART_MODEL_SCORE &&
      modelBest[0]!.card.id === item.card.id && modelMargin >= ART_MODEL_MARGIN }));
}

export function nextStability(previous: Stability, match: Match | undefined, now: number): Stability {
  if (!match?.accepted) return emptyStability();
  const same = previous.id === match.card.id && now - previous.lastAt < 1000;
  const count = same ? previous.count + 1 : 1;
  return { id: match.card.id, count, startedAt: same ? previous.startedAt : now, lastAt: now,
    confirmedAt: count >= STABLE_FRAMES ? (same && previous.confirmedAt ? previous.confirmedAt : now) : 0 };
}

export function parseCatalog(value: unknown): { cards: Card[]; total: number; publishedAt: string } {
  const data = value as { version?: unknown; imageSize?: unknown; cards?: unknown; total?: unknown; publishedAt?: unknown } | null;
  if (!data || data.version !== 1 || data.imageSize !== INPUT_SIZE || !Array.isArray(data.cards) || data.cards.length > 24) throw new Error('지원하지 않는 카드 목록입니다.');
  const ids = new Set<string>();
  const cards = data.cards.map((value: unknown) => {
    const c = value as Card | null;
    if (!c || typeof c.id !== 'string' || !/^kream:[1-9]\d*$/.test(c.id) || ids.has(c.id) ||
          typeof c.name !== 'string' || typeof c.number !== 'string' || !['ko','ja','en'].includes(c.language) ||
        !/^\/api\/scanner\/images\/[0-9a-f]{64}$/.test(c.pixels) ||
        !/^\/market\/images\/kream\/[0-9a-f]{64}$/.test(c.image) ||
        !/^\/market\/(?:kream\/[1-9]\d*|printings\/[a-zA-Z0-9%_-]+)$/.test(c.href)) throw new Error('카드 목록이 올바르지 않습니다.');
    if (c.price !== null && (!c.price || c.price.currency !== 'KRW' || c.price.type !== 'LISTED' || c.price.source !== 'KREAM' ||
        !Number.isSafeInteger(c.price.amount) || c.price.amount <= 0 || !Number.isFinite(Date.parse(c.price.observedAt)))) throw new Error('가격 정보가 올바르지 않습니다.');
    ids.add(c.id);
    return c;
  });
  return { cards, total: typeof data.total === 'number' ? data.total : cards.length, publishedAt: String(data.publishedAt ?? '') };
}
