# Discord Server Membership Requirement

## Overview

Users must be members of the Discord server before they can claim nodes via the web app. This ensures that only community members can manage nodes.

## Implementation

### OAuth2 Scope

The OAuth2 scope has been updated to include `guilds`:
- **Previous scope**: `identify`
- **New scope**: `identify guilds`

This allows the application to check which Discord servers (guilds) the user is a member of.

### Flow

1. User clicks "Login with Discord"
2. User authorizes the application with `identify` and `guilds` scopes
3. After authorization, the application checks if the user is a member of the configured Discord server
4. **If member**: User is logged in and can claim nodes
5. **If not a member**: User is redirected to the Discord server invite URL

### Configuration

Add to your `.env` file:

```bash
DISCORD_SERVER_INVITE_URL=https://discord.gg/kvybAgqnhD
```

This is the invite URL users will be redirected to if they're not server members.

## Discord Developer Portal Settings

### Required OAuth2 Scopes

In your Discord application's OAuth2 settings, ensure these scopes are enabled:

1. **identify** - Get user's basic information
2. **guilds** - Get list of servers user is a member of

### Bot Permissions

The bot needs to be a member of the Discord server to verify membership. The bot uses its token to check if users are members in real-time when they attempt to claim nodes.

**Required:**
- Bot must be in the Discord server
- Bot token must be configured (`DISCORD_BOT_TOKEN`)

**For servers with 1000+ members:**
- Bot needs **GUILD_MEMBERS** intent enabled in Discord Developer Portal
- Go to Bot → Privileged Gateway Intents → Enable "Server Members Intent"

**For servers with <1000 members:**
- No special intents required
- The `GET /guilds/{guild.id}/members/{user.id}` endpoint works with the bot token as long as the bot is in the server

### Setting Up OAuth2 Scopes

1. Go to [Discord Developer Portal](https://discord.com/developers/applications)
2. Select your OAuth2 application
3. Go to **OAuth2** → **General**
4. Under **Scopes**, ensure `identify` and `guilds` are listed
5. The redirect URI should already be configured

## User Experience

### If User is Not a Server Member

1. User logs in with Discord
2. System detects they're not a server member
3. User is redirected to the Discord server invite
4. After joining the server, user needs to log out and log back in to refresh their membership status

### If User is a Server Member

1. User logs in with Discord
2. System verifies server membership
3. User is logged in and can claim nodes immediately

## API Behavior

### Claim Endpoint

The `/api/v1/nodes/<public_key>/claim` endpoint performs a **real-time** guild membership check:

- **If not authenticated**: Returns 401
- **If authenticated but not a server member (real-time check)**: Returns 403 with error message and invite URL
- **If authenticated and is a server member**: Proceeds with claim

**Important**: The endpoint uses the bot token to verify membership in real-time, not just the session flag. This ensures that users who were banned or kicked cannot claim nodes even if their session is still active.

### Error Response

If user tries to claim but is not a server member:

```json
{
  "error": "You must be a member of our Discord server to claim nodes.",
  "discord_invite_url": "https://discord.gg/kvybAgqnhD"
}
```

## Troubleshooting

### "Not a guild member" error after joining server

- User needs to log out and log back in to refresh their membership status
- The membership check happens during login, not on every request

### OAuth2 scope errors

- Ensure `guilds` scope is enabled in Discord Developer Portal
- Check that the redirect URI matches exactly

### Users can't see the invite link

- Ensure `DISCORD_SERVER_INVITE_URL` is set in your `.env` file
- Check that the invite link is valid and not expired

## Security Notes

- **Login check**: Guild membership is checked during login using OAuth2 `guilds` scope
- **Real-time verification**: When claiming nodes, membership is verified again using the bot token
- This prevents users who were banned/kicked from claiming nodes even if their session is still active
- The membership status is stored in the session for UI purposes, but the claim endpoint performs a real-time check
- Users must re-authenticate to refresh their membership status after joining the server
