const CACHE = 'wc-shell-v8';
const IMAGE_CACHE = 'wc-images-v3';
const ASSETS = ['/', '/manifest.webmanifest'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(
    keys.filter((k) => k !== CACHE && k !== IMAGE_CACHE).map((k) => caches.delete(k))
  )).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // Authenticated thumbnails/renders: cache locally after first load.
  if (url.pathname.startsWith('/api/files/render/')) {
    e.respondWith((async () => {
      const cache = await caches.open(IMAGE_CACHE);
      const hit = await cache.match(req);
      if (hit) return hit;
      const res = await fetch(req);
      if (res.ok) await cache.put(req, res.clone());
      return res;
    })());
    return;
  }

  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/s/')) return;
  e.respondWith(fetch(req).catch(() => caches.match(req).then((r) => r || caches.match('/'))));
});
