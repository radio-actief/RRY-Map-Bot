"""
Shared Discord embed and text formatting for RRY-Map-Bot.

Used by discord_bot, discord_notifications, daily_digest, and sync_belgian_nodes
so command output, web claim notifications, and digests stay consistent.
"""

from __future__ import annotations

import os
import sys
from functools import lru_cache
from datetime import datetime
from typing import Any, Callable, Dict, List, Optional, Tuple
from urllib.parse import quote

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

# Community and map name as the website writes it.
BEMESH = "#BEmesh"

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


DIGEST_LINK_KEY_CHARS = 12


def get_map_link(node: Dict[str, Any], *, short: bool = False) -> str:
    """Map link for a node; ``short`` uses the first 12 hex of the key (the map accepts a unique prefix)."""
    base = MAP_BASE_URL.rstrip("/")
    pk = (node.get("public_key") or "").strip()
    if pk and short:
        pk = pk.replace(" ", "").replace("-", "").lower()[:DIGEST_LINK_KEY_CHARS]
    if pk:
        return f"{base}/?node={quote(pk, safe='')}"
    return base


def get_map_base_url() -> str:
    """The map's home page (follows ``MAP_BASE_URL``)."""
    return MAP_BASE_URL.rstrip("/")


def get_stats_url() -> str:
    """The statistics page (follows ``MAP_BASE_URL``)."""
    return f"{get_map_base_url()}/stats"


def node_last_seen(node: Dict[str, Any]) -> Optional[datetime]:
    """Most recent of ``inserted_date``, ``updated_date`` and ``last_advert`` (UTC)."""
    from backend.datetime_utils import parse_utc

    dates = [parse_utc(node.get(key)) for key in ('inserted_date', 'updated_date', 'last_advert')]
    dates = [d for d in dates if d]
    return max(dates) if dates else None


def discord_timestamp(dt: datetime, style: str = "R") -> str:
    """``<t:unix:R>``: Discord shows it in each viewer's own time zone and language."""
    return f"<t:{int(dt.timestamp())}:{style}>"


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


DIGEST_NAME_MAX_CHARS = 40


def escape_node_name(text: Optional[str]) -> str:
    """Escape a user-chosen name for Discord markdown, mentions and link text.

    ``*``, ``_``, ``~``, ``|``, backticks, ``[`` / ``]`` and friends are
    backslash-escaped; ``@everyone`` / ``@here`` / ``<@id>`` are defused with a
    zero-width space. Newlines become spaces so a name stays on one line.
    """
    from discord.utils import escape_markdown, escape_mentions

    cleaned = " ".join(str(text or "").split())
    # Brackets are swapped out first so escape_markdown's own backslash
    # escaping can't pair with them; they come back escaped.
    cleaned = cleaned.replace("[", "\ue000").replace("]", "\ue001")
    escaped = escape_markdown(cleaned).replace("\ue000", "\\[").replace("\ue001", "\\]")
    return escape_mentions(escaped)


PROVINCE_NAMES = {
    "VAN": "Antwerpen", "VOV": "Oost-Vlaanderen", "VWV": "West-Vlaanderen",
    "VLI": "Limburg", "VBR": "Vlaams-Brabant", "BRU": "Brussel",
    "WBR": "Waals-Brabant", "WHT": "Henegouwen", "WLG": "Luik",
    "WLX": "Luxemburg", "WNA": "Namen",
}


@lru_cache(maxsize=1)
def _province_by_town() -> Dict[str, str]:
    """``plaats`` -> short province code (``be-vbr`` -> ``VBR``) from be-locode.json."""
    import json
    from pathlib import Path

    path = Path(os.getenv(
        "BE_LOCODE_JSON",
        str(Path(__file__).resolve().parent.parent / "data" / "be-locode.json"),
    ))
    try:
        rows = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}
    out: Dict[str, str] = {}
    for row in rows if isinstance(rows, list) else []:
        town = row.get("plaats")
        code = (row.get("province_code") or "").split("-")[-1].upper()
        if town and code and len(code) <= 3:
            out[town] = code
    return out


def format_node_town(node: Dict[str, Any]) -> str:
    """``Leuven (VBR)``; empty when the town is unknown."""
    city = (node.get('city') or '').strip()
    if not city or city == 'Unknown':
        return ""
    town = escape_node_name(city)
    code = _province_by_town().get(city)
    return f"{town} ({code})" if code else town


def format_digest_node_line(node: Dict[str, Any], *, link: bool = True) -> str:
    """One short digest line: icon, name (linked to the map), town, owner."""
    icon = get_node_type_icon(node.get('type', 0) or 0)
    raw = " ".join(str(node.get('adv_name') or 'Unknown').split())
    if len(raw) > DIGEST_NAME_MAX_CHARS:
        raw = raw[:DIGEST_NAME_MAX_CHARS - 1] + "…"
    name = escape_node_name(raw)
    parts = [f"[{name}]({get_map_link(node, short=True)})" if link else name]
    town = format_node_town(node)
    if town:
        parts.append(town)
    owner_id = node.get('discord_owner_id')
    if owner_id:
        parts.append(f"<@{owner_id}>")
    return f"{icon} " + " · ".join(parts)


def format_node_line(node: Dict[str, Any], *, owner: bool = True, seen: bool = True) -> str:
    """The bot's one-line node: the digest line, plus ``seen <t:…:R>`` when known."""
    line = format_digest_node_line(node if owner else {**node, 'discord_owner_id': None})
    last = node_last_seen(node) if seen else None
    if last:
        line += " · seen " + discord_timestamp(last)
    return line


def strip_backticks(text: Optional[str]) -> str:
    """User text shown inside a code span: backticks removed, one line."""
    return " ".join(str(text or "").replace("`", "").split())


def format_node_compact(node: Dict[str, Any]) -> str:
    """Single-line format for sync notifications."""
    type_num = node.get('type', 0) or 0
    icon = get_node_type_icon(type_num)
    pk_disp = truncate_public_key(node.get('public_key', ''), show_full=False)
    name = escape_node_name(node.get('adv_name') or 'Unknown')
    owner_id = node.get('discord_owner_id')
    owner = f"<@{owner_id}>" if owner_id else "Unclaimed"
    return f"{icon} `{pk_disp}` - {name} - {owner}"


def build_claim_embed_dict(node: Dict[str, Any], user_id: str, *, via_web: bool = False) -> Dict[str, Any]:
    """Two lines: who claimed it, then the node line. The map button goes with the message."""
    type_icon = get_node_type_icon(node.get('type', 0))
    if via_web:
        what = f"<@{user_id}> claimed this node on the map."
    else:
        what = f"<@{user_id}> claimed this node."
    return {
        "title": f"{type_icon} Node claimed",
        "description": f"{what}\n{format_node_line(node, owner=False)}",
        "color": DISCORD_COLOR_GREEN,
    }


def build_unclaim_embed_dict(node: Dict[str, Any], user_id: str, *, via_web: bool = False) -> Dict[str, Any]:
    """Two lines: who unclaimed it, then the node line. The map button goes with the message."""
    type_icon = get_node_type_icon(node.get('type', 0))
    if via_web:
        what = f"<@{user_id}> unclaimed this node on the map."
    else:
        what = f"<@{user_id}> unclaimed this node."
    return {
        "title": f"{type_icon} Node unclaimed",
        "description": f"{what}\n{format_node_line(node, owner=False)}",
        "color": DISCORD_COLOR_ORANGE,
    }


def map_button_components(url: str, label: str = "Open on map") -> List[Dict[str, Any]]:
    """Message ``components`` with one link button (for messages sent through the REST API)."""
    return [{"type": 1, "components": [{"type": 2, "style": 5, "label": label, "url": url}]}]


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
) -> Any:
    """One node as a branded Discord embed: key, type, town, owner, frequency, first and last seen."""
    import discord
    from backend.datetime_utils import parse_utc

    ensure_node_params(node)
    type_num = node.get('type', 0)
    owner_id = node.get('discord_owner_id')

    embed = branded_embed(
        title=f"{get_node_type_icon(type_num)} Node details",
        description=f"**{escape_node_name(node.get('adv_name') or 'Unknown')}**",
        color=discord.Color.blue(),
    )
    embed.add_field(name="Public key", value=f"`{truncate_public_key(node.get('public_key', ''), show_full=True)}`", inline=False)
    embed.add_field(name="Type", value=get_node_type_display(type_num), inline=True)
    embed.add_field(name="Town", value=format_node_town(node) or "Unknown", inline=True)
    embed.add_field(name="Owner", value=f"<@{owner_id}>" if owner_id else "Unclaimed", inline=True)

    if show_coordinates:
        lat = node.get('adv_lat')
        lon = node.get('adv_lon')
        if lat is not None and lon is not None:
            embed.add_field(name="Location", value=f"`{lat}, {lon}`", inline=True)

    embed.add_field(name="Frequency", value=format_frequency_display(node.get('params', {})), inline=False)

    first = parse_utc(node.get('inserted_date'))
    if first:
        embed.add_field(name="First seen", value=discord_timestamp(first), inline=True)
    last = node_last_seen(node)
    if last:
        embed.add_field(name="Last seen", value=discord_timestamp(last), inline=True)
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
        parts.append(f"`{strip_backticks(query)}`")
    if node_type:
        parts.append(f"type: `{node_type}`")
    if city:
        parts.append(f"city: `{strip_backticks(city)}`")
    if frequency_preset_name:
        parts.append(f"frequency preset: `{strip_backticks(frequency_preset_name)}`")
    if owner_mention:
        parts.append(f"owner: {owner_mention}")
    if claimed is not None:
        parts.append(f"claimed: `{str(claimed).lower()}`")
    if inactive:
        parts.append("inactive: `true`")
    if source_label:
        parts.append(f"source: `{source_label}`")
    return ", ".join(parts) if parts else "all nodes"


def fit_lines(lines: List[str], limit: int, *, separator: str = "\n") -> Tuple[List[str], int]:
    """Whole lines that fit in ``limit`` characters, and how many were left out."""
    shown: List[str] = []
    used = 0
    for line in lines:
        extra = len(line) + (len(separator) if shown else 0)
        if used + extra > limit:
            break
        shown.append(line)
        used += extra
    return shown, len(lines) - len(shown)
