// Панель для бізнесу CARCAR: журнал по боксах, CRM клієнтів, прайс, фінанси, відгуки й аналітика.
// Працює з тими самими даними, що й застосунок клієнта (спільне сховище на цьому пристрої):
// запис, внесений тут, займає бокс у застосунку, а прайс і години одразу бачать клієнти.
import { CATEGORIES, CAR_CLASSES, PLACES, PAYMENT, SERVICE_TEMPLATES, DISTRICTS } from './data.js';
import {
  store, icon, esc, uah, pad, hhmm, toMin, isoDate, parseDate, uid, placeById, plural, duration, dayLabel, rating,
  fmtTime, fmtDate, hash, bookingStart, hoursFor, scheduleOf, widestRange, inBreak, rangeText, WEEKDAYS, WEEKDAY_NAMES,
  weekdayOf, phoneKey, offersOf, offerAsService, EXPENSE_CATS, PAY_METHODS, expensesIn, serviceCat, catById, shrinkPhoto, applyOverrides, saveOverride,
  ACTIVE, BLOCKING, HOUR, reliability, isCarcar, price, complete, isFrozen, balanceFor, settleAll, ratingFor,
  PARTNER_STATUS, partnerOf, savePartner, payoutReady, maskIban, commissionFor, addCustomPlace, checkBizLogin, numberBookings, bookingNo, findByNo, ticketPhotos,
  ROLES, staffOf, workBase, POWER, powerOf, setPower, TICKET_TOPICS, PLACE_TOPICS, TICKET_STATUS, ticketsAll, openTicket, ticketReply, setTicket, mobileOn, spanOf, MOBILE_ROAD,
  enterView,
} from './core.js';
import {
  CHANNELS, sendMessages, viberLink, telegramLink, dealsOf, weeklyDealsOf, daysText, queueOf, queueEnabled, saveQueue, queueEstimate, checkWaitlist,
  PASS_KIND, passesOf, savePasses, sellPass, passActive, passLeft, usableSubs, findCert, redeemPass, restorePass,
  clientKeyOf,
  chatPost, chatTimeline, readMessages, msgPreview, touchPresence, PRESENCE_KEY, BIZ_QUICK, ITEM_KIND, itemSum, estimateTotal,
} from './ops.js';
import { ENTITY, TAX, DOCS, OFFER, codeValid, ibanValid, ibanBank, normIban, formatIban, missingSteps, offerHtml } from './partners.js';
import { drawColumns, legend, tableView, hbars, hideTip } from './charts.js';

// ---------- дані ----------

let bookings, payouts, reviews, crm, offers, expenses, requests;

function load() {
  bookings = store.get('bookings', []);
  payouts = store.get('payouts', []);
  reviews = store.get('reviews', []);
  // Картки клієнтів: { placeId: { clientKey: { name, phone, cars, email, note, tags } } }
  crm = store.get('biz.clients', {});
  offers = store.get('biz.offers', []); // персональні послуги й ціни
  expenses = store.get('biz.expenses', []); // витрати: разові й щомісячні
  requests = store.get('requests', []); // запити клієнтів «не знайшов послугу»
  applyOverrides();
  if (settleAll(bookings)) save();
}

function save() {
  numberBookings(bookings);
  store.set('bookings', bookings);
  store.set('payouts', payouts);
  store.set('reviews', reviews);
  store.set('biz.clients', crm);
  store.set('biz.offers', offers);
  store.set('biz.expenses', expenses);
  store.set('requests', requests);
}

load();

const ui = { place: store.get('partner', null), reqFilter: 'open', period: 30, finPeriod: 30, expPeriod: 30, clients: 'all', q: '', sort: 'last', svcDraft: null, imp: { type: 'clients', text: '', rows: null, map: {}, result: null } };
if (!placeById(ui.place)) ui.place = PLACES[0].id;

// Вхід у кабінет: логін і пароль видає адміністрація CARCAR після схвалення заявки.
// Сесія акаунта привʼязана до однієї точки; демо-сесія (вигадані дані) — до всіх демо-точок.
const session = () => store.get('biz.session', null);
const lockedPlace = () => session()?.placeId ?? null;
if (lockedPlace() && placeById(lockedPlace())) ui.place = lockedPlace();

function viewBizLogin(error = '') {
  return `<section class="biz-login" aria-label="Вхід у кабінет">
    <div class="biz-login-card">
      <a class="login-brand" href="index.html" aria-label="CARCAR для бізнесу"><svg width="44" height="44" viewBox="0 0 32 32" aria-hidden="true"><rect width="32" height="32" rx="9" fill="#c8402b"/><path d="M15 10.5a6 6 0 1 0 0 11" fill="none" stroke="#fff" stroke-width="3" stroke-linecap="round"/><path d="M24 10.5a6 6 0 1 0 0 11" fill="none" stroke="#fff" stroke-width="3" stroke-linecap="round" opacity=".6"/></svg><span aria-hidden="true"><b><span class="c1">CAR</span><span class="c2">CAR</span></b><small>для бізнесу</small></span></a>
      <h1>Вхід у кабінет мийки</h1>
      <p class="page-sub">Логін і пароль надсилає адміністрація CARCAR після схвалення заявки.</p>
      <form class="stack" id="biz-login-form" style="gap:12px">
        <label class="field"><span>Логін</span><input name="login" required autocomplete="username" autocapitalize="none" spellcheck="false"></label>
        <label class="field"><span>Пароль</span><input name="password" type="password" required autocomplete="current-password"></label>
        ${error ? `<p class="notice warn" role="alert" style="margin:0">${esc(error)}</p>` : ''}
        <button class="btn primary" type="submit">Увійти</button>
      </form>
      <p class="small muted" style="margin:0">Ще не з CARCAR? <a href="index.html#/business">Умови й реєстрація мийки</a></p>
      <button class="btn" type="button" data-action="demo-login">Переглянути демо-кабінет (вигадані дані)</button>
    </div>
  </section>`;
}

const place = () => placeById(ui.place);
const own = () => bookings.filter((b) => b.placeId === ui.place);
const $ = (sel, root = document) => root.querySelector(sel);
const today = () => isoDate(new Date());
const addDays = (iso, n) => { const d = parseDate(iso); d.setDate(d.getDate() + n); return isoDate(d); };
const isPast = (b) => bookingStart(b).getTime() + b.minutes * 60000 <= Date.now();
// Запис уже відбувся для аналітики: час минув або його вже позначили виконаним.
const happened = (b) => b.state === 'completed' || isPast(b);
const pct = (v) => `${Math.round(v)}%`;
const pctText = (k) => `${(k * 100).toLocaleString('uk-UA', { maximumFractionDigits: 1 })}%`;
const daysWord = (n) => plural(n, 'день', 'дні', 'днів');

function toast(text) {
  const el = $('#toast');
  el.textContent = text;
  el.classList.add('show');
  clearTimeout(toast.t);
  toast.t = setTimeout(() => el.classList.remove('show'), 2600);
}

// Виручка точки із запису: повна ціна через CARCAR (включно з бонусом, який доплачує CARCAR),
// оплата на місці або компенсація за пізнє скасування чи неявку.
function revenue(b) {
  if (b.state === 'completed') return isCarcar(b) ? price(b) : b.paid;
  if (isCarcar(b) && (b.state === 'cancelled' || b.state === 'noshow')) return b.placeAmount ?? 0;
  return 0;
}

const CHANNEL = { carcar: 'CARCAR', phone: 'Телефон', walkin: 'З вулиці', other: 'Інше / імпорт' };
const channelOf = (b) => b.channel ?? 'carcar';
const channelPill = (b) => `<span class="pill ${isCarcar(b) ? 'carcar' : 'cash'}"><i></i>${CHANNEL[channelOf(b)]}</span>`;

const STATUS = {
  paid: ['Оплачено в CARCAR', 'carcar'],
  booked: ['Записано', 'cash'],
  done: ['Чекає підтвердження клієнта', 'warn'],
  dispute: ['Спір', 'warn'],
  completed: ['Виконано', 'ok'],
  cancelled: ['Скасовано', 'muted'],
  noshow: ['Неявка', 'muted'],
  refunded: ['Повернено клієнту', 'muted'],
};
const statusPill = (b) => `<span class="pill ${STATUS[b.state][1]}">${STATUS[b.state][0]}</span>`;

// Клієнт: за телефоном (CRM), за авто з гаража (CARCAR) або окремий анонімний запис.
// Надійність клієнта CARCAR за всіма його записами: точка бачить, якщо він часто скасовує чи не приходить.
function relNotice(b) {
  if (!isCarcar(b)) return '';
  // Клієнт застосунку без телефону в демо — це «цей пристрій».
  const who = (x) => (x.clientPhone ? phoneKey(x.clientPhone) : 'device');
  const r = reliability(bookings.filter((x) => isCarcar(x) && who(x) === who(b)));
  if (r.level === 'ok') return '';
  const parts = [r.cancels && `${r.cancels} ${plural(r.cancels, 'скасування', 'скасування', 'скасувань')}`, r.moves && `${r.moves} ${plural(r.moves, 'перенесення', 'перенесення', 'перенесень')}`, r.noshows && `${r.noshows} ${plural(r.noshows, 'неявка', 'неявки', 'неявок')}`].filter(Boolean);
  return `<p class="notice rel-note">${icon('shield', 18)}<span><b>Клієнт часто змінює плани</b>
    ${parts.join(' · ')} за останній місяць. Варто нагадати про візит напередодні.</span></p>`;
}

function clientKey(b) {
  if (b.clientPhone) return phoneKey(b.clientPhone);
  if (b.carId) return `car:${b.car}`;
  return `anon:${b.id}`;
}
const clientName = (b) => b.clientName || 'Клієнт CARCAR';
const clientMeta = (key) => ({ note: '', tags: [], ...crm[ui.place]?.[key] });
function setMeta(key, patch) {
  crm[ui.place] = { ...crm[ui.place], [key]: { ...clientMeta(key), ...patch } };
}

// ---------- аналітика ----------

function rangeOf(n, back = 0) {
  const end = addDays(today(), -back * n);
  return [addDays(end, -(n - 1)), end];
}
const inRange = (b, [s, e]) => b.date >= s && b.date <= e;

// Скільки хвилин боксів було доступно за проміжок за графіком: робочі години мінус перерва.
function capacity(p, [from, to]) {
  const brk = scheduleOf(p).brk;
  let total = 0;
  for (let d = from; d <= to; d = addDays(d, 1)) {
    const h = hoursFor(p, d);
    if (h) total += (h[1] - h[0] - (brk ? Math.max(0, Math.min(h[1], brk[1]) - Math.max(h[0], brk[0])) : 0)) * p.boxes;
  }
  return total;
}

function statsFor(range) {
  const p = place();
  const list = own().filter((b) => inRange(b, range) && happened(b));
  const done = list.filter((b) => b.state === 'completed');
  const rev = list.reduce((a, b) => a + revenue(b), 0);
  const viaCarcar = list.filter(isCarcar).reduce((a, b) => a + revenue(b), 0);
  const lost = list.filter((b) => b.state === 'cancelled' || b.state === 'noshow').length;
  const busy = list.filter((b) => b.state !== 'cancelled' && b.state !== 'refunded').reduce((a, b) => a + b.minutes, 0);
  const first = new Map();
  for (const b of own()) {
    if (b.state !== 'completed') continue;
    const k = clientKey(b);
    if (!first.has(k) || b.date < first.get(k)) first.set(k, b.date);
  }
  const keys = new Set(done.map(clientKey));
  const fresh = [...keys].filter((k) => first.get(k) >= range[0]).length;
  return {
    rev, viaCarcar, cash: rev - viaCarcar, count: done.length,
    avg: done.length ? done.reduce((a, b) => a + revenue(b), 0) / done.length : 0,
    lostPct: list.length ? (lost / list.length) * 100 : 0,
    load: ((busy / capacity(p, range)) * 100) || 0,
    clients: keys.size, fresh, returning: keys.size - fresh,
  };
}

function delta(cur, prev, goodWhenUp = true, unit = '%') {
  if (!prev) return `<span class="delta flat">немає даних за попередній період</span>`;
  const d = unit === 'pp' ? cur - prev : ((cur - prev) / prev) * 100;
  if (Math.abs(d) < 0.5) return `<span class="delta flat">без змін</span>`;
  const good = d > 0 === goodWhenUp;
  const txt = `${d > 0 ? '+' : '−'}${Math.abs(Math.round(d))}${unit === 'pp' ? ' п.п.' : '%'}`;
  return `<span class="delta ${good ? 'up' : 'down'}">${d > 0 ? '▲' : '▼'} ${txt}<span class="sr-only"> проти попереднього періоду</span></span>`;
}

// ---------- графіки ----------

// Специфікації графіків поточного екрана; малюємо після вставки розмітки, бо потрібна ширина.
let charts = {};

function mountCharts() {
  for (const [id, spec] of Object.entries(charts)) {
    const el = document.getElementById(id);
    if (el) drawColumns(el, spec);
  }
}

let resizeT;
window.addEventListener('resize', () => { clearTimeout(resizeT); resizeT = setTimeout(mountCharts, 120); });

// ---------- огляд ----------

// Авто й номер без повторів (у записах CARCAR номер уже є в назві авто).
const carText = (b) => {
  const car = b.car && b.car !== CAR_CLASSES[b.cls] ? b.car : CAR_CLASSES[b.cls];
  return b.plate && !car.includes(b.plate) ? `${car} · ${b.plate}` : car;
};

// «Сьогодні» — перше, що бачить адміністратор: хто зараз у боксах, хто наступний і що чекає на відповідь.
function todayPanel() {
  const p = place();
  const d = today();
  const now = Date.now();
  const list = own().filter((b) => b.date === d && !['cancelled', 'refunded'].includes(b.state)).sort((a, b) => toMin(a.time) - toMin(b.time));
  const start = (b) => bookingStart(b).getTime();
  const end = (b) => start(b) + b.minutes * 60000;
  const inWork = list.filter((b) => BLOCKING.includes(b.state) && start(b) <= now && end(b) > now);
  const next = list.filter((b) => BLOCKING.includes(b.state) && start(b) > now);
  const late = list.filter((b) => BLOCKING.includes(b.state) && end(b) <= now && b.state !== 'done');
  const done = list.filter((b) => b.state === 'completed');
  const hours = hoursFor(p, d);
  const busy = list.filter((b) => BLOCKING.includes(b.state) || b.state === 'completed').reduce((a, b) => a + b.minutes, 0);
  const freeH = hours ? Math.max(0, capacity(p, [d, d]) - busy) / 60 : 0;
  const attention = [
    [own().filter((b) => b.chatUnreadBiz).length, 'нових повідомлень у чатах', '#/requests', 'chat'],
    [ownRequests().filter((r) => reqState(r) === 'new').length, 'запитів про послуги без відповіді', '#/requests', 'chat'],
    [reviews.filter((r) => r.placeId === ui.place && !r.reply).length, 'відгуків без відповіді', '#/reviews', 'star'],
    [late.length, 'записів, час яких минув — закрийте їх', null, 'clock'],
  ].filter(([n]) => n);
  const row = (b, kind) => `<li class="today-row ${kind}">
      <span class="t-time">${b.time}<small>${hhmm(toMin(b.time) + b.minutes)}</small></span>
      <span class="t-main"><b>${esc(clientName(b))}</b><small>${esc(carText(b))}</small>
        <small>${esc(b.services.join(', '))}</small>
        <span class="t-tags">${statusPill(b)}${etaText(b) ? `<span class="pill ok">${etaText(b)}</span>` : ''}${b.chatUnreadBiz ? '<span class="pill warn">нове повідомлення</span>' : ''}${b.mobile ? `<span class="pill">${icon('carSide', 12)} виїзд</span>` : ''}</span></span>
      <span class="t-act">
        ${b.clientPhone ? `<a class="btn icon-only" href="tel:${esc(b.clientPhone.replace(/[^+\d]/g, ''))}" aria-label="Зателефонувати ${esc(clientName(b))}">${icon('phone', 18)}</a>` : ''}
        <button class="btn" data-action="open-booking" data-id="${b.id}" aria-label="Відкрити запис ${b.time} ${esc(clientName(b))}">Відкрити</button>
      </span></li>`;
  const rows = [...late.map((b) => row(b, 'late')), ...inWork.map((b) => row(b, 'now')), ...next.slice(0, 6).map((b) => row(b, 'next'))];
  return `<section class="panel today" aria-labelledby="h-today">
    <div class="head"><h2 id="h-today">Сьогодні, ${parseDate(d).toLocaleDateString('uk-UA', { weekday: 'long' })}, ${parseDate(d).toLocaleDateString('uk-UA', { day: 'numeric', month: 'long' })}</h2>
      <a class="btn" href="#/schedule/${d}">${icon('calendar', 18)}Розклад дня</a></div>
    <div class="today-kpis" tabindex="0" role="group" aria-label="Показники дня">
      <span><b>${inWork.length}</b>зараз у роботі</span>
      <span><b>${next.length}</b>ще сьогодні</span>
      <span><b>${done.length}</b>виконано</span>
      <span><b>${hours ? `${(Math.round(freeH * 10) / 10).toLocaleString('uk-UA')} год` : 'вихідний'}</b>вільно в боксах</span>
      <span><b>${uah(done.reduce((a, b) => a + revenue(b), 0))}</b>виручка</span>
    </div>
    ${attention.length ? `<ul class="attention">${attention.map(([n, text, href, ic]) => `<li>${href ? `<a href="${href}">` : '<span>'}${icon(ic, 18)}<b>${n}</b> ${text}${href ? `${icon('chevR', 16)}</a>` : '</span>'}</li>`).join('')}</ul>` : ''}
    ${rows.length ? `<ol class="today-list">${rows.join('')}</ol>${next.length > 6 ? `<p class="small muted">І ще ${next.length - 6} — у <a href="#/schedule/${d}">розкладі</a>.</p>` : ''}`
      : `<p class="muted" style="margin:0">${hours ? 'На сьогодні більше записів немає.' : 'Сьогодні вихідний за графіком.'} <button class="link-btn" data-action="new-booking">Додати запис</button></p>`}
  </section>`;
}

function viewOverview() {
  const p = place();
  if (!own().length) {
    return `<h1>Огляд</h1><p class="page-sub">${esc(p.name)}</p>
      ${todayPanel()}
      <div class="empty-state">${icon('chart', 32)}<h2>Ще немає даних</h2>
        <p>Тут зʼявиться аналітика, щойно будуть записи — з застосунку CARCAR або внесені вами в журнал.
        Щоб подивитися, як це виглядає, заповніть демо-історію за 90 днів.</p>
        <div class="row" style="justify-content:center">
          <button class="btn primary" data-action="demo-fill">Заповнити демо-історію</button>
          <button class="btn" data-action="new-booking">Новий запис</button>
        </div></div>`;
  }
  const n = ui.period;
  const cur = statsFor(rangeOf(n));
  const prev = statsFor(rangeOf(n, 1));
  const r = ratingFor(p.id, reviews);
  const [from, to] = rangeOf(n);

  // Виручка по днях: через CARCAR і на місці.
  const days = [];
  for (let d = from; d <= to; d = addDays(d, 1)) days.push(d);
  const byDay = days.map((d) => {
    const list = own().filter((b) => b.date === d && happened(b));
    const carcar = list.filter(isCarcar).reduce((a, b) => a + revenue(b), 0);
    const cash = list.filter((b) => !isCarcar(b)).reduce((a, b) => a + revenue(b), 0);
    const date = parseDate(d);
    return { label: dayLabel(d), short: `${date.getDate()}.${pad(date.getMonth() + 1)}`, values: [carcar, cash] };
  });

  // Записи за годинами початку (виконані за період).
  const doneInRange = own().filter((b) => inRange(b, [from, to]) && b.state === 'completed');
  const [o, c] = widestRange(p);
  const hours = [];
  for (let h = Math.floor(o / 60); h < Math.ceil(c / 60); h++) hours.push(h);
  const byHour = hours.map((h) => ({ label: `${pad(h)}:00–${pad(h + 1)}:00`, short: `${h}`, values: [doneInRange.filter((b) => Math.floor(toMin(b.time) / 60) === h).length] }));

  // Дні тижня: середня виручка за день.
  const WD = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Нд'];
  const wdNames = ['понеділок', 'вівторок', 'середа', 'четвер', 'пʼятниця', 'субота', 'неділя'];
  const byWd = WD.map((w, i) => {
    const ds = days.filter((d) => (parseDate(d).getDay() + 6) % 7 === i);
    const sum = byDay.filter((x, k) => (parseDate(days[k]).getDay() + 6) % 7 === i).reduce((a, x) => a + x.values[0] + x.values[1], 0);
    return { label: `Середня виручка, ${wdNames[i]}`, short: w, values: [ds.length ? Math.round(sum / ds.length) : 0] };
  });

  // Топ послуг за виручкою.
  const svc = new Map();
  for (const b of doneInRange) {
    const each = revenue(b) / Math.max(1, b.services.length);
    for (const s of b.services) svc.set(s, (svc.get(s) ?? 0) + each);
  }
  const top = [...svc].sort((a, b) => b[1] - a[1]).slice(0, 6).map(([name, value]) => ({ name, value: Math.round(value) }));

  // Канали: скільки виконаних записів прийшло з кожного.
  const chans = Object.keys(CHANNEL).map((k) => ({ name: CHANNEL[k], value: doneInRange.filter((b) => channelOf(b) === k).length }));

  charts = {
    'ch-rev': { title: `Виручка по днях за ${n} ${daysWord(n)}`, cats: byDay, series: ['Через CARCAR', 'На місці (каса)'], fmt: uah },
    'ch-hour': { title: 'Виконані записи за годиною початку', cats: byHour, series: ['Записів'], fmt: (v) => String(v), height: 180 },
    'ch-wd': { title: 'Середня виручка за день тижня', cats: byWd, series: ['Середня виручка'], fmt: uah, height: 180 },
  };

  const sh = (x) => `${Math.round((x / Math.max(1, cur.rev)) * 100)}%`;

  return `<h1>Огляд</h1><p class="page-sub">${esc(p.name)} · записи з CARCAR і з вашого журналу</p>
    ${todayPanel()}
    <div class="filters">
      <div class="seg" role="group" aria-label="Період">
        ${[7, 30, 90].map((d) => `<button data-action="period" data-n="${d}" aria-pressed="${d === n}">${d} ${daysWord(d)}</button>`).join('')}
      </div>
      <span class="small muted">${fmtDate(from)} — ${fmtDate(to)}</span>
    </div>
    ${overviewAlerts()}
    <section class="kpis" aria-label="Показники за період">
      <div class="kpi hero"><span class="label">Виручка</span><span class="value">${uah(cur.rev)}</span>${delta(cur.rev, prev.rev)}
        <span class="kpi-note">через CARCAR ${uah(cur.viaCarcar)} (${sh(cur.viaCarcar)}) · на місці ${uah(cur.cash)}</span></div>
      <div class="kpi"><span class="label">Виконано записів</span><span class="value">${cur.count}</span>${delta(cur.count, prev.count)}</div>
      <div class="kpi"><span class="label">Середній чек</span><span class="value">${uah(Math.round(cur.avg))}</span>${delta(cur.avg, prev.avg)}</div>
      <div class="kpi"><span class="label">Завантаженість боксів</span><span class="value">${pct(cur.load)}</span>${delta(cur.load, prev.load, true, 'pp')}</div>
      <div class="kpi"><span class="label">Клієнтів</span><span class="value">${cur.clients}</span><span class="kpi-note">нових ${cur.fresh} · повторних ${cur.returning}</span></div>
      <div class="kpi"><span class="label">Скасування й неявки</span><span class="value">${pct(cur.lostPct)}</span>${delta(cur.lostPct, prev.lostPct, false, 'pp')}</div>
      <div class="kpi"><span class="label">Рейтинг</span><span class="value">${r.count ? rating(r.avg) : '—'}</span><span class="kpi-note">${r.count ? `${r.count} ${plural(r.count, 'відгук', 'відгуки', 'відгуків')}` : 'ще немає відгуків'}</span></div>
    </section>

    <div style="margin-top:16px">
      <section class="panel" aria-labelledby="h-rev">
        <h2 id="h-rev">Виручка по днях</h2>
        <p class="sub">Виконані замовлення й компенсації за неявки</p>
        ${legend(['Через CARCAR', 'На місці (каса)'])}
        <div class="chart" id="ch-rev"></div>
        ${tableView(['День', 'Через CARCAR', 'На місці', 'Разом'], byDay.map((x) => [x.label, uah(x.values[0]), uah(x.values[1]), uah(x.values[0] + x.values[1])]))}
      </section>
    </div>

    <div class="grid-2" style="margin-top:16px">
      <section class="panel" aria-labelledby="h-hour">
        <h2 id="h-hour">Пікові години</h2><p class="sub">Виконані записи за годиною початку</p>
        <div class="chart" id="ch-hour"></div>
        ${tableView(['Година', 'Записів'], byHour.map((x) => [x.label, String(x.values[0])]))}
      </section>
      <section class="panel" aria-labelledby="h-wd">
        <h2 id="h-wd">Дні тижня</h2><p class="sub">Середня виручка за день</p>
        <div class="chart" id="ch-wd"></div>
        ${tableView(['День', 'Середня виручка'], byWd.map((x) => [x.short, uah(x.values[0])]))}
      </section>
      <section class="panel" aria-labelledby="h-top">
        <h2 id="h-top">Топ послуг</h2><p class="sub">За виручкою</p>
        ${top.length ? hbars(top, uah) : '<p class="muted">Немає виконаних записів за період.</p>'}
      </section>
      <section class="panel" aria-labelledby="h-ch">
        <h2 id="h-ch">Звідки клієнти</h2><p class="sub">Виконані записи за каналом</p>
        ${hbars(chans, (v) => String(v))}
      </section>
    </div>`;
}

// Що варто зробити сьогодні: закупівля, порожні вікна.
function overviewAlerts() {
  const out = [];
  const low = lowStock();
  if (low.length && can('stock')) out.push(`<a class="queue" href="#/stock">${icon('drop', 20)}Закінчується на складі: ${low.slice(0, 3).map((x) => esc(x.name)).join(', ')}${low.length > 3 ? ` і ще ${low.length - 3}` : ''}</a>`);
  const gaps = emptyWindows(addDays(today(), 1));
  if (gaps.length && !dealsOf(ui.place).some((d) => d.date === addDays(today(), 1))) out.push(`<a class="queue" href="#/deals">${icon('bolt', 20)}Завтра вільно ${hhmm(gaps[0][0])}–${hhmm(gaps[0][1])} — запустіть гаряче вікно</a>`);
  return out.length ? `<div class="queue-row">${out.join('')}</div>` : '';
}

// Що клієнт відповів на нагадування: «Їду» чи «Запізнююсь».
const etaText = (b) => (b.state !== 'paid' ? '' : [b.eta === 'onway' ? 'їде' : '', b.late ? `запізниться на ${b.late} хв` : ''].filter(Boolean).join(', '));

// ---------- розклад ----------

const ROW = 40; // висота 30 хвилин у журналі, px

// Розкладаємо записи дня по боксах: перший вільний бокс на час початку.
function layoutDay(list, boxes) {
  const ends = Array(boxes).fill(-1);
  const placed = [];
  const overflow = [];
  for (const b of [...list].sort((a, c) => a.time.localeCompare(c.time))) {
    const s = toMin(b.time);
    const i = ends.findIndex((e) => e <= s);
    if (i === -1) { overflow.push(b); continue; }
    ends[i] = s + b.minutes;
    placed.push([b, i]);
  }
  return { placed, overflow };
}

function viewSchedule(day = today()) {
  const p = place();
  const hours = hoursFor(p, day);
  const [o, c] = hours ?? widestRange(p);
  const brk = scheduleOf(p).brk;
  // Майстер бачить лише свої записи.
  const mineOnly = me().role === 'master';
  const list = own().filter((b) => b.date === day && b.state !== 'cancelled' && b.state !== 'refunded' && (!mineOnly || b.masterId === me().id));
  const waits = store.peek('waitlist', []).filter((w) => w.placeId === ui.place && w.date === day && w.status === 'active');
  // Виїзні записи — окремими колонками бригад: вони не займають бокси.
  const crews = mobileOn(p) || list.some((b) => b.mobile) ? Math.max(1, p.mobile?.crews ?? 1) : 0;
  const { placed, overflow } = layoutDay(list.filter((b) => !b.mobile), p.boxes);
  const road = layoutDay(list.filter((b) => b.mobile).map((b) => ({ ...b, minutes: b.minutes + MOBILE_ROAD, real: b })), crews);
  overflow.push(...road.overflow.map((x) => x.real));
  const cols = p.boxes + crews + (overflow.length ? 1 : 0);
  const height = ((c - o) / 30) * ROW;
  const busy = list.filter((b) => b.state !== 'noshow').reduce((a, b) => a + b.minutes, 0);
  const now = new Date();
  const nowMin = now.getHours() * 60 + now.getMinutes();
  const block = (b) => {
    if (b.real) return block(b.real);
    const top = ((toMin(b.time) - o) / 30) * ROW;
    const h = Math.max(ROW - 4, (b.minutes / 30) * ROW - 4);
    const tone = isPast(b) || b.state === 'completed' || b.state === 'noshow' ? 'past' : isCarcar(b) ? 'carcar' : 'cash';
    const size = h < 40 ? ' tiny' : h < 58 ? ' short' : '';
    return `<button class="slot-block ${tone}${size}" style="top:${top + 2}px;height:${h}px" data-action="open-booking" data-id="${b.id}"
      aria-label="${esc(`${b.time}, ${clientName(b)}, ${b.services.join(', ')}, ${STATUS[b.state][0]}`)}">
      <b>${b.time}–${hhmm(toMin(b.time) + b.minutes)} · ${esc(clientName(b))}</b>
      <span>${esc(b.services.join(', '))}</span>
      <span>${CHANNEL[channelOf(b)]} · ${STATUS[b.state][0]}${masterName(b) ? ` · ${esc(masterName(b))}` : ''}</span>
      ${b.mobile ? `<span>${icon('carSide', 12)} ${esc(b.mobile.address)}</span>` : ''}
      ${etaText(b) ? `<span class="eta">${etaText(b)}</span>` : ''}${b.chatUnreadBiz ? '<span class="eta">нове повідомлення</span>' : ''}${b.moves?.length ? '<span>перенесено</span>' : ''}</button>`;
  };
  const times = [];
  for (let t = o; t <= c; t += 60) times.push(`<span style="top:${((t - o) / 30) * ROW}px">${hhmm(t % 1440)}</span>`);
  const colBg = `background-size:100% ${ROW}px`;
  return `<h1>Розклад</h1><p class="page-sub">${esc(p.name)} · ${p.boxes} ${plural(p.boxes, 'бокс', 'бокси', 'боксів')} · записи з CARCAR і з вашого журналу</p>
    <div class="day-nav">
      <a class="btn" href="#/schedule/${addDays(day, -1)}" aria-label="Попередній день">${icon('chevL', 18)}</a>
      <a class="btn" href="#/schedule/${today()}">Сьогодні</a>
      <a class="btn" href="#/schedule/${addDays(day, 1)}" aria-label="Наступний день">${icon('chevR', 18)}</a>
      <span class="day-title">${dayLabel(day, { weekday: 'long', day: 'numeric', month: 'long' })}</span>
      <label><span class="sr-only">Дата</span><input type="date" id="day-pick" value="${day}"></label>
    </div>
    <div class="day-stats">
      <span>Записів: <b>${list.length}</b></span>
      <span>Графік: <b>${rangeText(hours)}</b>${brk && hours ? `, перерва ${rangeText(brk)}` : ''}</span>
      ${hours ? `<span>Завантаженість: <b>${pct((busy / capacity(p, [day, day])) * 100)}</b></span>` : ''}
      <span>Через CARCAR: <b>${list.filter(isCarcar).length}</b></span>
    </div>
    ${hours ? '' : `<p class="notice warn">За графіком це вихідний день — клієнти не можуть записатися. Змінити графік можна в <a href="#/settings">профілі точки</a>.</p>`}
    <div class="sched" tabindex="0" role="region" aria-label="Журнал по боксах">
      <div class="sched-grid" style="grid-template-columns:64px repeat(${cols}, minmax(150px, 1fr))">
        <div class="sched-col-head"></div>
        ${Array.from({ length: p.boxes }, (_, i) => `<div class="sched-col-head">Бокс ${i + 1}</div>`).join('')}
        ${Array.from({ length: crews }, (_, i) => `<div class="sched-col-head mobile">Виїзд${crews > 1 ? ` ${i + 1}` : ''}</div>`).join('')}
        ${overflow.length ? '<div class="sched-col-head">Понад місткість</div>' : ''}
        <div class="sched-times" style="height:${height}px">${times.join('')}</div>
        ${Array.from({ length: p.boxes }, (_, i) => `<div class="sched-col" data-day="${day}" data-o="${o}" title="Клацніть на вільне місце, щоб додати запис на цей час" style="height:${height}px;${colBg}">
          ${brk && hours ? `<div class="break-block" style="top:${((brk[0] - o) / 30) * ROW}px;height:${((brk[1] - brk[0]) / 30) * ROW}px">Перерва</div>` : ''}
          ${day === today() && nowMin >= o && nowMin <= c ? `<div class="now-line" style="top:${((nowMin - o) / 30) * ROW}px"></div>` : ''}
          ${placed.filter(([, k]) => k === i).map(([b]) => block(b)).join('')}</div>`).join('')}
        ${Array.from({ length: crews }, (_, i) => `<div class="sched-col mobile" style="height:${height}px;${colBg}">
          ${road.placed.filter(([, k]) => k === i).map(([b]) => block(b)).join('')}</div>`).join('')}
        ${overflow.length ? `<div class="sched-col" style="height:${height}px;${colBg}">${overflow.map(block).join('')}</div>` : ''}
      </div>
    </div>
    <p class="small muted sched-hint">${icon('plus', 14)} Клацніть на вільне місце в боксі — відкриється новий запис на цей час.</p>
    <div class="legend-row"><span class="pill carcar"><i></i>Оплачено в CARCAR</span><span class="pill cash"><i></i>Оплата на місці</span><span class="pill muted">Завершені</span>${crews ? `<span class="small muted">Колонка «Виїзд» — бригада в клієнта, плюс ${MOBILE_ROAD} хв на дорогу</span>` : ''}</div>
    ${mineOnly ? '<p class="small muted">Показано лише ваші записи.</p>' : ''}
    ${waits.length ? `<section class="panel" aria-labelledby="h-wait" style="margin-top:16px"><h2 id="h-wait">Лист очікування на цей день</h2>
      <p class="sub">Клієнтам прийде сповіщення, щойно в їхньому проміжку звільниться час.</p>
      <ul class="special-list">${waits.map((w) => `<li><span><b>${esc(w.clientName || 'Клієнт')} · ${hhmm(w.from)}–${hhmm(w.to)}</b><small>${esc(w.services.join(', '))} · ${duration(w.minutes)}${w.phone ? ` · ${esc(w.phone)}` : ''}</small></span></li>`).join('')}</ul>
    </section>` : ''}`;
}

// ---------- клієнти ----------

function clientsList() {
  const map = new Map();
  for (const b of own()) {
    const k = clientKey(b);
    const c = map.get(k) ?? { key: k, name: clientName(b), phone: b.clientPhone ?? '', cars: new Set(), visits: 0, spent: 0, last: '', first: '', upcoming: 0, channels: {}, list: [] };
    c.list.push(b);
    if (b.clientName) c.name = b.clientName;
    if (b.car && b.car !== CAR_CLASSES[b.cls]) c.cars.add(b.car);
    c.channels[channelOf(b)] = (c.channels[channelOf(b)] ?? 0) + 1;
    if (b.state === 'completed') {
      c.visits++;
      c.spent += revenue(b);
      if (b.date > c.last) c.last = b.date;
      if (!c.first || b.date < c.first) c.first = b.date;
    }
    if (BLOCKING.includes(b.state) && !isPast(b)) c.upcoming++;
    map.set(k, c);
  }
  // Клієнти, додані вручну чи імпортовані, — навіть без жодного запису.
  for (const [k, m] of Object.entries(crm[ui.place] ?? {})) {
    if (!map.has(k) && (m.name || m.phone)) map.set(k, { key: k, name: m.name || m.phone, phone: m.phone ?? '', cars: new Set(), visits: 0, spent: 0, last: '', first: '', upcoming: 0, channels: {}, list: [] });
  }
  return [...map.values()].map((c) => {
    const meta = clientMeta(c.key);
    for (const car of meta.cars ?? []) c.cars.add(car);
    // Імпортована історія без суми: враховуємо витрачене з картки клієнта.
    if (!c.visits && meta.visits) Object.assign(c, { visits: meta.visits, spent: meta.spent ?? 0, last: meta.last ?? '' });
    return { ...c, name: meta.name || c.name, phone: c.phone || meta.phone || '', meta, main: Object.entries(c.channels).sort((a, b) => b[1] - a[1])[0]?.[0] ?? 'other' };
  });
}

const daysSince = (iso) => Math.round((parseDate(today()) - parseDate(iso)) / 864e5);
const ago = (iso) => { const n = daysSince(iso); return n === 0 ? 'сьогодні' : n === 1 ? 'вчора' : `${n} ${daysWord(n)} тому`; };
const FILTERS = {
  all: ['Усі', () => true],
  regular: ['Постійні (3+ візити)', (c) => c.visits >= 3],
  new: ['Нові (1 візит)', (c) => c.visits === 1],
  lost: ['Давно не були (45+ днів)', (c) => c.visits > 0 && daysSince(c.last) >= 45 && !c.upcoming],
  vip: ['VIP', (c) => c.meta.tags.includes('VIP')],
};
const TAGS = ['VIP', 'Постійний', 'Корпоративний', 'Не дзвонити'];

function filteredClients() {
  const q = ui.q.trim().toLowerCase();
  const list = clientsList().filter(FILTERS[ui.clients][1]).filter((c) => !q || [c.name, c.phone, ...c.cars].join(' ').toLowerCase().includes(q));
  const by = {
    last: (a, b) => (b.last || '').localeCompare(a.last || ''),
    spent: (a, b) => b.spent - a.spent,
    visits: (a, b) => b.visits - a.visits,
    name: (a, b) => a.name.localeCompare(b.name, 'uk'),
  }[ui.sort];
  return list.sort(by);
}

function clientRows() {
  const list = filteredClients();
  if (!list.length) return '<tr><td colspan="7" class="muted">Нікого не знайдено.</td></tr>';
  return list.map((c) => `<tr class="link-row" data-href="#/clients/${encodeURIComponent(c.key)}">
    <td><a class="row-link" href="#/clients/${encodeURIComponent(c.key)}">${esc(c.name)}</a><small>${esc(c.phone || (c.key.startsWith('car:') ? 'через CARCAR' : '—'))}</small></td>
    <td>${esc([...c.cars].join(', ') || '—')}</td>
    <td class="num">${c.visits}</td>
    <td class="num">${uah(c.spent)}</td>
    <td class="num">${c.visits ? uah(Math.round(c.spent / c.visits)) : '—'}</td>
    <td>${c.last ? `${dayLabel(c.last, { day: 'numeric', month: 'short' })}<small>${ago(c.last)}</small>` : '—'}</td>
    <td>${c.meta.tags.map((t) => `<span class="pill">${esc(t)}</span>`).join(' ')} ${c.upcoming ? '<span class="pill carcar">Записаний</span>' : ''}</td>
  </tr>`).join('');
}

function viewClients() {
  const all = clientsList();
  return `<h1>Клієнти</h1><p class="page-sub">${all.length} ${plural(all.length, 'клієнт', 'клієнти', 'клієнтів')} · з CARCAR і з вашого журналу</p>
    <div class="toolbar-row">
      <label class="search">${icon('search', 20)}<input id="client-q" type="search" placeholder="Імʼя, телефон або авто" aria-label="Пошук клієнтів" value="${esc(ui.q)}"></label>
      <select id="client-sort" class="select" aria-label="Сортування">
        <option value="last" ${ui.sort === 'last' ? 'selected' : ''}>Останній візит</option>
        <option value="spent" ${ui.sort === 'spent' ? 'selected' : ''}>Витрачено</option>
        <option value="visits" ${ui.sort === 'visits' ? 'selected' : ''}>Кількість візитів</option>
        <option value="name" ${ui.sort === 'name' ? 'selected' : ''}>За імʼям</option>
      </select>
      <button class="btn" data-action="export-clients">${icon('download', 18)}Експорт CSV</button>
      <a class="btn" href="#/import">${icon('upload', 18)}Імпорт</a>
      <button class="btn primary" data-action="client-new">${icon('plus', 18)}Новий клієнт</button>
    </div>
    <div class="filters">
      <div class="seg" role="group" aria-label="Сегмент">
        ${Object.entries(FILTERS).map(([k, [label, fn]]) => `<button data-action="client-filter" data-f="${k}" aria-pressed="${ui.clients === k}">${label} · ${all.filter(fn).length}</button>`).join('')}
      </div>
    </div>
    <div class="table-wrap" tabindex="0" role="region" aria-label="Таблиця клієнтів"><table class="t">
      <thead><tr><th>Клієнт</th><th>Авто</th><th class="num">Візитів</th><th class="num">Витрачено</th><th class="num">Сер. чек</th><th>Останній візит</th><th>Мітки</th></tr></thead>
      <tbody id="client-rows">${clientRows()}</tbody>
    </table></div>`;
}

function viewClient(key) {
  const c = clientsList().find((x) => x.key === key);
  if (!c) return `<a class="back" href="#/clients">${icon('chevL', 22)}Клієнти</a><p>Клієнта не знайдено.</p>`;
  const hist = [...c.list].sort((a, b) => (b.date + b.time).localeCompare(a.date + a.time));
  const telLink = c.phone ? `<a href="tel:${esc(c.phone.replace(/[^+\d]/g, ''))}">${esc(c.phone)}</a>` : '';
  return `<a class="back" href="#/clients">${icon('chevL', 22)}Клієнти</a>
    <div class="title-row"><h1>${esc(c.name)}</h1>
      <button class="btn" data-action="client-edit" data-key="${esc(key)}">Редагувати</button></div>
    <p class="page-sub">${telLink ? `${telLink} · ` : c.list.some(isCarcar) ? 'Клієнт CARCAR · ' : ''}${esc([...c.cars].join(', ') || 'авто не вказано')}${c.meta.email ? ` · ${esc(c.meta.email)}` : ''}</p>
    <section class="kpis" aria-label="Показники клієнта">
      <div class="kpi"><span class="label">Візитів</span><span class="value">${c.visits}</span></div>
      <div class="kpi"><span class="label">Витрачено</span><span class="value">${uah(c.spent)}</span></div>
      <div class="kpi"><span class="label">Середній чек</span><span class="value">${c.visits ? uah(Math.round(c.spent / c.visits)) : '—'}</span></div>
      <div class="kpi"><span class="label">Останній візит</span><span class="value">${c.last ? dayLabel(c.last, { day: 'numeric', month: 'short' }) : '—'}</span>${c.last ? `<span class="kpi-note">${ago(c.last)}</span>` : ''}</div>
    </section>
    <div class="grid-2" style="margin-top:16px">
      <section class="panel" aria-labelledby="h-notes">
        <h2 id="h-notes">Мітки й нотатки</h2><p class="sub">Бачите лише ви</p>
        <div class="tags" role="group" aria-label="Мітки">${TAGS.map((t) => `<button class="tag-toggle" data-action="tag" data-tag="${esc(t)}" aria-pressed="${c.meta.tags.includes(t)}">${esc(t)}</button>`).join('')}</div>
        <form class="stack" id="note-form" style="margin-top:14px">
          <label class="field"><span>Нотатка</span><textarea name="note" rows="4" placeholder="Наприклад, любить чай, авто з дитячим кріслом">${esc(c.meta.note)}</textarea></label>
          <button class="btn" type="submit">Зберегти нотатку</button>
        </form>
      </section>
      <section class="panel" aria-labelledby="h-act">
        <h2 id="h-act">Дії</h2>
        <div class="stack">
          <button class="btn primary" data-action="new-booking" data-client="${esc(key)}">${icon('plus', 18)}Записати клієнта</button>
          ${c.phone ? `<a class="btn" href="tel:${esc(c.phone.replace(/[^+\d]/g, ''))}">${icon('phone', 18)}Зателефонувати</a>
            <div class="grid2"><a class="btn" href="${esc(viberLink(c.phone))}">Viber</a><a class="btn" href="${esc(telegramLink(c.phone))}" target="_blank" rel="noopener">Telegram</a></div>
            <p class="small muted" style="margin:0">${optedIn(c) ? 'Погодився на розсилки.' : 'Без згоди на розсилки — у масові розсилки не потрапляє.'}</p>` : '<p class="small muted">Клієнт записується через CARCAR — сповіщення приходять йому в застосунок.</p>'}
          ${clientExtras(c)}
          ${c.upcoming ? `<p class="small muted" style="margin:0">Вже записаний: ${c.upcoming} ${plural(c.upcoming, 'запис', 'записи', 'записів')}.</p>` : ''}
        </div>
      </section>
    </div>
    ${offersPanel(c)}
    <h2 class="biz-h2">Історія візитів</h2>
    ${hist.length ? `<div class="table-wrap" tabindex="0" role="region" aria-label="Історія візитів"><table class="t">
      <thead><tr><th>Дата</th><th>Послуги</th><th>Канал</th><th>Статус</th><th class="num">Сума</th></tr></thead>
      <tbody>${hist.map((b) => `<tr class="link-row" data-action="open-booking" data-id="${b.id}"><td>${dayLabel(b.date, { day: 'numeric', month: 'short', year: 'numeric' })}, ${b.time}</td>
        <td>${esc(b.services.join(', '))}</td><td>${channelPill(b)}</td><td>${statusPill(b)}</td><td class="num">${uah(isCarcar(b) ? price(b) : b.paid)}</td></tr>`).join('')}</tbody>
    </table></div>` : '<p class="muted">Записів ще не було.</p>'}`;
}

// Абонементи клієнта — коротко в картці.
function clientExtras(c) {
  const passes = passesOf(ui.place).sold.filter((x) => x.clientKey === c.key && passActive(x));
  return `${passes.map((x) => `<p class="small" style="margin:0">${icon('gift', 16)} ${esc(x.name)}: лишилось ${passLeft(x)}, до ${fmtDate(x.validUntil)}</p>`).join('')}`;
}

// Персональні послуги клієнта: окрема ціна або послуга, якої немає в загальному прайсі.
function offersPanel(c) {
  const list = offers.filter((o) => o.placeId === ui.place && o.clientKey === c.key);
  const canSee = c.key.startsWith('tel:')
    ? 'Клієнт побачить їх у застосунку CARCAR на сторінці точки, якщо в його профілі вказано цей телефон. Ви також можете записати його на них самі.'
    : c.key.startsWith('car:')
      ? 'Клієнт побачить їх у застосунку CARCAR на сторінці точки — вони привʼязані до його авто з гаража.'
      : 'Додайте клієнту телефон (кнопка «Редагувати»), щоб він бачив персональні послуги в застосунку.';
  return `<section class="panel" aria-labelledby="h-offers" style="margin-top:16px">
    <div class="head"><h2 id="h-offers">Персональні послуги й ціни</h2>
      <button class="btn" data-action="offer-add" data-key="${esc(c.key)}">${icon('plus', 18)}Додати персональну послугу</button></div>
    <p class="sub">${canSee}</p>
    ${list.length ? `<ul class="offer-list">${list.map((o) => `<li class="${o.active === false ? 'off' : ''}">
      <span class="name"><b>${esc(o.name)}</b><small>${duration(o.min)} · ${esc(catById(o.cat)?.name ?? '')}${o.base ? ` · у прайсі ${uah(o.base)}` : ''}${o.note ? ` · ${esc(o.note)}` : ''}</small></span>
      <b class="price">${uah(o.price)}</b>
      <label class="row small" style="gap:6px"><input class="check" type="checkbox" data-action="offer-toggle" data-id="${o.id}" ${o.active === false ? '' : 'checked'} aria-label="Активна: ${esc(o.name)}">Активна</label>
      <button class="icon-btn" data-action="offer-del" data-id="${o.id}" aria-label="Видалити: ${esc(o.name)}">${icon('x', 18)}</button>
    </li>`).join('')}</ul>` : '<p class="muted" style="margin:0">Персональних послуг ще немає. Наприклад, знижка постійному клієнту на комплекс або окрема ціна за нестандартне авто.</p>'}
  </section>`;
}

function offerDrawer(key) {
  const p = place();
  openDrawer('Персональна послуга', `<form class="stack" id="offer-form" data-key="${esc(key)}" style="gap:14px">
    <label class="field"><span>Основа</span><select name="base">
      <option value="">Своя послуга</option>
      ${p.services.map((s) => `<option value="${s.id}">${esc(s.name)} — ${uah(s.price[0])}</option>`).join('')}</select></label>
    <label class="field"><span>Назва послуги</span><input name="name" required maxlength="80" autocomplete="off"></label>
    <div class="form-grid">
      <label class="field"><span>Ціна для клієнта, ₴</span><input name="price" type="number" min="1" step="1" required></label>
      <label class="field"><span>Тривалість, хв</span><input name="min" type="number" min="5" step="5" value="30" required></label>
      <label class="field full"><span>Категорія</span><select name="cat">${CATEGORIES.map((c) => `<option value="${c.id}" ${c.id === p.cats[0] ? 'selected' : ''}>${c.name}</option>`).join('')}</select></label>
    </div>
    <label class="field"><span>Примітка для клієнта</span><input name="note" maxlength="120" placeholder="Наприклад, ціна для постійного клієнта" autocomplete="off"></label>
    <button class="btn primary" type="submit">Зберегти послугу</button>
  </form>`);
}

function clientDrawer(key) {
  const c = key ? clientsList().find((x) => x.key === key) : null;
  const m = key ? clientMeta(key) : {};
  // Телефон — це ключ клієнта; міняти його можна, лише поки за ним немає записів.
  const lockPhone = c && (c.list.length || !c.key.startsWith('tel:'));
  const car = (m.cars ?? [...(c?.cars ?? [])])[0] ?? '';
  const [carName = '', plate = ''] = car.split(' · ');
  openDrawer(c ? 'Редагувати клієнта' : 'Новий клієнт', `<form class="stack" id="client-form" data-key="${esc(key ?? '')}" style="gap:14px">
    <label class="field"><span>Імʼя клієнта</span><input name="name" required maxlength="80" value="${esc(c?.name === 'Клієнт CARCAR' ? '' : c?.name ?? '')}" autocomplete="off"></label>
    <label class="field"><span>Телефон клієнта</span><input name="phone" inputmode="tel" placeholder="+380" value="${esc(c?.phone ?? '')}" ${lockPhone ? 'readonly aria-describedby="phone-hint"' : c ? '' : 'required'} autocomplete="off"></label>
    ${lockPhone ? `<p class="fine" id="phone-hint">${c.key.startsWith('tel:') ? 'Телефон привʼязаний до історії записів, тому його не можна змінити.' : 'Клієнт записується через CARCAR — телефон бачите лише ви.'}</p>` : ''}
    <div class="form-grid">
      <label class="field"><span>Авто</span><input name="carName" value="${esc(carName)}" placeholder="Наприклад, Skoda Octavia" autocomplete="off"></label>
      <label class="field"><span>Держномер</span><input name="plate" value="${esc(plate)}" placeholder="AA1234BB" autocomplete="off"></label>
    </div>
    <label class="field"><span>Email</span><input name="email" type="email" value="${esc(m.email ?? '')}" autocomplete="off"></label>
    <label class="row"><input class="check" type="checkbox" name="optIn" ${(m.optIn ?? c?.list.some((b) => b.optIn)) ? 'checked' : ''}>Згода на розсилки у Viber чи Telegram</label>
    <label class="field"><span>Нотатка</span><textarea name="note" rows="3">${esc(m.note ?? '')}</textarea></label>
    <button class="btn primary" type="submit">${c ? 'Зберегти зміни' : 'Додати клієнта'}</button>
  </form>`);
}

// ---------- послуги й ціни ----------

function viewServices() {
  const p = place();
  ui.svcDraft ??= p.allServices.map((s) => ({ ...s, cat: serviceCat(s), price: [...s.price] }));
  return `<h1>Послуги й ціни</h1>
    <p class="page-sub">Зміни одразу бачать клієнти в застосунку CARCAR. Неактивні послуги клієнти не бачать.</p>
    <form id="svc-form">
    <div class="table-wrap" tabindex="0" role="region" aria-label="Прайс"><table class="t price-table">
      <thead><tr><th>Послуга</th><th>Категорія</th><th class="num">Хв</th>${CAR_CLASSES.map((c) => `<th class="num">${esc(c)}, ₴</th>`).join('')}<th>Активна</th><th><span class="sr-only">Дії</span></th></tr></thead>
      <tbody>${ui.svcDraft.map((s, i) => `<tr class="${s.off ? 'off' : ''}">
        <td><input data-i="${i}" data-f="name" value="${esc(s.name)}" aria-label="Назва послуги ${i + 1}" required></td>
        <td><select data-i="${i}" data-f="cat" aria-label="Категорія: ${esc(s.name)}">${CATEGORIES.map((c) => `<option value="${c.id}" ${c.id === s.cat ? 'selected' : ''}>${c.name}</option>`).join('')}</select></td>
        <td class="num"><input type="number" min="5" step="5" data-i="${i}" data-f="min" value="${s.min}" aria-label="Тривалість, хв: ${esc(s.name)}"></td>
        ${s.price.map((v, k) => `<td class="num"><input type="number" min="0" step="10" data-i="${i}" data-f="price" data-k="${k}" value="${v}" aria-label="Ціна, ${esc(CAR_CLASSES[k])}: ${esc(s.name)}"></td>`).join('')}
        <td><input type="checkbox" data-i="${i}" data-f="active" ${s.off ? '' : 'checked'} aria-label="Активна: ${esc(s.name)}"></td>
        <td>${s.id.startsWith('c_') ? `<button class="icon-btn" type="button" data-action="svc-del" data-i="${i}" aria-label="Видалити: ${esc(s.name)}">${icon('x', 18)}</button>` : ''}</td>
      </tr>`).join('')}</tbody>
    </table></div>
    <div class="sticky-actions">
      <button class="btn" type="button" data-action="svc-reset">Повернути стандартний прайс</button>
      <button class="btn" type="button" data-action="svc-add">${icon('plus', 18)}Додати послугу</button>
      <button class="btn primary" type="submit">Зберегти прайс</button>
    </div>
    </form>`;
}

// ---------- фінанси ----------

function moneyStatus(b) {
  if (b.state === 'paid' || b.state === 'done') return ['У роботі', 'carcar'];
  if (b.state === 'dispute') return ['Спір', 'warn'];
  if (b.state === 'completed') return isFrozen(b) ? [`Заморожено до ${fmtTime(b.unfreezeAt)}`, 'warn'] : ['Доступно', 'ok'];
  if (b.placeAmount) return ['Компенсація', 'ok'];
  return ['Повернено клієнту', 'muted'];
}

const shareOf = (b) => (b.state === 'completed' || b.state === 'paid' || b.state === 'done' || b.state === 'dispute' ? price(b) : b.placeAmount ?? 0);

function viewFinance() {
  const p = place();
  const bal = balanceFor(p.id, bookings, payouts);
  const fee = Math.round(bal.available * commissionFor(p.id));
  const mine = payouts.filter((x) => x.placeId === p.id).sort((a, b) => b.at - a.at);
  const feesPaid = mine.reduce((a, x) => a + x.fee, 0);
  const ledger = own().filter(isCarcar).sort((a, b) => (b.date + b.time).localeCompare(a.date + a.time));
  const [from, to] = rangeOf(30);
  const cashList = own().filter((b) => !isCarcar(b) && b.state === 'completed' && inRange(b, [from, to]));
  const cashBy = (m) => cashList.filter((b) => b.payment === m).reduce((a, b) => a + b.paid, 0);
  return `<h1>Фінанси</h1><p class="page-sub">Повний облік точки: доходи з CARCAR і на місці, витрати, прибуток і виплати</p>
    ${viewReport()}
    <h2 class="biz-h2">Гроші через CARCAR</h2>
    <p class="small muted" style="margin-top:-4px">Оплата утримується до підтвердження клієнтом, потім заморожується на ${PAYMENT.freezeHours} год і стає доступною до виведення.</p>
    <section class="kpis" aria-label="Баланс">
      <div class="kpi hero"><span class="label">Доступно до виведення</span><span class="value">${uah(bal.available)}</span>
        <span class="kpi-note">комісія ${pctText(commissionFor(p.id))} під час виведення${bal.available > 0 ? `: ${uah(fee)}` : ''}</span></div>
      <div class="kpi"><span class="label">Заморожено</span><span class="value">${uah(bal.frozen)}</span>
        <span class="kpi-note">${bal.next ? `найближче: ${uah(price(bal.next))} — ${fmtTime(bal.next.unfreezeAt)}` : 'немає замовлень у роботі'}</span></div>
      <div class="kpi"><span class="label">Виведено всього</span><span class="value">${uah(mine.reduce((a, x) => a + x.net, 0))}</span></div>
      <div class="kpi"><span class="label">Комісія сплачена</span><span class="value">${uah(feesPaid)}</span></div>
    </section>
    <div class="row" style="margin:14px 0 4px">
      ${payoutReady(p.id)
        ? `<button class="btn primary" data-action="payout" ${bal.available > 0 ? '' : 'disabled'}>${icon('card', 20)}${bal.available > 0 ? `Вивести ${uah(bal.available - fee)} на рахунок ${maskIban(partnerOf(p.id).payout.iban)}` : 'Немає коштів для виведення'}</button>`
        : `<a class="btn primary" href="#/connect">${icon('card', 20)}Вказати реквізити для виплат</a>`}
      <button class="btn" data-action="export-ledger">${icon('download', 18)}Експорт CSV</button>
    </div>
    ${payoutReady(p.id) ? '' : `<p class="small muted">${partnerOf(p.id).payout?.iban ? 'Реквізити на перевірці CARCAR — виведення стане доступним після підтвердження.' : 'Гроші виводяться лише на рахунок ФОП чи ТОВ, перевірений CARCAR.'}</p>`}
    <p class="small muted">Оплати на місці за 30 днів: готівка ${uah(cashBy('cash'))}, картка ${uah(cashBy('card'))}. Вони не проходять через CARCAR і комісією не обкладаються.</p>
    <h3 class="biz-h3">Замовлення через CARCAR</h3>
    <div class="table-wrap" tabindex="0" role="region" aria-label="Замовлення через CARCAR"><table class="t">
      <thead><tr><th>Дата</th><th>Клієнт</th><th>Послуги</th><th>Статус грошей</th><th class="num">Сума точці</th></tr></thead>
      <tbody>${ledger.length ? ledger.slice(0, 150).map((b) => {
        const [label, cls] = moneyStatus(b);
        return `<tr class="link-row" data-action="open-booking" data-id="${b.id}"><td>${dayLabel(b.date, { day: 'numeric', month: 'short' })}, ${b.time}</td>
          <td>${esc(clientName(b))}<small>${esc(b.car)}</small></td><td>${esc(b.services.join(', '))}</td>
          <td><span class="pill ${cls}">${esc(label)}</span></td><td class="num">${uah(shareOf(b))}${b.bonus ? `<small>з них бонус ${uah(b.bonus)}</small>` : ''}</td></tr>`;
      }).join('') : '<tr><td colspan="5" class="muted">Замовлень через CARCAR ще не було.</td></tr>'}</tbody>
    </table></div>
    <h3 class="biz-h3">Виплати</h3>
    <div class="table-wrap" tabindex="0" role="region" aria-label="Виплати"><table class="t">
      <thead><tr><th>Дата</th><th class="num">Сума</th><th class="num">Комісія</th><th class="num">На рахунок</th></tr></thead>
      <tbody>${mine.length ? mine.map((x) => `<tr><td>${fmtTime(x.at)}</td><td class="num">${uah(x.gross)}</td><td class="num">${uah(x.fee)}</td><td class="num">${uah(x.net)}${x.iban ? `<small>${esc(x.iban)}</small>` : ''}</td></tr>`).join('') : '<tr><td colspan="4" class="muted">Виплат ще не було.</td></tr>'}</tbody>
    </table></div>`;
}

// ---------- витрати ----------

const periodSeg = (action, n) => `<div class="seg" role="group" aria-label="Період">
  ${[7, 30, 90].map((d) => `<button data-action="${action}" data-n="${d}" aria-pressed="${d === n}">${d} ${daysWord(d)}</button>`).join('')}</div>`;

function byCategory(list) {
  const m = new Map();
  for (const e of list) m.set(e.cat, (m.get(e.cat) ?? 0) + e.amount);
  return [...m].sort((a, b) => b[1] - a[1]).map(([name, value]) => ({ name, value }));
}

function viewExpenses() {
  const n = ui.expPeriod;
  const [from, to] = rangeOf(n);
  const list = expensesIn(ui.place, from, to);
  const total = list.reduce((a, e) => a + e.amount, 0);
  const prevTotal = expensesIn(ui.place, ...rangeOf(n, 1)).reduce((a, e) => a + e.amount, 0);
  const monthly = expenses.filter((e) => e.placeId === ui.place && e.recurring && (!e.until || e.until >= today()));
  const cats = byCategory(list);
  return `<h1>Витрати</h1><p class="page-sub">Хімія, зарплата, оренда й інші витрати точки — для обліку прибутку у «Фінансах»</p>
    <div class="filters">
      ${periodSeg('exp-period', n)}
      <span class="small muted">${fmtDate(from)} — ${fmtDate(to)}</span>
      <span class="spacer"></span>
      <button class="btn" data-action="export-expenses">${icon('download', 18)}Експорт витрат</button>
      <button class="btn primary" data-action="expense-add">${icon('plus', 18)}Додати витрату</button>
    </div>
    <section class="kpis" aria-label="Витрати за період">
      <div class="kpi hero"><span class="label">Витрати</span><span class="value">${uah(total)}</span>${delta(total, prevTotal, false)}
        <span class="kpi-note">${list.length} ${plural(list.length, 'операція', 'операції', 'операцій')}</span></div>
      <div class="kpi"><span class="label">Щомісячні платежі</span><span class="value">${uah(monthly.reduce((a, e) => a + e.amount, 0))}</span><span class="kpi-note">${monthly.length} ${plural(monthly.length, 'платіж', 'платежі', 'платежів')} на місяць</span></div>
      <div class="kpi"><span class="label">Найбільша стаття</span><span class="value small-value">${cats[0] ? esc(cats[0].name) : '—'}</span>${cats[0] ? `<span class="kpi-note">${uah(cats[0].value)} · ${pct((cats[0].value / total) * 100)}</span>` : ''}</div>
    </section>
    <div class="grid-2" style="margin-top:16px">
      <section class="panel" aria-labelledby="h-ecat">
        <h2 id="h-ecat">За категоріями</h2><p class="sub">Сума за період</p>
        ${cats.length ? hbars(cats, uah) : '<p class="muted" style="margin:0">Витрат за період немає.</p>'}
      </section>
      <section class="panel" aria-labelledby="h-rec">
        <h2 id="h-rec">Щомісячні платежі</h2><p class="sub">Додаються самі щомісяця в той самий день</p>
        ${monthly.length ? `<ul class="special-list">${monthly.map((e) => `<li><span><b>${esc(e.cat)} · ${uah(e.amount)}</b><small>з ${fmtDate(e.date)}${e.note ? ` · ${esc(e.note)}` : ''}</small></span>
          <button class="btn" data-action="exp-stop" data-id="${e.id}">Зупинити</button></li>`).join('')}</ul>` : '<p class="muted" style="margin:0">Наприклад, оренда чи зарплата адміністратора. Позначте «Повторювати щомісяця» під час додавання.</p>'}
      </section>
    </div>
    <h2 class="biz-h2">Операції</h2>
    <div class="table-wrap" tabindex="0" role="region" aria-label="Витрати"><table class="t">
      <thead><tr><th>Дата</th><th>Категорія</th><th>Спосіб</th><th>Нотатка</th><th class="num">Сума</th><th><span class="sr-only">Дії</span></th></tr></thead>
      <tbody>${list.length ? list.map((e) => `<tr><td>${dayLabel(e.date, { day: 'numeric', month: 'short', year: 'numeric' })}</td>
        <td>${esc(e.cat)}${e.template ? ' <span class="pill">щомісяця</span>' : ''}</td><td>${PAY_METHODS[e.method] ?? '—'}</td><td>${esc(e.note ?? '')}</td>
        <td class="num">${uah(e.amount)}</td>
        <td>${e.template || e.auto || e.source === 'stock' ? (e.auto ? '<span class="pill">авто</span>' : e.source === 'stock' ? '<span class="pill">склад</span>' : '') : `<button class="icon-btn" data-action="exp-del" data-id="${e.id}" aria-label="Видалити витрату ${esc(e.cat)}, ${uah(e.amount)}">${icon('x', 18)}</button>`}</td></tr>`).join('')
        : '<tr><td colspan="6" class="muted">Витрат за період немає.</td></tr>'}</tbody>
    </table></div>`;
}

function expenseDrawer() {
  openDrawer('Нова витрата', `<form class="stack" id="expense-form" style="gap:14px">
    <div class="form-grid">
      <label class="field"><span>Сума, ₴</span><input name="amount" type="number" min="1" step="1" required></label>
      <label class="field"><span>Дата</span><input name="date" type="date" required value="${today()}" max="${addDays(today(), 31)}"></label>
      <label class="field full"><span>Категорія</span><select name="cat">${EXPENSE_CATS.map((c) => `<option>${c}</option>`).join('')}</select></label>
    </div>
    <fieldset class="radio-row"><legend>Як оплачено</legend>
      ${Object.entries(PAY_METHODS).map(([k, v], i) => `<label><input type="radio" name="method" value="${k}" ${i === 0 ? 'checked' : ''}> ${v}</label>`).join('')}</fieldset>
    <label class="field"><span>Нотатка</span><input name="note" maxlength="120" placeholder="Наприклад, шампунь 20 л" autocomplete="off"></label>
    <label class="row"><input class="check" type="checkbox" name="recurring">Повторювати щомісяця</label>
    <button class="btn primary" type="submit">Додати витрату</button>
  </form>`);
}

// ---------- фінансовий звіт ----------

// Доходи й витрати за проміжок: те, що потрапляє у звіт про прибутки.
function pnl([from, to]) {
  const list = own().filter((b) => inRange(b, [from, to]) && happened(b));
  const sum = (fn) => list.filter(fn).reduce((a, b) => a + revenue(b), 0);
  const inc = {
    carcar: sum(isCarcar),
    cash: sum((b) => !isCarcar(b) && b.payment === 'cash'),
    card: sum((b) => !isCarcar(b) && b.payment === 'card'),
    other: sum((b) => !isCarcar(b) && b.payment !== 'cash' && b.payment !== 'card'),
  };
  // Абонементи й сертифікати — дохід у день продажу; записи, які ними оплачено, вже без цієї суми.
  const [fromMs, toMs] = [parseDate(from).getTime(), parseDate(addDays(to, 1)).getTime()];
  const passes = passesOf(ui.place).sold.filter((x) => x.soldAt >= fromMs && x.soldAt < toMs);
  inc.passes = passes.reduce((a, x) => a + x.price, 0);
  const passCarcar = passes.filter((x) => x.source === 'carcar').reduce((a, x) => a + x.price, 0);
  const income = inc.carcar + inc.cash + inc.card + inc.other + inc.passes;
  const fee = Math.round((inc.carcar + passCarcar) * commissionFor(ui.place));
  const exp = expensesIn(ui.place, from, to);
  const expTotal = exp.reduce((a, e) => a + e.amount, 0);
  const profit = income - fee - expTotal;
  return { inc, income, fee, exp, expTotal, cats: byCategory(exp), profit, margin: income ? (profit / income) * 100 : 0 };
}

function pnlRows(r) {
  const rows = [
    ['Доходи', null, 'h'],
    ['Через CARCAR', r.inc.carcar],
    ['На місці: готівка', r.inc.cash],
    ['На місці: картка', r.inc.card],
    ...(r.inc.other ? [['На місці: спосіб не вказано', r.inc.other]] : []),
    ...(r.inc.passes ? [['Абонементи й сертифікати', r.inc.passes]] : []),
    ['Разом доходи', r.income, 't'],
    ['Витрати', null, 'h'],
    [`Комісія CARCAR, ${pctText(commissionFor(ui.place))}`, r.fee],
    ...r.cats.map((c) => [c.name, c.value]),
    ['Разом витрати', r.fee + r.expTotal, 't'],
  ];
  return rows;
}

function viewReport() {
  const n = ui.finPeriod;
  const range = rangeOf(n);
  const r = pnl(range);
  const prev = pnl(rangeOf(n, 1));
  // Групуємо по днях (7 і 30) або по тижнях (90), щоб стовпчики лишалися читабельними.
  const step = n === 90 ? 7 : 1;
  const cats = [];
  for (let d = range[0]; d <= range[1]; d = addDays(d, step)) {
    const end = step === 1 ? d : [addDays(d, step - 1), range[1]].sort()[0];
    const x = pnl([d, end]);
    const s = parseDate(d);
    cats.push({
      label: step === 1 ? dayLabel(d) : `${dayLabel(d, { day: 'numeric', month: 'short' })} — ${dayLabel(end, { day: 'numeric', month: 'short' })}`,
      short: `${s.getDate()}.${pad(s.getMonth() + 1)}`, values: [x.income, x.fee + x.expTotal],
    });
  }
  charts['ch-pnl'] = { title: `Доходи й витрати ${step === 1 ? 'по днях' : 'по тижнях'}`, cats, series: ['Доходи', 'Витрати'], fmt: uah, grouped: true };
  return `<section class="report" aria-labelledby="h-pnl">
    <h2 class="biz-h2" id="h-pnl">Прибутки й збитки</h2>
    <div class="filters">
      ${periodSeg('fin-period', n)}
      <span class="small muted">${fmtDate(range[0])} — ${fmtDate(range[1])}</span>
      <span class="spacer"></span>
      <a class="btn" href="#/expenses">${icon('cash', 18)}Витрати</a>
      <button class="btn" data-action="export-pnl">${icon('download', 18)}Експорт звіту</button>
    </div>
    <section class="kpis" aria-label="Прибуток за період">
      <div class="kpi hero"><span class="label">Прибуток</span><span class="value ${r.profit < 0 ? 'neg' : ''}">${r.profit < 0 ? '−' : ''}${uah(Math.abs(r.profit))}</span>${delta(r.profit, prev.profit)}
        <span class="kpi-note">маржа ${pct(r.margin)}</span></div>
      <div class="kpi"><span class="label">Доходи</span><span class="value">${uah(r.income)}</span>${delta(r.income, prev.income)}</div>
      <div class="kpi"><span class="label">Витрати</span><span class="value">${uah(r.fee + r.expTotal)}</span>${delta(r.fee + r.expTotal, prev.fee + prev.expTotal, false)}
        <span class="kpi-note">з них комісія CARCAR ${uah(r.fee)}</span></div>
    </section>
    <div class="grid-3" style="margin-top:16px">
      <section class="panel" aria-labelledby="h-pnl-ch">
        <h3 id="h-pnl-ch">Доходи й витрати</h3>
        ${legend(['Доходи', 'Витрати'])}
        <div class="chart" id="ch-pnl"></div>
        ${tableView(['Період', 'Доходи', 'Витрати', 'Різниця'], cats.map((c) => [c.label, uah(c.values[0]), uah(c.values[1]), uah(c.values[0] - c.values[1])]))}
      </section>
      <section class="panel" aria-labelledby="h-pnl-t">
        <h3 id="h-pnl-t">Звіт</h3>
        <table class="t pnl"><tbody>
          ${pnlRows(r).map(([name, v, kind]) => kind === 'h'
            ? `<tr class="h"><td colspan="2">${esc(name)}</td></tr>`
            : `<tr class="${kind ?? ''}"><td>${esc(name)}</td><td class="num">${uah(v)}</td></tr>`).join('')}
        </tbody><tfoot>
          <tr class="t"><td>Прибуток</td><td class="num">${r.profit < 0 ? '−' : ''}${uah(Math.abs(r.profit))}</td></tr>
          <tr><td>Маржа</td><td class="num">${pct(r.margin)}</td></tr>
        </tfoot></table>
      </section>
    </div>
    ${cashFlow(range)}
  </section>`;
}

// Рух грошей: що пройшло через касу, через картку чи рахунок і що лежить у CARCAR.
function cashFlow([from, to]) {
  const list = own().filter((b) => inRange(b, [from, to]) && b.state === 'completed' && !isCarcar(b));
  const exp = expensesIn(ui.place, from, to);
  const cashIn = list.filter((b) => b.payment === 'cash').reduce((a, b) => a + b.paid, 0);
  const cashOut = exp.filter((e) => e.method === 'cash').reduce((a, e) => a + e.amount, 0);
  const startMs = parseDate(from).getTime();
  const endMs = parseDate(addDays(to, 1)).getTime();
  const payIn = payouts.filter((x) => x.placeId === ui.place && x.at >= startMs && x.at < endMs).reduce((a, x) => a + x.net, 0);
  const cardIn = list.filter((b) => b.payment === 'card').reduce((a, b) => a + b.paid, 0) + payIn;
  const cardOut = exp.filter((e) => e.method !== 'cash').reduce((a, e) => a + e.amount, 0);
  const bal = balanceFor(ui.place, bookings, payouts);
  const sign = (v) => `${v < 0 ? '−' : v > 0 ? '+' : ''}${uah(Math.abs(v))}`;
  return `<h3 class="biz-h3">Рух грошей за період</h3>
    <section class="kpis" aria-label="Рух грошей">
      <div class="kpi"><span class="label">Каса (готівка)</span><span class="value">${sign(cashIn - cashOut)}</span><span class="kpi-note">надійшло ${uah(cashIn)} · витрачено ${uah(cashOut)}</span></div>
      <div class="kpi"><span class="label">Картка й рахунок</span><span class="value">${sign(cardIn - cardOut)}</span><span class="kpi-note">надійшло ${uah(cardIn)}, з них виплати CARCAR ${uah(payIn)} · витрачено ${uah(cardOut)}</span></div>
      <div class="kpi"><span class="label">На балансі CARCAR</span><span class="value">${uah(bal.available + bal.frozen)}</span><span class="kpi-note">доступно ${uah(bal.available)} · заморожено ${uah(bal.frozen)}</span></div>
    </section>`;
}

// ---------- імпорт з інших CRM і таблиць ----------

// Поля для кожного типу імпорту й назви стовпців, за якими їх упізнаємо (укр., рос., англ.).
// Порядок важливий: специфічніші поля перевіряємо першими, кожен стовпець дістається одному полю.
const IMPORT = {
  clients: {
    label: 'Клієнти', note: 'імʼя, телефон, авто, держномер, email, нотатка',
    fields: [
      ['plate', 'Держномер', ['держномер', 'госномер', 'номер авто', 'номерний знак', 'гос. номер', 'plate']],
      ['phone', 'Телефон', ['телефон', 'phone', 'тел', 'моб', 'mobile']],
      ['name', 'Імʼя', ['імʼя', "ім'я", 'имя', 'піб', 'фио', 'клієнт', 'клиент', 'name', 'client', 'customer']],
      ['car', 'Авто', ['авто', 'машина', 'автомобіль', 'автомобиль', 'марка', 'car', 'vehicle']],
      ['email', 'Email', ['email', 'e-mail', 'пошта', 'почта', 'mail']],
      ['visits', 'Візитів', ['візит', 'визит', 'visits']],
      ['spent', 'Витрачено, ₴', ['витрачено', 'потрачено', 'сума покупок', 'сумма', 'spent', 'revenue']],
      ['last', 'Останній візит', ['останній', 'последн', 'last']],
      ['note', 'Нотатка', ['нотатка', 'примітка', 'коментар', 'комментарий', 'примечание', 'note', 'comment']],
    ],
    required: ['name|phone'],
  },
  services: {
    label: 'Послуги й ціни', note: 'назва, ціна (для легкового, кросовера, позашляховика), тривалість, категорія',
    fields: [
      ['price2', `Ціна: ${CAR_CLASSES[1]}`, ['кросовер', 'кроссовер', 'crossover', 'suv']],
      ['price3', `Ціна: ${CAR_CLASSES[2]}`, ['позашлях', 'внедорож', 'мінівен', 'минивэн', 'бус', 'van']],
      ['price', `Ціна: ${CAR_CLASSES[0]}`, ['легков', 'седан', 'ціна', 'цена', 'вартість', 'стоимость', 'price']],
      ['min', 'Тривалість, хв', ['тривалість', 'длительность', 'хв', 'мин', 'duration', 'minutes', 'час']],
      ['cat', 'Категорія', ['категор', 'category', 'тип', 'вид']],
      ['name', 'Назва послуги', ['послуга', 'услуга', 'назва', 'название', 'наименование', 'service', 'name']],
    ],
    required: ['name', 'price'],
  },
  bookings: {
    label: 'Записи й історія', note: 'дата, час, клієнт, телефон, послуги, сума, статус, оплата',
    fields: [
      ['date', 'Дата', ['дата', 'date', 'день']],
      ['time', 'Час', ['час', 'время', 'time', 'початок', 'начало', 'start']],
      ['plate', 'Держномер', ['держномер', 'госномер', 'номер авто', 'гос. номер', 'plate']],
      ['phone', 'Телефон', ['телефон', 'phone', 'тел', 'моб']],
      ['name', 'Клієнт', ['клієнт', 'клиент', 'імʼя', "ім'я", 'имя', 'піб', 'фио', 'client', 'customer', 'name']],
      ['services', 'Послуги', ['послуг', 'услуг', 'service', 'роботи', 'работы']],
      ['total', 'Сума, ₴', ['сума', 'сумма', 'вартість', 'стоимость', 'ціна', 'цена', 'total', 'amount', 'price', 'оплачено']],
      ['payment', 'Спосіб оплати', ['спосіб оплати', 'способ оплаты', 'тип оплати', 'оплата', 'payment']],
      ['minutes', 'Тривалість, хв', ['тривалість', 'длительность', 'duration', 'minutes', 'хв', 'мин']],
      ['status', 'Статус', ['статус', 'status', 'стан']],
      ['car', 'Авто', ['авто', 'машина', 'автомобіль', 'автомобиль', 'car', 'vehicle']],
      ['note', 'Коментар', ['коментар', 'комментарий', 'примітка', 'примечание', 'нотатка', 'note', 'comment']],
    ],
    required: ['date', 'services'],
  },
};

const IMPORT_TEMPLATES = {
  clients: [['Імʼя', 'Телефон', 'Авто', 'Держномер', 'Email', 'Нотатка'], ['Іван Приклад', '+380 67 000 00 00', 'Skoda Octavia', 'AA0000AA', '', 'Шини зберігаємо в нас']],
  services: [['Назва послуги', `Ціна: ${CAR_CLASSES[0]}`, `Ціна: ${CAR_CLASSES[1]}`, `Ціна: ${CAR_CLASSES[2]}`, 'Тривалість, хв', 'Категорія'], ['Комплекс: кузов + салон', '550', '650', '750', '60', 'Мийка']],
  bookings: [['Дата', 'Час', 'Клієнт', 'Телефон', 'Авто', 'Держномер', 'Послуги', 'Сума', 'Оплата', 'Статус'], ['01.09.2026', '10:30', 'Іван Приклад', '+380 67 000 00 00', 'Skoda Octavia', 'AA0000AA', 'Комплекс: кузов + салон', '550', 'Готівка', 'Виконано']],
};

// CSV із будь-якої CRM чи таблиці: роздільник ; , або табуляція, лапки, BOM, переноси в лапках.
function parseCsv(text) {
  text = text.replace(/^\uFEFF/, '');
  const first = text.split(/\r?\n/, 1)[0];
  const delim = [';', '\t', ','].map((d) => [d, first.split(d).length]).sort((a, b) => b[1] - a[1])[0][0];
  const rows = [];
  let row = [], cell = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) {
      if (ch === '"' && text[i + 1] === '"') { cell += '"'; i++; } else if (ch === '"') q = false; else cell += ch;
    } else if (ch === '"' && !cell) q = true;
    else if (ch === delim) { row.push(cell.trim()); cell = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(cell.trim()); rows.push(row); row = []; cell = '';
    } else cell += ch;
  }
  if (cell || row.length) { row.push(cell.trim()); rows.push(row); }
  return rows.filter((r) => r.some((c) => c));
}

// Файли з Excel часто в кодуванні Windows-1251: пробуємо UTF-8, інакше — його.
async function readFileText(file) {
  const buf = await file.arrayBuffer();
  try { return new TextDecoder('utf-8', { fatal: true }).decode(buf); } catch { return new TextDecoder('windows-1251').decode(buf); }
}

function autoMap(type, head) {
  const used = new Set();
  const map = {};
  const h = head.map((x) => x.toLowerCase().replace(/[’`]/g, 'ʼ'));
  for (const [f, , words] of IMPORT[type].fields) {
    const i = h.findIndex((x, k) => !used.has(k) && words.some((w) => x.includes(w)));
    if (i >= 0) { map[f] = i; used.add(i); }
  }
  return map;
}

const num = (v) => { const n = parseFloat(String(v ?? '').replace(/[\s ₴]|грн\.?|uah/gi, '').replace(',', '.')); return Number.isFinite(n) ? n : null; };

// Дата й час: 25.09.2026, 25/09/2026, 2026-09-25, 25.09.26, разом із часом в одній клітинці чи окремо.
function parseWhen(dateCell, timeCell) {
  const s = String(dateCell ?? '');
  let date = null;
  let m = s.match(/(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) date = `${m[1]}-${pad(+m[2])}-${pad(+m[3])}`;
  else if ((m = s.match(/(\d{1,2})[./](\d{1,2})[./](\d{2,4})/))) date = `${m[3].length === 2 ? `20${m[3]}` : m[3]}-${pad(+m[2])}-${pad(+m[1])}`;
  if (date && Number.isNaN(parseDate(date).getTime())) date = null;
  const t = String(timeCell ?? '').match(/(\d{1,2}):(\d{2})/) ?? s.replace(m?.[0] ?? '', '').match(/(\d{1,2}):(\d{2})/);
  return { date, time: t ? `${pad(Math.min(23, +t[1]))}:${t[2]}` : null };
}

function parseStatus(v, future) {
  const s = String(v ?? '').toLowerCase();
  if (/скас|отмен|cancel/.test(s)) return 'cancelled';
  if (/неяв|не прий|не приш|не приех|no.?show/.test(s)) return 'noshow';
  return future ? 'booked' : 'completed';
}

const parsePayment = (v) => {
  const s = String(v ?? '').toLowerCase();
  return /готів|налич|cash|кеш/.test(s) ? 'cash' : /карт|card|безгот|безнал|термін|термин|рахун|счет|счёт|iban/.test(s) ? 'card' : null;
};

const matchCat = (v, p) => {
  const s = String(v ?? '').toLowerCase();
  const byWord = { wash: /мий|мой|wash/, tires: /шин|tire|tyre/, service: /сто|ремонт|service|сервіс/, detailing: /детейл|детейл|detail|полір|полир|кераміка|керамика/ };
  return CATEGORIES.find((c) => s && (s.includes(c.name.toLowerCase()) || byWord[c.id].test(s)))?.id ?? p.cats[0] ?? 'wash';
};

function importRows() {
  const { type, rows, map } = ui.imp;
  const pick = (r, f) => (map[f] === undefined || map[f] === '' ? '' : String(r[map[f]] ?? '').trim());
  return rows.slice(1).map((r) => Object.fromEntries(IMPORT[type].fields.map(([f]) => [f, pick(r, f)])));
}

function runImport() {
  const { type } = ui.imp;
  const p = place();
  const res = { added: 0, updated: 0, skipped: 0 };
  const data = importRows();
  if (type === 'clients') {
    const known = new Set(clientsList().map((c) => c.key));
    for (const r of data) {
      if (!r.name && !r.phone) { res.skipped++; continue; }
      const key = phoneKey(r.phone) ?? `name:${r.name.toLowerCase()}`;
      const m = clientMeta(key);
      const car = [r.car, r.plate.toUpperCase()].filter(Boolean).join(' · ');
      const last = parseWhen(r.last).date;
      setMeta(key, {
        // Наявні дані не перезаписуємо — лише доповнюємо порожні поля.
        name: m.name || r.name, phone: m.phone || r.phone, email: m.email || r.email, note: [m.note, r.note].filter(Boolean).join('\n'),
        cars: car && !(m.cars ?? []).includes(car) ? [...(m.cars ?? []), car] : m.cars,
        visits: num(r.visits) ?? m.visits, spent: num(r.spent) ?? m.spent, last: last ?? m.last,
        source: m.source ?? 'import',
      });
      if (known.has(key)) res.updated++; else { res.added++; known.add(key); }
    }
  } else if (type === 'services') {
    const list = p.allServices.map((s) => ({ ...s, cat: serviceCat(s), price: [...s.price] }));
    for (const r of data) {
      const price = num(r.price);
      if (!r.name || !price) { res.skipped++; continue; }
      const prices = [price, num(r.price2) ?? price, num(r.price3) ?? num(r.price2) ?? price].map(Math.round);
      const found = list.find((s) => s.name.toLowerCase() === r.name.toLowerCase());
      const min = Math.round(num(r.min) ?? found?.min ?? 30);
      if (found) { Object.assign(found, { price: prices, min, off: false, ...(r.cat ? { cat: matchCat(r.cat, p) } : {}) }); res.updated++; }
      else { list.push({ id: `c_${uid()}`, name: r.name, cat: matchCat(r.cat, p), min, price: prices }); res.added++; }
    }
    saveOverride(ui.place, { services: list });
  } else {
    for (const r of data) {
      const { date, time } = parseWhen(r.date, r.time);
      const names = r.services.split(/\s*[;,+\n]\s*/).filter(Boolean);
      if (!date || !names.length) { res.skipped++; continue; }
      const t = time ?? '10:00';
      const svc = names.map((n) => p.allServices.find((s) => s.name.toLowerCase() === n.toLowerCase()));
      const cls = 0;
      const total = Math.round(num(r.total) ?? svc.reduce((a, s) => a + (s?.price[cls] ?? 0), 0));
      const minutes = Math.round(num(r.minutes) ?? (svc.reduce((a, s) => a + (s?.min ?? 0), 0) || 60));
      const dup = bookings.some((b) => b.placeId === p.id && b.date === date && b.time === t && (b.clientPhone ?? '') === r.phone && b.services.join(', ') === names.join(', '));
      if (dup) { res.skipped++; continue; }
      const future = bookingStart({ date, time: t }).getTime() > Date.now();
      const state = parseStatus(r.status, future);
      const plate = r.plate.toUpperCase();
      bookings.push({
        id: uid(), source: 'import', channel: 'other', placeId: p.id, services: names, total, paid: total, bonus: 0,
        minutes, date, time: t, car: [r.car, plate].filter(Boolean).join(' · ') || CAR_CLASSES[cls], plate, cls,
        clientName: r.name, clientPhone: r.phone, note: r.note, state, createdAt: Date.now(),
        ...(state === 'completed' ? { payment: parsePayment(r.payment), completedAt: bookingStart({ date, time: t }).getTime() + minutes * 60000 } : {}),
      });
      res.added++;
    }
  }
  save();
  ui.imp.result = { ...res, type };
  ui.imp.rows = null;
  ui.imp.text = '';
  rerenderKeepScroll();
  toast(`Імпорт завершено: додано ${res.added}, оновлено ${res.updated}, пропущено ${res.skipped}`);
}

// Порядок полів на екрані — звичний для людини, а не порядок розпізнавання.
const FIELD_ORDER = ['date', 'time', 'name', 'phone', 'car', 'plate', 'email', 'services', 'price', 'price2', 'price3', 'min', 'minutes', 'total', 'payment', 'status', 'cat', 'visits', 'spent', 'last', 'note'];

function viewImport() {
  const { type, rows, map, result } = ui.imp;
  const cfg = IMPORT[type];
  const shown = [...cfg.fields].sort((a, b) => FIELD_ORDER.indexOf(a[0]) - FIELD_ORDER.indexOf(b[0]));
  const head = rows?.[0] ?? [];
  const preview = rows ? importRows().slice(0, 5) : [];
  const missing = rows ? cfg.required.filter((req) => !req.split('|').some((f) => map[f] !== undefined && map[f] !== '')) : [];
  const fieldName = (f) => cfg.fields.find((x) => x[0] === f)[1];
  return `<h1>Імпорт даних</h1>
    <p class="page-sub">Перенесіть клієнтів, прайс та історію записів із вашої CRM чи таблиці — і працюйте далі в CARCAR</p>
    ${result ? `<p class="notice ok" role="status">${icon('checkCircle', 22)}<span><b>Імпорт завершено</b>Додано ${result.added}, оновлено ${result.updated}, пропущено ${result.skipped}.
      ${result.type === 'clients' ? '<a href="#/clients">Відкрити клієнтів</a>' : result.type === 'services' ? '<a href="#/services">Відкрити прайс</a>' : '<a href="#/schedule">Відкрити розклад</a>'}</span></p>` : ''}
    <div class="grid-2 import-grid">
      <section class="panel stack" aria-labelledby="h-imp1" style="gap:14px">
        <h2 id="h-imp1">1. Що переносимо</h2>
        <div class="seg" role="group" aria-label="Тип даних">
          ${Object.entries(IMPORT).map(([k, v]) => `<button data-action="imp-type" data-t="${k}" aria-pressed="${k === type}">${v.label}</button>`).join('')}
        </div>
        <p class="small muted" style="margin:0">Стовпці: ${cfg.note}. Назви стовпців можуть бути українською, російською чи англійською — ми їх упізнаємо, а відповідність можна змінити.</p>
        <button class="btn" data-action="imp-template" style="align-self:flex-start">${icon('download', 18)}Завантажити шаблон CSV</button>
      </section>
      <section class="panel stack" aria-labelledby="h-imp2" style="gap:14px">
        <h2 id="h-imp2">2. Файл або дані</h2>
        <label class="dropzone">${icon('upload', 24)}Обрати CSV-файл<input class="sr-only" id="imp-file" type="file" accept=".csv,.txt,text/csv,text/plain"></label>
        <form id="imp-paste" class="stack" style="gap:8px">
          <label class="field"><span>Або вставте рядки з таблиці (разом із заголовками)</span><textarea name="text" rows="4" placeholder="Імʼя;Телефон;Авто">${esc(ui.imp.text)}</textarea></label>
          <button class="btn" type="submit" style="align-self:flex-start">Розібрати</button>
        </form>
      </section>
    </div>
    <details class="panel howto"><summary>Як вивантажити дані з інших систем</summary>
      <ul>
        <li><b>YCLIENTS / Altegio:</b> «Клієнти» → «Клієнтська база» → «Експорт в Excel»; записи — у звіті «Записи» → «Завантажити».</li>
        <li><b>EasyWeek:</b> «Клієнти» → «Експорт»; записи — «Звіти» → «Записи» → «Експорт».</li>
        <li><b>RO App:</b> «Клієнти» → меню «⋯» → «Експорт»; замовлення — «Замовлення» → «Експорт».</li>
        <li><b>Excel, Google Таблиці, Numbers:</b> «Файл» → «Зберегти як» / «Завантажити» → <b>CSV</b>.</li>
      </ul>
      <p class="small muted">Файл .xlsx спершу відкрийте в Excel чи Google Таблицях і збережіть як CSV. Назви пунктів меню в інших системах можуть відрізнятися.</p>
    </details>
    ${rows ? `<section class="panel" aria-labelledby="h-imp3" style="margin-top:16px">
      <h2 id="h-imp3">3. Відповідність стовпців</h2>
      <p class="sub">Знайдено рядків: ${rows.length - 1}. Перевірте, з якого стовпця брати кожне поле.</p>
      <div class="map-grid">${shown.map(([f, label]) => `<label class="field"><span>${esc(label)}</span><select class="select" data-map="${f}">
        <option value="">— не імпортувати —</option>
        ${head.map((h, i) => `<option value="${i}" ${map[f] === i ? 'selected' : ''}>${esc(h || `Стовпець ${i + 1}`)}</option>`).join('')}</select></label>`).join('')}</div>
      <h3 class="biz-h3">Попередній перегляд</h3>
      <div class="table-wrap" tabindex="0" role="region" aria-label="Попередній перегляд імпорту"><table class="t">
        <thead><tr>${shown.filter(([f]) => map[f] !== undefined && map[f] !== '').map(([, l]) => `<th>${esc(l)}</th>`).join('')}</tr></thead>
        <tbody>${preview.map((r) => `<tr>${shown.filter(([f]) => map[f] !== undefined && map[f] !== '').map(([f]) => `<td>${esc(r[f])}</td>`).join('')}</tr>`).join('')}</tbody>
      </table></div>
      ${missing.length ? `<p class="notice warn" style="margin-top:12px">Оберіть стовпець для поля: ${missing.map((m) => m.split('|').map(fieldName).join(' або ')).join(', ')}.</p>` : ''}
      <div class="row" style="margin-top:12px">
        <button class="btn primary" data-action="imp-run" ${missing.length ? 'disabled' : ''}>Імпортувати ${rows.length - 1} ${plural(rows.length - 1, 'рядок', 'рядки', 'рядків')}</button>
        <button class="btn" data-action="imp-cancel">Скасувати</button>
      </div>
      ${type === 'bookings' ? '<p class="fine" style="margin-top:8px">Майбутні записи займуть бокси в застосунку клієнта. Записи без часу ставимо на 10:00, повтори пропускаємо.</p>' : ''}
      ${type === 'services' ? '<p class="fine" style="margin-top:8px">Послуги з такою самою назвою оновимо, нові — додамо до прайсу. Клієнти побачать зміни одразу.</p>' : ''}
      ${type === 'clients' ? '<p class="fine" style="margin-top:8px">Клієнтів з однаковим телефоном обʼєднуємо, навіть якщо номер записаний по-різному.</p>' : ''}
    </section>` : ''}`;
}

function loadImportText(text) {
  const rows = parseCsv(text);
  if (rows.length < 2) { toast('Потрібні заголовки й хоча б один рядок даних'); return; }
  const width = Math.max(...rows.map((r) => r.length));
  rows[0] = Array.from({ length: width }, (_, i) => rows[0][i] ?? '');
  Object.assign(ui.imp, { rows, map: autoMap(ui.imp.type, rows[0]), result: null });
  rerenderKeepScroll();
  document.getElementById('h-imp3')?.scrollIntoView({ block: 'start' });
}

// ---------- запити клієнтів ----------

const REQ_STATUS = { new: ['Новий', 'warn'], answered: ['Відповіли', 'carcar'], added: ['Послугу додано', 'ok'], closed: ['Закрито', 'muted'] };
const reqState = (r) => (r.closed ? 'closed' : r.service ? 'added' : r.messages.at(-1).from === 'client' ? 'new' : 'answered');
const ownRequests = () => requests.filter((r) => r.placeId === ui.place).sort((a, b) => b.messages.at(-1).at - a.messages.at(-1).at);

function viewRequests() {
  const all = ownRequests();
  const list = all.filter((r) => (ui.reqFilter === 'open' ? !r.closed && !r.service : true));
  // Точка відкрила розділ — нові повідомлення прочитані.
  const seen = all.map((r) => readMessages(r.messages, 'client')).some(Boolean);
  if (all.some((r) => r.unreadBiz) || seen) { for (const r of all) r.unreadBiz = false; save(); }
  const chats = own().filter((b) => b.chat?.length).sort((a, b) => (b.chatUnreadBiz - a.chatUnreadBiz) || b.chat.at(-1).at - a.chat.at(-1).at).slice(0, 12);
  return `<h1>Запити клієнтів</h1>
    <p class="page-sub">Повідомлення за оплаченими записами й запити, коли клієнт не знайшов потрібну послугу.</p>
    ${chats.length ? `<section class="panel" aria-labelledby="h-chats" style="margin-bottom:16px"><h2 id="h-chats">Повідомлення за записами</h2>
      <ul class="special-list chat-list">${chats.map((b) => `<li${b.chatUnreadBiz ? ' class="unread"' : ''}><span><b>${esc(clientName(b))} · ${dayLabel(b.date, { day: 'numeric', month: 'short' })}, ${b.time}</b>
        <small>${b.chat.at(-1).from === 'biz' ? 'Ви: ' : b.chat.at(-1).from === 'sys' ? '' : 'Клієнт: '}${esc(msgPreview(b.chat.at(-1)))}</small></span>
        ${b.chatUnreadBiz ? '<span class="pill warn">Нове</span>' : ''}<button class="btn" data-action="open-booking" data-id="${b.id}">Відкрити запис</button></li>`).join('')}</ul></section>` : ''}
    <h2 style="margin-top:0">Не знайшли послугу</h2>
    <div class="filters"><div class="seg" role="group" aria-label="Які запити показати">
      <button data-action="req-filter" data-f="open" aria-pressed="${ui.reqFilter === 'open'}">Відкриті · ${all.filter((r) => !r.closed && !r.service).length}</button>
      <button data-action="req-filter" data-f="all" aria-pressed="${ui.reqFilter === 'all'}">Усі · ${all.length}</button>
    </div></div>
    <div class="stack" style="gap:12px">
    ${list.length ? list.map((r) => {
      const [label, cls] = REQ_STATUS[reqState(r)];
      const key = phoneKey(r.clientPhone);
      return `<article class="panel stack req" style="gap:10px" aria-label="Запит від ${esc(r.clientName || 'клієнта')}">
        <div class="head"><div><b>${esc(r.clientName || 'Клієнт')}</b>
          <small class="muted" style="display:block">${r.clientPhone ? `<a href="tel:${esc(r.clientPhone.replace(/[^+\d]/g, ''))}">${esc(r.clientPhone)}</a>` : ''}${r.car ? ` · ${esc(r.car)}` : ''} · ${fmtTime(r.at)}</small></div>
          <span class="pill ${cls}">${label}</span></div>
        ${bizThread(r.messages)}
        ${r.closed ? '' : `<form class="req-answer inline-form" data-id="${r.id}"><label class="field"><span>Відповідь клієнту</span><input name="text" required maxlength="500" autocomplete="off" placeholder="Наприклад, так, робимо — 40 хвилин"></label>
          ${bizAttach('req')}<button class="btn" type="submit">Відповісти</button></form>
        <div class="row">
          <button class="btn primary" data-action="req-service" data-id="${r.id}">${icon('plus', 18)}Додати послугу</button>
          ${key && clientsList().some((c) => c.key === key) ? `<a class="btn" href="#/clients/${encodeURIComponent(key)}">Картка клієнта</a>` : ''}
          <button class="btn" data-action="req-close" data-id="${r.id}">Закрити запит</button>
        </div>`}
      </article>`;
    }).join('') : `<div class="empty-state">${icon('chat', 32)}<h2>${all.length ? 'Відкритих запитів немає' : 'Запитів ще немає'}</h2>
      <p>Клієнт може написати зі сторінки точки в застосунку, якщо не знайшов потрібної послуги.</p></div>`}
    </div>`;
}

function reqServiceDrawer(id) {
  const r = requests.find((x) => x.id === id);
  const p = place();
  const canPersonal = !!phoneKey(r.clientPhone);
  openDrawer('Додати послугу', `<form class="stack" id="req-service-form" data-id="${id}" style="gap:14px">
    <p class="small muted" style="margin:0">Запит: «${esc(r.messages[0].text)}»</p>
    <label class="field"><span>Назва послуги</span><input name="name" required maxlength="80" autocomplete="off"></label>
    <div class="form-grid">
      <label class="field"><span>Ціна, ₴</span><input name="price" type="number" min="1" step="1" required></label>
      <label class="field"><span>Тривалість, хв</span><input name="min" type="number" min="5" step="5" value="30" required></label>
      <label class="field full"><span>Категорія</span><select name="cat">${CATEGORIES.map((c) => `<option value="${c.id}" ${c.id === p.cats[0] ? 'selected' : ''}>${c.name}</option>`).join('')}</select></label>
    </div>
    <fieldset class="radio-row"><legend>Для кого</legend>
      <label><input type="radio" name="scope" value="all" checked> Для всіх — у прайс</label>
      <label><input type="radio" name="scope" value="personal" ${canPersonal ? '' : 'disabled'}> Лише для цього клієнта</label></fieldset>
    <p class="fine">${canPersonal ? 'Персональну послугу бачить лише цей клієнт — за своїм телефоном.' : 'Клієнт не залишив телефону, тож персональну послугу зробити не можна.'} У прайсі ціна однакова для всіх класів авто — змінити її можна в «Послугах і цінах».</p>
    <label class="field"><span>Повідомлення клієнту</span><input name="note" maxlength="200" placeholder="Необовʼязково" autocomplete="off"></label>
    <button class="btn primary" type="submit">Додати й повідомити клієнта</button>
  </form>`);
}

// ---------- відгуки ----------

const stars = (n) => `<span class="stars" role="img" aria-label="Оцінка ${rating(n)} з 5">${[1, 2, 3, 4, 5]
  .map((i) => `<span class="${i <= Math.round(n) ? 'on' : ''}">${icon('star', 14)}</span>`).join('')}</span>`;

function viewReviews() {
  const p = place();
  const list = reviews.filter((r) => r.placeId === p.id).sort((a, b) => b.at - a.at);
  const r = ratingFor(p.id, reviews);
  return `<h1>Відгуки</h1><p class="page-sub">Лише від клієнтів, які завершили замовлення через CARCAR. Ваша відповідь видна на сторінці точки. Видалити відгук не можна, але можна поскаржитися модератору CARCAR.</p>
    <section class="kpis" aria-label="Рейтинг">
      <div class="kpi"><span class="label">Рейтинг</span><span class="value">${r.count ? rating(r.avg) : '—'}</span>${r.count ? stars(r.avg) : ''}</div>
      <div class="kpi"><span class="label">Відгуків</span><span class="value">${r.count}</span></div>
      <div class="kpi"><span class="label">Без відповіді</span><span class="value">${list.filter((x) => !x.reply).length}</span></div>
    </section>
    <div class="stack" style="margin-top:16px">
      ${list.length ? list.map((x) => `<article class="panel stack" style="gap:8px">
        <div class="head">${stars(x.stars)}<span class="small muted">${fmtDate(x.date)}</span></div>
        ${x.text ? `<p style="margin:0">${esc(x.text)}</p>` : '<p class="muted" style="margin:0">Без тексту, лише оцінка.</p>'}
        ${x.photos?.length ? `<div class="photos">${x.photos.map((src, i) => `<img src="${esc(src)}" alt="Фото клієнта ${i + 1}">`).join('')}</div>` : ''}
        <span class="small muted">Підтверджений візит · ${esc(x.services)}</span>
        ${x.hidden ? `<p class="notice warn" style="margin:0">Приховано модератором CARCAR: ${esc(x.hidden.reason)}. Відгук не видно клієнтам і він не впливає на рейтинг.</p>`
          : x.report?.status === 'open' ? '<p class="small muted" style="margin:0">Скаргу надіслано модератору CARCAR.</p>'
          : x.report?.status === 'rejected' ? `<p class="small muted" style="margin:0">Модератор розглянув скаргу й залишив відгук${x.report.note ? `: ${esc(x.report.note)}` : ''}.</p>`
          : `<button class="btn text-danger" data-action="review-report" data-id="${x.id}" style="align-self:flex-start">Поскаржитися модератору</button>`}
        <form class="reply-form stack" data-id="${x.id}" style="gap:8px">
          <label class="field"><span>${x.reply ? 'Ваша відповідь' : 'Відповісти'}</span><textarea name="reply" rows="2" maxlength="500" required placeholder="Дякуємо за відгук!">${esc(x.reply?.text ?? '')}</textarea></label>
          <button class="btn" type="submit" style="align-self:flex-start">${x.reply ? 'Оновити відповідь' : 'Відповісти'}</button>
        </form>
      </article>`).join('') : `<div class="empty-state">${icon('star', 32)}<h2>Ще немає відгуків</h2><p>Клієнт може залишити відгук після того, як підтвердить виконання замовлення в застосунку.</p></div>`}
    </div>`;
}

// ---------- підключення до CARCAR ----------

const CONNECT_STEPS = ['Юридична особа', 'Документи', 'Реквізити для виплат', 'Договір-оферта'];

// Чернетка форми підключення: зберігається, лише коли точка натисне «Зберегти» чи «Надіслати».
function connectDraft() {
  if (ui.connect?.placeId !== ui.place) {
    const pt = partnerOf(ui.place);
    ui.connect = {
      placeId: ui.place, company: { type: 'fop', tax: 'ep3', ...pt.company }, docs: { ...pt.docs },
      payout: { ...pt.payout }, offer: pt.offer ?? null,
    };
  }
  return ui.connect;
}

const codeNote = (type, code) => (!code ? '' : codeValid(type, code)
  ? `<span class="ok-text">${icon('check', 14)}Контрольна сума правильна</span>`
  : `<span class="bad-text">${type === 'fop' ? 'РНОКПП — 10 цифр' : 'ЄДРПОУ — 8 цифр'}, контрольна сума не збігається</span>`);
const ibanNote = (iban) => (!iban ? '' : ibanValid(iban)
  ? `<span class="ok-text">${icon('check', 14)}${esc(ibanBank(iban))}</span>`
  : '<span class="bad-text">IBAN — UA і 27 цифр, контрольна сума не збігається</span>');

function viewConnect() {
  const p = place();
  const pt = partnerOf(p.id);
  const d = connectDraft();
  const c = d.company;
  const pay = d.payout;
  const [label, cls] = PARTNER_STATUS[pt.status];
  const miss = missingSteps(d);
  const last = [...pt.history].reverse().find((h) => h.by === 'admin');
  const tov = c.type === 'tov';
  const statusText = {
    draft: 'Заповніть усі кроки й надішліть заявку. Клієнти ще не бачать точку.',
    pending: 'Заявка на перевірці CARCAR — зазвичай до 3 робочих днів. Клієнти ще не бачать точку.',
    changes: 'Модератор попросив виправити дані. Внесіть зміни й надішліть заявку повторно.',
    approved: pt.demo && !pt.company ? 'Демо-точка вже в каталозі. Щоб виводити гроші, заповніть дані юрособи, реквізити й прийміть оферту.' : 'Точка в каталозі CARCAR, клієнти можуть записуватися й оплачувати.',
    rejected: 'Заявку відхилено. Виправте дані й надішліть повторно.',
    suspended: 'Точку призупинено модератором: клієнти не можуть записатися. Звʼяжіться з CARCAR.',
  }[pt.status];
  const docRow = ([id, name, req]) => `<li><label class="dropzone doc">${icon('upload', 20)}<span><b>${name}${req ? '' : ' (необовʼязково)'}</b>
      <small>${d.docs[id] ? `${esc(d.docs[id].name)} · ${Math.max(1, Math.round(d.docs[id].size / 1024))} КБ` : 'PDF або фото'}</small></span>
      <input class="sr-only" type="file" data-doc="${id}" accept="application/pdf,image/*"></label></li>`;
  return `<h1>Підключення до CARCAR</h1>
    <p class="page-sub">${esc(p.name)} · Дані бізнесу, документи, реквізити для виплат і договір-оферта</p>
    <section class="panel connect-status" aria-label="Статус підключення">
      <div class="head"><div class="row" style="gap:8px"><b>Статус</b><span class="pill ${cls}">${label}</span>
        ${pt.update === 'pending' ? '<span class="pill warn">Зміни на перевірці</span>' : ''}
        ${pt.payout?.iban ? `<span class="pill ${pt.payout.verified ? 'ok' : 'warn'}">Реквізити ${pt.payout.verified ? 'перевірено' : 'на перевірці'}</span>` : ''}</div>
        <a class="btn" href="#/offer">Текст оферти</a></div>
      <p style="margin:8px 0 0">${statusText}</p>
      ${last?.note && ['changes', 'rejected', 'suspended'].includes(pt.status) ? `<p class="notice warn" style="margin:10px 0 0"><b>Коментар модератора</b>${esc(last.note)}</p>` : ''}
      <ol class="steps-list">${CONNECT_STEPS.map((x) => `<li class="${miss.includes(x) ? '' : 'done'}">${icon(miss.includes(x) ? 'info' : 'checkCircle', 18)}${x}<span class="sr-only">${miss.includes(x) ? ' — не заповнено' : ' — готово'}</span></li>`).join('')}</ol>
    </section>
    <form id="connect-form" class="stack" style="gap:16px;margin-top:16px" novalidate>
      <section class="panel stack" aria-labelledby="h-c1" style="gap:12px">
        <h2 id="h-c1">1. Юридична особа</h2>
        <fieldset class="radio-row"><legend>Форма бізнесу</legend>
          ${Object.entries(ENTITY).map(([k, v]) => `<label><input type="radio" name="type" value="${k}" ${c.type === k ? 'checked' : ''}> ${v}</label>`).join('')}</fieldset>
        <div class="form-grid">
          <label class="field full"><span>${tov ? 'Повна назва юридичної особи' : 'ПІБ підприємця'}</span><input name="name" value="${esc(c.name ?? '')}" autocomplete="off" placeholder="${tov ? 'ТОВ «…»' : 'Прізвище Імʼя По батькові'}"></label>
          <label class="field"><span>${tov ? 'Код ЄДРПОУ' : 'РНОКПП (ІПН)'}</span><input name="code" inputmode="numeric" maxlength="${tov ? 8 : 10}" value="${esc(c.code ?? '')}" autocomplete="off" aria-describedby="code-check"></label>
          <label class="field"><span>Система оподаткування</span><select name="tax">${TAX[c.type].map(([k, v]) => `<option value="${k}" ${c.tax === k ? 'selected' : ''}>${v}</option>`).join('')}</select></label>
          <p class="check-note full" id="code-check" aria-live="polite">${codeNote(c.type, c.code)}</p>
          ${tov ? `<label class="field"><span>Керівник (ПІБ)</span><input name="director" value="${esc(c.director ?? '')}" autocomplete="off"></label>
            <label class="field"><span>Посада керівника</span><input name="directorRole" value="${esc(c.directorRole ?? 'Директор')}" autocomplete="off"></label>` : ''}
          <label class="field full"><span>Юридична адреса</span><input name="address" value="${esc(c.address ?? '')}" autocomplete="off"></label>
          <label class="field"><span>Email для документів</span><input name="email" type="email" value="${esc(c.email ?? '')}" autocomplete="off"></label>
          <label class="field"><span>Телефон відповідальної особи</span><input name="phone" inputmode="tel" value="${esc(c.phone ?? '')}" autocomplete="off" placeholder="+380"></label>
          <label class="row full"><input class="check" type="checkbox" name="vat" ${c.vat ? 'checked' : ''}>Платник ПДВ</label>
        </div>
      </section>
      <section class="panel stack" aria-labelledby="h-c2" style="gap:12px">
        <h2 id="h-c2">2. Документи</h2>
        <p class="sub" style="margin:0">Модератор звірить дані з ЄДР. У прототипі файл не надсилається на сервер — зберігаємо лише назву й розмір.</p>
        <ul class="doc-list">${DOCS.map(docRow).join('')}</ul>
      </section>
      <section class="panel stack" aria-labelledby="h-c3" style="gap:12px">
        <h2 id="h-c3">3. Реквізити для виплат</h2>
        <p class="sub" style="margin:0">Лише рахунок, відкритий на ${tov ? 'цю юридичну особу' : 'цього ФОП'}: код отримувача має збігатися з кодом вище. Після зміни реквізитів виплати призупиняються до перевірки.</p>
        <div class="form-grid">
          <label class="field full"><span>IBAN</span><input name="iban" value="${esc(formatIban(pay.iban ?? ''))}" autocomplete="off" placeholder="UA00 0000 0000 0000 0000 0000 0000 0" aria-describedby="iban-check"></label>
          <p class="check-note full" id="iban-check" aria-live="polite">${ibanNote(pay.iban)}</p>
          <label class="field"><span>Отримувач</span><input name="holder" value="${esc(pay.holder ?? '')}" autocomplete="off" placeholder="${tov ? 'Назва юрособи' : 'ФОП Прізвище І. П.'}"></label>
          <label class="field"><span>Код отримувача</span><input name="payCode" inputmode="numeric" maxlength="10" value="${esc(pay.code ?? '')}" autocomplete="off"></label>
        </div>
      </section>
      <section class="panel stack" aria-labelledby="h-c4" style="gap:12px">
        <h2 id="h-c4">4. Договір-оферта</h2>
        <div class="offer-box" tabindex="0" role="region" aria-label="Текст оферти">${offerHtml(esc)}</div>
        ${d.offer?.version === OFFER.version ? `<p class="notice ok" style="margin:0">${icon('checkCircle', 20)}<span>Прийнято ${fmtTime(d.offer.acceptedAt)} · ${esc(d.offer.signer)}${d.offer.position ? `, ${esc(d.offer.position)}` : ''}</span></p>` : `
        <div class="form-grid">
          <label class="field"><span>Хто приймає умови (ПІБ)</span><input name="signer" value="${esc(c.director ?? c.name ?? '')}" autocomplete="off"></label>
          <label class="field"><span>Посада</span><input name="position" value="${esc(tov ? c.directorRole ?? 'Директор' : 'ФОП')}" autocomplete="off"></label>
        </div>
        <label class="row"><input class="check" type="checkbox" name="accept">Я ознайомився(-лася) з умовами й приймаю оферту (редакція ${OFFER.version})</label>`}
      </section>
      <div class="sticky-actions">
        <button class="btn" type="submit" value="save">Зберегти чернетку</button>
        <button class="btn primary" type="submit" value="submit">${pt.status === 'approved' ? 'Надіслати зміни на перевірку' : 'Надіслати на перевірку'}</button>
      </div>
    </form>`;
}

// Зчитує поля форми в чернетку (без збереження).
function collectConnect() {
  const f = $('#connect-form');
  if (!f) return;
  const d = connectDraft();
  const v = (n) => f.elements[n]?.value?.trim() ?? '';
  Object.assign(d.company, {
    type: f.elements.type.value, name: v('name'), code: v('code').replace(/\D/g, ''), tax: v('tax'), address: v('address'),
    email: v('email'), phone: v('phone'), vat: f.elements.vat.checked,
    ...(f.elements.director ? { director: v('director'), directorRole: v('directorRole') } : {}),
  });
  Object.assign(d.payout, { iban: normIban(v('iban')), holder: v('holder'), code: v('payCode').replace(/\D/g, '') });
  if (f.elements.accept) d.offerAccept = { checked: f.elements.accept.checked, signer: v('signer'), position: v('position') };
}

function saveConnect(intent) {
  collectConnect();
  const d = connectDraft();
  const pt = partnerOf(ui.place);
  if (d.offerAccept?.checked) {
    if (!d.offerAccept.signer) { toast('Вкажіть, хто приймає умови оферти'); return; }
    d.offer = { version: OFFER.version, acceptedAt: Date.now(), signer: d.offerAccept.signer, position: d.offerAccept.position };
  }
  delete d.offerAccept;
  // Нові чи змінені реквізити не перевірені, доки їх не підтвердить модератор.
  const old = pt.payout ?? {};
  const changed = normIban(old.iban) !== d.payout.iban || old.holder !== d.payout.holder || old.code !== d.payout.code;
  const payout = { ...d.payout, verified: changed ? false : !!old.verified };
  const patch = { company: { ...d.company }, docs: { ...d.docs }, payout, offer: d.offer };
  if (intent === 'submit') {
    const miss = missingSteps(patch);
    if (miss.length) { toast(`Заповніть: ${miss.join(', ').toLowerCase()}`); rerenderKeepScroll(); return; }
    const history = [...pt.history, { at: Date.now(), by: 'partner', status: 'pending', note: pt.status === 'approved' ? 'Зміни надіслано на перевірку' : 'Заявку надіслано на перевірку' }];
    if (pt.status === 'approved') Object.assign(patch, { update: 'pending', history });
    else Object.assign(patch, { status: 'pending', submittedAt: Date.now(), history });
  }
  savePartner(ui.place, patch);
  ui.connect = null;
  rerenderKeepScroll();
  toast(intent === 'submit' ? 'Заявку надіслано — CARCAR перевірить дані до 3 робочих днів' : 'Чернетку збережено');
}

function viewOffer() {
  return `<a class="back" href="#/connect">${icon('chevL', 22)}Підключення</a><h1>Договір-оферта</h1>
    <div class="panel offer-page">${offerHtml(esc).replace('<h2>', '<h2 class="offer-title">')}</div>`;
}

function newPlaceDrawer() {
  const opts = (sel, from, to) => Array.from({ length: to - from + 1 }, (_, i) => from + i).map((h) => `<option value="${h}" ${h === sel ? 'selected' : ''}>${pad(h)}:00</option>`).join('');
  openDrawer('Нова точка', `<form class="stack" id="place-form" style="gap:14px">
    <label class="field"><span>Назва точки</span><input name="name" required maxlength="60" autocomplete="off" placeholder="Наприклад, Автомийка «Хвиля»"></label>
    <fieldset class="radio-row"><legend>Що робите</legend>
      ${CATEGORIES.map((c) => `<label><input type="checkbox" name="cats" value="${c.id}"> ${c.name}</label>`).join('')}</fieldset>
    <div class="form-grid">
      <label class="field"><span>Район</span><select name="district">${Object.keys(DISTRICTS).map((x) => `<option>${x}</option>`).join('')}</select></label>
      <label class="field"><span>Адреса</span><input name="address" required autocomplete="off" placeholder="вул. …, 1"></label>
      <label class="field"><span>Телефон точки</span><input name="phone" required inputmode="tel" autocomplete="off" placeholder="+380"></label>
      <label class="field"><span>Кількість боксів</span><input name="boxes" type="number" min="1" max="20" value="2" required></label>
      <label class="field"><span>Відкриття</span><select name="open">${opts(8, 0, 23)}</select></label>
      <label class="field"><span>Закриття</span><select name="close">${opts(20, 1, 24)}</select></label>
    </div>
    <p class="fine">Прайс заповнимо стандартними послугами обраних категорій — змініть його в «Послугах і цінах». Клієнти побачать точку після перевірки CARCAR.</p>
    <button class="btn primary" type="submit">Створити й перейти до підключення</button>
  </form>`);
}

// ---------- персонал і ролі ----------

// Хто зараз працює в панелі. Без співробітників панель відкриває власник.
const OWNER = { id: 'owner', name: 'Власник', role: 'owner' };
function me() {
  const staff = staffOf(ui.place).filter((x) => x.active !== false);
  const id = store.peek('biz.session', {})[ui.place];
  return staff.find((x) => x.id === id) ?? staff.find((x) => x.role === 'owner') ?? OWNER;
}
// Що бачить кожна роль. Власник — усе; 'assign' — право призначати майстрів.
const ACCESS = {
  admin: ['', 'schedule', 'queue', 'clients', 'requests', 'support', 'services', 'deals', 'passes', 'mailings', 'reviews', 'stock', 'settings', 'import', 'assign', 'offer'],
  master: ['schedule', 'queue', 'earnings'],
};
const can = (page) => (me().role === 'owner' ? page !== 'earnings' : ACCESS[me().role].includes(page));
const masters = () => staffOf(ui.place).filter((x) => x.role === 'master' && x.active !== false);
const masterName = (b) => staffOf(ui.place).find((x) => x.id === b.masterId)?.name ?? null;
const masterBusy = (id, b) => own().some((x) => x !== b && x.masterId === id && x.date === b.date && BLOCKING.includes(x.state)
  && toMin(x.time) < toMin(b.time) + b.minutes && toMin(x.time) + x.minutes > toMin(b.time));

function saveStaff(list) {
  const all = store.get('biz.staff', {});
  all[ui.place] = list;
  store.set('biz.staff', all);
}

function viewStaff() {
  const staff = staffOf(ui.place);
  const n = ui.period;
  const [from, to] = rangeOf(n);
  const works = own().filter((b) => b.state === 'completed' && b.masterId && inRange(b, [from, to]));
  const rows = masters().map((m) => {
    const list = works.filter((b) => b.masterId === m.id);
    const base = list.reduce((a, b) => a + workBase(b), 0);
    return { m, count: list.length, base, pay: Math.round((base * (m.pct || 0)) / 100) };
  });
  const unassigned = own().filter((b) => b.state === 'completed' && !b.masterId && inRange(b, [from, to])).length;
  return `<h1>Персонал</h1><p class="page-sub">Ролі визначають, що бачить людина в панелі. Зарплата майстрів — відсоток від виконаних робіт, вона щодня потрапляє у «Витрати».</p>
    <div class="filters">${periodSeg('period', n)}<span class="spacer"></span>
      <button class="btn primary" data-action="staff-add">${icon('plus', 18)}Додати співробітника</button></div>
    <div class="table-wrap" tabindex="0" role="region" aria-label="Співробітники"><table class="t">
      <thead><tr><th>Імʼя</th><th>Роль</th><th>Телефон</th><th class="num">Відсоток від робіт</th><th>Статус</th><th><span class="sr-only">Дії</span></th></tr></thead>
      <tbody>${staff.length ? staff.map((x) => `<tr class="${x.active === false ? 'off' : ''}"><td>${esc(x.name)}</td><td>${ROLES[x.role]}</td><td>${esc(x.phone || '—')}</td>
        <td class="num">${x.role === 'master' ? `${x.pct || 0}%` : '—'}</td><td>${x.active === false ? '<span class="pill muted">Не працює</span>' : '<span class="pill ok">Працює</span>'}</td>
        <td><button class="btn" data-action="staff-edit" data-id="${x.id}">Змінити</button></td></tr>`).join('')
        : '<tr><td colspan="6" class="muted">Поки працює лише власник. Додайте адміністраторів і майстрів, щоб призначати майстрів на записи й рахувати зарплату.</td></tr>'}</tbody>
    </table></div>
    <div class="grid-3" style="margin-top:16px">
      <section class="panel" aria-labelledby="h-pay">
        <h2 id="h-pay">Зарплата майстрів</h2><p class="sub">${fmtDate(from)} — ${fmtDate(to)}</p>
        ${rows.length ? `<div class="table-wrap" tabindex="0" role="region" aria-label="Нарахування майстрам"><table class="t">
          <thead><tr><th>Майстер</th><th class="num">Робіт</th><th class="num">Сума робіт</th><th class="num">%</th><th class="num">Нараховано</th></tr></thead>
          <tbody>${rows.map((r) => `<tr><td>${esc(r.m.name)}</td><td class="num">${r.count}</td><td class="num">${uah(r.base)}</td><td class="num">${r.m.pct || 0}%</td><td class="num">${uah(r.pay)}</td></tr>`).join('')}</tbody>
          <tfoot><tr><td>Разом</td><td class="num">${rows.reduce((a, r) => a + r.count, 0)}</td><td class="num">${uah(rows.reduce((a, r) => a + r.base, 0))}</td><td></td><td class="num">${uah(rows.reduce((a, r) => a + r.pay, 0))}</td></tr></tfoot>
        </table></div>` : '<p class="muted" style="margin:0">Додайте майстрів із відсотком від робіт.</p>'}
        ${unassigned ? `<p class="small muted">Без майстра виконано ${unassigned} ${plural(unassigned, 'запис', 'записи', 'записів')} — з них зарплата не нараховується. Призначайте майстра в картці запису.</p>` : ''}
      </section>
      <section class="panel" aria-labelledby="h-roles">
        <h2 id="h-roles">Що бачать ролі</h2>
        <dl class="kv">
          <dt>Власник</dt><dd>Усе, зокрема фінанси, витрати, персонал і підключення.</dd>
          <dt>Адміністратор</dt><dd>Розклад, черга, клієнти, прайс, склад, продажі й розсилки. Без фінансів і зарплат.</dd>
          <dt>Майстер</dt><dd>Свої записи в розкладі, черга й власний заробіток.</dd>
        </dl>
        <p class="fine">Перемкнути, від чийого імені працює панель, можна вгорі — «Ви». У робочій версії кожен входить під своїм номером телефону.</p>
      </section>
    </div>`;
}

function staffDrawer(id) {
  const x = staffOf(ui.place).find((s) => s.id === id) ?? { role: 'master', pct: 30, active: true };
  openDrawer(id ? 'Співробітник' : 'Новий співробітник', `<form class="stack" id="staff-form" data-id="${id ?? ''}" style="gap:14px">
    <label class="field"><span>Імʼя</span><input name="name" required maxlength="60" value="${esc(x.name ?? '')}" autocomplete="off"></label>
    <div class="form-grid">
      <label class="field"><span>Роль</span><select name="role">${Object.entries(ROLES).map(([k, v]) => `<option value="${k}" ${x.role === k ? 'selected' : ''}>${v}</option>`).join('')}</select></label>
      <label class="field"><span>Відсоток від робіт, %</span><input name="pct" type="number" min="0" max="100" step="1" value="${x.pct ?? 0}"></label>
      <label class="field full"><span>Телефон</span><input name="phone" inputmode="tel" value="${esc(x.phone ?? '')}" autocomplete="off" placeholder="+380"></label>
    </div>
    <p class="fine">Відсоток рахується лише для майстрів. Фіксовану зарплату адміністратора додайте як щомісячну витрату.</p>
    <label class="row"><input class="check" type="checkbox" name="active" ${x.active === false ? '' : 'checked'}>Працює зараз</label>
    <button class="btn primary" type="submit">${id ? 'Зберегти' : 'Додати'}</button>
  </form>`);
}

function viewEarnings() {
  const m = me();
  const n = ui.period;
  const range = rangeOf(n);
  const list = own().filter((b) => b.masterId === m.id && b.state === 'completed' && inRange(b, range)).sort((a, b) => (b.date + b.time).localeCompare(a.date + a.time));
  const base = list.reduce((a, b) => a + workBase(b), 0);
  const next = own().filter((b) => b.masterId === m.id && BLOCKING.includes(b.state) && !isPast(b)).sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time));
  return `<h1>Мій заробіток</h1><p class="page-sub">${esc(m.name)} · ${m.pct || 0}% від виконаних робіт</p>
    <div class="filters">${periodSeg('period', n)}</div>
    <section class="kpis" aria-label="Мій заробіток">
      <div class="kpi hero"><span class="label">Нараховано</span><span class="value">${uah(Math.round((base * (m.pct || 0)) / 100))}</span><span class="kpi-note">${list.length} ${plural(list.length, 'робота', 'роботи', 'робіт')} на ${uah(base)}</span></div>
      <div class="kpi"><span class="label">Найближчі записи</span><span class="value">${next.length}</span></div>
    </section>
    <h2 class="biz-h2">Роботи за період</h2>
    <div class="table-wrap" tabindex="0" role="region" aria-label="Мої роботи"><table class="t">
      <thead><tr><th>Дата</th><th>Послуги</th><th>Авто</th><th class="num">Сума робіт</th><th class="num">Мені</th></tr></thead>
      <tbody>${list.length ? list.map((b) => `<tr><td>${dayLabel(b.date, { day: 'numeric', month: 'short' })}, ${b.time}</td><td>${esc(b.services.join(', '))}</td><td>${esc(b.car)}</td>
        <td class="num">${uah(workBase(b))}</td><td class="num">${uah(Math.round((workBase(b) * (m.pct || 0)) / 100))}</td></tr>`).join('') : '<tr><td colspan="5" class="muted">Виконаних робіт за період немає.</td></tr>'}</tbody>
    </table></div>`;
}

// ---------- склад ----------

const UNITS = ['л', 'мл', 'кг', 'г', 'шт', 'м', 'уп'];
const stockData = () => ({ items: [], norms: {}, moves: [], ...store.peek('biz.stock', {})[ui.place] });
function saveStock(patch) {
  const all = store.get('biz.stock', {});
  all[ui.place] = { ...stockData(), ...patch };
  store.set('biz.stock', all);
}
const qtyText = (v, unit) => `${(Math.round(v * 100) / 100).toLocaleString('uk-UA')} ${unit}`;

// Залишок: стартова кількість, прихід і коригування, мінус списання за нормами з виконаних записів.
function stockLevels() {
  const st = stockData();
  const svcId = new Map(place().allServices.map((x) => [x.name, x.id]));
  const used = new Map();
  const used30 = new Map();
  const month = Date.now() - 30 * 864e5;
  for (const b of own()) {
    if (b.state !== 'completed') continue;
    const at = b.completedAt ?? bookingStart(b).getTime();
    for (const name of b.services) {
      const norm = st.norms[svcId.get(name)];
      if (!norm) continue;
      for (const [itemId, amount] of Object.entries(norm)) {
        const it = st.items.find((i) => i.id === itemId);
        if (!it || at < it.since) continue;
        used.set(itemId, (used.get(itemId) ?? 0) + amount);
        if (at >= month) used30.set(itemId, (used30.get(itemId) ?? 0) + amount);
      }
    }
  }
  return st.items.map((it) => {
    const qty = it.qty0 + st.moves.filter((m) => m.itemId === it.id).reduce((a, m) => a + m.delta, 0) - (used.get(it.id) ?? 0);
    const perDay = (used30.get(it.id) ?? 0) / 30;
    return { ...it, qty: Math.round(qty * 100) / 100, perDay, days: perDay > 0 ? Math.floor(Math.max(0, qty) / perDay) : null, low: qty <= it.min };
  });
}
const lowStock = () => stockLevels().filter((x) => x.low);

function viewStock() {
  const levels = stockLevels();
  const st = stockData();
  const p = place();
  const low = levels.filter((x) => x.low);
  return `<h1>Склад</h1><p class="page-sub">Хімія, витратні матеріали й запчастини. Списуються автоматично за нормами, коли запис виконано; закупівля одразу йде у витрати.</p>
    <div class="filters"><span class="spacer"></span>
      <button class="btn" data-action="stock-list" ${low.length ? '' : 'disabled'}>${icon('download', 18)}Список закупівлі</button>
      <button class="btn" data-action="stock-item">${icon('plus', 18)}Нова позиція</button>
      <button class="btn primary" data-action="stock-in" ${levels.length ? '' : 'disabled'}>Прихід</button></div>
    ${low.length ? `<p class="notice warn">${icon('warn', 18)}<span><b>Час закупити</b>${low.map((x) => `${esc(x.name)} — лишилось ${qtyText(Math.max(0, x.qty), x.unit)}`).join('; ')}.</span></p>` : ''}
    <div class="table-wrap" tabindex="0" role="region" aria-label="Залишки"><table class="t">
      <thead><tr><th>Позиція</th><th class="num">Залишок</th><th class="num">Мінімум</th><th class="num">Вистачить</th><th class="num">Ціна за од.</th><th>Стан</th><th><span class="sr-only">Дії</span></th></tr></thead>
      <tbody>${levels.length ? levels.map((x) => `<tr><td>${esc(x.name)}<small>${esc(x.cat)}</small></td><td class="num">${qtyText(x.qty, x.unit)}</td><td class="num">${qtyText(x.min, x.unit)}</td>
        <td class="num">${x.days === null ? '—' : `≈ ${x.days} ${daysWord(x.days)}`}</td><td class="num">${uah(x.cost)}</td>
        <td>${x.low ? '<span class="pill warn">Закінчується</span>' : '<span class="pill ok">Достатньо</span>'}</td>
        <td><button class="btn" data-action="stock-adjust" data-id="${x.id}">Коригування</button></td></tr>`).join('')
        : '<tr><td colspan="7" class="muted">Додайте позиції складу й норми списання на послуги.</td></tr>'}</tbody>
    </table></div>
    <h2 class="biz-h2">Норми списання на послугу</h2>
    <div class="table-wrap" tabindex="0" role="region" aria-label="Норми списання"><table class="t">
      <thead><tr><th>Послуга</th><th>Що списується</th><th><span class="sr-only">Дії</span></th></tr></thead>
      <tbody>${p.allServices.map((x) => {
        const norm = st.norms[x.id] ?? {};
        const parts = Object.entries(norm).map(([id, a]) => { const it = st.items.find((i) => i.id === id); return it ? `${esc(it.name)} ${qtyText(a, it.unit)}` : ''; }).filter(Boolean);
        return `<tr><td>${esc(x.name)}</td><td>${parts.join(', ') || '<span class="muted">не задано</span>'}</td><td><button class="btn" data-action="stock-norms" data-id="${x.id}" ${levels.length ? '' : 'disabled'} aria-label="Норми: ${esc(x.name)}">Змінити</button></td></tr>`;
      }).join('')}</tbody>
    </table></div>
    ${st.moves.length ? `<h2 class="biz-h2">Рух складу</h2>
    <div class="table-wrap" tabindex="0" role="region" aria-label="Рух складу"><table class="t">
      <thead><tr><th>Дата</th><th>Позиція</th><th>Причина</th><th class="num">Кількість</th><th class="num">Сума</th></tr></thead>
      <tbody>${[...st.moves].reverse().slice(0, 50).map((m) => { const it = st.items.find((i) => i.id === m.itemId); return `<tr><td>${fmtTime(m.at)}</td><td>${esc(it?.name ?? '')}</td><td>${esc(m.reason)}</td>
        <td class="num">${m.delta > 0 ? '+' : ''}${qtyText(m.delta, it?.unit ?? '')}</td><td class="num">${m.cost ? uah(m.cost) : '—'}</td></tr>`; }).join('')}</tbody>
    </table></div>` : ''}`;
}

function stockItemDrawer() {
  openDrawer('Нова позиція складу', `<form class="stack" id="stock-item-form" style="gap:14px">
    <label class="field"><span>Назва</span><input name="name" required maxlength="80" autocomplete="off" placeholder="Наприклад, шампунь для безконтактної мийки"></label>
    <div class="form-grid">
      <label class="field"><span>Одиниця</span><select name="unit">${UNITS.map((u) => `<option>${u}</option>`).join('')}</select></label>
      <label class="field"><span>Зараз на складі</span><input name="qty" type="number" min="0" step="0.01" value="0" required></label>
      <label class="field"><span>Мінімальний залишок</span><input name="min" type="number" min="0" step="0.01" value="1" required></label>
      <label class="field"><span>Ціна за одиницю, ₴</span><input name="cost" type="number" min="0" step="0.01" value="0"></label>
      <label class="field full"><span>Категорія витрат</span><select name="cat">${['Хімія й витратні матеріали', 'Запчастини'].map((c) => `<option>${c}</option>`).join('')}</select></label>
    </div>
    <p class="fine">Коли залишок опуститься до мінімуму, панель нагадає про закупівлю.</p>
    <button class="btn primary" type="submit">Додати позицію</button>
  </form>`);
}

function stockMoveDrawer(kind, itemId) {
  const items = stockLevels();
  openDrawer(kind === 'in' ? 'Прихід на склад' : 'Коригування залишку', `<form class="stack" id="stock-move-form" data-kind="${kind}" style="gap:14px">
    <label class="field"><span>Позиція</span><select name="item">${items.map((x) => `<option value="${x.id}" ${x.id === itemId ? 'selected' : ''}>${esc(x.name)} — ${qtyText(x.qty, x.unit)}</option>`).join('')}</select></label>
    <div class="form-grid">
      <label class="field"><span>${kind === 'in' ? 'Кількість' : 'Зміна (мінус — списати)'}</span><input name="qty" type="number" step="0.01" ${kind === 'in' ? 'min="0.01"' : ''} required></label>
      ${kind === 'in' ? `<label class="field"><span>Сума закупівлі, ₴</span><input name="sum" type="number" min="0" step="1" required></label>
        <fieldset class="radio-row full"><legend>Як оплачено</legend>${Object.entries(PAY_METHODS).map(([k, v], i) => `<label><input type="radio" name="method" value="${k}" ${i === 0 ? 'checked' : ''}> ${v}</label>`).join('')}</fieldset>`
        : `<label class="field"><span>Причина</span><select name="reason"><option>Інвентаризація</option><option>Брак чи розлив</option><option>Використано поза записом</option><option>Інше</option></select></label>`}
    </div>
    ${kind === 'in' ? '<p class="fine">Сума закупівлі одразу потрапить у «Витрати».</p>' : ''}
    <button class="btn primary" type="submit">${kind === 'in' ? 'Оприбуткувати' : 'Зберегти'}</button>
  </form>`);
}

function stockNormsDrawer(serviceId) {
  const svc = place().allServices.find((x) => x.id === serviceId);
  const st = stockData();
  const norm = st.norms[serviceId] ?? {};
  openDrawer(`Норми: ${esc(svc.name)}`, `<form class="stack" id="stock-norms-form" data-id="${serviceId}" style="gap:14px">
    <p class="small muted" style="margin:0">Скільки витрачається на одну послугу. Порожньо — не списується.</p>
    ${st.items.map((it) => `<label class="field"><span>${esc(it.name)}, ${it.unit}</span><input name="${it.id}" type="number" min="0" step="0.01" value="${norm[it.id] ?? ''}"></label>`).join('')}
    <button class="btn primary" type="submit">Зберегти норми</button>
  </form>`);
}

// ---------- абонементи й сертифікати ----------

function viewPasses() {
  const { plans, sold } = passesOf(ui.place);
  const n = ui.period;
  const [from] = rangeOf(n);
  const since = parseDate(from).getTime();
  const recent = sold.filter((x) => x.soldAt >= since);
  return `<h1>Абонементи й сертифікати</h1><p class="page-sub">Абонемент — кілька візитів наперед зі знижкою. Подарунковий сертифікат — сума, якою оплачують будь-які послуги. Клієнти купують їх у застосунку CARCAR або у вас на місці.</p>
    <div class="filters">${periodSeg('period', n)}<span class="spacer"></span>
      <button class="btn" data-action="pass-sell" ${plans.some((x) => x.active !== false) ? '' : 'disabled'}>Продати на місці</button>
      <button class="btn primary" data-action="plan-add">${icon('plus', 18)}Новий абонемент чи сертифікат</button></div>
    <section class="kpis" aria-label="Продажі абонементів">
      <div class="kpi hero"><span class="label">Продано за період</span><span class="value">${uah(recent.reduce((a, x) => a + x.price, 0))}</span><span class="kpi-note">${recent.length} шт · через CARCAR ${uah(recent.filter((x) => x.source === 'carcar').reduce((a, x) => a + x.price, 0))}</span></div>
      <div class="kpi"><span class="label">Активних абонементів</span><span class="value">${sold.filter((x) => x.kind === 'sub' && passActive(x)).length}</span></div>
      <div class="kpi"><span class="label">Залишок на сертифікатах</span><span class="value">${uah(sold.filter((x) => x.kind === 'cert' && passActive(x)).reduce((a, x) => a + x.balance, 0))}</span><span class="kpi-note">ще не використано</span></div>
    </section>
    <h2 class="biz-h2">Що продаємо</h2>
    ${plans.length ? `<div class="plan-grid">${plans.map((x) => `<article class="panel plan ${x.active === false ? 'off' : ''}">
      <span class="pill ${x.kind === 'sub' ? 'carcar' : 'ok'}">${PASS_KIND[x.kind]}</span>
      <h3>${esc(x.name)}</h3>
      <p class="price-big">${uah(x.price)}</p>
      <p class="small muted" style="margin:0">${x.kind === 'sub' ? `${x.visits} ${plural(x.visits, 'візит', 'візити', 'візитів')} на ${x.validDays} ${daysWord(x.validDays)}${x.services?.length ? ` · ${x.services.map((id) => esc(place().allServices.find((s) => s.id === id)?.name ?? '')).join(', ')}` : ' · будь-яка послуга'}` : `номінал ${uah(x.amount)} · діє ${x.validDays} ${daysWord(x.validDays)}`}</p>
      <label class="row small"><input class="check" type="checkbox" data-action="plan-toggle" data-id="${x.id}" ${x.active === false ? '' : 'checked'} aria-label="Продається: ${esc(x.name)}">Продається</label>
    </article>`).join('')}</div>` : '<p class="muted">Створіть, наприклад, «8 мийок на місяць» або подарунковий сертифікат на детейлінг.</p>'}
    <h2 class="biz-h2">Продані</h2>
    <div class="table-wrap" tabindex="0" role="region" aria-label="Продані абонементи й сертифікати"><table class="t">
      <thead><tr><th>Код</th><th>Що</th><th>Клієнт</th><th>Залишок</th><th>Діє до</th><th>Де куплено</th></tr></thead>
      <tbody>${sold.length ? [...sold].reverse().slice(0, 100).map((x) => `<tr class="${passActive(x) ? '' : 'off'}"><td><code>${esc(x.code)}</code></td><td>${esc(x.name)}</td>
        <td>${esc(x.clientName || (x.gift ? 'подарунок' : '—'))}<small>${esc(x.phone || '')}</small></td><td>${passLeft(x)}</td><td>${fmtDate(x.validUntil)}</td>
        <td>${x.source === 'carcar' ? '<span class="pill carcar"><i></i>CARCAR</span>' : `<span class="pill cash"><i></i>${x.payment === 'cash' ? 'Готівка' : 'Картка'}</span>`}</td></tr>`).join('')
        : '<tr><td colspan="6" class="muted">Ще нічого не продано.</td></tr>'}</tbody>
    </table></div>`;
}

function planDrawer() {
  const p = place();
  openDrawer('Новий абонемент чи сертифікат', `<form class="stack" id="plan-form" style="gap:14px">
    <fieldset class="radio-row"><legend>Тип</legend>
      <label><input type="radio" name="kind" value="sub" checked> Абонемент на візити</label>
      <label><input type="radio" name="kind" value="cert"> Подарунковий сертифікат</label></fieldset>
    <label class="field"><span>Назва</span><input name="name" required maxlength="60" autocomplete="off" placeholder="8 мийок на місяць"></label>
    <div class="form-grid">
      <label class="field"><span>Ціна, ₴</span><input name="price" type="number" min="1" step="1" required></label>
      <label class="field"><span>Діє, днів</span><input name="validDays" type="number" min="1" max="730" value="30" required></label>
      <label class="field"><span>Візитів (для абонемента)</span><input name="visits" type="number" min="1" max="100" value="8"></label>
      <label class="field"><span>Номінал (для сертифіката), ₴</span><input name="amount" type="number" min="1" step="1"></label>
    </div>
    <fieldset class="radio-row svc-scope"><legend>На які послуги діє абонемент (не обрано — будь-яка)</legend>
      ${p.services.map((x) => `<label><input type="checkbox" name="services" value="${x.id}"> ${esc(x.name)}</label>`).join('')}</fieldset>
    <p class="fine">Один візит абонемента покриває одну послугу з обраних. Сертифікатом можна оплатити будь-які послуги до його номіналу.</p>
    <button class="btn primary" type="submit">Створити</button>
  </form>`);
}

function sellDrawer() {
  const { plans } = passesOf(ui.place);
  openDrawer('Продати на місці', `<form class="stack" id="sell-form" style="gap:14px">
    <label class="field"><span>Що продаємо</span><select name="plan">${plans.filter((x) => x.active !== false).map((x) => `<option value="${x.id}">${esc(x.name)} — ${uah(x.price)}</option>`).join('')}</select></label>
    <div class="form-grid">
      <label class="field"><span>Імʼя покупця</span><input name="clientName" required autocomplete="off"></label>
      <label class="field"><span>Телефон покупця</span><input name="phone" required inputmode="tel" placeholder="+380" autocomplete="off"></label>
    </div>
    <fieldset class="radio-row"><legend>Оплата</legend><label><input type="radio" name="payment" value="card" checked> Картка</label><label><input type="radio" name="payment" value="cash"> Готівка</label></fieldset>
    <button class="btn primary" type="submit">Продати</button>
  </form>`);
}

// ---------- розсилки ----------

const SEGMENTS = {
  all: ['Усі клієнти', () => true],
  lost: ['Давно не були (45+ днів)', (c) => c.visits > 0 && daysSince(c.last) >= 45 && !c.upcoming],
  vip: ['VIP', (c) => c.meta.tags.includes('VIP')],
  regular: ['Постійні (3+ візити)', (c) => c.visits >= 3],
  new: ['Нові (1 візит)', (c) => c.visits === 1],
};
// Пишемо лише тим, хто погодився на розсилки й не просив не турбувати.
const optedIn = (c) => (c.meta.optIn ?? c.list.some((b) => b.optIn)) && !c.meta.tags.includes('Не дзвонити') && c.key.startsWith('tel:');

function recipients(seg) {
  return clientsList().filter(SEGMENTS[seg][1]);
}

function viewMailings() {
  const seg = ui.seg ?? 'lost';
  const all = recipients(seg);
  const ok = all.filter(optedIn);
  const camps = store.peek('biz.campaigns', []).filter((x) => x.placeId === ui.place).sort((a, b) => b.at - a.at);
  const deal = dealsOf(ui.place).find((d) => d.date);
  const text = ui.mailText ?? `{імʼя}, давно не бачились! ${place().name} чекає на вас — запишіться через CARCAR${deal ? ` — ${dayLabel(deal.date, { day: 'numeric', month: 'long' })} з ${hhmm(deal.from)} до ${hhmm(deal.to)} знижка −${deal.pct}%` : ''}.`;
  return `<h1>Розсилки</h1><p class="page-sub">Повідомлення у Viber чи Telegram для сегмента клієнтів. Лише тим, хто дав згоду на розсилки.</p>
    <div class="grid-2" style="align-items:start">
      <form id="mail-form" class="panel stack" style="gap:14px">
        <h2>Нова розсилка</h2>
        <label class="field"><span>Кому</span><select name="seg" id="mail-seg">${Object.entries(SEGMENTS).map(([k, [label]]) => `<option value="${k}" ${k === seg ? 'selected' : ''}>${label} · ${recipients(k).filter(optedIn).length}</option>`).join('')}</select></label>
        <fieldset class="radio-row"><legend>Канал</legend>
          <label><input type="radio" name="channel" value="viber" checked> Viber</label>
          <label><input type="radio" name="channel" value="telegram"> Telegram</label></fieldset>
        <label class="field"><span>Текст</span><textarea name="text" id="mail-text" rows="5" maxlength="1000" required>${esc(text)}</textarea></label>
        <p class="fine" style="margin:-6px 0 0">{імʼя} підставиться для кожного клієнта. Посилання на запис у CARCAR додамо автоматично.</p>
        <p class="small" style="margin:0" id="mail-count">Отримають: <b>${ok.length}</b> з ${all.length} у сегменті${all.length - ok.length ? ` — ${all.length - ok.length} без згоди на розсилки чи з міткою «Не дзвонити»` : ''}.</p>
        <button class="btn primary" type="submit" ${ok.length ? '' : 'disabled'}>Надіслати ${ok.length} ${plural(ok.length, 'клієнту', 'клієнтам', 'клієнтам')}</button>
        <p class="fine">У прототипі повідомлення зʼявляються в застосунку CARCAR у клієнтів із цим телефоном. Для справжньої відправки потрібне підключення Viber Business Messages чи Telegram-бота через провайдера розсилок.</p>
      </form>
      <section class="panel" aria-labelledby="h-camp">
        <h2 id="h-camp">Надіслані</h2>
        ${camps.length ? `<ul class="special-list">${camps.map((x) => `<li><span><b>${esc(SEGMENTS[x.seg]?.[0] ?? x.seg)} · ${CHANNELS[x.channel]}</b>
          <small>${fmtTime(x.at)} · ${x.count} ${plural(x.count, 'отримувач', 'отримувачі', 'отримувачів')} · ${esc(x.text.slice(0, 80))}${x.text.length > 80 ? '…' : ''}</small></span></li>`).join('')}</ul>`
          : '<p class="muted" style="margin:0">Розсилок ще не було.</p>'}
      </section>
    </div>`;
}

// ---------- гарячі вікна ----------

// Порожні проміжки на день, де вільні всі бокси щонайменше 2 години — кандидати на знижку.
function emptyWindows(date) {
  const p = place();
  const h = hoursFor(p, date);
  if (!h) return [];
  const spans = own().filter((b) => b.date === date && BLOCKING.includes(b.state) && !b.mobile).map(spanOf);
  const start = date === today() ? Math.ceil((new Date().getHours() * 60 + new Date().getMinutes() + 30) / 30) * 30 : h[0];
  const out = [];
  let from = null;
  for (let t = Math.max(h[0], start); t <= h[1]; t += 30) {
    const freeSlot = t < h[1] && spans.filter(([s, e]) => t < e && t + 30 > s).length === 0;
    if (freeSlot && from === null) from = t;
    if (!freeSlot && from !== null) { if (t - from >= 120) out.push([from, t]); from = null; }
  }
  return out;
}

function viewDeals() {
  const p = place();
  const deals = (store.peek('biz.deals', {})[ui.place] ?? []).filter((d) => d.date >= today()).sort((a, b) => (a.date + a.from).localeCompare(b.date + b.from));
  const days = [today(), addDays(today(), 1)];
  const ideas = days.flatMap((d) => emptyWindows(d).slice(0, 2).map(([from, to]) => ({ d, from, to })))
    .filter((x) => !deals.some((dl) => dl.active !== false && dl.date === x.d && dl.from < x.to && dl.to > x.from));
  return `<h1>Гарячі вікна</h1><p class="page-sub">Знижка на час, де мало записів. Клієнти бачать горящі пропозиції на головній і позначку −% біля вільного часу.</p>
    ${ideas.length ? `<section class="panel" aria-labelledby="h-ideas"><h2 id="h-ideas">Порожній час, який можна заповнити</h2>
      <ul class="special-list">${ideas.map((x) => `<li><span><b>${dayLabel(x.d, { weekday: 'short', day: 'numeric', month: 'long' })}, ${hhmm(x.from)}–${hhmm(x.to)}</b><small>усі ${p.boxes} ${plural(p.boxes, 'бокс', 'бокси', 'боксів')} вільні</small></span>
        <button class="btn primary" data-action="deal-quick" data-d="${x.d}" data-from="${x.from}" data-to="${x.to}">Знижка −20%</button></li>`).join('')}</ul></section>` : ''}
    ${weeklyDealsSection()}
    <h2 class="biz-h2">Разові гарячі вікна</h2>
    <div class="grid-2" style="align-items:start">
      <form id="deal-form" class="panel stack" style="gap:12px">
        <h2>Нове гаряче вікно</h2>
        <div class="form-grid">
          <label class="field"><span>День</span><select name="date">${Array.from({ length: 7 }, (_, i) => addDays(today(), i)).map((d) => `<option value="${d}">${dayLabel(d, { weekday: 'short', day: 'numeric', month: 'long' })}</option>`).join('')}</select></label>
          <label class="field"><span>Знижка</span><select name="pct">${[10, 15, 20, 25, 30].map((v) => `<option value="${v}" ${v === 20 ? 'selected' : ''}>−${v}%</option>`).join('')}</select></label>
          <label class="field"><span>Початок вікна</span><select name="from">${timeOpts(840, 0, 1410)}</select></label>
          <label class="field"><span>Кінець вікна</span><select name="to">${timeOpts(1020, 30, 1440)}</select></label>
        </div>
        <fieldset class="radio-row svc-scope"><legend>На які послуги (не обрано — на всі)</legend>
          ${p.services.map((x) => `<label><input type="checkbox" name="services" value="${x.id}"> ${esc(x.name)}</label>`).join('')}</fieldset>
        <button class="btn primary" type="submit">Запустити</button>
      </form>
      <section class="panel" aria-labelledby="h-deals">
        <h2 id="h-deals">Заплановані й активні</h2>
        ${deals.length ? `<ul class="special-list">${deals.map((d) => {
          const used = own().filter((b) => b.deal?.id === d.id && BLOCKING.concat('completed').includes(b.state)).length;
          return `<li class="${d.active === false ? 'off' : ''}"><span><b>−${d.pct}% · ${dayLabel(d.date, { weekday: 'short', day: 'numeric', month: 'long' })}, ${hhmm(d.from)}–${hhmm(d.to)}</b>
            <small>${d.services?.length ? d.services.map((id) => esc(p.allServices.find((s) => s.id === id)?.name ?? '')).join(', ') : 'усі послуги'} · записів: ${used}${d.active === false ? ' · зупинено' : ''}</small></span>
            ${d.active === false ? '' : `<button class="btn" data-action="deal-stop" data-id="${d.id}">Зупинити</button>`}</li>`;
        }).join('')}</ul>` : '<p class="muted" style="margin:0">Немає гарячих вікон.</p>'}
      </section>
    </div>`;
}

// Щотижневі «щасливі години»: тиждень у вигляді смуг, де видно, коли діє знижка.
function weeklyDealsSection() {
  const p = place();
  const weekly = weeklyDealsOf(ui.place);
  const [o, c] = widestRange(p);
  const span = c - o;
  const pos = (t) => `${((Math.max(o, Math.min(c, t)) - o) / span) * 100}%`;
  const ticks = [];
  for (let t = Math.ceil(o / 120) * 120; t <= c; t += 120) ticks.push(t);
  return `<section class="panel" aria-labelledby="h-weekly" style="margin-top:16px">
    <h2 id="h-weekly">Щасливі години щотижня</h2>
    <p class="sub">Постійна знижка на певні години — наприклад, будні зранку. Клієнти бачать її в розкладі точки й під час запису.</p>
    <div class="week-bands" aria-hidden="true">
      <div class="wb-row wb-axis"><span></span><div class="wb-track">${ticks.map((t) => `<i style="left:${pos(t)}">${hhmm(t)}</i>`).join('')}</div></div>
      ${WEEKDAYS.map((w, i) => {
        const h = scheduleOf(p).week[i];
        const segs = weekly.filter((d) => d.days.includes(i));
        return `<div class="wb-row"><span>${w}</span><div class="wb-track ${h ? '' : 'closed'}">
          ${h ? `<b class="wb-open" style="left:${pos(h[0])};width:calc(${pos(h[1])} - ${pos(h[0])})"></b>` : '<em>вихідний</em>'}
          ${segs.map((d) => `<b class="wb-deal" style="left:${pos(d.from)};width:calc(${pos(d.to)} - ${pos(d.from)})">−${d.pct}%</b>`).join('')}
        </div></div>`;
      }).join('')}
    </div>
    ${weekly.length ? `<ul class="special-list" style="margin-top:12px">${weekly.map((d) => {
      const used = own().filter((b) => b.deal?.id === d.id && BLOCKING.concat('completed').includes(b.state)).length;
      return `<li><span><b>−${d.pct}% · ${daysText(d.days)}, ${hhmm(d.from)}–${hhmm(d.to)}</b>
        <small>${d.services?.length ? d.services.map((id) => esc(p.allServices.find((x) => x.id === id)?.name ?? '')).join(', ') : 'усі послуги'} · записів зі знижкою: ${used}</small></span>
        <button class="btn" data-action="deal-stop" data-id="${d.id}" aria-label="Зупинити: ${daysText(d.days)}, ${hhmm(d.from)}–${hhmm(d.to)}">Зупинити</button></li>`;
    }).join('')}</ul>` : '<p class="muted">Щасливих годин ще немає.</p>'}
    <form id="weekly-form" class="stack" style="gap:12px;margin-top:14px">
      <fieldset class="radio-row"><legend>Дні тижня</legend>
        ${WEEKDAYS.map((w, i) => `<label><input type="checkbox" name="days" value="${i}" ${i < 5 ? 'checked' : ''}> ${WEEKDAY_NAMES[i]}</label>`).join('')}</fieldset>
      <div class="form-grid">
        <label class="field"><span>Знижка щотижня</span><select name="pct">${[10, 15, 20, 25, 30].map((v) => `<option value="${v}" ${v === 15 ? 'selected' : ''}>−${v}%</option>`).join('')}</select></label>
        <label class="field"><span>Діє до (необовʼязково)</span><input name="until" type="date" min="${today()}"></label>
        <label class="field"><span>Щасливі години з</span><select name="from">${timeOpts(600, 0, 1410)}</select></label>
        <label class="field"><span>Щасливі години до</span><select name="to">${timeOpts(720, 30, 1440)}</select></label>
      </div>
      <fieldset class="radio-row svc-scope"><legend>На які послуги (не обрано — на всі)</legend>
        ${p.services.map((x) => `<label><input type="checkbox" name="services" value="${x.id}"> ${esc(x.name)}</label>`).join('')}</fieldset>
      <button class="btn primary" type="submit" style="align-self:flex-start">Додати щасливі години</button>
    </form>
  </section>`;
}

function saveDeal(d) {
  const all = store.get('biz.deals', {});
  all[ui.place] = [...(all[ui.place] ?? []), { id: uid(), active: true, createdAt: Date.now(), ...d }];
  store.set('biz.deals', all);
}

// ---------- жива черга ----------

function viewQueue() {
  const p = place();
  const list = queueOf(ui.place);
  const est = queueEstimate(p, bookings);
  const waiting = list.filter((q) => q.status === 'waiting').sort((a, b) => a.joinedAt - b.joinedAt);
  const working = list.filter((q) => q.status === 'working');
  const done = list.filter((q) => q.status === 'done');
  const on = queueEnabled(p);
  const row = (q, actions) => `<li><span><b>${esc(q.plate || q.car || 'Авто')}</b>${q.source === 'app' ? ' <span class="pill carcar"><i></i>з застосунку</span>' : ''}
      <small>${esc(q.service)} · ${duration(q.minutes)}${q.clientName ? ` · ${esc(q.clientName)}` : ''}${q.status === 'waiting' ? ` · в боксі ≈ о ${hhmm(est.eta.get(q.id) ?? 0)}` : q.status === 'working' ? ` · з ${q.startedTime}` : ''}</small></span>${actions}</li>`;
  return `<h1>Жива черга</h1><p class="page-sub">Для тих, хто приїхав без запису. Клієнти бачать у застосунку, скільки машин попереду і скільки чекати, і можуть стати в чергу.</p>
    <div class="filters"><label class="row"><input class="check" type="checkbox" id="queue-on" ${on ? 'checked' : ''}>Показувати чергу клієнтам у застосунку</label></div>
    <section class="kpis" aria-label="Черга зараз">
      <div class="kpi hero"><span class="label">Чекати новому авто</span><span class="value">${est.waitMin < 5 ? 'одразу' : `≈ ${duration(Math.round(est.waitMin / 5) * 5)}`}</span><span class="kpi-note">з урахуванням записів на сьогодні</span></div>
      <div class="kpi"><span class="label">У черзі</span><span class="value">${waiting.length}</span></div>
      <div class="kpi"><span class="label">У боксах</span><span class="value">${working.length} з ${p.boxes}</span></div>
      <div class="kpi"><span class="label">Готово сьогодні</span><span class="value">${done.length}</span></div>
    </section>
    <div class="grid-3" style="margin-top:16px;align-items:start">
      <section class="panel" aria-labelledby="h-wait"><h2 id="h-wait">Чекають</h2>
        ${waiting.length ? `<ol class="special-list queue-list">${waiting.map((q) => row(q, `<div class="row" style="gap:6px;flex-wrap:nowrap">
          <button class="btn primary" data-action="q-start" data-id="${q.id}" aria-label="У бокс: ${esc(q.plate || q.car || 'авто')}">У бокс</button>
          <button class="btn" data-action="q-left" data-id="${q.id}" aria-label="Поїхав: ${esc(q.plate || q.car || 'авто')}">Поїхав</button></div>`)).join('')}</ol>` : '<p class="muted" style="margin:0">Черги немає.</p>'}
      </section>
      <section class="panel" aria-labelledby="h-work"><h2 id="h-work">У боксах</h2>
        ${working.length ? `<ul class="special-list">${working.map((q) => row(q, `<button class="btn" data-action="q-done" data-id="${q.id}" aria-label="Готово: ${esc(q.plate || q.car || 'авто')}">Готово</button>`)).join('')}</ul>` : '<p class="muted" style="margin:0">Боксів у роботі з черги немає.</p>'}
      </section>
    </div>
    <form id="queue-form" class="panel stack" style="gap:12px;margin-top:16px;max-width:640px">
      <h2>Додати авто в чергу</h2>
      <div class="form-grid">
        <label class="field"><span>Держномер чи авто</span><input name="plate" required autocomplete="off" placeholder="AA1234BB"></label>
        <label class="field"><span>Послуга</span><select name="service">${p.services.filter((x) => x.min <= 120).map((x) => `<option value="${x.id}">${esc(x.name)} · ${duration(x.min)}</option>`).join('')}</select></label>
      </div>
      <button class="btn primary" type="submit" style="align-self:flex-start">Додати в чергу</button>
    </form>`;
}

function updateQueue(id, patch) {
  saveQueue(ui.place, (store.get('biz.queue', {})[ui.place] ?? []).map((q) => (q.id === id ? { ...q, ...patch } : q)));
}

// ---------- акт приймання ----------

const DAMAGE = ['Подряпини', 'Вмʼятини', 'Сколи фарби', 'Тріщини на склі', 'Пошкоджені диски', 'Пошкоджений салон'];

function intakeSummary(b) {
  const a = b.intake;
  if (!a) return BLOCKING.includes(b.state) || b.state === 'done' ? `<button class="btn" data-action="intake" data-id="${b.id}">${icon('camera', 18)}Акт приймання авто</button>` : '';
  return `<section class="intake" aria-label="Акт приймання">
    <div class="head"><b>Акт приймання · ${fmtTime(a.at)}</b>${a.ack ? `<span class="pill ${a.ack.ok ? 'ok' : 'warn'}">${a.ack.ok ? 'Клієнт підтвердив' : 'Клієнт не згоден'}</span>` : a.signedOnSite ? '<span class="pill ok">Підписано на місці</span>' : '<span class="pill">Чекає клієнта</span>'}</div>
    <p class="small" style="margin:0">${a.marks.length ? a.marks.map(esc).join(', ') : 'Пошкоджень не виявлено'}${a.km ? ` · пробіг ${a.km.toLocaleString('uk-UA')} км` : ''}${a.note ? ` · ${esc(a.note)}` : ''}</p>
    ${a.ack && !a.ack.ok ? `<p class="small" style="margin:0">Коментар клієнта: ${esc(a.ack.note)}</p>` : ''}
    ${a.photos.length ? `<div class="photos">${a.photos.map((src, i) => `<img src="${esc(src)}" alt="Фото до робіт ${i + 1}">`).join('')}</div>` : ''}
  </section>`;
}

function intakeDrawer(id) {
  const b = bookings.find((x) => x.id === id);
  openDrawer('Акт приймання авто', `<form class="stack" id="intake-form" data-id="${id}" style="gap:14px">
    <p class="small muted" style="margin:0">Необовʼязково. Фото й позначки до робіт захищають і точку, і клієнта, якщо виникне спір.</p>
    <label class="dropzone">${icon('camera', 24)}Фото авто до робіт (до 4)<span class="photo-count" aria-live="polite"></span>
      <input class="sr-only" name="photos" type="file" accept="image/*" multiple></label>
    <fieldset class="radio-row"><legend>Що помітили</legend>${DAMAGE.map((x) => `<label><input type="checkbox" name="marks" value="${x}"> ${x}</label>`).join('')}</fieldset>
    <div class="form-grid">
      <label class="field"><span>Пробіг, км</span><input name="km" type="number" min="0" autocomplete="off"></label>
      <label class="field"><span>Речі в салоні, коментар</span><input name="note" maxlength="200" autocomplete="off"></label>
    </div>
    ${isCarcar(b) && !b.source ? '<p class="fine">Клієнт отримає акт у застосунку CARCAR і підтвердить його.</p>' : '<label class="row"><input class="check" type="checkbox" name="signed">Клієнт ознайомився й підписав на місці</label>'}
    <button class="btn primary" type="submit">Зберегти акт</button>
  </form>`);
}

// Відправка форм нових розділів: персонал, склад, абонементи, розсилки, гарячі вікна, черга, акт.
async function submitOps(f) {
  const d = new FormData(f);
  const done = (msg) => { closeDrawer(); rerenderKeepScroll(); toast(msg); return true; };
  if (f.id === 'staff-form') {
    let list = [...staffOf(ui.place)];
    // Перший співробітник — разом із ним додаємо власника, щоб було куди повернутися.
    if (!list.length) list.push({ id: uid(), name: 'Власник', role: 'owner', active: true });
    const x = { name: d.get('name').trim(), role: d.get('role'), phone: d.get('phone').trim(), pct: Number(d.get('pct')) || 0, active: !!d.get('active') };
    list = f.dataset.id ? list.map((y) => (y.id === f.dataset.id ? { ...y, ...x } : y)) : [...list, { id: uid(), ...x }];
    saveStaff(list);
    return done(f.dataset.id ? 'Дані співробітника збережено' : `Додано: ${x.name}`);
  }
  if (f.id === 'stock-item-form') {
    const st = stockData();
    saveStock({ items: [...st.items, {
      id: uid(), name: d.get('name').trim(), unit: d.get('unit'), qty0: Number(d.get('qty')), min: Number(d.get('min')), cost: Number(d.get('cost')) || 0,
      cat: d.get('cat'), since: Date.now(),
    }] });
    return done('Позицію додано на склад');
  }
  if (f.id === 'stock-move-form') {
    const st = stockData();
    const it = st.items.find((x) => x.id === d.get('item'));
    const qty = Number(d.get('qty'));
    if (!qty) { toast('Вкажіть кількість'); return true; }
    if (f.dataset.kind === 'in') {
      const sum = Math.round(Number(d.get('sum')) || 0);
      saveStock({ moves: [...st.moves, { id: uid(), itemId: it.id, at: Date.now(), delta: qty, cost: sum, reason: 'Прихід' }],
        items: st.items.map((x) => (x.id === it.id && sum ? { ...x, cost: Math.round((sum / qty) * 100) / 100 } : x)) });
      if (sum) {
        expenses.push({ id: uid(), placeId: ui.place, date: today(), cat: it.cat, amount: sum, method: d.get('method'), note: `${it.name}: ${qtyText(qty, it.unit)}`, source: 'stock', createdAt: Date.now() });
        save();
      }
      return done(`Оприбутковано: ${it.name}, ${qtyText(qty, it.unit)}${sum ? ` — ${uah(sum)} у витратах` : ''}`);
    }
    saveStock({ moves: [...st.moves, { id: uid(), itemId: it.id, at: Date.now(), delta: qty, reason: d.get('reason') }] });
    return done('Залишок скориговано');
  }
  if (f.id === 'stock-norms-form') {
    const st = stockData();
    const norm = {};
    for (const it of st.items) { const v = Number(d.get(it.id)); if (v > 0) norm[it.id] = v; }
    saveStock({ norms: { ...st.norms, [f.dataset.id]: norm } });
    return done('Норми списання збережено');
  }
  if (f.id === 'plan-form') {
    const kind = d.get('kind');
    const price = Math.round(Number(d.get('price')));
    const plan = { id: uid(), kind, name: d.get('name').trim(), price, validDays: Number(d.get('validDays')), active: true };
    if (kind === 'sub') Object.assign(plan, { visits: Number(d.get('visits')) || 1, services: d.getAll('services') });
    else plan.amount = Math.round(Number(d.get('amount')) || price);
    savePasses(ui.place, { plans: [...passesOf(ui.place).plans, plan] });
    return done(`${PASS_KIND[kind]} «${plan.name}» уже продається в застосунку`);
  }
  if (f.id === 'sell-form') {
    const plan = passesOf(ui.place).plans.find((x) => x.id === d.get('plan'));
    const phone = d.get('phone').trim();
    const sold = sellPass(ui.place, plan, { clientName: d.get('clientName').trim(), phone, clientKey: clientKeyOf(phone), source: 'crm', payment: d.get('payment') });
    return done(`Продано: ${plan.name}, код ${sold.code}`);
  }
  if (f.id === 'mail-form') {
    const seg = d.get('seg');
    const list = recipients(seg).filter(optedIn);
    const text = d.get('text').trim();
    const channel = d.get('channel');
    sendMessages(list.map((c) => ({
      placeId: ui.place, clientKey: c.key, channel, kind: 'mailing',
      text: text.replaceAll('{імʼя}', c.name.split(' ')[0]).replaceAll("{ім'я}", c.name.split(' ')[0]), link: `#/place/${ui.place}`,
    })));
    store.set('biz.campaigns', [...store.get('biz.campaigns', []), { id: uid(), placeId: ui.place, seg, channel, text, count: list.length, at: Date.now() }]);
    ui.mailText = null;
    rerenderKeepScroll();
    toast(`Розсилку надіслано: ${list.length} ${plural(list.length, 'клієнт', 'клієнти', 'клієнтів')} у ${CHANNELS[channel]}`);
    return true;
  }
  if (f.id === 'weekly-form') {
    const days = d.getAll('days').map(Number);
    const from = Number(d.get('from'));
    const to = Number(d.get('to'));
    if (!days.length) { toast('Оберіть хоча б один день тижня'); return true; }
    if (to <= from) { toast('Кінець має бути пізніше за початок'); return true; }
    saveDeal({ days, from, to, pct: Number(d.get('pct')), services: d.getAll('services'), until: d.get('until') || null });
    rerenderKeepScroll();
    toast(`Щасливі години −${d.get('pct')}%: ${daysText(days)}, ${hhmm(from)}–${hhmm(to)}`);
    return true;
  }
  if (f.id === 'deal-form') {
    const from = Number(d.get('from'));
    const to = Number(d.get('to'));
    if (to <= from) { toast('Кінець вікна має бути пізніше за початок'); return true; }
    saveDeal({ date: d.get('date'), from, to, pct: Number(d.get('pct')), services: d.getAll('services') });
    rerenderKeepScroll();
    toast(`Гаряче вікно −${d.get('pct')}% запущено`);
    return true;
  }
  if (f.id === 'queue-form') {
    const svc = place().services.find((x) => x.id === d.get('service'));
    saveQueue(ui.place, [...(store.get('biz.queue', {})[ui.place] ?? []).filter((q) => q.day === today()), {
      id: uid(), day: today(), plate: d.get('plate').trim().toUpperCase(), service: svc.name, minutes: svc.min, status: 'waiting', joinedAt: Date.now(), source: 'walkin',
    }]);
    rerenderKeepScroll();
    toast('Авто додано в чергу');
    return true;
  }
  if (f.id === 'intake-form') {
    const b = bookings.find((x) => x.id === f.dataset.id);
    const files = d.getAll('photos').filter((x) => x.size).slice(0, 4);
    const photos = (await Promise.all(files.map(shrinkPhoto))).filter(Boolean);
    b.intake = { at: Date.now(), photos, marks: d.getAll('marks'), km: Number(d.get('km')) || null, note: d.get('note').trim(), by: me().name, signedOnSite: !!d.get('signed') };
    if (!store.set('bookings', bookings) && photos.length) { b.intake.photos = []; save(); }
    closeDrawer();
    rerenderKeepScroll();
    bookingDrawer(b.id);
    toast(isCarcar(b) && !b.source ? 'Акт збережено — клієнт отримав його в застосунку' : 'Акт приймання збережено');
    return true;
  }
  return false;
}

// ---------- профіль точки ----------

// Варіанти часу з кроком 30 хвилин; 24:00 — опівночі наступного дня.
const timeOpts = (sel, from = 0, to = 1440) => {
  let out = '';
  for (let t = from; t <= to; t += 30) out += `<option value="${t}" ${t === sel ? 'selected' : ''}>${hhmm(t)}</option>`;
  return out;
};

function viewSettings() {
  const p = place();
  const s = scheduleOf(p);
  const special = Object.entries(s.special).sort(([a], [b]) => a.localeCompare(b));
  const dayRow = (h, i) => `<div class="week-row">
      <label class="row"><input class="check" type="checkbox" name="on-${i}" ${h ? 'checked' : ''}>${WEEKDAY_NAMES[i]}</label>
      <select class="select" name="o-${i}" aria-label="Відкриття, ${WEEKDAY_NAMES[i]}" ${h ? '' : 'disabled'}>${timeOpts(h?.[0] ?? 480, 0, 1410)}</select>
      <span aria-hidden="true">–</span>
      <select class="select" name="c-${i}" aria-label="Закриття, ${WEEKDAY_NAMES[i]}" ${h ? '' : 'disabled'}>${timeOpts(h?.[1] ?? 1200, 30, 1440)}</select>
    </div>`;
  return `<h1>Профіль точки</h1><p class="page-sub">Графік, перерва й бокси визначають, на який час клієнти можуть записатися в застосунку. Зміни видно одразу.</p>
    <div class="grid-2 settings-grid">
    <form id="settings-form" class="panel stack" style="gap:14px">
      <h2>Контакти й бокси</h2>
      <div class="form-grid">
        <label class="field"><span>Телефон</span><input name="phone" required value="${esc(p.phone)}" autocomplete="off"></label>
        <label class="field"><span>Кількість боксів</span><input name="boxes" type="number" min="1" max="20" value="${p.boxes}"></label>
      </div>
      <fieldset class="week"><legend>Графік роботи</legend>
        ${s.week.map(dayRow).join('')}
        <button class="btn small-btn" type="button" data-action="copy-monday">Як у понеділок — на всі робочі дні</button>
      </fieldset>
      <fieldset class="week"><legend>Перерва</legend>
        <div class="week-row">
          <label class="row"><input class="check" type="checkbox" name="brk-on" ${s.brk ? 'checked' : ''}>Щодня</label>
          <select class="select" name="brk-o" aria-label="Початок перерви" ${s.brk ? '' : 'disabled'}>${timeOpts(s.brk?.[0] ?? 780, 0, 1410)}</select>
          <span aria-hidden="true">–</span>
          <select class="select" name="brk-c" aria-label="Кінець перерви" ${s.brk ? '' : 'disabled'}>${timeOpts(s.brk?.[1] ?? 840, 30, 1440)}</select>
        </div>
      </fieldset>
      <div class="form-grid">
        <label class="field"><span>Запис наперед</span><select name="horizon">${[7, 14, 30, 60].map((n) => `<option value="${n}" ${n === s.horizon ? 'selected' : ''}>на ${n} ${daysWord(n)}</option>`).join('')}</select></label>
        <label class="field"><span>Не пізніше ніж за</span><select name="lead">${[[0, 'будь-коли'], [30, '30 хв до початку'], [60, '1 год до початку'], [120, '2 год до початку']].map(([v, t]) => `<option value="${v}" ${v === s.lead ? 'selected' : ''}>${t}</option>`).join('')}</select></label>
      </div>
      <div class="row">
        <button class="btn primary" type="submit">Зберегти</button>
        <button class="btn" type="button" data-action="settings-reset">Повернути як було</button>
        <a class="btn" href="index.html#/place/${p.id}" target="_blank" rel="noopener">Сторінка точки для клієнтів</a>
      </div>
    </form>
    <form id="mobile-form" class="panel stack" aria-labelledby="h-mobile" style="gap:14px">
      <h2 id="h-mobile">Виїзд до клієнта</h2>
      <p class="sub" style="margin:0">Мобільна мийка біля дому чи офісу клієнта. Клієнт обирає адресу на карті, а запис потрапляє в колонку «Виїзд» журналу — бокси він не займає.</p>
      <label class="row"><input class="check" type="checkbox" name="on" ${mobileOn(p) ? 'checked' : ''}>Приймаємо виїзні записи</label>
      <div class="form-grid">
        <label class="field"><span>Радіус, км</span><input name="radiusKm" type="number" min="1" max="50" value="${p.mobile?.radiusKm ?? 10}"></label>
        <label class="field"><span>Вартість виїзду, ₴</span><input name="fee" type="number" min="0" value="${p.mobile?.fee ?? 250}"></label>
        <label class="field"><span>Бригад</span><input name="crews" type="number" min="1" max="10" value="${p.mobile?.crews ?? 1}"></label>
      </div>
      <fieldset class="week"><legend>Послуги на виїзді</legend>
        ${p.services.map((x) => `<label class="row"><input class="check" type="checkbox" name="msvc" value="${x.id}" ${p.mobile?.services.includes(x.id) ? 'checked' : ''}>${esc(x.name)}</label>`).join('')}
      </fieldset>
      <button class="btn primary" type="submit" style="align-self:flex-start">Зберегти виїзд</button>
    </form>
    <section class="panel stack" aria-labelledby="h-special" style="gap:14px">
      <h2 id="h-special">Особливі дати</h2>
      <p class="sub" style="margin:0">Свята, санітарні дні чи скорочений день. Ці дати мають пріоритет над тижневим графіком.</p>
      ${special.length ? `<ul class="special-list">${special.map(([d, h]) => `<li><span><b>${dayLabel(d, { weekday: 'short', day: 'numeric', month: 'long' })}</b><small>${rangeText(h)}</small></span>
        <button class="icon-btn" data-action="special-del" data-date="${d}" aria-label="Прибрати особливу дату ${fmtDate(d)}">${icon('x', 18)}</button></li>`).join('')}</ul>` : '<p class="muted" style="margin:0">Особливих дат немає.</p>'}
      <form id="special-form" class="stack" style="gap:10px">
        <label class="field"><span>Дата</span><input name="date" type="date" required min="${today()}"></label>
        <label class="row"><input class="check" type="checkbox" name="closed" checked>Не працюємо</label>
        <div class="week-row" style="grid-template-columns:1fr auto 1fr">
          <select class="select" name="o" aria-label="Відкриття в особливу дату" disabled>${timeOpts(600, 0, 1410)}</select>
          <span aria-hidden="true">–</span>
          <select class="select" name="c" aria-label="Закриття в особливу дату" disabled>${timeOpts(1080, 30, 1440)}</select>
        </div>
        <button class="btn" type="submit">Додати дату</button>
      </form>
    </section>
    </div>`;
}

// ---------- бічна панель: запис ----------

let drawerReturn = null;

function openDrawer(title, body) {
  drawerReturn = document.activeElement;
  $('#drawer-root').innerHTML = `<div class="drawer-dim" data-action="close-drawer"></div>
    <div class="drawer" role="dialog" aria-modal="true" aria-labelledby="drawer-title">
      <div class="drawer-head"><h2 id="drawer-title">${title}</h2>
        <button class="icon-btn" data-action="close-drawer" aria-label="Закрити">${icon('x', 22)}</button></div>
      <div class="drawer-body">${body}</div>
    </div>`;
  $('.drawer input, .drawer select, .drawer textarea, .drawer-body button, .drawer .icon-btn')?.focus();
}

function closeDrawer() {
  $('#drawer-root').innerHTML = '';
  drawerReturn?.focus?.();
}

function bookingDrawer(id) {
  const b = bookings.find((x) => x.id === id);
  if (!b) return;
  const started = bookingStart(b) <= new Date();
  let actions = '';
  if (b.state === 'booked') {
    actions = `<form class="stack" id="complete-form" data-id="${b.id}">
        <fieldset class="radio-row"><legend>Оплата на місці</legend>
          <label><input type="radio" name="payment" value="card" checked> Картка</label>
          <label><input type="radio" name="payment" value="cash"> Готівка</label></fieldset>
        <label class="field"><span>Сума, ₴</span><input name="paid" type="number" min="0" value="${b.paid}"></label>
        <button class="btn primary" type="submit">${icon('check', 18)}Виконано й оплачено</button>
      </form>
      <div class="grid2">
        <button class="btn" data-action="crm-noshow" data-id="${b.id}">Клієнт не приїхав</button>
        <button class="btn text-danger" data-action="crm-cancel" data-id="${b.id}">Скасувати запис</button>
      </div>`;
  } else if (b.state === 'paid') {
    actions = `${isPast(b) ? '<p class="notice warn">Час візиту минув. Натисніть «Машина готова» — так ви підтверджуєте виконання.</p>' : ''}
      <form class="stack ready-form" id="ready-form" data-id="${b.id}">
        <label class="dropzone">${icon('camera', 24)}Додати фото результату (до 3)
          <span class="photo-count" aria-live="polite"></span>
          <input class="sr-only" name="photos" type="file" accept="image/*" multiple></label>
        <div class="form-grid">
          <label class="field"><span>Пробіг, км</span><input name="km" type="number" min="0" autocomplete="off"></label>
          <label class="field"><span>Коментар для клієнта</span><input name="note" autocomplete="off"></label>
        </div>
        <button class="btn primary" type="submit">Машина готова</button>
        <p class="fine">Так ви підтверджуєте виконання. Клієнт отримає сповіщення й зможе залишити відгук; ${PAYMENT.freezeHours} год він може відкрити спір, після цього гроші стануть доступні до виведення.</p>
      </form>
      ${Date.now() > bookingStart(b).getTime() + PAYMENT.lateMinutes * 60000 ? `<div class="notice late-box"><b>Клієнт запізнюється понад ${PAYMENT.lateMinutes} хв?</b>За правилами CARCAR це неявка: оплата ${uah(price(b))} зараховується вам.
        <button class="btn" data-action="late-forfeit" data-id="${b.id}" style="margin-top:8px">Запізнення понад ${PAYMENT.lateMinutes} хв — оплата нам</button></div>` : ''}
      ${started ? `<button class="btn text-danger" data-action="carcar-noshow" data-id="${b.id}">Клієнт не приїхав</button>` : ''}`;
  } else if (b.state === 'dispute') {
    const t = ticketsAll().find((x) => x.bookingId === b.id && x.from === 'place');
    actions = `<p class="notice warn"><b>Клієнт відкрив спір</b>«${esc(b.disputeReason ?? '')}». Гроші заморожені, доки модератор CARCAR не вирішить.</p>
      ${t ? `<a class="btn" href="#/support/${t.id}" data-action="close-drawer-nav">Ваше пояснення: звернення №${t.no}</a>` : `<form class="stack" id="dispute-note" data-id="${b.id}" style="gap:8px">
        <label class="field"><span>Пояснення для модератора</span><textarea name="text" rows="3" required maxlength="1000" placeholder="Що було зроблено, фото, домовленості з клієнтом"></textarea></label>
        <button class="btn" type="submit" style="align-self:flex-start">Надіслати модератору</button></form>`}`;
  } else if (b.state === 'completed' && isCarcar(b)) {
    actions = `<p class="notice">${isFrozen(b) ? `Гроші заморожені до ${fmtTime(b.unfreezeAt)}.` : 'Гроші доступні до виведення у «Фінансах».'}</p>`;
  }
  const key = clientKey(b);
  // Точка відкрила запис — повідомлення в чаті прочитані.
  const seen = readMessages(b.chat, 'client');
  if (b.chatUnreadBiz || seen) { b.chatUnreadBiz = false; save(); renderChrome(location.hash.split('/')[1] ?? ''); }
  openDrawer(`${b.time} · ${esc(clientName(b))}`, `
    <div class="row">${channelPill(b)}${statusPill(b)}</div>
    ${relNotice(b)}
    <dl class="kv">
      ${b.no ? `<dt>Номер</dt><dd><b>${bookingNo(b)}</b></dd>` : ''}
      <dt>Дата</dt><dd>${dayLabel(b.date, { weekday: 'long', day: 'numeric', month: 'long' })}, ${b.time}–${hhmm(toMin(b.time) + b.minutes)}</dd>
      <dt>Клієнт</dt><dd><a href="#/clients/${encodeURIComponent(key)}" data-action="close-drawer-nav">${esc(clientName(b))}</a>${b.clientPhone ? ` · <a href="tel:${esc(b.clientPhone.replace(/[^+\d]/g, ''))}">${esc(b.clientPhone)}</a>` : ''}</dd>
      <dt>Авто</dt><dd>${esc(b.car || '—')}</dd>
      <dt>Послуги</dt><dd>${esc(b.services.join(', '))}</dd>
      <dt>Сума</dt><dd>${uah(isCarcar(b) ? price(b) : b.paid)}${isCarcar(b) ? ' · оплачено через CARCAR' : b.payment ? ` · ${b.payment === 'cash' ? 'готівка' : 'картка'}` : ' · оплата на місці'}</dd>
      ${b.covered ? `<dt>Абонемент</dt><dd>${uah(b.covered)} покрито ${b.passUse?.kind === 'cert' ? 'сертифікатом' : 'абонементом'}</dd>` : ''}
      ${b.deal ? `<dt>Знижка</dt><dd>Гаряче вікно −${b.deal.pct}%</dd>` : ''}
      ${b.promo && !b.promo.returned ? `<dt>Промокод</dt><dd>${esc(b.promo.code)}: −${uah(b.promo.amount)} для клієнта, доплачує CARCAR — ви отримаєте повну суму</dd>` : ''}
      ${b.installments ? `<dt>Оплата</dt><dd><span class="pill carcar">Частинами · ${b.installments.n} платежі</span> Ви отримуєте всю суму одразу</dd>` : ''}
      ${b.mobile ? `<dt>Виїзд</dt><dd>${esc(b.mobile.address)} · ${String(b.mobile.km).replace('.', ',')} км · виїзд ${uah(b.mobile.fee)}
        <a href="https://www.openstreetmap.org/?mlat=${b.mobile.lat.toFixed(5)}&amp;mlon=${b.mobile.lng.toFixed(5)}#map=17/${b.mobile.lat.toFixed(5)}/${b.mobile.lng.toFixed(5)}" target="_blank" rel="noopener">Точка на карті</a></dd>` : ''}
      ${b.moves?.length ? `<dt>Перенесено</dt><dd>${b.moves.map((m) => `з ${dayLabel(m.date, { day: 'numeric', month: 'short' })}, ${m.time}`).join('; ')}</dd>` : ''}
      ${b.note && !isCarcar(b) ? `<dt>Коментар</dt><dd>${esc(b.note)}</dd>` : ''}
      ${can('assign') ? '' : `<dt>Майстер</dt><dd>${esc(masterName(b) ?? 'не призначено')}</dd>`}
    </dl>
    ${can('assign') ? `<label class="field"><span>Майстер</span><select id="assign-master" data-id="${b.id}">
      <option value="">Не призначено</option>
      ${masters().map((m) => `<option value="${m.id}" ${b.masterId === m.id ? 'selected' : ''}>${esc(m.name)}${masterBusy(m.id, b) ? ' (має інший запис у цей час)' : ''}</option>`).join('')}
    </select></label>` : ''}
    ${etaText(b) ? `<p class="notice ok" style="margin:0">${icon('bell', 18)}<span>Клієнт повідомив: ${etaText(b)} (${fmtTime(b.etaAt)}).</span></p>` : ''}
    ${intakeSummary(b)}
    ${estimateSection(b)}
    ${actions}
    ${chatSection(b)}
    <form class="stack" id="staff-note" data-id="${b.id}" style="gap:8px">
      <label class="field"><span>Нотатка для персоналу</span><textarea name="staffNote" rows="2">${esc(b.staffNote ?? '')}</textarea></label>
      <button class="btn" type="submit" style="align-self:flex-start">Зберегти нотатку</button>
    </form>`);
}

// Кошторис у картці запису: статус відповіді клієнта або кнопка скласти новий.
function estimateSection(b) {
  const e = b.estimate;
  const canSend = b.state === 'paid' || b.state === 'booked';
  const list = e ? `<ul class="est-list">${e.items.map((x) => `<li class="est-item${x.status === 'declined' ? ' off' : ''}">
      <span>${x.status === 'approved' ? icon('check', 16) : x.status === 'declined' ? icon('x', 16) : '·'}</span>
      <span class="name">${esc(x.name)}<small>${ITEM_KIND[x.kind]}${x.qty !== 1 ? ` · ${x.qty} × ${uah(x.price)}` : ''}${x.warranty ? ` · гарантія ${x.warranty} міс` : ''}</small></span><b>${uah(itemSum(x))}</b></li>`).join('')}</ul>` : '';
  if (!e) return canSend ? `<button class="btn" data-action="estimate" data-id="${b.id}">${icon('wrench', 18)}Скласти кошторис</button>` : '';
  const status = e.state === 'sent' ? (isCarcar(b) ? `<span class="pill warn">Чекає погодження клієнта</span>` : '<span class="pill warn">Не погоджено</span>')
    : estimateTotal(e.items, 'approved') ? `<span class="pill ok">Погоджено ${uah(estimateTotal(e.items, 'approved'))}</span>` : '<span class="pill muted">Відхилено</span>';
  return `<section class="estimate-box stack" aria-label="Кошторис" style="gap:8px"><div class="head"><b>Кошторис</b>${status}</div>${list}
    ${e.state === 'sent' && !isCarcar(b) ? `<button class="btn primary" data-action="estimate-ok" data-id="${b.id}">Клієнт погодив усе на місці</button>` : ''}
    ${e.state === 'sent' && isCarcar(b) ? '<p class="fine">Клієнт погоджує пункти в застосунку й доплачує карткою — доплата утримується до підтвердження виконання.</p>' : ''}
    ${e.state !== 'sent' && canSend ? `<button class="btn" data-action="estimate" data-id="${b.id}">${icon('plus', 16)}Новий кошторис</button>` : ''}</section>`;
}

const ESTIMATE_ROWS = 4;
function estimateDrawer(id) {
  const b = bookings.find((x) => x.id === id);
  const row = (i) => `<fieldset class="est-row"><legend>Пункт ${i + 1}</legend>
    <select class="select" name="kind" aria-label="Тип, пункт ${i + 1}">${Object.entries(ITEM_KIND).map(([k, v]) => `<option value="${k}" ${k === (i % 2 ? 'part' : 'work') ? 'selected' : ''}>${v}</option>`).join('')}</select>
    <input name="name" aria-label="Назва, пункт ${i + 1}" placeholder="${i % 2 ? 'Наприклад, очищувач бітуму' : 'Наприклад, видалення бітумних плям'}" autocomplete="off">
    <input name="qty" type="number" min="0.1" step="0.1" value="1" aria-label="Кількість, пункт ${i + 1}">
    <input name="price" type="number" min="0" aria-label="Ціна за одиницю, ₴, пункт ${i + 1}" placeholder="₴">
    <select class="select" name="warranty" aria-label="Гарантія, пункт ${i + 1}">${[0, 1, 3, 6, 12, 24].map((m) => `<option value="${m}" ${m === (i % 2 ? 6 : 3) ? 'selected' : ''}>${m ? `${m} міс` : 'без гарантії'}</option>`).join('')}</select>
  </fieldset>`;
  openDrawer('Кошторис для клієнта', `<form class="stack" id="estimate-form" data-id="${b.id}" style="gap:12px">
    <p class="small muted" style="margin:0">${esc(clientName(b))} · ${esc(b.car || '')} · ${esc(b.services.join(', '))}</p>
    <div id="est-rows" class="stack" style="gap:8px">${Array.from({ length: ESTIMATE_ROWS }, (_, i) => row(i)).join('')}</div>
    <button class="btn small-btn" type="button" data-action="estimate-row" style="align-self:flex-start">${icon('plus', 16)}Ще пункт</button>
    <label class="field"><span>Коментар для клієнта</span><input name="note" autocomplete="off" placeholder="Наприклад, на кузові знайшли бітум і сліди смоли"></label>
    <button class="btn primary" type="submit">Надіслати клієнту</button>
    <p class="fine">${isCarcar(b) ? 'Клієнт отримає сповіщення, погодить потрібні пункти й доплатить у застосунку.' : 'Запис з журналу: клієнт погоджує на місці — позначте це після розмови.'} Порожні рядки не надсилаються. Гарантія потрапить у сервісну книжку авто.</p>
  </form>`);
}

// Стрічка переписки в панелі: фото, позначки ходу запису й «Прочитано» під останньою відповіддю точки.
function bizThread(list) {
  const lastOwn = list.findLast((m) => m.from === 'biz');
  return `<ol class="thread">${list.map((m) => {
    if (m.from === 'mark') return `<li class="msg sys mark">${esc(m.text)} · ${fmtTime(m.at)}</li>`;
    const photo = typeof m.photo === 'string' && m.photo.startsWith('data:image/') ? esc(m.photo) : '';
    return `<li class="msg ${m.from === 'biz' ? 'client' : m.from === 'sys' ? 'sys' : 'biz'}"><span class="who">${m.from === 'biz' ? 'Ви' : m.from === 'sys' ? 'CARCAR' : 'Клієнт'} · ${fmtTime(m.at)}</span>${photo ? `<a class="msg-photo" href="${photo}" download="foto.jpg"><img src="${photo}" alt="Фото від ${m.from === 'biz' ? 'вас' : 'клієнта'}"></a>` : ''}${esc(m.text)}${m === lastOwn ? `<span class="read-state${m.readAt ? ' read' : ''}">${m.readAt ? `Прочитано ${fmtTime(m.readAt)}` : 'Не прочитано'}</span>` : ''}</li>`;
  }).join('')}</ol>`;
}
const bizAttach = (kind) => `<label class="btn attach-btn" title="Додати фото">${icon('camera', 18)}<span class="sr-only">Фото</span><input class="sr-only biz-attach" type="file" accept="image/*" data-kind="${kind}" aria-label="Додати фото для клієнта"></label>`;

// Чат за записом: переписка з клієнтом про цей візит.
function chatSection(b) {
  if (!isCarcar(b)) return '';
  return `<section class="stack bk-chat" aria-label="Чат з клієнтом" style="gap:8px"><b>Чат з клієнтом</b>
    ${b.chat?.length ? bizThread(chatTimeline(b))
      : '<p class="small muted" style="margin:0">Повідомлень ще немає. Напишіть клієнту, якщо треба уточнити щось про візит.</p>'}
    ${ACTIVE.includes(b.state) ? `<div class="quick" role="group" aria-label="Швидкі відповіді">${BIZ_QUICK.map((t) => `<button class="chip" type="button" data-action="biz-quick" data-id="${b.id}" data-text="${esc(t)}">${esc(t)}</button>`).join('')}</div>
    <form class="inline-form" id="bk-chat-form" data-id="${b.id}"><label class="field"><span>Повідомлення клієнту</span><input name="text" required maxlength="500" autocomplete="off"></label>
      ${bizAttach('booking')}<button class="btn" type="submit">Надіслати</button></form>` : ''}
  </section>`;
}

function bizChat(b, text, photo = null) {
  chatPost(b, 'biz', text, 'client', photo);
  sendMessages([{ placeId: b.placeId, clientKey: 'device', channel: 'app', kind: 'chat', bookingId: b.id, text: `${place().name}: ${text || 'Фото'}`, link: `#/chat/${b.id}` }]);
  save();
  bookingDrawer(b.id);
  $('#bk-chat-form input')?.focus();
  toast('Повідомлення надіслано клієнту');
}

// ---------- підтримка CARCAR ----------

const placeTickets = () => ticketsAll().filter((t) => t.placeId === ui.place && t.from === 'place').sort((a, b) => b.updatedAt - a.updatedAt);

const supportPhotoPick = () => `<label class="dropzone small-drop">${icon('camera', 20)}Додати фото (до 3)<span class="photo-count" aria-live="polite"></span>
  <input class="sr-only" name="photos" type="file" accept="image/*" multiple></label>`;

function viewSupport(openId) {
  const list = placeTickets();
  const sel = list.find((t) => t.id === openId);
  if (sel?.unreadUser) setTicket(sel.id, { unreadUser: false });
  const recent = own().filter(isCarcar).sort((a, b) => bookingStart(b) - bookingStart(a)).slice(0, 20);
  return `<h1>Підтримка CARCAR</h1><p class="page-sub">Питання про виплати, комісію, спори й відгуки. Термінові питання про гроші розглядаємо до 2 годин, решту — протягом доби.</p>
    <div class="grid-2">
    <section class="panel stack" aria-labelledby="h-tickets" style="gap:10px">
      <h2 id="h-tickets">Звернення</h2>
      ${list.length ? `<ul class="special-list ticket-list">${list.map((t) => {
        const [label, cls] = TICKET_STATUS[t.status];
        return `<li${t.unreadUser ? ' class="unread"' : ''}><span><b>№${t.no} · ${TICKET_TOPICS[t.topic]}</b><small>${esc(t.messages.at(-1).text)}</small></span>
          <span class="pill ${cls}">${t.unreadUser ? 'Нова відповідь' : label}</span><a class="btn" href="#/support/${t.id}">Відкрити</a></li>`;
      }).join('')}</ul>` : '<p class="muted" style="margin:0">Звернень ще не було.</p>'}
      ${sel ? `<article class="ticket-open stack" aria-label="Звернення №${sel.no}" style="gap:10px">
        <div class="head"><b>№${sel.no} · ${TICKET_TOPICS[sel.topic]}</b><span class="pill ${TICKET_STATUS[sel.status][1]}">${TICKET_STATUS[sel.status][0]}</span></div>
        ${sel.bookingId && bookings.find((x) => x.id === sel.bookingId)?.no ? `<p class="small muted" style="margin:0">Запис ${bookingNo(bookings.find((x) => x.id === sel.bookingId))}</p>` : ''}
        <ol class="thread">${sel.messages.map((m) => `<li class="msg ${m.from === 'place' ? 'client' : 'biz'}"><span class="who">${m.from === 'admin' ? 'Підтримка CARCAR' : 'Ви'} · ${fmtTime(m.at)}</span>${esc(m.text)}${ticketPhotos(m.photos)}</li>`).join('')}</ol>
        <form class="stack" id="ticket-reply" data-id="${sel.id}" style="gap:8px"><label class="field"><span>Відповідь підтримці</span><input name="text" maxlength="800" autocomplete="off"></label>
          ${supportPhotoPick()}<button class="btn primary" type="submit" style="align-self:flex-start">Надіслати</button></form></article>` : ''}
    </section>
    <form id="ticket-form" class="panel stack" aria-labelledby="h-new-ticket" style="gap:12px">
      <h2 id="h-new-ticket">Нове звернення</h2>
      <label class="field"><span>Тема</span><select name="topic">${PLACE_TOPICS.map((k) => `<option value="${k}">${TICKET_TOPICS[k]}</option>`).join('')}</select></label>
      <label class="field"><span>Запис (необовʼязково)</span><select name="booking"><option value="">Не стосується запису</option>
        ${recent.map((b) => `<option value="${b.id}">${bookingNo(b)} · ${dayLabel(b.date, { day: 'numeric', month: 'short' })} ${b.time} · ${esc(clientName(b))}</option>`).join('')}</select></label>
      <label class="field"><span>Або номер запису</span><input name="bookingNo" inputmode="numeric" autocomplete="off" placeholder="Наприклад, 100245"></label>
      <label class="field"><span>Опишіть питання</span><textarea name="text" rows="4" required maxlength="1000"></textarea></label>
      ${supportPhotoPick()}
      <button class="btn primary" type="submit" style="align-self:flex-start">Надіслати</button>
    </form>
    </div>`;
}

// Вільні початки для нового запису: бокс вільний, якщо записів, що перетинаються, менше, ніж боксів.
function freeStarts(date, minutes) {
  const p = place();
  const h = hoursFor(p, date);
  if (!h) return [];
  const [o, c] = h;
  const now = new Date();
  const nowMin = date === today() ? now.getHours() * 60 + now.getMinutes() : -1;
  const spans = own().filter((b) => b.date === date && BLOCKING.includes(b.state)).map((b) => [toMin(b.time), toMin(b.time) + b.minutes]);
  const out = [];
  for (let t = o; t + minutes <= c; t += 30) {
    if (t <= nowMin || inBreak(p, t, minutes)) continue;
    if (spans.filter(([s, e]) => t < e && t + minutes > s).length < p.boxes) out.push(hhmm(t));
  }
  return out;
}

let nb = null; // чернетка нового запису

// Послуги для нового запису: спершу персональні послуги клієнта (за телефоном або карткою), потім прайс.
function nbServices() {
  const keys = [phoneKey(nb.clientPhone), nb.clientKey].filter(Boolean);
  const mine = offers.filter((o) => o.placeId === ui.place && o.active !== false && keys.includes(o.clientKey)).map(offerAsService);
  return [...mine, ...place().services];
}

function newBookingDrawer(prefill = {}) {
  nb = { cls: 0, services: new Set(), date: today(), time: '', channel: 'phone', ...prefill };
  openDrawer('Новий запис', '<form class="stack" id="nb-form" style="gap:14px"></form>');
  renderNewBooking();
}

function renderNewBooking() {
  const all = nbServices();
  const chosen = all.filter((s) => nb.services.has(s.id));
  const minutes = chosen.reduce((a, s) => a + s.min, 0) || 30;
  const total = chosen.reduce((a, s) => a + s.price[nb.cls], 0);
  const starts = freeStarts(nb.date, minutes);
  // Час, на який клацнули в розкладі, тримаємо, поки він вільний для обраних послуг.
  if (nb.want && starts.includes(nb.want)) nb.time = nb.want;
  if (!starts.includes(nb.time)) nb.time = starts[0] ?? '';
  const subs = usableSubs(ui.place, [phoneKey(nb.clientPhone), nb.clientKey].filter(Boolean), chosen.map((s) => s.id));
  const covered = nbCovered(chosen, subs);
  $('#nb-form').innerHTML = `
    <div class="form-grid">
      <label class="field"><span>Імʼя клієнта</span><input name="clientName" required value="${esc(nb.clientName ?? '')}" autocomplete="off"></label>
      <label class="field"><span>Телефон клієнта</span><input name="clientPhone" required inputmode="tel" value="${esc(nb.clientPhone ?? '')}" placeholder="+380" autocomplete="off"></label>
      <label class="field"><span>Авто</span><input name="carName" value="${esc(nb.carName ?? '')}" placeholder="Наприклад, Skoda Octavia" autocomplete="off"></label>
      <label class="field"><span>Держномер</span><input name="plate" value="${esc(nb.plate ?? '')}" placeholder="AA1234BB" autocomplete="off"></label>
      <label class="field full"><span>Клас авто</span><select name="cls">${CAR_CLASSES.map((c, i) => `<option value="${i}" ${i === nb.cls ? 'selected' : ''}>${c}</option>`).join('')}</select></label>
    </div>
    <div><div class="small muted" style="margin-bottom:6px">Послуги</div>
      <div class="list svc-pick">${all.map((s) => `<label class="item"><input class="check" type="checkbox" name="svc" value="${s.id}" ${nb.services.has(s.id) ? 'checked' : ''}>
        <span class="name">${esc(s.name)}${s.personal ? ' <span class="badge personal">Для клієнта</span>' : ''}<small>${duration(s.min)}</small></span><span class="price">${uah(s.price[nb.cls])}</span></label>`).join('')}</div></div>
    <div class="form-grid">
      <label class="field"><span>Дата</span><input name="date" type="date" required value="${nb.date}" min="${today()}"></label>
      <label class="field"><span>Час</span><select name="time" ${starts.length ? '' : 'disabled'}>${starts.length ? starts.map((t) => `<option ${t === nb.time ? 'selected' : ''}>${t}</option>`).join('') : '<option>Немає вільних боксів</option>'}</select></label>
      ${masters().length ? `<label class="field full"><span>Майстер</span><select name="master"><option value="">Не призначено</option>
        ${masters().map((m) => `<option value="${m.id}" ${nb.master === m.id ? 'selected' : ''}>${esc(m.name)}${nb.time && masterBusy(m.id, { date: nb.date, time: nb.time, minutes }) ? ' (має інший запис у цей час)' : ''}</option>`).join('')}</select></label>` : ''}
    </div>
    ${subs.length ? `<fieldset class="radio-row"><legend>Абонемент клієнта</legend>
      <label><input type="radio" name="usePass" value="" ${nb.usePass ? '' : 'checked'}> Не списувати</label>
      ${subs.map((x) => `<label><input type="radio" name="usePass" value="${x.id}" ${nb.usePass === x.id ? 'checked' : ''}> ${esc(x.name)} — лишилось ${passLeft(x)}</label>`).join('')}</fieldset>` : ''}
    <label class="field"><span>Подарунковий сертифікат (код)</span><input name="cert" value="${esc(nb.cert ?? '')}" autocomplete="off" placeholder="CC-XXXX-XXXX"></label>
    <fieldset class="radio-row"><legend>Звідки запис</legend>
      <label><input type="radio" name="channel" value="phone" ${nb.channel === 'phone' ? 'checked' : ''}> Телефон</label>
      <label><input type="radio" name="channel" value="walkin" ${nb.channel === 'walkin' ? 'checked' : ''}> Прийшов сам</label></fieldset>
    <label class="field"><span>Коментар</span><input name="note" value="${esc(nb.note ?? '')}" autocomplete="off"></label>
    <div class="head nb-foot"><b>${chosen.length ? `${uah(total - covered)}${covered ? ` <small class="muted">(абонемент −${uah(covered)})</small>` : ''} · ${duration(minutes)}` : 'Оберіть послуги'}</b>
      <button class="btn primary" type="submit" ${chosen.length && nb.time ? '' : 'disabled'}>Записати</button></div>`;
}

// Один візит абонемента покриває найдорожчу з обраних послуг, на які він діє.
function nbCovered(chosen, subs) {
  const sub = subs.find((x) => x.id === nb.usePass);
  if (!sub) return 0;
  const ok = chosen.filter((s) => !sub.services.length || sub.services.includes(s.id)).map((s) => s.price[nb.cls]);
  return ok.length ? Math.max(...ok) : 0;
}

// ---------- демо-історія ----------

function rng(seed) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const DEMO_NAMES = ['Олександр', 'Марія', 'Андрій', 'Олена', 'Дмитро', 'Ірина', 'Сергій', 'Наталія', 'Віктор', 'Юлія',
  'Максим', 'Тетяна', 'Ігор', 'Анна', 'Роман', 'Світлана', 'Богдан', 'Катерина', 'Павло', 'Оксана'];
const DEMO_INITIALS = 'АБВГДКЛМНОПРСТШ';
const DEMO_CARS = ['Skoda Octavia', 'Toyota RAV4', 'Volkswagen Passat', 'Renault Duster', 'Hyundai Tucson', 'Kia Sportage', 'Nissan Qashqai', 'Ford Focus', 'Mazda CX-5', 'BYD Song Plus'];

// Генерує правдоподібну історію за 90 днів і записи на 3 дні вперед. Усі записи позначені source: 'demo',
// клієнти й номери вигадані, а в застосунку клієнта вони не зʼявляються в «Мої записи».
function demoFill() {
  const p = place();
  const r = rng(hash(p.id));
  demoClear(true);
  const pool = Array.from({ length: 160 }, (_, i) => ({
    name: `${DEMO_NAMES[i % DEMO_NAMES.length]} ${DEMO_INITIALS[(i * 4 + Math.floor(i / DEMO_NAMES.length)) % DEMO_INITIALS.length]}.`,
    phone: `+380 67 000 ${pad(Math.floor(i / 100))} ${pad(i % 100)}`,
    car: DEMO_CARS[(i * 7) % DEMO_CARS.length],
    plate: `AA${1000 + ((i * 137) % 9000)}XX`,
    cls: i % 5 === 0 ? 2 : i % 3 === 0 ? 1 : 0,
    optIn: i % 10 < 7,
  }));
  // Персонал: якщо точка ще не додала своїх людей — вигадані демо-співробітники.
  if (!staffOf(p.id).length) {
    const names = ['Андрій Б.', 'Сергій М.', 'Віталій К.', 'Ігор Д.'];
    saveStaff([
      { id: uid(), name: 'Власник', role: 'owner', active: true, demo: true },
      { id: uid(), name: 'Олена К.', role: 'admin', active: true, phone: '+380 67 000 90 01', demo: true },
      ...names.slice(0, Math.min(4, Math.max(2, p.boxes))).map((n, i) => ({ id: uid(), name: n, role: 'master', pct: [35, 30, 40, 30][i], active: true, phone: `+380 67 000 90 1${i}`, demo: true })),
    ]);
  }
  const crew = masters();
  const crewSpans = new Map(crew.map((m) => [m.id, []]));
  const out = [];
  for (let d = -90; d <= 3; d++) {
    const date = addDays(today(), d);
    const hours = hoursFor(p, date);
    if (!hours) continue;
    const [o, c] = hours;
    const wd = parseDate(date).getDay();
    const n = Math.round(p.boxes * ((wd === 0 || wd === 6) ? 2.6 : 1.8) * (0.7 + r() * 0.6));
    const spans = [];
    for (let i = 0; i < n; i++) {
      // База клієнтів росте: на початку історії ~40 людей, наприкінці — всі 160; постійні приходять частіше.
      const reach = Math.floor(40 + ((d + 90) / 93) * (pool.length - 40));
      const cl = pool[Math.floor(reach * r() ** 1.5)];
      const svc = [p.services[Math.floor(r() * p.services.length)]];
      if (r() < 0.3 && p.services.length > 1) {
        const extra = p.services[Math.floor(r() * p.services.length)];
        if (extra !== svc[0]) svc.push(extra);
      }
      const minutes = svc.reduce((a, s) => a + s.min, 0);
      if (minutes > c - o) continue;
      let t = -1;
      for (let k = 0; k < 8 && t < 0; k++) {
        const cand = o + 30 * Math.floor(r() * ((c - o - minutes) / 30 + 1));
        if (inBreak(p, cand, minutes)) continue;
        if (spans.filter(([s, e]) => cand < e && cand + minutes > s).length < p.boxes) t = cand;
      }
      if (t < 0) continue;
      spans.push([t, t + minutes]);
      // Майстер — перший вільний у цей час.
      const mid = crew.map((m) => m.id).sort(() => r() - 0.5).find((id) => !crewSpans.get(id).some(([a, z]) => a.date === date && t < z && t + minutes > a.t));
      if (mid) crewSpans.get(mid).push([{ date, t }, t + minutes]);
      const total = svc.reduce((a, s) => a + s.price[cl.cls], 0);
      const channel = r() < 0.45 ? 'carcar' : r() < 0.64 ? 'phone' : 'walkin';
      const b = {
        id: uid(), source: 'demo', channel, placeId: p.id, services: svc.map((s) => s.name), total, paid: total, bonus: 0,
        minutes, date, time: hhmm(t), car: `${cl.car} · ${cl.plate}`, plate: cl.plate, cls: cl.cls,
        clientName: cl.name, clientPhone: cl.phone, createdAt: Date.now(), masterId: mid ?? null, optIn: cl.optIn,
      };
      const end = bookingStart(b).getTime() + minutes * 60000;
      if (end <= Date.now()) {
        const x = r();
        b.state = x < 0.88 ? 'completed' : x < 0.94 ? 'cancelled' : 'noshow';
        if (b.state === 'completed') {
          if (channel === 'carcar') Object.assign(b, { completedAt: end + 1800000, unfreezeAt: end + 1800000 + PAYMENT.freezeHours * HOUR });
          else b.payment = r() < 0.55 ? 'card' : 'cash';
        } else if (channel === 'carcar' && b.state === 'noshow') {
          Object.assign(b, { placeAmount: Math.round(total * PAYMENT.noShowShare), refund: total - Math.round(total * PAYMENT.noShowShare) });
        } else if (channel === 'carcar') {
          Object.assign(b, { placeAmount: 0, refund: total });
        }
      } else {
        b.state = channel === 'carcar' ? 'paid' : 'booked';
      }
      out.push(b);
    }
  }
  bookings.push(...out);
  // Щопонеділка точка виводила все, що розморозилось.
  let withdrawn = 0;
  for (let d = -90; d < 0; d++) {
    const date = addDays(today(), d);
    if (parseDate(date).getDay() !== 1) continue;
    const at = parseDate(date).getTime() + 10 * HOUR;
    const earned = out.filter((b) => b.channel === 'carcar' && (
      (b.state === 'completed' && b.unfreezeAt <= at) || (b.placeAmount && bookingStart(b).getTime() <= at)))
      .reduce((a, b) => a + (b.state === 'completed' ? price(b) : b.placeAmount), 0);
    const gross = earned - withdrawn;
    if (gross <= 0) continue;
    const fee = Math.round(gross * commissionFor(p.id));
    payouts.push({ id: uid(), placeId: p.id, gross, fee, net: gross - fee, at, demo: true });
    withdrawn += gross;
  }
  // Витрати точки: щомісячні (оренда, зарплата, комунальні) і разові закупівлі хімії, реклама.
  const k = p.boxes;
  const month0 = addDays(today(), -100).slice(0, 8);
  const demoExp = (o) => expenses.push({ id: uid(), placeId: p.id, source: 'demo', method: 'account', note: '', ...o });
  demoExp({ date: `${month0}05`, cat: 'Оренда', amount: 9000 * k, recurring: true, note: 'Приміщення' });
  demoExp({ date: `${month0}10`, cat: 'Зарплата', amount: 18000, recurring: true, method: 'card', note: 'Адміністратор, фіксована ставка' });
  demoExp({ date: `${month0}15`, cat: 'Комунальні послуги', amount: 2500 * k, recurring: true, note: 'Вода, світло' });
  demoExp({ date: `${month0}20`, cat: 'Податки', amount: 6500, recurring: true, note: 'Єдиний податок і ЄСВ' });
  for (let d = -90; d <= 0; d += 7) {
    demoExp({ date: addDays(today(), d), cat: p.cats.includes('wash') ? 'Хімія й витратні матеріали' : 'Запчастини', amount: Math.round((900 + r() * 1400) * k / 10) * 10, method: r() < 0.5 ? 'cash' : 'card' });
    if (r() < 0.35) demoExp({ date: addDays(today(), d - 2), cat: 'Реклама', amount: Math.round((500 + r() * 1500) / 10) * 10, method: 'card', note: 'Таргетована реклама' });
  }
  save();
  demoOps(p, r, pool, out);
  route();
// Панель відкрита — клієнти бачать мийку «у мережі».
setInterval(() => { if (document.visibilityState === 'visible') touchPresence(ui.place); }, 30000);
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') touchPresence(ui.place); });
  toast(`Додано ${out.length} демо-записів за 90 днів`);
}

// Демо для складу, шинного готелю й абонементів. Позначено demo: true, щоб очищення їх знайшло.
const DEMO_STOCK = {
  wash: [['Шампунь для безконтактної мийки', 'л', 10, 180, { express: 0.15, complex: 0.2, wax: 0.15, premium: 0.25 }], ['Віск рідкий', 'л', 2, 420, { wax: 0.1, complex: 0.05, premium: 0.1, nanowax: 0.15 }],
    ['Хімія для салону', 'л', 3, 260, { complex: 0.1, inside: 0.1, engine: 0.2, dry: 1, seats: 0.4, premium: 0.1 }], ['Мікрофібра', 'шт', 20, 45, { complex: 1, dry: 2, wax: 1, premium: 1 }],
    ['Полірувальна паста', 'л', 1, 1500, { polish: 0.3, ceramic: 0.2, headlights: 0.05 }], ['Керамічне покриття', 'шт', 2, 2500, { ceramic: 1 }]],
};

function demoOps(p, r, pool, out) {
  // Склад: стартовий залишок — те, що списалося за 90 днів, плюс запас (частина позицій уже на мінімумі).
  const items = [];
  const norms = {};
  for (const cat of p.cats) {
    for (const [name, unit, min, cost, perSvc] of DEMO_STOCK[cat] ?? []) {
      const id = uid();
      let used = 0;
      for (const [sid, amount] of Object.entries(perSvc)) {
        const svc = p.allServices.find((x) => x.id === sid);
        if (!svc) continue;
        norms[sid] = { ...norms[sid], [id]: amount };
        used += out.filter((b) => b.state === 'completed' && b.services.includes(svc.name)).length * amount;
      }
      const left = min * (items.length % 3 === 0 ? 0.6 : 1.5 + r() * 2);
      items.push({ id, name, unit, min, cost, cat: cat === 'wash' || cat === 'detailing' ? 'Хімія й витратні матеріали' : 'Запчастини', qty0: Math.round((used + left) * 100) / 100, since: Date.now() - 91 * 864e5, demo: true });
    }
  }
  if (items.length) saveStock({ items, norms, moves: [] });
  // Абонементи й сертифікати: що продає точка й кому вже продано.
  const has = (id) => p.services.find((x) => x.id === id);
  const plans = [];
  if (has('express')) plans.push({ id: uid(), kind: 'sub', name: '8 мийок на місяць', price: Math.round((has('express').price[0] * 8 * 0.75) / 10) * 10, visits: 8, validDays: 30, services: ['express', ...(has('complex') ? ['complex'] : [])], active: true, demo: true });
  if (has('change')) plans.push({ id: uid(), kind: 'sub', name: 'Перевзування двічі на рік', price: Math.round((has('change').price[0] * 2 * 0.85) / 10) * 10, visits: 2, validDays: 365, services: ['change'], active: true, demo: true });
  plans.push({ id: uid(), kind: 'cert', name: p.services.some((x) => x.id === 'ceramic') ? 'Сертифікат на детейлінг 3 000 ₴' : 'Подарунковий сертифікат 1 000 ₴', price: p.cats.includes('detailing') ? 3000 : 1000, amount: p.cats.includes('detailing') ? 3000 : 1000, validDays: 365, active: true, demo: true });
  const sold = pool.slice(30, 42).map((c, i) => {
    const plan = plans[i % plans.length];
    const at = Date.now() - (5 + i * 4) * 864e5;
    const valid = new Date(at + plan.validDays * 864e5);
    const usedVisits = plan.kind === 'sub' ? Math.min(plan.visits - 1, i % 4) : 0;
    return {
      id: uid(), planId: plan.id, kind: plan.kind, name: plan.name, price: plan.price, code: `CC-DEMO-${String(1000 + i)}`, services: plan.services ?? [],
      visits: plan.visits ?? null, visitsLeft: plan.kind === 'sub' ? plan.visits - usedVisits : null, balance: plan.kind === 'cert' ? plan.amount - (i % 3) * 200 : null,
      validUntil: isoDate(valid), soldAt: at, history: [], clientName: c.name, phone: c.phone, clientKey: phoneKey(c.phone),
      source: i % 2 ? 'carcar' : 'crm', payment: i % 3 ? 'card' : 'cash', demo: true,
    };
  });
  const cur = passesOf(p.id);
  savePasses(p.id, { plans: [...cur.plans.filter((x) => !x.demo), ...plans], sold: [...cur.sold.filter((x) => !x.demo), ...sold] });
}

function demoClear(silent) {
  bookings = bookings.filter((b) => !(b.source === 'demo' && b.placeId === ui.place));
  payouts = payouts.filter((x) => !(x.demo && x.placeId === ui.place));
  expenses = expenses.filter((x) => !(x.source === 'demo' && x.placeId === ui.place));
  save();
  // Демо-персонал, склад, шини й абонементи — лише позначені demo.
  if (staffOf(ui.place).some((x) => x.demo)) saveStaff(staffOf(ui.place).filter((x) => !x.demo));
  if (stockData().items.some((x) => x.demo)) saveStock({ items: stockData().items.filter((x) => !x.demo) });
  const pp = passesOf(ui.place);
  if (pp.plans.some((x) => x.demo) || pp.sold.some((x) => x.demo)) savePasses(ui.place, { plans: pp.plans.filter((x) => !x.demo), sold: pp.sold.filter((x) => !x.demo) });
  if (!silent) { route(); toast('Демо-дані очищено'); }
}

// ---------- CSV ----------

function downloadCsv(name, rows) {
  const cell = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const text = `﻿${rows.map((r) => r.map(cell).join(';')).join('\r\n')}`;
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8' }));
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

// ---------- роутер і події ----------

// Меню згруповане за задачами; кожен бачить лише те, що дозволяє його роль.
// ---------- швидкий пошук ----------

// Пошук по клієнтах і записах точки: імʼя, телефон (будь-які цифри), номер авто чи марка.
function searchHits(q) {
  const text = q.trim().toLowerCase();
  if (text.length < 2) return null;
  const digits = text.replace(/\D/g, '');
  const plate = text.replace(/[\s-]/g, '').toUpperCase();
  const hit = (...vals) => vals.some((v) => v && String(v).toLowerCase().includes(text))
    || (digits.length >= 3 && vals.some((v) => v && String(v).replace(/\D/g, '').includes(digits)));
  const clients = clientsList().filter((c) => hit(c.name, c.phone, ...c.cars) || c.list.some((b) => b.plate && b.plate.replace(/[\s-]/g, '').toUpperCase().includes(plate))).slice(0, 6);
  // Номер запису («100245» чи «№100245») знаходить запис будь-якої давності.
  const exact = /^№?\s*\d{6}$/.test(text.replace(/\s/g, '')) ? findByNo(own(), text) : null;
  const upcoming = exact ? [exact] : own().filter((b) => b.date >= today() && BLOCKING.includes(b.state) && (hit(clientName(b), b.clientPhone, b.car, b.plate) || (b.plate && b.plate.replace(/[\s-]/g, '').toUpperCase().includes(plate))))
    .sort((a, b) => bookingStart(a) - bookingStart(b)).slice(0, 4);
  return { clients, upcoming };
}

function renderSearch(q) {
  const box = $('#biz-q-res');
  const r = searchHits(q);
  if (!r) { box.hidden = true; box.innerHTML = ''; return; }
  const none = !r.clients.length && !r.upcoming.length;
  box.innerHTML = none ? `<p class="muted small">Нічого не знайдено. <button class="link-btn" data-action="new-booking">Новий запис</button></p>`
    : `${r.upcoming.length ? `<h3>Найближчі записи</h3><ul>${r.upcoming.map((b) => `<li><button data-action="open-booking" data-id="${b.id}">${icon('calendar', 16)}<span><b>${b.no ? `${bookingNo(b)} · ` : ''}${dayLabel(b.date, { day: 'numeric', month: 'short' })}, ${b.time} · ${esc(clientName(b))}</b><small>${esc(`${carText(b)} · ${b.services.join(', ')}`)}</small></span></button></li>`).join('')}</ul>` : ''}
      ${r.clients.length ? `<h3>Клієнти</h3><ul>${r.clients.map((c) => `<li><a href="#/clients/${encodeURIComponent(c.key)}">${icon('users', 16)}<span><b>${esc(c.name)}</b><small>${esc([c.phone, [...c.cars].join(', '), c.visits ? `${c.visits} ${plural(c.visits, 'візит', 'візити', 'візитів')}` : ''].filter(Boolean).join(' · '))}</small></span></a></li>`).join('')}</ul>` : ''}`;
  box.hidden = false;
}

function closeSearch() {
  const box = $('#biz-q-res');
  if (box && !box.hidden) box.hidden = true;
}

// CRM мийки — лише головне. Жива черга, гарячі вікна, абонементи, розсилки, витрати, склад
// та імпорт з меню прибрано, щоб кабінет був простим.
const NAV = [
  ['Робота', [['', 'Огляд', 'chart'], ['schedule', 'Розклад', 'calendar'], ['clients', 'Клієнти', 'users'], ['requests', 'Запити клієнтів', 'chat']]],
  ['Мийка', [['services', 'Послуги й ціни', 'list'], ['reviews', 'Відгуки', 'star'], ['finance', 'Фінанси', 'card'], ['staff', 'Персонал', 'users'], ['earnings', 'Мій заробіток', 'cash']]],
  ['Точка', [['settings', 'Профіль точки', 'settings'], ['connect', 'Реквізити й документи', 'shield'], ['support', 'Підтримка CARCAR', 'info']]],
];
const inNav = (id) => NAV.some(([, items]) => items.some(([x]) => x === id));

function renderChrome(page) {
  const unanswered = reviews.filter((r) => r.placeId === ui.place && !r.reply).length;
  const openReq = requests.filter((r) => r.placeId === ui.place && reqState(r) === 'new').length + own().filter((b) => b.chatUnreadBiz).length;
  const badge = {
    reviews: [unanswered, 'без відповіді'], requests: [openReq, 'чекають відповіді'], stock: [lowStock().length, 'закінчується'],
    queue: [queueOf(ui.place).filter((q) => q.status === 'waiting').length, 'у черзі'],
    support: [placeTickets().filter((t) => t.unreadUser).length, 'нові відповіді'],
  };
  const link = ([id, label, ic]) => `<a href="#/${id}" ${page === id ? 'aria-current="page"' : ''}>${icon(ic, 20)}${label}
    ${badge[id]?.[0] ? `<span class="count" aria-label="${badge[id][1]}: ${badge[id][0]}">${badge[id][0]}</span>` : ''}
    ${id === 'connect' && partnerOf(ui.place).status !== 'approved' ? `<span class="count" aria-label="${PARTNER_STATUS[partnerOf(ui.place).status][0]}">!</span>` : ''}</a>`;
  // Нижнє меню на телефоні: головне під пальцем, решта — у «Ще».
  const tabs = [['', 'Сьогодні', 'chart'], ['schedule', 'Розклад', 'calendar'], ['clients', 'Клієнти', 'users'], ['requests', 'Чати', 'chat']].filter(([id]) => can(id));
  const inTabs = tabs.some(([id]) => id === page);
  const rest = Object.entries(badge).filter(([id]) => !tabs.some(([t]) => t === id) && can(id) && inNav(id)).reduce((a, [, [n]]) => a + n, 0);
  $('#tabbar').innerHTML = `${tabs.map(([id, label, ic]) => `<a href="#/${id}" ${page === id ? 'aria-current="page"' : ''}>${icon(ic, 22)}<span>${label}</span>${badge[id]?.[0] ? `<span class="count" aria-label="${badge[id][1]}: ${badge[id][0]}">${badge[id][0]}</span>` : ''}</a>`).join('')}
    <button type="button" data-action="menu-open" aria-expanded="${document.body.classList.contains('menu-open')}" ${inTabs ? '' : 'aria-current="page"'}>${icon('list', 22)}<span>Ще</span>${rest ? `<span class="count" aria-label="потребують уваги: ${rest}">${rest}</span>` : ''}</button>`;
  $('#nav').innerHTML = NAV.map(([group, items]) => {
    const visible = items.filter(([id]) => can(id));
    return visible.length ? `<div class="nav-group"><span class="nav-h" aria-hidden="true">${group}</span>${visible.map(link).join('')}</div>` : '';
  }).join('');
  const who = me();
  const staff = staffOf(ui.place).filter((x) => x.active !== false);
  $('#as').innerHTML = (staff.some((x) => x.role === 'owner') ? staff : [OWNER, ...staff])
    .map((x) => `<option value="${x.id}" ${x.id === who.id ? 'selected' : ''}>${esc(x.name)}${x.name === ROLES[x.role] ? '' : ` · ${ROLES[x.role]}`}</option>`).join('');
  $('#as').closest('label').hidden = !staff.length;
  const pw = powerOf(ui.place);
  const short = { grid: 'Світло є', generator: 'Працюємо від генератора', closed: 'Без світла, зачинено' };
  $('#power').innerHTML = `<option value="">Світло: не вказано</option>${Object.keys(POWER).map((k) => `<option value="${k}" ${pw?.state === k ? 'selected' : ''}>${short[k]}</option>`).join('')}`;
  $('#power').title = pw ? `Оновлено ${fmtTime(pw.at)}` : 'Відмітьте, чи є світло, — клієнти бачать це в застосунку';
  $('#new-booking').hidden = me().role === 'master';
  // Акаунт мийки бачить лише свою точку; перемикач точок — тільки в демо-кабінеті.
  $('#place').closest('label').hidden = !!lockedPlace();
  $('#logout').textContent = session()?.demo ? 'Вийти з демо' : `Вийти${session()?.login ? ` (${session().login})` : ''}`;
  $('#place').innerHTML = `${PLACES.filter((p) => !lockedPlace() || p.id === lockedPlace()).map((p) => {
    const st = partnerOf(p.id).status;
    return `<option value="${p.id}" ${p.id === ui.place ? 'selected' : ''}>${esc(p.name)}${st === 'approved' ? '' : ` · ${PARTNER_STATUS[st][0]}`}</option>`;
  }).join('')}<option value="__new">+ Додати нову точку…</option>`;
}

function route() {
  hideTip();
  // Без входу — лише екран логіна.
  document.body.classList.toggle('locked', !session());
  if (!session()) { $('#view').innerHTML = viewBizLogin(); $('#tabbar').innerHTML = ''; return; }
  touchPresence(ui.place);
  if ($('#biz-q')?.value) { $('#biz-q').value = ''; closeSearch(); }
  charts = {};
  const [, page = '', arg] = location.hash.replace(/^#/, '').split('/');
  if (page !== 'services') ui.svcDraft = null;
  // Хтось скасував запис — перевіряємо, чи не звільнився час для листа очікування.
  checkWaitlist(bookings);
  if (page === '' && me().role === 'master') { location.replace('#/schedule'); return; }
  renderChrome(page);
  const view = $('#view');
  if (!can(page === 'offer' ? 'offer' : page)) {
    view.innerHTML = `<h1>Немає доступу</h1><p class="page-sub">Роль «${ROLES[me().role]}» не бачить цей розділ. Перемкніться вгорі на власника.</p>`;
    return;
  }
  if (page === '') view.innerHTML = viewOverview();
  else if (page === 'staff') view.innerHTML = viewStaff();
  else if (page === 'earnings') view.innerHTML = viewEarnings();
  else if (page === 'stock') view.innerHTML = viewStock();
  else if (page === 'passes') view.innerHTML = viewPasses();
  else if (page === 'mailings') view.innerHTML = viewMailings();
  else if (page === 'deals') view.innerHTML = viewDeals();
  else if (page === 'queue') view.innerHTML = viewQueue();
  else if (page === 'schedule') view.innerHTML = viewSchedule(/^\d{4}-\d\d-\d\d$/.test(arg ?? '') ? arg : today());
  else if (page === 'clients') view.innerHTML = arg ? viewClient(decodeURIComponent(arg)) : viewClients();
  else if (page === 'services') view.innerHTML = viewServices();
  else if (page === 'finance') view.innerHTML = viewFinance();
  else if (page === 'expenses') view.innerHTML = viewExpenses();
  else if (page === 'import') view.innerHTML = viewImport();
  else if (page === 'requests') view.innerHTML = viewRequests();
  else if (page === 'connect') view.innerHTML = viewConnect();
  else if (page === 'offer') view.innerHTML = viewOffer();
  else if (page === 'reviews') view.innerHTML = viewReviews();
  else if (page === 'settings') view.innerHTML = viewSettings();
  else if (page === 'support') view.innerHTML = viewSupport(arg);
  else view.innerHTML = '<p>Сторінку не знайдено.</p>';
  // Поки точку не підключено, нагадуємо про це на кожному екрані, крім самого підключення.
  const st = partnerOf(ui.place).status;
  if (st !== 'approved' && page !== 'connect' && page !== 'offer') {
    view.insertAdjacentHTML('afterbegin', `<p class="notice warn status-banner">${icon('warn', 18)}<span>Клієнти ще не бачать цю точку — статус «${PARTNER_STATUS[st][0]}».
      <a href="#/connect">${st === 'draft' || st === 'changes' || st === 'rejected' ? 'Завершити підключення' : 'Деталі підключення'}</a></span></p>`);
  }
  mountCharts();
  enterView(view, `${page}/${arg ?? ''}/${ui.place}` !== ui.lastView);
  ui.lastView = `${page}/${arg ?? ''}/${ui.place}`;
}

function rerenderKeepScroll() {
  const y = window.scrollY;
  route();
  window.scrollTo(0, y);
}

document.addEventListener('click', (e) => {
  const row = e.target.closest('tr.link-row[data-href]');
  if (row && !e.target.closest('a')) { location.hash = row.dataset.href; return; }
  // Клік по вільному місцю в боксі — новий запис на цей день і час (крок 30 хв).
  if (e.target.matches('.sched-col[data-day]') && me().role !== 'master') {
    const min = Number(e.target.dataset.o) + Math.floor(e.offsetY / ROW) * 30;
    const time = hhmm(min);
    newBookingDrawer({ date: e.target.dataset.day, time, want: time });
    return;
  }
  // Результати швидкого пошуку закриваються кліком поза ними.
  if (!e.target.closest('.biz-search')) closeSearch();
  const el = e.target.closest('[data-action]');
  if (!el) return;
  const { action, id } = el.dataset;
  if (action !== 'demo-fill' && action !== 'demo-clear') $('#demo-menu').open = false;

  if (action === 'period') { ui.period = Number(el.dataset.n); rerenderKeepScroll(); }
  else if (action === 'demo-fill') {
    $('#demo-menu').open = false;
    if (own().some((b) => b.source === 'demo') && !confirm('Замінити наявну демо-історію новою?')) return;
    demoFill();
  } else if (action === 'demo-clear') { $('#demo-menu').open = false; demoClear(); }
  else if (action === 'demo-login') { store.set('biz.session', { demo: true, at: Date.now() }); location.hash = '#/'; route(); }
  else if (action === 'logout') {
    if (!confirm('Вийти з кабінету?')) return;
    store.set('biz.session', null);
    document.body.classList.remove('menu-open');
    location.hash = '#/';
    route();
  }
  else if (action === 'menu-open') {
    // «Ще» відкриває й закриває меню з усіма розділами.
    const open = document.body.classList.toggle('menu-open');
    el.setAttribute('aria-expanded', String(open));
    if (open) $('#nav a')?.focus();
  }
  else if (action === 'menu-close') { document.body.classList.remove('menu-open'); $('[data-action="menu-open"]')?.setAttribute('aria-expanded', 'false'); }
  else if (action === 'new-booking') {
    const c = el.dataset.client ? clientsList().find((x) => x.key === el.dataset.client) : null;
    const last = c?.list.find((b) => b.clientName) ?? c?.list[0];
    newBookingDrawer(c ? { clientKey: c.key, clientName: c.name === 'Клієнт CARCAR' ? '' : c.name, clientPhone: c.phone, carName: last?.car?.split(' · ')[0] ?? '', plate: last?.plate ?? '', cls: last?.cls ?? 0 } : {});
  } else if (action === 'open-booking') bookingDrawer(id);
  else if (action === 'estimate') estimateDrawer(id);
  else if (action === 'estimate-row') {
    const box = $('#est-rows');
    const n = box.children.length;
    box.insertAdjacentHTML('beforeend', box.firstElementChild.outerHTML.replaceAll('пункт 1', `пункт ${n + 1}`).replace('Пункт 1', `Пункт ${n + 1}`));
    box.lastElementChild.querySelector('[name="name"]').focus();
  } else if (action === 'estimate-ok') {
    const b = bookings.find((x) => x.id === id);
    for (const x of b.estimate.items) x.status = 'approved';
    const sum = estimateTotal(b.estimate.items);
    Object.assign(b.estimate, { state: 'answered', answeredAt: Date.now(), approved: sum });
    b.paid += sum;
    save();
    bookingDrawer(id);
    rerenderKeepScroll();
    toast(`Кошторис погоджено: +${uah(sum)} до оплати на місці`);
  } else if (action === 'biz-quick') bizChat(bookings.find((x) => x.id === id), el.dataset.text);
  else if (action === 'close-drawer') closeDrawer();
  else if (action === 'close-drawer-nav') $('#drawer-root').innerHTML = '';
  else if (action === 'client-filter') { ui.clients = el.dataset.f; rerenderKeepScroll(); }
  else if (action === 'tag') {
    const key = decodeURIComponent(location.hash.split('/')[2]);
    const m = { ...clientMeta(key) };
    m.tags = m.tags.includes(el.dataset.tag) ? m.tags.filter((t) => t !== el.dataset.tag) : [...m.tags, el.dataset.tag];
    crm[ui.place] = { ...crm[ui.place], [key]: m };
    save();
    el.setAttribute('aria-pressed', m.tags.includes(el.dataset.tag));
  } else if (action === 'export-clients') {
    downloadCsv(`carcar-clients-${ui.place}.csv`, [['Клієнт', 'Телефон', 'Авто', 'Візитів', 'Витрачено, ₴', 'Останній візит', 'Мітки', 'Нотатка'],
      ...filteredClients().map((c) => [c.name, c.phone, [...c.cars].join(', '), c.visits, c.spent, c.last, c.meta.tags.join(', '), c.meta.note])]);
  } else if (action === 'export-ledger') {
    downloadCsv(`carcar-finance-${ui.place}.csv`, [['Дата', 'Час', 'Клієнт', 'Авто', 'Послуги', 'Статус', 'Сума точці, ₴', 'З них бонус CARCAR, ₴'],
      ...own().filter(isCarcar).map((b) => [b.date, b.time, clientName(b), b.car, b.services.join(', '), moneyStatus(b)[0], shareOf(b), b.bonus || 0])]);
  } else if (action === 'payout') {
    const { available } = balanceFor(ui.place, bookings, payouts);
    const fee = Math.round(available * commissionFor(ui.place));
    const iban = maskIban(partnerOf(ui.place).payout.iban);
    if (!confirm(`Вивести ${uah(available)}? Комісія ${uah(fee)}, на рахунок ${iban} надійде ${uah(available - fee)}.`)) return;
    payouts.push({ id: uid(), placeId: ui.place, gross: available, fee, net: available - fee, at: Date.now(), iban });
    save();
    rerenderKeepScroll();
    toast(`Виплату відправлено на рахунок ${iban}`);
  } else if (action === 'crm-noshow' || action === 'crm-cancel') {
    const b = bookings.find((x) => x.id === id);
    if (!confirm(action === 'crm-noshow' ? 'Позначити, що клієнт не приїхав?' : 'Скасувати запис?')) return;
    b.state = action === 'crm-noshow' ? 'noshow' : 'cancelled';
    // Скасований запис повертає візит абонемента чи суму сертифіката.
    if (action === 'crm-cancel' && b.passUse) { restorePass(ui.place, b.passUse); b.passUse = null; }
    save();
    closeDrawer();
    rerenderKeepScroll();
    toast(action === 'crm-noshow' ? 'Позначено неявку' : 'Запис скасовано');
  } else if (action === 'late-forfeit') {
    const b = bookings.find((x) => x.id === id);
    if (!confirm(`Клієнт запізнюється понад ${PAYMENT.lateMinutes} хв: зарахувати оплату ${uah(price(b))} мийці й закрити запис?`)) return;
    Object.assign(b, { state: 'noshow', placeAmount: price(b), refund: 0, lateForfeit: true, closedAt: Date.now() });
    sendMessages([{ placeId: b.placeId, clientKey: 'device', channel: 'app', kind: 'late', bookingId: b.id, link: `#/bookings/${b.id}`,
      text: `${place().name}: ви запізнилися більше ніж на ${PAYMENT.lateMinutes} хв, тому візит вважається неявкою — оплату зараховано мийці. Якщо це помилка, напишіть у підтримку.` }]);
    save();
    closeDrawer();
    rerenderKeepScroll();
    toast(`Оплату ${uah(price(b))} зараховано вам`);
  } else if (action === 'carcar-noshow') {
    const b = bookings.find((x) => x.id === id);
    const placeAmount = Math.round(price(b) * PAYMENT.noShowShare);
    if (!confirm(`Позначити неявку? Клієнт не скасував запис вчасно, тож оплата ${uah(placeAmount)} зараховується точці.`)) return;
    Object.assign(b, { state: 'noshow', placeAmount, refund: price(b) - placeAmount, closedAt: Date.now() });
    save();
    closeDrawer();
    rerenderKeepScroll();
  } else if (action === 'svc-add') {
    ui.svcDraft.push({ id: `c_${uid()}`, name: 'Нова послуга', cat: place().cats[0] ?? 'wash', min: 30, price: [300, 350, 400] });
    rerenderKeepScroll();
    $(`[data-i="${ui.svcDraft.length - 1}"][data-f="name"]`)?.select();
  } else if (action === 'svc-del') {
    ui.svcDraft.splice(Number(el.dataset.i), 1);
    rerenderKeepScroll();
  } else if (action === 'svc-reset') {
    if (!confirm('Повернути стандартний прайс? Ваші зміни й додані послуги буде видалено.')) return;
    saveOverride(ui.place, { services: null });
    ui.svcDraft = null;
    rerenderKeepScroll();
    toast('Прайс повернуто');
  } else if (action === 'fin-period') { ui.finPeriod = Number(el.dataset.n); rerenderKeepScroll(); }
  else if (action === 'exp-period') { ui.expPeriod = Number(el.dataset.n); rerenderKeepScroll(); }
  else if (action === 'expense-add') expenseDrawer();
  else if (action === 'exp-del' || action === 'exp-stop') {
    const e = expenses.find((x) => x.id === id);
    if (action === 'exp-del') {
      if (!confirm(`Видалити витрату ${e.cat} на ${uah(e.amount)}?`)) return;
      expenses = expenses.filter((x) => x !== e);
    } else {
      if (!confirm(`Зупинити щомісячний платіж «${e.cat}»? Уже нараховані місяці залишаться в обліку.`)) return;
      e.until = today();
    }
    save();
    rerenderKeepScroll();
    toast(action === 'exp-del' ? 'Витрату видалено' : 'Щомісячний платіж зупинено');
  } else if (action === 'export-expenses') {
    const [from, to] = rangeOf(ui.expPeriod);
    downloadCsv(`carcar-expenses-${ui.place}.csv`, [['Дата', 'Категорія', 'Сума, ₴', 'Спосіб оплати', 'Щомісяця', 'Нотатка'],
      ...expensesIn(ui.place, from, to).map((e) => [e.date, e.cat, e.amount, PAY_METHODS[e.method] ?? '', e.template ? 'так' : '', e.note ?? ''])]);
  } else if (action === 'export-pnl') {
    const range = rangeOf(ui.finPeriod);
    const r = pnl(range);
    downloadCsv(`carcar-pnl-${ui.place}-${range[0]}-${range[1]}.csv`, [['Стаття', 'Сума, ₴'], ...pnlRows(r).map(([n, v]) => [n, v ?? '']),
      ['Прибуток', r.profit], ['Маржа, %', Math.round(r.margin)]]);
  } else if (action === 'client-new') clientDrawer(null);
  else if (action === 'client-edit') clientDrawer(el.dataset.key);
  else if (action === 'offer-add') offerDrawer(el.dataset.key);
  else if (action === 'offer-del') {
    const o = offers.find((x) => x.id === id);
    if (!confirm(`Видалити персональну послугу «${o.name}»?`)) return;
    offers = offers.filter((x) => x !== o);
    save();
    rerenderKeepScroll();
    toast('Персональну послугу видалено');
  } else if (action === 'copy-monday') {
    const f = $('#settings-form');
    for (let i = 1; i < 7; i++) {
      if (!f[`on-${i}`].checked) continue;
      f[`o-${i}`].value = f['o-0'].value;
      f[`c-${i}`].value = f['c-0'].value;
    }
    toast('Години понеділка скопійовано на робочі дні — не забудьте зберегти');
  } else if (action === 'special-del') {
    const s = scheduleOf(place());
    delete s.special[el.dataset.date];
    saveOverride(ui.place, { schedule: s });
    rerenderKeepScroll();
    toast('Особливу дату прибрано');
  } else if (action === 'imp-type') {
    Object.assign(ui.imp, { type: el.dataset.t, result: null });
    if (ui.imp.rows) ui.imp.map = autoMap(ui.imp.type, ui.imp.rows[0]);
    rerenderKeepScroll();
  } else if (action === 'imp-template') {
    downloadCsv(`carcar-import-${ui.imp.type}.csv`, IMPORT_TEMPLATES[ui.imp.type]);
  } else if (action === 'imp-cancel') { Object.assign(ui.imp, { rows: null, text: '' }); rerenderKeepScroll(); }
  else if (action === 'imp-run') runImport();
  else if (action === 'staff-add') staffDrawer(null);
  else if (action === 'staff-edit') staffDrawer(id);
  else if (action === 'stock-item') stockItemDrawer();
  else if (action === 'stock-in') stockMoveDrawer('in');
  else if (action === 'stock-adjust') stockMoveDrawer('adjust', id);
  else if (action === 'stock-norms') stockNormsDrawer(id);
  else if (action === 'stock-list') {
    const low = lowStock();
    downloadCsv(`carcar-zakupivlia-${ui.place}.csv`, [['Позиція', 'Залишок', 'Одиниця', 'Купити', 'Орієнтовно, ₴'],
      ...low.map((x) => { const buy = Math.max(x.min * 2 - Math.max(0, x.qty), x.min); return [x.name, Math.max(0, x.qty), x.unit, Math.round(buy * 100) / 100, Math.round(buy * x.cost)]; })]);
  } else if (action === 'plan-add') planDrawer();
  else if (action === 'pass-sell') sellDrawer();
  else if (action === 'deal-quick') {
    saveDeal({ date: el.dataset.d, from: Number(el.dataset.from), to: Number(el.dataset.to), pct: 20, services: [] });
    rerenderKeepScroll();
    toast('Гаряче вікно −20% запущено — клієнти вже бачать знижку');
  } else if (action === 'deal-stop') {
    const all = store.get('biz.deals', {});
    all[ui.place] = (all[ui.place] ?? []).map((d) => (d.id === id ? { ...d, active: false } : d));
    store.set('biz.deals', all);
    rerenderKeepScroll();
    toast('Гаряче вікно зупинено');
  } else if (action === 'q-start' || action === 'q-done' || action === 'q-left') {
    const now = new Date();
    updateQueue(id, action === 'q-start' ? { status: 'working', startedTime: hhmm(now.getHours() * 60 + now.getMinutes()) }
      : action === 'q-done' ? { status: 'done', doneAt: Date.now() } : { status: 'left' });
    rerenderKeepScroll();
  } else if (action === 'intake') intakeDrawer(id);
  else if (action === 'review-report') {
    const reason = prompt('Чому відгук порушує правила? Наприклад, образи, персональні дані, відгук не про цей візит.')?.trim();
    if (!reason) return;
    reviews.find((x) => x.id === id).report = { reason, at: Date.now(), status: 'open' };
    save();
    rerenderKeepScroll();
    toast('Скаргу надіслано модератору CARCAR');
  }
  else if (action === 'req-filter') { ui.reqFilter = el.dataset.f; rerenderKeepScroll(); }
  else if (action === 'req-service') reqServiceDrawer(id);
  else if (action === 'req-close') {
    if (!confirm('Закрити запит? Клієнт побачить, що його закрито.')) return;
    const r = requests.find((x) => x.id === id);
    Object.assign(r, { closed: true, closedAt: Date.now(), unreadClient: true });
    save();
    rerenderKeepScroll();
    toast('Запит закрито');
  }
  else if (action === 'settings-reset') {
    const all = store.get('biz.places', {});
    if (all[ui.place]) { delete all[ui.place].phone; delete all[ui.place].hours; delete all[ui.place].boxes; delete all[ui.place].schedule; }
    store.set('biz.places', all);
    applyOverrides();
    rerenderKeepScroll();
    toast('Профіль повернуто');
  }
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && $('#biz-q-res:not([hidden])')) { closeSearch(); $('#biz-q').blur(); return; }
  if (e.key === 'Escape' && document.body.classList.contains('menu-open')) { document.body.classList.remove('menu-open'); $('[data-action="menu-open"]')?.focus(); return; }
  if (e.key === 'Escape' && $('.drawer')) closeDrawer();
  // Гарячі клавіші, коли курсор не в полі вводу: / — пошук, N — новий запис, T — сьогодні, ←/→ — дні в розкладі.
  const typing = e.target.closest?.('input, textarea, select, [contenteditable]');
  if (!typing && !e.ctrlKey && !e.metaKey && !e.altKey && !$('.drawer')) {
    const page = location.hash.split('/')[1] ?? '';
    if (e.key === '/') { e.preventDefault(); $('#biz-q').focus(); return; }
    if (e.code === 'KeyN' && me().role !== 'master') { e.preventDefault(); newBookingDrawer(); return; }
    if (e.code === 'KeyT') { location.hash = `#/schedule/${today()}`; return; }
    if (page === 'schedule' && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
      const day = location.hash.split('/')[2] || today();
      location.hash = `#/schedule/${addDays(day, e.key === 'ArrowLeft' ? -1 : 1)}`;
      return;
    }
  }
  if ((e.key === 'Enter' || e.key === ' ') && e.target.matches('tr.link-row[data-href]')) location.hash = e.target.dataset.href;
});

document.addEventListener('input', (e) => {
  const t = e.target;
  if (t.id === 'biz-q') { renderSearch(t.value); return; }
  if (t.id === 'mail-text') ui.mailText = t.value;
  if (t.closest?.('#connect-form')) {
    const type = $('#connect-form').elements.type.value;
    if (t.name === 'code') $('#code-check').innerHTML = codeNote(type, t.value.replace(/\D/g, ''));
    if (t.name === 'iban') $('#iban-check').innerHTML = ibanNote(normIban(t.value));
  }
  if (t.id === 'client-q') { ui.q = t.value; $('#client-rows').innerHTML = clientRows(); }
  if (t.dataset.f && ui.svcDraft) {
    const s = ui.svcDraft[Number(t.dataset.i)];
    if (t.dataset.f === 'name') {
      s.name = t.value;
      // Підписи інших полів рядка називають послугу — оновлюємо їх разом із назвою.
      for (const el of t.closest('tr').querySelectorAll('[aria-label]')) {
        if (el !== t) el.setAttribute('aria-label', el.getAttribute('aria-label').replace(/: .*$/, `: ${t.value}`));
      }
    }
    if (t.dataset.f === 'min') s.min = Number(t.value) || 0;
    if (t.dataset.f === 'price') s.price[Number(t.dataset.k)] = Number(t.value) || 0;
  }
});

document.addEventListener('change', async (e) => {
  const t = e.target;
  if (t.matches('.biz-attach') && t.files?.[0]) {
    const photo = await shrinkPhoto(t.files[0]);
    if (!photo) { toast('Не вдалося відкрити фото'); return; }
    const f = t.form;
    const text = f.elements.text.value.trim();
    if (t.dataset.kind === 'booking') { bizChat(bookings.find((x) => x.id === f.dataset.id), text, photo); return; }
    const r = requests.find((x) => x.id === f.dataset.id);
    r.messages.push({ from: 'biz', text, at: Date.now(), photo });
    r.unreadClient = true;
    save();
    rerenderKeepScroll();
    toast('Фото надіслано клієнту');
    return;
  }
  // Вимкнений день, перерва чи особлива дата — години не потрібні.
  const toggles = { 'brk-on': ['brk-o', 'brk-c'], closed: ['o', 'c'] };
  if (/^on-\d$/.test(t.name)) toggles[t.name] = [`o-${t.name.slice(3)}`, `c-${t.name.slice(3)}`];
  if (toggles[t.name] && t.form) {
    for (const n of toggles[t.name]) t.form[n].disabled = t.name === 'closed' ? t.checked : !t.checked;
    return;
  }
  if (t.dataset.action === 'offer-toggle') {
    offers.find((o) => o.id === t.dataset.id).active = t.checked;
    save();
    t.closest('li').classList.toggle('off', !t.checked);
    toast(t.checked ? 'Послуга знову доступна клієнту' : 'Клієнт більше не бачить цю послугу');
    return;
  }
  if (t.name === 'base' && t.form?.id === 'offer-form') {
    const s = place().services.find((x) => x.id === t.value);
    const el = t.form.elements;
    if (s) { el.name.value = s.name; el.price.value = s.price[0]; el.min.value = s.min; el.cat.value = serviceCat(s); }
    return;
  }
  if (t.dataset.map) {
    ui.imp.map[t.dataset.map] = t.value === '' ? undefined : Number(t.value);
    rerenderKeepScroll();
    $(`[data-map="${t.dataset.map}"]`)?.focus();
    return;
  }
  if (t.id === 'imp-file' && t.files[0]) {
    ui.imp.text = '';
    loadImportText(await readFileText(t.files[0]));
    return;
  }
  if (t.id === 'as') {
    store.set('biz.session', { ...store.get('biz.session', {}), [ui.place]: t.value });
    const role = me().role;
    toast(`Панель відкрито як: ${me().name} · ${ROLES[role]}`);
    if (role === 'master') location.hash = '#/schedule'; else rerenderKeepScroll();
    return;
  }
  if (t.id === 'power') {
    if (t.value) setPower(ui.place, t.value);
    else { const all = store.get('biz.power', {}); delete all[ui.place]; store.set('biz.power', all); }
    rerenderKeepScroll();
    toast(t.value ? `Клієнти бачать: ${POWER[t.value][0]}` : 'Статус світла прибрано');
    return;
  }
  if (t.id === 'assign-master') {
    const b = bookings.find((x) => x.id === t.dataset.id);
    b.masterId = t.value || null;
    save();
    toast(t.value ? `Майстер: ${masterName(b)}` : 'Майстра знято із запису');
    return;
  }
  if (t.id === 'queue-on') {
    store.set('biz.queueOn', { ...store.get('biz.queueOn', {}), [ui.place]: t.checked });
    toast(t.checked ? 'Клієнти бачать чергу в застосунку' : 'Чергу приховано від клієнтів');
    return;
  }
  if (t.dataset.action === 'plan-toggle') {
    savePasses(ui.place, { plans: passesOf(ui.place).plans.map((x) => (x.id === t.dataset.id ? { ...x, active: t.checked } : x)) });
    t.closest('.plan').classList.toggle('off', !t.checked);
    return;
  }
  if (t.id === 'mail-seg') {
    ui.seg = t.value;
    ui.mailText = $('#mail-text').value;
    rerenderKeepScroll();
    $('#mail-seg').focus();
    return;
  }
  if (t.id === 'place' && t.value === '__new') {
    t.value = ui.place;
    newPlaceDrawer();
    return;
  }
  if (t.closest?.('#connect-form')) {
    collectConnect();
    if (t.dataset.doc && t.files[0]) {
      const f = t.files[0];
      connectDraft().docs[t.dataset.doc] = { name: f.name, size: f.size, type: f.type, at: Date.now() };
    }
    if (t.name === 'type') {
      const c = connectDraft().company;
      if (!TAX[c.type].some(([k]) => k === c.tax)) c.tax = TAX[c.type][0][0];
    }
    if (t.name === 'type' || t.dataset.doc) {
      rerenderKeepScroll();
      $(t.dataset.doc ? `[data-doc="${t.dataset.doc}"]` : `[name="type"][value="${t.value}"]`)?.focus();
    }
    return;
  }
  if (t.id === 'place') {
    ui.place = t.value;
    store.set('partner', ui.place);
    ui.svcDraft = null;
    route();
  } else if (t.id === 'day-pick' && t.value) location.hash = `#/schedule/${t.value}`;
  else if (t.id === 'client-sort') { ui.sort = t.value; $('#client-rows').innerHTML = clientRows(); }
  else if (ui.svcDraft && t.dataset.f === 'cat') ui.svcDraft[Number(t.dataset.i)].cat = t.value;
  else if (ui.svcDraft && t.dataset.f === 'active') { ui.svcDraft[Number(t.dataset.i)].off = !t.checked; t.closest('tr').classList.toggle('off', !t.checked); }
  else if (t.closest('#nb-form')) {
    const f = new FormData($('#nb-form'));
    Object.assign(nb, {
      clientName: f.get('clientName'), clientPhone: f.get('clientPhone'), carName: f.get('carName'), plate: f.get('plate'),
      cls: Number(f.get('cls')), date: f.get('date') || nb.date, time: f.get('time') ?? nb.time, channel: f.get('channel'), note: f.get('note'),
      master: f.get('master') ?? nb.master, usePass: f.get('usePass') ?? nb.usePass, cert: f.get('cert') ?? nb.cert,
      services: new Set(f.getAll('svc')),
    });
    // Новий телефон може відкрити персональні послуги клієнта — тоді оновлюємо список.
    if (t.name === 'clientPhone') {
      const ids = (x) => x.filter((s) => s.personal).map((s) => s.id).join();
      if (ids(nbServices()) !== ids([...$('#nb-form').querySelectorAll('[name="svc"]')].map((i) => ({ id: i.value, personal: i.value.startsWith('offer:') })))) renderNewBooking();
    } else if (!['clientName', 'carName', 'plate', 'note', 'cert'].includes(t.name)) {
      renderNewBooking();
      $(`#nb-form [name="${t.name}"]${t.type === 'checkbox' || t.type === 'radio' ? `[value="${t.value}"]` : ''}`)?.focus();
    }
  } else if (t.name === 'photos') {
    const n = Math.min(t.files.length, 3);
    t.closest('form').querySelector('.photo-count').textContent = n ? `Обрано фото: ${n}` : '';
  }
});

document.addEventListener('submit', async (e) => {
  const f = e.target;
  e.preventDefault();
  if (f.id === 'biz-login-form') {
    const d = new FormData(f);
    const acc = await checkBizLogin(String(d.get('login')), String(d.get('password')));
    if (!acc || !placeById(acc.placeId)) { $('#view').innerHTML = viewBizLogin('Невірний логін або пароль.'); $('#biz-login-form [name="login"]').value = String(d.get('login')); return; }
    store.set('biz.session', { login: acc.login, placeId: acc.placeId, at: Date.now() });
    ui.place = acc.placeId;
    store.set('partner', ui.place);
    location.hash = '#/';
    route();
    return;
  }
  if (f.id === 'connect-form') { saveConnect(e.submitter?.value ?? 'save'); return; }
  if (f.id === 'ticket-form' || f.id === 'ticket-reply' || f.id === 'dispute-note') {
    const d = new FormData(f);
    const text = d.get('text').trim();
    const photos = (await Promise.all(d.getAll('photos').filter((x) => x?.size).slice(0, 3).map(shrinkPhoto))).filter(Boolean);
    if (!text && !photos.length) return;
    if (f.id === 'ticket-reply') {
      ticketReply(f.dataset.id, 'place', text, undefined, photos);
      rerenderKeepScroll();
      toast('Повідомлення надіслано в підтримку');
      return;
    }
    const typedNo = d.get('bookingNo')?.trim();
    const byNo = typedNo ? findByNo(own(), typedNo) : null;
    if (typedNo && !byNo) { toast(`Запис № ${typedNo.replace(/\D/g, '')} не знайдено у вашій точці`); return; }
    const b = byNo ?? bookings.find((x) => x.id === (f.id === 'dispute-note' ? f.dataset.id : d.get('booking')));
    const t = openTicket({ from: 'place', placeId: ui.place, bookingId: b?.id ?? null, topic: f.id === 'dispute-note' ? 'dispute' : d.get('topic'), text, clientName: b ? clientName(b) : '', photos });
    if (f.id === 'dispute-note') { closeDrawer(); }
    location.hash = `#/support/${t.id}`;
    toast(`Звернення №${t.no} надіслано в CARCAR`);
    return;
  }
  if (f.id === 'bk-chat-form') {
    const text = new FormData(f).get('text').trim();
    if (text) bizChat(bookings.find((x) => x.id === f.dataset.id), text);
    return;
  }
  if (f.id === 'estimate-form') {
    const b = bookings.find((x) => x.id === f.dataset.id);
    const items = [...f.querySelectorAll('.est-row')].map((r) => ({
      id: uid(), kind: r.querySelector('[name="kind"]').value, name: r.querySelector('[name="name"]').value.trim(),
      qty: Number(r.querySelector('[name="qty"]').value) || 1, price: Math.round(Number(r.querySelector('[name="price"]').value) || 0),
      warranty: Number(r.querySelector('[name="warranty"]').value) || 0, status: 'pending',
    })).filter((x) => x.name && x.price > 0);
    if (!items.length) { toast('Додайте хоча б один пункт із назвою й ціною'); return; }
    const note = new FormData(f).get('note').trim();
    b.estimate = { items, note, at: Date.now(), state: 'sent' };
    if (isCarcar(b)) {
      chatPost(b, 'sys', `Точка надіслала кошторис на ${uah(estimateTotal(items))}: ${items.length} ${plural(items.length, 'пункт', 'пункти', 'пунктів')}`, 'client');
      sendMessages([{ placeId: b.placeId, clientKey: 'device', channel: 'app', kind: 'estimate', bookingId: b.id, link: `#/bookings/${b.id}`,
        text: `${place().name}: кошторис на ${uah(estimateTotal(items))} — погодьте потрібні пункти в записі.` }]);
    }
    save();
    bookingDrawer(b.id);
    rerenderKeepScroll();
    toast(isCarcar(b) ? 'Кошторис надіслано клієнту' : 'Кошторис збережено — позначте, коли клієнт погодить');
    return;
  }
  if (f.id === 'mobile-form') {
    const d = new FormData(f);
    const services = d.getAll('msvc');
    saveOverride(ui.place, { mobile: d.get('on') && services.length ? {
      radiusKm: Math.max(1, Number(d.get('radiusKm')) || 10), fee: Math.max(0, Number(d.get('fee')) || 0), crews: Math.max(1, Number(d.get('crews')) || 1), services,
    } : null });
    rerenderKeepScroll();
    toast(d.get('on') && services.length ? 'Виїзд до клієнтів увімкнено — клієнти бачать позначку «Виїзд до вас»' : 'Виїзд вимкнено');
    return;
  }
  if (await submitOps(f)) return;
  if (f.id === 'place-form') {
    const d = new FormData(f);
    const cats = d.getAll('cats');
    if (!cats.length) { toast('Оберіть хоча б одну категорію послуг'); return; }
    const open = Number(d.get('open'));
    const close = Number(d.get('close'));
    if (close <= open) { toast('Час закриття має бути пізніше за відкриття'); return; }
    const [lat, lng] = DISTRICTS[d.get('district')];
    const id = `p_${uid()}`;
    addCustomPlace({
      id, custom: true, name: d.get('name').trim(), cats, district: d.get('district'), address: d.get('address').trim(),
      phone: d.get('phone').trim(), boxes: Math.max(1, Number(d.get('boxes')) || 1), hours: open === 0 && close === 24 ? null : [open, close],
      lat, lng, tags: [], createdAt: Date.now(),
      services: cats.flatMap((c) => Object.entries(SERVICE_TEMPLATES[c]).map(([sid, x]) => ({ id: sid, ...x, price: [...x.price] }))),
    });
    savePartner(id, { status: 'draft', history: [{ at: Date.now(), by: 'partner', status: 'draft', note: 'Точку створено' }] });
    ui.place = id;
    store.set('partner', id);
    closeDrawer();
    location.hash = '#/connect';
    route();
    toast('Точку створено — заповніть дані для підключення');
    return;
  }
  if (f.id === 'nb-form') {
    const d = new FormData(f);
    const p = place();
    const chosen = nbServices().filter((s) => nb.services.has(s.id));
    const total = chosen.reduce((a, s) => a + s.price[nb.cls], 0);
    const plate = d.get('plate').trim().toUpperCase();
    const carName = d.get('carName').trim();
    const subs = usableSubs(ui.place, [phoneKey(d.get('clientPhone')), nb.clientKey].filter(Boolean), chosen.map((s) => s.id));
    let covered = nbCovered(chosen, subs);
    const id = uid();
    let passUse = null;
    if (covered) passUse = { ...redeemPass(ui.place, nb.usePass, covered, id), kind: 'sub' };
    const code = d.get('cert').trim();
    if (code && !passUse) {
      const cert = findCert(ui.place, code);
      if (!cert || !passActive(cert)) { toast('Сертифікат не знайдено, вичерпано або строк дії минув'); return; }
      covered = Math.min(cert.balance, total);
      passUse = { ...redeemPass(ui.place, cert.id, covered, id), kind: 'cert' };
    }
    const b = {
      id, source: 'crm', channel: d.get('channel'), placeId: p.id, services: chosen.map((s) => s.name), total, paid: total - covered, bonus: 0,
      covered, passUse, masterId: d.get('master') || null,
      minutes: chosen.reduce((a, s) => a + s.min, 0), date: d.get('date'), time: d.get('time'),
      car: [carName, plate].filter(Boolean).join(' · ') || CAR_CLASSES[nb.cls], plate, cls: nb.cls,
      clientName: d.get('clientName').trim(), clientPhone: d.get('clientPhone').trim(), note: d.get('note').trim(),
      state: 'booked', createdAt: Date.now(),
    };
    bookings.push(b);
    save();
    closeDrawer();
    location.hash = `#/schedule/${b.date}`;
    route();
    toast(`Записано: ${b.clientName}, ${dayLabel(b.date, { day: 'numeric', month: 'long' })} о ${b.time}`);
  } else if (f.id === 'complete-form') {
    const b = bookings.find((x) => x.id === f.dataset.id);
    const d = new FormData(f);
    Object.assign(b, { state: 'completed', payment: d.get('payment'), paid: Number(d.get('paid')) || 0, completedAt: Date.now() });
    save();
    closeDrawer();
    rerenderKeepScroll();
    toast('Запис виконано й оплачено');
  } else if (f.id === 'ready-form') {
    const b = bookings.find((x) => x.id === f.dataset.id);
    const d = new FormData(f);
    const files = d.getAll('photos').filter((x) => x.size).slice(0, 3);
    const photos = (await Promise.all(files.map(shrinkPhoto))).filter(Boolean);
    // Мийка сама підтверджує виконання: запис одразу виконаний, гроші заморожені на час для спору.
    Object.assign(b, { photos, note: d.get('note').trim() || null, km: Number(d.get('km')) || null, doneAt: Date.now() });
    complete(b);
    if (!store.set('bookings', bookings) && photos.length) { b.photos = []; save(); }
    closeDrawer();
    rerenderKeepScroll();
    toast('Клієнт отримав сповіщення «Машина готова»');
  } else if (f.id === 'staff-note') {
    bookings.find((x) => x.id === f.dataset.id).staffNote = new FormData(f).get('staffNote').trim();
    save();
    toast('Нотатку збережено');
  } else if (f.id === 'note-form') {
    const key = decodeURIComponent(location.hash.split('/')[2]);
    crm[ui.place] = { ...crm[ui.place], [key]: { ...clientMeta(key), note: new FormData(f).get('note').trim() } };
    save();
    toast('Нотатку збережено');
  } else if (f.id === 'svc-form') {
    const bad = ui.svcDraft.find((s) => !s.name.trim() || s.min <= 0 || s.price.some((v) => v <= 0));
    if (bad) { toast('Перевірте назву, тривалість і ціни — вони мають бути більші за нуль'); return; }
    if (!ui.svcDraft.some((s) => !s.off)) { toast('Залиште хоча б одну активну послугу'); return; }
    saveOverride(ui.place, { services: ui.svcDraft.map((s) => ({ ...s, name: s.name.trim() })) });
    ui.svcDraft = null;
    rerenderKeepScroll();
    toast('Прайс збережено — клієнти вже бачать нові ціни');
  } else if (f.id === 'settings-form') {
    const d = new FormData(f);
    const week = WEEKDAYS.map((_, i) => (d.get(`on-${i}`) ? [Number(d.get(`o-${i}`)), Number(d.get(`c-${i}`))] : null));
    const bad = week.findIndex((h) => h && h[1] <= h[0]);
    if (bad >= 0) { toast(`${WEEKDAY_NAMES[bad]}: час закриття має бути пізніше за відкриття`); return; }
    if (!week.some(Boolean)) { toast('Позначте хоча б один робочий день'); return; }
    const brk = d.get('brk-on') ? [Number(d.get('brk-o')), Number(d.get('brk-c'))] : null;
    if (brk && brk[1] <= brk[0]) { toast('Кінець перерви має бути пізніше за початок'); return; }
    const s = scheduleOf(place());
    saveOverride(ui.place, {
      phone: d.get('phone').trim(), boxes: Math.max(1, Number(d.get('boxes')) || 1),
      schedule: { week, brk, special: s.special, horizon: Number(d.get('horizon')), lead: Number(d.get('lead')) },
    });
    rerenderKeepScroll();
    toast('Профіль збережено');
  } else if (f.id === 'special-form') {
    const d = new FormData(f);
    const h = d.get('closed') ? null : [Number(d.get('o')), Number(d.get('c'))];
    if (h && h[1] <= h[0]) { toast('Час закриття має бути пізніше за відкриття'); return; }
    const s = scheduleOf(place());
    s.special[d.get('date')] = h;
    saveOverride(ui.place, { schedule: s });
    rerenderKeepScroll();
    toast(`${fmtDate(d.get('date'))}: ${rangeText(h).toLowerCase()}`);
  } else if (f.id === 'client-form') {
    const d = new FormData(f);
    const old = f.dataset.key;
    const phone = d.get('phone').trim();
    const name = d.get('name').trim();
    const key = old && (f.elements.phone.readOnly || phoneKey(phone) === old) ? old : phoneKey(phone) ?? `name:${name.toLowerCase()}`;
    if (key !== old && clientsList().some((c) => c.key === key)) { toast('Клієнт із таким телефоном уже є'); return; }
    const car = [d.get('carName').trim(), d.get('plate').trim().toUpperCase()].filter(Boolean).join(' · ');
    const prev = old ? clientMeta(old) : { tags: [], note: '' };
    if (old && key !== old) {
      // Телефон змінили в клієнта без записів: переносимо картку й персональні послуги на новий ключ.
      delete crm[ui.place][old];
      for (const o of offers) if (o.placeId === ui.place && o.clientKey === old) o.clientKey = key;
    }
    setMeta(key, { ...prev, name, phone, email: d.get('email').trim(), note: d.get('note').trim(), optIn: !!d.get('optIn'), cars: car ? [car, ...(prev.cars ?? []).slice(1)] : (prev.cars ?? []).slice(1), source: prev.source ?? 'crm' });
    save();
    closeDrawer();
    location.hash = `#/clients/${encodeURIComponent(key)}`;
    rerenderKeepScroll();
    toast(old ? 'Дані клієнта збережено' : `Клієнта додано: ${name}`);
  } else if (f.id === 'offer-form') {
    const d = new FormData(f);
    const base = place().services.find((x) => x.id === d.get('base'));
    offers.push({
      id: uid(), placeId: ui.place, clientKey: f.dataset.key, name: d.get('name').trim(), price: Math.round(Number(d.get('price'))),
      min: Math.round(Number(d.get('min'))), cat: d.get('cat'), note: d.get('note').trim(), base: base?.price[0] ?? null, active: true, createdAt: Date.now(),
    });
    save();
    closeDrawer();
    rerenderKeepScroll();
    toast('Персональну послугу збережено — клієнт побачить її в застосунку');
  } else if (f.id === 'expense-form') {
    const d = new FormData(f);
    expenses.push({
      id: uid(), placeId: ui.place, date: d.get('date'), cat: d.get('cat'), amount: Math.round(Number(d.get('amount'))),
      method: d.get('method'), note: d.get('note').trim(), recurring: !!d.get('recurring'), createdAt: Date.now(),
    });
    save();
    closeDrawer();
    rerenderKeepScroll();
    toast(d.get('recurring') ? 'Щомісячну витрату додано' : 'Витрату додано');
  } else if (f.matches('.req-answer')) {
    const r = requests.find((x) => x.id === f.dataset.id);
    r.messages.push({ from: 'biz', text: new FormData(f).get('text').trim(), at: Date.now() });
    r.unreadClient = true;
    save();
    rerenderKeepScroll();
    toast('Відповідь надіслано клієнту');
  } else if (f.id === 'req-service-form') {
    const d = new FormData(f);
    const r = requests.find((x) => x.id === f.dataset.id);
    const svc = { name: d.get('name').trim(), price: Math.round(Number(d.get('price'))), min: Math.round(Number(d.get('min'))), cat: d.get('cat') };
    const personal = d.get('scope') === 'personal';
    if (personal) {
      const key = phoneKey(r.clientPhone);
      offers.push({ id: uid(), placeId: ui.place, clientKey: key, ...svc, note: 'За вашим запитом', base: null, active: true, createdAt: Date.now() });
      // Клієнт зʼявляється в CRM, щоб персональну послугу було видно в його картці.
      if (!clientsList().some((c) => c.key === key)) setMeta(key, { name: r.clientName, phone: r.clientPhone, cars: r.car ? [r.car] : [], source: 'request' });
    } else {
      const p = place();
      saveOverride(ui.place, { services: [...p.allServices, { id: `c_${uid()}`, ...svc, price: [svc.price, svc.price, svc.price] }] });
    }
    const note = d.get('note').trim();
    r.messages.push({ from: 'biz', text: `Додали послугу «${svc.name}» — ${uah(svc.price)}${personal ? ', персонально для вас' : ''}. Можна записатися в застосунку.${note ? ` ${note}` : ''}`, at: Date.now() });
    Object.assign(r, { service: { ...svc, personal, at: Date.now() }, unreadClient: true });
    save();
    closeDrawer();
    rerenderKeepScroll();
    toast(personal ? 'Персональну послугу додано — клієнт отримав відповідь' : 'Послугу додано до прайсу — клієнт отримав відповідь');
  } else if (f.id === 'imp-paste') {
    ui.imp.text = new FormData(f).get('text');
    loadImportText(ui.imp.text);
  } else if (f.matches('.reply-form')) {
    const r = reviews.find((x) => x.id === f.dataset.id);
    const first = !r.reply;
    r.reply = { text: new FormData(f).get('reply').trim(), at: Date.now() };
    save();
    // Клієнт отримує відповідь у сповіщеннях застосунку.
    if (r.clientKey) {
      sendMessages([{ placeId: ui.place, clientKey: r.clientKey, channel: 'app', kind: 'reply', link: `#/place/${ui.place}`,
        text: `${place().name} ${first ? 'відповіла' : 'оновила відповідь'} на ваш відгук: «${r.reply.text}»` }]);
    }
    rerenderKeepScroll();
    toast('Відповідь опубліковано на сторінці точки');
  }
});

// Застосунок клієнта в іншій вкладці змінив записи чи відгуки — перечитуємо.
window.addEventListener('storage', (e) => {
  if (!e.key?.startsWith('carcar.') || e.key === `carcar.${PRESENCE_KEY}` || $('.drawer')) return;
  load();
  rerenderKeepScroll();
});

$('#new-booking').innerHTML = `${icon('plus', 18)}Новий запис`;
$('#to-app').innerHTML = `${icon('chevL', 18)}Застосунок клієнта`;
window.addEventListener('hashchange', () => { document.body.classList.remove('menu-open'); closeDrawerSilently(); route(); window.scrollTo(0, 0); });
function closeDrawerSilently() { $('#drawer-root').innerHTML = ''; }
route();
