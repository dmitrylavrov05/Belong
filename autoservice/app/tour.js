// Навчання з Кар Каричем: покрокові спливні підказки поверх справжнього екрана. Кожен крок підсвічує частину
// інтерфейсу (вкладку, кнопку), ворон пояснює, що там. Показується раз (позначка на пристрої), повторити — з меню.
import { store, esc } from './core.js';
import { KARYCH_SVG } from './karych.js';

let cur = null; // { steps, i, opts, el, onKey, onResize }

export const tourSeen = (key) => !!store.get(key, false);

export function startTour(steps, opts = {}) {
  stopTour(false);
  const el = document.createElement('div');
  el.className = 'tour';
  el.innerHTML = `<div class="tour-hole" aria-hidden="true"></div>
    <section class="tour-card" role="dialog" aria-modal="true" aria-labelledby="tour-h">
      <div class="tour-bird">${KARYCH_SVG}</div>
      <div class="tour-body"><h2 id="tour-h"></h2><p class="tour-text"></p>
        <div class="tour-foot"><span class="tour-dots" aria-hidden="true"></span><span class="tour-count sr-only"></span>
          <span class="tour-btns"><button class="btn link-btn" type="button" data-tour="skip">Пропустити</button>
          <button class="btn" type="button" data-tour="prev">Назад</button>
          <button class="btn primary" type="button" data-tour="next">Далі</button></span></div></div>
    </section>`;
  document.body.append(el);
  document.body.classList.add('touring');
  const opener = document.activeElement;
  cur = { steps, i: 0, opts, el, opener };
  el.addEventListener('click', (e) => {
    const b = e.target.closest('[data-tour]');
    if (b?.dataset.tour === 'next') go(1);
    else if (b?.dataset.tour === 'prev') go(-1);
    else if (b?.dataset.tour === 'skip') stopTour(true);
  });
  cur.onKey = (e) => {
    if (e.key === 'Escape') stopTour(true);
    else if (e.key === 'ArrowRight') go(1);
    else if (e.key === 'ArrowLeft') go(-1);
    else if (e.key === 'Tab') { // фокус лишається в діалозі
      const f = [...el.querySelectorAll('button:not([hidden])')];
      const k = f.indexOf(document.activeElement);
      if (e.shiftKey && k <= 0) { e.preventDefault(); f.at(-1).focus(); } else if (!e.shiftKey && k === f.length - 1) { e.preventDefault(); f[0].focus(); }
    }
  };
  cur.onResize = () => place();
  document.addEventListener('keydown', cur.onKey);
  window.addEventListener('resize', cur.onResize);
  show();
}

function go(d) {
  if (!cur) return;
  const n = cur.i + d;
  if (n >= cur.steps.length) { stopTour(true); return; }
  if (n < 0) return;
  cur.i = n;
  show();
}

function show() {
  const { steps, i, el } = cur;
  const s = steps[i];
  el.querySelector('#tour-h').textContent = s.title;
  el.querySelector('.tour-text').textContent = s.text;
  el.querySelector('.tour-dots').innerHTML = steps.map((_, k) => `<i class="${k === i ? 'on' : k < i ? 'was' : ''}"></i>`).join('');
  el.querySelector('.tour-count').textContent = `Крок ${i + 1} з ${steps.length}`;
  el.querySelector('[data-tour="prev"]').hidden = i === 0;
  el.querySelector('[data-tour="next"]').textContent = i === steps.length - 1 ? (cur.opts.finish ?? 'Почати роботу') : 'Далі';
  el.querySelector('[data-tour="skip"]').hidden = i === steps.length - 1;
  // Ворон «говорить» і махає на кожному кроці; картка зʼявляється заново.
  const card = el.querySelector('.tour-card');
  card.classList.remove('pop', 'talking', 'wave');
  void card.offsetWidth;
  card.classList.add('pop', 'talking', 'wave');
  clearTimeout(cur.talk);
  cur.talk = setTimeout(() => card.classList.remove('talking'), Math.min(2600, 600 + s.text.length * 25));
  s.before?.();
  place();
  el.querySelector('[data-tour="next"]').focus({ preventScroll: true });
}

// Підсвічуємо ціль (якщо видна) й ставимо картку над нею чи під нею; без цілі — по центру.
function place() {
  if (!cur) return;
  const { el } = cur;
  const s = cur.steps[cur.i];
  const target = s.target ? document.querySelector(s.target) : null;
  const r = target && target.getClientRects().length ? target.getBoundingClientRect() : null;
  const hole = el.querySelector('.tour-hole');
  const card = el.querySelector('.tour-card');
  el.classList.toggle('centered', !r);
  if (!r) { hole.style.cssText = ''; card.style.top = ''; card.style.bottom = ''; return; }
  const pad = 6;
  hole.style.cssText = `left:${r.left - pad}px;top:${r.top - pad}px;width:${r.width + pad * 2}px;height:${r.height + pad * 2}px`;
  const below = r.top + r.height / 2 < window.innerHeight / 2;
  card.style.top = below ? `${Math.min(window.innerHeight - 40, r.bottom + 16)}px` : '';
  card.style.bottom = below ? '' : `${Math.max(12, window.innerHeight - r.top + 16)}px`;
}

export function stopTour(done = true) {
  if (!cur) return;
  const { el, opts, opener } = cur;
  document.removeEventListener('keydown', cur.onKey);
  window.removeEventListener('resize', cur.onResize);
  clearTimeout(cur.talk);
  cur = null;
  el.classList.add('closing');
  setTimeout(() => el.remove(), 200);
  document.body.classList.remove('touring');
  if (done && opts.key) store.set(opts.key, true);
  if (done) opts.onDone?.();
  opener?.focus?.({ preventScroll: true });
}
