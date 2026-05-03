"""
Sync Service for RRY-Map-Bot
Downloads nodes from official MeshCore map, filters for Belgian nodes,
verifies each node with the local Belgian geocoder (``backend.belgian_geocoder``)
and integrates changes into the database.

Geopy/Nominatim is kept as an optional fallback, enabled via ``--use-geopy``
or ``USE_GEOPY_FALLBACK=1`` (and auto-used when the municipalities GeoJSON
is missing).
"""

import requests
import time
import sys
import os
from typing import Dict, List, Any, Optional, Set
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

# Geopy is now optional (fallback only); gate the import so a missing geopy
# install doesn't break the default local-geocoder path.
try:
    from geopy.geocoders import Nominatim  # type: ignore
    from geopy.exc import (  # type: ignore
        GeocoderTimedOut,
        GeocoderServiceError,
        GeocoderUnavailable,
    )
    _GEOPY_AVAILABLE = True
except ImportError:  # pragma: no cover - optional
    Nominatim = None  # type: ignore
    GeocoderTimedOut = GeocoderServiceError = GeocoderUnavailable = Exception  # type: ignore
    _GEOPY_AVAILABLE = False

# Add parent directory to path for imports
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

try:
    from config.config import (
        OFFICIAL_API_URL,
        BELGIUM_BOUNDS,
        GEOPY_USER_AGENT,
        GEOPY_TIMEOUT,
        SYNC_INTERVAL_MINUTES,
    )
except (ImportError, ModuleNotFoundError):
    # Fallback if config not available
    OFFICIAL_API_URL = 'https://map.meshcore.io/api/v1/nodes'
    BELGIUM_BOUNDS = {
        'min_lat': 49.5,
        'max_lat': 51.5,
        'min_lon': 2.5,
        'max_lon': 6.4
    }
    GEOPY_USER_AGENT = 'belgian_meshcore_map'
    GEOPY_TIMEOUT = 10
    SYNC_INTERVAL_MINUTES = int(os.getenv('SYNC_INTERVAL_MINUTES', str(int(os.getenv('SYNC_INTERVAL_HOURS', '6')) * 60)))

from backend.database import (
    get_connection,
    get_db_path,
    init_database,
    json_serialize,
    json_deserialize,
    get_current_timestamp,
    dict_from_row
)
import sqlite3
from pathlib import Path

# Safety: skip applying removals if count exceeds this (avoids mass delete on API/network issues)
REMOVAL_SAFETY_MAX_ABSOLUTE = 25
REMOVAL_SAFETY_MAX_PERCENT_OF_ACTIVE = 0.05  # 5%


def _geocode_failures_log_path() -> Path:
    """Path for the verification-failures log (same directory as DB).

    Used by both the local geocoder and the Geopy fallback. File name kept
    neutral so operators don't have to chase two separate logs.
    """
    return Path(get_db_path()).parent / "geocode_failures.log"


# Backwards-compatible alias; older callers may still import this name.
_geopy_failures_log_path = _geocode_failures_log_path


def _log_geocode_failure(
    public_key: str,
    reason: str,
    lat: Optional[float],
    lon: Optional[float],
    kept_from_db: bool,
    source: str = "local",
) -> None:
    """Append one line to the geocode-failures log.

    Columns: ``ts\tpublic_key\tlat\tlon\taction\tsource\treason``.
    ``source`` is either ``local`` (BelgianGeocoder miss) or ``geopy`` (Nominatim failure).
    """
    try:
        log_path = _geocode_failures_log_path()
        log_path.parent.mkdir(parents=True, exist_ok=True)
        ts = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
        action = "kept_from_db" if kept_from_db else "dropped"
        line = f"{ts}\t{public_key}\t{lat}\t{lon}\t{action}\t{source}\t{reason}\n"
        with open(log_path, "a", encoding="utf-8") as f:
            f.write(line)
    except OSError:
        pass  # Do not fail sync if logging fails


# Back-compat alias for the legacy name used in older code paths.
_log_geopy_failure = _log_geocode_failure


def download_official_nodes() -> List[Dict[str, Any]]:
    """
    Download all nodes from the official MeshCore map API.
    
    Returns:
        List of node dictionaries from the official API.
    """
    try:
        print(f"Downloading nodes from {OFFICIAL_API_URL}...")
        response = requests.get(OFFICIAL_API_URL, timeout=30)
        response.raise_for_status()
        nodes = response.json()
        print(f"Downloaded {len(nodes)} nodes from official API")
        return nodes
    except requests.exceptions.RequestException as e:
        print(f"Error downloading nodes: {e}")
        raise


def filter_by_bounds(nodes: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """
    Filter nodes by Belgian geographic bounds.
    
    Args:
        nodes: List of node dictionaries from official API.
    
    Returns:
        List of nodes within Belgian bounds.
    """
    filtered = []
    skipped_no_coords = 0
    
    for node in nodes:
        lat = node.get('adv_lat')
        lon = node.get('adv_lon')
        
        # Skip nodes without coordinates
        if lat is None or lon is None:
            skipped_no_coords += 1
            continue
        
        # Check if within Belgian bounds
        if (BELGIUM_BOUNDS['min_lat'] <= lat <= BELGIUM_BOUNDS['max_lat'] and
            BELGIUM_BOUNDS['min_lon'] <= lon <= BELGIUM_BOUNDS['max_lon']):
            filtered.append(node)
    
    print(f"Filtered by bounds: {len(filtered)} nodes within Belgian bounds "
          f"(skipped {skipped_no_coords} nodes without coordinates)")
    return filtered


def verify_with_local_geocoder(
    node: Dict[str, Any], geocoder: "Any"
) -> Dict[str, Any]:
    """Verify a node is in Belgium and extract the gemeente using the local geocoder.

    Returns a dict with ``verified`` (bool), plus either ``city`` / ``nis5`` /
    ``province_code`` on a hit or ``reason`` on a miss. Mirrors the shape of
    :func:`verify_with_geopy` so the rest of the pipeline is unchanged.
    """
    lat = node.get('adv_lat')
    lon = node.get('adv_lon')

    if lat is None or lon is None:
        return {'verified': False, 'reason': 'No coordinates'}

    try:
        result = geocoder.geocode(lat, lon)
    except Exception as e:  # pragma: no cover - defensive
        return {'verified': False, 'reason': f'Local geocoder error: {e}'}

    if result is None:
        return {'verified': False, 'reason': 'Outside Belgium (local geocoder)'}

    return {
        'verified': True,
        'city': result.get('plaats') or 'Unknown',
        'nis5': result.get('nis5'),
        'province_code': result.get('province_code'),
    }


def verify_nodes_locally(
    nodes: List[Dict[str, Any]],
    previous_nodes: Optional[Dict[str, Dict[str, Any]]] = None,
    geocoder: Optional["Any"] = None,
) -> List[Dict[str, Any]]:
    """Verify nodes with the local Belgian geocoder (no network, no rate limit).

    Semantics match :func:`verify_nodes_with_geopy`:
    - Local hit → keep node, set ``city`` from the canonical ``plaats`` label.
    - Local miss but node is already in DB → keep node with its DB city.
    - Local miss and node is new → drop.
    Failures are logged to ``<db_dir>/geocode_failures.log`` with ``source=local``.
    """
    if geocoder is None:
        from backend.belgian_geocoder import get_geocoder as _gg
        geocoder = _gg()

    previous_nodes = previous_nodes or {}
    verified_nodes: List[Dict[str, Any]] = []
    verified_count = 0
    failed_kept_from_db = 0
    failed_dropped = 0

    print(f"Verifying {len(nodes)} nodes with local Belgian geocoder "
          f"({len(geocoder)} gemeenten, buffer {geocoder.buffer_m:.0f} m)...")

    t0 = time.time()
    for node in nodes:
        result = verify_with_local_geocoder(node, geocoder)

        if result['verified']:
            node['city'] = result['city']
            if result.get('nis5'):
                node['nis5'] = result['nis5']
            if result.get('province_code'):
                node['province_code'] = result['province_code']
            verified_nodes.append(node)
            verified_count += 1
        else:
            key = node.get('public_key')
            kept = bool(key and key in previous_nodes)
            if kept:
                node['city'] = previous_nodes[key].get('city')
                verified_nodes.append(node)
                failed_kept_from_db += 1
            else:
                failed_dropped += 1
            _log_geocode_failure(
                key or "",
                result.get("reason", "unknown"),
                node.get("adv_lat"),
                node.get("adv_lon"),
                kept_from_db=kept,
                source="local",
            )

    elapsed = time.time() - t0
    rate = (len(nodes) / elapsed) if elapsed > 0 else float('inf')
    print(f"Local geocoding complete: {verified_count} Belgian verified, "
          f"{failed_kept_from_db} kept from DB, {failed_dropped} dropped "
          f"({elapsed:.2f}s, {rate:.0f} nodes/s)")
    return verified_nodes


def verify_with_geopy(node: Dict[str, Any], geolocator: Nominatim) -> Dict[str, Any]:
    """
    Verify node is in Belgium and extract city using Geopy.
    
    Args:
        node: Node dictionary with adv_lat and adv_lon.
        geolocator: Geopy Nominatim geolocator instance.
    
    Returns:
        Dictionary with 'verified' (bool) and 'city' (str) or 'reason' (str).
    """
    lat = node.get('adv_lat')
    lon = node.get('adv_lon')
    
    if lat is None or lon is None:
        return {'verified': False, 'reason': 'No coordinates'}
    
    try:
        # Use native language (don't specify language parameter to get native names)
        location = geolocator.reverse(
            f"{lat}, {lon}",
            timeout=GEOPY_TIMEOUT
            # No language parameter = native/local name
        )
        
        if location and location.raw.get('address'):
            address = location.raw['address']
            country = address.get('country_code', '').upper()
            
            if country == 'BE':
                # Extract city from various possible fields (native name)
                # Try to get the native name from the address
                city = (address.get('city') or
                       address.get('town') or
                       address.get('village') or
                       address.get('municipality') or
                       address.get('city_district') or
                       'Unknown')
                return {'verified': True, 'city': city}
            else:
                return {'verified': False, 'reason': f'Country is {country}, not BE'}
        else:
            return {'verified': False, 'reason': 'No location data from Geopy'}
            
    except (GeocoderTimedOut, GeocoderServiceError, GeocoderUnavailable) as e:
        return {'verified': False, 'reason': f'Geopy error: {str(e)}'}
    except Exception as e:
        return {'verified': False, 'reason': f'Unexpected error: {str(e)}'}


def verify_nodes_with_geopy(nodes: List[Dict[str, Any]], 
                            delay: float = 1.5,
                            previous_nodes: Optional[Dict[str, Dict[str, Any]]] = None) -> List[Dict[str, Any]]:
    """
    Verify nodes with Geopy, respecting rate limits.
    - If Geopy confirms Belgium: keep node and set city from Geopy.
    - If Geopy fails but node is already in DB (previous_nodes): keep node and keep city from DB.
    - If Geopy fails and node is new: drop (do not add unverified new nodes).
    This avoids false "removed" for existing nodes when Geopy times out or rate-limits.
    
    Args:
        nodes: List of nodes to verify.
        delay: Delay between Geopy requests in seconds (default 1.5).
        previous_nodes: Optional dict of existing nodes from DB (public_key -> node). Used to keep
            nodes that fail Geopy but are already in the DB, preserving their city.
    
    Returns:
        List of verified Belgian nodes plus existing nodes that failed verification (with DB city).
    """
    geolocator = Nominatim(user_agent=GEOPY_USER_AGENT)
    previous_nodes = previous_nodes or {}
    verified_nodes = []
    verified_count = 0
    failed_kept_from_db = 0
    failed_dropped = 0
    
    print(f"Verifying {len(nodes)} nodes with Geopy (delay: {delay}s between requests)...")
    
    for i, node in enumerate(nodes, 1):
        result = verify_with_geopy(node, geolocator)
        
        if result['verified']:
            node['city'] = result['city']
            verified_nodes.append(node)
            verified_count += 1
        else:
            key = node.get('public_key')
            kept = key and key in previous_nodes
            if kept:
                node['city'] = previous_nodes[key].get('city')
                verified_nodes.append(node)
                failed_kept_from_db += 1
            else:
                failed_dropped += 1
            _log_geocode_failure(
                key or "",
                result.get("reason", "unknown"),
                node.get("adv_lat"),
                node.get("adv_lon"),
                kept_from_db=kept,
                source="geopy",
            )
        
        if i % 10 == 0:
            print(f"  Progress: {i}/{len(nodes)} verified ({verified_count} Belgian, "
                  f"{failed_kept_from_db} kept from DB, {failed_dropped} dropped)")
        
        # Rate limiting: delay between requests (except for last node)
        if i < len(nodes):
            time.sleep(delay)
    
    print(f"Geopy verification complete: {verified_count} Belgian nodes verified, "
          f"{failed_kept_from_db} kept from DB (Geopy failed), {failed_dropped} new nodes dropped")
    return verified_nodes


def load_previous_nodes_from_db() -> Dict[str, Dict[str, Any]]:
    """
    Load all nodes from database (both active and inactive).
    
    Returns:
        Dictionary mapping public_key to node dictionary.
    """
    conn = get_connection()
    cursor = conn.cursor()
    
    try:
        cursor.execute("""
            SELECT * FROM belgian_nodes
        """)
        rows = cursor.fetchall()
        nodes = {row['public_key']: dict_from_row(row) for row in rows}
        print(f"Loaded {len(nodes)} nodes from database")
        return nodes
    finally:
        conn.close()


def track_changes(current_nodes: List[Dict[str, Any]], 
                  previous_nodes: Dict[str, Dict[str, Any]]) -> Dict[str, Any]:
    """
    Track changes between current and previous state.
    
    Args:
        current_nodes: List of current nodes from official map.
        previous_nodes: Dictionary of previous nodes from database.
    
    Returns:
        Dictionary with added, removed, restored, and updated node lists.
    """
    # Public keys are already normalized from sync_belgian_nodes step 1
    current_keys = {node['public_key'] for node in current_nodes}
    previous_keys = set(previous_nodes.keys())
    
    # Added: in current but not in previous
    added_keys = current_keys - previous_keys
    
    # Removed: in previous but not in current (and was active)
    # Exception: Don't deactivate claimed Discord-registered nodes (source='discord' with discord_owner_id)
    removed_keys = {
        key for key in previous_keys - current_keys
        if previous_nodes[key].get('is_active', True)
        and not (
            previous_nodes[key].get('source', '').lower() == 'discord'
            and previous_nodes[key].get('discord_owner_id')
        )
    }
    
    # Track unclaimed Discord nodes that were deactivated in this cycle
    # These are nodes that:
    # - Are in removed_keys (were active and are now removed from official map)
    # - Have source='discord'
    # - Have no discord_owner_id (unclaimed)
    deactivated_unclaimed_discord_keys = {
        key for key in removed_keys
        if previous_nodes[key].get('source', '').lower() == 'discord'
        and not previous_nodes[key].get('discord_owner_id')
    }
    
    # Restored: in current and in previous but was inactive
    restored_keys = {
        key for key in current_keys & previous_keys
        if not previous_nodes[key].get('is_active', True)
    }
    
    # Updated: in both, active, and data may have changed
    updated_keys = {
        key for key in current_keys & previous_keys
        if previous_nodes[key].get('is_active', True)
    }
    
    return {
        'added': list(added_keys),
        'removed': list(removed_keys),
        'restored': list(restored_keys),
        'updated': list(updated_keys),
        'deactivated_unclaimed_discord': list(deactivated_unclaimed_discord_keys),  # New: track deactivated unclaimed Discord nodes in this cycle
        'added_count': len(added_keys),
        'removed_count': len(removed_keys),
        'restored_count': len(restored_keys),
        'updated_count': len(updated_keys),
        'deactivated_unclaimed_discord_count': len(deactivated_unclaimed_discord_keys)  # New: count
    }


def integrate_added_node(node: Dict[str, Any], conn) -> None:
    """
    Insert a new node into the database.
    
    Args:
        node: Node dictionary from official map.
        conn: Database connection.
    """
    cursor = conn.cursor()

    # Always stamp inserted_date: prefer the official feed's value, fall back to our
    # current scrape time so the stats chart / playback never rely on the pre-tracking
    # baseline bucket for newly-added rows. See STATS_PRE_TRACKING_BASELINE_DATE in
    # backend/api/app.py and scripts/backfill_inserted_date.py.
    inserted_date_value = node.get('inserted_date') or get_current_timestamp()

    try:
        cursor.execute("""
            INSERT INTO belgian_nodes (
                public_key, type, adv_name, adv_lat, adv_lon, city,
                last_advert, inserted_date, updated_date, params, link,
                source, inserted_by, updated_by,
                synced_from_official, last_sync_date, is_active
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, (
            node['public_key'],
            node.get('type'),
            node.get('adv_name'),
            node.get('adv_lat'),
            node.get('adv_lon'),
            node.get('city'),
            node.get('last_advert'),
            inserted_date_value,
            node.get('updated_date'),
            json_serialize(node.get('params')),
            node.get('link'),
            node.get('source'),
            node.get('inserted_by'),
            node.get('updated_by'),
            1,  # synced_from_official = TRUE
            get_current_timestamp(),
            1   # is_active = TRUE
        ))
        
        # Log change
        cursor.execute("""
            INSERT INTO node_changes (
                public_key, change_type, sync_date, new_data
            ) VALUES (?, ?, ?, ?)
        """, (
            node['public_key'],
            'added',
            get_current_timestamp(),
            json_serialize(node)
        ))
        
    except sqlite3.IntegrityError as e:
        print(f"Warning: Node {node.get('public_key', 'unknown')} already exists: {e}")
        raise


def integrate_removed_node(public_key: str, conn) -> None:
    """
    Mark a node as inactive (removed from official map).
    
    Args:
        public_key: Public key of the node to mark as removed (will be normalized to lowercase).
        conn: Database connection.
    """
    cursor = conn.cursor()
    
    # Normalize public key: remove spaces, dashes, convert to lowercase
    # This matches the normalization in get_node_by_key
    public_key_normalized = public_key.replace(' ', '').replace('-', '').lower()
    
    # Get current node data for logging
    cursor.execute("SELECT * FROM belgian_nodes WHERE public_key = ?", (public_key_normalized,))
    old_row = cursor.fetchone()
    old_data = dict_from_row(old_row) if old_row else None
    
    # Mark as inactive
    cursor.execute("""
        UPDATE belgian_nodes
        SET is_active = 0,
            removed_from_official = 1,
            removed_date = ?,
            last_sync_date = ?
        WHERE public_key = ?
    """, (
        get_current_timestamp(),
        get_current_timestamp(),
        public_key_normalized
    ))
    
    # Log change
    cursor.execute("""
        INSERT INTO node_changes (
            public_key, change_type, sync_date, old_data
        ) VALUES (?, ?, ?, ?)
    """, (
        public_key,
        'removed',
        get_current_timestamp(),
        json_serialize(old_data)
    ))


def restore_removed_node(node: Dict[str, Any], conn) -> None:
    """
    Restore a previously removed node when it reappears in official map.
    Updates ALL information from official map and reactivates node.
    Preserves Discord ownership fields.
    
    Args:
        node: Node dictionary from official map.
        conn: Database connection.
    """
    cursor = conn.cursor()
    
    # Normalize public key: remove spaces, dashes, convert to lowercase
    # This matches the normalization in get_node_by_key
    public_key_normalized = node['public_key'].replace(' ', '').replace('-', '').lower()
    
    # Get current node to preserve Discord ownership, source, and city
    cursor.execute("SELECT discord_owner_id, discord_owner_name, discord_updated_date, source, adv_lat, adv_lon, city FROM belgian_nodes WHERE public_key = ?", (public_key_normalized,))
    existing = cursor.fetchone()
    discord_owner_id = existing['discord_owner_id'] if existing else None
    discord_owner_name = existing['discord_owner_name'] if existing else None
    discord_updated_date = existing['discord_updated_date'] if existing else None
    current_source = existing['source'] if existing else None
    current_lat = existing['adv_lat'] if existing else None
    current_lon = existing['adv_lon'] if existing else None
    current_city = existing['city'] if existing else None
    
    # Use source from official map when restoring (if node is back on API as app/uploader, sync that)
    source_to_use = node.get('source')
    
    # Local geocoding is effectively free, so always re-geocode on restore when
    # the node has coordinates. Falls back to the current DB city only when the
    # incoming sync couldn't resolve a city (e.g. "kept from DB" path).
    new_lat = node.get('adv_lat')
    new_city = node.get('city')
    if new_lat is not None and new_city:
        city_to_use = new_city
    else:
        city_to_use = current_city
    
    # Update ALL fields from official map, reactivate, preserve Discord ownership and discord source
    cursor.execute("""
        UPDATE belgian_nodes
        SET is_active = 1,
            removed_from_official = 0,
            removed_date = NULL,
            type = ?,
            adv_name = ?,
            adv_lat = ?,
            adv_lon = ?,
            city = ?,
            last_advert = ?,
            updated_date = ?,
            params = ?,
            link = ?,
            source = ?,
            inserted_by = ?,
            updated_by = ?,
            last_sync_date = ?,
            discord_owner_id = ?,
            discord_owner_name = ?,
            discord_updated_date = ?
        WHERE public_key = ?
    """, (
        node.get('type'),
        node.get('adv_name'),
        node.get('adv_lat'),
        node.get('adv_lon'),
        city_to_use,  # Use determined city
        node.get('last_advert'),
        node.get('updated_date'),
        json_serialize(node.get('params')),
        node.get('link'),
        source_to_use,
        node.get('inserted_by'),
        node.get('updated_by'),
        get_current_timestamp(),
        discord_owner_id,  # Preserve Discord ownership
        discord_owner_name,  # Preserve Discord ownership
        discord_updated_date,  # Preserve Discord ownership
        public_key_normalized
    ))
    
    # Log restoration
    cursor.execute("""
        INSERT INTO node_changes (
            public_key, change_type, sync_date, new_data
        ) VALUES (?, ?, ?, ?)
    """, (
        public_key_normalized,
        'restored',
        get_current_timestamp(),
        json_serialize(node)
    ))


def should_preserve_discord_edit(db_node: Dict[str, Any], 
                                  official_node: Dict[str, Any], 
                                  field: str) -> bool:
    """
    Determine if Discord user edit should be preserved for a field.
    
    Args:
        db_node: Node from database.
        official_node: Node from official map.
        field: Field name to check.
    
    Returns:
        True if Discord edit should be preserved, False if official map should win.
    """
    # If Discord never edited this field, official map wins
    if not db_node.get('discord_updated_date'):
        return False
    
    # If official map updated_date is newer than discord_updated_date, official wins
    official_updated = official_node.get('updated_date')
    discord_updated = db_node.get('discord_updated_date')
    
    if not official_updated:
        return True  # No official update, preserve Discord edit
    
    # Compare timestamps
    try:
        # Handle different timestamp formats
        # ISO format: "2025-01-15T14:30:00" or "2025-01-15T14:30:00.123456"
        # Space format: "2025-01-15 14:30:00"
        # Normalize formats
        official_normalized = official_updated.replace('Z', '+00:00').replace(' ', 'T')
        discord_normalized = discord_updated.replace('Z', '+00:00').replace(' ', 'T')
        
        # Parse timestamps
        official_dt = datetime.fromisoformat(official_normalized)
        discord_dt = datetime.fromisoformat(discord_normalized)
        
        # Make both timezone-aware or both timezone-naive for comparison
        # If one is aware and one is naive, make both naive (assume UTC for naive)
        if official_dt.tzinfo is None and discord_dt.tzinfo is not None:
            # Official is naive, Discord is aware - make Discord naive
            discord_dt = discord_dt.replace(tzinfo=None)
        elif official_dt.tzinfo is not None and discord_dt.tzinfo is None:
            # Official is aware, Discord is naive - make official naive
            official_dt = official_dt.replace(tzinfo=None)
        
        return discord_dt > official_dt
    except (ValueError, AttributeError) as e:
        # If we can't parse dates, default to preserving Discord edit
        # This is safer than losing user edits
        return True


def merge_node_update(node: Dict[str, Any], 
                      db_node: Dict[str, Any], 
                      conn) -> bool:
    """
    Merge official map update with existing database node.
    Implements conflict resolution strategy.
    
    Args:
        node: Node dictionary from official map.
        db_node: Existing node from database.
        conn: Database connection.
    
    Returns:
        True if any changes were made, False otherwise.
    """
    cursor = conn.cursor()
    
    # Normalize public key: remove spaces, dashes, convert to lowercase
    # This matches the normalization in get_node_by_key
    public_key_normalized = node['public_key'].replace(' ', '').replace('-', '').lower()
    
    # Immutable fields: always update from official map
    # Exception: preserve "discord" source (nodes registered via Discord, not in official map)
    # For Discord-registered nodes, these fields will be filled in from official map when available
    immutable_updates = {
        'type': node.get('type'),
        'adv_lat': node.get('adv_lat'),
        'adv_lon': node.get('adv_lon'),
        'link': node.get('link'),
        'last_advert': node.get('last_advert'),  # Fill in from official map if missing
        'inserted_by': node.get('inserted_by'),  # Fill in from official map if missing
        'updated_by': node.get('updated_by'),    # Fill in from official map if missing
        'updated_date': node.get('updated_date'),
        'inserted_date': node.get('inserted_date'),
    }
    
    # Always update source from official map (e.g. if a Discord-registered node
    # is later detected by an uploader, API will have source=uploader and we sync that)
    immutable_updates['source'] = node.get('source')
    
    # Editable fields: conflict resolution
    editable_updates = {}
    
    # adv_name
    if should_preserve_discord_edit(db_node, node, 'adv_name'):
        editable_updates['adv_name'] = db_node.get('adv_name')
    else:
        editable_updates['adv_name'] = node.get('adv_name')
    
    # city
    # Local geocoding is effectively free, so we always prefer the freshly
    # resolved `new_city` unless the user edited the city via Discord after the
    # last sync (preserve user edits). If `new_city` is empty/None (e.g. node
    # was "kept from DB" after a geocode miss) fall back to the current value.
    current_city = db_node.get('city')
    new_city = node.get('city')

    if should_preserve_discord_edit(db_node, node, 'city'):
        editable_updates['city'] = current_city
    elif new_city:
        editable_updates['city'] = new_city
    else:
        editable_updates['city'] = current_city
    
    # params (frequency parameters)
    if should_preserve_discord_edit(db_node, node, 'params'):
        editable_updates['params'] = db_node.get('params')
    else:
        editable_updates['params'] = node.get('params')
    
    # Check if there are any actual changes
    # Compare current values with new values to determine if update is needed
    has_changes = False
    
    # Helper function to compare values (handles None, params JSON, etc.)
    def values_differ(current, new, field_name):
        """Compare two values, handling None, params JSON, etc."""
        # Handle None values
        if current is None and new is None:
            return False
        if current is None or new is None:
            return True
        
        # Special handling for params (JSON comparison)
        if field_name == 'params':
            # Normalize both to dicts
            if isinstance(current, str):
                current = json_deserialize(current) or {}
            if isinstance(new, dict):
                # Already a dict
                pass
            else:
                new = json_deserialize(json_serialize(new)) if new else {}
            return current != new
        
        # Regular comparison
        return current != new
    
    # IMPORTANT: Check updated_date and last_advert FIRST
    # If either of these date fields has changed, consider it an update
    # (even if no other fields changed)
    current_updated_date = db_node.get('updated_date')
    new_updated_date = immutable_updates.get('updated_date')
    if values_differ(current_updated_date, new_updated_date, 'updated_date'):
        has_changes = True
    
    current_last_advert = db_node.get('last_advert')
    new_last_advert = immutable_updates.get('last_advert')
    if not has_changes and values_differ(current_last_advert, new_last_advert, 'last_advert'):
        has_changes = True
    
    # Check other immutable fields (always update from official map, but check if different)
    if not has_changes:
        for field, new_value in immutable_updates.items():
            # Skip updated_date and last_advert (already checked above)
            if field in ('updated_date', 'last_advert'):
                continue
            current_value = db_node.get(field)
            if values_differ(current_value, new_value, field):
                has_changes = True
                break
    
    # Check editable fields (only if not preserving Discord edit)
    if not has_changes:
        for field, new_value in editable_updates.items():
            current_value = db_node.get(field)
            if values_differ(current_value, new_value, field):
                has_changes = True
                break
    
    # Only update if there are actual changes
    if not has_changes:
        # Still update last_sync_date to track that we checked this node
        cursor.execute("""
            UPDATE belgian_nodes
            SET last_sync_date = ?
            WHERE public_key = ?
        """, (get_current_timestamp(), public_key_normalized))
        return False
    
    # Build update query
    update_fields = []
    update_values = []
    
    for field, value in {**immutable_updates, **editable_updates}.items():
        if field == 'params':
            update_fields.append(f"{field} = ?")
            update_values.append(json_serialize(value))
        else:
            update_fields.append(f"{field} = ?")
            update_values.append(value)
    
    # Add sync metadata
    update_fields.append("last_sync_date = ?")
    update_values.append(get_current_timestamp())
    
    # Add WHERE clause
    update_values.append(public_key_normalized)
    
    # Execute update
    query = f"""
        UPDATE belgian_nodes
        SET {', '.join(update_fields)}
        WHERE public_key = ?
    """
    cursor.execute(query, update_values)
    
    # Log change
    cursor.execute("""
        INSERT INTO node_changes (
            public_key, change_type, sync_date, new_data
        ) VALUES (?, ?, ?, ?)
    """, (
        public_key_normalized,
        'updated',
        get_current_timestamp(),
        json_serialize(node)
    ))
    
    return True


def log_sync_summary(changes: Dict[str, Any], conn) -> None:
    """
    Log sync summary to sync_history table.
    
    Args:
        changes: Dictionary with change counts and lists.
        conn: Database connection.
    """
    cursor = conn.cursor()
    
    details = {
        'added_keys': changes.get('added', [])[:100],  # Limit to first 100
        'removed_keys': changes.get('removed', [])[:100],
        'restored_keys': changes.get('restored', [])[:100],
        'updated_keys': changes.get('updated', [])[:100],
        'deactivated_unclaimed_discord_keys': changes.get('deactivated_unclaimed_discord', [])[:100],  # Track deactivated unclaimed Discord nodes in this cycle
    }
    
    cursor.execute("""
        INSERT INTO sync_history (
            sync_date, nodes_added, nodes_removed, nodes_restored,
            nodes_updated, details
        ) VALUES (?, ?, ?, ?, ?, ?)
    """, (
        get_current_timestamp(),
        changes['added_count'],
        changes['removed_count'],
        changes['restored_count'],
        changes['updated_count'],
        json_serialize(details)
    ))


def format_node_for_sync_notification(node: Dict[str, Any]) -> str:
    """
    Format a single node for sync notification display.
    Format: ICON `HEX HEAD` - NODE NAME - <DISCORD USER/Unclaimed>
    
    Args:
        node: Node dictionary.
    
    Returns:
        Formatted string.
    """
    # Node type icon mapping
    node_type_icons = {
        1: "📱",  # companion
        2: "📡",  # repeater
        3: "💾",  # room server
        4: "🌡️"   # sensor
    }
    
    type_num = node.get('type', 0)
    icon = node_type_icons.get(type_num, "•")
    
    # Truncate public key to 6 characters (uppercase)
    pub_key = node.get('public_key', '')
    pub_key_display = pub_key[:6].upper() if pub_key else 'N/A'
    
    # Escape Discord markdown in node name
    node_name = node.get('adv_name', 'Unknown')
    # Replace underscores with escaped underscores to prevent italic
    node_name = node_name.replace('_', '\\_')
    
    # Format owner - Discord mention if available, otherwise "Unclaimed"
    owner_id = node.get('discord_owner_id')
    if owner_id:
        owner = f"<@{owner_id}>"
    else:
        owner = "Unclaimed"
    
    return f"{icon} `{pub_key_display}` - {node_name} - {owner}"


def get_node_details_by_keys(public_keys: List[str], conn) -> List[Dict[str, Any]]:
    """
    Get full node details from database by public keys.
    
    Args:
        public_keys: List of public keys (will be normalized to lowercase).
        conn: Database connection.
    
    Returns:
        List of node dictionaries.
    """
    if not public_keys:
        return []
    
    # Normalize all public keys: remove spaces, dashes, convert to lowercase
    # This matches the normalization in get_node_by_key
    public_keys_normalized = [key.replace(' ', '').replace('-', '').lower() for key in public_keys]
    
    cursor = conn.cursor()
    placeholders = ','.join(['?'] * len(public_keys_normalized))
    cursor.execute(f"""
        SELECT * FROM belgian_nodes
        WHERE public_key IN ({placeholders})
    """, public_keys_normalized)
    
    rows = cursor.fetchall()
    nodes = []
    for row in rows:
        node = dict_from_row(row)
        # Deserialize params if it's a JSON string
        if 'params' in node and node['params'] and isinstance(node['params'], str):
            try:
                node['params'] = json_deserialize(node['params']) or {}
            except Exception:
                node['params'] = {}
        nodes.append(node)
    
    return nodes


def get_deactivated_unclaimed_discord_nodes(conn, official_node_keys: Set[str]) -> List[Dict[str, Any]]:
    """
    Get nodes that were deactivated and are:
    - source='discord'
    - unclaimed (no discord_owner_id)
    - not in the official map
    
    Args:
        conn: Database connection.
        official_node_keys: Set of public keys from official map.
    
    Returns:
        List of deactivated unclaimed Discord nodes.
    """
    cursor = conn.cursor()
    
    # Get all inactive nodes with source='discord' and no owner
    cursor.execute("""
        SELECT * FROM belgian_nodes
        WHERE is_active = 0
        AND source = 'discord'
        AND (discord_owner_id IS NULL OR discord_owner_id = '')
    """)
    
    rows = cursor.fetchall()
    nodes = []
    for row in rows:
        node = dict_from_row(row)
        # Only include if not in official map
        if node['public_key'] not in official_node_keys:
            # Deserialize params if it's a JSON string
            if 'params' in node and node['params'] and isinstance(node['params'], str):
                try:
                    node['params'] = json_deserialize(node['params']) or {}
                except Exception:
                    node['params'] = {}
            nodes.append(node)
    
    return nodes


def send_sync_notification(
    changes: Dict[str, Any],
    current_nodes_dict: Dict[str, Dict[str, Any]],
    conn,
    total_downloaded: int,
    bounded: int,
    verified: int,
    elapsed_time: float
) -> None:
    """
    Send Discord notification about sync results.
    
    Args:
        changes: Dictionary with change counts and lists.
        current_nodes_dict: Dictionary of current nodes from official map (by public_key).
        conn: Database connection.
    """
    try:
        from config.config import (
            DISCORD_BOT_TOKEN,
            STARTUP_CHANNEL_ID,
            NODE_TYPE_ICONS,
            SYNC_INTERVAL_MINUTES as _SYNC_MINUTES,
        )

        if not DISCORD_BOT_TOKEN or not STARTUP_CHANNEL_ID:
            print("Discord bot token or startup channel ID not configured. Skipping notification.")
            return
        
        import discord
        
        # Create a minimal Discord client for sending notifications
        intents = discord.Intents.default()
        client = discord.Client(intents=intents)
        
        notification_sent = False
        
        @client.event
        async def on_ready():
            nonlocal notification_sent
            try:
                channel = client.get_channel(int(STARTUP_CHANNEL_ID))
                if not channel:
                    print(f"Could not find channel with ID {STARTUP_CHANNEL_ID}")
                    await client.close()
                    return
                
                # Get current statistics from database
                from backend.discord_queries import get_statistics
                stats = get_statistics()
                
                # Calculate next sync time in CET for footer (user-facing)
                next_sync_utc = datetime.now(timezone.utc) + timedelta(minutes=_SYNC_MINUTES)
                next_sync_cet = next_sync_utc.astimezone(ZoneInfo("Europe/Brussels"))
                next_sync_str = next_sync_cet.strftime("%Y-%m-%d %H:%M") + " " + next_sync_cet.tzname()
                
                # Node type names (plural)
                node_type_names = {
                    1: "Companions",
                    2: "Repeaters",
                    3: "Room Servers",
                    4: "Sensors"
                }
                
                # Format nodes by type (only show types with count > 0)
                by_type_text = []
                for type_num in sorted(stats.get('by_type', {}).keys()):
                    count = stats['by_type'][type_num]
                    if count > 0:  # Only show if count > 0
                        type_name = node_type_names.get(type_num, f"Type {type_num}")
                        icon = NODE_TYPE_ICONS.get(type_num, "•")
                        by_type_text.append(f"{icon} {type_name}: **{count}**")
                
                # Build notification embed
                embed = discord.Embed(
                    title="🔄 Sync Complete",
                    description="Sync completed and updated the [#BEMesh Map](https://meshmap.radio-actief.be)\n\u200b",
                    color=discord.Color.blue()
                )
                
                # Inline 1: Sync Process (without 'Within Bounds')
                embed.add_field(
                    name="🔄 Sync Process",
                    value=(
                        f"- **Downloaded:** {total_downloaded}\n"
                        f"- **Verified Belgian:** {verified}\n"
                        f"- **Duration:** {elapsed_time:.1f}s\n\u200b"
                    ),
                    inline=True
                )
                
                # Inline 1: Changes Summary (only show non-zero counts, hide field if all are 0)
                changes_lines = []
                if changes['added_count'] > 0:
                    changes_lines.append(f"- **Added:** {changes['added_count']}")
                if changes['updated_count'] > 0:
                    changes_lines.append(f"- **Updated:** {changes['updated_count']}")
                if changes['removed_count'] > 0:
                    changes_lines.append(f"- **Deactivated:** {changes['removed_count']}")
                if changes['restored_count'] > 0:
                    changes_lines.append(f"- **Restored:** {changes['restored_count']}")
                
                # Only add the Changes field if there are any changes
                if changes_lines:
                    embed.add_field(
                        name="📝 Changes",
                        value="\n".join(changes_lines) + "\n\u200b",
                        inline=True
                    )
                
                # Add empty field for spacing if we have 2 fields in first row
                if changes_lines:
                    embed.add_field(
                        name="\u200b",
                        value="\u200b",
                        inline=True
                    )
                
                # Inline 2: Overall Statistics
                embed.add_field(
                    name="📊 Overall Statistics",
                    value=(
                        f"- **Total Active Nodes:** {stats['total_nodes']}\n"
                        f"- **Claimed:** {stats['claimed_nodes']}\n"
                        f"- **Unclaimed:** {stats['unclaimed_nodes']}\n"
                        f"- **Registered Users:** {stats['registered_users']}\n"
                        f"- **Total Cities:** {stats['total_cities']}\n\u200b"
                    ),
                    inline=True
                )
                
                # Inline 2: Nodes by Type (only show if there are types with count > 0)
                if by_type_text:
                    embed.add_field(
                        name="📱 Nodes by Type",
                        value="\n".join([f"- {text}" for text in by_type_text]) + "\n\u200b",
                        inline=True
                    )
                    # Add empty field for spacing if we have 2 fields in second row
                    embed.add_field(
                        name="\u200b",
                        value="\u200b",
                        inline=True
                    )
                
                # Get node details for each category (added, restored, removed; updated not shown)
                added_nodes = get_node_details_by_keys(changes.get('added', [])[:50], conn)  # Limit to 50
                restored_nodes = get_node_details_by_keys(changes.get('restored', [])[:50], conn)  # Limit to 50
                
                # Get deactivated unclaimed Discord nodes from THIS sync cycle only
                # (not all historical deactivated unclaimed Discord nodes)
                deactivated_unclaimed_discord_keys = changes.get('deactivated_unclaimed_discord', [])
                deactivated_discord_nodes = get_node_details_by_keys(deactivated_unclaimed_discord_keys[:50], conn)  # Limit to 50
                deactivated_discord_keys = set(deactivated_unclaimed_discord_keys)
                
                # Filter out deactivated unclaimed Discord nodes from removed_nodes
                # (so they don't appear in both sections)
                removed_keys_filtered = [
                    key for key in changes.get('removed', [])
                    if key not in deactivated_discord_keys
                ]
                removed_nodes = get_node_details_by_keys(removed_keys_filtered[:50], conn)  # Limit to 50
                
                # Separate lists: New Nodes, Restored Nodes, Deleted Nodes, Deleted Unclaimed Discord Nodes (updated not shown)
                # Only show if there are actual items
                
                if added_nodes:
                    formatted = "\n".join([f"- {format_node_for_sync_notification(node)}" for node in added_nodes])
                    total_count = len(changes.get('added', []))
                    if total_count > 50:
                        formatted += f"\n\n*... and {total_count - 50} more*"
                    embed.add_field(
                        name=f"✅ New Nodes ({total_count})",
                        value=formatted[:1024],  # Discord field value limit
                        inline=False
                    )
                
                if restored_nodes:
                    formatted = "\n".join([f"- {format_node_for_sync_notification(node)}" for node in restored_nodes])
                    total_count = len(changes.get('restored', []))
                    if total_count > 50:
                        formatted += f"\n\n*... and {total_count - 50} more*"
                    embed.add_field(
                        name=f"🔄 Restored Nodes ({total_count})",
                        value=formatted[:1024],
                        inline=False
                    )
                
                if removed_nodes:
                    formatted = "\n".join([f"- {format_node_for_sync_notification(node)}" for node in removed_nodes])
                    total_count = len(changes.get('removed', []))
                    if total_count > 50:
                        formatted += f"\n\n*... and {total_count - 50} more*"
                    embed.add_field(
                        name=f"❌ Deleted Nodes ({total_count})",
                        value=formatted[:1024],
                        inline=False
                    )
                
                if deactivated_discord_nodes:
                    formatted = "\n".join([f"- {format_node_for_sync_notification(node)}" for node in deactivated_discord_nodes])
                    total_count = len(deactivated_unclaimed_discord_keys)
                    if total_count > 50:
                        formatted += f"\n\n*... and {total_count - 50} more*"
                    embed.add_field(
                        name=f"⚠️ Deleted Unclaimed Discord Nodes ({total_count})",
                        value=formatted[:1024],
                        inline=False
                    )
                
                # Footer: Next Sync (no icon, no seconds)
                embed.set_footer(text=f"Next Sync: {next_sync_str} (in {_SYNC_MINUTES} minutes)")
                
                # Send the message
                await channel.send(embed=embed)
                print(f"Sync notification sent to channel {STARTUP_CHANNEL_ID}")
                notification_sent = True
                
            except Exception as e:
                print(f"Error sending sync notification: {e}")
                import traceback
                traceback.print_exc()
            finally:
                await client.close()
        
        # Run the client (blocking call - this will handle the event loop)
        client.run(DISCORD_BOT_TOKEN)
        
    except ImportError:
        print("discord.py not available. Skipping sync notification.")
    except Exception as e:
        print(f"Error setting up sync notification: {e}")
        import traceback
        traceback.print_exc()


def sync_belgian_nodes(
    geopy_delay: float = 1.5,
    skip_geopy: bool = False,
    use_geopy: Optional[bool] = None,
    notify: bool = False,
) -> Dict[str, Any]:
    """
    Main sync function: download, filter, verify, and integrate Belgian nodes.

    Args:
        geopy_delay: Delay between Geopy requests in seconds (only used when
            falling back to Geopy).
        skip_geopy: If True, skip all verification (for tests). Name kept for
            backwards compatibility — effectively "skip verification".
        use_geopy: Force the Geopy/Nominatim path instead of the local geocoder.
            ``None`` (default) means: local geocoder if available, else Geopy,
            honouring the ``USE_GEOPY_FALLBACK`` env var.
        notify: If True, post the legacy per-sync Discord message via a
            short-lived client. Defaults to False — the long-running
            ``discord-bot`` service now posts a single daily digest instead.

    Returns:
        Dictionary with sync results and statistics.
    """
    if use_geopy is None:
        use_geopy = os.getenv("USE_GEOPY_FALLBACK", "").strip() in ("1", "true", "True", "yes", "YES")
    print("=" * 60)
    print("Starting Belgian Nodes Sync")
    print("=" * 60)
    
    start_time = time.time()
    conn = get_connection()
    
    try:
        # 1. Download nodes from official API
        all_nodes = download_official_nodes()
        
        # Normalize public_key in all nodes to ensure consistency
        # Database stores normalized keys (lowercase, no spaces/dashes)
        for node in all_nodes:
            if 'public_key' in node:
                node['public_key'] = node['public_key'].replace(' ', '').replace('-', '').lower()
        
        # 2. Filter by Belgian geographic bounds
        bounded_nodes = filter_by_bounds(all_nodes)
        
        # 3. Load DB state for Geopy (when Geopy fails, we keep nodes already in DB with their city)
        db_for_geopy = load_previous_nodes_from_db()
        
        # 4. Verify nodes (local geocoder by default; Geopy as optional fallback)
        if skip_geopy:
            print("Skipping verification (testing mode)")
            belgian_nodes = bounded_nodes
            for node in belgian_nodes:
                if 'city' not in node:
                    node['city'] = None
        else:
            geocoder = None
            geocoder_err: Optional[Exception] = None
            if not use_geopy:
                try:
                    from backend.belgian_geocoder import get_geocoder
                    geocoder = get_geocoder()
                except FileNotFoundError as e:
                    geocoder_err = e
                except Exception as e:  # pragma: no cover - defensive
                    geocoder_err = e

            if geocoder is not None:
                belgian_nodes = verify_nodes_locally(
                    bounded_nodes,
                    previous_nodes=db_for_geopy,
                    geocoder=geocoder,
                )
            elif _GEOPY_AVAILABLE:
                if geocoder_err is not None:
                    print(
                        f"WARN: local geocoder unavailable ({geocoder_err}). "
                        "Falling back to Geopy/Nominatim. "
                        "Build the local polygons with: "
                        "python3 scripts/generate-be-municipalities-geojson.py"
                    )
                else:
                    print("Using Geopy/Nominatim (forced via --use-geopy / USE_GEOPY_FALLBACK)")
                belgian_nodes = verify_nodes_with_geopy(
                    bounded_nodes, delay=geopy_delay, previous_nodes=db_for_geopy
                )
            else:
                raise RuntimeError(
                    "Node verification is not configured: the local Belgian "
                    "geocoder GeoJSON is missing and the optional geopy "
                    "dependency is not installed. Fix either of:\n"
                    "  (a) python3 scripts/generate-be-municipalities-geojson.py\n"
                    "  (b) pip install geopy  (then run with --use-geopy)"
                )
        
        # 5. Load current DB state for change tracking (reload so we compare against latest)
        previous_nodes = load_previous_nodes_from_db()
        
        # 6. Track changes
        changes = track_changes(belgian_nodes, previous_nodes)
        
        # 6b. Failsafe: do not apply mass removals (e.g. API returned partial/empty)
        active_count = sum(1 for n in previous_nodes.values() if n.get('is_active', True))
        removed_count = changes['removed_count']
        over_absolute = removed_count > REMOVAL_SAFETY_MAX_ABSOLUTE
        over_percent = active_count > 0 and removed_count > (active_count * REMOVAL_SAFETY_MAX_PERCENT_OF_ACTIVE)
        if removed_count > 0 and (over_absolute or over_percent):
            print(f"\n⚠️  SAFETY: Skipping {removed_count} removals (max {REMOVAL_SAFETY_MAX_ABSOLUTE} or {REMOVAL_SAFETY_MAX_PERCENT_OF_ACTIVE*100:.0f}% of active). Check API/network.")
            changes['removed'] = []
            changes['removed_count'] = 0
        
        # 7. Integrate changes into database
        print("\nIntegrating changes into database...")
        
        # Create a lookup for current nodes by public_key
        # Keys are already normalized from step 1
        current_nodes_dict = {node['public_key']: node for node in belgian_nodes}
        
        # Process added nodes
        for public_key in changes['added']:
            node = current_nodes_dict[public_key]
            try:
                integrate_added_node(node, conn)
            except Exception as e:
                print(f"Error integrating added node {public_key}: {e}")
        
        # Process removed nodes
        for public_key in changes['removed']:
            try:
                integrate_removed_node(public_key, conn)
            except Exception as e:
                print(f"Error integrating removed node {public_key}: {e}")
        
        # Process restored nodes
        for public_key in changes['restored']:
            node = current_nodes_dict[public_key]
            try:
                restore_removed_node(node, conn)
            except Exception as e:
                print(f"Error restoring node {public_key}: {e}")
        
        # Process updated nodes - track which ones actually changed
        actually_updated = []
        for public_key in changes['updated']:
            node = current_nodes_dict[public_key]
            db_node = previous_nodes[public_key]
            try:
                if merge_node_update(node, db_node, conn):
                    actually_updated.append(public_key)
            except Exception as e:
                print(f"Error updating node {public_key}: {e}")
        
        # Update changes dict with actual updated nodes
        changes['updated'] = actually_updated
        changes['updated_count'] = len(actually_updated)
        
        # Commit all changes
        conn.commit()
        
        # 8. Log sync summary
        log_sync_summary(changes, conn)
        conn.commit()
        
        # 9. Calculate elapsed time
        elapsed_time = time.time() - start_time
        
        # 10. Discord notification: disabled by default.
        # The long-running discord-bot service posts a single daily digest
        # (see backend/daily_digest.py). Legacy per-sync message is still
        # available behind the --notify CLI flag for ops emergencies.
        has_added = changes.get('added_count', 0) > 0
        has_removed = changes.get('removed_count', 0) > 0
        has_restored = changes.get('restored_count', 0) > 0
        if notify and (has_added or has_removed or has_restored):
            try:
                send_sync_notification(
                    changes,
                    current_nodes_dict,
                    conn,
                    len(all_nodes),
                    len(bounded_nodes),
                    len(belgian_nodes),
                    elapsed_time
                )
            except Exception as e:
                print(f"Warning: Failed to send sync notification: {e}")
        
        # 11. Print results
        print("\n" + "=" * 60)
        print("Sync Complete")
        print("=" * 60)
        print(f"Total nodes downloaded: {len(all_nodes)}")
        print(f"Nodes within bounds: {len(bounded_nodes)}")
        print(f"Verified Belgian nodes: {len(belgian_nodes)}")
        print(f"\nChanges:")
        print(f"  Added: {changes['added_count']}")
        print(f"  Removed: {changes['removed_count']}")
        print(f"  Restored: {changes['restored_count']}")
        print(f"  Updated: {changes['updated_count']}")
        if changes.get('deactivated_unclaimed_discord_count', 0) > 0:
            print(f"  Deactivated Unclaimed Discord Nodes: {changes['deactivated_unclaimed_discord_count']}")
        print(f"\nSync completed in {elapsed_time:.2f} seconds")
        print("=" * 60)
        
        return {
            'success': True,
            'total_downloaded': len(all_nodes),
            'bounded': len(bounded_nodes),
            'verified': len(belgian_nodes),
            'changes': changes,
            'elapsed_time': elapsed_time
        }
        
    except Exception as e:
        conn.rollback()
        print(f"\n❌ Sync failed: {e}")
        import traceback
        traceback.print_exc()
        return {
            'success': False,
            'error': str(e)
        }
    finally:
        conn.close()


if __name__ == '__main__':
    # Ensure database is initialized before running sync
    print("Initializing database...")
    init_database()
    print("Database ready.\n")
    """Run sync when executed directly."""
    import argparse
    
    parser = argparse.ArgumentParser(description='Sync Belgian nodes from official MeshCore map')
    parser.add_argument('--skip-geopy', action='store_true',
                       help='Skip verification entirely (for testing)')
    parser.add_argument('--use-geopy', action='store_true',
                       help='Force the Geopy/Nominatim fallback instead of the local geocoder '
                            '(also via USE_GEOPY_FALLBACK=1)')
    parser.add_argument('--geopy-delay', type=float, default=1.5,
                       help='Delay between Geopy requests in seconds (only used with --use-geopy, default: 1.5)')
    parser.add_argument('--notify', action='store_true',
                       help='Post a one-off per-sync Discord message (legacy behaviour). '
                            'Normal sync runs leave notifications to the daily digest job.')

    args = parser.parse_args()

    result = sync_belgian_nodes(
        geopy_delay=args.geopy_delay,
        skip_geopy=args.skip_geopy,
        use_geopy=args.use_geopy or None,
        notify=args.notify,
    )
    
    if result['success']:
        sys.exit(0)
    else:
        sys.exit(1)

