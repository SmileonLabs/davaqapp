import { useBrowserChatPhoto } from '@/hooks/useBrowserChatPhoto';
import { decodeBrowserChatImage } from "@/lib/chatBrowserImage";
import React, { useEffect, useRef, useState } from "react";
import { Platform } from "react-native";
import { Image, type ImageProps } from "expo-image";
import { useAuth } from "@/lib/davaqAuth";
import { useMediaResource } from "@/hooks/useMediaUri";

/** Stable file identity survives expiring tickets; account namespace prevents cross-account reuse. */
export function ChatCachedImage({ objectPath, thumbnail, retryKey = 0, ...props }: Omit<ImageProps, "source" | "placeholder" | "cachePolicy" | "recyclingKey"> & { objectPath?: string; thumbnail?: string; retryKey?: number }) {
  const { userId } = useAuth();
  const { uri, error, refresh } = useMediaResource(objectPath);
  const [attempt, setAttempt] = useState(0);
  const browserPhoto = useBrowserChatPhoto(objectPath, retryKey + attempt);
  const retries = useRef(0);
  const [decoded, setDecoded] = useState<{identity:string;uri:string}>();
  const decodedRelease = useRef<(() => void) | undefined>(undefined);
  const generation = useRef(0);
  const [cached, setCached] = useState<{identity:string;uri:string}>();
  const [failed, setFailed] = useState(false);
  useEffect(() => { setFailed(false); }, [uri, browserPhoto?.uri]);
  useEffect(() => { retries.current = 0; setFailed(false); }, [objectPath, userId, retryKey]);
  useEffect(() => { if (error && !browserPhoto?.uri) { setFailed(true); props.onError?.({ error: "사진 접근 주소를 불러오지 못했습니다" }); } }, [error, browserPhoto?.uri]);
  useEffect(() => { if (browserPhoto?.error) { setFailed(true); props.onError?.({ error: "사진을 불러오지 못했습니다" }); } }, [browserPhoto?.error]);
  const preview = thumbnail?.startsWith("data:image/jpeg;base64,") && thumbnail.length < 10000 ? thumbnail : undefined;
  const identity = `${userId ?? "signed-out"}:${objectPath ?? "empty"}`;
  useEffect(() => {
    let current = true;
    if (Platform.OS !== "web" && objectPath) void Image.getCachePathAsync(identity).then(path => {
      if (current && path) setCached({identity,uri:path.startsWith("file:") ? path : `file://${path}`});
    }).catch(()=>{});
    return () => { current = false; };
  },[identity,objectPath]);
  useEffect(() => { generation.current += 1; setDecoded(undefined); return () => { generation.current += 1; decodedRelease.current?.(); decodedRelease.current = undefined; }; }, [identity, retryKey]);
  const decodedUri = browserPhoto?.uri || (decoded?.identity === identity ? decoded.uri : undefined);
  const cachedUri = cached?.identity === identity ? cached.uri : undefined;
  return <Image key={`${identity}:${retryKey}:${attempt}`} {...props}
    source={(decodedUri || cachedUri || (Platform.OS !== "web" ? uri : undefined)) && !failed ? { uri: decodedUri || cachedUri || uri!, cacheKey: identity } : preview}
    placeholder={preview ? { uri: preview } : undefined}
    placeholderContentFit={props.contentFit ?? "cover"}
    cachePolicy="memory-disk" recyclingKey={identity} transition={0}
    onLoad={event => { if(!failed && (decodedUri || cachedUri || uri)) { retries.current = 0; props.onLoad?.(event); } }}
    onError={async event => {
      if (Platform.OS === "web" && uri && !decodedUri && retries.current === 0) {
        const ownerGeneration = generation.current;
        retries.current += 1;
        try {
          const image = await decodeBrowserChatImage(uri);
          if (generation.current !== ownerGeneration) { image?.release(); return; }
          if (image) { decodedRelease.current?.(); decodedRelease.current=image.release; setDecoded({identity,uri:image.uri}); setFailed(false); return; }
        } catch { /* Expired access URL is renewed below. */ }
        if (generation.current !== ownerGeneration) return;
        retries.current = 0;
      }
      if (cachedUri) { setCached(undefined); return; }
      if (objectPath?.startsWith("/objects/") && retries.current < 1) {
        retries.current += 1;
        void refresh().then(result => {
          if (result.error) { setFailed(true); props.onError?.({ error: "사진 접근 주소를 갱신하지 못했습니다" }); }
          else setAttempt(value => value + 1);
        }).catch(() => { setFailed(true); props.onError?.(event); });
      } else { setFailed(true); props.onError?.(event); }
    }} />;
}
