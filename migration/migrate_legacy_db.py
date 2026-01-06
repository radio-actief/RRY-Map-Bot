"""
Migration script to migrate specific data from legacy_meshcore_bot.db to belgian_nodes.db

This script:
1. For existing nodes: Copy owner info if source has owner
2. For existing nodes: Copy city if source has different city and owner
3. For source-only nodes: Only migrate if they have an owner
4. Logs all operations to files
"""

import sqlite3
import json
import os
import shutil
from pathlib import Path
from typing import Dict, Any, Optional, List, Tuple
from datetime import datetime

# Paths
LEGACY_DB_PATH = Path(__file__).parent / 'legacy_meshcore_bot.db'
NEW_DB_PATH = Path(__file__).parent.parent / 'data' / 'belgian_nodes.db'

# Import new database utilities
import sys
sys.path.insert(0, str(Path(__file__).parent.parent / 'backend'))
from database import get_connection, init_database, json_serialize, get_current_timestamp


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
    
    # Check for missing frequency parameters
    if node_data.get('params_freq') is None:
        missing_vars.append('params_freq')
    if node_data.get('params_cr') is None:
        missing_vars.append('params_cr')
    if node_data.get('params_sf') is None:
        missing_vars.append('params_sf')
    if node_data.get('params_bw') is None:
        missing_vars.append('params_bw')
    
    # Convert params to JSON (include all available params, even if some are missing)
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
    
    # For source-only migrated nodes, explicitly set source to 'discord'
    # and ensure all system fields are properly set
    cursor.execute("""
        INSERT INTO belgian_nodes (
            public_key, type, adv_name, adv_lat, adv_lon, city,
            last_advert, inserted_date, updated_date, params, link,
            source, inserted_by, updated_by,
            discord_owner_id, discord_owner_name, discord_updated_date,
            synced_from_official, last_sync_date, is_active, 
            removed_from_official, removed_date
        ) VALUES (
            ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
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
        'discord',  # Explicitly set source to 'discord' for migrated nodes
        'migration',  # inserted_by
        'migration',  # updated_by
        str(user_id),
        username,
        current_time,
        0,  # synced_from_official (not from official map)
        None,  # last_sync_date (never synced)
        1,  # is_active
        0,  # removed_from_official
        None  # removed_date
    ))
    
    return missing_vars


def main(dry_run: bool = True):
    """
    Main migration function.
    
    Args:
        dry_run: If True, don't commit changes, just show what would happen
    """
    run_type = "DRY RUN" if dry_run else "ACTUAL MIGRATION"
    print("="*60)
    print(f"LEGACY DATABASE MIGRATION - {run_type}")
    print("="*60)
    
    # Check legacy database exists
    if not LEGACY_DB_PATH.exists():
        print(f"❌ Legacy database not found at {LEGACY_DB_PATH}")
        return
    
    # Backup destination database before migration (only if not dry run and DB exists)
    if not dry_run and NEW_DB_PATH.exists():
        backup_timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        backup_path = Path(__file__).parent / f'belgian_nodes_backup_{backup_timestamp}.db'
        print(f"\n0. Creating backup of destination database...")
        try:
            shutil.copy2(NEW_DB_PATH, backup_path)
            print(f"   ✅ Backup created: {backup_path.name}")
        except Exception as e:
            print(f"   ⚠️  Warning: Could not create backup: {e}")
            response = input("   Continue without backup? (yes/no): ").strip().lower()
            if response not in ['yes', 'y']:
                print("Migration cancelled.")
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
    
    # Prepare log files (save in migration folder)
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    migration_dir = Path(__file__).parent
    completed_claiming_log = migration_dir / f'completed_claiming_{timestamp}.log'
    city_review_log = migration_dir / f'city_review_{timestamp}.log'
    source_only_migration_log = migration_dir / f'source_only_migration_{timestamp}.log'
    source_only_no_owner_log = migration_dir / f'source_only_no_owner_{timestamp}.log'
    
    # Ensure migration directory exists
    migration_dir.mkdir(parents=True, exist_ok=True)
    
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
        
        for dest_key, dest_node in dest_nodes.items():
            if dest_key in legacy_nodes:
                legacy_node = legacy_nodes[dest_key]
                owner_id = legacy_node.get('owner_discord_id')
                
                if owner_id and owner_id in legacy_users:
                    # Source has owner, check if destination doesn't
                    if not dest_node.get('discord_owner_id'):
                        username = legacy_users[owner_id]
                        if not dry_run:
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
                        if not dry_run:
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
                    missing_vars = []
                    if not dry_run:
                        missing_vars = insert_node_from_source(cursor, legacy_node, owner_id, username)
                    else:
                        # Dry run: check for missing vars without inserting
                        if not legacy_node.get('adv_name'):
                            missing_vars.append('adv_name')
                        if not legacy_node.get('type'):
                            missing_vars.append('type')
                        if legacy_node.get('adv_lat') is None:
                            missing_vars.append('adv_lat')
                        if legacy_node.get('adv_lon') is None:
                            missing_vars.append('adv_lon')
                        # Check for missing frequency parameters
                        if legacy_node.get('params_freq') is None:
                            missing_vars.append('params_freq')
                        if legacy_node.get('params_cr') is None:
                            missing_vars.append('params_cr')
                        if legacy_node.get('params_sf') is None:
                            missing_vars.append('params_sf')
                        if legacy_node.get('params_bw') is None:
                            missing_vars.append('params_bw')
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
        
        # Commit all changes (only if not dry run)
        if not dry_run:
            conn.commit()
            print("\n✅ Changes committed to database")
        else:
            conn.rollback()
            print("\n⚠️  DRY RUN - No changes committed to database")
        
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
    import argparse
    
    parser = argparse.ArgumentParser(description='Migrate data from legacy database')
    parser.add_argument('--execute', action='store_true', 
                       help='Actually execute the migration (default is dry run)')
    args = parser.parse_args()
    
    main(dry_run=not args.execute)
