const OFFLINE_CACHE = 'yingxing-offline-v1';

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(OFFLINE_CACHE).then((cache) => cache.add('/offline.html')));
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(Promise.all([
    caches.keys().then((keys) => Promise.all(keys.filter((key) => key.startsWith('yingxing-offline-') && key !== OFFLINE_CACHE).map((key) => caches.delete(key)))),
    self.clients.claim(),
  ]));
});

self.addEventListener('fetch', (event) => {
  if (event.request.mode !== 'navigate' || new URL(event.request.url).origin !== self.location.origin) return;
  event.respondWith((async () => {
    try {
      const health = await fetch('/api/health', { cache: 'no-store' });
      if (!health.ok) throw new Error('Service unavailable');
      return await fetch(event.request, { cache: 'no-store' });
    } catch {
      return (await caches.match('/offline.html')) || Response.error();
    }
  })());
});
