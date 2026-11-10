"""Content-Security-Policy on the map's own pages: scripts from this site (and the few pinned files
the pages load from a CDN) only, no inline scripts, no eval."""

import os
import re
import sys
from html.parser import HTMLParser

import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

import backend.api.app as app_module  # noqa: E402

ROOT = os.path.join(os.path.dirname(__file__), '..')
TOOLS = [
    {'key': 'nodebook', 'label': 'NodeBook', 'url': 'https://nodebook.example/'},
    {'key': 'meshmate', 'label': 'MeshMate', 'url': 'https://app.example:8445/'},
    {'key': 'docs', 'label': 'Docs', 'url': '/docs/'},
]
PAGES = ['/', '/stats', '/region-map', '/configurator', '/auth/signout']


@pytest.fixture
def client(monkeypatch):
    monkeypatch.setattr(app_module, 'SITE_TOOLS', TOOLS)
    return app_module.app.test_client()


def policy(resp):
    """The response's policy as {directive: [sources]}."""
    out = {}
    for part in resp.headers['Content-Security-Policy'].split(';'):
        words = part.split()
        if words:
            out[words[0]] = words[1:]
    return out


def get_page(client, path):
    r = client.get(path)
    if r.status_code == 404:
        pytest.skip(f'{path} not built')
    assert r.status_code == 200 and r.mimetype == 'text/html'
    return r


@pytest.mark.parametrize('path', PAGES)
def test_every_page_allows_scripts_from_this_site_only(client, path):
    p = policy(get_page(client, path))
    assert p['default-src'] == ["'self'"]
    assert p['script-src'][0] == "'self'"
    assert all(s.startswith('https://cdn.jsdelivr.net/npm/') and '@' in s and not s.endswith('/') for s in p['script-src'][1:])
    assert p['object-src'] == ["'none'"]
    assert p['base-uri'] == ["'self'"]
    flat = ' '.join(' '.join(v) for v in p.values())
    assert "'unsafe-eval'" not in flat
    assert "'unsafe-inline'" not in ' '.join(p['script-src'])


@pytest.mark.parametrize('path', PAGES)
def test_every_page_may_reach_the_listed_tools(client, path):
    p = policy(get_page(client, path))
    assert p['connect-src'] == ["'self'", 'https://nodebook.example', 'https://app.example:8445']
    # Log out on this site returns to a tool on its own address.
    assert p['form-action'] == ["'self'", 'https://nodebook.example', 'https://app.example:8445']


@pytest.mark.parametrize('path', PAGES)
def test_every_page_loads_its_fonts_tiles_and_qr_codes(client, path):
    p = policy(get_page(client, path))
    assert p['style-src'] == ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com']
    assert p['font-src'] == ["'self'", 'https://fonts.gstatic.com']
    for source in ("'self'", 'data:', 'https://tile.openstreetmap.org', 'https://*.tile.openstreetmap.org',
                   'https://server.arcgisonline.com'):
        assert source in p['img-src']


def test_without_tools_the_pages_reach_this_site_only(monkeypatch):
    monkeypatch.setattr(app_module, 'SITE_TOOLS', [])
    p = policy(app_module.app.test_client().get('/'))
    assert p['connect-src'] == ["'self'"]
    assert p['form-action'] == ["'self'"]


def test_data_and_the_device_hub_get_no_page_policy(client):
    assert 'Content-Security-Policy' not in client.get('/api/v1/site-tools').headers
    assert client.get('/device-hub.html').headers['Content-Security-Policy'].startswith("default-src 'self'; frame-ancestors")


def test_the_policy_can_be_turned_off_for_local_debugging(client, monkeypatch):
    monkeypatch.setattr(app_module, 'CSP_ENABLED', False)
    assert 'Content-Security-Policy' not in client.get('/').headers


def test_the_setting_is_on_unless_turned_off(monkeypatch):
    for value, on in ((None, True), ('true', True), ('1', True), ('false', False), ('0', False), ('off', False)):
        if value is None:
            monkeypatch.delenv('CSP_ENABLED', raising=False)
        else:
            monkeypatch.setenv('CSP_ENABLED', value)
        assert app_module.csp_enabled() is on


class _Inline(HTMLParser):
    def __init__(self):
        super().__init__()
        self.found = []

    def handle_starttag(self, tag, attrs):
        a = dict(attrs)
        if tag == 'script' and not a.get('src'):
            self.found.append('inline <script>')
        for name, value in attrs:
            if name.startswith('on'):
                self.found.append(f'{tag} {name}')
            if value and re.match(r'\s*javascript:', value, re.I):
                self.found.append(f'{tag} {name}={value}')


@pytest.mark.parametrize('page', ['index.html', 'stats.html', 'region-map.html', 'device-hub.html', 'web/configurator/index.html'])
def test_no_page_has_inline_script(page):
    parser = _Inline()
    with open(os.path.join(ROOT, page), encoding='utf-8') as f:
        parser.feed(f.read())
    assert parser.found == []


def test_the_map_builds_no_inline_handlers_in_its_popups():
    with open(os.path.join(ROOT, 'src', 'map.js'), encoding='utf-8') as f:
        src = f.read()
    assert not re.search(r'\bon(click|error|load|mouse\w+|key\w+)=', src)
    assert 'javascript:' not in src
