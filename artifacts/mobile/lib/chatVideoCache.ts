import * as FileSystem from "expo-file-system/legacy";
import * as Crypto from "expo-crypto";
const root = `${FileSystem.cacheDirectory}davaq-videos/`;
const MAX_BYTES = 150 * 1024 * 1024;
const MAX_AGE_MS = 7 * 86400000;
const inFlight = new Map<string, Promise<string>>();
let generation = 0;
let activeOwner: string | undefined;
let initialized = false;
let mutations: Promise<unknown> = Promise.resolve();
function serial<T>(task: () => Promise<T>): Promise<T> {
  const next = mutations.then(task, task); mutations = next.catch(() => {}); return next;
}
async function fileName(owner: string, path: string) {
  return await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, `${owner}:${path}`);
}
export async function clearChatVideoCache() {
  generation += 1;
  await serial(() => FileSystem.deleteAsync(root, { idempotent: true }));
}
export async function setChatMediaOwner(owner: string | undefined) {
  if (!initialized) { initialized = true; activeOwner = owner; return; }
  if (activeOwner === owner) return;
  activeOwner = owner;
  await clearChatVideoCache();
}
async function prune(protectedPath: string) {
  const names = await FileSystem.readDirectoryAsync(root);
  const files = (await Promise.all(names.filter(n => /\.(mp4|mov|webm)$/.test(n)).map(async name => {
    const uri = root + name; const info = await FileSystem.getInfoAsync(uri);
    return info.exists && !info.isDirectory ? { uri, size: info.size, time: (info.modificationTime ?? 0) * 1000 } : undefined;
  }))).filter((x): x is {uri:string;size:number;time:number} => !!x).sort((a,b) => a.time-b.time);
  let size = files.reduce((sum,x) => sum+x.size,0);
  for (const file of files) {
    if (file.uri === protectedPath) continue;
    if (size > MAX_BYTES || Date.now()-file.time > MAX_AGE_MS) {
      await FileSystem.deleteAsync(file.uri,{idempotent:true});size -= file.size;
    }
  }
}
/** Resolve remotely only on a miss. Cached bytes are addressed by account + canonical object path. */
export async function getChatVideoFile(owner: string, objectPath: string, resolve: () => Promise<string>) {
  if (!FileSystem.cacheDirectory) return resolve();
  const token = generation;
  const name = await fileName(owner,objectPath), key = root+name;
  let uri = key+'.mp4';
  if (token !== generation) throw new Error("media-owner-changed");
  if (inFlight.has(key)) return inFlight.get(key)!;
  const task = (async () => {
    for (const extension of ['mp4','mov','webm']) {
      const candidate = key+'.'+extension;
      const info = await FileSystem.getInfoAsync(candidate);
      if (token !== generation) throw new Error('media-owner-changed');
      if (info.exists && !info.isDirectory && info.size > 0 && Date.now()-(info.modificationTime ?? 0)*1000 <= MAX_AGE_MS) return candidate;
    }
    const remote = await resolve();
    if (token !== generation) throw new Error('media-owner-changed');
    await serial(() => FileSystem.makeDirectoryAsync(root,{intermediates:true}));
    const temp = root+name+`-${token}.partial`;
    try {
      const result = await FileSystem.downloadAsync(remote,temp);
      if (result.status !== 200) throw new Error('video-download-failed');
      const mime = (result.headers?.['Content-Type'] ?? result.headers?.['content-type'] ?? '').toLowerCase();
      uri = key+(mime.includes('quicktime') ? '.mov' : mime.includes('webm') ? '.webm' : '.mp4');
      await serial(async () => {
        if (token !== generation) throw new Error('media-owner-changed');
        const info = await FileSystem.getInfoAsync(temp);
        if (!info.exists || info.isDirectory || info.size <= 0 || info.size > 25 * 1024 * 1024) throw new Error("video-cache-size-invalid");
        await FileSystem.deleteAsync(uri,{idempotent:true});
        await FileSystem.moveAsync({from:temp,to:uri});
        await prune(uri);
      });
      return uri;
    } finally { await FileSystem.deleteAsync(temp,{idempotent:true}).catch(()=>{}); }
  })();
  inFlight.set(key,task);
  try { return await task; } finally { if(inFlight.get(key)===task) inFlight.delete(key); }
}
