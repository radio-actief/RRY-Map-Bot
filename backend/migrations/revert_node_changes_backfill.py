"""
Revert imported ``node_changes`` lifecycle rows from ``backfill_node_changes_from_backup``.

Deletes ``removed`` and ``restored`` events in the backfill window (default
``2026-04-01`` .. ``< 2026-05-06``). Safe on a post-reset DB where no real
lifecycle events existed before ``2026-05-06``.

Run::

    docker compose run --rm api python -m backend.migrations.revert_node_changes_backfill --confirm

Writes a backup of the live database before deleting and refuses to run without
``--confirm``.
"""

from __future__ import annotations

import argparse
import shutil
import sqlite3
import sys
from datetime import datetime
from pathlib import Path

from backend.database import get_db_path, init_database

REVERT_FROM = "2026-04-01"
REVERT_UNTIL = "2026-05-06"  # exclusive upper bound (same as backfill script)


def _backup_db(db_path: Path) -> Path:
    stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    backup = db_path.with_name(f"{db_path.name}.backup-{stamp}")
    shutil.copy2(db_path, backup)
    return backup


def _lifecycle_counts(conn: sqlite3.Connection) -> dict[str, int]:
    cur = conn.cursor()
    cur.execute(
        """
        SELECT change_type, COUNT(*)
        FROM node_changes
        WHERE change_type IN ('removed', 'restored')
        GROUP BY change_type
        """
    )
    out = {"removed": 0, "restored": 0}
    for change_type, count in cur.fetchall():
        out[change_type] = int(count)
    return out


def _window_count(
    conn: sqlite3.Connection,
    revert_from: str,
    revert_until: str,
) -> dict[str, int]:
    cur = conn.cursor()
    cur.execute(
        """
        SELECT change_type, COUNT(*)
        FROM node_changes
        WHERE change_type IN ('removed', 'restored')
          AND substr(sync_date, 1, 10) >= ?
          AND substr(sync_date, 1, 10) < ?
        GROUP BY change_type
        """,
        (revert_from, revert_until),
    )
    out = {"removed": 0, "restored": 0}
    for change_type, count in cur.fetchall():
        out[change_type] = int(count)
    return out


def _ledger_last(conn: sqlite3.Connection) -> int:
    """Approximate chart cumulative from DB (same formula as check_invariants)."""
    cur = conn.cursor()
    cur.execute(
        """
        SELECT COUNT(*) FROM belgian_nodes
        WHERE adv_lat IS NOT NULL AND adv_lon IS NOT NULL
        """
    )
    synthetic_adds = int(cur.fetchone()[0] or 0)

    cur.execute(
        """
        SELECT change_type, COUNT(*)
        FROM node_changes
        WHERE change_type IN ('removed', 'restored')
        GROUP BY change_type
        """
    )
    removed = restored = 0
    for change_type, count in cur.fetchall():
        if change_type == "removed":
            removed = int(count)
        elif change_type == "restored":
            restored = int(count)

    cur.execute(
        """
        SELECT COUNT(*)
        FROM node_changes nc
        LEFT JOIN belgian_nodes b ON b.public_key = nc.public_key
        WHERE nc.change_type = 'added' AND b.public_key IS NULL
        """
    )
    orphan_adds = int(cur.fetchone()[0] or 0)

    return synthetic_adds + orphan_adds + restored - removed


def revert_node_changes_backfill(
    live_path: Path,
    *,
    revert_from: str = REVERT_FROM,
    revert_until: str = REVERT_UNTIL,
) -> dict:
    conn = sqlite3.connect(str(live_path))
    cur = conn.cursor()
    before_all = _lifecycle_counts(conn)
    before_window = _window_count(conn, revert_from, revert_until)
    before_ledger = _ledger_last(conn)

    try:
        cur.execute("BEGIN")
        cur.execute(
            """
            DELETE FROM node_changes
            WHERE change_type IN ('removed', 'restored')
              AND substr(sync_date, 1, 10) >= ?
              AND substr(sync_date, 1, 10) < ?
            """,
            (revert_from, revert_until),
        )
        deleted = cur.rowcount
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        after_all = _lifecycle_counts(conn)
        after_window = _window_count(conn, revert_from, revert_until)
        after_ledger = _ledger_last(conn)
        conn.close()

    return {
        "revert_from": revert_from,
        "revert_until": revert_until,
        "deleted": deleted,
        "before_all": before_all,
        "after_all": after_all,
        "before_window": before_window,
        "after_window": after_window,
        "before_ledger": before_ledger,
        "after_ledger": after_ledger,
    }


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description=(
            "Revert node_changes backfill rows "
            f"({REVERT_FROM} <= date < {REVERT_UNTIL})."
        )
    )
    parser.add_argument(
        "--from-date",
        default=REVERT_FROM,
        help=f"Inclusive start date YYYY-MM-DD (default: {REVERT_FROM}).",
    )
    parser.add_argument(
        "--until-date",
        default=REVERT_UNTIL,
        help=f"Exclusive end date YYYY-MM-DD (default: {REVERT_UNTIL}).",
    )
    parser.add_argument(
        "--confirm",
        action="store_true",
        help="Required: actually delete backfill rows.",
    )
    args = parser.parse_args(argv)

    if not args.confirm:
        parser.error("Pass --confirm to apply the revert.")

    init_database()
    live_path = Path(get_db_path())

    if not live_path.exists():
        print(f"No database found at {live_path}; nothing to revert.")
        return 1

    backup_written = _backup_db(live_path)
    print(f"Live DB backup written to: {backup_written}")

    result = revert_node_changes_backfill(
        live_path,
        revert_from=args.from_date,
        revert_until=args.until_date,
    )

    bw = result["before_window"]
    aw = result["after_window"]
    ba = result["before_all"]
    aa = result["after_all"]

    print("Revert complete.")
    print(f"  Window:           {result['revert_from']} .. < {result['revert_until']}")
    print(f"  Rows deleted:     {result['deleted']}")
    print(
        f"  Window removed:   {bw['removed']} -> {aw['removed']} "
        f"(−{bw['removed'] - aw['removed']})"
    )
    print(
        f"  Window restored:  {bw['restored']} -> {aw['restored']} "
        f"(−{bw['restored'] - aw['restored']})"
    )
    print(
        f"  Total removed:    {ba['removed']} -> {aa['removed']}"
    )
    print(
        f"  Total restored:   {ba['restored']} -> {aa['restored']}"
    )
    print(
        f"  Ledger estimate:  {result['before_ledger']} -> {result['after_ledger']}"
    )
    print("\nNext step:")
    print("  docker compose exec api python tests/check_invariants.py http://localhost:8000")

    return 0


if __name__ == "__main__":
    sys.exit(main())
