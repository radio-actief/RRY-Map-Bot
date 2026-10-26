# Tool pages restyle Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The main map, stats and region map pages use the configurator's look: tokens, top bar with page switcher, cards, and the light/dark toggle.

**Architecture:** Restyle in place. There is one shared token file in `src/shared/`, which the configurator also imports, plus one shared shell stylesheet and one small theme script for the static pages. Each page then has its markup reworked and a single page stylesheet. The page JS keeps its logic; only the selectors and markup it builds change.

**Tech Stack:** Static HTML, Vue (map page), vanilla JS (stats, region map), Leaflet, ApexCharts, Flask static serving, Vite/Preact (configurator), and Playwright for the page check.

**Spec:** `docs/superpowers/specs/2026-10-26-tool-pages-restyle-design.md`

## Global Constraints

- Every feature on the three pages stays. No change to APIs, data, tiles, markers, clustering or chart data.
- No Preact rewrite of the pages. No `npx prettier`.
- Theme storage key `configurator.theme`, values `light` | `dark`, absent = system. The ◐ cycle is system → light → dark → system, the same as `NEXT_THEME` in `web/configurator/src/app/TopBar.tsx`.
- The switcher labels and links are Map `/`, Stats `/stats`, Region map `/region-map`, Configurator `/configurator`, in that order. The current page is marked `aria-current="page"`.
- Wordmarks: `#BEmesh map`, `#BEmesh stats`, `#BEmesh region map` (with "#BE" in gold, as in the configurator's `.wordmark b`).
- The region search placeholder is exactly `Search city, province or region`.
- Remove from all three pages: `lib/css/bootstrap.min.css`, `lib/js/bootstrap.bundle.min.js`, `css/bootstrap-rry-theme.css`, `css/rry-tool-pages.css`, `css/stats-page.css`, `css/region-map-page.css`. Bootstrap JS is unused, so no JS depends on it. `bootstrap-icons.css` may stay.
- The Docker web stage copies only `web/` and `src/shared/`, so anything the configurator imports must live in `src/shared/`.
- Commands are run from the repo root with `PATH=~/.nvm/versions/node/v26.12.1/bin:$PATH`. Git uses `git -c safe.directory='*'`. Nothing is pushed.

## Review Focus

1. **Stored theme value from before the restyle, or garbage:** a page must fall back to system and never throw. Covered by the Task 1 check with `localStorage` set to `"blue"`.
2. **Phone width 390:** no horizontal scroll on any page in either theme. Covered by the Task 5 check.
3. **A signed-in user on the map:** ☰ shows "@user · Log out" and the sign-in chip is hidden. Task 3 check, with the `/api/v1/auth` response mocked.
4. **Playback at the first or last date with the arrow keys:** it stays in range and doesn't wrap. Task 4 check.
5. **Region search left empty:** the map still shows Belgium with the provinces. Task 5 check.

---

### Task 1: Shared tokens, shell and theme

**Files:**
- Create: `src/shared/bemesh-tokens.css`. Move the whole body of `web/configurator/src/theme/tokens.css` into it.
- Modify: `web/configurator/src/theme/tokens.css`. It becomes only `@import "../../../../src/shared/bemesh-tokens.css";`
- Create: `css/bemesh-shell.css`. It defines `body`, `.topbar`, `.wordmark`, `.switcher`, `.spacer`, `.chip`, `.card`, `.btn`, `.btn.gold`, `.seg`, `.icon-btn`, `.menu` (☰ dropdown), `.map-float` (floating panel on a map), `.field` and `input`. Values are copied from `web/configurator/src/theme/app.css` so the pages match.
- Create: `src/shared/theme.js`, a classic script with no module and no globals except `window.BEmeshTheme`.
- Create: `scripts/check-tool-pages.mjs`, the Playwright check that later tasks extend.
- Modify: `web/configurator/src/app/TopBar.tsx`. Add the switcher after the wordmark, with Configurator current.
- Test: `tests/test_api_routes.py` (served files), `web/configurator/tests/` (switcher).

**Interfaces:**
- Produces:
  - `window.BEmeshTheme.apply(): void`. It reads `configurator.theme` and sets or removes `data-theme` on `<html>`. Run it inline in `<head>` so there is no flash.
  - `window.BEmeshTheme.next(): "system"|"light"|"dark"`. It cycles, stores and applies.
  - Shell markup that all pages copy:
    ```html
    <header class="topbar">
      <span class="wordmark"><b>#BE</b>mesh map</span>
      <nav class="switcher" aria-label="Pages"><a href="/" aria-current="page">Map</a><a href="/stats">Stats</a><a href="/region-map">Region map</a><a href="/configurator">Configurator</a></nav>
      <span class="spacer"></span>
      <!-- page controls -->
      <button class="icon-btn" data-theme-toggle aria-label="Theme">◐</button>
    </header>
    ```
    `theme.js` wires every `[data-theme-toggle]` on DOMContentLoaded. Below 600 px `.switcher` is hidden and its links appear in the page's ☰ `.menu`.
  - `node scripts/check-tool-pages.mjs <baseUrl>`. It exits non-zero on a failed assertion and prints one line per check.

- [ ] **Step 1: Failing tests.**
  - In `tests/test_api_routes.py`, add `test_shared_restyle_assets_are_served`: GET `/css/bemesh-shell.css`, `/src/shared/bemesh-tokens.css` and `/src/shared/theme.js` each return 200.
  - In the configurator tests, add a TopBar test: links named Map, Stats, Region map and Configurator exist, and Configurator has `aria-current="page"`.
  - In `scripts/check-tool-pages.mjs`, add a theme check for each page. With `localStorage["configurator.theme"]="dark"`, `<html data-theme>` is `dark`. With `"blue"`, there is no `data-theme` attribute and no page error. Clicking `[data-theme-toggle]` from system stores `light`.
- [ ] **Step 2: Run them and see them fail.**
  - Run: `venv/bin/pytest -q tests/test_api_routes.py` (use the venv the repo uses) and `timeout 400 npm test -- --maxWorkers=2`.
  - Expected: the new tests fail with 404 and a missing link.
- [ ] **Step 3: Implement** the files above.
- [ ] **Step 4: Check.**
  - pytest, `npm test`, `npm run typecheck` and `npm run build` all pass.
  - The configurator looks unchanged apart from the switcher. Compare a screenshot with `review/after/desk-08-settings.png`.
- [ ] **Step 5: Commit** `feat(RRY-Map-Bot): shared tokens, shell styles and theme toggle for the tool pages`.

### Task 2: Region map

**Files:**
- Modify: `region-map.html`, `src/region-map.js` (only the markup it builds and the classes it reads).
- Create: `css/region-map.css`.
- Modify: `scripts/check-tool-pages.mjs`.

**Interfaces:** Consumes Task 1's shell and `theme.js`.

- [ ] **Step 1: Failing checks** for `/region-map`:
  - The topbar shows `#BEmesh region map`, and the Region map link is the current page.
  - The search input is empty, with the placeholder `Search city, province or region`.
  - The borders control is buttons named Off, Provinces, Gewesten and Countries, with Provinces pressed.
  - The `Location points` checkbox is checked.
  - The code list shows rows. The Belgium row shows `be` and a number.
  - With the search empty, the provinces layer is on the map: at least 10 province paths.
- [ ] **Step 2: Run the check against the local server and see it fail.** Start it with `FLASK_APP=backend/api/app.py venv/bin/flask run -p 4789`. Run `node scripts/check-tool-pages.mjs http://127.0.0.1:4789`.
- [ ] **Step 3: Implement.**
  - Layout: a left panel and the map, as in the spec. The panel toggle stays on desktop. On phones the map goes on top.
  - Rows use the configurator's region-row look. The selected row gets `--gold-bg`.
  - The old "be" default is now applied without filling the input.
- [ ] **Step 4: The check passes. Take screenshots at 1440 and 390, light and dark.**
- [ ] **Step 5: Commit** `feat(RRY-Map-Bot): region map in the configurator style`.

### Task 3: Main map

**Files:**
- Modify: `index.html`, `src/map.js` (markup only: popups, search results, add-node dialog, QR modal), `css/style.css` (trim to map-page rules; drop the rules for removed elements).
- Modify: `scripts/check-tool-pages.mjs`.

- [ ] **Step 1: Failing checks** for `/`:
  - Topbar `#BEmesh map`, with Map current.
  - A counts chip containing the total.
  - A chip with `24h`, `7d` and `30d`.
  - With the auth API unauthenticated, a `Sign in with Discord` link to `/auth/login` (check the current href in `index.html` and keep it).
  - ☰ opens a menu with Website, Settings & news, Docs, Discord and GitHub.
  - With the auth response mocked as signed in (`page.route` on the auth endpoint `map.js` calls), the menu shows `@user` and `Log out`, and the sign-in chip is absent.
  - The search input is in a `.map-float`. Filters opens a card with chips Clients, Repeaters, Room servers and Sensors, a Source segment (All, App, Uploader), a Discord segment (All, Claimed, Unclaimed), and a `More` disclosure that holds last updated, inserted, city, frequency and clustering zoom.
  - `+ Add node` is visible.
  - There is no `.float-action-btn` and no `.float-action-grid`.
- [ ] **Step 2: See it fail.**
- [ ] **Step 3: Implement.**
  - Keep every Vue binding and handler name. Only the elements and classes around them change.
  - Source and Discord become three-state segments. "All" means both checkboxes are on, so existing filter state maps over unchanged.
  - Phone: the switcher and sign-in move into ☰. The counts show as one `.map-float` chip, `882 nodes · +29 this week`, using the 7d number.
- [ ] **Step 4: The check passes.** Screenshots at 1440 and 390, light and dark. Then do these by hand and confirm each works:
  - Open a node popup.
  - Search for a node.
  - Open add-node.
- [ ] **Step 5: Commit** `feat(RRY-Map-Bot): main map in the configurator style`.

### Task 4: Stats

**Files:**
- Modify: `stats.html`, `src/stats.js` (markup it builds, the playback controls, and chart colours from the tokens).
- Create: `css/stats.css`.
- Modify: `scripts/check-tool-pages.mjs`.

**Interfaces:**
- `stats.js` reads chart text and grid colours from `getComputedStyle(document.documentElement)` for `--mut` and `--line`. These replace the hard-coded `#57534e` and the `theme: "light"` setting.
- On a theme change (a `MutationObserver` on `data-theme`, plus the `prefers-color-scheme` media query), it re-renders the chart.

- [ ] **Step 1: Failing checks** for `/stats`:
  - Topbar `#BEmesh stats`, with Stats current.
  - A `Preset: All` chip opens the existing preset and custom-radio filter.
  - The download menu has four links to the existing `/api/v1/*/contacts` URLs.
  - Tiles in order: Network, Companions, Repeaters, Rooms, Sensors, New 1d / 7d / 30d, Claimed, Discord users.
  - Range buttons 7d, Month, 3m, 6m, YTD, 1y, All, with Month pressed. Clicking 7d changes the chart's x-range.
  - The playback map has an overlay with the date and four type counts, and a bottom bar with ▶, a range input and the buttons ½×, 1×, 2× and 4×.
  - No ◀ or ▶| buttons.
  - With the slider focused at the last date, ArrowRight leaves the value unchanged. At the first date, ArrowLeft leaves it unchanged.
  - Cards for Top cities, Most repeaters added and Links.
  - In dark mode the chart's axis label colour equals `--mut`.
- [ ] **Step 2: See it fail.**
- [ ] **Step 3: Implement.**
  - Layout follows the spec. Full screen stays as an icon.
  - Phone: tiles in two columns, cards full width.
- [ ] **Step 4: The check passes.** Screenshots at 1440 and 390, light and dark. Play the timeline once.
- [ ] **Step 5: Commit** `feat(RRY-Map-Bot): stats page in the configurator style`.

### Task 5: Clean-up and whole check

**Files:**
- Delete: `css/bootstrap-rry-theme.css`, `css/rry-tool-pages.css`, `css/stats-page.css`, `css/region-map-page.css`, `lib/js/bootstrap.bundle.min.js` and `lib/css/bootstrap.min.css(.map)`, once `grep -rn` shows no page references them.
- Modify: `scripts/check-tool-pages.mjs`. For every page, at 390 wide in light and dark, assert `document.documentElement.scrollWidth <= 390` and no console errors.

- [ ] **Step 1: Add the 390 and console checks. Run them; fix anything they find.**
- [ ] **Step 2: Full run.**
  - Run: pytest (all), `timeout 400 npm test -- --maxWorkers=2`, `npm run typecheck`, `npm run build`, and `node scripts/check-tool-pages.mjs http://127.0.0.1:4789`.
  - Expected: all pass, and pytest stays at 52 or more.
- [ ] **Step 3: Commit** `chore(RRY-Map-Bot): drop Bootstrap and the old page styles`.
