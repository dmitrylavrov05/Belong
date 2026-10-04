import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

// Фіксований час: неділя, 4 жовтня 2026, 10:00 — сезон перевзування.
test.beforeEach(async ({ page }) => {
  await page.clock.setFixedTime(new Date(2026, 9, 4, 10, 0));
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  page.errors = errors;
});

test.afterEach(async ({ page }) => {
  expect(page.errors).toEqual([]);
});

test('каталог фільтрується за категорією, пошуком і обраним', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByText('Час на зимову гуму')).toBeVisible();
  await expect(page.locator('#list article')).toHaveCount(7);

  await page.getByRole('button', { name: '🛞 Шиномонтаж' }).click();
  await expect(page.locator('#list article')).toHaveCount(4);

  await page.getByRole('button', { name: 'Усі', exact: true }).click();
  await page.getByLabel('Пошук').fill('кондиціонер');
  await expect(page.locator('#list article')).toHaveCount(1);
  await expect(page.locator('#list')).toContainText('СТО «Мотор»');

  await page.getByRole('button', { name: 'В обране: СТО «Мотор»' }).click();
  await page.getByLabel('Пошук').fill('');
  await page.getByRole('button', { name: '❤️ Обране' }).click();
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

test('гроші утримуються до коду, а комісія береться під час виведення', async ({ page }) => {
  const code = await bookTomorrow(page);
  await openPartner(page, 'Шиномонтаж «Колесо»');
  const balance = page.getByRole('region', { name: 'Баланс' });
  await expect(balance).toContainText('Утримується до виконання900 ₴');

  await page.getByLabel('Код клієнта').fill('0000' === code ? '1111' : '0000');
  await page.getByRole('button', { name: 'Підтвердити' }).click();
  await expect(page.locator('#toast')).toHaveText('Невірний код');

  await page.getByLabel('Код клієнта').fill(code);
  await page.getByRole('button', { name: 'Підтвердити' }).click();
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
  await openPartner(page, 'Шиномонтаж «Колесо»');
  const answers = ['150', 'Шиповані шини R17'];
  page.on('dialog', (d) => d.accept(answers.shift()));
  await page.getByRole('button', { name: '＋ Доплата' }).click();
  await expect(page.getByText('Запит на доплату +150 ₴')).toBeVisible();

  await page.goto('/#/bookings');
  await page.getByRole('button', { name: 'Погодитися й доплатити' }).click();
  await expect(page.locator('article').first()).toContainText('1 050 ₴');

  await openPartner(page, 'Шиномонтаж «Колесо»');
  await page.getByRole('button', { name: 'Виконано без коду' }).click();

  await page.goto('/#/bookings');
  answers.push('Не відбалансували колеса');
  await page.getByRole('button', { name: 'Відкрити спір' }).click();
  await expect(page.locator('article').first()).toContainText('Спір розглядається');

  await openPartner(page, 'Шиномонтаж «Колесо»');
  await expect(page.getByText('«Не відбалансували колеса»').first()).toBeVisible();
  await page.getByRole('button', { name: 'Повернути клієнту' }).click();
  await expect(page.getByRole('region', { name: 'Баланс' })).toContainText('Доступно до виведення0 ₴');

  await page.goto('/#/bookings');
  await expect(page.locator('article').first()).toContainText('Повернено 1 050 ₴');
});

test('якщо клієнт мовчить, гроші переходять точці через 24 години', async ({ page }) => {
  await bookTomorrow(page);
  await openPartner(page, 'Шиномонтаж «Колесо»');
  await page.getByRole('button', { name: 'Виконано без коду' }).click();
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
  await openPartner(page, 'Шиномонтаж «Колесо»');
  page.once('dialog', (d) => d.accept());
  await page.getByRole('button', { name: 'Клієнт не приїхав' }).click();
  await expect(page.getByRole('region', { name: 'Баланс' })).toContainText('Доступно до виведення900 ₴');
});

for (const path of ['/', '/#/place/motor', '/#/book/blysk', '/#/bookings', '/#/garage', '/#/partner']) {
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
  await expect(page.locator('#list article')).toHaveCount(7);
});
