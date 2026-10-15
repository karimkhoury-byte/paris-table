/* Paris Table — walking map of 100 unstarred Paris restaurants */
(() => {
  "use strict";
  const $ = (s) => document.querySelector(s);
  const CATS = window.CATEGORIES;
  const ALL = window.RESTAURANTS;
  const PINNED = ALL.filter((r) => r.lat != null);
  const PRICES = ["€", "€€", "€€€"];
  const WALK = 80; // metres per minute (~4.8 km/h)
  const PARIS = { lat: 48.8566, lng: 2.3522 };

  // ── storage (best effort) ──
  const store = {
    get(k, d) { try { const v = localStorage.getItem("pt:" + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem("pt:" + k, JSON.stringify(v)); } catch (e) {} }
  };

  const S = {
    me: null, heading: null, watch: null, follow: false, firstFix: true,
    dest: null, start: null, route: null, routing: false, lastRouteAt: 0, progress: 0,
    detour: store.get("detour", 4),
    cats: new Set(store.get("cats", Object.keys(CATS))),
    prices: new Set(store.get("prices", PRICES)),
    mine: store.get("mine", "all"), // all | saved | untried
    tried: new Set(store.get("tried", [])),
    saved: new Set(store.get("saved", [])),
    selected: null, sheet: "peek", alerted: new Set(), listLimit: 30, wake: null
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
  const fmtDist = (m) => m < 950 ? Math.max(10, Math.round(m / 10) * 10) + " m" : (m / 1000).toFixed(m < 9950 ? 1 : 0) + " km";
  const fmtMin = (m) => Math.max(1, Math.round(m / WALK)) + " min";
  const arr = (pc) => { if (!pc) return ""; const n = parseInt(pc.slice(-2), 10); return n === 1 ? "1er" : n + "e"; };
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const norm = (s) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  const inParis = (p) => hav(p, PARIS) < 25000;

  // ── toast ──
  let toastT;
  function toast(msg, ms = 3200) {
    const t = $("#toast"); t.textContent = msg; t.hidden = false;
    clearTimeout(toastT); toastT = setTimeout(() => (t.hidden = true), ms);
  }

  // ── map ──
  const map = L.map("map", { zoomControl: false, attributionControl: true, tap: true }).setView([PARIS.lat, PARIS.lng], 13);
  const dark = window.matchMedia("(prefers-color-scheme: dark)");
  let tiles;
  function setTiles() {
    if (tiles) map.removeLayer(tiles);
    const style = dark.matches ? "dark_all" : "rastertiles/voyager";
    tiles = L.tileLayer(`https://{s}.basemaps.cartocdn.com/${style}/{z}/{x}/{y}{r}.png`, {
      maxZoom: 20, subdomains: "abcd", attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> © <a href="https://carto.com/attributions">CARTO</a>'
    }).addTo(map);
  }
  setTiles();
  dark.addEventListener && dark.addEventListener("change", setTiles);

  function zoomClasses() {
    const z = map.getZoom(), el = map.getContainer();
    el.classList.toggle("z-labels", z >= 17);
    el.classList.toggle("z-mid", z >= 15);
  }
  map.on("zoomend", zoomClasses);

  // ── markers ──
  const markers = new Map();
  const visibleSet = () => PINNED.filter((r) =>
    S.cats.has(r.c) && S.prices.has(r.p) &&
    (S.mine !== "saved" || S.saved.has(r.id)) && (S.mine !== "untried" || !S.tried.has(r.id)));
  const suggestable = () => visibleSet().filter((r) => !r.closed);

  PINNED.forEach((r) => {
    const icon = L.divIcon({ className: "pt-pin", html: `<span class="pin" style="--cc:var(--c-${r.closed ? "closed" : r.c})"><i></i><b>${esc(r.n)}</b></span>`, iconSize: [22, 22] });
    const m = L.marker([r.lat, r.lng], { icon, keyboard: true, title: r.n, riseOnHover: true });
    m.on("click", (e) => { L.DomEvent.stopPropagation(e); select(r.id, false); });
    markers.set(r.id, m);
  });

  function refreshMarkers(onwayIds = new Set()) {
    const vis = new Set(visibleSet().map((r) => r.id));
    PINNED.forEach((r) => {
      const m = markers.get(r.id);
      const show = vis.has(r.id) || S.selected === r.id;
      if (show && !map.hasLayer(m)) m.addTo(map);
      if (!show && map.hasLayer(m)) map.removeLayer(m);
      const el = m.getElement(); if (!el) return;
      const onway = onwayIds.has(r.id);
      el.classList.toggle("onway", onway);
      el.classList.toggle("dim", !!S.route && !onway && S.selected !== r.id && !(S.dest && S.dest.rid === r.id));
      el.classList.toggle("sel", S.selected === r.id);
      el.classList.toggle("saved", S.saved.has(r.id));
      el.classList.toggle("tried", S.tried.has(r.id));
      el.classList.toggle("closed", !!r.closed);
      m.setZIndexOffset(S.selected === r.id ? 2000 : onway ? 1000 : 0);
    });
    const n = Object.keys(CATS).length - S.cats.size + (PRICES.length - S.prices.size) + (S.mine !== "all" ? 1 : 0);
    $("#filterBadge").hidden = n === 0; $("#filterBadge").textContent = n;
  }

  function fitAll() {
    const pts = visibleSet().map((r) => [r.lat, r.lng]);
    if (S.me && inParis(S.me)) pts.push([S.me.lat, S.me.lng]);
    if (!pts.length) return;
    map.fitBounds(pts, { paddingTopLeft: [20, 80], paddingBottomRight: [20, sheetH() + 20], maxZoom: 16 });
  }

  // ── location ──
  const meIcon = L.divIcon({ className: "me-pin", html: '<span class="me"><span class="cone"></span><span class="pulse"></span><span class="core"></span></span>', iconSize: [24, 24] });
  let meMarker = null, accCircle = null;

  function startLocate(andFollow) {
    if (!("geolocation" in navigator)) { toast("This browser can't share your location."); return; }
    if (andFollow) S.follow = true;
    askCompass();
    if (S.watch != null) { if (S.me && andFollow) recenter(); updateLocateBtn(); return; }
    S.watch = navigator.geolocation.watchPosition(onPos, onPosErr, { enableHighAccuracy: true, maximumAge: 4000, timeout: 25000 });
    updateLocateBtn();
  }
  function recenter() { if (S.me) map.setView([S.me.lat, S.me.lng], Math.max(map.getZoom(), 16), { animate: true }); }
  function updateLocateBtn() {
    const b = $("#btnLocate");
    b.classList.toggle("on", S.watch != null);
    b.classList.toggle("follow", S.follow && !!S.me);
    b.setAttribute("aria-label", S.follow ? "Following you" : "Show my location");
  }
  function onPosErr(err) {
    if (err.code === 1) { toast("Location is off. Allow it in Settings → Safari → Location to track your walk.", 5000); navigator.geolocation.clearWatch(S.watch); S.watch = null; S.follow = false; updateLocateBtn(); }
  }
  let lastRender = 0;
  function onPos(pos) {
    const p = { lat: pos.coords.latitude, lng: pos.coords.longitude, acc: pos.coords.accuracy };
    S.me = p;
    if (!meMarker) {
      meMarker = L.marker([p.lat, p.lng], { icon: meIcon, interactive: false, zIndexOffset: 3000 }).addTo(map);
      accCircle = L.circle([p.lat, p.lng], { radius: p.acc, stroke: false, fillColor: getComputedStyle(document.documentElement).getPropertyValue("--me").trim() || "#1a73e8", fillOpacity: 0.12, interactive: false }).addTo(map);
    } else { meMarker.setLatLng([p.lat, p.lng]); accCircle.setLatLng([p.lat, p.lng]).setRadius(p.acc); }
    if (pos.coords.heading != null && !isNaN(pos.coords.heading) && pos.coords.speed > 0.5) setHeading(pos.coords.heading);

    if (S.firstFix) {
      S.firstFix = false;
      if (inParis(p)) { S.follow = true; map.setView([p.lat, p.lng], 16); }
      else { S.follow = false; toast(`You're ${fmtDist(hav(p, PARIS))} from Paris. Showing the city; walks start from where you tap.`, 5200); }
    } else if (S.follow && inParis(p)) {
      map.panTo([p.lat, p.lng], { animate: true, duration: 0.6 });
    }
    updateLocateBtn();

    if (S.route && inParis(p)) {
      const pr = project(S.route, xy(p.lat, p.lng));
      S.progress = Math.max(0, pr.s);
      const offRoute = pr.d > 70 && p.acc < 60;
      if (offRoute && !S.start && !S.routing && Date.now() - S.lastRouteAt > 25000) { buildRoute(true); return; }
      if (S.dest && hav(p, S.dest) < 35 && !S.alerted.has("arrived")) { S.alerted.add("arrived"); toast(`You've arrived: ${S.dest.label}`, 5000); buzz(); }
    }
    const now = Date.now();
    if (now - lastRender > 2500) { lastRender = now; render(); }
  }

  function setHeading(h) {
    S.heading = h;
    const el = meMarker && meMarker.getElement(); if (!el) return;
    const me = el.querySelector(".me"); me.classList.add("has-heading");
    me.querySelector(".cone").style.transform = `rotate(${h}deg)`;
  }
  let compassAsked = false;
  function askCompass() {
    if (compassAsked) return; compassAsked = true;
    const attach = () => window.addEventListener("deviceorientation", (e) => {
      let h = null;
      if (typeof e.webkitCompassHeading === "number") h = e.webkitCompassHeading;
      else if (e.absolute && e.alpha != null) h = 360 - e.alpha;
      if (h != null) setHeading(h);
    }, true);
    try {
      if (window.DeviceOrientationEvent && typeof DeviceOrientationEvent.requestPermission === "function") {
        DeviceOrientationEvent.requestPermission().then((s) => s === "granted" && attach()).catch(() => {});
      } else attach();
    } catch (e) {}
  }
  function buzz() { try { navigator.vibrate && navigator.vibrate([60, 60, 60]); } catch (e) {} }

  map.on("dragstart", () => { if (S.follow) { S.follow = false; updateLocateBtn(); } });

  // ── routing ──
  let routeLine = null, routeCasing = null, destMarker = null, startMarker = null;
  const destIcon = L.divIcon({ className: "dest-pin", html: '<svg viewBox="0 0 30 40" width="30" height="40"><path d="M15 39s13-13.6 13-23.5A13 13 0 0 0 2 15.5C2 25.4 15 39 15 39z" fill="var(--plaque)" stroke="#fff" stroke-width="2.5"/><circle cx="15" cy="15.5" r="5" fill="#fff"/></svg>', iconSize: [30, 40] });
  const startIcon = L.divIcon({ className: "start-pin", html: "<span></span>", iconSize: [20, 20] });

  function routeOrigin() {
    if (S.start) return { ...S.start, kind: "start" };
    if (S.me && inParis(S.me)) return { lat: S.me.lat, lng: S.me.lng, kind: "me" };
    const c = map.getCenter();
    return { lat: c.lat, lng: c.lng, kind: "center" };
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
    } catch (e) {
      return shape([[a.lat, a.lng], [b.lat, b.lng]], true);
    }
  }
  function shape(latlngs, approx) {
    const P = latlngs.map((l) => xy(l[0], l[1])), C = [0];
    for (let i = 1; i < P.length; i++) C.push(C[i - 1] + Math.hypot(P[i][0] - P[i - 1][0], P[i][1] - P[i - 1][1]));
    const len = C[C.length - 1];
    return { latlngs, xy: P, cum: C, dist: approx ? len * 1.25 : len, approx };
  }

  async function buildRoute(isReroute) {
    if (!S.dest) return;
    S.routing = true;
    const o = routeOrigin();
    S.routeOriginKind = o.kind;
    if (!isReroute) { $("#rtMeta").textContent = "Finding a walking route…"; }
    const r = await fetchRoute(o, S.dest);
    S.routing = false; S.lastRouteAt = Date.now();
    if (!S.dest) return;
    S.route = r; S.progress = 0; S.alerted.delete("arrived");
    const cs = getComputedStyle(document.documentElement);
    const col = cs.getPropertyValue("--route").trim() || "#2b59f0";
    if (routeLine) { map.removeLayer(routeLine); map.removeLayer(routeCasing); }
    routeCasing = L.polyline(r.latlngs, { color: "#ffffff", weight: 9, opacity: 0.9, interactive: false }).addTo(map);
    routeLine = L.polyline(r.latlngs, { color: col, weight: 5, opacity: 0.95, dashArray: r.approx ? "2 10" : null, lineCap: "round", interactive: false }).addTo(map);
    if (S.me && inParis(S.me)) S.progress = Math.max(0, project(r, xy(S.me.lat, S.me.lng)).s);
    if (!isReroute) fitRoute(); else toast("Re-routed from where you are.");
    if (r.approx) toast("Walking directions are offline, so this is a straight-line corridor.", 4500);
    render();
  }
  function fitRoute() { if (routeLine) map.fitBounds(routeLine.getBounds(), { paddingTopLeft: [30, 110], paddingBottomRight: [70, sheetH() + 30], maxZoom: 17 }); }

  function setDest(d) {
    S.dest = d; S.selected = null; S.alerted = new Set(); S.listLimit = 30;
    if (destMarker) destMarker.setLatLng([d.lat, d.lng]); else destMarker = L.marker([d.lat, d.lng], { icon: destIcon, zIndexOffset: 2500, interactive: false }).addTo(map);
    $("#rtTo").textContent = "→ " + d.label;
    $("#routebar").hidden = false; $("#searchBar").hidden = true; closeResults();
    setSheet("open");
    keepAwake(true);
    buildRoute(false);
  }
  function setStart(ll) {
    S.start = ll;
    if (startMarker) startMarker.setLatLng([ll.lat, ll.lng]);
    else {
      startMarker = L.marker([ll.lat, ll.lng], { icon: startIcon, draggable: true, zIndexOffset: 2400 }).addTo(map);
      startMarker.on("dragend", () => { const p = startMarker.getLatLng(); S.start = { lat: p.lat, lng: p.lng }; if (S.dest) buildRoute(false); });
    }
    if (S.dest) buildRoute(false); else toast("Start set. Now search or tap where you're walking to.");
  }
  function clearRoute() {
    S.dest = null; S.route = null; S.progress = 0;
    [routeLine, routeCasing, destMarker, startMarker].forEach((l) => l && map.removeLayer(l));
    routeLine = routeCasing = destMarker = startMarker = null; S.start = null;
    $("#routebar").hidden = true; $("#searchBar").hidden = false; $("#q").value = ""; $("#qClear").hidden = true;
    keepAwake(false); setSheet("peek"); render();
  }

  async function keepAwake(on) {
    try {
      if (on && "wakeLock" in navigator && !S.wake) { S.wake = await navigator.wakeLock.request("screen"); S.wake.addEventListener("release", () => (S.wake = null)); }
      if (!on && S.wake) { await S.wake.release(); S.wake = null; }
    } catch (e) {}
  }
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible" && S.dest) keepAwake(true); });

  // ── lists ──
  function onWay() {
    if (!S.route) return [];
    const corridor = (S.detour * WALK) / 2;
    const out = [];
    for (const r of suggestable()) {
      if (S.dest && S.dest.rid === r.id) continue;
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
    const mine = S.tried.has(r.id) ? " · tried ✓" : S.saved.has(r.id) ? " · ★" : "";
    return `<button class="row" data-id="${r.id}" style="--cc:var(--c-${r.c})"><span class="dot"></span><span style="min-width:0"><div class="nm">${esc(r.n)}${flag}</div><div class="ds">${CATS[r.c].short} · ${r.p} · ${arr(r.pc)}${mine}</div></span><span class="rt">${right}</span></button>`;
  }

  function render() {
    const body = $("#sheetBody");
    let ids = new Set();
    if (S.selected) { body.innerHTML = detailHTML(ALL.find((r) => r.id === S.selected)); }
    else if (S.dest) {
      const list = onWay(); ids = new Set(list.map((r) => r.id));
      const left = S.route ? Math.max(0, S.route.dist - S.progress * (S.route.approx ? 1.25 : 1)) : 0;
      $("#rtMeta").textContent = S.route ? `${fmtDist(left)} · ${fmtMin(left)} walk${S.routeOriginKind === "center" ? " · from map centre" : S.routeOriginKind === "start" ? " · from your start pin" : ""}` : "Finding a walking route…";
      const seg = [2, 4, 6, 10].map((m) => `<button data-detour="${m}" aria-pressed="${S.detour === m}">${m} min</button>`).join("");
      let rows = list.map((r) => rowHTML(r, `<b>${r._s - S.progress < 30 ? "here" : "in " + fmtDist(r._s - S.progress)}</b><small>+${Math.max(1, Math.round((2 * r._d) / WALK))} min detour</small>`)).join("");
      if (!list.length) rows = `<div class="empty">${S.route ? `Nothing within a ${S.detour}-minute detour. Try a wider detour.` : "Finding a walking route…"}</div>`;
      body.innerHTML = `<div class="sheet-head"><h2>On your way</h2><span class="count">${list.length} spot${list.length === 1 ? "" : "s"}</span></div><div class="seg"><span>Max detour</span>${seg}</div><div class="list">${rows}</div>`;
      // proximity alerts
      if (S.me) list.forEach((r) => { if (!S.alerted.has(r.id) && hav(S.me, r) < 60) { S.alerted.add(r.id); toast(`Coming up: ${r.n}, ${fmtDist(hav(S.me, r))}`); buzz(); } });
    } else {
      const { list, ref } = nearby();
      const shown = list.slice(0, S.listLimit);
      const rows = shown.map((r) => rowHTML(r, ref ? `<b>${fmtDist(r._m)}</b><small>${fmtMin(r._m)} walk</small>` : "")).join("");
      const more = list.length > shown.length ? `<button class="more" data-more>Show ${Math.min(30, list.length - shown.length)} more</button>` : "";
      const title = ref ? "Near you" : "All restaurants";
      body.innerHTML = `<div class="sheet-head"><h2>${title}</h2><span class="count">${list.length} of ${PINNED.filter((r) => !r.closed).length}</span></div><div class="list">${rows || '<div class="empty">No restaurants match your filters.</div>'}${more}</div>`;
    }
    refreshMarkers(ids);
  }

  function detailHTML(r) {
    if (!r) return "";
    const ref = S.me && inParis(S.me) ? S.me : null;
    const q = encodeURIComponent(`${r.n}, ${r.addr}, ${r.pc} Paris`);
    const apple = `https://maps.apple.com/?daddr=${r.lat},${r.lng}&dirflg=w`;
    const google = `https://www.google.com/maps/search/?api=1&query=${q}`;
    const dl = ref ? `<div class="dist-line">${fmtDist(hav(ref, r))} away · about ${fmtMin(hav(ref, r) * 1.25)} on foot</div>` : "";
    const closed = r.closed ? `<div class="warn"><b>Permanently closed.</b> Kept here so you don't go looking for it.</div>` : "";
    const warn = r.w ? `<div class="warn">⚠ ${esc(r.w)}</div>` : "";
    return `<div class="detail">
      <button class="icon-btn x" data-close aria-label="Close"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg></button>
      <h3>${esc(r.n)}</h3>
      <div class="tags"><span class="plaque">${arr(r.pc)} arr.</span><span class="chip" style="--cc:var(--c-${r.c})"><span class="dot"></span>${CATS[r.c].label}</span><span class="chip">${r.p}</span></div>
      ${dl}${closed}
      <p>${esc(r.d)}</p>${warn}
      <div class="addr"><span>${esc(r.addr)}, ${esc(r.pc)} Paris</span><button class="icon-btn" data-copy="${esc(r.addr + ", " + r.pc + " Paris")}" aria-label="Copy address"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V5a1 1 0 0 1 1-1h9"/></svg></button></div>
      <div class="actions">
        ${r.closed ? "" : `<button class="btn primary" data-walk="${r.id}"><svg viewBox="0 0 24 24" fill="currentColor"><circle cx="13" cy="4" r="2"/><path d="M9.8 8.9 7 23h2.1l1.8-8 2.1 2v6h2v-7.5l-2.1-2 .6-3C14.8 12 16.8 13 19 13v-2c-1.9 0-3.5-1-4.3-2.4l-1-1.6c-.4-.6-1-1-1.7-1-.3 0-.5.1-.8.1L6 8.3V13h2V9.6l1.8-.7"/></svg>Walk here${S.dest ? " instead" : ""}</button>`}
        <button class="btn save" data-save="${r.id}" aria-pressed="${S.saved.has(r.id)}">${S.saved.has(r.id) ? "★ Want to go" : "☆ Want to go"}</button>
        <button class="btn tried" data-tried="${r.id}" aria-pressed="${S.tried.has(r.id)}">${S.tried.has(r.id) ? "✓ Tried it" : "Mark as tried"}</button>
        <a class="btn" href="${google}" target="_blank" rel="noopener">Hours &amp; reviews</a>
        <a class="btn" href="${apple}" target="_blank" rel="noopener">Apple Maps</a>
      </div></div>`;
  }

  function select(id, pan = true) {
    S.selected = id; setSheet("detail"); render();
    const r = ALL.find((x) => x.id === id);
    if (r && r.lat != null) {
      const z = Math.max(map.getZoom(), 16);
      // keep the pin visible above the sheet
      const target = map.project([r.lat, r.lng], z).add([0, sheetH() / 2 - 40]);
      if (pan || !map.getBounds().pad(-0.15).contains([r.lat, r.lng])) map.setView(map.unproject(target, z), z, { animate: true });
    }
  }
  function unselect() { S.selected = null; setSheet(S.dest ? "open" : "peek"); render(); }

  // ── sheet ──
  const sheet = $("#sheet");
  const sheetH = () => sheet.getBoundingClientRect().height;
  function setSheet(st) { S.sheet = st; sheet.dataset.state = st; }
  new ResizeObserver(() => document.documentElement.style.setProperty("--sheet-h", sheetH() + "px")).observe(sheet);
  $("#handle").addEventListener("click", () => { if (S.selected) return unselect(); setSheet(S.sheet === "open" ? "peek" : "open"); });
  let ty = null;
  sheet.addEventListener("touchstart", (e) => { if (e.target.closest(".list,.detail") && e.target.closest(".list,.detail").scrollTop > 0) return; ty = e.touches[0].clientY; }, { passive: true });
  sheet.addEventListener("touchend", (e) => {
    if (ty == null) return; const dy = e.changedTouches[0].clientY - ty; ty = null;
    if (dy < -40 && S.sheet === "peek") setSheet("open");
    else if (dy > 50) { if (S.selected) unselect(); else if (S.sheet === "open") setSheet("peek"); }
  }, { passive: true });

  sheet.addEventListener("click", (e) => {
    const t = e.target.closest("button,a"); if (!t) return;
    if (t.dataset.id) return select(t.dataset.id);
    if (t.dataset.detour) { S.detour = +t.dataset.detour; store.set("detour", S.detour); return render(); }
    if (t.hasAttribute("data-more")) { S.listLimit += 30; return render(); }
    if (t.hasAttribute("data-close")) return unselect();
    if (t.dataset.walk) { const r = ALL.find((x) => x.id === t.dataset.walk); return setDest({ lat: r.lat, lng: r.lng, label: r.n, rid: r.id }); }
    if (t.dataset.save) { toggle(S.saved, t.dataset.save, "saved"); return render(); }
    if (t.dataset.tried) { toggle(S.tried, t.dataset.tried, "tried"); return render(); }
    if (t.dataset.copy) {
      const txt = t.dataset.copy;
      try { navigator.clipboard.writeText(txt).then(() => toast("Address copied"), () => toast(txt, 5000)); } catch (err) { toast(txt, 5000); }
    }
  });
  function toggle(set, id, key) { set.has(id) ? set.delete(id) : set.add(id); store.set(key, [...set]); }

  // ── map taps: walk here / start here ──
  let tapPop = null;
  function tapMenu(latlng) {
    if (S.selected) { unselect(); return; }
    tapPop = L.popup({ closeButton: false, offset: [0, -4], autoPan: false })
      .setLatLng(latlng)
      .setContent(`<div class="tap-pop"><button class="go" data-tap="dest">Walk here</button><button data-tap="start">Start here</button></div>`)
      .openOn(map);
  }
  map.on("click", (e) => { if (!$("#results").hidden) return closeResults(); tapMenu(e.latlng); });
  map.on("contextmenu", (e) => tapMenu(e.latlng));
  map.on("popupopen", (ev) => ev.popup.getElement().addEventListener("click", (e) => {
    const b = e.target.closest("[data-tap]"); if (!b || !tapPop) return;
    const ll = tapPop.getLatLng(); map.closePopup(tapPop); tapPop = null;
    if (b.dataset.tap === "dest") setDest({ lat: ll.lat, lng: ll.lng, label: "Dropped pin" });
    else setStart({ lat: ll.lat, lng: ll.lng });
  }));

  // ── search ──
  const q = $("#q"), results = $("#results");
  let qT, qAbort;
  function closeResults() { results.hidden = true; results.innerHTML = ""; }
  q.addEventListener("input", () => {
    $("#qClear").hidden = !q.value; clearTimeout(qT);
    const v = q.value.trim(); if (v.length < 2) return closeResults();
    showLocal(v); qT = setTimeout(() => remoteSearch(v), 320);
  });
  q.addEventListener("focus", () => { if (q.value.trim().length >= 2) showLocal(q.value.trim()); });
  $("#qClear").addEventListener("click", () => { q.value = ""; $("#qClear").hidden = true; closeResults(); q.focus(); });
  let localHits = [], remoteHits = [];
  function showLocal(v) {
    const n = norm(v);
    localHits = PINNED.filter((r) => !r.closed && (norm(r.n).includes(n) || norm(r.addr).includes(n))).slice(0, 5);
    paintResults(false);
  }
  async function remoteSearch(v) {
    try {
      qAbort && qAbort.abort(); qAbort = new AbortController();
      const c = map.getCenter();
      const url = `https://photon.komoot.io/api/?q=${encodeURIComponent(v)}&lat=${c.lat.toFixed(4)}&lon=${c.lng.toFixed(4)}&limit=6&bbox=2.20,48.79,2.50,48.93`;
      const res = await fetch(url, { signal: qAbort.signal }); const j = await res.json();
      remoteHits = (j.features || []).map((f) => {
        const p = f.properties; const [lng, lat] = f.geometry.coordinates;
        const street = [p.housenumber, p.street].filter(Boolean).join(" ");
        const title = p.name || street || p.city;
        const sub = [p.name && street ? street : "", p.postcode, p.city || p.district].filter(Boolean).join(", ");
        return { lat, lng, title, sub };
      });
      paintResults(true);
    } catch (e) { if (e.name !== "AbortError") { remoteHits = []; paintResults(true, true); } }
  }
  function paintResults(remoteDone, failed) {
    let h = localHits.map((r, i) => `<button data-l="${i}" style="--cc:var(--c-${r.c})"><span class="dot" style="margin-top:5px"></span><span><div class="ttl">${esc(r.n)}</div><div class="sub">${CATS[r.c].short} · ${r.p} · ${esc(r.addr)}</div></span></button>`).join("");
    h += remoteHits.map((p, i) => `<button data-r="${i}"><svg width="12" height="16" viewBox="0 0 12 16" style="margin-top:3px;flex:none"><path d="M6 15s5-5.3 5-9A5 5 0 0 0 1 6c0 3.7 5 9 5 9z" fill="none" stroke="currentColor" stroke-width="1.6"/></svg><span><div class="ttl">${esc(p.title)}</div><div class="sub">${esc(p.sub)}</div></span></button>`).join("");
    if (!h) h = `<div class="hint">${remoteDone ? (failed ? "Address search is offline. Tap the map to drop a destination instead." : "No matches in Paris.") : "Searching…"}</div>`;
    results.innerHTML = h; results.hidden = false;
  }
  results.addEventListener("click", (e) => {
    const b = e.target.closest("button"); if (!b) return;
    q.blur();
    if (b.dataset.l != null) { const r = localHits[+b.dataset.l]; closeResults(); return select(r.id); }
    const p = remoteHits[+b.dataset.r]; setDest({ lat: p.lat, lng: p.lng, label: p.title });
  });
  q.addEventListener("keydown", (e) => { if (e.key === "Enter") { const first = results.querySelector("button"); first && first.click(); } });

  $("#rtClear").addEventListener("click", clearRoute);
  $("#rtFit").addEventListener("click", fitRoute);
  $("#btnLocate").addEventListener("click", () => {
    if (S.watch != null && S.follow && S.me) { S.follow = false; updateLocateBtn(); return; }
    startLocate(true);
  });
  $("#btnAll").addEventListener("click", () => { S.follow = false; updateLocateBtn(); fitAll(); });

  // ── filters ──
  function paintFilters() {
    const counts = {}; PINNED.forEach((r) => !r.closed && (counts[r.c] = (counts[r.c] || 0) + 1));
    $("#fCats").innerHTML = Object.entries(CATS).map(([k, v]) => `<button class="tog" data-cat="${k}" aria-pressed="${S.cats.has(k)}" style="--cc:var(--c-${k})"><span class="dot"></span>${v.label} <small>${counts[k] || 0}</small></button>`).join("");
    $("#fPrices").innerHTML = PRICES.map((p) => `<button class="tog" data-price="${p}" aria-pressed="${S.prices.has(p)}">${p}</button>`).join("");
    $("#fMine").innerHTML = [["all", "Everything"], ["saved", `★ Want to go (${S.saved.size})`], ["untried", "Not tried yet"]].map(([k, l]) => `<button class="tog" data-mine="${k}" aria-pressed="${S.mine === k}">${l}</button>`).join("");
  }
  $("#btnFilter").addEventListener("click", () => { paintFilters(); $("#panel").hidden = false; });
  $("#panel").addEventListener("click", (e) => {
    if (e.target.id === "panel" || e.target.id === "fDone") { $("#panel").hidden = true; return; }
    const t = e.target.closest("button"); if (!t) return;
    if (t.dataset.cat) { const k = t.dataset.cat; if (S.cats.has(k)) { if (S.cats.size > 1) S.cats.delete(k); } else S.cats.add(k); store.set("cats", [...S.cats]); }
    if (t.dataset.price) { const k = t.dataset.price; if (S.prices.has(k)) { if (S.prices.size > 1) S.prices.delete(k); } else S.prices.add(k); store.set("prices", [...S.prices]); }
    if (t.dataset.mine) { S.mine = t.dataset.mine; store.set("mine", S.mine); }
    if (t.id === "fReset") { S.cats = new Set(Object.keys(CATS)); S.prices = new Set(PRICES); S.mine = "all"; store.set("cats", [...S.cats]); store.set("prices", [...S.prices]); store.set("mine", "all"); }
    paintFilters(); render();
  });

  // ── refine pin positions against the French address base (BAN), cached ──
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
    return undefined; // network failed: try again next launch
  }
  async function refine() {
    const cache = store.get("geo", {});
    const apply = (r, ll) => { r.lat = ll[0]; r.lng = ll[1]; markers.get(r.id).setLatLng(ll); };
    PINNED.forEach((r) => { const c = cache[r.id]; if (c && c.a === r.addr && c.ll) apply(r, c.ll); });
    const todo = PINNED.filter((r) => r.addr && !(cache[r.id] && cache[r.id].a === r.addr));
    if (!todo.length) return;
    let i = 0, changed = 0;
    async function worker() {
      while (i < todo.length) {
        const r = todo[i++]; const out = await geocodeOne(r);
        if (out === undefined) continue;
        cache[r.id] = out; if (out.ll) { apply(r, out.ll); changed++; }
      }
    }
    await Promise.all([worker(), worker(), worker(), worker(), worker()]);
    store.set("geo", cache);
    if (changed) render();
  }

  // ── boot ──
  render();
  zoomClasses();
  requestAnimationFrame(() => fitAll());
  startLocate(false);
  setTimeout(refine, 800);
  if ("serviceWorker" in navigator && location.protocol === "https:") navigator.serviceWorker.register("sw.js").catch(() => {});
  window.__pt = { S, map, setDest, onPos, onWay, render, select }; // for testing
})();
