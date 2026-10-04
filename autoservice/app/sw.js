// Кеш для роботи без мережі: застосунок відкривається, навіть якщо зник інтернет
// (зокрема під час відключень світла).
const CACHE = 'carcar-v9';
const FILES = [
  './', 'index.html', 'styles.css', 'app.js', 'core.js', 'data.js', 'icon.svg', 'manifest.webmanifest',
  'business.html', 'business.css', 'business.js',
  'fonts/onest-cyrillic.woff2', 'fonts/onest-cyrillic-ext.woff2', 'fonts/onest-latin.woff2',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(FILES)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

// Спочатку мережа (щоб свіжі ціни приходили одразу), у разі помилки — кеш.
self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET' || new URL(e.request.url).origin !== location.origin) return;
  e.respondWith(
    fetch(e.request)
      .then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(e.request, copy));
        return res;
      })
      .catch(() => caches.match(e.request)),
  );
});
