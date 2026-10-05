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

  await expect(page.getByRole('link', { name: 'Вказати реквізити для виплат' })).toBeVisible();
  await page.evaluate(() => localStorage.setItem('carcar.partners', JSON.stringify({
    koleso: { status: 'approved', payout: { iban: 'UA223052990000026001234567890', holder: 'ФОП Тест', code: '1234567899', verified: true } },
  })));
  await page.reload();
  page.once('dialog', (d) => d.accept());
  await page.getByRole('button', { name: 'Вивести 837 ₴ на рахунок UA…7890' }).click();
  await expect(page.getByRole('region', { name: 'Виплати' }).locator('tbody tr', { hasText: '837 ₴' })).toBeVisible();

  // У звіті про прибутки замовлення — дохід через CARCAR, комісія 7% — витрата.
  const report = page.locator('table.pnl');
  await expect(report.locator('tr', { hasText: 'Через CARCAR' })).toContainText('900 ₴');
  await expect(report.locator('tr', { hasText: 'Комісія CARCAR' })).toContainText('63 ₴');
  await expect(report.locator('tfoot tr', { hasText: 'Прибуток' })).toContainText('837 ₴');
});

for (const path of ['#/', '#/schedule', '#/clients', '#/requests', '#/services', '#/finance', '#/expenses', '#/reviews', '#/settings', '#/import']) {
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

test('графік: вихідний, перерва, особлива дата й горизонт запису видно клієнту', async ({ page }) => {
  await page.goto(`${PANEL}#/settings`);
  await selectPlace(page, 'Шиномонтаж «Колесо»');
  const form = page.locator('#settings-form');
  await form.getByRole('checkbox', { name: 'Понеділок' }).uncheck();
  await expect(form.getByLabel('Відкриття, Понеділок')).toBeDisabled();
  await form.getByLabel('Щодня').check();
  await form.getByLabel('Початок перерви').selectOption('13:00');
  await form.getByLabel('Кінець перерви').selectOption('14:00');
  await form.getByLabel('Запис наперед').selectOption({ label: 'на 7 днів' });
  await form.getByRole('button', { name: 'Зберегти' }).click();
  await expect(page.locator('#toast')).toHaveText('Профіль збережено');

  // Вівторок, 6 жовтня, — санітарний день.
  const special = page.locator('#special-form');
  await special.getByLabel('Дата').fill('2026-10-06');
  await special.getByRole('button', { name: 'Додати дату' }).click();
  await expect(page.locator('.special-list')).toContainText('6 жовтня');
  await expect(page.locator('.special-list')).toContainText('Вихідний');

  // Журнал понеділка попереджає про вихідний.
  await page.goto(`${PANEL}#/schedule/2026-10-05`);
  await expect(page.locator('.notice.warn')).toContainText('вихідний');

  await page.goto('/#/book/koleso');
  await page.getByLabel(/Сезонне перевзування/).check();
  await expect(page.getByRole('button', { name: /Завтра/ })).toBeDisabled();
  await expect(page.locator('.day[data-date="2026-10-06"]')).toBeDisabled();
  await expect(page.locator('.day[data-date="2026-10-06"]')).toContainText('вихідний');
  // Запис на тиждень наперед — з 4 по 10 жовтня.
  await expect(page.locator('.day')).toHaveCount(7);
  await page.locator('.day:not([disabled])').nth(1).click();
  await expect(page.locator('.slot[data-time="12:30"]')).toBeDisabled();
  await expect(page.locator('.slot[data-time="13:00"]')).toBeDisabled();
  await expect(page.locator('.slot[data-time="14:00"]')).toBeEnabled();

  await page.goto(`${PANEL}#/settings`);
  page.once('dialog', (d) => d.accept());
  await page.getByRole('button', { name: 'Повернути як було' }).click();
  await expect(page.locator('#settings-form').getByRole('checkbox', { name: 'Понеділок' })).toBeChecked();
});

test('персональна послуга з індивідуальною ціною: клієнт бачить її й оплачує', async ({ page }) => {
  await page.goto(`${PANEL}#/clients`);
  await selectPlace(page, 'Шиномонтаж «Колесо»');
  await page.getByRole('button', { name: 'Новий клієнт' }).click();
  const drawer = page.getByRole('dialog');
  await drawer.getByLabel('Імʼя клієнта').fill('Марина Постійна');
  await drawer.getByLabel('Телефон клієнта').fill('067 111 22 33');
  await drawer.getByLabel('Авто', { exact: true }).fill('Toyota RAV4');
  await drawer.getByRole('button', { name: 'Додати клієнта' }).click();
  await expect(page.locator('#toast')).toHaveText('Клієнта додано: Марина Постійна');
  await expect(page.getByRole('heading', { name: 'Марина Постійна' })).toBeVisible();

  await page.getByRole('button', { name: 'Додати персональну послугу' }).click();
  await drawer.getByLabel('Основа').selectOption({ index: 1 });
  await expect(drawer.getByLabel('Назва послуги')).toHaveValue(/Сезонне перевзування/);
  await drawer.getByLabel('Ціна для клієнта, ₴').fill('700');
  await drawer.getByLabel('Примітка для клієнта').fill('Ціна для постійного клієнта');
  await drawer.getByRole('button', { name: 'Зберегти послугу' }).click();
  await expect(page.locator('.offer-list')).toContainText('700 ₴');
  await expect(page.locator('.offer-list')).toContainText('у прайсі 900 ₴');

  // Клієнтські списки: імпорт ще не потрібен — клієнт є в базі без жодного запису.
  await page.locator('#nav').getByRole('link', { name: 'Клієнти' }).click();
  await expect(page.locator('#client-rows tr', { hasText: 'Марина Постійна' })).toContainText('Toyota RAV4');

  // Інший телефон — персональної послуги не видно.
  await page.goto('/#/place/koleso');
  await expect(page.getByText('Тільки для вас')).toHaveCount(0);

  // Клієнт із цим телефоном (у іншому форматі) бачить і оплачує персональну ціну.
  await page.goto('/#/garage');
  await page.locator('#profileform').getByLabel('Телефон').fill('+380671112233');
  await page.locator('#profileform').getByRole('button', { name: 'Зберегти профіль' }).click();
  await page.goto('/#/place/koleso');
  await expect(page.getByRole('heading', { name: 'Тільки для вас' })).toBeVisible();
  await expect(page.locator('.personal-list')).toContainText('700 ₴');
  await page.goto('/#/book/koleso');
  await page.getByLabel(/Сезонне перевзування.*Для вас|Для вас.*Сезонне/).check();
  await page.getByRole('button', { name: /Завтра/ }).click();
  await page.locator('.slot:not([disabled])').first().click();
  await page.locator('[data-action="confirm"]').click();
  await page.getByRole('button', { name: 'Оплатити 700 ₴' }).click();

  // Запис потрапляє в журнал, а в новому записі з панелі персональна послуга стоїть першою.
  await page.goto(`${PANEL}#/clients`);
  await page.getByRole('button', { name: 'Новий запис' }).first().click();
  await page.locator('#nb-form').getByLabel('Телефон клієнта').fill('0671112233');
  await page.locator('#nb-form').getByLabel('Телефон клієнта').dispatchEvent('change');
  await expect(page.locator('#nb-form .svc-pick .item').first()).toContainText('Для клієнта');
  await expect(page.locator('#nb-form .svc-pick .item').first()).toContainText('700 ₴');
});

test('імпорт клієнтів, прайсу й записів з CSV іншої CRM', async ({ page }) => {
  await page.goto(`${PANEL}#/import`);
  await selectPlace(page, 'Шиномонтаж «Колесо»');

  // Клієнти: роздільник «;», назви стовпців російською, той самий телефон двічі.
  await page.getByLabel('Або вставте рядки з таблиці (разом із заголовками)').fill(
    'ФИО;Телефон;Автомобиль;Госномер;Комментарий\n"Петро Імпорт";+38 (050) 123-45-67;Mazda CX-5;ka1234ai;"Любить каву; без цукру"\nОксана Імпорт;0991234567;;;\nПетро І.;380501234567;Mazda CX-5;KA1234AI;\n;;;;');
  await page.getByRole('button', { name: 'Розібрати' }).click();
  await expect(page.locator('[data-map="name"]')).toHaveValue('0');
  await expect(page.locator('[data-map="plate"]')).toHaveValue('3');
  await expect(page.getByRole('region', { name: 'Попередній перегляд імпорту' })).toContainText('Любить каву; без цукру');
  await page.getByRole('button', { name: /Імпортувати 3 рядки/ }).click();
  await expect(page.locator('#toast')).toHaveText('Імпорт завершено: додано 2, оновлено 1, пропущено 0');

  // Прайс: кома як роздільник, ціни з «грн».
  await page.getByRole('button', { name: 'Послуги й ціни' }).click();
  await page.getByLabel('Або вставте рядки з таблиці (разом із заголовками)').fill(
    'Услуга,Цена легковой,Цена кроссовер,Длительность\nСезонне перевзування (4 колеса),950 грн,1100 грн,50\nПравка дисків,600,700,60');
  await page.getByRole('button', { name: 'Розібрати' }).click();
  await page.getByRole('button', { name: /Імпортувати 2 рядки/ }).click();
  await expect(page.locator('#toast')).toHaveText('Імпорт завершено: додано 1, оновлено 1, пропущено 0');

  // Записи: дата й час в одній клітинці, статуси й оплата словами.
  await page.getByRole('button', { name: 'Записи й історія' }).click();
  await page.getByLabel('Або вставте рядки з таблиці (разом із заголовками)').fill(
    'Дата и время\tКлиент\tТелефон\tУслуги\tСумма\tОплата\tСтатус\n20.09.2026 11:00\tПетро Імпорт\t0501234567\tПравка дисків\t600\tналичные\tВыполнен\n21.09.2026 12:00\tОксана Імпорт\t0991234567\tПравка дисків\t600\t\tОтменен\n05.10.2026 09:00\tОксана Імпорт\t0991234567\tПравка дисків\t600\t\tОжидает\nдата?\t\t\t\t\t\t');
  await page.getByRole('button', { name: 'Розібрати' }).click();
  await page.getByRole('button', { name: /Імпортувати 4 рядки/ }).click();
  await expect(page.locator('#toast')).toHaveText('Імпорт завершено: додано 3, оновлено 0, пропущено 1');

  await page.locator('#nav').getByRole('link', { name: 'Клієнти' }).click();
  const petro = page.locator('#client-rows tr', { hasText: 'Петро Імпорт' });
  await expect(petro).toContainText('Mazda CX-5 · KA1234AI');
  await expect(petro).toContainText('600 ₴');
  await expect(page.locator('#client-rows tr', { hasText: 'Оксана Імпорт' })).toContainText('Записаний');

  // Імпортований майбутній запис займає бокс у застосунку клієнта, а нова послуга є в прайсі.
  await page.goto(`${PANEL}#/schedule/2026-10-05`);
  await expect(page.locator('.slot-block', { hasText: 'Оксана Імпорт' })).toContainText('09:00–10:00');
  await page.goto('/#/place/koleso');
  await expect(page.locator('.item', { hasText: 'Сезонне перевзування' })).toContainText('950 ₴');
  await expect(page.locator('.item', { hasText: 'Правка дисків' })).toContainText('600 ₴');

  // Повторний імпорт тих самих записів не створює дублів.
  await page.goto(`${PANEL}#/import`);
  await page.getByRole('button', { name: 'Записи й історія' }).click();
  await page.getByLabel('Або вставте рядки з таблиці (разом із заголовками)').fill(
    'Дата\tЧас\tКлієнт\tТелефон\tПослуги\n05.10.2026\t09:00\tОксана Імпорт\t0991234567\tПравка дисків');
  await page.getByRole('button', { name: 'Розібрати' }).click();
  await page.getByRole('button', { name: /Імпортувати 1 рядок/ }).click();
  await expect(page.locator('#toast')).toHaveText('Імпорт завершено: додано 0, оновлено 0, пропущено 1');
});

test('витрати й звіт про прибутки: разові й щомісячні', async ({ page }) => {
  await page.goto(`${PANEL}#/expenses`);
  await selectPlace(page, 'Шиномонтаж «Колесо»');
  await page.getByRole('button', { name: 'Додати витрату' }).first().click();
  const drawer = page.getByRole('dialog');
  await drawer.getByLabel('Сума, ₴').fill('10000');
  await drawer.getByLabel('Дата').fill('2026-07-10');
  await drawer.getByLabel('Категорія').selectOption('Оренда');
  await drawer.getByLabel('Рахунок').check();
  await drawer.getByLabel('Повторювати щомісяця').check();
  await drawer.getByRole('button', { name: 'Додати витрату' }).click();
  await expect(page.locator('#toast')).toHaveText('Щомісячну витрату додано');

  await page.getByRole('button', { name: 'Додати витрату' }).first().click();
  await drawer.getByLabel('Сума, ₴').fill('1500');
  await drawer.getByLabel('Категорія').selectOption('Хімія й витратні матеріали');
  await drawer.getByLabel('Нотатка').fill('Шиномонтажна паста');
  await drawer.getByRole('button', { name: 'Додати витрату' }).click();

  // За 90 днів (7 липня — 4 жовтня): оренда за липень, серпень, вересень + разова витрата.
  await page.getByRole('button', { name: '90 днів' }).click();
  await expect(page.locator('.kpi.hero .value')).toHaveText('31 500 ₴');
  await expect(page.getByRole('region', { name: 'Витрати', exact: true }).locator('tbody tr')).toHaveCount(4);
  await expect(page.getByRole('region', { name: 'Витрати', exact: true }).locator('tbody tr', { hasText: 'щомісяця' })).toHaveCount(3);

  // Виконаний запис з оплатою на місці — дохід.
  await page.goto(`${PANEL}#/schedule`);
  await addCrmBooking(page, { name: 'Дохід Тест', phone: '+380 50 000 00 09', service: /Сезонне перевзування/, date: '2026-10-04', time: '11:00' });
  await page.locator('.slot-block', { hasText: 'Дохід Тест' }).click();
  await page.getByRole('dialog').getByLabel('Готівка').check();
  await page.getByRole('dialog').getByRole('button', { name: 'Виконано й оплачено' }).click();

  await page.locator('#nav').getByRole('link', { name: 'Фінанси' }).click();
  await page.getByRole('button', { name: '90 днів' }).click();
  const report = page.locator('table.pnl');
  await expect(report.locator('tr', { hasText: 'Разом доходи' })).toContainText('900 ₴');
  await expect(report.locator('tr', { hasText: 'На місці: готівка' })).toContainText('900 ₴');
  await expect(report.locator('tr', { hasText: 'Оренда' })).toContainText('30 000 ₴');
  await expect(report.locator('tr', { hasText: 'Разом витрати' })).toContainText('31 500 ₴');
  await expect(report.locator('tfoot tr', { hasText: 'Прибуток' })).toContainText('−30 600 ₴');
  await expect(page.locator('#ch-pnl .hit')).toHaveCount(13);
  await expect(page.getByRole('region', { name: 'Рух грошей' })).toContainText('надійшло 900 ₴');

  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Експорт звіту' }).click();
  expect((await download).suggestedFilename()).toMatch(/^carcar-pnl-koleso-/);

  // Зупинка щомісячного платежу: майбутні місяці не нараховуються.
  await page.goto(`${PANEL}#/expenses`);
  page.once('dialog', (d) => d.accept());
  await page.getByRole('button', { name: 'Зупинити' }).click();
  await expect(page.locator('#toast')).toHaveText('Щомісячний платіж зупинено');
});

test('нагадування клієнту підтвердити виконання', async ({ page }) => {
  await page.goto('/#/book/koleso');
  await page.getByLabel(/Сезонне перевзування/).check();
  await page.getByRole('button', { name: /Завтра/ }).click();
  await page.locator('.slot:not([disabled])').first().click();
  await page.locator('[data-action="confirm"]').click();
  await page.getByRole('button', { name: 'Оплатити 900 ₴' }).click();

  await page.clock.setFixedTime(new Date(2026, 9, 5, 21, 30));
  await page.goto(`${PANEL}#/schedule/2026-10-05`);
  await selectPlace(page, 'Шиномонтаж «Колесо»');
  await page.locator('.slot-block').first().click();
  const drawer = page.getByRole('dialog');
  await expect(drawer.locator('.notice.warn')).toContainText('Час візиту минув');
  await drawer.getByRole('button', { name: 'Машина готова' }).click();
  await page.locator('.slot-block').first().click();
  await drawer.getByRole('button', { name: 'Нагадати клієнту' }).click();
  await expect(page.locator('#toast')).toHaveText('Клієнт отримав нагадування підтвердити виконання');
  await expect(drawer).toContainText('Останнє нагадування');

  await page.goto('/#/bookings');
  await expect(page.getByText(/Точка нагадала/)).toBeVisible();
  await page.getByRole('button', { name: 'Усе добре' }).click();
  await page.goto(`${PANEL}#/finance`);
  await expect(page.locator('tbody tr', { hasText: 'Сезонне перевзування' })).toContainText('Заморожено');
});

test('клієнт не знайшов послугу: пише точці, точка відповідає й додає послугу', async ({ page }) => {
  await page.goto('/#/book/koleso');
  await page.getByRole('link', { name: 'Не знайшли потрібну послугу? Напишіть точці' }).click();
  await expect(page).toHaveURL(/#\/place\/koleso\/ask/);
  const ask = page.locator('#askform');
  await ask.getByLabel('Що потрібно зробити?').fill('Чи можете відрихтувати диск R17?');
  await ask.getByLabel('Ваше імʼя').fill('Андрій Запит');
  await ask.getByLabel('Ваш телефон').fill('063 555 44 33');
  await ask.getByRole('button', { name: 'Надіслати точці' }).click();
  await expect(page.locator('#toast')).toHaveText('Повідомлення надіслано точці');
  await expect(page.locator('.req')).toContainText('Чекає відповіді точки');

  // Точка бачить запит у панелі з лічильником і відповідає.
  await page.goto(PANEL);
  await selectPlace(page, 'Шиномонтаж «Колесо»');
  await expect(page.locator('#nav').getByRole('link', { name: /Запити клієнтів/ })).toContainText('1');
  await page.locator('#nav').getByRole('link', { name: /Запити клієнтів/ }).click();
  const req = page.locator('article.req', { hasText: 'Андрій Запит' });
  await expect(req).toContainText('Чи можете відрихтувати диск R17?');
  await expect(req).toContainText('Новий');
  await req.getByLabel('Відповідь клієнту').fill('Так, робимо, близько години');
  await req.getByRole('button', { name: 'Відповісти' }).click();
  await expect(req).toContainText('Відповіли');

  // Додає персональну послугу саме для цього клієнта.
  await req.getByRole('button', { name: 'Додати послугу' }).click();
  const drawer = page.getByRole('dialog');
  await drawer.getByLabel('Назва послуги').fill('Рихтування литого диска R17');
  await drawer.getByLabel('Ціна, ₴').fill('650');
  await drawer.getByLabel('Тривалість, хв').fill('60');
  await drawer.getByLabel('Лише для цього клієнта').check();
  await drawer.getByRole('button', { name: 'Додати й повідомити клієнта' }).click();
  await expect(page.locator('#toast')).toHaveText('Персональну послугу додано — клієнт отримав відповідь');
  await expect(page.locator('article.req')).toHaveCount(0);
  await page.getByRole('button', { name: /Усі · 1/ }).click();
  await expect(page.locator('article.req')).toContainText('Послугу додано');

  // Клієнт бачить відповідь у «Мої записи» й персональну послугу на сторінці точки.
  await page.goto('/#/bookings');
  await expect(page.locator('.tabs a[data-tab="bookings"]')).toHaveAttribute('data-badge', '');
  await page.getByRole('link', { name: /Шиномонтаж «Колесо».*Послугу додано/ }).click();
  await expect(page.locator('.req .thread')).toContainText('Так, робимо, близько години');
  await expect(page.locator('.req')).toContainText('Рихтування литого диска R17 — 650 ₴');
  await expect(page.locator('.personal-list')).toContainText('Рихтування литого диска R17');
  await page.locator('.req').getByRole('link', { name: 'Записатися' }).click();
  await expect(page.getByLabel(/Рихтування литого диска R17/)).toBeVisible();

  // Послуга для всіх потрапляє в загальний прайс.
  await page.goto('/#/place/blysk');
  await page.locator('#askform').getByLabel('Що потрібно зробити?').fill('Мийка даху автобудинку');
  await page.locator('#askform').getByRole('button', { name: 'Надіслати точці' }).click();
  await page.goto(`${PANEL}#/requests`);
  await selectPlace(page, 'Автомийка «Блиск»');
  await page.getByRole('button', { name: 'Додати послугу' }).click();
  await drawer.getByLabel('Назва послуги').fill('Мийка автобудинку');
  await drawer.getByLabel('Ціна, ₴').fill('1500');
  await drawer.getByRole('button', { name: 'Додати й повідомити клієнта' }).click();
  await page.goto('/#/place/blysk');
  await expect(page.locator('.item', { hasText: 'Мийка автобудинку' })).toContainText('1 500 ₴');
});
