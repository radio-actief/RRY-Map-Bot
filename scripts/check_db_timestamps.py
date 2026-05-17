#!/usr/bin/env python3
"""
Scan the SQLite DB for timestamps not in canonical UTC ISO (YYYY-MM-DDTHH:MM:SSZ).

Usage:
  python scripts/check_db_timestamps.py
  python scripts/check_db_timestamps.py --fix   # rewrite non-canonical values
"""
from __future__ import annotations

import argparse
import os
import sqlite3
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO_ROOT))

from backend.datetime_utils import (  # noqa: E402
    DB_TIMESTAMP_COLUMNS,
    is_canonical_utc_iso,
    normalize_timestamp,
)
from backend.database import get_db_path  # noqa: E402


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--fix",
        action="store_true",
        help="Update non-canonical timestamp values in place",
    )
    parser.add_argument(
        "--db",
        default=os.getenv("DATABASE_PATH") or str(get_db_path()),
        help="Path to SQLite database (default: config DATABASE_PATH)",
    )
    args = parser.parse_args()

    db_path = Path(args.db)
    if not db_path.is_file():
        print(f"Database not found: {db_path}")
        return 1

    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    issues: list[tuple[str, str, str, str]] = []
    fixed = 0

    for table, columns in DB_TIMESTAMP_COLUMNS.items():
        cursor = conn.execute(
            "SELECT name FROM sqlite_master WHERE type='table' AND name=?",
            (table,),
        )
        if not cursor.fetchone():
            continue
        table_cols = {row[1] for row in conn.execute(f"PRAGMA table_info({table})")}
        for col in columns:
            if col not in table_cols:
                continue
            if table == "belgian_nodes":
                pk_col = "public_key"
            elif table == "digest_state":
                pk_col = "id"
            else:
                pk_col = "rowid"

            for row in conn.execute(
                f"SELECT {pk_col} AS _pk, {col} AS _val "
                f"FROM {table} WHERE {col} IS NOT NULL AND {col} != ''"
            ):
                pk_val = row["_pk"]
                val = row["_val"]
                if is_canonical_utc_iso(val):
                    continue
                normalized = normalize_timestamp(val)
                if normalized is None:
                    issues.append((table, col, str(pk_val), f"unparseable: {val!r}"))
                    continue
                issues.append((table, col, str(pk_val), f"{val!r} -> {normalized!r}"))
                if args.fix:
                    conn.execute(
                        f"UPDATE {table} SET {col} = ? WHERE {pk_col} = ?",
                        (normalized, pk_val),
                    )
                    fixed += 1

    if args.fix and fixed:
        conn.commit()

    conn.close()

    if not issues:
        print(f"OK: all timestamp columns canonical in {db_path}")
        return 0

    print(f"Found {len(issues)} non-canonical value(s) in {db_path}:")
    for table, col, pk, detail in issues[:50]:
        print(f"  {table}.{col} [{pk}]: {detail}")
    if len(issues) > 50:
        print(f"  ... and {len(issues) - 50} more")
    if args.fix:
        print(f"Fixed {fixed} row(s).")
    else:
        print("Re-run with --fix to normalize in place.")
    return 1 if not args.fix else 0


if __name__ == "__main__":
    raise SystemExit(main())
