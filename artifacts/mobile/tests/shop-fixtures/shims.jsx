import React, { useCallback } from "react";
import { useDavaq } from "./api";
export const Feather = () => null;
export const LinearGradient = ({ children }) => <div>{children}</div>;
export const useSafeAreaInsets = () => ({
  top: 0,
  right: 0,
  bottom: 0,
  left: 0,
});
export const useMediaUri = (value) => value;
export function CardArt() {
  return (
    <div
      aria-label="테스트 카드 사진"
      style={{ width: 56, height: 78, background: "#dedede" }}
    />
  );
}
export function useCachedTcgScans() {
  return useDavaq("/tcg/scans");
}
export const createURL = (path, { queryParams } = {}) =>
  location.origin +
  "/" +
  path +
  (queryParams ? "?" + new URLSearchParams(queryParams) : "");
export const useAuth = () => ({
  isSignedIn: true,
  userId: window.fixtureActor,
  getToken: useCallback(async () => window.fixtureActor, []),
});
export const requestCameraPermissionsAsync = async () => ({ granted: true });
export const launchCameraAsync = async () => ({ canceled: true });
export const launchImageLibraryAsync = async () => ({ canceled: true });
export const manipulateAsync = async () => ({ uri: "fixture-image" });
export const SaveFormat = { JPEG: "jpeg" };
export const pickAndUploadImage = async () => null;
export const getFetchRoomMessagesQueryKey = (id) => [
  "/api/rooms/" + id + "/messages",
];
export const getGetMeQueryKey = () => ["/api/users/me"];
export const getGetCallQueryKey = (id) => ["call", id];
export const getGetRoomQueryKey = (id) => ["room", id];
export const getGetTypingUsersQueryKey = (id) => ["typing", id];
export const getListIncomingCallsQueryKey = () => ["calls"];
export const getListRoomsQueryKey = () => ["rooms"];
export default {
  addEventListener: () => () => {},
  fetch: async () => ({ isConnected: true, isInternetReachable: true }),
};
