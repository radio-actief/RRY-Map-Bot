"""
Discord Notification Module
Sends Discord messages when nodes are claimed/unclaimed via the web app.
"""

import requests
import sys
import os
from typing import Optional, Dict, Any

# Add parent directory to path for imports
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

from config.config import (
    DISCORD_BOT_TOKEN,
    STARTUP_CHANNEL_ID,
    NODE_TYPE_ICONS,
    NODE_TYPES
)
from backend.discord_branding import apply_brand_to_embed_dict


def truncate_public_key(pub_key: str, show_full: bool = False) -> str:
    """
    Truncate public key to 6 characters unless show_full is True.
    Always returns UPPERCASE for display.
    
    Args:
        pub_key: Public key string (may be lowercase).
        show_full: If True, return full key; otherwise truncate to 6 chars.
    
    Returns:
        Uppercase public key, truncated if show_full is False.
    """
    if not pub_key:
        return ""
    pub_key_upper = pub_key.upper()
    if show_full:
        return pub_key_upper
    return pub_key_upper[:6] if len(pub_key_upper) > 6 else pub_key_upper


def get_node_type_display(type_num: int) -> str:
    """
    Get properly capitalized node type text for display.
    
    Args:
        type_num: Node type number (1-4).
    
    Returns:
        Properly capitalized text (e.g., "Companion", "Room Server").
    """
    type_text = NODE_TYPES.get(type_num, f"Unknown ({type_num})")
    return type_text.title()


def get_node_type_icon(type_num: int) -> str:
    """
    Get Discord icon for node type.
    
    Args:
        type_num: Node type number (1-4).
    
    Returns:
        Emoji icon string.
    """
    return NODE_TYPE_ICONS.get(type_num, "❓")


def send_discord_message(embed: Dict[str, Any]) -> bool:
    """
    Send a Discord message with an embed using the bot token.
    
    Args:
        embed: Discord embed dictionary.
    
    Returns:
        True if successful, False otherwise.
    """
    if not DISCORD_BOT_TOKEN or not STARTUP_CHANNEL_ID:
        print("Discord bot token or channel ID not configured. Skipping notification.")
        return False
    
    url = f"https://discord.com/api/v10/channels/{STARTUP_CHANNEL_ID}/messages"
    headers = {
        "Authorization": f"Bot {DISCORD_BOT_TOKEN}",
        "Content-Type": "application/json"
    }
    
    payload = {
        "embeds": [embed]
    }
    
    try:
        response = requests.post(url, json=payload, headers=headers)
        response.raise_for_status()
        return True
    except requests.RequestException as e:
        print(f"Error sending Discord notification: {e}")
        return False


def notify_node_claimed(node: Dict[str, Any], user_id: str, username: str) -> bool:
    """
    Send Discord notification when a node is claimed via web app.
    
    Args:
        node: Node dictionary from database.
        user_id: Discord user ID of the user who claimed the node.
        username: Discord username of the user who claimed the node.
    
    Returns:
        True if notification sent successfully, False otherwise.
    """
    node_name = node.get('adv_name', 'Unknown')
    type_icon = get_node_type_icon(node.get('type', 0))
    pub_key_display = truncate_public_key(node.get('public_key', ''), show_full=False)
    type_text = get_node_type_display(node.get('type', 0))
    city = node.get('city', 'Unknown')
    source = node.get('source', 'N/A')
    source_capitalized = source.capitalize() if source else 'N/A'
    
    embed = {
        "title": f"{type_icon} Node Claimed",
        "description": f"**{node_name}** `{pub_key_display}` ({type_text.lower()}) has been claimed by <@{user_id}>",
        "color": 5763719,  # Discord green color
        "fields": [
            {
                "name": "Public Key",
                "value": f"`{truncate_public_key(node.get('public_key', ''), show_full=True)}`",
                "inline": True
            },
            {
                "name": "Node Name",
                "value": node_name,
                "inline": True
            },
            {
                "name": "Node Type",
                "value": type_text,
                "inline": True
            },
            {
                "name": "Location",
                "value": city,
                "inline": True
            },
            {
                "name": "Source Type",
                "value": source_capitalized,
                "inline": True
            },
            {
                "name": "Claimed By",
                "value": f"<@{user_id}>",
                "inline": True
            }
        ],
        "footer": {
            "text": "Claimed via web app. Use `/search` to see the updated node details, `/mynodes` to see your owned nodes, or `/node update` to update more details."
        }
    }
    
    return send_discord_message(apply_brand_to_embed_dict(embed))


def notify_node_unclaimed(node: Dict[str, Any], user_id: str, username: str) -> bool:
    """
    Send Discord notification when a node is unclaimed via web app.
    
    Args:
        node: Node dictionary from database.
        user_id: Discord user ID of the user who unclaimed the node.
        username: Discord username of the user who unclaimed the node.
    
    Returns:
        True if notification sent successfully, False otherwise.
    """
    node_name = node.get('adv_name', 'Unknown')
    type_icon = get_node_type_icon(node.get('type', 0))
    pub_key_display = truncate_public_key(node.get('public_key', ''), show_full=False)
    type_text = get_node_type_display(node.get('type', 0))
    city = node.get('city', 'Unknown')
    source = node.get('source', 'N/A')
    source_capitalized = source.capitalize() if source else 'N/A'
    
    embed = {
        "title": f"{type_icon} Node Unclaimed",
        "description": f"**{node_name}** `{pub_key_display}` ({type_text.lower()}) has been unclaimed by <@{user_id}>",
        "color": 15105570,  # Discord orange color
        "fields": [
            {
                "name": "Public Key",
                "value": f"`{truncate_public_key(node.get('public_key', ''), show_full=True)}`",
                "inline": True
            },
            {
                "name": "Node Name",
                "value": node_name,
                "inline": True
            },
            {
                "name": "Node Type",
                "value": type_text,
                "inline": True
            },
            {
                "name": "Location",
                "value": city,
                "inline": True
            },
            {
                "name": "Source Type",
                "value": source_capitalized,
                "inline": True
            },
            {
                "name": "Status",
                "value": "Unclaimed",
                "inline": True
            }
        ],
        "footer": {
            "text": "Unclaimed via web app. Use `/search` to see the updated node details, `/mynodes` to see your owned nodes, or `/node update` to update more details."
        }
    }
    
    return send_discord_message(apply_brand_to_embed_dict(embed))
