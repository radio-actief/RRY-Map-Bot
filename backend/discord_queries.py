"""
Database Query Functions for Discord Bot
Handles all database queries for Discord bot commands.
"""

import sys
import os
import sqlite3
import re
from typing import Optional, Dict, Any, List

# Add parent directory to path for imports
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

from backend.database import (
    get_connection,
    dict_from_row,
    json_deserialize,
    get_current_timestamp,
    json_serialize
)


_HEX_PUBKEY_RE = re.compile(r'^[0-9a-fA-F]+$')


def normalize_pubkey(query: Optional[str]) -> Optional[str]:
    """
    Normalize a query string that looks like a hex public key fragment.

    Returns lowercase hex without spaces/dashes, or None if not hex-like (≥6 chars).
    """
    if not query:
        return None
    normalized = query.replace(' ', '').replace('-', '').lower()
    if len(normalized) >= 6 and _HEX_PUBKEY_RE.match(normalized):
        return normalized
    return None


def _node_passes_filters(
    node: Dict[str, Any],
    *,
    node_type: Optional[int] = None,
    city: Optional[str] = None,
    frequency_preset_name: Optional[str] = None,
    owner_id: Optional[str] = None,
    claimed: Optional[bool] = None,
    source: Optional[str] = None,
    include_inactive: bool = False,
) -> bool:
    """Check whether a single node row satisfies the same filters as query_nodes_substring."""
    if include_inactive:
        if node.get('is_active', 1):
            return False
    else:
        if not node.get('is_active', 1):
            return False

    if node_type is not None and node.get('type') != node_type:
        return False

    if city:
        node_city = (node.get('city') or '').lower()
        if city.lower() not in node_city:
            return False

    if owner_id and str(node.get('discord_owner_id')) != str(owner_id):
        return False

    if claimed is not None:
        has_owner = node.get('discord_owner_id') is not None
        if claimed and not has_owner:
            return False
        if not claimed and has_owner:
            return False

    if source:
        source_lower = source.lower()
        node_source = (node.get('source') or '').lower()
        if source_lower == 'app':
            if node_source not in ('app', 'web'):
                return False
        elif source_lower == 'unknown':
            if node_source and node_source != 'unknown':
                return False
        elif node_source != source_lower:
            return False

    if frequency_preset_name:
        from config.config import FREQUENCY_PRESETS
        preset = None
        for p in FREQUENCY_PRESETS:
            if p['name'].lower() == frequency_preset_name.lower():
                preset = p
                break
        if preset:
            params_raw = node.get('params')
            if isinstance(params_raw, str):
                params = json_deserialize(params_raw) or {}
            elif isinstance(params_raw, dict):
                params = params_raw
            else:
                return False
            freq = preset['freq']
            sf = preset['sf']
            bw = preset['bw']
            cr = preset['cr']
            params_str = str(params)
            if not all(
                frag in params_str
                for frag in (
                    f'"freq": {freq}',
                    f'"sf": {sf}',
                    f'"bw": {bw}',
                    f'"cr": {cr}',
                )
            ):
                return False

    return True


def _sort_nodes_by_relevance(nodes: List[Dict[str, Any]], query: Optional[str]) -> List[Dict[str, Any]]:
    if not query or not nodes:
        return nodes

    query_lower = query.lower()
    norm = normalize_pubkey(query)

    def score(node: Dict[str, Any]) -> int:
        pk = (node.get('public_key') or '').lower()
        name = (node.get('adv_name') or '').lower()
        owner = (node.get('discord_owner_name') or '').lower()
        if norm and pk == norm:
            return 0
        if norm and pk.startswith(norm):
            return 1
        if query_lower in name:
            return 2
        if query_lower in owner:
            return 3
        if query_lower in pk:
            return 4
        return 5

    return sorted(nodes, key=score)


def _like_pattern(text: str) -> str:
    """``%text%`` for ``LIKE ... ESCAPE '\\'`` with ``%``, ``_`` and ``\\`` taken literally."""
    escaped = text.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
    return f"%{escaped}%"


def _search_conditions(
    *,
    query: Optional[str] = None,
    node_type: Optional[int] = None,
    city: Optional[str] = None,
    frequency_preset_name: Optional[str] = None,
    owner_id: Optional[str] = None,
    include_inactive: bool = False,
    claimed: Optional[bool] = None,
    source: Optional[str] = None,
) -> tuple:
    """WHERE conditions and parameters shared by the node search and its count."""
    # include_inactive=True shows ONLY inactive nodes; the default only active ones.
    conditions = ["is_active = 0" if include_inactive else "is_active = 1"]
    params: List[Any] = []

    # Substring match on name, public key or owner name; wildcards taken literally.
    if query:
        pattern = _like_pattern(query.lower())
        conditions.append(
            "(LOWER(adv_name) LIKE ? ESCAPE '\\' OR LOWER(public_key) LIKE ? ESCAPE '\\'"
            " OR LOWER(discord_owner_name) LIKE ? ESCAPE '\\')"
        )
        params.extend([pattern, pattern, pattern])

    if node_type is not None:
        conditions.append("type = ?")
        params.append(node_type)

    if city:
        conditions.append("LOWER(city) LIKE ? ESCAPE '\\'")
        params.append(_like_pattern(city.lower()))

    # Frequency preset: all four radio parameters in the params JSON
    # ({"freq": 869.618, "sf": 8, "bw": 62.5, "cr": 8}).
    if frequency_preset_name:
        from config.config import FREQUENCY_PRESETS
        preset = next(
            (p for p in FREQUENCY_PRESETS if p['name'].lower() == frequency_preset_name.lower()),
            None,
        )
        if preset:
            conditions.append("(params LIKE ? AND params LIKE ? AND params LIKE ? AND params LIKE ?)")
            params.extend([
                f'%"freq": {preset["freq"]}%',
                f'%"sf": {preset["sf"]}%',
                f'%"bw": {preset["bw"]}%',
                f'%"cr": {preset["cr"]}%',
            ])

    if owner_id:
        conditions.append("discord_owner_id = ?")
        params.append(str(owner_id))

    if claimed is not None:
        conditions.append("discord_owner_id IS NOT NULL" if claimed else "discord_owner_id IS NULL")

    # Source filter (app and web are treated the same as "app" for search)
    if source:
        source_lower = source.lower()
        if source_lower == 'app':
            conditions.append("(LOWER(source) = 'app' OR LOWER(source) = 'web')")
        elif source_lower == 'unknown':
            conditions.append("(source IS NULL OR source = '' OR LOWER(source) = 'unknown')")
        else:
            conditions.append("LOWER(source) = ?")
            params.append(source_lower)

    return " AND ".join(conditions), params


def _exact_key_match(norm: Optional[str], filters: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    """The node for a full 64-char key when it passes the search filters."""
    if not norm or len(norm) != 64:
        return None
    exact = get_node_by_key(norm, include_inactive=filters.get('include_inactive', False))
    if exact and _node_passes_filters(exact, **filters):
        return exact
    return None


def query_nodes_substring(
    query: Optional[str] = None,
    node_type: Optional[int] = None,
    city: Optional[str] = None,
    frequency_preset_name: Optional[str] = None,
    owner_id: Optional[str] = None,
    limit: int = 25,
    include_inactive: bool = False,
    claimed: Optional[bool] = None,
    source: Optional[str] = None
) -> List[Dict[str, Any]]:
    """
    Query nodes with substring matching (case-insensitive).
    By default filters for active nodes only (is_active = TRUE).

    Args:
        query: Substring to search in node name, public key or owner name.
            ``%`` and ``_`` are matched literally.
        node_type: Filter by node type (1-4).
        city: Filter by city name (case-insensitive substring).
        frequency_preset_name: Filter by frequency preset name (matches nodes using that preset).
        owner_id: Filter by Discord owner ID.
        limit: Maximum number of results (default 25).
        include_inactive: If True, show ONLY inactive nodes (default False: only active).
        claimed: Filter by claim status (True=claimed, False=unclaimed, None=both).
        source: Filter by source type (app, uploader, web, unknown, or None for all).

    Returns:
        List of node dictionaries matching the criteria.

    Raises:
        sqlite3.Error: when the database can't be read (never an empty list).
    """
    filters = dict(
        node_type=node_type, city=city, frequency_preset_name=frequency_preset_name,
        owner_id=owner_id, claimed=claimed, source=source, include_inactive=include_inactive,
    )
    exact = _exact_key_match(normalize_pubkey(query) if query else None, filters)
    if exact:
        return [exact]

    where, params = _search_conditions(query=query, **filters)
    conn = get_connection()
    try:
        rows = conn.execute(
            f"SELECT * FROM belgian_nodes WHERE {where} ORDER BY adv_name LIMIT ?",
            [*params, limit],
        ).fetchall()
    finally:
        conn.close()
    nodes = [dict_from_row(row) for row in rows]
    return _sort_nodes_by_relevance(nodes, query) if query else nodes


def count_nodes_substring(
    query: Optional[str] = None,
    node_type: Optional[int] = None,
    city: Optional[str] = None,
    frequency_preset_name: Optional[str] = None,
    owner_id: Optional[str] = None,
    include_inactive: bool = False,
    claimed: Optional[bool] = None,
    source: Optional[str] = None,
) -> int:
    """How many nodes ``query_nodes_substring`` would find without its limit."""
    filters = dict(
        node_type=node_type, city=city, frequency_preset_name=frequency_preset_name,
        owner_id=owner_id, claimed=claimed, source=source, include_inactive=include_inactive,
    )
    if _exact_key_match(normalize_pubkey(query) if query else None, filters):
        return 1
    where, params = _search_conditions(query=query, **filters)
    conn = get_connection()
    try:
        return conn.execute(f"SELECT COUNT(*) FROM belgian_nodes WHERE {where}", params).fetchone()[0]
    finally:
        conn.close()


def search_owned_nodes(user_id: str, query: Optional[str] = None, limit: int = 25) -> List[Dict[str, Any]]:
    """The caller's own nodes (active first, then inactive) whose name or key contains ``query``."""
    conditions = ["discord_owner_id = ?"]
    params: List[Any] = [str(user_id)]
    norm = normalize_pubkey(query) if query else None
    if norm and len(norm) == 64:
        conditions.append("public_key = ?")
        params.append(norm)
    elif query:
        pattern = _like_pattern(query.lower())
        conditions.append("(LOWER(adv_name) LIKE ? ESCAPE '\\' OR LOWER(public_key) LIKE ? ESCAPE '\\')")
        params.extend([pattern, pattern])
    conn = get_connection()
    try:
        rows = conn.execute(
            f"SELECT * FROM belgian_nodes WHERE {' AND '.join(conditions)} "
            "ORDER BY is_active DESC, adv_name LIMIT ?",
            [*params, limit],
        ).fetchall()
    finally:
        conn.close()
    return [dict_from_row(row) for row in rows]


def unclaimed_node_suggestions(query: Optional[str], limit: int = 25) -> List[Dict[str, Any]]:
    """Active, unclaimed nodes whose name or key contains ``query`` (for autocomplete)."""
    params: List[Any] = []
    where = "is_active = 1 AND discord_owner_id IS NULL"
    text = (query or "").strip()
    if text:
        norm = normalize_pubkey(text)
        pattern = _like_pattern((norm or text).lower())
        where += " AND (LOWER(adv_name) LIKE ? ESCAPE '\\' OR LOWER(public_key) LIKE ? ESCAPE '\\')"
        params.extend([_like_pattern(text.lower()), pattern])
    conn = get_connection()
    try:
        rows = conn.execute(
            f"SELECT public_key, adv_name, type, city FROM belgian_nodes WHERE {where} "
            "ORDER BY adv_name LIMIT ?",
            [*params, limit],
        ).fetchall()
    finally:
        conn.close()
    return [dict_from_row(row) for row in rows]


def city_suggestions(query: Optional[str], limit: int = 25) -> List[str]:
    """Cities of active nodes containing ``query``: those starting with it first, then by node count."""
    where = "is_active = 1 AND city IS NOT NULL AND city != '' AND city != 'Unknown'"
    text = (query or "").strip().lower()
    pattern = _like_pattern(text)
    prefix = pattern[1:]  # "text%": cities that start with the text come first
    if text:
        where += " AND LOWER(city) LIKE ? ESCAPE '\\'"
    conn = get_connection()
    try:
        rows = conn.execute(
            f"SELECT city, COUNT(*) AS n, LOWER(city) LIKE ? ESCAPE '\\' AS starts FROM belgian_nodes "
            f"WHERE {where} GROUP BY city ORDER BY starts DESC, n DESC, city LIMIT ?",
            [prefix, *([pattern] if text else []), limit],
        ).fetchall()
    finally:
        conn.close()
    return [row['city'] for row in rows]


def record_command(command: str, user_id: Optional[str], *, ok: bool, duration_ms: Optional[int]) -> None:
    """Append one ``command_log`` row (no command arguments are stored)."""
    conn = get_connection()
    try:
        conn.execute(
            "INSERT INTO command_log (ts, command, user_id, ok, duration_ms) VALUES (?, ?, ?, ?, ?)",
            (get_current_timestamp(), command, str(user_id) if user_id is not None else None,
             1 if ok else 0, duration_ms),
        )
        conn.commit()
    finally:
        conn.close()


def get_user_nodes(user_id: str, include_inactive: bool = True) -> List[Dict[str, Any]]:
    """
    Get all nodes owned by a user (active first when inactive ones are included).

    Raises:
        sqlite3.Error: when the database can't be read (never an empty list).
    """
    conn = get_connection()
    try:
        if include_inactive:
            rows = conn.execute("""
                SELECT * FROM belgian_nodes
                WHERE discord_owner_id = ?
                ORDER BY is_active DESC, adv_name
            """, (str(user_id),)).fetchall()
        else:
            rows = conn.execute("""
                SELECT * FROM belgian_nodes
                WHERE discord_owner_id = ? AND is_active = 1
                ORDER BY adv_name
            """, (str(user_id),)).fetchall()
        return [dict_from_row(row) for row in rows]
    finally:
        conn.close()


def _partial_radio_filter_clause(parts: Dict[str, Any]) -> tuple:
    """
    SQL AND of LIKE fragments for each provided key (freq, sf, bw, cr).
    Same substring strategy as named presets. Empty or unknown keys → no clause.
    """
    if not parts:
        return ("", [])
    fragments: List[str] = []
    params: List[Any] = []
    if "freq" in parts:
        fragments.append("params LIKE ?")
        params.append(f'%"freq": {float(parts["freq"])}%')
    if "sf" in parts:
        fragments.append("params LIKE ?")
        params.append(f'%"sf": {int(parts["sf"])}%')
    if "bw" in parts:
        fragments.append("params LIKE ?")
        params.append(f'%"bw": {float(parts["bw"])}%')
    if "cr" in parts:
        fragments.append("params LIKE ?")
        params.append(f'%"cr": {int(parts["cr"])}%')
    if not fragments:
        return ("", [])
    sql = " AND (" + " AND ".join(fragments) + ")"
    return (sql, params)


def _active_frequency_sql_params(
    frequency_preset: Optional[str],
    radio_custom: Optional[Dict[str, Any]],
) -> tuple:
    """
    Preset name or partial custom {freq, sf, bw, cr} — any non-empty subset.
    Custom dict wins when non-empty.
    """
    if radio_custom:
        try:
            return _partial_radio_filter_clause(radio_custom)
        except (TypeError, ValueError, KeyError):
            return ("", [])
    return _preset_filter_clause(frequency_preset)


def _preset_filter_clause(preset_name: Optional[str]) -> tuple:
    """
    Return (sql_fragment, params) for filtering by frequency preset.
    Returns ("", []) if preset_name is None or "all".
    Supports named presets, "Custom settings", and "Unknown".
    """
    if not preset_name or preset_name == 'all':
        return ("", [])
    if preset_name == 'Unknown':
        return (" AND (params IS NULL OR params = '')", [])
    if preset_name == 'Custom settings':
        # Has params, not empty, and does not match any known preset
        # Use a subquery: we need nodes where params exists but doesn't match any preset
        # Simpler: exclude Unknown (empty) and exclude each known preset - complex in SQL
        # Alternative: fetch in Python - too slow. Use NOT IN for preset matches.
        # Build NOT (params LIKE ... AND ...) for each preset would be huge
        # Pragmatic: "Custom" = has non-empty params that we'll filter in Python... no
        # Best approach: use a subquery that excludes known presets. SQLite doesn't have
        # elegant "NOT match any". We could do: AND params IS NOT NULL AND params != ''
        # AND NOT (params LIKE ? AND params LIKE ? ...) for each preset. That's many ORs.
        # Simpler: only support named presets + Unknown. For "Custom settings" return ("", [])
        # and document that filtering by Custom is not implemented. Or add a Python post-filter.
        return ("", [])  # Custom not easily expressible in SQL; fall back to no filter
    from config.config import FREQUENCY_PRESETS
    preset = None
    for p in FREQUENCY_PRESETS:
        if p['name'] == preset_name:
            preset = p
            break
    if not preset:
        return ("", [])
    # Match JSON params: {"freq": X, "sf": Y, "bw": Z, "cr": W}
    sql = " AND (params LIKE ? AND params LIKE ? AND params LIKE ? AND params LIKE ?)"
    params = [
        f'%"freq": {preset["freq"]}%',
        f'%"sf": {preset["sf"]}%',
        f'%"bw": {preset["bw"]}%',
        f'%"cr": {preset["cr"]}%',
    ]
    return (sql, params)


def get_statistics(
    frequency_preset: Optional[str] = None,
    radio_custom: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    """
    Get statistics about Belgian nodes.
    Only counts active nodes.
    
    Args:
        frequency_preset: Optional preset name to filter all counts by (e.g. "EU/UK (Narrow)").
            Use "all" or None for unfiltered stats. "Custom settings" and "Unknown" are not supported.
        radio_custom: Optional subset of {"freq", "sf", "bw", "cr"} (validated ranges).
            Nodes must match every provided field. When non-empty, overrides frequency_preset.
    
    Returns:
        Dictionary with statistics (all filtered by preset when frequency_preset is set)

    Raises:
        sqlite3.Error: when the database can't be read (never all zeros).
    """
    conn = get_connection()
    cursor = conn.cursor()
    preset_sql, preset_params = _active_frequency_sql_params(
        frequency_preset, radio_custom
    )
    
    try:
        stats = {}
        
        # Total active nodes
        cursor.execute(f"""
            SELECT COUNT(*) FROM belgian_nodes
            WHERE is_active = 1{preset_sql}
        """, preset_params)
        stats['total_nodes'] = cursor.fetchone()[0]
        
        # Claimed nodes (with Discord owner)
        cursor.execute(f"""
            SELECT COUNT(*) FROM belgian_nodes
            WHERE is_active = 1 AND discord_owner_id IS NOT NULL{preset_sql}
        """, preset_params)
        stats['claimed_nodes'] = cursor.fetchone()[0]
        
        # Unclaimed nodes
        stats['unclaimed_nodes'] = stats['total_nodes'] - stats['claimed_nodes']
        
        # Registered users (unique Discord owners)
        cursor.execute(f"""
            SELECT COUNT(DISTINCT discord_owner_id) FROM belgian_nodes
            WHERE is_active = 1 AND discord_owner_id IS NOT NULL{preset_sql}
        """, preset_params)
        stats['registered_users'] = cursor.fetchone()[0]
        
        # Count by type (all active; may include nodes without map coordinates)
        cursor.execute(f"""
            SELECT type, COUNT(*) as count
            FROM belgian_nodes
            WHERE is_active = 1{preset_sql}
            GROUP BY type
            ORDER BY type
        """, preset_params)
        stats['by_type'] = {row['type']: row['count'] for row in cursor.fetchall()}

        # Same row set as the main map (active + valid coordinates).
        # This predicate must stay in sync with backend.api.app._displayable_predicate
        # so the map header total equals sum(by_type_map.values()).
        cursor.execute(f"""
            SELECT type, COUNT(*) as count
            FROM belgian_nodes
            WHERE is_active = 1
              AND adv_lat IS NOT NULL AND adv_lon IS NOT NULL{preset_sql}
            GROUP BY type
            ORDER BY type
        """, preset_params)
        stats['by_type_map'] = {row['type']: row['count'] for row in cursor.fetchall()}
        
        # Top cities (limit to top 10)
        cursor.execute(f"""
            SELECT city, COUNT(*) as count
            FROM belgian_nodes
            WHERE is_active = 1 AND city IS NOT NULL AND city != 'Unknown'{preset_sql}
            GROUP BY city
            ORDER BY count DESC
            LIMIT 10
        """, preset_params)
        stats['top_cities'] = [
            {'city': row['city'], 'count': row['count']}
            for row in cursor.fetchall()
        ]
        
        # Top cities by repeater count only (type=2)
        cursor.execute(f"""
            SELECT city, COUNT(*) as count
            FROM belgian_nodes
            WHERE is_active = 1 AND type = 2 AND city IS NOT NULL AND city != 'Unknown'{preset_sql}
            GROUP BY city
            ORDER BY count DESC
            LIMIT 10
        """, preset_params)
        stats['top_cities_repeaters'] = [
            {'city': row['city'], 'count': row['count']}
            for row in cursor.fetchall()
        ]
        
        # Top cities by companion count only (type=1)
        cursor.execute(f"""
            SELECT city, COUNT(*) as count
            FROM belgian_nodes
            WHERE is_active = 1 AND type = 1 AND city IS NOT NULL AND city != 'Unknown'{preset_sql}
            GROUP BY city
            ORDER BY count DESC
            LIMIT 10
        """, preset_params)
        stats['top_cities_companions'] = [
            {'city': row['city'], 'count': row['count']}
            for row in cursor.fetchall()
        ]
        
        # Top cities by room servers only (type=3)
        cursor.execute(f"""
            SELECT city, COUNT(*) as count
            FROM belgian_nodes
            WHERE is_active = 1 AND type = 3 AND city IS NOT NULL AND city != 'Unknown'{preset_sql}
            GROUP BY city
            ORDER BY count DESC
            LIMIT 10
        """, preset_params)
        stats['top_cities_room_servers'] = [
            {'city': row['city'], 'count': row['count']}
            for row in cursor.fetchall()
        ]
        
        # Top cities by sensors only (type=4)
        cursor.execute(f"""
            SELECT city, COUNT(*) as count
            FROM belgian_nodes
            WHERE is_active = 1 AND type = 4 AND city IS NOT NULL AND city != 'Unknown'{preset_sql}
            GROUP BY city
            ORDER BY count DESC
            LIMIT 10
        """, preset_params)
        stats['top_cities_sensors'] = [
            {'city': row['city'], 'count': row['count']}
            for row in cursor.fetchall()
        ]
        
        # Total unique cities
        cursor.execute(f"""
            SELECT COUNT(DISTINCT city) FROM belgian_nodes
            WHERE is_active = 1 AND city IS NOT NULL AND city != 'Unknown'{preset_sql}
        """, preset_params)
        stats['total_cities'] = cursor.fetchone()[0]
        
        # Recently added nodes (last 7 days)
        # Note: This uses created_at field, which tracks when node was added to our DB
        cursor.execute(f"""
            SELECT COUNT(*) FROM belgian_nodes
            WHERE is_active = 1{preset_sql}
            AND created_at >= datetime('now', '-7 days')
        """, preset_params)
        stats['recently_added'] = cursor.fetchone()[0]
        
        # Frequency preset statistics
        # Get all active nodes with their params
        cursor.execute("""
            SELECT params FROM belgian_nodes
            WHERE is_active = 1
        """)
        all_nodes = cursor.fetchall()
        
        from backend.database import json_deserialize
        from config.config import FREQUENCY_PRESETS
        
        preset_counts = {}
        custom_count = 0
        unknown_count = 0
        
        for row in all_nodes:
            params_str = row['params']
            
            # Count nodes with no params or empty params as "Unknown"
            if not params_str or params_str == '':
                unknown_count += 1
                continue
            
            try:
                params = json_deserialize(params_str) if isinstance(params_str, str) else params_str
                if not params or not isinstance(params, dict):
                    unknown_count += 1
                    continue
                
                # Check if params match any preset
                matched = False
                freq = params.get('freq')
                sf = params.get('sf')
                bw = params.get('bw')
                cr = params.get('cr')
                
                # If any required param is missing, count as unknown
                if freq is None or sf is None or bw is None or cr is None:
                    unknown_count += 1
                    continue
                
                # Try to match preset
                for preset in FREQUENCY_PRESETS:
                    if (abs(freq - preset['freq']) < 0.001 and
                        sf == preset['sf'] and
                        bw == preset['bw'] and
                        cr == preset['cr']):
                        preset_name = preset['name']
                        preset_counts[preset_name] = preset_counts.get(preset_name, 0) + 1
                        matched = True
                        break
                
                if not matched:
                    custom_count += 1
            except Exception:
                # Skip invalid params - count as unknown
                unknown_count += 1
                continue
        
        stats['frequency_presets'] = preset_counts
        stats['custom_frequency'] = custom_count
        stats['unknown_frequency'] = unknown_count
        
        # Activity stats: devices active in last 24h, 7d, 30d.
        # Based on most recent of inserted_date, updated_date, last_advert.
        from datetime import datetime, timedelta, timezone

        from backend.datetime_utils import parse_utc

        now = datetime.now(timezone.utc)
        day_ago = now - timedelta(days=1)
        week_ago = now - timedelta(days=7)
        month_ago = now - timedelta(days=30)

        cursor.execute(f"""
            SELECT
                inserted_date,
                updated_date,
                last_advert
            FROM belgian_nodes
            WHERE is_active = 1{preset_sql}
        """, preset_params)

        active_24h = 0
        active_7d = 0
        active_30d = 0

        for row in cursor.fetchall():
            if not isinstance(row, dict):
                row = dict_from_row(row)
            dates = []
            for date_val in (
                row.get('inserted_date'),
                row.get('updated_date'),
                row.get('last_advert'),
            ):
                dt = parse_utc(date_val)
                if dt:
                    dates.append(dt)

            if dates:
                most_recent = max(dates)
                
                if most_recent >= day_ago:
                    active_24h += 1
                if most_recent >= week_ago:
                    active_7d += 1
                if most_recent >= month_ago:
                    active_30d += 1
        
        stats['active_24h'] = active_24h
        stats['active_7d'] = active_7d
        stats['active_30d'] = active_30d
        
        return stats

    finally:
        conn.close()


def get_source_statistics() -> Dict[str, Any]:
    """
    Get statistics about nodes by source type.
    Only counts active nodes.
    
    Returns:
        Dictionary with source statistics:
        - by_source: Count by source type
        - total: Total active nodes
    """
    conn = get_connection()
    cursor = conn.cursor()
    
    try:
        # Count by source (normalize to lowercase for consistency)
        cursor.execute("""
            SELECT 
                CASE 
                    WHEN source IS NULL OR source = '' THEN 'Unknown'
                    ELSE LOWER(source) 
                END as source_type, 
                COUNT(*) as count
            FROM belgian_nodes
            WHERE is_active = 1
            GROUP BY source_type
            ORDER BY count DESC
        """)
        rows = cursor.fetchall()
        
        by_source = {}
        total = 0
        for row in rows:
            source = row['source_type']
            count = row['count']
            by_source[source] = count
            total += count
        
        return {
            'by_source': by_source,
            'total': total
        }

    finally:
        conn.close()


def update_ownership(public_key: str, user_id: str, username: str, *, source: Optional[str] = None) -> bool:
    """
    Claim an unclaimed node for a Discord user.

    Sets ``discord_owner_id`` and ``discord_owner_name`` on ``belgian_nodes``
    and appends a ``'claim'`` row to ``node_claims``. Both writes happen in
    the same transaction.

    Args:
        public_key: Public key of the node (normalised to lowercase).
        user_id: Discord user ID.
        username: Discord username.
        source: Where the claim came from: ``'bot'`` or ``'web'``.

    Returns:
        True if the node was found and the claim was recorded, False if it
        is missing, inactive or already claimed.

    Raises:
        sqlite3.Error: when the database can't be written (rolled back).
    """
    conn = get_connection()
    cursor = conn.cursor()

    try:
        public_key_normalized = public_key.replace(' ', '').replace('-', '').lower()

        cursor.execute("""
            UPDATE belgian_nodes
            SET discord_owner_id = ?,
                discord_owner_name = ?
            WHERE public_key = ? AND is_active = 1
              AND (discord_owner_id IS NULL OR discord_owner_id = '')
        """, (str(user_id), username, public_key_normalized))

        if cursor.rowcount == 0:
            conn.rollback()
            return False

        cursor.execute("""
            INSERT INTO node_claims
                (public_key, discord_owner_id, discord_owner_name, action, timestamp, source)
            VALUES (?, ?, ?, 'claim', CURRENT_TIMESTAMP, ?)
        """, (public_key_normalized, str(user_id), username, source))

        conn.commit()
        return True

    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


def remove_ownership(public_key: str, user_id: str, *, source: Optional[str] = None) -> bool:
    """
    Unclaim a node previously claimed by ``user_id``.

    Clears ``discord_owner_id`` / ``discord_owner_name`` on ``belgian_nodes``
    and appends an ``'unclaim'`` row to ``node_claims`` with the user that
    held the claim. Both writes happen in the same transaction.

    Args:
        public_key: Public key of the node (normalised to lowercase).
        user_id: Discord user ID (must match the current owner).
        source: Where the unclaim came from: ``'bot'`` or ``'web'``.

    Returns:
        True if the node was owned by ``user_id`` and the unclaim was
        recorded, False otherwise.

    Raises:
        sqlite3.Error: when the database can't be written (rolled back).
    """
    conn = get_connection()
    cursor = conn.cursor()

    try:
        public_key_normalized = public_key.replace(' ', '').replace('-', '').lower()

        cursor.execute("""
            SELECT discord_owner_id, discord_owner_name FROM belgian_nodes
            WHERE public_key = ?
        """, (public_key_normalized,))
        row = cursor.fetchone()

        if not row or str(row['discord_owner_id']) != str(user_id):
            return False

        prior_owner_name = row['discord_owner_name']

        cursor.execute("""
            UPDATE belgian_nodes
            SET discord_owner_id = NULL,
                discord_owner_name = NULL
            WHERE public_key = ?
        """, (public_key_normalized,))

        cursor.execute("""
            INSERT INTO node_claims
                (public_key, discord_owner_id, discord_owner_name, action, timestamp, source)
            VALUES (?, ?, ?, 'unclaim', CURRENT_TIMESTAMP, ?)
        """, (public_key_normalized, str(user_id), prior_owner_name, source))

        conn.commit()
        return True

    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


def verify_ownership(public_key: str, user_id: str, include_inactive: bool = False) -> bool:
    """
    Verify if a user owns a node.
    By default only checks active nodes.
    
    Args:
        public_key: Public key of the node (will be normalized to lowercase).
        user_id: Discord user ID.
        include_inactive: If True, also check inactive nodes (default False).
    
    Returns:
        True if user owns the node, False otherwise.
    """
    conn = get_connection()
    cursor = conn.cursor()
    
    try:
        # Normalize public key: remove spaces, dashes, convert to lowercase
        # This matches the normalization in get_node_by_key
        public_key_normalized = public_key.replace(' ', '').replace('-', '').lower()
        
        if include_inactive:
            cursor.execute("""
                SELECT discord_owner_id FROM belgian_nodes
                WHERE public_key = ?
            """, (public_key_normalized,))
        else:
            cursor.execute("""
                SELECT discord_owner_id FROM belgian_nodes
                WHERE public_key = ? AND is_active = 1
            """, (public_key_normalized,))
        row = cursor.fetchone()
        
        if not row:
            return False
        
        return str(row['discord_owner_id']) == str(user_id)

    finally:
        conn.close()


def get_node_by_key(public_key: str, include_inactive: bool = False) -> Optional[Dict[str, Any]]:
    """
    Get a single node by public key.
    
    Args:
        public_key: Public key of the node (will be normalized to lowercase).
        include_inactive: If True, include inactive nodes.
    
    Returns:
        Node dictionary or None if not found.
    """
    conn = get_connection()
    cursor = conn.cursor()
    
    try:
        # Normalize public key: remove spaces, dashes, convert to lowercase
        # This matches the normalization in get_node_by_key
        public_key_normalized = public_key.replace(' ', '').replace('-', '').lower()
        
        if include_inactive:
            cursor.execute("""
                SELECT * FROM belgian_nodes
                WHERE public_key = ?
            """, (public_key_normalized,))
        else:
            cursor.execute("""
                SELECT * FROM belgian_nodes
                WHERE public_key = ? AND is_active = 1
            """, (public_key_normalized,))
        
        row = cursor.fetchone()
        if row:
            node = dict_from_row(row)
            # Deserialize JSON fields - always check if params exists, even if empty string
            if 'params' in node and node['params'] is not None:
                if isinstance(node['params'], str):
                    # Try to deserialize JSON string
                    if node['params'].strip():
                        # Non-empty string, try to deserialize
                        try:
                            deserialized = json_deserialize(node['params'])
                            node['params'] = deserialized if deserialized is not None else {}
                        except Exception as e:
                            # Deserialization failed, log and set to empty dict
                            print(f"Warning: Failed to deserialize params for node {public_key[:8]}...: {e}")
                            node['params'] = {}
                    else:
                        # Empty string, set to empty dict
                        node['params'] = {}
                elif isinstance(node['params'], dict):
                    # Already a dict, use as is
                    pass
                else:
                    # Invalid type, set to empty dict
                    node['params'] = {}
            else:
                # params is None or doesn't exist
                node['params'] = {}
            return node
        return None

    finally:
        conn.close()
