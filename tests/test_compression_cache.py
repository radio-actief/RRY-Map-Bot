"""Compression and cache headers for the configurator, its data and the node list."""

import gzip
import json
import os
import sys

import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

import backend.api.app as app_module

GZ = {'Accept-Encoding': 'gzip, deflate, br'}
ROOT = os.path.join(os.path.dirname(__file__), '..')


@pytest.fixture
def client(tmp_path, monkeypatch):
    dist = tmp_path / 'dist'
    (dist / 'assets').mkdir(parents=True)
    (dist / 'index.html').write_text('<html>vite-index ' + 'x' * 2000 + '</html>')
    (dist / 'assets' / 'index-abc123.js').write_text('console.log(1);\n' * 500)
    monkeypatch.setattr(app_module, 'CONFIGURATOR_DIST', str(dist))
    app_module._gzip_cache.clear()
    return app_module.app.test_client()


def test_data_file_is_gzipped_when_asked_and_cached_for_an_hour(client):
    raw = open(os.path.join(ROOT, 'data', 'be-locode.json'), 'rb').read()
    r = client.get('/data/be-locode.json', headers=GZ)
    assert r.status_code == 200
    assert r.headers['Content-Encoding'] == 'gzip'
    assert 'Accept-Encoding' in r.headers['Vary']
    assert gzip.decompress(r.data) == raw
    assert int(r.headers['Content-Length']) == len(r.data) < len(raw) / 2
    assert r.headers['Cache-Control'] == 'public, max-age=3600'
    assert r.headers['ETag'].startswith('W/')


def test_without_gzip_the_file_comes_as_it_is(client):
    raw = open(os.path.join(ROOT, 'data', 'be-locode.json'), 'rb').read()
    r = client.get('/data/be-locode.json')
    assert 'Content-Encoding' not in r.headers
    assert r.data == raw
    assert 'Accept-Encoding' in r.headers['Vary']
    assert r.headers['Cache-Control'] == 'public, max-age=3600'


def test_a_repeat_visit_revalidates_with_the_etag(client):
    first = client.get('/data/be-locode.json', headers=GZ)
    again = client.get('/data/be-locode.json', headers={**GZ, 'If-None-Match': first.headers['ETag']})
    assert again.status_code == 304
    assert again.data == b''
    plain = client.get('/data/be-locode.json')
    assert client.get('/data/be-locode.json', headers={'If-None-Match': plain.headers['ETag']}).status_code == 304


def test_hashed_configurator_assets_are_immutable_and_the_page_revalidates(client):
    a = client.get('/configurator/assets/index-abc123.js', headers=GZ)
    assert a.headers['Cache-Control'] == 'public, max-age=31536000, immutable'
    assert a.headers['Content-Encoding'] == 'gzip'
    assert gzip.decompress(a.data).startswith(b'console.log(1);')
    page = client.get('/configurator', headers=GZ)
    assert page.headers['Cache-Control'] == 'no-cache'
    assert page.headers['Content-Encoding'] == 'gzip'
    assert b'vite-index' in gzip.decompress(page.data)


def test_node_list_is_gzipped_with_an_etag_and_a_repeat_gets_304(client, monkeypatch):
    nodes = [{'public_key': f'{i:064x}', 'adv_name': f'Node {i}', 'type': 2} for i in range(200)]
    monkeypatch.setattr(app_module, 'get_all_belgian_nodes', lambda: nodes)
    r = client.get('/api/v1/belgian-nodes', headers=GZ)
    assert r.status_code == 200
    assert r.headers['Content-Encoding'] == 'gzip'
    assert json.loads(gzip.decompress(r.data)) == nodes
    assert r.headers['Cache-Control'] == 'no-cache'
    again = client.get('/api/v1/belgian-nodes', headers={**GZ, 'If-None-Match': r.headers['ETag']})
    assert again.status_code == 304
    nodes.append({'public_key': 'f' * 64, 'adv_name': 'New', 'type': 2})
    changed = client.get('/api/v1/belgian-nodes', headers={**GZ, 'If-None-Match': r.headers['ETag']})
    assert changed.status_code == 200


def test_small_and_other_responses_are_left_alone(client):
    r = client.get('/api/v1/health', headers=GZ)
    assert 'Content-Encoding' not in r.headers
    img = client.get('/favicon-32.png', headers=GZ)
    assert 'Content-Encoding' not in img.headers


def test_geojson_is_served_as_geo_json_and_gzipped(client, monkeypatch):
    import mimetypes
    mimetypes.init()
    monkeypatch.delitem(mimetypes.types_map, '.geojson', raising=False)  # not every image knows it
    raw = open(os.path.join(ROOT, 'data', 'countries.geojson'), 'rb').read()
    r = client.get('/data/countries.geojson', headers=GZ)
    assert r.mimetype == 'application/geo+json'
    assert r.headers['Content-Encoding'] == 'gzip'
    assert gzip.decompress(r.data) == raw


def test_head_answers_with_the_same_headers_as_get(client):
    get = client.get('/data/be-locode.json', headers=GZ)
    head = client.head('/data/be-locode.json', headers=GZ)
    assert head.status_code == 200
    for name in ('Content-Encoding', 'Content-Length', 'ETag', 'Cache-Control'):
        assert head.headers.get(name) == get.headers.get(name), name
