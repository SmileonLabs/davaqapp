/** Shared foundations. Screen colors come from useColors; do not hard-code theme colors. */
export const fonts = {
  regular: "Inter_400Regular",
  medium: "Inter_500Medium",
  semibold: "Inter_600SemiBold",
  bold: "Inter_700Bold",
} as const;
export const fontSizes = {
  micro: 9,
  tiny: 10,
  small: 11,
  caption: 12,
  detail: 13,
  label: 14,
  body: 15,
  input: 16,
  headingSmall: 17,
  heading: 18,
  titleSmall: 19,
  titleMedium: 20,
  titleLarge: 21,
  hero: 22,
  heroLarge: 23,
  title: 24,
  displaySmall: 26,
  displayMedium: 28,
  banner: 31,
  display: 32,
} as const;

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  xxl: 24,
  section: 32,
} as const;
export const radii = { small: 8, control: 12, card: 12, pill: 999 } as const;
export const typography = {
  title: { fontFamily: fonts.bold, fontSize: fontSizes.title, lineHeight: 32 },
  heading: { fontFamily: fonts.semibold, fontSize: fontSizes.heading, lineHeight: 26 },
  body: { fontFamily: fonts.regular, fontSize: fontSizes.body, lineHeight: 22 },
  label: { fontFamily: fonts.semibold, fontSize: fontSizes.label, lineHeight: 20 },
  caption: { fontFamily: fonts.regular, fontSize: fontSizes.caption, lineHeight: 18 },
} as const;
export const interaction = {
  minTarget: 44,
  pressedOpacity: 0.78,
  motionMs: 180,
} as const;

