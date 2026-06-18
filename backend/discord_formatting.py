"""
Shared Discord embed and text formatting for RRY-Map-Bot.

Used by discord_bot, discord_notifications, daily_digest, and sync_belgian_nodes
so command output, web claim notifications, and digests stay consistent.
"""

from __future__ import annotations

import sys
import os
from typing import Any, Callable, Dict, List, Optional, Tuple
from urllib.parse import quote
from zoneinfo import ZoneInfo

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

try:
    from config.config import (
        FREQUENCY_PRESETS,
        MAP_BASE_URL,
        NODE_TYPES,
        NODE_TYPE_ICONS,
    )
except (ImportError, ModuleNotFoundError):
    MAP_BASE_URL = os.getenv('MAP_BASE_URL', 'https://meshmap.radio-actief.be')
    NODE_TYPES = {1: "companion", 2: "repeater", 3: "room server", 4: "sensor"}
    NODE_TYPE_ICONS = {1: "📱", 2: "📡", 3: "💾", 4: "🌡️"}
    FREQUENCY_PRESETS = []

from backend.database import json_deserialize

DISCORD_EMBED_DESC_LIMIT = 4096
DISCORD_EMBED_DESC_SAFE_BUFFER = 500
DISCORD_EMBED_MAX_NODES_PER_CHUNK = 25
DISCORD_EMBED_EARLY_BREAK_BUFFER = 150

DISCORD_COLOR_GREEN = 5763719
DISCORD_COLOR_ORANGE = 15105570
DISCORD_COLOR_BLUE = 3447003


def truncate_public_key(pub_key: str, show_full: bool = False) -> str:
    if not pub_key:
        return ""
    pub_key_upper = pub_key.upper()
    if show_full:
        return pub_key_upper
    return pub_key_upper[:6] if len(pub_key_upper) > 6 else pub_key_upper


def escape_discord_markdown(text: str) -> str:
    if not text:
        return ""
    cleaned = text.replace('`', '')
    return f"`{cleaned}`"


def get_node_type_display(type_num: int) -> str:
    type_text = NODE_TYPES.get(type_num, f"Unknown ({type_num})")
    return type_text.title()


def get_node_type_icon(type_num: int) -> str:
    return NODE_TYPE_ICONS.get(type_num, "•")


def match_frequency_preset(params: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    if not params:
        return None
    freq = params.get('freq')
    sf = params.get('sf')
    bw = params.get('bw')
    cr = params.get('cr')
    if freq is None or sf is None or bw is None or cr is None:
        return None
    for preset in FREQUENCY_PRESETS:
        if (abs(freq - preset['freq']) < 0.001 and
                sf == preset['sf'] and
                bw == preset['bw'] and
                cr == preset['cr']):
            return preset
    return None


def format_date_display(date_string: Optional[str]) -> str:
    from backend.datetime_utils import parse_utc

    dt = parse_utc(date_string)
    if not dt:
        return "N/A"
    dt_cet = dt.astimezone(ZoneInfo("Europe/Brussels"))
    return dt_cet.strftime("%Y-%m-%d %H:%M") + " " + dt_cet.tzname()


def format_frequency_display(params: Dict[str, Any]) -> str:
    if not params or not isinstance(params, dict):
        return "N/A"
    if not any(params.get(key) is not None for key in ('freq', 'sf', 'bw', 'cr')):
        return "N/A"
    preset = match_frequency_preset(params)
    if preset:
        return f"Preset: {preset['name']} ({preset['freq']} MHz)"
    freq = params.get('freq', 'N/A')
    sf = params.get('sf', 'N/A')
    bw = params.get('bw', 'N/A')
    cr = params.get('cr', 'N/A')
    return f"Custom: Freq: {freq} MHz, SF: {sf}, BW: {bw}, CR: {cr}"


def get_map_link(node: Dict[str, Any]) -> str:
    base = MAP_BASE_URL.rstrip("/")
    pk = (node.get("public_key") or "").strip()
    if pk:
        return f"{base}/?node={quote(pk, safe='')}"
    return base


def get_most_recent_date(node: Dict[str, Any]) -> Optional[str]:
    from backend.datetime_utils import parse_utc

    cet = ZoneInfo("Europe/Brussels")
    dates_utc = []
    for date_field in ('inserted_date', 'updated_date', 'last_advert'):
        dt = parse_utc(node.get(date_field))
        if dt:
            dates_utc.append(dt)
    if dates_utc:
        most_recent_utc = max(dates_utc)
        dt_cet = most_recent_utc.astimezone(cet)
        return dt_cet.strftime('%Y-%m-%d %H:%M') + " " + dt_cet.tzname()
    return None


def ensure_node_params(node: Dict[str, Any]) -> Dict[str, Any]:
    """Deserialize params in-place and return the node."""
    params = node.get('params', {})
    if isinstance(params, str):
        try:
            node['params'] = json_deserialize(params) or {}
        except Exception:
            node['params'] = {}
    elif params is None or 'params' not in node:
        node['params'] = {}
    return node


def format_node_compact(node: Dict[str, Any]) -> str:
    """Single-line format for digest and sync notifications."""
    type_num = node.get('type', 0) or 0
    icon = get_node_type_icon(type_num)
    pk_disp = truncate_public_key(node.get('public_key', ''), show_full=False)
    name = (node.get('adv_name') or 'Unknown').replace('_', '\\_')
    owner_id = node.get('discord_owner_id')
    owner = f"<@{owner_id}>" if owner_id else "Unclaimed"
    return f"{icon} `{pk_disp}` - {name} - {owner}"


def format_node_simple(
    node: Dict[str, Any],
    show_coords: bool = False,
    show_owner: bool = False,
    include_map_link: bool = False,
    show_inactive_badge: bool = False,
) -> str:
    ensure_node_params(node)
    params = node.get('params', {})

    icon = get_node_type_icon(node.get('type', 0))
    pub_key_display = truncate_public_key(node.get('public_key', ''), show_full=False)
    node_name = escape_discord_markdown(node.get('adv_name', 'Unknown'))

    inactive_prefix = "⚫ Inactive · " if show_inactive_badge or not node.get('is_active', 1) else ""
    line1 = f"{inactive_prefix}{icon} `{pub_key_display}` - {node_name}"
    if show_owner:
        owner_id = node.get('discord_owner_id')
        if owner_id:
            line1 += f" - 👤 <@{owner_id}>"

    city = node.get('city', 'Unknown')
    line2 = f"📍 {city}"
    if show_coords:
        lat = node.get('adv_lat')
        lon = node.get('adv_lon')
        if lat is not None and lon is not None:
            line2 += f" ({lat}, {lon})"
    line2 += " | 📅 "
    most_recent = get_most_recent_date(node)
    line2 += most_recent if most_recent else "N/A"

    freq_display = format_frequency_display(params)
    if freq_display.startswith("Preset: "):
        freq_display = freq_display[8:]
    source = node.get('source', 'N/A')
    source_capitalized = source.capitalize() if source else 'N/A'
    line3 = f"📻 Frequency: {freq_display} | ℹ️ Source: {source_capitalized}"

    result = f"{line1}\n{line2}\n{line3}"
    if include_map_link:
        result += f"\n[View on map]({get_map_link(node)})"
    return result


def format_node_list(nodes: List[Dict[str, Any]], show_full_keys: bool = False) -> str:
    if len(nodes) == 1:
        node = nodes[0]
        icon = get_node_type_icon(node.get('type', 0))
        pub_key_display = truncate_public_key(node.get('public_key', ''), show_full=show_full_keys)
        node_name = escape_discord_markdown(node.get('adv_name', 'Unknown'))
        return f"{icon} `{pub_key_display}` - {node_name}"
    lines = []
    for node in nodes:
        lines.append(format_node_simple(node, show_coords=False, show_owner=True))
    return "\n\n".join(lines)


def _source_capitalized(node: Dict[str, Any]) -> str:
    source = node.get('source', 'N/A')
    return source.capitalize() if source else 'N/A'


def build_claim_embed_dict(node: Dict[str, Any], user_id: str, *, via_web: bool = False) -> Dict[str, Any]:
    node_name = node.get('adv_name', 'Unknown')
    type_icon = get_node_type_icon(node.get('type', 0))
    pub_key_display = truncate_public_key(node.get('public_key', ''), show_full=False)
    type_text = get_node_type_display(node.get('type', 0))
    city = node.get('city', 'Unknown')
    source_capitalized = _source_capitalized(node)
    map_url = get_map_link(node)

    if via_web:
        footer = "Claimed via web app. Use `/search` or `/mynodes` for details."
    else:
        footer = "Use `/mynodes` to see your owned nodes."

    return {
        "title": f"{type_icon} Node Claimed",
        "description": (
            f"**{node_name}** `{pub_key_display}` ({type_text.lower()}) "
            f"has been claimed by <@{user_id}>"
        ),
        "color": DISCORD_COLOR_GREEN,
        "fields": [
            {"name": "Public Key", "value": f"`{truncate_public_key(node.get('public_key', ''), show_full=True)}`", "inline": True},
            {"name": "Node Name", "value": node_name, "inline": True},
            {"name": "Node Type", "value": type_text, "inline": True},
            {"name": "Location", "value": city, "inline": True},
            {"name": "Source Type", "value": source_capitalized, "inline": True},
            {"name": "Claimed By", "value": f"<@{user_id}>", "inline": True},
            {"name": "View on Map", "value": f"[Open on map]({map_url})", "inline": False},
        ],
        "footer": {"text": footer},
    }


def build_unclaim_embed_dict(node: Dict[str, Any], user_id: str, *, via_web: bool = False) -> Dict[str, Any]:
    node_name = node.get('adv_name', 'Unknown')
    type_icon = get_node_type_icon(node.get('type', 0))
    pub_key_display = truncate_public_key(node.get('public_key', ''), show_full=False)
    type_text = get_node_type_display(node.get('type', 0))
    city = node.get('city', 'Unknown')
    source_capitalized = _source_capitalized(node)
    map_url = get_map_link(node)

    if via_web:
        footer = "Unclaimed via web app. Use `/search` or `/mynodes` for details."
    else:
        footer = "Use `/mynodes` to see your owned nodes."

    return {
        "title": f"{type_icon} Node Unclaimed",
        "description": (
            f"**{node_name}** `{pub_key_display}` ({type_text.lower()}) "
            f"has been unclaimed by <@{user_id}>"
        ),
        "color": DISCORD_COLOR_ORANGE,
        "fields": [
            {"name": "Public Key", "value": f"`{truncate_public_key(node.get('public_key', ''), show_full=True)}`", "inline": True},
            {"name": "Node Name", "value": node_name, "inline": True},
            {"name": "Node Type", "value": type_text, "inline": True},
            {"name": "Location", "value": city, "inline": True},
            {"name": "Source Type", "value": source_capitalized, "inline": True},
            {"name": "Status", "value": "Unclaimed", "inline": True},
            {"name": "View on Map", "value": f"[Open on map]({map_url})", "inline": False},
        ],
        "footer": {"text": footer},
    }


def dict_to_discord_embed(embed_dict: Dict[str, Any], branded_embed: Callable) -> Any:
    """Convert embed dict to discord.Embed using the bot's branded_embed factory."""
    import discord

    color = embed_dict.get("color", DISCORD_COLOR_BLUE)
    if isinstance(color, int):
        color = discord.Color(color)

    embed = branded_embed(
        title=embed_dict.get("title", ""),
        description=embed_dict.get("description", ""),
        color=color,
    )
    for field in embed_dict.get("fields", []):
        embed.add_field(
            name=field["name"],
            value=field["value"],
            inline=field.get("inline", False),
        )
    footer = embed_dict.get("footer")
    if footer and footer.get("text"):
        embed.set_footer(text=footer["text"])
    return embed


def format_full_node_details(
    node: Dict[str, Any],
    branded_embed: Callable,
    show_coordinates: bool = False,
    user_id: Optional[str] = None,
) -> Any:
    """Format full node information as a branded Discord embed."""
    import discord

    ensure_node_params(node)
    node_name = node.get('adv_name', 'Unknown')
    type_num = node.get('type', 0)
    type_text = get_node_type_display(type_num)
    type_icon = get_node_type_icon(type_num)
    freq_display = format_frequency_display(node.get('params', {}))
    pub_key_display_short = truncate_public_key(node.get('public_key', ''), show_full=False)
    pub_key_display = truncate_public_key(node.get('public_key', ''), show_full=True)
    city = node.get('city', 'Unknown')

    owner_id = node.get('discord_owner_id')
    owner = f"<@{owner_id}>" if owner_id else "Unclaimed"

    if user_id:
        description = (
            f"**{node_name}** `{pub_key_display_short}` ({type_text.lower()}) "
            f"details found by <@{user_id}>"
        )
    else:
        description = f"**{node_name}**"

    embed = branded_embed(
        title=f"{type_icon} Detailed node info",
        description=description,
        color=discord.Color.blue(),
    )
    embed.add_field(name="Public Key", value=f"`{pub_key_display}`", inline=False)
    embed.add_field(name="Type", value=type_text, inline=True)
    embed.add_field(name="City", value=city, inline=True)

    if show_coordinates:
        lat = node.get('adv_lat')
        lon = node.get('adv_lon')
        if lat is not None and lon is not None:
            embed.add_field(name="Location", value=f"`{lat}, {lon}`", inline=True)

    embed.add_field(name="Owner", value=owner, inline=True)
    embed.add_field(name="Frequency", value=freq_display, inline=False)

    link = node.get('link')
    if link:
        embed.add_field(name="MeshCore Link", value=f"`{link}`", inline=False)

    for label, key in (
        ("Inserted Date", "inserted_date"),
        ("Updated Date", "updated_date"),
        ("Last Advert", "last_advert"),
    ):
        val = node.get(key)
        if val:
            embed.add_field(name=label, value=format_date_display(val), inline=True)

    inserted_by = node.get('inserted_by')
    if inserted_by:
        embed.add_field(name="Inserted By", value=f"`{inserted_by.upper()}`", inline=True)

    updated_by = node.get('updated_by')
    if updated_by:
        embed.add_field(name="Updated By", value=f"`{updated_by.upper()}`", inline=True)

    source = node.get('source')
    if source:
        embed.add_field(name="Source", value=f"`{source.upper()}`", inline=True)

    return embed


def build_search_summary(
    *,
    query: Optional[str] = None,
    node_type: Optional[str] = None,
    city: Optional[str] = None,
    frequency_preset_name: Optional[str] = None,
    owner_mention: Optional[str] = None,
    claimed: Optional[bool] = None,
    inactive: Optional[bool] = None,
    source_label: Optional[str] = None,
) -> str:
    parts = []
    if query:
        parts.append(f"`{query}`")
    if node_type:
        parts.append(f"type: `{node_type}`")
    if city:
        parts.append(f"city: `{city}`")
    if frequency_preset_name:
        parts.append(f"frequency preset: `{frequency_preset_name}`")
    if owner_mention:
        parts.append(f"owner: {owner_mention}")
    if claimed is not None:
        parts.append(f"claimed: `{str(claimed).lower()}`")
    if inactive:
        parts.append("inactive: `true`")
    if source_label:
        parts.append(f"source: `{source_label}`")
    return ", ".join(parts) if parts else "all nodes"


def chunk_embed_descriptions(
    header_text: str,
    formatted_items: List[str],
) -> List[str]:
    """
    Split formatted node blocks into description strings that fit Discord embed limits.

    Returns a list of description strings (header + chunk content each).
    """
    if not formatted_items:
        return [header_text]

    max_allowed = DISCORD_EMBED_DESC_LIMIT - DISCORD_EMBED_DESC_SAFE_BUFFER
    chunks: List[List[str]] = []
    current_chunk: List[str] = []

    for item in formatted_items:
        test_chunk = current_chunk + [item]
        test_description = header_text + "\n\n".join(test_chunk)
        if (
            len(test_description) > max_allowed
            or len(test_chunk) > DISCORD_EMBED_MAX_NODES_PER_CHUNK
            or len(test_description) > (max_allowed - DISCORD_EMBED_EARLY_BREAK_BUFFER)
        ):
            if current_chunk:
                chunks.append(current_chunk)
                current_chunk = [item]
            else:
                current_chunk.append(item)
        else:
            current_chunk.append(item)

    if current_chunk:
        chunks.append(current_chunk)

    descriptions = []
    for chunk in chunks:
        content = "\n\n".join(chunk)
        description = header_text + content
        while len(description) > max_allowed and chunk:
            chunk = chunk[:-1]
            description = header_text + ("\n\n".join(chunk) if chunk else "*Error: No nodes fit*")
        descriptions.append(description)

    return descriptions if descriptions else [header_text]


def format_owner_display(node: Dict[str, Any]) -> str:
    """Format owner for error messages: mention when possible."""
    owner_id = node.get('discord_owner_id')
    if owner_id:
        return f"<@{owner_id}>"
    return node.get('discord_owner_name', 'Unknown')
