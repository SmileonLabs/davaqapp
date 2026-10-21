import {File,Directory,Paths} from 'expo-file-system';
import {digest,CryptoDigestAlgorithm} from 'expo-crypto';
import {API_BASE} from '../catalog';
import {availableVisualSnapshot,parseVisualLibrary,visualManifestChunks,type VisualCard,type VisualLibrary} from '../visual-library';
import type {ScannerLoadProgress} from '../scanner-load-progress';
import {recoverVerifiedManifest,replaceVerifiedManifest} from '../verified-manifest';
const directory=new Directory(Paths.document,'scanner-visual-v1');
const partFile=(key:string)=>new File(directory,`${key}.bin`);
export type VisualReady={cards:VisualCard[];paths:string[];status:string};
export async function syncVisualLibrary(game:string,signal:AbortSignal,onUpdate:(ready:VisualReady)=>void,force=false,onProgress?:(progress:ScannerLoadProgress|null)=>void):Promise<void>{
  directory.create({intermediates:true,idempotent:true});const manifest=new File(directory,`${game}.json`);
  const manifestFile=()=>new File(directory,`${game}.json`),previousFile=()=>new File(directory,`${game}.previous`);
  let cached:VisualLibrary|undefined,library:VisualLibrary|undefined;
  // Stat each immutable part once. Repeating synchronous native exists/size
  // calls for every progress update delayed rendering and index initialization.
  const sizes=new Map<string,number>();
  for(const file of directory.list())if(file instanceof File&&/^[a-f0-9]{64}\.bin$/.test(file.name))sizes.set(file.name.slice(0,-4),file.size);
  const base=directory.uri.replace(/\/$/,'');
  const saveManifest=async(v:VisualLibrary)=>{
    const pending=new File(directory,`${game}.${Date.now()}.${Math.random().toString(36).slice(2)}.pending`);
    try{
      pending.create({overwrite:true});
      const handle=pending.open();try{for(const chunk of visualManifestChunks(v)){
        if(signal.aborted)return;
        handle.writeBytes(new TextEncoder().encode(chunk));
        await new Promise<void>(resolve=>setTimeout(resolve,0));
      }}finally{handle.close();}
      if(!signal.aborted)await replaceVerifiedManifest(manifestFile,pending,previousFile);
    }finally{if(pending.uri!==manifest.uri&&pending.exists)pending.delete();}
  };
  const snapshot=(v:VisualLibrary)=>{const keys=new Set([...v.parts,...(cached?.parts??[])].filter(p=>sizes.get(p.key)===p.bytes).map(p=>p.key));return availableVisualSnapshot(v,cached,keys);};
  const publish=async(v:VisualLibrary,status:string,save=true)=>{const current=snapshot(v),available=current.parts.filter(p=>sizes.get(p.key)===p.bytes),keys=new Set(available.map(p=>p.key));if(!signal.aborted)onUpdate({cards:current.cards.filter(c=>keys.has(c.part)),paths:available.map(p=>base+'/'+p.key+'.bin'),status});if(save)await saveManifest(current);};
  try{await recoverVerifiedManifest(manifestFile,previousFile);if(manifest.exists){cached=parseVisualLibrary(JSON.parse(await manifest.text()),game);await publish(cached,'',false);}}catch{}
  try{
    library=cached;
    if(force||!cached||Date.now()-Date.parse(cached.generatedAt)>(cached.complete?86400000:300000)){
      const response=await fetch(`${API_BASE}/api/scanner/library?visual=1&game=${encodeURIComponent(game)}`,{signal});if(!response.ok)throw Error('그림 인식 데이터를 준비 중입니다.');library=parseVisualLibrary(await response.json(),game);
    }
    if(!library)return;
    const totalBytes=library.parts.reduce((sum,part)=>sum+part.bytes,0);
    let completedBytes=library.parts.filter(part=>sizes.get(part.key)===part.bytes).reduce((sum,part)=>sum+part.bytes,0);
    // Save the manifest before downloading. Verified parts already on disk
    // remain usable after an interrupted download or an app restart.
    await publish(library,'');
    for(let i=0;i<library.parts.length;i++){
      if(signal.aborted)return;const part=library.parts[i];
      if(sizes.get(part.key)!==part.bytes){
        onProgress?.({stage:'downloading',completedBytes,totalBytes});
        const response=await fetch(`${API_BASE}/api/scanner/library?visual=1&part=${part.key}`,{signal});if(!response.ok)throw Error('그림 특징 다운로드 실패');
        const bytes=new Uint8Array(await response.arrayBuffer());if(signal.aborted)return;
        const hash=new Uint8Array(await digest(CryptoDigestAlgorithm.SHA256,bytes));
        if(bytes.length!==part.bytes||Array.from(hash,b=>b.toString(16).padStart(2,'0')).join('')!==part.key)throw Error('그림 인식 데이터가 손상됐습니다.');
        partFile(part.key).write(bytes);sizes.set(part.key,bytes.length);
        completedBytes+=part.bytes;onProgress?.({stage:'downloading',completedBytes,totalBytes});
      }
      if(i===0||i%64===63||i===library.parts.length-1)await publish(library,`그림 데이터 다운로드 ${i+1}/${library.parts.length}`);
    }
    if(!signal.aborted)await publish(library,'');
  }catch(error){if(!signal.aborted){const status=error instanceof Error?error.message:'그림 데이터 연결을 확인해 주세요.';if(library??cached)await publish((library??cached)!,status,false);else onUpdate({cards:[],paths:[],status});}}
  finally{if(!signal.aborted)onProgress?.(null);}
}
