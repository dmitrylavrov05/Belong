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
  // Візит уже почався: «Машина готова» доступна лише після початку.
  await seed(page, { bookings: [{ ...paid, time: '09:30' }] });
  await page.goto(PRO);
  const convo = page.locator('.convo', { hasText: 'Ірина' });
  await expect(convo).toContainText('Можна приїхати раніше?');
  await expect(convo).toContainText('Зараз на мийці');
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
  await page.getByRole('button', { name: 'Записати на 10:00', exact: true }).click();
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

  await expect(page.getByRole('region', { name: 'Перевірка розкладу' })).toContainText('Клієнти бачать вільним: 10:30–22:00');
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

test('мийка: виручка й гроші; відгуки — в «Ще» з публічною відповіддю', async ({ page }) => {
  await seed(page, { bookings: [{ ...paid, id: 'b3', state: 'completed', date: '2026-10-01', completedAt: at(13, 0, 1), unfreezeAt: at(13, 0, 3), chat: undefined, chatUnreadBiz: false }] });
  await page.goto(`${PRO}#/wash`);
  await page.evaluate(() => localStorage.setItem('carcar.reviews', JSON.stringify([{ id: 'v1', placeId: 'blysk', bookingId: 'b3', stars: 5, text: 'Чисто й швидко', services: 'Комплекс: кузов + салон', date: '2026-10-01', clientKey: 'device', at: Date.now(), photos: [] }])));
  await page.reload();
  await expect(page.getByRole('region', { name: 'Виручка' })).toContainText('7 днів550 ₴');
  await expect(page.locator('.money-row').first()).toContainText('550 ₴');
  await expect(page.locator('.pro-review')).toHaveCount(0);

  await page.getByRole('link', { name: 'Ще' }).click();
  await page.getByRole('link', { name: /Відгуки/ }).click();
  const review = page.locator('.pro-review');
  await expect(review).toContainText('Ірина');
  await expect(review).toContainText('Чисто й швидко');
  await review.getByLabel('Відповідь на відгук: Ірина').fill('Дякуємо, чекаємо знову!');
  await review.getByRole('button', { name: 'Надіслати відповідь' }).click();
  await expect(page.locator('.pro-review .reply')).toContainText('Дякуємо, чекаємо знову!');
  await page.goto('/#/place/blysk');
  await expect(page.locator('.review').first()).toContainText('Дякуємо, чекаємо знову!');
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

// ---------- підтвердження запису мийкою ----------

async function clientBooks(page, toast = 'Оплачено. Чекаємо, коли мийка підтвердить запис') {
  await page.goto('/#/book/blysk');
  await page.getByLabel(/Експрес-мийка кузова/).check();
  await page.locator('[data-action="to-time"]').click();
  await page.getByRole('button', { name: /Завтра/ }).click();
  await page.locator('.slot[data-time="10:00"]').click();
  await page.locator('[data-action="confirm"]').click();
  await page.getByRole('button', { name: 'Оплатити 250 ₴' }).click();
  await expect(page.locator('#toast')).toHaveText(toast);
}

test('запис із застосунку чекає підтвердження: сповіщення з деталями, мийка приймає', async ({ page }) => {
  await clientBooks(page);
  const card = page.locator('article.bk').first();
  await expect(card).toContainText('Чекає підтвердження мийки');
  await expect(card).toContainText('Мийка підтвердить запис до 10:05');

  await page.goto(PRO);
  // Поверх екрана — сповіщення з деталями запису й відліком 5 хвилин.
  const alert = page.getByRole('dialog', { name: 'Новий запис' });
  await expect(alert).toContainText('10:00');
  await expect(alert).toContainText('Експрес-мийка кузова');
  await expect(alert).toContainText('250 ₴ через CARCAR');
  await expect(alert).toContainText('4 з 4 вільні в цей час');
  await expect(alert.locator('.countdown')).toHaveText('5:00');
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await alert.getByRole('button', { name: 'Пізніше' }).click();
  // Закрили — запис чекає в блоці зверху, повторно шторка не вискакує.
  const block = page.getByRole('region', { name: 'Нові записи' });
  await expect(block).toContainText('Відповісти до 10:05');
  await expect(page.getByLabel('Непрочитані: 1')).toBeVisible();
  await page.getByRole('link', { name: 'Записи' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.getByRole('region', { name: 'Нові записи' }).getByRole('button', { name: 'Прийняти' }).click();
  await expect(page.locator('.toast')).toContainText('Запис прийнято');
  await expect(page.getByRole('region', { name: 'Нові записи' })).toHaveCount(0);

  await page.goto('/#/bookings');
  await expect(page.locator('article.bk').first()).toContainText('Оплачено');
  await page.goto('/#/inbox');
  await expect(page.locator('.convo').first()).toContainText('підтверджено. Чекаємо вас!');
});

test('мийка відмовляє зі сповіщення — клієнт бачить причину й повернення', async ({ page }) => {
  await clientBooks(page);
  await page.goto(`${PRO}#/bookings/2026-10-05`);
  await page.getByRole('dialog', { name: 'Новий запис' }).getByRole('button', { name: 'Відмовити' }).click();
  await page.getByLabel('Не робимо цю послугу').check();
  await page.getByRole('button', { name: 'Відмовити й повернути гроші' }).click();
  await expect(page.locator('.toast')).toContainText('клієнт отримав гроші назад');
  await expect(page.locator('.bk-row')).toContainText('Скасовано');
  await expect(page.locator('.hour-free').first()).toContainText('08:00 · вільно 4 з 4');

  await page.goto('/#/bookings');
  const card = page.locator('article.bk').first();
  await expect(card).toContainText('Мийка не підтвердила');
  await expect(card).toContainText('Мийка не може прийняти запис: Не робимо цю послугу. Повернено 250 ₴ на картку.');
});

test('кнопки системного сповіщення: «Прийняти» з адреси', async ({ page }) => {
  await clientBooks(page);
  const id = await page.evaluate(() => JSON.parse(localStorage.getItem('carcar.bookings'))[0].id);
  await page.goto(`${PRO}#/act/accept/${id}`);
  await expect(page.locator('.toast')).toContainText('Запис прийнято');
  await expect(page).toHaveURL(/pro\.html#\/$/);
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('carcar.bookings'))[0].state)).toBe('paid');
});

test('відлік минає у відкритому застосунку — запис скасовується сам', async ({ page }) => {
  await page.clock.install({ time: new Date(2026, 9, 4, 10, 0) });
  await clientBooks(page);
  await page.goto(PRO);
  await expect(page.getByRole('dialog', { name: 'Новий запис' })).toBeVisible();
  await page.clock.runFor(5 * 60 * 1000 + 2000);
  await expect(page.locator('.toast')).toContainText('Час на підтвердження минув');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByRole('region', { name: 'Нові записи' })).toHaveCount(0);
});

test('мийка не відповіла за 5 хвилин — запис скасовується сам', async ({ page }) => {
  await clientBooks(page);
  await page.clock.setFixedTime(new Date(2026, 9, 4, 10, 6));
  await page.goto('/#/bookings');
  await page.getByRole('button', { name: /^Завершені/ }).click();
  await expect(page.locator('.done-item').first()).toContainText('Мийка не підтвердила');
  await expect(page.locator('article.bk').first()).toContainText('Мийка не відповіла вчасно. Повернено 250 ₴ на картку.');
});

test('автопідтвердження в профілі мийки — клієнт записаний одразу', async ({ page }) => {
  await page.goto(`${PRO}#/profile`);
  await page.getByLabel(/Приймати записи автоматично/).check();
  await expect(page.locator('.toast')).toContainText('автоматично');
  await clientBooks(page, 'Оплачено, ви записані');
  await expect(page.locator('article.bk').first()).toContainText('Оплачено');
});

// ---------- інший час замість відмови ----------

async function proposeFromAlert(page, time = '14:30') {
  await page.goto(PRO);
  await page.getByRole('dialog', { name: 'Новий запис' }).getByRole('button', { name: 'Запропонувати інший час' }).click();
  const sheet = page.getByRole('dialog', { name: /Інший час/ });
  await expect(sheet.getByRole('button', { name: 'Завтра' })).toHaveAttribute('aria-pressed', 'true');
  await expect(sheet.getByRole('button', { name: '10:00', exact: true })).toHaveCount(0);
  await sheet.getByLabel('Коментар клієнту (необовʼязково)').fill('О 14:30 точно буде вільний бокс');
  await sheet.getByRole('button', { name: time, exact: true }).click();
  await expect(page.locator('.toast')).toContainText(`Клієнту запропоновано завтра о ${time}`);
}

test('мийка пропонує інший час — клієнт погоджується одним дотиком', async ({ page }) => {
  await clientBooks(page);
  await proposeFromAlert(page);
  await page.getByRole('link', { name: 'Записи' }).click();
  await page.getByRole('link', { name: /^Пн\s*5/ }).click();
  await expect(page.locator('.bk-row', { hasText: '14:30' })).toContainText('Чекає відповіді клієнта');

  await page.goto('/#/bookings');
  const card = page.locator('article.bk').first();
  await expect(card).toContainText('Мийка пропонує інший час');
  await expect(card.locator('.offer-when')).toContainText('14:30');
  await expect(card).toContainText('10:00');
  await expect(card).toContainText('«О 14:30 точно буде вільний бокс»');
  await card.getByRole('button', { name: 'Підходить', exact: true }).click();
  await expect(page.locator('#toast')).toHaveText('Домовилися: 5 жовтня о 14:30');
  await expect(page.locator('article.bk').first()).toContainText('Оплачено');

  // Запропонований час — не відмова.
  await page.goto(`${PRO}#/profile`);
  const rel = page.getByRole('region', { name: 'Надійність для клієнтів' });
  await expect(rel).toContainText('0%відмов за 30 днів (0 з 1)');
  await expect(rel).toContainText('Поки мало заявок для оцінки: 1 з 5.');
});

test('клієнту не підійшов запропонований час — гроші повертаються, мийці не рахується', async ({ page }) => {
  await clientBooks(page);
  await proposeFromAlert(page, '16:00');
  await page.goto('/#/bookings');
  page.once('dialog', (d) => d.accept());
  await page.locator('article.bk').first().getByRole('button', { name: 'Не підходить' }).click();
  await expect(page.locator('#toast')).toHaveText('Запис скасовано, 250 ₴ повернено');
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('carcar.bookings'))[0]);
  expect([saved.state, saved.declined, saved.time]).toEqual(['cancelled', 'proposal', '10:00']);
  await page.goto(`${PRO}#/profile`);
  await expect(page.getByRole('region', { name: 'Надійність для клієнтів' })).toContainText('0%відмов за 30 днів (0 з 1)');
});

// ---------- відповідальність за відмови ----------

const asked = (i, extra) => ({
  ...paid, id: `q${i}`, chat: undefined, chatUnreadBiz: false, needsConfirm: true, date: '2026-10-02', time: `1${i}:00`,
  createdAt: at(9, 0, 2), respondedAt: at(9, 1, 2), confirmedAt: at(9, 1, 2), state: 'completed', ...extra,
});
const declinedAsk = (i) => asked(i, { state: 'cancelled', declined: 'place', confirmedAt: undefined, closedAt: at(9, 30), refund: 550 });

test('часті відмови: нижче в пошуку, пауза онлайн-запису, адмін знімає паузу', async ({ page }) => {
  // 3 відмови з 5 заявок — 60%: пауза на 24 години від останньої відмови (сьогодні о 9:30).
  await seed(page, { bookings: [asked(1), asked(2), declinedAsk(3), declinedAsk(4), declinedAsk(5)] });
  await page.goto(PRO);
  await expect(page.locator('.remind', { hasText: 'Онлайн-запис на паузі до' })).toContainText('5 жовтня');
  await page.getByRole('link', { name: 'Профіль' }).click();
  const rel = page.getByRole('region', { name: 'Надійність для клієнтів' });
  await expect(rel).toContainText('60%відмов за 30 днів (3 з 5)');
  await expect(rel).toContainText('1 хв');
  await expect(rel).toContainText('Онлайн-запис на паузі до');

  await page.goto('/');
  await expect(page.locator('.pcard').last()).toContainText('Блиск');
  await expect(page.locator('.pcard', { hasText: 'Блиск' })).toContainText('Онлайн-запис на паузі');
  await page.goto('/#/book/blysk');
  await expect(page.getByRole('heading', { name: 'Онлайн-запис на паузі' })).toBeVisible();

  await page.goto('/admin.html#/places');
  await page.getByRole('button', { name: /^Підключені/ }).click();
  const row = page.locator('tr', { hasText: 'Блиск' });
  await expect(row).toContainText('Запис на паузі');
  await expect(row).toContainText('60%');
  await row.getByRole('link').click();
  await expect(page.getByRole('region', { name: 'Підтвердження записів' })).toContainText('Відмови60% (3, з них без відповіді 0)');
  await page.getByRole('button', { name: 'Зняти паузу' }).click();
  await expect(page.locator('#toast')).toContainText('Паузу знято');
  await page.goto('/#/book/blysk');
  await expect(page.getByRole('heading', { name: 'Онлайн-запис на паузі' })).toHaveCount(0);
});

test('відмов понад 30% — мийка нижче в пошуку, без паузи', async ({ page }) => {
  await seed(page, { bookings: [asked(1), asked(2), asked(3), declinedAsk(4), declinedAsk(5)] });
  await page.goto('/');
  await expect(page.locator('.pcard').last()).toContainText('Блиск');
  await expect(page.locator('.pcard', { hasText: 'Блиск' })).not.toContainText('на паузі');
  await page.goto(`${PRO}#/profile`);
  await expect(page.getByRole('region', { name: 'Надійність для клієнтів' })).toContainText('Мийка нижче в пошуку');
  await page.goto('/#/place/blysk');
  await expect(page.locator('.reply-time')).toHaveText('Підтверджує запис зазвичай за 1 хв');
});

// ---------- профіль, кілька мийок, аналітика й знижки ----------

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');

test('профіль: аватар, фото, назва, адреса й опис одразу бачать клієнти', async ({ page }) => {
  await page.goto(`${PRO}#/profile`);
  const info = page.locator('#pf-info');
  await info.getByLabel('Аватар мийки').setInputFiles({ name: 'a.png', mimeType: 'image/png', buffer: PNG });
  await expect(page.locator('.toast')).toContainText('Аватар оновлено');
  await page.locator('#pf-info').getByLabel('Додати фото мийки').setInputFiles([{ name: '1.png', mimeType: 'image/png', buffer: PNG }, { name: '2.png', mimeType: 'image/png', buffer: PNG }]);
  await expect(page.locator('.toast')).toContainText('Додано 2 фото');
  await expect(page.locator('.photo-grid figure')).toHaveCount(2);
  await page.locator('#pf-info').getByLabel('Назва').fill('Автомийка «Блиск Преміум»');
  await page.locator('#pf-info').getByLabel('Адреса').fill('вул. Антоновича, 50');
  await page.locator('#pf-info').getByLabel('Опис').fill('Кава поки чекаєте, безконтактна мийка за 20 хвилин.');
  await page.locator('#pf-info').getByRole('button', { name: 'Зберегти' }).click();
  await expect(page.locator('.toast')).toContainText('клієнти бачать оновлений профіль');

  await page.goto('/#/place/blysk');
  await expect(page.getByRole('heading', { name: 'Автомийка «Блиск Преміум»' })).toBeVisible();
  await expect(page.locator('.place-ava')).toBeVisible();
  await expect(page.locator('.place-about')).toHaveText('Кава поки чекаєте, безконтактна мийка за 20 хвилин.');
  await expect(page.getByRole('img', { name: 'Автомийка «Блиск Преміум», фото 2' })).toBeAttached();
  await expect(page.locator('.infobox')).toContainText('вул. Антоновича, 50');
});

test('кілька мийок: додати другу мийку, перемикатися, адмін її підключає', async ({ page }) => {
  await page.goto(`${PRO}#/wash`);
  const sw = page.getByRole('group', { name: 'Ваші мийки' });
  await expect(sw.getByRole('button', { name: /Автомийка «Блиск»/ })).toHaveAttribute('aria-pressed', 'true');
  await sw.getByRole('button', { name: 'Додати мийку' }).click();
  const form = page.getByRole('dialog', { name: 'Нова мийка' });
  await form.getByLabel('Назва').fill('Автомийка «Блиск» на Оболоні');
  await form.getByLabel('Адреса').fill('просп. Оболонський, 1');
  await form.getByLabel('Телефон').fill('+380 44 000 11 22');
  await form.getByRole('button', { name: 'Додати мийку' }).click();
  await expect(page).toHaveURL(/#\/profile$/);
  await expect(page.locator('.pro-top')).toContainText('Автомийка «Блиск» на Оболоні');

  await page.getByRole('link', { name: 'Мийка' }).click();
  await expect(page.getByRole('group', { name: 'Ваші мийки' }).getByRole('button', { name: /на Оболоні/ })).toContainText('на перевірці');
  await expect(page.locator('main')).toContainText('Клієнти ще не бачать мийку: статус «На перевірці»');
  await page.getByRole('group', { name: 'Ваші мийки' }).getByRole('button', { name: /Автомийка «Блиск» Київ/ }).click();
  await expect(page.locator('.pro-top')).toContainText('Автомийка «Блиск»');

  await page.goto('/admin.html#/places');
  await page.getByRole('link', { name: 'Автомийка «Блиск» на Оболоні' }).click();
  await expect(page.locator('main')).toContainText('просп. Оболонський, 1');
});

test('аналітика знаходить тихі години, мийка вмикає знижку — клієнт бачить її під час запису', async ({ page }) => {
  await page.goto(`${PRO}#/more`);
  await page.getByRole('button', { name: /Заповнити прикладом/ }).click();
  await page.getByRole('dialog', { name: 'Новий запис' }).getByRole('button', { name: 'Пізніше' }).click();
  await page.getByRole('link', { name: 'Мийка' }).click();
  const card = page.getByRole('region', { name: /Знижка на тихі години/ });
  await expect(card).toContainText('Пн–Пт, 08:00–11:00');
  await page.getByRole('link', { name: /Аналітика/ }).click();
  await expect(page.getByRole('region', { name: 'Завантаження по годинах', exact: true })).toBeVisible();
  await expect(page.getByRole('region', { name: /Підсумки за 30 днів/ })).toContainText('Виручка');
  await page.getByRole('button', { name: 'Увімкнути −20%' }).first().click();
  await expect(page.locator('.toast')).toContainText('Знижку −20% увімкнено: Пн–Пт, 08:00–11:00');
  await expect(page.getByRole('region', { name: /Знижка на тихі години/ })).toContainText('−20% Пн–Пт, 08:00–11:00');

  // Клієнт записується на понеділок: о 09:00 ціна зі знижкою, закреслена стара.
  await page.goto('/#/book/blysk');
  await page.getByLabel(/Експрес-мийка кузова/).check();
  await page.locator('[data-action="to-time"]').click();
  await page.getByRole('button', { name: /Завтра/ }).click();
  const slot = page.getByRole('button', { name: '09:00, знижка 20%, 200 ₴ замість 250 ₴' });
  await expect(slot).toBeVisible();
  await expect(slot.locator('.slot-pct')).toHaveText('−20%');
  await slot.click();
  await expect(page.locator('.save-pill')).toContainText('Знижка за тихий час −20%: ви економите 50 ₴');
});

test('рахунок для виплат, підтримка й клієнти — в «Ще»', async ({ page }) => {
  await seed(page, { bookings: [{ ...paid, chat: undefined, chatUnreadBiz: false }] });
  await page.goto(`${PRO}#/more`);
  await page.getByRole('link', { name: /Рахунок для виплат/ }).click();
  await page.getByLabel('IBAN').fill('UA00 0000');
  await page.getByLabel('Отримувач (ФОП чи назва ТОВ)').fill('ФОП Петренко');
  await page.getByLabel('РНОКПП (ФОП) чи ЄДРПОУ (ТОВ)').fill('1234567899');
  await page.getByRole('button', { name: 'Надіслати на перевірку' }).click();
  await expect(page.locator('.toast')).toContainText('Перевірте IBAN');
  await page.getByLabel('IBAN').fill('UA223052990000026001234567890');
  await page.getByRole('button', { name: 'Надіслати на перевірку' }).click();
  await expect(page.locator('.toast')).toContainText('Рахунок надіслано на перевірку CARCAR');
  await expect(page.locator('main')).toContainText('на перевірці CARCAR');

  await page.goto(`${PRO}#/support`);
  await page.getByLabel('Тема').selectOption({ label: 'Виплати й комісія' });
  await page.getByLabel('Опишіть питання').fill('Коли перевірите рахунок?');
  await page.getByRole('button', { name: 'Надіслати', exact: true }).click();
  await expect(page.locator('.toast')).toContainText(/Звернення №\d+ надіслано в CARCAR/);
  await expect(page.locator('.ticket-thread')).toContainText('Коли перевірите рахунок?');

  await page.goto(`${PRO}#/clients`);
  await expect(page.locator('.client-list')).toContainText('Ірина');
  const no = await page.evaluate(() => JSON.parse(localStorage.getItem('carcar.bookings'))[0].no);
  await page.getByLabel('Пошук клієнта').fill(`№ ${no}`);
  await page.getByRole('button', { name: new RegExp(`Запис № ${no}`) }).click();
  await expect(page.getByRole('dialog')).toContainText('Ірина');
  await page.getByRole('dialog').getByRole('button', { name: 'Закрити' }).click();
  await page.getByLabel('Пошук клієнта').fill('rav4');
  await expect(page.locator('.client-list li')).toHaveCount(1);
  await page.getByRole('button', { name: 'Записати' }).click();
  await expect(page.getByLabel('Імʼя')).toHaveValue('Ірина');
});

for (const path of ['#/analytics', '#/reviews', '#/clients', '#/payout', '#/support']) {
  test(`доступність CarCar Business ${path}`, async ({ page }) => {
    await seed(page, { bookings: [{ ...paid, chat: undefined, chatUnreadBiz: false, state: 'completed', date: '2026-10-01' }] });
    await page.goto(`${PRO}${path}`);
    await page.locator('#view h1').waitFor();
    const { violations } = await new AxeBuilder({ page }).analyze();
    expect(violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target).join(', ')}`)).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  });
}

// ---------- мийники ----------

async function addWasher(page, name, pct = '') {
  await page.goto(`${PRO}#/staff`);
  await page.getByLabel('Імʼя').fill(name);
  if (pct) await page.getByLabel('% від роботи').fill(pct);
  await page.getByRole('button', { name: 'Додати', exact: true }).click();
  await expect(page.locator('.toast')).toContainText(`${name} додано до мийників`);
}

test('мийник: обирають під час прийняття запису, клієнт бачить імʼя, зайнятого видно', async ({ page }) => {
  await addWasher(page, 'Олександр', '35');
  await addWasher(page, 'Віталій');
  await expect(page.locator('.client-list')).toContainText('Олександр');
  await expect(page.locator('.client-list')).toContainText('35% від роботи');

  await clientBooks(page);
  await page.goto(PRO);
  await page.getByRole('dialog', { name: 'Новий запис' }).getByRole('button', { name: 'Прийняти' }).click();
  const pick = page.getByRole('dialog', { name: 'Хто митиме?' });
  await expect(pick.getByRole('button', { name: /Олександр/ })).toContainText('вільний у цей час');
  await pick.getByRole('button', { name: /Олександр/ }).click();
  await expect(page.locator('.toast')).toContainText('Запис прийнято, мийник — Олександр');

  await page.goto('/#/bookings');
  await expect(page.locator('article.bk').first()).toContainText('Мийник: Олександр');
  await page.goto('/#/inbox');
  await expect(page.locator('.convo').first()).toContainText('Вашу машину митиме Олександр');

  // Другий запис на той самий час: Олександр уже зайнятий.
  await page.goto(`${PRO}#/bookings/2026-10-05`);
  await expect(page.locator('.bk-row', { hasText: '10:00' })).toContainText('Олександр');
  await page.getByRole('button', { name: 'Новий запис' }).click();
  const nbSheet = page.getByRole('dialog', { name: 'Новий запис' });
  await nbSheet.getByLabel('Телефон', { exact: true }).fill('067 111 22 33');
  await nbSheet.getByRole('button', { name: /Експрес-мийка кузова/ }).click();
  await nbSheet.getByRole('group', { name: 'День' }).getByRole('button', { name: 'Завтра' }).click();
  await nbSheet.getByRole('group', { name: 'Вільний час' }).getByRole('button', { name: '10:00', exact: true }).click();
  await expect(nbSheet.getByRole('group', { name: 'Мийник' }).getByRole('button', { name: 'Олександр · зайнятий' })).toBeVisible();
  await nbSheet.getByRole('group', { name: 'Мийник' }).getByRole('button', { name: 'Віталій' }).click();
  await nbSheet.getByRole('button', { name: 'Записати на 10:00', exact: true }).click();
  await expect(page.locator('.bk-row', { hasText: 'Клієнт' }).filter({ hasText: 'Віталій' })).toBeVisible();

  // У картці запису мийника можна змінити.
  await page.locator('.bk-row', { hasText: 'Віталій' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Змінити' }).click();
  await expect(page.getByRole('dialog', { name: 'Мийник' }).getByRole('button', { name: /Олександр/ })).toContainText('зайнятий: 10:00–10:20');
  await page.getByRole('dialog', { name: 'Мийник' }).getByRole('button', { name: /Без мийника/ }).click();
  await expect(page.locator('.toast')).toContainText('Мийника знято із запису');
  await expect(page.getByRole('dialog')).toContainText('не призначено');
});

test('доступність: вибір мийника й список мийників', async ({ page }) => {
  await addWasher(page, 'Олександр');
  expect((await new AxeBuilder({ page }).analyze()).violations.map((v) => v.id)).toEqual([]);
  await clientBooks(page);
  await page.goto(PRO);
  await page.getByRole('dialog', { name: 'Новий запис' }).getByRole('button', { name: 'Прийняти' }).click();
  await page.getByRole('dialog', { name: 'Хто митиме?' }).waitFor();
  expect((await new AxeBuilder({ page }).analyze()).violations.map((v) => v.id)).toEqual([]);
});

test('клієнт скасував запис, поки мийка відповідала — шторка закривається, гроші повертаються на картку', async ({ page, context }) => {
  await clientBooks(page);
  await page.goto(PRO);
  await expect(page.getByRole('dialog', { name: 'Новий запис' })).toBeVisible();
  // Застосунок клієнта в іншій вкладці.
  const client = await context.newPage();
  await client.clock.setFixedTime(new Date(2026, 9, 4, 10, 1));
  await client.goto('/#/bookings');
  client.once('dialog', (d) => d.accept());
  await client.locator('article.bk').first().getByRole('button', { name: 'Скасувати', exact: true }).click();
  await expect(client.locator('#toast')).toHaveText('Запис скасовано, повернено 250 ₴ на картку');
  await expect(page.locator('.toast')).toContainText('Запис уже скасовано');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByRole('region', { name: 'Нові записи' })).toHaveCount(0);
  await client.close();
});

test('неявку можна позначити лише через 15 хв після початку; оплата мийці заморожена на 48 год', async ({ page }) => {
  await seed(page, { bookings: [{ ...paid, time: '10:00', chat: undefined, chatUnreadBiz: false }] });
  await page.goto(`${PRO}#/booking/b1`);
  const sheet = page.getByRole('dialog');
  await expect(sheet).toContainText('позначити неявку можна через 15 хв після початку');
  await expect(sheet.getByRole('button', { name: 'Клієнт не приїхав' })).toHaveCount(0);

  await page.clock.setFixedTime(new Date(2026, 9, 4, 10, 16));
  await page.goto('about:blank');
  await page.goto(`${PRO}#/booking/b1`);
  page.once('dialog', (d) => d.accept());
  await page.getByRole('dialog').getByRole('button', { name: 'Клієнт не приїхав' }).click();
  await expect(page.locator('.toast')).toHaveText('Позначено неявку');
  const b = await page.evaluate(() => JSON.parse(localStorage.getItem('carcar.bookings'))[0]);
  expect([b.state, b.refund, b.placeAmount]).toEqual(['noshow', 0, 550]);
  expect(b.unfreezeAt).toBe(new Date(2026, 9, 6, 10, 16).getTime());

  // Клієнт насправді приїхав — може оскаржити, поки гроші заморожені.
  await page.goto('/#/bookings');
  await page.getByRole('button', { name: /^Завершені/ }).click();
  await page.locator('.done-item').first().click();
  await expect(page.getByRole('button', { name: /Я приїхав — відкрити спір/ })).toBeVisible();
});

test('кілька мийок: новий запис іншої мийки сповіщає, «Прийняти» перемикає на неї', async ({ page }) => {
  await page.goto(`${PRO}#/wash`);
  await page.getByRole('group', { name: 'Ваші мийки' }).getByRole('button', { name: 'Додати мийку' }).click();
  const form = page.getByRole('dialog', { name: 'Нова мийка' });
  await form.getByLabel('Назва').fill('Автомийка «Блиск» на Оболоні');
  await form.getByLabel('Адреса').fill('просп. Оболонський, 1');
  await form.getByLabel('Телефон').fill('+380 44 000 11 22');
  await form.getByRole('button', { name: 'Додати мийку' }).click();
  const id = await page.evaluate(() => JSON.parse(localStorage.getItem('carcar.partner')));
  await page.goto(`${PRO}#/wash`);
  await page.getByRole('group', { name: 'Ваші мийки' }).getByRole('button', { name: /Автомийка «Блиск» Київ/ }).click();
  await page.evaluate((placeId) => localStorage.setItem('carcar.bookings', JSON.stringify([{
    id: 'm1', placeId, channel: 'carcar', services: ['Експрес-мийка кузова'], total: 250, paid: 250, bonus: 0, minutes: 30, date: '2026-10-05', time: '12:00',
    car: 'Skoda Octavia', cls: 0, clientName: 'Марта', clientPhone: '+380 50 000 00 01', state: 'pending', needsConfirm: true, createdAt: Date.now(),
  }])), id);
  await page.goto('about:blank');
  await page.goto(`${PRO}#/wash`);
  await expect(page.getByRole('group', { name: 'Ваші мийки' }).getByRole('button', { name: /на Оболоні/ })).toContainText('1 новий запис');
  const alert = page.getByRole('dialog', { name: 'Новий запис' });
  await expect(alert).toContainText('на Оболоні');
  await alert.getByRole('button', { name: 'Прийняти' }).click();
  await expect(page.locator('.toast')).toContainText('Запис прийнято');
  await expect(page.locator('.pro-top')).toContainText('на Оболоні');
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('carcar.bookings'))[0].state)).toBe('paid');
});

test('поля вводу не менші за 16px — iOS не збільшує екран при натисканні', async ({ page }) => {
  await seed(page, { bookings: [paid] });
  const small = async () => page.evaluate(() => [...document.querySelectorAll('input:not([type=checkbox]):not([type=radio]):not([type=file]), textarea, select')]
    .filter((el) => el.offsetParent && parseFloat(getComputedStyle(el).fontSize) < 16).map((el) => el.name || el.id || el.className));
  await page.goto(`${PRO}#/chat/b-b1`);
  await expect(page.getByLabel('Повідомлення клієнту')).toBeVisible();
  expect(await small()).toEqual([]);
  await page.goto('/#/chat/b1');
  await expect(page.locator('.chat-form input[type="text"], .chat-form input:not([type])').first()).toBeVisible();
  expect(await small()).toEqual([]);
  await page.goto(`${PRO}#/profile`);
  expect(await small()).toEqual([]);
});
