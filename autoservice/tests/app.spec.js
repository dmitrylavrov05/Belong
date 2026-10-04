import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

// Фиксированное время: воскресенье, 4 октября 2026, 10:00 — сезон переобувки.
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

test('каталог фильтруется по категории, поиску и избранному', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByText('Пора на зимнюю резину')).toBeVisible();
  await expect(page.locator('#list article')).toHaveCount(7);

  await page.getByRole('button', { name: '🛞 Шиномонтаж' }).click();
  await expect(page.locator('#list article')).toHaveCount(4);

  await page.getByRole('button', { name: 'Все', exact: true }).click();
  await page.getByLabel('Поиск').fill('кондиционер');
  await expect(page.locator('#list article')).toHaveCount(1);
  await expect(page.locator('#list')).toContainText('СТО «Мотор»');

  await page.getByRole('button', { name: 'В избранное: СТО «Мотор»' }).click();
  await page.getByLabel('Поиск').fill('');
  await page.getByRole('button', { name: '❤️ Избранное' }).click();
  await expect(page.locator('#list article')).toHaveCount(1);
});

test('запись от выбора услуги до отмены', async ({ page }) => {
  await page.goto('/#/place/koleso');
  await expect(page.getByRole('heading', { name: 'Шиномонтаж «Колесо»' })).toBeVisible();
  await page.getByRole('link', { name: 'Записаться онлайн' }).click();

  const confirm = page.locator('[data-action="confirm"]');
  await expect(confirm).toBeDisabled();
  await page.getByLabel(/Сезонная переобувка/).check();
  await page.getByLabel(/Балансировка/).check();
  await expect(page.locator('.summary')).toContainText('3 400 ₽');

  await page.getByRole('button', { name: /Завтра/ }).click();
  const slot = page.locator('.slot:not([disabled])').first();
  const time = await slot.textContent();
  await slot.click();
  await expect(confirm).toBeEnabled();
  await confirm.click();

  await expect(page).toHaveURL(/#\/bookings\//);
  const card = page.locator('article', { hasText: 'Шиномонтаж «Колесо»' });
  await expect(card).toContainText('Предстоит');
  await expect(card).toContainText(time.trim());

  // Занятое мной время больше не предлагается.
  await page.goto('/#/book/koleso');
  await page.getByLabel(/Сезонная переобувка/).check();
  await page.getByRole('button', { name: /Завтра/ }).click();
  await expect(page.locator(`.slot[data-time="${time.trim()}"]`)).toBeDisabled();

  await page.goto('/#/bookings');
  page.once('dialog', (d) => d.accept());
  await page.getByRole('button', { name: 'Отменить' }).click();
  await expect(page.locator('article').first()).toContainText('Отменена');
});

test('машина из гаража задаёт цены при записи', async ({ page }) => {
  await page.goto('/#/garage');
  await page.getByLabel('Марка').fill('Toyota');
  await page.getByLabel('Модель').fill('Land Cruiser');
  await page.getByLabel('Класс').selectOption('2');
  await page.getByRole('button', { name: 'Сохранить' }).click();
  await expect(page.getByRole('heading', { name: 'Toyota Land Cruiser' })).toBeVisible();

  await page.reload();
  await expect(page.getByRole('heading', { name: 'Toyota Land Cruiser' })).toBeVisible();

  await page.goto('/#/book/blesk');
  await expect(page.getByLabel('Ваша машина')).toContainText('Toyota Land Cruiser');
  await page.getByLabel(/Экспресс-мойка/).check();
  await expect(page.locator('.summary')).toContainText('700 ₽');
});

for (const path of ['/', '/#/place/motor', '/#/book/blesk', '/#/bookings', '/#/garage']) {
  test(`доступность и вёрстка: ${path}`, async ({ page }) => {
    await page.goto(path);
    await page.locator('main *').first().waitFor();
    const { violations } = await new AxeBuilder({ page }).analyze();
    expect(violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target).join(', ')}`)).toEqual([]);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow).toBeLessThanOrEqual(0);
  });
}

test('работает без сохранения в localStorage', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, 'localStorage', { get() { throw new Error('blocked'); } });
  });
  await page.goto('/');
  await expect(page.locator('#list article')).toHaveCount(7);
});
