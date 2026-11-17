"""No Discord id in anything a visitor can read without signing in: every GET route of the map,
filled with the ids of owners and managers, is scanned. Signed-in members of the #BEmesh server
get an owner's id for the popup's message link, only when that owner shows their name."""

import json
import os
import re
import sqlite3
import sys
from unittest import mock

import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

import backend.api.app as app_module  # noqa: E402
import backend.auth as auth  # noqa: E402
import backend.claims as claims  # noqa: E402

ANN, BOB, CAT = '381234567890123456', '381234567890123457', '381234567890123458'
A, B = 'a1' * 32, 'b2' * 32
SAMPLE = {'public_key': A, 'token': 'x' * 43, 'key': 'analyzer', 'manager_id': '1', 'path': 'index.html'}


@pytest.fixture(autouse=True)
def site(monkeypatch):
    monkeypatch.setattr(auth, 'DISCORD_OAUTH2_CLIENT_ID', 'test-client-id')
    monkeypatch.setattr(app_module, 'SITE_TOOLS', [])
    monkeypatch.setattr(app_module, 'SITE_TOOL_SECRETS', {})


@pytest.fixture
def db(temp_db, monkeypatch):
    monkeypatch.setattr(app_module, 'DATABASE_PATH', temp_db)
    conn = sqlite3.connect(temp_db)
    owner_data = json.dumps({'adv_lat': 50.8, 'adv_lon': 4.3, 'adv_name': 'Ann relay', 'type': 2,
                             'discord_owner_id': ANN, 'discord_owner_name': 'Ann'})
    conn.executemany(
        "INSERT INTO belgian_nodes (public_key, type, adv_name, adv_lat, adv_lon, discord_owner_id, discord_owner_name, "
        "params, source, is_active, inserted_date, last_advert) VALUES (?, 2, ?, 50.8, 4.3, ?, ?, '{}', 'app', 1, "
        "'2026-10-01T08:00:00Z', '2026-11-16T08:00:00Z')",
        [(A, 'Ann relay', ANN, 'Ann'), (B, 'Bob relay', BOB, 'Bob')],
    )
    for change in ('added', 'updated', 'removed', 'restored'):
        conn.execute("INSERT INTO node_changes (public_key, change_type, sync_date, old_data, new_data) "
                     "VALUES (?, ?, '2026-11-01T08:00:00Z', ?, ?)", (A, change, owner_data, owner_data))
    conn.execute("INSERT INTO sync_history (sync_date, nodes_updated, details) VALUES ('2026-11-01T08:00:00Z', 1, ?)",
                 (json.dumps({'updated': [{'public_key': A, 'discord_owner_id': ANN}]}),))
    conn.execute("INSERT INTO node_claims (public_key, discord_owner_id, discord_owner_name, action) VALUES (?, ?, 'Ann', 'claim')", (A, ANN))
    conn.execute("INSERT INTO node_managers (public_key, discord_id, display_name, added_at) VALUES (?, ?, 'Cat', '2026-11-02T09:30:00Z')", (A, CAT))
    conn.commit()
    conn.close()
    return temp_db


def get_routes():
    """Every GET route as a visitor can call it, its <parts> filled with sample values."""
    urls = []
    for rule in app_module.app.url_map.iter_rules():
        if 'GET' not in rule.methods or rule.endpoint == 'static':
            continue
        url = re.sub(r'<(?:[a-z]+:)?([a-z_]+)>', lambda m: SAMPLE[m.group(1)], rule.rule)
        urls.append(url)
    return sorted(set(urls))


def test_the_scan_covers_the_public_answers():
    urls = get_routes()
    for url in ('/api/v1/belgian-nodes', '/api/v1/node-changes', '/api/v1/sync-history', '/api/v1/stats',
                '/api/v1/config', '/api/v1/repeaters/contacts', f'/api/v1/nodes/{A}/ownership', '/auth/me'):
        assert url in urls


def test_no_discord_id_in_any_answer_to_a_visitor(db):
    c = app_module.app.test_client()
    for url in get_routes():
        r = c.get(url)
        text = '\n'.join(f'{k}: {v}' for k, v in r.headers.items()) + '\n' + r.get_data(as_text=True)
        for person in (ANN, BOB, CAT):
            assert person not in text, url


def test_the_node_list_says_claimed_and_names_but_holds_no_id(db):
    nodes = {n['public_key']: n for n in app_module.app.test_client().get('/api/v1/belgian-nodes').get_json()}
    assert 'discord_owner_id' not in nodes[A]
    assert nodes[A]['claimed'] is True and nodes[A]['discord_owner_name'] == 'Ann'


def sign_in(user_id, member=True):
    c = app_module.app.test_client()
    c.get('/auth/login')
    state = app_module.read_oauth_pending(c.get_cookie(app_module.OAUTH_COOKIE, path='/auth/').value)['state']
    with mock.patch.object(app_module, 'exchange_code_for_token', return_value={'access_token': 't'}), \
         mock.patch.object(app_module, 'get_user_info', return_value={'id': user_id, 'username': 'x', 'global_name': 'X'}), \
         mock.patch.object(auth, 'is_guild_member', return_value=member):
        c.get('/auth/callback', query_string={'code': 'c', 'state': state})
    return c


def ownership(c, key=A):
    return c.get(f'/api/v1/nodes/{key}/ownership')


def test_a_signed_in_member_gets_the_owners_id_for_the_message_link(db):
    r = ownership(sign_in(BOB))
    assert r.headers['Cache-Control'] == 'no-store'
    assert r.get_json() == {'owned': False, 'role': None, 'authenticated': True, 'owner_discord_id': ANN}


def test_no_id_when_the_owner_hides_their_name(db):
    claims.save_settings(ANN, show_name=False)
    assert 'owner_discord_id' not in ownership(sign_in(BOB)).get_json()


def test_no_id_for_someone_not_on_the_server_or_signed_out(db):
    assert 'owner_discord_id' not in ownership(sign_in(BOB, member=False)).get_json()
    assert ownership(app_module.app.test_client()).get_json() == {'owned': False, 'authenticated': False}


def test_the_owner_and_a_manager_see_their_role(db):
    assert ownership(sign_in(ANN)).get_json() == {'owned': True, 'role': 'owner', 'authenticated': True}
    answer = ownership(sign_in(CAT)).get_json()
    assert answer['role'] == 'manager' and answer['owned'] is False


def test_an_odd_key_gets_no_role_and_no_id(db):
    assert ownership(sign_in(BOB), key='zz').get_json() == {'owned': False, 'role': None, 'authenticated': True}
