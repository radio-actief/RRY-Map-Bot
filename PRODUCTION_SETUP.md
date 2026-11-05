# Production Setup Checklist

## ✅ Completed Steps

1. ✅ Discord OAuth2 callback URL added to Discord Developer Portal: `https://meshmap.radio-actief.be/auth/callback`
2. ✅ OAuth2 implementation completed
3. ✅ Frontend authentication UI added

## 🔧 Required Configuration

### 1. Update `.env` file with production values:

```bash
# Discord OAuth2 Configuration
# Get these from https://discord.com/developers/applications
DISCORD_OAUTH2_CLIENT_ID=your_discord_oauth2_client_id
DISCORD_OAUTH2_CLIENT_SECRET=your_discord_oauth2_client_secret
DISCORD_OAUTH2_REDIRECT_URI=https://meshmap.radio-actief.be/auth/callback

# Flask Session Configuration (CRITICAL for production)
FLASK_SECRET_KEY=<generate-a-secure-key>  # See below
SESSION_COOKIE_SECURE=True  # Must be True for HTTPS
```

### 2. Generate Flask Secret Key

Run this command to generate a secure secret key:

```bash
python3 -c "import secrets; print(secrets.token_hex(32))"
```

Copy the output and set it as `FLASK_SECRET_KEY` in your `.env` file.

### 3. Install Dependencies

```bash
pip install -r requirements.txt
```

Or rebuild Docker containers:
```bash
docker-compose build
```

### 4. Restart Services

```bash
docker-compose restart api
```

Or if running directly:
```bash
# Stop the current process and restart
python3 backend/api/app.py
```

## 🧪 Testing

1. **Test Login Flow:**
   - Visit https://meshmap.radio-actief.be
   - Click "Login with Discord" in the top-right corner
   - You should be redirected to Discord for authorization
   - After authorizing, you should be redirected back to the map
   - Your username should appear in the top-right corner

2. **Test Node Claiming:**
   - Find an unclaimed node on the map
   - Click on the node marker
   - Click "Claim" in the popup
   - Confirm the action
   - The node should now show you as the owner

3. **Test Node Unclaiming:**
   - Click on a node you own
   - Click "Unclaim" in the popup
   - Confirm the action
   - The node should become unclaimed

## 🔒 Security Checklist

- ✅ HTTPS is enabled (required for `SESSION_COOKIE_SECURE=True`)
- ✅ `FLASK_SECRET_KEY` is set to a secure random value
- ✅ `SESSION_COOKIE_SECURE=True` is set
- ✅ Session cookies are HTTP-only (configured in code)
- ✅ CSRF protection via OAuth2 state parameter (configured in code)

## 🐛 Troubleshooting

### Login redirects but shows error
- Check that `DISCORD_OAUTH2_REDIRECT_URI` in `.env` exactly matches the URL in Discord Developer Portal
- Verify the callback URL has no trailing slash

### Session not persisting
- Ensure `FLASK_SECRET_KEY` is set in `.env`
- Check that `SESSION_COOKIE_SECURE=True` is set (for HTTPS)
- Verify cookies are enabled in browser
- Check browser console for cookie-related errors

### "Invalid redirect URI" error
- Verify the exact URL in Discord Developer Portal matches `DISCORD_OAUTH2_REDIRECT_URI`
- Check for protocol mismatch (http vs https)
- Ensure no trailing slashes

## 📝 Notes

- The production URL `https://meshmap.radio-actief.be/auth/callback` is already configured
- Both development (`http://localhost:8000/auth/callback`) and production URLs can be added to Discord Developer Portal if needed
- Session data is stored server-side in the filesystem (configured in `backend/api/app.py`)
