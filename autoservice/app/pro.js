// CarCar Business — окремий застосунок мийки для телефона.
// Головне під пальцем: повідомлення клієнтів, записи по днях, показники мийки й профіль, який бачать клієнти.
// Дані спільні із застосунком клієнта (на цьому пристрої — localStorage): запис, внесений тут, одразу
// займає час, а закритий день чи нові години клієнти бачать при наступному відкритті сторінки мийки.
import { CAR_CLASSES, PLACES, PAYMENT, DECLINE_RULES, CITIES } from './data.js';
import {
  store, icon, esc, uah, hhmm, toMin, isoDate, parseDate, uid, placeById, plural, duration, dayLabel, rating, fmtTime,
  bookingStart, hoursFor, scheduleOf, rangeText, WEEKDAYS, WEEKDAY_NAMES, phoneKey, applyOverrides, saveOverride, shrinkPhoto, inBreak,
  ACTIVE, BLOCKING, isCarcar, price, complete, isFrozen, balanceFor, settleAll, ratingFor, partnerOf, PARTNER_STATUS,
  confirmBy, offerBy, responseStats, pauseOf, ratePct, msText, accountPlaces, addAccountPlace,
  ticketsAll, openTicket, ticketReply, setTicket, TICKET_TOPICS, TICKET_STATUS, PLACE_TOPICS, ticketPhotos,
  payoutReady, maskIban, fitChatScreen, keepChatOnKeyboard, commissionFor, savePartner, staffOf, checkBizLogin, numberBookings, bookingNo, POWER, powerOf, setPower,
} from './core.js';
import {
  openStarts, chatPost, chatTimeline, readMessages, msgPreview, touchPresence, BIZ_QUICK, sendMessages, checkWaitlist,
  acceptBooking, declineBooking, expirePending, autoConfirmOf, setAutoConfirm, proposeTime, weeklyDealsOf, daysText, markNoShow, noShowFrom,
} from './ops.js';
import { ibanValid, normIban, formatIban, codeValid } from './partners.js';
import { initCalls, startCall, logCall, callHistory, callRowText, callMissed, markCallsRead } from './call.js';

// ---------- дані ----------

let bookings, payouts, reviews, requests;

function load() {
  bookings = store.get('bookings', []);
  payouts = store.get('payouts', []);
  reviews = store.get('reviews', []);
  requests = store.get('requests', []); // «не знайшов послугу» — повідомлення мийці зі сторінки точки
  applyOverrides();
  const settled = settleAll(bookings);
  if (expirePending(bookings) || settled) save();
}

function save() {
  numberBookings(bookings);
  store.set('bookings', bookings);
  store.set('payouts', payouts);
  store.set('reviews', reviews);
  store.set('requests', requests);
}

load();

// Вхід — той самий акаунт, що й у повній панелі: логін і пароль видає CARCAR після схвалення заявки.
const session = () => store.get('biz.session', null);
const ui = { place: session()?.placeId ?? store.get('partner', null), filter: 'all', lastView: '' };
if (!placeById(ui.place)) ui.place = PLACES[0].id;

const $ = (sel, root = document) => root.querySelector(sel);
const todayIso = () => isoDate(new Date());
const shiftDay = (iso, n) => { const d = parseDate(iso); d.setDate(d.getDate() + n); return isoDate(d); };
const minuteNow = () => { const d = new Date(); return d.getHours() * 60 + d.getMinutes(); };
const place = () => placeById(ui.place);
const own = () => bookings.filter((b) => b.placeId === ui.place);
const isPast = (b) => bookingStart(b).getTime() + b.minutes * 60000 <= Date.now();
const who = (b) => b.clientName || 'Клієнт CARCAR';
const telHref = (phone) => `tel:${String(phone).replace(/[^+\d]/g, '')}`;
const clock = (at) => new Date(at).toLocaleTimeString('uk-UA', { hour: '2-digit', minute: '2-digit' });
const whenShort = (at) => (isoDate(new Date(at)) === todayIso() ? clock(at) : new Date(at).toLocaleDateString('uk-UA', { day: 'numeric', month: 'short' }));
const safePhoto = (p) => (typeof p === 'string' && p.startsWith('data:image/') ? esc(p) : '');
const firstLetter = (name) => esc([...String(name).trim()][0]?.toUpperCase() ?? 'К');

function dayWord(iso, long = false) {
  const t = todayIso();
  if (iso === t) return 'Сьогодні';
  if (iso === shiftDay(t, 1)) return 'Завтра';
  if (iso === shiftDay(t, -1)) return 'Вчора';
  return dayLabel(iso, long ? { weekday: 'long', day: 'numeric', month: 'long' } : { weekday: 'short', day: 'numeric', month: 'short' });
}

function toast(text) {
  const el = $('#toast');
  el.textContent = text;
  el.classList.add('show');
  clearTimeout(toast.t);
  toast.t = setTimeout(() => el.classList.remove('show'), 2600);
}

// ---------- статуси ----------

const CHANNEL = { carcar: 'CARCAR', phone: 'Дзвінок', walkin: 'Приїхав сам', other: 'Інше' };
const channelOf = (b) => b.channel ?? 'carcar';
const STATE = {
  pending: ['Підтвердіть запис', 'warn'],
  offer: ['Чекає відповіді клієнта', 'carcar'],
  paid: ['Оплачено', 'carcar'], booked: ['Записано', 'cash'], done: ['Чекає клієнта', 'warn'], dispute: ['Спір', 'warn'],
  completed: ['Виконано', 'ok'], cancelled: ['Скасовано', 'muted'], noshow: ['Неявка', 'muted'], refunded: ['Повернено клієнту', 'muted'],
};
function stateOf(b) {
  const open = b.state === 'paid' || b.state === 'booked';
  if (open && isPast(b)) return ['Позначте результат', 'warn'];
  if (open && bookingStart(b) <= new Date()) return ['Зараз на мийці', 'carcar'];
  return STATE[b.state] ?? ['—', 'muted'];
}
// Сума запису для мийки: через CARCAR — повна ціна, з журналу — оплата на місці.
const sumOf = (b) => (isCarcar(b) ? price(b) : b.paid);
// ---------- мийники ----------

// Мийники точки (у сховищі персоналу з роллю «майстер»). Звільнені лишаються в історії записів.
const washers = () => staffOf(ui.place).filter((x) => x.role === 'master' && x.active !== false);
const washerName = (id) => staffOf(ui.place).find((x) => x.id === id)?.name ?? null;
function saveWashers(list) {
  const all = store.get('biz.staff', {});
  store.set('biz.staff', { ...all, [ui.place]: list });
}
// Інший запис цього мийника, що перетинається в часі.
const washerBusy = (id, b) => own().find((x) => x !== b && x.masterId === id && x.date === b.date && BLOCKING.includes(x.state)
  && toMin(b.time) < toMin(x.time) + x.minutes && toMin(b.time) + b.minutes > toMin(x.time));

// Клієнт натиснув «Їду» чи «Запізнююсь» у нагадуванні.
const etaText = (b) => (b.state !== 'paid' ? '' : [b.eta === 'onway' ? 'їде' : '', b.late ? `запізниться на ${b.late} хв` : ''].filter(Boolean).join(', '));

const REQ_STATE = { new: ['Новий запит', 'warn'], answered: ['Відповіли', 'carcar'], added: ['Послугу додано', 'ok'], closed: ['Закрито', 'muted'] };
const reqState = (r) => (r.closed ? 'closed' : r.service ? 'added' : r.messages.at(-1).from === 'client' ? 'new' : 'answered');
const ownRequests = () => requests.filter((r) => r.placeId === ui.place);

// Записи, які вже минули, але мийка не позначила, чим вони закінчились.
const unmarked = () => own().filter((b) => (b.state === 'paid' || b.state === 'booked') && isPast(b)).sort((a, b) => bookingStart(a) - bookingStart(b));
// Записи всіх мийок акаунта: нові заявки приходять і тоді, коли відкрита інша мийка.
const allMine = () => { const ids = accountPlaces(session()); return bookings.filter((b) => ids.includes(b.placeId)); };
const pendingList = () => allMine().filter((b) => b.state === 'pending').sort((a, b) => confirmBy(a) - confirmBy(b));
const unreadCount = () => own().filter((b) => b.chatUnreadBiz && b.state !== 'pending').length + pendingList().length + ownRequests().filter((r) => r.unreadBiz).length
  + callHistory().filter((x) => x.placeId === ui.place && callMissed(x, 'place')).length;
const washLabel = (b) => (b.placeId !== ui.place ? `<span class="pill">${esc(placeById(b.placeId)?.name ?? '')}</span>` : '');
// Візит почався: тільки тоді можна «Машина готова»; неявку — через lateMinutes після початку.
const started = (b) => bookingStart(b) <= new Date();

// Розклад «перевірено»: мийка раз на день підтверджує, що вільний час у CARCAR відповідає дійсності.
const checkedAt = () => store.get('biz.places', {})[ui.place]?.checkedAt ?? 0;
const checkedToday = () => !!checkedAt() && isoDate(new Date(checkedAt())) === todayIso();

// ---------- вільний час ----------

// Чи є вільний бокс на проміжок [t, t + minutes) цього дня.
function boxFree(date, t, minutes, skip = null) {
  const p = place();
  const h = hoursFor(p, date);
  if (!h || t < h[0] || t + minutes > h[1] || inBreak(p, t, minutes)) return false;
  const busy = own().filter((b) => b !== skip && b.date === date && BLOCKING.includes(b.state) && !b.mobile)
    .filter((b) => t < toMin(b.time) + b.minutes && t + minutes > toMin(b.time)).length;
  return busy < p.boxes;
}

// Вільні вікна дня, як їх бачать клієнти: суцільні проміжки по 30 хв, де є хоч один вільний бокс.
// Вільний час так, як його бачать клієнти в застосунку (з урахуванням перерви й часу на підготовку).
function freeWindows(date) {
  const out = [];
  for (const t of openStarts(place(), date, 30, bookings).map(toMin)) {
    const last = out.at(-1);
    if (last && last[1] === t) last[1] = t + 30;
    else out.push([t, t + 30]);
  }
  return out;
}
const windowsText = (list) => list.map(([s, e]) => `${hhmm(s)}–${hhmm(e)}`).join(', ');

// Мийка в каталозі? Поки ні — зміни зберігаються, але клієнти їх ще не бачать.
const listed = () => partnerOf(ui.place).status === 'approved';
const seen = (text) => (listed() ? text : 'Збережено. Клієнти побачать це, коли мийка зʼявиться в каталозі');

// Стан мийки в CARCAR: що бачать клієнти й що зробити далі.
function statusCard() {
  const pt = partnerOf(ui.place);
  const st = pt.status;
  if (st === 'approved') return '';
  const note = [...(pt.history ?? [])].reverse().find((h) => h.by === 'admin' && h.note)?.note;
  if (st === 'setup') {
    const p = place();
    const steps = [
      [p.services?.length > 0, 'Послуги й ціни', '#/profile'],
      [scheduleOf(p).week.some(Boolean), 'Графік роботи', '#/profile'],
      [!!(p.photos?.length || p.avatar), 'Фото мийки', '#/profile'],
    ];
    const ready = steps[0][0] && steps[1][0];
    return `<section class="pro-card setup-card" aria-labelledby="h-setup">
      <h2 id="h-setup">CARCAR схвалив мийку — залишився один крок</h2>
      <p class="small muted" style="margin:0">Перевірте, що клієнти побачать правильні ціни й години, і опублікуйте мийку. До публікації її немає в каталозі.</p>
      <ul class="plain-list">${steps.map(([ok, label, href]) => `<li><a href="${href}">${icon(ok ? 'check' : 'warn', 18)}${label}</a><b>${ok ? 'готово' : 'перевірте'}</b></li>`).join('')}</ul>
      <button class="btn primary block" type="button" data-action="publish" ${ready ? '' : 'disabled'}>Опублікувати мийку</button>
      ${ready ? '' : '<p class="fine">Додайте послуги з цінами й графік — тоді мийку можна опублікувати.</p>'}
    </section>`;
  }
  if (st === 'changes' || st === 'rejected') {
    return `<section class="notice warn" aria-label="Стан мийки"><span><b>${PARTNER_STATUS[st][0]}</b>${note ? `Коментар CARCAR: «${esc(note)}». ` : ''}Клієнти поки не бачать мийку. Виправте дані в профілі й надішліть ще раз.</span>
      <button class="btn" type="button" data-action="resubmit">Надіслати на перевірку знову</button></section>`;
  }
  if (st === 'suspended') return `<p class="notice warn">Мийку призупинено — клієнти її не бачать.${note ? ` Коментар CARCAR: «${esc(note)}».` : ''} Напишіть у підтримку, щоб відновити.</p>`;
  return `<p class="notice warn">Клієнти ще не бачать мийку: статус «${PARTNER_STATUS[st][0]}». CARCAR перевіряє дані, зазвичай до 2 робочих днів.</p>`;
}

// ---------- вхід ----------

const logo = (size) => `<svg class="pro-logo" width="${size}" height="${size}" viewBox="0 0 512 512" aria-hidden="true"><rect width="512" height="512" rx="112" fill="#1e3a5f"/><path d="M236 150a96 96 0 1 0 0 176" fill="none" stroke="#fff" stroke-width="44" stroke-linecap="round"/><path d="M380 150a96 96 0 1 0 0 176" fill="none" stroke="#e2553d" stroke-width="44" stroke-linecap="round"/><rect x="136" y="380" width="240" height="30" rx="15" fill="#fff" opacity=".85"/></svg>`;

function viewLogin(error = '') {
  return `<section class="pro-login" aria-label="Вхід">
    ${logo(72)}
    <h1>CarCar Business</h1>
    <p class="lead">Застосунок для мийки: повідомлення клієнтів, записи й гроші — з телефона.</p>
    <form class="stack" id="pro-login" style="gap:12px">
      <label class="field"><span>Логін</span><input name="login" required autocomplete="username" autocapitalize="none" spellcheck="false"></label>
      <label class="field"><span>Пароль</span><input name="password" type="password" required autocomplete="current-password"></label>
      ${error ? `<p class="notice warn" role="alert" style="margin:0">${esc(error)}</p>` : ''}
      <button class="btn primary" type="submit">Увійти</button>
    </form>
    <p class="small muted">Логін і пароль надсилає CARCAR після схвалення заявки. Ще не з нами? <a href="index.html#/business">Умови й реєстрація мийки</a></p>
    <button class="btn" type="button" data-action="demo-login">Подивитися демо (вигадані дані)</button>
  </section>`;
}

// ---------- нагадування: щоб розклад у клієнтів був правдивим ----------

// Скільки лишилось на відповідь: «4:52». Оновлюється щосекунди (див. tick).
const leftText = (due) => { const sec = Math.max(0, Math.ceil((due - Date.now()) / 1000)); return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`; };
const countdown = (b) => `<span class="countdown" data-due="${confirmBy(b)}">${leftText(confirmBy(b))}</span>`;

const canNotify = () => 'Notification' in window && Notification.permission === 'default';
const notifyAsk = () => (canNotify() ? `<button class="btn soft notify-ask" type="button" data-action="notify-on">${icon('bell', 18)}Сповіщення про нові записи на телефон</button>` : '');

// Сповіщення про новий запис: шторка поверх будь-якого екрана з деталями й кнопками,
// а коли застосунок згорнуто — системне сповіщення з кнопками «Прийняти» / «Відмовити».
function alertSheet(b) {
  const p = placeById(b.placeId);
  openSheet('Новий запис', `<div class="alert-card">
      <div class="alert-time"><b>${b.time}</b><span>${dayWord(b.date, true)}</span><small>до ${hhmm(toMin(b.time) + b.minutes)} · ${duration(b.minutes)}</small></div>
      <dl class="pro-kv">
        <dt>Клієнт</dt><dd><b>${esc(who(b))}</b> · дзвінок через CARCAR</dd>
        <dt>Авто</dt><dd>${esc(b.car || '—')}</dd>
        <dt>Послуги</dt><dd>${esc(b.services.join(', '))}</dd>
        <dt>Оплачено</dt><dd><b>${uah(sumOf(b))}</b> через CARCAR</dd>
        ${b.mobile ? `<dt>Виїзд</dt><dd>${esc(b.mobile.address)}</dd>` : ''}
        ${b.placeId !== ui.place ? `<dt>Мийка</dt><dd><b>${esc(p.name)}</b></dd>` : ''}
        ${b.mobile ? '' : `<dt>Бокси</dt><dd>${Math.max(0, p.boxes - bookings.filter((x) => x !== b && x.placeId === b.placeId && x.date === b.date && !x.mobile && BLOCKING.includes(x.state) && toMin(b.time) < toMin(x.time) + x.minutes && toMin(b.time) + b.minutes > toMin(x.time)).length)} з ${p.boxes} вільні в цей час</dd>`}
      </dl>
      <p class="pending-due big">${icon('clock', 18)}<span>Залишилось ${countdown(b)} — потім запис скасується сам, а гроші повернуться клієнту</span></p>
      <div class="grid2">
        <button class="btn primary" type="button" data-action="accept" data-id="${b.id}">${icon('check', 18)}Прийняти</button>
        <button class="btn line-danger" type="button" data-action="decline" data-id="${b.id}">Відмовити</button>
        <button class="btn full" type="button" data-action="propose" data-id="${b.id}">${icon('calendar', 18)}Запропонувати інший час</button>
      </div>
      <button class="btn text-btn" type="button" data-action="sheet-close">Пізніше</button>
    </div>`, b.id);
  $('.pro-sheet').classList.add('alert');
  // Вібрація дозволена лише після першого дотику до сторінки.
  if (navigator.userActivation?.hasBeenActive) navigator.vibrate?.([200, 100, 200]);
}

async function systemNotify(b) {
  if (!('Notification' in window) || Notification.permission !== 'granted') return;
  const title = `Новий запис: ${dayWord(b.date).toLowerCase()} о ${b.time}`;
  const body = `${who(b)} · ${b.services.join(', ')} · ${uah(sumOf(b))}. Відповісти до ${clock(confirmBy(b))}`;
  const opts = { body, tag: `pending-${b.id}`, requireInteraction: true, renotify: true, icon: 'pro-icon.svg', data: { id: b.id },
    actions: [{ action: 'accept', title: 'Прийняти' }, { action: 'decline', title: 'Відмовити' }] };
  try {
    const reg = await navigator.serviceWorker?.getRegistration();
    if (reg) await reg.showNotification(title, opts);
    else new Notification(title, { body, tag: opts.tag });
  } catch { /* сповіщення недоступні — лишається шторка в застосунку */ }
}

// Кожен новий запис сповіщаємо один раз: шторка, якщо нічого не відкрито, і системне сповіщення.
// Шторка — по одній: наступна зʼявиться, коли закриють поточну. Системне сповіщення — одразу для кожного.
const alerted = new Set();
const notified = new Set();
function alertPending() {
  if (!session()) return;
  const fresh = pendingList().filter((b) => !alerted.has(b.id));
  for (const b of fresh) if (!notified.has(b.id)) { notified.add(b.id); systemNotify(b); }
  if (!fresh.length || nb || $('#sheet-root').innerHTML) return;
  alerted.add(fresh[0].id);
  alertSheet(fresh[0]);
}

// Дія з системного сповіщення (або посилання #/act/...): прийняти, відмовити чи відкрити запис.
function notifyAction(action, id) {
  if (!session()) { ui.pendingAct = [action, id]; return; }
  const b = allMine().find((x) => x.id === id);
  if (!b || b.state !== 'pending') { toast(b ? 'На цей запис уже відповіли' : 'Запис не знайдено'); return; }
  alerted.add(id);
  if (b.placeId !== ui.place) { pickWash(b.placeId); rerender(); }
  if (action === 'accept') { if (washers().length) washerSheet(b.id, 'accept'); else if (acceptBooking(b)) { save(); rerender(); toast(`Запис прийнято: ${who(b)}, ${dayWord(b.date).toLowerCase()} о ${b.time}`); } }
  else if (action === 'decline') declineSheet(id);
  else alertSheet(b);
}

// Дія зі сповіщення, натиснута до входу, — виконуємо одразу після входу.
function runPendingAct() {
  const act = ui.pendingAct;
  ui.pendingAct = null;
  if (act) notifyAction(...act);
}

// Нові записи з застосунку: мийка вирішує, чи приймати їх на цей час.
function pendingBlock() {
  const list = pendingList();
  if (!list.length) return '';
  return `<section class="pending" aria-label="Нові записи">
    <h2>${list.length === 1 ? 'Новий запис — підтвердіть' : `Нові записи — підтвердіть (${list.length})`}</h2>
    ${list.map((b) => `<article class="pending-card" aria-label="Запис ${esc(who(b))}">
      <button class="pending-info" type="button" data-action="bk-open" data-id="${b.id}">
        <span class="bk-time"><b>${b.time}</b><small>${dayWord(b.date)}</small></span>
        <span class="bk-main"><b>${esc(who(b))} ${washLabel(b)}</b><small>${esc(b.services.join(', '))}</small><small>${esc(b.car || '')} · ${uah(sumOf(b))} оплачено</small></span>
      </button>
      <p class="pending-due">${icon('clock', 14)}<span>Відповісти до ${clock(confirmBy(b))} · залишилось ${countdown(b)}. Інакше запис скасується, гроші повернуться клієнту</span></p>
      <div class="grid2">
        <button class="btn navy" type="button" data-action="accept" data-id="${b.id}">${icon('check', 18)}Прийняти</button>
        <button class="btn" type="button" data-action="decline" data-id="${b.id}">Відмовити</button>
        <button class="btn soft full" type="button" data-action="propose" data-id="${b.id}">${icon('calendar', 16)}Запропонувати інший час</button>
      </div>
    </article>`).join('')}
    ${notifyAsk()}
  </section>`;
}

function reminders(marks = false) {
  const out = [];
  const pause = pauseOf(ui.place, bookings);
  if (pause) out.push(`<a class="remind warn" href="#/profile">${icon('warn', 22)}<span><b>Онлайн-запис на паузі до ${fmtTime(pause.until)}</b>
      <small>Забагато відмов і пропущених записів. Клієнти не можуть записатися через CARCAR.</small></span>${icon('chevR', 18)}</a>`);
  else if (responseStats(ui.place, bookings).lowered) out.push(`<a class="remind warn" href="#/profile">${icon('warn', 22)}<span><b>Мийка нижче в пошуку через відмови</b>
      <small>Пропонуйте інший час замість відмови — це не рахується.</small></span>${icon('chevR', 18)}</a>`);
  const st = partnerOf(ui.place).status;
  if (st !== 'approved') out.push(statusCard());
  // Записи без позначки — лише на вкладці «Записи» (там і лічильник), щоб не дублювати на «Повідомленнях».
  const late = marks ? unmarked() : [];
  if (late.length) {
    out.push(`<button class="remind warn" type="button" data-action="mark-open">${icon('warn', 22)}<span><b>${late.length} ${plural(late.length, 'запис чекає', 'записи чекають', 'записів чекають')} позначки</b>
      <small>Позначте, хто приїхав, а хто ні: так гроші надійдуть вчасно, а клієнти бачать правдивий розклад.</small></span>${icon('chevR', 18)}</button>`);
  }
  const h = hoursFor(place(), todayIso());
  if (h && !checkedToday()) {
    const free = freeWindows(todayIso());
    const hidden = pause || st !== 'approved';
    out.push(`<section class="remind sched" aria-label="Перевірка розкладу">${icon('calendar', 22)}<span><b>Розклад на сьогодні правильний?</b>
      <small>${hidden ? 'Зараз клієнти не можуть записатися онлайн.' : free.length ? `Клієнти бачать вільним: ${windowsText(free)}.` : 'Вільного часу на сьогодні вже немає.'} Якщо когось записали по телефону чи він приїхав сам, додайте запис, щоб цей час не продали двічі.</small>
      <span class="row"><a class="btn" href="#/bookings/${todayIso()}">${icon('calendar', 16)}Переглянути розклад</a><button class="btn navy" type="button" data-action="sched-ok">Так, усе вірно</button><button class="btn" type="button" data-action="nb-open">${icon('plus', 16)}Додати запис</button></span></span></section>`);
  }
  return out.length ? `<div class="reminders">${out.join('')}</div>` : '';
}

// ---------- повідомлення ----------

function threads() {
  const bk = own().filter((b) => b.chat?.length).map((b) => {
    const last = b.chat.at(-1);
    const [label, cls] = stateOf(b);
    return {
      id: `b-${b.id}`, kind: 'booking', name: who(b), at: last.at, unread: !!b.chatUnreadBiz, label, cls,
      text: `${last.from === 'biz' ? 'Ви: ' : ''}${msgPreview(last)}`,
      sub: `${b.no ? `${bookingNo(b)} · ` : ''}${dayWord(b.date)}, ${b.time} · ${b.services[0]}${b.services.length > 1 ? ` +${b.services.length - 1}` : ''}`,
      live: ACTIVE.includes(b.state),
    };
  });
  const rq = ownRequests().map((r) => {
    const last = r.messages.at(-1);
    const [label, cls] = REQ_STATE[reqState(r)];
    return {
      id: `r-${r.id}`, kind: 'request', name: r.clientName || 'Клієнт', at: last.at, unread: !!r.unreadBiz, label, cls,
      text: `${last.from === 'biz' ? 'Ви: ' : ''}${msgPreview(last)}`, sub: `Питання про послугу${r.car ? ` · ${r.car}` : ''}`,
      live: !r.closed && !r.service,
    };
  });
  // Дзвінки клієнтів через CARCAR: торкнутися — передзвонити.
  const cl = callHistory().filter((x) => x.placeId === ui.place).map((x) => ({
    id: x.id, kind: 'call', call: x, name: x.clientName || 'Клієнт CARCAR', at: x.at, unread: !!x.unreadBiz,
    label: x.state === 'ended' ? 'Дзвінок' : x.from === 'client' ? 'Пропущений' : 'Без відповіді', cls: x.state === 'ended' ? '' : x.from === 'client' ? 'warn' : '',
    text: callRowText(x, 'place'), sub: 'Натисніть, щоб передзвонити', live: !!x.unreadBiz,
  }));
  return [...bk, ...rq, ...cl].sort((a, b) => (b.unread - a.unread) || (b.live - a.live) || (b.at - a.at));
}

const MSG_FILTERS = [['all', 'Усі'], ['new', 'Нові'], ['booking', 'За записами'], ['request', 'Питання'], ['call', 'Дзвінки']];

// Дзвінок у списку повідомлень: кнопка «передзвонити» (за записом — тому самому клієнту запису).
const callRow = (t) => `<li><button class="convo call-row${t.unread ? ' unread missed' : ''}" type="button" data-action="call" data-place="${t.call.placeId}" data-name="${esc(t.name)}" ${t.call.bookingId && bookings.some((b) => b.id === t.call.bookingId) ? `data-id="${t.call.bookingId}"` : ''} aria-label="${esc(t.name)}: ${esc(t.text)}. Передзвонити">
    <span class="avatar" aria-hidden="true">${firstLetter(t.name)}</span>
    <span class="convo-body"><span class="convo-top"><b>${esc(t.name)}</b><time>${whenShort(t.at)}</time></span>
      <span class="convo-text call-text">${icon('phone', 15)}${esc(t.text)}</span>
      <span class="convo-meta"><span class="pill ${t.cls}">${t.label}</span><small>${esc(t.sub)}</small></span></span>
    ${t.unread ? '<span class="dot" aria-hidden="true"></span>' : ''}</button></li>`;

function viewMessages() {
  const all = threads();
  const pass = (t) => (ui.filter === 'all' ? true : ui.filter === 'new' ? t.unread : t.kind === ui.filter);
  const list = all.filter(pass);
  const count = (f) => all.filter((t) => (f === 'all' ? true : f === 'new' ? t.unread : t.kind === f)).length;
  return `<h1>Повідомлення</h1>
    ${pendingBlock()}
    ${reminders()}
    <div class="chips" role="group" aria-label="Які повідомлення показати">${MSG_FILTERS.map(([f, label]) => `<button class="chip" type="button" data-action="msg-filter" data-f="${f}" aria-pressed="${ui.filter === f}">${label}${count(f) ? ` · ${count(f)}` : ''}</button>`).join('')}</div>
    ${list.length ? `<ul class="convos pro-convos">${list.map((t) => (t.kind === 'call' ? callRow(t) : `<li><a class="convo${t.unread ? ' unread' : ''}${t.live ? '' : ' over'}" href="#/chat/${t.id}">
      <span class="avatar${t.kind === 'request' ? ' req' : ''}" aria-hidden="true">${firstLetter(t.name)}</span>
      <span class="convo-body"><span class="convo-top"><b>${esc(t.name)}</b><time>${whenShort(t.at)}</time></span>
        <span class="convo-text">${esc(t.text.length > 80 ? `${t.text.slice(0, 80).trimEnd()}…` : t.text)}</span>
        <span class="convo-meta"><span class="pill ${t.cls}">${t.label}</span><small>${esc(t.sub)}</small></span></span>
      ${t.unread ? '<span class="dot" aria-label="Нове повідомлення"></span>' : ''}</a></li>`)).join('')}</ul>`
      : `<div class="pro-empty">${icon('chat', 32)}<b>${all.length ? 'Тут порожньо' : 'Повідомлень ще немає'}</b>
        <span>Клієнти пишуть сюди про оплачені записи й питають про послуги зі сторінки мийки.</span></div>`}`;
}

function bubbleHtml(m) {
  if (m.from === 'mark') return `<li class="chat-mark ${m.kind}">${icon(m.kind === 'closed' ? 'x' : 'check', 14)}<b>${esc(m.text)}</b><time>${clock(m.at)}</time></li>`;
  if (m.from === 'sys') return `<li class="bubble sys">${esc(m.text)}</li>`;
  const me = m.from === 'biz';
  const photo = safePhoto(m.photo);
  return `<li class="bubble ${me ? 'me' : 'them'}${photo ? ' has-photo' : ''}"><span class="sr-only">${me ? 'Ви' : 'Клієнт'}: </span>${photo ? `<a class="chat-photo" href="${photo}" download="foto.jpg"><img src="${photo}" alt="Фото"></a>` : ''}${m.text ? `<span class="b-text">${esc(m.text)}</span>` : ''}<time>${clock(m.at)}${me ? `<span class="ticks" aria-hidden="true">${m.readAt ? '✓✓' : '✓'}</span>` : ''}</time></li>`;
}

function threadList(msgs) {
  const lastOwn = msgs.findLast((m) => m.from === 'biz');
  let lastDay = '';
  return msgs.map((m) => {
    const day = isoDate(new Date(m.at));
    const sep = day !== lastDay ? `<li class="day-sep"><span>${dayWord(day)}</span></li>` : '';
    lastDay = day;
    return `${sep}${bubbleHtml(m)}${m === lastOwn ? `<li class="read-state${m.readAt ? ' read' : ''}">${m.readAt ? `Прочитано ${clock(m.readAt)}` : 'Не прочитано'}</li>` : ''}`;
  }).join('');
}

const compose = (thread, quick) => `<div class="chat-compose">
    ${quick ? `<div class="quick" role="group" aria-label="Швидкі відповіді">${BIZ_QUICK.map((t) => `<button class="chip" type="button" data-action="quick" data-text="${esc(t)}">${esc(t)}</button>`).join('')}</div>` : ''}
    <form class="chat-form" id="pro-chat" data-thread="${thread}">
      <label class="attach-btn">${icon('camera', 22)}<input class="sr-only" id="pro-attach" type="file" accept="image/*" aria-label="Додати фото"></label>
      <input name="text" required maxlength="500" autocomplete="off" placeholder="Повідомлення…" aria-label="Повідомлення клієнту">
      <button class="send-btn" type="submit" aria-label="Надіслати">${icon('send', 20)}</button>
    </form>
  </div>`;

// Клієнти CARCAR — дзвінок лише через застосунок, номер прихований.
function chatHead(name, sub, call) {
  return `<header class="chat-head">
      <a class="icon-btn" href="#/" aria-label="До повідомлень">${icon('chevL', 24)}</a>
      <span class="avatar" aria-hidden="true">${firstLetter(name)}</span>
      <div class="chat-who"><h1>${esc(name)}</h1><small>${sub}</small></div>
      <button class="icon-btn" type="button" data-action="call" ${call} aria-label="Подзвонити клієнту через CARCAR">${icon('phone', 20)}</button>
    </header>`;
}

function viewThread(arg = '') {
  const id = arg.slice(2);
  if (arg.startsWith('b-')) {
    const b = own().find((x) => x.id === id);
    if (!b) return notFound();
    // «Прочитано» — лише коли екран справді перед очима (не у фоновій вкладці).
    const visible = document.visibilityState === 'visible';
    const seen = visible && readMessages(b.chat, 'client');
    if (visible && (b.chatUnreadBiz || seen)) { b.chatUnreadBiz = false; save(); }
    const [label] = stateOf(b);
    const open = ACTIVE.includes(b.state);
    return `<section class="chat-screen" aria-label="Чат з ${esc(who(b))}">
      ${chatHead(who(b), `${label} · ${dayWord(b.date)}, ${b.time}`, `data-id="${b.id}"`)}
      <button class="chat-pin" type="button" data-action="bk-open" data-id="${b.id}">${icon('calendar', 16)}<span>${b.no ? `${bookingNo(b)} · ` : ''}${esc(b.services.join(', '))} · ${uah(sumOf(b))}${b.car ? ` · ${esc(b.car)}` : ''}</span>${icon('chevR', 16)}</button>
      ${b.state === 'pending' ? `<div class="chat-actions"><button class="btn navy" type="button" data-action="accept" data-id="${b.id}">${icon('check', 18)}Прийняти запис</button><button class="btn" type="button" data-action="decline" data-id="${b.id}">Відмовити</button></div>` : ''}
      ${b.state === 'paid' && started(b) ? `<div class="chat-actions"><button class="btn navy" type="button" data-action="ready" data-id="${b.id}">${icon('check', 18)}Машина готова</button></div>` : ''}
      <ol class="chat-msgs" aria-label="Повідомлення">${threadList(chatTimeline(b))}</ol>
      ${open ? compose(arg, true) : '<p class="chat-closed">Запис закрито — листування лише для читання.</p>'}
    </section>`;
  }
  const r = ownRequests().find((x) => x.id === id);
  if (!r) return notFound();
  const visible = document.visibilityState === 'visible';
  const seen = visible && readMessages(r.messages, 'client');
  if (visible && (r.unreadBiz || seen)) { r.unreadBiz = false; save(); }
  const [label] = REQ_STATE[reqState(r)];
  const open = !r.closed;
  return `<section class="chat-screen" aria-label="Чат з ${esc(r.clientName || 'клієнтом')}">
    ${chatHead(r.clientName || 'Клієнт', `${label}${r.car ? ` · ${esc(r.car)}` : ''}`, `data-req="${r.id}"`)}
    ${open ? `<div class="chat-actions">
      <button class="btn navy" type="button" data-action="nb-open" data-req="${r.id}">${icon('calendar', 16)}Записати</button>
      ${r.service ? '' : `<button class="btn" type="button" data-action="svc-new" data-req="${r.id}">${icon('plus', 16)}Додати послугу</button>`}
      <button class="btn" type="button" data-action="req-close" data-id="${r.id}">Закрити</button></div>` : ''}
    <ol class="chat-msgs" aria-label="Повідомлення">${threadList(r.messages)}</ol>
    ${open ? compose(arg, false) : '<p class="chat-closed">Питання закрито.</p>'}
  </section>`;
}

function sendTo(thread, text, photo = null) {
  const id = thread.slice(2);
  if (thread.startsWith('b-')) {
    const b = own().find((x) => x.id === id);
    chatPost(b, 'biz', text, 'client', photo);
    sendMessages([{ placeId: b.placeId, clientKey: 'device', channel: 'app', kind: 'chat', bookingId: b.id, text: `${place().name}: ${text || 'Фото'}`, link: `#/chat/${b.id}` }]);
  } else {
    const r = ownRequests().find((x) => x.id === id);
    r.messages.push({ from: 'biz', text, at: Date.now(), ...(photo ? { photo } : {}) });
    r.unreadClient = true;
  }
  save();
  route();
  $('#pro-chat input[name="text"]')?.focus();
}

// ---------- записи по днях ----------

const DAYS_AHEAD = 14;

function bookingRow(b) {
  const [label, cls] = stateOf(b);
  const off = ['cancelled', 'noshow', 'refunded'].includes(b.state);
  return `<li><button class="bk-row${off ? ' off' : ''}" type="button" data-action="bk-open" data-id="${b.id}">
    <span class="bk-time"><b>${b.time}</b><small>${hhmm(toMin(b.time) + b.minutes)}</small></span>
    <span class="bk-main"><b>${esc(who(b))}${b.chatUnreadBiz ? ' <span class="dot" aria-label="нове повідомлення"></span>' : ''}</b>
      <small>${esc(b.services.join(', '))}</small>${b.car ? `<small>${esc(b.car)}</small>` : ''}${b.masterId && washerName(b.masterId) ? `<small class="bk-washer">${icon('users', 13)}${esc(washerName(b.masterId))}</small>` : ''}</span>
    <span class="bk-side"><span class="pill ${cls}">${label}</span><small>${CHANNEL[channelOf(b)]} · ${uah(sumOf(b))}</small></span>
  </button></li>`;
}

function viewBookings(day) {
  const t = todayIso();
  if (!/^\d{4}-\d\d-\d\d$/.test(day ?? '') || day < t) day = t;
  const p = place();
  const days = Array.from({ length: DAYS_AHEAD }, (_, i) => shiftDay(t, i));
  const live = (d) => own().filter((b) => b.date === d && BLOCKING.includes(b.state)).length;
  const list = own().filter((b) => b.date === day).sort((a, b) => a.time.localeCompare(b.time));
  const h = hoursFor(p, day);
  // Розбивка по годинах: у кожній годині — записи, що в ній починаються, і скільки боксів вільно.
  const hourly = hourRows(day, list, h);
  const busy = list.filter((b) => BLOCKING.includes(b.state)).length;
  const special = day in scheduleOf(p).special;
  return `<h1>Записи</h1>
    ${pendingBlock()}
    ${reminders(true)}
    <nav class="day-strip" aria-label="Дні">${days.map((d) => {
      const n = live(d);
      const closed = !hoursFor(p, d);
      return `<a href="#/bookings/${d}" class="${closed ? 'closed' : ''}" ${d === day ? 'aria-current="date"' : ''}><small>${d === t ? 'Сьогодні' : WEEKDAYS[(parseDate(d).getDay() + 6) % 7]}</small><b>${parseDate(d).getDate()}</b><span class="n">${closed ? 'вихідний' : n ? `${n} ${plural(n, 'запис', 'записи', 'записів')}` : 'вільно'}</span></a>`;
    }).join('')}</nav>
    <div class="day-head"><div><h2>${dayWord(day, true)}</h2>
      <p class="small muted">${h ? `${rangeText(h)}${special ? ' (змінено на цей день)' : ''} · ${p.boxes} ${plural(p.boxes, 'бокс', 'бокси', 'боксів')} · ${busy} ${plural(busy, 'запис', 'записи', 'записів')}` : `Вихідний${special ? ' (закрито на цей день)' : ' за графіком'}`}</p></div>
      <div class="row">${h ? `<button class="btn soft" type="button" data-action="day-hours" data-date="${day}">Години</button><button class="btn soft" type="button" data-action="day-close" data-date="${day}">Закрити день</button>`
        : `<button class="btn navy" type="button" data-action="day-hours" data-date="${day}">Відкрити день</button>`}</div></div>
    ${hourly || `<div class="pro-empty">${icon('calendar', 32)}<b>Мийка не працює</b>
      <span>Клієнти не можуть записатися на цей день. Відкрийте день, якщо працюєте.</span></div>`}`;
}

// Вільні бокси на 30 хв від t (без урахування минулого часу).
function freeBoxes(date, t) {
  const p = place();
  const h = hoursFor(p, date);
  if (!h || t < h[0] || t + 30 > h[1] || inBreak(p, t, 30)) return 0;
  const busy = own().filter((b) => b.date === date && BLOCKING.includes(b.state) && !b.mobile)
    .filter((b) => t < toMin(b.time) + b.minutes && t + 30 > toMin(b.time)).length;
  return Math.max(0, p.boxes - busy);
}

function hourRows(day, list, h) {
  const p = place();
  const starts = list.map((b) => toMin(b.time));
  if (!h && !starts.length) return '';
  const from = Math.floor(Math.min(h?.[0] ?? 24 * 60, ...starts) / 60);
  const to = Math.ceil(Math.max(h?.[1] ?? 0, ...list.map((b) => toMin(b.time) + b.minutes)) / 60);
  const now = day === todayIso() ? minuteNow() : day < todayIso() ? 24 * 60 : -1;
  const rows = [];
  for (let hr = from; hr < to; hr++) {
    const m = hr * 60;
    const inHour = list.filter((b) => toMin(b.time) >= m && toMin(b.time) < m + 60);
    const past = m + 60 <= now;
    // Вільний час години: перший пів години, що ще не минули й мають вільний бокс.
    const slot = [m, m + 30].find((t) => t >= now && freeBoxes(day, t) > 0);
    const n = slot === undefined ? 0 : freeBoxes(day, slot);
    const open = h && m >= h[0] && m < h[1];
    const side = !open ? '<span class="hour-state">не працюємо</span>'
      : past ? '' : inBreak(p, m, 30) && inBreak(p, m + 30, 30) ? '<span class="hour-state">перерва</span>'
        : slot !== undefined ? `<button class="hour-free" type="button" data-action="nb-open" data-date="${day}" data-time="${hhmm(slot)}" aria-label="Записати на ${hhmm(slot)}, вільно ${n} з ${p.boxes}">${icon('plus', 16)}<span>${hhmm(slot)} · вільно ${n} з ${p.boxes}</span></button>`
          : '<span class="hour-state full">усі бокси зайняті</span>';
    rows.push(`<li class="hour${past ? ' past' : ''}${hr === Math.floor(now / 60) && day === todayIso() ? ' now' : ''}">
      <span class="hour-label">${String(hr).padStart(2, '0')}:00</span>
      <div class="hour-body">${slot !== undefined && inHour.length && slot < toMin(inHour[0].time) ? side : ''}${inHour.length ? `<ul class="day-list">${inHour.map(bookingRow).join('')}</ul>` : ''}${slot !== undefined && inHour.length && slot < toMin(inHour[0].time) ? '' : side}</div>
    </li>`);
  }
  return `<ol class="hours" aria-label="Записи по годинах">${rows.join('')}</ol>`;
}

// ---------- шторка ----------

// Шторка, відкрита для конкретного запису: якщо запис тим часом змінився (скасувався сам, клієнт скасував),
// шторку закриваємо, щоб не діяти над застарілим станом.
const sheetFor = { id: null, state: null };
function openSheet(title, body, forId = null) {
  sheetFor.id = forId;
  sheetFor.state = forId ? bookings.find((x) => x.id === forId)?.state ?? null : null;
  $('#sheet-root').innerHTML = `<div class="sheet-dim" data-action="sheet-close"></div>
    <section class="pro-sheet" role="dialog" aria-modal="true" aria-labelledby="sheet-h">
      <div class="sheet-head"><h2 id="sheet-h">${title}</h2><button class="icon-btn" type="button" data-action="sheet-close" aria-label="Закрити">${icon('x', 22)}</button></div>
      <div class="sheet-body">${body}</div>
    </section>`;
  document.body.classList.add('sheet-open');
  $('.pro-sheet .icon-btn').focus();
}

function closeSheet() {
  $('#sheet-root').innerHTML = '';
  document.body.classList.remove('sheet-open');
  nb = null;
  sheetFor.id = null;
  // Наступна нова заявка, що чекала, поки закриють шторку.
  setTimeout(alertPending, 0);
}

function checkSheet() {
  if (!sheetFor.id || !$('#sheet-root').innerHTML) return false;
  const b = bookings.find((x) => x.id === sheetFor.id);
  if (b && b.state === sheetFor.state) return false;
  closeSheet();
  toast(!b ? 'Запис видалено' : b.state === 'cancelled' ? 'Запис уже скасовано — гроші повернуто клієнту' : 'Запис змінився — перегляньте ще раз');
  return true;
}

// ---------- картка запису ----------

function bookingSheet(id) {
  const b = own().find((x) => x.id === id);
  if (!b) return;
  const [label, cls] = stateOf(b);
  let actions = '';
  if (b.state === 'pending') {
    actions = `<p class="notice warn">Клієнт оплатив запис. Підтвердіть до ${clock(confirmBy(b))} (залишилось ${countdown(b)}), інакше запис скасується, а гроші повернуться клієнту.</p>
      <div class="grid2">
        <button class="btn primary" type="button" data-action="accept" data-id="${b.id}">${icon('check', 18)}Прийняти</button>
        <button class="btn line-danger" type="button" data-action="decline" data-id="${b.id}">Відмовити</button>
        <button class="btn full" type="button" data-action="propose" data-id="${b.id}">${icon('calendar', 18)}Запропонувати інший час</button>
      </div>`;
  } else if (b.state === 'offer') {
    actions = `<p class="notice">Ви запропонували цей час замість ${dayWord(b.offer.from.date).toLowerCase()}, ${b.offer.from.time}. Клієнт відповість до ${clock(offerBy(b))}; не відповість — запис скасується, гроші повернуться йому.</p>`;
  } else if (b.state === 'booked') {
    actions = `<form class="stack" id="done-form" data-id="${b.id}" style="gap:10px">
        <div class="seg-row" role="radiogroup" aria-label="Оплата на місці">
          <label><input type="radio" name="payment" value="card" checked><span>Картка</span></label>
          <label><input type="radio" name="payment" value="cash"><span>Готівка</span></label></div>
        <label class="field"><span>Сума, ₴</span><input name="paid" type="number" min="0" inputmode="numeric" value="${b.paid}"></label>
        <button class="btn primary" type="submit">${icon('check', 18)}Виконано й оплачено</button>
      </form>
      <div class="grid2">
        <button class="btn" type="button" data-action="move" data-id="${b.id}">Перенести</button>
        ${started(b) ? `<button class="btn" type="button" data-action="crm-noshow" data-id="${b.id}">Не приїхав</button>` : ''}
        <button class="btn text-danger full" type="button" data-action="crm-cancel" data-id="${b.id}">Скасувати запис</button>
      </div>`;
  } else if (b.state === 'paid') {
    const late = Date.now() >= noShowFrom(b);
    actions = !started(b) ? `<p class="notice">«Машина готова» можна позначити, коли почнеться візит — ${dayWord(b.date).toLowerCase()} о ${b.time}.</p>
      <button class="btn" type="button" data-action="move" data-id="${b.id}">${icon('calendar', 18)}Перенести за домовленістю з клієнтом</button>` : `<form class="stack ready-form" id="ready-form" data-id="${b.id}" style="gap:10px">
        <label class="dropzone small-drop">${icon('camera', 20)}Фото результату (до 3, необовʼязково)<span class="photo-count" aria-live="polite"></span>
          <input class="sr-only" name="photos" type="file" accept="image/*" multiple></label>
        <div class="grid2">
          <label class="field"><span>Коментар для клієнта</span><input name="note" maxlength="200" autocomplete="off"></label>
          <label class="field"><span>Пробіг, км</span><input name="km" type="number" min="0" inputmode="numeric" autocomplete="off"></label>
        </div>
        <button class="btn primary" type="submit">${icon('check', 18)}Машина готова</button>
        <p class="fine">Так ви підтверджуєте виконання. Клієнт отримає сповіщення, а фото й пробіг потраплять у сервісну книжку авто. Гроші ${PAYMENT.freezeHours} год чекають на випадок спору.</p>
      </form>
      ${late ? `<button class="btn" type="button" data-action="late-forfeit" data-id="${b.id}">Запізнення понад ${PAYMENT.lateMinutes} хв — оплата нам</button>
        <button class="btn text-danger" type="button" data-action="carcar-noshow" data-id="${b.id}">Клієнт не приїхав</button>
        <p class="fine">Оплата неявки ${PAYMENT.freezeHours} год заморожена: клієнт може оскаржити.</p>` : started(b) ? `<p class="fine">Якщо клієнт не приїде, позначити неявку можна через ${PAYMENT.lateMinutes} хв після початку.</p>` : ''}`;
  } else if (b.state === 'dispute') {
    const t = ticketsAll().find((x) => x.bookingId === b.id && x.from === 'place' && x.topic === 'dispute');
    actions = `<p class="notice warn"><b>Клієнт відкрив спір</b>«${esc(b.disputeReason ?? '')}». Гроші заморожені, доки модератор CARCAR не вирішить.</p>
      ${t ? `<a class="btn" href="#/support/${t.id}" data-action="sheet-close">Ваше пояснення: звернення №${t.no}</a>` : `<form class="stack" id="dispute-note" data-id="${b.id}" style="gap:8px">
        <label class="field"><span>Пояснення для модератора</span><textarea name="text" rows="3" required maxlength="1000" placeholder="Що було зроблено, фото, домовленості з клієнтом"></textarea></label>
        <button class="btn" type="submit">Надіслати модератору</button></form>`}`;
  } else if (b.state === 'completed' && isCarcar(b)) {
    actions = `<p class="notice">${isFrozen(b) ? `Гроші стануть доступні ${fmtTime(b.unfreezeAt)}.` : 'Гроші доступні до виведення в розділі «Мийка».'}</p>`;
  }
  openSheet(`${b.time} · ${esc(who(b))}`, `
    <div class="row"><span class="pill ${cls}">${label}</span><span class="pill">${CHANNEL[channelOf(b)]}</span>${b.no ? `<span class="small muted">${bookingNo(b)}</span>` : ''}</div>
    <dl class="pro-kv">
      <dt>Коли</dt><dd>${dayWord(b.date, true)}, ${b.time}–${hhmm(toMin(b.time) + b.minutes)}</dd>
      <dt>Послуги</dt><dd>${esc(b.services.join(', '))}</dd>
      <dt>Тривалість</dt><dd class="washer-dd"><span>${duration(b.minutes)}</span>${DUR_EDIT.includes(b.state) ? `<button class="btn soft" type="button" data-action="dur" data-id="${b.id}">Уточнити</button>` : ''}</dd>
      <dt>Авто</dt><dd>${esc(b.car || '—')}</dd>
      ${ACTIVE.includes(b.state) || b.state === 'booked' || b.masterId ? `<dt>Мийник</dt><dd class="washer-dd">${b.masterId && washerName(b.masterId) ? `<b>${esc(washerName(b.masterId))}</b>` : '<span class="muted">не призначено</span>'}
        ${(ACTIVE.includes(b.state) || b.state === 'booked') && b.state !== 'pending' ? `<button class="btn soft" type="button" data-action="washer" data-id="${b.id}">${b.masterId ? 'Змінити' : 'Обрати'}</button>` : ''}</dd>` : ''}
      <dt>Сума</dt><dd>${uah(sumOf(b))}${isCarcar(b) ? ' · оплачено в CARCAR' : b.payment ? ` · ${b.payment === 'cash' ? 'готівка' : 'картка'}` : ' · оплата на місці'}</dd>
      ${b.note && !isCarcar(b) ? `<dt>Коментар</dt><dd>${esc(b.note)}</dd>` : ''}
      ${b.mobile ? `<dt>Виїзд</dt><dd>${esc(b.mobile.address)} · ${String(b.mobile.km).replace('.', ',')} км · виїзд ${uah(b.mobile.fee)}
        <a href="https://www.openstreetmap.org/?mlat=${b.mobile.lat.toFixed(5)}&amp;mlon=${b.mobile.lng.toFixed(5)}#map=17/${b.mobile.lat.toFixed(5)}/${b.mobile.lng.toFixed(5)}" target="_blank" rel="noopener">Точка на карті</a></dd>` : ''}
      ${b.moves?.length ? `<dt>Перенесено</dt><dd>${b.moves.map((m) => `з ${dayLabel(m.date, { day: 'numeric', month: 'short' })}, ${m.time}`).join('; ')}</dd>` : ''}
      ${b.promo && !b.promo.returned ? `<dt>Промокод</dt><dd>${esc(b.promo.code)}: −${uah(b.promo.amount)} для клієнта, доплачує CARCAR — ви отримаєте повну суму</dd>` : ''}
      ${b.installments ? `<dt>Оплата</dt><dd>Частинами · ${b.installments.n} платежі. Ви отримуєте всю суму одразу</dd>` : ''}
    </dl>
    ${etaText(b) ? `<p class="notice ok" style="margin:0">${icon('bell', 18)}<span>Клієнт повідомив: ${etaText(b)} (${fmtTime(b.etaAt)}).</span></p>` : ''}
    <div class="grid2">
      ${isCarcar(b) ? `<button class="btn" type="button" data-action="call" data-id="${b.id}">${icon('phone', 18)}Подзвонити через CARCAR</button>`
        : b.clientPhone ? `<a class="btn" href="${telHref(b.clientPhone)}">${icon('phone', 18)}Подзвонити</a>` : ''}
      ${isCarcar(b) ? `<a class="btn" href="#/chat/b-${b.id}" data-action="sheet-close">${icon('chat', 18)}Написати</a>` : ''}
    </div>
    ${actions}`, b.id);
}

const DECLINE_REASONS = ['Усі бокси зайняті на цей час', 'Не робимо цю послугу', 'Мийка не працюватиме в цей час', 'Немає майстра'];

function declineSheet(id) {
  const b = own().find((x) => x.id === id);
  openSheet(`Відмовити: ${esc(who(b))}`, `<form class="stack" id="decline-form" data-id="${b.id}" style="gap:12px">
    <p class="small muted" style="margin:0">${dayWord(b.date, true)}, ${b.time} · ${esc(b.services.join(', '))}. Клієнт отримає повідомлення, а гроші — назад.</p>
    <button class="btn soft" type="button" data-action="propose" data-id="${b.id}">${icon('calendar', 18)}Краще запропонувати інший час — це не відмова</button>
    <fieldset class="reason-set"><legend>Причина</legend>
      ${DECLINE_REASONS.map((r, i) => `<label class="check-row"><input class="check radio" type="radio" name="reason" value="${esc(r)}" ${i ? '' : 'checked'}><span>${r}</span></label>`).join('')}
    </fieldset>
    <label class="field"><span>Повідомлення клієнту (необовʼязково)</span><input name="note" maxlength="300" autocomplete="off" placeholder="Наприклад, можемо о 14:00 — запишіться ще раз"></label>
    <button class="btn primary" type="submit">Відмовити й повернути гроші</button>
  </form>`, b.id);
}

// Інший час замість відмови: день і вільний час, необовʼязковий коментар. Відмовою не рахується.
function proposeSheet(id, date) {
  const b = own().find((x) => x.id === id);
  const d = date ?? b.date;
  const t = todayIso();
  const note = $('#propose-note')?.value ?? '';
  const starts = proposeStarts(b, d);
  openSheet(`Інший час: ${esc(who(b))}`, `
    <p class="small muted" style="margin:0">Клієнт просив ${dayWord(b.date).toLowerCase()}, ${b.time} · ${esc(b.services.join(', '))}. Оберіть час, який можете прийняти, — клієнт погодиться одним дотиком.</p>
    <div class="chips day-chips" role="group" aria-label="День">${Array.from({ length: 7 }, (_, i) => shiftDay(t, i)).map((x) => `<button class="chip" type="button" data-action="propose-day" data-id="${b.id}" data-date="${x}" aria-pressed="${x === d}" ${hoursFor(place(), x) ? '' : 'disabled'}>${dayWord(x)}</button>`).join('')}</div>
    <label class="field"><span>Коментар клієнту (необовʼязково)</span><input id="propose-note" maxlength="200" autocomplete="off" placeholder="Наприклад, о 14:30 точно буде вільний бокс" value="${esc(note)}"></label>
    ${starts.length ? `<div class="slots" role="group" aria-label="Запропонувати час">${starts.map((x) => `<button class="slot" type="button" data-action="propose-to" data-id="${b.id}" data-date="${d}" data-time="${x}">${x}</button>`).join('')}</div>`
      : '<p class="muted">На цей день вільних боксів немає — оберіть інший.</p>'}
    <p class="fine">Час одразу закріплюється за клієнтом. На відповідь у нього ${PAYMENT.offerMinutes} хв; не погодиться — гроші повернуться йому, а вам це не рахується як відмова.</p>`, b.id);
}

// Час, який можна запропонувати клієнту: вільний бокс (для виїзду — з урахуванням дороги), не той самий час.
const proposeStarts = (b, d) => openStarts(place(), d, b.minutes, bookings, { skip: b, mobile: !!b.mobile }).filter((x) => !(d === b.date && x === b.time));

// Хто митиме машину: під час прийняття запису з застосунку або пізніше в картці запису.
function washerSheet(id, mode) {
  const b = own().find((x) => x.id === id);
  const list = washers();
  openSheet(mode === 'accept' ? 'Хто митиме?' : 'Мийник', `
    <p class="small muted" style="margin:0">${dayWord(b.date, true)}, ${b.time}–${hhmm(toMin(b.time) + b.minutes)} · ${esc(b.services.join(', '))} · ${esc(b.car || '')}</p>
    <div class="washer-list" role="group" aria-label="Мийники">
      ${list.map((w) => {
        const busy = washerBusy(w.id, b);
        return `<button class="washer-opt" type="button" data-action="washer-pick" data-mode="${mode}" data-id="${b.id}" data-m="${w.id}" aria-pressed="${b.masterId === w.id}">
          <span class="avatar" aria-hidden="true">${firstLetter(w.name)}</span><span><b>${esc(w.name)}</b>
          <small class="${busy ? 'busy' : 'free'}">${busy ? `зайнятий: ${busy.time}–${hhmm(toMin(busy.time) + busy.minutes)}, ${esc(who(busy))}` : 'вільний у цей час'}</small></span></button>`;
      }).join('')}
      <button class="washer-opt" type="button" data-action="washer-pick" data-mode="${mode}" data-id="${b.id}" data-m=""><span class="avatar none" aria-hidden="true">?</span><span><b>Без мийника</b><small>${mode === 'accept' ? 'оберете пізніше в картці запису' : 'зняти з запису'}</small></span></button>
    </div>
    ${mode === 'accept' ? '<p class="fine">Клієнт отримає підтвердження запису й імʼя мийника.</p>' : ''}`, b.id);
}

// Уточнити тривалість запису: машина більша чи брудніша, ніж у прайсі, — займаємо бокс на потрібний час.
function durSheet(id) {
  const b = own().find((x) => x.id === id);
  openSheet(`Тривалість: ${esc(who(b))}`, `<form class="stack" id="dur-form" data-id="${b.id}" style="gap:12px">
    <p class="small muted" style="margin:0">${dayWord(b.date, true)}, з ${b.time} · ${esc(b.services.join(', '))}</p>
    <label class="field"><span>Скільки триватиме</span><select name="minutes">${durOptions(b.minutes)}</select></label>
    <button class="btn primary" type="submit">Зберегти</button>
    <p class="fine">Бокс буде зайнятий на цей час — клієнти не зможуть записатися на нього.${isCarcar(b) ? ' Клієнт побачить новий час завершення в чаті запису.' : ''}</p>
  </form>`, b.id);
}

function moveSheet(id, date) {
  const b = own().find((x) => x.id === id);
  const d = date ?? b.date;
  const t = todayIso();
  const starts = openStarts(place(), d, b.minutes, bookings, { lead: 0, skip: b });
  openSheet(`Перенести: ${esc(who(b))}`, `
    <div class="chips day-chips" role="group" aria-label="День">${Array.from({ length: 7 }, (_, i) => shiftDay(t, i)).map((x) => `<button class="chip" type="button" data-action="move-day" data-id="${b.id}" data-date="${x}" aria-pressed="${x === d}" ${hoursFor(place(), x) ? '' : 'disabled'}>${dayWord(x)}</button>`).join('')}</div>
    ${starts.length ? `<div class="slots" role="group" aria-label="Вільний час">${starts.map((s) => `<button class="slot" type="button" data-action="move-to" data-id="${b.id}" data-date="${d}" data-time="${s}">${s}</button>`).join('')}</div>`
      : '<p class="muted">На цей день вільних боксів немає.</p>'}`, b.id);
}

// Позначити минулі записи: усе в одному списку, по кнопці на кожен.
function markSheet() {
  const list = unmarked();
  openSheet('Чим закінчились записи', `<ul class="mark-list">${list.map((b) => `<li>
    <div><b>${esc(who(b))}</b><small>${dayWord(b.date)}, ${b.time} · ${esc(b.services.join(', '))} · ${uah(sumOf(b))}</small></div>
    <div class="row">${b.state === 'paid'
      ? `<button class="btn navy" type="button" data-action="ready" data-id="${b.id}" data-from="mark">Машина готова</button><button class="btn" type="button" data-action="carcar-noshow" data-id="${b.id}" data-from="mark">Не приїхав</button>`
      : `<button class="btn navy" type="button" data-action="mark-done" data-id="${b.id}" data-from="mark">Виконано</button><button class="btn" type="button" data-action="crm-noshow" data-id="${b.id}" data-from="mark">Не приїхав</button>`}</div>
  </li>`).join('')}</ul>
  <p class="fine">«Виконано» для записів по телефону — оплата карткою на суму запису. Іншу суму чи готівку можна вказати в картці запису.</p>`);
}

// ---------- швидкий запис ----------

let nb = null; // чернетка нового запису

function nbOpen(prefill = {}) {
  nb = { cls: 0, services: new Set(), date: todayIso(), time: '', channel: 'phone', name: '', phone: '', car: '', ...prefill };
  if (nb.want) nb.time = nb.want;
  openSheet('Новий запис', `<form class="stack nb-form" id="nb-form" style="gap:14px" novalidate>
    <div class="seg-row" role="radiogroup" aria-label="Звідки клієнт">
      <label><input type="radio" name="channel" value="phone" ${nb.channel === 'phone' ? 'checked' : ''}><span>${icon('phone', 16)}По телефону</span></label>
      <label><input type="radio" name="channel" value="walkin" ${nb.channel === 'walkin' ? 'checked' : ''}><span>${icon('car', 16)}Приїхав сам</span></label></div>
    <label class="field"><span>Телефон</span><input name="phone" type="tel" inputmode="tel" autocomplete="off" placeholder="+380" value="${esc(nb.phone)}"></label>
    <p class="nb-hint small" id="nb-hint" aria-live="polite"></p>
    <div class="grid2">
      <label class="field"><span>Імʼя</span><input name="name" autocomplete="off" value="${esc(nb.name)}"></label>
      <label class="field"><span>Авто й номер</span><input name="car" autocomplete="off" placeholder="Golf, AA1234BB" value="${esc(nb.car)}"></label>
    </div>
    <div id="nb-dyn" class="stack" style="gap:14px"></div>
  </form>`);
  nbRender();
  nbHint();
}

const nbChosen = () => place().services.filter((s) => nb.services.has(s.id));
const nbPriceMinutes = () => nbChosen().reduce((a, s) => a + s.min, 0) || 30;
// Тривалість за прайсом; мийка може уточнити її (велика чи дуже брудна машина), щоб графік був точним.
const nbMinutes = () => nb.minutes ?? nbPriceMinutes();
const DUR_STEPS = Array.from({ length: 32 }, (_, i) => (i + 1) * 15);
const durOptions = (cur) => [...new Set([...DUR_STEPS, cur])].sort((a, b) => a - b).map((m) => `<option value="${m}" ${m === cur ? 'selected' : ''}>${duration(m)}</option>`).join('');
// Тривалість можна змінити, поки запис не закрито.
const DUR_EDIT = ['pending', 'paid', 'booked'];

function nbTimes() {
  const out = openStarts(place(), nb.date, nbMinutes(), bookings, { lead: 0 });
  // Клієнт уже біля боксу: «Зараз» — із поточної хвилини, якщо є вільний бокс.
  if (nb.channel === 'walkin' && nb.date === todayIso()) {
    const now = nbNow();
    if (!out.includes(now) && boxFree(nb.date, toMin(now), nbMinutes())) out.unshift(now);
  }
  return out;
}
const nbNow = () => hhmm(Math.floor(minuteNow() / 5) * 5);

function nbRender() {
  const p = place();
  const chosen = nbChosen();
  const total = chosen.reduce((a, s) => a + s.price[nb.cls], 0);
  const times = nbTimes();
  if (!times.includes(nb.time)) nb.time = times[0] ?? '';
  const t = todayIso();
  const nowTime = nb.channel === 'walkin' && nb.date === t && times[0] === nbNow() ? times[0] : null;
  $('#nb-dyn').innerHTML = `
    <div><span class="lbl">Клас авто</span><div class="chips nb-chips" role="group" aria-label="Клас авто">${CAR_CLASSES.map((c, i) => `<button class="chip" type="button" data-action="nb-cls" data-i="${i}" aria-pressed="${i === nb.cls}">${c}</button>`).join('')}</div></div>
    <div><span class="lbl">Послуги</span><div class="svc-chips" role="group" aria-label="Послуги">${p.services.map((s) => `<button class="svc-chip" type="button" data-action="nb-svc" data-id="${s.id}" aria-pressed="${nb.services.has(s.id)}"><b>${esc(s.name)}</b><small>${uah(s.price[nb.cls])} · ${duration(s.min)}</small></button>`).join('')}</div></div>
    ${washers().length ? `<div><span class="lbl">Мийник</span><div class="chips nb-chips" role="group" aria-label="Мийник">
      <button class="chip" type="button" data-action="nb-washer" data-m="" aria-pressed="${!nb.masterId}">Будь-хто</button>
      ${washers().map((w) => {
        const busy = nb.time && washerBusy(w.id, { date: nb.date, time: nb.time, minutes: nbMinutes() });
        return `<button class="chip" type="button" data-action="nb-washer" data-m="${w.id}" aria-pressed="${nb.masterId === w.id}">${esc(w.name)}${busy ? ' · зайнятий' : ''}</button>`;
      }).join('')}</div></div>` : ''}
    ${chosen.length ? `<label class="field nb-dur"><span>Тривалість</span><select id="nb-dur">${durOptions(nbMinutes())}</select>
      <small class="muted">${nb.minutes && nb.minutes !== nbPriceMinutes() ? `За прайсом ${duration(nbPriceMinutes())} — змінено вручну` : 'За прайсом. Змініть, якщо машина велика чи дуже брудна — графік буде точнішим'}</small></label>` : ''}
    <div><span class="lbl">День</span><div class="chips nb-chips" role="group" aria-label="День">${Array.from({ length: 7 }, (_, i) => shiftDay(t, i)).map((d) => `<button class="chip" type="button" data-action="nb-day" data-date="${d}" aria-pressed="${d === nb.date}" ${hoursFor(p, d) && (nb.channel !== 'walkin' || d === t) ? '' : 'disabled'}>${dayWord(d)}</button>`).join('')}</div></div>
    <div><span class="lbl">Час</span>${times.length ? `<div class="slots" role="group" aria-label="Вільний час">${times.map((x) => `<button class="slot" type="button" data-action="nb-time" data-time="${x}" aria-pressed="${x === nb.time}">${x === nowTime && nb.channel === 'walkin' ? 'Зараз' : x}</button>`).join('')}</div>`
      : `<p class="muted small" style="margin:6px 0 0">${hoursFor(p, nb.date) ? 'Вільних боксів на цей день немає.' : 'Цього дня мийка не працює.'}</p>`}</div>
    <div class="nb-foot"><span><b>${chosen.length ? uah(total) : 'Оберіть послуги'}</b><small>${chosen.length ? duration(nbMinutes()) : ''}</small></span>
      <button class="btn primary" type="submit" ${chosen.length && nb.time ? '' : 'disabled'}>Записати${nb.time ? ` на ${nb.time}` : ''}</button></div>`;
}

// Постійний клієнт: за телефоном підтягуємо імʼя й авто з минулих записів.
function nbHint() {
  const hint = $('#nb-hint');
  if (!hint) return;
  const key = phoneKey(nb.phone);
  const past = key ? own().filter((b) => b.clientPhone && phoneKey(b.clientPhone) === key).sort((a, b) => bookingStart(b) - bookingStart(a)) : [];
  if (!past.length) { hint.textContent = ''; return; }
  const f = $('#nb-form');
  if (!nb.name && past[0].clientName) { nb.name = past[0].clientName; f.elements.name.value = nb.name; }
  if (!nb.car && past[0].car) { nb.car = past[0].car; f.elements.car.value = nb.car; }
  hint.textContent = `Постійний клієнт: ${past.length} ${plural(past.length, 'візит', 'візити', 'візитів')}, останній — ${dayLabel(past[0].date, { day: 'numeric', month: 'long' })}`;
}

function nbSubmit() {
  const p = place();
  const chosen = nbChosen();
  if (!chosen.length || !nb.time) return;
  if (nb.channel === 'phone' && !phoneKey(nb.phone)) { toast('Вкажіть телефон клієнта'); $('#nb-form [name="phone"]').focus(); return; }
  // Форму могли тримати відкритою довго: минулий час уже не записуємо.
  if (nb.date < todayIso() || (nb.date === todayIso() && toMin(nb.time) < minuteNow() - 5)) { toast('Цей час уже минув — оберіть інший'); nbRender(); return; }
  if (nb.channel === 'walkin' && nb.date !== todayIso()) { toast('«Приїхав сам» — лише на сьогодні'); return; }
  // Час могли зайняти, поки заповнювали форму (наприклад, клієнт записався в застосунку).
  if (!boxFree(nb.date, toMin(nb.time), nbMinutes())) { toast('Цей час щойно зайняли — оберіть інший'); nbRender(); return; }
  const total = chosen.reduce((a, s) => a + s.price[nb.cls], 0);
  const b = {
    id: uid(), source: 'crm', channel: nb.channel, placeId: p.id, services: chosen.map((s) => s.name), total, paid: total, bonus: 0,
    covered: 0, passUse: null, masterId: nb.masterId ?? null, minutes: nbMinutes(), date: nb.date, time: nb.time,
    car: nb.car.trim() || CAR_CLASSES[nb.cls], plate: '', cls: nb.cls,
    clientName: nb.name.trim() || (nb.channel === 'walkin' ? 'Клієнт з вулиці' : 'Клієнт'), clientPhone: nb.phone.trim(), note: '',
    state: 'booked', createdAt: Date.now(),
  };
  bookings.push(b);
  save();
  closeSheet();
  location.hash = `#/bookings/${b.date}`;
  route();
  toast(`Записано: ${b.clientName}, ${dayWord(b.date).toLowerCase()} о ${b.time}`);
}

// ---------- мийка: гроші й показники ----------

function revenue(b) {
  if (b.state === 'completed') return isCarcar(b) ? price(b) : b.paid;
  if (isCarcar(b) && ['cancelled', 'noshow', 'refunded'].includes(b.state)) return b.placeAmount ?? 0;
  return 0;
}

function periodStats(days) {
  const to = todayIso();
  const from = shiftDay(to, -(days - 1));
  const list = own().filter((b) => b.date >= from && b.date <= to);
  const done = list.filter((b) => b.state === 'completed');
  const money = list.reduce((a, b) => a + revenue(b), 0);
  return { money, orders: done.length, avg: done.length ? Math.round(done.reduce((a, b) => a + sumOf(b), 0) / done.length) : 0 };
}

// Завантаження дня: зайняті хвилини боксів від робочих.
function loadPct(date) {
  const p = place();
  const h = hoursFor(p, date);
  if (!h) return null;
  const used = own().filter((b) => b.date === date && (BLOCKING.includes(b.state) || b.state === 'completed') && !b.mobile).reduce((a, b) => a + b.minutes, 0);
  return Math.min(100, Math.round((used / ((h[1] - h[0]) * p.boxes)) * 100));
}

const starsLine = (n) => `<span class="stars" role="img" aria-label="Оцінка ${rating(n)} з 5">${[1, 2, 3, 4, 5].map((i) => `<span class="${i <= Math.round(n) ? 'on' : ''}">${icon('star', 14)}</span>`).join('')}</span>`;

function viewWash() {
  const p = place();
  const t = todayIso();
  const day = periodStats(1);
  const week = periodStats(7);
  const month = periodStats(30);
  const bal = balanceFor(p.id, bookings, payouts);
  const fee = Math.round(bal.available * commissionFor(p.id));
  const mine = payouts.filter((x) => x.placeId === p.id).sort((a, b) => b.at - a.at).slice(0, 3);
  const loadToday = loadPct(t);
  const loadTomorrow = loadPct(shiftDay(t, 1));
  return `<h1>Мийка</h1>
    ${washSwitch()}
    ${statusCard()}
    <section class="tiles pro-tiles" aria-label="Виручка">
      <div class="tile hero"><span>Сьогодні</span><b>${uah(day.money)}</b><small>${day.orders} ${plural(day.orders, 'машина', 'машини', 'машин')}${loadToday === null ? '' : ` · завантаження ${loadToday}%`}</small></div>
      <div class="tile"><span>7 днів</span><b>${uah(week.money)}</b><small>${week.orders} ${plural(week.orders, 'машина', 'машини', 'машин')}</small></div>
      <div class="tile"><span>30 днів</span><b>${uah(month.money)}</b><small>середній чек ${uah(month.avg)}</small></div>
      <div class="tile"><span>Завтра</span><b>${loadTomorrow === null ? 'вихідний' : `${loadTomorrow}%`}</b><small>${loadTomorrow === null ? '' : 'боксів зайнято'}</small></div>
    </section>
    <section class="pro-card" aria-labelledby="h-money">
      <h2 id="h-money">Гроші через CARCAR</h2>
      <div class="money-row"><span>Можна вивести</span><b>${uah(bal.available)}</b></div>
      <div class="money-row"><span>Заморожено до підтвердження</span><b>${uah(bal.frozen)}</b></div>
      ${payoutReady(p.id)
        ? `<button class="btn primary block" type="button" data-action="payout" ${bal.available > 0 ? '' : 'disabled'}>${bal.available > 0 ? `Вивести ${uah(bal.available - fee)} на ${maskIban(partnerOf(p.id).payout.iban)}` : 'Немає коштів для виведення'}</button>`
        : `<a class="btn block" href="#/payout">${partnerOf(p.id).payout?.iban ? 'Рахунок на перевірці CARCAR' : 'Вказати рахунок для виплат'}</a>`}
      <p class="fine">Комісія CARCAR ${Math.round(commissionFor(p.id) * 100)}% утримується під час виведення. Оплати на місці не обкладаються.</p>
      ${mine.length ? `<ul class="plain-list">${mine.map((x) => `<li><span>${fmtTime(x.at)}</span><b>${uah(x.net)}</b></li>`).join('')}</ul>` : ''}
    </section>
    ${suggestCard(true)}
    <a class="pro-link" href="#/analytics">${icon('chart', 22)}<span><b>Аналітика</b><small>Виручка по днях, завантаження по годинах, послуги й клієнти</small></span>${icon('chevR', 18)}</a>`;
}

// Перемикач мийок акаунта й «Додати мийку».
function washSwitch() {
  const ids = accountPlaces(session());
  return `<div class="wash-switch" role="group" aria-label="Ваші мийки">
    ${ids.map((id) => {
      const x = placeById(id);
      const st = partnerOf(id).status;
      const wait = pendingList().filter((b) => b.placeId === id).length;
      return `<button class="wash-chip" type="button" data-action="wash-pick" data-id="${id}" aria-pressed="${id === ui.place}"><b>${esc(x.name)}${wait ? ` <span class="pill warn">${wait} ${plural(wait, 'новий запис', 'нові записи', 'нових записів')}</span>` : ''}</b><small>${esc(x.city ?? 'Київ')}, ${esc(x.address)}${st === 'approved' ? '' : ` · ${PARTNER_STATUS[st][0].toLowerCase()}`}</small></button>`;
    }).join('')}
    <button class="wash-chip add" type="button" data-action="wash-add">${icon('plus', 18)}<b>Додати мийку</b></button>
  </div>`;
}

function addWashSheet() {
  openSheet('Нова мийка', `<form class="stack" id="wash-form" style="gap:12px">
    <p class="small muted" style="margin:0">Мийка зʼявиться в цьому ж кабінеті одразу, а клієнтам — після перевірки CARCAR (до 2 робочих днів).</p>
    <label class="field"><span>Назва</span><input name="name" required maxlength="80" autocomplete="off" placeholder="Автомийка «Блиск» на Подолі"></label>
    <label class="field"><span>Місто</span><select name="city">${CITIES.map((c) => `<option ${c.name === (place().city ?? 'Київ') ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select></label>
    <label class="field"><span>Адреса</span><input name="address" required maxlength="120" autocomplete="off"></label>
    <div class="grid2">
      <label class="field"><span>Телефон</span><input name="phone" type="tel" required autocomplete="off" placeholder="+380"></label>
      <label class="field"><span>Боксів</span><input name="boxes" type="number" min="1" max="30" value="2" required inputmode="numeric"></label>
    </div>
    <button class="btn primary" type="submit">Додати мийку</button>
  </form>`);
}

// ---------- профіль мийки ----------

const timeOptions = (sel, from = 0, to = 24 * 60) => {
  const out = [];
  for (let m = from; m <= to; m += 30) out.push(`<option value="${m}" ${m === sel ? 'selected' : ''}>${hhmm(m)}</option>`);
  return out.join('');
};

function viewProfile() {
  const p = place();
  const s = scheduleOf(p);
  const r = ratingFor(p.id, reviews);
  const pw = powerOf(p.id);
  const t = todayIso();
  const specials = Object.entries(s.special).filter(([d]) => d >= t).sort(([a], [b]) => a.localeCompare(b));
  return `<h1>Профіль мийки</h1><p class="lead">Так вас бачать клієнти в CARCAR. Зміни зʼявляються в застосунку одразу.</p>
    ${infoCard(p, r)}
    <section class="pro-card" aria-labelledby="h-power">
      <h2 id="h-power">Світло</h2>
      <div class="chips wrap" role="group" aria-label="Світло на мийці">${Object.entries(POWER).map(([k, [label]]) => `<button class="chip" type="button" data-action="power" data-k="${k}" aria-pressed="${pw?.state === k}">${label}</button>`).join('')}</div>
      <p class="fine">${pw ? `Оновлено ${fmtTime(pw.at)}. ` : ''}Під час відключень клієнти шукають мийки, які працюють, — відмітка діє 12 годин.</p>
    </section>
    ${reliabilityCard(p)}
    <section class="pro-card" aria-labelledby="h-confirm">
      <h2 id="h-confirm">Запис клієнтів</h2>
      <label class="check-row"><input class="check" type="checkbox" id="auto-confirm" ${autoConfirmOf(p.id) ? 'checked' : ''}><span><b>Приймати записи автоматично</b>
        <small class="fine" style="display:block">${autoConfirmOf(p.id) ? 'Клієнт одразу отримує підтвердження. Слідкуйте, щоб розклад був актуальним.' : `Кожен запис ви підтверджуєте самі. Не відповіли за ${PAYMENT.confirmMinutes} хв робочого часу — запис скасовується, гроші повертаються клієнту.`}</small></span></label>
    </section>
    <form class="pro-card stack" id="pf-main" aria-labelledby="h-main" style="gap:12px">
      <h2 id="h-main">Контакти й бокси</h2>
      <div class="grid2">
        <label class="field"><span>Телефон для клієнтів</span><input name="phone" type="tel" required value="${esc(p.phone)}"></label>
        <label class="field"><span>Боксів</span><input name="boxes" type="number" min="1" max="30" required inputmode="numeric" value="${p.boxes}"></label>
      </div>
      <p class="fine">Скільки машин можна мити одночасно. Від цього залежить, скільки клієнтів можуть записатися на той самий час.</p>
      <button class="btn navy" type="submit">Зберегти</button>
    </form>
    <form class="pro-card stack" id="pf-hours" aria-labelledby="h-hours" style="gap:10px">
      <h2 id="h-hours">Графік роботи</h2>
      ${WEEKDAY_NAMES.map((name, i) => {
        const h = s.week[i];
        return `<div class="hours-row"><label class="check-row"><input class="check" type="checkbox" name="on-${i}" ${h ? 'checked' : ''}><span>${name}</span></label>
          <select class="select" name="o-${i}" aria-label="${name}: відкриття">${timeOptions(h?.[0] ?? 9 * 60)}</select>
          <select class="select" name="c-${i}" aria-label="${name}: закриття">${timeOptions(h?.[1] ?? 20 * 60)}</select></div>`;
      }).join('')}
      <div class="hours-row"><label class="check-row"><input class="check" type="checkbox" name="brk-on" ${s.brk ? 'checked' : ''}><span>Перерва</span></label>
        <select class="select" name="brk-o" aria-label="Перерва: початок">${timeOptions(s.brk?.[0] ?? 13 * 60)}</select>
        <select class="select" name="brk-c" aria-label="Перерва: кінець">${timeOptions(s.brk?.[1] ?? 14 * 60)}</select></div>
      <div class="grid2">
        <label class="field"><span>Запис не пізніше ніж за</span><select name="lead">${[[0, 'будь-коли'], [15, '15 хв'], [30, '30 хв'], [60, '1 год'], [120, '2 год']].map(([v, l]) => `<option value="${v}" ${v === s.lead ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
        <label class="field"><span>Запис наперед</span><select name="horizon">${[7, 14, 30].map((v) => `<option value="${v}" ${v === s.horizon ? 'selected' : ''}>${v} днів</option>`).join('')}</select></label>
      </div>
      <button class="btn navy" type="submit">Зберегти графік</button>
      ${specials.length ? `<h3 class="sub-h">Особливі дні</h3><ul class="plain-list">${specials.map(([d, h]) => `<li><span>${dayWord(d, true)}: ${rangeText(h).toLowerCase()}</span><button class="btn soft" type="button" data-action="special-del" data-date="${d}">Як завжди</button></li>`).join('')}</ul>` : ''}
      <p class="fine">Закрити окремий день чи змінити години на свято можна в «Записах».</p>
    </form>
    <section class="pro-card" aria-labelledby="h-svc">
      <div class="head"><h2 id="h-svc">Послуги й ціни</h2><button class="btn soft" type="button" data-action="svc-new">${icon('plus', 16)}Додати</button></div>
      <ul class="svc-list">${p.allServices.map((x) => `<li><button type="button" class="svc-row${x.off ? ' off' : ''}" data-action="svc-edit" data-id="${x.id}">
        <span><b>${esc(x.name)}</b><small>${duration(x.min)}${x.off ? ' · приховано' : ''}</small></span><span class="price">${x.price[0] === x.price[2] ? uah(x.price[0]) : `${uah(x.price[0])}–${uah(x.price[2])}`}</span>${icon('chevR', 16)}</button></li>`).join('')}</ul>
    </section>`;
}

const MAX_PHOTOS = 6;
const imgSrc = (src) => (typeof src === 'string' && src.startsWith('data:image/') ? esc(src) : '');

// Профіль для клієнтів: аватар, фото, назва, адреса й опис — одразу на сторінці мийки в CARCAR.
function infoCard(p, r) {
  const photos = p.photos ?? [];
  const letter = firstLetter(p.name.replace(/^(Автомийка|Детейлінг-мийка)\s*/, '').replace(/[«»"]/g, ''));
  return `<form class="pro-card stack" id="pf-info" aria-labelledby="h-info" style="gap:12px">
      <h2 id="h-info">Як вас бачать клієнти</h2>
      <div class="ava-row">
        ${imgSrc(p.avatar) ? `<img class="ava" src="${imgSrc(p.avatar)}" alt="Аватар мийки">` : `<span class="avatar ava" aria-hidden="true">${letter}</span>`}
        <div class="stack" style="gap:6px"><small class="muted">${r.count ? `★ ${rating(r.avg)} · ${r.count} ${plural(r.count, 'відгук', 'відгуки', 'відгуків')}` : 'Відгуків ще немає'}</small>
          <div class="row"><label class="btn soft">${icon('camera', 16)}${p.avatar ? 'Змінити аватар' : 'Додати аватар'}<input class="sr-only" type="file" accept="image/*" id="pf-avatar" aria-label="Аватар мийки"></label>
          ${p.avatar ? '<button class="btn text-danger" type="button" data-action="ava-del">Прибрати</button>' : ''}</div></div>
      </div>
      <div><span class="lbl">Фото мийки (${photos.length} з ${MAX_PHOTOS}) — перше стає обкладинкою</span>
        <div class="photo-grid">${photos.map((src, i) => `<figure><img src="${imgSrc(src)}" alt="Фото ${i + 1}"><button class="photo-del" type="button" data-action="photo-del" data-i="${i}" aria-label="Видалити фото ${i + 1}">${icon('x', 16)}</button>${i ? `<button class="photo-first" type="button" data-action="photo-first" data-i="${i}">Обкладинка</button>` : ''}</figure>`).join('')}
        ${photos.length < MAX_PHOTOS ? `<label class="photo-add">${icon('plus', 22)}<span>Фото</span><input class="sr-only" type="file" accept="image/*" multiple id="pf-photos" aria-label="Додати фото мийки"></label>` : ''}</div></div>
      <label class="field"><span>Назва</span><input name="name" required maxlength="80" value="${esc(p.name)}" autocomplete="off"></label>
      <label class="field"><span>Адреса</span><input name="address" required maxlength="120" value="${esc(p.address)}" autocomplete="off"></label>
      <label class="field"><span>Опис</span><textarea name="about" rows="4" maxlength="500" placeholder="Що вирізняє мийку: хімія, зона очікування з кавою, швидкість, оплата карткою">${esc(p.about ?? '')}</textarea></label>
      <div class="row"><button class="btn navy" type="submit">Зберегти</button><a class="btn soft" href="index.html#/place/${p.id}" target="_blank" rel="noopener">Подивитися як клієнт</a></div>
    </form>`;
}

// Фото зберігаються на пристрої; якщо місця забракло — кажемо про це.
function savePhotos(patch, ok) {
  saveOverride(ui.place, patch);
  const saved = store.get('biz.places', {})[ui.place] ?? {};
  const fits = Object.entries(patch).every(([k, v]) => JSON.stringify(saved[k] ?? null) === JSON.stringify(v));
  rerender();
  toast(fits ? ok : 'Не вистачило памʼяті пристрою — спробуйте менше фото');
}

// Відмови й швидкість відповіді: від них залежить місце в пошуку CARCAR і пауза онлайн-запису.
function reliabilityCard(p) {
  const s = responseStats(p.id, bookings);
  const pause = pauseOf(p.id, bookings);
  const R = DECLINE_RULES;
  const status = pause ? `<p class="notice warn" style="margin:0"><b>Онлайн-запис на паузі до ${fmtTime(pause.until)}</b>Відмов ${ratePct(s.rate)} — більше за ${ratePct(R.pauseRate)}. Клієнти бачать мийку, але записатися через CARCAR не можуть.</p>`
    : s.lowered ? `<p class="notice warn" style="margin:0"><b>Мийка нижче в пошуку</b>Відмов ${ratePct(s.rate)} — більше за ${ratePct(R.warnRate)}. Пропонуйте інший час замість відмови, щоб повернутися вгору.</p>`
      : !s.enough ? `<p class="notice" style="margin:0">Поки мало заявок для оцінки: ${s.total} з ${R.minRequests}.</p>`
        : '<p class="notice ok" style="margin:0">Усе добре: клієнти бачать мийку у звичайному порядку.</p>';
  return `<section class="pro-card" aria-labelledby="h-rel">
      <h2 id="h-rel">Надійність для клієнтів</h2>
      <div class="rel-grid">
        <div><b>${ratePct(s.rate)}</b><small>відмов за ${R.days} днів${s.total ? ` (${s.declined} з ${s.total})` : ''}</small></div>
        <div><b>${msText(s.avgMs)}</b><small>середня відповідь на запис</small></div>
      </div>
      ${status}
      <p class="fine">Відмова — це ваша відмова або мовчання ${PAYMENT.confirmMinutes} хв. Запропонований інший час відмовою не вважається. Понад ${ratePct(R.warnRate)} відмов — мийка нижче в пошуку, від ${ratePct(R.pauseRate)} — онлайн-запис на паузі ${R.pauseHours} год після останньої відмови (якщо за ${R.days} днів не менше ${R.minRequests} заявок).</p>
    </section>`;
}

function serviceSheet(id, reqId = null) {
  const x = id ? place().allServices.find((s) => s.id === id) : null;
  const r = reqId ? ownRequests().find((q) => q.id === reqId) : null;
  const pr = x?.price ?? [0, 0, 0];
  openSheet(x ? 'Послуга' : 'Нова послуга', `<form class="stack" id="svc-form" data-id="${x?.id ?? ''}" data-req="${r?.id ?? ''}" style="gap:12px">
    ${r ? `<p class="small muted" style="margin:0">Питання клієнта: «${esc(r.messages[0].text)}»</p>` : ''}
    <label class="field"><span>Назва</span><input name="name" required maxlength="80" value="${esc(x?.name ?? '')}" autocomplete="off"></label>
    <label class="field"><span>Тривалість, хв</span><input name="min" type="number" min="5" step="5" required inputmode="numeric" value="${x?.min ?? 30}"></label>
    <fieldset class="price-set"><legend>Ціна, ₴</legend>
      ${CAR_CLASSES.map((c, i) => `<label class="field"><span>${c}</span><input name="p${i}" type="number" min="1" required inputmode="numeric" value="${pr[i] || ''}"></label>`).join('')}</fieldset>
    ${x ? `<label class="check-row"><input class="check" type="checkbox" name="on" ${x.off ? '' : 'checked'}><span>Показувати клієнтам</span></label>` : ''}
    <button class="btn primary" type="submit">${r ? 'Додати й повідомити клієнта' : 'Зберегти'}</button>
    ${x && x.id.startsWith('c_') ? `<button class="btn text-danger" type="button" data-action="svc-del" data-id="${x.id}">Видалити послугу</button>` : ''}
  </form>`);
}

function dayHoursSheet(date) {
  const p = place();
  const h = hoursFor(p, date) ?? scheduleOf(p).week.find(Boolean) ?? [9 * 60, 20 * 60];
  openSheet(dayWord(date, true), `<form class="stack" id="day-form" data-date="${date}" style="gap:12px">
    <p class="small muted" style="margin:0">Години лише на цей день — наприклад, на свято. Звичайний графік не зміниться.</p>
    <div class="grid2">
      <label class="field"><span>Відкриття</span><select name="o">${timeOptions(h[0])}</select></label>
      <label class="field"><span>Закриття</span><select name="c">${timeOptions(h[1])}</select></label>
    </div>
    <button class="btn primary" type="submit">Зберегти</button>
  </form>`);
}

// ---------- ще ----------

const placeTickets = () => ticketsAll().filter((t) => t.placeId === ui.place && t.from === 'place').sort((a, b) => b.updatedAt - a.updatedAt);
const reviewsOf = () => reviews.filter((x) => x.placeId === ui.place).sort((a, b) => b.at - a.at);
// Імʼя автора відгуку — із запису, за яким його залишили.
const reviewer = (x) => x.name ?? bookings.find((b) => b.id === x.bookingId)?.clientName ?? 'Клієнт CARCAR';

function viewMore() {
  const s = session();
  const pt = partnerOf(ui.place);
  const noReply = reviewsOf().filter((x) => !x.reply).length;
  const answers = placeTickets().filter((t) => t.unreadUser).length;
  const links = [
    ['#/reviews', 'star', 'Відгуки', noReply ? `Без відповіді: ${noReply}` : 'Відповіді видно на сторінці мийки', noReply],
    ['#/analytics', 'chart', 'Аналітика', 'Виручка, завантаження по годинах, послуги, клієнти', 0],
    ['#/staff', 'users', 'Мийники', washers().length ? washers().map((w) => w.name).join(', ') : 'Додайте мийників, щоб призначати їх на записи', 0],
    ['#/clients', 'users', 'Клієнти', 'Хто приїжджав, скільки разів і на якому авто', 0],
    ['#/payout', 'card', 'Рахунок для виплат', pt.payout?.iban ? `${maskIban(pt.payout.iban)} · ${pt.payout.verified ? 'перевірено' : 'на перевірці'}` : 'Вкажіть IBAN, щоб виводити гроші', pt.payout?.iban ? 0 : 1],
    ['#/support', 'info', 'Підтримка CARCAR', answers ? `Нові відповіді: ${answers}` : 'Виплати, спори, відгуки', answers],
  ];
  return `<h1>Ще</h1>
    ${notifyAsk() ? `<div style="margin-top:12px">${notifyAsk()}</div>` : ''}
    <div class="stack" style="gap:8px;margin-top:12px">${links.map(([href, ic, title, sub, n]) => `<a class="pro-link" href="${href}">${icon(ic, 22)}<span><b>${title}</b><small>${sub}</small></span>${n ? `<span class="count-dot" aria-hidden="true">${n}</span>` : ''}${icon('chevR', 18)}</a>`).join('')}</div>
    ${s?.demo ? `<button class="btn block" type="button" data-action="demo-seed" style="margin-top:16px">Заповнити прикладом: історія, записи й повідомлення</button>` : ''}
    <p class="fine" style="margin-top:16px">Щоб CarCar Business був під рукою, додайте його на головний екран: меню браузера → «Встановити застосунок» або «На екран “Додому”».</p>
    <button class="btn line-danger block" type="button" data-action="logout" style="margin-top:8px">${s?.demo ? 'Вийти з демо' : `Вийти${s?.login ? ` (${esc(s.login)})` : ''}`}</button>`;
}

// Мийники: хто працює на мийці, скільки машин помив за місяць і відсоток від роботи (якщо вказано).
function viewStaff() {
  const list = washers();
  const from = shiftDay(todayIso(), -29);
  const cars = (id) => own().filter((b) => b.masterId === id && b.state === 'completed' && b.date >= from).length;
  return `<a class="back" href="#/more">${icon('chevL', 22)}Ще</a><h1>Мийники</h1>
    <p class="lead">Обирайте мийника, коли приймаєте запис. Клієнт бачить, хто митиме машину.</p>
    ${list.length ? `<ul class="client-list">${list.map((w) => `<li>
      <span class="avatar" aria-hidden="true">${firstLetter(w.name)}</span>
      <span class="cl-main"><b>${esc(w.name)}</b><small>${w.phone ? esc(w.phone) : 'без телефону'}${w.pct ? ` · ${w.pct}% від роботи` : ''}</small><small>За 30 днів: ${cars(w.id)} ${plural(cars(w.id), 'машина', 'машини', 'машин')}</small></span>
      <button class="btn text-danger" type="button" data-action="washer-del" data-id="${w.id}" aria-label="Прибрати ${esc(w.name)}">Прибрати</button>
    </li>`).join('')}</ul>` : `<div class="pro-empty">${icon('users', 32)}<b>Мийників ще немає</b><span>Додайте їх, щоб призначати на записи.</span></div>`}
    <form class="pro-card stack" id="washer-form" aria-labelledby="h-add-w" style="gap:12px;margin-top:12px">
      <h2 id="h-add-w">Додати мийника</h2>
      <label class="field"><span>Імʼя</span><input name="name" required maxlength="60" autocomplete="off"></label>
      <div class="grid2">
        <label class="field"><span>Телефон</span><input name="phone" type="tel" autocomplete="off" placeholder="+380"></label>
        <label class="field"><span>% від роботи</span><input name="pct" type="number" min="0" max="100" inputmode="numeric" placeholder="необовʼязково"></label>
      </div>
      <button class="btn navy" type="submit">Додати</button>
    </form>`;
}

const backTo = (href, label) => `<a class="back" href="${href}">${icon('chevL', 22)}${label}</a>`;

// Відгуки: відповідь публічна, видалити не можна — можна поскаржитися модератору.
function viewReviews() {
  const list = reviewsOf();
  const r = ratingFor(ui.place, reviews);
  return `${backTo('#/more', 'Ще')}<h1>Відгуки</h1>
    <p class="lead">${r.count ? `${starsLine(r.avg)} <b>${rating(r.avg)}</b> · ${r.count} ${plural(r.count, 'відгук', 'відгуки', 'відгуків')}` : 'Відгуків ще немає.'} Відгук залишає лише клієнт, який був у вас через CARCAR.</p>
    ${list.map((x) => `<article class="pro-card pro-review" aria-label="Відгук: ${esc(reviewer(x))}">
      <div class="head"><b>${esc(reviewer(x))}</b>${starsLine(x.stars ?? x.rating)}</div>
      <small class="muted">${fmtTime(x.at)}${x.hidden ? ' · приховано модератором' : ''}</small>
      ${x.text ? `<p>${esc(x.text)}</p>` : ''}
      ${(x.photos ?? []).length ? `<div class="photo-grid">${x.photos.map((src, i) => `<figure><img src="${imgSrc(src)}" alt="Фото до відгуку ${i + 1}"></figure>`).join('')}</div>` : ''}
      ${x.reply ? `<p class="reply"><b>Ваша відповідь</b>${esc(x.reply.text)}</p>` : `<form class="chat-form rev-reply" data-id="${x.id}"><input name="reply" required maxlength="500" autocomplete="off" placeholder="Відповісти публічно…" aria-label="Відповідь на відгук: ${esc(reviewer(x))}"><button class="send-btn" type="submit" aria-label="Надіслати відповідь">${icon('send', 18)}</button></form>`}
      ${x.report?.status === 'open' ? '<p class="small muted" style="margin:0">Скаргу надіслано модератору CARCAR.</p>'
        : x.report?.status === 'rejected' ? `<p class="small muted" style="margin:0">Модератор залишив відгук${x.report.note ? `: ${esc(x.report.note)}` : ''}.</p>`
          : x.hidden ? '' : `<button class="btn text-danger" type="button" data-action="review-report" data-id="${x.id}" style="justify-self:start">Поскаржитися модератору</button>`}
    </article>`).join('')}`;
}

// Клієнти мийки — з записів: телефон, авто, візити, скільки витратили, коли були востаннє.
function clientsList() {
  const map = new Map();
  for (const b of own()) {
    const key = b.clientPhone ? phoneKey(b.clientPhone) : `name:${(b.clientName || '').toLowerCase()}`;
    if (!key || key === 'name:') continue;
    const c = map.get(key) ?? { key, name: b.clientName || 'Клієнт', phone: '', cars: new Set(), visits: 0, spent: 0, last: '', cls: b.cls ?? 0, car: '' };
    // Номер клієнта CARCAR мийка не бачить — лише тих, кого записала сама.
    if (!isCarcar(b) && b.clientPhone) c.phone = b.clientPhone;
    if (b.car) c.cars.add(b.car);
    if (b.state === 'completed') { c.visits += 1; c.spent += sumOf(b); }
    if (b.date > c.last) { c.last = b.date; c.name = b.clientName || c.name; c.car = b.car || c.car; c.cls = b.cls ?? c.cls; }
    map.set(key, c);
  }
  return [...map.values()].sort((a, b) => b.last.localeCompare(a.last));
}

function viewClients() {
  const q = (ui.clientQ ?? '').trim().toLowerCase();
  const all = clientsList();
  const list = q ? all.filter((c) => [c.name, c.phone, ...c.cars].join(' ').toLowerCase().includes(q)) : all;
  // Номер запису з дзвінка чи звернення: «100245» або «№ 100245».
  const byNo = /^\D*\d{6}\D*$/.test(q) ? own().find((b) => String(b.no) === q.replace(/\D/g, '')) : null;
  return `${backTo('#/more', 'Ще')}<h1>Клієнти</h1>
    <label class="search"><span class="sr-only">Пошук клієнта</span>${icon('search', 18)}<input id="client-q" type="search" placeholder="Імʼя, телефон, авто чи № запису" value="${esc(ui.clientQ ?? '')}" autocomplete="off"></label>
    ${byNo ? `<button class="pro-link block-btn" type="button" data-action="bk-open" data-id="${byNo.id}">${icon('calendar', 22)}<span><b>Запис ${bookingNo(byNo)}</b><small>${esc(who(byNo))} · ${dayWord(byNo.date)}, ${byNo.time} · ${esc(byNo.services.join(', '))}</small></span>${icon('chevR', 18)}</button>` : ''}
    <p class="small muted">${all.length} ${plural(all.length, 'клієнт', 'клієнти', 'клієнтів')}</p>
    ${list.length ? `<ul class="client-list">${list.slice(0, 100).map((c) => `<li>
      <span class="avatar" aria-hidden="true">${firstLetter(c.name)}</span>
      <span class="cl-main"><b>${esc(c.name)}</b><small>${esc([...c.cars].join(', ') || '—')}</small>
        <small>${c.visits} ${plural(c.visits, 'візит', 'візити', 'візитів')}${c.spent ? ` · ${uah(c.spent)}` : ''} · востаннє ${dayLabel(c.last, { day: 'numeric', month: 'short' })}</small></span>
      <span class="row">${c.phone ? `<a class="icon-btn" href="${telHref(c.phone)}" aria-label="Подзвонити: ${esc(c.name)}">${icon('phone', 20)}</a>` : ''}
        <button class="btn soft" type="button" data-action="nb-client" data-key="${esc(c.key)}">Записати</button></span>
    </li>`).join('')}</ul>` : `<div class="pro-empty">${icon('users', 32)}<b>${all.length ? 'Нікого не знайдено' : 'Клієнтів ще немає'}</b><span>Тут зʼявляться всі, хто записувався через CARCAR, по телефону чи приїжджав сам.</span></div>`}`;
}

// Рахунок для виплат: IBAN ФОП чи ТОВ. Нові реквізити перевіряє CARCAR, до того виведення недоступне.
function viewPayout() {
  const pt = partnerOf(ui.place);
  const pay = pt.payout ?? {};
  return `${backTo('#/more', 'Ще')}<h1>Рахунок для виплат</h1>
    <p class="lead">Гроші за записи через CARCAR виводяться лише на рахунок ФОП чи ТОВ.</p>
    ${pay.iban ? `<p class="notice ${pay.verified ? 'ok' : 'warn'}">${pay.verified ? `Рахунок ${maskIban(pay.iban)} перевірено — можна виводити гроші.` : `Рахунок ${maskIban(pay.iban)} на перевірці CARCAR, зазвичай до 2 робочих днів.`}</p>` : ''}
    <form class="pro-card stack" id="payout-form" style="gap:12px">
      <label class="field"><span>IBAN</span><input name="iban" required autocomplete="off" inputmode="text" placeholder="UA00 0000 0000 0000 0000 0000 000" value="${esc(pay.iban ? formatIban(pay.iban) : '')}"></label>
      <label class="field"><span>Отримувач (ФОП чи назва ТОВ)</span><input name="holder" required maxlength="120" autocomplete="off" value="${esc(pay.holder ?? '')}"></label>
      <label class="field"><span>РНОКПП (ФОП) чи ЄДРПОУ (ТОВ)</span><input name="code" required inputmode="numeric" maxlength="10" autocomplete="off" value="${esc(pay.code ?? '')}"></label>
      <button class="btn primary" type="submit">Надіслати на перевірку</button>
      <p class="fine">Після зміни рахунку виведення зупиняється, доки CARCAR не перевірить, що рахунок належить вашій мийці.</p>
    </form>`;
}

// Підтримка CARCAR для мийки: звернення з номером запису й фото.
function viewSupport(openId) {
  const list = placeTickets();
  const sel = list.find((t) => t.id === openId);
  if (sel?.unreadUser) setTicket(sel.id, { unreadUser: false });
  if (sel) {
    const b = bookings.find((x) => x.id === sel.bookingId);
    return `${backTo('#/support', 'Підтримка')}<h1>№${sel.no} · ${TICKET_TOPICS[sel.topic]}</h1>
      <p class="row"><span class="pill ${TICKET_STATUS[sel.status][1]}">${TICKET_STATUS[sel.status][0]}</span>${b?.no ? `<span class="small muted">Запис ${bookingNo(b)}</span>` : ''}</p>
      <ol class="thread ticket-thread">${sel.messages.map((m) => `<li class="msg ${m.from === 'place' ? 'me' : 'them'}"><small>${m.from === 'admin' ? 'Підтримка CARCAR' : 'Ви'} · ${fmtTime(m.at)}</small>${esc(m.text)}${ticketPhotos(m.photos)}</li>`).join('')}</ol>
      ${sel.status === 'closed' ? '<p class="small muted">Звернення закрито.</p>' : `<form class="stack" id="ticket-reply" data-id="${sel.id}" style="gap:10px">
        <label class="field"><span>Відповідь підтримці</span><textarea name="text" rows="3" maxlength="800"></textarea></label>
        ${photoPick()}<button class="btn primary" type="submit">Надіслати</button></form>`}`;
  }
  const recent = own().filter(isCarcar).sort((a, b) => bookingStart(b) - bookingStart(a)).slice(0, 20);
  return `${backTo('#/more', 'Ще')}<h1>Підтримка CARCAR</h1>
    <p class="lead">Термінові питання про гроші й спори розглядаємо до 2 годин, решту — протягом доби.</p>
    ${list.length ? `<ul class="client-list">${list.map((t) => `<li><span class="cl-main"><b>№${t.no} · ${TICKET_TOPICS[t.topic]}</b><small>${esc(t.messages.at(-1).text)}</small></span>
      <span class="pill ${t.unreadUser ? 'warn' : TICKET_STATUS[t.status][1]}">${t.unreadUser ? 'Нова відповідь' : TICKET_STATUS[t.status][0]}</span><a class="btn soft" href="#/support/${t.id}">Відкрити</a></li>`).join('')}</ul>` : ''}
    <form class="pro-card stack" id="ticket-form" aria-labelledby="h-new-t" style="gap:12px;margin-top:12px">
      <h2 id="h-new-t">Нове звернення</h2>
      <label class="field"><span>Тема</span><select name="topic">${PLACE_TOPICS.map((k) => `<option value="${k}">${TICKET_TOPICS[k]}</option>`).join('')}</select></label>
      <label class="field"><span>Запис (необовʼязково)</span><select name="booking"><option value="">Не стосується запису</option>
        ${recent.map((b) => `<option value="${b.id}">${bookingNo(b)} · ${dayLabel(b.date, { day: 'numeric', month: 'short' })} ${b.time} · ${esc(who(b))}</option>`).join('')}</select></label>
      <label class="field"><span>Опишіть питання</span><textarea name="text" rows="4" required maxlength="1000"></textarea></label>
      ${photoPick()}
      <button class="btn primary" type="submit">Надіслати</button>
    </form>`;
}
const photoPick = () => `<label class="dropzone small-drop">${icon('camera', 20)}Додати фото (до 3)<span class="photo-count" aria-live="polite"></span><input class="sr-only" name="photos" type="file" accept="image/*" multiple></label>`;

// ---------- аналітика й знижки на тихі години ----------

const WD_SHORT = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Нд'];
const LOAD_WEEKS = 8;

// Завантаження боксів по днях тижня й годинах за останні тижні: зайняті хвилини / робочі хвилини боксів.
function demandGrid(weeks = LOAD_WEEKS) {
  const p = place();
  const t = todayIso();
  const cells = Array.from({ length: 7 }, () => Array.from({ length: 24 }, () => ({ cap: 0, used: 0 })));
  const byDay = new Map();
  for (const b of own()) {
    if (!['completed', 'noshow', ...BLOCKING].includes(b.state) || b.mobile) continue;
    byDay.set(b.date, [...(byDay.get(b.date) ?? []), b]);
  }
  let orders = 0;
  for (let i = 1; i <= weeks * 7; i++) {
    const d = shiftDay(t, -i);
    const h = hoursFor(p, d);
    if (!h) continue;
    const wd = (parseDate(d).getDay() + 6) % 7;
    const list = byDay.get(d) ?? [];
    orders += list.length;
    for (let hr = Math.floor(h[0] / 60); hr < Math.ceil(h[1] / 60); hr++) {
      const s = Math.max(hr * 60, h[0]);
      const e = Math.min(hr * 60 + 60, h[1]);
      if (e <= s) continue;
      const c = cells[wd][hr];
      // Перерва — не робочий час: не рахуємо її ні в ємності, ні як «тиху» годину.
      const brk = scheduleOf(p).brk;
      const off = brk ? Math.max(0, Math.min(e, brk[1]) - Math.max(s, brk[0])) : 0;
      c.cap += (e - s - off) * p.boxes;
      c.used += list.reduce((a, b) => a + Math.max(0, Math.min(e, toMin(b.time) + b.minutes) - Math.max(s, toMin(b.time))), 0);
    }
  }
  return { cells, orders };
}
const rateOf = (cells, days, from, to) => {
  let cap = 0;
  let used = 0;
  for (const wd of days) for (let hr = from; hr < to; hr++) { cap += cells[wd][hr].cap; used += cells[wd][hr].used; }
  return cap ? used / cap : null;
};

// Пропозиції знижки: найтихіше вікно 2–3 години в будні й у вихідні, якщо воно помітно тихіше за решту дня.
function quietSuggestions() {
  const { cells, orders } = demandGrid();
  if (orders < 30) return { list: [], orders };
  const p = place();
  const deals = weeklyDealsOf(p.id);
  const groups = [[[0, 1, 2, 3, 4], 'Пн–Пт'], [[5, 6], 'Сб–Нд']];
  const list = [];
  for (const [days, label] of groups) {
    const open = days.filter((wd) => cells[wd].some((c) => c.cap));
    if (!open.length) continue;
    const hrs = [...Array(24).keys()].filter((hr) => open.every((wd) => cells[wd][hr].cap));
    const avg = rateOf(cells, open, Math.min(...hrs), Math.max(...hrs) + 1);
    let best = null;
    for (const len of [3, 2]) {
      for (const from of hrs) {
        if (!hrs.includes(from + len - 1) || hrs.indexOf(from + len - 1) - hrs.indexOf(from) !== len - 1) continue;
        const r = rateOf(cells, open, from, from + len);
        if (r !== null && (!best || r < best.rate - 0.02)) best = { from, to: from + len, rate: r };
      }
    }
    if (!best || avg === null || best.rate > Math.min(0.4, avg * 0.7)) continue;
    const covered = deals.some((d) => open.some((wd) => d.days.includes(wd)) && d.from < best.to * 60 && d.to > best.from * 60);
    const pct = best.rate < 0.15 ? 20 : best.rate < 0.3 ? 15 : 10;
    list.push({ days: open, label, from: best.from * 60, to: best.to * 60, rate: best.rate, avg, pct, covered });
  }
  return { list, orders };
}

// Розмір знижки обирає мийка: від 5 до 50%.
const PCTS = [5, 10, 15, 20, 25, 30, 40, 50];
const pctPicker = (name, pct) => `<div class="seg-row pct-row" role="radiogroup" aria-label="Розмір знижки">${PCTS.map((v) => `<label><input type="radio" name="${name}" value="${v}" ${v === pct ? 'checked' : ''}><span>−${v}%</span></label>`).join('')}</div>`;

// Своя знижка: дні, години й розмір — коли аналізу ще замало або мийка знає свої тихі години сама.
function ownDealForm() {
  const week = scheduleOf(place()).week;
  const open = week.filter(Boolean);
  const first = open.length ? Math.floor(Math.min(...open.map((x) => x[0])) / 60) : 8;
  const last = open.length ? Math.ceil(Math.max(...open.map((x) => x[1])) / 60) : 22;
  const opts = (sel) => Array.from({ length: last - first + 1 }, (_, i) => first + i).map((hr) => `<option value="${hr * 60}" ${hr * 60 === sel ? 'selected' : ''}>${String(hr).padStart(2, '0')}:00</option>`).join('');
  return `<form class="stack own-deal" id="deal-form" style="gap:10px" aria-labelledby="h-own-deal">
      <h3 class="sub-h" id="h-own-deal">Своя знижка на години</h3>
      <fieldset class="wd-row"><legend class="sr-only">Дні</legend>${WD_SHORT.map((w, i) => `<label><input type="checkbox" name="day" value="${i}" ${week[i] && i < 5 ? 'checked' : ''}><span>${w}</span></label>`).join('')}</fieldset>
      <div class="grid2">
        <label class="field"><span>З години</span><select name="from">${opts(first * 60)}</select></label>
        <label class="field"><span>До години</span><select name="to">${opts(Math.min(last, first + 3) * 60)}</select></label>
      </div>
      ${pctPicker('pct', 15)}
      <button class="btn" type="submit">Увімкнути знижку</button>
    </form>`;
}

function suggestCard(compact = false) {
  const { list, orders } = quietSuggestions();
  const fresh = list.filter((x) => !x.covered);
  const active = weeklyDealsOf(ui.place);
  if (compact && !fresh.length) return '';
  return `<section class="pro-card suggest" aria-labelledby="h-quiet">
    <h2 id="h-quiet">${icon('bolt', 20)}Знижка на тихі години</h2>
    ${!list.length ? `<p class="small muted" style="margin:0">${orders < 30 ? `Замало записів для аналізу: ${orders} з 30 за ${LOAD_WEEKS} тижнів.` : 'Тихих годин не знайшли — завантаження рівне.'}</p>` : ''}
    ${fresh.map((x, i) => `<div class="suggest-item">
      <p style="margin:0"><b>${x.label}, ${hhmm(x.from)}–${hhmm(x.to)}</b> — зайнято лише ${ratePct(x.rate)} боксів (у середньому за день ${ratePct(x.avg)}).
        Знижка на цей час приведе клієнтів, які інакше поїхали б в інший час чи на іншу мийку. Радимо −${x.pct}%, розмір обираєте ви.</p>
      ${pctPicker(`qp-${i}`, x.pct)}
      <button class="btn navy" type="button" data-action="quiet-on" data-days="${x.days.join(',')}" data-from="${x.from}" data-to="${x.to}" data-pct="${x.pct}" data-pick="qp-${i}">Увімкнути −${x.pct}%</button>
    </div>`).join('')}
    ${compact ? '' : ownDealForm()}
    ${active.length ? `<ul class="plain-list">${active.map((d) => `<li><span><b>−${d.pct}%</b> ${daysText(d.days)}, ${hhmm(d.from)}–${hhmm(d.to)}</span><button class="btn soft" type="button" data-action="deal-off" data-id="${d.id}">Вимкнути</button></li>`).join('')}</ul>` : ''}
    <p class="fine">Аналіз за ${LOAD_WEEKS} тижнів. Клієнти бачать знижку на час і ціну зі знижкою, коли обирають запис. Знижку оплачує мийка.</p>
  </section>`;
}

// Стовпчики виручки по днях: одна серія, підписи — найбільший і останній день.
function revenueBars(days) {
  const t = todayIso();
  const list = Array.from({ length: days }, (_, i) => shiftDay(t, -(days - 1 - i)));
  const vals = list.map((d) => own().filter((b) => b.date === d).reduce((a, b) => a + revenue(b), 0));
  const max = Math.max(1, ...vals);
  return `<div class="rev-bars" role="img" aria-label="Виручка по днях: найбільше ${uah(Math.max(...vals))}">${list.map((d, i) => `<span class="rev-bar" style="height:${Math.max(2, (vals[i] / max) * 100)}%" title="${dayLabel(d, { day: 'numeric', month: 'short' })}: ${uah(vals[i])}"></span>`).join('')}</div>
    <div class="rev-axis"><span>${dayLabel(list[0], { day: 'numeric', month: 'short' })}</span><span>максимум ${uah(Math.max(...vals))}</span><span>сьогодні</span></div>`;
}

function heatmap() {
  const { cells } = demandGrid();
  const p = place();
  const hrs = [...Array(24).keys()].filter((hr) => cells.some((row) => row[hr].cap));
  if (!hrs.length) return '';
  const cell = (c) => {
    if (!c.cap) return '<td class="off"></td>';
    const r = c.used / c.cap;
    const k = Math.round(8 + r * 80);
    return `<td style="background:color-mix(in srgb, var(--navy) ${k}%, var(--bg));color:${k > 50 ? 'var(--on-navy)' : 'var(--text)'}" title="${ratePct(r)}">${Math.round(r * 100)}</td>`;
  };
  return `<div class="heat-wrap" tabindex="0" role="region" aria-label="Таблиця: зайнятість боксів по днях і годинах"><table class="heat">
    <thead><tr><th scope="col"><span class="sr-only">День</span></th>${hrs.map((hr) => `<th scope="col">${hr}</th>`).join('')}</tr></thead>
    <tbody>${WD_SHORT.map((w, wd) => `<tr><th scope="row">${w}</th>${hrs.map((hr) => cell(cells[wd][hr])).join('')}</tr>`).join('')}</tbody>
  </table></div><p class="fine">% зайнятих боксів (${p.boxes}) за ${LOAD_WEEKS} тижнів; чим темніше, тим більше машин.</p>`;
}

function viewAnalytics() {
  const n = ui.anPeriod ?? 30;
  const t = todayIso();
  const from = shiftDay(t, -(n - 1));
  const list = own().filter((b) => b.date >= from && b.date <= t);
  const done = list.filter((b) => b.state === 'completed');
  const money = list.reduce((a, b) => a + revenue(b), 0);
  const lost = list.filter((b) => ['cancelled', 'noshow'].includes(b.state) && !b.declined).length;
  const past = list.filter((b) => b.state !== 'pending' && bookingStart(b) <= new Date()).length;
  const key = (b) => (b.clientPhone ? phoneKey(b.clientPhone) : null);
  const firstSeen = new Map();
  for (const b of [...own()].sort((a, b) => a.date.localeCompare(b.date))) if (key(b) && !firstSeen.has(key(b))) firstSeen.set(key(b), b.date);
  const clients = [...new Set(done.map(key).filter(Boolean))];
  const fresh = clients.filter((k) => firstSeen.get(k) >= from).length;
  const svc = new Map();
  for (const b of done) for (const s of b.services) svc.set(s, (svc.get(s) ?? 0) + 1);
  const top = [...svc].sort((a, b) => b[1] - a[1]).slice(0, 6);
  const maxSvc = Math.max(1, ...top.map(([, v]) => v));
  const ch = Object.keys(CHANNEL).map((k) => [CHANNEL[k], done.filter((b) => channelOf(b) === k).length]).filter(([, v]) => v);
  return `${backTo('#/wash', 'Мийка')}<h1>Аналітика</h1>
    <div class="chips" role="group" aria-label="Період">${[7, 30, 90].map((d) => `<button class="chip" type="button" data-action="an-period" data-n="${d}" aria-pressed="${d === n}">${d} днів</button>`).join('')}</div>
    <section class="tiles pro-tiles" aria-label="Підсумки за ${n} днів">
      <div class="tile hero"><span>Виручка</span><b>${uah(money)}</b><small>${done.length} ${plural(done.length, 'машина', 'машини', 'машин')}</small></div>
      <div class="tile"><span>Середній чек</span><b>${uah(done.length ? Math.round(done.reduce((a, b) => a + sumOf(b), 0) / done.length) : 0)}</b></div>
      <div class="tile"><span>Клієнти</span><b>${clients.length}</b><small>нових ${fresh}, постійних ${clients.length - fresh}</small></div>
      <div class="tile"><span>Скасування й неявки</span><b>${past ? ratePct(lost / past) : '0%'}</b><small>${lost} з ${past}</small></div>
    </section>
    ${suggestCard()}
    <section class="pro-card" aria-labelledby="h-rev-days"><h2 id="h-rev-days">Виручка по днях</h2>${revenueBars(n)}</section>
    <section class="pro-card" aria-labelledby="h-heat"><h2 id="h-heat">Завантаження по годинах</h2>${heatmap()}</section>
    <section class="pro-card" aria-labelledby="h-top"><h2 id="h-top">Популярні послуги</h2>
      ${top.length ? `<ul class="hbars">${top.map(([name, v]) => `<li><span>${esc(name)}</span><span class="hb"><i style="width:${(v / maxSvc) * 100}%"></i></span><b>${v}</b></li>`).join('')}</ul>` : '<p class="small muted" style="margin:0">Ще немає виконаних записів.</p>'}
    </section>
    <section class="pro-card" aria-labelledby="h-ch"><h2 id="h-ch">Звідки клієнти</h2>
      ${ch.length ? `<ul class="hbars">${ch.map(([name, v]) => `<li><span>${name}</span><span class="hb"><i style="width:${(v / done.length) * 100}%"></i></span><b>${ratePct(v / done.length)}</b></li>`).join('')}</ul>` : '<p class="small muted" style="margin:0">Ще немає даних.</p>'}
    </section>`;
}

// Демо-історія за 8 тижнів: вранці в будні тихо, увечері й у вихідні — людно. Так видно аналітику й пропозиції знижок.
function demoHistory(p) {
  let seed = 7;
  const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  const names = ['Олена', 'Андрій', 'Ірина', 'Сергій', 'Марина', 'Тарас', 'Оксана', 'Дмитро', 'Юлія', 'Богдан', 'Наталія', 'Олег', 'Катерина', 'Віталій', 'Світлана', 'Роман'];
  const cars = ['Toyota Corolla', 'VW Golf', 'Skoda Octavia', 'Kia Sportage', 'Hyundai Tucson', 'Renault Duster', 'BMW X3', 'Mazda 6'];
  const clients = Array.from({ length: 48 }, (_, i) => ({ name: `${names[i % names.length]} ${String.fromCharCode(1040 + (i * 7) % 28)}.`, phone: `+380 67 ${String(100 + i).padStart(3, '0')} ${String(10 + (i * 13) % 90).padStart(2, '0')} ${String(10 + (i * 31) % 90).padStart(2, '0')}`, car: cars[i % cars.length] }));
  const mains = p.services.filter((s) => s.min <= 90);
  const out = [];
  const t = todayIso();
  for (let i = LOAD_WEEKS * 7; i >= 1; i--) {
    const d = shiftDay(t, -i);
    const h = hoursFor(p, d);
    if (!h) continue;
    const wd = (parseDate(d).getDay() + 6) % 7;
    for (let m = h[0]; m + 30 <= h[1]; m += 30) {
      const hr = m / 60;
      const want = wd >= 5 ? (hr >= 11 && hr < 17 ? 0.55 : 0.25) : hr < 12 ? 0.06 : hr < 16 ? 0.22 : hr < 20 ? 0.6 : 0.2;
      for (let box = 0; box < p.boxes; box++) {
        if (rnd() > want / 2) continue;
        const s = mains[Math.floor(rnd() * mains.length)];
        if (!s || m + s.min > h[1]) continue;
        const busy = out.filter((b) => b.date === d && toMin(b.time) < m + s.min && toMin(b.time) + b.minutes > m).length;
        if (busy >= p.boxes) continue;
        const c = clients[Math.floor(rnd() * rnd() * clients.length)];
        const r = rnd();
        const channel = r < 0.6 ? 'carcar' : r < 0.9 ? 'phone' : 'walkin';
        const price = s.price[0];
        const b = { id: uid(), source: 'demo', channel, placeId: p.id, services: [s.name], total: price, paid: price, bonus: 0, minutes: s.min, date: d, time: hhmm(m), cls: 0,
          car: c.car, clientName: c.name, clientPhone: c.phone, state: 'completed', payment: channel === 'carcar' ? undefined : 'card', createdAt: parseDate(d).getTime() - 864e5 };
        if (rnd() < 0.05) Object.assign(b, { state: channel === 'carcar' ? 'noshow' : 'cancelled', placeAmount: channel === 'carcar' ? price : 0 });
        else complete(b, parseDate(d).getTime() + (m + s.min) * 60000);
        out.push(b);
      }
    }
  }
  return out;
}

// Приклад для демо: кілька записів на сьогодні й завтра, переписка й питання клієнта.
function demoSeed() {
  const p = place();
  bookings = bookings.filter((b) => !(b.source === 'demo' && b.placeId === p.id));
  requests = requests.filter((r) => !(r.demo && r.placeId === p.id));
  bookings.push(...demoHistory(p));
  const t = todayIso();
  const svc = p.services;
  const pick = (...i) => i.map((k) => svc[k % svc.length]).filter((x, j, a) => a.indexOf(x) === j);
  const make = (date, s, extra) => {
    const minutes = s.reduce((a, x) => a + x.min, 0);
    const time = extra.time ?? openStarts(p, date, minutes, bookings, { lead: 0 })[extra.slot ?? 0];
    if (!time) return null;
    const total = s.reduce((a, x) => a + x.price[0], 0);
    const b = { id: uid(), source: 'demo', placeId: p.id, services: s.map((x) => x.name), total, paid: total, bonus: 0, minutes, date, time, cls: 0, createdAt: Date.now() - 3 * 3600e3, ...extra };
    delete b.slot;
    bookings.push(b);
    return b;
  };
  const ago = (min) => Date.now() - min * 60000;
  const y = shiftDay(t, -1);
  const yh = hoursFor(p, y);
  if (yh) make(y, pick(0), { time: hhmm(yh[0] + 120), channel: 'phone', state: 'booked', clientName: 'Олег Кравчук', clientPhone: '+380 67 210 33 44', car: 'Renault Megane · AA4512KI' });
  make(t, pick(1, 2), { slot: 1, channel: 'carcar', state: 'paid', clientName: 'Ірина Мельник', clientPhone: '+380 50 123 45 67', car: 'Toyota RAV4 · KA7781CB',
    chat: [{ from: 'client', text: 'Добрий день! Можна приїхати на 15 хвилин раніше?', at: ago(12) }], chatUnreadBiz: true });
  make(t, pick(0), { slot: 4, channel: 'phone', state: 'booked', clientName: 'Сергій Бондар', clientPhone: '+380 93 555 12 12', car: 'Skoda Octavia · AI3321OO' });
  make(t, pick(3), { slot: 8, channel: 'carcar', state: 'pending', clientName: 'Віктор Лисенко', clientPhone: '+380 68 909 11 22', car: 'Hyundai Tucson · AA7007PP', createdAt: ago(1) });
  const tm = shiftDay(t, 1);
  make(tm, pick(2), { slot: 2, channel: 'carcar', state: 'paid', clientName: 'Андрій Коваль', clientPhone: '+380 66 400 70 80', car: 'Kia Sportage · BC1209HH',
    chat: [{ from: 'client', text: 'Буду з багажником на даху, це не завадить?', at: ago(180), readAt: ago(170) }, { from: 'biz', text: 'Так, чекаємо', at: ago(170), readAt: ago(160) }] });
  make(tm, pick(0, 3), { slot: 6, channel: 'phone', state: 'booked', clientName: 'Наталія Шевчук', clientPhone: '+380 97 777 01 02', car: 'VW Golf · AA0909XT' });
  // Мийники для прикладу й хто мив машини в історії.
  if (!washers().length) saveWashers([...staffOf(p.id), ...['Олександр', 'Віталій', 'Денис'].map((name, i) => ({ id: `w${i}_${p.id}`, name, phone: '', role: 'master', pct: 35, active: true, demo: true }))]);
  const ws = washers();
  bookings.filter((b) => b.placeId === p.id && b.source === 'demo' && b.state !== 'pending' && !b.masterId).forEach((b, i) => { b.masterId = ws[i % ws.length].id; });
  requests.push({ id: uid(), demo: true, placeId: p.id, clientName: 'Максим', clientPhone: '+380 63 321 00 99', car: 'BMW X5', cls: 2,
    messages: [{ from: 'client', text: 'Робите хімчистку стелі? Скільки коштує для кросовера?', at: ago(40) }], at: ago(40), unreadBiz: true });
  save();
  location.hash = '#/';
  route();
  toast('Додано приклад записів і повідомлень');
}

// ---------- оболонка ----------

const TABS = [['', 'Повідомлення', 'chat'], ['bookings', 'Записи', 'calendar'], ['wash', 'Мийка', 'chart'], ['profile', 'Профіль', 'car'], ['more', 'Ще', 'list']];

function renderChrome(page) {
  const badge = { '': unreadCount(), bookings: unmarked().length };
  const tabOf = page === 'chat' ? '' : ['reviews', 'clients', 'payout', 'support', 'staff'].includes(page) ? 'more' : page === 'analytics' ? 'wash' : page;
  $('#tabbar').innerHTML = TABS.map(([id, label, ic]) => `<a href="#/${id}" ${tabOf === id ? 'aria-current="page"' : ''}>
    <span class="tab-ic">${icon(ic, 24)}${badge[id] ? `<span class="tab-count" aria-label="${id ? 'Записи без позначки' : 'Непрочитані'}: ${badge[id]}">${badge[id]}</span>` : ''}</span>${label}</a>`).join('');
  const p = place();
  const pw = powerOf(p.id);
  $('#top').innerHTML = `<a class="pro-brand" href="#/" aria-label="CarCar Business">${logo(30)}<span><b>${esc(p.name)}</b><small>CarCar Business${pw ? ` · ${POWER[pw.state][0].toLowerCase()}` : ''}</small></span></a>`;
  const fab = $('#fab');
  fab.hidden = !['', 'bookings', 'wash'].includes(page);
  fab.innerHTML = `${icon('plus', 22)}<span>Запис</span>`;
  fab.setAttribute('aria-label', 'Новий запис');
}

function pickWash(id) {
  ui.place = id;
  store.set('partner', id);
  const s = session();
  if (s && !s.demo) store.set('biz.session', { ...s, placeId: id });
}

function notFound() { return '<h1>Не знайдено</h1><p class="muted">Можливо, запис видалили. <a href="#/">До повідомлень</a></p>'; }

function route() {
  const s = session();
  document.body.classList.toggle('locked', !s);
  if (!s) {
    $('#view').innerHTML = viewLogin();
    $('#tabbar').innerHTML = '';
    $('#top').innerHTML = '';
    $('#fab').hidden = true;
    return;
  }
  // Поточна мийка — одна з мийок акаунта.
  const mine = accountPlaces(s);
  if (!mine.includes(ui.place)) ui.place = mine.includes(s.placeId) ? s.placeId : mine[0] ?? ui.place;
  for (const id of mine) touchPresence(id);
  if (expirePending(bookings)) save();
  checkWaitlist(bookings);
  const [, page = '', arg, id] = location.hash.replace(/^#/, '').split('/');
  // Пряме посилання на запис (зі сповіщення): відкриваємо день запису й картку.
  if (page === 'booking') {
    const b = bookings.find((x) => x.id === arg);
    if (b && accountPlaces(s).includes(b.placeId)) {
      if (b.placeId !== ui.place) pickWash(b.placeId);
      alerted.add(b.id);
      history.replaceState(null, '', `#/bookings/${b.date}`);
      route();
      bookingSheet(b.id);
      return;
    }
  }
  if (page === 'act') { alerted.add(id); history.replaceState(null, '', '#/'); route(); notifyAction(arg, id); return; }
  // Пішли з «Повідомлень» — пропущені дзвінки переглянуто.
  if (ui.lastView === '/' && page !== '') markCallsRead('place', (x) => x.placeId === ui.place);
  document.body.classList.toggle('in-chat', page === 'chat');
  renderChrome(page);
  const view = $('#view');
  if (page === '') view.innerHTML = viewMessages();
  else if (page === 'chat') view.innerHTML = viewThread(arg);
  else if (page === 'bookings') view.innerHTML = viewBookings(arg);
  else if (page === 'wash') view.innerHTML = viewWash();
  else if (page === 'profile') view.innerHTML = viewProfile();
  else if (page === 'more') view.innerHTML = viewMore();
  else if (page === 'reviews') view.innerHTML = viewReviews();
  else if (page === 'clients') view.innerHTML = viewClients();
  else if (page === 'staff') view.innerHTML = viewStaff();
  else if (page === 'payout') view.innerHTML = viewPayout();
  else if (page === 'support') view.innerHTML = viewSupport(arg);
  else if (page === 'analytics') view.innerHTML = viewAnalytics();
  else view.innerHTML = notFound();
  if (page === 'chat') {
    fitChatScreen();
    const list = $('.chat-msgs');
    if (list) {
      list.scrollTop = list.scrollHeight;
      for (const img of list.querySelectorAll('img')) img.addEventListener('load', () => { list.scrollTop = list.scrollHeight; }, { once: true });
    }
  }
  alertPending();
  const key = `${page}/${page === 'chat' ? arg : ''}`;
  if (key !== ui.lastView && page !== 'chat') window.scrollTo(0, 0);
  ui.lastView = key;
}

function rerender() {
  const y = window.scrollY;
  route();
  window.scrollTo(0, y);
}

// Нова знижка на години (одна на ті самі дні й години: стара вимикається).
function addQuietDeal(days, from, to, pct) {
  const deal = { id: uid(), active: true, createdAt: Date.now(), source: 'quiet', days, from, to, pct, services: [], until: null };
  const all = store.get('biz.deals', {});
  const same = (x) => x.source === 'quiet' && x.from === from && x.to === to && x.days.join() === days.join();
  store.set('biz.deals', { ...all, [ui.place]: [...(all[ui.place] ?? []).map((x) => (same(x) ? { ...x, active: false } : x)), deal] });
  rerender();
  toast(`Знижку −${pct}% увімкнено: ${daysText(days)}, ${hhmm(from)}–${hhmm(to)}. ${listed() ? 'Клієнти вже її бачать' : 'Клієнти побачать її після публікації мийки'}`);
}

// ---------- дії ----------

function markReady(b) {
  Object.assign(b, { photos: b.photos ?? [], doneAt: Date.now() });
  complete(b);
  save();
}

document.addEventListener('click', async (e) => {
  const el = e.target.closest('[data-action]');
  if (!el) return;
  const { action, id } = el.dataset;
  const b = id ? allMine().find((x) => x.id === id) ?? null : null;
  // Запис іншої мийки акаунта (наприклад, зі сповіщення) — перемикаємось на неї.
  if (b && b.placeId !== ui.place) pickWash(b.placeId);
  const gone = () => { closeSheet(); rerender(); toast('На цей запис уже відповіли або його скасовано'); };
  const fromMark = el.dataset.from === 'mark';
  const after = (text) => {
    save();
    rerender();
    // Зі списку «Чим закінчились записи» лишаємось у ньому, поки є що позначати.
    if (fromMark && unmarked().length) { markSheet(); toast(text); return; }
    closeSheet();
    toast(fromMark ? 'Усі записи позначено' : text);
  };

  if (action === 'sheet-close') { closeSheet(); return; }
  if (action === 'demo-login') { store.set('biz.session', { demo: true, at: Date.now() }); location.hash = '#/'; route(); runPendingAct(); return; }
  if (action === 'logout') {
    if (!confirm('Вийти з CarCar Business?')) return;
    store.set('biz.session', null);
    location.hash = '#/';
    route();
    return;
  }
  if (action === 'msg-filter') { ui.filter = el.dataset.f; rerender(); return; }
  if (action === 'quick') { sendTo($('#pro-chat').dataset.thread, el.dataset.text); return; }
  if (action === 'bk-open') { bookingSheet(id); return; }
  if (action === 'mark-open') { markSheet(); return; }
  if (action === 'nb-open') {
    const r = el.dataset.req ? ownRequests().find((x) => x.id === el.dataset.req) : null;
    nbOpen({
      ...(el.dataset.date ? { date: el.dataset.date } : {}), ...(el.dataset.time ? { want: el.dataset.time } : {}),
      ...(r ? { name: r.clientName ?? '', car: r.car ?? '', cls: r.cls ?? 0 } : {}),
    });
    return;
  }
  if (action === 'nb-cls') { nb.cls = Number(el.dataset.i); nbRender(); return; }
  if (action === 'nb-svc') { nb.services.has(el.dataset.id) ? nb.services.delete(el.dataset.id) : nb.services.add(el.dataset.id); nb.minutes = null; nbRender(); return; }
  if (action === 'nb-day') { nb.date = el.dataset.date; nb.time = ''; nbRender(); return; }
  if (action === 'nb-time') { nb.time = el.dataset.time; nbRender(); return; }
  if (action === 'sched-ok') {
    saveOverride(ui.place, { checkedAt: Date.now() });
    rerender();
    toast('Дякуємо! Клієнти бачать, що розклад перевірено сьогодні');
    return;
  }
  if (action === 'ready') {
    if (!fromMark && !confirm('Машина готова? Клієнт отримає сповіщення, і запис стане виконаним.')) return;
    markReady(b);
    after('Клієнт отримав сповіщення «Машина готова»');
    return;
  }
  if (action === 'accept') {
    // Є мийники — спершу обираємо, хто митиме.
    if (b?.state !== 'pending') { gone(); return; }
    if (washers().length) { washerSheet(b.id, 'accept'); return; }
    if (!acceptBooking(b)) { gone(); return; }
    save();
    closeSheet();
    rerender();
    toast(`Запис прийнято: ${who(b)}, ${dayWord(b.date).toLowerCase()} о ${b.time}`);
    return;
  }
  if (action === 'washer') { washerSheet(id, 'assign'); return; }
  if (action === 'call') {
    if (el.matches('.call-row')) markCallsRead('place', (x) => x.placeId === (el.dataset.place ?? ui.place));
    const r = el.dataset.req ? requests.find((x) => x.id === el.dataset.req) : null;
    const pid = b?.placeId ?? r?.placeId ?? el.dataset.place ?? ui.place;
    startCall({ bookingId: b?.id ?? null, reqId: r?.id ?? null, placeId: pid, placeName: placeById(pid)?.name ?? '', clientName: b ? who(b) : r?.clientName || el.dataset.name || 'Клієнт' });
    return;
  }
  if (action === 'dur') { durSheet(id); return; }
  if (action === 'washer-pick') {
    const m = el.dataset.m || null;
    if (el.dataset.mode === 'accept' && b?.state !== 'pending') { gone(); return; }
    b.masterId = m;
    const name = m ? washerName(m) : null;
    if (el.dataset.mode === 'accept') {
      acceptBooking(b);
      if (name) chatPost(b, 'sys', `Вашу машину митиме ${name}`, 'client');
      save();
      closeSheet();
      rerender();
      toast(`Запис прийнято${name ? `, мийник — ${name}` : ''}: ${who(b)}, ${dayWord(b.date).toLowerCase()} о ${b.time}`);
      return;
    }
    save();
    rerender();
    bookingSheet(b.id);
    toast(name ? `Мийник: ${name}` : 'Мийника знято із запису');
    return;
  }
  if (action === 'nb-washer') { nb.masterId = el.dataset.m || null; nbRender(); return; }
  if (action === 'washer-del') {
    const x = staffOf(ui.place).find((w) => w.id === id);
    if (!confirm(`Прибрати ${x.name} зі списку мийників? Минулі записи збережуться.`)) return;
    saveWashers(staffOf(ui.place).map((w) => (w.id === id ? { ...w, active: false } : w)));
    rerender();
    toast(`${x.name} більше не в списку`);
    return;
  }
  if (['decline', 'propose', 'propose-day', 'propose-to'].includes(action) && b?.state !== 'pending') { gone(); return; }
  if (action === 'decline') { declineSheet(id); return; }
  if (action === 'propose') { proposeSheet(id); return; }
  if (action === 'propose-day') { proposeSheet(id, el.dataset.date); return; }
  if (action === 'propose-to') {
    if (!proposeStarts(b, el.dataset.date).includes(el.dataset.time)) { toast('Цей час щойно зайняли — оберіть інший'); proposeSheet(id, el.dataset.date); return; }
    if (!proposeTime(b, el.dataset.date, el.dataset.time, ($('#propose-note')?.value ?? '').trim())) { gone(); return; }
    save();
    closeSheet();
    rerender();
    toast(`Клієнту запропоновано ${dayWord(b.date).toLowerCase()} о ${b.time}`);
    return;
  }
  if (action === 'notify-on') {
    const res = await Notification.requestPermission();
    rerender();
    toast(res === 'granted' ? 'Сповіщення ввімкнено' : 'Сповіщення заборонені в налаштуваннях браузера');
    return;
  }
  if (action === 'mark-done') {
    Object.assign(b, { state: 'completed', payment: 'card', completedAt: Date.now() });
    after('Запис виконано');
    return;
  }
  if (action === 'crm-noshow' || action === 'crm-cancel') {
    if (!fromMark && !confirm(action === 'crm-noshow' ? 'Позначити, що клієнт не приїхав?' : 'Скасувати запис? Час знову стане вільним для клієнтів.')) return;
    b.state = action === 'crm-noshow' ? 'noshow' : 'cancelled';
    b.closedAt = Date.now();
    after(action === 'crm-noshow' ? 'Позначено неявку' : 'Запис скасовано, час вільний');
    return;
  }
  if (action === 'carcar-noshow') {
    if (Date.now() < noShowFrom(b)) { toast(`Неявку можна позначити з ${clock(noShowFrom(b))}`); return; }
    const placeAmount = Math.round(price(b) * PAYMENT.noShowShare);
    if (!confirm(`Позначити неявку? Клієнт не скасував запис вчасно, тож оплата ${uah(placeAmount)} зараховується вам. ${PAYMENT.freezeHours} год гроші чекають на випадок спору.`)) return;
    if (!markNoShow(b)) { gone(); return; }
    after('Позначено неявку');
    return;
  }
  if (action === 'late-forfeit') {
    if (Date.now() < noShowFrom(b)) { toast(`Позначити запізнення можна з ${clock(noShowFrom(b))}`); return; }
    if (!confirm(`Клієнт запізнюється понад ${PAYMENT.lateMinutes} хв: зарахувати оплату ${uah(price(b))} вам і закрити запис?`)) return;
    if (!markNoShow(b, true)) { gone(); return; }
    sendMessages([{ placeId: b.placeId, clientKey: 'device', channel: 'app', kind: 'late', bookingId: b.id, link: `#/bookings/${b.id}`,
      text: `${place().name}: ви запізнилися більше ніж на ${PAYMENT.lateMinutes} хв, тому візит вважається неявкою — оплату зараховано мийці. Якщо це помилка, напишіть у підтримку.` }]);
    after(`Оплату ${uah(price(b))} зараховано вам`);
    return;
  }
  if (action === 'move') { moveSheet(id); return; }
  if (action === 'move-day') { moveSheet(id, el.dataset.date); return; }
  if (action === 'move-to') {
    if (!openStarts(place(), el.dataset.date, b.minutes, bookings, { lead: 0, skip: b }).includes(el.dataset.time)) { toast('Цей час щойно зайняли — оберіть інший'); moveSheet(id, el.dataset.date); return; }
    b.moves = [...(b.moves ?? []), { date: b.date, time: b.time, at: Date.now(), by: 'place' }];
    const from = `${dayWord(b.date).toLowerCase()}, ${b.time}`;
    Object.assign(b, { date: el.dataset.date, time: el.dataset.time });
    // Нагадування й «Їду» стосувалися старого часу; клієнт бачить новий час у чаті запису.
    for (const k of ['remindDay', 'remind2h', 'eta', 'late', 'etaAt']) delete b[k];
    if (isCarcar(b)) chatPost(b, 'sys', `Мийка перенесла запис з ${from} на ${dayWord(b.date).toLowerCase()}, ${b.time}`, 'client');
    after(`Перенесено на ${dayWord(b.date).toLowerCase()}, ${b.time}`);
    return;
  }
  if (action === 'day-close') {
    const date = el.dataset.date;
    const left = own().filter((x) => x.date === date && BLOCKING.includes(x.state)).length;
    if (!confirm(`Закрити ${dayWord(date, true).toLowerCase()} для запису?${left ? ` Уже є ${left} ${plural(left, 'запис', 'записи', 'записів')} — вони залишаться, повідомте клієнтів.` : ''}`)) return;
    const s = scheduleOf(place());
    s.special[date] = null;
    saveOverride(ui.place, { schedule: s });
    rerender();
    toast('День закрито — клієнти не зможуть записатися');
    return;
  }
  if (action === 'day-hours') { dayHoursSheet(el.dataset.date); return; }
  if (action === 'special-del') {
    const s = scheduleOf(place());
    delete s.special[el.dataset.date];
    saveOverride(ui.place, { schedule: s });
    rerender();
    toast('Повернуто звичайний графік');
    return;
  }
  if (action === 'power') {
    setPower(ui.place, el.dataset.k);
    rerender();
    toast(seen('Клієнти бачать оновлений статус'));
    return;
  }
  if (action === 'svc-edit') { serviceSheet(id); return; }
  if (action === 'wash-add') { addWashSheet(); return; }
  if (action === 'publish') {
    const pt = partnerOf(ui.place);
    if (pt.status !== 'setup') return;
    savePartner(ui.place, { status: 'approved', publishedAt: Date.now(), history: [...pt.history, { at: Date.now(), by: 'place', status: 'approved', note: 'Мийка опублікувала профіль' }] });
    rerender();
    toast('Мийка в каталозі — клієнти вже можуть записатися');
    return;
  }
  if (action === 'resubmit') {
    const pt = partnerOf(ui.place);
    if (!['changes', 'rejected'].includes(pt.status)) return;
    savePartner(ui.place, { status: 'pending', history: [...pt.history, { at: Date.now(), by: 'place', status: 'pending', note: 'Дані виправлено, надіслано на перевірку' }] });
    rerender();
    toast('Надіслано — CARCAR перевірить до 2 робочих днів');
    return;
  }
  if (action === 'an-period') { ui.anPeriod = Number(el.dataset.n); rerender(); return; }
  if (action === 'quiet-on') {
    const pct = Number(document.querySelector(`input[name="${el.dataset.pick}"]:checked`)?.value ?? el.dataset.pct);
    addQuietDeal(el.dataset.days.split(',').map(Number), Number(el.dataset.from), Number(el.dataset.to), pct);
    return;
  }
  if (action === 'deal-off') {
    const all = store.get('biz.deals', {});
    store.set('biz.deals', { ...all, [ui.place]: (all[ui.place] ?? []).map((x) => (x.id === id ? { ...x, active: false } : x)) });
    rerender();
    toast('Знижку вимкнено');
    return;
  }
  if (action === 'review-report') {
    const reason = prompt('Чому відгук порушує правила? Модератор CARCAR перевірить.', 'Клієнт не був на мийці');
    if (!reason?.trim()) return;
    reviews.find((x) => x.id === id).report = { reason: reason.trim(), at: Date.now(), status: 'open' };
    save();
    rerender();
    toast('Скаргу надіслано модератору');
    return;
  }
  if (action === 'nb-client') {
    const c = clientsList().find((x) => x.key === el.dataset.key);
    nbOpen({ name: c?.name ?? '', phone: c?.phone ?? '', car: c?.car ?? '', cls: c?.cls ?? 0 });
    return;
  }
  if (action === 'wash-pick') { pickWash(id); rerender(); toast(`Мийка: ${place().name}`); return; }
  if (action === 'ava-del') { savePhotos({ avatar: null }, 'Аватар прибрано'); return; }
  if (action === 'photo-del' || action === 'photo-first') {
    const photos = [...(place().photos ?? [])];
    const [x] = photos.splice(Number(el.dataset.i), 1);
    if (action === 'photo-first') photos.unshift(x);
    savePhotos({ photos }, action === 'photo-del' ? 'Фото видалено' : 'Обкладинку змінено');
    return;
  }
  if (action === 'svc-new') { serviceSheet(null, el.dataset.req || null); return; }
  if (action === 'svc-del') {
    if (!confirm('Видалити послугу з прайсу?')) return;
    const rest = place().allServices.filter((x) => x.id !== id);
    if (!rest.some((x) => !x.off)) { toast('Залиште хоча б одну активну послугу'); return; }
    saveOverride(ui.place, { services: rest });
    closeSheet();
    rerender();
    toast('Послугу видалено');
    return;
  }
  if (action === 'req-close') {
    const r = ownRequests().find((x) => x.id === id);
    r.closed = true;
    save();
    location.hash = '#/';
    toast('Питання закрито');
    return;
  }
  if (action === 'payout') {
    const { available } = balanceFor(ui.place, bookings, payouts);
    const fee = Math.round(available * commissionFor(ui.place));
    const iban = maskIban(partnerOf(ui.place).payout.iban);
    if (!confirm(`Вивести ${uah(available)}? Комісія ${uah(fee)}, на рахунок ${iban} надійде ${uah(available - fee)}.`)) return;
    payouts.push({ id: uid(), placeId: ui.place, gross: available, fee, net: available - fee, at: Date.now(), iban });
    save();
    rerender();
    toast(`Виплату відправлено на рахунок ${iban}`);
    return;
  }
  if (action === 'demo-seed') demoSeed();
});

document.addEventListener('input', (e) => {
  if (e.target.id === 'client-q') {
    ui.clientQ = e.target.value;
    rerender();
    const q = $('#client-q');
    q.focus();
    q.setSelectionRange(q.value.length, q.value.length);
    return;
  }
  const f = e.target.form;
  if (f?.id !== 'nb-form' || !nb) return;
  const { name, value } = e.target;
  if (name === 'phone') { nb.phone = value; nbHint(); } else if (name === 'name') nb.name = value;
  else if (name === 'car') nb.car = value;
});

document.addEventListener('change', async (e) => {
  if (e.target.name === 'photos' && e.target.closest('form')?.querySelector('.photo-count')) {
    const n = Math.min(e.target.files.length, 3);
    e.target.closest('form').querySelector('.photo-count').textContent = n ? ` · обрано: ${n}` : '';
    return;
  }
  if (e.target.id === 'pf-avatar' || e.target.id === 'pf-photos') {
    const files = [...e.target.files];
    if (!files.length) return;
    const p = place();
    if (e.target.id === 'pf-avatar') {
      const avatar = await shrinkPhoto(files[0]);
      if (avatar) savePhotos({ avatar }, seen('Аватар оновлено — клієнти вже бачать його'));
      else toast('Не вдалося відкрити фото');
      return;
    }
    const add = (await Promise.all(files.slice(0, MAX_PHOTOS - (p.photos?.length ?? 0)).map(shrinkPhoto))).filter(Boolean);
    if (add.length) savePhotos({ photos: [...(p.photos ?? []), ...add] }, `Додано ${add.length} ${plural(add.length, 'фото', 'фото', 'фото')}`);
    return;
  }
  if (e.target.id === 'auto-confirm') {
    setAutoConfirm(ui.place, e.target.checked);
    rerender();
    toast(e.target.checked ? 'Записи прийматимуться автоматично' : 'Тепер кожен запис підтверджуєте ви');
    return;
  }
  if (e.target.matches('.pct-row input')) {
    const btn = e.target.closest('.suggest-item')?.querySelector('[data-action="quiet-on"]');
    if (btn) btn.textContent = `Увімкнути −${e.target.value}%`;
    return;
  }
  if (e.target.id === 'nb-dur') { nb.minutes = Number(e.target.value); nbRender(); return; }
  if (e.target.form?.id === 'nb-form' && e.target.name === 'channel') {
    nb.channel = e.target.value;
    if (nb.channel === 'walkin') nb.date = todayIso();
    nb.time = '';
    nbRender();
    return;
  }
  if (e.target.id === 'pro-attach') {
    const file = e.target.files[0];
    if (!file) return;
    const photo = await shrinkPhoto(file);
    if (!photo) { toast('Не вдалося відкрити фото'); return; }
    sendTo($('#pro-chat').dataset.thread, $('#pro-chat [name="text"]').value.trim(), photo);
  }
});

document.addEventListener('submit', async (e) => {
  const f = e.target;
  e.preventDefault();
  const d = new FormData(f);
  if (f.id === 'pro-login') {
    const acc = await checkBizLogin(String(d.get('login')), String(d.get('password')));
    if (!acc || !placeById(acc.placeId)) { $('#view').innerHTML = viewLogin('Невірний логін або пароль.'); $('#pro-login [name="login"]').value = String(d.get('login')); return; }
    store.set('biz.session', { login: acc.login, placeId: acc.placeId, at: Date.now() });
    ui.place = acc.placeId;
    store.set('partner', ui.place);
    location.hash = '#/';
    route();
    runPendingAct();
    return;
  }
  if (f.id === 'pro-chat') {
    const text = String(d.get('text')).trim();
    if (text) sendTo(f.dataset.thread, text);
    return;
  }
  if (f.id === 'nb-form') { nbSubmit(); return; }
  if (f.id === 'deal-form') {
    const days = d.getAll('day').map(Number);
    const from = Number(d.get('from'));
    const to = Number(d.get('to'));
    if (!days.length) { toast('Оберіть хоча б один день'); return; }
    if (to <= from) { toast('Кінець має бути пізніше за початок'); return; }
    addQuietDeal(days, from, to, Number(d.get('pct')));
    return;
  }
  if (f.id === 'dur-form') {
    const b = own().find((x) => x.id === f.dataset.id);
    const m = Number(d.get('minutes'));
    if (!b || !DUR_EDIT.includes(b.state)) { closeSheet(); rerender(); toast('Запис уже змінився'); return; }
    if (m > b.minutes && !boxFree(b.date, toMin(b.time), m, b)) { toast('На цей час не вистачає вільного боксу або мийка вже закрита'); return; }
    const was = b.minutes;
    b.minutes = m;
    if (isCarcar(b) && m !== was) chatPost(b, 'sys', `Мийка уточнила тривалість: ${b.time}–${hhmm(toMin(b.time) + m)}`, 'client');
    save();
    rerender();
    bookingSheet(b.id);
    toast(`Тривалість: ${duration(m)} — графік оновлено`);
    return;
  }
  if (f.id === 'decline-form') {
    const b = own().find((x) => x.id === f.dataset.id);
    const note = String(d.get('note')).trim();
    if (!b || !declineBooking(b, String(d.get('reason')))) { closeSheet(); rerender(); toast('На цей запис уже відповіли або його скасовано'); return; }
    if (note) chatPost(b, 'biz', note, 'client');
    save();
    closeSheet();
    rerender();
    toast('Відмовлено, клієнт отримав гроші назад');
    return;
  }
  if (f.id === 'ready-form') {
    const b = own().find((x) => x.id === f.dataset.id);
    const photos = (await Promise.all(d.getAll('photos').filter((x) => x?.size).slice(0, 3).map(shrinkPhoto))).filter(Boolean);
    Object.assign(b, { photos, note: String(d.get('note')).trim() || null, km: Number(d.get('km')) || null, doneAt: Date.now() });
    complete(b);
    // Фото не вмістилися в памʼять пристрою — зберігаємо запис без них.
    if (!store.set('bookings', bookings) && photos.length) { b.photos = []; save(); } else save();
    closeSheet();
    rerender();
    toast('Клієнт отримав сповіщення «Машина готова»');
    return;
  }
  if (f.id === 'done-form') {
    const b = own().find((x) => x.id === f.dataset.id);
    Object.assign(b, { state: 'completed', payment: d.get('payment'), paid: Number(d.get('paid')) || 0, completedAt: Date.now() });
    save();
    closeSheet();
    rerender();
    toast('Запис виконано й оплачено');
    return;
  }
  if (f.matches('.rev-reply')) {
    const r = reviews.find((x) => x.id === f.dataset.id);
    const text = String(d.get('reply')).trim();
    if (!text) { toast('Напишіть відповідь'); return; }
    r.reply = { text, at: Date.now() };
    save();
    rerender();
    toast('Відповідь опубліковано на сторінці мийки');
    return;
  }
  if (f.id === 'washer-form') {
    const name = String(d.get('name')).trim();
    if (!name) return;
    const pct = Math.min(100, Math.max(0, Number(d.get('pct')) || 0));
    saveWashers([...staffOf(ui.place), { id: uid(), name, phone: String(d.get('phone')).trim(), role: 'master', pct: pct || null, active: true, createdAt: Date.now() }]);
    rerender();
    toast(`${name} додано до мийників`);
    return;
  }
  if (f.id === 'payout-form') {
    const iban = normIban(d.get('iban'));
    const code = String(d.get('code')).replace(/\D/g, '');
    if (!ibanValid(iban)) { toast('Перевірте IBAN: UA і 27 цифр'); return; }
    if (!codeValid(code.length === 8 ? 'tov' : 'fop', code)) { toast('Перевірте РНОКПП чи ЄДРПОУ'); return; }
    const old = partnerOf(ui.place).payout ?? {};
    const holder = String(d.get('holder')).trim();
    const changed = normIban(old.iban) !== iban || old.holder !== holder || old.code !== code;
    savePartner(ui.place, { payout: { iban, holder, code, verified: changed ? false : !!old.verified } });
    rerender();
    toast(changed ? 'Рахунок надіслано на перевірку CARCAR' : 'Нічого не змінилося');
    return;
  }
  if (f.id === 'ticket-form' || f.id === 'ticket-reply' || f.id === 'dispute-note') {
    const text = String(d.get('text')).trim();
    const photos = (await Promise.all(d.getAll('photos').filter((x) => x?.size).slice(0, 3).map(shrinkPhoto))).filter(Boolean);
    if (!text && !photos.length) { toast('Напишіть повідомлення'); return; }
    if (f.id === 'ticket-reply') {
      ticketReply(f.dataset.id, 'place', text || 'Фото', undefined, photos);
      rerender();
      toast('Надіслано в підтримку');
      return;
    }
    const b = bookings.find((x) => x.id === (f.id === 'dispute-note' ? f.dataset.id : d.get('booking')));
    const t = openTicket({ from: 'place', placeId: ui.place, bookingId: b?.id ?? null, topic: f.id === 'dispute-note' ? 'dispute' : d.get('topic'), text, clientName: b ? who(b) : '', photos });
    closeSheet();
    location.hash = `#/support/${t.id}`;
    toast(`Звернення №${t.no} надіслано в CARCAR`);
    return;
  }
  if (f.id === 'wash-form') {
    const id = addAccountPlace(session(), { name: String(d.get('name')).trim(), city: d.get('city'), address: String(d.get('address')).trim(), phone: String(d.get('phone')).trim(), boxes: d.get('boxes') });
    applyOverrides();
    pickWash(id);
    closeSheet();
    location.hash = '#/profile';
    toast('Мийку додано — заповніть профіль, графік і ціни, поки CARCAR її перевіряє');
    return;
  }
  if (f.id === 'pf-info') {
    const name = String(d.get('name')).trim();
    const address = String(d.get('address')).trim();
    if (!name || !address) { toast('Вкажіть назву й адресу'); return; }
    saveOverride(ui.place, { name, address, about: String(d.get('about')).trim() });
    rerender();
    toast(seen('Збережено — клієнти бачать оновлений профіль'));
    return;
  }
  if (f.id === 'pf-main') {
    saveOverride(ui.place, { phone: String(d.get('phone')).trim(), boxes: Math.max(1, Number(d.get('boxes')) || 1) });
    rerender();
    toast(seen('Збережено — клієнти бачать нові дані'));
    return;
  }
  if (f.id === 'pf-hours') {
    const week = WEEKDAYS.map((_, i) => (d.get(`on-${i}`) ? [Number(d.get(`o-${i}`)), Number(d.get(`c-${i}`))] : null));
    const bad = week.findIndex((h) => h && h[1] <= h[0]);
    if (bad >= 0) { toast(`${WEEKDAY_NAMES[bad]}: закриття має бути пізніше за відкриття`); return; }
    if (!week.some(Boolean)) { toast('Позначте хоча б один робочий день'); return; }
    const brk = d.get('brk-on') ? [Number(d.get('brk-o')), Number(d.get('brk-c'))] : null;
    if (brk && brk[1] <= brk[0]) { toast('Кінець перерви має бути пізніше за початок'); return; }
    const s = scheduleOf(place());
    saveOverride(ui.place, { schedule: { week, brk, special: s.special, horizon: Number(d.get('horizon')), lead: Number(d.get('lead')) } });
    rerender();
    toast(seen('Графік збережено — клієнти бачать новий вільний час'));
    return;
  }
  if (f.id === 'day-form') {
    const h = [Number(d.get('o')), Number(d.get('c'))];
    if (h[1] <= h[0]) { toast('Закриття має бути пізніше за відкриття'); return; }
    const s = scheduleOf(place());
    s.special[f.dataset.date] = h;
    saveOverride(ui.place, { schedule: s });
    closeSheet();
    rerender();
    toast(`${dayWord(f.dataset.date, true)}: ${rangeText(h)}`);
    return;
  }
  if (f.id === 'svc-form') {
    const svc = {
      name: String(d.get('name')).trim(), min: Math.round(Number(d.get('min'))),
      price: [0, 1, 2].map((i) => Math.round(Number(d.get(`p${i}`)))),
    };
    if (!svc.name || svc.min <= 0 || svc.price.some((v) => !(v > 0))) { toast('Перевірте назву, тривалість і ціни'); return; }
    const p = place();
    let all;
    if (f.dataset.id) {
      all = p.allServices.map((x) => (x.id === f.dataset.id ? { ...x, ...svc, off: !d.get('on') } : x));
      if (!all.some((x) => !x.off)) { toast('Залиште хоча б одну активну послугу'); return; }
    } else {
      all = [...p.allServices, { id: `c_${uid()}`, cat: p.cats[0] ?? 'wash', ...svc }];
    }
    saveOverride(ui.place, { services: all });
    const r = f.dataset.req ? ownRequests().find((x) => x.id === f.dataset.req) : null;
    if (r) {
      r.messages.push({ from: 'biz', text: `Додали послугу «${svc.name}» — від ${uah(Math.min(...svc.price))}. Можна записатися в застосунку.`, at: Date.now() });
      Object.assign(r, { service: { name: svc.name, price: svc.price[0], min: svc.min, personal: false, at: Date.now() }, unreadClient: true });
      save();
    }
    closeSheet();
    rerender();
    toast(r ? 'Послугу додано, клієнт отримав відповідь' : seen('Прайс збережено — клієнти вже бачать нові ціни'));
  }
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && $('#sheet-root').innerHTML) closeSheet();
});

// Інша вкладка (застосунок клієнта, повна панель) змінила дані — підтягуємо, не збиваючи введення.
window.addEventListener('storage', (e) => {
  if (!e.key?.startsWith('carcar.')) return;
  load();
  checkSheet();
  if (nb || document.body.classList.contains('sheet-open')) { renderChrome(location.hash.split('/')[1] ?? ''); alertPending(); return; }
  const input = $('#pro-chat [name="text"]');
  const draft = input?.value ?? '';
  const focused = document.activeElement === input;
  if (document.activeElement?.matches('input, textarea, select') && !focused) { renderChrome(location.hash.split('/')[1] ?? ''); alertPending(); return; }
  rerender();
  const again = $('#pro-chat [name="text"]');
  if (again) { again.value = draft; if (focused) again.focus(); }
});

// Перехід між екранами закриває шторки — крім сповіщення про новий запис: воно чекає відповіді.
window.addEventListener('hashchange', () => { if (nb || ($('#sheet-root').innerHTML && !$('.pro-sheet.alert'))) closeSheet(); route(); });
setInterval(() => { const s = session(); if (s) for (const id of accountPlaces(s)) touchPresence(id); }, 30000);

// Щосекунди: зворотний відлік на відповідь; час минув — запис скасовується, екран оновлюється.
setInterval(() => {
  const timers = document.querySelectorAll('[data-due]');
  if (!timers.length) return;
  for (const el of timers) el.textContent = leftText(Number(el.dataset.due));
  if ([...timers].some((el) => Number(el.dataset.due) <= Date.now()) && expirePending(bookings)) {
    save();
    if ($('.pro-sheet.alert') || $('#decline-form')) closeSheet();
    else checkSheet();
    rerender();
    toast('Час на підтвердження минув — запис скасовано, гроші повернуто клієнту');
  }
}, 1000);

// Кнопки системного сповіщення: service worker передає дію відкритому застосунку.
// Повернулись у застосунок з відкритим чатом — позначаємо прочитане.
document.addEventListener('visibilitychange', () => { if (!document.hidden && location.hash.startsWith('#/chat/') && !$('#sheet-root').innerHTML) rerender(); });

navigator.serviceWorker?.addEventListener('message', (e) => {
  if (e.data?.type === 'pending-action') { load(); notifyAction(e.data.action, e.data.id); }
});
keepChatOnKeyboard();
// Вхідні дзвінки клієнтів CARCAR — у будь-яку мийку акаунта.
initCalls('place', (c) => c.from === 'client' && !!session() && accountPlaces(session()).includes(c.placeId), { onLog: (c) => logCall(bookings, c, save) });
route();

if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
