"""Tests for the node_claims event log."""

import os
import sqlite3
import sys
import tempfile
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))


class TestNodeClaimsLog(unittest.TestCase):
    def setUp(self):
        self._fd, self.db_path = tempfile.mkstemp(suffix=".db")
        os.close(self._fd)
        self._old_env_db = os.environ.get("DATABASE_PATH")
        os.environ["DATABASE_PATH"] = self.db_path
        import backend.database as dbm

        self._old_path = dbm.DATABASE_PATH
        dbm.DATABASE_PATH = self.db_path
        dbm.init_database()

        conn = sqlite3.connect(self.db_path)
        cur = conn.cursor()
        cur.execute(
            """
            INSERT INTO belgian_nodes (
                public_key, type, adv_name, adv_lat, adv_lon, city,
                last_advert, inserted_date, updated_date, params,
                link, source, is_active, created_at
            ) VALUES (
                'pkclaim01', 1, 'Node A', 50.85, 4.35, 'Brussels',
                '2026-04-01T12:00:00', '2026-04-01', '2026-04-01T12:00:00',
                '{}', '', 'app', 1, '2026-04-01 10:00:00'
            )
            """
        )
        conn.commit()
        conn.close()

    def tearDown(self):
        import backend.database as dbm

        dbm.DATABASE_PATH = self._old_path
        if self._old_env_db is not None:
            os.environ["DATABASE_PATH"] = self._old_env_db
        else:
            os.environ.pop("DATABASE_PATH", None)
        if os.path.exists(self.db_path):
            os.remove(self.db_path)

    def _claims(self):
        conn = sqlite3.connect(self.db_path)
        conn.row_factory = sqlite3.Row
        cur = conn.cursor()
        try:
            cur.execute(
                "SELECT public_key, discord_owner_id, action FROM node_claims "
                "ORDER BY id"
            )
            return [tuple(row) for row in cur.fetchall()]
        finally:
            conn.close()

    def test_claim_unclaim_reclaim_logs_three_rows(self):
        from backend.discord_queries import update_ownership, remove_ownership

        self.assertTrue(update_ownership("pkclaim01", "111", "alice"))
        self.assertTrue(remove_ownership("pkclaim01", "111"))
        self.assertTrue(update_ownership("pkclaim01", "222", "bob"))

        events = self._claims()
        self.assertEqual(
            events,
            [
                ("pkclaim01", "111", "claim"),
                ("pkclaim01", "111", "unclaim"),
                ("pkclaim01", "222", "claim"),
            ],
        )

    def test_unclaim_by_other_user_is_rejected_and_does_not_log(self):
        from backend.discord_queries import update_ownership, remove_ownership

        self.assertTrue(update_ownership("pkclaim01", "111", "alice"))
        self.assertFalse(remove_ownership("pkclaim01", "999"))

        events = self._claims()
        self.assertEqual(events, [("pkclaim01", "111", "claim")])


if __name__ == "__main__":
    unittest.main()
