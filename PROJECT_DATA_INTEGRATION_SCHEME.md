# PROJECT_DATA_INTEGRATION_SCHEME.md

## Document Purpose

This document defines the **data integration workflow** for the RRY-Map-Bot project. It specifies:
- When and how tracked changes from the sync service are integrated into the main database
- Node lifecycle management (what happens when nodes are added/removed/updated from the official map)
- Conflict resolution strategies between official map data and Discord user modifications
- Data merge processes and field-level update rules

**Related Documents**:
- `PROJECT_SUMMARY.md` - Main project specification
- `DATA_ARCHITECTURE_ANALYSIS.md` - Database architecture decisions
- This document is referenced in `PROJECT_SUMMARY.md` lines 152, 1289, 1402-1406

---

## Status

**Current Status**: ✅ **DEFINED**

This document defines the complete integration workflow for merging official map data into the Belgian database.

---

## Integration Strategy: Automatic Integration

### Decision: Immediate Automatic Integration

**Chosen Approach**: **Automatic integration** - Changes from the official map are integrated immediately during the sync process.

**Rationale**:
- Sync service runs only a few times per day (resource-intensive)
- Belgian nodes are already verified (geographic bounds + Geopy)
- No manual approval needed for verified Belgian nodes
- Immediate integration ensures data freshness

**Workflow**:
```
1. Sync Service runs (cron/scheduler)
   ↓
2. Downloads, filters, and verifies Belgian nodes
   ↓
3. Compares with current database state
   ↓
4. Identifies changes (added/removed/updated)
   ↓
5. Applies changes immediately to database
   ↓
6. Logs all changes to sync_history and node_changes tables
```

---

## Node Lifecycle Management

### 1. Added Nodes (New Nodes from Official Map)

**When**: A node appears in the official map that wasn't in our database before.

**Action**: **INSERT immediately** into `belgian_nodes` table.

**Process**:
```python
def integrate_added_node(node_data):
    """
    Add new node from official map to database.
    Node has already been verified as Belgian (geographic bounds + Geopy).
    """
    # Insert new node with all official map data
    INSERT INTO belgian_nodes (
        public_key, type, adv_name, adv_lat, adv_lon,
        city, last_advert, inserted_date, updated_date,
        params, link, source, inserted_by, updated_by,
        synced_from_official, last_sync_date
    ) VALUES (
        node_data['public_key'],
        node_data['type'],
        node_data['adv_name'],
        node_data['adv_lat'],
        node_data['adv_lon'],
        node_data['city'],  # Extracted via Geopy
        node_data['last_advert'],
        node_data['inserted_date'],
        node_data['updated_date'],
        node_data['params'],  # JSON: {freq, sf, bw, cr}
        node_data['link'],
        node_data['source'],
        node_data['inserted_by'],
        node_data['updated_by'],
        TRUE,  # synced_from_official
        CURRENT_TIMESTAMP  # last_sync_date
    )
    
    # Log change
    INSERT INTO node_changes (
        public_key, change_type, sync_date, new_data
    ) VALUES (
        node_data['public_key'],
        'added',
        CURRENT_TIMESTAMP,
        json(node_data)
    )
```

**Fields Set**:
- All official map fields: `public_key`, `type`, `adv_name`, `adv_lat`, `adv_lon`, `last_advert`, `inserted_date`, `updated_date`, `params`, `link`, `source`, `inserted_by`, `updated_by`
- Our system fields: `city` (from Geopy), `synced_from_official=TRUE`, `last_sync_date`
- Discord fields: `discord_owner_id=NULL`, `discord_owner_name=NULL`, `discord_updated_date=NULL` (not set yet)

**Result**: Node is immediately available in database, visible on web map and Discord bot.

---

### 2. Removed Nodes (Deleted from Official Map)

**When**: A node exists in our database but no longer appears in the official map.

**Action**: **Mark as inactive/archived** - DO NOT DELETE immediately.

**Process**:
```python
def integrate_removed_node(public_key):
    """
    Handle node removal from official map.
    Mark as inactive but preserve data for history and Discord ownership.
    """
    # Update node status (add 'is_active' field or use existing mechanism)
    UPDATE belgian_nodes
    SET is_active = FALSE,
        removed_from_official = TRUE,
        removed_date = CURRENT_TIMESTAMP,
        last_sync_date = CURRENT_TIMESTAMP
    WHERE public_key = public_key
    
    # Log change
    INSERT INTO node_changes (
        public_key, change_type, sync_date, old_data
    ) VALUES (
        public_key,
        'removed',
        CURRENT_TIMESTAMP,
        (SELECT json(*) FROM belgian_nodes WHERE public_key = public_key)
    )
```

**Database Schema Addition**:
```sql
-- Add fields to belgian_nodes table for removal tracking
ALTER TABLE belgian_nodes ADD COLUMN is_active BOOLEAN DEFAULT TRUE;
ALTER TABLE belgian_nodes ADD COLUMN removed_from_official BOOLEAN DEFAULT FALSE;
ALTER TABLE belgian_nodes ADD COLUMN removed_date TIMESTAMP;
```

**Rationale for Not Deleting**:
- **Preserve Discord Ownership**: Users may have claimed nodes - preserve their ownership data
- **Historical Tracking**: Keep data for statistics and analysis
- **Recovery**: Node might reappear in official map (restore instead of re-adding)
- **Audit Trail**: Maintain complete history of node lifecycle

**Visibility**:
- **Web Map**: Inactive nodes are **NOT displayed** (filter: `WHERE is_active = TRUE`)
- **Discord Bot**: Inactive nodes are **NOT searchable** (filter: `WHERE is_active = TRUE`)
- **Discord Ownership**: Users can still see their claimed inactive nodes via `/manage list` (for transparency)

**Restoration** (Node Reappears in Official Map):
- If a removed node (`is_active = FALSE`) reappears in official map, **restore it completely**:
  ```python
  def restore_removed_node(official_node):
      """
      Restore a previously removed node when it reappears in official map.
      Update ALL information from official map and reactivate node.
      """
      # Update ALL fields from official map (complete refresh)
      UPDATE belgian_nodes
      SET is_active = TRUE,
          removed_from_official = FALSE,
          removed_date = NULL,
          type = official_node['type'],
          adv_name = official_node['adv_name'],
          adv_lat = official_node['adv_lat'],
          adv_lon = official_node['adv_lon'],
          city = official_node['city'],  # Re-extracted via Geopy
          last_advert = official_node['last_advert'],
          updated_date = official_node['updated_date'],
          params = official_node['params'],
          link = official_node['link'],
          source = official_node['source'],
          inserted_by = official_node['inserted_by'],
          updated_by = official_node['updated_by'],
          last_sync_date = CURRENT_TIMESTAMP
      WHERE public_key = official_node['public_key']
      
      # Note: Discord ownership fields (discord_owner_id, discord_owner_name, discord_updated_date)
      # are preserved - they are NOT overwritten by official map data
      
      # Log restoration
      INSERT INTO node_changes (
          public_key, change_type, sync_date, new_data
      ) VALUES (
          official_node['public_key'],
          'restored',
          CURRENT_TIMESTAMP,
          json(official_node)
      )
  ```
- **All official map data is refreshed** - node is completely updated with latest information
- **Discord ownership is preserved** - `discord_owner_id`, `discord_owner_name`, `discord_updated_date` are NOT overwritten
- Node becomes immediately visible again on web map and Discord bot

**Cleanup Policy** (Optional - Future Enhancement):
- After X days (e.g., 90 days), consider archiving to separate table
- Or keep indefinitely for historical tracking

---

### 3. Updated Nodes (Data Changed on Official Map)

**When**: A node exists in both our database and official map, but data has changed.

**Action**: **Merge strategy** - Update official map fields, preserve Discord user edits where appropriate.

**Conflict Detection**:
```python
def detect_node_updates(current_db_node, official_map_node):
    """
    Compare database node with official map node to detect changes.
    Returns dict of changed fields.
    """
    changes = {}
    
    # Check immutable fields (always update from official map)
    immutable_fields = ['type', 'adv_lat', 'adv_lon', 'public_key']
    for field in immutable_fields:
        if current_db_node[field] != official_map_node[field]:
            changes[field] = {
                'old': current_db_node[field],
                'new': official_map_node[field],
                'source': 'official_map'
            }
    
    # Check editable fields (merge strategy)
    editable_fields = ['adv_name', 'params']
    for field in editable_fields:
        if current_db_node[field] != official_map_node[field]:
            changes[field] = {
                'old': current_db_node[field],
                'new': official_map_node[field],
                'source': 'official_map',
                'conflict': detect_conflict(current_db_node, official_map_node, field)
            }
    
    # Check date fields
    if current_db_node['updated_date'] != official_map_node['updated_date']:
        changes['updated_date'] = {
            'old': current_db_node['updated_date'],
            'new': official_map_node['updated_date'],
            'source': 'official_map'
        }
    
    return changes
```

**Merge Strategy**:

#### A. Immutable Fields (Always Update from Official Map)
These fields **always** get updated from the official map, regardless of Discord edits:
- `public_key` - Never changes, but verify it matches
- `type` - Node type (1-4)
- `adv_lat`, `adv_lon` - Coordinates
- `inserted_date` - Original insertion date
- `link` - meshcore:// link
- `inserted_by`, `updated_by` - Official map companion device hex keys
- `updated_date` - Official map's last update timestamp

**Process**:
```python
# Always update immutable fields from official map
UPDATE belgian_nodes
SET type = ?,
    adv_lat = ?,
    adv_lon = ?,
    link = ?,
    inserted_by = ?,
    updated_by = ?,
    updated_date = ?,
    last_sync_date = CURRENT_TIMESTAMP
WHERE public_key = ?
```

#### B. Editable Fields (Conflict Resolution)

**Note**: Conflict resolution strategies will be **elaborated and refined later** based on real-world usage patterns and user feedback. The following rules are the initial implementation.

**Editable Fields** (can be modified by Discord users):
- `adv_name` - Node name
- `city` - City name
- `params` - Frequency parameters (freq, sf, bw, cr)

**Conflict Resolution Rules** (Initial Implementation - To Be Refined):

1. **If Discord user has NOT edited the field** (`discord_updated_date` is NULL or older than official `updated_date`):
   - **Action**: Update from official map
   - **Rationale**: Official map is source of truth, no user edits to preserve

2. **If Discord user HAS edited the field** (`discord_updated_date` is newer than official `updated_date`):
   - **Action**: **Preserve Discord user edit** (do NOT overwrite)
   - **Rationale**: User's recent edit takes precedence
   - **Exception**: If official map `updated_date` is significantly newer (e.g., > 7 days), consider updating (future enhancement)

3. **If both updated recently** (within same day):
   - **Action**: **Preserve Discord user edit** (user intent is more recent)
   - **Rationale**: User edits are intentional, official map updates might be automatic

**Process**:
```python
def merge_node_update(db_node, official_node):
    """
    Merge official map update with existing database node.
    Preserves Discord user edits where appropriate.
    """
    updates = {}
    
    # Always update immutable fields
    updates['type'] = official_node['type']
    updates['adv_lat'] = official_node['adv_lat']
    updates['adv_lon'] = official_node['adv_lon']
    updates['link'] = official_node['link']
    updates['inserted_by'] = official_node['inserted_by']
    updates['updated_by'] = official_node['updated_by']
    updates['updated_date'] = official_node['updated_date']
    updates['last_sync_date'] = CURRENT_TIMESTAMP
    
    # Merge editable fields based on conflict resolution
    # Node name
    if should_preserve_discord_edit(db_node, 'adv_name', official_node):
        # Keep Discord edit
        pass  # Don't update adv_name
    else:
        # Update from official map
        updates['adv_name'] = official_node['adv_name']
    
    # City (our system field, but can be edited by Discord users)
    if should_preserve_discord_edit(db_node, 'city', official_node):
        # Keep Discord edit
        pass  # Don't update city
    else:
        # Update from official map (if city changed, re-verify with Geopy)
        updates['city'] = official_node['city']  # Already verified in sync
    
    # Frequency parameters
    if should_preserve_discord_edit(db_node, 'params', official_node):
        # Keep Discord edit
        pass  # Don't update params
    else:
        # Update from official map
        updates['params'] = official_node['params']
    
    # Apply updates
    UPDATE belgian_nodes SET ... WHERE public_key = ?
    
    # Log change
    log_node_change(public_key, 'updated', old_data, new_data)

def should_preserve_discord_edit(db_node, field, official_node):
    """
    Determine if Discord user edit should be preserved.
    Returns True if Discord edit is more recent than official map update.
    """
    # If field hasn't changed, no conflict
    if db_node[field] == official_node[field]:
        return False
    
    # If Discord user hasn't edited this field, update from official
    if not db_node.get('discord_updated_date'):
        return False
    
    # Compare timestamps
    discord_updated = db_node['discord_updated_date']
    official_updated = official_node['updated_date']
    
    # If Discord edit is more recent, preserve it
    if discord_updated > official_updated:
        return True
    
    # If official update is more recent, update from official
    return False
```

**Special Cases**:

1. **City Field**:
   - City is extracted via Geopy during sync
   - If coordinates changed, city is re-extracted
   - If Discord user edited city, preserve their edit unless coordinates changed significantly

2. **Frequency Parameters**:
   - If Discord user set a preset, preserve it
   - If official map updated params, only update if Discord user hasn't edited recently

---

## Conflict Resolution Summary

### Priority Rules

1. **Official Map Always Wins** (Immutable Fields):
   - `public_key`, `type`, `adv_lat`, `adv_lon`, `link`, `inserted_by`, `updated_by`, `updated_date`, `inserted_date`

2. **Discord User Edits Win** (If More Recent):
   - `adv_name`, `city`, `params` (frequency parameters)
   - Only if `discord_updated_date` > `updated_date` (from official map)

3. **Official Map Wins** (If Discord User Hasn't Edited):
   - `adv_name`, `city`, `params`
   - If `discord_updated_date` is NULL or older than official `updated_date`

### Date Field Logic

```
IF discord_updated_date IS NULL:
    → Update from official map (no user edits to preserve)
    
ELSE IF discord_updated_date > updated_date (official):
    → Preserve Discord user edit (user edit is more recent)
    
ELSE IF updated_date (official) > discord_updated_date:
    → Update from official map (official update is more recent)
```

---

## Integration Workflow (Detailed)

### Complete Sync Process

```python
def sync_belgian_nodes():
    """
    Complete sync workflow with integration.
    """
    # 1. Download and filter
    all_nodes = download_official_nodes()
    belgian_nodes = filter_and_verify_belgian(all_nodes)
    
    # 2. Get current database state
    # Get ALL nodes from DB (including inactive) for comparison
    all_db_nodes = get_all_nodes_from_db()  # Includes inactive nodes
    active_db_nodes = [n for n in all_db_nodes if n['is_active'] == TRUE]
    active_db_node_map = {n['public_key']: n for n in active_db_nodes}
    all_db_node_map = {n['public_key']: n for n in all_db_nodes}  # Includes inactive
    
    # 3. Identify changes
    official_keys = {n['public_key'] for n in belgian_nodes}
    active_db_keys = {n['public_key'] for n in active_db_nodes}
    all_db_keys = {n['public_key'] for n in all_db_nodes}
    
    # Added: in official map but not in active DB nodes
    added_keys = official_keys - active_db_keys
    
    # Removed: in active DB but not in official map
    removed_keys = active_db_keys - official_keys
    
    # Restored: in official map but inactive in DB (was removed, now back)
    restored_keys = official_keys & {k for k, n in all_db_node_map.items() if n['is_active'] == FALSE}
    
    # Updated: in both official map and active DB
    updated_keys = (official_keys & active_db_keys) - restored_keys  # Exclude restored (handled separately)
    
    # 4. Process added nodes (new nodes)
    for node in belgian_nodes:
        if node['public_key'] in added_keys:
            integrate_added_node(node)
    
    # 5. Process restored nodes (inactive nodes that reappeared)
    for node in belgian_nodes:
        if node['public_key'] in restored_keys:
            restore_removed_node(node)  # Update ALL info and reactivate
    
    # 6. Process removed nodes (active nodes that disappeared)
    for public_key in removed_keys:
        integrate_removed_node(public_key)
    
    # 7. Process updated nodes (active nodes with data changes)
    for node in belgian_nodes:
        if node['public_key'] in updated_keys:
            db_node = active_db_node_map[node['public_key']]
            if has_changes(db_node, node):
                merge_node_update(db_node, node)
    
    # 8. Log sync summary
    log_sync_summary(
        added=len(added_keys),
        removed=len(removed_keys),
        restored=len(restored_keys),
        updated=count_updated_nodes(updated_keys)
    )
```

---

## Data Preservation & History

### Change Tracking

All changes are logged in `node_changes` table:
- **Added nodes**: `change_type='added'`, `new_data` contains full node data
- **Removed nodes**: `change_type='removed'`, `old_data` contains full node data before removal
- **Updated nodes**: `change_type='updated'`, both `old_data` and `new_data` contain node data
- **Restored nodes**: `change_type='restored'`, `new_data` contains full node data after restoration

### Sync History

Each sync operation is logged in `sync_history` table:
- `sync_date`: When sync ran
- `nodes_added`: Count of added nodes
- `nodes_removed`: Count of removed nodes
- `nodes_restored`: Count of restored nodes (inactive nodes that reappeared)
- `nodes_updated`: Count of updated nodes
- `details`: JSON with lists of public_keys for each change type

### Historical Data Retention

**Current Policy**: Keep all historical data indefinitely
- Inactive nodes remain in database (marked with `is_active=FALSE`)
- All changes logged in `node_changes` table
- Sync history preserved in `sync_history` table

**Future Considerations**:
- Archive inactive nodes older than X days to separate table
- Compress old change logs
- Implement data retention policies if database grows too large

---

## Field-Level Update Rules

### Summary Table

| Field | Source | Update Rule | Conflict Resolution |
|-------|--------|-------------|---------------------|
| `public_key` | Official Map | Always | N/A (immutable, never changes) |
| `type` | Official Map | Always | Official map always wins |
| `adv_lat`, `adv_lon` | Official Map | Always | Official map always wins |
| `adv_name` | Both | Conditional | Discord wins if `discord_updated_date` > `updated_date` |
| `city` | Both | Conditional | Discord wins if `discord_updated_date` > `updated_date` |
| `params` (freq, sf, bw, cr) | Both | Conditional | Discord wins if `discord_updated_date` > `updated_date` |
| `last_advert` | Official Map | Always | Official map always wins |
| `inserted_date` | Official Map | Always | Official map always wins |
| `updated_date` | Official Map | Always | Official map always wins |
| `link` | Official Map | Always | Official map always wins |
| `source` | Official Map | Always | Official map always wins |
| `inserted_by` | Official Map | Always | Official map always wins |
| `updated_by` | Official Map | Always | Official map always wins |
| `discord_owner_id` | Discord Bot | Never | Never updated by sync (Discord-only field) |
| `discord_owner_name` | Discord Bot | Never | Never updated by sync (Discord-only field) |
| `discord_updated_date` | Discord Bot | Never | Never updated by sync (Discord-only field) |
| `synced_from_official` | Sync Service | Always | Always TRUE for synced nodes |
| `last_sync_date` | Sync Service | Always | Updated on every sync |
| `is_active` | Sync Service | Conditional | Set to FALSE when removed, TRUE when restored |
| `removed_from_official` | Sync Service | Conditional | Set to TRUE when removed |
| `removed_date` | Sync Service | Conditional | Set when node is removed |

---

## Implementation Notes

### Database Schema Updates

Add fields for removal tracking:
```sql
ALTER TABLE belgian_nodes ADD COLUMN is_active BOOLEAN DEFAULT TRUE;
ALTER TABLE belgian_nodes ADD COLUMN removed_from_official BOOLEAN DEFAULT FALSE;
ALTER TABLE belgian_nodes ADD COLUMN removed_date TIMESTAMP;
```

### Query Filters

**Web Map Queries**:
- Always filter: `WHERE is_active = TRUE`
- This ensures inactive/removed nodes are not displayed on the map

**Discord Bot Queries - ALL Commands**:
- **ALL Discord bot commands MUST filter inactive nodes**: `WHERE is_active = TRUE`
- This applies to:
  - `/search` - Only search active nodes
  - `/claim` - Only claim active nodes
  - `/manage update` - Only update active nodes
  - `/manage unclaim` - Only unclaim active nodes
  - `/stats` - Only count active nodes
- **Exception**: `/manage list` - Shows both active AND inactive nodes for user's claimed nodes
  - Allows users to see their claimed nodes even if removed from official map
  - Format: Clearly indicate which nodes are inactive (e.g., "⚠️ [INACTIVE] Node Name")

### Performance Considerations

1. **Indexes**: Ensure indexes on:
   - `public_key` (PRIMARY KEY)
   - `is_active` (for filtering)
   - `discord_owner_id` (for user queries)
   - `city` (for filtering)

2. **Batch Updates**: Process updates in batches for performance

3. **Transaction Safety**: Wrap integration in transactions for atomicity

---

## Error Handling

### Geopy Failures

If Geopy verification fails during sync:
- **Skip node**: Don't add to database
- **Log error**: Record in sync log
- **Retry later**: Node will be checked again on next sync

### Database Errors

If database update fails:
- **Rollback transaction**: Don't partially update
- **Log error**: Record in sync log
- **Continue with other nodes**: Don't stop entire sync

### Data Validation

Before integrating:
- Validate all required fields present
- Validate data types
- Validate geographic bounds
- Validate country code (BE)

---

## Testing & Validation

### Test Scenarios

1. **New Node Added**: Verify node appears in database immediately
2. **Node Removed**: Verify node marked inactive, not deleted
3. **Node Restored**: Verify inactive node becomes active when reappearing in official map
   - Verify ALL information updated from official map
   - Verify Discord ownership preserved
   - Verify node visible again on web map and Discord bot
4. **Node Updated (No Discord edits)**: Verify all fields updated from official map
5. **Node Updated (With Discord edits)**: Verify Discord edits preserved when more recent
6. **Discord Bot Filtering**: Verify inactive nodes NOT shown in:
   - `/search` results
   - `/claim` results
   - `/manage update` results
   - `/manage unclaim` results
   - `/stats` counts
7. **Discord Bot Exception**: Verify `/manage list` shows both active and inactive nodes (with clear indication)
8. **Conflict Resolution**: Test all conflict scenarios (to be refined later)

---

## Future Enhancements

### Potential Improvements

1. **Manual Approval Workflow**: Option to require approval for new nodes (if needed)
2. **Notification System**: Notify Discord users when their claimed nodes are updated/removed
3. **Change Summaries**: Provide summaries of what changed in each sync
4. **Selective Updates**: Allow users to choose which fields to update from official map
5. **Archive System**: Move old inactive nodes to archive table
6. **Conflict Dashboard**: Web interface to review and resolve conflicts

---

*Document Created: 2025-12-31*
*Status: ✅ DEFINED - Ready for Implementation*
*Related: PROJECT_SUMMARY.md, DATA_ARCHITECTURE_ANALYSIS.md*
