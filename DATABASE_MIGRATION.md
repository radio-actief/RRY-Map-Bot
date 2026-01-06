# Database Migration Guide

## Automatic Schema Initialization

**Good news**: You don't need to manually run database migration in the container!

The application automatically initializes the database schema when it starts:
- `init_database()` is called on startup in all services (API, Discord bot, sync)
- Uses `CREATE TABLE IF NOT EXISTS` - safe to run multiple times
- Creates tables and indexes if they don't exist
- Does NOT delete or modify existing data

## Database Paths

### Production Setup
- **Data directory**: `/opt/stacks/RRY-Map-Bot/data`
- **Database file**: `/opt/stacks/RRY-Map-Bot/data/belgian_nodes.db`
- **Logs directory**: `/opt/stacks/RRY-Map-Bot/logs`

### Legacy Database
- **Old database**: `/opt/stacks/RRY-Map-Bot/meshcore-bot.db`

## Migration Options

### Option 1: Fresh Start (Recommended if old DB is empty/not needed)

If the old database doesn't contain important data:

1. **Create the data directory**:
   ```bash
   mkdir -p /opt/stacks/RRY-Map-Bot/data
   mkdir -p /opt/stacks/RRY-Map-Bot/logs
   ```

2. **Start the containers** - The schema will be created automatically:
   ```bash
   docker-compose -f docker-compose.prod.yml up -d
   ```

3. **Run initial sync** to populate with data from official API:
   ```bash
   docker-compose -f docker-compose.prod.yml exec sync python3 backend/sync_belgian_nodes.py
   ```

### Option 2: Migrate from Legacy Database

If you need to migrate data from `meshcore-bot.db`:

#### Option 2a: Run Migration on Host (if Python 3.11+ available)

1. **Navigate to repository**:
   ```bash
   cd /opt/repos/RRY-Map-Bot
   ```

2. **Install dependencies** (if not already installed):
   ```bash
   pip install -r requirements.txt
   ```

3. **Run migration directly to stack directory**:
   ```bash
   python3 backend/migrate_legacy_db.py \
     --legacy-db /opt/stacks/RRY-Map-Bot/meshcore-bot.db \
     --target-db /opt/stacks/RRY-Map-Bot/data/belgian_nodes.db
   ```

   Or if you've copied the legacy DB to the migration directory:
   ```bash
   cp /opt/stacks/RRY-Map-Bot/meshcore-bot.db migration/legacy_meshcore_bot.db
   python3 backend/migrate_legacy_db.py \
     --target-db /opt/stacks/RRY-Map-Bot/data/belgian_nodes.db
   ```

4. **Verify migration**:
   ```bash
   ls -lh /opt/stacks/RRY-Map-Bot/data/belgian_nodes.db
   ```

**Note**: The script will automatically create the target directory if it doesn't exist.

#### Option 2b: Run Migration in Container (Temporary)

1. **Create data directory** (if it doesn't exist):
   ```bash
   mkdir -p /opt/stacks/RRY-Map-Bot/data
   ```

2. **Run a temporary container** to perform migration directly to stack directory:
   ```bash
   docker run --rm -it \
     -v /opt/repos/RRY-Map-Bot:/app \
     -v /opt/stacks/RRY-Map-Bot/data:/opt/stacks/RRY-Map-Bot/data \
     rry-map-bot_build:latest \
     python3 backend/migrate_legacy_db.py \
       --legacy-db /opt/stacks/RRY-Map-Bot/meshcore-bot.db \
       --target-db /opt/stacks/RRY-Map-Bot/data/belgian_nodes.db
   ```

   Or if legacy DB is in the repo's migration directory:
   ```bash
   cp /opt/stacks/RRY-Map-Bot/meshcore-bot.db /opt/repos/RRY-Map-Bot/migration/legacy_meshcore_bot.db
   
   docker run --rm -it \
     -v /opt/repos/RRY-Map-Bot:/app \
     -v /opt/stacks/RRY-Map-Bot/data:/opt/stacks/RRY-Map-Bot/data \
     rry-map-bot_build:latest \
     python3 backend/migrate_legacy_db.py \
       --target-db /opt/stacks/RRY-Map-Bot/data/belgian_nodes.db
   ```

3. **Verify migration**:
   ```bash
   ls -lh /opt/stacks/RRY-Map-Bot/data/belgian_nodes.db
   ```

#### Option 2c: Manual Database Copy (if schemas are compatible)

If the old database already has the correct schema:

1. **Create data directory**:
   ```bash
   mkdir -p /opt/stacks/RRY-Map-Bot/data
   ```

2. **Copy database**:
   ```bash
   cp /opt/stacks/RRY-Map-Bot/meshcore-bot.db /opt/stacks/RRY-Map-Bot/data/belgian_nodes.db
   ```

3. **Set permissions**:
   ```bash
   chmod 644 /opt/stacks/RRY-Map-Bot/data/belgian_nodes.db
   ```

4. **Start containers** - Schema will be verified/updated automatically:
   ```bash
   docker-compose -f docker-compose.prod.yml up -d
   ```

## Verification

After migration or fresh start, verify the database:

```bash
# Check database exists and has correct size
ls -lh /opt/stacks/RRY-Map-Bot/data/belgian_nodes.db

# Check database schema (from container)
docker-compose -f docker-compose.prod.yml exec api python3 -c "from backend.database import verify_schema; print('✅ Schema valid' if verify_schema() else '❌ Schema invalid')"

# Check node count (from container)
docker-compose -f docker-compose.prod.yml exec api python3 -c "from backend.database import get_connection; conn = get_connection(); print(f'Total nodes: {conn.execute(\"SELECT COUNT(*) FROM belgian_nodes\").fetchone()[0]}')"
```

## Important Notes

1. **Database Location**: The database path inside the container is `/app/data/belgian_nodes.db` (mapped from host `/opt/stacks/RRY-Map-Bot/data/belgian_nodes.db`)

2. **Environment Variable**: Make sure `.env` has:
   ```env
   DATABASE_PATH=/app/data/belgian_nodes.db
   ```
   This is the path **inside the container**, not on the host.

3. **Permissions**: Ensure the database file is readable/writable by the container:
   ```bash
   chmod 644 /opt/stacks/RRY-Map-Bot/data/belgian_nodes.db
   chown $(id -u):$(id -g) /opt/stacks/RRY-Map-Bot/data/belgian_nodes.db
   ```

4. **Backup**: Always backup before migration:
   ```bash
   cp /opt/stacks/RRY-Map-Bot/meshcore-bot.db /opt/stacks/RRY-Map-Bot/meshcore-bot.db.backup
   ```

## Troubleshooting

### Database not found
- Check `DATA_DIR` in `rry-map-bot.env` is correct
- Verify directory exists: `ls -la /opt/stacks/RRY-Map-Bot/data`
- Check container logs: `docker-compose -f docker-compose.prod.yml logs api`

### Permission denied
- Check file permissions: `ls -la /opt/stacks/RRY-Map-Bot/data/`
- Fix permissions: `chmod 755 /opt/stacks/RRY-Map-Bot/data`

### Schema errors
- The app will auto-create schema on first run
- If issues persist, check logs for specific error messages
- Verify database isn't corrupted: `sqlite3 /opt/stacks/RRY-Map-Bot/data/belgian_nodes.db "PRAGMA integrity_check;"`

