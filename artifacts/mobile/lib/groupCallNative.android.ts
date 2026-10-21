import { telecom, subscribeSystemCall } from "./androidTelecom.android";
import { getCurrentNativePushOwner } from "./nativePushOwner";
export async function activateGroupNative(
  id: string,
  name: string,
  roomId: string,
  media: "audio" | "video",
  creatorId: string,
) {
  const ownerId = await getCurrentNativePushOwner();
  if (!ownerId || !telecom) throw new Error("call_owner_unavailable");
  await telecom.startCall(
    JSON.stringify({
      callId: id,
      callerName: name,
      media,
      ownerId,
      chatRoomId: roomId,
      direction: creatorId === ownerId ? "outgoing" : "incoming",
      expiresAt: Date.now() + 45000,
    }),
  );
  await telecom.activate(id);
}
export async function endGroupNative(id?: string) {
  if (id) await telecom?.end(id);
}
export function subscribeGroupNative(
  id: string,
  end: () => void,
  mute: (muted: boolean) => void,
) {
  return subscribeSystemCall((event) => {
    if (event.callId !== id) return;
    if (event.kind === "end" || event.kind === "ended") end();
    if (event.kind === "mute") mute(event.value === "true");
  });
}
