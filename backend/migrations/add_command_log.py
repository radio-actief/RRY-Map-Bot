"""
Add the ``command_log`` table (one row per Discord bot command) and the
``source`` column (``'bot'`` / ``'web'``) on ``node_claims``.

Only ``CREATE TABLE IF NOT EXISTS`` and ``ALTER TABLE ... ADD COLUMN`` when the
column is missing: safe on the live database and safe to run more than once.
The bot, the API and the sync also apply it on start (through
``init_database``), so running this by hand is optional::

    docker compose run --rm sync python -m backend.migrations.add_command_log
"""

from __future__ import annotations

import sqlite3

from backend.database import (
    ensure_command_log_table,
    ensure_node_claims_source_column,
    get_db_path,
)


def main() -> int:
    db_path = get_db_path()
    conn = sqlite3.connect(db_path)
    try:
        ensure_node_claims_source_column(conn)
        ensure_command_log_table(conn)
        conn.commit()
    finally:
        conn.close()
    print(f"command_log table and node_claims.source present in {db_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
