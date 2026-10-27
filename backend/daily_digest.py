"""
Daily digest job for the RRY-Map-Bot Discord bot.

Aggregates the `node_changes` since the previous digest into a single embed and
posts it to the configured Discord channel once per day. Runs from inside the
long-lived `discord-bot` container via `discord.ext.tasks.loop`; on start the
bot also catches up a missed day once (``post_daily_digest(only_if_due=True)``).

The window starts where the previous digest's window ended and ends at the last
finished sync (its `sync_history` row); node_changes are counted by id up to
that sync, so rows a sync is still writing land in the next window.

Public API:
    digest_window(conn, now_utc)                 -> DigestWindow
    collect_changes_since(conn, since_utc, *, after_id, upto_id)
                                                 -> dict (net buckets)
    held_back_removals(conn, start_utc, end_utc) -> dict | None
    build_digest_embed(agg, period_start, period_end, stats, ...)
                                                 -> discord.Embed
    digest_is_due(conn, now_utc)                 -> bool
    post_daily_digest(bot, *, force=False, only_if_due=False) -> bool

Schema the digest relies on:
    node_changes(id, public_key, change_type, sync_date, old_data, new_data)
    belgian_nodes(public_key, is_active, ...)
    sync_history(sync_date, details)   details.removal_safety.held_count
    digest_state(id=1, last_sent_utc, last_channel_id, last_message_id,
                 window_end_utc, last_change_id, last_total_nodes)
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
from backend.discord_formatting import (
    MAP_BASE_URL,
    PROVINCE_NAMES,
    _province_by_town,
    format_digest_node_line,
)

FIELD_LINES_MAX_CHARS = 950
FIELD_MAX_CHARS = 1024  # Discord's cap for one field value
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


def held_back_removals(conn, start_utc: datetime, end_utc: datetime) -> Optional[Dict[str, Any]]:
    """Removals the sync's safety cap held back during the window, if any.

    Returns ``{'held_count', 'still_held'}`` from the latest run in the window
    that held removals back (``sync_history.details.removal_safety``);
    ``still_held`` is True when that run is also the window's last run.
    ``None`` when no run in the window held anything back.
    """
    rows = conn.execute(
        """
        SELECT details FROM sync_history
        WHERE julianday(sync_date) > julianday(?) AND julianday(sync_date) <= julianday(?)
        ORDER BY julianday(sync_date) ASC, id ASC
        """,
        (_format_utc(start_utc), _format_utc(end_utc)),
    ).fetchall()
    latest: Optional[Dict[str, Any]] = None
    latest_index = -1
    for i, (details,) in enumerate(rows):
        try:
            safety = (json.loads(details) if details else {}).get('removal_safety') or {}
        except (ValueError, AttributeError):
            continue
        if int(safety.get('held_count') or 0) > 0:
            latest, latest_index = safety, i
    if latest is None:
        return None
    return {
        'held_count': int(latest['held_count']),
        'still_held': latest_index == len(rows) - 1,
    }


def _active_total(conn) -> int:
    row = conn.execute("SELECT COUNT(*) FROM belgian_nodes WHERE is_active = 1").fetchone()
    return int(row[0] if row else 0)


def _get_node_details_by_keys(public_keys: List[str], conn) -> List[Dict[str, Any]]:
    if not public_keys:
        return []
    normalized = [k.replace(' ', '').replace('-', '').lower() for k in public_keys]
    cursor = conn.cursor()
    out = []
    for i in range(0, len(normalized), 500):
        chunk = normalized[i:i + 500]
        placeholders = ','.join(['?'] * len(chunk))
        cursor.execute(
            f"SELECT * FROM belgian_nodes WHERE public_key IN ({placeholders})",
            chunk,
        )
        for r in cursor.fetchall():
            out.append(dict(r) if not isinstance(r, dict) else r)
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


def _node_lines(nodes: List[Dict[str, Any]], *, link: bool) -> List[str]:
    """Digest lines sorted by node type, then name."""
    ordered = sorted(
        nodes,
        key=lambda n: (int(n.get('type') or 0), str(n.get('adv_name') or '').casefold()),
    )
    return [format_digest_node_line(n, link=link) for n in ordered]


def render_node_list(nodes: List[Dict[str, Any]], total: int, *, link: bool = True) -> str:
    """Digest list value: sorted by node type, then name; whole lines only."""
    return fill_field_lines(_node_lines(nodes, link=link), total)


BULK_MIN_NODES = 26
LIST_MAX_LINES = 10


def render_section(
    nodes: List[Dict[str, Any]], total: int, *, link: bool = True,
) -> str:
    """One field value: up to 10 whole lines, or counts by type and province for a bulk section."""
    if total >= BULK_MIN_NODES:
        return _bulk_summary(nodes)
    lines = _node_lines(nodes, link=link)[:LIST_MAX_LINES]
    limit = FIELD_MAX_CHARS
    if total > len(lines):
        limit -= len(f"+{total} more on the [stats page]({STATS_PAGE_URL})") + 1
    return fill_field_lines(lines, total, limit)


def _bulk_summary(nodes: List[Dict[str, Any]]) -> str:
    """``📡 672 · 📱 168`` and ``Most in: Antwerpen 150 · …`` plus a pointer to the stats page."""
    by_type: Dict[int, int] = {}
    by_province: Dict[str, int] = {}
    towns = _province_by_town()
    for n in nodes:
        t = int(n.get('type') or 0)
        by_type[t] = by_type.get(t, 0) + 1
        code = towns.get((n.get('city') or '').strip())
        if code:
            name = PROVINCE_NAMES.get(code, code)
            by_province[name] = by_province.get(name, 0) + 1
    out: List[str] = []
    types = sorted(by_type.items(), key=lambda kv: (-kv[1], kv[0]))
    if types:
        out.append(" · ".join(f"{NODE_TYPE_ICONS.get(t, '•')} {c}" for t, c in types))
    top = sorted(by_province.items(), key=lambda kv: (-kv[1], kv[0]))[:5]
    if top:
        out.append("Most in: " + " · ".join(f"{name} {c}" for name, c in top))
    out.append(f"Full list on the [stats page]({STATS_PAGE_URL})")
    return "\n".join(out)


# ---------------------------------------------------------------------------
# Embed builder (pure function; no Discord client required)
# ---------------------------------------------------------------------------


def build_digest_embed(
    agg: Dict[str, Any],
    period_start: datetime,
    period_end: datetime,
    stats: Dict[str, Any],
    *,
    added_nodes: Optional[List[Dict[str, Any]]] = None,
    restored_nodes: Optional[List[Dict[str, Any]]] = None,
    removed_nodes: Optional[List[Dict[str, Any]]] = None,
    previous_total: Optional[int] = None,
    held_back: Optional[Dict[str, Any]] = None,
    next_digest_label: Optional[str] = None,
):
    """Build the daily digest embed.

    Pure function: no DB access, no Discord client access. ``stats`` is the
    return value of ``backend.discord_queries.get_statistics()``. Node lists
    (``added_nodes`` / ``restored_nodes`` / ``removed_nodes``) are already
    hydrated from ``belgian_nodes`` by the caller. Up to 10 are listed per section;
    a section with 26 or more nodes shows counts by type and top provinces instead.
    ``previous_total`` is the active total at the previous digest (net change
    falls back to this window's buckets without it). ``held_back`` comes from
    :func:`held_back_removals`.

    Every field is full width (no inline columns, no spacer fields), so the
    embed reads the same on a phone as on a desktop.
    """
    import discord

    added_count = len(agg.get('added', []))
    restored_count = len(agg.get('restored', []))
    removed_count = len(agg.get('removed', []))

    empty = added_count + restored_count + removed_count == 0
    embed = discord.Embed(
        title="📅 Daily Map Digest",
        description=_description(period_start, period_end, empty),
        color=discord.Color.blue(),
    )

    changes = [
        f"{label}: **{count}**"
        for label, count in (
            ("✅ New", added_count),
            ("🔄 Restored", restored_count),
            ("❌ Deleted", removed_count),
        )
        if count > 0
    ]
    if changes:
        embed.add_field(name="📝 Changes", value=" · ".join(changes), inline=False)

    total = int(stats.get('total_nodes', 0) or 0)
    net_part = ""
    if previous_total is not None and not empty:
        net = total - int(previous_total)
        net_part = f" ({_signed(net)} {_since_label(period_start, period_end)})"
    totals = [
        f"On the map: **{total}**{net_part}"
        f" · heard in the last 7 days: **{int(stats.get('active_7d', 0) or 0)}**",
    ]
    if 'claimed_nodes' in stats:
        totals.append(
            f"Claimed: {stats.get('claimed_nodes', 0)} · Registered users: "
            f"{stats.get('registered_users', 0)} · Cities: {stats.get('total_cities', 0)}"
        )
    by_type = [
        f"{NODE_TYPE_ICONS.get(t, '•')} {NODE_TYPE_NAMES.get(t, f'Type {t}')} {c}"
        for t, c in sorted((stats.get('by_type') or {}).items())
        if c
    ]
    if by_type:
        totals.append(" · ".join(by_type))
    embed.add_field(name="📊 Map totals", value="\n".join(totals), inline=False)

    if held_back and held_back.get('held_count'):
        n = int(held_back['held_count'])
        status = "waiting for confirmation" if held_back.get('still_held') else "released later"
        embed.add_field(
            name="⚠️ Sync",
            value=f"Removals held back: {n} node{'s' if n != 1 else ''} — {status}",
            inline=False,
        )

    if next_digest_label is None:
        next_digest_label = _next_digest_label(period_end)
    embed.set_footer(text=f"Next digest: {next_digest_label}")
    apply_brand_to_embed(embed)

    lists = [
        (title, nodes, count, link)
        for title, nodes, count, link in (
            ("✅ New Nodes", added_nodes, added_count, True),
            ("🔄 Restored Nodes", restored_nodes, restored_count, True),
            ("❌ Deleted Nodes", removed_nodes, removed_count, False),
        )
        if count > 0
    ]
    for title, nodes, count, link in lists:
        embed.add_field(
            name=f"{title} ({count})",
            value=render_section(nodes or [], count, link=link),
            inline=False,
        )
    return embed


def _description(start_utc: datetime, end_utc: datetime, empty: bool) -> str:
    text = f"Daily activity on the [#BEMesh Map]({MAP_BASE_URL.rstrip('/')})"
    if empty:
        return text + "\n**No changes since the last digest**"
    window = format_window(start_utc, end_utc)
    left, _, right = window.partition(" → ")
    if left == right:
        return text
    return f"{text}\n**{window}**"


def _signed(n: int) -> str:
    if n > 0:
        return f"+{n}"
    if n < 0:
        return f"−{abs(n)}"
    return "±0"


def _since_label(start_utc: datetime, end_utc: datetime) -> str:
    """``since yesterday`` for a normal day, else the window's start day."""
    if end_utc - start_utc <= timedelta(hours=30):
        return "since yesterday"
    start_local = start_utc.astimezone(ZoneInfo(DAILY_DIGEST_TZ))
    return f"since {start_local.strftime('%a %d %b')}"


def format_window(start_utc: datetime, end_utc: datetime) -> str:
    """``2026-10-24 09:00 CEST → 2026-10-25 09:00 CET``: each side its own zone."""
    tz = ZoneInfo(DAILY_DIGEST_TZ)
    start_local = start_utc.astimezone(tz)
    end_local = end_utc.astimezone(tz)
    return (
        f"{start_local.strftime('%Y-%m-%d %H:%M')} {start_local.tzname()} → "
        f"{end_local.strftime('%Y-%m-%d %H:%M')} {end_local.tzname()}"
    )


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
    total_nodes: int,
    channel_id: Optional[str],
    message_id: Optional[str],
) -> None:
    conn.execute(
        """
        UPDATE digest_state
           SET last_sent_utc    = ?,
               window_end_utc   = ?,
               last_change_id   = ?,
               last_total_nodes = ?,
               last_channel_id  = ?,
               last_message_id  = ?
         WHERE id = 1
        """,
        (
            _format_utc(sent_utc), _format_utc(window.end_utc), window.upto_id,
            total_nodes, channel_id, message_id,
        ),
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
            previous_total = _get_digest_state(conn).get('last_total_nodes')
            agg = collect_changes_since(
                conn, window.start_utc, after_id=window.after_id, upto_id=window.upto_id,
            )
            held = held_back_removals(conn, window.start_utc, window.end_utc)
            total = len(agg['added']) + len(agg['removed']) + len(agg['restored'])

            if total == 0 and not held and not force:
                print(
                    f"[daily_digest] No net changes {window.start_utc.isoformat()} -> "
                    f"{window.end_utc.isoformat()}; skipping post."
                )
                _update_digest_state(conn, now, window, _active_total(conn), str(channel_id), None)
                return False

            try:
                from backend.discord_queries import get_statistics  # local import: avoid cycles
                stats = get_statistics()
            except Exception as e:
                print(f"[daily_digest] get_statistics failed: {e}; continuing with zeros.")
                stats = {}
            if not stats.get('total_nodes'):
                stats = {**stats, 'total_nodes': _active_total(conn)}

            embed = build_digest_embed(
                agg,
                window.start_utc,
                window.end_utc,
                stats,
                added_nodes=_get_node_details_by_keys(agg['added'], conn),
                restored_nodes=_get_node_details_by_keys(agg['restored'], conn),
                removed_nodes=_get_node_details_by_keys(agg['removed'], conn),
                previous_total=previous_total,
                held_back=held,
                next_digest_label=_next_digest_label(now + timedelta(minutes=1)),
            )

            msg = await channel.send(embed=embed)
            print(f"[daily_digest] Posted digest to channel {channel_id} (msg id={getattr(msg, 'id', None)}).")

            _update_digest_state(
                conn,
                now,
                window,
                int(stats.get('total_nodes') or 0),
                str(channel_id),
                str(getattr(msg, 'id', '') or '') or None,
            )
            return True
        finally:
            conn.close()
