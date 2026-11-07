// Offline support and updates. Built into dist/sw.js by vite.config.ts,
// which fills in the version and the list of files.
//
// Each version of the game is downloaded in full and kept on the phone, so it
// opens with no signal. When a new version is published it downloads in the
// background and waits; the game shows "A new version is ready", and tapping
// Update switches over.

const VERSION = '__VERSION__';
const CACHE = `vault-${VERSION}`;
const ASSETS = [/* __ASSETS__ */];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => Promise.all(ASSETS.map(async (url) => {
    const res = await fetch(`${url}${url.includes('?') ? '&' : '?'}v=${VERSION}`, { cache: 'reload' });
    if (!res.ok) throw new Error(`${url}: ${res.status}`);
    await cache.put(url, res);
  }))));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('vault-') && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()));
});

self.addEventListener('message', (event) => {
  if (event.data === 'skipWaiting') self.skipWaiting();
});

// Only this site's own files come from the cache; the game's server calls
// (another site) always go to the network.
self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;
  event.respondWith(
    caches.open(CACHE)
      .then((cache) => cache.match(req, { ignoreSearch: true }))
      .then((cached) => cached || fetch(req)));
});
