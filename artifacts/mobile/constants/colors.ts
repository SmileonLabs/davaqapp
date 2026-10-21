const colors = {
  light: {
    text: "#111111",
    tint: "#111111",

    background: "#FFFFFF",
    foreground: "#111111",

    card: "#FFFFFF",
    cardForeground: "#111111",

    primary: "#111111",
    primaryForeground: "#FFFFFF",

    secondary: "#F3F3F3",
    secondaryForeground: "#111111",

    muted: "#F7F7F7",
    mutedForeground: "#777777",

    accent: "#F3F3F3",
    accentForeground: "#111111",

    destructive: "#FF3B30",
    destructiveForeground: "#FFFFFF",

    border: "#EAEAEA",
    input: "#F5F5F5",

    myBubble: "#111111",
    myBubbleText: "#FFFFFF",
    otherBubble: "#F3F3F3",
    otherBubbleText: "#111111",

    destructiveMuted: "#FFEAE8",

    online: "#34C759",
  },
  dark: {
    text: "#F5F5F5",
    tint: "#FFFFFF",

    background: "#111111",
    foreground: "#F5F5F5",

    card: "#191919",
    cardForeground: "#F5F5F5",

    primary: "#EEEEEE",
    primaryForeground: "#111111",

    secondary: "#252525",
    secondaryForeground: "#F5F5F5",

    muted: "#202020",
    mutedForeground: "#AAAAAA",

    accent: "#333333",
    accentForeground: "#FFFFFF",

    destructive: "#FF453A",
    destructiveForeground: "#FFFFFF",

    border: "#333333",
    input: "#222222",

    myBubble: "#444444",
    myBubbleText: "#FFFFFF",
    otherBubble: "#252525",
    otherBubbleText: "#F5F5F5",

    destructiveMuted: "#3A1F1F",

    online: "#30D158",
  },
  radius: 12,
};

/** Reusable gradient ramps (tuples typed for expo-linear-gradient). */
export const gradients = {
  /** Primary call-to-action button. */
  cta: ["#242424", "#111111"] as const,
  /** Soft lavender surface for highlighted cards (light mode). */
  soft: ["#F4F4F4", "#FAFAFA"] as const,
};

/** Dark-mode counterparts of {@link gradients}. */
export const gradientsDark = {
  cta: ["#333333", "#444444"] as const,
  /** Deep lavender surface for highlighted cards (dark mode). */
  soft: ["#252525", "#252525"] as const,
};

/** Compatibility aliases for older screens; new UI uses useColors and designSystem. */
export const neon = {
  background: colors.light.background,
  panel: colors.light.card,
  panelSoft: colors.light.card,
  line: colors.light.border,
  glow: colors.light.accent,
  purple: colors.light.primary,
  magenta: "#C53FA1",
  cyan: "#148A88",
  blue: "#526DFF",
  gold: "#A47500",
  text: colors.light.foreground,
  muted: colors.light.mutedForeground,
} as const;

export default colors;
