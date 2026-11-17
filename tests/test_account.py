"""The site's one account page on the map (/account and GET /api/v1/account), and "Log out
everywhere": every map session of the person ends, on every device, with the tool handles that
point at those sessions."""

import json
import os
import sqlite3
import sys
from html.parser import HTMLParser
from unittest import mock
from urllib.parse import parse_qs, urlsplit

import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

import backend.account_sessions as account_sessions  # noqa: E402
import backend.api.app as app_module  # noqa: E402
import backend.auth as auth  # noqa: E402
import backend.tool_grants as grants  # noqa: E402

ROOT = os.path.join(os.path.dirname(__file__), '..')
ORIGIN = {'Origin': 'http://localhost'}
TOOLS = [
    {'key': 'nodebook', 'label': 'NodeBook', 'url': 'https://nodebook.example/'},
    {'key': 'meshmate', 'label': 'MeshMate', 'url': 'https://app.example/'},
    {'key': 'hiddenone', 'label': 'Hidden', 'url': 'https://hidden.example/', 'hidden': True},
]
SECRET = 'n' * 40


@pytest.fixture(autouse=True)
def site(monkeypatch, tmp_path):
    monkeypatch.setattr(auth, 'DISCORD_OAUTH2_CLIENT_ID', 'test-client-id')
    monkeypatch.setattr(app_module, 'SITE_TOOLS', TOOLS)
    monkeypatch.setattr(app_module, 'SITE_TOOL_SECRETS', {'nodebook': SECRET})
    monkeypatch.setattr(grants, '_store', None)
    monkeypatch.setattr(grants, 'GRANTS_DIR', str(tmp_path / 'tool-grants'))
    monkeypatch.setattr(account_sessions, '_store', None)
    monkeypatch.setattr(account_sessions, 'INDEX_DIR', str(tmp_path / 'session-index'))


@pytest.fixture
def db(temp_db):
    conn = sqlite3.connect(temp_db)
    rows = [
        ('a1' * 32, 2, 'Leuven <Rptr>', '42', 'Ann', 1),
        ('b2' * 32, 1, 'Ann phone', '42', 'Ann', 1),
        ('c3' * 32, 2, 'Old one', '42', 'Ann', 0),
        ('d4' * 32, 2, 'Bob relay', '43', 'Bob', 1),
        ('e5' * 32, 3, 'Nobody room', None, None, 1),
    ]
    conn.executemany(
        "INSERT INTO belgian_nodes (public_key, type, adv_name, discord_owner_id, discord_owner_name, "
        "params, source, is_active) VALUES (?, ?, ?, ?, ?, '{}', 'app', ?)",
        rows,
    )
    conn.commit()
    conn.close()
    return temp_db


def client():
    return app_module.app.test_client()


def sign_in(c, user_id='42', global_name='Ann', username='ann'):
    """A full map sign-in through the (stand-in) Discord round trip."""
    c.get('/auth/login')
    state = app_module.read_oauth_pending(c.get_cookie(app_module.OAUTH_COOKIE, path='/auth/').value)['state']
    with mock.patch.object(app_module, 'exchange_code_for_token', return_value={'access_token': 't'}), \
         mock.patch.object(app_module, 'get_user_info',
                           return_value={'id': user_id, 'username': username, 'global_name': global_name}), \
         mock.patch.object(auth, 'is_guild_member', return_value=True):
        c.get('/auth/callback', query_string={'code': 'c', 'state': state})
    return c


def signed_in(c):
    return c.get('/auth/me').get_json()['authenticated']


def handle_for(c):
    r = c.get('/auth/authorize', query_string={'tool': 'nodebook', 'state': 's1'})
    code = parse_qs(urlsplit(r.headers['Location']).query)['code'][0]
    return client().post('/auth/token', json={'tool': 'nodebook', 'code': code},
                         headers={'Authorization': f'Bearer {SECRET}'}).get_json()['handle']


def alive(handle):
    return client().post('/auth/alive', json={'tool': 'nodebook', 'handle': handle},
                         headers={'Authorization': f'Bearer {SECRET}'}).get_json()


# The page


def test_signed_out_the_account_page_sends_to_sign_in_and_back():
    r = client().get('/account')
    assert r.status_code == 302
    assert r.headers['Location'] == '/auth/login?next=/account'


def test_sign_in_may_return_to_the_account_page():
    c = client()
    c.get('/auth/login?next=/account')
    pending = app_module.read_oauth_pending(c.get_cookie(app_module.OAUTH_COOKIE, path='/auth/').value)
    assert pending['next'] == '/account'


def test_signed_in_the_account_page_is_served_on_the_page_policy():
    c = sign_in(client())
    r = c.get('/account')
    assert r.status_code == 200 and r.mimetype == 'text/html'
    assert r.headers['Cache-Control'] == 'no-store'
    assert r.headers['Cross-Origin-Opener-Policy'] == 'same-origin'
    policy = r.headers['Content-Security-Policy']
    assert "script-src 'self'" in policy and "'unsafe-inline'" not in policy.split('script-src')[1].split(';')[0]
    html = r.get_data(as_text=True)
    assert '<header class="topbar">' in html
    assert 'src="/src/account.js"' in html or 'src="./src/account.js"' in html


def test_the_page_file_is_only_served_through_its_route():
    c = sign_in(client())
    assert c.get('/account.html').status_code == 404


class _Inline(HTMLParser):
    def __init__(self):
        super().__init__()
        self.found = []

    def handle_starttag(self, tag, attrs):
        if tag == 'script' and not dict(attrs).get('src'):
            self.found.append('inline <script>')
        self.found += [f'{tag} {n}' for n, _ in attrs if n.startswith('on')]


def test_the_page_has_no_inline_script_and_logs_out_by_post_only():
    html = open(os.path.join(ROOT, 'account.html'), encoding='utf-8').read()
    parser = _Inline()
    parser.feed(html)
    assert parser.found == []
    assert '<form method="post" action="/auth/logout">' in html
    assert '<form method="post" action="/auth/logout-everywhere">' in html


# The page's data


def test_signed_out_the_account_data_is_refused():
    r = client().get('/api/v1/account')
    assert r.status_code == 401
    assert r.headers['Cache-Control'] == 'no-store'


def test_the_account_data_names_the_person_and_their_active_nodes(db):
    c = sign_in(client())
    r = c.get('/api/v1/account')
    assert r.status_code == 200
    assert r.headers['Cache-Control'] == 'no-store'
    body = r.get_json()
    assert body['name'] == 'Ann'
    assert body['nodes'] == [
        {'public_key': 'b2' * 32, 'name': 'Ann phone', 'type': 1},
        {'public_key': 'a1' * 32, 'name': 'Leuven <Rptr>', 'type': 2},
    ]


def test_the_account_data_never_holds_the_discord_id(db):
    c = sign_in(client(), user_id='42424242424242')
    text = c.get('/api/v1/account').get_data(as_text=True)
    assert '42424242424242' not in text
    assert set(json.loads(text)) == {'name', 'nodes', 'tools', 'settings'}


def test_without_a_display_name_the_user_name_is_shown(db):
    c = sign_in(client(), global_name=None, username='plainann')
    assert c.get('/api/v1/account').get_json()['name'] == 'plainann'


def test_a_person_without_claimed_nodes_gets_an_empty_list(db):
    c = sign_in(client(), user_id='99')
    assert c.get('/api/v1/account').get_json()['nodes'] == []


def test_only_shown_tools_with_an_account_part_are_listed(db):
    c = sign_in(client())
    assert c.get('/api/v1/account').get_json()['tools'] == [
        {'key': 'nodebook', 'label': 'NodeBook', 'url': 'https://nodebook.example/#/account'},
    ]


def test_a_hidden_nodebook_or_none_at_all_lists_no_tools(db, monkeypatch):
    c = sign_in(client())
    monkeypatch.setattr(app_module, 'SITE_TOOLS', [dict(TOOLS[0], hidden=True)])
    assert c.get('/api/v1/account').get_json()['tools'] == []
    monkeypatch.setattr(app_module, 'SITE_TOOLS', [])
    assert c.get('/api/v1/account').get_json()['tools'] == []


def test_a_nodebook_on_a_path_of_this_site_links_there(db, monkeypatch):
    monkeypatch.setattr(app_module, 'SITE_TOOLS', [{'key': 'nodebook', 'label': 'NodeBook', 'url': '/nodebook/'}])
    c = sign_in(client())
    assert c.get('/api/v1/account').get_json()['tools'][0]['url'] == '/nodebook/#/account'


# Log out everywhere


def test_log_out_everywhere_ends_every_session_of_the_person_and_no_one_elses():
    phone, laptop, other = sign_in(client()), sign_in(client()), sign_in(client(), user_id='43')
    assert signed_in(phone) and signed_in(laptop) and signed_in(other)
    r = phone.post('/auth/logout-everywhere', headers=ORIGIN)
    assert r.status_code == 302
    assert r.headers['Location'] == '/?logout=everywhere'
    assert not signed_in(phone)
    assert not signed_in(laptop)
    assert signed_in(other)


def test_log_out_everywhere_ends_the_tool_handles_of_those_sessions():
    phone, laptop, other = sign_in(client()), sign_in(client()), sign_in(client(), user_id='43')
    laptop_handle, other_handle = handle_for(laptop), handle_for(other)
    assert alive(laptop_handle)['alive'] is True
    phone.post('/auth/logout-everywhere', headers=ORIGIN)
    assert alive(laptop_handle) == {'alive': False}
    assert grants.find_handle('nodebook', laptop_handle) is None
    assert alive(other_handle)['alive'] is True


def test_a_session_that_signed_in_again_as_someone_else_is_left_alone():
    shared = sign_in(client())
    sign_in(shared, user_id='43')
    mine = sign_in(client())
    mine.post('/auth/logout-everywhere', headers=ORIGIN)
    assert signed_in(shared)
    assert shared.get('/auth/me').get_json()['user']['id'] == '43'


def test_ended_and_expired_sessions_are_skipped_quietly():
    a, b = sign_in(client()), sign_in(client())
    b.post('/auth/logout', headers=ORIGIN)
    account_sessions.remember('42', 'rry_map_bot:gone-long-ago', 60)
    r = a.post('/auth/logout-everywhere', headers=ORIGIN)
    assert r.status_code == 302
    assert not signed_in(a)


def test_a_cross_site_log_out_everywhere_is_refused():
    phone, laptop = sign_in(client()), sign_in(client())
    for headers in ({'Origin': 'https://elsewhere.example'}, {'Referer': 'https://elsewhere.example/x'}, {}):
        assert phone.post('/auth/logout-everywhere', headers=headers).status_code == 403
    assert signed_in(phone) and signed_in(laptop)


def test_log_out_everywhere_by_link_does_nothing():
    phone = sign_in(client())
    assert phone.get('/auth/logout-everywhere').status_code != 302
    assert signed_in(phone)


def test_signed_out_log_out_everywhere_just_goes_home():
    r = client().post('/auth/logout-everywhere', headers=ORIGIN)
    assert r.status_code == 302
    assert r.headers['Location'] == '/?logout=everywhere'


def test_a_sign_in_after_log_out_everywhere_is_counted_again():
    phone, laptop = sign_in(client()), sign_in(client())
    phone.post('/auth/logout-everywhere', headers=ORIGIN)
    tablet, laptop = sign_in(client()), sign_in(laptop)
    tablet.post('/auth/logout-everywhere', headers=ORIGIN)
    assert not signed_in(laptop) and not signed_in(tablet)


def test_the_record_holds_no_discord_id_in_clear(tmp_path):
    sign_in(client(), user_id='31415926535')
    for folder, _dirs, files in os.walk(tmp_path / 'session-index'):
        for name in files:
            assert b'31415926535' not in open(os.path.join(folder, name), 'rb').read()
        assert not any('31415926535' in n for n in files)
