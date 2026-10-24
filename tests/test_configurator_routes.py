import os
import sys

import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

import backend.api.app as app_module


@pytest.fixture
def client(tmp_path, monkeypatch):
    dist = tmp_path / 'dist'
    (dist / 'assets').mkdir(parents=True)
    (dist / 'index.html').write_text('<html>vite-index</html>')
    (dist / 'assets' / 'x.js').write_text('console.log(1)')
    monkeypatch.setattr(app_module, 'CONFIGURATOR_DIST', str(dist))
    return app_module.app.test_client()


def test_configurator_serves_built_index(client):
    r = client.get('/configurator')
    assert r.status_code == 200
    assert b'vite-index' in r.data


def test_configurator_serves_assets(client):
    r = client.get('/configurator/assets/x.js')
    assert r.status_code == 200
    assert 'javascript' in r.mimetype


def test_configurator_missing_asset_404(client):
    assert client.get('/configurator/assets/nope.js').status_code == 404


def test_region_configurator_redirects(client):
    r = client.get('/region-configurator')
    assert r.status_code == 301
    assert r.headers['Location'].endswith('/configurator')
