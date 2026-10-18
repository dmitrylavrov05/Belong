import { test, expect } from '@playwright/test';
import { spawn, execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';

// Повний шлях без демо, через сервер CARCAR (як на робочому сервері з вимкненим демо):
// мийка подає заявку → адмінка схвалює й видає логін → мийка входить і публікується →
// клієнт бачить її в каталозі, записується → мийка підтверджує → клієнт бачить підтвердження.
test.describe.configure({ mode: 'serial' });

let server;
let base;
let google;

// Заглушка Google Places API: пошук місця й фото (справжній Google у тестах не викликаємо).
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
function startGoogle() {
  return new Promise((ok) => {
    google = createServer((req, res) => {
      if (req.method === 'POST') {
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ places: [{
          id: 'ChIJtest', displayName: { text: 'Автомийка Лідер' }, formattedAddress: 'вулиця Здолбунівська, 7, Київ, Україна, 02000',
          location: { latitude: 50.4012, longitude: 30.6543 }, internationalPhoneNumber: '+380 44 555 0101', rating: 4.8, userRatingCount: 120,
          regularOpeningHours: { periods: [0, 1, 2, 3, 4, 5, 6].map((day) => ({ open: { day, hour: 8, minute: 0 }, close: { day, hour: 22, minute: 0 } })) },
          addressComponents: [{ longText: 'Київ', types: ['locality'] }], photos: [{ name: 'places/ChIJtest/photos/p1' }],
        }] }));
      } else {
        res.setHeader('Content-Type', 'image/png');
        res.end(PNG);
      }
    }).listen(0, '127.0.0.1', () => ok(google.address().port));
  });
}

test.beforeAll(async ({}, info) => {
  const port = 5390 + info.workerIndex + (info.project.name === 'mobile' ? 20 : 0);
  const dir = mkdtempSync(join(tmpdir(), 'carcar-onboard-'));
  const cfg = join(dir, 'config.json');
  execFileSync('python3', ['../deploy/server/carcar_sync.py', '--config', cfg, '--set-admin-password', 'admin-pass-1']);
  const gport = await startGoogle();
  writeFileSync(cfg, JSON.stringify({ ...JSON.parse(readFileSync(cfg, 'utf8')), demo_places: false, demo_wash: false,
    google_places_key: 'test-key', google_places_url: `http://127.0.0.1:${gport}` }));
  server = spawn('python3', ['../deploy/server/carcar_sync.py', '--port', String(port), '--db', join(dir, 'data.db'), '--static', 'app', '--config', cfg], { stdio: 'pipe' });
  await new Promise((ok, no) => {
    server.stdout.on('data', (d) => String(d).includes('CARCAR sync') && ok());
    server.on('exit', (code) => no(new Error(`server exited ${code}`)));
  });
  base = `http://127.0.0.1:${port}`;
});

test.afterAll(() => { server?.kill(); google?.close(); });

async function device(browser, init = () => {}, arg = null) {
  const ctx = await browser.newContext({ baseURL: base, locale: 'uk-UA', reducedMotion: 'reduce' });
  await ctx.addInitScript(init, arg);
  const page = await ctx.newPage();
  await page.clock.setFixedTime(new Date(2026, 9, 4, 10, 0));
  page.errors = [];
  page.on('pageerror', (e) => page.errors.push(e.message));
  return page;
}

async function phoneLogin(page, name, phone) {
  await page.getByLabel('Ваше імʼя').fill(name);
  await page.getByLabel('Номер телефону').fill(phone);
  await page.getByRole('button', { name: 'Отримати код' }).click();
  const code = await page.locator('.auth-card .code').textContent();
  for (const [i, d] of [...code].entries()) await page.locator('.code-cell').nth(i).fill(d);
}

test('без демо: заявка мийки → схвалення → публікація → запис клієнта → підтвердження', async ({ browser }) => {
  // 1. Власник мийки відкриває реєстрацію: спершу вхід за номером, потім заявка.
  const owner = await device(browser, () => sessionStorage.setItem('carcar.splash', '1'));
  await owner.goto('/#/business/apply');
  await phoneLogin(owner, 'Максим', '63 444 44 44');
  await expect(owner.getByRole('heading', { name: 'Реєстрація мийки' })).toBeVisible({ timeout: 10000 });
  const f = owner.locator('#biz-apply');
  await f.getByLabel('Назва мийки').fill('Хмаринка');
  await f.getByLabel('Адреса').fill('вул. Хрещатик, 1');
  await f.getByLabel('ІПН (ФОП) або ЄДРПОУ (ТОВ)').fill('1234567890');
  await f.getByLabel(/Погоджуюсь з умовами/).check();
  await f.getByRole('button', { name: 'Надіслати заявку' }).click();
  await expect(owner.locator('#toast')).toContainText('Заявку надіслано');

  // 2. Адмінка (за паролем) схвалює й бачить логін і пароль.
  const admin = await device(browser);
  await admin.goto('/admin.html');
  await admin.getByLabel('Пароль').fill('admin-pass-1');
  await admin.getByRole('button', { name: 'Увійти' }).click();
  await admin.goto('/admin.html#/applications');
  await admin.getByRole('button', { name: 'Схвалити й видати доступ' }).click();
  const issued = admin.locator('.notice.ok .code');
  await expect(issued).toHaveCount(2, { timeout: 10000 });
  const [login, password] = await issued.allTextContents();

  // Заявник бачить у застосунку, що заявку схвалено, і дані для входу.
  await owner.goto('/#/business');
  const status = owner.getByRole('region', { name: 'Ваша заявка' });
  await expect(status).toContainText(login, { timeout: 15000 });
  await expect(status).toContainText(password);

  // 3. Мийка входить у CarCar Business своїм логіном і публікується.
  const wash = await device(browser);
  await wash.goto('/pro.html');
  await expect(wash.getByRole('button', { name: /Подивитися демо/ })).toHaveCount(0);
  await wash.getByLabel('Логін').fill(login);
  await wash.getByLabel('Пароль').fill(password);
  await wash.getByRole('button', { name: 'Увійти' }).click();
  await wash.goto('/pro.html#/wash');
  const publish = wash.getByRole('button', { name: 'Опублікувати мийку' });
  await expect(publish).toBeEnabled({ timeout: 15000 });
  await publish.click();
  await expect(wash.locator('.toast')).toContainText('Мийка в каталозі');

  // 4. Клієнт бачить у каталозі лише справжню мийку й записується.
  const client = await device(browser, () => sessionStorage.setItem('carcar.splash', '1'));
  await client.goto('/');
  await phoneLogin(client, 'Ірина', '67 111 11 11');
  await expect(client.locator('#list article')).toHaveCount(1, { timeout: 15000 });
  await expect(client.locator('#list article')).toContainText('Хмаринка');
  await client.locator('#list article').first().click();
  await client.getByRole('link', { name: 'Записатися онлайн' }).click();
  await client.getByLabel(/Експрес-мийка кузова/).check();
  await client.locator('[data-action="to-time"]').click();
  await client.getByRole('button', { name: /Завтра/ }).click();
  await client.locator('.slot:not([disabled])').first().click();
  await client.locator('[data-action="confirm"]').click();
  await client.getByRole('button', { name: /^Оплатити/ }).click();
  await expect(client.locator('#toast')).toHaveText('Оплачено. Чекаємо, коли мийка підтвердить запис');

  // 5. Мийка отримує запис і підтверджує — клієнт бачить підтвердження.
  await wash.goto('/pro.html#/bookings');
  const alert = wash.getByRole('dialog', { name: 'Новий запис' });
  await expect(alert).toContainText('Ірина', { timeout: 15000 });
  // Номер клієнта мийка не бачить.
  expect(await wash.evaluate(() => localStorage.getItem('carcar.bookings'))).not.toContain('380671111111');
  await alert.getByRole('button', { name: 'Прийняти' }).click();
  await expect(client.locator('.answer-banner')).toContainText('Запис підтверджено', { timeout: 15000 });

  for (const p of [owner, admin, wash, client]) expect(p.errors).toEqual([]);
});

test('адмінка додає мийку за даними з Google Карт — клієнт бачить її, мийка входить у кабінет', async ({ browser }) => {
  const admin = await device(browser);
  await admin.goto('/admin.html');
  await admin.getByLabel('Пароль').fill('admin-pass-1');
  await admin.getByRole('button', { name: 'Увійти' }).click();
  await admin.goto('/admin.html#/places');
  await admin.getByRole('link', { name: 'Додати мийку' }).click();
  await admin.getByLabel('Посилання з Google Карт або назва й місто').fill('Автомийка Лідер Київ');
  await admin.getByRole('button', { name: 'Знайти' }).click();
  await expect(admin.locator('main')).toContainText('★ 4,8 · 120 відгуків у Google', { timeout: 15000 });
  await admin.getByRole('button', { name: 'Заповнити' }).click();
  const f = admin.locator('#place-new');
  await expect(f.getByLabel('Назва')).toHaveValue('Автомийка Лідер');
  await expect(f.getByLabel('Адреса')).toHaveValue('вулиця Здолбунівська, 7');
  await expect(f.getByLabel('Телефон мийки')).toHaveValue('+380 44 555 0101');
  await expect(f).toContainText('Пн 08:00–22:00');
  await expect(f.getByAltText('Фото 1')).toBeVisible({ timeout: 10000 });
  await f.getByLabel('Боксів').fill('3');
  await f.getByRole('button', { name: 'Додати мийку' }).click();
  const done = admin.locator('.notice.ok');
  await expect(done).toContainText('Мийку «Автомийка Лідер» додано й опубліковано в каталозі', { timeout: 15000 });
  const [login, password] = await done.locator('.code').allTextContents();

  // Клієнт одразу бачить мийку в каталозі — з фото й адресою.
  const client = await device(browser, () => sessionStorage.setItem('carcar.splash', '1'));
  await client.goto('/');
  await phoneLogin(client, 'Ірина', '67 222 22 22');
  const card = client.locator('#list article', { hasText: 'Автомийка Лідер' });
  await expect(card).toContainText('Здолбунівська', { timeout: 15000 });

  // Профіль із фото дійшов до сервера (адмінка надсилає зміни у фоні).
  const adminToken = await admin.evaluate(() => JSON.parse(localStorage.getItem('carcar.admin.token')));
  await expect.poll(async () => {
    const st = await (await fetch(`${base}/api/state?since=0`, { headers: { Authorization: `Bearer ${adminToken}` } })).json();
    return Object.values(st.data['biz.places'] ?? {}).some((x) => x.photos?.length);
  }, { timeout: 20000 }).toBe(true);

  // Власник входить у CarCar Business виданим логіном.
  const wash = await device(browser);
  await wash.goto('/pro.html');
  await wash.getByLabel('Логін').fill(login);
  await wash.getByLabel('Пароль').fill(password);
  await wash.getByRole('button', { name: 'Увійти' }).click();
  await expect(wash.locator('#top')).toContainText('Автомийка Лідер', { timeout: 15000 });
  // Поки курсор у полі, кабінет не перемальовує екран (щоб не заважати друкувати) — відкриваємо профіль начисто.
  await wash.goto('/pro.html#/profile');
  await wash.reload();
  await expect(wash.locator('main')).toContainText('Фото мийки (1 з 6)', { timeout: 15000 }); // фото з Google Карт уже в профілі
  await expect(wash.getByLabel('Назва')).toHaveValue('Автомийка Лідер');
  for (const p of [admin, client, wash]) expect(p.errors).toEqual([]);
});
