"""
Discord Bot for RRY-Map-Bot
Handles all Discord bot functionality including commands and interactions.
"""

import discord
from discord import app_commands
from discord.ext import commands
import sys
import os
from datetime import datetime, timezone
from zoneinfo import ZoneInfo
from typing import Optional, Dict, Any, List

# Add parent directory to path for imports
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

try:
    from config.config import (
        DISCORD_BOT_TOKEN,
        DISCORD_GUILD_ID,
        STARTUP_CHANNEL_ID,
        STARTUP_MESSAGE_ID,
        NODE_TYPES,
        NODE_TYPES_REVERSE,
        NODE_TYPE_ICONS,
        FREQUENCY_PRESETS
    )
except (ImportError, ModuleNotFoundError):
    # Fallback if config not available
    DISCORD_BOT_TOKEN = os.getenv('DISCORD_BOT_TOKEN')
    DISCORD_GUILD_ID = os.getenv('DISCORD_GUILD_ID')
    STARTUP_CHANNEL_ID = os.getenv('STARTUP_CHANNEL_ID')
    STARTUP_MESSAGE_ID = os.getenv('STARTUP_MESSAGE_ID')
    
    NODE_TYPES = {
        1: "companion",
        2: "repeater",
        3: "room server",
        4: "sensor"
    }
    NODE_TYPES_REVERSE = {v.lower(): k for k, v in NODE_TYPES.items()}
    NODE_TYPE_ICONS = {
        1: "📱",
        2: "📡",
        3: "💾",
        4: "🌡️"
    }
    FREQUENCY_PRESETS = [
        {"name": "Australia", "freq": 915.800, "sf": 10, "bw": 250, "cr": 5},
        {"name": "Australia: Victoria", "freq": 916.675, "sf": 7, "bw": 62.5, "cr": 8},
        {"name": "EU/UK (Narrow)", "freq": 869.618, "sf": 8, "bw": 62.5, "cr": 8},
        {"name": "EU/UK (Long Range)", "freq": 869.525, "sf": 11, "bw": 250, "cr": 5},
        {"name": "EU/UK (Medium Range)", "freq": 869.525, "sf": 10, "bw": 250, "cr": 5},
        {"name": "Czech Republic (Narrow)", "freq": 869.525, "sf": 7, "bw": 62.5, "cr": 5},
        {"name": "EU 433MHz (Long Range)", "freq": 433.650, "sf": 11, "bw": 250, "cr": 5},
        {"name": "New Zealand", "freq": 917.375, "sf": 11, "bw": 250, "cr": 5},
        {"name": "New Zealand (Narrow)", "freq": 917.375, "sf": 7, "bw": 62.5, "cr": 5},
        {"name": "Portugal 433", "freq": 433.375, "sf": 9, "bw": 62.5, "cr": 6},
        {"name": "Portugal 868", "freq": 869.618, "sf": 7, "bw": 62.5, "cr": 6},
        {"name": "USA/Canada (Recommended)", "freq": 910.525, "sf": 7, "bw": 62.5, "cr": 5},
        {"name": "Vietnam", "freq": 920.250, "sf": 11, "bw": 250, "cr": 5},
    ]

from backend.database import (
    init_database,
    get_connection,
    get_current_timestamp,
    dict_from_row,
    json_deserialize
)

from backend.discord_queries import (
    query_nodes_substring,
    get_user_nodes,
    update_ownership,
    remove_ownership,
    update_node_properties,
    verify_ownership,
    get_node_by_key,
    get_statistics,
    get_source_statistics,
)

# Set up Discord bot intents
intents = discord.Intents.default()
intents.message_content = True

# Create bot instance
bot = commands.Bot(command_prefix='!', intents=intents)


# ============================================================================
# Helper Functions
# ============================================================================

def log_command(command_name: str, user: discord.User, query: Optional[str] = None, result: Optional[str] = None) -> None:
    """
    Log command execution to console.
    
    Args:
        command_name: Name of the command executed.
        user: Discord user who executed the command.
        query: Optional query string used in the command.
        result: Optional result summary.
    """
    timestamp = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    user_info = f"@{user.name} (ID: {user.id})"
    query_str = f' Query: "{query}"' if query else ""
    result_str = f" Result: {result}" if result else ""
    print(f"[{timestamp}] [{command_name}] User: {user_info}{query_str}{result_str}")


def truncate_public_key(pub_key: str, show_full: bool = False) -> str:
    """
    Truncate public key to 6 characters unless show_full is True.
    Always returns UPPERCASE for display (even though stored in lowercase).
    
    Args:
        pub_key: Public key string (may be lowercase).
        show_full: If True, return full key; otherwise truncate to 6 chars.
    
    Returns:
        Uppercase public key, truncated if show_full is False (no dots).
    """
    if not pub_key:
        return ""
    pub_key_upper = pub_key.upper()
    if show_full:
        return pub_key_upper
    return pub_key_upper[:6] if len(pub_key_upper) > 6 else pub_key_upper


def escape_discord_markdown(text: str) -> str:
    """
    Escape Discord markdown to prevent formatting issues (especially underscores).
    Uses code blocks to preserve underscores correctly.
    
    Args:
        text: Text to escape.
    
    Returns:
        Text wrapped in code blocks.
    """
    if not text:
        return ""
    # Remove any existing backticks to prevent code block issues
    cleaned = text.replace('`', '')
    return f"`{cleaned}`"


def get_node_type_text(type_num: int) -> str:
    """
    Convert node type number to descriptive text.
    
    Args:
        type_num: Node type number (1-4).
    
    Returns:
        Descriptive text for the node type (lowercase, for internal use).
    """
    return NODE_TYPES.get(type_num, f"Unknown ({type_num})")


def get_node_type_display(type_num: int) -> str:
    """
    Get properly capitalized node type text for display.
    
    Args:
        type_num: Node type number (1-4).
    
    Returns:
        Properly capitalized text (e.g., "Companion", "Room Server").
    """
    type_text = NODE_TYPES.get(type_num, f"Unknown ({type_num})")
    # Capitalize properly: "room server" -> "Room Server", "companion" -> "Companion"
    return type_text.title()


def get_node_type_number(type_text: str) -> Optional[int]:
    """
    Convert node type text to number (case-insensitive).
    
    Args:
        type_text: Node type text (e.g., "companion", "repeater").
    
    Returns:
        Node type number or None if not found.
    """
    return NODE_TYPES_REVERSE.get(type_text.lower())


def get_node_type_icon(type_num: int) -> str:
    """
    Get Discord icon for node type.
    
    Args:
        type_num: Node type number (1-4).
    
    Returns:
        Emoji icon for the node type.
    """
    return NODE_TYPE_ICONS.get(type_num, "•")


def match_frequency_preset(params: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    """
    Match frequency parameters against known presets.
    
    Args:
        params: Dictionary with keys: freq, sf, bw, cr.
    
    Returns:
        Matching preset dictionary or None.
    """
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
    """
    Format date string for Discord display in CET/CEST with timezone label.
    Expects stored dates in UTC (or ISO with Z/+00:00); naive strings are treated as UTC.
    
    Args:
        date_string: ISO format date string (e.g., "2026-01-02T18:45:49Z" or "2026-01-02T18:45:49.123456").
    
    Returns:
        Formatted date string (e.g., "2026-01-02 19:45 CET") or "N/A" if invalid.
    """
    if not date_string:
        return "N/A"
    
    try:
        # Normalize: Z -> +00:00 for fromisoformat; strip microseconds for consistent parsing
        date_str_clean = date_string.strip()
        if date_str_clean.endswith("Z"):
            date_str_clean = date_str_clean[:-1] + "+00:00"
        if "." in date_str_clean and "+" in date_str_clean:
            date_str_clean = date_str_clean.split(".")[0] + date_str_clean[date_str_clean.index("+"):]
        elif "." in date_str_clean:
            date_str_clean = date_str_clean.split(".")[0]
        
        dt = datetime.fromisoformat(date_str_clean)
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        else:
            dt = dt.astimezone(timezone.utc)
        
        cet = ZoneInfo("Europe/Brussels")
        dt_cet = dt.astimezone(cet)
        return dt_cet.strftime("%Y-%m-%d %H:%M") + " " + dt_cet.tzname()
    except (ValueError, AttributeError):
        return "N/A"


def format_frequency_display(params: Dict[str, Any]) -> str:
    """
    Format frequency display, showing preset name if matched.
    
    Args:
        params: Dictionary with frequency parameters.
    
    Returns:
        Formatted frequency string.
    """
    # Handle None or empty params
    if not params or not isinstance(params, dict):
        return "N/A"
    
    # Check if params has any actual values
    if not any(params.get(key) is not None for key in ['freq', 'sf', 'bw', 'cr']):
        return "N/A"
    
    preset = match_frequency_preset(params)
    if preset:
        return f"Preset: {preset['name']} ({preset['freq']} MHz)"
    else:
        freq = params.get('freq', 'N/A')
        sf = params.get('sf', 'N/A')
        bw = params.get('bw', 'N/A')
        cr = params.get('cr', 'N/A')
        return f"Custom: Freq: {freq} MHz, SF: {sf}, BW: {bw}, CR: {cr}"


def format_full_node_details(node: Dict[str, Any], show_coordinates: bool = False, user_id: Optional[str] = None) -> discord.Embed:
    """
    Format full node information as Discord embed (used when exactly 1 node found).
    
    Args:
        node: Node dictionary from database.
        show_coordinates: Only True when listing own nodes (security reasons).
        user_id: Optional Discord user ID for "details found by" in description.
    
    Returns:
        Discord embed with full node details.
    """
    node_name = node.get('adv_name', 'Unknown')
    type_num = node.get('type', 0)
    type_text = get_node_type_display(type_num)
    type_icon = get_node_type_icon(type_num)
    freq_display = format_frequency_display(node.get('params', {}))
    pub_key_display_short = truncate_public_key(node.get('public_key', ''), show_full=False)
    pub_key_display = truncate_public_key(node.get('public_key', ''), show_full=True)
    city = node.get('city', 'Unknown')
    
    # Format owner with Discord mention if available
    owner_id = node.get('discord_owner_id')
    if owner_id:
        owner = f"<@{owner_id}>"
    else:
        owner = "Unclaimed"
    
    # Create embed with "Details" in title
    # Format description based on whether user_id is provided
    if user_id:
        description = f"**{node_name}** `{pub_key_display_short}` ({type_text.lower()}) details found by <@{user_id}>"
    else:
        description = f"**{node_name}**"
    
    embed = discord.Embed(
        title=f"{type_icon} Detailed node info",
        description=description,
        color=discord.Color.blue()
    )
    
    # Public Key
    embed.add_field(name="Public Key", value=f"`{pub_key_display}`", inline=False)

    # Type
    embed.add_field(name="Type", value=type_text, inline=True)
    
    # City
    embed.add_field(name="City", value=city, inline=True)

    # Location (if showing coordinates)
    if show_coordinates:
        lat = node.get('adv_lat')
        lon = node.get('adv_lon')
        if lat is not None and lon is not None:
            embed.add_field(name="Location", value=f"`{lat}, {lon}`", inline=True)

    # Owner
    embed.add_field(name="Owner", value=owner, inline=True)
    
    # Frequency
    embed.add_field(name="Frequency", value=freq_display, inline=False)
    
    # MeshCore Link
    link = node.get('link')
    if link:
        embed.add_field(name="MeshCore Link", value=f"`{link}`", inline=False)
    
    # Inserted date
    inserted_date = node.get('inserted_date')
    if inserted_date:
        formatted_inserted = format_date_display(inserted_date)
        embed.add_field(name="Inserted Date", value=formatted_inserted, inline=True)
    
    # Updated date
    updated_date = node.get('updated_date')
    if updated_date:
        formatted_updated = format_date_display(updated_date)
        embed.add_field(name="Updated Date", value=formatted_updated, inline=True)
    
    # Last Advert Date (right before Last Discord Update)
    last_advert = node.get('last_advert')
    if last_advert:
        formatted_last_advert = format_date_display(last_advert)
        embed.add_field(name="Last Advert", value=formatted_last_advert, inline=True)
    
    # Last Discord Update
    if node.get('discord_updated_date'):
        formatted_date = format_date_display(node['discord_updated_date'])
        embed.add_field(name="Last Discord Update", value=formatted_date, inline=True)
       
    # Inserted by (public hex key)
    inserted_by = node.get('inserted_by')
    if inserted_by:
        embed.add_field(name="Inserted By", value=f"`{inserted_by.upper()}`", inline=True)
    
    # Updated by (public hex key)
    updated_by = node.get('updated_by')
    if updated_by:
        embed.add_field(name="Updated By", value=f"`{updated_by.upper()}`", inline=True)

    # Source (original upload location)
    source = node.get('source')
    if source:
        embed.add_field(name="Source", value=f"`{source.upper()}`", inline=True)
    
    # Footer - will be set by caller based on context
    # Don't set footer here, let the caller decide
    
    return embed


def get_most_recent_date(node: Dict[str, Any]) -> Optional[str]:
    """
    Get the most recent date from a node's date fields.
    Checks: inserted_date, updated_date, last_advert, discord_updated_date.
    All dates are interpreted as UTC (naive = UTC); result is shown in CET with timezone label.
    
    Args:
        node: Node dictionary.
    
    Returns:
        Most recent date as string in CET (e.g. "2026-01-02 19:45 CET"), or None if no dates found.
    """
    cet = ZoneInfo("Europe/Brussels")
    dates_utc = []
    for date_field in ['inserted_date', 'updated_date', 'last_advert', 'discord_updated_date']:
        date_val = node.get(date_field)
        if date_val:
            try:
                if isinstance(date_val, str):
                    s = date_val.replace('Z', '+00:00').split('.')[0]
                    if 'T' in s or '+' in s:
                        dt = datetime.fromisoformat(s)
                    else:
                        dt = datetime.strptime(s, '%Y-%m-%d %H:%M:%S')
                else:
                    dt = date_val
                if dt.tzinfo is None:
                    dt = dt.replace(tzinfo=timezone.utc)
                else:
                    dt = dt.astimezone(timezone.utc)
                dates_utc.append(dt)
            except (ValueError, TypeError, AttributeError):
                continue
    
    if dates_utc:
        most_recent_utc = max(dates_utc)
        dt_cet = most_recent_utc.astimezone(cet)
        return dt_cet.strftime('%Y-%m-%d %H:%M') + " " + dt_cet.tzname()
    return None


def format_node_simple(node: Dict[str, Any], show_coords: bool = False, show_owner: bool = False, include_map_link: bool = False) -> str:
    """
    Format a single node in the simplified format.
    
    Args:
        node: Node dictionary.
        show_coords: If True, show coordinates in parentheses.
        show_owner: If True, show Discord owner in subtitle.
        include_map_link: If True, add a "View on map" link line.
    
    Returns:
        Formatted string with 3 lines per node (4 if include_map_link).
    """
    # Ensure params are deserialized
    params = node.get('params', {})
    if isinstance(params, str):
        from backend.database import json_deserialize
        try:
            params = json_deserialize(params) or {}
        except Exception:
            params = {}
    elif params is None:
        params = {}
    
    # Line 1: Icon HEX HEAD - Node Name (- Owner if show_owner)
    icon = get_node_type_icon(node.get('type', 0))
    pub_key_display = truncate_public_key(node.get('public_key', ''), show_full=False)
    node_name = escape_discord_markdown(node.get('adv_name', 'Unknown'))
    
    line1 = f"{icon} `{pub_key_display}` - {node_name}"
    if show_owner:
        owner_id = node.get('discord_owner_id')
        if owner_id:
            line1 += f" - 👤 <@{owner_id}>"
        # If unclaimed, don't add anything (just end after node name)
    
    # Line 2: 📍 City (coords) | 📅 Most recent date
    city = node.get('city', 'Unknown')
    line2 = f"📍 {city}"
    if show_coords:
        lat = node.get('adv_lat')
        lon = node.get('adv_lon')
        if lat is not None and lon is not None:
            line2 += f" ({lat}, {lon})"
    line2 += " | 📅 "
    most_recent = get_most_recent_date(node)
    if most_recent:
        line2 += most_recent
    else:
        line2 += "N/A"
    
    # Line 3: 📻 Frequency: preset/custom | ℹ️ Source: source
    freq_display = format_frequency_display(params)
    # Remove "Preset: " prefix if present, keep the rest
    if freq_display.startswith("Preset: "):
        freq_display = freq_display[8:]  # Remove "Preset: " prefix
    source = node.get('source', 'N/A')
    if source:
        source_capitalized = source.capitalize()
    else:
        source_capitalized = 'N/A'
    line3 = f"📻 Frequency: {freq_display} | ℹ️ Source: {source_capitalized}"
    
    result = f"{line1}\n{line2}\n{line3}"
    if include_map_link:
        result += f"\n[View on map]({get_map_link(node)})"
    return result


def format_node_list(nodes: List[Dict[str, Any]], show_full_keys: bool = False) -> str:
    """
    Format list of nodes for display.
    Multiple results: Format: ICON HEX HEAD - NODE NAME
    
    Args:
        nodes: List of node dictionaries.
        show_full_keys: If True, show full public keys.
    
    Returns:
        Formatted string with node list.
    """
    if len(nodes) == 1:
        # Single node: format as simple text for list context
        # (format_full_node_details now returns an embed, so we format manually here)
        node = nodes[0]
        icon = get_node_type_icon(node.get('type', 0))
        pub_key_display = truncate_public_key(node.get('public_key', ''), show_full=show_full_keys)
        node_name = escape_discord_markdown(node.get('adv_name', 'Unknown'))
        return f"{icon} `{pub_key_display}` - {node_name}"
    else:
        # Multiple nodes: use simplified format
        lines = []
        for node in nodes:
            formatted = format_node_simple(node, show_coords=False, show_owner=True)
            lines.append(formatted)
        return "\n\n".join(lines)


def update_discord_updated_date(public_key: str) -> None:
    """
    Update the discord_updated_date field for a node.
    This tracks when the node was last modified via Discord bot commands.
    The official map's updated_date field is NOT modified.
    
    Args:
        public_key: Public key of the node to update (will be normalized to lowercase).
    """
    conn = get_connection()
    cursor = conn.cursor()
    
    try:
        # Normalize public key: remove spaces, dashes, convert to lowercase
        # This matches the normalization in get_node_by_key
        public_key_normalized = public_key.replace(' ', '').replace('-', '').lower()
        
        cursor.execute("""
            UPDATE belgian_nodes
            SET discord_updated_date = ?
            WHERE public_key = ?
        """, (get_current_timestamp(), public_key_normalized))
        conn.commit()
    except Exception as e:
        print(f"Error updating discord_updated_date for {public_key}: {e}")
        conn.rollback()
    finally:
        conn.close()


def get_map_link(node: Dict[str, Any]) -> str:
    """
    Generate map link for a node (direct link to node on map).
    
    Args:
        node: Node dictionary with public_key.
    
    Returns:
        URL to view node on map.
    """
    from urllib.parse import quote
    from config.config import MAP_BASE_URL
    base = MAP_BASE_URL.rstrip("/")
    pk = (node.get("public_key") or "").strip()
    if pk:
        return f"{base}/?node={quote(pk, safe='')}"
    return base


# ============================================================================
# Bot Instructions Post Feature
# ============================================================================

def load_bot_instructions() -> str:
    """
    Load bot instructions from DISCORDBOT_INSTRUCTIONS.md file.
    
    Returns:
        Instructions content as string.
    """
    # Try multiple possible paths (for local dev and Docker)
    possible_paths = [
        os.path.join(os.path.dirname(__file__), '..', 'DISCORDBOT_INSTRUCTIONS.md'),
        os.path.join(os.getcwd(), 'DISCORDBOT_INSTRUCTIONS.md'),
        '/app/DISCORDBOT_INSTRUCTIONS.md',  # Docker path
        'DISCORDBOT_INSTRUCTIONS.md',  # Current directory
    ]
    
    for instructions_path in possible_paths:
        try:
            abs_path = os.path.abspath(instructions_path)
            if os.path.exists(abs_path):
                with open(abs_path, 'r', encoding='utf-8') as f:
                    content = f.read()
                    print(f"Loaded bot instructions from: {abs_path}")
                    return content
        except Exception as e:
            continue
    
    # If all paths failed, return error message
    print(f"ERROR: Could not find DISCORDBOT_INSTRUCTIONS.md in any of these paths:")
    for path in possible_paths:
        print(f"  - {os.path.abspath(path)}")
    return "Bot instructions file (DISCORDBOT_INSTRUCTIONS.md) not found."


def resolve_custom_emojis_in_text(text: str, guild: Optional[discord.Guild]) -> str:
    """
    Replace :emoji_name: shortcodes with Discord custom emoji format <:name:id>
    (or <a:name:id> for animated) so server emojis render in the message.
    Standard Unicode emojis (e.g. :flag_be:) are left as-is.
    Replaces longer names first to avoid partial matches.
    """
    if not text or not guild:
        return text
    # Build list of (name, replacement) for all custom emojis, sort by name length desc
    replacements = []
    for emoji in guild.emojis:
        if emoji.animated:
            replacement = f"<a:{emoji.name}:{emoji.id}>"
        else:
            replacement = f"<:{emoji.name}:{emoji.id}>"
        replacements.append((emoji.name, replacement))
    replacements.sort(key=lambda x: -len(x[0]))  # longest first
    result = text
    for name, replacement in replacements:
        # Replace :name: only as whole shortcode (avoid replacing inside :longername:)
        result = result.replace(f":{name}:", replacement)
    return result


async def update_bot_instructions_post() -> None:
    """
    Update bot instructions post in Discord channel as an embed.
    Behavior:
    - If neither STARTUP_CHANNEL_ID nor STARTUP_MESSAGE_ID defined: Do nothing
    - If only STARTUP_CHANNEL_ID defined: Post placeholder message "PLACEHOLDER FOR BOT"
    - If both defined: Edit existing message with instructions from DISCORDBOT_INSTRUCTIONS.md as embed
    """
    channel_id = STARTUP_CHANNEL_ID
    message_id = STARTUP_MESSAGE_ID
    
    if not channel_id:
        # No channel configured, skip
        print("No STARTUP_CHANNEL_ID configured, skipping instructions post update")
        return
    
    try:
        channel = bot.get_channel(int(channel_id))
        if not channel:
            print(f"Warning: Channel {channel_id} not found")
            return
        
        # Load instructions from DISCORDBOT_INSTRUCTIONS.md
        instructions_content = load_bot_instructions()
        
        # Color #fcfb40 in decimal (yellow)
        embed_color = int('0xfcfb40', 16)
        
        # Process the markdown content - format sections, but include title/subtitle in description
        lines = instructions_content.split('\n')
        formatted_lines = []
        skip_next_blank = False
        
        for i, line in enumerate(lines):
            line_stripped = line.strip()
            
            # Include title and subtitle lines as-is (like old bot does)
            # Just include them in the description without special formatting
            if line_stripped.startswith('# '):
                # Include the line as-is (with emojis, etc.)
                formatted_lines.append(line)
                skip_next_blank = True  # Skip blank line after title only
                continue
            elif line_stripped.startswith('## '):
                # Include the line as-is (with emojis, etc.)
                formatted_lines.append(line)
                # Don't skip blank line after subtitle - we want to preserve spacing
                skip_next_blank = False
                continue
            
            # Skip footer lines (we'll handle separately if needed)
            if line_stripped.startswith('*') and line_stripped.endswith('*'):
                continue
            
            # Format section headers (###) to be bold but less prominent than title/subtitle
            if line_stripped.startswith('### '):
                section_title = line_stripped[4:].strip()
                # Add spacing before section (except first one)
                if formatted_lines and formatted_lines[-1].strip():
                    formatted_lines.append('')  # Blank line before section
                # Use regular bold (same as title/subtitle but they appear first so seem more important)
                formatted_lines.append(f'**{section_title}**')
                skip_next_blank = False
            else:
                # Preserve all other lines including blank lines
                if skip_next_blank and not line_stripped:
                    skip_next_blank = False
                    continue
                formatted_lines.append(line)
        
        # Join all lines, preserving spacing
        formatted_content = '\n'.join(formatted_lines)
        
        # Clean up excessive blank lines (more than 2 consecutive) but preserve spacing
        import re
        formatted_content = re.sub(r'\n{4,}', '\n\n\n', formatted_content)
        
        # Remove leading/trailing blank lines
        formatted_content = formatted_content.strip()
        
        # Truncate if needed (Discord description limit is 4096)
        truncation_notice = '\n\n... (content truncated)'
        max_length = 4096 - len(truncation_notice)
        
        if len(formatted_content) > max_length:
            # Truncate at last newline before limit
            truncated = formatted_content[:max_length]
            last_newline = truncated.rfind('\n')
            if last_newline > max_length - 100:  # If newline is reasonably close
                formatted_content = truncated[:last_newline] + truncation_notice
            else:
                formatted_content = truncated[:max_length] + truncation_notice
            print(f"Warning: Instructions truncated from {len(formatted_content)} to {max_length} characters")
        
        # Resolve server custom emojis (:radioactief:, :meshcore:, etc.) so they render
        guild = getattr(channel, 'guild', None)
        formatted_content = resolve_custom_emojis_in_text(formatted_content, guild)
        embed_title = resolve_custom_emojis_in_text(
            ":radioactief: Radio-Actieve Bot - :meshcore: MeshCore Node Beheer", guild
        )
        # Fallback if no guild or emojis not found (avoid showing raw :name: in title)
        if embed_title.startswith(":"):
            embed_title = "📡 Radio-Actieve Bot - MeshCore Node Beheer"
        
        # Create embed with everything in description (like old bot, but better formatted)
        embed = discord.Embed(
            title=embed_title,
            description=formatted_content,
            color=embed_color
        )
        
        if message_id:
            # Edit existing message
            try:
                message = await channel.fetch_message(int(message_id))
                await message.edit(content=None, embed=embed)
                print(f"✅ Updated bot instructions post: {message_id} (as embed)")
            except discord.NotFound:
                print(f"Warning: Message {message_id} not found, posting new message")
                await channel.send(embed=embed)
            except discord.Forbidden:
                print(f"Warning: No permission to edit message {message_id}")
            except discord.HTTPException as e:
                print(f"Error editing message: {e}")
                import traceback
                traceback.print_exc()
        else:
            # Post new placeholder message
            placeholder = "PLACEHOLDER FOR BOT"
            await channel.send(placeholder)
            print(f"Posted placeholder message in channel {channel_id}")
    except Exception as e:
        print(f"Error updating bot instructions post: {e}")
        import traceback
        traceback.print_exc()


# ============================================================================
# Bot Events
# ============================================================================

# ============================================================================
# Discord Bot Commands
# ============================================================================

# Create command groups
node_group = app_commands.Group(name="node", description="Manage node operations")

# Create choices for node types (must be defined before use in decorators)
node_type_choices = [
    app_commands.Choice(name="Companion", value="companion"),
    app_commands.Choice(name="Repeater", value="repeater"),
    app_commands.Choice(name="Room Server", value="room server"),
    app_commands.Choice(name="Sensor", value="sensor"),
]

# Create choices for frequency presets (must be defined before use in decorators)
frequency_preset_choices = [
    app_commands.Choice(name=preset['name'], value=preset['name'])
    for preset in FREQUENCY_PRESETS
]


class UnclaimConfirmView(discord.ui.View):
    """View for confirming unclaiming a node."""
    def __init__(self, node: Dict[str, Any], user_id: str):
        super().__init__(timeout=30.0)
        self.node = node
        self.user_id = user_id
        self.chosen = False
    
    async def on_timeout(self):
        """Disable all buttons and update message when view times out."""
        for item in self.children:
            item.disabled = True
        
        # Edit the message to show timeout
        # Check if message attribute exists (set by discord.py when view is attached)
        if hasattr(self, 'message') and self.message:
            try:
                # Get current embed
                embed = self.message.embeds[0] if self.message.embeds else None
                
                if embed:
                    # Add timeout notice to description
                    timeout_notice = "\n\n⏱️ **Decision time elapsed.**"
                    if embed.description:
                        embed.description += timeout_notice
                    else:
                        embed.description = timeout_notice
                    
                    await self.message.edit(embed=embed, view=self)
                else:
                    # No embed, just update content
                    timeout_notice = "\n\n⏱️ **Decision time elapsed.**"
                    content = self.message.content + timeout_notice if self.message.content else timeout_notice
                    await self.message.edit(content=content, view=self)
            except Exception as e:
                # If editing fails, just disable buttons (view is already disabled)
                print(f"Error editing message on timeout: {e}")
    
    async def interaction_check(self, interaction: discord.Interaction) -> bool:
        """Only allow the command issuer to interact."""
        if str(interaction.user.id) != self.user_id:
            await interaction.response.send_message("This prompt is not for you.", ephemeral=True)
            return False
        return True
    
    @discord.ui.button(label="Yes, Unclaim", style=discord.ButtonStyle.danger, emoji="✅")
    async def confirm_unclaim(self, interaction: discord.Interaction, button: discord.ui.Button):
        """Confirm unclaiming."""
        if self.chosen:
            return
        self.chosen = True
        
        # Disable all buttons
        for item in self.children:
            item.disabled = True
        
        await interaction.response.edit_message(view=self)
        
        # Remove ownership
        success = remove_ownership(self.node['public_key'], self.user_id)
        
        if not success:
            await interaction.followup.send(
                "❌ **Error unclaiming node. Please try again.**",
                ephemeral=True
            )
            log_command("NODE_UNCLAIM", interaction.user, self.node.get('adv_name', 'Unknown'), "FAILED: Database error")
            return
        
        # Note: remove_ownership() already updates discord_updated_date, so no need to call it again
        
        log_command("NODE_UNCLAIM", interaction.user, self.node.get('adv_name', 'Unknown'), f"SUCCESS: Unclaimed {self.node.get('adv_name', 'Unknown')}")
        node_name = self.node.get('adv_name', 'Unknown')
        type_icon = get_node_type_icon(self.node.get('type', 0))
        pub_key_display = truncate_public_key(self.node.get('public_key', ''), show_full=False)
        type_text = get_node_type_display(self.node.get('type', 0))
        city = self.node.get('city', 'Unknown')
        source = self.node.get('source', 'N/A')
        if source:
            source_capitalized = source.capitalize()
        else:
            source_capitalized = 'N/A'
        
        # Success - public (visible to channel) with embed (same format as /claim)
        embed = discord.Embed(
            title=f"{type_icon} Node Unclaimed",
            description=f"**{node_name}** `{pub_key_display}` ({type_text.lower()}) has been unclaimed by <@{self.user_id}>",
            color=discord.Color.orange()
        )
        
        # Inline 1: Public Key, Node Name, Node Type
        embed.add_field(name="Public Key", value=f"`{truncate_public_key(self.node.get('public_key', ''), show_full=True)}`", inline=True)
        embed.add_field(name="Node Name", value=node_name, inline=True)
        embed.add_field(name="Node Type", value=type_text, inline=True)
        
        # Inline 2: Location (just city), Source Type, Status
        embed.add_field(name="Location", value=city, inline=True)
        embed.add_field(name="Source Type", value=source_capitalized, inline=True)
        embed.add_field(name="Status", value="Unclaimed", inline=True)
        
        embed.set_footer(text="Use `/mynodes` to see your owned nodes, or `/node update` to change city.")
        
        await interaction.followup.send(embed=embed)
    
    @discord.ui.button(label="Cancel", style=discord.ButtonStyle.secondary, emoji="❌")
    async def cancel(self, interaction: discord.Interaction, button: discord.ui.Button):
        """Cancel unclaiming."""
        if self.chosen:
            return
        self.chosen = True
        
        # Disable all buttons
        for item in self.children:
            item.disabled = True
        
        await interaction.response.edit_message(
            content="❌ **Unclaim cancelled.**",
            view=self,
            embed=None
        )


# Search source filter: only App and Uploader (Discord is not searchable; app and web treated as App in DB).
search_source_choices = [
    app_commands.Choice(name="App", value="app"),
    app_commands.Choice(name="Uploader", value="uploader"),
]


@bot.tree.command(name="search", description="Search Belgian MeshCore nodes")
@app_commands.describe(
    query="Search by partial name, public key, or owner name",
    node_type="Filter by node type",
    city="Filter by city (partial match)",
    frequency_preset="Filter by frequency preset",
    owner="Filter by Discord owner (mention user for exact match, or search by name in query field)",
    claimed="Filter by claim status (true=claimed, false=unclaimed)",
    inactive="Show only deactivated nodes (default: false, shows only active nodes)",
    source="Filter by source: App or Uploader"
)
@app_commands.choices(node_type=node_type_choices, frequency_preset=frequency_preset_choices, source=search_source_choices)
async def search_nodes(
    interaction: discord.Interaction,
    query: Optional[str] = None,
    node_type: Optional[app_commands.Choice[str]] = None,
    city: Optional[str] = None,
    frequency_preset: Optional[app_commands.Choice[str]] = None,
    owner: Optional[discord.User] = None,
    claimed: Optional[bool] = None,
    inactive: Optional[bool] = None,
    source: Optional[app_commands.Choice[str]] = None
):
    """Search for Belgian MeshCore nodes with various filters."""
    has_query = query and str(query).strip()
    has_type = node_type is not None
    has_city = city and str(city).strip()
    has_freq = frequency_preset is not None
    has_owner = owner is not None
    has_claimed = claimed is not None
    has_inactive = inactive is not None
    has_source = source is not None
    if not any([has_query, has_type, has_city, has_freq, has_owner, has_claimed, has_inactive, has_source]):
        await interaction.response.send_message(
            "Provide at least one criterion: **query** (name, public key, or owner name), **node type**, **city**, **frequency preset**, **owner**, **claimed**, **inactive**, or **source** (App or Uploader).",
            ephemeral=True
        )
        log_command("SEARCH", interaction.user, None, "REJECTED: no search criteria")
        return

    type_num = None
    if node_type:
        node_type_value = node_type.value if isinstance(node_type, app_commands.Choice) else node_type
        type_num = get_node_type_number(node_type_value)
        if type_num is None:
            await interaction.response.send_message(
                f"Invalid node type: {node_type_value}. Valid types: companion, repeater, room server, sensor",
                ephemeral=True
            )
            log_command("SEARCH", interaction.user, query, f"ERROR: Invalid type {node_type_value}")
            return

    owner_id = str(owner.id) if owner else None
    frequency_preset_name = None
    if frequency_preset:
        frequency_preset_name = frequency_preset.value if isinstance(frequency_preset, app_commands.Choice) else frequency_preset
    source_value = None
    if source:
        source_value = source.value if isinstance(source, app_commands.Choice) else source
        if source_value and str(source_value).lower() == 'discord':
            await interaction.response.send_message(
                "You cannot filter by source **Discord**. Use **App** or **Uploader** only.",
                ephemeral=True
            )
            log_command("SEARCH", interaction.user, query, "REJECTED: source=discord")
            return

    nodes = query_nodes_substring(
        query=query,
        node_type=type_num,
        city=city,
        frequency_preset_name=frequency_preset_name,
        owner_id=owner_id,
        include_inactive=inactive if inactive else False,
        claimed=claimed,
        source=source_value,
        limit=50
    )

    result_count = len(nodes) if nodes else 0
    log_command("SEARCH", interaction.user, query, f"{result_count} nodes found")

    query_parts = []
    if query:
        query_parts.append(f"`{query}`")
    if node_type:
        node_type_value = node_type.value if isinstance(node_type, app_commands.Choice) else node_type
        query_parts.append(f"type: `{node_type_value}`")
    if city:
        query_parts.append(f"city: `{city}`")
    if frequency_preset_name:
        query_parts.append(f"frequency preset: `{frequency_preset_name}`")
    if owner:
        query_parts.append(f"owner: {owner.mention}")
    if source_value:
        source_label = "App" if source_value.lower() == 'app' else source_value.capitalize()
        query_parts.append(f"source: `{source_label}`")
    search_query_str = ", ".join(query_parts) if query_parts else "all nodes"

    if not nodes:
        embed = discord.Embed(
            title="🔍 Search Results",
            description=f"**Search result for:** {search_query_str}\n\nNo nodes found matching your criteria.",
            color=discord.Color.orange()
        )
        await interaction.response.send_message(embed=embed)
        return

    if len(nodes) == 1:
        node = nodes[0]
        if node.get('params') and isinstance(node.get('params'), str):
            from backend.database import json_deserialize
            try:
                node['params'] = json_deserialize(node['params']) or {}
            except Exception:
                node['params'] = {}
        elif 'params' not in node or node.get('params') is None:
            node['params'] = {}
        embed = format_full_node_details(node, show_coordinates=False, user_id=str(interaction.user.id))
        embed.description = f"**Search result for:** {search_query_str}\n\n{embed.description}"
        embed.add_field(name="View on Map", value=f"[Open on map]({get_map_link(node)})", inline=False)
        owner_id_val = node.get('discord_owner_id')
        if owner_id_val:
            embed.set_footer(text="If you're the owner, use `/node update` to edit city. Use `/mynodes` to see your owned nodes.")
        else:
            embed.set_footer(text="This node is unclaimed. Use `/node claim` to claim ownership. Use `/mynodes` to see your nodes.")
        await interaction.response.send_message(embed=embed)
    else:
        DISCORD_EMBED_DESC_LIMIT = 4096
        SAFE_BUFFER = 500
        total_nodes = len(nodes)
        header_text = f"**Search result for:** {search_query_str}\n\nFound **{total_nodes}** node(s):\n\n"

        formatted_nodes = []
        for node in nodes:
            if node.get('params') and isinstance(node.get('params'), str):
                from backend.database import json_deserialize
                try:
                    node['params'] = json_deserialize(node['params']) or {}
                except Exception:
                    node['params'] = {}
            elif 'params' not in node or node.get('params') is None:
                node['params'] = {}
            formatted_nodes.append(format_node_simple(node, show_coords=False, show_owner=True))

        chunks = []
        current_chunk = []
        max_allowed = DISCORD_EMBED_DESC_LIMIT - SAFE_BUFFER
        MAX_NODES_PER_CHUNK = 25
        EARLY_BREAK_BUFFER = 150

        for formatted_node in formatted_nodes:
            test_chunk = current_chunk + [formatted_node]
            test_content = "\n\n".join(test_chunk)
            test_description = header_text + test_content
            if len(test_description) > max_allowed or len(test_chunk) > MAX_NODES_PER_CHUNK or len(test_description) > (max_allowed - EARLY_BREAK_BUFFER):
                if current_chunk:
                    chunks.append(current_chunk)
                    current_chunk = [formatted_node]
                else:
                    current_chunk.append(formatted_node)
            else:
                current_chunk.append(formatted_node)
        if current_chunk:
            chunks.append(current_chunk)

        num_messages = len(chunks)
        first_chunk = chunks[0]
        first_response = "\n\n".join(first_chunk)
        description = header_text + first_response
        while len(description) > max_allowed and len(first_chunk) > 0:
            first_chunk = first_chunk[:-1]
            description = header_text + ("\n\n".join(first_chunk) if first_chunk else "*Error: No nodes fit*")
            if not first_chunk:
                break

        embed = discord.Embed(title="🔍 Search Results", description=description, color=discord.Color.blue())
        if num_messages > 1:
            embed.set_footer(text=f"Showing 1-{len(first_chunk)} of {total_nodes} | Use `/search` to refine, `/mynodes` for your nodes, `/node update` to change city.")
        else:
            embed.set_footer(text="Use `/search` to refine, `/mynodes` for your nodes, `/node update` to change city.")
        await interaction.response.send_message(embed=embed)

        for i in range(1, num_messages):
            chunk = chunks[i]
            start_idx = sum(len(chunks[j]) for j in range(i)) + 1
            followup_header = f"**Search result for:** {search_query_str}\n\n"
            chunk_response = "\n\n".join(chunk)
            followup_description = followup_header + chunk_response
            while len(followup_description) > max_allowed and len(chunk) > 0:
                chunk = chunk[:-1]
                followup_description = followup_header + ("\n\n".join(chunk) if chunk else "*Error: No nodes fit*")
                if not chunk:
                    break
            end_idx = start_idx + len(chunk) - 1 if chunk else start_idx
            followup_embed = discord.Embed(
                title="🔍 Search Results (continued)",
                description=followup_header + ("\n\n".join(chunk) if chunk else ""),
                color=discord.Color.blue()
            )
            followup_embed.set_footer(text=f"Showing {start_idx}-{end_idx} of {total_nodes} | Use `/search` to refine, `/mynodes` for your nodes.")
            await interaction.followup.send(embed=followup_embed)


@node_group.command(name="claim", description="Claim ownership of an existing unclaimed node")
@app_commands.describe(query="Node's partial name or partial public key")
async def node_claim(interaction: discord.Interaction, query: str):
    """Claim ownership of a Belgian MeshCore node."""
    # Search with substring matching
    nodes = query_nodes_substring(query=query, limit=25)
    
    # Log command
    result_count = len(nodes) if nodes else 0
    log_command("NODE_CLAIM", interaction.user, query, f"{result_count} nodes found")
    
    if not nodes:
        # Error - ephemeral (only to sender)
        await interaction.response.send_message(
            "Node not found in Belgian database.",
            ephemeral=True
        )
        return
    
    if len(nodes) > 1:
        # Multiple matches: show error with list - ephemeral (only to sender)
        # Limit to first 10 nodes to avoid Discord message length limit (2000 chars)
        max_nodes_to_show = 10
        nodes_to_show = nodes[:max_nodes_to_show]
        
        error_msg = f"**Multiple nodes found ({len(nodes)} total). Please be more specific:**\n\n"
        error_msg += format_node_list(nodes_to_show, show_full_keys=False)
        
        if len(nodes) > max_nodes_to_show:
            error_msg += f"\n\n*... and {len(nodes) - max_nodes_to_show} more. Please refine your search.*"
        
        await interaction.response.send_message(error_msg, ephemeral=True)
        return
    
    # Exactly 1 node: claim it
    node = nodes[0]
    
    # Check if already claimed
    if node.get('discord_owner_id'):
        current_owner = node.get('discord_owner_name', 'Unknown')
        await interaction.response.send_message(
            f"This node is already claimed by {current_owner}.",
            ephemeral=True
        )
        log_command("NODE_CLAIM", interaction.user, query, f"FAILED: Already claimed")
        return
    
    # Update ownership
    success = update_ownership(
        node['public_key'],
        str(interaction.user.id),
        interaction.user.name
    )
    
    if not success:
        await interaction.response.send_message(
            "Error claiming node. Please try again.",
            ephemeral=True
        )
        log_command("NODE_CLAIM", interaction.user, query, "FAILED: Database error")
        return
    
    # Note: update_ownership() already updates discord_updated_date, so no need to call it again
    
    log_command("NODE_CLAIM", interaction.user, query, f"SUCCESS: Claimed {node.get('adv_name', 'Unknown')}")
    node_name = node.get('adv_name', 'Unknown')
    type_icon = get_node_type_icon(node.get('type', 0))
    pub_key_display = truncate_public_key(node.get('public_key', ''), show_full=False)
    type_text = get_node_type_display(node.get('type', 0))
    city = node.get('city', 'Unknown')
    source = node.get('source', 'N/A')
    if source:
        source_capitalized = source.capitalize()
    else:
        source_capitalized = 'N/A'
    
    # Success - public (visible to channel) with embed
    embed = discord.Embed(
        title=f"{type_icon} Node Claimed",
        description=f"**{node_name}** `{pub_key_display}` ({type_text.lower()}) has been claimed by <@{interaction.user.id}>",
        color=discord.Color.green()
    )
    
    # Inline 1: Public Key, Node Name, Node Type
    embed.add_field(name="Public Key", value=f"`{truncate_public_key(node.get('public_key', ''), show_full=True)}`", inline=True)
    embed.add_field(name="Node Name", value=node_name, inline=True)
    embed.add_field(name="Node Type", value=type_text, inline=True)
    
    # Inline 2: Location (just city), Source Type, Claimed By
    embed.add_field(name="Location", value=city, inline=True)
    embed.add_field(name="Source Type", value=source_capitalized, inline=True)
    embed.add_field(name="Claimed By", value=f"<@{interaction.user.id}>", inline=True)
    
    embed.set_footer(text="Use `/mynodes` to see your owned nodes, or `/node update` to change city.")
    await interaction.response.send_message(embed=embed)


@bot.tree.command(name="mynodes", description="List all your claimed nodes")
async def mynodes(interaction: discord.Interaction):
    """List all nodes owned by the user (including inactive ones)."""
    nodes = get_user_nodes(str(interaction.user.id), include_inactive=True)
    log_command("MYNODES", interaction.user, result=f"{len(nodes)} nodes owned")
    
    if not nodes:
        # Private information - ephemeral (only to sender)
        embed = discord.Embed(
            title="Your registered Nodes (0)",
            description="You don't own any nodes.",
            color=discord.Color.orange()
        )
        await interaction.response.send_message(embed=embed, ephemeral=True)
        return
    
    # Format all nodes in simplified format
    formatted_nodes = []
    for node in nodes:
        # Ensure params are deserialized
        if node.get('params') and isinstance(node.get('params'), str):
            from backend.database import json_deserialize
            try:
                node['params'] = json_deserialize(node['params']) or {}
            except Exception:
                node['params'] = {}
        elif 'params' not in node or node.get('params') is None:
            node['params'] = {}
        
        formatted = format_node_simple(node, show_coords=True, show_owner=False, include_map_link=True)
        formatted_nodes.append(formatted)
    
    # Combine all formatted nodes
    nodes_text = "\n\n".join(formatted_nodes)
    
    # Create single embed
    embed = discord.Embed(
        title=f"Your registered Nodes ({len(nodes)})",
        description=f"Nodes registered to {interaction.user.mention}\n\n{nodes_text}",
        color=discord.Color.blue()
    )
    
    embed.set_footer(text="Use `/node update` to change city for any of your nodes.")
    
    # Send as single message (ephemeral)
    await interaction.response.send_message(embed=embed, ephemeral=True)


@node_group.command(name="update", description="Update city of an owned node")
@app_commands.describe(
    query="Node's partial name or partial public key (required)",
    city="New city (required)"
)
async def node_update(interaction: discord.Interaction, query: str, city: str):
    """Update the city of a node you own."""
    city = (city or "").strip()
    if not city:
        await interaction.response.send_message("Please provide a city.", ephemeral=True)
        return

    nodes = query_nodes_substring(query=query, limit=25)
    log_command("NODE_UPDATE", interaction.user, query, f"{len(nodes)} nodes found")

    if not nodes:
        await interaction.response.send_message("Node not found.", ephemeral=True)
        return

    if len(nodes) > 1:
        max_nodes_to_show = 10
        nodes_to_show = nodes[:max_nodes_to_show]
        error_msg = f"**Multiple nodes found ({len(nodes)} total). Please be more specific:**\n\n"
        error_msg += format_node_list(nodes_to_show, show_full_keys=False)
        if len(nodes) > max_nodes_to_show:
            error_msg += f"\n\n*... and {len(nodes) - max_nodes_to_show} more. Please refine your search.*"
        await interaction.response.send_message(error_msg, ephemeral=True)
        return

    node = nodes[0]
    if not verify_ownership(node['public_key'], str(interaction.user.id)):
        await interaction.response.send_message("You don't own this node.", ephemeral=True)
        return

    result = update_node_properties(
        public_key=node['public_key'],
        user_id=str(interaction.user.id),
        name=None,
        city=city,
        params=None,
        adv_lat=None,
        adv_lon=None
    )

    if not result.get('success'):
        error_msg = result.get('message', 'Error updating node. Please try again.')
        await interaction.response.send_message(f"❌ **Error:** {error_msg}", ephemeral=True)
        log_command("NODE_UPDATE", interaction.user, query, f"FAILED: {error_msg}")
        return

    changes = result.get('changes', {})
    node_name = node.get('adv_name', 'Unknown')
    type_icon = get_node_type_icon(node.get('type', 0))
    pub_key_display = truncate_public_key(node.get('public_key', ''), show_full=False)
    type_text = get_node_type_display(node.get('type', 0))

    embed = discord.Embed(
        title=f"{type_icon} Node Updated",
        description=f"**{node_name}** `{pub_key_display}` ({type_text.lower()}) has been updated by <@{interaction.user.id}>",
        color=discord.Color.green()
    )

    if 'city' in changes:
        old_city = changes['city'].get('old') or "N/A"
        new_city = changes['city'].get('new') or "N/A"
        embed.add_field(name="Changed Detail", value="City", inline=True)
        embed.add_field(name="Old Value", value=old_city, inline=True)
        embed.add_field(name="New Value", value=new_city, inline=True)
    else:
        embed.add_field(name="Changed Detail", value="No changes detected", inline=True)
        embed.add_field(name="Old Value", value="—", inline=True)
        embed.add_field(name="New Value", value="—", inline=True)

    embed.set_footer(text="Use `/mynodes` to see your owned nodes, or `/node update` to change city.")
    log_command("NODE_UPDATE", interaction.user, query, f"SUCCESS: Updated city to {city}")
    await interaction.response.send_message(embed=embed)


@node_group.command(name="unclaim", description="Remove ownership claim from a node")
@app_commands.describe(query="Node's partial name or partial public key")
async def node_unclaim(interaction: discord.Interaction, query: str):
    """Remove your ownership claim from a node."""
    # Search with substring matching - search both active and inactive nodes
    # First try active nodes
    nodes = query_nodes_substring(query=query, limit=25, include_inactive=False)
    # If no active nodes found, also search inactive nodes
    if not nodes:
        nodes = query_nodes_substring(query=query, limit=25, include_inactive=True)
    
    log_command("NODE_UNCLAIM", interaction.user, query, f"{len(nodes)} nodes found")
    
    if not nodes:
        # Error - ephemeral (only to sender)
        await interaction.response.send_message("Node not found.", ephemeral=True)
        return
    
    if len(nodes) > 1:
        # Error - ephemeral (only to sender)
        # Limit to first 10 nodes to avoid Discord message length limit (2000 chars)
        max_nodes_to_show = 10
        nodes_to_show = nodes[:max_nodes_to_show]
        
        error_msg = f"**Multiple nodes found ({len(nodes)} total). Please be more specific:**\n\n"
        error_msg += format_node_list(nodes_to_show, show_full_keys=False)
        
        if len(nodes) > max_nodes_to_show:
            error_msg += f"\n\n*... and {len(nodes) - max_nodes_to_show} more. Please refine your search.*"
        
        await interaction.response.send_message(error_msg, ephemeral=True)
        return
    
    # Verify ownership - include inactive nodes
    node = nodes[0]
    if not verify_ownership(node['public_key'], str(interaction.user.id), include_inactive=True):
        # Error - ephemeral (only to sender)
        await interaction.response.send_message(
            "You don't own this node.",
            ephemeral=True
        )
        return
    
    # Show confirmation prompt - use same format as detailed /search result
    # Ensure params are deserialized
    if node.get('params') and isinstance(node.get('params'), str):
        from backend.database import json_deserialize
        try:
            node['params'] = json_deserialize(node['params']) or {}
        except Exception:
            node['params'] = {}
    elif 'params' not in node or node.get('params') is None:
        node['params'] = {}
    
    # Use format_full_node_details with show_coordinates=True for owned nodes (ephemeral)
    embed = format_full_node_details(node, show_coordinates=True)
    
    # Update title and description for confirmation
    embed.title = "⚠️ Confirm Unclaim"
    embed.description = "Are you sure you want to unclaim this node?\n\n**This will remove your ownership and allow other members to claim it.**"
    embed.color = discord.Color.orange()
    
    # Remove footer (will be added by the view if needed)
    embed.set_footer(text="")
    
    view = UnclaimConfirmView(node, str(interaction.user.id))
    await interaction.response.send_message(embed=embed, view=view, ephemeral=True)


@bot.tree.command(name="stats", description="Show Belgian MeshCore node statistics (overview, cities, frequencies, source)")
async def stats(interaction: discord.Interaction):
    """Display merged statistics in a single overview embed."""
    stats_data = get_statistics()
    source_stats = get_source_statistics()
    log_command("STATS", interaction.user, result="Statistics displayed")

    type_labels = {1: "Companions", 2: "Repeaters", 3: "Room servers", 4: "Sensors"}
    type_icons = {1: "📱", 2: "📡", 3: "💾", 4: "🌡️"}
    total_nodes = stats_data.get("total_nodes", 0)
    total_cities = stats_data.get("total_cities", 0)
    total_users = stats_data.get("registered_users", 0)
    by_type = stats_data.get("by_type", {})

    # --- Embed 1: Summary (same grouping as web stats page: Network, Activity, Frequency presets, Claimed, Top cities) ---
    stats_title = ":flag_be::meshcore: #BEMesh MeshCore statistics :bar_chart:"
    guild = getattr(interaction, 'guild', None)
    stats_title = resolve_custom_emojis_in_text(stats_title, guild)
    embed1 = discord.Embed(
        title=stats_title,
        description="Overview of the Belgian MeshCore network statistics, from [#BEMesh Map](https://meshmap.radio-actief.be).",
        color=discord.Color.blue()
    )
    # Row 1: network size (nodes)
    embed1.add_field(
        name="\u200b",
        value=f"**{total_nodes}** Nodes",
        inline=False
    )
    # Row 2: Network, Activity, Claimed (3 columns)
    network_lines = []
    for t in [1, 2, 3, 4]:
        c = by_type.get(t, 0)
        if c > 0:
            network_lines.append(f"{type_labels.get(t, str(t))}: **{c}**")
    embed1.add_field(name="Network", value="\n".join(network_lines) or "—", inline=True)
    activity_lines = [
        f"24 hours: **{stats_data.get('active_24h', 0)}**",
        f"7 days: **{stats_data.get('active_7d', 0)}**",
        f"30 days: **{stats_data.get('active_30d', 0)}**",
    ]
    embed1.add_field(name="Activity *", value="\n".join(activity_lines), inline=True)
    claimed_lines = [
        f"Nodes claimed: **{stats_data.get('claimed_nodes', 0)}**",
        f"Discord users: **{total_users}**",
    ]
    embed1.add_field(name="Claimed", value="\n".join(claimed_lines), inline=True)

    # Row 3: cities count
    embed1.add_field(
        name="\u200b",
        value=f"Across **{total_cities}** cities",
        inline=False
    )

    # Row 4: Top cities (overall), Top cities (repeaters), Top cities (companions) (3 columns)
    top_overall = stats_data.get("top_cities", [])[:10]
    top_repeaters = stats_data.get("top_cities_repeaters", [])[:10]
    top_companions = stats_data.get("top_cities_companions", [])[:10]
    overall_lines = [f"{c['city']}: **{c['count']}**" for c in top_overall] if top_overall else ["—"]
    repeater_lines = [f"{c['city']}: **{c['count']}**" for c in top_repeaters] if top_repeaters else ["—"]
    companion_lines = [f"{c['city']}: **{c['count']}**" for c in top_companions] if top_companions else ["—"]
    embed1.add_field(name="Top cities", value="\n".join(overall_lines), inline=True)
    embed1.add_field(name="Top cities (repeaters only)", value="\n".join(repeater_lines), inline=True)
    embed1.add_field(name="Top cities (companions only)", value="\n".join(companion_lines), inline=True)

    # Row 5: Frequency presets, Source (2 columns)
    preset_counts = stats_data.get("frequency_presets", {})
    custom_count = stats_data.get("custom_frequency", 0)
    unknown_count = stats_data.get("unknown_frequency", 0)
    freq_lines = []
    for preset_name, count in sorted(preset_counts.items(), key=lambda x: x[1], reverse=True):
        freq_lines.append(f"{preset_name}: **{count}**")
    if custom_count > 0:
        freq_lines.append(f"Custom settings: **{custom_count}**")
    if unknown_count > 0:
        freq_lines.append(f"Unknown: **{unknown_count}**")
    embed1.add_field(name="Frequency presets", value="\n".join(freq_lines) if freq_lines else "—", inline=True)

    by_source = source_stats.get("by_source", {})
    total_src = source_stats.get("total", 0)
    merged = {}
    for s, cnt in by_source.items():
        key = s.lower() if s else ""
        if key == "web":
            merged["app"] = merged.get("app", 0) + cnt
        else:
            merged[key] = merged.get(key, 0) + cnt
    if merged and total_src > 0:
        source_labels = {"app": "App", "uploader": "Uploader", "unknown": "Unknown"}
        src_lines = [
            f"• **{source_labels.get(s, s.capitalize() if s else 'Unknown')}:** {cnt} ({cnt / total_src * 100:.1f}%)"
            for s, cnt in sorted(merged.items(), key=lambda x: x[1], reverse=True)
            if s != "discord"
        ]
        source_value = "\n".join(src_lines) + " **"
    else:
        source_value = "No data."
    embed1.add_field(name="Source type", value=source_value, inline=True)

    notes_value = (
        "_\\* Most recent of: inserted\\_date, updated\\_date, last\\_advert_\n"
        "_\\*\\* Uploader = nodes reported by companions running [uploader software](https://github.com/recrof/map.meshcore.dev-uploader); unreported nodes may be removed after 30 days inactivity._\n\n"
        "Full statistics online: [meshmap.radio-actief.be/stats](https://meshmap.radio-actief.be/stats)"
    )
    embed1.add_field(name="\u200b", value=notes_value, inline=False)
    embed1.set_footer(text="Made by the Radio-Actief.be community")
    await interaction.response.send_message(embed=embed1)


# Register command groups BEFORE on_ready
bot.tree.add_command(node_group)

# Debug: Verify commands are registered at module load time
def _debug_print_commands():
    """Debug function to print registered commands."""
    commands_list = list(bot.tree.get_commands())
    print(f"\n[DEBUG] Commands registered at module load: {len(commands_list)}")
    for cmd in commands_list:
        if isinstance(cmd, app_commands.Group):
            print(f"  - /{cmd.name} (group with {len(cmd.commands)} subcommands)")
            for subcmd in cmd.commands:
                print(f"    - /{cmd.name} {subcmd.name}")
        else:
            print(f"  - /{cmd.name}")

# Call debug function (will run when module is imported)
_debug_print_commands()


# ============================================================================
# Bot Events
# ============================================================================

@bot.event
async def on_ready():
    """Called when the bot is ready and connected to Discord."""
    print(f"Bot logged in as {bot.user} (ID: {bot.user.id})")
    print(f"Connected to {len(bot.guilds)} guild(s)")
    
    # Ensure database is initialized
    print("Initializing database...")
    init_database()
    print("Database ready.\n")
    
    # Wait a moment for Discord to fully register the bot
    import asyncio
    await asyncio.sleep(2)
    
    # Verify commands are registered BEFORE sync
    print(f"\n[PRE-SYNC] Commands in bot.tree:")
    pre_sync_commands = list(bot.tree.get_commands())
    print(f"  Found {len(pre_sync_commands)} command(s) registered")
    for cmd in pre_sync_commands:
        if isinstance(cmd, app_commands.Group):
            print(f"  - /{cmd.name} (group with {len(cmd.commands)} subcommands)")
            for subcmd in cmd.commands:
                print(f"    - /{cmd.name} {subcmd.name}")
        else:
            print(f"  - /{cmd.name}")
    
    if len(pre_sync_commands) == 0:
        print("  ⚠️ ERROR: No commands found in bot.tree before sync!")
        print("  Commands may not be registered properly.")
        return
    
    # Sync commands globally (works reliably, may take up to 1 hour to propagate)
    print(f"\n[SYNC] Syncing commands globally...")
    
    try:
        synced = await bot.tree.sync()
        print(f"✅ Synced {len(synced)} command(s) globally")
        
        if len(synced) == 0:
            print("  ⚠️  WARNING: Sync returned 0 commands!")
            print("  This might indicate:")
            print("    1. Bot may not have 'applications.commands' scope")
            print("    2. Rate limit may be active")
            print("    3. Commands may already be synced (wait for propagation)")
            print("\n  SOLUTION: Re-invite the bot with this URL:")
            print(f"    https://discord.com/api/oauth2/authorize?client_id={bot.user.id}&permissions=0&scope=bot%20applications.commands")
        else:
            print("  Successfully synced commands:")
            for cmd in synced:
                if hasattr(cmd, 'name'):
                    print(f"    - /{cmd.name}")
                else:
                    print(f"    - {cmd}")
            print("\n  ✅ Commands synced! They may take up to 1 hour to appear in all servers.")
            print("  Usually they appear within a few minutes. Try typing '/' in a channel.")
                        
    except discord.HTTPException as e:
        print(f"  ❌ HTTP Error during sync: {e}")
        print(f"  Status: {e.status}, Code: {e.code}")
        if e.status == 429:
            print("  Rate limited! Commands will sync automatically when rate limit expires.")
            print(f"  Retry after: {e.retry_after} seconds" if hasattr(e, 'retry_after') else "")
        elif e.status == 403:
            print("  Permission denied! Bot may need 'applications.commands' scope.")
            print("  Re-invite the bot with: &scope=bot%20applications.commands")
        else:
            import traceback
            traceback.print_exc()
    except Exception as e:
        print(f"  ❌ Error during sync: {e}")
        import traceback
        traceback.print_exc()
    
    # Update bot instructions post
    await update_bot_instructions_post()
    
    print("\n✅ Bot is ready!")


@bot.event
async def on_command_error(ctx, error):
    """Handle command errors."""
    if isinstance(error, commands.CommandNotFound):
        return  # Ignore unknown commands
    print(f"Command error: {error}")


# ============================================================================
# Main Entry Point
# ============================================================================

def main():
    """Main entry point for the Discord bot."""
    if not DISCORD_BOT_TOKEN:
        print("Error: DISCORD_BOT_TOKEN not set in environment variables")
        sys.exit(1)
    
    print("Starting Discord bot...")
    try:
        bot.run(DISCORD_BOT_TOKEN)
    except discord.LoginFailure:
        print("Error: Invalid Discord bot token")
        sys.exit(1)
    except Exception as e:
        print(f"Error starting bot: {e}")
        sys.exit(1)


if __name__ == '__main__':
    main()

