"""
Discord Bot for RRY-Map-Bot
Handles all Discord bot functionality including commands and interactions.
"""

import asyncio
import re
import sys
import os
import time
import traceback
from datetime import datetime, time as dtime, timezone
from zoneinfo import ZoneInfo
from typing import Optional, Dict, Any, List, Tuple

import discord
from discord import app_commands
from discord.ext import tasks

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
        FREQUENCY_PRESETS,
        DAILY_DIGEST_ENABLED,
        DAILY_DIGEST_HOUR,
        DAILY_DIGEST_MINUTE,
        DAILY_DIGEST_TZ,
    )
except (ImportError, ModuleNotFoundError):
    # Fallback if config not available
    DISCORD_BOT_TOKEN = os.getenv('DISCORD_BOT_TOKEN')
    DISCORD_GUILD_ID = os.getenv('DISCORD_GUILD_ID')
    STARTUP_CHANNEL_ID = os.getenv('STARTUP_CHANNEL_ID')
    STARTUP_MESSAGE_ID = os.getenv('STARTUP_MESSAGE_ID')
    DAILY_DIGEST_ENABLED = os.getenv('DAILY_DIGEST_ENABLED', '1').strip() in ('1', 'true', 'True', 'yes', 'YES')
    DAILY_DIGEST_HOUR = int(os.getenv('DAILY_DIGEST_HOUR', '9'))
    DAILY_DIGEST_MINUTE = int(os.getenv('DAILY_DIGEST_MINUTE', '0'))
    DAILY_DIGEST_TZ = os.getenv('DAILY_DIGEST_TZ', 'Europe/Brussels')

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

from backend.discord_branding import apply_brand_to_embed
from backend.discord_formatting import (
    BEMESH,
    DISCORD_EMBED_DESC_LIMIT,
    build_claim_embed_dict,
    build_search_summary,
    build_unclaim_embed_dict,
    dict_to_discord_embed,
    ensure_node_params,
    fit_lines,
    format_full_node_details as _format_full_node_details,
    format_node_line,
    get_map_base_url,
    get_map_link,
    get_node_type_icon,
    get_stats_url,
    strip_backticks,
)
from backend.database import (
    init_database,
    get_connection,
    get_sync_state,
    set_sync_state,
)

from backend.discord_queries import (
    city_suggestions,
    count_nodes_substring,
    query_nodes_substring,
    get_user_nodes,
    record_command,
    search_owned_nodes,
    unclaimed_node_suggestions,
    update_ownership,
    remove_ownership,
    get_statistics,
    get_source_statistics,
)

GENERIC_ERROR = "Something went wrong — try again in a minute."
NOT_IN_SERVER = f"Claiming only works inside the {BEMESH} Discord server."

# Server (custom) emojis used in bot texts as :name:. Unicode emoji are written
# as the characters themselves: Discord does not turn :shortcodes: sent by a
# bot into emoji.
SERVER_EMOJI_NAMES = ("radioactief", "meshcore")

# /search offers the presets used in Belgium; any preset name still works.
SEARCH_PRESET_NAMES = (
    "EU/UK (Narrow)",
    "EU/UK (Long Range)",
    "EU/UK (Medium Range)",
    "EU 433MHz (Long Range)",
)

SEARCH_FETCH_LIMIT = 50  # nodes fetched (relevance-sorted) for a search page
PICK_LIST_MAX = 10  # nodes listed when a claim/unclaim query matches several
AUTOCOMPLETE_MAX = 25  # Discord's limit
MY_NODES_CUSTOM_ID = "rrymap:mynodes"

COLOR_INFO = discord.Color.blue()
COLOR_WARN = discord.Color.orange()
COLOR_OK = discord.Color.green()


# ============================================================================
# Bot, command tree and command log
# ============================================================================

# interaction id -> monotonic start time (application commands only)
_command_started: Dict[int, float] = {}


class CommandLogTree(app_commands.CommandTree):
    """Command tree that remembers when each slash command started (for ``command_log``)."""

    async def interaction_check(self, interaction: discord.Interaction) -> bool:
        if interaction.type is discord.InteractionType.application_command:
            _command_started[interaction.id] = time.monotonic()
        return True


class MapBot(discord.Client):
    """Slash commands only: default intents, no message content, no prefix commands."""

    def __init__(self) -> None:
        super().__init__(intents=discord.Intents.default())
        self.tree = CommandLogTree(self)

    async def setup_hook(self) -> None:
        # "My nodes" buttons keep working on messages sent before a restart.
        self.add_view(LinksView(my_nodes=True))


async def run_db(fn, *args, **kwargs):
    """Run blocking database work off the event loop."""
    return await asyncio.to_thread(fn, *args, **kwargs)


def _elapsed_ms(interaction: discord.Interaction) -> Optional[int]:
    started = _command_started.pop(interaction.id, None)
    if started is None:
        return None
    return int((time.monotonic() - started) * 1000)


async def log_command_result(
    interaction: discord.Interaction,
    command_name: str,
    *,
    ok: bool,
    duration_ms: Optional[int] = None,
) -> None:
    """Print one line and append a ``command_log`` row (no arguments are stored)."""
    if duration_ms is None:
        duration_ms = _elapsed_ms(interaction)
    user_id = str(interaction.user.id)
    stamp = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S")
    print(f"[{stamp} UTC] [{command_name}] user {user_id} {'ok' if ok else 'error'} {duration_ms} ms")
    try:
        await run_db(record_command, command_name, user_id, ok=ok, duration_ms=duration_ms)
    except Exception as e:
        print(f"[command_log] could not record {command_name}: {e}")


async def send_error_reply(interaction: discord.Interaction, text: str = GENERIC_ERROR) -> None:
    """Answer an interaction that failed: short, only for the user, no internals."""
    try:
        if interaction.response.is_done():
            await interaction.followup.send(text, ephemeral=True)
        else:
            await interaction.response.send_message(text, ephemeral=True)
    except discord.HTTPException as e:
        print(f"Could not send the error reply: {e}")


bot = MapBot()


@bot.tree.error
async def on_app_command_error(interaction: discord.Interaction, error: app_commands.AppCommandError) -> None:
    """One handler for every slash command error: log the traceback, answer briefly."""
    command = interaction.command
    name = command.qualified_name if command else "unknown"
    if isinstance(error, app_commands.CheckFailure):
        text = "You can't use this command here."
    else:
        text = GENERIC_ERROR
        original = getattr(error, "original", error)
        print(f"[{name}] command error:")
        traceback.print_exception(type(original), original, original.__traceback__)
    await log_command_result(interaction, name, ok=False)
    await send_error_reply(interaction, text)


@bot.event
async def on_app_command_completion(interaction: discord.Interaction, command) -> None:
    await log_command_result(interaction, command.qualified_name, ok=True)


# ============================================================================
# Helper Functions
# ============================================================================

def branded_embed(*args, **kwargs):
    return apply_brand_to_embed(discord.Embed(*args, **kwargs))


def notice_embed(text: str, color: discord.Color = COLOR_WARN, title: Optional[str] = None) -> discord.Embed:
    """Short reply as an embed (links in it never unfurl, mentions never ping)."""
    return branded_embed(title=title, description=text, color=color)


def format_full_node_details(node: Dict[str, Any], show_coordinates: bool = False) -> discord.Embed:
    return _format_full_node_details(node, branded_embed, show_coordinates)


def build_claim_embed(node: Dict[str, Any], user_id: str) -> discord.Embed:
    return dict_to_discord_embed(build_claim_embed_dict(node, user_id, via_web=False), branded_embed)


def build_unclaim_embed(node: Dict[str, Any], user_id: str) -> discord.Embed:
    return dict_to_discord_embed(build_unclaim_embed_dict(node, user_id, via_web=False), branded_embed)


def get_node_type_number(type_text: str) -> Optional[int]:
    """Convert node type text to number (case-insensitive)."""
    return NODE_TYPES_REVERSE.get(type_text.lower())


def find_frequency_preset_name(value: Optional[str]) -> Optional[str]:
    """The preset's own name for ``value`` (any known preset, any case), else None."""
    if not value:
        return None
    wanted = str(value).strip().lower()
    for preset in FREQUENCY_PRESETS:
        if preset['name'].lower() == wanted:
            return preset['name']
    return None


def _choice_value(value: Any) -> Any:
    return value.value if isinstance(value, app_commands.Choice) else value


def is_home_guild_member(interaction: discord.Interaction) -> bool:
    """True when the command comes from a member, inside the configured server.

    Same rule as the website's claim check: only members of ``DISCORD_GUILD_ID``
    may claim. A guild interaction carries the member, so no extra API call.
    """
    if interaction.guild_id is None or not isinstance(interaction.user, discord.Member):
        return False
    return not DISCORD_GUILD_ID or str(interaction.guild_id) == str(DISCORD_GUILD_ID)


def autocomplete_label(node: Dict[str, Any]) -> str:
    """Plain-text choice label: icon, name, town, key prefix (max 100 chars)."""
    name = " ".join(str(node.get('adv_name') or 'Unknown').split())
    parts = [f"{get_node_type_icon(node.get('type') or 0)} {name}"]
    city = (node.get('city') or '').strip()
    if city and city != 'Unknown':
        parts.append(city)
    parts.append((node.get('public_key') or '')[:6].upper())
    if node.get('is_active', 1) == 0:
        parts.append("inactive")
    label = " · ".join(parts)
    return label if len(label) <= 100 else label[:99] + "…"


def pick_one_embed(intro: str, nodes: List[Dict[str, Any]], total: int) -> discord.Embed:
    """Several matches: the intro, up to ``PICK_LIST_MAX`` node lines, and how many more."""
    lines = [format_node_line(n) for n in nodes[:PICK_LIST_MAX]]
    shown, _ = fit_lines(lines, DISCORD_EMBED_DESC_LIMIT - len(intro) - 200)
    text = intro + "\n\n" + "\n".join(shown)
    rest = total - len(shown)
    if rest > 0:
        text += f"\n+{rest} more — type more of the name or key."
    return notice_embed(text)


class LinksView(discord.ui.View):
    """Link buttons ("Open map", …) plus an optional "My nodes" button."""

    def __init__(self, links: Tuple[Tuple[str, str], ...] = (), *, my_nodes: bool = False) -> None:
        super().__init__(timeout=None)
        for label, url in links:
            self.add_item(discord.ui.Button(label=label, url=url))
        if my_nodes:
            self.add_item(MyNodesButton())

    async def on_error(self, interaction: discord.Interaction, error: Exception, item) -> None:
        traceback.print_exception(type(error), error, error.__traceback__)
        await send_error_reply(interaction)


class MyNodesButton(discord.ui.Button):
    """Runs /mynodes for whoever clicks it (only they see the answer)."""

    def __init__(self) -> None:
        super().__init__(label="My nodes", style=discord.ButtonStyle.secondary, custom_id=MY_NODES_CUSTOM_ID)

    async def callback(self, interaction: discord.Interaction) -> None:
        started = time.monotonic()
        ok = False
        try:
            await send_my_nodes(interaction)
            ok = True
        finally:
            await log_command_result(
                interaction, "mynodes button", ok=ok,
                duration_ms=int((time.monotonic() - started) * 1000),
            )


def map_view(url: Optional[str] = None, label: str = "Open map", *, my_nodes: bool = False) -> LinksView:
    return LinksView(((label, url or get_map_base_url()),), my_nodes=my_nodes)


# ============================================================================
# Bot Instructions Post Feature
# ============================================================================

INSTRUCTIONS_TITLE = ":radioactief: Radio-Actieve Bot - :meshcore: MeshCore Node Beheer"
INSTRUCTIONS_TITLE_MARKER = "MeshCore Node Beheer"
INSTRUCTIONS_COLOR = 0xFCFB40
INSTRUCTIONS_STATE_KEY = "discord_instructions_message_id"


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
        except Exception:
            continue

    # If all paths failed, return error message
    print("ERROR: Could not find DISCORDBOT_INSTRUCTIONS.md in any of these paths:")
    for path in possible_paths:
        print(f"  - {os.path.abspath(path)}")
    return "Bot instructions file (DISCORDBOT_INSTRUCTIONS.md) not found."


def resolve_custom_emojis_in_text(text: str, guild: Optional[discord.Guild]) -> str:
    """
    Replace :emoji_name: shortcodes of server emojis with <:name:id> (or
    <a:name:id> for animated) so they render. Shortcodes of the bot's own
    server emojis (``SERVER_EMOJI_NAMES``) that the server doesn't have, or
    that can't be resolved (no guild), are dropped instead of showing as text.
    """
    if not text:
        return text
    result = text
    if guild:
        replacements = []
        for emoji in guild.emojis:
            if emoji.animated:
                replacement = f"<a:{emoji.name}:{emoji.id}>"
            else:
                replacement = f"<:{emoji.name}:{emoji.id}>"
            replacements.append((emoji.name, replacement))
        replacements.sort(key=lambda x: -len(x[0]))  # longest first
        for name, replacement in replacements:
            result = result.replace(f":{name}:", replacement)
    for name in SERVER_EMOJI_NAMES:
        result = re.sub(rf"(?<![<\w]):{name}: ?", "", result)
    return result


def render_instructions(content: str) -> str:
    """Instructions markdown as an embed description (sections bold, map URL filled in)."""
    content = content.replace("{MAP_URL}", get_map_base_url())
    lines = content.split('\n')
    formatted_lines = []
    skip_next_blank = False

    for line in lines:
        line_stripped = line.strip()

        # Title and subtitle lines are kept as they are.
        if line_stripped.startswith('# '):
            formatted_lines.append(line)
            skip_next_blank = True  # Skip blank line after title only
            continue
        elif line_stripped.startswith('## '):
            formatted_lines.append(line)
            skip_next_blank = False
            continue

        # Skip footer lines (italic-only lines)
        if line_stripped.startswith('*') and line_stripped.endswith('*'):
            continue

        # Section headers (###) become bold lines with a blank line before them.
        if line_stripped.startswith('### '):
            section_title = line_stripped[4:].strip()
            if formatted_lines and formatted_lines[-1].strip():
                formatted_lines.append('')
            formatted_lines.append(f'**{section_title}**')
            skip_next_blank = False
        else:
            if skip_next_blank and not line_stripped:
                skip_next_blank = False
                continue
            formatted_lines.append(line)

    formatted_content = re.sub(r'\n{4,}', '\n\n\n', '\n'.join(formatted_lines)).strip()

    # Discord's description limit is 4096.
    truncation_notice = '\n\n... (content truncated)'
    max_length = DISCORD_EMBED_DESC_LIMIT - len(truncation_notice)
    if len(formatted_content) > max_length:
        original_length = len(formatted_content)
        truncated = formatted_content[:max_length]
        last_newline = truncated.rfind('\n')
        if last_newline > max_length - 100:
            truncated = truncated[:last_newline]
        formatted_content = truncated + truncation_notice
        print(f"Warning: Instructions truncated from {original_length} to {len(formatted_content)} characters")
    return formatted_content


def build_instructions_embed(guild: Optional[discord.Guild]) -> discord.Embed:
    description = resolve_custom_emojis_in_text(render_instructions(load_bot_instructions()), guild)
    title = " ".join(resolve_custom_emojis_in_text(INSTRUCTIONS_TITLE, guild).split())
    if not title.startswith("<"):
        title = "📡 " + title
    return branded_embed(title=title, description=description, color=INSTRUCTIONS_COLOR)


def _load_instructions_message_id() -> Optional[str]:
    conn = get_connection()
    try:
        value = get_sync_state(conn, INSTRUCTIONS_STATE_KEY)
    finally:
        conn.close()
    return str(value) if value else None


def _save_instructions_message_id(message_id: int) -> None:
    conn = get_connection()
    try:
        set_sync_state(conn, INSTRUCTIONS_STATE_KEY, str(message_id))
        conn.commit()
    finally:
        conn.close()


def _is_instructions_message(message: discord.Message, bot_user_id: int) -> bool:
    return message.author.id == bot_user_id and any(
        INSTRUCTIONS_TITLE_MARKER in (embed.title or "") for embed in message.embeds
    )


async def _pinned_messages(channel) -> List[discord.Message]:
    pins = channel.pins()
    if hasattr(pins, "__aiter__"):  # discord.py 2.6+: paginated iterator
        return [m async for m in pins]
    return await pins


async def find_instructions_message(channel, bot_user_id: int, known_ids: List[Optional[str]]):
    """The existing instructions post: by stored id, else the bot's own pinned or recent post."""
    for message_id in known_ids:
        if not message_id:
            continue
        try:
            return await channel.fetch_message(int(message_id))
        except discord.NotFound:
            print(f"Instructions message {message_id} not found; looking for the bot's own post.")
    try:
        for message in await _pinned_messages(channel):
            if _is_instructions_message(message, bot_user_id):
                return message
    except discord.HTTPException as e:
        print(f"Could not read pinned messages: {e}")
    async for message in channel.history(limit=50):
        if _is_instructions_message(message, bot_user_id):
            return message
    return None


async def update_bot_instructions_post() -> None:
    """
    Keep one instructions post in ``STARTUP_CHANNEL_ID``, edited in place.

    The post is found by ``STARTUP_MESSAGE_ID``, else by the id the bot stored
    last time, else as the bot's own pinned or recent instructions post. Only
    when none exists is a new one posted (and its id stored).
    """
    if not STARTUP_CHANNEL_ID:
        print("No STARTUP_CHANNEL_ID configured, skipping instructions post update")
        return

    try:
        channel = bot.get_channel(int(STARTUP_CHANNEL_ID))
        if not channel:
            print(f"Warning: Channel {STARTUP_CHANNEL_ID} not found")
            return

        embed = build_instructions_embed(getattr(channel, 'guild', None))
        stored_id = await run_db(_load_instructions_message_id)
        message = await find_instructions_message(channel, bot.user.id, [STARTUP_MESSAGE_ID, stored_id])

        if message is not None:
            try:
                await message.edit(content=None, embed=embed)
            except discord.Forbidden:
                print(
                    f"ERROR: message {message.id} is not the bot's own; can't edit the instructions post. "
                    "Point STARTUP_MESSAGE_ID at the bot's post (or unset it)."
                )
                return
            print(f"✅ Updated bot instructions post: {message.id} (as embed)")
        else:
            message = await channel.send(embed=embed)
            print(f"✅ Posted a new bot instructions post: {message.id}. Set STARTUP_MESSAGE_ID={message.id} to keep it.")

        if str(message.id) != str(stored_id):
            await run_db(_save_instructions_message_id, message.id)
    except Exception as e:
        print(f"Error updating bot instructions post: {e}")
        traceback.print_exc()


# ============================================================================
# Discord Bot Commands
# ============================================================================

node_group = app_commands.Group(
    name="node",
    description="Claim or release your nodes",
    guild_only=True,
)

node_type_choices = [
    app_commands.Choice(name="Companion", value="companion"),
    app_commands.Choice(name="Repeater", value="repeater"),
    app_commands.Choice(name="Room Server", value="room server"),
    app_commands.Choice(name="Sensor", value="sensor"),
]

frequency_preset_choices = [
    app_commands.Choice(name=preset['name'], value=preset['name'])
    for preset in FREQUENCY_PRESETS
    if preset['name'] in SEARCH_PRESET_NAMES
]

# Search source filter: only App and Uploader (app and web are both "App").
search_source_choices = [
    app_commands.Choice(name="App", value="app"),
    app_commands.Choice(name="Uploader", value="uploader"),
]


class UnclaimConfirmView(discord.ui.View):
    """Yes / Cancel for /node unclaim; only the person who asked can answer."""

    def __init__(self, node: Dict[str, Any], user_id: str):
        super().__init__(timeout=60.0)
        self.node = node
        self.user_id = user_id
        self.chosen = False
        self.message: Optional[discord.Message] = None  # set after sending

    def _disable_all(self) -> None:
        for item in self.children:
            item.disabled = True

    async def on_timeout(self):
        """Show that the question expired; nothing changed."""
        if self.chosen or self.message is None:
            return
        self._disable_all()
        embed = self.message.embeds[0] if self.message.embeds else notice_embed("")
        embed.description = (embed.description or "") + "\n\n⏱️ No answer in time, so nothing changed."
        try:
            await self.message.edit(embed=embed, view=self)
        except discord.HTTPException as e:
            print(f"Error editing message on timeout: {e}")

    async def interaction_check(self, interaction: discord.Interaction) -> bool:
        """Only allow the command issuer to interact."""
        if str(interaction.user.id) != self.user_id:
            await interaction.response.send_message("This prompt is not for you.", ephemeral=True)
            return False
        return True

    async def on_error(self, interaction: discord.Interaction, error: Exception, item) -> None:
        traceback.print_exception(type(error), error, error.__traceback__)
        await send_error_reply(interaction)

    @discord.ui.button(label="Yes, unclaim", style=discord.ButtonStyle.danger, emoji="✅")
    async def confirm_unclaim(self, interaction: discord.Interaction, button: discord.ui.Button):
        if self.chosen:
            await interaction.response.defer()  # second click: already being handled
            return
        self.chosen = True
        self.stop()
        await interaction.response.defer()

        if not await run_db(remove_ownership, self.node['public_key'], self.user_id, source='bot'):
            await interaction.edit_original_response(
                embed=notice_embed("You don't own this node any more, so nothing changed."),
                view=None,
            )
            return

        await interaction.edit_original_response(
            embed=notice_embed("✅ Unclaimed. The announcement is in the channel.", COLOR_OK),
            view=None,
        )
        await interaction.followup.send(
            embed=build_unclaim_embed(self.node, self.user_id),
            view=map_view(get_map_link(self.node, short=True), "Open on map"),
        )

    @discord.ui.button(label="Cancel", style=discord.ButtonStyle.secondary, emoji="❌")
    async def cancel(self, interaction: discord.Interaction, button: discord.ui.Button):
        if self.chosen:
            await interaction.response.defer()
            return
        self.chosen = True
        self.stop()
        await interaction.response.edit_message(
            content=None,
            embed=notice_embed("Unclaim cancelled. Nothing changed."),
            view=None,
        )


def run_search(filters: Dict[str, Any]) -> Tuple[List[Dict[str, Any]], int]:
    """Relevance-sorted nodes for one search page and the real total."""
    nodes = query_nodes_substring(limit=SEARCH_FETCH_LIMIT, **filters)
    total = count_nodes_substring(**filters)
    return nodes, max(total, len(nodes))


def build_search_list_embed(summary: str, nodes: List[Dict[str, Any]], total: int) -> discord.Embed:
    """One embed: the search, "Showing X of Y", one line per node, and "+N more"."""
    header = f"**Search:** {summary}\n"
    lines = [format_node_line(ensure_node_params(n)) for n in nodes]
    more_template = "+{rest} more — refine your search or [open the map]({url})"
    reserve = len(header) + 60 + len(more_template) + len(get_map_base_url()) + 20
    shown, _ = fit_lines(lines, DISCORD_EMBED_DESC_LIMIT - reserve)
    rest = total - len(shown)
    if rest > 0:
        count_line = f"Showing **{len(shown)}** of **{total}** nodes"
    else:
        count_line = f"Found **{total}** nodes"
    description = f"{header}{count_line}\n\n" + "\n".join(shown)
    if rest > 0:
        description += "\n\n" + more_template.format(rest=rest, url=get_map_base_url())
    return branded_embed(title="🔍 Search results", description=description, color=COLOR_INFO)


@bot.tree.command(name="search", description="Search Belgian MeshCore nodes")
@app_commands.guild_only()
@app_commands.describe(
    query="Search by partial name, public key, or owner name",
    node_type="Filter by node type",
    city="Filter by city (pick one or type part of a name)",
    frequency_preset="Filter by frequency preset",
    owner="Filter by Discord owner",
    claimed="Filter by claim status (true=claimed, false=unclaimed)",
    inactive="Show only inactive nodes (default: only active nodes)",
    source="Filter by source: App or Uploader"
)
@app_commands.choices(node_type=node_type_choices, frequency_preset=frequency_preset_choices, source=search_source_choices)
async def search_nodes(
    interaction: discord.Interaction,
    query: Optional[str] = None,
    node_type: Optional[app_commands.Choice[str]] = None,
    city: Optional[str] = None,
    frequency_preset: Optional[str] = None,
    owner: Optional[discord.User] = None,
    claimed: Optional[bool] = None,
    inactive: Optional[bool] = None,
    source: Optional[app_commands.Choice[str]] = None
):
    """Search for Belgian MeshCore nodes with various filters."""
    query = query.strip() if query and query.strip() else None
    city = city.strip() if city and city.strip() else None
    if not any([query, node_type, city, frequency_preset, owner, claimed is not None, inactive is not None, source]):
        await interaction.response.send_message(
            "Provide at least one criterion: **query** (name, public key, or owner name), **node type**, **city**, **frequency preset**, **owner**, **claimed**, **inactive**, or **source** (App or Uploader).",
            ephemeral=True
        )
        return

    type_num = None
    node_type_value = _choice_value(node_type)
    if node_type_value:
        type_num = get_node_type_number(node_type_value)
        if type_num is None:
            await interaction.response.send_message(
                f"Invalid node type: {strip_backticks(node_type_value)}. Valid types: companion, repeater, room server, sensor",
                ephemeral=True
            )
            return

    frequency_preset_name = None
    if frequency_preset:
        frequency_preset_name = find_frequency_preset_name(_choice_value(frequency_preset))
        if frequency_preset_name is None:
            await interaction.response.send_message(
                "Unknown frequency preset. Pick one from the list.",
                ephemeral=True,
            )
            return

    source_value = _choice_value(source)
    if source_value and str(source_value).lower() == 'discord':
        await interaction.response.send_message(
            "You cannot filter by source **Discord**. Use **App** or **Uploader** only.",
            ephemeral=True
        )
        return

    await interaction.response.defer(thinking=True)

    filters = dict(
        query=query,
        node_type=type_num,
        city=city,
        frequency_preset_name=frequency_preset_name,
        owner_id=str(owner.id) if owner else None,
        include_inactive=bool(inactive),
        claimed=claimed,
        source=source_value,
    )
    nodes, total = await run_db(run_search, filters)

    source_label = None
    if source_value:
        source_label = "App" if source_value.lower() == 'app' else str(source_value).capitalize()
    summary = build_search_summary(
        query=query,
        node_type=node_type_value,
        city=city,
        frequency_preset_name=frequency_preset_name,
        owner_mention=owner.mention if owner else None,
        claimed=claimed,
        inactive=bool(inactive),
        source_label=source_label,
    )

    if not nodes:
        embed = branded_embed(
            title="🔍 Search results",
            description=f"**Search:** {summary}\n\nNo nodes found matching your criteria.",
            color=COLOR_WARN,
        )
        await interaction.followup.send(embed=embed, view=map_view())
        return

    if total == 1:
        node = ensure_node_params(nodes[0])
        embed = format_full_node_details(node)
        embed.description = f"**Search:** {summary}\n\n{embed.description}"
        await interaction.followup.send(
            embed=embed,
            view=map_view(get_map_link(node, short=True), "Open on map", my_nodes=True),
        )
        return

    await interaction.followup.send(
        embed=build_search_list_embed(summary, nodes, total),
        view=map_view(my_nodes=True),
    )


@search_nodes.autocomplete('city')
async def search_city_autocomplete(interaction: discord.Interaction, current: str) -> List[app_commands.Choice[str]]:
    try:
        cities = await run_db(city_suggestions, current, AUTOCOMPLETE_MAX)
    except Exception as e:
        print(f"[search city autocomplete] {e}")
        return []
    return [app_commands.Choice(name=c[:100], value=c[:100]) for c in cities]


def run_claim_lookup(query: str) -> Tuple[List[Dict[str, Any]], int]:
    nodes = query_nodes_substring(query=query, limit=PICK_LIST_MAX, claimed=False)
    total = count_nodes_substring(query=query, claimed=False)
    return nodes, max(total, len(nodes))


def explain_unclaimable(query: str, user_id: str) -> str:
    """Why ``query`` has no node to claim: yours, someone else's, inactive, or no match."""
    shown_query = strip_backticks(query)
    matches = (
        query_nodes_substring(query=query, limit=2)
        + query_nodes_substring(query=query, limit=2, include_inactive=True)
    )
    if len(matches) == 1:
        node = matches[0]
        line = format_node_line(node, owner=False)
        owner_id = node.get('discord_owner_id')
        if owner_id and str(owner_id) == str(user_id):
            return f"This node is already yours:\n{line}"
        if owner_id:
            return f"This node is already claimed by <@{owner_id}>:\n{line}"
        if not node.get('is_active', 1):
            return f"This node is inactive, so it can't be claimed:\n{line}"
    if matches:
        return (
            f"No unclaimed node matches `{shown_query}`; the nodes that match are claimed or inactive. "
            "Pick a node from the suggestions."
        )
    return (
        f"No node matches `{shown_query}`. Pick a node from the suggestions, "
        f"or check the name or key on the [{BEMESH} map]({get_map_base_url()})."
    )


@node_group.command(name="claim", description="Claim ownership of an existing unclaimed node")
@app_commands.describe(query="Start typing the node's name or public key, then pick it")
async def node_claim(interaction: discord.Interaction, query: str):
    """Claim ownership of a Belgian MeshCore node."""
    if not is_home_guild_member(interaction):
        await interaction.response.send_message(NOT_IN_SERVER, ephemeral=True)
        return

    await interaction.response.defer(ephemeral=True, thinking=True)
    user_id = str(interaction.user.id)
    nodes, total = await run_db(run_claim_lookup, query)

    if not nodes:
        await interaction.followup.send(embed=notice_embed(await run_db(explain_unclaimable, query, user_id)))
        return

    if total > 1:
        intro = (
            f"**{total}** unclaimed nodes match `{strip_backticks(query)}`. "
            "Pick one from the suggestions, or type more of its name or key:"
        )
        await interaction.followup.send(embed=pick_one_embed(intro, nodes, total))
        return

    node = ensure_node_params(nodes[0])
    claimed = await run_db(
        update_ownership,
        node['public_key'],
        user_id,
        interaction.user.name,
        source='bot',
    )
    if not claimed:
        # Someone claimed it (or it went inactive) a moment ago.
        reason = await run_db(explain_unclaimable, node['public_key'], user_id)
        await interaction.followup.send(embed=notice_embed(reason))
        return

    await interaction.edit_original_response(
        embed=notice_embed("✅ Claimed. The announcement is in the channel.", COLOR_OK),
    )
    await interaction.followup.send(
        embed=build_claim_embed(node, user_id),
        view=map_view(get_map_link(node, short=True), "Open on map", my_nodes=True),
    )


@node_claim.autocomplete('query')
async def claim_query_autocomplete(interaction: discord.Interaction, current: str) -> List[app_commands.Choice[str]]:
    try:
        nodes = await run_db(unclaimed_node_suggestions, current, AUTOCOMPLETE_MAX)
    except Exception as e:
        print(f"[node claim autocomplete] {e}")
        return []
    return [app_commands.Choice(name=autocomplete_label(n), value=n['public_key']) for n in nodes]


def build_my_nodes_embed(nodes: List[Dict[str, Any]]) -> discord.Embed:
    """Active and inactive sections in one embed; "+N more" when it doesn't fit."""
    if not nodes:
        return branded_embed(
            title="Your nodes (0)",
            description=(
                "You don't own any nodes yet. Claim one with /node claim, "
                f"or on the [{BEMESH} map]({get_map_base_url()})."
            ),
            color=COLOR_WARN,
        )
    active = [n for n in nodes if n.get('is_active', 1)]
    inactive = [n for n in nodes if not n.get('is_active', 1)]
    budget = DISCORD_EMBED_DESC_LIMIT - 200
    blocks: List[str] = []
    left_out = 0
    for heading, group in ((f"**Active ({len(active)})**", active), (f"**Inactive ({len(inactive)})**", inactive)):
        if not group:
            continue
        lines = [format_node_line(n, owner=False) for n in group]
        shown, rest = fit_lines(lines, max(budget - len(heading) - 1, 0))
        left_out += rest
        if shown:
            block = heading + "\n" + "\n".join(shown)
            blocks.append(block)
            budget -= len(block) + 2
    description = "\n\n".join(blocks)
    if left_out:
        description += f"\n\n+{left_out} more on the [{BEMESH} map]({get_map_base_url()})"
    embed = branded_embed(title=f"Your nodes ({len(nodes)})", description=description, color=COLOR_INFO)
    embed.set_footer(text="Release a node with /node unclaim.")
    return embed


async def send_my_nodes(interaction: discord.Interaction) -> None:
    """The caller's nodes, only for them (used by /mynodes and the "My nodes" button)."""
    await interaction.response.defer(ephemeral=True, thinking=True)
    nodes = await run_db(get_user_nodes, str(interaction.user.id), include_inactive=True)
    await interaction.followup.send(embed=build_my_nodes_embed(nodes), view=map_view(), ephemeral=True)


@bot.tree.command(name="mynodes", description="List all your claimed nodes")
@app_commands.guild_only()
async def mynodes(interaction: discord.Interaction):
    """List all nodes owned by the user (including inactive ones)."""
    await send_my_nodes(interaction)


@node_group.command(name="unclaim", description="Remove ownership claim from one of your nodes")
@app_commands.describe(query="Start typing one of your nodes' name or public key, then pick it")
async def node_unclaim(interaction: discord.Interaction, query: str):
    """Remove your ownership claim from a node (only your own nodes are searched)."""
    await interaction.response.defer(ephemeral=True, thinking=True)
    user_id = str(interaction.user.id)
    nodes = await run_db(search_owned_nodes, user_id, query, AUTOCOMPLETE_MAX + 1)

    if not nodes:
        await interaction.followup.send(embed=notice_embed(
            f"You don't own a node matching `{strip_backticks(query)}`. /mynodes lists your nodes."
        ))
        return

    if len(nodes) > 1:
        intro = (
            f"**{len(nodes)}** of your nodes match `{strip_backticks(query)}`. "
            "Pick one from the suggestions, or type more of its name or key:"
        )
        await interaction.followup.send(embed=pick_one_embed(intro, nodes, len(nodes)))
        return

    node = ensure_node_params(nodes[0])
    embed = notice_embed(
        f"{format_node_line(node, owner=False)}\n\nAfter this, anyone can claim it.",
        title="⚠️ Unclaim this node?",
    )
    view = UnclaimConfirmView(node, user_id)
    view.message = await interaction.followup.send(embed=embed, view=view, wait=True)


@node_unclaim.autocomplete('query')
async def unclaim_query_autocomplete(interaction: discord.Interaction, current: str) -> List[app_commands.Choice[str]]:
    try:
        nodes = await run_db(search_owned_nodes, str(interaction.user.id), current, AUTOCOMPLETE_MAX)
    except Exception as e:
        print(f"[node unclaim autocomplete] {e}")
        return []
    return [app_commands.Choice(name=autocomplete_label(n), value=n['public_key']) for n in nodes]


def build_stats_embed(
    stats_data: Dict[str, Any],
    source_stats: Dict[str, Any],
    guild: Optional[discord.Guild] = None,
) -> discord.Embed:
    """The /stats overview embed (same grouping as the web stats page)."""
    type_labels = {1: "Companions", 2: "Repeaters", 3: "Room servers", 4: "Sensors"}
    total_nodes = stats_data.get("total_nodes", 0)
    total_cities = stats_data.get("total_cities", 0)
    total_users = stats_data.get("registered_users", 0)
    by_type = stats_data.get("by_type", {})

    stats_title = " ".join(resolve_custom_emojis_in_text(
        f"🇧🇪 :meshcore: {BEMESH} MeshCore statistics 📊", guild
    ).split())
    embed1 = branded_embed(
        title=stats_title,
        description=f"Overview of the Belgian MeshCore network, from the [{BEMESH} map]({get_map_base_url()}).",
        color=COLOR_INFO,
    )
    # Row 1: network size (nodes)
    embed1.add_field(name="​", value=f"**{total_nodes}** Nodes", inline=False)
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
    embed1.add_field(name="​", value=f"Across **{total_cities}** cities", inline=False)

    # Row 4: Top cities (overall, repeaters, companions)
    def city_lines(rows):
        return "\n".join(f"{c['city']}: **{c['count']}**" for c in rows[:10]) if rows else "—"

    embed1.add_field(name="Top cities", value=city_lines(stats_data.get("top_cities", [])), inline=True)
    embed1.add_field(name="Top cities (repeaters only)", value=city_lines(stats_data.get("top_cities_repeaters", [])), inline=True)
    embed1.add_field(name="Top cities (companions only)", value=city_lines(stats_data.get("top_cities_companions", [])), inline=True)

    # Row 5: Frequency presets, Source (2 columns)
    preset_counts = stats_data.get("frequency_presets", {})
    custom_count = stats_data.get("custom_frequency", 0)
    unknown_count = stats_data.get("unknown_frequency", 0)
    freq_lines = [
        f"{preset_name}: **{count}**"
        for preset_name, count in sorted(preset_counts.items(), key=lambda x: x[1], reverse=True)
    ]
    if custom_count > 0:
        freq_lines.append(f"Custom settings: **{custom_count}**")
    if unknown_count > 0:
        freq_lines.append(f"Unknown: **{unknown_count}**")
    embed1.add_field(name="Frequency presets", value="\n".join(freq_lines) if freq_lines else "—", inline=True)

    by_source = source_stats.get("by_source", {})
    total_src = source_stats.get("total", 0)
    merged: Dict[str, int] = {}
    for s, cnt in by_source.items():
        key = s.lower() if s else ""
        if key == "web":
            key = "app"
        merged[key] = merged.get(key, 0) + cnt
    if merged and total_src > 0:
        source_labels = {"app": "App", "uploader": "Uploader", "unknown": "Unknown"}
        src_lines = [
            f"• **{source_labels.get(s, s.capitalize() if s else 'Unknown')}:** {cnt} ({cnt / total_src * 100:.1f}%)"
            for s, cnt in sorted(merged.items(), key=lambda x: x[1], reverse=True)
            if s != "discord"
        ]
        source_value = "\n".join(src_lines)
    else:
        source_value = "No data."
    embed1.add_field(name="Source type **", value=source_value, inline=True)

    notes_value = (
        "_\\* Nodes seen or changed in that period._\n"
        "_\\*\\* Uploader = nodes reported by companions running [uploader software](https://github.com/recrof/map.meshcore.io-uploader); unreported nodes may be removed after 30 days inactivity._"
    )
    embed1.add_field(name="​", value=notes_value, inline=False)
    embed1.set_footer(text="Made by the Radio-Actief.be community")
    return embed1


def load_stats() -> Tuple[Dict[str, Any], Dict[str, Any]]:
    return get_statistics(), get_source_statistics()


@bot.tree.command(name="stats", description="Show Belgian MeshCore node statistics (overview, cities, frequencies, source)")
@app_commands.guild_only()
async def stats(interaction: discord.Interaction):
    """Display merged statistics in a single overview embed."""
    await interaction.response.defer(thinking=True)
    stats_data, source_stats = await run_db(load_stats)
    embed = build_stats_embed(stats_data, source_stats, getattr(interaction, 'guild', None))
    view = LinksView((("Open map", get_map_base_url()), ("Full statistics", get_stats_url())))
    await interaction.followup.send(embed=embed, view=view)


from backend.daily_digest import post_daily_digest


# ============================================================================
# Daily Digest scheduler
# ============================================================================

_digest_time = dtime(
    DAILY_DIGEST_HOUR,
    DAILY_DIGEST_MINUTE,
    tzinfo=ZoneInfo(DAILY_DIGEST_TZ),
)


@tasks.loop(time=_digest_time)
async def daily_digest_loop() -> None:
    """Post the daily digest once a day at DAILY_DIGEST_* local time."""
    try:
        await post_daily_digest(bot)
    except Exception as e:
        print(f"[daily_digest_loop] error: {e}")
        traceback.print_exc()


@daily_digest_loop.before_loop
async def _before_daily_digest_loop() -> None:
    await bot.wait_until_ready()


# A missed digest time (bot down at DAILY_DIGEST_* today) is caught up once
# per process start; post_daily_digest(only_if_due=True) re-checks the state,
# so a reconnect or a second start that day never posts it twice.
_digest_catch_up_started = False


async def _catch_up_missed_digest() -> None:
    try:
        if await post_daily_digest(bot, only_if_due=True):
            print("[daily_digest] Posted the missed digest on start.")
    except Exception as e:
        print(f"[daily_digest] catch-up error: {e}")


# Digest slash command group: hidden for members without Manage Server.
digest_group = app_commands.Group(
    name="digest",
    description="Daily map digest controls (admin only)",
    guild_only=True,
    default_permissions=discord.Permissions(manage_guild=True),
)


def _is_guild_admin(interaction: discord.Interaction) -> bool:
    member = interaction.user
    perms = getattr(member, 'guild_permissions', None)
    if perms is None:
        return False
    return bool(perms.administrator or perms.manage_guild)


@digest_group.command(name="run", description="Post the daily digest now (admin only)")
async def digest_run(interaction: discord.Interaction) -> None:
    if not _is_guild_admin(interaction):
        await interaction.response.send_message(
            "You need the Manage Server permission to run this command.",
            ephemeral=True,
        )
        return
    await interaction.response.defer(ephemeral=True, thinking=True)
    # Errors go to the command error handler (logged, short answer).
    sent = await post_daily_digest(bot, force=True)
    if sent:
        await interaction.followup.send("Daily digest posted.", ephemeral=True)
    else:
        await interaction.followup.send(
            "Digest was not posted (no channel configured or channel unreachable).",
            ephemeral=True,
        )


# Register command groups BEFORE on_ready
bot.tree.add_command(node_group)
bot.tree.add_command(digest_group)

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
            traceback.print_exc()
    except Exception as e:
        print(f"  ❌ Error during sync: {e}")
        traceback.print_exc()

    # Update bot instructions post
    await update_bot_instructions_post()

    # Start the daily digest loop (guarded so reconnects don't double-start it)
    if DAILY_DIGEST_ENABLED:
        if not daily_digest_loop.is_running():
            try:
                daily_digest_loop.start()
                print(
                    f"[daily_digest] Scheduled for {DAILY_DIGEST_HOUR:02d}:"
                    f"{DAILY_DIGEST_MINUTE:02d} {DAILY_DIGEST_TZ}."
                )
            except RuntimeError as e:
                print(f"[daily_digest] Loop already running: {e}")
        else:
            print("[daily_digest] Loop already running.")
        global _digest_catch_up_started
        if not _digest_catch_up_started:
            _digest_catch_up_started = True
            asyncio.create_task(_catch_up_missed_digest())
    else:
        print("[daily_digest] Disabled via DAILY_DIGEST_ENABLED=0.")

    print("\n✅ Bot is ready!")


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
