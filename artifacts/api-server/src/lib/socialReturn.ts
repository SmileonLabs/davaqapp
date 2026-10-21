// The provider callback remains on its registered host. Only these fixed
// destinations may receive the browser after the callback; no credentials or
// user-supplied redirect URLs are ever appended to them.
export const socialReturnCookie = "__Host-davaq_oauth_return";
export type SocialReturn = "web" | "legacy-web" | "app";
const destinations: Record<SocialReturn, string> = {
  web: "https://davaq.app/app/sso-callback",
  "legacy-web": "https://davaq.anothermeai.app/app/sso-callback",
  app: "davaq://sso-callback",
};
export function socialReturnForOrigin(origin: string | undefined): SocialReturn | null {
  if (!origin) return "app";
  if (origin === "https://davaq.app") return "web";
  if (origin === "https://davaq.anothermeai.app") return "legacy-web";
  return null;
}
export function isSocialReturn(value: unknown): value is SocialReturn {
  return value === "web" || value === "legacy-web" || value === "app";
}
export function socialReturnDestination(cookie: string, state: string): string | null {
  const prefix = state + ".";
  if (!cookie.startsWith(prefix)) return null;
  const target = cookie.slice(prefix.length);
  return isSocialReturn(target) ? destinations[target] : null;
}
