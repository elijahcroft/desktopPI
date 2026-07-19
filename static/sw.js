/* Service worker for the phone app.

   Deliberately minimal, and network-first: the Pi is on the same network
   (or a tunnel) and always has fresher truth than any cache. The cache exists
   only so opening the app out of range shows the UI instead of a dinosaur.

   It must NEVER touch /api/* — an expired Cloudflare Access session answers
   with a redirect to a login page, and caching or mediating that turns a
   recoverable auth prompt into silent garbage. */
const CACHE = "pi-v1";
const SHELL = ["/control", "/control.css", "/control.js", "/manifest.json", "/icon-192.png"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)));
  self.skipWaiting();
});

self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((keys) =>
    Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))));
  self.clients.claim();
});

self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (url.pathname.startsWith("/api/")) return;          // never intercept
  if (e.request.method !== "GET") return;
  e.respondWith(
    fetch(e.request)
      .then((r) => {
        const copy = r.clone();
        caches.open(CACHE).then((c) => c.put(e.request, copy)).catch(() => {});
        return r;
      })
      .catch(() => caches.match(e.request))
  );
});
