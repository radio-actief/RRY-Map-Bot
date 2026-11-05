"""Shared pytest fixtures."""

import os
import sys

import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))


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
