# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A **static, browser-only** dashboard that reads a BOXFUL P&L Google Sheet at runtime via the user's Google OAuth token and renders KPIs, a rules-based Chinese-language summary, an anomaly list, and ~10 ECharts charts. There is **no backend, no build step, no package manager, and no tests**. All UI text, comments, and configuration are Traditional Chinese (zh-Hant).

## Running it

Because it uses Google OAuth (GIS) and calls the Sheets API from the browser, it must be served from an HTTP origin that is whitelisted in the OAuth client — `file://` will not work.

```bash
python3 -m http.server 8000   # then open http://localhost:8000
```

For any real deployment (e.g. GitHub Pages), the origin must be added to the OAuth client's *Authorized JavaScript origins* in GCP.

Before it can load data, `config.js` must have a real `OAUTH_CLIENT_ID` (the placeholder string ships as-is), the signed-in Google account must have viewer access to the spreadsheet, and Google Sheets API must be enabled in the GCP project. These preconditions and the fixes are already surfaced to the user in `app.js`'s `showError` panel — mirror that wording when adding new error paths.

## Architecture

Four JS files loaded as `<script>` tags in `index.html`. Each exposes exactly one global; there is **no module system**:

| File | Global | Responsibility |
|---|---|---|
| `config.js` | `window.CONFIG` | Sole hand-maintained knobs: spreadsheet ID, OAuth client ID, Top-N, segment list, anomaly thresholds. |
| `sheets.js` | `window.Sheets` | OAuth-authenticated Sheets API v4 fetch + parsing. |
| `charts.js` | `window.Charts` | All ECharts option builders + rules-based summary + anomaly detection. |
| `app.js` | (IIFE) | Auth, load, tab state, KPI rendering, orchestrates which cards show for which segment. |

External runtime deps come from CDN in `index.html`: ECharts 5.5.0 and Google Identity Services.

### Sheet → data model (critical)

`sheets.js` deliberately **never hard-codes row or column indices**. Inserting or reordering rows in the source spreadsheet must not break the dashboard. The parser (`parseSheet`) works in three stages:

1. **Month row**: scan the first 20 rows, pick the one with the most date-parseable cells (`toYearMonth` handles Sheets serial numbers, ISO, M/D/YYYY, and Date objects). This yields `months: [{col, year, month, label}]`.
2. **Metric rows** (`metricRow`): locate a row by regex against a label taken from column C/B/D/A (in that order — see `label()`). The rows currently required by downstream code are anchored to these exact regexes:
   - `/^total income$/i` → `revenue`
   - `/^total cost of sales$/i` → `cogs`
   - `/^gross profit$/i` → `gp`
   - `/^total operating expenses$/i` → `opex`
   - `/ebi.?t?da/i` excluding `margin|%` → `ebitda` (tolerates the `EBIDA` typo)
   - `/^\s*orders?\b/i` with `requireData` → `orders` (only present on B2B sheet)
3. **Section item lists** (`sectionItems`): everything between a start-label row and an end-label row with non-zero totals. Used to get `incomeItems`, `cogsItems`, `opexItems`.

If you rename any of the anchor labels in the sheet, update the regexes here — they are the schema. The Sheets API is called with `valueRenderOption=UNFORMATTED_VALUE`, so dates come back as serial numbers; keep that in mind when adjusting `toYearMonth`.

### Segments ↔ sheet tabs

`CONFIG.SEGMENTS` (`total`, `b2b`, `b2c`) is bound to the sheet's **tab order**, not tab names. `Sheets.fetchAll` sorts tabs by `properties.index`, takes the first three, and maps them by array position. If a new segment tab is added, extend `SEGMENTS` **and** loosen the `.slice(0, 3)` in `sheets.js`.

### Rendering flow

`app.js`'s `render()` decides which cards to show based on the current segment:

- All segments: `chart-pnl`, `chart-rates`, `chart-expratio`, `chart-costmix`.
- Non-total (`b2b`/`b2c`) only: `chart-revcost`, `chart-gpexp`.
- B2B only (has orders): `chart-perorder`. Also `chart-waaship` iff any income item name matches `/waaship/i`.
- Total only: `chart-contrib` (2B vs 2C comparison, reads all three segments' parsed data).

Each card is a `<section class="hidden">` in `index.html`; `show(cardId, chartId, visible, optionFn)` toggles visibility and calls the corresponding `Charts.*Option` builder. Adding a chart requires: (1) a new `<section>` in `index.html`, (2) an option builder in `charts.js`, (3) a `show()` call in `render()`.

ECharts instances are cached in `app.js`'s `instances` object and reused across renders via `setOption(..., true)`. They also resize on window resize and on a 30ms deferred pass after each render.

### Auth flow

Uses **Google Identity Services** (`google.accounts.oauth2.initTokenClient`) directly, not `gapi.client`. The token is held in-memory only (`gtoken`) and passed via `Authorization: Bearer` header on each Sheets fetch. `Sheets.apiGet` treats 401 as expiry and throws `{code: 401}`, which `app.js` catches and re-prompts login. Scope is read-only: `spreadsheets.readonly`.

### The Top-N / Others convention

`Charts.topN(items, monthsLen, n)` sorts items by year-total, keeps the top N, and sums the rest into an "Others" bucket. Callers must **check for `name === "Others"`** to apply the neutral gray (`OTHERS`) instead of the categorical palette (`CAT`). This is the pattern used in `revCostOption`, `gpExpOption`, and `costMix100Option` — follow it in any new stacked chart.

### Excluding depreciation from expense charts

`CONFIG.EXCLUDE_EXPENSE_PREFIX` (default: `["Depreciation", "Amortization"]`) drives the `excludedExpense(name)` filter used by `gpExpOption`, the `biggestMover` for expenses in `summary`, and the EBITDA bridge. This is intentional: EBITDA-oriented views should not surface D&A movements. When adding a new expense chart, decide explicitly whether to apply this filter.

### Anomaly detection

`Charts.anomalies(d)` scans revenue, gross profit, and every cost/expense item in the **current year** and flags months whose value deviates from the median of the previous `CONFIG.ANOMALY.baselineWindow` months by both a relative threshold (`relThreshold`) and an absolute floor (`absFloor`). It also flags sign flips (positive baseline → negative value) as `dir: "flip"` with a "possible reversal / reclassification" note. Results are sorted by materiality, top-N kept, then re-sorted newest-first for display.

## Editing conventions

- **UI copy is Traditional Chinese.** Match tone and terminology of existing strings when adding user-visible text (e.g. `重點摘要`, `本期需說明`, `資料檢核`).
- **No modules, no `let`/`const` in hot paths.** The existing code uses `var` and IIFEs pinned to `window.*` globals; keep that pattern rather than introducing ES modules or bundling.
- **Config-first.** Anything a business user might want to tune (thresholds, palette segments, excluded prefixes) belongs in `config.js`, not scattered in chart code.
- **Don't hard-code row numbers or column letters.** Add a new regex to `metricRow` / `sectionItems` in `sheets.js` and let the parser locate it.
