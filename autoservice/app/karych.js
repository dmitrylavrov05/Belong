// Кар Карич — мультяшний ворон-помічник у застосунку клієнта. Сидить у кутку екрана, підказує, що робити
// на поточному екрані (раз на екран), відповідає на часті питання й радіє, коли запис зроблено.
// Підказки — заздалегідь написані правила, без ШІ. Вимикається в налаштуваннях.
import { store, esc } from './core.js';

const KEY = 'karych'; // { off, seen: { екран: true } } — лише на цьому телефоні

// Ворон у кепці автомийника: тіло, крило з губкою, очі з повіками, дзьоб із рухомою нижньою частиною.
export const KARYCH_SVG = `<svg class="k-bird" viewBox="0 0 120 120" aria-hidden="true" focusable="false">
  <g class="k-bubbles"><circle cx="18" cy="40" r="5"/><circle cx="12" cy="58" r="3.5"/><circle cx="104" cy="30" r="4"/></g>
  <g class="k-body">
    <ellipse class="k-shadow" cx="62" cy="113" rx="26" ry="4"/>
    <path class="k-legs" d="M54 98v10m-5 0h10M70 98v10m-5 0h10"/>
    <path class="k-tail" d="M40 88 22 100l6-16z"/>
    <ellipse class="k-torso" cx="62" cy="78" rx="27" ry="24"/>
    <ellipse class="k-belly" cx="66" cy="84" rx="15" ry="14"/>
    <g class="k-wing"><path d="M42 70c-10 6-14 18-10 28 10-2 18-10 20-22z"/><rect class="k-sponge" x="22" y="90" width="15" height="10" rx="3"/></g>
    <circle class="k-head" cx="66" cy="44" r="23"/>
    <path class="k-cap" d="M44 38c2-14 13-21 24-21s21 7 22 19z"/>
    <path class="k-visor" d="M84 34c8 0 15 2 18 5-6 2-13 2-20 1z"/>
    <text class="k-cap-text" x="66" y="32" text-anchor="middle">CC</text>
    <g class="k-eyes">
      <ellipse cx="60" cy="46" rx="7" ry="8"/><ellipse cx="77" cy="46" rx="7" ry="8"/>
      <circle class="k-pupil" cx="62" cy="47" r="3.3"/><circle class="k-pupil" cx="79" cy="47" r="3.3"/>
      <circle class="k-glint" cx="63.4" cy="45.4" r="1.1"/><circle class="k-glint" cx="80.4" cy="45.4" r="1.1"/>
      <g class="k-lids"><rect x="52" y="37" width="16" height="18" rx="8"/><rect x="69" y="37" width="16" height="18" rx="8"/></g>
    </g>
    <path class="k-beak-up" d="M80 54c8 0 16 2 20 6-7 2-14 2-21 0z"/>
    <path class="k-beak-low" d="M80 58c6 1 12 2 16 3-5 3-11 3-16 1z"/>
    <circle class="k-cheek" cx="54" cy="56" r="3.5"/>
  </g>
</svg>`;

const state = { away: false, screen: null, tipFor: null, faq: [], opts: {}, hideTimer: 0, talkTimer: 0 };
const prefs = () => ({ off: false, seen: {}, ...store.get(KEY, {}) });
const savePrefs = (p) => store.set(KEY, p);
export const karychOn = () => !prefs().off;
export function setKarych(on) {
  savePrefs({ ...prefs(), off: !on });
  render();
}

function root() {
  let el = document.getElementById('karych');
  if (!el) {
    el = document.createElement('div');
    el.id = 'karych';
    el.className = 'karych';
    el.innerHTML = `<div class="k-bubble" id="k-bubble" role="dialog" aria-label="Кар Карич підказує" hidden></div>
      <button class="k-btn" type="button" data-k="toggle" aria-label="Кар Карич — помічник" aria-expanded="false" aria-controls="k-bubble">${KARYCH_SVG}</button>`;
    document.body.append(el);
    el.addEventListener('click', onClick);
  }
  return el;
}

// Ворон «говорить»: дзьоб рухається, поки читаєте фразу (недовго).
function talk(ms) {
  const el = root();
  el.classList.add('talking');
  clearTimeout(state.talkTimer);
  state.talkTimer = setTimeout(() => el.classList.remove('talking'), Math.min(2600, Math.max(700, ms)));
}

function mood(name) {
  const el = root();
  el.classList.remove('wave', 'cheer');
  void el.offsetWidth; // перезапуск анімації
  if (name) el.classList.add(name);
}

function open(html, { auto = false, moodName = 'wave' } = {}) {
  const el = root();
  const b = el.querySelector('#k-bubble');
  b.innerHTML = `<button class="k-close" type="button" data-k="close" aria-label="Закрити підказку">×</button>
    <b class="k-name">Кар Карич</b>${html}`;
  b.hidden = false;
  el.classList.add('open');
  el.querySelector('.k-btn').setAttribute('aria-expanded', 'true');
  mood(moodName);
  talk(b.textContent.length * 35);
  clearTimeout(state.hideTimer);
  // Підказка, що зʼявилась сама, ховається сама; відкриту вручну закриває клієнт.
  if (auto) state.hideTimer = setTimeout(close, 9000);
}

function close() {
  const el = document.getElementById('karych');
  if (!el) return;
  el.querySelector('#k-bubble').hidden = true;
  el.classList.remove('open', 'talking');
  el.querySelector('.k-btn').setAttribute('aria-expanded', 'false');
  clearTimeout(state.hideTimer);
}

const tipHtml = (tip) => `<p class="k-text">${esc(tip.text)}</p>`;

function menuHtml() {
  const tip = state.tipFor?.();
  return `${tip ? tipHtml(tip) : '<p class="k-text">Кар! Я Кар Карич. Підкажу, як усе працює. Що цікавить?</p>'}
    <div class="k-chips">${state.faq.map((q, i) => `<button class="chip" type="button" data-k="faq" data-i="${i}">${esc(q.q)}</button>`).join('')}</div>
    <button class="k-off link-btn" type="button" data-k="off">Не показувати помічника</button>`;
}

function onClick(e) {
  const t = e.target.closest('[data-k]');
  if (!t) return;
  const k = t.dataset.k;
  if (k === 'toggle') {
    // Підказка зʼявилась сама — дотик відкриває питання; відкриті питання — закриває.
    if (root().classList.contains('open') && root().querySelector('.k-chips')) close(); else open(menuHtml());
  } else if (k === 'close') {
    close();
  } else if (k === 'faq') {
    const q = state.faq[Number(t.dataset.i)];
    open(`<p class="k-q">${esc(q.q)}</p><p class="k-text">${esc(q.a)}</p>
      ${q.href ? `<a class="btn soft" href="${q.href}" data-k="close">${esc(q.link ?? 'Відкрити')}</a>` : ''}
      <button class="link-btn" type="button" data-k="menu">← Інші питання</button>`, { moodName: null });
  } else if (k === 'menu') {
    open(menuHtml(), { moodName: null });
  } else if (k === 'off') {
    setKarych(false);
    state.opts.onOff?.();
  }
}

// Підняти ворона над нижніми панелями (меню, кнопка «Записатися», оплата), щоб не закривав кнопки.
// Панелі закріплені (position: fixed), тож рахуємо за їхнім фактичним положенням на екрані.
function place() {
  const el = document.getElementById('karych');
  if (!el) return;
  let top = window.innerHeight;
  for (const bar of document.querySelectorAll('.tabs, .dock')) {
    const r = bar.getBoundingClientRect();
    if (r.height > 0 && r.bottom > window.innerHeight / 2) top = Math.min(top, r.top);
  }
  el.style.setProperty('--k-bottom', `${Math.max(0, window.innerHeight - top) + 12}px`);
}

function render() {
  const el = root();
  el.hidden = !karychOn() || state.away;
  if (el.hidden) close();
}

// Після кожного переходу між екранами: перша підказка на новому екрані зʼявляється сама.
// away — ворон ховається (оформлення запису: там важлива кожна кнопка, нічого не має заважати).
export function karychRoute(screen, tip, { away = false } = {}) {
  state.tipFor = () => tip;
  state.away = away;
  render();
  requestAnimationFrame(place);
  // Той самий екран перемалювався (обрали послугу, слот) — не закриваємо підказку й не показуємо знову.
  if (screen === state.screen) return;
  state.screen = screen;
  close();
  if (!karychOn() || !tip || !screen) return;
  const p = prefs();
  if (p.seen[screen]) return;
  p.seen[screen] = true;
  savePrefs(p);
  setTimeout(() => { if (state.screen === screen && karychOn()) open(tipHtml(tip), { auto: true }); }, 700);
}

// Подія: радіє (запис зроблено) чи щось пояснює.
export function karychSay(text, moodName = 'cheer') {
  if (!karychOn()) return;
  state.away = false;
  render();
  open(`<p class="k-text">${esc(text)}</p>`, { auto: true, moodName });
}

export function initKarych({ faq, onOff }) {
  state.faq = faq;
  state.opts = { onOff };
  render();
  window.addEventListener('resize', place);
}
