import {useEffect, useRef, useState} from 'react';
import {AppState} from 'react-native';
import {Directory, File, Paths} from 'expo-file-system';
import {createDownloadResumable} from 'expo-file-system/legacy';
import {API_BASE} from '../catalog';
import {COMPACT_PARTS, parseCompactPack, type CompactPack} from '../compact-library';
import {nativeVision, type CompactFiles} from './native-vision';
import type {ScannerLoadProgress} from '../scanner-load-progress';
import {recoverVerifiedManifest,replaceVerifiedManifest} from '../verified-manifest';

const directory = new Directory(Paths.document, 'scanner-compact-v1');
function removeSupersededParts(openPack: CompactPack) {
 const retained = new Set(COMPACT_PARTS.map(name => openPack[name].key + '.bin'));
 const entries = directory.list();
 try {
  for (const entry of entries) if (entry instanceof File && /^[a-z][a-z0-9_]+\.json$/.test(entry.name)) {
   const pack = parseCompactPack(JSON.parse(entry.textSync()), entry.name.slice(0, -5));
   COMPACT_PARTS.forEach(name => retained.add(pack[name].key + '.bin'));
  }
 } catch {return;}
 for (const entry of entries) if (entry instanceof File && /^[a-f0-9]{64}\.bin$/.test(entry.name) && !retained.has(entry.name)) entry.delete();
}
const filesFor = (pack: CompactPack): CompactFiles => Object.fromEntries(COMPACT_PARTS.map(name => {
 const part = pack[name];
 return [name, {path: decodeURIComponent(new File(directory, part.key + '.bin').uri.replace(/^file:\/\//, '')), sha256: part.key, bytes: part.bytes}];
})) as CompactFiles;

/** Keep the open snapshot usable while downloading changed, verified parts. */
export function useCompactScannerLibrary(game: string, language: string, syncKey: number, onError: (message: string) => void) {
 const [ready, setReady] = useState(0),[dataVersion,setDataVersion]=useState('');
 const [status, setStatus] = useState('카드 데이터를 준비하고 있어요');
 const [progress,setProgress]=useState<ScannerLoadProgress|null>(null);
 const errors = useRef(onError); errors.current = onError;
 useEffect(() => {
  let canceled=false,opened=false,busy=false,initialized=false,etag='';
  let current:CompactPack|undefined,controller:AbortController|undefined,completeTimer:ReturnType<typeof setTimeout>|undefined;
  setReady(0);setDataVersion('');setStatus('저장된 카드 데이터를 열고 있어요');
  setProgress({stage:'checking',completedBytes:0,totalBytes:0});
  directory.create({intermediates:true,idempotent:true});
  const manifest=new File(directory,game+'.json');
  const manifestFile=()=>new File(directory,game+'.json');
  const previousFile=()=>new File(directory,game+'.previous');
  const savePack=async(pack:CompactPack)=>{
   const pending=new File(directory,game+'.'+Date.now()+'.pending');
   try{
    pending.write(JSON.stringify({...pack,etag}));
    if(!canceled)await replaceVerifiedManifest(manifestFile,pending,previousFile);
   }finally{if(pending.uri!==manifest.uri&&pending.exists)pending.delete();}
  };
  const fileFor=(part:{key:string})=>new File(directory,part.key+'.bin');
  const available=(pack:CompactPack)=>COMPACT_PARTS.every(name=>{const file=fileFor(pack[name]);return file.exists&&file.size===pack[name].bytes;});
  const open=async(pack:CompactPack)=>{
   if(canceled)return;
   setProgress({stage:'opening',completedBytes:0,totalBytes:0,updating:opened});
   const count=await nativeVision.configureCompact(filesFor(pack),language);
   if(!canceled){opened=true;current=pack;setReady(count);setDataVersion(pack.cards.key+':'+pack.prices.key);setStatus('');removeSupersededParts(pack);}
  };
  const sync=async()=>{
   if(canceled||busy)return;
   busy=true;controller=new AbortController();clearTimeout(completeTimer);
   setProgress({stage:'checking',completedBytes:0,totalBytes:0,updating:opened});
   try{
    const timeout=setTimeout(()=>controller?.abort(),15000);
    let pack:CompactPack;
    try{
     const response=await fetch(API_BASE+'/api/scanner/library?compact=1&game='+encodeURIComponent(game),{signal:controller.signal,cache:'no-cache',headers:etag?{'If-None-Match':etag}:{}});
     if(response.status===304&&current){setProgress(null);return;}
     if(!response.ok)throw Error('이 게임의 카드 데이터를 준비 중입니다. 잠시 후 다시 시도해 주세요.');
     pack=parseCompactPack(await response.json(),game);
     etag=response.headers.get('etag')??'';
    }finally{clearTimeout(timeout);}
    if(current&&available(pack)&&COMPACT_PARTS.every(name=>current![name].key===pack[name].key)){await savePack(pack);setStatus('');setProgress(null);return;}
    const needed=COMPACT_PARTS.filter(name=>{const file=fileFor(pack[name]);return !file.exists||file.size!==pack[name].bytes;});
    const totalBytes=needed.reduce((sum,name)=>sum+pack[name].bytes,0);
    let completedBytes=0;
    for(const name of needed){
     if(canceled)return;
     const part=pack[name],file=fileFor(part);
     setStatus(opened?'최신 카드 데이터를 갱신하고 있어요':'카드 데이터를 내려받고 있어요');
     const pending=new File(directory,part.key+'.'+Date.now()+'.'+Math.random().toString(36).slice(2)+'.pending');
     let reportedAt=0;
     const download=createDownloadResumable(API_BASE+'/api/scanner/library?compact=1&part='+part.key,pending.uri,{},value=>{
      if(canceled||Date.now()-reportedAt<120)return;
      reportedAt=Date.now();setProgress({stage:'downloading',completedBytes:completedBytes+Math.min(part.bytes,value.totalBytesWritten),totalBytes,updating:opened});
     });
     const cancel=()=>void download.cancelAsync().catch(()=>{});
     controller.signal.addEventListener('abort',cancel);
     try{
      setProgress({stage:'downloading',completedBytes,totalBytes,updating:opened});
      const result=await download.downloadAsync();
      if(canceled)return;
      if(!result||result.status!==200)throw Error('인식 데이터를 내려받지 못했습니다. 다시 시도해 주세요.');
      setProgress({stage:'verifying',completedBytes:completedBytes+part.bytes,totalBytes,updating:opened});
      await nativeVision.verifyCompactPart({path:decodeURIComponent(pending.uri.replace(/^file:\/\//,'')),sha256:part.key,bytes:part.bytes});
      if(file.exists)file.delete();await pending.move(file);completedBytes+=part.bytes;
     }finally{controller.signal.removeEventListener('abort',cancel);if(pending.uri!==file.uri&&pending.exists)pending.delete();}
    }
    if(canceled)return;
    // Open/verify before publishing the replacement manifest. Failed downloads
    // or corrupt data leave the previously usable snapshot intact.
    await open(pack);
    if(canceled)return;
    await savePack(pack);
    setProgress({stage:'ready',completedBytes:totalBytes,totalBytes,updating:true});
    completeTimer=setTimeout(()=>{if(!canceled)setProgress(null);},1200);
   }catch(error){
    if(canceled)return;
    etag='';setProgress(null);
    if(opened)setStatus('저장된 카드 데이터 사용 중 · 갱신은 다시 확인합니다');
    else{const message=error instanceof Error?error.message:'카드 데이터 연결을 확인해 주세요.';setStatus(message);errors.current(message);}
   }finally{busy=false;}
  };
  void(async()=>{
   try{await recoverVerifiedManifest(manifestFile,previousFile);if(manifest.exists){const saved=JSON.parse(await manifest.text());const pack=parseCompactPack(saved,game);if(available(pack)){await open(pack);etag=typeof saved.etag==='string'?saved.etag:'';}}}catch{current=undefined;}
   initialized=true;await sync();
  })();
  const subscription=AppState.addEventListener('change',state=>{if(state==='active'&&initialized)void sync();});
  const timer=setInterval(()=>{if(AppState.currentState==='active'&&initialized)void sync();},300000);
  return()=>{canceled=true;controller?.abort();clearTimeout(completeTimer);clearInterval(timer);subscription.remove();};
 },[game,language,syncKey]);
 return {ready,status,fallback:false,progress,dataVersion};
}
