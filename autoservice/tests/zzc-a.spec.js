import { test, expect } from '@playwright/test';
import { startServer, device, client, SHOT } from './zzc-lib.js';
test.describe.configure({ mode: 'serial' });
let S;
test.beforeAll(async () => { S = await startServer(5600); });
test.afterAll(() => S?.server.kill());
const wide = (p) => p.evaluate(() => { const out = []; for (const el of document.querySelectorAll('body *')) { const r = el.getBoundingClientRect(); if (r.right > 391 && r.width > 0 && getComputedStyle(el).position !== 'fixed') out.push(`${el.tagName}.${el.className}#${el.id} ${Math.round(r.left)}-${Math.round(r.right)}`); } return { iw: innerWidth, sw: document.documentElement.scrollWidth, out: out.slice(0, 12) }; });
test('login layout', async ({ browser }) => {
  const p = await device(browser, S.base, () => sessionStorage.setItem('carcar.splash', '1'), null, {});
  await p.goto('/');
  await p.waitForTimeout(1000);
  console.log('LOGIN', JSON.stringify(await wide(p)));
  const c = await client(browser, S.base, '+380 67 111 11 11', 'Ірина');
  for (const h of ['/', '/#/place/blysk', '/#/book/blysk', '/#/bookings', '/#/inbox', '/#/garage', '/#/wallet', '/#/support', '/#/invite']) {
    await c.goto(h); await c.waitForTimeout(700);
    console.log(h, JSON.stringify(await wide(c)));
  }
  console.log(c.errors);
});
