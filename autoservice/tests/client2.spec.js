import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

// Неділя, 4 жовтня 2026, 10:00.
const TILE = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');

test.beforeEach(async ({ page }, testInfo) => {
  // Усі точки — мийки, тож акція «Перша мийка −30%» діяла б у кожному тесті. Вимикаємо її,
  // крім тестів промокодів і маркетингу.
  if (!/промокод|маркетинг/i.test(testInfo.title)) {
    await page.addInitScript(() => localStorage.getItem('carcar.admin.promos') ?? localStorage.setItem('carcar.admin.promos', '[]'));
  }
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

const PANEL = '/business.html';

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
  await expect(page.locator('#inbox-tab .tab-count')).toHaveText('1');
  const bar = page.getByRole('group', { name: 'Візит завтра о 10:00' });
  await expect(bar.getByRole('button', { name: 'Їду' })).toHaveCount(0);
  await expect(bar).toContainText('більше ніж на 15 хв, візит вважається неявкою');
  await bar.getByRole('button', { name: 'Запізнююсь на 15 хв' }).click();
  await expect(page.locator('#toast')).toHaveText('Мийка знає: запізнюєтесь на 15 хв');
  await expect(bar.getByRole('button', { name: /Запізнююсь/ })).toHaveCount(0);
  await page.goto('/#/inbox');
  await expect(page.locator('.msg-card').first()).toContainText('Нагадуємо: завтра о 10:00 — Автомийка «Хвиля»');

  await page.clock.setFixedTime(new Date(2026, 9, 5, 8, 15));
  await page.goto('/#/bookings');
  await page.goto('/#/inbox');
  await expect(page.locator('.msg-card').first()).toContainText('Через 1 год 45 хв — Автомийка «Хвиля», 10:00');

  await page.goto(`${PANEL}#/schedule/2026-10-05`);
  await page.getByLabel('Точка').selectOption({ label: 'Автомийка «Хвиля»' });
  await expect(page.locator('.slot-block').first()).toContainText('запізниться на 15 хв');
});

test('запізнення понад 15 хв: мийка зараховує оплату собі, клієнт бачить причину', async ({ page }) => {
  await book(page);
  // Візит о 10:00, зараз 10:20 — клієнта немає.
  await page.clock.setFixedTime(new Date(2026, 9, 5, 10, 20));
  await page.goto(`${PANEL}#/schedule/2026-10-05`);
  await page.getByLabel('Точка').selectOption({ label: 'Автомийка «Хвиля»' });
  await page.locator('.slot-block').first().click();
  page.once('dialog', (d) => d.accept());
  await page.getByRole('button', { name: 'Запізнення понад 15 хв — оплата нам' }).click();
  await expect(page.locator('#toast')).toHaveText('Оплату 900 ₴ зараховано вам');

  await page.goto('/#/bookings');
  await expect(page.getByRole('button', { name: /Завершені/ })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('article').first()).toContainText('Запізнення понад 15 хв — оплату 900 ₴ зараховано точці за послугу');
  await page.goto('/#/inbox');
  await expect(page.locator('.msg-card').first()).toContainText('ви запізнилися більше ніж на 15 хв');
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
  await expect(page.locator('#toast')).toHaveText('Регулярний запис увімкнено — найближчий візит уже в «Моїх записах»');
  const card = page.locator('.sub-card');
  await expect(card).toContainText('Кожні 2 тижні у суботу о 10:00');
  await expect(card).toContainText('Найближчий: сб, 10 жовтня, 10:00');
  await page.goto('/#/inbox');
  await expect(page.locator('.msg-card').first()).toContainText('Регулярний запис: Автомийка «Блиск», сб, 10 жовтня о 10:00. Оплачено 250 ₴ з картки.');

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
  await page.goto('/#/bookings');
  await page.getByRole('button', { name: 'Підтвердити виконання' }).click();
  await page.locator('.star-input label').nth(4).click();
  await page.getByLabel('Відгук (необовʼязково)').fill('Швидко й акуратно');
  await page.locator('.review-form input[name="photos"]').setInputFiles([{ name: 'wheels.png', mimeType: 'image/png', buffer: TILE }]);
  await expect(page.locator('.review-form .photo-count')).toHaveText('Обрано фото: 1');
  await page.getByRole('button', { name: 'Надіслати відгук' }).click();
  await expect(page.locator('#toast')).toHaveText('Дякуємо за відгук!');
  await expect(page.locator('.my-review img')).toHaveCount(1);

  await page.goto('/#/place/hvylia');
  await expect(page.locator('.review img[alt="Фото клієнта 1"]')).toBeVisible();

  await page.goto(`${PANEL}#/reviews`);
  await page.getByLabel('Точка').selectOption({ label: 'Автомийка «Хвиля»' });
  await expect(page.locator('article img[alt="Фото клієнта 1"]')).toBeVisible();
  await page.getByLabel('Відповісти').fill('Дякуємо, чекаємо навесні!');
  await page.getByRole('button', { name: 'Відповісти' }).click();

  await page.goto('/#/bookings');
  await expect(page.locator('#inbox-tab .tab-count')).not.toHaveCount(0);
  await expect(page.locator('.my-review .reply')).toContainText('Дякуємо, чекаємо навесні!');
  await page.goto('/#/inbox');
  await expect(page.locator('.msg-card', { hasText: 'відповіла на ваш відгук' })).toContainText('«Дякуємо, чекаємо навесні!»');
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
  await expect(r).toContainText('Поліс ОСЦПВ діє до 12 березня 2027');
  await expect(f.getByLabel('Держномер')).toHaveValue('AA1234BB');
  await expect(f.getByLabel('Марка')).toHaveValue('Skoda');
  await expect(f.getByLabel('Рік випуску (необовʼязково)')).toHaveValue('2019');

  await f.getByLabel('Держномер').fill('KA0001AA');
  await f.getByRole('button', { name: 'Перевірити' }).click();
  await expect(r).toContainText('Поліс ОСЦПВ закінчився 20 вересня 2026');
  await expect(f.getByLabel('Клас')).toHaveValue('1');

  await f.getByLabel('Держномер').fill('BC5555AA');
  await f.getByRole('button', { name: 'Перевірити' }).click();
  await expect(r).toContainText('BC5555AA · Львівська обл.');
  await expect(r).toContainText('немає в демо-реєстрі');

  await f.getByLabel('Держномер').fill('AA1234BB');
  await f.getByRole('button', { name: 'Перевірити' }).click();
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
