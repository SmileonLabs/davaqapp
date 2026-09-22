/* anotherme web push service worker.
 *
 * Best-effort web/PWA push delivery + tap routing. Served as a static file from
 * the Expo web `public/` directory and registered by webPush.web.ts.
 *
 * Contract with the app (see ForegroundNotifier.web.tsx / PushRegistrar.tsx):
 *   - on push:                 postMessage {type:"data-changed"} to refresh lists
 *   - on notificationclick:    focus/open a client and postMessage
 *                              {type:"notification-navigate", url}
 *   - on message:              close stale chat notifications after the app marks
 *                              messages read
 *   - on pushsubscriptionchange: re-subscribe and postMessage
 *                              {type:"push-subscription-changed", subscription}
 *
 * NOTE: real background push (when no tab is open) is only reliable on platforms
 * with a registered, served service worker; the native Android/iOS path (FCM /
 * APNs) is the production-grade solution. This SW is the web fallback.
 */

importScripts("./sw-cache-policy.js");
importScripts("./sw-push-owner-policy.js");

const APP_SHELL_CACHE_PREFIX = "anotherme-app-shell-";
const APP_SHELL_STAGING_PREFIX = "anotherme-app-shell-staging-";
const APP_SHELL_CACHE = `${APP_SHELL_CACHE_PREFIX}__PWA_CACHE_VERSION__`;
const APP_SHELL_STAGING_CACHE = `${APP_SHELL_STAGING_PREFIX}__PWA_CACHE_VERSION__`;
const APP_SHELL_RETAIN_PREVIOUS = 2;
const APP_SHELL_ASSETS = [/*__PWA_APP_SHELL_ASSETS__*/];
const { cacheAllRequired, planAppShellCaches } = self.AnotherMePwaCachePolicy;
const { createOwnerRecord, parseOwnerRecord, shouldDisplayForOwner } =
  self.AnotherMePushOwnerPolicy;
const PUSH_OWNER_CACHE = "anotherme-push-owner-v1";

function pushOwnerRequest() {
  return new Request(new URL("__push-owner__", self.registration.scope).toString());
}

async function readPushOwner() {
  const cache = await caches.open(PUSH_OWNER_CACHE);
  const response = await cache.match(pushOwnerRequest());
  if (!response) return null;
  try {
    const parsed = parseOwnerRecord(await response.json(), Date.now());
    if (!parsed) await cache.delete(pushOwnerRequest());
    return parsed;
  } catch {
    await cache.delete(pushOwnerRequest());
    return null;
  }
}

async function writePushOwner(userId) {
  const cache = await caches.open(PUSH_OWNER_CACHE);
  const request = pushOwnerRequest();
  const previous = await readPushOwner();
  const next = createOwnerRecord(userId, Date.now());
  if (!next) await cache.delete(request);
  else {
    await cache.put(
      request,
      new Response(JSON.stringify(next), {
        headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
      }),
    );
  }
  if (previous?.userId !== next?.userId) {
    const notifications = await self.registration.getNotifications();
    for (const notification of notifications) notification.close();
  }
}

function appShellUrl() {
  return new URL("./", self.registration.scope).toString();
}

function isCacheableAsset(url) {
  const scope = new URL(self.registration.scope);
  if (url.origin !== scope.origin || !url.pathname.startsWith(scope.pathname)) return false;
  return (
    url.pathname.includes("/_expo/static/") ||
    url.pathname.includes("/assets/") ||
    /\.(?:js|css|png|jpe?g|gif|svg|webp|woff2?|ttf|otf|ico|webmanifest)$/i.test(url.pathname)
  );
}

async function networkFirstNavigation(request) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 6000);
  try {
    return await fetch(request, { signal: controller.signal });
  } catch {
    const cached = await matchRetainedAppShell(appShellUrl());
    if (cached) return cached;
    return new Response("네트워크 연결을 확인한 뒤 다시 시도해 주세요.", {
      status: 503,
      headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" },
    });
  } finally {
    clearTimeout(timer);
  }
}

async function cacheFirstAsset(request) {
  const cached = await matchRetainedAppShell(request, { ignoreSearch: true });
  if (cached) return cached;
  // Versioned app-shell caches are immutable after promotion. Writing a newly
  // deployed response into an older worker's cache can mix HTML/chunks from two
  // releases and make the offline fallback unrecoverable.
  return fetch(request);
}

function cachePlan(cacheNames) {
  return planAppShellCaches(cacheNames, APP_SHELL_CACHE, {
    cachePrefix: APP_SHELL_CACHE_PREFIX,
    stagingPrefix: APP_SHELL_STAGING_PREFIX,
    retainPrevious: APP_SHELL_RETAIN_PREVIOUS,
  });
}

async function matchRetainedAppShell(request, options) {
  const names = await caches.keys();
  for (const name of cachePlan(names).lookup) {
    if (!names.includes(name)) continue;
    const cached = await (await caches.open(name)).match(request, options);
    if (cached) return cached;
  }
  return undefined;
}

async function installAppShell() {
  const requiredAssets = APP_SHELL_ASSETS.length > 0 ? APP_SHELL_ASSETS : [appShellUrl()];
  const existingNames = await caches.keys();
  const finalCacheAlreadyExisted = existingNames.includes(APP_SHELL_CACHE);
  await caches.delete(APP_SHELL_STAGING_CACHE);
  const staging = await caches.open(APP_SHELL_STAGING_CACHE);

  try {
    await cacheAllRequired(staging, requiredAssets);
    const target = await caches.open(APP_SHELL_CACHE);
    for (const url of requiredAssets) {
      const response = await staging.match(url);
      if (!response) throw new Error(`Required PWA app-shell asset disappeared: ${url}`);
      await target.put(url, response);
    }
    await caches.delete(APP_SHELL_STAGING_CACHE);
    // A failed install never reaches this point, so the currently active worker
    // and its known-good cache remain in control.
    await self.skipWaiting();
  } catch (error) {
    await caches.delete(APP_SHELL_STAGING_CACHE);
    if (!finalCacheAlreadyExisted) await caches.delete(APP_SHELL_CACHE);
    throw error;
  }
}

self.addEventListener("install", (event) => {
  event.waitUntil(installAppShell());
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys();
      await Promise.all(cachePlan(names).remove.map((name) => caches.delete(name)));
      await self.clients.claim();
    })(),
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  const scope = new URL(self.registration.scope);
  if (url.origin !== scope.origin || !url.pathname.startsWith(scope.pathname)) return;
  // Authentication/API responses and uploads must never enter the service-worker cache.
  if (url.pathname.includes("/api/") || request.headers.has("authorization")) return;
  // Map documents must never fall back to the top-level app inside an iframe.
  if (request.destination === "iframe") {
    event.respondWith(fetch(request));
    return;
  }
  if (request.mode === "navigate") {
    event.respondWith(networkFirstNavigation(request));
  } else if (isCacheableAsset(url)) {
    event.respondWith(cacheFirstAsset(request));
  }
});

function parsePush(event) {
  if (!event.data) return {};
  try {
    return event.data.json() || {};
  } catch {
    try {
      return { body: event.data.text() };
    } catch {
      return {};
    }
  }
}

async function broadcast(message) {
  const clients = await self.clients.matchAll({
    type: "window",
    includeUncontrolled: true,
  });
  for (const client of clients) {
    client.postMessage(message);
  }
}

function toAppUrl(url) {
  if (typeof url !== "string" || !url.startsWith("/")) return url || "/";
  try {
    const scopePath = new URL(self.registration.scope).pathname;
    const base = scopePath.endsWith("/") ? scopePath.slice(0, -1) : scopePath;
    if (!base || base === "/" || url === base || url.startsWith(`${base}/`)) return url;
    return `${base}${url === "/" ? "" : url}`;
  } catch {
    return url;
  }
}

function roomIdFromUrl(url) {
  if (typeof url !== "string") return null;
  const match = url.match(/^\/chat\/([^/?#]+)/);
  return match ? decodeURIComponent(match[1]) : null;
}

function roomTagFromId(roomId) {
  return typeof roomId === "string" && roomId ? `room-${roomId}` : null;
}

function notificationIsChat(notification) {
  if (typeof notification.tag === "string" && notification.tag.startsWith("room-")) return true;
  const data = notification.data || {};
  return !!roomIdFromUrl(data.url);
}

async function closeNotificationsByTag(tag) {
  if (typeof tag !== "string" || !tag) return;
  const notifications = await self.registration.getNotifications({ tag });
  for (const notification of notifications) notification.close();
}

async function closeChatNotifications() {
  const notifications = await self.registration.getNotifications();
  for (const notification of notifications) {
    if (notificationIsChat(notification)) notification.close();
  }
}

self.addEventListener("push", (event) => {
  const payload = parsePush(event);
  const title = payload.title || "anotherme";
  const url = typeof payload.url === "string" ? payload.url : "/";
  const data = payload.data && typeof payload.data === "object" ? payload.data : {};
  const options = {
    body: payload.body || "",
    tag: payload.tag,
    // renotify so a fresh call push re-alerts even if a tag-matched one exists.
    renotify: !!payload.tag,
    data: {
      url,
      openUrl: toAppUrl(url),
      ...data,
      recipientUserId: payload.recipientUserId,
    },
  };
  event.waitUntil(
    (async () => {
      const owner = await readPushOwner();
      if (!shouldDisplayForOwner(owner, payload.recipientUserId, Date.now())) return;
      // Wake open tabs so in-app lists/badges refresh alongside the OS banner.
      await broadcast({ type: "data-changed", roomId: roomIdFromUrl(url) });
      await self.registration.showNotification(title, options);
    })(),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const data = event.notification.data || {};
  const url = typeof data.url === "string" ? data.url : "/";
  const openUrl = typeof data.openUrl === "string" ? data.openUrl : toAppUrl(url);
  event.waitUntil(
    (async () => {
      const owner = await readPushOwner();
      if (!shouldDisplayForOwner(owner, data.recipientUserId, Date.now())) return;
      const clients = await self.clients.matchAll({
        type: "window",
        includeUncontrolled: true,
      });
      // Focus an existing tab and route it in-app (no reload / new window).
      for (const client of clients) {
        if ("focus" in client) {
          await client.focus();
          client.postMessage({ type: "notification-navigate", url });
          return;
        }
      }
      // No tab open — open one at the target URL.
      if (self.clients.openWindow) {
        await self.clients.openWindow(openUrl);
      }
    })(),
  );
});

self.addEventListener("message", (event) => {
  const data = event.data || {};
  if (data.type === "push-owner-changed") {
    const update = writePushOwner(
      typeof data.userId === "string" ? data.userId : null,
    ).finally(() => event.ports?.[0]?.postMessage({ ok: true }));
    event.waitUntil(update);
    return;
  }
  if (data.type === "clear-room-notifications") {
    const tag = typeof data.tag === "string" ? data.tag : roomTagFromId(data.roomId);
    event.waitUntil(closeNotificationsByTag(tag));
  }
  if (data.type === "clear-chat-notifications") {
    event.waitUntil(closeChatNotifications());
  }
});

self.addEventListener("pushsubscriptionchange", (event) => {
  event.waitUntil(
    (async () => {
      try {
        const oldSub = event.oldSubscription || null;
        const appServerKey =
          (oldSub && oldSub.options && oldSub.options.applicationServerKey) || undefined;
        const sub = await self.registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: appServerKey,
        });
        await broadcast({
          type: "push-subscription-changed",
          subscription: JSON.stringify(sub),
        });
      } catch {
        // best-effort — the app will re-subscribe on next load via PushRegistrar.
      }
    })(),
  );
});
