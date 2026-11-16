"""Shared pytest fixtures."""

import os
import sys

import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))


@pytest.fixture(autouse=True)
def _sign_in_records(tmp_path, monkeypatch):
    """Sign-ins made by a test are recorded in its own folder, never in the data directory."""
    import backend.account_sessions as account_sessions

    monkeypatch.setattr(account_sessions, "_store", None)
    monkeypatch.setattr(account_sessions, "INDEX_DIR", str(tmp_path / "session-index"))


@pytest.fixture
def temp_db(tmp_path, monkeypatch):
    """Point the backend at a fresh, initialised SQLite DB in ``tmp_path``.

    ``DATABASE_PATH`` (env) wins over the module default in
    ``backend.database.get_db_path``, so both are pinned. Returns the DB path.
    """
    import backend.database as dbm

    db_path = str(tmp_path / "belgian_nodes.db")
    monkeypatch.setenv("DATABASE_PATH", db_path)
    monkeypatch.setattr(dbm, "DATABASE_PATH", db_path)
    dbm.init_database()
    return db_path
