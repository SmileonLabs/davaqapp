import React, { useEffect, useRef, useState } from "react";
import { View } from "react-native";
import { useDavaq } from "@/lib/davaq";
import { getApiBase } from "@/lib/apiBase";
import { type MapCanvasProps, validCoordinate } from "@/lib/maps";
import { Txt, C } from "./UI";
export default function MapCanvas(p: MapCanvasProps) {
  const frame = useRef<HTMLIFrameElement>(null),
    [ready, setReady] = useState(false),
    [failed, setFailed] = useState(false),
    loaded = useRef(false),
    callbacks = useRef(p);
  callbacks.current = p;
  const config = useDavaq<{ tileUrl: string; attribution: string }>(
    "/exchange/map/config",
  );
  const origin = getApiBase(),
    src = origin + "/app/maps/map.html";
  const payload = JSON.stringify({
    channel: "davaq-map-v1",
    type: "render",
    center: p.center,
    markers: p.markers,
    selectedId: p.selectedId,
    pickable: p.pickable,
    focusToken: p.focusToken,
    zoom: p.zoom,
    ...config.data,
  });
  useEffect(() => {
    const listener = (e: MessageEvent) => {
      if (
        e.origin !== origin ||
        e.source !== frame.current?.contentWindow ||
        e.data?.channel !== "davaq-map-v1"
      )
        return;
      const d = e.data;
      if (d.type === "ready") {
        loaded.current = true;
        setReady(true);
      }
      if (
        d.type === "select" &&
        typeof d.id === "string" &&
        callbacks.current.markers.some((m) => m.id === d.id)
      )
        callbacks.current.onSelect?.(d.id);
      if (validCoordinate({ lat: d.lat, lng: d.lng })) {
        if (d.type === "pick" && callbacks.current.pickable)
          callbacks.current.onPick?.({ lat: d.lat, lng: d.lng });
        if (d.type === "moved")
          callbacks.current.onMove?.({ lat: d.lat, lng: d.lng });
      }
    };
    window.addEventListener("message", listener);
    const timer = setTimeout(() => {
      if (!loaded.current) setFailed(true);
    }, 12000);
    return () => {
      window.removeEventListener("message", listener);
      clearTimeout(timer);
    };
  }, [origin]);
  useEffect(() => {
    if (ready && config.data) {
      setFailed(false);
      frame.current?.contentWindow?.postMessage(JSON.parse(payload), origin);
    }
  }, [ready, payload, origin, config.data]);
  return (
    <View
      style={{
        height: p.height ?? 390,
        borderRadius: 22,
        overflow: "hidden",
        backgroundColor: C.soft,
      }}
    >
      <iframe
        ref={frame}
        src={src}
        title="교환 위치 지도"
        referrerPolicy="strict-origin-when-cross-origin"
        style={{ width: "100%", height: "100%", border: 0 }}
        onLoad={() =>
          frame.current?.contentWindow?.postMessage(
            { channel: "davaq-map-v1", type: "hello" },
            origin,
          )
        }
      />
      {(!ready || config.isPending) && (
        <View
          pointerEvents="none"
          style={{
            position: "absolute",
            top: 12,
            left: 12,
            backgroundColor: C.white,
            padding: 10,
            borderRadius: 10,
          }}
        >
          <Txt size={12}>지도를 준비하고 있어요…</Txt>
        </View>
      )}
      {(failed || config.isError) && (
        <View
          style={{
            position: "absolute",
            bottom: 32,
            left: 12,
            right: 12,
            backgroundColor: C.white,
            padding: 12,
            borderRadius: 10,
          }}
        >
          <Txt size={12}>
            지도 연결을 확인해 주세요. 아래 목록은 계속 이용할 수 있어요.
          </Txt>
        </View>
      )}
    </View>
  );
}
