"""The stats radio filter (custom values and named presets) compares numbers, not text."""

import json
import os
import sqlite3
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from backend import discord_queries as q  # noqa: E402

ROWS = [
    {"freq": 869.618, "sf": 8, "bw": 62.5, "cr": 8},  # EU/UK (Narrow)
    {"freq": 869.525, "sf": 11, "bw": 250, "cr": 5},  # EU/UK (Long Range), bw stored as an integer
    {"freq": 869.6, "sf": 8, "bw": 62.5, "cr": 8},
    {"freq": 869.65, "sf": 7, "bw": 125.0, "cr": 5},
]


def db():
    conn = sqlite3.connect(":memory:")
    conn.execute("CREATE TABLE nodes (id INTEGER PRIMARY KEY, params TEXT)")
    for r in ROWS:
        conn.execute("INSERT INTO nodes (params) VALUES (?)", (json.dumps(r),))
    for bad in ("", None, "not json", "[1, 2]"):
        conn.execute("INSERT INTO nodes (params) VALUES (?)", (bad,))
    return conn


def count(clause):
    sql, params = clause
    return db().execute("SELECT count(*) FROM nodes WHERE 1=1" + sql, params).fetchone()[0]


def test_an_integer_bandwidth_is_found():
    assert count(q._partial_radio_filter_clause({"bw": 250})) == 1
    assert count(q._partial_radio_filter_clause({"bw": 250.0})) == 1


def test_a_frequency_matches_exactly_not_as_a_prefix():
    assert count(q._partial_radio_filter_clause({"freq": 869.6})) == 1
    assert count(q._partial_radio_filter_clause({"freq": 869.618})) == 1


def test_every_given_field_must_match():
    assert count(q._partial_radio_filter_clause({"sf": 8, "bw": 62.5})) == 2
    assert count(q._partial_radio_filter_clause({"sf": 8, "bw": 62.5, "freq": 869.618, "cr": 8})) == 1
    assert count(q._partial_radio_filter_clause({})) == 8


def test_named_presets_match_their_nodes_only():
    assert count(q._preset_filter_clause("EU/UK (Narrow)")) == 1
    assert count(q._preset_filter_clause("EU/UK (Long Range)")) == 1


def test_empty_and_broken_params_never_break_the_query():
    # The four bad rows are simply not matched; no "malformed JSON" error.
    assert count(q._partial_radio_filter_clause({"sf": 7})) == 1


def test_the_bot_search_quick_check_matches_presets_as_numbers():
    narrow = {"freq": 869.618, "sf": 8, "bw": 62.5, "cr": 8}
    assert q._radio_matches(ROWS[0], narrow)
    assert q._radio_matches({"freq": "869.618", "sf": "8", "bw": "62.5", "cr": "8"}, narrow)
    assert not q._radio_matches(ROWS[2], narrow)
    assert not q._radio_matches({}, narrow)
