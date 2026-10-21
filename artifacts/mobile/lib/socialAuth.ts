export type SocialProvider = "oauth_google" | "oauth_apple";

// Web is served below /app; native callbacks use the existing DAVAQ scheme.
export function socialCallbackUrl(platform: string, origin?: string): string {
  if (platform !== "web") return "davaq://sso-callback";
  if (!origin) throw new Error("로그인 페이지 주소를 확인하지 못했어요.");
  return new URL("/app/sso-callback", origin).toString();
}

export function socialAuthError(error: unknown): string {
  const value = error as { errors?: Array<{ code?: string; longMessage?: string; message?: string }>; message?: string };
  const first = value?.errors?.[0];
  if (first?.code === "external_account_exists") return "이미 다른 계정에 연결된 로그인입니다. 기존 계정으로 로그인해 주세요.";
  if (first?.code === "strategy_for_user_invalid" || first?.code === "oauth_access_denied") return "이 로그인 방식을 사용할 수 없어요. 기존 이메일 로그인으로 접속해 주세요.";
  return first?.longMessage ?? first?.message ?? value?.message ?? "로그인을 완료하지 못했어요. 다시 시도해 주세요.";
}
