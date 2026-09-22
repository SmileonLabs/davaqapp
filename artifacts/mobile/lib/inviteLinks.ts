import AsyncStorage from "@react-native-async-storage/async-storage";
const pendingKey = "davaq.pending-invite.v1";
export function parseInviteCode(value: string): string | null {
  const text = value.trim();
  if (/^[a-zA-Z0-9_-]{8,128}$/.test(text)) return text;
  try {
    const url = new URL(text);
    if (
      url.protocol === "https:" &&
      url.hostname === "davaq.anothermeai.app" &&
      url.pathname.startsWith("/app/invite/")
    )
      return parseInviteCode(
        decodeURIComponent(url.pathname.slice("/app/invite/".length)),
      );
  } catch {}
  return null;
}
export function inviteLink(code: string) {
  if (!parseInviteCode(code)) throw new Error("Invalid invitation");
  return "https://davaq.anothermeai.app/app/invite/" + encodeURIComponent(code);
}
export async function savePendingInvite(code: string) {
  const valid = parseInviteCode(code);
  if (valid) await AsyncStorage.setItem(pendingKey, valid);
}
export async function loadPendingInvite() {
  return parseInviteCode((await AsyncStorage.getItem(pendingKey)) ?? "");
}
export async function clearPendingInvite() {
  await AsyncStorage.removeItem(pendingKey);
}
