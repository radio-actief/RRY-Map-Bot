"""
Migration script to migrate specific data from legacy_meshcore_bot.db to belgian_nodes.db

This script:
1. For existing nodes: Copy owner info if source has owner
2. For existing nodes: Copy city if source has different city and owner
3. For source-only nodes: Only migrate if they have an owner
4. Logs all operations to files

Usage:
    python3 migrate_legacy_db.py [--target-db PATH]
    
    --target-db PATH    Target database path (default: data/belgian_nodes.db relative to script)
"""

import sqlite3
import json
import os
import argparse
from pathlib import Path
from typing import Dict, Any, Optional, List, Tuple
from datetime import datetime

# Import new database utilities
import sys
sys.path.insert(0, str(Path(__file__).parent))

# Note: Database module will be imported in main() after setting DATABASE_PATH
# These will be set as module-level variables after import
get_connection = None
init_database = None
json_serialize = None
get_current_timestamp = None


def get_legacy_connection() -> sqlite3.Connection:
    """Get connection to legacy database."""
    if not LEGACY_DB_PATH.exists():
        raise FileNotFoundError(f"Legacy database not found at {LEGACY_DB_PATH}")
    conn = sqlite3.connect(str(LEGACY_DB_PATH))
    conn.row_factory = sqlite3.Row
    return conn


def normalize_public_key(public_key: str) -> str:
    """Normalize public key: remove spaces/dashes, convert to lowercase."""
    return public_key.replace(' ', '').replace('-', '').lower()


def load_legacy_nodes() -> Dict[str, Dict[str, Any]]:
    """
    Load all nodes from legacy database, indexed by normalized public_key.
    Returns: Dict mapping normalized_public_key -> node_data
    """
    conn = get_legacy_connection()
    cursor = conn.cursor()
    
    try:
        cursor.execute("""
            SELECT public_key, owner_discord_id, city, adv_name, type,
                   adv_lat, adv_lon, inserted_date, updated_date, link,
                   source, params_freq, params_cr, params_sf, params_bw
            FROM nodes
        """)
        
        nodes = {}
        for row in cursor.fetchall():
            normalized_key = normalize_public_key(row['public_key'])
            nodes[normalized_key] = dict(row)
        
        return nodes
    finally:
        conn.close()


def load_legacy_users() -> Dict[int, str]:
    """
    Load users from legacy database.
    Returns: Dict mapping discord_user_id -> discord_username
    """
    conn = get_legacy_connection()
    cursor = conn.cursor()
    
    try:
        cursor.execute("SELECT discord_user_id, discord_username FROM users")
        users = {}
        for row in cursor.fetchall():
            users[row['discord_user_id']] = row['discord_username']
        return users
    finally:
        conn.close()


def load_destination_nodes() -> Dict[str, Dict[str, Any]]:
    """
    Load all nodes from destination database, indexed by normalized public_key.
    Returns: Dict mapping normalized_public_key -> node_data
    """
    conn = get_connection()
    cursor = conn.cursor()
    
    try:
        cursor.execute("""
            SELECT public_key, discord_owner_id, discord_owner_name, city, adv_name,
                   type, adv_lat, adv_lon, inserted_date, updated_date, link, source,
                   params, is_active
            FROM belgian_nodes
        """)
        
        nodes = {}
        for row in cursor.fetchall():
            normalized_key = normalize_public_key(row['public_key'])
            nodes[normalized_key] = dict(row)
        
        return nodes
    finally:
        conn.close()


def register_user_in_destination(cursor: sqlite3.Cursor, user_id: int, username: str) -> None:
    """
    Register a user in the destination database.
    Note: We don't have a users table in the new DB, but we store owner info in nodes.
    This function just ensures we have the user info available.
    """
    # In the new system, users are stored via discord_owner_id and discord_owner_name in nodes
    # So we don't need a separate users table - this is just a placeholder
    # if we need to track users separately in the future
    pass


def claim_node_in_destination(cursor: sqlite3.Cursor, public_key: str, 
                              user_id: int, username: str) -> None:
    """Claim a node in the destination database by setting owner info."""
    normalized_key = normalize_public_key(public_key)
    current_time = get_current_timestamp()
    
    cursor.execute("""
        UPDATE belgian_nodes
        SET discord_owner_id = ?,
            discord_owner_name = ?,
            discord_updated_date = ?,
            updated_date = ?
        WHERE public_key = ?
    """, (
        str(user_id),
        username,
        current_time,
        current_time,
        normalized_key
    ))


def update_city_in_destination(cursor: sqlite3.Cursor, public_key: str, city: str) -> None:
    """Update city for a node in the destination database."""
    normalized_key = normalize_public_key(public_key)
    current_time = get_current_timestamp()
    
    cursor.execute("""
        UPDATE belgian_nodes
        SET city = ?,
            updated_date = ?
        WHERE public_key = ?
    """, (city, current_time, normalized_key))


def insert_node_from_source(cursor: sqlite3.Cursor, node_data: Dict[str, Any],
                           user_id: int, username: str) -> List[str]:
    """
    Insert a node from source database that doesn't exist in destination.
    Returns list of missing variables.
    """
    normalized_key = normalize_public_key(node_data['public_key'])
    missing_vars = []
    
    # Check for missing required variables
    if not node_data.get('adv_name'):
        missing_vars.append('adv_name')
    if not node_data.get('type'):
        missing_vars.append('type')
    if node_data.get('adv_lat') is None:
        missing_vars.append('adv_lat')
    if node_data.get('adv_lon') is None:
        missing_vars.append('adv_lon')
    
    # Convert params to JSON
    params = {}
    if node_data.get('params_freq') is not None:
        params['freq'] = node_data['params_freq']
    if node_data.get('params_cr') is not None:
        params['cr'] = node_data['params_cr']
    if node_data.get('params_sf') is not None:
        params['sf'] = node_data['params_sf']
    if node_data.get('params_bw') is not None:
        params['bw'] = node_data['params_bw']
    params_json = json_serialize(params) if params else None
    
    current_time = get_current_timestamp()
    
    cursor.execute("""
        INSERT INTO belgian_nodes (
            public_key, type, adv_name, adv_lat, adv_lon, city,
            last_advert, inserted_date, updated_date, params, link,
            source, discord_owner_id, discord_owner_name, discord_updated_date,
            synced_from_official, is_active, removed_from_official
        ) VALUES (
            ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
        )
    """, (
        normalized_key,
        node_data.get('type'),
        node_data.get('adv_name'),
        node_data.get('adv_lat'),
        node_data.get('adv_lon'),
        node_data.get('city'),
        None,  # last_advert
        node_data.get('inserted_date') or current_time,
        node_data.get('updated_date') or current_time,
        params_json,
        node_data.get('link'),
        node_data.get('source') or 'discord',
        str(user_id),
        username,
        current_time,
        0,  # synced_from_official
        1,  # is_active
        0   # removed_from_official
    ))
    
    return missing_vars


def main():
    """Main migration function."""
    # Parse command-line arguments
    parser = argparse.ArgumentParser(
        description='Migrate data from legacy_meshcore_bot.db to belgian_nodes.db',
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  # Use default path (data/belgian_nodes.db relative to script)
  python3 migrate_legacy_db.py
  
  # Specify custom target database path
  python3 migrate_legacy_db.py --target-db /opt/stacks/RRY-Map-Bot/data/belgian_nodes.db
  
  # Specify both legacy and target paths
  python3 migrate_legacy_db.py --legacy-db /path/to/legacy.db --target-db /path/to/new.db
        """
    )
    parser.add_argument(
        '--target-db',
        type=str,
        default=None,
        help='Target database path (default: data/belgian_nodes.db relative to script)'
    )
    parser.add_argument(
        '--legacy-db',
        type=str,
        default=None,
        help='Legacy database path (default: legacy_meshcore_bot.db in migration/ or parent directory)'
    )
    
    args = parser.parse_args()
    
    # Set up paths
    script_dir = Path(__file__).parent.parent
    if args.legacy_db:
        legacy_db_path = Path(args.legacy_db)
    else:
        # Try migration directory first, then parent directory
        legacy_db_path = script_dir / 'migration' / 'legacy_meshcore_bot.db'
        if not legacy_db_path.exists():
            legacy_db_path = script_dir / 'legacy_meshcore_bot.db'
    
    if args.target_db:
        target_db_path = Path(args.target_db)
    else:
        target_db_path = script_dir / 'data' / 'belgian_nodes.db'
    
    # Ensure target directory exists
    target_db_path.parent.mkdir(parents=True, exist_ok=True)
    
    # Set DATABASE_PATH environment variable before importing database module
    # This ensures the database module uses the correct path
    os.environ['DATABASE_PATH'] = str(target_db_path)
    
    # Now import database utilities (after setting DATABASE_PATH)
    from database import get_connection as _get_connection, init_database as _init_database, json_serialize as _json_serialize, get_current_timestamp as _get_current_timestamp
    
    # Make database functions available at module level for other functions to use
    global get_connection, init_database, json_serialize, get_current_timestamp, LEGACY_DB_PATH, NEW_DB_PATH
    get_connection = _get_connection
    init_database = _init_database
    json_serialize = _json_serialize
    get_current_timestamp = _get_current_timestamp
    LEGACY_DB_PATH = legacy_db_path
    NEW_DB_PATH = target_db_path
    
    print("="*60)
    print("LEGACY DATABASE MIGRATION")
    print("="*60)
    print(f"Legacy DB: {LEGACY_DB_PATH}")
    print(f"Target DB: {NEW_DB_PATH}")
    print("="*60)
    
    # Check legacy database exists
    if not LEGACY_DB_PATH.exists():
        print(f"❌ Legacy database not found at {LEGACY_DB_PATH}")
        return
    
    # Ensure new database is initialized
    print("\n1. Initializing new database...")
    init_database()
    
    # Load data
    print("\n2. Loading data from databases...")
    legacy_nodes = load_legacy_nodes()
    legacy_users = load_legacy_users()
    dest_nodes = load_destination_nodes()
    
    print(f"   Legacy nodes: {len(legacy_nodes)}")
    print(f"   Legacy users: {len(legacy_users)}")
    print(f"   Destination nodes: {len(dest_nodes)}")
    
    # Prepare log files
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    completed_claiming_log = Path(__file__).parent.parent / 'logs' / f'completed_claiming_{timestamp}.log'
    city_review_log = Path(__file__).parent.parent / 'logs' / f'city_review_{timestamp}.log'
    source_only_migration_log = Path(__file__).parent.parent / 'logs' / f'source_only_migration_{timestamp}.log'
    source_only_no_owner_log = Path(__file__).parent.parent / 'logs' / f'source_only_no_owner_{timestamp}.log'
    
    # Create logs directory
    completed_claiming_log.parent.mkdir(parents=True, exist_ok=True)
    
    # Open log files
    claiming_file = open(completed_claiming_log, 'w', encoding='utf-8')
    city_file = open(city_review_log, 'w', encoding='utf-8')
    migration_file = open(source_only_migration_log, 'w', encoding='utf-8')
    no_owner_file = open(source_only_no_owner_log, 'w', encoding='utf-8')
    
    claiming_file.write(f"Migration completed_claiming log - {datetime.now().isoformat()}\n")
    claiming_file.write("Format: public_key|node_name|node_type|owner|status\n")
    claiming_file.write("Status: 'MIGRATED' (owner info copied and node claimed)\n")
    claiming_file.write("="*60 + "\n\n")
    
    city_file.write(f"City review log - {datetime.now().isoformat()}\n")
    city_file.write("Format: public_key|node_name|node_type|source_city|destination_city|status\n")
    city_file.write("Status: 'MIGRATED' (updated) or 'NEEDS REVIEW' (no owner)\n")
    city_file.write("="*60 + "\n\n")
    
    migration_file.write(f"Source-only node migration log (with owners) - {datetime.now().isoformat()}\n")
    migration_file.write("Format: public_key|node_name|node_type|owner|missing_vars|status\n")
    migration_file.write("Status: 'MIGRATED' (node inserted and owner linked)\n")
    migration_file.write("="*60 + "\n\n")
    
    no_owner_file.write(f"Source-only nodes without owners (likely to discard) - {datetime.now().isoformat()}\n")
    no_owner_file.write("Format: public_key|node_name|node_type|status\n")
    no_owner_file.write("Status: 'NEEDS REVIEW' (no owner, likely to discard)\n")
    no_owner_file.write("="*60 + "\n\n")
    
    conn = get_connection()
    cursor = conn.cursor()
    
    try:
        # Process 1: For existing nodes, copy owner info if source has owner
        print("\n3. Processing existing nodes - copying owner info...")
        claiming_count = 0
        debug_count = 0
        debug_matches = 0
        
        for dest_key, dest_node in dest_nodes.items():
            if dest_key in legacy_nodes:
                debug_matches += 1
                legacy_node = legacy_nodes[dest_key]
                owner_id = legacy_node.get('owner_discord_id')
                
                # Debug first few matches
                if debug_count < 5:
                    dest_owner_id = dest_node.get('discord_owner_id')
                    print(f"  DEBUG: Match found - {dest_node.get('adv_name', 'N/A')}")
                    print(f"    Legacy owner_id: {owner_id} (type: {type(owner_id).__name__})")
                    print(f"    Owner in users dict: {owner_id in legacy_users if owner_id else False}")
                    print(f"    Dest owner_id value: {repr(dest_owner_id)} (type: {type(dest_owner_id).__name__})")
                    print(f"    Dest has owner (bool check): {bool(dest_owner_id)}")
                    print(f"    Dest has owner (is None check): {dest_owner_id is not None}")
                    print(f"    Will claim? {owner_id and owner_id in legacy_users and not dest_owner_id}")
                    debug_count += 1
                
                if owner_id and owner_id in legacy_users:
                    # Source has owner, check if destination doesn't
                    if not dest_node.get('discord_owner_id'):
                        username = legacy_users[owner_id]
                        claim_node_in_destination(cursor, dest_key, owner_id, username)
                        claiming_count += 1
                        
                        # Get node type name
                        node_type_map = {1: 'Companion', 2: 'Repeater', 3: 'Room Server', 4: 'Sensor'}
                        node_type = node_type_map.get(dest_node.get('type'), f"Type {dest_node.get('type', 'N/A')}")
                        
                        log_entry = (
                            f"{dest_key}|{dest_node.get('adv_name', 'N/A')}|"
                            f"{node_type}|{username} ({owner_id})|MIGRATED\n"
                        )
                        claiming_file.write(log_entry)
                        print(f"  ✅ Claimed {dest_key[:8]}... for {username}")
        
        print(f"   Total matches found: {debug_matches}")
        print(f"   Claimed {claiming_count} nodes")
        
        # Process 2: For existing nodes, handle city differences
        print("\n4. Processing existing nodes - checking city differences...")
        city_updated_count = 0
        city_review_count = 0
        
        for dest_key, dest_node in dest_nodes.items():
            if dest_key in legacy_nodes:
                legacy_node = legacy_nodes[dest_key]
                legacy_city = legacy_node.get('city')
                dest_city = dest_node.get('city')
                owner_id = legacy_node.get('owner_discord_id')
                
                # Check if cities are different (and both exist)
                if legacy_city and dest_city and legacy_city.strip() != dest_city.strip():
                    # Get node type name
                    node_type_map = {1: 'Companion', 2: 'Repeater', 3: 'Room Server', 4: 'Sensor'}
                    node_type = node_type_map.get(dest_node.get('type'), f"Type {dest_node.get('type', 'N/A')}")
                    
                    if owner_id and owner_id in legacy_users:
                        # Has owner - update immediately
                        update_city_in_destination(cursor, dest_key, legacy_city)
                        city_updated_count += 1
                        
                        # Log the completed migration
                        city_file.write(
                            f"{dest_key}|{dest_node.get('adv_name', 'N/A')}|"
                            f"{node_type}|{legacy_city}|{dest_city}|MIGRATED\n"
                        )
                        print(f"  ✏️  Updated city for {dest_key[:8]}... ({dest_city} → {legacy_city})")
                    else:
                        # No owner - log for manual review
                        city_file.write(
                            f"{dest_key}|{dest_node.get('adv_name', 'N/A')}|"
                            f"{node_type}|{legacy_city}|{dest_city}|NEEDS REVIEW\n"
                        )
                        city_review_count += 1
                        print(f"  📝 City difference logged for {dest_key[:8]}... (no owner - needs review)")
        
        print(f"   Updated {city_updated_count} cities immediately")
        print(f"   Logged {city_review_count} cities for manual review")
        
        # Process 3: For source-only nodes, only migrate if they have an owner
        print("\n5. Processing source-only nodes...")
        migrated_count = 0
        no_owner_count = 0
        
        # Get node type map
        node_type_map = {1: 'Companion', 2: 'Repeater', 3: 'Room Server', 4: 'Sensor'}
        
        for legacy_key, legacy_node in legacy_nodes.items():
            if legacy_key not in dest_nodes:
                owner_id = legacy_node.get('owner_discord_id')
                node_type = node_type_map.get(legacy_node.get('type'), f"Type {legacy_node.get('type', 'N/A')}")
                
                if owner_id and owner_id in legacy_users:
                    # Has owner - migrate
                    username = legacy_users[owner_id]
                    missing_vars = insert_node_from_source(cursor, legacy_node, owner_id, username)
                    migrated_count += 1
                    
                    missing_str = ", ".join(missing_vars) if missing_vars else "None"
                    log_entry = (
                        f"{legacy_key}|{legacy_node.get('adv_name', 'N/A')}|"
                        f"{node_type}|{username} ({owner_id})|{missing_str}|MIGRATED\n"
                    )
                    migration_file.write(log_entry)
                    print(f"  ✅ Migrated {legacy_key[:8]}... ({legacy_node.get('adv_name', 'N/A')}) - Missing: {missing_str}")
                else:
                    # No owner - log to discard file
                    no_owner_file.write(
                        f"{legacy_key}|{legacy_node.get('adv_name', 'N/A')}|{node_type}|NEEDS REVIEW\n"
                    )
                    no_owner_count += 1
                    print(f"  ⏭️  Skipped {legacy_key[:8]}... (no owner - needs review)")
        
        print(f"   Migrated {migrated_count} source-only nodes (with owners)")
        print(f"   Skipped {no_owner_count} source-only nodes (no owners)")
        
        # Commit all changes
        conn.commit()
        
        # Close log files
        claiming_file.close()
        city_file.close()
        migration_file.close()
        no_owner_file.close()
        
        # Print summary
        print("\n" + "="*60)
        print("MIGRATION SUMMARY")
        print("="*60)
        print(f"✅ Nodes claimed: {claiming_count}")
        print(f"✏️  Cities updated: {city_updated_count}")
        print(f"📝 Cities for review: {city_review_count}")
        print(f"🆕 Nodes migrated (with owners): {migrated_count}")
        print(f"⏭️  Nodes skipped (no owners): {no_owner_count}")
        print("\nLog files created:")
        print(f"  - {completed_claiming_log}")
        print(f"  - {city_review_log}")
        print(f"  - {source_only_migration_log}")
        print(f"  - {source_only_no_owner_log}")
        print("="*60)
        
    except Exception as e:
        conn.rollback()
        print(f"\n❌ Error during migration: {e}")
        raise
    finally:
        conn.close()


if __name__ == '__main__':
    main()
