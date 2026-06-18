"""
One-shot backfill of ``node_changes`` lifecycle rows from a pre-reset database backup.

Imports ``removed`` and ``restored`` events from ``BACKFILL_FROM`` through
``BACKFILL_UNTIL`` (inclusive start, exclusive end on the calendar day boundary used
for the reset cut-off). Rows already present in the live database are skipped.

``added`` rows are not imported: surviving nodes already have first-seen days via
``belgian_nodes.inserted_date``; orphan ``added`` events for keys deleted at reset
are replayed automatically from ``node_changes`` when no ``belgian_nodes`` row
exists (import those separately if needed).

Typical use after ``reset_history.py`` wiped April–early-May history::

    docker compose run --rm api python -m backend.migrations.backfill_node_changes_from_backup \\
        --backup data/belgian_nodes.db.backup-20260505-224825 --confirm

The script writes a backup of the live database before inserting and refuses to run
without ``--confirm``.
"""

from __future__ import annotations

import argparse
import shutil
import sqlite3
import sys
from datetime import datetime
from pathlib import Path

from backend.database import get_db_path, init_database

BACKFILL_FROM = "2026-04-01"
BACKFILL_UNTIL = "2026-05-06"  # exclusive upper bound (reset boundary)

_LIFECYCLE_TYPES = ("removed", "restored")


def _backup_db(db_path: Path) -> Path:
    stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    backup = db_path.with_name(f"{db_path.name}.backup-{stamp}")
    shutil.copy2(db_path, backup)
    return backup


def _existing_keys(conn: sqlite3.Connection) -> set[tuple[str, str, str]]:
    """(public_key, change_type, sync_date) already in the live ledger."""
    cur = conn.cursor()
    cur.execute(
        """
        SELECT public_key, change_type, sync_date
        FROM node_changes
        WHERE change_type IN ('removed', 'restored')
        """
    )
    return {(row[0], row[1], row[2]) for row in cur.fetchall() if row[0] and row[1]}


def backfill_node_changes(
    live_path: Path,
    backup_path: Path,
    *,
    backfill_from: str = BACKFILL_FROM,
    backfill_until: str = BACKFILL_UNTIL,
) -> dict:
    if not backup_path.exists():
        raise FileNotFoundError(f"Backup database not found: {backup_path}")

    live = sqlite3.connect(str(live_path))
    src = sqlite3.connect(str(backup_path))
    live_cur = live.cursor()
    src_cur = src.cursor()

    existing = _existing_keys(live)
    src_cur.execute(
        f"""
        SELECT public_key, change_type, sync_date, old_data, new_data
        FROM node_changes
        WHERE change_type IN ({",".join("?" * len(_LIFECYCLE_TYPES))})
          AND substr(sync_date, 1, 10) >= ?
          AND substr(sync_date, 1, 10) < ?
        ORDER BY sync_date ASC
        """,
        (*_LIFECYCLE_TYPES, backfill_from, backfill_until),
    )
    rows = src_cur.fetchall()

    inserted = 0
    skipped_dup = 0
    skipped_invalid = 0

    try:
        live_cur.execute("BEGIN")
        for public_key, change_type, sync_date, old_data, new_data in rows:
            if not public_key or not change_type or not sync_date:
                skipped_invalid += 1
                continue
            key = (public_key, change_type, sync_date)
            if key in existing:
                skipped_dup += 1
                continue
            live_cur.execute(
                """
                INSERT INTO node_changes
                    (public_key, change_type, sync_date, old_data, new_data)
                VALUES (?, ?, ?, ?, ?)
                """,
                (public_key, change_type, sync_date, old_data, new_data),
            )
            existing.add(key)
            inserted += 1
        live.commit()
    except Exception:
        live.rollback()
        raise
    finally:
        live.close()
        src.close()

    return {
        "candidates": len(rows),
        "inserted": inserted,
        "skipped_dup": skipped_dup,
        "skipped_invalid": skipped_invalid,
        "backfill_from": backfill_from,
        "backfill_until": backfill_until,
    }


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description=(
            "Backfill node_changes lifecycle rows from a pre-reset backup "
            f"({BACKFILL_FROM} <= date < {BACKFILL_UNTIL})."
        )
    )
    parser.add_argument(
        "--backup",
        required=True,
        help="Path to the source backup SQLite file (pre-reset belgian_nodes.db).",
    )
    parser.add_argument(
        "--from-date",
        default=BACKFILL_FROM,
        help=f"Inclusive start date YYYY-MM-DD (default: {BACKFILL_FROM}).",
    )
    parser.add_argument(
        "--until-date",
        default=BACKFILL_UNTIL,
        help=f"Exclusive end date YYYY-MM-DD (default: {BACKFILL_UNTIL}).",
    )
    parser.add_argument(
        "--confirm",
        action="store_true",
        help="Required: actually insert backfill rows.",
    )
    args = parser.parse_args(argv)

    if not args.confirm:
        parser.error("Pass --confirm to apply the backfill.")

    init_database()
    live_path = Path(get_db_path())
    backup_path = Path(args.backup)

    if live_path.exists():
        backup_written = _backup_db(live_path)
        print(f"Live DB backup written to: {backup_written}")
    else:
        print(f"No live database at {live_path}; init_database() created an empty one.")

    result = backfill_node_changes(
        live_path,
        backup_path,
        backfill_from=args.from_date,
        backfill_until=args.until_date,
    )

    print("Backfill complete.")
    print(f"  Window:        {result['backfill_from']} .. < {result['backfill_until']}")
    print(f"  Candidates:    {result['candidates']}")
    print(f"  Inserted:      {result['inserted']}")
    print(f"  Skipped dup:   {result['skipped_dup']}")
    print(f"  Skipped invalid: {result['skipped_invalid']}")
    print("\nNext step:")
    print("  docker compose exec api python tests/check_invariants.py http://localhost:8000")
    print(
        "\nNote: if the cumulative Total line no longer matches the map header after "
        "backfill, surviving nodes may need ``inserted_date`` restored from the same "
        "backup (reset_history backfilled first-seen days). April decline bars will "
        "still reflect imported removals."
    )

    return 0


if __name__ == "__main__":
    sys.exit(main())
