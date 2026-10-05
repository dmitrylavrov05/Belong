import { CITY, CATEGORIES, CAR_CLASSES, PLACES, PAYMENT, MAINTENANCE, REFERRAL } from './data.js';
import {
  store, icon, esc, uah, pad, hhmm, toMin, isoDate, parseDate, uid, placeById, plural, duration, dayLabel, rating, tel,
  hoursFor, scheduleOf, inBreak, rangeText, WEEKDAY_NAMES, weekdayOf, phoneKey, offersOf, offerAsService, isOpenNow, hoursText, bookingStart, fmtTime, fmtDate, km, serviceCat, catById, shrinkPhoto,
  applyOverrides, isListed, payoutReady, maskIban, commissionFor, resolveDispute, visibleReviews, ACTIVE, BLOCKING, HOUR, isCarcar, price, complete, isFrozen, placeShare, balanceFor, settleAll, ratingFor,
  POWER, powerOf, worksInBlackout,
} from './core.js';
import {
  CHANNELS, inboxFor, markRead, dealsOf, dealAt, dealPrice, dealCovers, hotDeals, queueOf, queueEnabled, saveQueue, queueEstimate,
  checkWaitlist, openStarts, passesOf, sellPass, passActive, passLeft, usableSubs, findCert, redeemPass, restorePass,
  SEASONS, myTires, tireDue, seasonDue,
} from './ops.js';

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
// money — баланс CARCAR: повернення за скасовані записи, ним можна оплатити наступне замовлення.
let wallet = { bonus: 0, money: 0, history: [], ...store.get('wallet', {}) };
// Запити до точок: «не знайшов послугу» — листування з точкою.
let requests = store.get('requests', []);
let referral = store.get('referral', null) ?? { code: newRefCode(), friends: [] };
store.set('referral', referral);

function newRefCode() {
  const abc = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // без схожих 0/O та 1/I
  return `CAR${Array.from({ length: 5 }, () => abc[Math.floor(Math.random() * abc.length)]).join('')}`;
}
let favs = new Set(store.get('favs', []));
// Профіль клієнта: імʼя й телефон бачить точка; за телефоном вона показує персональні ціни.
let profile = { name: '', phone: '', optIn: false, ...store.get('profile', {}) };

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
const partnerIban = (placeId) => maskIban(store.get('partners', {})[placeId]?.payout?.iban ?? '');
const pctText = (k) => `${(k * 100).toLocaleString('uk-UA', { maximumFractionDigits: 1 })}%`;

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

// Вільні вікна за графіком точки, крок 30 хвилин. Вікно зайняте, якщо до нього менше
// мінімального часу запису, воно потрапляє на перерву, у клієнта тут уже є свій запис
// або на цей час не лишилося вільних боксів за журналом точки (записи CARCAR і з CRM).
function slotsFor(place, date, minutes) {
  const hours = hoursFor(place, date);
  if (!hours) return [];
  const [open, close] = hours;
  const { lead } = scheduleOf(place);
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
      (today && t < nowMin + lead) ||
      inBreak(place, t, minutes) ||
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

// Дні, на які можна записатися, — на стільки вперед, скільки дозволяє точка.
const bookingDays = (p) => nextDays(scheduleOf(p).horizon);
const firstOpenDay = (p) => bookingDays(p).find((d) => hoursFor(p, d)) ?? bookingDays(p)[0];

// Ключі, за якими точка знає цього клієнта: телефон із профілю й авто з гаража.
const myKeys = () => [phoneKey(profile.phone), ...cars.map((c) => `car:${carLabel(c)}`)].filter(Boolean);
const personalFor = (p) => offersOf(p.id).filter((o) => myKeys().includes(o.clientKey)).map(offerAsService);
// Усе, що клієнт може замовити в точці: спершу персональні послуги, далі прайс.
const bookable = (p) => [...personalFor(p), ...p.services];

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

function addMoney(amount, text) {
  wallet.money += amount;
  wallet.history.unshift({ amount, text, at: Date.now(), kind: 'money' });
  saveReferral();
}

const cancelWindow = () => duration(Math.round(PAYMENT.freeCancelHours * 60));

// Баланс CARCAR: повернення за скасовані записи. Списується під час оплати, можна вивести на картку.
const moneyCard = () => (wallet.money > 0 || wallet.history.some((h) => h.kind === 'money') ? `<section class="card balance-card" aria-label="Баланс CARCAR">
    <div class="head"><span>Баланс CARCAR</span><b class="bonus-sum">${uah(wallet.money)}</b></div>
    <p class="fine">Сюди повертаються гроші за вчасно скасовані записи. Баланс списується автоматично під час наступної оплати, або його можна вивести на картку.</p>
    ${wallet.money > 0 ? `<button class="btn" data-action="money-out">${icon('card', 18)}Вивести ${uah(wallet.money)} на картку</button>` : ''}
    <ul class="ledger">${wallet.history.filter((h) => h.kind === 'money').slice(0, 5).map((h) => `<li><span>${esc(h.text)}<small>${fmtTime(h.at)}</small></span>
      <b class="${h.amount > 0 ? 'plus' : ''}">${h.amount > 0 ? '+' : '−'}${uah(Math.abs(h.amount))}</b></li>`).join('')}</ul>
  </section>` : '');

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
      ${wallet.history.some((h) => h.kind !== 'money') ? `<ul class="ledger">${wallet.history.filter((h) => h.kind !== 'money').map((h) => `<li><span>${esc(h.text)}<small>${fmtTime(h.at)}</small></span>
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
    if (!isListed(p)) return false;
    if (ui.blackout && !worksInBlackout(p)) return false;
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
        ${powerBadge(p)}
        ${dealsOf(p.id).length ? `<span class="badge deal">${icon('bolt', 13)}−${Math.max(...dealsOf(p.id).map((d) => d.pct))}% у гарячі вікна</span>` : ''}
      </div>
    </a>
  </article>`;
}

// Статус світла від самої точки: показуємо, лише поки позначка свіжа.
const POWER_SHORT = { grid: 'Світло є', generator: 'Працює від генератора', closed: 'Немає світла — не працює' };
function powerBadge(p) {
  const pw = powerOf(p.id);
  if (!pw) return '';
  return `<span class="badge ${pw.state === 'closed' ? 'closed' : 'open'} power">${icon('bolt', 13)}${POWER_SHORT[pw.state]} · ${new Date(pw.at).toLocaleTimeString('uk-UA', { hour: '2-digit', minute: '2-digit' })}</span>`;
}

// Гарячі вікна на головній: знижки точок на сьогодні й завтра, де ще є вільний час.
function hotBlock() {
  const list = hotDeals(bookings).slice(0, 6);
  if (!list.length) return '';
  const when = (d) => (d === isoDate(new Date()) ? 'Сьогодні' : 'Завтра');
  return `<section class="hot" aria-labelledby="h-hot">
    <h2 id="h-hot" class="hot-title">${icon('bolt', 18)}Гарячі вікна</h2>
    <div class="hot-row">${list.map(({ place: p, deal: d, free }) => `<a class="card hot-card" href="#/book/${p.id}/${d.date}/${free[0]}">
      <span class="hot-pct">−${d.pct}%</span>
      <b>${esc(p.name)}</b>
      <span class="small">${when(d.date)} · ${hhmm(d.from)}–${hhmm(d.to)}</span>
      <span class="small muted">вільно з ${free[0]}${d.services?.length ? ` · ${d.services.length} ${plural(d.services.length, 'послуга', 'послуги', 'послуг')}` : ' · усі послуги'}</span>
    </a>`).join('')}</div>
  </section>`;
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
      ${chip(`${icon('bolt', 16)}Працює при відключеннях`, 'data-action="toggle" data-key="blackout"', !!ui.blackout)}
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
    ${hotBlock()}
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

// Графік точки на тиждень, перерва й найближчі особливі дні — щоб клієнт бачив актуальні години.
function scheduleBlock(p) {
  const s = scheduleOf(p);
  const today = weekdayOf(isoDate(new Date()));
  const special = Object.entries(s.special).filter(([d]) => bookingDays(p).includes(d)).sort();
  return `<div class="list hours-list">${s.week.map((h, i) => `<div class="item${i === today ? ' today' : ''}">
      <span class="name">${WEEKDAY_NAMES[i]}${i === today ? ' <small style="display:inline">· сьогодні</small>' : ''}</span><span>${rangeText(h)}</span></div>`).join('')}</div>
    ${s.brk ? `<p class="small muted">Перерва щодня ${rangeText(s.brk)}.</p>` : ''}
    ${special.length ? `<p class="small muted">${special.map(([d, h]) => `${dayLabel(d, { day: 'numeric', month: 'long' })} — ${h ? rangeText(h) : 'не працюємо'}`).join('; ')}.</p>` : ''}
    <p class="small muted">Записатися можна на ${s.horizon} ${plural(s.horizon, 'день', 'дні', 'днів')} уперед${s.lead ? `, не пізніше ніж за ${duration(s.lead)} до початку` : ''}.</p>`;
}

function viewPlace(id) {
  const p = placeById(id);
  if (!p) return viewNotFound();
  const open = isOpenNow(p);
  const maps = `${CITY.mapsSearch}${encodeURIComponent(`${CITY.name}, ${p.address}`)}`;
  const groups = CATEGORIES.map((c) => [c, p.services.filter((s) => serviceCat(s) === c.id)]).filter(([, s]) => s.length);
  const list = visibleReviews(reviews).filter((r) => r.placeId === p.id).sort((a, b) => b.at - a.at);
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
      ${powerBadge(p)}
      ${p.tags.map((t) => `<span class="badge">${/генератор/i.test(t) ? icon('bolt', 13) : ''}${esc(t)}</span>`).join('')}
    </div>
    <div class="infobox">
      <div class="addr">${icon('pin', 18)}${esc(p.district)}, ${esc(p.address)}</div>
      <div class="grid2">
        <a class="btn" href="${tel(p)}">${icon('phone', 18)}Зателефонувати</a>
        <a class="btn" href="${maps}" target="_blank" rel="noopener">${icon('route', 18)}Маршрут</a>
      </div>
    </div>
    <nav class="jump" aria-label="Розділи сторінки"><a href="#/place/${p.id}" data-jump="services">Послуги</a><a href="#/place/${p.id}" data-jump="hours">Графік</a><a href="#/place/${p.id}" data-jump="reviews">Відгуки${list.length ? ` (${list.length})` : ''}</a></nav>
    ${personalFor(p).length ? `<h2 class="big">Тільки для вас</h2>
      <p class="small muted" style="margin:-6px 0 0">Персональні послуги й ціни, які точка підготувала саме для вас.</p>
      <div class="list personal-list" style="margin-top:10px">${personalFor(p).map((s) => `<div class="item">
        <span class="name"><span class="badge personal">Для вас</span> ${esc(s.name)}<small>${duration(s.min)}${s.note ? ` · ${esc(s.note)}` : ''}</small></span>
        <span class="price">${uah(s.price[0])}</span></div>`).join('')}</div>` : ''}
    ${queueBlock(p)}
    ${dealsOf(p.id).length ? `<p class="notice deal-note">${icon('bolt', 18)}<span><b>Гарячі вікна</b>${dealsOf(p.id).map((d) => `${dayLabel(d.date, { weekday: 'short', day: 'numeric', month: 'long' })}, ${hhmm(d.from)}–${hhmm(d.to)}: −${d.pct}%`).join('; ')}. Знижку видно біля часу під час запису.</span></p>` : ''}
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
    ${passesBlock(p)}
    ${askBlock(p)}
    <h2 class="big" id="hours">Графік роботи</h2>
    ${scheduleBlock(p)}
    <h2 class="big" id="reviews">Рейтинг і відгуки</h2>
    ${ratingSummary(p.id)}
    <p class="small muted">Залишити відгук можна лише після завершеного замовлення через CARCAR, тому кожен відгук — від реального клієнта.</p>
    <div class="stack">${list.map(reviewItem).join('')}</div>
    <div class="dock-space"></div>
    <div class="dock">${isListed(p) ? `<a class="btn primary block" href="#/book/${p.id}">Записатися онлайн</a>`
      : '<p class="notice" style="margin:0">Точка зараз не приймає онлайн-записи в CARCAR.</p>'}</div>`;
}

// ---------- жива черга ----------

const myQueue = () => store.get('queue.mine', []);

// Скільки авто попереду й скільки чекати, якщо приїхати без запису; можна стати в чергу з телефона.
function queueBlock(p) {
  if (!isListed(p) || !queueEnabled(p) || !isOpenNow(p)) return '';
  const est = queueEstimate(p, bookings);
  const mineIds = myQueue().map((x) => x.id);
  const me = queueOf(p.id).find((q) => mineIds.includes(q.id) && (q.status === 'waiting' || q.status === 'working'));
  const waiting = queueOf(p.id).filter((q) => q.status === 'waiting').sort((a, b) => a.joinedAt - b.joinedAt);
  const now = new Date().getHours() * 60 + new Date().getMinutes();
  let mine = '';
  if (me?.status === 'working') mine = `<p class="notice ok" style="margin:0">${icon('checkCircle', 20)}<span><b>Ваше авто вже в боксі</b>Майстер працює з ${me.startedTime}.</span></p>`;
  else if (me) {
    const pos = waiting.findIndex((q) => q.id === me.id) + 1;
    const eta = est.eta.get(me.id) ?? now;
    mine = `<p class="notice ok" style="margin:0">${icon('checkCircle', 20)}<span><b>Ви в черзі: ${pos}-й</b>У боксі приблизно о ${hhmm(eta)} (≈ ${duration(Math.max(0, eta - now))}).</span></p>
      <button class="btn" data-action="queue-leave" data-id="${me.id}" data-place="${p.id}">Вийти з черги</button>`;
  }
  return `<section class="card queue-card" aria-labelledby="h-queue">
    <h2 id="h-queue" class="car-name">${icon('list', 20)}Жива черга зараз</h2>
    <div class="tiles">
      <div class="tile"><span>Авто попереду</span><b>${est.ahead}</b></div>
      <div class="tile ${est.waitMin < 15 ? 'ok' : ''}"><span>Чекати без запису</span><b>${est.waitMin < 5 ? 'одразу' : `≈ ${duration(Math.round(est.waitMin / 5) * 5)}`}</b></div>
    </div>
    ${mine || `<form id="queue-join" class="inline-form" data-place="${p.id}">
      <label class="field"><span>Послуга</span><select name="service">${p.services.filter((x) => x.min <= 120).map((x) => `<option value="${x.id}">${esc(x.name)} · ${duration(x.min)}</option>`).join('')}</select></label>
      <button class="btn primary" type="submit">Стати в чергу</button></form>
      <p class="fine">Оцінка з урахуванням записів на сьогодні. Приїжджайте — вас покличуть за номером авто${cars[0]?.plate ? ` ${esc(cars[0].plate)}` : ''}.</p>`}
  </section>`;
}

// ---------- абонементи й сертифікати ----------

function passesBlock(p) {
  const plans = passesOf(p.id).plans.filter((x) => x.active !== false);
  if (!plans.length || !isListed(p)) return '';
  const mineHere = passesOf(p.id).sold.filter((x) => x.buyer === 'app' && passActive(x));
  return `<h2 class="big" id="passes">Абонементи й сертифікати</h2>
    ${mineHere.length ? `<p class="small" style="margin:-6px 0 0">У вас: ${mineHere.map((x) => `${esc(x.name)} — ${passLeft(x)}`).join('; ')}</p>` : ''}
    <div class="list">${plans.map((x) => `<div class="item pass-item">
      <span class="name">${esc(x.name)}<small>${x.kind === 'sub' ? `${x.visits} ${plural(x.visits, 'візит', 'візити', 'візитів')} на ${x.validDays} ${plural(x.validDays, 'день', 'дні', 'днів')}` : `номінал ${uah(x.amount)} · діє ${x.validDays} ${plural(x.validDays, 'день', 'дні', 'днів')}`}</small></span>
      <button class="btn" data-action="buy-pass" data-place="${p.id}" data-id="${x.id}" aria-label="Купити: ${esc(x.name)} за ${uah(x.price)}">${uah(x.price)}</button>
    </div>`).join('')}</div>
    <p class="small muted">Абонемент списується автоматично під час запису на послуги, на які він діє. Сертифікат можна подарувати — кодом оплачують запис.</p>`;
}

// ---------- запити до точки ----------

// Клієнт не знайшов послугу — пише точці. Точка відповідає в панелі й може додати послугу
// до прайсу або зробити її персональною для цього клієнта (за телефоном).
const saveRequests = () => store.set('requests', requests);
const requestsOf = (placeId) => requests.filter((r) => r.placeId === placeId).sort((a, b) => b.at - a.at);
const reqStatus = (r) => (r.closed ? ['', 'Запит закрито'] : r.service ? ['go', 'Послугу додано']
  : r.messages.at(-1).from === 'biz' ? ['go', 'Точка відповіла'] : ['', 'Чекає відповіді точки']);

const thread = (r) => `<ol class="thread">${r.messages.map((m) => `<li class="msg ${m.from}"><span class="who">${m.from === 'biz' ? 'Точка' : 'Ви'} · ${fmtTime(m.at)}</span>${esc(m.text)}</li>`).join('')}</ol>`;

function askBlock(p) {
  const list = requestsOf(p.id);
  return `<section class="ask" id="ask" aria-labelledby="h-ask">
    <h2 class="big" id="h-ask">Не знайшли потрібну послугу?</h2>
    <p class="small muted" style="margin:-6px 0 0">Напишіть точці, що потрібно зробити. Вона може додати послугу до прайсу або підготувати персональну ціну для вас — відповідь зʼявиться тут.</p>
    ${list.map((r) => {
      const [cls, label] = reqStatus(r);
      return `<article class="card req">
        <div class="head"><span class="bk-status ${cls}">${label}</span>${r.unreadClient ? '<span class="badge personal">Нове</span>' : ''}</div>
        ${thread(r)}
        ${r.service ? `<div class="notice ok">${icon('checkCircle', 22)}<div><b>${esc(r.service.name)} — ${uah(r.service.price)}</b>${r.service.personal ? 'Персональна послуга для вас — вона вже є в записі.' : 'Послугу додано до прайсу точки.'}</div></div>
          <a class="btn primary" href="#/book/${p.id}">Записатися</a>` : ''}
        ${r.closed ? '' : `<form class="req-reply inline-form" data-id="${r.id}"><label class="field"><span>Відповісти точці</span><input name="text" required maxlength="500" autocomplete="off"></label>
          <button class="btn" type="submit">Надіслати</button></form>`}
      </article>`;
    }).join('')}
    <form id="askform" class="card stack" data-place="${p.id}">
      <label class="field"><span>Що потрібно зробити?</span><textarea name="text" rows="3" required maxlength="600" placeholder="Наприклад, зняти захист картера або помити дах автобудинку"></textarea></label>
      <div class="grid2 pf">
        <label class="field"><span>Ваше імʼя</span><input name="name" required autocomplete="name" value="${esc(profile.name)}"></label>
        <label class="field"><span>Ваш телефон</span><input name="phone" type="tel" required autocomplete="tel" placeholder="+380" value="${esc(profile.phone)}"></label>
      </div>
      <button class="btn primary block" type="submit">${icon('chat', 18)}Надіслати точці</button>
      <p class="fine">Точка побачить запит, імʼя й телефон у своїй панелі. Персональну ціну ви побачите за цим телефоном.</p>
    </form>
  </section>`;
}

// Запити на сторінці «Мої записи»: де відповіли й куди повернутися.
function requestsCard() {
  if (!requests.length) return '';
  const list = [...requests].sort((a, b) => (b.messages.at(-1).at) - (a.messages.at(-1).at)).slice(0, 5);
  return `<h2>Запити до точок</h2>
    <div class="stack" style="gap:8px">${list.map((r) => {
      const p = placeById(r.placeId);
      const [cls, label] = reqStatus(r);
      return `<a class="card link-card" href="#/place/${r.placeId}/ask">${icon('chat', 22)}<span>${esc(p?.name ?? 'Точка')}
        <small class="small muted" style="display:block;font-weight:400"><span class="bk-status ${cls}" style="display:inline">${label}</span> · ${esc(r.messages.at(-1).text.length > 60 ? `${r.messages.at(-1).text.slice(0, 60).trimEnd()}…` : r.messages.at(-1).text)}</small></span>
        ${r.unreadClient ? '<span class="count" aria-label="нова відповідь">1</span>' : ''}${icon('chevR', 18)}</a>`;
    }).join('')}</div>`;
}

// ---------- запис і оплата ----------

function draftClass() {
  const car = cars.find((c) => c.id === draft.carId);
  return car ? car.cls : ui.cls;
}

function viewBook(id, date, time) {
  const p = placeById(id);
  if (!p) return viewNotFound();
  if (!isListed(p)) return `${back(`#/place/${p.id}`, esc(p.name))}<h1>Запис недоступний</h1><p class="muted">Точка зараз не приймає онлайн-записи в CARCAR.</p>`;
  // Посилання з гарячого вікна чи листа очікування відкриває запис одразу на потрібний день і час.
  const prefill = date && bookingDays(p).includes(date);
  if (!draft || draft.placeId !== id || (prefill && draft.date !== date)) {
    draft = { placeId: id, services: new Set(), date: prefill ? date : firstOpenDay(p), time: null, wantTime: prefill ? time : null, carId: cars[0]?.id ?? null };
  }
  return `${back(`#/place/${p.id}`, p.name)}
    <h1>Запис</h1>
    <div id="book"></div>`;
}

// Лист очікування: якщо зручний час зайнятий — повідомимо, щойно він звільниться.
function waitlistBlock(p, minutes, chosen) {
  const mineW = store.get('waitlist', []).find((w) => w.placeId === p.id && w.date === draft.date && w.status === 'active' && w.mine);
  if (mineW) {
    return `<p class="notice ok" style="margin-top:12px">${icon('checkCircle', 20)}<span><b>Ви в листі очікування</b>${dayLabel(draft.date, { day: 'numeric', month: 'long' })}, ${hhmm(mineW.from)}–${hhmm(mineW.to)}. Повідомимо, щойно звільниться час.</span></p>`;
  }
  if (!draft.waitOpen) return `<p class="small" style="margin:10px 0 0"><button class="link-btn" data-action="wait-open">Немає зручного часу? Повідомимо, якщо звільниться</button></p>`;
  const h = hoursFor(p, draft.date) ?? [480, 1200];
  const opts = (sel, from, to) => { let o = ''; for (let t = from; t <= to; t += 30) o += `<option value="${t}" ${t === sel ? 'selected' : ''}>${hhmm(t)}</option>`; return o; };
  return `<form id="wait-form" class="card stack" style="margin-top:12px;gap:10px" data-minutes="${minutes}">
    <b>Лист очікування на ${dayLabel(draft.date, { day: 'numeric', month: 'long' })}</b>
    <div class="grid2">
      <label class="field"><span>Зручно з</span><select name="from">${opts(h[0], h[0], h[1] - 30)}</select></label>
      <label class="field"><span>До</span><select name="to">${opts(h[1], h[0] + 30, h[1])}</select></label>
      <label class="field"><span>Ваше імʼя</span><input name="name" required autocomplete="name" value="${esc(profile.name)}"></label>
      <label class="field"><span>Ваш телефон</span><input name="phone" type="tel" required autocomplete="tel" placeholder="+380" value="${esc(profile.phone)}"></label>
    </div>
    <p class="fine">${esc(chosen.map((x) => x.name).join(', '))} · ${duration(minutes)}. Сповіщення прийде в застосунок; оплата — лише коли ви запишетесь.</p>
    <button class="btn primary" type="submit">Повідомити, коли звільниться</button>
  </form>`;
}

// Розрахунок вартості запису: знижка гарячого вікна, абонемент чи сертифікат, бонус і баланс CARCAR.
function quote(p) {
  const cls = draftClass();
  const list = bookable(p);
  const chosen = list.filter((s) => draft.services.has(s.id));
  const minutes = chosen.reduce((a, s) => a + s.min, 0);
  const deal = draft.time ? dealAt(p.id, draft.date, draft.time) : null;
  const priceOf = (s) => (!s.personal && dealCovers(deal, s.id) ? dealPrice(s.price[cls], deal.pct) : s.price[cls]);
  const listTotal = chosen.reduce((a, s) => a + s.price[cls], 0);
  const total = chosen.reduce((a, s) => a + priceOf(s), 0);
  const subs = usableSubs(p.id, myKeys(), chosen.map((s) => s.id));
  let use = null;
  let covered = 0;
  const sub = draft.useSub !== false ? subs[0] : null;
  if (sub) {
    const ok = chosen.filter((s) => !sub.services.length || sub.services.includes(s.id)).map(priceOf);
    covered = ok.length ? Math.max(...ok) : 0;
    use = { kind: 'sub', soldId: sub.id, name: sub.name, left: sub.visitsLeft };
  } else if (draft.cert) {
    const c = findCert(p.id, draft.cert);
    if (c && passActive(c)) { covered = Math.min(c.balance, total); use = { kind: 'cert', soldId: c.id, name: c.name, left: c.balance }; }
  }
  const rest = total - covered;
  const bonus = draft.useBonus !== false ? bonusFor(rest) : 0;
  const fromBal = draft.useMoney !== false ? Math.min(wallet.money, rest - bonus) : 0;
  return { cls, list, chosen, minutes, deal: total < listTotal ? deal : null, listTotal, total, subs, covered, use, rest, bonus, fromBal, card: rest - bonus - fromBal };
}

function renderBook() {
  const p = placeById(draft.placeId);
  const q = quote(p);
  const { cls, list, chosen, minutes, total, bonus, fromBal } = q;
  const slots = minutes ? slotsFor(p, draft.date, minutes) : [];
  if (!draft.time && draft.wantTime && slots.some((s) => s.time === draft.wantTime && !s.busy)) { draft.time = draft.wantTime; draft.wantTime = null; return renderBook(); }
  if (draft.time && !slots.some((s) => s.time === draft.time && !s.busy)) { draft.time = null; return renderBook(); }
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
      ${list.map((s) => `<label class="item">
        <input class="check" type="checkbox" data-action="svc" value="${s.id}" ${draft.services.has(s.id) ? 'checked' : ''}>
        <span class="name">${s.personal ? '<span class="badge personal">Для вас</span> ' : ''}${esc(s.name)}<small>${duration(s.min)}${s.note ? ` · ${esc(s.note)}` : ''}</small></span>
        <span class="price">${uah(s.price[cls])}</span>
      </label>`).join('')}
    </div>
    <p class="small" style="margin:10px 0 0"><a href="#/place/${p.id}/ask">Не знайшли потрібну послугу? Напишіть точці</a></p>

    <h2>3. День і час</h2>
    <div class="days" role="group" aria-label="День">
      ${bookingDays(p).map((d, i) => {
        const date = parseDate(d);
        const wd = i === 0 ? 'Сьогодні' : i === 1 ? 'Завтра' : date.toLocaleDateString('uk-UA', { weekday: 'short' });
        const closed = !hoursFor(p, d);
        return `<button class="day${closed ? ' closed' : ''}" data-action="day" data-date="${d}" aria-pressed="${d === draft.date}" ${closed ? `disabled aria-label="${wd}, ${date.getDate()}, вихідний"` : ''}>
          <span>${wd}</span><b>${date.getDate()}</b><span>${closed ? 'вихідний' : date.toLocaleDateString('uk-UA', { month: 'short' })}</span>
        </button>`;
      }).join('')}
    </div>
    ${hoursFor(p, draft.date) ? `<p class="small muted" style="margin:8px 0 0">Працюємо ${rangeText(hoursFor(p, draft.date))}${scheduleOf(p).brk ? `, перерва ${rangeText(scheduleOf(p).brk)}` : ''}</p>` : ''}
    ${!minutes
      ? '<p class="muted">Оберіть послуги, щоб побачити вільний час.</p>'
      : free.length
        ? `<div class="slots" role="group" aria-label="Час">${slots.map((s) => {
            const d = !s.busy && dealAt(p.id, draft.date, s.time);
            return `<button class="slot${d ? ' hot' : ''}" data-action="time" data-time="${s.time}"
            ${s.busy ? `disabled aria-label="${s.time}, зайнято"` : d ? `aria-label="${s.time}, знижка ${d.pct}%"` : ''} aria-pressed="${s.time === draft.time}">${s.time}${d ? `<small>−${d.pct}%</small>` : ''}</button>`;
          }).join('')}</div>`
        : '<p class="muted">На цей день вільного часу немає. Оберіть інший день або станьте в лист очікування.</p>'}
    ${minutes ? waitlistBlock(p, minutes, chosen) : ''}
    <div class="dock-space tall"></div>

    ${draft.paying ? `<div class="sheet-dim" data-action="unpay"></div>
    <div class="sheet summary" role="dialog" aria-modal="true" aria-label="Оплата">
      <div class="handle"></div>
      <div class="sheet-total"><span>До сплати${fromBal ? ' карткою' : ''}</span><b>${uah(q.card)}</b></div>
      ${q.deal ? `<p class="small" style="margin:0">${icon('bolt', 14)} Гаряче вікно −${q.deal.pct}%: ${uah(q.listTotal)} → ${uah(total)}</p>` : ''}
      ${q.subs.length ? `<label class="bonus-line"><input class="check" type="checkbox" id="usesub" ${draft.useSub !== false ? 'checked' : ''}>
            <span>${esc(q.subs[0].name)}<small>Списати 1 візит, лишилось ${passLeft(q.subs[0])}</small></span><b>${q.use?.kind === 'sub' ? `−${uah(q.covered)}` : ''}</b></label>` : ''}
      ${!q.use || q.use.kind === 'cert' ? `<div class="inline-form cert-line">
        <label class="field"><span>Код подарункового сертифіката</span><input id="cert-code" autocomplete="off" placeholder="CC-XXXX-XXXX" value="${esc(draft.cert ?? '')}"></label>
        <button class="btn" data-action="cert-apply">${q.use?.kind === 'cert' ? `−${uah(q.covered)}` : 'Застосувати'}</button></div>` : ''}
      ${wallet.bonus ? (bonusFor(q.rest)
        ? `<label class="bonus-line"><input class="check" type="checkbox" id="usebonus" ${draft.useBonus !== false ? 'checked' : ''}>
            <span>Бонус «Приведи друга»<small>Вартість ${uah(total)}, точка отримає повну суму</small></span><b>−${uah(bonusFor(q.rest))}</b></label>`
        : `<p class="small muted" style="margin:0">Бонус ${uah(wallet.bonus)} діє для замовлень від ${uah(REFERRAL.minOrder)}.</p>`) : ''}
      ${wallet.money > 0 ? `<label class="bonus-line"><input class="check" type="checkbox" id="usemoney" ${draft.useMoney !== false ? 'checked' : ''}>
            <span>Баланс CARCAR<small>Доступно ${uah(wallet.money)}</small></span><b>−${uah(Math.min(wallet.money, q.rest - bonus))}</b></label>` : ''}
      <ul class="perks">
        <li><span class="perk-ic ok">${icon('shield', 20)}</span>Гроші утримуються, доки роботу не виконано</li>
        <li><span class="perk-ic">${icon('cash', 20)}</span>Комісія для клієнта — 0 ₴</li>
        <li><span class="perk-ic">${icon('undo', 20)}</span>Скасування до ${cancelWindow()} до візиту — уся сума повертається на баланс CARCAR</li>
      </ul>
      <div class="stack" style="gap:8px">
        <button class="btn primary block" data-action="pay">${icon('card', 20)}${q.card > 0 ? `Оплатити ${uah(q.card)}` : fromBal ? 'Оплатити з балансу' : q.covered ? 'Записатися' : `Оплатити ${uah(0)}`}</button>
        <button class="btn block" data-action="unpay">Назад</button>
      </div>
      <div class="grid2 pf">
        <label class="field"><span>Ваше імʼя</span><input id="pf-name" autocomplete="name" value="${esc(draft.pfName ?? profile.name)}"></label>
        <label class="field"><span>Телефон</span><input id="pf-phone" type="tel" autocomplete="tel" placeholder="+380" value="${esc(draft.pfPhone ?? profile.phone)}"></label>
      </div>
      <label class="row small"><input class="check" type="checkbox" id="pf-optin" ${(draft.pfOptIn ?? profile.optIn) ? 'checked' : ''}>Отримувати пропозиції цієї точки у Viber чи Telegram</label>
      <p class="demo">Імʼя й телефон бачить лише точка — щоб звʼязатися й показувати вам персональні ціни. Демо-оплата: гроші не списуються.</p>
    </div>` : `<div class="dock summary">
      <div class="total"><span>${chosen.length ? `${chosen.length} ${plural(chosen.length, 'послуга', 'послуги', 'послуг')} · ${duration(minutes)}` : 'Нічого не обрано'}</span><span>${q.deal ? `<s class="muted">${uah(q.listTotal)}</s> ` : ''}${uah(total - q.covered)}</span></div>
      <button class="btn primary block" data-action="confirm" ${chosen.length && draft.time ? '' : 'disabled'}>
        ${draft.time ? `Записатися на ${dayLabel(draft.date, { day: 'numeric', month: 'long' })}, ${draft.time}` : 'Оберіть час'}
      </button>
    </div>`}`;
}

function confirmBooking() {
  const p = placeById(draft.placeId);
  const car = cars.find((c) => c.id === draft.carId);
  // Імʼя й телефон з форми оплати зберігаємо в профіль, щоб наступного разу не вводити.
  profile = { name: (draft.pfName ?? profile.name).trim(), phone: (draft.pfPhone ?? profile.phone).trim(), optIn: draft.pfOptIn ?? profile.optIn };
  store.set('profile', profile);
  const q = quote(p);
  const { cls, chosen, total, bonus, fromBal } = q;
  const id = uid();
  const passUse = q.use ? { ...redeemPass(p.id, q.use.soldId, q.covered, id), kind: q.use.kind } : null;
  const b = {
    id,
    placeId: p.id,
    services: chosen.map((s) => s.name),
    total,
    listTotal: q.listTotal,
    deal: q.deal ? { id: q.deal.id, pct: q.deal.pct } : null,
    covered: q.covered,
    passUse,
    optIn: !!profile.optIn,
    paid: q.rest - bonus,
    fromBalance: fromBal,
    bonus,
    minutes: chosen.reduce((a, s) => a + s.min, 0),
    date: draft.date,
    time: draft.time,
    car: car ? carLabel(car) : CAR_CLASSES[cls],
    carId: car?.id ?? null,
    plate: car?.plate ?? '',
    cls,
    clientName: profile.name,
    clientPhone: profile.phone,
    personal: chosen.filter((x) => x.personal).map((x) => x.id),
    state: 'paid',
    createdAt: Date.now(),
  };
  bookings.push(b);
  save();
  if (bonus) addBonus(-bonus, `Списано на замовлення: ${p.name}`);
  if (fromBal) addMoney(-fromBal, `Оплата замовлення: ${p.name}`);
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

// До дедлайну — повне повернення на баланс CARCAR; пізніше оплата зараховується точці за послугу.
function cancelTerms(b) {
  const deadline = bookingStart(b).getTime() - PAYMENT.freeCancelHours * HOUR;
  const free = Date.now() <= deadline;
  return { free, deadline, placeAmount: free ? 0 : price(b), refund: free ? b.paid : 0 };
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
        <button class="btn text-danger full" data-action="cancel" data-id="${b.id}">${t.free ? 'Скасувати' : 'Скасувати без повернення'}</button>
      </div>
      <p class="terms">${t.free
        ? `Безкоштовне скасування до ${fmtTime(t.deadline)} — усю суму ${uah(b.paid)} повернемо на баланс CARCAR. Пізніше оплата зараховується точці за послугу.`
        : `Скасувати з поверненням можна було до ${fmtTime(t.deadline)}. Тепер оплата зараховується точці за послугу, навіть якщо ви не приїдете.`}</p>`}`;
  } else if (b.state === 'done') {
    body = `<div class="lines tight">
        <div class="il strong">${when}</div>
        <div>${esc(b.car)} · ${b.services.map(esc).join(', ')}</div>
      </div>
      <div class="notice ok">${icon('checkCircle', 22)}<div><b>Машина готова!</b>Перевірте результат і підтвердіть або відкрийте спір до
        ${fmtTime(b.doneAt + PAYMENT.autoReleaseHours * HOUR)}, інакше замовлення підтвердиться автоматично.</div></div>
      ${b.remindedAt ? `<p class="small muted" style="margin:0">Точка нагадала ${fmtTime(b.remindedAt)}: підтвердьте виконання, щоб вона отримала оплату.</p>` : ''}
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
    body += b.refund || b.state === 'refunded' || !b.placeAmount
      ? `<p class="small muted" style="margin:0">Повернено ${uah(b.refund ?? b.paid)} ${b.refundTo === 'balance' ? 'на баланс CARCAR' : 'на картку'}${b.bonusReturned ? ` і ${uah(b.bonus)} на бонусний рахунок` : ''}${b.placeAmount ? `, ${uah(b.placeAmount)} отримала точка` : ''}.</p>`
      : `<p class="small muted" style="margin:0">${b.state === 'noshow' ? 'Ви не приїхали' : `Запис скасовано пізніше ніж за ${cancelWindow()}`} — оплату ${uah(b.placeAmount)} зараховано точці за послугу.</p>`;
  }
  return `<article class="bk${highlight ? ' hl' : ''}" id="b-${b.id}">
    ${cardHead(b, esc(p?.name ?? 'Сервіс'))}
    ${steps(b)}
    ${body}
    ${intakeBlock(b)}
    ${!ACTIVE.includes(b.state) && p ? `<a class="btn" href="#/book/${p.id}" data-action="repeat" data-id="${b.id}">${icon('repeat', 18)}Записатися знову</a>` : ''}
  </article>`;
}

// Акт приймання з фото до робіт: клієнт підтверджує або пише, що не так.
function intakeBlock(b) {
  const a = b.intake;
  if (!a) return '';
  return `<details class="intake-card" ${a.ack ? '' : 'open'}><summary>${icon('camera', 18)}Акт приймання авто · ${fmtTime(a.at)}${a.ack ? (a.ack.ok ? ' · підтверджено' : ' · є зауваження') : ''}</summary>
    <p class="small" style="margin:8px 0">${a.marks.length ? `Точка зафіксувала: ${a.marks.map(esc).join(', ')}` : 'Пошкоджень не зафіксовано'}${a.km ? ` · пробіг ${km(a.km)}` : ''}${a.note ? ` · ${esc(a.note)}` : ''}</p>
    ${a.photos.length ? `<div class="photos">${a.photos.map((src, i) => `<img src="${esc(src)}" alt="Фото до робіт ${i + 1}">`).join('')}</div>` : ''}
    ${a.ack ? (a.ack.ok ? '' : `<p class="small muted" style="margin:6px 0 0">Ваше зауваження: ${esc(a.ack.note)}</p>`)
      : `<div class="grid2" style="margin-top:10px"><button class="btn primary" data-action="intake-ok" data-id="${b.id}">Усе вірно</button>
        <button class="btn" data-action="intake-no" data-id="${b.id}">Є зауваження</button></div>
        <p class="fine">Акт захищає вас і точку: якщо після робіт зʼявиться нова подряпина, буде з чим порівняти.</p>`}
  </details>`;
}

// ---------- повідомлення ----------

function viewInbox() {
  const keys = myKeys();
  const list = inboxFor(keys);
  const waits = store.get('waitlist', []).filter((w) => w.mine && w.status === 'active');
  const html = `<h1>Повідомлення</h1>
    ${keys.length ? '' : '<p class="notice">Вкажіть телефон у <a href="#/garage">профілі</a> — тоді сюди прийдуть пропозиції й нагадування точок.</p>'}
    ${waits.length ? `<h2>Лист очікування</h2><div class="stack" style="gap:8px">${waits.map((w) => `<div class="card head" style="align-items:center">
      <span><b>${esc(placeById(w.placeId)?.name ?? '')}</b><small class="small muted" style="display:block">${dayLabel(w.date, { day: 'numeric', month: 'long' })}, ${hhmm(w.from)}–${hhmm(w.to)} · ${esc(w.services.join(', '))}</small></span>
      <button class="btn" data-action="wait-cancel" data-id="${w.id}">Вийти</button></div>`).join('')}</div>` : ''}
    <h2>Вхідні</h2>
    ${list.length ? `<div class="stack" style="gap:8px">${list.map((m) => `<article class="card msg-card${m.read ? '' : ' unread'}">
      <div class="head"><b>${esc(placeById(m.placeId)?.name ?? 'CARCAR')}</b><span class="small muted">${CHANNELS[m.channel] ?? ''} · ${fmtTime(m.at)}</span></div>
      <p style="margin:6px 0 0">${esc(m.text)}</p>
      ${m.link ? `<a class="btn" href="${esc(m.link)}" style="margin-top:8px">${m.kind === 'waitlist' ? 'Записатися' : m.kind === 'tires' ? 'Записатися на перевзування' : 'Відкрити'}</a>` : ''}
    </article>`).join('')}</div>` : empty('chat', 'Повідомлень поки немає.')}
    <p class="note">Демо: розсилки, які точка надсилає у Viber чи Telegram, тут дублюються, щоб їх було видно в прототипі.</p>`;
  markRead(keys);
  return html;
}

// ---------- гараж: шини на зберіганні й абонементи ----------

function garageExtras() {
  const keys = myKeys();
  const tires = myTires(keys);
  const passes = PLACES.flatMap((p) => passesOf(p.id).sold.filter((x) => (x.buyer === 'app' || keys.includes(x.clientKey)) && passActive(x)).map((x) => ({ ...x, place: p })));
  if (!tires.length && !passes.length) return '';
  const due = seasonDue();
  return `${tires.length ? `<h2 class="big">Шини на зберіганні</h2><div class="stack" style="gap:8px">${tires.map((t) => `<section class="card stack" style="gap:6px" aria-label="Шини: ${esc(t.place.name)}">
      <div class="head"><b>${SEASONS[t.season]} · ${t.count} шт</b><span class="small muted">${esc(t.place.name)}</span></div>
      <span class="small">${esc(t.brand || '')} ${esc(t.size || '')}${t.rims ? ' · на дисках' : ''} · стан: ${esc(t.condition).toLowerCase()} · місце ${esc(t.slot)}</span>
      ${tireDue(t) ? `<div class="warn-pill">${icon('wheel', 16)}Час ставити ${due === 'winter' ? 'зимові' : 'літні'} шини</div><a class="btn primary" href="#/book/${t.place.id}">Записатися на перевзування</a>` : ''}
    </section>`).join('')}</div>` : ''}
    ${passes.length ? `<h2 class="big">Абонементи й сертифікати</h2><div class="stack" style="gap:8px">${passes.map((x) => `<section class="card stack" style="gap:4px" aria-label="${esc(x.name)}">
      <div class="head"><b>${esc(x.name)}</b><span class="small muted">${esc(x.place.name)}</span></div>
      <span class="small">Лишилось ${passLeft(x)} · діє до ${fmtDate(x.validUntil)}</span>
      ${x.kind === 'cert' ? `<span class="small">Код для оплати чи подарунка: <b class="code">${esc(x.code)}</b></span>` : ''}
    </section>`).join('')}</div>` : ''}`;
}

function viewBookings(highlightId) {
  const list = mine();
  const sorted = [...list].sort((a, b) => bookingStart(a) - bookingStart(b));
  const active = sorted.filter((b) => ACTIVE.includes(b.state));
  const rest = sorted.filter((b) => !ACTIVE.includes(b.state)).reverse();
  if (!list.length) {
    return `<h1>Мої записи</h1>${empty('calendar', 'Записів поки немає.', '<a class="btn primary" href="#/">Знайти мийку або сервіс</a>')}${moneyCard()}${requestsCard()}${inviteCard()}`;
  }
  return `<h1>Мої записи</h1>
    ${moneyCard()}
    ${requestsCard()}
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
  const fee = Math.round(bal.available * commissionFor(p.id));
  const ready = payoutReady(p.id);
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
      ${ready ? `<button class="btn primary block" data-action="payout" ${bal.available > 0 ? '' : 'disabled'}>
        ${icon('card', 20)}${bal.available > 0 ? `Вивести ${uah(bal.available - fee)} на рахунок ${partnerIban(p.id)}` : 'Немає коштів для виведення'}
      </button>` : `<a class="btn block" href="business.html#/connect">${icon('card', 20)}Вказати реквізити для виплат</a>
      <p class="fine">Виплати йдуть на рахунок ФОП чи ТОВ. Після перевірки реквізитів CARCAR виведення стане доступним.</p>`}
      <p class="fine">Гроші за замовлення заморожені, доки клієнт не підтвердить виконання, і ще ${PAYMENT.freezeHours} год після цього.${bal.next ? ` Найближче розморожування: ${uah(price(bal.next))} — ${fmtTime(bal.next.unfreezeAt)}.` : ''}
        Комісія сервісу ${pctText(commissionFor(p.id))} утримується лише під час виведення${bal.available > 0 ? `: ${uah(fee)}` : ''}. Для клієнтів комісії немає.</p>
    </section>
    <a class="card link-card" href="business.html#/requests" style="margin-top:12px">${icon('chat', 22)}<span>Запити клієнтів
      <small class="small muted" style="display:block;font-weight:400">Клієнти пишуть, якщо не знайшли потрібну послугу</small></span>
      ${requests.filter((r) => r.placeId === p.id && r.unreadBiz).length ? `<span class="count">${requests.filter((r) => r.placeId === p.id && r.unreadBiz).length}</span>` : ''}${icon('chevR', 18)}</a>
    <a class="card link-card" href="#/place/${p.id}" style="margin-top:12px">${icon('star', 22)}<span>Сторінка точки й відгуки<small class="small muted" style="display:block;font-weight:400">${ratingOf(p.id).count ? `Рейтинг ${rating(ratingOf(p.id).avg)} · ${ratingOf(p.id).count} ${reviewsWord(ratingOf(p.id).count)}` : 'Ще немає відгуків'}</small></span>${icon('chevR', 18)}</a>
    <h2>Активні записи</h2>
    <div class="stack">${active.length ? active.map(partnerRow).join('') : '<p class="muted">Активних записів немає.</p>'}</div>
    ${rest.length ? `<h2>Завершені</h2><div class="stack">${rest.map(partnerRow).join('')}</div>` : ''}
    ${history.length ? `<h2>Виплати</h2><div class="card">${history.map((x) => `<div class="head small">
        <span>${fmtTime(x.at)}</span><span>${uah(x.net)} <span class="muted">(комісія ${uah(x.fee)})</span></span></div>`).join('')}</div>` : ''}
    <h2>Для модератора</h2>
    <a class="card link-card" href="admin.html">${icon('shield', 22)}<span>Адмінка CARCAR<small class="small muted" style="display:block;font-weight:400">Підключення точок, відгуки, спори, комісії й статистика</small></span>${icon('chevR', 18)}</a>
    <a class="card link-card" href="#/disputes" style="margin-top:8px">${icon('scale', 22)}<span>Модерація спорів</span>
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
    <form class="card profile-card" id="profileform">
      <h2 class="car-name">Ваш профіль</h2>
      <p class="small muted" style="margin:0">Імʼя й телефон бачить точка, до якої ви записуєтесь. За телефоном вона може підготувати для вас персональні послуги й ціни.</p>
      <div class="grid2">
        <label class="field"><span>Імʼя</span><input name="name" autocomplete="name" value="${esc(profile.name)}"></label>
        <label class="field"><span>Телефон</span><input name="phone" type="tel" autocomplete="tel" placeholder="+380" value="${esc(profile.phone)}"></label>
      </div>
      <label class="row small"><input class="check" type="checkbox" name="optIn" ${profile.optIn ? 'checked' : ''}>Отримувати пропозиції точок, де я обслуговуюсь, у Viber чи Telegram</label>
      <button class="btn" type="submit">Зберегти профіль</button>
    </form>
    ${garageExtras()}
    <p class="lead" style="margin-top:16px">Сервісна книжка кожного авто: історія обслуговування, пробіг і нагадування.</p>
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
    const msg = t.free
      ? `Скасувати запис? Повернемо ${uah(t.refund)} на баланс CARCAR.`
      : `До візиту менше ${cancelWindow()}, тому оплата ${uah(t.placeAmount)} зарахується точці за послугу — повернення не буде. Скасувати запис?`;
    if (!confirm(msg)) return false;
    Object.assign(b, { state: 'cancelled', refund: t.refund, placeAmount: t.placeAmount });
    if (t.free) {
      b.refundTo = 'balance';
      if (t.refund) addMoney(t.refund, `Повернення: ${placeById(b.placeId)?.name ?? 'скасований запис'}`);
      returnBonus(b, 'скасоване замовлення');
      // Візит абонемента чи сума сертифіката повертаються.
      if (b.passUse) { restorePass(b.placeId, b.passUse); b.passUse = null; }
    }
    toast(t.free ? `Запис скасовано, ${uah(t.refund)} повернено на баланс` : 'Запис скасовано, оплату зараховано точці');
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
    const placeAmount = Math.round(price(b) * PAYMENT.noShowShare);
    if (!confirm(`Позначити неявку? Клієнт не скасував запис вчасно, тож точка отримає оплату ${uah(placeAmount)}.`)) return false;
    Object.assign(b, { state: 'noshow', placeAmount, refund: price(b) - placeAmount });
    location.hash = '#/partner';
  },
  'resolve-client'(b) {
    resolveDispute(b, 0);
    wallet = { ...wallet, ...store.get('wallet', {}) };
    returnBonus(b, 'повернення за спором');
    toast('Гроші повернено клієнту');
  },
  'resolve-place'(b) {
    resolveDispute(b, price(b));
    toast('Гроші передано точці');
  },
};

// ---------- роутер і події ----------

function route() {
  const [, page = '', arg, sub, extra] = location.hash.replace(/^#/, '').split('/');
  const view = $('#view');
  const tab = page === 'disputes' ? 'partner' : page === 'invite' || page === 'inbox' ? '' : ['bookings', 'garage', 'partner'].includes(page) ? page : 'catalog';
  settle();
  // Хтось скасував запис — можливо, звільнився час для листа очікування.
  checkWaitlist(bookings);
  // Крапка на вкладці «Мої записи», коли машина готова, точка просить доплату чи підтвердити акт.
  const ready = mine().some((b) => b.state === 'done' || b.extra || (b.intake && !b.intake.ack)) || requests.some((r) => r.unreadClient);
  document.querySelector('.tabs a[data-tab="bookings"]').toggleAttribute('data-badge', ready);
  const unread = inboxFor(myKeys()).filter((m) => !m.read).length;
  $('#inbox-btn').innerHTML = `${icon('bell', 22)}${unread ? `<span class="count">${unread}</span>` : ''}`;
  $('#inbox-btn').setAttribute('aria-label', unread ? `Повідомлення, непрочитаних: ${unread}` : 'Повідомлення');
  document.querySelectorAll('.tabs a').forEach((a) => {
    if (a.dataset.tab === tab) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  });

  if (page === '') { view.innerHTML = viewCatalog(); renderList(); }
  else if (page === 'place') view.innerHTML = viewPlace(arg);
  else if (page === 'book') { view.innerHTML = viewBook(arg, sub, extra); if ($('#book')) renderBook(); }
  else if (page === 'inbox') view.innerHTML = viewInbox();
  else if (page === 'bookings') view.innerHTML = viewBookings(arg);
  else if (page === 'garage') view.innerHTML = arg ? viewCar(arg) : viewGarage();
  else if (page === 'partner') view.innerHTML = arg ? viewPartnerJob(arg) : viewPartner();
  else if (page === 'disputes') view.innerHTML = viewDisputes();
  else if (page === 'invite') view.innerHTML = viewInvite();
  else view.innerHTML = viewNotFound();

  // Клієнт відкрив сторінку точки — відповіді на його запити прочитані.
  if (page === 'place' && requests.some((r) => r.placeId === arg && r.unreadClient)) {
    for (const r of requests) if (r.placeId === arg) r.unreadClient = false;
    saveRequests();
  }
  const target = arg && page === 'bookings' ? $(`#b-${arg}`) : sub === 'ask' ? $('#ask') : null;
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
    const fee = Math.round(available * commissionFor(ui.partner));
    const iban = partnerIban(ui.partner);
    if (!confirm(`Вивести ${uah(available)}? Комісія ${uah(fee)}, на рахунок ${iban} надійде ${uah(available - fee)}.`)) return;
    payouts.push({ id: uid(), placeId: ui.partner, gross: available, fee, net: available - fee, at: Date.now(), iban });
    save();
    route();
    toast(`Виплату відправлено на рахунок ${iban}`);
  } else if (action === 'cert-apply') {
    const code = $('#cert-code').value.trim().toUpperCase();
    const c = findCert(draft.placeId, code);
    if (!c) { toast('Сертифікат не знайдено в цій точці'); return; }
    if (!passActive(c)) { toast('Сертифікат вичерпано або строк дії минув'); return; }
    draft.cert = code;
    draft.useSub = false;
    renderBook();
    toast(`Сертифікат застосовано: на ньому ${passLeft(c)}`);
  } else if (action === 'wait-open') {
    draft.waitOpen = true;
    renderBook();
    $('#wait-form select')?.focus();
  } else if (action === 'buy-pass') {
    const p = placeById(el.dataset.place);
    const plan = passesOf(p.id).plans.find((x) => x.id === id);
    if (!profile.phone) { toast('Вкажіть телефон у профілі в «Гаражі» — до нього привʼяжемо абонемент'); return; }
    if (!confirm(`Купити «${plan.name}» за ${uah(plan.price)}? Оплата карткою через CARCAR.`)) return;
    const sold = sellPass(p.id, plan, { clientName: profile.name, phone: profile.phone, clientKey: myKeys()[0], source: 'carcar', buyer: 'app' });
    route();
    toast(plan.kind === 'cert' ? `Сертифікат куплено, код ${sold.code} — його можна подарувати` : 'Абонемент куплено — спишеться під час запису');
  } else if (action === 'queue-leave') {
    const list = store.get('biz.queue', {})[el.dataset.place] ?? [];
    saveQueue(el.dataset.place, list.map((q) => (q.id === id ? { ...q, status: 'left' } : q)));
    route();
    toast('Ви вийшли з черги');
  } else if (action === 'wait-cancel') {
    store.set('waitlist', store.get('waitlist', []).map((w) => (w.id === id ? { ...w, status: 'cancelled' } : w)));
    route();
    toast('Ви вийшли з листа очікування');
  } else if (action === 'intake-ok' || action === 'intake-no') {
    const b = bookings.find((x) => x.id === id);
    const note = action === 'intake-no' ? prompt('Що в акті не так?')?.trim() : '';
    if (action === 'intake-no' && !note) return;
    b.intake.ack = { ok: action === 'intake-ok', note, at: Date.now() };
    save();
    route();
    toast(action === 'intake-ok' ? 'Акт приймання підтверджено' : 'Точка отримала ваше зауваження до акта');
  } else if (action === 'money-out') {
    if (!confirm(`Вивести ${uah(wallet.money)} на картку? Гроші надійдуть протягом 1–3 банківських днів.`)) return;
    addMoney(-wallet.money, 'Виведено на картку');
    route();
    toast('Гроші відправлено на картку');
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
      services: new Set(bookable(p).filter((s) => b.services.includes(s.name)).map((s) => s.id)),
      date: firstOpenDay(p), time: null, carId: cars[0]?.id ?? null,
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
  } else if (t.id === 'usesub') {
    draft.useSub = t.checked;
    if (t.checked) draft.cert = null;
    renderBook();
    $('#usesub')?.focus();
  } else if (t.id === 'pf-optin') {
    draft.pfOptIn = t.checked;
  } else if (t.id === 'usebonus' || t.id === 'usemoney') {
    draft[t.id === 'usebonus' ? 'useBonus' : 'useMoney'] = t.checked;
    renderBook();
    $(`#${t.id}`)?.focus();
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
  if (e.target.id === 'pf-name') draft.pfName = e.target.value;
  if (e.target.id === 'pf-phone') draft.pfPhone = e.target.value;
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
  if (e.target.id === 'wait-form') {
    e.preventDefault();
    const f = new FormData(e.target);
    const from = Number(f.get('from'));
    const to = Number(f.get('to'));
    const minutes = Number(e.target.dataset.minutes);
    if (to - from < minutes) { toast(`Проміжок має вміщати ${duration(minutes)}`); return; }
    const p = placeById(draft.placeId);
    const free = openStarts(p, draft.date, minutes, bookings).filter((t) => toMin(t) >= from && toMin(t) + minutes <= to);
    if (free.length) { draft.time = free[0]; renderBook(); toast(`У цьому проміжку є вільний час: ${free[0]} — можна записатися одразу`); return; }
    profile = { ...profile, name: f.get('name').trim(), phone: f.get('phone').trim() };
    store.set('profile', profile);
    const chosen = quote(p).chosen;
    store.set('waitlist', [...store.get('waitlist', []), {
      id: uid(), placeId: p.id, date: draft.date, from, to, minutes, services: chosen.map((x) => x.name), clientName: profile.name, phone: profile.phone,
      clientKey: myKeys()[0], status: 'active', mine: true, createdAt: Date.now(),
    }]);
    draft.waitOpen = false;
    renderBook();
    toast('Готово! Повідомимо, щойно звільниться час');
    return;
  }
  if (e.target.id === 'queue-join') {
    e.preventDefault();
    const p = placeById(e.target.dataset.place);
    const svc = p.services.find((x) => x.id === new FormData(e.target).get('service'));
    const entry = {
      id: uid(), day: isoDate(new Date()), plate: cars[0]?.plate || (cars[0] ? carLabel(cars[0]) : profile.name || 'Клієнт CARCAR'), car: cars[0] ? carLabel(cars[0]) : '',
      service: svc.name, minutes: svc.min, status: 'waiting', joinedAt: Date.now(), source: 'app', clientName: profile.name, phone: profile.phone,
    };
    saveQueue(p.id, [...(store.get('biz.queue', {})[p.id] ?? []).filter((q) => q.day === entry.day), entry]);
    store.set('queue.mine', [...myQueue(), { id: entry.id, placeId: p.id }]);
    route();
    toast('Ви в черзі — точка бачить ваше авто');
    return;
  }
  if (e.target.id === 'askform' || e.target.matches('.req-reply')) {
    e.preventDefault();
    const f = new FormData(e.target);
    const msg = { from: 'client', text: f.get('text').trim(), at: Date.now() };
    if (e.target.id === 'askform') {
      profile = { ...profile, name: f.get('name').trim(), phone: f.get('phone').trim() };
      store.set('profile', profile);
      requests.push({
        id: uid(), placeId: e.target.dataset.place, clientName: profile.name, clientPhone: profile.phone,
        car: cars[0] ? carLabel(cars[0]) : '', cls: cars[0]?.cls ?? ui.cls, messages: [msg], at: msg.at, unreadBiz: true,
      });
    } else {
      const r = requests.find((x) => x.id === e.target.dataset.id);
      r.messages.push(msg);
      r.unreadBiz = true;
    }
    saveRequests();
    route();
    $('#ask')?.scrollIntoView({ block: 'start' });
    toast('Повідомлення надіслано точці');
    return;
  }
  if (e.target.id === 'profileform') {
    e.preventDefault();
    const f = new FormData(e.target);
    profile = { name: f.get('name').trim(), phone: f.get('phone').trim(), optIn: !!f.get('optIn') };
    store.set('profile', profile);
    route();
    toast('Профіль збережено');
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
  requests = store.get('requests', []);
  profile = { name: '', phone: '', optIn: false, ...store.get('profile', {}) };
  wallet = { bonus: 0, money: 0, history: [], ...store.get('wallet', {}) };
  applyOverrides();
  if (!draft?.paying) route();
});
route();
acceptInvite();

if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
