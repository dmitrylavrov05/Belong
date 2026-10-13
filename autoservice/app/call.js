// Дзвінки всередині CARCAR: клієнт і мийка говорять через застосунок, не бачачи номерів одне одного,
// тож мийка не може записати клієнта CARCAR «собі» в обхід платформи.
// Демо: виклик і обмін даними зʼєднання — через localStorage (працює між вкладками на одному пристрої),
// голос — WebRTC без сервера. У робочій версії — сервер сигналізації (або VoIP-сервіс) і push про вхідний дзвінок.
import { store, icon, esc } from './core.js';
import { chatPost } from './ops.js';

const RING_MS = 30000;
const CALL_KEY = 'call';

let callSide = null; // 'client' або 'place'
let callMine = () => false; // чи стосується вхідний дзвінок цього застосунку
let callPeer = null;
let callStream = null;
let callTick = null;
let callRingTimer = null;
let callHooks = { onLog: () => {} };
let callWarn = ''; // мікрофон недоступний тощо

const callGet = () => store.peek(CALL_KEY, null);
const callSet = (c) => store.set(CALL_KEY, c);
const callOther = (c) => (c.from === callSide ? 'out' : 'in');
const callName = (c) => (callSide === 'client' ? c.placeName : c.clientName || 'Клієнт CARCAR');
const callClock = (ms) => { const s = Math.max(0, Math.floor(ms / 1000)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };

// side — хто цей застосунок; mine(call) — чи показувати вхідний дзвінок; onLog(call) — дзвінок завершився.
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

// Почати дзвінок. who: { bookingId, placeId, placeName, clientName }.
export async function startCall(who) {
  const cur = callGet();
  if (cur && ['ringing', 'active'].includes(cur.state)) { callSync(); return; }
  const c = { id: `c${Date.now().toString(36)}`, from: callSide, state: 'ringing', at: Date.now(), ...who };
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
  callPeer = new RTCPeerConnection();
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
  if (dir === 'in' && !callMine(c)) return;
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
export function logCall(bookings, c, save) {
  const b = c.bookingId && bookings.find((x) => x.id === c.bookingId);
  if (!b) return;
  chatPost(b, 'sys', callLogText(c), c.from === 'client' ? 'biz' : 'client');
  save();
}
