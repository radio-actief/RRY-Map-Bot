"""The map signs people in for the site's other tools (NodeBook): a one-time code in the browser,
swapped server to server for a handle, and a check whether that handle's map session is still
signed in. The map's own session cookie stays on the map's address."""

import json
import os
import sys
from unittest import mock
from urllib.parse import parse_qs, urlsplit

import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

import backend.api.app as app_module  # noqa: E402
import backend.auth as auth  # noqa: E402
import backend.tool_grants as grants  # noqa: E402
from config.site_tools import parse_tool_secrets  # noqa: E402

TOOLS = [
    {'key': 'map', 'label': 'Map', 'url': 'https://map.example/'},
    {'key': 'nodebook', 'label': 'NodeBook', 'url': 'https://nodebook.example/'},
    {'key': 'meshmate', 'label': 'MeshMate', 'url': 'https://app.example/'},
]
SECRET = 'n' * 40
OTHER_SECRET = 'o' * 40
SECRETS = {'nodebook': SECRET, 'other': OTHER_SECRET}
CALLBACK = 'https://nodebook.example/auth/callback'


@pytest.fixture(autouse=True)
def site(monkeypatch, tmp_path):
    monkeypatch.setattr(auth, 'DISCORD_OAUTH2_CLIENT_ID', 'test-client-id')
    monkeypatch.setattr(app_module, 'SITE_TOOLS', TOOLS + [{'key': 'other', 'label': 'Other', 'url': 'https://other.example/'}])
    monkeypatch.setattr(app_module, 'SITE_TOOL_SECRETS', SECRETS)
    monkeypatch.setattr(grants, '_store', None)
    monkeypatch.setattr(grants, 'GRANTS_DIR', str(tmp_path / 'tool-grants'))


@pytest.fixture
def client():
    return app_module.app.test_client()


def sign_in(client, user_id='42', member=True):
    """A full map sign-in through the (stand-in) Discord round trip."""
    client.get('/auth/login')
    state = app_module.read_oauth_pending(client.get_cookie(app_module.OAUTH_COOKIE, path='/auth/').value)['state']
    return discord_callback(client, state, user_id, member)


def discord_callback(client, state, user_id='42', member=True, **extra):
    with mock.patch.object(app_module, 'exchange_code_for_token', return_value={'access_token': 't'}), \
         mock.patch.object(app_module, 'get_user_info', return_value={'id': user_id, 'username': 'ann', 'global_name': 'Ann', 'avatar': 'a1'}), \
         mock.patch.object(auth, 'is_guild_member', return_value=member):
        return client.get('/auth/callback', query_string={'code': 'c', 'state': state, **extra})


def query(location):
    parts = urlsplit(location)
    return f'{parts.scheme}://{parts.netloc}{parts.path}', {k: v[0] for k, v in parse_qs(parts.query).items()}


def code_for(client, state='s1'):
    r = client.get('/auth/authorize', query_string={'tool': 'nodebook', 'state': state})
    where, q = query(r.headers['Location'])
    assert where == CALLBACK
    return q['code']


def token(server, code, tool='nodebook', secret=SECRET, **headers):
    return server.post('/auth/token', json={'tool': tool, 'code': code},
                       headers={'Authorization': f'Bearer {secret}', **headers})


def alive(server, handle, tool='nodebook', secret=SECRET):
    return server.post('/auth/alive', json={'tool': tool, 'handle': handle},
                       headers={'Authorization': f'Bearer {secret}'})


# The settings


def test_tool_secrets_are_read_from_their_setting():
    assert parse_tool_secrets(None) == {}
    assert parse_tool_secrets('not json') == {}
    assert parse_tool_secrets(json.dumps({'nodebook': SECRET})) == {'nodebook': SECRET}


def test_a_short_or_odd_secret_is_dropped():
    assert parse_tool_secrets(json.dumps({'nodebook': 'short', 'x': 5, 'bad key!': SECRET, 'ok': SECRET})) == {'ok': SECRET}


def test_the_session_cookie_has_its_own_name_and_stays_on_this_host(client):
    sign_in(client)
    assert app_module.app.config['SESSION_COOKIE_NAME'] == 'bemesh_map_session'
    cookie = client.get_cookie('bemesh_map_session')
    assert cookie is not None
    assert cookie.domain in ('localhost', '')


# Start in the browser


def test_a_signed_in_person_goes_straight_back_with_a_code(client):
    sign_in(client)
    r = client.get('/auth/authorize', query_string={'tool': 'nodebook', 'state': 'abc-123'})
    assert r.status_code == 302
    where, q = query(r.headers['Location'])
    assert where == CALLBACK
    assert q['state'] == 'abc-123'
    assert len(q['code']) >= 43


def test_without_a_sign_in_and_prompt_none_the_tool_hears_so_at_once(client):
    r = client.get('/auth/authorize', query_string={'tool': 'nodebook', 'state': 's', 'prompt': 'none'})
    assert r.headers['Location'] == CALLBACK + '?error=login_required&state=s'


def test_without_a_sign_in_the_person_signs_in_at_discord_and_then_goes_back(client):
    r = client.get('/auth/authorize', query_string={'tool': 'nodebook', 'state': 's9'})
    assert r.headers['Location'].startswith('https://discord.com/')
    pending = app_module.read_oauth_pending(client.get_cookie(app_module.OAUTH_COOKIE, path='/auth/').value)
    r = discord_callback(client, pending['state'])
    where, q = query(r.headers['Location'])
    assert where == CALLBACK
    assert q['state'] == 's9'
    assert q['code']


def test_a_person_not_on_the_discord_server_still_gets_a_code(client):
    client.get('/auth/authorize', query_string={'tool': 'nodebook', 'state': 's'})
    pending = app_module.read_oauth_pending(client.get_cookie(app_module.OAUTH_COOKIE, path='/auth/').value)
    r = discord_callback(client, pending['state'], member=False)
    where, q = query(r.headers['Location'])
    assert where == CALLBACK
    body = token(app_module.app.test_client(), q['code']).get_json()
    assert body['user']['is_guild_member'] is False


def test_a_cancelled_sign_in_shows_the_failed_page_with_the_way_back_to_the_tool(client):
    client.get('/auth/authorize', query_string={'tool': 'nodebook', 'state': 's7'})
    pending = app_module.read_oauth_pending(client.get_cookie(app_module.OAUTH_COOKIE, path='/auth/').value)
    r = discord_callback(client, pending['state'], error='access_denied')
    assert r.headers['Location'] == '/auth/failed?reason=cancelled&tool=nodebook&state=s7'
    page = client.get(r.headers['Location']).get_data(as_text=True)
    assert 'href="/auth/authorize?tool=nodebook&amp;state=s7"' in page
    assert 'href="https://nodebook.example/"' in page


@pytest.mark.parametrize('args', [
    {'tool': 'unknown', 'state': 's'},
    {'tool': 'meshmate', 'state': 's'},          # listed, but no secret
    {'tool': 'nodebook'},                          # no state
    {'tool': 'nodebook', 'state': ''},
    {'tool': 'nodebook', 'state': 'a b'},
    {'tool': 'nodebook', 'state': 'x' * 129},
    {'tool': 'nodebook', 'state': 'https://evil.example/'},
])
def test_an_unknown_tool_or_odd_state_is_refused_without_a_redirect(client, args):
    sign_in(client)
    r = client.get('/auth/authorize', query_string=args)
    assert r.status_code == 400
    assert 'Location' not in r.headers


def test_the_failed_page_ignores_an_unknown_tool(client):
    page = client.get('/auth/failed?reason=failed&tool=unknown&state=s').get_data(as_text=True)
    assert 'unknown' not in page
    assert 'href="/auth/login"' in page


# Exchange, server to server


def test_a_code_is_swapped_once_for_a_handle_and_the_person(client):
    sign_in(client)
    code = code_for(client)
    server = app_module.app.test_client()
    r = token(server, code)
    assert r.status_code == 200
    body = r.get_json()
    assert len(body['handle']) >= 43
    assert body['user'] == {'id': '42', 'username': 'ann', 'global_name': 'Ann', 'discriminator': '0000', 'avatar': 'a1', 'is_guild_member': True}
    again = token(server, code)
    assert again.status_code == 400
    assert again.get_json() == {'error': 'invalid_grant'}


def test_a_code_lives_a_minute(client):
    sign_in(client)
    code = code_for(client)
    with mock.patch.object(grants.time, 'time', return_value=grants.time.time() + 61):
        assert token(app_module.app.test_client(), code).status_code == 400


def test_a_code_is_only_for_the_tool_it_was_made_for(client):
    sign_in(client)
    code = code_for(client)
    assert token(app_module.app.test_client(), code, tool='other', secret=OTHER_SECRET).status_code == 400


@pytest.mark.parametrize('secret', ['', 'wrong' * 10, OTHER_SECRET])
def test_a_wrong_secret_is_refused(client, secret):
    sign_in(client)
    code = code_for(client)
    assert token(app_module.app.test_client(), code, secret=secret).status_code == 401


def test_without_an_authorization_header_the_exchange_is_refused(client):
    sign_in(client)
    r = app_module.app.test_client().post('/auth/token', json={'tool': 'nodebook', 'code': code_for(client)})
    assert r.status_code == 401


def test_a_call_from_a_browser_is_refused(client):
    sign_in(client)
    code = code_for(client)
    assert token(app_module.app.test_client(), code, Origin='https://nodebook.example').status_code == 400
    # The signed-in browser itself, with its cookie
    assert token(client, code).status_code == 400


def test_an_unknown_code_is_refused():
    assert token(app_module.app.test_client(), 'x' * 43).status_code == 400


# Still signed in?


def _handle(client):
    return token(app_module.app.test_client(), code_for(client)).get_json()['handle']


def test_a_handle_is_alive_while_the_map_session_is(client):
    sign_in(client)
    handle = _handle(client)
    r = alive(app_module.app.test_client(), handle)
    assert r.status_code == 200
    assert r.get_json() == {'alive': True, 'user': {'id': '42', 'username': 'ann', 'global_name': 'Ann', 'discriminator': '0000', 'avatar': 'a1', 'is_guild_member': True}}


def test_signing_out_on_the_map_ends_the_handle(client):
    sign_in(client)
    handle = _handle(client)
    client.post('/auth/logout', headers={'Origin': 'http://localhost'})
    assert alive(app_module.app.test_client(), handle).get_json() == {'alive': False}


def test_signing_in_again_ends_the_handles_of_the_old_session(client):
    sign_in(client)
    handle = _handle(client)
    sign_in(client, user_id='43')
    assert alive(app_module.app.test_client(), handle).get_json() == {'alive': False}


def test_a_handle_is_only_for_its_own_tool(client):
    sign_in(client)
    handle = _handle(client)
    assert alive(app_module.app.test_client(), handle, tool='other', secret=OTHER_SECRET).get_json() == {'alive': False}


def test_an_unknown_handle_is_not_alive():
    assert alive(app_module.app.test_client(), 'x' * 43).get_json() == {'alive': False}


def test_the_alive_check_needs_the_secret(client):
    sign_in(client)
    handle = _handle(client)
    assert alive(app_module.app.test_client(), handle, secret='wrong' * 10).status_code == 401


def test_a_flood_of_codes_never_pushes_out_a_handle(client, monkeypatch):
    monkeypatch.setitem(grants._THRESHOLDS, 'codes', 5)
    sign_in(client)
    handle = _handle(client)
    for i in range(30):
        code_for(client, state=f's{i}')
    assert alive(app_module.app.test_client(), handle).get_json()['alive'] is True
