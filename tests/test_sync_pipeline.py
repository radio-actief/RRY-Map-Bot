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


# --- nodes outside Belgium (local geocoder) -------------------------------

def test_active_node_moving_abroad_is_removed_after_two_runs(run):
    run(base_feed())
    abroad = replace(base_feed(), 'be03', adv_lat=GERMANY[0], adv_lon=GERMANY[1])

    first = run(abroad)
    assert first['changes']['removed'] == []
    assert node_row('be03')['is_active'] is True

    second = run(abroad)
    assert second['changes']['removed'] == ['be03']
    assert node_row('be03')['is_active'] is False
    assert change_types('be03')[-1] == 'removed'


def test_node_one_run_abroad_then_back_stays_active(run):
    run(base_feed())
    abroad = replace(base_feed(), 'be03', adv_lat=GERMANY[0], adv_lon=GERMANY[1])
    run(abroad)
    run(base_feed())
    run(abroad)  # the miss counter starts over after a run back inside
    assert node_row('be03')['is_active'] is True
    assert 'removed' not in change_types('be03')


def test_inactive_node_reappearing_abroad_is_not_restored(run):
    run(base_feed())
    run(without(base_feed(), 'be03'))
    abroad = replace(base_feed(), 'be03', adv_lat=GERMANY[0], adv_lon=GERMANY[1])
    run(abroad)
    run(abroad)
    assert node_row('be03')['is_active'] is False
    assert 'restored' not in change_types('be03')


# --- geocode_failures.log --------------------------------------------------

def geocode_log_lines(temp_db):
    path = os.path.join(os.path.dirname(temp_db), 'geocode_failures.log')
    if not os.path.exists(path):
        return []
    with open(path, encoding='utf-8') as f:
        return [line.rstrip('\n').split('\t') for line in f]


def test_geocode_log_lists_each_foreign_node_once(run, temp_db):
    feed = base_feed() + [
        feed_node('de01', *GERMANY),
        feed_node('de02', GERMANY[0] + 0.01, GERMANY[1]),
        feed_node('nl01', 51.45, 5.48),  # Eindhoven
    ]
    for _ in range(3):
        run(feed)

    lines = geocode_log_lines(temp_db)
    node_lines = [l for l in lines if l[4] != 'summary']
    summaries = [l for l in lines if l[4] == 'summary']
    assert sorted(l[1] for l in node_lines) == ['de01', 'de02', 'nl01']
    assert all(l[4] == 'dropped' for l in node_lines)
    assert len(summaries) == 3
    assert summaries[0][6].startswith('3 outside Belgium, 3 new')
    assert summaries[-1][6].startswith('3 outside Belgium, 0 new')


def test_geocode_log_records_when_a_result_changes(run, temp_db):
    run(base_feed())
    abroad = replace(base_feed(), 'be03', adv_lat=GERMANY[0], adv_lon=GERMANY[1])
    run(abroad)
    run(abroad)
    run(abroad)
    run(base_feed())

    actions = [l[4] for l in geocode_log_lines(temp_db) if l[1] == 'be03']
    assert actions == ['kept_pending', 'dropped', 'cleared']


def test_geocode_log_rotates_at_size_cap(tmp_path, monkeypatch):
    log = tmp_path / 'geocode_failures.log'
    monkeypatch.setattr(sync, 'GEOCODE_LOG_MAX_BYTES', 100)
    for i in range(6):
        log.write_text(f'run {i}\n' + 'x' * 120)
        sync._rotate_geocode_log(log)
    names = sorted(p.name for p in tmp_path.iterdir())
    assert names == ['geocode_failures.log.1', 'geocode_failures.log.2', 'geocode_failures.log.3']
    assert (tmp_path / 'geocode_failures.log.1').read_text().startswith('run 5')


def test_oversized_old_geocode_log_is_set_aside_not_deleted(tmp_path, monkeypatch):
    log = tmp_path / 'geocode_failures.log'
    monkeypatch.setattr(sync, 'GEOCODE_LOG_MAX_BYTES', 100)
    log.write_text('old\n' + 'x' * 5000)
    sync._rotate_geocode_log(log)
    assert (tmp_path / 'geocode_failures.log.legacy').read_text().startswith('old')
    assert not log.exists()


# --- mass-removal safety cap -----------------------------------------------
# 25 active nodes: more than 5 % (i.e. 2 or more) missing at once trips the cap.

def padding(count=20):
    """Nodes far outside the Belgian box (Paris area): they only make the feed bigger."""
    return [feed_node(f'fr{i:02d}', 48.80 + i * 0.001, 2.30) for i in range(count)]


def test_safety_cap_skip_is_recorded_in_sync_history(run):
    run(base_feed())
    result = run(without(base_feed(), 'be01', 'be02'))
    assert result['changes']['removed'] == []
    assert node_row('be01')['is_active'] is True

    last = history_rows()[-1]
    assert last['nodes_removed'] == 0
    safety = last['details']['removal_safety']
    assert safety['held_count'] == 2
    assert sorted(safety['held_keys']) == ['be01', 'be02']
    assert safety['applied_count'] == 0


def test_safety_cap_applies_removals_on_third_consistent_run(run):
    run(base_feed())
    missing = without(base_feed(), 'be01', 'be02')
    run(missing)
    run(missing)
    assert node_row('be01')['is_active'] is True

    third = run(missing)
    assert sorted(third['changes']['removed']) == ['be01', 'be02']
    assert node_row('be01')['is_active'] is False
    assert node_row('be02')['is_active'] is False
    assert history_rows()[-1]['details']['removal_safety']['applied_count'] == 2


def test_safety_cap_holds_while_the_feed_is_shrunk(run):
    run(base_feed() + padding())
    shrunk = without(base_feed(), 'be01', 'be02')  # feed drops from 45 to 23 nodes
    for _ in range(4):
        result = run(shrunk)
        assert result['changes']['removed'] == []
    assert node_row('be01')['is_active'] is True

    back = run(without(base_feed(), 'be01', 'be02') + padding())
    assert sorted(back['changes']['removed']) == ['be01', 'be02']


def test_safety_cap_count_starts_over_when_nodes_return(run):
    run(base_feed())
    missing = without(base_feed(), 'be01', 'be02')
    run(missing)
    run(missing)
    run(base_feed())
    run(missing)
    assert node_row('be01')['is_active'] is True
    assert history_rows()[-1]['details']['removal_safety']['held_count'] == 2
