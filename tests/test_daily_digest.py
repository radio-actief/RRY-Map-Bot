"""
Unit tests for :mod:`backend.daily_digest`.

Covers:
    * ``collect_changes_since`` net-dedup across a 24 h window (add/remove/add
      back, restore of a previously deleted node, pure-update ignored).
    * ``build_digest_embed`` renders the expected sections when the window is
      non-empty.

No Discord network access is performed; the embed is built as a regular
object and inspected in-process.
"""
from __future__ import annotations

import os
import sqlite3
import sys
import tempfile
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path

THIS_DIR = Path(__file__).resolve().parent
REPO_ROOT = THIS_DIR.parent
sys.path.insert(0, str(REPO_ROOT))

from backend.daily_digest import (  # noqa: E402
    build_digest_embed,
    collect_changes_since,
)


def _iso(dt: datetime) -> str:
    return dt.astimezone(timezone.utc).strftime("%Y-%m-%d %H:%M:%S")


def _make_test_db() -> sqlite3.Connection:
    """Build an in-memory SQLite DB with the minimum schema the digest needs."""
    conn = sqlite3.connect(":memory:")
    conn.row_factory = sqlite3.Row
    conn.executescript(
        """
        CREATE TABLE belgian_nodes (
            public_key VARCHAR(64) PRIMARY KEY,
            type INTEGER NOT NULL,
            adv_name VARCHAR(255),
            is_active INTEGER DEFAULT 1,
            discord_owner_id VARCHAR(20)
        );
        CREATE TABLE node_changes (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            public_key VARCHAR(64),
            change_type VARCHAR(20),
            sync_date TEXT,
            old_data TEXT,
            new_data TEXT
        );
        CREATE TABLE sync_history (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            sync_date TEXT DEFAULT CURRENT_TIMESTAMP,
            nodes_added INTEGER DEFAULT 0,
            nodes_removed INTEGER DEFAULT 0,
            nodes_restored INTEGER DEFAULT 0,
            nodes_updated INTEGER DEFAULT 0,
            details TEXT
        );
        CREATE TABLE digest_state (
            id INTEGER PRIMARY KEY CHECK (id = 1),
            last_sent_utc TEXT,
            last_channel_id TEXT,
            last_message_id TEXT
        );
        INSERT INTO digest_state (id, last_sent_utc) VALUES (1, NULL);
        """
    )
    return conn


def _insert_node(conn, pk: str, name: str, *, is_active: int = 1, type_: int = 2) -> None:
    conn.execute(
        """
        INSERT OR REPLACE INTO belgian_nodes
            (public_key, type, adv_name, is_active)
        VALUES (?, ?, ?, ?)
        """,
        (pk, type_, name, is_active),
    )


def _insert_change(conn, pk: str, change: str, when: datetime) -> None:
    conn.execute(
        "INSERT INTO node_changes (public_key, change_type, sync_date) VALUES (?, ?, ?)",
        (pk, change, _iso(when)),
    )


class TestCollectChangesSince(unittest.TestCase):
    def setUp(self) -> None:
        self.conn = _make_test_db()
        self.now = datetime.now(timezone.utc)
        self.window_start = self.now - timedelta(hours=24)

    def tearDown(self) -> None:
        self.conn.close()

    def test_net_added_deduped(self) -> None:
        pk = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
        _insert_node(self.conn, pk, "New-Node", is_active=1)
        for offset_min in (1, 10, 30, 60):
            _insert_change(self.conn, pk, "added", self.window_start + timedelta(minutes=offset_min))
        self.conn.commit()

        agg = collect_changes_since(self.conn, self.window_start)
        self.assertIn(pk, agg["added"])
        self.assertNotIn(pk, agg["removed"])
        self.assertNotIn(pk, agg["restored"])
        self.assertEqual(len(agg["added"]), 1, "added bucket must be deduped per key")

    def test_flap_add_remove_add_counts_once(self) -> None:
        pk = "b" * 64
        _insert_node(self.conn, pk, "Flapper", is_active=1)
        _insert_change(self.conn, pk, "added", self.window_start + timedelta(minutes=5))
        _insert_change(self.conn, pk, "removed", self.window_start + timedelta(minutes=45))
        _insert_change(self.conn, pk, "added", self.window_start + timedelta(minutes=120))
        self.conn.commit()

        agg = collect_changes_since(self.conn, self.window_start)
        self.assertIn(pk, agg["added"])
        self.assertNotIn(pk, agg["removed"])
        self.assertEqual(agg["added"].count(pk), 1)

    def test_removed_when_currently_inactive(self) -> None:
        pk = "c" * 64
        _insert_node(self.conn, pk, "Gone", is_active=0)
        _insert_change(
            self.conn, pk, "added",
            self.window_start - timedelta(days=5),
        )
        _insert_change(self.conn, pk, "removed", self.window_start + timedelta(minutes=30))
        self.conn.commit()

        agg = collect_changes_since(self.conn, self.window_start)
        self.assertIn(pk, agg["removed"])
        self.assertNotIn(pk, agg["added"])

    def test_restored_node_detected(self) -> None:
        pk = "d" * 64
        _insert_node(self.conn, pk, "Back-Again", is_active=1)
        _insert_change(
            self.conn, pk, "added",
            self.window_start - timedelta(days=10),
        )
        _insert_change(
            self.conn, pk, "removed",
            self.window_start - timedelta(days=2),
        )
        _insert_change(
            self.conn, pk, "restored",
            self.window_start + timedelta(minutes=15),
        )
        self.conn.commit()

        agg = collect_changes_since(self.conn, self.window_start)
        self.assertIn(pk, agg["restored"])
        self.assertNotIn(pk, agg["added"])
        self.assertNotIn(pk, agg["removed"])

    def test_pure_update_excluded_from_embed_buckets(self) -> None:
        pk = "e" * 64
        _insert_node(self.conn, pk, "Just-Updated", is_active=1)
        _insert_change(
            self.conn, pk, "added",
            self.window_start - timedelta(days=3),
        )
        _insert_change(self.conn, pk, "updated", self.window_start + timedelta(minutes=10))
        self.conn.commit()

        agg = collect_changes_since(self.conn, self.window_start)
        self.assertNotIn(pk, agg["added"])
        self.assertNotIn(pk, agg["removed"])
        self.assertNotIn(pk, agg["restored"])
        self.assertEqual(agg["updated_count"], 1)


class TestBuildDigestEmbed(unittest.TestCase):
    def test_embed_sections_rendered(self) -> None:
        try:
            import discord  # noqa: F401
        except ImportError:  # pragma: no cover
            self.skipTest("discord.py not installed in this environment")

        now = datetime.now(timezone.utc)
        window_start = now - timedelta(hours=24)
        agg = {
            "added": ["a" * 64, "b" * 64],
            "removed": ["c" * 64],
            "restored": [],
            "updated_count": 3,
            "since_utc": window_start,
        }
        stats = {
            "total_nodes": 120,
            "claimed_nodes": 40,
            "unclaimed_nodes": 80,
            "registered_users": 25,
            "total_cities": 60,
            "by_type": {1: 10, 2: 100, 3: 5, 4: 5},
        }
        added_nodes = [
            {"public_key": "a" * 64, "type": 2, "adv_name": "New-A", "discord_owner_id": None},
            {"public_key": "b" * 64, "type": 1, "adv_name": "New-B", "discord_owner_id": "12345"},
        ]
        removed_nodes = [
            {"public_key": "c" * 64, "type": 2, "adv_name": "Gone-C", "discord_owner_id": None},
        ]

        embed = build_digest_embed(
            agg, window_start, now, stats, sync_count=48,
            added_nodes=added_nodes,
            restored_nodes=[],
            removed_nodes=removed_nodes,
        )

        field_names = [f.name for f in embed.fields]
        self.assertTrue(any("Period" in n for n in field_names), field_names)
        self.assertTrue(any("Changes" in n for n in field_names), field_names)
        self.assertTrue(any("Overall Statistics" in n for n in field_names), field_names)
        self.assertTrue(any("Nodes by Type" in n for n in field_names), field_names)
        self.assertTrue(any("New Nodes" in n for n in field_names), field_names)
        self.assertTrue(any("Deleted Nodes" in n for n in field_names), field_names)
        self.assertFalse(any("Restored Nodes" in n for n in field_names), field_names)
        self.assertIn("Daily Map Digest", embed.title)
        self.assertIn("Next digest:", (embed.footer.text or ""))


if __name__ == "__main__":
    unittest.main(verbosity=2)
