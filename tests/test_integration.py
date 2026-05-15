"""
Integration Tests for RRY-Map-Bot
Tests complete workflow, node lifecycle, Discord bot queries, web map API, and conflict resolution.
"""

import sys
import os
import sqlite3
import json
from datetime import datetime, timedelta
from typing import Dict, Any, List

# Add parent directory to path
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

from backend.database import (
    get_connection,
    get_current_timestamp,
    dict_from_row,
    json_serialize,
    json_deserialize
)
from datetime import datetime, timedelta
from backend.discord_queries import (
    query_nodes_substring,
    get_user_nodes,
    get_statistics,
    update_ownership,
    remove_ownership,
    verify_ownership
)
from backend.sync_belgian_nodes import (
    track_changes,
    integrate_added_node,
    integrate_removed_node,
    restore_removed_node,
    merge_node_update,
)


class IntegrationTestSuite:
    """Integration test suite for RRY-Map-Bot."""
    
    def __init__(self, test_db_path: str = None):
        """Initialize test suite with optional test database."""
        if test_db_path:
            self.db_path = test_db_path
        else:
            # Use a test database
            self.db_path = os.path.join(
                os.path.dirname(__file__), '..', 'data', 'test_belgian_nodes.db'
            )

        # Ensure test database directory exists
        os.makedirs(os.path.dirname(self.db_path), exist_ok=True)

        # Remove existing test database
        if os.path.exists(self.db_path):
            os.remove(self.db_path)

        # Pin DATABASE_PATH env var so backend.database.get_db_path() always
        # resolves to this test DB (env var takes precedence over module-level
        # DATABASE_PATH, which makes Python-side rebinding alone insufficient
        # in containers where DATABASE_PATH is set in .env).
        self._old_env_db = os.environ.get('DATABASE_PATH')
        os.environ['DATABASE_PATH'] = self.db_path

        self.test_results = []
        self.passed = 0
        self.failed = 0
    
    def get_connection(self):
        """Get database connection."""
        # Temporarily override DATABASE_PATH
        import backend.database as db_module
        original_path = db_module.DATABASE_PATH
        db_module.DATABASE_PATH = self.db_path
        
        try:
            conn = sqlite3.connect(self.db_path)
            conn.row_factory = sqlite3.Row
            return conn
        finally:
            db_module.DATABASE_PATH = original_path
    
    def setup_test_database(self):
        """Set up test database schema using actual database initialization."""
        # Temporarily override DATABASE_PATH
        import backend.database as db_module
        original_path = db_module.DATABASE_PATH
        db_module.DATABASE_PATH = self.db_path
        
        try:
            # Use actual database initialization
            from backend.database import init_database
            init_database()
            print("✓ Test database initialized")
        finally:
            # Restore original path
            db_module.DATABASE_PATH = original_path
    
    def get_test_connection(self):
        """Get database connection for test operations."""
        # Temporarily override DATABASE_PATH
        import backend.database as db_module
        original_path = db_module.DATABASE_PATH
        db_module.DATABASE_PATH = self.db_path
        
        try:
            from backend.database import get_connection
            return get_connection()
        finally:
            db_module.DATABASE_PATH = original_path
    
    def test(self, name: str, func):
        """Run a test and record results."""
        try:
            print(f"\n{'='*60}")
            print(f"TEST: {name}")
            print(f"{'='*60}")
            result = func()
            if result:
                self.passed += 1
                self.test_results.append((name, True, None))
                print(f"✓ PASSED: {name}")
            else:
                self.failed += 1
                self.test_results.append((name, False, "Test returned False"))
                print(f"✗ FAILED: {name}")
        except Exception as e:
            self.failed += 1
            self.test_results.append((name, False, str(e)))
            print(f"✗ FAILED: {name} - {e}")
            import traceback
            traceback.print_exc()
    
    # ========================================================================
    # Test Functions
    # ========================================================================
    
    def test_node_lifecycle_add(self):
        """Test adding a new node."""
        conn = self.get_test_connection()
        
        # Create a test node
        test_node = {
            'public_key': 'test_key_001',
            'type': 1,
            'adv_name': 'Test Node 1',
            'adv_lat': 50.5,
            'adv_lon': 4.5,
            'city': 'Brussels',
            'last_advert': get_current_timestamp(),
            'inserted_date': get_current_timestamp(),
            'updated_date': get_current_timestamp(),
            'params': {'freq': 869.525, 'sf': 10, 'bw': 250, 'cr': 5},
            'link': 'meshcore://test',
            'source': 'app',
            'inserted_by': 'test_companion',
            'updated_by': 'test_companion'
        }
        
        # Integrate the node
        integrate_added_node(test_node, conn)
        conn.commit()
        
        # Verify node was added
        cursor = conn.cursor()
        cursor.execute("SELECT * FROM belgian_nodes WHERE public_key = ?", (test_node['public_key'],))
        row = cursor.fetchone()
        conn.close()
        
        if not row:
            return False
        
        node = dict_from_row(row)
        return (
            node['public_key'] == test_node['public_key'] and
            node['is_active'] == 1 and
            node['adv_name'] == test_node['adv_name']
        )
    
    def test_node_lifecycle_remove(self):
        """Test removing a node (marking inactive)."""
        conn = self.get_test_connection()
        
        # First add a node
        test_node = {
            'public_key': 'test_key_002',
            'type': 2,
            'adv_name': 'Test Node 2',
            'adv_lat': 50.6,
            'adv_lon': 4.6,
            'city': 'Antwerp',
            'last_advert': get_current_timestamp(),
            'inserted_date': get_current_timestamp(),
            'updated_date': get_current_timestamp(),
            'params': {'freq': 869.525, 'sf': 10, 'bw': 250, 'cr': 5},
            'link': 'meshcore://test2',
            'source': 'app',
            'inserted_by': 'test_companion',
            'updated_by': 'test_companion'
        }
        
        integrate_added_node(test_node, conn)
        conn.commit()
        
        # Now remove it
        integrate_removed_node(test_node['public_key'], conn)
        conn.commit()
        
        # Verify node is inactive
        cursor = conn.cursor()
        cursor.execute("SELECT * FROM belgian_nodes WHERE public_key = ?", (test_node['public_key'],))
        row = cursor.fetchone()
        conn.close()
        
        if not row:
            return False
        
        node = dict_from_row(row)
        return (
            node['is_active'] == 0 and
            node['removed_from_official'] == 1 and
            node['removed_date'] is not None
        )
    
    def test_node_lifecycle_restore(self):
        """Test restoring a previously removed node."""
        conn = self.get_test_connection()
        
        # Add and remove a node first
        test_node = {
            'public_key': 'test_key_003',
            'type': 3,
            'adv_name': 'Test Node 3',
            'adv_lat': 50.7,
            'adv_lon': 4.7,
            'city': 'Ghent',
            'last_advert': get_current_timestamp(),
            'inserted_date': get_current_timestamp(),
            'updated_date': get_current_timestamp(),
            'params': {'freq': 869.525, 'sf': 10, 'bw': 250, 'cr': 5},
            'link': 'meshcore://test3',
            'source': 'app',
            'inserted_by': 'test_companion',
            'updated_by': 'test_companion'
        }
        
        integrate_added_node(test_node, conn)
        conn.commit()
        
        # Set Discord ownership before removal
        cursor = conn.cursor()
        cursor.execute("""
            UPDATE belgian_nodes 
            SET discord_owner_id = '123456789', 
                discord_owner_name = 'TestUser'
            WHERE public_key = ?
        """, (test_node['public_key'],))
        conn.commit()
        
        # Remove it
        integrate_removed_node(test_node['public_key'], conn)
        conn.commit()
        
        # Update the node data (simulate official map update)
        test_node['adv_name'] = 'Test Node 3 Updated'
        test_node['updated_date'] = get_current_timestamp()
        
        # Restore it
        restore_removed_node(test_node, conn)
        conn.commit()
        
        # Verify node is active and ownership preserved
        cursor.execute("SELECT * FROM belgian_nodes WHERE public_key = ?", (test_node['public_key'],))
        row = cursor.fetchone()
        conn.close()
        
        if not row:
            return False
        
        node = dict_from_row(row)
        return (
            node['is_active'] == 1 and
            node['removed_from_official'] == 0 and
            node['removed_date'] is None and
            node['adv_name'] == 'Test Node 3 Updated' and
            node['discord_owner_id'] == '123456789' and
            node['discord_owner_name'] == 'TestUser'
        )
    
    def test_inactive_node_filtering(self):
        """Test that inactive nodes are filtered from queries."""
        conn = self.get_test_connection()
        
        # Add active node
        active_node = {
            'public_key': 'active_key_001',
            'type': 1,
            'adv_name': 'Active Node',
            'adv_lat': 50.5,
            'adv_lon': 4.5,
            'city': 'Brussels',
            'last_advert': get_current_timestamp(),
            'inserted_date': get_current_timestamp(),
            'updated_date': get_current_timestamp(),
            'params': {'freq': 869.525, 'sf': 10, 'bw': 250, 'cr': 5},
            'link': 'meshcore://active',
            'source': 'app',
            'inserted_by': 'test',
            'updated_by': 'test'
        }
        
        # Add inactive node
        inactive_node = {
            'public_key': 'inactive_key_001',
            'type': 1,
            'adv_name': 'Inactive Node',
            'adv_lat': 50.6,
            'adv_lon': 4.6,
            'city': 'Antwerp',
            'last_advert': get_current_timestamp(),
            'inserted_date': get_current_timestamp(),
            'updated_date': get_current_timestamp(),
            'params': {'freq': 869.525, 'sf': 10, 'bw': 250, 'cr': 5},
            'link': 'meshcore://inactive',
            'source': 'app',
            'inserted_by': 'test',
            'updated_by': 'test'
        }
        
        integrate_added_node(active_node, conn)
        integrate_added_node(inactive_node, conn)
        conn.commit()
        
        # Mark inactive node as inactive
        cursor = conn.cursor()
        cursor.execute("""
            UPDATE belgian_nodes 
            SET is_active = 0 
            WHERE public_key = ?
        """, (inactive_node['public_key'],))
        conn.commit()
        
        # Test search query (should only return active nodes)
        # Temporarily override DATABASE_PATH for query
        import backend.database as db_module
        original_path = db_module.DATABASE_PATH
        db_module.DATABASE_PATH = self.db_path
        try:
            results = query_nodes_substring('Node')
        finally:
            db_module.DATABASE_PATH = original_path
        
        # Verify only active node is returned
        active_found = any(node['public_key'] == 'active_key_001' for node in results)
        inactive_found = any(node['public_key'] == 'inactive_key_001' for node in results)
        
        conn.close()
        
        return active_found and not inactive_found
    
    def test_discord_ownership_workflow(self):
        """Test claiming and unclaiming nodes."""
        conn = self.get_test_connection()
        
        # Add a test node
        test_node = {
            'public_key': 'claim_test_001',
            'type': 1,
            'adv_name': 'Claim Test Node',
            'adv_lat': 50.5,
            'adv_lon': 4.5,
            'city': 'Brussels',
            'last_advert': get_current_timestamp(),
            'inserted_date': get_current_timestamp(),
            'updated_date': get_current_timestamp(),
            'params': {'freq': 869.525, 'sf': 10, 'bw': 250, 'cr': 5},
            'link': 'meshcore://claim',
            'source': 'app',
            'inserted_by': 'test',
            'updated_by': 'test'
        }
        
        integrate_added_node(test_node, conn)
        conn.commit()
        
        # Temporarily override DATABASE_PATH for queries
        import backend.database as db_module
        original_path = db_module.DATABASE_PATH
        db_module.DATABASE_PATH = self.db_path
        
        try:
            # Claim the node
            user_id = 'test_user_123'
            user_name = 'TestUser'
            success = update_ownership(test_node['public_key'], user_id, user_name)
            
            if not success:
                conn.close()
                return False
            
            # Verify ownership
            is_owner = verify_ownership(test_node['public_key'], user_id)
            
            if not is_owner:
                conn.close()
                return False
            
            # Get user's nodes
            user_nodes = get_user_nodes(user_id)
            has_node = any(node['public_key'] == test_node['public_key'] for node in user_nodes)
            
            if not has_node:
                conn.close()
                return False
            
            # Unclaim the node
            success = remove_ownership(test_node['public_key'], user_id)
            
            if not success:
                conn.close()
                return False
            
            # Verify ownership removed
            is_owner_after = verify_ownership(test_node['public_key'], user_id)
            conn.close()
            
            return not is_owner_after
        finally:
            db_module.DATABASE_PATH = original_path
    
    def test_claim_logs_node_claims(self):
        """A successful /node claim must append a 'claim' row to node_claims."""
        conn = self.get_test_connection()

        test_node = {
            'public_key': 'claim_log_001',
            'type': 1,
            'adv_name': 'Claim Log Node',
            'adv_lat': 50.5,
            'adv_lon': 4.5,
            'city': 'Brussels',
            'last_advert': get_current_timestamp(),
            'inserted_date': get_current_timestamp(),
            'updated_date': get_current_timestamp(),
            'params': {'freq': 869.525, 'sf': 10, 'bw': 250, 'cr': 5},
            'link': 'meshcore://claim_log',
            'source': 'app',
            'inserted_by': 'test',
            'updated_by': 'test'
        }
        integrate_added_node(test_node, conn)
        conn.commit()
        conn.close()

        import backend.database as db_module
        original_path = db_module.DATABASE_PATH
        db_module.DATABASE_PATH = self.db_path
        try:
            if not update_ownership('claim_log_001', '111', 'alice'):
                return False

            verify_conn = sqlite3.connect(self.db_path)
            verify_conn.row_factory = sqlite3.Row
            cur = verify_conn.cursor()
            cur.execute(
                "SELECT public_key, action, discord_owner_id "
                "FROM node_claims WHERE public_key = ? ORDER BY id",
                ('claim_log_001',),
            )
            rows = [tuple(r) for r in cur.fetchall()]
            verify_conn.close()
            return rows == [('claim_log_001', 'claim', '111')]
        finally:
            db_module.DATABASE_PATH = original_path

    def test_statistics(self):
        """Test statistics query."""
        conn = self.get_test_connection()
        
        # Add multiple test nodes
        for i in range(5):
            test_node = {
                'public_key': f'stats_test_{i:03d}',
                'type': (i % 4) + 1,  # Vary types
                'adv_name': f'Stats Node {i}',
                'adv_lat': 50.5 + (i * 0.01),
                'adv_lon': 4.5 + (i * 0.01),
                'city': 'Brussels',
                'last_advert': get_current_timestamp(),
                'inserted_date': get_current_timestamp(),
                'updated_date': get_current_timestamp(),
                'params': {'freq': 869.525, 'sf': 10, 'bw': 250, 'cr': 5},
                'link': f'meshcore://stats{i}',
                'source': 'app',
                'inserted_by': 'test',
                'updated_by': 'test'
            }
            integrate_added_node(test_node, conn)
        
        conn.commit()
        
        # Temporarily override DATABASE_PATH for query
        import backend.database as db_module
        original_path = db_module.DATABASE_PATH
        db_module.DATABASE_PATH = self.db_path
        try:
            # Get statistics
            stats = get_statistics()
            
            conn.close()
            
            # Verify statistics structure
            return (
                'total_nodes' in stats and
                'by_type' in stats and
                stats['total_nodes'] >= 5
            )
        finally:
            db_module.DATABASE_PATH = original_path
    
    def run_all_tests(self):
        """Run all integration tests."""
        print("\n" + "="*60)
        print("RRY-Map-Bot Integration Test Suite")
        print("="*60)
        
        # Setup
        self.setup_test_database()
        
        # Run tests
        self.test("Node Lifecycle - Add", self.test_node_lifecycle_add)
        self.test("Node Lifecycle - Remove", self.test_node_lifecycle_remove)
        self.test("Node Lifecycle - Restore", self.test_node_lifecycle_restore)
        self.test("Inactive Node Filtering", self.test_inactive_node_filtering)
        self.test("Discord Ownership Workflow", self.test_discord_ownership_workflow)
        self.test("Claim Logs Node Claims", self.test_claim_logs_node_claims)
        self.test("Statistics Query", self.test_statistics)
        
        # Print summary
        print("\n" + "="*60)
        print("TEST SUMMARY")
        print("="*60)
        print(f"Total Tests: {self.passed + self.failed}")
        print(f"Passed: {self.passed}")
        print(f"Failed: {self.failed}")
        print("="*60)
        
        # Print failed tests
        if self.failed > 0:
            print("\nFailed Tests:")
            for name, passed, error in self.test_results:
                if not passed:
                    print(f"  - {name}: {error}")
        
        return self.failed == 0


if __name__ == '__main__':
    test_suite = IntegrationTestSuite()

    try:
        success = test_suite.run_all_tests()
        exit_code = 0 if success else 1
    except Exception as e:
        print(f"Test suite error: {e}")
        import traceback
        traceback.print_exc()
        exit_code = 1
    finally:
        # Restore the original DATABASE_PATH env var so we don't leak the
        # test path into anything that runs after pytest in the same process.
        if test_suite._old_env_db is not None:
            os.environ['DATABASE_PATH'] = test_suite._old_env_db
        else:
            os.environ.pop('DATABASE_PATH', None)
        if os.path.exists(test_suite.db_path):
            os.remove(test_suite.db_path)

    sys.exit(exit_code)

