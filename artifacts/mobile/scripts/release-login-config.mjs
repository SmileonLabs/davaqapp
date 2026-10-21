import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseEnv } from "node:util";

export function resolveReleaseLogin(settings) {
  const key = settings.EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY;
  if (!/^pk_(test|live)_[A-Za-z0-9+/=]+$/.test(key || ""))
    throw new Error("DavaQ release Clerk publishable key is missing or invalid.");
  const host = Buffer.from(key.split("_").slice(2).join("_"), "base64").toString("utf8").replace(/\$$/, "");
  if (!/^[a-z0-9.-]+$/.test(host) || !host.includes("."))
    throw new Error("DavaQ release Clerk host is invalid.");
  const api = settings.EXPO_PUBLIC_API_BASE_URL?.replace(/\/$/, "");
  if (api !== "https://davaq.app")
    throw new Error("DavaQ release API must use the approved production server.");
  return {
    EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY: key,
    EXPO_PUBLIC_API_BASE_URL: api,
    EXPO_PUBLIC_DOMAIN: new URL(api).host,
    // Clear inherited development proxy settings as well.
    EXPO_PUBLIC_CLERK_PROXY_URL: settings.EXPO_PUBLIC_CLERK_PROXY_URL || "",
  };
}

export function loadReleaseLogin(mobileRoot) {
  const file = resolve(mobileRoot, ".env.testflight.local");
  if (!existsSync(file)) throw new Error("Shared iOS/Android release settings are required in .env.testflight.local.");
  return resolveReleaseLogin(parseEnv(readFileSync(file, "utf8")));
}
