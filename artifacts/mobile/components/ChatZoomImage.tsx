import React from "react";
import { ScrollView } from "react-native";
import { ChatCachedImage } from "./ChatCachedImage";
export function ChatZoomImage({ uri, thumbnail, width }: { uri?: string; thumbnail?: string; width: number; onZoom: (zoomed: boolean) => void }) {
  return <ScrollView style={{ width }} contentContainerStyle={{ flexGrow: 1 }} minimumZoomScale={1} maximumZoomScale={4} centerContent>
    <ChatCachedImage objectPath={uri} thumbnail={thumbnail} contentFit="contain" style={{ flex: 1, width, minHeight: 300 }} accessibilityLabel="확대한 사진" />
  </ScrollView>;
}
