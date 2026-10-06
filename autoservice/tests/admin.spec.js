import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

// Той самий фіксований час, що й в інших тестах: неділя, 4 жовтня 2026, 10:00.
test.beforeEach(async ({ page }, testInfo) => {
  // Вхід за телефоном пройдено — крім тестів самого входу (#/login).
  await page.addInitScript(() => { if (!location.hash.startsWith('#/login')) { localStorage.getItem('carcar.auth') ?? localStorage.setItem('carcar.auth', '{"phone":"","at":1}'); localStorage.getItem('carcar.biz.session') ?? localStorage.setItem('carcar.biz.session', '{"demo":true}'); } });
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

// Мийка підтверджує виконання («Машина готова») у кабінеті точки; клієнт відкриває завершені записи.
async function washDone(page, place = 'Автомийка «Хвиля»') {
  await page.goto('/#/partner');
  await page.getByLabel('Точка').selectOption({ label: place });
  await page.locator('a.prow').first().click();
  await page.getByRole('button', { name: 'Машина готова' }).click();
  await page.goto('/#/bookings');
  await page.getByRole('button', { name: /^Завершені/ }).click();
}

// У панелі точки на телефоні розділи — у меню «Ще» нижньої панелі.
async function openNav(page) {
  const more = page.locator('#tabbar [data-action="menu-open"]');
  if (await more.isVisible() && (await more.getAttribute('aria-expanded')) !== 'true') await more.click();
  return page.locator('#nav');
}
const ADMIN = '/admin.html';
// Вигадані коди з правильними контрольними сумами.
const RNOKPP = '1234567899';
const EDRPOU = '12345678';
const IBAN = 'UA22 3052 9900 0002 6001 2345 6789 0';

async function newPlace(page, name = 'Автомийка «Хмаринка»') {
  await page.goto(PANEL);
  await page.getByLabel('Точка').selectOption('__new');
  const d = page.getByRole('dialog');
  await d.getByLabel('Назва точки').fill(name);
  await d.getByLabel('Мийка').check();
  await d.getByLabel('Район').selectOption('Оболонський');
  await d.getByLabel('Адреса').fill('вул. Тестова, 1');
  await d.getByLabel('Телефон точки').fill('+380 44 000 00 99');
  await d.getByRole('button', { name: 'Створити й перейти до підключення' }).click();
  await expect(page.locator('#toast')).toHaveText('Точку створено — заповніть дані для підключення');
}

async function fillConnect(page, { type = 'fop', code = RNOKPP, name = 'Тестенко Олена Петрівна' } = {}) {
  const f = page.locator('#connect-form');
  await f.getByLabel(type === 'fop' ? 'ФОП' : 'ТОВ', { exact: true }).check();
  await f.getByLabel(type === 'fop' ? 'ПІБ підприємця' : 'Повна назва юридичної особи').fill(name);
  await f.getByLabel(type === 'fop' ? 'РНОКПП (ІПН)' : 'Код ЄДРПОУ').fill(code);
  if (type === 'tov') await f.getByLabel('Керівник (ПІБ)').fill('Директоренко Іван');
  await f.getByLabel('Email для документів').fill('owner@example.com');
  await f.getByLabel('Телефон відповідальної особи').fill('+380 67 000 00 99');
  await f.locator('[data-doc="registry"]').setInputFiles({ name: 'vytiah-edr.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4 test') });
  await expect(f).toContainText('vytiah-edr.pdf');
  await f.getByLabel('IBAN').fill(IBAN);
  await f.getByLabel('Отримувач', { exact: true }).fill(type === 'fop' ? 'ФОП Тестенко О. П.' : name);
  await f.getByLabel('Код отримувача').fill(code);
  await f.getByLabel(/приймаю оферту/).check();
}

test('нова точка: підключення ФОП, перевірка CARCAR і поява в каталозі', async ({ page }) => {
  await newPlace(page);
  await expect(page.getByRole('heading', { name: 'Підключення до CARCAR' })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Статус підключення' })).toContainText('Чернетка');

  // На інших екранах — нагадування, а клієнти точку ще не бачать.
  await page.goto(`${PANEL}#/schedule`);
  await expect(page.locator('.status-banner')).toContainText('Клієнти ще не бачать цю точку');
  await page.goto('/');
  await expect(page.getByText('Автомийка «Хмаринка»')).toHaveCount(0);

  // Неправильний код одразу видно, заявку з ним не надіслати.
  await page.goto(`${PANEL}#/connect`);
  const f = page.locator('#connect-form');
  await f.getByLabel('РНОКПП (ІПН)').fill('1234567890');
  await expect(page.locator('#code-check')).toContainText('контрольна сума не збігається');
  await f.getByLabel('IBAN').fill('UA00 3052 9900 0002 6001 2345 6789 0');
  await expect(page.locator('#iban-check')).toContainText('контрольна сума не збігається');
  await f.getByRole('button', { name: 'Надіслати на перевірку' }).click();
  await expect(page.locator('#toast')).toContainText('Заповніть: юридична особа, документи, реквізити для виплат, договір-оферта');

  await fillConnect(page);
  await expect(page.locator('#code-check')).toContainText('Контрольна сума правильна');
  await expect(page.locator('#iban-check')).toContainText('ПриватБанк (МФО 305299)');
  await f.getByRole('button', { name: 'Надіслати на перевірку' }).click();
  await expect(page.locator('#toast')).toHaveText('Заявку надіслано — CARCAR перевірить дані до 3 робочих днів');
  await expect(page.getByRole('region', { name: 'Статус підключення' })).toContainText('На перевірці');
  await expect(page.locator('.notice.ok')).toContainText('Тестенко Олена Петрівна');

  // Модератор бачить заявку в черзі, усі автоматичні перевірки пройдено.
  await page.goto(ADMIN);
  await expect(page.locator('.queue')).toContainText('1 точка чекає перевірки');
  await page.locator('#nav').getByRole('link', { name: /Точки/ }).click();
  await page.getByRole('link', { name: 'Автомийка «Хмаринка»' }).click();
  await expect(page.locator('.checks .bad-text')).toHaveCount(0);
  await expect(page.locator('.checks')).toContainText('Оферту 1.0 прийнято');
  await page.getByRole('button', { name: 'Схвалити й додати в каталог' }).click();
  await expect(page.locator('#toast')).toHaveText('Точку підключено — вона вже в каталозі');

  // Точка в каталозі, до неї можна записатися, а виплати дозволені.
  await page.goto('/');
  await page.getByRole('link', { name: /Автомийка «Хмаринка»/ }).first().click();
  await expect(page.getByRole('link', { name: 'Записатися онлайн' })).toBeVisible();
  await page.goto(`${PANEL}#/finance`);
  await expect(page.locator('.status-banner')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Немає коштів для виведення' })).toBeVisible();
});

test('модератор просить виправлення, точка виправляє; зміна IBAN зупиняє виплати до перевірки', async ({ page }) => {
  await newPlace(page, 'СТО «Тест»');
  await fillConnect(page, { type: 'tov', code: EDRPOU, name: 'ТОВ «Тест Авто»' });
  await page.getByRole('button', { name: 'Надіслати на перевірку' }).click();

  await page.goto(`${ADMIN}#/places`);
  await page.getByRole('link', { name: 'СТО «Тест»' }).click();
  await page.getByRole('button', { name: 'Потрібні виправлення' }).click();
  await expect(page.locator('#toast')).toHaveText('Напишіть коментар для точки');
  await page.getByLabel('Коментар для точки').fill('Додайте юридичну адресу з витягу');
  await page.getByRole('button', { name: 'Потрібні виправлення' }).click();

  await page.goto(`${PANEL}#/connect`);
  await expect(page.locator('.connect-status')).toContainText('Потрібні виправлення');
  await expect(page.locator('.connect-status')).toContainText('Додайте юридичну адресу з витягу');
  await page.getByLabel('Юридична адреса').fill('м. Київ, вул. Тестова, 1');
  await page.getByRole('button', { name: 'Надіслати на перевірку' }).click();
  await page.goto(`${ADMIN}#/places`);
  await page.getByRole('link', { name: 'СТО «Тест»' }).click();
  await page.getByRole('button', { name: 'Схвалити й додати в каталог' }).click();

  // Нові реквізити: точка лишається в каталозі, але виплати чекають перевірки.
  await page.goto(`${PANEL}#/connect`);
  await page.getByLabel('IBAN').fill('UA21 3220 0100 0002 6001 2345 6789 0');
  await page.getByRole('button', { name: 'Надіслати зміни на перевірку' }).click();
  await expect(page.locator('#toast')).toContainText('Заповніть: реквізити для виплат');
  // Правильний IBAN monobank із тим самим рахунком.
  const iban = await page.evaluate(() => {
    const body = '3220010000026001234567890';
    for (let cc = 0; cc < 100; cc++) {
      const s = `UA${String(cc).padStart(2, '0')}${body}`;
      const moved = `${s.slice(4)}3010${s.slice(2, 4)}`;
      let r = 0;
      for (const ch of moved) r = (r * 10 + Number(ch)) % 97;
      if (r === 1) return s;
    }
    return '';
  });
  await page.getByLabel('IBAN').fill(iban);
  await expect(page.locator('#iban-check')).toContainText('monobank');
  await page.getByRole('button', { name: 'Надіслати зміни на перевірку' }).click();
  await expect(page.locator('.connect-status')).toContainText('Реквізити на перевірці');
  await page.goto(`${PANEL}#/finance`);
  await expect(page.getByText('Реквізити на перевірці CARCAR')).toBeVisible();
  await page.goto('/');
  await expect(page.getByRole('link', { name: /СТО «Тест»/ }).first()).toBeVisible();

  await page.goto(`${ADMIN}#/places/`);
  await page.getByRole('link', { name: 'СТО «Тест»' }).click();
  await page.getByRole('button', { name: 'Підтвердити зміни й реквізити' }).click();
  await expect(page.locator('#toast')).toHaveText('Зміни підтверджено, виплати дозволені');

  // Призупинення прибирає точку з каталогу.
  await page.getByLabel('Коментар для точки').fill('Скарги клієнтів, перевіряємо');
  await page.getByRole('button', { name: 'Призупинити в каталозі' }).click();
  await page.goto('/');
  await expect(page.getByRole('link', { name: /СТО «Тест»/ })).toHaveCount(0);
});

test('скарга точки на відгук: модератор приховує, рейтинг перераховується', async ({ page }) => {
  for (const [stars, text] of [[5, 'Усе чудово'], [1, 'Майстер Іван — шахрай, ось його номер 0670000000']]) {
    await page.clock.setFixedTime(new Date(2026, 9, 4, 10, 0));
    await page.goto('/#/book/hvylia');
    await page.getByLabel(/Комплекс преміум/).check();
    await page.locator('[data-action="to-time"]').click();
    await page.getByRole('button', { name: /Завтра/ }).click();
    await page.locator('.slot:not([disabled])').first().click();
    await page.locator('[data-action="confirm"]').click();
    await page.getByRole('button', { name: 'Оплатити 900 ₴' }).click();
    await page.clock.setFixedTime(new Date(2026, 9, 5, 21, 30));
    await washDone(page);
    await page.locator('.star-input label').nth(stars - 1).click();
    await page.getByLabel('Відгук (необовʼязково)').fill(text);
    await page.getByRole('button', { name: 'Надіслати відгук' }).click();
  }
  await page.goto('/#/place/hvylia');
  await expect(page.locator('.meta .rating').first()).toHaveText('3,0');
  await expect(page.getByText('шахрай')).toBeVisible();

  await page.goto(`${PANEL}#/reviews`);
  await page.getByLabel('Точка').selectOption({ label: 'Автомийка «Хвиля»' });
  page.once('dialog', (d) => d.accept('Персональні дані й образи майстра'));
  await page.locator('article', { hasText: 'шахрай' }).getByRole('button', { name: 'Поскаржитися модератору' }).click();
  await expect(page.locator('#toast')).toHaveText('Скаргу надіслано модератору CARCAR');

  await page.goto(ADMIN);
  await expect(page.locator('.queue')).toContainText('1 скарга на відгуки');
  await page.locator('#nav').getByRole('link', { name: /Відгуки/ }).click();
  const card = page.locator('article', { hasText: 'шахрай' });
  await expect(card).toContainText('Персональні дані й образи майстра');
  await card.getByLabel('Причина').selectOption('Персональні дані');
  await card.getByRole('button', { name: 'Приховати' }).click();
  await expect(page.locator('#toast')).toHaveText('Відгук приховано');

  await page.goto('/#/place/hvylia');
  await expect(page.getByText('шахрай')).toHaveCount(0);
  await expect(page.locator('.meta .rating').first()).toHaveText('5,0');
  await page.goto(`${PANEL}#/reviews`);
  await expect(page.locator('article', { hasText: 'шахрай' })).toContainText('Приховано модератором CARCAR: Персональні дані');
});

test('спір: модератор ділить суму, клієнт отримує решту на баланс', async ({ page }) => {
  await page.goto('/#/book/hvylia');
  await page.getByLabel(/Комплекс преміум/).check();
  await page.locator('[data-action="to-time"]').click();
  await page.getByRole('button', { name: /Завтра/ }).click();
  await page.locator('.slot:not([disabled])').first().click();
  await page.locator('[data-action="confirm"]').click();
  await page.getByRole('button', { name: 'Оплатити 900 ₴' }).click();
  await page.clock.setFixedTime(new Date(2026, 9, 5, 21, 30));
  await page.goto(`${PANEL}#/schedule/2026-10-05`);
  await page.getByLabel('Точка').selectOption({ label: 'Автомийка «Хвиля»' });
  await page.locator('.slot-block').first().click();
  await page.getByRole('dialog').getByRole('button', { name: 'Машина готова' }).click();
  await page.goto('/#/bookings');
  page.once('dialog', (d) => d.accept('Не відбалансували одне колесо'));
  await page.getByRole('button', { name: 'Відкрити спір' }).click();

  await page.goto(`${ADMIN}#/disputes`);
  const card = page.locator('article', { hasText: 'Не відбалансували одне колесо' });
  await card.getByLabel('Розділити', { exact: true }).check();
  await card.getByLabel('Точці, ₴ (для «Розділити»)').fill('600');
  await card.getByLabel('Пояснення рішення').fill('Перевзування виконано, балансування — ні');
  await card.getByRole('button', { name: 'Ухвалити рішення' }).click();
  await expect(page.locator('#toast')).toHaveText('Точці 600 ₴, решту повернено клієнту');
  await expect(page.getByRole('region', { name: 'Вирішені спори' })).toContainText('300 ₴');

  await page.goto('/#/wallet');
  await expect(page.getByRole('region', { name: 'Баланс CARCAR' }).locator('.bonus-sum')).toHaveText('300 ₴');
  await page.goto('/#/bookings');
  await expect(page.locator('article', { hasText: 'Автомийка «Хвиля»' })).toContainText('Повернено 300 ₴ на баланс CARCAR, 600 ₴ отримала точка');
  await page.goto('/#/partner');
  await page.getByLabel('Точка').selectOption({ label: 'Автомийка «Хвиля»' });
  await expect(page.getByRole('region', { name: 'Баланс' })).toContainText('Доступно до виведення600 ₴');
});

test('комісії: загальна й індивідуальна ставка впливають на виплати й звіт точки', async ({ page }) => {
  await page.goto(`${ADMIN}#/commission`);
  await page.getByLabel('Комісія, %').fill('8');
  await page.getByRole('button', { name: 'Зберегти', exact: true }).click();
  await expect(page.locator('#toast')).toHaveText('Загальну комісію встановлено: 8%');

  await page.goto(`${ADMIN}#/places/hvylia`);
  await page.getByLabel(/Комісія для точки, %/).fill('5');
  await page.getByRole('button', { name: 'Зберегти комісію' }).click();
  await page.goto(`${ADMIN}#/commission`);
  await expect(page.getByRole('region', { name: 'Комісії' })).toContainText('8%');
  await expect(page.locator('.special-list')).toContainText('Автомийка «Хвиля»');
  await expect(page.locator('.special-list')).toContainText('5%');

  await page.goto(`${PANEL}#/finance`);
  await page.getByLabel('Точка').selectOption({ label: 'Автомийка «Хвиля»' });
  await expect(page.locator('table.pnl')).toContainText('Комісія CARCAR, 5%');
  await page.getByLabel('Точка').selectOption({ label: 'Аква 24' });
  await expect(page.locator('table.pnl')).toContainText('Комісія CARCAR, 8%');
});

test('огляд платформи рахує оборот і комісію з демо-історії', async ({ page }) => {
  await page.goto(PANEL);
  await page.getByLabel('Точка').selectOption({ label: 'Автомийка «Блиск»' });
  await page.getByRole('button', { name: 'Заповнити демо-історію' }).click();
  await expect(page.locator('#toast')).toContainText('демо-записів');

  await page.goto(ADMIN);
  const kpis = page.getByRole('region', { name: 'Показники платформи' });
  await expect(kpis.locator('.kpi.hero .value')).toHaveText(/\d[\d\s]* ₴/);
  await expect(kpis).toContainText('Комісія нарахована');
  await expect(page.locator('#ch-gmv .hit')).toHaveCount(30);
  const row = page.getByRole('region', { name: 'Показники точок' }).locator('tbody tr').first();
  await expect(row).toContainText('Автомийка «Блиск»');
  await expect(row).toContainText('7%');
});

for (const path of [`${ADMIN}#/`, `${ADMIN}#/places`, `${ADMIN}#/places/hvylia`, `${ADMIN}#/reviews`, `${ADMIN}#/disputes`, `${ADMIN}#/commission`, `${PANEL}#/connect`, `${PANEL}#/offer`]) {
  test(`доступність і верстка ${path}`, async ({ page }) => {
    await page.goto(path);
    await page.locator('#view h1').waitFor();
    const { violations } = await new AxeBuilder({ page }).analyze();
    expect(violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target).join(', ')}`)).toEqual([]);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow).toBeLessThanOrEqual(0);
  });
}
