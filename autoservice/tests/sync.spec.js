import { test, expect } from '@playwright/test';
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
  const port = 4190 + info.workerIndex + (info.project.name === 'mobile' ? 20 : 0);
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
  await page.clock.setFixedTime(new Date(2026, 9, 4, 10, 0));
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.errors = errors;
  return page;
}
const client = (browser, phone, name) => device(browser, ([p, n]) => {
  sessionStorage.setItem('carcar.splash', '1');
  localStorage.getItem('carcar.auth') ?? localStorage.setItem('carcar.auth', JSON.stringify({ phone: p, at: 1 }));
  localStorage.getItem('carcar.profile') ?? localStorage.setItem('carcar.profile', JSON.stringify({ name: n, phone: p }));
}, [phone, name]);
const wash = (browser) => device(browser, () => {
  localStorage.getItem('carcar.biz.session') ?? localStorage.setItem('carcar.biz.session', '{"demo":true}');
  localStorage.getItem('carcar.partner') ?? localStorage.setItem('carcar.partner', '"blysk"');
});

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
