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

  await expect(page).toHaveURL(/#\/bookings\//);
  const card = page.locator('article', { hasText: 'Шиномонтаж «Колесо»' });
  await expect(card).toContainText('Майбутній');
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

for (const path of ['/', '/#/place/motor', '/#/book/blysk', '/#/bookings', '/#/garage']) {
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
