"""
Database Query Functions for Discord Bot
Handles all database queries for Discord bot commands.
"""

import sys
import os
import sqlite3
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
        query: Substring to search in node name or public key.
        node_type: Filter by node type (1-4).
        city: Filter by city name (case-insensitive).
        frequency_preset_name: Filter by frequency preset name (matches nodes using that preset).
        owner_id: Filter by Discord owner ID.
        limit: Maximum number of results (default 25).
        include_inactive: If True, include inactive nodes (default False).
        claimed: Filter by claim status (True=claimed, False=unclaimed, None=both).
        source: Filter by source type (discord, app, uploader, web, or None for all).
    
    Returns:
        List of node dictionaries matching the criteria.
    """
    conn = get_connection()
    cursor = conn.cursor()
    
    try:
        # Build WHERE clause
        conditions = []
        if include_inactive:
            # If include_inactive is True, show ONLY inactive nodes
            conditions.append("is_active = 0")
        else:
            # Default: only show active nodes
            conditions.append("is_active = 1")
        params = []
        
        # Query parameter (substring match on name, public key, or owner name)
        if query:
            query_lower = query.lower()
            conditions.append(
                "(LOWER(adv_name) LIKE ? OR LOWER(public_key) LIKE ? OR LOWER(discord_owner_name) LIKE ?)"
            )
            params.extend([f"%{query_lower}%", f"%{query_lower}%", f"%{query_lower}%"])
        
        # Node type filter
        if node_type is not None:
            conditions.append("type = ?")
            params.append(node_type)
        
        # City filter (case-insensitive substring match)
        if city:
            city_lower = city.lower()
            conditions.append("LOWER(city) LIKE ?")
            params.append(f"%{city_lower}%")
        
        # Frequency preset filter (match nodes using the selected preset)
        if frequency_preset_name:
            # Get the preset parameters to match against
            from config.config import FREQUENCY_PRESETS
            preset = None
            for p in FREQUENCY_PRESETS:
                if p['name'].lower() == frequency_preset_name.lower():
                    preset = p
                    break
            
            if preset:
                # Match nodes that have params matching this preset exactly
                # JSON format: {"freq": 869.618, "sf": 8, "bw": 62.5, "cr": 8}
                # We need to match all 4 parameters: freq, sf, bw, cr
                freq = preset['freq']
                sf = preset['sf']
                bw = preset['bw']
                cr = preset['cr']
                
                # Match the preset by checking all parameters in the JSON
                # Use multiple LIKE conditions to ensure all params match
                conditions.append("""
                    (params LIKE ? AND params LIKE ? AND params LIKE ? AND params LIKE ?)
                """)
                params.append(f'%"freq": {freq}%')  # Match frequency (with space)
                params.append(f'%"sf": {sf}%')      # Match spreading factor
                params.append(f'%"bw": {bw}%')      # Match bandwidth
                params.append(f'%"cr": {cr}%')      # Match coding rate
        
        # Owner filter (exact match by Discord user ID)
        if owner_id:
            conditions.append("discord_owner_id = ?")
            params.append(str(owner_id))
        
        # Claimed filter
        if claimed is not None:
            if claimed:
                conditions.append("discord_owner_id IS NOT NULL")
            else:
                conditions.append("discord_owner_id IS NULL")
        
        # Source filter (app and web are treated the same as "app" for search)
        if source:
            source_lower = source.lower()
            if source_lower == 'app':
                conditions.append("(LOWER(source) = 'app' OR LOWER(source) = 'web')")
            elif source_lower == 'uploader':
                conditions.append("LOWER(source) = ?")
                params.append(source_lower)
            elif source_lower == 'unknown':
                conditions.append("(source IS NULL OR source = '' OR LOWER(source) = 'unknown')")
            else:
                conditions.append("LOWER(source) = ?")
                params.append(source_lower)
        
        # Build query
        if conditions:
            where_clause = " AND ".join(conditions)
            query_sql = f"""
                SELECT * FROM belgian_nodes
                WHERE {where_clause}
                ORDER BY adv_name
                LIMIT ?
            """
        else:
            # No conditions - select all nodes (when include_inactive=True and no filters)
            query_sql = """
                SELECT * FROM belgian_nodes
                ORDER BY adv_name
                LIMIT ?
            """
        params.append(limit)
        
        cursor.execute(query_sql, params)
        rows = cursor.fetchall()
        
        # Convert rows to dictionaries
        nodes = [dict_from_row(row) for row in rows]
        
        return nodes
        
    except Exception as e:
        print(f"Error querying nodes: {e}")
        return []
    finally:
        conn.close()


def get_user_nodes(user_id: str, include_inactive: bool = True) -> List[Dict[str, Any]]:
    """
    Get all nodes owned by a user.
    For /manage list command - shows both active and inactive nodes.
    
    Args:
        user_id: Discord user ID.
        include_inactive: If True, include inactive nodes (default True).
    
    Returns:
        List of node dictionaries owned by the user.
    """
    conn = get_connection()
    cursor = conn.cursor()
    
    try:
        if include_inactive:
            # Show both active and inactive
            cursor.execute("""
                SELECT * FROM belgian_nodes
                WHERE discord_owner_id = ?
                ORDER BY is_active DESC, adv_name
            """, (str(user_id),))
        else:
            # Only active nodes
            cursor.execute("""
                SELECT * FROM belgian_nodes
                WHERE discord_owner_id = ? AND is_active = 1
                ORDER BY adv_name
            """, (str(user_id),))
        
        rows = cursor.fetchall()
        nodes = [dict_from_row(row) for row in rows]
        
        return nodes
        
    except Exception as e:
        print(f"Error getting user nodes: {e}")
        return []
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
        
        # Count by type
        cursor.execute(f"""
            SELECT type, COUNT(*) as count
            FROM belgian_nodes
            WHERE is_active = 1{preset_sql}
            GROUP BY type
            ORDER BY type
        """, preset_params)
        stats['by_type'] = {row['type']: row['count'] for row in cursor.fetchall()}
        
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
        
        # Activity stats: devices active in last 24h, 7d, 30d
        # Based on most recent of: inserted_date, updated_date, last_advert, discord_updated_date
        from datetime import datetime, timedelta
        
        now = datetime.now()
        day_ago = now - timedelta(days=1)
        week_ago = now - timedelta(days=7)
        month_ago = now - timedelta(days=30)
        
        # Get all active nodes with their dates
        cursor.execute(f"""
            SELECT 
                inserted_date,
                updated_date,
                last_advert,
                discord_updated_date
            FROM belgian_nodes
            WHERE is_active = 1{preset_sql}
        """, preset_params)
        
        active_24h = 0
        active_7d = 0
        active_30d = 0
        
        for row in cursor.fetchall():
            # Convert row to dict if needed
            if not isinstance(row, dict):
                row = dict_from_row(row)
            # Get most recent date from all 4 date fields
            dates = []
            for date_val in [row.get('inserted_date'), row.get('updated_date'), row.get('last_advert'), row.get('discord_updated_date')]:
                if date_val:
                    try:
                        # Handle different date formats
                        if isinstance(date_val, str):
                            # Try parsing ISO format or SQLite datetime format
                            if 'T' in date_val:
                                # ISO format: "2025-01-15T14:30:00" or "2025-01-15T14:30:00.123456"
                                dt = datetime.fromisoformat(date_val.replace('Z', '+00:00').split('.')[0])
                            else:
                                # SQLite format: "2025-01-15 14:30:00"
                                dt = datetime.strptime(date_val, '%Y-%m-%d %H:%M:%S')
                        else:
                            dt = date_val
                        # Remove timezone info for comparison
                        if dt.tzinfo:
                            dt = dt.replace(tzinfo=None)
                        dates.append(dt)
                    except (ValueError, TypeError, AttributeError):
                        continue
            
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
        
    except Exception as e:
        print(f"Error getting statistics: {e}")
        return {
            'total_nodes': 0,
            'by_type': {},
            'top_cities': [],
            'top_cities_repeaters': [],
            'top_cities_companions': [],
            'top_cities_room_servers': [],
            'top_cities_sensors': [],
            'recently_added': 0
        }
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
        
    except Exception as e:
        print(f"Error getting source statistics: {e}")
        return {'by_source': {}, 'total': 0}
    finally:
        conn.close()


def update_ownership(public_key: str, user_id: str, username: str) -> bool:
    """
    Update node ownership (claim node).
    Sets discord_owner_id, discord_owner_name, and discord_updated_date.
    
    Args:
        public_key: Public key of the node (will be normalized to lowercase).
        user_id: Discord user ID.
        username: Discord username.
    
    Returns:
        True if successful, False otherwise.
    """
    conn = get_connection()
    cursor = conn.cursor()
    
    try:
        from backend.database import get_current_timestamp
        
        # Normalize public key: remove spaces, dashes, convert to lowercase
        # This matches the normalization in get_node_by_key
        public_key_normalized = public_key.replace(' ', '').replace('-', '').lower()
        
        cursor.execute("""
            UPDATE belgian_nodes
            SET discord_owner_id = ?,
                discord_owner_name = ?,
                discord_updated_date = ?
            WHERE public_key = ? AND is_active = 1
        """, (str(user_id), username, get_current_timestamp(), public_key_normalized))
        
        if cursor.rowcount == 0:
            return False
        
        conn.commit()
        return True
        
    except Exception as e:
        print(f"Error updating ownership: {e}")
        conn.rollback()
        return False
    finally:
        conn.close()


def remove_ownership(public_key: str, user_id: str) -> bool:
    """
    Remove node ownership (unclaim node).
    Verifies ownership before removing.
    Updates discord_updated_date.
    
    Args:
        public_key: Public key of the node (will be normalized to lowercase).
        user_id: Discord user ID (for verification).
    
    Returns:
        True if successful, False otherwise.
    """
    conn = get_connection()
    cursor = conn.cursor()
    
    try:
        from backend.database import get_current_timestamp
        
        # Normalize public key: remove spaces, dashes, convert to lowercase
        # This matches the normalization in get_node_by_key
        public_key_normalized = public_key.replace(' ', '').replace('-', '').lower()
        
        # Verify ownership first
        cursor.execute("""
            SELECT discord_owner_id FROM belgian_nodes
            WHERE public_key = ?
        """, (public_key_normalized,))
        row = cursor.fetchone()
        
        if not row or str(row['discord_owner_id']) != str(user_id):
            return False  # Not owned by this user
        
        # Remove ownership
        cursor.execute("""
            UPDATE belgian_nodes
            SET discord_owner_id = NULL,
                discord_owner_name = NULL,
                discord_updated_date = ?
            WHERE public_key = ?
        """, (get_current_timestamp(), public_key_normalized))
        
        conn.commit()
        return True
        
    except Exception as e:
        print(f"Error removing ownership: {e}")
        conn.rollback()
        return False
    finally:
        conn.close()


def update_node_properties(
    public_key: str,
    user_id: str,
    name: Optional[str] = None,
    city: Optional[str] = None,
    params: Optional[Dict[str, Any]] = None,
    adv_lat: Optional[float] = None,
    adv_lon: Optional[float] = None
) -> Dict[str, Any]:
    """
    Update node properties (name, city, frequency parameters, coordinates).
    Verifies ownership before updating.
    Updates discord_updated_date.
    Does NOT modify immutable fields (public_key, type, etc.).
    
    Args:
        public_key: Public key of the node (will be normalized to lowercase).
        user_id: Discord user ID (for verification).
        name: New node name (optional).
        city: New city name (optional).
        params: New frequency parameters dict (optional).
        adv_lat: New latitude (optional).
        adv_lon: New longitude (optional).
    
    Returns:
        Dict with 'success' (bool) and 'changes' (dict) showing old -> new values.
        On failure, returns {'success': False, 'message': str}.
    """
    conn = get_connection()
    cursor = conn.cursor()
    
    try:
        from backend.database import get_current_timestamp, json_serialize, json_deserialize
        
        # Normalize public key: remove spaces, dashes, convert to lowercase
        # This matches the normalization in get_node_by_key
        public_key_normalized = public_key.replace(' ', '').replace('-', '').lower()
        
        # Get current node values to track changes
        cursor.execute("""
            SELECT adv_name, city, params, adv_lat, adv_lon, discord_owner_id
            FROM belgian_nodes
            WHERE public_key = ? AND is_active = 1
        """, (public_key_normalized,))
        row = cursor.fetchone()
        
        if not row:
            return {'success': False, 'message': 'Node not found or inactive.'}
        
        if str(row['discord_owner_id']) != str(user_id):
            return {'success': False, 'message': 'You do not own this node.'}
        
        # Get current values
        current_name = row['adv_name']
        current_city = row['city']
        current_params = json_deserialize(row['params']) if row['params'] else {}
        current_lat = row['adv_lat']
        current_lon = row['adv_lon']
        
        # Track changes
        changes = {}
        
        # Build update query
        updates = []
        params_list = []
        
        if name is not None and name != current_name:
            updates.append("adv_name = ?")
            params_list.append(name)
            changes['name'] = {'old': current_name, 'new': name}
        
        if city is not None and city != current_city:
            updates.append("city = ?")
            params_list.append(city)
            changes['city'] = {'old': current_city, 'new': city}
        
        if params is not None:
            # Compare params (convert to dict if needed)
            if isinstance(current_params, str):
                current_params = json_deserialize(current_params) or {}
            if params != current_params:
                updates.append("params = ?")
                params_list.append(json_serialize(params))
                changes['params'] = {'old': current_params, 'new': params}
        
        if adv_lat is not None:
            # Check if value actually changed (handles None -> value and value -> value)
            if adv_lat != current_lat:
                updates.append("adv_lat = ?")
                params_list.append(adv_lat)
                changes['latitude'] = {'old': current_lat, 'new': adv_lat}
        
        if adv_lon is not None:
            # Check if value actually changed (handles None -> value and value -> value)
            if adv_lon != current_lon:
                updates.append("adv_lon = ?")
                params_list.append(adv_lon)
                changes['longitude'] = {'old': current_lon, 'new': adv_lon}
        
        if not updates:
            return {'success': False, 'message': 'No changes to apply.'}
        
        # Add discord_updated_date
        updates.append("discord_updated_date = ?")
        params_list.append(get_current_timestamp())
        
        # Add WHERE clause
        params_list.append(public_key_normalized)
        
        # Execute update
        query = f"""
            UPDATE belgian_nodes
            SET {', '.join(updates)}
            WHERE public_key = ?
        """
        cursor.execute(query, params_list)
        
        conn.commit()
        return {'success': True, 'changes': changes}
        
    except Exception as e:
        print(f"Error updating node properties: {e}")
        conn.rollback()
        return {'success': False, 'message': f'Database error: {str(e)}'}
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
        
    except Exception as e:
        print(f"Error verifying ownership: {e}")
        return False
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
        
    except Exception as e:
        print(f"Error getting node by key: {e}")
        return None
    finally:
        conn.close()
