# Stack Directory Setup Guide

This guide explains how to set up the production stack directory separate from the repository.

## Directory Structure

```
/opt/repos/RRY-Map-Bot/     # Repository (code, source files)
├── backend/
├── docker-compose.prod.yml  # Template (copy to stack)
├── rry-map-bot.env.example  # Template (copy to stack)
└── ...

/opt/stacks/RRY-Map-Bot/    # Stack directory (runtime files)
├── docker-compose.prod.yml # Production compose file
├── .env                     # Application environment variables
├── rry-map-bot.env          # Volume path configuration
├── data/                    # Database directory
│   └── belgian_nodes.db
└── logs/                    # Log files directory
```

## Setup Steps

### 1. Create Stack Directory

```bash
sudo mkdir -p /opt/stacks/RRY-Map-Bot
sudo chown $USER:$USER /opt/stacks/RRY-Map-Bot
cd /opt/stacks/RRY-Map-Bot
```

### 2. Copy Configuration Files from Repository

```bash
# Copy docker-compose file
cp /opt/repos/RRY-Map-Bot/docker-compose.prod.yml .

# Copy and configure environment file
cp /opt/repos/RRY-Map-Bot/rry-map-bot.env.example rry-map-bot.env
```

### 3. Create Required Directories

```bash
mkdir -p data logs
chmod 755 data logs
```

### 4. Configure Environment Files

#### Create `.env` file (application configuration)

```bash
nano .env
```

Add your application configuration:
```env
# Discord Bot Configuration
DISCORD_BOT_TOKEN=your_discord_bot_token
DISCORD_GUILD_ID=your_guild_id
STARTUP_CHANNEL_ID=your_channel_id
STARTUP_MESSAGE_ID=your_message_id

# Database Configuration (path inside container)
DATABASE_PATH=/app/data/belgian_nodes.db

# Sync Configuration
SYNC_INTERVAL_HOURS=6

# Geopy Configuration
GEOPY_USER_AGENT=belgian_meshcore_map
GEOPY_TIMEOUT=10

# API Configuration
OFFICIAL_API_URL=https://map.meshcore.dev/api/v1/nodes
LOCAL_API_URL=http://localhost:8000/api/v1
```

#### Verify `rry-map-bot.env` (volume paths)

The file should already have correct paths:
```env
DATA_DIR=/opt/stacks/RRY-Map-Bot/data
LOGS_DIR=/opt/stacks/RRY-Map-Bot/logs
```

### 5. Build Docker Image (from repository)

```bash
cd /opt/repos/RRY-Map-Bot
docker-compose -f docker-compose.yml build
# Or tag existing image:
docker tag <existing-image> rry-map-bot_build:latest
```

### 6. Start Services (from stack directory)

```bash
cd /opt/stacks/RRY-Map-Bot
docker-compose -f docker-compose.prod.yml up -d
```

## File Locations Summary

| File | Location | Purpose |
|------|----------|---------|
| `docker-compose.prod.yml` | `/opt/stacks/RRY-Map-Bot/` | Production compose file |
| `.env` | `/opt/stacks/RRY-Map-Bot/` | Application config (secrets) |
| `rry-map-bot.env` | `/opt/stacks/RRY-Map-Bot/` | Volume paths |
| `data/` | `/opt/stacks/RRY-Map-Bot/data/` | Database directory |
| `logs/` | `/opt/stacks/RRY-Map-Bot/logs/` | Log files |
| Source code | `/opt/repos/RRY-Map-Bot/` | Repository (for building) |

## Updating the Stack

### Update Code

1. **Pull latest code**:
   ```bash
   cd /opt/repos/RRY-Map-Bot
   git pull
   ```

2. **Rebuild image**:
   ```bash
   docker-compose -f docker-compose.yml build
   docker tag <new-image> rry-map-bot_build:latest
   ```

3. **Restart services** (from stack directory):
   ```bash
   cd /opt/stacks/RRY-Map-Bot
   docker-compose -f docker-compose.prod.yml restart
   ```

### Update Configuration

1. **Update `.env`** (if needed):
   ```bash
   cd /opt/stacks/RRY-Map-Bot
   nano .env
   docker-compose -f docker-compose.prod.yml restart
   ```

2. **Update `docker-compose.prod.yml`** (if repository version changed):
   ```bash
   cd /opt/stacks/RRY-Map-Bot
   cp /opt/repos/RRY-Map-Bot/docker-compose.prod.yml .
   # Review changes, then restart
   docker-compose -f docker-compose.prod.yml up -d
   ```

## Migration from Old Database

If you have an old database at `/opt/stacks/RRY-Map-Bot/meshcore-bot.db`:

### Option 1: Run Migration from Repository (Direct to Stack)

```bash
cd /opt/repos/RRY-Map-Bot

# Copy old database to migration location (if needed)
cp /opt/stacks/RRY-Map-Bot/meshcore-bot.db migration/legacy_meshcore_bot.db

# Run migration directly to stack directory
# The script will create the target database at the specified path
python3 backend/migrate_legacy_db.py \
  --target-db /opt/stacks/RRY-Map-Bot/data/belgian_nodes.db

# Or specify both paths explicitly
python3 backend/migrate_legacy_db.py \
  --legacy-db /opt/stacks/RRY-Map-Bot/meshcore-bot.db \
  --target-db /opt/stacks/RRY-Map-Bot/data/belgian_nodes.db
```

**Note**: The script will automatically create the target directory (`/opt/stacks/RRY-Map-Bot/data/`) if it doesn't exist.

### Option 2: Run Migration in Container

```bash
# From repository directory
cd /opt/repos/RRY-Map-Bot

# Copy old database
cp /opt/stacks/RRY-Map-Bot/meshcore-bot.db migration/legacy_meshcore_bot.db

# Run migration in container
docker run --rm -it \
  -v /opt/repos/RRY-Map-Bot:/app \
  -v /opt/stacks/RRY-Map-Bot/data:/app/data \
  rry-map-bot_build:latest \
  python3 backend/migrate_legacy_db.py
```

## Verification

```bash
# Check services are running
cd /opt/stacks/RRY-Map-Bot
docker-compose -f docker-compose.prod.yml ps

# Check database exists
ls -lh /opt/stacks/RRY-Map-Bot/data/belgian_nodes.db

# Check logs
docker-compose -f docker-compose.prod.yml logs -f api
```

## Backup Strategy

```bash
# Backup database
cp /opt/stacks/RRY-Map-Bot/data/belgian_nodes.db \
   /opt/stacks/RRY-Map-Bot/data/belgian_nodes.db.backup.$(date +%Y%m%d_%H%M%S)

# Or use the backup script (if copied to stack directory)
/opt/stacks/RRY-Map-Bot/backup-db.sh
```

## Troubleshooting

### Image Not Found

If you get "image rry-map-bot_build:latest not found":

```bash
# Check if image exists
docker images | grep rry-map-bot_build

# If not, build it from repository
cd /opt/repos/RRY-Map-Bot
docker-compose -f docker-compose.yml build
docker tag <image-id> rry-map-bot_build:latest
```

### Permission Issues

```bash
# Fix directory permissions
sudo chown -R $USER:$USER /opt/stacks/RRY-Map-Bot
chmod 755 /opt/stacks/RRY-Map-Bot/data
chmod 644 /opt/stacks/RRY-Map-Bot/data/*.db
```

### Environment Variables Not Loading

```bash
# Verify files exist
ls -la /opt/stacks/RRY-Map-Bot/.env
ls -la /opt/stacks/RRY-Map-Bot/rry-map-bot.env

# Check variable substitution
cd /opt/stacks/RRY-Map-Bot
docker-compose -f docker-compose.prod.yml config | grep -A 2 volumes
```

