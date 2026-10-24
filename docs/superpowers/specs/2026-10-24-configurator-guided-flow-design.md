# Configurator rebuild, part 2: guided flow, site profiles and free regions

Part 2 of the #BEmesh configurator rebuild (see the part 1 spec,
`2026-10-24-configurator-foundation-design.md`, for the parts table, stack, layout and
architecture). It builds on part 1 as it stands on `feat/configurator-rebuild` at `a7b5c4a`.

## Goal

Someone setting up a repeater gets a short guided path with recommended values:
**Place → Name → Site → Regions → Send**. Today's full settings page stays available as an
optional Advanced step. Two features come with it:

- **Site profiles:** one choice (Hilltop, Foothills, Suburban, Local, or keep the device's
  own) sets the repeater's three timing values.
- **Free regions:** besides the Belgian region tree, people can add their own region codes
  under a parent of their choice.

Part 2 is done when:

- the guided flow below works end to end, with and without a device;
- for the same inputs, an imported backup (v1 or v2) still produces the same command script
  as before part 2; the 7 parity fixtures stay byte-identical;
- a repeater configured through the guided flow with a Site profile and a free region reads
  back the same values on the Mac dev environment, and an empty admin password still keeps
  the current one;
- `npm test` and the typecheck pass and the Docker image builds.

## Decisions already made

- **One flow, guided** (not a separate "new" and "existing" mode). The guided steps replace
  part 1's step sequence; part 1's Settings step becomes the optional Advanced step.
- **Site values:** MeshNO's table, unchanged (see Site below). Tuning later means editing
  one table.
- **Free regions:** any code, with a parent the user picks.
- English only; every new text goes through the translation layer.

## The steps

The stepper shows six steps plus Advanced:

| # | Step | Layout |
|---|------|--------|
| 1 | Connect | panel + map |
| 2 | Place | panel + map |
| 3 | Name | panel + map |
| 4 | Site | panel + map |
| 5 | Regions | panel + map |
| – | Advanced (optional) | full width |
| 6 | Send | full width |

- The counter reads "N / 6". Advanced is a narrower segment between Regions and Send,
  labelled "Advanced (optional)". It is grey until visited and never turns orange.
- Regions' footer button is "Next: Send", with an "Advanced settings" link beside it.
  Advanced has Back (to Regions) and "Next: Send". Send's Back goes to Regions.
- The 📍 location chip shows on the full-width steps (Advanced and Send), as on part 1's
  steps 4–5.
- Clicking a segment still jumps to that step, with no forced order.

1. **Connect:** unchanged from part 1 (Connect over USB, device card, Read, "Continue
   without a device").
2. **Place:** part 1's step 2 without the name fields: search, map click, pin drag, "Use my
   location", the coordinates, and the advert location choice. The "coordinates required"
   attention shows only once a place has been chosen or the step was left; Send keeps
   blocking Apply without valid coordinates when the advert location is a fixed position.
3. **Name:** the prefix and the user's own part, the byte counter, the "already used nearby"
   check, and owner info.
4. **Site:** the five choices below as cards with their description and neighbour range,
   plus a line with how many repeaters the map shows within 25 km. No card is picked
   automatically from that count.
5. **Regions:** part 1's step 3 (recommended rows, the four neighbour groups, the bulk
   buttons, More options), plus "Your own regions" (see Free regions).
6. **Send:** part 1's Review & send, plus a "Before you send" card at the top of the left
   column with:
   - new admin password (empty keeps the current one) and guest password, as editable
     fields;
   - TX power, duty cycle and the radio preset as read-only text, each with a link that
     opens Advanced.

**Advanced** is part 1's Settings step unchanged (cards, Advanced section open, mini map,
summary), except that the fields moved to Name (owner info) and Send (passwords) are not
repeated there.

## Site

| Choice | Description (shown on the card) | Neighbours | txdelay | direct.txdelay | rxdelay |
|--------|------------------------------|------------|---------|----------------|---------|
| Hilltop | Clear view over a larger area: a mast, a ridge, the roof of a high-rise. | 20+ | 2.0 | 2.0 | 3 |
| Foothills | Bridge between hilltop nodes and the ones in town: a hillside, or a high roof outside town. | 10–20 | 1.5 | 1.0 | 3 |
| Suburban | A typical rooftop covering your own neighbourhood. | 5–10 | 0.8 | 0.4 | 3 |
| Local | Hears only a few others: indoors, ground level, a low roof. | 1–3 | 0.3 | 0.1 | 3 |
| Its own | Keeps the timing the repeater already has. | – | – | – | – |

- The chosen card is **derived** from the plan's three timing values; nothing else is
  stored. A card is selected when all three values match it.
- When no profile matches: "Its own" is selected if the values equal the device's (from the
  last Read) or, without a Read, the firmware defaults; otherwise a "Custom" card is shown
  as selected, with the three values.
- Clicking a profile card sets the three values. Clicking "Its own" sets them back to the
  device's values, or to the firmware defaults without a Read.
- Editing any of the three in Advanced moves the selection accordingly (often to Custom).
- A **new plan** (no Read, no import) starts on Suburban. A plan from a Read keeps the
  device's values. An imported backup keeps its values, and missing timing values are
  filled with the firmware defaults, not Suburban, so old backups produce the same script.
- The script emits `set txdelay`, `set direct.txdelay` and `set rxdelay` under the same rules
  as every other setting (left out when unchanged unless "Include unchanged defaults").

## Free regions

- A "Your own regions" group in Regions, after the neighbour groups, with an "Add a region"
  form: code, parent, Add.
- **Code:** 1 to 30 characters (the firmware's name field is 31 bytes), lowercase `a–z`,
  digits and `-`. Not `*`, and not a code that already has a row. Invalid input shows an
  inline error and Add stays disabled.
- **Parent:** top level, `eu`, `be`, a gewest or province row, the home municipality, or
  another free region. Shown as "Name (code)" like the rows.
- A new row starts on Allow and has Allow / Not set / Deny like any other row, plus a remove
  button. Free rows are never locked by neighbour gating.
- The region script defines each free region under its parent, in the same tree as the
  Belgian codes (`region def` packing and ordering rules unchanged; free codes after the
  structured ones). A parent that is itself not otherwise needed gets defined too.
- Allowed free regions are offered as home region and default scope.
- Codes read from a device that are not in the tree keep showing under "Read from the
  device", as in part 1.

### Region count

- The firmware holds at most **32 regions** (`MAX_REGION_ENTRIES`, not counting `*`) and
  silently refuses new ones beyond that.
- The plan gets a regions error when the regions the device will hold after Apply (the
  defined tree plus device regions that are kept) exceed 32. The message gives the count
  and the limit. Regions shows attention and Send lists it as a reason Apply is blocked.

## Backups

- The v2 backup stores the free regions (code, parent, state). Importing restores them.
- v1 backups and v2 backups from part 1 import unchanged (no free regions).
- Site needs no backup field: it follows from the timing values.

## Part 1 leftovers fixed here

- **"Coordinates required" on a fresh plan:** see Place above.
- **"Already used nearby" after a key write:** after a vanity or random key is written, the
  nearby-name check ignores both the old and the new public key of the connected repeater,
  so it never flags its own name.

Still parked: the 151-byte line limit (room servers need 150; room servers are not
supported), and the drawer showing the old private key until a reboot (the firmware keeps
the old key until then).

## Architecture

- `core/site.ts` (new): the profile table, `siteOf(timing, reference)` and
  `timingFor(choice, reference)`; `reference` is the device's values or the firmware
  defaults.
- `core/regions.ts`: free region rows (group `free`, with a `parent`), code validation,
  their place in the `region def` tree, and the region count.
- `core/plan.ts`: the region count error and the "coordinates required" timing; the new-plan
  default timing.
- `core/backup.ts`: free regions in v2.
- `steps/`: `Place.tsx` and `Name.tsx` (split from `PlaceName.tsx`), `Site.tsx`, `Send.tsx`
  (from `Review.tsx`), `Advanced.tsx` (from `Settings.tsx`); `Regions.tsx` gains the free
  group.
- `app/Stepper.tsx`, `state/store.ts`: the new step list, the optional Advanced segment and
  its status rules.

## Testing

- **Unit:** `siteOf` / `timingFor` for every profile, Its own and Custom; new-plan vs
  imported-plan timing; free code validation (length, characters, duplicates, `*`); free
  regions in the `region def` tree under each parent kind; the 32-region error; v2 backup
  round trip with free regions; the 7 parity fixtures unchanged.
- **Components:** the stepper (six steps plus optional Advanced, counter, footer links);
  Site cards selecting and following Advanced edits; Add a region (errors, Add, remove);
  Send's "Before you send" card; no "coordinates required" on a fresh plan; no "already
  used nearby" for the repeater's own name after a key write.
- **Hardware (Mac dev environment, spare repeater):** guided flow → Hilltop and one free
  region → Apply → Read back shows the Hilltop timing and the free region; an empty admin
  password keeps the current one.

## Not in part 2

- Compare with the device and send only changes; the access control list (part 3).
- Configuring over the mesh (part 4); the companion task and "Why regions" page (part 5).
- The Dutch translation.
- Suggesting a Site card from the number of nearby repeaters.
- Hashtag (`#`) regions and their transport keys.
