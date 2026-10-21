import { useVideoPlayer, VideoView } from "expo-video";
import { useColors } from "@/hooks/useColors";
import React, { useState } from "react";
import { Image, Modal, Platform, Pressable, ScrollView, Switch, Text, TextInput, View } from "react-native";
import { SafeAreaProvider, useSafeAreaInsets } from "react-native-safe-area-context";
import * as ImageManipulator from "expo-image-manipulator";
import type { ImagePickerAsset } from "expo-image-picker";
export interface MediaSelection { assets: ImagePickerAsset[]; original: boolean; caption: string }
export interface PreviewRequest { assets: ImagePickerAsset[]; original?: boolean; video?: boolean; finish: (selection: MediaSelection | null) => void }
function VideoPreview({ uri }: { uri: string }) {
  const player = useVideoPlayer(uri);
  return <VideoView player={player} nativeControls contentFit="contain" style={{ width: "100%", height: 280 }} />;
}
function Preview({ request }: { request: PreviewRequest }) {
  const insets = useSafeAreaInsets();
  const colors = useColors();
  const [assets, setAssets] = useState(request.assets);
  const [original, setOriginal] = useState(request.original ?? false);
  const [caption, setCaption] = useState("");
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState("");
  const edit = async (index: number, crop = false) => {
    if (editing) return;
    setEditing(true); setError("");
    const asset = assets[index];
    try {
      const size = Math.min(asset.width, asset.height);
      const result = await ImageManipulator.manipulateAsync(asset.uri, crop ? [{ crop: { originX: (asset.width-size)/2, originY: (asset.height-size)/2, width: size, height: size } }] : [{ rotate: 90 }], { compress: 1, format: ImageManipulator.SaveFormat.JPEG });
      setAssets(current => current.map((item, i) => i === index ? { ...item, ...result, mimeType: "image/jpeg", fileName: "edited-photo.jpg" } : item));
    } catch { setError("사진 편집에 실패했습니다. 다시 시도해 주세요."); }
    finally { setEditing(false); }
  };
  const button = (label: string, action: () => void, disabled = false) => <Pressable accessibilityRole="button" disabled={disabled} onPress={action} style={{ paddingHorizontal: 12, minHeight: 48, justifyContent: "center", opacity: disabled ? 0.4 : 1 }}><Text style={{ color: colors.primary, fontWeight: "600" }}>{label}</Text></Pressable>;
  return <View style={{ flex: 1, backgroundColor: colors.background, paddingTop: Math.max(insets.top, Platform.OS === "ios" ? 44 : 24) + 8, paddingBottom: insets.bottom }}>
    <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 12 }}>
      {button("닫기", () => request.finish(null))}<Text style={{ color: colors.foreground, fontWeight: "700" }}>{request.video ? "영상 미리보기" : `사진 ${assets.length}장`}</Text>{button("보내기", () => request.finish({ assets, original, caption }), !assets.length || editing)}
    </View>
    <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ padding: 16, gap: 16 }}>{assets.map((asset, index) => <View key={`${asset.assetId ?? index}-${asset.uri}`}>
      {request.video ? <VideoPreview uri={asset.uri} /> : <Image source={{ uri: asset.uri }} resizeMode="contain" style={{ width: "100%", height: 240, backgroundColor: colors.muted, borderRadius: 16 }} />}
      {!request.video ? <View style={{ flexDirection: "row", flexWrap: "wrap" }}>
        {button("앞으로", () => setAssets(current => { const next = [...current]; [next[index-1], next[index]] = [next[index], next[index-1]]; return next; }), index === 0 || editing)}
        {button("회전", () => void edit(index), editing)}{button("정사각형 자르기", () => void edit(index, true), editing)}
        {button("삭제", () => setAssets(current => current.filter((_, i) => i !== index)), editing)}
      </View> : null}
    </View>)}<View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}><Text style={{ color: colors.foreground }}>{request.video && Platform.OS === "web" ? "영상은 원본으로 전송" : "원본 보내기"}</Text><Switch value={request.video && Platform.OS === "web" ? true : original} disabled={request.video && Platform.OS === "web"} onValueChange={setOriginal} /></View>
      <Text style={{ color: colors.mutedForeground }}>{original ? "원본 크기로 전송합니다. 사진당 10MB, 영상·파일은 25MB까지입니다." : request.video ? (Platform.OS === "web" ? "브라우저에서는 원본 영상을 전송합니다. 최대 25MB입니다." : "영상 크기를 줄여 전송합니다. 변환 후 최대 25MB입니다.") : "사진 크기를 줄여 더 빠르게 전송합니다."}</Text>
      <TextInput value={caption} onChangeText={setCaption} placeholder="설명 추가" multiline maxLength={1000} style={{ backgroundColor: colors.card, color: colors.foreground, padding: 16, borderRadius: 16, minHeight: 64 }} />
      {error ? <Text accessibilityRole="alert">{error}</Text> : null}
    </ScrollView>
  </View>;
}
export function ChatMediaPreview({ request }: { request: PreviewRequest | null }) {
  if (!request) return null;
  return <Modal visible presentationStyle="fullScreen" animationType="slide" onRequestClose={() => request.finish(null)}><SafeAreaProvider><Preview request={request} /></SafeAreaProvider></Modal>;
}
