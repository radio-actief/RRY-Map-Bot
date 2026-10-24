# Configurator rebuild part 1 (foundation): implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace `configurator.html` + `src/configurator.js` with a Vite + Preact + TypeScript app at
`/configurator`. The app has the approved map-first layout and five steps, does everything the old page does, and
produces the same command script.

**Architecture:**
- **Logic:** pure TypeScript modules in `web/configurator/src/core/` (no DOM) and a device layer in
  `src/device/` with an injectable serial port.
- **State:** one Preact-signals store.
- **UI:** step components over a Leaflet map.
- **Proving nothing changed:** "parity fixtures" captured from the old page before it is deleted.
- **Serving:** Flask serves the built files; Docker builds them in a node stage.

**Tech stack:** Vite, Preact, `@preact/preset-vite`, `@preact/signals`, TypeScript, Leaflet, tweetnacl, Vitest + jsdom
+ `@testing-library/preact`, Playwright (fixture capture only), Flask (existing), Docker.

**Spec:** `docs/superpowers/specs/2026-10-24-configurator-foundation-design.md`. Mockups are in
`docs/superpowers/specs/2026-10-24-configurator-foundation/`.

## Global constraints

- Branch `feat/configurator-rebuild`. Commit after every task; never push. The working tree is shared over NFS with
  the Mac session "RRY-Map-Bot Dev Env", so don't switch branches mid-plan. Use `git -c safe.directory='*'`, since
  files are root-owned.
- Commit messages end with the session's attribution lines:
  `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>` and
  `Claude-Session: https://claude.ai/code/session_01T72YWkPGqvLA7qaQDbEiLH`.
- **Text:** all UI text is in English through `t()`, with keys in `src/i18n/en.json`. No string literals in
  components except CSS class names and CLI commands.
- **Look:**
  - gold `#D4A017` and Figtree (Google Fonts);
  - light and dark themes from tokens in `src/theme/tokens.css`;
  - the theme follows `prefers-color-scheme`, and the toggle is stored in localStorage under `configurator.theme`.
- **Map:** Leaflet with `https://tile.openstreetmap.org/{z}/{x}/{y}.png` and OSM attribution. The nearby radius is
  fixed at **25 km**. Node types shown: **2 (repeater)** and **3 (room server)** only, never 1 (companion).
- **Layout:**
  - docked panel ~300 px for steps 1–3;
  - full width for steps 4–5;
  - bottom sheet below **768 px** with heights peek / half / full.
- **Firmware:** regions need firmware **≥ 1.16** (`REGION_DEF_MIN_TEXT = "1.16"`).
- **Limits (MeshCore `CommonCLI.h` / `AdvertDataHelpers.cpp`):**
  - name ≤ **23 UTF-8 bytes** when the advert carries a location, ≤ **31** otherwise;
  - name must not contain any of `[ ] \ : , ? *`;
  - owner info ≤ **119 bytes**, with newlines sent as `|`;
  - admin password ≤ **15 bytes**.
- **Old-page behaviour that stays:**
  - an empty admin password emits no `password` line;
  - the script omits values equal to firmware defaults unless "Include unchanged defaults" is on;
  - after Apply, reboot is offered rather than sent.
- **Libraries:** none beyond the tech stack without a reason written in the commit message.
- **Browser storage:** every localStorage access is wrapped in try/catch, and the app renders correctly without it.

## Review focus

1. **A backup exported by the old page carries `setting-radio-preset` as an index into the old 13-entry list.**
   Import must take the radio from `setting-radio-freq/sf/bw/cr` and re-match the preset by values, never by index.
   Owner: Task 9.
2. **A map click outside Belgium, or in the sea, matches no municipality.**
   - The pin is still placed and the coordinates are still emitted.
   - The Regions segment turns orange with "outside Belgium: regions need a Belgian municipality".
   - The name prefix falls back to the country format.
   - Owner: Tasks 7 and 14.
3. **A name near the byte limit with a power emoji** (4 bytes each), or owner info containing `|` or newlines. The
   counters must count the encoded bytes. Owner: Task 6.
4. **USB unplugged during Read.** The partial read fills what arrived, lists the missing commands, and the connection
   chip returns to "Not connected" without a page reload. Owner: Task 10.
5. **localStorage throws** (Safari private mode, blocked site data). The theme and layer switches still work for the
   session. Owner: Task 11.

---

## File map

```
web/configurator/
  index.html                vite.config.ts            tsconfig.json
  src/main.tsx
  src/app/                  App.tsx TopBar.tsx Stepper.tsx Panel.tsx MapView.tsx DeviceDrawer.tsx Notice.tsx Dialog.tsx
  src/steps/                Connect.tsx PlaceName.tsx Regions.tsx Settings.tsx Review.tsx
  src/core/                 firmware.ts search.ts vanity.ts settings.ts presets.ts radio-presets.json naming.ts
                            geo.ts regions.ts plan.ts cli.ts backup.ts data.ts be-regions.ts
  src/device/               serial.ts repeater.ts
  src/state/                store.ts
  src/i18n/                 t.ts en.json
  src/theme/                tokens.css app.css
  tests/                    *.test.ts(x), fakes/fake-port.ts, fixtures/parity/*.{backup.json,script.txt}
scripts/capture-configurator-parity.mjs     scripts/update-radio-presets.mjs
backend/api/app.py          Dockerfile      .dockerignore   .gitignore   package.json   README.md
tests/test_configurator_routes.py
```

---

### Task 1: Toolchain scaffold + firmware module

**Files:**
- Create: `web/configurator/{index.html,vite.config.ts,tsconfig.json,src/main.tsx}`,
  `web/configurator/src/core/firmware.ts`, `web/configurator/tests/firmware.test.ts`
- Modify: `package.json`, `.gitignore` (delete the `package-lock.json` line)

**Interfaces:**
- Produces:
  - `parseVersion(reply: string): {major:number,minor:number,patch:number,text:string}|null`
  - `supportsRegionDef(v: ReturnType<typeof parseVersion>): boolean`
  - `REGION_DEF_MIN_TEXT = "1.16"`
  - npm scripts `dev`, `build`, `test`, `typecheck`

- [ ] **Step 1: Install dependencies.**
  - `npm i preact @preact/signals leaflet tweetnacl`
  - `npm i -D vite @preact/preset-vite typescript vitest jsdom @testing-library/preact @types/leaflet playwright`
- [ ] **Step 2: Configure the build and tests.**
  - `vite.config.ts`:
    - `root: web/configurator`, `base: '/configurator/'`;
    - `build.outDir: '../../dist/configurator'`, `emptyOutDir: true`;
    - `server.proxy` sends `/api` and `/data` to `http://localhost:8000`;
    - `test: { environment: 'jsdom', include: ['tests/**/*.test.{ts,tsx}'] }`.
  - `package.json` scripts:
    - `"dev": "vite --config web/configurator/vite.config.ts"`, `"build"` the same with `vite build`;
    - `"test": "vitest run --config web/configurator/vite.config.ts"`;
    - `"typecheck": "tsc -p web/configurator --noEmit"`.
  - Keep `"test:legacy": "node --test \"tests/js/*.test.mjs\""` until Task 19.
- [ ] **Step 3: Write `tests/firmware.test.ts`.** Port the cases from `tests/js/firmware.test.mjs`:
  - `parseVersion("v1.17.1 (Build: 14 Aug 2026)")` gives `{major:1,minor:17,patch:1}`;
  - `parseVersion("garbage")` gives `null`;
  - `supportsRegionDef` is true for 1.16.0 and false for 1.15.9.
- [ ] **Step 4:** `npm test` shows FAIL (module missing).
- [ ] **Step 5: Implement `core/firmware.ts`.** Same regex as `src/configurator/firmware.js`:
  `/\bv?(\d+)\.(\d+)(?:\.(\d+))?/i`.
- [ ] **Step 6: Run the checks.**
  - `npm test` passes.
  - `npm run typecheck` is clean.
  - `npm run build` writes `dist/configurator/index.html`.
- [ ] **Step 7: Commit.** `feat(RRY-Map-Bot): configurator app scaffold (Vite+Preact+TS)`, including
  `package-lock.json`.

### Task 2: Serve the app from Flask and build it in Docker

**Files:**
- Modify: `backend/api/app.py` (the `/configurator` route near line 1402), `Dockerfile`, `.dockerignore`
- Create: `tests/test_configurator_routes.py`

**Interfaces:**
- Produces: module constant `CONFIGURATOR_DIST = os.path.join(PROJECT_ROOT, 'dist', 'configurator')`;
  `/configurator` returns its `index.html`; `/configurator/<path:path>` serves files under it (404 if missing).

- [ ] **Step 1: Write the tests.** In `tests/test_configurator_routes.py`, monkeypatch `app_module.CONFIGURATOR_DIST`
  to a temp dir containing `index.html` and `assets/x.js`.
  - `test_configurator_serves_built_index`: GET `/configurator` returns 200 with the index body.
  - `test_configurator_serves_assets`: GET `/configurator/assets/x.js` returns 200 with a JavaScript mimetype.
  - `test_configurator_missing_asset_404`.
  - `test_region_configurator_redirects` gives 301 to `/configurator`.
- [ ] **Step 2:** Run the four tests. Expected: FAIL.
  `pytest tests/test_configurator_routes.py -q` (venv:
  `/tmp/claude-1000/-home-confi-CarrezOps/d47fdfd3-8d7c-4412-813a-b4ae69915a7b/scratchpad/venv/bin/pytest`).
- [ ] **Step 3: Implement the two routes** with `send_from_directory(CONFIGURATOR_DIST, ...)`. Register
  `/configurator/<path:path>` before the catch-all.
- [ ] **Step 4: Change the Dockerfile.**
  - Add a first stage `FROM node:22-slim AS web`: `WORKDIR /app`, copy `package.json`, `package-lock.json` and
    `web/`, then `npm ci && npm run build`.
  - In the Python stage, after `COPY . .`, add `COPY --from=web /app/dist/configurator /app/dist/configurator`.
  - Append `._*` and `dist/` to `.dockerignore`.
- [ ] **Step 5: Run the checks.**
  - `pytest -q` gives 41 passed (37 existing + 4 new).
  - `docker build -t rry-map-bot:configurator-test .` succeeds.
  - In that image, `curl -s localhost:8000/configurator` returns the Vite index. Run it with
    `docker run --rm -d -p 8765:8000 rry-map-bot:configurator-test`, then curl, then stop it.
- [ ] **Step 6: Commit.**

### Task 3: Capture parity fixtures from the old page

This must happen before any old file is touched, because it records the old page's real output.

**Files:**
- Create: `scripts/capture-configurator-parity.mjs`, `web/configurator/tests/fixtures/parity/<scenario>.{backup.json,script.txt}`

**Interfaces:**
- Produces: six fixture pairs. `*.backup.json` is the old export format
  `{app:"bemesh-configurator",version:1,exportedAt,fields:{<elementId>:value}}`. `*.script.txt` holds the text of
  `#commands-block` with "show defaults" off.

- [ ] **Step 1: Write the capture script.**
  - It serves the repo root with `python3 -m http.server 8799` and opens `/configurator.html` in Playwright Chromium.
  - For each scenario:
    1. type into `#city-search` and click `#city-dropdown .search-dropdown-item[data-index="0"]`;
    2. set the listed element IDs and dispatch `input` and `change`;
    3. click the listed policy checkboxes (`#pc_<code>_a` / `#pc_<code>_d`);
    4. save the download from the Export JSON button and `#commands-block` `textContent`.
- [ ] **Step 2: Define the six scenarios in the script.**
  - `ronse-solar`: search "Ronse", `name-power-emoji`="🌞", `name-suffix`="Kluisberg".
  - `brussels`: search "Brussel", suffix "Atomium".
  - `border-deny`: search "Ronse", then check `#pc_<first Henegouwen neighbour>_d`. The script picks the first
    `.policy-deny` whose code's province is `be-wht`.
  - `no-location`: no search, suffix "Test".
  - `advanced-all`: Ronse, plus every advanced field set off its default: txdelay 0.7, direct-txdelay 0.4,
    rxdelay 2, rxgain off, int-thresh 10, agc-reset 8, multi-acks 1, loop-detect strict, path-hash-mode 2,
    flood-max 32, owner-info "Ops team", guest password "guest", tx power 20.
  - `admin-password`: Ronse, `setting-admin-password`="S3cret".
- [ ] **Step 3: Run** `node scripts/capture-configurator-parity.mjs`. Expected: 12 files. Each `script.txt` is
  non-empty and contains `region` lines, except `no-location`.
- [ ] **Step 4: Commit.**

### Task 4: Port search and vanity

**Files:**
- Create: `core/search.ts`, `core/vanity.ts`, `tests/search.test.ts`, `tests/vanity.test.ts`

**Interfaces:**
- Produces:
  - `type Place = {nis5:string; plaats:string; gemeente:string; province_code:string; city_code:string; search_aliases?:string[]; lat:number; lon:number}`
    (the shape of the rows in `/data/be-locode.json`)
  - `normalize(s:string):string`
  - `rankPlaces(places:Place[], query:string):Place[]`
  - `meshcorePrivateKeyFromSeed(seed:Uint8Array, sha512:(m:Uint8Array)=>Uint8Array):Uint8Array`
  - `isAllowedPrefix(prefix:string):boolean`
  - `pubkeyFromSetReply(reply:string):string|null`

- [ ] **Step 1: Port the tests** from `tests/js/search.test.mjs` and `tests/js/vanity.test.mjs` unchanged in meaning.
  - Search: Ronse ranks before Lievegem; accents; Gent; the city code `beron`; stable order.
  - Vanity reference vector: seed `000102…1f` gives the private key starting `3894eea4` and the public key starting
    `03a107bf`.
- [ ] **Step 2:** Run. Expected: FAIL.
- [ ] **Step 3: Implement** both modules from `src/configurator/search.js` and `vanity.js`. Use `nacl.hash` from the
  `tweetnacl` package.
- [ ] **Step 4:** Run. Expected: PASS.
- [ ] **Step 5: Commit.**

### Task 5: Settings registry and radio presets

**Files:**
- Create: `core/settings.ts`, `core/presets.ts`, `core/radio-presets.json`, `scripts/update-radio-presets.mjs`,
  `tests/settings.test.ts`, `tests/presets.test.ts`

**Interfaces:**
- Produces:
  - `type SettingKey = 'repeat'|'ownerInfo'|'guestPassword'|'adminPassword'|'dutycycle'|'floodAdvertHours'|'advertIntervalMinutes'|'floodMaxUnscoped'|'floodMaxAdvert'|'floodMax'|'pathHashMode'|'loopDetect'|'txdelay'|'directTxdelay'|'rxdelay'|'radioRxgain'|'intThresh'|'agcResetInterval'|'multiAcks'|'txPower'`
  - `type SettingDef = {key:SettingKey; readCmd?:string; cliKey:string; card:'access'|'radio'|'advertising'|'owner'|'repeating'|'advanced'; firmwareDefault:string|number|null; formDefault:string|number|null; range?:{min:number;max:number;step?:number}; options?:string[]; helpKey:string}`
  - `SETTINGS: SettingDef[]`
  - `validateSetting(key:SettingKey, raw:string): {ok:true; value:string|number} | {ok:false; errorKey:string}`
  - `adminPasswordCliLine(value:string): string|null`
  - `type RadioPreset = {title:string; freq:number; sf:number; bw:number; cr:number}`
  - `RADIO_PRESETS: RadioPreset[]`
  - `BEMESH_PRESET_TITLE = "EU/UK (Narrow)"`
  - `presetForRadio(r:{freq:number;sf:number;bw:number;cr:number}): RadioPreset|null`
  - `FIRMWARE_DEFAULT_RADIO = {freq:869.618,bw:62.5,sf:8,cr:5}`
  - `RECOMMENDED_SETTINGS` and `FLOOD_ALLOWANCE = {minimal:[4,6],average:[8,12],extended:[16,24],full:[64,64]}`
- Values: copy `FIRMWARE_DEFAULTS`, the form defaults and `RECOMMENDED_SETTINGS` from `src/configurator.js:2682-2743`
  exactly.

- [ ] **Step 1: Write the update script.** `scripts/update-radio-presets.mjs` fetches
  `https://api.meshcore.nz/api/v1/config` and writes `config.suggested_radio_settings.entries` as `{title,freq,sf,bw,cr}`
  numbers to `radio-presets.json` (26 entries as of 2026-10-24). `presets.ts` cites the URL in a comment. Run it.
- [ ] **Step 2: Write the tests.**
  - `RADIO_PRESETS.length === 26` and includes "Netherlands (Limburg)".
  - `presetForRadio({freq:869.618,sf:8,bw:62.5,cr:8})?.title === "EU/UK (Narrow)"`.
  - `validateSetting('advertIntervalMinutes','61')` gives `ok`, value 62 (rounded to even).
  - `'30'` gives `errorKey 'range'` (60–240 or 0); `'0'` is ok.
  - `validateSetting('floodAdvertHours','2')` errors (3–168 or 0).
  - `validateSetting('agcResetInterval','10')` gives 8 (round down to a multiple of 4).
  - `validateSetting('txdelay','2.5')` errors (0–2).
  - `adminPasswordCliLine('')===null`; `adminPasswordCliLine(' s3cret ')==='password s3cret'`.
  - `validateSetting('adminPassword','x'.repeat(16))` errors (15-byte limit).
  - Every `SETTINGS` entry has an `en.json` help key (load the JSON in the test).
- [ ] **Step 3:** Run. Expected: FAIL.
- [ ] **Step 4: Implement** both modules and add the help strings to `src/i18n/en.json` (create the file). Each help
  string states the range and the factory default, taken from the official tool texts the spec lists.
- [ ] **Step 5:** Run. Expected: PASS.
- [ ] **Step 6: Commit.**

### Task 6: Naming and text limits

**Files:**
- Create: `core/naming.ts`, `tests/naming.test.ts`

**Interfaces:**
- Produces:
  - `utf8Bytes(s:string):number`
  - `NAME_MAX_WITH_LOCATION = 23`, `NAME_MAX = 31`, `OWNER_INFO_MAX = 119`
  - `type PrefixFormat = 'city'|'province'|'country'|'none'`
  - `buildPrefix(format:PrefixFormat, place:Place|null, provinceCode:string|null): string`
  - `buildName(prefix:string, suffix:string, power:'🌞'|'⚡'|'🔋'|'👀'|''): string`
  - `checkName(name:string, advertHasLocation:boolean): {bytes:number; max:number; badChars:string[]; ok:boolean}`
  - `encodeOwnerInfo(text:string): string` (newline → `|`)
  - `checkOwnerInfo(text:string): {bytes:number; max:119; ok:boolean}` (counts the encoded form)
- Port: `citySegment`, `provinceSegment`, `normalizePrefix`, `buildNamePrefix`, `buildRepeaterName`,
  `splitNameSuffixAndEmoji` from `src/configurator.js:2444-2640` and `358`.

- [ ] **Step 1: Write the tests.**
  - `buildPrefix('city', ronse,…)==='BE-RON-'`.
  - `checkName('BE-RON-Kluisberg🌞', true)` gives 20 bytes, ok.
  - A 21-character ASCII name plus 🌞 with a location gives 25 bytes, not ok.
  - `checkName('a:b', false).badChars` deep-equals `[':']`.
  - `encodeOwnerInfo('a\nb')==='a|b'`.
  - `checkOwnerInfo('x'.repeat(119)).ok`; 120 characters is not ok.
  - `checkOwnerInfo('é'.repeat(60))` gives 120 bytes, not ok.
- [ ] **Step 2:** Run. Expected: FAIL.
- [ ] **Step 3: Implement** with `TextEncoder`.
- [ ] **Step 4:** Run. Expected: PASS.
- [ ] **Step 5: Commit.**

### Task 7: Geography and data loading

**Files:**
- Create: `core/geo.ts`, `core/data.ts`, `core/be-regions.ts`, `tests/geo.test.ts`

**Interfaces:**
- Produces:
  - `haversineKm(a:LatLon, b:LatLon):number`, with `type LatLon={lat:number;lon:number}`
  - `type MeshNode = {public_key:string; type:number; adv_name:string; adv_lat:number; adv_lon:number}`
  - `nodesWithin(nodes:MeshNode[], center:LatLon, km=25): MeshNode[]` (types 2 and 3 only, sorted by distance)
  - `type MunicipalityFeature = GeoJSON Feature with properties {nis5,plaats,gemeente,province_code,city_code}`
  - `municipalityAt(p:LatLon, features:MunicipalityFeature[]): MunicipalityFeature|null` (ray casting over Polygon
    and MultiPolygon, outer ring minus holes)
  - `findGeographicNeighbors(place:Place, places:Place[]): {place:Place; km:number}[]` (port of
    `src/configurator.js:2337-2392`, including `NEIGHBOR_RADIUS_KM = 25` and `NEIGHBOR_SCOPE_MAX_CITIES = 10`)
  - `loadPlaces()`, `loadMunicipalities()`, `loadProvinces()`, `loadGewesten()`, `loadNodes()`: each
    `Promise<T>` fetching `/data/be-locode.json`, `/data/be-municipalities.geojson`, `/data/be-provinces.geojson`,
    `/data/be-gewesten.geojson`, `/api/v1/belgian-nodes`. They reject on a non-2xx response.
  - `be-regions.ts` imports `src/shared/be-regions.js` for its side effect (the file ends with `})(window)`, so jsdom
    and the browser both run it) and re-exports `PROVINCE_NAMES`, `PROVINCE_CODES`, `GEWEST_NAMES` and
    `GEWEST_OF_PROVINCE` from `window.RRYRegions`. That file stays the single source of province data.

- [ ] **Step 1: Write the tests.** Use a fixture of 3 municipality polygons cut from `data/be-municipalities.geojson`
  (Ronse, Kluisbergen, Ellezelles), saved as `tests/fixtures/municipalities-3.json`.
  - `municipalityAt({lat:50.7461,lon:3.6012})?.properties.city_code==='beron'`.
  - A point in the North Sea `{lat:51.6,lon:2.5}` gives `null`.
  - `nodesWithin` keeps a repeater at 10 km and drops one at 30 km, drops type 1 at 1 km, and keeps a type-3 node.
  - `findGeographicNeighbors(ronse, allPlaces)` includes Kluisbergen and has ≤ 10 entries.
- [ ] **Step 2:** Run. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run. Expected: PASS.
- [ ] **Step 5: Commit.**

### Task 8: Region policy

**Files:**
- Create: `core/regions.ts`, `tests/regions.test.ts`

**Interfaces:**
- Consumes: `Place`, `findGeographicNeighbors`, `be-regions` (Tasks 4 and 7).
- Produces:
  - `type Anchor = {mode:'city'|'province'|'country'; province_code:string|null; place:Place|null}`
  - `type RegionRow = {code:string; labelKey:string; label:string; group:'country'|'province'|'municipality'|'neighbour'|'device'; allow:boolean; deny:boolean; home?:boolean}`
  - `type RegionPolicy = {rows:RegionRow[]; untaggedFlood:boolean; homeOverride:string|null; defaultScope:string|null}`
  - `policyFor(anchor:Anchor, places:Place[], deviceCodes?:string[]): RegionPolicy` (the default rows and checks,
    as `renderPolicyGrids` + `applyPolicyDefaults` produce)
  - `bulk(policy:RegionPolicy, action:'recommended'|'allowAll'|'denyAll'|'clear'): RegionPolicy`
  - `regionCommandLines(anchor:Anchor, policy:RegionPolicy, places:Place[]): string[]` (port of
    `buildRegionCommandLines` and its helpers, `src/configurator.js:3419-4714`: region def packing, allowf/denyf
    ordering, home and default lines)
  - `homeRegionCode(policy):string|null`, `regionsByState(policy): {allowed:string[]; denied:string[]}` (for map
    colouring)
- Port rule: copy the algorithms, replacing every DOM read (checkbox state, select values) with the `RegionPolicy`
  fields. Keep `CLI_ORDER_FIRST`, `HOME_OVERRIDE_OMIT` and `DEFAULT_SCOPE_NONE` semantics.

- [ ] **Step 1: Write the tests.** For each parity fixture except `no-location`:
  - build the anchor from the fixture's `city-search` value via `rankPlaces(...)[0]`;
  - build the policy from `policyFor` plus the fixture's `pc_*_a` / `pc_*_d` fields;
  - assert `regionCommandLines(...)` equals the `region…` lines of `script.txt`, in order.
- [ ] **Step 2:** Run. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run. Expected: PASS for all 5.
- [ ] **Step 5: Commit.**

### Task 9: Plan, script builder, backup

**Files:**
- Create: `core/plan.ts`, `core/cli.ts`, `core/backup.ts`, `tests/plan.test.ts`, `tests/cli.test.ts`,
  `tests/backup.test.ts`

**Interfaces:**
- Consumes: Tasks 5–8.
- Produces:
  - `type Plan = {location:{lat:number;lon:number}|null; anchor:Anchor|null; advertLoc:'none'|'prefs'|'share'; prefixFormat:PrefixFormat; nameSuffix:string; power:''|'🌞'|'⚡'|'🔋'|'👀'; radio:{freq:number;sf:number;bw:number;cr:number}; settings:Partial<Record<SettingKey,string|number>>; regions:RegionPolicy|null}`
  - `defaultPlan(): Plan` (#BEmesh recommendation, EU/UK Narrow)
  - `type DeviceSnapshot = {name?:string; radio?:Plan['radio']; settings:Partial<Record<SettingKey,string|number>>; lat?:number; lon?:number; advertLoc?:Plan['advertLoc']; regions?:{home?:string; default?:string; allowed:string[]; denied:string[]}; version?:string; role?:string; publicKey?:string; clock?:string; missing:string[]}`
  - `planFromSnapshot(s:DeviceSnapshot, places:Place[]): Plan` (port of `applyReadResultsToForm` and the helpers it
    calls, `src/configurator.js:968-1760`)
  - `type ScriptGroup = {titleKey:'name'|'settings'|'location'|'regions'; lines:string[]}`
  - `buildScript(plan:Plan, places:Place[], opts:{includeDefaults:boolean}): ScriptGroup[]`
  - `scriptText(groups:ScriptGroup[]): string` (adds a `# <title>` comment per group)
  - `commandLines(groups):string[]` (no comments; what Apply sends)
  - `type Change = {group:ScriptGroup['titleKey']; labelKey:string; to:string; from?:string}`
  - `summarize(plan:Plan, snapshot?:DeviceSnapshot): {changes:Change[]; adminPassword:'kept'|'changed'}`
  - `importBackup(json:unknown, places:Place[]): Plan`: accepts old v1 `fields` and new v2
    `{app:"bemesh-configurator",version:2,plan}`; throws `BackupError` with a message key on anything else
  - `exportBackup(plan:Plan): object` (v2)
- Order rule: `buildScript` emits commands in exactly the old order (`buildConfiguratorSections`): name, then the
  general settings in `buildGeneralSettingsCli` order with lat/lon/gps last, then the region lines. Groups only add
  comment headers at those boundaries.

- [ ] **Step 1: Write the parity test** in `cli.test.ts`. For all 6 fixtures,
  `commandLines(buildScript(importBackup(backup), places, {includeDefaults:false}))` equals the non-comment, trimmed,
  non-empty lines of `script.txt`.
- [ ] **Step 2: Write the backup tests.**
  - A v1 backup whose `setting-radio-preset` is `"2"` but whose freq/sf/bw/cr are 869.618/8/62.5/8 imports with radio
    EU/UK Narrow values (Review focus 1).
  - A v2 export → import round trip is deep-equal.
  - `importBackup({foo:1})` throws `BackupError`.
- [ ] **Step 3: Write the plan tests.**
  - `summarize(defaultPlan()).adminPassword==='kept'`; with `settings.adminPassword='x'` it is `'changed'`.
  - `summarize` with a snapshot whose `floodAdvertHours` is 3 and a plan with 12 gives
    `{labelKey:'floodAdvertHours', from:'3', to:'12'}`.
  - `planFromSnapshot` on a recorded `fake-port` transcript (Task 10 fixture: write it here first as
    `tests/fixtures/read-ronse.json`, a map of command → reply) yields name suffix "Kluisberg", power 🌞 and anchor
    Ronse.
- [ ] **Step 4:** Run. Expected: FAIL.
- [ ] **Step 5:** Implement.
- [ ] **Step 6:** Run. Expected: all PASS.
- [ ] **Step 7: Commit.**

### Task 10: Device layer

**Files:**
- Create: `device/serial.ts`, `device/repeater.ts`, `tests/fakes/fake-port.ts`, `tests/repeater.test.ts`

**Interfaces:**
- Produces:
  - `interface PortLike { open(o:{baudRate:number}):Promise<void>; readable:ReadableStream<Uint8Array>|null; writable:WritableStream<Uint8Array>|null; close():Promise<void>; addEventListener?(t:'disconnect',f:()=>void):void }`
  - `class SerialLink { constructor(port:PortLike); open():Promise<void>; command(cmd:string, timeoutMs?:number):Promise<string>; close():Promise<void>; onDisconnect(f:()=>void):void }`:
    a port of `src/repeater-serial.js` with the same line framing, prompt handling and timeouts.
  - `requestUsbPort(): Promise<PortLike>` (wraps `navigator.serial.requestPort`)
  - `hasWebSerial(): boolean`
  - `READ_COMMANDS` (the list at `src/configurator.js:309-343`, verbatim)
  - `readAll(link:SerialLink): Promise<DeviceSnapshot>`: parses each reply; a failed or timed-out command goes into
    `snapshot.missing`
  - `apply(link:SerialLink, lines:string[], onProgress:(sent:number,total:number)=>void): Promise<{ok:true} | {ok:false; failedAt:number; command:string; error:string; remaining:string[]}>`:
    stops at the first failure and never retries
  - `run(link, cmd): Promise<string>`
  - `checkFirmware(link): Promise<{state:'ok'|'old'|'unknown'; version:string|null}>` (re-sends `ver`)
- `fake-port.ts`: `new FakePort(replies:Record<string,string>, opts?:{disconnectAfter?:number})` implements
  `PortLike`, replying with the prompt the real firmware uses.

- [ ] **Step 1: Write the tests.**
  - `readAll` over `tests/fixtures/read-ronse.json` gives a snapshot with `name` and `radio`, and `missing` is empty.
  - With `disconnectAfter:5`: `readAll` resolves with the first 5 parsed and the rest in `missing`, and the
    `onDisconnect` callback fired (Review focus 4).
  - `apply` over 10 lines with `disconnectAfter:4` gives `{ok:false, failedAt:4, remaining.length:6}`, and the
    progress callback saw 1, 2, 3, 4.
  - `checkFirmware` gives `'old'` for `v1.15.0`, `'unknown'` for an empty reply, `'ok'` for `v1.17.1`.
- [ ] **Step 2:** Run. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run. Expected: PASS.
- [ ] **Step 5: Commit.**

### Task 11: Store, i18n, theme

**Files:**
- Create: `state/store.ts`, `i18n/t.ts`, `theme/tokens.css`, `theme/app.css`, `tests/store.test.ts`, `tests/i18n.test.ts`

**Interfaces:**
- Produces:
  - `t(key:string, params?:Record<string,string|number>): string` (`{name}` interpolation; `key_one` / `key_other`
    via `Intl.PluralRules('en')`; a missing key returns the key and warns once)
  - `store` signals:
    - `plan: Signal<Plan>`
    - `snapshot: Signal<DeviceSnapshot|null>`
    - `device: Signal<{status:'none'|'connecting'|'connected'; link:SerialLink|null; firmware:string|null}>`
    - `step: Signal<1|2|3|4|5>`
    - `sheet: Signal<'peek'|'half'|'full'>`
    - `layers: Signal<{nodes:boolean; borders:boolean}>`
    - `theme: Signal<'system'|'light'|'dark'>`
    - `data: Signal<{places?:Place[]; municipalities?; provinces?; gewesten?; nodes?:MeshNode[]; failed:Set<string>}>`
  - `stepStatus(n): 'done'|'current'|'attention'|'todo'` (computed). Step 3 is `attention` when `plan.anchor` is
    null; step 2 when the name check or a coordinate is invalid; step 4 when any setting fails `validateSetting`.
  - `canApply: Computed<{ok:boolean; reasons:string[]}>`
  - `prefs.get(key)` / `prefs.set(key, v)`: localStorage wrapped in try/catch
- Tokens: `--gold:#D4A017`, `--gold-bg:#FBF4DC`, `--ink:#1F2328`, `--mut:#6B7280`, `--line:#E3E5E8`, `--ok:#1A7F37`,
  `--warn:#B26A00`, `--bad:#C62828`. The dark set uses the values of the approved dark mockup (`#161B22` panel,
  `#0D1117` bar, `#30363D` lines, `#E6EDF3` text).
  - Define them on `:root`.
  - Redefine them under `@media (prefers-color-scheme: dark)` guarded by `:root:not([data-theme="light"])`, and
    under `:root[data-theme="dark"]`.

- [ ] **Step 1: Write the tests.**
  - `stepStatus(3)==='attention'` when the anchor is null.
  - Setting `theme` to `'dark'` writes `data-theme="dark"` on `<html>`.
  - With `localStorage.setItem` stubbed to throw, `prefs.set` doesn't throw and `theme` still updates (Review focus 5).
  - `t('changes_other',{count:3})` and the `_one` form both resolve.
- [ ] **Step 2:** Run. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run. Expected: PASS.
- [ ] **Step 5: Commit.**

### Task 12: App shell

**Files:**
- Create: `app/App.tsx`, `TopBar.tsx`, `Stepper.tsx`, `Panel.tsx`, `Notice.tsx`, `Dialog.tsx`; modify `main.tsx`
- Test: `tests/shell.test.tsx`

**Interfaces:**
- Produces:
  - `<Notice kind="ok"|"warn"|"error">`
  - `<Dialog open title onClose actions>`, built on `<dialog>`. It replaces every `alert` and `confirm`.
  - `<Panel>` renders the docked mode for steps 1–3 and the full-width mode for steps 4–5 (map hidden), and becomes a
    bottom sheet under 768 px. It is driven by `store.step` and a `matchMedia` hook.
- **Stepper:** 5 segments coloured from `stepStatus`; clicking a segment sets `store.step`.
  - Docked header: "N / 5", the step name, "Next: X".
  - Full width: all five labels with ✓ on done.
- **TopBar:** wordmark, connection chip, 📍 chip (steps 4–5 only; click sets step 2), 🛠 and the theme toggle.

- [ ] **Step 1: Write the tests.**
  - Clicking segment 4 sets step 4 and the map container gets `hidden`.
  - On step 4 the 📍 chip shows `"<name> · <gemeente>"`, and clicking it returns to step 2.
  - Segment 3 has class `attention` when the anchor is null.
  - At a 500 px matchMedia stub the panel renders as a sheet with a grab handle.
- [ ] **Step 2:** Run. Expected: FAIL.
- [ ] **Step 3:** Implement (step bodies are placeholders until Tasks 14–17).
- [ ] **Step 4:** Run. Expected: PASS.
- [ ] **Step 5: Commit.**

### Task 13: Map view

**Files:**
- Create: `app/MapView.tsx`; Test: `tests/mapview.test.tsx`

**Interfaces:**
- Consumes: `store.plan.location`, `store.data`, `store.layers`, `regionsByState`.
- Produces: `<MapView>` with:
  - a draggable pin (a drag or a click sets `plan.location`);
  - a 25 km dashed circle;
  - a nodes layer (▲ for type 2, ■ for type 3, tooltip with `adv_name`);
  - a borders layer with the matched municipality highlighted;
  - on step 3, polygons coloured green (allowed) or red-hatched (denied);
  - a switches control showing "Nearby nodes (N)" and "Borders". When the data in `store.data.failed` is missing,
    the switch shows "unavailable" and is disabled.

- [ ] **Step 1: Write the tests.** Mock Leaflet's `L.map` with a recorder.
  - A click event sets `plan.location`.
  - With `data.failed` containing `'nodes'`, the switch text is "unavailable".
  - With 3 nodes (types 1, 2, 3 within 25 km) the layer gets 2 markers.
- [ ] **Step 2:** Run. Expected: FAIL.
- [ ] **Step 3:** Implement. Load `municipalities` lazily after first paint.
- [ ] **Step 4:** Run. Expected: PASS.
- [ ] **Step 5: Commit.**

### Task 14: Steps 1 and 2 (Connect, Place & name)

**Files:**
- Create: `steps/Connect.tsx`, `steps/PlaceName.tsx`; Test: `tests/steps-connect-place.test.tsx`

**Behaviour (from the spec, *The five steps*, 1–2):**
- **Connect:** the device card, Read (asks via `<Dialog>` before overwriting a plan the user has edited), "Continue
  without a device", and a no-Web-Serial explanation.
- **Place & name:**
  - search (`rankPlaces`);
  - map pick, with the municipality resolved by `municipalityAt`;
  - "Use my location", only when `isSecureContext && 'geolocation' in navigator`;
  - the advert-location segment;
  - prefix format, suffix and power, with a live byte counter (red over the limit) and bad-character errors;
  - the nearby-name check against `nodesWithin`. If the nodes failed to load it says "couldn't check nearby names".

- [ ] **Step 1: Write the tests.**
  - With `hasWebSerial()` false, the Connect step shows the explanation and "Continue without a device".
  - Searching "Ronse" and picking the first result sets the anchor to Ronse and the prefix to `BE-RON-`.
  - A map pick at `{lat:51.6,lon:2.5}` keeps the location, leaves the anchor null and shows the outside-Belgium notice
    (Review focus 2).
  - A suffix that puts the name at 24 bytes with a location turns the counter red, and `canApply.ok` is false.
  - A nearby node named `BE-RON-Kluisberg` produces the "already used nearby" warning.
- [ ] **Step 2:** Run. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run. Expected: PASS.
- [ ] **Step 5: Commit.**

### Task 15: Step 3 (Regions)

**Files:**
- Create: `steps/Regions.tsx`; Test: `tests/steps-regions.test.tsx`

**Behaviour:**
- Rows grouped by `RegionRow.group`, each with an Allow / – / Deny segmented control.
- Bulk buttons: Recommended, Allow all, Deny all, Clear.
- A folded section with untagged traffic, the default scope and the home override (with the "not active in current
  firmware" note, as today).
- A "What are regions?" link to `https://meshwiki.radio-actief.be/index.php/MeshCore/RegioScopes`.
- Without an anchor: a notice and no rows.

- [ ] **Step 1: Write the tests.**
  - After selecting Ronse, the rows include `be`, `be-vov` and `beron` (home).
  - Clicking Deny on a neighbour moves its code into `regionsByState().denied`.
  - "Clear" leaves no allow and no deny.
- [ ] **Step 2:** Run. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run. Expected: PASS.
- [ ] **Step 5: Commit.**

### Task 16: Step 4 (Settings, full width)

**Files:**
- Create: `steps/Settings.tsx`; Test: `tests/steps-settings.test.tsx`

**Behaviour:**
- Cards come from `SETTINGS` grouped by `card`: Access, Radio (preset select from `RADIO_PRESETS` plus custom fields),
  Advertising & hops (`FLOOD_ALLOWANCE` pills), Owner info (textarea with a byte counter), Repeating, and a folded
  Advanced bar.
- Every field shows its `helpKey` text.
- Card badges: "unchanged", "recommended ✓", or `t('changes',{count})`.
- A changed field gets a gold outline and, when a snapshot exists, "was X".
- The right column has a mini map preview (a static Leaflet map, no interaction), the `summarize()` list (always
  including the admin-password line), and Back / Next.

- [ ] **Step 1: Write the tests.**
  - The admin password placeholder is "Leave empty to keep the current one", and the summary shows "Admin password
    stays as it is".
  - Typing `30` in zero-hop advert shows the range error and the Settings segment turns `attention`.
  - Choosing the "Average" pill sets `floodMaxUnscoped` 8 and `floodMaxAdvert` 12.
  - Owner info containing a newline counts the `|` form.
- [ ] **Step 2:** Run. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run. Expected: PASS.
- [ ] **Step 5: Commit.**

### Task 17: Step 5 (Review & send)

**Files:**
- Create: `steps/Review.tsx`, `app/Console.tsx`; Test: `tests/steps-review.test.tsx`

**Behaviour:**
- **Left:** the `summarize()` changes, grouped, and the admin-password line.
- **Right:** `scriptText(buildScript(...))` with an "Include unchanged defaults" toggle (the old `cli-show-defaults`).
- **Buttons:** Copy script, Download `.txt` (`bemesh-repeater-commands.txt`), and Console. The console is a `<Dialog>`
  with the command log and an input with history, ported from `sendSerialConsoleCommand` (max 50 entries); its
  "Show command log" pref is stored with `prefs`.
- **Apply to repeater:**
  1. disabled with the reasons listed when `!canApply.ok`;
  2. `checkFirmware`: `'old'` gives a blocking notice; `'unknown'` gives a `<Dialog>` "Continue anyway";
  3. `apply(...)` with the progress bar;
  4. on failure, a notice "Stopped at command N of M: `<cmd>`" with a "Copy remaining commands" button;
  5. on success, a `<Dialog>` offering Reboot now / Later (port of `offerRepeaterReboot`).

- [ ] **Step 1: Write the tests.** Use `FakePort`.
  - Apply with firmware `v1.15.0` never writes, shows the blocking notice and keeps Apply disabled.
  - A successful Apply shows progress reaching M/M, then the reboot dialog.
  - A disconnect at command 3 shows "Stopped at command 3", and "Copy remaining commands" copies the remaining lines
    (stub `navigator.clipboard`).
  - The script text starts with `# ` group headers, and the command lines equal `commandLines(...)`.
- [ ] **Step 2:** Run. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run. Expected: PASS.
- [ ] **Step 5: Commit.**

### Task 18: Device tools drawer

**Files:**
- Create: `app/DeviceDrawer.tsx`; Test: `tests/drawer.test.tsx`

**Behaviour (port of `src/configurator.js:5327-5700`):**
- **Device:** the clock with Sync (`clock sync`), Copy public key, zero-hop advert (`advert.zerohop`), flood advert
  (`advert`). Keep the exact commands `sendRepeaterAdvert` uses.
- **Identity:** private key Reveal / Copy (`ensurePrivateKeyLoaded`). "Generate vanity key…" runs a `<Dialog>` with a
  hex-prefix input (`isAllowedPrefix`), generates with `meshcorePrivateKeyFromSeed`, writes `set prv.key`, and checks
  `pubkeyFromSetReply` against the expected key, as in part 0.
- **Backup:** Export (`exportBackup`, file `bemesh-repeater-config.json`) and Import (`importBackup`; a `BackupError`
  shows a notice).
- **Maintenance:** Reboot and Start OTA (each confirmed by a `<Dialog>`).
- **Danger zone:** Factory reset needs the user to type `RESET`, then sends the same erase command as today.
- Without a connected device, the device actions are disabled; Backup stays enabled.

- [ ] **Step 1: Write the tests.**
  - Factory reset stays disabled until `RESET` is typed.
  - Import of a v1 parity backup sets the plan and closes the drawer.
  - Vanity prefix "00" is rejected.
  - With no device, Reboot is disabled and Export is enabled.
- [ ] **Step 2:** Run. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run. Expected: PASS.
- [ ] **Step 5: Commit.**

### Task 19: Remove the old page and finish

**Files:**
- Delete: `configurator.html`, `src/configurator.js`, `src/configurator/`, `src/repeater-serial.js`,
  `css/configurator-page.css`, `lib/tweetnacl.min.js`, `tests/js/`
- Modify: `package.json` (drop `test:legacy`), `README.md` (configurator section: `npm run dev`, `npm test`,
  `npm run build`, where the app lives)

- [ ] **Step 1: Check nothing else uses the old files.**
  `grep -rn "configurator.js\|repeater-serial\|tweetnacl.min\|configurator-page.css" --include=*.html --include=*.js --include=*.py .`
  must show only files being deleted. Then delete them.
- [ ] **Step 2: Run every check.**
  - `npm test` passes.
  - `npm run typecheck` is clean.
  - `npm run build` succeeds.
  - `pytest -q` gives 41 passed.
  - `docker build .` succeeds.
- [ ] **Step 3: Browser smoke test** with Playwright against `vite preview` (scratch script, not committed):
  1. "Continue without a device";
  2. search Ronse;
  3. jump to step 5;
  4. the script contains `region home beron`;
  5. no console errors at 1400 px and 390 px widths.
  Take screenshots for the user.
- [ ] **Step 4: Commit.** `feat(RRY-Map-Bot): replace configurator page with the new app`.
- [ ] **Step 5: Hardware acceptance on the Mac.**
  - Message the "RRY-Map-Bot Dev Env" session with the commit SHA (sent after the commit completes, never in the
    same batch). It follows the standing test rule: check HEAD, rebuild, hard-reload.
  - The user runs Connect → Read → change the flood advert → Apply with an empty admin password, then confirms the
    old password still works.
  - Report the result to the user.
