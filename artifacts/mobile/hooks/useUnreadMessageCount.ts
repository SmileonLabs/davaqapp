import React from "react";
import { AppState, Platform } from "react-native";
import { useAuth } from "@/lib/davaqAuth";
import {
  getListRoomsQueryKey,
  getGetMeQueryKey,
  useGetMe,
  useListRooms,
} from "@workspace/api-client-react";

export function useUnreadMessageCount() {
  const { isSignedIn } = useAuth();
  const { data: me } = useGetMe({
    query: { enabled: !!isSignedIn, queryKey: getGetMeQueryKey() },
  });
  const {
    data: rooms = [],
    refetch,
    isSuccess,
    dataUpdatedAt,
  } = useListRooms({
    query: { enabled: !!isSignedIn, queryKey: getListRoomsQueryKey() },
  });

  React.useEffect(() => {
    if (!isSignedIn) return;
    const refresh = () => {
      void refetch();
    };
    const appStateSub = AppState.addEventListener("change", (state) => {
      if (state === "active") refresh();
    });
    if (
      Platform.OS === "web" &&
      typeof window !== "undefined" &&
      typeof document !== "undefined"
    ) {
      const onFocus = () => refresh();
      const onVisibility = () => {
        if (document.visibilityState === "visible") refresh();
      };
      window.addEventListener("focus", onFocus);
      document.addEventListener("visibilitychange", onVisibility);
      return () => {
        appStateSub.remove();
        window.removeEventListener("focus", onFocus);
        document.removeEventListener("visibilitychange", onVisibility);
      };
    }
    return () => appStateSub.remove();
  }, [isSignedIn, refetch]);

  const count = React.useMemo(
    () =>
      isSignedIn
        ? rooms.reduce(
            (sum, room) => sum + Math.max(0, room.unreadCount ?? 0),
            0,
          )
        : 0,
    [isSignedIn, rooms],
  );

  const refreshUnread = React.useCallback(() => { void refetch(); }, [refetch]);
  return {
    count,
    rooms,
    ownerId: isSignedIn ? me?.id : undefined,
    ready: !!isSignedIn && isSuccess,
    dataUpdatedAt,
    refetch: refreshUnread,
  };
}
