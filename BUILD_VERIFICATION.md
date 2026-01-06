# Docker Build Verification

## What Gets Built

When you run `docker-compose build`, Docker Compose will:

1. **Build ONE image** from the Dockerfile
2. **Tag it three times** with these names:
   - `rry-map-bot-discord-bot` (or similar)
   - `rry-map-bot-api` (or similar)  
   - `rry-map-bot-sync` (or similar)

All three services use the same image because they all specify `build: .` with the same Dockerfile.

## What's Included in the Image

### ✅ Included (Needed for Runtime)
- `backend/` - All Python backend code
- `api/` - API endpoints and example data
- `config/` - Configuration files
- `src/` - Frontend JavaScript (map.js)
- `css/` - Stylesheets
- `index.html` - Web map HTML
- `lib/` - Third-party libraries (Vue, Leaflet, etc.)
- `favicon.ico` - Favicon
- `requirements.txt` - Python dependencies (installed during build)
- `package.json` - Node.js metadata (if needed)
- `README.md` - Documentation
- `DISCORDBOT_INSTRUCTIONS.md` - Documentation

### ❌ Excluded (Not Needed or Mounted as Volumes)
- `.env` - Environment variables (mounted via `env_file`)
- `*.db` - Database files (mounted as volume: `./data:/app/data`)
- `logs/` - Log files (mounted as volume: `./logs:/app/logs`)
- `venv/` - Python virtual environment (not needed in container)
- `__pycache__/` - Python cache (not needed)
- `node_modules/` - Node modules (not needed for Python app)
- `tests/` - Test files (not needed in production)
- Most `*.md` files - Documentation (not needed at runtime)
- `.git/` - Git repository (not needed)

## Verify What's Included

After building, you can inspect the image:

```bash
# Check image size
docker images | grep rry-map-bot

# Inspect what's in the image
docker run --rm -it rry-map-bot-api ls -la /app

# Check if specific files exist
docker run --rm rry-map-bot-api test -f /app/backend/discord_bot.py && echo "✅ discord_bot.py exists"
docker run --rm rry-map-bot-api test -f /app/src/map.js && echo "✅ map.js exists"
docker run --rm rry-map-bot-api test -f /app/lib/vue.esm-browser.min.js && echo "✅ Vue.js exists"
docker run --rm rry-map-bot-api test -f /app/index.html && echo "✅ index.html exists"
```

## Important Notes

1. **Same Image, Different Commands**: All three services use the same image but run different commands:
   - `discord-bot`: `python3 backend/discord_bot.py`
   - `api`: `python3 backend/api/app.py`
   - `sync`: Runs sync script in a loop

2. **Volumes Mounted at Runtime**: These are NOT in the image but mounted when containers start:
   - `./data:/app/data` - Database storage
   - `./logs:/app/logs` - Log files
   - `.env` file - Environment variables

3. **Build Efficiency**: Since all services use the same image, Docker only builds once and reuses it for all three services.

## If Something is Missing

If you find that a file is missing from the image:

1. Check if it's in `.dockerignore` - if so, remove it or add an exception
2. Verify the file exists in the source directory
3. Rebuild with `--no-cache` to ensure a fresh build:
   ```bash
   docker-compose build --no-cache
   ```

