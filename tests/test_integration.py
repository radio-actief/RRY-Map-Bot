"""
Integration tests for RRY-Map-Bot: node lifecycle (add / remove / restore),
inactive-node filtering, Discord ownership and statistics, all against a
temporary database.
"""

import os
import sqlite3
import sys

import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

from backend.database import get_connection, get_current_timestamp, dict_from_row  # noqa: E402
from backend.discord_queries import (  # noqa: E402
    query_nodes_substring,
    get_user_nodes,
    get_statistics,
    update_ownership,
    remove_ownership,
    verify_ownership,
)
from backend.sync_belgian_nodes import (  # noqa: E402
    integrate_added_node,
    integrate_removed_node,
    restore_removed_node,
)


def make_node(public_key, **overrides):
    now = get_current_timestamp()
    node = {
        'public_key': public_key,
        'type': 1,
        'adv_name': f'Node {public_key}',
        'adv_lat': 50.5,
        'adv_lon': 4.5,
        'city': 'Brussels',
        'last_advert': now,
        'inserted_date': now,
        'updated_date': now,
        'params': {'freq': 869.525, 'sf': 10, 'bw': 250, 'cr': 5},
        'link': f'meshcore://{public_key}',
        'source': 'app',
        'inserted_by': 'test',
        'updated_by': 'test',
    }
    node.update(overrides)
    return node


@pytest.fixture
def conn(temp_db):
    c = get_connection()
    yield c
    c.close()


def fetch(conn, public_key):
    row = conn.execute("SELECT * FROM belgian_nodes WHERE public_key = ?", (public_key,)).fetchone()
    return dict_from_row(row) if row else None


def test_node_lifecycle_add(conn):
    node = make_node('test_key_001', adv_name='Test Node 1')
    integrate_added_node(node, conn)
    conn.commit()

    row = fetch(conn, 'test_key_001')
    assert row is not None
    assert row['is_active'] is True
    assert row['adv_name'] == 'Test Node 1'


def test_node_lifecycle_remove(conn):
    node = make_node('test_key_002', type=2)
    integrate_added_node(node, conn)
    conn.commit()

    integrate_removed_node(node['public_key'], conn)
    conn.commit()

    row = fetch(conn, 'test_key_002')
    assert row['is_active'] is False
    assert row['removed_from_official'] is True
    assert row['removed_date'] is not None


def test_node_lifecycle_restore_keeps_discord_owner(conn):
    node = make_node('test_key_003', type=3)
    integrate_added_node(node, conn)
    conn.execute(
        "UPDATE belgian_nodes SET discord_owner_id = '123456789', discord_owner_name = 'TestUser' "
        "WHERE public_key = ?",
        (node['public_key'],),
    )
    conn.commit()
    integrate_removed_node(node['public_key'], conn)
    conn.commit()

    node['adv_name'] = 'Test Node 3 Updated'
    restore_removed_node(node, conn)
    conn.commit()

    row = fetch(conn, 'test_key_003')
    assert row['is_active'] is True
    assert row['removed_from_official'] is False
    assert row['removed_date'] is None
    assert row['adv_name'] == 'Test Node 3 Updated'
    assert row['discord_owner_id'] == '123456789'
    assert row['discord_owner_name'] == 'TestUser'


def test_inactive_nodes_are_left_out_of_search(conn):
    integrate_added_node(make_node('active_key_001', adv_name='Active Node'), conn)
    integrate_added_node(make_node('inactive_key_001', adv_name='Inactive Node'), conn)
    conn.execute("UPDATE belgian_nodes SET is_active = 0 WHERE public_key = 'inactive_key_001'")
    conn.commit()

    keys = {n['public_key'] for n in query_nodes_substring('Node')}
    assert 'active_key_001' in keys
    assert 'inactive_key_001' not in keys


def test_claim_and_unclaim(conn):
    integrate_added_node(make_node('claim_test_001'), conn)
    conn.commit()

    assert update_ownership('claim_test_001', 'test_user_123', 'TestUser')
    assert verify_ownership('claim_test_001', 'test_user_123')
    assert any(n['public_key'] == 'claim_test_001' for n in get_user_nodes('test_user_123'))

    assert remove_ownership('claim_test_001', 'test_user_123')
    assert not verify_ownership('claim_test_001', 'test_user_123')


def test_claim_logs_node_claims(conn, temp_db):
    integrate_added_node(make_node('claim_log_001'), conn)
    conn.commit()

    assert update_ownership('claim_log_001', '111', 'alice')

    check = sqlite3.connect(temp_db)
    rows = check.execute(
        "SELECT public_key, action, discord_owner_id FROM node_claims "
        "WHERE public_key = ? ORDER BY id",
        ('claim_log_001',),
    ).fetchall()
    check.close()
    assert rows == [('claim_log_001', 'claim', '111')]


def test_statistics(conn):
    for i in range(5):
        integrate_added_node(
            make_node(f'stats_test_{i:03d}', type=(i % 4) + 1,
                      adv_lat=50.5 + i * 0.01, adv_lon=4.5 + i * 0.01),
            conn,
        )
    conn.commit()

    stats = get_statistics()
    assert 'by_type' in stats
    assert stats['total_nodes'] >= 5
