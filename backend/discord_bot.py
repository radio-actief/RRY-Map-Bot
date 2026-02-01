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
    get_recently_updated_nodes,
    query_nodes_substring,
    get_user_nodes,
    get_statistics,
    update_ownership,
    remove_ownership,
    update_node_properties,
    verify_ownership,
    register_node,
    can_delete_node,
    delete_node,
    get_node_by_key,
    claim_and_update_node,
    reactivate_and_claim_node
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


def format_node_simple(node: Dict[str, Any], show_coords: bool = False, show_owner: bool = False) -> str:
    """
    Format a single node in the simplified format.
    
    Args:
        node: Node dictionary.
        show_coords: If True, show coordinates in parentheses.
        show_owner: If True, show Discord owner in subtitle.
    
    Returns:
        Formatted string with 3 lines per node.
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
    
    return f"{line1}\n{line2}\n{line3}"


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
        # This matches the normalization in register_node and get_node_by_key
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
    Generate map link for a node.
    
    Args:
        node: Node dictionary.
    
    Returns:
        URL to view node on map.
    """
    # TODO: Update with actual map URL when web map is deployed
    return "https://map.axistem.eu"  # Placeholder


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
stats_group = app_commands.Group(name="stats", description="Show Belgian MeshCore node statistics")

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


# ============================================================================
# Interactive Button Views for Register Command
# ============================================================================

def compare_node_details(new_details: Dict[str, Any], existing_node: Dict[str, Any]) -> bool:
    """
    Compare new details with existing node to check if they match.
    
    Args:
        new_details: Dictionary with new node details from user input.
        existing_node: Dictionary with existing node from database.
    
    Returns:
        True if all relevant fields match, False otherwise.
    """
    # Compare name (case-insensitive)
    new_name = (new_details.get('adv_name') or new_details.get('name', '')).strip()
    existing_name = (existing_node.get('adv_name') or '').strip()
    if new_name.lower() != existing_name.lower():
        return False
    
    # Compare city (case-insensitive)
    new_city = (new_details.get('city') or '').strip()
    existing_city = (existing_node.get('city') or '').strip()
    if new_city.lower() != existing_city.lower():
        return False
    
    # Compare type
    new_type = new_details.get('type') or new_details.get('node_type')
    existing_type = existing_node.get('type')
    if new_type != existing_type:
        return False
    
    # Compare frequency parameters
    new_params = new_details.get('params', {}) or {}
    existing_params = existing_node.get('params')
    
    # Handle None or empty params
    if existing_params is None:
        existing_params = {}
    elif isinstance(existing_params, str):
        # Deserialize if needed
        from backend.database import json_deserialize
        existing_params = json_deserialize(existing_params) or {}
    elif not isinstance(existing_params, dict):
        existing_params = {}
    
    # Compare all frequency parameters
    for key in ['freq', 'sf', 'bw', 'cr']:
        new_val = new_params.get(key)
        existing_val = existing_params.get(key)
        
        # Handle None values
        if new_val is None and existing_val is None:
            continue  # Both None, they match
        if new_val is None or existing_val is None:
            return False  # One is None, the other is not
        
        # Handle float comparison with tolerance
        try:
            # Convert both to float for comparison
            new_float = float(new_val)
            existing_float = float(existing_val)
            if abs(new_float - existing_float) > 0.001:  # Small tolerance for float comparison
                return False
        except (ValueError, TypeError):
            # If conversion fails, do direct comparison
            if new_val != existing_val:
                return False
    
    # Compare latitude (handle None values)
    new_lat = new_details.get('adv_lat') or new_details.get('latitude')
    existing_lat = existing_node.get('adv_lat')
    if new_lat is not None and existing_lat is not None:
        try:
            if abs(float(new_lat) - float(existing_lat)) > 0.0001:  # Small tolerance for coordinates
                return False
        except (ValueError, TypeError):
            # If conversion fails, do direct comparison
            if new_lat != existing_lat:
                return False
    elif new_lat is not None or existing_lat is not None:
        # One is None, the other is not
        return False
    
    # Compare longitude (handle None values)
    new_lon = new_details.get('adv_lon') or new_details.get('longitude')
    existing_lon = existing_node.get('adv_lon')
    if new_lon is not None and existing_lon is not None:
        try:
            if abs(float(new_lon) - float(existing_lon)) > 0.0001:  # Small tolerance for coordinates
                return False
        except (ValueError, TypeError):
            # If conversion fails, do direct comparison
            if new_lon != existing_lon:
                return False
    elif new_lon is not None or existing_lon is not None:
        # One is None, the other is not
        return False
    
    # Compare link (handle None values, case-insensitive)
    new_link = (new_details.get('link') or '').strip()
    existing_link = (existing_node.get('link') or '').strip()
    if new_link.lower() != existing_link.lower():
        return False
    
    # All fields match
    return True


def format_node_details_for_choice(node: Dict[str, Any], node_type_num: Optional[int] = None) -> str:
    """
    Format node details for display in choice prompt.
    Shows: Type, Name, City, Location, Frequency, Link (if available).
    
    Args:
        node: Node dictionary or details dictionary.
        node_type_num: Node type number (if not in node dict).
    
    Returns:
        Formatted string with node details.
    """
    lines = []
    
    # Type
    type_num = node.get('type') or node_type_num
    if type_num:
        type_text = get_node_type_display(type_num)
        type_icon = get_node_type_icon(type_num)
        lines.append(f"**Type:** {type_icon} {type_text}")
    
    # Name
    name = node.get('adv_name') or node.get('name', 'N/A')
    lines.append(f"**Name:** `{name}`")
    
    # City
    city = node.get('city', 'N/A')
    lines.append(f"**City:** `{city}`")
    
    # Location (coordinates)
    lat = node.get('adv_lat') or node.get('latitude')
    lon = node.get('adv_lon') or node.get('longitude')
    if lat is not None and lon is not None:
        lines.append(f"**Location:** `{lat}, {lon}`")
    else:
        lines.append(f"**Location:** `N/A`")
    
    # Frequency
    params = node.get('params')
    # Ensure params is a dict - handle None, string, or invalid types
    if params is None:
        params = {}
    elif isinstance(params, str):
        # Deserialize JSON string
        from backend.database import json_deserialize
        try:
            params = json_deserialize(params) or {}
        except Exception:
            params = {}
    elif not isinstance(params, dict):
        # Invalid type, default to empty dict
        params = {}
    
    # Format frequency display (will show N/A if params is empty or invalid)
    freq_display = format_frequency_display(params)
    lines.append(f"**Frequency:** {freq_display}")
    
    # MeshCore Link
    link = node.get('link')
    if link:
        # Truncate long links
        link_display = link if len(link) <= 50 else link[:47] + "..."
        lines.append(f"**Link:** `{link_display}`")
    else:
        lines.append(f"**Link:** `N/A`")
    
    return "\n".join(lines)


class DetailsChoiceView(discord.ui.View):
    """View for choosing between existing and new details when claiming a node."""
    def __init__(self, public_key: str, user_id: str, username: str, new_details: Dict[str, Any], existing_node: Dict[str, Any], is_reactivating: bool = False):
        super().__init__(timeout=30.0)
        self.public_key = public_key
        self.user_id = user_id
        self.username = username
        self.new_details = new_details
        self.existing_node = existing_node
        self.is_reactivating = is_reactivating
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
    
    @discord.ui.button(label="Use Existing Details", style=discord.ButtonStyle.secondary, emoji="📋")
    async def use_existing(self, interaction: discord.Interaction, button: discord.ui.Button):
        """Use existing node details."""
        if self.chosen:
            return
        self.chosen = True
        
        # Disable all buttons
        for item in self.children:
            item.disabled = True
        
        await interaction.response.edit_message(view=self)
        
        # Claim/Reactivate with existing details
        if self.is_reactivating:
            result = reactivate_and_claim_node(
                self.public_key,
                self.user_id,
                self.username,
                use_new_details=False
            )
        else:
            result = claim_and_update_node(
                self.public_key,
                self.user_id,
                self.username,
                use_new_details=False
            )
        
        if result['success']:
            node = result['node']
            await self.send_success_message(interaction, node, "existing")
        else:
            await interaction.followup.send(
                f"❌ **Error:** {result.get('message', 'Unknown error.')}",
                ephemeral=True
            )
    
    @discord.ui.button(label="Use New Details", style=discord.ButtonStyle.primary, emoji="✨")
    async def use_new(self, interaction: discord.Interaction, button: discord.ui.Button):
        """Use newly entered details."""
        if self.chosen:
            return
        self.chosen = True
        
        # Disable all buttons
        for item in self.children:
            item.disabled = True
        
        await interaction.response.edit_message(view=self)
        
        # Claim/Reactivate with new details
        if self.is_reactivating:
            result = reactivate_and_claim_node(
                self.public_key,
                self.user_id,
                self.username,
                use_new_details=True,
                new_details=self.new_details
            )
        else:
            result = claim_and_update_node(
                self.public_key,
                self.user_id,
                self.username,
                use_new_details=True,
                new_details=self.new_details
            )
        
        if result['success']:
            node = result['node']
            await self.send_success_message(interaction, node, "new")
        else:
            await interaction.followup.send(
                f"❌ **Error:** {result.get('message', 'Unknown error.')}",
                ephemeral=True
            )
    
    async def send_success_message(self, interaction: discord.Interaction, node: Dict[str, Any], details_type: str):
        """Send success message after claiming/reactivating."""
        node_name = node.get('adv_name', 'Unknown')
        type_icon = get_node_type_icon(node.get('type', 0))
        pub_key_display_short = truncate_public_key(node.get('public_key', ''), show_full=False)
        type_text = get_node_type_display(node.get('type', 0))
        city = node.get('city', 'Unknown')
        source = node.get('source', 'N/A')
        if source:
            source_capitalized = source.capitalize()
        else:
            source_capitalized = 'N/A'
        
        action = "Reactivated and Claimed" if self.is_reactivating else "Claimed"
        title_text = "Node Reactivated and Claimed" if self.is_reactivating else "Node Claimed"
        
        # Success - same format as /claim
        embed = discord.Embed(
            title=f"{type_icon} {title_text}",
            description=f"**{node_name}** `{pub_key_display_short}` ({type_text.lower()}) has been {action.lower()} by <@{self.user_id}>",
            color=discord.Color.green()
        )
        
        # Inline 1: Public Key, Node Name, Node Type
        embed.add_field(name="Public Key", value=f"`{truncate_public_key(node.get('public_key', ''), show_full=True)}`", inline=True)
        embed.add_field(name="Node Name", value=node_name, inline=True)
        embed.add_field(name="Node Type", value=type_text, inline=True)
        
        # Inline 2: Location (just city), Source Type, Claimed By
        embed.add_field(name="Location", value=city, inline=True)
        embed.add_field(name="Source Type", value=source_capitalized, inline=True)
        embed.add_field(name="Claimed By", value=f"<@{self.user_id}>", inline=True)
        
        embed.set_footer(text="Use `/search` to see the updated node details, `/mynodes` to see your owned nodes, or `/node update` to update more details.")
        
        await interaction.followup.send(embed=embed)


class ReactivateConfirmView(discord.ui.View):
    """View for confirming reactivation of an inactive node."""
    def __init__(self, public_key: str, user_id: str, username: str, new_details: Dict[str, Any], existing_node: Dict[str, Any]):
        super().__init__(timeout=30.0)
        self.public_key = public_key
        self.user_id = user_id
        self.username = username
        self.new_details = new_details
        self.existing_node = existing_node
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
    
    @discord.ui.button(label="Yes, Reactivate", style=discord.ButtonStyle.success, emoji="✅")
    async def confirm_reactivate(self, interaction: discord.Interaction, button: discord.ui.Button):
        """Confirm reactivation."""
        if self.chosen:
            return
        self.chosen = True
        
        # Disable all buttons
        for item in self.children:
            item.disabled = True
        
        await interaction.response.edit_message(view=self)
        
        # Ensure existing_node params are deserialized for comparison
        if self.existing_node.get('params') and isinstance(self.existing_node.get('params'), str):
            from backend.database import json_deserialize
            try:
                self.existing_node['params'] = json_deserialize(self.existing_node['params']) or {}
            except Exception:
                self.existing_node['params'] = {}
        elif 'params' not in self.existing_node or self.existing_node.get('params') is None:
            self.existing_node['params'] = {}
        
        # Compare new details with existing node
        try:
            details_match = compare_node_details(self.new_details, self.existing_node)
        except Exception as e:
            # If comparison fails, log error and proceed to show choice prompt
            print(f"Error comparing node details for inactive node: {e}")
            log_command("NODE_REGISTER", interaction.user, f"public_key={self.public_key[:8]}...", f"WARNING: Comparison error for inactive node, showing choice prompt")
            details_match = False
        
        if details_match:
            # All details match - automatically reactivate and claim with existing details
            result = reactivate_and_claim_node(
                public_key=self.public_key,
                user_id=self.user_id,
                username=self.username,
                use_new_details=False,  # Use existing details
                new_details=None
            )
            
            if result['success']:
                node = result.get('node', self.existing_node)
                node_name = node.get('adv_name', 'Unknown')
                type_icon = get_node_type_icon(node.get('type', 0))
                pub_key_display_short = truncate_public_key(self.public_key, show_full=False)
                type_text = get_node_type_display(node.get('type', 0))
                city = node.get('city', 'Unknown')
                source = node.get('source', 'N/A')
                if source:
                    source_capitalized = source.capitalize()
                else:
                    source_capitalized = 'N/A'
                
                # Success - same format as /claim
                embed = discord.Embed(
                    title=f"{type_icon} Node Reactivated and Claimed",
                    description=f"**{node_name}** `{pub_key_display_short}` ({type_text.lower()}) has been reactivated and claimed by <@{self.user_id}>",
                    color=discord.Color.green()
                )
                
                # Inline 1: Public Key, Node Name, Node Type
                embed.add_field(name="Public Key", value=f"`{truncate_public_key(self.public_key, show_full=True)}`", inline=True)
                embed.add_field(name="Node Name", value=node_name, inline=True)
                embed.add_field(name="Node Type", value=type_text, inline=True)
                
                # Inline 2: Location (just city), Source Type, Claimed By
                embed.add_field(name="Location", value=city, inline=True)
                embed.add_field(name="Source Type", value=source_capitalized, inline=True)
                embed.add_field(name="Claimed By", value=f"<@{self.user_id}>", inline=True)
                
                embed.set_footer(text="Use `/search` to see the updated node details, `/mynodes` to see your owned nodes, or `/node update` to update more details.")
                
                await interaction.followup.send(embed=embed)
                log_command("NODE_REGISTER", interaction.user, f"public_key={self.public_key[:8]}...", f"SUCCESS: Reactivated and claimed with matching details")
                return
            else:
                await interaction.followup.send(
                    f"❌ **Error reactivating node:** {result.get('message', 'Unknown error.')}",
                    ephemeral=True
                )
                log_command("NODE_REGISTER", interaction.user, f"public_key={self.public_key[:8]}...", f"FAILED: {result.get('message', 'Unknown')}")
                return
        
        # Details don't match - show details choice view
        existing_details_text = format_node_details_for_choice(self.existing_node)
        new_details_text = format_node_details_for_choice(self.new_details, self.new_details.get('type') or self.new_details.get('node_type'))
        
        # Get node info for title
        existing_name = self.existing_node.get('adv_name', 'Unknown')
        existing_type_icon = get_node_type_icon(self.existing_node.get('type', 0))
        pub_key_display = truncate_public_key(self.public_key, show_full=False)
        
        embed = discord.Embed(
            title=f"📋 Choose Details",
            description=f"{existing_type_icon} **{existing_name}** `{pub_key_display}`\n\nThis node was previously removed from the official map. Which details would you like to use?",
            color=discord.Color.blue()
        )
        embed.add_field(name="📋 Existing Details", value=existing_details_text, inline=True)
        embed.add_field(name="✨ New Details", value=new_details_text, inline=True)
        
        view = DetailsChoiceView(
            self.public_key,
            self.user_id,
            self.username,
            self.new_details,
            self.existing_node,
            is_reactivating=True
        )
        await interaction.followup.send(embed=embed, view=view, ephemeral=True)
    
    @discord.ui.button(label="Cancel", style=discord.ButtonStyle.danger, emoji="❌")
    async def cancel(self, interaction: discord.Interaction, button: discord.ui.Button):
        """Cancel reactivation."""
        if self.chosen:
            return
        self.chosen = True
        
        # Disable all buttons
        for item in self.children:
            item.disabled = True
        
        await interaction.response.edit_message(
            content="❌ **Registration cancelled.**",
            view=self,
            embed=None
        )


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
        
        embed.set_footer(text="Use `/search` to see the updated node details, `/mynodes` to see your owned nodes, or `/node update` to update more details.")
        
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


class DeleteConfirmView(discord.ui.View):
    """View for confirming deletion of a node."""
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
    
    @discord.ui.button(label="Yes, Delete", style=discord.ButtonStyle.danger, emoji="🗑️")
    async def confirm_delete(self, interaction: discord.Interaction, button: discord.ui.Button):
        """Confirm deletion."""
        if self.chosen:
            return
        self.chosen = True
        
        # Disable all buttons
        for item in self.children:
            item.disabled = True
        
        await interaction.response.edit_message(view=self)
        
        # Delete the node
        result = delete_node(self.node['public_key'], self.user_id)
        
        if not result['success']:
            await interaction.followup.send(
                f"❌ **Error deleting node:** {result.get('message', 'Unknown error.')}",
                ephemeral=True
            )
            log_command("NODE_DELETE", interaction.user, self.node.get('adv_name', 'Unknown'), f"FAILED: {result.get('message', 'Unknown')}")
            return
        
        log_command("NODE_DELETE", interaction.user, self.node.get('adv_name', 'Unknown'), f"SUCCESS: Deleted {self.node.get('adv_name', 'Unknown')}")
        node_name = self.node.get('adv_name', 'Unknown')
        type_icon = get_node_type_icon(self.node.get('type', 0))
        
        # Success - same format as /claim
        pub_key_display_short = truncate_public_key(self.node.get('public_key', ''), show_full=False)
        type_text = get_node_type_display(self.node.get('type', 0))
        city = self.node.get('city', 'Unknown')
        source = self.node.get('source', 'N/A')
        if source:
            source_capitalized = source.capitalize()
        else:
            source_capitalized = 'N/A'
        
        embed = discord.Embed(
            title="🗑️ Node Deleted",
            description=f"**{node_name}** `{pub_key_display_short}` ({type_text.lower()}) has been deleted by <@{self.user_id}>",
            color=discord.Color.red()
        )
        
        # Inline 1: Public Key, Node Name, Node Type
        embed.add_field(name="Public Key", value=f"`{truncate_public_key(self.node.get('public_key', ''), show_full=True)}`", inline=True)
        embed.add_field(name="Node Name", value=node_name, inline=True)
        embed.add_field(name="Node Type", value=type_text, inline=True)
        
        # Inline 2: Location (just city), Source Type, Deleted By
        embed.add_field(name="Location", value=city, inline=True)
        embed.add_field(name="Source Type", value=source_capitalized, inline=True)
        embed.add_field(name="Deleted By", value=f"<@{self.user_id}>", inline=True)
        
        embed.set_footer(text="This node has been permanently removed from the database.")
        await interaction.followup.send(embed=embed)
    
    @discord.ui.button(label="Cancel", style=discord.ButtonStyle.secondary, emoji="❌")
    async def cancel(self, interaction: discord.Interaction, button: discord.ui.Button):
        """Cancel deletion."""
        if self.chosen:
            return
        self.chosen = True
        
        # Disable all buttons
        for item in self.children:
            item.disabled = True
        
        await interaction.response.edit_message(
            content="❌ **Deletion cancelled.**",
            view=self,
            embed=None
        )


# Create choices for source types
source_choices = [
    app_commands.Choice(name="Discord", value="discord"),
    app_commands.Choice(name="App", value="app"),
    app_commands.Choice(name="Uploader", value="uploader"),
    app_commands.Choice(name="Web", value="web"),
    app_commands.Choice(name="Unknown", value="unknown")
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
    source="Filter by source type"
)
@app_commands.choices(node_type=node_type_choices, frequency_preset=frequency_preset_choices, source=source_choices)
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
    # Convert node_type choice to number if provided
    type_num = None
    if node_type:
        # Extract value from Choice object if it's a Choice
        node_type_value = node_type.value if isinstance(node_type, app_commands.Choice) else node_type
        type_num = get_node_type_number(node_type_value)
        
        if type_num is None:
            await interaction.response.send_message(
                f"Invalid node type: {node_type_value}. Valid types: companion, repeater, room server, sensor",
                ephemeral=True
            )
            log_command("SEARCH", interaction.user, query, f"ERROR: Invalid type {node_type_value}")
            return
    
    # Get owner ID if Discord User object provided (exact match)
    # For partial owner name matching, users can search in the query field
    owner_id = str(owner.id) if owner else None
    
    # Extract frequency preset value if provided
    frequency_preset_name = None
    if frequency_preset:
        frequency_preset_name = frequency_preset.value if isinstance(frequency_preset, app_commands.Choice) else frequency_preset
    
    # Extract source value if provided
    source_value = None
    if source:
        source_value = source.value if isinstance(source, app_commands.Choice) else source
    
    # Query database with substring matching (get all results, we'll paginate in Discord)
    # Use a high limit to get all matching nodes, then split into Discord messages
    nodes = query_nodes_substring(
        query=query,
        node_type=type_num,
        city=city,
        frequency_preset_name=frequency_preset_name,
        owner_id=owner_id,
        include_inactive=inactive if inactive else False,
        claimed=claimed,
        source=source_value,
        limit=500  # High limit to get all results, we'll paginate in Discord messages
    )
    
    # Log command
    result_count = len(nodes) if nodes else 0
    log_command("SEARCH", interaction.user, query, f"{result_count} nodes found")
    
    # Build search query description
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
        # Map source value to display name (capitalize first letter)
        source_label = source_value.capitalize() if source_value != 'unknown' else 'Unknown'
        query_parts.append(f"source: `{source_label}`")
    
    search_query_str = ", ".join(query_parts) if query_parts else "all nodes"
    
    if not nodes:
        # No results - public response with embed
        embed = discord.Embed(
            title="🔍 Search Results",
            description=f"**Search result for:** {search_query_str}\n\nNo nodes found matching your criteria.",
            color=discord.Color.orange()
        )
        await interaction.response.send_message(embed=embed)
        return
    
    # If exactly 1 node: show full details as embed (replaces /info)
    if len(nodes) == 1:
        node = nodes[0]
        embed = format_full_node_details(node, show_coordinates=False, user_id=str(interaction.user.id))
        # Update description to include search query
        embed.description = f"**Search result for:** {search_query_str}\n\n{embed.description}"
        
        # Set footer based on node status
        owner_id = node.get('discord_owner_id')
        if owner_id:
            # Node is claimed - show edit instruction for owner
            embed.set_footer(text=f"If you're the owner, use `/node update` to edit this node. Use `/search` to see other nodes, or `/mynodes` to see your owned nodes.")
        else:
            # Node is unclaimed - show claim instruction
            embed.set_footer(text=f"This node is unclaimed. Use `/node claim` to claim ownership. Use `/search` to see other nodes.")
        
        await interaction.response.send_message(embed=embed)
    else:
        # Multiple nodes: paginate across multiple messages if needed
        # Discord embed description limit: 4096 characters
        # Note: Discord may count emojis, mentions, and markdown differently
        DISCORD_EMBED_DESC_LIMIT = 4096
        SAFE_BUFFER = 500  # Very large safety buffer (Discord counts emojis/mentions differently)
        
        total_nodes = len(nodes)
        
        # Build actual header text first to get accurate length
        header_text = f"**Search result for:** {search_query_str}\n\nFound **{total_nodes}** node(s):\n\n"
        
        # Format all nodes in simplified format (for search, show owner, no coords)
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
            
            formatted = format_node_simple(node, show_coords=False, show_owner=True)
            formatted_nodes.append(formatted)
        
        # Chunk nodes: test full description (header + content) before adding each node
        # Conservative approach: 500 char buffer + 25 node limit + early break at 150 chars before limit
        chunks = []
        current_chunk = []
        max_allowed = DISCORD_EMBED_DESC_LIMIT - SAFE_BUFFER
        MAX_NODES_PER_CHUNK = 25
        EARLY_BREAK_BUFFER = 150
        
        for formatted_node in formatted_nodes:
            # Test if adding this node would exceed any limit
            test_chunk = current_chunk + [formatted_node]
            test_content = "\n\n".join(test_chunk)
            test_description = header_text + test_content
            test_length = len(test_description)
            
            # Start new chunk if: exceeds length, exceeds node count, or getting close to limit
            should_start_new = (
                test_length > max_allowed or
                len(test_chunk) > MAX_NODES_PER_CHUNK or
                test_length > (max_allowed - EARLY_BREAK_BUFFER)
            )
            
            if should_start_new and current_chunk:
                chunks.append(current_chunk)
                current_chunk = [formatted_node]
            else:
                current_chunk.append(formatted_node)
        
        if current_chunk:
            chunks.append(current_chunk)
        
        num_messages = len(chunks)
        
        # Send first message - verify it fits
        first_chunk = chunks[0]
        first_response = "\n\n".join(first_chunk)
        description = header_text + first_response
        
        # Safety check: remove nodes until it fits
        while len(description) > max_allowed and len(first_chunk) > 0:
            first_chunk = first_chunk[:-1]
            if first_chunk:
                first_response = "\n\n".join(first_chunk)
                description = header_text + first_response
            else:
                description = header_text + "*Error: No nodes fit*"
                break
        
        # Create first embed
        embed = discord.Embed(
            title="🔍 Search Results",
            description=description,
            color=discord.Color.blue()
        )
        
        if num_messages > 1:
            embed.set_footer(text=f"Showing 1-{len(first_chunk)} of {total_nodes} | Use `/search` to see the updated node details, `/mynodes` to see your owned nodes, or `/node update` to update more details.")
        else:
            embed.set_footer(text="Use `/search` to see the updated node details, `/mynodes` to see your owned nodes, or `/node update` to update more details.")
        
        # Send first message
        await interaction.response.send_message(embed=embed)
        
        # Send follow-up messages if there are more results
        for i in range(1, num_messages):
            chunk = chunks[i]
            start_idx = sum(len(chunks[j]) for j in range(i)) + 1
            
            # Build description with length check
            followup_header = f"**Search result for:** {search_query_str}\n\n"
            chunk_response = "\n\n".join(chunk)
            followup_description = followup_header + chunk_response
            
            # Safety check: remove nodes until it fits
            while len(followup_description) > max_allowed and len(chunk) > 0:
                chunk = chunk[:-1]
                if chunk:
                    chunk_response = "\n\n".join(chunk)
                    followup_description = followup_header + chunk_response
                else:
                    followup_description = followup_header + "*Error: No nodes fit*"
                    break
            
            # Recalculate end_idx after potential node removal
            end_idx = start_idx + len(chunk) - 1 if chunk else start_idx
            
            # Create follow-up embed
            followup_embed = discord.Embed(
                title="🔍 Search Results (continued)",
                description=followup_description,
                color=discord.Color.blue()
            )
            followup_embed.set_footer(text=f"Showing {start_idx}-{end_idx} of {total_nodes} | Use `/search` to see the updated node details, `/mynodes` to see your owned nodes, or `/node update` to update more details.")
            
            # Send follow-up message
            await interaction.followup.send(embed=followup_embed)


@node_group.command(name="register", description="Register a new node (or modify and claim if already exists)")
@app_commands.describe(
    public_key="Public hex key (exactly 64 hexadecimal characters = 32 bytes)",
    name="Node name",
    node_type="Node type",
    city="City name",
    frequency_preset="Frequency preset",
    latitude="Latitude (optional)",
    longitude="Longitude (optional)",
    link="MeshCore link (optional)"
)
@app_commands.choices(node_type=node_type_choices, frequency_preset=frequency_preset_choices)
async def node_register(
    interaction: discord.Interaction,
    public_key: str,
    name: str,
    node_type: app_commands.Choice[str],
    city: str,
    frequency_preset: app_commands.Choice[str],
    latitude: Optional[float] = None,
    longitude: Optional[float] = None,
    link: Optional[str] = None
):
    """Register a new Belgian MeshCore node via Discord."""
    # Log command
    log_command("NODE_REGISTER", interaction.user, f"public_key={public_key[:8]}...", "Starting registration")
    
    # Extract values from choices
    node_type_value = node_type.value if isinstance(node_type, app_commands.Choice) else node_type
    frequency_preset_value = frequency_preset.value if isinstance(frequency_preset, app_commands.Choice) else frequency_preset
    
    # Convert node type text to number
    node_type_num = get_node_type_number(node_type_value)
    if node_type_num is None:
        await interaction.response.send_message(
            f"Invalid node type: {node_type_value}. Valid types: companion, repeater, room server, sensor.",
            ephemeral=True
        )
        log_command("NODE_REGISTER", interaction.user, f"public_key={public_key[:8]}...", "FAILED: Invalid node type")
        return
    
    # Prepare new details
    # Get preset params
    preset = None
    for p in FREQUENCY_PRESETS:
        if p['name'].lower() == frequency_preset_value.lower():
            preset = p
            break
    
    if not preset:
        await interaction.response.send_message(
            f"Invalid frequency preset: {frequency_preset_value}",
            ephemeral=True
        )
        return
    
    new_details = {
        'adv_name': name,
        'name': name,  # Also include as 'name' for format_node_details_for_choice
        'city': city,
        'params': {
            'freq': preset['freq'],
            'sf': preset['sf'],
            'bw': preset['bw'],
            'cr': preset['cr']
        },
        'adv_lat': latitude,
        'adv_lon': longitude,
        'latitude': latitude,  # Also include as 'latitude' for format_node_details_for_choice
        'longitude': longitude,  # Also include as 'longitude' for format_node_details_for_choice
        'link': link,
        'node_type': node_type_num,  # Include node type for formatting
        'type': node_type_num  # Also include as 'type' for format_node_details_for_choice
    }
    
    # Check if node already exists
    existing_node = get_node_by_key(public_key, include_inactive=True)
    
    if existing_node:
        # Node exists - handle different scenarios
        is_active = existing_node.get('is_active', 0) == 1
        is_claimed = existing_node.get('discord_owner_id') is not None
        
        if is_claimed:
            # Node is already claimed - check if user owns it
            existing_owner_id = existing_node.get('discord_owner_id')
            user_id_str = str(interaction.user.id)
            
            if existing_owner_id and str(existing_owner_id) == user_id_str:
                # User already owns this node
                node_name = existing_node.get('adv_name', 'Unknown')
                type_icon = get_node_type_icon(existing_node.get('type', 0))
                type_text = get_node_type_display(existing_node.get('type', 0))
                pub_key_display_short = truncate_public_key(public_key, show_full=False)
                city = existing_node.get('city', 'Unknown')
                
                embed = discord.Embed(
                    title=f"{type_icon} Node Already Owned",
                    description=f"**{node_name}** `{pub_key_display_short}` ({type_text.lower()})\n\nYou already own this node.",
                    color=discord.Color.blue()
                )
                # Inline 1: Public Key, Node Name, Node Type
                embed.add_field(name="Public Key", value=f"`{truncate_public_key(public_key, show_full=True)}`", inline=True)
                embed.add_field(name="Node Name", value=node_name, inline=True)
                embed.add_field(name="Node Type", value=type_text, inline=True)
                # Inline 2: Location (just city)
                embed.add_field(name="Location", value=city, inline=True)
                embed.set_footer(text="Use `/search` to see the updated node details, `/mynodes` to see your owned nodes, or `/node update` to update more details.")
                
                await interaction.response.send_message(embed=embed, ephemeral=True)
                log_command("NODE_REGISTER", interaction.user, f"public_key={public_key[:8]}...", "INFO: Node already owned by user")
                return
            else:
                # Node is claimed by someone else
                await interaction.response.send_message(
                    f"❌ **This node is already claimed by another user.**",
                    ephemeral=True
                )
                log_command("NODE_REGISTER", interaction.user, f"public_key={public_key[:8]}...", "FAILED: Node already claimed by another user")
                return
        
        if is_active:
            # Active but unclaimed - check if details match
            # Add node_type to new_details for comparison
            new_details['node_type'] = node_type_num
            new_details['type'] = node_type_num
            
            # Compare new details with existing node
            try:
                details_match = compare_node_details(new_details, existing_node)
            except Exception as e:
                # If comparison fails, log error and proceed to show choice prompt
                print(f"Error comparing node details: {e}")
                log_command("NODE_REGISTER", interaction.user, f"public_key={public_key[:8]}...", f"WARNING: Comparison error, showing choice prompt")
                details_match = False
            
            if details_match:
                # All details match - automatically claim with existing details
                result = claim_and_update_node(
                    public_key=public_key,
                    user_id=str(interaction.user.id),
                    username=interaction.user.name,
                    use_new_details=False,  # Use existing details
                    new_details=None
                )
                
                if result['success']:
                    node = result.get('node', existing_node)
                    node_name = node.get('adv_name', 'Unknown')
                    type_icon = get_node_type_icon(node.get('type', 0))
                    pub_key_display = truncate_public_key(public_key, show_full=False)
                    type_text = get_node_type_display(node.get('type', 0))
                    city = node.get('city', 'Unknown')
                    source = node.get('source', 'N/A')
                    if source:
                        source_capitalized = source.capitalize()
                    else:
                        source_capitalized = 'N/A'
                    
                    # Success - same format as /claim
                    embed = discord.Embed(
                        title=f"{type_icon} Node Claimed",
                        description=f"**{node_name}** `{pub_key_display}` ({type_text.lower()}) has been claimed by <@{interaction.user.id}>",
                        color=discord.Color.green()
                    )
                    
                    # Inline 1: Public Key, Node Name, Node Type
                    embed.add_field(name="Public Key", value=f"`{truncate_public_key(public_key, show_full=True)}`", inline=True)
                    embed.add_field(name="Node Name", value=node_name, inline=True)
                    embed.add_field(name="Node Type", value=type_text, inline=True)
                    
                    # Inline 2: Location (just city), Source Type, Claimed By
                    embed.add_field(name="Location", value=city, inline=True)
                    embed.add_field(name="Source Type", value=source_capitalized, inline=True)
                    embed.add_field(name="Claimed By", value=f"<@{interaction.user.id}>", inline=True)
                    
                    embed.set_footer(text="Use `/search` to see the updated node details, `/mynodes` to see your owned nodes, or `/node update` to update more details.")
                    
                    await interaction.response.send_message(embed=embed)
                    log_command("NODE_REGISTER", interaction.user, f"public_key={public_key[:8]}...", f"SUCCESS: Auto-claimed with matching details")
                    return
                else:
                    await interaction.response.send_message(
                        f"❌ **Error claiming node:** {result.get('message', 'Unknown error.')}",
                        ephemeral=True
                    )
                    log_command("NODE_REGISTER", interaction.user, f"public_key={public_key[:8]}...", f"FAILED: {result.get('message', 'Unknown')}")
                    return
            
            # Details don't match - ask to choose details
            # Ensure existing_node has properly deserialized params
            if existing_node.get('params') and isinstance(existing_node.get('params'), str):
                from backend.database import json_deserialize
                try:
                    existing_node['params'] = json_deserialize(existing_node['params']) or {}
                except Exception:
                    existing_node['params'] = {}
            
            existing_details_text = format_node_details_for_choice(existing_node)
            new_details_text = format_node_details_for_choice(new_details, node_type_num)
            
            # Get node info for title
            existing_name = existing_node.get('adv_name', 'Unknown')
            existing_type_icon = get_node_type_icon(existing_node.get('type', 0))
            pub_key_display = truncate_public_key(public_key, show_full=False)
            
            embed = discord.Embed(
                title=f"📋 Choose Details",
                description=f"{existing_type_icon} **{existing_name}** `{pub_key_display}`\n\nThis node is already in the database but unclaimed. Which details would you like to use?",
                color=discord.Color.blue()
            )
            embed.add_field(name="📋 Existing Details", value=existing_details_text, inline=True)
            embed.add_field(name="✨ New Details", value=new_details_text, inline=True)
            
            view = DetailsChoiceView(
                public_key,
                str(interaction.user.id),
                interaction.user.name,
                new_details,
                existing_node,
                is_reactivating=False
            )
            
            await interaction.response.send_message(embed=embed, view=view, ephemeral=True)
            return
        
        else:
            # Inactive node - always ask for confirmation before reactivating
            # Add node_type to new_details for later comparison
            new_details['node_type'] = node_type_num
            new_details['type'] = node_type_num
            
            # Ask to confirm reactivation
            embed = discord.Embed(
                title="⚠️ Inactive Node Detected",
                description=f"This node was previously removed from the official map.\n\n**Are you sure you want to reactivate it?**\n\nIt may have been deleted for a reason.",
                color=discord.Color.orange()
            )
            embed.add_field(name="Existing Node", value=f"Name: `{existing_node.get('adv_name', 'N/A')}`\nCity: `{existing_node.get('city', 'N/A')}`", inline=False)
            
            view = ReactivateConfirmView(
                public_key,
                str(interaction.user.id),
                interaction.user.name,
                new_details,
                existing_node
            )
            
            await interaction.response.send_message(embed=embed, view=view, ephemeral=True)
            return
    
    # Node doesn't exist - proceed with normal registration
    result = register_node(
        public_key=public_key,
        adv_name=name,
        node_type=node_type_num,
        city=city,
        frequency_preset_name=frequency_preset_value,
        user_id=str(interaction.user.id),
        username=interaction.user.name,
        adv_lat=latitude,
        adv_lon=longitude,
        link=link
    )
    
    if not result['success']:
        # Check if error is because node already exists (shouldn't happen, but handle gracefully)
        error_msg = result.get('message', 'Unknown error')
        if 'already exists' in error_msg.lower():
            # This shouldn't happen as we check before calling register_node, but handle it
            # Try to get the existing node and show appropriate message
            existing_node = get_node_by_key(public_key, include_inactive=True)
            if existing_node:
                await interaction.response.send_message(
                    f"❌ **This node already exists in the database.**\n\n"
                    f"Use `/node claim` to claim it if it's unclaimed, or `/node update` to update it if you own it.",
                    ephemeral=True
                )
            else:
                await interaction.response.send_message(
                    f"❌ **Error registering node:** {error_msg}",
                    ephemeral=True
                )
        else:
            await interaction.response.send_message(
                f"❌ **Error registering node:** {error_msg}",
                ephemeral=True
            )
        log_command("NODE_REGISTER", interaction.user, f"public_key={public_key[:8]}...", f"FAILED: {error_msg}")
        return
    
    # Success - show node details (same format as /claim)
    node = result['node']
    node_name = node.get('adv_name', 'Unknown')
    type_icon = get_node_type_icon(node.get('type', 0))
    type_text = get_node_type_display(node.get('type', 0))
    pub_key_display_short = truncate_public_key(public_key, show_full=False)
    city = node.get('city', 'Unknown')
    
    embed = discord.Embed(
        title=f"{type_icon} Node Registered",
        description=f"**{node_name}** `{pub_key_display_short}` ({type_text.lower()}) has been registered by <@{interaction.user.id}>",
        color=discord.Color.green()
    )
    
    # Inline 1: Public Key, Node Name, Node Type
    embed.add_field(name="Public Key", value=f"`{truncate_public_key(public_key, show_full=True)}`", inline=True)
    embed.add_field(name="Node Name", value=node_name, inline=True)
    embed.add_field(name="Node Type", value=type_text, inline=True)
    
    # Inline 2: Location (just city), Source Type, Registered By
    embed.add_field(name="Location", value=city, inline=True)
    embed.add_field(name="Source Type", value="Discord", inline=True)
    embed.add_field(name="Registered By", value=f"<@{interaction.user.id}>", inline=True)
    
    embed.set_footer(text="Use `/search` to see the updated node details, `/mynodes` to see your owned nodes, or `/node update` to update more details.")
    
    log_command("NODE_REGISTER", interaction.user, f"public_key={public_key[:8]}...", f"SUCCESS: Registered {node_name}")
    await interaction.response.send_message(embed=embed)


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
    
    embed.set_footer(text="Use `/search` to see the updated node details, `/mynodes` to see your owned nodes, or `/node update` to update more details.")
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
        
        formatted = format_node_simple(node, show_coords=True, show_owner=False)
        formatted_nodes.append(formatted)
    
    # Combine all formatted nodes
    nodes_text = "\n\n".join(formatted_nodes)
    
    # Create single embed
    embed = discord.Embed(
        title=f"Your registered Nodes ({len(nodes)})",
        description=f"Nodes registered to {interaction.user.mention}\n\n{nodes_text}",
        color=discord.Color.blue()
    )
    
    embed.set_footer(text="Use `/search` more precisely to get a detailed node view")
    
    # Send as single message (ephemeral)
    await interaction.response.send_message(embed=embed, ephemeral=True)


@node_group.command(name="update", description="Update owned node properties")
@app_commands.describe(
    query="Node's partial name or partial public key (required)",
    name="New node name (optional)",
    city="New city (optional)",
    latitude="Latitude (optional)",
    longitude="Longitude (optional)",
    preset="Frequency preset (optional, use dropdown to select)",
    freq="Custom frequency in MHz (optional, if not using preset)",
    sf="Spreading factor (optional, if not using preset)",
    bw="Bandwidth in kHz (optional, if not using preset)",
    cr="Coding rate (optional, if not using preset)"
)
@app_commands.choices(preset=frequency_preset_choices)
async def node_update(
    interaction: discord.Interaction,
    query: str,
    name: Optional[str] = None,
    city: Optional[str] = None,
    latitude: Optional[float] = None,
    longitude: Optional[float] = None,
    preset: Optional[app_commands.Choice[str]] = None,
    freq: Optional[float] = None,
    sf: Optional[int] = None,
    bw: Optional[float] = None,
    cr: Optional[int] = None
):
    """Update properties of a node you own."""
    # Search with substring matching
    nodes = query_nodes_substring(query=query, limit=25)
    
    log_command("NODE_UPDATE", interaction.user, query, f"{len(nodes)} nodes found")
    
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
    
    # Verify ownership
    node = nodes[0]
    if not verify_ownership(node['public_key'], str(interaction.user.id)):
        # Error - ephemeral (only to sender)
        await interaction.response.send_message(
            "You don't own this node.",
            ephemeral=True
        )
        return
    
    # Handle preset vs individual frequency params
    freq_params = None
    
    if preset:
        # Extract value from Choice object if it's a Choice
        preset_value = preset.value if isinstance(preset, app_commands.Choice) else preset
        
        # Check if individual params also provided (conflict)
        if freq is not None or sf is not None or bw is not None or cr is not None:
            await interaction.response.send_message(
                "Error: Cannot specify both preset and individual frequency parameters. "
                "Use either preset OR individual params, not both.",
                ephemeral=True
            )
            return
        
        # Find preset by name (case-insensitive)
        preset_obj = None
        for p in FREQUENCY_PRESETS:
            if p['name'].lower() == preset_value.lower():
                preset_obj = p
                break
        
        if not preset_obj:
            await interaction.response.send_message(
                f"Invalid preset name: {preset_value}",
                ephemeral=True
            )
            return
        
        freq_params = {
            'freq': preset_obj['freq'],
            'sf': preset_obj['sf'],
            'bw': preset_obj['bw'],
            'cr': preset_obj['cr']
        }
    elif freq is not None or sf is not None or bw is not None or cr is not None:
        # Use individual params if provided
        # Get current params to preserve missing values
        current_params = node.get('params', {})
        if isinstance(current_params, str):
            current_params = json_deserialize(current_params) or {}
        
        freq_params = current_params.copy()  # Start with current params
        
        if freq is not None:
            freq_params['freq'] = freq
        if sf is not None:
            freq_params['sf'] = sf
        if bw is not None:
            freq_params['bw'] = bw
        if cr is not None:
            freq_params['cr'] = cr
    
    # Update node properties
    result = update_node_properties(
        public_key=node['public_key'],
        user_id=str(interaction.user.id),
        name=name,
        city=city,
        params=freq_params,
        adv_lat=latitude,
        adv_lon=longitude
    )
    
    if not result.get('success'):
        error_msg = result.get('message', 'Error updating node. Please try again.')
        await interaction.response.send_message(
            f"❌ **Error:** {error_msg}",
            ephemeral=True
        )
        log_command("NODE_UPDATE", interaction.user, query, f"FAILED: {error_msg}")
        return
    
    changes = result.get('changes', {})
    node_name = node.get('adv_name', 'Unknown')
    type_icon = get_node_type_icon(node.get('type', 0))
    pub_key_display = truncate_public_key(node.get('public_key', ''), show_full=False)
    type_text = get_node_type_display(node.get('type', 0))
    
    # Success - public (visible to channel) with embed (same format as /claim)
    embed = discord.Embed(
        title=f"{type_icon} Node Updated",
        description=f"**{node_name}** `{pub_key_display}` ({type_text.lower()}) has been updated by <@{interaction.user.id}>",
        color=discord.Color.green()
    )
    
    # Show what was changed - Inline fields: Changed Detail, Old Value, New Value
    if changes:
        location_updated = False  # Track if location (coordinates) was updated
        change_fields = []
        
        for field, change_data in changes.items():
            old_val = change_data.get('old')
            new_val = change_data.get('new')
            
            # Handle coordinates first (they need special handling)
            if field == 'latitude' or field == 'longitude':
                # Coordinates are not shown in public messages for security
                # Track that location was updated, but only add once
                if not location_updated:
                    change_fields.append({
                        'field': 'Location',
                        'old': 'Hidden',
                        'new': 'Updated'
                    })
                    location_updated = True
                # Skip showing individual latitude/longitude values
                continue
            
            # Format field name and values
            field_display = field.capitalize()
            old_display = None
            new_display = None
            
            if field == 'name':
                field_display = "Name"
                old_display = str(old_val) if old_val is not None else "N/A"
                new_display = str(new_val) if new_val is not None else "N/A"
            elif field == 'city':
                field_display = "City"
                old_display = str(old_val) if old_val is not None else "N/A"
                new_display = str(new_val) if new_val is not None else "N/A"
            elif field == 'params':
                field_display = "Frequency"
                # Format frequency params
                old_preset = match_frequency_preset(old_val) if old_val else None
                new_preset = match_frequency_preset(new_val) if new_val else None
                
                if old_preset and new_preset:
                    old_display = f"{old_preset['name']} ({old_preset['freq']} MHz)"
                    new_display = f"{new_preset['name']} ({new_preset['freq']} MHz)"
                elif old_preset:
                    old_display = f"{old_preset['name']} ({old_preset['freq']} MHz)"
                    new_display = f"Custom: {new_val.get('freq', 'N/A')} MHz"
                elif new_preset:
                    old_display = f"Custom: {old_val.get('freq', 'N/A')} MHz" if old_val else "N/A"
                    new_display = f"{new_preset['name']} ({new_preset['freq']} MHz)"
                else:
                    old_display = f"Custom: {old_val.get('freq', 'N/A')} MHz" if old_val else "N/A"
                    new_display = f"Custom: {new_val.get('freq', 'N/A')} MHz" if new_val else "N/A"
            else:
                old_display = str(old_val) if old_val is not None else "N/A"
                new_display = str(new_val) if new_val is not None else "N/A"
            
            change_fields.append({
                'field': field_display,
                'old': old_display,
                'new': new_display
            })
        
        # Add fields in groups of 3 (Changed Detail, Old Value, New Value)
        for change in change_fields:
            embed.add_field(name="Changed Detail", value=change['field'], inline=True)
            embed.add_field(name="Old Value", value=change['old'], inline=True)
            embed.add_field(name="New Value", value=change['new'], inline=True)
    else:
        # No changes detected
        embed.add_field(name="Changed Detail", value="No changes detected", inline=True)
        embed.add_field(name="Old Value", value="—", inline=True)
        embed.add_field(name="New Value", value="—", inline=True)
    
    embed.set_footer(text="Use `/search` to see the updated node details, `/mynodes` to see your owned nodes, or `/node update` to update more details.")
    
    log_command("NODE_UPDATE", interaction.user, query, f"SUCCESS: Updated {node.get('adv_name', 'Unknown')} - {len(changes)} field(s) changed")
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


@node_group.command(name="delete", description="Permanently delete a node you own (Discord-registered or removed from official map only)")
@app_commands.describe(query="Node's partial name or partial public key")
async def node_delete(interaction: discord.Interaction, query: str):
    """Permanently delete a node you own. Only works for Discord-registered nodes or nodes removed from the official map."""
    # Search with substring matching - search both active and inactive nodes
    # First try active nodes
    nodes = query_nodes_substring(query=query, limit=25, include_inactive=False)
    # If no active nodes found, also search inactive nodes
    if not nodes:
        nodes = query_nodes_substring(query=query, limit=25, include_inactive=True)
    
    log_command("NODE_DELETE", interaction.user, query, f"{len(nodes)} nodes found")
    
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
    
    # Get the node
    node = nodes[0]
    
    # Check if node can be deleted
    check_result = can_delete_node(node['public_key'], str(interaction.user.id))
    
    if not check_result['can_delete']:
        # Error - ephemeral (only to sender)
        await interaction.response.send_message(
            f"❌ **Cannot delete node:** {check_result.get('reason', 'Unknown reason')}",
            ephemeral=True
        )
        log_command("NODE_DELETE", interaction.user, query, f"FAILED: {check_result.get('reason', 'Unknown')}")
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
    
    # Update title and description for confirmation (keep garbage icon and warning sign)
    embed.title = "🗑️ ⚠️ Confirm Deletion"
    embed.description = "**⚠️ WARNING: This action cannot be undone!**\n\nThis will permanently delete the node from the database."
    embed.color = discord.Color.red()
    
    # Remove footer (will be set by view if needed)
    embed.set_footer(text="")
    
    view = DeleteConfirmView(node, str(interaction.user.id))
    await interaction.response.send_message(embed=embed, view=view, ephemeral=True)


@bot.tree.command(name="stats", description="Show Belgian MeshCore node statistics")
async def stats(interaction: discord.Interaction):
    """Display statistics about Belgian MeshCore nodes."""
    stats_data = get_statistics()
    log_command("STATS", interaction.user, result="Statistics displayed")
    
    # Create embed
    embed = discord.Embed(
        title="📊 Belgian MeshCore Registry Statistics",
        description="Statistics of the [Belgian MeshCore Network](https://map.axistem.eu)",
        color=discord.Color.blue()
    )
    
    # Inline 1: Nodes
    nodes_text = f"Total: **{stats_data['total_nodes']}**\n"
    nodes_text += f"Claimed: **{stats_data.get('claimed_nodes', 0)}**\n"
    nodes_text += f"Unclaimed: **{stats_data.get('unclaimed_nodes', 0)}**"
    embed.add_field(name="📡 Nodes", value=nodes_text, inline=True)
    
    # Inline 1: Node Types
    type_labels = {
        1: "Companions",
        2: "Repeaters",
        3: "Room Servers",
        4: "Sensors"
    }
    type_lines = []
    for type_num in [1, 2, 3, 4]:
        count = stats_data['by_type'].get(type_num, 0)
        type_lines.append(f"{type_labels[type_num]}: **{count}**")
    types_text = "\n".join(type_lines) if type_lines else "None"
    embed.add_field(name="🔧 Node Types", value=types_text, inline=True)
    
    # Inline 1: Frequency Presets (3rd position)
    preset_counts = stats_data.get('frequency_presets', {})
    custom_count = stats_data.get('custom_frequency', 0)
    unknown_count = stats_data.get('unknown_frequency', 0)
    
    if preset_counts or custom_count > 0 or unknown_count > 0:
        freq_lines = []
        # Sort presets by count (descending) and show top 5
        sorted_presets = sorted(preset_counts.items(), key=lambda x: x[1], reverse=True)[:5]
        for preset_name, count in sorted_presets:
            freq_lines.append(f"{preset_name}: **{count}**")
        if custom_count > 0:
            freq_lines.append(f"Custom: **{custom_count}**")
        if unknown_count > 0:
            freq_lines.append(f"Unknown: **{unknown_count}**")
        
        if freq_lines:
            freq_text = "\n".join(freq_lines)
            embed.add_field(name="📻 Frequency Presets", value=freq_text, inline=True)
    
    # Inline 2: Most Covered Cities (first position)
    if stats_data.get('top_cities'):
        city_lines = []
        for city in stats_data['top_cities'][:5]:
            city_lines.append(f"{city['city']}: **{city['count']}**")
        cities_text = "\n".join(city_lines)
        embed.add_field(name="🌟 Most Covered Cities", value=cities_text, inline=True)
    
    # Inline 2: Coverage
    coverage_text = f"Cities: **{stats_data.get('total_cities', 0)}**"
    embed.add_field(name="📍 Coverage", value=coverage_text, inline=True)
    
    # Inline 2: Users
    users_text = f"Registered: **{stats_data.get('registered_users', 0)}**"
    embed.add_field(name="👥 Unique Users", value=users_text, inline=True)
    
    # Inline 3: Activity (first position)
    activity_text = f"Last 24 hours: **{stats_data.get('active_24h', 0)}**\n"
    activity_text += f"Last 7 days: **{stats_data.get('active_7d', 0) }**\n"
    activity_text += f"Last 30 days: **{stats_data.get('active_30d', 0)}**"
    embed.add_field(name="⚡ Recent Activity", value=activity_text, inline=True)
    
    # Footer - Discord embeds don't support markdown links in footer, use plain text
    embed.set_footer(text="Statistics from Official MeshCore map (map.meshcore.dev) merged with our Discord bot. Stats updated multiple times a day.")
    
    # Statistics - public (visible to channel)
    await interaction.response.send_message(embed=embed)


@bot.tree.command(name="stats-cities", description="List all cities with node counts")
async def stats_cities(interaction: discord.Interaction):
    """List all cities with nodes, sorted by node count."""
    from backend.discord_queries import get_cities_with_counts
    
    cities = get_cities_with_counts()
    log_command("STATS_CITIES", interaction.user, result=f"{len(cities)} cities found")
    
    if not cities:
        embed = discord.Embed(
            title="📍 Cities with Nodes",
            description="No cities found.",
            color=discord.Color.orange()
        )
        await interaction.response.send_message(embed=embed)
        return
    
    # Paginate if many cities (show top 30 per message)
    cities_per_page = 30
    total_cities = len(cities)
    
    # First page
    first_chunk = cities[:cities_per_page]
    city_lines = []
    for city_data in first_chunk:
        city_lines.append(f"• {city_data['city']}: **{city_data['count']}** nodes")
    
    embed = discord.Embed(
        title="📍 Cities with Nodes",
        description="\n".join(city_lines),
        color=discord.Color.blue()
    )
    
    if total_cities > cities_per_page:
        embed.set_footer(text=f"Showing 1-{len(first_chunk)} of {total_cities} cities")
    else:
        embed.set_footer(text=f"Total: {total_cities} cities")
    
    await interaction.response.send_message(embed=embed)
    
    # Send additional pages if needed
    if total_cities > cities_per_page:
        for i in range(cities_per_page, total_cities, cities_per_page):
            chunk = cities[i:i + cities_per_page]
            chunk_lines = []
            for city_data in chunk:
                chunk_lines.append(f"• {city_data['city']}: **{city_data['count']}** nodes")
            
            followup_embed = discord.Embed(
                description="\n".join(chunk_lines),
                color=discord.Color.blue()
            )
            followup_embed.set_footer(text=f"Showing {i+1}-{min(i+len(chunk), total_cities)} of {total_cities} cities")
            await interaction.followup.send(embed=followup_embed)


@bot.tree.command(name="stats-frequencies", description="Show frequency preset statistics by node type")
async def stats_frequencies(interaction: discord.Interaction):
    """Show frequency preset and custom frequency distribution broken down by node type."""
    from backend.discord_queries import get_frequency_stats_by_type
    
    stats_by_type = get_frequency_stats_by_type()
    log_command("STATS_FREQUENCIES", interaction.user, result="Frequency stats by type displayed")
    
    type_labels = {
        1: "📱 Companions",
        2: "📡 Repeaters",
        3: "💾 Room Servers",
        4: "🌡️ Sensors"
    }
    
    # Build description with sections for each type
    description_lines = []
    
    for type_num in [1, 2, 3, 4]:
        type_stats = stats_by_type.get(type_num, {'presets': {}, 'custom': 0, 'unknown': 0, 'total': 0})
        total = type_stats['total']
        
        if total == 0:
            continue  # Skip types with no nodes
        
        description_lines.append(f"\n{type_labels[type_num]} ({total} nodes)")
        
        # Show top presets (sorted by count, descending)
        presets = type_stats['presets']
        if presets:
            sorted_presets = sorted(presets.items(), key=lambda x: x[1], reverse=True)
            for preset_name, count in sorted_presets:
                description_lines.append(f"• {preset_name}: **{count}**")
        
        if type_stats['custom'] > 0:
            description_lines.append(f"• Custom: **{type_stats['custom']}**")
        
        if type_stats['unknown'] > 0:
            description_lines.append(f"• Unknown: **{type_stats['unknown']}**")
    
    if not description_lines:
        embed = discord.Embed(
            title="📻 Frequency Statistics by Node Type",
            description="No nodes found.",
            color=discord.Color.orange()
        )
    else:
        embed = discord.Embed(
            title="📻 Frequency Statistics by Node Type",
            description="\n".join(description_lines),
            color=discord.Color.blue()
        )
    
    await interaction.response.send_message(embed=embed)


@bot.tree.command(name="stats-source", description="Show node statistics by source type")
async def stats_source(interaction: discord.Interaction):
    """Show statistics about nodes grouped by source type."""
    from backend.discord_queries import get_source_statistics
    
    source_stats = get_source_statistics()
    log_command("STATS_SOURCE", interaction.user, result="Source statistics displayed")
    
    by_source = source_stats.get('by_source', {})
    total = source_stats.get('total', 0)
    
    if not by_source:
        embed = discord.Embed(
            title="📊 Node Statistics by Source",
            description="No nodes found.",
            color=discord.Color.orange()
        )
        await interaction.response.send_message(embed=embed)
        return
    
    # Format source names (capitalize first letter)
    source_labels = {
        'discord': 'Discord',
        'app': 'App',
        'uploader': 'Uploader',
        'web': 'Web',
        'Unknown': 'Unknown'
    }
    
    # Build description with source counts
    description_lines = []
    for source, count in sorted(by_source.items(), key=lambda x: x[1], reverse=True):
        source_label = source_labels.get(source, source.capitalize() if source else 'Unknown')
        percentage = (count / total * 100) if total > 0 else 0
        description_lines.append(f"• **{source_label}:** {count} ({percentage:.1f}%)")
    
    description = "\n".join(description_lines)
    
    embed = discord.Embed(
        title="📊 Node Statistics by Source",
        description=description,
        color=discord.Color.blue()
    )
    
    embed.add_field(name="Total Active Nodes", value=str(total), inline=False)
    embed.set_footer(text="Source indicates where the node was originally registered")
    
    await interaction.response.send_message(embed=embed)


@bot.tree.command(name="recent", description="List recently added and updated nodes (last 24 hours)")
async def recent_nodes(interaction: discord.Interaction):
    """List recently added and updated nodes based on the most recent of 4 date types (last 24 hours, max 25 nodes)."""
    # Get recently updated nodes (last 24 hours, max 25)
    nodes = get_recently_updated_nodes(limit=25, days=1)
    
    # Log command
    log_command("RECENT", interaction.user, "last 24 hours", f"{len(nodes)} nodes found")
    
    if not nodes:
        embed = discord.Embed(
            title="🕒 Recently Updated Nodes (Last 24 Hours)",
            description="No nodes were updated in the last 24 hours.",
            color=discord.Color.orange()
        )
        embed.set_footer(text="Based on most recent of: inserted_date, updated_date, last_advert, discord_updated_date")
        await interaction.response.send_message(embed=embed)
        return
    
    # Format all nodes in simplified format (same as /search: show owner, no coords)
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
        
        formatted = format_node_simple(node, show_coords=False, show_owner=True)
        formatted_nodes.append(formatted)
    
    # Combine all formatted nodes
    node_list = "\n\n".join(formatted_nodes)
    
    # Create embed
    embed = discord.Embed(
        title="🕒 Recently Updated Nodes (Last 24 Hours)",
        description=f"Showing **{len(nodes)}** most recently updated node(s):\n\n{node_list}",
        color=discord.Color.blue()
    )
    
    embed.set_footer(text="Based on most recent of: inserted_date, updated_date, last_advert, discord_updated_date")
    
    # Public response (visible to channel)
    await interaction.response.send_message(embed=embed)


# Register command groups BEFORE on_ready
bot.tree.add_command(node_group)
# Note: stats_group is NOT registered because we use top-level /stats command
# The stats_group is kept for code organization but subcommands are registered separately

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

