#!/usr/bin/env python3
"""
Check which nodes in the database use custom (non-preset) frequency parameters.
"""

import sys
import os
import json

# Add project root to path
sys.path.insert(0, os.path.dirname(__file__))

from backend.database import get_connection
from config.config import FREQUENCY_PRESETS


def match_frequency_preset(params):
    """Match frequency parameters against presets (same logic as frontend)."""
    if not params or not isinstance(params, dict):
        return None
    
    try:
        freq = float(params.get('freq', 0))
        sf = int(params.get('sf', 0))
        bw = float(params.get('bw', 0))
        cr = int(params.get('cr', 0))
    except (ValueError, TypeError):
        return None
    
    for preset in FREQUENCY_PRESETS:
        if (abs(freq - preset['freq']) < 0.001 and
            sf == preset['sf'] and
            abs(bw - preset['bw']) < 0.001 and
            cr == preset['cr']):
            return preset
    
    return None


def check_custom_params():
    """Check database for nodes with custom (non-preset) params."""
    conn = get_connection()
    cursor = conn.cursor()
    
    # Get all active nodes with params
    cursor.execute("""
        SELECT public_key, adv_name, params, type
        FROM belgian_nodes
        WHERE is_active = 1
        AND params IS NOT NULL
        AND params != '{}'
        AND params != ''
    """)
    
    nodes = cursor.fetchall()
    conn.close()
    
    custom_nodes = []
    preset_nodes = []
    invalid_nodes = []
    
    for node in nodes:
        public_key = node['public_key']
        adv_name = node['adv_name']
        params_str = node['params']
        node_type = node['type']
        
        # Parse params JSON
        try:
            if isinstance(params_str, str):
                params = json.loads(params_str)
            else:
                params = params_str
        except (json.JSONDecodeError, TypeError):
            invalid_nodes.append({
                'public_key': public_key,
                'adv_name': adv_name,
                'type': node_type,
                'params': params_str,
                'error': 'Invalid JSON'
            })
            continue
        
        # Check if params match a preset
        preset = match_frequency_preset(params)
        
        if preset:
            preset_nodes.append({
                'public_key': public_key,
                'adv_name': adv_name,
                'type': node_type,
                'preset': preset['name'],
                'params': params
            })
        else:
            custom_nodes.append({
                'public_key': public_key,
                'adv_name': adv_name,
                'type': node_type,
                'params': params
            })
    
    # Print results
    print(f"\n{'='*60}")
    print(f"Frequency Preset Analysis")
    print(f"{'='*60}\n")
    
    print(f"Total nodes with params: {len(nodes)}")
    print(f"  - Nodes using presets: {len(preset_nodes)}")
    print(f"  - Nodes with custom params: {len(custom_nodes)}")
    print(f"  - Nodes with invalid params: {len(invalid_nodes)}\n")
    
    if custom_nodes:
        print(f"{'='*60}")
        print(f"Nodes with CUSTOM (non-preset) params: {len(custom_nodes)}")
        print(f"{'='*60}\n")
        
        for node in custom_nodes:
            params = node['params']
            print(f"Node: {node['adv_name']} (Type: {node['type']})")
            print(f"  Public Key: {node['public_key'][:12]}...")
            print(f"  Frequency: {params.get('freq', 'N/A')} MHz")
            print(f"  SF: {params.get('sf', 'N/A')}, BW: {params.get('bw', 'N/A')} kHz, CR: {params.get('cr', 'N/A')}")
            print()
    else:
        print("✅ All nodes use preset frequency parameters!\n")
    
    if invalid_nodes:
        print(f"{'='*60}")
        print(f"Nodes with INVALID params: {len(invalid_nodes)}")
        print(f"{'='*60}\n")
        
        for node in invalid_nodes:
            print(f"Node: {node['adv_name']} (Type: {node['type']})")
            print(f"  Public Key: {node['public_key'][:12]}...")
            print(f"  Error: {node['error']}")
            print(f"  Raw params: {node['params']}")
            print()
    
    # Preset distribution
    if preset_nodes:
        print(f"{'='*60}")
        print(f"Preset Distribution:")
        print(f"{'='*60}\n")
        
        preset_counts = {}
        for node in preset_nodes:
            preset_name = node['preset']
            preset_counts[preset_name] = preset_counts.get(preset_name, 0) + 1
        
        for preset_name, count in sorted(preset_counts.items(), key=lambda x: x[1], reverse=True):
            print(f"  {preset_name}: {count} node(s)")
        print()


if __name__ == '__main__':
    try:
        check_custom_params()
    except Exception as e:
        print(f"Error: {e}")
        import traceback
        traceback.print_exc()
        sys.exit(1)

