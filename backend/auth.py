"""
Discord OAuth2 Authentication Module
Handles OAuth2 authentication flow for web app users.
"""

import requests
import secrets
from flask import session, redirect, url_for, request
from typing import Optional, Dict, Any
import sys
import os

# Add parent directory to path for imports
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

from config.config import (
    DISCORD_OAUTH2_CLIENT_ID,
    DISCORD_OAUTH2_CLIENT_SECRET,
    DISCORD_OAUTH2_REDIRECT_URI,
    DISCORD_OAUTH2_SCOPE,
    DISCORD_API_BASE_URL,
    DISCORD_GUILD_ID,
    DISCORD_SERVER_INVITE_URL,
    DISCORD_BOT_TOKEN
)


def get_authorization_url(state: Optional[str] = None) -> str:
    """
    Generate Discord OAuth2 authorization URL.
    
    Args:
        state: Optional state parameter for CSRF protection.
    
    Returns:
        Authorization URL string.
    """
    if not DISCORD_OAUTH2_CLIENT_ID:
        raise ValueError("DISCORD_OAUTH2_CLIENT_ID not configured")
    
    params = {
        'client_id': DISCORD_OAUTH2_CLIENT_ID,
        'redirect_uri': DISCORD_OAUTH2_REDIRECT_URI,
        'response_type': 'code',
        'scope': DISCORD_OAUTH2_SCOPE
    }
    
    if state:
        params['state'] = state
    
    query_string = '&'.join([f'{k}={v}' for k, v in params.items()])
    return f'{DISCORD_API_BASE_URL}/oauth2/authorize?{query_string}'


def exchange_code_for_token(code: str) -> Optional[Dict[str, Any]]:
    """
    Exchange authorization code for access token.
    
    Args:
        code: Authorization code from Discord.
    
    Returns:
        Token response dict with 'access_token' and 'token_type', or None on error.
    """
    if not DISCORD_OAUTH2_CLIENT_ID or not DISCORD_OAUTH2_CLIENT_SECRET:
        return None
    
    data = {
        'client_id': DISCORD_OAUTH2_CLIENT_ID,
        'client_secret': DISCORD_OAUTH2_CLIENT_SECRET,
        'grant_type': 'authorization_code',
        'code': code,
        'redirect_uri': DISCORD_OAUTH2_REDIRECT_URI
    }
    
    headers = {
        'Content-Type': 'application/x-www-form-urlencoded'
    }
    
    try:
        response = requests.post(
            f'{DISCORD_API_BASE_URL}/oauth2/token',
            data=data,
            headers=headers
        )
        response.raise_for_status()
        return response.json()
    except requests.RequestException as e:
        print(f"Error exchanging code for token: {e}")
        return None


def get_user_info(access_token: str) -> Optional[Dict[str, Any]]:
    """
    Get Discord user information using access token.
    
    Args:
        access_token: Discord OAuth2 access token.
    
    Returns:
        User info dict with 'id', 'username', 'discriminator', 'avatar', etc., or None on error.
    """
    headers = {
        'Authorization': f'Bearer {access_token}'
    }
    
    try:
        response = requests.get(
            f'{DISCORD_API_BASE_URL}/users/@me',
            headers=headers
        )
        response.raise_for_status()
        return response.json()
    except requests.RequestException as e:
        print(f"Error getting user info: {e}")
        return None


def get_user_guilds(access_token: str) -> Optional[list]:
    """
    Get list of Discord guilds (servers) the user is a member of.
    
    Args:
        access_token: Discord OAuth2 access token.
    
    Returns:
        List of guild dicts, or None on error.
    """
    headers = {
        'Authorization': f'Bearer {access_token}'
    }
    
    try:
        response = requests.get(
            f'{DISCORD_API_BASE_URL}/users/@me/guilds',
            headers=headers
        )
        response.raise_for_status()
        return response.json()
    except requests.RequestException as e:
        print(f"Error getting user guilds: {e}")
        return None


def is_guild_member(access_token: str, guild_id: Optional[str] = None) -> bool:
    """
    Check if user is a member of the specified Discord guild (server).
    
    Args:
        access_token: Discord OAuth2 access token.
        guild_id: Discord guild ID to check. If None, uses DISCORD_GUILD_ID from config.
    
    Returns:
        True if user is a member, False otherwise.
    """
    if not guild_id:
        guild_id = DISCORD_GUILD_ID
    
    if not guild_id:
        # If no guild ID configured, don't enforce membership
        return True
    
    guilds = get_user_guilds(access_token)
    if not guilds:
        return False
    
    # Check if the guild ID is in the user's guilds list
    return any(str(guild.get('id')) == str(guild_id) for guild in guilds)


def is_authenticated() -> bool:
    """
    Check if user is authenticated (has valid session).
    
    Returns:
        True if user is authenticated, False otherwise.
    """
    return 'user_id' in session and 'username' in session


def get_current_user() -> Optional[Dict[str, Any]]:
    """
    Get current authenticated user from session.
    
    Returns:
        Dict with 'id' and 'username', or None if not authenticated.
    """
    if not is_authenticated():
        return None
    
    return {
        'id': session.get('user_id'),
        'username': session.get('username'),
        'discriminator': session.get('discriminator'),
        'avatar': session.get('avatar'),
        'is_guild_member': session.get('is_guild_member', False)
    }


def login_required(f):
    """
    Decorator to require authentication for a route.
    Returns 401 if not authenticated.
    """
    from functools import wraps
    from flask import jsonify
    
    @wraps(f)
    def decorated_function(*args, **kwargs):
        if not is_authenticated():
            return jsonify({'error': 'Authentication required'}), 401
        return f(*args, **kwargs)
    return decorated_function


def verify_guild_membership_bot(user_id: str, guild_id: Optional[str] = None) -> bool:
    """
    Verify if a user is a member of the Discord guild using the bot token.
    This is a real-time check that doesn't rely on session data.
    
    Args:
        user_id: Discord user ID to check.
        guild_id: Discord guild ID to check. If None, uses DISCORD_GUILD_ID from config.
    
    Returns:
        True if user is a member, False otherwise.
    """
    if not DISCORD_BOT_TOKEN:
        print("DISCORD_BOT_TOKEN not configured. Cannot verify guild membership.")
        return False
    
    if not guild_id:
        guild_id = DISCORD_GUILD_ID
    
    if not guild_id:
        # If no guild ID configured, don't enforce membership
        return True
    
    if not user_id:
        return False
    
    # Use bot token to check guild membership
    # Endpoint: GET /guilds/{guild.id}/members/{user.id}
    headers = {
        'Authorization': f'Bot {DISCORD_BOT_TOKEN}'
    }
    
    try:
        response = requests.get(
            f'{DISCORD_API_BASE_URL}/guilds/{guild_id}/members/{user_id}',
            headers=headers
        )
        
        # 200 = user is a member
        # 404 = user is not a member
        # 403 = bot doesn't have permission (may need GUILD_MEMBERS intent for large servers)
        if response.status_code == 200:
            return True
        elif response.status_code == 404:
            return False
        elif response.status_code == 403:
            # Bot doesn't have permission - might need GUILD_MEMBERS intent
            # For security, we deny access if we can't verify membership
            print(f"Bot lacks permission to check guild membership (status 403). Bot may need GUILD_MEMBERS intent for servers with 1000+ members.")
            return False
        else:
            # For other status codes (500, etc.), log and return False for safety
            print(f"Unexpected status code when checking guild membership: {response.status_code}")
            return False
    except requests.RequestException as e:
        print(f"Error verifying guild membership with bot token: {e}")
        return False


def generate_state() -> str:
    """
    Generate a random state string for CSRF protection.
    
    Returns:
        Random hex string.
    """
    return secrets.token_hex(16)
