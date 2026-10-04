import { CITY, CATEGORIES, CAR_CLASSES, PLACES, PAYMENT, MAINTENANCE } from './data.js';

// ---------- сховище (лише на цьому пристрої) ----------

const store = {
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

let cars = store.get('cars', []);
let bookings = store.get('bookings', []).map((b) =>
  // Записи з версії без оплати: вважаємо їх оплаченими або скасованими з поверненням.
  b.state ? b : { ...b, paid: b.total, code: String(1000 + Math.floor(Math.random() * 9000)), state: b.status === 'cancelled' ? 'cancelled' : 'paid' });
let payouts = store.get('payouts', []);
let favs = new Set(store.get('favs', []));

const ui = { cat: 'all', q: '', sort: 'rating', openNow: false, favOnly: false, cls: store.get('cls', 0), partner: store.get('partner', null) };
let draft = null; // чернетка запису: { placeId, services: Set, date, time, carId, paying }

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

function minPrice(place, cat, cls) {
  const list = cat === 'all' ? place.services : place.services.filter((s) => serviceCat(s) === cat);
  return Math.min(...list.map((s) => s.price[cls]));
}

// Категорія послуги за каталогом, з якого її взято.
const WASH_IDS = ['express', 'complex', 'inside', 'wax', 'engine', 'dry'];
const TIRE_IDS = ['change', 'balance', 'repair', 'storage', 'rolling'];
const DETAIL_IDS = ['polish', 'ceramic', 'ppf', 'deepclean', 'headlights'];
const serviceCat = (s) =>
  WASH_IDS.includes(s.id) ? 'wash' : TIRE_IDS.includes(s.id) ? 'tires' : DETAIL_IDS.includes(s.id) ? 'detailing' : 'service';

// ---------- відстань ----------

// Відстань по прямій між двома точками, км (формула гаверсинуса).
function distanceKm(a, b) {
  const rad = (x) => (x * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.sqrt(h));
}

const fmtDist = (d) => (d < 1 ? `${Math.max(50, Math.round((d * 1000) / 50) * 50)} м` : `${d.toLocaleString('uk-UA', { maximumFractionDigits: 1 })} км`);
const distTo = (p) => (ui.pos ? distanceKm(ui.pos, p) : null);

// Місце користувача тримаємо лише в памʼяті й нікуди не надсилаємо.
function locate() {
  if (ui.locating) return;
  ui.locating = true;
  const done = (pos, fallback) => {
    Object.assign(ui, { pos, posFallback: fallback, locating: false });
    if ($('#list')) renderList();
    if (fallback) toast('Не вдалося визначити ваше місце — рахуємо відстань від центру Києва');
  };
  if (!navigator.geolocation) { done(CITY.center, true); return; }
  navigator.geolocation.getCurrentPosition(
    (p) => done({ lat: p.coords.latitude, lng: p.coords.longitude }, false),
    () => done(CITY.center, true),
    { timeout: 8000, maximumAge: 300000 },
  );
}

function setSort(value) {
  ui.sort = value;
  if (value === 'near' && !ui.pos) locate();
  if ($('#sort')) $('#sort').value = value;
  const near = $('[data-action="near"]');
  if (near) near.setAttribute('aria-pressed', value === 'near');
  renderList();
}

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
    near: (a, b) => (ui.pos ? distTo(a) - distTo(b) : b.rating - a.rating),
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
        ${ui.pos ? `<span class="badge dist">📍 ${fmtDist(distTo(p))}</span>` : ''}
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
  const where = ui.locating ? ' · визначаємо ваше місце…' : ui.sort === 'near' && ui.pos ? ` · відстань від ${ui.posFallback ? 'центру Києва' : 'вас'}` : '';
  $('#count').textContent = `${list.length} ${plural(list.length, 'місце', 'місця', 'місць')}${where}`;
}

function viewCatalog() {
  const chip = (label, attrs, on) => `<button class="chip" ${attrs} aria-pressed="${on}">${label}</button>`;
  return `${seasonBanner()}
    <h1>Мийки, шиномонтаж, СТО й детейлінг</h1>
    <input id="q" class="search" type="search" placeholder="Назва, адреса або послуга" aria-label="Пошук" value="${esc(ui.q)}">
    <div class="chips" role="group" aria-label="Фільтри">
      ${chip('📍 Поруч', 'data-action="near"', ui.sort === 'near')}
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
          <option value="near" ${ui.sort === 'near' ? 'selected' : ''}>Найближчі</option>
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
      ${ui.pos ? `<span>📍 ${fmtDist(distTo(p))} від ${ui.posFallback ? 'центру' : 'вас'}</span>` : ''}
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

    ${draft.paying ? `<div class="summary">
      <div class="total"><span>До сплати</span><span>${uah(total)}</span></div>
      <ul class="perks small">
        <li>🛡️ Гроші утримуються, доки роботу не виконано</li>
        <li>💸 Комісія для клієнта — 0 ₴</li>
        <li>↩️ Безкоштовне скасування за ${PAYMENT.freeCancelHours} год до візиту</li>
      </ul>
      <button class="btn primary block" data-action="pay">💳 Оплатити ${uah(total)}</button>
      <button class="btn block" data-action="unpay" style="margin-top:8px">Назад</button>
      <p class="small muted" style="margin:8px 0 0;text-align:center">Демо-оплата: гроші не списуються.</p>
    </div>` : `<div class="summary">
      <div class="total"><span>${chosen.length ? `${chosen.length} ${plural(chosen.length, 'послуга', 'послуги', 'послуг')} · ${duration(minutes)}` : 'Нічого не обрано'}</span><span>${uah(total)}</span></div>
      <button class="btn primary block" data-action="confirm" ${chosen.length && draft.time ? '' : 'disabled'}>
        ${draft.time ? `Записатися на ${dayLabel(draft.date, { day: 'numeric', month: 'long' })}, ${draft.time}` : 'Оберіть час'}
      </button>
    </div>`}`;
}

function confirmBooking() {
  const p = placeById(draft.placeId);
  const cls = draftClass();
  const chosen = p.services.filter((s) => draft.services.has(s.id));
  const car = cars.find((c) => c.id === draft.carId);
  const total = chosen.reduce((a, s) => a + s.price[cls], 0);
  const b = {
    id: uid(),
    placeId: p.id,
    services: chosen.map((s) => s.name),
    total,
    paid: total,
    minutes: chosen.reduce((a, s) => a + s.min, 0),
    date: draft.date,
    time: draft.time,
    car: car ? carLabel(car) : CAR_CLASSES[cls],
    carId: car?.id ?? null,
    state: 'paid',
    code: newCode(),
    createdAt: Date.now(),
  };
  bookings.push(b);
  save();
  draft = null;
  location.hash = `#/bookings/${b.id}`;
  toast('Оплачено, ви записані ✅');
}

// ---------- оплата й утримання коштів ----------

const ACTIVE = ['paid', 'done', 'dispute'];
const HOUR = 3600000;
const newCode = () => String(1000 + Math.floor(Math.random() * 9000));

function save() {
  return store.set('bookings', bookings) && store.set('payouts', payouts);
}

// Автоматично передаємо гроші точці, якщо клієнт не відповів за autoReleaseHours.
function settle() {
  let changed = false;
  for (const b of bookings) {
    if (b.state === 'done' && Date.now() - b.doneAt >= PAYMENT.autoReleaseHours * HOUR) {
      b.state = 'completed';
      b.releasedAt = b.doneAt + PAYMENT.autoReleaseHours * HOUR;
      changed = true;
    }
  }
  if (changed) save();
}

// Скільки з оплати клієнта належить точці (до комісії).
function placeShare(b) {
  if (b.state === 'completed') return b.paid;
  if (b.state === 'cancelled' || b.state === 'noshow') return b.placeAmount ?? 0;
  return 0;
}

function balanceOf(placeId) {
  const own = bookings.filter((b) => b.placeId === placeId);
  const earned = own.reduce((a, b) => a + placeShare(b), 0);
  const withdrawn = payouts.filter((x) => x.placeId === placeId).reduce((a, x) => a + x.gross, 0);
  const held = own.filter((b) => ACTIVE.includes(b.state)).reduce((a, b) => a + b.paid, 0);
  return { available: earned - withdrawn, held };
}

function cancelTerms(b) {
  const free = bookingStart(b) - Date.now() >= PAYMENT.freeCancelHours * HOUR;
  const placeAmount = free ? 0 : Math.round(b.paid * PAYMENT.lateCancelShare);
  return { free, placeAmount, refund: b.paid - placeAmount };
}

const fmtTime = (ms) => new Date(ms).toLocaleString('uk-UA', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' });

function steps(b) {
  const at = { paid: 0, done: 1, dispute: 1, completed: 2 }[b.state];
  if (at === undefined) return '';
  return `<ol class="steps" aria-label="Статус оплати">${['Оплачено', 'Виконано', 'Гроші точці']
    .map((s, i) => `<li class="${i <= at ? 'on' : ''}" ${i === at ? 'aria-current="step"' : ''}>${s}</li>`).join('')}</ol>`;
}

const STATE_LABEL = {
  paid: ['upcoming', 'Оплачено · гроші утримуються'],
  done: ['upcoming', 'Чекає вашого підтвердження'],
  dispute: ['warn', 'Спір розглядається'],
  completed: ['past', 'Виконано'],
  cancelled: ['cancelled', 'Скасовано'],
  noshow: ['cancelled', 'Неявка'],
  refunded: ['cancelled', 'Гроші повернено'],
};

// Фото, коментар і пробіг, які точка додала, коли машина була готова.
function result(b) {
  if (!b.photos?.length && !b.note && !b.km) return '';
  return `${b.photos?.length ? `<div class="photos">${b.photos.map((src, i) => `<img src="${esc(src)}" alt="Фото результату ${i + 1}">`).join('')}</div>` : ''}
    ${b.note ? `<div class="small">💬 ${esc(b.note)}</div>` : ''}
    ${b.km ? `<div class="small muted">Пробіг: ${b.km.toLocaleString('uk-UA')} км</div>` : ''}`;
}

function bookingCard(b, highlight) {
  const p = placeById(b.placeId);
  const [cls, label] = STATE_LABEL[b.state];
  const tel = p ? `<a class="btn" href="tel:${p.phone.replace(/[^+\d]/g, '')}">📞 Зателефонувати</a>` : '';
  let body = '';
  if (b.state === 'paid') {
    const t = cancelTerms(b);
    body = `${b.extra ? `<div class="notice">
        <b>Майстер пропонує доплату +${uah(b.extra.amount)}</b><div class="small">${esc(b.extra.reason)}</div>
        <div class="row" style="margin-top:8px">
          <button class="btn primary" data-action="extra-ok" data-id="${b.id}">Погодитися й доплатити</button>
          <button class="btn" data-action="extra-no" data-id="${b.id}">Відхилити</button>
        </div></div>` : ''}
      <div class="code-box"><span class="small muted">Код для майстра — назвіть його лише після виконання роботи</span>
        <span class="code">${b.code}</span></div>
      <div class="row">
        <button class="btn" data-action="ics" data-id="${b.id}">📅 У календар</button>
        ${tel}
        <button class="btn danger" data-action="cancel" data-id="${b.id}">Скасувати</button>
      </div>
      <p class="small muted" style="margin:0">${t.free
        ? `Безкоштовне скасування до ${fmtTime(bookingStart(b) - PAYMENT.freeCancelHours * HOUR)}.`
        : `Пізнє скасування: повернемо ${uah(t.refund)}, ${uah(t.placeAmount)} отримає точка.`}</p>`;
  } else if (b.state === 'done') {
    body = `<div class="notice"><b>🎉 Машина готова!</b> Перевірте результат і підтвердіть або відкрийте спір до
        ${fmtTime(b.doneAt + PAYMENT.autoReleaseHours * HOUR)}, інакше гроші автоматично перейдуть точці.</div>
      ${result(b)}
      <div class="row">
        <button class="btn primary" data-action="client-ok" data-id="${b.id}">✅ Усе добре</button>
        <button class="btn danger" data-action="dispute" data-id="${b.id}">Відкрити спір</button>
      </div>`;
  } else if (b.state === 'dispute') {
    body = `<div class="notice warn">Спір: «${esc(b.disputeReason)}». Модератор перевірить і вирішить, кому передати гроші.</div>${result(b)}`;
  } else if (b.state === 'completed') {
    body = result(b);
  } else if (b.state === 'cancelled' || b.state === 'noshow' || b.state === 'refunded') {
    body = `<div class="small muted">Повернено ${uah(b.refund ?? b.paid)} на картку${b.placeAmount ? `, ${uah(b.placeAmount)} отримала точка` : ''}.</div>`;
  }
  return `<article class="card stack" id="b-${b.id}" ${highlight ? 'style="border-color:var(--accent)"' : ''}>
    <div class="place-head">
      <div><span class="status ${cls}">${label}</span><h3 style="margin:2px 0 0">${esc(p?.name ?? 'Сервіс')}</h3></div>
      <b style="white-space:nowrap">${uah(b.paid)}</b>
    </div>
    ${steps(b)}
    <div>🗓️ ${dayLabel(b.date)}, ${b.time}–${hhmm(toMin(b.time) + b.minutes)}</div>
    <div class="small muted">🚗 ${esc(b.car)}<br>📍 ${esc(p?.address ?? '')}<br>${b.services.map(esc).join(', ')}</div>
    ${body}
    ${!ACTIVE.includes(b.state) && p ? `<div class="row"><a class="btn" href="#/book/${p.id}" data-action="repeat" data-id="${b.id}">🔁 Записатися знову</a></div>` : ''}
  </article>`;
}

function viewBookings(highlightId) {
  const sorted = [...bookings].sort((a, b) => bookingStart(a) - bookingStart(b));
  const active = sorted.filter((b) => ACTIVE.includes(b.state));
  const rest = sorted.filter((b) => !ACTIVE.includes(b.state)).reverse();
  if (!bookings.length) {
    return `<h1>Мої записи</h1><div class="empty"><div class="emoji" aria-hidden="true">🗓️</div>
      <p>Записів поки немає.</p><a class="btn primary" href="#/">Знайти мийку або сервіс</a></div>`;
  }
  return `<h1>Мої записи</h1>
    <h2>Активні</h2>
    <div class="stack">${active.length ? active.map((b) => bookingCard(b, b.id === highlightId)).join('') : '<p class="muted">Немає активних записів.</p>'}</div>
    ${rest.length ? `<h2>Історія</h2><div class="stack">${rest.map((b) => bookingCard(b, b.id === highlightId)).join('')}</div>` : ''}`;
}

// ---------- кабінет точки ----------

function partnerBooking(b) {
  const started = bookingStart(b) <= new Date();
  const [cls, label] = STATE_LABEL[b.state];
  let actions = '';
  if (b.state === 'paid') {
    actions = `<form class="ready-form stack" data-id="${b.id}">
        <div class="row" style="align-items:center">
          <label class="btn photo-pick">📷 Додати фото результату (до 3)
            <input class="sr-only" name="photos" type="file" accept="image/*" capture="environment" multiple></label>
          <span class="small muted photo-count" aria-live="polite"></span>
        </div>
        <div class="two">
          <label class="field"><span>Пробіг, км</span><input name="km" type="number" inputmode="numeric" min="0" autocomplete="off"></label>
          <label class="field"><span>Код клієнта</span><input name="code" inputmode="numeric" maxlength="4" autocomplete="off" placeholder="0000"></label>
        </div>
        <label class="field"><span>Коментар для клієнта</span><input name="note" autocomplete="off" placeholder="Наприклад, старі колодки в багажнику"></label>
        <div class="row">
          <button class="btn primary" type="submit" name="mode" value="code">Підтвердити кодом</button>
          <button class="btn" type="submit" name="mode" value="ready">Машина готова</button>
        </div>
      </form>
      <div class="row">
        ${b.extra ? '' : `<button class="btn" data-action="extra" data-id="${b.id}">＋ Доплата</button>`}
        ${started ? `<button class="btn danger" data-action="noshow" data-id="${b.id}">Клієнт не приїхав</button>` : ''}
      </div>
      ${b.extra ? `<p class="small muted" style="margin:0">Запит на доплату +${uah(b.extra.amount)} чекає відповіді клієнта.</p>` : ''}
      ${b.extraDeclined ? '<p class="small muted" style="margin:0">Клієнт відхилив доплату.</p>' : ''}`;
  } else if (b.state === 'done') {
    actions = `<p class="small muted" style="margin:0">Чекаємо підтвердження клієнта. Гроші надійдуть автоматично ${fmtTime(b.doneAt + PAYMENT.autoReleaseHours * HOUR)}.</p>${result(b)}`;
  } else if (b.state === 'completed') {
    actions = result(b);
  } else if (b.state === 'dispute') {
    actions = `<div class="notice warn">Клієнт відкрив спір: «${esc(b.disputeReason)}»</div>`;
  }
  const share = placeShare(b);
  return `<article class="card stack">
    <div class="place-head">
      <div><span class="status ${cls}">${label}</span>
        <h3 style="margin:2px 0 0">${dayLabel(b.date, { day: 'numeric', month: 'short' })}, ${b.time} · ${esc(b.car)}</h3></div>
      <b style="white-space:nowrap">${uah(ACTIVE.includes(b.state) ? b.paid : share)}</b>
    </div>
    <div class="small muted">${b.services.map(esc).join(', ')}</div>
    ${actions}
  </article>`;
}

function viewPartner() {
  if (!placeById(ui.partner)) ui.partner = PLACES[0].id;
  const p = placeById(ui.partner);
  const own = bookings.filter((b) => b.placeId === p.id).sort((a, b) => bookingStart(a) - bookingStart(b));
  const active = own.filter((b) => ACTIVE.includes(b.state));
  const rest = own.filter((b) => !ACTIVE.includes(b.state)).reverse();
  const bal = balanceOf(p.id);
  const fee = Math.round(bal.available * PAYMENT.commission);
  const history = payouts.filter((x) => x.placeId === p.id).reverse();
  const disputes = bookings.filter((b) => b.state === 'dispute');
  return `<h1>Кабінет точки</h1>
    <label class="field"><span>Точка</span><select id="partner-place">
      ${PLACES.map((x) => `<option value="${x.id}" ${x.id === p.id ? 'selected' : ''}>${esc(x.name)}</option>`).join('')}
    </select></label>
    <section class="card stack" aria-label="Баланс">
      <div class="balance">
        <div><span class="small muted">Доступно до виведення</span><b>${uah(bal.available)}</b></div>
        <div><span class="small muted">Утримується до виконання</span><b>${uah(bal.held)}</b></div>
      </div>
      <button class="btn primary block" data-action="payout" ${bal.available > 0 ? '' : 'disabled'}>
        ${bal.available > 0 ? `Вивести ${uah(bal.available - fee)} на картку` : 'Немає коштів для виведення'}
      </button>
      <p class="small muted" style="margin:0">Комісія сервісу ${Math.round(PAYMENT.commission * 100)}% утримується лише під час виведення${bal.available > 0 ? `: ${uah(fee)}` : ''}. Для клієнтів комісії немає.</p>
    </section>
    <h2>Активні записи</h2>
    <div class="stack">${active.length ? active.map(partnerBooking).join('') : '<p class="muted">Активних записів немає.</p>'}</div>
    ${rest.length ? `<h2>Завершені</h2><div class="stack">${rest.map(partnerBooking).join('')}</div>` : ''}
    ${history.length ? `<h2>Виплати</h2><div class="card stack">${history.map((x) => `<div class="place-head small">
        <span>${fmtTime(x.at)}</span><span>${uah(x.net)} <span class="muted">(комісія ${uah(x.fee)})</span></span></div>`).join('')}</div>` : ''}
    <h2>Модерація спорів</h2>
    <p class="small muted">У справжньому сервісі цей розділ бачить лише модератор платформи.</p>
    <div class="stack">${disputes.length ? disputes.map((b) => `<article class="card stack">
        <div class="place-head"><b>${esc(placeById(b.placeId)?.name ?? '')}</b><b>${uah(b.paid)}</b></div>
        <div class="small">«${esc(b.disputeReason)}»</div>
        <div class="row">
          <button class="btn" data-action="resolve-client" data-id="${b.id}">Повернути клієнту</button>
          <button class="btn" data-action="resolve-place" data-id="${b.id}">Передати точці</button>
        </div></article>`).join('') : '<p class="muted">Відкритих спорів немає.</p>'}</div>
    <p class="note">Демо: записи, баланс і виплати зберігаються на цьому пристрої, тож клієнта й точку можна перевірити на одному телефоні.</p>`;
}

// ---------- гараж і сервісна книжка ----------

const fmtDate = (s) => parseDate(s).toLocaleDateString('uk-UA', { day: 'numeric', month: 'long', year: 'numeric' });
const km = (n) => `${n.toLocaleString('uk-UA')} км`;

// Історія авто: завершені записи в CARCAR плюс записи, додані вручну.
function historyOf(car) {
  const fromApp = bookings
    .filter((b) => b.carId === car.id && b.state === 'completed')
    .map((b) => ({ date: b.date, km: b.km, text: b.services.join(', '), cost: b.paid, place: placeById(b.placeId)?.name, photos: b.photos, note: b.note }));
  return [...fromApp, ...(car.log ?? [])].sort((x, y) => (x.date < y.date ? 1 : -1));
}

const currentKm = (car) => Math.max(car.mileage || 0, ...historyOf(car).map((h) => h.km || 0));

function reminders(car) {
  const out = [];
  const now = new Date();
  const history = historyOf(car);

  const m = now.getMonth();
  const winter = m >= 9 && m <= 10;
  const summer = m >= 2 && m <= 3;
  if (winter || summer) {
    const since = isoDate(winter ? new Date(now.getFullYear(), 8, 1) : new Date(now.getFullYear(), 1, 15));
    const done = history.find((h) => h.date >= since && /перевзування/i.test(h.text));
    out.push(done
      ? { level: 'ok', text: `Перевзування зроблено ${fmtDate(done.date)}` }
      : { level: 'due', text: `Час перевзутися на ${winter ? 'зимові' : 'літні'} шини`, cat: 'tires' });
  }

  const oil = history.find((h) => /олив|масл/i.test(h.text));
  const cur = currentKm(car);
  if (!oil) {
    out.push({ level: 'info', text: 'Немає даних про заміну оливи — додайте запис нижче' });
  } else {
    const ageMonths = (now - parseDate(oil.date)) / (30.4 * 24 * HOUR);
    const left = oil.km && cur ? oil.km + MAINTENANCE.oilKm - cur : null;
    if (ageMonths >= MAINTENANCE.oilMonths || (left !== null && left <= 0)) {
      out.push({ level: 'due', text: left !== null && left <= 0 ? `Пора міняти оливу: прострочено на ${km(-left)}` : 'Пора міняти оливу: минув рік', cat: 'service' });
    } else if (left !== null && left <= MAINTENANCE.oilWarnKm) {
      out.push({ level: 'due', text: `Заміна оливи через ${km(left)}`, cat: 'service' });
    } else {
      out.push({ level: 'ok', text: left !== null ? `Олива: ще ${km(left)}` : `Оливу міняли ${fmtDate(oil.date)}` });
    }
  }

  if (car.insuranceUntil) {
    const days = Math.ceil((parseDate(car.insuranceUntil) - now) / (24 * HOUR));
    if (days < 0) out.push({ level: 'due', text: 'Поліс ОСЦПВ прострочено' });
    else if (days <= MAINTENANCE.insuranceWarnDays) out.push({ level: 'due', text: `Поліс ОСЦПВ закінчується через ${days} ${plural(days, 'день', 'дні', 'днів')}` });
    else out.push({ level: 'ok', text: `Поліс ОСЦПВ до ${fmtDate(car.insuranceUntil)}` });
  }
  return out;
}

const reminderRow = (r) => `<div class="reminder ${r.level}">
    <span class="small">${r.level === 'due' ? '⚠️' : r.level === 'ok' ? '✅' : 'ℹ️'} ${esc(r.text)}</span>
    ${r.cat ? `<a class="btn" href="#/" data-action="cat" data-cat="${r.cat}">Записатися</a>` : ''}
  </div>`;

function viewGarage() {
  return `<h1>Гараж</h1>
    <p class="muted">Сервісна книжка кожного авто: історія обслуговування, пробіг і нагадування.</p>
    <div class="stack">
      ${cars.map((c) => {
        const due = reminders(c).filter((r) => r.level === 'due');
        return `<a class="card car-link" href="#/garage/${c.id}">
          <h2 class="card-title">${esc(c.make)} ${esc(c.model)}</h2>
          <div class="small muted">${[c.plate, CAR_CLASSES[c.cls], currentKm(c) ? km(currentKm(c)) : ''].filter(Boolean).map(esc).join(' · ')}</div>
          ${due.length ? `<div class="badges"><span class="badge" style="background:var(--warn-soft)">⚠️ ${esc(due[0].text)}${due.length > 1 ? ` і ще ${due.length - 1}` : ''}</span></div>` : ''}
          <div class="small" style="margin-top:6px;color:var(--accent);font-weight:600">Сервісна книжка →</div>
        </a>`;
      }).join('')}
    </div>
    <h2>${cars.length ? 'Додати ще авто' : 'Додати авто'}</h2>
    <form class="card" id="carform">
      <label class="field"><span>Марка</span><input name="make" required placeholder="Наприклад, Skoda" autocomplete="off"></label>
      <label class="field"><span>Модель</span><input name="model" required placeholder="Наприклад, Octavia" autocomplete="off"></label>
      <label class="field"><span>Держномер (необовʼязково)</span><input name="plate" placeholder="AA1234BB" autocomplete="off"></label>
      <label class="field"><span>Клас</span><select name="cls">${CAR_CLASSES.map((c, i) => `<option value="${i}">${c}</option>`).join('')}</select></label>
      <label class="field"><span>Пробіг, км (необовʼязково)</span><input name="mileage" type="number" inputmode="numeric" min="0" autocomplete="off"></label>
      <label class="field"><span>Розмір шин (необовʼязково)</span><input name="tires" placeholder="205/55 R16" autocomplete="off"></label>
      <label class="field"><span>Поліс ОСЦПВ дійсний до (необовʼязково)</span><input name="insuranceUntil" type="date"></label>
      <button class="btn primary block" type="submit">Зберегти</button>
    </form>`;
}

function viewCar(id) {
  const c = cars.find((x) => x.id === id);
  if (!c) return viewNotFound();
  const history = historyOf(c);
  return `<a class="back" href="#/garage">← Гараж</a>
    <h1>${esc(c.make)} ${esc(c.model)}</h1>
    <div class="small muted">${[c.plate, CAR_CLASSES[c.cls], c.tires && `шини ${c.tires}`].filter(Boolean).map(esc).join(' · ')}</div>
    <h2>Нагадування</h2>
    <div class="stack">${reminders(c).map(reminderRow).join('')}</div>
    <h2>Пробіг</h2>
    <form class="card row" id="kmform" data-id="${c.id}" style="align-items:end">
      <label class="field" style="margin:0;flex:1"><span>Поточний пробіг, км</span>
        <input name="km" type="number" inputmode="numeric" min="0" value="${currentKm(c) || ''}" autocomplete="off"></label>
      <button class="btn" type="submit">Оновити</button>
    </form>
    <h2>Історія обслуговування</h2>
    <div class="card stack">
      ${history.length ? history.map((h) => `<div class="log-item stack">
        <div class="place-head"><b>${fmtDate(h.date)}</b>${h.cost ? `<b>${uah(h.cost)}</b>` : ''}</div>
        <div>${esc(h.text)}</div>
        <div class="small muted">${[h.place, h.km && km(h.km)].filter(Boolean).map(esc).join(' · ')}</div>
        ${h.note ? `<div class="small">💬 ${esc(h.note)}</div>` : ''}
        ${h.photos?.length ? `<div class="photos">${h.photos.map((src, i) => `<img src="${esc(src)}" alt="Фото ${i + 1}">`).join('')}</div>` : ''}
      </div>`).join('') : '<p class="muted" style="margin:0">Тут зʼявляться всі візити через CARCAR. Роботи в інших сервісах можна додати вручну.</p>'}
    </div>
    <h2>Додати запис вручну</h2>
    <form class="card" id="logform" data-id="${c.id}">
      <label class="field"><span>Дата</span><input name="date" type="date" required value="${isoDate(new Date())}"></label>
      <label class="field"><span>Що зроблено</span><input name="text" required placeholder="Наприклад, заміна оливи та фільтра" autocomplete="off"></label>
      <label class="field"><span>Пробіг, км (необовʼязково)</span><input name="km" type="number" inputmode="numeric" min="0" autocomplete="off"></label>
      <label class="field"><span>Сума, ₴ (необовʼязково)</span><input name="cost" type="number" inputmode="numeric" min="0" autocomplete="off"></label>
      <button class="btn primary block" type="submit">Додати в книжку</button>
    </form>
    <div class="row" style="margin-top:20px">
      <button class="btn danger" data-action="delcar" data-id="${c.id}">Видалити авто</button>
    </div>`;
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
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//CARCAR//UK', 'BEGIN:VEVENT',
    `UID:${b.id}@carcar`, `DTSTART:${fmt(start)}`, `DTEND:${fmt(end)}`,
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

// Зменшує фото до 720 px, щоб воно вмістилося у сховище пристрою.
async function shrinkPhoto(file) {
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

// «Машина готова»: точка додає фото, пробіг і коментар, а потім або вводить код клієнта
// (гроші одразу точці), або чекає підтвердження клієнта.
async function finishJob(form, mode) {
  const b = bookings.find((x) => x.id === form.dataset.id);
  const f = new FormData(form);
  if (mode === 'code' && f.get('code').trim() !== b.code) { toast('Невірний код'); return; }
  const files = f.getAll('photos').filter((x) => x.size).slice(0, 3);
  const photos = (await Promise.all(files.map(shrinkPhoto))).filter(Boolean);
  Object.assign(b, { photos, note: f.get('note').trim() || null, km: Number(f.get('km')) || null });
  if (mode === 'code') Object.assign(b, { state: 'completed', releasedAt: Date.now() });
  else Object.assign(b, { state: 'done', doneAt: Date.now() });
  const dropped = !save() && photos.length > 0;
  if (dropped) { b.photos = []; save(); }
  route();
  if (dropped) toast('Фото не вмістилися в памʼять пристрою, запис збережено без них');
  else toast(mode === 'code' ? `Код вірний: ${uah(b.paid)} зараховано на баланс` : 'Клієнт отримав сповіщення «Машина готова»');
}

// Дії із записом з боку клієнта, точки й модератора. Повертають false, якщо нічого не змінилося.
const bookingActions = {
  cancel(b) {
    const t = cancelTerms(b);
    const msg = t.free ? `Скасувати запис? Повернемо ${uah(t.refund)}.` : `Скасувати запис? Повернемо ${uah(t.refund)}, ${uah(t.placeAmount)} отримає точка за пізнє скасування.`;
    if (!confirm(msg)) return false;
    Object.assign(b, { state: 'cancelled', refund: t.refund, placeAmount: t.placeAmount });
    toast('Запис скасовано');
  },
  'extra-ok'(b) {
    b.paid += b.extra.amount;
    b.services.push(`Доплата: ${b.extra.reason}`);
    delete b.extra;
    toast('Доплату оплачено');
  },
  'extra-no'(b) {
    delete b.extra;
    b.extraDeclined = true;
  },
  'client-ok'(b) {
    b.state = 'completed';
    b.releasedAt = Date.now();
    toast('Дякуємо! Гроші передано точці');
  },
  dispute(b) {
    const reason = prompt('Що пішло не так?')?.trim();
    if (!reason) return false;
    Object.assign(b, { state: 'dispute', disputeReason: reason });
    toast('Спір відкрито, гроші заморожено');
  },
  extra(b) {
    const amount = Math.round(Number(prompt('Сума доплати, ₴')));
    if (!(amount > 0)) return false;
    const reason = prompt('За що доплата?')?.trim();
    if (!reason) return false;
    b.extra = { amount, reason };
    delete b.extraDeclined;
    toast('Запит на доплату надіслано клієнту');
  },
  noshow(b) {
    const placeAmount = Math.round(b.paid * PAYMENT.noShowShare);
    if (!confirm(`Позначити неявку? Точка отримає ${uah(placeAmount)}, решту повернемо клієнту.`)) return false;
    Object.assign(b, { state: 'noshow', placeAmount, refund: b.paid - placeAmount });
  },
  'resolve-client'(b) {
    Object.assign(b, { state: 'refunded', refund: b.paid, placeAmount: 0 });
    toast('Гроші повернено клієнту');
  },
  'resolve-place'(b) {
    Object.assign(b, { state: 'completed', releasedAt: Date.now() });
    toast('Гроші передано точці');
  },
};

// ---------- роутер і події ----------

function route() {
  const [, page = '', arg] = location.hash.replace(/^#/, '').split('/');
  const view = $('#view');
  const tab = ['bookings', 'garage', 'partner'].includes(page) ? page : 'catalog';
  settle();
  // Крапка на вкладці «Мої записи», коли машина готова й чекає підтвердження.
  const ready = bookings.some((b) => b.state === 'done' || b.extra);
  document.querySelector('.tabs a[data-tab="bookings"]').toggleAttribute('data-badge', ready);
  document.querySelectorAll('.tabs a').forEach((a) => {
    if (a.dataset.tab === tab) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  });

  if (page === '') { view.innerHTML = viewCatalog(); renderList(); }
  else if (page === 'place') view.innerHTML = viewPlace(arg);
  else if (page === 'book') { view.innerHTML = viewBook(arg); if ($('#book')) renderBook(); }
  else if (page === 'bookings') view.innerHTML = viewBookings(arg);
  else if (page === 'garage') view.innerHTML = arg ? viewCar(arg) : viewGarage();
  else if (page === 'partner') view.innerHTML = viewPartner();
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
    if (location.hash && location.hash !== '#/') location.hash = '#/';
    else route();
  } else if (action === 'near') {
    setSort(ui.sort === 'near' ? 'rating' : 'near');
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
    draft.paying = false;
    renderBook();
  } else if (action === 'time') {
    draft.time = el.dataset.time;
    draft.paying = false;
    renderBook();
  } else if (action === 'confirm' || action === 'unpay') {
    draft.paying = action === 'confirm';
    renderBook();
    $('.summary button')?.focus();
  } else if (action === 'pay') {
    confirmBooking();
  } else if (action === 'payout') {
    const { available } = balanceOf(ui.partner);
    const fee = Math.round(available * PAYMENT.commission);
    if (!confirm(`Вивести ${uah(available)}? Комісія ${uah(fee)}, на картку надійде ${uah(available - fee)}.`)) return;
    payouts.push({ id: uid(), placeId: ui.partner, gross: available, fee, net: available - fee, at: Date.now() });
    save();
    route();
    toast('Виплату відправлено на картку');
  } else if (bookingActions[action]) {
    const b = bookings.find((x) => x.id === id);
    if (b && bookingActions[action](b) !== false) { save(); route(); }
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
    if (!confirm('Видалити авто разом із сервісною книжкою?')) return;
    cars = cars.filter((c) => c.id !== id);
    store.set('cars', cars);
    if (location.hash === '#/garage') route(); else location.hash = '#/garage';
  }
});

document.addEventListener('change', (e) => {
  const t = e.target;
  if (t.matches('[data-action="svc"]')) {
    if (t.checked) draft.services.add(t.value); else draft.services.delete(t.value);
    draft.paying = false;
    renderBook();
  } else if (t.id === 'car') {
    draft.carId = t.value;
    renderBook();
  } else if (t.id === 'bookcls' || t.id === 'cls') {
    ui.cls = Number(t.value);
    store.set('cls', ui.cls);
    if (t.id === 'cls') renderList(); else renderBook();
  } else if (t.id === 'sort') {
    setSort(t.value);
  } else if (t.name === 'photos') {
    const n = Math.min(t.files.length, 3);
    t.closest('form').querySelector('.photo-count').textContent = n ? `Обрано фото: ${n}` : '';
  } else if (t.id === 'partner-place') {
    ui.partner = t.value;
    store.set('partner', ui.partner);
    route();
  }
});

document.addEventListener('input', (e) => {
  if (e.target.id === 'q') { ui.q = e.target.value; renderList(); }
});

document.addEventListener('submit', (e) => {
  if (e.target.matches('.ready-form')) {
    e.preventDefault();
    finishJob(e.target, e.submitter?.value ?? 'ready');
    return;
  }
  if (e.target.id === 'kmform' || e.target.id === 'logform') {
    e.preventDefault();
    const car = cars.find((c) => c.id === e.target.dataset.id);
    const f = new FormData(e.target);
    if (e.target.id === 'kmform') {
      car.mileage = Number(f.get('km')) || 0;
      toast('Пробіг оновлено');
    } else {
      car.log = [...(car.log ?? []), {
        id: uid(), date: f.get('date'), text: f.get('text').trim(),
        km: Number(f.get('km')) || null, cost: Number(f.get('cost')) || null,
      }];
      toast('Запис додано в сервісну книжку');
    }
    store.set('cars', cars);
    route();
    return;
  }
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
    mileage: Number(f.get('mileage')) || 0,
    insuranceUntil: f.get('insuranceUntil') || null,
    log: [],
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
