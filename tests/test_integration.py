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
    update_node_properties,
    verify_ownership
)
from backend.sync_belgian_nodes import (
    track_changes,
    integrate_added_node,
    integrate_removed_node,
    restore_removed_node,
    merge_node_update,
    should_preserve_discord_edit
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
    
    def test_conflict_resolution(self):
        """Test conflict resolution between Discord edits and official map updates."""
        conn = self.get_test_connection()
        
        # Add a test node
        test_node = {
            'public_key': 'conflict_test_001',
            'type': 1,
            'adv_name': 'Original Name',
            'adv_lat': 50.5,
            'adv_lon': 4.5,
            'city': 'Brussels',
            'last_advert': get_current_timestamp(),
            'inserted_date': get_current_timestamp(),
            'updated_date': '2025-01-01 00:00:00',
            'params': {'freq': 869.525, 'sf': 10, 'bw': 250, 'cr': 5},
            'link': 'meshcore://conflict',
            'source': 'app',
            'inserted_by': 'test',
            'updated_by': 'test'
        }
        
        integrate_added_node(test_node, conn)
        conn.commit()
        
        # User edits via Discord (more recent)
        user_id = 'test_user_123'
        user_name = 'TestUser'
        
        # Set ownership and update directly in test database
        cursor = conn.cursor()
        
        # Set ownership
        cursor.execute("""
            UPDATE belgian_nodes 
            SET discord_owner_id = ?, 
                discord_owner_name = ?
            WHERE public_key = ?
        """, (user_id, user_name, test_node['public_key']))
        
        # Simulate Discord update (sets discord_updated_date to now)
        discord_timestamp = get_current_timestamp()
        cursor.execute("""
            UPDATE belgian_nodes 
            SET adv_name = ?,
                city = ?,
                discord_updated_date = ?
            WHERE public_key = ?
        """, ('Discord Edited Name', 'Discord City', discord_timestamp, test_node['public_key']))
        
        conn.commit()
        
        # Get current state
        cursor.execute("SELECT * FROM belgian_nodes WHERE public_key = ?", (test_node['public_key'],))
        db_node = dict_from_row(cursor.fetchone())
        
        # Verify discord_updated_date was set
        if not db_node.get('discord_updated_date'):
            conn.close()
            return False
        
        # Simulate official map update (older timestamp)
        # Use ISO format to match what get_current_timestamp() returns
        old_timestamp = (datetime.now() - timedelta(days=1)).isoformat()  # 1 day ago
        
        official_node = {
            'public_key': 'conflict_test_001',
            'type': 1,
            'adv_name': 'Official Updated Name',
            'adv_lat': 50.5,
            'adv_lon': 4.5,
            'city': 'Official City',
            'updated_date': old_timestamp  # Older than Discord edit
        }
        
        # Test conflict resolution
        preserve_name = should_preserve_discord_edit(db_node, official_node, 'adv_name')
        preserve_city = should_preserve_discord_edit(db_node, official_node, 'city')
        
        conn.close()
        
        # Discord edit should be preserved (more recent)
        # The function checks if discord_updated_date > official updated_date
        return preserve_name and preserve_city
    
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
        self.test("Conflict Resolution", self.test_conflict_resolution)
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
        sys.exit(0 if success else 1)
    except Exception as e:
        print(f"Test suite error: {e}")
        import traceback
        traceback.print_exc()
        sys.exit(1)

