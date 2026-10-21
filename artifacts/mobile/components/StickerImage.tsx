import React, { useState } from "react";
import { Text, View } from "react-native";
import { Image } from "expo-image";
import { ANIMATED_STICKER_SOURCES } from "@/constants/animatedStickers";
import { stickerUri } from "@/constants/stickers";

interface StickerImageProps {
  code: string;
  size: number;
  autoplay?: boolean;
}
// Known animations are bundled: opening the picker never downloads from a CDN.
// Keep remote fallback for historical messages with codes outside the pack.
export function StickerImage(props: StickerImageProps) {
  return <StickerAsset key={props.code} {...props} />;
}
function StickerAsset({ code, size, autoplay = true }: StickerImageProps) {
  const [failed, setFailed] = useState(false);
  if (failed)
    return (
      <View
        style={{
          width: size,
          height: size,
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <Text style={{ fontSize: size * 0.6 }}>🙂</Text>
      </View>
    );
  return (
    <Image
      source={ANIMATED_STICKER_SOURCES[code] ?? { uri: stickerUri(code) }}
      style={{ width: size, height: size }}
      contentFit="contain"
      transition={0}
      autoplay={autoplay}
      cachePolicy="memory-disk"
      recyclingKey={code}
      onError={() => setFailed(true)}
    />
  );
}
