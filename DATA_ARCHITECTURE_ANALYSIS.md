# Data Architecture Analysis & Decision

## Status: ✅ DECISION MADE

**Chosen Architecture**: Unified Database (SQLite) + REST API

This document provides the analysis that led to this decision.

---

## Current State

### Web Map
- **Current**: Reads nodes from JSON file via `fetch(apiUrl)`
- **Performance**: Fast initial load, simple implementation
- **Location**: `src/map.js` line 281: `const nodesReq = await fetch(apiUrl);`

### Requirements Analysis

#### Discord Bot Needs
- ✅ **Query Operations**: Substring matching, filters (type, city, frequency, owner)
- ✅ **Update Operations**: Claim, update properties, unclaim
- ✅ **Concurrent Access**: Multiple users can query simultaneously
- ✅ **Transaction Safety**: ACID transactions for updates
- ✅ **Performance**: Fast searches with indexes

#### Web Map Needs
- ✅ **Read Operations**: Load all nodes for display
- ✅ **Performance**: Fast initial load, smooth rendering
- ✅ **Simplicity**: Easy to fetch and parse
- ✅ **No Updates**: Map is read-only (no user modifications)

#### Sync Service Needs
- ✅ **Bulk Operations**: Add/update/remove multiple nodes
- ✅ **Transaction Safety**: Atomic updates
- ✅ **Change Tracking**: Track what changed

---

## Architecture Options

### Option 1: Unified Database (Recommended) ⭐

**Architecture**:
```
┌─────────────────┐
│  Sync Service   │
│  (Python)       │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│   Database      │
│  (SQLite/PostgreSQL) │
│  - Single Source│
│    of Truth     │
└────────┬────────┘
         │
    ┌────┴────┐
    │         │
    ▼         ▼
┌────────┐ ┌──────────┐
│Discord │ │ Web Map │
│  Bot   │ │  API    │
│        │ │ (REST)  │
└────────┘ └──────────┘
```

**Implementation**:
- **Database**: SQLite (recommended) or PostgreSQL
- **Discord Bot**: Direct database access (Python)
- **Web Map**: REST API endpoint that queries database
  - Endpoint: `GET /api/v1/belgian-nodes`
  - Returns: JSON array of all Belgian nodes
  - Framework: Flask or FastAPI (lightweight)

**Pros**:
- ✅ **Single Source of Truth**: No data sync issues
- ✅ **Concurrent Access**: Database handles multiple readers/writers
- ✅ **Query Performance**: Indexed queries, fast searches
- ✅ **Transaction Safety**: ACID guarantees
- ✅ **Real-time Updates**: Map sees Discord changes immediately
- ✅ **Data Consistency**: No sync lag or conflicts
- ✅ **Scalable**: Can handle growth

**Cons**:
- ⚠️ **API Layer Required**: Need to implement REST API for web map
- ⚠️ **Slightly More Complex**: Database + API setup

**Best For**: Production deployment, real-time updates, concurrent access

---

### Option 2: Database + JSON Export (Alternative)

**Architecture**:
```
┌─────────────────┐
│  Sync Service   │
│  (Python)       │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│   Database      │
│  (SQLite/PostgreSQL) │
│  - Source of    │
│    Truth        │
└────────┬────────┘
         │
    ┌────┴────┐
    │         │
    ▼         ▼
┌────────┐ ┌──────────┐
│Discord │ │ JSON    │
│  Bot   │ │ Export  │
│        │ │ Service │
└────────┘ └────┬─────┘
                │
                ▼
         ┌──────────┐
         │ Web Map  │
         │ (Static) │
         └──────────┘
```

**Implementation**:
- **Database**: SQLite (recommended) or PostgreSQL
- **Discord Bot**: Direct database access
- **JSON Export Service**: Periodic export (e.g., every 5-10 minutes)
  - Exports all nodes to `data/belgian_nodes.json`
  - Runs as background task or cron job
- **Web Map**: Reads static JSON file (current implementation)

**Pros**:
- ✅ **Fast Map Loading**: Static JSON is very fast
- ✅ **Simple Map Code**: No API changes needed initially
- ✅ **Database Benefits**: Bot gets all DB advantages
- ✅ **Separation**: Map doesn't need database connection

**Cons**:
- ⚠️ **Update Lag**: Map sees changes after export (5-10 min delay)
- ⚠️ **Export Service**: Need to implement export mechanism
- ⚠️ **Two Data Sources**: Slight complexity in maintaining consistency

**Best For**: High-performance map display, when real-time updates aren't critical

---

### Option 3: Separate Storage (Not Recommended) ❌

**Architecture**:
- Database for Discord bot
- JSON for web map
- Manual sync between them

**Why Not Recommended**:
- ❌ **Data Sync Complexity**: Need to keep two sources in sync
- ❌ **Consistency Issues**: Risk of data divergence
- ❌ **Maintenance Overhead**: More code to maintain
- ❌ **No Real Benefits**: Doesn't solve any problems better than other options

---

## Recommendation: Option 1 (Unified Database) ⭐

### Why This Is Best

1. **Real-time Updates**: Web map sees Discord changes immediately
2. **Data Consistency**: Single source of truth eliminates sync issues
3. **Query Performance**: Database indexes make searches fast
4. **Concurrent Access**: Database handles multiple readers/writers safely
5. **Future-Proof**: Easy to add features (caching, real-time updates, etc.)
6. **Simpler Architecture**: One data store, one API endpoint

### Implementation Plan

#### Phase 1: Database Setup
1. Choose database: **SQLite** (recommended for start) or PostgreSQL
2. Create schema (already defined in PROJECT_SUMMARY.md)
3. Implement database utilities (`database.py`)

#### Phase 2: Sync Service
1. Update sync service to write to database
2. Implement change tracking in database

#### Phase 3: Discord Bot
1. Connect bot to database
2. Implement all query/update functions

#### Phase 4: Web Map API
1. Create REST API endpoint (Flask/FastAPI)
   ```python
   @app.route('/api/v1/belgian-nodes')
   def get_belgian_nodes():
       nodes = query_all_belgian_nodes()
       return jsonify(nodes)
   ```
2. Update web map to use new endpoint
   ```javascript
   const apiUrl = "/api/v1/belgian-nodes";  // Local endpoint
   ```

#### Phase 5: Deployment
1. Serve API alongside web map (same server)
2. Or use separate API server if needed

---

## Database Choice: SQLite vs PostgreSQL

### SQLite (Recommended for Start) ⭐

**Pros**:
- ✅ **Zero Configuration**: No server setup needed
- ✅ **Lightweight**: Single file database
- ✅ **Perfect for Single Server**: Ideal for your use case
- ✅ **ACID Compliant**: Transaction safety
- ✅ **Good Performance**: Fast for read-heavy workloads
- ✅ **Easy Backup**: Just copy the file

**Cons**:
- ⚠️ **Write Concurrency**: Limited concurrent writes (but fine for your use case)
- ⚠️ **No Network Access**: Must be on same server

**Best For**: Single server deployment, small to medium scale

### PostgreSQL (For Future Growth)

**Pros**:
- ✅ **Excellent Concurrency**: Handles many concurrent connections
- ✅ **Network Access**: Can be on separate server
- ✅ **Advanced Features**: Full SQL, JSONB, etc.
- ✅ **Scalable**: Can handle large datasets

**Cons**:
- ⚠️ **Requires Server**: Separate database server needed
- ⚠️ **More Complex**: Setup and maintenance overhead

**Best For**: Multiple servers, high traffic, future growth

---

## Recommended Implementation: SQLite + REST API

### Architecture
```
┌─────────────────┐
│  Sync Service   │
│  (Python)       │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│  SQLite DB      │
│  belgian_nodes.db│
└────────┬────────┘
         │
    ┌────┴────┐
    │         │
    ▼         ▼
┌────────┐ ┌──────────┐
│Discord │ │ Flask/   │
│  Bot   │ │ FastAPI  │
│        │ │  API     │
└────────┘ └────┬─────┘
                │
                ▼
         ┌──────────┐
         │ Web Map  │
         │ (fetch)  │
         └──────────┘
```

### File Structure
```
RRY-Map-Bot/
├── data/
│   └── belgian_nodes.db  # SQLite database
├── backend/
│   ├── database.py       # DB utilities
│   ├── sync_belgian_nodes.py
│   ├── discord_bot.py
│   └── api/
│       └── app.py        # Flask/FastAPI REST API
└── frontend/
    └── src/
        └── map.js        # Updated to use /api/v1/belgian-nodes
```

### API Endpoint Example
```python
# backend/api/app.py
from flask import Flask, jsonify
from database import get_all_belgian_nodes

app = Flask(__name__)

@app.route('/api/v1/belgian-nodes')
def get_belgian_nodes():
    """Return all Belgian nodes as JSON"""
    nodes = get_all_belgian_nodes()
    return jsonify(nodes)

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=8000)
```

### Web Map Update
```javascript
// src/map.js
// Change from:
const apiUrl = "https://map.meshcore.io/api/v1/nodes";

// To:
const apiUrl = "/api/v1/belgian-nodes";  // Local API endpoint
```

---

## Performance Considerations

### Database Indexes (Critical)
```sql
CREATE INDEX idx_public_key ON belgian_nodes(public_key);
CREATE INDEX idx_city ON belgian_nodes(city);
CREATE INDEX idx_discord_owner_id ON belgian_nodes(discord_owner_id);
CREATE INDEX idx_type ON belgian_nodes(type);
CREATE INDEX idx_adv_name_lower ON belgian_nodes(LOWER(adv_name));
CREATE INDEX idx_public_key_lower ON belgian_nodes(LOWER(public_key));
```

### API Caching (Optional)
- Add HTTP caching headers for web map
- Cache-Control: max-age=60 (1 minute cache)
- Or implement Redis cache for frequently accessed data

### Query Optimization
- Use prepared statements
- Limit result sets (already implemented: 25 results)
- Use pagination for large result sets

---

## Migration Path

### Step 1: Keep JSON, Add Database
- Sync service writes to both JSON and database
- Discord bot uses database
- Web map still uses JSON
- **Status**: Both work, no breaking changes

### Step 2: Add API Endpoint
- Implement REST API
- Test API endpoint
- **Status**: API ready, map still uses JSON

### Step 3: Switch Map to API
- Update `map.js` to use API endpoint
- Test thoroughly
- **Status**: Map uses API, JSON can be deprecated

### Step 4: Remove JSON (Optional)
- Once API is stable, remove JSON export
- **Status**: Database-only, cleaner architecture

---

## Decision Matrix

| Criteria | JSON Only | DB + JSON Export | Unified DB |
|----------|-----------|------------------|------------|
| **Simplicity** | ⭐⭐⭐⭐⭐ | ⭐⭐⭐ | ⭐⭐⭐⭐ |
| **Query Performance** | ⭐⭐ | ⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ |
| **Update Performance** | ⭐⭐ | ⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ |
| **Concurrent Access** | ⭐ | ⭐⭐⭐ | ⭐⭐⭐⭐⭐ |
| **Real-time Updates** | ⭐ | ⭐⭐ | ⭐⭐⭐⭐⭐ |
| **Data Consistency** | ⭐⭐ | ⭐⭐⭐ | ⭐⭐⭐⭐⭐ |
| **Setup Complexity** | ⭐⭐⭐⭐⭐ | ⭐⭐⭐ | ⭐⭐⭐⭐ |
| **Maintenance** | ⭐⭐⭐ | ⭐⭐ | ⭐⭐⭐⭐ |

**Winner**: Unified Database (Option 1)

---

## Final Recommendation ✅ DECISION MADE

### ✅ **Chosen: Unified Database (SQLite) + REST API**

**Decision Status**: This architecture has been **selected and approved** for implementation.

**Why This Was Chosen**:
1. **Single Source of Truth**: Eliminates data sync issues
2. **Real-time Updates**: Map sees Discord changes immediately
3. **Query Performance**: Database indexes make searches fast
4. **Concurrent Access**: Safe for multiple users
5. **Future-Proof**: Easy to scale or migrate to PostgreSQL later
6. **Clean Architecture**: One data store, clear separation of concerns

**Implementation Plan**:
- **Database**: SQLite (`data/belgian_nodes.db`)
- **API**: Flask or FastAPI (lightweight, easy to deploy)
- **Endpoint**: `GET /api/v1/belgian-nodes`
- **Deployment**: API and web map on same server (or separate if needed)

**Migration Path**:
1. ✅ Architecture decision made
2. Set up SQLite database and schema
3. Update sync service to write to database
4. Connect Discord bot to database
5. Implement REST API endpoint
6. Update web map to use API endpoint
7. Remove any JSON file dependencies

---

*Analysis Date: 2025-12-31*
*Decision Date: 2025-12-31*
*Status: ✅ APPROVED FOR IMPLEMENTATION*
*Based on: PROJECT_SUMMARY.md, PROJECT_REVIEW.md, current web map implementation*

