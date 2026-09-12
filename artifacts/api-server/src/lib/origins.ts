const DEFAULT_PRODUCTION_ORIGINS = ["https://davaq.anothermeai.app"];
const LOCAL_DEVELOPMENT_ORIGINS = [
  "http://localhost:8081",
  "http://localhost:19006",
  "http://localhost:3100",
  "http://127.0.0.1:8081",
  "http://127.0.0.1:19006",
  "http://127.0.0.1:3100",
];

export function normalizeOrigin(value: string | undefined): string | null {
  if (!value) return null;
  try {
    const origin = new URL(value).origin;
    return origin === "null" ? null : origin;
  } catch {
    return null;
  }
}

function configuredOrigins(): Set<string> {
  const configured = (process.env.CORS_ALLOWED_ORIGINS ?? "")
    .split(",")
    .map((origin) => normalizeOrigin(origin.trim()))
    .filter((origin): origin is string => !!origin);
  if (configured.length > 0) return new Set(configured);

  const defaults = [...DEFAULT_PRODUCTION_ORIGINS];
  if (process.env.NODE_ENV !== "production") {
    defaults.push(...LOCAL_DEVELOPMENT_ORIGINS);
    const replitOrigin = normalizeOrigin(process.env.REPLIT_DEV_DOMAIN);
    if (replitOrigin) defaults.push(replitOrigin);
  }
  return new Set(defaults);
}

export function isAllowedOrigin(value: string | undefined): boolean {
  const origin = normalizeOrigin(value);
  return !!origin && configuredOrigins().has(origin);
}
