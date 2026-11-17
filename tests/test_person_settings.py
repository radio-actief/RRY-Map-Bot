"""Each person's two choices on the account page: "Show my name with my nodes" and "Share my nodes
with partner tools", both on until the person switches them off, kept server-side by Discord id."""

import os
import sqlite3
import sys
from unittest import mock

import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

import backend.api.app as app_module  # noqa: E402
import backend.auth as auth  # noqa: E402
import backend.claims as claims  # noqa: E402

ORIGIN = {'Origin': 'http://localhost'}
ANN, BOB = '1001', '1002'


@pytest.fixture(autouse=True)
def site(monkeypatch):
    monkeypatch.setattr(auth, 'DISCORD_OAUTH2_CLIENT_ID', 'test-client-id')
    monkeypatch.setattr(app_module, 'SITE_TOOLS', [])
    monkeypatch.setattr(app_module, 'SITE_TOOL_SECRETS', {})


@pytest.fixture
def db(temp_db):
    conn = sqlite3.connect(temp_db)
    conn.executemany(
        "INSERT INTO belgian_nodes (public_key, type, adv_name, adv_lat, adv_lon, discord_owner_id, "
        "discord_owner_name, params, source, is_active) VALUES (?, ?, ?, 50.8, 4.3, ?, ?, '{}', 'app', 1)",
        [('a1' * 32, 2, 'Ann relay', ANN, 'Ann'),
         ('b2' * 32, 2, 'Bob relay', BOB, 'Bob'),
         ('c3' * 32, 2, 'Free relay', None, None)],
    )
    conn.commit()
    conn.close()
    return temp_db


def client():
    return app_module.app.test_client()


def sign_in(c, user_id=ANN, name='Ann'):
    c.get('/auth/login')
    state = app_module.read_oauth_pending(c.get_cookie(app_module.OAUTH_COOKIE, path='/auth/').value)['state']
    with mock.patch.object(app_module, 'exchange_code_for_token', return_value={'access_token': 't'}), \
         mock.patch.object(app_module, 'get_user_info',
                           return_value={'id': user_id, 'username': name.lower(), 'global_name': name}), \
         mock.patch.object(auth, 'is_guild_member', return_value=True):
        c.get('/auth/callback', query_string={'code': 'c', 'state': state})
    return c


def public_nodes():
    return {n['public_key']: n for n in client().get('/api/v1/belgian-nodes').get_json()}


def test_both_choices_are_on_until_the_person_changes_them(db):
    assert claims.get_settings(ANN) == {'show_name': True, 'share_partners': True}
    c = sign_in(client())
    assert c.get('/api/v1/account').get_json()['settings'] == {'show_name': True, 'share_partners': True}


def test_a_choice_is_kept_per_person_and_the_other_one_stays(db):
    c = sign_in(client())
    r = c.post('/api/v1/account/settings', json={'show_name': False}, headers=ORIGIN)
    assert r.status_code == 200 and r.headers['Cache-Control'] == 'no-store'
    assert r.get_json()['settings'] == {'show_name': False, 'share_partners': True}
    c.post('/api/v1/account/settings', json={'share_partners': False}, headers=ORIGIN)
    assert claims.get_settings(ANN) == {'show_name': False, 'share_partners': False}
    assert claims.get_settings(BOB) == {'show_name': True, 'share_partners': True}
    assert c.get('/api/v1/account').get_json()['settings'] == {'show_name': False, 'share_partners': False}


@pytest.mark.parametrize('body', [None, [], {}, {'show_name': 'no'}, {'share_partners': 0}, {'other': True}])
def test_odd_choices_are_refused(db, body):
    c = sign_in(client())
    r = c.post('/api/v1/account/settings', json=body, headers=ORIGIN)
    assert r.status_code == 400
    assert claims.get_settings(ANN) == {'show_name': True, 'share_partners': True}


def test_signed_out_or_from_another_site_nothing_changes(db):
    assert client().post('/api/v1/account/settings', json={'show_name': False}, headers=ORIGIN).status_code == 401
    c = sign_in(client())
    r = c.post('/api/v1/account/settings', json={'show_name': False}, headers={'Origin': 'https://evil.example'})
    assert r.status_code == 403
    assert claims.get_settings(ANN)['show_name'] is True


def test_the_public_list_says_claimed_and_names_only_who_shows_their_name(db):
    nodes = public_nodes()
    assert nodes['a1' * 32]['claimed'] is True and nodes['a1' * 32]['discord_owner_name'] == 'Ann'
    assert nodes['c3' * 32]['claimed'] is False and nodes['c3' * 32]['discord_owner_name'] is None
    claims.save_settings(ANN, show_name=False)
    nodes = public_nodes()
    assert nodes['a1' * 32]['claimed'] is True
    assert nodes['a1' * 32]['discord_owner_name'] is None
    assert nodes['b2' * 32]['discord_owner_name'] == 'Bob'
    claims.save_settings(ANN, show_name=True)
    assert public_nodes()['a1' * 32]['discord_owner_name'] == 'Ann'


def test_the_migration_adds_the_table_and_can_run_twice(tmp_path, monkeypatch):
    from backend.migrations import add_claims_privacy
    db_path = str(tmp_path / 'old.db')
    sqlite3.connect(db_path).close()
    monkeypatch.setenv('DATABASE_PATH', db_path)
    assert add_claims_privacy.main() == 0
    assert add_claims_privacy.main() == 0
    tables = {r[0] for r in sqlite3.connect(db_path).execute("SELECT name FROM sqlite_master WHERE type='table'")}
    assert 'person_settings' in tables
