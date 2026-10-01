import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { readFileSync, statSync } from 'node:fs';
import { checkParity, loadDicts } from '../build.mjs';

const D = {
  en: JSON.parse(readFileSync(new URL('../src/i18n/en.json', import.meta.url), 'utf8')),
  uk: JSON.parse(readFileSync(new URL('../src/i18n/uk.json', import.meta.url), 'utf8')),
};
const PAGES = { en: '/', uk: '/uk/index.html' };
const LANGS = ['en', 'uk'];
const fmt = (s, vars) => s.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m));

// Fails the test on script errors and on any broken request to our own server.
function watchErrors(page) {
  const problems = [];
  page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() !== 'error') return;
    const url = m.location().url || '';
    if (/fonts\.(googleapis|gstatic)\.com/.test(url)) return;
    problems.push(`console: ${m.text()}`);
  });
  page.on('requestfailed', (r) => {
    if (new URL(r.url()).hostname === 'localhost') problems.push(`failed: ${r.url()}`);
  });
  page.on('response', (r) => {
    if (new URL(r.url()).hostname === 'localhost' && r.status() >= 400) problems.push(`${r.status()}: ${r.url()}`);
  });
  return problems;
}

const desktopOnly = (testInfo) => test.skip(testInfo.project.name !== 'desktop', 'covered by the desktop run');

test.describe('translations', () => {
  test('both languages have the same keys and structure', () => {
    expect(checkParity(loadDicts())).toEqual([]);
  });

  test('every Ukrainian string is actually translated', () => {
    const same = [];
    const allowed = /^(iPhone|Android|Belong\+|Belong|© \d{4} Belong)$/;
    const walk = (en, uk, path) => {
      if (typeof en === 'string') {
        if (en === uk && /[A-Za-z]{3,}/.test(en) && !allowed.test(en) && !/\.(w|id|zone)$/.test(path)) same.push(path);
        return;
      }
      if (en && typeof en === 'object') for (const k of Object.keys(en)) walk(en[k], uk[k], `${path}.${k}`);
    };
    walk(D.en, D.uk, '');
    expect(same).toEqual([]);
  });
});

for (const lang of LANGS) {
  const dict = D[lang];
  const other = lang === 'en' ? 'uk' : 'en';

  test.describe(`${lang} page`, () => {
    test('renders translated content and metadata', async ({ page }) => {
      await page.goto(PAGES[lang]);
      await expect(page.locator('html')).toHaveAttribute('lang', lang);
      await expect(page).toHaveTitle(dict.meta.title);
      await expect(page.locator('h1')).toHaveCount(1);
      await expect(page.locator('h1')).toHaveText(dict.hero.title);
      await expect(page.locator('meta[name="description"]')).toHaveAttribute('content', dict.meta.description);
      await expect(page.locator('link[hreflang="en"]')).toHaveAttribute('href', /\/$/);
      await expect(page.locator('link[hreflang="uk"]')).toHaveAttribute('href', /\/uk\/$/);
      await expect(page.locator('link[hreflang="x-default"]')).toHaveCount(1);
      await expect(page.locator('meta[property="og:locale"]')).toHaveAttribute('content', dict.meta.ogLocale);
      expect(await page.content()).not.toContain('{{');
    });

    test('language switch opens the other language', async ({ page }) => {
      await page.goto(PAGES[lang]);
      await page.locator('#lang-switch').click();
      await expect(page.locator('html')).toHaveAttribute('lang', other);
      await expect(page.locator('h1')).toHaveText(D[other].hero.title);
    });

    test('loads without script errors or missing files', async ({ page }) => {
      const problems = watchErrors(page);
      await page.goto(PAGES[lang], { waitUntil: 'networkidle' });
      await page.locator('#faq').scrollIntoViewIfNeeded();
      expect(problems).toEqual([]);
    });

    test('in-page links point at existing sections', async ({ page }) => {
      await page.goto(PAGES[lang]);
      const hrefs = await page.locator('a[href^="#"]').evaluateAll((as) => as.map((a) => a.getAttribute('href')));
      expect(hrefs.length).toBeGreaterThan(5);
      for (const href of new Set(hrefs)) await expect(page.locator(href), href).toHaveCount(1);
    });

    test('never scrolls sideways, in light and dark', async ({ page }, testInfo) => {
      desktopOnly(testInfo);
      for (const scheme of ['light', 'dark']) {
        await page.emulateMedia({ colorScheme: scheme });
        for (const width of [320, 360, 390, 430, 768, 1024, 1280, 1600]) {
          await page.setViewportSize({ width, height: 900 });
          await page.goto(PAGES[lang]);
          const [scroll, client] = await page.evaluate(() => [document.documentElement.scrollWidth, document.documentElement.clientWidth]);
          expect(scroll, `${scheme} ${width}px`).toBeLessThanOrEqual(client);
        }
      }
    });

    test('dark mode switches the palette', async ({ page }) => {
      await page.emulateMedia({ colorScheme: 'dark' });
      await page.goto(PAGES[lang]);
      await expect(page.locator('body')).toHaveCSS('background-color', 'rgb(28, 22, 34)');
      await page.emulateMedia({ colorScheme: 'light' });
      await expect(page.locator('body')).toHaveCSS('background-color', 'rgb(255, 248, 243)');
    });

    for (const scheme of ['light', 'dark']) {
      test(`has no serious accessibility violations (${scheme})`, async ({ page }) => {
        await page.emulateMedia({ colorScheme: scheme, reducedMotion: 'reduce' });
        await page.goto(PAGES[lang], { waitUntil: 'networkidle' });
        const { violations } = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
        const serious = violations
          .filter((v) => ['serious', 'critical'].includes(v.impact))
          .map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`);
        expect(serious).toEqual([]);
      });
    }
  });
}

// ---------- Date Match ----------
async function swipe(page, pattern, M = D.en.runtime.match) {
  expect(pattern.length).toBe(M.cards.length);
  for (let i = 0; i < pattern.length; i += 1) {
    await page.locator(`#match [data-act="${pattern[i] === '1' ? 'yes' : 'no'}"]`).click();
    if (i < pattern.length - 1) {
      await expect(page.locator('#match .game__count')).toHaveText(fmt(M.progress, { i: i + 2, n: M.cards.length }));
    }
  }
}
const expectedMatches = (cards, a, b) => cards.filter((_, i) => a[i] === '1' && b[i] === '1').map((c) => `${c.e}${c.t}`);
const A = '1101100101';
const B = '1001110100';

test.describe('Date Match', () => {
  test.use({ reducedMotion: 'reduce' });

  for (const lang of LANGS) {
    const M = D[lang].runtime.match;
    test(`${lang}: two partners on one phone see only their mutual yeses`, async ({ page }) => {
      await page.goto(PAGES[lang]);
      await page.fill('#match-name-a', 'Yulia');
      await page.locator('#match [data-act="start-a"]').click();
      await expect(page.locator('#match .game__count')).toHaveText(fmt(M.progress, { i: 1, n: 10 }));
      await swipe(page, A, M);

      await expect(page.locator('#match .game__title')).toHaveText(fmt(M.handoffTitle, { name: 'Yulia' }));
      await page.fill('#match-name-b', 'Igor');
      await page.locator('#match [data-act="start-b"]').click();
      await swipe(page, B, M);

      const want = expectedMatches(M.cards, A, B);
      await expect(page.locator('#match .game__title')).toHaveText(fmt(M.resultTitle, { k: want.length, n: 10 }));
      await expect(page.locator('#match .result__list li')).toHaveText(want);
      await expect(page.locator('#match .result__names')).toHaveText('Yulia & Igor');
    });
  }

  test('asks for a name before starting', async ({ page }) => {
    const M = D.en.runtime.match;
    await page.goto('/');
    await page.locator('#match [data-act="start-a"]').click();
    await expect(page.locator('#match-name-a-err')).toHaveText(M.nameRequired);
    await expect(page.locator('#match-name-a')).toHaveAttribute('aria-invalid', 'true');
    await expect(page.locator('#match-name-a')).toBeFocused();
    await page.fill('#match-name-a', 'Yulia');
    await expect(page.locator('#match-name-a-err')).toBeHidden();
  });

  test('arrow keys answer the cards', async ({ page }) => {
    await page.goto('/');
    await page.fill('#match-name-a', 'Yulia');
    await page.locator('#match [data-act="start-a"]').click();
    await expect(page.locator('#match [data-deck]')).toBeFocused();
    for (let i = 0; i < 10; i += 1) {
      await page.keyboard.press(i % 2 ? 'ArrowLeft' : 'ArrowRight');
      if (i < 9) await expect(page.locator('#match .game__count')).toHaveText(`${i + 2} of 10`);
    }
    await expect(page.locator('#match-name-b')).toBeVisible();
    await expect(page.locator('#match-status')).not.toBeEmpty();
  });

  test('a link carries the game to the partner and the results back', async ({ page, context }) => {
    test.setTimeout(90000); // three pages and twenty swipes
    const M = D.en.runtime.match;
    await page.goto('/');
    await page.fill('#match-name-a', 'Yulia');
    await page.locator('#match [data-act="start-a"]').click();
    await swipe(page, A);
    const invite = await page.locator('#match-link').inputValue();
    expect(invite).toBe(`http://localhost:4173/#v=1&match=${A}&from=Yulia`);
    await expect(page.locator('#match .sharerow a[href*="t.me/share"]')).toHaveAttribute('href', new RegExp(encodeURIComponent(invite).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));

    const partner = await context.newPage();
    await partner.goto(invite);
    await expect(partner.locator('#match .game__title')).toHaveText(fmt(M.invitedTitle, { name: 'Yulia' }));
    await partner.locator('#match [data-act="start-b"]').click();
    await expect(partner.locator('#match-name-b-err')).toHaveText(M.yourNameRequired);
    await partner.fill('#match-name-b', 'Igor');
    await partner.locator('#match [data-act="start-b"]').click();
    await swipe(partner, B);
    const want = expectedMatches(M.cards, A, B);
    await expect(partner.locator('#match .result__list li')).toHaveText(want);
    const reply = await partner.locator('#match-link').inputValue();
    expect(reply).toBe(`http://localhost:4173/#v=1&match=${A}&from=Yulia&reply=${B}&to=Igor`);

    const back = await context.newPage();
    await back.goto(reply);
    await expect(back.locator('#match .result__list li')).toHaveText(want);
    await expect(back.locator('#match .result__names')).toHaveText('Yulia & Igor');
    await expect(back.locator('#match-link')).toHaveCount(0);

    await back.locator('#match [data-act="again"]').click();
    await expect(back.locator('#match-name-a')).toBeVisible();
    expect(new URL(back.url()).hash).toBe('');
  });

  test('ignores broken links and never renders names as HTML', async ({ context }) => {
    const broken = await context.newPage();
    await broken.goto('/#v=1&match=101&from=Yulia');
    await expect(broken.locator('#match-name-a')).toBeVisible();

    const hostile = await context.newPage();
    const name = '<img src=x onerror=window.__xss=1>';
    await hostile.goto(`/#v=1&match=1111111111&from=${encodeURIComponent(name)}`);
    await expect(hostile.locator('#match .game__title')).toContainText('<img');
    await expect(hostile.locator('#match img')).toHaveCount(0);
    expect(await hostile.evaluate(() => window.__xss)).toBeUndefined();
  });

  test('saves a story card as a PNG', async ({ page }) => {
    await page.goto('/');
    await page.fill('#match-name-a', 'Yulia');
    await page.locator('#match [data-act="start-a"]').click();
    await swipe(page, A);
    await page.fill('#match-name-b', 'Igor');
    await page.locator('#match [data-act="start-b"]').click();
    await swipe(page, B);
    const [download] = await Promise.all([page.waitForEvent('download'), page.locator('#match [data-act="story"]').click()]);
    expect(download.suggestedFilename()).toBe('belong-date-match.png');
    const file = await download.path();
    expect(statSync(file).size).toBeGreaterThan(20000);
    expect(readFileSync(file).subarray(1, 4).toString()).toBe('PNG');
    await expect(page.locator('#match-note')).toHaveText(D.en.runtime.match.storySaved);
  });
});

test.describe('Date Match with animation', () => {
  test('dragging the card answers it', async ({ page }, testInfo) => {
    desktopOnly(testInfo);
    await page.goto('/');
    await page.fill('#match-name-a', 'Yulia');
    await page.locator('#match [data-act="start-a"]').click();
    const drag = async (dx) => {
      const box = await page.locator('#match [data-top]').boundingBox();
      const x = box.x + box.width / 2;
      const y = box.y + box.height / 2;
      await page.mouse.move(x, y);
      await page.mouse.down();
      await page.mouse.move(x + dx, y, { steps: 8 });
      await page.mouse.up();
    };
    await drag(40); // too short: the card springs back
    await page.waitForTimeout(350);
    await expect(page.locator('#match .game__count')).toHaveText('1 of 10');
    await drag(220);
    await expect(page.locator('#match .game__count')).toHaveText('2 of 10');
    await drag(-220);
    await expect(page.locator('#match .game__count')).toHaveText('3 of 10');
  });
});

// ---------- Date wheel ----------
test.describe('Date wheel', () => {
  test('picks an idea that fits the filters', async ({ page }) => {
    const W = D.en.runtime.wheel;
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('/');
    await page.locator('#wheel-place [data-place="out"]').click();
    await page.locator('#wheel-budget [data-budget="0"]').click();
    const pool = W.ideas.filter((i) => i.w === 'out' && i.b <= 0);
    const labels = await page.locator('#wheel .wheel__label').allTextContents();
    expect(labels.length).toBe(Math.min(8, pool.length));
    for (const l of labels) expect(pool.map((i) => i.s)).toContain(l);

    await page.locator('#wheel-spin').click();
    await expect(page.locator('#wheel-result')).toBeVisible();
    const title = await page.locator('#wheel-result-title').textContent();
    expect(pool.map((i) => i.t)).toContain(title);
    await expect(page.locator('#wheel-result-meta')).toHaveText(`${W.out} · ${W.budgetNames[0]}`);
  });

  test('spins with animation and lands on a sector', async ({ page }) => {
    await page.goto('/uk/index.html');
    await page.locator('#wheel-spin').click();
    await expect(page.locator('#wheel-spin')).toBeDisabled();
    await expect(page.locator('#wheel-result')).toBeVisible({ timeout: 6000 });
    const ideas = D.uk.runtime.wheel.ideas.map((i) => i.t);
    expect(ideas).toContain(await page.locator('#wheel-result-title').textContent());
  });
});

// ---------- Widgets demo ----------
test.describe('Widgets demo', () => {
  test('a drawing lands on the partner’s home-screen widget', async ({ page }) => {
    const T = D.en.runtime.wid;
    await page.goto('/');
    const img = page.locator('#hw-doodle-img');
    await expect(img).toHaveAttribute('src', /^data:image\/png/);
    const before = await img.getAttribute('src');

    await page.locator('#pad-send').click();
    await expect(page.locator('#pad-note')).toHaveText(T.empty);

    await page.locator('#pad-colors .swatch[data-color="#5C9DF2"]').click();
    await expect(page.locator('#pad-colors .swatch[data-color="#5C9DF2"]')).toHaveAttribute('aria-pressed', 'true');
    const pad = page.locator('#pad');
    await pad.scrollIntoViewIfNeeded();
    const box = await pad.boundingBox();
    await page.mouse.move(box.x + box.width * 0.2, box.y + box.height * 0.3);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * 0.8, box.y + box.height * 0.7, { steps: 10 });
    await page.mouse.up();
    await expect(page.locator('#pad-hint')).toHaveClass(/is-hidden/);

    await page.locator('#pad-send').click();
    await expect(page.locator('#pad-note')).toHaveText(T.sent);
    await expect(page.locator('#hw-doodle-from')).toHaveText(T.from);
    const after = await img.getAttribute('src');
    expect(after).not.toBe(before);
    // The sent drawing contains blue ink.
    const hasBlue = await page.evaluate(async (src) => {
      const im = new Image();
      im.src = src;
      await im.decode();
      const c = document.createElement('canvas');
      c.width = im.width;
      c.height = im.height;
      const g = c.getContext('2d');
      g.drawImage(im, 0, 0);
      const data = g.getImageData(0, 0, c.width, c.height).data;
      for (let i = 0; i < data.length; i += 4) if (data[i + 2] > 200 && data[i] < 120) return true;
      return false;
    }, after);
    expect(hasBlue).toBe(true);
    await expect(page.locator('#pad-hint')).not.toHaveClass(/is-hidden/);
  });
});

// ---------- Our month apart ----------
test.describe('Monthly recap', () => {
  for (const lang of LANGS) {
    test(`${lang}: the story card follows the couple’s names and cities`, async ({ page }) => {
      const M = D[lang].runtime.month;
      await page.goto(PAGES[lang]);
      await expect(page.locator('#story-names')).toHaveText(fmt(M.namesTpl, { a: M.defaultMe, b: M.defaultPartner }));
      const title = await page.locator('#story-title').textContent();
      expect(title.startsWith(M.titleTpl.split('{month}')[0])).toBe(true);
      expect(title).not.toContain('{month}');
      await expect(page.locator('#story-km')).toHaveText(/^7.560$/);
      await expect(page.locator('#story-hours')).toHaveText(new RegExp(`^${fmt(M.hoursTpl, { h: '(6|7)' })}$`));

      await page.fill('#month-me', 'Oksana');
      await page.fill('#month-partner', 'Taras');
      await expect(page.locator('#story-names')).toHaveText(fmt(M.namesTpl, { a: 'Oksana', b: 'Taras' }));
      await page.selectOption('#month-city-me', 'kyiv');
      await page.selectOption('#month-city-partner', 'london');
      await expect(page.locator('#story-km')).toHaveText(/^2.130$/);
      await page.selectOption('#month-city-partner', 'lviv');
      await expect(page.locator('#story-hours')).toHaveText(M.sameZone);
    });
  }

  test('saves the month story card as a PNG', async ({ page }) => {
    await page.goto('/uk/index.html');
    const [download] = await Promise.all([page.waitForEvent('download'), page.locator('#month-save').click()]);
    expect(download.suggestedFilename()).toBe('belong-our-month.png');
    const file = await download.path();
    expect(statSync(file).size).toBeGreaterThan(20000);
    expect(readFileSync(file).subarray(1, 4).toString()).toBe('PNG');
    await expect(page.locator('#month-note')).toHaveText(D.uk.runtime.month.saved);
  });
});

// ---------- Waitlist ----------
test.describe('Waitlist', () => {
  const T = D.en.runtime.wl;

  test('explains what is wrong with the emails', async ({ page }) => {
    await page.goto('/');
    await page.locator('#wl-submit').click();
    await expect(page.locator('#wl-email-err')).toHaveText(T.errEmail);
    await expect(page.locator('#wl-email')).toHaveAttribute('aria-invalid', 'true');
    await expect(page.locator('#wl-email')).toBeFocused();

    await page.fill('#wl-email', 'anya@example.com');
    await expect(page.locator('#wl-email-err')).toBeHidden();
    await page.fill('#wl-partner', 'not-an-email');
    await page.locator('#wl-submit').click();
    await expect(page.locator('#wl-partner-err')).toHaveText(T.errPartner);

    await page.fill('#wl-partner', 'ANYA@example.com');
    await page.locator('#wl-submit').click();
    await expect(page.locator('#wl-partner-err')).toHaveText(T.errSame);
    await expect(page.locator('#wl-success')).toBeHidden();
  });

  test('joins as a couple and gets a referral link', async ({ page }) => {
    await page.goto('/?ref=abc1234');
    await page.fill('#wl-email', 'anya@example.com');
    await page.fill('#wl-partner', 'max@example.com');
    await page.locator('label[for="wl-android"]').click();
    await page.locator('#wl-submit').click();
    await expect(page.locator('#wl-success')).toBeVisible();
    await expect(page.locator('#wl-form')).toBeHidden();
    await expect(page.locator('#wl-ok-partner')).toHaveText(fmt(T.okPartner, { email: 'max@example.com' }));
    await expect(page.locator('#wl-ref')).toHaveValue(/^http:\/\/localhost:4173\/\?ref=[a-z0-9]{7}$/);
    await expect(page.locator('#wl-share a')).toHaveCount(3);
    const saved = JSON.parse(await page.evaluate(() => localStorage.getItem('belong-waitlist')));
    expect(saved).toMatchObject({ email: 'anya@example.com', partner: 'max@example.com', platform: 'android', lang: 'en', ref: 'abc1234' });
  });

  test('posts to the configured endpoint and reports failures', async ({ page }) => {
    let body = null;
    let status = 500;
    await page.route('https://api.example.test/waitlist', async (route) => {
      body = route.request().postDataJSON();
      await route.fulfill({ status, body: '{}', headers: { 'access-control-allow-origin': '*' } });
    });
    await page.goto('/uk/index.html');
    await page.evaluate(() => { document.getElementById('wl-form').dataset.endpoint = 'https://api.example.test/waitlist'; });
    await page.fill('#wl-email', 'anya@example.com');
    await page.locator('#wl-submit').click();
    await expect(page.locator('#wl-form-err')).toHaveText(D.uk.runtime.wl.errNetwork);
    await expect(page.locator('#wl-form')).toBeVisible();
    expect(body).toMatchObject({ email: 'anya@example.com', partner: null, platform: 'ios', lang: 'uk' });

    status = 200;
    await page.locator('#wl-submit').click();
    await expect(page.locator('#wl-success')).toBeVisible();
  });
});

// ---------- A day with Belong ----------
test.describe('Day demos', () => {
  test('mood, plan, gratitude, weekly talk and distance widgets respond', async ({ page }) => {
    const day = D.en.day;
    const rt = D.en.runtime.day;
    await page.goto('/');

    await page.locator('#moods .mood[data-energy="2"]').click();
    await expect(page.locator('#moods .mood[data-energy="2"]')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('#moods [aria-pressed="true"]')).toHaveCount(1);
    await expect(page.locator('#mood-note')).toHaveText(fmt(rt.moodNote, { mood: '😕', energy: 2 }));

    await page.locator('#plan-seg [data-owner="ours"]').click();
    await expect(page.locator('#plan-list li:visible')).toHaveText([new RegExp(day.ours1), new RegExp(day.ours2)]);
    await page.locator('#plan-seg [data-owner="his"]').click();
    await expect(page.locator('#plan-list li:visible')).toHaveText([new RegExp(day.his1), new RegExp(day.his2)]);

    await expect(page.locator('#gratitude')).toHaveValue('Thank you for making breakfast and making me laugh.');
    await page.locator('#gratitude-chips .chip').nth(1).click();
    await expect(page.locator('#gratitude')).toHaveValue('Thank you for making breakfast, having my back, and making me laugh.');
    await page.fill('#gratitude', 'My own words');
    await page.locator('#gratitude-chips .chip').nth(0).click();
    await expect(page.locator('#gratitude')).toHaveValue('My own words');
    await page.locator('#gratitude-send').click();
    await expect(page.locator('#gratitude-note')).toHaveText(rt.gratitudeSent);

    await expect(page.locator('#talk-q')).toHaveText(rt.talk[0][0]);
    await page.locator('#talk-next').click();
    await page.locator('#talk-skip').click();
    await expect(page.locator('#talk-q')).toHaveText(rt.talk[2][0]);
    await expect(page.locator('#talk-next')).toHaveText(rt.talkDone);
    await page.locator('#talk-next').click();
    await expect(page.locator('#talk-progress')).toHaveText('1 of 3');

    await page.locator('#think-btn').click();
    await expect(page.locator('#think-note')).toHaveText(rt.thinkSent);

    await expect(page.locator('#clock-a')).toHaveText(/^\d{1,2}:\d{2}/);
    await expect(page.locator('#clock-diff')).toHaveText(/^\d+(\.5)? h apart$/);
    await page.locator('#safe-btn').click();
    await expect(page.locator('#safe-note')).toContainText('Yulia is safe');
  });
});

// ---------- Language suggestion ----------
test.describe('Language banner for Ukrainian browsers', () => {
  test.use({ locale: 'uk-UA' });

  test('suggests the Ukrainian page and remembers when closed', async ({ page }) => {
    await page.goto('/');
    const banner = page.locator('#lang-banner');
    await expect(banner).toBeVisible();
    await expect(banner).toHaveAttribute('lang', 'uk');
    await expect(page.locator('#lang-banner-link')).toHaveAttribute('href', './uk/index.html');
    await page.locator('#lang-banner-close').click();
    await expect(banner).toBeHidden();
    await page.reload();
    await expect(banner).toBeHidden();
  });

  test('does not show the banner on the Ukrainian page', async ({ page }) => {
    await page.goto('/uk/index.html');
    await expect(page.locator('#lang-banner')).toBeHidden();
  });
});

test.describe('Language banner for other browsers', () => {
  test.use({ locale: 'en-US' });
  test('stays hidden', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('#lang-banner')).toBeHidden();
  });
});
