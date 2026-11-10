"""One site with more tools: the optional tool list (SITE_TOOLS_JSON), sign-in returning to those
tools, and the Discord API address from the environment (a stand-in Discord on a test site)."""

import importlib
import json
import os
import sys

import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

import backend.api.app as app_module  # noqa: E402
from config.site_tools import parse_site_tools, tool_origins  # noqa: E402

TOOLS = [
    {'key': 'map', 'label': 'Map', 'url': '/'},
    {'key': 'nodebook', 'label': 'NodeBook', 'url': '/nodebook/'},
    {'key': 'meshmate', 'label': 'MeshMate', 'url': '/app/'},
]


def test_no_setting_means_no_extra_tools():
    assert parse_site_tools(None) == []
    assert parse_site_tools('') == []


def test_tools_are_read_in_order():
    assert parse_site_tools(json.dumps(TOOLS)) == TOOLS


@pytest.mark.parametrize('bad', [
    'not json',
    '{"key": "x"}',
    '[1, 2]',
])
def test_a_list_that_cannot_be_read_gives_no_tools(bad):
    assert parse_site_tools(bad) == []


@pytest.mark.parametrize('entry', [
    {'key': 'dots', 'label': 'Dots', 'url': '/x/../auth/logout'},
    {'key': 'dot', 'label': 'Dot', 'url': '/./x/'},
    {'key': 'evil', 'label': 'Evil', 'url': '//example.com/'},
    {'key': 'evil', 'label': 'Evil', 'url': '/\\example.com'},
    {'key': 'evil', 'label': 'Evil', 'url': 'javascript:alert(1)'},
    {'key': 'evil', 'label': 'Evil', 'url': '/a b'},
    {'key': 'bad key!', 'label': 'X', 'url': '/x/'},
    {'key': 'nolabel', 'url': '/x/'},
    {'key': 'long', 'label': 'x' * 41, 'url': '/x/'},
    {'key': 'nl', 'label': 'Newline', 'url': '/x/\n'},
    {'key': 'nl\n', 'label': 'Newline', 'url': '/x/'},
])
def test_only_paths_on_this_site_with_a_plain_key_and_label_are_kept(entry):
    good = {'key': 'nodebook', 'label': 'NodeBook', 'url': '/nodebook/'}
    assert parse_site_tools(json.dumps([entry, good])) == [good]


@pytest.mark.parametrize('url', [
    'https://nodebook.example/',
    'https://app.example:8445/',
    'https://tools.example/nodebook/',
    'https://sub.tools.example/a/b-c_d~e/',
    'http://localhost:4791/',
    'http://127.0.0.1:4791/nb/',
    'https://localhost/',
])
def test_a_tool_on_its_own_address_is_kept(url):
    tool = {'key': 'nodebook', 'label': 'NodeBook', 'url': url}
    assert parse_site_tools(json.dumps([tool])) == [tool]


@pytest.mark.parametrize('url', [
    'http://nodebook.example/',          # plain http only for a test on this machine
    'https://nodebook.example',          # must end in "/"
    'https://nodebook.example/nodebook', # must end in "/"
    'https://user@nodebook.example/',
    'https://user:pw@nodebook.example/',
    'https://nodebook.example/../',
    'https://nodebook.example/a/./b/',
    'https://nodebook.example/a b/',
    'https://nodebook.example/a\\b/',
    'https://nodebook.example/?q=/',
    'https://nodebook.example/#x/',
    'https://nodebook.example/\n',
    'https://nodebook.example:99999/',
    'https://nodebook.example:0/',
    'https://nodebook.example:/',
    'https://NodeBook.example/',
    'HTTPS://nodebook.example/',
    'https://-nodebook.example/',
    'https://nodebook..example/',
    'https://.example/',
    'https:///',
    'https://[::1]/',
    'ftp://nodebook.example/',
    'javascript://nodebook.example/',
    'https://nodebook.example//',
])
def test_a_full_address_that_is_not_plain_https_is_left_out(url):
    good = {'key': 'nodebook', 'label': 'NodeBook', 'url': '/nodebook/'}
    assert parse_site_tools(json.dumps([{'key': 'other', 'label': 'Other', 'url': url}, good])) == [good]


def test_the_origins_of_tools_on_their_own_address():
    tools = [
        {'key': 'map', 'label': 'Map', 'url': '/'},
        {'key': 'nodebook', 'label': 'NodeBook', 'url': 'https://nodebook.example/'},
        {'key': 'meshmate', 'label': 'MeshMate', 'url': 'https://app.example:8445/'},
        {'key': 'docs', 'label': 'Docs', 'url': 'https://nodebook.example/docs/'},
        {'key': 'plain', 'label': 'Plain', 'url': 'https://plain.example:443/'},
        {'key': 'local', 'label': 'Local', 'url': 'http://127.0.0.1:4791/'},
    ]
    assert tool_origins(tools) == [
        'https://nodebook.example', 'https://app.example:8445', 'https://plain.example', 'http://127.0.0.1:4791',
    ]
    assert tool_origins([]) == []


@pytest.fixture
def client(monkeypatch):
    monkeypatch.setattr(app_module, 'SITE_TOOLS', TOOLS)
    return app_module.app.test_client()


def test_the_tool_list_is_read_with_the_other_site_settings(monkeypatch):
    import config.config as cfg
    monkeypatch.setenv('SITE_TOOLS_JSON', json.dumps(TOOLS))
    try:
        assert importlib.reload(cfg).SITE_TOOLS == TOOLS
    finally:
        monkeypatch.delenv('SITE_TOOLS_JSON')
        importlib.reload(cfg)


def test_the_tool_list_is_served_to_the_pages(client):
    r = client.get('/api/v1/site-tools')
    assert r.status_code == 200
    assert r.get_json() == TOOLS


def test_the_tool_list_is_empty_when_not_set(monkeypatch):
    monkeypatch.setattr(app_module, 'SITE_TOOLS', [])
    r = app_module.app.test_client().get('/api/v1/site-tools')
    assert r.get_json() == []


def _pending_next(client):
    cookie = client.get_cookie(app_module.OAUTH_COOKIE, path='/auth/')
    return app_module.read_oauth_pending(cookie.value)['next']


def test_sign_in_returns_to_a_listed_tool(client):
    client.get('/auth/login?next=/nodebook/')
    assert _pending_next(client) == '/nodebook/'


def test_sign_in_never_returns_to_an_unlisted_path(client):
    client.get('/auth/login?next=/elsewhere/')
    assert _pending_next(client) is None


FULL = [
    {'key': 'map', 'label': 'Map', 'url': 'https://map.example/'},
    {'key': 'nodebook', 'label': 'NodeBook', 'url': 'https://nodebook.example/'},
    {'key': 'meshmate', 'label': 'MeshMate', 'url': 'https://app.example:8445/'},
]


@pytest.fixture
def full_client(monkeypatch):
    monkeypatch.setattr(app_module, 'SITE_TOOLS', FULL)
    return app_module.app.test_client()


def test_sign_in_returns_to_a_tool_on_its_own_address(full_client):
    full_client.get('/auth/login?next=https://nodebook.example/')
    assert _pending_next(full_client) == 'https://nodebook.example/'
    assert app_module._after_auth_target('https://nodebook.example/', 'login=success') == 'https://nodebook.example/'


@pytest.mark.parametrize('nxt', [
    'https://elsewhere.example/', 'https://nodebook.example/x/', 'https://nodebook.example', '//nodebook.example/',
])
def test_sign_in_never_returns_to_an_unlisted_address(full_client, nxt):
    full_client.get('/auth/login', query_string={'next': nxt})
    assert _pending_next(full_client) is None


@pytest.mark.parametrize('nxt', ['/', '/stats', '/region-map', '/configurator'])
def test_sign_in_still_returns_to_the_map_pages(full_client, nxt):
    full_client.get('/auth/login', query_string={'next': nxt})
    assert _pending_next(full_client) == nxt


def test_log_out_returns_to_a_tool_on_its_own_address(full_client):
    r = full_client.post('/auth/logout', query_string={'next': 'https://app.example:8445/'},
                         headers={'Origin': 'http://localhost'})
    assert r.status_code == 302
    assert r.headers['Location'] == 'https://app.example:8445/'


def test_log_out_from_another_tool_is_still_refused(full_client):
    r = full_client.post('/auth/logout?next=https://nodebook.example/', headers={'Origin': 'https://nodebook.example'})
    assert r.status_code == 403
    assert full_client.post('/auth/logout').status_code == 403


def test_the_sign_out_page_posts_to_log_out_on_this_site(full_client):
    r = full_client.get('/auth/signout', query_string={'next': 'https://nodebook.example/'})
    assert r.status_code == 200
    assert r.mimetype == 'text/html'
    body = r.get_data(as_text=True)
    assert '<form method="post" action="/auth/logout?next=https%3A%2F%2Fnodebook.example%2F"' in body
    assert '<button type="submit"' in body and 'Log out' in body
    assert '<script' not in body.lower() and 'onclick' not in body.lower()


def test_the_sign_out_page_drops_an_unlisted_return_address(full_client):
    body = full_client.get('/auth/signout', query_string={'next': 'https://evil.example/"><b>'}).get_data(as_text=True)
    assert 'action="/auth/logout"' in body
    assert 'evil' not in body


def test_the_sign_out_page_speaks_the_visitors_language(full_client):
    body = full_client.get('/auth/signout', headers={'Accept-Language': 'nl-BE,nl;q=0.9,en;q=0.5'}).get_data(as_text=True)
    assert 'lang="nl"' in body and 'Afmelden' in body
    body = full_client.get('/auth/signout?lang=fr').get_data(as_text=True)
    assert 'lang="fr"' in body and 'Se déconnecter' in body


def test_the_sign_out_page_signs_out(full_client):
    with full_client.session_transaction() as s:
        s['user_id'] = '1'
    r = full_client.post('/auth/logout?next=https://nodebook.example/', headers={'Origin': 'http://localhost'})
    assert r.headers['Location'] == 'https://nodebook.example/'
    with full_client.session_transaction() as s:
        assert 'user_id' not in s


def test_cookie_domain_comes_from_the_environment(monkeypatch):
    monkeypatch.setenv('SESSION_COOKIE_DOMAIN', ' .example.test ')
    assert app_module.session_cookie_domain() == '.example.test'
    monkeypatch.setenv('SESSION_COOKIE_DOMAIN', '')
    assert app_module.session_cookie_domain() is None
    monkeypatch.delenv('SESSION_COOKIE_DOMAIN')
    assert app_module.session_cookie_domain() is None


def test_unset_cookie_domain_keeps_cookies_on_this_host(client):
    assert app_module.app.config['SESSION_COOKIE_DOMAIN'] is None
    r = client.get('/auth/login?next=/')
    cookie = [h for h in r.headers.getlist('Set-Cookie') if h.startswith(app_module.OAUTH_COOKIE + '=')][0]
    assert 'Domain=' not in cookie


def test_the_sign_in_cookie_follows_the_cookie_domain(client, monkeypatch):
    monkeypatch.setitem(app_module.app.config, 'SESSION_COOKIE_DOMAIN', 'example.test')
    r = client.get('/auth/login?next=/')
    cookie = [h for h in r.headers.getlist('Set-Cookie') if h.startswith(app_module.OAUTH_COOKIE + '=')][0]
    assert 'Domain=example.test' in cookie and 'Path=/auth/' in cookie
    r = client.get('/auth/callback?error=x')
    gone = [h for h in r.headers.getlist('Set-Cookie') if h.startswith(app_module.OAUTH_COOKIE + '=')][0]
    assert 'Domain=example.test' in gone and 'Max-Age=0' in gone


def test_the_tool_list_stays_public(full_client):
    r = full_client.get('/api/v1/site-tools', headers={'Origin': 'https://nodebook.example'})
    assert r.get_json() == FULL
    assert r.headers['Access-Control-Allow-Origin'] == '*'
    assert 'Access-Control-Allow-Credentials' not in r.headers


def test_log_out_returns_to_a_listed_tool(client):
    r = client.post('/auth/logout?next=/app/', headers={'Origin': 'http://localhost'})
    assert r.status_code == 302
    assert r.headers['Location'].endswith('/app/')


def test_discord_api_address_comes_from_the_environment(monkeypatch):
    import config.config as cfg
    monkeypatch.setenv('DISCORD_API_BASE_URL', 'http://oauth-stub:9000/api/')
    try:
        assert importlib.reload(cfg).DISCORD_API_BASE_URL == 'http://oauth-stub:9000/api'
    finally:
        monkeypatch.delenv('DISCORD_API_BASE_URL')
        importlib.reload(cfg)


def test_discord_api_address_defaults_to_discord(monkeypatch):
    import config.config as cfg
    monkeypatch.delenv('DISCORD_API_BASE_URL', raising=False)
    assert importlib.reload(cfg).DISCORD_API_BASE_URL == 'https://discord.com/api/v10'


@pytest.mark.parametrize('path', ['/configurator', '/configurator/index.html', '/', '/stats', '/region-map'])
def test_every_page_isolates_its_opener_to_this_site(client, path):
    r = client.get(path)
    if r.status_code == 404:
        pytest.skip('page not built')
    assert r.mimetype == 'text/html'
    assert r.headers['Cross-Origin-Opener-Policy'] == 'same-origin'


def test_json_answers_carry_no_opener_policy(client):
    assert 'Cross-Origin-Opener-Policy' not in client.get('/api/v1/site-tools').headers


def test_a_failed_sign_in_goes_to_its_own_page_with_the_way_back(client):
    client.get('/auth/login?next=/configurator')
    r = client.get('/auth/callback?error=access_denied')
    assert r.headers['Location'] == '/auth/failed?reason=cancelled&next=%2Fconfigurator'
    r = client.get('/auth/callback?error=server_error')
    assert r.headers['Location'] == '/auth/failed?reason=failed'


def test_the_failed_sign_in_page_explains_and_offers_try_again_and_back(full_client):
    r = full_client.get('/auth/failed', query_string={'reason': 'cancelled', 'next': 'https://nodebook.example/'})
    assert r.status_code == 200 and r.mimetype == 'text/html'
    assert r.headers['Cache-Control'] == 'no-store'
    body = r.get_data(as_text=True)
    assert 'bemesh-shell.css' in body and 'class="card signout"' in body
    assert 'cancelled' in body.lower()
    assert 'href="/auth/login?next=https%3A%2F%2Fnodebook.example%2F"' in body
    assert 'href="https://nodebook.example/"' in body
    assert '<script' not in body.lower() and 'onclick' not in body.lower()


def test_the_failed_sign_in_page_drops_unknown_reasons_and_unlisted_return_addresses(full_client):
    body = full_client.get('/auth/failed', query_string={'reason': '<b>x', 'next': 'https://evil.example/'}).get_data(as_text=True)
    assert '<b>x' not in body and 'evil' not in body
    assert 'href="/auth/login"' in body and 'href="/"' in body


def test_a_non_member_gets_the_invite_on_the_page_not_a_browser_box(full_client):
    body = full_client.get('/auth/failed?reason=not_member').get_data(as_text=True)
    from config.config import DISCORD_SERVER_INVITE_URL
    assert f'href="{DISCORD_SERVER_INVITE_URL}"' in body
    body_nl = full_client.get('/auth/failed?reason=not_member&lang=nl').get_data(as_text=True)
    assert 'lang="nl"' in body_nl and 'Discord' in body_nl
