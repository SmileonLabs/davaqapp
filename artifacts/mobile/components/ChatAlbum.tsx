import { useColors } from "@/hooks/useColors";
import { useQueryClient } from "@tanstack/react-query";
import React, { useState } from "react";
import { Pressable, Text, View } from "react-native";
import { ChatCachedImage } from "./ChatCachedImage";
import { albumRows, type ChatAlbumImage } from "@/lib/chatAlbumPolicy";
import { ChatImageViewer } from "./ChatImageViewer";
function Tile({ image, width, onPress }: { image: ChatAlbumImage; width: number; onPress: (uri: string) => void }) {
  const colors = useColors();
  const client = useQueryClient();
  const [retryKey, setRetryKey] = useState(0);
  const [failed, setFailed] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const thumbnail = image.thumbnail?.startsWith("data:image/jpeg;base64,") && image.thumbnail.length < 10000 ? image.thumbnail : undefined;
  return <Pressable onPress={() => { if (failed) { setRetryKey(value => value + 1); setFailed(false); void client.invalidateQueries({ queryKey: ["media-url", image.uri] }).catch(() => {}); } else onPress(image.uri); }} accessibilityLabel="사진 확대" style={{ width, height: width > 150 ? 160 : 110, backgroundColor: colors.muted, overflow: "hidden", borderRadius: 8 }}>
    <ChatCachedImage objectPath={image.uri} retryKey={retryKey} thumbnail={thumbnail} contentFit="cover" style={{ width: "100%", height: "100%" }} onError={() => setFailed(true)} onLoad={() => { setLoaded(true); setFailed(false); }} />
    {!loaded ? <Text style={{ position: "absolute", bottom: 8, right: 8, color: colors.mutedForeground }}>{failed ? "다시 불러오기 ↻" : "로딩 중"}</Text> : null}
  </Pressable>;
}
export function ChatAlbum({ images }: { images: ChatAlbumImage[] }) {
  const [opened, setOpened] = useState<string | null>(null);
  let cursor = 0;
  return <View style={{ width: 240, gap: 4 }}>{albumRows(images.length).map((size, index) => {
    const row = images.slice(cursor, cursor += size);
    return <View key={index} style={{ flexDirection: "row", gap: 4 }}>{row.map((image, tileIndex) => <Tile key={`${image.uri}-${tileIndex}`} image={image} width={size === 1 ? 240 : 118} onPress={setOpened} />)}</View>;
  })}{opened ? <ChatImageViewer uri={opened} images={images.map(image => image.uri)} thumbnails={images.map(image => image.thumbnail)} initialIndex={images.findIndex(image => image.uri === opened)} onClose={() => setOpened(null)} /> : null}</View>;
}
