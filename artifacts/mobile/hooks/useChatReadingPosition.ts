import { useEffect, useRef, useState, useCallback } from "react";
import { AppState } from "react-native";
import storage from "@/lib/chatHistoryStorage";
import {
  createReadingPositionStore,
  type ChatReadingPosition,
} from "@/lib/chatReadingPosition";
const positions = createReadingPositionStore(storage);
export function useChatReadingPosition(scope: string | null) {
  const [loaded, setLoaded] = useState<{
    scope: string | null;
    value: ChatReadingPosition | null;
  }>();
  const pending = useRef<{ scope: string; value: ChatReadingPosition } | null>(
    null,
  );
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const flush = useCallback(() => {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    const value = pending.current;
    pending.current = null;
    if (value) void positions.write(value.scope, value.value).catch(() => {});
  }, []);
  useEffect(() => {
    let active = true;
    if (!scope) {
      setLoaded({ scope, value: null });
      return;
    }
    void positions
      .read(scope)
      .catch(() => null)
      .then((value) => {
        if (active) setLoaded({ scope, value });
      });
    const subscription = AppState.addEventListener("change", (state) => {
      if (state !== "active") flush();
    });
    return () => {
      active = false;
      flush();
      subscription.remove();
    };
  }, [scope, flush]);
  const save = useCallback(
    (value: ChatReadingPosition) => {
      if (!scope) return;
      pending.current = { scope, value };
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(flush, 300);
    },
    [scope, flush],
  );
  return {
    ready: loaded?.scope === scope,
    position: loaded?.scope === scope ? loaded.value : null,
    save,
  };
}
