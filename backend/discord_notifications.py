"""
Discord Notification Module
Sends Discord messages when nodes are claimed/unclaimed via the web app.
"""

import requests
import sys
import os
from typing import Any, Dict

# Add parent directory to path for imports
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

from config.config import DISCORD_BOT_TOKEN, STARTUP_CHANNEL_ID
from backend.discord_branding import apply_brand_to_embed_dict
from backend.discord_formatting import build_claim_embed_dict, build_unclaim_embed_dict


def send_discord_message(embed: Dict[str, Any]) -> bool:
    """
    Send a Discord message with an embed using the bot token.

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
    payload = {"embeds": [embed]}

    try:
        response = requests.post(url, json=payload, headers=headers)
        response.raise_for_status()
        return True
    except requests.RequestException as e:
        print(f"Error sending Discord notification: {e}")
        return False


def notify_node_claimed(node: Dict[str, Any], user_id: str, username: str) -> bool:
    """Send Discord notification when a node is claimed via web app."""
    embed = build_claim_embed_dict(node, user_id, via_web=True)
    return send_discord_message(apply_brand_to_embed_dict(embed))


def notify_node_unclaimed(node: Dict[str, Any], user_id: str, username: str) -> bool:
    """Send Discord notification when a node is unclaimed via web app."""
    embed = build_unclaim_embed_dict(node, user_id, via_web=True)
    return send_discord_message(apply_brand_to_embed_dict(embed))
