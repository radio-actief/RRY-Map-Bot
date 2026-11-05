"""
Discord Notification Module
Sends Discord messages when nodes are claimed/unclaimed via the web app.
"""

import threading
import time

import requests
import sys
import os
from typing import Any, Dict, Optional

# Add parent directory to path for imports
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

from config.config import DISCORD_BOT_TOKEN, STARTUP_CHANNEL_ID
from backend.discord_branding import apply_brand_to_embed_dict
from backend.discord_formatting import (
    build_claim_embed_dict,
    build_unclaim_embed_dict,
    get_map_link,
    map_button_components,
)

REQUEST_TIMEOUT_S = 5
RATE_LIMIT_WAIT_MAX_S = 5


def send_discord_message(embed: Dict[str, Any], components: Optional[list] = None) -> bool:
    """
    Send a Discord message with an embed (and optional components) using the bot token.

    Waits at most ``REQUEST_TIMEOUT_S`` per request and retries once after a
    short rate limit (429).

    Returns:
        True if successful, False otherwise.
    """
    if not DISCORD_BOT_TOKEN or not STARTUP_CHANNEL_ID:
        print("Discord bot token or channel ID not configured. Skipping notification.")
        return False

    url = f"https://discord.com/api/v10/channels/{STARTUP_CHANNEL_ID}/messages"
    headers = {
        "Authorization": f"Bot {DISCORD_BOT_TOKEN}",
        "Content-Type": "application/json",
    }
    payload: Dict[str, Any] = {"embeds": [embed]}
    if components:
        payload["components"] = components

    try:
        for attempt in range(2):
            response = requests.post(url, json=payload, headers=headers, timeout=REQUEST_TIMEOUT_S)
            if response.status_code == 429 and attempt == 0:
                try:
                    wait = float(response.json().get("retry_after", 1))
                except (ValueError, AttributeError):
                    wait = 1.0
                if wait <= RATE_LIMIT_WAIT_MAX_S:
                    time.sleep(wait)
                    continue
            response.raise_for_status()
            return True
        return False
    except requests.RequestException as e:
        print(f"Error sending Discord notification: {e}")
        return False


def _send_in_background(embed: Dict[str, Any], components: list) -> None:
    """Send without holding up the web request that triggered it."""
    threading.Thread(
        target=send_discord_message,
        args=(embed, components),
        name="discord-notification",
        daemon=True,
    ).start()


def notify_node_claimed(node: Dict[str, Any], user_id: str, username: str) -> None:
    """Announce a web-app claim in the channel (sent in the background)."""
    embed = apply_brand_to_embed_dict(build_claim_embed_dict(node, user_id, via_web=True))
    _send_in_background(embed, map_button_components(get_map_link(node, short=True)))


def notify_node_unclaimed(node: Dict[str, Any], user_id: str, username: str) -> None:
    """Announce a web-app unclaim in the channel (sent in the background)."""
    embed = apply_brand_to_embed_dict(build_unclaim_embed_dict(node, user_id, via_web=True))
    _send_in_background(embed, map_button_components(get_map_link(node, short=True)))
