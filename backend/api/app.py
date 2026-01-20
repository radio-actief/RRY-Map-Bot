"""
REST API for RRY-Map-Bot Web Map
Provides API endpoints for the frontend web map to access Belgian node data.
"""

import sys
import os
from flask import Flask, jsonify, request, send_from_directory
from flask_cors import CORS

# Add parent directory to path for imports
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '../..'))

from backend.database import (
    get_connection,
    init_database,
    dict_from_row
)

# Get project root directory (parent of backend directory)
PROJECT_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '../..'))

# Create Flask application with static file serving
app = Flask(__name__, 
            static_folder=PROJECT_ROOT,
            static_url_path='',
            template_folder=PROJECT_ROOT)

# Enable CORS for all routes (needed if frontend is on different origin)
CORS(app)


def get_all_belgian_nodes():
    """
    Get all active Belgian nodes from the database.
    Filters for is_active = TRUE only.
    
    Returns:
        List of node dictionaries in the format expected by the frontend.
    """
    conn = get_connection()
    cursor = conn.cursor()
    
    try:
        # Query all active nodes
        cursor.execute("""
            SELECT * FROM belgian_nodes
            WHERE is_active = 1
            ORDER BY adv_name
        """)
        
        rows = cursor.fetchall()
        nodes = []
        
        for row in rows:
            node_dict = dict_from_row(row)
            
            # Skip nodes without valid coordinates (they can't be displayed on the map)
            if node_dict.get('adv_lat') is None or node_dict.get('adv_lon') is None:
                continue
            
            # Format node data to match frontend expectations
            # The frontend expects specific field names and formats
            formatted_node = {
                'public_key': node_dict.get('public_key', ''),
                'type': node_dict.get('type'),
                'adv_name': node_dict.get('adv_name'),
                'adv_lat': node_dict.get('adv_lat'),
                'adv_lon': node_dict.get('adv_lon'),
                'last_advert': node_dict.get('last_advert'),
                'inserted_date': node_dict.get('inserted_date'),
                'updated_date': node_dict.get('updated_date'),
                'params': node_dict.get('params', {}),  # Already deserialized by dict_from_row
                'link': node_dict.get('link'),
                'source': node_dict.get('source'),
                'inserted_by': node_dict.get('inserted_by'),
                'updated_by': node_dict.get('updated_by'),
                # Additional fields added by our system
                'city': node_dict.get('city'),
                'discord_owner_name': node_dict.get('discord_owner_name'),
                'discord_owner_id': node_dict.get('discord_owner_id'),
                'discord_updated_date': node_dict.get('discord_updated_date'),
            }
            
            # Add coords field for frontend compatibility (format: "lat, lon")
            formatted_node['coords'] = f"{node_dict['adv_lat']}, {node_dict['adv_lon']}"
            
            nodes.append(formatted_node)
        
        return nodes
        
    except Exception as e:
        print(f"Error fetching nodes: {e}")
        return []
    finally:
        conn.close()


@app.route('/api/v1/belgian-nodes', methods=['GET'])
def get_belgian_nodes():
    """
    GET /api/v1/belgian-nodes
    
    Returns all active Belgian nodes as JSON array.
    
    Query Parameters:
        None
    
    Returns:
        JSON array of node objects
        
    Example Response:
        [
            {
                "public_key": "abc123...",
                "type": 1,
                "adv_name": "Node Name",
                "adv_lat": 50.8477,
                "adv_lon": 4.3572,
                "coords": "50.8477, 4.3572",
                "last_advert": "2025-01-01T12:00:00",
                "inserted_date": "2025-01-01T12:00:00",
                "updated_date": "2025-01-01T12:00:00",
                "params": {
                    "freq": 869.618,
                    "sf": 8,
                    "bw": 62.5,
                    "cr": 8
                },
                "link": "meshcore://...",
                "source": "app",
                "inserted_by": "hex_key",
                "updated_by": "hex_key",
                "city": "Brussels",
                "discord_owner_name": "username"
            },
            ...
        ]
    """
    try:
        nodes = get_all_belgian_nodes()
        return jsonify(nodes), 200
    except Exception as e:
        print(f"Error in get_belgian_nodes endpoint: {e}")
        return jsonify({
            'error': 'Internal server error',
            'message': str(e)
        }), 500


@app.route('/api/v1/health', methods=['GET'])
def health_check():
    """
    GET /api/v1/health
    
    Health check endpoint to verify API is running.
    
    Returns:
        JSON object with status
    """
    return jsonify({
        'status': 'healthy',
        'service': 'RRY-Map-Bot API'
    }), 200


@app.route('/api/v1/stats', methods=['GET'])
def get_stats():
    """
    GET /api/v1/stats
    
    Returns statistics about Belgian nodes.
    
    Returns:
        JSON object with statistics
    """
    from backend.discord_queries import get_statistics
    
    try:
        stats = get_statistics()
        return jsonify(stats), 200
    except Exception as e:
        print(f"Error in get_stats endpoint: {e}")
        return jsonify({
            'error': 'Internal server error',
            'message': str(e)
        }), 500


@app.route('/api/v1/config', methods=['GET'])
def get_config():
    """
    GET /api/v1/config
    
    Returns configuration including frequency presets.
    Matches official API format exactly (https://api.meshcore.nz/api/v1/config).
    
    Returns:
        JSON object with config structure:
        {
            "config": {
                "suggested_radio_settings": {
                    "entries": [
                        {
                            "title": "Australia",
                            "description": "915.800MHz / SF10 / BW250 / CR5",
                            "frequency": "915.800",  # String format (matches official API)
                            "bandwidth": "250",       # String format
                            "spreading_factor": "10", # String format
                            "coding_rate": "5"        # String format
                        },
                        ...
                    ]
                }
            }
        }
        
    Note: Numeric values are returned as strings to match official API format.
    Frontend handles conversion automatically.
    """
    try:
        from config.config import FREQUENCY_PRESETS
        
        # Transform our preset format to upstream format (matches official API exactly)
        # Note: Official API returns strings for numeric values
        presets = [
            {
                "title": p["name"],
                "description": f"{p['freq']}MHz / SF{p['sf']} / BW{p['bw']} / CR{p['cr']}",
                "frequency": str(p["freq"]),  # String format to match official API
                "bandwidth": str(p["bw"]),     # String format to match official API
                "spreading_factor": str(p["sf"]),  # String format to match official API
                "coding_rate": str(p["cr"])     # String format to match official API
            }
            for p in FREQUENCY_PRESETS
        ]
        
        return jsonify({
            "config": {
                "suggested_radio_settings": {
                    "entries": presets
                }
            }
        }), 200
    except Exception as e:
        print(f"Error in get_config endpoint: {e}")
        return jsonify({
            'error': 'Internal server error',
            'message': str(e)
        }), 500


@app.errorhandler(404)
def not_found(error):
    """Handle 404 errors for API routes only."""
    from werkzeug.exceptions import NotFound
    
    # Check if this is an API route
    if request.path.startswith('/api/'):
        return jsonify({
            'error': 'Not found',
            'message': 'The requested API endpoint does not exist'
        }), 404
    
    # For missing static files (like fonts, favicon), return proper 404
    # Browsers will handle missing resources gracefully
    if request.path.startswith('/lib/') or request.path == '/favicon.ico':
        return NotFound()
    
    # For non-API routes (SPA routing), serve index.html
    try:
        return send_from_directory(PROJECT_ROOT, 'index.html')
    except Exception:
        return NotFound()


@app.errorhandler(500)
def internal_error(error):
    """Handle 500 errors."""
    return jsonify({
        'error': 'Internal server error',
        'message': 'An unexpected error occurred'
    }), 500


@app.route('/')
def index():
    """Serve the main index.html file."""
    return send_from_directory(PROJECT_ROOT, 'index.html')


if __name__ == '__main__':
    # Ensure database is initialized before starting API
    print("Initializing database...")
    init_database()
    print("Database ready.\n")
    # Run Flask development server
    # In production, use a proper WSGI server like gunicorn
    port = int(os.getenv('FLASK_PORT', os.getenv('API_PORT', 8000)))
    host = os.getenv('FLASK_HOST', os.getenv('API_HOST', '0.0.0.0'))
    debug = os.getenv('FLASK_DEBUG', 'False').lower() == 'true'
    
    print(f"Starting RRY-Map-Bot API server on {host}:{port}")
    print(f"API endpoint: http://{host}:{port}/api/v1/belgian-nodes")
    
    app.run(host=host, port=port, debug=debug)

