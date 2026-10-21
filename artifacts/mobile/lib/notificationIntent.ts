import AsyncStorage from "@react-native-async-storage/async-storage";
const KEY = "pendingAppleNotificationRoute";
export async function stashNotificationRoute(data: Record<string, unknown> | undefined): Promise<void> {
  if (typeof data?.url !== "string" || !data.url.startsWith("/") || typeof data.recipientUserId !== "string") return;
  await AsyncStorage.setItem(KEY, JSON.stringify({ url: data.url, owner: data.recipientUserId, expiresAt: Date.now() + 5 * 60_000 }));
}
export async function consumeNotificationRoute(owner: string | null): Promise<string | null> {
  const raw = await AsyncStorage.getItem(KEY);
  if (!raw) return null;
  await AsyncStorage.removeItem(KEY);
  try {
    const value = JSON.parse(raw);
    return owner && value.owner === owner && value.expiresAt > Date.now() && typeof value.url === "string" && value.url.startsWith("/") ? value.url : null;
  } catch { return null; }
}
