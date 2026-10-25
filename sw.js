// 网络优先：每次先取服务器，拿到就顺手更新缓存；断网才回落到缓存。
// 之前的缓存优先会让旧 CSS/JS 一直留在手机上——改一次代码，手机上永远看不到。
const CACHE = 'norn-v31';
const ASSETS = ['./', './index.html', './style.css', './app.js', './format.js', './views.js', './llm.js', './store.js', './sync.js',
  './engine/clock.js', './engine/rng.js', './engine/money.js', './engine/economy.js', './engine/ledger.js',
  './engine/progress.js', './engine/items.js', './engine/assets.js', './engine/reputation.js',
  './engine/chronicle.js', './engine/migrate.js', './engine/state.js', './engine/tick.js', './engine/resolve.js', './engine/worldgen.js',
  './prompt/rules.md', './prompt/worldbook.md', './manifest.webmanifest',
  './icons/icon-192.png', './icons/icon-512.png', './icons/icon-maskable-512.png', './icons/apple-touch-icon.png', './icons/favicon-32.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS).catch(() => {})).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (url.origin !== location.origin) return; // 模型 API 不经过缓存
  if (e.request.method !== 'GET') return;
  e.respondWith(
    fetch(e.request)
      .then((res) => {
        if (res && res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(e.request, copy)).catch(() => {});
        }
        return res;
      })
      .catch(() => caches.match(e.request).then((hit) => hit || caches.match('./index.html')))
  );
});
