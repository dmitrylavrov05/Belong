// Builds the static site: one HTML page per language from src/template.html
// and src/i18n/<lang>.json, plus assets, robots.txt and sitemap.xml.
//
//   node build.mjs                       -> dist/
//   SITE_URL=https://example.com node build.mjs
//   WAITLIST_ENDPOINT=https://... node build.mjs   (form POSTs JSON there)

import { readFileSync, writeFileSync, mkdirSync, rmSync, cpSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const src = join(here, 'src');
const out = join(here, process.env.OUT_DIR || 'dist');
const siteUrl = (process.env.SITE_URL || 'https://belong.app').replace(/\/+$/, '');
const endpoint = process.env.WAITLIST_ENDPOINT || '';

// Each language: output folder and the relative path back to the site root.
export const LANGS = {
  en: { dir: '', root: './', url: `${siteUrl}/` },
  uk: { dir: 'uk', root: '../', url: `${siteUrl}/uk/` },
};

const escapeAttr = (s) =>
  String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// Flattens {a: {b: 'x'}} to {'a.b': 'x'}; the runtime subtree is shipped as JSON instead.
export function flatten(obj, prefix = '', acc = {}) {
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (key === 'runtime') continue;
    if (v && typeof v === 'object' && !Array.isArray(v)) flatten(v, key, acc);
    else acc[key] = v;
  }
  return acc;
}

// Describes the shape of a value so both languages can be compared structurally.
function shape(v) {
  if (Array.isArray(v)) return v.map(shape);
  if (v && typeof v === 'object') return Object.fromEntries(Object.keys(v).sort().map((k) => [k, shape(v[k])]));
  return typeof v;
}

export function loadDicts() {
  const dicts = {};
  for (const lang of Object.keys(LANGS)) {
    dicts[lang] = JSON.parse(readFileSync(join(src, 'i18n', `${lang}.json`), 'utf8'));
  }
  return dicts;
}

export function checkParity(dicts) {
  const [base, ...rest] = Object.keys(dicts);
  const errors = [];
  const baseKeys = new Set(Object.keys(flatten(dicts[base])));
  for (const lang of rest) {
    const keys = new Set(Object.keys(flatten(dicts[lang])));
    for (const k of baseKeys) if (!keys.has(k)) errors.push(`${lang}: missing key "${k}"`);
    for (const k of keys) if (!baseKeys.has(k)) errors.push(`${lang}: extra key "${k}"`);
    if (JSON.stringify(shape(dicts[lang].runtime)) !== JSON.stringify(shape(dicts[base].runtime))) {
      errors.push(`${lang}: runtime strings differ in structure from ${base}`);
    }
  }
  return errors;
}

export function render(template, lang, dict) {
  const cfg = LANGS[lang];
  const other = lang === 'en' ? 'uk' : 'en';
  const flat = flatten(dict);
  const used = new Set();
  const special = {
    '@lang': lang,
    '@root': cfg.root,
    '@siteUrl': siteUrl,
    '@canonical': cfg.url,
    '@urlEn': LANGS.en.url,
    '@urlUk': LANGS.uk.url,
    '@otherLang': other,
    '@otherHref': `${cfg.root}${LANGS[other].dir ? `${LANGS[other].dir}/` : ''}index.html`,
    '@bannerLang': dict.runtime.banner.lang,
    '@endpoint': escapeAttr(endpoint),
    // Escape "<" so no string can close the surrounding <script> element.
    '@runtime': JSON.stringify(dict.runtime).replace(/</g, '\\u003c'),
  };
  const html = template.replace(/\{\{\s*([@\w.]+)(\|attr)?\s*\}\}/g, (_, key, filter) => {
    let value;
    if (key in special) value = special[key];
    else if (key in flat) {
      value = flat[key];
      used.add(key);
    } else throw new Error(`${lang}: template uses unknown key "${key}"`);
    return filter ? escapeAttr(value) : String(value);
  });
  const unused = Object.keys(flat).filter((k) => !used.has(k) && !k.startsWith('meta.og'));
  return { html, unused };
}

function sitemap() {
  const alt = Object.entries(LANGS)
    .map(([l, c]) => `    <xhtml:link rel="alternate" hreflang="${l}" href="${c.url}"/>`)
    .join('\n');
  const urls = Object.values(LANGS)
    .map((c) => `  <url>\n    <loc>${c.url}</loc>\n${alt}\n  </url>`)
    .join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">\n${urls}\n</urlset>\n`;
}

export function build() {
  const dicts = loadDicts();
  const parity = checkParity(dicts);
  if (parity.length) throw new Error(`Translations out of sync:\n${parity.join('\n')}`);

  const template = readFileSync(join(src, 'template.html'), 'utf8');
  rmSync(out, { recursive: true, force: true });
  mkdirSync(out, { recursive: true });
  cpSync(join(src, 'assets'), join(out, 'assets'), { recursive: true });

  for (const [lang, cfg] of Object.entries(LANGS)) {
    const { html, unused } = render(template, lang, dicts[lang]);
    if (unused.length) throw new Error(`${lang}: keys not used by the template: ${unused.join(', ')}`);
    const dir = join(out, cfg.dir);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'index.html'), html);
  }
  writeFileSync(join(out, 'robots.txt'), `User-agent: *\nAllow: /\nSitemap: ${siteUrl}/sitemap.xml\n`);
  writeFileSync(join(out, 'sitemap.xml'), sitemap());
  if (!endpoint) console.warn('WAITLIST_ENDPOINT is not set: the waitlist form will not send data anywhere.');
  console.log(`Built ${Object.keys(LANGS).length} pages into ${out}`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) build();
