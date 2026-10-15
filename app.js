/* Paris Table — walking map of 100 unstarred Paris restaurants (MapLibre + OpenFreeMap) */
(() => {
  "use strict";
  const $ = (s) => document.querySelector(s);
  const CATS = window.CATEGORIES;
  const ALL = window.RESTAURANTS;
  const PINNED = ALL.filter((r) => r.lat != null);
  const PRICES = ["€", "€€", "€€€"];
  const WALK = 80; // metres per minute (~4.8 km/h)
  const PARIS = { lat: 48.8566, lng: 2.3522 };

  const store = {
    get(k, d) { try { const v = localStorage.getItem("pt:" + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem("pt:" + k, JSON.stringify(v)); } catch (e) {} }
  };

  const S = {
    me: null, realMe: null, watch: null, follow: false, firstFix: true, demo: false,
    from: { kind: "me" }, to: null, route: null, progress: 0, routing: false, lastRouteAt: 0,
    detour: store.get("detour", 4), cat: store.get("cat", null),
    prices: new Set(store.get("prices", PRICES)), mine: store.get("mine", "all"),
    tried: new Set(store.get("tried", [])), saved: new Set(store.get("saved", [])),
    selected: null, snap: "peek", alerted: new Set(), listLimit: 30, wake: null, field: "to"
  };

  // ── geometry ──
  const KX = Math.cos(48.86 * Math.PI / 180) * 111320, KY = 110574;
  const xy = (lat, lng) => [(lng - 2.35) * KX, (lat - 48.86) * KY];
  function hav(a, b) {
    const R = 6371000, t = Math.PI / 180;
    const dLat = (b.lat - a.lat) * t, dLng = (b.lng - a.lng) * t;
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * t) * Math.cos(b.lat * t) * Math.sin(dLng / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(h));
  }
  function project(route, p) {
    let best = { d: Infinity, s: 0 };
    const P = route.xy, C = route.cum;
    for (let i = 0; i < P.length - 1; i++) {
      const a = P[i], b = P[i + 1], dx = b[0] - a[0], dy = b[1] - a[1], L2 = dx * dx + dy * dy;
      let t = L2 ? ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / L2 : 0;
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      const d = Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
      if (d < best.d) best = { d, s: C[i] + t * Math.sqrt(L2) };
    }
    return best;
  }
  const fmtDist = (m) => m < 950 ? Math.max(10, Math.round(m / 10) * 10) + " m" : (m / 1000).toLocaleString("en", { maximumFractionDigits: m < 9950 ? 1 : 0 }) + " km";
  const fmtMin = (m) => { const n = Math.max(1, Math.round(m / WALK)); return n < 60 ? n + " min" : Math.floor(n / 60) + " h " + (n % 60) + " min"; };
  const arr = (pc) => { if (!pc) return ""; const n = parseInt(pc.slice(-2), 10); return n === 1 ? "1er" : n + "e"; };
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const norm = (s) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  const inParis = (p) => !!p && hav(p, PARIS) < 25000;
  const cssVar = (n, d) => getComputedStyle(document.documentElement).getPropertyValue(n).trim() || d;

  let toastT;
  function toast(msg, ms = 3200) {
    const t = $("#toast"); t.textContent = msg; t.classList.remove("off");
    clearTimeout(toastT); toastT = setTimeout(() => t.classList.add("off"), ms);
  }
  function buzz() { try { navigator.vibrate && navigator.vibrate([50, 60, 50]); } catch (e) {} }

  // ── icons ──
  const GLYPH = {
    bistro: '<path d="M7 3v5a2 2 0 0 0 4 0V3M9 10v11M17 21V3c-2.2 0-3.5 2.4-3.5 6.5V13H17" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>',
    neo: '<path d="M12 2.5l2.3 6.2 6.2 2.3-6.2 2.3L12 19.5l-2.3-6.2L3.5 11l6.2-2.3z" fill="#fff"/><circle cx="19" cy="19" r="1.6" fill="#fff"/>',
    street: '<path d="M3 16.5 12 6l9 10.5z" fill="none" stroke="#fff" stroke-width="2" stroke-linejoin="round"/><path d="M6.2 13.2h11.6" stroke="#fff" stroke-width="2" stroke-linecap="round"/>',
    bouillon: '<path d="M3 11.5h18a9 9 0 0 1-18 0z" fill="#fff"/><path d="M12.5 10.5 19.5 3.5" stroke="#fff" stroke-width="2.2" stroke-linecap="round"/>',
    brasserie: '<path d="M5.5 7h9v11.5a2 2 0 0 1-2 2h-5a2 2 0 0 1-2-2z" fill="#fff"/><path d="M14.5 9.5h2.2a2 2 0 0 1 2 2v3a2 2 0 0 1-2 2h-2.2M5.5 4h9" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round"/>',
    wine: '<path d="M7.5 3h9l-.6 5.5a3.9 3.9 0 0 1-7.8 0z" fill="#fff"/><path d="M12 12.5V20M8.5 20.5h7" stroke="#fff" stroke-width="2" stroke-linecap="round"/>',
    closed: '<path d="M7 7l10 10M17 7 7 17" stroke="#fff" stroke-width="2.4" stroke-linecap="round"/>'
  };
  const glyph = (k, size = 24) => `<svg viewBox="0 0 24 24" width="${size}" height="${size}" aria-hidden="true">${GLYPH[k]}</svg>`;
  const ICON = {
    pin: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 21s7-6.6 7-12a7 7 0 0 0-14 0c0 5.4 7 12 7 12z"/><circle cx="12" cy="9" r="2.5"/></svg>',
    me: '<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M20.5 3.5 3.8 10.6c-.8.3-.7 1.5.1 1.7l6.6 1.6 1.6 6.6c.2.8 1.4.9 1.7.1L20.5 3.5z"/></svg>',
    map: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="M9 4 3 6v14l6-2 6 2 6-2V4l-6 2-6-2zM9 4v14M15 6v14"/></svg>',
    walk: '<svg viewBox="0 0 24 24" fill="currentColor"><circle cx="13" cy="4" r="2"/><path d="M9.8 8.9 7 23h2.1l1.8-8 2.1 2v6h2v-7.5l-2.1-2 .6-3C14.8 12 16.8 13 19 13v-2c-1.9 0-3.5-1-4.3-2.4l-1-1.6c-.4-.6-1-1-1.7-1-.3 0-.5.1-.8.1L6 8.3V13h2V9.6l1.8-.7"/></svg>',
    x: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>',
    filter: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M4 6h16M7 12h10M10 18h4"/></svg>',
    play: '<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>'
  };

  // ── map ──
  const RASTER = {
    version: 8,
    sources: { osm: { type: "raster", tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"], tileSize: 256, maxzoom: 19, attribution: "© OpenStreetMap contributors" } },
    layers: [{ id: "osm", type: "raster", source: "osm" }]
  };
  const darkMode = window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches;
  const STYLES = darkMode
    ? ["https://tiles.openfreemap.org/styles/dark", "https://tiles.openfreemap.org/styles/positron", RASTER]
    : ["https://tiles.openfreemap.org/styles/positron", RASTER];
  let styleIdx = 0, styleOK = false;
  const map = new maplibregl.Map({
    container: "map", style: STYLES[0], center: [PARIS.lng, PARIS.lat], zoom: 12.4,
    attributionControl: false, dragRotate: false, pitchWithRotate: false, maxPitch: 0, minZoom: 10, maxZoom: 19.5
  });
  map.touchZoomRotate.disableRotation();
  map.keyboard.disableRotation && map.keyboard.disableRotation();
  map.addControl(new maplibregl.AttributionControl({ compact: true, customAttribution: "© OpenStreetMap" }), "bottom-left");
  function nextStyle() { if (styleOK) return; styleIdx++; if (styleIdx < STYLES.length) map.setStyle(STYLES[styleIdx]); }
  map.on("error", (e) => { if (!styleOK) nextStyle(); });
  setTimeout(() => { if (!styleOK) nextStyle(); }, 9000);
  map.on("style.load", () => { styleOK = true; drawRoute(); });
  window.__ptStyle = () => STYLES[styleIdx];

  function zoomClasses() {
    const z = map.getZoom(), el = map.getContainer();
    el.classList.toggle("z-far", z < 12.5);
    el.classList.toggle("z-13", z >= 12.5 && z < 13.5);
    el.classList.toggle("z-14", z >= 13.5 && z < 14.5);
    el.classList.toggle("z-mid", z >= 14.5);
    el.classList.toggle("z-labels", z >= 16.2);
  }
  map.on("zoom", zoomClasses);

  // ── camera helpers (account for the top card and the sheet) ──
  const sheet = $("#sheet");
  const sheetH = () => sheet.getBoundingClientRect().height;
  const topH = () => $("#top").getBoundingClientRect().bottom;
  const pad = () => ({ top: topH() + 24, bottom: sheetH() + 24, left: 28, right: 64 });
  const offsetY = () => (topH() - sheetH()) / 2;
  function centerOn(lat, lng, zoom, dur = 650) { map.easeTo({ center: [lng, lat], zoom: zoom == null ? map.getZoom() : zoom, offset: [0, offsetY()], duration: dur }); }
  function fitPts(pts, maxZoom = 16) {
    if (!pts.length) return;
    const b = new maplibregl.LngLatBounds();
    pts.forEach((p) => b.extend([p[1], p[0]]));
    map.fitBounds(b, { padding: pad(), maxZoom, duration: 700 });
  }
  function visibleCenter() {
    const c = map.getContainer().getBoundingClientRect();
    return map.unproject([c.width / 2, (topH() + (c.height - sheetH())) / 2]);
  }

  // ── restaurant pins ──
  const markers = new Map();
  const filtered = () => PINNED.filter((r) =>
    (!S.cat || r.c === S.cat) && S.prices.has(r.p) &&
    (S.mine !== "saved" || S.saved.has(r.id)) && (S.mine !== "untried" || !S.tried.has(r.id)));
  const suggestable = () => filtered().filter((r) => !r.closed);

  PINNED.forEach((r) => {
    const k = r.closed ? "closed" : r.c;
    const el = document.createElement("div");
    el.className = "pt-pin";
    el.style.setProperty("--cc", `var(--c-${k})`);
    el.innerHTML = `<span class="drop"><svg class="tear" viewBox="0 0 34 42" width="34" height="42" aria-hidden="true"><path d="M17 41C17 41 32 26.6 32 16A15 15 0 0 0 2 16c0 10.6 15 25 15 25z"/></svg><span class="gl">${glyph(k, 18)}</span><span class="badge"></span></span><b>${esc(r.n)}</b>`;
    el.setAttribute("role", "button"); el.setAttribute("aria-label", r.n);
    el.addEventListener("click", (e) => { e.stopPropagation(); select(r.id); });
    const m = new maplibregl.Marker({ element: el, anchor: "bottom" }).setLngLat([r.lng, r.lat]);
    markers.set(r.id, { m, el, shown: false });
  });

  function refreshMarkers(onwayIds) {
    const vis = new Set(filtered().map((r) => r.id));
    PINNED.forEach((r) => {
      const o = markers.get(r.id);
      const show = vis.has(r.id) || S.selected === r.id;
      if (show && !o.shown) { o.m.addTo(map); o.shown = true; }
      if (!show && o.shown) { o.m.remove(); o.shown = false; }
      const onway = onwayIds.has(r.id), sel = S.selected === r.id;
      const c = o.el.classList;
      c.toggle("onway", onway);
      c.toggle("dim", !!S.route && !onway && !sel && !(S.to && S.to.rid === r.id) && !(S.from && S.from.rid === r.id));
      c.toggle("sel", sel);
      c.toggle("saved", S.saved.has(r.id));
      c.toggle("tried", S.tried.has(r.id));
      c.toggle("closed", !!r.closed);
      o.el.style.zIndex = sel ? 3 : onway ? 2 : "";
    });
  }

  function fitAll() {
    const pts = filtered().map((r) => [r.lat, r.lng]);
    if (S.me && inParis(S.me)) pts.push([S.me.lat, S.me.lng]);
    fitPts(pts, 15);
  }

  // ── my location ──
  const meEl = document.createElement("div");
  meEl.className = "me-pin";
  meEl.innerHTML = '<span class="cone"></span><span class="pulse"></span><span class="core"></span>';
  const meMarker = new maplibregl.Marker({ element: meEl, anchor: "center" });
  let meShown = false;
  function placeMe() {
    if (S.me && inParis(S.me)) { meMarker.setLngLat([S.me.lng, S.me.lat]); if (!meShown) { meMarker.addTo(map); meShown = true; } }
    else if (meShown) { meMarker.remove(); meShown = false; }
  }

  function startLocate(userTap) {
    if (!("geolocation" in navigator)) { toast("This browser can't share your location."); return; }
    if (userTap) askCompass();
    if (S.watch != null) {
      if (userTap) {
        if (S.me && inParis(S.me)) { S.follow = true; centerOn(S.me.lat, S.me.lng, Math.max(map.getZoom(), 16)); }
        else if (S.realMe) { banner(`You're ${fmtDist(hav(S.realMe, PARIS))} from Paris. Your blue dot shows up once you're in the city.`, "Demo walk", startDemo); }
        else toast("Looking for your location…");
      }
      updateLocateBtn(); return;
    }
    if (userTap) S.follow = true;
    navigator.geolocation.getCurrentPosition(onPos, onPosErr, { enableHighAccuracy: false, maximumAge: 60000, timeout: 8000 });
    S.watch = navigator.geolocation.watchPosition(onPos, onPosErr, { enableHighAccuracy: true, maximumAge: 5000, timeout: 20000 });
    updateLocateBtn();
  }
  function updateLocateBtn() {
    const b = $("#btnLocate");
    b.classList.toggle("on", S.watch != null || S.demo);
    b.classList.toggle("follow", S.follow && inParis(S.me));
  }
  let errShown = 0;
  function onPosErr(err) {
    if (err.code === 1) {
      navigator.geolocation.clearWatch(S.watch); S.watch = null; S.follow = false; updateLocateBtn();
      banner("Location is blocked. On iPhone: Settings → Privacy & Security → Location Services → Safari Websites → While Using, with Precise Location on. Then reopen the app.", "Demo walk", startDemo);
    } else if (Date.now() - errShown > 60000) {
      errShown = Date.now();
      toast(err.code === 3 ? "Still waiting for GPS. Step outside or near a window." : "Your phone can't get a location fix right now.", 4500);
    }
  }
  function banner(text, label, fn) {
    const b = $("#banner");
    b.innerHTML = `<span>${esc(text)}</span>${label ? `<button class="act" id="bnAct">${esc(label)}</button>` : ""}<button class="icon-btn" id="bnX" aria-label="Dismiss">${ICON.x}</button>`;
    b.hidden = false;
    if (label) $("#bnAct").onclick = () => { b.hidden = true; fn(); };
    $("#bnX").onclick = () => (b.hidden = true);
  }

  let lastRender = 0;
  function onPos(pos) {
    const p = { lat: pos.coords.latitude, lng: pos.coords.longitude, acc: pos.coords.accuracy };
    if (!pos.demo) { S.realMe = p; if (S.demo) return; }
    S.me = p;
    placeMe();
    if (pos.coords.heading != null && !isNaN(pos.coords.heading) && (pos.coords.speed || 0) > 0.5) setHeading(pos.coords.heading);

    if (S.firstFix && !pos.demo) {
      S.firstFix = false;
      if (inParis(p)) { S.follow = true; if (!S.route) centerOn(p.lat, p.lng, 16, 900); }
      else { S.follow = false; banner(`You're ${fmtDist(hav(p, PARIS))} from Paris. Your blue dot appears once you're in the city. Until then, plan walks from any address, or watch a demo.`, "Demo walk", startDemo); }
    } else if (S.follow && inParis(p)) {
      centerOn(p.lat, p.lng, null, 500);
    }
    updateLocateBtn();

    if (S.route && inParis(p)) {
      const pr = project(S.route, xy(p.lat, p.lng));
      if (pr.d < 120) S.progress = Math.max(0, pr.s);
      if (S.from.kind === "me" && !S.demo && pr.d > 70 && p.acc < 60 && !S.routing && Date.now() - S.lastRouteAt > 25000) { buildRoute(true); return; }
      const end = resolve(S.to);
      if (end && hav(p, end) < 35 && !S.alerted.has("arrived")) { S.alerted.add("arrived"); toast(`You've arrived: ${end.label}`, 5000); buzz(); }
    }
    const now = Date.now();
    if (!S.selected && now - lastRender > (S.demo ? 900 : 2500)) { lastRender = now; render(); }
  }

  function setHeading(h) { meEl.classList.add("has-heading"); meEl.querySelector(".cone").style.transform = `rotate(${h}deg)`; }
  let compassAsked = false;
  function askCompass() {
    if (compassAsked) return; compassAsked = true;
    const attach = () => window.addEventListener("deviceorientation", (e) => {
      if (S.demo) return;
      let h = null;
      if (typeof e.webkitCompassHeading === "number") h = e.webkitCompassHeading;
      else if (e.absolute && e.alpha != null) h = 360 - e.alpha;
      if (h != null) setHeading(h);
    }, true);
    try {
      if (window.DeviceOrientationEvent && typeof DeviceOrientationEvent.requestPermission === "function") DeviceOrientationEvent.requestPermission().then((s) => s === "granted" && attach()).catch(() => {});
      else attach();
    } catch (e) {}
  }
  map.on("dragstart", () => { if (S.follow) { S.follow = false; updateLocateBtn(); } });

  // ── places: "me" or a fixed point ──
  function resolve(p) {
    if (!p) return null;
    if (p.kind === "me") return S.me && inParis(S.me) ? { lat: S.me.lat, lng: S.me.lng, label: "My location" } : null;
    return p;
  }
  const placeLabel = (p) => !p ? "" : p.kind === "me" ? "My location" : p.label;

  // ── route drawing ──
  const endEl = document.createElement("div");
  endEl.className = "end-pin";
  endEl.innerHTML = '<svg viewBox="0 0 30 40" width="30" height="40"><path d="M15 39s13-13.6 13-23.5A13 13 0 0 0 2 15.5C2 25.4 15 39 15 39z" fill="var(--plaque)" stroke="#fff" stroke-width="2.5"/><rect x="10" y="10.5" width="10" height="10" rx="1.5" fill="#fff"/></svg>';
  const endMarker = new maplibregl.Marker({ element: endEl, anchor: "bottom" });
  const startEl = document.createElement("div");
  startEl.className = "start-pin";
  const startMarker = new maplibregl.Marker({ element: startEl, anchor: "center" });

  function drawRoute() {
    if (!styleOK) return;
    const data = { type: "FeatureCollection", features: S.route ? [{ type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: S.route.latlngs.map((l) => [l[1], l[0]]) } }] : [] };
    const src = map.getSource("route");
    if (src) src.setData(data);
    else {
      map.addSource("route", { type: "geojson", data });
      map.addLayer({ id: "route-casing", type: "line", source: "route", layout: { "line-cap": "round", "line-join": "round" }, paint: { "line-color": "#ffffff", "line-width": ["interpolate", ["linear"], ["zoom"], 12, 6, 17, 12], "line-opacity": 0.95 } });
      map.addLayer({ id: "route-line", type: "line", source: "route", layout: { "line-cap": "round", "line-join": "round" }, paint: { "line-color": cssVar("--route", "#2457e6"), "line-width": ["interpolate", ["linear"], ["zoom"], 12, 3.5, 17, 7] } });
    }
    if (map.getLayer("route-line")) map.setPaintProperty("route-line", "line-dasharray", S.route && S.route.approx ? [0.5, 2] : [1, 0]);
  }

  async function fetchRoute(a, b) {
    const url = `https://routing.openstreetmap.de/routed-foot/route/v1/driving/${a.lng.toFixed(6)},${a.lat.toFixed(6)};${b.lng.toFixed(6)},${b.lat.toFixed(6)}?overview=full&geometries=geojson`;
    try {
      const ctrl = new AbortController(); const t = setTimeout(() => ctrl.abort(), 9000);
      const res = await fetch(url, { signal: ctrl.signal }); clearTimeout(t);
      if (!res.ok) throw new Error("http " + res.status);
      const j = await res.json(); const rt = j.routes && j.routes[0];
      if (!rt || !rt.geometry) throw new Error("no route");
      return shape(rt.geometry.coordinates.map((c) => [c[1], c[0]]), false);
    } catch (e) { return shape([[a.lat, a.lng], [b.lat, b.lng]], true); }
  }
  function shape(latlngs, approx) {
    const P = latlngs.map((l) => xy(l[0], l[1])), C = [0];
    for (let i = 1; i < P.length; i++) C.push(C[i - 1] + Math.hypot(P[i][0] - P[i - 1][0], P[i][1] - P[i - 1][1]));
    const len = C[C.length - 1];
    return { latlngs, xy: P, cum: C, dist: approx ? len * 1.25 : len, approx };
  }

  async function buildRoute(isReroute) {
    const a = resolve(S.from), b = resolve(S.to);
    paintPlan();
    if (!a || !b) { clearRouteLine(); render(); return; }
    S.routing = true; paintPlan();
    const r = await fetchRoute(a, b);
    S.routing = false; S.lastRouteAt = Date.now();
    const a2 = resolve(S.from), b2 = resolve(S.to);
    if (!a2 || !b2) return;
    S.route = r; S.alerted.delete("arrived");
    S.progress = S.me && inParis(S.me) ? Math.max(0, project(r, xy(S.me.lat, S.me.lng)).s) : 0;
    if (S.progress && project(r, xy(S.me.lat, S.me.lng)).d > 120) S.progress = 0;
    drawRoute();
    endMarker.setLngLat([b.lng, b.lat]).addTo(map);
    if (S.from.kind !== "me") startMarker.setLngLat([a.lng, a.lat]).addTo(map); else startMarker.remove();
    if (!isReroute) { setSnap("half"); setTimeout(fitRoute, 60); } else toast("Re-routed from where you are.");
    if (r.approx) toast("Walking directions are offline right now, so this is a straight-line estimate.", 4500);
    keepAwake(true);
    paintPlan(); render();
  }
  function fitRoute() { if (S.route) fitPts(S.route.latlngs, 17); }
  function clearRouteLine() { S.route = null; S.progress = 0; drawRoute(); endMarker.remove(); startMarker.remove(); keepAwake(false); }
  function endWalk() {
    stopDemo(true);
    S.to = null; S.from = { kind: "me" };
    clearRouteLine(); setSnap("peek"); paintPlan(); render();
  }

  async function keepAwake(on) {
    try {
      if (on && "wakeLock" in navigator && !S.wake) { S.wake = await navigator.wakeLock.request("screen"); S.wake.addEventListener("release", () => (S.wake = null)); }
      if (!on && S.wake) { await S.wake.release(); S.wake = null; }
    } catch (e) {}
  }
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible" && S.route) keepAwake(true); });

  // ── top card ──
  function paintPlan() {
    const el = $("#plan");
    if (!S.to && S.from.kind === "me") {
      el.innerHTML = `<span class="brand" aria-hidden="true">PT</span><span class="plan-txt"><span class="plan-row small"><span class="pin-dot me"></span><span>From my location</span></span><span class="plan-row big"><span>Where to?</span></span></span><span class="end icon-btn" aria-hidden="true">${ICON.pin}</span>`;
      return;
    }
    const from = placeLabel(S.from), to = S.to ? placeLabel(S.to) : "Choose a destination";
    const fromDot = S.from.kind === "me" ? "me" : "from";
    let meta = "";
    if (S.routing) meta = "Finding a walking route…";
    else if (S.route) {
      const left = Math.max(0, S.route.dist - S.progress * (S.route.approx ? 1.25 : 1));
      meta = `<b>${fmtMin(left)}</b> · ${fmtDist(left)} walk${S.demo ? " · demo" : ""}`;
    } else if (S.to && !resolve(S.from)) meta = "Your location isn't in Paris. Tap to pick a start.";
    el.innerHTML = `<span class="plan-txt"><span class="plan-row small"><span class="pin-dot ${fromDot}"></span><span>${esc(from)}</span></span><span class="plan-row big"><span class="pin-dot to"></span><span>${esc(to)}</span></span><span class="meta">${meta}</span></span><span class="end icon-btn" id="endWalk" role="button" aria-label="End walk">${ICON.x}</span>`;
  }
  $("#plan").addEventListener("click", (e) => {
    if (e.target.closest("#endWalk")) { e.stopPropagation(); return endWalk(); }
    openPlanner(S.to ? "to" : "to");
  });

  // ── planner (From / To) ──
  const fromQ = $("#fromQ"), toQ = $("#toQ"), plRes = $("#plResults");
  function openPlanner(field) {
    $("#planner").hidden = false;
    fillField("from"); fillField("to");
    focusField(field || (S.to ? "to" : "to"));
  }
  function closePlanner() { $("#planner").hidden = true; fromQ.blur(); toQ.blur(); }
  function fillField(f) {
    const inp = f === "from" ? fromQ : toQ, p = f === "from" ? S.from : S.to;
    inp.value = placeLabel(p); inp.classList.toggle("is-me", !!p && p.kind === "me");
    inp.parentElement.querySelector(".clr").hidden = !p;
  }
  function focusField(f) {
    S.field = f;
    $("#fFrom").classList.toggle("active", f === "from"); $("#fTo").classList.toggle("active", f === "to");
    const inp = f === "from" ? fromQ : toQ;
    setTimeout(() => { inp.focus(); inp.select(); }, 30);
    suggest("");
  }
  fromQ.addEventListener("focus", () => { if (S.field !== "from") { S.field = "from"; $("#fFrom").classList.add("active"); $("#fTo").classList.remove("active"); suggest(""); } fromQ.select(); });
  toQ.addEventListener("focus", () => { if (S.field !== "to") { S.field = "to"; $("#fTo").classList.add("active"); $("#fFrom").classList.remove("active"); suggest(""); } toQ.select(); });
  let qT, qAbort, remote = [], local = [];
  [fromQ, toQ].forEach((inp) => inp.addEventListener("input", () => {
    inp.classList.remove("is-me");
    inp.parentElement.querySelector(".clr").hidden = !inp.value;
    clearTimeout(qT); const v = inp.value.trim();
    if (v.length < 2) { remote = []; return suggest(""); }
    suggest(v); qT = setTimeout(() => remoteSearch(v), 300);
  }));
  [fromQ, toQ].forEach((inp) => inp.addEventListener("keydown", (e) => { if (e.key === "Enter") { const b = plRes.querySelector(".opt[data-k]"); b && b.click(); } }));
  $("#planner").addEventListener("click", (e) => {
    const c = e.target.closest("[data-clear]"); if (!c) return;
    e.preventDefault();
    const f = c.dataset.clear; if (f === "from") S.from = null; else S.to = null;
    fillField(f); focusField(f);
  });
  $("#plBack").addEventListener("click", () => { if (!S.from) S.from = { kind: "me" }; closePlanner(); paintPlan(); });
  $("#plSwap").addEventListener("click", () => {
    const a = S.from, b = S.to; S.from = b || { kind: "me" }; S.to = a && !(a.kind === "me" && !b) ? a : null;
    if (S.to && S.to.kind === "me" && S.from.kind === "me") S.to = null;
    fillField("from"); fillField("to");
    if (resolve(S.from) && resolve(S.to)) { closePlanner(); buildRoute(false); } else focusField(S.to ? "from" : "to");
  });

  function suggest(v) {
    const f = S.field;
    const n = norm(v);
    local = (n ? PINNED.filter((r) => !r.closed && (norm(r.n).includes(n) || norm(r.addr).includes(n))) : PINNED.filter((r) => S.saved.has(r.id) && !r.closed)).slice(0, 6);
    let h = "";
    const items = [];
    if (!v) {
      if (f === "from" || (S.from && S.from.kind !== "me")) items.push({ k: "me", ic: `<span class="ic me">${ICON.me}</span>`, t1: "My location", t2: S.me && inParis(S.me) ? "Live GPS position" : S.realMe ? `You're ${fmtDist(hav(S.realMe, PARIS))} from Paris right now` : "Uses your phone's GPS" });
      items.push({ k: "map", ic: `<span class="ic">${ICON.map}</span>`, t1: "Choose on map", t2: f === "from" ? "Drop the start pin anywhere" : "Drop the destination pin anywhere" });
      h += items.map(optHTML).join("");
      if (local.length) h += `<div class="pl-sec">Want to go</div>`;
    } else if (local.length) h += `<div class="pl-sec">Restaurants</div>`;
    h += local.map((r, i) => optHTML({ k: "r" + i, ic: `<span class="ic cat" style="--cc:var(--c-${r.c})">${glyph(r.c, 18)}</span>`, t1: r.n, t2: `${CATS[r.c].short} · ${r.p} · ${r.addr}, ${arr(r.pc)}` })).join("");
    if (v) {
      if (remote.length) h += `<div class="pl-sec">Places &amp; addresses</div>` + remote.map((p, i) => optHTML({ k: "p" + i, ic: `<span class="ic">${ICON.pin}</span>`, t1: p.title, t2: p.sub })).join("");
      else if (!local.length) h += `<div class="hint">Searching Paris…</div>`;
    } else {
      h += `<div class="pl-sec">Popular spots</div>` + LANDMARKS.map((l, i) => optHTML({ k: "l" + i, ic: `<span class="ic">${ICON.pin}</span>`, t1: l[0], t2: l[3] + " arrondissement" })).join("");
      h += `<div class="hint">Or type any address, landmark or restaurant from your list.</div>`;
    }
    plRes.innerHTML = h;
  }
  const LANDMARKS = [
    ["Musée du Louvre", 48.8611, 2.3358, "1er"], ["Tour Eiffel", 48.8584, 2.2945, "7e"], ["Notre-Dame", 48.8530, 2.3499, "4e"],
    ["Sacré-Cœur", 48.8867, 2.3431, "18e"], ["Arc de Triomphe", 48.8738, 2.2950, "8e"], ["Place des Vosges", 48.8556, 2.3655, "4e"],
    ["Place de la Bastille", 48.8532, 2.3692, "11e"], ["Gare du Nord", 48.8809, 2.3553, "10e"], ["Saint-Germain-des-Prés", 48.8540, 2.3336, "6e"], ["Canal Saint-Martin", 48.8710, 2.3650, "10e"]
  ];
  const optHTML = (o) => `<button class="opt" data-k="${o.k}">${o.ic}<span class="t"><div class="t1">${esc(o.t1)}</div><div class="t2">${esc(o.t2 || "")}</div></span></button>`;
  async function remoteSearch(v) {
    try {
      qAbort && qAbort.abort(); qAbort = new AbortController();
      const c = map.getCenter();
      const url = `https://photon.komoot.io/api/?q=${encodeURIComponent(v)}&lat=${c.lat.toFixed(4)}&lon=${c.lng.toFixed(4)}&limit=7&bbox=2.20,48.79,2.50,48.93`;
      const j = await (await fetch(url, { signal: qAbort.signal })).json();
      remote = (j.features || []).map((f) => {
        const p = f.properties; const [lng, lat] = f.geometry.coordinates;
        const street = [p.housenumber, p.street].filter(Boolean).join(" ");
        const title = p.name || street || p.city;
        const sub = [p.name && street ? street : "", p.postcode, p.district || p.city].filter(Boolean).join(", ");
        return { lat, lng, title, sub };
      });
    } catch (e) { if (e.name === "AbortError") return; remote = []; }
    const cur = (S.field === "from" ? fromQ : toQ).value.trim();
    if (cur === v) { suggest(v); if (!remote.length && !local.length) plRes.innerHTML = `<div class="hint">No match in Paris. Try another spelling, or choose on the map.</div>`; }
  }
  plRes.addEventListener("click", (e) => {
    const b = e.target.closest(".opt"); if (!b) return;
    const k = b.dataset.k, f = S.field;
    let place = null;
    if (k === "me") place = { kind: "me" };
    else if (k === "map") { closePlanner(); return startPick(f); }
    else if (k[0] === "r") { const r = local[+k.slice(1)]; place = { lat: r.lat, lng: r.lng, label: r.n, rid: r.id }; }
    else if (k[0] === "p") { const p = remote[+k.slice(1)]; place = { lat: p.lat, lng: p.lng, label: p.title }; }
    else if (k[0] === "l") { const l = LANDMARKS[+k.slice(1)]; place = { lat: l[1], lng: l[2], label: l[0] }; }
    setPlace(f, place);
  });
  function setPlace(f, place) {
    if (f === "from") S.from = place; else S.to = place;
    if (S.from && S.to && S.from.kind === "me" && S.to.kind === "me") S.to = null;
    fillField("from"); fillField("to"); remote = [];
    if (!S.from) return focusField("from");
    if (!S.to) return focusField("to");
    if (S.from.kind === "me" && !resolve(S.from)) {
      return (toast(`You're not in Paris yet, so pick where you'll start.`, 3500), focusField("from"));
    }
    closePlanner(); S.selected = null; S.alerted = new Set(); S.listLimit = 30; buildRoute(false);
  }

  // ── choose on map ──
  let pickField = null;
  function startPick(f) {
    pickField = f; S.selected = null;
    $("#pick").hidden = false; $("#top").style.visibility = "hidden";
    $("#pickHint").textContent = f === "from" ? "Move the map to place your start" : "Move the map to place your destination";
    $("#pickOk").textContent = f === "from" ? "Start here" : "Go here";
    document.documentElement.style.setProperty("--top-h", "0px");
  }
  function endPick() { $("#pick").hidden = true; $("#top").style.visibility = ""; document.documentElement.style.setProperty("--top-h", "84px"); }
  $("#pickCancel").addEventListener("click", () => { endPick(); openPlanner(pickField); });
  $("#pickOk").addEventListener("click", async () => {
    const c = map.getContainer().getBoundingClientRect();
    const ll = map.unproject([c.width / 2, (c.height - sheetH()) / 2]);
    endPick();
    const place = { lat: ll.lat, lng: ll.lng, label: "Pinned spot" };
    const f = pickField;
    if (f === "to" && !S.from) S.from = { kind: "me" };
    if (f === "from" && !S.to) { S.from = place; reverseName(place); return openPlanner("to"); }
    setPlace(f, place); reverseName(place);
  });
  async function reverseName(place) {
    try {
      const j = await (await fetch(`https://photon.komoot.io/reverse?lat=${place.lat}&lon=${place.lng}&limit=1`)).json();
      const p = j.features && j.features[0] && j.features[0].properties;
      if (p) { place.label = p.name || [p.housenumber, p.street].filter(Boolean).join(" ") || place.label; paintPlan(); if (!$("#planner").hidden) { fillField("from"); fillField("to"); } }
    } catch (e) {}
  }

  // press-and-hold (or right-click) on the map: walk from / to here
  let holdT = null, holdPt = null, popup = null;
  function holdMenu(lngLat) {
    popup && popup.remove();
    const div = document.createElement("div");
    div.className = "tap-pop";
    div.innerHTML = `<button data-h="from">Start here</button><button class="go" data-h="to">Go here</button>`;
    div.addEventListener("click", (e) => {
      const b = e.target.closest("[data-h]"); if (!b) return;
      popup.remove(); const place = { lat: lngLat.lat, lng: lngLat.lng, label: "Pinned spot" };
      if (b.dataset.h === "to" && !S.from) S.from = { kind: "me" };
      if (b.dataset.h === "from" && !S.to) { S.from = place; reverseName(place); paintPlan(); return openPlanner("to"); }
      setPlace(b.dataset.h, place); reverseName(place);
    });
    popup = new maplibregl.Popup({ closeButton: false, offset: 10, maxWidth: "320px" }).setLngLat(lngLat).setDOMContent(div).addTo(map);
    buzz();
  }
  map.on("contextmenu", (e) => holdMenu(e.lngLat));
  map.on("touchstart", (e) => {
    if (e.originalEvent.touches.length !== 1) return;
    holdPt = e.point; clearTimeout(holdT);
    holdT = setTimeout(() => holdMenu(e.lngLat), 550);
  });
  map.on("touchmove", (e) => { if (holdPt && (Math.abs(e.point.x - holdPt.x) > 8 || Math.abs(e.point.y - holdPt.y) > 8)) clearTimeout(holdT); });
  map.on("touchend", () => clearTimeout(holdT));
  map.on("movestart", () => clearTimeout(holdT));
  map.on("click", () => { if (S.selected) unselect(); });

  // ── sheet: draggable with three snap heights ──
  const SNAPS = { peek: () => 196, half: () => Math.round(innerHeight * 0.46), full: () => Math.round(innerHeight - topH() - 12) };
  function setSheetH(h) { document.documentElement.style.setProperty("--sheet-h", Math.round(h) + "px"); }
  function setSnap(s, px) { S.snap = s; setSheetH(px || SNAPS[s]()); }
  addEventListener("resize", () => setSnap(S.snap));
  let drag = null;
  $("#grab").addEventListener("pointerdown", (e) => {
    if (e.target.closest("button")) return;
    drag = { y: e.clientY, h: sheetH(), moved: false, t: Date.now() };
    $("#grab").setPointerCapture(e.pointerId);
    document.body.classList.add("dragging");
  });
  $("#grab").addEventListener("pointermove", (e) => {
    if (!drag) return;
    const dy = e.clientY - drag.y; if (Math.abs(dy) > 5) drag.moved = true;
    setSheetH(Math.min(SNAPS.full(), Math.max(120, drag.h - dy)));
  });
  const endDrag = (e) => {
    if (!drag) return;
    document.body.classList.remove("dragging");
    const h = sheetH(), v = (drag.h - h) / Math.max(1, Date.now() - drag.t);
    if (!drag.moved) { const order = ["peek", "half", "full"]; setSnap(S.selected ? "full" : order[(order.indexOf(S.snap) + 1) % 3]); }
    else if (S.selected && h < SNAPS.half() * 0.7) unselect();
    else {
      const cand = ["peek", "half", "full"].map((s) => [s, Math.abs(SNAPS[s]() - h + v * 180)]).sort((a, b) => a[1] - b[1])[0][0];
      setSnap(cand);
    }
    drag = null;
  };
  $("#grab").addEventListener("pointerup", endDrag);
  $("#grab").addEventListener("pointercancel", endDrag);

  // ── lists ──
  function onWay() {
    if (!S.route) return [];
    const corridor = (S.detour * WALK) / 2, out = [];
    for (const r of suggestable()) {
      if ((S.to && S.to.rid === r.id) || (S.from && S.from.rid === r.id)) continue;
      const pr = project(S.route, xy(r.lat, r.lng));
      r._d = pr.d; r._s = pr.s;
      if (pr.d <= corridor && pr.s >= S.progress - 40) out.push(r);
    }
    return out.sort((a, b) => a._s - b._s);
  }
  function nearby() {
    const list = suggestable();
    const ref = S.me && inParis(S.me) ? S.me : null;
    list.forEach((r) => (r._m = ref ? hav(ref, r) : null));
    if (ref) list.sort((a, b) => a._m - b._m); else list.sort((a, b) => a.n.localeCompare(b.n, "fr"));
    return { list, ref };
  }

  function rowHTML(r, right) {
    const flag = r.w ? ' <span class="flag" title="Check before going">⚠</span>' : "";
    const mark = S.tried.has(r.id) ? '<i class="tried"></i>' : S.saved.has(r.id) ? '<i class="saved"></i>' : "";
    return `<button class="row" data-id="${r.id}" style="--cc:var(--c-${r.c})"><span class="rico">${glyph(r.c, 20)}${mark}</span><span style="min-width:0"><div class="nm">${esc(r.n)}${flag}</div><div class="ds">${CATS[r.c].short} · ${r.p} · ${arr(r.pc)}</div></span><span class="rt">${right}</span></button>`;
  }
  function chipsHTML() {
    const counts = {}; PINNED.forEach((r) => !r.closed && (counts[r.c] = (counts[r.c] || 0) + 1));
    const nf = (PRICES.length - S.prices.size) + (S.mine !== "all" ? 1 : 0);
    return `<div class="chips"><button class="chip plain" data-cat="" aria-pressed="${!S.cat}">All</button>${Object.entries(CATS).map(([k, v]) => `<button class="chip" data-cat="${k}" aria-pressed="${S.cat === k}" style="--cc:var(--c-${k})"><span class="cdot">${glyph(k, 13)}</span>${v.short} <span class="n">${counts[k] || 0}</span></button>`).join("")}<button class="chip plain" data-filters aria-pressed="${nf > 0}">${ICON.filter} Filters${nf ? " · " + nf : ""}</button></div>`;
  }

  function render() {
    const head = $("#sheetHead"), body = $("#sheetBody");
    let ids = new Set();
    if (S.selected) {
      const r = ALL.find((x) => x.id === S.selected);
      head.innerHTML = ""; body.innerHTML = detailHTML(r); loadPhoto(r);
    } else if (S.route || (S.to && S.routing)) {
      const list = onWay(); ids = new Set(list.map((r) => r.id));
      head.innerHTML = `<div class="sh-head"><h2>On your way</h2><span class="count">${list.length} spot${list.length === 1 ? "" : "s"} within ${S.detour} min</span></div>`;
      const seg = [2, 4, 6, 10].map((m) => `<button class="chip plain" data-detour="${m}" aria-pressed="${S.detour === m}">+${m} min</button>`).join("");
      let rows = list.map((r) => {
        const ahead = r._s - S.progress;
        return rowHTML(r, `<b>${ahead < 30 ? "Here" : "in " + fmtDist(ahead)}</b><small>+${Math.max(1, Math.round((2 * r._d) / WALK))} min detour</small>`);
      }).join("");
      if (!list.length) rows = `<div class="empty">${S.route ? `Nothing within a ${S.detour}-minute detour. Widen it above.` : "Finding a walking route…"}</div>`;
      body.innerHTML = `<div class="chips"><span style="align-self:center;color:var(--muted);font-size:13px;margin-right:2px">Detour</span>${seg}</div><div class="list">${rows}</div>`;
      if (S.me && inParis(S.me)) list.forEach((r) => { if (!S.alerted.has(r.id) && hav(S.me, r) < 60) { S.alerted.add(r.id); toast(`Coming up: ${r.n} · ${fmtDist(hav(S.me, r))}`); buzz(); } });
    } else {
      const { list, ref } = nearby();
      const shown = list.slice(0, S.listLimit);
      const rows = shown.map((r) => rowHTML(r, ref ? `<b>${fmtDist(r._m)}</b><small>${fmtMin(r._m * 1.25)} walk</small>` : `<small>${arr(r.pc)}</small>`)).join("");
      const more = list.length > shown.length ? `<button class="more" data-more>Show ${Math.min(30, list.length - shown.length)} more</button>` : "";
      const demo = ref ? "" : `<button class="cta" data-demo><span class="ic">${ICON.play}</span><span>Not in Paris yet? <b>Watch a demo walk</b><br><small style="color:var(--muted)">See restaurants pop up as you walk</small></span></button>`;
      head.innerHTML = `<div class="sh-head"><h2>${ref ? "Near you" : "Paris, unstarred"}</h2><span class="count">${list.length} places</span></div>${chipsHTML()}`;
      body.innerHTML = `${demo}<div class="list">${rows || '<div class="empty">Nothing matches these filters.</div>'}${more}</div>`;
    }
    refreshMarkers(ids);
    paintPlan();
  }

  function detailHTML(r) {
    if (!r) return "";
    const ref = S.me && inParis(S.me) ? S.me : null;
    const q = encodeURIComponent(`${r.n}, ${r.addr}, ${r.pc} Paris`);
    const apple = `https://maps.apple.com/?daddr=${r.lat},${r.lng}&dirflg=w`;
    const google = `https://www.google.com/maps/search/?api=1&query=${q}`;
    const pics = `https://www.google.com/search?tbm=isch&q=${encodeURIComponent(r.n + " " + r.addr + " Paris")}`;
    const dl = ref ? `<div class="dist-line">${fmtDist(hav(ref, r))} away · about ${fmtMin(hav(ref, r) * 1.25)} on foot</div>` : "";
    const k = r.closed ? "closed" : r.c;
    return `<div class="detail">
      <div class="photo" id="photo" style="--cc:var(--c-${k})"><span class="ph-glyph">${glyph(k, 46)}</span><a class="credit" id="credit" hidden target="_blank" rel="noopener"></a><button class="icon-btn x" data-close aria-label="Close">${ICON.x}</button></div>
      <h3>${esc(r.n)}</h3>
      <div class="tags"><span class="plaque">${arr(r.pc)} arr.</span><span class="tag" style="--cc:var(--c-${r.c})"><span class="cdot"></span>${CATS[r.c].label}</span><span class="tag">${r.p}</span></div>
      ${dl}${r.closed ? `<div class="warn"><b>Permanently closed.</b> Kept on the map so you don't go looking for it.</div>` : ""}
      <p>${esc(r.d)}</p>${r.w ? `<div class="warn">⚠ ${esc(r.w)}</div>` : ""}
      <div class="addr"><span>${esc(r.addr)}, ${esc(r.pc)} Paris</span><button class="icon-btn" data-copy="${esc(r.addr + ", " + r.pc + " Paris")}" aria-label="Copy address"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V5a1 1 0 0 1 1-1h9"/></svg></button></div>
      ${r.closed ? "" : `<div class="go2"><button class="btn" data-from="${r.id}">Start here</button><button class="btn primary" data-to="${r.id}">${ICON.walk}Go here</button></div>`}
      <div class="mine2"><button class="btn save" data-save="${r.id}" aria-pressed="${S.saved.has(r.id)}">${S.saved.has(r.id) ? "★ Want to go" : "☆ Want to go"}</button><button class="btn tried" data-tried="${r.id}" aria-pressed="${S.tried.has(r.id)}">${S.tried.has(r.id) ? "✓ Tried it" : "Mark as tried"}</button></div>
      <div class="links"><a class="btn" href="${pics}" target="_blank" rel="noopener">Photos</a><a class="btn" href="${google}" target="_blank" rel="noopener">Reviews</a><a class="btn" href="${apple}" target="_blank" rel="noopener">Apple Maps</a></div>
    </div>`;
  }

  async function loadPhoto(r) {
    const cache = store.get("photos", {});
    let hit = cache[r.id];
    if (hit === undefined) {
      try {
        const name = r.n.replace(/\s*\(.*\)\s*$/, "").replace(/,.*$/, "");
        const url = `https://fr.wikipedia.org/w/api.php?action=query&format=json&origin=*&generator=search&gsrsearch=${encodeURIComponent(name + " Paris restaurant")}&gsrlimit=4&prop=pageimages|extracts&exintro=1&explaintext=1&exchars=500&piprop=thumbnail&pithumbsize=900`;
        const j = await (await fetch(url)).json();
        const pages = Object.values((j.query && j.query.pages) || {}).sort((a, b) => a.index - b.index);
        const nn = norm(name), kw = /restaurant|brasserie|bouillon|bistrot|bistro|caf[eé]|cave|bar à vin|traiteur|charcut/i;
        const p = pages.find((pg) => {
          const t = norm(pg.title.replace(/\s*\(.*\)\s*$/, ""));
          return pg.thumbnail && t.length >= 4 && (t.includes(nn) || nn.includes(t)) && kw.test(pg.extract || "") && /paris/i.test(pg.extract || "");
        });
        hit = p ? { src: p.thumbnail.source, page: p.title } : null;
        cache[r.id] = hit; store.set("photos", cache);
      } catch (e) { hit = null; }
    }
    const box = $("#photo");
    if (!hit || !box || S.selected !== r.id) return;
    const img = new Image();
    img.onload = () => { if (S.selected !== r.id || !$("#photo")) return; const b = $("#photo"); b.style.backgroundImage = `url("${hit.src}")`; b.classList.add("has-img"); const c = $("#credit"); c.href = "https://fr.wikipedia.org/wiki/" + encodeURIComponent(hit.page); c.textContent = "Photo: Wikipedia"; c.hidden = false; };
    img.src = hit.src;
  }

  function select(id) {
    popup && popup.remove();
    S.selected = id; render(); setSnap("full", Math.min(SNAPS.full(), Math.max(SNAPS.half(), 600)));
    const r = ALL.find((x) => x.id === id);
    if (r && r.lat != null) setTimeout(() => { S.follow = false; updateLocateBtn(); centerOn(r.lat, r.lng, Math.max(map.getZoom(), 15.5)); }, 30);
  }
  function unselect() { S.selected = null; setSnap(S.route ? "half" : "peek"); render(); }

  // sheet interactions
  sheet.addEventListener("click", (e) => {
    const t = e.target.closest("button,a"); if (!t) return;
    const r = (id) => ALL.find((x) => x.id === id);
    if (t.dataset.id) return select(t.dataset.id);
    if (t.dataset.cat !== undefined) { S.cat = t.dataset.cat || null; store.set("cat", S.cat); S.listLimit = 30; render(); if (!S.route) fitAll(); return; }
    if (t.hasAttribute("data-filters")) { paintFilters(); $("#panel").hidden = false; return; }
    if (t.dataset.detour) { S.detour = +t.dataset.detour; store.set("detour", S.detour); return render(); }
    if (t.hasAttribute("data-more")) { S.listLimit += 30; return render(); }
    if (t.hasAttribute("data-demo")) return startDemo();
    if (t.hasAttribute("data-close")) return unselect();
    if (t.dataset.to) { const x = r(t.dataset.to); S.selected = null; if (!S.from) S.from = { kind: "me" }; return setPlace("to", { lat: x.lat, lng: x.lng, label: x.n, rid: x.id }); }
    if (t.dataset.from) { const x = r(t.dataset.from); S.selected = null; S.from = { lat: x.lat, lng: x.lng, label: x.n, rid: x.id }; render(); if (S.to) return setPlace("from", S.from); return openPlanner("to"); }
    if (t.dataset.save) { toggle(S.saved, t.dataset.save, "saved"); return render(); }
    if (t.dataset.tried) { toggle(S.tried, t.dataset.tried, "tried"); return render(); }
    if (t.dataset.copy) { const txt = t.dataset.copy; try { navigator.clipboard.writeText(txt).then(() => toast("Address copied"), () => toast(txt, 5000)); } catch (err) { toast(txt, 5000); } }
  });
  function toggle(set, id, key) { set.has(id) ? set.delete(id) : set.add(id); store.set(key, [...set]); }

  // ── filters panel ──
  function paintFilters() {
    $("#fPrices").innerHTML = PRICES.map((p) => `<button class="chip plain" data-price="${p}" aria-pressed="${S.prices.has(p)}">${p}</button>`).join("");
    $("#fMine").innerHTML = [["all", "Everything"], ["saved", `★ Want to go (${S.saved.size})`], ["untried", "Not tried yet"]].map(([k, l]) => `<button class="chip plain" data-mine="${k}" aria-pressed="${S.mine === k}">${l}</button>`).join("");
  }
  $("#panel").addEventListener("click", (e) => {
    if (e.target.id === "panel" || e.target.id === "fDone") { $("#panel").hidden = true; return; }
    const t = e.target.closest("button"); if (!t) return;
    if (t.dataset.price) { const k = t.dataset.price; if (S.prices.has(k)) { if (S.prices.size > 1) S.prices.delete(k); } else S.prices.add(k); store.set("prices", [...S.prices]); }
    if (t.dataset.mine) { S.mine = t.dataset.mine; store.set("mine", S.mine); }
    if (t.id === "fReset") { S.prices = new Set(PRICES); S.mine = "all"; S.cat = null; store.set("prices", PRICES); store.set("mine", "all"); store.set("cat", null); }
    paintFilters(); render();
  });

  $("#btnLocate").addEventListener("click", () => {
    if (S.follow && S.me && inParis(S.me)) { S.follow = false; updateLocateBtn(); return; }
    startLocate(true);
  });
  $("#btnAll").addEventListener("click", () => { S.follow = false; updateLocateBtn(); if (S.route) fitRoute(); else fitAll(); });

  // ── demo walk: République → Louvre at ~10× speed, so the app can be tried from anywhere ──
  function feed(lat, lng, heading) { onPos({ demo: true, coords: { latitude: lat, longitude: lng, accuracy: 8, heading, speed: 1.4 } }); }
  function startDemo() {
    stopDemo(false);
    $("#banner").hidden = true;
    S.demo = true; S.follow = true; S.selected = null;
    feed(48.8676, 2.3637, null);
    S.from = { lat: 48.8676, lng: 2.3637, label: "Place de la République", demo: true };
    S.to = { lat: 48.8611, lng: 2.3358, label: "Musée du Louvre" };
    buildRoute(false);
    toast("Demo walk: République → Louvre. Watch spots come up as you pass them.", 4500);
    let wait = 0;
    S.demoT = setInterval(() => {
      if (!S.route) { if (++wait > 30) stopDemo(true); return; }
      if (S.selected) return;
      const R = S.route, target = (S.demoS = (S.demoS || 0) + 9);
      if (target >= R.cum[R.cum.length - 1]) { clearInterval(S.demoT); toast("Demo finished. Tap ✕ at the top to end it.", 4000); return; }
      let i = 1; while (i < R.cum.length - 1 && R.cum[i] < target) i++;
      const a = R.latlngs[i - 1], b = R.latlngs[i], seg = R.cum[i] - R.cum[i - 1] || 1, t = (target - R.cum[i - 1]) / seg;
      const brg = (Math.atan2((b[1] - a[1]) * KX, (b[0] - a[0]) * KY) * 180 / Math.PI + 360) % 360;
      if (S.demoS === 9) { S.follow = true; centerOn(a[0], a[1], 16.3, 900); }
      feed(a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, brg);
    }, 450);
  }
  function stopDemo(reset) {
    clearInterval(S.demoT); S.demoT = null; S.demoS = 0;
    if (reset && S.demo) {
      S.demo = false; S.me = S.realMe || null; placeMe();
      meEl.classList.remove("has-heading");
      S.follow = inParis(S.me); updateLocateBtn();
    }
  }

  // ── refine pin positions against the French national address base (BAN), cached on the phone ──
  async function geocodeOne(r) {
    const qs = `q=${encodeURIComponent(r.addr)}&postcode=${r.pc}&limit=1`;
    for (const base of ["https://data.geopf.fr/geocodage/search?", "https://api-adresse.data.gouv.fr/search/?"]) {
      try {
        const res = await fetch(base + qs); if (!res.ok) continue;
        const j = await res.json(); const f = j.features && j.features[0];
        if (!f) return { a: r.addr, ll: null };
        const [lng, lat] = f.geometry.coordinates;
        const ok = f.properties.score > 0.5 && f.properties.postcode === r.pc && hav({ lat, lng }, r) < 1500;
        return { a: r.addr, ll: ok ? [lat, lng] : null };
      } catch (e) {}
    }
    return undefined;
  }
  async function refine() {
    const cache = store.get("geo", {});
    const apply = (r, ll) => { r.lat = ll[0]; r.lng = ll[1]; markers.get(r.id).m.setLngLat([ll[1], ll[0]]); };
    PINNED.forEach((r) => { const c = cache[r.id]; if (c && c.a === r.addr && c.ll) apply(r, c.ll); });
    const todo = PINNED.filter((r) => r.addr && !(cache[r.id] && cache[r.id].a === r.addr));
    if (!todo.length) return;
    let i = 0, changed = 0;
    const worker = async () => { while (i < todo.length) { const r = todo[i++]; const out = await geocodeOne(r); if (out === undefined) continue; cache[r.id] = out; if (out.ll) { apply(r, out.ll); changed++; } } };
    await Promise.all([worker(), worker(), worker(), worker(), worker()]);
    store.set("geo", cache);
    if (changed) render();
  }

  // ── boot ──
  setSnap("peek");
  paintPlan();
  render();
  zoomClasses();
  map.once("load", () => { if (!S.me || !inParis(S.me)) fitAll(); });
  setTimeout(() => { if (!styleOK && (!S.me || !inParis(S.me))) fitAll(); }, 1200);
  startLocate(false);
  setTimeout(refine, 1500);
  if ("serviceWorker" in navigator && location.protocol === "https:") navigator.serviceWorker.register("sw.js").catch(() => {});
  window.__pt = { S, map, onWay, render, select, startDemo, setPlace, openPlanner, buildRoute };
})();
