import type { TfliteModel } from 'react-native-fast-tflite';
import { ART_REGION, artworkDescriptor, cropInputRegion, normalizePixels, parseCatalog, unitVector, type Reference } from './scanner';

export const API_BASE = process.env.EXPO_PUBLIC_TCGINDEX_ORIGIN ?? 'https://tcgindex.org';

async function get(path: string, signal: AbortSignal) {
  const url = new URL(path, API_BASE);
  if (url.origin !== new URL(API_BASE).origin) throw new Error('허용되지 않은 카드 이미지 주소입니다.');
  const response = await fetch(url.toString(), { signal });
  if (!response.ok) throw new Error(response.status === 404 ? '기준 이미지를 찾을 수 없습니다.' : `카드 데이터를 불러오지 못했습니다 (${response.status}).`);
  return response;
}

export function validateModel(model: TfliteModel) {
  if (model.inputs.length !== 1 || model.inputs[0].dataType !== 'float32' || model.inputs[0].shape.join(',') !== '1,224,224,3' ||
      model.outputs.length !== 1 || model.outputs[0].dataType !== 'float32' || model.outputs[0].shape.join(',') !== '1,1024') {
    throw new Error('설치된 모델의 입출력 규격이 맞지 않습니다.');
  }
}

export async function lookupScannerCards(query:string,signal:AbortSignal,game='pokemon') {
  const selector=/^kream:[1-9]\d{0,14}$/.test(query)?`id=${encodeURIComponent(query)}`:`q=${encodeURIComponent(query)}&language=all&game=${encodeURIComponent(game)}`;
  return parseCatalog(await (await get(`/api/scanner/cards?${selector}`, signal)).json());
}
export async function prepareCards(query: string, model: TfliteModel, signal: AbortSignal, progress: (text: string) => void,game='pokemon') {
  validateModel(model);
  const catalog=await lookupScannerCards(query,signal,game);
  if (!catalog.cards.length) throw new Error('기준 이미지가 있는 카드를 찾지 못했습니다.');
  const references: Reference[] = [];
  let skipped = 0;
  for (const card of catalog.cards) {
    if (signal.aborted) throw new Error('준비를 취소했습니다.');
    progress(`기준 카드 준비 ${references.length + skipped + 1}/${catalog.cards.length}`);
    try {
      // v2 trims transparent product-image margins; the query also bypasses v1's immutable cache.
      const buffer = await (await get(`${card.pixels}?v=2`, signal)).arrayBuffer();
      const input = normalizePixels(new Uint8Array(buffer));
      const outputs = await model.run([input.buffer as ArrayBuffer]);
      // Native output buffers are reused: copy each vector before the next run.
      const vector = unitVector(new Float32Array(outputs[0]));
      const artOutputs = await model.run([cropInputRegion(input, ART_REGION).buffer as ArrayBuffer]);
      references.push({ card, vector, artVector: unitVector(new Float32Array(artOutputs[0])), artDescriptor: artworkDescriptor(input) });
    } catch (error) {
      if (signal.aborted) throw error;
      skipped++;
    }
  }
  if (!references.length) throw new Error('기준 카드 이미지를 준비하지 못했습니다. 연결 상태를 확인하고 다시 시도해 주세요.');
  return { references, skipped, total: catalog.total };
}
