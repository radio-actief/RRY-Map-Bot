# Build Docker Images Only (Without Running)

This guide shows how to build the Docker images on the remote machine without starting the containers.

## Quick Build Command

```bash
cd RRY-Map-Bot
docker-compose build
```

This will build all three services (discord-bot, api, sync) using the same Dockerfile.

## Build Specific Service

If you only want to build a specific service:

```bash
# Build only the API service
docker-compose build api

# Build only the Discord bot service
docker-compose build discord-bot

# Build only the sync service
docker-compose build sync
```

## Build with No Cache

To force a complete rebuild without using cached layers:

```bash
docker-compose build --no-cache
```

This is useful if you've made changes to the Dockerfile or want to ensure a fresh build.

## Verify Build

After building, you can verify the images were created:

```bash
# List all Docker images
docker images | grep rry-map-bot

# Or check specific image
docker images rry-map-bot-api
```

You should see images named something like:
- `rry-map-bot-discord-bot`
- `rry-map-bot-api`
- `rry-map-bot-sync`

## Build Output

The build process will:
1. Pull the base Python 3.11-slim image (if not already cached)
2. Install system dependencies (gcc)
3. Copy requirements.txt and install Python dependencies
4. Copy all application code
5. Create the /app/data directory
6. Set environment variables

## Next Steps

After building, you can:
- Start services: `docker-compose up -d`
- View build logs: `docker-compose build --progress=plain`
- Test a service manually: `docker run --rm -it <image-name> /bin/bash`

## Troubleshooting

### Build Fails with "Cannot find Dockerfile"
- Make sure you're in the RRY-Map-Bot directory
- Verify Dockerfile exists: `ls -la Dockerfile`

### Build Fails with Permission Denied
- Ensure Docker is running: `sudo systemctl status docker`
- Add user to docker group: `sudo usermod -aG docker $USER` (then log out/in)

### Build Takes Too Long
- First build downloads base images and installs dependencies
- Subsequent builds use cache and are much faster
- Use `docker-compose build --parallel` to build services in parallel

### Out of Disk Space
- Clean up unused images: `docker system prune -a`
- Remove old build cache: `docker builder prune`

