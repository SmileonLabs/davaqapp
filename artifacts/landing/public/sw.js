// /app/sw.js owns the PWA. Retire the obsolete root landing worker without
// intercepting requests or deleting any application caches.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      await self.clients.claim();
      await self.registration.unregister();
    })(),
  );
});
