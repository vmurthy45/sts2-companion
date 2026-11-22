// Bump CACHE whenever any app-shell file changes, or installed copies keep the old version.
// Game data (data/*.json) is fetched network-first, so patches arrive without a bump.
const CACHE = 'spire-v8';
const IMG = 'spire-img-v1';
const ASSETS = ['./', 'index.html', 'app.js', 'styles.css', 'manifest.webmanifest', 'icon-192.png', 'icon-512.png', 'apple-touch-icon.png', 'apple-touch-icon-precomposed.png', 'favicon.ico', 'favicon-32.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)));
  self.skipWaiting();
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE && k !== IMG).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  // Enemy/card/relic art from the Spire Codex CDN: cache first, keep forever.
  if (url.hostname === 'cdn.spire-codex.com' || url.hostname === 'fonts.gstatic.com' || url.hostname === 'fonts.googleapis.com' || url.hostname === 'clan.akamai.steamstatic.com') {
    e.respondWith(caches.open(IMG).then(async c => {
      const hit = await c.match(req);
      if (hit) return hit;
      const r = await fetch(req);
      if (r.ok || r.type === 'opaque') c.put(req, r.clone());
      return r;
    }));
    return;
  }
  if (url.origin !== location.origin) return;
  // Game data: network first so a new patch shows up straight away; cache for offline.
  if (url.pathname.includes('/data/')) {
    e.respondWith(caches.open(CACHE).then(async c => {
      try { const r = await fetch(req); if (r.ok) c.put(req, r.clone()); return r; }
      catch { return (await c.match(req)) || (await c.match(req, { ignoreSearch: true })); }
    }));
    return;
  }
  // App shell: cache first, refresh in the background.
  e.respondWith(caches.open(CACHE).then(async c => {
    const hit = await c.match(req, { ignoreSearch: true });
    const net = fetch(req).then(r => { if (r.ok) c.put(req, r.clone()); return r; }).catch(() => hit);
    return hit || net;
  }));
});
