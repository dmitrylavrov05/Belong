# Belong: landing site

Static landing page for Belong in two languages:

- English: `dist/index.html` (served at `/`)
- Ukrainian: `dist/uk/index.html` (served at `/uk/`)

Both pages are built from one template, `src/template.html`, and the dictionaries in `src/i18n/en.json` and `src/i18n/uk.json`. The build fails if a key is missing in either language or if the template uses a key that does not exist.

## Commands

```bash
npm install          # Playwright test runner and axe-core (dev only)
npm run build        # writes dist/
npm run serve        # http://localhost:4173
npm test             # build + Playwright tests (desktop and mobile Chrome)
node scripts/og.mjs  # regenerate the social preview images in src/assets/
```

## Configuration

Set these environment variables for `npm run build`:

| Variable | Default | Purpose |
|---|---|---|
| `SITE_URL` | `https://belong.app` | Canonical URLs, hreflang links, sitemap and `og:image`. |
| `WAITLIST_ENDPOINT` | empty | The waitlist form POSTs JSON here: `{ email, partner, platform, lang, ref, page, ts }`. **Without it the form only saves to the visitor's browser**, so set it before going live (Formspree, a Google Apps Script, a Supabase function and so on). |

## What is on the page

- Hero with a live recreation of the app's Today screen.
- **Inside the app**: a swipeable gallery of 10 real screens of the Android app (Today, photos, chat, letters, films, 100 dates, month report, Us, settings, dreams) in phone frames, in the page's language.
- How it works: wish → goal → plan → memory.
- A day with Belong: interactive mood check-in, “thinking of you”, the plan switcher, evening gratitude and the weekly talk.
- **Date Match**: a two-player game that works without the app. One partner swipes 10 date ideas, then passes the phone or sends a link. The partner's results can be sent back with a reply link. The result screen exports a 1080×1920 story card. Answers travel in the link's `#` fragment, so nothing is stored on a server.
- Date wheel with budget and place filters.
- Long distance: both clocks and the “I'm safe” button.
- **Widgets**: draw on a pad and send it. The doodle appears on a mock of the partner's home screen, next to the mood and countdown widgets.
- **Our month apart**: a story card with km between you and the time difference, worked out from the cities the visitor picks. It saves as a 1080×1920 PNG. The other numbers are examples.
- **Story cards**: four real 9:16 cards the app shares (Wrapped, “thinking of you”, 1000 days, the 100 dates poster).
- Privacy, pricing, waitlist with a referral link, FAQ.

The example couple is Yulia and Igor (Юля та Ігор).

## Screenshots

`src/assets/shots/{en,uk}-*.webp` are rendered from the Android app itself (Robolectric screenshot tests with the example couple), cropped to one phone screen plus the tab bar and saved as WebP: screens at 520×1125, story cards at 540×960. When the app's look changes, render them again and replace the files with the same names.

## Editing text

Change the strings in `src/i18n/*.json` and rebuild. Strings under `runtime` are used by `src/assets/site.js` (game cards, wheel ideas, form messages). Keep the same keys in both files: the tests check that every Ukrainian string is translated.
