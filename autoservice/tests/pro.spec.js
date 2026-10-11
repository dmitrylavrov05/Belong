import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

// CarCar Business — окремий застосунок мийки. Той самий фіксований час: неділя, 4 жовтня 2026, 10:00.
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    if (!location.protocol.startsWith('http')) return;
    localStorage.getItem('carcar.auth') ?? localStorage.setItem('carcar.auth', '{"phone":"","at":1}');
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

// Записи й питання клієнтів для «Блиску» — як ніби їх створив застосунок клієнта.
async function seed(page, { bookings = [], requests = [] }) {
  await page.goto(PRO);
  await page.evaluate(([b, r]) => {
    localStorage.setItem('carcar.bookings', JSON.stringify(b));
    localStorage.setItem('carcar.requests', JSON.stringify(r));
  }, [bookings, requests]);
  // Наступний goto має завантажити сторінку заново, а не лише змінити #.
  await page.goto('about:blank');
}

const paid = {
  id: 'b1', placeId: 'blysk', channel: 'carcar', services: ['Комплекс: кузов + салон'], total: 550, paid: 550, bonus: 0, minutes: 60,
  date: '2026-10-04', time: '12:00', car: 'Toyota RAV4', cls: 0, clientName: 'Ірина', clientPhone: '+380 50 123 45 67', state: 'paid', createdAt: at(8),
  chat: [{ from: 'client', text: 'Можна приїхати раніше?', at: at(9, 40) }], chatUnreadBiz: true,
};

test('без входу — екран логіна; демо відкриває повідомлення', async ({ page }) => {
  await page.goto(PRO);
  await page.evaluate(() => localStorage.removeItem('carcar.biz.session'));
  await page.addInitScript(() => localStorage.removeItem('carcar.biz.session'));
  await page.reload();
  await expect(page.getByRole('heading', { name: 'CarCar Business' })).toBeVisible();
  await page.getByLabel('Логін').fill('nobody');
  await page.getByLabel('Пароль').fill('wrong');
  await page.getByRole('button', { name: 'Увійти' }).click();
  await expect(page.getByRole('alert')).toHaveText('Невірний логін або пароль.');
  await page.getByRole('button', { name: /демо/ }).click();
  await expect(page.getByRole('heading', { name: 'Повідомлення' })).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'Розділи' }).getByRole('link')).toHaveText(['Повідомлення', 'Записи', 'Мийка', 'Профіль', 'Ще']);
});

test('повідомлення: зі статусом запису, відповідь клієнту й «Машина готова»', async ({ page }) => {
  await seed(page, { bookings: [paid] });
  await page.goto(PRO);
  const convo = page.locator('.convo', { hasText: 'Ірина' });
  await expect(convo).toContainText('Можна приїхати раніше?');
  await expect(convo).toContainText('Оплачено');
  await expect(convo.getByLabel('Нове повідомлення')).toBeVisible();
  await expect(page.getByLabel('Непрочитані: 1')).toBeVisible();

  await convo.click();
  await expect(page.getByRole('heading', { name: 'Ірина' })).toBeVisible();
  await page.getByRole('button', { name: 'Так, чекаємо' }).click();
  await expect(page.locator('.bubble.me')).toContainText('Так, чекаємо');
  await page.getByLabel('Повідомлення клієнту').fill('Під’їжджайте до 2 боксу');
  await page.getByRole('button', { name: 'Надіслати', exact: true }).click();
  await expect(page.locator('.bubble.me')).toHaveCount(2);
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('carcar.bookings'))[0]);
  expect(saved.chatUnreadClient).toBe(true);
  expect(saved.chatUnreadBiz).toBe(false);
  expect(saved.chat[0].readAt).toBeTruthy();

  page.once('dialog', (d) => d.accept());
  await page.getByRole('button', { name: 'Машина готова' }).click();
  await expect(page.locator('.chat-mark')).toContainText('Запис завершено');
  await expect(page.getByText('Запис закрито — листування лише для читання.')).toBeVisible();
  await page.getByRole('link', { name: 'До повідомлень' }).click();
  await expect(page.locator('.convo', { hasText: 'Ірина' })).toContainText('Виконано');
  await expect(page.getByLabel(/Непрочитані/)).toHaveCount(0);
});

test('записи по днях: швидкий запис дзвінка займає бокс', async ({ page }) => {
  await page.goto(`${PRO}#/profile`);
  await page.getByLabel('Боксів').fill('1');
  await page.locator('#pf-main').getByRole('button', { name: 'Зберегти' }).click();
  await expect(page.locator('.toast')).toContainText('Збережено');

  await page.getByRole('link', { name: 'Записи' }).click();
  await expect(page.getByRole('navigation', { name: 'Дні' }).getByRole('link')).toHaveCount(14);
  await page.getByRole('button', { name: 'Новий запис' }).click();
  await page.getByLabel('Телефон', { exact: true }).fill('067 111 22 33');
  await page.getByLabel('Імʼя').fill('Петро');
  await page.getByRole('dialog').getByRole('button', { name: /Експрес-мийка кузова/ }).click();
  await page.getByRole('group', { name: 'День' }).getByRole('button', { name: 'Завтра' }).click();
  await page.getByRole('group', { name: 'Вільний час' }).getByRole('button', { name: '10:00' }).click();
  await page.getByRole('button', { name: 'Записати на 10:00' }).click();
  await expect(page.locator('.toast')).toContainText('Записано: Петро, завтра о 10:00');
  await expect(page).toHaveURL(/#\/bookings\/2026-10-05$/);
  const row = page.locator('.bk-row', { hasText: 'Петро' });
  await expect(row).toContainText('10:00');
  await expect(row).toContainText('Записано');
  await expect(row).toContainText('Дзвінок');

  // Бокс один — на 10:00 завтра більше не записати, ні тут, ні в застосунку клієнта.
  await page.getByRole('button', { name: 'Новий запис' }).click();
  await page.getByRole('dialog').getByRole('button', { name: /Експрес-мийка кузова/ }).click();
  await page.getByRole('group', { name: 'День' }).getByRole('button', { name: 'Завтра' }).click();
  await expect(page.getByRole('group', { name: 'Вільний час' }).getByRole('button', { name: '10:00' })).toHaveCount(0);
  await expect(page.getByRole('group', { name: 'Вільний час' }).getByRole('button', { name: '10:30' })).toBeVisible();

  // Постійний клієнт підтягується за телефоном.
  await page.getByLabel('Телефон', { exact: true }).fill('+380671112233');
  await expect(page.getByLabel('Імʼя')).toHaveValue('Петро');
  await expect(page.locator('#nb-hint')).toContainText('Постійний клієнт: 1 візит');
});

test('нагадування: позначити минулі записи й підтвердити розклад — клієнт бачить відмітку', async ({ page }) => {
  await seed(page, { bookings: [{ ...paid, id: 'b2', channel: 'phone', state: 'booked', date: '2026-10-03', time: '12:00', chat: undefined, chatUnreadBiz: false, clientName: 'Олег' }] });
  await page.goto(PRO);
  await expect(page.getByLabel('Записи без позначки: 1')).toBeVisible();
  await page.getByRole('button', { name: /1 запис чекає позначки/ }).click();
  await expect(page.getByRole('dialog', { name: 'Чим закінчились записи' })).toContainText('Олег');
  await page.getByRole('button', { name: 'Виконано' }).click();
  await expect(page.locator('.toast')).toContainText('Усі записи позначено');
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('carcar.bookings'))[0].state)).toBe('completed');
  await expect(page.getByRole('button', { name: /чекає позначки/ })).toHaveCount(0);

  await expect(page.getByRole('region', { name: 'Перевірка розкладу' })).toContainText('Клієнти бачать вільним: 10:00–22:00');
  await page.getByRole('button', { name: 'Так, усе вірно' }).click();
  await expect(page.getByRole('region', { name: 'Перевірка розкладу' })).toHaveCount(0);
  await page.goto('/#/place/blysk');
  await expect(page.locator('.sched-ok')).toHaveText('Мийка підтвердила вільний час сьогодні о 10:00');
});

test('день можна закрити й відкрити знову', async ({ page }) => {
  await page.goto(`${PRO}#/bookings/2026-10-05`);
  page.once('dialog', (d) => d.accept());
  await page.getByRole('button', { name: 'Закрити день' }).click();
  await expect(page.locator('.toast')).toContainText('День закрито');
  await expect(page.getByRole('link', { name: /^Пн\s*5\s*вихідний/ })).toBeVisible();
  await page.getByRole('button', { name: 'Відкрити день' }).click();
  await page.getByLabel('Відкриття').selectOption('600');
  await page.getByLabel('Закриття').selectOption('900');
  await page.getByRole('dialog').getByRole('button', { name: 'Зберегти' }).click();
  await expect(page.locator('.day-head')).toContainText('10:00–15:00 (змінено на цей день)');
  await page.getByRole('link', { name: 'Профіль' }).click();
  await expect(page.locator('#pf-hours')).toContainText('Особливі дні');
  await page.getByRole('button', { name: 'Як завжди' }).click();
  await expect(page.locator('#pf-hours')).not.toContainText('Особливі дні');
});

test('профіль: нова ціна одразу видна клієнтам', async ({ page }) => {
  await page.goto(`${PRO}#/profile`);
  await page.getByRole('button', { name: /Експрес-мийка кузова/ }).click();
  await page.getByLabel('Легкове').fill('333');
  await page.getByRole('dialog').getByRole('button', { name: 'Зберегти' }).click();
  await expect(page.locator('.toast')).toContainText('Прайс збережено');
  await page.getByRole('button', { name: 'Світло є' }).click();
  await expect(page.getByRole('button', { name: 'Світло є' })).toHaveAttribute('aria-pressed', 'true');
  await page.goto('/#/place/blysk');
  await expect(page.locator('main')).toContainText('333 ₴');
});

test('питання клієнта: додати послугу й відповісти', async ({ page }) => {
  await seed(page, { requests: [{ id: 'r1', placeId: 'blysk', clientName: 'Максим', clientPhone: '+380 63 321 00 99', car: 'BMW X5', cls: 2,
    messages: [{ from: 'client', text: 'Робите хімчистку стелі?', at: at(9) }], at: at(9), unreadBiz: true }] });
  await page.goto(PRO);
  await page.getByRole('button', { name: /^Питання/ }).click();
  await page.locator('.convo', { hasText: 'Максим' }).click();
  await page.getByRole('button', { name: 'Додати послугу' }).click();
  await page.getByLabel('Назва').fill('Хімчистка стелі');
  await page.getByLabel('Тривалість, хв').fill('60');
  await page.getByLabel('Легкове').fill('900');
  await page.getByLabel('Кросовер').fill('1000');
  await page.getByLabel('Позашляховик / мінівен').fill('1100');
  await page.getByRole('button', { name: 'Додати й повідомити клієнта' }).click();
  await expect(page.locator('.bubble.me')).toContainText('Додали послугу «Хімчистка стелі» — від 900 ₴');
  await page.getByRole('button', { name: 'Записати' }).click();
  await expect(page.getByLabel('Імʼя')).toHaveValue('Максим');
  await expect(page.getByRole('button', { name: /Хімчистка стелі/ })).toBeVisible();
});

test('мийка: виручка, гроші й відповідь на відгук', async ({ page }) => {
  await seed(page, { bookings: [{ ...paid, id: 'b3', state: 'completed', date: '2026-10-01', completedAt: at(13, 0, 1), unfreezeAt: at(13, 0, 3), chat: undefined, chatUnreadBiz: false }] });
  await page.goto(`${PRO}#/wash`);
  await page.evaluate(() => localStorage.setItem('carcar.reviews', JSON.stringify([{ id: 'v1', placeId: 'blysk', bookingId: 'b3', name: 'Ірина', rating: 5, text: 'Чисто й швидко', at: Date.now() }])));
  await page.reload();
  await expect(page.getByRole('region', { name: 'Виручка' })).toContainText('7 днів550 ₴');
  await expect(page.locator('.money-row').first()).toContainText('550 ₴');
  await page.getByLabel('Відповідь на відгук').fill('Дякуємо, чекаємо знову!');
  await page.getByRole('button', { name: 'Надіслати відповідь' }).click();
  await expect(page.locator('.pro-review .reply')).toContainText('Дякуємо, чекаємо знову!');
});

for (const path of ['#/', '#/bookings', '#/wash', '#/profile', '#/more', '#/chat/b-b1']) {
  test(`доступність CarCar Business ${path}`, async ({ page }) => {
    await seed(page, { bookings: [paid], requests: [{ id: 'r1', placeId: 'blysk', clientName: 'Максим', messages: [{ from: 'client', text: 'Питання', at: at(9) }], at: at(9), unreadBiz: true }] });
    await page.goto(`${PRO}${path}`);
    await page.locator('#view h1').first().waitFor();
    const { violations } = await new AxeBuilder({ page }).analyze();
    expect(violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target).join(', ')}`)).toEqual([]);
    // Без горизонтальної прокрутки сторінки на телефоні.
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  });
}

test('доступність шторки нового запису', async ({ page }) => {
  await page.goto(`${PRO}#/bookings`);
  await page.getByRole('button', { name: 'Новий запис' }).click();
  await page.getByRole('dialog').waitFor();
  const { violations } = await new AxeBuilder({ page }).analyze();
  expect(violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target).join(', ')}`)).toEqual([]);
});
