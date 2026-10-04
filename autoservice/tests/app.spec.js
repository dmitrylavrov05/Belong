import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { execFileSync } from 'node:child_process';
import { readFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Фіксований час: неділя, 4 жовтня 2026, 10:00 — сезон перевзування.
test.beforeEach(async ({ page }) => {
  await page.clock.setFixedTime(new Date(2026, 9, 4, 10, 0));
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  page.on('requestfailed', (r) => errors.push(`failed: ${r.url()}`));
  page.errors = errors;
});

test.afterEach(async ({ page }) => {
  expect(page.errors).toEqual([]);
});

test('каталог фільтрується за категорією, пошуком і обраним', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveTitle('CARCAR');
  await expect(page.getByText('Час на зимову гуму')).toBeVisible();
  await expect(page.locator('#list article')).toHaveCount(9);

  await page.getByRole('button', { name: 'Шиномонтаж', exact: true }).click();
  await expect(page.locator('#list article')).toHaveCount(4);

  await page.getByRole('button', { name: 'Усі', exact: true }).click();
  await page.getByLabel('Пошук').fill('кондиціонер');
  await expect(page.locator('#list article')).toHaveCount(1);
  await expect(page.locator('#list')).toContainText('СТО «Мотор»');

  await page.getByRole('button', { name: 'В обране: СТО «Мотор»' }).click();
  await page.getByLabel('Пошук').fill('');
  await page.getByRole('button', { name: 'Обране', exact: true }).click();
  await expect(page.locator('#list article')).toHaveCount(1);
});

test('запис від вибору послуги до скасування', async ({ page }) => {
  await page.goto('/#/place/koleso');
  await expect(page.getByRole('heading', { name: 'Шиномонтаж «Колесо»' })).toBeVisible();
  await page.getByRole('link', { name: 'Записатися онлайн' }).click();

  const confirm = page.locator('[data-action="confirm"]');
  await expect(confirm).toBeDisabled();
  await page.getByLabel(/Сезонне перевзування/).check();
  await page.getByLabel(/Балансування/).check();
  await expect(page.locator('.summary')).toContainText('1 300 ₴');

  await page.getByRole('button', { name: /Завтра/ }).click();
  const slot = page.locator('.slot:not([disabled])').first();
  const time = await slot.textContent();
  await slot.click();
  await expect(confirm).toBeEnabled();
  await confirm.click();
  await expect(page.locator('.summary')).toContainText('Комісія для клієнта — 0 ₴');
  await page.getByRole('button', { name: 'Оплатити 1 300 ₴' }).click();

  await expect(page).toHaveURL(/#\/bookings\//);
  const card = page.locator('article', { hasText: 'Шиномонтаж «Колесо»' });
  await expect(card).toContainText('Оплачено · гроші утримуються');
  await expect(card.locator('.code')).toHaveText(/^\d{4}$/);
  await expect(card).toContainText(time.trim());

  // Зайнятий мною час більше не пропонується.
  await page.goto('/#/book/koleso');
  await page.getByLabel(/Сезонне перевзування/).check();
  await page.getByRole('button', { name: /Завтра/ }).click();
  await expect(page.locator(`.slot[data-time="${time.trim()}"]`)).toBeDisabled();

  await page.goto('/#/bookings');
  page.once('dialog', (d) => d.accept());
  await page.getByRole('button', { name: 'Скасувати' }).click();
  await expect(page.locator('article').first()).toContainText('Скасовано');
  await expect(page.locator('article').first()).toContainText('Повернено 1 300 ₴');
});

test('авто з гаража задає ціни під час запису', async ({ page }) => {
  await page.goto('/#/garage');
  await page.getByLabel('Марка').fill('Toyota');
  await page.getByLabel('Модель').fill('Land Cruiser');
  await page.getByLabel('Клас').selectOption('2');
  await page.getByRole('button', { name: 'Зберегти' }).click();
  await expect(page.getByRole('heading', { name: 'Toyota Land Cruiser' })).toBeVisible();

  await page.reload();
  await expect(page.getByRole('heading', { name: 'Toyota Land Cruiser' })).toBeVisible();

  await page.goto('/#/book/blysk');
  await expect(page.getByLabel('Ваше авто')).toContainText('Toyota Land Cruiser');
  await page.getByLabel(/Експрес-мийка/).check();
  await expect(page.locator('.summary')).toContainText('350 ₴');
});

// Записує на завтра в «Колесо» на перевзування (900 ₴) і повертає код для майстра.
async function bookTomorrow(page) {
  await page.goto('/#/book/koleso');
  await page.getByLabel(/Сезонне перевзування/).check();
  await page.getByRole('button', { name: /Завтра/ }).click();
  await page.locator('.slot:not([disabled])').first().click();
  await page.locator('[data-action="confirm"]').click();
  await page.getByRole('button', { name: 'Оплатити 900 ₴' }).click();
  return (await page.locator('.code').first().textContent()).trim();
}

async function openPartner(page, name) {
  await page.getByRole('link', { name: 'Для бізнесу' }).click();
  await page.getByLabel('Точка').selectOption({ label: name });
}

// Відкриває перший активний запис точки (екран «Запис клієнта»).
async function openJob(page, name) {
  await openPartner(page, name);
  await page.locator('a.prow').first().click();
  await expect(page.getByRole('heading', { name: 'Запис клієнта' })).toBeVisible();
}

test('гроші утримуються до коду, а комісія береться під час виведення', async ({ page }) => {
  const code = await bookTomorrow(page);
  await openPartner(page, 'Шиномонтаж «Колесо»');
  const balance = page.getByRole('region', { name: 'Баланс' });
  await expect(balance).toContainText('Утримується до виконання900 ₴');

  await page.locator('a.prow').first().click();
  await page.getByLabel('Код клієнта').fill('0000' === code ? '1111' : '0000');
  await page.getByRole('button', { name: 'Підтвердити кодом' }).click();
  await expect(page.locator('#toast')).toHaveText('Невірний код');

  await page.getByLabel('Код клієнта').fill(code);
  await page.getByRole('button', { name: 'Підтвердити кодом' }).click();
  await expect(balance).toContainText('Доступно до виведення900 ₴');

  // 7% від 900 ₴ = 63 ₴, на картку 837 ₴.
  page.once('dialog', (d) => { expect(d.message()).toContain('Комісія 63 ₴'); d.accept(); });
  await page.getByRole('button', { name: 'Вивести 837 ₴ на картку' }).click();
  await expect(page.getByRole('heading', { name: 'Виплати' })).toBeVisible();
  await expect(page.getByText('837 ₴ (комісія 63 ₴)')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Немає коштів для виведення' })).toBeDisabled();

  await page.goto('/#/bookings');
  await expect(page.locator('article').first()).toContainText('Виконано');
});

test('доплата на місці, спір і рішення модератора', async ({ page }) => {
  await bookTomorrow(page);
  await openJob(page, 'Шиномонтаж «Колесо»');
  const answers = ['150', 'Шиповані шини R17'];
  page.on('dialog', (d) => d.accept(answers.shift()));
  await page.getByRole('button', { name: 'Доплата', exact: true }).click();
  await expect(page.getByText('Запит на доплату +150 ₴')).toBeVisible();

  await page.goto('/#/bookings');
  await page.getByRole('button', { name: 'Погодитися й доплатити' }).click();
  await expect(page.locator('article').first()).toContainText('1 050 ₴');

  await openJob(page, 'Шиномонтаж «Колесо»');
  await page.getByRole('button', { name: 'Машина готова' }).click();

  await page.goto('/#/bookings');
  answers.push('Не відбалансували колеса');
  await page.getByRole('button', { name: 'Відкрити спір' }).click();
  await expect(page.locator('article').first()).toContainText('Спір розглядається');

  await openPartner(page, 'Шиномонтаж «Колесо»');
  await page.getByRole('link', { name: /Модерація спорів/ }).click();
  await expect(page.getByText('«Не відбалансували колеса»')).toBeVisible();
  await page.getByRole('button', { name: 'Повернути клієнту' }).click();
  await expect(page.getByText('Відкритих спорів немає.')).toBeVisible();
  await page.getByRole('link', { name: 'Кабінет точки' }).click();
  await expect(page.getByRole('region', { name: 'Баланс' })).toContainText('Доступно до виведення0 ₴');

  await page.goto('/#/bookings');
  await expect(page.locator('article').first()).toContainText('Повернено 1 050 ₴');
});

test('якщо клієнт мовчить, гроші переходять точці через 24 години', async ({ page }) => {
  await bookTomorrow(page);
  await openJob(page, 'Шиномонтаж «Колесо»');
  await page.getByRole('button', { name: 'Машина готова' }).click();
  await page.goto('/#/bookings');
  await expect(page.locator('article').first()).toContainText('Чекає вашого підтвердження');

  await page.clock.setFixedTime(new Date(2026, 9, 5, 10, 1));
  await page.reload();
  await expect(page.locator('article').first()).toContainText('Виконано');
  await openPartner(page, 'Шиномонтаж «Колесо»');
  await expect(page.getByRole('region', { name: 'Баланс' })).toContainText('Доступно до виведення900 ₴');
});

test('пізнє скасування й неявка: частина грошей іде точці', async ({ page }) => {
  // Запис на сьогодні 11:00 о 10:00 — менше ніж за 2 години.
  await page.goto('/#/book/koleso');
  await page.getByLabel(/Сезонне перевзування/).check();
  await page.locator('.slot:not([disabled])').first().click();
  await page.locator('[data-action="confirm"]').click();
  await page.getByRole('button', { name: 'Оплатити 900 ₴' }).click();
  await expect(page.locator('article').first()).toContainText('Пізнє скасування: повернемо 450 ₴');
  page.once('dialog', (d) => d.accept());
  await page.getByRole('button', { name: 'Скасувати' }).click();
  await expect(page.locator('article').first()).toContainText('Повернено 450 ₴ на картку, 450 ₴ отримала точка');

  await bookTomorrow(page);
  await page.clock.setFixedTime(new Date(2026, 9, 5, 22, 0));
  await openJob(page, 'Шиномонтаж «Колесо»');
  page.once('dialog', (d) => d.accept());
  await page.getByRole('button', { name: 'Клієнт не приїхав' }).click();
  await expect(page.getByRole('region', { name: 'Баланс' })).toContainText('Доступно до виведення900 ₴');
});

test.describe('поруч зі мною', () => {
  // Користувач на Троєщині.
  test.use({ geolocation: { latitude: 50.512, longitude: 30.602 }, permissions: ['geolocation'] });

  test('найближчі точки зверху, з відстанню', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'Поруч', exact: true }).click();
    await expect(page.locator('#count')).toContainText('від вас');
    const first = page.locator('#list article').first();
    await expect(first).toContainText('Чисто і швидко');
    await expect(first.locator('.badge.dist')).toHaveText(/^\d+ м$/);
    await expect(page.getByLabel('Сортування')).toHaveValue('near');

    await page.getByRole('button', { name: 'Детейлінг', exact: true }).click();
    await expect(page.locator('#list article')).toHaveCount(2);
    await expect(page.locator('#list article').first()).toContainText('Кераміка Про');

    await page.locator('#list article').first().getByRole('link').first().click();
    await expect(page.getByText(/км від вас/)).toBeVisible();
    await expect(page.getByText('Керамічне покриття кузова')).toBeVisible();
  });
});

test('без геолокації відстань рахується від центру Києва', async ({ page }) => {
  await page.addInitScript(() => {
    navigator.geolocation.getCurrentPosition = (ok, fail) => setTimeout(() => fail({ code: 1 }), 10);
  });
  await page.goto('/');
  await page.getByLabel('Сортування').selectOption('near');
  await expect(page.locator('#toast')).toContainText('від центру Києва');
  await expect(page.locator('#count')).toContainText('від центру Києва');
  await expect(page.locator('#list article').first()).toContainText('Автомийка «Блиск»');
});

const PIXEL = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');

async function addCar(page, extra = async () => {}) {
  await page.goto('/#/garage');
  await page.getByLabel('Марка').fill('Skoda');
  await page.getByLabel('Модель').fill('Octavia');
  await extra();
  await page.getByRole('button', { name: 'Зберегти' }).click();
}

test('«Машина готова» з фото потрапляє клієнту й у сервісну книжку', async ({ page }) => {
  await addCar(page);
  await bookTomorrow(page);
  await openJob(page, 'Шиномонтаж «Колесо»');
  await page.getByLabel(/Додати фото результату/).setInputFiles({ name: 'wheel.png', mimeType: 'image/png', buffer: PIXEL });
  await expect(page.getByText('Обрано фото: 1')).toBeVisible();
  await page.getByLabel('Пробіг, км').fill('84200');
  await page.getByLabel('Коментар для клієнта').fill('Літні шини здали на зберігання');
  await page.getByRole('button', { name: 'Машина готова' }).click();
  await expect(page.locator('#toast')).toHaveText('Клієнт отримав сповіщення «Машина готова»');
  await expect(page.locator('.tabs a[data-tab="bookings"]')).toHaveAttribute('data-badge', '');

  await page.getByRole('link', { name: 'Мої записи' }).click();
  const card = page.locator('article').first();
  await expect(card).toContainText('Машина готова!');
  await expect(card.getByRole('img', { name: 'Фото результату 1' })).toBeVisible();
  await expect(card).toContainText('Літні шини здали на зберігання');
  await card.getByRole('button', { name: 'Усе добре' }).click();
  await expect(card).toContainText('Виконано');
  await expect(page.locator('.tabs a[data-tab="bookings"]')).not.toHaveAttribute('data-badge');

  await page.goto('/#/garage');
  await page.getByRole('link', { name: /Skoda Octavia/ }).click();
  await expect(page.getByText('Перевзування зроблено 5 жовтня 2026 р.')).toBeVisible();
  const log = page.locator('.log-item').first();
  await expect(log).toContainText('Сезонне перевзування (4 колеса)');
  await expect(log).toContainText('Шиномонтаж «Колесо» · 84 200 км');
  await expect(log.getByRole('img', { name: 'Фото 1' })).toBeVisible();
});

test('сервісна книжка нагадує про шини, оливу й поліс', async ({ page }) => {
  await addCar(page, async () => {
    await page.getByLabel('Пробіг, км (необовʼязково)').fill('50000');
    await page.getByLabel('Поліс ОСЦПВ дійсний до (необовʼязково)').fill('2026-10-24');
  });
  await expect(page.getByRole('link', { name: /Skoda Octavia/ })).toContainText('Час перевзутися на зимові шини і ще 1');
  await page.getByRole('link', { name: /Skoda Octavia/ }).click();
  await expect(page.getByText('Немає даних про заміну оливи')).toBeVisible();
  await expect(page.getByText('Поліс ОСЦПВ закінчується через 20 днів')).toBeVisible();

  await page.getByLabel('Що зроблено').fill('Заміна оливи та фільтра');
  await page.getByLabel('Пробіг, км (необовʼязково)').fill('40500');
  await page.getByLabel('Сума, ₴ (необовʼязково)').fill('1800');
  await page.getByRole('button', { name: 'Додати в книжку' }).click();
  await expect(page.getByText('Заміна оливи через 500 км')).toBeVisible();
  await expect(page.locator('.log-item').first()).toContainText('1 800 ₴');

  const { violations } = await new AxeBuilder({ page }).analyze();
  expect(violations.map((v) => v.id)).toEqual([]);

  await page.locator('.reminder', { hasText: 'Час перевзутися' }).getByRole('link', { name: 'Записатися' }).click();
  await expect(page.getByRole('button', { name: 'Шиномонтаж', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#list article')).toHaveCount(4);
});

for (const path of ['/', '/#/place/motor', '/#/book/blysk', '/#/bookings', '/#/garage', '/#/partner', '/#/disputes']) {
  test(`доступність і верстка: ${path}`, async ({ page }) => {
    await page.goto(path);
    await page.locator('main *').first().waitFor();
    const { violations } = await new AxeBuilder({ page }).analyze();
    expect(violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target).join(', ')}`)).toEqual([]);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow).toBeLessThanOrEqual(0);
  });
}

test('працює без збереження в localStorage', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, 'localStorage', { get() { throw new Error('blocked'); } });
  });
  await page.goto('/');
  await expect(page.locator('#list article')).toHaveCount(9);
});

test('файл для дизайну design/carcar-prototype.html зібрано з поточної версії', () => {
  test.skip(test.info().project.name !== 'desktop', 'достатньо однієї перевірки');
  const fresh = join(mkdtempSync(join(tmpdir(), 'carcar-')), 'bundle.html');
  execFileSync('node', ['scripts/bundle.mjs', fresh]);
  const committed = readFileSync('design/carcar-prototype.html', 'utf8');
  expect(committed === readFileSync(fresh, 'utf8'), 'запустіть npm run bundle').toBe(true);
});
