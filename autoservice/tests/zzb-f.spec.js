import { test, expect } from '@playwright/test';
import { payStep } from './pay-step.js';
const SS = '/tmp/claude-0/-home-user-Belong/84350dd0-4a17-561f-9c37-32f6d1d43256/scratchpad/qa2-biz/';
test.beforeEach(async ({ page }) => {
  await payStep(page);
  await page.addInitScript(() => {
    if (!location.protocol.startsWith('http')) return;
    localStorage.getItem('carcar.auth') ?? localStorage.setItem('carcar.auth', '{"phone":"","at":1}');
    localStorage.getItem('carcar.biz.session') ?? localStorage.setItem('carcar.biz.session', '{"demo":true}');
    localStorage.getItem('carcar.admin.promos') ?? localStorage.setItem('carcar.admin.promos', '[]');
    localStorage.getItem('carcar.partner') ?? localStorage.setItem('carcar.partner', '"blysk"');
  });
  await page.clock.setFixedTime(new Date(2026, 9, 4, 10, 0));
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  page.on('dialog', (d) => d.accept());
  page.errors = errors;
});
test.afterEach(async ({ page }) => { console.log('ERRORS', JSON.stringify(page.errors)); });
const PRO = '/pro.html';
const at = (h, m = 0, day = 4) => new Date(2026, 9, day, h, m).getTime();
async function seed(page, obj) {
  await page.goto(PRO);
  await page.evaluate((o) => { for (const [k, v] of Object.entries(o)) localStorage.setItem('carcar.' + k, JSON.stringify(v)); }, obj);
  await page.goto('about:blank');
}
const txt = async (page, sel = 'main, #view') => (await page.locator('#view').innerText()).replace(/\s+/g, ' ');
const own = (x) => ({ placeId: 'blysk', channel: 'phone', source: 'crm', services: ['Експрес-мийка кузова'], bonus: 0, minutes: 30, date: '2026-10-04', cls: 0, createdAt: at(7), total: 300, paid: 300, ...x });
const cc = (x) => ({ placeId: 'blysk', channel: 'carcar', services: ['Експрес-мийка кузова'], bonus: 0, minutes: 30, date: '2026-10-04', cls: 0, createdAt: at(7), total: 300, paid: 300, ...x });
const sheetTxt = async (page) => (await page.locator('.pro-sheet').innerText()).replace(/\s+/g, ' ');
const LS = (page, k) => page.evaluate((k) => JSON.parse(localStorage.getItem('carcar.' + k)), k);
test('demo seed: analytics vs wash vs cash', async ({ page }) => {
  await page.goto(PRO + '#/more');
  await page.locator('[data-action="demo-seed"]').click();
  await page.goto(PRO + '#/wash');
  console.log('WASH', (await txt(page)).replace(/.*Додати мийку/, '').slice(0, 300));
  await page.goto(PRO + '#/analytics');
  await page.getByRole('button', { name: '7 днів' }).click();
  console.log('AN7', (await txt(page)).slice(0, 900));
  await page.screenshot({ path: SS + 'f-analytics.png', fullPage: true });
  // compute cash totals across last 7 days
  let sum = 0; let cars = 0;
  for (let d = 28; d <= 34; d++) {
    const date = new Date(2026, 8, d); const iso = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
    await page.goto(PRO + '#/cash/' + iso);
    const t = await page.locator('.tile.hero').innerText();
    const m = t.replace(/\s/g, '').match(/Разомзадень([\d]+)₴(\d+)/);
    sum += Number(m[1]); cars += Number(m[2]);
  }
  console.log('CASH7', sum, cars);
  await page.goto(PRO + '#/staff');
  console.log('STAFF', (await txt(page)).slice(0, 900));
  await page.getByRole('button', { name: '7 днів' }).click();
  console.log('STAFF7', (await page.locator('#h-sal').locator('..').innerText()).replace(/\s+/g, ' '));
  await page.goto(PRO + '#/clients');
  console.log('CLIENTS', (await txt(page)).slice(0, 500));
  await page.goto('/admin.html#/');
  console.log('ADMIN', (await page.locator('.kpis').innerText()).replace(/\s+/g, ' '));
  await page.goto('/admin.html#/stats');
  console.log('ADMIN STATS', (await page.locator('#view').innerText()).replace(/\s+/g, ' ').slice(0, 1500));
});
