# Configurator part 3: an existing repeater over USB — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** After a Read, Apply sends only what differs from the repeater, a quick check-up applies the #BEmesh recommendation in one go, and Advanced edits the repeater's access list.

**Architecture:** Two new pure modules: `core/acl.ts` (access list) and `core/checkup.ts` (check-up lines). `buildScript` gains a `snapshot` option that drops lines equal to the repeater and adds an access-list group. The serial link gets a raw-lines mode for `get acl`. The UI adds a Connect notice, a check-up dialog, an access list card and the Send switch.

**Tech Stack:** Vite 8 + Preact + TypeScript + @preact/signals; Vitest + jsdom + @testing-library/preact (tests in `web/configurator/tests`).

**Spec:** `docs/superpowers/specs/2026-10-26-configurator-existing-repeater-design.md`

## Global Constraints

- Branch `feat/configurator-rebuild`; never push, merge or deploy (user's rule: nothing goes live until the user says so).
- Git on the NFS tree: always `git -c safe.directory='*' …`.
- Run from the repo root: `PATH=~/.nvm/versions/node/v26.12.1/bin:$PATH npm test`, `npm run typecheck`, `npm run build`. Vitest run from `web/configurator` does not work.
- Parity fixtures in `web/configurator/tests/fixtures/parity` must stay unchanged and passing: without a snapshot, `buildScript` output is byte-identical to today.
- All user-visible text goes through `t()` with keys in `src/i18n/en.json`; plurals use the `_one` / `_other` suffixes.
- Commit message style: `feat(RRY-Map-Bot): …` / `fix(RRY-Map-Bot): …`, ending with the session's Co-Authored-By and Claude-Session lines.
- Firmware facts (MeshCore 1.16/1.17, verified in source):
  - `get acl` prints `ACL:` then `XX <64 hex>` lines with no `->` reply.
  - `setperm <64 hex> <role>` uses roles 1 read-only, 2 read-write, 3 admin, and role 0 removes. It replies `OK` / `Err - invalid params` / `Err - bad pubkey`.
  - The list is saved 5 s after the last change.
  - The repeater holds at most 32 entries.

## Review Focus

1. A setting the Read got no answer for must still be sent when only changes go out (Task 4 test `sends a setting the Read missed`).
2. After Apply's read-back the plan equals the repeater, so Send says "Nothing to send" and the button is disabled (Task 6 test `after the read-back there is nothing to send`).
3. `get acl` output arriving in small USB chunks, and an empty list (only `ACL:`), gives `[]`, not a missing read (Task 2 tests).
4. A pasted key with spaces, dashes or capitals is accepted. A key of 63 characters, a non-hex key or a duplicate key is refused (Task 1 test `normaliseKey`, Task 7 test `refuses a short or duplicate key`).
5. A repeater with no location and a non-#BEmesh name: the check-up still offers the settings, while the regions line is disabled and there is no name line (Task 5 test `without an anchor`).

---

### Task 1: Access list core

**Files:**
- Create: `web/configurator/src/core/acl.ts`
- Test: `web/configurator/tests/acl.test.ts`

**Interfaces:**
- Produces:
  - `type AclRole = 1 | 2 | 3`
  - `type AclEntry = { key: string /* 64 lowercase hex */; role: AclRole; perms?: number /* raw byte as read, when it has bits above the role */ }`
  - `ACL_MAX = 32`
  - `parseAcl(output: string): AclEntry[] | null`: `null` when there is no `ACL:` line.
  - `normaliseKey(text: string): string | null`
  - `aclLines(from: AclEntry[], to: AclEntry[]): string[]`
  - `aclChanges(from: AclEntry[] | undefined, to: AclEntry[] | undefined): number`

- [ ] **Step 1: Write the failing tests**

```ts
const K1 = "a1".repeat(32), K2 = "9f".repeat(32), K3 = "55".repeat(32);
it("parseAcl reads roles and keys, skipping junk", () => {
  expect(parseAcl(`ACL:\r\n03 ${K1.toUpperCase()}\n02 ${K2}\nnoise\n`)).toEqual([{ key: K1, role: 3 }, { key: K2, role: 2 }]);
  expect(parseAcl("ACL:\r\n")).toEqual([]);
  expect(parseAcl("Unknown command")).toBeNull();
  expect(parseAcl(`ACL:\n83 ${K1}\n`)).toEqual([{ key: K1, role: 3, perms: 0x83 }]);
});
it("normaliseKey", () => {
  expect(normaliseKey(` ${K1.slice(0, 8).toUpperCase()}-${K1.slice(8, 32)} ${K1.slice(32)} `)).toBe(K1);
  expect(normaliseKey(K1.slice(1))).toBeNull();
  expect(normaliseKey("zz".repeat(32))).toBeNull();
});
it("aclLines removes first, then adds and role changes; unchanged entries send nothing", () => {
  const from = [{ key: K1, role: 3 as const }, { key: K2, role: 2 as const }, { key: K3, role: 1 as const }];
  const to = [{ key: K1, role: 3 as const }, { key: K2, role: 3 as const }, { key: "0a".repeat(32), role: 3 as const }];
  expect(aclLines(from, to)).toEqual([`setperm ${K3} 0`, `setperm ${K2} 3`, `setperm ${"0a".repeat(32)} 3`]);
  expect(aclChanges(from, to)).toBe(3);
  expect(aclLines(to, to)).toEqual([]);
});
it("re-adding a removed key with its old role is no change", () => {
  const from = [{ key: K1, role: 2 as const }];
  expect(aclLines(from, [{ key: K1, role: 2 }])).toEqual([]);
});
```

- [ ] **Step 2: Run them to see them fail:** `npm test -- web/configurator/tests/acl.test.ts` should FAIL (module missing).
- [ ] **Step 3: Implement `core/acl.ts`.**
  - `parseAcl` matches lines `/^([0-9a-f]{2}) ([0-9a-f]{64})$/i` after trimming each line.
  - `role = perms & 3`, and lines with role 0 are skipped.
  - `perms` is set only when `perms > 3`.
  - `normaliseKey` strips whitespace and `-`, lowercases, and requires exactly 64 hex characters.
- [ ] **Step 4: Run the tests:** they should PASS.
- [ ] **Step 5: Commit:** `feat(RRY-Map-Bot): access list parsing and setperm lines`.

### Task 2: Read the access list over USB

**Files:**
- Modify: `web/configurator/src/device/serial.ts` (reply extraction, `LinkTiming`)
- Modify: `web/configurator/src/device/repeater.ts` (`READ_COMMANDS`)
- Modify: `web/configurator/src/core/plan.ts`:
  - `Plan` gets `acl?: AclEntry[]`;
  - `DeviceSnapshot` gets `acl?: AclEntry[]`;
  - `snapshotFromReplies` and `planFromSnapshot` fill them.
- Modify: `web/configurator/tests/fixtures/read-ronse.json` (add a `get acl` reply), plus tests whose read counts change (`steps-connect-place.test.tsx`: "Read 33" → "Read 34", `disconnectAfter` +1)
- Test: `web/configurator/tests/serial.test.ts`, `plan.test.ts`

**Interfaces:**
- Consumes: `parseAcl` (Task 1).
- Produces:
  - `LinkTiming.rawQuietMs?: number` (default 400);
  - `"get acl"` in `READ_COMMANDS` after `"region"`, so it is in `READ_BACK_COMMANDS` too;
  - `snapshot.acl` / `plan.acl` (absent when the read failed).

- [ ] **Step 1: Write the failing tests.**
  - In `serial.test.ts`, the link is set up with `{ ...FAST, rawQuietMs: 30 }`.
    - `"get acl keeps every line until the output goes quiet, over small chunks"`: the raw reply `"get acl\r\nACL:\r\n03 <K1>\n02 <K2>\n"` with `chunkSize: 5` returns a string that contains both keys.
    - `"get acl with an empty list returns the ACL: line"`: the result contains `"ACL:"`.
  - In `plan.test.ts`:
    - `"the access list from a Read"`: `snapshotFromReplies({ "get acl": "ACL:\n03 <K1>\n" }).acl` equals `[{ key: K1, role: 3 }]`, and `planFromSnapshot(...).acl` equals it too.
    - A reply without `ACL:` gives `acl` undefined.
- [ ] **Step 2: Run them to see them fail.**
- [ ] **Step 3: Implement.**
  - **Serial:** a `RAW_LINES_REPLY = new Set(["get acl"])`. For these commands, the reply is the text after the echo, with leading CR/LF trimmed. It counts once `rawQuietMs` passes with no new data after at least one line arrived; on timeout it takes what is there.
    - Do it in `waitForReply`: restart a quiet timer on each `notify()`.
    - The fake port's `raw` option already emits verbatim output.
  - **Snapshot:** the snapshot stores `parseAcl(raw reply) ?? undefined` (the raw reply, not `strip()`ped). `planFromSnapshot` copies `acl`.
  - **Fixture:** add `"get acl": "ACL:\n03 " + "a1".repeat(32) + "\n"` to the Ronse fixture.
- [ ] **Step 4: Run `npm test`.** All pass, after updating the read counts named in Files.
- [ ] **Step 5: Commit:** `feat(RRY-Map-Bot): Read takes the access list`.

### Task 3: Do the regions on the repeater match the plan?

**Files:**
- Modify: `web/configurator/src/core/regions.ts`
- Test: `web/configurator/tests/regions.test.ts`

**Interfaces:**
- Produces:
  - `type ExpectedRegions = { named: string[]; allowed: string[]; denied: string[]; home: string | null /* null: the script leaves home alone */; default: string | null; parents: Record<string, string | null> }`
  - `expectedRegions(anchor: Anchor, policy: RegionPolicy, places: Place[]): ExpectedRegions`
  - `regionsMatch(expected: ExpectedRegions, read: NonNullable<DeviceSnapshot["regions"]>, device: DeviceRegions): boolean`

- [ ] **Step 1: Write the failing tests** (in a `describe("regionsMatch")` block, using the Ronse anchor from the existing tests):
  - `"a repeater read after an Apply of the same policy matches"`:
    - Build the device state from the lines `regionCommandLines` emits for `base`: named = scriptNeeded codes, allowed/denied as the script sets them, home, default, and parents from the def entries.
    - Then `regionsMatch(expectedRegions(ronse, base, PLACES), read, device)` is `true`.
  - `"an extra region on the repeater does not match"`: add `"oldzone"` to `device.named`, so the result is `false`.
  - `"a different home, default, flood flag or parent does not match"`: one assertion per field, each `false`.
  - `"parents are compared only where the tree was read"`: `device.parents` undefined with everything else equal gives `true`.
- [ ] **Step 2: Run to see them fail.**
- [ ] **Step 3: Implement**, reusing the module's own helpers (`scriptNeeded`, `regionsByState`, `homeLineCode`, `defaultLineCode`, `buildOrderedRegionEntries`). The expected state is what the script leaves:
  - `named` is `scriptNeeded` without `*`.
  - `denied` is the deny rows, plus `*` when `!untaggedFlood`.
  - `allowed` is `named` minus `denied`, plus `*` when `untaggedFlood`.
  - `home` is `homeLineCode` or null; `default` is `defaultLineCode`, with `<null>` meaning null.
  - `parents` comes from the def entries.

  Compare as sets. `home` is compared only when it is not null. `parents` is compared only for codes present in `device.parents`.
- [ ] **Step 4: Run `npm test`:** it should PASS.
- [ ] **Step 5: Commit:** `feat(RRY-Map-Bot): check whether the repeater's regions match the plan`.

### Task 4: The script sends only the changes

**Files:**
- Modify: `web/configurator/src/core/cli.ts`
- Modify: `web/configurator/src/i18n/en.json` (`"script.group.acl": "Access list"`)
- Test: `web/configurator/tests/cli.test.ts`

**Interfaces:**
- Consumes:
  - `aclLines` (Task 1);
  - `expectedRegions`, `regionsMatch` (Task 3);
  - `same`, `sameRadio` (`core/blocks.ts`).
- Produces:
  - `ScriptGroup.titleKey` gains `"acl"`.
  - `buildScript(plan, places, opts: { includeDefaults: boolean; device?: DeviceRegions; snapshot?: DeviceSnapshot })`.
  - `unchangedCount(plan: Plan, places: Place[], snapshot: DeviceSnapshot): number` is the number of name/settings/location lines the full script has and the snapshot filter drops.

- [ ] **Step 1: Write the failing tests.** The Ronse fixture's snapshot is `S = snapshotFromReplies(read)`; its plan is `P = planFromSnapshot(S, PLACES)`.
  - `"with a snapshot of the same repeater nothing is sent"`: `commandLines(buildScript(P, PLACES, { includeDefaults: true, device: deviceRegionsFromSnapshot(S), snapshot: S }))` is `[]`.
  - `"only a changed setting is sent"`: with `P` changed to `floodAdvertHours: 47`, the lines are exactly `["set flood.advert.interval 47"]`.
  - `"sends a setting the Read missed"`: delete `S.settings.rxdelay` and push `"get rxdelay"` into `S.missing`. The lines include `set rxdelay …`.
  - `"the regions go as one group when they differ"`: a changed region row gives every line `regionCommandLines` gives, `region save` included.
  - `"name, location and gps advert only when changed"`: unchanged gives none. A changed `nameSuffix` gives `set name …` only.
  - `"the access list group"`: `P.acl` with one key removed and one added gives the group `{ titleKey: "acl", lines: [setperm … 0, setperm … 3] }` after the regions.
  - `"without a snapshot the script is unchanged"`: the parity tests keep passing, and `unchangedCount` for an edited `P` equals the full-script lines minus the sent lines in the name/settings/location groups.
- [ ] **Step 2: Run them to see them fail.**
- [ ] **Step 3: Implement.** With `opts.snapshot`:
  - **Settings:** drop a setting line when the snapshot has the key and `same(settingValue(plan,key), snapshot.settings[key])`.
  - **Radio:** drop the radio line when `snapshot.radio` and `sameRadio`.
  - **Name:** drop it when it equals `snapshot.name`.
  - **Location:** drop `set lat/lon` when both equal `snapshot.lat/lon` at the precision `sendableLocation` prints.
  - **gps advert:** drop it when it equals `snapshot.advertLoc`.
  - **Regions:** drop all region lines when `snapshot.regions` and `device` are both present and `regionsMatch` is true.
  - **Access list:** when `snapshot.acl` and `plan.acl` are both present, append the acl group with `aclLines(snapshot.acl, plan.acl)` (left out when empty).
  - The admin password line stays (it is only present when typed).
- [ ] **Step 4: Run `npm test`:** all PASS, parity included.
- [ ] **Step 5: Commit:** `feat(RRY-Map-Bot): after a Read the script holds only the changes`.

### Task 5: Check-up core

**Files:**
- Create: `web/configurator/src/core/checkup.ts`
- Test: `web/configurator/tests/checkup.test.ts`

**Interfaces:**
- Consumes:
  - `recommendedForAll`, `allowanceOf`, `rawOf`, `same`, `sameRadio`, `blockKeys`, `BLOCKS` (`core/blocks.ts`);
  - `siteOf`, `timingOf`, `FIRMWARE_TIMING` (`core/site.ts`);
  - `policyFor`, `regionsByState`, `homeRegionCode`, `defaultRegionCode` (`core/regions.ts`);
  - `sendableName`, `formatRadio`, and the formats-for-anchor helper in `core/plan.ts` (export it as `prefixFormatsFor(anchor)` if it is not exported).
- Produces:
  - `type CheckupGroup = "name" | "radio" | "advertising" | "repeating" | "regions" | "advanced"`
  - `type CheckupLine = { id: string; group: CheckupGroup; labelKey: string; from: string; to: string; ticked: boolean; disabled?: boolean; noteKey?: string; detail?: { adds: string[]; denies: string[]; removes: string[] } }`
  - `checkupLines(plan: Plan, places: Place[]): CheckupLine[]`, in group order.
  - `applyCheckup(plan: Plan, places: Place[], ids: Set<string>): Plan`
  - `checkupCounts(lines: CheckupLine[]): { total: number; perGroup: Partial<Record<CheckupGroup, number>>; nameDiffers: boolean }`
    - `total` and `perGroup` count lines with `ticked && !disabled` by default.
    - The `regions` count is 1 when present.

- [ ] **Step 1: Write the failing tests** on `P = planFromSnapshot(snapshotFromReplies(read), PLACES)` changed so that `dutycycle` is "50", `floodMaxUnscoped`/`floodMaxAdvert` are 64/64, `loopDetect` is "off", the timing is 0.5/0.2/0, and the name suffix is set with `prefixFormat: "none"`:
  - `"lists each difference once, in group order"`:
    - The ids are `["name", "dutycycle", "hops", "loopDetect", "regions"?, "timing"]`, with regions only if the policy differs.
    - The `hops` line's `from`/`to` are the level labels (`"Full (64 / 64)"` → `"Average (8 / 12)"`).
    - `timing` → `"Suburban (0.8 / 0.4 / 3)"`.
  - `"the name is listed, not ticked, with its note"`: `ticked: false` and `noteKey: "checkup.nameNote"`.
  - `"applyCheckup with every ticked id equals the recommendation for those blocks, and leaves the name alone"`.
  - `"applying the name line sets the recommended prefix format"`.
  - `"without an anchor"`: there is no name line, the regions line is `disabled: true, ticked: false, noteKey: "checkup.needLocation"`, and the settings lines are still there.
  - `"nothing differs: no lines"` for `recommendedForAll` of a plan with the default policy and the recommended name.
  - `"checkupCounts"`: `total` is 5 and `perGroup` is `{ radio: 1, advertising: 1, repeating: 1, advanced: 1, regions: 1 }` when the regions differ; `nameDiffers` is true.
- [ ] **Step 2: Run to see them fail.**
- [ ] **Step 3: Implement.** The recommended plan is `rec = recommendedForAll(plan)`, with `rec.regions = policyFor(plan.anchor, places)` when there is an anchor, and `prefixFormat` the first of `prefixFormatsFor(anchor)`.
  - **Radio:** one `radio` line when `!sameRadio`; `dutycycle` is its own line.
  - **Hops:** one `hops` line for the floodMaxUnscoped/floodMaxAdvert pair.
  - **Timing:** one `timing` line for txdelay/directTxdelay/rxdelay. Its label is the site name, or `"own (a / b / c)"` when `siteOf` gives `own`/`custom`.
  - **Other settings:** each other key of each block gets a line when `!same(rawOf(plan,k), rawOf(rec,k))`.
  - **Regions:** a line when the allowed/denied sets, the home, the default or `untaggedFlood` differ. `from`/`to` are the home codes, and `detail` lists codes added, newly denied and removed.
  - **Note keys:** the name line gets `checkup.nameNote` and the timing line gets `checkup.timingNote`.
- [ ] **Step 4: Run `npm test`:** it should PASS.
- [ ] **Step 5: Commit:** `feat(RRY-Map-Bot): check-up lines against the #BEmesh recommendation`.

### Task 6: Send only the changes, and the access list save before a reboot

**Files:**
- Modify: `web/configurator/src/steps/Send.tsx` (the switch, counts, button label)
- Modify: `web/configurator/src/state/device.ts` (`applyPlan`, `restartDevice`)
- Modify: `web/configurator/src/state/store.ts` (`aclSaveUntil`)
- Modify: `web/configurator/src/i18n/en.json`
- Test: `web/configurator/tests/steps-send.test.tsx`

**Interfaces:**
- Consumes:
  - `buildScript(..., { snapshot })` and `unchangedCount` (Task 4).
- Produces:
  - `SEND_ALL_PREF = "configurator.includeDefaults"` (the same stored key, renamed constant).
  - `store.aclSaveUntil: Signal<number>` (0 = nothing pending).
  - `waitForAclSave(): Promise<void>`.

- [ ] **Step 1: Write the failing tests:**
  - `"after a Read, Apply sends only the changes"`:
    - Set the snapshot and device regions from the fixture, plan = `planFromSnapshot` plus `floodAdvertHours: 47`.
    - Clicking Apply sends `["ver", "set flood.advert.interval 47", ...READ_BACK_COMMANDS]`.
    - The heading reads `"1 change to send"` and the badge `"N settings unchanged"`.
    - The button reads `"Apply 1 change to repeater"`.
  - `"the switch sends every setting"`: turning on `"Send every setting, also the unchanged ones"` sends the full script (`buildScript(..., { includeDefaults: true, device })`) and stores `"1"` in the pref.
  - `"after the read-back there is nothing to send"`: after the Apply above, against a fake port whose replies reflect 47, the button reads `"Nothing to send"` and is disabled.
  - `"without a Read the full script is sent"`: the existing Apply tests keep passing unchanged.
  - `"a reboot right after setperm waits for the save"`:
    - Use fake timers, with the plan's acl adding a key.
    - After Apply, "Reboot now" shows `"Saving the access list…"`.
    - `reboot` is not sent until 6000 ms after the last `setperm` reply.
- [ ] **Step 2: Run to see them fail.**
- [ ] **Step 3: Implement.**
  - **Script used:** `Send` shows and Apply sends the same script: `buildScript(plan, places, { includeDefaults: true, device, snapshot: sendAll ? undefined : snapshot ?? undefined })`.
    - Without a snapshot this is the full script.
    - The old "Include unchanged defaults" checkbox and its display-only behaviour are removed.
  - **Heading and badge:**
    - Heading: `review.toSend_one` "{count} change to send" / `review.toSend_other` "{count} changes to send".
    - Badge: `review.unchanged_one` "{count} setting unchanged" / `review.unchanged_other` "{count} settings unchanged", shown only with a snapshot and the switch off.
  - **Switch and button:**
    - `review.sendAll`: "Send every setting, also the unchanged ones".
    - Button: `apply.buttonChanges_one` "Apply {count} change to repeater" / `apply.buttonChanges_other` "Apply {count} changes to repeater", or `apply.nothing` "Nothing to send" (disabled) when the line count is 0.
    - With the switch on or without a snapshot, the label stays `apply.button`.
  - **Apply and reboot:**
    - When Apply sent a `setperm` line, it sets `store.aclSaveUntil = Date.now() + 6000` after the last one.
    - `restartDevice("reboot")` awaits `waitForAclSave()` first.
    - While waiting, the reboot dialog and drawer show `reboot.savingAcl` "Saving the access list…".
- [ ] **Step 4: Run `npm test`:** all PASS.
- [ ] **Step 5: Commit:** `feat(RRY-Map-Bot): Apply sends only the changes after a Read`.

### Task 7: Access list card

**Files:**
- Create: `web/configurator/src/steps/settings/AccessList.tsx`
- Modify: `web/configurator/src/steps/Advanced.tsx` (render the card after the block cards in `settings-main`)
- Modify: `web/configurator/src/app/DeviceDrawer.tsx` (an import keeps the current `acl`: `importPlan({ ...plan, acl: store.plan.peek().acl })`)
- Modify: `web/configurator/src/app/app.css`, `src/i18n/en.json`
- Test: `web/configurator/tests/steps-advanced.test.tsx`

**Interfaces:**
- Consumes:
  - `normaliseKey`, `aclChanges`, `ACL_MAX`, `AclEntry` (Task 1);
  - `store.data.nodes` (`MeshNode`: `public_key`, `type`, `adv_name`; companions are `type === 1`);
  - `store.startPlan`.

- [ ] **Step 1: Write the failing tests** (the plan has `acl` with two entries; `store.data.nodes` has a companion named "BE-GNT-Pieter" with key K4):
  - `"shows each key with its map name, shortened key and role"`:
    - The rows show "Unknown key" for a key not on the map.
    - The key shows as first 6 … last 6.
    - The role select has Admin / Read-write / Read-only.
  - `"remove strikes the row with a removed badge; undo restores it"`.
  - `"adds a pasted key as Admin with a new badge"`: paste K4 with spaces, then click Add.
  - `"refuses a short or duplicate key"`: shows the error `acl.badKey` "Not a public key: 64 hexadecimal characters" or `acl.duplicate` "This key is already on the list".
  - `"offers companions from the map by name or key prefix"`: typing "Pieter" lists "BE-GNT-Pieter", and choosing it adds K4.
  - `"the badge counts the changes and ↺ resets to what was read"`.
  - `"at 32 entries the card warns"`: `acl.full` "The repeater keeps at most 32 entries; when it is full it drops the least active ones that are not admins."
  - `"without a Read the card asks for one"`: `acl.needRead` "Read the repeater to see its access list."
  - `"recommended buttons never change the list"`: `recommendedForAll` keeps `plan.acl`.
  - In `drawer.test.tsx`: `"importing a backup keeps the access list"`.
- [ ] **Step 2: Run to see them fail.**
- [ ] **Step 3: Implement the card.**
  - **Header:** the title `acl.title` "Access list", the change badge using `settings.badge.changes` like the block cards, and ↺ when there are changes.
  - **Text:** the help line `acl.help` "Keys on this list log in from the MeshCore app without the password."
  - **Removed rows:** these are entries in `startPlan.acl` but not in `plan.acl`. Show them struck through with `acl.removed` "removed" and ↺.
  - **New rows:** these get `acl.new` "new".
  - **Add field:** the placeholder is `acl.addPlaceholder` "Paste a public key, or search a companion on the map…" and the button is `acl.add` "Add".
  - **Role labels:** `acl.role.3` "Admin", `acl.role.2` "Read-write", `acl.role.1` "Read-only".
  - **Unknown key:** `acl.unknown` "Unknown key".
  - **Edits:** they replace `plan.acl` via `editPlan`.
- [ ] **Step 4: Run `npm test`:** it should PASS.
- [ ] **Step 5: Commit:** `feat(RRY-Map-Bot): access list card in Advanced`.

### Task 8: Connect notice and the check-up dialog

**Files:**
- Create: `web/configurator/src/app/CheckupDialog.tsx`
- Modify: `web/configurator/src/steps/Connect.tsx`, `src/app/app.css`, `src/i18n/en.json`
- Test: `web/configurator/tests/checkup-dialog.test.tsx`, `steps-connect-place.test.tsx`

**Interfaces:**
- Consumes:
  - `checkupLines`, `applyCheckup`, `checkupCounts` (Task 5);
  - `Dialog` (`app/Dialog.tsx`).

- [ ] **Step 1: Write the failing tests:**
  - `"after a Read the notice counts the differences per block"`:
    - The text reads `"5 settings differ from #BEmesh"`.
    - The breakdown reads `"Radio 1 · Advertising & hops 1 · Repeating 1 · Regions · Advanced 1"`.
    - Then `"The name differs too."`.
    - A `"Quick check-up…"` button follows.
  - `"a repeater that follows the recommendation"`: the notice reads `checkup.allGood` "This repeater follows the #BEmesh recommendation" with no button.
  - `"no notice before a Read"`.
  - In the dialog:
    - the title is "Quick check-up";
    - the subtitle is `checkup.subtitle` "{name} compared with the #BEmesh recommendation";
    - lines are grouped with "now → recommended";
    - the name box is unticked;
    - the footer reads `checkup.ticked` "{n} of {m} ticked".
  - `"Send N changes… applies the ticked lines and opens Send"`: `store.step` is `"send"`, and the plan equals `applyCheckup(plan, places, ticked)`.
  - `"Open in the steps applies and opens Place"`.
  - `"Escape and ✕ change nothing"`.
  - `"with nothing ticked both buttons are disabled"`.
  - `"a disabled regions line cannot be ticked and shows Choose a location in Place first"`.
- [ ] **Step 2: Run to see them fail.**
- [ ] **Step 3: Implement.**
  - **Connect notice:** shown when `store.lastRead.value?.ok && store.snapshot.value`, from `checkupCounts(checkupLines(store.plan.value, places))`.
  - **Strings:**
    - `checkup.differ_one` "{count} setting differs from #BEmesh" / `_other` "{count} settings differ from #BEmesh"
    - `checkup.nameToo` "The name differs too."
    - `checkup.open` "Quick check-up…"
    - `checkup.title` "Quick check-up"
    - `checkup.send_one` "Send {count} change…" / `_other` "Send {count} changes…"
    - `checkup.steps` "Open in the steps"
    - `checkup.nameNote` "Not ticked: people and the map know your node by its name."
    - `checkup.timingNote` "Pick another site in Site if the repeater is on a hill or in town."
    - `checkup.needLocation` "Choose a location in Place first"
    - `checkup.regionsDetail` "Adds {adds} · denies flood for {denies} · removes {removes}" (parts with an empty list are left out)
  - **Group headings:** reuse `settings.card.*` for the blocks, `script.group.name` for Name and `script.group.regions` for Regions.
- [ ] **Step 4: Run `npm test`, `npm run typecheck` and `npm run build`:** all clean.
- [ ] **Step 5: Commit:** `feat(RRY-Map-Bot): quick check-up after a Read`.

---

## Rulings made while planning

- **Card position:** the spec says the access list card goes "below Access", but Advanced has no Access card since part 2 (the passwords moved to Send). The card goes after the block cards instead.
- **Counting changes:** "N changes to send" counts command lines, the same unit the Apply progress uses. "M settings unchanged" counts only the name/settings/location lines dropped, so an unchanged region group does not inflate it.
- **"Send every setting" for the access list:** the access list group is always a diff against what was read. "Send every setting" re-sends every setting, not every access list entry.
