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
test('payout flow + admin', async ({ page }) => {
  const old = at(8, 0, 1);
  await seed(page, { bookings: [
    cc({ id: 'o1', date: '2026-10-01', time: '08:00', clientName: 'А', total: 1000, paid: 1000, state: 'completed', completedAt: old, unfreezeAt: old + 48 * 3600e3 }),
    cc({ id: 'o2', date: '2026-10-04', time: '08:00', clientName: 'Б', total: 400, paid: 300, bonus: 100, state: 'completed', completedAt: at(8, 30), unfreezeAt: at(8, 30) + 48 * 3600e3 }),
  ] });
  await page.goto(PRO + '#/payout');
  await page.getByLabel('IBAN').fill('UA213223130000026007233566001');
  await page.getByLabel(/Отримувач/).fill('ФОП Тест');
  await page.getByLabel(/РНОКПП/).fill('1234567899');
  await page.getByRole('button', { name: 'Надіслати на перевірку' }).click();
  console.log('TOAST', await page.locator('#toast').innerText());
  console.log('PAYOUT', await txt(page));
  await page.goto('/admin.html#/places/blysk');
  console.log('ADMIN PLACE', (await page.locator('#view').innerText()).replace(/\s+/g, ' ').slice(0, 1600));
  const btn = page.getByRole('button', { name: /Підтвердити зміни/ });
  console.log('approve-update btn', await btn.count());
  if (await btn.count()) await btn.click();
  await page.goto(PRO + '#/wash');
  console.log('WASH', (await txt(page)).replace(/.*Додати мийку/, '').slice(0, 450));
  const pay = page.locator('[data-action="payout"]');
  if (await pay.count()) {
    page.removeAllListeners('dialog');
    page.on('dialog', (d) => { console.log('CONFIRM', d.message()); d.accept(); });
    await pay.click();
    console.log('WASH-after', (await txt(page)).replace(/.*Додати мийку/, '').slice(0, 450));
  }
  console.log('PAYOUTS', JSON.stringify(await LS(page, 'payouts')));
  await page.goto('/admin.html#/commission');
  console.log('ADMIN COMM', (await page.locator('#view').innerText()).replace(/\s+/g, ' ').slice(0, 900));
  await page.goto('/admin.html#/');
  console.log('ADMIN OV', (await page.locator('#view').innerText()).replace(/\s+/g, ' ').slice(0, 900));
});
