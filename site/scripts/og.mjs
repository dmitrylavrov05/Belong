// Renders the social preview images (1200×630) into src/assets: node scripts/og.mjs
import { chromium } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const assets = fileURLToPath(new URL('../src/assets/', import.meta.url));
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');

const page = (title, lead) => `<!doctype html><html><head><meta charset="utf-8">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Manrope:wght@600;800&display=swap">
<style>
  body { margin: 0; width: 1200px; height: 630px; font-family: Manrope, sans-serif; color: #2B2233;
    background: radial-gradient(700px 500px at 1000px 120px, rgba(92,157,242,.28), transparent 70%),
                radial-gradient(700px 500px at 760px 620px, rgba(240,125,161,.26), transparent 70%), #FFF8F3;
    display: grid; grid-template-columns: 1fr 420px; align-items: center; padding: 0 80px; box-sizing: border-box; }
  .logo { display: flex; align-items: center; gap: 14px; font-weight: 800; font-size: 40px; letter-spacing: -.03em; margin-bottom: 44px; }
  h1 { font-size: 76px; line-height: 1.02; letter-spacing: -.035em; margin: 0 0 24px; font-weight: 800; }
  p { font-size: 28px; line-height: 1.35; color: #6A5F70; margin: 0; font-weight: 600; max-width: 600px; }
  .mark { justify-self: end; }
</style></head><body>
<div><div class="logo">${svg(56)}belong</div><h1>${esc(title)}</h1><p>${esc(lead)}</p></div>
<div class="mark">${svg(360)}</div></body></html>`;

function svg(w) {
  const h = (w * 2) / 3;
  return `<svg width="${w}" height="${h}" viewBox="0 0 48 32"><defs><linearGradient id="g${w}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#F07DA1"/><stop offset="1" stop-color="#5C9DF2"/></linearGradient><clipPath id="c${w}"><circle cx="15" cy="16" r="12"/></clipPath></defs><circle cx="15" cy="16" r="12" fill="#F07DA1"/><circle cx="33" cy="16" r="12" fill="#5C9DF2"/><circle cx="33" cy="16" r="12" fill="url(#g${w})" clip-path="url(#c${w})"/></svg>`;
}

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1200, height: 630 }, ignoreHTTPSErrors: true });
for (const lang of ['en', 'uk']) {
  const d = JSON.parse(readFileSync(new URL(`../src/i18n/${lang}.json`, import.meta.url), 'utf8'));
  const p = await ctx.newPage();
  await p.setContent(page(d.hero.title, d.hero.eyebrow), { waitUntil: 'networkidle' });
  await p.evaluate(() => document.fonts.ready);
  await p.screenshot({ path: `${assets}${d.meta.ogImage}` });
  console.log(`wrote ${d.meta.ogImage}`);
}
await browser.close();
