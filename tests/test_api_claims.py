"""Website claim and unclaim record ``source='web'`` in ``node_claims``."""

import sqlite3

import pytest


@pytest.fixture
def client(temp_db, monkeypatch):
    import backend.api.app as api

    conn = sqlite3.connect(temp_db)
    conn.execute(
        """
        INSERT INTO belgian_nodes (public_key, type, adv_name, city, params, source, is_active)
        VALUES (?, 2, 'Web Node', 'Leuven', '{}', 'app', 1)
        """,
        ("c1" * 32,),
    )
    conn.commit()
    conn.close()
    monkeypatch.setattr(api, "verify_guild_membership_bot", lambda user_id: True)
    monkeypatch.setattr(api, "notify_node_claimed", lambda *a, **k: True)
    monkeypatch.setattr(api, "notify_node_unclaimed", lambda *a, **k: True)
    c = api.app.test_client()
    with c.session_transaction() as sess:
        sess["user_id"] = "777"
        sess["username"] = "webuser"
    return c


def test_web_claim_and_unclaim_are_logged_as_web(client, temp_db):
    pk = "c1" * 32
    assert client.post(f"/api/v1/nodes/{pk}/claim").status_code == 200
    assert client.post(f"/api/v1/nodes/{pk}/unclaim").status_code == 200
    conn = sqlite3.connect(temp_db)
    rows = conn.execute("SELECT action, discord_owner_id, source FROM node_claims ORDER BY id").fetchall()
    conn.close()
    assert rows == [("claim", "777", "web"), ("unclaim", "777", "web")]
