import React, { useEffect, useRef, useState } from "react";
import { View, Linking } from "react-native";
import { WebView } from "react-native-webview";
import { useDavaq } from "@/lib/davaq";
import { getApiBase } from "@/lib/apiBase";
import { type MapCanvasProps, validCoordinate } from "@/lib/maps";
import { Notice } from "./UI";
export default function MapCanvas(p: MapCanvasProps) {
  const frame = useRef<WebView>(null),
    [ready, setReady] = useState(false),
    [failed, setFailed] = useState(false),
    config = useDavaq<{ tileUrl: string; attribution: string }>(
      "/exchange/map/config",
    );
  const src = getApiBase() + "/app/maps/map.html",
    payload = JSON.stringify({
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
    if (ready && config.data)
      frame.current?.injectJavaScript(
        "window.DavaqMap?.receive(" + payload + ");true;",
      );
  }, [ready, payload, config.data]);
  return (
    <View
      style={{ height: p.height ?? 390, borderRadius: 22, overflow: "hidden" }}
    >
      <WebView
        ref={frame}
        source={{ uri: src }}
        originWhitelist={[getApiBase()]}
        onShouldStartLoadWithRequest={(r) => {
          if (r.url === src || r.url === "about:blank") return true;
          if (r.url === "https://www.openstreetmap.org/copyright")
            void Linking.openURL(r.url);
          return false;
        }}
        onLoadEnd={() => setReady(true)}
        onError={() => setFailed(true)}
        onMessage={(e) => {
          try {
            const d = JSON.parse(e.nativeEvent.data);
            if (d.channel !== "davaq-map-v1") return;
            if (d.type === "ready") setReady(true);
            if (d.type === "select" && p.markers.some((m) => m.id === d.id))
              p.onSelect?.(d.id);
            if (validCoordinate({ lat: d.lat, lng: d.lng })) {
              if (d.type === "pick" && p.pickable) p.onPick?.(d);
              if (d.type === "moved") p.onMove?.(d);
            }
          } catch {}
        }}
        geolocationEnabled={false}
      />
      {failed && (
        <Notice error>
          지도를 불러오지 못했어요. 네트워크 연결을 확인해 주세요.
        </Notice>
      )}
    </View>
  );
}
