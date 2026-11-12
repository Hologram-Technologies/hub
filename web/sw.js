// Until 2026-11-12 the proof page lived at this root and registered a service
// worker here that answers from its cache. The hub's interface now owns the
// root and needs no worker, so this one replaces it once: it clears every
// cache the old worker filled, unregisters itself and reloads open pages, which
// then load the interface from the network. The proof page's own worker lives
// under app/ and is untouched.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) await caches.delete(key);
    await self.registration.unregister();
    for (const client of await self.clients.matchAll({ type: "window" })) client.navigate(client.url);
  })());
});
