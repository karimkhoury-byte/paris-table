// Paris Table service worker: app shell offline, map tiles cached as you browse.
const SHELL = "pt-shell-v1";
const TILES = "pt-tiles-v1";
const SHELL_FILES = ["./", "index.html", "app.js", "data.js", "manifest.webmanifest", "icons/icon-192.png", "icons/apple-touch-icon.png",
  "https://unpkg.com/leaflet@1.9.4/dist/leaflet.css", "https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(SHELL).then((c) => c.addAll(SHELL_FILES)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => ![SHELL, TILES].includes(k)).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});

async function trimTiles() {
  const c = await caches.open(TILES); const keys = await c.keys();
  for (let i = 0; i < keys.length - 2500; i++) await c.delete(keys[i]);
}

self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET") return;
  // Map tiles: cache-first, so streets you've seen load without signal.
  if (url.hostname.endsWith("basemaps.cartocdn.com")) {
    e.respondWith(caches.open(TILES).then(async (c) => {
      const hit = await c.match(e.request); if (hit) return hit;
      const res = await fetch(e.request);
      if (res.ok || res.type === "opaque") { c.put(e.request, res.clone()); if (Math.random() < 0.02) trimTiles(); }
      return res;
    }));
    return;
  }
  // App files + fonts + Leaflet: network-first for our own files (so updates land), cache fallback.
  const own = url.origin === self.location.origin;
  if (own || url.hostname === "unpkg.com" || url.hostname.endsWith("gstatic.com") || url.hostname === "fonts.googleapis.com") {
    e.respondWith(fetch(e.request).then((res) => {
      if (res.ok) { const copy = res.clone(); caches.open(SHELL).then((c) => c.put(e.request, copy)); }
      return res;
    }).catch(() => caches.match(e.request).then((r) => r || caches.match("index.html"))));
  }
  // Routing, search and geocoding go straight to the network.
});
