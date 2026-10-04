import { CITY, CATEGORIES, CAR_CLASSES, PLACES, PAYMENT, MAINTENANCE, REFERRAL } from './data.js';
import {
  store, icon, esc, uah, pad, hhmm, toMin, isoDate, parseDate, uid, placeById, plural, duration, dayLabel, rating, tel,
  openRange, isOpenNow, hoursText, bookingStart, fmtTime, fmtDate, km, serviceCat, catById, shrinkPhoto,
  applyOverrides, ACTIVE, BLOCKING, HOUR, isCarcar, price, complete, isFrozen, placeShare, balanceFor, settleAll, ratingFor,
} from './core.js';

// ---------- сховище (лише на цьому пристрої) ----------

let cars = store.get('cars', []);
// Усі записи: клієнта (без source), внесені точкою в CRM ('crm') і демо-історія панелі ('demo').
let bookings = store.get('bookings', []).map((b) =>
  // Записи з версії без оплати: вважаємо їх оплаченими або скасованими з поверненням.
  b.state ? b : { ...b, paid: b.total, state: b.status === 'cancelled' ? 'cancelled' : 'paid' });
let payouts = store.get('payouts', []);
// Відгуки клієнтів: лише по завершених замовленнях, один на замовлення.
let reviews = store.get('reviews', []);
// «Приведи друга»: бонусний рахунок, власний код і хто запросив цього користувача.
let wallet = store.get('wallet', { bonus: 0, history: [] });
let referral = store.get('referral', null) ?? { code: newRefCode(), friends: [] };
store.set('referral', referral);

function newRefCode() {
  const abc = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // без схожих 0/O та 1/I
  return `CAR${Array.from({ length: 5 }, () => abc[Math.floor(Math.random() * abc.length)]).join('')}`;
}
let favs = new Set(store.get('favs', []));

// Записи цього клієнта — те, що він бачить у «Мої записи».
const mine = () => bookings.filter((b) => !b.source);

const ui = { cat: 'all', q: '', sort: 'rating', openNow: false, favOnly: false, cls: store.get('cls', 0), partner: store.get('partner', null) };
let draft = null; // чернетка запису: { placeId, services: Set, date, time, carId, paying }

// ---------- утиліти ----------

const $ = (sel, root = document) => root.querySelector(sel);

function minPrice(place, cat, cls) {
  const list = cat === 'all' ? place.services : place.services.filter((s) => serviceCat(s) === cat);
  return Math.min(...list.map((s) => s.price[cls]));
}

// ---------- рейтинг з відгуків ----------

const ratingOf = (placeId) => ratingFor(placeId, reviews);

const reviewsWord = (n) => plural(n, 'відгук', 'відгуки', 'відгуків');

// Рядок із пʼяти зірок; aria-label озвучує оцінку цілим реченням.
const stars = (n, size = 14) => `<span class="stars" role="img" aria-label="Оцінка ${rating(n)} з 5">${[1, 2, 3, 4, 5]
  .map((i) => `<span class="${i <= Math.round(n) ? 'on' : ''}">${icon('star', size)}</span>`).join('')}</span>`;

function ratingBadge(placeId) {
  const r = ratingOf(placeId);
  return r.count
    ? `<span class="rating">${icon('star', 14)}${rating(r.avg)}</span><span>${r.count} ${reviewsWord(r.count)}</span>`
    : '<span>Ще немає відгуків</span>';
}

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

// Вільні вікна: крок 30 хвилин. Вікно зайняте, якщо в клієнта тут уже є свій запис
// або на цей час не лишилося вільних боксів за журналом точки (записи CARCAR і з CRM).
function slotsFor(place, date, minutes) {
  const [open, close] = openRange(place);
  const now = new Date();
  const today = date === isoDate(now);
  const nowMin = now.getHours() * 60 + now.getMinutes();
  const span = (b) => [toMin(b.time), toMin(b.time) + b.minutes];
  const atPlace = bookings.filter((b) => b.placeId === place.id && b.date === date);
  const own = atPlace.filter((b) => !b.source && ACTIVE.includes(b.state)).map(span);
  const all = atPlace.filter((b) => BLOCKING.includes(b.state)).map(span);
  const slots = [];
  for (let t = open; t + minutes <= close; t += 30) {
    const overlaps = (list) => list.filter(([s, e]) => t < e && t + minutes > s).length;
    const busy =
      (today && t < nowMin + 30) ||
      overlaps(own) > 0 ||
      overlaps(all) >= place.boxes;
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

const back = (href, label) => `<a class="back" href="${href}">${icon('chevL', 22)}${esc(label)}</a>`;
const favButton = (p, withName) => `<button class="fav" data-action="fav" data-id="${p.id}" aria-pressed="${favs.has(p.id)}"
    aria-label="${favs.has(p.id) ? 'Прибрати з обраного' : 'В обране'}${withName ? `: ${esc(p.name)}` : ''}">${icon(favs.has(p.id) ? 'heartFill' : 'heart', 22)}</button>`;
const empty = (ic, text, action = '') => `<div class="empty"><div class="empty-ic">${icon(ic, 28)}</div><p>${text}</p>${action}</div>`;

// ---------- приведи друга ----------

function saveReferral() {
  store.set('wallet', wallet);
  store.set('referral', referral);
}

function addBonus(amount, text) {
  wallet.bonus += amount;
  wallet.history.unshift({ amount, text, at: Date.now() });
  saveReferral();
}

const inviteLink = () => `${location.origin}${location.pathname}?ref=${referral.code}`;

// Скільки бонусу можна списати із замовлення на суму total.
const bonusFor = (total) => (total >= REFERRAL.minOrder ? Math.min(wallet.bonus, REFERRAL.bonus, total) : 0);

// Друг відкрив застосунок за посиланням ?ref=КОД: новому користувачу — бонус на перше замовлення.
function acceptInvite() {
  const code = new URLSearchParams(location.search).get('ref');
  if (!code) return;
  history.replaceState(null, '', location.pathname + location.hash);
  const c = code.trim().toUpperCase();
  if (!/^CAR[A-Z0-9]{5}$/.test(c)) { toast('Посилання-запрошення недійсне'); return; }
  if (c === referral.code) { toast('Це ваше посилання — надішліть його другу'); return; }
  if (referral.invitedBy) { toast('Ви вже отримали бонус за запрошенням'); return; }
  if (mine().length) { toast('Бонус за запрошенням діє лише для нових користувачів'); return; }
  referral.invitedBy = c;
  addBonus(REFERRAL.bonus, 'Бонус за запрошенням друга');
  route();
  toast(`Вам нараховано ${uah(REFERRAL.bonus)} на перше замовлення`);
}

const inviteCard = () => `<a class="card link-card invite-card" href="#/invite">${icon('gift', 24)}<span>Приведи друга — по ${uah(REFERRAL.bonus)} вам і другу
    <small>${wallet.bonus ? `На бонусному рахунку: ${uah(wallet.bonus)}` : 'Бонус на наступне замовлення'}</small></span>${icon('chevR', 18)}</a>`;

function viewInvite() {
  return `<h1>Приведи друга</h1>
    <div class="invite-hero">
      <span class="invite-ic">${icon('gift', 30)}</span>
      <div><b>По ${uah(REFERRAL.bonus)} вам і другу</b>
      Друг отримає бонус на перше замовлення одразу, а ви — коли він завершить своє перше замовлення.</div>
    </div>
    <section class="card" aria-label="Ваше посилання" style="margin-top:14px">
      <div class="small muted">Ваш код</div>
      <div class="ref-code">${referral.code}</div>
      <input class="ref-link" id="ref-link" readonly value="${esc(inviteLink())}" aria-label="Посилання для друга">
      <div class="grid2">
        <button class="btn primary" data-action="share">${icon('share', 18)}Поділитися</button>
        <button class="btn" data-action="copy">${icon('copy', 18)}Скопіювати</button>
      </div>
    </section>
    <h2>Як це працює</h2>
    <ol class="how">
      <li>Надішліть посилання другу у Viber, Telegram чи Instagram.</li>
      <li>Друг відкриває CARCAR за посиланням і одразу отримує ${uah(REFERRAL.bonus)} на перше замовлення.</li>
      <li>Коли друг завершить перше замовлення, ${uah(REFERRAL.bonus)} отримаєте ви.</li>
    </ol>
    <h2>Бонусний рахунок</h2>
    <section class="card" aria-label="Бонусний рахунок">
      <div class="head"><span>Доступно</span><b class="bonus-sum">${uah(wallet.bonus)}</b></div>
      <p class="fine">Бонус списується автоматично під час оплати: до ${uah(REFERRAL.bonus)} з одного замовлення від ${uah(REFERRAL.minOrder)}. Точка отримує повну ціну. Вивести бонус на картку не можна.</p>
      ${wallet.history.length ? `<ul class="ledger">${wallet.history.map((h) => `<li><span>${esc(h.text)}<small>${fmtTime(h.at)}</small></span>
        <b class="${h.amount > 0 ? 'plus' : ''}">${h.amount > 0 ? '+' : '−'}${uah(Math.abs(h.amount))}</b></li>`).join('')}</ul>` : ''}
    </section>
    <h2>Запрошені друзі</h2>
    ${referral.friends.length
      ? `<ul class="ledger card">${referral.friends.map((f, i) => `<li><span>Друг ${i + 1}<small>Завершив перше замовлення · ${fmtTime(f.at)}</small></span><b class="plus">+${uah(REFERRAL.bonus)}</b></li>`).join('')}</ul>`
      : '<p class="muted">Поки нікого. Бонус зʼявиться, щойно друг завершить перше замовлення.</p>'}
    <button class="btn" data-action="demo-friend" style="margin-top:12px">Демо: друг завершив перше замовлення</button>
    <p class="note">Демо: у справжньому сервісі бонус нарахує сервер, коли друг завершить замовлення на своєму телефоні.</p>`;
}

// ---------- каталог ----------

function seasonBanner() {
  const m = new Date().getMonth();
  const winter = m === 9 || m === 10;
  const summer = m === 2 || m === 3;
  if (!winter && !summer) return '';
  return `<a class="banner" href="#/" data-action="cat" data-cat="tires">
    <span class="banner-ic">${icon(winter ? 'snow' : 'sun', 22)}</span>
    <span><b>Час ${winter ? 'на зимову' : 'на літню'} гуму</b>
    <span class="small">Запишіться на перевзування заздалегідь, поки немає черг</span></span>
    ${icon('chevR', 18)}
  </a>`;
}

function filteredPlaces() {
  const q = ui.q.trim().toLowerCase();
  const list = PLACES.filter((p) => {
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
    rating: (a, b) => ratingOf(b.id).avg - ratingOf(a.id).avg || ratingOf(b.id).count - ratingOf(a.id).count,
    price: (a, b) => minPrice(a, ui.cat, ui.cls) - minPrice(b, ui.cat, ui.cls),
    reviews: (a, b) => ratingOf(b.id).count - ratingOf(a.id).count,
    near: (a, b) => (ui.pos ? distTo(a) - distTo(b) : ratingOf(b.id).avg - ratingOf(a.id).avg),
  }[ui.sort];
  return list.sort(by);
}

function placeCard(p) {
  const open = isOpenNow(p);
  const cats = p.cats.map(catById);
  return `<article class="card">
    <div class="head">
      <a class="place" href="#/place/${p.id}">
        <h2 class="pc-title">${esc(p.name)}</h2>
        <div class="pc-cat">${icon(cats[0].icon, 14)}${cats.map((c) => c.name).join(' · ')}</div>
      </a>
      ${favButton(p, true)}
    </div>
    <a class="place stack" href="#/place/${p.id}" tabindex="-1">
      <div class="meta">
        ${ratingBadge(p.id)}
        <span>${esc(p.district)}, ${esc(p.address)}</span>
      </div>
      <div class="badges">
        ${ui.pos ? `<span class="badge dist">${fmtDist(distTo(p))}</span>` : ''}
        <span class="badge ${open ? 'open' : 'closed'}">${open ? 'Відчинено' : 'Зачинено'} · ${hoursText(p)}</span>
        <span class="badge">від ${uah(minPrice(p, ui.cat, ui.cls))}</span>
      </div>
    </a>
  </article>`;
}

function renderList() {
  const list = filteredPlaces();
  $('#list').innerHTML = list.length ? list.map(placeCard).join('') : empty('search', 'Нічого не знайшлося. Спробуйте змінити фільтри.');
  const where = ui.locating ? ' · визначаємо ваше місце…' : ui.sort === 'near' && ui.pos ? ` · від ${ui.posFallback ? 'центру Києва' : 'вас'}` : '';
  $('#count').textContent = `${list.length} ${plural(list.length, 'місце', 'місця', 'місць')}${where}`;
}

function viewCatalog() {
  const chip = (label, attrs, on) => `<button class="chip" ${attrs} aria-pressed="${on}">${label}</button>`;
  return `${seasonBanner()}
    <h1 class="catalog-title">Мийки, шиномонтаж, СТО й детейлінг</h1>
    <label class="search">${icon('search', 20)}
      <input id="q" type="search" placeholder="Назва, адреса або послуга" aria-label="Пошук" value="${esc(ui.q)}"></label>
    <div class="chips" role="group" aria-label="Фільтри">
      ${chip(`${icon('pin', 16)}Поруч`, 'data-action="near"', ui.sort === 'near')}
      ${chip('Усі', 'data-action="cat" data-cat="all"', ui.cat === 'all')}
      ${CATEGORIES.map((c) => chip(`${icon(c.icon, 16)}${c.name}`, `data-action="cat" data-cat="${c.id}"`, ui.cat === c.id)).join('')}
      ${chip('Відчинено зараз', 'data-action="toggle" data-key="openNow"', ui.openNow)}
      ${chip(`${icon('heart', 16)}Обране`, 'data-action="toggle" data-key="favOnly"', ui.favOnly)}
    </div>
    <div class="toolbar">
      <span class="small muted" id="count"></span>
      <span class="row">
        <select id="cls" class="pill-select" aria-label="Клас авто для цін">
          ${CAR_CLASSES.map((c, i) => `<option value="${i}" ${i === ui.cls ? 'selected' : ''}>${c}</option>`).join('')}
        </select>
        <select id="sort" class="pill-select" aria-label="Сортування">
          <option value="rating" ${ui.sort === 'rating' ? 'selected' : ''}>За рейтингом</option>
          <option value="price" ${ui.sort === 'price' ? 'selected' : ''}>Спочатку дешевші</option>
          <option value="reviews" ${ui.sort === 'reviews' ? 'selected' : ''}>За відгуками</option>
          <option value="near" ${ui.sort === 'near' ? 'selected' : ''}>Найближчі</option>
        </select>
      </span>
    </div>
    ${wallet.bonus ? `<a class="bonus-banner" href="#/invite">${icon('gift', 20)}<span>У вас ${uah(wallet.bonus)} бонусу — спишеться під час оплати замовлення від ${uah(REFERRAL.minOrder)}</span></a>` : ''}
    <div id="list" class="stack"></div>
    <div style="margin-top:14px">${inviteCard()}</div>
    <p class="note">Демо-дані: назви, номери будинків і телефони вигадані. Список місць задається у файлі data.js.</p>`;
}

// ---------- сторінка бізнесу ----------

function reviewItem(r) {
  return `<article class="review">
    <div class="head">${stars(r.stars)}<span class="small muted">${fmtDate(r.date)}</span></div>
    ${r.text ? `<p>${esc(r.text)}</p>` : ''}
    <div class="small muted">${icon('checkCircle', 14)}Підтверджений візит · ${esc(r.services)}</div>
    ${r.reply ? `<div class="reply"><b>Відповідь точки</b>${esc(r.reply.text)}</div>` : ''}
  </article>`;
}

function ratingSummary(placeId) {
  const r = ratingOf(placeId);
  if (!r.count) {
    return `<div class="rating-box empty-rating">
      <div class="rating-num">—</div>
      <p>Ще немає відгуків. Рейтинг зʼявиться після першого завершеного замовлення.</p>
    </div>`;
  }
  return `<div class="rating-box">
    <div class="rating-main">
      <div class="rating-num">${rating(r.avg)}</div>
      ${stars(r.avg, 16)}
      <div class="small muted">${r.count} ${reviewsWord(r.count)}</div>
    </div>
    <ol class="bars" aria-label="Розподіл оцінок">
      ${[5, 4, 3, 2, 1].map((n) => `<li><span>${n}</span><span class="bar"><span style="width:${(r.dist[n - 1] / r.count) * 100}%"></span></span><span class="n">${r.dist[n - 1]}</span></li>`).join('')}
    </ol>
  </div>`;
}

function viewPlace(id) {
  const p = placeById(id);
  if (!p) return viewNotFound();
  const open = isOpenNow(p);
  const maps = `${CITY.mapsSearch}${encodeURIComponent(`${CITY.name}, ${p.address}`)}`;
  const groups = CATEGORIES.map((c) => [c, p.services.filter((s) => serviceCat(s) === c.id)]).filter(([, s]) => s.length);
  const list = reviews.filter((r) => r.placeId === p.id).sort((a, b) => b.at - a.at);
  const cats = p.cats.map(catById);
  return `<div class="topbar">${back('#/', 'Усі місця')}${favButton(p, false)}</div>
    <h1>${esc(p.name)}</h1>
    <div class="pc-cat" style="margin-top:-6px">${icon(cats[0].icon, 14)}${cats.map((c) => c.name).join(' · ')}</div>
    <div class="meta lg" style="margin-top:8px">
      ${ratingBadge(p.id)}
      <span>${p.boxes} ${plural(p.boxes, 'бокс', 'бокси', 'боксів')}</span>
      ${ui.pos ? `<span>${fmtDist(distTo(p))} від ${ui.posFallback ? 'центру' : 'вас'}</span>` : ''}
    </div>
    <div class="badges lg" style="margin-top:12px">
      <span class="badge ${open ? 'open' : 'closed'}">${open ? 'Відчинено' : 'Зачинено'} · ${hoursText(p)}</span>
      ${p.tags.map((t) => `<span class="badge">${/генератор/i.test(t) ? icon('bolt', 13) : ''}${esc(t)}</span>`).join('')}
    </div>
    <div class="infobox">
      <div class="addr">${icon('pin', 18)}${esc(p.district)}, ${esc(p.address)}</div>
      <div class="grid2">
        <a class="btn" href="${tel(p)}">${icon('phone', 18)}Зателефонувати</a>
        <a class="btn" href="${maps}" target="_blank" rel="noopener">${icon('route', 18)}Маршрут</a>
      </div>
    </div>
    <nav class="jump" aria-label="Розділи сторінки"><a href="#/place/${p.id}" data-jump="services">Послуги та ціни</a><a href="#/place/${p.id}" data-jump="reviews">Відгуки${list.length ? ` (${list.length})` : ''}</a></nav>
    <h2 class="big" id="services">Послуги та ціни</h2>
    <p class="small muted" style="margin:-6px 0 0">Ціни для класу «${CAR_CLASSES[ui.cls]}». Остаточну вартість майстер підтвердить на місці.</p>
    ${groups.map(([c, items]) => `
      <h3 class="cat-label">${icon(c.icon, 15)}${c.name}</h3>
      <div class="list">
        ${items.map((s) => `<div class="item">
          <span class="name">${esc(s.name)}<small>${duration(s.min)}</small></span>
          <span class="price">${uah(s.price[ui.cls])}</span>
        </div>`).join('')}
      </div>`).join('')}
    <h2 class="big" id="reviews">Рейтинг і відгуки</h2>
    ${ratingSummary(p.id)}
    <p class="small muted">Залишити відгук можна лише після завершеного замовлення через CARCAR, тому кожен відгук — від реального клієнта.</p>
    <div class="stack">${list.map(reviewItem).join('')}</div>
    <div class="dock-space"></div>
    <div class="dock"><a class="btn primary block" href="#/book/${p.id}">Записатися онлайн</a></div>`;
}

// ---------- запис і оплата ----------

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
  return `${back(`#/place/${p.id}`, p.name)}
    <h1>Запис</h1>
    <div id="book"></div>`;
}

function renderBook() {
  const p = placeById(draft.placeId);
  const cls = draftClass();
  const chosen = p.services.filter((s) => draft.services.has(s.id));
  const minutes = chosen.reduce((a, s) => a + s.min, 0);
  const total = chosen.reduce((a, s) => a + s.price[cls], 0);
  const bonus = draft.useBonus !== false ? bonusFor(total) : 0;
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
    <div class="list">
      ${p.services.map((s) => `<label class="item">
        <input class="check" type="checkbox" data-action="svc" value="${s.id}" ${draft.services.has(s.id) ? 'checked' : ''}>
        <span class="name">${esc(s.name)}<small>${duration(s.min)}</small></span>
        <span class="price">${uah(s.price[cls])}</span>
      </label>`).join('')}
    </div>

    <h2>3. День і час</h2>
    <div class="days" role="group" aria-label="День">
      ${nextDays().map((d, i) => {
        const date = parseDate(d);
        const wd = i === 0 ? 'Сьогодні' : i === 1 ? 'Завтра' : date.toLocaleDateString('uk-UA', { weekday: 'short' });
        return `<button class="day" data-action="day" data-date="${d}" aria-pressed="${d === draft.date}">
          <span>${wd}</span><b>${date.getDate()}</b><span>${date.toLocaleDateString('uk-UA', { month: 'short' })}</span>
        </button>`;
      }).join('')}
    </div>
    ${!minutes
      ? '<p class="muted">Оберіть послуги, щоб побачити вільний час.</p>'
      : free.length
        ? `<div class="slots" role="group" aria-label="Час">${slots.map((s) => `<button class="slot" data-action="time" data-time="${s.time}"
            ${s.busy ? 'disabled aria-label="' + s.time + ', зайнято"' : ''} aria-pressed="${s.time === draft.time}">${s.time}</button>`).join('')}</div>`
        : '<p class="muted">На цей день вільного часу немає. Оберіть інший день.</p>'}
    <div class="dock-space tall"></div>

    ${draft.paying ? `<div class="sheet-dim" data-action="unpay"></div>
    <div class="sheet summary" role="dialog" aria-modal="true" aria-label="Оплата">
      <div class="handle"></div>
      <div class="sheet-total"><span>До сплати</span><b>${uah(total - bonus)}</b></div>
      ${wallet.bonus ? (bonusFor(total)
        ? `<label class="bonus-line"><input class="check" type="checkbox" id="usebonus" ${draft.useBonus !== false ? 'checked' : ''}>
            <span>Бонус «Приведи друга»<small>Вартість ${uah(total)}, точка отримає повну суму</small></span><b>−${uah(bonusFor(total))}</b></label>`
        : `<p class="small muted" style="margin:0">Бонус ${uah(wallet.bonus)} діє для замовлень від ${uah(REFERRAL.minOrder)}.</p>`) : ''}
      <ul class="perks">
        <li><span class="perk-ic ok">${icon('shield', 20)}</span>Гроші утримуються, доки роботу не виконано</li>
        <li><span class="perk-ic">${icon('cash', 20)}</span>Комісія для клієнта — 0 ₴</li>
        <li><span class="perk-ic">${icon('undo', 20)}</span>Безкоштовне скасування за ${PAYMENT.freeCancelHours} год до візиту</li>
      </ul>
      <div class="stack" style="gap:8px">
        <button class="btn primary block" data-action="pay">${icon('card', 20)}Оплатити ${uah(total - bonus)}</button>
        <button class="btn block" data-action="unpay">Назад</button>
      </div>
      <p class="demo">Демо-оплата: гроші не списуються.</p>
    </div>` : `<div class="dock summary">
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
  const bonus = draft.useBonus !== false ? bonusFor(total) : 0;
  const b = {
    id: uid(),
    placeId: p.id,
    services: chosen.map((s) => s.name),
    total,
    paid: total - bonus,
    bonus,
    minutes: chosen.reduce((a, s) => a + s.min, 0),
    date: draft.date,
    time: draft.time,
    car: car ? carLabel(car) : CAR_CLASSES[cls],
    carId: car?.id ?? null,
    state: 'paid',
    createdAt: Date.now(),
  };
  bookings.push(b);
  save();
  if (bonus) addBonus(-bonus, `Списано на замовлення: ${p.name}`);
  draft = null;
  location.hash = `#/bookings/${b.id}`;
  toast('Оплачено, ви записані');
}

// ---------- оплата й утримання коштів ----------

function save() {
  return store.set('bookings', bookings) && store.set('payouts', payouts) && store.set('reviews', reviews);
}

function settle() {
  if (settleAll(bookings)) save();
}

const balanceOf = (placeId) => balanceFor(placeId, bookings, payouts);

function cancelTerms(b) {
  const free = bookingStart(b) - Date.now() >= PAYMENT.freeCancelHours * HOUR;
  const placeAmount = free ? 0 : Math.round(b.paid * PAYMENT.lateCancelShare);
  return { free, placeAmount, refund: b.paid - placeAmount };
}

function steps(b) {
  const at = b.state === 'completed' && isFrozen(b) ? 1 : { paid: 0, done: 1, dispute: 1, completed: 2 }[b.state];
  if (at === undefined) return '';
  return `<ol class="steps" aria-label="Статус оплати">${['Оплачено', 'Виконано', 'Гроші точці']
    .map((s, i) => `<li class="${i <= at ? 'on' : ''}" ${i === at ? 'aria-current="step"' : ''}>${s}</li>`).join('')}</ol>`;
}

// [клас кольору статусу, підпис]
const STATE_LABEL = {
  paid: ['go', 'Оплачено · гроші утримуються'],
  done: ['go', 'Чекає вашого підтвердження'],
  dispute: ['warn', 'Спір розглядається'],
  completed: ['', 'Виконано'],
  cancelled: ['', 'Скасовано'],
  noshow: ['', 'Неявка'],
  refunded: ['', 'Гроші повернено'],
};

const cardHead = (b, title, sm, amount = b.paid) => {
  const [cls, label] = isFrozen(b) ? ['go', 'Виконано · гроші заморожені'] : STATE_LABEL[b.state];
  return `<div class="head">
      <div><div class="bk-status ${cls}">${label}</div><h3 class="bk-title${sm ? ' sm' : ''}">${title}</h3></div>
      <div class="bk-price">${uah(amount)}</div>
    </div>`;
};

// Фото, коментар і пробіг, які точка додала, коли машина була готова.
function result(b) {
  if (!b.photos?.length && !b.note && !b.km) return '';
  return `${b.photos?.length ? `<div class="photos">${b.photos.map((src, i) => `<img src="${esc(src)}" alt="Фото результату ${i + 1}">`).join('')}</div>` : ''}
    ${b.note || b.km ? `<div class="facts">
      ${b.note ? `<div class="il">${icon('chat', 18)}${esc(b.note)}</div>` : ''}
      ${b.km ? `<div class="il muted">${icon('gauge', 18)}Пробіг: ${km(b.km)}</div>` : ''}
    </div>` : ''}`;
}

// Відгук після завершеного замовлення: форма з оцінкою або вже залишений відгук.
function reviewBlock(b) {
  const mine = reviews.find((r) => r.bookingId === b.id);
  if (mine) {
    return `<div class="my-review"><div class="head"><b>Ваш відгук</b>${stars(mine.stars)}</div>${mine.text ? `<p>${esc(mine.text)}</p>` : ''}
      <a href="#/invite">Сподобалось? Приведіть друга — по ${uah(REFERRAL.bonus)} обом</a></div>`;
  }
  return `<form class="review-form" data-id="${b.id}">
    <fieldset class="star-input">
      <legend>Оцініть візит</legend>
      ${[1, 2, 3, 4, 5].map((n) => `<label><input class="sr-only" type="radio" name="stars" value="${n}" required>
        <span aria-hidden="true">${icon('star', 30)}</span><span class="sr-only">${n} з 5</span></label>`).join('')}
    </fieldset>
    <label class="field"><span>Відгук (необовʼязково)</span><textarea name="text" rows="3" maxlength="600" placeholder="Що сподобалось, що варто покращити"></textarea></label>
    <button class="btn primary block" type="submit">Надіслати відгук</button>
  </form>`;
}

function bookingCard(b, highlight) {
  const p = placeById(b.placeId);
  const when = `${dayLabel(b.date)}, ${b.time}–${hhmm(toMin(b.time) + b.minutes)}`;
  const lines = `<div class="lines">
      <div class="il strong">${icon('calendar', 18)}${when}</div>
      <div class="il">${icon('carSide', 18)}${esc(b.car)}</div>
      ${p ? `<div class="il">${icon('pin', 18)}${esc(p.address)}</div>` : ''}
      <div class="svc">${b.services.map(esc).join(', ')}</div>
      ${b.bonus ? `<div class="il">${icon('gift', 18)}Оплачено ${uah(b.paid)} + бонус ${uah(b.bonus)}</div>` : ''}
    </div>`;
  let body = lines;
  const started = bookingStart(b) <= new Date();
  const confirmBtns = (label) => `<div class="grid2">
      <button class="btn primary" data-action="client-ok" data-id="${b.id}">${icon('check', 18)}${label}</button>
      <button class="btn line-danger" data-action="dispute" data-id="${b.id}">Відкрити спір</button>
    </div>`;
  if (b.state === 'paid') {
    const t = cancelTerms(b);
    body += `${b.extra ? `<div class="notice">
        <b>Майстер пропонує доплату +${uah(b.extra.amount)}</b>${esc(b.extra.reason)}
        <div class="grid2" style="margin-top:10px">
          <button class="btn primary" data-action="extra-ok" data-id="${b.id}">Погодитися й доплатити</button>
          <button class="btn" data-action="extra-no" data-id="${b.id}">Відхилити</button>
        </div></div>` : ''}
      ${started ? `<div class="notice">Коли заберете авто, підтвердьте виконання — точка отримає підтвердження автоматично.
        Гроші будуть заморожені ще ${PAYMENT.freezeHours} год, і весь цей час можна відкрити спір.</div>
        ${confirmBtns('Підтвердити виконання')}
        ${p ? `<a class="btn" href="${tel(p)}">${icon('phone', 18)}Зателефонувати</a>` : ''}`
      : `<div class="notice ic-row">${icon('shield', 18)}Гроші утримуються, доки ви не підтвердите виконання. Після візиту тут зʼявиться кнопка «Підтвердити виконання».</div>
      <div class="grid2">
        <button class="btn" data-action="ics" data-id="${b.id}">${icon('calendar', 18)}У календар</button>
        ${p ? `<a class="btn" href="${tel(p)}">${icon('phone', 18)}Зателефонувати</a>` : ''}
        <button class="btn text-danger full" data-action="cancel" data-id="${b.id}">Скасувати</button>
      </div>
      <p class="terms">${t.free
        ? `Безкоштовне скасування до ${fmtTime(bookingStart(b) - PAYMENT.freeCancelHours * HOUR)}.`
        : `Пізнє скасування: повернемо ${uah(t.refund)}, ${uah(t.placeAmount)} отримає точка.`}</p>`}`;
  } else if (b.state === 'done') {
    body = `<div class="lines tight">
        <div class="il strong">${when}</div>
        <div>${esc(b.car)} · ${b.services.map(esc).join(', ')}</div>
      </div>
      <div class="notice ok">${icon('checkCircle', 22)}<div><b>Машина готова!</b>Перевірте результат і підтвердіть або відкрийте спір до
        ${fmtTime(b.doneAt + PAYMENT.autoReleaseHours * HOUR)}, інакше замовлення підтвердиться автоматично.</div></div>
      ${result(b)}
      ${confirmBtns('Усе добре')}`;
  } else if (b.state === 'dispute') {
    body += `<div class="notice warn"><div class="label">Ваша скарга</div>«${esc(b.disputeReason)}». Модератор перевірить і вирішить, кому передати гроші.</div>${result(b)}`;
  } else if (b.state === 'completed') {
    body += result(b);
    if (isFrozen(b)) {
      body += `<div class="notice">Гроші точці заморожені до ${fmtTime(b.unfreezeAt)}. Якщо щось не так — ще можна відкрити спір.</div>
        <button class="btn line-danger" data-action="dispute" data-id="${b.id}">Відкрити спір</button>`;
    }
    body += reviewBlock(b);
  } else {
    body += `<p class="small muted" style="margin:0">Повернено ${uah(b.refund ?? b.paid)} на картку${b.bonusReturned ? ` і ${uah(b.bonus)} на бонусний рахунок` : ''}${b.placeAmount ? `, ${uah(b.placeAmount)} отримала точка` : ''}.</p>`;
  }
  return `<article class="bk${highlight ? ' hl' : ''}" id="b-${b.id}">
    ${cardHead(b, esc(p?.name ?? 'Сервіс'))}
    ${steps(b)}
    ${body}
    ${!ACTIVE.includes(b.state) && p ? `<a class="btn" href="#/book/${p.id}" data-action="repeat" data-id="${b.id}">${icon('repeat', 18)}Записатися знову</a>` : ''}
  </article>`;
}

function viewBookings(highlightId) {
  const list = mine();
  const sorted = [...list].sort((a, b) => bookingStart(a) - bookingStart(b));
  const active = sorted.filter((b) => ACTIVE.includes(b.state));
  const rest = sorted.filter((b) => !ACTIVE.includes(b.state)).reverse();
  if (!list.length) {
    return `<h1>Мої записи</h1>${empty('calendar', 'Записів поки немає.', '<a class="btn primary" href="#/">Знайти мийку або сервіс</a>')}${inviteCard()}`;
  }
  return `<h1>Мої записи</h1>
    ${inviteCard()}
    <h2>Активні</h2>
    <div class="stack">${active.length ? active.map((b) => bookingCard(b, b.id === highlightId)).join('') : '<p class="muted">Немає активних записів.</p>'}</div>
    ${rest.length ? `<h2>Історія</h2><div class="stack">${rest.map((b) => bookingCard(b, b.id === highlightId)).join('')}</div>` : ''}`;
}

// ---------- кабінет точки ----------

function partnerRow(b) {
  const [cls, label] = isFrozen(b) ? ['go', 'Підтверджено · гроші заморожені'] : STATE_LABEL[b.state];
  return `<a class="card prow" href="#/partner/${b.id}">
    <div><div class="bk-status ${cls}">${label}</div>
      <h3>${dayLabel(b.date, { day: 'numeric', month: 'short' })}, ${b.time} · ${esc(b.car)}</h3>
      <div class="small muted" style="margin-top:2px">${b.services.map(esc).join(', ')}</div></div>
    <span class="price">${uah(ACTIVE.includes(b.state) || isFrozen(b) ? price(b) : placeShare(b))}</span>
  </a>`;
}

function viewPartner() {
  if (!placeById(ui.partner)) ui.partner = PLACES[0].id;
  const p = placeById(ui.partner);
  const own = bookings.filter((b) => b.placeId === p.id && isCarcar(b)).sort((a, b) => bookingStart(a) - bookingStart(b));
  const active = own.filter((b) => ACTIVE.includes(b.state));
  const rest = own.filter((b) => !ACTIVE.includes(b.state)).reverse();
  const bal = balanceOf(p.id);
  const fee = Math.round(bal.available * PAYMENT.commission);
  const history = payouts.filter((x) => x.placeId === p.id).reverse();
  const disputes = bookings.filter((b) => b.state === 'dispute').length;
  return `<h1>Кабінет точки</h1>
    <a class="card link-card" href="business.html" style="margin-bottom:12px">${icon('chart', 22)}<span>Повна панель для бізнесу
      <small class="small muted" style="display:block;font-weight:400">Журнал по боксах, клієнти, прайс, фінанси й аналітика — зручно з компʼютера</small></span>${icon('chevR', 18)}</a>
    <label class="field"><span>Точка</span><select id="partner-place">
      ${PLACES.map((x) => `<option value="${x.id}" ${x.id === p.id ? 'selected' : ''}>${esc(x.name)}</option>`).join('')}
    </select></label>
    <section class="card balance-card" aria-label="Баланс" style="margin-top:12px">
      <div class="tiles">
        <div class="tile ok"><span>Доступно до виведення</span><b>${uah(bal.available)}</b></div>
        <div class="tile"><span>Заморожено</span><b>${uah(bal.frozen)}</b></div>
      </div>
      <button class="btn primary block" data-action="payout" ${bal.available > 0 ? '' : 'disabled'}>
        ${icon('card', 20)}${bal.available > 0 ? `Вивести ${uah(bal.available - fee)} на картку` : 'Немає коштів для виведення'}
      </button>
      <p class="fine">Гроші за замовлення заморожені, доки клієнт не підтвердить виконання, і ще ${PAYMENT.freezeHours} год після цього.${bal.next ? ` Найближче розморожування: ${uah(price(bal.next))} — ${fmtTime(bal.next.unfreezeAt)}.` : ''}
        Комісія сервісу ${Math.round(PAYMENT.commission * 100)}% утримується лише під час виведення${bal.available > 0 ? `: ${uah(fee)}` : ''}. Для клієнтів комісії немає.</p>
    </section>
    <a class="card link-card" href="#/place/${p.id}" style="margin-top:12px">${icon('star', 22)}<span>Сторінка точки й відгуки<small class="small muted" style="display:block;font-weight:400">${ratingOf(p.id).count ? `Рейтинг ${rating(ratingOf(p.id).avg)} · ${ratingOf(p.id).count} ${reviewsWord(ratingOf(p.id).count)}` : 'Ще немає відгуків'}</small></span>${icon('chevR', 18)}</a>
    <h2>Активні записи</h2>
    <div class="stack">${active.length ? active.map(partnerRow).join('') : '<p class="muted">Активних записів немає.</p>'}</div>
    ${rest.length ? `<h2>Завершені</h2><div class="stack">${rest.map(partnerRow).join('')}</div>` : ''}
    ${history.length ? `<h2>Виплати</h2><div class="card">${history.map((x) => `<div class="head small">
        <span>${fmtTime(x.at)}</span><span>${uah(x.net)} <span class="muted">(комісія ${uah(x.fee)})</span></span></div>`).join('')}</div>` : ''}
    <h2>Для модератора</h2>
    <a class="card link-card" href="#/disputes">${icon('scale', 22)}<span>Модерація спорів</span>
      ${disputes ? `<span class="count">${disputes}</span>` : ''}${icon('chevR', 18)}</a>
    <p class="note">Демо: записи, баланс і виплати зберігаються на цьому пристрої, тож клієнта й точку можна перевірити на одному телефоні.</p>`;
}

// Запис у кабінеті: фото результату, пробіг, код клієнта й дії майстра.
function viewPartnerJob(id) {
  const b = bookings.find((x) => x.id === id);
  if (!b) return viewNotFound();
  const started = bookingStart(b) <= new Date();
  let body = '';
  if (b.state === 'paid') {
    body = `<form class="ready-form stack" data-id="${b.id}" style="gap:14px">
        <label class="dropzone">${icon('camera', 24)}Додати фото результату (до 3)
          <span class="photo-count" aria-live="polite"></span>
          <input class="sr-only" name="photos" type="file" accept="image/*" capture="environment" multiple></label>
        <label class="field"><span>Пробіг, км</span><input name="km" type="number" inputmode="numeric" min="0" autocomplete="off"></label>
        <label class="field"><span>Коментар для клієнта</span><input name="note" autocomplete="off" placeholder="Наприклад, старі колодки в багажнику"></label>
        <button class="btn primary block" type="submit">Машина готова</button>
        <p class="fine">Клієнт отримає сповіщення й підтвердить виконання у своєму застосунку — тоді замовлення підтвердиться тут автоматично.</p>
      </form>
      ${b.extra ? `<p class="small muted" style="margin:0">Запит на доплату +${uah(b.extra.amount)} чекає відповіді клієнта.</p>` : ''}
      ${b.extraDeclined ? '<p class="small muted" style="margin:0">Клієнт відхилив доплату.</p>' : ''}
      <div class="row divider">
        ${b.extra ? '' : `<button class="btn soft" data-action="extra" data-id="${b.id}">${icon('plus', 16)}Доплата</button>`}
        ${started ? `<button class="btn text-danger" data-action="noshow" data-id="${b.id}">Клієнт не приїхав</button>` : ''}
      </div>`;
  } else if (b.state === 'done') {
    body = `<p class="small muted" style="margin:0">Чекаємо підтвердження клієнта. Якщо він не відповість, замовлення підтвердиться автоматично ${fmtTime(b.doneAt + PAYMENT.autoReleaseHours * HOUR)}.</p>${result(b)}`;
  } else if (isFrozen(b)) {
    body = `<div class="notice ok">${icon('checkCircle', 22)}<div><b>Клієнт підтвердив виконання</b>${uah(price(b))} заморожено до ${fmtTime(b.unfreezeAt)}, потім їх можна вивести.</div></div>${result(b)}`;
  } else if (b.state === 'dispute') {
    body = `<div class="notice warn"><div class="label">Скарга клієнта</div>«${esc(b.disputeReason)}»</div>`;
  } else {
    body = result(b);
  }
  return `${back('#/partner', 'Кабінет точки')}
    <h1>Запис клієнта</h1>
    <article class="bk">
      ${cardHead(b, `${dayLabel(b.date, { day: 'numeric', month: 'short' })}, ${b.time} · ${esc(b.car)}`, true, price(b)).replace('<h3', '<h2').replace('</h3>', '</h2>')}
      <div class="small muted" style="font-size:14px">${b.services.map(esc).join(', ')}</div>
      ${body}
    </article>`;
}

function viewDisputes() {
  const list = bookings.filter((b) => b.state === 'dispute');
  return `${back('#/partner', 'Кабінет точки')}
    <h1>Модерація спорів</h1>
    <p class="lead">У справжньому сервісі цей розділ бачить лише модератор платформи.</p>
    <div class="stack">${list.length ? list.map((b) => `<article class="bk">
        ${cardHead(b, esc(placeById(b.placeId)?.name ?? ''), true, price(b)).replace('<h3', '<h2').replace('</h3>', '</h2>')}
        <div class="notice warn"><div class="label">Скарга клієнта</div><span style="font-size:15px">«${esc(b.disputeReason)}»</span></div>
        <div class="grid2">
          <button class="btn" data-action="resolve-client" data-id="${b.id}">Повернути клієнту</button>
          <button class="btn" data-action="resolve-place" data-id="${b.id}">Передати точці</button>
        </div></article>`).join('') : empty('scale', 'Відкритих спорів немає.')}</div>`;
}

// ---------- гараж і сервісна книжка ----------

// Історія авто: завершені записи в CARCAR плюс записи, додані вручну.
function historyOf(car) {
  const fromApp = bookings
    .filter((b) => b.carId === car.id && b.state === 'completed')
    .map((b) => ({ date: b.date, km: b.km, text: b.services.join(', '), cost: price(b), place: placeById(b.placeId)?.name, photos: b.photos, note: b.note }));
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
    ${icon(r.level === 'due' ? 'warn' : r.level === 'ok' ? 'checkCircle' : 'info', 18)}
    <span>${esc(r.text)}</span>
    ${r.cat ? `<a class="btn navy" href="#/" data-action="cat" data-cat="${r.cat}">Записатися</a>` : ''}
  </div>`;

function carForm(id, fields, submit) {
  return `<form class="form-box" id="${id}">${fields}<button class="btn primary block" type="submit">${submit}</button></form>`;
}

function viewGarage() {
  return `<h1>Гараж</h1>
    <p class="lead">Сервісна книжка кожного авто: історія обслуговування, пробіг і нагадування.</p>
    <div class="stack">
      ${cars.map((c) => {
        const due = reminders(c).filter((r) => r.level === 'due');
        return `<a class="card car-card" href="#/garage/${c.id}">
          <div class="car-top"><span class="car-tile">${icon('car', 26)}</span>
            <div><h2 class="car-name">${esc(c.make)} ${esc(c.model)}</h2>
            <div class="car-sub">${[c.plate, CAR_CLASSES[c.cls], currentKm(c) ? km(currentKm(c)) : ''].filter(Boolean).map(esc).join(' · ')}</div></div></div>
          ${due.length ? `<div class="warn-pill">${icon('warn', 16)}${esc(due[0].text)}${due.length > 1 ? ` і ще ${due.length - 1}` : ''}</div>` : ''}
          <div class="card-foot">Сервісна книжка${icon('chevR', 18)}</div>
        </a>`;
      }).join('')}
    </div>
    <h2 class="big">${cars.length ? 'Додати ще авто' : 'Додати авто'}</h2>
    ${carForm('carform', `
      <label class="field"><span>Марка</span><input name="make" required placeholder="Наприклад, Skoda" autocomplete="off"></label>
      <label class="field"><span>Модель</span><input name="model" required placeholder="Наприклад, Octavia" autocomplete="off"></label>
      <label class="field"><span>Держномер (необовʼязково)</span><input name="plate" placeholder="AA1234BB" autocomplete="off"></label>
      <label class="field"><span>Клас</span><select name="cls">${CAR_CLASSES.map((c, i) => `<option value="${i}">${c}</option>`).join('')}</select></label>
      <label class="field"><span>Пробіг, км (необовʼязково)</span><input name="mileage" type="number" inputmode="numeric" min="0" autocomplete="off"></label>
      <label class="field"><span>Розмір шин (необовʼязково)</span><input name="tires" placeholder="205/55 R16" autocomplete="off"></label>
      <label class="field"><span>Поліс ОСЦПВ дійсний до (необовʼязково)</span><input name="insuranceUntil" type="date"></label>`, 'Зберегти')}`;
}

function viewCar(id) {
  const c = cars.find((x) => x.id === id);
  if (!c) return viewNotFound();
  const history = historyOf(c);
  return `${back('#/garage', 'Гараж')}
    <h1 style="margin-bottom:2px">${esc(c.make)} ${esc(c.model)}</h1>
    <div class="car-sub">${[c.plate, CAR_CLASSES[c.cls], c.tires && `шини ${c.tires}`].filter(Boolean).map(esc).join(' · ')}</div>
    <h2>Нагадування</h2>
    <div class="stack">${reminders(c).map(reminderRow).join('')}</div>
    <h2>Пробіг</h2>
    <form class="inline-form" id="kmform" data-id="${c.id}">
      <label class="field"><span>Поточний пробіг, км</span>
        <input name="km" type="number" inputmode="numeric" min="0" value="${currentKm(c) || ''}" autocomplete="off"></label>
      <button class="btn" type="submit">Оновити</button>
    </form>
    <h2>Історія обслуговування</h2>
    <div class="card history">
      ${history.length ? history.map((h) => `<div class="log-item">
        <div class="log-head"><span>${fmtDate(h.date)}</span>${h.cost ? `<span>${uah(h.cost)}</span>` : ''}</div>
        <div>${esc(h.text)}</div>
        ${h.place || h.km ? `<div class="log-meta">${[h.place, h.km && km(h.km)].filter(Boolean).map(esc).join(' · ')}</div>` : ''}
        ${h.note ? `<div class="facts"><div class="il">${icon('chat', 18)}${esc(h.note)}</div></div>` : ''}
        ${h.photos?.length ? `<div class="thumbs">${h.photos.map((src, i) => `<img src="${esc(src)}" alt="Фото ${i + 1}">`).join('')}</div>` : ''}
      </div>`).join('') : '<p class="muted" style="margin:0">Тут зʼявляться всі візити через CARCAR. Роботи в інших сервісах можна додати вручну.</p>'}
    </div>
    <h2>Додати запис вручну</h2>
    ${carForm('logform', `
      <label class="field"><span>Дата</span><input name="date" type="date" required value="${isoDate(new Date())}"></label>
      <label class="field"><span>Що зроблено</span><input name="text" required placeholder="Наприклад, заміна оливи та фільтра" autocomplete="off"></label>
      <label class="field"><span>Пробіг, км (необовʼязково)</span><input name="km" type="number" inputmode="numeric" min="0" autocomplete="off"></label>
      <label class="field"><span>Сума, ₴ (необовʼязково)</span><input name="cost" type="number" inputmode="numeric" min="0" autocomplete="off"></label>`, 'Додати в книжку').replace('<form class="form-box" id="logform">', `<form class="form-box" id="logform" data-id="${c.id}">`)}
    <button class="btn text-danger" data-action="delcar" data-id="${c.id}" style="margin-top:16px">Видалити авто</button>`;
}

function viewNotFound() {
  return empty('search', 'Сторінку не знайдено.', '<a class="btn" href="#/">На головну</a>');
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

// «Машина готова»: точка додає фото, пробіг і коментар, а клієнт отримує сповіщення
// й підтверджує виконання. Після цього повертаємось у кабінет.
async function finishJob(form) {
  const b = bookings.find((x) => x.id === form.dataset.id);
  const f = new FormData(form);
  const files = f.getAll('photos').filter((x) => x.size).slice(0, 3);
  const photos = (await Promise.all(files.map(shrinkPhoto))).filter(Boolean);
  Object.assign(b, { photos, note: f.get('note').trim() || null, km: Number(f.get('km')) || null, state: 'done', doneAt: Date.now() });
  const dropped = !save() && photos.length > 0;
  if (dropped) { b.photos = []; save(); }
  location.hash = '#/partner';
  toast(dropped ? 'Фото не вмістилися в памʼять пристрою, запис збережено без них' : 'Клієнт отримав сповіщення «Машина готова»');
}

// Бонус зі скасованого чи поверненого замовлення повертається на бонусний рахунок.
function returnBonus(b, why) {
  if (!b.bonus || b.bonusReturned) return;
  b.bonusReturned = true;
  addBonus(b.bonus, `Повернення бонусу: ${why}`);
}

// Дії із записом з боку клієнта, точки й модератора. Повертають false, якщо нічого не змінилося.
const bookingActions = {
  cancel(b) {
    const t = cancelTerms(b);
    const msg = t.free ? `Скасувати запис? Повернемо ${uah(t.refund)}.` : `Скасувати запис? Повернемо ${uah(t.refund)}, ${uah(t.placeAmount)} отримає точка за пізнє скасування.`;
    if (!confirm(msg)) return false;
    Object.assign(b, { state: 'cancelled', refund: t.refund, placeAmount: t.placeAmount });
    returnBonus(b, 'скасоване замовлення');
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
    complete(b);
    toast('Дякуємо! Виконання підтверджено');
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
    location.hash = '#/partner';
  },
  'resolve-client'(b) {
    Object.assign(b, { state: 'refunded', refund: b.paid, placeAmount: 0 });
    returnBonus(b, 'повернення за спором');
    toast('Гроші повернено клієнту');
  },
  'resolve-place'(b) {
    // Модератор уже перевірив замовлення, тож гроші доступні точці одразу.
    complete(b);
    b.unfreezeAt = Date.now();
    toast('Гроші передано точці');
  },
};

// ---------- роутер і події ----------

function route() {
  const [, page = '', arg] = location.hash.replace(/^#/, '').split('/');
  const view = $('#view');
  const tab = page === 'disputes' ? 'partner' : page === 'invite' ? '' : ['bookings', 'garage', 'partner'].includes(page) ? page : 'catalog';
  settle();
  // Крапка на вкладці «Мої записи», коли машина готова або точка просить доплату.
  const ready = mine().some((b) => b.state === 'done' || b.extra);
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
  else if (page === 'partner') view.innerHTML = arg ? viewPartnerJob(arg) : viewPartner();
  else if (page === 'disputes') view.innerHTML = viewDisputes();
  else if (page === 'invite') view.innerHTML = viewInvite();
  else view.innerHTML = viewNotFound();

  const target = arg && page === 'bookings' ? $(`#b-${arg}`) : null;
  if (target) target.scrollIntoView({ block: 'center' });
  else window.scrollTo(0, 0);
}

document.addEventListener('click', (e) => {
  // Переходи всередині сторінки бізнесу: хеш зайнятий роутером, тож прокручуємо самі.
  const jump = e.target.closest('[data-jump]');
  if (jump) {
    e.preventDefault();
    document.getElementById(jump.dataset.jump)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    return;
  }
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
    el.innerHTML = icon(on ? 'heartFill' : 'heart', 22);
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
    $(draft.paying ? '[data-action="pay"]' : '[data-action="confirm"]')?.focus();
  } else if (action === 'pay') {
    confirmBooking();
  } else if (action === 'share' || action === 'copy') {
    const url = inviteLink();
    const copy = () => navigator.clipboard.writeText(url)
      .then(() => toast('Посилання скопійовано'))
      .catch(() => { $('#ref-link')?.select(); toast('Скопіюйте посилання вручну'); });
    if (action === 'share' && navigator.share) {
      navigator.share({ title: 'CARCAR', text: `Записуйся на мийку, шиномонтаж чи СТО через CARCAR — ${uah(REFERRAL.bonus)} на перше замовлення`, url }).catch(() => {});
    } else {
      copy();
    }
  } else if (action === 'demo-friend') {
    referral.friends.push({ at: Date.now() });
    addBonus(REFERRAL.bonus, 'Друг завершив перше замовлення');
    route();
    toast(`Вам нараховано ${uah(REFERRAL.bonus)}`);
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
  } else if (t.id === 'usebonus') {
    draft.useBonus = t.checked;
    renderBook();
    $('#usebonus')?.focus();
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
    finishJob(e.target);
    return;
  }
  if (e.target.matches('.review-form')) {
    e.preventDefault();
    const b = bookings.find((x) => x.id === e.target.dataset.id);
    const f = new FormData(e.target);
    reviews.push({
      id: uid(), placeId: b.placeId, bookingId: b.id, stars: Number(f.get('stars')),
      text: f.get('text').trim(), services: b.services.join(', '), date: isoDate(new Date()), at: Date.now(),
    });
    save();
    route();
    toast('Дякуємо за відгук!');
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

$('#city').innerHTML = `${icon('pin', 18)}${esc(CITY.name)}`;
window.addEventListener('hashchange', route);
// Панель для бізнесу в іншій вкладці змінила записи, прайс чи години — перечитуємо й перемальовуємо.
window.addEventListener('storage', (e) => {
  if (!e.key?.startsWith('carcar.')) return;
  bookings = store.get('bookings', []);
  payouts = store.get('payouts', []);
  reviews = store.get('reviews', []);
  applyOverrides();
  if (!draft?.paying) route();
});
route();
acceptInvite();

if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
