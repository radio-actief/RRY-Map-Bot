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
    _count_syncs_since,
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


def _insert_change_raw(conn, pk: str, change: str, raw_sync_date: str) -> None:
    conn.execute(
        "INSERT INTO node_changes (public_key, change_type, sync_date) VALUES (?, ?, ?)",
        (pk, change, raw_sync_date),
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

    def test_same_window_add_remove_inactive_omitted(self) -> None:
        """Added then removed same window, still inactive: net 0, not Deleted."""
        pk = "9" * 64
        _insert_node(self.conn, pk, "Brief-Node", is_active=0)
        _insert_change(self.conn, pk, "added", self.window_start + timedelta(minutes=10))
        _insert_change(self.conn, pk, "removed", self.window_start + timedelta(minutes=40))
        self.conn.commit()

        agg = collect_changes_since(self.conn, self.window_start)
        self.assertNotIn(pk, agg["added"])
        self.assertNotIn(pk, agg["removed"])
        self.assertNotIn(pk, agg["restored"])

    def test_same_window_remove_restore_omitted(self) -> None:
        """Removed then restored same window: net 0, not Restored."""
        pk = "8" * 64
        _insert_node(self.conn, pk, "Flap-Back", is_active=1)
        _insert_change(
            self.conn, pk, "added",
            self.window_start - timedelta(days=30),
        )
        _insert_change(
            self.conn, pk, "removed",
            self.window_start - timedelta(days=10),
        )
        _insert_change(self.conn, pk, "removed", self.window_start + timedelta(minutes=20))
        _insert_change(self.conn, pk, "restored", self.window_start + timedelta(minutes=90))
        self.conn.commit()

        agg = collect_changes_since(self.conn, self.window_start)
        self.assertNotIn(pk, agg["added"])
        self.assertNotIn(pk, agg["removed"])
        self.assertNotIn(pk, agg["restored"])

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

    def test_prior_removed_but_only_updated_not_restored(self) -> None:
        """Stable nodes that were removed long ago must not show as Restored on routine updates."""
        pk = "f" * 64
        _insert_node(self.conn, pk, "Old-Repeater", is_active=1)
        _insert_change(
            self.conn, pk, "added",
            self.window_start - timedelta(days=100),
        )
        _insert_change(
            self.conn, pk, "removed",
            self.window_start - timedelta(days=50),
        )
        _insert_change(
            self.conn, pk, "restored",
            self.window_start - timedelta(days=49),
        )
        _insert_change(self.conn, pk, "updated", self.window_start + timedelta(minutes=5))
        self.conn.commit()

        agg = collect_changes_since(self.conn, self.window_start)
        self.assertNotIn(pk, agg["restored"])
        self.assertNotIn(pk, agg["added"])
        self.assertNotIn(pk, agg["removed"])
        self.assertEqual(agg["updated_count"], 1)

    def test_inactive_only_updated_not_deleted_each_digest(self) -> None:
        """Inactive nodes must not appear under Deleted when the window only has ``updated``."""
        pk = "0" * 64
        _insert_node(self.conn, pk, "Stale-Offline", is_active=0)
        _insert_change(
            self.conn, pk, "added",
            self.window_start - timedelta(days=20),
        )
        _insert_change(
            self.conn, pk, "removed",
            self.window_start - timedelta(days=10),
        )
        _insert_change(self.conn, pk, "updated", self.window_start + timedelta(minutes=3))
        self.conn.commit()

        agg = collect_changes_since(self.conn, self.window_start)
        self.assertNotIn(pk, agg["removed"])
        self.assertNotIn(pk, agg["added"])
        self.assertNotIn(pk, agg["restored"])

    def test_active_no_prior_only_updated_not_new(self) -> None:
        """A key whose first node_changes row in the window is only ``updated`` is not New."""
        pk = "1" * 64
        _insert_node(self.conn, pk, "Weird-Import", is_active=1)
        _insert_change(self.conn, pk, "updated", self.window_start + timedelta(minutes=2))
        self.conn.commit()

        agg = collect_changes_since(self.conn, self.window_start)
        self.assertNotIn(pk, agg["added"])
        self.assertNotIn(pk, agg["removed"])
        self.assertNotIn(pk, agg["restored"])
        self.assertEqual(agg["updated_count"], 1)

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

    def test_iso_timestamp_boundary_respected(self) -> None:
        """ISO timestamps earlier on the same day must not leak into the window."""
        window_start = datetime(2026, 5, 8, 9, 0, 0, tzinfo=timezone.utc)

        pk_before = "2" * 64
        pk_after = "3" * 64
        _insert_node(self.conn, pk_before, "Before-Window", is_active=1)
        _insert_node(self.conn, pk_after, "After-Window", is_active=1)
        _insert_change_raw(self.conn, pk_before, "added", "2026-05-08T08:59:59+00:00")
        _insert_change_raw(self.conn, pk_after, "added", "2026-05-08T09:00:01+00:00")
        self.conn.commit()

        agg = collect_changes_since(self.conn, window_start)
        self.assertNotIn(pk_before, agg["added"])
        self.assertIn(pk_after, agg["added"])
        self.assertEqual(len(agg["added"]), 1)


class TestCountSyncsSince(unittest.TestCase):
    def setUp(self) -> None:
        self.conn = _make_test_db()

    def tearDown(self) -> None:
        self.conn.close()

    def test_handles_iso_and_legacy_timestamps(self) -> None:
        window_start = datetime(2026, 5, 8, 9, 0, 0, tzinfo=timezone.utc)
        self.conn.execute(
            "INSERT INTO sync_history (sync_date, nodes_added, nodes_removed, nodes_restored, nodes_updated) VALUES (?, 0, 0, 0, 0)",
            ("2026-05-08 08:00:00",),
        )
        self.conn.execute(
            "INSERT INTO sync_history (sync_date, nodes_added, nodes_removed, nodes_restored, nodes_updated) VALUES (?, 0, 0, 0, 0)",
            ("2026-05-08T08:30:00+00:00",),
        )
        self.conn.execute(
            "INSERT INTO sync_history (sync_date, nodes_added, nodes_removed, nodes_restored, nodes_updated) VALUES (?, 0, 0, 0, 0)",
            ("2026-05-08T10:30:00+00:00",),
        )
        self.conn.commit()

        self.assertEqual(_count_syncs_since(self.conn, window_start), 1)


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



# ---------------------------------------------------------------------------
# Node lines: escaping, town, map link, owner, sort, whole-line field filling
# ---------------------------------------------------------------------------

from backend.daily_digest import fill_field_lines, render_node_list  # noqa: E402
from backend.discord_formatting import (  # noqa: E402
    escape_node_name,
    format_digest_node_line,
    get_map_link,
)

STATS_URL = "https://meshmap.radio-actief.be/stats"


def _node(i: int, **kw):
    node = {
        "public_key": f"{i:064x}",
        "type": 2,
        "adv_name": f"BE-TST-RRY{i:03d}-Repeater",
        "city": "Leuven",
        "discord_owner_id": "301234567890123456" if i % 3 == 0 else None,
    }
    node.update(kw)
    return node


def test_node_name_escapes_markdown_and_mentions() -> None:
    out = escape_node_name("a*b_c~d|e`f [x] @everyone @here")
    for raw in ("*", "_", "~", "|", "`", "[", "]"):
        assert f"\\{raw}" in out, (raw, out)
    assert "@everyone" not in out
    assert "@here" not in out
    # A backslash in the name can't un-escape the bracket after it.
    assert escape_node_name("a\\[x") == "a\\\\\\[x"


def test_digest_line_has_icon_linked_name_town_province_owner() -> None:
    node = _node(1, adv_name="BE-LEU-RRY184", discord_owner_id="301234567890123456")
    line = format_digest_node_line(node)
    assert line.startswith("📡 ")
    assert f"[BE-LEU-RRY184]({get_map_link(node)})" in line
    assert "Leuven (VBR)" in line
    assert line.endswith("<@301234567890123456>")
    assert "\n" not in line


def test_digest_line_unclaimed_has_no_owner_and_unknown_town_is_left_out() -> None:
    line = format_digest_node_line(_node(2, city="Unknown", discord_owner_id=None))
    assert "Unclaimed" not in line
    assert "Unknown" not in line
    assert "<@" not in line


def test_digest_line_without_link_for_nodes_no_longer_on_the_map() -> None:
    line = format_digest_node_line(_node(3, adv_name="Gone"), link=False)
    assert "](" not in line
    assert "Gone" in line


def test_digest_line_escapes_hostile_names() -> None:
    line = format_digest_node_line(_node(4, adv_name="*bold*_x_~s~|p| @everyone"))
    assert "@everyone" not in line
    assert "\\*bold\\*" in line
    assert "\\|p\\|" in line


def test_fill_field_lines_keeps_whole_lines_and_counts_the_rest() -> None:
    nodes = [_node(i) for i in range(23)]
    lines = [format_digest_node_line(n) for n in nodes]
    value = fill_field_lines(lines, total=23)
    assert len(value) <= 1024
    shown = value.split("\n")
    more = shown[-1]
    body = shown[:-1]
    assert all(line in lines for line in body), "every shown line is complete"
    assert len(body) < 23
    assert more == f"+{23 - len(body)} more on the [stats page]({STATS_URL})"
    assert len("\n".join(body)) <= 950


def test_fill_field_lines_without_overflow_has_no_more_line() -> None:
    lines = [format_digest_node_line(_node(i)) for i in range(3)]
    assert fill_field_lines(lines, total=3) == "\n".join(lines)


def test_fill_field_lines_counts_nodes_that_were_not_loaded() -> None:
    lines = [format_digest_node_line(_node(i)) for i in range(2)]
    value = fill_field_lines(lines, total=60)
    assert value.endswith(f"+58 more on the [stats page]({STATS_URL})")


def test_render_node_list_sorts_by_type_then_name() -> None:
    nodes = [
        _node(1, type=2, adv_name="zulu"),
        _node(2, type=1, adv_name="Mike"),
        _node(3, type=2, adv_name="alpha"),
        _node(4, type=3, adv_name="Bravo"),
    ]
    value = render_node_list(nodes, total=4)
    order = [ln.split("[", 1)[1].split("]", 1)[0] for ln in value.split("\n")]
    assert order == ["Mike", "alpha", "zulu", "Bravo"]


def test_embed_with_23_deleted_nodes_stays_within_field_limit() -> None:
    now = datetime(2026, 10, 27, 8, 0, tzinfo=timezone.utc)
    nodes = [_node(i) for i in range(23)]
    agg = {"added": [], "removed": [n["public_key"] for n in nodes], "restored": [], "updated_count": 0}
    embed = build_digest_embed(
        agg, now - timedelta(hours=24), now, {"total_nodes": 881, "by_type": {2: 881}}, 48,
        removed_nodes=nodes,
    )
    field = next(f for f in embed.fields if f.name.startswith("❌ Deleted Nodes"))
    assert field.name == "❌ Deleted Nodes (23)"
    assert len(field.value) <= 1024
    assert "more on the [stats page]" in field.value
    assert "](" not in field.value.split("\n")[0], "deleted nodes are not linked to the map"


if __name__ == "__main__":
    unittest.main(verbosity=2)
