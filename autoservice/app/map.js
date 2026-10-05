// Інтерактивна карта Києва з двома шарами:
// «Детальна» — вулиці й будинки з тайлів OpenStreetMap (потрібен інтернет);
// «Схема» — власна спрощена карта (межа міста, Дніпро, райони), працює без інтернету,
// зокрема під час відключень. Якщо тайли не завантажуються, карта сама перемикається на схему.
// Проєкція — Web Mercator, як у тайлів: одиниця карти — піксель світу на масштабі 12.
import { DISTRICTS } from './data.js';

const MAP_Z0 = 12;
const MAP_TILE = 256;
const MAP_BOX = { minLat: 50.29, maxLat: 50.61, minLng: 30.22, maxLng: 30.82 };
const mapMerc = (lat, lng, z) => {
  const size = MAP_TILE * 2 ** z;
  const sin = Math.sin((lat * Math.PI) / 180);
  return [((lng + 180) / 360) * size, (0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI)) * size];
};
const MAP_ORIGIN = mapMerc(MAP_BOX.maxLat, MAP_BOX.minLng, MAP_Z0);
export const mapProject = (lat, lng) => { const [x, y] = mapMerc(lat, lng, MAP_Z0); return [x - MAP_ORIGIN[0], y - MAP_ORIGIN[1]]; };
const [MAP_W, MAP_H] = mapProject(MAP_BOX.minLat, MAP_BOX.maxLng);
export const TILE_URL = (z, x, y) => `https://tile.openstreetmap.org/${z}/${x}/${y}.png`;

// Спрощена межа міста й русло Дніпра (широта, довгота) — для схеми.
const KYIV_OUTLINE = [[50.59, 30.47], [50.585, 30.56], [50.56, 30.64], [50.53, 30.72], [50.48, 30.78], [50.42, 30.79], [50.37, 30.74],
  [50.33, 30.68], [50.31, 30.6], [50.32, 30.52], [50.35, 30.45], [50.38, 30.37], [50.41, 30.3], [50.45, 30.25], [50.5, 30.28], [50.54, 30.33],
  [50.565, 30.4]];
const DNIPRO = [[50.62, 30.505], [50.585, 30.515], [50.55, 30.525], [50.515, 30.53], [50.49, 30.545], [50.47, 30.56], [50.455, 30.575],
  [50.44, 30.575], [50.425, 30.58], [50.41, 30.59], [50.39, 30.6], [50.37, 30.61], [50.345, 30.625], [50.32, 30.64], [50.28, 30.66]];
const RUSANIVKA = [[50.455, 30.585], [50.445, 30.6], [50.43, 30.6], [50.42, 30.59]];
const DESNA = [[50.6, 30.56], [50.58, 30.545], [50.56, 30.535]];

const pathOf = (pts) => pts.map(([la, ln], i) => `${i ? 'L' : 'M'}${mapProject(la, ln).map((v) => v.toFixed(1)).join(',')}`).join('');

let mapResize = null;

// Малює карту в el і повертає { setPins, draw }. opts: places — [{ id, lat, lng, html, label, cls }],
// pos — {lat, lng} користувача, state — стан між перемальовуваннями (x, y, z, sel, layer),
// onSelect(id), onLayer(layer) — щоб застосунок запамʼятав вибір шару.
export function mountMap(el, opts) {
  const st = opts.state;
  const W = () => el.clientWidth;
  const H = () => el.clientHeight;
  st.layer ??= navigator.onLine === false ? 'scheme' : 'detail';
  const fit = (list) => {
    const pts = list.map((p) => mapProject(p.lat, p.lng));
    const xs = pts.map((p) => p[0]);
    const ys = pts.map((p) => p[1]);
    st.x = xs.length ? (Math.min(...xs) + Math.max(...xs)) / 2 : MAP_W / 2;
    st.y = ys.length ? (Math.min(...ys) + Math.max(...ys)) / 2 : MAP_H / 2;
    // Усі точки з полями, але не ближче за кілька кварталів.
    const spanX = xs.length ? Math.max(...xs) - Math.min(...xs) : MAP_W * 0.6;
    const spanY = ys.length ? Math.max(...ys) - Math.min(...ys) : MAP_H * 0.6;
    st.z = Math.max(0.25, Math.min(4, (W() - 80) / Math.max(spanX, 60), (H() - 100) / Math.max(spanY, 60)));
  };
  if (!st.z) fit(opts.places);
  el.innerHTML = `<div class="map-tiles" aria-hidden="true"></div>
    <svg class="map-svg" aria-hidden="true" preserveAspectRatio="none">
      <rect class="map-land-out" x="-2000" y="-2000" width="${MAP_W + 4000}" height="${MAP_H + 4000}"/>
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
      <button type="button" class="map-btn" data-map="fit" aria-label="Усі точки">⤢</button>
    </div>
    <div class="map-layers" role="group" aria-label="Шар карти">
      <button type="button" data-map="detail">Детальна</button><button type="button" data-map="scheme">Схема</button>
    </div>
    <p class="map-hint"></p>
    <a class="map-attr" href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">© OpenStreetMap</a>`;
  const svg = el.querySelector('svg');
  const tiles = el.querySelector('.map-tiles');
  const layer = el.querySelector('.map-pins');
  let places = opts.places;
  let loaded = 0;
  let failed = 0;

  function setLayer(name, auto) {
    st.layer = name;
    el.classList.toggle('detail', name === 'detail');
    for (const b of el.querySelectorAll('.map-layers button')) b.setAttribute('aria-pressed', b.dataset.map === name);
    el.querySelector('.map-hint').textContent = auto
      ? 'Детальна карта недоступна без інтернету — показуємо схему'
      : name === 'detail' ? 'Перетягуйте й масштабуйте' : 'Схема міста · працює без інтернету';
    if (name === 'scheme') tiles.replaceChildren();
    if (!auto) opts.onLayer?.(name);
    draw();
  }

  // Тайли OpenStreetMap для видимої частини: масштаб тайлів підбираємо так, щоб тайл був близько 256 px.
  function drawTiles(w, h) {
    if (st.layer !== 'detail') return;
    const tz = Math.max(10, Math.min(19, Math.round(MAP_Z0 + Math.log2(st.z))));
    const unit = MAP_TILE * 2 ** (MAP_Z0 - tz);
    const px = unit * st.z;
    const left = st.x - w / 2 / st.z + MAP_ORIGIN[0];
    const top = st.y - h / 2 / st.z + MAP_ORIGIN[1];
    const x0 = Math.floor(left / unit);
    const y0 = Math.floor(top / unit);
    const x1 = Math.floor((left + w / st.z) / unit);
    const y1 = Math.floor((top + h / st.z) / unit);
    const want = new Set();
    for (let tx = x0; tx <= x1; tx++) {
      for (let ty = y0; ty <= y1; ty++) {
        const key = `${tz}/${tx}/${ty}`;
        want.add(key);
        let img = tiles.querySelector(`[data-t="${key}"]`);
        if (!img) {
          img = document.createElement('img');
          img.dataset.t = key;
          img.alt = '';
          img.draggable = false;
          img.decoding = 'async';
          img.onload = () => { loaded++; };
          img.onerror = () => {
            img.remove();
            failed++;
            // Мережа недоступна — переходимо на схему, щоб карта не лишилась порожньою.
            if (!loaded && failed >= 3 && st.layer === 'detail') setLayer('scheme', true);
          };
          img.src = TILE_URL(tz, tx, ty);
          tiles.append(img);
        }
        img.style.width = img.style.height = `${px + 0.5}px`;
        img.style.transform = `translate(${(tx * unit - MAP_ORIGIN[0] - st.x) * st.z + w / 2}px, ${(ty * unit - MAP_ORIGIN[1] - st.y) * st.z + h / 2}px)`;
      }
    }
    for (const img of [...tiles.children]) if (!want.has(img.dataset.t)) img.remove();
  }

  function draw() {
    const w = W();
    const h = H();
    svg.setAttribute('viewBox', `${st.x - w / 2 / st.z} ${st.y - h / 2 / st.z} ${w / st.z} ${h / st.z}`);
    svg.style.setProperty('--z', st.z);
    el.classList.toggle('zoomed', st.z > 0.5);
    drawTiles(w, h);
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

  // Межі масштабу: від усього Києва до окремого будинку.
  const zoomAt = (k, cx = W() / 2, cy = H() / 2) => {
    const nz = Math.max(0.2, Math.min(96, st.z * k));
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
    if (e.target.closest('.map-btn, .map-layers, .map-attr')) return;
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
      const m = b.dataset.map;
      if (m === 'in') zoomAt(1.5);
      else if (m === 'out') zoomAt(1 / 1.5);
      else if (m === 'fit') { fit(places); draw(); }
      else { failed = 0; setLayer(m); }
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
  layer.innerHTML = '';
  setLayer(st.layer, false);
  setPins(places);
  return { setPins, draw };
}
