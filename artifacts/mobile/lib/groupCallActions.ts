export function isGroupCallId(id: string): boolean {
  return /^da7a0001-/i.test(id);
}
type Handler = (id: string, action: "join" | "decline") => Promise<boolean>;
let handler: Handler | null = null;
let busy = false;
export const isGroupCallBusy = () => busy;
export function registerGroupCallHandler(next: Handler) {
  handler = next;
  return () => {
    if (handler === next) {
      handler = null;
      busy = false;
    }
  };
}
export function setGroupCallBusy(value: boolean) {
  busy = value;
}
export async function dispatchGroupCallAction(
  id: string,
  action: "join" | "decline",
) {
  return handler ? handler(id, action) : false;
}
