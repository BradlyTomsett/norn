import { BUILD, ASSETS } from './build.js';
const CACHE = `norn-${BUILD}`;
self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(ASSETS)).then(() => {
    if (!self.registration.active) return self.skipWaiting();
  }));
});
self.addEventListener('message', event => {
  if (event.data?.type === 'ACTIVATE_UPDATE') self.skipWaiting();
});
self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k.startsWith('norn-') && k !== CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin || event.request.method !== 'GET') return;
  event.respondWith(caches.open(CACHE).then(async cache => {
    const request = event.request.mode === 'navigate' ? new Request(new URL('./index.html', self.registration.scope)) : event.request;
    const cached = await cache.match(request);
    return cached || fetch(event.request);
  }));
});
