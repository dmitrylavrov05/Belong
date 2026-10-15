import { test, expect } from '@playwright/test';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Оплата карткою через LiqPay на сервері CARCAR: запис чекає оплати, банк підтверджує підписаною відповіддю,
// лише тоді запис іде мийці. Сторінку банку підміняємо — справжніх платежів у тестах немає.
test.describe.configure({ mode: 'serial' });

let server;
let base;
const PRIV = 'test-private';

test.beforeAll(async ({}, info) => {
  const port = 5350 + info.workerIndex + (info.project.name === 'mobile' ? 20 : 0);
  const dir = mkdtempSync(join(tmpdir(), 'carcar-pay-'));
  writeFileSync(join(dir, 'config.json'), JSON.stringify({ liqpay: { public_key: 'test-public', private_key: PRIV, sandbox: true } }));
  server = spawn('python3', ['../deploy/server/carcar_sync.py', '--port', String(port), '--db', join(dir, 'data.db'), '--static', 'app',
    '--config', join(dir, 'config.json'), '--public-url', `http://127.0.0.1:${port}`], { stdio: 'pipe' });
  await new Promise((ok, no) => {
    server.stdout.on('data', (d) => String(d).includes('CARCAR sync') && ok());
    server.on('exit', (code) => no(new Error(`server exited ${code}`)));
  });
  base = `http://127.0.0.1:${port}`;
});

test.afterAll(() => server?.kill());

test('оплата карткою: запис чекає оплати → банк підтверджує → чекає підтвердження мийки', async ({ browser }) => {
  const t = await (await fetch(`${base}/api/auth/demo`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"phone":"+380671111111"}' })).json();
  const ctx = await browser.newContext({ baseURL: base, locale: 'uk-UA', reducedMotion: 'reduce' });
  await ctx.addInitScript((tok) => {
    sessionStorage.setItem('carcar.splash', '1');
    localStorage.getItem('carcar.auth') ?? localStorage.setItem('carcar.auth', JSON.stringify({ phone: '+380 67 111 11 11', at: 1 }));
    localStorage.getItem('carcar.profile') ?? localStorage.setItem('carcar.profile', JSON.stringify({ name: 'Ірина', phone: '+380 67 111 11 11' }));
    localStorage.getItem('carcar.auth.token') ?? localStorage.setItem('carcar.auth.token', JSON.stringify(tok));
  }, t.token);
  const page = await ctx.newPage();
  await page.clock.setFixedTime(new Date(2026, 9, 4, 10, 0));
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  let form = null;
  await page.route('https://www.liqpay.ua/**', async (route) => {
    form = new URLSearchParams(route.request().postData());
    await route.fulfill({ contentType: 'text/html', body: '<h1>LiqPay</h1>' });
  });

  await page.goto('/#/book/blysk');
  await page.getByLabel(/Експрес-мийка кузова/).check();
  await page.locator('[data-action="to-time"]').click();
  await page.getByRole('button', { name: /Завтра/ }).click();
  await page.locator('.slot[data-time="10:00"]').click();
  await page.locator('[data-action="confirm"]').click();
  await page.getByRole('button', { name: /^Оплатити/ }).click();
  await expect(page.locator('h1')).toHaveText('LiqPay');
  const data = JSON.parse(Buffer.from(form.get('data'), 'base64').toString());
  expect(data).toMatchObject({ action: 'pay', currency: 'UAH', public_key: 'test-public', sandbox: 1 });
  expect(form.get('signature')).toBe(createHash('sha1').update(PRIV + form.get('data') + PRIV).digest('base64'));

  // Повернулися без оплати: запис тримає час і пропонує оплатити.
  await page.goto(`/#/bookings/${data.order_id}`);
  const card = page.locator('article.bk').first();
  await expect(card).toContainText('Оплата не завершена');
  await expect(card.getByRole('button', { name: /Оплатити/ })).toBeVisible();

  // Банк надсилає підписане підтвердження — запис іде мийці.
  const cb = Buffer.from(JSON.stringify({ order_id: data.order_id, status: 'sandbox', amount: data.amount, payment_id: 1 })).toString('base64');
  const sig = createHash('sha1').update(PRIV + cb + PRIV).digest('base64');
  const r = await fetch(`${base}/api/pay/liqpay/callback`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ data: cb, signature: sig }) });
  expect(r.status).toBe(200);
  await expect(card).toContainText('Чекаємо підтвердження мийки', { timeout: 15000 });
  expect(errors).toEqual([]);
});
