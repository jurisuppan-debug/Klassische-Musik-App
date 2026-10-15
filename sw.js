// Service Worker: macht die App installierbar und hält das App-Gerüst für den Start bereit.
// Eigene Dateien werden immer zuerst frisch aus dem Netz geholt (so kommen Updates sofort an)
// und nur ohne Verbindung aus dem Zwischenspeicher genommen.
// Musik, Bilder und Biografien von Wikimedia/Wikipedia laufen unverändert direkt übers Netz.
const CACHE = "klassik-v1";
const SHELL = ["./", "index.html", "css/style.css", "js/composers.js", "js/pieces.js", "js/clues.js", "js/app.js",
  "manifest.webmanifest", "icons/icon-192.png", "icons/icon-512.png"];

self.addEventListener("install", event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim()));
});

self.addEventListener("fetch", event => {
  const url = new URL(event.request.url);
  if (event.request.method !== "GET" || url.origin !== location.origin) return;
  event.respondWith(
    fetch(event.request)
      .then(response => {
        const copy = response.clone();
        caches.open(CACHE).then(cache => cache.put(event.request, copy));
        return response;
      })
      .catch(() => caches.match(event.request, { ignoreSearch: true })));
});
