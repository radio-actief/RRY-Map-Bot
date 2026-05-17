"""Tests for backend.datetime_utils."""
from __future__ import annotations

import sys
import unittest
from datetime import datetime, timezone
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO_ROOT))

from backend.datetime_utils import (  # noqa: E402
    format_utc_iso,
    is_canonical_utc_iso,
    normalize_node_timestamps,
    normalize_timestamp,
    parse_utc,
    utc_now_iso,
)


class TestDatetimeUtils(unittest.TestCase):
    def test_parse_utc_z_suffix(self):
        dt = parse_utc("2025-12-30T06:26:52.000Z")
        self.assertIsNotNone(dt)
        assert dt is not None
        self.assertEqual(dt.year, 2025)
        self.assertEqual(dt.hour, 6)

    def test_parse_utc_offset_and_naive(self):
        dt_offset = parse_utc("2026-05-17T12:34:56.789123+00:00")
        dt_naive = parse_utc("2025-12-30 06:26:52")
        self.assertIsNotNone(dt_offset)
        self.assertIsNotNone(dt_naive)
        assert dt_offset is not None and dt_naive is not None
        self.assertEqual(
            dt_offset.replace(microsecond=0),
            datetime(2026, 5, 17, 12, 34, 56, tzinfo=timezone.utc),
        )
        self.assertEqual(
            dt_naive,
            datetime(2025, 12, 30, 6, 26, 52, tzinfo=timezone.utc),
        )

    def test_normalize_timestamp_canonical(self):
        self.assertEqual(
            normalize_timestamp("2025-12-30T06:26:52.000Z"),
            "2025-12-30T06:26:52Z",
        )
        self.assertEqual(
            normalize_timestamp("2025-12-30 06:26:52"),
            "2025-12-30T06:26:52Z",
        )

    def test_utc_now_iso_is_canonical(self):
        now = utc_now_iso()
        self.assertTrue(is_canonical_utc_iso(now))

    def test_normalize_node_timestamps(self):
        node = {
            "last_advert": "2025-12-28T07:44:03.000Z",
            "updated_date": "2025-12-30 06:26:52",
        }
        normalize_node_timestamps(node)
        self.assertEqual(node["last_advert"], "2025-12-28T07:44:03Z")
        self.assertEqual(node["updated_date"], "2025-12-30T06:26:52Z")


if __name__ == "__main__":
    unittest.main()
