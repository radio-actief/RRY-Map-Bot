"""End-to-end count invariants across the four chart surfaces.

After ``reset_history.py`` and an init sync, four numbers must agree::

    GET /api/v1/belgian-nodes/count
    GET /api/v1/stats.displayable_map_nodes
    sum(GET /api/v1/stats.by_type_map.values())
    last(cumulativeData) over GET /api/v1/sync-history

This test seeds a tiny in-memory database directly (no HTTP) and exercises the
underlying functions; the `tests/check_invariants.py` script exercises the same
properties against the live API container.
"""

import json
import os
import sqlite3
import sys
import tempfile
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))


class TestCountInvariants(unittest.TestCase):
    def setUp(self):
        self._fd, self.db_path = tempfile.mkstemp(suffix=".db")
        os.close(self._fd)
        self._old_env_db = os.environ.get("DATABASE_PATH")
        os.environ["DATABASE_PATH"] = self.db_path
        import backend.database as dbm

        self._old_path = dbm.DATABASE_PATH
        dbm.DATABASE_PATH = self.db_path
        dbm.init_database()

    def tearDown(self):
        import backend.database as dbm

        dbm.DATABASE_PATH = self._old_path
        if self._old_env_db is not None:
            os.environ["DATABASE_PATH"] = self._old_env_db
        else:
            os.environ.pop("DATABASE_PATH", None)
        if os.path.exists(self.db_path):
            os.remove(self.db_path)

    def _seed(self):
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
                # Three displayable nodes split across two days and two types.
                ("k_a", 1, "A", 50.85, 4.35, "Brussels",
                 "2025-07-11T10:00:00", "2025-07-11", "2025-07-11T10:00:00",
                 "{}", "", "app", 1, "2025-07-11 10:00:00"),
                ("k_b", 1, "B", 50.86, 4.36, "Brussels",
                 "2025-08-06T10:00:00", "2025-08-06", "2025-08-06T10:00:00",
                 "{}", "", "app", 1, "2025-08-06 10:00:00"),
                ("k_c", 2, "C", 50.87, 4.37, "Antwerp",
                 "2025-08-06T11:00:00", "2025-08-06", "2025-08-06T11:00:00",
                 "{}", "", "app", 1, "2025-08-06 11:00:00"),
                # Excluded: missing coordinates.
                ("k_dropped_coords", 1, "D", None, None, None,
                 "2025-08-06T12:00:00", "2025-08-06", "2025-08-06T12:00:00",
                 "{}", "", "app", 1, "2025-08-06 12:00:00"),
                # Excluded from map: inactive (still in chart seed; needs removal event).
                ("k_inactive", 1, "I", 50.88, 4.38, "Brussels",
                 "2025-08-06T12:00:00", "2025-08-06", "2025-08-06T12:00:00",
                 "{}", "", "app", 0, "2025-08-06 12:00:00"),
            ],
        )
        cur.execute(
            """
            INSERT INTO node_changes (public_key, change_type, sync_date, old_data)
            VALUES (?, ?, ?, ?)
            """,
            (
                "k_inactive",
                "removed",
                "2025-08-07T10:00:00",
                json.dumps({
                    "public_key": "k_inactive",
                    "adv_lat": 50.88,
                    "adv_lon": 4.38,
                    "adv_name": "I",
                    "type": 1,
                    "params": {},
                }),
            ),
        )
        conn.commit()
        conn.close()

    def test_invariants(self):
        from backend.api.app import (
            get_displayable_node_count,
            get_sync_history,
        )
        from backend.discord_queries import get_statistics

        self._seed()

        displayable = get_displayable_node_count()
        stats = get_statistics()
        by_type_map_total = sum(int(v) for v in stats.get("by_type_map", {}).values())

        history = get_sync_history()
        cumulative = 0
        last_cum = 0
        for r in sorted(history, key=lambda x: (x.get("sync_date") or "")):
            cumulative += (
                (r.get("nodes_added") or 0)
                + (r.get("nodes_restored") or 0)
                - (r.get("nodes_removed") or 0)
            )
            last_cum = cumulative

        self.assertEqual(displayable, 3)
        self.assertEqual(by_type_map_total, displayable)
        self.assertEqual(last_cum, displayable)


if __name__ == "__main__":
    unittest.main()
