// Панель для бізнесу CARCAR: журнал по боксах, CRM клієнтів, прайс, фінанси, відгуки й аналітика.
// Працює з тими самими даними, що й застосунок клієнта (спільне сховище на цьому пристрої):
// запис, внесений тут, займає бокс у застосунку, а прайс і години одразу бачать клієнти.
import { CATEGORIES, CAR_CLASSES, PLACES, PAYMENT } from './data.js';
import {
  store, icon, esc, uah, pad, hhmm, toMin, isoDate, parseDate, uid, placeById, plural, duration, dayLabel, rating,
  fmtTime, fmtDate, hash, openRange, bookingStart, serviceCat, catById, shrinkPhoto, applyOverrides, saveOverride,
  ACTIVE, BLOCKING, HOUR, isCarcar, price, isFrozen, balanceFor, settleAll, ratingFor,
} from './core.js';

// ---------- дані ----------

let bookings, payouts, reviews, crm;

function load() {
  bookings = store.get('bookings', []);
  payouts = store.get('payouts', []);
  reviews = store.get('reviews', []);
  crm = store.get('biz.clients', {}); // нотатки й мітки клієнтів: { placeId: { clientKey: { note, tags } } }
  applyOverrides();
  if (settleAll(bookings)) save();
}

function save() {
  store.set('bookings', bookings);
  store.set('payouts', payouts);
  store.set('reviews', reviews);
  store.set('biz.clients', crm);
}

load();

const ui = { place: store.get('partner', null), period: 30, clients: 'all', q: '', sort: 'last', svcDraft: null };
if (!placeById(ui.place)) ui.place = PLACES[0].id;

const place = () => placeById(ui.place);
const own = () => bookings.filter((b) => b.placeId === ui.place);
const $ = (sel, root = document) => root.querySelector(sel);
const today = () => isoDate(new Date());
const addDays = (iso, n) => { const d = parseDate(iso); d.setDate(d.getDate() + n); return isoDate(d); };
const isPast = (b) => bookingStart(b).getTime() + b.minutes * 60000 <= Date.now();
// Запис уже відбувся для аналітики: час минув або його вже позначили виконаним.
const happened = (b) => b.state === 'completed' || isPast(b);
const compact = (v) => (v >= 1000 ? `${(v / 1000).toLocaleString('uk-UA', { maximumFractionDigits: 1 })} тис.` : String(Math.round(v)));
const pct = (v) => `${Math.round(v)}%`;
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

const CHANNEL = { carcar: 'CARCAR', phone: 'Телефон', walkin: 'З вулиці' };
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
function clientKey(b) {
  if (b.clientPhone) return `tel:${b.clientPhone.replace(/\D/g, '')}`;
  if (b.carId) return `car:${b.car}`;
  return `anon:${b.id}`;
}
const clientName = (b) => b.clientName || 'Клієнт CARCAR';
const clientMeta = (key) => crm[ui.place]?.[key] ?? { note: '', tags: [] };

// ---------- аналітика ----------

function rangeOf(n, back = 0) {
  const end = addDays(today(), -back * n);
  return [addDays(end, -(n - 1)), end];
}
const inRange = (b, [s, e]) => b.date >= s && b.date <= e;

function statsFor(range) {
  const p = place();
  const list = own().filter((b) => inRange(b, range) && happened(b));
  const done = list.filter((b) => b.state === 'completed');
  const rev = list.reduce((a, b) => a + revenue(b), 0);
  const viaCarcar = list.filter(isCarcar).reduce((a, b) => a + revenue(b), 0);
  const lost = list.filter((b) => b.state === 'cancelled' || b.state === 'noshow').length;
  const [o, c] = openRange(p);
  const days = Math.round((parseDate(range[1]) - parseDate(range[0])) / 864e5) + 1;
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
    load: ((busy / ((c - o) * p.boxes * days)) * 100) || 0,
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

function niceMax(v) {
  if (v <= 0) return 4;
  const step = 10 ** Math.floor(Math.log10(v / 4));
  const m = [1, 2, 2.5, 5, 10].find((k) => (v / 4) <= k * step) * step;
  return m * 4;
}

const topRound = (x, y, w, h) => {
  const r = Math.min(4, h / 2, w / 2);
  return `M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h}Z`;
};

// Стовпчики (одна серія або дві складені), з тултипом на кожну категорію.
function drawColumns(el, spec) {
  const W = Math.max(280, el.clientWidth);
  const H = spec.height ?? 220;
  const L = 52, R = 6, T = 10, B = 26;
  const n = spec.cats.length;
  const sums = spec.cats.map((c) => c.values.reduce((a, v) => a + v, 0));
  const max = niceMax(Math.max(...sums, 0));
  const band = (W - L - R) / n;
  const bw = Math.max(2, Math.min(24, band * 0.66));
  const y = (v) => T + (H - T - B) * (1 - v / max);
  const every = Math.ceil(n / Math.max(1, Math.floor((W - L) / 56)));
  let g = '<g class="grid">';
  for (let i = 0; i <= 4; i++) {
    const v = (max / 4) * i;
    g += `<line x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}"/><text class="axis" x="${L - 8}" y="${y(v) + 4}" text-anchor="end">${compact(v)}</text>`;
  }
  g += '</g>';
  let marks = '';
  let hits = '';
  spec.cats.forEach((c, i) => {
    const x = L + band * i + (band - bw) / 2;
    let base = H - B;
    c.values.forEach((v, s) => {
      if (v <= 0) return;
      const h = (H - T - B) * (v / max) - (base < H - B ? 2 : 0);
      if (h <= 0) return;
      const top = base - h - (base < H - B ? 2 : 0);
      const isTop = c.values.slice(s + 1).every((u) => u <= 0);
      marks += isTop
        ? `<path class="s${s + 1}" d="${topRound(x, top, bw, h)}"/>`
        : `<rect class="s${s + 1}" x="${x}" y="${top}" width="${bw}" height="${h}"/>`;
      base = top;
    });
    if (i % every === 0) marks += `<text class="axis" x="${x + bw / 2}" y="${H - 8}" text-anchor="middle">${esc(c.short ?? c.label)}</text>`;
    const tip = { t: c.label, r: spec.series.map((s, k) => [`s${k + 1}`, spec.fmt(c.values[k]), s]) };
    if (spec.series.length > 1) tip.r.push(['', spec.fmt(sums[i]), 'Разом']);
    const aria = `${c.label}: ${spec.series.map((s, k) => `${s} ${spec.fmt(c.values[k])}`).join(', ')}`;
    hits += `<rect class="hit" role="img" tabindex="0" aria-label="${esc(aria)}" data-tip="${esc(JSON.stringify(tip))}" x="${L + band * i}" y="${T}" width="${band}" height="${H - T - B}"/>`;
  });
  el.innerHTML = `<svg width="${W}" height="${H}" role="group" aria-label="${esc(spec.title)}">${g}${marks}${hits}</svg>`;
}

function mountCharts() {
  for (const [id, spec] of Object.entries(charts)) {
    const el = document.getElementById(id);
    if (el) drawColumns(el, spec);
  }
}

let resizeT;
window.addEventListener('resize', () => { clearTimeout(resizeT); resizeT = setTimeout(mountCharts, 120); });

const legend = (names) => `<ul class="legend">${names.map((n, i) => `<li><i class="s${i + 1}"></i>${esc(n)}</li>`).join('')}</ul>`;

function tableView(head, rows) {
  return `<details class="table-view"><summary>Показати таблицею</summary><div class="details-table"><table class="t">
    <thead><tr>${head.map((h, i) => `<th${i ? ' class="num"' : ''}>${esc(h)}</th>`).join('')}</tr></thead>
    <tbody>${rows.map((r) => `<tr>${r.map((c, i) => `<td${i ? ' class="num"' : ''}>${esc(c)}</td>`).join('')}</tr>`).join('')}</tbody>
  </table></div></details>`;
}

function hbars(items, fmt) {
  const max = Math.max(...items.map((i) => i.value), 1);
  return `<ul class="hbars">${items.map((i) => `<li>
    <span class="name" title="${esc(i.name)}">${esc(i.name)}</span>
    <span class="track"><span class="fill" style="width:${Math.max(1, (i.value / max) * 100)}%"></span></span>
    <span class="val">${fmt(i.value)}</span></li>`).join('')}</ul>`;
}

// Один тултип на сторінку; значення першим, назва серії — після. Вставляємо через textContent.
function showTip(target, x, y) {
  const data = JSON.parse(target.dataset.tip);
  const tip = $('#tip');
  tip.replaceChildren();
  const t = document.createElement('div');
  t.className = 't';
  t.textContent = data.t;
  tip.append(t);
  for (const [cls, value, name] of data.r) {
    const row = document.createElement('div');
    row.className = 'r';
    const k = document.createElement('span');
    k.className = 'k';
    k.style.background = cls ? `var(--series-${cls.slice(1)})` : 'transparent';
    const v = document.createElement('b');
    v.textContent = value;
    const n = document.createElement('span');
    n.textContent = name;
    row.append(k, v, n);
    tip.append(row);
  }
  tip.hidden = false;
  const r = tip.getBoundingClientRect();
  const left = Math.min(window.innerWidth - r.width - 8, Math.max(8, x + 14));
  const top = y - r.height - 12 < 8 ? y + 16 : y - r.height - 12;
  tip.style.left = `${left}px`;
  tip.style.top = `${top}px`;
}
const hideTip = () => { $('#tip').hidden = true; };

document.addEventListener('pointermove', (e) => {
  const t = e.target.closest?.('[data-tip]');
  if (t) showTip(t, e.clientX, e.clientY); else hideTip();
});
document.addEventListener('focusin', (e) => {
  const t = e.target.closest?.('[data-tip]');
  if (!t) return hideTip();
  const r = t.getBoundingClientRect();
  showTip(t, r.left + r.width / 2, r.top);
});

// ---------- огляд ----------

function viewOverview() {
  const p = place();
  if (!own().length) {
    return `<h1>Огляд</h1><p class="page-sub">${esc(p.name)}</p>
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
  const [o, c] = openRange(p);
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

  const todayList = own().filter((b) => b.date === today() && b.state !== 'cancelled').sort((a, b) => a.time.localeCompare(b.time));
  const sh = (x) => `${Math.round((x / Math.max(1, cur.rev)) * 100)}%`;

  return `<h1>Огляд</h1><p class="page-sub">${esc(p.name)} · записи з CARCAR і з вашого журналу</p>
    <div class="filters">
      <div class="seg" role="group" aria-label="Період">
        ${[7, 30, 90].map((d) => `<button data-action="period" data-n="${d}" aria-pressed="${d === n}">${d} ${daysWord(d)}</button>`).join('')}
      </div>
      <span class="small muted">${fmtDate(from)} — ${fmtDate(to)}</span>
    </div>
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

    <div class="grid-3" style="margin-top:16px">
      <section class="panel" aria-labelledby="h-rev">
        <h2 id="h-rev">Виручка по днях</h2>
        <p class="sub">Виконані замовлення й компенсації за неявки</p>
        ${legend(['Через CARCAR', 'На місці (каса)'])}
        <div class="chart" id="ch-rev"></div>
        ${tableView(['День', 'Через CARCAR', 'На місці', 'Разом'], byDay.map((x) => [x.label, uah(x.values[0]), uah(x.values[1]), uah(x.values[0] + x.values[1])]))}
      </section>
      <section class="panel" aria-labelledby="h-today">
        <h2 id="h-today">Сьогодні</h2>
        <p class="sub">${todayList.length} ${plural(todayList.length, 'запис', 'записи', 'записів')}</p>
        <div class="stack" style="gap:8px">
          ${todayList.length ? todayList.slice(0, 8).map((b) => `<button class="card today-item" data-action="open-booking" data-id="${b.id}" style="text-align:left;padding:10px 12px;gap:4px">
            <span class="head"><b>${b.time} · ${esc(clientName(b))}</b>${statusPill(b)}</span>
            <span class="small muted">${esc(b.services.join(', '))}</span></button>`).join('') : '<p class="muted" style="margin:0">Сьогодні записів немає.</p>'}
          <a class="btn" href="#/schedule">${icon('calendar', 18)}Відкрити розклад</a>
        </div>
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
  const [o, c] = openRange(p);
  const list = own().filter((b) => b.date === day && b.state !== 'cancelled' && b.state !== 'refunded');
  const { placed, overflow } = layoutDay(list, p.boxes);
  const cols = p.boxes + (overflow.length ? 1 : 0);
  const height = ((c - o) / 30) * ROW;
  const busy = list.filter((b) => b.state !== 'noshow').reduce((a, b) => a + b.minutes, 0);
  const now = new Date();
  const nowMin = now.getHours() * 60 + now.getMinutes();
  const block = (b) => {
    const top = ((toMin(b.time) - o) / 30) * ROW;
    const h = Math.max(ROW - 4, (b.minutes / 30) * ROW - 4);
    const tone = isPast(b) || b.state === 'completed' || b.state === 'noshow' ? 'past' : isCarcar(b) ? 'carcar' : 'cash';
    const size = h < 40 ? ' tiny' : h < 58 ? ' short' : '';
    return `<button class="slot-block ${tone}${size}" style="top:${top + 2}px;height:${h}px" data-action="open-booking" data-id="${b.id}"
      aria-label="${esc(`${b.time}, ${clientName(b)}, ${b.services.join(', ')}, ${STATUS[b.state][0]}`)}">
      <b>${b.time}–${hhmm(toMin(b.time) + b.minutes)} · ${esc(clientName(b))}</b>
      <span>${esc(b.services.join(', '))}</span>
      <span>${CHANNEL[channelOf(b)]} · ${STATUS[b.state][0]}</span></button>`;
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
      <span>Завантаженість: <b>${pct((busy / ((c - o) * p.boxes)) * 100)}</b></span>
      <span>Через CARCAR: <b>${list.filter(isCarcar).length}</b></span>
    </div>
    <div class="sched" tabindex="0" role="region" aria-label="Журнал по боксах">
      <div class="sched-grid" style="grid-template-columns:64px repeat(${cols}, minmax(150px, 1fr))">
        <div class="sched-col-head"></div>
        ${Array.from({ length: p.boxes }, (_, i) => `<div class="sched-col-head">Бокс ${i + 1}</div>`).join('')}
        ${overflow.length ? '<div class="sched-col-head">Понад місткість</div>' : ''}
        <div class="sched-times" style="height:${height}px">${times.join('')}</div>
        ${Array.from({ length: p.boxes }, (_, i) => `<div class="sched-col" style="height:${height}px;${colBg}">
          ${day === today() && nowMin >= o && nowMin <= c ? `<div class="now-line" style="top:${((nowMin - o) / 30) * ROW}px"></div>` : ''}
          ${placed.filter(([, k]) => k === i).map(([b]) => block(b)).join('')}</div>`).join('')}
        ${overflow.length ? `<div class="sched-col" style="height:${height}px;${colBg}">${overflow.map(block).join('')}</div>` : ''}
      </div>
    </div>
    <div class="legend-row"><span class="pill carcar"><i></i>Оплачено в CARCAR</span><span class="pill cash"><i></i>Оплата на місці</span><span class="pill muted">Завершені</span></div>`;
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
  return [...map.values()].map((c) => ({ ...c, meta: clientMeta(c.key), main: Object.entries(c.channels).sort((a, b) => b[1] - a[1])[0][0] }));
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
    <td><a class="row-link" href="#/clients/${encodeURIComponent(c.key)}">${esc(c.name)}</a><small>${esc(c.phone || 'через CARCAR')}</small></td>
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
  return `<a class="back" href="#/clients">${icon('chevL', 22)}Клієнти</a>
    <h1>${esc(c.name)}</h1>
    <p class="page-sub">${c.phone ? `<a href="tel:${esc(c.phone.replace(/[^+\d]/g, ''))}">${esc(c.phone)}</a> · ` : 'Клієнт CARCAR · '}${esc([...c.cars].join(', ') || 'авто не вказано')}</p>
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
          <label class="field"><span>Нотатка</span><textarea name="note" rows="4" placeholder="Наприклад, любить чай, шини зберігаємо в нас">${esc(c.meta.note)}</textarea></label>
          <button class="btn" type="submit">Зберегти нотатку</button>
        </form>
      </section>
      <section class="panel" aria-labelledby="h-act">
        <h2 id="h-act">Дії</h2>
        <div class="stack">
          <button class="btn primary" data-action="new-booking" data-client="${esc(key)}">${icon('plus', 18)}Записати клієнта</button>
          ${c.phone ? `<a class="btn" href="tel:${esc(c.phone.replace(/[^+\d]/g, ''))}">${icon('phone', 18)}Зателефонувати</a>` : '<p class="small muted">Клієнт записується через CARCAR — сповіщення приходять йому в застосунок.</p>'}
          ${c.upcoming ? `<p class="small muted" style="margin:0">Вже записаний: ${c.upcoming} ${plural(c.upcoming, 'запис', 'записи', 'записів')}.</p>` : ''}
        </div>
      </section>
    </div>
    <h2 class="biz-h2">Історія візитів</h2>
    <div class="table-wrap" tabindex="0" role="region" aria-label="Історія візитів"><table class="t">
      <thead><tr><th>Дата</th><th>Послуги</th><th>Канал</th><th>Статус</th><th class="num">Сума</th></tr></thead>
      <tbody>${hist.map((b) => `<tr class="link-row" data-action="open-booking" data-id="${b.id}"><td>${dayLabel(b.date, { day: 'numeric', month: 'short', year: 'numeric' })}, ${b.time}</td>
        <td>${esc(b.services.join(', '))}</td><td>${channelPill(b)}</td><td>${statusPill(b)}</td><td class="num">${uah(isCarcar(b) ? price(b) : b.paid)}</td></tr>`).join('')}</tbody>
    </table></div>`;
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
  const fee = Math.round(bal.available * PAYMENT.commission);
  const mine = payouts.filter((x) => x.placeId === p.id).sort((a, b) => b.at - a.at);
  const feesPaid = mine.reduce((a, x) => a + x.fee, 0);
  const ledger = own().filter(isCarcar).sort((a, b) => (b.date + b.time).localeCompare(a.date + a.time));
  const [from, to] = rangeOf(30);
  const cashList = own().filter((b) => !isCarcar(b) && b.state === 'completed' && inRange(b, [from, to]));
  const cashBy = (m) => cashList.filter((b) => b.payment === m).reduce((a, b) => a + b.paid, 0);
  return `<h1>Фінанси</h1><p class="page-sub">Гроші за замовлення через CARCAR: утримання, заморожування на ${PAYMENT.freezeHours} год і виплати</p>
    <section class="kpis" aria-label="Баланс">
      <div class="kpi hero"><span class="label">Доступно до виведення</span><span class="value">${uah(bal.available)}</span>
        <span class="kpi-note">комісія ${Math.round(PAYMENT.commission * 100)}% під час виведення${bal.available > 0 ? `: ${uah(fee)}` : ''}</span></div>
      <div class="kpi"><span class="label">Заморожено</span><span class="value">${uah(bal.frozen)}</span>
        <span class="kpi-note">${bal.next ? `найближче: ${uah(price(bal.next))} — ${fmtTime(bal.next.unfreezeAt)}` : 'немає замовлень у роботі'}</span></div>
      <div class="kpi"><span class="label">Виведено всього</span><span class="value">${uah(mine.reduce((a, x) => a + x.net, 0))}</span></div>
      <div class="kpi"><span class="label">Комісія сплачена</span><span class="value">${uah(feesPaid)}</span></div>
    </section>
    <div class="row" style="margin:14px 0 4px">
      <button class="btn primary" data-action="payout" ${bal.available > 0 ? '' : 'disabled'}>${icon('card', 20)}${bal.available > 0 ? `Вивести ${uah(bal.available - fee)} на картку` : 'Немає коштів для виведення'}</button>
      <button class="btn" data-action="export-ledger">${icon('download', 18)}Експорт CSV</button>
    </div>
    <p class="small muted">Оплати на місці за 30 днів: готівка ${uah(cashBy('cash'))}, картка ${uah(cashBy('card'))}. Вони не проходять через CARCAR і комісією не обкладаються.</p>
    <h2 class="biz-h2">Замовлення через CARCAR</h2>
    <div class="table-wrap" tabindex="0" role="region" aria-label="Замовлення через CARCAR"><table class="t">
      <thead><tr><th>Дата</th><th>Клієнт</th><th>Послуги</th><th>Статус грошей</th><th class="num">Сума точці</th></tr></thead>
      <tbody>${ledger.length ? ledger.slice(0, 150).map((b) => {
        const [label, cls] = moneyStatus(b);
        return `<tr class="link-row" data-action="open-booking" data-id="${b.id}"><td>${dayLabel(b.date, { day: 'numeric', month: 'short' })}, ${b.time}</td>
          <td>${esc(clientName(b))}<small>${esc(b.car)}</small></td><td>${esc(b.services.join(', '))}</td>
          <td><span class="pill ${cls}">${esc(label)}</span></td><td class="num">${uah(shareOf(b))}${b.bonus ? `<small>з них бонус ${uah(b.bonus)}</small>` : ''}</td></tr>`;
      }).join('') : '<tr><td colspan="5" class="muted">Замовлень через CARCAR ще не було.</td></tr>'}</tbody>
    </table></div>
    <h2 class="biz-h2">Виплати</h2>
    <div class="table-wrap" tabindex="0" role="region" aria-label="Виплати"><table class="t">
      <thead><tr><th>Дата</th><th class="num">Сума</th><th class="num">Комісія</th><th class="num">На картку</th></tr></thead>
      <tbody>${mine.length ? mine.map((x) => `<tr><td>${fmtTime(x.at)}</td><td class="num">${uah(x.gross)}</td><td class="num">${uah(x.fee)}</td><td class="num">${uah(x.net)}</td></tr>`).join('') : '<tr><td colspan="4" class="muted">Виплат ще не було.</td></tr>'}</tbody>
    </table></div>`;
}

// ---------- відгуки ----------

const stars = (n) => `<span class="stars" role="img" aria-label="Оцінка ${rating(n)} з 5">${[1, 2, 3, 4, 5]
  .map((i) => `<span class="${i <= Math.round(n) ? 'on' : ''}">${icon('star', 14)}</span>`).join('')}</span>`;

function viewReviews() {
  const p = place();
  const list = reviews.filter((r) => r.placeId === p.id).sort((a, b) => b.at - a.at);
  const r = ratingFor(p.id, reviews);
  return `<h1>Відгуки</h1><p class="page-sub">Лише від клієнтів, які завершили замовлення через CARCAR. Ваша відповідь видна на сторінці точки.</p>
    <section class="kpis" aria-label="Рейтинг">
      <div class="kpi"><span class="label">Рейтинг</span><span class="value">${r.count ? rating(r.avg) : '—'}</span>${r.count ? stars(r.avg) : ''}</div>
      <div class="kpi"><span class="label">Відгуків</span><span class="value">${r.count}</span></div>
      <div class="kpi"><span class="label">Без відповіді</span><span class="value">${list.filter((x) => !x.reply).length}</span></div>
    </section>
    <div class="stack" style="margin-top:16px">
      ${list.length ? list.map((x) => `<article class="panel stack" style="gap:8px">
        <div class="head">${stars(x.stars)}<span class="small muted">${fmtDate(x.date)}</span></div>
        ${x.text ? `<p style="margin:0">${esc(x.text)}</p>` : '<p class="muted" style="margin:0">Без тексту, лише оцінка.</p>'}
        <span class="small muted">Підтверджений візит · ${esc(x.services)}</span>
        <form class="reply-form stack" data-id="${x.id}" style="gap:8px">
          <label class="field"><span>${x.reply ? 'Ваша відповідь' : 'Відповісти'}</span><textarea name="reply" rows="2" maxlength="500" required placeholder="Дякуємо за відгук!">${esc(x.reply?.text ?? '')}</textarea></label>
          <button class="btn" type="submit" style="align-self:flex-start">${x.reply ? 'Оновити відповідь' : 'Відповісти'}</button>
        </form>
      </article>`).join('') : `<div class="empty-state">${icon('star', 32)}<h2>Ще немає відгуків</h2><p>Клієнт може залишити відгук після того, як підтвердить виконання замовлення в застосунку.</p></div>`}
    </div>`;
}

// ---------- профіль точки ----------

function viewSettings() {
  const p = place();
  const hourOpts = (sel, from, to) => Array.from({ length: to - from + 1 }, (_, i) => from + i)
    .map((h) => `<option value="${h}" ${h === sel ? 'selected' : ''}>${pad(h)}:00</option>`).join('');
  return `<h1>Профіль точки</h1><p class="page-sub">Ці дані бачать клієнти на сторінці точки, а години й бокси визначають вільний час для запису.</p>
    <form id="settings-form" class="panel stack" style="max-width:560px;gap:14px">
      <label class="field"><span>Телефон</span><input name="phone" required value="${esc(p.phone)}" autocomplete="off"></label>
      <label class="row" style="gap:10px"><input class="check" type="checkbox" name="allday" ${p.hours ? '' : 'checked'}> Працюємо цілодобово</label>
      <div class="form-grid">
        <label class="field"><span>Відкриття</span><select name="open">${hourOpts(p.hours?.[0] ?? 8, 0, 23)}</select></label>
        <label class="field"><span>Закриття</span><select name="close">${hourOpts(p.hours?.[1] ?? 20, 1, 24)}</select></label>
      </div>
      <label class="field"><span>Кількість боксів</span><input name="boxes" type="number" min="1" max="20" value="${p.boxes}"></label>
      <div class="row">
        <button class="btn primary" type="submit">Зберегти</button>
        <button class="btn" type="button" data-action="settings-reset">Повернути як було</button>
        <a class="btn" href="index.html#/place/${p.id}" target="_blank" rel="noopener">Сторінка точки для клієнтів</a>
      </div>
    </form>`;
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
    actions = `<form class="stack ready-form" id="ready-form" data-id="${b.id}">
        <label class="dropzone">${icon('camera', 24)}Додати фото результату (до 3)
          <span class="photo-count" aria-live="polite"></span>
          <input class="sr-only" name="photos" type="file" accept="image/*" multiple></label>
        <div class="form-grid">
          <label class="field"><span>Пробіг, км</span><input name="km" type="number" min="0" autocomplete="off"></label>
          <label class="field"><span>Коментар для клієнта</span><input name="note" autocomplete="off"></label>
        </div>
        <button class="btn primary" type="submit">Машина готова</button>
        <p class="fine">Клієнт підтвердить виконання в застосунку — тоді гроші заморозяться на ${PAYMENT.freezeHours} год і стануть доступні до виведення.</p>
      </form>
      ${started ? `<button class="btn text-danger" data-action="carcar-noshow" data-id="${b.id}">Клієнт не приїхав</button>` : ''}`;
  } else if (b.state === 'done') {
    actions = `<p class="notice">Чекаємо підтвердження клієнта. Якщо він не відповість, замовлення підтвердиться автоматично ${fmtTime(b.doneAt + PAYMENT.autoReleaseHours * HOUR)}.</p>`;
  } else if (b.state === 'completed' && isCarcar(b)) {
    actions = `<p class="notice">${isFrozen(b) ? `Гроші заморожені до ${fmtTime(b.unfreezeAt)}.` : 'Гроші доступні до виведення у «Фінансах».'}</p>`;
  }
  const key = clientKey(b);
  openDrawer(`${b.time} · ${esc(clientName(b))}`, `
    <div class="row">${channelPill(b)}${statusPill(b)}</div>
    <dl class="kv">
      <dt>Дата</dt><dd>${dayLabel(b.date, { weekday: 'long', day: 'numeric', month: 'long' })}, ${b.time}–${hhmm(toMin(b.time) + b.minutes)}</dd>
      <dt>Клієнт</dt><dd><a href="#/clients/${encodeURIComponent(key)}" data-action="close-drawer-nav">${esc(clientName(b))}</a>${b.clientPhone ? ` · <a href="tel:${esc(b.clientPhone.replace(/[^+\d]/g, ''))}">${esc(b.clientPhone)}</a>` : ''}</dd>
      <dt>Авто</dt><dd>${esc(b.car || '—')}</dd>
      <dt>Послуги</dt><dd>${esc(b.services.join(', '))}</dd>
      <dt>Сума</dt><dd>${uah(isCarcar(b) ? price(b) : b.paid)}${isCarcar(b) ? ' · оплачено через CARCAR' : b.payment ? ` · ${b.payment === 'cash' ? 'готівка' : 'картка'}` : ' · оплата на місці'}</dd>
      ${b.note && !isCarcar(b) ? `<dt>Коментар</dt><dd>${esc(b.note)}</dd>` : ''}
    </dl>
    ${actions}
    <form class="stack" id="staff-note" data-id="${b.id}" style="gap:8px">
      <label class="field"><span>Нотатка для персоналу</span><textarea name="staffNote" rows="2">${esc(b.staffNote ?? '')}</textarea></label>
      <button class="btn" type="submit" style="align-self:flex-start">Зберегти нотатку</button>
    </form>`);
}

// Вільні початки для нового запису: бокс вільний, якщо записів, що перетинаються, менше, ніж боксів.
function freeStarts(date, minutes) {
  const p = place();
  const [o, c] = openRange(p);
  const now = new Date();
  const nowMin = date === today() ? now.getHours() * 60 + now.getMinutes() : -1;
  const spans = own().filter((b) => b.date === date && BLOCKING.includes(b.state)).map((b) => [toMin(b.time), toMin(b.time) + b.minutes]);
  const out = [];
  for (let t = o; t + minutes <= c; t += 30) {
    if (t <= nowMin) continue;
    if (spans.filter(([s, e]) => t < e && t + minutes > s).length < p.boxes) out.push(hhmm(t));
  }
  return out;
}

let nb = null; // чернетка нового запису

function newBookingDrawer(prefill = {}) {
  nb = { cls: 0, services: new Set(), date: today(), time: '', channel: 'phone', ...prefill };
  openDrawer('Новий запис', '<form class="stack" id="nb-form" style="gap:14px"></form>');
  renderNewBooking();
}

function renderNewBooking() {
  const p = place();
  const chosen = p.services.filter((s) => nb.services.has(s.id));
  const minutes = chosen.reduce((a, s) => a + s.min, 0) || 30;
  const total = chosen.reduce((a, s) => a + s.price[nb.cls], 0);
  const starts = freeStarts(nb.date, minutes);
  if (!starts.includes(nb.time)) nb.time = starts[0] ?? '';
  $('#nb-form').innerHTML = `
    <div class="form-grid">
      <label class="field"><span>Імʼя клієнта</span><input name="clientName" required value="${esc(nb.clientName ?? '')}" autocomplete="off"></label>
      <label class="field"><span>Телефон клієнта</span><input name="clientPhone" required inputmode="tel" value="${esc(nb.clientPhone ?? '')}" placeholder="+380" autocomplete="off"></label>
      <label class="field"><span>Авто</span><input name="carName" value="${esc(nb.carName ?? '')}" placeholder="Наприклад, Skoda Octavia" autocomplete="off"></label>
      <label class="field"><span>Держномер</span><input name="plate" value="${esc(nb.plate ?? '')}" placeholder="AA1234BB" autocomplete="off"></label>
      <label class="field full"><span>Клас авто</span><select name="cls">${CAR_CLASSES.map((c, i) => `<option value="${i}" ${i === nb.cls ? 'selected' : ''}>${c}</option>`).join('')}</select></label>
    </div>
    <div><div class="small muted" style="margin-bottom:6px">Послуги</div>
      <div class="list svc-pick">${p.services.map((s) => `<label class="item"><input class="check" type="checkbox" name="svc" value="${s.id}" ${nb.services.has(s.id) ? 'checked' : ''}>
        <span class="name">${esc(s.name)}<small>${duration(s.min)}</small></span><span class="price">${uah(s.price[nb.cls])}</span></label>`).join('')}</div></div>
    <div class="form-grid">
      <label class="field"><span>Дата</span><input name="date" type="date" required value="${nb.date}" min="${today()}"></label>
      <label class="field"><span>Час</span><select name="time" ${starts.length ? '' : 'disabled'}>${starts.length ? starts.map((t) => `<option ${t === nb.time ? 'selected' : ''}>${t}</option>`).join('') : '<option>Немає вільних боксів</option>'}</select></label>
    </div>
    <fieldset class="radio-row"><legend>Звідки запис</legend>
      <label><input type="radio" name="channel" value="phone" ${nb.channel === 'phone' ? 'checked' : ''}> Телефон</label>
      <label><input type="radio" name="channel" value="walkin" ${nb.channel === 'walkin' ? 'checked' : ''}> Прийшов сам</label></fieldset>
    <label class="field"><span>Коментар</span><input name="note" value="${esc(nb.note ?? '')}" autocomplete="off"></label>
    <div class="head nb-foot"><b>${chosen.length ? `${uah(total)} · ${duration(minutes)}` : 'Оберіть послуги'}</b>
      <button class="btn primary" type="submit" ${chosen.length && nb.time ? '' : 'disabled'}>Записати</button></div>`;
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
  }));
  const [o, c] = openRange(p);
  const out = [];
  for (let d = -90; d <= 3; d++) {
    const date = addDays(today(), d);
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
        if (spans.filter(([s, e]) => cand < e && cand + minutes > s).length < p.boxes) t = cand;
      }
      if (t < 0) continue;
      spans.push([t, t + minutes]);
      const total = svc.reduce((a, s) => a + s.price[cl.cls], 0);
      const channel = r() < 0.45 ? 'carcar' : r() < 0.64 ? 'phone' : 'walkin';
      const b = {
        id: uid(), source: 'demo', channel, placeId: p.id, services: svc.map((s) => s.name), total, paid: total, bonus: 0,
        minutes, date, time: hhmm(t), car: `${cl.car} · ${cl.plate}`, plate: cl.plate, cls: cl.cls,
        clientName: cl.name, clientPhone: cl.phone, createdAt: Date.now(),
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
    const fee = Math.round(gross * PAYMENT.commission);
    payouts.push({ id: uid(), placeId: p.id, gross, fee, net: gross - fee, at, demo: true });
    withdrawn += gross;
  }
  save();
  route();
  toast(`Додано ${out.length} демо-записів за 90 днів`);
}

function demoClear(silent) {
  bookings = bookings.filter((b) => !(b.source === 'demo' && b.placeId === ui.place));
  payouts = payouts.filter((x) => !(x.demo && x.placeId === ui.place));
  save();
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

const NAV = [
  ['', 'Огляд', 'chart'],
  ['schedule', 'Розклад', 'calendar'],
  ['clients', 'Клієнти', 'users'],
  ['services', 'Послуги й ціни', 'list'],
  ['finance', 'Фінанси', 'card'],
  ['reviews', 'Відгуки', 'star'],
  ['settings', 'Профіль точки', 'settings'],
];

function renderChrome(page) {
  const unanswered = reviews.filter((r) => r.placeId === ui.place && !r.reply).length;
  $('#nav').innerHTML = NAV.map(([id, label, ic]) => `<a href="#/${id}" ${page === id ? 'aria-current="page"' : ''}>${icon(ic, 20)}${label}
    ${id === 'reviews' && unanswered ? `<span class="count" aria-label="без відповіді: ${unanswered}">${unanswered}</span>` : ''}</a>`).join('');
  $('#place').innerHTML = PLACES.map((p) => `<option value="${p.id}" ${p.id === ui.place ? 'selected' : ''}>${esc(p.name)}</option>`).join('');
}

function route() {
  hideTip();
  charts = {};
  const [, page = '', arg] = location.hash.replace(/^#/, '').split('/');
  if (page !== 'services') ui.svcDraft = null;
  renderChrome(page);
  const view = $('#view');
  if (page === '') view.innerHTML = viewOverview();
  else if (page === 'schedule') view.innerHTML = viewSchedule(/^\d{4}-\d\d-\d\d$/.test(arg ?? '') ? arg : today());
  else if (page === 'clients') view.innerHTML = arg ? viewClient(decodeURIComponent(arg)) : viewClients();
  else if (page === 'services') view.innerHTML = viewServices();
  else if (page === 'finance') view.innerHTML = viewFinance();
  else if (page === 'reviews') view.innerHTML = viewReviews();
  else if (page === 'settings') view.innerHTML = viewSettings();
  else view.innerHTML = '<p>Сторінку не знайдено.</p>';
  mountCharts();
}

function rerenderKeepScroll() {
  const y = window.scrollY;
  route();
  window.scrollTo(0, y);
}

document.addEventListener('click', (e) => {
  const row = e.target.closest('tr.link-row[data-href]');
  if (row && !e.target.closest('a')) { location.hash = row.dataset.href; return; }
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
  else if (action === 'new-booking') {
    const c = el.dataset.client ? clientsList().find((x) => x.key === el.dataset.client) : null;
    const last = c?.list.find((b) => b.clientName) ?? c?.list[0];
    newBookingDrawer(c ? { clientName: c.name === 'Клієнт CARCAR' ? '' : c.name, clientPhone: c.phone, carName: last?.car?.split(' · ')[0] ?? '', plate: last?.plate ?? '', cls: last?.cls ?? 0 } : {});
  } else if (action === 'open-booking') bookingDrawer(id);
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
    const fee = Math.round(available * PAYMENT.commission);
    if (!confirm(`Вивести ${uah(available)}? Комісія ${uah(fee)}, на картку надійде ${uah(available - fee)}.`)) return;
    payouts.push({ id: uid(), placeId: ui.place, gross: available, fee, net: available - fee, at: Date.now() });
    save();
    rerenderKeepScroll();
    toast('Виплату відправлено на картку');
  } else if (action === 'crm-noshow' || action === 'crm-cancel') {
    const b = bookings.find((x) => x.id === id);
    if (!confirm(action === 'crm-noshow' ? 'Позначити, що клієнт не приїхав?' : 'Скасувати запис?')) return;
    b.state = action === 'crm-noshow' ? 'noshow' : 'cancelled';
    save();
    closeDrawer();
    rerenderKeepScroll();
    toast(action === 'crm-noshow' ? 'Позначено неявку' : 'Запис скасовано');
  } else if (action === 'carcar-noshow') {
    const b = bookings.find((x) => x.id === id);
    const placeAmount = Math.round(b.paid * PAYMENT.noShowShare);
    if (!confirm(`Позначити неявку? Точка отримає ${uah(placeAmount)}, решту повернемо клієнту.`)) return;
    Object.assign(b, { state: 'noshow', placeAmount, refund: b.paid - placeAmount });
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
  } else if (action === 'settings-reset') {
    const all = store.get('biz.places', {});
    if (all[ui.place]) { delete all[ui.place].phone; delete all[ui.place].hours; delete all[ui.place].boxes; }
    store.set('biz.places', all);
    applyOverrides();
    rerenderKeepScroll();
    toast('Профіль повернуто');
  }
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && $('.drawer')) closeDrawer();
  if ((e.key === 'Enter' || e.key === ' ') && e.target.matches('tr.link-row[data-href]')) location.hash = e.target.dataset.href;
});

document.addEventListener('input', (e) => {
  const t = e.target;
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

document.addEventListener('change', (e) => {
  const t = e.target;
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
      services: new Set(f.getAll('svc')),
    });
    if (t.name !== 'clientName' && t.name !== 'clientPhone' && t.name !== 'carName' && t.name !== 'plate' && t.name !== 'note') {
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
  if (f.id === 'nb-form') {
    const d = new FormData(f);
    const p = place();
    const chosen = p.services.filter((s) => nb.services.has(s.id));
    const total = chosen.reduce((a, s) => a + s.price[nb.cls], 0);
    const plate = d.get('plate').trim().toUpperCase();
    const carName = d.get('carName').trim();
    const b = {
      id: uid(), source: 'crm', channel: d.get('channel'), placeId: p.id, services: chosen.map((s) => s.name), total, paid: total, bonus: 0,
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
    Object.assign(b, { photos, note: d.get('note').trim() || null, km: Number(d.get('km')) || null, state: 'done', doneAt: Date.now() });
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
    const open = Number(d.get('open'));
    const close = Number(d.get('close'));
    if (!d.get('allday') && close <= open) { toast('Час закриття має бути пізніше за відкриття'); return; }
    saveOverride(ui.place, { phone: d.get('phone').trim(), hours: d.get('allday') ? null : [open, close], boxes: Math.max(1, Number(d.get('boxes')) || 1) });
    rerenderKeepScroll();
    toast('Профіль збережено');
  } else if (f.matches('.reply-form')) {
    const r = reviews.find((x) => x.id === f.dataset.id);
    r.reply = { text: new FormData(f).get('reply').trim(), at: Date.now() };
    save();
    rerenderKeepScroll();
    toast('Відповідь опубліковано на сторінці точки');
  }
});

// Застосунок клієнта в іншій вкладці змінив записи чи відгуки — перечитуємо.
window.addEventListener('storage', (e) => {
  if (!e.key?.startsWith('carcar.') || $('.drawer')) return;
  load();
  rerenderKeepScroll();
});

$('#new-booking').innerHTML = `${icon('plus', 18)}Новий запис`;
$('#to-app').innerHTML = `${icon('chevL', 18)}Застосунок клієнта`;
window.addEventListener('hashchange', () => { closeDrawerSilently(); route(); window.scrollTo(0, 0); });
function closeDrawerSilently() { $('#drawer-root').innerHTML = ''; }
route();
