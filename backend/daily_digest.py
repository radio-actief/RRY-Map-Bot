"""
Daily digest job for the RRY-Map-Bot Discord bot.

Aggregates the last 24 h of `node_changes` into a single embed and posts it to
the configured Discord channel once per day. Runs from inside the long-lived
`discord-bot` container via `discord.ext.tasks.loop`, so the sync service no
longer needs to open its own short-lived Discord client on every run.

Public API:
    collect_changes_since(conn, since_utc)       -> dict (net buckets)
    build_digest_embed(agg, period_start, period_end, stats, sync_count)
                                                 -> discord.Embed
    post_daily_digest(bot, *, force=False)       -> bool

Schema the digest relies on (all pre-existing except digest_state):
    node_changes(public_key, change_type, sync_date, old_data, new_data)
    belgian_nodes(public_key, is_active, ...)
    sync_history(sync_date, ...)
    digest_state(id=1, last_sent_utc, last_channel_id, last_message_id)
"""

from __future__ import annotations

import json
import os
import sys
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional
from zoneinfo import ZoneInfo

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

try:
    from config.config import (
        DAILY_DIGEST_CHANNEL_ID,
        DAILY_DIGEST_HOUR,
        DAILY_DIGEST_MINUTE,
        DAILY_DIGEST_TZ,
        NODE_TYPE_ICONS,
        STARTUP_CHANNEL_ID,
    )
except (ImportError, ModuleNotFoundError):  # pragma: no cover - defensive fallback
    DAILY_DIGEST_CHANNEL_ID = os.getenv('DAILY_DIGEST_CHANNEL_ID') or os.getenv('STARTUP_CHANNEL_ID')
    DAILY_DIGEST_HOUR = int(os.getenv('DAILY_DIGEST_HOUR', '9'))
    DAILY_DIGEST_MINUTE = int(os.getenv('DAILY_DIGEST_MINUTE', '0'))
    DAILY_DIGEST_TZ = os.getenv('DAILY_DIGEST_TZ', 'Europe/Brussels')
    STARTUP_CHANNEL_ID = os.getenv('STARTUP_CHANNEL_ID')
    NODE_TYPE_ICONS = {1: "📱", 2: "📡", 3: "💾", 4: "🌡️"}

from backend.database import get_connection
from backend.datetime_utils import format_utc_iso, parse_utc
from backend.discord_branding import apply_brand_to_embed
from backend.discord_formatting import MAP_BASE_URL, format_digest_node_line

FIELD_LINES_MAX_CHARS = 950
STATS_PAGE_URL = f"{MAP_BASE_URL.rstrip('/')}/stats"


NODE_TYPE_NAMES = {
    1: "Companions",
    2: "Repeaters",
    3: "Room Servers",
    4: "Sensors",
}


# ---------------------------------------------------------------------------
# Time helpers
# ---------------------------------------------------------------------------


def _parse_iso_utc(ts: Optional[str]) -> Optional[datetime]:
    """Parse timestamps stored in node_changes / digest_state."""
    return parse_utc(ts)


def _format_utc(dt: datetime) -> str:
    """Format an aware UTC datetime as canonical ISO Z."""
    return format_utc_iso(dt) or ""


# ---------------------------------------------------------------------------
# Change aggregation
# ---------------------------------------------------------------------------


# State a lifecycle event leaves the node in, and the state it implies the
# node was in just before it.
_STATE_AFTER = {'added': 'active', 'restored': 'active', 'removed': 'gone'}
_STATE_BEFORE = {'added': 'new', 'restored': 'gone', 'removed': 'active'}


def collect_changes_since(conn, since_utc: datetime) -> Dict[str, List[str]]:
    """Return the net add/remove/restore buckets since ``since_utc``.

    Per public_key, the state just before the window is compared with the
    state at its end; only ``added`` / ``removed`` / ``restored`` rows count
    (``updated`` rows are routine and never move a node between buckets):

        before = what the first lifecycle row in the window implies
                 (added -> new, removed -> active, restored -> gone)
        after  = what the last lifecycle row in the window leaves
                 (added / restored -> active, removed -> gone)

        new    -> active : added
        gone   -> active : restored
        active -> gone   : removed
        anything else    : left out (no net change, e.g. removed then
                           restored, or added then removed again)

    So a node that goes away and comes back (or the reverse) several times in
    one window is shown by its final state whenever that state changed.

    Args:
        conn: sqlite3 connection.
        since_utc: Aware UTC datetime, lower bound of the window (inclusive).

    Returns:
        Dict with keys 'added', 'removed', 'restored', 'updated_count' and the
        original window boundary echo 'since_utc'.
    """
    if since_utc.tzinfo is None:
        since_utc = since_utc.replace(tzinfo=timezone.utc)
    # Store/compare in full ISO UTC so SQLite datetime funcs can parse both
    # legacy "YYYY-MM-DD HH:MM:SS" rows and newer ISO-8601 rows reliably.
    since_iso = since_utc.astimezone(timezone.utc).isoformat(timespec="seconds")

    cursor = conn.cursor()
    cursor.execute(
        """
        SELECT public_key, change_type
        FROM node_changes
        WHERE change_type IN ('added','removed','restored','updated')
          AND julianday(sync_date) >= julianday(?)
        ORDER BY julianday(sync_date) ASC, id ASC
        """,
        (since_iso,),
    )
    lifecycle: Dict[str, List[str]] = {}
    updated_only: set = set()
    for pk, ct in cursor.fetchall():
        if not pk or not ct:
            continue
        if ct == 'updated':
            updated_only.add(pk)
        else:
            lifecycle.setdefault(pk, []).append(ct)
    updated_only -= set(lifecycle)

    added: List[str] = []
    removed: List[str] = []
    restored: List[str] = []
    for pk, events in lifecycle.items():
        transition = (_STATE_BEFORE[events[0]], _STATE_AFTER[events[-1]])
        if transition == ('new', 'active'):
            added.append(pk)
        elif transition == ('gone', 'active'):
            restored.append(pk)
        elif transition == ('active', 'gone'):
            removed.append(pk)

    return {
        'added': added,
        'removed': removed,
        'restored': restored,
        'updated_count': len(updated_only),
        'since_utc': since_utc,
    }


def _count_syncs_since(conn, since_utc: datetime) -> int:
    since_iso = since_utc.astimezone(timezone.utc).isoformat(timespec="seconds")
    cursor = conn.cursor()
    cursor.execute(
        "SELECT COUNT(*) FROM sync_history WHERE julianday(sync_date) >= julianday(?)",
        (since_iso,),
    )
    row = cursor.fetchone()
    return int(row[0] if row else 0)


def _get_node_details_by_keys(public_keys: List[str], conn) -> List[Dict[str, Any]]:
    if not public_keys:
        return []
    normalized = [k.replace(' ', '').replace('-', '').lower() for k in public_keys]
    cursor = conn.cursor()
    placeholders = ','.join(['?'] * len(normalized))
    cursor.execute(
        f"SELECT * FROM belgian_nodes WHERE public_key IN ({placeholders})",
        normalized,
    )
    rows = cursor.fetchall()
    out = []
    for r in rows:
        d = dict(r) if not isinstance(r, dict) else r
        out.append(d)
    return out


# ---------------------------------------------------------------------------
# Node lists
# ---------------------------------------------------------------------------


def fill_field_lines(lines: List[str], total: int, limit: int = FIELD_LINES_MAX_CHARS) -> str:
    """Join whole lines up to ``limit`` characters, then say how many are left.

    Lines are never cut, so a mention, link or escape is never broken. ``total``
    is the full count for the list (it may be larger than ``len(lines)``).
    """
    shown: List[str] = []
    used = 0
    for line in lines:
        extra = len(line) + (1 if shown else 0)
        if used + extra > limit:
            break
        shown.append(line)
        used += extra
    rest = max(total, len(lines)) - len(shown)
    if rest > 0:
        shown.append(f"+{rest} more on the [stats page]({STATS_PAGE_URL})")
    return "\n".join(shown)


def render_node_list(nodes: List[Dict[str, Any]], total: int, *, link: bool = True) -> str:
    """Digest list value: sorted by node type, then name; whole lines only."""
    ordered = sorted(
        nodes,
        key=lambda n: (int(n.get('type') or 0), str(n.get('adv_name') or '').casefold()),
    )
    return fill_field_lines([format_digest_node_line(n, link=link) for n in ordered], total)


# ---------------------------------------------------------------------------
# Embed builder (pure function; no Discord client required)
# ---------------------------------------------------------------------------


def build_digest_embed(
    agg: Dict[str, Any],
    period_start: datetime,
    period_end: datetime,
    stats: Dict[str, Any],
    sync_count: int,
    *,
    added_nodes: Optional[List[Dict[str, Any]]] = None,
    restored_nodes: Optional[List[Dict[str, Any]]] = None,
    removed_nodes: Optional[List[Dict[str, Any]]] = None,
    next_digest_label: Optional[str] = None,
):
    """Build the daily digest embed.

    Pure function: no DB access, no Discord client access. ``stats`` is the
    return value of ``backend.discord_queries.get_statistics()``. Node lists
    (``added_nodes`` / ``restored_nodes`` / ``removed_nodes``) are already
    hydrated from ``belgian_nodes`` by the caller and capped to 50.
    """
    import discord

    added_count = len(agg.get('added', []))
    restored_count = len(agg.get('restored', []))
    removed_count = len(agg.get('removed', []))
    updated_count = int(agg.get('updated_count', 0))
    total_changes = added_count + restored_count + removed_count

    tz = ZoneInfo(DAILY_DIGEST_TZ)
    start_local = period_start.astimezone(tz)
    end_local = period_end.astimezone(tz)
    description = (
        f"Daily activity on the [#BEMesh Map](https://meshmap.radio-actief.be)\n"
        f"**{start_local.strftime('%Y-%m-%d %H:%M')} → "
        f"{end_local.strftime('%Y-%m-%d %H:%M')} {end_local.tzname()}**\n\u200b"
    )

    embed = discord.Embed(
        title="📅 Daily Map Digest",
        description=description,
        color=discord.Color.blue(),
    )

    embed.add_field(
        name="🔄 Period",
        value=(
            f"- **Syncs in window:** {sync_count}\n"
            f"- **Total changes:** {total_changes}\n"
            f"- **Window:** 24 h\n\u200b"
        ),
        inline=True,
    )

    changes_lines = []
    if added_count > 0:
        changes_lines.append(f"- **Added:** {added_count}")
    if updated_count > 0:
        changes_lines.append(f"- **Updated:** {updated_count}")
    if removed_count > 0:
        changes_lines.append(f"- **Deactivated:** {removed_count}")
    if restored_count > 0:
        changes_lines.append(f"- **Restored:** {restored_count}")

    if changes_lines:
        embed.add_field(
            name="📝 Changes",
            value="\n".join(changes_lines) + "\n\u200b",
            inline=True,
        )
        embed.add_field(name="\u200b", value="\u200b", inline=True)

    embed.add_field(
        name="📊 Overall Statistics",
        value=(
            f"- **Total Active Nodes:** {stats.get('total_nodes', 0)}\n"
            f"- **Claimed:** {stats.get('claimed_nodes', 0)}\n"
            f"- **Unclaimed:** {stats.get('unclaimed_nodes', 0)}\n"
            f"- **Registered Users:** {stats.get('registered_users', 0)}\n"
            f"- **Total Cities:** {stats.get('total_cities', 0)}\n\u200b"
        ),
        inline=True,
    )

    by_type_text = []
    for type_num in sorted((stats.get('by_type') or {}).keys()):
        count = stats['by_type'][type_num]
        if count > 0:
            name = NODE_TYPE_NAMES.get(type_num, f"Type {type_num}")
            icon = NODE_TYPE_ICONS.get(type_num, '•')
            by_type_text.append(f"{icon} {name}: **{count}**")
    if by_type_text:
        embed.add_field(
            name="📱 Nodes by Type",
            value="\n".join([f"- {t}" for t in by_type_text]) + "\n\u200b",
            inline=True,
        )
        embed.add_field(name="\u200b", value="\u200b", inline=True)

    for title, nodes, count, link in (
        ("✅ New Nodes", added_nodes, added_count, True),
        ("🔄 Restored Nodes", restored_nodes, restored_count, True),
        ("❌ Deleted Nodes", removed_nodes, removed_count, False),
    ):
        if count > 0:
            embed.add_field(
                name=f"{title} ({count})",
                value=render_node_list(nodes or [], total=count, link=link),
                inline=False,
            )

    if next_digest_label is None:
        next_digest_label = _next_digest_label(period_end)
    embed.set_footer(text=f"Next digest: {next_digest_label}")
    return apply_brand_to_embed(embed)


def _next_digest_label(now_utc: datetime) -> str:
    tz = ZoneInfo(DAILY_DIGEST_TZ)
    now_local = now_utc.astimezone(tz)
    target = now_local.replace(
        hour=DAILY_DIGEST_HOUR,
        minute=DAILY_DIGEST_MINUTE,
        second=0,
        microsecond=0,
    )
    if target <= now_local:
        target += timedelta(days=1)
    return f"{target.strftime('%Y-%m-%d %H:%M')} {target.tzname()}"


# ---------------------------------------------------------------------------
# Post the digest to Discord
# ---------------------------------------------------------------------------


def _get_last_sent(conn) -> Optional[datetime]:
    cursor = conn.cursor()
    cursor.execute("SELECT last_sent_utc FROM digest_state WHERE id = 1")
    row = cursor.fetchone()
    if row is None:
        return None
    return _parse_iso_utc(row[0])


def _update_digest_state(conn, sent_utc: datetime, channel_id: Optional[str], message_id: Optional[str]) -> None:
    cursor = conn.cursor()
    cursor.execute(
        """
        UPDATE digest_state
           SET last_sent_utc   = ?,
               last_channel_id = ?,
               last_message_id = ?
         WHERE id = 1
        """,
        (_format_utc(sent_utc), channel_id, message_id),
    )
    conn.commit()


async def post_daily_digest(bot, *, force: bool = False) -> bool:
    """Build and post the daily digest embed to the configured channel.

    Returns True when a message was sent, False when the digest was skipped
    (empty window, misconfiguration, or channel not reachable).
    """
    channel_id = DAILY_DIGEST_CHANNEL_ID or STARTUP_CHANNEL_ID
    if not channel_id:
        print("[daily_digest] No DAILY_DIGEST_CHANNEL_ID / STARTUP_CHANNEL_ID configured; skipping.")
        return False

    try:
        channel = bot.get_channel(int(channel_id))
    except (TypeError, ValueError):
        channel = None
    if channel is None:
        try:
            channel = await bot.fetch_channel(int(channel_id))
        except Exception as e:  # pragma: no cover - network
            print(f"[daily_digest] Could not fetch channel {channel_id}: {e}")
            return False

    conn = get_connection()
    try:
        last_sent = _get_last_sent(conn)
        now_utc = datetime.now(timezone.utc)
        window_start = last_sent if last_sent else (now_utc - timedelta(hours=24))

        agg = collect_changes_since(conn, window_start)
        total = len(agg['added']) + len(agg['removed']) + len(agg['restored'])

        if total == 0 and not force:
            print(
                f"[daily_digest] No net changes since {window_start.isoformat()} — skipping post."
            )
            _update_digest_state(conn, now_utc, str(channel_id), None)
            return False

        try:
            from backend.discord_queries import get_statistics  # local import: avoid cycles
            stats = get_statistics()
        except Exception as e:
            print(f"[daily_digest] get_statistics failed: {e}; continuing with zeros.")
            stats = {
                'total_nodes': 0,
                'claimed_nodes': 0,
                'unclaimed_nodes': 0,
                'registered_users': 0,
                'total_cities': 0,
                'by_type': {},
            }

        sync_count = _count_syncs_since(conn, window_start)

        added_nodes = _get_node_details_by_keys(agg['added'][:50], conn)
        restored_nodes = _get_node_details_by_keys(agg['restored'][:50], conn)
        removed_nodes = _get_node_details_by_keys(agg['removed'][:50], conn)

        embed = build_digest_embed(
            agg,
            window_start,
            now_utc,
            stats,
            sync_count,
            added_nodes=added_nodes,
            restored_nodes=restored_nodes,
            removed_nodes=removed_nodes,
        )

        msg = await channel.send(embed=embed)
        print(f"[daily_digest] Posted digest to channel {channel_id} (msg id={getattr(msg, 'id', None)}).")

        _update_digest_state(
            conn,
            now_utc,
            str(channel_id),
            str(getattr(msg, 'id', '') or '') or None,
        )
        return True
    finally:
        conn.close()
