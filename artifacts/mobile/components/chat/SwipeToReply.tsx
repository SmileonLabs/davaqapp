import React, { useCallback, useMemo } from "react";
import { Platform, StyleSheet, View } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, {
  runOnJS,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withSpring,
} from "react-native-reanimated";
import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { useColors } from "@/hooks/useColors";

export function SwipeToReply({
  children,
  onReply,
}: {
  children: React.ReactNode;
  onReply?: () => void;
}) {
  const colors = useColors();
  const offset = useSharedValue(0);
  const armed = useSharedValue(false);
  const announced = useSharedValue(false);
  const reducedMotion = useReducedMotion();
  const reply = useCallback(() => onReply?.(), [onReply]);
  const selectionFeedback = useCallback(() => {
    void Haptics.selectionAsync().catch(() => {});
  }, []);
  // Recognition and movement run on the UI thread, independently of message renders.
  const gesture = useMemo(
    () =>
      Gesture.Pan()
        .enabled(!!onReply && Platform.OS !== "web")
        .activeOffsetX(-12)
        .failOffsetX(10)
        .failOffsetY([-10, 10])
        .onUpdate((event) => {
          offset.value = Math.min(0, Math.max(-84, event.translationX));
          const next = event.translationX <= -56;
          if (next && !announced.value) {
            announced.value = true;
            runOnJS(selectionFeedback)();
          }
          armed.value = next;
        })
        .onEnd(() => {
          if (armed.value) runOnJS(reply)();
        })
        .onFinalize(() => {
          armed.value = false;
          announced.value = false;
          offset.value = reducedMotion
            ? 0
            : withSpring(0, {
                stiffness: 320,
                damping: 30,
                mass: 0.8,
              });
        }),
    [
      onReply,
      reply,
      selectionFeedback,
      offset,
      armed,
      announced,
      reducedMotion,
    ],
  );
  const movement = useAnimatedStyle(() => ({
    transform: [{ translateX: offset.value }],
  }));
  const hint = useAnimatedStyle(() => ({
    opacity: Math.min(1, -offset.value / 56),
  }));
  if (!onReply || Platform.OS === "web") return <>{children}</>;
  return (
    <View style={{ flexShrink: 1, minWidth: 0, maxWidth: "100%" }}>
      <Animated.View pointerEvents="none" style={[styles.hint, hint]}>
        <Feather name="corner-up-left" size={21} color={colors.primary} />
      </Animated.View>
      <GestureDetector gesture={gesture}>
        <Animated.View
          accessibilityActions={[{ name: "reply", label: "답장" }]}
          onAccessibilityAction={(event) => {
            if (event.nativeEvent.actionName === "reply") reply();
          }}
          style={[{ flexShrink: 1, minWidth: 0, maxWidth: "100%" }, movement]}
        >
          {children}
        </Animated.View>
      </GestureDetector>
    </View>
  );
}

const styles = StyleSheet.create({
  hint: {
    position: "absolute",
    right: 8,
    top: 0,
    bottom: 0,
    justifyContent: "center",
  },
});
