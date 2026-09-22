import { Platform } from "react-native";
import * as Location from "expo-location";
import { approximate, type Coordinate } from "./maps";
export async function currentMapPosition(): Promise<Coordinate> {
  // One foreground lookup, only after a user presses the location button.
  if (Platform.OS === "web")
    return new Promise((resolve, reject) => {
      if (!navigator.geolocation)
        return reject(
          new Error("현재 위치를 사용할 수 없어요. 지역을 직접 선택해 주세요."),
        );
      navigator.geolocation.getCurrentPosition(
        (p) =>
          resolve(
            approximate({ lat: p.coords.latitude, lng: p.coords.longitude }),
          ),
        (e) =>
          reject(
            new Error(
              e.code === 1
                ? "위치 권한이 꺼져 있어요. 지역 선택으로도 이용할 수 있어요."
                : "위치를 찾지 못했어요. 지역을 선택하거나 다시 시도해 주세요.",
            ),
          ),
        { enableHighAccuracy: false, timeout: 10000, maximumAge: 60000 },
      );
    });
  const permission = await Location.requestForegroundPermissionsAsync();
  if (!permission.granted)
    throw new Error("위치 권한 없이도 지역을 직접 선택할 수 있어요.");
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const p = await Promise.race([
      Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Balanced,
      }),
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () =>
            reject(
              new Error(
                "위치 확인이 늦어지고 있어요. 지역을 직접 선택해 주세요.",
              ),
            ),
          12000,
        );
      }),
    ]);
    return approximate({ lat: p.coords.latitude, lng: p.coords.longitude });
  } finally {
    if (timer) clearTimeout(timer);
  }
}
