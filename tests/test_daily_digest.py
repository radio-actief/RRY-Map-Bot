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

import json
import os
import sqlite3
import sys
import tempfile
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest

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
            agg, window_start, now, stats,
            added_nodes=added_nodes,
            restored_nodes=[],
            removed_nodes=removed_nodes,
        )

        field_names = [f.name for f in embed.fields]
        self.assertFalse(any("Changes" in n for n in field_names), field_names)
        self.assertTrue(any("Map totals" in n for n in field_names), field_names)
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


def test_digest_line_has_icon_linked_name_town_owner_and_no_province_code() -> None:
    node = _node(1, adv_name="BE-LEU-RRY184", discord_owner_id="301234567890123456")
    line = format_digest_node_line(node)
    assert line.startswith("📡 ")
    assert f"[BE-LEU-RRY184]({get_map_link(node, short=True)})" in line
    assert "· Leuven ·" in line
    assert "(VBR)" not in line
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
    assert order == ["alpha", "zulu", "Bravo", "Mike"]


def test_23_deleted_nodes_show_ten_lines_and_a_more_note() -> None:
    now = datetime(2026, 10, 27, 8, 0, tzinfo=timezone.utc)
    nodes = [_node(i) for i in range(23)]
    agg = {"added": [], "removed": [n["public_key"] for n in nodes], "restored": [], "updated_count": 0}
    embed = build_digest_embed(
        agg, now - timedelta(hours=24), now, {"total_nodes": 881, "by_type": {2: 881}},
        removed_nodes=nodes,
    )
    fields = [f for f in embed.fields if "Deleted Nodes" in f.name]
    assert [f.name for f in fields] == ["❌ Deleted Nodes (23)"]
    lines = fields[0].value.split("\n")
    assert len(lines) == 11 and lines[-1] == f"+13 more on the [stats page]({STATS_URL})"
    assert len(fields[0].value) <= 1024
    assert "](" not in lines[0], "deleted nodes are not linked to the map"


def test_twelve_new_nodes_are_one_field_with_ten_lines_and_two_more() -> None:
    now = datetime(2026, 10, 27, 8, 0, tzinfo=timezone.utc)
    nodes = [_node(i, adv_name=f"BE-TST-{i:02d}", discord_owner_id=None) for i in range(12)]
    agg = {"added": [n["public_key"] for n in nodes], "removed": [], "restored": [], "updated_count": 0}
    embed = build_digest_embed(
        agg, now - timedelta(hours=24), now, {"total_nodes": 881, "by_type": {2: 881}},
        added_nodes=nodes,
    )
    fields = [f for f in embed.fields if "New Nodes" in f.name]
    assert [f.name for f in fields] == ["✅ New Nodes (12)"]
    lines = fields[0].value.split("\n")
    assert len(lines) == 11
    assert sum(l.count("](") for l in lines[:10]) == 10
    assert lines[-1] == f"+2 more on the [stats page]({STATS_URL})"
    assert "(cont.)" not in _text(embed)


def test_digest_links_use_the_first_12_hex_of_the_key() -> None:
    line = format_digest_node_line(_node(255))
    assert "?node=" + f"{255:064x}"[:12] + ")" in line
    assert f"{255:064x}" not in line
    spaced = format_digest_node_line(_node(1, public_key=" AB-CD EF0123456789" + "0" * 40))
    assert "?node=abcdef012345)" in spaced


def test_879_new_nodes_become_counts_by_type_and_top_provinces() -> None:
    now = datetime(2026, 10, 27, 8, 0, tzinfo=timezone.utc)
    towns = ["Antwerpen"] * 3 + ["Gent"] * 2 + ["Leuven", "Brugge", "Hasselt", "Namur", "Liège", "Arlon", "Mons"]
    nodes = [
        _node(i, type=(2 if i < 672 else 1 if i < 840 else 3 if i < 878 else 4), city=towns[i % len(towns)])
        for i in range(879)
    ]
    agg = {"added": [n["public_key"] for n in nodes], "removed": [], "restored": [], "updated_count": 0}
    embed = build_digest_embed(
        agg, now - timedelta(hours=24), now, {"total_nodes": 879, "by_type": {2: 879}},
        added_nodes=nodes, previous_total=None,
    )
    fields = [f for f in embed.fields if "New Nodes" in f.name]
    assert [f.name for f in fields] == ["✅ New Nodes (879)"]
    value = fields[0].value
    assert value.startswith("📡 Repeaters 672 · 💾 Room Servers 38 · 📱 Companions 168 · 🌡️ Sensors 1\n")
    assert "Most in: " in value and value.count(" · ") >= 3 + 4
    most = value.split("Most in: ")[1].split("\n")[0]
    assert len(most.split(" · ")) == 5
    assert value.endswith(f"Full list on the [stats page]({STATS_URL})")
    assert "](" not in value.replace(f"]({STATS_URL})", "")
    assert "(cont.)" not in _text(embed)
    assert "since yesterday" not in _text(embed)
    assert len(embed) < 2500


def test_25_nodes_are_still_listed_and_26_are_counted() -> None:
    now = datetime(2026, 10, 27, 8, 0, tzinfo=timezone.utc)
    for count, bulk in ((25, False), (26, True)):
        nodes = [_node(i) for i in range(count)]
        agg = {"added": [n["public_key"] for n in nodes], "removed": [], "restored": [], "updated_count": 0}
        embed = build_digest_embed(agg, now - timedelta(hours=24), now, {"total_nodes": 1},
                                   added_nodes=nodes)
        value = [f for f in embed.fields if "New Nodes" in f.name][0].value
        assert ("Full list on the" in value) is bulk


def test_very_long_lists_stay_within_the_embed_limit() -> None:
    now = datetime(2026, 10, 27, 8, 0, tzinfo=timezone.utc)
    added = [_node(i, adv_name="N" * 90) for i in range(900)]
    removed = [_node(1000 + i, adv_name="M" * 90) for i in range(20)]
    restored = [_node(2000 + i, adv_name="R" * 90) for i in range(15)]
    agg = {"added": [n["public_key"] for n in added], "removed": [n["public_key"] for n in removed],
           "restored": [n["public_key"] for n in restored], "updated_count": 0}
    embed = build_digest_embed(
        agg, now - timedelta(hours=24), now, {"total_nodes": 881, "by_type": {2: 881}},
        added_nodes=added, removed_nodes=removed, restored_nodes=restored,
    )
    assert len(embed) <= 6000
    assert all(len(f.value) <= 1024 for f in embed.fields)


# ---------------------------------------------------------------------------
# Net state per node: compare the state before the window with the state at
# its end, so a node that goes and comes back (or the reverse) still shows.
# ---------------------------------------------------------------------------


def _events(conn, pk, start, *types):
    for i, t in enumerate(types):
        _insert_change(conn, pk, t, start + timedelta(minutes=10 * (i + 1)))
    conn.commit()


def test_active_node_removed_restored_removed_shows_as_deleted() -> None:
    conn = _make_test_db()
    start = datetime(2026, 10, 26, 8, 0, tzinfo=timezone.utc)
    pk = "4" * 64
    _insert_node(conn, pk, "Flip", is_active=0)
    _insert_change(conn, pk, "added", start - timedelta(days=30))
    _events(conn, pk, start, "removed", "restored", "removed")
    agg = collect_changes_since(conn, start)
    assert agg["removed"] == [pk]
    assert agg["added"] == [] and agg["restored"] == []


def test_new_node_added_removed_restored_shows_as_new() -> None:
    conn = _make_test_db()
    start = datetime(2026, 10, 26, 8, 0, tzinfo=timezone.utc)
    pk = "5" * 64
    _insert_node(conn, pk, "Newbie", is_active=1)
    _events(conn, pk, start, "added", "removed", "restored")
    agg = collect_changes_since(conn, start)
    assert agg["added"] == [pk]
    assert agg["removed"] == [] and agg["restored"] == []


def test_gone_node_restored_removed_restored_shows_as_restored() -> None:
    conn = _make_test_db()
    start = datetime(2026, 10, 26, 8, 0, tzinfo=timezone.utc)
    pk = "6" * 64
    _insert_node(conn, pk, "Back", is_active=1)
    _insert_change(conn, pk, "added", start - timedelta(days=30))
    _insert_change(conn, pk, "removed", start - timedelta(days=3))
    _events(conn, pk, start, "restored", "removed", "restored")
    agg = collect_changes_since(conn, start)
    assert agg["restored"] == [pk]
    assert agg["added"] == [] and agg["removed"] == []


def test_gone_node_restored_then_removed_again_is_left_out() -> None:
    conn = _make_test_db()
    start = datetime(2026, 10, 26, 8, 0, tzinfo=timezone.utc)
    pk = "7" * 64
    _insert_node(conn, pk, "Blip", is_active=0)
    _insert_change(conn, pk, "added", start - timedelta(days=30))
    _insert_change(conn, pk, "removed", start - timedelta(days=3))
    _events(conn, pk, start, "restored", "removed")
    agg = collect_changes_since(conn, start)
    assert agg["added"] == [] and agg["removed"] == [] and agg["restored"] == []



# ---------------------------------------------------------------------------
# Window bounded by finished syncs, real window line, missed-day catch-up
# ---------------------------------------------------------------------------

import asyncio  # noqa: E402

import backend.daily_digest as dd  # noqa: E402
from backend.database import get_connection  # noqa: E402


class _FakeMessage:
    def __init__(self, mid):
        self.id = mid


class _FakeChannel:
    def __init__(self):
        self.sent = []

    async def send(self, embed=None, **kw):
        self.sent.append(embed)
        return _FakeMessage(1000 + len(self.sent))


class _FakeBot:
    def __init__(self):
        self.channel = _FakeChannel()

    def get_channel(self, cid):
        return self.channel


@pytest.fixture
def digest_env(temp_db, monkeypatch):
    import backend.discord_queries as dq

    monkeypatch.setattr(dd, "DAILY_DIGEST_CHANNEL_ID", "123")
    monkeypatch.setattr(dq, "get_statistics", lambda: {"total_nodes": 881, "active_7d": 362, "by_type": {2: 881}})
    conn = get_connection()
    yield conn, _FakeBot()
    conn.close()


def _z(dt):
    return dt.strftime("%Y-%m-%dT%H:%M:%SZ")


def _db_node(conn, pk, name, active=1):
    conn.execute(
        "INSERT OR REPLACE INTO belgian_nodes (public_key, type, adv_name, city, is_active) VALUES (?, 2, ?, 'Leuven', ?)",
        (pk, name, active),
    )


def _db_change(conn, pk, change, when):
    conn.execute(
        "INSERT INTO node_changes (public_key, change_type, sync_date) VALUES (?, ?, ?)",
        (pk, change, _z(when)),
    )


def _db_sync(conn, when, details=None):
    conn.execute(
        "INSERT INTO sync_history (sync_date, details) VALUES (?, ?)",
        (_z(when), json.dumps(details or {})),
    )


def _post(bot, now, **kw):
    return asyncio.run(dd.post_daily_digest(bot, now_utc=now, **kw))


def _all_keys(embed):
    return " ".join(f.value for f in embed.fields)


def test_sync_committing_during_the_digest_is_counted_next_time(digest_env) -> None:
    conn, bot = digest_env
    d1 = datetime(2026, 11, 9, 8, 0, tzinfo=timezone.utc)
    conn.execute("UPDATE digest_state SET last_sent_utc = ?, window_end_utc = ?", (_z(d1), _z(d1)))
    # Finished sync at 08:30 the next day.
    _db_node(conn, "a1" * 32, "Early")
    _db_change(conn, "a1" * 32, "added", d1 + timedelta(hours=24, minutes=29))
    _db_sync(conn, d1 + timedelta(hours=24, minutes=30))
    conn.commit()

    # Digest at 09:00 while the 08:59 sync is still writing (its rows not yet visible).
    d2 = d1 + timedelta(hours=25)
    assert _post(bot, d2)
    first = bot.channel.sent[-1]
    assert "Early" in _all_keys(first)

    # That sync now commits: its rows are stamped before the digest ran.
    _db_node(conn, "b2" * 32, "Late")
    _db_change(conn, "b2" * 32, "added", d2 - timedelta(seconds=30))
    _db_sync(conn, d2 + timedelta(seconds=5))
    conn.commit()

    assert _post(bot, d2 + timedelta(hours=24))
    second = bot.channel.sent[-1]
    assert "Late" in _all_keys(second)
    assert "Early" not in _all_keys(second), "nothing is counted twice"


def test_changes_visible_before_their_sync_finished_wait_for_the_next_digest(digest_env) -> None:
    conn, bot = digest_env
    d1 = datetime(2026, 11, 9, 8, 0, tzinfo=timezone.utc)
    conn.execute("UPDATE digest_state SET last_sent_utc = ?, window_end_utc = ?", (_z(d1), _z(d1)))
    _db_node(conn, "c3" * 32, "Done")
    _db_change(conn, "c3" * 32, "added", d1 + timedelta(hours=20))
    _db_sync(conn, d1 + timedelta(hours=20, minutes=1))
    # Node rows of a sync whose history row is not written yet.
    _db_node(conn, "d4" * 32, "Pending")
    _db_change(conn, "d4" * 32, "added", d1 + timedelta(hours=24, minutes=59))
    conn.commit()

    assert _post(bot, d1 + timedelta(hours=25))
    assert "Pending" not in _all_keys(bot.channel.sent[-1])
    _db_sync(conn, d1 + timedelta(hours=25, seconds=2))
    conn.commit()
    assert _post(bot, d1 + timedelta(hours=49))
    assert "Pending" in _all_keys(bot.channel.sent[-1])


def test_window_line_shows_each_sides_own_time_zone() -> None:
    start = datetime(2026, 10, 24, 7, 0, tzinfo=timezone.utc)
    end = datetime(2026, 10, 25, 8, 0, tzinfo=timezone.utc)
    agg = {"added": ["a" * 64], "removed": [], "restored": [], "updated_count": 0}
    embed = build_digest_embed(agg, start, end, {"total_nodes": 1}, added_nodes=[_node(1)])
    assert "Sat 24 Oct 09:00 CEST → Sun 25 Oct 09:00 CET" in embed.description
    assert "24 h" not in str(embed.to_dict())


def test_digest_is_due_only_after_a_missed_time_today(digest_env) -> None:
    conn, _ = digest_env
    yesterday = datetime(2026, 11, 9, 8, 0, 3, tzinfo=timezone.utc)  # 09:00 CET
    conn.execute("UPDATE digest_state SET last_sent_utc = ?", (_z(yesterday),))
    conn.commit()
    today_0830 = datetime(2026, 11, 10, 7, 30, tzinfo=timezone.utc)
    today_1400 = datetime(2026, 11, 10, 13, 0, tzinfo=timezone.utc)
    assert not dd.digest_is_due(conn, today_0830)
    assert dd.digest_is_due(conn, today_1400)
    conn.execute("UPDATE digest_state SET last_sent_utc = ?", (_z(today_1400 - timedelta(hours=5)),))
    conn.commit()
    assert not dd.digest_is_due(conn, today_1400)


def test_digest_is_not_due_before_the_first_digest(digest_env) -> None:
    conn, _ = digest_env
    assert not dd.digest_is_due(conn, datetime(2026, 11, 10, 13, 0, tzinfo=timezone.utc))


def test_missed_digest_is_caught_up_once_covering_the_whole_gap(digest_env) -> None:
    conn, bot = digest_env
    two_days_ago = datetime(2026, 11, 8, 8, 0, tzinfo=timezone.utc)
    conn.execute("UPDATE digest_state SET last_sent_utc = ?, window_end_utc = ?", (_z(two_days_ago), _z(two_days_ago)))
    for i, hours in enumerate((5, 30, 50)):  # spread over the two missed days
        pk = f"{i:x}e" * 32
        _db_node(conn, pk, f"Gap{i}")
        _db_change(conn, pk, "added", two_days_ago + timedelta(hours=hours))
        _db_sync(conn, two_days_ago + timedelta(hours=hours, minutes=1))
    conn.commit()

    start_late = datetime(2026, 11, 10, 13, 0, tzinfo=timezone.utc)  # bot back at 14:00 CET
    assert _post(bot, start_late, only_if_due=True)
    assert not _post(bot, start_late + timedelta(minutes=1), only_if_due=True)
    assert not _post(bot, start_late + timedelta(hours=3), only_if_due=True)
    assert len(bot.channel.sent) == 1
    embed = bot.channel.sent[0]
    assert all(f"Gap{i}" in _all_keys(embed) for i in range(3))
    assert embed.description.count("Sun 08 Nov 09:00") == 1


def test_missed_digest_catch_up_runs_once_even_when_started_twice(digest_env) -> None:
    conn, bot = digest_env
    yesterday = datetime(2026, 11, 9, 8, 0, tzinfo=timezone.utc)
    conn.execute("UPDATE digest_state SET last_sent_utc = ?, window_end_utc = ?", (_z(yesterday), _z(yesterday)))
    _db_node(conn, "f6" * 32, "Once")
    _db_change(conn, "f6" * 32, "added", yesterday + timedelta(hours=3))
    _db_sync(conn, yesterday + timedelta(hours=3, minutes=1))
    conn.commit()
    now = datetime(2026, 11, 10, 13, 0, tzinfo=timezone.utc)

    async def both():
        return await asyncio.gather(
            dd.post_daily_digest(bot, now_utc=now, only_if_due=True),
            dd.post_daily_digest(bot, now_utc=now, only_if_due=True),
        )

    assert sorted(asyncio.run(both())) == [False, True]
    assert len(bot.channel.sent) == 1



def test_old_digest_state_gets_window_columns_and_keeps_its_values(tmp_path, monkeypatch) -> None:
    import backend.database as dbm

    db_path = str(tmp_path / "old.db")
    old = sqlite3.connect(db_path)
    old.executescript(
        """
        CREATE TABLE digest_state (
            id INTEGER PRIMARY KEY CHECK (id = 1),
            last_sent_utc TEXT, last_channel_id TEXT, last_message_id TEXT
        );
        INSERT INTO digest_state VALUES (1, '2026-10-26T08:00:00Z', '42', '99');
        """
    )
    old.commit()
    old.close()
    monkeypatch.setenv("DATABASE_PATH", db_path)
    monkeypatch.setattr(dbm, "DATABASE_PATH", db_path)
    dbm.init_database()
    dbm.init_database()  # idempotent

    conn = dbm.get_connection()
    row = dict(conn.execute("SELECT * FROM digest_state").fetchone())
    assert row["last_sent_utc"] == "2026-10-26T08:00:00Z"
    assert row["last_channel_id"] == "42"
    assert row["window_end_utc"] is None and row["last_change_id"] is None
    # First window after the upgrade starts at the old last_sent_utc.
    window = dd.digest_window(conn, datetime(2026, 10, 27, 8, 0, tzinfo=timezone.utc))
    assert window.start_utc == datetime(2026, 10, 26, 8, 0, tzinfo=timezone.utc)
    conn.close()



# ---------------------------------------------------------------------------
# Layout: totals, net change, held-back removals, no spacer fields
# ---------------------------------------------------------------------------

_STATS = {
    "total_nodes": 881, "active_7d": 362, "claimed_nodes": 214, "unclaimed_nodes": 667,
    "registered_users": 97, "total_cities": 312, "by_type": {1: 168, 2: 655, 3: 41, 4: 17},
}
_START = datetime(2026, 10, 26, 8, 0, tzinfo=timezone.utc)
_END = datetime(2026, 10, 27, 8, 0, tzinfo=timezone.utc)


def _agg(added=0, removed=0, restored=0):
    return {
        "added": [f"a{i:063x}" for i in range(added)],
        "removed": [f"b{i:063x}" for i in range(removed)],
        "restored": [f"c{i:063x}" for i in range(restored)],
        "updated_count": 900,
    }


def _text(embed):
    return "\n".join([embed.description or ""] + [f"{f.name}\n{f.value}" for f in embed.fields])


def test_layout_has_no_spacers_noise_lines_or_inline_columns() -> None:
    embed = build_digest_embed(_agg(2, 1), _START, _END, _STATS, previous_total=880,
                               added_nodes=[_node(1), _node(2)], removed_nodes=[_node(3)])
    text = _text(embed)
    assert all(f.name.strip("\u200b ") and f.value.strip("\u200b ") for f in embed.fields)
    assert not any(f.inline for f in embed.fields)
    assert "Updated" not in text
    assert "Syncs in window" not in text
    assert "❌ Deleted Nodes (1)" in [f.name for f in embed.fields]


def test_totals_line_shows_map_total_heard_last_7_days_and_net_change() -> None:
    embed = build_digest_embed(_agg(5, 18, 2), _START, _END, _STATS, previous_total=894)
    text = _text(embed)
    assert "On the map: **881** (−13 since yesterday) · heard in the last 7 days: **362**" in text


def test_first_digest_has_no_since_yesterday_part() -> None:
    embed = build_digest_embed(_agg(5, 18, 2), _START, _END, _STATS)
    text = _text(embed)
    assert "On the map: **881** · heard in the last 7 days: **362**" in text
    assert "since" not in text


def test_empty_window_says_no_changes_and_has_no_net_part() -> None:
    embed = build_digest_embed(_agg(), _START, _END, _STATS, previous_total=881)
    assert "No changes since the last digest" in embed.description
    assert "→" not in embed.description
    text = _text(embed)
    assert "±0" not in text and "since yesterday" not in text
    assert "On the map: **881** · heard" in text


def test_window_with_equal_start_and_end_is_not_shown() -> None:
    embed = build_digest_embed(_agg(1), _START, _START, _STATS, previous_total=880)
    assert "→" not in embed.description
    assert "No changes" not in embed.description


def test_net_change_after_a_longer_gap_names_the_start_day() -> None:
    embed = build_digest_embed(_agg(3), _START - timedelta(days=2), _END, _STATS, previous_total=878)
    assert "(+3 since Sat 24 Oct)" in _text(embed)


def test_held_back_removals_line_only_when_it_happened() -> None:
    held = {"held_count": 30, "still_held": True}
    embed = build_digest_embed(_agg(1), _START, _END, _STATS, held_back=held)
    assert "Removals held back: 30 nodes — waiting for confirmation" in _text(embed)
    plain = build_digest_embed(_agg(1), _START, _END, _STATS)
    assert "held back" not in _text(plain)


def test_post_uses_the_previous_digest_total(digest_env, monkeypatch) -> None:
    import backend.discord_queries as dq

    conn, bot = digest_env
    d1 = datetime(2026, 11, 9, 8, 0, tzinfo=timezone.utc)
    conn.execute("UPDATE digest_state SET last_sent_utc = ?, window_end_utc = ?", (_z(d1), _z(d1)))
    _db_node(conn, "a7" * 32, "One")
    _db_change(conn, "a7" * 32, "added", d1 + timedelta(hours=2))
    _db_sync(conn, d1 + timedelta(hours=2, minutes=1))
    conn.commit()
    assert _post(bot, d1 + timedelta(hours=24))
    stored = conn.execute("SELECT last_total_nodes FROM digest_state").fetchone()[0]
    assert stored == 881

    monkeypatch.setattr(dq, "get_statistics", lambda: {"total_nodes": 879, "active_7d": 360, "by_type": {}})
    _db_node(conn, "b8" * 32, "Two", active=0)
    _db_change(conn, "b8" * 32, "removed", d1 + timedelta(hours=30))
    _db_sync(conn, d1 + timedelta(hours=30, minutes=1))
    conn.commit()
    assert _post(bot, d1 + timedelta(hours=48))
    assert "On the map: **879** (−2 since yesterday)" in _text(bot.channel.sent[-1])


def test_held_back_removals_are_posted_even_without_map_changes(digest_env) -> None:
    conn, bot = digest_env
    d1 = datetime(2026, 11, 9, 8, 0, tzinfo=timezone.utc)
    conn.execute("UPDATE digest_state SET last_sent_utc = ?, window_end_utc = ?", (_z(d1), _z(d1)))
    _db_sync(conn, d1 + timedelta(hours=3), {"removal_safety": {"held_count": 12, "due_count": 40}})
    _db_sync(conn, d1 + timedelta(hours=4), {"removal_safety": {"held_count": 31, "due_count": 31}})
    conn.commit()
    assert _post(bot, d1 + timedelta(hours=24))
    assert "Removals held back: 31 nodes — waiting for confirmation" in _text(bot.channel.sent[-1])


def test_held_back_removals_that_were_released_later_in_the_window(digest_env) -> None:
    conn, bot = digest_env
    d1 = datetime(2026, 11, 9, 8, 0, tzinfo=timezone.utc)
    conn.execute("UPDATE digest_state SET last_sent_utc = ?, window_end_utc = ?", (_z(d1), _z(d1)))
    _db_sync(conn, d1 + timedelta(hours=3), {"removal_safety": {"held_count": 30}})
    _db_sync(conn, d1 + timedelta(hours=4), {})
    conn.commit()
    assert _post(bot, d1 + timedelta(hours=24))
    assert "Removals held back: 30 nodes — released later" in _text(bot.channel.sent[-1])


def test_quiet_day_still_posts_nothing(digest_env) -> None:
    conn, bot = digest_env
    d1 = datetime(2026, 11, 9, 8, 0, tzinfo=timezone.utc)
    conn.execute("UPDATE digest_state SET last_sent_utc = ?, window_end_utc = ?", (_z(d1), _z(d1)))
    _db_sync(conn, d1 + timedelta(hours=3), {"error_count": 0})
    conn.commit()
    assert not _post(bot, d1 + timedelta(hours=24))
    assert bot.channel.sent == []
    assert conn.execute("SELECT last_total_nodes FROM digest_state").fetchone()[0] is not None


def test_forced_run_with_nothing_new_says_no_changes(digest_env) -> None:
    conn, bot = digest_env
    d1 = datetime(2026, 11, 9, 8, 0, tzinfo=timezone.utc)
    conn.execute("UPDATE digest_state SET last_sent_utc = ?, window_end_utc = ?", (_z(d1), _z(d1)))
    conn.commit()
    assert _post(bot, d1 + timedelta(minutes=5), force=True)
    text = _text(bot.channel.sent[-1])
    assert "No changes since the last digest" in text
    assert "→" not in text and "±0" not in text


def test_first_digest_post_has_no_since_yesterday(digest_env) -> None:
    conn, bot = digest_env
    d1 = datetime(2026, 11, 9, 8, 0, tzinfo=timezone.utc)
    _db_node(conn, "a7" * 32, "One")
    _db_change(conn, "a7" * 32, "added", d1 - timedelta(hours=2))
    _db_sync(conn, d1 - timedelta(hours=1))
    conn.commit()
    assert _post(bot, d1)
    assert "since" not in _text(bot.channel.sent[-1])


def test_description_has_link_window_and_counts_and_no_changes_field() -> None:
    embed = build_digest_embed(_agg(5, 18, 2), _START, _END, _STATS, previous_total=894)
    lines = embed.description.split("\n")
    assert lines[0].startswith("Daily activity on the [#BEmesh Map](")
    assert lines[1].startswith("**") and "→" in lines[1]
    assert lines[2] == "✅ 5 new · 🔄 2 restored · ❌ 18 deleted"
    assert len(lines) == 3
    assert not any("Changes" in f.name for f in embed.fields)


def test_description_counts_leave_out_zero_parts() -> None:
    embed = build_digest_embed(_agg(12, 1, 0), _START, _END, _STATS)
    assert embed.description.split("\n")[2] == "✅ 12 new · ❌ 1 deleted"


def test_empty_forced_run_has_no_counts_line() -> None:
    embed = build_digest_embed(_agg(), _START, _END, _STATS)
    assert embed.description.split("\n") == [
        embed.description.split("\n")[0], "**No changes since the last digest**",
    ]


def test_field_order_sections_then_sync_then_totals_last() -> None:
    nodes = [_node(1)]
    agg = {"added": ["a" * 64], "restored": ["b" * 64], "removed": ["c" * 64], "updated_count": 0}
    embed = build_digest_embed(
        agg, _START, _END, _STATS, added_nodes=nodes, restored_nodes=nodes, removed_nodes=nodes,
        held_back={"held_count": 2, "still_held": True},
    )
    names = [f.name for f in embed.fields]
    assert names[0].startswith("✅ New") and names[1].startswith("🔄 Restored")
    assert names[2].startswith("❌ Deleted") and names[3].startswith("⚠️ Sync")
    assert names[4].startswith("📊 Map totals") and len(names) == 5


def test_nodes_are_ordered_repeaters_room_servers_companions_sensors() -> None:
    nodes = [
        _node(1, type=4, adv_name="S"), _node(2, type=1, adv_name="C"),
        _node(3, type=3, adv_name="R"), _node(4, type=2, adv_name="P"),
    ]
    lines = render_node_list(nodes, 4).split("\n")
    assert [ln[:1] for ln in lines] == ["📡", "💾", "📱", "🌡"]


def test_type_counts_use_words_same_order_in_totals_and_leave_out_zero() -> None:
    stats = {**_STATS, "by_type": {1: 7, 2: 22, 3: 1, 4: 0}}
    embed = build_digest_embed(_agg(1), _START, _END, stats)
    totals = [f for f in embed.fields if "Map totals" in f.name][0].value
    assert "📡 Repeaters 22 · 💾 Room Servers 1 · 📱 Companions 7" in totals
    assert "Sensors" not in totals


def test_unknown_town_falls_back_to_province_name_only() -> None:
    line = format_digest_node_line(_node(1, city="Unknown", province_code="be-vov"))
    assert "Oost-Vlaanderen" in line and "VOV" not in line
    known = format_digest_node_line(_node(1, province_code="be-vov"))
    assert "Oost-Vlaanderen" not in known


def test_window_line_formats() -> None:
    f = dd.format_window
    # shared zone: one zone at the end
    assert f(datetime(2026, 10, 26, 22, 0, tzinfo=timezone.utc),
             datetime(2026, 10, 27, 8, 8, tzinfo=timezone.utc)) == "Mon 26 Oct 23:00 → Tue 27 Oct 09:08 CET"
    # DST change: each side its own zone
    assert f(datetime(2026, 10, 25, 7, 0, tzinfo=timezone.utc),
             datetime(2026, 10, 26, 8, 0, tzinfo=timezone.utc)) == "Sun 25 Oct 08:00 → Mon 26 Oct 09:00 CET"
    assert f(datetime(2026, 10, 24, 7, 0, tzinfo=timezone.utc),
             datetime(2026, 10, 25, 8, 0, tzinfo=timezone.utc)) == "Sat 24 Oct 09:00 CEST → Sun 25 Oct 09:00 CET"
    # same-day window still shows both dates
    assert f(datetime(2026, 11, 10, 8, 0, tzinfo=timezone.utc),
             datetime(2026, 11, 10, 12, 0, tzinfo=timezone.utc)) == "Tue 10 Nov 09:00 → Tue 10 Nov 13:00 CET"


def test_brand_is_spelled_bemesh_in_backend_discord_text() -> None:
    import pathlib
    for path in pathlib.Path(dd.__file__).parent.glob("*.py"):
        assert "#BEMesh" not in path.read_text(encoding="utf-8"), path.name
        assert "[BEMesh Map]" not in path.read_text(encoding="utf-8"), path.name



def test_footer_uses_the_window_date_style() -> None:
    end = datetime(2026, 10, 27, 8, 0, tzinfo=timezone.utc)  # Tue 27 Oct 09:00 CET
    embed = build_digest_embed({"added": [], "removed": [], "restored": []}, end - timedelta(hours=24), end,
                               {"total_nodes": 1})
    assert embed.footer.text == "Next digest: Wed 28 Oct 09:00 CET"


def test_bulk_section_leaves_out_a_type_line_equal_to_the_totals() -> None:
    end = datetime(2026, 10, 27, 8, 0, tzinfo=timezone.utc)
    nodes = [_node(i, type=2) for i in range(30)]
    stats = {"total_nodes": 30, "by_type": {2: 30}}
    agg = {"added": [n["public_key"] for n in nodes], "removed": [], "restored": []}
    embed = build_digest_embed(agg, end - timedelta(hours=24), end, stats, added_nodes=nodes)
    new = next(f for f in embed.fields if "New Nodes" in f.name)
    assert "Repeaters 30" not in new.value, "same as the Map totals line"
    assert "Repeaters 30" in next(f for f in embed.fields if "Map totals" in f.name).value
    stats_more = {"total_nodes": 40, "by_type": {2: 35, 1: 5}}
    embed = build_digest_embed(agg, end - timedelta(hours=24), end, stats_more, added_nodes=nodes)
    new = next(f for f in embed.fields if "New Nodes" in f.name)
    assert "Repeaters 30" in new.value, "kept when it differs from the totals"

if __name__ == "__main__":
    unittest.main(verbosity=2)
