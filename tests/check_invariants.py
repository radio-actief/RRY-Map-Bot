"""
Invariant checker that hits the live API container.

Run inside the running ``api`` container::

    docker compose exec api python tests/check_invariants.py http://localhost:8000

Asserts the four counts agree:

- ``GET /api/v1/belgian-nodes/count``
- ``GET /api/v1/stats.displayable_map_nodes``
- ``sum(GET /api/v1/stats.by_type_map.values())``
- last cumulative of ``GET /api/v1/sync-history`` ledger
- last frame of ``GET /api/v1/node-changes`` aggregated to a total

Polls ``/api/v1/health`` for up to 30 seconds before measuring so the script
also works right after ``docker compose up -d api``.
"""

from __future__ import annotations

import json
import sys
import time
import urllib.error
import urllib.request


def _get(url: str) -> dict | list:
    with urllib.request.urlopen(url, timeout=10) as resp:
        return json.loads(resp.read().decode("utf-8"))


def _wait_for_health(base: str, timeout_s: float = 30.0) -> None:
    deadline = time.time() + timeout_s
    last_err: Exception | None = None
    while time.time() < deadline:
        try:
            _get(f"{base}/api/v1/health")
            return
        except urllib.error.URLError as e:
            last_err = e
            time.sleep(1.0)
    raise SystemExit(f"API health check timed out: {last_err}")


def _ledger_last(history: list[dict]) -> int:
    cumulative = 0
    last = 0
    for r in sorted(history, key=lambda x: (x.get("sync_date") or "")):
        cumulative += (
            int(r.get("nodes_added") or 0)
            + int(r.get("nodes_restored") or 0)
            - int(r.get("nodes_removed") or 0)
        )
        last = cumulative
    return last


def _playback_last_frame_total(changes: list[dict]) -> int:
    visible: set[str] = set()
    for c in sorted(changes, key=lambda x: (x.get("sync_date") or "")):
        pk = c.get("public_key")
        if not pk:
            continue
        ct = c.get("change_type")
        if ct in ("added", "restored", "updated"):
            visible.add(pk)
        elif ct == "removed":
            visible.discard(pk)
    return len(visible)


def main(argv: list[str]) -> int:
    if len(argv) < 2:
        print("usage: check_invariants.py <base-url>", file=sys.stderr)
        return 2
    base = argv[1].rstrip("/")
    _wait_for_health(base)

    count = int(_get(f"{base}/api/v1/belgian-nodes/count").get("count", 0))
    stats = _get(f"{base}/api/v1/stats")
    displayable = int(stats.get("displayable_map_nodes") or 0)
    by_type_total = sum(int(v) for v in (stats.get("by_type_map") or {}).values())

    history = _get(f"{base}/api/v1/sync-history")
    if isinstance(history, dict):
        history = history.get("history") or history.get("rows") or []
    ledger_last = _ledger_last(history)

    changes = _get(f"{base}/api/v1/node-changes")
    if isinstance(changes, dict):
        changes = changes.get("changes") or changes.get("rows") or []
    playback_last = _playback_last_frame_total(changes)

    failures: list[str] = []
    if count != displayable:
        failures.append(
            f"belgian-nodes/count={count} != displayable_map_nodes={displayable}"
        )
    if displayable != by_type_total:
        failures.append(
            f"displayable_map_nodes={displayable} != sum(by_type_map)={by_type_total}"
        )
    if ledger_last != displayable:
        failures.append(
            f"sync-history ledger last={ledger_last} != displayable_map_nodes={displayable}"
        )
    if playback_last != displayable:
        failures.append(
            f"node-changes playback last={playback_last} "
            f"!= displayable_map_nodes={displayable}"
        )

    if failures:
        print("INVARIANT FAILURES:", file=sys.stderr)
        for f in failures:
            print(f"  - {f}", file=sys.stderr)
        return 1

    print(
        f"OK: count={count} displayable={displayable} "
        f"sum(by_type_map)={by_type_total} ledger_last={ledger_last} "
        f"playback_last={playback_last}"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
