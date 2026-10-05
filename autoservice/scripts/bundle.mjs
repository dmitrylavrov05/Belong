// Збирає застосунок клієнта, панель для бізнесу й адмінку CARCAR в окремі HTML-файли без зовнішніх залежностей:
// стилі, шрифти, дані й логіка всередині. Такі файли зручно завантажити в Claude Design
// або відкрити просто з диска.
// node scripts/bundle.mjs [тека для результату, типово design]
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const app = (f) => readFileSync(new URL(`../app/${f}`, import.meta.url), 'utf8');
const outDir = process.argv[2] || 'design';

// Модулі склеюємо в один скрипт: прибираємо import (і багаторядкові теж) та export.
const stripModule = (code) => code
  .replace(/^import [\s\S]*? from '\.\/[\w.]+';\n/gm, '')
  .replace(/^export /gm, '');

// Шрифти вшиваємо в CSS як data:-адреси, щоб файл відкривався без теки fonts.
const inlineFonts = (css) => css.replace(/url\("(fonts\/[\w-]+\.woff2)"\)/g, (m, f) =>
  `url("data:font/woff2;base64,${readFileSync(new URL(`../app/${f}`, import.meta.url)).toString('base64')}")`);

const icon = `data:image/svg+xml,${encodeURIComponent(app('icon.svg').trim())}`;

function bundle({ html, script, out, modules = [] }) {
  const code = ['data.js', 'core.js', ...modules, script].map((f) => stripModule(app(f)))
    .join('\n')
    // Service worker потрібен лише для встановленого застосунку, в одному файлі він не працює.
    .replace(/\nif \('serviceWorker' in navigator[\s\S]*?\n}\n/, '\n');
  if (code.includes('</script')) throw new Error(`${script} містить </script і зламає вбудований скрипт`);

  const page = app(html)
    .replace('<link rel="manifest" href="manifest.webmanifest">\n', '')
    .replace(/ *<link rel="preload"[^>]*>\n/, '')
    .replace(/<link rel="(icon|apple-touch-icon)" href="icon\.svg"[^>]*>/g, (m) => m.replace('icon.svg', icon))
    .replace(/<link rel="stylesheet" href="([\w.]+\.css)">/g, (m, f) => `<style>\n${inlineFonts(app(f))}</style>`)
    .replace(`<script type="module" src="${script}"></script>`, () => `<script type="module">\n${code}</script>`);

  if (/src="[\w.]+\.js"|href="[\w.]+\.css"|url\("fonts\//.test(page)) throw new Error(`${html} змінився: оновіть bundle.mjs`);
  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, out), page);
  console.log(`${join(outDir, out)}: ${(page.length / 1024).toFixed(0)} КБ`);
}

bundle({ html: 'index.html', script: 'app.js', out: 'carcar-prototype.html', modules: ['ops.js'] });
bundle({ html: 'business.html', script: 'business.js', out: 'carcar-business.html', modules: ['ops.js', 'charts.js', 'partners.js'] });
bundle({ html: 'admin.html', script: 'admin.js', out: 'carcar-admin.html', modules: ['charts.js', 'partners.js'] });
