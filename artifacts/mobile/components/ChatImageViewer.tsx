import { GestureHandlerRootView } from "react-native-gesture-handler";
import { ChatZoomImage } from "./ChatZoomImage";
import React, { useState } from "react";
import { FlatList, Image, Modal, Platform, Pressable, ScrollView, Text, useWindowDimensions, View } from "react-native";
import { SafeAreaProvider, useSafeAreaInsets } from "react-native-safe-area-context";
import * as MediaLibrary from "expo-media-library";
import * as Sharing from "expo-sharing";
import * as FileSystem from "expo-file-system/legacy";
import { Feather } from "@expo/vector-icons";
import { resolveMediaUri, useMediaUri } from "@/hooks/useMediaUri";
interface Props { uri: string; images?: string[]; thumbnails?: (string | undefined)[]; initialIndex?: number; onClose: () => void }
function Page({ uri, thumbnail, width, onZoom }: { uri: string; thumbnail?: string; width: number; onZoom: (zoomed: boolean) => void }) {
  return <ChatZoomImage uri={uri} thumbnail={thumbnail} width={width} onZoom={onZoom} />;
}
function Viewer({ uri, images = [uri], thumbnails, initialIndex = 0, onClose }: Props) {
  const insets = useSafeAreaInsets();
  const { width: measuredWidth } = useWindowDimensions();
  const width = measuredWidth || 390;
  const [index, setIndex] = useState(initialIndex);
  const [zoomed, setZoomed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const share = async (save = false) => {
    if (busy) return;
    setBusy(true); setError("");
    let local: string | undefined;
    try {
      const resolved = await resolveMediaUri(images[index]);
      if (Platform.OS === "web") {
        const anchor = document.createElement("a"); anchor.href = resolved; anchor.download = "davaq-photo.jpg"; anchor.rel = "noopener"; anchor.click();
      } else {
        if ((!save && !(await Sharing.isAvailableAsync())) || !FileSystem.cacheDirectory) throw new Error("sharing-unavailable");
        const isLocal = resolved.startsWith("file:");
        local = isLocal ? undefined : `${FileSystem.cacheDirectory}davaq-share-${Date.now()}.jpg`;
        let path = resolved;
        if (!isLocal) {
          const result = await FileSystem.downloadAsync(resolved, local!);
          if (result.status !== 200) throw new Error("photo-download-failed");
          const mime = (result.headers["Content-Type"] ?? result.headers["content-type"] ?? "").toLowerCase();
          const extension = mime.includes("png") ? "png" : mime.includes("gif") ? "gif" : mime.includes("webp") ? "webp" : mime.includes("heic") ? "heic" : "jpg";
          if(extension !== "jpg") { const renamed=local!.replace(/\.jpg$/,`.${extension}`);await FileSystem.moveAsync({from:local!,to:renamed});local=renamed; }
          path=local!;
        }
        if (save) {
          const permission = await MediaLibrary.requestPermissionsAsync(true, ["photo"]);
          if (!permission.granted) throw new Error("photo-permission-denied");
          await MediaLibrary.saveToLibraryAsync(path);
          setError("갤러리에 저장했습니다.");
        } else await Sharing.shareAsync(path);
      }
    } catch { setError("사진을 저장하거나 공유하지 못했습니다. 다시 시도해 주세요."); }
    finally { if (local) await FileSystem.deleteAsync(local, { idempotent: true }).catch(() => {}); setBusy(false); }
  };
  return <View style={{ flex: 1, backgroundColor: "#09090C", paddingTop: Math.max(insets.top, Platform.OS === "ios" ? 44 : 24) + 8, paddingBottom: insets.bottom }}>
    <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 16 }}>
      <Pressable onPress={() => void share(true)} disabled={busy} accessibilityRole="button" style={{ minHeight: 48, justifyContent: "center" }}><Text style={{ color: "white" }}>{busy ? "준비 중" : "저장"}</Text></Pressable>
      <Pressable onPress={() => void share()} disabled={busy} accessibilityRole="button" accessibilityLabel="사진 공유" style={{minHeight:48,justifyContent:"center"}}><Text style={{color:"white"}}>공유</Text></Pressable>
      <Text style={{ color: "white", fontSize: 16 }}>{index + 1} / {images.length}</Text>
      <Pressable accessibilityRole="button" accessibilityLabel="사진 닫기" onPress={onClose} hitSlop={8} style={{ minWidth: 64, minHeight: 48, flexDirection: "row", alignItems: "center", gap: 6 }}>
        <Feather name="x" size={26} color="white" /><Text style={{ color: "white" }}>닫기</Text>
      </Pressable>
    </View>
    {error ? <Text accessibilityRole="alert" style={{ color: "white", padding: 12 }}>{error}</Text> : null}
    <FlatList key={width} data={images} horizontal pagingEnabled scrollEnabled={!zoomed} initialScrollIndex={initialIndex} getItemLayout={(_, i) => ({ length: width, offset: width * i, index: i })} keyExtractor={(item, i) => `${item}-${i}`} renderItem={({ item, index: pageIndex }) => <Page uri={item} thumbnail={thumbnails?.[pageIndex]} width={width} onZoom={setZoomed} />} onMomentumScrollEnd={event => setIndex(Math.max(0, Math.min(images.length - 1, Math.round(event.nativeEvent.contentOffset.x / width))))} />
  </View>;
}
export function ChatImageViewer(props: Props) {
  return <Modal visible animationType="fade" onRequestClose={props.onClose} presentationStyle="fullScreen"><GestureHandlerRootView style={{ flex: 1 }}><SafeAreaProvider><Viewer {...props} /></SafeAreaProvider></GestureHandlerRootView></Modal>;
}
