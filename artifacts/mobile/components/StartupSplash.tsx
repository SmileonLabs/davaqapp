import React from "react";
import { Image, StyleSheet, View } from "react-native";

/** Matches the OS launch screen while fonts, authentication or routing initialize. */
export function StartupSplash() {
  return (
    <View accessible={false} accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={styles.cover}>
      <Image source={require("../assets/images/davaq/queue.png")} resizeMode="contain" style={styles.image} />
    </View>
  );
}
const styles = StyleSheet.create({
  cover: { flex: 1, backgroundColor: "#000000", alignItems: "center", justifyContent: "center" },
  image: { width: 240, height: 240 },
});
