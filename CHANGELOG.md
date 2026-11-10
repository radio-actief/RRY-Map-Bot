# Changelog

What changed in each release of the #BEmesh map, bot and configurator.

## 1.0.8 (2026-11-10)

### New

- The configurator sets a repeater's timing from the repeaters it actually hears: "Count its neighbours" listens for up to a minute and proposes the timing for that many, instead of asking what kind of site it stands on. Count once it stands at its final spot, ideally after a day
- The recommended flood advert interval is now each repeater's own hour between 35 and 59, picked from its key, so the network's adverts don't all go out at once
- The configurator recommends resetting the radio's gain control every 4 seconds, and offers the front-end amplifier switch on the few boards that have one
- Sending to a repeater tries a line again when it gets no answer, and stops with a clear message when the repeater stops answering, instead of failing on the first silent line
- Groundwork to show NodeBook and MeshMate next to the map and configurator later; nothing changes on this site yet

## 1.0.7 (2026-11-05)

### New

- When you export a configurator backup with a password filled in, it asks whether the file should include the admin and guest passwords. Left out, importing the file keeps the repeater's own passwords
- The bot's help post tags the admin team instead of one person

## 1.0.6 (2026-11-05)

### New

- On a phone, the configurator's ☰ menu lists the other pages, like the other pages do
- The ☰ menu's rows are big enough to tap on a phone, and the menu closes as soon as you start dragging the map
- The stats chart's legend shows a square for growth and decline and a line for each node type, and the tiles fill their rows on phones and tablets
- Signing in now lasts through updates of the site

### Fixed

- A node without a name no longer stops the map from showing any nodes
- Node names are always shown as text, also in the stats map's labels
- The stats radio filter finds every matching node: a bandwidth of 250 found none, and 869.6 MHz also counted 869.618
- Stats playback shows the newest changes again, so moved or renamed nodes show where they are now
- The stats "Active" tile shows all three numbers on laptop screens, and the chart keeps its colours readable after switching between light and dark
- Claiming, unclaiming and signing out only work from the map's own pages, so no other site can do it for you
- The map only offers to open the Discord invite after a sign-in, never another link
- The Discord bot stays responsive while it posts the daily digest
- In the configurator, an emptied hop field sends and shows the #BEmesh 4, 6 and 10

### Other

- The site runs on a production web server
- MapMe.SH is no longer listed on the stats page: the app no longer exists

## 1.0.5 (2026-11-05)

### New

- Panels, popups and menus over the map are see-through glass, and every button and link shows clearly when you hover it or reach it with the keyboard
- The node popup is about half as tall and still shows everything: the QR code sits beside the key and link, and the dates share one line
- Long-press or right-click the QR code to save it as an image
- The configurator recommends a flood advert of 35 to 59 hours, picked from the repeater's key, and the Minimal hops: 4 without region, 6 for adverts, 10 at most. A repeater already between 35 and 59 hours stays on the recommendation
- Busy repeaters, such as at the coast, can keep 0 or few hops without region: the check-up leaves that line unticked and says why
- In Regions, eu is marked optional, like the gewest: #BEmesh advises be plus your province

### Fixed

- On a phone, the analyzer links under a node popup's search button can be tapped again
- Copying a key or link works on every address, and says so only when it really copied
- Text fields on a phone no longer make the page zoom in
- A searched place lands in the middle of the map you can see, not behind the step panel
- Tooltips, the map credit line and the configurator's zoom buttons are readable and in view in both themes

## 1.0.4 (2026-11-04)

### Fixed

- In the light theme, "Sign in with Discord" on hover and the open Preset and Download buttons on the stats page are readable again
- The configurator map's theme button turns dark in the dark theme, like on the other maps
- The configurator's name in the top bar no longer touches the page tabs

## 1.0.3 (2026-11-04)

### New

- The map, stats, region map and configurator wear the Radio-Actief house style: a dark top bar in both themes, the #BEmesh wordmark, a yellow mark on the current page and language, and gold map clusters
- Calmer colours in light and dark, with gold text darkened where it sits on a light background so it stays readable
- About in the ☰ menu on every page shows the release, its notes and a line on what BEmesh is

## 1.0.2 (2026-11-02)

### Fixed

- Nodes in 14 municipalities get their corrected city code, such as Kruisem, Nazareth-De Pinte and Halle: the live server now has the municipality borders that match its place list

### Other

- Releases have version numbers and release notes, and are tested and deployed automatically; each deploy backs up the database first

## 1.0.1 (2026-11-02)

### New

- After a Read, the repeater's card lists the repeaters it hears, with how long ago and the signal strength
- The map's credit line shows the configurator's release number
- The recommended flood advert interval is 40 to 56 hours, picked from the repeater's key, so not every repeater announces itself at the same time
- When a send stops halfway, the configurator says how many commands went through, and warns when region changes are not saved yet

### Fixed

- On a phone, the ☰ menu opens over the region map instead of behind it
- Old configurator links keep only the language
- The sync health check says "busy" instead of raising a false alarm while the sync uses the database

## 1.0.0 (2026-10-28)

The complete overhaul of the #BEmesh map, Discord bot and configurator.

### New

- A new configurator: set up a new repeater step by step, or check and update an existing one over USB (only the changes are sent), with the #BEmesh recommendations per block, regions, access list and a check-up
- A Companion page for locals and visitors (/join, /visit): the radio preset, "be" as the default region, and the channels for your place as QR codes and app links, with a short animated guide
- The map, stats and region map share one look, with light and dark themes and an EN · NL · FR language switch
- Much faster first load: compressed and cached data, and a lighter municipality file
- The Discord bot: clearer claim and unclaim messages, a daily digest that catches up after a restart, and an instructions post that is updated instead of posted again
- The sync has a real health check and keeps its failure log small

### Fixed

- Phone layout fixes, such as a search tap getting lost while the keyboard is open
