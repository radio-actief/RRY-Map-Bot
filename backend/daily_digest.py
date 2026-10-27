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

import asyncio
import json
import os
import sys
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, NamedTuple, Optional
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

from backend.database import ensure_digest_state_columns, get_connection
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


def collect_changes_since(
    conn,
    since_utc: datetime,
    *,
    after_id: Optional[int] = None,
    upto_id: Optional[int] = None,
) -> Dict[str, List[str]]:
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
            Used only when ``after_id`` / ``upto_id`` are not given.
        after_id / upto_id: ``node_changes.id`` bounds of the window
            (``after_id < id <= upto_id``), as set by :func:`digest_window`.

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
    if after_id is not None and upto_id is not None:
        bound_sql, bound_params = "id > ? AND id <= ?", (after_id, upto_id)
    else:
        bound_sql, bound_params = "julianday(sync_date) >= julianday(?)", (since_iso,)
    cursor.execute(
        f"""
        SELECT public_key, change_type
        FROM node_changes
        WHERE change_type IN ('added','removed','restored','updated')
          AND {bound_sql}
        ORDER BY julianday(sync_date) ASC, id ASC
        """,
        bound_params,
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


def _count_syncs_between(conn, start_utc: datetime, end_utc: datetime) -> int:
    cursor = conn.cursor()
    cursor.execute(
        "SELECT COUNT(*) FROM sync_history WHERE julianday(sync_date) > julianday(?)"
        " AND julianday(sync_date) <= julianday(?)",
        (_format_utc(start_utc), _format_utc(end_utc)),
    )
    row = cursor.fetchone()
    return int(row[0] if row else 0)


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

    description = (
        f"Daily activity on the [#BEMesh Map](https://meshmap.radio-actief.be)\n"
        f"**{format_window(period_start, period_end)}**\n\u200b"
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
            f"- **Window:** {_window_hours(period_start, period_end)} h\n\u200b"
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


def format_window(start_utc: datetime, end_utc: datetime) -> str:
    """``2026-10-24 09:00 CEST → 2026-10-25 09:00 CET``: each side its own zone."""
    tz = ZoneInfo(DAILY_DIGEST_TZ)
    start_local = start_utc.astimezone(tz)
    end_local = end_utc.astimezone(tz)
    return (
        f"{start_local.strftime('%Y-%m-%d %H:%M')} {start_local.tzname()} → "
        f"{end_local.strftime('%Y-%m-%d %H:%M')} {end_local.tzname()}"
    )


def _window_hours(start_utc: datetime, end_utc: datetime) -> int:
    return round((end_utc - start_utc).total_seconds() / 3600)


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


class DigestWindow(NamedTuple):
    """One digest window: ``start_utc`` -> ``end_utc`` and its node_changes ids."""

    start_utc: datetime
    end_utc: datetime
    after_id: int
    upto_id: int


def _get_digest_state(conn) -> Dict[str, Any]:
    ensure_digest_state_columns(conn)
    row = conn.execute("SELECT * FROM digest_state WHERE id = 1").fetchone()
    return dict(row) if row is not None else {}


def digest_window(conn, now_utc: datetime) -> DigestWindow:
    """The window the next digest covers.

    It starts where the previous digest's window ended and ends at the last
    *finished* sync (its ``sync_history`` row is written after its node rows
    are committed). Only node_changes up to that sync are counted, by id:
    rows a sync is still writing get higher ids once committed, so they fall
    into the next window instead of being lost from both.
    """
    state = _get_digest_state(conn)
    start = (
        _parse_iso_utc(state.get('window_end_utc'))
        or _parse_iso_utc(state.get('last_sent_utc'))
        or now_utc - timedelta(hours=24)
    )
    start_iso = _format_utc(start)

    after_id = state.get('last_change_id')
    if after_id is None:
        row = conn.execute(
            "SELECT COALESCE(MAX(id), 0) FROM node_changes WHERE julianday(sync_date) < julianday(?)",
            (start_iso,),
        ).fetchone()
        after_id = int(row[0])

    row = conn.execute(
        "SELECT sync_date FROM sync_history ORDER BY julianday(sync_date) DESC LIMIT 1"
    ).fetchone()
    last_sync = _parse_iso_utc(row[0]) if row else None
    end = max(start, min(last_sync, now_utc)) if last_sync else start

    row = conn.execute(
        "SELECT COALESCE(MAX(id), ?) FROM node_changes WHERE id > ? AND julianday(sync_date) <= julianday(?)",
        (after_id, after_id, _format_utc(end)),
    ).fetchone()
    return DigestWindow(start, end, int(after_id), int(row[0]))


def _scheduled_time_on(now_utc: datetime) -> datetime:
    """Today's (local) digest time, as aware UTC."""
    tz = ZoneInfo(DAILY_DIGEST_TZ)
    local = now_utc.astimezone(tz).replace(
        hour=DAILY_DIGEST_HOUR, minute=DAILY_DIGEST_MINUTE, second=0, microsecond=0,
    )
    return local.astimezone(timezone.utc)


def digest_is_due(conn, now_utc: datetime) -> bool:
    """True when today's digest time has passed without a digest run.

    Used on bot start to catch up a missed day once. Before the very first
    digest (no ``last_sent_utc``) nothing is due; the daily loop starts it.
    """
    last_sent = _parse_iso_utc(_get_digest_state(conn).get('last_sent_utc'))
    if last_sent is None:
        return False
    scheduled = _scheduled_time_on(now_utc)
    return now_utc >= scheduled and last_sent < scheduled


def _update_digest_state(
    conn,
    sent_utc: datetime,
    window: DigestWindow,
    channel_id: Optional[str],
    message_id: Optional[str],
) -> None:
    conn.execute(
        """
        UPDATE digest_state
           SET last_sent_utc   = ?,
               window_end_utc  = ?,
               last_change_id  = ?,
               last_channel_id = ?,
               last_message_id = ?
         WHERE id = 1
        """,
        (_format_utc(sent_utc), _format_utc(window.end_utc), window.upto_id, channel_id, message_id),
    )
    conn.commit()


# One digest at a time (the daily loop and the start-up catch-up may overlap).
_POST_LOCK: Optional[tuple] = None


def _post_lock() -> asyncio.Lock:
    global _POST_LOCK
    loop = asyncio.get_running_loop()
    if _POST_LOCK is None or _POST_LOCK[0] is not loop:
        _POST_LOCK = (loop, asyncio.Lock())
    return _POST_LOCK[1]


async def post_daily_digest(
    bot,
    *,
    force: bool = False,
    only_if_due: bool = False,
    now_utc: Optional[datetime] = None,
) -> bool:
    """Build and post the daily digest embed to the configured channel.

    Returns True when a message was sent, False when the digest was skipped
    (empty window, not due, misconfiguration, or channel not reachable).

    ``only_if_due`` posts only when today's digest time passed without a
    digest (see :func:`digest_is_due`); the bot uses it on start to catch up a
    missed day once, covering the whole gap.
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

    async with _post_lock():
        conn = get_connection()
        try:
            now = now_utc or datetime.now(timezone.utc)
            if only_if_due and not digest_is_due(conn, now):
                return False

            window = digest_window(conn, now)
            agg = collect_changes_since(
                conn, window.start_utc, after_id=window.after_id, upto_id=window.upto_id,
            )
            total = len(agg['added']) + len(agg['removed']) + len(agg['restored'])

            if total == 0 and not force:
                print(
                    f"[daily_digest] No net changes {window.start_utc.isoformat()} -> "
                    f"{window.end_utc.isoformat()}; skipping post."
                )
                _update_digest_state(conn, now, window, str(channel_id), None)
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

            sync_count = _count_syncs_between(conn, window.start_utc, window.end_utc)

            added_nodes = _get_node_details_by_keys(agg['added'][:50], conn)
            restored_nodes = _get_node_details_by_keys(agg['restored'][:50], conn)
            removed_nodes = _get_node_details_by_keys(agg['removed'][:50], conn)

            embed = build_digest_embed(
                agg,
                window.start_utc,
                window.end_utc,
                stats,
                sync_count,
                added_nodes=added_nodes,
                restored_nodes=restored_nodes,
                removed_nodes=removed_nodes,
                next_digest_label=_next_digest_label(now + timedelta(minutes=1)),
            )

            msg = await channel.send(embed=embed)
            print(f"[daily_digest] Posted digest to channel {channel_id} (msg id={getattr(msg, 'id', None)}).")

            _update_digest_state(
                conn,
                now,
                window,
                str(channel_id),
                str(getattr(msg, 'id', '') or '') or None,
            )
            return True
        finally:
            conn.close()
