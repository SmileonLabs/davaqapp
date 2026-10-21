import { convertHeicIfNeeded } from './convertHeic';

let conversionQueue: Promise<unknown> = Promise.resolve();

/** Decode legacy HEIC on demand; keep the original object untouched. */
export async function decodeBrowserChatImage(uri: string): Promise<{uri: string; release: () => void} | null> {
  const response = await fetch(uri);
  if (!response.ok) throw new Error(`photo-http-${response.status}`);
  const blob = await response.blob();
  if (blob.size > 25 * 1024 * 1024) throw new Error('photo-too-large');
  const signature = new TextDecoder().decode(await blob.slice(4,16).arrayBuffer());
  const heic = /image\/hei[cf]/i.test(blob.type) || /^ftyp(heic|heix|hevc|hevx|mif1|msf1)/.test(signature);
  if (!heic) return null;
  const task = conversionQueue.catch(() => {}).then(() => convertHeicIfNeeded(blob, 'received-photo.heic', 'image/heic'));
  conversionQueue = task.catch(() => {});
  const converted = await task;
  if (converted.contentType !== 'image/jpeg') throw new Error('photo-heic-decode-failed');
  const displayUri = URL.createObjectURL(converted.blob);
  return {uri:displayUri, release:()=>URL.revokeObjectURL(displayUri)};
}
