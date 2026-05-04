# AGENTS.md

## Cursor Cloud specific instructions

### Project overview

RRY-Map-Bot is a Belgian MeshCore Node Mapping System with three services: a Flask REST API (serves web map + API on port 8000), a Discord bot, and a periodic sync service. All share an SQLite database at `data/belgian_nodes.db`. See `README.md` for full architecture.

### Running services

- **Flask API (web map + REST API):** `python3 backend/api/app.py` — serves on port 8000. This is the primary service for development/testing. No external dependencies required; it auto-initializes the SQLite database on startup.
- **Discord Bot:** `python3 -m backend.discord_bot` — requires valid `DISCORD_BOT_TOKEN` and `DISCORD_GUILD_ID` in `.env`. Will fail without real credentials.
- **Sync Service:** `python3 backend/sync_belgian_nodes.py` — pulls nodes from the official MeshCore map API. Optional for local development.

### Environment setup

- Copy `.env.example` to `.env` and create `data/` and `logs/` directories before starting any service.
- The database is auto-created by `init_database()` which runs on API startup. To initialize manually: `python3 -c "from backend.database import init_database; init_database()"`.

### Testing

- Run integration tests: `python3 tests/test_integration.py` — uses a custom test suite (not pytest). Tests use a separate `data/test_belgian_nodes.db` file automatically.
- The test database from integration tests shares the same `data/` directory as the main database. The test suite operates on `data/test_belgian_nodes.db` but the main app uses `data/belgian_nodes.db`.

### Gotchas

- Python `blinker` package is installed by the system as a Debian package without a RECORD file. If `pip install` fails on `blinker`, use `pip install --break-system-packages --ignore-installed blinker` first, then re-run `pip install --break-system-packages -r requirements.txt`.
- The project targets Python 3.11+ but works on Python 3.12 as well.
- Node.js (`npm install`) is only needed for the `parse_meshcore_link.mjs` utility script, not for the core Flask/map application.
- The Flask API serves static frontend files directly from the project root — no build step is needed for the frontend (Vue3/Leaflet are vendored in `lib/`).
- There is no dedicated linter configuration; code quality can be checked with `python3 -m py_compile` on individual files.
