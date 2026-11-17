"""
Add the tables behind the account page's choices: ``person_settings`` (show my name, share my
nodes with partner tools), ``node_managers`` and ``manager_invites`` (managers an owner invites).

Only ``CREATE TABLE IF NOT EXISTS``: safe on the live database and safe to run more than once.
The bot, the API and the sync also apply it on start (through ``init_database``), so running this
by hand is optional::

    docker compose run --rm sync python -m backend.migrations.add_claims_privacy
"""

from __future__ import annotations

import sqlite3

from backend.database import ensure_manager_tables, ensure_person_settings_table, get_db_path


def main() -> int:
    db_path = get_db_path()
    conn = sqlite3.connect(db_path)
    try:
        ensure_person_settings_table(conn)
        ensure_manager_tables(conn)
        conn.commit()
    finally:
        conn.close()
    print(f"claims and privacy tables present in {db_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
