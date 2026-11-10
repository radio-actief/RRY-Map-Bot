"""One site with more tools: the optional tool list (SITE_TOOLS_JSON), sign-in returning to those
tools, and the Discord API address from the environment (a stand-in Discord on a test site)."""

import importlib
import json
import os
import sys

import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

import backend.api.app as app_module  # noqa: E402
from config.site_tools import parse_site_tools  # noqa: E402

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
    {'key': 'evil', 'label': 'Evil', 'url': 'https://example.com/'},
    {'key': 'evil', 'label': 'Evil', 'url': '//example.com/'},
    {'key': 'evil', 'label': 'Evil', 'url': '/\\example.com'},
    {'key': 'evil', 'label': 'Evil', 'url': 'javascript:alert(1)'},
    {'key': 'evil', 'label': 'Evil', 'url': '/a b'},
    {'key': 'bad key!', 'label': 'X', 'url': '/x/'},
    {'key': 'nolabel', 'url': '/x/'},
    {'key': 'long', 'label': 'x' * 41, 'url': '/x/'},
])
def test_only_paths_on_this_site_with_a_plain_key_and_label_are_kept(entry):
    good = {'key': 'nodebook', 'label': 'NodeBook', 'url': '/nodebook/'}
    assert parse_site_tools(json.dumps([entry, good])) == [good]


@pytest.fixture
def client(monkeypatch):
    monkeypatch.setattr(app_module, 'SITE_TOOLS', TOOLS)
    return app_module.app.test_client()


def test_the_tool_list_is_served_to_the_pages(client):
    r = client.get('/api/v1/site-tools')
    assert r.status_code == 200
    assert r.get_json() == TOOLS


def test_the_tool_list_is_empty_when_not_set(monkeypatch):
    monkeypatch.setattr(app_module, 'SITE_TOOLS', [])
    r = app_module.app.test_client().get('/api/v1/site-tools')
    assert r.get_json() == []


def test_sign_in_returns_to_a_listed_tool(client):
    client.get('/auth/login?next=/nodebook/')
    with client.session_transaction() as s:
        assert s.get('oauth_next') == '/nodebook/'


def test_sign_in_never_returns_to_an_unlisted_path(client):
    client.get('/auth/login?next=/elsewhere/')
    with client.session_transaction() as s:
        assert 'oauth_next' not in s


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


def test_the_configurator_page_isolates_its_opener_to_this_site(client):
    r = client.get('/configurator')
    if r.status_code == 404:
        pytest.skip('configurator not built')
    assert r.headers['Cross-Origin-Opener-Policy'] == 'same-origin'
