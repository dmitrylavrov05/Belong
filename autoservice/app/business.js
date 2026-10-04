// Панель для бізнесу CARCAR: журнал по боксах, CRM клієнтів, прайс, фінанси, відгуки й аналітика.
// Працює з тими самими даними, що й застосунок клієнта (спільне сховище на цьому пристрої):
// запис, внесений тут, займає бокс у застосунку, а прайс і години одразу бачать клієнти.
import { CATEGORIES, CAR_CLASSES, PLACES, PAYMENT } from './data.js';
import {
  store, icon, esc, uah, pad, hhmm, toMin, isoDate, parseDate, uid, placeById, plural, duration, dayLabel, rating,
  fmtTime, fmtDate, hash, bookingStart, hoursFor, scheduleOf, widestRange, inBreak, rangeText, WEEKDAYS, WEEKDAY_NAMES,
  weekdayOf, phoneKey, offersOf, offerAsService, EXPENSE_CATS, PAY_METHODS, expensesIn, serviceCat, catById, shrinkPhoto, applyOverrides, saveOverride,
  ACTIVE, BLOCKING, HOUR, isCarcar, price, isFrozen, balanceFor, settleAll, ratingFor,
} from './core.js';

// ---------- дані ----------

let bookings, payouts, reviews, crm, offers, expenses;

function load() {
  bookings = store.get('bookings', []);
  payouts = store.get('payouts', []);
  reviews = store.get('reviews', []);
  // Картки клієнтів: { placeId: { clientKey: { name, phone, cars, email, note, tags } } }
  crm = store.get('biz.clients', {});
  offers = store.get('biz.offers', []); // персональні послуги й ціни
  expenses = store.get('biz.expenses', []); // витрати: разові й щомісячні
  applyOverrides();
  if (settleAll(bookings)) save();
}

function save() {
  store.set('bookings', bookings);
  store.set('payouts', payouts);
  store.set('reviews', reviews);
  store.set('biz.clients', crm);
  store.set('biz.offers', offers);
  store.set('biz.expenses', expenses);
}

load();

const ui = { place: store.get('partner', null), period: 30, finPeriod: 30, expPeriod: 30, clients: 'all', q: '', sort: 'last', svcDraft: null, imp: { type: 'clients', text: '', rows: null, map: {}, result: null } };
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
  const max = niceMax(Math.max(...(spec.grouped ? spec.cats.flatMap((c) => c.values) : sums), 0));
  const band = (W - L - R) / n;
  const bw = Math.max(2, Math.min(spec.grouped ? 40 : 24, band * (spec.grouped ? 0.76 : 0.66)));
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
    // Згруповані стовпчики стоять поруч із проміжком 2 px; складені — один над одним.
    if (spec.grouped) {
      const k = c.values.length;
      const w = Math.max(1, (bw - 2 * (k - 1)) / k);
      c.values.forEach((v, s) => {
        const h = (H - T - B) * (v / max);
        if (h > 0) marks += `<path class="s${s + 1}" d="${topRound(x + s * (w + 2), H - B - h, w, h)}"/>`;
      });
    } else c.values.forEach((v, s) => {
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
    if (spec.grouped) tip.r.push(['', spec.fmt(c.values[0] - c.values[1]), 'Різниця']);
    else if (spec.series.length > 1) tip.r.push(['', spec.fmt(sums[i]), 'Разом']);
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
  const hours = hoursFor(p, day);
  const [o, c] = hours ?? widestRange(p);
  const brk = scheduleOf(p).brk;
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
      <span>Графік: <b>${rangeText(hours)}</b>${brk && hours ? `, перерва ${rangeText(brk)}` : ''}</span>
      ${hours ? `<span>Завантаженість: <b>${pct((busy / capacity(p, [day, day])) * 100)}</b></span>` : ''}
      <span>Через CARCAR: <b>${list.filter(isCarcar).length}</b></span>
    </div>
    ${hours ? '' : `<p class="notice warn">За графіком це вихідний день — клієнти не можуть записатися. Змінити графік можна в <a href="#/settings">профілі точки</a>.</p>`}
    <div class="sched" tabindex="0" role="region" aria-label="Журнал по боксах">
      <div class="sched-grid" style="grid-template-columns:64px repeat(${cols}, minmax(150px, 1fr))">
        <div class="sched-col-head"></div>
        ${Array.from({ length: p.boxes }, (_, i) => `<div class="sched-col-head">Бокс ${i + 1}</div>`).join('')}
        ${overflow.length ? '<div class="sched-col-head">Понад місткість</div>' : ''}
        <div class="sched-times" style="height:${height}px">${times.join('')}</div>
        ${Array.from({ length: p.boxes }, (_, i) => `<div class="sched-col" style="height:${height}px;${colBg}">
          ${brk && hours ? `<div class="break-block" style="top:${((brk[0] - o) / 30) * ROW}px;height:${((brk[1] - brk[0]) / 30) * ROW}px">Перерва</div>` : ''}
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
    ${offersPanel(c)}
    <h2 class="biz-h2">Історія візитів</h2>
    ${hist.length ? `<div class="table-wrap" tabindex="0" role="region" aria-label="Історія візитів"><table class="t">
      <thead><tr><th>Дата</th><th>Послуги</th><th>Канал</th><th>Статус</th><th class="num">Сума</th></tr></thead>
      <tbody>${hist.map((b) => `<tr class="link-row" data-action="open-booking" data-id="${b.id}"><td>${dayLabel(b.date, { day: 'numeric', month: 'short', year: 'numeric' })}, ${b.time}</td>
        <td>${esc(b.services.join(', '))}</td><td>${channelPill(b)}</td><td>${statusPill(b)}</td><td class="num">${uah(isCarcar(b) ? price(b) : b.paid)}</td></tr>`).join('')}</tbody>
    </table></div>` : '<p class="muted">Записів ще не було.</p>'}`;
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
  const fee = Math.round(bal.available * PAYMENT.commission);
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
      <thead><tr><th>Дата</th><th class="num">Сума</th><th class="num">Комісія</th><th class="num">На картку</th></tr></thead>
      <tbody>${mine.length ? mine.map((x) => `<tr><td>${fmtTime(x.at)}</td><td class="num">${uah(x.gross)}</td><td class="num">${uah(x.fee)}</td><td class="num">${uah(x.net)}</td></tr>`).join('') : '<tr><td colspan="4" class="muted">Виплат ще не було.</td></tr>'}</tbody>
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
        <td>${e.template ? '' : `<button class="icon-btn" data-action="exp-del" data-id="${e.id}" aria-label="Видалити витрату ${esc(e.cat)}, ${uah(e.amount)}">${icon('x', 18)}</button>`}</td></tr>`).join('')
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
  const income = inc.carcar + inc.cash + inc.card + inc.other;
  const fee = Math.round(inc.carcar * PAYMENT.commission);
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
    ['Разом доходи', r.income, 't'],
    ['Витрати', null, 'h'],
    [`Комісія CARCAR, ${Math.round(PAYMENT.commission * 100)}%`, r.fee],
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
    actions = `${isPast(b) ? '<p class="notice warn">Час візиту минув. Позначте «Машина готова» — клієнт підтвердить виконання, і гроші надійдуть на ваш баланс.</p>' : ''}
      <form class="stack ready-form" id="ready-form" data-id="${b.id}">
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
    actions = `<p class="notice">Чекаємо підтвердження клієнта. Якщо він не відповість, замовлення підтвердиться автоматично ${fmtTime(b.doneAt + PAYMENT.autoReleaseHours * HOUR)}.</p>
      <button class="btn" data-action="remind" data-id="${b.id}">${icon('chat', 18)}Нагадати клієнту</button>
      ${b.remindedAt ? `<p class="small muted" style="margin:0">Останнє нагадування: ${fmtTime(b.remindedAt)}</p>` : ''}`;
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
      <div class="list svc-pick">${all.map((s) => `<label class="item"><input class="check" type="checkbox" name="svc" value="${s.id}" ${nb.services.has(s.id) ? 'checked' : ''}>
        <span class="name">${esc(s.name)}${s.personal ? ' <span class="badge personal">Для клієнта</span>' : ''}<small>${duration(s.min)}</small></span><span class="price">${uah(s.price[nb.cls])}</span></label>`).join('')}</div></div>
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
  // Витрати точки: щомісячні (оренда, зарплата, комунальні) і разові закупівлі хімії, реклама.
  const k = p.boxes;
  const month0 = addDays(today(), -100).slice(0, 8);
  const demoExp = (o) => expenses.push({ id: uid(), placeId: p.id, source: 'demo', method: 'account', note: '', ...o });
  demoExp({ date: `${month0}05`, cat: 'Оренда', amount: 9000 * k, recurring: true, note: 'Приміщення' });
  demoExp({ date: `${month0}10`, cat: 'Зарплата', amount: 16000 * k, recurring: true, method: 'card', note: 'Майстри' });
  demoExp({ date: `${month0}15`, cat: 'Комунальні послуги', amount: 2500 * k, recurring: true, note: 'Вода, світло' });
  demoExp({ date: `${month0}20`, cat: 'Податки', amount: 6500, recurring: true, note: 'Єдиний податок і ЄСВ' });
  for (let d = -90; d <= 0; d += 7) {
    demoExp({ date: addDays(today(), d), cat: p.cats.includes('wash') ? 'Хімія й витратні матеріали' : 'Запчастини', amount: Math.round((900 + r() * 1400) * k / 10) * 10, method: r() < 0.5 ? 'cash' : 'card' });
    if (r() < 0.35) demoExp({ date: addDays(today(), d - 2), cat: 'Реклама', amount: Math.round((500 + r() * 1500) / 10) * 10, method: 'card', note: 'Таргетована реклама' });
  }
  save();
  route();
  toast(`Додано ${out.length} демо-записів за 90 днів`);
}

function demoClear(silent) {
  bookings = bookings.filter((b) => !(b.source === 'demo' && b.placeId === ui.place));
  payouts = payouts.filter((x) => !(x.demo && x.placeId === ui.place));
  expenses = expenses.filter((x) => !(x.source === 'demo' && x.placeId === ui.place));
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
  ['expenses', 'Витрати', 'cash'],
  ['reviews', 'Відгуки', 'star'],
  ['settings', 'Профіль точки', 'settings'],
  ['import', 'Імпорт даних', 'upload'],
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
  else if (page === 'expenses') view.innerHTML = viewExpenses();
  else if (page === 'import') view.innerHTML = viewImport();
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
    newBookingDrawer(c ? { clientKey: c.key, clientName: c.name === 'Клієнт CARCAR' ? '' : c.name, clientPhone: c.phone, carName: last?.car?.split(' · ')[0] ?? '', plate: last?.plate ?? '', cls: last?.cls ?? 0 } : {});
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
  } else if (action === 'remind') {
    const b = bookings.find((x) => x.id === id);
    b.remindedAt = Date.now();
    save();
    bookingDrawer(id);
    toast('Клієнт отримав нагадування підтвердити виконання');
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

document.addEventListener('change', async (e) => {
  const t = e.target;
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
    // Новий телефон може відкрити персональні послуги клієнта — тоді оновлюємо список.
    if (t.name === 'clientPhone') {
      const ids = (x) => x.filter((s) => s.personal).map((s) => s.id).join();
      if (ids(nbServices()) !== ids([...$('#nb-form').querySelectorAll('[name="svc"]')].map((i) => ({ id: i.value, personal: i.value.startsWith('offer:') })))) renderNewBooking();
    } else if (t.name !== 'clientName' && t.name !== 'carName' && t.name !== 'plate' && t.name !== 'note') {
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
    const chosen = nbServices().filter((s) => nb.services.has(s.id));
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
    setMeta(key, { ...prev, name, phone, email: d.get('email').trim(), note: d.get('note').trim(), cars: car ? [car, ...(prev.cars ?? []).slice(1)] : (prev.cars ?? []).slice(1), source: prev.source ?? 'crm' });
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
  } else if (f.id === 'imp-paste') {
    ui.imp.text = new FormData(f).get('text');
    loadImportText(ui.imp.text);
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
