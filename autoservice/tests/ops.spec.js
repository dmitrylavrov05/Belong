import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

// Неділя, 4 жовтня 2026, 10:00 — як і в інших тестах. Жовтень — сезон переходу на зимові шини.
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

const PANEL = '/business.html';
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');

async function panel(page, hash, place = 'Автомийка «Хвиля»') {
  await page.goto(`${PANEL}${hash}`);
  await page.getByLabel('Точка').selectOption({ label: place });
}

async function crmBooking(page, { name, phone, service = /Комплекс преміум/, date = '2026-10-04', time, master }) {
  await page.locator('#new-booking').click();
  const form = page.locator('#nb-form');
  await form.getByLabel('Імʼя клієнта').fill(name);
  await form.getByLabel('Телефон клієнта').fill(phone);
  await form.getByLabel(service).check();
  await form.getByLabel('Дата').fill(date);
  await form.getByLabel('Дата').dispatchEvent('change');
  if (time) await form.getByLabel('Час').selectOption(time);
  if (master) await form.getByLabel('Майстер').selectOption({ label: master });
  await form.getByRole('button', { name: 'Записати' }).click();
  await expect(page.locator('#toast')).toContainText(`Записано: ${name}`);
}

async function completeCash(page, name) {
  await page.locator('.slot-block', { hasText: name }).click();
  const d = page.getByRole('dialog');
  await d.getByLabel('Готівка').check();
  await d.getByRole('button', { name: 'Виконано й оплачено' }).click();
  await expect(page.locator('#toast')).toHaveText('Запис виконано й оплачено');
}

async function setProfilePhone(page, phone, optIn = false) {
  await page.goto('/#/garage');
  const f = page.locator('#profileform');
  await f.getByLabel('Імʼя').fill('Тест Клієнт');
  await f.getByLabel('Телефон').fill(phone);
  if (optIn) await f.getByLabel(/Отримувати пропозиції/).check();
  await f.getByRole('button', { name: 'Зберегти профіль' }).click();
}

test('персонал і ролі: майстер на записі, зарплата відсотком іде у витрати, майстер бачить лише своє', async ({ page }) => {
  await panel(page, '#/staff');
  await page.getByRole('button', { name: 'Додати співробітника' }).click();
  const d = page.getByRole('dialog');
  await d.getByLabel('Імʼя').fill('Майстер Тест');
  await d.getByLabel('Роль').selectOption('master');
  await d.getByLabel('Відсоток від робіт, %').fill('40');
  await d.getByRole('button', { name: 'Додати' }).click();
  await expect(page.locator('#toast')).toHaveText('Додано: Майстер Тест');
  await expect(page.getByRole('region', { name: 'Співробітники' })).toContainText('Власник');

  await page.goto(`${PANEL}#/schedule`);
  await crmBooking(page, { name: 'Зарплата Тест', phone: '+380 50 000 00 11', time: '11:00', master: 'Майстер Тест' });
  await expect(page.locator('.slot-block', { hasText: 'Зарплата Тест' })).toContainText('Майстер Тест');
  await completeCash(page, 'Зарплата Тест');

  // 40% від 900 ₴ — 360 ₴ зарплати, автоматично у витратах.
  await page.locator('#nav').getByRole('link', { name: 'Витрати' }).click();
  const row = page.getByRole('region', { name: 'Витрати', exact: true }).locator('tr', { hasText: 'Майстер Тест' });
  await expect(row).toContainText('360 ₴');
  await expect(row).toContainText('авто');
  await page.locator('#nav').getByRole('link', { name: 'Персонал' }).click();
  await expect(page.getByRole('region', { name: 'Нарахування майстрам' })).toContainText('360 ₴');

  // Майстер не бачить фінансів, але бачить свій заробіток.
  await page.getByRole('combobox', { name: 'Ви', exact: true }).selectOption({ label: 'Майстер Тест · Майстер' });
  await expect(page).toHaveURL(/#\/schedule/);
  await expect(page.locator('#nav')).not.toContainText('Фінанси');
  await expect(page.locator('#new-booking')).toBeHidden();
  await page.locator('#nav').getByRole('link', { name: 'Мій заробіток' }).click();
  await expect(page.locator('.kpi.hero .value')).toHaveText('360 ₴');
  await page.goto(`${PANEL}#/finance`);
  await expect(page.getByRole('heading', { name: 'Немає доступу' })).toBeVisible();
});

test('склад: списання за нормами, нагадування про закупівлю, прихід іде у витрати', async ({ page }) => {
  await panel(page, '#/stock');
  await page.getByRole('button', { name: 'Нова позиція' }).click();
  let d = page.getByRole('dialog');
  await d.getByLabel('Назва').fill('Монтажна паста');
  await d.getByLabel('Одиниця').selectOption('кг');
  await d.getByLabel('Зараз на складі').fill('1');
  await d.getByLabel('Мінімальний залишок').fill('0.5');
  await d.getByLabel('Ціна за одиницю, ₴').fill('350');
  await d.getByLabel('Категорія витрат').selectOption('Запчастини');
  await d.getByRole('button', { name: 'Додати позицію' }).click();

  await page.getByRole('button', { name: 'Норми: Комплекс преміум: кузов, салон, віск' }).click();
  await page.getByRole('dialog').getByLabel('Монтажна паста, кг').fill('0.3');
  await page.getByRole('button', { name: 'Зберегти норми' }).click();
  await expect(page.getByRole('region', { name: 'Норми списання' })).toContainText('Монтажна паста 0,3 кг');

  await page.goto(`${PANEL}#/schedule`);
  await crmBooking(page, { name: 'Склад Один', phone: '+380 50 000 00 21', time: '11:00' });
  await completeCash(page, 'Склад Один');
  await crmBooking(page, { name: 'Склад Два', phone: '+380 50 000 00 22', time: '13:00' });
  await completeCash(page, 'Склад Два');

  await expect(page.locator('#nav').getByRole('link', { name: /Склад/ })).toContainText('1');
  await page.locator('#nav').getByRole('link', { name: /Склад/ }).click();
  const row = page.getByRole('region', { name: 'Залишки' }).locator('tr', { hasText: 'Монтажна паста' });
  await expect(row).toContainText('0,4 кг');
  await expect(row).toContainText('Закінчується');
  await expect(page.locator('.notice.warn')).toContainText('Час закупити');

  await page.getByRole('button', { name: 'Прихід' }).click();
  d = page.getByRole('dialog');
  await d.getByLabel('Кількість').fill('2');
  await d.getByLabel('Сума закупівлі, ₴').fill('700');
  await d.getByRole('button', { name: 'Оприбуткувати' }).click();
  await expect(page.locator('#toast')).toContainText('700 ₴ у витратах');
  await expect(row).toContainText('2,4 кг');
  await expect(row).toContainText('Достатньо');
  await page.locator('#nav').getByRole('link', { name: 'Витрати' }).click();
  await expect(page.getByRole('region', { name: 'Витрати', exact: true }).locator('tr', { hasText: 'Монтажна паста' })).toContainText('700 ₴');
});

test('абонемент і сертифікат: продаж, списання під час запису, повернення при скасуванні', async ({ page }) => {
  await panel(page, '#/passes', 'Автомийка «Блиск»');
  await page.getByRole('button', { name: 'Новий абонемент чи сертифікат' }).click();
  let d = page.getByRole('dialog');
  await d.getByLabel('Назва').fill('4 експрес-мийки');
  await d.getByLabel('Ціна, ₴').fill('800');
  await d.getByLabel('Візитів (для абонемента)').fill('4');
  await d.getByLabel('Експрес-мийка кузова').check();
  await d.getByRole('button', { name: 'Створити' }).click();
  await page.getByRole('button', { name: 'Новий абонемент чи сертифікат' }).click();
  d = page.getByRole('dialog');
  await d.getByLabel('Подарунковий сертифікат').check();
  await d.getByLabel('Назва').fill('Сертифікат 1000 ₴');
  await d.getByLabel('Ціна, ₴').fill('1000');
  await d.getByLabel('Діє, днів').fill('365');
  await d.getByRole('button', { name: 'Створити' }).click();

  // Сертифікат продають на місці; код — у сповіщенні.
  await page.getByRole('button', { name: 'Продати на місці' }).click();
  d = page.getByRole('dialog');
  await d.getByLabel('Що продаємо').selectOption({ index: 1 });
  await d.getByLabel('Імʼя покупця').fill('Подарунок Тест');
  await d.getByLabel('Телефон покупця').fill('0501112233');
  await d.getByRole('button', { name: 'Продати' }).click();
  const code = (await page.locator('#toast').textContent()).match(/CC-\w{4}-\w{4}/)[0];

  // Клієнт купує абонемент у застосунку й записується за ним без доплати.
  await setProfilePhone(page, '+380679998877');
  await page.goto('/#/place/blysk');
  page.once('dialog', (x) => x.accept());
  await page.getByRole('button', { name: 'Купити: 4 експрес-мийки за 800 ₴' }).click();
  await expect(page.locator('#toast')).toHaveText('Абонемент куплено — спишеться під час запису');
  await page.goto('/#/book/blysk');
  await page.getByLabel(/Експрес-мийка кузова/).check();
  await page.getByRole('button', { name: /Завтра/ }).click();
  await page.locator('.slot:not([disabled])').first().click();
  await page.locator('[data-action="confirm"]').click();
  await expect(page.getByLabel(/4 експрес-мийки/)).toBeChecked();
  await page.getByRole('button', { name: 'Записатися', exact: true }).click();
  await page.goto('/#/garage');
  await expect(page.getByRole('region', { name: '4 експрес-мийки' })).toContainText('Лишилось 3 з 4');

  // Скасування вчасно повертає візит.
  await page.goto('/#/bookings');
  page.once('dialog', (x) => x.accept());
  await page.getByRole('button', { name: 'Скасувати', exact: true }).click();
  await page.goto('/#/garage');
  await expect(page.getByRole('region', { name: '4 експрес-мийки' })).toContainText('Лишилось 4 з 4');

  // Сертифікатом оплачують комплекс: 550 ₴ із 1000.
  await page.goto('/#/book/blysk');
  await page.getByLabel(/Комплекс: кузов \+ салон/).check();
  await page.getByRole('button', { name: /Завтра/ }).click();
  await page.locator('.slot:not([disabled])').first().click();
  await page.locator('[data-action="confirm"]').click();
  await page.getByLabel('Код подарункового сертифіката').fill(code);
  await page.locator('.cert-line').getByRole('button', { name: 'Застосувати' }).click();
  await expect(page.locator('#toast')).toContainText('Сертифікат застосовано');
  await page.getByRole('button', { name: 'Записатися', exact: true }).click();
  await panel(page, '#/passes', 'Автомийка «Блиск»');
  const sold = page.getByRole('region', { name: 'Продані абонементи й сертифікати' });
  await expect(sold.locator('tr', { hasText: code })).toContainText('450 ₴');
  await expect(sold.locator('tr', { hasText: '4 експрес-мийки' })).toContainText('CARCAR');
});

test('розсилка VIP-клієнтам у Viber доходить клієнту з цим телефоном', async ({ page }) => {
  await panel(page, '#/clients', 'Автомийка «Блиск»');
  await page.getByRole('button', { name: 'Новий клієнт' }).click();
  const d = page.getByRole('dialog');
  await d.getByLabel('Імʼя клієнта').fill('Віра Розсилка');
  await d.getByLabel('Телефон клієнта').fill('0662223344');
  await d.getByLabel(/Згода на розсилки/).check();
  await d.getByRole('button', { name: 'Додати клієнта' }).click();
  await page.getByRole('button', { name: 'VIP' }).click();

  await page.locator('#nav').getByRole('link', { name: 'Розсилки' }).click();
  await page.getByLabel('Кому').selectOption('vip');
  await page.getByLabel('Текст').fill('{імʼя}, для VIP — безкоштовний віск до кінця тижня!');
  await expect(page.locator('#mail-count')).toContainText('Отримають: 1');
  await page.getByRole('button', { name: 'Надіслати 1 клієнту' }).click();
  await expect(page.locator('#toast')).toHaveText('Розсилку надіслано: 1 клієнт у Viber');
  await expect(page.getByRole('region', { name: 'Надіслані' })).toContainText('VIP · Viber');

  await setProfilePhone(page, '+380 66 222 33 44');
  await page.goto('/#/inbox');
  await expect(page.locator('.msg-card')).toContainText('Віра, для VIP — безкоштовний віск');
  await expect(page.locator('.msg-card')).toContainText('Viber');
});

test('гаряче вікно −20%: клієнт бачить пропозицію на головній і платить зі знижкою', async ({ page }) => {
  await panel(page, '#/deals');
  const f = page.locator('#deal-form');
  await f.getByLabel('День').selectOption('2026-10-05');
  await f.getByLabel('Початок вікна').selectOption('14:00');
  await f.getByLabel('Кінець вікна').selectOption('17:00');
  await f.getByRole('button', { name: 'Запустити' }).click();
  await expect(page.locator('#toast')).toHaveText('Гаряче вікно −20% запущено');

  await page.goto('/');
  const hot = page.locator('.hot-card', { hasText: 'Автомийка «Хвиля»' });
  await expect(hot).toContainText('−20%');
  await expect(hot).toContainText('Завтра · 14:00–17:00');
  await hot.click();
  await expect(page).toHaveURL(/#\/book\/hvylia\/2026-10-05\/14:00/);
  await page.getByLabel(/Комплекс преміум/).check();
  await expect(page.locator('.slot[data-time="14:00"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('.slot[data-time="15:00"]')).toContainText('−20%');
  await expect(page.locator('.slot[data-time="10:00"]')).not.toContainText('−20%');
  await expect(page.locator('.dock')).toContainText('720 ₴');
  await page.locator('[data-action="confirm"]').click();
  await page.getByRole('button', { name: 'Оплатити 720 ₴' }).click();
  await expect(page.locator('article').first()).toContainText('720 ₴');
});

test('світло: точка відмічає генератор чи відсутність світла, клієнт бачить і фільтрує', async ({ page }) => {
  await panel(page, '#/');
  await page.getByLabel('Світло').selectOption('closed');
  await expect(page.locator('#toast')).toHaveText('Клієнти бачать: Немає світла — не працюємо');
  await page.getByLabel('Точка').selectOption({ label: 'Аква 24' });
  await page.getByLabel('Світло').selectOption('generator');

  await page.goto('/');
  await expect(page.locator('article', { hasText: 'Аква 24' }).locator('.badge.power')).toContainText('Працює від генератора · 10:00');
  const hvylia = page.locator('article', { hasText: 'Автомийка «Хвиля»' });
  await expect(hvylia.locator('.badge.power')).toContainText('Немає світла — не працює');
  await expect(hvylia).toContainText('Зачинено');
  await page.getByRole('button', { name: 'Працює при відключеннях' }).click();
  await expect(page.locator('#list')).toContainText('Аква 24');
  await expect(page.locator('#list')).not.toContainText('Автомийка «Хвиля»');

  // Через 12 годин позначка застаріває.
  await page.clock.setFixedTime(new Date(2026, 9, 4, 23, 0));
  await page.goto('/');
  await expect(page.locator('.badge.power')).toHaveCount(0);
});

test('жива черга: клієнт бачить авто попереду, стає в чергу, точка бачить і веде її', async ({ page }) => {
  await panel(page, '#/queue', 'Автомийка «Блиск»');
  await page.getByLabel('Держномер чи авто').fill('KA0001AA');
  await page.getByRole('button', { name: 'Додати в чергу' }).click();
  await expect(page.locator('#toast')).toHaveText('Авто додано в чергу');

  await page.goto('/#/place/blysk');
  await page.locator('.queue-fold summary').click();
  const q = page.getByRole('region', { name: 'Жива черга зараз' });
  await expect(q).toContainText('Авто попереду1');
  await q.getByRole('button', { name: 'Стати в чергу' }).click();
  await expect(q).toContainText('Ви в черзі: 2-й');

  await panel(page, '#/queue', 'Автомийка «Блиск»');
  await expect(page.getByRole('region', { name: 'Чекають' })).toContainText('з застосунку');
  await page.getByRole('button', { name: 'У бокс: KA0001AA' }).click();
  await expect(page.getByRole('region', { name: 'У боксах' })).toContainText('KA0001AA');

  await page.goto('/#/place/blysk');
  await expect(q).toContainText('Ви в черзі: 1-й');
  await q.getByRole('button', { name: 'Вийти з черги' }).click();
  await expect(page.locator('.queue-fold summary')).toContainText('0 авто попереду');
});

test('акт приймання з фото: точка фіксує стан, клієнт підтверджує', async ({ page }) => {
  await page.goto('/#/book/hvylia');
  await page.getByLabel(/Комплекс преміум/).check();
  await page.getByRole('button', { name: /Завтра/ }).click();
  await page.locator('.slot:not([disabled])').first().click();
  await page.locator('[data-action="confirm"]').click();
  await page.getByRole('button', { name: 'Оплатити 900 ₴' }).click();

  await panel(page, '#/schedule/2026-10-05');
  await page.locator('.slot-block').first().click();
  await page.getByRole('dialog').getByRole('button', { name: 'Акт приймання авто' }).click();
  const d = page.getByRole('dialog');
  await d.locator('input[name="photos"]').setInputFiles([{ name: 'front.png', mimeType: 'image/png', buffer: PNG }]);
  await d.getByLabel('Подряпини').check();
  await d.getByLabel('Пробіг, км').fill('84200');
  await d.getByRole('button', { name: 'Зберегти акт' }).click();
  await expect(page.locator('#toast')).toHaveText('Акт збережено — клієнт отримав його в застосунку');
  await expect(page.getByRole('region', { name: 'Акт приймання' })).toContainText('Подряпини');
  await expect(page.getByRole('region', { name: 'Акт приймання' }).locator('img')).toHaveCount(1);

  await page.goto('/#/bookings');
  const act = page.locator('.intake-card');
  await expect(act).toContainText('Точка зафіксувала: Подряпини');
  await act.getByRole('button', { name: 'Усе вірно' }).click();
  await expect(page.locator('#toast')).toHaveText('Акт приймання підтверджено');

  await panel(page, '#/schedule/2026-10-05');
  await page.locator('.slot-block').first().click();
  await expect(page.getByRole('region', { name: 'Акт приймання' })).toContainText('Клієнт підтвердив');
});

test('лист очікування: час звільнився — клієнту приходить сповіщення й можна записатися', async ({ page }) => {
  await panel(page, '#/settings');
  await page.getByLabel('Кількість боксів').fill('1');
  await page.getByRole('button', { name: 'Зберегти', exact: true }).click();
  await page.goto(`${PANEL}#/schedule`);
  await crmBooking(page, { name: 'Займає Бокс', phone: '+380 50 000 00 31', date: '2026-10-05', time: '10:00' });

  await setProfilePhone(page, '+380675556677');
  await page.goto('/#/book/hvylia');
  await page.getByLabel(/Комплекс преміум/).check();
  await page.getByRole('button', { name: /Завтра/ }).click();
  await expect(page.locator('.slot[data-time="10:00"]')).toBeDisabled();
  await page.getByRole('button', { name: 'Немає зручного часу? Повідомимо, якщо звільниться' }).click();
  const w = page.locator('#wait-form');
  await w.getByLabel('Зручно з').selectOption('10:00');
  await w.getByLabel('До').selectOption('11:00');
  await w.getByRole('button', { name: 'Повідомити, коли звільниться' }).click();
  await expect(page.locator('#toast')).toHaveText('Готово! Повідомимо, щойно звільниться час');
  await expect(page.locator('#book')).toContainText('Ви в листі очікування');

  await page.goto(`${PANEL}#/schedule/2026-10-05`);
  await expect(page.getByRole('region', { name: 'Лист очікування на цей день' })).toContainText('Тест Клієнт · 10:00–11:00');
  await page.locator('.slot-block', { hasText: 'Займає Бокс' }).click();
  page.once('dialog', (x) => x.accept());
  await page.getByRole('dialog').getByRole('button', { name: 'Скасувати запис' }).click();

  await page.goto('/#/inbox');
  await expect(page.locator('.msg-card')).toContainText('Автомийка «Хвиля»: звільнився час 5 жовтня о 10:00');
  await page.getByRole('link', { name: 'Записатися' }).click();
  await page.getByLabel(/Комплекс преміум/).check();
  await expect(page.locator('.slot[data-time="10:00"]')).toHaveAttribute('aria-pressed', 'true');
});

for (const path of [`${PANEL}#/staff`, `${PANEL}#/stock`, `${PANEL}#/passes`, `${PANEL}#/mailings`, `${PANEL}#/deals`, `${PANEL}#/queue`, '/#/inbox', '/#/garage', '/#/place/blysk']) {
  test(`доступність і верстка з демо-даними ${path}`, async ({ page }) => {
    await panel(page, '#/', 'Автомийка «Блиск»');
    await page.getByRole('button', { name: 'Заповнити демо-історію' }).click();
    await expect(page.locator('#toast')).toContainText('демо-записів');
    await page.getByLabel('Точка').selectOption({ label: 'Автомийка «Хвиля»' });
    await page.getByRole('button', { name: 'Заповнити демо-історію' }).click();
    await expect(page.locator('#toast')).toContainText('демо-записів');
    await page.goto(path);
    await page.locator('#view h1').first().waitFor();
    const { violations } = await new AxeBuilder({ page }).analyze();
    expect(violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target).join(', ')}`)).toEqual([]);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow).toBeLessThanOrEqual(0);
  });
}
