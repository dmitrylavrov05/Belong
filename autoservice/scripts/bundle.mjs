// Збирає весь застосунок в один HTML-файл без зовнішніх залежностей: стилі, дані й логіка
// всередині. Такий файл зручно завантажити в Claude Design або відкрити просто з диска.
// node scripts/bundle.mjs [вихідний файл]
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const app = (f) => readFileSync(new URL(`../app/${f}`, import.meta.url), 'utf8');
const out = process.argv[2] || 'design/carcar-prototype.html';

const data = app('data.js').replace(/^export /gm, '');
const logic = app('app.js')
  .replace(/^import .* from '\.\/data\.js';\n/m, '')
  // Service worker потрібен лише для встановленого застосунку, в одному файлі він не працює.
  .replace(/\nif \('serviceWorker' in navigator[\s\S]*?\n}\n/, '\n');
const icon = `data:image/svg+xml,${encodeURIComponent(app('icon.svg').trim())}`;
// Шрифти вшиваємо в CSS як data:-адреси, щоб файл відкривався без папки fonts.
const styles = app('styles.css').replace(/url\("(fonts\/[\w-]+\.woff2)"\)/g, (m, f) =>
  `url("data:font/woff2;base64,${readFileSync(new URL(`../app/${f}`, import.meta.url)).toString('base64')}")`);

for (const [name, text] of [['data.js', data], ['app.js', logic]]) {
  if (text.includes('</script')) throw new Error(`${name} містить </script і зламає вбудований скрипт`);
}

const html = app('index.html')
  .replace('<link rel="manifest" href="manifest.webmanifest">\n', '')
  .replace(/ *<link rel="preload"[^>]*>\n/, '')
  .replace(/<link rel="(icon|apple-touch-icon)" href="icon\.svg"[^>]*>/g, (m) => m.replace('icon.svg', icon))
  .replace('<link rel="stylesheet" href="styles.css">', () => `<style>\n${styles}</style>`)
  .replace('<script type="module" src="app.js"></script>', () => `<script type="module">\n${data}\n${logic}</script>`);

if (html.includes('src="app.js"') || html.includes('href="styles.css"') || html.includes('url("fonts/')) throw new Error('index.html змінився: оновіть bundle.mjs');
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, html);
console.log(`${out}: ${(html.length / 1024).toFixed(0)} КБ`);
