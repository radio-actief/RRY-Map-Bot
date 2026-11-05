"""
Add the ``sync_state`` table (key/value, JSON values) used by the sync to
remember per-node geocode misses and removals held back by the safety cap.

Only ``CREATE TABLE IF NOT EXISTS``: safe on the live database and safe to
run more than once. The sync also creates the table on start (through
``init_database``), so running this by hand is optional::

    docker compose run --rm sync python -m backend.migrations.add_sync_state
"""

from __future__ import annotations

import sqlite3

from backend.database import ensure_sync_state_table, get_db_path


def main() -> int:
    db_path = get_db_path()
    conn = sqlite3.connect(db_path)
    try:
        ensure_sync_state_table(conn)
        conn.commit()
    finally:
        conn.close()
    print(f"sync_state table present in {db_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
