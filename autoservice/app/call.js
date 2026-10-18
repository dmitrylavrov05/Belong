// Дзвінки всередині CARCAR: клієнт і мийка говорять через застосунок, не бачачи номерів одне одного,
// тож мийка не може записати клієнта CARCAR «собі» в обхід платформи.
// Виклик і дані зʼєднання — у спільному сховищі: з сервером CARCAR (deploy/server) — між будь-якими пристроями,
// без нього — між вкладками одного пристрою. Голос — WebRTC: STUN допомагає пройти крізь роутери, а за суворим
// NAT (мобільний інтернет) голос іде через TURN-сервер CARCAR (coturn, тимчасові паролі видає /api/ice).
// Про вхідний дзвінок у закритий застосунок сервер надсилає push.
import { store, icon, esc, hasServer, api } from './core.js';

const RING_MS = 30000;
const CALL_KEY = 'calls'; // { id: дзвінок } — у кожної пари клієнт—мийка свій
const ICE = [{ urls: 'stun:stun.l.google.com:19302' }, { urls: 'stun:stun1.l.google.com:19302' }];

let callSide = null; // 'client' або 'place'
let callMine = () => false; // чи цей застосунок — учасник дзвінка (клієнт за номером, мийка за своїми мийками)
let callPeer = null;
let callStream = null;
let callTick = null;
let callRingTimer = null;
let callHooks = { onLog: () => {} };
let callWarn = ''; // мікрофон недоступний тощо

const live = (c) => (['ringing', 'active'].includes(c.state) ? 1 : 0);
// Поточний дзвінок цього застосунку: найсвіжіший, де ми учасник (за однакового часу — той, що ще триває).
const callGet = () => Object.values(store.peek(CALL_KEY, {})).filter((c) => callMine(c)).sort((a, b) => (b.at - a.at) || (live(b) - live(a)))[0] ?? null;
const callSet = (c) => {
  const old = Date.now() - 6 * 3600e3;
  const all = Object.fromEntries(Object.entries(store.get(CALL_KEY, {})).filter(([, x]) => x.at > old));
  store.set(CALL_KEY, { ...all, [c.id]: c });
};
const callOther = (c) => (c.from === callSide ? 'out' : 'in');
const callName = (c) => (callSide === 'client' ? c.placeName : c.clientName || 'Клієнт CARCAR');
const callClock = (ms) => { const s = Math.max(0, Math.floor(ms / 1000)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };

// side — хто цей застосунок; mine(call) — чи ми учасник дзвінка; onLog(call) — дзвінок завершився.
export function initCalls(side, mine, hooks = {}) {
  callSide = side;
  callMine = mine;
  callHooks = { ...callHooks, ...hooks };
  window.addEventListener('storage', (e) => { if (e.key === `carcar.${CALL_KEY}`) callSync(); });
  document.addEventListener('click', callClick);
  // Застарілий дзвінок (вкладку закрили під час розмови) — прибираємо.
  const c = callGet();
  if (c && ['ringing', 'active'].includes(c.state) && Date.now() - (c.answeredAt ?? c.at) > (c.state === 'ringing' ? RING_MS : 3 * 3600e3)) callSet({ ...c, state: 'ended', endedAt: Date.now() });
  callSync();
}

export const newCallId = () => `c${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;
// Чи йде вже дзвінок (новий не починаємо).
export const callBusy = () => ['ringing', 'active'].includes(callGet()?.state);

// Почати дзвінок. who: { id?, bookingId | reqId — чат, куди записати дзвінок, placeId, placeName, clientName }.
export async function startCall(who) {
  const cur = callGet();
  if (cur && ['ringing', 'active'].includes(cur.state)) { callSync(); return; }
  const c = { id: newCallId(), from: callSide, state: 'ringing', at: Date.now(), ...who };
  callSet(c);
  callRender(c);
  const sdp = await callPrepare(c, null);
  const now = callGet();
  if (now?.id === c.id && ['ringing', 'active'].includes(now.state) && sdp) callSet({ ...now, offer: sdp });
}

function callClick(e) {
  const el = e.target.closest('[data-call]');
  if (!el) return;
  const c = callGet();
  const act = el.dataset.call;
  if (act === 'close') { callClose(); return; }
  if (!c) return;
  if (act === 'answer') callAnswer(c);
  else if (act === 'decline') callEnd(c, 'declined');
  else if (act === 'hangup') callEnd(c, c.state === 'ringing' ? 'cancelled' : 'ended');
  else if (act === 'mute' && callStream) {
    const t = callStream.getAudioTracks()[0];
    if (t) t.enabled = !t.enabled;
    el.setAttribute('aria-pressed', String(!t?.enabled));
  }
}

async function callAnswer(c) {
  const on = { ...c, state: 'active', answeredAt: Date.now() };
  callSet(on);
  callRender(on);
  // Дані зʼєднання від того, хто дзвонить, можуть ще готуватися (дозвіл на мікрофон) — чекаємо до 15 с.
  let offer = c.offer;
  for (let i = 0; !offer && i < 75; i++) {
    await new Promise((ok) => setTimeout(ok, 200));
    const now = callGet();
    if (now?.id !== c.id || now.state !== 'active') return;
    offer = now.offer;
  }
  if (!offer) { callStatus('Співрозмовник не дав доступ до мікрофона — напишіть у чат'); return; }
  const sdp = await callPrepare(c, offer);
  const now = callGet();
  if (now?.id === c.id && sdp) callSet({ ...now, answer: sdp });
}

function callEnd(c, state) {
  const done = { ...c, state, endedAt: Date.now() };
  callSet(done);
  callHooks.onLog(done);
  callStop();
  callRender(done);
}

// Мікрофон і WebRTC. remoteOffer — для того, хто відповідає. Повертає SDP, коли зібрано всі кандидати.
async function callPrepare(c, remoteOffer) {
  if (!('RTCPeerConnection' in window) || !navigator.mediaDevices?.getUserMedia) return null;
  try {
    callStream = await Promise.race([navigator.mediaDevices.getUserMedia({ audio: true }), new Promise((_, no) => setTimeout(() => no(new Error('timeout')), 8000))]);
  } catch {
    callStatus('Мікрофон недоступний — дозвольте його в налаштуваннях браузера');
    return null;
  }
  let iceServers = ICE;
  if (hasServer()) {
    const r = await api('ice');
    if (r.ok && r.data.iceServers?.length) iceServers = r.data.iceServers;
  }
  callPeer = new RTCPeerConnection({ iceServers });
  callStream.getTracks().forEach((t) => callPeer.addTrack(t, callStream));
  callPeer.ontrack = (ev) => { const a = document.getElementById('call-audio'); if (a) a.srcObject = ev.streams[0]; };
  if (remoteOffer) {
    await callPeer.setRemoteDescription({ type: 'offer', sdp: remoteOffer });
    await callPeer.setLocalDescription(await callPeer.createAnswer());
  } else {
    await callPeer.setLocalDescription(await callPeer.createOffer());
  }
  await new Promise((ok) => {
    if (callPeer.iceGatheringState === 'complete') { ok(); return; }
    callPeer.addEventListener('icegatheringstatechange', () => callPeer?.iceGatheringState === 'complete' && ok());
    setTimeout(ok, 2000);
  });
  return callPeer?.localDescription?.sdp ?? null;
}

function callStop() {
  callStream?.getTracks().forEach((t) => t.stop());
  callPeer?.close();
  callStream = null;
  callPeer = null;
  clearInterval(callTick);
  clearTimeout(callRingTimer);
}

// Інша сторона змінила дзвінок: відповіла, поклала трубку, надіслала дані зʼєднання.
function callSync() {
  const c = callGet();
  if (!c) { callClose(); return; }
  const dir = callOther(c);
  if (dir === 'out' && c.answer && callPeer && !callPeer.currentRemoteDescription) callPeer.setRemoteDescription({ type: 'answer', sdp: c.answer }).catch(() => {});
  if (['ended', 'declined', 'cancelled', 'missed'].includes(c.state)) callStop();
  // Вхідний дзвінок, що вже закінчився до відкриття застосунку, не показуємо.
  if (dir === 'in' && !document.getElementById('call-screen') && c.state !== 'ringing') return;
  callRender(c);
}

function callRender(c) {
  let el = document.getElementById('call-screen');
  if (!el) {
    el = document.createElement('section');
    el.id = 'call-screen';
    el.className = 'call-screen';
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-modal', 'true');
    el.setAttribute('aria-labelledby', 'call-name');
    document.body.append(el);
  }
  const dir = callOther(c);
  const name = callName(c);
  const live = c.state === 'active';
  const status = c.state === 'ringing' ? (dir === 'out' ? 'Дзвонимо…' : 'Вхідний дзвінок CARCAR')
    : live ? `<span id="call-time">${callClock(Date.now() - c.answeredAt)}</span>`
      : { declined: dir === 'out' ? 'Не може відповісти зараз' : 'Дзвінок відхилено', missed: 'Не відповідає', cancelled: dir === 'out' ? 'Дзвінок скасовано' : 'Пропущений дзвінок', ended: 'Дзвінок завершено' }[c.state];
  const buttons = c.state === 'ringing' && dir === 'in'
    ? `<button class="call-btn end" type="button" data-call="decline" aria-label="Відхилити">${icon('phone', 28)}</button>
       <button class="call-btn ok" type="button" data-call="answer" aria-label="Відповісти">${icon('phone', 28)}</button>`
    : ['ringing', 'active'].includes(c.state)
      ? `<button class="call-btn" type="button" data-call="mute" aria-pressed="false" aria-label="Вимкнути мікрофон">${icon('mic', 26)}</button>
         <button class="call-btn end" type="button" data-call="hangup" aria-label="Завершити">${icon('phone', 28)}</button>`
      : `<button class="btn" type="button" data-call="close">Закрити</button>
         ${c.bookingId && callSide === 'client' && ['declined', 'missed'].includes(c.state) ? `<a class="btn primary" href="#/chat/${c.bookingId}" data-call="close">Написати в чат</a>` : ''}`;
  el.innerHTML = `<div class="call-who">
      <span class="call-ava" aria-hidden="true">${esc([...String(name).replace(/^(Автомийка|Детейлінг-мийка)\s*/, '').replace(/[«»"]/g, '')][0] ?? 'C')}</span>
      <h2 id="call-name">${esc(name)}</h2>
      <p class="call-status" aria-live="polite">${status}</p>
      <p class="call-note">${icon('shield', 14)}Дзвінок через CARCAR — номери телефонів приховані</p>
      <p class="call-warn" role="status">${esc(callWarn)}</p>
    </div>
    <div class="call-actions">${buttons}</div>
    <audio id="call-audio" autoplay></audio>`;
  if (callPeer && live) { const a = document.getElementById('call-audio'); const r = callPeer.getReceivers()[0]?.track; if (a && r) a.srcObject = new MediaStream([r]); }
  clearInterval(callTick);
  if (live) callTick = setInterval(() => { const t = document.getElementById('call-time'); if (t) t.textContent = callClock(Date.now() - c.answeredAt); }, 1000);
  clearTimeout(callRingTimer);
  // Ніхто не відповів за 30 с — дзвінок пропущено (рахує той, хто дзвонить).
  if (c.state === 'ringing' && dir === 'out') callRingTimer = setTimeout(() => { const now = callGet(); if (now?.id === c.id && now.state === 'ringing') callEnd(now, 'missed'); }, Math.max(0, RING_MS - (Date.now() - c.at)));
  if (!['ringing', 'active'].includes(c.state)) setTimeout(() => { if (callGet()?.id === c.id) callClose(); }, 6000);
  if (c.state === 'ringing' && dir === 'in' && navigator.userActivation?.hasBeenActive) navigator.vibrate?.([300, 200, 300]);
}

function callStatus(text) {
  callWarn = text;
  const p = document.querySelector('#call-screen .call-warn');
  if (p) p.textContent = text;
}

function callClose() {
  callWarn = '';
  document.getElementById('call-screen')?.remove();
  callStop();
}

// Запис у чат запису: «Дзвінок через CARCAR · 1:23» або «Пропущений дзвінок».
export function callLogText(c) {
  const by = c.from === 'client' ? 'клієнта' : 'мийки';
  if (c.state === 'ended' && c.answeredAt) return `Дзвінок через CARCAR · ${callClock(c.endedAt - c.answeredAt)}`;
  return c.state === 'declined' ? `Дзвінок від ${by} відхилено` : `Пропущений дзвінок від ${by}`;
}
// Дзвінок записується в той самий діалог із мийкою — чат запису чи загальний чат (запит), а не окремим рядком.
// Журнал дзвінків лишається для історії; окремим рядком у «Повідомленнях» показуються лише давні дзвінки без чату.
export const callLinked = (x) => !!(x.bookingId || x.reqId);
// Повідомлення в чаті: на початку дзвінка (якщо чат створено для дзвінка) — «Дзвінок через CARCAR», після — результат.
export function callNote(list, c) {
  const answered = c.state === 'ended' && !!c.answeredAt;
  const info = { text: c.state === 'ringing' ? 'Дзвінок через CARCAR' : callLogText(c), callFrom: c.from ?? 'client',
    callState: answered ? 'ended' : c.state, dur: answered ? c.endedAt - c.answeredAt : null };
  const msg = list.find((m) => m.call === c.id);
  if (msg) return Object.assign(msg, info);
  const m = { from: 'sys', at: c.at, call: c.id, ...info };
  list.push(m);
  return m;
}
// ctx: { bookings, requests, save }.
export function logCall(ctx, c) {
  const answered = c.state === 'ended' && !!c.answeredAt;
  const b = c.bookingId && ctx.bookings.find((x) => x.id === c.bookingId);
  const r = !b && c.reqId && ctx.requests?.find((x) => x.id === c.reqId);
  const log = store.peek('callLog', []);
  if (!log.some((x) => x.id === c.id)) {
    store.set('callLog', [...log, {
      id: c.id, placeId: c.placeId, bookingId: b ? b.id : null, reqId: r ? r.id : null, clientId: c.clientId ?? 'device', from: c.from, state: answered ? 'ended' : c.state, at: c.endedAt ?? Date.now(),
      dur: answered ? c.endedAt - c.answeredAt : null, clientName: c.clientName ?? '', placeName: c.placeName ?? '',
      // Пропущений дзвінок без чату — непрочитаний для того, кому дзвонили (у чаті непрочитаність позначає сам чат).
      unreadClient: !b && !r && !answered && c.from === 'place', unreadBiz: !b && !r && !answered && c.from === 'client',
    }].slice(-300));
  }
  if (!b && !r) return;
  // Хто має побачити: пропущений — той, кому дзвонили; відхилений — той, хто дзвонив; розмова — нікому.
  const to = answered ? null : (c.state === 'declined') === (c.from === 'client') ? 'client' : 'biz';
  if (b) {
    b.chat = b.chat ?? [];
    callNote(b.chat, c);
    b.chat.sort((x, y) => x.at - y.at);
    if (to === 'biz') b.chatUnreadBiz = true;
    if (to === 'client') b.chatUnreadClient = true;
  } else {
    callNote(r.messages, c);
    r.messages.sort((x, y) => x.at - y.at);
    if (to === 'biz') r.unreadBiz = true;
    if (to === 'client') r.unreadClient = true;
  }
  ctx.save();
}

export const callHistory = () => store.peek('callLog', []);
// Підпис у списку повідомлень з погляду side ('client' або 'place').
export function callRowText(x, side) {
  const out = x.from === side;
  if (x.state === 'ended') return `${out ? 'Вихідний' : 'Вхідний'} дзвінок · ${callClock(x.dur ?? 0)}`;
  if (out) return x.state === 'declined' ? 'Дзвінок відхилено' : 'Не відповіли на дзвінок';
  return 'Пропущений дзвінок';
}
// Рядок дзвінка в чаті з погляду side: «Вихідний дзвінок · 1:23», «Пропущений дзвінок»…
export const callLine = (m, side) => (m.callState && m.callState !== 'ringing' ? callRowText({ from: m.callFrom, state: m.callState, dur: m.dur }, side) : m.text);
export const callMissed = (x, side) => (side === 'client' ? x.unreadClient : x.unreadBiz);
export function markCallsRead(side, pick) {
  const log = store.peek('callLog', []);
  const key = side === 'client' ? 'unreadClient' : 'unreadBiz';
  if (!log.some((x) => x[key] && pick(x))) return;
  store.set('callLog', log.map((x) => (x[key] && pick(x) ? { ...x, [key]: false } : x)));
}
