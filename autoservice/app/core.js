// Спільна логіка застосунку клієнта (app.js) і панелі для бізнесу (business.js):
// сховище, форматування, іконки, гроші, рейтинг і налаштування точок із CRM.
import { CATEGORIES, PLACES, PAYMENT } from './data.js';

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
      return true;
    } catch {
      // Приватний режим або переповнення: працюємо без збереження.
      return false;
    }
  },
};

// ---------- іконки (лінійні, з дизайну CARCAR) ----------

export const ICONS = {
  pin: '<path d="M12 21s-7-6.2-7-11.5a7 7 0 0 1 14 0C19 14.8 12 21 12 21z"/><circle cx="12" cy="9.5" r="2.5"/>',
  snow: '<path d="M12 3v18M4.2 7.5l15.6 9M4.2 16.5l15.6-9M9.5 4.5 12 7l2.5-2.5M9.5 19.5 12 17l2.5 2.5"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2.5v2M12 19.5v2M4.6 4.6 6 6M18 18l1.4 1.4M2.5 12h2M19.5 12h2M4.6 19.4 6 18M18 6l1.4-1.4"/>',
  chevR: '<path d="m9 5 7 7-7 7"/>',
  chevL: '<path d="m15 5-7 7 7 7"/>',
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

// ---------- налаштування точок із CRM ----------

// Точка може змінити в панелі для бізнесу телефон, години, кількість боксів і прайс.
// Зміни зберігаються в 'biz.places' і накладаються на дані з data.js в обох застосунках.
const withBase = (p) => Object.assign(p, { basePhone: p.phone, baseHours: p.hours, baseBoxes: p.boxes, baseServices: p.services, baseCats: p.cats, baseMobile: p.mobile ?? null });
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
export const isListed = (p) => partnerOf(p.id).status === 'approved';

// Виводити гроші можна лише на перевірені реквізити.
export const payoutReady = (placeId) => !!partnerOf(placeId).payout?.verified && partnerOf(placeId).status !== 'rejected';
export const maskIban = (iban) => `UA…${String(iban).slice(-4)}`;

// Комісія CARCAR: індивідуальна для точки або загальна з адмінки, інакше — з data.js.
export const commissionFor = (placeId) => partnerOf(placeId).commission ?? store.get('admin.settings', {}).commission ?? PAYMENT.commission;

// Гроші клієнту на баланс CARCAR (повернення за спором чи скасуванням з будь-якого екрана).
export function creditClient(amount, text) {
  const w = { bonus: 0, money: 0, history: [], ...store.get('wallet', {}) };
  w.money += amount;
  w.history.unshift({ amount, text, at: Date.now(), kind: 'money' });
  store.set('wallet', w);
}

// Рішення за спором: placePart — скільки отримує точка (0 — усе клієнту, повна ціна — усе точці).
export function resolveDispute(b, placePart, note = '') {
  const full = price(b);
  const toPlace = Math.max(0, Math.min(full, Math.round(placePart)));
  const name = PLACES.find((x) => x.id === b.placeId)?.name ?? '';
  b.resolution = { placePart: toPlace, note, at: Date.now() };
  if (toPlace === full) {
    complete(b);
    b.unfreezeAt = Date.now(); // модератор уже перевірив замовлення
    return;
  }
  const refund = Math.min(b.paid, full - toPlace);
  Object.assign(b, { state: 'refunded', refund, placeAmount: toPlace, refundTo: 'balance' });
  if (refund) creditClient(refund, `Повернення за спором: ${name}`);
}

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

export const ACTIVE = ['paid', 'done', 'dispute'];
export const HOUR = 3600000;
// Стани, у яких запис займає бокс: оплачені через CARCAR і внесені в журнал точки.
export const BLOCKING = [...ACTIVE, 'booked'];

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
  if (pr.firstOnly && mine.some((b) => !(b.state === 'cancelled' && b.refundTo === 'balance') && PLACES.find((x) => x.id === b.placeId)?.cats.some(inCats))) {
    return { ok: false, why: 'Промокод діє лише на перше замовлення' };
  }
  const amount = pr.kind === 'pct' ? Math.min(pr.max || Infinity, Math.round((base * pr.value) / 100)) : Math.min(pr.value, base);
  return { ok: true, amount };
}

// Клієнт підтвердив (або мовчав після «Машина готова»): замовлення завершене,
// гроші точці заморожені ще на freezeHours, щоб клієнт встиг відкрити спір.
export function complete(b, at = Date.now()) {
  Object.assign(b, { state: 'completed', completedAt: at, unfreezeAt: at + PAYMENT.freezeHours * HOUR });
}

export const isFrozen = (b) => b.state === 'completed' && Date.now() < (b.unfreezeAt ?? 0);

// Скільки з оплати клієнта належить точці (до комісії).
export function placeShare(b) {
  if (!isCarcar(b)) return 0;
  if (b.state === 'completed') return price(b);
  if (b.state === 'cancelled' || b.state === 'noshow' || b.state === 'refunded') return b.placeAmount ?? 0;
  return 0;
}

// Баланс точки в CARCAR: available — можна вивести; frozen — замовлення в роботі
// плюс підтверджені, що ще не розморозились. Оплати на місці сюди не входять.
export function balanceFor(placeId, bookings, payouts) {
  const own = bookings.filter((b) => b.placeId === placeId && isCarcar(b));
  const earned = own.filter((b) => !isFrozen(b)).reduce((a, b) => a + placeShare(b), 0);
  const withdrawn = payouts.filter((x) => x.placeId === placeId).reduce((a, x) => a + x.gross, 0);
  const frozen = own.filter((b) => ACTIVE.includes(b.state) || isFrozen(b)).reduce((a, b) => a + price(b), 0);
  const next = own.filter(isFrozen).sort((a, b) => a.unfreezeAt - b.unfreezeAt)[0];
  // Абонементи й сертифікати, куплені в застосунку: гроші точці через ті самі 48 годин.
  const sales = (store.peek('biz.passes', {})[placeId]?.sold ?? []).filter((x) => x.source === 'carcar');
  const ripe = (x) => Date.now() >= x.soldAt + PAYMENT.freezeHours * HOUR;
  const passEarned = sales.filter(ripe).reduce((a, x) => a + x.price, 0);
  const passFrozen = sales.filter((x) => !ripe(x)).reduce((a, x) => a + x.price, 0);
  return { available: earned + passEarned - withdrawn, frozen: frozen + passFrozen, next, withdrawn };
}

// Якщо клієнт мовчить після «Машина готова», замовлення підтверджується саме.
export function settleAll(bookings) {
  let changed = false;
  for (const b of bookings) {
    if (b.state === 'done' && Date.now() - b.doneAt >= PAYMENT.autoReleaseHours * HOUR) {
      complete(b, b.doneAt + PAYMENT.autoReleaseHours * HOUR);
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
};
export const CLIENT_TOPICS = ['booking', 'payment', 'quality', 'dispute', 'account', 'fraud', 'other'];
export const PLACE_TOPICS = ['payout', 'booking', 'dispute', 'review', 'account', 'fraud', 'other'];
export const TICKET_STATUS = { new: ['Нове', 'warn'], open: ['У роботі', 'carcar'], waiting: ['Чекаємо відповіді', 'muted'], closed: ['Закрито', 'ok'] };
// Термінові теми — гроші й шахрайство: відповідь за 2 години, решта — за добу.
const URGENT = ['payment', 'dispute', 'fraud', 'payout'];
export const slaHours = (t) => (t.priority === 'high' ? 2 : 24);

export const ticketsAll = () => store.get('support', []);
export const saveTickets = (list) => store.set('support', list);

export function openTicket({ from, placeId = null, bookingId = null, topic, text, clientName = '', clientPhone = '', clientKey = null }) {
  const list = ticketsAll();
  const t = {
    id: uid(), no: 1000 + list.length + 1, from, placeId, bookingId, topic, clientName, clientPhone, clientKey,
    priority: URGENT.includes(topic) ? 'high' : 'normal', status: 'new',
    messages: [{ from, text, at: Date.now() }], createdAt: Date.now(), updatedAt: Date.now(), unreadAdmin: true, unreadUser: false,
  };
  saveTickets([...list, t]);
  return t;
}

// Повідомлення у зверненні. Відповідь CARCAR чекає реакції автора, відповідь автора повертає звернення в роботу.
export function ticketReply(id, from, text, status) {
  const list = ticketsAll();
  const t = list.find((x) => x.id === id);
  if (!t) return null;
  t.messages.push({ from, text, at: Date.now() });
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
