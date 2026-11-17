"""Managers: an owner invites people with a one-time link (random token, kept hashed, 7 days, one
use); the recipient signs in (members of the #BEmesh server only) and accepts. The owner can remove
a manager, a manager can leave, and unclaiming the node ends its managers and open invitations."""

import os
import sqlite3
import sys
from datetime import datetime, timedelta, timezone
from unittest import mock
from urllib.parse import unquote

import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

import backend.api.app as app_module  # noqa: E402
import backend.auth as auth  # noqa: E402
import backend.claims as claims  # noqa: E402

ORIGIN = {'Origin': 'http://localhost'}
ANN, BOB, CAT = '1001', '1002', '1003'
NODE = 'a1' * 32
OTHER = 'b2' * 32


@pytest.fixture(autouse=True)
def site(monkeypatch):
    monkeypatch.setattr(auth, 'DISCORD_OAUTH2_CLIENT_ID', 'test-client-id')
    monkeypatch.setattr(app_module, 'SITE_TOOLS', [])
    monkeypatch.setattr(app_module, 'SITE_TOOL_SECRETS', {})
    # Membership as Discord's bot answers it: everyone but CAT-not-member tests' own patch.
    monkeypatch.setattr(app_module, 'verify_guild_membership_bot', lambda user_id: True)


@pytest.fixture
def db(temp_db):
    conn = sqlite3.connect(temp_db)
    conn.executemany(
        "INSERT INTO belgian_nodes (public_key, type, adv_name, adv_lat, adv_lon, discord_owner_id, "
        "discord_owner_name, params, source, is_active) VALUES (?, ?, ?, 50.8, 4.3, ?, ?, '{}', 'app', 1)",
        [(NODE, 2, 'Ann relay', ANN, 'Ann'), (OTHER, 2, 'Bob relay', BOB, 'Bob')],
    )
    conn.commit()
    conn.close()
    return temp_db


def client():
    return app_module.app.test_client()


def sign_in(user_id, name, member=True):
    c = client()
    c.get('/auth/login')
    state = app_module.read_oauth_pending(c.get_cookie(app_module.OAUTH_COOKIE, path='/auth/').value)['state']
    with mock.patch.object(app_module, 'exchange_code_for_token', return_value={'access_token': 't'}), \
         mock.patch.object(app_module, 'get_user_info',
                           return_value={'id': user_id, 'username': name.lower(), 'global_name': name}), \
         mock.patch.object(auth, 'is_guild_member', return_value=member):
        c.get('/auth/callback', query_string={'code': 'c', 'state': state})
    return c


def invite(c, key=NODE):
    return c.post(f'/api/v1/nodes/{key}/invites', headers=ORIGIN)


def made_invite(c):
    r = invite(c)
    assert r.status_code == 200, r.get_data(as_text=True)
    return r.get_json()['path']


def history(db_path, action):
    conn = sqlite3.connect(db_path)
    rows = conn.execute("SELECT public_key, discord_owner_id, discord_owner_name, source FROM node_claims "
                        "WHERE action = ? ORDER BY id", (action,)).fetchall()
    conn.close()
    return rows


def account_nodes(c):
    return c.get('/api/v1/account').get_json()['nodes']


# Making an invitation


def test_the_owner_gets_a_one_time_link_valid_for_seven_days(db):
    ann = sign_in(ANN, 'Ann')
    r = invite(ann)
    assert r.status_code == 200 and r.headers['Cache-Control'] == 'no-store'
    body = r.get_json()
    token = body['path'][len('/invite/'):]
    assert body['path'].startswith('/invite/') and len(token) >= 43
    expires = datetime.strptime(body['expires_at'], '%Y-%m-%dT%H:%M:%SZ').replace(tzinfo=timezone.utc)
    assert timedelta(days=6, hours=23) < expires - datetime.now(timezone.utc) <= timedelta(days=7)
    # Kept hashed only.
    stored = sqlite3.connect(db).execute("SELECT token_hash FROM manager_invites").fetchall()
    assert len(stored) == 1 and stored[0][0] != token and token not in stored[0][0]


def test_only_the_owner_can_invite(db):
    assert invite(client()).status_code == 401
    assert invite(sign_in(BOB, 'Bob')).status_code == 403
    assert invite(sign_in(ANN, 'Ann'), key='zz').status_code == 400


def test_a_manager_cannot_invite_others(db):
    path = made_invite(sign_in(ANN, 'Ann'))
    bob = sign_in(BOB, 'Bob')
    bob.post(path, headers=ORIGIN)
    assert invite(bob).status_code == 403


def test_open_invitations_per_node_are_limited(db, monkeypatch):
    monkeypatch.setattr(claims, 'MAX_OPEN_INVITES', 2)
    ann = sign_in(ANN, 'Ann')
    assert invite(ann).status_code == 200
    assert invite(ann).status_code == 200
    r = invite(ann)
    assert r.status_code == 429 and r.get_json()['error'] == 'too_many_invites'


def test_invitations_come_from_the_maps_own_pages_only(db):
    ann = sign_in(ANN, 'Ann')
    assert ann.post(f'/api/v1/nodes/{NODE}/invites', headers={'Origin': 'https://evil.example'}).status_code == 403


# Opening and accepting it


def test_signed_out_the_link_signs_in_first_and_comes_back(db):
    path = made_invite(sign_in(ANN, 'Ann'))
    c = client()
    r = c.get(path)
    assert r.status_code == 302
    assert unquote(r.headers['Location']) == '/auth/login?next=' + path
    c.get(r.headers['Location'])
    pending = app_module.read_oauth_pending(c.get_cookie(app_module.OAUTH_COOKIE, path='/auth/').value)
    assert pending['next'] == path


def test_the_page_asks_become_manager_of_the_node(db):
    path = made_invite(sign_in(ANN, 'Ann'))
    r = sign_in(BOB, 'Bob').get(path, headers={'Accept-Language': 'en'})
    assert r.status_code == 200 and r.mimetype == 'text/html'
    html = r.get_data(as_text=True)
    assert '<h1>Become manager of Ann relay?</h1>' in html
    assert f'<form method="post" action="{path}">' in html
    assert '<header class="topbar">' in html
    assert r.headers['Referrer-Policy'] == 'same-origin'
    assert r.headers['Cache-Control'] == 'no-store'


@pytest.mark.parametrize('lang, title', [('nl', 'Beheerder worden van Ann relay?'),
                                         ('fr', 'Devenir gestionnaire de Ann relay ?')])
def test_the_page_speaks_the_visitors_language(db, lang, title):
    path = made_invite(sign_in(ANN, 'Ann'))
    html = sign_in(BOB, 'Bob').get(path + f'?lang={lang}').get_data(as_text=True)
    assert f'<h1>{title}</h1>' in html


def test_accepting_makes_a_manager_and_goes_to_my_nodes(db):
    ann = sign_in(ANN, 'Ann')
    path = made_invite(ann)
    bob = sign_in(BOB, 'Bob')
    r = bob.post(path, headers=ORIGIN)
    assert r.status_code == 302 and r.headers['Location'] == '/account#my-nodes'
    assert [(n['public_key'], n['role']) for n in account_nodes(bob)] == [(OTHER, 'owner'), (NODE, 'manager')]
    managed = [n for n in account_nodes(bob) if n['role'] == 'manager'][0]
    assert 'managers' not in managed
    owned = account_nodes(ann)[0]
    assert owned['role'] == 'owner'
    assert [m['name'] for m in owned['managers']] == ['Bob']
    assert BOB not in ann.get('/api/v1/account').get_data(as_text=True)
    assert history(db, 'manager_add') == [(NODE, BOB, 'Bob', 'web')]


def test_an_invitation_works_once(db):
    path = made_invite(sign_in(ANN, 'Ann'))
    sign_in(BOB, 'Bob').post(path, headers=ORIGIN)
    cat = sign_in(CAT, 'Cat')
    r = cat.get(path, headers={'Accept-Language': 'en'})
    assert r.status_code == 404
    assert 'This invitation no longer works' in r.get_data(as_text=True)
    assert cat.post(path, headers=ORIGIN).status_code == 404
    assert claims.role_of(NODE, CAT) is None


def test_an_invitation_expires_after_seven_days(db):
    path = made_invite(sign_in(ANN, 'Ann'))
    conn = sqlite3.connect(db)
    conn.execute("UPDATE manager_invites SET expires_at = '2020-01-01T00:00:00Z'")
    conn.commit()
    conn.close()
    bob = sign_in(BOB, 'Bob')
    assert bob.get(path).status_code == 404
    assert bob.post(path, headers=ORIGIN).status_code == 404
    assert claims.role_of(NODE, BOB) is None


def test_the_owner_opening_their_own_link_doesnt_use_it(db):
    ann = sign_in(ANN, 'Ann')
    path = made_invite(ann)
    r = ann.get(path, headers={'Accept-Language': 'en'})
    assert 'This is your own node' in r.get_data(as_text=True)
    assert ann.post(path, headers=ORIGIN).status_code == 200
    assert claims.role_of(NODE, ANN) == 'owner'
    sign_in(BOB, 'Bob').post(path, headers=ORIGIN)
    assert claims.role_of(NODE, BOB) == 'manager'


def test_someone_who_manages_already_keeps_the_link_open_for_another(db):
    ann = sign_in(ANN, 'Ann')
    sign_in(BOB, 'Bob').post(made_invite(ann), headers=ORIGIN)
    path = made_invite(ann)
    bob = sign_in(BOB, 'Bob')
    assert 'You already manage Ann relay' in bob.get(path, headers={'Accept-Language': 'en'}).get_data(as_text=True)
    sign_in(CAT, 'Cat').post(path, headers=ORIGIN)
    assert claims.role_of(NODE, CAT) == 'manager'


def test_an_invitation_ends_when_the_node_changes_owner(db):
    path = made_invite(sign_in(ANN, 'Ann'))
    conn = sqlite3.connect(db)
    conn.execute("UPDATE belgian_nodes SET discord_owner_id = ?, discord_owner_name = 'Cat' WHERE public_key = ?", (CAT, NODE))
    conn.commit()
    conn.close()
    assert sign_in(BOB, 'Bob').post(path, headers=ORIGIN).status_code == 404
    assert claims.role_of(NODE, BOB) is None


def test_a_person_not_on_the_server_is_refused(db, monkeypatch):
    path = made_invite(sign_in(ANN, 'Ann'))
    outsider = sign_in(CAT, 'Cat', member=False)
    r = outsider.get(path, headers={'Accept-Language': 'en'})
    assert r.status_code == 403
    assert 'Only members of the #BEmesh Discord server can manage nodes' in r.get_data(as_text=True)
    # The real-time check on accepting, as when claiming.
    member_then = sign_in(CAT, 'Cat')
    monkeypatch.setattr(app_module, 'verify_guild_membership_bot', lambda user_id: False)
    assert member_then.post(path, headers=ORIGIN).status_code == 403
    assert claims.role_of(NODE, CAT) is None
    monkeypatch.setattr(app_module, 'verify_guild_membership_bot', lambda user_id: True)
    sign_in(BOB, 'Bob').post(path, headers=ORIGIN)
    assert claims.role_of(NODE, BOB) == 'manager'


def test_accepting_comes_from_the_invitation_page_only(db):
    path = made_invite(sign_in(ANN, 'Ann'))
    r = sign_in(BOB, 'Bob').post(path, headers={'Origin': 'https://evil.example'})
    assert r.status_code == 403
    assert claims.role_of(NODE, BOB) is None


@pytest.mark.parametrize('path', ['/invite/short', '/invite/' + 'x' * 43])
def test_an_odd_or_unknown_link_says_it_no_longer_works(db, path):
    r = sign_in(BOB, 'Bob').get(path, headers={'Accept-Language': 'en'})
    assert r.status_code == 404
    assert 'This invitation no longer works' in r.get_data(as_text=True)


# Removing and leaving


def _bob_manages(db):
    ann = sign_in(ANN, 'Ann')
    bob = sign_in(BOB, 'Bob')
    bob.post(made_invite(ann), headers=ORIGIN)
    return ann, bob, account_nodes(ann)[0]['managers'][0]['id']


def test_the_owner_removes_a_manager(db):
    ann, bob, mid = _bob_manages(db)
    r = ann.post(f'/api/v1/nodes/{NODE}/managers/{mid}/remove', headers=ORIGIN)
    assert r.status_code == 200
    assert claims.role_of(NODE, BOB) is None
    assert account_nodes(ann)[0]['managers'] == []
    assert history(db, 'manager_remove') == [(NODE, BOB, 'Bob', 'web')]
    assert ann.post(f'/api/v1/nodes/{NODE}/managers/{mid}/remove', headers=ORIGIN).status_code == 404


def test_only_the_owner_removes_managers(db):
    ann, bob, mid = _bob_manages(db)
    assert bob.post(f'/api/v1/nodes/{NODE}/managers/{mid}/remove', headers=ORIGIN).status_code == 403
    assert sign_in(CAT, 'Cat').post(f'/api/v1/nodes/{NODE}/managers/{mid}/remove', headers=ORIGIN).status_code == 403
    assert client().post(f'/api/v1/nodes/{NODE}/managers/{mid}/remove', headers=ORIGIN).status_code == 401
    assert claims.role_of(NODE, BOB) == 'manager'


def test_a_manager_of_another_node_cant_be_removed_through_this_one(db):
    ann, bob, mid = _bob_manages(db)
    assert bob.post(f'/api/v1/nodes/{OTHER}/managers/{mid}/remove', headers=ORIGIN).status_code == 404
    assert claims.role_of(NODE, BOB) == 'manager'


def test_a_manager_leaves(db):
    ann, bob, mid = _bob_manages(db)
    assert bob.post(f'/api/v1/nodes/{NODE}/leave', headers=ORIGIN).status_code == 200
    assert claims.role_of(NODE, BOB) is None
    assert bob.post(f'/api/v1/nodes/{NODE}/leave', headers=ORIGIN).status_code == 404
    # The owner can't "leave" their own node: they unclaim it.
    assert ann.post(f'/api/v1/nodes/{NODE}/leave', headers=ORIGIN).status_code == 404
    assert claims.role_of(NODE, ANN) == 'owner'


def test_unclaiming_ends_the_managers_and_open_invitations(db):
    ann, bob, mid = _bob_manages(db)
    path = made_invite(ann)
    with mock.patch.object(app_module, 'notify_node_unclaimed'):
        assert ann.post(f'/api/v1/nodes/{NODE}/unclaim', headers=ORIGIN).status_code == 200
    assert claims.role_of(NODE, BOB) is None
    assert sqlite3.connect(db).execute("SELECT COUNT(*) FROM manager_invites").fetchone()[0] == 0
    assert history(db, 'manager_remove') == [(NODE, BOB, 'Bob', 'web')]
    assert sign_in(CAT, 'Cat').post(path, headers=ORIGIN).status_code == 404


def test_the_map_learns_the_roles_of_the_signed_in_person(db):
    ann, bob, mid = _bob_manages(db)
    r = bob.get('/api/v1/my-node-roles')
    assert r.headers['Cache-Control'] == 'no-store'
    assert r.get_json() == {'roles': {OTHER: 'owner', NODE: 'manager'}}
    assert client().get('/api/v1/my-node-roles').get_json() == {'roles': {}}
