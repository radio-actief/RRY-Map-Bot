# RRY-Map-Bot: Belgian MeshCore Node Mapping System

## Project Overview

**RRY-Map-Bot** is a new integrated project combining a **Discord bot** (discord.py) and a **Belgian web map application** for visualizing and managing MeshCore network nodes. The system focuses exclusively on Belgian nodes and provides both web-based map visualization and Discord-based interaction capabilities.

**Target Domain**: `meshmap.radio-actief.be`

---

## Project Goals

1. **Belgian Node Focus**: Filter and display only nodes located within Belgium
2. **Dual Interface**: Provide both web map visualization and Discord bot interaction
3. **Data Synchronization**: Sync from the official MeshCore map while maintaining Belgian-specific data
4. **Node Management**: Allow users to claim and manage their nodes via Discord commands
   - Users can **claim/unclaim** node ownership
   - Users can **update** node name, city, and frequency parameters
   - Users **CANNOT** add, remove, or edit public keys (hex) - these are immutable
5. **Automated Updates**: Periodic synchronization with official map (resource-intensive, runs a few times per day)

---

## System Architecture

### Components

```
┌─────────────────────────────────────────────────────────────┐
│              Official MeshCore Map API                       │
│         https://map.meshcore.io/api/v1/nodes                │
└──────────────────────┬──────────────────────────────────────┘
                       │
                       │ Periodic Sync (few times/day)
                       │
┌──────────────────────▼──────────────────────────────────────┐
│         Belgian Node Filter & Sync Service                    │
│  ┌──────────────────────────────────────────────────────┐   │
│  │ 1. Download all nodes from official API               │   │
│  │ 2. Filter by Belgian geographic bounds               │   │
│  │ 3. Verify with Geopy (country = BE)                  │   │
│  │ 4. Extract city name (via Geopy)                     │   │
│  │ 5. Track added/removed nodes                         │   │
│  └──────────────────────────────────────────────────────┘   │
└──────────────────────┬──────────────────────────────────────┘
                       │
                       │ SQLite Database
                       │ (Single Source of Truth)
                       │
        ┌──────────────┴──────────────┐
        │                             │
┌───────▼────────┐         ┌─────────▼──────────┐
│  Web Map App   │         │   Discord Bot      │
│ (meshmap.radio-actief.be)│         │  (discord.py)      │
│                │         │                    │
│ • Leaflet Map  │         │ • /search          │
│ • Node Display │         │ • /mynodes         │
│ • Filtering    │         │ • /node claim      │
│ • Statistics   │         │ • /node unclaim    │
│                │         │ • /stats           │
│                │         │                    │
│ (via REST API) │         │ (Direct DB Access)│
└────────────────┘         └────────────────────┘
```

---

## Current State Analysis

### Existing Frontend (RRY-Map-Bot)

The project currently contains a **frontend web map application** based on the official MeshCore map:

#### Technologies
- **Vue 3** (ESM browser module)
- **Leaflet** (map visualization)
- **Leaflet.markercluster** (node clustering)
- **Beer.css** (UI framework)
- **Material Icons**

#### Current Features
- Fetches nodes from `https://map.meshcore.io/api/v1/nodes`
- Displays all nodes on interactive map
- Node filtering by type (Client, Repeater, Room Server, Sensor)
- Search by node name or public key
- Manual node addition via `meshcore://` links *(Note: This feature will be **removed** in the new system - users can only add nodes via the official MeshCore map)*
- Statistics dashboard (total nodes, by type, recent additions)
- Date-based filtering
- Clustering zoom controls

#### Current Data Structure
Nodes are fetched as JSON array with structure:
```json
{
  "public_key": "hex_string",
  "type": 1-4,
  "adv_name": "Node Name",
  "adv_lat": 50.8477,
  "adv_lon": 4.3572,
  "last_advert": "2025-12-31T...",
  "inserted_date": "2025-12-31T...",
  "updated_date": "2025-12-31T...",
  "params": {
    "freq": 869.618,
    "cr": 8,
    "sf": 8,
    "bw": 62.5
  },
  "link": "meshcore://...",
  "source": "uploader" | "app" | "web",
  "inserted_by": "hex_hash",  // Public hex key of companion device that uploaded this node to official map
  "updated_by": "hex_hash"    // Public hex key of companion device that last updated this node on official map
}
```

**Note**: The following fields are **NOT** present in the official map data but will be added by our system:
- `city` - Extracted via Geopy during sync
- `discord_owner_id` - Set when users claim nodes via Discord
- `discord_owner_name` - Set when users claim nodes via Discord
- `synced_from_official` - Tracks if node came from official map
- `last_sync_date` - Tracks last sync operation

**Date Field Clarification**:
- `updated_date` - From official map, tracks when node was last updated on the official MeshCore map.
- Discord ownership history lives in the dedicated `node_claims` event log (see schema below).

**Important**: `inserted_by` and `updated_by` are **public hex keys** of companion devices that uploaded/updated nodes on the official map. These are **NOT** Discord user IDs and should **NOT** be modified by our system. They are separate from `discord_owner_id`/`discord_owner_name` which track Discord ownership.

---

## Required New Features

### 1. Belgian Node Filtering Service

#### Geographic Filtering
```python
# Belgium geographic boundaries
BELGIUM_BOUNDS = {
    'min_lat': 49.5,
    'max_lat': 51.5,
    'min_lon': 2.5,
    'max_lon': 6.4
}
```

#### Workflow
1. **Download**: Fetch all nodes from `https://map.meshcore.io/api/v1/nodes`
2. **Initial Filter**: Remove nodes outside Belgian bounds (or without coordinates)
3. **Geopy Verification**: 
   - Use Geopy reverse geocoding for each remaining node
   - Verify `country == "BE"`
   - Extract `city` name (not region, not full address)
   - Remove nodes where country is not BE
4. **Change Tracking & Integration**:
   - Compare with previous run's data from database
   - Identify **added nodes** (new in official map) → **INSERT immediately**
   - Identify **removed nodes** (deleted from official map) → **Mark as inactive** (preserve data)
   - Identify **restored nodes** (inactive nodes that reappeared) → **Update ALL info and reactivate**
   - Identify **updated nodes** (data changed) → **Merge with conflict resolution** (to be elaborated later)
   - Store change log in `sync_history` and `node_changes` tables
   - **Integration**: Changes are integrated immediately during sync (automatic integration)
   - **Discord Bot**: ALL commands filter inactive nodes (`WHERE is_active = TRUE`) - exception: `/mynodes` shows both active and inactive

#### Execution
- Runs **a few times per day** (resource-intensive due to Geopy API calls)
- Can be scheduled via cron or task scheduler
- Should log progress and results

### 2. Data Storage Architecture

#### Architecture: Unified Database + REST API

**Chosen Solution**: **SQLite database** as single source of truth with **REST API** for web map access.

**Architecture**:
```
┌─────────────────┐
│  Sync Service   │
│  (Python)       │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│  SQLite DB      │
│  (Single Source │
│   of Truth)     │
└────────┬────────┘
         │
    ┌────┴────┐
    │         │
    ▼         ▼
┌────────┐ ┌──────────┐
│Discord │ │ REST API │
│  Bot   │ │ (Flask/  │
│        │ │ FastAPI) │
└────────┘ └────┬─────┘
                │
                ▼
         ┌──────────┐
         │ Web Map  │
         │ (fetch)  │
         └──────────┘
```

**Why This Architecture**:
- ✅ **Single Source of Truth**: Database eliminates data sync issues
- ✅ **Real-time Updates**: Web map sees Discord changes immediately via API
- ✅ **Query Performance**: Database indexes make searches fast
- ✅ **Concurrent Access**: Database handles multiple readers/writers safely
- ✅ **Transaction Safety**: ACID guarantees for updates
- ✅ **Future-Proof**: Easy to migrate to PostgreSQL if needed

**Implementation**:
- **Database**: SQLite (start simple, migrate to PostgreSQL if needed)
- **Discord Bot**: Direct database access (Python)
- **Web Map**: REST API endpoint (`GET /api/v1/belgian-nodes`)
- **API Framework**: Flask or FastAPI (lightweight)


#### Database Choice: SQLite

**Selected**: **SQLite Database**
- **Pros**: ACID transactions, concurrent reads, SQL queries, lightweight, zero configuration
- **Cons**: Write concurrency limitations (acceptable for this use case)
- **Best for**: Small to medium scale, single server, perfect for this project
- **Future**: Can migrate to PostgreSQL if needed for higher concurrency or network access


#### Database Schema (SQLite Implementation)
```sql
-- Belgian nodes table
CREATE TABLE belgian_nodes (
    public_key VARCHAR(64) PRIMARY KEY,
    type INTEGER NOT NULL,
    adv_name VARCHAR(255),
    adv_lat REAL,  -- SQLite uses REAL for floating point numbers
    adv_lon REAL,  -- SQLite uses REAL for floating point numbers
    city VARCHAR(100),  -- Extracted via Geopy
    last_advert TEXT,  -- SQLite uses TEXT for timestamps (ISO 8601 format)
    inserted_date TEXT,  -- SQLite uses TEXT for timestamps (ISO 8601 format)
    updated_date TEXT,  -- From official map, tracks when node was last updated on official map (ISO 8601 format)
    params TEXT,  -- Radio parameters stored as JSON string in SQLite
    link TEXT,
    source VARCHAR(20),
    inserted_by VARCHAR(64),  -- Public hex key of companion device that uploaded node to official map (from official map, immutable)
    updated_by VARCHAR(64),  -- Public hex key of companion device that last updated node on official map (from official map, immutable)
    discord_owner_id VARCHAR(20),  -- Discord user ID (set when user claims node via Discord bot)
    discord_owner_name VARCHAR(100),  -- Discord username (set when user claims node via Discord bot)
    synced_from_official INTEGER DEFAULT 0,  -- SQLite uses INTEGER for BOOLEAN (1 = TRUE, 0 = FALSE)
    last_sync_date TEXT,  -- SQLite uses TEXT for timestamps (ISO 8601 format)
    is_active INTEGER DEFAULT 1,  -- SQLite uses INTEGER for BOOLEAN (1 = TRUE, 0 = FALSE) - FALSE when node removed from official map
    removed_from_official INTEGER DEFAULT 0,  -- SQLite uses INTEGER for BOOLEAN (1 = TRUE, 0 = FALSE) - TRUE when node removed from official map
    removed_date TEXT,  -- Timestamp when node was removed (ISO 8601 format)
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,  -- SQLite uses TEXT for timestamps
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP  -- SQLite uses TEXT for timestamps
);

-- Sync history (track changes)
CREATE TABLE sync_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,  -- SQLite uses AUTOINCREMENT
    sync_date TEXT DEFAULT CURRENT_TIMESTAMP,  -- SQLite uses TEXT for timestamps
    nodes_added INTEGER DEFAULT 0,
    nodes_removed INTEGER DEFAULT 0,
    nodes_restored INTEGER DEFAULT 0,  -- Inactive nodes that reappeared
    nodes_updated INTEGER DEFAULT 0,
    details TEXT  -- JSON stored as TEXT in SQLite (list of added/removed/restored public_keys)
);

-- Node change log (track what changed)
CREATE TABLE node_changes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,  -- SQLite uses AUTOINCREMENT
    public_key VARCHAR(64),
    change_type VARCHAR(20),  -- 'added', 'removed', 'updated', 'restored', 'deleted'
    sync_date TEXT,  -- SQLite uses TEXT for timestamps
    old_data TEXT,  -- JSON stored as TEXT in SQLite
    new_data TEXT  -- JSON stored as TEXT in SQLite
);

-- Append-only log of Discord ownership events
CREATE TABLE node_claims (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    public_key VARCHAR(64) NOT NULL,
    discord_owner_id VARCHAR(20),
    discord_owner_name VARCHAR(100),
    action VARCHAR(10) NOT NULL,         -- 'claim' or 'unclaim'
    timestamp TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
```

### 3. Discord Bot Features

#### Technology Stack
- **discord.py** (Python Discord API library)
- **Slash Commands** (`/` commands)

#### Required Commands

**Discord bot scope**: The bot allows searching nodes, listing your own nodes, claiming/unclaiming nodes, updating city, and viewing stats. No node register/delete or recent command.

##### `/mynodes` - List Your Nodes
- Lists all nodes owned by the user (including inactive).
- **Response Visibility**: **Ephemeral** (only visible to sender).
- **Display**: Simplified list with coordinates (only for own nodes).

##### `/node claim` - Claim a Node
Allow users to claim ownership of a node by partial name or partial public key:
- **Parameters**:
  - `query` (required): Node's **partial** name or **partial** public key (hex)
- **Search Behavior**:
  - Searches for nodes matching the partial query using **substring matching** (anywhere in name or public key)
  - If **exactly 1 node** found: Claim that node
  - If **multiple nodes** found: Show error message listing all matching nodes (with truncated public keys) and ask user to be more specific
  - If **no nodes** found: Show error message
- **Action**:
  - Sets `discord_owner_id` = command user's ID
  - Sets `discord_owner_name` = command user's username
  - Appends one row to `node_claims` with `action = 'claim'` and the current timestamp
  - Verifies the node exists in the Belgian database
  - **Note**: `updated_date` (from official map) is never modified by Discord commands
- **Response**: 
  - Success: Confirmation message with node name - **Public** (visible to entire channel)
  - Error: List of matching nodes if multiple found, or "Node not found" if none - **Ephemeral** (only visible to sender)
- **Response Visibility**:
  - **Success messages**: Public (visible to channel) - shows successful claim to everyone
  - **Error messages**: Ephemeral (only to sender) - errors are private
- **Logging**: Log all claim attempts to console with user info, query, and result

##### `/node unclaim` - Remove Ownership
- Parameter: `query` (required). Same search behavior as claim; allows unclaiming inactive nodes if owned.
- **Response Visibility**: Success public; errors ephemeral.

#### Command Behavior Rules

1. **Partial Matching**: All search/claim/unclaim operations support **substring matching** (matches anywhere in the string, not just prefix) on:
   - Node names (case-insensitive substring match - matches beginning, middle, or end)
   - Public keys (case-insensitive hex substring match - matches beginning, middle, or end)
   - Examples:
     - Query "aa" matches both "aabbcc" and "ccbbaa" (not just strings starting with "aa")
     - Query "R1" matches "USER_R1_Home" (matches in the middle of the name)
   - **All searches are case-insensitive** (node names, public keys, cities, etc.)

2. **Public Key Storage and Display**:
   - **Storage**: Public keys are stored in **lowercase** in the database
   - **Display**: Public keys are **always displayed in UPPERCASE** in Discord responses
   - This applies to both full keys and truncated keys (6 characters)
   - Example: Stored as `0000001d8652...`, displayed as `0000001D8652...`

3. **Multiple Results Handling**: For action commands (`/node claim`, `/node unclaim`):
  - If multiple nodes match: Show error message with list of all matching nodes
  - User must refine query to match exactly 1 node
  - **List format**: Show **ICON `HEX HEAD` - NODE NAME - <DISCORD USER/Unclaimed>**
  - Icons: 📱 (companion), 📡 (repeater), 💾 (room server), 🌡️ (sensor)
  - Hex head: First 6 characters in UPPERCASE, displayed as code (backticks)
  - Example: `📱 `4E21ED` - USER_R1_Home - Unclaimed`

4. **Public Key Display**:
   - Show first 6 characters in UPPERCASE (e.g., `000000...`) where applicable
   - **Storage**: Always stored in lowercase in database

5. **Logging Requirements**:
   - **Every command** must log to console:
     - Command name
     - User ID and username
     - Parameters/query
     - Result (success/failure, node count, etc.)
   - Format: `[TIMESTAMP] [COMMAND] User: @username (ID: 123456) Query: "xyz" Result: 3 nodes found`

6. **Discord Markdown Formatting**:
   - Node names with underscores (e.g., "USER_R1_Home") must be properly escaped to prevent Discord from rendering them as italic text
   - Use code blocks or escape underscores: `USER_R1_Home` or `USER\_R1\_Home`
   - All node names displayed in Discord responses must preserve underscores correctly
   - Example: Display `USER_R1_Home` instead of *USER*R1*Home* (which would render incorrectly)

7. **Data Update Tracking**:
   - Every Discord ownership change appends one row to `node_claims`:
     - `/node claim`: inserts an event with `action = 'claim'` and the current timestamp.
     - `/node unclaim`: inserts an event with `action = 'unclaim'` and the current timestamp.
   - **Important**: `updated_date` (from official map) is **NOT** modified by Discord commands.
   - The append-only `node_claims` log is the single source of truth for ownership history.

8. **Node Type Display**:
   - Node types are displayed and searchable as **text** instead of numbers:
     - `1` = "companion"
     - `2` = "repeater"
     - `3` = "room server"
     - `4` = "sensor"
   - All type displays in Discord show the text name, not the number
   - Internal storage still uses numbers (1-4) for database efficiency

9. **Response Visibility Rules**:
   - **Public Responses** (visible to entire channel):
     - `/node claim` - Success messages (shows successful claim to channel)
     - `/node unclaim` - Success messages (shows successful unclaim to channel)
   - **Ephemeral Responses** (only visible to command sender):
     - `/mynodes` - All responses (private information including coordinates)
     - `/node claim` - Error messages (node not found, multiple matches, already claimed)
     - `/node unclaim` - Error messages (node not found, multiple matches, ownership failed, etc.)
     - All interactive prompts (confirmation dialogs, etc.)
   - **Implementation**: Use `ephemeral=True` parameter in `interaction.response.send_message()` for private responses
   - **Rationale**: Success messages are public to show community activity; errors and own-node list are private.

10. **User Restrictions - What Discord Users CANNOT Do**:
   - **Public Key/Hex is IMMUTABLE**: Discord users can **NEVER** edit, modify, or change a node's public key (hex). This field is read-only and cannot be updated via any Discord command.
   - **Node Type is IMMUTABLE**: Discord users can **NEVER** edit, modify, or change a node's type. This field is read-only.
   - **Coordinates are NOT Searchable**: Users cannot search or filter nodes by coordinates (latitude/longitude).
   - **Coordinates Display Restrictions**: Coordinates are **only displayed** in ephemeral messages (e.g. `/mynodes` and interactive prompts) for security reasons. They are **never shown** in public messages.
  - **Cannot Add Nodes via Discord**: Discord users cannot add new nodes to the database. New nodes are added only via the sync service from the official MeshCore map (or via the MeshCore app / official map).
   - **Cannot Remove Nodes via Discord**: Node deletion via Discord has been removed.
   - **Cannot Edit Node Fields**: The Discord bot does not edit node attributes. All node attributes (`adv_name`, `city`, `params`, `adv_lat`, `adv_lon`, `link`, `inserted_by`, `updated_by`, `inserted_date`, `updated_date`) are **read-only** from the bot's perspective and come from the official map / sync service.
   - **Field Clarification**:
     - `inserted_by` / `updated_by`: Public hex keys of companion devices that uploaded/updated nodes on the official map (from official map, never modified).
     - `discord_owner_id` / `discord_owner_name`: Discord user information (set only via `/node claim`, cleared by `/node unclaim`).
     - `updated_date`: From official map, tracks when the node was last updated on the official MeshCore map (never modified by the Discord bot).
     - `node_claims`: Append-only event log of every `/node claim` and `/node unclaim` action with a timestamp.
   - **What Users CAN Do**:
     - Claim node ownership (`/node claim`)
     - Release node ownership (`/node unclaim`)
   - **Security**: `/node unclaim` verifies the caller is the current owner before allowing the change.

#### Frequency Presets

The following presets are recognized and displayed when node parameters match:

| Preset Name | Frequency (MHz) | SF | BW | CR |
|------------|----------------|----|----|----|
| **Australia** | 915.800 | 10 | 250 | 5 |
| **Australia: Victoria** | 916.675 | 7 | 62.5 | 8 |
| **EU/UK (Narrow)** | 869.618 | 8 | 62.5 | 8 |
| **EU/UK (Long Range)** | 869.525 | 11 | 250 | 5 |
| **EU/UK (Medium Range)** | 869.525 | 10 | 250 | 5 |
| **Czech Republic (Narrow)** | 869.525 | 7 | 62.5 | 5 |
| **EU 433MHz (Long Range)** | 433.650 | 11 | 250 | 5 |
| **New Zealand** | 917.375 | 11 | 250 | 5 |
| **New Zealand (Narrow)** | 917.375 | 7 | 62.5 | 5 |
| **Portugal 433** | 433.375 | 9 | 62.5 | 6 |
| **Portugal 868** | 869.618 | 7 | 62.5 | 6 |
| **USA/Canada (Recommended)** | 910.525 | 7 | 62.5 | 5 |
| **Vietnam** | 920.250 | 11 | 250 | 5 |

**Display Format Examples**:
- If node matches "EU/UK (Narrow)": Display `EU/UK (Narrow) (869.618 MHz)`
- If node matches "USA/Canada (Recommended)": Display `USA/Canada (Recommended) (910.525 MHz)`
- If no preset matches: Display `869.618 MHz (SF: 8, BW: 62.5, CR: 8)`

### 4. Web Map Updates

#### Required Modifications
1. **Data Source**: Change from official API to local Belgian node data store
2. **Belgian Focus**: 
   - Default map center: Belgium coordinates
   - Default zoom: Appropriate for Belgium view
3. **City Display**: Show city name in node popups
4. **Discord Owner**: Display Discord owner info if available
5. **Filter by City**: Add city filter to existing filters
6. **Belgian Statistics**: Update stats to show Belgian-specific data

#### Current Default Coordinates (to update)
```javascript
// Current: Generic coordinates
let params = { lat: 50.8477, lon: 4.3572, zoom: 8 };

// Should be: Belgium-focused
let params = { lat: 50.5039, lon: 4.4699, zoom: 8 };  // Brussels center
```

---

## Technical Implementation Plan

### Phase 1: Data Synchronization Service

#### Python Script: `sync_belgian_nodes.py`

```python
# Pseudocode structure
import requests
from geopy.geocoders import Nominatim
from geopy.exc import GeocoderTimedOut, GeocoderServiceError
import sqlite3
from datetime import datetime

BELGIUM_BOUNDS = {
    'min_lat': 49.5,
    'max_lat': 51.5,
    'min_lon': 2.5,
    'max_lon': 6.4
}

def download_official_nodes():
    """Download all nodes from official API"""
    response = requests.get('https://map.meshcore.io/api/v1/nodes')
    return response.json()

def filter_by_bounds(nodes):
    """Filter nodes by Belgian geographic bounds"""
    filtered = []
    for node in nodes:
        if not node.get('adv_lat') or not node.get('adv_lon'):
            continue
        lat = node['adv_lat']
        lon = node['adv_lon']
        if (BELGIUM_BOUNDS['min_lat'] <= lat <= BELGIUM_BOUNDS['max_lat'] and
            BELGIUM_BOUNDS['min_lon'] <= lon <= BELGIUM_BOUNDS['max_lon']):
            filtered.append(node)
    return filtered

def verify_with_geopy(node):
    """Verify node is in Belgium and extract city"""
    geolocator = Nominatim(user_agent="belgian_meshcore_map")
    try:
        location = geolocator.reverse(
            f"{node['adv_lat']}, {node['adv_lon']}",
            timeout=10,
            language='en'
        )
        if location and location.raw.get('address'):
            country = location.raw['address'].get('country_code', '').upper()
            if country == 'BE':
                city = location.raw['address'].get('city') or \
                       location.raw['address'].get('town') or \
                       location.raw['address'].get('village') or \
                       location.raw['address'].get('municipality') or \
                       'Unknown'
                return {'verified': True, 'city': city}
            else:
                return {'verified': False, 'reason': f'Country is {country}'}
    except (GeocoderTimedOut, GeocoderServiceError) as e:
        return {'verified': False, 'reason': f'Geopy error: {str(e)}'}
    return {'verified': False, 'reason': 'No location data'}

def track_changes(current_nodes, previous_nodes):
    """Track added and removed nodes"""
    current_keys = {n['public_key'] for n in current_nodes}
    previous_keys = {n['public_key'] for n in previous_nodes}
    
    added = current_keys - previous_keys
    removed = previous_keys - current_keys
    
    return {
        'added': list(added),
        'removed': list(removed),
        'added_count': len(added),
        'removed_count': len(removed)
    }

def main():
    # 1. Download nodes
    all_nodes = download_official_nodes()
    
    # 2. Filter by bounds
    bounded_nodes = filter_by_bounds(all_nodes)
    
    # 3. Verify with Geopy
    belgian_nodes = []
    for node in bounded_nodes:
        result = verify_with_geopy(node)
        if result['verified']:
            node['city'] = result['city']
            belgian_nodes.append(node)
    
    # 4. Load previous state from database
    previous_nodes = load_previous_nodes_from_db()
    
    # 5. Track changes
    changes = track_changes(belgian_nodes, previous_nodes)
    
    # 6. Save current state to SQLite database
    save_nodes_to_db(belgian_nodes)
    save_changes_to_db(changes)
    
    # 7. Log results
    print(f"Total nodes downloaded: {len(all_nodes)}")
    print(f"Nodes within bounds: {len(bounded_nodes)}")
    print(f"Verified Belgian nodes: {len(belgian_nodes)}")
    print(f"Nodes added: {changes['added_count']}")
    print(f"Nodes removed: {changes['removed_count']}")

if __name__ == '__main__':
    main()
```

#### Considerations
- **Rate Limiting**: Geopy uses Nominatim (OpenStreetMap) - respect rate limits
  - Add delays between requests (1-2 seconds)
  - Consider caching results for nodes that haven't moved
- **Error Handling**: Handle Geopy timeouts and service errors gracefully
- **Caching**: Cache Geopy results to avoid re-querying same coordinates
- **Logging**: Comprehensive logging for debugging and monitoring

### Phase 2: Discord Bot

#### Bot Instructions Post Feature

The Discord bot can automatically update its own instructions post in a Discord channel on startup.

**Configuration** (via environment variables):
- `STARTUP_CHANNEL_ID` (optional): Channel ID where instructions are posted
- `STARTUP_MESSAGE_ID` (optional): Message ID of existing post to update

**Behavior**:
1. **Neither defined**: Bot does nothing (no message updates)
2. **Only `STARTUP_CHANNEL_ID` defined**: Bot posts a placeholder message "PLACEHOLDER FOR BOT"
3. **Both defined**: Bot edits the existing message with content from `DISCORDBOT_INSTRUCTIONS.md`

**Implementation**:
- Runs on bot startup (`on_ready` event)
- Loads instructions from `DISCORDBOT_INSTRUCTIONS.md` file
- Updates or creates message in specified channel
- Handles errors gracefully (channel not found, message not found, etc.)

**File**: `DISCORDBOT_INSTRUCTIONS.md` - Contains the bot instructions text to post in Discord

#### Python Script: `discord_bot.py`

```python
# Pseudocode structure
import discord
from discord import app_commands
from discord.ext import commands
from datetime import datetime
import sqlite3
import os
from dotenv import load_dotenv

# Load environment variables
load_dotenv()

intents = discord.Intents.default()
intents.message_content = True
bot = commands.Bot(command_prefix='!', intents=intents)

# Node type mapping
NODE_TYPES = {
    1: "companion",
    2: "repeater",
    3: "room server",
    4: "sensor"
}

NODE_TYPES_REVERSE = {v.lower(): k for k, v in NODE_TYPES.items()}

# Node type icons for Discord display
NODE_TYPE_ICONS = {
    1: "📱",  # companion
    2: "📡",  # repeater
    3: "💾",  # room server
    4: "🌡️"   # sensor
}

# Frequency presets
FREQUENCY_PRESETS = [
    {"name": "Australia", "freq": 915.800, "sf": 10, "bw": 250, "cr": 5},
    {"name": "Australia: Victoria", "freq": 916.675, "sf": 7, "bw": 62.5, "cr": 8},
    {"name": "EU/UK (Narrow)", "freq": 869.618, "sf": 8, "bw": 62.5, "cr": 8},
    {"name": "EU/UK (Long Range)", "freq": 869.525, "sf": 11, "bw": 250, "cr": 5},
    {"name": "EU/UK (Medium Range)", "freq": 869.525, "sf": 10, "bw": 250, "cr": 5},
    {"name": "Czech Republic (Narrow)", "freq": 869.525, "sf": 7, "bw": 62.5, "cr": 5},
    {"name": "EU 433MHz (Long Range)", "freq": 433.650, "sf": 11, "bw": 250, "cr": 5},
    {"name": "New Zealand", "freq": 917.375, "sf": 11, "bw": 250, "cr": 5},
    {"name": "New Zealand (Narrow)", "freq": 917.375, "sf": 7, "bw": 62.5, "cr": 5},
    {"name": "Portugal 433", "freq": 433.375, "sf": 9, "bw": 62.5, "cr": 6},
    {"name": "Portugal 868", "freq": 869.618, "sf": 7, "bw": 62.5, "cr": 6},
    {"name": "USA/Canada (Recommended)", "freq": 910.525, "sf": 7, "bw": 62.5, "cr": 5},
    {"name": "Vietnam", "freq": 920.250, "sf": 11, "bw": 250, "cr": 5},
]

def escape_discord_markdown(text):
    """Escape Discord markdown to prevent formatting issues (especially underscores)"""
    # Escape underscores to prevent italic rendering
    # Use code blocks for node names to preserve underscores correctly
    return f"`{text}`"

def get_node_type_text(type_num):
    """Convert node type number to text"""
    return NODE_TYPES.get(type_num, f"Unknown ({type_num})")

def get_node_type_number(type_text):
    """Convert node type text to number (case-insensitive)"""
    return NODE_TYPES_REVERSE.get(type_text.lower())

def get_node_type_icon(type_num):
    """Get Discord icon for node type"""
    return NODE_TYPE_ICONS.get(type_num, "•")

def match_frequency_preset(params):
    """Match frequency parameters against presets"""
    # params should be dict with keys: freq, sf, bw, cr
    for preset in FREQUENCY_PRESETS:
        if (abs(params.get('freq', 0) - preset['freq']) < 0.001 and
            params.get('sf') == preset['sf'] and
            params.get('bw') == preset['bw'] and
            params.get('cr') == preset['cr']):
            return preset
    return None

def format_frequency_display(params):
    """Format frequency display with preset matching"""
    preset = match_frequency_preset(params)
    if preset:
        return f"{preset['name']} ({preset['freq']} MHz)"
    else:
        return f"{params.get('freq', 'N/A')} MHz (SF: {params.get('sf', 'N/A')}, BW: {params.get('bw', 'N/A')}, CR: {params.get('cr', 'N/A')})"

def append_node_claim_event(public_key, user_id, user_name, action):
    """Append a row to node_claims for the given action ('claim' or 'unclaim').

    SQL:
        INSERT INTO node_claims
            (public_key, discord_owner_id, discord_owner_name, action, timestamp)
        VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
    """
    pass

def log_command(command_name, user, query=None, result=None):
    """Log command execution to console"""
    timestamp = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    user_info = f"@{user.name} (ID: {user.id})"
    query_str = f' Query: "{query}"' if query else ""
    result_str = f" Result: {result}" if result else ""
    print(f"[{timestamp}] [{command_name}] User: {user_info}{query_str}{result_str}")

def truncate_public_key(pub_key, show_full=False):
    """Truncate public key to 6 characters unless show_full is True
    Always returns UPPERCASE for display (even though stored in lowercase)
    """
    # Convert to uppercase for display
    pub_key_upper = pub_key.upper()
    if show_full:
        return pub_key_upper
    return pub_key_upper[:6] + "..." if len(pub_key_upper) > 6 else pub_key_upper

def format_node_list(nodes, show_full_keys=False):
    """Format list of nodes for display
    Multiple results: Format: ICON NODE NAME HEX HEAD
    """
    if len(nodes) == 1:
        # Single node: show full details
        node = nodes[0]
        return format_full_node_details(node)
    else:
        # Multiple nodes: show format: ICON NODE NAME HEX HEAD
        lines = []
        for node in nodes:
            # Get icon for node type
            icon = get_node_type_icon(node['type'])
            # Only show first 6 characters of hex key (in uppercase)
            pub_key_display = truncate_public_key(node['public_key'], show_full=False)
            # Escape node name to preserve underscores (e.g., "USER_R1_Home")
            node_name = escape_discord_markdown(node['adv_name'])
            # Format: ICON NODE NAME HEX HEAD
            lines.append(f"{icon} {node_name} {pub_key_display}")
        return "\n".join(lines)

def format_full_node_details(node, show_coordinates=False):
    """Format full node information (used when exactly 1 node found)
    show_coordinates: Only True when listing own nodes (security reasons)
    """
    # Escape node name to preserve underscores
    node_name = escape_discord_markdown(node['adv_name'])
    # Convert type number to text
    type_text = get_node_type_text(node['type'])
    # Format frequency with preset matching
    freq_display = format_frequency_display(node.get('params', {}))
    # Public key always displayed in UPPERCASE
    pub_key_display = node['public_key'].upper()
    
    # Build response - coordinates only shown for own nodes
    response = f"""
**{node_name}**
Type: {type_text}
Public Key: {pub_key_display} (full)
"""
    if show_coordinates:
        response += f"Location: {node['adv_lat']}, {node['adv_lon']}\n"
    
    response += f"""City: {node.get('city', 'Unknown')}
Frequency: {freq_display}
Owner: {node.get('discord_owner_name', 'Unclaimed')}
"""
    response += f"[View on Map]({get_map_link(node)})\n"
    return response

@bot.tree.command(name="search", description="Search Belgian MeshCore nodes")
@app_commands.describe(
    query="Search by partial name or partial public key",
    node_type="Filter by node type (companion, repeater, room server, sensor)",
    city="Filter by city",
    frequency="Filter by frequency",
    owner="Filter by Discord owner"
)
async def search_nodes(interaction: discord.Interaction, 
                       query: str = None,
                       node_type: str = None,
                       city: str = None,
                       frequency: float = None,
                       owner: discord.User = None):
    # Convert node_type text to number if provided
    type_num = None
    if node_type:
        type_num = get_node_type_number(node_type)
        if type_num is None:
            # Error message - ephemeral (only to sender)
            await interaction.response.send_message(
                f"Invalid node type: {node_type}. Valid types: companion, repeater, room server, sensor",
                ephemeral=True
            )
            return
    
    # Query database with substring matching (matches anywhere in string, not just prefix)
    # Uses LIKE '%query%' for substring matching
    nodes = query_nodes_substring(query, type_num, city, frequency, owner)
    
    # Log command
    result_count = len(nodes) if nodes else 0
    log_command("SEARCH", interaction.user, query, f"{result_count} nodes found")
    
    if not nodes:
        # No results - public (general information)
        await interaction.response.send_message("No nodes found.")
        return
    
    # If exactly 1 node: show full details (replaces /info)
    # NOTE: Coordinates NOT shown in search results (security reasons)
    if len(nodes) == 1:
        response = format_full_node_details(nodes[0], show_coordinates=False)
    else:
        # Multiple nodes: show abbreviated list (max 25)
        response = format_node_list(nodes[:25], show_full_keys=False)
        if len(nodes) > 25:
            response += f"\n\n*... and {len(nodes) - 25} more (refine your search)*"
    
    # Search results - public (visible to channel)
    await interaction.response.send_message(response)

@bot.tree.command(name="claim", description="Claim ownership of a node")
@app_commands.describe(query="Node's partial name or partial public key")
async def claim_node(interaction: discord.Interaction, query: str):
    # Search with substring matching (matches anywhere in string)
    nodes = query_nodes_substring(query)
    
    # Log command
    result_count = len(nodes) if nodes else 0
    log_command("CLAIM", interaction.user, query, f"{result_count} nodes found")
    
    if not nodes:
        # Error - ephemeral (only to sender)
        await interaction.response.send_message("Node not found in Belgian database.", ephemeral=True)
        return
    
    if len(nodes) > 1:
        # Multiple matches: show error with list - ephemeral (only to sender)
        error_msg = f"**Multiple nodes found. Please be more specific:**\n\n"
        error_msg += format_node_list(nodes, show_full_keys=False)
        await interaction.response.send_message(error_msg, ephemeral=True)
        return
    
    # Exactly 1 node: claim it.
    # update_ownership() updates belgian_nodes AND inserts the
    # corresponding row into node_claims in a single transaction.
    node = nodes[0]
    update_ownership(node['public_key'], interaction.user.id, interaction.user.name)
    
    log_command("CLAIM", interaction.user, query, f"SUCCESS: Claimed {node['adv_name']}")
    # Escape node name to preserve underscores
    node_name = escape_discord_markdown(node['adv_name'])
    # Success - public (visible to channel)
    await interaction.response.send_message(
        f"✅ Successfully claimed node: {node_name}"
    )

@bot.tree.command(name="manage", description="Manage your claimed nodes")
async def manage_nodes(interaction: discord.Interaction):
    # Subcommands handled via Discord's command groups
    pass

@manage_nodes.tree.command(name="list", description="List all your claimed nodes")
async def manage_list(interaction: discord.Interaction):
    nodes = get_user_nodes(interaction.user.id)
    log_command("MANAGE_LIST", interaction.user, result=f"{len(nodes)} nodes owned")
    
    if not nodes:
        # Private information - ephemeral (only to sender)
        await interaction.response.send_message("You don't own any nodes.", ephemeral=True)
        return
    
    # Format nodes with coordinates (only shown for own nodes - security)
    response = f"**Your claimed nodes ({len(nodes)}):**\n\n"
    for node in nodes:
        # Show full details with coordinates for own nodes
        response += format_full_node_details(node, show_coordinates=True)
        response += "\n"
    
    # Private information with coordinates - ephemeral (only to sender)
    await interaction.response.send_message(response, ephemeral=True)

@manage_nodes.tree.command(name="unclaim", description="Remove ownership claim")
@app_commands.describe(query="Node's partial name or partial public key")
async def manage_unclaim(interaction: discord.Interaction, query: str):
    # Search with substring matching (matches anywhere in string)
    nodes = query_nodes_substring(query)
    
    log_command("MANAGE_UNCLAIM", interaction.user, query, f"{len(nodes)} nodes found")
    
    if not nodes:
        # Error - ephemeral (only to sender)
        await interaction.response.send_message("Node not found.", ephemeral=True)
        return
    
    if len(nodes) > 1:
        # Error - ephemeral (only to sender)
        error_msg = f"**Multiple nodes found. Please be more specific:**\n\n"
        error_msg += format_node_list(nodes, show_full_keys=False)
        await interaction.response.send_message(error_msg, ephemeral=True)
        return
    
    # Verify ownership
    node = nodes[0]
    if node.get('discord_owner_id') != str(interaction.user.id):
        # Error - ephemeral (only to sender)
        await interaction.response.send_message("You don't own this node.", ephemeral=True)
        return
    
    # remove_ownership() clears discord_owner_id/discord_owner_name on
    # belgian_nodes AND inserts the corresponding 'unclaim' row into
    # node_claims in a single transaction.
    remove_ownership(node['public_key'], interaction.user.id)
    
    log_command("MANAGE_UNCLAIM", interaction.user, query, f"SUCCESS: Unclaimed {node['adv_name']}")
    # Escape node name to preserve underscores
    node_name = escape_discord_markdown(node['adv_name'])
    # Success - public (visible to channel)
    await interaction.response.send_message(f"✅ Unclaimed node: {node_name}")

@bot.tree.command(name="stats", description="Show Belgian node statistics")
async def stats(interaction: discord.Interaction):
    stats_data = get_statistics()
    log_command("STATS", interaction.user, result="Statistics displayed")
    
    # Format type names using text mapping
    type_labels = {
        1: "Companions",
        2: "Repeaters",
        3: "Room Servers",
        4: "Sensors"
    }
    
    type_lines = []
    for type_num in [1, 2, 3, 4]:
        count = stats_data['by_type'].get(type_num, 0)
        type_lines.append(f"  • {type_labels[type_num]}: {count}")
    
    response = f"""
**Belgian MeshCore Node Statistics**

Total Nodes: {stats_data['total']}
By Type:
{chr(10).join(type_lines)}

Top Cities: {', '.join(stats_data['top_cities'][:5])}
Recently Added (24h): {stats_data['recent_24h']}
"""
    # Statistics - public (visible to channel)
    await interaction.response.send_message(response)

@bot.event
async def on_ready():
    print(f'{bot.user} has logged in')
    try:
        synced = await bot.tree.sync()
        print(f"Synced {len(synced)} command(s)")
    except Exception as e:
        print(f"Failed to sync commands: {e}")
    
    # Update bot instructions post (if configured)
    await update_bot_instructions_post()

async def update_bot_instructions_post():
    """
    Update bot instructions post in Discord channel.
    Behavior:
    - If neither STARTUP_CHANNEL_ID nor STARTUP_MESSAGE_ID defined: Do nothing
    - If only STARTUP_CHANNEL_ID defined: Post placeholder message "PLACEHOLDER FOR BOT"
    - If both defined: Edit existing message with instructions from DISCORDBOT_INSTRUCTIONS.md
    """
    channel_id = os.getenv('STARTUP_CHANNEL_ID')
    message_id = os.getenv('STARTUP_MESSAGE_ID')
    
    if not channel_id:
        # No channel configured, skip
        return
    
    try:
        channel = bot.get_channel(int(channel_id))
        if not channel:
            print(f"Warning: Channel {channel_id} not found")
            return
        
        # Load instructions from DISCORDBOT_INSTRUCTIONS.md
        instructions_content = load_bot_instructions()
        
        if message_id:
            # Edit existing message
            try:
                message = await channel.fetch_message(int(message_id))
                await message.edit(content=instructions_content)
                print(f"Updated bot instructions post: {message_id}")
            except discord.NotFound:
                print(f"Warning: Message {message_id} not found, posting new message")
                await channel.send(instructions_content)
        else:
            # Post new placeholder message
            placeholder = "PLACEHOLDER FOR BOT"
            await channel.send(placeholder)
            print(f"Posted placeholder message in channel {channel_id}")
    except Exception as e:
        print(f"Error updating bot instructions post: {e}")

def load_bot_instructions():
    """Load bot instructions from DISCORDBOT_INSTRUCTIONS.md file"""
    try:
        with open('DISCORDBOT_INSTRUCTIONS.md', 'r', encoding='utf-8') as f:
            return f.read()
    except FileNotFoundError:
        return "Bot instructions file (DISCORDBOT_INSTRUCTIONS.md) not found."

bot.run(os.getenv('DISCORD_BOT_TOKEN'))
```

#### Database Queries
- Efficient indexing on `public_key`, `city`, `discord_owner_id`, `is_active`
- **Always filter active nodes**: `WHERE is_active = TRUE` (for web map and ALL Discord bot commands)
- **Discord Bot Filtering**: Commands that target a single node (`/node claim`, `/node unclaim`) MUST filter active nodes for discovery; `/mynodes` shows both active and inactive nodes (with clear indication of inactive status)
- Prepared statements for security
- Connection pooling for performance
- **Case-Insensitive Storage and Queries**:
  - All text fields (node names, cities, etc.) stored and queried case-insensitively
  - Public keys stored in **lowercase** in database
  - All searches use `ILIKE` or `LOWER()` for case-insensitive matching
- **Substring Matching Support**:
  - `query_nodes_substring()`: Supports substring matching (matches anywhere in string, not just prefix) on:
    - Node names: `WHERE LOWER(adv_name) LIKE LOWER('%query%')` (case-insensitive, matches beginning, middle, or end)
    - Public keys: `WHERE LOWER(public_key) LIKE LOWER('%query%')` (case-insensitive hex, matches beginning, middle, or end)
  - Examples:
    - Query "aa" matches both "aabbcc" and "ccbbaa" (not just strings starting with "aa")
    - Query "R1" matches "USER_R1_Home" (matches in the middle)
  - Can combine with other filters (type, city, frequency, owner)
  - Returns all matching nodes (no limit in query, limit in display)
- **Type Filtering**:
  - Type filter accepts text names ("companion", "repeater", "room server", "sensor")
  - Text is converted to number (1-4) before database query
  - Database stores and queries using numbers (1-4) for efficiency
  - Display always shows text names
- **Ownership Functions**:
  - `update_ownership()`: Sets `discord_owner_id` and `discord_owner_name` on `belgian_nodes` AND inserts a `'claim'` row into `node_claims` in the same transaction.
  - `remove_ownership()`: Clears `discord_owner_id` / `discord_owner_name` AND inserts an `'unclaim'` row into `node_claims` in the same transaction.
  - **Does NOT modify** `inserted_by`, `updated_by`, or `updated_date` (these come from the official map and are immutable from the bot's perspective).
  - **Other node attributes** (`adv_name`, `city`, `params`, `adv_lat`, `adv_lon`, `link`) are read-only from the bot's side; they are owned by the sync service.
  - **Date Field Source of Truth**:
    - `updated_date` – From the official map, never modified by the Discord bot.
    - `node_claims.timestamp` – From the Discord bot, ordered append-only history of every claim/unclaim event.
- **Security Restrictions**:
  - **No node addition**: Discord bot cannot add nodes (only sync service can)
  - **No node deletion**: Discord bot cannot delete nodes (only sync service can)
  - **Public key immutable**: `public_key` field cannot be modified by any Discord command
  - **Coordinates immutable**: `adv_lat` and `adv_lon` fields cannot be modified by any Discord command
  - **Coordinates not searchable**: Cannot filter or search by coordinates
  - **Coordinates display**: Only shown when listing own nodes via `/manage list` (security reasons)
  - All updates require ownership verification

### Phase 3: Web Map Integration

#### Modifications to `src/map.js`

1. **Change API endpoint**:
```javascript
// Current
const apiUrl = "https://map.meshcore.io/api/v1/nodes";

// New (REST API endpoint - recommended architecture)
const apiUrl = "/api/v1/belgian-nodes";  // Local REST API endpoint
```

**Implementation**: REST API endpoint (Flask/FastAPI) that queries the database
- **Endpoint**: `GET /api/v1/belgian-nodes`
- **Returns**: JSON array of all Belgian nodes
- **Benefits**: Real-time updates, single source of truth, proper separation of concerns

2. **Add city display**:
```javascript
// In node popup table
city: {
  label: "City",
  value: (val) => val || "Unknown"
}
```

3. **Add Discord owner display**:
```javascript
discord_owner: {
  label: "Discord Owner",
  value: (val) => val ? `@${val}` : "Unclaimed"
}
```

4. **Update default coordinates**:
```javascript
let params = { lat: 50.5039, lon: 4.4699, zoom: 8 };  // Brussels
```

5. **Add city filter**:
```javascript
// Add to filter menu
<li>
  <div class="field border">
    <input type="text" v-model="app.cityFilter" placeholder="Filter by city">
  </div>
</li>
```

6. **Remove Manual Node Addition Feature**:
   - Remove the "Add node from meshcore:// link" dialog and functionality
   - Remove the manual add button from the interface
   - Users can **no longer manually add nodes** via the web map
   - All nodes must come from the official MeshCore map via the sync service
   - This ensures data consistency and that all nodes are verified as Belgian

---

## Data Flow

### Sync Workflow (Periodic)
```
1. Sync Service runs (cron/scheduler)
   ↓
2. Downloads from official API
   ↓
3. Filters by Belgian bounds
   ↓
4. Verifies with Geopy (country = BE)
   ↓
5. Extracts city names
   ↓
6. Compares with previous state (from database)
   ↓
7. Tracks added/removed nodes
   ↓
8. Saves to SQLite database (single source of truth)
   ↓
9. Logs results
```

**Data Store**: SQLite database (`data/belgian_nodes.db`)
- All nodes stored in database (active and inactive)
- Active nodes: `is_active = TRUE` (displayed on map and searchable)
- Inactive nodes: `is_active = FALSE` (removed from official map, preserved for history)
- Change tracking stored in `sync_history` and `node_changes` tables
- **Integration**: Automatic immediate integration during sync

### Discord Bot Workflow
```
1. User issues /command
   ↓
2. Bot queries SQLite database
   ↓
3. Processes command logic
   ↓
4. Updates database (if needed)
   - Sets / clears `discord_owner_id` and `discord_owner_name` on `belgian_nodes`
   - Appends a row to `node_claims` (`action = 'claim'` or `'unclaim'`)
   ↓
5. Sends response to Discord
```

**Database Access**: Direct database connection (Python)
- No API layer needed for bot (direct DB access is faster)
- Updates are immediate and transactional

### Web Map Workflow
```
1. User loads meshmap.radio-actief.be
   ↓
2. Frontend requests Belgian nodes via REST API
   ↓
3. API endpoint queries SQLite database
   ↓
4. Returns JSON array of nodes
   ↓
5. Frontend renders on Leaflet map
```

**API Endpoint**: `GET /api/v1/belgian-nodes`
- **Framework**: Flask or FastAPI
- **Database**: SQLite (single source of truth)
- **Response**: JSON array of all Belgian nodes
- **Benefits**: Real-time updates, single source of truth, proper separation

---

## File Structure (Proposed)

```
RRY-Map-Bot/
├── README.md
├── PROJECT_SUMMARY.md (this file) ⭐ MAIN SPECIFICATION
├── DISCORDBOT_INSTRUCTIONS.md (bot instructions for Discord post)
├── DEPLOYMENT.md (deployment guide)
├── DOCUMENTATION_INDEX.md (documentation index)
├── package.json
├── requirements.txt (Python dependencies)
├── rry-map-bot.env.example (environment variables template)
├── .env (environment variables - NOT committed to git)
├── .gitignore
│
├── frontend/ (or keep root structure)
│   ├── index.html
│   ├── src/
│   │   ├── map.js
│   │   └── node-utils.js
│   ├── css/
│   ├── lib/
│   └── img/
│
├── backend/
│   ├── sync_belgian_nodes.py (sync service - writes to SQLite DB)
│   ├── discord_bot.py (Discord bot - direct SQLite DB access)
│   ├── database.py (SQLite DB utilities and schema)
│   └── api/
│       └── app.py (Flask/FastAPI REST API - queries SQLite DB)
│
├── data/
│   └── belgian_nodes.db (SQLite database - single source of truth)
│
├── config/
│   └── config.py (configuration)
│
├── .env (environment variables - NOT committed to git)
├── rry-map-bot.env.example (environment variables template)
└── DISCORDBOT_INSTRUCTIONS.md (bot instructions for Discord post)
```

---

## Dependencies

### Python (Backend)
- `discord.py` - Discord bot framework
- `requests` - HTTP requests for API
- `geopy` - Geocoding service
- `sqlite3` - SQLite database (built-in Python library)
- `flask` or `fastapi` - REST API framework for web map
- `python-dotenv` - Environment variables (loads `.env` file)

### Node.js (Frontend - existing)
- `@liamcottle/meshcore.js` - MeshCore protocol parsing

### Frontend Libraries (existing)
- Vue 3 (ESM)
- Leaflet
- Leaflet.markercluster
- Beer.css

---

## Configuration

### Environment Variables

**File**: `.env` (create from `rry-map-bot.env.example`)

```bash
# Discord Bot
DISCORD_BOT_TOKEN=your_discord_bot_token_here
DISCORD_GUILD_ID=your_server_id

# Discord Bot Instructions Post (Optional)
# If both are defined, bot will update the message with instructions from DISCORDBOT_INSTRUCTIONS.md
# If only STARTUP_CHANNEL_ID is defined, bot will post a placeholder message
# If neither is defined, bot will not update any message
STARTUP_CHANNEL_ID=your_channel_id  # Optional: Channel ID where bot instructions are posted
STARTUP_MESSAGE_ID=your_message_id  # Optional: Message ID of existing instructions post to update

# Database (SQLite - single source of truth)
DATABASE_PATH=data/belgian_nodes.db

# Geopy
GEOPY_USER_AGENT=belgian_meshcore_map
GEOPY_TIMEOUT=10

# API
OFFICIAL_API_URL=https://map.meshcore.io/api/v1/nodes
LOCAL_API_URL=http://localhost:8000/api/v1

# Sync Schedule
SYNC_INTERVAL_HOURS=6  # Run every 6 hours
```

**Security Note**: Never commit `.env` file to git. Always use `rry-map-bot.env.example` as a template.

---

## Security Considerations

1. **Discord Bot Token**: Store securely, never commit to git
2. **Database Credentials**: Use environment variables
3. **API Rate Limiting**: Implement rate limiting for Geopy
4. **Input Validation**: Validate all user inputs (Discord commands, API)
5. **SQL Injection**: Use parameterized queries
6. **CORS**: Configure CORS for web API if needed
7. **Authentication**: Consider authentication for node management endpoints

---

## Deployment

### Web Map
- Static file hosting (nginx, Apache, etc.)
- Or serve via Python backend (Flask/FastAPI)

### Discord Bot
- Run as systemd service
- Or containerized (Docker)
- Auto-restart on failure

### Sync Service
- Cron job or scheduled task
- Or separate service with scheduler

---

## Future Enhancements

1. **Node Approval Workflow**: Manual approval before integrating new nodes
2. **Node History**: Track all changes to nodes over time
3. **Notifications**: Discord notifications for node changes
4. **Analytics**: Statistics and trends dashboard
5. **Export**: Export node data (CSV, JSON)
6. **API Documentation**: Not required
7. **Multi-language**: Not required, just English

---

## Questions to Resolve

1. ✅ **Data Storage**: **DECIDED** - SQLite database with REST API
2. ✅ **API Architecture**: **DECIDED** - REST API (Flask) for web map
3. ✅ **Sync Integration**: **DEFINED** - Automatic immediate integration during sync
4. ✅ **Node Removal Handling**: **DEFINED** - Mark as inactive, preserve data for history
5. **Geopy Caching**: How long to cache Geopy results?
6. **Discord Permissions**: Who can claim/manage nodes?
7. **Node Ownership**: Can users unclaim nodes? Transfer ownership? *(Answer: Yes, users can unclaim via `/manage unclaim`)*
8. **Error Handling**: How to handle Geopy failures (retry, skip, manual review)?

---

## Next Steps

1. ✅ **Architecture Decision**: SQLite database + REST API architecture chosen
2. **Phase 1: Database Setup**
   - Create SQLite database schema (`database.py`)
   - Initialize database with tables (belgian_nodes, sync_history, node_changes)
   - Create database indexes for performance
3. **Phase 2: Sync Service**
   - Update sync service to write to SQLite database
   - Implement change tracking in database
   - Test sync with sample data
4. **Phase 3: Discord Bot**
   - Connect bot to SQLite database
   - Implement all commands with database queries
   - Test all bot functionality
5. **Phase 4: REST API**
   - Create Flask/FastAPI endpoint (`backend/api/app.py`)
   - Implement `GET /api/v1/belgian-nodes` endpoint
   - Test API with web map
6. **Phase 5: Web Map Updates**
   - Update `src/map.js` to use `/api/v1/belgian-nodes`
   - Remove manual node addition feature
   - Test map functionality
7. **Phase 6: Deployment**
   - Set up production environment
   - Configure API server
   - Deploy all components
8. **Phase 7: Documentation**
   - User guides
   - API documentation
   - Deployment guide

---

## Notes

- **Important**: Work ONLY in `RRY-Map-Bot/` folder
- Do not reference or use code from other bot/map projects in the repository
- This is a **new project** combining Discord bot and web map
- Focus is **exclusively on Belgian nodes**
- Sync service is **resource-intensive** - run sparingly (few times per day)
- Geopy verification is **critical** - ensures only Belgian nodes are included
- Integration workflow includes:
  - Automatic immediate integration during sync
  - Node lifecycle management (added/removed/updated)
  - Conflict resolution between official map and Discord user edits
  - Field-level update rules and merge strategies
  - Data preservation and historical tracking

---

*Last Updated: 2026-01-04*
*Project: RRY-Map-Bot - Belgian MeshCore Node Mapping System*

