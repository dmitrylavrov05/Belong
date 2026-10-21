import { test, expect } from '@playwright/test';
import { payStep } from './pay-step.js';

// CRM мийки в CarCar Business: каса й зміна, зарплата мийників, витратні матеріали, абонементи й картка
// лояльності, нотатки про клієнтів. Час той самий: неділя, 4 жовтня 2026, 10:00.
test.beforeEach(async ({ page }) => {
  await payStep(page);
  await page.addInitScript(() => {
    if (!location.protocol.startsWith('http')) return;
    sessionStorage.setItem('carcar.splash', '1');
    localStorage.getItem('carcar.auth') ?? localStorage.setItem('carcar.auth', '{"phone":"+380 67 111 11 11","at":1}');
    localStorage.getItem('carcar.profile') ?? localStorage.setItem('carcar.profile', '{"name":"Ірина","phone":"+380 67 111 11 11"}');
    localStorage.getItem('carcar.biz.session') ?? localStorage.setItem('carcar.biz.session', '{"demo":true}');
    localStorage.getItem('carcar.admin.promos') ?? localStorage.setItem('carcar.admin.promos', '[]');
    localStorage.getItem('carcar.partner') ?? localStorage.setItem('carcar.partner', '"blysk"');
  });
  await page.clock.setFixedTime(new Date(2026, 9, 4, 10, 0));
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  page.errors = errors;
});

test.afterEach(async ({ page }) => {
  expect(page.errors).toEqual([]);
});

const PRO = '/pro.html';
const at = (h, m = 0, day = 4) => new Date(2026, 9, day, h, m).getTime();
const own = (x) => ({ placeId: 'blysk', channel: 'phone', source: 'crm', services: ['Експрес-мийка кузова'], bonus: 0, minutes: 20, date: '2026-10-04', cls: 0, createdAt: at(7), ...x });
const viaCarcar = (x) => ({ placeId: 'blysk', channel: 'carcar', services: ['Експрес-мийка кузова'], bonus: 0, minutes: 20, date: '2026-10-04', cls: 0, createdAt: at(7), ...x });

async function seed(page, data) {
  await page.goto(PRO);
  await page.evaluate((d) => { for (const [k, v] of Object.entries(d)) localStorage.setItem(`carcar.${k}`, JSON.stringify(v)); }, data);
  await page.goto('about:blank');
}

test('каса: готівка, картка й CARCAR за день, закриття зміни з розбіжністю', async ({ page }) => {
  await seed(page, {
    'biz.staff': { blysk: [{ id: 'w1', name: 'Тарас', role: 'master', active: true, pct: 30 }] },
    bookings: [
      own({ id: 'c1', time: '08:00', clientName: 'Олег', total: 300, paid: 300, state: 'completed', payment: 'cash', masterId: 'w1' }),
      own({ id: 'c2', time: '08:30', clientName: 'Марта', total: 250, paid: 250, state: 'completed', payment: 'card' }),
      viaCarcar({ id: 'c3', time: '09:00', clientName: 'Ірина', total: 250, paid: 250, state: 'completed', masterId: 'w1' }),
    ],
  });
  await page.goto(`${PRO}#/more`);
  await expect(page.getByRole('link', { name: /Каса/ })).toContainText('Сьогодні: 800 ₴ · 3 машини');
  await page.getByRole('link', { name: /Каса/ }).click();
  const tiles = page.getByRole('region', { name: 'Підсумки дня' });
  await expect(tiles).toContainText('Разом за день800 ₴');
  await expect(tiles).toContainText('Готівка300 ₴');
  await expect(tiles).toContainText('Картка на місці250 ₴');
  await expect(tiles).toContainText('Через CARCAR250 ₴');
  // Зарплата мийника за день: 30% від 300 + 250.
  await expect(page.getByRole('region', { name: 'Зарплата мийників за день' })).toContainText('Тарас · 2 авто165 ₴');
  const form = page.locator('#shift-form');
  await form.getByLabel('Перелічили готівки, ₴').fill('280');
  await form.getByRole('button', { name: 'Закрити зміну' }).click();
  await expect(page.locator('#toast')).toHaveText('Зміну закрито. Розбіжність: −20 ₴');
  await expect(page.getByRole('heading', { name: /Зміну закрито о/ })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Останні зміни' })).toContainText('800 ₴ · −20 ₴');
  // Попередній день — порожній.
  await page.getByRole('link', { name: 'Попередній день' }).click();
  await expect(page.getByRole('region', { name: 'Підсумки дня' })).toContainText('0 машин');
});

test('зарплата мийників: ставка у % і за авто, за період', async ({ page }) => {
  await seed(page, {
    'biz.staff': { blysk: [{ id: 'w1', name: 'Тарас', role: 'master', active: true }] },
    bookings: [
      own({ id: 'c1', time: '08:00', total: 300, paid: 300, state: 'completed', payment: 'cash', masterId: 'w1' }),
      own({ id: 'c2', time: '09:00', total: 400, paid: 400, state: 'completed', payment: 'card', masterId: 'w1', date: '2026-10-01' }),
    ],
  });
  await page.goto(`${PRO}#/staff`);
  await page.getByRole('button', { name: 'Ставка: Тарас' }).click();
  const sheet = page.getByRole('dialog');
  await sheet.getByLabel('% від роботи').fill('20');
  await sheet.getByLabel('За авто, ₴').fill('50');
  await sheet.getByRole('button', { name: 'Зберегти' }).click();
  const sal = page.getByRole('region', { name: 'Зарплата' });
  // Цей місяць: (300 + 400) × 20% + 2 × 50 = 240.
  await expect(sal).toContainText('2 авто · робіт на 700 ₴ · 20% від роботи + 50 ₴ за авто');
  await expect(sal).toContainText('Разом до виплати240 ₴');
  await sal.getByRole('button', { name: 'Сьогодні' }).click();
  await expect(sal).toContainText('Разом до виплати110 ₴');
});

test('витратні матеріали: списуються з кожним виконаним авто, попередження про мінімум', async ({ page }) => {
  await seed(page, {
    bookings: [own({ id: 'c1', time: '09:00', clientName: 'Олег', total: 250, paid: 250, state: 'booked' })],
  });
  await page.goto(`${PRO}#/stock`);
  const form = page.locator('#stock-form');
  await form.getByLabel('Назва').fill('Шампунь');
  await form.getByLabel('Залишок').fill('1');
  await form.getByLabel('Витрата на авто').fill('0.3');
  await form.getByLabel('Мінімум').fill('0.8');
  await form.getByLabel('Експрес-мийка кузова').check();
  await form.getByRole('button', { name: 'Додати' }).click();
  await expect(page.locator('.stock-row')).toContainText('Шампунь: 1 л');
  await expect(page.locator('.stock-row')).toContainText('Вистачить приблизно на 3 авто');
  // Запис виконано — 0,3 л списано, залишок нижче мінімуму.
  await page.goto(`${PRO}#/booking/c1`);
  await page.getByRole('dialog').getByRole('button', { name: 'Виконано й оплачено' }).click();
  await expect(page.locator('#toast')).toHaveText('Запис виконано й оплачено. Закінчується: Шампунь');
  await page.goto(`${PRO}#/stock`);
  await expect(page.locator('.stock-row.low')).toContainText('Шампунь: 0,7 л');
  await expect(page.locator('.notice.warn')).toContainText('Закінчується: Шампунь');
  page.once('dialog', (d) => d.accept('2'));
  await page.getByRole('button', { name: 'Поповнити: Шампунь' }).click();
  await expect(page.locator('.stock-row')).toContainText('Шампунь: 2,7 л');
  await expect(page.locator('.stock-row.low')).toHaveCount(0);
});

test('абонемент: мийка продає на місці за номером — клієнт бачить і списує його під час запису', async ({ page }) => {
  await page.goto(`${PRO}#/passes`);
  const form = page.locator('#plan-form');
  await form.getByLabel('Назва').fill('5 мийок кузова');
  await form.getByLabel('Ціна, ₴').fill('1000');
  await form.getByRole('button', { name: 'Додати абонемент' }).click();
  await page.getByRole('button', { name: 'Продати' }).click();
  const sheet = page.getByRole('dialog');
  await sheet.getByLabel('Імʼя клієнта').fill('Ірина');
  await sheet.getByLabel('Телефон клієнта').fill('067 111 11 11');
  await sheet.getByLabel('Готівка').check();
  await sheet.getByRole('button', { name: /^Продати за 1\s000 ₴$/ }).click();
  await expect(page.getByRole('region', { name: 'Діючі абонементи клієнтів' })).toContainText('Ірина · 5 мийок кузова');
  await page.goto(`${PRO}#/cash`);
  await expect(page.getByRole('region', { name: 'Підсумки дня' })).toContainText(/Готівка1\s000 ₴/);

  // Клієнт із цим номером бачить абонемент і записується за ним.
  await page.goto('/#/place/blysk');
  await expect(page.locator('main')).toContainText('У вас: 5 мийок кузова — 5 з 5 візитів');
  await page.goto('/#/book/blysk');
  await page.getByLabel(/Експрес-мийка кузова/).check();
  await page.locator('[data-action="to-time"]').click();
  await page.getByRole('button', { name: /Завтра/ }).click();
  await page.locator('.slot[data-time="10:00"]').click();
  await page.locator('[data-action="confirm"]').click();
  await expect(page.locator('.rc-lines')).toContainText('5 мийок кузова');
});

test('картка лояльності: кожна 3-тя мийка безкоштовно — штампи й знижка в оплаті', async ({ page }) => {
  await seed(page, {
    bookings: [
      viaCarcar({ id: 'v1', time: '09:00', date: '2026-09-20', clientId: 'tel:380671111111', clientName: 'Ірина', total: 250, paid: 250, state: 'completed', completedAt: at(9, 30, 20) }),
      viaCarcar({ id: 'v2', time: '09:00', date: '2026-09-27', clientId: 'tel:380671111111', clientName: 'Ірина', total: 250, paid: 250, state: 'completed', completedAt: at(9, 30, 27) }),
    ],
  });
  await page.goto(`${PRO}#/passes`);
  const form = page.locator('#loyalty-form');
  await form.getByLabel('Увімкнути').check();
  await form.getByLabel('Кожна … мийка').selectOption('3');
  await form.getByRole('button', { name: 'Зберегти' }).click();
  await expect(page.locator('#toast')).toContainText('Картку лояльності ввімкнено');

  await page.goto('/#/place/blysk');
  const card = page.getByRole('region', { name: 'Картка лояльності' });
  await expect(card).toContainText('Кожна 3-та мийка — безкоштовна');
  await expect(card).toContainText('Наступний запис уже зі знижкою');
  await expect(card.getByRole('img', { name: '2 з 2 візитів' })).toBeVisible();
  await page.goto('/#/book/blysk');
  await page.getByLabel(/Експрес-мийка кузова/).check();
  await page.locator('[data-action="to-time"]').click();
  await page.getByRole('button', { name: /Завтра/ }).click();
  await page.locator('.slot[data-time="10:00"]').click();
  await page.locator('[data-action="confirm"]').click();
  await expect(page.locator('.rc-lines')).toContainText('Картка лояльності: 3-та мийка безкоштовно');
  await expect(page.locator('.sheet-total')).toContainText('0 ₴');
  await page.locator('[data-action="pay"]').click();
  const b = await page.evaluate(() => JSON.parse(localStorage.getItem('carcar.bookings')).at(-1));
  expect(b.loyalty).toMatchObject({ pct: 100, every: 3, amount: 250 });
  // Мийка бачить у записі, що це знижка за картою.
  await page.goto(`${PRO}#/booking/${b.id}`);
  await expect(page.getByRole('dialog')).toContainText('3-та мийка: −250 ₴ для клієнта');
});

test('нотатки й мітки про клієнта: видно в списку клієнтів і в картці запису', async ({ page }) => {
  await seed(page, {
    bookings: [own({ id: 'c1', time: '12:00', clientName: 'Олег', clientPhone: '+380 50 222 22 22', total: 250, paid: 250, state: 'booked' })],
  });
  await page.goto(`${PRO}#/clients`);
  await page.getByRole('button', { name: 'Нотатка: Олег' }).click();
  const sheet = page.getByRole('dialog');
  await sheet.getByLabel('VIP').check();
  await sheet.getByLabel('Нотатка').fill('Завжди просить віск');
  await sheet.getByRole('button', { name: 'Зберегти' }).click();
  await expect(page.locator('.client-list li', { hasText: 'Олег' })).toContainText('VIPЗавжди просить віск');
  await page.goto(`${PRO}#/booking/c1`);
  await expect(page.getByRole('dialog')).toContainText('VIPЗавжди просить віск');
});

test('гроші сходяться: каса, «Мийка» й аналітика однакові; клієнти з вулиці окремо; номер і горизонт записів', async ({ page }) => {
  await seed(page, {
    bookings: [
      // Учорашній візит позначили виконаним лише сьогодні — гроші лишаються у вчорашньому дні.
      own({ id: 'y1', date: '2026-10-03', time: '12:00', clientName: 'Олег', clientPhone: '+380 67 000 11 22', total: 300, paid: 300, state: 'completed', payment: 'cash', completedAt: at(9) }),
      viaCarcar({ id: 't1', time: '08:00', clientName: 'Ірина', total: 550, paid: 550, state: 'completed' }),
      // Неявка клієнта CARCAR: мийка отримує частку — і в касі, і в «Мийці».
      viaCarcar({ id: 't2', time: '09:00', clientName: 'Марта', total: 300, paid: 300, state: 'noshow', placeAmount: 300 }),
      own({ id: 'w1', time: '08:20', clientName: 'Клієнт з вулиці', car: 'Golf AA1111', total: 200, paid: 200, state: 'completed', payment: 'cash', channel: 'walkin' }),
      own({ id: 'w2', time: '08:40', clientName: 'Клієнт з вулиці', car: 'Lanos BB2222', total: 200, paid: 200, state: 'completed', payment: 'cash', channel: 'walkin' }),
      viaCarcar({ id: 'f1', date: '2026-10-24', time: '10:00', clientName: 'Андрій', total: 250, paid: 250, state: 'paid' }),
    ],
    'biz.places': { blysk: { schedule: { horizon: 30 } } },
  });
  await page.goto(`${PRO}#/cash`);
  await expect(page.locator('.tile.hero b')).toHaveText('1 250 ₴'.replace(' ', ' '));
  await page.goto(`${PRO}#/cash/2026-10-03`);
  await expect(page.locator('.tile.hero b')).toHaveText('300 ₴');
  await page.goto(`${PRO}#/wash`);
  await expect(page.locator('main')).toContainText('1 250 ₴');
  // Двоє «з вулиці» з різними авто — два клієнти, а не один.
  await page.goto(`${PRO}#/clients`);
  await expect(page.locator('.client-list li', { hasText: 'Клієнт з вулиці' })).toHaveCount(2);
  // Майбутній запис — не «востаннє».
  await expect(page.locator('.client-list li', { hasText: 'Андрій' })).toContainText('запис на 24 жовт.');
  await expect(page.locator('.client-list li', { hasText: 'Андрій' })).not.toContainText('востаннє');
  // Смужка днів — на весь горизонт запису (30 днів), минулі дні — стрілкою.
  await page.goto(`${PRO}#/bookings`);
  await expect(page.locator('.day-strip a[href="#/bookings/2026-10-24"]')).toHaveCount(1);
  await page.getByRole('link', { name: 'Попередній день' }).click();
  await expect(page.locator('.day-head h2')).toContainText('Вчора');
  await expect(page.locator('.day-head')).toContainText('1 запис');
  // Номер «12» — не телефон.
  await page.goto(`${PRO}#/bookings`);
  await page.getByRole('button', { name: 'Новий запис' }).click();
  await page.getByLabel('Телефон', { exact: true }).fill('12');
  await page.getByRole('dialog').getByRole('button', { name: /Експрес-мийка кузова/ }).click();
  await page.getByRole('group', { name: 'День' }).getByRole('button', { name: 'Завтра' }).click();
  await page.getByRole('group', { name: 'Вільний час' }).getByRole('button', { name: '10:00' }).click();
  await page.getByRole('button', { name: 'Записати на 10:00', exact: true }).click();
  await expect(page.locator('.toast')).toContainText('Перевірте номер');
});
