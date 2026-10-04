import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

// Той самий фіксований час, що й у тестах застосунку: неділя, 4 жовтня 2026, 10:00.
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

const PANEL = '/business.html';

async function selectPlace(page, name) {
  await page.getByLabel('Точка').selectOption({ label: name });
}

async function fillDemo(page, name = 'Автомийка «Блиск»') {
  await page.goto(PANEL);
  await selectPlace(page, name);
  await page.getByRole('button', { name: 'Заповнити демо-історію' }).click();
  await expect(page.locator('#toast')).toContainText('демо-записів за 90 днів');
}

// Новий запис у журналі: на завтра, перша послуга зі списку.
async function addCrmBooking(page, { name, phone, service, date = '2026-10-05', time }) {
  await page.getByRole('button', { name: 'Новий запис' }).first().click();
  const form = page.locator('#nb-form');
  await form.getByLabel('Імʼя клієнта').fill(name);
  await form.getByLabel('Телефон клієнта').fill(phone);
  await form.getByLabel(service).check();
  await form.getByLabel('Дата').fill(date);
  await form.getByLabel('Дата').dispatchEvent('change');
  if (time) await form.getByLabel('Час').selectOption(time);
  await form.getByRole('button', { name: 'Записати' }).click();
  await expect(page.locator('#toast')).toContainText(`Записано: ${name}`);
}

test('порожня панель пропонує демо-історію, а з нею показує аналітику', async ({ page }) => {
  await page.goto(PANEL);
  await expect(page.getByRole('heading', { name: 'Ще немає даних' })).toBeVisible();
  await fillDemo(page);

  const kpis = page.getByRole('region', { name: 'Показники за період' });
  await expect(kpis).toContainText('Виручка');
  await expect(kpis.locator('.kpi.hero .value')).toHaveText(/\d[\d\s]* ₴/);
  await expect(kpis).toContainText('через CARCAR');
  await expect(page.locator('#ch-rev path.s1, #ch-rev path.s2, #ch-rev rect.s1, #ch-rev rect.s2').first()).toBeVisible();
  await expect(page.locator('#ch-rev .hit')).toHaveCount(30);

  // Тултип на стовпчику: значення першим, назва серії після.
  await page.locator('#ch-rev .hit').nth(10).hover();
  await expect(page.locator('#tip')).toBeVisible();
  await expect(page.locator('#tip')).toContainText('Через CARCAR');
  await expect(page.locator('#tip')).toContainText('Разом');

  // Те саме видно таблицею, без наведення.
  await page.locator('details.table-view').first().locator('summary').click();
  await expect(page.locator('details.table-view').first().locator('tbody tr')).toHaveCount(30);

  await page.getByRole('button', { name: '7 днів' }).click();
  await expect(page.getByRole('button', { name: '7 днів' })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#ch-rev .hit')).toHaveCount(7);

  // Демо-історія не потрапляє в «Мої записи» клієнта.
  await page.goto('/#/bookings');
  await expect(page.getByText('Записів поки немає.')).toBeVisible();
});

test('запис із журналу займає час у застосунку клієнта', async ({ page }) => {
  await page.goto(`${PANEL}#/settings`);
  await selectPlace(page, 'Шиномонтаж «Колесо»');
  await page.getByLabel('Кількість боксів').fill('1');
  await page.getByRole('button', { name: 'Зберегти' }).click();
  await expect(page.locator('#toast')).toHaveText('Профіль збережено');

  await page.goto(`${PANEL}#/schedule`);
  await addCrmBooking(page, { name: 'Тестовий Клієнт', phone: '+380 50 000 00 01', service: /Сезонне перевзування/, time: '10:00' });
  await expect(page).toHaveURL(/#\/schedule\/2026-10-05/);
  const block = page.locator('.slot-block', { hasText: 'Тестовий Клієнт' });
  await expect(block).toContainText('10:00–10:50');
  await expect(block).toContainText('Телефон · Записано');

  await page.goto('/#/book/koleso');
  await page.getByLabel(/Сезонне перевзування/).check();
  await page.getByRole('button', { name: /Завтра/ }).click();
  await expect(page.locator('.slot[data-time="10:00"]')).toBeDisabled();
  await expect(page.locator('.slot[data-time="09:30"]')).toBeDisabled();
  await expect(page.locator('.slot[data-time="11:00"]')).toBeEnabled();
});

test('виконаний запис зʼявляється в клієнтах і виручці, нотатки й мітки зберігаються', async ({ page }) => {
  await page.goto(`${PANEL}#/schedule`);
  await selectPlace(page, 'Шиномонтаж «Колесо»');
  await addCrmBooking(page, { name: 'Олена Тест', phone: '+380 50 000 00 02', service: /Сезонне перевзування/, date: '2026-10-04', time: '11:00' });

  await page.locator('.slot-block', { hasText: 'Олена Тест' }).click();
  const drawer = page.getByRole('dialog');
  await drawer.getByLabel('Готівка').check();
  await drawer.getByRole('button', { name: 'Виконано й оплачено' }).click();
  await expect(page.locator('#toast')).toHaveText('Запис виконано й оплачено');

  await page.getByRole('link', { name: 'Клієнти' }).click();
  const row = page.locator('tr', { hasText: 'Олена Тест' });
  await expect(row).toContainText('900 ₴');
  await expect(row.locator('td').nth(2)).toHaveText('1');
  await row.getByRole('link', { name: 'Олена Тест' }).click();
  await page.getByRole('button', { name: 'VIP' }).click();
  await page.getByLabel('Нотатка').fill('Шини зберігаємо в нас');
  await page.getByRole('button', { name: 'Зберегти нотатку' }).click();
  await page.reload();
  await expect(page.getByRole('button', { name: 'VIP' })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByLabel('Нотатка')).toHaveValue('Шини зберігаємо в нас');

  await page.getByRole('link', { name: 'Клієнти' }).first().click();
  await page.getByRole('button', { name: /VIP · 1/ }).click();
  await expect(page.locator('#client-rows tr')).toHaveCount(1);

  await page.locator('#nav').getByRole('link', { name: 'Огляд' }).click();
  await expect(page.locator('.kpi.hero')).toContainText('900 ₴');
  await expect(page.locator('.kpi.hero')).toContainText('на місці 900 ₴');
});

test('прайс із панелі одразу бачать клієнти', async ({ page }) => {
  await page.goto(`${PANEL}#/services`);
  await selectPlace(page, 'Шиномонтаж «Колесо»');
  await page.getByLabel('Ціна, Легкове: Сезонне перевзування (4 колеса)').fill('1000');
  await page.getByLabel('Активна: Ремонт проколу').uncheck();
  await page.getByRole('button', { name: 'Додати послугу' }).click();
  await page.getByLabel('Назва послуги 6').fill('Перевірка тиску в шинах');
  await page.getByLabel('Тривалість, хв: Перевірка тиску в шинах').fill('10');
  await page.getByLabel('Ціна, Легкове: Перевірка тиску в шинах').fill('100');
  await page.getByRole('button', { name: 'Зберегти прайс' }).click();
  await expect(page.locator('#toast')).toHaveText('Прайс збережено — клієнти вже бачать нові ціни');

  await page.goto('/#/place/koleso');
  await expect(page.locator('.item', { hasText: 'Сезонне перевзування' })).toContainText('1 000 ₴');
  await expect(page.getByText('Ремонт проколу')).toHaveCount(0);
  await expect(page.locator('.item', { hasText: 'Перевірка тиску в шинах' })).toContainText('100 ₴');

  await page.goto(`${PANEL}#/services`);
  page.once('dialog', (d) => d.accept());
  await page.getByRole('button', { name: 'Повернути стандартний прайс' }).click();
  await page.goto('/#/place/koleso');
  await expect(page.locator('.item', { hasText: 'Сезонне перевзування' })).toContainText('900 ₴');
});

test('відповідь на відгук видно на сторінці точки', async ({ page }) => {
  // Клієнт записується, підтверджує виконання й залишає відгук.
  await page.goto('/#/book/koleso');
  await page.getByLabel(/Сезонне перевзування/).check();
  await page.getByRole('button', { name: /Завтра/ }).click();
  await page.locator('.slot:not([disabled])').first().click();
  await page.locator('[data-action="confirm"]').click();
  await page.getByRole('button', { name: 'Оплатити 900 ₴' }).click();
  await page.clock.setFixedTime(new Date(2026, 9, 5, 21, 30));
  await page.goto('/#/bookings');
  await page.getByRole('button', { name: 'Підтвердити виконання' }).click();
  await page.locator('.star-input label').nth(4).click();
  await page.getByRole('button', { name: 'Надіслати відгук' }).click();

  await page.goto(`${PANEL}#/reviews`);
  await selectPlace(page, 'Шиномонтаж «Колесо»');
  await expect(page.locator('#nav')).toContainText('1');
  await page.getByLabel('Відповісти').fill('Дякуємо, чекаємо навесні!');
  await page.getByRole('button', { name: 'Відповісти' }).click();
  await expect(page.locator('#toast')).toHaveText('Відповідь опубліковано на сторінці точки');

  await page.goto('/#/place/koleso');
  await expect(page.locator('.review .reply')).toContainText('Дякуємо, чекаємо навесні!');
});

test('фінанси: замовлення через CARCAR, заморожування, виплата й експорт', async ({ page }) => {
  await page.goto('/#/book/koleso');
  await page.getByLabel(/Сезонне перевзування/).check();
  await page.getByRole('button', { name: /Завтра/ }).click();
  await page.locator('.slot:not([disabled])').first().click();
  await page.locator('[data-action="confirm"]').click();
  await page.getByRole('button', { name: 'Оплатити 900 ₴' }).click();

  await page.goto(`${PANEL}#/finance`);
  await selectPlace(page, 'Шиномонтаж «Колесо»');
  const row = page.locator('tbody tr', { hasText: 'Сезонне перевзування' });
  await expect(row).toContainText('У роботі');

  // Майстер позначає «Машина готова» з журналу, клієнт підтверджує в застосунку.
  await page.clock.setFixedTime(new Date(2026, 9, 5, 21, 30));
  await page.goto(`${PANEL}#/schedule/2026-10-05`);
  await page.locator('.slot-block').first().click();
  await page.getByRole('dialog').getByRole('button', { name: 'Машина готова' }).click();
  await page.goto('/#/bookings');
  await page.getByRole('button', { name: 'Усе добре' }).click();

  await page.goto(`${PANEL}#/finance`);
  await expect(row).toContainText('Заморожено до 7 жовтня о 21:30');
  await page.clock.setFixedTime(new Date(2026, 9, 7, 21, 31));
  await page.reload();
  await expect(row).toContainText('Доступно');
  await expect(page.getByRole('region', { name: 'Баланс' })).toContainText('900 ₴');

  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Експорт CSV' }).click();
  expect((await download).suggestedFilename()).toBe('carcar-finance-koleso.csv');

  page.once('dialog', (d) => d.accept());
  await page.getByRole('button', { name: 'Вивести 837 ₴ на картку' }).click();
  await expect(page.locator('tbody tr', { hasText: '837 ₴' })).toBeVisible();
});

for (const path of ['#/', '#/schedule', '#/clients', '#/services', '#/finance', '#/reviews', '#/settings']) {
  test(`панель: доступність і верстка ${path}`, async ({ page }) => {
    await fillDemo(page);
    await page.goto(`${PANEL}${path}`);
    await page.locator('#view h1').waitFor();
    const { violations } = await new AxeBuilder({ page }).analyze();
    expect(violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target).join(', ')}`)).toEqual([]);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow).toBeLessThanOrEqual(0);
  });
}

test('картка клієнта й бічна панель запису доступні', async ({ page }) => {
  await fillDemo(page);
  await page.goto(`${PANEL}#/clients`);
  await page.locator('a.row-link').first().click();
  await expect(page.getByRole('heading', { name: 'Історія візитів' })).toBeVisible();
  let { violations } = await new AxeBuilder({ page }).analyze();
  expect(violations.map((v) => v.id)).toEqual([]);

  await page.goto(`${PANEL}#/schedule/2026-10-05`);
  await page.locator('.slot-block').first().click();
  await expect(page.getByRole('dialog')).toBeVisible();
  ({ violations } = await new AxeBuilder({ page }).analyze());
  expect(violations.map((v) => v.id)).toEqual([]);
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
});
