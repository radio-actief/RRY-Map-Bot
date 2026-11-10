"""The device hub page (device-hub.html): the site's other tools frame it from the map's address,
so its own policy names who may frame it."""

import os
import sys

import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

import backend.api.app as app_module  # noqa: E402

TOOLS = [
    {'key': 'map', 'label': 'Map', 'url': 'https://map.example/'},
    {'key': 'nodebook', 'label': 'NodeBook', 'url': 'https://nodebook.example/'},
    {'key': 'meshmate', 'label': 'MeshMate', 'url': 'https://app.example:8445/'},
    {'key': 'docs', 'label': 'Docs', 'url': '/docs/'},
]


@pytest.fixture
def client(monkeypatch):
    monkeypatch.setattr(app_module, 'SITE_TOOLS', TOOLS)
    return app_module.app.test_client()


def test_the_hub_may_be_framed_by_the_listed_tools_only(client):
    r = client.get('/device-hub.html')
    assert r.status_code == 200
    assert r.mimetype == 'text/html'
    assert r.headers['Content-Security-Policy'] == (
        "default-src 'self'; frame-ancestors 'self' https://map.example https://nodebook.example https://app.example:8445"
    )
    assert 'X-Frame-Options' not in r.headers
    assert '<script' in r.get_data(as_text=True) and 'src="/src/device-hub.js"' in r.get_data(as_text=True)


def test_the_hub_fits_in_a_cross_origin_isolated_tool(client):
    r = client.get('/device-hub.html')
    assert r.headers['Cross-Origin-Resource-Policy'] == 'cross-origin'
    assert r.headers['Cross-Origin-Embedder-Policy'] == 'require-corp'


def test_without_tools_only_the_map_frames_the_hub(monkeypatch):
    monkeypatch.setattr(app_module, 'SITE_TOOLS', [])
    r = app_module.app.test_client().get('/device-hub.html')
    assert r.headers['Content-Security-Policy'] == "default-src 'self'; frame-ancestors 'self'"


def test_the_hub_has_no_inline_script(client):
    body = client.get('/device-hub.html').get_data(as_text=True).lower()
    assert '<script>' not in body and 'onload' not in body and 'onclick' not in body


@pytest.mark.parametrize('path', ['/src/device-hub.js', '/src/shared/device-message.js', '/src/shared/site-urls.js'])
def test_the_hub_scripts_are_served(client, path):
    r = client.get(path)
    assert r.status_code == 200
    assert r.mimetype == 'application/javascript'
