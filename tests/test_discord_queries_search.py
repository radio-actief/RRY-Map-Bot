"""Tests for Discord bot search query helpers."""

import os
import sqlite3
import sys
import tempfile
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

from backend.database import init_database, get_current_timestamp
from backend.sync_belgian_nodes import integrate_added_node
from backend.discord_queries import (
    normalize_pubkey,
    query_nodes_substring,
    update_ownership,
)


class TestDiscordQueriesSearch(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.NamedTemporaryFile(suffix='.db', delete=False)
        self.tmp.close()
        self.db_path = self.tmp.name
        self._orig_env = os.environ.get('DATABASE_PATH')
        os.environ['DATABASE_PATH'] = self.db_path
        init_database()

        conn = sqlite3.connect(self.db_path)
        conn.row_factory = sqlite3.Row

        base = {
            'type': 1,
            'adv_lat': 50.85,
            'adv_lon': 4.35,
            'city': 'Brussels',
            'last_advert': get_current_timestamp(),
            'inserted_date': get_current_timestamp(),
            'updated_date': get_current_timestamp(),
            'params': {'freq': 869.525, 'sf': 10, 'bw': 250, 'cr': 5},
            'link': 'meshcore://x',
            'source': 'app',
            'inserted_by': 'test',
            'updated_by': 'test',
        }

        self.pk_exact = 'aa' * 32
        self.pk_other = 'bb' * 32

        integrate_added_node({**base, 'public_key': self.pk_exact, 'adv_name': 'Brussels Alpha'}, conn)
        integrate_added_node({**base, 'public_key': self.pk_other, 'adv_name': 'Brussels Beta'}, conn)
        conn.commit()
        conn.close()

        self.assertTrue(update_ownership(self.pk_other, 'owner_1', 'OwnerOne'))

    def tearDown(self):
        if self._orig_env is None:
            os.environ.pop('DATABASE_PATH', None)
        else:
            os.environ['DATABASE_PATH'] = self._orig_env
        if os.path.exists(self.db_path):
            os.unlink(self.db_path)

    def test_normalize_pubkey(self):
        self.assertEqual(normalize_pubkey("AA BB-CC"), "aabbcc")
        self.assertIsNone(normalize_pubkey("not-hex-name"))

    def test_exact_pubkey_returns_single_node(self):
        full_key = self.pk_exact.upper()
        results = query_nodes_substring(query=full_key, limit=50)
        self.assertEqual(len(results), 1)
        self.assertEqual(results[0]['public_key'], self.pk_exact)

    def test_pubkey_prefix_ranks_before_name_match(self):
        prefix = self.pk_exact[:6]
        results = query_nodes_substring(query=prefix, limit=50)
        self.assertGreaterEqual(len(results), 1)
        self.assertEqual(results[0]['public_key'], self.pk_exact)

    def test_claimed_false_excludes_owned_nodes(self):
        results = query_nodes_substring(query='Brussels', claimed=False, limit=50)
        keys = {n['public_key'] for n in results}
        self.assertIn(self.pk_exact, keys)
        self.assertNotIn(self.pk_other, keys)


if __name__ == "__main__":
    unittest.main()
