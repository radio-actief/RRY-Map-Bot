"""Tests for the one-shot history reset migration."""

import os
import sqlite3
import sys
import tempfile
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))


class TestResetHistory(unittest.TestCase):
    def setUp(self):
        self._fd, self.db_path = tempfile.mkstemp(suffix=".db")
        os.close(self._fd)
        self._old_env_db = os.environ.get("DATABASE_PATH")
        os.environ["DATABASE_PATH"] = self.db_path
        import backend.database as dbm

        self._old_path = dbm.DATABASE_PATH
        dbm.DATABASE_PATH = self.db_path
        dbm.init_database()
        # Re-add the legacy column so the migration has something to drop.
        conn = sqlite3.connect(self.db_path)
        cur = conn.cursor()
        cur.execute(
            "ALTER TABLE belgian_nodes ADD COLUMN discord_updated_date TEXT"
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

    def _seed(self):
        conn = sqlite3.connect(self.db_path)
        cur = conn.cursor()
        cur.executemany(
            """
            INSERT INTO belgian_nodes (
                public_key, type, adv_name, adv_lat, adv_lon, city,
                last_advert, inserted_date, updated_date, params,
                link, source, is_active, removed_from_official, removed_date,
                discord_owner_id, discord_owner_name, discord_updated_date,
                created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            [
                # Active, claimed.
                ("active_owner",
                 1, "Active+Owner", 50.85, 4.35, "Brussels",
                 "2026-02-01T12:00:00", "2026-02-01", "2026-02-01T12:00:00",
                 "{}", "", "app", 1, 0, None,
                 "111", "alice", "2026-02-01T12:00:00",
                 "2026-02-01 10:00:00"),
                # Active, unclaimed.
                ("active_no_owner",
                 1, "Active", 50.86, 4.36, "Brussels",
                 "2026-02-02T12:00:00", "", "2026-02-02T12:00:00",
                 "{}", "", "app", 1, 0, None,
                 None, None, None,
                 "2026-02-02 10:00:00"),
                # Inactive: must be deleted.
                ("inactive_node",
                 1, "Gone", 50.87, 4.37, "Brussels",
                 "2025-12-01T12:00:00", "2025-12-01", "2025-12-01T12:00:00",
                 "{}", "", "app", 0, 1, "2026-01-15 00:00:00",
                 None, None, None,
                 "2025-12-01 10:00:00"),
            ],
        )
        cur.execute(
            "INSERT INTO node_changes (public_key, change_type, sync_date) "
            "VALUES ('active_owner', 'updated', '2026-03-01T00:00:00')"
        )
        cur.execute(
            "INSERT INTO sync_history (sync_date, nodes_added, nodes_removed, "
            "nodes_restored, nodes_updated) "
            "VALUES ('2026-03-01T00:00:00', 1, 0, 0, 1)"
        )
        cur.execute(
            "UPDATE digest_state SET last_sent_utc = '2026-03-01T00:00:00' "
            "WHERE id = 1"
        )
        conn.commit()
        conn.close()

    def test_migration_clears_history_and_seeds_claims(self):
        from backend.migrations.reset_history import reset_history
        from pathlib import Path

        self._seed()
        result = reset_history(Path(self.db_path))

        conn = sqlite3.connect(self.db_path)
        conn.row_factory = sqlite3.Row
        cur = conn.cursor()
        try:
            cur.execute("SELECT COUNT(*) AS n FROM belgian_nodes")
            self.assertEqual(cur.fetchone()["n"], 2, "inactive row should be deleted")

            cur.execute("PRAGMA table_info(belgian_nodes)")
            cols = {row["name"] for row in cur.fetchall()}
            self.assertNotIn("discord_updated_date", cols)
            self.assertIn("discord_owner_id", cols)

            cur.execute(
                "SELECT public_key, inserted_date FROM belgian_nodes "
                "ORDER BY public_key"
            )
            rows = cur.fetchall()
            for r in rows:
                self.assertIsNotNone(r["inserted_date"])
                self.assertNotEqual(str(r["inserted_date"]).strip(), "")

            cur.execute("SELECT COUNT(*) AS n FROM node_changes")
            self.assertEqual(cur.fetchone()["n"], 0)
            cur.execute("SELECT COUNT(*) AS n FROM sync_history")
            self.assertEqual(cur.fetchone()["n"], 0)

            cur.execute(
                "SELECT last_sent_utc FROM digest_state WHERE id = 1"
            )
            self.assertIsNone(cur.fetchone()["last_sent_utc"])

            cur.execute(
                "SELECT public_key, action FROM node_claims ORDER BY id"
            )
            claims = [(row["public_key"], row["action"]) for row in cur.fetchall()]
            self.assertEqual(claims, [("active_owner", "claim")])

            self.assertTrue(result["rebuilt_belgian_nodes"])
            self.assertEqual(result["seeded_claims"], 1)
        finally:
            conn.close()

    def test_migration_is_idempotent(self):
        from backend.migrations.reset_history import reset_history
        from pathlib import Path

        self._seed()
        reset_history(Path(self.db_path))
        # Second run should be a no-op without raising.
        result = reset_history(Path(self.db_path))
        self.assertFalse(result["rebuilt_belgian_nodes"])
        conn = sqlite3.connect(self.db_path)
        conn.row_factory = sqlite3.Row
        cur = conn.cursor()
        try:
            cur.execute("SELECT COUNT(*) AS n FROM node_claims")
            self.assertEqual(cur.fetchone()["n"], 1)
        finally:
            conn.close()


if __name__ == "__main__":
    unittest.main()
