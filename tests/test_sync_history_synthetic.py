"""
Regression tests for stats chart sync history synthetic "nodes_added".

Synthetic daily adds must count every row with an insert day (active or inactive) so that
``nodes_removed`` from node_changes balances: otherwise inactive rows vanish from the +ledger
while removals still apply, and cumulative totals drift from the live active count.
"""

import os
import sqlite3
import sys
import tempfile
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))


class TestSyntheticSyncRowsInactive(unittest.TestCase):
    """Ensure synthetic nodes_added includes inactive rows for the same insert day."""

    def setUp(self):
        self._fd, self.db_path = tempfile.mkstemp(suffix=".db")
        os.close(self._fd)
        import backend.database as dbm

        self._old_path = dbm.DATABASE_PATH
        dbm.DATABASE_PATH = self.db_path

    def tearDown(self):
        import backend.database as dbm

        dbm.DATABASE_PATH = self._old_path
        if os.path.exists(self.db_path):
            os.remove(self.db_path)

    def test_synthetic_includes_inactive_same_insert_day(self):
        from backend.database import init_database
        from backend.api.app import get_synthetic_sync_rows

        init_database()
        conn = sqlite3.connect(self.db_path)
        cur = conn.cursor()
        # Two nodes same calendar insert day: one still active, one deactivated.
        cur.executemany(
            """
            INSERT INTO belgian_nodes (
                public_key, type, adv_name, adv_lat, adv_lon, city,
                last_advert, inserted_date, updated_date, params,
                link, source, is_active, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            [
                (
                    "activekey01",
                    1,
                    "Active",
                    50.85,
                    4.35,
                    "Brussels",
                    "2026-02-01T12:00:00",
                    "2026-02-01",
                    "2026-02-01T12:00:00",
                    "{}",
                    "",
                    "app",
                    1,
                    "2026-02-01 10:00:00",
                ),
                (
                    "inactivekey1",
                    1,
                    "Was active",
                    50.86,
                    4.36,
                    "Brussels",
                    "2026-02-01T12:00:00",
                    "2026-02-01",
                    "2026-02-01T12:00:00",
                    "{}",
                    "",
                    "app",
                    0,
                    "2026-02-01 10:00:00",
                ),
            ],
        )
        conn.commit()
        conn.close()

        rows = get_synthetic_sync_rows()
        by_date = {str(r["sync_date"])[:10]: r["nodes_added"] for r in rows}
        self.assertEqual(by_date.get("2026-02-01"), 2)


if __name__ == "__main__":
    unittest.main()
