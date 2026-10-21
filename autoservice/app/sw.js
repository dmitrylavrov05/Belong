// Кеш для роботи без мережі: застосунок відкривається, навіть якщо зник інтернет
// (зокрема під час відключень світла).
const CACHE = 'carcar-v89';
const FILES = [
  './', 'index.html', 'styles.css', 'app.js', 'core.js', 'data.js', 'icon.svg', 'manifest.webmanifest',
  'business.html', 'admin.css', 'charts.js', 'partners.js', 'ops.js', 'map.js', 'vehicles.js', 'admin.html', 'admin.js',
  'pro.html', 'pro.js', 'pro.css', 'pro.webmanifest', 'pro-icon.svg', 'start.mp3', 'call.js', 'karych.js',
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
  const url = new URL(e.request.url);
  // Відповіді сервера (/api/…) — лише з мережі й не в кеш: це особисті дані, вони не мають лишатися на пристрої.
  if (e.request.method !== 'GET' || url.origin !== location.origin || url.pathname.includes('/api/')) return;
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

// Застосунок мийки (pro.html) і клієнта (index.html) живуть на одному сайті — вікно шукаємо за адресою.
const isPro = (url) => /\/pro\.html/.test(new URL(url, self.registration.scope).pathname);
const isAdmin = (url) => /\/admin\.html/.test(new URL(url, self.registration.scope).pathname);
const sameApp = (client, url) => !isAdmin(client.url) && isPro(client.url) === isPro(url);

// Push із сервера CARCAR: приходить, навіть коли застосунок закрито.
// Якщо потрібний застосунок відкритий на екрані — він уже показав шторку чи банер, другий раз не дзвонимо.
self.addEventListener('push', (e) => {
  let msg = {};
  try { msg = e.data?.json() ?? {}; } catch { msg = { title: 'CARCAR', body: e.data?.text() ?? '' }; }
  const url = msg.url || 'index.html';
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
    if (list.some((c) => sameApp(c, url) && c.visibilityState === 'visible')) return undefined;
    return self.registration.showNotification(msg.title || 'CARCAR', {
      body: msg.body || '', tag: msg.tag, icon: isPro(url) ? 'pro-icon.svg' : 'icon.svg', data: { url }, renotify: !!msg.tag,
    });
  }));
});

// Кнопки сповіщення про новий запис у CarCar Business: «Прийняти» / «Відмовити» або дотик до сповіщення.
// Відкритому застосунку передаємо дію повідомленням, інакше відкриваємо його з дією в адресі.
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  // Сповіщення клієнту (мийка відповіла на запис): відкриваємо застосунок на цьому записі.
  const url = e.notification.data?.url;
  if (url) {
    e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      const win = list.find((c) => sameApp(c, url));
      if (win) return win.navigate(url).then((w) => (w ?? win).focus()).catch(() => win.focus());
      return self.clients.openWindow(url);
    }));
    return;
  }
  const id = e.notification.data?.id;
  if (!id) return;
  const action = e.action || 'open';
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
    const win = list.find((c) => new URL(c.url).pathname.endsWith('/pro.html'));
    if (win) { win.postMessage({ type: 'pending-action', action, id }); return win.focus(); }
    return self.clients.openWindow(`pro.html#/act/${action}/${id}`);
  }));
});
