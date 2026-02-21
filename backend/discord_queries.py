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


def get_statistics() -> Dict[str, Any]:
    """
    Get statistics about Belgian nodes.
    Only counts active nodes.
    
    Returns:
        Dictionary with statistics:
        - total_nodes: Total active nodes
        - claimed_nodes: Nodes with Discord owner
        - unclaimed_nodes: Nodes without Discord owner
        - registered_users: Unique Discord users who own nodes
        - by_type: Count by node type
        - top_cities: Top cities by node count
        - total_cities: Total number of unique cities
        - recently_added: Recently added nodes (last 7 days)
    """
    conn = get_connection()
    cursor = conn.cursor()
    
    try:
        stats = {}
        
        # Total active nodes
        cursor.execute("""
            SELECT COUNT(*) FROM belgian_nodes
            WHERE is_active = 1
        """)
        stats['total_nodes'] = cursor.fetchone()[0]
        
        # Claimed nodes (with Discord owner)
        cursor.execute("""
            SELECT COUNT(*) FROM belgian_nodes
            WHERE is_active = 1 AND discord_owner_id IS NOT NULL
        """)
        stats['claimed_nodes'] = cursor.fetchone()[0]
        
        # Unclaimed nodes
        stats['unclaimed_nodes'] = stats['total_nodes'] - stats['claimed_nodes']
        
        # Registered users (unique Discord owners)
        cursor.execute("""
            SELECT COUNT(DISTINCT discord_owner_id) FROM belgian_nodes
            WHERE is_active = 1 AND discord_owner_id IS NOT NULL
        """)
        stats['registered_users'] = cursor.fetchone()[0]
        
        # Count by type
        cursor.execute("""
            SELECT type, COUNT(*) as count
            FROM belgian_nodes
            WHERE is_active = 1
            GROUP BY type
            ORDER BY type
        """)
        stats['by_type'] = {row['type']: row['count'] for row in cursor.fetchall()}
        
        # Top cities (limit to top 10)
        cursor.execute("""
            SELECT city, COUNT(*) as count
            FROM belgian_nodes
            WHERE is_active = 1 AND city IS NOT NULL AND city != 'Unknown'
            GROUP BY city
            ORDER BY count DESC
            LIMIT 10
        """)
        stats['top_cities'] = [
            {'city': row['city'], 'count': row['count']}
            for row in cursor.fetchall()
        ]
        
        # Top cities by repeater count only (type=2)
        cursor.execute("""
            SELECT city, COUNT(*) as count
            FROM belgian_nodes
            WHERE is_active = 1 AND type = 2 AND city IS NOT NULL AND city != 'Unknown'
            GROUP BY city
            ORDER BY count DESC
            LIMIT 10
        """)
        stats['top_cities_repeaters'] = [
            {'city': row['city'], 'count': row['count']}
            for row in cursor.fetchall()
        ]
        
        # Top cities by companion count only (type=1)
        cursor.execute("""
            SELECT city, COUNT(*) as count
            FROM belgian_nodes
            WHERE is_active = 1 AND type = 1 AND city IS NOT NULL AND city != 'Unknown'
            GROUP BY city
            ORDER BY count DESC
            LIMIT 10
        """)
        stats['top_cities_companions'] = [
            {'city': row['city'], 'count': row['count']}
            for row in cursor.fetchall()
        ]
        
        # Total unique cities
        cursor.execute("""
            SELECT COUNT(DISTINCT city) FROM belgian_nodes
            WHERE is_active = 1 AND city IS NOT NULL AND city != 'Unknown'
        """)
        stats['total_cities'] = cursor.fetchone()[0]
        
        # Recently added nodes (last 7 days)
        # Note: This uses created_at field, which tracks when node was added to our DB
        cursor.execute("""
            SELECT COUNT(*) FROM belgian_nodes
            WHERE is_active = 1
            AND created_at >= datetime('now', '-7 days')
        """)
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
        cursor.execute("""
            SELECT 
                inserted_date,
                updated_date,
                last_advert,
                discord_updated_date
            FROM belgian_nodes
            WHERE is_active = 1
        """)
        
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


def get_cities_with_counts() -> List[Dict[str, Any]]:
    """
    Get all cities with node counts, sorted by count (descending).
    
    Returns:
        List of dictionaries with 'city' and 'count' keys.
    """
    conn = get_connection()
    cursor = conn.cursor()
    
    try:
        cursor.execute("""
            SELECT city, COUNT(*) as count
            FROM belgian_nodes
            WHERE is_active = 1 AND city IS NOT NULL AND city != 'Unknown'
            GROUP BY city
            ORDER BY count DESC
        """)
        
        return [
            {'city': row['city'], 'count': row['count']}
            for row in cursor.fetchall()
        ]
    except Exception as e:
        print(f"Error getting cities with counts: {e}")
        return []
    finally:
        conn.close()


def get_frequency_stats_by_type() -> Dict[int, Dict[str, Any]]:
    """
    Get frequency preset statistics broken down by node type.
    
    Returns:
        Dictionary mapping node type (1-4) to frequency stats:
        {
            type: {
                'presets': {preset_name: count},
                'custom': count,
                'unknown': count,
                'total': count
            }
        }
    """
    conn = get_connection()
    cursor = conn.cursor()
    
    try:
        # Get all active nodes with their type and params
        cursor.execute("""
            SELECT type, params
            FROM belgian_nodes
            WHERE is_active = 1
        """)
        
        from backend.database import json_deserialize
        from config.config import FREQUENCY_PRESETS
        
        # Initialize stats for each type
        stats_by_type = {
            1: {'presets': {}, 'custom': 0, 'unknown': 0, 'total': 0},
            2: {'presets': {}, 'custom': 0, 'unknown': 0, 'total': 0},
            3: {'presets': {}, 'custom': 0, 'unknown': 0, 'total': 0},
            4: {'presets': {}, 'custom': 0, 'unknown': 0, 'total': 0}
        }
        
        for row in cursor.fetchall():
            node_type = row['type']
            if node_type not in stats_by_type:
                continue
            
            stats_by_type[node_type]['total'] += 1
            
            params_str = row['params']
            if not params_str:
                stats_by_type[node_type]['unknown'] += 1
                continue
            
            try:
                params = json_deserialize(params_str) if isinstance(params_str, str) else params_str
                if not params or not isinstance(params, dict):
                    stats_by_type[node_type]['unknown'] += 1
                    continue
                
                # Try to match preset
                matched = False
                for preset in FREQUENCY_PRESETS:
                    # Use tolerance for float comparison (freq) to handle floating point precision
                    if (abs(params.get('freq', 0) - preset['freq']) < 0.001 and
                        params.get('sf') == preset['sf'] and
                        params.get('bw') == preset['bw'] and
                        params.get('cr') == preset['cr']):
                        preset_name = preset['name']
                        stats_by_type[node_type]['presets'][preset_name] = stats_by_type[node_type]['presets'].get(preset_name, 0) + 1
                        matched = True
                        break
                
                if not matched:
                    stats_by_type[node_type]['custom'] += 1
            except Exception:
                stats_by_type[node_type]['unknown'] += 1
        
        return stats_by_type
    except Exception as e:
        print(f"Error getting frequency stats by type: {e}")
        return {1: {'presets': {}, 'custom': 0, 'unknown': 0, 'total': 0},
                2: {'presets': {}, 'custom': 0, 'unknown': 0, 'total': 0},
                3: {'presets': {}, 'custom': 0, 'unknown': 0, 'total': 0},
                4: {'presets': {}, 'custom': 0, 'unknown': 0, 'total': 0}}
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


def claim_and_update_node(
    public_key: str,
    user_id: str,
    username: str,
    use_new_details: bool,
    new_details: Optional[Dict[str, Any]] = None
) -> Dict[str, Any]:
    """
    Claim an existing active node and optionally update its details.
    
    Args:
        public_key: Public key of the node (will be normalized to lowercase).
        user_id: Discord user ID.
        username: Discord username.
        use_new_details: If True, update node with new_details, else keep existing.
        new_details: Dictionary with new node details (name, city, params, lat, lon, link).
    
    Returns:
        Dictionary with 'success' (bool) and 'message' (str) or 'node' (dict).
    """
    conn = get_connection()
    cursor = conn.cursor()
    
    try:
        # Normalize public key: remove spaces, dashes, convert to lowercase
        # This matches the normalization in get_node_by_key
        public_key_normalized = public_key.replace(' ', '').replace('-', '').lower()
        
        # Get current node
        cursor.execute("SELECT * FROM belgian_nodes WHERE public_key = ? AND is_active = 1", (public_key_normalized,))
        row = cursor.fetchone()
        if not row:
            return {'success': False, 'message': 'Node not found or inactive.'}
        
        current_node = dict_from_row(row)
        
        # Check if already claimed
        if current_node.get('discord_owner_id'):
            return {'success': False, 'message': 'This node is already claimed by another user.'}
        
        # Update ownership
        updates = []
        params = []
        
        updates.append("discord_owner_id = ?")
        params.append(str(user_id))
        updates.append("discord_owner_name = ?")
        params.append(username)
        updates.append("discord_updated_date = ?")
        params.append(get_current_timestamp())
        
        # Update details if requested
        if use_new_details and new_details:
            if 'adv_name' in new_details and new_details['adv_name']:
                updates.append("adv_name = ?")
                params.append(new_details['adv_name'])
            if 'city' in new_details and new_details['city']:
                updates.append("city = ?")
                params.append(new_details['city'])
            if 'params' in new_details and new_details['params']:
                updates.append("params = ?")
                params.append(json_serialize(new_details['params']))
            if 'adv_lat' in new_details and new_details['adv_lat'] is not None:
                updates.append("adv_lat = ?")
                params.append(new_details['adv_lat'])
            if 'adv_lon' in new_details and new_details['adv_lon'] is not None:
                updates.append("adv_lon = ?")
                params.append(new_details['adv_lon'])
            if 'link' in new_details and new_details['link']:
                updates.append("link = ?")
                params.append(new_details['link'])
        
        params.append(public_key_normalized)
        
        query = f"""
            UPDATE belgian_nodes
            SET {', '.join(updates)}
            WHERE public_key = ?
        """
        cursor.execute(query, params)
        conn.commit()
        
        # Fetch updated node
        cursor.execute("SELECT * FROM belgian_nodes WHERE public_key = ?", (public_key_normalized,))
        row = cursor.fetchone()
        if row:
            node = dict_from_row(row)
            # Deserialize JSON fields - ensure params is always a dict
            if 'params' in node and node['params'] is not None:
                if isinstance(node['params'], str):
                    # Try to deserialize JSON string
                    if node['params'].strip():
                        try:
                            deserialized = json_deserialize(node['params'])
                            node['params'] = deserialized if deserialized is not None else {}
                        except Exception as e:
                            print(f"Warning: Failed to deserialize params for node {public_key[:8]}...: {e}")
                            node['params'] = {}
                    else:
                        node['params'] = {}
                elif isinstance(node['params'], dict):
                    # Already a dict, use as is
                    pass
                else:
                    node['params'] = {}
            else:
                node['params'] = {}
            return {'success': True, 'node': node}
        else:
            return {'success': False, 'message': 'Node updated but could not be retrieved.'}
            
    except Exception as e:
        conn.rollback()
        print(f"Error claiming and updating node: {e}")
        return {'success': False, 'message': f'Database error: {str(e)}'}
    finally:
        conn.close()


def reactivate_and_claim_node(
    public_key: str,
    user_id: str,
    username: str,
    use_new_details: bool,
    new_details: Optional[Dict[str, Any]] = None
) -> Dict[str, Any]:
    """
    Reactivate an inactive node, claim it, and optionally update its details.
    
    Args:
        public_key: Public key of the node (will be normalized to lowercase).
        user_id: Discord user ID.
        username: Discord username.
        use_new_details: If True, update node with new_details, else keep existing.
        new_details: Dictionary with new node details (name, city, params, lat, lon, link).
    
    Returns:
        Dictionary with 'success' (bool) and 'message' (str) or 'node' (dict).
    """
    conn = get_connection()
    cursor = conn.cursor()
    
    try:
        # Normalize public key: remove spaces, dashes, convert to lowercase
        # This matches the normalization in get_node_by_key
        public_key_normalized = public_key.replace(' ', '').replace('-', '').lower()
        
        # Get current node (including inactive)
        cursor.execute("SELECT * FROM belgian_nodes WHERE public_key = ?", (public_key_normalized,))
        row = cursor.fetchone()
        if not row:
            return {'success': False, 'message': 'Node not found.'}
        
        current_node = dict_from_row(row)
        
        # Check if already claimed
        if current_node.get('discord_owner_id'):
            return {'success': False, 'message': 'This node is already claimed by another user.'}
        
        # Build updates
        updates = []
        params = []
        
        # Reactivate
        updates.append("is_active = 1")
        updates.append("removed_from_official = 0")
        updates.append("removed_date = NULL")
        
        # Update ownership
        updates.append("discord_owner_id = ?")
        params.append(str(user_id))
        updates.append("discord_owner_name = ?")
        params.append(username)
        updates.append("discord_updated_date = ?")
        params.append(get_current_timestamp())
        
        # Update details if requested
        if use_new_details and new_details:
            if 'adv_name' in new_details and new_details['adv_name']:
                updates.append("adv_name = ?")
                params.append(new_details['adv_name'])
            if 'city' in new_details and new_details['city']:
                updates.append("city = ?")
                params.append(new_details['city'])
            if 'params' in new_details and new_details['params']:
                updates.append("params = ?")
                params.append(json_serialize(new_details['params']))
            if 'adv_lat' in new_details and new_details['adv_lat'] is not None:
                updates.append("adv_lat = ?")
                params.append(new_details['adv_lat'])
            if 'adv_lon' in new_details and new_details['adv_lon'] is not None:
                updates.append("adv_lon = ?")
                params.append(new_details['adv_lon'])
            if 'link' in new_details and new_details['link']:
                updates.append("link = ?")
                params.append(new_details['link'])
        
        params.append(public_key_normalized)
        
        query = f"""
            UPDATE belgian_nodes
            SET {', '.join(updates)}
            WHERE public_key = ?
        """
        cursor.execute(query, params)
        conn.commit()
        
        # Fetch updated node
        cursor.execute("SELECT * FROM belgian_nodes WHERE public_key = ?", (public_key_normalized,))
        row = cursor.fetchone()
        if row:
            node = dict_from_row(row)
            # Deserialize JSON fields - ensure params is always a dict
            if 'params' in node and node['params'] is not None:
                if isinstance(node['params'], str):
                    # Try to deserialize JSON string
                    if node['params'].strip():
                        try:
                            deserialized = json_deserialize(node['params'])
                            node['params'] = deserialized if deserialized is not None else {}
                        except Exception as e:
                            print(f"Warning: Failed to deserialize params for node {public_key[:8]}...: {e}")
                            node['params'] = {}
                    else:
                        node['params'] = {}
                elif isinstance(node['params'], dict):
                    # Already a dict, use as is
                    pass
                else:
                    node['params'] = {}
            else:
                node['params'] = {}
            return {'success': True, 'node': node}
        else:
            return {'success': False, 'message': 'Node reactivated but could not be retrieved.'}
            
    except Exception as e:
        conn.rollback()
        print(f"Error reactivating and claiming node: {e}")
        return {'success': False, 'message': f'Database error: {str(e)}'}
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


def get_recently_updated_nodes(limit: int = 25, days: Optional[int] = None) -> List[Dict[str, Any]]:
    """
    Get recently added/updated nodes based on the most recent of 4 date types:
    - inserted_date
    - updated_date
    - last_advert
    - discord_updated_date
    
    Uses SQL to calculate the most recent date and order by it.
    
    Args:
        limit: Maximum number of results to return (default 25).
        days: Optional filter to only show nodes updated in the last N days.
    
    Returns:
        List of node dictionaries ordered by most recent date (newest first).
    """
    conn = get_connection()
    try:
        cursor = conn.cursor()
        
        # SQLite MAX() function can take multiple arguments
        # Convert dates to timestamps (julianday) for proper comparison
        # Use COALESCE to handle NULL values (default to 0 if NULL)
        query = """
            SELECT *,
                MAX(
                    COALESCE(
                        CASE WHEN inserted_date IS NOT NULL AND inserted_date != '' 
                            THEN julianday(inserted_date) ELSE NULL END,
                        0
                    ),
                    COALESCE(
                        CASE WHEN updated_date IS NOT NULL AND updated_date != '' 
                            THEN julianday(updated_date) ELSE NULL END,
                        0
                    ),
                    COALESCE(
                        CASE WHEN last_advert IS NOT NULL AND last_advert != '' 
                            THEN julianday(last_advert) ELSE NULL END,
                        0
                    ),
                    COALESCE(
                        CASE WHEN discord_updated_date IS NOT NULL AND discord_updated_date != '' 
                            THEN julianday(discord_updated_date) ELSE NULL END,
                        0
                    )
                ) as most_recent_julianday
            FROM belgian_nodes
            WHERE is_active = 1
        """
        
        params = []
        
        # Add date filter if specified
        if days is not None:
            query += """
                AND (
                    (inserted_date IS NOT NULL AND inserted_date != '' AND julianday(inserted_date) > julianday('now', '-' || ? || ' days'))
                    OR (updated_date IS NOT NULL AND updated_date != '' AND julianday(updated_date) > julianday('now', '-' || ? || ' days'))
                    OR (last_advert IS NOT NULL AND last_advert != '' AND julianday(last_advert) > julianday('now', '-' || ? || ' days'))
                    OR (discord_updated_date IS NOT NULL AND discord_updated_date != '' AND julianday(discord_updated_date) > julianday('now', '-' || ? || ' days'))
                )
            """
            params.extend([str(days), str(days), str(days), str(days)])
        
        # Order by most recent date (newest first)
        query += """
            ORDER BY most_recent_julianday DESC
            LIMIT ?
        """
        params.append(limit)
        
        cursor.execute(query, params)
        rows = cursor.fetchall()
        
        nodes = []
        for row in rows:
            node = dict_from_row(row)
            # Ensure params is always a dict (deserialize if needed)
            if 'params' in node and node['params'] is not None:
                if isinstance(node['params'], str):
                    # Try to deserialize JSON string
                    if node['params'].strip():
                        try:
                            node['params'] = json_deserialize(node['params']) or {}
                        except Exception:
                            node['params'] = {}
                    else:
                        node['params'] = {}
                elif not isinstance(node['params'], dict):
                    node['params'] = {}
            else:
                node['params'] = {}
            nodes.append(node)
        
        return nodes
        
    except Exception as e:
        print(f"Error getting recently updated nodes: {e}")
        return []
    finally:
        conn.close()


def can_delete_node(public_key: str, user_id: str) -> Dict[str, Any]:
    """
    Check if a node can be deleted by a user.
    
    A node can be deleted if:
    1. User owns the node
    2. AND one of the following:
       - source = 'discord' (registered via Discord)
       - synced_from_official = FALSE (never detected by official map)
       - removed_from_official = TRUE (was removed from official map)
    
    Args:
        public_key: Public key of the node (will be normalized to lowercase).
        user_id: Discord user ID.
    
    Returns:
        Dictionary with 'can_delete' (bool) and 'reason' (str) if cannot delete.
    """
    conn = get_connection()
    cursor = conn.cursor()
    
    try:
        # Normalize public key: remove spaces, dashes, convert to lowercase
        # This matches the normalization in get_node_by_key
        public_key_normalized = public_key.replace(' ', '').replace('-', '').lower()
        
        # Get node details
        cursor.execute("""
            SELECT discord_owner_id, source, synced_from_official, removed_from_official
            FROM belgian_nodes
            WHERE public_key = ?
        """, (public_key_normalized,))
        
        row = cursor.fetchone()
        if not row:
            return {'can_delete': False, 'reason': 'Node not found.'}
        
        node = dict_from_row(row)
        
        # Check ownership
        if str(node.get('discord_owner_id')) != str(user_id):
            return {'can_delete': False, 'reason': 'You do not own this node.'}
        
        # Check deletion criteria
        source = node.get('source', '').lower() if node.get('source') else ''
        synced_from_official = node.get('synced_from_official', 0)
        removed_from_official = node.get('removed_from_official', 0)
        
        can_delete = (
            source == 'discord' or
            synced_from_official == 0 or
            removed_from_official == 1
        )
        
        if not can_delete:
            return {
                'can_delete': False,
                'reason': 'This node cannot be deleted because it is currently active on the official map. '
                         'Only Discord-registered nodes or nodes removed from the official map can be deleted.'
            }
        
        return {'can_delete': True}
        
    except Exception as e:
        print(f"Error checking if node can be deleted: {e}")
        return {'can_delete': False, 'reason': f'Database error: {str(e)}'}
    finally:
        conn.close()


def delete_node(public_key: str, user_id: str) -> Dict[str, Any]:
    """
    Permanently delete a node from the database.
    
    Only works if can_delete_node() returns True.
    
    Args:
        public_key: Public key of the node to delete (will be normalized to lowercase).
        user_id: Discord user ID (for verification).
    
    Returns:
        Dictionary with 'success' (bool) and 'message' (str).
    """
    conn = get_connection()
    cursor = conn.cursor()
    
    try:
        # Normalize public key: remove spaces, dashes, convert to lowercase
        # This matches the normalization in get_node_by_key
        public_key_normalized = public_key.replace(' ', '').replace('-', '').lower()
        
        # Verify deletion is allowed
        check_result = can_delete_node(public_key_normalized, user_id)
        if not check_result['can_delete']:
            return {
                'success': False,
                'message': check_result.get('reason', 'Node cannot be deleted.')
            }
        
        # Get node data for logging before deletion
        cursor.execute("SELECT * FROM belgian_nodes WHERE public_key = ?", (public_key_normalized,))
        node_row = cursor.fetchone()
        node_data = dict_from_row(node_row) if node_row else None
        
        # Delete the node
        cursor.execute("DELETE FROM belgian_nodes WHERE public_key = ?", (public_key_normalized,))
        
        # Log deletion
        if node_data:
            cursor.execute("""
                INSERT INTO node_changes (
                    public_key, change_type, sync_date, old_data
                ) VALUES (?, ?, ?, ?)
            """, (
                public_key_normalized,
                'deleted',
                get_current_timestamp(),
                json_serialize(node_data)
            ))
        
        conn.commit()
        return {'success': True, 'message': 'Node deleted successfully.'}
        
    except Exception as e:
        conn.rollback()
        print(f"Error deleting node: {e}")
        return {'success': False, 'message': f'Database error: {str(e)}'}
    finally:
        conn.close()
