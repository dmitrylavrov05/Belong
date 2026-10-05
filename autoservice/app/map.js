// Інтерактивна схема Києва без зовнішніх тайлів: працює без інтернету (зокрема під час відключень).
// Межа міста, Дніпро й центри районів — спрощені, щоб зорієнтуватися; для маршруту є Google Maps.
// Масштаб і зсув — у «одиницях карти» (тисячні градуса широти); на екрані — пікселі.
import { DISTRICTS } from './data.js';

const MAP_BOX = { minLat: 50.29, maxLat: 50.61, minLng: 30.22, maxLng: 30.82 };
const MAP_K = Math.cos((50.45 * Math.PI) / 180);
export const mapProject = (lat, lng) => [(lng - MAP_BOX.minLng) * MAP_K * 1000, (MAP_BOX.maxLat - lat) * 1000];
const MAP_W = (MAP_BOX.maxLng - MAP_BOX.minLng) * MAP_K * 1000;
const MAP_H = (MAP_BOX.maxLat - MAP_BOX.minLat) * 1000;

// Спрощена межа міста й русло Дніпра (широта, довгота).
const KYIV_OUTLINE = [[50.59, 30.47], [50.585, 30.56], [50.56, 30.64], [50.53, 30.72], [50.48, 30.78], [50.42, 30.79], [50.37, 30.74],
  [50.33, 30.68], [50.31, 30.6], [50.32, 30.52], [50.35, 30.45], [50.38, 30.37], [50.41, 30.3], [50.45, 30.25], [50.5, 30.28], [50.54, 30.33],
  [50.565, 30.4]];
const DNIPRO = [[50.62, 30.505], [50.585, 30.515], [50.55, 30.525], [50.515, 30.53], [50.49, 30.545], [50.47, 30.56], [50.455, 30.575],
  [50.44, 30.575], [50.425, 30.58], [50.41, 30.59], [50.39, 30.6], [50.37, 30.61], [50.345, 30.625], [50.32, 30.64], [50.28, 30.66]];
// Русанівська протока й Труханів острів — щоб лівий берег читався.
const RUSANIVKA = [[50.455, 30.585], [50.445, 30.6], [50.43, 30.6], [50.42, 30.59]];
const DESNA = [[50.6, 30.56], [50.58, 30.545], [50.56, 30.535]];

const pathOf = (pts) => pts.map(([la, ln], i) => `${i ? 'L' : 'M'}${mapProject(la, ln).map((v) => v.toFixed(1)).join(',')}`).join('');

// Малює карту в el і повертає функцію, яка оновлює піни (під час фільтрації стан масштабу зберігається).
// opts: places — [{ id, lat, lng, html, label, cls }], pos — {lat, lng} користувача, state — обʼєкт зі станом
// (x, y, z), який живе між перемальовуваннями, onSelect(id).
let mapResize = null;

export function mountMap(el, opts) {
  const st = opts.state;
  const W = () => el.clientWidth;
  const H = () => el.clientHeight;
  // Увесь Київ у кадрі, центр — середина точок.
  const fit = (list) => {
    const pts = list.map((p) => mapProject(p.lat, p.lng));
    const xs = pts.map((p) => p[0]);
    const ys = pts.map((p) => p[1]);
    st.x = xs.length ? (Math.min(...xs) + Math.max(...xs)) / 2 : MAP_W / 2;
    st.y = ys.length ? (Math.min(...ys) + Math.max(...ys)) / 2 : MAP_H / 2;
    // Масштаб — щоб усі точки помістилися з полями, але не ближче за кілька кварталів.
    const spanX = xs.length ? Math.max(...xs) - Math.min(...xs) : MAP_W * 0.6;
    const spanY = ys.length ? Math.max(...ys) - Math.min(...ys) : MAP_H * 0.6;
    st.z = Math.max(0.8, Math.min(6, (W() - 80) / Math.max(spanX, 20), (H() - 100) / Math.max(spanY, 20)));
  };
  if (!st.z) fit(opts.places);
  el.innerHTML = `<svg class="map-svg" aria-hidden="true" preserveAspectRatio="none">
      <rect class="map-land-out" x="-200" y="-200" width="${MAP_W + 400}" height="${MAP_H + 400}"/>
      <path class="map-city" d="${pathOf(KYIV_OUTLINE)}Z"/>
      <path class="map-water" d="${pathOf(DNIPRO)}"/>
      <path class="map-water thin" d="${pathOf(RUSANIVKA)}"/>
      <path class="map-water thin" d="${pathOf(DESNA)}"/>
      ${Object.entries(DISTRICTS).map(([name, [la, ln]]) => { const [x, y] = mapProject(la, ln); return `<text class="map-label" x="${x}" y="${y}">${name}</text>`; }).join('')}
    </svg>
    <div class="map-pins"></div>
    <div class="map-ctrl">
      <button type="button" class="map-btn" data-map="in" aria-label="Наблизити">+</button>
      <button type="button" class="map-btn" data-map="out" aria-label="Віддалити">−</button>
      <button type="button" class="map-btn" data-map="fit" aria-label="Увесь Київ">⤢</button>
    </div>
    <p class="map-hint">Схема міста · перетягуйте й масштабуйте</p>`;
  const svg = el.querySelector('svg');
  const layer = el.querySelector('.map-pins');
  let places = opts.places;

  function draw() {
    const w = W();
    const h = H();
    svg.setAttribute('viewBox', `${st.x - w / 2 / st.z} ${st.y - h / 2 / st.z} ${w / st.z} ${h / st.z}`);
    svg.style.setProperty('--z', st.z);
    el.classList.toggle('zoomed', st.z > 2.2);
    for (const pin of layer.children) {
      const [x, y] = pin.dataset.xy.split(',').map(Number);
      pin.style.transform = `translate(${(x - st.x) * st.z + w / 2}px, ${(y - st.y) * st.z + h / 2}px)`;
    }
  }

  function setPins(list) {
    places = list;
    layer.innerHTML = list.map((p) => `<button type="button" class="pin ${p.cls}${p.id === st.sel ? ' sel' : ''}" data-pin="${p.id}" data-xy="${mapProject(p.lat, p.lng).join(',')}"
      aria-label="${p.label}" aria-pressed="${p.id === st.sel}">${p.html}</button>`).join('')
      + (opts.pos ? `<span class="me-dot" data-xy="${mapProject(opts.pos.lat, opts.pos.lng).join(',')}" role="img" aria-label="Ви тут"></span>` : '');
    draw();
  }

  const zoomAt = (k, cx = W() / 2, cy = H() / 2) => {
    const nz = Math.max(0.8, Math.min(14, st.z * k));
    // Точка під курсором лишається на місці.
    st.x += (cx - W() / 2) / st.z - (cx - W() / 2) / nz;
    st.y += (cy - H() / 2) / st.z - (cy - H() / 2) / nz;
    st.z = nz;
    draw();
  };

  // Перетягування мишею чи пальцем, щипок двома пальцями.
  const pointers = new Map();
  let pinchDist = 0;
  let moved = 0;
  el.addEventListener('pointerdown', (e) => {
    if (e.target.closest('.map-btn')) return;
    pointers.set(e.pointerId, [e.clientX, e.clientY]);
    moved = 0;
    if (pointers.size === 2) { const [a, b] = [...pointers.values()]; pinchDist = Math.hypot(a[0] - b[0], a[1] - b[1]); }
  });
  el.addEventListener('pointermove', (e) => {
    if (!pointers.has(e.pointerId)) return;
    const [px, py] = pointers.get(e.pointerId);
    pointers.set(e.pointerId, [e.clientX, e.clientY]);
    if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      const d = Math.hypot(a[0] - b[0], a[1] - b[1]);
      const r = el.getBoundingClientRect();
      if (pinchDist) zoomAt(d / pinchDist, (a[0] + b[0]) / 2 - r.left, (a[1] + b[1]) / 2 - r.top);
      pinchDist = d;
      return;
    }
    moved += Math.abs(e.clientX - px) + Math.abs(e.clientY - py);
    if (moved > 4 && !el.hasPointerCapture(e.pointerId)) el.setPointerCapture(e.pointerId);
    st.x -= (e.clientX - px) / st.z;
    st.y -= (e.clientY - py) / st.z;
    draw();
  });
  const up = (e) => { pointers.delete(e.pointerId); if (pointers.size < 2) pinchDist = 0; };
  el.addEventListener('pointerup', up);
  el.addEventListener('pointercancel', up);
  el.addEventListener('wheel', (e) => {
    e.preventDefault();
    const r = el.getBoundingClientRect();
    zoomAt(e.deltaY < 0 ? 1.25 : 0.8, e.clientX - r.left, e.clientY - r.top);
  }, { passive: false });
  el.addEventListener('click', (e) => {
    const b = e.target.closest('[data-map]');
    if (b) {
      if (b.dataset.map === 'in') zoomAt(1.5);
      else if (b.dataset.map === 'out') zoomAt(1 / 1.5);
      else { fit(places); draw(); }
      return;
    }
    const pin = e.target.closest('[data-pin]');
    if (pin && moved < 6) {
      st.sel = pin.dataset.pin;
      for (const x of layer.querySelectorAll('[data-pin]')) {
        x.classList.toggle('sel', x === pin);
        x.setAttribute('aria-pressed', x === pin);
      }
      opts.onSelect(st.sel);
    }
  });
  // Клавіатура: стрілки зсувають, + і − масштабують.
  el.addEventListener('keydown', (e) => {
    if (e.target !== el) return;
    const step = 60 / st.z;
    const keys = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
    if (keys[e.key]) { st.x += keys[e.key][0]; st.y += keys[e.key][1]; draw(); e.preventDefault(); }
    if (e.key === '+' || e.key === '=') { zoomAt(1.25); e.preventDefault(); }
    if (e.key === '-') { zoomAt(0.8); e.preventDefault(); }
  });
  if (mapResize) window.removeEventListener('resize', mapResize);
  mapResize = draw;
  window.addEventListener('resize', mapResize);
  setPins(places);
  return { setPins, draw };
}
