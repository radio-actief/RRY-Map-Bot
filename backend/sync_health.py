"""
Sync freshness check.

Reports how long ago the last ``sync_history`` row was written and calls the
sync stale once that is more than twice the sync interval. The interval comes
from the same env vars as the sync loop in docker-compose.yml:
``SYNC_INTERVAL_MINUTES``, else ``SYNC_INTERVAL_HOURS`` x 60, else 6 h.

Used by ``GET /api/v1/health/sync`` and, as a script, by the sync container's
healthcheck (exit 0 = fresh, 1 = stale or no history)::

    python3 backend/sync_health.py
"""

from __future__ import annotations

import json
import os
import sqlite3
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, Optional, Tuple

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

from backend.database import get_db_path  # noqa: E402
from backend.datetime_utils import format_utc_iso, parse_utc  # noqa: E402

STALE_AFTER_INTERVALS = 2


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


def sync_interval_minutes() -> int:
    """Sync interval in minutes, resolved like the sync loop does."""
    minutes = os.getenv('SYNC_INTERVAL_MINUTES', '').strip()
    if minutes:
        return int(minutes)
    return int(os.getenv('SYNC_INTERVAL_HOURS', '6').strip() or '6') * 60


def _last_history_row(db_path: str) -> Optional[Tuple[str, Any]]:
    """Latest ``(sync_date, details)``; ``None`` if there is no DB or no row.

    Opens the DB read-only so a check never creates or locks it for writing.
    """
    if not Path(db_path).is_file():
        return None
    try:
        conn = sqlite3.connect(f"file:{db_path}?mode=ro", uri=True, timeout=5)
    except sqlite3.Error:
        return None
    try:
        return conn.execute(
            "SELECT sync_date, details FROM sync_history ORDER BY id DESC LIMIT 1"
        ).fetchone()
    except sqlite3.Error:
        return None
    finally:
        conn.close()


def get_sync_health(now: Optional[datetime] = None) -> Tuple[Dict[str, Any], int]:
    """Return ``(body, http_status)``: 200 ``ok``, 503 ``stale`` or ``no_history``."""
    now = now or _utcnow()
    interval = sync_interval_minutes()
    stale_after = interval * STALE_AFTER_INTERVALS
    body: Dict[str, Any] = {
        'status': 'no_history',
        'last_sync_utc': None,
        'age_minutes': None,
        'interval_minutes': interval,
        'stale_after_minutes': stale_after,
    }

    row = _last_history_row(get_db_path())
    last = parse_utc(row[0]) if row else None
    if last is None:
        return body, 503

    age_minutes = int((now - last).total_seconds() // 60)
    body['last_sync_utc'] = format_utc_iso(last)
    body['age_minutes'] = age_minutes
    body['status'] = 'stale' if age_minutes > stale_after else 'ok'

    try:
        details = json.loads(row[1]) if row[1] else {}
    except (TypeError, ValueError):
        details = {}
    if isinstance(details, dict):
        safety = details.get('removal_safety') or {}
        body['last_run'] = {
            'error_count': details.get('error_count', 0),
            'removals_held': safety.get('held_count', 0),
        }

    return body, (200 if body['status'] == 'ok' else 503)


def main() -> int:
    body, status = get_sync_health()
    print(json.dumps(body))
    return 0 if status == 200 else 1


if __name__ == '__main__':
    sys.exit(main())
