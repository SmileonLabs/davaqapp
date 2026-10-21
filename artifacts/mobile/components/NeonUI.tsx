import { useMemo } from "react";
import { useColors } from "@/hooks/useColors";
import { fonts, fontSizes, interaction, typography, spacing, radii } from "@/constants/designSystem";
import { LinearGradient } from "expo-linear-gradient";
import React from "react";
import { Pressable, StyleSheet, Text, View, type PressableProps, type ViewProps } from "react-native";


export function NeonBackdrop({ children, style, ...props }: ViewProps) {
  const styleColors = useColors();
  const styles = useMemo(() => makeStyles(styleColors), [styleColors]);

  return (
    <View {...props} style={[styles.backdrop, style]}>
      <View pointerEvents="none" style={[styles.orb, styles.orbTop]} />
      <View pointerEvents="none" style={[styles.orb, styles.orbBottom]} />
      {children}
    </View>
  );
}

export function NeonCard({ children, style, ...props }: ViewProps) {
  const styleColors = useColors();
  const styles = useMemo(() => makeStyles(styleColors), [styleColors]);

  return <View {...props} style={[styles.card, style]}>{children}</View>;
}

export function NeonButton({ children, style, ...props }: PressableProps) {
  const styleColors = useColors();
  const styles = useMemo(() => makeStyles(styleColors), [styleColors]);

  return (
    <Pressable
      {...props}
      style={(state) => [
        styles.buttonWrap,
        state.pressed && styles.pressed,
        typeof style === "function" ? style(state) : style,
      ]}
    >
      {(state) => (
        <LinearGradient colors={[styleColors.primary, styleColors.primary]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.button}>
          {typeof children === "function" ? children(state) : typeof children === "string" ? <Text style={styles.buttonText}>{children}</Text> : children}
        </LinearGradient>
      )}
    </Pressable>
  );
}

export function NeonSectionTitle({ children, action }: { children: React.ReactNode; action?: React.ReactNode }) {
  const styleColors = useColors();
  const styles = useMemo(() => makeStyles(styleColors), [styleColors]);

  return (
    <View style={styles.sectionHeader}>
      <Text style={styles.sectionTitle}>{children}</Text>
      {action}
    </View>
  );
}

const makeStyles = (styleColors: ReturnType<typeof useColors>) => StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: styleColors.background, overflow: "hidden" },
  orb: { position: "absolute", width: 260, height: 260, borderRadius: 130, backgroundColor: styleColors.accent, opacity: 0.16 },
  orbTop: { right: -150, top: -110 },
  orbBottom: { left: -170, bottom: 60 },
  card: { backgroundColor: styleColors.card, borderWidth: 1, borderColor: styleColors.border, borderRadius: radii.card, padding: 16 },
  buttonWrap: { borderRadius: radii.pill, overflow: "hidden" },
  button: { minHeight: interaction.minTarget, paddingHorizontal: spacing.xl, alignItems: "center", justifyContent: "center" },
  buttonText: { color: styleColors.primaryForeground, ...typography.label },
  pressed: { opacity: interaction.pressedOpacity, transform: [{ scale: 0.99 }] },
  sectionHeader: { minHeight: 34, flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  sectionTitle: { color: styleColors.foreground, ...typography.heading },
});
