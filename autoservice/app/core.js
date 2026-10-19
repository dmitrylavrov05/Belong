// Спільна логіка застосунку клієнта (app.js), CarCar Business (pro.js) і адмінки (admin.js):
// сховище, форматування, іконки, гроші, рейтинг і налаштування точок із CRM.
import { CATEGORIES, PLACES, PAYMENT, RELIABILITY, SERVICE_TEMPLATES, CITIES, DECLINE_RULES } from './data.js';
// Вигадані мийки з data.js — запамʼятовуємо до того, як додадуться справжні (зареєстровані через CARCAR).
const DEMO_PLACE_IDS = new Set(PLACES.map((p) => p.id));

// peek — для частого читання без змін: розбираємо JSON лише тоді, коли значення змінилося.
// Повернений обʼєкт спільний — не змінюйте його, для змін є get/set.
const peeked = new Map();
export const store = {
  peek(key, fallback) {
    let raw = null;
    try { raw = localStorage.getItem(`carcar.${key}`); } catch { /* приватний режим */ }
    if (raw === null) return fallback;
    const hit = peeked.get(key);
    if (hit?.raw === raw) return hit.value;
    try {
      const value = JSON.parse(raw);
      peeked.set(key, { raw, value });
      return value;
    } catch {
      return fallback;
    }
  },
  get(key, fallback) {
    try {
      const raw = localStorage.getItem(`carcar.${key}`);
      return raw ? JSON.parse(raw) : fallback;
    } catch {
      return fallback;
    }
  },
  set(key, value) {
    try {
      localStorage.setItem(`carcar.${key}`, JSON.stringify(value));
      if (sync.on && shared(key)) syncPush(key);
      return true;
    } catch {
      // Приватний режим або переповнення: працюємо без збереження.
      return false;
    }
  },
};

// ---------- спільні дані між пристроями ----------
// Якщо поруч із застосунком працює сервер CARCAR (deploy/server), усі пристрої бачать ті самі записи,
// мийки, відгуки й повідомлення: зміни відправляються на сервер, а чужі приходять за секунду-дві й
// перемальовують екран (так само, як зміни з іншої вкладки). Сервер віддає кожному лише дозволене:
// клієнту — свої записи, мийці — записи своїх мийок, адмінці — усе (див. deploy/server/acl.py).
// Без сервера (файл з диска, тести) — лише цей пристрій. Особисте лишається на пристрої.
const LOCAL_KEYS = new Set(['auth', 'profile', 'cars', 'carId', 'theme', 'biz.theme', 'notify', 'biz.notify', 'biz.session', 'partner',
  'seenStates', 'cls', 'city', 'favs', 'view', 'mapLayer', 'campaign', 'referral', 'subscriptions', 'auth.token', 'biz.token', 'admin.token', 'pushSub', 'srv.demoPlaces', 'karych']);
const shared = (key) => !LOCAL_KEYS.has(key);
// Журнал подій великий і пишеться часто — відправляємо рідше.
// Абонементи — трохи пізніше за записи: повернення візиту сервер перевіряє за вже скасованим записом.
const PUSH_DELAY = { analytics: 5000, presence: 2000, 'biz.passes': 1500 };
const sync = { on: false, ver: 0, base: new Map(), timers: new Map(), busy: new Set(), poll: null, gen: 0 };
const syncNotify = (key) => window.dispatchEvent(new StorageEvent('storage', { key: `carcar.${key}` }));
export const syncOn = () => sync.on;
// Сервер CARCAR додає в сторінку <meta name="carcar-sync"> — без неї (Netlify, тести, файл з диска) нічого не питаємо.
export const hasServer = () => typeof document !== 'undefined' && !!document.querySelector('meta[name="carcar-sync"]');
// Вхід у кожному застосунку свій: клієнт, кабінет мийки, адмінка.
const TOKEN_KEY = typeof location === 'undefined' ? 'auth.token' : /pro\.html$/.test(location.pathname) ? 'biz.token' : /admin\.html$/.test(location.pathname) ? 'admin.token' : 'auth.token';
export const authToken = () => store.get(TOKEN_KEY, null);
export function setAuthToken(token) {
  store.set(TOKEN_KEY, token);
  syncRestart();
}

// Запит до сервера CARCAR з ключем входу. Повертає { ok, status, data }.
export async function api(path, { method = 'GET', body } = {}) {
  const token = authToken();
  try {
    const res = await fetch(`api/${path}`, {
      method, cache: 'no-store',
      headers: { ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    const data = await res.json().catch(() => ({}));
    return { ok: res.ok, status: res.status, data };
  } catch {
    return { ok: false, status: 0, data: { error: 'Немає звʼязку з сервером' } };
  }
}

let configPromise = null;
// Що ввімкнено на сервері: вхід через Telegram, демо-вхід, оплата, push. Без сервера — null.
export const serverConfig = () => (hasServer() ? (configPromise ??= api('config').then((r) => {
  if (!r.ok) return null;
  // Вигадані мийки показуємо, лише якщо сервер не вимкнув їх ("demo_places": false). Памʼятаємо, щоб наступне
  // відкриття одразу було без них.
  const demo = r.data.demoPlaces !== false;
  if (store.get('srv.demoPlaces', true) !== demo) { store.set('srv.demoPlaces', demo); syncNotify('srv.demoPlaces'); }
  return r.data;
})) : Promise.resolve(null));

// ---------- сповіщення з сервера: Web Push і Telegram ----------
// Сервер надсилає push, навіть коли застосунок закрито. Налаштування (увімкнено, тиша поза робочим часом мийки)
// зберігаються на сервері — інакше він не знатиме, коли мовчати. quiet: { placeId: { 'YYYY-MM-DD': [від, до] | null } }.
const b64uBytes = (s) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (s.length % 4)) % 4)), (c) => c.charCodeAt(0));
export async function notifySync(prefs) {
  if (!hasServer() || !authToken()) return;
  api('notify/prefs', { method: 'POST', body: prefs });
  if (!prefs.on || !('PushManager' in window) || !('Notification' in window) || Notification.permission !== 'granted') return;
  const cfg = await serverConfig();
  if (!cfg?.vapid) return;
  try {
    const reg = await navigator.serviceWorker?.getRegistration();
    if (!reg) return;
    const sub = (await reg.pushManager.getSubscription()) ?? await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64uBytes(cfg.vapid) });
    await api('push/subscribe', { method: 'POST', body: { subscription: sub.toJSON() } });
  } catch { /* браузер не підтримує push чи немає дозволу — лишаються сповіщення у відкритому застосунку */ }
}
// Перед виходом: цей телефон більше не отримує сповіщень для цього акаунта.
export async function pushForget() {
  try {
    const sub = await (await navigator.serviceWorker?.getRegistration())?.pushManager.getSubscription();
    if (sub) await api('push/unsubscribe', { method: 'POST', body: { endpoint: sub.endpoint } });
  } catch { /* немає підписки */ }
}
// Сповіщення в Telegram: бот запамʼятовує чат і пише туди про записи й повідомлення.
export function telegramNotify() {
  const win = window.open('', '_blank');
  return api('notify/telegram', { method: 'POST', body: {} }).then((r) => {
    if (!r.ok) { win?.close(); return false; }
    if (win) win.location.href = r.data.url; else location.href = r.data.url;
    return true;
  });
}

function syncPush(key) {
  clearTimeout(sync.timers.get(key));
  sync.timers.set(key, setTimeout(() => { sync.timers.delete(key); syncSend(key); }, PUSH_DELAY[key] ?? 150));
}

async function syncSend(key) {
  if (sync.busy.has(key)) { syncPush(key); return; }
  sync.busy.add(key);
  const gen = sync.gen;
  const raw = localStorage.getItem(`carcar.${key}`);
  const base = sync.base.get(key);
  const body = { value: raw === null ? null : JSON.parse(raw), ...(base !== undefined ? { base: JSON.parse(base) } : {}) };
  try {
    const r = await api(`state/${encodeURIComponent(key)}`, { method: 'PUT', body });
    if (gen !== sync.gen) return; // тим часом вийшли чи увійшли — це вже інший користувач
    if (!r.ok && r.status !== 403) throw new Error(String(r.status));
    // 403 — змінювати це не можна: показуємо те, що є на сервері.
    const merged = JSON.stringify(r.data.value ?? null);
    sync.base.set(key, merged);
    // Поки відправляли, хтось інший змінив той самий ключ — показуємо злите значення (якщо ми не змінили його знову).
    if (!sync.timers.has(key) && merged !== localStorage.getItem(`carcar.${key}`)) {
      if (r.data.value === null || r.data.value === undefined) localStorage.removeItem(`carcar.${key}`);
      else localStorage.setItem(`carcar.${key}`, merged);
      syncNotify(key);
    }
  } catch {
    setTimeout(() => syncPush(key), 3000); // немає мережі — повторимо
  } finally {
    sync.busy.delete(key);
  }
}

function syncApply(data) {
  for (const [key, value] of Object.entries(data)) {
    if (!shared(key)) continue;
    // Наша зміна ще не пішла — вона зіллється з цією на сервері (base лишається тим, від чого ми рахували зміни).
    if (sync.timers.has(key) || sync.busy.has(key)) continue;
    const raw = JSON.stringify(value);
    sync.base.set(key, raw);
    if (localStorage.getItem(`carcar.${key}`) === raw) continue;
    try { localStorage.setItem(`carcar.${key}`, raw); } catch { continue; }
    syncNotify(key);
  }
}

async function syncPoll(gen) {
  while (gen === sync.gen) {
    const ctrl = new AbortController();
    sync.poll = ctrl;
    try {
      const token = authToken();
      const res = await fetch(`api/state?since=${sync.ver}&wait=1`, { cache: 'no-store', signal: ctrl.signal, headers: token ? { Authorization: `Bearer ${token}` } : {} });
      if (!res.ok) throw new Error(String(res.status));
      const j = await res.json();
      if (gen !== sync.gen) return;
      syncApply(j.data);
      sync.ver = j.ver;
    } catch {
      if (gen !== sync.gen) return;
      await new Promise((ok) => setTimeout(ok, 3000));
    }
  }
}

// Повне завантаження з сервера: при відкритті, після входу й виходу (бачимо вже інше).
async function syncStart() {
  const gen = ++sync.gen;
  sync.poll?.abort();
  const r = await api('state?since=0');
  if (!r.ok || gen !== sync.gen) return;
  // Сервер — джерело правди: спільних ключів, яких цьому користувачу не видно, на пристрої теж не лишаємо.
  for (let i = localStorage.length - 1; i >= 0; i--) {
    const k = localStorage.key(i);
    if (!k?.startsWith('carcar.')) continue;
    const key = k.slice(7);
    if (shared(key) && !(key in r.data.data) && !sync.timers.has(key)) { localStorage.removeItem(k); sync.base.delete(key); syncNotify(key); }
  }
  syncApply(r.data.data);
  sync.ver = r.data.ver;
  sync.on = true;
  syncPoll(gen);
}
export function syncRestart() {
  if (!hasServer()) return;
  sync.base.clear();
  syncStart();
}
if (hasServer()) { syncStart(); serverConfig(); }

// ---------- іконки (лінійні, з дизайну CARCAR) ----------

export const ICONS = {
  pin: '<path d="M12 21s-7-6.2-7-11.5a7 7 0 0 1 14 0C19 14.8 12 21 12 21z"/><circle cx="12" cy="9.5" r="2.5"/>',
  snow: '<path d="M12 3v18M4.2 7.5l15.6 9M4.2 16.5l15.6-9M9.5 4.5 12 7l2.5-2.5M9.5 19.5 12 17l2.5 2.5"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2.5v2M12 19.5v2M4.6 4.6 6 6M18 18l1.4 1.4M2.5 12h2M19.5 12h2M4.6 19.4 6 18M18 6l1.4-1.4"/>',
  chevR: '<path d="m9 5 7 7-7 7"/>',
  chevL: '<path d="m15 5-7 7 7 7"/>',
  chevD: '<path d="m5 9 7 7 7-7"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 20c1.5-4 4.5-6 8-6s6.5 2 8 6"/>',
  search: '<circle cx="11" cy="11" r="6.5"/><path d="M20 20l-4.2-4.2"/>',
  drop: '<path d="M12 3.5s6 6.4 6 10.5a6 6 0 0 1-12 0c0-4.1 6-10.5 6-10.5z"/>',
  wheel: '<circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="3.5"/>',
  wrench: '<path d="M15 4a5 5 0 0 0-4.6 6.9L4 17.3 6.7 20l6.4-6.4A5 5 0 0 0 20 9l-3 1-2.5-2.5L15.5 4.5z"/>',
  sparkle: '<path d="M12 3.5 13.8 10 20.5 12 13.8 14 12 20.5 10.2 14 3.5 12 10.2 10z"/>',
  heart: '<path d="M12 20s-7.5-4.6-7.5-10.2A4.3 4.3 0 0 1 12 7.2a4.3 4.3 0 0 1 7.5 2.6C19.5 15.4 12 20 12 20z"/>',
  heartFill: '<path fill="currentColor" d="M12 20s-7.5-4.6-7.5-10.2A4.3 4.3 0 0 1 12 7.2a4.3 4.3 0 0 1 7.5 2.6C19.5 15.4 12 20 12 20z"/>',
  star: '<path fill="currentColor" stroke="none" d="M12 3.5l2.6 5.4 5.9.8-4.3 4.1 1 5.8L12 16.9 6.8 19.6l1-5.8L3.5 9.7l5.9-.8z"/>',
  calendar: '<rect x="3.5" y="5" width="17" height="15" rx="3"/><path d="M3.5 10h17M8 3v4M16 3v4"/>',
  car: '<path d="M5 16.5V12l1.8-4.6A2 2 0 0 1 8.7 6h6.6a2 2 0 0 1 1.9 1.4L19 12v4.5"/><rect x="3.5" y="12" width="17" height="5" rx="1.5"/><path d="M6 17v2M18 17v2"/>',
  carSide: '<path d="M5 16.5V12l1.8-4.6A2 2 0 0 1 8.7 6h6.6a2 2 0 0 1 1.9 1.4L19 12v4.5"/><rect x="3.5" y="12" width="17" height="5" rx="1.5"/>',
  bolt: '<path d="M13 3 5 13.5h6L10 21l8-10.5h-6z"/>',
  mic: '<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21"/>',
  phone: '<path d="M5 4h3.5l1.5 4-2 1.3a11 11 0 0 0 6.7 6.7L16 14l4 1.5V19a1.5 1.5 0 0 1-1.6 1.5A16 16 0 0 1 3.5 5.6 1.5 1.5 0 0 1 5 4z"/>',
  route: '<circle cx="6" cy="18" r="2.5"/><circle cx="18" cy="6" r="2.5"/><path d="M8.5 18H15a3 3 0 0 0 0-6H9a3 3 0 0 1 0-6h6.5"/>',
  check: '<path d="m5 12.5 4.5 4.5L19 7.5"/>',
  shield: '<path d="M12 3.5 5 6v5.5c0 4.3 3 7.8 7 9 4-1.2 7-4.7 7-9V6z"/><path d="m9 12 2 2 4-4"/>',
  cash: '<rect x="3" y="6.5" width="18" height="11" rx="2"/><circle cx="12" cy="12" r="2.5"/>',
  undo: '<path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/>',
  card: '<rect x="3" y="5.5" width="18" height="13" rx="2.5"/><path d="M3 10h18M7 15h3"/>',
  checkCircle: '<circle cx="12" cy="12" r="8.5"/><path d="m8.5 12.2 2.4 2.4 4.6-4.8"/>',
  image: '<rect x="3.5" y="4.5" width="17" height="15" rx="2.5"/><circle cx="9" cy="10" r="1.6"/><path d="m20.5 16-5-5-9 8.5"/>',
  chat: '<path d="M20 12a7.5 7.5 0 0 1-11 6.6L4 20l1.4-4.6A7.5 7.5 0 1 1 20 12z"/>',
  gauge: '<path d="M4.5 17a8.5 8.5 0 1 1 15 0"/><path d="m12 13 3.5-4"/>',
  warn: '<path d="M12 4 2.8 19.5h18.4z"/><path d="M12 10v4M12 17v.01"/>',
  info: '<circle cx="12" cy="12" r="8.5"/><path d="M12 11v5M12 8v.01"/>',
  camera: '<path d="M4 8.5A1.5 1.5 0 0 1 5.5 7h2l1.5-2h6l1.5 2h2A1.5 1.5 0 0 1 20 8.5v9a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 17.5z"/><circle cx="12" cy="13" r="3.5"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  repeat: '<path d="M4 12a8 8 0 0 1 13.7-5.6L20 8.5"/><path d="M20 4v4.5h-4.5"/><path d="M20 12a8 8 0 0 1-13.7 5.6L4 15.5"/><path d="M4 20v-4.5h4.5"/>',
  gift: '<rect x="3.5" y="8.5" width="17" height="4" rx="1"/><path d="M5 12.5V20h14v-7.5M12 8.5V20"/><path d="M12 8.5C10.5 5 7 5 7 7s3 1.5 5 1.5zM12 8.5c1.5-3.5 5-3.5 5-1.5s-3 1.5-5 1.5z"/>',
  share: '<circle cx="18" cy="5.5" r="2.5"/><circle cx="6" cy="12" r="2.5"/><circle cx="18" cy="18.5" r="2.5"/><path d="m8.2 10.8 7.6-4.1M8.2 13.2l7.6 4.1"/>',
  copy: '<rect x="8.5" y="8.5" width="11" height="11" rx="2"/><path d="M15.5 8.5V6a1.5 1.5 0 0 0-1.5-1.5H6A1.5 1.5 0 0 0 4.5 6v8A1.5 1.5 0 0 0 6 15.5h2.5"/>',
  chart: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
  users: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0"/><path d="M16 4.5a3.5 3.5 0 0 1 0 7M18 14a6.5 6.5 0 0 1 3.5 6"/>',
  send: '<path d="M4 12 20 4l-6 16-3-7z"/><path d="m11 13 9-9"/>',
  clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
  map: '<path d="M9 4.5 3.5 6.5v13l5.5-2 6 2 5.5-2v-13l-5.5 2z"/><path d="M9 4.5v13M15 6.5v13"/>',
  list: '<path d="M9 6h11M9 12h11M9 18h11"/><circle cx="4.5" cy="6" r="1"/><circle cx="4.5" cy="12" r="1"/><circle cx="4.5" cy="18" r="1"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M12 2.5v3M12 18.5v3M4.6 4.6l2.1 2.1M17.3 17.3l2.1 2.1M2.5 12h3M18.5 12h3M4.6 19.4l2.1-2.1M17.3 6.7l2.1-2.1"/>',
  bell: '<path d="M6 16.5V11a6 6 0 0 1 12 0v5.5l1.5 2h-15z"/><path d="M10 20.5a2 2 0 0 0 4 0"/>',
  upload: '<path d="M12 20V9M7 14l5-5 5 5M5 4h14"/>',
  download: '<path d="M12 4v11M7 10l5 5 5-5M5 20h14"/>',
  x: '<path d="M6 6l12 12M18 6 6 18"/>',
  scale: '<path d="M12 4v16M8 20h8M5 7h14"/><path d="M5 7 2.5 13a3 3 0 0 0 5 0zM19 7l-2.5 6a3 3 0 0 0 5 0z"/>',
};

export const icon = (name, size = 18) =>
  `<svg class="ic" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${ICONS[name]}</svg>`;

// ---------- форматування ----------

export const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
export const uah = (n) => `${n.toLocaleString('uk-UA')} ₴`;
export const pad = (n) => String(n).padStart(2, '0');
export const hhmm = (min) => `${pad(Math.floor(min / 60))}:${pad(min % 60)}`;
export const toMin = (t) => { const [h, m] = t.split(':').map(Number); return h * 60 + m; };
export const isoDate = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const parseDate = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
export const uid = () => Math.random().toString(36).slice(2, 10);
export const placeById = (id) => PLACES.find((p) => p.id === id);
export const plural = (n, one, few, many) => {
  const m10 = n % 10, m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
  return many;
};
export const duration = (min) => (min < 60 ? `${min} хв` : `${Math.floor(min / 60)} год${min % 60 ? ` ${min % 60} хв` : ''}`);
export const dayLabel = (s, opts = { weekday: 'short', day: 'numeric', month: 'long' }) =>
  parseDate(s).toLocaleDateString('uk-UA', opts);
export const rating = (r) => r.toLocaleString('uk-UA', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
export const tel = (p) => `tel:${p.phone.replace(/[^+\d]/g, '')}`;
export function hash(str) {
  let h = 2166136261;
  for (const ch of str) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return h >>> 0;
}

// ---------- графік роботи ----------

export const WEEKDAYS = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Нд'];
export const WEEKDAY_NAMES = ['Понеділок', 'Вівторок', 'Середа', 'Четвер', 'Пʼятниця', 'Субота', 'Неділя'];
export const weekdayOf = (iso) => (parseDate(iso).getDay() + 6) % 7; // 0 — понеділок

// Графік точки (усе в хвилинах від півночі): години на кожен день тижня або null — вихідний,
// перерва, особливі дати (свята, санітарні дні) і правила запису: на скільки днів уперед
// можна записатися (horizon) і за скільки хвилин до початку (lead).
export function scheduleOf(place) {
  const s = place.schedule ?? {};
  const base = place.hours ? [place.hours[0] * 60, place.hours[1] * 60] : [0, 24 * 60];
  return {
    week: s.week ?? Array(7).fill(base),
    brk: s.brk ?? null,
    special: s.special ?? {},
    horizon: s.horizon ?? 14,
    lead: s.lead ?? 30,
  };
}

// Години роботи на конкретну дату або null, якщо точка не працює.
export function hoursFor(place, iso) {
  const s = scheduleOf(place);
  return iso in s.special ? s.special[iso] : s.week[weekdayOf(iso)];
}

// Найширший робочий проміжок тижня — для осі годин у журналі й аналітиці.
export function widestRange(place) {
  const days = scheduleOf(place).week.filter(Boolean);
  return days.length ? [Math.min(...days.map((d) => d[0])), Math.max(...days.map((d) => d[1]))] : [8 * 60, 20 * 60];
}

// Чи перетинає проміжок [t, t + minutes) перерву точки.
export function inBreak(place, t, minutes) {
  const b = scheduleOf(place).brk;
  return !!b && t < b[1] && t + minutes > b[0];
}

// ---------- світло: статус від самої точки ----------

// Точка в панелі відмічає, чи є світло, чи працює від генератора, чи стоїть без світла.
// Позначка свіжа 12 годин — далі клієнти бачать лише, чи є в точки генератор.
export const POWER = {
  grid: ['Світло є', 'ok'],
  generator: ['Немає світла — працюємо від генератора', 'ok'],
  closed: ['Немає світла — не працюємо', 'muted'],
};
export const POWER_FRESH_HOURS = 12;
export function powerOf(placeId, now = Date.now()) {
  const pw = store.peek('biz.power', {})[placeId];
  return pw && now - pw.at < POWER_FRESH_HOURS * 3600000 ? pw : null;
}
export function setPower(placeId, state) {
  const all = store.get('biz.power', {});
  all[placeId] = { state, at: Date.now() };
  store.set('biz.power', all);
}
export const hasGenerator = (p) => p.tags.some((t) => /генератор/i.test(t));
// Чи працює точка під час відключень: свіжа позначка точки важливіша за опис.
export function worksInBlackout(p) {
  const pw = powerOf(p.id);
  if (pw) return pw.state !== 'closed';
  return hasGenerator(p);
}

export function isOpenNow(place, now = new Date()) {
  const h = hoursFor(place, isoDate(now));
  if (!h) return false;
  if (powerOf(place.id, now.getTime())?.state === 'closed') return false;
  const m = now.getHours() * 60 + now.getMinutes();
  return m >= h[0] && m < h[1] && !inBreak(place, m, 1);
}

export const rangeText = (h) => (!h ? 'Вихідний' : h[0] === 0 && h[1] === 24 * 60 ? 'Цілодобово' : `${hhmm(h[0])}–${hhmm(h[1])}`);
export const hoursText = (place, iso = isoDate(new Date())) => rangeText(hoursFor(place, iso));

// ---------- клієнти й телефони ----------

// Ключ клієнта за номером телефону: 0671234567, +38 067 123 45 67 і 380671234567 — один і той самий.
// Клієнт CARCAR — його номер телефону (tel:380…). 'device' — без номера (демо й тести на одному пристрої).
export const clientIdOf = (phone) => phoneKey(phone) ?? 'device';
// Гаманець (баланс CARCAR і бонуси) — свій у кожного клієнта.
export const walletKey = (id = 'device') => (id === 'device' ? 'wallet' : `wallet.${id}`);

// Відбиток номера (FNV-1a, як phone_hash на сервері): сервер віддає мийці його замість номера клієнта CARCAR,
// а мийка може впізнати постійного клієнта, коли вводить номер сама.
export function phoneHash(phone) {
  const key = phoneKey(phone);
  if (!key) return '';
  let h = 0x811c9dc5;
  for (const b of new TextEncoder().encode(`carcar:${key}`)) h = Math.imul(h ^ b, 0x01000193) >>> 0;
  return `h:${h.toString(16).padStart(8, '0')}`;
}
// Той самий клієнт: збігається номер або (якщо номер прихований сервером) його відбиток.
export const samePhone = (stored, typed) => !!stored && !!typed && (String(stored).startsWith('h:') ? stored === phoneHash(typed) : phoneKey(stored) === phoneKey(typed));

export function phoneKey(phone) {
  let d = String(phone ?? '').replace(/\D/g, '');
  if (!d) return null;
  if (d.length === 10 && d.startsWith('0')) d = `38${d}`;
  if (d.length === 9) d = `380${d}`;
  return `tel:${d}`;
}
export const bookingStart = (b) => { const d = parseDate(b.date); d.setMinutes(toMin(b.time)); return d; };
export const fmtTime = (ms) => new Date(ms).toLocaleString('uk-UA', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' });
export const fmtDate = (s) => parseDate(s).toLocaleDateString('uk-UA', { day: 'numeric', month: 'long', year: 'numeric' });
export const km = (n) => `${n.toLocaleString('uk-UA')} км`;

// Категорія послуги: задана в CRM, інакше — мийка (CARCAR працює лише з автомийками).
export const serviceCat = (s) => s.cat ?? 'wash';
export const catById = (id) => CATEGORIES.find((c) => c.id === id);

// Зменшує фото до 720 px, щоб воно вмістилося у сховище пристрою.
export async function shrinkPhoto(file) {
  try {
    const img = await createImageBitmap(file);
    const k = Math.min(1, 720 / Math.max(img.width, img.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(img.width * k);
    canvas.height = Math.round(img.height * k);
    canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/jpeg', 0.7);
  } catch {
    return null;
  }
}

// ---------- фото профілю клієнта ----------

// Фото лежать у спільному 'avatars' під випадковим номером, не повʼязаним із телефоном: { номер: { by, img, at } }.
// У записах, запитах і відгуках — лише цей номер (clientAvatar): фото видно мийці в чатах і записах, а у відгуках — усім,
// і номер телефону з нього не дізнатися. Із сервером саме фото й «by» отримує лише власник, решта — позначку { at },
// а картинку браузер бере за посиланням api/avatar/<номер> (з кешем), щоб синхронізація не возила фото всім.
export const avatarSrc = (id) => {
  const v = id && store.peek('avatars', {})[id];
  if (typeof v?.img === 'string' && v.img.startsWith('data:image/')) return v.img;
  return v?.at && v.img !== '' && hasServer() ? `api/avatar/${encodeURIComponent(id)}?v=${v.at}` : '';
};
export const myAvatarId = (owner) => Object.entries(store.peek('avatars', {})).find(([, v]) => v?.by === owner)?.[0] ?? null;
// Квадрат 256×256 з центру фото — щоб аватарки були легкими.
export async function shrinkAvatar(file) {
  try {
    const img = await createImageBitmap(file);
    const side = Math.min(img.width, img.height);
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 256;
    canvas.getContext('2d').drawImage(img, (img.width - side) / 2, (img.height - side) / 2, side, side, 0, 0, 256, 256);
    return canvas.toDataURL('image/jpeg', 0.8);
  } catch {
    return null;
  }
}

// ---------- налаштування точок із CRM ----------

// Точка може змінити в панелі для бізнесу телефон, години, кількість боксів і прайс.
// Зміни зберігаються в 'biz.places' і накладаються на дані з data.js в обох застосунках.
const withBase = (p) => Object.assign(p, {
  basePhone: p.phone, baseHours: p.hours, baseBoxes: p.boxes, baseServices: p.services, baseCats: p.cats, baseMobile: p.mobile ?? null,
  baseName: p.name, baseAddress: p.address, baseAbout: p.about ?? '',
});
PLACES.forEach(withBase);

// Нові точки, зареєстровані в панелі через «Підключення». Клієнти бачать їх лише після схвалення CARCAR.
function loadCustomPlaces() {
  for (const p of store.get('places.custom', [])) {
    if (!PLACES.some((x) => x.id === p.id)) PLACES.push(withBase({ ...p }));
  }
}

export function addCustomPlace(p) {
  store.set('places.custom', [...store.get('places.custom', []), p]);
  applyOverrides();
}

export function applyOverrides() {
  loadCustomPlaces();
  const all = store.get('biz.places', {});
  for (const p of PLACES) {
    const o = all[p.id] || {};
    p.phone = o.phone ?? p.basePhone;
    // Профіль, який бачать клієнти: назва, адреса, опис, аватар і фото — з CarCar Business.
    p.name = o.name ?? p.baseName;
    p.address = o.address ?? p.baseAddress;
    p.about = o.about ?? p.baseAbout;
    p.avatar = o.avatar ?? null;
    p.photos = o.photos ?? [];
    p.hours = o.hours !== undefined ? o.hours : p.baseHours;
    p.boxes = o.boxes ?? p.baseBoxes;
    p.schedule = o.schedule ?? null;
    p.mobile = o.mobile !== undefined ? o.mobile : p.baseMobile;
    p.allServices = o.services ?? p.baseServices;
    p.services = p.allServices.filter((s) => !s.off);
    // Категорії точки — ті, у яких є хоч одна активна послуга (точка могла додати нову).
    p.cats = [...new Set([...p.baseCats.filter((c) => p.services.some((s) => serviceCat(s) === c)), ...p.services.map(serviceCat)])];
  }
}

export function saveOverride(placeId, patch) {
  const all = store.get('biz.places', {});
  all[placeId] = { ...all[placeId], ...patch };
  store.set('biz.places', all);
  applyOverrides();
}

applyOverrides();

// ---------- підключення точок і модерація ----------

// Статус точки в CARCAR. Демо-точки з data.js уже підключені; нові починають з чернетки.
// Дані підключення (юрособа, документи, реквізити, оферта) і рішення модератора — у 'partners'.
export const PARTNER_STATUS = {
  draft: ['Чернетка', 'muted'], pending: ['На перевірці', 'warn'], changes: ['Потрібні виправлення', 'warn'],
  approved: ['Підключено', 'ok'], rejected: ['Відхилено', 'muted'], suspended: ['Призупинено', 'muted'],
  // Бізнес схвалено, але мийка ще не перевірила профіль, графік і ціни — клієнти її поки не бачать.
  setup: ['Налаштування', 'warn'],
};

export function partnerOf(placeId) {
  const p = PLACES.find((x) => x.id === placeId);
  return { status: p?.custom ? 'draft' : 'approved', demo: !p?.custom, history: [], ...store.get('partners', {})[placeId] };
}

export function savePartner(placeId, patch) {
  const all = store.get('partners', {});
  all[placeId] = { ...partnerOf(placeId), ...patch };
  store.set('partners', all);
  return all[placeId];
}

// Клієнти бачать і можуть записатися лише до підключених точок.
// Демо-мийки з data.js (вигадані, для показу). На сервері їх можна сховати від клієнтів: "demo_places": false —
// тоді в каталозі лише справжні мийки, що пройшли реєстрацію й перевірку.
export const isDemoPlace = (id) => DEMO_PLACE_IDS.has(id);
// Демо-режим вмикає й вимикає адмінка (ключ admin.server — одразу на всіх пристроях); інакше — як у конфігурації сервера.
const adminDemo = (name) => { const v = store.get('admin.server', null)?.[name]; return typeof v === 'boolean' ? v : null; };
export const demoPlacesOn = () => adminDemo('demoPlaces') ?? store.get('srv.demoPlaces', true) !== false;
export const demoWashOn = (srv) => adminDemo('demoWash') ?? srv?.demoWash !== false;
// Вхід за номером без перевірки. Без бота Telegram — завжди (інакше клієнт не увійде взагалі).
export const demoLoginOn = (srv) => !srv?.telegramBot || (adminDemo('demoLogin') ?? srv.demoLogin !== false);
export const isListed = (p) => !(isDemoPlace(p.id) && !demoPlacesOn()) && partnerOf(p.id).status === 'approved';

// Виводити гроші можна лише на перевірені реквізити.
// Виводити можна лише на перевірений CARCAR рахунок із правильним IBAN; призупиненій чи відхиленій точці — ні.
export const payoutReady = (placeId) => {
  const pt = partnerOf(placeId);
  return !!pt.payout?.verified && /^UA\d{27}$/.test(String(pt.payout.iban ?? '')) && !['rejected', 'suspended'].includes(pt.status);
};
export const maskIban = (iban) => `UA…${String(iban).slice(-4)}`;

// Комісія CARCAR: індивідуальна для точки або загальна з адмінки, інакше — з data.js.
export const commissionFor = (placeId) => partnerOf(placeId).commission ?? store.get('admin.settings', {}).commission ?? PAYMENT.commission;

// Гроші клієнту на баланс CARCAR (повернення за спором чи скасуванням з будь-якого екрана).
export function creditClient(amount, text, id = 'device', bookingId = null) {
  const w = { bonus: 0, money: 0, history: [], ...store.get(walletKey(id), {}) };
  w.money += amount;
  w.history.unshift({ amount, text, at: Date.now(), kind: 'money', ...(bookingId ? { bookingId } : {}) });
  store.set(walletKey(id), w);
}

// Рішення за спором: placePart — скільки отримує точка (0 — усе клієнту, повна ціна — усе точці).
// to — рішення модератора ('client' | 'place' | 'split'): потрібне, коли клієнт заплатив 0 ₴ (абонемент, картка лояльності).
export function resolveDispute(b, placePart, note = '', to = null) {
  const full = price(b);
  const toPlace = to === 'client' ? 0 : Math.max(0, Math.min(full, Math.round(placePart)));
  const name = PLACES.find((x) => x.id === b.placeId)?.name ?? '';
  b.resolution = { placePart: toPlace, note, at: Date.now() };
  if (to === 'place' || (to !== 'client' && toPlace === full)) {
    // Спір щодо неявки: усе точці — лишається неявкою, а не «виконано».
    if (b.disputeFrom === 'noshow') Object.assign(b, { state: 'noshow', placeAmount: full, refund: 0, closedAt: Date.now() });
    else complete(b);
    b.unfreezeAt = Date.now(); // модератор уже перевірив замовлення
    return;
  }
  const refund = Math.min(chargedOf(b), full - toPlace);
  Object.assign(b, { state: 'refunded', refund, placeAmount: toPlace, refundTo: 'balance', closedAt: Date.now() });
  if (refund) creditClient(refund, `Повернення за спором: ${name}`, b.clientId, b.id);
  // Усе клієнту — повертаємо й бонус, візит абонемента та промокод.
  if (toPlace === 0) {
    if (b.bonus && !b.bonusReturned) { creditBonus(b.bonus, `Повернення бонусу за спором: ${name}`, b.clientId, b.id); b.bonusReturned = true; }
    if (b.passUse) { returnPassUse(b.placeId, b.passUse); b.passUse = null; }
    if (b.promo) b.promo.returned = true;
  }
  if (b.installments) b.installments = { ...b.installments, cancelled: Date.now() };
}

// Заява мийки про запізнення клієнта: підтримка перевіряє. Підтвердила — оплата мийці (як неявка, без заморозки:
// уже перевірено); не підтвердила — гроші повертаються клієнту.
export function resolveLate(b, confirmed, note = '') {
  if (b?.state !== 'dispute' || !b.lateClaim) return false;
  b.lateClaim = { ...b.lateClaim, decided: confirmed ? 'confirmed' : 'rejected', at: Date.now() };
  if (!confirmed) { resolveDispute(b, 0, note); return true; }
  Object.assign(b, { state: 'noshow', lateForfeit: true, placeAmount: price(b), refund: 0, closedAt: Date.now(), unfreezeAt: Date.now(),
    resolution: { placePart: price(b), note, at: Date.now() } });
  return true;
}

// Скільки клієнт справді заплатив: за оплати частинами — лише перший платіж (решту банк скасовує) і частину з балансу.
export const chargedOf = (b) => (b.installments ? Math.max(0, b.paid - (b.installments.card ?? b.paid) + b.installments.first) : b.paid);

export function creditBonus(amount, text, id = 'device', bookingId = null) {
  const w = { bonus: 0, money: 0, history: [], ...store.get(walletKey(id), {}) };
  w.bonus += amount;
  w.history.unshift({ amount, text, at: Date.now(), ...(bookingId ? { bookingId } : {}) });
  store.set(walletKey(id), w);
}

// Повернути візит абонемента чи суму сертифіката (без залежності від ops.js).
function returnPassUse(placeId, use) {
  const all = store.get('biz.passes', {});
  const s = all[placeId]?.sold?.find((x) => x.id === use.soldId);
  if (!s) return;
  if (s.kind === 'sub') s.visitsLeft += 1; else s.balance += use.amount ?? 0;
  store.set('biz.passes', all);
}

// Справжнє замовлення клієнта (для «першого замовлення» й конверсій): не враховуємо скасовані без оплати точці —
// відмови й мовчання мийки, вчасні скасування клієнтом.
export const realOrder = (b) => !(['cancelled', 'refunded'].includes(b.state) && !(b.placeAmount > 0));

// ---------- персональні послуги й витрати ----------

// Персональна послуга з індивідуальною ціною для конкретного клієнта точки.
// clientKey — tel:… або car:…; клієнт бачить її в застосунку, якщо його телефон чи авто збігаються.
export const offersOf = (placeId, clientKey) =>
  store.get('biz.offers', []).filter((o) => o.placeId === placeId && o.active !== false && (!clientKey || o.clientKey === clientKey));

// Персональну послугу подаємо так само, як звичайну: одна ціна для всіх класів авто.
export const offerAsService = (o) => ({ id: `offer:${o.id}`, name: o.name, min: o.min, price: [o.price, o.price, o.price], cat: o.cat, personal: true, main: true, note: o.note });

export const EXPENSE_CATS = ['Хімія й витратні матеріали', 'Запчастини', 'Зарплата', 'Оренда', 'Комунальні послуги', 'Реклама', 'Податки', 'Обладнання й ремонт', 'Інше'];
export const PAY_METHODS = { cash: 'Готівка', card: 'Картка', account: 'Рахунок' };

// Витрати точки за проміжком дат: разові плюс щомісячні, розгорнуті на кожен місяць до кінця проміжку
// (або до дати зупинки). Розгорнуті записи мають id «шаблон@дата».
// ---------- персонал і зарплата ----------

export const ROLES = { owner: 'Власник', admin: 'Адміністратор', master: 'Майстер' };
export const staffOf = (placeId) => store.peek('biz.staff', {})[placeId] ?? [];

// База для відсотка майстра — вартість робіт: оплата клієнта, бонус і покрите абонементом чи сертифікатом.
export const workBase = (b) => (isCarcar(b) ? price(b) : b.paid) + (b.covered || 0);

// Зарплата майстрів — відсоток від виконаних робіт, одним рядком на майстра за день.
// Ці витрати не зберігаються окремо: їх завжди перераховано з виконаних записів.
export function salaryExpenses(placeId, from, to) {
  const staff = staffOf(placeId);
  const map = new Map();
  for (const b of store.peek('bookings', [])) {
    if (b.placeId !== placeId || b.state !== 'completed' || !b.masterId || b.date < from || b.date > to) continue;
    const m = staff.find((x) => x.id === b.masterId);
    if (!m?.pct) continue;
    const k = `${b.date}|${m.id}`;
    const e = map.get(k) ?? { id: `salary:${m.id}:${b.date}`, placeId, date: b.date, cat: 'Зарплата', method: 'card', amount: 0, works: 0, auto: 'salary', masterId: m.id };
    e.amount += (workBase(b) * m.pct) / 100;
    e.works++;
    map.set(k, e);
  }
  return [...map.values()].map((e) => {
    const m = staff.find((x) => x.id === e.masterId);
    return { ...e, amount: Math.round(e.amount), note: `${m.name}: ${e.works} ${plural(e.works, 'робота', 'роботи', 'робіт')} × ${m.pct}%` };
  });
}

export function expensesIn(placeId, from, to) {
  const out = [...salaryExpenses(placeId, from, to)];
  for (const e of store.get('biz.expenses', []).filter((x) => x.placeId === placeId)) {
    if (!e.recurring) {
      if (e.date >= from && e.date <= to) out.push(e);
      continue;
    }
    const start = parseDate(e.date);
    for (let k = 0; ; k++) {
      const d = new Date(start.getFullYear(), start.getMonth() + k, 1);
      const day = Math.min(start.getDate(), new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate());
      const iso = isoDate(new Date(d.getFullYear(), d.getMonth(), day));
      if (iso > to || (e.until && iso > e.until)) break;
      if (iso >= from) out.push({ ...e, id: `${e.id}@${iso}`, template: e.id, date: iso });
    }
  }
  return out.sort((a, b) => b.date.localeCompare(a.date));
}

// ---------- гроші ----------

// pending — клієнт оплатив, мийка ще не підтвердила: час уже зайнятий, гроші утримує CARCAR.
// offer — мийка запропонувала інший час і чекає згоди клієнта: зайнятий уже запропонований час.
export const ACTIVE = ['pending', 'offer', 'paid', 'done', 'dispute'];
export const AWAITING = ['pending', 'offer'];
export const HOUR = 3600000;

// Як часто клієнт змінює плани: скасування, неявки й перенесення — підказка для мийки, не обмеження.
export function reliability(list, now = Date.now()) {
  const R = RELIABILITY;
  const since = now - R.days * 24 * HOUR;
  const cancels = list.filter((b) => b.state === 'cancelled' && b.cancelBy === 'client' && (b.closedAt ?? 0) >= since);
  const noshows = list.filter((b) => b.state === 'noshow' && (b.closedAt ?? bookingStart(b).getTime()) >= now - R.noShowDays * 24 * HOUR).length;
  const moves = list.flatMap((b) => b.moves ?? []).filter((m) => m.at >= since).length;
  return { cancels: cancels.length, noshows, moves, level: noshows || cancels.length >= 3 || moves >= 4 ? 'warn' : 'ok' };
}
// Стани, у яких запис займає бокс: оплачені через CARCAR і внесені в журнал точки.
// unpaid — запис чекає оплати карткою (до 15 хв): час уже тримаємо.
export const BLOCKING = [...ACTIVE, 'booked', 'unpaid'];

// Запис через CARCAR (оплата в застосунку) чи внесений точкою вручну (оплата на місці).
export const isCarcar = (b) => (b.channel ?? 'carcar') === 'carcar';

// Повна ціна замовлення: те, що заплатив клієнт, плюс бонус і промокод, які доплачує CARCAR.
export const price = (b) => b.paid + (b.bonus || 0) + (b.promo && !b.promo.returned ? b.promo.amount : 0);

// ---------- виїзні послуги ----------

// Виїзна бригада зайнята ще MOBILE_ROAD хвилин після роботи — дорога до наступного клієнта.
// Бокси й бригади — окремі потужності: виїзний запис не займає бокс, а запис у точці — бригаду.
export const MOBILE_ROAD = 30;
export const mobileOn = (p) => !!p?.mobile?.services?.length && p.mobile.crews > 0;
export const spanOf = (b) => [toMin(b.time), toMin(b.time) + b.minutes + (b.mobile ? MOBILE_ROAD : 0)];
export const laneCap = (p, mobile) => (mobile ? p.mobile?.crews ?? 0 : p.boxes);
export const sameLane = (b, mobile) => !!b.mobile === !!mobile;

// ---------- промокоди платформи ----------

// Промокоди й акції CARCAR. Знижку оплачує платформа: точка отримує повну ціну, як із бонусом.
// kind: pct — відсоток (max — не більше ₴), sum — фіксована сума. cats — на які категорії діє (порожньо — на всі).
// firstOnly — лише на перше замовлення в цих категоріях; auto — застосовується сам, без введення коду.
export const PROMO_DEFAULTS = [
  { id: 'persha30', code: 'PERSHA30', title: 'Перша мийка −30%', kind: 'pct', value: 30, max: 300, minOrder: 0, cats: ['wash'], firstOnly: true, auto: true, active: true, until: null, limit: null },
];
export const promosAll = () => store.get('admin.promos', null) ?? PROMO_DEFAULTS;
export const savePromos = (list) => store.set('admin.promos', list);
export const promoUses = (code, bookings) => bookings.filter((b) => b.promo?.code === code && !b.promo.returned);
export const promoText = (pr) => (pr.kind === 'pct' ? `−${pr.value}%${pr.max ? ` (до ${uah(pr.max)})` : ''}` : `−${uah(pr.value)}`);

// Чи діє промокод на замовлення: items — [{cat, price}] обраних послуг (ціни вже зі знижками точки),
// mine — записи цього клієнта. Повертає { ok, amount } або { ok: false, why }.
export function promoCheck(pr, { place, items, mine, all }) {
  const today = isoDate(new Date());
  if (!pr || pr.active === false) return { ok: false, why: 'Промокод не діє' };
  if (pr.until && pr.until < today) return { ok: false, why: 'Строк дії промокоду минув' };
  if (pr.limit && promoUses(pr.code, all).length >= pr.limit) return { ok: false, why: 'Промокод уже використали максимальну кількість разів' };
  const inCats = (c) => !pr.cats?.length || pr.cats.includes(c);
  if (!place.cats.some(inCats)) return { ok: false, why: `Промокод діє лише на: ${pr.cats.map((c) => CATEGORIES.find((x) => x.id === c)?.name.toLowerCase()).join(', ')}` };
  const base = items.filter((x) => inCats(x.cat)).reduce((a, x) => a + x.price, 0);
  if (!base) return { ok: false, why: 'Промокод не діє на обрані послуги' };
  if (pr.minOrder && base < pr.minOrder) return { ok: false, why: `Промокод діє на замовлення від ${uah(pr.minOrder)}` };
  if (mine.some((b) => b.promo?.code === pr.code && !b.promo.returned)) return { ok: false, why: 'Ви вже скористалися цим промокодом' };
  if (pr.firstOnly && mine.some((b) => realOrder(b) && PLACES.find((x) => x.id === b.placeId)?.cats.some(inCats))) {
    return { ok: false, why: 'Промокод діє лише на перше замовлення' };
  }
  const amount = pr.kind === 'pct' ? Math.min(pr.max || Infinity, Math.round((base * pr.value) / 100)) : Math.min(pr.value, base);
  return { ok: true, amount };
}

// Мийка підтвердила виконання («Машина готова»): замовлення завершене,
// гроші точці заморожені ще на freezeHours, щоб клієнт встиг відкрити спір.
export function complete(b, at = Date.now()) {
  Object.assign(b, { state: 'completed', completedAt: at, unfreezeAt: at + PAYMENT.freezeHours * HOUR });
}

// Гроші точки заморожені на час для спору: після «Машина готова», а також після неявки чи запізнення.
export const isFrozen = (b) => ['completed', 'noshow'].includes(b.state) && Date.now() < (b.unfreezeAt ?? 0);

// Скільки з оплати клієнта належить точці (до комісії).
export function placeShare(b) {
  if (!isCarcar(b)) return 0;
  if (b.state === 'completed') return price(b);
  if (b.state === 'cancelled' || b.state === 'noshow' || b.state === 'refunded') return b.placeAmount ?? 0;
  return 0;
}

// Баланс точки в CARCAR: available — можна вивести; frozen — замовлення в роботі
// плюс підтверджені, що ще не розморозились. Оплати на місці сюди не входять.
// Номери телефонів у листуванні приховуємо: клієнт CARCAR лишається клієнтом CARCAR, дзвінки — через застосунок.
// Число з 9+ цифр (з пробілами, дужками, дефісами) — схоже на телефон; ціни й дати лишаються.
export const hidePhones = (text) => String(text ?? '').replace(/\+?\d[\d\s\-().]{7,}\d/g, (m) => (m.replace(/\D/g, '').length >= 9 ? '[номер приховано — дзвінки через CARCAR]' : m));

// Клієнт прийшов через CARCAR, але мийка записала його сама (по телефону чи «приїхав сам»):
// комісія з такого запису утримується з виплат.
// Ставка — та, що діяла, коли мийка записала клієнта (зміна ставки не перераховує минулого).
export const leadFee = (b) => (b.lead === 'carcar' && b.state === 'completed' ? Math.round((b.paid || 0) * (b.leadRate ?? commissionFor(b.placeId))) : 0);

export function balanceFor(placeId, bookings, payouts) {
  // Демо-сигнали антифроду — не гроші мийки.
  const own = bookings.filter((b) => b.placeId === placeId && isCarcar(b) && !b.demoFraud);
  const earned = own.filter((b) => !isFrozen(b)).reduce((a, b) => a + placeShare(b), 0);
  const withdrawn = payouts.filter((x) => x.placeId === placeId).reduce((a, x) => a + x.gross, 0);
  // Непідтверджений запис ще не гроші точки: якщо мийка відмовить, їх повернуть клієнту.
  const frozen = own.filter((b) => ACTIVE.includes(b.state) && !AWAITING.includes(b.state)).reduce((a, b) => a + price(b), 0)
    + own.filter(isFrozen).reduce((a, b) => a + placeShare(b), 0);
  const next = own.filter(isFrozen).sort((a, b) => a.unfreezeAt - b.unfreezeAt)[0];
  // Абонементи й сертифікати, куплені в застосунку: гроші точці через ті самі 48 годин.
  const sales = (store.peek('biz.passes', {})[placeId]?.sold ?? []).filter((x) => x.source === 'carcar');
  const ripe = (x) => Date.now() >= x.soldAt + PAYMENT.freezeHours * HOUR;
  const passEarned = sales.filter(ripe).reduce((a, x) => a + x.price, 0);
  const passFrozen = sales.filter((x) => !ripe(x)).reduce((a, x) => a + x.price, 0);
  const leadFees = bookings.filter((b) => b.placeId === placeId).reduce((a, b) => a + leadFee(b), 0);
  // Комісія під час виведення — з виручки через CARCAR, ще не виведеної (а не з суми, зменшеної на комісію за «своїх» клієнтів CARCAR).
  const feeBase = Math.max(0, earned + passEarned - payouts.filter((x) => x.placeId === placeId).reduce((a, x) => a + (x.base ?? x.gross), 0));
  const available = earned + passEarned - withdrawn - leadFees;
  const fee = Math.min(Math.max(0, available), Math.round(feeBase * commissionFor(placeId)));
  return { available, frozen: frozen + passFrozen, next, withdrawn, leadFees, feeBase, fee };
}

// Номер запису: шість цифр по порядку, однаковий у клієнта, мийки й підтримки — його називають,
// коли пишуть у підтримку. Записи без номера (старі чи щойно створені) отримують наступний.
export function numberBookings(list) {
  let seq = store.get('seq.booking', 100000);
  let changed = false;
  for (const b of list) {
    if (b.no) continue;
    b.no = ++seq;
    changed = true;
  }
  if (changed) store.set('seq.booking', seq);
  return changed;
}
export const bookingNo = (b) => (b?.no ? `№ ${b.no}` : '');
// Пошук запису за номером: «100245», «№100245», «# 100 245».
export const findByNo = (list, text) => {
  const n = Number(String(text).replace(/\D/g, ''));
  return n ? list.find((b) => b.no === n) ?? null : null;
};

// Фото в зверненнях: до 3 штук у повідомленні. viewer — у застосунку клієнта відкриваються на весь екран.
export const ticketPhotos = (photos = [], viewer = false) => (photos.length ? `<span class="ticket-photos">${photos
  .filter((src) => typeof src === 'string' && src.startsWith('data:image/'))
  .map((src, i) => (viewer
    ? `<button type="button" class="chat-photo" data-action="photo-open" aria-label="Відкрити фото ${i + 1}"><img src="${esc(src)}" alt="Фото ${i + 1}"></button>`
    : `<a href="${esc(src)}" download="foto-${i + 1}.jpg"><img src="${esc(src)}" alt="Фото ${i + 1}"></a>`)).join('')}</span>` : '');

// Виконання підтверджує мийка («Машина готова»). Записи зі старим проміжним станом «done»
// (чекали підтвердження клієнта) вважаються виконаними з моменту, коли мийка їх закрила.
export function settleAll(bookings) {
  let changed = numberBookings(bookings);
  for (const b of bookings) {
    if (b.state === 'done') {
      complete(b, b.doneAt ?? Date.now());
      changed = true;
    }
  }
  return changed;
}

// ---------- рейтинг ----------

// Відгуки, приховані модератором CARCAR, не впливають на рейтинг і не показуються клієнтам.
export const visibleReviews = (reviews) => reviews.filter((r) => !r.hidden);

export function ratingFor(placeId, reviews) {
  const list = visibleReviews(reviews).filter((r) => r.placeId === placeId);
  const dist = [1, 2, 3, 4, 5].map((n) => list.filter((r) => r.stars === n).length);
  const avg = list.length ? list.reduce((a, r) => a + r.stars, 0) / list.length : 0;
  return { avg, count: list.length, dist };
}

// ---------- підтримка CARCAR ----------

// Звернення клієнтів і точок у підтримку. Повʼязане із записом (bookingId) звернення модератор
// бачить поруч зі спором і може перевести в спір прямо зі звернення.
// status: new — ще не відповіли, open — у роботі, waiting — чекаємо відповіді автора, closed — закрито.
export const TICKET_TOPICS = {
  booking: 'Запис і перенесення', payment: 'Оплата й повернення', quality: 'Якість послуги', dispute: 'Спір щодо замовлення',
  payout: 'Виплати й комісія', review: 'Відгуки', account: 'Акаунт і дані', fraud: 'Підозра на шахрайство', other: 'Інше',
  late: 'Запізнення клієнта',
};
export const CLIENT_TOPICS = ['booking', 'payment', 'quality', 'dispute', 'account', 'fraud', 'other'];
export const PLACE_TOPICS = ['payout', 'booking', 'dispute', 'review', 'account', 'fraud', 'other'];
export const TICKET_STATUS = { new: ['Нове', 'warn'], open: ['У роботі', 'carcar'], waiting: ['Чекаємо відповіді', 'muted'], closed: ['Закрито', 'ok'] };
// Термінові теми — гроші й шахрайство: відповідь за 2 години, решта — за добу.
const URGENT = ['payment', 'dispute', 'fraud', 'payout', 'late'];
export const slaHours = (t) => (t.priority === 'high' ? 2 : 24);

export const ticketsAll = () => store.get('support', []);
export const saveTickets = (list) => store.set('support', list);

export function openTicket({ from, placeId = null, bookingId = null, topic, text, clientName = '', clientPhone = '', clientKey = null, photos = [] }) {
  const list = ticketsAll();
  const t = {
    id: uid(), no: 1000 + list.length + 1, from, placeId, bookingId, topic, clientName, clientPhone, clientKey,
    priority: URGENT.includes(topic) ? 'high' : 'normal', status: 'new',
    messages: [{ from, text, at: Date.now(), ...(photos.length ? { photos } : {}) }], createdAt: Date.now(), updatedAt: Date.now(), unreadAdmin: true, unreadUser: false,
  };
  saveTickets([...list, t]);
  return t;
}

// Повідомлення у зверненні. Відповідь CARCAR чекає реакції автора, відповідь автора повертає звернення в роботу.
export function ticketReply(id, from, text, status, photos = []) {
  const list = ticketsAll();
  const t = list.find((x) => x.id === id);
  if (!t) return null;
  t.messages.push({ from, text, at: Date.now(), ...(photos.length ? { photos } : {}) });
  t.updatedAt = Date.now();
  if (from === 'admin') {
    t.firstReplyAt ??= Date.now();
    t.status = status ?? 'waiting';
    t.unreadUser = true;
    t.unreadAdmin = false;
  } else {
    t.status = t.status === 'new' ? 'new' : 'open';
    t.unreadAdmin = true;
  }
  saveTickets(list);
  return t;
}

export function setTicket(id, patch) {
  const list = ticketsAll();
  const t = list.find((x) => x.id === id);
  if (t) Object.assign(t, patch, { updatedAt: Date.now() });
  saveTickets(list);
  return t;
}

// Прострочено, якщо CARCAR ще не відповів у межах SLA.
export const ticketOverdue = (t, now = Date.now()) => t.status === 'new' && now - t.createdAt > slaHours(t) * HOUR;

// ---------- антифрод: обмеження ----------

// Клієнти, яким CARCAR обмежив онлайн-запис після перевірки (ключ — tel:… або device).
export const fraudState = () => ({ dismissed: {}, blocked: {}, ...store.get('admin.fraud', {}) });
export const saveFraud = (s) => store.set('admin.fraud', s);
export const isBlocked = (keys) => keys.some((k) => k && fraudState().blocked[k]);

// ---------- рух ----------

// Поява сторінки й «набігання» чисел у показниках — лише при переході на інший екран
// і якщо людина не просила зменшити анімацію.
const calm = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
// Фонове перемальовування (прийшли зміни з сервера, спрацював таймер) не має збивати людину: прокрутка, набраний
// текст, курсор і позначки в полях лишаються як були. Відновлюємо лише поля, які людина змінювала сама.
const touched = new WeakSet();
if (typeof document !== 'undefined') {
  for (const ev of ['input', 'change']) document.addEventListener(ev, (e) => e.target?.matches?.('input, textarea, select') && touched.add(e.target), true);
}
const fieldKey = (el) => `${el.closest('form[id], form[data-id], [data-id], [id]:not(input):not(textarea):not(select)')?.getAttribute('id') ?? ''}|${el.closest('[data-id]')?.dataset.id ?? ''}|${el.id || el.name}|${['checkbox', 'radio'].includes(el.type) ? el.value : ''}`;
export function keepUi(fn) {
  const y = window.scrollY;
  const saved = new Map();
  for (const el of document.querySelectorAll('input, textarea, select')) {
    if (!touched.has(el) || !(el.id || el.name) || el.type === 'file') continue;
    saved.set(fieldKey(el), ['checkbox', 'radio'].includes(el.type) ? el.checked : el.value);
  }
  const a = document.activeElement;
  const focus = a?.matches?.('input, textarea, select') && (a.id || a.name) ? { key: fieldKey(a), from: a.selectionStart, to: a.selectionEnd } : null;
  const open = new Set([...document.querySelectorAll('details[open][id], details[open][data-id]')].map((d) => d.id || d.dataset.id));
  fn();
  for (const el of document.querySelectorAll('input, textarea, select')) {
    const k = fieldKey(el);
    if (saved.has(k)) {
      if (['checkbox', 'radio'].includes(el.type)) el.checked = saved.get(k); else if (el.value !== saved.get(k)) el.value = saved.get(k);
      touched.add(el);
    }
    if (focus && k === focus.key && document.activeElement !== el) {
      el.focus({ preventScroll: true });
      try { if (focus.from != null) el.setSelectionRange(focus.from, focus.to); } catch { /* поле без курсора */ }
    }
  }
  for (const d of document.querySelectorAll('details[id], details[data-id]')) if (open.has(d.id || d.dataset.id)) d.open = true;
  if (Math.abs(window.scrollY - y) > 1) window.scrollTo({ top: y, behavior: 'instant' });
}

export function enterView(view, changed) {
  if (!changed || calm()) return;
  view.classList.remove('view-enter');
  void view.offsetWidth; // перезапуск анімації
  view.classList.add('view-enter');
  clearTimeout(enterView.t);
  enterView.t = setTimeout(() => view.classList.remove('view-enter'), 900);
  for (const el of view.querySelectorAll('.kpi .value, .tile b, .sheet-total b')) countUp(el);
}

function countUp(el) {
  const text = el.textContent;
  const m = text.match(/\d[\d\s  ]*(?:,\d+)?/);
  if (!m) return;
  const dec = m[0].includes(',') ? m[0].split(',')[1].length : 0;
  const to = parseFloat(m[0].replace(/[\s  ]/g, '').replace(',', '.'));
  if (!(to > 0)) return;
  const start = performance.now();
  const step = (now) => {
    if (!el.isConnected) return;
    const k = Math.min(1, (now - start) / 650);
    const v = to * (1 - (1 - k) ** 3);
    el.textContent = k < 1 ? text.replace(m[0], v.toLocaleString('uk-UA', { minimumFractionDigits: dec, maximumFractionDigits: dec })) : text;
    if (k < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

// ---------- заявки бізнесу й доступ до кабінету ----------

// Мийка подає заявку в застосунку («Для бізнесу» → «Зареєструвати бізнес»). Адміністрація CARCAR
// перевіряє її й видає логін і пароль до кабінету. У прототипі все в localStorage одного браузера;
// у робочій версії заявки, акаунти й паролі (лише хеші) зберігає сервер, а доступ надходить у SMS чи на email.
export const bizApps = () => store.get('biz.applications', []);
export const saveBizApps = (list) => store.set('biz.applications', list);
export const bizAccounts = () => store.get('biz.accounts', []);
export const APP_STATUS = { new: ['На перевірці', 'warn'], approved: ['Схвалено', 'ok'], rejected: ['Відхилено', 'muted'] };

export async function hashPass(login, pass) {
  const text = `carcar:${login.toLowerCase()}:${pass}`;
  if (globalThis.crypto?.subtle) {
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
    return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
  }
  let h = 5381;
  for (const ch of text) h = (h * 33) ^ ch.charCodeAt(0);
  return `x${(h >>> 0).toString(16)}`;
}

const TRANSLIT = { а: 'a', б: 'b', в: 'v', г: 'h', ґ: 'g', д: 'd', е: 'e', є: 'ie', ж: 'zh', з: 'z', и: 'y', і: 'i', ї: 'i', й: 'i', к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f', х: 'kh', ц: 'ts', ч: 'ch', ш: 'sh', щ: 'shch', ь: '', ю: 'iu', я: 'ia', "'": '', 'ʼ': '' };
const slug = (name) => [...name.toLowerCase().replace(/автомийка|мийка|детейлінг/g, '')].map((c) => TRANSLIT[c] ?? c).join('').replace(/[^a-z0-9]+/g, '').slice(0, 12) || 'wash';
const randomPass = () => Array.from(crypto.getRandomValues(new Uint32Array(8)), (n) => 'abcdefghjkmnpqrstuvwxyz23456789'[n % 31]).join('');

// Схвалити заявку: створюємо точку (підключену), акаунт кабінету й повертаємо логін і пароль.
export async function approveBizApp(id) {
  const apps = bizApps();
  const a = apps.find((x) => x.id === id);
  if (!a || a.status === 'approved') return null;
  const placeId = `p_${uid()}`;
  // Поки мийка не вказала точку на карті — центр міста з невеликим зсувом, щоб мітки не злипались.
  const c = (CITIES.find((x) => x.name === a.city) ?? CITIES[0]).center;
  const [lat, lng] = [c.lat + (Math.random() - 0.5) * 0.03, c.lng + (Math.random() - 0.5) * 0.05];
  addCustomPlace({
    id: placeId, custom: true, name: a.name, cats: ['wash'], city: a.city || 'Київ', district: '', address: a.address, phone: a.phone,
    boxes: Math.max(1, Number(a.boxes) || 1), hours: [8, 21], lat, lng, tags: [], createdAt: Date.now(),
    services: Object.entries(SERVICE_TEMPLATES.wash).map(([sid, x]) => ({ id: sid, ...x, price: [...x.price] })),
  });
  // Клієнти побачать мийку, коли вона сама перевірить профіль, графік і ціни в CarCar Business.
  savePartner(placeId, {
    status: 'setup', company: { type: a.type, code: a.code, name: a.legalName || a.contact },
    history: [{ at: Date.now(), by: 'admin', status: 'setup', note: 'Заявку схвалено, доступ до кабінету видано' }],
  });
  let login = slug(a.name);
  while (bizAccounts().some((x) => x.login === login)) login = `${slug(a.name)}${Math.floor(10 + Math.random() * 90)}`;
  const password = randomPass();
  store.set('biz.accounts', [...bizAccounts(), { login, hash: await hashPass(login, password), placeId, appId: id, createdAt: Date.now() }]);
  Object.assign(a, { status: 'approved', placeId, decidedAt: Date.now(), issued: { login, password } });
  saveBizApps(apps);
  return { login, password, placeId };
}

// Мийку додає сама адміністрація (наприклад, за даними з Google Карт): точка, профіль для клієнтів, статус,
// за бажанням — одразу в каталозі й логін до кабінету для власника.
export async function createPlace(d, { publish = true, account = true } = {}) {
  const placeId = `p_${uid()}`;
  const c = (CITIES.find((x) => x.name === d.city) ?? CITIES[0]).center;
  const lat = Number.isFinite(d.lat) ? d.lat : c.lat + (Math.random() - 0.5) * 0.03;
  const lng = Number.isFinite(d.lng) ? d.lng : c.lng + (Math.random() - 0.5) * 0.05;
  addCustomPlace({
    id: placeId, custom: true, name: d.name, cats: ['wash'], city: d.city || CITIES[0].name, district: d.district || '', address: d.address, phone: d.phone || '',
    boxes: Math.max(1, Number(d.boxes) || 1), hours: [8, 21], lat, lng, tags: [], createdAt: Date.now(), source: d.source || 'admin',
    ...(d.googleId ? { googleId: d.googleId, googleUrl: d.googleUrl || '' } : {}),
    services: Object.entries(SERVICE_TEMPLATES.wash).map(([sid, x]) => ({ id: sid, ...x, price: [...x.price] })),
  });
  const profile = {
    ...(d.schedule ? { schedule: d.schedule } : {}),
    ...(d.about ? { about: d.about } : {}),
    ...(d.photos?.length ? { photos: d.photos } : {}),
  };
  if (Object.keys(profile).length) saveOverride(placeId, profile);
  savePartner(placeId, {
    status: publish ? 'approved' : 'setup', ...(publish ? { publishedAt: Date.now() } : {}),
    history: [{ at: Date.now(), by: 'admin', status: publish ? 'approved' : 'setup', note: publish ? 'Мийку додала адміністрація й опублікувала' : 'Мийку додала адміністрація' }],
  });
  if (!account) return { placeId };
  let login = slug(d.name);
  while (bizAccounts().some((x) => x.login === login)) login = `${slug(d.name)}${Math.floor(10 + Math.random() * 90)}`;
  const password = randomPass();
  store.set('biz.accounts', [...bizAccounts(), { login, hash: await hashPass(login, password), placeId, createdAt: Date.now(), byAdmin: true }]);
  return { placeId, login, password };
}

export function rejectBizApp(id, reason) {
  const apps = bizApps();
  const a = apps.find((x) => x.id === id);
  if (a) Object.assign(a, { status: 'rejected', reason, decidedAt: Date.now() });
  saveBizApps(apps);
}

// Мийки акаунта: перша — зі схваленої заявки, далі — додані в CarCar Business.
// Демо-кабінет бачить усі підключені демо-мийки й ті, що додали в демо.
export function accountPlaces(session) {
  if (!session) return [];
  if (session.demo) return [...PLACES.filter((p) => !p.custom).map((p) => p.id), ...store.get('biz.demoPlaces', [])].filter((id) => PLACES.some((p) => p.id === id));
  const acc = bizAccounts().find((x) => x.login === session.login);
  return [acc?.placeId ?? session.placeId, ...(acc?.places ?? [])].filter((id, i, a) => id && a.indexOf(id) === i && PLACES.some((p) => p.id === id));
}

// Ще одна мийка в тому ж акаунті: зʼявиться в каталозі після перевірки CARCAR.
export function addAccountPlace(session, f) {
  const placeId = `p_${uid()}`;
  const c = (CITIES.find((x) => x.name === f.city) ?? CITIES[0]).center;
  addCustomPlace({
    id: placeId, custom: true, name: f.name, cats: ['wash'], city: f.city || 'Київ', district: '', address: f.address, phone: f.phone,
    boxes: Math.max(1, Number(f.boxes) || 1), hours: [8, 21], lat: c.lat + (Math.random() - 0.5) * 0.03, lng: c.lng + (Math.random() - 0.5) * 0.05,
    tags: [], createdAt: Date.now(), services: Object.entries(SERVICE_TEMPLATES.wash).map(([sid, x]) => ({ id: sid, ...x, price: [...x.price] })),
  });
  const owner = session.demo ? 'демо-кабінет' : session.login;
  savePartner(placeId, { status: 'pending', company: null, history: [{ at: Date.now(), by: 'partner', status: 'pending', note: `Нова мийка з кабінету ${owner}` }] });
  if (session.demo) store.set('biz.demoPlaces', [...store.get('biz.demoPlaces', []), placeId]);
  else store.set('biz.accounts', bizAccounts().map((x) => (x.login === session.login ? { ...x, places: [...(x.places ?? []), placeId] } : x)));
  return placeId;
}

// Вхід у кабінет: повертає акаунт або null.
export async function checkBizLogin(login, pass) {
  const acc = bizAccounts().find((x) => x.login === login.trim().toLowerCase());
  return acc && acc.hash === await hashPass(acc.login, pass) ? acc : null;
}

// ---------- підтвердження записів і відповідальність мийки ----------

// Звідки рахується час на відповідь: від заявки, а якщо мийка зачинена — від відкриття.
export function confirmStart(b) {
  const p = PLACES.find((x) => x.id === b.placeId);
  let t = b.createdAt ?? Date.now();
  for (let i = 0; p && i < 8; i++) {
    const d = new Date(t);
    const iso = isoDate(d);
    const h = hoursFor(p, iso);
    const m = d.getHours() * 60 + d.getMinutes();
    if (h && m < h[1]) {
      if (m < h[0]) t = parseDate(iso).getTime() + h[0] * 60000;
      break;
    }
    const next = parseDate(iso);
    next.setDate(next.getDate() + 1);
    t = next.getTime();
  }
  return t;
}

// До коли мийка має відповісти: confirmMinutes робочого часу, але не пізніше за початок візиту.
export const confirmBy = (b) => Math.min(confirmStart(b) + PAYMENT.confirmMinutes * 60000, bookingStart(b).getTime());
// До коли клієнт може погодитися на запропонований час.
export const offerBy = (b) => Math.min((b.offer?.at ?? Date.now()) + PAYMENT.offerMinutes * 60000, bookingStart(b).getTime());

// Відмови й швидкість відповіді мийки за останні DECLINE_RULES.days днів.
export function responseStats(placeId, bookings, now = Date.now()) {
  const from = now - DECLINE_RULES.days * 24 * HOUR;
  // Заявки, які клієнт сам скасував до відповіді мийки, не рахуємо.
  const list = bookings.filter((b) => b.placeId === placeId && b.needsConfirm && (b.createdAt ?? 0) >= from && !AWAITING.includes(b.state)
    && !(b.cancelBy === 'client' && !b.respondedAt && !b.declined));
  const declined = list.filter((b) => b.declined === 'place' || b.declined === 'timeout');
  const answered = list.filter((b) => b.respondedAt);
  const avgMs = answered.length ? answered.reduce((a, b) => a + Math.max(0, b.respondedAt - confirmStart(b)), 0) / answered.length : null;
  const enough = list.length >= DECLINE_RULES.minRequests;
  const rate = list.length ? declined.length / list.length : 0;
  const lastDecline = Math.max(0, ...declined.map((b) => b.closedAt ?? 0));
  return {
    total: list.length, declined: declined.length, timeouts: declined.filter((b) => b.declined === 'timeout').length,
    offers: list.filter((b) => b.offer).length, rate, avgMs, enough,
    lowered: enough && rate > DECLINE_RULES.warnRate, lastDecline,
  };
}

// Пауза онлайн-запису: часті відмови — на pauseHours після останньої. Адмін може зняти паузу.
export function pauseOf(placeId, bookings, now = Date.now()) {
  const s = responseStats(placeId, bookings, now);
  if (!s.enough || s.rate < DECLINE_RULES.pauseRate || !s.lastDecline) return null;
  if ((store.peek('admin.pauseLift', {})[placeId] ?? 0) >= s.lastDecline) return null;
  const until = s.lastDecline + DECLINE_RULES.pauseHours * HOUR;
  return now < until ? { until, rate: s.rate } : null;
}
export function liftPause(placeId) {
  store.set('admin.pauseLift', { ...store.get('admin.pauseLift', {}), [placeId]: Date.now() });
}
export const ratePct = (k) => `${Math.round(k * 100)}%`;
export const msText = (ms) => (ms === null ? '—' : ms < 60000 ? `${Math.max(1, Math.round(ms / 1000))} с` : `${Math.floor(ms / 60000)} хв${Math.round((ms % 60000) / 1000) ? ` ${Math.round((ms % 60000) / 1000)} с` : ''}`);

// ---------- тема ----------

// Тема: system — як у телефоні, light / dark — вибрана в налаштуваннях. key — окремо для застосунку клієнта й мийки.
export const THEMES = [['system', 'Системна'], ['light', 'Світла'], ['dark', 'Темна']];
export function setTheme(key, value) {
  store.set(key, value);
  if (value === 'light' || value === 'dark') document.documentElement.dataset.theme = value;
  else delete document.documentElement.dataset.theme;
}
export const themePicker = (cur) => `<div class="seg-row theme-row" role="radiogroup" aria-label="Тема">${THEMES.map(([v, label]) =>
  `<label><input type="radio" name="theme" value="${v}" ${v === cur ? 'checked' : ''}><span>${label}</span></label>`).join('')}</div>`;

// ---------- чат і клавіатура телефона ----------

// На iPhone клавіатура не зменшує сторінку, а зсуває її вгору — чат «їде», шапка зникає з екрана.
// Підганяємо екран чату під видиму частину (visualViewport): шапка лишається зверху, поле — над клавіатурою.
export function fitChatScreen() {
  const vv = window.visualViewport;
  const el = document.querySelector('.chat-screen');
  if (!vv || !el) return;
  const list = el.querySelector('.chat-msgs');
  const atEnd = list ? list.scrollHeight - list.scrollTop - list.clientHeight < 40 : false;
  const keyboard = window.innerHeight - vv.height > 80;
  el.style.height = keyboard ? `${vv.height}px` : '';
  el.style.transform = keyboard && vv.offsetTop ? `translateY(${vv.offsetTop}px)` : '';
  if (list && atEnd) list.scrollTop = list.scrollHeight;
}
export function keepChatOnKeyboard() {
  const vv = window.visualViewport;
  if (!vv) return;
  vv.addEventListener('resize', fitChatScreen);
  vv.addEventListener('scroll', fitChatScreen);
}
