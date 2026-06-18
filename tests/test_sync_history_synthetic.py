"""
Regression tests for the stats-history pipeline.

The chart seeds first-seen adds from all nodes with coordinates (active or
inactive) and replays removed / restored / updated from ``node_changes``.
"""

import json
import os
import sqlite3
import sys
import tempfile
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))


class _TempDbTestCase(unittest.TestCase):
    def setUp(self):
        self._fd, self.db_path = tempfile.mkstemp(suffix=".db")
        os.close(self._fd)
        self._old_env_db = os.environ.get("DATABASE_PATH")
        os.environ["DATABASE_PATH"] = self.db_path
        import backend.database as dbm

        self._old_path = dbm.DATABASE_PATH
        dbm.DATABASE_PATH = self.db_path

    def tearDown(self):
        import backend.database as dbm

        dbm.DATABASE_PATH = self._old_path
        if self._old_env_db is not None:
            os.environ["DATABASE_PATH"] = self._old_env_db
        else:
            os.environ.pop("DATABASE_PATH", None)
        if os.path.exists(self.db_path):
            os.remove(self.db_path)


class TestSyntheticChartHistory(_TempDbTestCase):
    """Synthetic nodes_added uses chart history predicate (coords, any is_active)."""

    def test_synthetic_includes_inactive_with_coords(self):
        from backend.database import init_database
        from backend.api.app import get_synthetic_sync_rows

        init_database()
        conn = sqlite3.connect(self.db_path)
        cur = conn.cursor()
        cur.executemany(
            """
            INSERT INTO belgian_nodes (
                public_key, type, adv_name, adv_lat, adv_lon, city,
                last_advert, inserted_date, updated_date, params,
                link, source, is_active, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            [
                ("active1", 1, "A", 50.85, 4.35, "Brussels",
                 "2026-02-01T12:00:00", "2026-02-01", "2026-02-01T12:00:00",
                 "{}", "", "app", 1, "2026-02-01 10:00:00"),
                ("inactive1", 1, "B", 50.86, 4.36, "Brussels",
                 "2026-02-01T12:00:00", "2026-02-01", "2026-02-01T12:00:00",
                 "{}", "", "app", 0, "2026-02-01 10:00:00"),
                ("noLatLon1", 1, "C", None, None, None,
                 "2026-02-01T12:00:00", "2026-02-01", "2026-02-01T12:00:00",
                 "{}", "", "app", 1, "2026-02-01 10:00:00"),
            ],
        )
        conn.commit()
        conn.close()

        rows = get_synthetic_sync_rows()
        by_date = {str(r["sync_date"])[:10]: r["nodes_added"] for r in rows}
        self.assertEqual(by_date.get("2026-02-01"), 2)

    def test_removed_for_inactive_node_is_counted(self):
        from backend.database import init_database
        from backend.api.app import _get_sync_history_from_node_changes

        init_database()
        conn = sqlite3.connect(self.db_path)
        cur = conn.cursor()
        cur.execute(
            """
            INSERT INTO belgian_nodes (
                public_key, type, adv_name, adv_lat, adv_lon, city,
                last_advert, inserted_date, updated_date, params,
                link, source, is_active, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                "inactive1", 1, "B", 50.86, 4.36, "Brussels",
                "2026-02-01T12:00:00", "2026-02-01", "2026-02-01T12:00:00",
                "{}", "", "app", 0, "2026-02-01 10:00:00",
            ),
        )
        old_data = {
            "public_key": "inactive1",
            "adv_lat": 50.86,
            "adv_lon": 4.36,
            "adv_name": "B",
            "type": 1,
            "params": {},
        }
        cur.execute(
            """
            INSERT INTO node_changes (public_key, change_type, sync_date, old_data)
            VALUES (?, ?, ?, ?)
            """,
            ("inactive1", "removed", "2026-02-02T10:00:00", json.dumps(old_data)),
        )
        conn.commit()
        conn.close()

        rows = _get_sync_history_from_node_changes()
        by_date = {str(r["sync_date"])[:10]: r for r in rows}
        self.assertEqual(by_date.get("2026-02-02", {}).get("nodes_removed"), 1)


class TestEmptyNodeChangesSmoke(_TempDbTestCase):
    """An empty node_changes table must produce no removed/restored/updated rows."""

    def test_empty_node_changes_returns_no_rows(self):
        from backend.database import init_database
        from backend.api.app import _get_sync_history_from_node_changes

        init_database()
        rows = _get_sync_history_from_node_changes()
        self.assertEqual(rows, [])

    def test_row_filter_unfiltered_passes(self):
        from backend.api.app import _row_matches_frequency_filter

        self.assertTrue(_row_matches_frequency_filter(None, None, None))
        self.assertTrue(_row_matches_frequency_filter({}, None, None))
        self.assertTrue(_row_matches_frequency_filter(None, "all", None))


if __name__ == "__main__":
    unittest.main()
