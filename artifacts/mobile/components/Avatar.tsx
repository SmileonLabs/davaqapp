import { Image } from "expo-image";
import React from "react";
import { View } from "react-native";
import { useMediaUri } from "@/hooks/useMediaUri";
import { davaqAvatarUri } from "@/lib/davaqAvatarPolicy";
interface AvatarProps {
  uri?: string | null;
  name: string;
  size?: number;
  crop?: "default" | "face";
  characterType?: string | null;
}
export function Avatar({ uri, size = 44 }: AvatarProps) {
  const resolved = useMediaUri(davaqAvatarUri(uri));
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        overflow: "hidden",
        backgroundColor: "#EEE7FF",
      }}
    >
      <Image
        source={
          resolved
            ? { uri: resolved }
            : require("../assets/images/davaq/queue.png")
        }
        style={{ width: size, height: size }}
        contentFit={resolved ? "cover" : "contain"}
      />
    </View>
  );
}
