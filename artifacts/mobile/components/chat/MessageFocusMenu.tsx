import React, { useEffect, useRef } from "react";
import * as Haptics from "expo-haptics";
import { useReducedMotion } from "react-native-reanimated";
import {
  Modal,
  Platform,
  Animated,
  Pressable,
  View,
  ScrollView,
  useWindowDimensions,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useColors } from "@/hooks/useColors";
import { focusLayout, type MessageAnchor } from "@/lib/chatInteractionPolicy";

export function MessageFocusMenu({
  visible,
  onClose,
  onDismiss,
  anchor,
  preview,
  reactions,
  children,
}: {
  visible: boolean;
  title?: string;
  onClose: () => void;
  onDismiss?: () => void;
  anchor?: MessageAnchor;
  preview?: React.ReactNode;
  reactions?: React.ReactNode;
  children: React.ReactNode;
}) {
  const { width, height } = useWindowDimensions();
  const insets = useSafeAreaInsets(),
    colors = useColors();
  const scale = useRef(new Animated.Value(1)).current;
  const reducedMotion = useReducedMotion();
  useEffect(() => {
    if (!visible) return;
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(
      () => {},
    );
    scale.setValue(reducedMotion ? 1 : 0.94);
    if (!reducedMotion)
      Animated.spring(scale, {
        toValue: 1,
        stiffness: 360,
        damping: 13,
        mass: 0.65,
        useNativeDriver: Platform.OS !== "web",
      }).start();
    return () => scale.stopAnimation();
  }, [visible, reducedMotion, scale]);
  const layout = focusLayout(anchor, width, height, insets.top, insets.bottom);
  return (
    <Modal
      transparent
      visible={visible}
      animationType="fade"
      onRequestClose={onClose}
      onDismiss={onDismiss}
      statusBarTranslucent
    >
      <View style={{ flex: 1 }} accessibilityViewIsModal>
        <Pressable
          accessibilityLabel="메시지 메뉴 닫기"
          onPress={onClose}
          style={{
            position: "absolute",
            inset: 0,
            backgroundColor: "rgba(0,0,0,0.65)",
          }}
        />
        {reactions && (
          <View
            style={{
              position: "absolute",
              top: layout.y - 56,
              left: Math.max(
                12,
                Math.min(layout.x, width - Math.min(340, width - 24) - 12),
              ),
              width: Math.min(340, width - 24),
              backgroundColor: colors.card,
              borderRadius: 24,
            }}
          >
            {reactions}
          </View>
        )}
        <Animated.View
          pointerEvents="none"
          style={{
            position: "absolute",
            transform: [{ scale }],
            left: layout.x,
            top: layout.y,
            width: layout.width,
            maxHeight: layout.previewHeight,
            overflow: "hidden",
            borderRadius: 16,
          }}
        >
          {preview}
        </Animated.View>
        <View
          style={{
            position: "absolute",
            top: layout.y + layout.previewHeight + 8,
            left: Math.max(
              12,
              Math.min(layout.x, width - Math.min(340, width - 24) - 12),
            ),
            width: Math.min(340, width - 24),
            maxHeight: layout.menuHeight,
            backgroundColor: colors.card,
            borderRadius: 20,
            overflow: "hidden",
          }}
        >
          <ScrollView keyboardShouldPersistTaps="handled" bounces={false}>
            {children}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}
