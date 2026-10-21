import React, { useEffect, useState } from "react";
import { Modal, Platform, Pressable, Text, View } from "react-native";
import { SafeAreaProvider, useSafeAreaInsets } from "react-native-safe-area-context";
import { useVideoPlayer, VideoView } from "expo-video";
import { useAuth } from "@/lib/davaqAuth";
import { getChatVideoFile } from "@/lib/chatVideoCache";
import { resolveMediaUri } from "@/hooks/useMediaUri";
import * as MediaLibrary from "expo-media-library";
function Video({ uri, onClose }: { uri: string; onClose: () => void }) {
  const insets = useSafeAreaInsets();
  const player = useVideoPlayer(uri);
  const [saving,setSaving] = useState(false), [feedback,setFeedback] = useState("");
  const save = async () => {
    if(saving)return;setSaving(true);setFeedback("");
    try {
      if(Platform.OS === "web") { const a=document.createElement("a");a.href=uri;a.download="davaq-video.mp4";a.click(); }
      else { const permission=await MediaLibrary.requestPermissionsAsync(true, ["video"]);if(!permission.granted)throw Error("permission");await MediaLibrary.saveToLibraryAsync(uri);setFeedback("갤러리에 저장했습니다."); }
    } catch {setFeedback("저장하지 못했습니다. 사진 접근 권한과 연결을 확인해 주세요.");}finally{setSaving(false);}
  };
  return <View style={{ flex: 1, backgroundColor: "#09090C", paddingTop: Math.max(insets.top, Platform.OS === "ios" ? 44 : 24) + 8, paddingBottom: insets.bottom }}>
    <View style={{flexDirection:"row",justifyContent:"space-between",paddingHorizontal:24}}>
      <Pressable accessibilityRole="button" accessibilityLabel="영상 저장" onPress={() => void save()} disabled={saving} style={{minHeight:48,justifyContent:"center"}}><Text style={{color:"white"}}>{saving ? "저장 중" : "영상 저장"}</Text></Pressable>
      <Pressable accessibilityRole="button" accessibilityLabel="영상 닫기" onPress={onClose} style={{ minHeight: 48, justifyContent: "center", paddingHorizontal: 16 }}><Text style={{ color: "white" }}>닫기 ✕</Text></Pressable>
    </View>
    {feedback ? <Text accessibilityRole="alert" style={{color:"white",paddingHorizontal:24}}>{feedback}</Text> : null}
    <VideoView player={player} nativeControls contentFit="contain" style={{ flex: 1 }} />
  </View>;
}
function Loading({ onClose, error }: {onClose:()=>void;error:boolean}) {
  const insets = useSafeAreaInsets();
  return <View style={{flex:1,backgroundColor:"#09090C",paddingTop:Math.max(insets.top,Platform.OS === "ios" ? 44:24)+8,paddingHorizontal:24}}><Pressable accessibilityRole="button" accessibilityLabel="영상 닫기" onPress={onClose} style={{minHeight:48,justifyContent:"center"}}><Text style={{color:"white"}}>닫기 ✕</Text></Pressable><Text style={{color:"white"}}>{error ? "영상을 불러오지 못했습니다. 닫은 뒤 다시 시도해 주세요." : "영상 준비 중…"}</Text></View>;
}
export function ChatVideoViewer(props: { uri: string; onClose: () => void }) {
  const { userId } = useAuth();
  const [local,setLocal] = useState<string>(), [error,setError] = useState(false);
  useEffect(() => { let current=true;setLocal(undefined);setError(false);
    void getChatVideoFile(userId ?? "signed-out",props.uri,()=>resolveMediaUri(props.uri)).then(uri=>{if(current)setLocal(uri);}).catch(()=>{if(current)setError(true);});
    return ()=>{current=false;};
  },[props.uri,userId]);
  return <Modal visible presentationStyle="fullScreen" onRequestClose={props.onClose}><SafeAreaProvider>{local ? <Video uri={local} onClose={props.onClose} /> : <Loading onClose={props.onClose} error={error} />}</SafeAreaProvider></Modal>;
}
