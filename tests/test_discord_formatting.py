"""Tests for shared Discord formatting helpers."""

import unittest

from backend.discord_formatting import (
    DISCORD_COLOR_GREEN,
    DISCORD_COLOR_ORANGE,
    build_claim_embed_dict,
    build_search_summary,
    build_unclaim_embed_dict,
    chunk_embed_descriptions,
    format_node_simple,
    truncate_public_key,
)


class TestDiscordFormatting(unittest.TestCase):
    def test_truncate_public_key_uppercases(self):
        self.assertEqual(truncate_public_key("abcdef123456"), "ABCDEF")
        self.assertEqual(
            truncate_public_key("abcdef1234567890" * 4, show_full=True),
            ("abcdef1234567890" * 4).upper(),
        )

    def test_build_search_summary_includes_claimed_and_inactive(self):
        summary = build_search_summary(
            query="Brussels",
            claimed=False,
            inactive=True,
        )
        self.assertIn("`Brussels`", summary)
        self.assertIn("claimed: `false`", summary)
        self.assertIn("inactive: `true`", summary)

    def test_format_node_simple_map_link_and_inactive_badge(self):
        node = {
            "public_key": "a" * 64,
            "adv_name": "Test_Node",
            "type": 2,
            "city": "Brussels",
            "is_active": 0,
            "params": {"freq": 869.525, "sf": 10, "bw": 250, "cr": 5},
            "source": "app",
            "inserted_date": "2026-01-01T12:00:00Z",
        }
        text = format_node_simple(
            node,
            include_map_link=True,
            show_inactive_badge=True,
        )
        self.assertIn("⚫ Inactive", text)
        self.assertIn("[View on map]", text)
        self.assertIn("meshmap", text)

    def test_claim_embed_dict_fields(self):
        node = {
            "public_key": "b" * 64,
            "adv_name": "Repeater",
            "type": 2,
            "city": "Ghent",
            "source": "app",
        }
        embed = build_claim_embed_dict(node, "12345", via_web=False)
        self.assertEqual(embed["color"], DISCORD_COLOR_GREEN)
        field_names = [f["name"] for f in embed["fields"]]
        self.assertIn("View on Map", field_names)
        self.assertIn("Claimed By", field_names)
        self.assertNotIn("/node update", embed["footer"]["text"])

    def test_unclaim_embed_dict_via_web_footer(self):
        node = {
            "public_key": "c" * 64,
            "adv_name": "Node",
            "type": 1,
            "city": "Antwerp",
            "source": "uploader",
        }
        embed = build_unclaim_embed_dict(node, "999", via_web=True)
        self.assertEqual(embed["color"], DISCORD_COLOR_ORANGE)
        self.assertIn("web app", embed["footer"]["text"])
        self.assertNotIn("/node update", embed["footer"]["text"])

    def test_chunk_embed_descriptions_splits_long_lists(self):
        header = "**Search result for:** `test`\n\nFound **30** node(s):\n\n"
        items = [f"Node block {i}\nline2\nline3\n[View on map](http://x)" for i in range(30)]
        chunks = chunk_embed_descriptions(header, items)
        self.assertGreater(len(chunks), 1)
        for chunk in chunks:
            self.assertLessEqual(len(chunk), 4096)


if __name__ == "__main__":
    unittest.main()
