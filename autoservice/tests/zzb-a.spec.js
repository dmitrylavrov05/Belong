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

test('cash vs wash tiles: yesterday booking marked today', async ({ page }) => {
  await seed(page, { bookings: [
    { id: 'y1', placeId: 'blysk', channel: 'phone', source: 'crm', services: ['Експрес-мийка кузова'], total: 300, paid: 300, bonus: 0, minutes: 30, date: '2026-10-03', time: '12:00', car: 'Golf', cls: 0, clientName: 'Олег', clientPhone: '+380671112233', state: 'booked', createdAt: at(8, 0, 3) },
    { id: 'c1', placeId: 'blysk', channel: 'carcar', services: ['Комплекс'], total: 550, paid: 450, bonus: 100, minutes: 60, date: '2026-10-04', time: '08:30', car: 'RAV4', cls: 0, clientName: 'Ірина', clientPhone: '+380501234567', state: 'paid', createdAt: at(7) },
  ] });
  await page.goto(PRO + '#/bookings');
  await page.screenshot({ path: SS + 'a-bookings.png', fullPage: true });
  console.log('BOOKINGS', await txt(page));
  await page.locator('[data-action="mark-open"]').first().click();
  console.log('MARK', (await page.locator('.pro-sheet').innerText()).replace(/\s+/g, ' '));
  await page.locator('[data-action="mark-done"]').click();
  await page.locator('[data-action="ready"]').click();
  await page.goto(PRO + '#/wash');
  console.log('WASH', await txt(page));
  await page.goto(PRO + '#/cash');
  console.log('CASH', await txt(page));
  await page.goto(PRO + '#/cash/2026-10-03');
  console.log('CASH-Y', await txt(page));
  await page.goto(PRO + '#/analytics');
  console.log('AN', (await txt(page)).slice(0, 400));
});
