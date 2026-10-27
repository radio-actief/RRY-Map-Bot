"""Tests for the sync freshness check (endpoint and container healthcheck)."""

import os
import sqlite3
import sys
from datetime import datetime, timedelta, timezone

import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

import backend.sync_health as sh  # noqa: E402

NOW = datetime(2026, 10, 27, 12, 0, 0, tzinfo=timezone.utc)


def add_history(db_path, minutes_ago, details='{"error_count": 0}'):
    ts = (NOW - timedelta(minutes=minutes_ago)).strftime('%Y-%m-%dT%H:%M:%SZ')
    conn = sqlite3.connect(db_path)
    conn.execute('INSERT INTO sync_history (sync_date, details) VALUES (?, ?)', (ts, details))
    conn.commit()
    conn.close()


@pytest.fixture
def interval_30(monkeypatch):
    monkeypatch.setenv('SYNC_INTERVAL_MINUTES', '30')


def test_fresh_sync_is_ok(temp_db, interval_30):
    add_history(temp_db, 200)
    add_history(temp_db, 10)
    body, status = sh.get_sync_health(now=NOW)
    assert status == 200
    assert body['status'] == 'ok'
    assert body['last_sync_utc'] == '2026-10-27T11:50:00Z'
    assert body['age_minutes'] == 10
    assert body['stale_after_minutes'] == 60


def test_old_sync_is_stale(temp_db, interval_30):
    add_history(temp_db, 61)
    body, status = sh.get_sync_health(now=NOW)
    assert status == 503
    assert body['status'] == 'stale'
    assert body['age_minutes'] == 61


def test_no_history_is_unhealthy(temp_db, interval_30):
    body, status = sh.get_sync_health(now=NOW)
    assert status == 503
    assert body['status'] == 'no_history'
    assert body['last_sync_utc'] is None


def test_missing_database_is_no_history(tmp_path, monkeypatch, interval_30):
    monkeypatch.setenv('DATABASE_PATH', str(tmp_path / 'absent.db'))
    body, status = sh.get_sync_health(now=NOW)
    assert (status, body['status']) == (503, 'no_history')
    assert not (tmp_path / 'absent.db').exists()


def test_last_run_facts_are_reported(temp_db, interval_30):
    add_history(temp_db, 5, '{"error_count": 2, "removal_safety": {"held_count": 30}}')
    body, _ = sh.get_sync_health(now=NOW)
    assert body['last_run'] == {'error_count': 2, 'removals_held': 30}


@pytest.mark.parametrize('env,minutes', [
    ({}, 360),
    ({'SYNC_INTERVAL_HOURS': '2'}, 120),
    ({'SYNC_INTERVAL_MINUTES': '30', 'SYNC_INTERVAL_HOURS': '2'}, 30),
])
def test_interval_follows_the_sync_loop_env(monkeypatch, env, minutes):
    monkeypatch.delenv('SYNC_INTERVAL_MINUTES', raising=False)
    monkeypatch.delenv('SYNC_INTERVAL_HOURS', raising=False)
    for k, v in env.items():
        monkeypatch.setenv(k, v)
    assert sh.sync_interval_minutes() == minutes


def test_check_script_exit_codes(temp_db, interval_30, monkeypatch, capsys):
    monkeypatch.setattr(sh, '_utcnow', lambda: NOW)
    assert sh.main() == 1
    add_history(temp_db, 10)
    assert sh.main() == 0
    assert '"status": "ok"' in capsys.readouterr().out


def test_endpoint(temp_db, interval_30, monkeypatch):
    import backend.api.app as api
    monkeypatch.setattr(sh, '_utcnow', lambda: NOW)
    client = api.app.test_client()

    r = client.get('/api/v1/health/sync')
    assert r.status_code == 503
    assert r.get_json()['status'] == 'no_history'

    add_history(temp_db, 10)
    r = client.get('/api/v1/health/sync')
    assert r.status_code == 200
    assert r.get_json()['status'] == 'ok'

    # The plain health check stays as it was.
    r = client.get('/api/v1/health')
    assert r.status_code == 200
    assert r.get_json() == {'status': 'healthy', 'service': 'RRY-Map-Bot API'}
