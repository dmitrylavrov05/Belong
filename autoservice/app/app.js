import { CITY, CITIES, CATEGORIES, CAR_CLASSES, PLACES, PAYMENT, MAINTENANCE, REFERRAL } from './data.js';
import {
  store, icon, esc, uah, pad, hhmm, toMin, isoDate, parseDate, uid, placeById, plural, duration, dayLabel, rating, tel,
  hoursFor, scheduleOf, inBreak, rangeText, WEEKDAY_NAMES, weekdayOf, phoneKey, offersOf, offerAsService, isOpenNow, hoursText, bookingStart, fmtTime, fmtDate, km, serviceCat, catById, shrinkPhoto,
  applyOverrides, isListed, payoutReady, maskIban, commissionFor, resolveDispute, visibleReviews, ACTIVE, BLOCKING, HOUR, isCarcar, price, complete, isFrozen, placeShare, balanceFor, settleAll, ratingFor,
  POWER, powerOf, worksInBlackout, TICKET_TOPICS, CLIENT_TOPICS, TICKET_STATUS, ticketsAll, openTicket, ticketReply, setTicket, isBlocked, mobileOn, spanOf, laneCap, sameLane, MOBILE_ROAD, promosAll, promoCheck, promoText,
  enterView, bizApps, saveBizApps, APP_STATUS,
} from './core.js';
import {
  CHANNELS, inboxFor, markRead, sendMessages, dealsOf, dealsOn, weeklyDealsOf, daysText, dealAt, dealPrice, dealCovers, hotDeals,
  checkWaitlist, openStarts, passesOf, sellPass, passActive, passLeft, usableSubs, findCert, redeemPass, restorePass,
  chatPost, chatTimeline, readMessages, msgPreview, presenceOf, PRESENCE_KEY, CLIENT_QUICK, ITEM_KIND, itemSum, estimateTotal, warrantyUntil,
} from './ops.js';
import { mountMap } from './map.js';
import { lookupPlate, normPlate, DEMO_PLATES } from './vehicles.js';

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

const ui = { view: store.get('view', 'list'), cat: 'all', q: '', sort: 'rating', openNow: false, favOnly: false, cls: store.get('cls', 0), city: store.get('city', 'Київ'), carId: store.get('carId', null), partner: store.get('partner', null) };
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
    : '';
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
// Час у дорозі містом: дорога приблизно на третину довша за пряму, середня швидкість у Києві ~25 км/год.
const driveMin = (d) => Math.max(2, Math.round(((d * 1.3) / 25) * 60) + 2);
const travelText = (p) => {
  const d = distTo(p);
  return d === null ? '' : `${driveMin(d)} хв · <span class="badge dist">${fmtDist(d)}</span>${ui.posFallback ? ' від центру' : ''}`;
};

// Місце користувача тримаємо лише в памʼяті й нікуди не надсилаємо.
// silent — тихо, без підказки: так застосунок сам визначає місце, щоб показати відстань на картках.
function locate(silent = false) {
  if (ui.locating) return;
  ui.locating = true;
  const done = (pos, fallback) => {
    Object.assign(ui, { pos, posFallback: fallback, locating: false });
    if ($('#list')) renderList();
    else if (/^#\/place\//.test(location.hash)) route();
    if (fallback && !silent) toast('Не вдалося визначити, де ви. Рахуємо відстань від центру міста');
  };
  if (!navigator.geolocation) { done(cityOf().center, true); return; }
  navigator.geolocation.getCurrentPosition(
    (p) => done({ lat: p.coords.latitude, lng: p.coords.longitude }, false),
    () => done(cityOf().center, true),
    { timeout: 8000, maximumAge: 300000 },
  );
}

function setSort(value) {
  ui.sort = value;
  if (value === 'near' && (!ui.pos || ui.posFallback)) locate();
  if ($('#sort')) $('#sort').value = value;
  const near = $('[data-action="near"]');
  if (near) near.setAttribute('aria-pressed', value === 'near');
  renderList();
}

// Вільні вікна за графіком точки, крок 30 хвилин. Вікно зайняте, якщо до нього менше
// мінімального часу запису, воно потрапляє на перерву, у клієнта тут уже є свій запис
// або на цей час не лишилося вільних боксів за журналом точки (записи CARCAR і з CRM).
// Для виїзду рахуємо вільні бригади з урахуванням дороги; skip — запис, який переносять.
function slotsFor(place, date, minutes, { skip = null, mobile = false } = {}) {
  const hours = hoursFor(place, date);
  if (!hours) return [];
  const [open, close] = hours;
  const { lead } = scheduleOf(place);
  const now = new Date();
  const today = date === isoDate(now);
  const nowMin = now.getHours() * 60 + now.getMinutes();
  const atPlace = bookings.filter((b) => b.placeId === place.id && b.date === date && b !== skip);
  const own = atPlace.filter((b) => !b.source && ACTIVE.includes(b.state)).map((b) => [toMin(b.time), toMin(b.time) + b.minutes]);
  const all = atPlace.filter((b) => BLOCKING.includes(b.state) && sameLane(b, mobile)).map(spanOf);
  const need = minutes + (mobile ? MOBILE_ROAD : 0);
  const slots = [];
  for (let t = open; t + minutes <= close; t += 30) {
    const overlaps = (list, len) => list.filter(([s, e]) => t < e && t + len > s).length;
    const busy =
      (today && t < nowMin + lead) ||
      inBreak(place, t, minutes) ||
      overlaps(own, minutes) > 0 ||
      overlaps(all, need) >= laneCap(place, mobile);
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
// 'device' — сповіщення самого застосунку (нагадування, відповіді на відгуки) навіть без телефону в профілі.
const myKeys = () => [phoneKey(profile.phone), ...cars.map((c) => `car:${carLabel(c)}`), 'device'].filter(Boolean);
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
const moneyCard = () => `<section class="card balance-card" aria-label="Баланс CARCAR">
    <div class="head"><span>Баланс CARCAR</span><b class="bonus-sum">${uah(wallet.money)}</b></div>
    <p class="fine">Сюди повертаються гроші за скасовані записи. Ними можна оплатити наступну мийку або вивести на картку.</p>
    ${wallet.money > 0 ? `<button class="btn" data-action="money-out">${icon('card', 18)}Вивести ${uah(wallet.money)} на картку</button>` : ''}
    <ul class="ledger">${wallet.history.filter((h) => h.kind === 'money').slice(0, 5).map((h) => `<li><span>${esc(h.text)}<small>${fmtTime(h.at)}</small></span>
      <b class="${h.amount > 0 ? 'plus' : ''}">${h.amount > 0 ? '+' : '−'}${uah(Math.abs(h.amount))}</b></li>`).join('') || '<li class="muted small">Операцій ще не було.</li>'}</ul>
  </section>`;

// Гаманець — окремий екран у профілі: баланс, бонуси й запрошення друзів.
function viewWallet() {
  return `${back('#/garage', 'Гараж')}<h1>Гаманець</h1>
    ${moneyCard()}
    <section class="card balance-card" aria-label="Бонуси" style="margin-top:12px">
      <div class="head"><span>Бонуси</span><b class="bonus-sum">${uah(wallet.bonus)}</b></div>
      <p class="fine">${wallet.bonus ? `Спишуться під час оплати замовлення від ${uah(REFERRAL.minOrder)}.` : 'Бонуси дають за друзів, яких ви запросили.'}</p>
    </section>
    <div style="margin-top:12px">${inviteCard()}</div>`;
}

// Вхід у гаманець з профілю: одразу видно, скільки грошей і бонусів.
const walletLink = () => `<a class="card link-card wallet-link" href="#/wallet">${icon('card', 24)}<span>Гаманець
    <small>Баланс ${uah(wallet.money)}${wallet.bonus ? ` · бонуси ${uah(wallet.bonus)}` : ''}</small></span>${icon('chevR', 18)}</a>`;

const inviteLink = () => `${location.origin}${location.pathname}?ref=${referral.code}`;

// Скільки бонусу можна списати із замовлення на суму total.
const bonusFor = (total) => (total >= REFERRAL.minOrder ? Math.min(wallet.bonus, REFERRAL.bonus, total) : 0);

// Друг відкрив застосунок за посиланням ?ref=КОД: новому користувачу — бонус на перше замовлення.
// Рекламна кампанія CARCAR: посилання ?c=кампанія&promo=КОД. Запамʼятовуємо на 30 днів (остання кампанія),
// промокод кампанії застосовується під час оплати, а запис отримує позначку кампанії — для розрахунку CAC.
const CAMPAIGN_DAYS = 30;
function acceptCampaign() {
  const q = new URLSearchParams(location.search);
  const c = q.get('c');
  const code = q.get('promo');
  if (!c && !code) return;
  store.set('campaign', { id: c ?? null, code: code ? code.trim().toUpperCase() : null, at: Date.now() });
  track('campaign_visit', { c: c ?? null, code: code ? code.trim().toUpperCase() : null });
  if (!q.get('ref')) history.replaceState(null, '', location.pathname + location.hash);
}
const campaignNow = () => {
  const x = store.get('campaign', null);
  return x && Date.now() - x.at < CAMPAIGN_DAYS * 864e5 ? x : null;
};

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

function filteredPlaces() {
  const q = ui.q.trim().toLowerCase();
  const list = PLACES.filter((p) => {
    if (!isListed(p)) return false;
    if ((p.city ?? 'Київ') !== ui.city) return false;
    if (ui.blackout && !worksInBlackout(p)) return false;
    if (ui.mobileOnly && !mobileOn(p)) return false;
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

// Обкладинки точок: намальовані сцени (фасад із боксами, авто в піні, блиск після мийки).
// У робочій версії тут фото, які завантажує точка; кольори сцени залежать від точки.
const SKIES = [['#8fb8e8', '#e8f1fb'], ['#f3a978', '#fde3c8'], ['#7d8fd0', '#dfe4f7'], ['#86cbbd', '#e3f4ef'], ['#b59ad8', '#efe6fa']];
const SIGNS = ['#c8402b', '#1e3a5f', '#0f7b6c', '#6b4bc8', '#b45309'];
const BODIES = ['#1f2937', '#c8402b', '#d1d5db', '#2563eb', '#475569', '#f5f5f4'];
const CAR = 'M60 168Q62 134 104 127L146 99Q157 90 176 90L252 90Q271 90 285 102L318 127Q348 131 352 156L354 166Q354 174 345 174L74 174Q60 174 60 168Z';
const GLASS = '<path d="M154 104L178 98H220V126H136Z" fill="#cfe3f7" opacity=".9"/><path d="M228 98H254Q265 98 275 106L296 126H228Z" fill="#cfe3f7" opacity=".9"/>';
const wheels = () => [118, 300].map((x) => `<circle cx="${x}" cy="174" r="23" fill="#111827"/><circle cx="${x}" cy="174" r="10" fill="#9ca3af"/>`).join('');

function hashStr(str) {
  let x = 2166136261;
  for (const ch of str) x = Math.imul(x ^ ch.charCodeAt(0), 16777619);
  return x >>> 0;
}

function coverArt(p, i) {
  const h = hashStr(p.id);
  const [sky1, sky2] = SKIES[h % SKIES.length];
  const sign = SIGNS[(h >> 3) % SIGNS.length];
  const body = BODIES[(h >> 5) % BODIES.length];
  const id = `${p.id}${i}`;
  const bubbles = (n, y0, y1, seed) => Array.from({ length: n }, (_, k) => {
    const r = 6 + ((seed * (k + 3) * 37) % 17);
    const x = 40 + ((seed * (k + 7) * 53) % 330);
    const y = y0 + ((seed * (k + 5) * 29) % (y1 - y0));
    return `<circle cx="${x}" cy="${y}" r="${r}" fill="url(#bub${id})"/>`;
  }).join('');
  const defs = `<defs><linearGradient id="sky${id}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${sky1}"/><stop offset="1" stop-color="${sky2}"/></linearGradient>
    <radialGradient id="bub${id}" cx=".35" cy=".3" r=".75"><stop offset="0" stop-color="#fff" stop-opacity=".95"/><stop offset=".25" stop-color="#fff" stop-opacity=".45"/><stop offset=".8" stop-color="#fff" stop-opacity=".12"/><stop offset="1" stop-color="#fff" stop-opacity=".55"/></radialGradient>
    <linearGradient id="gl${id}" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#fff" stop-opacity="0"/><stop offset=".5" stop-color="#fff" stop-opacity=".75"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></linearGradient></defs>`;
  let scene;
  if (i === 0) {
    const bays = [0, 1, 2].map((k) => `<rect x="${58 + k * 100}" y="92" width="86" height="96" rx="3" fill="#cdd5df"/>${[0, 1, 2, 3, 4, 5].map((j) => `<rect x="${58 + k * 100}" y="${96 + j * 15}" width="86" height="2" fill="#b4bfcc"/>`).join('')}`).join('');
    scene = `<rect width="400" height="220" fill="url(#sky${id})"/>
      <rect x="40" y="60" width="320" height="140" rx="6" fill="#eef1f5"/><rect x="40" y="52" width="320" height="26" rx="6" fill="${sign}"/>
      <rect x="150" y="59" width="100" height="12" rx="6" fill="#fff" opacity=".85"/>${bays}
      <rect y="196" width="400" height="24" fill="#9aa4b1"/><rect y="196" width="400" height="3" fill="#cbd2db"/>
      <g transform="translate(70 30) scale(.62)"><path d="${CAR}" fill="${body}"/>${GLASS}${wheels()}</g>`;
  } else if (i === 1) {
    scene = `<rect width="400" height="220" fill="#24435f"/><rect width="400" height="220" fill="url(#sky${id})" opacity=".35"/>
      <g transform="translate(0 12)"><path d="${CAR}" fill="${body}"/>${GLASS}${wheels()}</g>
      <path d="M40 150Q90 92 160 104Q210 70 270 98Q330 86 362 140Q330 120 300 132Q250 110 210 128Q160 112 120 132Q80 124 40 150Z" fill="#fff" opacity=".92"/>
      ${bubbles(16, 40, 190, (h % 13) + 3)}
      ${Array.from({ length: 9 }, (_, k) => `<path d="M${30 + k * 44} ${10 + (k % 3) * 12}l-6 20" stroke="#bfe0ff" stroke-width="3" stroke-linecap="round" opacity=".6"/>`).join('')}`;
  } else {
    scene = `<rect width="400" height="220" fill="#111827"/><circle cx="200" cy="40" r="160" fill="${sign}" opacity=".28"/>
      <g transform="translate(0 6)"><path d="${CAR}" fill="${body}"/>${GLASS}${wheels()}<path d="M100 132Q200 112 330 132" stroke="url(#gl${id})" stroke-width="6" fill="none"/></g>
      <ellipse cx="206" cy="204" rx="170" ry="10" fill="#000" opacity=".5"/>
      ${[[320, 70], [96, 84], [260, 56]].map(([x, y], k) => `<path d="M${x} ${y - 12 - k * 2}L${x + 3} ${y - 3}L${x + 12 + k * 2} ${y}L${x + 3} ${y + 3}L${x} ${y + 12 + k * 2}L${x - 3} ${y + 3}L${x - 12 - k * 2} ${y}L${x - 3} ${y - 3}Z" fill="#fff" opacity=".9"/>`).join('')}`;
  }
  return `<svg viewBox="0 0 400 220" preserveAspectRatio="xMidYMid slice" aria-hidden="true" focusable="false">${defs}${scene}</svg>`;
}

// Карусель обкладинок: гортається пальцем, крапки показують, яке фото зараз.
function coverCarousel(p, href, cls = '') {
  return `<div class="pc-cover ${cls}">
    <a class="pc-slides" href="${href}" aria-label="${esc(p.name)}">${[0, 1, 2].map((i) => `<div class="pc-slide">${coverArt(p, i)}</div>`).join('')}</a>
    <div class="pc-dots" aria-hidden="true"><i class="on"></i><i></i><i></i></div>
  </div>`;
}

function placeCard(p) {
  const open = isOpenNow(p);
  const d = ui.pos ? distTo(p) : null;
  const r = ratingOf(p.id);
  const deal = dealsOf(p.id).length ? Math.max(...dealsOf(p.id).map((x) => x.pct)) : 0;
  return `<article class="pcard">
    ${coverCarousel(p, `#/place/${p.id}`)}
    <div class="pc-top">
      ${deal ? `<span class="badge deal">${icon('bolt', 13)}−${deal}%</span>` : ''}
      ${mobileOn(p) ? `<span class="badge mobile">${icon('carSide', 13)}Виїзд до вас</span>` : ''}
      ${powerBadge(p)}
    </div>
    ${favButton(p, true)}
    <div class="pc-info">
      <h2 class="pc-title">${esc(p.name)}${r.count ? `<span class="pc-rate">${icon('star', 14)}${rating(r.avg)}</span>` : ''}</h2>
      <span class="pc-line">${icon('clock', 14)}<span>${open ? '' : 'Зачинено · '}${hoursText(p)}</span><span>· від ${uah(minPrice(p, ui.cat, ui.cls))}</span></span>
      ${d !== null ? `<span class="pc-line">${icon('carSide', 14)}${travelText(p)}</span>` : ''}
      <span class="pc-line">${icon('pin', 14)}${esc(p.address)}</span>
    </div>
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
    <div class="hot-row">${list.map(({ place: p, deal: d, free }) => `<a class="card hot-card" href="#/book/${p.id}/${d.date}/${free[0]}" data-track="hot_click" data-place="${p.id}">
      <span class="hot-pct">−${d.pct}%</span>
      <b>${esc(p.name)}</b>
      <span class="small">${when(d.date)} · ${hhmm(d.from)}–${hhmm(d.to)}</span>
      <span class="small muted">вільно з ${free[0]}${d.services?.length ? ` · ${d.services.length} ${plural(d.services.length, 'послуга', 'послуги', 'послуг')}` : ' · усі послуги'}</span>
    </a>`).join('')}</div>
  </section>`;
}

// ---------- промокоди CARCAR ----------

const promoFor = (pr, place, items) => promoCheck(pr, { place, items, mine: mine(), all: bookings });
const ALL_CATS = CATEGORIES.map((c) => c.id);

// Акція, яка діє для цього клієнта автоматично (наприклад, перша мийка), — банер на головній.
function promoBanner() {
  const pr = promosAll().find((x) => x.auto && promoFor(x, { cats: x.cats?.length ? x.cats : ALL_CATS }, [{ cat: x.cats?.[0] ?? 'wash', price: 1e6 }]).ok);
  if (!pr) return '';
  const one = pr.cats?.length === 1 ? pr.cats[0] : null;
  return `<a class="banner promo-banner" href="#/" ${one ? `data-action="cat" data-cat="${one}"` : ''}>
    <span class="banner-ic">${icon('gift', 22)}</span>
    <span><b>${esc(pr.title)}</b><span class="small">Знижка застосується автоматично під час оплати</span></span>
    ${icon('chevR', 18)}</a>`;
}

// ---------- анонімна статистика ----------

// Події для зведеної статистики CARCAR: без імен і телефонів, лише що відкривали й що натискали.
// Зберігаємо останні 5000 подій на пристрої; у робочій версії їх приймає сервер.
function track(type, data = {}) {
  const all = store.get('analytics', []);
  all.push({ t: type, at: Date.now(), ...data });
  store.set('analytics', all.slice(-5000));
}

// ---------- карта ----------

let mapApi = null;
const mapState = { layer: store.get('mapLayer', undefined) };

function mapPin(p) {
  const open = isOpenNow(p);
  const cat = catById(p.cats[0]);
  const deal = dealsOf(p.id).length ? Math.max(...dealsOf(p.id).map((d) => d.pct)) : 0;
  const pw = powerOf(p.id);
  const r = ratingOf(p.id);
  return {
    id: p.id, lat: p.lat, lng: p.lng, cls: `c-${p.cats[0]}${open ? '' : ' shut'}`,
    html: `<span class="pin-shape">${icon(cat.icon, 16)}</span>${deal ? `<span class="pin-deal">−${deal}%</span>` : ''}${pw && pw.state !== 'closed' ? `<span class="pin-bolt">${icon('bolt', 11)}</span>` : ''}`,
    label: esc(`${p.name}: ${cat.name.toLowerCase()}, ${open ? 'відчинено' : 'зачинено'}, від ${uah(minPrice(p, ui.cat, ui.cls))}${r.count ? `, рейтинг ${rating(r.avg)}` : ''}${deal ? `, знижка до ${deal}%` : ''}`),
  };
}

function mapCard(id) {
  const p = placeById(id);
  if (!p) return '<p class="small muted map-empty">Натисніть на точку на карті, щоб побачити деталі.</p>';
  const maps = `${CITY.mapsSearch}${encodeURIComponent(`${p.city ?? ui.city}, ${p.address}`)}`;
  return `${placeCard(p)}
    <div class="grid2" style="margin-top:8px"><a class="btn primary" href="#/book/${p.id}">Записатися</a>
      <a class="btn" href="${maps}" target="_blank" rel="noopener">${icon('route', 18)}Маршрут</a></div>`;
}

function renderMap(list) {
  if (!$('#map')) {
    $('#list').innerHTML = `<div class="map" id="map" tabindex="0" role="region" aria-label="Карта точок. Стрілки зсувають карту, плюс і мінус змінюють масштаб"></div>
      <div id="map-card" aria-live="polite"></div>`;
    mapApi = mountMap($('#map'), {
      places: list.map(mapPin), pos: ui.posFallback ? null : ui.pos, state: mapState, city: ui.city, center: cityOf().center, onLayer: (l) => store.set('mapLayer', l),
      onSelect: (id) => { $('#map-card').innerHTML = mapCard(id); track('map_pin', { placeId: id }); },
    });
  } else mapApi.setPins(list.map(mapPin));
  if (mapState.sel && !list.some((p) => p.id === mapState.sel)) mapState.sel = null;
  $('#map-card').innerHTML = mapCard(mapState.sel);
}

function renderList() {
  const list = filteredPlaces();
  if (ui.view === 'map') renderMap(list);
  else $('#list').innerHTML = list.length ? list.map(placeCard).join('')
    : !PLACES.some((p) => isListed(p) && (p.city ?? 'Київ') === ui.city)
      ? `<div class="empty city-empty">${icon('pin', 32)}<b>У місті ${esc(ui.city)} ми ще не працюємо</b>
          <span>Мийки тут поки не підключились. Знаєте хорошу мийку? Розкажіть їм про CARCAR.</span>
          <a class="btn" href="#/business">Для власників мийок</a></div>`
      : empty('search', 'Нічого не знайшли. Спробуйте інші фільтри.');
  const where = ui.sort !== 'near' ? '' : ui.locating ? ' · шукаємо, де ви…' : ui.pos ? ` · від ${ui.posFallback ? 'центру міста' : 'вас'}` : '';
  $('#count').textContent = `${list.length} ${plural(list.length, 'мийка', 'мийки', 'мийок')}${where}`;
}

// Авто з гаража, для якого показуємо ціни на головній і з якого починається запис.
const mainCar = () => cars.find((c) => c.id === ui.carId) ?? cars[0] ?? null;
function pickCar(id) {
  const car = cars.find((c) => c.id === id);
  if (!car) return;
  ui.carId = car.id;
  ui.cls = car.cls;
  store.set('carId', ui.carId);
  store.set('cls', ui.cls);
}

// Місто: обирається в шапці й запамʼятовується; каталог показує мийки лише цього міста.
const cityOf = (name = ui.city) => CITIES.find((c) => c.name === name) ?? CITIES[0];
function renderCity() {
  $('#city').innerHTML = `<label class="city-pick">${icon('pin', 18)}<span class="sr-only">Місто</span><select id="city-sel">
    ${CITIES.map((c) => `<option ${c.name === ui.city ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select></label>`;
}

function viewCatalog() {
  const chip = (label, attrs, on) => `<button class="chip" ${attrs} aria-pressed="${on}">${label}</button>`;
  return `<h1 class="sr-only">Автомийки, ${esc(ui.city)}</h1>
    <div class="search-row">
      <label class="search">${icon('search', 20)}
        <input id="q" type="search" placeholder="Пошук мийки або послуги" aria-label="Пошук" value="${esc(ui.q)}"></label>
      <span class="view-toggle" role="group" aria-label="Вигляд">
        <button data-action="view" data-v="list" aria-pressed="${ui.view !== 'map'}" aria-label="Список">${icon('list', 20)}</button>
        <button data-action="view" data-v="map" aria-pressed="${ui.view === 'map'}" aria-label="Карта">${icon('map', 20)}</button>
      </span>
    </div>
    <div class="chips" role="group" aria-label="Фільтри">
      ${chip(`${icon('pin', 16)}Поруч`, 'data-action="near"', ui.sort === 'near')}
      ${CATEGORIES.length > 1 ? `${chip('Усі', 'data-action="cat" data-cat="all"', ui.cat === 'all')}
      ${CATEGORIES.map((c) => chip(`${icon(c.icon, 16)}${c.name}`, `data-action="cat" data-cat="${c.id}"`, ui.cat === c.id)).join('')}` : ''}
      ${chip('Відчинено зараз', 'data-action="toggle" data-key="openNow"', ui.openNow)}
      ${chip(`${icon('carSide', 16)}Виїзд до вас`, 'data-action="toggle" data-key="mobileOnly"', !!ui.mobileOnly)}
      ${chip(`${icon('bolt', 16)}Працює при відключеннях`, 'data-action="toggle" data-key="blackout"', !!ui.blackout)}
      ${chip(`${icon('heart', 16)}Обране`, 'data-action="toggle" data-key="favOnly"', ui.favOnly)}
    </div>
    <div class="toolbar">
      <span class="small muted" id="count"></span>
      <span class="row">
        ${cars.length ? `<label class="car-pick">${icon('carSide', 18)}<select id="maincar" aria-label="Ваше авто — ціни для нього">
          ${cars.map((c) => `<option value="${c.id}" ${c.id === mainCar().id ? 'selected' : ''}>${esc(carLabel(c))}</option>`).join('')}
          <option value="__add">+ Додати авто</option>
        </select></label>`
          : `<a class="car-pick add" href="#/garage/add">${icon('plus', 18)}Додати своє авто</a>`}
        <select id="sort" class="pill-select" aria-label="Сортування">
          <option value="rating" ${ui.sort === 'rating' ? 'selected' : ''}>За рейтингом</option>
          <option value="price" ${ui.sort === 'price' ? 'selected' : ''}>Спочатку дешевші</option>
          <option value="reviews" ${ui.sort === 'reviews' ? 'selected' : ''}>За відгуками</option>
          <option value="near" ${ui.sort === 'near' ? 'selected' : ''}>Найближчі</option>
        </select>
      </span>
    </div>
    ${hotBlock()}
    ${promoBanner()}
    ${wallet.bonus ? `<a class="bonus-banner" href="#/invite">${icon('gift', 20)}<span>У вас ${uah(wallet.bonus)} бонусу — спишеться під час оплати замовлення від ${uah(REFERRAL.minOrder)}</span></a>` : ''}
    <div id="list" class="stack"></div>
    <p class="note">Демо: назви мийок, адреси й телефони вигадані.</p>`;
}

// ---------- сторінка бізнесу ----------

const reviewPhotos = (r) => (r.photos?.length ? `<div class="photos review-photos">${r.photos.map((src, i) => `<img src="${esc(src)}" alt="Фото клієнта ${i + 1}">`).join('')}</div>` : '');

function reviewItem(r) {
  return `<article class="review">
    <div class="head">${stars(r.stars)}<span class="small muted">${fmtDate(r.date)}</span></div>
    ${r.text ? `<p>${esc(r.text)}</p>` : ''}
    ${reviewPhotos(r)}
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
  const maps = `${CITY.mapsSearch}${encodeURIComponent(`${p.city ?? ui.city}, ${p.address}`)}`;
  const groups = CATEGORIES.map((c) => [c, p.services.filter((s) => serviceCat(s) === c.id)]).filter(([, s]) => s.length);
  const list = visibleReviews(reviews).filter((r) => r.placeId === p.id).sort((a, b) => b.at - a.at);
  const todayH = hoursFor(p, isoDate(new Date()));
  return `<div class="topbar">${back('#/', 'Усі місця')}${favButton(p, false)}</div>
    ${coverCarousel(p, `#/book/${p.id}`, 'hero')}
    <h1>${esc(p.name)}</h1>
    ${list.length || ui.pos ? `<div class="meta lg" style="margin-top:-4px">
      ${ratingBadge(p.id)}
      ${ui.pos ? `<span class="travel">${icon('carSide', 16)}${travelText(p)}</span>` : ''}
    </div>` : ''}
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
    ${personalFor(p).length ? `<h2 class="big">Тільки для вас</h2>
      <div class="list personal-list" style="margin-top:10px">${personalFor(p).map((s) => `<div class="item">
        <span class="name"><span class="badge personal">Для вас</span> ${esc(s.name)}<small>${duration(s.min)}${s.note ? ` · ${esc(s.note)}` : ''}</small></span>
        <span class="price">${uah(s.price[0])}</span></div>`).join('')}</div>` : ''}
    ${dealsCard(p)}
    <h2 class="big" id="services">Послуги та ціни</h2>
    <p class="small muted" style="margin:-6px 0 0">${mainCar() ? `Для вашого авто ${esc(carLabel(mainCar()))}` : `Для класу «${CAR_CLASSES[ui.cls]}» · <a href="#/garage/add">додайте своє авто</a>, щоб бачити ціни для нього`}</p>
    ${groups.map(([c, items]) => `
      ${groups.length > 1 ? `<h3 class="cat-label">${icon(c.icon, 15)}${c.name}</h3>` : ''}
      <div class="list" style="margin-top:10px">
        ${items.map((s) => `<div class="item">
          <span class="name">${esc(s.name)}<small>${duration(s.min)}</small></span>
          <span class="price">${uah(s.price[ui.cls])}</span>
        </div>`).join('')}
      </div>`).join('')}
    ${mobileOn(p) ? `<section class="card mobile-card" aria-label="Виїзд до вас">${icon('carSide', 22)}<div><b>Можемо приїхати до вас</b>
      <span class="small">У радіусі ${p.mobile.radiusKm} км, виїзд +${uah(p.mobile.fee)}. Оберіть «Виїзд до мене» під час запису.</span></div></section>` : ''}
    ${passesBlock(p)}
    <h2 class="big" id="reviews">Відгуки</h2>
    ${ratingSummary(p.id)}
    <div class="stack">${list.map(reviewItem).join('')}</div>
    <details class="fold" id="hours"><summary>${icon('calendar', 20)}Графік роботи<span class="fold-note">${todayH ? `сьогодні ${rangeText(todayH)}` : 'сьогодні вихідний'}</span></summary>
      ${scheduleBlock(p)}</details>
    ${askBlock(p)}
    <div class="dock-space"></div>
    <div class="dock">${isListed(p) ? `<a class="btn primary block" href="#/book/${p.id}">Записатися онлайн</a>`
      : '<p class="notice" style="margin:0">Точка зараз не приймає онлайн-записи в CARCAR.</p>'}</div>`;
}

// ---------- знижки за годинами ----------

// Картка знижок точки: щотижневі щасливі години й разові гарячі вікна.
function dealsCard(p) {
  const weekly = weeklyDealsOf(p.id);
  const once = dealsOf(p.id).filter((d) => d.date).sort((a, b) => (a.date + a.from).localeCompare(b.date + b.from));
  if (!weekly.length && !once.length) return '';
  const svc = (d) => (d.services?.length ? d.services.map((id) => p.allServices.find((x) => x.id === id)?.name).filter(Boolean).map(esc).join(', ') : 'усі послуги');
  const row = (when, d) => `<li><span class="dc-pct">−${d.pct}%</span><span><b>${when}, ${hhmm(d.from)}–${hhmm(d.to)}</b><small>${svc(d)}</small></span></li>`;
  return `<section class="card deals-card" aria-labelledby="h-deals">
    <h2 id="h-deals" class="car-name">${icon('bolt', 20)}Знижки за годинами</h2>
    <ul>${weekly.map((d) => row(daysText(d.days), d)).join('')}${once.map((d) => row(dayLabel(d.date, { weekday: 'short', day: 'numeric', month: 'long' }), d)).join('')}</ul>
    <a class="btn" href="#/book/${p.id}">Обрати час зі знижкою</a>
  </section>`;
}

// Смуга дня на сторінці запису: робочі години й відрізки зі знижкою.
function dayDealsBar(p, date) {
  const h = hoursFor(p, date);
  const deals = dealsOn(p.id, date);
  if (!h || !deals.length) return '';
  const span = h[1] - h[0];
  const pos = (t) => `${((Math.max(h[0], Math.min(h[1], t)) - h[0]) / span) * 100}%`;
  return `<div class="day-deals">
    <div class="dd-track" aria-hidden="true">${deals.map((d) => `<b style="left:${pos(d.from)};width:calc(${pos(d.to)} - ${pos(d.from)})">−${d.pct}%</b>`).join('')}
      <i style="left:0">${hhmm(h[0])}</i><i style="right:0">${hhmm(h[1])}</i></div>
    <p class="dd-text">${icon('bolt', 16)}${deals.map((d) => `−${d.pct}% з ${hhmm(d.from)} до ${hhmm(d.to)}${d.services?.length ? ' на окремі послуги' : ''}`).join(' · ')}</p>
  </div>`;
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

const ASK_QUICK = ['Чи робите хімчистку салону?', 'Чи можна помити автобудинок?', 'Чи відмиєте сліди фарби?', 'Чи є мийка двигуна?'];

// Посилання на сторінці точки: відкриває окремий чат із мийкою.
function askBlock(p) {
  const unread = requestsOf(p.id).some((r) => r.unreadClient);
  return `<a class="card link-card ask-link" href="#/ask/${p.id}">${icon('chat', 22)}<span>Не знайшли потрібну послугу?
    <small>Напишіть мийці в чат — відповідь прийде сюди й у «Повідомлення»</small></span>
    ${unread ? '<span class="count" aria-label="нова відповідь">1</span>' : ''}${icon('chevR', 18)}</a>`;
}

// Окремий екран чату з мийкою про послугу, якої немає в прайсі. Усі запити до точки — однією стрічкою.
function viewAsk(id) {
  const p = placeById(id);
  if (!p) return viewNotFound();
  const list = requestsOf(p.id).reverse();
  // Клієнт відкрив чат — відповіді мийки прочитані.
  if (list.map((r) => readMessages(r.messages, 'biz')).some(Boolean)) saveRequests();
  const rows = list.flatMap((r) => [
    ...r.messages,
    ...(r.service ? [{ from: 'svc', at: r.service.at ?? r.messages.at(-1).at, service: r.service }] : []),
    ...(r.closed ? [{ from: 'mark', at: r.closedAt ?? r.messages.at(-1).at, text: 'Запит закрито' }] : []),
  ]);
  const lastOwn = rows.findLast((m) => m.from === 'client');
  let lastDay = '';
  const items = rows.map((m) => {
    const day = isoDate(new Date(m.at));
    const sep = day !== lastDay ? `<li class="day-sep"><span>${dayName(day)}</span></li>` : '';
    lastDay = day;
    if (m.from === 'mark') return `${sep}<li class="chat-mark closed">${icon('x', 14)}<b>${esc(m.text)}</b></li>`;
    if (m.from === 'svc') {
      return `${sep}<li class="svc-offer">${icon('checkCircle', 22)}<div><b>${esc(m.service.name)} — ${uah(m.service.price)}</b>
        <span>${m.service.personal ? 'Персональна послуга для вас' : 'Послугу додано до прайсу мийки'}</span>
        <a class="btn primary" href="#/book/${p.id}">Записатися</a></div></li>`;
    }
    return `${sep}${bubble(m, p.name)}${m === lastOwn ? readLine(m) : ''}`;
  }).join('');
  const needContact = !profile.name || !profile.phone;
  return `<section class="chat-screen" aria-label="Чат з ${esc(p.name)}">
    <header class="chat-head">
      <button class="icon-btn" data-action="chat-back" aria-label="Назад">${icon('chevL', 24)}</button>
      ${avatar(p.name, presenceOf(p.id).online)}
      <div class="chat-who"><h1>${esc(p.name)}</h1>${presenceLine(p.id)}</div>
      <a class="icon-btn" href="${tel(p)}" aria-label="Зателефонувати">${icon('phone', 20)}</a>
    </header>
    <div class="chat-pin">${icon('chat', 16)}<span>Запит про послугу${list.length ? ` · ${reqStatus(list.at(-1))[1]}` : ''}</span></div>
    <ol class="chat-msgs" aria-label="Повідомлення">
      ${items || `<li class="chat-empty">${avatar(p.name)}<b>Не знайшли потрібну послугу?</b><span>Напишіть, що потрібно зробити. Мийка може додати послугу до прайсу або підготувати персональну ціну для вас.</span></li>`}
    </ol>
    <div class="chat-compose">
      ${rows.length ? '' : `<div class="quick" role="group" aria-label="Швидкі питання">${ASK_QUICK.map((t) => `<button class="chip" type="button" data-action="ask-quick" data-text="${esc(t)}">${esc(t)}</button>`).join('')}</div>`}
      <form class="ask-form" data-place="${p.id}">
        ${needContact ? `<div class="ask-contact">
          <label class="field"><span>Ваше імʼя</span><input name="name" required autocomplete="name" value="${esc(profile.name)}"></label>
          <label class="field"><span>Ваш телефон</span><input name="phone" type="tel" required autocomplete="tel" placeholder="+380" value="${esc(profile.phone)}"></label>
        </div>` : ''}
        <div class="chat-form">
          ${attachBtn()}
          <input name="text" required maxlength="600" autocomplete="off" placeholder="Що потрібно зробити?" aria-label="Повідомлення мийці">
          <button class="send-btn" type="submit" aria-label="Надіслати">${icon('send', 20)}</button>
        </div>
      </form>
      ${needContact ? '<p class="fine" style="margin:0">Мийка побачить імʼя й телефон, щоб відповісти. Персональну ціну ви побачите за цим телефоном.</p>' : ''}
    </div>
  </section>`;
}

// Швидке питання чи фото надсилаються одразу, але спершу потрібні імʼя й телефон, якщо їх ще немає.
function askContactOk(form) {
  const contact = [...form.querySelectorAll('.ask-contact input')];
  const missing = contact.find((i) => !i.checkValidity());
  if (missing) { missing.reportValidity(); return false; }
  if (contact.length) {
    profile = { ...profile, name: form.elements.name.value.trim(), phone: form.elements.phone.value.trim() };
    store.set('profile', profile);
  }
  return true;
}

// Фото в чаті: зменшуємо до 720 px і надсилаємо разом із набраним текстом.
async function sendPhoto(input) {
  const file = input.files?.[0];
  if (!file) return;
  const form = input.closest('form');
  if (form.matches('.ask-form') && !askContactOk(form)) { input.value = ''; return; }
  const photo = await shrinkPhoto(file);
  if (!photo) { toast('Не вдалося відкрити фото'); return; }
  const text = form.elements.text.value.trim();
  if (form.matches('.ask-form')) askSend(form.dataset.place, text, photo);
  else sendChat(bookings.find((x) => x.id === form.dataset.id), text, photo);
}

// Перегляд фото на весь екран; закривається дотиком чи Escape.
function openPhoto(src) {
  const box = document.createElement('div');
  box.className = 'photo-view';
  box.setAttribute('role', 'dialog');
  box.setAttribute('aria-modal', 'true');
  box.setAttribute('aria-label', 'Фото');
  box.innerHTML = `<img src="${esc(src)}" alt="Фото"><button class="icon-btn" type="button" aria-label="Закрити">${icon('x', 24)}</button>`;
  const opener = document.activeElement;
  const close = () => { box.remove(); document.removeEventListener('keydown', onKey); opener?.focus(); };
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  box.addEventListener('click', close);
  document.addEventListener('keydown', onKey);
  document.body.append(box);
  box.querySelector('button').focus();
}

// Повідомлення мийці: дописуємо у відкритий запит або починаємо новий.
function askSend(placeId, text, photo = null) {
  if (!text && !photo) return;
  const msg = { from: 'client', text, at: Date.now(), ...(photo ? { photo } : {}) };
  const open = requestsOf(placeId).find((r) => !r.closed && !r.service);
  if (open) {
    open.messages.push(msg);
    open.unreadBiz = true;
  } else {
    requests.push({
      id: uid(), placeId, clientName: profile.name, clientPhone: profile.phone,
      car: cars[0] ? carLabel(cars[0]) : '', cls: cars[0]?.cls ?? ui.cls, messages: [msg], at: msg.at, unreadBiz: true,
    });
  }
  saveRequests();
  route();
  $('.ask-form [name="text"]')?.focus();
  track('ask', { placeId });
}

// Запити на сторінці «Мої записи»: де відповіли й куди повернутися.
function requestsCard() {
  if (!requests.length) return '';
  const list = [...requests].sort((a, b) => (b.messages.at(-1).at) - (a.messages.at(-1).at)).slice(0, 5);
  return `<h2>Запити про послуги</h2>
    <div class="stack" style="gap:8px">${list.map((r) => {
      const p = placeById(r.placeId);
      const [cls, label] = reqStatus(r);
      return `<a class="card link-card" href="#/ask/${r.placeId}">${icon('chat', 22)}<span>${esc(p?.name ?? 'Точка')}
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
  if (isBlocked(myKeys())) {
    return `${back(`#/place/${p.id}`, esc(p.name))}<h1>Запис обмежено</h1>
      <p class="notice warn">Служба безпеки CARCAR тимчасово обмежила онлайн-запис для цього профілю. Якщо це помилка — напишіть у підтримку, відповімо протягом доби.</p>
      <a class="btn primary" href="#/support">Написати в підтримку</a>`;
  }
  // Посилання з гарячого вікна чи листа очікування відкриває запис одразу на потрібний день і час.
  const prefill = date && bookingDays(p).includes(date);
  if (!draft || draft.placeId !== id || (prefill && draft.date !== date)) {
    draft = { placeId: id, services: new Set(), date: prefill ? date : firstOpenDay(p), time: null, wantTime: prefill ? time : null, carId: mainCar()?.id ?? null };
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
// Послуги для обраного формату: у точці — увесь прайс, на виїзді — лише ті, що точка робить у клієнта.
const mobileMode = () => draft?.mode === 'mobile' && mobileOn(placeById(draft.placeId));
const bookableIn = (p) => (mobileMode() ? p.services.filter((s) => p.mobile.services.includes(s.id)) : bookable(p));

// Адреса виїзду: чи вказана, чи позначена на карті й чи в радіусі точки.
function addrCheck(p) {
  const a = draft.addr ?? {};
  if (!a.text?.trim()) return { ok: false, why: 'Вкажіть адресу, куди приїхати' };
  if (a.lat == null) return { ok: false, why: 'Позначте місце на карті' };
  const d = distanceKm(p, a);
  if (d > p.mobile.radiusKm) return { ok: false, km: d, why: `Адреса за ${fmtDist(d)} від точки — виїзд лише в радіусі ${p.mobile.radiusKm} км` };
  return { ok: true, km: d };
}

function quote(p) {
  const cls = draftClass();
  const list = bookableIn(p);
  const chosen = list.filter((s) => draft.services.has(s.id));
  const minutes = chosen.reduce((a, s) => a + s.min, 0);
  const deal = draft.time ? dealAt(p.id, draft.date, draft.time) : null;
  const priceOf = (s) => (!s.personal && dealCovers(deal, s.id) ? dealPrice(s.price[cls], deal.pct) : s.price[cls]);
  const fee = mobileMode() && chosen.length ? p.mobile.fee : 0;
  const listTotal = chosen.reduce((a, s) => a + s.price[cls], 0) + fee;
  const total = chosen.reduce((a, s) => a + priceOf(s), 0) + fee;
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
  // Промокод CARCAR: введений клієнтом або акція, що діє автоматично; '' — клієнт відмовився.
  const items = chosen.map((s) => ({ cat: serviceCat(s), price: priceOf(s) }));
  let promo = null;
  let promoErr = null;
  if (chosen.length && draft.promo !== '') {
    // Код із рекламного посилання — якщо клієнт сам не ввів інший.
    const fromLink = draft.promo === undefined && campaignNow()?.code ? promosAll().find((x) => x.code === campaignNow().code && promoFor(x, p, items).ok) : null;
    const pr = draft.promo ? promosAll().find((x) => x.code === draft.promo) : fromLink ?? promosAll().find((x) => x.auto && promoFor(x, p, items).ok);
    const r = pr ? promoFor(pr, p, items) : draft.promo ? { ok: false, why: 'Такого промокоду немає' } : null;
    if (r?.ok) promo = { code: pr.code, title: pr.title, amount: Math.min(r.amount, total - covered) };
    else if (draft.promo) promoErr = r.why;
  }
  const rest = total - covered - (promo?.amount ?? 0);
  const bonus = draft.useBonus !== false ? bonusFor(rest) : 0;
  const fromBal = draft.useMoney !== false ? Math.min(wallet.money, rest - bonus) : 0;
  const card = rest - bonus - fromBal;
  // Оплата частинами — лише для дорогих послуг і лише карткою.
  const canParts = card >= PAYMENT.installments.minTotal;
  const parts = canParts && PAYMENT.installments.parts.includes(draft.parts) ? draft.parts : 0;
  const monthly = parts ? Math.ceil(card / parts) : 0;
  return {
    cls, list, chosen, minutes, deal: total < listTotal ? deal : null, listTotal, total, fee, subs, covered, use, promo, promoErr, rest, bonus, fromBal, card,
    canParts, parts, installments: parts ? { n: parts, monthly, first: card - monthly * (parts - 1) } : null,
  };
}

// Запис у три кроки, як у застосунках доставки: послуги → день і час → оплата.
const PARTS_OF_DAY = [['Ранок', 0, 12 * 60], ['День', 12 * 60, 17 * 60], ['Вечір', 17 * 60, 24 * 60]];
const slotEnd = (time, minutes) => hhmm(toMin(time) + minutes);

// Скільки вільного часу на день: для крапки під датою (мало / середньо / багато).
function dayLoad(p, date, minutes) {
  const all = slotsFor(p, date, minutes || 30, { mobile: mobileMode() });
  if (!all.length) return ['none', 'вихідний'];
  const free = all.filter((x) => !x.busy).length / all.length;
  return free === 0 ? ['none', 'немає вільного часу'] : free < 0.3 ? ['low', 'мало вільного часу'] : free < 0.7 ? ['mid', 'середньо вільного часу'] : ['high', 'багато вільного часу'];
}

function svcRow(s, cls, main) {
  const on = draft.services.has(s.id);
  if (main) {
    return `<label class="svc-card${on ? ' on' : ''}">
      <input class="cover-input" type="checkbox" data-action="svc" data-main="1" value="${s.id}" ${on ? 'checked' : ''}>
      <span class="svc-name">${s.personal ? '<span class="badge personal">Для вас</span> ' : ''}${esc(s.name)}</span>
      ${s.tags?.length || s.note ? `<span class="svc-tags">${(s.tags ?? [s.note]).map((t) => `<span>${esc(t)}</span>`).join('')}</span>` : ''}
      <span class="svc-foot"><span>${duration(s.min)}</span><b>${uah(s.price[cls])}</b></span>
    </label>`;
  }
  return `<label class="item svc-extra">
    <input class="check" type="checkbox" data-action="svc" value="${s.id}" ${on ? 'checked' : ''}>
    <span class="name">${s.personal ? '<span class="badge personal">Для вас</span> ' : ''}${esc(s.name)}<small>${duration(s.min)}${s.note ? ` · ${esc(s.note)}` : ''}</small></span>
    <span class="price">${draft.services.size && !on ? '+ ' : ''}${uah(s.price[cls])}</span>
  </label>`;
}

function renderBook() {
  // Авто з гаража: якщо в чернетці нема або його видалили — беремо обране на головній.
  if (draft && cars.length && !cars.some((c) => c.id === draft.carId)) draft.carId = mainCar()?.id ?? cars[0].id;
  const p = placeById(draft.placeId);
  const q = quote(p);
  const { cls, list, chosen, minutes, total, bonus, fromBal } = q;
  const slots = minutes ? slotsFor(p, draft.date, minutes, { mobile: mobileMode() }) : [];
  const where = mobileMode() ? addrCheck(p) : { ok: true };
  if (!draft.time && draft.wantTime && slots.some((s) => s.time === draft.wantTime && !s.busy)) { draft.time = draft.wantTime; draft.wantTime = null; return renderBook(); }
  if (draft.time && !slots.some((s) => s.time === draft.time && !s.busy)) { draft.time = null; return renderBook(); }
  const free = slots.filter((s) => !s.busy);
  const step = draft.paying ? 'pay' : draft.step === 'time' && chosen.length && where.ok ? 'time' : 'svc';
  const when = draft.time ? `${dayLabel(draft.date, { day: 'numeric', month: 'long' })}, ${draft.time}` : '';
  const pills = `${q.deal ? `<p class="save-pill">${icon('bolt', 14)}${q.deal.days ? 'Щасливі години' : 'Гаряче вікно'} −${q.deal.pct}%: ви економите ${uah(q.listTotal - total)}</p>` : ''}
      ${q.promo ? `<p class="save-pill">${icon('gift', 14)}${esc(q.promo.title)}: −${uah(q.promo.amount)} за промокодом ${esc(q.promo.code)}</p>` : ''}`;
  const priceTag = `${q.deal || q.promo ? `<s class="muted">${uah(q.listTotal)}</s> ` : ''}${uah(q.rest)}`;
  let html = '';

  if (step === 'svc') {
    const mains = list.filter((s) => s.main || s.personal);
    const split = mains.length >= 2;
    const extras = split ? list.filter((s) => !s.main && !s.personal) : list;
    const groups = [...new Set(extras.map((s) => s.group ?? 'Інше'))];
    const main = chosen.find((s) => s.main || s.personal);
    html = `
    <div class="book-car">${cars.length
      ? `<div class="car-choice" role="radiogroup" aria-label="Ваше авто">
          ${cars.map((c) => `<label class="car-opt"><input class="sr-only" type="radio" name="bookcar" value="${c.id}" ${c.id === draft.carId ? 'checked' : ''}>${icon('carSide', 18)}<span>${esc(`${c.make} ${c.model}`)}${c.plate ? `<small>${esc(c.plate)}</small>` : ''}</span></label>`).join('')}
          <a class="car-opt add" href="#/garage/add/book">${icon('plus', 18)}<span>Додати авто</span></a>
        </div>`
      : `<label class="car-chip">${icon('carSide', 18)}<span class="sr-only">Клас авто</span><select id="bookcls">
          ${CAR_CLASSES.map((c, i) => `<option value="${i}" ${i === cls ? 'selected' : ''}>${c}</option>`).join('')}
        </select></label>`}</div>

    ${mobileOn(p) ? `<div class="seg-mini mode-seg" role="group" aria-label="Де виконати послугу">
        <button data-action="mode" data-mode="place" aria-pressed="${!mobileMode()}">${icon('pin', 16)}У точці</button>
        <button data-action="mode" data-mode="mobile" aria-pressed="${mobileMode()}">${icon('carSide', 16)}Виїзд до мене</button>
      </div>
      ${mobileMode() ? `<div class="stack mobile-where" style="gap:10px;margin-top:10px">
        <label class="field"><span>Адреса</span><input id="addr" autocomplete="street-address" placeholder="Вулиця, будинок, підʼїзд чи паркінг" value="${esc(draft.addr?.text ?? '')}"></label>
        <div class="map pick-map" id="pick-map" tabindex="0" role="region" aria-label="Карта: натисніть, щоб позначити місце авто"></div>
        <div class="row"><button class="btn small-btn" data-action="addr-here">${icon('pin', 16)}Я зараз тут</button>
          <span class="small ${where.ok ? 'ok-text' : 'muted'}" id="addr-note">${where.ok ? `${icon('checkCircle', 16)}${fmtDist(where.km)} від точки — приїдемо` : esc(where.why)}</span></div>
        <p class="fine">Виїзд +${uah(p.mobile.fee)} · радіус ${p.mobile.radiusKm} км · безконтактна мийка з власною водою.</p>
      </div>` : ''}` : ''}

    ${split ? `<div class="sec-h"><h2>Основна послуга</h2><span>Оберіть одну</span></div>
      <div class="svc-cards" role="group" aria-label="Основна послуга">${mains.map((s) => svcRow(s, cls, true)).join('')}</div>` : ''}
    ${extras.length ? `<div class="sec-h"><h2>${split ? 'Додатково' : 'Послуги'}</h2><span>Можна кілька</span></div>
      ${groups.map((g) => `${groups.length > 1 ? `<h3 class="grp-h">${esc(g)}</h3>` : ''}
        <div class="list">${extras.filter((s) => (s.group ?? 'Інше') === g).map((s) => svcRow(s, cls, false)).join('')}</div>`).join('')}` : ''}
    <p class="small" style="margin:12px 0 0"><a href="#/ask/${p.id}">Не знайшли потрібну послугу? Напишіть мийці</a></p>
    <div class="dock-space tall"></div>
    <div class="dock summary book-dock">
      <div class="total"><span>${main ? esc(main.name) : chosen.length ? `${chosen.length} ${plural(chosen.length, 'послуга', 'послуги', 'послуг')}` : 'Нічого не обрано'}
        ${chosen.length ? `<small class="dur-chip">${duration(minutes)}${q.fee ? ' · виїзд' : ''}${chosen.length > 1 && main ? ` · +${chosen.length - 1}` : ''}</small>` : ''}</span><b>${priceTag}</b></div>
      ${pills}
      ${q.canParts && !q.promo && !q.deal ? `<p class="small muted" style="margin:0 0 8px">Можна оплатити частинами: від ${uah(Math.ceil(q.card / Math.max(...PAYMENT.installments.parts)))}/міс</p>` : ''}
      <button class="btn primary block" data-action="to-time" ${chosen.length && where.ok ? '' : 'disabled'}>${!where.ok && chosen.length ? esc(where.why) : !chosen.length ? 'Оберіть послугу' : draft.time ? `Далі: ${when}` : 'Обрати дату й час'}</button>
    </div>`;
  } else if (step === 'time') {
    const days = bookingDays(p);
    html = `
    <div class="step-head"><button class="icon-btn" data-action="step-back" aria-label="Назад до послуг">${icon('chevL', 22)}</button>
      <span class="step-note">${icon('calendar', 16)}На ${days.length} ${plural(days.length, 'день', 'дні', 'днів')} уперед</span></div>
    <div class="days" role="group" aria-label="День">
      ${days.map((d, i) => {
        const date = parseDate(d);
        const wd = i === 0 ? 'Сьогодні' : i === 1 ? 'Завтра' : date.toLocaleDateString('uk-UA', { weekday: 'short' });
        const closed = !hoursFor(p, d);
        const best = closed ? 0 : Math.max(0, ...dealsOn(p.id, d).map((x) => x.pct));
        const [lvl, lvlText] = closed ? ['none', 'вихідний'] : dayLoad(p, d, minutes);
        return `<button class="day${closed ? ' closed' : ''}${best ? ' has-deal' : ''}" data-action="day" data-date="${d}" aria-pressed="${d === draft.date}" ${closed ? `disabled aria-label="${wd}, ${date.getDate()}, вихідний"` : `aria-label="${wd}, ${date.getDate()}, ${best ? `є знижка до ${best}%` : lvlText}"`}>
          <span>${wd}</span><b>${date.getDate()}</b><span>${closed ? 'вихідний' : date.toLocaleDateString('uk-UA', { month: 'short' })}</span>
          <i class="load ${lvl}" aria-hidden="true"></i>
          ${best ? `<span class="day-deal">−${best}%</span>` : ''}
        </button>`;
      }).join('')}
    </div>
    <p class="load-legend" aria-hidden="true"><span><i class="load low"></i>мало</span><span><i class="load mid"></i>середньо</span><span><i class="load high"></i>багато</span></p>
    <h2 class="date-h">${dayLabel(draft.date, { weekday: 'long', day: 'numeric', month: 'long' })}</h2>
    ${hoursFor(p, draft.date) ? `<p class="small muted" style="margin:0">Працюємо ${rangeText(hoursFor(p, draft.date))}${scheduleOf(p).brk ? `, перерва ${rangeText(scheduleOf(p).brk)}` : ''}</p>` : ''}
    ${dayDealsBar(p, draft.date)}
    ${free.length
      ? PARTS_OF_DAY.map(([name, from, to]) => {
        const part = slots.filter((x) => toMin(x.time) >= from && toMin(x.time) < to);
        if (!part.some((x) => !x.busy)) return '';
        return `<h3 class="grp-h">${name}</h3><div class="slots" role="group" aria-label="${name}">${part.map((x) => {
          const d = !x.busy && dealAt(p.id, draft.date, x.time);
          const sum = d ? chosen.reduce((a, y) => a + (!y.personal && dealCovers(d, y.id) ? dealPrice(y.price[cls], d.pct) : y.price[cls]), 0) : 0;
          const off = d && sum < q.listTotal;
          return `<button class="slot${off ? ' hot' : ''}" data-action="time" data-time="${x.time}"
            ${x.busy ? `disabled aria-label="${x.time}, зайнято"` : off ? `aria-label="${x.time}, знижка ${d.pct}%, ${uah(sum)}"` : ''} aria-pressed="${x.time === draft.time}">${x.time}${off ? `<small>−${d.pct}% · ${uah(sum)}</small>` : ''}</button>`;
        }).join('')}</div>`;
      }).join('')
      : '<p class="muted">На цей день вільного часу немає. Оберіть інший день або станьте в лист очікування.</p>'}
    ${waitlistBlock(p, minutes, chosen)}
    <div class="dock-space tall"></div>
    <div class="dock summary book-dock">
      <div class="total"><span>${dayLabel(draft.date, { weekday: 'long', day: 'numeric', month: 'long' })}
        <small class="dur-chip">${draft.time ? `${draft.time}–${slotEnd(draft.time, minutes)} · ` : ''}${duration(minutes)}</small></span><b>${priceTag}</b></div>
      ${pills}
      ${q.canParts && !q.promo && !q.deal ? `<p class="small muted" style="margin:0 0 8px">Можна оплатити частинами: від ${uah(Math.ceil(q.card / Math.max(...PAYMENT.installments.parts)))}/міс</p>` : ''}
      <button class="btn primary block" data-action="confirm" ${draft.time ? '' : 'disabled'}>${draft.time ? `Записатися на ${when}` : 'Оберіть час'}</button>
    </div>`;
  } else {
    const car = cars.find((c) => c.id === draft.carId);
    const line = (name, value, minus) => `<li><span>${esc(name)}</span><i></i><span>${minus ? '−' : ''}${uah(value)}</span></li>`;
    html = `
    <section class="pay-screen sheet summary" aria-label="Оплата">
      <div class="step-head"><button class="icon-btn" data-action="unpay" aria-label="Назад">${icon('chevL', 22)}</button><span class="step-note">${icon('shield', 16)}Безпечна оплата</span></div>
      <div class="receipt">
        <b class="rc-place">${esc(p.name)}</b>
        <span class="rc-meta">${icon('pin', 15)}${esc(mobileMode() ? draft.addr.text : p.address)}</span>
        <span class="rc-meta">${icon('calendar', 15)}${when} – ${slotEnd(draft.time, minutes)}<span class="rc-car">${icon('carSide', 15)}${esc(car ? carLabel(car) : CAR_CLASSES[cls])}</span></span>
        <ul class="rc-lines">
          ${chosen.map((x) => line(x.name, x.price[cls])).join('')}
          ${q.fee ? line(`Виїзд до вас: ${draft.addr.text}`, q.fee) : ''}
          ${q.deal ? line(`${q.deal.days ? 'Щасливі години' : 'Гаряче вікно'} −${q.deal.pct}%`, q.listTotal - total, true) : ''}
          ${q.covered ? line(q.use.kind === 'sub' ? q.use.name : 'Сертифікат', q.covered, true) : ''}
          ${q.promo ? line(`Промокод ${q.promo.code}`, q.promo.amount, true) : ''}
          ${bonus ? line('Бонус «Приведи друга»', bonus, true) : ''}
          ${fromBal ? line('Баланс CARCAR', fromBal, true) : ''}
        </ul>
        <div class="sheet-total"><span>До сплати${fromBal ? ' карткою' : ''}</span><b>${uah(q.card)}</b></div>
        ${q.fee ? `<p class="small" style="margin:0">${icon('carSide', 14)} Виїзд до вас: ${uah(q.fee)} · ${esc(draft.addr.text)}</p>` : ''}
        <p class="fine" style="margin:0">Гроші утримуються, доки роботу не виконано. Комісія для клієнта — 0 ₴.</p>
      </div>
      ${q.promo ? `<div class="bonus-line promo-line"><span class="perk-ic ok">${icon('gift', 18)}</span>
            <span>Промокод ${esc(q.promo.code)}<small>${esc(q.promo.title)} · оплачує CARCAR, точка отримає повну суму</small></span>
            <b>−${uah(q.promo.amount)}</b><button class="link-btn" data-action="promo-off">Прибрати</button></div>`
        : `<div class="inline-form promo-form">
            <label class="field"><span>Промокод CARCAR</span><input id="promo-code" autocomplete="off" value="${esc(draft.promo || '')}"></label>
            <button class="btn" data-action="promo-apply">Застосувати</button></div>
          ${q.promoErr ? `<p class="small bad-text" style="margin:0" role="alert">${esc(q.promoErr)}</p>` : ''}`}
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
      ${q.canParts ? `<fieldset class="parts">
        <legend>Оплата частинами</legend>
        <label><input type="radio" name="parts" value="0" ${q.parts ? '' : 'checked'}><span>Одразу<small>${uah(q.card)}</small></span></label>
        ${PAYMENT.installments.parts.map((n) => `<label><input type="radio" name="parts" value="${n}" ${q.parts === n ? 'checked' : ''}><span>${n} платежі<small>по ${uah(Math.ceil(q.card / n))}/міс</small></span></label>`).join('')}
        <p class="fine">Без переплати для вас: точка отримує всю суму одразу від банку-партнера, решту частин спишемо з картки щомісяця. Демо: справжньої розстрочки не оформлюємо.</p>
      </fieldset>` : ''}
      ${q.card > 0 ? `<fieldset class="methods"><legend>Спосіб оплати</legend>
        ${[['gpay', 'Google Pay', 'Швидко, без введення картки'], ['card', 'Банківська картка', 'Visa, Mastercard будь-якого банку']].map(([k, name, sub]) => `<label class="method${(draft.method ?? 'card') === k ? ' on' : ''}">
          <input class="cover-input" type="radio" name="method" value="${k}" ${(draft.method ?? 'card') === k ? 'checked' : ''}>
          <span class="m-ic ${k}">${k === 'gpay' ? 'G' : icon('card', 18)}</span><span>${name}<small>${sub}</small></span></label>`).join('')}
      </fieldset>` : ''}
      <ul class="perks">
        <li><span class="perk-ic ok">${icon('shield', 20)}</span>Гроші утримуються, доки роботу не виконано</li>
        <li><span class="perk-ic">${icon('undo', 20)}</span>Скасування до ${cancelWindow()} до візиту — уся сума повертається на баланс CARCAR</li>
        <li><span class="perk-ic">${icon('clock', 20)}</span>Запізнення понад ${PAYMENT.lateMinutes} хв — як неявка, оплата зараховується мийці</li>
      </ul>
      <div class="grid2 pf">
        <label class="field"><span>Ваше імʼя</span><input id="pf-name" autocomplete="name" value="${esc(draft.pfName ?? profile.name)}"></label>
        <label class="field"><span>Телефон</span><input id="pf-phone" type="tel" autocomplete="tel" placeholder="+380" value="${esc(draft.pfPhone ?? profile.phone)}"></label>
      </div>
      <label class="check-row small"><input class="check" type="checkbox" id="pf-optin" ${(draft.pfOptIn ?? profile.optIn) ? 'checked' : ''}><span>Отримувати пропозиції цієї точки у Viber чи Telegram</span></label>
      <p class="demo">Імʼя й телефон бачить лише точка — щоб звʼязатися й показувати вам персональні ціни. Демо-оплата: гроші не списуються.</p>
      <div class="dock-space"></div>
      <div class="dock pay-dock">
        <button class="btn primary block${(draft.method ?? 'card') === 'gpay' && q.card > 0 ? ' gpay' : ''}" data-action="pay">${(draft.method ?? 'card') === 'gpay' && q.card > 0 ? '<span class="g-mark" aria-hidden="true">G</span>' : icon('card', 20)}${q.installments ? `Оплатити першу частину ${uah(q.installments.first)}` : q.card > 0 ? `Оплатити ${uah(q.card)}` : fromBal ? 'Оплатити з балансу' : q.covered ? 'Записатися' : `Оплатити ${uah(0)}`}</button>
      </div>
    </section>`;
  }
  $('#book').innerHTML = html;
  $('#book').dataset.step = step;
  // Заголовок сторінки — назва кроку; на кроках часу й оплати назад веде кнопка в самому кроці.
  const h1 = $('#view > h1');
  if (h1) h1.textContent = step === 'svc' ? 'Запис' : step === 'time' ? 'Дата й час' : 'Оплата замовлення';
  const top = $('#view > .back');
  if (top) top.hidden = step !== 'svc';
  if (step === 'svc' && mobileMode()) mountPickMap(p);
}

// Карта для вибору місця виїзду: точка, радіус виїзду не малюємо — перевіряємо відстань.
const pickState = {};
function mountPickMap(p) {
  const el = $('#pick-map');
  if (!el) return;
  if (pickState.place !== p.id) Object.assign(pickState, { place: p.id, x: undefined, y: undefined, z: undefined, layer: mapState.layer });
  mountMap(el, {
    places: [{ id: p.id, lat: p.lat, lng: p.lng, cls: `c-${p.cats[0]}`, html: `<span class="pin-shape">${icon(catById(p.cats[0]).icon, 16)}</span>`, label: esc(p.name) }],
    pos: ui.pos, pick: draft.addr?.lat != null ? draft.addr : null, state: pickState, onLayer: (l) => store.set('mapLayer', l),
    onPick: (lat, lng) => {
      draft.addr = { ...draft.addr, text: $('#addr')?.value ?? draft.addr?.text ?? '', lat, lng };
      updateWhere(p);
    },
  });
}

// Оновлюємо лише підпис і кнопку, щоб карта не перемальовувалась під пальцем.
function updateWhere(p) {
  const w = addrCheck(p);
  const note = $('#addr-note');
  if (note) {
    note.className = `small ${w.ok ? 'ok-text' : 'muted'}`;
    note.innerHTML = w.ok ? `${icon('checkCircle', 16)}${fmtDist(w.km)} від точки — приїдемо` : esc(w.why);
  }
  const btn = $('.book-dock .btn.primary');
  if (btn) {
    const q = quote(p);
    const ready = q.chosen.length;
    btn.disabled = !(ready && w.ok);
    btn.textContent = !w.ok && ready ? w.why : !ready ? 'Оберіть послугу'
      : draft.time ? `Далі: ${dayLabel(draft.date, { day: 'numeric', month: 'long' })}, ${draft.time}` : 'Обрати дату й час';
  }
}

function confirmBooking() {
  const p = placeById(draft.placeId);
  const car = cars.find((c) => c.id === draft.carId);
  // Імʼя й телефон з форми оплати зберігаємо в профіль, щоб наступного разу не вводити.
  profile = { name: (draft.pfName ?? profile.name).trim(), phone: (draft.pfPhone ?? profile.phone).trim(), optIn: draft.pfOptIn ?? profile.optIn };
  store.set('profile', profile);
  const q = quote(p);
  const { cls, chosen, total, bonus, fromBal } = q;
  if (mobileMode() && !addrCheck(p).ok) { toast(addrCheck(p).why); return; }
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
    mobile: mobileMode() ? { address: draft.addr.text.trim(), lat: draft.addr.lat, lng: draft.addr.lng, fee: q.fee, km: Math.round(addrCheck(p).km * 10) / 10 } : null,
    promo: q.promo ? { code: q.promo.code, amount: q.promo.amount } : null,
    campaign: campaignNow()?.id ?? null,
    firstOrder: !mine().some((x) => !(x.state === 'cancelled' && x.refundTo === 'balance')),
    installments: q.installments ? { ...q.installments, card: q.card } : null,
    state: 'paid',
    createdAt: Date.now(),
  };
  bookings.push(b);
  save();
  if (bonus) addBonus(-bonus, `Списано на замовлення: ${p.name}`);
  if (fromBal) addMoney(-fromBal, `Оплата замовлення: ${p.name}`);
  draft = null;
  location.hash = `#/bookings/${b.id}`;
  track('paid', { placeId: p.id, amount: total, deal: !!q.deal, pass: q.use?.kind ?? null, bonus: !!bonus, balance: !!fromBal, leadH: Math.round((bookingStart(b) - Date.now()) / HOUR),
    promo: q.promo?.code ?? null, mobile: !!b.mobile, parts: q.parts || 0 });
  toast(q.installments ? `Оплачено першу частину, ви записані` : 'Оплачено, ви записані');
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
// Умови скасування: kind — free (вчасно, усе повертаємо) або late (пізно — оплата мийці).
// inWindow — ще можна переносити.
function cancelTerms(b) {
  const deadline = bookingStart(b).getTime() - PAYMENT.freeCancelHours * HOUR;
  const inWindow = Date.now() <= deadline;
  if (!inWindow) return { free: false, kind: 'late', inWindow, deadline, placeAmount: price(b), refund: 0 };
  return { free: true, kind: 'free', inWindow, deadline, placeAmount: 0, refund: b.paid };
}

// ---------- надійність клієнта ----------

// Активні майбутні записи, які клієнт зробив сам (регулярні записи створюються автоматично й не рахуються).

// Клієнт бачить два кроки: оплатив — мийка виконала.
function steps(b) {
  const at = { paid: 0, done: 1, dispute: 1, completed: 1 }[b.state];
  if (at === undefined) return '';
  return `<ol class="steps two" aria-label="Статус запису">${['Оплачено', 'Виконано']
    .map((s, i) => `<li class="${i <= at ? 'on' : ''}" ${i === at ? 'aria-current="step"' : ''}>${s}</li>`).join('')}</ol>`;
}

// [клас кольору статусу, підпис]
const STATE_LABEL = {
  paid: ['go', 'Оплачено'],
  done: ['', 'Виконано'],
  dispute: ['warn', 'Спір розглядається'],
  completed: ['', 'Виконано'],
  cancelled: ['', 'Скасовано'],
  noshow: ['', 'Неявка'],
  refunded: ['', 'Гроші повернено'],
};

// Іконки статусів, щоб завершені записи розрізнялися з першого погляду.
const STATE_ICON = { completed: 'checkCircle', cancelled: 'x', refunded: 'x', noshow: 'clock', dispute: 'info' };

const cardHead = (b, title, sm, amount = b.paid) => {
  const [cls, label] = STATE_LABEL[b.state];
  return `<div class="head">
      <div><div class="bk-status ${cls}">${STATE_ICON[b.state] ? icon(STATE_ICON[b.state], 14) : ''}${label}</div><h3 class="bk-title${sm ? ' sm' : ''}">${title}</h3></div>
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
      ${reviewPhotos(mine)}
      ${mine.reply ? `<div class="reply"><b>Відповідь точки</b>${esc(mine.reply.text)}</div>` : ''}
      <a href="#/invite">Сподобалось? Приведіть друга — по ${uah(REFERRAL.bonus)} обом</a></div>`;
  }
  return `<form class="review-form" data-id="${b.id}">
    <fieldset class="star-input">
      <legend>Оцініть візит</legend>
      ${[1, 2, 3, 4, 5].map((n) => `<label><input class="sr-only" type="radio" name="stars" value="${n}" required>
        <span aria-hidden="true">${icon('star', 30)}</span><span class="sr-only">${n} з 5</span></label>`).join('')}
    </fieldset>
    <label class="field"><span>Відгук (необовʼязково)</span><textarea name="text" rows="3" maxlength="600" placeholder="Що сподобалось, що варто покращити"></textarea></label>
    <label class="dropzone">${icon('camera', 22)}Додати фото результату (до 3)<span class="photo-count" aria-live="polite"></span>
      <input class="sr-only" name="photos" type="file" accept="image/*" multiple></label>
    <button class="btn primary block" type="submit">Надіслати відгук</button>
  </form>`;
}

function bookingCard(b, highlight) {
  const p = placeById(b.placeId);
  const when = `${dayLabel(b.date)}, ${b.time}–${hhmm(toMin(b.time) + b.minutes)}`;
  const lines = `<div class="lines">
      <div class="il strong">${icon('calendar', 18)}${when}</div>
      <div class="il">${icon('carSide', 18)}${esc(b.car)}</div>
      ${b.mobile ? `<div class="il">${icon('carSide', 18)}Виїзд до вас: ${esc(b.mobile.address)}</div>` : p ? `<div class="il">${icon('pin', 18)}${esc(p.address)}</div>` : ''}
      <div class="svc">${b.services.map(esc).join(', ')}</div>
      ${b.moves?.length ? `<div class="il muted">${icon('repeat', 18)}Перенесено з ${dayLabel(b.moves.at(-1).date, { day: 'numeric', month: 'long' })}, ${b.moves.at(-1).time}</div>` : ''}
      ${b.bonus ? `<div class="il">${icon('gift', 18)}Оплачено ${uah(b.paid)} + бонус ${uah(b.bonus)}</div>` : ''}
      ${b.promo && !b.promo.returned ? `<div class="il">${icon('gift', 18)}Промокод ${esc(b.promo.code)}: −${uah(b.promo.amount)}</div>` : ''}
      ${b.installments ? `<div class="il">${icon('card', 18)}Частинами: ${b.installments.n} платежі, перший ${uah(b.installments.first)}, далі по ${uah(b.installments.monthly)}/міс</div>` : ''}
    </div>`;
  let body = lines;
  const started = bookingStart(b) <= new Date();
  if (b.state === 'paid') {
    const t = cancelTerms(b);
    const canMove = t.inWindow && (b.moves?.length ?? 0) < MOVE_LIMIT;
    body += `${b.extra ? `<div class="notice">
        <b>Майстер пропонує доплату +${uah(b.extra.amount)}</b>${esc(b.extra.reason)}
        <div class="grid2" style="margin-top:10px">
          <button class="btn primary" data-action="extra-ok" data-id="${b.id}">Погодитися й доплатити</button>
          <button class="btn" data-action="extra-no" data-id="${b.id}">Відхилити</button>
        </div></div>` : ''}
      ${started ? `<div class="notice ic-row">${icon('clock', 18)}Коли авто буде готове, мийка відмітить це тут. Тоді зможете залишити відгук.</div>
        <div class="grid2">
          ${p ? `<a class="btn" href="${tel(p)}">${icon('phone', 18)}Зателефонувати</a>` : ''}
          <button class="btn line-danger" data-action="dispute" data-id="${b.id}">Відкрити спір</button>
        </div>`
      : `<div class="notice ic-row">${icon('shield', 18)}Оплачено. Після візиту мийка підтвердить виконання.</div>
      <div class="grid2">
        ${canMove ? `<a class="btn" href="#/move/${b.id}">${icon('calendar', 18)}Перенести</a>` : ''}
        <button class="btn" data-action="ics" data-id="${b.id}">${icon('calendar', 18)}У календар</button>
        ${p ? `<a class="btn${canMove ? ' full' : ''}" href="${tel(p)}">${icon('phone', 18)}Зателефонувати</a>` : ''}
        <button class="btn text-danger full" data-action="cancel" data-id="${b.id}">${t.kind === 'free' ? 'Скасувати' : 'Скасувати без повернення'}</button>
      </div>
      <p class="terms">${t.kind === 'free'
        ? `Перенести чи скасувати без втрат можна до ${fmtTime(t.deadline)}. Тоді ${uah(b.paid)} повернемо на баланс CARCAR.`
        : `Скасувати з поверненням можна було до ${fmtTime(t.deadline)}. Тепер оплата йде мийці, навіть якщо ви не приїдете.`}
        ${t.inWindow && !canMove ? ` Запис уже переносили ${MOVE_LIMIT} рази. Якщо треба інший час, напишіть мийці в чат.` : ''}</p>`}`;
  } else if (b.state === 'done') {
    body = `<div class="lines tight">
        <div class="il strong">${when}</div>
        <div>${esc(b.car)} · ${b.services.map(esc).join(', ')}</div>
      </div>
      ${result(b)}`;
  } else if (b.state === 'dispute') {
    body += `<div class="notice warn"><div class="label">Ваша скарга</div>«${esc(b.disputeReason)}». Модератор перевірить і вирішить, кому передати гроші.</div>${result(b)}`;
  } else if (b.state === 'completed') {
    body += result(b);
    if (isFrozen(b)) {
      body += `<div class="notice ic-row">${icon('checkCircle', 18)}Мийка підтвердила виконання. Якщо щось не так, відкрийте спір до ${fmtTime(b.unfreezeAt)}.</div>
        <button class="btn line-danger" data-action="dispute" data-id="${b.id}">Відкрити спір</button>`;
    }
    body += reviewBlock(b);
  } else {
    body += b.refund || b.state === 'refunded' || !b.placeAmount
      ? `<p class="small muted" style="margin:0">Повернено ${uah(b.refund ?? b.paid)} ${b.refundTo === 'balance' ? 'на баланс CARCAR' : 'на картку'}${b.bonusReturned ? ` і ${uah(b.bonus)} на бонусний рахунок` : ''}${b.placeAmount ? `, ${uah(b.placeAmount)} отримала точка` : ''}.</p>`
      : `<p class="small muted" style="margin:0">${b.lateForfeit ? `Запізнення понад ${PAYMENT.lateMinutes} хв` : b.state === 'noshow' ? 'Ви не приїхали' : `Запис скасовано пізніше ніж за ${cancelWindow()}`} — оплату ${uah(b.placeAmount)} зараховано точці за послугу.</p>`;
  }
  return `<article class="bk st-${b.state}${highlight ? ' hl' : ''}" id="b-${b.id}">
    ${cardHead(b, esc(p?.name ?? 'Сервіс'))}
    ${b.state === 'paid' ? visitBar(b) : ''}
    ${steps(b)}
    ${body}
    ${estimateBlock(b)}
    ${intakeBlock(b)}
    ${chatBlock(b)}
    <a class="help-link small" href="${b.ticketId ? `#/support/t/${b.ticketId}` : `#/support/new/${b.id}`}">${icon('info', 16)}${b.ticketId ? 'Звернення в підтримку за цим записом' : 'Проблема із записом? Напишіть у підтримку CARCAR'}</a>
    ${!ACTIVE.includes(b.state) && p ? `<div class="grid2">
      <a class="btn" href="#/book/${p.id}" data-action="repeat" data-id="${b.id}">${icon('repeat', 18)}Повторити запис</a>
      ${p.cats.includes('wash') && !b.subId ? `<button class="btn" data-action="sub-open" data-id="${b.id}">${icon('calendar', 18)}Зробити регулярним</button>` : ''}
    </div>${ui.subFor === b.id ? subForm(b) : ''}` : ''}
  </article>`;
}

// ---------- кошторис і гарантія ----------

// Кошторис додаткових робіт від мийки: клієнт погоджує пункти окремо й доплачує лише за погоджене.
function estimateBlock(b) {
  const e = b.estimate;
  if (!e) return '';
  const row = (x, form) => `<li class="est-item${x.status === 'declined' ? ' off' : ''}">
    ${form ? `<input class="check" type="checkbox" name="item" value="${x.id}" checked aria-label="${esc(x.name)}">` : x.status === 'approved' ? `<span class="ok-text">${icon('check', 16)}</span>` : `<span class="muted">${icon('x', 16)}</span>`}
    <span class="name">${esc(x.name)}<small>${ITEM_KIND[x.kind]}${x.qty !== 1 ? ` · ${x.qty} × ${uah(x.price)}` : ''}${x.warranty ? ` · гарантія ${x.warranty} міс` : ''}</small></span>
    <b>${uah(itemSum(x))}</b></li>`;
  if (e.state === 'sent' && b.state === 'paid') {
    const sum = estimateTotal(e.items);
    return `<form class="estimate card stack" data-id="${b.id}" aria-label="Кошторис від точки">
      <div class="head"><b>${icon('wrench', 18)} Кошторис від майстра</b><span class="small muted">${fmtTime(e.at)}</span></div>
      ${e.note ? `<p class="small" style="margin:0">${esc(e.note)}</p>` : ''}
      <ul class="est-list">${e.items.map((x) => row(x, true)).join('')}</ul>
      <button class="btn primary block est-pay" type="submit">Погодити обрані й доплатити ${uah(sum)}</button>
      <button class="btn block" type="button" data-action="est-decline" data-id="${b.id}">Відхилити все</button>
      <p class="fine">Зніміть позначку з того, що не потрібно, — ці роботи точка не виконуватиме. Доплата утримується так само, як основна оплата, до підтвердження виконання. Гарантія на роботи зʼявиться в сервісній книжці авто.</p>
    </form>`;
  }
  const ok = estimateTotal(e.items, 'approved');
  return `<details class="estimate card"><summary>${icon('wrench', 18)}Кошторис: ${e.state === 'sent' ? 'чекає відповіді' : ok ? `погоджено на ${uah(ok)}` : 'відхилено'}</summary>
    <ul class="est-list">${e.items.map((x) => row(x, false)).join('')}</ul></details>`;
}

// Гарантії з погоджених кошторисів: від дня виконання на вказану кількість місяців.
function warrantiesOf(car) {
  return bookings.filter((b) => b.carId === car.id && b.state === 'completed' && b.estimate)
    .flatMap((b) => b.estimate.items.filter((x) => x.status === 'approved' && x.warranty).map((x) => {
      const from = isoDate(new Date(b.completedAt ?? bookingStart(b)));
      return { name: x.name, place: placeById(b.placeId)?.name ?? '', from, until: warrantyUntil(from, x.warranty), months: x.warranty };
    })).sort((a, c) => (a.until < c.until ? 1 : -1));
}

// ---------- чат за записом ----------

// Кнопка в картці запису: чат відкривається окремим екраном.
function chatBlock(b) {
  if (!ACTIVE.includes(b.state) && !b.chat?.length) return '';
  return `<a class="btn chat-link${b.chatUnreadClient ? ' unread' : ''}" href="#/chat/${b.id}">${icon('chat', 18)}Чат з мийкою${b.chatUnreadClient ? '<span class="count" aria-label="нове повідомлення">1</span>' : ''}</a>`;
}

const avatar = (name, on = false) => `<span class="avatar${on ? ' on' : ''}" aria-hidden="true">${esc([...String(name).replace(/^(Автомийка|Детейлінг-мийка)\s*/, '').replace(/[«»"]/g, '')][0] ?? 'C')}</span>`;
const shortTime = (at) => {
  const d = new Date(at);
  const today = isoDate(new Date());
  return isoDate(d) === today ? d.toLocaleTimeString('uk-UA', { hour: '2-digit', minute: '2-digit' }) : d.toLocaleDateString('uk-UA', { day: 'numeric', month: 'short' });
};
const dayName = (iso) => {
  const t = new Date();
  const y = new Date(t.getFullYear(), t.getMonth(), t.getDate() - 1);
  return iso === isoDate(t) ? 'Сьогодні' : iso === isoDate(y) ? 'Вчора' : dayLabel(iso, { day: 'numeric', month: 'long' });
};

// Повноекранний чат із мийкою щодо конкретного запису — як у месенджерах.
// «У мережі» / «була в мережі …» — як у месенджерах. Мийка в мережі, поки відкрита її панель.
function presenceText(placeId) {
  const { at, online } = presenceOf(placeId);
  if (online) return 'у мережі';
  if (!at) return 'не в мережі';
  const min = Math.round((Date.now() - at) / 60000);
  if (min < 60) return `була в мережі ${min} хв тому`;
  const d = new Date(at);
  const t = msgTime(at);
  if (isoDate(d) === isoDate(new Date())) return `була в мережі сьогодні о ${t}`;
  if (isoDate(d) === isoDate(new Date(Date.now() - 86400000))) return `була в мережі вчора о ${t}`;
  return `була в мережі ${d.toLocaleDateString('uk-UA', { day: 'numeric', month: 'short' })} о ${t}`;
}
const presenceLine = (placeId) => `<small class="chat-presence${presenceOf(placeId).online ? ' on' : ''}" data-place="${esc(placeId)}">${presenceText(placeId)}</small>`;

const msgTime = (at) => new Date(at).toLocaleTimeString('uk-UA', { hour: '2-digit', minute: '2-digit' });
const safePhoto = (src) => (typeof src === 'string' && src.startsWith('data:image/') ? esc(src) : '');

// Пузир повідомлення: текст і/або фото, час і галочки (✓ надіслано, ✓✓ прочитано).
function bubble(m, them) {
  const mine = m.from === 'client';
  const photo = safePhoto(m.photo);
  return `<li class="bubble ${mine ? 'me' : 'them'}${photo ? ' has-photo' : ''}"><span class="sr-only">${mine ? 'Ви' : esc(them)}: </span>${photo ? `<button class="chat-photo" type="button" data-action="photo-open" aria-label="Відкрити фото"><img src="${photo}" alt="Фото"></button>` : ''}${m.text ? `<span class="b-text">${esc(m.text)}</span>` : ''}<time>${msgTime(m.at)}${mine ? `<span class="ticks${m.readAt ? ' read' : ''}" aria-hidden="true">${m.readAt ? '✓✓' : '✓'}</span>` : ''}</time></li>`;
}
// Під останнім своїм повідомленням — «Прочитано» чи «Не прочитано».
const readLine = (m) => `<li class="read-state${m.readAt ? ' read' : ''}">${m.readAt ? `Прочитано ${msgTime(m.readAt)}` : 'Не прочитано'}</li>`;

// Кнопка фото в полі вводу.
const attachBtn = () => `<label class="attach-btn">${icon('camera', 22)}<input class="sr-only chat-attach" type="file" accept="image/*" aria-label="Додати фото"></label>`;

function viewChat(id) {
  const b = mine().find((x) => x.id === id);
  if (!b) return viewNotFound();
  const p = placeById(b.placeId);
  // Клієнт відкрив чат — відповіді мийки прочитані.
  const seen = readMessages(b.chat, 'biz');
  if (b.chatUnreadClient || seen) { b.chatUnreadClient = false; save(); }
  const msgs = chatTimeline(b);
  const lastOwn = msgs.findLast((m) => m.from === 'client');
  let lastDay = '';
  const items = msgs.map((m) => {
    const day = isoDate(new Date(m.at));
    const sep = day !== lastDay ? `<li class="day-sep"><span>${dayName(day)}</span></li>` : '';
    lastDay = day;
    if (m.from === 'mark') return `${sep}<li class="chat-mark ${m.kind}">${icon(m.kind === 'closed' ? 'x' : 'check', 14)}<b>${esc(m.text)}</b><time>${new Date(m.at).toLocaleTimeString('uk-UA', { hour: '2-digit', minute: '2-digit' })}</time></li>`;
    if (m.from === 'sys') return `${sep}<li class="bubble sys">${esc(m.text)}</li>`;
    return `${sep}${bubble(m, p.name)}${m === lastOwn ? readLine(m) : ''}`;
  }).join('');
  const open = ACTIVE.includes(b.state);
  return `<section class="chat-screen" aria-label="Чат з ${esc(p.name)}">
    <header class="chat-head">
      <button class="icon-btn" data-action="chat-back" aria-label="Назад">${icon('chevL', 24)}</button>
      ${avatar(p.name, presenceOf(p.id).online)}
      <div class="chat-who"><h1>${esc(p.name)}</h1>${presenceLine(p.id)}</div>
      <a class="icon-btn" href="${tel(p)}" aria-label="Зателефонувати">${icon('phone', 20)}</a>
    </header>
    <a class="chat-pin" href="#/bookings/${b.id}">${icon('calendar', 16)}<span>${dayLabel(b.date, { weekday: 'short', day: 'numeric', month: 'short' })}, ${b.time} · ${esc(b.services[0])}${b.services.length > 1 ? ` +${b.services.length - 1}` : ''}</span>${icon('chevR', 16)}</a>
    <ol class="chat-msgs" aria-label="Повідомлення">
      ${items || `<li class="chat-empty">${avatar(p.name)}<b>${esc(p.name)}</b><span>Напишіть мийці про цей візит: приїдете раніше, з багажником на даху чи потрібен чек.</span></li>`}
    </ol>
    ${open ? `<div class="chat-compose">
      <div class="quick" role="group" aria-label="Швидкі повідомлення">${CLIENT_QUICK.map((t) => `<button class="chip" data-action="chat-quick" data-id="${b.id}" data-text="${esc(t)}">${esc(t)}</button>`).join('')}</div>
      <form class="chat-form" data-id="${b.id}">
        ${attachBtn()}
        <input name="text" required maxlength="500" autocomplete="off" placeholder="Повідомлення…" aria-label="Повідомлення мийці">
        <button class="send-btn" type="submit" aria-label="Надіслати">${icon('send', 20)}</button>
      </form>
    </div>` : '<p class="chat-closed">Чат закрито — листування лише для читання.</p>'}
  </section>`;
}

function sendChat(b, text, photo = null) {
  chatPost(b, 'client', text, 'biz', photo);
  save();
  route();
  $('.chat-form input[name="text"]')?.focus();
  track('chat', { placeId: b.placeId });
}

// ---------- вхід за номером телефону ----------

// Номер → код із SMS → готово. У прототипі SMS не надсилаються: код показуємо на екрані.
// У робочій версії код надсилає сервер (SMS-шлюз), а сесію зберігає токен.
const login = { step: 'phone', phone: '', code: '', sentAt: 0, error: '' };
const phoneDigits = (v) => v.replace(/\D/g, '').replace(/^(380|80|0)?/, '').slice(0, 9);
const fmtPhone = (d) => `+380 ${d.slice(0, 2)} ${d.slice(2, 5)} ${d.slice(5, 7)} ${d.slice(7, 9)}`.trim();

function viewLogin() {
  const hero = `<div class="auth-hero" aria-hidden="true">
      <span class="auth-bubble b1"></span><span class="auth-bubble b2"></span><span class="auth-bubble b3"></span><span class="auth-bubble b4"></span><span class="auth-bubble b5"></span>
      <svg class="auth-logo" width="88" height="88" viewBox="0 0 32 32"><rect width="32" height="32" rx="9" fill="#c8402b"/><path d="M15 10.5a6 6 0 1 0 0 11" fill="none" stroke="#fff" stroke-width="3" stroke-linecap="round"/><path d="M24 10.5a6 6 0 1 0 0 11" fill="none" stroke="#fff" stroke-width="3" stroke-linecap="round" opacity=".6"/></svg>
      <svg class="auth-car" width="150" height="56" viewBox="40 80 330 110"><path d="M60 168Q62 134 104 127L146 99Q157 90 176 90L252 90Q271 90 285 102L318 127Q348 131 352 156L354 166Q354 174 345 174L74 174Q60 174 60 168Z" fill="#fff" opacity=".95"/><circle cx="118" cy="174" r="20" fill="#1f2937"/><circle cx="300" cy="174" r="20" fill="#1f2937"/></svg>
      <span class="auth-shine"></span>
    </div>`;
  if (login.step === 'done') {
    return `<section class="auth" aria-label="Вхід">${hero}<div class="auth-card done">
      <span class="auth-check" aria-hidden="true">${icon('check', 40)}</span>
      <h1>Готово!</h1><p>Номер ${fmtPhone(login.phone)} підтверджено.</p></div></section>`;
  }
  if (login.step === 'code') {
    const left = Math.max(0, 30 - Math.round((Date.now() - login.sentAt) / 1000));
    return `<section class="auth" aria-label="Вхід">${hero}<form class="auth-card" id="code-form" novalidate>
      <h1>Код із SMS</h1>
      <p>Надіслали на <b>${fmtPhone(login.phone)}</b> · <button type="button" class="link-btn" data-action="login-back">змінити</button></p>
      <div class="code-cells" role="group" aria-label="Код із SMS">
        ${[0, 1, 2, 3].map((i) => `<input class="code-cell" inputmode="numeric" maxlength="1" autocomplete="${i ? 'off' : 'one-time-code'}" aria-label="Цифра ${i + 1}" value="${login.typed?.[i] ?? ''}">`).join('')}
      </div>
      ${login.error ? `<p class="auth-error" role="alert">${esc(login.error)}</p>` : ''}
      <button class="btn primary block" type="submit">Підтвердити</button>
      <p class="fine">Це демо, SMS не приходять. Ваш код: <b class="code">${login.code}</b>.
        <span id="resend">${left ? `Надіслати знову можна через ${left} с.` : '<button type="button" class="link-btn" data-action="login-resend">Надіслати код знову</button>'}</span></p>
    </form></section>`;
  }
  return `<section class="auth" aria-label="Вхід">${hero}<form class="auth-card" id="phone-form" novalidate>
    <h1>Вхід у CARCAR</h1>
    <p>Запис на мийку без дзвінків. Вкажіть імʼя й номер — надішлемо код.</p>
    <label class="auth-name"><span class="sr-only">Ваше імʼя</span>
      <input id="login-name" autocomplete="given-name" autocapitalize="words" maxlength="40" placeholder="Ваше імʼя" value="${esc(login.name ?? profile.name ?? '')}" aria-label="Ваше імʼя"></label>
    <label class="auth-phone"><span class="sr-only">Номер телефону</span><span class="prefix" aria-hidden="true">+380</span>
      <input id="login-phone" type="tel" inputmode="tel" autocomplete="tel-national" placeholder="67 123 45 67" value="${esc(login.phone ? fmtPhone(login.phone).slice(5) : '')}" aria-label="Номер телефону"></label>
    ${login.error ? `<p class="auth-error" role="alert">${esc(login.error)}</p>` : ''}
    <button class="btn primary block" type="submit">Отримати код</button>
    <p class="fine">Номер бачить тільки мийка, до якої ви записалися.</p>
  </form></section>`;
}

// Відлік до повторного SMS і Backspace у порожній клітинці коду.
setInterval(() => {
  const el = document.getElementById('resend');
  if (!el || login.step !== 'code') return;
  const left = Math.max(0, 30 - Math.round((Date.now() - login.sentAt) / 1000));
  if (left) el.textContent = `Надіслати знову можна через ${left} с.`;
  else if (!el.querySelector('button')) el.innerHTML = '<button type="button" class="link-btn" data-action="login-resend">Надіслати код знову</button>';
}, 1000);
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Backspace' || !e.target.matches?.('.code-cell') || e.target.value) return;
  const cells = [...document.querySelectorAll('.code-cell')];
  cells[cells.indexOf(e.target) - 1]?.focus();
});

function loginSubmit(form) {
  if (form.id === 'phone-form') {
    const name = form.querySelector('#login-name').value.trim().replace(/\s+/g, ' ');
    const d = phoneDigits(form.querySelector('#login-phone').value);
    login.name = name;
    if (name.length < 2) { login.error = 'Вкажіть імʼя, щоб мийка знала, як до вас звертатися.'; login.phone = d; route(); return; }
    if (d.length !== 9) { login.error = 'Не вистачає цифр. Після +380 має бути 9.'; login.phone = d; route(); return; }
    Object.assign(login, { step: 'code', phone: d, code: String(Math.floor(1000 + Math.random() * 9000)), sentAt: Date.now(), error: '', typed: '' });
    route();
    return;
  }
  const typed = [...form.querySelectorAll('.code-cell')].map((i) => i.value).join('');
  if (typed !== login.code) { Object.assign(login, { error: 'Невірний код. Спробуйте ще раз.', typed: '' }); route(); return; }
  login.step = 'done';
  route();
  // Коротка анімація успіху — і в застосунок.
  setTimeout(() => {
    // Без localStorage (приватний режим) сесія живе до закриття вкладки.
    login.session = { phone: fmtPhone(login.phone), at: Date.now() };
    store.set('auth', login.session);
    profile = { ...profile, name: login.name, phone: fmtPhone(login.phone) };
    store.set('profile', profile);
    Object.assign(login, { step: 'phone', error: '' });
    if (location.hash.startsWith('#/login')) location.hash = '#/'; else route();
  }, matchMedia('(prefers-reduced-motion: reduce)').matches ? 200 : 1100);
}

// Чи запис ще попереду: для позначок у списку переписок і в сповіщеннях.
const visitStart = (b) => bookingStart(b).getTime();
function visitState(b) {
  if (!ACTIVE.includes(b.state)) return { over: true, label: isFrozen(b) ? 'Виконано' : STATE_LABEL[b.state]?.[1] ?? 'Завершено' };
  if (b.state === 'paid' && Date.now() > visitStart(b) + (b.minutes ?? 60) * 60000) return { over: false, label: 'Візит минув' };
  return { over: false, label: b.state === 'paid' ? 'Попереду' : STATE_LABEL[b.state][1] };
}

// Сповіщення застаріло: нагадування про візит, що вже почався, або повідомлення про запис, який потім закрили.
function staleNote(m) {
  const b = m.bookingId && bookings.find((x) => x.id === m.bookingId);
  if (!b) return false;
  if (m.kind === 'remind' && Date.now() >= visitStart(b)) return true;
  if (ACTIVE.includes(b.state)) return false;
  return m.at <= (b.completedAt ?? b.closedAt ?? b.doneAt ?? Date.now());
}

// Список переписок у «Повідомленнях»: чати за записами, запити до мийок і підтримка — новіші зверху.
function conversations() {
  const rows = [
    ...mine().filter((b) => b.chat?.length).map((b) => {
      const last = chatTimeline(b).at(-1);
      const p = placeById(b.placeId);
      const st = visitState(b);
      return { at: last.at, href: `#/chat/${b.id}`, name: p?.name ?? 'Мийка', sub: `${dayLabel(b.date, { day: 'numeric', month: 'short' })}, ${b.time}`,
        text: `${last.from === 'client' ? 'Ви: ' : ''}${msgPreview(last)}`, unread: !!b.chatUnreadClient, placeId: b.placeId, status: st.label, over: st.over };
    }),
    ...requests.map((r) => {
      const last = r.messages.at(-1);
      return { at: last.at, href: `#/ask/${r.placeId}`, name: placeById(r.placeId)?.name ?? 'Мийка', sub: `Запит про послугу · ${reqStatus(r)[1]}`,
        text: `${last.from === 'client' ? 'Ви: ' : ''}${msgPreview(last)}`, unread: !!r.unreadClient, placeId: r.placeId, over: !!r.closed && !r.unreadClient };
    }),
    ...myTickets().map((t) => {
      const last = t.messages.at(-1);
      return { at: last.at, href: `#/support/t/${t.id}`, name: 'Підтримка CARCAR', sub: `№${t.no}`, text: `${last.from === 'client' ? 'Ви: ' : ''}${last.text}`, unread: !!t.unreadUser, support: true };
    }),
  ].sort((a, c) => c.at - a.at);
  if (!rows.length) return '';
  const item = (r) => `<li><a class="convo${r.unread ? ' unread' : ''}${r.over ? ' over' : ''}" href="${r.href}">
    ${r.support ? `<span class="avatar support" aria-hidden="true">${icon('shield', 20)}</span>` : avatar(r.name, !r.over && !!r.placeId && presenceOf(r.placeId).online)}
    <span class="convo-body"><span class="convo-top"><b>${esc(r.name)}</b><time>${shortTime(r.at)}</time></span>
      <span class="convo-text">${esc(r.text.length > 80 ? `${r.text.slice(0, 80).trimEnd()}…` : r.text)}</span>
      <small>${esc(r.sub)}${r.status ? ` · <span class="convo-state${r.over ? '' : ' live'}">${esc(r.status)}</span>` : ''}</small></span>
    ${r.unread ? '<span class="dot" aria-label="непрочитане"></span>' : ''}</a></li>`;
  // Завершені записи й закриті запити — окремо й згорнуто, щоб не змішувались з актуальними.
  const live = rows.filter((r) => !r.over);
  const over = rows.filter((r) => r.over);
  return `<h2>Чати</h2>
    ${live.length ? `<ul class="convos">${live.map(item).join('')}</ul>` : '<p class="small muted">Активних переписок немає.</p>'}
    ${over.length ? `<details class="fold convo-archive"><summary>${icon('checkCircle', 20)}Завершені<span class="fold-note">${over.length}</span></summary>
      <ul class="convos">${over.map(item).join('')}</ul></details>` : ''}`;
}

// ---------- підтримка CARCAR ----------

const myTickets = () => ticketsAll().filter((t) => t.from === 'client' && (myKeys().includes(t.clientKey) || t.clientKey === 'device' || !t.clientKey))
  .sort((a, b) => b.updatedAt - a.updatedAt);
const ticketWho = (m) => (m.from === 'admin' ? 'Підтримка CARCAR' : m.from === 'place' ? 'Точка' : 'Ви');

function ticketCard(t, open) {
  const [label, cls] = TICKET_STATUS[t.status];
  const b = t.bookingId ? bookings.find((x) => x.id === t.bookingId) : null;
  return `<article class="card ticket${t.unreadUser ? ' unread' : ''}" id="t-${t.id}" aria-label="Звернення №${t.no}">
    <div class="head"><b>№${t.no} · ${TICKET_TOPICS[t.topic]}</b><span class="pill-s ${cls}">${label}</span></div>
    ${b ? `<a class="small" href="#/bookings/${b.id}">${esc(placeById(b.placeId)?.name ?? '')}, ${dayLabel(b.date, { day: 'numeric', month: 'short' })} ${b.time}${b.state === 'dispute' ? ' · спір відкрито' : ''}</a>` : ''}
    ${open ? `<ol class="thread">${t.messages.map((m) => `<li class="msg ${m.from === 'client' ? 'client' : 'biz'}"><span class="who">${ticketWho(m)} · ${fmtTime(m.at)}</span>${esc(m.text)}</li>`).join('')}</ol>
      ${t.status === 'closed' ? `<p class="small muted" style="margin:0">Звернення закрито. Якщо питання лишилось — напишіть, і ми відкриємо його знову.</p>` : ''}
      <form class="ticket-reply inline-form" data-id="${t.id}"><label class="field"><span>Відповідь підтримці</span><input name="text" required maxlength="800" autocomplete="off"></label>
        <button class="btn primary" type="submit">Надіслати</button></form>`
      : `<p class="small muted" style="margin:0">${esc(t.messages.at(-1).text.slice(0, 90))}${t.messages.at(-1).text.length > 90 ? '…' : ''}</p>
      <a class="btn" href="#/support/t/${t.id}">${t.unreadUser ? 'Нова відповідь — відкрити' : 'Відкрити'}</a>`}
  </article>`;
}

function viewSupport(sub, arg) {
  const list = myTickets();
  if (sub === 't') {
    const t = list.find((x) => x.id === arg);
    if (!t) return viewNotFound();
    if (t.unreadUser) setTicket(t.id, { unreadUser: false });
    return `${back('#/support', 'Підтримка')}<h1>Звернення №${t.no}</h1>${ticketCard({ ...t, unreadUser: false }, true)}`;
  }
  const pre = sub === 'new' ? arg : '';
  const pb = pre ? bookings.find((x) => x.id === pre) : null;
  const options = mine().sort((a, b) => bookingStart(b) - bookingStart(a)).slice(0, 15);
  return `${back('#/garage', 'Гараж')}<h1>Підтримка CARCAR</h1>
    <p class="lead">Пишіть, якщо щось пішло не так з оплатою, записом чи якістю послуги. Термінові питання про гроші розглядаємо до 2 годин, решту — протягом доби.</p>
    ${list.length ? `<h2>Ваші звернення</h2><div class="stack" style="gap:8px">${list.map((t) => ticketCard(t, false)).join('')}</div>` : ''}
    <h2>Нове звернення</h2>
    <form id="ticket-form" class="card stack">
      <label class="field"><span>Тема</span><select name="topic">${CLIENT_TOPICS.map((k) => `<option value="${k}" ${pb && pb.state === 'done' && k === 'quality' ? 'selected' : ''}>${TICKET_TOPICS[k]}</option>`).join('')}</select></label>
      <label class="field"><span>Запис</span><select name="booking"><option value="">Не стосується запису</option>
        ${options.map((b) => `<option value="${b.id}" ${b.id === pre ? 'selected' : ''}>${esc(placeById(b.placeId)?.name ?? '')} · ${dayLabel(b.date, { day: 'numeric', month: 'short' })} ${b.time} · ${STATE_LABEL[b.state]?.[1] ?? ''}</option>`).join('')}</select></label>
      <label class="field"><span>Що сталося?</span><textarea name="text" rows="4" required maxlength="1000" placeholder="Опишіть ситуацію: що, коли й що ви очікуєте від нас"></textarea></label>
      <label class="check-row small"><input class="check" type="checkbox" name="dispute"><span>Відкрити спір: заморозити оплату за цим записом, доки модератор не вирішить (для виконаних чи оплачених записів)</span></label>
      <button class="btn primary block" type="submit">${icon('chat', 18)}Надіслати в підтримку</button>
      <p class="fine">Звернення бачить лише служба підтримки CARCAR${pb ? ' і, якщо потрібно, точка з вашого запису' : ''}. Відповідь прийде в «Повідомлення».</p>
    </form>`;
}

function supportCard() {
  const unread = myTickets().filter((t) => t.unreadUser).length;
  return `<a class="card link-card" href="#/support" style="margin-top:16px">${icon('info', 22)}<span>Підтримка CARCAR
    <small class="small muted" style="display:block;font-weight:400">Оплата, записи, спори й безпека — відповідаємо в застосунку</small></span>
    ${unread ? `<span class="count" aria-label="нових відповідей: ${unread}">${unread}</span>` : ''}${icon('chevR', 18)}</a>`;
}

// ---------- перенесення запису ----------

// Перенести можна до кінця безкоштовного скасування: оплата, знижки й бонуси лишаються як були.
const MOVE_LIMIT = 3;
let move = null; // { id, date, time }

function viewMove(id) {
  const b = mine().find((x) => x.id === id);
  if (!b || b.state !== 'paid') return viewNotFound();
  const p = placeById(b.placeId);
  const t = cancelTerms(b);
  const head = `${back(`#/bookings/${b.id}`, 'Мої записи')}<h1>Перенести запис</h1>
    <p class="lead">${esc(p.name)} · ${esc(b.services.join(', '))}<br>Зараз: ${dayLabel(b.date, { weekday: 'short', day: 'numeric', month: 'long' })}, ${b.time}</p>`;
  if (!t.inWindow) return `${head}<p class="notice warn">Перенести можна було до ${fmtTime(t.deadline)}. Напишіть точці в чаті запису — можливо, вона знайде інший час.</p>`;
  if ((b.moves?.length ?? 0) >= MOVE_LIMIT) return `${head}<p class="notice warn">Запис уже переносили ${MOVE_LIMIT} рази, більше не можна. Напишіть мийці в чат або скасуйте запис безкоштовно до ${fmtTime(t.deadline)}.</p>`;
  if (move?.id !== id) move = { id, date: b.date, time: null };
  return `${head}<p class="notice ok ic-row">${icon('shield', 18)}Оплата ${uah(b.paid)} не скасовується й не списується вдруге — змінюється лише час. Ціна лишається тією самою.</p>
    <div id="move"></div>`;
}

function renderMove() {
  const b = bookings.find((x) => x.id === move.id);
  const p = placeById(b.placeId);
  const slots = slotsFor(p, move.date, b.minutes, { skip: b, mobile: !!b.mobile });
  if (move.time && !slots.some((x) => x.time === move.time && !x.busy)) move.time = null;
  const same = (time) => move.date === b.date && time === b.time;
  $('#move').innerHTML = `<h2>Новий день</h2>
    <div class="days" role="group" aria-label="День">${bookingDays(p).map((d, i) => {
      const date = parseDate(d);
      const wd = i === 0 ? 'Сьогодні' : i === 1 ? 'Завтра' : date.toLocaleDateString('uk-UA', { weekday: 'short' });
      const closed = !hoursFor(p, d);
      return `<button class="day${closed ? ' closed' : ''}" data-action="move-day" data-date="${d}" aria-pressed="${d === move.date}" ${closed ? `disabled aria-label="${wd}, ${date.getDate()}, вихідний"` : ''}>
        <span>${wd}</span><b>${date.getDate()}</b><span>${closed ? 'вихідний' : date.toLocaleDateString('uk-UA', { month: 'short' })}</span></button>`;
    }).join('')}</div>
    <h2>Новий час</h2>
    ${slots.some((x) => !x.busy) ? `<div class="slots" role="group" aria-label="Час">${slots.map((x) => `<button class="slot" data-action="move-time" data-time="${x.time}"
      ${x.busy || same(x.time) ? `disabled aria-label="${x.time}, ${same(x.time) ? 'ваш поточний час' : 'зайнято'}"` : ''} aria-pressed="${x.time === move.time}">${x.time}${same(x.time) ? '<small>зараз</small>' : ''}</button>`).join('')}</div>`
      : '<p class="muted">На цей день вільного часу немає. Оберіть інший день.</p>'}
    <div class="dock-space"></div>
    <div class="dock"><button class="btn primary block" data-action="move-confirm" ${move.time ? '' : 'disabled'}>${move.time ? `Перенести на ${dayLabel(move.date, { day: 'numeric', month: 'long' })}, ${move.time}` : 'Оберіть новий час'}</button></div>`;
}

function confirmMove() {
  const b = bookings.find((x) => x.id === move.id);
  if (!cancelTerms(b).inWindow) { toast('Час для перенесення минув'); route(); return; }
  if ((b.moves?.length ?? 0) >= MOVE_LIMIT) { toast('Ліміт перенесень вичерпано'); route(); return; }
  const from = `${dayLabel(b.date, { day: 'numeric', month: 'long' })}, ${b.time}`;
  const to = `${dayLabel(move.date, { day: 'numeric', month: 'long' })}, ${move.time}`;
  b.moves = [...(b.moves ?? []), { date: b.date, time: b.time, at: Date.now() }];
  Object.assign(b, { date: move.date, time: move.time });
  // Нагадування й «Їду» стосувалися старого часу.
  for (const k of ['remindDay', 'remind2h', 'eta', 'late', 'etaAt']) delete b[k];
  chatPost(b, 'sys', `Клієнт переніс запис з ${from} на ${to}`, 'biz');
  move = null;
  save();
  track('move', { placeId: b.placeId });
  location.hash = `#/bookings/${b.id}`;
  toast(`Запис перенесено на ${to}. Оплата збережена`);
}

// ---------- нагадування про візит ----------

// Нагадування надходять увечері напередодні (о 18:00) і за 2 години до візиту.
// У робочій версії це push-сповіщення; тут — у «Вхідних» і на картці запису.
function visitReminders() {
  const now = Date.now();
  const sent = [];
  for (const b of mine()) {
    if (b.state !== 'paid') continue;
    const start = bookingStart(b).getTime();
    if (start <= now) continue;
    const p = placeById(b.placeId);
    const eve = parseDate(b.date).getTime() - 6 * HOUR; // 18:00 напередодні
    const h2 = start - 2 * HOUR;
    if (now >= h2 && (b.createdAt ?? 0) < h2 && !b.remind2h) {
      b.remind2h = now;
      sent.push({ b, text: `Через ${duration(Math.round((start - now) / 60000 / 5) * 5)} — ${p.name}, ${b.time}, ${p.address}. Ви вже їдете?` });
    } else if (now >= eve && now < h2 && (b.createdAt ?? 0) < eve && !b.remindDay) {
      b.remindDay = now;
      sent.push({ b, text: `Нагадуємо: ${b.date === isoDate(new Date(now)) ? 'сьогодні' : 'завтра'} о ${b.time} — ${p.name}, ${p.address}. ${b.services.join(', ')}.` });
    }
  }
  if (!sent.length) return;
  save();
  sendMessages(sent.map(({ b, text }) => ({ placeId: b.placeId, clientKey: 'device', channel: 'app', kind: 'remind', bookingId: b.id, text, link: `#/bookings/${b.id}` })));
}

// Блок біля запису, що скоро: «Запізнююсь на 15 хв» — мийка бачить це в журналі.
// Запізнення понад PAYMENT.lateMinutes — як неявка: оплата зараховується мийці.
function visitBar(b) {
  const left = bookingStart(b).getTime() - Date.now();
  if (left <= -30 * 60000 || left > 24 * HOUR) return '';
  return `<div class="visit-bar" role="group" aria-label="Візит ${b.date === isoDate(new Date()) ? 'сьогодні' : 'завтра'} о ${b.time}">
    <p class="small" style="margin:0">${icon('bell', 16)}${b.late ? `Мийка знає, що ви запізнюєтесь на ${b.late} хв.` : 'Не встигаєте вчасно? Попередьте мийку.'}</p>
    ${b.late ? '' : `<button class="btn" data-action="eta-late" data-id="${b.id}">Запізнююсь на ${PAYMENT.lateMinutes} хв</button>`}
    <p class="fine">Якщо запізнитеся більше ніж на ${PAYMENT.lateMinutes} хв, візит вважається неявкою — оплата ${uah(b.paid)} зараховується мийці.</p>
  </div>`;
}

// ---------- повтор і регулярні записи ----------

// Найближчий день, коли вільний той самий час; інакше — найближчий вільний час до нього.
function repeatSlot(p, minutes, time) {
  for (const d of bookingDays(p)) {
    const slots = slotsFor(p, d, minutes).filter((x) => !x.busy);
    if (slots.some((x) => x.time === time)) return [d, time];
  }
  for (const d of bookingDays(p)) {
    const slots = slotsFor(p, d, minutes).filter((x) => !x.busy);
    if (slots.length) return [d, slots.sort((a, c) => Math.abs(toMin(a.time) - toMin(time)) - Math.abs(toMin(c.time) - toMin(time)))[0].time];
  }
  return [firstOpenDay(p), null];
}

const subs = () => store.get('subscriptions', []);
const EVERY = { 1: 'Щотижня', 2: 'Кожні 2 тижні', 4: 'Кожні 4 тижні' };
const WD_IN = ['у понеділок', 'у вівторок', 'у середу', 'у четвер', 'у пʼятницю', 'у суботу', 'у неділю'];
const subText = (x) => `${EVERY[x.every]} ${WD_IN[x.weekday]} о ${x.time}`;

function subForm(b) {
  const wd = weekdayOf(b.date);
  const opts = [];
  for (let t = 7 * 60; t <= 21 * 60; t += 30) opts.push(hhmm(t));
  return `<form class="sub-form card stack" data-id="${b.id}" style="gap:10px;margin-top:8px">
    <b>Регулярний запис: ${esc(b.services.join(', '))}</b>
    <div class="grid2">
      <label class="field"><span>Як часто</span><select name="every">${Object.entries(EVERY).map(([k, v]) => `<option value="${k}" ${k === '2' ? 'selected' : ''}>${v}</option>`).join('')}</select></label>
      <label class="field"><span>День</span><select name="weekday">${WEEKDAY_NAMES.map((n, i) => `<option value="${i}" ${i === wd ? 'selected' : ''}>${n}</option>`).join('')}</select></label>
      <label class="field full"><span>Час</span><select name="time">${opts.map((t) => `<option ${t === b.time ? 'selected' : ''}>${t}</option>`).join('')}</select></label>
    </div>
    <p class="fine">Записуємо за тиждень до візиту й оплачуємо карткою автоматично; про кожен запис прийде сповіщення. Скасувати візит чи всю підписку можна будь-коли.</p>
    <button class="btn primary" type="submit">Увімкнути</button>
  </form>`;
}

function subsCard() {
  const list = subs().filter((x) => x.status !== 'deleted');
  if (!list.length) return '';
  return `<h2>Регулярні записи</h2><div class="stack" style="gap:8px">${list.map((x) => {
    const p = placeById(x.placeId);
    const next = mine().filter((b) => b.subId === x.id && b.state === 'paid' && bookingStart(b) > new Date()).sort((a, c) => bookingStart(a) - bookingStart(c))[0];
    return `<section class="card stack sub-card" style="gap:6px" aria-label="Регулярний запис: ${esc(p?.name ?? '')}">
      <div class="head"><b>${subText(x)}</b><span class="pill ${x.status === 'paused' ? '' : 'ok'}">${x.status === 'paused' ? 'на паузі' : 'активний'}</span></div>
      <span class="small">${esc(p?.name ?? '')} · ${esc(x.names.join(', '))}${x.car ? ` · ${esc(x.car)}` : ''}</span>
      ${next ? `<span class="small muted">Найближчий: ${dayLabel(next.date, { weekday: 'short', day: 'numeric', month: 'long' })}, ${next.time}</span>` : ''}
      <div class="grid2"><button class="btn" data-action="sub-toggle" data-id="${x.id}">${x.status === 'paused' ? 'Відновити' : 'Призупинити'}</button>
        <button class="btn text-danger" data-action="sub-del" data-id="${x.id}">Видалити</button></div>
    </section>`;
  }).join('')}</div>`;
}

// Створює записи за регулярними підписками на найближчі 7 днів. Час зайнятий — беремо найближчий вільний у межах 2 годин.
function runSubscriptions() {
  const list = subs();
  if (!list.length) return;
  const sent = [];
  const today = isoDate(new Date());
  for (const x of list) {
    if (x.status !== 'active') continue;
    const p = placeById(x.placeId);
    if (!p || !isListed(p)) continue;
    for (let i = 0; i <= 7; i++) {
      const d = new Date();
      d.setDate(d.getDate() + i);
      const date = isoDate(d);
      if (date < x.start || weekdayOf(date) !== x.weekday) continue;
      const weeks = Math.round((parseDate(date) - parseDate(x.start)) / (7 * 864e5));
      if (weeks % x.every || x.made.includes(date)) continue;
      x.made.push(date);
      const chosen = bookable(p).filter((sv) => x.services.includes(sv.id));
      if (!chosen.length) continue;
      const minutes = chosen.reduce((a, sv) => a + sv.min, 0);
      const free = slotsFor(p, date, minutes).filter((sl) => !sl.busy).map((sl) => sl.time)
        .filter((t) => Math.abs(toMin(t) - toMin(x.time)) <= 120).sort((a, c) => Math.abs(toMin(a) - toMin(x.time)) - Math.abs(toMin(c) - toMin(x.time)));
      if (!free.length) {
        sent.push({ placeId: p.id, clientKey: 'device', channel: 'app', kind: 'sub', text: `${p.name}: на ${dayLabel(date, { weekday: 'short', day: 'numeric', month: 'long' })} біля ${x.time} немає вільного часу, регулярний запис пропущено. Оберіть інший час.`, link: `#/book/${p.id}/${date}` });
        continue;
      }
      const time = free[0];
      const deal = dealAt(p.id, date, time);
      const total = chosen.reduce((a, sv) => a + (!sv.personal && dealCovers(deal, sv.id) ? dealPrice(sv.price[x.cls], deal.pct) : sv.price[x.cls]), 0);
      const b = {
        id: uid(), placeId: p.id, services: chosen.map((sv) => sv.name), total, listTotal: chosen.reduce((a, sv) => a + sv.price[x.cls], 0),
        deal: total < chosen.reduce((a, sv) => a + sv.price[x.cls], 0) ? { id: deal.id, pct: deal.pct } : null, covered: 0, passUse: null,
        paid: total, fromBalance: 0, bonus: 0, minutes, date, time, car: x.car || CAR_CLASSES[x.cls], carId: x.carId, plate: x.plate ?? '', cls: x.cls,
        clientName: profile.name, clientPhone: profile.phone, optIn: !!profile.optIn, personal: [], state: 'paid', createdAt: Date.now(), subId: x.id,
      };
      bookings.push(b);
      sent.push({ placeId: p.id, clientKey: 'device', channel: 'app', kind: 'sub', bookingId: b.id, link: `#/bookings/${b.id}`,
        text: `Регулярний запис: ${p.name}, ${dayLabel(date, { weekday: 'short', day: 'numeric', month: 'long' })} о ${time}${time !== x.time ? ` (о ${x.time} було зайнято)` : ''}. Оплачено ${uah(total)} з картки.` });
      track('sub_booking', { placeId: p.id });
    }
  }
  store.set('subscriptions', list);
  if (sent.length) { save(); sendMessages(sent); }
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
  const waits = store.get('waitlist', []).filter((w) => w.mine && w.status === 'active');
  // Сповіщень окремим блоком немає: нагадування видно на картці запису, відповіді — у чатах.
  // Лишаємо тільки «звільнився час» з листа очікування — по ньому треба встигнути записатися.
  const offers = inboxFor(keys).filter((m) => m.kind === 'waitlist' && !staleNote(m)).slice(0, 3);
  const chats = conversations();
  const html = `<h1>Повідомлення</h1>
    ${offers.length || waits.length ? `<h2>Лист очікування</h2><div class="stack" style="gap:8px">
      ${offers.map((m) => `<article class="card wait-offer${m.read ? '' : ' unread'}">${icon('bolt', 22)}<div><p style="margin:0">${esc(m.text)}</p>
        <span class="small muted">${fmtTime(m.at)}</span></div>
        ${m.link ? `<a class="btn primary" href="${esc(m.link)}">Записатися</a>` : ''}</article>`).join('')}
      ${waits.map((w) => `<div class="card head" style="align-items:center">
      <span><b>${esc(placeById(w.placeId)?.name ?? '')}</b><small class="small muted" style="display:block">${dayLabel(w.date, { day: 'numeric', month: 'long' })}, ${hhmm(w.from)}–${hhmm(w.to)} · ${esc(w.services.join(', '))}</small></span>
      <button class="btn" data-action="wait-cancel" data-id="${w.id}">Вийти</button></div>`).join('')}</div>` : ''}
    ${chats || (offers.length || waits.length ? '' : empty('chat', 'Переписок поки немає. Напишіть мийці з картки запису або зі сторінки мийки.'))}`;
  markRead(keys);
  return html;
}

// Лічильник на вкладці «Повідомлення»: непрочитані сповіщення й нові відповіді точок у чатах.
function updateInboxBadge() {
  const unread = inboxFor(myKeys()).filter((m) => !m.read && m.kind === 'waitlist' && !staleNote(m)).length + requests.filter((r) => r.unreadClient).length + mine().filter((b) => b.chatUnreadClient).length + myTickets().filter((t) => t.unreadUser).length;
  const count = $('#inbox-tab .tab-count');
  count.textContent = unread > 9 ? '9+' : unread;
  count.hidden = !unread;
  $('#inbox-tab').setAttribute('aria-label', unread ? `Повідомлення, непрочитаних: ${unread}` : 'Повідомлення');
}

// ---------- гараж: абонементи ----------

// Вхід для власників точок — у профілі, а не в нижньому меню: клієнтам він не потрібен.
const businessEntry = () => `<a class="card link-card biz-entry" href="#/business" style="margin-top:16px">${icon('chart', 22)}<span>Для бізнесу
    <small class="small muted" style="display:block;font-weight:400">Для власників мийок: умови й реєстрація</small></span>${icon('chevR', 18)}</a>`;

// Вихід з акаунта: наступного разу знову вхід за номером. Записи й авто на цьому телефоні лишаються.
const logoutBlock = () => {
  const a = store.get('auth', null) ?? login.session;
  return `<div class="logout-row"><span class="small muted">${a?.phone ? `Ви увійшли як ${esc(a.phone)}` : 'Ви увійшли в CARCAR'}</span>
    <button class="btn text-danger" data-action="logout">Вийти з акаунта</button></div>`;
};

// «Для бізнесу»: умови роботи, заявка на реєстрацію і її статус. Вхід у кабінет — окремо, за логіном і паролем.
const myApp = () => bizApps().filter((a) => a.device).sort((a, b) => b.at - a.at)[0] ?? null;

function viewBusiness(sub) {
  const head = `${back('#/garage', 'Гараж')}`;
  const a = myApp();
  if (sub === 'apply' && !(a && a.status !== 'rejected')) return `${head}<h1>Реєстрація мийки</h1>${bizApplyForm()}`;
  const terms = [
    ['cash', 'Комісія 7% із замовлень через CARCAR', 'Абонплати немає, за підключення не платите. Записи, які ви вносите самі, без комісії.'],
    ['card', 'Клієнт платить одразу під час запису', `Коли авто готове, ви натискаєте «Машина готова». Гроші ${PAYMENT.freezeHours} годин чекають на випадок спору, потім виводите їх на рахунок ФОП або ТОВ.`],
    ['shield', 'Неявку оплачує клієнт', `Скасував пізніше ніж за ${cancelWindow()}, не приїхав чи запізнився більш ніж на ${PAYMENT.lateMinutes} хв — гроші лишаються вам. Один запис можна перенести не більше ${MOVE_LIMIT} разів.`],
    ['calendar', 'Кабінет для мийки безкоштовно', 'Розклад по боксах, клієнти, чати, прайс, відгуки й фінанси. Зручно з телефона.'],
    ['star', 'Відгуки тільки від справжніх клієнтів', 'Відгук може залишити лише той, хто був у вас на мийці. Відповісти можна публічно.'],
  ];
  return `${head}<h1>CARCAR для бізнесу</h1>
    <p class="lead">Люди по всій Україні знаходять мийку поруч, записуються й одразу платять. Вам лишається мити.</p>
    ${a ? bizAppStatus(a) : ''}
    <h2>Умови роботи</h2>
    <ul class="biz-terms">${terms.map(([ic, t, d]) => `<li>${icon(ic, 22)}<span><b>${t}</b>${d}</span></li>`).join('')}</ul>
    <h2>Що потрібно</h2>
    <ul class="biz-need"><li>ФОП або ТОВ і рахунок IBAN для виплат</li><li>Адреса, фото, графік і кількість боксів</li><li>Прайс. Шаблон уже готовий, лишиться поправити ціни</li></ul>
    <h2>Як підключитися</h2>
    <ol class="biz-steps"><li><span><b>Заявка</b>, 2 хвилини</span></li><li><span><b>Перевірка</b>, до 2 робочих днів</span></li><li><span><b>Логін і пароль</b> приходять у SMS</span></li><li><span><b>Перші записи</b> в кабінеті</span></li></ol>
    <div class="dock-space"></div>
    <div class="dock biz-dock">
      ${a && a.status !== 'rejected' ? '' : '<a class="btn primary block" href="#/business/apply">Зареєструвати бізнес</a>'}
      <a class="btn block" href="business.html">${icon('shield', 18)}Увійти в кабінет бізнесу</a>
    </div>`;
}

function bizAppStatus(a) {
  const [label, cls] = APP_STATUS[a.status];
  return `<section class="card app-status ${cls}" aria-label="Ваша заявка">
    <div class="head"><b>Заявка: ${esc(a.name)}</b><span class="pill ${cls}">${label}</span></div>
    ${a.status === 'new' ? '<p class="small muted" style="margin:0">Перевіримо дані й надішлемо логін і пароль у SMS.</p>' : ''}
    ${a.status === 'approved' ? `<p style="margin:0">Мийку підключено. Дані для входу:</p>
      <dl class="kv"><dt>Логін</dt><dd><b class="code">${esc(a.issued.login)}</b></dd><dt>Пароль</dt><dd><b class="code">${esc(a.issued.password)}</b></dd></dl>
      <p class="fine" style="margin:0">Це демо. Насправді логін і пароль приходять у SMS.</p>
      <a class="btn primary" href="business.html">Увійти в кабінет</a>` : ''}
    ${a.status === 'rejected' ? `<p class="small" style="margin:0">Причина: ${esc(a.reason || 'не вказано')}. Виправте й надішліть ще раз.</p>` : ''}
  </section>`;
}

function bizApplyForm() {
  return `<form class="stack" id="biz-apply" style="gap:14px">
    <label class="field"><span>Назва мийки</span><input name="name" required maxlength="60" placeholder="Автомийка «Хмаринка»"></label>
    <div class="grid2 pf">
      <label class="field"><span>Місто</span><select name="city">${CITIES.map((c) => `<option ${c.name === ui.city ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select></label>
      <label class="field"><span>Кількість боксів</span><input name="boxes" type="number" min="1" max="30" value="2" required></label>
    </div>
    <label class="field"><span>Адреса</span><input name="address" required maxlength="100" placeholder="вул. Хрещатик, 1"></label>
    <div class="grid2 pf">
      <label class="field"><span>Контактна особа</span><input name="contact" required autocomplete="name" value="${esc(profile.name)}"></label>
      <label class="field"><span>Телефон</span><input name="phone" type="tel" required autocomplete="tel" value="${esc(profile.phone)}"></label>
    </div>
    <label class="field"><span>Email</span><input name="email" type="email" autocomplete="email" placeholder="wash@example.com"></label>
    <fieldset class="radio-row"><legend>Форма бізнесу</legend>
      <label><input type="radio" name="type" value="fop" checked> ФОП</label><label><input type="radio" name="type" value="tov"> ТОВ</label></fieldset>
    <label class="field"><span>ІПН (ФОП) або ЄДРПОУ (ТОВ)</span><input name="code" required inputmode="numeric" pattern="\\d{8}|\\d{10}" title="8 цифр ЄДРПОУ або 10 цифр ІПН"></label>
    <label class="check-row small"><input class="check" type="checkbox" name="agree" required><span>Погоджуюсь з умовами: 7% із замовлень через CARCAR, правила скасувань і спорів</span></label>
    <button class="btn primary block" type="submit">Надіслати заявку</button>
    <p class="fine">Після перевірки надішлемо логін і пароль до кабінету.</p>
  </form>`;
}

function garageExtras() {
  const keys = myKeys();
  const passes = PLACES.flatMap((p) => passesOf(p.id).sold.filter((x) => (x.buyer === 'app' || keys.includes(x.clientKey)) && passActive(x)).map((x) => ({ ...x, place: p })));
  if (!passes.length) return '';
  return `<h2 class="big">Абонементи й сертифікати</h2><div class="stack" style="gap:8px">${passes.map((x) => `<section class="card stack" style="gap:4px" aria-label="${esc(x.name)}">
      <div class="head"><b>${esc(x.name)}</b><span class="small muted">${esc(x.place.name)}</span></div>
      <span class="small">Лишилось ${passLeft(x)} · діє до ${fmtDate(x.validUntil)}</span>
      ${x.kind === 'cert' ? `<span class="small">Код для оплати чи подарунка: <b class="code">${esc(x.code)}</b></span>` : ''}
    </section>`).join('')}</div>`;
}

// Завершені — компактні рядки по місяцях: тап розгортає повну картку. Розгорнуті лише ті, що чекають
// на дію (оцінити візит, спір) або щойно відкриті. Довга історія — сторінками по DONE_PAGE.
const DONE_PAGE = 10;
const needsAction = (b) => (b.state === 'completed' && !reviews.some((r) => r.bookingId === b.id)) || b.state === 'dispute';

function doneItem(b, highlight) {
  const p = placeById(b.placeId);
  const [, label] = STATE_LABEL[b.state];
  // Розгорнуте лишається розгорнутим після оновлення сторінки (відгук, повтор, регулярний запис).
  const open = highlight || needsAction(b) || ui.doneOpen?.has(b.id);
  return `<details class="done-item st-${b.state}" data-id="${b.id}" ${open ? 'open' : ''}>
    <summary>
      <span class="di-ic" aria-hidden="true">${icon(STATE_ICON[b.state] ?? 'checkCircle', 18)}</span>
      <span class="di-main"><b>${esc(p?.name ?? 'Мийка')}</b><small>${dayLabel(b.date, { day: 'numeric', month: 'short' })}, ${b.time} · ${esc(b.services[0] ?? '')}${b.services.length > 1 ? ` +${b.services.length - 1}` : ''}</small></span>
      <span class="di-side"><b>${uah(b.paid)}</b><small>${esc(label)}${needsAction(b) && b.state === 'completed' ? ' · оцініть' : ''}</small></span>
      <span class="di-chev" aria-hidden="true">${icon('chevR', 18)}</span>
    </summary>
    ${bookingCard(b, highlight)}
  </details>`;
}

function doneByMonth(all, highlightId) {
  const limit = Math.max(ui.doneLimit ?? DONE_PAGE, all.findIndex((b) => b.id === highlightId) + 1);
  const list = all.slice(0, limit);
  const groups = new Map();
  for (const b of list) {
    const key = b.date.slice(0, 7);
    groups.set(key, [...(groups.get(key) ?? []), b]);
  }
  const months = [...groups].map(([key, items]) => {
    const name = parseDate(`${key}-01`).toLocaleDateString('uk-UA', { month: 'long', year: 'numeric' }).replace(' р.', '');
    const monthAll = all.filter((b) => b.date.startsWith(key));
    const done = monthAll.filter((b) => b.state === 'completed');
    return `<section class="done-month" aria-label="${esc(name)}">
      <div class="month-h"><h3>${esc(name[0].toUpperCase() + name.slice(1))}</h3>
        <span>${done.length} ${plural(done.length, 'візит', 'візити', 'візитів')}${done.length ? ` · ${uah(done.reduce((a, b) => a + price(b), 0))}` : ''}</span></div>
      <div class="done-list">${items.map((b) => doneItem(b, b.id === highlightId)).join('')}</div>
    </section>`;
  }).join('');
  const left = all.length - list.length;
  return `${months}${left ? `<button class="btn block done-more" data-action="done-more">Показати ще ${Math.min(left, DONE_PAGE)} з ${left}</button>` : ''}`;
}

function viewBookings(highlightId) {
  const list = mine();
  const sorted = [...list].sort((a, b) => bookingStart(a) - bookingStart(b));
  const active = sorted.filter((b) => ACTIVE.includes(b.state));
  const rest = sorted.filter((b) => !ACTIVE.includes(b.state)).reverse();
  if (!list.length) {
    return `<h1>Мої записи</h1>${empty('calendar', 'Записів поки немає.', '<a class="btn primary" href="#/">Знайти мийку</a>')}${inviteCard()}`;
  }
  // Відкриваємо вкладку з записом, про який ідеться (щойно оплачений, скасований чи з повідомлення).
  const focus = ui.bookFocus ?? (highlightId !== ui.tabFor ? highlightId : null);
  ui.bookFocus = null;
  ui.tabFor = highlightId;
  if (focus && list.some((b) => b.id === focus)) ui.bookTab = active.some((b) => b.id === focus) ? 'active' : 'done';
  const tab = ui.bookTab ?? (active.length || !rest.length ? 'active' : 'done');
  return `<h1>Мої записи</h1>
    <div class="book-tabs" role="group" aria-label="Які записи показати">
      <button data-action="book-tab" data-tab="active" aria-pressed="${tab === 'active'}">Активні<span>${active.length}</span></button>
      <button data-action="book-tab" data-tab="done" aria-pressed="${tab === 'done'}">Завершені<span>${rest.length}</span></button>
    </div>
    ${tab === 'active'
      ? `${subsCard()}<h2 class="sr-only">Активні записи</h2><div class="stack" style="margin-top:12px">${active.length ? active.map((b) => bookingCard(b, b.id === highlightId)).join('') : empty('calendar', 'Активних записів немає.', '<a class="btn primary" href="#/">Записатися на мийку</a>')}</div>`
      : `<h2 class="sr-only">Завершені записи</h2>${rest.length ? doneByMonth(rest, highlightId ?? focus) : `<div class="stack" style="margin-top:12px">${empty('calendar', 'Завершених записів ще немає.')}</div>`}${inviteCard()}`}`;
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
  return `${back('#/garage', 'Гараж')}<h1>Кабінет точки</h1>
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
    .map((b) => ({ date: b.date, km: b.km, text: [...b.services, ...(b.estimate?.items ?? []).filter((x) => x.status === 'approved').map((x) => x.name)].join(', '), cost: price(b), place: placeById(b.placeId)?.name, photos: b.photos, note: b.note }));
  return [...fromApp, ...(car.log ?? [])].sort((x, y) => (x.date < y.date ? 1 : -1));
}

const currentKm = (car) => Math.max(car.mileage || 0, ...historyOf(car).map((h) => h.km || 0));

// Нагадування в гаражі: час помити авто (за останньою мийкою) і поліс ОСЦПВ.
function reminders(car) {
  const out = [];
  const now = new Date();
  const last = historyOf(car)[0];
  const days = last ? Math.floor((now - parseDate(last.date)) / (24 * HOUR)) : null;
  if (days === null) out.push({ level: 'info', text: 'Ще немає мийок цього авто в CARCAR', cat: 'wash' });
  else if (days >= MAINTENANCE.washDays) out.push({ level: 'due', text: `Авто не мили ${days} ${plural(days, 'день', 'дні', 'днів')} — час на мийку`, cat: 'wash' });
  else out.push({ level: 'ok', text: `Остання мийка ${fmtDate(last.date)}` });

  if (car.insuranceUntil) {
    const left = Math.ceil((parseDate(car.insuranceUntil) - now) / (24 * HOUR));
    if (left < 0) out.push({ level: 'due', text: 'Поліс ОСЦПВ прострочено' });
    else if (left <= MAINTENANCE.insuranceWarnDays) out.push({ level: 'due', text: `Поліс ОСЦПВ закінчується через ${left} ${plural(left, 'день', 'дні', 'днів')}` });
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
      <p class="small muted" style="margin:0">Їх бачить лише мийка, до якої ви записуєтесь.</p>
      <div class="grid2">
        <label class="field"><span>Імʼя</span><input name="name" autocomplete="name" value="${esc(profile.name)}"></label>
        <label class="field"><span>Телефон</span><input name="phone" type="tel" autocomplete="tel" placeholder="+380" value="${esc(profile.phone)}"></label>
      </div>
      <label class="check-row small"><input class="check" type="checkbox" name="optIn" ${profile.optIn ? 'checked' : ''}><span>Отримувати пропозиції точок, де я обслуговуюсь, у Viber чи Telegram</span></label>
      <button class="btn" type="submit">Зберегти профіль</button>
    </form>
    ${walletLink()}
    ${supportCard()}
    ${garageExtras()}
    <div class="stack">
      ${cars.map((c) => {
        const due = reminders(c).filter((r) => r.level === 'due');
        return `<a class="card car-card" href="#/garage/${c.id}">
          <div class="car-top"><span class="car-tile">${icon('car', 26)}</span>
            <div><h2 class="car-name">${esc(c.make)} ${esc(c.model)}</h2>
            <div class="car-sub">${[c.plate, c.year, CAR_CLASSES[c.cls], currentKm(c) ? km(currentKm(c)) : ''].filter(Boolean).map(esc).join(' · ')}</div></div></div>
          ${due.length ? `<div class="warn-pill">${icon('warn', 16)}${esc(due[0].text)}${due.length > 1 ? ` і ще ${due.length - 1}` : ''}</div>` : ''}
          <div class="card-foot">Історія й нагадування${icon('chevR', 18)}</div>
        </a>`;
      }).join('')}
    </div>
    <details class="fold add-car" id="add-car" ${cars.length && !ui.addCar ? '' : 'open'}><summary>${icon('plus', 20)}${cars.length ? 'Додати ще авто' : 'Додати авто'}</summary>
    ${carForm('carform', `
      <div class="plate-row">
        <label class="field"><span>Держномер</span><input name="plate" placeholder="AA1234BB" autocomplete="off" aria-describedby="plate-result"></label>
        <button class="btn" type="button" data-action="plate-check">${icon('search', 18)}Перевірити</button>
      </div>
      <div id="plate-result" aria-live="polite"></div>
      <label class="field"><span>Марка</span><input name="make" required placeholder="Наприклад, Skoda" autocomplete="off"></label>
      <label class="field"><span>Модель</span><input name="model" required placeholder="Наприклад, Octavia" autocomplete="off"></label>
      <label class="field"><span>Рік випуску (необовʼязково)</span><input name="year" type="number" inputmode="numeric" min="1950" max="${new Date().getFullYear() + 1}" autocomplete="off"></label>
      <label class="field"><span>Клас</span><select name="cls">${CAR_CLASSES.map((c, i) => `<option value="${i}">${c}</option>`).join('')}</select></label>
      <label class="field"><span>Поліс ОСЦПВ дійсний до (необовʼязково)</span><input name="insuranceUntil" type="date"></label>`, 'Зберегти')}
    </details>
    ${businessEntry()}
    ${logoutBlock()}`;
}

function viewCar(id) {
  const c = cars.find((x) => x.id === id);
  if (!c) return viewNotFound();
  const history = historyOf(c);
  return `${back('#/garage', 'Гараж')}
    <h1 style="margin-bottom:2px">${esc(c.make)} ${esc(c.model)}</h1>
    <div class="car-sub">${[c.plate, c.year && `${c.year} р.`, c.color, CAR_CLASSES[c.cls]].filter(Boolean).map(esc).join(' · ')}</div>
    <h2>Нагадування</h2>
    <div class="stack">${reminders(c).map(reminderRow).join('')}</div>
    ${warrantiesOf(c).length ? `<h2>Гарантії</h2><div class="stack" style="gap:8px">${warrantiesOf(c).map((w) => {
      const live = w.until >= isoDate(new Date());
      return `<div class="reminder ${live ? 'ok' : ''}">${icon('shield', 20)}<div><b>${esc(w.name)}</b><span class="small">${esc(w.place)} · ${w.months} міс з ${fmtDate(w.from)} · ${live ? `діє до ${fmtDate(w.until)}` : `закінчилась ${fmtDate(w.until)}`}</span></div></div>`;
    }).join('')}</div>
    <p class="small muted">Якщо щось зламалося за гарантією — напишіть точці або відкрийте <a href="#/bookings">запис</a>; акт і кошторис збережені тут.</p>` : ''}
    <h2>Історія мийок</h2>
    <div class="card history">
      ${history.length ? history.map((h) => `<div class="log-item">
        <div class="log-head"><span>${fmtDate(h.date)}</span>${h.cost ? `<span>${uah(h.cost)}</span>` : ''}</div>
        <div>${esc(h.text)}</div>
        ${h.place || h.km ? `<div class="log-meta">${[h.place, h.km && km(h.km)].filter(Boolean).map(esc).join(' · ')}</div>` : ''}
        ${h.note ? `<div class="facts"><div class="il">${icon('chat', 18)}${esc(h.note)}</div></div>` : ''}
        ${h.photos?.length ? `<div class="thumbs">${h.photos.map((src, i) => `<img src="${esc(src)}" alt="Фото ${i + 1}">`).join('')}</div>` : ''}
      </div>`).join('') : '<p class="muted" style="margin:0">Тут зʼявляться всі візити через CARCAR. Мийки й догляд деінде можна додати вручну.</p>'}
    </div>
    <details class="fold"><summary>${icon('plus', 20)}Додати мийку вручну</summary>
    ${carForm('logform', `
      <label class="field"><span>Дата</span><input name="date" type="date" required value="${isoDate(new Date())}"></label>
      <label class="field"><span>Що зроблено</span><input name="text" required placeholder="Наприклад, мийка кузова на АЗС" autocomplete="off"></label>
      <label class="field"><span>Сума, ₴ (необовʼязково)</span><input name="cost" type="number" inputmode="numeric" min="0" autocomplete="off"></label>`, 'Додати в історію').replace('<form class="form-box" id="logform">', `<form class="form-box" id="logform" data-id="${c.id}">`)}
    </details>
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
    `SUMMARY:${p.name}`, `LOCATION:${p.city ?? ui.city}\\, ${p.address}`, `DESCRIPTION:${b.services.join('\\, ')}`,
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
  // Виконання підтверджує мийка: запис одразу виконаний, гроші заморожені на час для спору.
  Object.assign(b, { photos, note: f.get('note').trim() || null, km: Number(f.get('km')) || null, doneAt: Date.now() });
  complete(b);
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
    track('cancel_try', { placeId: b.placeId, free: t.free, kind: t.kind });
    const msg = t.kind === 'free'
      ? `Скасувати запис? Повернемо ${uah(t.refund)} на баланс CARCAR.`
      : `До візиту менше ${cancelWindow()}, тому оплата ${uah(t.placeAmount)} зарахується точці за послугу — повернення не буде. Скасувати запис?`;
    if (!confirm(msg)) return false;
    Object.assign(b, { state: 'cancelled', refund: t.refund, placeAmount: t.placeAmount, closedAt: Date.now(), cancelBy: 'client', cancelKind: t.kind });
    if (t.kind !== 'late') {
      b.refundTo = 'balance';
      if (t.refund) addMoney(t.refund, `Повернення: ${placeById(b.placeId)?.name ?? 'скасований запис'}`);
      returnBonus(b, 'скасоване замовлення');
      // Візит абонемента чи сума сертифіката повертаються, промокодом можна скористатися знову.
      if (b.passUse) { restorePass(b.placeId, b.passUse); b.passUse = null; }
      if (b.promo) b.promo.returned = true;
    }
    toast(t.kind === 'free' ? `Запис скасовано, ${uah(t.refund)} повернено на баланс` : 'Запис скасовано, оплату зараховано точці');
  },
  'extra-ok'(b) {
    b.paid += b.extra.amount;
    b.services.push(`Доплата: ${b.extra.reason}`);
    delete b.extra;
    toast('Доплату оплачено');
  },
  'est-decline'(b) {
    if (!confirm('Відхилити весь кошторис? Точка виконає лише те, що ви вже оплатили.')) return false;
    for (const x of b.estimate.items) x.status = 'declined';
    Object.assign(b.estimate, { state: 'answered', answeredAt: Date.now() });
    chatPost(b, 'sys', 'Клієнт відхилив кошторис', 'biz');
    toast('Кошторис відхилено');
  },
  'extra-no'(b) {
    delete b.extra;
    b.extraDeclined = true;
  },
  dispute(b) {
    const reason = prompt('Що пішло не так?')?.trim();
    if (!reason) return false;
    Object.assign(b, { state: 'dispute', disputeReason: reason });
    // Спір — це й звернення в підтримку: тут клієнт листується з модератором.
    const t = openTicket({ from: 'client', placeId: b.placeId, bookingId: b.id, topic: 'dispute', text: reason, clientName: profile.name, clientPhone: profile.phone, clientKey: myKeys()[0] });
    b.ticketId = t.id;
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
    Object.assign(b, { state: 'noshow', placeAmount, refund: price(b) - placeAmount, closedAt: Date.now() });
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
  // Вхід за номером телефону — перед будь-яким екраном застосунку.
  const authed = !!(store.get('auth', null) ?? login.session);
  document.body.classList.toggle('in-auth', !authed);
  if (!authed) {
    $('#view').innerHTML = viewLogin();
    (($('#login-name') && !$('#login-name').value) ? $('#login-name') : $('#login-phone, .code-cell'))?.focus();
    return;
  }
  // Вкладка «Мої записи» памʼятається лише поки клієнт у розділі: при новому вході — спершу активні.
  if (page !== 'bookings') { ui.bookTab = null; ui.doneLimit = null; }
  const view = $('#view');
  const tab = ['partner', 'disputes', 'invite'].includes(page) ? '' : ['support', 'wallet', 'business'].includes(page) ? 'garage' : page === 'move' ? 'bookings' : page === 'chat' ? 'inbox' : ['bookings', 'garage', 'inbox'].includes(page) ? page : 'catalog';
  settle();
  // Хтось скасував запис — можливо, звільнився час для листа очікування.
  checkWaitlist(bookings);
  runSubscriptions();
  visitReminders();
  // Крапка на вкладці «Мої записи», коли машина готова, точка просить доплату чи підтвердити акт.
  const ready = mine().some((b) => b.state === 'done' || b.extra || (b.intake && !b.intake.ack) || b.chatUnreadClient || (b.estimate?.state === 'sent' && b.state === 'paid'));
  document.querySelector('.tabs a[data-tab="bookings"]').toggleAttribute('data-badge', ready);

  document.querySelectorAll('.tabs a').forEach((a) => {
    if (a.dataset.tab === tab) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  });

  if (page === 'place') track('view_place', { placeId: arg });
  else if (page === 'book' && draft?.placeId !== arg) track('open_book', { placeId: arg, from: sub ? 'link' : 'page' });
  if (page === '') {
    view.innerHTML = viewCatalog();
    renderList();
    // Один раз за запуск визначаємо місце, щоб на кожній мийці було видно відстань і час у дорозі.
    if (!ui.pos && !ui.locTried) { ui.locTried = true; locate(true); }
  }
  else if (page === 'place') {
    // Старі посилання «Напишіть точці» ведуть на окремий чат.
    if (sub === 'ask') { location.replace(`#/ask/${arg}`); return; }
    view.innerHTML = viewPlace(arg);
    if (!ui.pos && !ui.locTried) { ui.locTried = true; locate(true); }
  }
  else if (page === 'book') { view.innerHTML = viewBook(arg, sub, extra); if ($('#book')) renderBook(); }
  else if (page === 'inbox') view.innerHTML = viewInbox();
  else if (page === 'chat') view.innerHTML = viewChat(arg);
  else if (page === 'ask') view.innerHTML = viewAsk(arg);
  else if (page === 'bookings') {
    // Старі посилання на чат у записі ведуть на окремий екран чату.
    if (sub === 'chat') { location.replace(`#/chat/${arg}`); return; }
    view.innerHTML = viewBookings(arg);
  } else if (page === 'move') { view.innerHTML = viewMove(arg); if ($('#move')) renderMove(); }
  else if (page === 'garage') {
    // «Додати авто» з головної відкриває форму в гаражі.
    ui.addCar = arg === 'add';
    // Додали авто з екрана запису — після збереження повертаємось до запису.
    if (ui.addCar) ui.addReturn = sub === 'book' && draft ? `#/book/${draft.placeId}` : null;
    view.innerHTML = arg && arg !== 'add' ? viewCar(arg) : viewGarage();
  }
  else if (page === 'partner') view.innerHTML = arg ? viewPartnerJob(arg) : viewPartner();
  else if (page === 'disputes') view.innerHTML = viewDisputes();
  else if (page === 'invite') view.innerHTML = viewInvite();
  else if (page === 'wallet') view.innerHTML = viewWallet();
  else if (page === 'business') view.innerHTML = viewBusiness(arg);
  else if (page === 'support') view.innerHTML = viewSupport(arg, sub);
  else view.innerHTML = viewNotFound();

  // Клієнт відкрив чат із точкою — відповіді на його запити прочитані.
  if (page === 'ask' && requests.some((r) => r.placeId === arg && r.unreadClient)) {
    for (const r of requests) if (r.placeId === arg) r.unreadClient = false;
    saveRequests();
  }
  updateInboxBadge();
  // У чаті ховаємо шапку й меню, як у месенджерах, і одразу показуємо останні повідомлення.
  // Без анимації появи: вона зсуває закріплений екран чату, і він «стрибає».
  const inChat = page === 'chat' || page === 'ask';
  document.body.classList.toggle('in-chat', inChat);
  if (inChat) {
    ui.lastView = `${page}/${arg ?? ''}`;
    const list = $('.chat-msgs');
    if (list) {
      const toEnd = () => { list.scrollTop = list.scrollHeight; };
      toEnd();
      // Фото довантажуються пізніше й змінюють висоту — тримаємо низ стрічки.
      for (const img of list.querySelectorAll('img')) if (!img.complete) img.addEventListener('load', toEnd, { once: true });
    }
    return;
  }
  enterView(view, `${page}/${arg ?? ''}` !== ui.lastView);
  ui.lastView = `${page}/${arg ?? ''}`;
  const target = arg && page === 'bookings' ? $(`#b-${arg}`) : page === 'garage' && arg === 'add' ? $('#add-car') : null;
  if (target) target.scrollIntoView({ block: 'center' });
  else window.scrollTo(0, 0);
}

document.addEventListener('click', (e) => {
  const tr = e.target.closest('[data-track]');
  if (tr) track(tr.dataset.track, { placeId: tr.dataset.place ?? null });
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
    if (ui.cat !== 'all') track('filter', { name: `cat:${ui.cat}` });
    e.preventDefault();
    if (location.hash && location.hash !== '#/') location.hash = '#/';
    else route();
  } else if (action === 'near') {
    setSort(ui.sort === 'near' ? 'rating' : 'near');
  } else if (action === 'view') {
    ui.view = el.dataset.v;
    store.set('view', ui.view);
    for (const b of el.parentElement.children) b.setAttribute('aria-pressed', b === el);
    $('#list').innerHTML = '';
    renderList();
    if (ui.view === 'map') track('map_open');
  } else if (action === 'toggle') {
    ui[el.dataset.key] = !ui[el.dataset.key];
    if (ui[el.dataset.key]) track('filter', { name: el.dataset.key });
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
  } else if (action === 'to-time' || action === 'step-back') {
    draft.step = action === 'to-time' ? 'time' : 'svc';
    draft.paying = false;
    renderBook();
    window.scrollTo(0, 0);
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
    if (draft.paying) track('open_pay', { placeId: draft.placeId });
    else draft.step = draft.time ? 'time' : 'svc';
    renderBook();
    window.scrollTo(0, 0);
    $(draft.paying ? '[data-action="pay"]' : '[data-action="confirm"]')?.focus();
  } else if (action === 'pay') {
    confirmBooking();
  } else if (action === 'share' || action === 'copy') {
    const url = inviteLink();
    const copy = () => navigator.clipboard.writeText(url)
      .then(() => toast('Посилання скопійовано'))
      .catch(() => { $('#ref-link')?.select(); toast('Скопіюйте посилання вручну'); });
    if (action === 'share' && navigator.share) {
      navigator.share({ title: 'CARCAR', text: `Записуйся на автомийку через CARCAR — ${uah(REFERRAL.bonus)} на перше замовлення`, url }).catch(() => {});
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
    track('buy_pass', { placeId: p.id, kind: plan.kind, amount: plan.price });
    toast(plan.kind === 'cert' ? `Сертифікат куплено, код ${sold.code} — його можна подарувати` : 'Абонемент куплено — спишеться під час запису');
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
    if (b && bookingActions[action](b) !== false) { ui.bookFocus = b.id; save(); route(); }
  } else if (action === 'ics') {
    downloadIcs(bookings.find((x) => x.id === id));
  } else if (action === 'repeat') {
    // Повтор в один дотик: ті самі послуги й авто, найближчий день із тим самим часом — одразу до оплати.
    const b = bookings.find((x) => x.id === id);
    const p = placeById(b.placeId);
    const services = new Set(bookable(p).filter((s) => b.services.includes(s.name)).map((s) => s.id));
    const minutes = bookable(p).filter((s) => services.has(s.id)).reduce((a, s) => a + s.min, 0);
    const [date, time] = repeatSlot(p, minutes, b.time);
    draft = { placeId: p.id, services, date, time, carId: b.carId && cars.some((c) => c.id === b.carId) ? b.carId : cars[0]?.id ?? null, paying: !!time,
      mode: b.mobile && mobileOn(p) ? 'mobile' : 'place', addr: b.mobile ? { text: b.mobile.address, lat: b.mobile.lat, lng: b.mobile.lng } : null };
    track('repeat', { placeId: p.id });
    if (time) setTimeout(() => toast(`Той самий запис: ${dayLabel(date, { weekday: 'short', day: 'numeric', month: 'long' })} о ${time} — лишилось оплатити`), 0);
  } else if (action === 'plate-check') {
    const f = $('#carform');
    const r = lookupPlate(f.elements.plate.value, isoDate(new Date()));
    const box = $('#plate-result');
    track('plate_check', { found: !!r.car });
    if (r.error) { box.innerHTML = `<p class="notice warn" style="margin:0">${r.error}.</p>`; return; }
    f.elements.plate.value = r.plate;
    if (r.car) {
      // Підставляємо знайдені дані — їх можна виправити перед збереженням.
      f.elements.make.value = r.car.make;
      f.elements.model.value = r.car.model;
      f.elements.year.value = r.car.year;
      f.elements.cls.value = r.car.cls;
      if (r.insurance?.until) f.elements.insuranceUntil.value = r.insurance.until;
      f.dataset.color = r.car.color;
    }
    const ins = !r.insurance ? '' : r.insurance.state === 'ok' ? `<li class="ok-text">${icon('checkCircle', 16)}Поліс ОСЦПВ діє до ${fmtDate(r.insurance.until)}</li>`
      : r.insurance.state === 'expired' ? `<li class="bad-text">${icon('warn', 16)}Поліс ОСЦПВ закінчився ${fmtDate(r.insurance.until)} — без нього їздити не можна</li>`
        : `<li class="bad-text">${icon('warn', 16)}Чинного поліса ОСЦПВ не знайдено</li>`;
    box.innerHTML = `<div class="notice plate-card">
      <b>${esc(r.plate)}${r.region ? ` · ${r.region}` : ''}</b>
      ${r.car ? `<ul><li>${esc(r.car.make)} ${esc(r.car.model)}, ${r.car.year} р., ${esc(r.car.color)}, ${esc(r.car.fuel)} ${esc(r.car.engine)}</li>${ins}</ul>
        <span class="small muted">Дані підставлено у форму — перевірте й збережіть.</span>`
        : `<span class="small">Авто з цим номером немає в демо-реєстрі. Заповніть дані вручну.</span>`}
      <span class="fine">Демо: перевірка знаходить лише вигадані номери ${Object.keys(DEMO_PLATES).join(', ')}. У робочій версії дані беремо з відкритого реєстру МВС і бази полісів МТСБУ.</span>
    </div>`;
  } else if (action === 'eta-late') {
    const b = bookings.find((x) => x.id === id);
    b.late = PAYMENT.lateMinutes;
    b.etaAt = Date.now();
    save();
    route();
    track('eta_late', { placeId: b.placeId });
    toast(`Мийка знає: запізнюєтесь на ${b.late} хв`);
  } else if (action === 'sub-open') {
    ui.subFor = ui.subFor === id ? null : id;
    route();
    $('.sub-form select')?.focus();
  } else if (action === 'sub-toggle' || action === 'sub-del') {
    const list = subs();
    const x = list.find((y) => y.id === id);
    if (action === 'sub-del' && !confirm('Видалити регулярний запис? Уже створені записи залишаться — їх можна скасувати окремо.')) return;
    x.status = action === 'sub-del' ? 'deleted' : x.status === 'paused' ? 'active' : 'paused';
    store.set('subscriptions', list);
    route();
    toast(action === 'sub-del' ? 'Регулярний запис видалено' : x.status === 'paused' ? 'Регулярний запис на паузі' : 'Регулярний запис відновлено');
  } else if (action === 'done-more') {
    ui.doneLimit = (ui.doneLimit ?? DONE_PAGE) + DONE_PAGE;
    const y = window.scrollY;
    route();
    window.scrollTo(0, y);
  } else if (action === 'book-tab') {
    ui.bookTab = el.dataset.tab;
    route();
    $(`[data-action="book-tab"][data-tab="${ui.bookTab}"]`)?.focus();
  } else if (action === 'move-day' || action === 'move-time') {
    if (action === 'move-day') { move.date = el.dataset.date; move.time = null; } else move.time = el.dataset.time;
    renderMove();
    $(action === 'move-day' ? `[data-action="move-day"][data-date="${move.date}"]` : '[data-action="move-confirm"]')?.focus();
  } else if (action === 'move-confirm') {
    confirmMove();
  } else if (action === 'logout') {
    if (!confirm('Вийти з акаунта? Щоб повернутися, знадобиться номер телефону й код із SMS.')) return;
    store.set('auth', null);
    login.session = null;
    Object.assign(login, { step: 'phone', phone: '', error: '' });
    location.hash = '#/';
    route();
  } else if (action === 'login-back') {
    Object.assign(login, { step: 'phone', error: '' });
    route();
  } else if (action === 'login-resend') {
    Object.assign(login, { code: String(Math.floor(1000 + Math.random() * 9000)), sentAt: Date.now(), error: '', typed: '' });
    route();
  } else if (action === 'chat-back') {
    if (history.length > 1) history.back(); else location.hash = '#/inbox';
  } else if (action === 'ask-quick') {
    const form = $('.ask-form');
    if (askContactOk(form)) askSend(form.dataset.place, el.dataset.text);
  } else if (action === 'photo-open') {
    openPhoto(el.querySelector('img').src);
  } else if (action === 'chat-quick') {
    sendChat(bookings.find((x) => x.id === id), el.dataset.text);
  } else if (action === 'mode') {
    draft.mode = el.dataset.mode;
    draft.paying = false;
    renderBook();
    $(`[data-action="mode"][data-mode="${draft.mode}"]`)?.focus();
  } else if (action === 'addr-here') {
    if (!navigator.geolocation) { toast('Не вдалося визначити місце — позначте його на карті'); return; }
    navigator.geolocation.getCurrentPosition((pos) => {
      draft.addr = { ...draft.addr, text: $('#addr')?.value || draft.addr?.text || 'Моє місцезнаходження', lat: pos.coords.latitude, lng: pos.coords.longitude };
      renderBook();
    }, () => toast('Не вдалося визначити місце — позначте його на карті'), { timeout: 8000 });
  } else if (action === 'promo-apply') {
    draft.promo = $('#promo-code').value.trim().toUpperCase() || '';
    renderBook();
    const q = quote(placeById(draft.placeId));
    if (q.promo) toast(`Промокод застосовано: −${uah(q.promo.amount)}`);
    $(q.promo ? '[data-action="pay"]' : '#promo-code')?.focus();
  } else if (action === 'promo-off') {
    draft.promo = '';
    renderBook();
    $('#promo-code')?.focus();
  } else if (action === 'delcar') {
    if (!confirm('Видалити авто разом із сервісною книжкою?')) return;
    cars = cars.filter((c) => c.id !== id);
    store.set('cars', cars);
    if (location.hash === '#/garage') route(); else location.hash = '#/garage';
  }
});

// Крапки каруселі обкладинок стежать за прокруткою.
document.addEventListener('scroll', (e) => {
  const el = e.target;
  if (!el.classList?.contains('pc-slides')) return;
  const i = Math.round(el.scrollLeft / el.clientWidth);
  el.parentElement.querySelectorAll('.pc-dots i').forEach((d, k) => d.classList.toggle('on', k === i));
}, true);

// Памʼятаємо, які завершені записи клієнт розгорнув.
document.addEventListener('toggle', (e) => {
  if (!e.target.matches?.('.done-item')) return;
  ui.doneOpen ??= new Set();
  ui.doneOpen[e.target.open ? 'add' : 'delete'](e.target.dataset.id);
}, true);

document.addEventListener('change', (e) => {
  const t = e.target;
  if (t.matches('.chat-attach')) { sendPhoto(t); return; }
  if (t.matches('[data-action="svc"]')) {
    // Основна мийка — лише одна: обираючи іншу, знімаємо попередню.
    if (t.checked && t.dataset.main) {
      const p = placeById(draft.placeId);
      for (const s of bookableIn(p)) if ((s.main || s.personal) && s.id !== t.value) draft.services.delete(s.id);
    }
    if (t.checked) draft.services.add(t.value); else draft.services.delete(t.value);
    draft.paying = false;
    renderBook();
  } else if (t.id === 'city-sel') {
    ui.city = t.value;
    store.set('city', ui.city);
    // Відстань без геолокації рахуємо від центру нового міста.
    if (ui.posFallback) ui.pos = cityOf().center;
    // Карта для іншого міста будується заново.
    for (const k of ['x', 'y', 'z', 'sel']) delete mapState[k];
    $('#map')?.remove();
    if (location.hash.replace(/^#\/?/, '') === '') renderList(); else location.hash = '#/';
  } else if (t.id === 'maincar') {
    if (t.value === '__add') { location.hash = '#/garage/add'; return; }
    pickCar(t.value);
    renderList();
  } else if (t.name === 'bookcar') {
    draft.carId = t.value;
    pickCar(t.value);
    renderBook();
  } else if (t.id === 'usesub') {
    draft.useSub = t.checked;
    if (t.checked) draft.cert = null;
    renderBook();
    $('#usesub')?.focus();
  } else if (t.name === 'method') {
    draft.method = t.value;
    renderBook();
    $(`input[name="method"][value="${t.value}"]`)?.focus();
  } else if (t.name === 'parts') {
    draft.parts = Number(t.value);
    renderBook();
    $(`input[name="parts"][value="${t.value}"]`)?.focus();
  } else if (t.name === 'item' && t.closest('.estimate')) {
    const form = t.closest('.estimate');
    const b = bookings.find((x) => x.id === form.dataset.id);
    const ids = new Set([...form.querySelectorAll('input[name="item"]:checked')].map((x) => x.value));
    const sum = estimateTotal(b.estimate.items.filter((x) => ids.has(x.id)));
    t.closest('.est-item').classList.toggle('off', !t.checked);
    form.querySelector('.est-pay').textContent = sum ? `Погодити обрані й доплатити ${uah(sum)}` : 'Нічого не обрано — відхилити все';
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
  // Номер друкується з пробілами, як на картці: 67 123 45 67.
  if (e.target.id === 'login-phone') {
    const d = phoneDigits(e.target.value);
    e.target.value = [d.slice(0, 2), d.slice(2, 5), d.slice(5, 7), d.slice(7, 9)].filter(Boolean).join(' ');
    return;
  }
  // Клітинки коду: після цифри — далі; вставка всього коду розкладається по клітинках; 4 цифри — підтверджуємо.
  if (e.target.matches('.code-cell')) {
    const cells = [...document.querySelectorAll('.code-cell')];
    const digits = e.target.value.replace(/\D/g, '');
    const i = cells.indexOf(e.target);
    if (digits.length > 1) [...digits].slice(0, 4 - i).forEach((d, k) => { cells[i + k].value = d; });
    else e.target.value = digits;
    login.typed = cells.map((c) => c.value).join('');
    const next = cells.find((c) => !c.value);
    if (next) { if (e.target.value) next.focus(); } else $('#code-form').requestSubmit();
    return;
  }
  if (e.target.id === 'q') {
    ui.q = e.target.value;
    renderList();
    // Пошук фіксуємо, коли людина перестала друкувати.
    clearTimeout(ui.qT);
    ui.qT = setTimeout(() => { if (ui.q.trim().length >= 3) track('search', { q: ui.q.trim().toLowerCase().slice(0, 40), found: filteredPlaces().length }); }, 1200);
  }
  if (e.target.id === 'pf-name') draft.pfName = e.target.value;
  if (e.target.id === 'pf-phone') draft.pfPhone = e.target.value;
  if (e.target.id === 'addr') { draft.addr = { ...draft.addr, text: e.target.value }; updateWhere(placeById(draft.placeId)); }
});

document.addEventListener('submit', async (e) => {
  if (e.target.id === 'biz-apply') {
    e.preventDefault();
    const f = new FormData(e.target);
    const a = { id: uid(), device: true, at: Date.now(), status: 'new', ...Object.fromEntries(['name', 'city', 'boxes', 'address', 'contact', 'phone', 'email', 'type', 'code'].map((k) => [k, String(f.get(k) ?? '').trim()])) };
    saveBizApps([...bizApps(), a]);
    location.hash = '#/business';
    toast('Заявку надіслано. Відповімо протягом 2 робочих днів');
    return;
  }
  if (e.target.id === 'phone-form' || e.target.id === 'code-form') {
    e.preventDefault();
    loginSubmit(e.target);
    return;
  }
  if (e.target.matches('.ready-form')) {
    e.preventDefault();
    finishJob(e.target);
    return;
  }
  if (e.target.id === 'ticket-form' || e.target.matches('.ticket-reply')) {
    e.preventDefault();
    const f = new FormData(e.target);
    const text = f.get('text').trim();
    if (!text) return;
    if (e.target.matches('.ticket-reply')) {
      ticketReply(e.target.dataset.id, 'client', text);
      route();
      toast('Повідомлення надіслано в підтримку');
      return;
    }
    const b = bookings.find((x) => x.id === f.get('booking'));
    let topic = f.get('topic');
    let disputed = false;
    if (f.get('dispute')) {
      if (!b || !(b.state === 'done' || isFrozen(b) || (b.state === 'paid' && bookingStart(b) <= new Date()))) { toast('Спір можна відкрити лише після візиту, поки гроші за записом заморожені'); return; }
      Object.assign(b, { state: 'dispute', disputeReason: text });
      topic = 'dispute';
      disputed = true;
    }
    const t = openTicket({ from: 'client', placeId: b?.placeId ?? null, bookingId: b?.id ?? null, topic, text, clientName: profile.name, clientPhone: profile.phone, clientKey: myKeys()[0] });
    if (b) { b.ticketId = t.id; save(); }
    track('ticket', { topic });
    location.hash = `#/support/t/${t.id}`;
    toast(disputed ? `Звернення №${t.no} створено, спір відкрито — гроші заморожено` : `Звернення №${t.no} створено — відповімо в «Повідомленнях»`);
    return;
  }
  if (e.target.matches('.chat-form')) {
    e.preventDefault();
    const text = new FormData(e.target).get('text').trim();
    if (text) sendChat(bookings.find((x) => x.id === e.target.dataset.id), text);
    return;
  }
  if (e.target.matches('.estimate')) {
    e.preventDefault();
    const b = bookings.find((x) => x.id === e.target.dataset.id);
    const ids = new Set(new FormData(e.target).getAll('item'));
    for (const x of b.estimate.items) x.status = ids.has(x.id) ? 'approved' : 'declined';
    const sum = estimateTotal(b.estimate.items, 'approved');
    if (sum && !confirm(`Доплатити ${uah(sum)} карткою за погоджені пункти?`)) { for (const x of b.estimate.items) x.status = 'pending'; return; }
    b.paid += sum;
    Object.assign(b.estimate, { state: 'answered', answeredAt: Date.now(), approved: sum });
    chatPost(b, 'sys', sum ? `Клієнт погодив кошторис: ${ids.size} з ${b.estimate.items.length} пунктів на ${uah(sum)}, доплату внесено` : 'Клієнт відхилив кошторис', 'biz');
    save();
    route();
    track('estimate', { placeId: b.placeId, approved: sum });
    toast(sum ? `Кошторис погоджено, доплачено ${uah(sum)}` : 'Кошторис відхилено');
    return;
  }
  if (e.target.matches('.sub-form')) {
    e.preventDefault();
    const f = new FormData(e.target);
    const b = bookings.find((x) => x.id === e.target.dataset.id);
    const p = placeById(b.placeId);
    const weekday = Number(f.get('weekday'));
    // Перша дата — найближчий обраний день тижня, починаючи із сьогодні.
    const d = new Date();
    while (weekdayOf(isoDate(d)) !== weekday) d.setDate(d.getDate() + 1);
    // Сьогоднішній час уже минув чи надто близько — починаємо з наступного тижня.
    if (isoDate(d) === isoDate(new Date()) && toMin(f.get('time')) <= new Date().getHours() * 60 + new Date().getMinutes() + 60) d.setDate(d.getDate() + 7);
    store.set('subscriptions', [...subs(), {
      id: uid(), placeId: p.id, services: bookable(p).filter((s) => b.services.includes(s.name)).map((s) => s.id), names: b.services,
      carId: b.carId, car: b.car, plate: b.plate, cls: b.cls ?? 0, every: Number(f.get('every')), weekday, time: f.get('time'),
      start: isoDate(d), made: [], status: 'active', createdAt: Date.now(),
    }]);
    ui.subFor = null;
    ui.bookTab = 'active';
    track('sub_new', { placeId: p.id });
    route();
    toast('Регулярний запис увімкнено — найближчий візит уже в «Моїх записах»');
    return;
  }
  if (e.target.matches('.review-form')) {
    e.preventDefault();
    const b = bookings.find((x) => x.id === e.target.dataset.id);
    const f = new FormData(e.target);
    const files = f.getAll('photos').filter((x) => x.size).slice(0, 3);
    reviews.push({
      id: uid(), placeId: b.placeId, bookingId: b.id, stars: Number(f.get('stars')),
      text: f.get('text').trim(), services: b.services.join(', '), date: isoDate(new Date()), at: Date.now(),
      clientKey: 'device', photos: [],
    });
    const r = reviews.at(-1);
    // Фото зменшуємо; якщо сховище переповнене — зберігаємо відгук без них.
    r.photos = (await Promise.all(files.map(shrinkPhoto))).filter(Boolean);
    if (!save() && r.photos.length) { r.photos = []; save(); toast('Фото не вмістилися в памʼять пристрою — відгук збережено без них'); }
    route();
    track('review', { placeId: b.placeId });
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
    track('waitlist_join', { placeId: p.id });
    toast('Готово! Повідомимо, щойно звільниться час');
    return;
  }
  if (e.target.matches('.ask-form')) {
    e.preventDefault();
    const f = new FormData(e.target);
    if (f.has('name')) {
      profile = { ...profile, name: f.get('name').trim(), phone: f.get('phone').trim() };
      store.set('profile', profile);
    }
    askSend(e.target.dataset.place, f.get('text').trim());
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
      toast('Мийку додано в історію');
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
    year: Number(f.get('year')) || null,
    color: e.target.dataset.color || null,
    plate: normPlate(f.get('plate')),
    cls: Number(f.get('cls')),
    mileage: 0,
    insuranceUntil: f.get('insuranceUntil') || null,
    log: [],
  };
  cars.push(car);
  store.set('cars', cars);
  // Нове авто стає основним: для нього ціни на головній і з нього починається запис.
  pickCar(car.id);
  if (location.hash.startsWith('#/garage/add')) location.hash = ui.addReturn ?? '#/garage'; else route();
  toast('Авто додано');
});

renderCity();
window.addEventListener('hashchange', route);
// Панель для бізнесу в іншій вкладці змінила записи, прайс чи години — перечитуємо й перемальовуємо.
window.addEventListener('storage', (e) => {
  if (!e.key?.startsWith('carcar.')) return;
  // Мийка відкрила чи закрила панель — оновлюємо лише «у мережі», без перемальовування.
  if (e.key === `carcar.${PRESENCE_KEY}`) { refreshPresence(); return; }
  bookings = store.get('bookings', []);
  payouts = store.get('payouts', []);
  reviews = store.get('reviews', []);
  requests = store.get('requests', []);
  profile = { name: '', phone: '', optIn: false, ...store.get('profile', {}) };
  wallet = { bonus: 0, money: 0, history: [], ...store.get('wallet', {}) };
  applyOverrides();
  if (!draft?.paying) route();
});
function refreshPresence() {
  for (const el of document.querySelectorAll('.chat-presence')) {
    const on = presenceOf(el.dataset.place).online;
    el.textContent = presenceText(el.dataset.place);
    el.classList.toggle('on', on);
    el.closest('.chat-head')?.querySelector('.avatar')?.classList.toggle('on', on);
  }
}
setInterval(refreshPresence, 30000);
acceptCampaign();
track('session', { view: ui.view });
route();
acceptInvite();

if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
