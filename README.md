# RRY-Map-Bot: Belgian MeshCore Node Mapping System

A comprehensive system for managing and visualizing Belgian MeshCore network nodes, combining a Discord bot and interactive web map.

**Target Domain**: `meshmap.radio-actief.be`

---

## Features

### 🌐 Web Map
- Interactive map showing all Belgian MeshCore nodes
- Filter by city, node type, and date ranges
- Search by name, public key, city, or Discord owner
- Real-time statistics (active devices in 24h/7d/30d)
- Clickable Discord owner links
- Copy-to-clipboard for public keys and links
- Relative time display for dates
- Direct links to MeshCore Analyzer

### 🤖 Discord Bot
The bot allows searching nodes, listing your own nodes, claiming/unclaiming nodes, updating only city, and viewing statistics:
- **`/search`** - Search by name, public key, type, city, frequency preset, owner, claim status, inactive, or source. At least one criterion required. Source filter: App or Uploader.
- **`/mynodes`** - List all your claimed nodes (including inactive ones)
- **`/node claim`** - Claim ownership of an unclaimed node
- **`/node unclaim`** - Remove ownership claim from a node
- **`/node update`** - Update the **city** of an owned node
- **`/stats`** - View Belgian MeshCore statistics: overview (nodes, types, presets, top cities, activity), all cities with counts, frequency stats by type, and source breakdown

### 🔄 Data Synchronization
- Automatic sync from official MeshCore map (`https://map.meshcore.io/api/v1/nodes`)
- Filters nodes by Belgian geographic bounds
- Verifies with the local Belgian geocoder (Shapely + StatBel GeoJSON); Geopy is
  an optional fallback (`USE_GEOPY_FALLBACK=1`)
- Extracts canonical city names from `be-locode.json`
- Tracks added, removed, updated, and restored nodes in `node_changes`
- Preserves Discord ownership and edits
- Sync runs every `SYNC_INTERVAL_MINUTES` and no longer posts to Discord per run
- A separate daily digest job (running inside the `discord-bot` container)
  posts one aggregated message per day at `DAILY_DIGEST_HOUR:MINUTE` local time

---

## Architecture

```
┌─────────────────────────────────────┐
│   Official MeshCore Map API         │
│   (map.meshcore.io/api/v1/nodes)    │
└──────────────┬──────────────────────┘
               │
               │ Periodic Sync
               │
┌──────────────▼───────────────────────┐
│   Sync Service                       │
│   (Filters & Verifies Belgian Nodes) │
└──────────────┬───────────────────────┘
               │
               │ SQLite Database
               │ (Single Source of Truth)
               │
    ┌──────────┴──────────┐
    │                     │
┌───▼──────┐      ┌───────▼──────┐
│ Web Map  │      │ Discord Bot  │
│ (Flask)  │      │ (discord.py) │
│          │      │              │
│ REST API │      │ Direct DB    │
└──────────┘      └──────────────┘
```

---

## Quick Start

### Prerequisites
- Python 3.11+
- Docker & Docker Compose (for deployment)
- Discord Bot Token
- Discord Guild ID

### Local Development

1. **Clone the repository**
   ```bash
   git clone <repository-url>
   cd RRY-Map-Bot
   ```

2. **Set up environment variables**
   ```bash
   cp rry-map-bot.env.example .env
   # Edit .env with your Discord bot token and other settings
   ```

3. **Install dependencies**
   ```bash
   pip install -r requirements.txt
   ```

4. **Initialize database**
   ```bash
   python3 -c "from backend.database import init_database; init_database()"
   ```

5. **Run sync service** (one-time or scheduled)
   ```bash
   python3 backend/sync_belgian_nodes.py
   ```

6. **Start Discord bot**
   ```bash
   python3 -m backend.discord_bot
   ```

7. **Start API server** (serves web map + REST API)
   ```bash
   python3 backend/api/app.py
   ```

### Docker Deployment

See `DEPLOYMENT.md` for detailed deployment instructions.

```bash
docker-compose up -d
```

---

## Configuration

### Environment Variables

See `rry-map-bot.env.example` for all available options:

- `DISCORD_BOT_TOKEN` - Discord bot token (required)
- `DISCORD_GUILD_ID` - Discord server ID (optional, for guild-specific commands)
- `STARTUP_CHANNEL_ID` - Channel for bot instructions and (fallback) daily digest posts
- `STARTUP_MESSAGE_ID` - Message ID to update with bot instructions
- `DATABASE_PATH` - Path to SQLite database (default: `data/belgian_nodes.db`)
- `SYNC_INTERVAL_MINUTES` - Minutes between sync runs (preferred; default: 360)
- `SYNC_INTERVAL_HOURS` - Legacy, still supported if `SYNC_INTERVAL_MINUTES` is unset
- `DAILY_DIGEST_ENABLED` - `1` to enable the once-per-day Discord digest job (default: `1`)
- `DAILY_DIGEST_HOUR` / `DAILY_DIGEST_MINUTE` - Local time when the digest is posted (default: `9:00`)
- `DAILY_DIGEST_TZ` - IANA time zone for the digest schedule (default: `Europe/Brussels`)
- `DAILY_DIGEST_CHANNEL_ID` - Optional override; defaults to `STARTUP_CHANNEL_ID`
- `BE_MUNICIPALITIES_GEOJSON` - Path to the local geocoder GeoJSON (default: `data/be-municipalities.geojson`)
- `GEOCODE_BUFFER_METERS` - Nearest-gemeente fallback buffer in metres (default: `0` = strict PIP)
- `USE_GEOPY_FALLBACK` - `1` to force the Geopy path instead of the local geocoder
- `GEOPY_USER_AGENT` - User agent for Geopy requests (fallback only)
- `OFFICIAL_MAP_API_URL` - Official map API URL

---

## Project Structure

```
RRY-Map-Bot/
├── backend/
│   ├── api/
│   │   └── app.py              # Flask REST API + web map server
│   ├── database.py             # Database utilities and schema
│   ├── discord_bot.py          # Discord bot implementation
│   ├── discord_queries.py     # Database query functions for Discord bot
│   └── sync_belgian_nodes.py  # Sync service from official map
├── config/
│   └── config.py               # Configuration and constants
├── src/
│   └── map.js                  # Web map frontend (Vue3 + Leaflet)
├── css/
│   └── style.css              # Web map styles
├── index.html                  # Web map HTML
├── docker-compose.yml          # Docker Compose configuration
├── Dockerfile                  # Docker image definition
└── requirements.txt            # Python dependencies
```

---

## Documentation

- **`PROJECT_SUMMARY.md`** - Complete project specification and features
- **`DEPLOYMENT.md`** - Deployment guide and Docker setup
- **`DISCORDBOT_INSTRUCTIONS.md`** - Discord bot command reference
- **`DOCUMENTATION_INDEX.md`** - Complete documentation index

---

## Technologies

### Backend
- **Python 3.11+**
- **discord.py** - Discord bot framework
- **Flask** - REST API and web server
- **SQLite** - Database
- **Geopy** - Geographic verification
- **requests** - HTTP client

### Frontend
- **Vue 3** - JavaScript framework
- **Leaflet** - Interactive maps
- **Leaflet.markercluster** - Node clustering
- **Beer.css** - UI framework
- **Material Icons** - Icons

---

## License

See `LICENSE` file for details.

---

## Contributing

This is a private project. For questions or issues, contact the project administrators.

---

*Last Updated: 2026-01-04*
