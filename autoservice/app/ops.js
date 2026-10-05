// Спільна логіка застосунку клієнта й панелі бізнесу для щоденної роботи точки:
// гарячі вікна зі знижкою, жива черга, лист очікування, абонементи й сертифікати,
// шинний готель і повідомлення клієнтам (розсилки, нагадування).
import { PLACES } from './data.js';
import {
  store, uid, isoDate, parseDate, hhmm, toMin, plural, hoursFor, scheduleOf, inBreak, BLOCKING, phoneKey, isListed, weekdayOf,
  spanOf, laneCap, sameLane, MOBILE_ROAD,
} from './core.js';

const opsToday = () => isoDate(new Date());
const opsNow = () => { const d = new Date(); return d.getHours() * 60 + d.getMinutes(); };
const opsPlace = (id) => PLACES.find((p) => p.id === id);

// ---------- повідомлення клієнтам ----------

// Вхідні клієнта в застосунку: розсилки точок, нагадування шинного готелю, лист очікування.
// clientKey — tel:… або car:…, як у CRM. channel — viber, telegram або app.
export const CHANNELS = { viber: 'Viber', telegram: 'Telegram', app: 'Застосунок CARCAR' };

export function sendMessages(list) {
  const all = store.get('messages', []);
  for (const m of list) all.push({ id: uid(), at: Date.now(), read: false, ...m });
  store.set('messages', all);
}

export const inboxFor = (keys) => store.peek('messages', []).filter((m) => keys.includes(m.clientKey)).sort((a, b) => b.at - a.at);

export function markRead(keys) {
  const all = store.get('messages', []);
  let changed = false;
  for (const m of all) if (keys.includes(m.clientKey) && !m.read) { m.read = true; changed = true; }
  if (changed) store.set('messages', all);
}

// Посилання, щоб написати клієнту вручну з телефона точки.
export const viberLink = (phone) => `viber://chat?number=${encodeURIComponent(`+${String(phone).replace(/\D/g, '').replace(/^0/, '380')}`)}`;
export const telegramLink = (phone) => `https://t.me/+${String(phone).replace(/\D/g, '').replace(/^0/, '380')}`;

// ---------- вільний час ----------

// Вільні початки на дату: у робочі години, не в перерву, не в минулому й поки є вільний бокс
// (для виїзного запису — вільна бригада з урахуванням дороги). skip — запис, який переносять.
export function openStarts(place, date, minutes, bookings, { lead = scheduleOf(place).lead, skip, mobile = false } = {}) {
  const h = hoursFor(place, date);
  if (!h) return [];
  const spans = bookings.filter((b) => b.placeId === place.id && b.date === date && BLOCKING.includes(b.state) && b !== skip && sameLane(b, mobile))
    .map(spanOf);
  const need = minutes + (mobile ? MOBILE_ROAD : 0);
  const cap = laneCap(place, mobile);
  const min = date === opsToday() ? opsNow() + lead : -1;
  const out = [];
  for (let t = h[0]; t + minutes <= h[1]; t += 30) {
    if (t < min || inBreak(place, t, minutes)) continue;
    if (spans.filter(([s, e]) => t < e && t + need > s).length < cap) out.push(hhmm(t));
  }
  return out;
}

// ---------- чат за записом ----------

// Переписка клієнта й точки про конкретний оплачений візит: «приїду з причепом», «можна раніше?».
// from: client, biz або sys (подія: перенесення, кошторис). Непрочитане позначаємо для іншої сторони.
export function chatPost(b, from, text, notify = from === 'client' ? 'biz' : 'client') {
  b.chat = [...(b.chat ?? []), { from, text, at: Date.now() }];
  if (notify === 'biz' || notify === 'both') b.chatUnreadBiz = true;
  if (notify === 'client' || notify === 'both') b.chatUnreadClient = true;
}
export const CLIENT_QUICK = ['Можна приїхати раніше?', 'Приїду з причепом', 'Залишу ключі адміністратору', 'Потрібен чек для компанії'];
export const BIZ_QUICK = ['Так, чекаємо', 'Можна на 30 хв раніше', 'На жаль, ні — лише у ваш час', 'Майстер передзвонить'];

// ---------- кошторис і гарантія ----------

// Кошторис СТО: роботи й запчастини з цінами; клієнт погоджує кожен пункт окремо.
// warranty — гарантія в місяцях від дня виконання.
export const ITEM_KIND = { work: 'Робота', part: 'Запчастина' };
export const itemSum = (x) => Math.round(x.qty * x.price);
export const estimateTotal = (items, status) => items.filter((x) => !status || x.status === status).reduce((a, x) => a + itemSum(x), 0);
export function warrantyUntil(iso, months) {
  const d = parseDate(iso);
  d.setMonth(d.getMonth() + months);
  return isoDate(d);
}

// ---------- гарячі вікна ----------

// Два види знижок на час: гаряче вікно на конкретну дату (date) і щотижневі «щасливі години»
// (days — дні тижня, 0 — понеділок). Знижка діє на запис, що починається у вікні.
const allDeals = (placeId) => (store.peek('biz.deals', {})[placeId] ?? []).filter((d) => d.active !== false);
export const dealsOf = (placeId) => allDeals(placeId).filter((d) => (d.days ? !d.until || d.until >= opsToday() : d.date >= opsToday()));
export const weeklyDealsOf = (placeId) => dealsOf(placeId).filter((d) => d.days);

// Усі знижки, що діють на дату, — разові й щотижневі, з датою для зручності.
export function dealsOn(placeId, date) {
  const wd = weekdayOf(date);
  return dealsOf(placeId).filter((d) => (d.days ? d.days.includes(wd) : d.date === date)).map((d) => ({ ...d, date }))
    .sort((a, b) => a.from - b.from);
}

export function dealAt(placeId, date, time) {
  const t = toMin(time);
  return dealsOn(placeId, date).filter((d) => t >= d.from && t < d.to).sort((a, b) => b.pct - a.pct)[0] ?? null;
}

export const dealPrice = (price, pct) => Math.round((price * (100 - pct)) / 100 / 10) * 10;
// Чи діє знижка на послугу: на всі послуги або лише на обрані точкою.
export const dealCovers = (deal, serviceId) => !!deal && (!deal.services?.length || deal.services.includes(serviceId));

const OPS_WD = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Нд'];
// «Пн–Пт», «Сб–Нд», «Щодня» або перелік днів.
export function daysText(days) {
  const d = [...days].sort((a, b) => a - b);
  if (d.length === 7) return 'Щодня';
  const runs = [];
  for (const x of d) {
    const last = runs.at(-1);
    if (last && x === last[1] + 1) last[1] = x; else runs.push([x, x]);
  }
  return runs.map(([a, z]) => (a === z ? OPS_WD[a] : z === a + 1 ? `${OPS_WD[a]}, ${OPS_WD[z]}` : `${OPS_WD[a]}–${OPS_WD[z]}`)).join(', ');
}

// Гарячі пропозиції для каталогу: знижки на сьогодні й завтра, у яких ще є вільний час.
export function hotDeals(bookings) {
  const out = [];
  const days = [opsToday(), isoDate(new Date(Date.now() + 864e5))];
  for (const p of PLACES.filter(isListed)) {
    const minMin = Math.min(...p.services.map((s) => s.min));
    for (const date of days) {
      for (const d of dealsOn(p.id, date)) {
        const free = openStarts(p, date, minMin, bookings).filter((x) => toMin(x) >= d.from && toMin(x) < d.to);
        if (free.length) out.push({ place: p, deal: d, free });
      }
    }
  }
  return out.sort((a, b) => (a.deal.date + opsPad(a.deal.from)).localeCompare(b.deal.date + opsPad(b.deal.from)));
}
const opsPad = (n) => String(n).padStart(4, '0');

// ---------- жива черга ----------

// Черга на сьогодні: авто, що чекають, і ті, що вже в боксі.
export function queueOf(placeId) {
  const day = opsToday();
  return (store.peek('biz.queue', {})[placeId] ?? []).filter((q) => q.day === day);
}
export const queueEnabled = (p) => store.peek('biz.queueOn', {})[p.id] ?? p.cats[0] === 'wash';

export function saveQueue(placeId, list) {
  const all = store.get('biz.queue', {});
  all[placeId] = list;
  store.set('biz.queue', all);
}

// Оцінка: хто коли потрапить у бокс. Авто в роботі займають бокс до кінця; записи на сьогодні
// мають пріоритет, якщо машина з черги не встигне до їхнього початку. Повертає час для кожного
// з тих, хто чекає, і для нового авто тривалістю minutes.
export function queueEstimate(place, bookings, minutes = 30) {
  const now = opsNow();
  const list = queueOf(place.id);
  const free = Array(place.boxes).fill(now);
  const working = list.filter((q) => q.status === 'working');
  for (const q of working) {
    const i = free.indexOf(Math.min(...free));
    free[i] = Math.max(now, toMin(q.startedTime) + q.minutes);
  }
  const day = opsToday();
  const books = bookings.filter((b) => b.placeId === place.id && b.date === day && BLOCKING.includes(b.state))
    .map((b) => [toMin(b.time), b.minutes]).filter(([s, m]) => s + m > now).sort((a, b) => a[0] - b[0]);
  // Записи, що вже йдуть, займають бокс до кінця.
  while (books.length && books[0][0] <= now) {
    const [s, m] = books.shift();
    const i = free.indexOf(Math.min(...free));
    free[i] = Math.max(free[i], s + m);
  }
  const waiting = list.filter((q) => q.status === 'waiting').sort((a, b) => a.joinedAt - b.joinedAt);
  const eta = new Map();
  const take = (dur) => {
    for (;;) {
      const i = free.indexOf(Math.min(...free));
      const t = free[i];
      if (books.length && books[0][0] < t + dur) {
        const [s, m] = books.shift();
        free[i] = Math.max(t, s) + m;
        continue;
      }
      free[i] = t + dur;
      return t;
    }
  };
  for (const q of waiting) eta.set(q.id, take(q.minutes));
  const next = take(minutes);
  return { ahead: waiting.length, working: working.length, eta, waitMin: Math.max(0, next - now) };
}

// ---------- лист очікування ----------

// Клієнт просить повідомити, якщо на дату звільниться час у вказаному проміжку.
// Перевіряємо щоразу, коли хтось скасовує запис чи відкриває застосунок або панель.
export function checkWaitlist(bookings) {
  const list = store.get('waitlist', []);
  const sent = [];
  for (const w of list) {
    if (w.status !== 'active') continue;
    if (w.date < opsToday()) { w.status = 'expired'; continue; }
    const p = opsPlace(w.placeId);
    if (!p) continue;
    const slot = openStarts(p, w.date, w.minutes, bookings).find((t) => toMin(t) >= w.from && toMin(t) + w.minutes <= w.to);
    if (!slot) continue;
    Object.assign(w, { status: 'notified', notifiedAt: Date.now(), slot });
    sent.push({
      placeId: p.id, clientKey: w.clientKey, channel: 'app', kind: 'waitlist',
      text: `${p.name}: звільнився час ${parseDate(w.date).toLocaleDateString('uk-UA', { day: 'numeric', month: 'long' })} о ${slot}. Встигніть записатися!`,
      link: `#/book/${p.id}/${w.date}/${slot}`,
    });
  }
  if (sent.length || list.some((w) => w.status === 'expired')) store.set('waitlist', list);
  if (sent.length) sendMessages(sent);
  return sent.length;
}

// ---------- абонементи й сертифікати ----------

export const PASS_KIND = { sub: 'Абонемент', cert: 'Подарунковий сертифікат' };
export const passesOf = (placeId) => ({ plans: [], sold: [], ...store.peek('biz.passes', {})[placeId] });

export function savePasses(placeId, patch) {
  const all = store.get('biz.passes', {});
  all[placeId] = { ...passesOf(placeId), ...patch };
  store.set('biz.passes', all);
}

export function passCode() {
  const abc = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const part = () => Array.from({ length: 4 }, () => abc[Math.floor(Math.random() * abc.length)]).join('');
  return `CC-${part()}-${part()}`;
}

// Продаж абонемента чи сертифіката: точка отримує гроші одразу (через CARCAR — після 48 год).
export function sellPass(placeId, plan, buyer) {
  const valid = new Date();
  valid.setDate(valid.getDate() + (plan.validDays ?? (plan.kind === 'sub' ? 30 : 365)));
  const sold = {
    id: uid(), planId: plan.id, kind: plan.kind, name: plan.name, price: plan.price, code: passCode(),
    services: plan.services ?? [], visitsLeft: plan.kind === 'sub' ? plan.visits : null, visits: plan.visits ?? null,
    balance: plan.kind === 'cert' ? plan.amount ?? plan.price : null, validUntil: isoDate(valid), soldAt: Date.now(),
    history: [], ...buyer,
  };
  savePasses(placeId, { sold: [...passesOf(placeId).sold, sold] });
  return sold;
}

export const passActive = (s) => s.validUntil >= opsToday() && (s.kind === 'sub' ? s.visitsLeft > 0 : s.balance > 0);
export const passLeft = (s) => (s.kind === 'sub' ? `${s.visitsLeft} з ${s.visits} ${plural(s.visits, 'візиту', 'візитів', 'візитів')}` : `${s.balance.toLocaleString('uk-UA')} ₴`);

// Абонементи клієнта в точці, що покривають хоч одну з обраних послуг.
export function usableSubs(placeId, keys, serviceIds) {
  return passesOf(placeId).sold.filter((s) => s.kind === 'sub' && passActive(s) && keys.includes(s.clientKey)
    && serviceIds.some((id) => !s.services.length || s.services.includes(id)));
}

export function findCert(placeId, code) {
  const c = String(code ?? '').trim().toUpperCase();
  return passesOf(placeId).sold.find((s) => s.kind === 'cert' && s.code === c) ?? null;
}

// Списати з абонемента чи сертифіката; amount — сума, яку покриваємо. Повертає запис для бронювання.
export function redeemPass(placeId, soldId, amount, bookingId) {
  const data = passesOf(placeId);
  const sold = data.sold.map((s) => {
    if (s.id !== soldId) return s;
    const h = [...s.history, { at: Date.now(), bookingId, amount }];
    return s.kind === 'sub' ? { ...s, visitsLeft: s.visitsLeft - 1, history: h } : { ...s, balance: s.balance - amount, history: h };
  });
  savePasses(placeId, { sold });
  return { soldId, amount };
}

// Повернути візит чи суму, якщо запис скасовано вчасно.
export function restorePass(placeId, use) {
  if (!use) return;
  const data = passesOf(placeId);
  const sold = data.sold.map((s) => (s.id !== use.soldId ? s : s.kind === 'sub'
    ? { ...s, visitsLeft: s.visitsLeft + 1, history: [...s.history, { at: Date.now(), amount: -use.amount, note: 'повернення' }] }
    : { ...s, balance: s.balance + use.amount, history: [...s.history, { at: Date.now(), amount: -use.amount, note: 'повернення' }] }));
  savePasses(placeId, { sold });
}

// ---------- шинний готель ----------

export const SEASONS = { winter: 'Зимові', summer: 'Літні', all: 'Всесезонні' };
export const TIRE_STATE = ['Нові', 'Добрий', 'Задовільний', 'Потребують заміни'];
export const tiresOf = (placeId) => store.peek('biz.tires', {})[placeId] ?? [];

export function saveTires(placeId, list) {
  const all = store.get('biz.tires', {});
  all[placeId] = list;
  store.set('biz.tires', all);
}

// Сезон перевзування в Києві: з 1 жовтня до 30 листопада — на зимові, з 15 березня до 30 квітня — на літні.
export function seasonDue(date = new Date()) {
  const m = date.getMonth() + 1;
  const d = date.getDate();
  if (m === 10 || m === 11) return 'winter';
  if ((m === 3 && d >= 15) || m === 4) return 'summer';
  return null;
}

// Комплект на зберіганні, який пора забрати й поставити.
export const tireDue = (t, date = new Date()) => t.status === 'stored' && t.season === seasonDue(date);

export function myTires(keys) {
  return PLACES.flatMap((p) => tiresOf(p.id).filter((t) => t.status === 'stored' && keys.includes(t.clientKey)).map((t) => ({ ...t, place: p })));
}

export const clientKeyOf = (phone, car) => phoneKey(phone) ?? (car ? `car:${car}` : null);
