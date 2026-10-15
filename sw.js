// Paris Table service worker: app shell offline, map data cached as you browse.
const SHELL = "pt-shell-v4";
const TILES = "pt-tiles-v4";
const SHELL_FILES = ["./", "index.html", "app.js", "data.js", "manifest.webmanifest", "icons/icon-192.png", "icons/apple-touch-icon.png",
  "https://unpkg.com/maplibre-gl@4.7.1/dist/maplibre-gl.css", "https://unpkg.com/maplibre-gl@4.7.1/dist/maplibre-gl.js"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(SHELL).then((c) => c.addAll(SHELL_FILES)).catch(() => {}).then(() => self.skipWaiting()));
});
self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => ![SHELL, TILES].includes(k)).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
async function trim() { const c = await caches.open(TILES); const keys = await c.keys(); for (let i = 0; i < keys.length - 3000; i++) await c.delete(keys[i]); }

self.addEventListener("fetch", (e) => {
  if (e.request.method !== "GET") return;
  const url = new URL(e.request.url);
  const tileLike = (url.hostname === "tiles.openfreemap.org" && !url.pathname.startsWith("/styles/")) || url.hostname === "tile.openstreetmap.org";
  if (tileLike) {
    e.respondWith(caches.open(TILES).then(async (c) => {
      const hit = await c.match(e.request); if (hit) return hit;
      const res = await fetch(e.request);
      if (res.ok) { c.put(e.request, res.clone()); if (Math.random() < 0.02) trim(); }
      return res;
    }));
    return;
  }
  const shellish = url.origin === self.location.origin || url.hostname === "unpkg.com" || url.hostname.endsWith("gstatic.com") || url.hostname === "fonts.googleapis.com" || url.hostname === "tiles.openfreemap.org";
  if (shellish) {
    e.respondWith(fetch(e.request).then((res) => {
      if (res.ok) { const copy = res.clone(); caches.open(SHELL).then((c) => c.put(e.request, copy)); }
      return res;
    }).catch(() => caches.match(e.request).then((r) => r || (url.origin === self.location.origin ? caches.match("index.html") : Response.error()))));
  }
});
