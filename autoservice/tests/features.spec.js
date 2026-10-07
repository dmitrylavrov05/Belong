import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

// Неділя, 4 жовтня 2026, 10:00. Завтра — понеділок.
const TILE = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');

test.beforeEach(async ({ page }, testInfo) => {
  // Вхід за телефоном пройдено — крім тестів самого входу (#/login).
  await page.addInitScript(() => { if (!location.hash.startsWith('#/login')) { localStorage.getItem('carcar.auth') ?? localStorage.setItem('carcar.auth', '{"phone":"","at":1}'); localStorage.getItem('carcar.biz.session') ?? localStorage.setItem('carcar.biz.session', '{"demo":true}'); } });
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

// Мийка підтверджує виконання («Машина готова») у кабінеті точки; клієнт відкриває завершені записи.
async function washDone(page, place = 'Автомийка «Хвиля»') {
  await page.goto('/#/partner');
  await page.getByLabel('Точка').selectOption({ label: place });
  await page.locator('a.prow').first().click();
  await page.getByRole('button', { name: 'Машина готова' }).click();
  await page.goto('/#/bookings');
  await page.getByRole('button', { name: /^Завершені/ }).click();
}
// Суми з тисячами форматуються з нерозривним пробілом.
const money = (s) => new RegExp(s.replace(/ /g, '\\s'));

async function book(page, { place = 'hvylia', service = /Комплекс преміум/, time = '10:00', pay = 'Оплатити 900 ₴' } = {}) {
  await page.goto(`/#/book/${place}`);
  await page.getByLabel(service).check();
  await page.locator('[data-action="to-time"]').click();
  await page.getByRole('button', { name: /Завтра/ }).click();
  await page.locator(`.slot[data-time="${time}"]`).click();
  await page.locator('[data-action="confirm"]').click();
  await page.getByRole('button', { name: pay }).click();
}

async function openInPanel(page, place, client = 'Клієнт CARCAR') {
  await page.goto(`${PANEL}#/schedule/2026-10-05`);
  await page.getByLabel('Точка').selectOption({ label: place });
  await page.locator('.slot-block', { hasText: client }).first().click();
}

test('перенесення: новий час без скасування оплати, точка бачить, звідки перенесли', async ({ page }) => {
  await book(page);
  const card = page.locator('article').first();
  await card.getByRole('link', { name: 'Перенести' }).click();
  await expect(page).toHaveURL(/#\/move\//);
  await expect(page.locator('.notice.ok')).toContainText('Оплата 900 ₴ не скасовується');
  await page.getByRole('button', { name: /Завтра/ }).click();
  await expect(page.locator('.slot[data-time="10:00"]')).toBeDisabled();
  await expect(page.locator('.slot[data-time="10:00"]')).toContainText('зараз');
  await page.locator('.slot[data-time="14:00"]').click();
  await page.getByRole('button', { name: 'Перенести на 5 жовтня, 14:00' }).click();
  await expect(page.locator('#toast')).toHaveText('Запис перенесено на 5 жовтня, 14:00. Оплата збережена');
  await expect(card).toContainText('пн, 5 жовтня, 14:00–14:50');
  await expect(card).toContainText('Перенесено з 5 жовтня, 10:00');
  await expect(card).toContainText('900 ₴');
  // Списання вдруге немає, баланс не змінився.
  await expect(page.getByRole('region', { name: 'Баланс CARCAR' })).toHaveCount(0);

  // Старий час звільнився, новий зайнятий.
  await page.goto('/#/book/hvylia');
  await page.getByLabel(/Комплекс преміум/).check();
  await page.locator('[data-action="to-time"]').click();
  await page.getByRole('button', { name: /Завтра/ }).click();
  await expect(page.locator('.slot[data-time="10:00"]')).toBeEnabled();
  await expect(page.locator('.slot[data-time="14:00"]')).toBeDisabled();

  await openInPanel(page, 'Автомийка «Хвиля»');
  const drawer = page.getByRole('dialog');
  await expect(drawer).toContainText('Перенесено');
  await expect(drawer).toContainText('з 5 жовт., 10:00');
  await expect(drawer.locator('.thread')).toContainText('Клієнт переніс запис з 5 жовтня, 10:00 на 5 жовтня, 14:00');
});

test('перенесення недоступне пізніше ніж за 1,5 год до візиту', async ({ page }) => {
  await page.goto('/#/book/hvylia');
  await page.getByLabel(/Комплекс преміум/).check();
  await page.locator('[data-action="to-time"]').click();
  await page.locator('.slot[data-time="11:00"]').click();
  await page.locator('[data-action="confirm"]').click();
  await page.getByRole('button', { name: 'Оплатити 900 ₴' }).click();
  const card = page.locator('article').first();
  await expect(card.getByRole('button', { name: 'Скасувати без повернення' })).toBeVisible();
  await expect(card.getByRole('link', { name: 'Перенести' })).toHaveCount(0);
  const id = (await card.getAttribute('id')).slice(2);
  await page.goto(`/#/move/${id}`);
  await expect(page.locator('.notice.warn')).toContainText('Перенести можна було до 4 жовтня о 09:30');
});

test('чат за записом: клієнт пише «Приїду з багажником на даху», точка відповідає, відповідь приходить у «Повідомлення»', async ({ page }) => {
  await book(page);
  await page.locator('article').first().getByRole('link', { name: 'Чат з мийкою' }).click();
  // Окремий екран чату: без нижнього меню, з полем унизу, як у месенджерах.
  const chat = page.getByRole('region', { name: 'Чат з Автомийка «Хвиля»' });
  await expect(chat).toBeVisible();
  await expect(page.locator('.tabs')).toBeHidden();
  await chat.getByRole('button', { name: 'Приїду з багажником на даху' }).click();
  await chat.getByLabel('Повідомлення мийці').fill('І ще: можна зберегти старі шини?');
  await chat.getByRole('button', { name: 'Надіслати' }).click();
  await expect(chat.locator('.bubble.me')).toHaveCount(2);
  await expect(chat.locator('.bubble.me').last()).toContainText('І ще: можна зберегти старі шини?');
  await chat.getByRole('button', { name: 'Назад' }).click();
  await expect(page.locator('.tabs')).toBeVisible();

  await page.goto(`${PANEL}#/requests`);
  await page.getByLabel('Точка').selectOption({ label: 'Автомийка «Хвиля»' });
  await expect(page.locator('#nav a[href="#/requests"] .count')).toHaveText('1');
  const chats = page.getByRole('region', { name: 'Повідомлення за записами' });
  await expect(chats).toContainText('Клієнт: І ще: можна зберегти старі шини?');
  await expect(chats).toContainText('Нове');
  await chats.getByRole('button', { name: 'Відкрити запис' }).click();
  const drawer = page.getByRole('dialog');
  await expect(drawer.locator('.thread')).toContainText('Приїду з багажником на даху');
  await drawer.getByRole('button', { name: 'Так, чекаємо' }).click();
  await expect(page.locator('#toast')).toHaveText('Повідомлення надіслано клієнту');
  await expect(page.locator('#nav a[href="#/requests"] .count')).toHaveCount(0);

  await page.goto('/');
  // Одна нова відповідь у чаті — один лічильник, без дубля в сповіщеннях.
  await expect(page.locator('#inbox-tab .tab-count')).toHaveText('1');
  await page.locator('#inbox-tab').click();
  // Переписки списком, як в Instagram: остання репліка, час і позначка нового.
  const convo = page.locator('.convo', { hasText: 'Автомийка «Хвиля»' });
  await expect(convo).toContainText('Так, чекаємо');
  await expect(convo).toHaveClass(/unread/);
  await convo.click();
  await expect(page.locator('.bubble.them')).toContainText('Так, чекаємо');
  await page.goto('/');
  await expect(page.locator('#inbox-tab .tab-count')).toBeHidden();
});

test('чат: коли запис завершено, у стрічці зʼявляється позначка, а поле вводу закривається', async ({ page }) => {
  await book(page);
  await page.locator('article').first().getByRole('link', { name: 'Чат з мийкою' }).click();
  const chat = page.getByRole('region', { name: 'Чат з Автомийка «Хвиля»' });
  await chat.getByRole('button', { name: 'Приїду з багажником на даху' }).click();
  await expect(chat.locator('.chat-mark')).toHaveCount(0);

  // Вечір дня візиту: мийка підтверджує виконання.
  await page.clock.setFixedTime(new Date(2026, 9, 5, 21, 30));
  await washDone(page);

  await page.locator('#inbox-tab').click();
  // Завершена переписка переїжджає в згорнуті «Завершені».
  await page.locator('details.convo-archive summary').click();
  const convo = page.locator('.convo', { hasText: 'Автомийка «Хвиля»' });
  await expect(convo).toContainText('Запис завершено');
  await convo.click();
  const mark = chat.locator('.chat-mark.end');
  await expect(mark).toContainText('Запис завершено');
  await expect(mark).toContainText('21:30');
  // Позначка йде після останнього повідомлення.
  await expect(chat.locator('.chat-msgs > li').last()).toHaveClass(/chat-mark/);
  await expect(chat.getByLabel('Повідомлення мийці')).toHaveCount(0);
  await expect(chat).toContainText('листування лише для читання');
  expect((await new AxeBuilder({ page }).include('.chat-screen').analyze()).violations).toEqual([]);

  // Мийка бачить ту саму позначку в чаті запису.
  await page.goto(`${PANEL}#/schedule/2026-10-05`);
  await page.getByLabel('Точка').selectOption({ label: 'Автомийка «Хвиля»' });
  await page.locator('.slot-block', { hasText: 'Клієнт CARCAR' }).first().click();
  await expect(page.getByRole('dialog').locator('.thread .mark')).toContainText('Запис завершено');
});

test('«Повідомлення»: завершений запис не змішується з актуальними, блоку сповіщень немає', async ({ page }) => {
  await book(page);
  await page.locator('article').first().getByRole('link', { name: 'Чат з мийкою' }).click();
  await page.getByRole('button', { name: 'Приїду з багажником на даху' }).click();
  // Друга, майбутня переписка лишається серед актуальних.
  await book(page, { place: 'blysk', service: /Експрес-мийка/, time: '12:00', pay: /Оплатити/ });
  await page.locator('article', { hasText: 'Блиск' }).first().getByRole('link', { name: 'Чат з мийкою' }).click();
  await page.getByRole('button', { name: 'Можна приїхати раніше?' }).click();

  // Увечері запис у «Хвилю» виконано й підтверджено.
  await page.clock.setFixedTime(new Date(2026, 9, 5, 21, 30));
  await washDone(page);
  await page.locator('#inbox-tab').click();
  await expect(page.locator('#inbox-tab .tab-count')).toBeHidden();

  const live = page.locator('ul.convos').first();
  await expect(live).toContainText('Автомийка «Блиск»');
  await expect(live).not.toContainText('Хвиля');
  const archive = page.locator('details.convo-archive');
  await expect(archive.locator('summary')).toContainText('Завершені');
  await archive.locator('summary').click();
  await expect(archive.locator('.convo.over')).toContainText('Автомийка «Хвиля»');
  await expect(archive.locator('.convo.over')).toContainText('Виконано');

  // Окремого блоку сповіщень немає: нагадування видно на картці запису.
  await expect(page.getByRole('heading', { name: 'Сповіщення' })).toHaveCount(0);
  await expect(page.locator('.msg-card')).toHaveCount(0);
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
});

test('чат: фото, «Прочитано / Не прочитано» і мийка «у мережі»', async ({ page }) => {
  await book(page);
  await page.locator('article').first().getByRole('link', { name: 'Чат з мийкою' }).click();
  const chat = page.getByRole('region', { name: 'Чат з Автомийка «Хвиля»' });
  // Панель мийки ще не відкривали — вона не в мережі.
  await expect(chat.locator('.chat-presence')).toHaveText('не в мережі');
  await chat.getByLabel('Повідомлення мийці').fill('Ось подряпина на дверях');
  await chat.getByLabel('Додати фото').setInputFiles({ name: 'door.png', mimeType: 'image/png', buffer: TILE });
  const mine = chat.locator('.bubble.me');
  await expect(mine.locator('img[alt="Фото"]')).toBeVisible();
  await expect(mine).toContainText('Ось подряпина на дверях');
  await expect(chat.locator('.read-state')).toHaveText('Не прочитано');
  // Фото відкривається на весь екран і закривається Escape.
  await mine.getByRole('button', { name: 'Відкрити фото' }).click();
  await expect(page.getByRole('dialog', { name: 'Фото' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog', { name: 'Фото' })).toHaveCount(0);

  // Мийка відкриває запис: бачить фото, клієнтові — «Прочитано»; відповідає фото.
  await openInPanel(page, 'Автомийка «Хвиля»');
  const drawer = page.getByRole('dialog');
  await expect(drawer.locator('.thread img[alt="Фото від клієнта"]')).toBeVisible();
  await drawer.getByLabel('Додати фото для клієнта').setInputFiles({ name: 'done.png', mimeType: 'image/png', buffer: TILE });
  await expect(page.locator('#toast')).toHaveText('Повідомлення надіслано клієнту');
  await expect(drawer.locator('.thread .read-state')).toHaveText('Не прочитано');

  await page.goto('/#/inbox');
  await expect(page.locator('.convo').first()).toContainText('Фото');
  await expect(page.locator('.convo .avatar.on')).toHaveCount(1);
  await page.locator('.convo').first().click();
  await expect(chat.locator('.chat-presence')).toHaveText('у мережі');
  await expect(chat.locator('.read-state')).toHaveText('Прочитано 10:00');
  await expect(chat.locator('.bubble.them img[alt="Фото"]')).toBeVisible();
  expect((await new AxeBuilder({ page }).include('.chat-screen').analyze()).violations).toEqual([]);

  // Через 25 хв без панелі — «була в мережі 25 хв тому»; мийка бачить, що клієнт прочитав.
  await page.clock.setFixedTime(new Date(2026, 9, 4, 10, 25));
  await page.reload();
  await expect(chat.locator('.chat-presence')).toHaveText('була в мережі 25 хв тому');
  await openInPanel(page, 'Автомийка «Хвиля»');
  await expect(page.getByRole('dialog').locator('.thread .read-state')).toHaveText(/^Прочитано/);
});

test('обмеження: відміни без штрафів, але після 4 скасувань за місяць — лише один активний запис', async ({ page }) => {
  const dialogs = [];
  page.on('dialog', (d) => { dialogs.push(d.message()); d.accept(); });
  const cancelFirst = async () => {
    await page.goto('/#/bookings');
    await page.getByRole('button', { name: /^Активні/ }).click();
    await page.locator('article').first().getByRole('button', { name: /^Скасувати/ }).click();
  };
  // Карточки «Надійність» у гаражі немає — обмеження видно лише тоді, коли спрацювали.
  await page.goto('/#/garage');
  await expect(page.getByRole('region', { name: 'Надійність' })).toHaveCount(0);

  for (let i = 0; i < 4; i++) {
    await book(page, { pay: /Оплатити/ });
    await page.goto('/#/bookings');
    await page.getByRole('button', { name: /^Активні/ }).click();
    await expect(page.locator('article').first().getByRole('button', { name: 'Скасувати', exact: true })).toBeVisible();
    await cancelFirst();
    await expect(page.locator('#toast')).toHaveText('Запис скасовано, 900 ₴ повернено на баланс');
  }
  expect(dialogs[0]).not.toContain('один активний запис');
  expect(dialogs[3]).toContain('після 4 скасувань за місяць можна буде мати лише один активний запис');

  // Тепер — лише один активний запис.
  await book(page, { time: '10:00', pay: /Оплатити/ });
  await page.goto('/#/book/blysk');
  await expect(page.getByRole('heading', { name: 'Забагато активних записів' })).toBeVisible();
  await expect(page.locator('.notice.warn')).toContainText('Ви часто скасовуєте записи');
  await expect(page.getByRole('link', { name: 'Мої записи · 1' })).toBeVisible();

  // Мийка бачить, що клієнт часто змінює плани.
  await openInPanel(page, 'Автомийка «Хвиля»');
  await expect(page.getByRole('dialog').locator('.rel-note')).toContainText('4 скасування');
  await expect(page.getByRole('dialog').locator('.rel-note')).toContainText('лише один активний запис');
});

test('кошторис СТО: клієнт погоджує пункти окремо, доплачує, гарантія потрапляє в сервісну книжку', async ({ page }) => {
  await page.goto('/#/garage');
  await page.getByLabel('Марка').fill('Skoda');
  await page.getByLabel('Модель').fill('Octavia');
  await page.getByRole('button', { name: 'Зберегти', exact: true }).click();
  await book(page, { place: 'pina', service: /Мийка днища й арок/, pay: 'Оплатити 500 ₴' });

  await openInPanel(page, 'Автомийка «Піна»');
  await page.getByRole('dialog').getByRole('button', { name: 'Скласти кошторис' }).click();
  const f = page.locator('#estimate-form');
  await f.getByLabel('Назва, пункт 1').fill('Заміна передніх колодок');
  await f.getByLabel('Ціна за одиницю, ₴, пункт 1').fill('700');
  await f.getByLabel('Гарантія, пункт 1').selectOption('6');
  await f.getByLabel('Назва, пункт 2').fill('Колодки передні');
  await f.getByLabel('Ціна за одиницю, ₴, пункт 2').fill('1200');
  await f.getByLabel('Гарантія, пункт 2').selectOption('12');
  await f.getByRole('button', { name: 'Ще пункт' }).click();
  await f.getByLabel('Назва, пункт 5').fill('Промивка гальмівної системи');
  await f.getByLabel('Тип, пункт 5').selectOption('work');
  await f.getByLabel('Ціна за одиницю, ₴, пункт 5').fill('600');
  await f.getByRole('button', { name: 'Надіслати клієнту' }).click();
  await expect(page.locator('#toast')).toHaveText('Кошторис надіслано клієнту');
  await expect(page.getByRole('dialog').locator('.estimate-box')).toContainText('Чекає погодження клієнта');

  await page.goto('/#/bookings');
  await expect(page.locator('.tabs a[data-tab="bookings"]')).toHaveAttribute('data-badge', '');
  const est = page.getByRole('form', { name: 'Кошторис від точки' });
  await expect(est.locator('.est-item')).toHaveCount(3);
  await expect(est).toContainText('гарантія 12 міс');
  await expect(est.getByRole('button', { name: money('Погодити обрані й доплатити 2 500 ₴') })).toBeVisible();
  await est.getByRole('checkbox', { name: 'Промивка гальмівної системи' }).uncheck();
  await expect(est.getByRole('button', { name: money('Погодити обрані й доплатити 1 900 ₴') })).toBeVisible();
  page.once('dialog', (d) => d.accept());
  await est.getByRole('button', { name: /Погодити обрані/ }).click();
  await expect(page.locator('#toast')).toHaveText(money('Кошторис погоджено, доплачено 1 900 ₴'));
  const card = page.locator('article').first();
  await expect(card.locator('.bk-price')).toHaveText(money('2 400 ₴'));
  await expect(card.locator('.estimate')).toContainText(money('Кошторис: погоджено на 1 900 ₴'));

  await openInPanel(page, 'Автомийка «Піна»');
  const drawer = page.getByRole('dialog');
  await expect(drawer.locator('.estimate-box')).toContainText(money('Погоджено 1 900 ₴'));
  await expect(drawer).toContainText(money('2 400 ₴ · оплачено через CARCAR'));
  await expect(drawer.locator('.thread')).toContainText('Клієнт погодив кошторис: 2 з 3 пунктів');
  await drawer.getByRole('button', { name: 'Машина готова' }).click();

  await page.goto('/#/garage');
  await page.getByRole('link', { name: /Skoda Octavia/ }).click();
  const w = page.locator('h2', { hasText: 'Гарантії' });
  await expect(w).toBeVisible();
  await expect(page.locator('.reminder', { hasText: 'Колодки передні' })).toContainText('12 міс з 4 жовтня 2026 р. · діє до 4 жовтня 2027 р.');
  await expect(page.locator('.reminder', { hasText: 'Заміна передніх колодок' })).toContainText('діє до 4 квітня 2027 р.');
  await expect(page.locator('.log-item').first()).toContainText('Мийка днища й арок, Заміна передніх колодок, Колодки передні');
});

test('виїзд до вас: мийка біля дому з адресою на карті, окрема колонка бригади в журналі', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Виїзд до вас' }).click();
  await expect(page.locator('#count')).toHaveText('2 мийки');
  await page.goto('/#/place/aqua24');
  await expect(page.getByRole('region', { name: 'Виїзд до вас' })).toContainText('У радіусі 12 км, виїзд +250 ₴');

  await page.goto('/#/book/aqua24');
  await page.getByRole('button', { name: 'Виїзд до мене' }).click();
  await expect(page.getByLabel(/Мийка двигуна/)).toHaveCount(0);
  await page.getByLabel(/Експрес-мийка/).check();
  // Без адреси далі не пустить.
  await expect(page.locator('[data-action="to-time"]')).toBeDisabled();
  await expect(page.locator('[data-action="to-time"]')).toHaveText('Вкажіть адресу, куди приїхати');
  await page.getByLabel('Адреса').fill('вул. Героїв полку «Азов», 10, паркінг біля підʼїзду 2');
  await expect(page.locator('[data-action="to-time"]')).toHaveText('Позначте місце на карті');
  const map = page.getByRole('region', { name: /Карта: натисніть/ });
  const box = await map.boundingBox();
  await page.mouse.click(box.x + box.width / 2 + 20, box.y + box.height / 2 + 20);
  await expect(page.locator('#addr-note')).toContainText('від точки — приїдемо');
  await expect(map.getByRole('img', { name: 'Обрана адреса' })).toBeVisible();
  await expect(page.locator('.dock .total')).toContainText('· виїзд');
  await page.locator('[data-action="to-time"]').click();
  await page.getByRole('button', { name: /Завтра/ }).click();
  await page.locator('.slot[data-time="10:00"]').click();
  // 230 ₴ за мийку + 250 ₴ виїзд.
  await page.locator('[data-action="confirm"]').click();
  await expect(page.locator('.sheet')).toContainText('Виїзд до вас: 250 ₴');
  await page.getByRole('button', { name: 'Оплатити 480 ₴' }).click();
  const card = page.locator('article').first();
  await expect(card).toContainText('Виїзд до вас: вул. Героїв полку «Азов», 10');

  // Бригада зайнята ще пів години на дорогу: наступний виїзд — не раніше ніж через 50 хв, а бокси вільні.
  await page.goto(`${PANEL}#/schedule/2026-10-05`);
  await page.getByLabel('Точка').selectOption({ label: 'Аква 24' });
  await expect(page.locator('.sched-col-head', { hasText: 'Виїзд 1' })).toBeVisible();
  await expect(page.locator('.sched-col.mobile .slot-block')).toHaveCount(1);
  await page.locator('.sched-col.mobile .slot-block').click();
  await expect(page.getByRole('dialog')).toContainText('Виїзд');
  await expect(page.getByRole('dialog').getByRole('link', { name: 'Точка на карті' })).toBeVisible();

  // Налаштування виїзду: одна бригада — після виїзду о 10:00 вона зайнята до 10:50, а бокси в точці вільні.
  await page.goto(`${PANEL}#/settings`);
  const mf = page.locator('#mobile-form');
  await mf.getByLabel('Бригад').fill('1');
  await mf.getByRole('button', { name: 'Зберегти виїзд' }).click();
  await page.goto('/#/book/aqua24');
  await page.getByLabel(/Експрес-мийка/).check();
  await page.locator('[data-action="to-time"]').click();
  await page.getByRole('button', { name: /Завтра/ }).click();
  await expect(page.locator('.slot[data-time="10:30"]')).toBeEnabled();
  await page.locator('[data-action="step-back"]').click();
  await page.getByRole('button', { name: 'Виїзд до мене' }).click();
  await page.getByLabel('Адреса').fill('вул. Тестова, 1');
  const box2 = await page.locator('#pick-map').boundingBox();
  await page.mouse.click(box2.x + box2.width / 2, box2.y + box2.height / 2);
  await page.locator('[data-action="to-time"]').click();
  await expect(page.locator('.slot[data-time="10:00"]')).toBeDisabled();
  await expect(page.locator('.slot[data-time="10:30"]')).toBeDisabled();
  await expect(page.locator('.slot[data-time="11:00"]')).toBeEnabled();

  await page.goto(`${PANEL}#/settings`);
  await page.locator('#mobile-form').getByLabel('Приймаємо виїзні записи').uncheck();
  await page.locator('#mobile-form').getByRole('button', { name: 'Зберегти виїзд' }).click();
  await expect(page.locator('#toast')).toHaveText('Виїзд вимкнено');
  await page.goto('/#/place/aqua24');
  await expect(page.getByRole('region', { name: 'Виїзд до вас' })).toHaveCount(0);
});

test('оплата частинами для дорогого детейлінгу: перший платіж, точка отримує всю суму', async ({ page }) => {
  await page.goto('/#/book/hlyanets');
  await page.getByLabel(/Керамічне покриття/).check();
  await page.locator('[data-action="to-time"]').click();
  await page.getByRole('button', { name: /Завтра/ }).click();
  await page.locator('.slot[data-time="10:00"]').click();
  await expect(page.locator('.dock')).toContainText(money('Можна оплатити частинами: від 1 500 ₴/міс'));
  await page.locator('[data-action="confirm"]').click();
  const parts = page.getByRole('group', { name: 'Оплата частинами' });
  await parts.getByLabel(/4 платежі/).check();
  await expect(parts.getByLabel(/4 платежі/)).toBeChecked();
  await page.getByRole('button', { name: money('Оплатити першу частину 2 250 ₴') }).click();
  await expect(page.locator('#toast')).toHaveText('Оплачено першу частину, ви записані');
  const card = page.locator('article').first();
  await expect(card).toContainText(money('Частинами: 4 платежі, перший 2 250 ₴, далі по 2 250 ₴/міс'));
  await expect(card.locator('.bk-price')).toHaveText(money('9 000 ₴'));

  await openInPanel(page, 'Детейлінг-мийка «Глянець»');
  await expect(page.getByRole('dialog')).toContainText('Частинами · 4 платежі');
  await expect(page.getByRole('dialog')).toContainText(money('9 000 ₴ · оплачено через CARCAR'));

  // Дешеві послуги частинами не оплачуються.
  await page.goto('/#/book/hlyanets');
  await page.getByLabel(/Полірування фар/).check();
  await page.locator('[data-action="to-time"]').click();
  await page.getByRole('button', { name: /Завтра/ }).click();
  await page.locator('.slot[data-time="16:00"]').click();
  await page.locator('[data-action="confirm"]').click();
  await expect(page.getByRole('group', { name: 'Оплата частинами' })).toHaveCount(0);
});

test('промокоди: «Перша мийка −30%» сама, свій код з адмінки, CARCAR доплачує точці', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.promo-banner')).toContainText('Перша мийка −30%');
  await page.locator('.promo-banner').click();
  await expect(page.locator('#count')).toHaveText('9 мийок');

  await page.goto('/#/book/blysk');
  await page.getByLabel(/Експрес-мийка/).check();
  await page.locator('[data-action="to-time"]').click();
  await page.getByRole('button', { name: /Завтра/ }).click();
  await page.locator('.slot[data-time="10:00"]').click();
  await expect(page.locator('.save-pill')).toContainText('Перша мийка −30%: −75 ₴ за промокодом PERSHA30');
  await page.locator('[data-action="confirm"]').click();
  await expect(page.locator('.promo-line')).toContainText('−75 ₴');
  await page.getByRole('button', { name: 'Оплатити 175 ₴' }).click();
  await expect(page.locator('article').first()).toContainText('Промокод PERSHA30: −75 ₴');
  await expect(page.locator('.promo-banner')).toHaveCount(0);

  // Точка бачить повну ціну.
  await openInPanel(page, 'Автомийка «Блиск»');
  await expect(page.getByRole('dialog')).toContainText('250 ₴ · оплачено через CARCAR');
  await expect(page.getByRole('dialog')).toContainText('PERSHA30: −75 ₴ для клієнта, доплачує CARCAR');

  // Другий раз — без знижки й з поясненням, якщо ввести код вручну.
  await page.goto('/#/book/blysk');
  await page.getByLabel(/Експрес-мийка/).check();
  await page.locator('[data-action="to-time"]').click();
  await page.getByRole('button', { name: /Завтра/ }).click();
  await page.locator('.slot[data-time="12:00"]').click();
  await page.locator('[data-action="confirm"]').click();
  await expect(page.getByRole('button', { name: 'Оплатити 250 ₴' })).toBeVisible();
  await page.getByLabel('Промокод CARCAR').fill('persha30');
  await page.locator('.promo-form').getByRole('button', { name: 'Застосувати' }).click();
  await expect(page.getByRole('alert')).toHaveText('Ви вже скористалися цим промокодом');

  // Адмінка: новий код на будь-яку мийку.
  await page.goto('/admin.html#/promos');
  const table = page.getByRole('region', { name: 'Промокоди' }).last();
  await expect(table.locator('tr', { hasText: 'PERSHA30' })).toContainText('75 ₴');
  const f = page.locator('#promo-form');
  await f.getByLabel('Код', { exact: true }).fill('chysto15');
  await f.getByLabel('Назва акції для клієнтів').fill('−15% на преміум-комплекс');
  await f.getByLabel('Розмір знижки').fill('15');
  await f.getByRole('button', { name: 'Створити промокод' }).click();
  await expect(page.locator('#toast')).toHaveText('Промокод CHYSTO15 створено');

  await page.goto('/#/book/hvylia');
  await page.getByLabel(/Комплекс преміум/).check();
  await page.locator('[data-action="to-time"]').click();
  await page.getByRole('button', { name: /Завтра/ }).click();
  await page.locator('.slot[data-time="10:00"]').click();
  await page.locator('[data-action="confirm"]').click();
  await page.getByLabel('Промокод CARCAR').fill('CHYSTO15');
  await page.locator('.promo-form').getByRole('button', { name: 'Застосувати' }).click();
  await expect(page.locator('#toast')).toHaveText('Промокод застосовано: −135 ₴');
  await page.getByRole('button', { name: 'Оплатити 765 ₴' }).click();

  // Безкоштовне скасування повертає оплачене й дозволяє скористатися кодом знову.
  page.once('dialog', (d) => d.accept());
  await page.locator('article.hl').getByRole('button', { name: 'Скасувати' }).click();
  await expect(page.locator('#toast')).toHaveText('Запис скасовано, 765 ₴ повернено на баланс');

  await page.goto('/admin.html#/promos');
  await expect(page.locator('tr', { hasText: 'CHYSTO15' })).toContainText('0 ₴');
  await page.locator('tr', { hasText: 'CHYSTO15' }).getByRole('button', { name: 'Вимкнути' }).click();
  await expect(page.locator('tr', { hasText: 'CHYSTO15' })).toContainText('Вимкнено');
  await page.goto('/#/book/hvylia');
  await page.getByLabel(/Комплекс преміум/).check();
  await page.locator('[data-action="to-time"]').click();
  await page.getByRole('button', { name: /Завтра/ }).click();
  await page.locator('.slot[data-time="10:00"]').click();
  await page.locator('[data-action="confirm"]').click();
  await page.getByLabel('Промокод CARCAR').fill('CHYSTO15');
  await page.locator('.promo-form').getByRole('button', { name: 'Застосувати' }).click();
  await expect(page.getByRole('alert')).toHaveText('Промокод не діє');
});

const PAGES = {
  'перенесення': async (page) => { await book(page); await page.locator('article').first().getByRole('link', { name: 'Перенести' }).click(); await page.getByRole('button', { name: /Завтра/ }).click(); await page.locator('.slot[data-time="14:00"]').click(); },
  'запис із кошторисом і чатом': async (page) => {
    await book(page, { place: 'pina', service: /Мийка днища й арок/, pay: 'Оплатити 500 ₴' });
    await openInPanel(page, 'Автомийка «Піна»');
    await page.getByRole('dialog').getByRole('button', { name: 'Скласти кошторис' }).click();
    await page.getByLabel('Назва, пункт 1').fill('Заміна колодок');
    await page.getByLabel('Ціна за одиницю, ₴, пункт 1').fill('700');
    await page.getByRole('button', { name: 'Надіслати клієнту' }).click();
    await page.goto('/#/bookings');
    await page.locator('article').first().getByRole('link', { name: /Чат з мийкою/ }).click();
  },
  'кошторис і чат у панелі': async (page) => {
    await book(page, { place: 'pina', service: /Мийка днища й арок/, pay: 'Оплатити 500 ₴' });
    await openInPanel(page, 'Автомийка «Піна»');
    await page.getByRole('dialog').getByRole('button', { name: 'Скласти кошторис' }).click();
  },
  'виїзд і оплата частинами': async (page) => {
    await page.goto('/#/book/aqua24');
    await page.getByRole('button', { name: 'Виїзд до мене' }).click();
    await page.getByLabel(/Комплекс/).check();
    await page.getByLabel('Адреса').fill('вул. Тестова, 1');
    const box = await page.locator('#pick-map').boundingBox();
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    await page.locator('[data-action="to-time"]').click();
    await page.getByRole('button', { name: /Завтра/ }).click();
    await page.locator('.slot[data-time="10:00"]').click();
  },
  'оплата частинами': async (page) => {
    await page.goto('/#/book/hlyanets');
    await page.getByLabel(/Керамічне покриття/).check();
    await page.locator('[data-action="to-time"]').click();
    await page.getByRole('button', { name: /Завтра/ }).click();
    await page.locator('.slot[data-time="10:00"]').click();
    await page.locator('[data-action="confirm"]').click();
  },
  'адмінка: промокоди': async (page) => { await page.goto('/admin.html#/promos'); },
  'панель: налаштування виїзду й журнал': async (page) => {
    await page.goto(`${PANEL}#/settings`);
    await page.getByLabel('Точка').selectOption({ label: 'Аква 24' });
  },
};

for (const [name, setup] of Object.entries(PAGES)) {
  test(`доступність і верстка: ${name}`, async ({ page }) => {
    await setup(page);
    const { violations } = await new AxeBuilder({ page }).analyze();
    expect(violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target).join(', ')}`)).toEqual([]);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow).toBeLessThanOrEqual(0);
  });
}
