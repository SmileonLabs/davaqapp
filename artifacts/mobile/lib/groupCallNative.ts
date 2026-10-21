import {
  markSystemCallActive,
  endSystemCall,
  subscribeSystemCallActions,
} from "./systemCalls";
export async function activateGroupNative(
  id: string,
  _name: string,
  _roomId: string,
  _media: "audio" | "video",
  _creatorId: string,
) {
  await markSystemCallActive(id);
}
export const endGroupNative = endSystemCall;
export function subscribeGroupNative(
  id: string,
  end: () => void,
  mute: (muted: boolean) => void,
) {
  return subscribeSystemCallActions((event) => {
    if (event.intent.callId !== id) return;
    if (event.action === "end") end();
    if (event.action === "mute") mute(!!event.muted);
  });
}
