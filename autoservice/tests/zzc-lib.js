import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
export const SHOT = '/tmp/claude-0/-home-user-Belong/84350dd0-4a17-561f-9c37-32f6d1d43256/scratchpad/qa2-client/';
export async function startServer(port, dbDir) {
  const dir = dbDir ?? mkdtempSync(join(tmpdir(), 'zzc-'));
  const db = join(dir, 'd.db');
  const server = spawn('python3', ['../deploy/server/carcar_sync.py', '--port', String(port), '--db', db, '--static', 'app'], { stdio: 'pipe' });
  server.stderr.on('data', (d) => { if (process.env.ZZV) process.stdout.write('[srv] ' + d); });
  await new Promise((ok, no) => {
    server.stdout.on('data', (d) => String(d).includes('CARCAR sync') && ok());
    server.on('exit', (code) => no(new Error(`sync server exited ${code}`)));
  });
  return { server, base: `http://127.0.0.1:${port}`, dir };
}
export async function token(base, path, body) {
  const r = await fetch(`${base}/api/auth/${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  return (await r.json()).token;
}
export async function device(browser, base, init, arg, opts = {}) {
  const ctx = opts.ctx ?? await browser.newContext({ baseURL: base, locale: 'uk-UA', reducedMotion: opts.motion ?? 'reduce', viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, permissions: opts.permissions ?? [] });
  if (init) await ctx.addInitScript(init, arg);
  const page = await ctx.newPage();
  if (opts.time) await page.clock.setFixedTime(opts.time);
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  page.errors = errors;
  page.ctx = ctx;
  return page;
}
export const client = async (browser, base, phone, name, opts) => device(browser, base, ([p, n, t]) => {
  sessionStorage.setItem('carcar.splash', '1');
  localStorage.getItem('carcar.auth') ?? localStorage.setItem('carcar.auth', JSON.stringify({ phone: p, at: 1 }));
  localStorage.getItem('carcar.profile') ?? localStorage.setItem('carcar.profile', JSON.stringify({ name: n, phone: p }));
  localStorage.getItem('carcar.auth.token') ?? localStorage.setItem('carcar.auth.token', JSON.stringify(t));
}, [phone, name, await token(base, 'demo', { phone })], opts);
export const wash = async (browser, base, opts) => device(browser, base, (t) => {
  localStorage.getItem('carcar.biz.session') ?? localStorage.setItem('carcar.biz.session', '{"demo":true}');
  localStorage.getItem('carcar.partner') ?? localStorage.setItem('carcar.partner', '"blysk"');
  localStorage.getItem('carcar.biz.token') ?? localStorage.setItem('carcar.biz.token', JSON.stringify(t));
}, await token(base, 'biz', { demo: true }), opts);
