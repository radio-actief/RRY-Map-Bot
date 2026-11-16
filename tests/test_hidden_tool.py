"""A hidden tool in SITE_TOOLS_JSON ("hidden": true): people can sign in to it through the map and
come back to it, but the map's pages never show or name it, so it can be tried on its own address
before visitors see it. Hidden is not secret: an address that names the tool (its sign-in, its
failed page, its sign-out) leads to it, as the sign-in itself must."""

import json
import os
import sys
from urllib.parse import parse_qs, urlsplit

import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

import backend.api.app as app_module  # noqa: E402
import backend.auth as auth  # noqa: E402
import backend.tool_grants as grants  # noqa: E402
from config.site_tools import parse_site_tools  # noqa: E402

HIDDEN_HOST = 'nodebook.example'
HIDDEN_URL = f'https://{HIDDEN_HOST}/'
SECRET = 'n' * 40
TOOLS = parse_site_tools(json.dumps([
    {'key': 'map', 'label': 'Map', 'url': 'https://map.example/'},
    {'key': 'nodebook', 'label': 'NodeBook', 'url': HIDDEN_URL, 'hidden': True},
    {'key': 'meshmate', 'label': 'MeshMate', 'url': 'https://app.example/'},
]))


@pytest.fixture(autouse=True)
def site(monkeypatch, tmp_path):
    monkeypatch.setattr(auth, 'DISCORD_OAUTH2_CLIENT_ID', 'test-client-id')
    monkeypatch.setattr(app_module, 'SITE_TOOLS', TOOLS)
    monkeypatch.setattr(app_module, 'SITE_TOOL_SECRETS', {'nodebook': SECRET})
    monkeypatch.setattr(grants, '_store', None)
    monkeypatch.setattr(grants, 'GRANTS_DIR', str(tmp_path / 'tool-grants'))


@pytest.fixture
def client():
    return app_module.app.test_client()


def sign_in(client):
    from unittest import mock
    client.get('/auth/login')
    state = app_module.read_oauth_pending(client.get_cookie(app_module.OAUTH_COOKIE, path='/auth/').value)['state']
    with mock.patch.object(app_module, 'exchange_code_for_token', return_value={'access_token': 't'}), \
         mock.patch.object(app_module, 'get_user_info', return_value={'id': '42', 'username': 'ann', 'global_name': 'Ann', 'avatar': 'a1'}), \
         mock.patch.object(auth, 'is_guild_member', return_value=True):
        client.get('/auth/callback', query_string={'code': 'c', 'state': state})


def everything(r):
    """A response as a visitor could read it: headers and body."""
    return '\n'.join(f'{k}: {v}' for k, v in r.headers.items()) + '\n' + r.get_data(as_text=True)


# The setting


def test_hidden_is_kept_only_when_it_is_true():
    raw = [
        {'key': 'a', 'label': 'A', 'url': '/a/', 'hidden': True},
        {'key': 'b', 'label': 'B', 'url': '/b/', 'hidden': False},
        {'key': 'c', 'label': 'C', 'url': '/c/', 'hidden': 'yes'},
        {'key': 'd', 'label': 'D', 'url': '/d/', 'hidden': 1},
        {'key': 'e', 'label': 'E', 'url': '/e/'},
    ]
    assert parse_site_tools(json.dumps(raw)) == [
        {'key': 'a', 'label': 'A', 'url': '/a/', 'hidden': True},
        {'key': 'b', 'label': 'B', 'url': '/b/'},
        {'key': 'c', 'label': 'C', 'url': '/c/'},
        {'key': 'd', 'label': 'D', 'url': '/d/'},
        {'key': 'e', 'label': 'E', 'url': '/e/'},
    ]


# It works


def test_sign_in_for_a_hidden_tool_works_end_to_end(client):
    sign_in(client)
    r = client.get('/auth/authorize', query_string={'tool': 'nodebook', 'state': 's1'})
    parts = urlsplit(r.headers['Location'])
    assert f'{parts.scheme}://{parts.netloc}{parts.path}' == HIDDEN_URL + 'auth/callback'
    code = parse_qs(parts.query)['code'][0]
    server = app_module.app.test_client()
    body = server.post('/auth/token', json={'tool': 'nodebook', 'code': code},
                       headers={'Authorization': f'Bearer {SECRET}'}).get_json()
    assert body['user']['id'] == '42'
    alive = server.post('/auth/alive', json={'tool': 'nodebook', 'handle': body['handle']},
                        headers={'Authorization': f'Bearer {SECRET}'}).get_json()
    assert alive['alive'] is True


def test_sign_in_and_log_out_return_to_a_hidden_tool(client):
    client.get('/auth/login', query_string={'next': HIDDEN_URL})
    pending = app_module.read_oauth_pending(client.get_cookie(app_module.OAUTH_COOKIE, path='/auth/').value)
    assert pending['next'] == HIDDEN_URL
    r = client.post('/auth/logout', query_string={'next': HIDDEN_URL}, headers={'Origin': 'http://localhost'})
    assert r.headers['Location'] == HIDDEN_URL


def test_the_sign_out_page_for_a_hidden_tool_may_send_the_form_there(client):
    r = client.get('/auth/signout', query_string={'next': HIDDEN_URL})
    assert 'action="/auth/logout?next=https%3A%2F%2Fnodebook.example%2F"' in r.get_data(as_text=True)
    form_action = next(d for d in r.headers['Content-Security-Policy'].split('; ') if d.startswith('form-action'))
    assert f'https://{HIDDEN_HOST}' in form_action.split()


def test_the_failed_page_of_a_hidden_tools_sign_in_leads_back_to_it(client):
    body = client.get('/auth/failed', query_string={'reason': 'cancelled', 'tool': 'nodebook', 'state': 's7'}).get_data(as_text=True)
    assert f'href="{HIDDEN_URL}"' in body


# It shows nowhere


def test_the_tool_list_leaves_a_hidden_tool_out(client):
    tools = client.get('/api/v1/site-tools').get_json()
    assert [t['key'] for t in tools] == ['map', 'meshmate']
    assert all('hidden' not in t for t in tools)


@pytest.mark.parametrize('path', [
    '/', '/stats', '/region-map', '/configurator', '/device-hub.html', '/api/v1/site-tools',
    '/auth/signout', '/auth/signout?next=https://app.example/',
    '/auth/failed', '/auth/failed?reason=cancelled&next=/stats',
    '/auth/failed?reason=cancelled&tool=meshmate&state=s', '/auth/me', '/api/v1/version',
])
@pytest.mark.parametrize('signed_in', [False, True])
def test_no_page_names_a_hidden_tool(client, path, signed_in):
    if signed_in:
        sign_in(client)
    r = client.get(path)
    assert r.status_code < 500
    seen = everything(r)
    assert HIDDEN_HOST not in seen
    # The release notes (About) name NodeBook as plans; they never carry the tool list.
    if path != '/api/v1/version':
        assert 'nodebook' not in seen.lower()


def test_the_device_hub_does_not_admit_a_hidden_tool(client):
    policy = client.get('/device-hub.html').headers['Content-Security-Policy']
    assert policy == "default-src 'self'; frame-ancestors 'self' https://map.example https://app.example"


def test_the_page_policy_names_only_the_shown_tools(client):
    policy = client.get('/stats').headers['Content-Security-Policy']
    assert 'https://app.example' in policy
    assert HIDDEN_HOST not in policy
