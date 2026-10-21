export type AppleDevice = { kind: "apns" | "voip"; environment: "production" | "sandbox"; token: string };
export function parseAppleDevice(value: string): AppleDevice | null {
  const match = /^(apns|voip):(production|sandbox):([a-f0-9]{64,200})$/.exec(value);
  return match ? { kind: match[1] as AppleDevice["kind"], environment: match[2] as AppleDevice["environment"], token: match[3]! } : null;
}
export function applePushRequest(device: AppleDevice, bundle: string, data: Record<string, unknown>, title: string, body: string, now = Date.now()) {
  const incoming = data.type === "incoming_call";
  if (device.kind === "voip" && !incoming) return null;
  if (device.kind === "apns" && incoming) return null;
  const deadline = Number(data.expiresAt);
  if (incoming && (!Number.isFinite(deadline) || deadline <= now)) return null;
  const terminal = typeof data.type === "string" && /^call_(ended|declined|missed|cancelled|failed)$/.test(data.type);
  const aps = device.kind === "voip" || terminal
    ? { "content-available": 1 }
    : { alert: { title, body }, sound: "default", "mutable-content": 0 };
  return {
    headers: {
      "apns-topic": bundle + (device.kind === "voip" ? ".voip" : ""),
      "apns-push-type": device.kind === "voip" ? "voip" : terminal ? "background" : "alert",
      "apns-priority": terminal ? "5" : "10",
      // VoIP calls must not be stored and delivered after the ringing window.
      "apns-expiration": incoming || terminal ? "0" : String(Math.floor(now / 1000) + 3600),
    },
    payload: { ...data, aps },
  };
}
