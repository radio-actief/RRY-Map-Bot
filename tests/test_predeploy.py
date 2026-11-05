"""The pre-deploy step: back up the database, then copy the image's data files into the live data dir."""

import json
import os
import sqlite3
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

from scripts import predeploy  # noqa: E402


def make_live(tmp_path, nodes=3):
    live = tmp_path / 'live'
    live.mkdir()
    conn = sqlite3.connect(live / 'belgian_nodes.db')
    conn.execute('CREATE TABLE belgian_nodes (id INTEGER)')
    conn.executemany('INSERT INTO belgian_nodes VALUES (?)', [(i,) for i in range(nodes)])
    conn.commit()
    conn.close()
    (live / 'be-locode.json').write_text('old')
    (live / 'geocode_failures.log').write_text('log')
    return live


def make_image(tmp_path):
    image = tmp_path / 'image'
    (image / 'data').mkdir(parents=True)
    (image / 'data' / 'be-locode.json').write_text('new')
    (image / 'data' / 'countries.geojson').write_text('{}')
    (image / 'data' / '.gitkeep').write_text('')
    (image / 'package.json').write_text(json.dumps({'version': '1.2.3'}))
    return image


def test_backs_up_the_database_named_after_the_version(tmp_path):
    live, image = make_live(tmp_path), make_image(tmp_path)
    backup = predeploy.run(image, live, stamp='20261102-1300')
    assert backup.name == 'belgian_nodes_BU-pre-1.2.3-20261102-1300.db'
    conn = sqlite3.connect(backup)
    assert conn.execute('SELECT count(*) FROM belgian_nodes').fetchone() == (3,)
    assert conn.execute('PRAGMA integrity_check').fetchone() == ('ok',)


def test_copies_only_json_and_geojson_and_leaves_the_rest(tmp_path):
    live, image = make_live(tmp_path), make_image(tmp_path)
    predeploy.run(image, live, stamp='20261102-1300')
    assert (live / 'be-locode.json').read_text() == 'new'
    assert (live / 'countries.geojson').read_text() == '{}'
    assert not (live / '.gitkeep').exists()
    assert (live / 'geocode_failures.log').read_text() == 'log'


def test_keeps_only_the_newest_release_backups(tmp_path):
    live, image = make_live(tmp_path), make_image(tmp_path)
    for i in range(7):
        (live / f'belgian_nodes_BU-pre-1.0.{i}-2026110{i}-1200.db').write_text('x')
    (live / 'belgian_nodes_BU-20260618.db').write_text('manual')
    predeploy.run(image, live, stamp='20261108-1300', keep=5)
    kept = sorted(p.name for p in live.glob('belgian_nodes_BU-pre-*.db'))
    assert len(kept) == 5
    assert 'belgian_nodes_BU-pre-1.2.3-20261108-1300.db' in kept
    assert 'belgian_nodes_BU-pre-1.0.0-20261100-1200.db' not in kept
    assert (live / 'belgian_nodes_BU-20260618.db').exists()


def test_no_database_yet_still_copies_the_data(tmp_path):
    live, image = make_live(tmp_path), make_image(tmp_path)
    (live / 'belgian_nodes.db').unlink()
    assert predeploy.run(image, live, stamp='20261102-1300') is None
    assert (live / 'be-locode.json').read_text() == 'new'
    assert not (live / 'belgian_nodes.db').exists()
