// AR Methods Leads service worker.
// - app-<hash>.js and images: served from the phone's cache (the file name changes on every update)
// - the page itself: network first, falling back to the cached copy when offline
const CACHE = "arm-v3";

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.origin !== self.location.origin) return; // Firebase, Google etc. go straight to the network
  const immutable = /\/app-[A-Za-z0-9]+\.js$/.test(url.pathname) || /\.(png|webmanifest|woff2)$/.test(url.pathname);
  if (immutable) {
    e.respondWith(caches.match(e.request).then((hit) => hit || fetch(e.request).then((res) => {
      if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(e.request, copy)); }
      return res;
    })));
    return;
  }
  e.respondWith(fetch(e.request).then((res) => {
    if (res.ok && (url.pathname.endsWith("/") || url.pathname.endsWith(".html"))) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(e.request, copy)); }
    return res;
  }).catch(() => caches.match(e.request).then((hit) => hit || caches.match("index.html"))));
});
