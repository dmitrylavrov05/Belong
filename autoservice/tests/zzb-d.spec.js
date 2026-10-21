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
test('approve app -> login -> publish; admin add place -> login', async ({ page }) => {
  await seed(page, { 'biz.applications': [{ id: 'a1', device: true, at: at(9), status: 'new', name: 'Хмаринка', city: 'Київ', boxes: '3', address: 'вул. Хрещатик, 1', contact: 'Максим', phone: '+380634444444', email: '', type: 'fop', code: '1234567890' }] });
  await page.goto('/admin.html#/applications');
  await page.getByRole('button', { name: 'Схвалити й видати доступ' }).click();
  const issued = page.locator('.notice.ok .code');
  await expect(issued).toHaveCount(2);
  const [login, password] = await issued.allTextContents();
  console.log('ISSUED', login, password);
  await page.goto('/admin.html#/places');
  console.log('PLACES', (await page.locator('#view').innerText()).replace(/\s+/g, ' ').slice(0, 500));
  await page.evaluate(() => localStorage.setItem('carcar.biz.session', 'null'));
  await page.goto(PRO);
  await page.getByLabel('Логін').fill(login.toUpperCase() + ' ');
  await page.getByLabel('Пароль').fill(password);
  await page.getByRole('button', { name: 'Увійти' }).click();
  await page.waitForTimeout(500);
  console.log('AFTER LOGIN', (await txt(page)).slice(0, 400));
  console.log('TOP', await page.locator('#top').innerText());
  await page.goto(PRO + '#/wash');
  console.log('WASH', (await txt(page)).slice(0, 700));
  await page.screenshot({ path: SS + 'd-wash-setup.png', fullPage: true });
  await page.goto(PRO + '#/profile');
  console.log('PROFILE', (await txt(page)).slice(0, 300));
  await page.goto(PRO + '#/wash');
  const pub = page.getByRole('button', { name: 'Опублікувати мийку' });
  console.log('PUB enabled', await pub.isEnabled());
  await pub.click();
  console.log('TOAST', await page.locator('#toast').innerText());
  // more page / logout label
  await page.goto(PRO + '#/more');
  console.log('MORE-LOGOUT', await page.locator('[data-action="logout"]').innerText());
  // admin add place manual
  await page.goto('/admin.html#/places/new');
  const f = page.locator('#place-new');
  await f.getByLabel('Назва').fill('Мийка Тест');
  await f.getByLabel('Адреса').fill('вул. Тестова, 5');
  await f.getByLabel('Телефон мийки').fill('+380441112233');
  await f.getByLabel('Одразу опублікувати').uncheck();
  await f.getByRole('button', { name: 'Додати мийку' }).click();
  const done = page.locator('.notice.ok');
  await expect(done).toBeVisible();
  console.log('DONE', (await done.innerText()).replace(/\s+/g, ' '));
  const [l2, p2] = await done.locator('.code').allTextContents();
  await page.goto(PRO + '#/more');
  await page.locator('[data-action="logout"]').click();
  await page.getByLabel('Логін').fill(l2);
  await page.getByLabel('Пароль').fill(p2);
  await page.getByRole('button', { name: 'Увійти' }).click();
  await page.waitForTimeout(500);
  console.log('TOP2', await page.locator('#top').innerText());
  await page.goto(PRO + '#/wash');
  console.log('WASH2', (await txt(page)).slice(0, 500));
  await page.goto('/#/');
  await page.evaluate(() => sessionStorage.setItem('carcar.splash', '1'));
  await page.goto('/admin.html#/places');
  console.log('PLACES2', (await page.locator('#view').innerText()).replace(/\s+/g, ' ').slice(0, 600));
});

test('demo toggle off kicks demo cabinet', async ({ page }) => {
  await page.goto(PRO + '#/');
  await page.goto('/admin.html#/demo');
  await page.locator('#demo-form [name="demoWash"]').uncheck();
  await page.locator('#demo-form button[type="submit"]').click();
  await page.goto(PRO + '#/');
  console.log('PRO after demo off', (await txt(page)).slice(0, 300));
});
