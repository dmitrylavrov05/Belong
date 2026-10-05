// Графіки для панелі бізнесу й адмінки CARCAR: стовпчики (складені чи згруповані), горизонтальні
// смуги, легенда, таблиця під графіком і один тултип на сторінку. Палітра — змінні --series-1/2.
import { esc } from './core.js';

export const compact = (v) => (v >= 1000 ? `${(v / 1000).toLocaleString('uk-UA', { maximumFractionDigits: 1 })} тис.` : String(Math.round(v)));

function niceMax(v) {
  if (v <= 0) return 4;
  const step = 10 ** Math.floor(Math.log10(v / 4));
  const m = [1, 2, 2.5, 5, 10].find((k) => (v / 4) <= k * step) * step;
  return m * 4;
}

const topRound = (x, y, w, h) => {
  const r = Math.min(4, h / 2, w / 2);
  return `M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h}Z`;
};

// Стовпчики (одна серія або дві складені), з тултипом на кожну категорію.
export function drawColumns(el, spec) {
  const W = Math.max(280, el.clientWidth);
  const H = spec.height ?? 220;
  const L = 52, R = 6, T = 10, B = 26;
  const n = spec.cats.length;
  const sums = spec.cats.map((c) => c.values.reduce((a, v) => a + v, 0));
  const max = niceMax(Math.max(...(spec.grouped ? spec.cats.flatMap((c) => c.values) : sums), 0));
  const band = (W - L - R) / n;
  const bw = Math.max(2, Math.min(spec.grouped ? 40 : 24, band * (spec.grouped ? 0.76 : 0.66)));
  const y = (v) => T + (H - T - B) * (1 - v / max);
  const every = Math.ceil(n / Math.max(1, Math.floor((W - L) / 56)));
  let g = '<g class="grid">';
  for (let i = 0; i <= 4; i++) {
    const v = (max / 4) * i;
    g += `<line x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}"/><text class="axis" x="${L - 8}" y="${y(v) + 4}" text-anchor="end">${compact(v)}</text>`;
  }
  g += '</g>';
  let marks = '';
  let hits = '';
  spec.cats.forEach((c, i) => {
    const x = L + band * i + (band - bw) / 2;
    let base = H - B;
    // Згруповані стовпчики стоять поруч із проміжком 2 px; складені — один над одним.
    if (spec.grouped) {
      const k = c.values.length;
      const w = Math.max(1, (bw - 2 * (k - 1)) / k);
      c.values.forEach((v, s) => {
        const h = (H - T - B) * (v / max);
        if (h > 0) marks += `<path class="s${s + 1}" d="${topRound(x + s * (w + 2), H - B - h, w, h)}"/>`;
      });
    } else c.values.forEach((v, s) => {
      if (v <= 0) return;
      const h = (H - T - B) * (v / max) - (base < H - B ? 2 : 0);
      if (h <= 0) return;
      const top = base - h - (base < H - B ? 2 : 0);
      const isTop = c.values.slice(s + 1).every((u) => u <= 0);
      marks += isTop
        ? `<path class="s${s + 1}" d="${topRound(x, top, bw, h)}"/>`
        : `<rect class="s${s + 1}" x="${x}" y="${top}" width="${bw}" height="${h}"/>`;
      base = top;
    });
    if (i % every === 0) marks += `<text class="axis" x="${x + bw / 2}" y="${H - 8}" text-anchor="middle">${esc(c.short ?? c.label)}</text>`;
    const tip = { t: c.label, r: spec.series.map((s, k) => [`s${k + 1}`, spec.fmt(c.values[k]), s]) };
    if (spec.grouped) tip.r.push(['', spec.fmt(c.values[0] - c.values[1]), 'Різниця']);
    else if (spec.series.length > 1) tip.r.push(['', spec.fmt(sums[i]), 'Разом']);
    const aria = `${c.label}: ${spec.series.map((s, k) => `${s} ${spec.fmt(c.values[k])}`).join(', ')}`;
    hits += `<rect class="hit" role="img" tabindex="0" aria-label="${esc(aria)}" data-tip="${esc(JSON.stringify(tip))}" x="${L + band * i}" y="${T}" width="${band}" height="${H - T - B}"/>`;
  });
  el.innerHTML = `<svg width="${W}" height="${H}" role="group" aria-label="${esc(spec.title)}">${g}${marks}${hits}</svg>`;
}

export const legend = (names) => `<ul class="legend">${names.map((n, i) => `<li><i class="s${i + 1}"></i>${esc(n)}</li>`).join('')}</ul>`;

export function tableView(head, rows) {
  return `<details class="table-view"><summary>Показати таблицею</summary><div class="details-table"><table class="t">
    <thead><tr>${head.map((h, i) => `<th${i ? ' class="num"' : ''}>${esc(h)}</th>`).join('')}</tr></thead>
    <tbody>${rows.map((r) => `<tr>${r.map((c, i) => `<td${i ? ' class="num"' : ''}>${esc(c)}</td>`).join('')}</tr>`).join('')}</tbody>
  </table></div></details>`;
}

export function hbars(items, fmt) {
  const max = Math.max(...items.map((i) => i.value), 1);
  return `<ul class="hbars">${items.map((i) => `<li>
    <span class="name" title="${esc(i.name)}">${esc(i.name)}</span>
    <span class="track"><span class="fill" style="width:${Math.max(1, (i.value / max) * 100)}%"></span></span>
    <span class="val">${fmt(i.value)}</span></li>`).join('')}</ul>`;
}

// Один тултип на сторінку; значення першим, назва серії — після. Вставляємо через textContent.
export function showTip(target, x, y) {
  const data = JSON.parse(target.dataset.tip);
  const tip = document.getElementById('tip');
  tip.replaceChildren();
  const t = document.createElement('div');
  t.className = 't';
  t.textContent = data.t;
  tip.append(t);
  for (const [cls, value, name] of data.r) {
    const row = document.createElement('div');
    row.className = 'r';
    const k = document.createElement('span');
    k.className = 'k';
    k.style.background = cls ? `var(--series-${cls.slice(1)})` : 'transparent';
    const v = document.createElement('b');
    v.textContent = value;
    const n = document.createElement('span');
    n.textContent = name;
    row.append(k, v, n);
    tip.append(row);
  }
  tip.hidden = false;
  const r = tip.getBoundingClientRect();
  const left = Math.min(window.innerWidth - r.width - 8, Math.max(8, x + 14));
  const top = y - r.height - 12 < 8 ? y + 16 : y - r.height - 12;
  tip.style.left = `${left}px`;
  tip.style.top = `${top}px`;
}
export const hideTip = () => { document.getElementById('tip').hidden = true; };

document.addEventListener('pointermove', (e) => {
  const t = e.target.closest?.('[data-tip]');
  if (t) showTip(t, e.clientX, e.clientY); else hideTip();
});
document.addEventListener('focusin', (e) => {
  const t = e.target.closest?.('[data-tip]');
  if (!t) return hideTip();
  const r = t.getBoundingClientRect();
  showTip(t, r.left + r.width / 2, r.top);
});
