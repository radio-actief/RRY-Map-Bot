# Configurator rebuild, part 3: an existing repeater over USB

Part 3 of the #BEmesh configurator rebuild (see the part 1 spec,
`2026-10-24-configurator-foundation-design.md`, for the parts table, stack and layout, and the
part 2 spec, `2026-10-24-configurator-guided-flow-design.md`, for the steps, blocks and the
repeater's current value). It builds on `feat/configurator-rebuild` at `39bbef0`.

## Goal

Someone with a repeater that is already running connects it over USB, reads it, and brings it
in line with #BEmesh or changes a few things. Only what differs from the repeater is sent.

- **The guided steps stay the default path.** After a Read, Place → Name → Site → Regions →
  (Advanced) → Send work as in part 2, with the repeater's values shown next to each field.
- **A quick check-up is the shortcut.** One screen lists everything that differs from the
  #BEmesh recommendation, "now → recommended", with a tick-box per line.
- **Send only the changes.** After a Read, Apply sends only the lines whose value differs
  from what the repeater holds. A switch sends everything, as today.
- **Access list.** Advanced gets a card that shows which public keys may manage the repeater,
  with their role, and lets people add, change and remove them.

Part 3 is done when:

- after a Read, the Connect step says how many settings differ from #BEmesh and offers the
  check-up;
- the check-up applies the ticked lines to the plan and takes the user to Send (or to the
  steps);
- Apply after a Read sends only changed lines, and the read-back from part 2 confirms them;
- the access list is read, edited and sent, and survives a reboot right after Apply;
- a repeater set up without a Read (the new-repeater path) still gets the full script.

## Decisions already made

- Both paths: the guided steps are the default, the check-up is offered (user, 2026-10-26).
- Check-up ticks: settings and regions ticked when they differ; the name is listed but not
  ticked; location, passwords and the access list are never in the check-up (user, option a).
- Access list: full editing in part 3, not read-only (user, option a).
- Send only changes is built on the per-setting comparison the app already makes for the
  "On repeater" tags (`summarize`, `blockChanges`), not by filtering the full script.
- The mockups shown on 2026-10-26 (Connect card, check-up, access list card, Send) are the
  agreed layout.

## Connect after a Read

A new notice under the device card, shown when a Read succeeded and at least one thing differs
from the recommendation:

> **6 settings differ from #BEmesh**
> Radio 1 · Advertising & hops 2 · Repeating 1 · Regions · Advanced 1. The name differs too.
> [Quick check-up…]

- The headline counts the check-up lines that are ticked by default (each setting line, and
  the regions as one). The per-block counts follow block order and leave out blocks with no
  difference. Regions is named without a count. "The name differs too" appears when the
  recommended name differs.
- The main button stays "Next: Place →". When nothing differs, the notice reads "This
  repeater follows the #BEmesh recommendation" and offers no check-up.
- The counts follow the plan as it is edited (they compare the plan with the recommendation,
  not the repeater with it).

## Quick check-up

A dialog over the panel, titled "Quick check-up", subtitle "<name> compared with the #BEmesh
recommendation". It lists each difference between the current plan and the recommended plan,
grouped in this order: Name, Radio, Advertising & hops, Repeating, Regions, Advanced.

### The recommended plan

- **Settings:** `recommendedForAll(plan)` from part 2, with the timing following the plan's
  site (closest profile, Suburban when none matches), as the per-block buttons do.
- **Regions:** `policyFor(anchor, places)`, the default policy for the repeater's location.
  Without an anchor the Regions line is shown, not ticked and disabled, with "Choose a location
  in Place first".
- **Name:** the anchor's prefix (part 1 naming rules) with the current name's own part kept:
  an existing `BE-…-` prefix is replaced, otherwise the whole current name becomes the suffix.
  No line when the name already has the recommended prefix, or without an anchor.

### Lines

- One line per setting that differs, "Label  now → recommended", values in the units the steps
  use (hours, %, hop level names). The hop allowance is one line (the level), and the timing is
  one line (the site), even though each covers several settings.
- Regions is one line: "Home region now → recommended", with a sub-line that spells out what
  it adds, denies and removes. It is applied or not as a whole.
- The name line carries the reason it is not ticked: "Not ticked: people and the map know
  your node by its name."
- The timing line carries "Pick another site in Site if the repeater is on a hill or in town."

### Buttons

- **Send N changes…** applies the ticked lines to the plan (an edit, like any other) and opens
  the Send step, which shows the script and the Apply button. Nothing is sent from the dialog.
- **Open in the steps** applies the ticked lines and opens Place.
- **✕ / Escape** closes the dialog and changes nothing.
- The footer shows "N of M ticked". With nothing ticked, both action buttons are disabled.

## Send only the changes

When the plan has a snapshot of this repeater (a Read in this session, or the read-back after
an Apply), Apply sends only what differs from the snapshot:

- **Settings and radio:** a `set` line only when the plan's value differs from the snapshot's
  (the same comparison as the "On repeater" tag). A setting the Read got no answer for is
  always sent.
- **Name, location, `gps advert`:** sent only when they differ from the snapshot.
- **Admin password:** sent only when the field is not empty (unchanged from part 0).
- **Regions:** the whole region group (removals, def, flood flags, home, default, save) is sent
  when anything about the regions differs: the set of named regions, a parent where the tree
  was read, the flood-allowed and flood-denied sets, the home or the default scope. Otherwise
  no region line goes out.
- **Access list:** one `setperm` line per added, changed or removed key (see below).

Without a snapshot (the new-repeater path), Apply sends the full script as today.

The Send step:

- shows "N changes to send" with a badge "M settings unchanged", and the script shows only the
  lines that will go out, under their group headers;
- has a switch "Send every setting, also the unchanged ones" that makes Apply and the script
  use the full script. It replaces today's "Include unchanged defaults" checkbox and keeps its
  stored preference;
- labels the button "Apply N changes to repeater"; with nothing to send, it reads "Nothing to
  send" and is disabled (the switch can still send everything).

## Access list

### What the firmware does (MeshCore 1.16 and 1.17)

- `get acl` (USB only) prints `ACL:` and then one line per entry, `XX <64 hex>`, with the role
  in hex. It prints no `->` reply. Guest entries (role 0) are not stored, so not listed.
- `setperm <64 hex> <role>` sets a key's role: 1 read-only, 2 read-write, 3 admin. Role 0
  removes the entry (a key prefix is enough). Replies `OK`, `Err - invalid params` or
  `Err - bad pubkey`.
- The list is saved 5 seconds after the last change; a reboot before that loses the change.
- The repeater build holds at most 32 entries. When it is full, a new login evicts the least
  active entry that is not an admin.

### Reading

- `get acl` joins the Read. The serial link gets a raw-lines mode for it: after the echo, it
  collects lines until the output has been quiet for 400 ms (or the command times out). A reply
  without the `ACL:` line counts as no answer.
- The snapshot holds `acl: { key, role }[]`; the plan copies it on Read. A plan made without a
  Read has no access list (`acl: null`) and the card asks for a Read.
- The read-back after Apply also reads the list.

### The card (Advanced, below Access)

- Title "Access list", a change badge like the other cards, and the line "Keys on this list log
  in from the MeshCore app without the password."
- One row per entry: the name from the #BEmesh map when the key is a known node, else "Unknown
  key"; the key shortened to its first and last 6 hex characters; a role menu (Admin,
  Read-write, Read-only); and ✕ to remove.
- A removed row stays, struck through, with a "removed" badge and ↺ to undo, until Send. A new
  row has a "new" badge.
- Add: one field "Paste a public key, or search a companion on the map…". It accepts a 64-hex
  key (spaces and dashes ignored) or offers companions from the map by name or key prefix. A
  new key gets the Admin role. A key already on the list is not added twice.
- At 32 entries the card notes that the repeater may drop the least active non-admin entries.
- The card's ↺ resets the list to what was read. "Use #BEmesh recommended settings" never
  changes it, and it is in no block.

### Sending

- Removed key: `setperm <key> 0`. New key or changed role: `setperm <key> <role>`.
- The lines go in their own script group, "Access list", after the regions.
- When Apply sent a `setperm` line, the reboot offer waits until 6 seconds after the last one,
  showing "Saving the access list…", so a reboot does not lose it.

## Backups

The access list is not part of a backup file: it belongs to one repeater. Importing a backup
leaves the plan's access list as it was.

## Architecture

- `core/acl.ts` (new): the `AclEntry` type, parsing the `get acl` output, key validation and
  normalising, the diff between two lists and its `setperm` lines.
- `core/checkup.ts` (new): the recommended plan, the check-up lines (with their block and
  whether they are ticked by default), applying ticked lines to a plan, and the per-block counts
  for the Connect notice.
- `core/cli.ts`: `buildScript` gains a `snapshot` option; with it, lines are dropped per the
  rules above, and the access list group is added.
- `core/plan.ts`: `Plan.acl`, `DeviceSnapshot.acl`, the snapshot parser for `get acl`, and a
  `regionsDiffer(plan, snapshot)` check.
- `device/serial.ts`: the raw-lines mode for `get acl`. `device/repeater.ts`: `get acl` in the
  reads.
- `state/device.ts`: Apply passes the snapshot unless "send everything" is on; the reboot waits
  for the access list save.
- UI: `steps/Connect.tsx` (the notice), `app/CheckupDialog.tsx` (new),
  `steps/settings/AccessList.tsx` (new), `steps/Send.tsx` (counts, switch, button label).
- Strings in `i18n/en.json`.

## Testing

- `core/acl`: parsing (empty list, `ACL:` only, mixed roles, junk lines), key normalising,
  diff lines (add, change, remove, unchanged, re-add after remove).
- `core/checkup`: lines for a Read fixture (each block, hop level, timing as one line, regions
  as one line, name not ticked), no regions without an anchor, applying ticked lines gives
  `recommendedForAll` for those blocks only, counts per block.
- `core/cli`: with a snapshot only changed lines; a setting missing from the Read is sent;
  regions group all or nothing; full script without a snapshot or with the switch; parity
  fixtures unchanged.
- `device/serial`: raw-lines capture over chunked output, quiet-period end, timeout.
- UI: the Connect notice and its counts; the check-up dialog (ticks, buttons, Escape); the
  access list card (add by key, add from the map, role change, remove and undo, 32-entry note);
  Send counts and switch; the reboot wait after `setperm`.
- Hardware (Mac): Read an existing repeater, check-up, Apply only changes, read-back shows no
  differences; add and remove an access list key, reboot right after, Read again.

## Not in part 3

- Managing a repeater over the mesh through a companion (part 4).
- Companion channels and the "Why regions" page (part 5).
- Room servers (needs `MAX_LINE_LEN` 150, parked from part 1).
- Guest entries in the access list (the firmware does not store them).
