import { getClerkInstance } from "@clerk/expo";
import { tokenCache } from "@clerk/expo/token-cache";
import { getApiBase } from "./apiBase";
import { getSocialToken, socialSessionIdentity } from "./davaqAuth";

/** Fetch a fresh bearer from SecureStore-backed Clerk; never persist a JWT in
 * AsyncStorage or treat an expired push owner as proof of a signed-in session. */
export async function getHeadlessPushAuth(ownerId: string): Promise<{
  bearer: string;
  isCurrent: () => boolean;
} | null> {
  const socialBearer = await getSocialToken();
  const social = socialSessionIdentity();
  if (socialBearer && social) {
    if (social.dbUserId !== ownerId) return null;
    const isCurrent = () => socialSessionIdentity()?.sessionId === social.sessionId;
    return isCurrent() ? { bearer: socialBearer, isCurrent } : null;
  }
  const key = process.env.EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY;
  if (!key) return null;
  const clerk = getClerkInstance({
    publishableKey: key,
    tokenCache,
    proxyUrl: key.startsWith("pk_live_")
      ? process.env.EXPO_PUBLIC_CLERK_PROXY_URL || undefined
      : undefined,
  });
  const controller = new AbortController();
  let timeout: ReturnType<typeof setTimeout>;
  const work = async () => {
    if (!clerk.loaded) await clerk.load();
    const session = clerk.session;
    const userId = clerk.user?.id;
    if (!session || !userId) return null;
    const isCurrent = () => clerk.session?.id === session.id && clerk.user?.id === userId && !controller.signal.aborted;
    const bearer = await session.getToken({ skipCache: true });
    if (!bearer || !isCurrent()) return null;
    const response = await fetch(`${getApiBase()}/api/users/me`, {
      headers: { Authorization: `Bearer ${bearer}` },
      signal: controller.signal,
    });
    if (!response.ok) return null;
    const me = await response.json();
    return isCurrent() && me.id === ownerId && me.clerkId === userId
      ? { bearer, isCurrent }
      : null;
  };
  try {
    return await Promise.race([
      work(),
      new Promise<null>((resolve) => {
        timeout = setTimeout(() => { controller.abort(); resolve(null); }, 8_000);
      }),
    ]);
  } catch {
    return null;
  } finally {
    clearTimeout(timeout!);
  }
}
