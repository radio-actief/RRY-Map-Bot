"""The stats page's history (GET /api/v1/stats-history): the server replays the node change list
once, as the page did, and keeps the answer per database version like the other stats data.
scripts/stats-history.test.mjs checks the page's numbers from fixtures/stats-history/history.json
against the page's own computation from changes.json."""

import gzip
import json
import os
import sys

import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

import backend.api.app as app_module  # noqa: E402
from backend.stats_history import build_stats_history  # noqa: E402

FIXTURES = os.path.join(os.path.dirname(__file__), 'fixtures', 'stats-history')
GZ = {'Accept-Encoding': 'gzip'}


def fixture(name):
    with open(os.path.join(FIXTURES, name), encoding='utf-8') as f:
        return json.load(f)


def change(i, kind, date, **look):
    row = {'public_key': f'{i:064x}', 'change_type': kind, 'sync_date': date,
           'lat': 50.0 + i, 'lon': 4.0, 'adv_name': f'N{i}', 'type': 2}
    return {**row, **look}


def test_the_fixture_answer_is_the_servers():
    assert build_stats_history(fixture('changes.json')) == fixture('history.json')


def test_a_day_by_day_replay():
    h = build_stats_history([
        change(1, 'added', '2026-11-01T08:00:00'),
        change(2, 'added', '2026-11-01T09:00:00', type=1),
        change(1, 'updated', '2026-11-02T08:00:00'),               # unchanged: no step
        change(3, 'updated', '2026-11-02T09:00:00'),               # not shown: ignored
        change(1, 'updated', '2026-11-03T08:00:00', lat=60.0),     # moved
        change(2, 'removed', '2026-11-03T09:00:00', type=1),
        change(4, 'removed', '2026-11-03T10:00:00'),               # not shown: ignored
        change(2, 'restored', '2026-11-04T08:00:00', type=0),      # type 0 is a companion
    ])
    assert h['days'] == ['2026-11-01', '2026-11-02', '2026-11-03', '2026-11-04']
    assert h['types'] == [[1, 1, 0, 0], [1, 1, 0, 0], [0, 1, 0, 0], [1, 1, 0, 0]]
    assert h['growth'] == [1, 0, 0, 0]
    assert h['looks'] == [[51.0, 4.0, 'N1', 2], [52.0, 4.0, 'N2', 1], [60.0, 4.0, 'N1', 2]]
    assert h['steps'] == [[0, 0, 1, 1], [], [0, 2, -2], [1, 1]]


def test_nothing_to_replay():
    assert build_stats_history([]) == {'days': [], 'types': [], 'growth': [], 'looks': [], 'steps': []}


@pytest.fixture
def client(monkeypatch):
    app_module._gzip_cache.clear()
    app_module._stats_data_cache.clear()
    calls = []

    def changes(**kw):
        calls.append(kw)
        return fixture('changes.json')

    monkeypatch.setattr(app_module, 'get_node_changes_since', changes)
    stamp = {'v': (1, 0)}
    monkeypatch.setattr(app_module, '_db_stamp', lambda: stamp['v'])
    c = app_module.app.test_client()
    c.calls, c.stamp = calls, stamp
    return c


def test_the_answer_is_built_once_per_database_version(client):
    first = client.get('/api/v1/stats-history?limit=15000', headers=GZ)
    assert first.status_code == 200
    assert first.headers['Content-Encoding'] == 'gzip'
    assert first.headers['Cache-Control'] == 'no-cache'
    assert json.loads(gzip.decompress(first.data)) == fixture('history.json')
    assert client.get('/api/v1/stats-history?limit=15000', headers={**GZ, 'If-None-Match': first.headers['ETag']}).status_code == 304
    assert len(client.calls) == 1
    client.stamp['v'] = (2, 0)  # the sync wrote to the database
    client.get('/api/v1/stats-history?limit=15000', headers=GZ)
    assert len(client.calls) == 2


def test_the_same_query_as_the_change_list(client):
    client.get('/api/v1/stats-history?limit=15000&frequency_preset=EU/UK%20(Narrow)')
    client.get('/api/v1/stats-history?limit=99999&frequency_preset=all')
    client.get('/api/v1/stats-history?sf=8&frequency_preset=EU/UK%20(Narrow)')
    client.get('/api/v1/node-changes?limit=15000&frequency_preset=EU/UK%20(Narrow)')
    assert client.calls[0] == {'since_date': None, 'limit': 15000, 'frequency_preset': 'EU/UK (Narrow)', 'radio_custom': None}
    assert client.calls[1]['limit'] == 20000 and client.calls[1]['frequency_preset'] is None
    assert client.calls[2]['frequency_preset'] is None and client.calls[2]['radio_custom']
    assert client.calls[3] == client.calls[0]


def test_a_failed_build_is_a_500_and_not_kept(client, monkeypatch):
    def failing(**kw):
        raise RuntimeError('db locked')

    monkeypatch.setattr(app_module, 'get_node_changes_since', failing)
    assert client.get('/api/v1/stats-history').status_code == 500
    assert not app_module._stats_data_cache
