"""GET /api/v1/version: the release the site runs, for the ☰ menu's About box."""

import json
import os
import sys

import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

import backend.api.app as app_module  # noqa: E402

CHANGELOG = """# Changelog

What changed.

## 1.2.3 (2026-11-02)

The intro line.

### New

- First new thing
- Second new thing

### Fixed

- A fix

## 1.2.2 (2026-10-01)

### Fixed

- Older fix
"""


@pytest.fixture
def client(tmp_path, monkeypatch):
    (tmp_path / 'package.json').write_text(json.dumps({'name': 'rry-map-bot', 'version': '1.2.3'}))
    (tmp_path / 'CHANGELOG.md').write_text(CHANGELOG)
    monkeypatch.setattr(app_module, 'PROJECT_ROOT', str(tmp_path))
    app_module.release_info.cache_clear()
    yield app_module.app.test_client()
    app_module.release_info.cache_clear()


def test_version_gives_the_release_its_date_and_notes(client):
    r = client.get('/api/v1/version')
    assert r.status_code == 200
    body = r.get_json()
    assert body['version'] == '1.2.3'
    assert body['released'] == '2026-11-02'
    assert body['intro'] == 'The intro line.'
    assert body['changes'] == [
        {'group': 'New', 'items': ['First new thing', 'Second new thing']},
        {'group': 'Fixed', 'items': ['A fix']},
    ]
    assert body['notes_url'] == 'https://github.com/radio-actief/RRY-Map-Bot/blob/v1.2.3/CHANGELOG.md'
    assert body['source_url'] == 'https://github.com/radio-actief/RRY-Map-Bot'


def test_version_says_nothing_about_the_environment(client):
    body = client.get('/api/v1/version').get_json()
    assert set(body) == {'version', 'released', 'intro', 'changes', 'notes_url', 'source_url'}


def test_a_version_without_notes_still_answers(client, tmp_path):
    (tmp_path / 'CHANGELOG.md').write_text('# Changelog\n')
    app_module.release_info.cache_clear()
    body = client.get('/api/v1/version').get_json()
    assert body['version'] == '1.2.3'
    assert body['released'] is None
    assert body['changes'] == []


def test_no_changelog_at_all_still_answers(client, tmp_path):
    (tmp_path / 'CHANGELOG.md').unlink()
    app_module.release_info.cache_clear()
    assert client.get('/api/v1/version').get_json()['changes'] == []


def test_the_real_changelog_has_the_real_version():
    app_module.release_info.cache_clear()
    info = app_module.release_info()
    pkg = json.load(open(os.path.join(os.path.dirname(__file__), '..', 'package.json')))
    assert info['version'] == pkg['version']
    assert info['released'] is not None
