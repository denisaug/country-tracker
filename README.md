# Racooner — multi-country Stay Tracker

A client-side calendar tool for travellers who need to stay within the legal
limits of **several countries at once**. Each country carries its own set of stay
rules and they are all tracked on a single calendar.

Live: **[racooner.govorunov.pro](https://racooner.govorunov.pro)**

## Why

If you split your year between countries, each with its own visa/residency math
(Schengen-style 90/180, a hard yearly cap, a "no more than 2 months in a row"
rule…), keeping track by hand is painful. Racooner turns the calendar itself into
the interface: log trips with two clicks and it tells you, per country, whether
you are over the line — instantly and entirely in your browser.

It is not just a record of past stays — it is just as handy for **planning future
trips**. The calendar runs into the future, so you can pencil in upcoming travel and
immediately see how it affects each country's limits *before* you book anything:
try a longer stay, shift dates around, and watch the counters and any violations
update live. Plan your year so you never accidentally overstay.

## Features

- **Calendar-as-interface.** Click the arrival day, then the departure day, to log
  a trip. Hover a trip → ⚙ to assign a country; right-click a trip to delete it.
  Each trip is an independent record.
- **Multiple countries, multiple rules.** Each cell shows the country flag and the
  current day count for that country's rule. The day of a border crossing counts
  for both countries.
- **Three rule types**, assignable per country (more than one allowed):
  - **Rolling 90/180** — at most 90 days of stay in any rolling 180-day window.
  - **≤ 2 consecutive calendar months** — limits the length of a single continuous stay.
  - **≤ N days per calendar year** — a yearly cap (default 183), reset every Jan 1.
- **Instant violation feedback.** A day that breaks a rule fills its cell red with
  an immediate, non-native popup explaining the breach (e.g. *"Turkey — exceeded
  90/180 (92 of 90 days)"*).
- **Profiles.** A catalog entry is a *profile* with a stable id; its `code` is only
  the flag/display. You can keep several profiles under one country code (e.g.
  Turkey 2024 vs Turkey 2025 with different rules) that count fully independently.
- **Plan ahead, not just look back.** The calendar extends into the future, so you
  can schedule upcoming trips and see their impact on every country's limits before
  committing — experiment with dates and watch counters and violations recalculate live.
- **Statistics & map.** A Stats view with KPI cards, per-year cap headroom bars,
  a days-per-country chart and a D3 world map (globe / flat).
- **Themes.** Three full themes (Passport, Studio, Cockpit), persisted locally.
- **Your data stays local.** Everything lives in `localStorage`; JSON import/export
  lets you move between devices. No backend, no accounts, no tracking of your trips.

## Tech stack

Plain **vanilla JavaScript** — **no build step**, no TypeScript, no bundler, no npm
dependencies. The app is a handful of static files served directly:

| File | Role |
|---|---|
| `index.html` | Single-page app shell (Calendar / Stats view toggle) |
| `style.css` | All styling, themes and density via CSS custom properties |
| `engine.js` | **Pure** rule engine — counting, indexing, state migration. No DOM. |
| `app.js` | Calendar UI, trip input, catalog management, theme controller |
| `stats.js` | Stats view (`window.Stats` module): KPIs, chart, map |
| `countries-data.js` | ISO 3166-1 country code → English name reference |
| `raccoon.js` | Optional pixel-art mascot (disabled by default) |
| `engine.test.js` | Unit tests for the engine |

[D3](https://d3js.org/) is loaded from a CDN for the map; nothing else is external.
Country flags are rendered as [flagcdn](https://flagcdn.com/) SVGs with a letter
fallback.

## Running locally

No build, no install. Just open `index.html` in your browser.

## Testing

The rule engine is a set of pure functions covered by Node's built-in test runner.
UI is verified manually.

```sh
node --test
```

## License

[MIT](LICENSE)
