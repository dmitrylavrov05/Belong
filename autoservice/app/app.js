import { CITY, CATEGORIES, CAR_CLASSES, PLACES } from './data.js';

// ---------- сховище (лише на цьому пристрої) ----------

const store = {
  get(key, fallback) {
    try {
      const raw = localStorage.getItem(`autozapis.${key}`);
      return raw ? JSON.parse(raw) : fallback;
    } catch {
      return fallback;
    }
  },
  set(key, value) {
    try {
      localStorage.setItem(`autozapis.${key}`, JSON.stringify(value));
    } catch {
      // Приватний режим або переповнення: працюємо без збереження.
    }
  },
};

let cars = store.get('cars', []);
let bookings = store.get('bookings', []);
let favs = new Set(store.get('favs', []));

const ui = { cat: 'all', q: '', sort: 'rating', openNow: false, favOnly: false, cls: store.get('cls', 0) };
let draft = null; // чернетка запису: { placeId, services: Set, date, time, carId }

// ---------- утиліти ----------

const $ = (sel, root = document) => root.querySelector(sel);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const uah = (n) => `${n.toLocaleString('uk-UA')} ₴`;
const pad = (n) => String(n).padStart(2, '0');
const hhmm = (min) => `${pad(Math.floor(min / 60))}:${pad(min % 60)}`;
const toMin = (t) => { const [h, m] = t.split(':').map(Number); return h * 60 + m; };
const isoDate = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const parseDate = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
const uid = () => Math.random().toString(36).slice(2, 10);
const placeById = (id) => PLACES.find((p) => p.id === id);
const plural = (n, one, few, many) => {
  const m10 = n % 10, m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
  return many;
};
const duration = (min) => (min < 60 ? `${min} хв` : `${Math.floor(min / 60)} год${min % 60 ? ` ${min % 60} хв` : ''}`);
const dayLabel = (s, opts = { weekday: 'short', day: 'numeric', month: 'long' }) =>
  parseDate(s).toLocaleDateString('uk-UA', opts);

function hash(str) {
  let h = 2166136261;
  for (const ch of str) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return h >>> 0;
}

function openRange(place) {
  return place.hours ? [place.hours[0] * 60, place.hours[1] * 60] : [0, 24 * 60];
}

function isOpenNow(place, now = new Date()) {
  if (!place.hours) return true;
  const [o, c] = openRange(place);
  const m = now.getHours() * 60 + now.getMinutes();
  return m >= o && m < c;
}

const hoursText = (place) => (place.hours ? `${hhmm(place.hours[0] * 60)}–${hhmm(place.hours[1] * 60)}` : 'Цілодобово');
const bookingStart = (b) => { const d = parseDate(b.date); d.setMinutes(toMin(b.time)); return d; };
const bookingState = (b) => (b.status === 'cancelled' ? 'cancelled' : bookingStart(b) < new Date() ? 'past' : 'upcoming');

function minPrice(place, cat, cls) {
  const list = cat === 'all' ? place.services : place.services.filter((s) => serviceCat(s) === cat);
  return Math.min(...list.map((s) => s.price[cls]));
}

// Категорія послуги за каталогом, з якого її взято.
const WASH_IDS = ['express', 'complex', 'inside', 'wax', 'engine', 'dry'];
const TIRE_IDS = ['change', 'balance', 'repair', 'storage', 'rolling'];
const serviceCat = (s) => (WASH_IDS.includes(s.id) ? 'wash' : TIRE_IDS.includes(s.id) ? 'tires' : 'service');

// Вільні вікна: крок 30 хвилин, частина вікон зайнята (стабільно для дня й точки),
// плюс власні записи користувача в цій точці.
function slotsFor(place, date, minutes) {
  const [open, close] = openRange(place);
  const now = new Date();
  const today = date === isoDate(now);
  const nowMin = now.getHours() * 60 + now.getMinutes();
  const mine = bookings
    .filter((b) => b.placeId === place.id && b.date === date && b.status !== 'cancelled')
    .map((b) => [toMin(b.time), toMin(b.time) + b.minutes]);
  const slots = [];
  for (let t = open; t + minutes <= close; t += 30) {
    const busy =
      (today && t < nowMin + 30) ||
      hash(`${place.id}|${date}|${t}`) % 10 < 3 ||
      mine.some(([s, e]) => t < e && t + minutes > s);
    slots.push({ time: hhmm(t), busy });
  }
  return slots;
}

function nextDays(n = 7) {
  const d = new Date();
  return Array.from({ length: n }, (_, i) => isoDate(new Date(d.getFullYear(), d.getMonth(), d.getDate() + i)));
}

function toast(text) {
  const el = $('#toast');
  el.textContent = text;
  el.classList.add('show');
  clearTimeout(toast.t);
  toast.t = setTimeout(() => el.classList.remove('show'), 2600);
}

function carLabel(car) {
  return `${car.make} ${car.model}${car.plate ? ` · ${car.plate}` : ''}`;
}

// ---------- екрани ----------

function seasonBanner() {
  const m = new Date().getMonth();
  const winter = m === 9 || m === 10;
  const summer = m === 2 || m === 3;
  if (!winter && !summer) return '';
  return `<a class="banner" href="#/" data-action="cat" data-cat="tires" style="text-decoration:none">
    <span class="emoji" aria-hidden="true">${winter ? '❄️' : '☀️'}</span>
    <span><b>Час ${winter ? 'на зимову' : 'на літню'} гуму</b>
    <span class="small muted">Запишіться на перевзування заздалегідь, поки немає черг</span></span>
  </a>`;
}

function filteredPlaces() {
  const q = ui.q.trim().toLowerCase();
  let list = PLACES.filter((p) => {
    if (ui.cat !== 'all' && !p.cats.includes(ui.cat)) return false;
    if (ui.openNow && !isOpenNow(p)) return false;
    if (ui.favOnly && !favs.has(p.id)) return false;
    if (q) {
      const hay = [p.name, p.address, p.district, ...p.tags, ...p.services.map((s) => s.name)].join(' ').toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
  const by = {
    rating: (a, b) => b.rating - a.rating,
    price: (a, b) => minPrice(a, ui.cat, ui.cls) - minPrice(b, ui.cat, ui.cls),
    reviews: (a, b) => b.reviews - a.reviews,
  }[ui.sort];
  return list.sort(by);
}

function placeCard(p) {
  const open = isOpenNow(p);
  const cats = p.cats.map((c) => CATEGORIES.find((x) => x.id === c)).map((c) => `${c.icon} ${c.name}`).join(' · ');
  return `<article class="card">
    <div class="place-head">
      <a class="place" href="#/place/${p.id}">
        <h2>${esc(p.name)}</h2>
        <div class="meta"><span>${cats}</span></div>
      </a>
      <button class="fav" data-action="fav" data-id="${p.id}" aria-pressed="${favs.has(p.id)}"
        aria-label="${favs.has(p.id) ? 'Прибрати з обраного' : 'В обране'}: ${esc(p.name)}">${favs.has(p.id) ? '❤️' : '🤍'}</button>
    </div>
    <a class="place" href="#/place/${p.id}" tabindex="-1">
      <div class="meta">
        <span class="rating">★ ${p.rating.toFixed(1)}</span>
        <span>${p.reviews} ${plural(p.reviews, 'відгук', 'відгуки', 'відгуків')}</span>
        <span>${esc(p.district)}, ${esc(p.address)}</span>
      </div>
      <div class="badges">
        <span class="badge ${open ? 'open' : 'closed'}">${open ? 'Відчинено' : 'Зачинено'} · ${hoursText(p)}</span>
        <span class="badge">від ${uah(minPrice(p, ui.cat, ui.cls))}</span>
      </div>
    </a>
  </article>`;
}

function renderList() {
  const list = filteredPlaces();
  $('#list').innerHTML = list.length
    ? list.map(placeCard).join('')
    : `<div class="empty"><div class="emoji" aria-hidden="true">🔍</div><p>Нічого не знайшлося. Спробуйте змінити фільтри.</p></div>`;
  $('#count').textContent = `${list.length} ${plural(list.length, 'місце', 'місця', 'місць')}`;
}

function viewCatalog() {
  const chip = (label, attrs, on) => `<button class="chip" ${attrs} aria-pressed="${on}">${label}</button>`;
  return `${seasonBanner()}
    <h1>Мийки, шиномонтаж і СТО</h1>
    <input id="q" class="search" type="search" placeholder="Назва, адреса або послуга" aria-label="Пошук" value="${esc(ui.q)}">
    <div class="chips" role="group" aria-label="Категорія">
      ${chip('Усі', 'data-action="cat" data-cat="all"', ui.cat === 'all')}
      ${CATEGORIES.map((c) => chip(`${c.icon} ${c.name}`, `data-action="cat" data-cat="${c.id}"`, ui.cat === c.id)).join('')}
      ${chip('Відчинено зараз', 'data-action="toggle" data-key="openNow"', ui.openNow)}
      ${chip('❤️ Обране', 'data-action="toggle" data-key="favOnly"', ui.favOnly)}
    </div>
    <div class="toolbar">
      <span class="muted small" id="count"></span>
      <span class="row">
        <select id="cls" aria-label="Клас авто для цін">
          ${CAR_CLASSES.map((c, i) => `<option value="${i}" ${i === ui.cls ? 'selected' : ''}>${c}</option>`).join('')}
        </select>
        <select id="sort" aria-label="Сортування">
          <option value="rating" ${ui.sort === 'rating' ? 'selected' : ''}>За рейтингом</option>
          <option value="price" ${ui.sort === 'price' ? 'selected' : ''}>Спочатку дешевші</option>
          <option value="reviews" ${ui.sort === 'reviews' ? 'selected' : ''}>За відгуками</option>
        </select>
      </span>
    </div>
    <div id="list" class="stack"></div>
    <p class="note">Демо-дані: назви, номери будинків і телефони вигадані. Список місць задається у файлі data.js.</p>`;
}

function viewPlace(id) {
  const p = placeById(id);
  if (!p) return viewNotFound();
  const open = isOpenNow(p);
  const maps = `${CITY.mapsSearch}${encodeURIComponent(`${CITY.name}, ${p.address}`)}`;
  const groups = CATEGORIES.map((c) => [c, p.services.filter((s) => serviceCat(s) === c.id)]).filter(([, s]) => s.length);
  return `<a class="back" href="#/">← Усі місця</a>
    <div class="place-head">
      <h1>${esc(p.name)}</h1>
      <button class="fav" data-action="fav" data-id="${p.id}" aria-pressed="${favs.has(p.id)}"
        aria-label="${favs.has(p.id) ? 'Прибрати з обраного' : 'В обране'}">${favs.has(p.id) ? '❤️' : '🤍'}</button>
    </div>
    <div class="meta">
      <span class="rating">★ ${p.rating.toFixed(1)}</span>
      <span>${p.reviews} ${plural(p.reviews, 'відгук', 'відгуки', 'відгуків')}</span>
      <span>${p.boxes} ${plural(p.boxes, 'бокс', 'бокси', 'боксів')}</span>
    </div>
    <div class="badges">
      <span class="badge ${open ? 'open' : 'closed'}">${open ? 'Відчинено' : 'Зачинено'} · ${hoursText(p)}</span>
      ${p.tags.map((t) => `<span class="badge">${esc(t)}</span>`).join('')}
    </div>
    <div class="card stack" style="margin-top:14px">
      <div>📍 ${esc(p.district)}, ${esc(p.address)}</div>
      <div class="row">
        <a class="btn" href="tel:${p.phone.replace(/[^+\d]/g, '')}">📞 Зателефонувати</a>
        <a class="btn" href="${maps}" target="_blank" rel="noopener">🗺️ Маршрут</a>
      </div>
    </div>
    <h2>Послуги та ціни</h2>
    <p class="muted small">Ціни для класу «${CAR_CLASSES[ui.cls]}». Остаточну вартість майстер підтвердить на місці.</p>
    ${groups.map(([c, list]) => `
      <h3 class="small muted" style="margin:16px 0 8px">${c.icon} ${c.name}</h3>
      <div class="card" style="padding:0">
        ${list.map((s, i) => `<div class="service" style="cursor:default;${i ? 'border-top:1px solid var(--line)' : ''}">
          <span class="name">${esc(s.name)}<br><span class="small muted">${duration(s.min)}</span></span>
          <span class="price">${uah(s.price[ui.cls])}</span>
        </div>`).join('')}
      </div>`).join('')}
    <div class="summary"><a class="btn primary block" href="#/book/${p.id}">Записатися онлайн</a></div>`;
}

function draftClass() {
  const car = cars.find((c) => c.id === draft.carId);
  return car ? car.cls : ui.cls;
}

function viewBook(id) {
  const p = placeById(id);
  if (!p) return viewNotFound();
  if (!draft || draft.placeId !== id) {
    draft = { placeId: id, services: new Set(), date: nextDays()[0], time: null, carId: cars[0]?.id ?? null };
  }
  return `<a class="back" href="#/place/${p.id}">← ${esc(p.name)}</a>
    <h1>Запис</h1>
    <div id="book"></div>`;
}

function renderBook() {
  const p = placeById(draft.placeId);
  const cls = draftClass();
  const chosen = p.services.filter((s) => draft.services.has(s.id));
  const minutes = chosen.reduce((a, s) => a + s.min, 0);
  const total = chosen.reduce((a, s) => a + s.price[cls], 0);
  const slots = minutes ? slotsFor(p, draft.date, minutes) : [];
  if (draft.time && !slots.some((s) => s.time === draft.time && !s.busy)) draft.time = null;
  const free = slots.filter((s) => !s.busy);

  $('#book').innerHTML = `
    <h2>1. Авто</h2>
    ${cars.length
      ? `<label class="field"><span>Ваше авто</span><select id="car">
          ${cars.map((c) => `<option value="${c.id}" ${c.id === draft.carId ? 'selected' : ''}>${esc(carLabel(c))}</option>`).join('')}
        </select></label>`
      : `<label class="field"><span>Клас авто</span><select id="bookcls">
          ${CAR_CLASSES.map((c, i) => `<option value="${i}" ${i === cls ? 'selected' : ''}>${c}</option>`).join('')}
        </select></label>
        <p class="small muted">Додайте авто в <a href="#/garage">гараж</a>, щоб не обирати клас щоразу.</p>`}

    <h2>2. Послуги</h2>
    <div class="card" style="padding:0">
      ${p.services.map((s, i) => `<label class="service" style="${i ? 'border-top:1px solid var(--line)' : ''}">
        <input type="checkbox" data-action="svc" value="${s.id}" ${draft.services.has(s.id) ? 'checked' : ''}>
        <span class="name">${esc(s.name)}<br><span class="small muted">${duration(s.min)}</span></span>
        <span class="price">${uah(s.price[cls])}</span>
      </label>`).join('')}
    </div>

    <h2>3. День і час</h2>
    <div class="days" role="group" aria-label="День">
      ${nextDays().map((d, i) => {
        const date = parseDate(d);
        const wd = i === 0 ? 'Сьогодні' : i === 1 ? 'Завтра' : date.toLocaleDateString('uk-UA', { weekday: 'short' });
        return `<button class="day" data-action="day" data-date="${d}" aria-pressed="${d === draft.date}">
          <span class="small">${wd}</span><b>${date.getDate()}</b><span class="small">${date.toLocaleDateString('uk-UA', { month: 'short' })}</span>
        </button>`;
      }).join('')}
    </div>
    <div style="margin-top:12px">
      ${!minutes
        ? '<p class="muted">Оберіть послуги, щоб побачити вільний час.</p>'
        : free.length
          ? `<div class="slots" role="group" aria-label="Час">${slots.map((s) => `<button class="slot" data-action="time" data-time="${s.time}"
              ${s.busy ? 'disabled aria-label="' + s.time + ', зайнято"' : ''} aria-pressed="${s.time === draft.time}">${s.time}</button>`).join('')}</div>`
          : '<p class="muted">На цей день вільного часу немає. Оберіть інший день.</p>'}
    </div>

    <div class="summary">
      <div class="total"><span>${chosen.length ? `${chosen.length} ${plural(chosen.length, 'послуга', 'послуги', 'послуг')} · ${duration(minutes)}` : 'Нічого не обрано'}</span><span>${uah(total)}</span></div>
      <button class="btn primary block" data-action="confirm" ${chosen.length && draft.time ? '' : 'disabled'}>
        ${draft.time ? `Записатися на ${dayLabel(draft.date, { day: 'numeric', month: 'long' })}, ${draft.time}` : 'Оберіть час'}
      </button>
    </div>`;
}

function confirmBooking() {
  const p = placeById(draft.placeId);
  const cls = draftClass();
  const chosen = p.services.filter((s) => draft.services.has(s.id));
  const car = cars.find((c) => c.id === draft.carId);
  const b = {
    id: uid(),
    placeId: p.id,
    services: chosen.map((s) => s.name),
    total: chosen.reduce((a, s) => a + s.price[cls], 0),
    minutes: chosen.reduce((a, s) => a + s.min, 0),
    date: draft.date,
    time: draft.time,
    car: car ? carLabel(car) : CAR_CLASSES[cls],
    status: 'active',
    createdAt: Date.now(),
  };
  bookings.push(b);
  store.set('bookings', bookings);
  draft = null;
  location.hash = `#/bookings/${b.id}`;
  toast('Ви записані ✅');
}

function bookingCard(b, highlight) {
  const p = placeById(b.placeId);
  const state = bookingState(b);
  const label = { upcoming: 'Майбутній', past: 'Завершено', cancelled: 'Скасовано' }[state];
  return `<article class="card stack" id="b-${b.id}" ${highlight ? 'style="border-color:var(--accent)"' : ''}>
    <div class="place-head">
      <div><span class="status ${state}">${label}</span><h3 style="margin:2px 0 0">${esc(p?.name ?? 'Сервіс')}</h3></div>
      <b style="white-space:nowrap">${uah(b.total)}</b>
    </div>
    <div>🗓️ ${dayLabel(b.date)}, ${b.time}–${hhmm(toMin(b.time) + b.minutes)}</div>
    <div class="small muted">🚗 ${esc(b.car)}<br>📍 ${esc(p?.address ?? '')}<br>${b.services.map(esc).join(', ')}</div>
    ${state === 'upcoming' ? `<div class="row">
      <button class="btn" data-action="ics" data-id="${b.id}">📅 У календар</button>
      ${p ? `<a class="btn" href="tel:${p.phone.replace(/[^+\d]/g, '')}">📞 Зателефонувати</a>` : ''}
      <button class="btn danger" data-action="cancel" data-id="${b.id}">Скасувати</button>
    </div>` : ''}
    ${state === 'past' && p ? `<div class="row"><a class="btn" href="#/book/${p.id}" data-action="repeat" data-id="${b.id}">🔁 Записатися знову</a></div>` : ''}
  </article>`;
}

function viewBookings(highlightId) {
  const sorted = [...bookings].sort((a, b) => bookingStart(a) - bookingStart(b));
  const upcoming = sorted.filter((b) => bookingState(b) === 'upcoming');
  const rest = sorted.filter((b) => bookingState(b) !== 'upcoming').reverse();
  if (!bookings.length) {
    return `<h1>Мої записи</h1><div class="empty"><div class="emoji" aria-hidden="true">🗓️</div>
      <p>Записів поки немає.</p><a class="btn primary" href="#/">Знайти мийку або сервіс</a></div>`;
  }
  return `<h1>Мої записи</h1>
    <h2>Майбутні</h2>
    <div class="stack">${upcoming.length ? upcoming.map((b) => bookingCard(b, b.id === highlightId)).join('') : '<p class="muted">Немає майбутніх записів.</p>'}</div>
    ${rest.length ? `<h2>Історія</h2><div class="stack">${rest.map((b) => bookingCard(b)).join('')}</div>` : ''}`;
}

function viewGarage() {
  return `<h1>Гараж</h1>
    <p class="muted">Авто в гаражі потрібні, щоб одразу бачити ціни для свого класу й не вводити дані під час запису.</p>
    <div class="stack">
      ${cars.map((c) => `<article class="card place-head">
        <div><h2 class="card-title">${esc(c.make)} ${esc(c.model)}</h2>
        <div class="small muted">${[c.plate, CAR_CLASSES[c.cls], c.tires && `шини ${c.tires}`].filter(Boolean).map(esc).join(' · ')}</div></div>
        <button class="btn danger" data-action="delcar" data-id="${c.id}" aria-label="Видалити ${esc(c.make)} ${esc(c.model)}">Видалити</button>
      </article>`).join('')}
    </div>
    <h2>${cars.length ? 'Додати ще авто' : 'Додати авто'}</h2>
    <form class="card" id="carform">
      <label class="field"><span>Марка</span><input name="make" required placeholder="Наприклад, Skoda" autocomplete="off"></label>
      <label class="field"><span>Модель</span><input name="model" required placeholder="Наприклад, Octavia" autocomplete="off"></label>
      <label class="field"><span>Держномер (необовʼязково)</span><input name="plate" placeholder="AA1234BB" autocomplete="off"></label>
      <label class="field"><span>Клас</span><select name="cls">${CAR_CLASSES.map((c, i) => `<option value="${i}">${c}</option>`).join('')}</select></label>
      <label class="field"><span>Розмір шин (необовʼязково)</span><input name="tires" placeholder="205/55 R16" autocomplete="off"></label>
      <button class="btn primary block" type="submit">Зберегти</button>
    </form>`;
}

function viewNotFound() {
  return `<div class="empty"><div class="emoji" aria-hidden="true">🤷</div><p>Сторінку не знайдено.</p><a class="btn" href="#/">На головну</a></div>`;
}

// ---------- календар ----------

function downloadIcs(b) {
  const p = placeById(b.placeId);
  const start = bookingStart(b);
  const end = new Date(start.getTime() + b.minutes * 60000);
  const fmt = (d) => `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}T${pad(d.getHours())}${pad(d.getMinutes())}00`;
  const ics = [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//AutoZapys//UK', 'BEGIN:VEVENT',
    `UID:${b.id}@autozapis`, `DTSTART:${fmt(start)}`, `DTEND:${fmt(end)}`,
    `SUMMARY:${p.name}`, `LOCATION:${CITY.name}\\, ${p.address}`, `DESCRIPTION:${b.services.join('\\, ')}`,
    'BEGIN:VALARM', 'TRIGGER:-PT1H', 'ACTION:DISPLAY', 'DESCRIPTION:Скоро запис', 'END:VALARM',
    'END:VEVENT', 'END:VCALENDAR',
  ].join('\r\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([ics], { type: 'text/calendar' }));
  a.download = `zapis-${b.date}.ics`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

// ---------- роутер і події ----------

function route() {
  const [, page = '', arg] = location.hash.replace(/^#/, '').split('/');
  const view = $('#view');
  const tab = page === 'bookings' ? 'bookings' : page === 'garage' ? 'garage' : 'catalog';
  document.querySelectorAll('.tabs a').forEach((a) => {
    if (a.dataset.tab === tab) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  });

  if (page === '') { view.innerHTML = viewCatalog(); renderList(); }
  else if (page === 'place') view.innerHTML = viewPlace(arg);
  else if (page === 'book') { view.innerHTML = viewBook(arg); if ($('#book')) renderBook(); }
  else if (page === 'bookings') view.innerHTML = viewBookings(arg);
  else if (page === 'garage') view.innerHTML = viewGarage();
  else view.innerHTML = viewNotFound();

  const target = arg && page === 'bookings' ? $(`#b-${arg}`) : null;
  if (target) target.scrollIntoView({ block: 'center' });
  else window.scrollTo(0, 0);
}

document.addEventListener('click', (e) => {
  const el = e.target.closest('[data-action]');
  if (!el) return;
  const { action, id } = el.dataset;

  if (action === 'cat') {
    ui.cat = el.dataset.cat;
    e.preventDefault();
    route();
  } else if (action === 'toggle') {
    ui[el.dataset.key] = !ui[el.dataset.key];
    el.setAttribute('aria-pressed', ui[el.dataset.key]);
    renderList();
  } else if (action === 'fav') {
    if (favs.has(id)) favs.delete(id); else favs.add(id);
    store.set('favs', [...favs]);
    const on = favs.has(id);
    el.setAttribute('aria-pressed', on);
    el.textContent = on ? '❤️' : '🤍';
    el.setAttribute('aria-label', el.getAttribute('aria-label').replace(/^(Прибрати з обраного|В обране)/, on ? 'Прибрати з обраного' : 'В обране'));
    if (ui.favOnly && $('#list')) renderList();
    toast(on ? 'Додано в обране' : 'Прибрано з обраного');
  } else if (action === 'day') {
    draft.date = el.dataset.date;
    renderBook();
  } else if (action === 'time') {
    draft.time = el.dataset.time;
    renderBook();
  } else if (action === 'confirm') {
    confirmBooking();
  } else if (action === 'cancel') {
    if (!confirm('Скасувати запис?')) return;
    const b = bookings.find((x) => x.id === id);
    b.status = 'cancelled';
    store.set('bookings', bookings);
    route();
    toast('Запис скасовано');
  } else if (action === 'ics') {
    downloadIcs(bookings.find((x) => x.id === id));
  } else if (action === 'repeat') {
    const b = bookings.find((x) => x.id === id);
    const p = placeById(b.placeId);
    draft = {
      placeId: p.id,
      services: new Set(p.services.filter((s) => b.services.includes(s.name)).map((s) => s.id)),
      date: nextDays()[0], time: null, carId: cars[0]?.id ?? null,
    };
  } else if (action === 'delcar') {
    cars = cars.filter((c) => c.id !== id);
    store.set('cars', cars);
    route();
  }
});

document.addEventListener('change', (e) => {
  const t = e.target;
  if (t.matches('[data-action="svc"]')) {
    if (t.checked) draft.services.add(t.value); else draft.services.delete(t.value);
    renderBook();
  } else if (t.id === 'car') {
    draft.carId = t.value;
    renderBook();
  } else if (t.id === 'bookcls' || t.id === 'cls') {
    ui.cls = Number(t.value);
    store.set('cls', ui.cls);
    if (t.id === 'cls') renderList(); else renderBook();
  } else if (t.id === 'sort') {
    ui.sort = t.value;
    renderList();
  }
});

document.addEventListener('input', (e) => {
  if (e.target.id === 'q') { ui.q = e.target.value; renderList(); }
});

document.addEventListener('submit', (e) => {
  if (e.target.id !== 'carform') return;
  e.preventDefault();
  const f = new FormData(e.target);
  const car = {
    id: uid(),
    make: f.get('make').trim(),
    model: f.get('model').trim(),
    plate: f.get('plate').trim().toUpperCase(),
    cls: Number(f.get('cls')),
    tires: f.get('tires').trim(),
  };
  cars.push(car);
  store.set('cars', cars);
  if (cars.length === 1) { ui.cls = car.cls; store.set('cls', ui.cls); }
  route();
  toast('Авто додано');
});

$('#city').textContent = `📍 ${CITY.name}`;
window.addEventListener('hashchange', route);
route();

if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
