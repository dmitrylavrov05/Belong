// Спільні дії для тестів: мийка працює в CarCar Business (pro.html), модератор — в адмінці.
import { expect } from '@playwright/test';

export const PRO = '/pro.html';

// Останній запис у сховищі (щойно створений клієнтом).
export const lastBooking = (page) => page.evaluate(() => JSON.parse(localStorage.getItem('carcar.bookings')).at(-1));

// Картка запису в CarCar Business.
export async function proBooking(page, id) {
  id ??= (await lastBooking(page)).id;
  await page.goto(`${PRO}#/booking/${id}`);
  await expect(page.getByRole('dialog')).toBeVisible();
  return page.getByRole('dialog');
}

// Мийка натискає «Машина готова» для запису (типово — останнього).
export async function washReady(page, id) {
  const sheet = await proBooking(page, id);
  await sheet.getByRole('button', { name: 'Машина готова' }).click();
  await expect(page.locator('#toast')).toHaveText('Клієнт отримав сповіщення «Машина готова»');
}

// Розділ «Мийка» для потрібної точки.
export async function proWash(page, name) {
  await page.goto(`${PRO}#/wash`);
  await page.getByRole('group', { name: 'Ваші мийки' }).getByRole('button', { name: new RegExp(name.replace(/[«»]/g, '.')) }).click();
}

// Модератор вирішує спір в адмінці: 'client' — повернути клієнту, 'place' — передати точці.
export async function moderate(page, to) {
  await page.goto('/admin.html#/disputes');
  await page.getByLabel(to === 'client' ? 'Усе клієнту' : 'Усе точці').first().check();
  await page.getByRole('button', { name: 'Ухвалити рішення' }).first().click();
}
