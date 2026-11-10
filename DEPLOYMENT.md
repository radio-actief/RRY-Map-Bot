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
- Sync slash commands to your guild
- Update instructions post (if configured)
- Handle all Discord commands

### API Server Service

- **Container**: `rry-map-bot-api`
- **Command**: `python3 backend/api/app.py` (Waitress; Flask's own server only with
  `FLASK_DEBUG=true`)
- **Port**: `8000`, on the machine only; put a reverse proxy with HTTPS in front
- **Restart**: `unless-stopped`
- **Health Check**: HTTP check on `/api/v1/health`

Endpoints:
- `GET /api/v1/belgian-nodes` - Get all active Belgian nodes
- `GET /api/v1/stats` - Get statistics
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

```
SITE_TOOLS_JSON=[{"key":"map","label":"Map","url":"https://map.example/"},
  {"key":"nodebook","label":"NodeBook","url":"https://nodebook.example/"},
  {"key":"meshmate","label":"MeshMate","url":"https://app.example/"}]
```

Each tool on its own address keeps its own browser storage, so a fault in one tool can't read
another's or act as the signed-in person there. What that needs:

- Sign-in: `/auth/login?next=` and `/auth/logout?next=` return to a map page or to a listed `url`,
  exactly. Other tools log out through `GET /auth/signout?next=<their url>`: a page on the map's
  address with one button that posts to `/auth/logout`. `SESSION_COOKIE_DOMAIN` (e.g.
  `.example.org`) shares the sign-in cookie with the other addresses under that domain; unset, it
  stays on the map's host.
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
  per tool); the popup's NodeBook cookies need the same.

Device hub messages, all with `v: 1`. The tool's page posts them to the frame with
`postMessage(message, "<the map's origin>")`; the hub takes them only from its parent window and
only from a listed origin, and posts only to `window.parent`, with that origin as the target, once
it has had one valid message:

| From the tool | Hub does |
| --- | --- |
| `{kind: "bemesh.device", v: 1, type, tool, transport, role, usbVendorId, usbProductId, name, publicKey}`, `type` one of `who`, `held`, `release`, `released`, `busy` | passes it to the channel `bemesh-device`; a `held` one is also kept as the last device (as `setLast` would), so a tool needn't send `setLast` too |
| `{kind: "bemesh.device.getLast", v: 1}` | answers within 2 s `{kind: "bemesh.device.last", v: 1, last}`: the remembered device (`{transport, usbVendorId, usbProductId, role, name, publicKey, at}`), or `null` when none or older than 12 hours |
| `{kind: "bemesh.device.setLast", v: 1, last: {transport?, usbVendorId, usbProductId, role, name, publicKey}}` | remembers it, stamped with the current time (`transport` defaults to `usb`) |

| From the channel | Hub does |
| --- | --- |
| every `bemesh.device` message | passes it to the tool's page |

The device message rules (`src/shared/device-message.js`): `tool` 1–40 characters, `transport`
`usb`/`ble`/`bridge`/null, `role` `repeater`/`room`/`sensor`/`companion`/null, USB ids 0–65535
or null, `name` and `publicKey` up to 64 characters or null.

### Content-Security-Policy

Every page and the configurator get a Content-Security-Policy: scripts only from the site and the
few files they load from the CDN by exact version, no inline scripts and no `eval`; data requests to
the site and the listed tools; forms to the site and the listed tools (log out returns there).
The map page's template is compiled ahead of time for this: after changing anything inside
`#app` in `index.html`, run `npm run build:map` (a test fails while `src/map-app.render.js` is
out of date). `CSP_ENABLED=false` turns the policy off, for local debugging only.

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
(`node scripts/check-tool-pages.mjs`) before publishing; the pipeline doesn't run them.

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

