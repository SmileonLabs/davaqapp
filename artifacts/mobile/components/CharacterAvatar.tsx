import { Image } from "expo-image";
import React from "react";
import { View, StyleSheet, type StyleProp, type ViewStyle } from "react-native";
import { useMediaUri } from "@/hooks/useMediaUri";
import { davaqAvatarUri } from "@/lib/davaqAvatarPolicy";
interface CharacterAvatarProps {
  uri?: string | null;
  fallbackSource?: number;
  crop?: "face" | "full";
  style?: StyleProp<ViewStyle>;
  borderRadius?: number;
}
export function CharacterAvatar({
  uri,
  style,
  borderRadius = 0,
}: CharacterAvatarProps) {
  const resolved = useMediaUri(davaqAvatarUri(uri));
  return (
    <View
      style={[
        { overflow: "hidden", backgroundColor: "#EEE7FF", borderRadius },
        style,
      ]}
    >
      <Image
        source={
          resolved
            ? { uri: resolved }
            : require("../assets/images/davaq/queue.png")
        }
        style={StyleSheet.absoluteFill}
        contentFit={resolved ? "cover" : "contain"}
      />
    </View>
  );
}
