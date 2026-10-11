import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { PRO, proWash } from './helpers.js';

// Неділя, 4 жовтня 2026, 10:00 — як і в інших тестах. Жовтень — сезон переходу на зимові шини.
test.beforeEach(async ({ page }, testInfo) => {
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
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  page.on('requestfailed', (r) => errors.push(`failed: ${r.url()}`));
  page.errors = errors;
});

test.afterEach(async ({ page }) => {
  expect(page.errors).toEqual([]);
});

async function setProfilePhone(page, phone, optIn = false) {
  await page.goto('/#/garage');
  const f = page.locator('#profileform');
  await f.getByLabel('Імʼя').fill('Тест Клієнт');
  await f.getByLabel('Телефон').fill(phone);
  if (optIn) await f.getByLabel(/Отримувати пропозиції/).check();
  await f.getByRole('button', { name: 'Зберегти профіль' }).click();
}

// Знижки мийки — у сховищі CarCar Business (carcar.biz.deals).
async function seedDeals(page, placeId, deals) {
  await page.evaluate(([id, list]) => {
    const all = JSON.parse(localStorage.getItem('carcar.biz.deals') ?? '{}');
    localStorage.setItem('carcar.biz.deals', JSON.stringify({ ...all, [id]: [...(all[id] ?? []), ...list] }));
  }, [placeId, deals]);
}

// Світло на мийці — у профілі CarCar Business.
async function setPower(page, wash, label) {
  await proWash(page, wash);
  await page.goto(`${PRO}#/profile`);
  await page.getByRole('group', { name: 'Світло на мийці' }).getByRole('button', { name: label, exact: true }).click();
  await expect(page.locator('#toast')).toHaveText('Клієнти бачать оновлений статус');
}

test('гаряче вікно −20%: клієнт бачить пропозицію на головній і платить зі знижкою', async ({ page }) => {
  await page.goto('/');
  await seedDeals(page, 'hvylia', [{ id: 'hot-test', active: true, date: '2026-10-05', from: 14 * 60, to: 17 * 60, pct: 20 }]);

  await page.goto('/');
  const hot = page.locator('.hot-card', { hasText: 'Автомийка «Хвиля»' });
  await expect(hot).toContainText('−20%');
  await expect(hot).toContainText('Завтра · 14:00–17:00');
  await hot.click();
  await expect(page).toHaveURL(/#\/book\/hvylia\/2026-10-05\/14:00/);
  await page.getByLabel(/Комплекс преміум/).check();
  await page.locator('[data-action="to-time"]').click();
  await expect(page.locator('.slot[data-time="14:00"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('.slot[data-time="15:00"]')).toContainText('−20%');
  await expect(page.locator('.slot[data-time="10:00"]')).not.toContainText('−20%');
  await expect(page.locator('.dock')).toContainText('720 ₴');
  await page.locator('[data-action="confirm"]').click();
  await page.getByRole('button', { name: 'Оплатити 720 ₴' }).click();
  await expect(page.locator('article').first()).toContainText('720 ₴');
});

test('світло: точка відмічає генератор чи відсутність світла, клієнт бачить і фільтрує', async ({ page }) => {
  await setPower(page, 'Автомийка «Хвиля»', 'Немає світла — не працюємо');
  await setPower(page, 'Аква 24', 'Немає світла — працюємо від генератора');

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

test('лист очікування: час звільнився — клієнту приходить сповіщення й можна записатися', async ({ page }) => {
  // Мийка має один бокс і записує клієнта по телефону на завтра, 10:00.
  await proWash(page, 'Автомийка «Хвиля»');
  await page.goto(`${PRO}#/profile`);
  const main = page.locator('#pf-main');
  await main.getByLabel('Боксів').fill('1');
  await main.getByRole('button', { name: 'Зберегти' }).click();
  await expect(page.locator('#toast')).toHaveText('Збережено — клієнти бачать нові дані');
  await page.goto(`${PRO}#/bookings/2026-10-05`);
  await page.getByRole('button', { name: 'Новий запис' }).click();
  const nb = page.locator('#nb-form');
  await nb.getByRole('textbox', { name: 'Телефон' }).fill('+380 50 000 00 31');
  await nb.getByLabel('Імʼя').fill('Займає Бокс');
  await nb.getByRole('group', { name: 'Послуги' }).getByRole('button', { name: /Комплекс преміум/ }).click();
  await nb.getByRole('group', { name: 'День' }).getByRole('button', { name: 'Завтра' }).click();
  await nb.getByRole('group', { name: 'Вільний час' }).getByRole('button', { name: '10:00', exact: true }).click();
  await nb.getByRole('button', { name: 'Записати на 10:00' }).click();
  await expect(page.locator('#toast')).toHaveText('Записано: Займає Бокс, завтра о 10:00');

  await setProfilePhone(page, '+380675556677');
  await page.goto('/#/book/hvylia');
  await page.getByLabel(/Комплекс преміум/).check();
  await page.locator('[data-action="to-time"]').click();
  await page.getByRole('button', { name: /Завтра/ }).click();
  await expect(page.locator('.slot[data-time="10:00"]')).toBeDisabled();
  await page.getByRole('button', { name: 'Немає зручного часу? Повідомимо, якщо звільниться' }).click();
  const w = page.locator('#wait-form');
  await w.getByLabel('Зручно з').selectOption('10:00');
  await w.getByLabel('До').selectOption('11:00');
  await w.getByRole('button', { name: 'Повідомити, коли звільниться' }).click();
  await expect(page.locator('#toast')).toHaveText('Готово! Повідомимо, щойно звільниться час');
  await expect(page.locator('#book')).toContainText('Ви в листі очікування');

  // Мийка скасовує запис у CarCar Business — час звільняється.
  await page.goto(`${PRO}#/bookings/2026-10-05`);
  await page.locator('.bk-row', { hasText: 'Займає Бокс' }).click();
  page.once('dialog', (x) => x.accept());
  await page.getByRole('dialog').getByRole('button', { name: 'Скасувати запис' }).click();
  await expect(page.locator('#toast')).toHaveText('Запис скасовано, час вільний');

  await page.goto('/');
  await expect(page.locator('#inbox-tab .tab-count')).toHaveText('1');
  await page.goto('/#/inbox');
  await expect(page.locator('.wait-offer')).toContainText('Автомийка «Хвиля»: звільнився час 5 жовтня о 10:00');
  await page.getByRole('link', { name: 'Записатися' }).click();
  await page.getByLabel(/Комплекс преміум/).check();
  await page.locator('[data-action="to-time"]').click();
  await expect(page.locator('.slot[data-time="10:00"]')).toHaveAttribute('aria-pressed', 'true');
});

for (const path of ['/#/inbox', '/#/garage', '/#/wallet', '/#/place/blysk']) {
  test(`доступність і верстка з демо-даними ${path}`, async ({ page }) => {
    for (const wash of ['Автомийка «Блиск»', 'Автомийка «Хвиля»']) {
      await proWash(page, wash);
      await page.goto(`${PRO}#/more`);
      await page.getByRole('button', { name: 'Заповнити прикладом: історія, записи й повідомлення' }).click();
      await expect(page.locator('#toast')).toHaveText('Додано приклад записів і повідомлень');
      // Приклад містить запис, який чекає підтвердження, — закриваємо сповіщення про нього.
      await page.getByRole('dialog', { name: 'Новий запис' }).getByRole('button', { name: 'Закрити' }).click();
    }
    await page.goto(path);
    await page.locator('#view h1').first().waitFor();
    const { violations } = await new AxeBuilder({ page }).analyze();
    expect(violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target).join(', ')}`)).toEqual([]);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow).toBeLessThanOrEqual(0);
  });
}
