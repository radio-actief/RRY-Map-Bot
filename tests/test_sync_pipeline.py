"""
End-to-end tests for ``sync_belgian_nodes()``: a fixture feed instead of the
official API, the real local geocoder, and a temporary database.
"""

import copy
import os
import sys

import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

import backend.sync_belgian_nodes as sync  # noqa: E402
from backend.database import get_connection, dict_from_row  # noqa: E402

GEOJSON = os.path.join(os.path.dirname(__file__), '..', 'data', 'be-municipalities.geojson')

# Inside the Belgian bounding box but outside Belgium (Germany, near Aachen).
GERMANY = (50.7753, 6.0839)
BRUSSELS = (50.8467, 4.3525)


def feed_node(key, lat, lon, **overrides):
    node = {
        'public_key': key,
        'type': 2,
        'adv_name': f'Node {key}',
        'adv_lat': lat,
        'adv_lon': lon,
        'last_advert': '2026-10-01T10:00:00.000Z',
        'inserted_date': '2026-09-01T10:00:00.000Z',
        'updated_date': '2026-10-01T10:00:00.000Z',
        'params': {'freq': 869.618, 'sf': 8, 'bw': 62.5, 'cr': 8},
        'link': f'meshcore://{key}',
        'source': 'uploader',
        'inserted_by': 'uploader1',
        'updated_by': 'uploader1',
    }
    node.update(overrides)
    return node


def base_feed(count=25):
    """``count`` Belgian nodes in Antwerp / Flemish Brabant."""
    return [
        feed_node(f'be{i:02d}', 50.90 + (i % 5) * 0.02, 4.40 + (i // 5) * 0.05)
        for i in range(count)
    ]


def without(feed, *keys):
    return [n for n in feed if n['public_key'] not in keys]


def replace(feed, key, **changes):
    out = copy.deepcopy(feed)
    for n in out:
        if n['public_key'] == key:
            n.update(changes)
    return out


@pytest.fixture(autouse=True)
def _geojson_present():
    if not os.path.isfile(GEOJSON):
        pytest.skip('missing data/be-municipalities.geojson')


@pytest.fixture
def run(temp_db, monkeypatch):
    """Run one sync against ``feed``; returns the sync result dict."""
    monkeypatch.delenv('USE_GEOPY_FALLBACK', raising=False)

    def _run(feed):
        monkeypatch.setattr(sync, 'download_official_nodes', lambda: copy.deepcopy(feed))
        return sync.sync_belgian_nodes()

    return _run


def node_row(key):
    conn = get_connection()
    try:
        row = conn.execute('SELECT * FROM belgian_nodes WHERE public_key = ?', (key,)).fetchone()
        return dict_from_row(row) if row else None
    finally:
        conn.close()


def change_types(key):
    conn = get_connection()
    try:
        return [r[0] for r in conn.execute(
            'SELECT change_type FROM node_changes WHERE public_key = ? ORDER BY id', (key,))]
    finally:
        conn.close()


def history_rows():
    conn = get_connection()
    try:
        return [dict_from_row(r) for r in conn.execute('SELECT * FROM sync_history ORDER BY id')]
    finally:
        conn.close()


def test_first_run_adds_belgian_nodes_with_city(run):
    result = run(base_feed())
    assert result['success']
    assert result['changes']['added_count'] == 25
    row = node_row('be00')
    assert row['is_active'] is True
    assert row['city']
    assert row['last_advert'] == '2026-10-01T10:00:00Z'


def test_second_identical_run_changes_nothing(run):
    run(base_feed())
    result = run(base_feed())
    changes = result['changes']
    assert (changes['added_count'], changes['removed_count'],
            changes['restored_count'], changes['updated_count']) == (0, 0, 0, 0)
    assert change_types('be00') == ['added']


def test_changed_node_is_updated(run):
    run(base_feed())
    result = run(replace(base_feed(), 'be01', adv_name='Renamed'))
    assert result['changes']['updated'] == ['be01']
    assert node_row('be01')['adv_name'] == 'Renamed'
    assert change_types('be01') == ['added', 'updated']


def test_node_missing_from_feed_is_removed(run):
    run(base_feed())
    result = run(without(base_feed(), 'be03'))
    assert result['changes']['removed'] == ['be03']
    assert node_row('be03')['is_active'] is False
    assert change_types('be03') == ['added', 'removed']


def test_removed_node_that_returns_is_restored(run):
    run(base_feed())
    run(without(base_feed(), 'be03'))
    result = run(base_feed())
    assert result['changes']['restored'] == ['be03']
    assert node_row('be03')['is_active'] is True
    assert change_types('be03') == ['added', 'removed', 'restored']


def test_new_foreign_node_is_never_added(run):
    feed = base_feed() + [feed_node('de01', *GERMANY)]
    run(feed)
    run(feed)
    assert node_row('de01') is None


def test_sync_history_row_per_run(run):
    run(base_feed())
    run(base_feed())
    rows = history_rows()
    assert len(rows) == 2
    assert rows[0]['nodes_added'] == 25


def test_node_without_source_does_not_break_the_sync(run):
    run(base_feed())
    conn = get_connection()
    conn.execute("UPDATE belgian_nodes SET source = NULL WHERE public_key = 'be03'")
    conn.commit()
    conn.close()

    result = run(without(base_feed(), 'be03'))
    assert result['success']
    assert result['changes']['removed'] == ['be03']


def test_restored_node_gets_canonical_timestamps(run):
    run(base_feed())
    run(without(base_feed(), 'be03'))
    run(base_feed())
    row = node_row('be03')
    assert row['last_advert'] == '2026-10-01T10:00:00Z'
    assert row['updated_date'] == '2026-10-01T10:00:00Z'

    run(base_feed())
    assert change_types('be03') == ['added', 'removed', 'restored']
