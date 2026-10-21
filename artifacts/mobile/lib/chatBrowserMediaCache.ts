import { convertHeicIfNeeded } from './convertHeic';

const PREFIX = 'davaq-private-photo-v1-';
const MAX_BYTES = 64 * 1024 * 1024;
const MAX_ITEMS = 80;
const MAX_AGE = 7 * 24 * 60 * 60_000;
type Entry = { uri: string; bytes: number; refs: number; touched: number };
const memory = new Map<string, Entry>();
const pending = new Map<string, Promise<Entry>>();
let owner: string | undefined;
let generation = 0;
let conversionQueue: Promise<unknown> = Promise.resolve();
let storageQueue: Promise<unknown> = Promise.resolve();
const cacheName = (account: string) => PREFIX + encodeURIComponent(account);
const requestKey = (path: string) => new Request(`${location.origin}/__davaq_private_photo__/${encodeURIComponent(path)}`);
function pruneMemory() {
  let bytes = [...memory.values()].reduce((sum, entry) => sum + entry.bytes, 0);
  for (const [key, entry] of [...memory].sort((a, b) => a[1].touched - b[1].touched)) {
    if (bytes <= MAX_BYTES && memory.size <= MAX_ITEMS) break;
    if (entry.refs) continue;
    URL.revokeObjectURL(entry.uri); memory.delete(key); bytes -= entry.bytes;
  }
}
/** Switching accounts invalidates in-flight work and removes private local copies. */
export function setBrowserMediaOwner(account: string | undefined) {
  if (owner === account) return;
  owner = account; generation++;
  for (const entry of memory.values()) URL.revokeObjectURL(entry.uri);
  memory.clear(); pending.clear();
  storageQueue = storageQueue.catch(() => {}).then(async () => {
    if (typeof caches === 'undefined') return;
    for (const name of await caches.keys()) {
      if (name.startsWith(PREFIX) && name !== (owner ? cacheName(owner) : '')) await caches.delete(name);
    }
  }).catch(() => {});
}
async function persist(account: string, path: string, blob: Blob, fence: number) {
  storageQueue = storageQueue.catch(() => {}).then(async () => {
    if (typeof caches === 'undefined' || fence !== generation || owner !== account) return;
    const cache = await caches.open(cacheName(account));
    await cache.put(requestKey(path), new Response(blob, { headers: { 'Content-Type': blob.type, 'X-Davaq-Time': String(Date.now()), 'X-Davaq-Bytes': String(blob.size) } }));
    const entries = await Promise.all((await cache.keys()).map(async request => {
      const response = await cache.match(request);
      return { request, time: Number(response?.headers.get('X-Davaq-Time')), bytes: Number(response?.headers.get('X-Davaq-Bytes')) || 0 };
    }));
    entries.sort((a, b) => b.time - a.time);
    let bytes = 0;
    for (let index = 0; index < entries.length; index++) {
      const entry = entries[index]; bytes += entry.bytes;
      if (index >= MAX_ITEMS || bytes > MAX_BYTES || Date.now() - entry.time > MAX_AGE) await cache.delete(entry.request);
    }
  }).catch(() => {}); // Storage denial/quota must not prevent displaying a photo.
  await storageQueue;
}
export async function invalidateBrowserPhoto(account: string, path: string) {
  if (owner !== account) return;
  const key = `${account}:${path}`;
  const entry = memory.get(key);
  memory.delete(key);
  if (entry && !entry.refs) URL.revokeObjectURL(entry.uri);
  await storageQueue;
  if (owner !== account || typeof caches === 'undefined') return;
  try { await (await caches.open(cacheName(account))).delete(requestKey(path)); } catch { /* Optional storage. */ }
}
export function peekBrowserPhoto(account: string, path: string) {
  if (owner !== account) return undefined;
  return memory.get(`${account}:${path}`)?.uri;
}
export async function acquireBrowserPhoto(account: string, path: string, resolve: () => Promise<string>) {
  if (owner !== account) throw new Error('photo-owner-changed');
  const fence = generation;
  const key = `${account}:${path}`;
  let entry = memory.get(key);
  if (!entry) {
    let task = pending.get(key);
    if (!task) {
      task = (async () => {
        await storageQueue;
        let blob: Blob | undefined;
        try {
          if (typeof caches !== 'undefined' && fence === generation) {
            const cache = await caches.open(cacheName(account));
            const response = await cache.match(requestKey(path));
            if (response && Date.now() - Number(response.headers.get('X-Davaq-Time')) < MAX_AGE) blob = await response.blob();
          }
        } catch { /* Fall back to authorized network access. */ }
        if (!blob) {
          if (fence !== generation) throw new Error('photo-owner-changed');
          const response = await fetch(await resolve());
          if (!response.ok) throw new Error(`photo-http-${response.status}`);
          blob = await response.blob();
          if (blob.size > 25 * 1024 * 1024) throw new Error('photo-too-large');
          const signature = new TextDecoder().decode(await blob.slice(4, 16).arrayBuffer());
          if (/image\/hei[cf]/i.test(blob.type) || /^ftyp(heic|heix|hevc|hevx|mif1|msf1)/.test(signature)) {
            const original = blob;
            const conversion = conversionQueue.catch(() => {}).then(() => convertHeicIfNeeded(original, 'received-photo.heic', 'image/heic'));
            conversionQueue = conversion.catch(() => {});
            const converted = await conversion;
            if (converted.contentType !== 'image/jpeg') throw new Error('photo-heic-decode-failed');
            blob = converted.blob;
          }
          await persist(account, path, blob, fence);
        }
        if (fence !== generation || owner !== account) throw new Error('photo-owner-changed');
        const result = { uri: URL.createObjectURL(blob), bytes: blob.size, refs: 0, touched: Date.now() };
        memory.set(key, result);
        return result;
      })();
      pending.set(key, task);
      void task.finally(() => { if (pending.get(key) === task) pending.delete(key); }).catch(() => {});
    }
    entry = await task;
  }
  if (fence !== generation || owner !== account) throw new Error('photo-owner-changed');
  entry.refs++; entry.touched = Date.now(); pruneMemory();
  let released = false;
  return { uri: entry.uri, release: () => { if (released) return; released = true; entry!.refs--; entry!.touched = Date.now(); if (!entry!.refs && memory.get(key) !== entry) URL.revokeObjectURL(entry!.uri); pruneMemory(); } };
}
