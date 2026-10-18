import { test, expect } from '@playwright/test';
import { payStep } from './pay-step.js';
import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Спільні дані через сервер CARCAR (deploy/server/carcar_sync.py): різні «пристрої» — окремі контексти браузера
// без спільного localStorage. Клієнт записується — мийка бачить і приймає — клієнт бачить підтвердження;
// інший клієнт чужих записів не бачить.
test.describe.configure({ mode: 'serial' });

let server;
let base;

test.beforeAll(async ({}, info) => {
  const port = 5310 + info.workerIndex + (info.project.name === 'mobile' ? 20 : 0);
  const db = join(mkdtempSync(join(tmpdir(), 'carcar-sync-')), 'data.db');
  server = spawn('python3', ['../deploy/server/carcar_sync.py', '--port', String(port), '--db', db, '--static', 'app'], { stdio: 'pipe' });
  await new Promise((ok, no) => {
    server.stdout.on('data', (d) => String(d).includes('CARCAR sync') && ok());
    server.on('exit', (code) => no(new Error(`sync server exited ${code}`)));
  });
  base = `http://127.0.0.1:${port}`;
});

test.afterAll(() => server?.kill());

// Окремий «телефон»: свій браузерний контекст, свій вхід.
async function device(browser, init, arg) {
  const ctx = await browser.newContext({ baseURL: base, locale: 'uk-UA', reducedMotion: 'reduce' });
  await ctx.addInitScript(init, arg);
  const page = await ctx.newPage();
  await payStep(page);
  await page.clock.setFixedTime(new Date(2026, 9, 4, 10, 0));
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.errors = errors;
  return page;
}
// Вхід через сервер: клієнт — демо-вхід за номером (без Telegram-бота), мийка — демо-кабінет.
async function token(path, body) {
  const r = await fetch(`${base}/api/auth/${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  return (await r.json()).token;
}
const client = async (browser, phone, name) => device(browser, ([p, n, t]) => {
  sessionStorage.setItem('carcar.splash', '1');
  localStorage.getItem('carcar.auth') ?? localStorage.setItem('carcar.auth', JSON.stringify({ phone: p, at: 1 }));
  localStorage.getItem('carcar.profile') ?? localStorage.setItem('carcar.profile', JSON.stringify({ name: n, phone: p }));
  localStorage.getItem('carcar.auth.token') ?? localStorage.setItem('carcar.auth.token', JSON.stringify(t));
}, [phone, name, await token('demo', { phone })]);
const wash = async (browser) => device(browser, (t) => {
  localStorage.getItem('carcar.biz.session') ?? localStorage.setItem('carcar.biz.session', '{"demo":true}');
  localStorage.getItem('carcar.partner') ?? localStorage.setItem('carcar.partner', '"blysk"');
  localStorage.getItem('carcar.biz.token') ?? localStorage.setItem('carcar.biz.token', JSON.stringify(t));
}, await token('biz', { demo: true }));

test('різні пристрої бачать ті самі дані: запис клієнта → мийка приймає → клієнт бачить підтвердження', async ({ browser }) => {
  const ira = await client(browser, '+380 67 111 11 11', 'Ірина');
  const pro = await wash(browser);
  await pro.goto('/pro.html#/bookings');
  await expect(pro.locator('#view h1')).toHaveText('Записи');

  // Клієнт записується й оплачує на своєму телефоні.
  await ira.goto('/#/book/blysk');
  await ira.getByLabel(/Експрес-мийка кузова/).check();
  await ira.locator('[data-action="to-time"]').click();
  await ira.getByRole('button', { name: /Завтра/ }).click();
  await ira.locator('.slot[data-time="10:00"]').click();
  await ira.locator('[data-action="confirm"]').click();
  await ira.getByRole('button', { name: /^Оплатити/ }).click();
  await expect(ira.locator('#toast')).toHaveText('Оплачено. Чекаємо, коли мийка підтвердить запис');

  // Мийка на іншому пристрої отримує запис без перезавантаження й приймає його.
  const alert = pro.getByRole('dialog', { name: 'Новий запис' });
  await expect(alert).toContainText('Ірина', { timeout: 15000 });
  await alert.getByRole('button', { name: 'Прийняти' }).click();
  await expect(pro.locator('.toast')).toContainText('Запис прийнято');

  // Клієнт бачить підтвердження одразу.
  await expect(ira.locator('.answer-banner')).toContainText('Запис підтверджено', { timeout: 15000 });

  // Повідомлення в чаті запису доходить до мийки.
  const id = await ira.evaluate(() => JSON.parse(localStorage.getItem('carcar.bookings')).find((b) => !b.source).id);
  await ira.goto(`/#/chat/${id}`);
  await ira.getByLabel('Повідомлення мийці').fill('Буду на 5 хвилин раніше');
  await ira.getByRole('button', { name: 'Надіслати', exact: true }).click();
  await pro.goto('/pro.html#/');
  await expect(pro.locator('.convo', { hasText: 'Ірина' })).toContainText('Буду на 5 хвилин раніше', { timeout: 15000 });

  // Інший клієнт бачить, що час зайнятий, але не бачить чужого запису.
  const oleh = await client(browser, '+380 50 222 22 22', 'Олег');
  await oleh.goto('/#/bookings');
  await expect(oleh.locator('article.bk')).toHaveCount(0);
  await oleh.goto('/#/inbox');
  await expect(oleh.locator('main')).not.toContainText('Автомийка «Блиск»: запис');

  for (const p of [ira, pro, oleh]) expect(p.errors).toEqual([]);
});

test('ціна, змінена мийкою, одразу видна клієнтам на інших пристроях', async ({ browser }) => {
  const pro = await wash(browser);
  const ira = await client(browser, '+380 67 111 11 11', 'Ірина');
  await ira.goto('/#/place/blysk');
  await pro.goto('/pro.html#/profile');
  await pro.locator('[data-action="svc-edit"]').first().click();
  const f = pro.locator('#svc-form');
  await f.getByLabel('Легкове').fill('333');
  await f.getByRole('button', { name: /Зберегти/ }).click();
  await expect(ira.locator('main')).toContainText('333 ₴', { timeout: 15000 });
  for (const p of [ira, pro]) expect(p.errors).toEqual([]);
});

test('дзвінок між різними пристроями: клієнт дзвонить, мийка бачить вхідний і відповідає', async ({ browser }) => {
  const pro = await wash(browser);
  const ira = await client(browser, '+380 67 111 11 11', 'Ірина');
  await pro.goto('/pro.html#/bookings');
  await ira.goto('/#/place/blysk');
  await ira.getByRole('button', { name: 'Подзвонити', exact: true }).click();
  const inc = pro.locator('#call-screen');
  await expect(inc).toContainText('Вхідний дзвінок CARCAR', { timeout: 15000 });
  await expect(inc).toContainText('Ірина');
  await inc.getByRole('button', { name: 'Відповісти' }).click();
  await expect(ira.locator('#call-screen #call-time')).toBeVisible({ timeout: 15000 });
  await ira.locator('#call-screen').getByRole('button', { name: 'Завершити' }).click();
  await expect(inc).toContainText('Дзвінок завершено', { timeout: 15000 });
});

test('на сервері вхід обовʼязковий: без ключа — екран входу, після коду — застосунок із ключем сервера', async ({ browser }) => {
  const page = await device(browser, () => {
    sessionStorage.setItem('carcar.splash', '1');
    // Старий вхід «лише на телефоні» без ключа сервера не пускає далі.
    localStorage.setItem('carcar.auth', JSON.stringify({ phone: '+380 63 333 33 33', at: 1 }));
  });
  await page.goto('/#/bookings');
  await expect(page.getByRole('heading', { name: 'Вхід у CARCAR' })).toBeVisible();
  await page.getByLabel('Ваше імʼя').fill('Марія');
  await page.getByLabel('Номер телефону').fill('63 333 33 33');
  await page.getByRole('button', { name: 'Отримати код' }).click();
  const code = await page.locator('.auth-card .code').textContent();
  // Четверта цифра підтверджує код сама.
  for (const [i, d] of [...code].entries()) await page.locator('.code-cell').nth(i).fill(d);
  await expect(page.locator('#view h1')).toHaveText('Мої записи', { timeout: 10000 });
  const t = await page.evaluate(() => JSON.parse(localStorage.getItem('carcar.auth.token')));
  const me = await (await fetch(`${base}/api/me`, { headers: { Authorization: `Bearer ${t}` } })).json();
  expect(me).toMatchObject({ role: 'client', cid: 'tel:380633333333' });
  expect(page.errors).toEqual([]);
});

test('адмінка на сервері відкривається лише за паролем', async ({ browser }) => {
  const page = await device(browser, () => {});
  await page.goto('/admin.html');
  await expect(page.getByRole('heading', { name: 'Вхід в адмінку' })).toBeVisible();
  await expect(page.locator('#nav a')).toHaveCount(0);
  await page.getByLabel('Пароль').fill('не той');
  await page.getByRole('button', { name: 'Увійти' }).click();
  await expect(page.getByRole('alert')).toContainText('Невірний пароль');
  expect(page.errors).toEqual([]);
});

test('фото профілю клієнта доходить до мийки через сервер — посиланням, а не в даних', async ({ browser }) => {
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAAABJRU5ErkJggg==', 'base64');
  const ira = await client(browser, '+380 67 555 55 55', 'Марта');
  await ira.goto('/#/garage');
  await ira.locator('#avatar-file').setInputFiles({ name: 'me.png', mimeType: 'image/png', buffer: png });
  await expect(ira.locator('#toast')).toHaveText('Фото профілю збережено');
  await ira.goto('/#/ask/blysk');
  await ira.getByLabel('Повідомлення мийці').fill('Добрий день');
  await ira.getByRole('button', { name: 'Надіслати' }).click();

  const pro = await wash(browser);
  await pro.goto('/pro.html#/');
  const img = pro.locator('.convo', { hasText: 'Марта' }).locator('.avatar img');
  await expect(img).toHaveAttribute('src', /^api\/avatar\/a\w+\?v=\d+$/, { timeout: 15000 });
  await expect.poll(() => img.evaluate((el) => el.complete && el.naturalWidth)).toBe(256);
  // Самого фото й номера власника мийка в даних не має.
  const av = await pro.evaluate(() => localStorage.getItem('carcar.avatars'));
  expect(av).not.toContain('data:image');
  expect(av).not.toContain('380675555555');
  for (const p of [ira, pro]) expect(p.errors).toEqual([]);
});
