import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { PRO, washReady, proWash } from './helpers.js';

// Той самий фіксований час, що й в інших тестах: неділя, 4 жовтня 2026, 10:00.
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

const ADMIN = '/admin.html';
// Вигадані коди з правильними контрольними сумами.
const RNOKPP = '1234567899';
const IBAN = 'UA22 3052 9900 0002 6001 2345 6789 0';

// Клієнт відкриває завершені записи після «Машина готова» в CarCar Business.
async function washDone(page) {
  await washReady(page);
  await page.goto('/#/bookings');
  await page.getByRole('button', { name: /^Завершені/ }).click();
}

// Рахунок для виплат поточної мийки в CarCar Business.
async function fillPayout(page, { iban = IBAN, holder = 'ФОП Тестенко О. П.', code = RNOKPP } = {}) {
  await page.goto(`${PRO}#/payout`);
  await page.getByLabel('IBAN').fill(iban);
  await page.getByLabel('Отримувач (ФОП чи назва ТОВ)').fill(holder);
  await page.getByLabel('РНОКПП (ФОП) чи ЄДРПОУ (ТОВ)').fill(code);
  await page.getByRole('button', { name: 'Надіслати на перевірку' }).click();
}

// У CarCar Business немає форми юрособи, документів і оферти, а без них адмінка не дає схвалити точку
// чи підтвердити реквізити. Тому ці дані кладемо в сховище напряму (як їх заповнила б мийка).
async function seedLegal(page, placeId) {
  await page.evaluate(({ id, code }) => {
    const all = JSON.parse(localStorage.getItem('carcar.partners') ?? '{}');
    const at = Date.now();
    all[id] = {
      ...all[id],
      company: { type: 'fop', name: 'Тестенко Олена Петрівна', code, tax: 'ep3', email: 'owner@example.com', phone: '+380 67 000 00 99', address: '' },
      docs: { registry: { name: 'vytiah-edr.pdf', size: 2048, at } },
      offer: { version: '1.0', acceptedAt: at, signer: 'Тестенко Олена Петрівна' },
    };
    localStorage.setItem('carcar.partners', JSON.stringify(all));
  }, { id: placeId, code: RNOKPP });
}

// Правильний IBAN monobank (МФО 322001).
const MONO_IBAN = (() => {
  const body = '3220010000026001234567890';
  for (let cc = 0; cc < 100; cc++) {
    const s = `UA${String(cc).padStart(2, '0')}${body}`;
    const moved = `${s.slice(4)}3010${s.slice(2, 4)}`;
    let r = 0;
    for (const ch of moved) r = (r * 10 + Number(ch)) % 97;
    if (r === 1) return s;
  }
  return '';
})();

async function demoSeed(page, name) {
  await proWash(page, name);
  await page.goto(`${PRO}#/more`);
  await page.getByRole('button', { name: 'Заповнити прикладом: історія, записи й повідомлення' }).click();
  await expect(page.locator('#toast')).toHaveText('Додано приклад записів і повідомлень');
  // Приклад містить новий запис, що чекає відповіді мийки: приймаємо його в шторці «Новий запис».
  const alert = page.getByRole('dialog', { name: 'Новий запис' });
  await alert.getByRole('button', { name: 'Прийняти' }).click();
  // У прикладі є мийники — обираємо, хто митиме.
  await page.getByRole('dialog', { name: 'Хто митиме?' }).getByRole('button').filter({ hasText: 'Олександр' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
}

test('нова мийка: додається в CarCar Business, CARCAR перевіряє й додає в каталог', async ({ page }) => {
  await page.goto(`${PRO}#/wash`);
  await page.getByRole('group', { name: 'Ваші мийки' }).getByRole('button', { name: 'Додати мийку' }).click();
  const d = page.getByRole('dialog');
  await d.getByLabel('Назва').fill('Автомийка «Хмаринка»');
  await d.getByLabel('Місто').selectOption('Київ');
  await d.getByLabel('Адреса').fill('вул. Тестова, 1');
  await d.getByLabel('Телефон').fill('+380 44 000 00 99');
  await d.getByLabel('Боксів').fill('3');
  await d.getByRole('button', { name: 'Додати мийку' }).click();
  await expect(page.locator('#toast')).toContainText('Мийку додано');
  const id = await page.evaluate(() => JSON.parse(localStorage.getItem('carcar.partner')));
  expect(await page.evaluate((x) => JSON.parse(localStorage.getItem('carcar.partners'))[x].status, id)).toBe('pending');

  // Мийка вже в кабінеті, але клієнти її ще не бачать.
  await page.goto(`${PRO}#/wash`);
  await expect(page.getByRole('group', { name: 'Ваші мийки' })).toContainText('Автомийка «Хмаринка»');
  await expect(page.locator('.notice.warn')).toContainText('Клієнти ще не бачать мийку: статус «На перевірці»');
  await expect(page.getByRole('link', { name: 'Вказати рахунок для виплат' })).toBeVisible();
  await page.goto('/');
  await expect(page.getByText('Автомийка «Хмаринка»')).toHaveCount(0);

  // Неправильні реквізити не приймаються.
  await fillPayout(page, { iban: 'UA00 3052 9900 0002 6001 2345 6789 0' });
  await expect(page.locator('#toast')).toHaveText('Перевірте IBAN: UA і 27 цифр');
  await fillPayout(page, { code: '1234567890' });
  await expect(page.locator('#toast')).toHaveText('Перевірте РНОКПП чи ЄДРПОУ');
  await fillPayout(page);
  await expect(page.locator('#toast')).toHaveText('Рахунок надіслано на перевірку CARCAR');
  await seedLegal(page, id);

  // Модератор бачить мийку в черзі й схвалює її.
  await page.goto(ADMIN);
  await expect(page.locator('.queue')).toContainText('1 точка чекає перевірки');
  await page.locator('#nav').getByRole('link', { name: /Точки/ }).click();
  await page.getByRole('link', { name: 'Автомийка «Хмаринка»' }).click();
  // Фото мийка додає сама перед публікацією — це не перешкода для схвалення.
  await expect(page.locator('.checks .bad-text')).toHaveText(['Немає фото мийки']);
  await page.getByRole('button', { name: 'Схвалити', exact: true }).click();
  await expect(page.locator('#toast')).toHaveText('Схвалено — мийка опублікує себе в CarCar Business після перевірки профілю');
  expect(await page.evaluate((x) => JSON.parse(localStorage.getItem('carcar.partners'))[x].status, id)).toBe('setup');

  // Поки мийка не опублікувалась, клієнти її не бачать.
  await page.goto('/');
  await expect(page.getByText('Автомийка «Хмаринка»')).toHaveCount(0);
  await page.goto(`${PRO}#/wash`);
  const setup = page.getByRole('region', { name: 'CARCAR схвалив мийку — залишився один крок' });
  await expect(setup).toContainText('Послуги й ціниготово');
  await setup.getByRole('button', { name: 'Опублікувати мийку' }).click();
  await expect(page.locator('#toast')).toHaveText('Мийка в каталозі — клієнти вже можуть записатися');

  // Мийка в каталозі, до неї можна записатися, а виплати дозволені.
  await page.goto('/');
  await page.getByRole('link', { name: /Автомийка «Хмаринка»/ }).first().click();
  await expect(page.getByRole('link', { name: 'Записатися онлайн' })).toBeVisible();
  await page.goto(`${PRO}#/wash`);
  await expect(page.locator('.notice.warn')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Немає коштів для виведення' })).toBeVisible();
});

test('рахунок для виплат: CARCAR перевіряє IBAN, зміна IBAN зупиняє виплати до перевірки', async ({ page }) => {
  await demoSeed(page, 'Автомийка «Хвиля»');
  await page.goto(`${PRO}#/wash`);
  await page.getByRole('link', { name: 'Вказати рахунок для виплат' }).click();
  await expect(page).toHaveURL(/#\/payout$/);
  await fillPayout(page);
  await expect(page.locator('#toast')).toHaveText('Рахунок надіслано на перевірку CARCAR');
  await expect(page.locator('.notice.warn')).toContainText('Рахунок UA…7890 на перевірці CARCAR');
  await page.goto(`${PRO}#/wash`);
  await expect(page.getByRole('link', { name: 'Рахунок на перевірці CARCAR' })).toBeVisible();
  await seedLegal(page, 'hvylia');

  await page.goto(ADMIN);
  await expect(page.locator('.queue')).toContainText('1 точка чекає перевірки');
  await page.goto(`${ADMIN}#/places/hvylia`);
  await expect(page.locator('#h-pay').locator('..')).toContainText('Не перевірено — виплати призупинені');
  await page.getByRole('button', { name: 'Підтвердити зміни й реквізити' }).click();
  await expect(page.locator('#toast')).toHaveText('Зміни підтверджено, виплати дозволені');

  // Тепер можна вивести гроші.
  await page.goto(`${PRO}#/wash`);
  page.once('dialog', (dl) => dl.accept());
  await page.getByRole('button', { name: /^Вивести .* на UA…7890$/ }).click();
  await expect(page.locator('#toast')).toHaveText('Виплату відправлено на рахунок UA…7890');
  await expect(page.locator('.plain-list')).toBeVisible();

  // Новий IBAN: виплати зупинені, доки CARCAR не перевірить; мийка лишається в каталозі.
  await fillPayout(page, { iban: MONO_IBAN });
  await expect(page.locator('#toast')).toHaveText('Рахунок надіслано на перевірку CARCAR');
  await page.goto(`${PRO}#/wash`);
  await expect(page.getByRole('link', { name: 'Рахунок на перевірці CARCAR' })).toBeVisible();
  await expect(page.locator('[data-action="payout"]')).toHaveCount(0);
  await page.goto('/');
  await expect(page.getByRole('link', { name: /Автомийка «Хвиля»/ }).first()).toBeVisible();

  await page.goto(`${ADMIN}#/places/hvylia`);
  await expect(page.locator('.checks')).toContainText('monobank');
  await page.getByRole('button', { name: 'Підтвердити зміни й реквізити' }).click();
  await expect(page.locator('#toast')).toHaveText('Зміни підтверджено, виплати дозволені');
  await page.goto(`${PRO}#/wash`);
  await expect(page.locator('[data-action="payout"]')).toHaveText(/Немає коштів для виведення|на UA…\d{4}/);

  // Призупинення прибирає мийку з каталогу.
  await page.goto(`${ADMIN}#/places/hvylia`);
  await page.getByLabel('Коментар для точки').fill('Скарги клієнтів, перевіряємо');
  await page.getByRole('button', { name: 'Призупинити в каталозі' }).click();
  await page.goto('/');
  await expect(page.getByRole('link', { name: /Автомийка «Хвиля»/ })).toHaveCount(0);
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

  await proWash(page, 'Автомийка «Хвиля»');
  await page.goto(`${PRO}#/reviews`);
  page.once('dialog', (d) => d.accept('Персональні дані й образи майстра'));
  await page.locator('.pro-review', { hasText: 'шахрай' }).getByRole('button', { name: 'Поскаржитися модератору' }).click();
  await expect(page.locator('#toast')).toHaveText('Скаргу надіслано модератору');
  await expect(page.locator('.pro-review', { hasText: 'шахрай' })).toContainText('Скаргу надіслано модератору CARCAR.');

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
  await page.goto(`${PRO}#/reviews`);
  const hidden = page.locator('.pro-review', { hasText: 'шахрай' });
  await expect(hidden).toContainText('приховано модератором');
  await expect(hidden.getByRole('button', { name: 'Поскаржитися модератору' })).toHaveCount(0);
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
  await washReady(page);
  await page.goto('/#/bookings');
  page.once('dialog', (d) => d.accept('Не відбалансували одне колесо'));
  await page.getByRole('button', { name: 'Відкрити спір' }).click();

  await page.goto(`${ADMIN}#/disputes`);
  const card = page.locator('article', { hasText: 'Не відбалансували одне колесо' });
  await card.getByLabel('Розділити', { exact: true }).check();
  await card.getByLabel('Точці, ₴ (для «Розділити»)').fill('600');
  await card.getByLabel('Пояснення рішення').fill('Перевзування виконано, балансування — ні');
  await card.getByRole('button', { name: 'Ухвалити рішення' }).click();
  await expect(page.locator('#toast')).toHaveText('Точці 600 ₴, клієнту 300 ₴ на баланс');
  await expect(page.getByRole('region', { name: 'Вирішені спори' })).toContainText('300 ₴');

  await page.goto('/#/wallet');
  await expect(page.getByRole('region', { name: 'Баланс CARCAR' }).locator('.bonus-sum')).toHaveText('300 ₴');
  await page.goto('/#/bookings');
  await expect(page.locator('article', { hasText: 'Автомийка «Хвиля»' })).toContainText('Повернено 300 ₴ на баланс CARCAR, 600 ₴ отримала точка');
  await proWash(page, 'Автомийка «Хвиля»');
  await expect(page.getByRole('region', { name: 'Гроші через CARCAR' })).toContainText('Можна вивести600 ₴');
});

test('комісії: загальна й індивідуальна ставка впливають на виплати точки', async ({ page }) => {
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

  // Мийки з перевіреним рахунком і грошима до виведення: комісія утримується під час виплати.
  await page.evaluate((iban) => {
    const all = JSON.parse(localStorage.getItem('carcar.partners') ?? '{}');
    for (const id of ['hvylia', 'aqua24']) all[id] = { ...all[id], payout: { iban, holder: 'ФОП Тестенко О. П.', code: '1234567899', verified: true } };
    localStorage.setItem('carcar.partners', JSON.stringify(all));
  }, IBAN.replace(/\s/g, ''));
  for (const [name, pct] of [['Автомийка «Хвиля»', 5], ['Аква 24', 8]]) {
    await demoSeed(page, name);
    await page.goto(`${PRO}#/wash`);
    const money = page.getByRole('region', { name: 'Гроші через CARCAR' });
    await expect(money).toContainText(`Комісія CARCAR ${pct}% утримується під час виведення`);
    const available = Number((await money.locator('.money-row', { hasText: 'Можна вивести' }).locator('b').innerText()).replace(/\D/g, ''));
    expect(available).toBeGreaterThan(0);
    const fee = Math.round(available * pct / 100);
    const net = (available - fee).toLocaleString('uk-UA').replace(/\s/g, '');
    const btn = money.getByRole('button', { name: /^Вивести / });
    expect((await btn.innerText()).replace(/\s/g, '')).toBe(`Вивести${net}₴наUA…7890`);
    let msg = '';
    page.once('dialog', (dl) => { msg = dl.message(); dl.accept(); });
    await btn.click();
    await expect(page.locator('#toast')).toHaveText('Виплату відправлено на рахунок UA…7890');
    expect(msg.replace(/\s/g, '')).toContain(`Комісія${fee.toLocaleString('uk-UA').replace(/\s/g, '')}₴`);
    expect((await money.locator('.plain-list li b').first().innerText()).replace(/\s/g, '')).toBe(`${net}₴`);
  }
  await page.goto(`${ADMIN}#/commission`);
  await expect(page.getByRole('region', { name: 'Виплати точкам' })).toContainText('Автомийка «Хвиля»');
  await expect(page.getByRole('region', { name: 'Виплати точкам' })).toContainText('Аква 24');
});

test('огляд платформи рахує оборот і комісію з демо-історії', async ({ page }) => {
  await demoSeed(page, 'Автомийка «Блиск»');

  await page.goto(ADMIN);
  const kpis = page.getByRole('region', { name: 'Показники платформи' });
  await expect(kpis.locator('.kpi.hero .value')).toHaveText(/\d[\d\s]* ₴/);
  await expect(kpis).toContainText('Комісія (оцінка за ставкою)');
  await expect(page.locator('#ch-gmv .hit')).toHaveCount(30);
  const row = page.getByRole('region', { name: 'Показники точок' }).locator('tbody tr').first();
  await expect(row).toContainText('Автомийка «Блиск»');
  await expect(row).toContainText('10%');
});

for (const path of [`${ADMIN}#/`, `${ADMIN}#/places`, `${ADMIN}#/places/hvylia`, `${ADMIN}#/reviews`, `${ADMIN}#/disputes`, `${ADMIN}#/commission`]) {
  test(`доступність і верстка ${path}`, async ({ page }) => {
    await page.goto(path);
    await page.locator('#view h1').waitFor();
    const { violations } = await new AxeBuilder({ page }).analyze();
    expect(violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target).join(', ')}`)).toEqual([]);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow).toBeLessThanOrEqual(0);
  });
}
