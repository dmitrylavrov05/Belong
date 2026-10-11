// CarCar Business — окремий застосунок мийки для телефона.
// Головне під пальцем: повідомлення клієнтів, записи по днях, показники мийки й профіль, який бачать клієнти.
// Дані спільні із застосунком клієнта (на цьому пристрої — localStorage): запис, внесений тут, одразу
// займає час, а закритий день чи нові години клієнти бачать при наступному відкритті сторінки мийки.
import { CAR_CLASSES, PLACES, PAYMENT } from './data.js';
import {
  store, icon, esc, uah, hhmm, toMin, isoDate, parseDate, uid, placeById, plural, duration, dayLabel, rating, fmtTime,
  bookingStart, hoursFor, scheduleOf, rangeText, WEEKDAYS, WEEKDAY_NAMES, phoneKey, applyOverrides, saveOverride, shrinkPhoto, inBreak,
  ACTIVE, BLOCKING, isCarcar, price, complete, isFrozen, balanceFor, settleAll, ratingFor, partnerOf, PARTNER_STATUS,
  payoutReady, maskIban, commissionFor, checkBizLogin, numberBookings, bookingNo, POWER, powerOf, setPower,
} from './core.js';
import { openStarts, chatPost, chatTimeline, readMessages, msgPreview, touchPresence, BIZ_QUICK, sendMessages, checkWaitlist } from './ops.js';

// ---------- дані ----------

let bookings, payouts, reviews, requests;

function load() {
  bookings = store.get('bookings', []);
  payouts = store.get('payouts', []);
  reviews = store.get('reviews', []);
  requests = store.get('requests', []); // «не знайшов послугу» — повідомлення мийці зі сторінки точки
  applyOverrides();
  if (settleAll(bookings)) save();
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

const REQ_STATE = { new: ['Новий запит', 'warn'], answered: ['Відповіли', 'carcar'], added: ['Послугу додано', 'ok'], closed: ['Закрито', 'muted'] };
const reqState = (r) => (r.closed ? 'closed' : r.service ? 'added' : r.messages.at(-1).from === 'client' ? 'new' : 'answered');
const ownRequests = () => requests.filter((r) => r.placeId === ui.place);

// Записи, які вже минули, але мийка не позначила, чим вони закінчились.
const unmarked = () => own().filter((b) => (b.state === 'paid' || b.state === 'booked') && isPast(b)).sort((a, b) => bookingStart(a) - bookingStart(b));
const unreadCount = () => own().filter((b) => b.chatUnreadBiz).length + ownRequests().filter((r) => r.unreadBiz).length;

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
function freeWindows(date) {
  const p = place();
  const h = hoursFor(p, date);
  if (!h || date < todayIso()) return [];
  const from = date === todayIso() ? Math.ceil(minuteNow() / 30) * 30 : h[0];
  const out = [];
  for (let t = Math.max(h[0], from); t + 30 <= h[1]; t += 30) {
    if (!boxFree(date, t, 30)) continue;
    const last = out.at(-1);
    if (last && last[1] === t) last[1] = t + 30;
    else out.push([t, t + 30]);
  }
  return out;
}
const windowsText = (list) => list.map(([s, e]) => `${hhmm(s)}–${hhmm(e)}`).join(', ');

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

function reminders() {
  const out = [];
  const st = partnerOf(ui.place).status;
  if (st !== 'approved') out.push(`<p class="notice warn">Клієнти ще не бачать мийку: статус «${PARTNER_STATUS[st][0]}». <a href="business.html#/connect">Завершити підключення</a></p>`);
  const late = unmarked();
  if (late.length) {
    out.push(`<button class="remind warn" type="button" data-action="mark-open">${icon('warn', 22)}<span><b>${late.length} ${plural(late.length, 'запис чекає', 'записи чекають', 'записів чекають')} позначки</b>
      <small>Позначте, хто приїхав, а хто ні: так гроші надійдуть вчасно, а клієнти бачать правдивий розклад.</small></span>${icon('chevR', 18)}</button>`);
  }
  const h = hoursFor(place(), todayIso());
  if (h && !checkedToday()) {
    const free = freeWindows(todayIso());
    out.push(`<section class="remind sched" aria-label="Перевірка розкладу">${icon('calendar', 22)}<span><b>Розклад на сьогодні правильний?</b>
      <small>${free.length ? `Клієнти бачать вільним: ${windowsText(free)}.` : 'Вільного часу на сьогодні вже немає.'} Якщо когось записали по телефону чи він приїхав сам, додайте запис, щоб цей час не продали двічі.</small>
      <span class="row"><button class="btn navy" type="button" data-action="sched-ok">Так, усе вірно</button><button class="btn" type="button" data-action="nb-open">${icon('plus', 16)}Додати запис</button></span></span></section>`);
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
  return [...bk, ...rq].sort((a, b) => (b.unread - a.unread) || (b.live - a.live) || (b.at - a.at));
}

const MSG_FILTERS = [['all', 'Усі'], ['new', 'Нові'], ['booking', 'За записами'], ['request', 'Питання']];

function viewMessages() {
  const all = threads();
  const pass = (t) => (ui.filter === 'all' ? true : ui.filter === 'new' ? t.unread : t.kind === ui.filter);
  const list = all.filter(pass);
  const count = (f) => all.filter((t) => (f === 'all' ? true : f === 'new' ? t.unread : t.kind === f)).length;
  return `<h1>Повідомлення</h1>
    ${reminders()}
    <div class="chips" role="group" aria-label="Які повідомлення показати">${MSG_FILTERS.map(([f, label]) => `<button class="chip" type="button" data-action="msg-filter" data-f="${f}" aria-pressed="${ui.filter === f}">${label}${count(f) ? ` · ${count(f)}` : ''}</button>`).join('')}</div>
    ${list.length ? `<ul class="convos pro-convos">${list.map((t) => `<li><a class="convo${t.unread ? ' unread' : ''}${t.live ? '' : ' over'}" href="#/chat/${t.id}">
      <span class="avatar${t.kind === 'request' ? ' req' : ''}" aria-hidden="true">${firstLetter(t.name)}</span>
      <span class="convo-body"><span class="convo-top"><b>${esc(t.name)}</b><time>${whenShort(t.at)}</time></span>
        <span class="convo-text">${esc(t.text.length > 80 ? `${t.text.slice(0, 80).trimEnd()}…` : t.text)}</span>
        <span class="convo-meta"><span class="pill ${t.cls}">${t.label}</span><small>${esc(t.sub)}</small></span></span>
      ${t.unread ? '<span class="dot" aria-label="Нове повідомлення"></span>' : ''}</a></li>`).join('')}</ul>`
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

function chatHead(name, sub, phone) {
  return `<header class="chat-head">
      <a class="icon-btn" href="#/" aria-label="До повідомлень">${icon('chevL', 24)}</a>
      <span class="avatar" aria-hidden="true">${firstLetter(name)}</span>
      <div class="chat-who"><h1>${esc(name)}</h1><small>${sub}</small></div>
      ${phone ? `<a class="icon-btn" href="${telHref(phone)}" aria-label="Зателефонувати клієнту">${icon('phone', 20)}</a>` : ''}
    </header>`;
}

function viewThread(arg = '') {
  const id = arg.slice(2);
  if (arg.startsWith('b-')) {
    const b = own().find((x) => x.id === id);
    if (!b) return notFound();
    const seen = readMessages(b.chat, 'client');
    if (b.chatUnreadBiz || seen) { b.chatUnreadBiz = false; save(); }
    const [label] = stateOf(b);
    const open = ACTIVE.includes(b.state);
    return `<section class="chat-screen" aria-label="Чат з ${esc(who(b))}">
      ${chatHead(who(b), `${label} · ${dayWord(b.date)}, ${b.time}`, b.clientPhone)}
      <button class="chat-pin" type="button" data-action="bk-open" data-id="${b.id}">${icon('calendar', 16)}<span>${b.no ? `${bookingNo(b)} · ` : ''}${esc(b.services.join(', '))} · ${uah(sumOf(b))}${b.car ? ` · ${esc(b.car)}` : ''}</span>${icon('chevR', 16)}</button>
      ${b.state === 'paid' ? `<div class="chat-actions"><button class="btn navy" type="button" data-action="ready" data-id="${b.id}">${icon('check', 18)}Машина готова</button></div>` : ''}
      <ol class="chat-msgs" aria-label="Повідомлення">${threadList(chatTimeline(b))}</ol>
      ${open ? compose(arg, true) : '<p class="chat-closed">Запис закрито — листування лише для читання.</p>'}
    </section>`;
  }
  const r = ownRequests().find((x) => x.id === id);
  if (!r) return notFound();
  const seen = readMessages(r.messages, 'client');
  if (r.unreadBiz || seen) { r.unreadBiz = false; save(); }
  const [label] = REQ_STATE[reqState(r)];
  const open = !r.closed;
  return `<section class="chat-screen" aria-label="Чат з ${esc(r.clientName || 'клієнтом')}">
    ${chatHead(r.clientName || 'Клієнт', `${label}${r.car ? ` · ${esc(r.car)}` : ''}`, r.clientPhone)}
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
      <small>${esc(b.services.join(', '))}</small>${b.car ? `<small>${esc(b.car)}</small>` : ''}</span>
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
  // Вільні вікна ділимо на початках записів, щоб стрічка читалась по порядку.
  const cuts = list.filter((b) => BLOCKING.includes(b.state)).map((b) => toMin(b.time));
  const free = freeWindows(day).flatMap(([s, e]) => {
    const pts = [s, ...cuts.filter((c) => c > s && c < e), e].sort((a, b) => a - b);
    return pts.slice(1).map((x, i) => [pts[i], x]).filter(([a, b]) => b > a);
  });
  // Записи й вільні вікна однією стрічкою за часом.
  const items = [...list.map((b) => [toMin(b.time), bookingRow(b), 0]),
    ...free.map(([s, e]) => [s, `<li><button class="free-row" type="button" data-action="nb-open" data-date="${day}" data-time="${hhmm(s)}">
      <span class="bk-time"><b>${hhmm(s)}</b><small>${hhmm(e)}</small></span><span class="free-text">Вільно ${duration(e - s)}</span><span class="free-add">${icon('plus', 16)}Записати</span></button></li>`, 1]),
  ].sort((a, b) => a[0] - b[0] || a[2] - b[2]).map(([, html]) => html).join('');
  const busy = list.filter((b) => BLOCKING.includes(b.state)).length;
  const special = day in scheduleOf(p).special;
  return `<h1>Записи</h1>
    ${reminders()}
    <nav class="day-strip" aria-label="Дні">${days.map((d) => {
      const n = live(d);
      const closed = !hoursFor(p, d);
      return `<a href="#/bookings/${d}" class="${closed ? 'closed' : ''}" ${d === day ? 'aria-current="date"' : ''}><small>${d === t ? 'Сьогодні' : WEEKDAYS[(parseDate(d).getDay() + 6) % 7]}</small><b>${parseDate(d).getDate()}</b><span class="n">${closed ? 'вихідний' : n ? `${n} ${plural(n, 'запис', 'записи', 'записів')}` : 'вільно'}</span></a>`;
    }).join('')}</nav>
    <div class="day-head"><div><h2>${dayWord(day, true)}</h2>
      <p class="small muted">${h ? `${rangeText(h)}${special ? ' (змінено на цей день)' : ''} · ${p.boxes} ${plural(p.boxes, 'бокс', 'бокси', 'боксів')} · ${busy} ${plural(busy, 'запис', 'записи', 'записів')}` : `Вихідний${special ? ' (закрито на цей день)' : ' за графіком'}`}</p></div>
      <div class="row">${h ? `<button class="btn soft" type="button" data-action="day-hours" data-date="${day}">Години</button><button class="btn soft" type="button" data-action="day-close" data-date="${day}">Закрити день</button>`
        : `<button class="btn navy" type="button" data-action="day-hours" data-date="${day}">Відкрити день</button>`}</div></div>
    ${items ? `<ul class="day-list">${items}</ul>` : `<div class="pro-empty">${icon('calendar', 32)}<b>${h ? 'Вільного часу вже немає' : 'Мийка не працює'}</b>
      <span>${h ? 'Усі бокси зайняті або робочий день закінчився.' : 'Клієнти не можуть записатися на цей день. Відкрийте день, якщо працюєте.'}</span></div>`}`;
}

// ---------- шторка ----------

function openSheet(title, body) {
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
}

// ---------- картка запису ----------

function bookingSheet(id) {
  const b = own().find((x) => x.id === id);
  if (!b) return;
  const [label, cls] = stateOf(b);
  const started = bookingStart(b) <= new Date();
  let actions = '';
  if (b.state === 'booked') {
    actions = `<form class="stack" id="done-form" data-id="${b.id}" style="gap:10px">
        <div class="seg-row" role="radiogroup" aria-label="Оплата на місці">
          <label><input type="radio" name="payment" value="card" checked><span>Картка</span></label>
          <label><input type="radio" name="payment" value="cash"><span>Готівка</span></label></div>
        <label class="field"><span>Сума, ₴</span><input name="paid" type="number" min="0" inputmode="numeric" value="${b.paid}"></label>
        <button class="btn primary" type="submit">${icon('check', 18)}Виконано й оплачено</button>
      </form>
      <div class="grid2">
        <button class="btn" type="button" data-action="move" data-id="${b.id}">Перенести</button>
        <button class="btn" type="button" data-action="crm-noshow" data-id="${b.id}">Не приїхав</button>
        <button class="btn text-danger full" type="button" data-action="crm-cancel" data-id="${b.id}">Скасувати запис</button>
      </div>`;
  } else if (b.state === 'paid') {
    const late = Date.now() > bookingStart(b).getTime() + PAYMENT.lateMinutes * 60000;
    actions = `<button class="btn primary" type="button" data-action="ready" data-id="${b.id}">${icon('check', 18)}Машина готова</button>
      <p class="fine">Так ви підтверджуєте виконання. Клієнт отримає сповіщення, гроші ${PAYMENT.freezeHours} год чекають на випадок спору.</p>
      ${late ? `<button class="btn" type="button" data-action="late-forfeit" data-id="${b.id}">Запізнення понад ${PAYMENT.lateMinutes} хв — оплата нам</button>` : ''}
      ${started ? `<button class="btn text-danger" type="button" data-action="carcar-noshow" data-id="${b.id}">Клієнт не приїхав</button>` : ''}`;
  } else if (b.state === 'dispute') {
    actions = `<p class="notice warn"><b>Клієнт відкрив спір</b>«${esc(b.disputeReason ?? '')}». Поясніть ситуацію в <a href="business.html#/support">підтримці CARCAR</a>.</p>`;
  } else if (b.state === 'completed' && isCarcar(b)) {
    actions = `<p class="notice">${isFrozen(b) ? `Гроші стануть доступні ${fmtTime(b.unfreezeAt)}.` : 'Гроші доступні до виведення в розділі «Мийка».'}</p>`;
  }
  openSheet(`${b.time} · ${esc(who(b))}`, `
    <div class="row"><span class="pill ${cls}">${label}</span><span class="pill">${CHANNEL[channelOf(b)]}</span>${b.no ? `<span class="small muted">${bookingNo(b)}</span>` : ''}</div>
    <dl class="pro-kv">
      <dt>Коли</dt><dd>${dayWord(b.date, true)}, ${b.time}–${hhmm(toMin(b.time) + b.minutes)}</dd>
      <dt>Послуги</dt><dd>${esc(b.services.join(', '))}</dd>
      <dt>Авто</dt><dd>${esc(b.car || '—')}</dd>
      <dt>Сума</dt><dd>${uah(sumOf(b))}${isCarcar(b) ? ' · оплачено в CARCAR' : b.payment ? ` · ${b.payment === 'cash' ? 'готівка' : 'картка'}` : ' · оплата на місці'}</dd>
      ${b.note && !isCarcar(b) ? `<dt>Коментар</dt><dd>${esc(b.note)}</dd>` : ''}
    </dl>
    <div class="grid2">
      ${b.clientPhone ? `<a class="btn" href="${telHref(b.clientPhone)}">${icon('phone', 18)}Подзвонити</a>` : ''}
      ${isCarcar(b) ? `<a class="btn" href="#/chat/b-${b.id}" data-action="sheet-close">${icon('chat', 18)}Написати</a>` : ''}
    </div>
    ${actions}`);
}

function moveSheet(id, date) {
  const b = own().find((x) => x.id === id);
  const d = date ?? b.date;
  const t = todayIso();
  const starts = openStarts(place(), d, b.minutes, bookings, { lead: 0, skip: b });
  openSheet(`Перенести: ${esc(who(b))}`, `
    <div class="chips day-chips" role="group" aria-label="День">${Array.from({ length: 7 }, (_, i) => shiftDay(t, i)).map((x) => `<button class="chip" type="button" data-action="move-day" data-id="${b.id}" data-date="${x}" aria-pressed="${x === d}">${dayWord(x)}</button>`).join('')}</div>
    ${starts.length ? `<div class="slots" role="group" aria-label="Вільний час">${starts.map((s) => `<button class="slot" type="button" data-action="move-to" data-id="${b.id}" data-date="${d}" data-time="${s}">${s}</button>`).join('')}</div>`
      : '<p class="muted">На цей день вільних боксів немає.</p>'}`);
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
const nbMinutes = () => nbChosen().reduce((a, s) => a + s.min, 0) || 30;

function nbTimes() {
  const out = openStarts(place(), nb.date, nbMinutes(), bookings, { lead: 0 });
  // Клієнт уже біля боксу: «Зараз» — із поточної хвилини, якщо є вільний бокс.
  if (nb.channel === 'walkin' && nb.date === todayIso()) {
    const now = hhmm(Math.floor(minuteNow() / 5) * 5);
    if (!out.includes(now) && boxFree(nb.date, toMin(now), nbMinutes())) out.unshift(now);
  }
  return out;
}

function nbRender() {
  const p = place();
  const chosen = nbChosen();
  const total = chosen.reduce((a, s) => a + s.price[nb.cls], 0);
  const times = nbTimes();
  if (!times.includes(nb.time)) nb.time = times[0] ?? '';
  const t = todayIso();
  const nowTime = nb.channel === 'walkin' && nb.date === t ? times[0] : null;
  $('#nb-dyn').innerHTML = `
    <div><span class="lbl">Клас авто</span><div class="chips nb-chips" role="group" aria-label="Клас авто">${CAR_CLASSES.map((c, i) => `<button class="chip" type="button" data-action="nb-cls" data-i="${i}" aria-pressed="${i === nb.cls}">${c}</button>`).join('')}</div></div>
    <div><span class="lbl">Послуги</span><div class="svc-chips" role="group" aria-label="Послуги">${p.services.map((s) => `<button class="svc-chip" type="button" data-action="nb-svc" data-id="${s.id}" aria-pressed="${nb.services.has(s.id)}"><b>${esc(s.name)}</b><small>${uah(s.price[nb.cls])} · ${duration(s.min)}</small></button>`).join('')}</div></div>
    <div><span class="lbl">День</span><div class="chips nb-chips" role="group" aria-label="День">${Array.from({ length: 7 }, (_, i) => shiftDay(t, i)).map((d) => `<button class="chip" type="button" data-action="nb-day" data-date="${d}" aria-pressed="${d === nb.date}" ${hoursFor(p, d) ? '' : 'disabled'}>${dayWord(d)}</button>`).join('')}</div></div>
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
  // Час могли зайняти, поки заповнювали форму (наприклад, клієнт записався в застосунку).
  if (!boxFree(nb.date, toMin(nb.time), nbMinutes())) { toast('Цей час щойно зайняли — оберіть інший'); nbRender(); return; }
  const total = chosen.reduce((a, s) => a + s.price[nb.cls], 0);
  const b = {
    id: uid(), source: 'crm', channel: nb.channel, placeId: p.id, services: chosen.map((s) => s.name), total, paid: total, bonus: 0,
    covered: 0, passUse: null, masterId: null, minutes: nbMinutes(), date: nb.date, time: nb.time,
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
  if (isCarcar(b) && (b.state === 'cancelled' || b.state === 'noshow')) return b.placeAmount ?? 0;
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
  const r = ratingFor(p.id, reviews);
  const list = reviews.filter((x) => x.placeId === p.id).sort((a, b) => b.at - a.at);
  const waiting = list.filter((x) => !x.reply);
  const mine = payouts.filter((x) => x.placeId === p.id).sort((a, b) => b.at - a.at).slice(0, 3);
  const loadToday = loadPct(t);
  const loadTomorrow = loadPct(shiftDay(t, 1));
  return `<h1>Мийка</h1>
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
        : `<a class="btn block" href="business.html#/connect">Вказати рахунок для виплат</a>`}
      <p class="fine">Комісія CARCAR ${Math.round(commissionFor(p.id) * 100)}% утримується під час виведення. Оплати на місці не обкладаються.</p>
      ${mine.length ? `<ul class="plain-list">${mine.map((x) => `<li><span>${fmtTime(x.at)}</span><b>${uah(x.net)}</b></li>`).join('')}</ul>` : ''}
    </section>
    <section class="pro-card" aria-labelledby="h-rev">
      <h2 id="h-rev">Відгуки${r.count ? ` · ${rating(r.avg)}` : ''}</h2>
      ${r.count ? `<p class="small muted" style="margin:0">${starsLine(r.avg)} ${r.count} ${plural(r.count, 'відгук', 'відгуки', 'відгуків')}${waiting.length ? ` · без відповіді: ${waiting.length}` : ''}</p>` : '<p class="small muted" style="margin:0">Відгуків ще немає. Їх залишають лише клієнти, які були у вас через CARCAR.</p>'}
      ${list.slice(0, 5).map((x) => `<article class="pro-review" aria-label="Відгук ${esc(x.name ?? 'клієнта')}">
        <div class="head"><b>${esc(x.name ?? 'Клієнт')}</b>${starsLine(x.rating)}</div>
        ${x.text ? `<p>${esc(x.text)}</p>` : ''}
        ${x.reply ? `<p class="reply"><b>Ваша відповідь</b>${esc(x.reply.text)}</p>` : `<form class="chat-form rev-reply" data-id="${x.id}"><input name="reply" required maxlength="500" autocomplete="off" placeholder="Відповісти публічно…" aria-label="Відповідь на відгук"><button class="send-btn" type="submit" aria-label="Надіслати відповідь">${icon('send', 18)}</button></form>`}
      </article>`).join('')}
    </section>
    <a class="pro-link" href="business.html#/finance">${icon('chart', 22)}<span><b>Звіти, витрати й аналітика</b><small>Повна версія панелі — зручніше з компʼютера</small></span>${icon('chevR', 18)}</a>`;
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
    <section class="pro-card preview" aria-label="Як бачать клієнти">
      <span class="avatar" aria-hidden="true">${firstLetter(p.name.replace(/^(Автомийка|Детейлінг-мийка)\s*/, '').replace(/[«»"]/g, ''))}</span>
      <div><b>${esc(p.name)}</b><small>${esc(p.city ?? 'Київ')}, ${esc(p.address)}</small>
        <small>${r.count ? `★ ${rating(r.avg)} · ` : ''}сьогодні ${rangeText(hoursFor(p, t)).toLowerCase()}</small></div>
      <a class="btn soft" href="index.html#/place/${p.id}" target="_blank" rel="noopener">Відкрити</a>
    </section>
    <section class="pro-card" aria-labelledby="h-power">
      <h2 id="h-power">Світло</h2>
      <div class="chips wrap" role="group" aria-label="Світло на мийці">${Object.entries(POWER).map(([k, [label]]) => `<button class="chip" type="button" data-action="power" data-k="${k}" aria-pressed="${pw?.state === k}">${label}</button>`).join('')}</div>
      <p class="fine">${pw ? `Оновлено ${fmtTime(pw.at)}. ` : ''}Під час відключень клієнти шукають мийки, які працюють, — відмітка діє 12 годин.</p>
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

function viewMore() {
  const s = session();
  const links = [
    ['business.html#/clients', 'users', 'Клієнти', 'Історія візитів, нотатки, розсилки'],
    ['business.html#/staff', 'users', 'Персонал', 'Майстри, ролі й заробіток'],
    ['business.html#/connect', 'shield', 'Реквізити й документи', 'Рахунок для виплат, оферта'],
    ['business.html#/support', 'info', 'Підтримка CARCAR', 'Виплати, спори, відгуки'],
    ['business.html', 'chart', 'Повна версія панелі', 'Розклад по боксах, склад, абонементи — для компʼютера'],
  ];
  return `<h1>Ще</h1>
    ${s?.demo ? `<label class="field"><span>Мийка (демо)</span><select id="pro-place">${PLACES.filter((p) => partnerOf(p.id).status === 'approved').map((p) => `<option value="${p.id}" ${p.id === ui.place ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}</select></label>` : ''}
    <div class="stack" style="gap:8px;margin-top:12px">${links.map(([href, ic, title, sub]) => `<a class="pro-link" href="${href}">${icon(ic, 22)}<span><b>${title}</b><small>${sub}</small></span>${icon('chevR', 18)}</a>`).join('')}</div>
    ${s?.demo ? `<button class="btn block" type="button" data-action="demo-seed" style="margin-top:16px">Заповнити прикладом: записи й повідомлення</button>` : ''}
    <p class="fine" style="margin-top:16px">Щоб CarCar Business був під рукою, додайте його на головний екран: меню браузера → «Встановити застосунок» або «На екран “Додому”».</p>
    <button class="btn line-danger block" type="button" data-action="logout" style="margin-top:8px">${s?.demo ? 'Вийти з демо' : `Вийти${s?.login ? ` (${esc(s.login)})` : ''}`}</button>`;
}

// Приклад для демо: кілька записів на сьогодні й завтра, переписка й питання клієнта.
function demoSeed() {
  const p = place();
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
  const tm = shiftDay(t, 1);
  make(tm, pick(2), { slot: 2, channel: 'carcar', state: 'paid', clientName: 'Андрій Коваль', clientPhone: '+380 66 400 70 80', car: 'Kia Sportage · BC1209HH',
    chat: [{ from: 'client', text: 'Буду з багажником на даху, це не завадить?', at: ago(180), readAt: ago(170) }, { from: 'biz', text: 'Так, чекаємо', at: ago(170), readAt: ago(160) }] });
  make(tm, pick(0, 3), { slot: 6, channel: 'phone', state: 'booked', clientName: 'Наталія Шевчук', clientPhone: '+380 97 777 01 02', car: 'VW Golf · AA0909XT' });
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
  const tabOf = page === 'chat' ? '' : page;
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
  if (s.placeId && placeById(s.placeId)) ui.place = s.placeId;
  touchPresence(ui.place);
  checkWaitlist(bookings);
  const [, page = '', arg] = location.hash.replace(/^#/, '').split('/');
  document.body.classList.toggle('in-chat', page === 'chat');
  renderChrome(page);
  const view = $('#view');
  if (page === '') view.innerHTML = viewMessages();
  else if (page === 'chat') view.innerHTML = viewThread(arg);
  else if (page === 'bookings') view.innerHTML = viewBookings(arg);
  else if (page === 'wash') view.innerHTML = viewWash();
  else if (page === 'profile') view.innerHTML = viewProfile();
  else if (page === 'more') view.innerHTML = viewMore();
  else view.innerHTML = notFound();
  if (page === 'chat') {
    const list = $('.chat-msgs');
    if (list) {
      list.scrollTop = list.scrollHeight;
      for (const img of list.querySelectorAll('img')) img.addEventListener('load', () => { list.scrollTop = list.scrollHeight; }, { once: true });
    }
  }
  const key = `${page}/${page === 'chat' ? arg : ''}`;
  if (key !== ui.lastView && page !== 'chat') window.scrollTo(0, 0);
  ui.lastView = key;
}

function rerender() {
  const y = window.scrollY;
  route();
  window.scrollTo(0, y);
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
  const b = id ? own().find((x) => x.id === id) : null;
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
  if (action === 'demo-login') { store.set('biz.session', { demo: true, at: Date.now() }); location.hash = '#/'; route(); return; }
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
      ...(r ? { name: r.clientName ?? '', phone: r.clientPhone ?? '', car: r.car ?? '', cls: r.cls ?? 0 } : {}),
    });
    return;
  }
  if (action === 'nb-cls') { nb.cls = Number(el.dataset.i); nbRender(); return; }
  if (action === 'nb-svc') { nb.services.has(el.dataset.id) ? nb.services.delete(el.dataset.id) : nb.services.add(el.dataset.id); nbRender(); return; }
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
    const placeAmount = Math.round(price(b) * PAYMENT.noShowShare);
    if (!confirm(`Позначити неявку? Клієнт не скасував запис вчасно, тож оплата ${uah(placeAmount)} зараховується вам.`)) return;
    Object.assign(b, { state: 'noshow', placeAmount, refund: price(b) - placeAmount, closedAt: Date.now() });
    after('Позначено неявку');
    return;
  }
  if (action === 'late-forfeit') {
    if (!confirm(`Клієнт запізнюється понад ${PAYMENT.lateMinutes} хв: зарахувати оплату ${uah(price(b))} вам і закрити запис?`)) return;
    Object.assign(b, { state: 'noshow', placeAmount: price(b), refund: 0, lateForfeit: true, closedAt: Date.now() });
    sendMessages([{ placeId: b.placeId, clientKey: 'device', channel: 'app', kind: 'late', bookingId: b.id, link: `#/bookings/${b.id}`,
      text: `${place().name}: ви запізнилися більше ніж на ${PAYMENT.lateMinutes} хв, тому візит вважається неявкою — оплату зараховано мийці. Якщо це помилка, напишіть у підтримку.` }]);
    after(`Оплату ${uah(price(b))} зараховано вам`);
    return;
  }
  if (action === 'move') { moveSheet(id); return; }
  if (action === 'move-day') { moveSheet(id, el.dataset.date); return; }
  if (action === 'move-to') {
    Object.assign(b, { date: el.dataset.date, time: el.dataset.time });
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
    toast('Клієнти бачать оновлений статус');
    return;
  }
  if (action === 'svc-edit') { serviceSheet(id); return; }
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
  const f = e.target.form;
  if (f?.id !== 'nb-form' || !nb) return;
  const { name, value } = e.target;
  if (name === 'phone') { nb.phone = value; nbHint(); } else if (name === 'name') nb.name = value;
  else if (name === 'car') nb.car = value;
});

document.addEventListener('change', async (e) => {
  if (e.target.id === 'pro-place') {
    ui.place = e.target.value;
    store.set('partner', ui.place);
    rerender();
    return;
  }
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
    return;
  }
  if (f.id === 'pro-chat') {
    const text = String(d.get('text')).trim();
    if (text) sendTo(f.dataset.thread, text);
    return;
  }
  if (f.id === 'nb-form') { nbSubmit(); return; }
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
    r.reply = { text: String(d.get('reply')).trim(), at: Date.now() };
    save();
    rerender();
    toast('Відповідь опубліковано на сторінці мийки');
    return;
  }
  if (f.id === 'pf-main') {
    saveOverride(ui.place, { phone: String(d.get('phone')).trim(), boxes: Math.max(1, Number(d.get('boxes')) || 1) });
    rerender();
    toast('Збережено — клієнти бачать нові дані');
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
    toast('Графік збережено — клієнти бачать новий вільний час');
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
    toast(r ? 'Послугу додано, клієнт отримав відповідь' : 'Прайс збережено — клієнти вже бачать нові ціни');
  }
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && $('#sheet-root').innerHTML) closeSheet();
});

// Інша вкладка (застосунок клієнта, повна панель) змінила дані — підтягуємо, не збиваючи введення.
window.addEventListener('storage', (e) => {
  if (!e.key?.startsWith('carcar.')) return;
  load();
  if (nb || document.body.classList.contains('sheet-open')) { renderChrome(location.hash.split('/')[1] ?? ''); return; }
  const input = $('#pro-chat [name="text"]');
  const draft = input?.value ?? '';
  const focused = document.activeElement === input;
  if (document.activeElement?.matches('input, textarea, select') && !focused) return;
  rerender();
  const again = $('#pro-chat [name="text"]');
  if (again) { again.value = draft; if (focused) again.focus(); }
});

window.addEventListener('hashchange', () => { if (nb || $('#sheet-root').innerHTML) closeSheet(); route(); });
setInterval(() => { if (session()) touchPresence(ui.place); }, 30000);
route();

if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
