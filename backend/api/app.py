"""
REST API for RRY-Map-Bot Web Map
Provides API endpoints for the frontend web map to access Belgian node data.
"""

import sys
import os
from typing import Optional
from flask import Flask, jsonify, request, send_from_directory, session, redirect
from flask_cors import CORS
from flask_session import Session
import secrets

# Add parent directory to path for imports
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '../..'))

from backend.database import (
    get_connection,
    init_database,
    dict_from_row
)
from backend.auth import (
    get_authorization_url,
    exchange_code_for_token,
    get_user_info,
    is_authenticated,
    get_current_user,
    login_required,
    generate_state,
    is_guild_member,
    verify_guild_membership_bot,
    DISCORD_SERVER_INVITE_URL
)
from backend.discord_queries import (
    update_ownership,
    update_node_properties,
    verify_ownership,
    remove_ownership,
    get_node_by_key
)
from backend.discord_notifications import (
    notify_node_claimed,
    notify_node_unclaimed
)

# Get project root directory (parent of backend directory)
PROJECT_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '../..'))

# Create Flask application with static file serving
app = Flask(__name__, 
            static_folder=PROJECT_ROOT,
            static_url_path='',
            template_folder=PROJECT_ROOT)

# Configure session
app.config['SECRET_KEY'] = os.getenv('FLASK_SECRET_KEY', secrets.token_hex(32))
app.config['SESSION_TYPE'] = 'filesystem'
app.config['SESSION_PERMANENT'] = False
app.config['SESSION_USE_SIGNER'] = True
app.config['SESSION_KEY_PREFIX'] = 'rry_map_bot:'
app.config['SESSION_COOKIE_SECURE'] = os.getenv('SESSION_COOKIE_SECURE', 'False').lower() == 'true'  # Set to True in production with HTTPS
app.config['SESSION_COOKIE_HTTPONLY'] = True
app.config['SESSION_COOKIE_SAMESITE'] = 'Lax'

# Initialize session
Session(app)

# Enable CORS for all routes (needed if frontend is on different origin)
# Allow credentials for session cookies
CORS(app, supports_credentials=True)


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


def get_displayable_node_count():
    """
    Count of nodes that appear on the map: is_active = 1 and has valid coordinates.
    Same logic as get_all_belgian_nodes() so the stats page "Current total" matches the map bar.
    """
    conn = get_connection()
    cursor = conn.cursor()
    try:
        cursor.execute("""
            SELECT COUNT(*) FROM belgian_nodes
            WHERE is_active = 1
              AND adv_lat IS NOT NULL AND adv_lon IS NOT NULL
        """)
        return cursor.fetchone()[0]
    finally:
        conn.close()


@app.route('/api/v1/belgian-nodes/count', methods=['GET'])
def get_belgian_nodes_count():
    """
    GET /api/v1/belgian-nodes/count

    Returns the count of nodes that are shown on the map (active with coordinates).
    Use this for the stats page "Current total" so it matches the map top bar.
    """
    try:
        count = get_displayable_node_count()
        return jsonify({"count": count}), 200
    except Exception as e:
        print(f"Error in get_belgian_nodes_count: {e}")
        return jsonify({"error": "Internal server error", "message": str(e)}), 500


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


# "Added" is based only on belgian_nodes.inserted_date (or created_at). Real sync_history/node_changes
# are used only for removed, restored, updated (to avoid double-counting when sync logged existing nodes as "added").


def get_synthetic_sync_rows():
    """
    One row per day with nodes_added = count of nodes whose inserted_date (or created_at) falls on that day.
    This is the single source of truth for "added"; real sync_history nodes_added is ignored when merging.
    """
    conn = get_connection()
    cursor = conn.cursor()
    try:
        cursor.execute("""
            SELECT date(COALESCE(NULLIF(trim(inserted_date), ''), created_at)) AS d,
                   COUNT(*) AS cnt
            FROM belgian_nodes
            WHERE (inserted_date IS NOT NULL AND trim(inserted_date) != '')
               OR (created_at IS NOT NULL AND (inserted_date IS NULL OR trim(inserted_date) = ''))
            GROUP BY d
            HAVING d IS NOT NULL AND d != ''
        """)
        rows = cursor.fetchall()
        return [
            {
                "sync_date": row["d"],
                "nodes_added": row["cnt"],
                "nodes_removed": 0,
                "nodes_restored": 0,
                "nodes_updated": 0,
            }
            for row in rows
        ]
    finally:
        conn.close()


def get_sync_history(limit: int = 500):
    """
    Sync history: "added" comes only from inserted_date (synthetic rows). Real sync_history
    is used for removed/restored/updated only (nodes_added zeroed to avoid double count).
    """
    conn = get_connection()
    cursor = conn.cursor()
    try:
        cursor.execute("""
            SELECT id, sync_date, nodes_added, nodes_removed, nodes_restored,
                   nodes_updated, details
            FROM sync_history
            ORDER BY sync_date ASC
            LIMIT ?
        """, (limit,))
        real = [dict_from_row(row) for row in cursor.fetchall()]
    finally:
        conn.close()
    for r in real:
        r["nodes_added"] = 0
        r["from_sync"] = True
    synthetic = get_synthetic_sync_rows()
    for r in synthetic:
        r["from_sync"] = False
    combined = real + synthetic
    combined.sort(key=lambda r: (r.get("sync_date") or ""))
    max_rows = max(limit, 2000)
    return combined[:max_rows] if len(combined) > max_rows else combined


def _node_change_row(public_key: str, change_type: str, sync_date: str, data: dict) -> Optional[dict]:
    """Build one node_changes output dict from public_key, change_type, sync_date and data (with adv_lat, adv_lon, etc.)."""
    if not data:
        return None
    lat = data.get('adv_lat')
    lon = data.get('adv_lon')
    if lat is None or lon is None:
        return None
    try:
        lat, lon = float(lat), float(lon)
    except (TypeError, ValueError):
        return None
    node_type = data.get('type')
    if node_type is not None:
        try:
            node_type = int(node_type)
        except (TypeError, ValueError):
            node_type = 1
    else:
        node_type = 1
    return {
        'public_key': public_key,
        'change_type': change_type,
        'sync_date': sync_date,
        'lat': lat,
        'lon': lon,
        'adv_name': (data.get('adv_name') or (public_key or '')[:8] + '…'),
        'type': node_type,
    }


def get_synthetic_node_changes():
    """
    One "added" event per node with sync_date = inserted_date (or created_at). Single source
    of truth for when a node appeared; real node_changes "added" are not used for playback.
    """
    conn = get_connection()
    cursor = conn.cursor()
    try:
        cursor.execute("""
            SELECT public_key, type, adv_name, adv_lat, adv_lon,
                   date(COALESCE(NULLIF(trim(inserted_date), ''), created_at)) AS d
            FROM belgian_nodes
            WHERE ((inserted_date IS NOT NULL AND trim(inserted_date) != '')
                   OR (created_at IS NOT NULL AND (inserted_date IS NULL OR trim(inserted_date) = '')))
              AND (adv_lat IS NOT NULL AND adv_lon IS NOT NULL)
        """)
        out = []
        for row in cursor.fetchall():
            d = row["d"]
            if not d:
                continue
            data = {
                "adv_lat": row["adv_lat"],
                "adv_lon": row["adv_lon"],
                "adv_name": row["adv_name"],
                "type": row["type"],
            }
            r = _node_change_row(row["public_key"], "added", d, data)
            if r:
                out.append(r)
        return out
    finally:
        conn.close()


def get_node_changes_since(since_date: Optional[str] = None, limit: int = 5000):
    """
    Node changes playback: "added" from inserted_date only (synthetic). Real node_changes
    used only for removed, updated, restored (so we don't double-count real "added").
    """
    synthetic = get_synthetic_node_changes()
    out = []
    conn = get_connection()
    cursor = conn.cursor()
    try:
        if since_date:
            cursor.execute("""
                SELECT public_key, change_type, sync_date, old_data, new_data
                FROM node_changes
                WHERE sync_date >= ? AND change_type IN ('removed', 'updated', 'restored')
                ORDER BY sync_date ASC
                LIMIT ?
            """, (since_date, limit))
        else:
            cursor.execute("""
                SELECT public_key, change_type, sync_date, old_data, new_data
                FROM node_changes
                WHERE change_type IN ('removed', 'updated', 'restored')
                ORDER BY sync_date ASC
                LIMIT ?
            """, (limit,))
        rows = cursor.fetchall()
        for row in rows:
            d = dict_from_row(row)
            data = d.get('new_data') or d.get('old_data')
            r = _node_change_row(
                d.get('public_key'),
                d.get('change_type'),
                d.get('sync_date'),
                data or {},
            )
            if r:
                out.append(r)
    finally:
        conn.close()

    combined = synthetic + out
    combined.sort(key=lambda x: (x.get("sync_date") or ""))
    return combined


@app.route('/api/v1/node-changes', methods=['GET'])
def node_changes():
    """
    GET /api/v1/node-changes

    Returns node-level change log for historical stats playback (lat, lon, name per change).
    Query: since=YYYY-MM-DD (optional), limit (default 5000).
    """
    try:
        since = request.args.get('since')
        limit = request.args.get('limit', type=int) or 5000
        limit = min(max(1, limit), 20000)
        changes = get_node_changes_since(since_date=since, limit=limit)
        return jsonify(changes), 200
    except Exception as e:
        print(f"Error in node_changes endpoint: {e}")
        return jsonify({
            'error': 'Internal server error',
            'message': str(e)
        }), 500


@app.route('/api/v1/sync-history', methods=['GET'])
def sync_history():
    """
    GET /api/v1/sync-history

    Returns sync history for the historical stats view: each run's date and
    counts (nodes_added, nodes_removed, nodes_restored, nodes_updated).
    Optional query: limit (default 500).
    """
    try:
        limit = request.args.get('limit', type=int) or 500
        limit = min(max(1, limit), 2000)
        history = get_sync_history(limit=limit)
        return jsonify(history), 200
    except Exception as e:
        print(f"Error in sync_history endpoint: {e}")
        return jsonify({
            'error': 'Internal server error',
            'message': str(e)
        }), 500


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


# OAuth2 Routes
@app.route('/auth/login')
def auth_login():
    """Initiate Discord OAuth2 login flow."""
    state = generate_state()
    session['oauth_state'] = state
    auth_url = get_authorization_url(state=state)
    return redirect(auth_url)


@app.route('/auth/callback')
def auth_callback():
    """Handle Discord OAuth2 callback."""
    code = request.args.get('code')
    state = request.args.get('state')
    error = request.args.get('error')
    
    # Check for errors
    if error:
        return redirect('/?error=auth_failed')
    
    # Verify state
    if not state or state != session.get('oauth_state'):
        return redirect('/?error=invalid_state')
    
    # Remove state from session
    session.pop('oauth_state', None)
    
    # Exchange code for token
    if not code:
        return redirect('/?error=no_code')
    
    token_response = exchange_code_for_token(code)
    if not token_response:
        return redirect('/?error=token_exchange_failed')
    
    access_token = token_response.get('access_token')
    if not access_token:
        return redirect('/?error=no_access_token')
    
    # Get user info
    user_info = get_user_info(access_token)
    if not user_info:
        return redirect('/?error=user_info_failed')
    
    # Check if user is a member of the Discord server
    from backend.auth import is_guild_member, DISCORD_SERVER_INVITE_URL
    from config.config import DISCORD_OAUTH2_REDIRECT_URI
    
    is_member = is_guild_member(access_token)
    
    # Store user info in session
    session['user_id'] = str(user_info['id'])
    session['username'] = user_info.get('username', 'Unknown')
    session['discriminator'] = user_info.get('discriminator', '0000')
    session['avatar'] = user_info.get('avatar')
    session['is_guild_member'] = is_member
    
    # If not a member, redirect to Discord server invite with return URL
    if not is_member:
        invite_url = f"{DISCORD_SERVER_INVITE_URL}?redirect_uri={DISCORD_OAUTH2_REDIRECT_URI}"
        return redirect(f'/?error=not_guild_member&invite_url={invite_url}')
    
    # Redirect to home page
    return redirect('/?login=success')


@app.route('/auth/logout')
def auth_logout():
    """Logout user and clear session."""
    session.clear()
    return redirect('/?logout=success')


@app.route('/auth/me')
def auth_me():
    """Get current authenticated user info."""
    if not is_authenticated():
        return jsonify({'authenticated': False}), 200
    
    user = get_current_user()
    return jsonify({
        'authenticated': True,
        'user': user
    }), 200


# Authenticated API Endpoints
@app.route('/api/v1/nodes/<public_key>/claim', methods=['POST'])
@login_required
def claim_node(public_key: str):
    """
    Claim ownership of an unclaimed node.
    
    Requires authentication and Discord server membership.
    """
    user = get_current_user()
    if not user:
        return jsonify({'error': 'Not authenticated'}), 401
    
    # Real-time check: Verify user is still a member of the Discord server
    # This prevents users who were banned/kicked from claiming nodes
    is_member = verify_guild_membership_bot(user['id'])
    
    if not is_member:
        # Also clear the session flag if it was incorrectly set
        session['is_guild_member'] = False
        return jsonify({
            'error': 'You must be a member of our Discord server to claim nodes. Please join the server and log out/log back in.',
            'discord_invite_url': DISCORD_SERVER_INVITE_URL
        }), 403
    
    # Normalize public key
    public_key_normalized = public_key.replace(' ', '').replace('-', '').lower()
    
    # Claim the node
    success = update_ownership(
        public_key_normalized,
        user['id'],
        user['username']
    )
    
    if not success:
        return jsonify({
            'error': 'Failed to claim node. Node may not exist, may already be claimed, or may be inactive.'
        }), 400
    
    # Get the updated node data for Discord notification
    node = get_node_by_key(public_key_normalized)
    if node:
        # Send Discord notification (non-blocking - don't fail if notification fails)
        try:
            notify_node_claimed(node, user['id'], user['username'])
        except Exception as e:
            print(f"Error sending Discord notification for claim: {e}")
            # Continue even if notification fails
    
    return jsonify({
        'success': True,
        'message': 'Node claimed successfully'
    }), 200


@app.route('/api/v1/nodes/<public_key>/unclaim', methods=['POST'])
@login_required
def unclaim_node(public_key: str):
    """
    Unclaim a node (remove ownership).
    
    Requires authentication and ownership.
    """
    user = get_current_user()
    if not user:
        return jsonify({'error': 'Not authenticated'}), 401
    
    # Normalize public key
    public_key_normalized = public_key.replace(' ', '').replace('-', '').lower()
    
    # Verify ownership
    if not verify_ownership(public_key_normalized, user['id']):
        return jsonify({
            'error': 'You do not own this node.'
        }), 403
    
    # Get node data before unclaiming (for Discord notification)
    node = get_node_by_key(public_key_normalized, include_inactive=True)
    if not node:
        return jsonify({
            'error': 'Node not found.'
        }), 404
    
    # Remove ownership
    success = remove_ownership(public_key_normalized, user['id'])
    
    if not success:
        return jsonify({
            'error': 'Failed to unclaim node.'
        }), 400
    
    # Send Discord notification (non-blocking - don't fail if notification fails)
    try:
        notify_node_unclaimed(node, user['id'], user['username'])
    except Exception as e:
        print(f"Error sending Discord notification for unclaim: {e}")
        # Continue even if notification fails
    
    return jsonify({
        'success': True,
        'message': 'Node unclaimed successfully'
    }), 200


@app.route('/api/v1/nodes/<public_key>/update', methods=['POST'])
@login_required
def update_node(public_key: str):
    """
    Update node properties (name, city, params, coordinates).
    
    Requires authentication and ownership.
    """
    user = get_current_user()
    if not user:
        return jsonify({'error': 'Not authenticated'}), 401
    
    # Normalize public key
    public_key_normalized = public_key.replace(' ', '').replace('-', '').lower()
    
    # Verify ownership
    if not verify_ownership(public_key_normalized, user['id']):
        return jsonify({
            'error': 'You do not own this node.'
        }), 403
    
    # Get update data from request
    data = request.get_json()
    if not data:
        return jsonify({'error': 'No data provided'}), 400
    
    # Extract update fields
    name = data.get('name')
    city = data.get('city')
    params = data.get('params')
    adv_lat = data.get('lat')
    adv_lon = data.get('lon')
    
    # Update node properties
    result = update_node_properties(
        public_key_normalized,
        user['id'],
        name=name,
        city=city,
        params=params,
        adv_lat=adv_lat,
        adv_lon=adv_lon
    )
    
    if not result.get('success'):
        return jsonify({
            'error': result.get('message', 'Failed to update node')
        }), 400
    
    return jsonify({
        'success': True,
        'message': 'Node updated successfully',
        'changes': result.get('changes', {})
    }), 200


@app.route('/api/v1/nodes/<public_key>/ownership', methods=['GET'])
def check_ownership(public_key: str):
    """
    Check if current user owns a node.
    
    Returns ownership status (no authentication required, but returns False if not authenticated).
    """
    # Normalize public key
    public_key_normalized = public_key.replace(' ', '').replace('-', '').lower()
    
    if not is_authenticated():
        return jsonify({
            'owned': False,
            'authenticated': False
        }), 200
    
    user = get_current_user()
    owned = verify_ownership(public_key_normalized, user['id'])
    
    return jsonify({
        'owned': owned,
        'authenticated': True
    }), 200


@app.route('/api/v1/my-nodes', methods=['GET'])
@login_required
def get_my_nodes():
    """
    Get all nodes owned by the current authenticated user.
    
    Requires authentication.
    """
    user = get_current_user()
    if not user:
        return jsonify({'error': 'Not authenticated'}), 401
    
    from backend.discord_queries import get_user_nodes
    
    # Get user's nodes (active only for display)
    user_nodes = get_user_nodes(user['id'], include_inactive=False)
    
    # Format nodes similar to get_all_belgian_nodes format
    formatted_nodes = []
    for node_dict in user_nodes:
        # Skip nodes without valid coordinates
        if node_dict.get('adv_lat') is None or node_dict.get('adv_lon') is None:
            continue
        
        formatted_node = {
            'public_key': node_dict.get('public_key', ''),
            'type': node_dict.get('type'),
            'adv_name': node_dict.get('adv_name'),
            'adv_lat': node_dict.get('adv_lat'),
            'adv_lon': node_dict.get('adv_lon'),
            'last_advert': node_dict.get('last_advert'),
            'inserted_date': node_dict.get('inserted_date'),
            'updated_date': node_dict.get('updated_date'),
            'params': node_dict.get('params', {}),
            'link': node_dict.get('link'),
            'source': node_dict.get('source'),
            'city': node_dict.get('city'),
            'discord_owner_name': node_dict.get('discord_owner_name'),
            'discord_owner_id': node_dict.get('discord_owner_id'),
            'discord_updated_date': node_dict.get('discord_updated_date'),
        }
        
        formatted_node['coords'] = f"{node_dict['adv_lat']}, {node_dict['adv_lon']}"
        formatted_nodes.append(formatted_node)
    
    return jsonify(formatted_nodes), 200


@app.route('/')
def index():
    """Serve the main index.html file."""
    return send_from_directory(PROJECT_ROOT, 'index.html')


@app.route('/stats')
def stats_page():
    """Serve the historical node stats page (sync history, charts, playback)."""
    return send_from_directory(PROJECT_ROOT, 'stats.html')


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

