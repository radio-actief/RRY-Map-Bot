# Configurator part 2: guided flow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the part 1 configurator into the guided Place → Name → Site → Regions → Send flow with an optional Advanced step. Add site profiles, free regions, the United Kingdom and country borders, per-block recommended settings with undo, the Tight hop level, the "On repeater" tag and a hold-to-show admin password.

**Architecture:** Pure logic goes in `core/`: `site.ts` and `blocks.ts` are new, and `regions.ts` and `settings.ts` are extended. Each piece is unit-tested without the DOM. The step screens in `steps/` are split along the new step list, and step ids become strings. The store gains `startPlan`, the plan that the badges, outlines and undo measure against.

**Tech Stack:** Vite 8, Preact, TypeScript, @preact/signals, Leaflet, Vitest + jsdom + @testing-library/preact. Python 3 + shapely for the borders script.

**Spec:** `docs/superpowers/specs/2026-10-24-configurator-guided-flow-design.md`

## Global Constraints

- Repo `~/CarrezOps/code/RRY/RRY-Map-Bot`, branch `feat/configurator-rebuild`. Never push, merge or deploy.
- Run git as `git -c safe.directory='*' …`, because the tree is on NFS.
- Run every command from the repo root. Tests: `npm test`. Types: `npm run typecheck`. Build: `npm run build`. Running vitest from `web/configurator` fails.
- English only. Every user-visible text goes through `t()` with a key in `web/configurator/src/i18n/en.json`.
- The 7 parity fixtures in `web/configurator/tests/fixtures/parity` must stay byte-identical. A new row (gb, free) may be filtered out of the row-parity test, the way `neighbourRegion` is today, but the script parity must not change.
- Match the surrounding code: comment density, naming, signals via `store.*.value`, and plans changed by replacing the object.
- End commit messages with:
  ```
  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01T72YWkPGqvLA7qaQDbEiLH
  ```
- Region code limits: 1–30 characters, `/^[a-z0-9-]{1,30}$/`. The device holds at most 32 named regions (`MAX_REGIONS = 32`, `*` not counted).
- Site table (txdelay / direct.txdelay / rxdelay): Hilltop 2.0 / 2.0 / 3 · Foothills 1.5 / 1.0 / 3 · Suburban 0.8 / 0.4 / 3 · Local 0.3 / 0.1 / 3. Firmware defaults: 0.5 / 0.2 / 0.
- Hop levels `[flood.max.unscoped, flood.max.advert]`: tight [2,3], minimal [4,6], average [8,12], extended [16,24], full [64,64].

## Rulings made while planning

- Step ids become strings: `"connect" | "place" | "name" | "site" | "regions" | "advanced" | "send"`. Numbers would shift for every screen anyway, and names make the Advanced side branch explicit.
- `defaultPlan()` keeps the firmware-default timing (0.5 / 0.2 / 0), so v1 imports and parity are unchanged. A new `newPlan()` (Suburban timing) is what the app starts with.
- `store.startPlan` is the latest of: the app's start plan, a Read (`resetPlan`), or an import. `planBase` / `dirty` keep their part 1 meaning.
- The region count needs the place list, so it lives in the store (`regionCount`), not in `planErrors`. `canApply` reasons become `{ key, params? }` so the message can carry the count.
- Advanced follows the spec: its segment is never orange. Its field errors still block Apply on Send.
- A free region that is the parent of another free region cannot be removed. Its remove button is disabled, with a tooltip.
- When the region policy is rebuilt (the pin moves, a new search), free rows carry over. A row is dropped when its code is now a structured row. Its parent falls back to top level when the parent is no longer offered.

## Review Focus

1. Moving the pin to another municipality after adding free regions keeps them, and their states. Test in Task 3 (`carryFreeRows`) and Task 10 (store).
2. A free region whose parent was the old home municipality, after the pin moves to a new one, ends up at top level and still produces a valid `region def`. Test in Task 3.
3. A v2 backup with a malformed free row (bad code, unknown group shape, parent not a string or null) is rejected with `backup.error.invalid`. Test in Task 3.
4. A block's ↺ after an import goes back to the imported values, not to the defaults. A v1 import without timing fields stays on 0.5 / 0.2 / 0. Tests in Task 1 and Task 8.
5. The admin password eye hides the password again when the pointer leaves, on pointer cancel, and on blur, not only on pointer up. Test in Task 9.

---

### Task 1: Site profiles and the new-plan timing

**Files:**
- Create: `web/configurator/src/core/site.ts`
- Modify: `web/configurator/src/core/plan.ts` (add `newPlan`)
- Test: `web/configurator/tests/site.test.ts`

**Interfaces:**
- Produces:
  - `type SiteProfile = "hilltop" | "foothills" | "suburban" | "local"`
  - `type SiteChoice = SiteProfile | "own" | "custom"`
  - `type Timing = { txdelay: number; directTxdelay: number; rxdelay: number }`
  - `SITE_PROFILES: Record<SiteProfile, Timing>`, in table order
  - `FIRMWARE_TIMING: Timing` (0.5 / 0.2 / 0)
  - `timingOf(plan: Plan): Timing`: the plan's three values, each through `settingValue`, falling back to `FIRMWARE_TIMING` for that key when invalid
  - `siteOf(timing: Timing, reference: Timing): SiteChoice`: a profile when all three equal it numerically; otherwise "own" when equal to `reference`; otherwise "custom"
  - `timingFor(choice: SiteProfile | "own", reference: Timing): Timing`
  - `withTiming(plan: Plan, timing: Timing): Plan`: sets `settings.txdelay`, `directTxdelay` and `rxdelay`
  - `siteReference(snapshot: DeviceSnapshot | null): Timing`: the snapshot's values where present, else `FIRMWARE_TIMING`
  - `newPlan(): Plan` in plan.ts: `defaultPlan()` with the Suburban timing

- [ ] **Step 1: Write the failing tests** in `tests/site.test.ts`:
  - `siteOf` returns each profile for its exact values (e.g. `{2,2,3}` → "hilltop"), and matches `0.80` vs `0.8` numerically.
  - `siteOf({0.5,0.2,0}, FIRMWARE_TIMING)` → "own". `siteOf({0.6,0.2,0}, FIRMWARE_TIMING)` → "custom".
  - `timingFor("own", ref)` returns `ref`. `timingFor("local", ref)` returns `{0.3,0.1,3}`.
  - `newPlan().settings` has txdelay 0.8, directTxdelay 0.4, rxdelay 3. `defaultPlan().settings` keeps 0.5, 0.2, 0.
  - `siteReference({ settings: { txdelay: 1 }, missing: [] })` → `{1, 0.2, 0}`.
  - A v1 import (`importBackup` of a v1 fixture with no timing fields) keeps 0.5 / 0.2 / 0.
- [ ] **Step 2: Run** `npm test -- site`. Expected: FAIL, module not found.
- [ ] **Step 3: Implement** site.ts and `newPlan()`.
- [ ] **Step 4: Run** `npm test`. Expected: all pass, parity unchanged.
- [ ] **Step 5: Commit** `feat(RRY-Map-Bot): site profiles and the Suburban start timing`.

### Task 2: Setting blocks, recommended values, undo, Tight

**Files:**
- Create: `web/configurator/src/core/blocks.ts`
- Modify: `web/configurator/src/core/settings.ts`: `FLOOD_ALLOWANCE` gets `tight: [2, 3]` as its first key. `floodMaxUnscoped` and `floodMaxAdvert` move to card `"advertising"`. `pathHashMode`, `txdelay` and `directTxdelay` move to card `"advanced"`.
- Modify: `web/configurator/src/steps/Settings.tsx`: drop the now-redundant `EXPERT_EXTRA`, and keep rendering working.
- Modify: `web/configurator/src/i18n/en.json`: `"settings.allowance.tight": "Tight {pair}"`, `"help.allowance.tight": "Floods reach only the repeaters close by."`
- Test: `web/configurator/tests/blocks.test.ts`, plus existing settings tests

**Interfaces:**
- Consumes: `SITE_PROFILES`, `siteOf`, `timingOf`, `withTiming`, `FIRMWARE_TIMING` (Task 1). `BEMESH_PRESET_TITLE` and `RADIO_PRESETS` from presets.
- Produces:
  - `type Block = "radio" | "advertising" | "repeating" | "advanced"`
  - `BLOCKS: Block[]` (that order)
  - `blockKeys(block: Block): SettingKey[]`: the SETTINGS of that card
  - `recommendedFor(plan: Plan, block: Block): Plan`. Values per the spec table:
    - radio: EU/UK (Narrow), `radioText` and `radioCustom` cleared, dutycycle "10", txPower untouched
    - advertising: floodAdvertHours 47, advertIntervalMinutes 0, and the hop pair of the current level, or average when none matches
    - repeating: repeat "on", floodMax 64, loopDetect "minimal"
    - advanced: pathHashMode "1", radioRxgain "on", intThresh 0, agcResetInterval 0, multiAcks "0", and the current profile's timing, or Suburban when it matches none of the four
  - `recommendedForAll(plan: Plan): Plan`: the four in BLOCKS order
  - `isBlockRecommended(plan: Plan, block: Block): boolean`: `recommendedFor` would change nothing (compare as `same()` text/number)
  - `blockChanges(plan: Plan, start: Plan, block: Block): number`: the settings of the block that differ from `start`, plus 1 for radio when `plan.radio` differs from `start.radio` or `radioText` is set. The admin password counts when non-empty, but it is not in any block.
  - `undoBlock(plan: Plan, start: Plan, block: Block): Plan`: the block's settings copied from `start` (keys absent in `start` are deleted). For radio, also `radio`, `radioText` and `radioCustom` from `start`.
  - `allowanceOf(plan: Plan): keyof typeof FLOOD_ALLOWANCE | null`, moved here from Settings.tsx
  - `same(a: unknown, b: unknown): boolean`, moved here from Settings.tsx and exported

- [ ] **Step 1: Write the failing tests** in `tests/blocks.test.ts`:
  - `recommendedFor(plan with floodAdvertHours 12, "advertising")` gives 47 and the pair 8/12. With the pair 2/3 already set, it keeps 2/3.
  - `recommendedFor(plan, "radio")` leaves `txPower` as it was (set it to 20 first) and the advertising values untouched.
  - `recommendedFor(withTiming(newPlan(), SITE_PROFILES.hilltop), "advanced")` keeps hilltop. From `{0.6,0.2,0}` it gives Suburban.
  - `recommendedForAll(plan)` does not touch adminPassword, guestPassword or ownerInfo (set all three first).
  - `isBlockRecommended(recommendedForAll(defaultPlan()), b)` is true for every block.
  - `blockChanges(plan, start, "repeating")` counts loopDetect after `start` had "minimal" and the plan has "strict". It is 0 after `undoBlock`.
  - `undoBlock` for radio restores `start.radio` and clears `radioText`.
  - `undoBlock` against an imported start plan restores the imported values. For example, a start with floodMax 32: change it to 64, undo, and it is 32 again.
  - `FLOOD_ALLOWANCE` keys are `["tight","minimal","average","extended","full"]`.
- [ ] **Step 2: Run** `npm test -- blocks`. Expected: FAIL, module not found.
- [ ] **Step 3: Implement** blocks.ts and the settings.ts card changes. Settings.tsx imports `allowanceOf` and `same` from blocks, its Pills render the hop limit fields in the Advertising card, and the Advanced section lists `blockKeys("advanced")`.
- [ ] **Step 4: Run** `npm test && npm run typecheck`. Expected: pass. Update `steps-settings` expectations only where the hop fields changed card.
- [ ] **Step 5: Commit** `feat(RRY-Map-Bot): setting blocks with recommended values, undo and the Tight hop level`.

### Task 3: United Kingdom, free regions and the region count (core)

**Files:**
- Modify: `web/configurator/src/core/regions.ts`
- Modify: `web/configurator/src/core/backup.ts`: validate free rows in `planFromV2`
- Modify: `web/configurator/src/i18n/en.json`
- Test: `web/configurator/tests/regions.test.ts`, `web/configurator/tests/backup.test.ts`

**Interfaces:**
- Produces:
  - `RegionRow.group` gains `"free"`. `RegionRow` gains `parent?: string | null` (free rows only; null = top level).
  - `gb` in `NEIGHBOR_COUNTRY_CODES` after `de`, in `CLI_ORDER_FIRST` after `de`, in the country loop of `buildOrderedRegionEntries`, and at depth 20 in `regionHierarchyDepth`. `COUNTRY_NAMES.gb = "region.name.gb"`, with en `"region.name.gb": "United Kingdom"`.
  - `MAX_REGIONS = 32`
  - `checkFreeCode(policy: RegionPolicy, code: string): "ok" | "empty" | "tooLong" | "chars" | "taken"`. "taken" covers `*` and any code that has a row.
  - `freeParentOptions(policy: RegionPolicy, anchor: Anchor): ScopeOption[]`. In order: top level (code `""`), `eu`, `be`, the gewest and province rows, the home municipality, then the other free rows. Labels are "Name (code)". Top level reads `t("regions.free.top")`.
  - `addFreeRegion(policy: RegionPolicy, code: string, parent: string | null): RegionPolicy`: the new row starts on Allow, label = code, labelKey `"region.kind.free"`.
  - `removeFreeRegion(policy: RegionPolicy, code: string): RegionPolicy`: no-op while another free row has it as parent
  - `isFreeParent(policy: RegionPolicy, code: string): boolean`
  - `carryFreeRows(next: RegionPolicy, prev: RegionPolicy | null, anchor: Anchor): RegionPolicy`: appends prev's free rows (with their states) that are not rows in `next`. A parent not in `freeParentOptions(next, anchor)` becomes null.
  - `regionCountAfterApply(anchor: Anchor, policy: RegionPolicy, places: Place[]): number`: the size of the needed set the script defines (including the default-scope code and its ancestors), `*` excluded
  - Free rows are never gated (they are not in `NEIGHBOUR_TIER`). `bulk` treats them like any other row.
  - Def tree: `expandRegionNeeded` adds each needed free row's parent chain, and the parents' own ancestors through the existing rules. `buildOrderedRegionEntries` takes `freeParents: Map<string, string | null>` and adds free entries after the cities and before misc, parents before children, otherwise alphabetical.
- en.json:
  - `"region.kind.free": "Your own region"`
  - `"regions.group.free": "Your own regions"`
  - `"regions.free.top": "Top level"`
  - `"regions.free.code": "Code"`
  - `"regions.free.parent": "Under"`
  - `"regions.free.add": "Add"`
  - `"regions.free.remove": "Remove {code}"`
  - `"regions.free.parentInUse": "Another region sits under this one."`
  - `"error.freeCode.empty": "Enter a code."`
  - `"error.freeCode.tooLong": "At most 30 characters."`
  - `"error.freeCode.chars": "Use lowercase a–z, digits and -."`
  - `"error.freeCode.taken": "That code is already in the list."`
  - `"error.regionCount": "The repeater holds at most {max} regions; this plan needs {count}."`

- [ ] **Step 1: Write the failing tests** in `tests/regions.test.ts`:
  - `policyFor(Ronse anchor)` lists the neighbour countries nl, lu, fr, de, gb in that order. gb is locked until be is set.
  - With be allowed and gb allowed, the def lines contain `eu` with `gb` nested after `de`. Match the existing def-tree test style, e.g. `/\bde\|eu gb\b|\bgb\b/` adapted to the actual packing, and assert gb follows de.
  - `checkFreeCode`: "" → empty, 31 × "a" → tooLong, "Ab" → chars, "a_b" → chars, "*" → taken, "beron" (a row) → taken, "my-zone1" → ok, and a 30-character code → ok.
  - `addFreeRegion(p, "zone", "be-wht")`: the row is allowed and not locked. The script defines `zone` under `be-wht`, with `be` and `be-wht` defined too even though only zone is allowed.
  - `addFreeRegion` under another free region: the child is defined under its parent. A top-level free region sits directly under `*`.
  - `removeFreeRegion` is a no-op while a child exists, and removes the row once the child is gone.
  - `carryFreeRows`: Ronse policy + free "zone" (parent beron, denied) → Kortrijk policy keeps zone, still denied, now with parent null. A free row "bekor", carried into a Kortrijk policy that has the structured row bekor, is dropped.
  - `regionCountAfterApply` equals the number of distinct codes in the def lines. Adding free rows past 32 makes it exceed `MAX_REGIONS`.
  - The parity row test filters `gb` and `free` rows as it does `neighbourRegion`. All 7 script fixtures stay unchanged.
- [ ] **Step 2: Add the failing backup tests** in `tests/backup.test.ts`:
  - The v2 export → import round trip keeps a free row (code, parent, allow/deny).
  - A v2 file with a free row whose code is `"A B"`, or whose parent is `5`, throws `backup.error.invalid`.
- [ ] **Step 3: Run** `npm test -- regions backup`. Expected: FAIL.
- [ ] **Step 4: Implement** the regions.ts changes and the free-row check in `planFromV2`: group "free" rows need a code passing `/^[a-z0-9-]{1,30}$/` and a parent that is a string or null.
- [ ] **Step 5: Run** `npm test && npm run typecheck`. Expected: pass, 7 script fixtures byte-identical.
- [ ] **Step 6: Commit** `feat(RRY-Map-Bot): United Kingdom, free regions and the region count in the region core`.

### Task 4: Country borders data and map

**Files:**
- Create: `scripts/generate-countries-geojson.py`
- Create: `data/countries.geojson` (generated, committed)
- Modify: `web/configurator/src/core/data.ts`: `loadCountries = () => getJson<GeoJsonCollection>("/data/countries.geojson")`
- Modify: `web/configurator/src/state/appdata.ts`: loader `countries`, loaded with the others
- Modify: `web/configurator/src/state/store.ts`: `AppData.countries?: GeoJsonCollection`
- Modify: `web/configurator/src/app/MapView.tsx`, `web/configurator/src/theme/app.css` (`.map-outline-country`, stroke weight 2)
- Test: `web/configurator/tests/mapview.test.tsx`

**Interfaces:**
- Produces: features `{ type: "Feature", properties: { code, name }, geometry }` with codes be, nl, lu, fr, de, gb. The names are English ("Belgium", "Netherlands", "Luxembourg", "France", "Germany", "United Kingdom").

- [ ] **Step 1: Write the script.** It follows `scripts/generate-be-gewesten-geojson.py`'s style.
  - Download `https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_10m_admin_0_countries.geojson` to a temporary directory.
  - Pick countries by `ADM0_A3` in BEL, NLD, LUX, FRA, DEU, GBR.
  - Clip to the box lon −11..16, lat 41..61.
  - Simplify with `simplify(0.01, preserve_topology=True)` and round coordinates to 4 decimals. Lower the tolerance if a small country loses its shape.
  - Write `data/countries.geojson` and print the file size.
  - The script must fail when the output is ≥ 300 KB.
- [ ] **Step 2: Run** `python3 scripts/generate-countries-geojson.py`, using the venv with shapely, `/tmp/claude-1000/-home-confi-CarrezOps/d47fdfd3-8d7c-4412-813a-b4ae69915a7b/scratchpad/venv/bin/python` (pip install shapely there if missing). Expected: 6 features, under 300 KB.
- [ ] **Step 3: Write the failing map tests**:
  - With `data.countries` set and borders on, an outline layer exists per country, with class `map-outline-country`.
  - On the regions step, with `be` and `fr` allowed, `fr` and `be` get a `map-region-allowed` layer. Country fills are added before the gewest, province and municipality fills.
  - With `countries` in `failed`, the map renders without them.
- [ ] **Step 4: Run** `npm test -- mapview`. Expected: FAIL.
- [ ] **Step 5: Implement.**
  - Country outlines go in the borders effect.
  - In the regions effect, `byCode` also holds country features at level −1.
  - `bordersFailed` also lists "countries".
  - At this point the step value for regions is still the part 1 number; Task 5 renames it.
- [ ] **Step 6: Run** `npm test && npm run build`. The build must copy `/data/countries.geojson`, because the Flask catch-all serves `data/`. Check that `curl -s localhost:<port>/data/countries.geojson` works if a dev server is up; otherwise check the route serves `data/*` in `backend` and note it.
- [ ] **Step 7: Commit** `feat(RRY-Map-Bot): country borders for Belgium and its neighbours on the map`.

### Task 5: The guided step list (restructure)

**Files:**
- Modify: `src/state/store.ts`, `src/app/Stepper.tsx`, `src/app/Panel.tsx`, `src/app/MapView.tsx`, `src/app/TopBar.tsx` (location chip rule), `src/i18n/en.json`
- Create, by moving code (no behaviour change beyond the step list):
  - `src/steps/Place.tsx`: search, coordinates, use my location, advert location
  - `src/steps/Name.tsx`: prefix, suffix, bytes, nearby check, power
  - `src/steps/Site.tsx`: placeholder heading only, filled in Task 6
  - `src/steps/Advanced.tsx`: from `Settings.tsx`
  - `src/steps/Send.tsx`: from `Review.tsx`
- Delete: `src/steps/PlaceName.tsx`, `src/steps/Settings.tsx`, `src/steps/Review.tsx`
- Tests: rename and adjust `tests/steps-*.test.tsx`, `tests/shell.test.tsx`, `tests/store.test.ts`, `tests/mapview.test.tsx`, `tests/drawer.test.tsx` to the new ids. Add stepper tests.

**Interfaces:**
- Produces:
  - `type Step = "connect" | "place" | "name" | "site" | "regions" | "advanced" | "send"`
  - `STEPS: Step[]` in that order. `NUMBERED: Step[]` = STEPS without "advanced".
  - `stepNumber(s: Step): number | null` (1–6, null for advanced)
  - `isWide(s: Step): boolean`: advanced and send
  - `store.startPlan: Signal<Plan>`, set by `resetPlan` and by the drawer's import (the import keeps `planBase` as is)
  - `store.plan` and `startPlan` start from `newPlan()`
  - `regionCount = computed(() => …)`: `regionCountAfterApply` on the current anchor, policy and places, or 0
  - `canApply.value.reasons: { key: string; params?: Record<string, string | number> }[]`. It adds `{ key: "error.regionCount", params: { count, max: 32 } }` when `regionCount > MAX_REGIONS`.
  - `stepStatus(s: Step)`:
    - attention for place = "location"; name = "name" | "ownerInfo"; regions = no anchor | "regions" | count over the limit; send = "adminPassword" | "guestPassword"
    - connect and site never show attention
    - advanced: "current", "done" when visited, else "todo"; never attention
    - an attention step shows orange once visited, or once send was visited
- en.json:
  - `step.connect` "Connect", `step.place` "Place", `step.name` "Name", `step.site` "Site", `step.regions` "Regions", `step.advanced` "Advanced (optional)", `step.send` "Send"
  - `"step.of": "{n} / 6"`
  - `"step.advancedLink": "Advanced settings"`
  - remove `step.1`…`step.5`
- Layout rules:
  - The map is hidden while `isWide(step)`, and Leaflet re-measures when it comes back.
  - The regions overlay draws on "regions".
  - The panel is wide on advanced and send; the location chip shows there.
  - The footer on place, name, site and regions is Back plus "Next: <next numbered step>". Regions' next is Send, with an "Advanced settings" link button beside it (`step.advancedLink`, goes to "advanced"). Connect has no Back, as now.
  - Advanced has Back → regions and "Next: Send". Send's Back → regions.
  - The stepper renders 7 segments; Advanced's has class `seg optional`. The docked line shows `step.of` for numbered steps and only the name on Advanced.
- Owner info moves to Name, below power, as the existing `SettingField` for `ownerInfo` exported from Advanced (export `SettingField`). Advanced no longer renders the Access and Owner cards; Send renders the password fields in Task 9. Until then, keep Access in Advanced so passwords stay reachable; Task 9 moves it.

- [ ] **Step 1: Write the failing stepper and store tests**:
  - 7 segments, the 6th labelled "Advanced (optional)" with class `optional`
  - the docked line reads "2 / 6" on place
  - from regions, "Next: Send" goes to send and "Advanced settings" goes to advanced
  - Advanced is never `attention` even with a range error
  - `canApply` lists `error.regionCount` with params when 33 regions are needed (use free rows)
  - an import sets `startPlan` and leaves `planBase`
- [ ] **Step 2: Run** `npm test`. Expected: the new tests FAIL.
- [ ] **Step 3: Implement the restructure.** Move the code without rewriting it. Update every `store.step.value = <n>` in src and tests (3 → "regions", 4 → "advanced", 5 → "send", 2 → "place" or "name" by which fields the test touches).
- [ ] **Step 4: Run** `npm test && npm run typecheck && npm run build`. Expected: pass with the same test count or more.
- [ ] **Step 5: Commit** `refactor(RRY-Map-Bot): guided step list with Place, Name, Site, Regions, Send and optional Advanced`.

### Task 6: Site step

**Files:**
- Modify: `src/steps/Site.tsx`, `src/i18n/en.json`, `src/theme/app.css`
- Test: `tests/steps-site.test.tsx`

**Interfaces:**
- Consumes: `SITE_PROFILES`, `siteOf`, `timingFor`, `timingOf`, `withTiming`, `siteReference` (Task 1). `nodesWithin` and `NEIGHBOR_RADIUS_KM` from geo.
- Produces: `SiteChoices({ compact }: { compact?: boolean })`, exported. Task 8 reuses it in compact (pill) form.
- en.json:
  - `site.title` "Site"
  - `site.sub` "Where the repeater stands decides how long it waits before passing a packet on."
  - `site.hilltop` "Hilltop"; `site.hilltop.desc` "Clear view over a larger area: a mast, a ridge, the roof of a high-rise."; `site.hilltop.range` "20+ neighbours"
  - `site.foothills` "Foothills"; `site.foothills.desc` "Bridge between hilltop nodes and the ones in town: a hillside, or a high roof outside town."; `site.foothills.range` "10–20 neighbours"
  - `site.suburban` "Suburban"; `site.suburban.desc` "A typical rooftop covering your own neighbourhood."; `site.suburban.range` "5–10 neighbours"
  - `site.local` "Local"; `site.local.desc` "Hears only a few others: indoors, ground level, a low roof."; `site.local.range` "1–3 neighbours"
  - `site.own` "Its own"; `site.own.desc` "Keeps the timing the repeater already has."
  - `site.custom` "Custom"; `site.custom.desc` "txdelay {tx} · direct.txdelay {direct} · rxdelay {rx}"
  - `site.nearby` "The map shows {count} repeaters within {km} km."
  - `site.nearbyNone` "Pick a place to see how many repeaters are nearby."

- [ ] **Step 1: Write the failing tests**:
  - Five buttons with `aria-pressed`; Suburban is pressed on `newPlan()`.
  - Clicking Hilltop sets 2 / 2 / 3.
  - With a snapshot of 1 / 0.5 / 0, "Its own" is pressed after `resetPlan` from that snapshot, and clicking it after Hilltop restores 1 / 0.5 / 0.
  - Setting txdelay 0.6 shows a pressed Custom card listing the three values.
  - With nodes fixture data and a location, it shows the count of type-2 nodes within 25 km.
- [ ] **Step 2: Run** `npm test -- steps-site`. Expected: FAIL.
- [ ] **Step 3: Implement.** Cards are `button.site-card` with `aria-pressed`, title, desc and range. Custom is a `div.site-card` with `aria-current="true"`, not a button. Compact mode renders `.pills` with the five names only, plus a non-button Custom pill when it applies.
- [ ] **Step 4: Run** `npm test`. Expected: pass.
- [ ] **Step 5: Commit** `feat(RRY-Map-Bot): Site step with the five site choices`.

### Task 7: Place and Name leftovers

**Files:**
- Modify: `src/steps/Place.tsx`, `src/steps/Name.tsx`, `src/state/store.ts`, `src/state/device.ts`, `src/core/plan.ts` (`DeviceSnapshot.previousPublicKey?: string`)
- Test: `tests/steps-connect-place.test.tsx` (or the renamed place/name test files from Task 5)

**Interfaces:**
- Produces: `placeLeft: Signal<boolean>` in store. It becomes true when the step changes away from "place", and stays true until `resetPlan`. In device.ts, writing a new key sets `previousPublicKey` to the snapshot's old `publicKey`.
- Name's nearby check ignores both `publicKey` and `previousPublicKey`.

- [ ] **Step 1: Write the failing tests**:
  - On a fresh plan, Place does not show "coordinates required". After going to Name and back, it shows (advert location "prefs", no location).
  - After a key write, a node in `data.nodes` carrying the repeater's name with the old key is not reported as "already used nearby", and neither is one with the new key.
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement.** The coordinates-required line shows when `placeLeft.value && !location && advertLoc === "prefs"`. The Send gate is unchanged.
- [ ] **Step 4: Run** `npm test`. Expected: pass.
- [ ] **Step 5: Commit** `fix(RRY-Map-Bot): coordinates required only after leaving Place; own name after a key write`.

### Task 8: Advanced blocks

**Files:**
- Modify: `src/steps/Advanced.tsx`, `src/steps/settings/RadioFields.tsx`, `src/i18n/en.json`, `src/theme/app.css`
- Create: `src/steps/settings/RepeaterValue.tsx`
- Test: `tests/steps-advanced.test.tsx` (renamed from steps-settings in Task 5)

**Interfaces:**
- Consumes: everything in blocks.ts (Task 2), `SiteChoices({ compact: true })` (Task 6), `store.startPlan` (Task 5).
- Produces: `RepeaterValue({ value, onRestore }: { value: string; onRestore: () => void })`, which renders `span.repeater-value` → `"On repeater: "` + `<code>{value}</code>` + `button.icon` "↺".
- en.json:
  - `settings.recommend` "Use #BEmesh recommended settings"
  - `settings.recommendAll` "Use #BEmesh recommended settings for all"
  - `settings.undo` "Undo the changes in {block}"
  - `settings.onRepeater` "On repeater:"
  - `settings.restore` "Use the repeater's value ({value})"
  - `settings.timing` "Timing preset"
  - `settings.card.advanced` "Advanced"
  - remove `settings.was`
- Layout:
  - The four blocks render as cards in BLOCKS order. Advanced becomes the 4th card; it replaces the `<details>` section, as one of the cards.
  - Each card's head: `<h3>`, the badge, and, when `blockChanges > 0`, `button.icon.undo` "↺" with aria-label and title `settings.undo` and the block name.
  - Badge: `blockChanges(plan, startPlan, block) === 0` → "unchanged"; else `isBlockRecommended` → "recommended"; else "N changes".
  - The field outline (`changed`) uses `!same(plan value, startPlan value)`.
  - Each card's foot has `button.btn.small` `settings.recommend` → `recommendedFor`.
  - The step head is a `div.step-head` with `<h2>` and `button.btn.small` `settings.recommendAll`.
  - The Advanced card shows `<SiteChoices compact />` with label `settings.timing` above txdelay.
  - A RepeaterValue sits in each field's label line when the snapshot has the key and the plan value differs (never for adminPassword). The same applies to the four radio fields against `snapshot.radio`. ↺ sets the field to the snapshot value.
  - CSS: `.repeater-value` inline-flex, margin-left auto, padding 1px 6px, radius 999px, info-tone background via a new token `--info-bg` (light and dark). Define it in tokens.css next to the existing tones; `code` uses the mono font.

- [ ] **Step 1: Write the failing tests**:
  - Advertising's button sets 47 and 8/12, and leaves Repeating's loopDetect "strict" alone.
  - The all button sets every block and leaves the guest password "hello" alone.
  - With a snapshot of floodAdvertHours 3 and the plan at 12, the label line shows "On repeater:" with "3". Clicking the "Use the repeater's value (3)" button sets 3, and the tag disappears.
  - No text matches `/Was .* on the repeater/`.
  - The Repeating ↺ appears after changing loopDetect, and undoes only Repeating (Advertising's 12 stays).
  - After an import with floodMax 32, the badge reads "unchanged". Changing it to 64 shows "1 change", and ↺ restores 32.
  - The Advanced card's Hilltop pill sets 2 / 2 / 3. Typing txdelay 0.6 shows the Custom pill.
  - The Tight pill sets 2/3.
  - Radio ↺ restores the start radio after choosing Australia.
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `npm test && npm run typecheck`. Expected: pass.
- [ ] **Step 5: Commit** `feat(RRY-Map-Bot): per-block recommended settings, undo, timing presets and the repeater-value tag`.

### Task 9: Send: Before you send

**Files:**
- Modify: `src/steps/Send.tsx`, `src/steps/Advanced.tsx` (remove the Access card), `src/i18n/en.json`, `src/theme/app.css`
- Create: `src/steps/send/PasswordField.tsx`
- Test: `tests/steps-send.test.tsx` (renamed from steps-review in Task 5)

**Interfaces:**
- Consumes: `SettingField` (export from Advanced, Task 5) for the guest password; `canApply` reasons with params (Task 5).
- Produces: `PasswordField()`, the admin password input with `button.icon.eye` (aria-label `send.showPassword`):
  - The input type is "text" while held, else "password".
  - Hold = pointerdown, or keydown Space/Enter.
  - Release = pointerup, pointerleave, pointercancel, keyup, or blur.
- en.json:
  - `send.before` "Before you send"
  - `send.showPassword` "Hold to show the password"
  - `send.radio` "Radio: {preset}"
  - `send.dutycycle` "Duty cycle: {value}"
  - `send.txPower` "TX power: {value}"
  - `send.txPowerKept` "unchanged"
  - `send.change` "Change in Advanced"
- Layout: the "Before you send" card sits first in the left column. It holds the PasswordField with the existing label, placeholder and help, the guest password SettingField, then three read-only lines (preset title or "Custom", duty cycle label, TX power or "unchanged"), each with a link button `send.change` that goes to "advanced". Apply's blocked-reasons list renders `t(r.key, r.params)`.

- [ ] **Step 1: Write the failing tests**:
  - The admin input is type password; it is type text while the eye has pointerdown; it is password again after pointerup, after pointerleave, and after blur.
  - Space keydown on the eye shows the text; keyup hides it.
  - The admin password is no longer rendered on Advanced.
  - The guest password typed on Send lands in the plan.
  - "Change in Advanced" goes to advanced.
  - With 33 needed regions, the Apply reasons show "The repeater holds at most 32 regions; this plan needs 33."
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `npm test`. Expected: pass.
- [ ] **Step 5: Commit** `feat(RRY-Map-Bot): Before you send card with a hold-to-show admin password`.

### Task 10: Regions: Your own regions

**Files:**
- Modify: `src/steps/Regions.tsx`, `src/state/store.ts` (`setLocation` and `chooseLocation` call `carryFreeRows`), `src/i18n/en.json`, `src/theme/app.css`
- Test: `tests/steps-regions.test.tsx`, `tests/store.test.ts`

**Interfaces:**
- Consumes: Task 3's `checkFreeCode`, `freeParentOptions`, `addFreeRegion`, `removeFreeRegion`, `isFreeParent`, `carryFreeRows` and `MAX_REGIONS`; Task 5's `regionCount`.
- Layout:
  - The "Your own regions" group comes after the neighbour groups and before "Read from the device".
  - Its rows are the usual RegionRowView plus `button.icon` ✕, labelled `regions.free.remove`. The button is disabled with title `regions.free.parentInUse` when `isFreeParent`.
  - Below the rows sits the add form: code input (`regions.free.code`), parent select (`regions.free.parent`), and Add. Add is disabled unless `checkFreeCode === "ok"`. The inline error `error.freeCode.<result>` shows once the input is non-empty. A successful Add clears the input.
  - When `regionCount > MAX_REGIONS`, a warn Notice at the top of the step shows `error.regionCount`.
  - The home region and default scope selects already list allowed rows, so free rows appear there with no extra code. Assert it.

- [ ] **Step 1: Write the failing tests**:
  - Add "zone" under "be-wht": the row shows on Allow, and the script contains a def with `zone`.
  - Typing "Zone" shows "Use lowercase a–z, digits and -." and Add is disabled.
  - ✕ on a parent with a child is disabled.
  - An allowed free row is offered in the default scope select.
  - Store: `chooseLocation(Ronse)`, add free "zone", then `setLocation` into Kortrijk. The plan still has zone, with the same state.
  - 33 regions show the count notice.
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `npm test && npm run typecheck && npm run build`, then the pytest suite (`/tmp/claude-1000/-home-confi-CarrezOps/d47fdfd3-8d7c-4412-813a-b4ae69915a7b/scratchpad/venv/bin/pytest -q`). Expected: all pass.
- [ ] **Step 5: Commit** `feat(RRY-Map-Bot): add and remove your own regions`.

### Task 11: Visual check and hand-off build

**Files:** none in the repo, unless a fix is needed.

- [ ] **Step 1:** Build. Serve `web/configurator/dist`, with `data/` at `/data`, from the scratch site, and screenshot every step at 1280 and 390 wide, light and dark, using the existing Playwright script `$SCRATCH/pw/v2shot.mjs` with a fake serial and a snapshot. Check:
  - the stepper's Advanced segment
  - Site cards
  - the Advanced block heads (badge, ↺, button)
  - the On repeater tag in both themes
  - the eye
  - the country fills on Regions
- [ ] **Step 2:** Fix what looks broken. Commit any fixes as `style(RRY-Map-Bot): …`.
- [ ] **Step 3:** Ask the Mac session ("RRY-Map-Bot Dev Env") to rebuild `api` at the final HEAD per its standing rule, then give the user the hardware checklist from the spec's Testing section.
