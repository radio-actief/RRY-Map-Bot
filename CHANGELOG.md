# Changelog

What changed in each release of the #BEmesh map, bot and configurator.

## 1.6.0 (2026-11-17)

### New

- On your account page you choose whether your name shows with your nodes, and whether partner tools may see your nodes. Partner tools never get your Discord account
- Owners can add managers to a node with a one-time invitation link; managers see the node under My nodes and can step down
- Groundwork for partner tools such as the ON8AR analyzer: they ask your permission once before you sign in with #BEmesh there, and you can withdraw it on your account page

## 1.5.0 (2026-11-16)

### Changed

- Signing in from two tabs at once now works in both
- Logging out from NodeBook asks once instead of twice; only the site's own tools may log you out, and only back to themselves
- After logging out the map says so, and your other open map tabs follow a sign-in or log out without a reload
- The log-out and failed sign-in pages have the site's top bar and fonts, with the main button on the right

## 1.4.1 (2026-11-16)

### New

- The configurator's maps (Place, Regions, Companion and the mini map in Settings) run on the same new map engine as the map and the region map, with the same base maps, buttons and place names in your language

### Changed

- In the Regions view only the most specific allowed area is filled; wider allowed areas keep their green outline, so the map stays readable

## 1.3.0 (2026-11-16)

### New

- The region map runs on the same new map engine as the map, with the same base maps and buttons; the province or country you pick gets a clear outline
- Place names on the maps follow your language: Brussel, Bruxelles or Brussels

### Changed

- If your device asks for less motion, the maps no longer animate

## 1.2.0 (2026-11-16)

### New

- The map runs on a new map engine (MapLibre, as the official MeshCore map): sharp maps at every zoom, a calm grey map in light and a dark map in the site's colours. In the layers menu you can also pick Streets, VersaTiles, OpenStreetMap or Satellite. Browsers without WebGL keep the previous map
- "Nodes in view" in the Filters panel lists the nodes on screen, so you can open them with the keyboard too
- Bigger map buttons on a phone
- The map's base maps come from OpenFreeMap by default; the other choices from VersaTiles, OpenStreetMap and Esri, only when you pick them

## 1.1.1 (2026-11-16)

### Fixed

- The configurator asks once more when a repeater's neighbour list comes back short
- After you restart a repeater from the configurator, its clock is set again when you reconnect it
- Counting neighbours reads the repeater's list one time fewer when the first round hears nobody

## 1.1.0 (2026-11-16)

### New

- Coverage and profile on the map: "Show coverage" on a repeater, "Profile from here" and "Profile to here" on every node, and the same from a right click or a long press on the map. The coverage is an estimate from terrain and forests, not a promise of reach; its terrain and map data come from Mapterhorn and OpenFreeMap, which see your address and the area you look at. The profile draws the ground, the line of sight and the Fresnel zone between two points. Shared links keep both. Based on the official MeshCore map (MIT)
- Your account page: your name, the nodes you claimed, a link to your NodeBook fleet, and Log out or Log out everywhere (also on your other devices). The account button in the top bar opens it
- One set of names for node types everywhere: Companion, Repeater, Room server, Sensor

## 1.0.15 (2026-11-16)

### Changed

- A new top bar on the map, stats, region map and configurator: always one row, clearer icons, bigger buttons on a phone, and the same ☰ menu everywhere, which now stays on screen
- The page names and the stats page are fully translated in Dutch and French
- On a phone the page links, sign-in and language are in the ☰ menu

## 1.0.14 (2026-11-16)

### Fixed

- The map's node popup shows owner names and unusual location text as plain text

### Other

- NodeBook and MeshMate can see whether you are signed in on the map without sending you through the sign-in first, so their first page opens faster

## 1.0.13 (2026-11-16)

### Other

- NodeBook and MeshMate can show the same outside links in their menus as the map does, in your language

## 1.0.12 (2026-11-16)

### Faster

- The stats page loads about five times less data and shows its charts much sooner
- Every page, its scripts and its styles are sent compressed, so the map, the region map and the configurator load faster, most of all on a phone
- The fonts now come from this site instead of Google, so your browser no longer contacts Google when you open a page

## 1.0.11 (2026-11-16)

### Changed

- The site starts in your browser's language. When you pick a language, the site remembers it for a year. A language you picked before this release gives way to your browser's language once
- You sign in to the map once more after this release: the sign-in now stays on the map's own address

### Other

- Groundwork for signing in to NodeBook through the map and sharing the language choice with NodeBook and MeshMate; nothing changes on this site yet

## 1.0.9 (2026-11-15)

### New

- When signing in doesn't work (you cancelled at Discord, the sign-in took too long, or you're not a member of the Discord server yet), you get a short page that says what happened, with Try again and a way back, instead of a pop-up
- The configurator shows the device's name and board as soon as it connects, and "Reconnect <name>" puts a repeater you used before back in one click
- If another tab already holds the repeater, the configurator says so and offers to take it over
- The configurator accepts a gain-control reset interval up to 1020 seconds, as the firmware does
- The configurator names the browsers that can use USB: Chrome, Edge, or Firefox 151 or later on a computer

### Fixed

- Safer sign-in: you get a fresh session every time you sign in, and every page now runs under a strict content policy
- Configurator backups keep regions whose names contain #, $, _ or capitals, the access list stays with its own repeater, and passwords no longer show in the log
- Sending to a repeater stops on a real error instead of retrying it, and names the lines that got no answer
- Claiming a node from Discord with /node asks for confirmation when there is a single match
- The sync stops removing nodes when its Belgian check fails, and skips broken records
- Groundwork for NodeBook and MeshMate on their own addresses next to the map; nothing changes on this site yet

You may need to sign in once more after this update.

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
