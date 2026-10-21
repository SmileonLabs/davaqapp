import React, { useCallback, useEffect, useSyncExternalStore } from "react";
const listeners = new Set();
function notify() {
  listeners.forEach((fn) => fn());
}
function navigate(url) {
  history.pushState({}, "", url);
  notify();
}
window.addEventListener("popstate", notify);
const router = {
  push: navigate,
  replace: (url) => {
    history.replaceState({}, "", url);
    notify();
  },
  back: () => history.back(),
  navigate,
};
export function useRouter() {
  return router;
}
export function useLocalSearchParams() {
  useSyncExternalStore(
    (fn) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    () => location.href,
  );
  return Object.fromEntries(new URLSearchParams(location.search));
}
export function useSegments() {
  return location.pathname.split("/").filter(Boolean);
}
export function usePathname() {
  useLocalSearchParams();
  return location.pathname;
}
export function useFocusEffect(fn) {
  useEffect(fn, [fn]);
}
export const Stack = Object.assign(() => null, { Screen: () => null });
