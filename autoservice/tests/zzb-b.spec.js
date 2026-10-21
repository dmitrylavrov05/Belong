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
test('walk-ins without phone merge into one client', async ({ page }) => {
  await page.goto(PRO + '#/bookings');
  for (const car of ['Golf AA1111', 'Lanos BB2222']) {
    await page.locator('#fab').click();
    await page.getByRole('dialog').getByLabel('Приїхав сам').check({ force: true });
    await page.getByRole('dialog').getByLabel('Авто й номер').fill(car);
    await page.getByRole('dialog').locator('[data-action="nb-svc"]').first().click();
    await page.getByRole('dialog').locator('button[type="submit"]').click();
    await page.waitForTimeout(200);
  }
  const bs = await page.evaluate(() => JSON.parse(localStorage.getItem('carcar.bookings')).map((b) => [b.clientName, b.car, b.time, b.state]));
  console.log('BS', JSON.stringify(bs));
  await page.goto(PRO + '#/clients');
  console.log('CLIENTS', await txt(page));
});

test('lead-only fee -> negative available', async ({ page }) => {
  await seed(page, { bookings: [own({ id: 'l1', time: '08:00', clientName: 'Ліда', clientPhone: '+380501112233', state: 'completed', payment: 'card', completedAt: at(8, 30), lead: 'carcar', leadRate: 0.1, paid: 500, total: 500 })] });
  await page.goto(PRO + '#/wash');
  console.log('WASH', (await txt(page)).replace(/.*Додати мийку/, ''));
});

test('pending alert: propose another day; offer then client view', async ({ page }) => {
  await seed(page, { bookings: [cc({ id: 'p1', time: '12:00', clientId: 'tel:380671111111', clientName: 'Ірина', state: 'pending', needsConfirm: true, createdAt: at(9, 58) })] });
  await page.goto(PRO + '#/');
  const alert = page.getByRole('dialog', { name: 'Новий запис' });
  console.log('ALERT', (await alert.innerText()).replace(/\s+/g, ' '));
  await alert.getByRole('button', { name: /Запропонувати/ }).click();
  const sh = page.getByRole('dialog');
  console.log('PROPOSE', (await sh.innerText()).replace(/\s+/g, ' ').slice(0, 600));
  await sh.getByRole('button', { name: 'Завтра' }).click();
  await page.getByRole('dialog').locator('.slot').first().click();
  console.log('TOAST', await page.locator('#toast').innerText());
  const b = await page.evaluate(() => JSON.parse(localStorage.getItem('carcar.bookings'))[0]);
  console.log('B', JSON.stringify({ s: b.state, d: b.date, t: b.time, offer: b.offer }));
  await page.goto(PRO + '#/bookings/2026-10-05');
  console.log('DAY5', (await txt(page)).slice(-600));
  await page.goto(PRO + '#/wash');
  console.log('WASH', (await txt(page)).replace(/.*Додати мийку/, '').slice(0, 300));
});
