import { useCallback, useState } from "react";
import { useFocusEffect } from "expo-router";
/** Navigation focus gates background tab polling without extra dependencies. */
export function useScreenActive() {
  const [active, setActive] = useState(false);
  useFocusEffect(
    useCallback(() => {
      setActive(true);
      return () => setActive(false);
    }, []),
  );
  return active;
}
