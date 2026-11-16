"""Every page and file of the site goes out compressed when the browser accepts it, and the stats
page's data is built once per database change instead of on every visit."""

import gzip
import json
import os
import sys

import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

import backend.api.app as app_module  # noqa: E402

GZ = {'Accept-Encoding': 'gzip, deflate, br'}
ROOT = os.path.join(os.path.dirname(__file__), '..')


@pytest.fixture
def client():
    app_module._gzip_cache.clear()
    app_module._stats_data_cache.clear()
    return app_module.app.test_client()


@pytest.mark.parametrize('path, source', [
    ('/src/map.js', 'src/map.js'),
    ('/lib/leaflet.js', 'lib/leaflet.js'),
    ('/src/shared/bemesh-shell.css', 'src/shared/bemesh-shell.css'),
    ('/stats', 'stats.html'),
    ('/', 'index.html'),
])
def test_pages_scripts_and_styles_are_gzipped_and_revalidate(client, path, source):
    raw = open(os.path.join(ROOT, source), 'rb').read()
    r = client.get(path, headers=GZ)
    assert r.status_code == 200
    assert r.headers['Content-Encoding'] == 'gzip'
    assert 'Accept-Encoding' in r.headers['Vary']
    body = gzip.decompress(r.data)
    if path in ('/src/map.js', '/lib/leaflet.js', '/src/shared/bemesh-shell.css'):
        assert body == raw
    assert len(r.data) < len(body) / 2
    again = client.get(path, headers={**GZ, 'If-None-Match': r.headers['ETag']})
    assert again.status_code == 304


def test_a_browser_without_gzip_still_gets_the_plain_file(client):
    raw = open(os.path.join(ROOT, 'src/map.js'), 'rb').read()
    r = client.get('/src/map.js')
    assert 'Content-Encoding' not in r.headers
    assert r.data == raw


def test_the_gzip_cache_is_bounded_by_size(client, monkeypatch):
    monkeypatch.setattr(app_module, 'GZIP_CACHE_MAX_BYTES', 60_000)
    for path in ('/src/map.js', '/lib/leaflet.js', '/lib/vue.runtime.esm-browser.prod.js', '/src/stats.js'):
        client.get(path, headers=GZ)
    assert sum(len(v) for v in app_module._gzip_cache.values()) <= 60_000


CHANGES = [{'public_key': f'{i:064x}', 'lat': 50.0, 'lon': 4.0, 'name': f'N{i}', 'change_date': '2026-11-01'}
           for i in range(400)]
HISTORY = [{'sync_date': '2026-11-01', 'nodes_added': i} for i in range(300)]


@pytest.fixture
def counted(monkeypatch):
    calls = {'changes': 0, 'history': 0}

    def changes(**kw):
        calls['changes'] += 1
        return CHANGES

    def history(**kw):
        calls['history'] += 1
        return HISTORY

    monkeypatch.setattr(app_module, 'get_node_changes_since', changes)
    monkeypatch.setattr(app_module, 'get_sync_history', history)
    stamp = {'v': (1, 0)}
    monkeypatch.setattr(app_module, '_db_stamp', lambda: stamp['v'])
    return calls, stamp


@pytest.mark.parametrize('path, key, data', [
    ('/api/v1/node-changes?limit=15000', 'changes', CHANGES),
    ('/api/v1/sync-history?limit=500', 'history', HISTORY),
])
def test_stats_data_is_built_once_per_database_change(client, counted, path, key, data):
    calls, stamp = counted
    first = client.get(path, headers=GZ)
    assert first.status_code == 200
    assert json.loads(gzip.decompress(first.data)) == data
    assert first.headers['Cache-Control'] == 'no-cache'
    client.get(path, headers=GZ)
    assert client.get(path, headers={**GZ, 'If-None-Match': first.headers['ETag']}).status_code == 304
    assert calls[key] == 1
    stamp['v'] = (2, 0)  # the sync wrote to the database
    client.get(path, headers=GZ)
    assert calls[key] == 2


def test_each_filter_keeps_its_own_answer(client, counted):
    calls, _ = counted
    client.get('/api/v1/node-changes?limit=15000', headers=GZ)
    client.get('/api/v1/node-changes?limit=15000&frequency_preset=EU/UK%20(Narrow)', headers=GZ)
    client.get('/api/v1/node-changes?limit=15000', headers=GZ)
    assert calls['changes'] == 2


def test_a_failed_build_is_not_kept(client, monkeypatch):
    monkeypatch.setattr(app_module, '_db_stamp', lambda: (1, 0))
    boom = {'n': 0}

    def failing(**kw):
        boom['n'] += 1
        raise RuntimeError('db locked')

    monkeypatch.setattr(app_module, 'get_node_changes_since', failing)
    assert client.get('/api/v1/node-changes').status_code == 500
    assert client.get('/api/v1/node-changes').status_code == 500
    assert boom['n'] == 2


def test_the_database_stamp_follows_writes(tmp_path, monkeypatch):
    db = tmp_path / 'x.db'
    db.write_bytes(b'a')
    monkeypatch.setattr(app_module, 'DATABASE_PATH', str(db))
    before = app_module._db_stamp()
    os.utime(db, ns=(1, before[0] + 10_000_000))
    assert app_module._db_stamp() != before
    wal = tmp_path / 'x.db-wal'
    wal.write_bytes(b'w')
    assert app_module._db_stamp()[1] != 0
