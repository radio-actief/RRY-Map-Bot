"""Our own tools (NodeBook) ask the map server to server, with their secret and the person's
handle, which nodes the person owns or manages (/auth/claimed) and how one node stands for them
(/auth/node), so they don't need Discord ids from the public node list. Partners can't."""

import json
import os
import sqlite3
import sys
from unittest import mock
from urllib.parse import parse_qs, urlsplit

import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

import backend.api.app as app_module  # noqa: E402
import backend.auth as auth  # noqa: E402
import backend.claims as claims  # noqa: E402
import backend.partners as partners  # noqa: E402
import backend.tool_grants as grants  # noqa: E402
from config.site_tools import parse_site_tools  # noqa: E402

ANN, BOB, CAT = '1001', '1002', '1003'
A, B, C, D, E = 'a1' * 32, 'b2' * 32, 'c3' * 32, 'd4' * 32, 'e5' * 32
OWN, OTHER, PARTNER = 'n' * 40, 'o' * 40, 'p' * 40
TOOLS = parse_site_tools(json.dumps([
    {'key': 'nodebook', 'label': 'NodeBook', 'url': 'https://nodebook.example/'},
    {'key': 'meshmate', 'label': 'MeshMate', 'url': 'https://app.example/'},
    {'key': 'analyzer', 'label': 'Analyzer', 'url': 'https://analyzer.example/', 'partner': True},
]))


@pytest.fixture(autouse=True)
def site(monkeypatch, tmp_path):
    monkeypatch.setattr(auth, 'DISCORD_OAUTH2_CLIENT_ID', 'test-client-id')
    monkeypatch.setattr(app_module, 'SITE_TOOLS', TOOLS)
    monkeypatch.setattr(app_module, 'SITE_TOOL_SECRETS', {'nodebook': OWN, 'meshmate': OTHER, 'analyzer': PARTNER})
    monkeypatch.setattr(grants, '_store', None)
    monkeypatch.setattr(grants, 'GRANTS_DIR', str(tmp_path / 'tool-grants'))
    monkeypatch.setattr(partners, 'SUBJECT_KEY', 's' * 48)


@pytest.fixture
def db(temp_db):
    conn = sqlite3.connect(temp_db)
    conn.executemany(
        "INSERT INTO belgian_nodes (public_key, type, adv_name, adv_lat, adv_lon, discord_owner_id, "
        "discord_owner_name, params, source, is_active) VALUES (?, ?, ?, ?, ?, ?, ?, '{}', 'app', ?)",
        [(A, 2, 'Ann relay', 50.8, 4.3, ANN, 'Ann', 1),
         (B, 2, 'Bob relay', 51.0, 4.4, BOB, 'Bob', 1),
         (C, 1, 'Free phone', 50.5, 4.5, None, None, 1),
         (D, 2, 'Gone relay', 50.1, 4.1, ANN, 'Ann', 0)],
    )
    conn.execute("INSERT INTO node_managers (public_key, discord_id, display_name, added_at, added_by) "
                 "VALUES (?, ?, 'Ann', '2026-11-02T09:30:00Z', ?)", (B, ANN, BOB))
    conn.commit()
    conn.close()
    return temp_db


def handle(tool='nodebook', secret=OWN, user_id=ANN):
    c = app_module.app.test_client()
    c.get('/auth/login')
    state = app_module.read_oauth_pending(c.get_cookie(app_module.OAUTH_COOKIE, path='/auth/').value)['state']
    with mock.patch.object(app_module, 'exchange_code_for_token', return_value={'access_token': 't'}), \
         mock.patch.object(app_module, 'get_user_info', return_value={'id': user_id, 'username': 'x', 'global_name': 'X'}), \
         mock.patch.object(auth, 'is_guild_member', return_value=True):
        c.get('/auth/callback', query_string={'code': 'c', 'state': state})
    r = c.get('/auth/authorize', query_string={'tool': tool, 'state': 's'})
    code = parse_qs(urlsplit(r.headers['Location']).query)['code'][0]
    h = app_module.app.test_client().post('/auth/token', json={'tool': tool, 'code': code},
                                          headers={'Authorization': f'Bearer {secret}'}).get_json()['handle']
    return c, h


def ask(path, body, secret=OWN, **headers):
    return app_module.app.test_client().post(path, json=body, headers={'Authorization': f'Bearer {secret}', **headers})


def claimed(h, tool='nodebook', secret=OWN):
    return ask('/auth/claimed', {'tool': tool, 'handle': h}, secret)


def node(h, key, tool='nodebook', secret=OWN):
    return ask('/auth/node', {'tool': tool, 'handle': h, 'public_key': key}, secret)


# /auth/claimed


def test_claimed_lists_the_active_nodes_the_person_owns_or_manages(db):
    _, h = handle()
    r = claimed(h)
    assert r.status_code == 200 and r.headers['Cache-Control'] == 'no-store'
    assert r.get_json() == {'alive': True, 'nodes': [
        {'public_key': A, 'name': 'Ann relay', 'type': 2, 'lat': 50.8, 'lon': 4.3, 'role': 'owner'},
        {'public_key': B, 'name': 'Bob relay', 'type': 2, 'lat': 51.0, 'lon': 4.4, 'role': 'manager'},
    ]}


def test_claimed_for_someone_with_no_nodes_is_an_empty_list(db):
    _, h = handle(user_id=CAT)
    assert claimed(h).get_json() == {'alive': True, 'nodes': []}


# /auth/node


@pytest.mark.parametrize('key, answer', [
    (A, {'alive': True, 'status': 'yours'}),
    (B, {'alive': True, 'status': 'managed'}),
    (C, {'alive': True, 'status': 'unclaimed'}),
    (D, {'alive': True, 'status': 'not_on_map'}),
    (E, {'alive': True, 'status': 'not_on_map'}),
    (A.upper(), {'alive': True, 'status': 'yours'}),
])
def test_node_says_how_one_node_stands_for_the_person(db, key, answer):
    _, h = handle()
    assert node(h, key).get_json() == answer


def test_someone_elses_node_names_the_owner_only_when_they_show_their_name(db):
    _, h = handle(user_id=CAT)
    assert node(h, A).get_json() == {'alive': True, 'status': 'claimed', 'owner_name': 'Ann'}
    claims.save_settings(ANN, show_name=False)
    assert node(h, A).get_json() == {'alive': True, 'status': 'claimed'}


@pytest.mark.parametrize('key', ['zz', '', None, 5, 'a1' * 31])
def test_node_refuses_a_key_that_isnt_one(db, key):
    _, h = handle()
    r = node(h, key)
    assert r.status_code == 400 and r.get_json() == {'error': 'invalid_request'}


def test_no_discord_id_in_either_answer(db):
    _, h = handle(user_id=CAT)
    for r in (claimed(h), node(h, A), node(h, B)):
        for person in (ANN, BOB, CAT):
            assert f'"{person}"' not in r.get_data(as_text=True)


# Who may ask


@pytest.mark.parametrize('path', ['/auth/claimed', '/auth/node'])
def test_a_dead_or_unknown_handle_is_answered_as_alive_answers_it(db, path):
    c, h = handle()
    body = {'tool': 'nodebook', 'public_key': A}
    assert ask(path, {**body, 'handle': 'unknown'}).get_json() == {'alive': False}
    assert ask(path, {**body}).get_json() == {'alive': False}
    c.post('/auth/logout', headers={'Origin': 'http://localhost'})
    r = ask(path, {**body, 'handle': h})
    assert r.status_code == 200 and r.get_json() == {'alive': False}


@pytest.mark.parametrize('path', ['/auth/claimed', '/auth/node'])
def test_a_handle_is_only_for_its_own_tool(db, path):
    _, h = handle()
    assert ask(path, {'tool': 'meshmate', 'handle': h, 'public_key': A}, OTHER).get_json() == {'alive': False}


@pytest.mark.parametrize('path', ['/auth/claimed', '/auth/node'])
def test_a_wrong_secret_is_refused(db, path):
    _, h = handle()
    r = ask(path, {'tool': 'nodebook', 'handle': h, 'public_key': A}, OTHER)
    assert r.status_code == 401


@pytest.mark.parametrize('path', ['/auth/claimed', '/auth/node'])
def test_a_call_from_a_browser_is_refused(db, path):
    _, h = handle()
    r = ask(path, {'tool': 'nodebook', 'handle': h, 'public_key': A}, Origin='https://nodebook.example')
    assert r.status_code == 400
    c = app_module.app.test_client()
    c.set_cookie('bemesh_map_session', 'x')
    r = c.post(path, json={'tool': 'nodebook', 'handle': h, 'public_key': A}, headers={'Authorization': f'Bearer {OWN}'})
    assert r.status_code == 400


@pytest.mark.parametrize('path', ['/auth/claimed', '/auth/node'])
def test_partners_cant_ask(db, path):
    partners.grant_consent(ANN, 'analyzer')
    _, h = handle(tool='analyzer', secret=PARTNER)
    r = ask(path, {'tool': 'analyzer', 'handle': h, 'public_key': A}, PARTNER)
    assert r.status_code == 403 and r.get_json() == {'error': 'unauthorized_client'}
