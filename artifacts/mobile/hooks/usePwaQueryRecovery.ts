import { useEffect } from "react";
import { Platform } from "react-native";
import { useQueryClient } from "@tanstack/react-query";

/** Resume suspended reads without replaying trades, messages or other writes. */
export function usePwaQueryRecovery() {
  const client = useQueryClient();
  useEffect(() => {
    if (Platform.OS !== "web" || typeof document === "undefined") return;
    let hiddenAt: number | null = document.hidden ? Date.now() : null;
    let recovering = false;
    let disposed = false;
    const recover = async () => {
      if (disposed || recovering || document.hidden || !navigator.onLine) return;
      recovering = true;
      try {
        await client.cancelQueries({ type: "active", fetchStatus: "fetching" });
        if (!disposed) await client.invalidateQueries({ type: "active" });
      } finally {
        recovering = false;
      }
    };
    const visibility = () => {
      if (document.hidden) { hiddenAt = Date.now(); return; }
      const elapsed = hiddenAt === null ? 0 : Date.now() - hiddenAt;
      hiddenAt = null;
      if (elapsed >= 30000) void recover().catch(() => {});
    };
    const online = () => void recover().catch(() => {});
    const pageshow = (event: PageTransitionEvent) => {
      if (event.persisted) void recover().catch(() => {});
    };
    document.addEventListener("visibilitychange", visibility);
    window.addEventListener("online", online);
    window.addEventListener("pageshow", pageshow);
    return () => {
      disposed = true;
      document.removeEventListener("visibilitychange", visibility);
      window.removeEventListener("online", online);
      window.removeEventListener("pageshow", pageshow);
    };
  }, [client]);
}
