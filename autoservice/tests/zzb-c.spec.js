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
test('dispute split money math', async ({ page }) => {
  await seed(page, { bookings: [cc({ id: 'd1', time: '08:00', clientId: 'tel:380671111111', clientName: 'Ірина', clientPhone: '+380671111111', total: 500, paid: 350, bonus: 50, promo: { code: 'X100', amount: 100 }, state: 'completed', completedAt: at(8, 40), unfreezeAt: at(8, 40) + 48 * 3600e3 })],
    'wallet.tel:380671111111': { bonus: 0, money: 0, history: [] } });
  await page.goto(PRO + '#/wash');
  console.log('WASH0', (await txt(page)).replace(/.*Додати мийку/, '').slice(0, 250));
  await page.goto(PRO + '#/cash');
  await page.locator('#shift-form [name="counted"]').fill('0');
  await page.locator('#shift-form button[type="submit"]').click();
  // client opens dispute
  await page.evaluate(() => { localStorage.setItem('carcar.auth', JSON.stringify({ phone: '+380671111111', at: 1 })); localStorage.setItem('carcar.profile', JSON.stringify({ name: 'Ірина', phone: '+380671111111' })); sessionStorage.setItem('carcar.splash', '1'); });
  await page.goto('/#/bookings/d1');
  page.removeAllListeners('dialog');
  page.on('dialog', (d) => d.type() === 'prompt' ? d.accept('Погано помили') : d.accept());
  await page.screenshot({ path: SS + 'c-client-booking.png', fullPage: true });
  const disp = page.locator('[data-action="dispute"]');
  console.log('DISPUTE BTN', await disp.count());
  if (await disp.count()) await disp.first().click();
  console.log('STATE', (await LS(page, 'bookings'))[0].state);
  await page.goto(PRO + '#/booking/d1');
  console.log('PRO SHEET', await sheetTxt(page));
  await page.goto('/admin.html#/disputes');
  console.log('ADMIN', (await page.locator('#view').innerText()).replace(/\s+/g, ' ').slice(0, 700));
  const f = page.locator('.dispute-form').first();
  await f.locator('input[value="split"]').check();
  await f.locator('[name="part"]').fill('200');
  await f.locator('button[type="submit"]').click();
  console.log('TOAST', await page.locator('#toast').innerText());
  console.log('ADMIN2', (await page.locator('#view').innerText()).replace(/\s+/g, ' ').slice(-300));
  const b = (await LS(page, 'bookings'))[0];
  console.log('B', JSON.stringify({ s: b.state, refund: b.refund, pa: b.placeAmount, promo: b.promo, bonusReturned: b.bonusReturned }));
  console.log('WALLET', JSON.stringify(await LS(page, 'wallet.tel:380671111111')));
  await page.goto(PRO + '#/wash');
  console.log('WASH1', (await txt(page)).replace(/.*Додати мийку/, '').slice(0, 250));
  await page.goto(PRO + '#/booking/d1');
  console.log('PRO SHEET2', await sheetTxt(page));
  await page.goto(PRO + '#/cash');
  console.log('CASH', await txt(page));
  await page.goto('/#/bookings/d1');
  console.log('CLIENT', (await page.locator('main').innerText()).replace(/\s+/g, ' ').slice(0, 600));
});
