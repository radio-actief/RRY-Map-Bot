"""
Regression tests for the simplified stats-history pipeline.

After ``reset_history.py`` the chart's first-seen seed and the forward-only
``node_changes`` ledger share one ``_displayable_predicate``. These tests cover:

- The synthetic per-day adds count only currently displayable rows (active and
  with valid map coordinates).
- ``_get_sync_history_from_node_changes`` returns ``[]`` when ``node_changes``
  is empty (clean slate behaviour).
"""

import os
import sqlite3
import sys
import tempfile
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))


class TestSyntheticOnlyDisplayable(unittest.TestCase):
    """Synthetic nodes_added must reflect the unified displayable predicate."""

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

    def test_synthetic_excludes_inactive_and_missing_coords(self):
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
                # Counts: active with coordinates.
                ("active1", 1, "A", 50.85, 4.35, "Brussels",
                 "2026-02-01T12:00:00", "2026-02-01", "2026-02-01T12:00:00",
                 "{}", "", "app", 1, "2026-02-01 10:00:00"),
                # Excluded: inactive.
                ("inactive1", 1, "B", 50.86, 4.36, "Brussels",
                 "2026-02-01T12:00:00", "2026-02-01", "2026-02-01T12:00:00",
                 "{}", "", "app", 0, "2026-02-01 10:00:00"),
                # Excluded: active but no coordinates.
                ("noLatLon1", 1, "C", None, None, None,
                 "2026-02-01T12:00:00", "2026-02-01", "2026-02-01T12:00:00",
                 "{}", "", "app", 1, "2026-02-01 10:00:00"),
            ],
        )
        conn.commit()
        conn.close()

        rows = get_synthetic_sync_rows()
        by_date = {str(r["sync_date"])[:10]: r["nodes_added"] for r in rows}
        self.assertEqual(by_date.get("2026-02-01"), 1)


class TestEmptyNodeChangesSmoke(unittest.TestCase):
    """An empty node_changes table must produce no removed/restored/updated rows."""

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

    def test_empty_node_changes_returns_no_rows(self):
        from backend.database import init_database
        from backend.api.app import _get_sync_history_from_node_changes

        init_database()
        # No belgian_nodes, no node_changes inserted.
        rows = _get_sync_history_from_node_changes()
        self.assertEqual(rows, [])

    def test_row_filter_unfiltered_passes(self):
        from backend.api.app import _row_matches_frequency_filter

        self.assertTrue(_row_matches_frequency_filter(None, None, None))
        self.assertTrue(_row_matches_frequency_filter({}, None, None))
        self.assertTrue(_row_matches_frequency_filter(None, "all", None))


if __name__ == "__main__":
    unittest.main()
