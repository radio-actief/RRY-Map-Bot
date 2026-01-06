# Remote Machine Deployment Checklist

Follow these steps after cloning the repository to your remote machine.

## Prerequisites Check

```bash
# Check Docker is installed
docker --version
docker-compose --version

# Should show Docker 20.10+ and Docker Compose 2.0+
```

If Docker is not installed, install it first:
- **Ubuntu/Debian**: `sudo apt-get update && sudo apt-get install docker.io docker-compose`
- **Other systems**: See https://docs.docker.com/get-docker/

---

## Step 1: Navigate to Project Directory

```bash
cd RRY-Map-Bot
```

---

## Step 2: Create Environment Configuration File

Create a `.env` file with your configuration:

```bash
nano .env
```

Add the following (replace with your actual values):

```env
# Discord Bot Configuration (REQUIRED)
DISCORD_BOT_TOKEN=your_discord_bot_token_here
DISCORD_GUILD_ID=your_discord_guild_id_here

# Optional Discord Configuration
STARTUP_CHANNEL_ID=your_channel_id_here
STARTUP_MESSAGE_ID=your_message_id_here

# Database Configuration (use Docker path)
DATABASE_PATH=/app/data/belgian_nodes.db

# Sync Configuration (optional, defaults shown)
SYNC_INTERVAL_HOURS=6

# Geopy Configuration (optional, defaults shown)
GEOPY_USER_AGENT=belgian_meshcore_map
GEOPY_TIMEOUT=10

# API Configuration (optional, defaults shown)
OFFICIAL_API_URL=https://map.meshcore.dev/api/v1/nodes
LOCAL_API_URL=http://localhost:8000/api/v1
```

**Important**: 
- Replace `your_discord_bot_token_here` with your actual Discord bot token
- Replace `your_discord_guild_id_here` with your Discord server (guild) ID
- The `DATABASE_PATH` should remain as `/app/data/belgian_nodes.db` for Docker

Save and exit (Ctrl+X, then Y, then Enter in nano).

---

## Step 3: Create Required Directories

```bash
mkdir -p data logs
```

These directories will store:
- `data/` - SQLite database file
- `logs/` - Application logs

---

## Step 4: Set Proper Permissions

```bash
# Ensure directories are writable
chmod 755 data logs

# If you need to run without sudo, add your user to docker group:
# sudo usermod -aG docker $USER
# Then log out and back in
```

---

## Step 5: Build and Start Services

```bash
# Build Docker images and start all services
docker-compose up -d --build
```

This will:
- Build the Docker image
- Start 3 services: Discord bot, API server, and Sync service
- Run them in the background (`-d` flag)

---

## Step 6: Verify Services Are Running

```bash
# Check service status
docker-compose ps
```

You should see all 3 services with status "Up":
- `rry-map-bot-discord`
- `rry-map-bot-api`
- `rry-map-bot-sync`

---

## Step 7: Check Logs

```bash
# View all logs
docker-compose logs -f

# Or view specific service logs
docker-compose logs -f discord-bot
docker-compose logs -f api
docker-compose logs -f sync
```

**What to look for:**
- **Discord Bot**: Should show "Bot is ready!" and "Connected to Discord"
- **API**: Should show "Running on http://0.0.0.0:8000"
- **Sync**: Should show "Starting Belgian Nodes Sync" (after 60 second delay)

Press `Ctrl+C` to exit log view.

---

## Step 8: Test API Health

```bash
# Test API health endpoint
curl http://localhost:8000/api/v1/health
```

Should return: `{"status": "healthy"}`

---

## Step 9: Test Web Map

If the machine has a web browser or you have SSH port forwarding:

```bash
# From your local machine, create SSH tunnel:
# ssh -L 8000:localhost:8000 user@remote-machine

# Then open in browser:
# http://localhost:8000
```

Or if accessing directly on the remote machine:
```bash
# Open in browser:
# http://localhost:8000
# or
# http://<remote-machine-ip>:8000
```

---

## Step 10: Verify Discord Bot

1. Go to your Discord server
2. Check that the bot is online (green status)
3. Try a command: `/stats`
4. The bot should respond with statistics

---

## Step 11: Initial Data Sync (Optional)

The sync service will run automatically every 6 hours. To run it manually first:

```bash
# Run sync manually
docker-compose exec sync python3 backend/sync_belgian_nodes.py
```

This will:
- Download nodes from official MeshCore map
- Filter Belgian nodes
- Verify with Geopy
- Populate the database

---

## Troubleshooting

### Services Won't Start

```bash
# Check for errors
docker-compose logs

# Restart services
docker-compose restart

# Rebuild from scratch
docker-compose down
docker-compose up -d --build
```

### Discord Bot Not Connecting

1. Verify token in `.env` file
2. Check bot has proper permissions in Discord
3. Check logs: `docker-compose logs discord-bot`

### API Not Accessible

1. Check port 8000 is available: `netstat -tuln | grep 8000`
2. Check firewall: `sudo ufw status`
3. Check logs: `docker-compose logs api`

### Database Issues

```bash
# Check database file exists
ls -la data/belgian_nodes.db

# Check database permissions
ls -la data/

# Verify database integrity
docker-compose exec api python3 -c "from backend.database import verify_schema; print(verify_schema())"
```

---

## Next Steps After Deployment

1. **Set up automated backups** (see `DEPLOYMENT.md` section on Database Management)
2. **Configure reverse proxy** if exposing to internet (nginx/traefik)
3. **Set up monitoring** for services
4. **Review sync logs** after first sync completes

---

## Useful Commands

```bash
# Stop all services
docker-compose stop

# Start all services
docker-compose start

# Restart all services
docker-compose restart

# View logs (last 100 lines)
docker-compose logs --tail=100

# View logs for specific service
docker-compose logs discord-bot
docker-compose logs api
docker-compose logs sync

# Stop and remove containers
docker-compose down

# Update code and restart
git pull
docker-compose up -d --build
```

---

## Security Notes

1. **Never commit `.env` file** - It contains sensitive tokens
2. **Use firewall** - Only expose port 8000 if needed
3. **Regular backups** - Set up automated database backups
4. **Keep updated** - Regularly update dependencies and Docker images

---

## Support

If you encounter issues:
1. Check logs first: `docker-compose logs`
2. Review `DEPLOYMENT.md` for detailed troubleshooting
3. Check `DOCUMENTATION_INDEX.md` for more documentation

