# Production Deployment Guide

This guide covers deploying RRY-Map-Bot in production using Traefik as a reverse proxy.

## Overview

The production setup uses:
- **Traefik** as reverse proxy and SSL termination
- **Cloudflare** for DNS and additional security
- **docker-compose.prod.yml** for production configuration
- External `traefik_network` for service communication

## Prerequisites

1. Traefik running and configured with:
   - `web` entrypoint (HTTP, port 80)
   - `websecure` entrypoint (HTTPS, port 443)
   - `letsencrypt` certificate resolver
   - `traefik_network` network created

2. Cloudflare DNS configured:
   - `map.axistem.eu` → Your server IP
   - Proxy enabled (orange cloud) for Cloudflare protection

3. Docker and Docker Compose installed

## Directory Structure

This setup uses separate directories for code and runtime:

- **Repository**: `/opt/repos/RRY-Map-Bot/` - Source code, build Docker images here
- **Stack**: `/opt/stacks/RRY-Map-Bot/` - Runtime files (compose, env, data, logs)

See `STACK_SETUP.md` for detailed setup instructions.

## Setup Steps

### 1. Set Up Stack Directory

```bash
# Create stack directory
sudo mkdir -p /opt/stacks/RRY-Map-Bot
sudo chown $USER:$USER /opt/stacks/RRY-Map-Bot
cd /opt/stacks/RRY-Map-Bot

# Copy configuration files from repository
cp /opt/repos/RRY-Map-Bot/docker-compose.prod.yml .
cp /opt/repos/RRY-Map-Bot/rry-map-bot.env.example rry-map-bot.env

# Create data and logs directories
mkdir -p data logs
```

### 2. Configure Environment Variables

Create `.env` file in stack directory:

```bash
cd /opt/stacks/RRY-Map-Bot
nano .env
```

Required variables:
```env
DISCORD_BOT_TOKEN=your_production_token
DISCORD_GUILD_ID=your_guild_id
DATABASE_PATH=/app/data/belgian_nodes.db
# ... other variables
```

### 3. Build Docker Image (from repository)

```bash
cd /opt/repos/RRY-Map-Bot
docker-compose -f docker-compose.yml build
# Tag the image
docker tag <image-id> rry-map-bot_build:latest
```

### 4. Ensure Traefik Network Exists

```bash
# Check if traefik_network exists
docker network ls | grep traefik_network

# If it doesn't exist, create it (usually Traefik creates it)
docker network create traefik_network
```

### 5. Start Services (from stack directory)

```bash
cd /opt/stacks/RRY-Map-Bot
docker-compose -f docker-compose.prod.yml up -d
```

### 6. Verify Deployment

```bash
cd /opt/stacks/RRY-Map-Bot

# Check services are running
docker-compose -f docker-compose.prod.yml ps

# Check logs
docker-compose -f docker-compose.prod.yml logs -f

# Test API health (from within the network)
docker-compose -f docker-compose.prod.yml exec api curl http://localhost:8000/api/v1/health
```

## Traefik Configuration Details

### Labels Explained

The API service has Traefik labels configured:

```yaml
labels:
  # Enable Traefik for this service
  - "traefik.enable=true"
  
  # HTTPS Router (main entry point)
  - "traefik.http.routers.meshcore-map.rule=Host(`map.axistem.eu`)"
  - "traefik.http.routers.meshcore-map.entrypoints=websecure"
  - "traefik.http.routers.meshcore-map.tls.certresolver=letsencrypt"
  - "traefik.http.services.meshcore-map.loadbalancer.server.port=8000"
  
  # HTTP to HTTPS Redirect
  - "traefik.http.routers.meshcore-map-http.rule=Host(`map.axistem.eu`)"
  - "traefik.http.routers.meshcore-map-http.entrypoints=web"
  - "traefik.http.routers.meshcore-map-http.middlewares=meshcore-map-redirect"
  - "traefik.http.middlewares.meshcore-map-redirect.redirectscheme.scheme=https"
  - "traefik.http.middlewares.meshcore-map-redirect.redirectscheme.permanent=true"
```

### What This Does

1. **HTTPS Router**: Routes `https://map.axistem.eu` to the API service on port 8000
2. **SSL Certificate**: Automatically obtains and renews Let's Encrypt certificate
3. **HTTP Redirect**: Redirects all HTTP traffic to HTTPS (301 permanent redirect)
4. **Cloudflare Integration**: Works seamlessly with Cloudflare's proxy

### Port Configuration

- **Internal**: API runs on port 8000 inside the container
- **External**: Traefik handles port 80/443, routes to container port 8000
- **No direct exposure**: Port 8000 is NOT exposed to host (only accessible via Traefik)

## Network Architecture

```
Internet
  ↓
Cloudflare (DNS + Proxy)
  ↓
Traefik (Port 80/443, SSL termination)
  ↓
traefik_network (Docker network)
  ↓
rry-map-bot-api (Port 8000)
```

## Differences from Development

| Feature | Development | Production |
|---------|------------|------------|
| Compose File | `docker-compose.yml` | `docker-compose.prod.yml` |
| Network | `rry-map-bot-network` (local) | `traefik_network` (external) |
| Port Exposure | Direct port 8000 | Via Traefik only |
| SSL/TLS | None | Let's Encrypt via Traefik |
| HTTP Redirect | None | Automatic HTTPS redirect |
| Domain | localhost | map.axistem.eu |

## Updating Services

```bash
# Pull latest code (from repository)
cd /opt/repos/RRY-Map-Bot
git pull

# Rebuild image
docker-compose -f docker-compose.yml build
docker tag <new-image-id> rry-map-bot_build:latest

# Restart services (from stack directory)
cd /opt/stacks/RRY-Map-Bot
docker-compose -f docker-compose.prod.yml restart

# Or restart specific service
docker-compose -f docker-compose.prod.yml restart api
```

## Monitoring

### Check Service Status

```bash
# All services
docker-compose -f docker-compose.prod.yml ps

# Specific service logs
docker-compose -f docker-compose.prod.yml logs -f api
docker-compose -f docker-compose.prod.yml logs -f discord-bot
docker-compose -f docker-compose.prod.yml logs -f sync
```

### Check Traefik Routing

```bash
# View Traefik dashboard (if enabled)
# Usually at http://traefik.yourdomain.com

# Check if service is registered in Traefik
docker logs traefik | grep meshcore-map
```

### Test Endpoints

```bash
# From host machine
curl -I https://map.axistem.eu/api/v1/health

# Should return 200 OK with HTTPS
```

## Troubleshooting

### Service Not Accessible

1. **Check Traefik network**:
   ```bash
   docker network inspect traefik_network
   ```
   Verify `rry-map-bot-api` is in the network.

2. **Check Traefik logs**:
   ```bash
   docker logs traefik | grep meshcore-map
   ```

3. **Verify labels**:
   ```bash
   docker inspect rry-map-bot-api | grep -A 20 Labels
   ```

### SSL Certificate Issues

1. **Check Let's Encrypt resolver** in Traefik config
2. **Verify DNS** points to your server
3. **Check Cloudflare** proxy status (should be enabled)
4. **Review Traefik logs** for certificate errors

### Service Not Starting

1. **Check logs**:
   ```bash
   docker-compose -f docker-compose.prod.yml logs api
   ```

2. **Verify .env file** exists and has correct values

3. **Check database permissions**:
   ```bash
   ls -la data/
   ```

## Security Considerations

1. **.env file**: Never commit to git (already in .gitignore)
2. **Database**: Stored in `./data/` volume, ensure proper permissions
3. **Logs**: Stored in `./logs/` volume, rotate regularly
4. **Cloudflare**: Provides DDoS protection and additional security layers
5. **Traefik**: Handles SSL/TLS termination and routing

## Backup Strategy

See `DEPLOYMENT.md` for database backup procedures. Same backup strategy applies to production.

## Rollback

If you need to rollback:

```bash
# Stop services
docker-compose -f docker-compose.prod.yml down

# Checkout previous version
git checkout <previous-commit>

# Rebuild and start
docker-compose -f docker-compose.prod.yml up -d --build
```

