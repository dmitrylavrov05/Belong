import { test, expect } from '@playwright/test';
import { payStep } from './pay-step.js';
import AxeBuilder from '@axe-core/playwright';
import { PRO, proBooking, proWash, washReady } from './helpers.js';

// Неділя, 4 жовтня 2026, 10:00.
const TILE = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');

test.beforeEach(async ({ page }, testInfo) => {
  await payStep(page);
  // Вхід за телефоном пройдено — крім тестів самого входу (#/login).
  await page.addInitScript(() => { if (!location.hash.startsWith('#/login')) { localStorage.getItem('carcar.auth') ?? localStorage.setItem('carcar.auth', '{"phone":"","at":1}'); localStorage.getItem('carcar.biz.session') ?? localStorage.setItem('carcar.biz.session', '{"demo":true}'); } });
  // Усі точки — мийки, тож акція «Перша мийка −30%» діяла б у кожному тесті. Вимикаємо її,
  // крім тестів промокодів і маркетингу.
  if (!/промокод|маркетинг/i.test(testInfo.title)) {
    await page.addInitScript(() => localStorage.getItem('carcar.admin.promos') ?? localStorage.setItem('carcar.admin.promos', '[]'));
  }
  // Мийки за замовчуванням підтверджують записи вручну; у цих тестах — автопідтвердження, як раніше.
  // Підтвердження мийкою перевіряє pro.spec.js.
  await page.addInitScript(() => localStorage.getItem('carcar.biz.autoConfirm') ?? localStorage.setItem('carcar.biz.autoConfirm',
    JSON.stringify(Object.fromEntries(['blysk', 'aqua24', 'hvylia', 'strumin', 'pina', 'kraplia', 'chysto', 'hlyanets', 'keramika'].map((id) => [id, true])))));
  await page.clock.setFixedTime(new Date(2026, 9, 4, 10, 0));
  // Акцію «Перша мийка −30%» перевіряє features.spec.js — тут ціни без неї.
  await page.addInitScript(() => localStorage.getItem('carcar.admin.promos') ?? localStorage.setItem('carcar.admin.promos', '[]'));
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  page.on('requestfailed', (r) => errors.push(`failed: ${r.url()}`));
  page.errors = errors;
});

test.afterEach(async ({ page }) => {
  expect(page.errors.filter((e) => !e.includes('tile.openstreetmap.org') && !e.includes('ERR_FAILED'))).toEqual([]);
});

// Мийка підтверджує виконання («Машина готова») у CarCar Business; клієнт відкриває завершені записи.
async function washDone(page) {
  await washReady(page);
  await page.goto('/#/bookings');
  await page.getByRole('button', { name: /^Завершені/ }).click();
}

async function book(page, { place = 'hvylia', service = /Комплекс преміум/, day = /Завтра/, time = '10:00', price = '900 ₴' } = {}) {
  await page.goto(`/#/book/${place}`);
  await page.getByLabel(service).check();
  await page.locator('[data-action="to-time"]').click();
  if (day) await page.getByRole('button', { name: day }).click();
  await page.locator(`.slot[data-time="${time}"]`).click();
  await page.locator('[data-action="confirm"]').click();
  await page.getByRole('button', { name: `Оплатити ${price}` }).click();
  await expect(page.locator('#toast')).toHaveText('Оплачено, ви записані');
}

test('нагадування напередодні й за 2 години, «Запізнююсь» бачить мийка', async ({ page }) => {
  await book(page);

  await page.clock.setFixedTime(new Date(2026, 9, 4, 18, 30));
  await page.goto('/#/bookings');
  const bar = page.getByRole('group', { name: 'Візит завтра о 10:00' });
  await expect(bar.getByRole('button', { name: 'Їду' })).toHaveCount(0);
  await expect(bar).toContainText('більше ніж на 15 хв і CARCAR це підтвердить, оплата');
  await bar.getByRole('button', { name: 'Запізнююсь на 15 хв' }).click();
  await expect(page.locator('#toast')).toHaveText('Мийка знає: запізнюєтесь на 15 хв');
  await expect(bar.getByRole('button', { name: /Запізнююсь/ })).toHaveCount(0);

  await page.clock.setFixedTime(new Date(2026, 9, 5, 8, 15));
  await page.goto('/#/bookings');

  // Мийка бачить попередження в картці запису в CarCar Business.
  const sheet = await proBooking(page);
  await expect(sheet).toContainText('Клієнт повідомив: запізниться на 15 хв');
});

test('запізнення понад 15 хв: мийка надсилає готове звернення, підтримка перевіряє й вирішує', async ({ page }) => {
  await book(page);
  // Візит о 10:00, о 10:10 ще рано, о 10:20 клієнта немає.
  await page.clock.setFixedTime(new Date(2026, 9, 5, 10, 10));
  let sheet = await proBooking(page);
  await expect(sheet.getByRole('button', { name: /запізнився понад 15 хв/ })).toHaveCount(0);
  await page.clock.setFixedTime(new Date(2026, 9, 5, 10, 20));
  sheet = await proBooking(page);
  await sheet.getByRole('button', { name: 'Клієнт запізнився понад 15 хв — у підтримку' }).click();
  // Дані запису вже підставлено — мийка лише надсилає.
  const form = page.getByRole('dialog', { name: 'Запізнення клієнта' });
  await expect(form.locator('.late-preview')).toContainText('Клієнт запізнився понад 15 хв');
  await expect(form.locator('.late-preview')).toContainText('запізнення 20 хв');
  await expect(form.locator('.late-preview')).toContainText('Сума: 900 ₴');
  await form.getByRole('button', { name: 'Надіслати в підтримку' }).click();
  await expect(page.locator('#toast')).toContainText('підтримка перевірить запізнення');

  // Клієнт бачить, що запізнення на перевірці, гроші заморожені.
  await page.goto('/#/bookings');
  const card = page.locator('article').first();
  await expect(card).toContainText('Запізнення на перевірці');
  await expect(card).toContainText('Мийка повідомила про запізнення');

  // Підтримка бачить звернення з даними й підтверджує запізнення.
  await page.goto('/admin.html#/support');
  await page.locator('tr', { hasText: 'Запізнення клієнта' }).first().getByRole('link').click();
  await expect(page.locator('.thread').first()).toContainText('Клієнт запізнився понад 15 хв');
  await page.getByRole('button', { name: 'Запізнення підтверджено — оплата мийці' }).click();
  await expect(page.locator('#toast')).toHaveText('Оплату зараховано мийці');

  await page.goto('/#/bookings');
  await expect(page.getByRole('button', { name: /Завершені/ })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('article').first()).toContainText('Запізнення понад 15 хв — оплату 900 ₴ зараховано точці за послугу');
});

test('запізнення не підтверджено — підтримка повертає гроші клієнту', async ({ page }) => {
  await book(page);
  await page.clock.setFixedTime(new Date(2026, 9, 5, 10, 20));
  const sheet = await proBooking(page);
  await sheet.getByRole('button', { name: 'Клієнт запізнився понад 15 хв — у підтримку' }).click();
  await page.getByRole('dialog', { name: 'Запізнення клієнта' }).getByRole('button', { name: 'Надіслати в підтримку' }).click();
  await page.goto('/admin.html#/support');
  await page.locator('tr', { hasText: 'Запізнення клієнта' }).first().getByRole('link').click();
  await page.getByRole('button', { name: 'Не підтверджено — повернути клієнту' }).click();
  await expect(page.locator('#toast')).toHaveText('Гроші повернено клієнту');
  const b = await page.evaluate(() => JSON.parse(localStorage.getItem('carcar.bookings')).at(-1));
  expect([b.state, b.refund, b.placeAmount]).toEqual(['refunded', 900, 0]);
});

test('мої записи: вкладки «Активні» й «Завершені» з лічильниками', async ({ page }) => {
  await book(page);
  await book(page, { time: '12:00' });
  page.once('dialog', (d) => d.accept());
  await page.locator('article.hl').getByRole('button', { name: 'Скасувати' }).click();
  // Скасований запис — у «Завершених», вкладка перемкнулася сама.
  await expect(page.getByRole('button', { name: /Завершені/ })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('button', { name: /Завершені/ })).toContainText('1');
  await expect(page.locator('article')).toHaveCount(1);
  await page.getByRole('button', { name: /Активні/ }).click();
  await expect(page.getByRole('button', { name: /Активні/ })).toContainText('1');
  await expect(page.locator('article')).toHaveCount(1);
  await expect(page.locator('article').first()).toContainText('10:00');
});

test('завершені записи — компактні рядки по місяцях, розгортаються, історія сторінками по 10', async ({ page }) => {
  // 13 скасованих записів за вересень—жовтень (вигадані дані для перевірки).
  await page.addInitScript(() => {
    const list = Array.from({ length: 13 }, (_, i) => ({
      id: `old${i}`, placeId: i % 2 ? 'blysk' : 'hvylia', date: i < 2 ? `2026-10-0${2 - i}` : `2026-09-${String(28 - i * 2).padStart(2, '0')}`,
      time: '10:00', minutes: 30, services: ['Експрес-мийка кузова'], paid: 250, bonus: 0, state: 'cancelled', refund: 250, placeAmount: 0,
      car: 'Легкове', cls: 0, cancelBy: 'client', cancelKind: 'free', closedAt: 1, createdAt: 1,
    }));
    if (!localStorage.getItem('carcar.bookings')) localStorage.setItem('carcar.bookings', JSON.stringify(list));
  });
  await page.goto('/#/bookings');
  await page.getByRole('button', { name: /^Завершені/ }).click();
  await expect(page.getByRole('region', { name: 'жовтень 2026' })).toBeVisible();
  await expect(page.getByRole('region', { name: 'вересень 2026' })).toBeVisible();
  const rows = page.locator('details.done-item');
  await expect(rows).toHaveCount(10);
  // Згорнуті: видно лише рядок, кнопок картки не видно, поки не розгорнути.
  const first = rows.first();
  await expect(first.locator('summary')).toContainText('Скасовано');
  await expect(first.getByRole('link', { name: 'Повторити запис' })).toBeHidden();
  await first.locator('summary').click();
  await expect(first.getByRole('link', { name: 'Повторити запис' })).toBeVisible();
  await page.getByRole('button', { name: 'Показати ще 3 з 3' }).click();
  await expect(rows).toHaveCount(13);
  await expect(page.locator('.done-more')).toHaveCount(0);
  // Розгорнутий запис лишається розгорнутим після оновлення списку.
  await expect(first).toHaveAttribute('open', '');
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
});

test('повтор запису в один дотик: ті самі послуги й час, одразу до оплати', async ({ page }) => {
  await book(page);
  await page.goto('/#/bookings');
  page.once('dialog', (d) => d.accept());
  await page.getByRole('button', { name: 'Скасувати', exact: true }).click();

  await page.getByRole('link', { name: 'Повторити запис' }).click();
  await expect(page.locator('#toast')).toContainText('о 10:00 — лишилось оплатити');
  await expect(page.getByRole('region', { name: 'Оплата' })).toBeVisible();
  await expect(page.locator('.rc-lines')).toContainText('Комплекс преміум');
  // Гроші за скасований запис уже на балансі CARCAR — ним і оплачуємо.
  await page.getByRole('button', { name: 'Оплатити з балансу' }).click();
  await expect(page.locator('article').first()).toContainText('10:00');
});

test('регулярна мийка кожні 2 тижні в суботу о 10:00 записується й оплачується сама', async ({ page }) => {
  await book(page, { place: 'blysk', service: /Експрес-мийка/, day: null, time: '12:00', price: '250 ₴' });
  await page.goto('/#/bookings');
  page.once('dialog', (d) => d.accept());
  await page.getByRole('button', { name: 'Скасувати', exact: true }).click();

  await page.getByRole('button', { name: 'Зробити регулярним' }).click();
  const f = page.locator('.sub-form');
  await f.getByLabel('Як часто').selectOption('2');
  await f.getByLabel('День').selectOption({ label: 'Субота' });
  await f.getByRole('combobox', { name: 'Час', exact: true }).selectOption('10:00');
  await f.getByRole('button', { name: 'Увімкнути' }).click();
  await expect(page.locator('#toast')).toHaveText('Регулярний запис увімкнено — візити зʼявлятимуться в «Моїх записах» за тиждень наперед');
  const card = page.locator('.sub-card');
  await expect(card).toContainText('Кожні 2 тижні у суботу о 10:00');
  await expect(card).toContainText('Найближчий: сб, 10 жовтня, 10:00');

  // Через тиждень нового запису немає (через 2 тижні — є).
  await page.clock.setFixedTime(new Date(2026, 9, 11, 10, 0));
  await page.goto('/#/bookings');
  await expect(page.locator('article', { hasText: '17 жовт' })).toHaveCount(0);
  await page.clock.setFixedTime(new Date(2026, 9, 18, 10, 0));
  await page.reload();
  await expect(page.locator('.sub-card')).toContainText('Найближчий: сб, 24 жовтня, 10:00');
  await page.locator('.sub-card').getByRole('button', { name: 'Призупинити' }).click();
  await expect(page.locator('.sub-card')).toContainText('на паузі');
});

test('відгук із фото й відповідь точки в сповіщеннях', async ({ page }) => {
  await book(page);
  await page.clock.setFixedTime(new Date(2026, 9, 5, 21, 30));
  await washDone(page);
  await page.locator('.star-input label').nth(4).click();
  await page.getByLabel('Відгук (необовʼязково)').fill('Швидко й акуратно');
  await page.locator('.review-form input[name="photos"]').setInputFiles([{ name: 'wheels.png', mimeType: 'image/png', buffer: TILE }]);
  await expect(page.locator('.review-form .photo-count')).toHaveText('Обрано фото: 1');
  await page.getByRole('button', { name: 'Надіслати відгук' }).click();
  await expect(page.locator('#toast')).toHaveText('Дякуємо за відгук!');
  await expect(page.locator('.my-review img')).toHaveCount(1);

  await page.goto('/#/place/hvylia');
  await expect(page.locator('.review img[alt="Фото клієнта 1"]')).toBeVisible();

  // Мийка відповідає у «Відгуках» CarCar Business.
  await proWash(page, 'Автомийка «Хвиля»');
  await page.goto(`${PRO}#/reviews`);
  const rev = page.locator('.pro-review', { hasText: 'Швидко й акуратно' });
  await expect(rev.locator('img[alt="Фото до відгуку 1"]')).toBeVisible();
  await rev.getByLabel(/^Відповідь на відгук/).fill('Дякуємо, чекаємо навесні!');
  await rev.getByRole('button', { name: 'Надіслати відповідь' }).click();
  await expect(page.locator('#toast')).toHaveText('Відповідь опубліковано на сторінці мийки');

  await page.goto('/#/bookings');
  await expect(page.locator('.my-review .reply')).toContainText('Дякуємо, чекаємо навесні!');
});

test('перевірка авто за номером: регіон, марка, рік і поліс підставляються у форму', async ({ page }) => {
  await page.goto('/#/garage');
  const f = page.locator('#carform');
  await f.getByLabel('Держномер').fill('123');
  await f.getByRole('button', { name: 'Перевірити' }).click();
  await expect(page.locator('#plate-result')).toContainText('Номер має вигляд AA1234BB');

  await f.getByLabel('Держномер').fill('аа 1234 вв');
  await f.getByRole('button', { name: 'Перевірити' }).click();
  const r = page.locator('#plate-result');
  await expect(r).toContainText('AA1234BB · Київ');
  await expect(r).toContainText('Skoda Octavia, 2019 р., сірий, бензин 1,4 л');
  await expect(r).not.toContainText('ОСЦПВ');
  await expect(f.getByLabel('Держномер')).toHaveValue('AA1234BB');
  await expect(f.getByLabel('Марка')).toHaveValue('Skoda');
  await expect(f.getByLabel('Рік випуску (необовʼязково)')).toHaveValue('2019');

  await f.getByLabel('Держномер').fill('KA0001AA');
  await f.getByRole('button', { name: 'Перевірити' }).click();
  await expect(r).toContainText('Toyota RAV4');
  await expect(f.getByLabel('Клас')).toHaveValue('1');

  await f.getByLabel('Держномер').fill('BC5555AA');
  await f.getByRole('button', { name: 'Перевірити' }).click();
  await expect(r).toContainText('BC5555AA · Львівська обл.');
  await expect(r).toContainText('не знайдено в реєстрі');

  // Літери номера — одразу великими; повний номер — дані підтягуються самі, без кнопки.
  await f.getByLabel('Держномер').fill('');
  await f.getByLabel('Держномер').pressSequentially('aa1234bb');
  await expect(f.getByLabel('Держномер')).toHaveValue('AA1234BB');
  await expect(r).toContainText('Skoda Octavia');
  await expect(f.getByLabel('Модель')).toHaveValue('Octavia');
  await f.getByRole('button', { name: 'Зберегти', exact: true }).click();
  await expect(page.locator('.car-card')).toContainText('AA1234BB · 2019');
});

test('детальна карта: тайли OpenStreetMap, атрибуція й перемикання на схему', async ({ page }) => {
  await page.route('https://tile.openstreetmap.org/**', (r) => r.fulfill({ contentType: 'image/png', body: TILE }));
  await page.goto('/');
  await page.getByRole('button', { name: 'Карта' }).click();
  const map = page.getByRole('region', { name: /Карта точок/ });
  await expect(map.getByRole('button', { name: 'Детальна' })).toHaveAttribute('aria-pressed', 'true');
  await expect(map.locator('.map-tiles img').first()).toBeVisible();
  await expect(map.getByRole('link', { name: '© OpenStreetMap' })).toHaveAttribute('href', 'https://www.openstreetmap.org/copyright');
  const before = await map.locator('.map-tiles img').first().getAttribute('src');
  await map.getByRole('button', { name: 'Наблизити' }).click();
  await map.getByRole('button', { name: 'Наблизити' }).click();
  expect(await map.locator('.map-tiles img').first().getAttribute('src')).not.toBe(before);

  await map.getByRole('button', { name: 'Схема' }).click();
  await expect(map.locator('.map-tiles img')).toHaveCount(0);
  await expect(map.locator('.map-hint')).toHaveText('Схема міста · працює без інтернету');
  await page.reload();
  await expect(page.getByRole('region', { name: /Карта точок/ }).getByRole('button', { name: 'Схема' })).toHaveAttribute('aria-pressed', 'true');
});

test('без інтернету детальна карта сама перемикається на схему', async ({ page }) => {
  await page.route('https://tile.openstreetmap.org/**', (r) => r.abort());
  await page.goto('/');
  await page.getByRole('button', { name: 'Карта' }).click();
  const map = page.getByRole('region', { name: /Карта точок/ });
  await expect(map.locator('.map-hint')).toHaveText('Детальна карта недоступна без інтернету — показуємо схему');
  await expect(map.getByRole('button', { name: 'Схема' })).toHaveAttribute('aria-pressed', 'true');
  await expect(map.locator('[data-pin]')).toHaveCount(9);
});

for (const path of ['/#/bookings', '/#/garage']) {
  test(`доступність і верстка ${path} з нагадуванням, регулярним записом і перевіркою номера`, async ({ page }) => {
    await book(page, { place: 'blysk', service: /Експрес-мийка/, day: null, time: '12:00', price: '250 ₴' });
    await page.goto('/#/bookings');
    if (path === '/#/garage') {
      await page.goto('/#/garage');
      await page.locator('#carform').getByLabel('Держномер').fill('AA1234BB');
      await page.locator('#carform').getByRole('button', { name: 'Перевірити' }).click();
    }
    await page.locator('#view h1').first().waitFor();
    const { violations } = await new AxeBuilder({ page }).analyze();
    expect(violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target).join(', ')}`)).toEqual([]);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow).toBeLessThanOrEqual(0);
  });
}

test('умови для мийок відкриваються без входу клієнта; комісія — з налаштувань адміністрації', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => { localStorage.setItem('carcar.auth', 'null'); localStorage.setItem('carcar.admin.settings', '{"commission":0.12}'); });
  await page.goto('/#/business');
  await expect(page.getByRole('heading', { name: 'CARCAR для бізнесу' })).toBeVisible();
  await expect(page.locator('.biz-terms')).toContainText('12% — лише за клієнтів, яких привели ми');
  await expect(page.locator('.biz-steps')).toContainText('публікуєте мийку');
  await page.getByRole('link', { name: 'Зареєструвати бізнес' }).click();
  await expect(page.getByRole('heading', { name: 'Реєстрація мийки' })).toBeVisible();
  await expect(page.locator('#biz-apply')).toContainText('12% із замовлень');
});

test('налаштування клієнта: тема темна/світла зберігається, сповіщення вимикаються', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'light' });
  await page.goto('/#/garage');
  const set = page.getByRole('region', { name: 'Налаштування' });
  const bg = () => page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  const light = await bg();
  await set.getByRole('radio', { name: 'Темна', exact: true }).check();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  expect(await bg()).not.toBe(light);
  expect((await new AxeBuilder({ page }).include('.settings').analyze()).violations).toEqual([]);
  // Після перезапуску тема та сама — і до того, як застосунок намалював сторінку.
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  // Світла тема перемагає темну системну.
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.getByRole('region', { name: 'Налаштування' }).getByRole('radio', { name: 'Світла', exact: true }).check();
  expect(await bg()).toBe(light);
  await page.getByRole('region', { name: 'Налаштування' }).getByRole('radio', { name: 'Системна', exact: true }).check();
  await expect(page.locator('html')).not.toHaveAttribute('data-theme', /.+/);

  await page.getByLabel(/^Сповіщення/).uncheck();
  await expect(page.locator('#toast')).toContainText('Сповіщення вимкнено');
  expect(await page.evaluate(() => localStorage.getItem('carcar.notify'))).toBe('false');
});

test('Кар Карич: підказка на екрані один раз, відповіді на питання, вимкнення в налаштуваннях', async ({ page }) => {
  await page.goto('/');
  const k = page.locator('#karych');
  const bubble = k.getByRole('dialog', { name: 'Кар Карич підказує' });
  await expect(bubble).toContainText('Я Кар Карич, ваш помічник');
  await bubble.getByRole('button', { name: 'Закрити підказку' }).click();
  await expect(bubble).toBeHidden();
  // Повторно на тому самому екрані сам не зʼявляється.
  await page.goto('/#/garage');
  await expect(bubble).toContainText('Введіть держномер');
  await page.goto('/');
  await page.waitForTimeout(1000);
  await expect(bubble).toBeHidden();
  // Питання — відповідь із правилами платформи.
  await k.getByRole('button', { name: 'Кар Карич — помічник' }).click();
  await bubble.getByRole('button', { name: 'Як скасувати чи перенести?' }).click();
  await expect(bubble).toContainText('не пізніше ніж за 1,5 год до візиту');
  await bubble.getByRole('link', { name: 'Мої записи' }).click();
  await expect(page).toHaveURL(/#\/bookings$/);
  // Вимкнули в налаштуваннях — ворона немає.
  await page.goto('/#/garage');
  await page.getByLabel(/Помічник Кар Карич/).uncheck();
  await expect(k).toBeHidden();
  await page.reload();
  await expect(k).toBeHidden();
  await page.getByLabel(/Помічник Кар Карич/).check();
  await expect(k.getByRole('button', { name: 'Кар Карич — помічник' })).toBeVisible();
});

test('Кар Карич не заважає записатися: над кнопкою картки мийки, на кроках запису схований', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/#/place/blysk');
  const crow = page.getByRole('button', { name: 'Кар Карич — помічник' });
  await expect(crow).toBeVisible();
  // Ворон стоїть над нижньою панеллю «Записатися онлайн», а не на ній.
  await expect.poll(async () => {
    const c = await crow.boundingBox();
    const d = await page.locator('.dock').boundingBox();
    return c.y + c.height <= d.y;
  }).toBe(true);
  await page.getByRole('link', { name: 'Записатися онлайн' }).click();
  await expect(crow).toBeHidden();
  await page.getByLabel(/Експрес-мийка кузова/).check();
  // Кнопку внизу можна натиснути будь-де — навіть з правого краю, де раніше сидів ворон.
  const next = page.locator('[data-action="to-time"]');
  const b = await next.boundingBox();
  await page.mouse.click(b.x + b.width - 12, b.y + b.height / 2);
  await page.getByRole('button', { name: /Завтра/ }).click();
  await page.locator('.slot[data-time="10:00"]').click();
  await expect(crow).toBeHidden();
  const confirm = page.locator('[data-action="confirm"]');
  const cb = await confirm.boundingBox();
  await page.mouse.click(cb.x + cb.width - 12, cb.y + cb.height / 2);
  await page.getByRole('button', { name: /^Оплатити/ }).click();
  await expect(page.locator('#toast')).toHaveText('Оплачено, ви записані');
  // Після запису ворон повертається й радіє.
  await expect(page.getByRole('dialog', { name: 'Кар Карич підказує' })).toContainText('Ви записані');
});

test('оплата: спершу чек згори, «Усе вірно — до оплати» гортає до оплати; оплати частинами немає', async ({ page }) => {
  await page.removeLocatorHandler(page.payNext);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/#/book/hlyanets');
  await page.getByLabel(/Керамічне покриття/).check();
  await page.locator('[data-action="to-time"]').click();
  await page.getByRole('button', { name: /Завтра/ }).click();
  await page.locator('.slot[data-time="10:00"]').click();
  await page.locator('[data-action="confirm"]').click();
  // Екран оплати — згори: чек видно, до способу оплати ще не догорнули.
  await expect(page.locator('.receipt')).toBeInViewport();
  expect(await page.evaluate(() => scrollY)).toBe(0);
  await expect(page.getByRole('button', { name: /^Оплатити/ })).toHaveCount(0);
  await expect(page.getByText('Оплата частинами')).toHaveCount(0);
  await page.getByRole('button', { name: 'Усе вірно — до оплати' }).click();
  const pay = page.getByRole('button', { name: /^Оплатити/ });
  await expect(pay).toBeVisible();
  await expect(page.locator('.methods')).toBeInViewport();
  await pay.click();
  await expect(page.locator('#toast')).toHaveText('Оплачено, ви записані');
});

test('оновлення з сервера не гортає сторінку вгору й не стирає набране', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const remote = (key) => page.evaluate((k) => window.dispatchEvent(new StorageEvent('storage', { key: `carcar.${k}` })), key);
  // Сторінка мийки: догорнули до відгуків — прийшли чужі записи й зміни прайсу.
  await page.goto('/#/place/blysk');
  await page.evaluate(() => window.scrollTo(0, 900));
  await page.waitForTimeout(100);
  const y = await page.evaluate(() => scrollY);
  expect(y).toBeGreaterThan(500);
  for (const k of ['bookings', 'reviews', 'biz.places', 'avatars']) await remote(k);
  await page.waitForTimeout(300);
  expect(await page.evaluate(() => scrollY)).toBe(y);

  // Гараж: набирає імʼя, не зберігши, — оновлення не стирає й не забирає курсор.
  await page.goto('/#/garage');
  const name = page.getByLabel('Імʼя');
  await name.fill('Олександра');
  await remote('bookings');
  await page.waitForTimeout(300);
  await expect(name).toHaveValue('Олександра');
  await expect(name).toBeFocused();

  // Запис: обрали послугу й догорнули до часу — оновлення зайнятості не скидає прокрутку.
  await page.goto('/#/book/blysk');
  await page.getByLabel(/Експрес-мийка кузова/).check();
  await page.locator('[data-action="to-time"]').click();
  await page.getByRole('button', { name: /Завтра/ }).click();
  await page.evaluate(() => window.scrollTo(0, 400));
  await page.waitForTimeout(100);
  const y2 = await page.evaluate(() => scrollY);
  await remote('bookings');
  await page.waitForTimeout(300);
  expect(await page.evaluate(() => scrollY)).toBe(y2);
  // Перехід на інший екран — як і раніше, згори.
  await page.goto('/#/bookings');
  expect(await page.evaluate(() => scrollY)).toBe(0);
});

test('нажали на послугу на сторінці мийки — одразу запис з нею; фото можна обрати й з файлів', async ({ page }) => {
  await page.goto('/#/place/blysk');
  await page.getByRole('button', { name: /Записатися: Комплекс: кузов \+ салон/ }).click();
  await expect(page).toHaveURL(/#\/book\/blysk$/);
  await expect(page.getByLabel(/Комплекс: кузов \+ салон/)).toBeChecked();
  // Інша основна мийка замінює обрану, а не додається.
  await page.goto('/#/place/blysk');
  await page.getByRole('button', { name: /Записатися: Експрес-мийка кузова/ }).click();
  await expect(page.getByLabel(/Експрес-мийка кузова/)).toBeChecked();
  await expect(page.getByLabel(/Комплекс: кузов \+ салон/)).not.toBeChecked();
  await page.locator('[data-action="to-time"]').click();
  await page.getByRole('button', { name: /Завтра/ }).click();
  await page.locator('.slot[data-time="10:00"]').click();
  await page.locator('[data-action="confirm"]').click();
  await page.getByRole('button', { name: /^Оплатити/ }).click();
  await expect(page.locator('#toast')).toHaveText('Оплачено, ви записані');
  // Поля фото приймають і файли (на Android відкривається вибір з «Файлів», а не лише галерея).
  await page.goto('/#/garage');
  await expect(page.locator('#avatar-file')).toHaveAttribute('accept', /\.jpg/);
});

test('перемальовування не губить підставлене за номером, ширина каталогу — по екрану, чат не стрибає вниз', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const remote = (key) => page.evaluate((k) => window.dispatchEvent(new StorageEvent('storage', { key: `carcar.${k}` })), key);
  // Каталог не ширший за екран (інакше сторінка їздить убік).
  await page.goto('/');
  await expect(page.locator('#list article').first()).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);

  // Гараж: дані за номером підставились — оновлення з сервера їх не стирає.
  await page.goto('/#/garage/add');
  const f = page.locator('#carform');
  await f.getByLabel('Держномер').pressSequentially('aa1234bb');
  await expect(f.getByLabel('Модель')).toHaveValue('Octavia');
  await remote('bookings');
  await page.waitForTimeout(300);
  await expect(f.getByLabel('Модель')).toHaveValue('Octavia');
  await expect(page.locator('#plate-result')).toContainText('Skoda Octavia');
  // Перемикач сповіщень на тому ж екрані теж не стирає набране.
  await page.getByLabel(/Сповіщення/).first().click();
  await expect(f.getByLabel('Держномер')).toHaveValue('AA1234BB');
  await f.getByRole('button', { name: 'Зберегти', exact: true }).click();
  await expect(page.locator('.car-card').first()).toBeVisible();

  // Чат: прогорнули історію вгору — оновлення не кидає вниз.
  await page.goto('/#/book/blysk');
  await page.getByLabel(/Експрес-мийка кузова/).check();
  await page.locator('[data-action="to-time"]').click();
  await page.getByRole('button', { name: /Завтра/ }).click();
  await page.locator('.slot[data-time="10:00"]').click();
  await page.locator('[data-action="confirm"]').click();
  await page.getByRole('button', { name: /^Оплатити/ }).click();
  const id = await page.evaluate(() => JSON.parse(localStorage.getItem('carcar.bookings')).at(-1).id);
  await page.evaluate((bid) => {
    const all = JSON.parse(localStorage.getItem('carcar.bookings'));
    const b = all.find((x) => x.id === bid);
    b.chat = Array.from({ length: 40 }, (_, i) => ({ from: i % 2 ? 'biz' : 'client', text: `Повідомлення ${i + 1}`, at: Date.now() - (40 - i) * 60000 }));
    localStorage.setItem('carcar.bookings', JSON.stringify(all));
  }, id);
  await page.goto(`/#/chat/${id}`);
  await page.reload();
  const list = page.locator('.chat-msgs');
  await expect(list).toContainText('Повідомлення 40');
  await list.evaluate((el) => { el.scrollTop = 100; });
  await remote('bookings');
  await page.waitForTimeout(300);
  expect(await list.evaluate((el) => el.scrollTop)).toBe(100);
});
