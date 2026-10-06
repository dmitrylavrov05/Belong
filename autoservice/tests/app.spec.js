import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { execFileSync } from 'node:child_process';
import { readFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Фіксований час: неділя, 4 жовтня 2026, 10:00 — сезон перевзування.
test.beforeEach(async ({ page }, testInfo) => {
  // Усі точки — мийки, тож акція «Перша мийка −30%» діяла б у кожному тесті. Вимикаємо її,
  // крім тестів промокодів і маркетингу.
  if (!/промокод|маркетинг/i.test(testInfo.title)) {
    await page.addInitScript(() => localStorage.getItem('carcar.admin.promos') ?? localStorage.setItem('carcar.admin.promos', '[]'));
  }
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

test('каталог автомийок фільтрується за виїздом, пошуком і обраним', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveTitle('CARCAR');
  await expect(page.locator('h1')).toHaveText('Автомийки Києва');
  await expect(page.locator('#list article')).toHaveCount(9);
  // Лише мийки: перемикачів категорій немає.
  await expect(page.getByRole('button', { name: 'Усі', exact: true })).toHaveCount(0);

  await page.getByRole('button', { name: 'Виїзд до вас' }).click();
  await expect(page.locator('#list article')).toHaveCount(2);
  await page.getByRole('button', { name: 'Виїзд до вас' }).click();

  await page.getByLabel('Пошук').fill('нановіск');
  await expect(page.locator('#list article')).toHaveCount(1);
  await expect(page.locator('#list')).toContainText('Автомийка «Піна»');

  await page.getByRole('button', { name: 'В обране: Автомийка «Піна»' }).click();
  await page.getByLabel('Пошук').fill('');
  await page.getByRole('button', { name: 'Обране', exact: true }).click();
  await expect(page.locator('#list article')).toHaveCount(1);
});

test('запис від вибору послуги до скасування', async ({ page }) => {
  await page.goto('/#/place/hvylia');
  await expect(page.getByRole('heading', { name: 'Автомийка «Хвиля»' })).toBeVisible();
  await page.getByRole('link', { name: 'Записатися онлайн' }).click();

  await expect(page.locator('[data-action="to-time"]')).toBeDisabled();
  await page.getByLabel(/Комплекс преміум/).check();
  await page.getByLabel(/Чистка й кондиціонер шкіри/).check();
  await expect(page.locator('.summary')).toContainText('1 300 ₴');

  await page.locator('[data-action="to-time"]').click();
  await page.getByRole('button', { name: /Завтра/ }).click();
  const slot = page.locator('.slot:not([disabled])').first();
  const time = await slot.textContent();
  await slot.click();
  const confirm = page.locator('[data-action="confirm"]');
  await expect(confirm).toBeEnabled();
  await confirm.click();
  await expect(page.locator('.summary')).toContainText('Комісія для клієнта — 0 ₴');
  await page.getByRole('button', { name: 'Оплатити 1 300 ₴' }).click();

  await expect(page).toHaveURL(/#\/bookings\//);
  const card = page.locator('article', { hasText: 'Автомийка «Хвиля»' });
  await expect(card).toContainText('Оплачено · гроші утримуються');
  await expect(card).toContainText('Після візиту тут зʼявиться кнопка «Підтвердити виконання»');
  await expect(card.getByRole('button', { name: 'Підтвердити виконання' })).toHaveCount(0);
  await expect(card).toContainText(time.trim());

  // Зайнятий мною час більше не пропонується.
  await page.goto('/#/book/hvylia');
  await page.getByLabel(/Комплекс преміум/).check();
  await page.locator('[data-action="to-time"]').click();
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
  await page.getByRole('button', { name: 'Зберегти', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Toyota Land Cruiser' })).toBeVisible();

  await page.reload();
  await expect(page.getByRole('heading', { name: 'Toyota Land Cruiser' })).toBeVisible();

  await page.goto('/#/book/blysk');
  await expect(page.getByLabel('Ваше авто')).toContainText('Toyota Land Cruiser');
  await page.getByLabel(/Експрес-мийка/).check();
  await expect(page.locator('.summary')).toContainText('350 ₴');
});

// Записує на завтра в «Колесо» на перевзування (900 ₴) і оплачує.
async function bookTomorrow(page) {
  await page.goto('/#/book/hvylia');
  await page.getByLabel(/Комплекс преміум/).check();
  await page.locator('[data-action="to-time"]').click();
  await page.getByRole('button', { name: /Завтра/ }).click();
  await page.locator('.slot:not([disabled])').first().click();
  await page.locator('[data-action="confirm"]').click();
  await page.getByRole('button', { name: 'Оплатити 900 ₴' }).click();
}

// Переводить годинник на вечір дня візиту (після закриття точки) і підтверджує виконання як клієнт.
async function confirmAfterVisit(page, day = 5) {
  await page.clock.setFixedTime(new Date(2026, 9, day, 21, 30));
  await page.goto('/#/bookings');
  await page.getByRole('button', { name: 'Підтвердити виконання' }).click();
  await expect(page.locator('#toast')).toHaveText('Дякуємо! Виконання підтверджено');
}

async function openPartner(page, name) {
  await page.goto('/#/partner');
  await page.getByLabel('Точка').selectOption({ label: name });
}

// Відкриває перший активний запис точки (екран «Запис клієнта»).
async function openJob(page, name) {
  await openPartner(page, name);
  await page.locator('a.prow').first().click();
  await expect(page.getByRole('heading', { name: 'Запис клієнта' })).toBeVisible();
}

test('клієнт підтверджує кнопкою, гроші заморожені 48 годин, комісія під час виведення', async ({ page }) => {
  await bookTomorrow(page);
  await openPartner(page, 'Автомийка «Хвиля»');
  const balance = page.getByRole('region', { name: 'Баланс' });
  await expect(balance).toContainText('Доступно до виведення0 ₴');
  await expect(balance).toContainText('Заморожено900 ₴');
  await page.locator('a.prow').first().click();
  await expect(page.getByLabel('Код клієнта')).toHaveCount(0);

  await confirmAfterVisit(page);
  const card = page.locator('article').first();
  await expect(card).toContainText('Виконано · гроші заморожені');
  await expect(card).toContainText('Гроші точці заморожені до 7 жовтня о 21:30');

  // У точки замовлення підтвердилось автоматично, але гроші ще заморожені.
  await openPartner(page, 'Автомийка «Хвиля»');
  await expect(balance).toContainText('Доступно до виведення0 ₴');
  await expect(balance).toContainText('Заморожено900 ₴');
  await expect(balance).toContainText('Найближче розморожування: 900 ₴ — 7 жовтня о 21:30');
  await expect(page.locator('a.prow').first()).toContainText('Підтверджено · гроші заморожені');

  await page.clock.setFixedTime(new Date(2026, 9, 7, 21, 31));
  await page.reload();
  await expect(balance).toContainText('Доступно до виведення900 ₴');
  await expect(balance).toContainText('Заморожено0 ₴');

  // Без перевірених реквізитів вивести не можна.
  await expect(page.getByRole('link', { name: 'Вказати реквізити для виплат' })).toBeVisible();
  await page.evaluate(() => localStorage.setItem('carcar.partners', JSON.stringify({
    hvylia: { status: 'approved', payout: { iban: 'UA223052990000026001234567890', holder: 'ФОП Тест', code: '1234567899', verified: true } },
  })));
  await page.reload();

  // 7% від 900 ₴ = 63 ₴, на рахунок 837 ₴.
  page.once('dialog', (d) => { expect(d.message()).toContain('Комісія 63 ₴'); d.accept(); });
  await page.getByRole('button', { name: 'Вивести 837 ₴ на рахунок UA…7890' }).click();
  await expect(page.getByRole('heading', { name: 'Виплати' })).toBeVisible();
  await expect(page.getByText('837 ₴ (комісія 63 ₴)')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Немає коштів для виведення' })).toBeDisabled();

  await page.goto('/#/bookings');
  await expect(card).toContainText('Виконано');
  await expect(card.getByRole('button', { name: 'Відкрити спір' })).toHaveCount(0);
});

test('протягом 48 годин після підтвердження можна відкрити спір', async ({ page }) => {
  await bookTomorrow(page);
  await confirmAfterVisit(page);
  page.once('dialog', (d) => d.accept('Залишились подряпини на диску'));
  await page.getByRole('button', { name: 'Відкрити спір' }).click();
  await expect(page.locator('article').first()).toContainText('Спір розглядається');

  await openPartner(page, 'Автомийка «Хвиля»');
  await page.getByRole('link', { name: /Модерація спорів/ }).click();
  await page.getByRole('button', { name: 'Передати точці' }).click();
  await page.getByRole('link', { name: 'Кабінет точки' }).click();
  // Рішення модератора остаточне: гроші доступні одразу.
  await expect(page.getByRole('region', { name: 'Баланс' })).toContainText('Доступно до виведення900 ₴');
});

test('доплата на місці, спір і рішення модератора', async ({ page }) => {
  await bookTomorrow(page);
  await openJob(page, 'Автомийка «Хвиля»');
  const answers = ['150', 'Шиповані шини R17'];
  page.on('dialog', (d) => d.accept(answers.shift()));
  await page.getByRole('button', { name: 'Доплата', exact: true }).click();
  await expect(page.getByText('Запит на доплату +150 ₴')).toBeVisible();

  await page.goto('/#/bookings');
  await page.getByRole('button', { name: 'Погодитися й доплатити' }).click();
  await expect(page.locator('article').first()).toContainText('1 050 ₴');

  await openJob(page, 'Автомийка «Хвиля»');
  await page.getByRole('button', { name: 'Машина готова' }).click();

  await page.goto('/#/bookings');
  answers.push('Не відбалансували колеса');
  await page.getByRole('button', { name: 'Відкрити спір' }).click();
  await expect(page.locator('article').first()).toContainText('Спір розглядається');

  await openPartner(page, 'Автомийка «Хвиля»');
  await page.getByRole('link', { name: /Модерація спорів/ }).click();
  await expect(page.getByText('«Не відбалансували колеса»')).toBeVisible();
  await page.getByRole('button', { name: 'Повернути клієнту' }).click();
  await expect(page.getByText('Відкритих спорів немає.')).toBeVisible();
  await page.getByRole('link', { name: 'Кабінет точки' }).click();
  await expect(page.getByRole('region', { name: 'Баланс' })).toContainText('Доступно до виведення0 ₴');
  await expect(page.getByRole('region', { name: 'Баланс' })).toContainText('Заморожено0 ₴');

  await page.goto('/#/bookings');
  await expect(page.locator('article').first()).toContainText('Повернено 1 050 ₴');
});

test('якщо клієнт мовчить, замовлення підтверджується через 24 години, а гроші — ще через 48', async ({ page }) => {
  await bookTomorrow(page);
  await openJob(page, 'Автомийка «Хвиля»');
  await page.getByRole('button', { name: 'Машина готова' }).click();
  await page.goto('/#/bookings');
  await expect(page.locator('article').first()).toContainText('Чекає вашого підтвердження');

  await page.clock.setFixedTime(new Date(2026, 9, 5, 10, 1));
  await page.reload();
  await expect(page.locator('article').first()).toContainText('Виконано · гроші заморожені');
  await openPartner(page, 'Автомийка «Хвиля»');
  await expect(page.getByRole('region', { name: 'Баланс' })).toContainText('Заморожено900 ₴');

  await page.clock.setFixedTime(new Date(2026, 9, 7, 10, 1));
  await page.reload();
  await expect(page.getByRole('region', { name: 'Баланс' })).toContainText('Доступно до виведення900 ₴');
});

test('рейтинг точки складається з відгуків після завершених замовлень', async ({ page }) => {
  await page.goto('/#/place/hvylia');
  await expect(page.getByText('Ще немає відгуків. Рейтинг зʼявиться після першого завершеного замовлення.')).toBeVisible();

  await bookTomorrow(page);
  await expect(page.locator('.review-form')).toHaveCount(0);
  await confirmAfterVisit(page);
  const card = page.locator('article').first();
  await card.locator('.star-input label').nth(3).click();
  await card.getByLabel('Відгук (необовʼязково)').fill('Швидко й акуратно');
  await card.getByRole('button', { name: 'Надіслати відгук' }).click();
  await expect(page.locator('#toast')).toHaveText('Дякуємо за відгук!');
  await expect(card).toContainText('Ваш відгук');
  await expect(card.getByRole('img', { name: 'Оцінка 4,0 з 5' })).toBeVisible();
  await expect(card.locator('.review-form')).toHaveCount(0);

  await bookTomorrow(page);
  await confirmAfterVisit(page, 6);
  await page.locator('article').first().locator('.star-input label').nth(4).click();
  await page.locator('article').first().getByRole('button', { name: 'Надіслати відгук' }).click();

  await page.goto('/#/place/hvylia');
  const box = page.locator('.rating-box');
  await expect(box).toContainText('4,5');
  await expect(box).toContainText('2 відгуки');
  await expect(page.locator('.review')).toHaveCount(2);
  await expect(page.locator('.review').last()).toContainText('Швидко й акуратно');
  await expect(page.locator('.review').first()).toContainText('Підтверджений візит · Комплекс преміум: кузов, салон, віск');
  const { violations } = await new AxeBuilder({ page }).analyze();
  expect(violations.map((v) => v.id)).toEqual([]);

  await page.goto('/');
  const first = page.locator('#list article').first();
  await expect(first).toContainText('Автомийка «Хвиля»');
  await expect(first).toContainText('4,5');

  await openPartner(page, 'Автомийка «Хвиля»');
  await expect(page.getByRole('link', { name: /Сторінка точки й відгуки/ })).toContainText('Рейтинг 4,5 · 2 відгуки');
});

test('пізніше ніж за 1,5 год до візиту скасування й неявка — оплата точці', async ({ page }) => {
  // Запис на сьогодні 11:00 о 10:00 — менше ніж за 1,5 години.
  await page.goto('/#/book/hvylia');
  await page.getByLabel(/Комплекс преміум/).check();
  await page.locator('[data-action="to-time"]').click();
  await page.locator('.slot[data-time="11:00"]').click();
  await page.locator('[data-action="confirm"]').click();
  await page.getByRole('button', { name: 'Оплатити 900 ₴' }).click();
  await expect(page.locator('article').first()).toContainText('Тепер оплата зараховується точці за послугу');
  page.once('dialog', (d) => d.accept());
  await page.getByRole('button', { name: 'Скасувати без повернення' }).click();
  await expect(page.locator('article').first()).toContainText('оплату 900 ₴ зараховано точці за послугу');
  await expect(page.getByRole('region', { name: 'Баланс CARCAR' })).toHaveCount(0);

  await bookTomorrow(page);
  await page.clock.setFixedTime(new Date(2026, 9, 5, 22, 0));
  await openJob(page, 'Автомийка «Хвиля»');
  page.once('dialog', (d) => d.accept());
  await page.getByRole('button', { name: 'Клієнт не приїхав' }).click();
  await expect(page.getByRole('region', { name: 'Баланс' })).toContainText('Доступно до виведення1 800 ₴');
  await page.goto('/#/bookings');
  await expect(page.locator('article', { hasText: 'Неявка' })).toContainText('Ви не приїхали — оплату 900 ₴ зараховано точці');
});

test('скасування за 1,5 год і раніше: уся сума на баланс CARCAR, ним можна оплатити й вивести', async ({ page }) => {
  // О 10:00 запис на 11:30 — рівно за 1,5 години, ще можна скасувати з поверненням.
  await page.goto('/#/book/hvylia');
  await page.getByLabel(/Комплекс преміум/).check();
  await page.locator('[data-action="to-time"]').click();
  await page.locator('.slot[data-time="11:30"]').click();
  await page.locator('[data-action="confirm"]').click();
  await expect(page.locator('.summary')).toContainText('Скасування до 1 год 30 хв до візиту');
  await page.getByRole('button', { name: 'Оплатити 900 ₴' }).click();
  await expect(page.locator('article').first()).toContainText('Перенести на інший час або скасувати безкоштовно можна до 4 жовтня о 10:00');
  page.once('dialog', (d) => d.accept());
  await page.getByRole('button', { name: 'Скасувати', exact: true }).click();
  await expect(page.locator('#toast')).toHaveText('Запис скасовано, 900 ₴ повернено на баланс');
  await expect(page.locator('article', { hasText: 'Скасовано' })).toContainText('Повернено 900 ₴ на баланс CARCAR');
  // Баланс живе в профілі («Гараж» → «Гаманець»), а не в «Моїх записах».
  await expect(page.getByRole('region', { name: 'Баланс CARCAR' })).toHaveCount(0);
  await page.goto('/#/garage');
  await expect(page.getByRole('link', { name: /Гаманець/ })).toContainText('Баланс 900 ₴');
  await page.getByRole('link', { name: /Гаманець/ }).click();
  const balance = page.getByRole('region', { name: 'Баланс CARCAR' });
  await expect(balance.locator('.bonus-sum')).toHaveText('900 ₴');

  // Наступне замовлення: баланс списується, доплата карткою — лише різниця.
  await page.goto('/#/book/hvylia');
  await page.getByLabel(/Комплекс преміум/).check();
  await page.getByLabel(/Чистка й кондиціонер шкіри/).check();
  await page.locator('[data-action="to-time"]').click();
  await page.getByRole('button', { name: /Завтра/ }).click();
  await page.locator('.slot:not([disabled])').first().click();
  await page.locator('[data-action="confirm"]').click();
  await expect(page.locator('.summary')).toContainText('До сплати карткою');
  await page.getByLabel(/Баланс CARCAR/).uncheck();
  await expect(page.getByRole('button', { name: 'Оплатити 1 300 ₴' })).toBeVisible();
  await page.getByLabel(/Баланс CARCAR/).check();
  await page.getByRole('button', { name: 'Оплатити 400 ₴' }).click();
  await page.goto('/#/wallet');
  await expect(balance.locator('.bonus-sum')).toHaveText('0 ₴');

  // Скасовуємо й виводимо повернення на картку.
  await page.goto('/#/bookings');
  page.once('dialog', (d) => d.accept());
  await page.locator('article', { hasText: 'гроші утримуються' }).getByRole('button', { name: 'Скасувати', exact: true }).click();
  await page.goto('/#/wallet');
  await expect(balance.locator('.bonus-sum')).toHaveText('1 300 ₴');
  page.once('dialog', (d) => d.accept());
  await balance.getByRole('button', { name: 'Вивести 1 300 ₴ на картку' }).click();
  await expect(balance.locator('.bonus-sum')).toHaveText('0 ₴');
  await expect(balance).toContainText('Виведено на картку');
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

    await page.getByLabel('Пошук').fill('керамічне');
    await expect(page.locator('#list article')).toHaveCount(2);
    await expect(page.locator('#list article').first()).toContainText('Кераміка Про');

    await page.locator('#list article').first().getByRole('link').first().click();
    await expect(page.locator('.travel')).toContainText(/\d+ хв · [\d,]+ км/);
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

test.describe('приведи друга', () => {
  test.use({ permissions: ['clipboard-read', 'clipboard-write'] });

  test('друг за посиланням отримує 150 ₴, платить менше, а точка отримує повну ціну', async ({ page }) => {
    await page.goto('/?ref=CARTEST2');
    await expect(page.locator('#toast')).toHaveText('Вам нараховано 150 ₴ на перше замовлення');
    await expect(page).not.toHaveURL(/ref=/);
    await expect(page.locator('.bonus-banner')).toContainText('У вас 150 ₴ бонусу');

    await page.goto('/#/book/hvylia');
    await page.getByLabel(/Комплекс преміум/).check();
    await page.locator('[data-action="to-time"]').click();
    await page.getByRole('button', { name: /Завтра/ }).click();
    await page.locator('.slot:not([disabled])').first().click();
    await page.locator('[data-action="confirm"]').click();
    await expect(page.locator('.summary')).toContainText('Бонус «Приведи друга»');
    await expect(page.locator('.summary')).toContainText('−150 ₴');
    await page.getByRole('button', { name: 'Оплатити 750 ₴' }).click();
    const card = page.locator('article').first();
    await expect(card).toContainText('Оплачено 750 ₴ + бонус 150 ₴');

    await page.goto('/');
    await expect(page.locator('.bonus-banner')).toHaveCount(0);

    await openPartner(page, 'Автомийка «Хвиля»');
    await expect(page.getByRole('region', { name: 'Баланс' })).toContainText('Заморожено900 ₴');
    await confirmAfterVisit(page);
    await page.clock.setFixedTime(new Date(2026, 9, 7, 21, 31));
    await openPartner(page, 'Автомийка «Хвиля»');
    await expect(page.getByRole('region', { name: 'Баланс' })).toContainText('Доступно до виведення900 ₴');
  });

  test('бонус лише від 300 ₴, його можна не використовувати, а при скасуванні він повертається', async ({ page }) => {
    // Без акції «Перша мийка» — тут перевіряємо лише бонус.
    await page.addInitScript(() => localStorage.getItem('carcar.admin.promos') ?? localStorage.setItem('carcar.admin.promos', '[]'));
    await page.goto('/?ref=CARTEST2');
    await page.goto('/#/book/blysk');
    await page.getByLabel(/Експрес-мийка/).check();
    await page.locator('[data-action="to-time"]').click();
    await page.getByRole('button', { name: /Завтра/ }).click();
    await page.locator('.slot:not([disabled])').first().click();
    await page.locator('[data-action="confirm"]').click();
    await expect(page.locator('.summary')).toContainText('Бонус 150 ₴ діє для замовлень від 300 ₴');
    await expect(page.getByRole('button', { name: 'Оплатити 250 ₴' })).toBeVisible();
    await page.getByRole('button', { name: 'Назад' }).click();
    await page.locator('[data-action="step-back"]').click();

    await page.getByLabel(/Комплекс: кузов/).check();
    await page.locator('[data-action="to-time"]').click();
    await page.locator('.slot:not([disabled])').first().click();
    await page.locator('[data-action="confirm"]').click();
    await expect(page.getByRole('button', { name: 'Оплатити 400 ₴' })).toBeVisible();
    await page.getByLabel(/Бонус «Приведи друга»/).uncheck();
    await expect(page.getByRole('button', { name: 'Оплатити 550 ₴' })).toBeVisible();
    await page.getByLabel(/Бонус «Приведи друга»/).check();
    await page.getByRole('button', { name: 'Оплатити 400 ₴' }).click();

    page.once('dialog', (d) => d.accept());
    await page.getByRole('button', { name: 'Скасувати' }).click();
    await expect(page.locator('article').first()).toContainText('Повернено 400 ₴ на баланс CARCAR і 150 ₴ на бонусний рахунок');
    await page.goto('/#/invite');
    await expect(page.locator('.bonus-sum')).toHaveText('150 ₴');
  });

  test('власне, недійсне чи запізніле запрошення бонусу не дає', async ({ page }) => {
    await page.goto('/#/invite');
    const code = (await page.locator('.ref-code').textContent()).trim();
    await page.goto(`/?ref=${code}`);
    await expect(page.locator('#toast')).toHaveText('Це ваше посилання — надішліть його другу');
    await page.goto('/?ref=hello');
    await expect(page.locator('#toast')).toHaveText('Посилання-запрошення недійсне');

    await bookTomorrow(page);
    await page.goto('/?ref=CARTEST2');
    await expect(page.locator('#toast')).toHaveText('Бонус за запрошенням діє лише для нових користувачів');
    await page.goto('/#/invite');
    await expect(page.locator('.bonus-sum')).toHaveText('0 ₴');
  });

  test('сторінка «Приведи друга»: посилання копіюється, бонус за друга нараховується', async ({ page }) => {
    await page.goto('/#/bookings');
    await page.getByRole('link', { name: /Приведи друга/ }).click();
    await expect(page.getByRole('heading', { name: 'Приведи друга' })).toBeVisible();
    const code = (await page.locator('.ref-code').textContent()).trim();
    expect(code).toMatch(/^CAR[A-Z0-9]{5}$/);

    await page.getByRole('button', { name: 'Скопіювати' }).click();
    await expect(page.locator('#toast')).toHaveText('Посилання скопійовано');
    expect(await page.evaluate(() => navigator.clipboard.readText())).toContain(`?ref=${code}`);

    await page.getByRole('button', { name: 'Демо: друг завершив перше замовлення' }).click();
    await expect(page.locator('.bonus-sum')).toHaveText('150 ₴');
    await expect(page.getByText('Друг 1')).toBeVisible();
  });
});

const PIXEL = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');

async function addCar(page, extra = async () => {}) {
  await page.goto('/#/garage');
  await page.getByLabel('Марка').fill('Skoda');
  await page.getByLabel('Модель').fill('Octavia');
  await extra();
  await page.getByRole('button', { name: 'Зберегти', exact: true }).click();
}

test('«Машина готова» з фото потрапляє клієнту й у сервісну книжку', async ({ page }) => {
  await addCar(page);
  await bookTomorrow(page);
  await openJob(page, 'Автомийка «Хвиля»');
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
  await expect(card).toContainText('Виконано · гроші заморожені');
  await expect(page.locator('.tabs a[data-tab="bookings"]')).not.toHaveAttribute('data-badge');

  await page.goto('/#/garage');
  await page.getByRole('link', { name: /Skoda Octavia/ }).click();
  await expect(page.getByText('Остання мийка 5 жовтня 2026 р.')).toBeVisible();
  const log = page.locator('.log-item').first();
  await expect(log).toContainText('Комплекс преміум: кузов, салон, віск');
  await expect(log).toContainText('Автомийка «Хвиля» · 84 200 км');
  await expect(log.getByRole('img', { name: 'Фото 1' })).toBeVisible();
});

test('гараж нагадує помити авто й про поліс', async ({ page }) => {
  await addCar(page, async () => {
    await page.getByLabel('Поліс ОСЦПВ дійсний до (необовʼязково)').fill('2026-10-24');
  });
  await expect(page.getByRole('link', { name: /Skoda Octavia/ })).toContainText('Поліс ОСЦПВ закінчується через 20 днів');
  await page.getByRole('link', { name: /Skoda Octavia/ }).click();
  await expect(page.getByText('Ще немає мийок цього авто в CARCAR')).toBeVisible();
  await expect(page.getByText('Поліс ОСЦПВ закінчується через 20 днів')).toBeVisible();

  await page.locator('summary', { hasText: 'Додати мийку вручну' }).click();
  await page.getByLabel('Дата').fill('2026-09-01');
  await page.getByLabel('Що зроблено').fill('Мийка кузова на АЗС');
  await page.getByLabel('Сума, ₴ (необовʼязково)').fill('300');
  await page.getByRole('button', { name: 'Додати в історію' }).click();
  await expect(page.getByText('Авто не мили 33 дні — час на мийку')).toBeVisible();
  await expect(page.locator('.log-item').first()).toContainText('300 ₴');

  const { violations } = await new AxeBuilder({ page }).analyze();
  expect(violations.map((v) => v.id)).toEqual([]);

  await page.locator('.reminder', { hasText: 'час на мийку' }).getByRole('link', { name: 'Записатися' }).click();
  await expect(page.locator('#list article')).toHaveCount(9);
});

for (const path of ['/', '/#/place/pina', '/#/book/blysk', '/#/bookings', '/#/garage', '/#/partner', '/#/disputes', '/#/invite']) {
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

test('файли для дизайну в design/ зібрано з поточної версії', () => {
  test.skip(test.info().project.name !== 'desktop', 'достатньо однієї перевірки');
  const dir = mkdtempSync(join(tmpdir(), 'carcar-'));
  execFileSync('node', ['scripts/bundle.mjs', dir]);
  for (const f of ['carcar-prototype.html', 'carcar-business.html', 'carcar-admin.html']) {
    expect(readFileSync(`design/${f}`, 'utf8') === readFileSync(join(dir, f), 'utf8'), `${f}: запустіть npm run bundle`).toBe(true);
  }
});
