"""Stats playback: when there are more 'updated' changes than the limit, the newest are kept."""

import json

import backend.api.app as api
from backend.database import get_connection


def test_the_newest_updates_are_kept_when_over_the_limit(temp_db):
    conn = get_connection()
    for day in range(1, 6):
        data = json.dumps({"adv_name": f"Node day {day}", "adv_lat": 51.0, "adv_lon": 3.7, "type": 2})
        conn.execute(
            "INSERT INTO node_changes (public_key, change_type, sync_date, old_data, new_data) VALUES (?, 'updated', ?, ?, ?)",
            ("ab" * 32, f"2026-11-0{day}T12:00:00", data, data),
        )
    conn.commit()
    conn.close()

    rows = [r for r in api.get_node_changes_since(limit=2) if r.get("change_type") == "updated"]
    assert [r["sync_date"][:10] for r in rows] == ["2026-11-04", "2026-11-05"]
