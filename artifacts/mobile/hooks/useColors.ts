import { useContext, useMemo } from "react";
import { useColorScheme } from "react-native";

import colors from "@/constants/colors";
import { ThemeModeContext } from "@/hooks/useThemeMode";

/**
 * Returns the design tokens for the active color scheme.
 *
 * The active scheme comes from the app's `ThemeModeProvider` (which resolves the
 * user's light/dark/system preference). When rendered outside the provider it
 * falls back to the device appearance, so the hook is always safe to call.
 */
export function useColors() {
  const ctx = useContext(ThemeModeContext);
  const system = useColorScheme();
  const scheme = ctx ? ctx.scheme : system === "dark" ? "dark" : "light";
  const palette = scheme === "dark" ? colors.dark : colors.light;
  return useMemo(
    () => ({
      ...palette,
      scrim: "rgba(24,20,40,0.42)",
      mediaCanvas: "#09090C",
      mediaForeground: "#FFFFFF",
      radius: colors.radius,
    }),
    [palette],
  );
}
