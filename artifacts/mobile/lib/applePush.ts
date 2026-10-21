import messaging from "@react-native-firebase/messaging";
import { Platform } from "react-native";
import { getApplePushInfo } from "./systemCalls";
export async function getApplePushCredentials(): Promise<string[]> {
  if (Platform.OS !== "ios") return [];
  const info = await getApplePushInfo();
  if (!info) {
    console.warn("Apple push registration unavailable: native push module missing");
    return [];
  }
  if (!info.voipToken) console.warn("Apple call registration pending: VoIP token unavailable");
  const tokens: string[] = [];
  if (info.voipToken) tokens.push(`voip:${info.environment}:${info.voipToken}`);
  try {
    await messaging().registerDeviceForRemoteMessages();
    const apns = await messaging().getAPNSToken();
    if (apns) tokens.push(`apns:${info.environment}:${apns.toLowerCase()}`);
  } catch (error) {
    console.warn("Apple notification registration unavailable", error instanceof Error ? error.message : "unknown");
  }
  return tokens;
}
