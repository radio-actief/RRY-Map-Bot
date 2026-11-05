"""Query helpers behind the Discord bot: errors, wildcards, counts, autocomplete, logs."""

import sqlite3

import pytest


def _insert(db_path, pk, name, *, city="Leuven", type_=2, active=1, owner=None, owner_name=None):
    conn = sqlite3.connect(db_path)
    conn.execute(
        """
        INSERT INTO belgian_nodes (
            public_key, type, adv_name, adv_lat, adv_lon, city,
            last_advert, inserted_date, updated_date, params,
            link, source, is_active, created_at, discord_owner_id, discord_owner_name
        ) VALUES (?, ?, ?, 50.88, 4.70, ?, '2026-10-20T12:00:00Z', '2026-01-01T00:00:00Z',
                  '2026-10-20T12:00:00Z', '{"freq": 869.618, "sf": 8, "bw": 62.5, "cr": 8}',
                  '', 'app', ?, '2026-01-01 00:00:00', ?, ?)
        """,
        (pk, type_, name, city, active, owner, owner_name),
    )
    conn.commit()
    conn.close()


@pytest.fixture
def db(temp_db):
    _insert(temp_db, "a1" * 32, "Leuven Rep", city="Leuven")
    _insert(temp_db, "a2" * 32, "Leuven Two", city="Leuven")
    _insert(temp_db, "a3" * 32, "Gent Rep", city="Gent", owner="111", owner_name="alice")
    _insert(temp_db, "a4" * 32, "Old Alice", city="Gent", active=0, owner="111", owner_name="alice")
    _insert(temp_db, "a5" * 32, "Bob Node", city="Brugge", owner="222", owner_name="bob")
    return temp_db


@pytest.fixture
def broken_db(tmp_path, monkeypatch):
    """A database file without any tables: every query fails."""
    import backend.database as dbm

    path = str(tmp_path / "empty.db")
    sqlite3.connect(path).close()
    monkeypatch.setenv("DATABASE_PATH", path)
    monkeypatch.setattr(dbm, "DATABASE_PATH", path)
    return path


def test_db_errors_raise_instead_of_looking_empty(broken_db):
    from backend import discord_queries as dq

    for call in (
        lambda: dq.query_nodes_substring(query="x"),
        lambda: dq.count_nodes_substring(query="x"),
        lambda: dq.get_user_nodes("1"),
        lambda: dq.get_statistics(),
        lambda: dq.get_source_statistics(),
        lambda: dq.get_node_by_key("ab" * 32),
        lambda: dq.verify_ownership("ab" * 32, "1"),
        lambda: dq.search_owned_nodes("1", "x"),
        lambda: dq.unclaimed_node_suggestions("x"),
        lambda: dq.city_suggestions("x"),
    ):
        with pytest.raises(sqlite3.Error):
            call()


def test_claim_writes_raise_on_db_errors(broken_db):
    from backend import discord_queries as dq

    with pytest.raises(sqlite3.Error):
        dq.update_ownership("ab" * 32, "1", "x", source="bot")
    with pytest.raises(sqlite3.Error):
        dq.remove_ownership("ab" * 32, "1", source="bot")


def test_like_wildcards_in_the_query_are_literal(db):
    from backend import discord_queries as dq

    assert dq.query_nodes_substring(query="_") == []
    assert dq.query_nodes_substring(query="%") == []
    assert dq.count_nodes_substring(query="%") == 0
    assert dq.query_nodes_substring(city="%") == []
    assert {n["adv_name"] for n in dq.query_nodes_substring(query="rep")} == {"Leuven Rep", "Gent Rep"}


def test_count_reports_the_total_beyond_the_limit(db):
    from backend import discord_queries as dq

    assert len(dq.query_nodes_substring(query="e", limit=2)) == 2
    assert dq.count_nodes_substring(query="e") == 4
    assert dq.count_nodes_substring(query="e", claimed=False) == 2
    assert dq.count_nodes_substring(query="a1" * 32) == 1


def test_search_owned_nodes_only_returns_the_callers_nodes(db):
    from backend import discord_queries as dq

    names = {n["adv_name"] for n in dq.search_owned_nodes("111", "e")}
    assert names == {"Gent Rep", "Old Alice"}  # active and inactive, never Bob's or unclaimed
    assert dq.search_owned_nodes("111", "bob") == []
    assert [n["adv_name"] for n in dq.search_owned_nodes("111", "a4" * 32)] == ["Old Alice"]
    assert dq.search_owned_nodes("222", "a4" * 32) == []
    assert len(dq.search_owned_nodes("111")) == 2


def test_unclaimed_suggestions_are_active_and_unclaimed(db):
    from backend import discord_queries as dq

    keys = {n["public_key"] for n in dq.unclaimed_node_suggestions("")}
    assert keys == {"a1" * 32, "a2" * 32}
    assert [n["adv_name"] for n in dq.unclaimed_node_suggestions("two")] == ["Leuven Two"]
    assert [n["adv_name"] for n in dq.unclaimed_node_suggestions("A2A2")] == ["Leuven Two"]
    assert len(dq.unclaimed_node_suggestions("", limit=1)) == 1


def test_city_suggestions_are_active_cities(db):
    from backend import discord_queries as dq

    assert dq.city_suggestions("") == ["Leuven", "Brugge", "Gent"]  # most nodes first
    assert dq.city_suggestions("ge") == ["Gent", "Brugge"]  # starts with the text first
    assert dq.city_suggestions("LEU") == ["Leuven"]
    assert dq.city_suggestions("%") == []


def test_claims_record_their_source(db):
    from backend import discord_queries as dq

    assert dq.update_ownership("a1" * 32, "333", "carol", source="bot")
    assert dq.remove_ownership("a1" * 32, "333", source="web")
    conn = sqlite3.connect(db)
    rows = conn.execute("SELECT action, source FROM node_claims ORDER BY id").fetchall()
    conn.close()
    assert rows == [("claim", "bot"), ("unclaim", "web")]


def test_record_command_writes_a_row_without_arguments(db):
    from backend import discord_queries as dq

    dq.record_command("node claim", "123", ok=True, duration_ms=42)
    dq.record_command("search", "456", ok=False, duration_ms=7)
    conn = sqlite3.connect(db)
    cols = [r[1] for r in conn.execute("PRAGMA table_info(command_log)")]
    rows = conn.execute("SELECT command, user_id, ok, duration_ms, ts FROM command_log ORDER BY id").fetchall()
    conn.close()
    assert cols == ["id", "ts", "command", "user_id", "ok", "duration_ms"]
    assert [r[:4] for r in rows] == [("node claim", "123", 1, 42), ("search", "456", 0, 7)]
    assert rows[0][4].endswith("Z")


def test_migration_is_additive_and_idempotent(tmp_path, monkeypatch):
    """An old database (node_claims without source, no command_log) gains both, twice is fine."""
    import backend.database as dbm
    from backend.migrations import add_command_log

    path = str(tmp_path / "old.db")
    conn = sqlite3.connect(path)
    conn.execute(
        """
        CREATE TABLE node_claims (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            public_key VARCHAR(64) NOT NULL,
            discord_owner_id VARCHAR(20),
            discord_owner_name VARCHAR(100),
            action VARCHAR(10) NOT NULL,
            timestamp TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        )
        """
    )
    conn.execute("INSERT INTO node_claims (public_key, discord_owner_id, action) VALUES ('k', '1', 'claim')")
    conn.commit()
    conn.close()
    monkeypatch.setenv("DATABASE_PATH", path)
    monkeypatch.setattr(dbm, "DATABASE_PATH", path)

    assert add_command_log.main() == 0
    assert add_command_log.main() == 0

    conn = sqlite3.connect(path)
    assert conn.execute("SELECT public_key, action, source FROM node_claims").fetchall() == [("k", "claim", None)]
    assert conn.execute("SELECT COUNT(*) FROM command_log").fetchone() == (0,)
    conn.close()
