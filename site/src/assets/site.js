(() => {
  'use strict';

  const R = JSON.parse(document.getElementById('runtime').textContent);
  const LOCALE = R.locale;

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
  const fmt = (str, vars = {}) => str.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m));
  const esc = (s) =>
    String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const icon = (id) => `<svg class="ic" aria-hidden="true"><use href="#${id}"/></svg>`;
  const reduceMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const pageUrl = () => window.location.href.split(/[?#]/)[0];
  const store = {
    get(key) {
      try { return window.localStorage.getItem(key); } catch { return null; }
    },
    set(key, value) {
      try { window.localStorage.setItem(key, value); } catch { /* storage is unavailable */ }
    },
  };

  async function copyText(text, input) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      if (input) { input.focus(); input.select(); }
      return false;
    }
  }

  function shareRowHTML(text, url) {
    const both = `${text} ${url}`;
    const links = [
      ['Telegram', `https://t.me/share/url?url=${encodeURIComponent(url)}&text=${encodeURIComponent(text)}`],
      ['WhatsApp', `https://wa.me/?text=${encodeURIComponent(both)}`],
      ['Threads', `https://www.threads.net/intent/post?text=${encodeURIComponent(both)}`],
    ].map(([name, href]) => `<a href="${esc(href)}" target="_blank" rel="noopener">${name}</a>`);
    if (navigator.share) {
      links.push(`<button type="button" data-act="share" data-text="${esc(text)}" data-url="${esc(url)}">${icon('i-share')}${esc(R.match.shareNative)}</button>`);
    }
    return links.join('');
  }

  document.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-act="share"]');
    if (!btn || !navigator.share) return;
    navigator.share({ text: btn.dataset.text, url: btn.dataset.url }).catch(() => {});
  });

  // Shares a PNG where the device supports sharing files, otherwise downloads it.
  async function deliverPng(blob, filename, text, noteEl, savedMessage) {
    if (!blob) return;
    const file = new File([blob], filename, { type: 'image/png' });
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      try {
        await navigator.share({ files: [file], text });
        return;
      } catch (err) {
        if (err && err.name === 'AbortError') return;
      }
    }
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
    if (noteEl) noteEl.textContent = savedMessage;
  }

  const canvasFont = (weight, size) => `${weight} ${size}px Manrope, system-ui, -apple-system, "Segoe UI", sans-serif`;

  // Fits text into maxWidth by shrinking, then by cutting with an ellipsis.
  function fitText(ctx, text, maxWidth, weight, size, min = 28) {
    let s = size;
    ctx.font = canvasFont(weight, s);
    while (ctx.measureText(text).width > maxWidth && s > min) { s -= 2; ctx.font = canvasFont(weight, s); }
    if (ctx.measureText(text).width <= maxWidth) return text;
    let t = text;
    while (t.length > 1 && ctx.measureText(`${t}…`).width > maxWidth) t = t.slice(0, -1);
    return `${t}…`;
  }

  // Splits text into centred lines no wider than maxWidth; returns the y below the last line.
  function wrapCentered(ctx, text, x, y, maxWidth, lineHeight) {
    const words = text.split(/\s+/);
    const lines = [];
    let line = '';
    for (const w of words) {
      const next = line ? `${line} ${w}` : w;
      if (ctx.measureText(next).width > maxWidth && line) { lines.push(line); line = w; } else line = next;
    }
    if (line) lines.push(line);
    lines.forEach((l, i) => ctx.fillText(l, x, y + i * lineHeight));
    return y + (lines.length - 1) * lineHeight;
  }

  // A heart doodle like the ones partners send each other.
  function sampleDoodle(size) {
    const c = document.createElement('canvas');
    c.width = size;
    c.height = size;
    const g = c.getContext('2d');
    const s = size / 100;
    g.fillStyle = '#FFF8F3';
    g.fillRect(0, 0, size, size);
    g.lineCap = 'round';
    g.lineJoin = 'round';
    g.lineWidth = 3.4 * s;
    g.strokeStyle = '#F07DA1';
    g.beginPath();
    g.moveTo(50 * s, 78 * s);
    g.bezierCurveTo(14 * s, 56 * s, 16 * s, 24 * s, 36 * s, 24 * s);
    g.bezierCurveTo(45 * s, 24 * s, 49 * s, 30 * s, 50 * s, 36 * s);
    g.bezierCurveTo(52 * s, 29 * s, 57 * s, 23 * s, 66 * s, 24 * s);
    g.bezierCurveTo(86 * s, 26 * s, 84 * s, 58 * s, 50 * s, 78 * s);
    g.stroke();
    g.strokeStyle = '#5C9DF2';
    [[80, 18, 6], [18, 80, 4.5]].forEach(([x, y, r]) => {
      g.beginPath();
      g.moveTo((x - r) * s, y * s); g.lineTo((x + r) * s, y * s);
      g.moveTo(x * s, (y - r) * s); g.lineTo(x * s, (y + r) * s);
      g.stroke();
    });
    return c.toDataURL('image/png');
  }

  // ---------- Widgets demo ----------
  function initWidgetsDemo() {
    const pad = $('#pad');
    if (!pad || !pad.getContext) return;
    const T = R.wid;
    const g = pad.getContext('2d');
    const hint = $('#pad-hint');
    const note = $('#pad-note');
    const img = $('#hw-doodle-img');
    const from = $('#hw-doodle-from');
    const widget = $('#hw-doodle');
    let color = '#F07DA1';
    let drawing = false;
    let last = null;
    let strokes = 0;

    img.src = sampleDoodle(300);
    g.lineCap = 'round';
    g.lineJoin = 'round';

    const at = (e) => {
      const r = pad.getBoundingClientRect();
      return [((e.clientX - r.left) * pad.width) / r.width, ((e.clientY - r.top) * pad.height) / r.height];
    };
    pad.addEventListener('pointerdown', (e) => {
      drawing = true;
      last = at(e);
      try { pad.setPointerCapture(e.pointerId); } catch { /* pointer already gone */ }
      g.fillStyle = color;
      g.beginPath();
      g.arc(last[0], last[1], 8, 0, Math.PI * 2);
      g.fill();
      hint.classList.add('is-hidden');
      note.textContent = '';
    });
    pad.addEventListener('pointermove', (e) => {
      if (!drawing) return;
      const p = at(e);
      g.strokeStyle = color;
      g.lineWidth = 16;
      g.beginPath();
      g.moveTo(last[0], last[1]);
      g.lineTo(p[0], p[1]);
      g.stroke();
      last = p;
    });
    const end = () => {
      if (drawing) strokes += 1;
      drawing = false;
    };
    pad.addEventListener('pointerup', end);
    pad.addEventListener('pointercancel', end);
    pad.addEventListener('pointerleave', end);

    $('#pad-colors').addEventListener('click', (e) => {
      const btn = e.target.closest('.swatch');
      if (!btn) return;
      color = btn.dataset.color;
      $$('.swatch', e.currentTarget).forEach((b) => b.setAttribute('aria-pressed', String(b === btn)));
    });
    const clear = () => {
      g.clearRect(0, 0, pad.width, pad.height);
      strokes = 0;
      hint.classList.remove('is-hidden');
    };
    $('#pad-clear').addEventListener('click', () => {
      clear();
      note.textContent = '';
    });
    $('#pad-send').addEventListener('click', () => {
      if (!strokes) {
        note.textContent = T.empty;
        return;
      }
      const out = document.createElement('canvas');
      out.width = 300;
      out.height = 300;
      const o = out.getContext('2d');
      o.fillStyle = '#FFF8F3';
      o.fillRect(0, 0, 300, 300);
      o.drawImage(pad, 0, 0, 300, 300);
      img.src = out.toDataURL('image/png');
      from.textContent = T.from;
      widget.classList.remove('is-new');
      void widget.offsetWidth; // restart the arrival animation
      widget.classList.add('is-new');
      note.textContent = T.sent;
      clear();
      const r = widget.getBoundingClientRect();
      if (r.top < 0 || r.bottom > window.innerHeight) widget.scrollIntoView({ block: 'center', behavior: reduceMotion() ? 'auto' : 'smooth' });
    });

    const time = $('#hw-time');
    const zone = resolveZone(time.dataset.tz);
    const tick = () => { try { if (zone) time.textContent = timeIn(zone, new Date()); } catch { /* keep static time */ } };
    tick();
    setInterval(tick, 20000);
  }

  // ---------- Our month apart ----------
  function initMonth() {
    const form = $('#month-form');
    if (!form) return;
    const M = R.month;
    const me = $('#month-me');
    const partner = $('#month-partner');
    const cityMe = $('#month-city-me');
    const cityPartner = $('#month-city-partner');
    const options = M.cities.map((c) => `<option value="${esc(c.id)}">${esc(c.name)}</option>`).join('');
    cityMe.innerHTML = options;
    cityPartner.innerHTML = options;
    cityMe.value = 'kyiv';
    cityPartner.value = 'toronto';
    me.value = M.defaultMe;
    partner.value = M.defaultPartner;

    const now = new Date();
    const recap = now.getDate() <= 7 ? new Date(now.getFullYear(), now.getMonth() - 1, 1) : new Date(now.getFullYear(), now.getMonth(), 1);
    const monthName = new Intl.DateTimeFormat(LOCALE, { month: 'long' }).format(recap);
    const byId = (id) => M.cities.find((c) => c.id === id) || M.cities[0];
    const rad = (d) => (d * Math.PI) / 180;
    const distance = (a, b) => {
      const h = Math.sin(rad(b.lat - a.lat) / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(rad(b.lon - a.lon) / 2) ** 2;
      return 2 * 6371.0088 * Math.asin(Math.sqrt(h));
    };
    const name = (input, fallback) => input.value.replace(/\s+/g, ' ').trim().slice(0, 24) || fallback;

    function update() {
      const a = byId(cityMe.value);
      const b = byId(cityPartner.value);
      const km = Math.round(distance(a, b) / 10) * 10;
      $('#story-km').textContent = new Intl.NumberFormat(LOCALE).format(km);
      let hours = null;
      try {
        hours = Math.abs(Math.round((offsetMinutes(resolveZone(a.zone), new Date()) - offsetMinutes(resolveZone(b.zone), new Date())) / 30) / 2);
      } catch { /* no time zone data */ }
      if (hours !== null) $('#story-hours').textContent = hours ? fmt(M.hoursTpl, { h: hours }) : M.sameZone;
      $('#story-title').textContent = fmt(M.titleTpl, { month: monthName });
      $('#story-names').textContent = fmt(M.namesTpl, { a: name(me, M.defaultMe), b: name(partner, M.defaultPartner) });
    }
    [me, partner].forEach((el) => el.addEventListener('input', update));
    [cityMe, cityPartner].forEach((el) => el.addEventListener('change', update));
    update();

    $('#month-save').addEventListener('click', async () => {
      const story = $('#month-story');
      const rows = $$('.story__stats > div', story).map((d) => [$('dt', d).textContent, $('dd', d).textContent]);
      const blob = await monthCard({
        title: $('#story-title').textContent,
        names: $('#story-names').textContent,
        km: $('#story-km').textContent,
        kmLabel: $('.story__km span', story).textContent,
        rows,
        footer: M.footer,
      });
      await deliverPng(blob, 'belong-our-month.png', `${$('#story-title').textContent} 💞`, $('#month-note'), M.saved);
    });
  }

  // Draws the 1080×1920 "our month apart" story card.
  async function monthCard(d) {
    const W = 1080;
    const H = 1920;
    const canvas = document.createElement('canvas');
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    try {
      await Promise.all([document.fonts.load(canvasFont(800, 200)), document.fonts.load(canvasFont(700, 48))]);
    } catch { /* fall back to system fonts */ }
    const bg = ctx.createLinearGradient(0, 0, 0, H);
    bg.addColorStop(0, '#FDE2EB');
    bg.addColorStop(0.5, '#FFF8F3');
    bg.addColorStop(1, '#E1EDFD');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, W, H);

    ctx.lineWidth = 10;
    ctx.lineCap = 'round';
    ctx.strokeStyle = '#2B2233';
    ctx.beginPath();
    ctx.ellipse(540, 240, 120, 90, 0, Math.PI * 1.1, Math.PI * 1.9);
    ctx.stroke();
    ctx.fillStyle = '#F07DA1';
    ctx.beginPath(); ctx.arc(432, 262, 30, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#5C9DF2';
    ctx.beginPath(); ctx.arc(648, 262, 30, 0, Math.PI * 2); ctx.fill();

    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = '#2B2233';
    ctx.font = canvasFont(800, 76);
    let y = wrapCentered(ctx, d.title, W / 2, 440, 920, 86);
    ctx.fillStyle = '#6A5F70';
    ctx.fillText(fitText(ctx, d.names, 920, 600, 44), W / 2, y + 80);

    let bigSize = 210;
    ctx.font = canvasFont(800, bigSize);
    while (ctx.measureText(d.km).width > 960 && bigSize > 120) {
      bigSize -= 10;
      ctx.font = canvasFont(800, bigSize);
    }
    const big = ctx.createLinearGradient(200, 0, 880, 0);
    big.addColorStop(0, '#C93F76');
    big.addColorStop(1, '#2F6BC8');
    ctx.fillStyle = big;
    ctx.fillText(d.km, W / 2, y + 330);
    ctx.fillStyle = '#5E5466';
    ctx.fillText(fitText(ctx, d.kmLabel, 920, 700, 48), W / 2, y + 400);

    let top = y + 460;
    d.rows.forEach(([label, value]) => {
      ctx.save();
      ctx.shadowColor = 'rgba(43,34,51,0.08)';
      ctx.shadowBlur = 30;
      ctx.shadowOffsetY = 8;
      ctx.fillStyle = '#FFFFFF';
      ctx.beginPath();
      if (ctx.roundRect) ctx.roundRect(90, top, 900, 112, 38);
      else ctx.rect(90, top, 900, 112);
      ctx.fill();
      ctx.restore();
      ctx.textAlign = 'right';
      ctx.fillStyle = '#2B2233';
      ctx.font = canvasFont(800, 50);
      const valueWidth = ctx.measureText(value).width;
      ctx.fillText(value, 950, top + 74);
      ctx.textAlign = 'left';
      ctx.fillText(fitText(ctx, label, 800 - valueWidth - 60, 600, 40, 26), 130, top + 70);
      top += 130;
    });

    ctx.textAlign = 'center';
    ctx.fillStyle = '#6A5F70';
    ctx.fillText(fitText(ctx, d.footer, 920, 700, 40), W / 2, H - 90);
    return new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
  }

  // ---------- Header ----------
  function initHeader() {
    const header = $('.header');
    const onScroll = () => header.classList.toggle('is-scrolled', window.scrollY > 8);
    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
  }

  // Suggests the other language when the browser prefers it.
  function initLangBanner() {
    const cfg = R.banner;
    const banner = $('#lang-banner');
    if (!cfg.show || !banner || store.get('belong-lang-banner') === 'closed') return;
    const prefs = navigator.languages && navigator.languages.length ? navigator.languages : [navigator.language || ''];
    if (!prefs.some((l) => l.toLowerCase().startsWith(cfg.lang))) return;
    $('#lang-banner-text').textContent = cfg.text;
    $('#lang-banner-link').textContent = cfg.link;
    $('#lang-banner-close-label').textContent = cfg.close;
    banner.hidden = false;
    $('#lang-banner-close').addEventListener('click', () => {
      banner.hidden = true;
      store.set('belong-lang-banner', 'closed');
    });
  }

  // ---------- A day with Belong ----------
  function initMood() {
    const group = $('#moods');
    if (!group) return;
    const note = $('#mood-note');
    const meter = $('#mood-meter');
    group.addEventListener('click', (e) => {
      const btn = e.target.closest('.mood');
      if (!btn) return;
      $$('.mood', group).forEach((b) => b.setAttribute('aria-pressed', String(b === btn)));
      meter.setAttribute('style', `--v:${btn.dataset.energy}`);
      note.textContent = fmt(R.day.moodNote, { mood: btn.dataset.mood, energy: btn.dataset.energy });
    });
  }

  function initThink() {
    const btn = $('#think-btn');
    if (!btn) return;
    const note = $('#think-note');
    let timer;
    btn.addEventListener('click', () => {
      btn.classList.remove('is-sent');
      void btn.offsetWidth; // restart the ripple animation
      btn.classList.add('is-sent');
      note.textContent = R.day.thinkSent;
      if (navigator.vibrate) { try { navigator.vibrate(30); } catch { /* not allowed */ } }
      clearTimeout(timer);
      timer = setTimeout(() => {
        btn.classList.remove('is-sent');
        note.textContent = '';
      }, 3400);
    });
  }

  function initPlan() {
    const seg = $('#plan-seg');
    if (!seg) return;
    seg.addEventListener('click', (e) => {
      const btn = e.target.closest('button[data-owner]');
      if (!btn) return;
      $$('button', seg).forEach((b) => b.setAttribute('aria-pressed', String(b === btn)));
      $$('#plan-list [data-owner]').forEach((li) => { li.hidden = li.dataset.owner !== btn.dataset.owner; });
    });
  }

  function initGratitude() {
    const field = $('#gratitude');
    if (!field) return;
    const chips = $$('#gratitude-chips .chip');
    const note = $('#gratitude-note');
    const list = typeof Intl.ListFormat === 'function' ? new Intl.ListFormat(LOCALE, { style: 'long', type: 'conjunction' }) : null;
    let composed = '';
    const compose = () => {
      const phrases = chips.filter((c) => c.getAttribute('aria-pressed') === 'true').map((c) => c.dataset.phrase);
      if (!phrases.length) return '';
      return `${R.day.gratitudePrefix}${list ? list.format(phrases) : phrases.join(', ')}.`;
    };
    const refresh = () => {
      // Only rewrite the note while it still holds our own text, never what the person typed.
      if (field.value === composed || !field.value.trim()) {
        composed = compose();
        field.value = composed;
      }
    };
    chips.forEach((chip, i) => {
      chip.setAttribute('aria-pressed', String(i !== 1));
      chip.addEventListener('click', () => {
        chip.setAttribute('aria-pressed', String(chip.getAttribute('aria-pressed') !== 'true'));
        refresh();
      });
    });
    refresh();
    $('#gratitude-send').addEventListener('click', () => {
      if (!field.value.trim()) { field.focus(); return; }
      note.textContent = R.day.gratitudeSent;
    });
  }

  function initTalk() {
    const box = $('#talk');
    if (!box) return;
    const qs = R.day.talk;
    const next = $('#talk-next');
    const nextLabel = next.textContent;
    let i = 0;
    const render = () => {
      $('#talk-num').textContent = String(i + 1);
      $('#talk-q').textContent = qs[i][0];
      $('#talk-hint').textContent = qs[i][1];
      $('#talk-progress').textContent = fmt(R.day.talkProgress, { i: i + 1, n: qs.length });
      $$('.talk__bar i', box).forEach((bar, k) => bar.classList.toggle('is-on', k <= i));
      next.textContent = i === qs.length - 1 ? R.day.talkDone : nextLabel;
    };
    const advance = () => { i = (i + 1) % qs.length; render(); };
    next.addEventListener('click', advance);
    $('#talk-skip').addEventListener('click', advance);
    render();
  }

  // ---------- Long distance ----------
  function resolveZone(tz) {
    try {
      new Intl.DateTimeFormat('en', { timeZone: tz });
      return tz;
    } catch {
      return tz === 'Europe/Kyiv' ? 'Europe/Kiev' : null;
    }
  }
  const timeIn = (tz, date) => new Intl.DateTimeFormat(LOCALE, { hour: 'numeric', minute: '2-digit', timeZone: tz }).format(date);
  function offsetMinutes(tz, date) {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
    }).formatToParts(date);
    const get = (type) => Number(parts.find((p) => p.type === type).value);
    return (Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute')) - date.getTime()) / 60000;
  }

  function initDistance() {
    const a = $('#clock-a');
    const b = $('#clock-b');
    if (!a || !b) return;
    const za = resolveZone(a.dataset.tz);
    const zb = resolveZone(b.dataset.tz);
    const diff = $('#clock-diff');
    const tick = () => {
      const now = new Date();
      try {
        if (za) a.textContent = timeIn(za, now);
        if (zb) b.textContent = timeIn(zb, now);
        if (za && zb) {
          const hours = Math.round((offsetMinutes(za, now) - offsetMinutes(zb, now)) / 30) / 2;
          diff.textContent = fmt(R.day.diff, { h: Math.abs(hours) });
        }
      } catch { /* keep the static times */ }
    };
    tick();
    setInterval(tick, 20000);

    const safe = $('#safe-btn');
    const note = $('#safe-note');
    safe.addEventListener('click', () => {
      let time = '';
      try { time = timeIn(za || 'UTC', new Date()); } catch { /* no time zone data */ }
      note.textContent = fmt(R.day.safeSent, { time });
    });
  }

  // ---------- Date Match ----------
  function initMatch() {
    const root = $('#match');
    if (!root) return;
    const M = R.match;
    const cards = M.cards;
    const N = cards.length;
    const status = $('#match-status');
    // mode: local = both on one phone, invited = opened a partner's link, reply = opened partner's results
    const S = { phase: 'intro', who: 'a', mode: 'local', busy: false, a: { name: '', ans: [] }, b: { name: '', ans: [] } };

    const cleanName = (s) => String(s || '').replace(/[\u0000-\u001f]/g, '').replace(/\s+/g, ' ').trim().slice(0, 24);
    const toBits = (ans) => ans.map((v) => (v ? '1' : '0')).join('');
    const fromBits = (s) => (typeof s === 'string' && s.length === N && /^[01]+$/.test(s) ? [...s].map((c) => c === '1') : null);
    const matches = () => cards.filter((_, i) => S.a.ans[i] && S.b.ans[i]);
    const linkFor = (params) => `${pageUrl()}#${new URLSearchParams({ v: '1', ...params }).toString()}`;
    const inviteLink = () => linkFor({ match: toBits(S.a.ans), from: S.a.name });
    const replyLink = () => linkFor({ match: toBits(S.a.ans), from: S.a.name, reply: toBits(S.b.ans), to: S.b.name });

    const cardHTML = (k, layer) => {
      if (layer !== 'top') return `<div class="dcard dcard--${layer}" aria-hidden="true"></div>`;
      const c = cards[k];
      return `<div class="dcard dcard--top" data-top>
        <div class="dcard__art dcard__art--${k % 3}"><span aria-hidden="true">${c.e}</span></div>
        <div class="dcard__body"><span class="dcard__cat">${esc(c.c)}</span><p class="dcard__title">${esc(c.t)}</p></div>
        <span class="stamp stamp--yes" aria-hidden="true">${esc(M.yesStamp)}</span>
        <span class="stamp stamp--no" aria-hidden="true">${esc(M.noStamp)}</span>
      </div>`;
    };
    const stackHTML = (i) =>
      [i + 2 < N ? cardHTML(i + 2, 'back2') : '', i + 1 < N ? cardHTML(i + 1, 'back1') : '', cardHTML(i, 'top')].join('');

    const nameField = (id, label, placeholder, value) => `
      <div class="field">
        <label for="${id}">${esc(label)}</label>
        <input type="text" id="${id}" maxlength="24" autocomplete="off" placeholder="${esc(placeholder)}" value="${esc(value)}" aria-describedby="${id}-err">
        <p class="field__err" id="${id}-err" hidden></p>
      </div>`;

    const copyBlock = (label, link, shareText) => `
      <p class="handoff__label"><b>${esc(label)}</b></p>
      <div class="copyrow">
        <label class="sr" for="match-link">${esc(M.linkLabel)}</label>
        <input type="text" id="match-link" readonly value="${esc(link)}">
        <button type="button" class="btn btn--secondary" data-act="copy-link">${icon('i-copy')}${esc(M.copy)}</button>
      </div>
      <div class="sharerow">${shareRowHTML(shareText, link)}</div>
      <p class="card__note" id="match-copy-note" aria-live="polite"></p>`;

    const views = {
      intro: () => `
        <h3 class="game__title" tabindex="-1">${esc(M.introTitle)}</h3>
        ${nameField('match-name-a', M.nameLabel, M.namePh, S.a.name)}
        <button type="button" class="btn btn--primary btn--lg btn--block" data-act="start-a">${esc(M.start)}</button>
        <div class="deck" aria-hidden="true">${stackHTML(0)}</div>`,

      invited: () => `
        <h3 class="game__title" tabindex="-1">${esc(fmt(M.invitedTitle, { name: S.a.name }))}</h3>
        <p class="game__text">${esc(M.invitedText)}</p>
        ${nameField('match-name-b', M.nameLabel, M.partnerPh, S.b.name)}
        <button type="button" class="btn btn--primary btn--lg btn--block" data-act="start-b">${esc(M.start)}</button>
        <div class="deck" aria-hidden="true">${stackHTML(0)}</div>`,

      swipe: () => {
        const who = S[S.who];
        const i = who.ans.length;
        return `
        <div class="game__top">
          <span class="game__who"><i class="dot dot--${S.who === 'a' ? 'her' : 'him'}"></i>${esc(who.name)}</span>
          <span class="game__count">${esc(fmt(M.progress, { i: i + 1, n: N }))}</span>
        </div>
        <div class="game__bar" aria-hidden="true">${cards.map((_, k) => `<i class="${k < i ? 'is-on' : ''}"></i>`).join('')}</div>
        <div class="deck" tabindex="0" role="group" aria-label="${esc(cards[i].t)}" data-deck>${stackHTML(i)}</div>
        <p class="game__hint">${esc(M.hint)}</p>
        <div class="game__actions">
          <span class="game__btnwrap"><button type="button" class="game__btn" data-act="no" aria-label="${esc(M.no)}">${icon('i-x')}</button><span aria-hidden="true">${esc(M.no)}</span></span>
          <span class="game__btnwrap"><button type="button" class="game__btn game__btn--yes" data-act="yes" aria-label="${esc(M.yes)}">${icon('i-check')}</button><span aria-hidden="true">${esc(M.yes)}</span></span>
        </div>`;
      },

      handoff: () => `
        <h3 class="game__title" tabindex="-1">${esc(fmt(M.handoffTitle, { name: S.a.name }))}</h3>
        <div class="handoff">
          ${nameField('match-name-b', M.partnerNameLabel, M.partnerPh, S.b.name)}
          <button type="button" class="btn btn--primary btn--block" data-act="start-b">${esc(M.passPhone)}</button>
          <p class="handoff__or">${esc(M.or)}</p>
          ${copyBlock(M.sendLink, inviteLink(), M.shareInvite)}
          <p class="game__text">${esc(M.sendNote)}</p>
        </div>`,

      result: () => {
        const ms = matches();
        const k = ms.length;
        const title = k ? fmt(M.resultTitle, { k, n: N }) : M.resultTitleZero;
        return `
        <div class="result">
          <div class="result__head">
            <svg class="result__pair" viewBox="0 0 48 32" aria-hidden="true"><use href="#pair"/></svg>
            <p class="result__names">${esc(`${S.a.name} & ${S.b.name}`)}</p>
            <h3 class="game__title" tabindex="-1" data-result-title>${esc(title)}</h3>
            ${k ? '' : `<p class="game__text">${esc(M.resultZeroText)}</p>`}
          </div>
          ${k ? `<ul class="result__list">${ms.map((c) => `<li><span aria-hidden="true">${c.e}</span>${esc(c.t)}</li>`).join('')}</ul>` : ''}
          <p class="result__note">${esc(M.resultPrivate)}</p>
          <div class="result__actions">
            ${k ? `<button type="button" class="btn btn--primary btn--block" data-act="story">${icon('i-download')}${esc(M.storyCard)}</button>` : ''}
            <p class="card__note" id="match-note" aria-live="polite"></p>
            ${S.mode === 'invited' ? copyBlock(fmt(M.sendBack, { name: S.a.name }), replyLink(), fmt(M.shareResult, { k, n: N })) : ''}
            <button type="button" class="btn btn--secondary btn--block" data-act="again">${icon('i-again')}${esc(M.again)}</button>
          </div>
        </div>`;
      },
    };

    function confetti() {
      if (reduceMotion()) return;
      const box = document.createElement('div');
      box.className = 'confetti';
      box.setAttribute('aria-hidden', 'true');
      const colors = ['#F07DA1', '#5C9DF2', '#F5B85C', '#FDE2EB', '#E1EDFD'];
      for (let i = 0; i < 28; i += 1) {
        const bit = document.createElement('i');
        bit.style.left = `${Math.random() * 100}%`;
        bit.style.background = colors[i % colors.length];
        bit.style.animationDelay = `${Math.random() * 0.6}s`;
        box.appendChild(bit);
      }
      root.appendChild(box);
      setTimeout(() => box.remove(), 3400);
    }

    function render({ focus = null } = {}) {
      root.dataset.phase = S.phase;
      root.innerHTML = views[S.phase]();
      if (S.phase === 'swipe') {
        attachDrag();
        const i = S[S.who].ans.length;
        status.textContent = `${fmt(M.progress, { i: i + 1, n: N })}: ${cards[i].t}`;
      }
      if (S.phase === 'result' && matches().length) confetti();
      if (focus) {
        const el = $(focus, root);
        if (el) el.focus({ preventScroll: true });
      }
    }

    function go(phase, focus = '.game__title') {
      S.phase = phase;
      render({ focus });
    }

    function decide(yes) {
      if (S.busy || S.phase !== 'swipe') return;
      S.busy = true;
      const who = S[S.who];
      who.ans.push(yes);
      const card = $('[data-top]', root);
      const finish = () => {
        S.busy = false;
        if (who.ans.length < N) render({ focus: '[data-deck]' });
        else if (S.who === 'a') go('handoff');
        else go('result');
      };
      if (!card || reduceMotion()) { finish(); return; }
      const stamp = $(yes ? '.stamp--yes' : '.stamp--no', card);
      if (stamp) stamp.style.opacity = '1';
      card.style.transition = 'transform 260ms ease-in, opacity 260ms ease-in';
      card.style.transform = `translateX(${yes ? 520 : -520}px) rotate(${yes ? 24 : -24}deg)`;
      card.style.opacity = '0';
      setTimeout(finish, 240);
    }

    function attachDrag() {
      const card = $('[data-top]', root);
      if (!card) return;
      const yesStamp = $('.stamp--yes', card);
      const noStamp = $('.stamp--no', card);
      let startX = 0;
      let dx = 0;
      let dragging = false;
      card.addEventListener('pointerdown', (e) => {
        if (S.busy || e.button > 0) return;
        dragging = true;
        startX = e.clientX;
        dx = 0;
        card.setPointerCapture(e.pointerId);
        card.classList.add('is-dragging');
      });
      card.addEventListener('pointermove', (e) => {
        if (!dragging) return;
        dx = e.clientX - startX;
        card.style.transform = `translateX(${dx}px) rotate(${dx / 18}deg)`;
        yesStamp.style.opacity = String(Math.max(0, Math.min(1, dx / 90)));
        noStamp.style.opacity = String(Math.max(0, Math.min(1, -dx / 90)));
      });
      const end = () => {
        if (!dragging) return;
        dragging = false;
        card.classList.remove('is-dragging');
        if (Math.abs(dx) > 90) {
          decide(dx > 0);
        } else {
          card.style.transform = '';
          yesStamp.style.opacity = '0';
          noStamp.style.opacity = '0';
        }
      };
      card.addEventListener('pointerup', end);
      card.addEventListener('pointercancel', end);
    }

    function readName(id, message) {
      const input = $(`#${id}`, root);
      const err = $(`#${id}-err`, root);
      const name = cleanName(input.value);
      if (!name) {
        err.textContent = message;
        err.hidden = false;
        input.setAttribute('aria-invalid', 'true');
        input.focus();
        return null;
      }
      return name;
    }

    async function saveStory() {
      const blob = await storyCard(S.a.name, S.b.name, matches(), N, M);
      await deliverPng(blob, 'belong-date-match.png', fmt(M.shareResult, { k: matches().length, n: N }), $('#match-note', root), M.storySaved);
    }

    root.addEventListener('click', async (e) => {
      const btn = e.target.closest('[data-act]');
      if (!btn) return;
      const act = btn.dataset.act;
      if (act === 'start-a') {
        const name = readName('match-name-a', M.nameRequired);
        if (!name) return;
        S.a = { name, ans: [] };
        S.who = 'a';
        go('swipe', '[data-deck]');
      } else if (act === 'start-b') {
        const name = readName('match-name-b', S.mode === 'invited' ? M.yourNameRequired : M.partnerRequired);
        if (!name) return;
        S.b = { name, ans: [] };
        S.who = 'b';
        go('swipe', '[data-deck]');
      } else if (act === 'yes' || act === 'no') {
        decide(act === 'yes');
      } else if (act === 'copy-link') {
        const input = $('#match-link', root);
        const ok = await copyText(input.value, input);
        $('#match-copy-note', root).textContent = ok ? M.copied : M.copyFail;
      } else if (act === 'story') {
        saveStory();
      } else if (act === 'again') {
        S.a.ans = [];
        S.b.ans = [];
        S.mode = 'local';
        if (window.location.hash) window.history.replaceState(null, '', pageUrl() + window.location.search);
        go('intro');
      }
    });

    root.addEventListener('keydown', (e) => {
      if (S.phase !== 'swipe' || e.target.matches('input, textarea')) return;
      if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
        e.preventDefault();
        decide(e.key === 'ArrowRight');
      }
    });

    root.addEventListener('input', (e) => {
      if (e.target.matches('input[aria-invalid]') && cleanName(e.target.value)) {
        e.target.removeAttribute('aria-invalid');
        const err = $(`#${e.target.id}-err`, root);
        if (err) err.hidden = true;
      }
    });

    // A link from a partner: #v=1&match=0101…&from=Name[&reply=…&to=Name]
    const params = new URLSearchParams(window.location.hash.slice(1));
    const theirs = fromBits(params.get('match'));
    const from = cleanName(params.get('from'));
    let opened = false;
    if (theirs && from) {
      S.a = { name: from, ans: theirs };
      const replies = fromBits(params.get('reply'));
      const to = cleanName(params.get('to'));
      if (replies && to) {
        S.b = { name: to, ans: replies };
        S.mode = 'reply';
        S.phase = 'result';
      } else {
        S.mode = 'invited';
        S.phase = 'invited';
      }
      opened = true;
    }
    render();
    if (opened) {
      window.requestAnimationFrame(() => {
        $('#play').scrollIntoView({ block: 'start' });
        const title = $('.game__title', root);
        if (title) title.focus({ preventScroll: true });
      });
    }
  }

  // Draws a 1080×1920 story image with the couple's matches.
  async function storyCard(nameA, nameB, ms, total, M) {
    const W = 1080;
    const H = 1920;
    const canvas = document.createElement('canvas');
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    const font = (weight, size) => `${weight} ${size}px Manrope, system-ui, -apple-system, "Segoe UI", sans-serif`;
    try {
      await Promise.all([document.fonts.load(font(800, 200)), document.fonts.load(font(700, 48))]);
    } catch { /* fall back to system fonts */ }

    ctx.fillStyle = '#FFF8F3';
    ctx.fillRect(0, 0, W, H);
    const glow = (x, y, r, rgb, a) => {
      const g = ctx.createRadialGradient(x, y, 0, x, y, r);
      g.addColorStop(0, `rgba(${rgb},${a})`);
      g.addColorStop(1, `rgba(${rgb},0)`);
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, W, H);
    };
    glow(160, 260, 760, '240,125,161', 0.32);
    glow(940, 1720, 820, '92,157,242', 0.3);

    const pair = (ctx.createLinearGradient(300, 0, 780, 0));
    pair.addColorStop(0, '#F07DA1');
    pair.addColorStop(1, '#5C9DF2');
    const cy = 330;
    const r = 120;
    const ax = W / 2 - 72;
    const bx = W / 2 + 72;
    const disc = (x, fill) => { ctx.beginPath(); ctx.arc(x, cy, r, 0, Math.PI * 2); ctx.fillStyle = fill; ctx.fill(); };
    disc(ax, '#F07DA1');
    disc(bx, '#5C9DF2');
    ctx.save();
    ctx.beginPath();
    ctx.arc(ax, cy, r, 0, Math.PI * 2);
    ctx.clip();
    disc(bx, pair);
    ctx.restore();

    const fit = (text, maxWidth, weight, size, min = 28) => {
      let s = size;
      ctx.font = font(weight, s);
      while (ctx.measureText(text).width > maxWidth && s > min) { s -= 2; ctx.font = font(weight, s); }
      if (ctx.measureText(text).width <= maxWidth) return text;
      let t = text;
      while (t.length > 1 && ctx.measureText(`${t}…`).width > maxWidth) t = t.slice(0, -1);
      return `${t}…`;
    };

    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = '#2B2233';
    ctx.fillText(fit(`${nameA} & ${nameB}`, 900, 700, 60), W / 2, 570);

    ctx.font = font(800, 280);
    const big = ctx.createLinearGradient(260, 0, 820, 0);
    big.addColorStop(0, '#C93F76');
    big.addColorStop(1, '#2F6BC8');
    ctx.fillStyle = big;
    ctx.fillText(`${ms.length}/${total}`, W / 2, 880);

    ctx.fillStyle = '#5E5466';
    ctx.fillText(fit(M.storySub, 900, 700, 52), W / 2, 970);

    const rows = ms.slice(0, 6);
    let y = 1060;
    rows.forEach((c) => {
      ctx.save();
      ctx.shadowColor = 'rgba(43,34,51,0.08)';
      ctx.shadowBlur = 30;
      ctx.shadowOffsetY = 8;
      ctx.fillStyle = '#FFFFFF';
      ctx.beginPath();
      if (ctx.roundRect) ctx.roundRect(120, y, 840, 100, 34);
      else ctx.rect(120, y, 840, 100);
      ctx.fill();
      ctx.restore();
      ctx.textAlign = 'left';
      ctx.font = font(400, 52);
      ctx.fillText(c.e, 156, y + 70);
      ctx.fillStyle = '#2B2233';
      ctx.fillText(fit(c.t, 640, 700, 40, 30), 246, y + 64);
      y += 120;
    });
    if (ms.length > rows.length) {
      ctx.textAlign = 'center';
      ctx.fillStyle = '#7A6F80';
      ctx.font = font(700, 40);
      ctx.fillText(`+${ms.length - rows.length}`, W / 2, y + 50);
    }

    ctx.textAlign = 'center';
    ctx.fillStyle = '#7A6F80';
    ctx.fillText(fit(M.storyCta, 900, 700, 40), W / 2, 1770);
    ctx.fillStyle = '#2B2233';
    ctx.font = font(800, 64);
    ctx.fillText('belong', W / 2, 1850);

    return new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
  }

  // ---------- Date wheel ----------
  function initWheel() {
    const W = R.wheel;
    const wheel = $('#wheel');
    if (!wheel) return;
    const budgetSeg = $('#wheel-budget');
    const placeSeg = $('#wheel-place');
    const spinBtn = $('#wheel-spin');
    const box = $('#wheel-result');
    const note = $('#wheel-note');
    const colors = ['var(--her-tint)', 'var(--him-tint)', 'var(--sunk)'];
    let budget = 1;
    let place = 'home';
    let sectors = [];
    let rotation = 0;
    let spinning = false;
    let current = null;

    budgetSeg.innerHTML = W.budgets
      .map((b, i) => `<button type="button" data-budget="${i}" aria-pressed="${i === budget}">${esc(b)}<span class="sr"> · ${esc(W.budgetNames[i])}</span></button>`)
      .join('');
    placeSeg.innerHTML = ['home', 'out']
      .map((p) => `<button type="button" data-place="${p}" aria-pressed="${p === place}">${esc(W[p])}</button>`)
      .join('');
    $('#wheel-result-label').textContent = W.resultLabel;
    $('#wheel-again').textContent = W.again;
    $('#wheel-send').textContent = W.send;

    const shuffle = (list) => {
      const a = list.slice();
      for (let i = a.length - 1; i > 0; i -= 1) {
        const j = Math.floor(Math.random() * (i + 1));
        [a[i], a[j]] = [a[j], a[i]];
      }
      return a;
    };

    function build() {
      sectors = shuffle(W.ideas.filter((idea) => idea.w === place && idea.b <= budget)).slice(0, 8);
      const seg = 360 / sectors.length;
      wheel.style.background = `conic-gradient(${sectors.map((_, i) => `${colors[i % 3]} ${i * seg}deg ${(i + 1) * seg}deg`).join(', ')})`;
      wheel.innerHTML = sectors
        .map((s, i) => {
          const a = (i + 0.5) * seg;
          return `<div class="wheel__label${a > 180 ? ' is-flipped' : ''}" style="transform: rotate(${a - 90}deg)"><span>${esc(s.s)}</span></div>`;
        })
        .join('');
      box.hidden = true;
    }

    function show(idea) {
      current = idea;
      $('#wheel-result-title').textContent = idea.t;
      $('#wheel-result-meta').textContent = `${W[idea.w]} · ${W.budgetNames[idea.b]}`;
      note.textContent = '';
      box.hidden = false;
    }

    function spin() {
      if (spinning || !sectors.length) return;
      spinning = true;
      spinBtn.disabled = true;
      box.hidden = true;
      const seg = 360 / sectors.length;
      const idx = Math.floor(Math.random() * sectors.length);
      const jitter = (Math.random() - 0.5) * seg * 0.5;
      rotation = Math.ceil(rotation / 360) * 360 + 360 * 5 + (360 - (idx + 0.5) * seg) + jitter;
      const duration = reduceMotion() ? 0 : 3000;
      wheel.style.transitionDuration = `${duration}ms`;
      wheel.style.transform = `rotate(${rotation}deg)`;
      setTimeout(() => {
        spinning = false;
        spinBtn.disabled = false;
        show(sectors[idx]);
      }, duration + 60);
    }

    budgetSeg.addEventListener('click', (e) => {
      const btn = e.target.closest('button[data-budget]');
      if (!btn || spinning) return;
      budget = Number(btn.dataset.budget);
      $$('button', budgetSeg).forEach((b) => b.setAttribute('aria-pressed', String(b === btn)));
      build();
    });
    placeSeg.addEventListener('click', (e) => {
      const btn = e.target.closest('button[data-place]');
      if (!btn || spinning) return;
      place = btn.dataset.place;
      $$('button', placeSeg).forEach((b) => b.setAttribute('aria-pressed', String(b === btn)));
      build();
    });
    spinBtn.addEventListener('click', spin);
    $('#wheel-again').addEventListener('click', spin);
    $('#wheel-send').addEventListener('click', async () => {
      if (!current) return;
      const text = fmt(W.sendText, { idea: current.t });
      if (navigator.share) {
        navigator.share({ text, url: pageUrl() }).catch(() => {});
        return;
      }
      const ok = await copyText(`${text} ${pageUrl()}`);
      note.textContent = ok ? W.sent : `${text} ${pageUrl()}`;
    });
    build();
  }

  // ---------- Waitlist ----------
  function refCode(email) {
    let h = 5381;
    for (const ch of email) h = ((h << 5) + h + ch.codePointAt(0)) >>> 0;
    return h.toString(36).padStart(7, '0').slice(-7);
  }

  function initWaitlist() {
    const form = $('#wl-form');
    if (!form) return;
    const T = R.wl;
    const email = $('#wl-email');
    const partner = $('#wl-partner');
    const submit = $('#wl-submit');
    const formErr = $('#wl-form-err');
    const success = $('#wl-success');
    const valid = (v) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v);
    const refParam = new URLSearchParams(window.location.search).get('ref');
    const ref = refParam && /^[a-z0-9]{4,16}$/i.test(refParam) ? refParam : null;

    const setError = (input, message) => {
      const el = $(`#${input.id}-err`);
      el.textContent = message || '';
      el.hidden = !message;
      if (message) input.setAttribute('aria-invalid', 'true');
      else input.removeAttribute('aria-invalid');
    };
    const check = () => {
      const me = email.value.trim().toLowerCase();
      const them = partner.value.trim().toLowerCase();
      const errors = new Map();
      if (!valid(me)) errors.set(email, T.errEmail);
      if (them && !valid(them)) errors.set(partner, T.errPartner);
      else if (them && them === me) errors.set(partner, T.errSame);
      return { me, them, errors };
    };
    [email, partner].forEach((input) => {
      input.addEventListener('input', () => {
        if (!input.hasAttribute('aria-invalid')) return;
        setError(input, check().errors.get(input));
      });
    });

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const { me, them, errors } = check();
      setError(email, errors.get(email));
      setError(partner, errors.get(partner));
      if (errors.size) {
        errors.keys().next().value.focus();
        return;
      }
      const payload = {
        email: me,
        partner: them || null,
        platform: form.elements.platform.value,
        lang: document.documentElement.lang,
        ref,
        page: pageUrl(),
        ts: new Date().toISOString(),
      };
      formErr.hidden = true;
      submit.disabled = true;
      try {
        const endpoint = form.dataset.endpoint;
        if (endpoint) {
          const res = await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
        } else {
          store.set('belong-waitlist', JSON.stringify(payload));
        }
        showSuccess(payload);
      } catch {
        formErr.textContent = T.errNetwork;
        formErr.hidden = false;
      } finally {
        submit.disabled = false;
      }
    });

    function showSuccess(p) {
      form.hidden = true;
      success.hidden = false;
      const partnerLine = $('#wl-ok-partner');
      if (p.partner) {
        partnerLine.textContent = fmt(T.okPartner, { email: p.partner });
        partnerLine.hidden = false;
      }
      const link = `${pageUrl()}?ref=${refCode(p.email)}`;
      const input = $('#wl-ref');
      input.value = link;
      $('#wl-share').innerHTML = shareRowHTML(T.shareText, link);
      $('#wl-ref-copy').onclick = async () => {
        const ok = await copyText(link, input);
        $('#wl-ref-note').textContent = ok ? T.copied : T.copyFail;
      };
      success.focus();
    }
  }

  initHeader();
  initLangBanner();
  initMood();
  initThink();
  initPlan();
  initGratitude();
  initTalk();
  initDistance();
  initMatch();
  initWheel();
  initWidgetsDemo();
  initMonth();
  initWaitlist();
})();
