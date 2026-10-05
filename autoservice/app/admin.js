// Адмінка CARCAR: зведена статистика платформи, модерація підключення точок, відгуків і спорів, комісії.
// Працює з тими самими даними, що й застосунок клієнта та панель бізнесу (сховище цього пристрою).
// У робочій версії сюди мають доступ лише співробітники CARCAR (вхід із двофакторною автентифікацією).
import { CATEGORIES, PLACES, PAYMENT } from './data.js';
import {
  store, icon, esc, uah, pad, isoDate, parseDate, plural, dayLabel, rating, fmtTime, fmtDate, catById, WEEKDAYS, bookingStart, HOUR,
  PARTNER_STATUS, partnerOf, savePartner, commissionFor, isCarcar, price, placeShare, isFrozen,
  ratingFor, visibleReviews, ACTIVE, resolveDispute, settleAll, applyOverrides,
} from './core.js';
import { ENTITY, TAX, DOCS, OFFER, codeValid, ibanValid, ibanBank, formatIban, missingSteps } from './partners.js';
import { drawColumns, legend, tableView, hbars, hideTip } from './charts.js';

// ---------- дані ----------

let bookings, payouts, reviews;

function load() {
  bookings = store.get('bookings', []);
  payouts = store.get('payouts', []);
  reviews = store.get('reviews', []);
  applyOverrides();
  if (settleAll(bookings)) store.set('bookings', bookings);
}

function save() {
  store.set('bookings', bookings);
  store.set('payouts', payouts);
  store.set('reviews', reviews);
}

load();

const ui = { period: 30, places: 'queue', reviews: 'reported' };
const $ = (sel, root = document) => root.querySelector(sel);
const today = () => isoDate(new Date());
const addDays = (iso, n) => { const d = parseDate(iso); d.setDate(d.getDate() + n); return isoDate(d); };
const daysWord = (n) => plural(n, 'день', 'дні', 'днів');
const pctText = (k) => `${(k * 100).toLocaleString('uk-UA', { maximumFractionDigits: 1 })}%`;
const placeName = (id) => PLACES.find((p) => p.id === id)?.name ?? 'Невідома точка';

function rangeOf(n, back = 0) {
  const end = addDays(today(), -back * n);
  return [addDays(end, -(n - 1)), end];
}
const inRange = (b, [s, e]) => b.date >= s && b.date <= e;

function toast(text) {
  const el = $('#toast');
  el.textContent = text;
  el.classList.add('show');
  clearTimeout(toast.t);
  toast.t = setTimeout(() => el.classList.remove('show'), 2600);
}

const statusPill = (st) => `<span class="pill ${PARTNER_STATUS[st][1]}">${PARTNER_STATUS[st][0]}</span>`;
const stars = (n) => `<span class="stars" role="img" aria-label="Оцінка ${rating(n)} з 5">${[1, 2, 3, 4, 5]
  .map((i) => `<span class="${i <= Math.round(n) ? 'on' : ''}">${icon('star', 14)}</span>`).join('')}</span>`;

// ---------- статистика ----------

// Оборот через CARCAR: повна ціна виконаних замовлень і те, що точка отримала за неявки, пізні скасування й спори.
const settled = (b) => isCarcar(b) && ['completed', 'cancelled', 'noshow', 'refunded'].includes(b.state);
const gmvOf = (b) => (b.state === 'completed' ? price(b) : placeShare(b));

function statsFor(range, placeId) {
  const list = bookings.filter((b) => isCarcar(b) && inRange(b, range) && (!placeId || b.placeId === placeId));
  const done = list.filter((b) => b.state === 'completed');
  const gmv = list.filter(settled).reduce((a, b) => a + gmvOf(b), 0);
  const fee = list.filter(settled).reduce((a, b) => a + gmvOf(b) * commissionFor(b.placeId), 0);
  const past = list.filter((b) => ['completed', 'cancelled', 'noshow', 'refunded'].includes(b.state));
  const lost = past.filter((b) => b.state === 'cancelled' || b.state === 'noshow').length;
  const clients = new Set(list.map((b) => b.clientPhone?.replace(/\D/g, '').slice(-9) || b.car)).size;
  return {
    gmv, fee: Math.round(fee), orders: done.length, clients, avg: done.length ? done.reduce((a, b) => a + price(b), 0) / done.length : 0,
    lostPct: past.length ? (lost / past.length) * 100 : 0, bonus: done.reduce((a, b) => a + (b.bonus || 0), 0),
  };
}

function delta(cur, prev, goodWhenUp = true, unit = '%') {
  if (!prev) return '<span class="delta flat">немає даних за попередній період</span>';
  const d = unit === 'pp' ? cur - prev : ((cur - prev) / prev) * 100;
  if (Math.abs(d) < 0.5) return '<span class="delta flat">без змін</span>';
  const good = d > 0 === goodWhenUp;
  return `<span class="delta ${good ? 'up' : 'down'}">${d > 0 ? '▲' : '▼'} ${d > 0 ? '+' : '−'}${Math.abs(Math.round(d))}${unit === 'pp' ? ' п.п.' : '%'}<span class="sr-only"> проти попереднього періоду</span></span>`;
}

let charts = {};
function mountCharts() {
  for (const [id, spec] of Object.entries(charts)) {
    const el = document.getElementById(id);
    if (el) drawColumns(el, spec);
  }
}
let resizeT;
window.addEventListener('resize', () => { clearTimeout(resizeT); resizeT = setTimeout(mountCharts, 120); });

// Черги модерації: що чекає на рішення CARCAR.
function queues() {
  const placeQueue = PLACES.filter((p) => inQueue(partnerOf(p.id))).length;
  return {
    places: placeQueue,
    reviews: reviews.filter((r) => r.report?.status === 'open').length,
    disputes: bookings.filter((b) => b.state === 'dispute').length,
  };
}
const inQueue = (pt) => pt.status === 'pending' || pt.update === 'pending' || (pt.payout?.iban && !pt.payout.verified && pt.status === 'approved');

function viewOverview() {
  const n = ui.period;
  const range = rangeOf(n);
  const cur = statsFor(range);
  const prev = statsFor(rangeOf(n, 1));
  const q = queues();
  const escrow = bookings.filter((b) => isCarcar(b) && (ACTIVE.includes(b.state) || isFrozen(b))).reduce((a, b) => a + price(b), 0);
  const collected = payouts.filter((x) => x.at >= parseDate(range[0]).getTime()).reduce((a, x) => a + x.fee, 0);
  const vis = visibleReviews(reviews);
  const avgRating = vis.length ? vis.reduce((a, r) => a + r.stars, 0) / vis.length : 0;
  const listed = PLACES.filter((p) => partnerOf(p.id).status === 'approved').length;

  const days = [];
  for (let d = range[0]; d <= range[1]; d = addDays(d, 1)) days.push(d);
  const byDay = days.map((d) => {
    const v = bookings.filter((b) => b.date === d && settled(b)).reduce((a, b) => a + gmvOf(b), 0);
    const x = parseDate(d);
    return { label: dayLabel(d), short: `${x.getDate()}.${pad(x.getMonth() + 1)}`, values: [v] };
  });
  charts = { 'ch-gmv': { title: `Оборот через CARCAR по днях за ${n} ${daysWord(n)}`, cats: byDay, series: ['Оборот'], fmt: uah } };

  const perPlace = PLACES.map((p) => ({ p, s: statsFor(range, p.id) })).sort((a, b) => b.s.gmv - a.s.gmv);
  const byCat = CATEGORIES.map((c) => ({ name: c.name, value: perPlace.filter(({ p }) => p.cats[0] === c.id).reduce((a, { s }) => a + s.gmv, 0) }))
    .filter((x) => x.value > 0).sort((a, b) => b.value - a.value);

  return `<h1>Огляд платформи</h1><p class="page-sub">Замовлення й гроші, що пройшли через CARCAR, по всіх точках</p>
    <div class="filters">
      <div class="seg" role="group" aria-label="Період">${[7, 30, 90].map((d) => `<button data-action="period" data-n="${d}" aria-pressed="${d === n}">${d} ${daysWord(d)}</button>`).join('')}</div>
      <span class="small muted">${fmtDate(range[0])} — ${fmtDate(range[1])}</span>
    </div>
    ${q.places + q.reviews + q.disputes ? `<div class="queue-row">
      ${q.places ? `<a class="queue" href="#/places">${icon('shield', 20)}<b>${q.places}</b> ${plural(q.places, 'точка чекає', 'точки чекають', 'точок чекають')} перевірки</a>` : ''}
      ${q.disputes ? `<a class="queue" href="#/disputes">${icon('scale', 20)}<b>${q.disputes}</b> ${plural(q.disputes, 'відкритий спір', 'відкриті спори', 'відкритих спорів')}</a>` : ''}
      ${q.reviews ? `<a class="queue" href="#/reviews">${icon('star', 20)}<b>${q.reviews}</b> ${plural(q.reviews, 'скарга', 'скарги', 'скарг')} на відгуки</a>` : ''}
    </div>` : ''}
    <section class="kpis" aria-label="Показники платформи">
      <div class="kpi hero"><span class="label">Оборот через CARCAR</span><span class="value">${uah(cur.gmv)}</span>${delta(cur.gmv, prev.gmv)}
        <span class="kpi-note">${cur.orders} ${plural(cur.orders, 'замовлення', 'замовлення', 'замовлень')} · середній чек ${uah(Math.round(cur.avg))}</span></div>
      <div class="kpi"><span class="label">Комісія нарахована</span><span class="value">${uah(cur.fee)}</span>${delta(cur.fee, prev.fee)}<span class="kpi-note">утримано з виплат ${uah(collected)}</span></div>
      <div class="kpi"><span class="label">Утримується зараз</span><span class="value">${uah(escrow)}</span><span class="kpi-note">замовлення в роботі й заморожені</span></div>
      <div class="kpi"><span class="label">Клієнтів</span><span class="value">${cur.clients}</span>${delta(cur.clients, prev.clients)}</div>
      <div class="kpi"><span class="label">Скасування й неявки</span><span class="value">${Math.round(cur.lostPct)}%</span>${delta(cur.lostPct, prev.lostPct, false, 'pp')}</div>
      <div class="kpi"><span class="label">Точок у каталозі</span><span class="value">${listed}</span><span class="kpi-note">усього зареєстровано ${PLACES.length}</span></div>
      <div class="kpi"><span class="label">Середній рейтинг</span><span class="value">${vis.length ? rating(avgRating) : '—'}</span><span class="kpi-note">${vis.length} ${plural(vis.length, 'відгук', 'відгуки', 'відгуків')}</span></div>
      <div class="kpi"><span class="label">Бонуси «Приведи друга»</span><span class="value">${uah(cur.bonus)}</span><span class="kpi-note">доплачено точкам за CARCAR</span></div>
    </section>
    <div class="grid-3" style="margin-top:16px">
      <section class="panel" aria-labelledby="h-gmv">
        <h2 id="h-gmv">Оборот по днях</h2><p class="sub">Виконані замовлення й компенсації точкам</p>
        <div class="chart" id="ch-gmv"></div>
        ${tableView(['День', 'Оборот'], byDay.map((x) => [x.label, uah(x.values[0])]))}
      </section>
      <section class="panel" aria-labelledby="h-cat">
        <h2 id="h-cat">За категоріями</h2><p class="sub">Оборот за основною категорією точки</p>
        ${byCat.length ? hbars(byCat, uah) : '<p class="muted" style="margin:0">Замовлень за період немає.</p>'}
      </section>
    </div>
    <h2 class="biz-h2">Точки</h2>
    <div class="table-wrap" tabindex="0" role="region" aria-label="Показники точок"><table class="t">
      <thead><tr><th>Точка</th><th>Статус</th><th class="num">Замовлень</th><th class="num">Оборот</th><th class="num">Комісія</th><th class="num">Нараховано</th><th class="num">Рейтинг</th><th class="num">Спори</th></tr></thead>
      <tbody>${perPlace.map(({ p, s }) => {
        const r = ratingFor(p.id, reviews);
        return `<tr class="link-row" data-href="#/places/${p.id}"><td><a class="row-link" href="#/places/${p.id}">${esc(p.name)}</a><small>${esc(p.district)} · ${p.cats.map((c) => catById(c).name).join(', ')}</small></td>
          <td>${statusPill(partnerOf(p.id).status)}</td><td class="num">${s.orders}</td><td class="num">${uah(s.gmv)}</td>
          <td class="num">${pctText(commissionFor(p.id))}</td><td class="num">${uah(s.fee)}</td>
          <td class="num">${r.count ? rating(r.avg) : '—'}</td><td class="num">${bookings.filter((b) => b.placeId === p.id && b.state === 'dispute').length}</td></tr>`;
      }).join('')}</tbody>
    </table></div>
    ${cur.gmv ? '' : '<p class="small muted">Щоб побачити статистику, заповніть демо-історію для кількох точок у <a href="business.html">панелі бізнесу</a>.</p>'}`;
}

// ---------- точки ----------

const PLACE_FILTERS = {
  queue: ['На перевірці', (pt) => inQueue(pt)],
  approved: ['Підключені', (pt) => pt.status === 'approved'],
  other: ['Чернетки й відхилені', (pt) => ['draft', 'changes', 'rejected'].includes(pt.status)],
  suspended: ['Призупинені', (pt) => pt.status === 'suspended'],
  all: ['Усі', () => true],
};

function viewPlaces() {
  const all = PLACES.map((p) => ({ p, pt: partnerOf(p.id) }));
  const list = all.filter(({ pt }) => PLACE_FILTERS[ui.places][1](pt));
  return `<h1>Точки</h1><p class="page-sub">Перевірка юрособи, документів і реквізитів, оферта, статус у каталозі й комісія</p>
    <div class="filters"><div class="seg" role="group" aria-label="Фільтр точок">
      ${Object.entries(PLACE_FILTERS).map(([k, [label, fn]]) => `<button data-action="place-filter" data-f="${k}" aria-pressed="${ui.places === k}">${label} · ${all.filter(({ pt }) => fn(pt)).length}</button>`).join('')}
    </div></div>
    <div class="table-wrap" tabindex="0" role="region" aria-label="Точки"><table class="t">
      <thead><tr><th>Точка</th><th>Юрособа</th><th>Статус</th><th>Що перевірити</th><th>Оновлено</th></tr></thead>
      <tbody>${list.length ? list.map(({ p, pt }) => {
        const todo = [pt.status === 'pending' && 'Нова заявка', pt.update === 'pending' && 'Зміни даних', pt.payout?.iban && !pt.payout.verified && 'Реквізити'].filter(Boolean);
        const last = pt.history.at(-1);
        return `<tr class="link-row" data-href="#/places/${p.id}"><td><a class="row-link" href="#/places/${p.id}">${esc(p.name)}</a><small>${esc(p.district)}, ${esc(p.address)}</small></td>
          <td>${pt.company ? `${ENTITY[pt.company.type]} ${esc(pt.company.name)}<small>${pt.company.type === 'fop' ? 'РНОКПП' : 'ЄДРПОУ'} ${esc(pt.company.code)}</small>` : '<span class="muted">не вказано</span>'}</td>
          <td>${statusPill(pt.status)}${pt.demo ? ' <span class="pill">демо</span>' : ''}</td>
          <td>${todo.length ? todo.map((x) => `<span class="pill warn">${x}</span>`).join(' ') : '—'}</td>
          <td>${last ? fmtTime(last.at) : '—'}</td></tr>`;
      }).join('') : '<tr><td colspan="5" class="muted">Немає точок у цьому списку.</td></tr>'}</tbody>
    </table></div>`;
}

const check = (ok, yes, no) => `<li class="${ok ? 'ok-text' : 'bad-text'}">${icon(ok ? 'checkCircle' : 'warn', 16)}${ok ? yes : no}</li>`;

function viewPlace(id) {
  const p = PLACES.find((x) => x.id === id);
  if (!p) return `<a class="back" href="#/places">${icon('chevL', 22)}Точки</a><p>Точку не знайдено.</p>`;
  const pt = partnerOf(id);
  const c = pt.company;
  const pay = pt.payout ?? {};
  const miss = missingSteps(pt);
  const s = statsFor(rangeOf(30), id);
  const isUpdate = pt.status === 'approved' && (pt.update === 'pending' || (pay.iban && !pay.verified));
  return `<a class="back" href="#/places">${icon('chevL', 22)}Точки</a>
    <div class="title-row"><h1>${esc(p.name)}</h1><div class="row">${statusPill(pt.status)}${pt.update === 'pending' ? '<span class="pill warn">Зміни на перевірці</span>' : ''}</div></div>
    <p class="page-sub">${esc(p.district)}, ${esc(p.address)} · ${esc(p.phone)} · ${p.cats.map((x) => catById(x).name).join(', ')} · ${p.boxes} ${plural(p.boxes, 'бокс', 'бокси', 'боксів')}
      · <a href="index.html#/place/${p.id}" target="_blank" rel="noopener">сторінка для клієнтів</a></p>
    <div class="grid-2" style="margin-top:8px">
      <section class="panel stack" aria-labelledby="h-co" style="gap:10px">
        <h2 id="h-co">Юридична особа</h2>
        ${c ? `<dl class="kv">
          <dt>Форма</dt><dd>${ENTITY[c.type]}${c.vat ? ', платник ПДВ' : ''}</dd>
          <dt>${c.type === 'fop' ? 'ПІБ' : 'Назва'}</dt><dd>${esc(c.name)}</dd>
          <dt>${c.type === 'fop' ? 'РНОКПП' : 'ЄДРПОУ'}</dt><dd>${esc(c.code)}</dd>
          ${c.type === 'tov' ? `<dt>Керівник</dt><dd>${esc(c.director ?? '')}${c.directorRole ? `, ${esc(c.directorRole)}` : ''}</dd>` : ''}
          <dt>Оподаткування</dt><dd>${TAX[c.type].find(([k]) => k === c.tax)?.[1] ?? '—'}</dd>
          <dt>Адреса</dt><dd>${esc(c.address || '—')}</dd>
          <dt>Контакти</dt><dd>${esc(c.email)} · ${esc(c.phone)}</dd>
        </dl>` : `<p class="muted" style="margin:0">${pt.demo ? 'Демо-точка: дані юрособи ще не заповнені.' : 'Дані ще не заповнені.'}</p>`}
        <h3>Автоматичні перевірки</h3>
        <ul class="checks">
          ${check(c && codeValid(c.type, c.code), 'Код має правильну контрольну суму', 'Код юрособи відсутній або некоректний')}
          ${check(DOCS.filter(([, , r]) => r).every(([k]) => pt.docs?.[k]), 'Обовʼязкові документи завантажено', 'Немає виписки чи витягу з ЄДР')}
          ${check(ibanValid(pay.iban), `IBAN коректний${pay.iban ? ` · ${esc(ibanBank(pay.iban))}` : ''}`, 'IBAN відсутній або некоректний')}
          ${check(c && pay.code === c.code, 'Код отримувача збігається з кодом юрособи', 'Код отримувача не збігається з кодом юрособи')}
          ${check(pt.offer?.version === OFFER.version, `Оферту ${OFFER.version} прийнято${pt.offer ? ` ${fmtTime(pt.offer.acceptedAt)} · ${esc(pt.offer.signer)}` : ''}`, `Оферту ${OFFER.version} не прийнято`)}
        </ul>
        <p class="fine">Перед схваленням звірте назву, код і керівника з Єдиним державним реєстром (usr.minjust.gov.ua) і документами нижче.</p>
      </section>
      <section class="panel stack" aria-labelledby="h-pay" style="gap:10px">
        <h2 id="h-pay">Документи й реквізити</h2>
        <ul class="doc-list plain">${DOCS.map(([k, name, req]) => `<li>${icon(pt.docs?.[k] ? 'checkCircle' : 'info', 18)}<span><b>${name}${req ? '' : ' (необовʼязково)'}</b>
          <small>${pt.docs?.[k] ? `${esc(pt.docs[k].name)} · ${Math.max(1, Math.round(pt.docs[k].size / 1024))} КБ · ${fmtTime(pt.docs[k].at)}` : 'не завантажено'}</small></span></li>`).join('')}</ul>
        <dl class="kv">
          <dt>IBAN</dt><dd>${pay.iban ? esc(formatIban(pay.iban)) : '—'}</dd>
          <dt>Отримувач</dt><dd>${esc(pay.holder || '—')}${pay.code ? ` · код ${esc(pay.code)}` : ''}</dd>
          <dt>Стан</dt><dd>${pay.iban ? (pay.verified ? '<span class="pill ok">Перевірено — виплати дозволені</span>' : '<span class="pill warn">Не перевірено — виплати призупинені</span>') : '—'}</dd>
        </dl>
        <form id="commission-form" class="inline-form" data-id="${p.id}">
          <label class="field"><span>Комісія для точки, % (порожньо — загальна ${pctText(store.get('admin.settings', {}).commission ?? PAYMENT.commission)})</span>
            <input name="pct" type="number" min="0" max="30" step="0.5" value="${pt.commission !== undefined ? +(pt.commission * 100).toFixed(1) : ''}"></label>
          <button class="btn" type="submit">Зберегти комісію</button>
        </form>
        <p class="small muted" style="margin:0">За 30 днів: ${s.orders} ${plural(s.orders, 'замовлення', 'замовлення', 'замовлень')}, оборот ${uah(s.gmv)}, комісія ${uah(s.fee)}.</p>
      </section>
    </div>
    <section class="panel stack" aria-labelledby="h-mod" style="gap:12px;margin-top:16px">
      <h2 id="h-mod">Рішення</h2>
      ${miss.length && !isUpdate && pt.status !== 'suspended' ? `<p class="notice warn" style="margin:0">Не заповнено: ${miss.join(', ').toLowerCase()}. Схвалити можна, лише коли все заповнено.</p>` : ''}
      <form id="moderate-form" class="stack" data-id="${p.id}" style="gap:10px">
        <label class="field"><span>Коментар для точки</span><textarea name="note" rows="2" maxlength="500" placeholder="Обовʼязково, якщо просите виправлення чи відхиляєте"></textarea></label>
        <div class="row">
          ${isUpdate ? `<button class="btn primary" type="submit" value="approve-update" ${miss.length ? 'disabled' : ''}>${icon('check', 18)}Підтвердити зміни й реквізити</button>
            <button class="btn" type="submit" value="reject-update">Повернути зміни на виправлення</button>` : ''}
          ${['pending', 'changes', 'draft', 'rejected'].includes(pt.status) ? `<button class="btn primary" type="submit" value="approve" ${miss.length ? 'disabled' : ''}>${icon('check', 18)}Схвалити й додати в каталог</button>
            <button class="btn" type="submit" value="changes">Потрібні виправлення</button>
            <button class="btn text-danger" type="submit" value="reject">Відхилити</button>` : ''}
          ${pt.status === 'approved' ? '<button class="btn text-danger" type="submit" value="suspend">Призупинити в каталозі</button>' : ''}
          ${pt.status === 'suspended' ? '<button class="btn primary" type="submit" value="restore">Відновити в каталозі</button>' : ''}
        </div>
      </form>
    </section>
    <h2 class="biz-h2">Історія</h2>
    ${pt.history.length ? `<ol class="history">${[...pt.history].reverse().map((h) => `<li><span class="small muted">${fmtTime(h.at)} · ${h.by === 'admin' ? 'CARCAR' : 'Точка'}</span>
      <span>${h.status ? statusPill(h.status) : ''} ${esc(h.note ?? '')}</span></li>`).join('')}</ol>` : '<p class="muted">Подій ще не було.</p>'}`;
}

function moderate(id, action, note) {
  const pt = partnerOf(id);
  const needNote = ['changes', 'reject', 'suspend', 'reject-update'].includes(action);
  if (needNote && !note) { toast('Напишіть коментар для точки'); return; }
  const status = { approve: 'approved', changes: 'changes', reject: 'rejected', suspend: 'suspended', restore: 'approved' }[action];
  const patch = { history: [...pt.history, { at: Date.now(), by: 'admin', status: status ?? pt.status, note: note || {
    approve: 'Заявку схвалено', restore: 'Точку відновлено в каталозі', 'approve-update': 'Зміни й реквізити підтверджено',
  }[action] }] };
  if (status) patch.status = status;
  if (action === 'approve' || action === 'approve-update') {
    Object.assign(patch, { update: null, payout: { ...pt.payout, verified: true }, approvedAt: Date.now() });
  }
  if (action === 'reject-update') patch.update = 'changes';
  savePartner(id, patch);
  route();
  toast({
    approve: 'Точку підключено — вона вже в каталозі', changes: 'Точка отримала запит на виправлення', reject: 'Заявку відхилено',
    suspend: 'Точку призупинено: клієнти її не бачать', restore: 'Точку відновлено в каталозі',
    'approve-update': 'Зміни підтверджено, виплати дозволені', 'reject-update': 'Зміни повернуто на виправлення',
  }[action]);
}

// ---------- відгуки ----------

const HIDE_REASONS = ['Образи чи нецензурна лексика', 'Персональні дані', 'Не стосується візиту', 'Реклама чи спам', 'Інше порушення правил'];
const REVIEW_FILTERS = {
  reported: ['Скарги', (r) => r.report?.status === 'open'],
  hidden: ['Приховані', (r) => r.hidden],
  all: ['Усі', () => true],
};

function viewReviews() {
  const list = reviews.filter(REVIEW_FILTERS[ui.reviews][1]).sort((a, b) => (b.report?.at ?? b.at) - (a.report?.at ?? a.at));
  return `<h1>Відгуки</h1><p class="page-sub">Скарги точок і модерація. Прихований відгук не видно клієнтам, і він не впливає на рейтинг.</p>
    <div class="filters"><div class="seg" role="group" aria-label="Фільтр відгуків">
      ${Object.entries(REVIEW_FILTERS).map(([k, [label, fn]]) => `<button data-action="review-filter" data-f="${k}" aria-pressed="${ui.reviews === k}">${label} · ${reviews.filter(fn).length}</button>`).join('')}
    </div></div>
    <div class="stack" style="gap:12px">
    ${list.length ? list.map((r) => `<article class="panel stack" style="gap:8px" aria-label="Відгук про ${esc(placeName(r.placeId))}">
      <div class="head"><div><b>${esc(placeName(r.placeId))}</b><small class="muted" style="display:block">${fmtDate(r.date)} · ${esc(r.services)}</small></div>${stars(r.stars)}</div>
      ${r.text ? `<p style="margin:0">${esc(r.text)}</p>` : '<p class="muted" style="margin:0">Без тексту, лише оцінка.</p>'}
      ${r.photos?.length ? `<div class="photos">${r.photos.map((src, i) => `<img src="${esc(src)}" alt="Фото клієнта ${i + 1}">`).join('')}</div>` : ''}
      ${r.reply ? `<p class="small" style="margin:0"><b>Відповідь точки:</b> ${esc(r.reply.text)}</p>` : ''}
      ${r.report ? `<p class="notice ${r.report.status === 'open' ? 'warn' : ''}" style="margin:0"><b>Скарга точки ${fmtTime(r.report.at)}</b>${esc(r.report.reason)}${r.report.status === 'rejected' ? ' — відхилено' : r.report.status === 'accepted' ? ' — прийнято' : ''}</p>` : ''}
      ${r.hidden ? `<div class="row"><span class="pill muted">Приховано: ${esc(r.hidden.reason)}</span><button class="btn" data-action="review-restore" data-id="${r.id}">Повернути відгук</button></div>`
        : `<form class="review-mod row" data-id="${r.id}">
          <label class="field"><span>Причина</span><select name="reason">${HIDE_REASONS.map((x) => `<option>${x}</option>`).join('')}</select></label>
          <button class="btn text-danger" type="submit" value="hide">Приховати</button>
          ${r.report?.status === 'open' ? '<button class="btn" type="submit" value="keep">Залишити відгук</button>' : ''}
        </form>`}
    </article>`).join('') : `<div class="empty-state">${icon('star', 32)}<h2>${ui.reviews === 'reported' ? 'Скарг немає' : 'Нічого не знайдено'}</h2><p>Точки можуть поскаржитися на відгук у своїй панелі.</p></div>`}
    </div>`;
}

// ---------- спори ----------

function viewDisputes() {
  const open = bookings.filter((b) => b.state === 'dispute').sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time));
  const done = bookings.filter((b) => b.resolution).sort((a, b) => b.resolution.at - a.resolution.at).slice(0, 20);
  return `<h1>Спори</h1><p class="page-sub">Гроші за замовленням заморожені, доки ви не ухвалите рішення. Повернення йде клієнту на баланс CARCAR.</p>
    <div class="stack" style="gap:12px">
    ${open.length ? open.map((b) => `<article class="panel stack" style="gap:10px" aria-label="Спір: ${esc(placeName(b.placeId))}">
      <div class="head"><div><b>${esc(placeName(b.placeId))}</b><small class="muted" style="display:block">${dayLabel(b.date, { day: 'numeric', month: 'long' })}, ${b.time} · ${esc(b.car)} · ${esc(b.clientName || 'клієнт')}</small></div>
        <b>${uah(price(b))}</b></div>
      <p class="small" style="margin:0">${esc(b.services.join(', '))}${b.bonus ? ` · з них бонус ${uah(b.bonus)}` : ''}</p>
      <p class="notice warn" style="margin:0"><b>Скарга клієнта</b>«${esc(b.disputeReason)}»</p>
      ${b.note || b.km ? `<p class="small muted" style="margin:0">Коментар точки: ${esc(b.note ?? '')}${b.km ? ` · пробіг ${b.km} км` : ''}</p>` : ''}
      ${b.photos?.length ? `<div class="photos">${b.photos.map((src, i) => `<img src="${esc(src)}" alt="Фото результату ${i + 1}">`).join('')}</div>` : '<p class="small muted" style="margin:0">Точка не додала фото результату.</p>'}
      <form class="dispute-form stack" data-id="${b.id}" style="gap:10px">
        <fieldset class="radio-row"><legend>Рішення</legend>
          <label><input type="radio" name="to" value="client" checked> Усе клієнту</label>
          <label><input type="radio" name="to" value="place"> Усе точці</label>
          <label><input type="radio" name="to" value="split"> Розділити</label></fieldset>
        <div class="form-grid">
          <label class="field"><span>Точці, ₴ (для «Розділити»)</span><input name="part" type="number" min="0" max="${price(b)}" step="1" value="${Math.round(price(b) / 2)}"></label>
          <label class="field"><span>Пояснення рішення</span><input name="note" maxlength="300" autocomplete="off" placeholder="Бачать обидві сторони"></label>
        </div>
        <button class="btn primary" type="submit" style="align-self:flex-start">Ухвалити рішення</button>
      </form>
    </article>`).join('') : `<div class="empty-state">${icon('scale', 32)}<h2>Відкритих спорів немає</h2><p>Клієнт може відкрити спір, поки гроші за замовленням заморожені.</p></div>`}
    </div>
    ${done.length ? `<h2 class="biz-h2">Вирішені</h2>
    <div class="table-wrap" tabindex="0" role="region" aria-label="Вирішені спори"><table class="t">
      <thead><tr><th>Дата рішення</th><th>Точка</th><th>Скарга</th><th class="num">Точці</th><th class="num">Клієнту</th></tr></thead>
      <tbody>${done.map((b) => `<tr><td>${fmtTime(b.resolution.at)}</td><td>${esc(placeName(b.placeId))}</td><td>${esc(b.disputeReason ?? '')}${b.resolution.note ? `<small>${esc(b.resolution.note)}</small>` : ''}</td>
        <td class="num">${uah(b.resolution.placePart)}</td><td class="num">${uah(b.state === 'refunded' ? b.refund ?? 0 : 0)}</td></tr>`).join('')}</tbody>
    </table></div>` : ''}`;
}

// ---------- комісії й виплати ----------

function viewCommission() {
  const base = store.get('admin.settings', {}).commission ?? PAYMENT.commission;
  const all = [...payouts].sort((a, b) => b.at - a.at);
  const custom = PLACES.filter((p) => partnerOf(p.id).commission !== undefined);
  return `<h1>Комісії й виплати</h1><p class="page-sub">Комісія утримується з суми, яку точка виводить. Для клієнтів комісії немає.</p>
    <section class="kpis" aria-label="Комісії">
      <div class="kpi hero"><span class="label">Утримано комісії всього</span><span class="value">${uah(all.reduce((a, x) => a + x.fee, 0))}</span>
        <span class="kpi-note">${all.length} ${plural(all.length, 'виплата', 'виплати', 'виплат')} на ${uah(all.reduce((a, x) => a + x.net, 0))}</span></div>
      <div class="kpi"><span class="label">Загальна ставка</span><span class="value">${pctText(base)}</span></div>
      <div class="kpi"><span class="label">Індивідуальні ставки</span><span class="value">${custom.length}</span></div>
    </section>
    <div class="grid-2" style="margin-top:16px">
      <section class="panel stack" aria-labelledby="h-base" style="gap:10px">
        <h2 id="h-base">Загальна ставка</h2>
        <form id="base-commission" class="inline-form">
          <label class="field"><span>Комісія, %</span><input name="pct" type="number" min="0" max="30" step="0.5" value="${+(base * 100).toFixed(1)}" required></label>
          <button class="btn primary" type="submit">Зберегти</button>
        </form>
        <p class="fine">Нова ставка застосовується до наступних виплат. Уже виведені суми не перераховуються. Оферта передбачає повідомлення точок про зміну умов щонайменше за 14 днів.</p>
      </section>
      <section class="panel" aria-labelledby="h-custom">
        <h2 id="h-custom">Індивідуальні ставки</h2>
        ${custom.length ? `<ul class="special-list">${custom.map((p) => `<li><span><b>${esc(p.name)}</b><small>${pctText(commissionFor(p.id))}</small></span><a class="btn" href="#/places/${p.id}">Змінити</a></li>`).join('')}</ul>`
          : '<p class="muted" style="margin:0">Усі точки платять загальну ставку. Індивідуальну можна задати на сторінці точки — наприклад, знижку на перші місяці.</p>'}
      </section>
    </div>
    <h2 class="biz-h2">Виплати точкам</h2>
    <div class="table-wrap" tabindex="0" role="region" aria-label="Виплати точкам"><table class="t">
      <thead><tr><th>Дата</th><th>Точка</th><th>Рахунок</th><th class="num">Сума</th><th class="num">Комісія</th><th class="num">Виплачено</th></tr></thead>
      <tbody>${all.length ? all.slice(0, 200).map((x) => `<tr><td>${fmtTime(x.at)}</td><td>${esc(placeName(x.placeId))}</td><td>${esc(x.iban ?? (x.demo ? 'демо' : '—'))}</td>
        <td class="num">${uah(x.gross)}</td><td class="num">${uah(x.fee)}</td><td class="num">${uah(x.net)}</td></tr>`).join('') : '<tr><td colspan="6" class="muted">Виплат ще не було.</td></tr>'}</tbody>
    </table></div>`;
}

// ---------- статистика застосунку ----------

// Анонімні події застосунку клієнта (див. track в app.js) і записи — за обраний період.
const events = () => store.get('analytics', []);
const evIn = (list, [from, to]) => {
  const a = parseDate(from).getTime();
  const z = parseDate(addDays(to, 1)).getTime();
  return list.filter((e) => e.at >= a && e.at < z);
};
const count = (list, t) => list.filter((e) => e.t === t).length;
const share = (a, b) => (b ? `${Math.round((a / b) * 100)}%` : '—');
const LEAD = [['до 2 год', 0, 2], ['2–24 год', 2, 24], ['1–3 дні', 24, 72], ['3–7 днів', 72, 168], ['понад тиждень', 168, Infinity]];
const WD_FULL = ['понеділок', 'вівторок', 'середа', 'четвер', 'пʼятниця', 'субота', 'неділя'];

function viewStats() {
  const n = ui.period;
  const range = rangeOf(n);
  const ev = evIn(events(), range);
  const prevEv = evIn(events(), rangeOf(n, 1));
  const app = bookings.filter((b) => isCarcar(b) && inRange(b, range));
  const paidN = count(ev, 'paid');
  const sessions = count(ev, 'session');
  const funnel = [['Переглянули точку', count(ev, 'view_place')], ['Відкрили запис', count(ev, 'open_book')], ['Перейшли до оплати', count(ev, 'open_pay')], ['Оплатили', paidN]];

  // Записи по днях: через застосунок і внесені точками в журнал.
  const days = [];
  for (let d = range[0]; d <= range[1]; d = addDays(d, 1)) days.push(d);
  const all = bookings.filter((b) => inRange(b, range) && b.state !== 'refunded');
  const byDay = days.map((d) => {
    const x = parseDate(d);
    return { label: dayLabel(d), short: `${x.getDate()}.${pad(x.getMonth() + 1)}`, values: [all.filter((b) => b.date === d && isCarcar(b)).length, all.filter((b) => b.date === d && !isCarcar(b)).length] };
  });
  charts = { 'ch-days': { title: 'Записи по днях', cats: byDay, series: ['Через застосунок', 'У журналі точок'], fmt: (v) => String(v) } };

  // Теплова карта: день тижня × година початку записів через застосунок.
  const hours = Array.from({ length: 15 }, (_, i) => 8 + i);
  const grid = WD_FULL.map((_, w) => hours.map((h) => app.filter((b) => (parseDate(b.date).getDay() + 6) % 7 === w && Math.floor(Number(b.time.slice(0, 2))) === h).length));
  const max = Math.max(1, ...grid.flat());
  const level = (v) => (v === 0 ? 0 : Math.min(5, Math.ceil((v / max) * 5)));

  // Як платять клієнти.
  const paidApp = app.filter((b) => b.state !== 'cancelled' || b.placeAmount);
  const pays = [
    { name: 'Лише карткою', value: paidApp.filter((b) => !b.bonus && !b.fromBalance && !b.covered).length },
    { name: 'З бонусом «Приведи друга»', value: paidApp.filter((b) => b.bonus).length },
    { name: 'З балансу CARCAR', value: paidApp.filter((b) => b.fromBalance).length },
    { name: 'За абонементом', value: paidApp.filter((b) => b.passUse?.kind === 'sub').length },
    { name: 'Сертифікатом', value: paidApp.filter((b) => b.passUse?.kind === 'cert').length },
    { name: 'Зі знижкою за годинами', value: paidApp.filter((b) => b.deal).length },
  ];
  const lead = LEAD.map(([name, a, z]) => ({ name, value: ev.filter((e) => e.t === 'paid' && e.leadH >= a && e.leadH < z).length }));

  // Пошук і фільтри.
  const searches = new Map();
  for (const e of ev.filter((x) => x.t === 'search')) {
    const s = searches.get(e.q) ?? { q: e.q, n: 0, empty: 0 };
    s.n++;
    if (!e.found) s.empty++;
    searches.set(e.q, s);
  }
  const topSearch = [...searches.values()].sort((a, b) => b.n - a.n).slice(0, 8);
  const FILTER_NAMES = { openNow: 'Відчинено зараз', blackout: 'Працює при відключеннях', favOnly: 'Обране', 'cat:wash': 'Мийка', 'cat:tires': 'Шиномонтаж', 'cat:service': 'СТО', 'cat:detailing': 'Детейлінг' };
  const filters = Object.entries(FILTER_NAMES).map(([k, name]) => ({ name, value: ev.filter((e) => e.t === 'filter' && e.name === k).length })).filter((x) => x.value).sort((a, b) => b.value - a.value);

  // Утримання: скільки клієнтів повернулися.
  const byClient = new Map();
  for (const b of bookings.filter((x) => isCarcar(x) && x.state === 'completed')) {
    const k = b.clientPhone?.replace(/\D/g, '').slice(-9) || b.car;
    byClient.set(k, [...(byClient.get(k) ?? []), b.date]);
  }
  const clients = [...byClient.values()];
  const repeat = clients.filter((d) => d.length > 1);
  const gaps = repeat.flatMap((d) => { const s = [...d].sort(); return s.slice(1).map((x, i) => (parseDate(x) - parseDate(s[i])) / 864e5); });

  // Функції застосунку.
  const wl = store.get('waitlist', []);
  const passesSold = PLACES.flatMap((p) => (store.peek('biz.passes', {})[p.id]?.sold ?? [])).filter((x) => x.soldAt >= parseDate(range[0]).getTime());
  const intakes = bookings.filter((b) => b.intake && inRange(b, range));
  const reqs = store.get('requests', []).filter((r) => r.at >= parseDate(range[0]).getTime());
  const camps = store.get('biz.campaigns', []).filter((c) => c.at >= parseDate(range[0]).getTime());
  const vis = visibleReviews(reviews).filter((r) => r.at >= parseDate(range[0]).getTime());
  const features = [
    ['Карта', `${count(ev, 'map_open')} відкриттів · ${count(ev, 'map_pin')} натискань на точки`],
    ['Гарячі вікна й щасливі години', `${count(ev, 'hot_click')} переходів з головної · ${app.filter((b) => b.deal).length} записів зі знижкою · знижок на ${uah(app.filter((b) => b.deal).reduce((a, b) => a + ((b.listTotal ?? b.total) - b.total), 0))}`],
    ['Абонементи й сертифікати', `${passesSold.length} продано на ${uah(passesSold.reduce((a, x) => a + x.price, 0))}, з них у застосунку ${passesSold.filter((x) => x.source === 'carcar').length}`],
    ['Лист очікування', `${count(ev, 'waitlist_join')} заявок · сповіщено ${wl.filter((w) => w.status === 'notified').length} · чекають ${wl.filter((w) => w.status === 'active').length}`],
    ['Жива черга', `${count(ev, 'queue_join')} клієнтів стали в чергу з телефона`],
    ['Акт приймання', `${intakes.length} актів · підтверджено ${intakes.filter((b) => b.intake.ack?.ok).length} · із зауваженнями ${intakes.filter((b) => b.intake.ack && !b.intake.ack.ok).length}`],
    ['Запити «не знайшов послугу»', `${reqs.length} запитів · відповіли ${reqs.filter((r) => r.messages.some((m) => m.from === 'biz')).length} · додано послуг ${reqs.filter((r) => r.service).length}`],
    ['Розсилки точок', `${camps.length} розсилок · ${camps.reduce((a, c) => a + c.count, 0)} отримувачів`],
    ['Відгуки', `${vis.length} нових · середня оцінка ${vis.length ? rating(vis.reduce((a, r) => a + r.stars, 0) / vis.length) : '—'} · з відповіддю точки ${share(vis.filter((r) => r.reply).length, vis.length)}`],
  ];

  const geo = (key) => {
    const m = new Map();
    for (const b of app) {
      const p = PLACES.find((x) => x.id === b.placeId);
      if (!p) continue;
      const k = key(p);
      m.set(k, (m.get(k) ?? 0) + 1);
    }
    return [...m].map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value);
  };

  const demoEv = events().some((e) => e.demo);
  return `<h1>Статистика застосунку</h1><p class="page-sub">Як клієнти користуються CARCAR: відвідування, воронка запису, оплата, пошук, функції й повернення. Події анонімні — без імен і телефонів.</p>
    <div class="filters">
      <div class="seg" role="group" aria-label="Період">${[7, 30, 90].map((d) => `<button data-action="period" data-n="${d}" aria-pressed="${d === n}">${d} ${daysWord(d)}</button>`).join('')}</div>
      <span class="small muted">${fmtDate(range[0])} — ${fmtDate(range[1])}</span>
      <span class="spacer"></span>
      ${demoEv ? '<button class="btn" data-action="stats-demo-clear">Очистити демо-активність</button>' : ''}
      <button class="btn" data-action="stats-demo">Згенерувати демо-активність</button>
    </div>
    ${demoEv ? '<p class="small muted">Частину подій згенеровано для демонстрації на основі записів у системі.</p>' : ''}
    <section class="kpis" aria-label="Показники застосунку">
      <div class="kpi hero"><span class="label">Сеанси</span><span class="value">${sessions}</span>${delta(sessions, count(prevEv, 'session'))}<span class="kpi-note">переглядів точок ${count(ev, 'view_place')}</span></div>
      <div class="kpi"><span class="label">Оплачених записів</span><span class="value">${paidN}</span>${delta(paidN, count(prevEv, 'paid'))}</div>
      <div class="kpi"><span class="label">Конверсія сеансу в запис</span><span class="value">${share(paidN, sessions)}</span></div>
      <div class="kpi"><span class="label">Повертаються</span><span class="value">${share(repeat.length, clients.length)}</span><span class="kpi-note">${repeat.length} з ${clients.length} клієнтів · ${gaps.length ? `між візитами ≈ ${Math.round(gaps.reduce((a, x) => a + x, 0) / gaps.length)} ${daysWord(Math.round(gaps.reduce((a, x) => a + x, 0) / gaps.length))}` : ''}</span></div>
      <div class="kpi"><span class="label">Скасовано клієнтами</span><span class="value">${app.filter((b) => b.state === 'cancelled').length}</span><span class="kpi-note">вчасно ${app.filter((b) => b.state === 'cancelled' && !b.placeAmount).length} · пізно ${app.filter((b) => b.state === 'cancelled' && b.placeAmount).length}</span></div>
      <div class="kpi"><span class="label">Неявки</span><span class="value">${share(app.filter((b) => b.state === 'noshow').length, app.length)}</span></div>
    </section>
    <div class="grid-2" style="margin-top:16px">
      <section class="panel" aria-labelledby="h-funnel">
        <h2 id="h-funnel">Воронка запису</h2><p class="sub">Скільки людей дійшло до кожного кроку</p>
        <ol class="funnel">${funnel.map(([name, v], i) => `<li><span class="f-name">${name}</span>
          <span class="f-track"><span class="f-fill" style="width:${funnel[0][1] ? Math.max(2, (v / funnel[0][1]) * 100) : 0}%"></span></span>
          <span class="f-val"><b>${v}</b>${i ? `<small>${share(v, funnel[i - 1][1])} з попереднього</small>` : ''}</span></li>`).join('')}</ol>
        ${funnel[0][1] ? `<p class="small muted" style="margin:8px 0 0">Найбільше губимо між «${funnel.slice(1).map(([name, v], i) => [name, v / Math.max(1, funnel[i][1]), funnel[i][0]]).sort((a, b) => a[1] - b[1])[0][2]}» і наступним кроком.</p>` : ''}
      </section>
      <section class="panel" aria-labelledby="h-days">
        <h2 id="h-days">Записи по днях</h2>
        ${legend(['Через застосунок', 'У журналі точок'])}
        <div class="chart" id="ch-days"></div>
        ${tableView(['День', 'Через застосунок', 'У журналі'], byDay.map((x) => [x.label, String(x.values[0]), String(x.values[1])]))}
      </section>
    </div>
    <section class="panel" aria-labelledby="h-heat" style="margin-top:16px">
      <h2 id="h-heat">Коли записуються</h2><p class="sub">Записи через застосунок за днем тижня й годиною початку — темніше означає більше</p>
      <div class="heat" role="table" tabindex="0" aria-label="Записи за днем тижня й годиною">
        <div class="heat-row" role="row"><span role="columnheader"><span class="sr-only">День</span></span>${hours.map((h) => `<span class="heat-h" role="columnheader">${h}</span>`).join('')}</div>
        ${grid.map((row, w) => `<div class="heat-row" role="row"><span class="heat-d" role="rowheader">${WEEKDAYS[w]}</span>
          ${row.map((v, i) => `<span class="heat-c l${level(v)}" role="cell" data-tip="${esc(JSON.stringify({ t: `${WD_FULL[w]}, ${pad(hours[i])}:00–${pad(hours[i] + 1)}:00`, r: [['s1', String(v), 'записів']] }))}" tabindex="-1"><span class="sr-only">${v}</span></span>`).join('')}</div>`).join('')}
      </div>
      <div class="heat-legend" aria-hidden="true"><span>менше</span>${[0, 1, 2, 3, 4, 5].map((l) => `<i class="heat-c l${l}"></i>`).join('')}<span>більше</span></div>
    </section>
    <div class="grid-3" style="margin-top:16px">
      <section class="panel" aria-labelledby="h-pay"><h2 id="h-pay">Як платять</h2><p class="sub">Записів через застосунок</p>${hbars(pays, (v) => String(v))}</section>
      <section class="panel" aria-labelledby="h-lead"><h2 id="h-lead">За скільки записуються</h2><p class="sub">Від оплати до візиту</p>${hbars(lead, (v) => String(v))}</section>
      <section class="panel" aria-labelledby="h-geo"><h2 id="h-geo">Райони</h2><p class="sub">Записи через застосунок</p>${geo((p) => p.district).length ? hbars(geo((p) => p.district), (v) => String(v)) : '<p class="muted" style="margin:0">Немає записів.</p>'}</section>
      <section class="panel" aria-labelledby="h-cat2"><h2 id="h-cat2">Категорії</h2><p class="sub">Записи через застосунок</p>${geo((p) => catById(p.cats[0]).name).length ? hbars(geo((p) => catById(p.cats[0]).name), (v) => String(v)) : '<p class="muted" style="margin:0">Немає записів.</p>'}</section>
      <section class="panel" aria-labelledby="h-search"><h2 id="h-search">Що шукають</h2><p class="sub">Запити в пошуку; без результатів — що варто додати</p>
        ${topSearch.length ? `<ul class="special-list">${topSearch.map((x) => `<li><span><b>«${esc(x.q)}»</b><small>${x.n} ${plural(x.n, 'раз', 'рази', 'разів')}${x.empty ? ` · без результатів ${x.empty}` : ''}</small></span></li>`).join('')}</ul>` : '<p class="muted" style="margin:0">Пошукових запитів немає.</p>'}
      </section>
      <section class="panel" aria-labelledby="h-filt"><h2 id="h-filt">Фільтри</h2><p class="sub">Скільки разів увімкнули</p>${filters.length ? hbars(filters, (v) => String(v)) : '<p class="muted" style="margin:0">Фільтрами не користувалися.</p>'}</section>
    </div>
    <h2 class="biz-h2">Функції застосунку</h2>
    <div class="table-wrap" tabindex="0" role="region" aria-label="Використання функцій"><table class="t">
      <thead><tr><th>Функція</th><th>За період</th></tr></thead>
      <tbody>${features.map(([a, b]) => `<tr><td><b>${a}</b></td><td>${b}</td></tr>`).join('')}</tbody>
    </table></div>`;
}

// Демо-активність: події, що могли б передувати записам через застосунок за 90 днів, плюс ті, хто не дійшов до оплати.
function statsDemo() {
  const rnd = (() => { let s = 20261004; return () => { s = (s * 1103515245 + 12345) % 2147483648; return s / 2147483648; }; })();
  const out = events().filter((e) => !e.demo);
  const since = Date.now() - 90 * 864e5;
  const app = bookings.filter((b) => isCarcar(b) && b.source === 'demo');
  const ev = (t, at, data = {}) => out.push({ t, at: Math.round(at), demo: true, ...data });
  const words = ['мийка', 'шиномонтаж', 'полірування', 'кераміка', 'хімчистка', 'перевзування', 'розвал', 'кондиціонер', 'мийка двигуна', 'оболонь', 'троєщина', 'антидощ', 'фари'];
  for (const b of app) {
    const start = bookingStart(b).getTime();
    const leadH = [1, 3, 8, 20, 40, 70, 120, 200][Math.floor(rnd() * 8)];
    const at = Math.max(since, start - leadH * HOUR);
    ev('session', at - 600000, { view: rnd() < 0.3 ? 'map' : 'list' });
    ev('view_place', at - 420000, { placeId: b.placeId });
    ev('open_book', at - 300000, { placeId: b.placeId });
    ev('open_pay', at - 60000, { placeId: b.placeId });
    ev('paid', at, { placeId: b.placeId, amount: b.total, deal: !!b.deal, leadH });
  }
  // Ті, хто подивився й пішов: більше переглядів, ніж записів.
  const extra = app.length * 4;
  for (let i = 0; i < extra; i++) {
    const at = since + rnd() * (Date.now() - since);
    const p = PLACES[Math.floor(rnd() * PLACES.length)];
    ev('session', at - 300000, { view: rnd() < 0.3 ? 'map' : 'list' });
    if (rnd() < 0.8) ev('view_place', at - 200000, { placeId: p.id });
    if (rnd() < 0.25) ev('open_book', at - 100000, { placeId: p.id });
    if (rnd() < 0.07) ev('open_pay', at, { placeId: p.id });
    if (rnd() < 0.35) { const q = words[Math.floor(rnd() * words.length)]; ev('search', at - 250000, { q, found: /антидощ|фари|кондиціонер/.test(q) && rnd() < 0.7 ? 0 : 1 + Math.floor(rnd() * 4) }); }
    if (rnd() < 0.2) ev('filter', at - 240000, { name: ['openNow', 'blackout', 'cat:wash', 'cat:tires', 'cat:detailing', 'favOnly'][Math.floor(rnd() * 6)] });
    if (rnd() < 0.15) { ev('map_open', at - 230000); ev('map_pin', at - 220000, { placeId: p.id }); }
    if (rnd() < 0.05) ev('hot_click', at - 210000, { placeId: p.id });
    if (rnd() < 0.02) ev('queue_join', at, { placeId: p.id });
    if (rnd() < 0.015) ev('waitlist_join', at, { placeId: p.id });
  }
  out.sort((a, b) => a.at - b.at);
  store.set('analytics', out.slice(-20000));
  return app.length;
}

// ---------- роутер і події ----------

const NAV = [
  ['', 'Огляд', 'chart'],
  ['stats', 'Статистика застосунку', 'users'],
  ['places', 'Точки', 'shield'],
  ['reviews', 'Відгуки', 'star'],
  ['disputes', 'Спори', 'scale'],
  ['commission', 'Комісії й виплати', 'cash'],
];

function route() {
  hideTip();
  charts = {};
  const [, page = '', arg] = location.hash.replace(/^#/, '').split('/');
  const q = queues();
  const count = { places: q.places, reviews: q.reviews, disputes: q.disputes };
  $('#nav').innerHTML = NAV.map(([id, label, ic]) => `<a href="#/${id}" ${page === id ? 'aria-current="page"' : ''}>${icon(ic, 20)}${label}
    ${count[id] ? `<span class="count" aria-label="чекають рішення: ${count[id]}">${count[id]}</span>` : ''}</a>`).join('');
  const view = $('#view');
  if (page === '') view.innerHTML = viewOverview();
  else if (page === 'places') view.innerHTML = arg ? viewPlace(arg) : viewPlaces();
  else if (page === 'reviews') view.innerHTML = viewReviews();
  else if (page === 'disputes') view.innerHTML = viewDisputes();
  else if (page === 'commission') view.innerHTML = viewCommission();
  else if (page === 'stats') view.innerHTML = viewStats();
  else view.innerHTML = '<p>Сторінку не знайдено.</p>';
  mountCharts();
}

function rerender() {
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
  if (action === 'period') { ui.period = Number(el.dataset.n); rerender(); }
  else if (action === 'stats-demo') {
    const n = statsDemo();
    rerender();
    toast(n ? `Згенеровано демо-активність для ${n} записів` : 'Спершу заповніть демо-історію хоча б для однієї точки в панелі бізнесу');
  } else if (action === 'stats-demo-clear') {
    store.set('analytics', events().filter((e) => !e.demo));
    rerender();
    toast('Демо-активність очищено');
  }
  else if (action === 'place-filter') { ui.places = el.dataset.f; rerender(); }
  else if (action === 'review-filter') { ui.reviews = el.dataset.f; rerender(); }
  else if (action === 'review-restore') {
    delete reviews.find((r) => r.id === id).hidden;
    save();
    rerender();
    toast('Відгук знову видно клієнтам');
  }
});

document.addEventListener('keydown', (e) => {
  if ((e.key === 'Enter' || e.key === ' ') && e.target.matches('tr.link-row[data-href]')) location.hash = e.target.dataset.href;
});

document.addEventListener('submit', (e) => {
  const f = e.target;
  e.preventDefault();
  const d = new FormData(f);
  if (f.id === 'moderate-form') moderate(f.dataset.id, e.submitter?.value, d.get('note').trim());
  else if (f.id === 'commission-form') {
    const v = d.get('pct');
    savePartner(f.dataset.id, { commission: v === '' ? undefined : Math.max(0, Number(v)) / 100 });
    rerender();
    toast(v === '' ? 'Точка платить загальну ставку' : `Комісію для точки встановлено: ${v}%`);
  } else if (f.id === 'base-commission') {
    store.set('admin.settings', { ...store.get('admin.settings', {}), commission: Math.max(0, Number(d.get('pct'))) / 100 });
    rerender();
    toast(`Загальну комісію встановлено: ${d.get('pct')}%`);
  } else if (f.matches('.review-mod')) {
    const r = reviews.find((x) => x.id === f.dataset.id);
    if (e.submitter?.value === 'keep') {
      r.report = { ...r.report, status: 'rejected' };
      toast('Скаргу відхилено, відгук залишається');
    } else {
      r.hidden = { reason: d.get('reason'), at: Date.now() };
      if (r.report) r.report = { ...r.report, status: 'accepted' };
      toast('Відгук приховано');
    }
    save();
    rerender();
  } else if (f.matches('.dispute-form')) {
    const b = bookings.find((x) => x.id === f.dataset.id);
    const to = d.get('to');
    const part = to === 'client' ? 0 : to === 'place' ? price(b) : Number(d.get('part'));
    if (to === 'split' && !(part > 0 && part < price(b))) { toast(`Сума точці має бути від 1 до ${price(b) - 1} ₴`); return; }
    resolveDispute(b, part, d.get('note').trim());
    save();
    rerender();
    toast(to === 'client' ? 'Гроші повернено клієнту на баланс' : to === 'place' ? 'Гроші передано точці' : `Точці ${uah(part)}, решту повернено клієнту`);
  }
});

// Застосунок чи панель в іншій вкладці змінили дані — перечитуємо.
window.addEventListener('storage', (e) => {
  if (!e.key?.startsWith('carcar.')) return;
  load();
  rerender();
});

$('#to-biz').innerHTML = `${icon('chevL', 18)}Панель для бізнесу`;
$('#admin-badge').innerHTML = `${icon('shield', 18)}Демо-доступ модератора: у робочій версії — лише для співробітників CARCAR із двофакторним входом`;
window.addEventListener('hashchange', () => { route(); window.scrollTo(0, 0); });
route();
