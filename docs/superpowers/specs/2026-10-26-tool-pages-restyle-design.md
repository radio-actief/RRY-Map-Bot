# Map, stats and region map in the configurator style

## Goal

The main map (`/`), stats (`/stats`) and region map (`/region-map`) look and behave like the configurator: same colours, font, cards, buttons, top bar and light/dark toggle. Every feature on the pages stays; only layout and styling change.

## Approach

- Restyle in place. Page logic stays in `src/map.js`, `src/stats.js` and `src/region-map.js`; only the markup they touch and the CSS change.
- One shared token file, `css/bemesh-tokens.css`: the colour and font variables now in `web/configurator/src/theme/tokens.css`. The configurator's `tokens.css` imports it, so all four pages use one source.
- One shared stylesheet, `css/bemesh-shell.css`, for the top bar, page switcher, cards, chips, segmented buttons, buttons, inputs and floating map panels. Class names follow the configurator's (`topbar`, `wordmark`, `chip`, `card`, `btn`, `seg`).
- Bootstrap, `bootstrap-rry-theme.css`, `rry-tool-pages.css`, `stats-page.css` and `region-map-page.css` are removed from the three pages. Page-specific rules go to one small file per page. Bootstrap Icons may stay where icons are used.
- Dark mode: the same light/dark/auto toggle (◐) on every page, sharing the configurator's saved choice. Charts and map overlays read the tokens; map tiles stay as they are.

## Top bar (all three pages)

- Left: wordmark `#BEmesh map`, `#BEmesh stats` or `#BEmesh region map`, then the page switcher: Map · Stats · Region map · Configurator.
- Right: the page's own controls, then ◐.
- Phone: the switcher moves into ☰.
- The configurator gets the same switcher.

## Main map

- Top bar right side:
  - A counts chip: total, then companions, repeaters, rooms and sensors, each with its colour dot.
  - A second chip with new nodes for 24h, 7d and 30d.
  - "Sign in with Discord", ☰ and ◐.
- ☰ holds:
  - The Radio-Actief links: website, settings & news, docs, Discord, GitHub.
  - When signed in, "@user · Log out".
- Search floats top-left on the map with a Filters button.
- Filters open as a card under the search box:
  - Type as toggle chips.
  - Source and Discord status as segmented buttons.
  - Last updated, inserted, city, frequency and clustering zoom fold under "More".
  - "Clear filters" shows when any filter is active.
- "+ Add node" is a gold button bottom-right.
- Removed: the floating Config and Stats buttons and the icon grid.
- Node popups, search results and the add-node dialog use the card and dialog style.
- Tiles, markers and clusters are unchanged.
- Phone:
  - Sign-in and the switcher go into ☰.
  - The counts collapse to one chip on the map, e.g. "882 nodes · +29 this week".

## Stats

- Top bar right side: a preset filter chip ("Preset: All ▾") that opens the current preset and custom-radio filter, a download icon with the four JSON downloads, and ◐.
- A row of number tiles:
  - Network, highlighted.
  - Companions, repeaters, rooms and sensors.
  - Active 1d / 7d / 30d.
  - Claimed and Discord users.
- Second row:
  - **Changes**: the range as segmented buttons (7d, Month, 3m, 6m, YTD, 1y, All) above the existing chart.
  - **Timeline playback**:
    - The map fills the card.
    - The date and counts per type (colour dots) sit top-left on the map.
    - ▶, the slider and the ½×/1×/2×/4× buttons float along the bottom edge.
    - The ◀ and ▶| step buttons are removed; the arrow keys step one day.
    - Full screen stays as an icon.
- Third row: Top cities (with the node-type chip), Most repeaters added, and Links (the three link groups, compact).
- The footnote on the data source stays under the cards.
- Phone: the number tiles become a 2-column grid and the cards go full width in the same order.

## Region map

- Left panel next to the map, collapsible on desktop:
  - Search with the grey placeholder "Search city, province or region". The field starts empty and the map still opens on Belgium.
  - Borders as segmented buttons: Off, Provinces, Gewesten, Countries.
  - The "Location points" checkbox.
  - The region code list in the configurator's row style: name, then code and level under it, count right-aligned, selected row highlighted.
- Phone: the map on top and the panel below.

## Out of scope

- No change to APIs, data, map tiles, markers, clustering or chart data.
- No rewrite of the pages to Preact.
- Production deploy only after the user's OK.

## Testing

- `pytest` and the configurator `npm test`, typecheck and build stay green.
- Screenshots of the three pages in light and dark, at 1440 and 390 wide, against a local server. Checks:
  - Every control from the old page is present and works: search, filters, popups, add-node, login link, downloads, preset filter, chart range, playback, borders, code list.
  - No horizontal scroll at 390.
  - The ◐ choice carries over between pages.
