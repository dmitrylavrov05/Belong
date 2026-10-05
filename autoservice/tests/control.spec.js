import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

// Неділя, 4 жовтня 2026, 10:00. Завтра — понеділок.
test.beforeEach(async ({ page }) => {
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

async function bookToday(page, time = '11:00') {
  await page.goto('/#/book/koleso');
  await page.getByLabel(/Сезонне перевзування/).check();
  await page.locator(`.slot[data-time="${time}"]`).click();
  await page.locator('[data-action="confirm"]').click();
  await page.getByRole('button', { name: 'Оплатити 900 ₴' }).click();
}

test('підтримка: клієнт пише про запис, модератор переводить у спір і вирішує — відповідь приходить клієнту', async ({ page }) => {
  await bookToday(page);
  // Після візиту.
  await page.clock.setFixedTime(new Date(2026, 9, 4, 12, 30));
  await page.reload();
  await page.locator('article').first().getByRole('link', { name: /Напишіть у підтримку CARCAR/ }).click();
  await expect(page.locator('#ticket-form [name="booking"]')).toHaveValue(/.+/);
  await page.getByLabel('Тема').selectOption({ label: 'Якість послуги' });
  await page.getByLabel('Що сталося?').fill('Після шиномонтажу б’ється кермо на швидкості 90');
  await page.getByRole('button', { name: 'Надіслати в підтримку' }).click();
  await expect(page.locator('#toast')).toHaveText('Звернення №1001 створено — відповімо в «Повідомленнях»');
  await expect(page.locator('h1')).toHaveText('Звернення №1001');

  // Точка теж пише в підтримку.
  await page.goto(`${PANEL}#/support`);
  await page.getByLabel('Точка').selectOption({ label: 'Шиномонтаж «Колесо»' });
  await page.getByLabel('Тема').selectOption({ label: 'Виплати й комісія' });
  await page.getByLabel('Опишіть питання').fill('Коли надійде виплата за вересень?');
  await page.getByRole('button', { name: 'Надіслати', exact: true }).click();
  await expect(page.locator('#toast')).toHaveText('Звернення №1002 надіслано в CARCAR');

  await page.goto('/admin.html#/support');
  await expect(page.locator('#nav a[href="#/support"] .count')).toHaveText('2');
  const rows = page.getByRole('region', { name: 'Звернення' }).locator('tbody tr');
  await expect(rows).toHaveCount(2);
  await expect(rows.first()).toContainText('терміново');
  await page.getByRole('link', { name: '№1001' }).click();
  await expect(page.getByRole('region', { name: 'Запис і спір' }).locator('dl')).toContainText('Шиномонтаж «Колесо»');
  await page.getByRole('button', { name: 'Перевести в спір і заморозити гроші' }).click();
  await expect(page.locator('#toast')).toHaveText('Спір відкрито, гроші заморожено');
  await expect(page.locator('#nav a[href="#/disputes"] .count')).toHaveText('1');
  await page.getByLabel('Усе клієнту').check();
  await page.getByLabel('Пояснення рішення').fill('Точка не надала фото балансування');
  await page.getByRole('button', { name: 'Ухвалити рішення' }).click();
  await expect(page.locator('#toast')).toHaveText('Гроші повернено клієнту на баланс');

  await page.goto('/admin.html#/disputes');
  await expect(page.getByRole('region', { name: 'Вирішені спори' })).toContainText('б’ється кермо');

  await page.goto('/');
  await expect(page.locator('#inbox-tab .tab-count')).toHaveText('1');
  await page.locator('#inbox-tab').click();
  await page.getByRole('link', { name: 'Нова відповідь — відкрити' }).click();
  await expect(page.locator('.thread')).toContainText('Рішення за спором: усю суму повернено вам на баланс CARCAR');
  await expect(page.locator('.ticket .pill-s')).toHaveText('Закрито');
  await page.goto('/#/bookings');
  await expect(page.getByRole('region', { name: 'Баланс CARCAR' })).toContainText('900 ₴');
});

test('підтримка: спір клієнта одразу створює звернення, точка додає пояснення', async ({ page }) => {
  await bookToday(page);
  await page.clock.setFixedTime(new Date(2026, 9, 4, 12, 30));
  await page.reload();
  page.once('dialog', (d) => d.accept('Залишили подряпину на диску'));
  await page.locator('article').first().getByRole('button', { name: 'Відкрити спір' }).click();
  await expect(page.locator('article').first().getByRole('link', { name: 'Звернення в підтримку за цим записом' })).toBeVisible();

  await page.goto(`${PANEL}#/schedule`);
  await page.getByLabel('Точка').selectOption({ label: 'Шиномонтаж «Колесо»' });
  await page.locator('.slot-block').first().click();
  await page.getByLabel('Пояснення для модератора').fill('Подряпина була до візиту, є в акті');
  await page.getByRole('button', { name: 'Надіслати модератору' }).click();
  await expect(page.locator('#toast')).toHaveText('Звернення №1002 надіслано в CARCAR');

  await page.goto('/admin.html#/disputes');
  const d = page.getByRole('article', { name: /Спір: Шиномонтаж «Колесо»/ });
  await expect(d).toContainText('№1001 від клієнта');
  await expect(d).toContainText('№1002 від точки');
});

test('антифрод: накрутка відгуків, масові скасування, неявки, промокоди й точка-двійник', async ({ page }) => {
  await page.goto('/admin.html#/fraud');
  await expect(page.getByRole('heading', { name: 'Підозрілого не знайдено' })).toBeVisible();
  await page.getByRole('button', { name: 'Згенерувати демо-сигнали' }).click();
  const cards = page.locator('.fraud-card');
  await expect(page.getByRole('article', { name: 'Сплеск відгуків: Чисто і швидко' })).toContainText('4 відгуки за добу');
  await expect(page.getByRole('article', { name: 'Однаковий текст у різних відгуках' })).toBeVisible();
  await expect(page.getByRole('article', { name: /Відгук із телефону самої точки: Кераміка Про/ })).toBeVisible();
  await expect(page.getByRole('article', { name: /Масові скасування: Вигаданий Скасувальник/ })).toContainText('4 скасувань і неявок');
  await expect(page.getByRole('article', { name: 'Багато неявок у точці: Автодоктор' })).toContainText('60%');
  await expect(page.getByRole('article', { name: /Промокод PERSHA30 кілька разів/ })).toBeVisible();
  const twin = page.getByRole('article', { name: /Підозріла точка: Автомийка «Блиск Плюс»/ });
  await expect(twin).toContainText('телефон збігається з «Автомийка «Блиск»»');
  await expect(twin).toContainText('удвічі нижчі за медіану');
  expect(await cards.count()).toBeGreaterThanOrEqual(7);

  // Дії модератора.
  await page.getByRole('article', { name: 'Однаковий текст у різних відгуках' }).getByRole('button', { name: 'Приховати відгуки' }).click();
  await expect(page.locator('#toast')).toHaveText('Приховано відгуків: 3');
  await twin.getByRole('button', { name: 'Відхилити заявку' }).click();
  await expect(page.locator('#toast')).toHaveText('Заявку точки відхилено');
  await page.getByRole('article', { name: /Масові скасування/ }).getByRole('button', { name: 'Обмежити онлайн-запис' }).click();
  await expect(page.getByText('+380670000099')).toBeVisible();
  await page.getByRole('article', { name: 'Багато неявок у точці: Автодоктор' }).getByRole('button', { name: 'Не порушення' }).click();
  await expect(page.getByRole('article', { name: 'Багато неявок у точці: Автодоктор' })).toHaveCount(0);

  await page.goto('/admin.html#/reviews');
  await page.getByRole('button', { name: /Приховані/ }).click();
  await expect(page.getByText('Приховано: Підозра на накрутку')).toHaveCount(3);

  await page.goto('/admin.html#/fraud');
  await page.getByRole('button', { name: 'Очистити демо' }).click();
  await expect(page.locator('#toast')).toHaveText('Демо-сигнали очищено');
});

test('антифрод: обмежений клієнт не може записатися й пише в підтримку', async ({ page }) => {
  for (const t of ['10:30', '11:00', '11:30']) {
    await bookToday(page, t);
    page.once('dialog', (d) => d.accept());
    await page.locator('article.hl').getByRole('button', { name: /Скасувати/ }).click();
  }
  await page.goto('/admin.html#/fraud');
  const sig = page.getByRole('article', { name: /Масові скасування: клієнт цього пристрою/ });
  await expect(sig).toContainText('3 скасувань і неявок за 14 днів');
  await sig.getByRole('button', { name: 'Обмежити онлайн-запис' }).click();
  await page.goto('/#/book/blysk');
  await expect(page.locator('h1')).toHaveText('Запис обмежено');
  await page.getByRole('link', { name: 'Написати в підтримку' }).click();
  await expect(page.locator('h1')).toHaveText('Підтримка CARCAR');

  await page.goto('/admin.html#/fraud');
  await page.getByRole('button', { name: 'Зняти обмеження' }).click();
  await page.goto('/#/book/blysk');
  await expect(page.locator('h1')).toHaveText('Запис');
});

test('маркетинг: кампанія з посиланням і промокодом, CAC і окупність', async ({ page }) => {
  await page.goto('/admin.html#/marketing');
  await page.getByLabel('Назва', { exact: true }).fill('Instagram осінь');
  await page.getByLabel('Промокод').selectOption('PERSHA30');
  await page.getByLabel('Бюджет, ₴').fill('1000');
  await page.getByRole('button', { name: 'Створити кампанію' }).click();
  await expect(page.locator('#toast')).toHaveText('Кампанію «Instagram осінь» створено — скопіюйте посилання для реклами');
  const link = await page.locator('.link-text').first().textContent();
  expect(link).toContain('index.html?c=instagram-');
  expect(link).toContain('&promo=PERSHA30');

  // Клієнт приходить за посиланням і записується з промокодом кампанії.
  await page.goto(link.replace(/^https?:\/\/[^/]+/, ''));
  await page.goto('/#/book/blysk');
  await page.getByLabel(/Експрес-мийка/).check();
  await page.getByRole('button', { name: /Завтра/ }).click();
  await page.locator('.slot[data-time="10:00"]').click();
  await page.locator('[data-action="confirm"]').click();
  await expect(page.locator('.promo-line')).toContainText('PERSHA30');
  await page.getByRole('button', { name: 'Оплатити 175 ₴' }).click();

  await page.goto('/admin.html#/marketing');
  const row = page.getByRole('region', { name: 'Кампанії' }).locator('tr', { hasText: 'Instagram осінь' });
  // Перехід 1, замовлення 1, новий клієнт 1, витрати 1000 + 75 = 1075.
  await expect(row.locator('td').nth(1)).toHaveText('1');
  await expect(row.locator('td').nth(3)).toHaveText('1');
  await expect(row.locator('td').nth(5)).toHaveText(/1\s075 ₴/);
  await expect(row).toContainText('Збиткова');

  await page.getByRole('button', { name: 'Згенерувати демо-кампанії' }).click();
  await expect(page.getByRole('region', { name: 'Кампанії' }).locator('tbody tr')).toHaveCount(5);
  await expect(page.getByRole('region', { name: 'Кампанії' }).locator('tr', { hasText: 'Партнери: шиномонтаж' })).toContainText('Окупається');
  await expect(page.getByRole('region', { name: 'Кампанії' }).locator('tr', { hasText: 'TikTok' })).toContainText('Збиткова');
  await page.getByLabel('Замовлень одного клієнта за рік').fill('12');
  await page.getByRole('button', { name: 'Зберегти', exact: true }).click();
  await expect(page.locator('#toast')).toHaveText('Припущення збережено');
  await page.getByRole('button', { name: 'Очистити демо' }).click();
  await expect(page.getByRole('region', { name: 'Кампанії' }).locator('tbody tr')).toHaveCount(1);
});

const PAGES = {
  'адмінка: підтримка': async (page) => {
    await bookToday(page);
    await page.goto('/#/support');
    await page.getByLabel('Що сталося?').fill('Питання щодо оплати');
    await page.getByRole('button', { name: 'Надіслати в підтримку' }).click();
    await page.goto('/admin.html#/support');
    await page.getByRole('link', { name: '№1001' }).click();
  },
  'адмінка: антифрод': async (page) => { await page.goto('/admin.html#/fraud'); await page.getByRole('button', { name: 'Згенерувати демо-сигнали' }).click(); },
  'адмінка: маркетинг': async (page) => { await page.goto('/admin.html#/marketing'); await page.getByRole('button', { name: 'Згенерувати демо-кампанії' }).click(); },
  'клієнт: підтримка': async (page) => {
    await page.goto('/#/support');
    await page.getByLabel('Що сталося?').fill('Питання');
    await page.getByRole('button', { name: 'Надіслати в підтримку' }).click();
    await page.goto('/#/support');
  },
  'панель: підтримка': async (page) => { await page.goto(`${PANEL}#/support`); },
};

for (const [name, setup] of Object.entries(PAGES)) {
  test(`доступність і верстка: ${name}`, async ({ page }) => {
    await setup(page);
    await page.locator('h1').first().waitFor();
    const { violations } = await new AxeBuilder({ page }).analyze();
    expect(violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target).join(', ')}`)).toEqual([]);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow).toBeLessThanOrEqual(0);
  });
}

test.describe('анімації', () => {
  test.use({ contextOptions: { reducedMotion: 'no-preference' } });
  test('сторінка зʼявляється плавно, показники «набігають» до точного значення', async ({ page }) => {
    await page.goto('/admin.html#/marketing');
    await page.getByRole('button', { name: 'Згенерувати демо-кампанії' }).click();
    await page.goto('/admin.html#/support');
    await page.goto('/admin.html#/marketing');
    await expect(page.locator('#view')).toHaveClass(/view-enter/);
    const animations = await page.evaluate(() => document.getAnimations().length);
    expect(animations).toBeGreaterThan(0);
    const value = page.locator('.kpi .value').nth(1);
    const final = await page.evaluate(() => {
      const n = JSON.parse(localStorage.getItem('carcar.admin.campaignDemo')).filter((x) => x.newClient).length;
      return String(n);
    });
    await expect(value).toHaveText(final);
    await expect(page.locator('#view')).not.toHaveClass(/view-enter/, { timeout: 2000 });
  });
});

test('без анімацій, якщо людина просить зменшити рух', async ({ page }) => {
  await page.goto('/#/garage');
  await page.goto('/#/bookings');
  await expect(page.locator('#view')).not.toHaveClass(/view-enter/);
});
