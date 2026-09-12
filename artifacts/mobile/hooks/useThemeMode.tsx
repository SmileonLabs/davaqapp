import AsyncStorage from "@react-native-async-storage/async-storage";
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { useColorScheme } from "react-native";

export type ThemeMode = "light" | "dark" | "system";
export type ColorScheme = "light" | "dark";

interface ThemeModeValue {
  /** The user's preference: explicit light/dark or follow the device ("system"). */
  mode: ThemeMode;
  /** The effective scheme after resolving "system" against the device setting. */
  scheme: ColorScheme;
  setMode: (mode: ThemeMode) => void;
}

export const ThemeModeContext = createContext<ThemeModeValue | null>(null);

const STORAGE_KEY = "davaq:themeMode:v1";

/**
 * Holds the app-wide theme preference. "system" follows the device appearance;
 * "light"/"dark" override it. The choice is persisted (AsyncStorage → web
 * localStorage) so it survives reloads. `useColors` reads the resolved scheme
 * from here, so every screen reacts automatically.
 */
export function ThemeModeProvider({ children }: { children: React.ReactNode }) {
  const system = useColorScheme();
  const [mode, setModeState] = useState<ThemeMode>("light");
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    AsyncStorage.getItem(STORAGE_KEY)
      .then((v) => {
        if (v === "light" || v === "dark" || v === "system") setModeState(v);
      })
      .catch(() => {})
      .finally(() => setHydrated(true));
  }, []);

  const setMode = useCallback((next: ThemeMode) => {
    setModeState(next);
    AsyncStorage.setItem(STORAGE_KEY, next).catch(() => {});
  }, []);

  const scheme: ColorScheme =
    mode === "system" ? (system === "dark" ? "dark" : "light") : mode;

  const value = useMemo<ThemeModeValue>(
    () => ({ mode, scheme, setMode }),
    [mode, scheme, setMode],
  );

  return (
    <ThemeModeContext.Provider value={value}>
      {hydrated ? children : null}
    </ThemeModeContext.Provider>
  );
}

export function useThemeMode(): ThemeModeValue {
  const ctx = useContext(ThemeModeContext);
  if (!ctx) {
    throw new Error("useThemeMode must be used within ThemeModeProvider");
  }
  return ctx;
}
