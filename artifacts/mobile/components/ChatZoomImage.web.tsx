import { useBrowserChatPhoto } from '@/hooks/useBrowserChatPhoto';
import { decodeBrowserChatImage } from "@/lib/chatBrowserImage";
import { useMediaResource } from "@/hooks/useMediaUri";
import React, { useEffect, useRef, useState } from "react";
export function ChatZoomImage({ uri, thumbnail, width, onZoom }: { uri?: string; thumbnail?: string; width: number; onZoom: (zoomed: boolean) => void }) {
  const { uri: source, error: accessError, refresh } = useMediaResource(uri);
  const [decoded, setDecoded] = useState<string>();
  const release = useRef<(() => void) | undefined>(undefined);
  const generation = useRef(0);
  useEffect(() => { generation.current += 1; setDecoded(undefined); return () => { generation.current += 1; release.current?.(); release.current=undefined; }; }, [uri]);
  const loadError = async () => {
    if (!source || decoded) { setFailed(true); return; }
    const current = generation.current;
    try { const image = await decodeBrowserChatImage(source); if (generation.current !== current) { image?.release(); return; } if (image) { release.current?.(); release.current=image.release; setDecoded(image.uri); setFailed(false); } else setFailed(true); } catch { if(generation.current===current)setFailed(true); }
  };
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const retry = async () => { const result = await refresh(); setFailed(Boolean(result.error)); setAttempt(value => value + 1); };
  const browserPhoto = useBrowserChatPhoto(uri, attempt);
  const frame = useRef<HTMLDivElement>(null);
  const scaleRef = useRef(1);
  const [scale, setScale] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const dragging = useRef<{ x: number; y: number; originX: number; originY: number } | null>(null);
  const zoom = (value: number) => { const next = Math.max(1,Math.min(4,value)); scaleRef.current=next; setScale(next); onZoom(next>1); if(next===1) setOffset({x:0,y:0}); };
  useEffect(() => {
    const element = frame.current;
    const wheel = (event: WheelEvent) => { if (!event.ctrlKey) return; event.preventDefault(); zoom(scaleRef.current-event.deltaY/200); };
    element?.addEventListener("wheel",wheel,{passive:false});
    return () => element?.removeEventListener("wheel",wheel);
  }, [onZoom]);
  return <div ref={frame} style={{ width, flex:1, minHeight:300, position:"relative", overflow:"hidden", touchAction:scale>1?"none":"pan-x", cursor:scale>1?"grab":"zoom-in" }} onDoubleClick={() => zoom(scale>1?1:2)} onPointerDown={event => { if(scale<=1)return; event.currentTarget.setPointerCapture(event.pointerId); dragging.current={x:event.clientX,y:event.clientY,originX:offset.x,originY:offset.y}; }} onPointerMove={event => { const start=dragging.current; if(!start)return; const limit=width*(scale-1)/2; setOffset({x:Math.max(-limit,Math.min(limit,start.originX+event.clientX-start.x)),y:Math.max(-limit,Math.min(limit,start.originY+event.clientY-start.y))}); }} onPointerUp={()=>{dragging.current=null;}} onPointerCancel={()=>{dragging.current=null;}}>
    {thumbnail ? <img src={thumbnail} alt="" draggable={false} style={{ position:"absolute",inset:0,width:"100%",height:"100%",objectFit:"contain" }} /> : null}
    <img key={`${uri}:${attempt}`} src={browserPhoto?.uri || decoded || thumbnail} onLoad={() => setFailed(false)} onError={() => void loadError()} alt="확대한 사진" draggable={false} style={{ width:"100%",height:"100%",position:"absolute",objectFit:"contain",transform:`translate(${offset.x}px,${offset.y}px) scale(${scale})`,transformOrigin:"center" }} />
    {failed || (accessError && !browserPhoto?.uri) || browserPhoto?.error ? <button type="button" onClick={() => void retry()} style={{position:"absolute",top:"45%",left:"25%",padding:16}}>사진 다시 불러오기</button> : null}
    <button type="button" onClick={()=>zoom(scale>1?1:2)} style={{position:"absolute",bottom:12,right:12,padding:12,borderRadius:12,border:0,background:"rgba(255,255,255,.15)",color:"white"}}>{scale>1?"축소":"확대"}</button>
  </div>;
}
