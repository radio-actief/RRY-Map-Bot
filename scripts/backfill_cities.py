#!/usr/bin/env python3
"""
Backfill / rewrite the ``city`` column for every row in ``belgian_nodes.db``
using the local Belgian geocoder (:mod:`backend.belgian_geocoder`).

Why: historical rows were populated with Nominatim (Geopy) reverse-geocoding,
which returns mixed-language and slightly variant names (e.g. "Rhode-Saint-Genèse"
vs "Sint-Genesius-Rode", "antwerp" vs "Antwerpen"). After switching the sync
pipeline to the local StatBel-based geocoder, this one-shot normalises the
whole database to the canonical ``plaats`` labels from ``data/be-locode.json``.

Behaviour:

- Copies the DB file to ``data/belgian_nodes_BU-backfillcities-<ts>.db`` before
  any write. Skipped in ``--dry-run`` and when ``--no-backup`` is set.
- Processes active rows by default (``is_active=1``); ``--include-inactive``
  widens the selection to every row with coordinates.
- **Overwrites ``city`` for every row with a geocoder hit**, including rows
  where the user previously set city via Discord (canonical StatBel label wins).
- Case/diacritics-insensitive comparison ("Aalst" == "aalst" == "Áalst"), so we
  don't churn rows whose existing label is already equivalent.
- Every change is also inserted into ``node_changes`` with
  ``change_type='city_backfill'`` for auditability.
- Writes a per-node TSV log at ``data/backfill_cities_<ts>.log``.

Usage::

    cd RRY-Map-Bot
    .venv/bin/python3 scripts/backfill_cities.py --dry-run
    .venv/bin/python3 scripts/backfill_cities.py
    .venv/bin/python3 scripts/backfill_cities.py --include-inactive
"""
from __future__ import annotations

import argparse
import json
import os
import re
import shutil
import sqlite3
import sys
import time
import unicodedata
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

SCRIPT_DIR = Path(__file__).resolve().parent
REPO_ROOT = SCRIPT_DIR.parent
sys.path.insert(0, str(REPO_ROOT))

# Load env before reading DATABASE_PATH (same idea as config.config).
try:
    from dotenv import load_dotenv
except ImportError:  # pragma: no cover
    load_dotenv = None  # type: ignore[misc, assignment]
else:
    load_dotenv(REPO_ROOT / ".env")
    for _extra in (".env.local", ".env.dev", ".env.prod"):
        load_dotenv(REPO_ROOT / _extra, override=False)

from backend.belgian_geocoder import BelgianGeocoder  # noqa: E402


# ------------------------------------------------------------------ helpers


def resolve_default_db_path() -> Path:
    """Resolve ``DATABASE_PATH`` the same way as ``backend.database.get_db_path``,
    but tolerate a production-only path (e.g. ``/app/data/belgian_nodes.db``) on a
    developer laptop where ``/app`` is missing or read-only.

    In that case we fall back to ``<repo>/data/belgian_nodes.db`` and print a
    warning. Override explicitly with ``--db`` when needed.
    """
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
    """Resolve ``--db`` to an absolute path and ensure its parent directory exists."""
    out = p.expanduser()
    if not out.is_absolute():
        out = (Path.cwd() / out).resolve()
    out.parent.mkdir(parents=True, exist_ok=True)
    return out


def norm_key(s: Optional[str]) -> str:
    """Case/diacritics-insensitive comparison key (same shape as generate-be-locode.norm_key)."""
    if not s:
        return ""
    s = s.lower().strip()
    s = "".join(c for c in unicodedata.normalize("NFD", s) if unicodedata.category(c) != "Mn")
    s = re.sub(r"[^a-z0-9]+", " ", s)
    return re.sub(r"\s+", " ", s).strip()


def _now_ts() -> str:
    return datetime.now(timezone.utc).isoformat()


def _run_ts() -> str:
    return datetime.now().strftime("%Y%m%d%H%M%S")


# ------------------------------------------------------------------ main


def backfill(
    db_path: Path,
    geojson_path: Optional[Path],
    buffer_m: Optional[float],
    dry_run: bool,
    include_inactive: bool,
    no_backup: bool,
    log_path: Path,
) -> int:
    print(f"DB:        {db_path}")
    print(f"Mode:      {'DRY RUN (no writes)' if dry_run else 'WRITE'}")
    print(f"Scope:     {'all rows' if include_inactive else 'active rows only'}")
    print(f"Log:       {log_path}")
    print()

    if not db_path.is_file():
        print(f"ERROR: database not found: {db_path}", file=sys.stderr)
        return 2

    # 1. Backup
    if not dry_run and not no_backup:
        backup = db_path.parent / f"belgian_nodes_BU-backfillcities-{_run_ts()}.db"
        shutil.copy2(db_path, backup)
        print(f"Backup:    {backup}")

    # 2. Geocoder
    t0 = time.time()
    try:
        g = BelgianGeocoder(geojson_path=geojson_path, buffer_m=buffer_m)
    except FileNotFoundError as e:
        print(f"ERROR: {e}", file=sys.stderr)
        return 3
    print(f"Geocoder:  {g!r} (loaded in {time.time() - t0:.2f}s)")
    print()

    # 3. Select
    conn = sqlite3.connect(str(db_path))
    conn.row_factory = sqlite3.Row
    cur = conn.cursor()

    where = "adv_lat IS NOT NULL AND adv_lon IS NOT NULL"
    if not include_inactive:
        where += " AND is_active = 1"
    cur.execute(
        f"SELECT public_key, adv_lat, adv_lon, city, is_active "
        f"FROM belgian_nodes WHERE {where}"
    )
    rows = cur.fetchall()
    print(f"Rows to process: {len(rows)}")

    # Also count rows without coords for the summary.
    cur.execute(
        "SELECT COUNT(*) FROM belgian_nodes WHERE adv_lat IS NULL OR adv_lon IS NULL"
    )
    no_coord_total = cur.fetchone()[0]

    # 4. Process
    actions = Counter()
    mismatches = Counter()

    log_path.parent.mkdir(parents=True, exist_ok=True)
    with open(log_path, "w", encoding="utf-8") as logf:
        logf.write("ts\tpublic_key\told_city\tnew_city\taction\treason\n")
        t1 = time.time()
        for i, row in enumerate(rows, 1):
            pk = row["public_key"]
            old_city = row["city"]
            lat = row["adv_lat"]
            lon = row["adv_lon"]

            result = g.geocode(lat, lon)

            if result is None:
                actions["not_belgian"] += 1
                logf.write(
                    f"{_now_ts()}\t{pk}\t{old_city or ''}\t\tnot_belgian\toutside_polygons\n"
                )
                continue

            new_city = result.get("plaats") or ""

            if norm_key(old_city) == norm_key(new_city):
                actions["unchanged"] += 1
                logf.write(
                    f"{_now_ts()}\t{pk}\t{old_city or ''}\t{new_city}\tunchanged\tequal_after_norm\n"
                )
                continue

            actions["updated"] += 1
            mismatches[(old_city or "", new_city)] += 1
            logf.write(
                f"{_now_ts()}\t{pk}\t{old_city or ''}\t{new_city}\tupdated\t"
                f"nis5={result.get('nis5')}\n"
            )

            if not dry_run:
                ts = _now_ts()
                # Update belgian_nodes
                cur.execute(
                    "UPDATE belgian_nodes SET city = ? WHERE public_key = ?",
                    (new_city, pk),
                )
                # Audit trail
                cur.execute(
                    "INSERT INTO node_changes (public_key, change_type, sync_date, old_data, new_data) "
                    "VALUES (?, ?, ?, ?, ?)",
                    (
                        pk,
                        "city_backfill",
                        ts,
                        json.dumps({"city": old_city}, ensure_ascii=False),
                        json.dumps(
                            {
                                "city": new_city,
                                "nis5": result.get("nis5"),
                                "province_code": result.get("province_code"),
                                "source": "local_geocoder_backfill",
                            },
                            ensure_ascii=False,
                        ),
                    ),
                )

            if i % 500 == 0:
                print(f"  processed {i}/{len(rows)}...", flush=True)

    if not dry_run:
        conn.commit()
    conn.close()

    elapsed = time.time() - t1
    rate = (len(rows) / elapsed) if elapsed > 0 else float("inf")

    # 5. Summary
    print()
    print("=" * 60)
    print(f"Backfill complete ({elapsed:.2f}s, {rate:.0f} rows/s)")
    print("=" * 60)
    print(f"  rows processed:          {len(rows)}")
    print(f"  rows skipped (no coords): {no_coord_total}")
    print()
    print("Action breakdown:")
    for action in ("updated", "unchanged", "not_belgian"):
        print(f"  {action:<24} {actions.get(action, 0)}")

    if mismatches:
        print()
        print("Top 20 old → new mismatches:")
        for (old, new), count in mismatches.most_common(20):
            print(f"  {count:>4}  {old!r:<40} -> {new!r}")

    if dry_run:
        print("\nDRY RUN — no changes written to the database.")
    else:
        print(f"\nLog written to {log_path}")
    return 0


def main() -> int:
    ap = argparse.ArgumentParser(
        description=(
            "One-shot: rewrite the city column in belgian_nodes.db using the "
            "local Belgian geocoder."
        )
    )
    ap.add_argument(
        "--db",
        type=Path,
        default=None,
        help=(
            "Path to the SQLite database (default: DATABASE_PATH from .env, "
            "or <repo>/data/belgian_nodes.db if that path is not writable — e.g. "
            "Docker /app/... on a laptop)."
        ),
    )
    ap.add_argument(
        "--geojson",
        type=Path,
        default=None,
        help="Path to be-municipalities.geojson (default: config / BE_MUNICIPALITIES_GEOJSON).",
    )
    ap.add_argument(
        "--buffer-meters",
        type=float,
        default=None,
        help="Override the nearest-gemeente buffer in metres (default: GEOCODE_BUFFER_METERS).",
    )
    ap.add_argument(
        "--dry-run",
        action="store_true",
        help="Compute and report, but do not write (and skip the DB backup).",
    )
    ap.add_argument(
        "--include-inactive",
        action="store_true",
        help="Also process rows where is_active=0.",
    )
    ap.add_argument(
        "--no-backup",
        action="store_true",
        help="Skip the automatic DB backup copy (NOT recommended).",
    )
    args = ap.parse_args()

    db_path = resolve_explicit_db_path(args.db) if args.db else resolve_default_db_path()
    log_path = (
        REPO_ROOT / "data" / f"backfill_cities_{_run_ts()}.log"
    )

    return backfill(
        db_path=db_path,
        geojson_path=args.geojson,
        buffer_m=args.buffer_meters,
        dry_run=args.dry_run,
        include_inactive=args.include_inactive,
        no_backup=args.no_backup,
        log_path=log_path,
    )


if __name__ == "__main__":
    raise SystemExit(main())
