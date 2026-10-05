import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

// Неділя, 4 жовтня 2026, 10:00. Завтра — понеділок.
// Тайли OpenStreetMap у тестах не завантажуємо з мережі — підставляємо порожню картинку.
const TILE = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');

test.beforeEach(async ({ page }, testInfo) => {
  // Усі точки — мийки, тож акція «Перша мийка −30%» діяла б у кожному тесті. Вимикаємо її,
  // крім тестів промокодів і маркетингу.
  if (!/промокод|маркетинг/i.test(testInfo.title)) {
    await page.addInitScript(() => localStorage.getItem('carcar.admin.promos') ?? localStorage.setItem('carcar.admin.promos', '[]'));
  }
  await page.route('https://tile.openstreetmap.org/**', (r) => r.fulfill({ contentType: 'image/png', body: TILE }));
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

test('карта: точки на схемі Києва, фільтри, вибір точки й запис', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Карта' }).click();
  const map = page.getByRole('region', { name: /Карта точок/ });
  await expect(map).toBeVisible();
  await expect(map.locator('[data-pin]')).toHaveCount(9);
  await expect(page.locator('#count')).toHaveText('9 місць');

  // Фільтр працює й на карті.
  await page.getByRole('button', { name: 'Виїзд до вас' }).click();
  await expect(map.locator('[data-pin]')).toHaveCount(2);
  await expect(page.locator('#count')).toHaveText('2 місця');

  await map.getByRole('button', { name: /^Автомийка «Хвиля»/ }).click();
  await expect(map.getByRole('button', { name: /^Автомийка «Хвиля»/ })).toHaveAttribute('aria-pressed', 'true');
  const card = page.locator('#map-card');
  await expect(card).toContainText('Автомийка «Хвиля»');
  await expect(card).toContainText('Харківське шосе, 58');

  // Масштаб кнопками змінює положення пінів.
  const pin = map.locator('[data-pin="hvylia"]');
  const before = await pin.boundingBox();
  await map.getByRole('button', { name: 'Наблизити' }).click();
  const after = await pin.boundingBox();
  expect(Math.abs(after.x - before.x) + Math.abs(after.y - before.y)).toBeGreaterThan(5);

  // Перетягування зсуває карту.
  const box = await map.boundingBox();
  await page.mouse.move(box.x + 60, box.y + 200);
  await page.mouse.down();
  await page.mouse.move(box.x + 160, box.y + 240, { steps: 5 });
  await page.mouse.up();
  const dragged = await pin.boundingBox();
  expect(dragged.x - after.x).toBeGreaterThan(80);

  await card.getByRole('link', { name: 'Записатися' }).click();
  await expect(page).toHaveURL(/#\/book\/hvylia/);

  // Вигляд запамʼятовується.
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Карта' })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('region', { name: /Карта точок/ })).toBeVisible();
});

test('щасливі години: точка ставить щотижневу знижку, клієнт бачить її при записі й платить менше', async ({ page }) => {
  await page.goto(`${PANEL}#/deals`);
  await page.getByLabel('Точка').selectOption({ label: 'Автомийка «Хвиля»' });
  const f = page.locator('#weekly-form');
  await expect(f.getByLabel('Понеділок')).toBeChecked();
  await expect(f.getByLabel('Неділя')).not.toBeChecked();
  await f.getByLabel('Щасливі години з').selectOption('10:00');
  await f.getByLabel('Щасливі години до').selectOption('12:00');
  await f.getByRole('button', { name: 'Додати щасливі години' }).click();
  await expect(page.locator('#toast')).toHaveText('Щасливі години −15%: Пн–Пт, 10:00–12:00');
  await expect(page.locator('.wb-deal')).toHaveCount(5);

  await page.goto('/#/place/hvylia');
  const deals = page.getByRole('region', { name: 'Знижки за годинами' });
  await expect(deals).toContainText('−15%');
  await expect(deals).toContainText('Пн–Пт, 10:00–12:00');

  await page.goto('/#/book/hvylia');
  await page.getByLabel(/Комплекс преміум/).check();
  // Сьогодні неділя — знижки немає; завтра понеділок — є.
  await page.locator('[data-action="to-time"]').click();
  await expect(page.locator('.slot.hot')).toHaveCount(0);
  const monday = page.getByRole('button', { name: /Завтра, 5, є знижка до 15%/ });
  await expect(monday).toContainText('−15%');
  await monday.click();
  await expect(page.locator('.day-deals')).toContainText('−15% з 10:00 до 12:00');
  await expect(page.locator('.slot[data-time="10:00"]')).toContainText('−15% · 770 ₴');
  await expect(page.locator('.slot[data-time="12:00"]')).not.toContainText('−15%');
  await page.locator('.slot[data-time="10:30"]').click();
  await expect(page.locator('.save-pill')).toContainText('Щасливі години −15%: ви економите 130 ₴');
  await page.locator('[data-action="confirm"]').click();
  await page.getByRole('button', { name: 'Оплатити 770 ₴' }).click();
  await expect(page.locator('article').first()).toContainText('770 ₴');

  await page.goto(`${PANEL}#/deals`);
  await expect(page.locator('.special-list li', { hasText: 'Пн–Пт' })).toContainText('записів зі знижкою: 1');
});

test('статистика застосунку: воронка з реальних дій і демо-активність', async ({ page }) => {
  await page.goto(`${PANEL}`);
  await page.getByLabel('Точка').selectOption({ label: 'Автомийка «Блиск»' });
  await page.getByRole('button', { name: 'Заповнити демо-історію' }).click();
  await expect(page.locator('#toast')).toContainText('демо-записів');

  // Клієнт шукає, відкриває карту й записується.
  await page.goto('/');
  await page.getByLabel('Пошук').fill('шиномонтаж');
  await page.waitForTimeout(1500);
  await page.getByRole('button', { name: 'Карта' }).click();
  await page.goto('/#/place/hvylia');
  await page.goto('/#/book/hvylia');
  await page.getByLabel(/Комплекс преміум/).check();
  await page.locator('[data-action="to-time"]').click();
  await page.getByRole('button', { name: /Завтра/ }).click();
  await page.locator('.slot:not([disabled])').first().click();
  await page.locator('[data-action="confirm"]').click();
  await page.getByRole('button', { name: 'Оплатити 900 ₴' }).click();

  await page.goto('/admin.html#/stats');
  const funnel = page.getByRole('region', { name: 'Воронка запису' });
  await expect(funnel.locator('li').nth(0)).toContainText('Переглянули точку');
  await expect(funnel.locator('li').nth(3)).toContainText('Оплатили');
  await expect(funnel.locator('li').nth(3).locator('b')).toHaveText('1');
  await expect(page.getByRole('region', { name: 'Що шукають' })).toContainText('«шиномонтаж»');
  await expect(page.getByRole('region', { name: 'Що шукають' })).toContainText('без результатів 1');
  await expect(page.getByRole('region', { name: 'Використання функцій' })).toContainText('1 відкриттів');

  await page.getByRole('button', { name: 'Згенерувати демо-активність' }).click();
  await expect(page.locator('#toast')).toContainText('Згенеровано демо-активність');
  const kpis = page.getByRole('region', { name: 'Показники застосунку' });
  await expect(kpis.locator('.kpi.hero .value')).not.toHaveText('0');
  await expect(page.locator('#ch-days .hit')).toHaveCount(30);
  await expect(page.locator('.heat-c.l5').first()).toBeVisible();
  await expect(page.getByRole('region', { name: 'Як платять' })).toContainText('Лише карткою');

  await page.getByRole('button', { name: 'Очистити демо-активність' }).click();
  await expect(funnel.locator('li').nth(3).locator('b')).toHaveText('1');
});

for (const path of ['/', '/admin.html#/stats', `${PANEL}#/deals`, '/#/book/hvylia/2026-10-05/10:00', '/#/place/hvylia']) {
  test(`доступність і верстка ${path}`, async ({ page }) => {
    await page.goto(`${PANEL}`);
    await page.getByLabel('Точка').selectOption({ label: 'Автомийка «Хвиля»' });
    await page.getByRole('button', { name: 'Заповнити демо-історію' }).click();
    await page.goto(`${PANEL}#/deals`);
    await page.getByRole('button', { name: 'Додати щасливі години' }).click();
    if (path === '/') {
      await page.goto('/');
      await page.getByRole('button', { name: 'Карта' }).click();
      await page.locator('[data-pin="hvylia"]').click();
    } else {
      await page.goto(path);
      if (path.includes('stats')) await page.getByRole('button', { name: 'Згенерувати демо-активність' }).click();
      if (path.includes('book')) await page.getByLabel(/Комплекс преміум/).check();
    }
    await page.locator('#view h1').first().waitFor();
    const { violations } = await new AxeBuilder({ page }).analyze();
    expect(violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target).join(', ')}`)).toEqual([]);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow).toBeLessThanOrEqual(0);
  });
}
