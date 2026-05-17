"""
UTC timestamps for storage and API.

All persisted / exchanged times use ``YYYY-MM-DDTHH:MM:SSZ`` (seconds, UTC).
Naive strings are treated as UTC. Display time zones (e.g. Europe/Brussels)
belong in the UI layer only.
"""

from __future__ import annotations

import re
from datetime import datetime, timezone
from typing import Any, Optional, Union

# Canonical storage format (seconds, Z suffix)
UTC_ISO_Z_RE = re.compile(r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$")

# Node fields synced from the official map API
NODE_TIMESTAMP_FIELDS = ("last_advert", "inserted_date", "updated_date")

# All TEXT timestamp columns worth auditing in belgian_nodes + related tables
DB_TIMESTAMP_COLUMNS: dict[str, tuple[str, ...]] = {
    "belgian_nodes": (
        "last_advert",
        "inserted_date",
        "updated_date",
        "last_sync_date",
        "removed_date",
    ),
    "node_changes": ("sync_date",),
    "sync_history": ("sync_date",),
    "digest_state": ("last_sent_utc",),
}


def parse_utc(value: Any) -> Optional[datetime]:
    """Parse a stored or API value to timezone-aware UTC. Naive => UTC."""
    if value is None:
        return None
    if isinstance(value, datetime):
        dt = value
    else:
        s = str(value).strip()
        if not s:
            return None
        if s.endswith("Z"):
            s = s[:-1] + "+00:00"
        try:
            dt = datetime.fromisoformat(s)
        except ValueError:
            for fmt in ("%Y-%m-%d %H:%M:%S", "%Y-%m-%dT%H:%M:%S"):
                try:
                    dt = datetime.strptime(s.split(".")[0], fmt)
                    break
                except ValueError:
                    continue
            else:
                return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc)


def format_utc_iso(dt: Union[datetime, str, None]) -> Optional[str]:
    """Format as ``YYYY-MM-DDTHH:MM:SSZ``."""
    if dt is None:
        return None
    if isinstance(dt, str):
        parsed = parse_utc(dt)
        if parsed is None:
            return None
        dt = parsed
    elif not isinstance(dt, datetime):
        return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def normalize_timestamp(value: Any) -> Optional[str]:
    """Parse and return canonical UTC ISO string, or None if empty/invalid."""
    if value is None:
        return None
    if isinstance(value, str) and not value.strip():
        return None
    return format_utc_iso(value)


def utc_now_iso() -> str:
    """Current UTC instant in canonical storage form."""
    return format_utc_iso(datetime.now(timezone.utc))  # type: ignore[arg-type]


def is_canonical_utc_iso(value: Any) -> bool:
    """True if value is already in canonical ``…Z`` form."""
    if not isinstance(value, str):
        return False
    return bool(UTC_ISO_Z_RE.match(value.strip()))


def normalize_node_timestamps(node: dict) -> dict:
    """Normalize known node date fields in place; return the same dict."""
    for field in NODE_TIMESTAMP_FIELDS:
        if field in node and node[field]:
            normalized = normalize_timestamp(node[field])
            if normalized is not None:
                node[field] = normalized
    return node
