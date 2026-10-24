# Configurator rebuild, part 1: foundation

Part 1 of the #BEmesh configurator rebuild, modelled on MeshNO (meshno.github.io).
The rebuild has six parts:

| Part | What |
|------|------|
| 0 | Hotfix (admin password, vanity key, search, firmware check), done on `fix/configurator-hotfix` |
| **1** | **Foundation: new app, map-first shell, steps, today's features carried over (this spec)** |
| 2 | "New repeater" guided wizard; free regions |
| 3 | "Existing repeater": read, compare, send only changes; access control list |
| 4 | Configure over the mesh through a companion (BLE/USB) |
| 5 | Companion task, "Why regions" page |

## Goal

Replace today's single long configurator page (`configurator.html` plus a 6,000-line
`src/configurator.js`) with a new app that does everything the current page does. The new
app has a map-first layout and step-by-step navigation, and its logic is split into small
tested modules that parts 2–5 build on.

Part 1 is done when:

- every feature of today's configurator works in the new app, including Read and Apply on
  a real repeater over USB, checked on the Mac dev environment;
- for the same inputs, the new app generates the same command script as today's page,
  apart from the intended changes listed under "Small additions";
- a backup JSON exported by today's page imports correctly;
- the page works at phone width;
- `npm test` passes and the Docker image builds and serves `/configurator`.

## Decisions already made

- **Stack:** Vite + Preact + TypeScript, chosen over a no-build rewrite because parts 2–5
  are very interactive. Only the configurator uses it; the map, stats and region-map pages
  stay as they are.
- **Branch:** the whole rebuild (parts 1–5) lives on the long-lived branch
  `feat/configurator-rebuild`, made from `fix/configurator-hotfix`. On that branch the new app
  replaces `/configurator` in place, with no copy of the old page. The live site keeps
  today's page until the branch is merged into `dev`, so the old page stays available at
  meshmap.radio-actief.be/configurator for comparison.
- **Language:** English only for now. All UI text goes through a translation layer so
  Dutch (nl-BE) and later French can be added as locale files. No language switch is shown
  while only one locale exists.
- **Look:** today's #BEmesh gold (`#D4A017`) and Figtree, with light and dark themes. The
  theme follows the system, and a toggle remembers the user's choice.
- **Map:** Leaflet with OpenStreetMap raster tiles, the same as the other pages. MapLibre
  would need a vector tile source and buys nothing here.

## Layout

The screenshots in `2026-10-24-configurator-foundation/` are the approved mockups.

### Top bar (always visible)

- **"#BEmesh configurator"** wordmark.
- **Connection chip:** "USB · v1.17.1", or "Not connected".
- **📍 location chip:** shown on steps 4–5 only, for example "BE-RON-Kluisberg · Ronse".
  Clicking it jumps to step 2.
- **🛠 Device tools** button.
- **Light/dark** toggle.

### Steps 1–3: panel docked on the left, map filling the rest

- The panel is about 300 px wide and fixed to the left edge.
- **Panel header:** a horizontal progress bar with five segments, "N / 5", the step name
  and the next step's name. Clicking a segment jumps to that step, with no forced order.
  Segment colours: green = fine, gold = current, orange = needs attention, grey = not
  visited.
- **Panel body:** the step content, scrolling inside the panel.
- **Panel footer:** Back and "Next: <step>".
- **Map layers:**
  - **Pin:** the repeater's location, draggable.
  - **25 km ring:** a dashed circle around the pin.
  - **Nearby #BEmesh nodes:** repeaters (type 2) and room servers (type 3) within 25 km
    of the pin. Companions are never shown.
  - **Borders:** gewest, province and municipality outlines, with the pin's municipality
    highlighted.
  - **Switches:** "Nearby nodes (N)" and "Borders". The 25 km radius is fixed; the switches
    only show or hide the layers.

### Steps 4–5: full width

- The map slides away and the panel takes the full width.
- The progress bar shows full step labels.
- Jumping back to steps 1–3 brings the map back.

### Phone (under 768 px)

- The panel becomes a bottom sheet with three heights: peek, half and full.
- The progress bar stays visible at every height.
- On steps 4–5 the sheet is full screen and the cards stack in one column.

### Device tools drawer

A drawer that slides in from the right on every step, with a shaded backdrop. Its sections:

- **Device:** clock (with Sync), Copy public key, zero-hop advert, flood advert.
- **Identity:** private key (Reveal / Copy), Generate vanity key.
- **Backup:** Export JSON, Import JSON.
- **Maintenance:** Reboot, Start OTA.
- **Danger zone:** Factory reset, with a typed confirmation.

## The five steps

The steps regroup today's features. Nothing is written to the repeater before "Apply" on
step 5. Read on step 1 is the only other action that talks to the device, apart from the
explicit actions in the device tools drawer.

1. **Connect**
   - Connect over USB (Web Serial).
   - A device card shows name, firmware (with a "regions ✓" badge when the firmware is
     ≥ 1.16), public key and stored location.
   - "Read settings from repeater" fills the plan from the device.
   - "Continue without a device" builds a script with no repeater attached.
   - In browsers without Web Serial (Firefox, Safari, iOS) the step explains why and
     offers "Continue without a device".
2. **Place & name**
   - Search: the ranked search from part 0, municipalities and aliases.
   - Map click or pin drag sets the location.
   - "Use my location" button, new.
   - Coordinates and the matched municipality are shown under the search.
   - "Share location in adverts": No / Fixed position / Live GPS.
   - Prefix format and name, with a live byte counter (new) and a "no node within 25 km
     uses this name" check.
   - Power: Solar / Mains / Battery / Observer / none.
3. **Regions**
   - Today's scope table, regrouped:
     - country and province rows;
     - the municipality (home) and its neighbours, each with Allow / – / Deny;
     - codes read from the device that aren't in the usual neighbour lists.
   - Bulk actions: Recommended, Allow all, Deny all, Clear.
   - A folded section holds untagged traffic (`*`), the default flood scope and the home
     override.
   - The map colours allowed areas green and denied areas red-hatched as the user chooses.
   - "What are regions?" links to the wiki page used today.
4. **Settings** (full width)
   - Cards: Access, Radio, Advertising & hops (including the hop allowance presets
     Minimal / Average / Extended / Full), Owner info, Repeating.
   - **Advanced** is one folded bar with the expert settings.
   - **Card badges:** "unchanged", "recommended ✓", or "N changes".
   - **Changed fields:** a gold outline, plus "was X" after a Read.
   - **Right column:**
     - a small map preview;
     - "What will change", a live summary that always states the admin-password outcome;
     - Back / Next.
5. **Review & send** (full width)
   - **Left:** the planned changes in plain language, grouped (Name & location, Regions,
     Settings), with the line "Admin password stays as it is" or "Admin password will be
     changed".
   - **Right:** the exact command script with comment headers per group.
   - **Under the script:** a progress bar while sending, then Copy script, Download .txt,
     Console, Back, and **Apply to repeater**.
   - **What Apply does in part 1:**
     - checks the firmware first, re-reading `ver` as in part 0;
     - sends the full script as today;
     - the before → after columns and "send only changes" come in part 3. The layout
       already leaves room for them.
   - **Console:** opens the interactive CLI console and the command log, the same features
     as today.

### Browser pop-ups

Today's `alert` and `confirm` boxes go. Each one becomes a message in the panel or a dialog
inside the app:

- **Firmware too old:** a blocking notice on step 5, with Apply disabled.
- **Firmware unreadable:** a notice with an explicit "Continue anyway".
- **Read with unsaved edits:** a dialog asking whether to overwrite the form.
- **Factory reset:** a typed confirmation.

## Small additions in part 1

These come from comparing the page with the official MeshCore "Repeater / Room server USB
setup" tool. The user chose them for part 1.

- **Radio presets:** update the list from today's 13 entries to the official tool's
  current list. It adds the Netherlands presets, EU 433 MHz Narrow, Switzerland and others.
  Keep "EU/UK (Narrow)" as the #BEmesh default. The source of the list is recorded in a
  comment next to the data.
- **Byte counters** on the name and on owner info. The owner-info limit is 119 bytes, which
  today's page doesn't enforce. The name limit is today's 23 bytes with a location and 31
  without; it is checked against the MeshCore firmware source during implementation and
  corrected if wrong.
- **"Use my location"** uses `navigator.geolocation`. The button only appears when the page
  runs on a secure origin.
- **Help on every field:** the allowed range and the factory default. For example, zero-hop
  advert is 60–240 min rounded to an even number (0 = off), flood advert is 3–168 h (0 = off),
  and the AGC reset interval is a multiple of 4. The text lives in the settings registry,
  not in the markup.

## Architecture

### Where it lives

```
web/configurator/
  index.html
  vite.config.ts            base '/configurator/', dev proxy /api and /data → Flask :8000
  src/
    main.tsx
    app/                    shell: TopBar, Stepper, DockedPanel, BottomSheet, MapView,
                            DeviceDrawer, Notice, Dialog
    steps/                  Connect, PlaceName, Regions, Settings, Review
    core/                   pure logic, no DOM, no Preact
      settings.ts           registry: key, read cmd, CLI key, tier, card, range, default,
                            help-text key
      presets.ts            radio presets
      naming.ts             prefix formats, byte limits
      regions.ts            scope rows from location + neighbours, policy → region
                            commands
      cli.ts                plan → grouped, commented command script
      firmware.ts           version parsing, feature gates (from part 0)
      vanity.ts             MeshCore private-key format (from part 0)
      search.ts             place ranking (from part 0)
      geo.ts                distance, nodes-within-radius, municipality lookup
      backup.ts             JSON export/import, compatible with today's files
      plan.ts               the Plan type, defaults, diff summary ("what will change")
    device/
      serial.ts             Web Serial transport (port of src/repeater-serial.js), port
                            injectable
      repeater.ts           readAll() → DeviceSnapshot, apply(script, onProgress),
                            run(cmd)
    state/
      store.ts              Preact signals: plan, device, ui (step, sheet height, layer
                            switches, theme)
    i18n/
      t.ts                  t(key, params) with Intl.PluralRules; locale loading
      en.json
    theme/
      tokens.css            colour/spacing tokens, light + dark
  tests/                    Vitest
```

### How data flows

- **One store, three parts:**
  - `plan` is what the user wants on the repeater;
  - `device` holds the connection state, the last `DeviceSnapshot` and the firmware;
  - `ui` holds the screen state.
- **Steps edit `plan` only.** They never talk to the device.
- **Read:** `repeater.readAll()` returns a `DeviceSnapshot`. `plan.fromSnapshot()` fills the
  plan and keeps the snapshot for "was X" hints.
- **Live values:** "What will change" and the review list come from
  `plan.summarize(plan, snapshot?)`. The script comes from `cli.build(plan)`.
- **Apply** runs `repeater.apply(cli.build(plan))` and reports progress per command.
- **Device tools** call `repeater.run(...)` directly. Each action is explicit and confirmed
  when destructive.
- **Libraries:** Preact, `@preact/signals`, Leaflet, tweetnacl (vanity key, as today), Vitest
  and `@testing-library/preact`. Nothing else without a reason in the plan.

### Building, serving and deploying

- **Build output:** `npm run build` writes to `dist/configurator/`, which is already
  git-ignored through `dist/`.
- **Dockerfile:** gains a first stage (`node:22-slim`: `npm ci && npm run build`). The Python
  stage copies `dist/configurator/` from it. Deploying stays a single
  `docker compose up --build`.
- **Flask:**
  - `/configurator` serves `dist/configurator/index.html`;
  - a new route `/configurator/<path>` serves the built assets;
  - the `/region-configurator` redirects stay.
- **Runtime data:** the app loads `/data/be-locode.json`,
  `/data/be-municipalities.geojson`, `/data/be-provinces.geojson`,
  `/data/be-gewesten.geojson` and `/api/v1/belgian-nodes`, all as they are today.
  - The separate open finding about the catch-all route exposing `/data/*.db` must keep
    these files reachable when it is fixed.
- **Development:**
  - `npm run dev` runs Vite with live reload and proxies `/api` and `/data` to the Flask
    container on :8000.
  - The Mac test rule still holds for container tests: check the commit, rebuild `api`,
    hard-reload.
- **Removed at the end of part 1:** `configurator.html`, `src/configurator.js`,
  `src/configurator/`, `css/configurator-page.css`, and the old JS tests that move to
  Vitest (`tests/js/`).
- **Also removed:** `src/repeater-serial.js` and `lib/tweetnacl.min.js`. Only the
  configurator loads them, and the app ports the first and takes tweetnacl from npm.
- **Kept:** `src/shared/be-regions.js`, because the region-map page loads it. The app
  imports the same file through a small TS wrapper, so the province data has one source.
- **Housekeeping:**
  - commit `package-lock.json` (remove it from `.gitignore`) so `npm ci` is reproducible;
  - add `._*` to `.dockerignore`, because macOS AppleDouble files on the NFS share break
    BuildKit.

## Errors and edge cases

- **USB unplugged or a write failure during Apply:**
  - stop at once;
  - show which command failed and how many were sent;
  - offer "Copy remaining commands";
  - never retry silently.
- **Serial timeout on Read:** show the commands that got no reply and fill the rest. This
  matches today's behaviour.
- **Nearby nodes or border data fails to load:** the layer switch shows "unavailable" and
  the rest of the app works. The name check then says "couldn't check nearby names".
- **No location yet:** the Regions segment is orange and the step explains that it needs a
  place. The Settings and Review steps still work.
- **Invalid field values** (outside the range in the registry): the field is marked, the
  step segment turns orange, and Apply is disabled with a list of what to fix.
- **Over a byte limit:** the counter turns red and Apply is disabled.

## Testing

- **Unit (Vitest):** every `core/` module. The 15 tests from part 0 move over.
- **Script parity:** before the old code is deleted, run today's page headless for a fixed
  set of scenarios and store the generated scripts as fixtures. `cli.build()` must reproduce
  them. Differences are allowed only where this spec changes behaviour, for example a byte
  limit correction. The scenarios:
  - Ronse with a solar repeater;
  - Brussels;
  - a border municipality with denied neighbours;
  - no location;
  - all advanced settings changed;
  - an admin password set.
- **Backup compatibility:** a JSON file exported by today's page imports with every field
  intact.
- **Device layer:** `repeater.ts` is tested against a fake serial port that replays recorded
  replies, including `ver`, a full Read and a mid-Apply disconnect.
- **Components:** a few tests with `@testing-library/preact` for step navigation, the
  orange/green segment states and the admin-password line.
- **Hardware acceptance:** on the Mac dev environment with a real repeater:
  - Connect, Read, edit a setting, Apply;
  - the admin password is kept when the field is empty;
  - the vanity key gets a quick check only if the user wants it.

## Not in part 1

- The guided "New repeater" wizard and free regions (part 2).
- Compare and send only changes, and the access control list (part 3).
- Configuring over the mesh (part 4).
- The companion task and the "Why regions" page (part 5).
- The Dutch translation (the layer is ready; the text comes later).
- Stats and room-server-specific handling (not chosen).
- Shareable config URLs.
- Restyling the map, stats and region-map pages.
