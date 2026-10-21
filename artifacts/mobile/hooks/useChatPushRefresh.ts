import { refreshChatsOnResume } from "@/lib/chatResumeRefresh";
import { useEffect } from "react";
import { AppState, Platform } from "react-native";
import { useQueryClient } from "@tanstack/react-query";
import { getListRoomsQueryKey, useGetMe } from "@workspace/api-client-react";
import { useCharacterProfiles } from "./useCharacterProfiles";
import { subscribeChatPush } from "@/lib/chatPushRefresh";
import { refreshLatestRoomMessages } from "@/lib/chatLatestRefresh";

/** Mounted at session scope, including while the notified room is closed. */
export function useChatPushRefresh() {
  const client = useQueryClient();
  const { data: me } = useGetMe();
  const { activeProfile } = useCharacterProfiles();
  useEffect(() => {
    if (!me?.id || !activeProfile?.id) return;
    const controller = new AbortController();
    let resumeController: AbortController | null = null;
    const resume = () => {
      const visible = Platform.OS === "web"
        ? typeof document !== "undefined" && document.visibilityState === "visible"
        : AppState.currentState === "active";
      if (!visible) {
        resumeController?.abort();
        resumeController = null;
        return;
      }
      // pageshow and visibility can arrive together: share one resume pass.
      if (resumeController && !resumeController.signal.aborted) return;
      const request = new AbortController();
      resumeController = request;
      void refreshChatsOnResume(client, request.signal).catch(() => {}).finally(() => {
        if (resumeController === request) resumeController = null;
      });
    };
    const appState = Platform.OS !== "web" ? AppState.addEventListener("change", resume) : null;
    if (Platform.OS === "web" && typeof window !== "undefined") {
      document.addEventListener("visibilitychange", resume);
      window.addEventListener("pageshow", resume);
      window.addEventListener("online", resume);
    }
    resume(); // Cold start also runs after account/profile hydration.

    const refresh = (roomId: string) => {
      void refreshLatestRoomMessages(client, roomId, controller.signal).catch(() => {});
      void client.invalidateQueries({ queryKey: getListRoomsQueryKey() });
    };
    const unsubscribe = subscribeChatPush(refresh);
    const onMessage = (event: MessageEvent) => {
      if (event.data?.type === "data-changed" && typeof event.data.roomId === "string") refresh(event.data.roomId);
    };
    if (Platform.OS === "web" && typeof navigator !== "undefined") navigator.serviceWorker?.addEventListener("message", onMessage);
    return () => {
      controller.abort();
      resumeController?.abort();
      appState?.remove();
      if (Platform.OS === "web" && typeof window !== "undefined") {
        document.removeEventListener("visibilitychange", resume);
        window.removeEventListener("pageshow", resume);
        window.removeEventListener("online", resume);
      }
      unsubscribe();
      if (Platform.OS === "web" && typeof navigator !== "undefined") navigator.serviceWorker?.removeEventListener("message", onMessage);
    };
  }, [client, me?.id, activeProfile?.id]);
}
