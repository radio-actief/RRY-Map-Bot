#!/usr/bin/env python3
"""
Backfill the ``inserted_date`` column on every ``belgian_nodes`` row that
currently has a NULL or empty value.

Why: the stats chart and timeline playback treat each node's ``inserted_date``
as its "first seen on the official MeshCore map" date
(see ``get_synthetic_sync_rows`` / ``get_synthetic_node_changes`` in
``backend/api/app.py``). Rows with an empty ``inserted_date`` fall through a
``COALESCE`` to ``created_at``, distorting cumulative totals. The sync importer
stamps ``inserted_date = get_current_timestamp()`` when the feed omits it (see
``backend/sync_belgian_nodes.integrate_added_node``); this script is a
re-runnable safety net for historical rows. ``backend/migrations/reset_history``
also runs this backfill as part of the one-shot reset.

Behaviour:

- Copies the DB file to ``data/belgian_nodes_BU-backfillinserted-<ts>.db``
  before any write. Skipped in ``--dry-run`` and when ``--no-backup`` is set.
- Updates ``inserted_date`` to ``COALESCE(created_at, datetime('now'))``
  for every row where ``inserted_date IS NULL`` or ``trim(inserted_date) = ''``.
- Every change is recorded in ``node_changes`` with
  ``change_type = 'inserted_date_backfill'`` for auditability.
- Writes a per-node TSV log at ``data/backfill_inserted_date_<ts>.log``.
- Safe to re-run; a clean DB produces zero updates.

Usage::

    cd RRY-Map-Bot
    .venv/bin/python3 scripts/backfill_inserted_date.py --dry-run
    .venv/bin/python3 scripts/backfill_inserted_date.py
"""
from __future__ import annotations

import argparse
import json
import os
import shutil
import sqlite3
import sys
from datetime import datetime, timezone
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parent
REPO_ROOT = SCRIPT_DIR.parent
sys.path.insert(0, str(REPO_ROOT))

try:
    from dotenv import load_dotenv
except ImportError:  # pragma: no cover
    load_dotenv = None  # type: ignore[misc, assignment]
else:
    load_dotenv(REPO_ROOT / ".env")
    for _extra in (".env.local", ".env.dev", ".env.prod"):
        load_dotenv(REPO_ROOT / _extra, override=False)


def resolve_default_db_path() -> Path:
    """Mirror ``backend.database.get_db_path`` but tolerate a production path
    (e.g. ``/app/data/belgian_nodes.db``) on a developer machine."""
    env_path = os.getenv("DATABASE_PATH")
    db_path_str = env_path if env_path else "data/belgian_nodes.db"
    db_path = Path(db_path_str)
    if not db_path.is_absolute():
        db_path = Path.cwd() / db_path
    try:
        db_path.parent.mkdir(parents=True, exist_ok=True)
    except (OSError, PermissionError) as exc:
        fb = (REPO_ROOT / "data" / "belgian_nodes.db").resolve()
        print(
            f"WARN: DATABASE_PATH={db_path} is not usable on this host ({exc}).\n"
            f"      Using {fb} instead. Pass --db explicitly or fix DATABASE_PATH.",
            file=sys.stderr,
        )
        fb.parent.mkdir(parents=True, exist_ok=True)
        return fb
    return db_path


def resolve_explicit_db_path(p: Path) -> Path:
    out = p.expanduser()
    if not out.is_absolute():
        out = (Path.cwd() / out).resolve()
    out.parent.mkdir(parents=True, exist_ok=True)
    return out


def _now_ts() -> str:
    return datetime.now(timezone.utc).isoformat()


def _run_ts() -> str:
    return datetime.now().strftime("%Y%m%d%H%M%S")


def backfill(
    db_path: Path,
    dry_run: bool,
    no_backup: bool,
    log_path: Path,
) -> int:
    print(f"DB:   {db_path}")
    print(f"Mode: {'DRY RUN (no writes)' if dry_run else 'WRITE'}")
    print(f"Log:  {log_path}")
    print()

    if not db_path.is_file():
        print(f"ERROR: database not found: {db_path}", file=sys.stderr)
        return 2

    if not dry_run and not no_backup:
        backup = db_path.parent / f"belgian_nodes_BU-backfillinserted-{_run_ts()}.db"
        shutil.copy2(db_path, backup)
        print(f"Backup: {backup}")

    conn = sqlite3.connect(str(db_path))
    conn.row_factory = sqlite3.Row
    cur = conn.cursor()

    cur.execute(
        """
        SELECT public_key, inserted_date, created_at, is_active
        FROM belgian_nodes
        WHERE inserted_date IS NULL OR trim(inserted_date) = ''
        """
    )
    rows = cur.fetchall()
    print(f"Rows needing backfill: {len(rows)}")

    if not rows:
        conn.close()
        print("\nNothing to do. DB is already clean.")
        return 0

    log_path.parent.mkdir(parents=True, exist_ok=True)
    updated = 0
    with open(log_path, "w", encoding="utf-8") as logf:
        logf.write("ts\tpublic_key\tis_active\tfallback_source\tnew_inserted_date\n")
        for row in rows:
            pk = row["public_key"]
            created_at = (row["created_at"] or "").strip()
            ts = _now_ts()
            if created_at:
                new_inserted_date = created_at
                fallback_source = "created_at"
            else:
                new_inserted_date = ts
                fallback_source = "now"
            logf.write(
                f"{ts}\t{pk}\t{row['is_active']}\t{fallback_source}\t{new_inserted_date}\n"
            )

            if not dry_run:
                cur.execute(
                    "UPDATE belgian_nodes SET inserted_date = ? WHERE public_key = ?",
                    (new_inserted_date, pk),
                )
                cur.execute(
                    "INSERT INTO node_changes (public_key, change_type, sync_date, old_data, new_data) "
                    "VALUES (?, ?, ?, ?, ?)",
                    (
                        pk,
                        "inserted_date_backfill",
                        ts,
                        json.dumps({"inserted_date": None}, ensure_ascii=False),
                        json.dumps(
                            {
                                "inserted_date": new_inserted_date,
                                "fallback_source": fallback_source,
                            },
                            ensure_ascii=False,
                        ),
                    ),
                )
            updated += 1

    if not dry_run:
        conn.commit()
    conn.close()

    print()
    print("=" * 60)
    print(f"Backfill complete: {updated} row(s) updated")
    print("=" * 60)
    if dry_run:
        print("\nDRY RUN - no changes written to the database.")
    else:
        print(f"\nLog written to {log_path}")
    return 0


def main() -> int:
    ap = argparse.ArgumentParser(
        description=(
            "One-shot: set a non-empty inserted_date on every belgian_nodes row "
            "that has NULL or an empty string, using created_at (or current time "
            "as a last resort). Safe to re-run."
        ),
    )
    ap.add_argument(
        "--db",
        type=Path,
        default=None,
        help="Path to belgian_nodes.db (default: resolve DATABASE_PATH / data/belgian_nodes.db).",
    )
    ap.add_argument(
        "--dry-run",
        action="store_true",
        help="Do everything except write to the database.",
    )
    ap.add_argument(
        "--no-backup",
        action="store_true",
        help="Skip the pre-write DB copy. Default: copy DB next to the original.",
    )
    ap.add_argument(
        "--log",
        type=Path,
        default=None,
        help="Path for the TSV log. Default: data/backfill_inserted_date_<ts>.log.",
    )
    args = ap.parse_args()

    db_path = (
        resolve_explicit_db_path(args.db) if args.db else resolve_default_db_path()
    )
    log_path = args.log or (REPO_ROOT / "data" / f"backfill_inserted_date_{_run_ts()}.log")

    return backfill(
        db_path=db_path,
        dry_run=args.dry_run,
        no_backup=args.no_backup,
        log_path=log_path,
    )


if __name__ == "__main__":
    raise SystemExit(main())
