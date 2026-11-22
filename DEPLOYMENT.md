# RRY-Map-Bot Deployment Guide

This guide covers deploying RRY-Map-Bot using Docker containers.

## Architecture

The application consists of three main services:

1. **Discord Bot** - Handles Discord commands and interactions
2. **API Server** - Serves the REST API and web map (Flask)
3. **Sync Service** - Periodically syncs data from the official MeshCore map

All services share the same SQLite database stored in a Docker volume.

## Prerequisites

- Docker Engine 20.10+ 
- Docker Compose 2.0+
- Discord Bot Token
- Discord Guild ID

## Quick Start

### 1. Clone and Configure

```bash
git clone <repository-url>
cd RRY-Map-Bot
```

### 2. Set Up Environment Variables

```bash
cp rry-map-bot.env.example .env
nano .env  # Edit with your values
```

**Note**: For Docker deployment, the `.env` file is used directly.

Required variables:
- `DISCORD_BOT_TOKEN` - Your Discord bot token
- `DISCORD_GUILD_ID` - Your Discord server (guild) ID
- `DATABASE_PATH` - Keep as `/app/data/belgian_nodes.db` (Docker path)

### 3. Create Required Directories

```bash
mkdir -p data logs
```

### 4. Build and Start Services

```bash
docker-compose up -d --build
```

### 5. Verify Services

```bash
# Check all services are running
docker-compose ps

# View logs
docker-compose logs -f

# Check API health
curl http://localhost:8000/api/v1/health
```

## Service Details

### Discord Bot Service

- **Container**: `rry-map-bot-discord`
- **Command**: `python3 backend/discord_bot.py`
- **Restart**: `unless-stopped`
- **Health Check**: Basic Python check every 30s

The bot will:
- Connect to Discord on startup
- Sync its slash commands with Discord (globally, at every start; a new or
  changed command can take up to an hour to show up everywhere, usually minutes)
- Update instructions post (if configured)
- Handle all Discord commands

No step is needed at deploy for a new slash command: the restart of the
`discord-bot` container registers it.

#### Privacy choices in the bot

The bot follows the two choices of the account page (`person_settings`, both on
without a row) and lets members change them:

- **Show my name with my nodes** off: everything the bot shows to others reads
  "claimed" without a name, mention or id. That covers `/search` (list and
  single node), the daily digest, the claim and unclaim announcements (from the
  bot and from the map: "A member claimed this node."), the "already claimed"
  answer of `/node claim`, and the per-sync message behind `--notify`. A
  `/search` by text doesn't match such an owner's name, and a `/search` by
  `owner` finds none of their nodes; only the person themself gets their own
  nodes that way, in an answer only they see. `/mynodes` is unchanged.
  `/node managers` shows the owner every manager's name, as the account page
  does: the owner invited them. The bot shows managers nowhere else.
- The announcement of a claim or unclaim by someone who hides their name is a
  message of the bot's own in the channel where the command was used, not a
  follow-up of their command (that would stay tied to them). The bot needs
  Send Messages and Embed Links there; where it can't post, nothing is
  announced and the person is told.
- `/privacy` shows both choices to the caller only and switches each with a
  button. It stores them with `claims.save_settings`, the function the account
  page's `/api/v1/account/settings` uses, so the map, the partner feed and the
  bot read the same values.
- `/node invite-manager` makes the account page's invitation
  (`claims.create_invite`: `manager_invites`, 7 days, one use, at most 10 open
  per node) for a node the caller owns and shows the link to the caller only.
  `/node managers` lists a node's managers for its owner and removes one
  (`claims.remove_manager`). The bot never posts a link in a channel, never
  sends a DM and never offers a member list.
- `command_log` gets one row per `/privacy` button click (`privacy button`),
  like every command: time, command name, user id, ok, duration. Not which
  choice, not its value, no invitation link.

### API Server Service

- **Container**: `rry-map-bot-api`
- **Command**: `python3 backend/api/app.py` (Waitress; Flask's own server only with
  `FLASK_DEBUG=true`)
- **Port**: `8000`, on the machine only; put a reverse proxy with HTTPS in front
- **Restart**: `unless-stopped`
- **Health Check**: HTTP check on `/api/v1/health`

Endpoints:
- `GET /api/v1/belgian-nodes` - Get all active Belgian nodes: `claimed`, and the owner's name
  (`discord_owner_name`) when they show it; never a Discord id. No public answer holds one: a
  signed-in member of the server gets an owner's id for the popup's message link from
  `GET /api/v1/nodes/<key>/ownership` (only when that owner shows their name). Our own tools ask
  `/auth/claimed` and `/auth/node` instead (below).
- `GET /api/v1/stats` - Get statistics
- `GET /api/v1/stats-history` - The stats page's history: the node change list (the same query as
  `GET /api/v1/node-changes`) replayed on the server into the nodes shown per day by type, the
  repeater growth per day and the playback map's steps (`backend/stats_history.py`). Like
  `node-changes` and `sync-history`, it is built once per database change.
- `GET /api/v1/health` - Health check (API process only)
- `GET /api/v1/health/sync` - Age of the last sync run: 200 `ok`, or 503 `stale` (older than twice the sync interval) / `no_history`; point uptime monitoring here
- `GET /` - Web map interface

Behind the reverse proxy:
- Keep the browser's `Host` header (the default): claim, unclaim and log out are refused unless
  the request's `Origin` (or `Referer`) is the site itself.
- Don't send `Referrer-Policy: no-referrer`: browsers then send `Origin: null` on the site's own
  POSTs, and claim, unclaim and log out stop working.
- Set `SESSION_COOKIE_SECURE=true` when the site is on HTTPS. Sign-ins are kept in
  `data/sessions/`, signed with `FLASK_SECRET_KEY` (or a key made once in `data/`).

### The site's tools (map, NodeBook, MeshMate)

`SITE_TOOLS_JSON` lists the tools every page's top bar and ☰ menu link to, as
`[{"key", "label", "url"}]`. A `url` is a path on this site (`"/nodebook/"`) or the tool's own
address: `https://host[:port]/path/`, ending in `/`, with no user name, query or fragment (plain
`http` only for `localhost` and `127.0.0.1`, for tests). Entries that break these rules are left
out. The list may name the map's own pages (`map`, `stats`, `regionMap`, `configurator`); the bars
show those once. Unset: the map's pages only. `GET /api/v1/site-tools` serves the list to anyone.

An entry with `"hidden": true` is a tool people can sign in to and come back to (sign-in,
`next=`, its sign-out page) before visitors see it, so it can be tried on its own address first:
`GET /api/v1/site-tools`, the top bar, the ☰ menu, the popup, the page security policy and the
device hub leave it out. Hidden is not secret: an address that names the tool's key leads to it, as
its sign-in must. Remove `"hidden"` to show it.

```
SITE_TOOLS_JSON=[{"key":"map","label":"Map","url":"https://map.example/"},
  {"key":"nodebook","label":"NodeBook","url":"https://nodebook.example/"},
  {"key":"meshmate","label":"MeshMate","url":"https://app.example/"}]
```

Each tool on its own address keeps its own browser storage, so a fault in one tool can't read
another's or act as the signed-in person there. What that needs:

- Sign-in: `/auth/login?next=` and `/auth/logout?next=` return to a map page or to a listed `url`,
  exactly. A map page gets `?logout=success` (`?logout=everywhere` after "Log out everywhere") and
  says so; a tool gets its address as it is. Up to three sign-ins may wait at once in one browser
  (two tabs, or a map tab and a tool), each for ten minutes. A shown tool on its own address that
  asked its own question logs out by posting a form from its page to
  `<map>/auth/logout?next=<its url>`: the map takes it when the request's `Origin` is that tool's
  origin and `next` is that tool's listed `url`, exactly; anything else is refused (403). That needs
  the tools on one site (as the device hub below), or the browser doesn't send the map's cookie with
  the post. Other tools (and hidden ones) log out through `GET /auth/signout?next=<their url>`: a
  page on the map's address with Log out and Cancel. The map's cookies (`bemesh_map_session`, and
  `rry_oauth` during a sign-in) stay on the map's own host: no other address ever gets them. A tool
  that needs to know who is signed in asks the map, below.
- The map popup asks NodeBook `GET <nodebook url>api/nodes/<key>` with the visitor's cookies when
  NodeBook is on another address: NodeBook answers with `Access-Control-Allow-Origin: <the map's
  origin>` and `Access-Control-Allow-Credentials: true`. "In your NodeBook" and "Add to NodeBook"
  link to `<nodebook url>node/<key>`, "Connect live" to `<meshmate url>#node=<key>`.
- Settings hand-off, in the address fragment of a new tab (it never reaches a server), with
  `<data>` = URL-safe base64 of the message's UTF-8 JSON, without padding: the configurator opens
  `<nodebook url>#/handoff?d=<data>` and receives `<configurator url>#handoff=<data>`. It takes the
  fragment out of the address at once and asks before using the settings. A link longer than
  16 KB is not sent.
- The device hub, `/device-hub.html` on the map's address: another tool loads it in a hidden frame
  to share the device channel `bemesh-device` and the last device (`bemesh.device.last`) with the
  configurator. Only the listed tools' origins and the map's may frame it (its own
  `Content-Security-Policy: frame-ancestors`). Browsers keep a frame's storage and channels apart
  per top-level site, so the hub joins the configurator only when the tools share a site (one
  registrable domain, e.g. `map.example.org` and `nodebook.example.org`, or one host with a port
  per tool); the popup's NodeBook cookies need the same. The proxy must not send
  `X-Frame-Options` on `/device-hub.html` (Traefik's `frameDeny` does, on every path of a router
  that uses it): browsers that let it win over `frame-ancestors` then refuse the hub in any frame.

### One application, four addresses

The map's stats, region map and configurator may each have a host name of their own, with their
page at `/` there, served by this same application (one session store, one API, one deploy). The
tool list decides it: entries with the keys `map`, `stats`, `regionMap` and `configurator` whose
`url` is an address at its root (`https://stats.example/`). Host routing is on only when the map
itself is listed that way and at least one of the three is; otherwise (a list without them, or
with them on paths) every page stays on its path of the map's address, exactly as without a list.

```
SITE_TOOLS_JSON=[{"key":"map","label":"Map","url":"https://map.example/"},
  {"key":"stats","label":"Stats","url":"https://stats.example/"},
  {"key":"regionMap","label":"Region map","url":"https://regions.example/"},
  {"key":"configurator","label":"Configurator","url":"https://configurator.example/"},
  {"key":"nodebook","label":"NodeBook","url":"https://nodebook.example/"}]
```

With host routing on:

- `/` answers with the page of the request's `Host` (the port counts, e.g. `127.0.0.1:4802`). The
  map's own host and any host the list doesn't name get the map, as before.
- Everything else answers on every host: `/api`, `/data`, `/src`, `/lib`, `/css`, `/img`, `/auth`,
  `/assets`, `/configurator/…` (the configurator page loads its files from there on every host),
  `/device-hub.html`, the old paths. Each page asks its own host for data, so data needs no CORS.
- The pages' links: the server puts the four links for that host in
  `<meta name="bemesh-site" content='{"pages": {...}, "map": "<map origin>", "hub": "<map>/device-hub.html"}'>`
  right after `<head>` of the map, stats, region map and configurator pages, and the top bars and ☰
  menus use them (`src/shared/topbar.js`, `web/configurator/src/app/pages.ts`). A page links to a
  shown page by its address, to itself by `/`, and to a hidden page by its path on the map's
  address. `map` and `hub` are there only on another host than the map's; `hub` only for a shown
  page. Without host routing there is no meta and the links are the fixed paths.
- Signing in stays on the map: its session cookie stays host-only on the map's host, and Discord
  still calls back to the map's `/auth/callback` only. A page on its own host asks
  `<map>/auth/me` with `credentials: "include"`: the map answers with
  `Access-Control-Allow-Origin: <that exact origin>`, `Access-Control-Allow-Credentials: true` and
  `Vary: Origin`, for the origins of these three pages only (hidden ones too), never for NodeBook,
  partners or anyone else. That needs the names on one site (one registrable domain), as the
  cookie is `SameSite=Lax`. Sign in links to `<map>/auth/login?next=<its own address>`, log out to
  `<map>/auth/signout?next=<its own address>`, the account to `<map>/account`; `next` must be a
  listed `url` exactly. After log out the page gets its address with `?logout=success`, as the
  map's pages do.
- Page security policy: a page on its own host may also connect to (and send forms to) the map's
  origin; a shown one may frame the map's device hub (`frame-src 'self' <map>`). The map's own pages
  keep their policy. The device hub's `frame-ancestors` are the shown tools' origins, so the shown
  pages are among them automatically.
- The configurator on its own host joins the device convention through the map's hub, as NodeBook
  and MeshMate do (the hub's device messages and remembered device count as its own channel's and
  storage's). USB permission is per origin: there a person picks the port once more.
- Browser storage is per origin. On its first visit to its own host, the configurator asks the hub
  for its settings kept on the map's address (`configurator.theme`, `.layers`, `.includeDefaults`,
  `.serialShowCommandLog`) and the remembered device, copies each one this host doesn't have yet
  (a remembered device only when it is newer), and marks the move done in `configurator.moved`.
  Nothing set on the new host is overwritten, the map's address keeps its copy (its pages read the
  theme there), and without an answer (the configurator still hidden, the hub unreachable) nothing
  is marked and the next visit asks again. The configurator keeps no plan or backup in storage (a
  backup is a downloaded file), so there is none to move. The language is the shared cookie and
  needs nothing.

Three steps, each a change of `SITE_TOOLS_JSON` and a deploy, each undone by the previous value:

1. Hidden (`"hidden": true` on the three): each host serves its page and signing in back to it
   works, but no page, menu, popup, page policy or device hub names it.
2. Shown: remove `"hidden"`. The bars of every tool link the new addresses; the old paths still
   answer with their pages.
3. Old paths redirect: `"redirectOldPath": true` on the three. On every host, `/stats`,
   `/region-map` and `/configurator` (and anything under them) answer 301 to that page's address,
   keeping what follows the old path and the query (`/configurator/?lang=nl` →
   `https://configurator.example/?lang=nl`); the browser carries a fragment (`#handoff=…`) over by
   itself. The configurator's built files under `/configurator/` keep answering. `/join`, `/visit`
   and `/region-configurator` then go straight to the configurator's address. The flag does
   nothing on a hidden entry or on the map. Browsers keep a 301, so this is the last step.

`node scripts/check-hosts.mjs` (with `PYTHON` pointing at a Python that has `requirements.txt`)
runs these three steps in a browser, each address a port of `127.0.0.1`.

### Signing in through the map

A tool listed in `SITE_TOOLS_JSON` with a secret in `SITE_TOOL_SECRETS_JSON`
(`{"<key>": "<secret>"}`, 32 characters or more, the same value in the tool's own settings) signs
people in through the map. Its own sessions stay its own; it never sees the map's cookie.

1. The browser goes to `GET /auth/authorize?tool=<key>&state=<state>[&prompt=none]`, `state` 1–128
   characters of `A-Z a-z 0-9 . _ ~ -`. An unknown tool or state gets a plain 400, never a redirect.
   The map sends the browser back to `<the tool's url>auth/callback` only:
   - signed in: `?code=<code>&state=<state>`;
   - not signed in: through Discord first, then the same (a Discord account that is not on the
     server gets a code too; the tool decides what membership means);
   - not signed in with `prompt=none`: at once `?error=login_required&state=<state>`;
   - cancelled or failed at Discord: the map's `/auth/failed` page, whose Try again asks again for
     that tool and whose Back goes to the tool's `url`.
2. The tool's server swaps the code: `POST /auth/token` with `Authorization: Bearer <secret>` and
   `{"tool": "<key>", "code": "<code>"}`. A code is good once, for 60 seconds, for that tool only.
   Answer: `{"handle": "<handle>", "user": {"id", "username", "global_name", "discriminator",
   "avatar", "is_guild_member"}}`. Wrong, used or expired code: 400 `{"error": "invalid_grant"}`;
   wrong secret: 401; a request with an `Origin` header or a cookie (a browser): 400.
3. Later the tool's server asks `POST /auth/alive` with the same header and
   `{"tool": "<key>", "handle": "<handle>"}`: `{"alive": true, "user": {...}}` while the map
   session that made the code is signed in, else `{"alive": false}` (signed out, expired, or signed
   in again, which gives a new session).

4. Our own tools (not partners) may also ask, with the same header, about the person behind a
   handle, so they need no Discord ids from the public node list:
   - `POST /auth/claimed` `{"tool", "handle"}`: `{"alive": true, "nodes": [{"public_key", "name",
     "type", "lat", "lon", "role": "owner"|"manager"}]}`, the active nodes the person owns or manages.
   - `POST /auth/node` `{"tool", "handle", "public_key"}`: `{"alive": true, "status": "not_on_map"|
     "unclaimed"|"yours"|"managed"|"claimed"}`, plus `"owner_name"` for `claimed` when that owner
     shows their name. A `public_key` that isn't 64 hex characters: 400 `{"error": "invalid_request"}`.
   - A dead or unknown handle (or one of another tool) answers 200 `{"alive": false}`, as
     `/auth/alive` does; a partner gets 403 `{"error": "unauthorized_client"}`; a wrong secret 401;
     a browser call 400.

The tool calls 2, 3 and 4 on the map's internal address. Codes and handles are kept in the data
directory (`tool-grants/`) under their SHA-256, never in clear.

Device hub messages, all with `v: 1`. The tool's page posts them to the frame with
`postMessage(message, "<the map's origin>")`; the hub takes them only from its parent window and
only from a listed origin, and posts only to `window.parent`, with that origin as the target, once
it has had one valid message:

| From the tool | Hub does |
| --- | --- |
| `{kind: "bemesh.device", v: 1, type, tool, transport, role, usbVendorId, usbProductId, name, publicKey}`, `type` one of `who`, `held`, `release`, `released`, `busy` | passes it to the channel `bemesh-device`; a `held` one is also kept as the last device (as `setLast` would), so a tool needn't send `setLast` too |
| `{kind: "bemesh.device.getLast", v: 1}` | answers within 2 s `{kind: "bemesh.device.last", v: 1, last}`: the remembered device (`{transport, usbVendorId, usbProductId, role, name, publicKey, at}`), or `null` when none or older than 12 hours |
| `{kind: "bemesh.device.setLast", v: 1, last: {transport?, usbVendorId, usbProductId, role, name, publicKey}}` | remembers it, stamped with the current time (`transport` defaults to `usb`) |
| `{kind: "bemesh.configurator.prefs.query", v: 1}`, only from the listed `configurator` on another origin than the map's (shown) | answers `{kind: "bemesh.configurator.prefs", v: 1, values}`: `configurator.theme`, `.layers`, `.includeDefaults` and `.serialShowCommandLog` as kept on the map's address, each a string or `null` (for the one-time move, above) |
| `{kind: "bemesh.account.query", v: 1}` | answers within 3 s `{kind: "bemesh.account", v: 1, signedIn, name}` from the map's `/auth/me`: `name` is the person's display name (or `null`), nothing else; signed out, an error or no answer in time gives `signedIn: false`. After a query it sends the same message again whenever the state changes: when another tab's hub records a change (`localStorage` `bemesh.account.seen`) and when the page comes back into view. It is a hint for the page; a tool that needs the person signs in through `/auth/authorize`. Hidden tools get no answer (they are not among the hub's origins). |

| From the channel | Hub does |
| --- | --- |
| every `bemesh.device` message | passes it to the tool's page |

The device message rules (`src/shared/device-message.js`): `tool` 1–40 characters, `transport`
`usb`/`ble`/`bridge`/null, `role` `repeater`/`room`/`sensor`/`companion`/null, USB ids 0–65535
or null, `name` and `publicKey` up to 64 characters or null.

### Partner tools

A partner is another project's tool that works with the map (contract: `docs/PARTNERS.md`). It is
a `SITE_TOOLS_JSON` entry with `"partner": true` (and `"hidden": true`), plus its secret in
`SITE_TOOL_SECRETS_JSON`:

```
SITE_TOOLS_JSON=[..., {"key":"analyzer","label":"ON8AR analyzer","url":"https://analyzer.example/","partner":true,"hidden":true}]
SITE_TOOL_SECRETS_JSON={"nodebook":"...", "analyzer":"<32+ characters, given to the partner>"}
```

- A partner is always hidden: no bar, menu, popup link, page security policy entry or device hub.
- It knows each person by a pairwise subject: an HMAC of the person
  and the partner under `PARTNER_SUBJECT_SECRET` (or a key made once in `data/.partner_subject_key`).
  Keep that key: a new one changes every subject, and partners lose the link to their accounts.
- `GET /api/v1/partner/claims` with `Authorization: Bearer <partner secret>`: who owns or manages
  which node, for people who share their nodes with partner tools (on by default, switched off on
  `/account`); `displayName` and `discordUrl` (a link to the person's Discord profile) are null
  when the person hides their name. Server to server only (an
  `Origin` header or a cookie gets 400); a wrong secret, or one of our own tools' secrets, gets 401.
  It answers `If-None-Match` with 304; partners poll at most every 5 minutes.
- Sign in with #BEmesh: a partner uses the protocol of "Signing in through the map", with three
  differences. Before its first code for a person, the map shows a consent page on its own address
  ("<label> asks for: your display name, and the nodes you share with partner tools", Cancel or
  Allow), once per person and partner; Cancel returns `?error=access_denied`, and `prompt=none`
  without consent returns `?error=consent_required`. `/auth/token` and `/auth/alive` answer with
  `"user": {"subject", "displayName", "isMember"}` only (`displayName` null when the person hides
  their name). The person withdraws a partner under "Partner tools you allowed" on `/account`;
  from then on its handles are not alive and its codes are refused.

### The language, shared by the tools

Every tool picks its language the same way:

1. `?lang=` in the address, for that page only (never saved);
2. the cookie `bemesh_lang`;
3. the first of the browser's languages the tool has (`nl-BE` counts as `nl`);
4. English.

The cookie:

- holds only a code: `en`, `nl` or `fr`. A tool ignores a code it doesn't have.
- is written only when a person picks a language, never on a first visit.
- `Path=/`, `Max-Age=31536000`, `SameSite=Lax`, `Secure` on HTTPS, not HttpOnly (the tools read it in the page).
- Without it, the browser decides; a tool's "follow the browser" removes it.

The map sets it with `POST /api/v1/lang {"lang": "nl"}` from its own pages. With `LANG_COOKIE_DOMAIN` set (e.g.
`.radio-actief.be`) it goes on that domain, so every tool under it sees it; a host outside that
domain, or no setting, keeps it on its own host. Tools that share one host (different ports)
share it without a setting. The other tools use the same name, codes and domain in their own settings.

### Content-Security-Policy

Every page and the configurator get a Content-Security-Policy: scripts only from the site and the
few files they load from the CDN by exact version, no inline scripts and no `eval`; data requests to
the site and the listed tools; forms to the site and the listed tools (log out returns there). A
page on its own address (above) may also ask the map's origin and frame its device hub.
The map page's template is compiled ahead of time for this: after changing anything inside
`#app` in `index.html`, run `npm run build:map` (a test fails while `src/map-app.render.js` is
out of date). `CSP_ENABLED=false` turns the policy off, for local debugging only.

### Search engines

Search engines may read the four public pages; AI crawlers and agents may read nothing
(`backend/seo.py`).

- `/robots.txt`, per address: one group of AI crawlers and agents (`AI_BOTS`) with `Disallow: /`;
  then `User-agent: *` with `Disallow` for the API, signing in, the account and invitations, `/join`,
  `/visit`, the device hub, the data files and the old redirect-only names; and `Sitemap:` with that
  address's sitemap. Search engines (Googlebot, Bingbot and the others) fall under `*`.
- `/sitemap.xml`, per address: the pages whose public address is on that address (with addresses
  of their own, one page each; without, all four on their paths), each as the clean address
  (English, also `x-default`), `?lang=nl` and `?lang=fr`, with `xhtml:link` alternates. A host
  the tool list doesn't name (another name for the map) answers 301 to
  the map's sitemap, and its `robots.txt` names that one.
- The pages' heads, made by the server for the language served (the order of "The language" above,
  `?lang=`, cookie, browser): `<html lang>`, a title and description from the pages' own messages
  (`<page>.title` / `<page>.description`, `app.title` / `app.description` for the configurator),
  `keywords`, `canonical` (the page's public address: its own address when shown, else its path on
  the map's; it keeps a `?lang=nl|fr` and nothing else), `hreflang` en/nl/fr/x-default, Open Graph
  and Twitter tags with the share card `img/share/bemesh-card.png` (1200×630), and JSON-LD
  (Radio-Actief as `Organization`, the address as `WebSite`, then `Map`, `Dataset` or
  `WebApplication`). JSON-LD is data, not a script, so the page policy stays without inline scripts.
  These pages vary with `Cookie` and `Accept-Language`.
- Each public page shows a short "what this is" (`<page>.intro.heading` / `.intro.text`): on the map
  a glass caption beside the map controls that a person may close (kept closed on that device), at
  the end of the stats page and of the region map's side panel, and on the configurator's first step.
- The API, signing in, the account, invitations and the device hub answer with
  `X-Robots-Tag: noindex`; the account and sign-in pages also carry `<meta name="robots" content="noindex">`.
- The share card: edit `img/share/bemesh-card.svg`, then `node scripts/build-share-image.mjs`.
- Search Console (Google) and Webmaster Tools (Bing) need each address verified by its owner; then
  submit `https://<address>/sitemap.xml` there.

### Sync Service

- **Container**: `rry-map-bot-sync`
- **Command**: Runs sync every `SYNC_INTERVAL_MINUTES` (default 6 hours)
- **Restart**: `unless-stopped`
- **Initial Delay**: 60 seconds (allows API to start first)
- **Health Check**: `python3 backend/sync_health.py` (unhealthy when the last run is older than twice the interval)

The sync service:
- Downloads nodes from official MeshCore map
- Filters by Belgian geographic bounds
- Verifies with the local Belgian geocoder (Geopy only as an optional fallback). A node on the map that is outside Belgium for two runs in a row is removed; new or inactive nodes outside Belgium are never added
- Integrates changes into database, one run at a time (`data/sync.lock`)
- Holds back a mass removal (more than 25 nodes or 5 % of active nodes) and records it in `sync_history`; nodes missing for 3 runs in a row are removed once the feed is back to its normal size
- Exits 0 when done, 1 when the run failed, 2 when some nodes failed (listed in `sync_history.details.errors`)
- Writes `data/geocode_failures.log`: one line when a node's result changes plus one summary line per run, rotated at 5 MB (3 old files)

## Database Management

### Database Location

The database is stored in `./data/belgian_nodes.db` on the host, mounted to `/app/data/belgian_nodes.db` in containers.

### Backup Strategy

#### Automated Backups

A backup script is provided: `backup-db.sh`

This script:
- Creates timestamped database backups
- Compresses backups with gzip (saves space)
- Keeps only the last 30 days of backups
- Automatically cleans old backups

To set up automated backups, add to crontab (on host):
```bash
# Backup database daily at 2 AM
0 2 * * * /path/to/RRY-Map-Bot/backup-db.sh >> /path/to/RRY-Map-Bot/logs/backup.log 2>&1
```

**Note**: The backup script is not automatically scheduled. You need to configure cron manually or integrate it into your deployment system.

#### Manual Backup

```bash
# Stop services (optional, but safer)
docker-compose stop

# Copy database
cp ./data/belgian_nodes.db ./backups/belgian_nodes_$(date +%Y%m%d).db

# Restart services
docker-compose start
```

#### Restore from Backup

```bash
# Stop services
docker-compose stop

# Restore database
cp ./backups/belgian_nodes_YYYYMMDD.db ./data/belgian_nodes.db

# Restart services
docker-compose start
```

## Monitoring and Logs

### View Logs

```bash
# All services
docker-compose logs -f

# Specific service
docker-compose logs -f discord-bot
docker-compose logs -f api
docker-compose logs -f sync

# Last 100 lines
docker-compose logs --tail=100
```

### Health Checks

All services have health checks configured. Check status:

```bash
docker-compose ps
```

### Manual Health Check

```bash
# API health
curl http://localhost:8000/api/v1/health

# Check Discord bot (should be online in Discord)
# Check sync service (check logs for last sync time)
```

## Releases and deploys

The live site (meshmap.radio-actief.be) runs the latest release. A release is a `vX.Y.Z` tag on
`main`; pushing it deploys automatically.

**Branches.** Work happens on a branch off `dev`, which is merged into `dev` when it's done.
`main` only moves at a release and always holds what is live. Never commit to `main` directly.

**Versions.** `package.json` holds the one version number (`X.Y.Z`). Raise the last number for
fixes and small changes, the middle one for new features, the first one for a big overhaul.
Every page shows it under ☰, About, with that release's notes (`GET /api/v1/version`).

**Making a release**, on an up-to-date `dev` with nothing uncommitted:

```bash
npm run release:prepare -- patch      # or minor, major, or an exact X.Y.Z
# edit the new section at the top of CHANGELOG.md: it is what users read
npm run release:publish               # add -- --dry-run to see the steps first
```

`prepare` raises the version and drafts the notes from the commit titles since the last release
(New, Fixed, Other). Rewrite them for the people using the map; a commit title is often not that.
`publish` commits the release on `dev`, merges `dev` into `main`, tags `main` with the notes and
pushes `dev`, `main` and the tag. Run the browser checks
(`node scripts/check-tool-pages.mjs` against a running server, and `node scripts/check-hosts.mjs`,
which starts its own) before publishing; the pipeline doesn't run them.

**What the tag starts** (`.forgejo/workflows/release.yml`):

1. checks that the tag is on `main` and matches `package.json` and `CHANGELOG.md`;
2. runs the tests (web app, scripts, typecheck, build, server);
3. publishes the notes as a release page;
4. deploys (`scripts/komodo-deploy.mjs`): pins the deploy tool's repo to the tag's commit and its
   build to the version, then builds the image and deploys the stack. Before the stack restarts,
   `scripts/predeploy.py` backs up the database (`data/belgian_nodes_BU-pre-<version>-<time>.db`,
   the newest 5 kept) and copies the repo's `data/*.json` and `data/*.geojson` into the live data
   directory;
5. checks that the live site is healthy and serves the new version.

A failed step stops the release: nothing after it runs, and the live site stays as it was unless
the failure came during the deploy itself.

The workflow needs these repository secrets: `KOMODO_URL`, `KOMODO_API_KEY`, `KOMODO_API_SECRET`,
`KOMODO_REPO`, `KOMODO_BUILD`, `KOMODO_PROCEDURE` (where and what to deploy) and `PRIVATE_PATTERN`
(a pattern for details that must never be in the repository; the release fails if the tree or a
commit message matches it).

**Rolling back:** Actions → release → Run workflow, with the previous tag
(e.g. `v1.0.1`). It runs the same steps for that release. To restore the database as well, stop the
stack and copy the matching `belgian_nodes_BU-pre-*.db` back to `belgian_nodes.db`.

### Update Environment Variables

```bash
# Edit .env
nano .env

# Restart services to pick up changes
docker-compose restart
```

## Troubleshooting

### Discord Bot Not Connecting

1. Check token is correct in `.env`
2. Check bot has proper permissions in Discord
3. Check logs: `docker-compose logs discord-bot`

### API Not Accessible

1. Check port 8000 is not in use: `netstat -tuln | grep 8000`
2. Check firewall rules
3. Check logs: `docker-compose logs api`
4. Test health endpoint: `curl http://localhost:8000/api/v1/health`

### Sync Service Not Running

1. Check logs: `docker-compose logs sync`
2. Verify API service is running (sync depends on it)
3. Check database permissions
4. Manually run sync: `docker-compose exec sync python3 backend/sync_belgian_nodes.py`

### Database Issues

1. Check database file permissions: `ls -la ./data/`
2. Check disk space: `df -h`
3. Verify database integrity: `docker-compose exec api python3 -c "from backend.database import verify_schema; print(verify_schema())"`

## Production Considerations

### Security

1. **Never commit `.env`** - It contains sensitive tokens
2. **Use secrets management** - Consider Docker secrets or external secret managers
3. **Firewall** - Only expose port 8000 if needed, or use reverse proxy
4. **Database backups** - Implement automated backups (see above)

### Performance

1. **Database location** - Store database on fast storage (SSD)
2. **Resource limits** - Set appropriate CPU/memory limits in docker-compose
3. **Reverse proxy** - Use nginx/traefik for production web access
4. **Monitoring** - Set up monitoring for services (Prometheus, Grafana, etc.)

### Scaling

The current setup uses a single SQLite database, which is suitable for:
- Small to medium deployments
- Single server deployments
- Low to moderate write load

For larger deployments, consider:
- PostgreSQL instead of SQLite
- Separate read replicas
- Load balancing for API service

## Reverse Proxy Setup (Optional)

### Nginx Example

```nginx
server {
    listen 80;
    server_name meshmap.radio-actief.be;

    location / {
        proxy_pass http://localhost:8000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

### Traefik Example

Add to docker-compose.yml:

```yaml
api:
  # ... existing config ...
  labels:
    - "traefik.enable=true"
    - "traefik.http.routers.api.rule=Host(`meshmap.radio-actief.be`)"
    - "traefik.http.services.api.loadbalancer.server.port=8000"
```

## Maintenance

### Regular Tasks

1. **Monitor logs** - Check for errors daily
2. **Database backups** - Verify backups are running
3. **Update dependencies** - Review and update requirements.txt periodically
4. **Review sync logs** - Ensure sync is running successfully

### Database Maintenance

```bash
# Vacuum database (reclaim space)
docker-compose exec api python3 -c "
from backend.database import get_connection
conn = get_connection()
conn.execute('VACUUM')
conn.commit()
print('Database vacuumed')
"
```

## Support

For issues or questions:
1. Check logs first: `docker-compose logs`
2. Review this documentation
3. Check project documentation in `DOCUMENTATION_INDEX.md`
4. Open an issue on the repository

