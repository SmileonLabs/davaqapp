import { useMemo } from "react";
import { useColors } from "@/hooks/useColors";
import { fontSizes, radii } from "@/constants/designSystem";
import React, { useEffect, useRef, useState } from "react";
import { AccessibilityInfo, Animated, Modal, Pressable, StyleSheet, Text, View } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { Feather } from "@expo/vector-icons";
import { SafeAreaView } from "react-native-safe-area-context";
import { Avatar } from "@/components/Avatar";

type Props = {
  visible: boolean;
  name: string;
  imageUri?: string;
  characterType?: string | null;
  video: boolean;
  onAccept: () => void;
  onAcceptAudio?: () => void;
  overlay?:React.ReactNode;
  onCloseOverlay?:()=>void;
  onDecline: () => void;
};

/** App foreground surface; system CallKit/Telecom remains responsible for locked devices. */
export function IncomingCallScreen({ visible, name, imageUri, characterType, video, onAccept, onAcceptAudio, onDecline,overlay,onCloseOverlay }: Props) {
  const styleColors = useColors();
  const styles = useMemo(() => makeStyles(styleColors), [styleColors]);

  const pulse = useRef(new Animated.Value(0)).current;
  const [reduceMotion, setReduceMotion] = useState(true);
  useEffect(() => {
    let mounted = true;
    AccessibilityInfo.isReduceMotionEnabled().then(value => { if (mounted) setReduceMotion(value); }).catch(() => {});
    const subscription = AccessibilityInfo.addEventListener("reduceMotionChanged", setReduceMotion);
    return () => { mounted = false; subscription.remove(); };
  }, []);
  useEffect(() => {
    pulse.setValue(0);
    if (!visible || reduceMotion) return;
    const animation = Animated.loop(Animated.sequence([
      Animated.timing(pulse, { toValue: 1, duration: 1700, useNativeDriver: true }),
      Animated.timing(pulse, { toValue: 0, duration: 1700, useNativeDriver: true }),
    ]));
    animation.start();
    return () => animation.stop();
  }, [visible, reduceMotion, pulse]);
  return (
    <Modal visible={visible} animationType="fade" onRequestClose={() => {if(overlay)onCloseOverlay?.();}} statusBarTranslucent navigationBarTranslucent>
      <LinearGradient colors={[styleColors.card, "#5730A6", "#7651D6"]} style={styles.screen}>
        <SafeAreaView style={styles.safe}>
          <View style={styles.brand}><View style={styles.brandDot} /><Text style={styles.brandText}>DavaQ</Text></View>
          <View style={styles.identity}>
            <Text style={styles.kind}>{video ? "영상통화가 왔어요" : "전화가 왔어요"}</Text>
            <View style={styles.portrait}>
              <Animated.View pointerEvents="none" style={[styles.halo, { opacity: pulse.interpolate({ inputRange: [0, 1], outputRange: [0.25, 0.65] }), transform: [{ scale: pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 1.13] }) }] }]} />
              <View style={styles.avatarBorder}><Avatar name={name} uri={imageUri} size={128} crop="face" characterType={characterType} /></View>
              <View style={styles.mediaBadge}><Feather name={video ? "video" : "phone"} size={20} color={styleColors.primaryForeground} /></View>
            </View>
            <Text style={styles.name} numberOfLines={2}>{name || "DavaQ 친구"}</Text>
            <Text style={styles.subtitle}>{video ? "얼굴을 보며 이야기해요" : "목소리로 연결되는 순간"}</Text>
          </View>
          {video && onAcceptAudio && <Pressable accessibilityRole="button" accessibilityLabel="카메라 없이 음성으로 받기" onPress={onAcceptAudio} style={{padding:16,alignItems:'center'}}><Text style={{color:styleColors.primaryForeground,fontWeight:'600'}}>음성으로 받기 · 카메라 꺼짐</Text></Pressable>}
          <View style={styles.actions}>
            <View style={styles.action}>
              <Pressable accessibilityRole="button" accessibilityLabel="전화 거절" onPress={onDecline} style={({ pressed }) => [styles.button, styles.decline, pressed && styles.pressed]}><Feather name="phone-off" size={30} color="white" /></Pressable>
              <Text style={styles.label}>거절</Text>
            </View>
            <View style={styles.action}>
              <Pressable accessibilityRole="button" accessibilityLabel={video ? "영상통화 받기" : "전화 받기"} onPress={onAccept} style={({ pressed }) => [styles.button, styles.accept, pressed && styles.pressed]}><Feather name={video ? "video" : "phone"} size={30} color="white" /></Pressable>
              <Text style={styles.label}>받기</Text>
            </View>
          </View>
        </SafeAreaView>
        {overlay}
      </LinearGradient>
    </Modal>
  );
}
const makeStyles = (styleColors: ReturnType<typeof useColors>) => StyleSheet.create({
  screen: { flex: 1 }, safe: { flex: 1, paddingHorizontal: 28, paddingVertical: 24 },
  brand: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8 }, brandDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: styleColors.secondary }, brandText: { color: styleColors.foreground, fontSize: fontSizes.headingSmall, fontWeight: "600", letterSpacing: 1 },
  identity: { flex: 1, alignItems: "center", justifyContent: "center", gap: 18 }, kind: { color: styleColors.mutedForeground, fontSize: 16, marginBottom: 16 },
  portrait: { width: 176, height: 176, alignItems: "center", justifyContent: "center", marginBottom: 12 }, halo: { position: "absolute", width: 174, height: 174, borderRadius: 87, borderWidth: 1, borderColor: styleColors.border, backgroundColor: styleColors.secondary }, avatarBorder: { padding: 5, borderRadius: 72, backgroundColor: styleColors.secondary }, mediaBadge: { position: "absolute", bottom: 12, right: 20, width: 38, height: 38, borderRadius: 19, alignItems: "center", justifyContent: "center", backgroundColor: styleColors.primary, borderWidth: 3, borderColor: styleColors.border },
  name: { color: styleColors.foreground, fontSize: 32, fontWeight: "700", textAlign: "center" }, subtitle: { color: styleColors.mutedForeground, fontSize: 14, textAlign: "center" },
  actions: { flexDirection: "row", justifyContent: "space-around", paddingBottom: 28, paddingTop: 30 }, action: { alignItems: "center", gap: 14 }, button: { width: 78, height: 78, borderRadius: 39, alignItems: "center", justifyContent: "center" }, decline: { backgroundColor: styleColors.destructive }, accept: { backgroundColor: styleColors.online }, pressed: { transform: [{ scale: 0.94 }], opacity: 0.85 }, label: { color: styleColors.foreground, fontSize: 16, fontWeight: "600" },
});
