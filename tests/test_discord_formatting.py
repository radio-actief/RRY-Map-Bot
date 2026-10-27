"""Tests for shared Discord formatting helpers."""

import unittest

import discord

from backend.discord_formatting import (
    DISCORD_COLOR_GREEN,
    DISCORD_COLOR_ORANGE,
    build_claim_embed_dict,
    build_search_summary,
    build_unclaim_embed_dict,
    fit_lines,
    format_digest_node_line,
    format_full_node_details,
    format_node_line,
    map_button_components,
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

    def test_claim_embed_is_two_lines_with_the_node_line(self):
        node = {
            "public_key": "b" * 64,
            "adv_name": "Rep*eater|1",
            "type": 2,
            "city": "Ghent",
            "source": "app",
            "last_advert": "2026-10-20T12:00:00Z",
        }
        embed = build_claim_embed_dict(node, "12345", via_web=False)
        self.assertEqual(embed["color"], DISCORD_COLOR_GREEN)
        self.assertEqual(embed["title"], "📡 Node claimed")
        what, line = embed["description"].split("\n")
        self.assertEqual(what, "<@12345> claimed this node.")
        self.assertEqual(line, format_node_line(node, owner=False))
        self.assertIn("Rep\\*eater\\|1", line)  # name escaped
        self.assertIn("?node=bbbbbbbbbbbb)", line)  # short map link
        self.assertIn("seen <t:1792497600:R>", line)
        self.assertNotIn("fields", embed)
        self.assertNotIn("footer", embed)

    def test_unclaim_embed_via_web_says_so(self):
        node = {"public_key": "c" * 64, "adv_name": "Node", "type": 1, "city": "Antwerp"}
        embed = build_unclaim_embed_dict(node, "999", via_web=True)
        self.assertEqual(embed["color"], DISCORD_COLOR_ORANGE)
        self.assertTrue(embed["description"].startswith("<@999> released this node on the map."))
        self.assertNotIn("`", embed["description"])

    def test_node_line_is_the_digest_line_plus_seen(self):
        node = {
            "public_key": "d" * 64, "adv_name": "Leuven Rep", "type": 2, "city": "Leuven",
            "discord_owner_id": "42", "inserted_date": "2026-01-01T00:00:00Z",
            "last_advert": "2026-10-20T12:00:00Z",
        }
        self.assertEqual(
            format_node_line(node),
            format_digest_node_line(node) + " · seen <t:1792497600:R>",
        )
        self.assertNotIn("<@42>", format_node_line(node, owner=False))
        bare = {"public_key": "d" * 64, "adv_name": "X", "type": 1}
        self.assertEqual(format_node_line(bare), format_digest_node_line(bare))

    def test_detail_embed_is_slim(self):
        embed = format_full_node_details(
            {
                "public_key": "e" * 64, "adv_name": "A_b*c", "type": 2, "city": "Leuven",
                "inserted_date": "2026-01-01T00:00:00Z", "last_advert": "2026-10-20T12:00:00Z",
                "inserted_by": "uploader", "updated_by": "sync", "source": "app",
                "link": "meshcore://abc", "params": {"freq": 869.618, "sf": 8, "bw": 62.5, "cr": 8},
            },
            lambda **kw: discord.Embed(**kw),
        )
        names = [f.name for f in embed.fields]
        self.assertEqual(names, ["Public key", "Type", "Town", "Owner", "Frequency", "First seen", "Last seen"])
        values = {f.name: f.value for f in embed.fields}
        self.assertEqual(values["First seen"], "<t:1767225600:R>")
        self.assertEqual(values["Last seen"], "<t:1792497600:R>")
        self.assertEqual(embed.description, "**A\\_b\\*c**")
        self.assertNotIn("meshcore://", str(embed.to_dict()))

    def test_search_summary_strips_backticks_from_user_text(self):
        summary = build_search_summary(query="a`b", city="Ge`nt")
        self.assertEqual(summary, "`ab`, city: `Gent`")

    def test_stats_and_map_urls_follow_map_base_url(self):
        import backend.discord_formatting as fmt

        old = fmt.MAP_BASE_URL
        fmt.MAP_BASE_URL = "https://test.example/"
        try:
            self.assertEqual(fmt.get_map_base_url(), "https://test.example")
            self.assertEqual(fmt.get_stats_url(), "https://test.example/stats")
        finally:
            fmt.MAP_BASE_URL = old

    def test_map_button_components_are_one_link_button(self):
        self.assertEqual(
            map_button_components("https://x/?node=ab"),
            [{"type": 1, "components": [{"type": 2, "style": 5, "label": "Open on map", "url": "https://x/?node=ab"}]}],
        )

    def test_fit_lines_keeps_whole_lines(self):
        self.assertEqual(fit_lines(["aaa", "bbb", "ccc"], 7), (["aaa", "bbb"], 1))
        self.assertEqual(fit_lines(["aaa"], 100), (["aaa"], 0))


if __name__ == "__main__":
    unittest.main()
