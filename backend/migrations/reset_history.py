"""
One-shot database initialisation / reset for RRY-Map-Bot.

Wipes all change history and keeps only currently active belgian_nodes:

- ``DELETE FROM belgian_nodes WHERE is_active = 0``.
- Backfill ``inserted_date`` on surviving rows so every node has a first-seen day.
- Drop the legacy ``discord_updated_date`` column via SQLite table rebuild.
- Truncate ``node_changes`` and ``sync_history``; reset ``digest_state``.
- Create the ``node_claims`` event log and seed one ``claim`` row per currently
  owned active node with a ``CURRENT_TIMESTAMP`` value.
- ``VACUUM`` and report row counts.

Run via Docker once after installing or upgrading::

    docker compose run --rm api python -m backend.migrations.reset_history --confirm

The script writes a backup of the database next to it
(``data/belgian_nodes.db.backup-YYYYMMDD-HHMMSS``) before any destructive
statement and refuses to run without ``--confirm``.
"""

from __future__ import annotations

import argparse
import shutil
import sqlite3
import sys
from datetime import datetime
from pathlib import Path

from backend.database import get_db_path, init_database

# Columns kept on belgian_nodes after the rebuild (drops discord_updated_date).
_KEEP_COLUMNS = (
    "public_key",
    "type",
    "adv_name",
    "adv_lat",
    "adv_lon",
    "city",
    "last_advert",
    "inserted_date",
    "updated_date",
    "params",
    "link",
    "source",
    "inserted_by",
    "updated_by",
    "discord_owner_id",
    "discord_owner_name",
    "synced_from_official",
    "last_sync_date",
    "is_active",
    "removed_from_official",
    "removed_date",
    "created_at",
    "updated_at",
)

_BELGIAN_NODES_NEW_DDL = """
CREATE TABLE belgian_nodes_new (
    public_key VARCHAR(64) PRIMARY KEY,
    type INTEGER NOT NULL,
    adv_name VARCHAR(255),
    adv_lat REAL,
    adv_lon REAL,
    city VARCHAR(100),
    last_advert TEXT,
    inserted_date TEXT,
    updated_date TEXT,
    params TEXT,
    link TEXT,
    source VARCHAR(20),
    inserted_by VARCHAR(64),
    updated_by VARCHAR(64),
    discord_owner_id VARCHAR(20),
    discord_owner_name VARCHAR(100),
    synced_from_official INTEGER DEFAULT 0,
    last_sync_date TEXT,
    is_active INTEGER DEFAULT 1,
    removed_from_official INTEGER DEFAULT 0,
    removed_date TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP
)
"""


def _backup_db(db_path: Path) -> Path:
    stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    backup = db_path.with_name(f"{db_path.name}.backup-{stamp}")
    shutil.copy2(db_path, backup)
    return backup


def _table_columns(cursor: sqlite3.Cursor, table: str) -> set[str]:
    cursor.execute(f"PRAGMA table_info({table})")
    return {row[1] for row in cursor.fetchall()}


def _row_count(cursor: sqlite3.Cursor, table: str) -> int:
    try:
        cursor.execute(f"SELECT COUNT(*) FROM {table}")
        return cursor.fetchone()[0]
    except sqlite3.OperationalError:
        return 0


def _rebuild_belgian_nodes_without_discord_updated_date(
    cursor: sqlite3.Cursor,
) -> bool:
    """
    Drop the ``discord_updated_date`` column via the standard SQLite table
    rebuild. Returns True if a rebuild happened, False if the column was
    already absent.
    """
    columns = _table_columns(cursor, "belgian_nodes")
    if "discord_updated_date" not in columns:
        return False

    keep_csv = ", ".join(_KEEP_COLUMNS)
    cursor.executescript(
        f"""
        {_BELGIAN_NODES_NEW_DDL};
        INSERT INTO belgian_nodes_new ({keep_csv})
        SELECT {keep_csv} FROM belgian_nodes;
        DROP TABLE belgian_nodes;
        ALTER TABLE belgian_nodes_new RENAME TO belgian_nodes;
        CREATE INDEX IF NOT EXISTS idx_belgian_nodes_is_active
            ON belgian_nodes(is_active);
        CREATE INDEX IF NOT EXISTS idx_belgian_nodes_discord_owner_id
            ON belgian_nodes(discord_owner_id);
        CREATE INDEX IF NOT EXISTS idx_belgian_nodes_city
            ON belgian_nodes(city);
        CREATE INDEX IF NOT EXISTS idx_belgian_nodes_type
            ON belgian_nodes(type);
        """
    )
    return True


def _create_node_claims(cursor: sqlite3.Cursor) -> None:
    cursor.executescript(
        """
        CREATE TABLE IF NOT EXISTS node_claims (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            public_key VARCHAR(64) NOT NULL,
            discord_owner_id VARCHAR(20),
            discord_owner_name VARCHAR(100),
            action VARCHAR(10) NOT NULL,
            timestamp TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );
        CREATE INDEX IF NOT EXISTS idx_node_claims_public_key
            ON node_claims(public_key);
        CREATE INDEX IF NOT EXISTS idx_node_claims_owner
            ON node_claims(discord_owner_id);
        CREATE INDEX IF NOT EXISTS idx_node_claims_timestamp
            ON node_claims(timestamp);
        """
    )


def _seed_node_claims_from_current_owners(cursor: sqlite3.Cursor) -> int:
    """Insert one 'claim' event per currently owned active node. Returns count."""
    cursor.execute(
        """
        INSERT INTO node_claims
            (public_key, discord_owner_id, discord_owner_name, action, timestamp)
        SELECT public_key, discord_owner_id, discord_owner_name,
               'claim', datetime('now')
        FROM belgian_nodes
        WHERE is_active = 1
          AND discord_owner_id IS NOT NULL
          AND trim(discord_owner_id) != ''
        """
    )
    return cursor.rowcount


def reset_history(db_path: Path) -> dict:
    """Apply the full reset to ``db_path``. Returns a dict of before/after counts."""
    before = {}
    after = {}

    conn = sqlite3.connect(str(db_path))
    conn.row_factory = sqlite3.Row
    cursor = conn.cursor()
    try:
        for t in ("belgian_nodes", "node_changes", "sync_history", "node_claims"):
            before[t] = _row_count(cursor, t)

        cursor.execute("BEGIN")

        # Drop inactive rows.
        cursor.execute("DELETE FROM belgian_nodes WHERE is_active = 0")

        # Backfill inserted_date on surviving active rows.
        cursor.execute(
            """
            UPDATE belgian_nodes
               SET inserted_date = COALESCE(
                       NULLIF(trim(inserted_date), ''),
                       created_at,
                       datetime('now')
                   )
             WHERE is_active = 1
               AND (inserted_date IS NULL OR trim(inserted_date) = '')
            """
        )
        cursor.execute(
            """
            UPDATE belgian_nodes
               SET removed_from_official = 0, removed_date = NULL
             WHERE removed_from_official != 0 OR removed_date IS NOT NULL
            """
        )

        # Rebuild table to drop discord_updated_date column.
        rebuilt = _rebuild_belgian_nodes_without_discord_updated_date(cursor)

        # Truncate change ledgers.
        cursor.execute("DELETE FROM node_changes")
        cursor.execute("DELETE FROM sync_history")

        # Reset digest state if the table exists.
        try:
            cursor.execute(
                """
                UPDATE digest_state
                   SET last_sent_utc = NULL,
                       last_channel_id = NULL,
                       last_message_id = NULL
                 WHERE id = 1
                """
            )
        except sqlite3.OperationalError:
            pass

        # Create node_claims (idempotent) and seed from current owners.
        _create_node_claims(cursor)
        # Wipe any prior seed rows so re-running the migration is idempotent.
        cursor.execute("DELETE FROM node_claims")
        seeded = _seed_node_claims_from_current_owners(cursor)

        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        # VACUUM cannot run inside a transaction.
        try:
            conn.execute("VACUUM")
        except sqlite3.OperationalError:
            pass
        for t in ("belgian_nodes", "node_changes", "sync_history", "node_claims"):
            after[t] = _row_count(cursor, t)
        conn.close()

    return {
        "before": before,
        "after": after,
        "rebuilt_belgian_nodes": rebuilt,
        "seeded_claims": seeded,
    }


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description=(
            "Reset RRY-Map-Bot history: drop inactive nodes, truncate node_changes "
            "and sync_history, drop discord_updated_date, create and seed "
            "node_claims. Refuses to run without --confirm."
        )
    )
    parser.add_argument(
        "--confirm",
        action="store_true",
        help="Required: actually apply the destructive reset.",
    )
    args = parser.parse_args(argv)

    if not args.confirm:
        parser.error("Pass --confirm to apply the reset.")

    # Make sure the schema (and node_claims) exists before we operate on it.
    init_database()

    db_path = Path(get_db_path())
    if not db_path.exists():
        print(f"No database found at {db_path}; init_database() created an empty one.")

    backup_path = _backup_db(db_path) if db_path.exists() else None
    if backup_path is not None:
        print(f"Backup written to: {backup_path}")

    result = reset_history(db_path)

    print("Reset complete.")
    print(f"  belgian_nodes: {result['before']['belgian_nodes']} -> "
          f"{result['after']['belgian_nodes']}")
    print(f"  node_changes:  {result['before']['node_changes']} -> "
          f"{result['after']['node_changes']}")
    print(f"  sync_history:  {result['before']['sync_history']} -> "
          f"{result['after']['sync_history']}")
    print(f"  node_claims:   {result['before']['node_claims']} -> "
          f"{result['after']['node_claims']} "
          f"(seeded {result['seeded_claims']})")
    if result["rebuilt_belgian_nodes"]:
        print("  belgian_nodes rebuilt without discord_updated_date column.")

    print("\nNext steps:")
    print("  docker compose run --rm sync python3 backend/sync_belgian_nodes.py")
    print("  docker compose up -d api")
    print("  docker compose exec api python tests/check_invariants.py "
          "http://localhost:8000")

    return 0


if __name__ == "__main__":
    sys.exit(main())
