"""
Database utilities for RRY-Map-Bot
Handles SQLite database initialization, schema creation, and connection management.
"""

import sqlite3
import json
import os
from datetime import datetime, timezone
from typing import Optional, Dict, Any, List
from pathlib import Path
import sys

# Try to import config, fallback to default if not available
try:
    sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))
    from config.config import DATABASE_PATH
except (ImportError, ModuleNotFoundError):
    # Fallback to default path if config not available
    DATABASE_PATH = 'data/belgian_nodes.db'


def get_db_path() -> str:
    """Get the database file path, creating directory if needed."""
    # Check environment variable first (allows runtime override)
    env_path = os.getenv('DATABASE_PATH')
    db_path_str = env_path if env_path else DATABASE_PATH
    db_path = Path(db_path_str)
    # If path is relative, make it absolute based on current working directory
    if not db_path.is_absolute():
        db_path = Path.cwd() / db_path
    db_path.parent.mkdir(parents=True, exist_ok=True)
    return str(db_path)


def get_connection() -> sqlite3.Connection:
    """Get a database connection with row factory."""
    conn = sqlite3.connect(get_db_path())
    conn.row_factory = sqlite3.Row  # Enable column access by name
    return conn


def init_database() -> None:
    """
    Initialize the database with all required tables and indexes.
    Creates tables if they don't exist.
    """
    conn = get_connection()
    cursor = conn.cursor()
    
    try:
        # Create belgian_nodes table
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS belgian_nodes (
                public_key VARCHAR(64) PRIMARY KEY,
                type INTEGER NOT NULL,
                adv_name VARCHAR(255),
                adv_lat REAL,
                adv_lon REAL,
                city VARCHAR(100),
                last_advert TEXT,
                inserted_date TEXT,
                updated_date TEXT,
                params TEXT,  -- JSON stored as TEXT in SQLite
                link TEXT,
                source VARCHAR(20),
                inserted_by VARCHAR(64),
                updated_by VARCHAR(64),
                discord_owner_id VARCHAR(20),
                discord_owner_name VARCHAR(100),
                discord_updated_date TEXT,
                synced_from_official INTEGER DEFAULT 0,  -- BOOLEAN as INTEGER
                last_sync_date TEXT,
                is_active INTEGER DEFAULT 1,  -- BOOLEAN as INTEGER (1 = TRUE, 0 = FALSE)
                removed_from_official INTEGER DEFAULT 0,  -- BOOLEAN as INTEGER
                removed_date TEXT,
                created_at TEXT DEFAULT CURRENT_TIMESTAMP,
                updated_at TEXT DEFAULT CURRENT_TIMESTAMP
            )
        """)
        
        # Create sync_history table
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS sync_history (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                sync_date TEXT DEFAULT CURRENT_TIMESTAMP,
                nodes_added INTEGER DEFAULT 0,
                nodes_removed INTEGER DEFAULT 0,
                nodes_restored INTEGER DEFAULT 0,
                nodes_updated INTEGER DEFAULT 0,
                details TEXT  -- JSON stored as TEXT in SQLite
            )
        """)
        
        # Create node_changes table
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS node_changes (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                public_key VARCHAR(64),
                change_type VARCHAR(20),  -- 'added', 'removed', 'updated', 'restored'
                sync_date TEXT,
                old_data TEXT,  -- JSON stored as TEXT in SQLite
                new_data TEXT   -- JSON stored as TEXT in SQLite
            )
        """)
        
        # Create indexes for performance
        # Index on is_active for filtering active nodes
        cursor.execute("""
            CREATE INDEX IF NOT EXISTS idx_belgian_nodes_is_active 
            ON belgian_nodes(is_active)
        """)
        
        # Index on discord_owner_id for user queries
        cursor.execute("""
            CREATE INDEX IF NOT EXISTS idx_belgian_nodes_discord_owner_id 
            ON belgian_nodes(discord_owner_id)
        """)
        
        # Index on city for filtering
        cursor.execute("""
            CREATE INDEX IF NOT EXISTS idx_belgian_nodes_city 
            ON belgian_nodes(city)
        """)
        
        # Index on type for filtering
        cursor.execute("""
            CREATE INDEX IF NOT EXISTS idx_belgian_nodes_type 
            ON belgian_nodes(type)
        """)
        
        # Index on public_key (lowercase) for case-insensitive search
        # SQLite doesn't support functional indexes directly, but we can use LOWER() in queries
        # For now, we'll rely on the PRIMARY KEY index
        
        # Index on adv_name (lowercase) for case-insensitive search
        # We'll use LOWER() in queries instead of a functional index
        
        # Index on sync_date for sync_history queries
        cursor.execute("""
            CREATE INDEX IF NOT EXISTS idx_sync_history_sync_date 
            ON sync_history(sync_date)
        """)
        
        # Index on public_key and change_type for node_changes queries
        cursor.execute("""
            CREATE INDEX IF NOT EXISTS idx_node_changes_public_key 
            ON node_changes(public_key)
        """)
        
        cursor.execute("""
            CREATE INDEX IF NOT EXISTS idx_node_changes_change_type 
            ON node_changes(change_type)
        """)

        # Index on sync_date to speed up daily digest queries
        cursor.execute("""
            CREATE INDEX IF NOT EXISTS idx_node_changes_sync_date
            ON node_changes(sync_date)
        """)

        # Digest state (single-row) table used by the daily Discord digest
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS digest_state (
                id              INTEGER PRIMARY KEY CHECK (id = 1),
                last_sent_utc   TEXT,
                last_channel_id TEXT,
                last_message_id TEXT
            )
        """)
        cursor.execute("""
            INSERT OR IGNORE INTO digest_state (id, last_sent_utc)
            VALUES (1, NULL)
        """)

        conn.commit()
        print(f"Database initialized successfully at {get_db_path()}")
        
    except sqlite3.Error as e:
        conn.rollback()
        print(f"Error initializing database: {e}")
        raise
    finally:
        conn.close()


def json_serialize(data: Any) -> str:
    """Serialize Python object to JSON string for storage."""
    if data is None:
        return None
    return json.dumps(data)


def json_deserialize(data: str) -> Any:
    """Deserialize JSON string from database to Python object."""
    if data is None:
        return None
    try:
        return json.loads(data)
    except (json.JSONDecodeError, TypeError):
        return None


def dict_from_row(row: sqlite3.Row) -> Dict[str, Any]:
    """Convert a database row to a dictionary, deserializing JSON fields."""
    if row is None:
        return None
    
    result = dict(row)
    
    # Deserialize JSON fields - ensure params is always a dict
    if 'params' in result and result['params'] is not None:
        if isinstance(result['params'], str) and result['params'].strip():
            try:
                result['params'] = json_deserialize(result['params']) or {}
            except Exception:
                result['params'] = {}
        elif not isinstance(result['params'], dict):
            result['params'] = {}
    else:
        result['params'] = {}
    
    if 'details' in result and result['details']:
        result['details'] = json_deserialize(result['details'])
    
    if 'old_data' in result and result['old_data']:
        result['old_data'] = json_deserialize(result['old_data'])
    
    if 'new_data' in result and result['new_data']:
        result['new_data'] = json_deserialize(result['new_data'])
    
    # Convert INTEGER booleans to Python booleans
    boolean_fields = ['synced_from_official', 'is_active', 'removed_from_official']
    for field in boolean_fields:
        if field in result:
            result[field] = bool(result[field]) if result[field] is not None else False
    
    return result


def get_current_timestamp() -> str:
    """Get current timestamp as ISO format string in UTC."""
    return datetime.now(timezone.utc).isoformat()


def verify_schema() -> bool:
    """
    Verify that all required tables and columns exist.
    Returns True if schema is valid, False otherwise.
    """
    conn = get_connection()
    cursor = conn.cursor()
    
    try:
        # Check if all tables exist
        cursor.execute("""
            SELECT name FROM sqlite_master 
            WHERE type='table' AND name IN ('belgian_nodes', 'sync_history', 'node_changes')
        """)
        tables = {row[0] for row in cursor.fetchall()}
        
        required_tables = {'belgian_nodes', 'sync_history', 'node_changes'}
        if tables != required_tables:
            print(f"Missing tables. Found: {tables}, Required: {required_tables}")
            return False
        
        # Check belgian_nodes columns
        cursor.execute("PRAGMA table_info(belgian_nodes)")
        columns = {row[1] for row in cursor.fetchall()}
        
        required_columns = {
            'public_key', 'type', 'adv_name', 'adv_lat', 'adv_lon', 'city',
            'last_advert', 'inserted_date', 'updated_date', 'params', 'link',
            'source', 'inserted_by', 'updated_by', 'discord_owner_id',
            'discord_owner_name', 'discord_updated_date', 'synced_from_official',
            'last_sync_date', 'is_active', 'removed_from_official', 'removed_date',
            'created_at', 'updated_at'
        }
        
        missing_columns = required_columns - columns
        if missing_columns:
            print(f"Missing columns in belgian_nodes: {missing_columns}")
            return False
        
        print("Schema verification passed")
        return True
        
    except sqlite3.Error as e:
        print(f"Error verifying schema: {e}")
        return False
    finally:
        conn.close()


if __name__ == '__main__':
    """Initialize database when run directly."""
    print("Initializing RRY-Map-Bot database...")
    init_database()
    
    print("\nVerifying schema...")
    if verify_schema():
        print("✅ Database setup complete!")
    else:
        print("❌ Schema verification failed!")
        sys.exit(1)

