# Sync Logic Review - Official Map to Belgian Map

## Overview

This document reviews the sync logic that integrates data from the official MeshCore map (`https://map.meshcore.dev/api/v1/nodes`) into the Belgian database. It covers all possible scenarios and verifies they are properly handled.

**Last Reviewed**: 2026-01-02

---

## Sync Process Flow

1. **Download** all nodes from official API
2. **Filter** by Belgian geographic bounds (lat/lon)
3. **Verify** with Geopy (country code = BE, extract city name)
4. **Compare** with current database state
5. **Identify** changes: added, removed, restored, updated
6. **Integrate** changes using appropriate functions
7. **Log** all changes to `sync_history` and `node_changes` tables

---

## Scenario 1: New Node Added (Not in Database)

**When**: Node exists in official map but not in our database.

**Action**: `integrate_added_node()`

**What Gets Set**:
- ✅ All official map fields: `public_key`, `type`, `adv_name`, `adv_lat`, `adv_lon`, `last_advert`, `inserted_date`, `updated_date`, `params`, `link`, `source`, `inserted_by`, `updated_by`
- ✅ Our system fields: `city` (from Geopy), `synced_from_official=TRUE`, `last_sync_date`, `is_active=TRUE`
- ✅ Discord fields: `discord_owner_id=NULL`, `discord_owner_name=NULL`, `discord_updated_date=NULL` (not set yet)

**Result**: Node immediately visible on web map and Discord bot.

**Covered**: ✅ Yes - Function exists and handles all fields correctly.

---

## Scenario 2: Node Removed from Official Map

**When**: Node exists in our database (active) but no longer in official map.

**Action**: `integrate_removed_node()`

**What Gets Updated**:
- ✅ `is_active = FALSE` (node hidden from web map and Discord bot)
- ✅ `removed_from_official = TRUE`
- ✅ `removed_date = CURRENT_TIMESTAMP`
- ✅ `last_sync_date = CURRENT_TIMESTAMP`
- ✅ **Preserved**: All other fields including Discord ownership (`discord_owner_id`, `discord_owner_name`, `discord_updated_date`)

**Visibility**:
- ❌ **Web Map**: Not displayed (filtered by `is_active = TRUE`)
- ❌ **Discord Bot**: Not searchable (filtered by `is_active = TRUE`)
- ✅ **Discord `/manage list`**: Still visible to owner (shows both active and inactive)

**Result**: Node preserved for history, ownership maintained, but hidden from public view.

**Covered**: ✅ Yes - Node is marked inactive, not deleted, all data preserved.

---

## Scenario 3: Node Restored (Reappears in Official Map)

**When**: Node was previously removed (`is_active = FALSE`) but now reappears in official map.

**Action**: `restore_removed_node()`

**What Gets Updated**:
- ✅ `is_active = TRUE` (node becomes visible again)
- ✅ `removed_from_official = FALSE`
- ✅ `removed_date = NULL`
- ✅ **ALL official map fields updated**: `type`, `adv_name`, `adv_lat`, `adv_lon`, `city`, `last_advert`, `updated_date`, `params`, `link`, `inserted_by`, `updated_by`, `inserted_date`
- ✅ `last_sync_date = CURRENT_TIMESTAMP`
- ✅ **Preserved**: `discord_owner_id`, `discord_owner_name`, `discord_updated_date` (Discord ownership maintained)
- ✅ **Source preservation**: If `source='discord'`, it's preserved (node was registered via Discord, now appears in official map)

**Result**: Node fully refreshed with latest official data, ownership preserved, immediately visible again.

**Covered**: ✅ Yes - Complete refresh of all official fields while preserving Discord ownership and source.

---

## Scenario 3.5: Date Field Updates (updated_date or last_advert)

**When**: Node exists in both official map and database, and `updated_date` or `last_advert` has changed (even if no other fields changed).

**Action**: `merge_node_update()`

**Special Handling**:
- ✅ **Priority Check**: `updated_date` and `last_advert` are checked **first** before other fields
- ✅ **Always Considered Update**: If either `updated_date` or `last_advert` changes, the node is marked as updated in sync reports
- ✅ **Reported in Sync Notification**: These date field changes are included in the "Updated Nodes from Official Map" section

**What Gets Updated**:
- ✅ `updated_date` - Always updated from official map
- ✅ `last_advert` - Always updated from official map
- ✅ Other fields follow normal conflict resolution rules

**Result**: Node is reported as updated in sync notifications, even if only date fields changed.

**Covered**: ✅ Yes - Implemented in `merge_node_update()` with priority checking (2026-01-02).

---

## Scenario 4: Node Updated (Data Changed on Official Map)

**When**: Node exists in both database and official map, but data has changed.

**Action**: `merge_node_update()`

### 4A. Immutable Fields (Always Update from Official Map)

**Fields**: `type`, `adv_lat`, `adv_lon`, `link`, `last_advert`, `inserted_by`, `updated_by`, `updated_date`, `inserted_date`

**Rule**: ✅ **Always updated from official map** - no conflict resolution needed.

**Exception**: `source` field:
- ✅ If current `source='discord'`, preserve it (node was registered via Discord)
- ✅ Otherwise, update from official map

**Covered**: ✅ Yes - All immutable fields always updated, source preserved for Discord-registered nodes.

### 4B. Editable Fields (Conflict Resolution)

**Fields**: `adv_name`, `city`, `params` (frequency parameters)

**Rule**: Use `should_preserve_discord_edit()` to determine winner.

#### 4B.1. Discord User Has NOT Edited

**Condition**: `discord_updated_date` is NULL or doesn't exist.

**Action**: ✅ **Update from official map** - no user edits to preserve.

**Covered**: ✅ Yes - Function returns `False`, official map wins.

#### 4B.2. Discord User HAS Edited (More Recent)

**Condition**: `discord_updated_date` > `updated_date` (from official map).

**Action**: ✅ **Preserve Discord user edit** - user's recent edit takes precedence.

**Covered**: ✅ Yes - Function returns `True`, Discord edit preserved.

#### 4B.3. Official Map Updated (More Recent)

**Condition**: `updated_date` (official) > `discord_updated_date`.

**Action**: ✅ **Update from official map** - official update is more recent.

**Covered**: ✅ Yes - Function returns `False`, official map wins.

#### 4B.4. Date Parsing Error

**Condition**: Cannot parse timestamps (format mismatch, invalid date, etc.).

**Action**: ✅ **Preserve Discord edit** (safer default - don't lose user edits).

**Covered**: ✅ Yes - Exception handling returns `True` as safe default.

**Covered**: ✅ Yes - All conflict scenarios handled with proper timestamp comparison.

---

## Scenario 5: Discord-Registered Node Appears in Official Map

**When**: Node was registered via Discord (`source='discord'`) and later appears in official map.

**Special Handling**:

1. **First Appearance** (Node Added):
   - ✅ Node inserted with `source='discord'` preserved
   - ✅ Official map fields filled in: `inserted_by`, `updated_by`, `inserted_date`, `updated_date`, `last_advert`, `link`
   - ✅ Missing optional fields (coordinates, link) filled in from official map

2. **Subsequent Updates** (Node Updated):
   - ✅ `source='discord'` preserved (never overwritten)
   - ✅ All official map fields updated normally
   - ✅ Conflict resolution applies to editable fields (`adv_name`, `city`, `params`)

**Covered**: ✅ Yes - `merge_node_update()` preserves `source='discord'` in immutable fields section.

---

## Scenario 6: Node with Discord Ownership

**When**: Node is claimed by a Discord user (`discord_owner_id` is set).

**Handling Across All Scenarios**:

1. **Added Node**: ✅ Ownership fields remain NULL (user hasn't claimed yet)
2. **Removed Node**: ✅ Ownership preserved (user can still see via `/manage list`)
3. **Restored Node**: ✅ Ownership preserved (user retains ownership)
4. **Updated Node**: ✅ Ownership preserved (never updated by sync)

**Covered**: ✅ Yes - Discord ownership fields (`discord_owner_id`, `discord_owner_name`, `discord_updated_date`) are never modified by sync service.

---

## Scenario 7: Edge Cases

### 7.1. Node Already Exists (Duplicate Insert)

**When**: `integrate_added_node()` tries to insert a node that already exists.

**Action**: ✅ **Caught by `sqlite3.IntegrityError`** - logged as warning, exception raised.

**Covered**: ✅ Yes - Integrity constraint prevents duplicates, error logged.

### 7.2. Missing Fields in Official Map Data

**When**: Official map node has NULL or missing fields.

**Action**: ✅ **Uses `.get()` with defaults** - NULL values inserted, no crash.

**Covered**: ✅ Yes - All field accesses use `.get()` with safe defaults.

### 7.3. Geopy Verification Failure

**When**: Geopy fails to verify country or extract city.

**Action**: ✅ **Node skipped** - not added to database, logged in sync results.

**Covered**: ✅ Yes - `verify_nodes_with_geopy()` handles exceptions, returns only verified nodes.

### 7.4. Database Transaction Failure

**When**: Database error occurs during integration.

**Action**: ✅ **Transaction rollback** - all changes reverted, error logged, sync continues with other nodes.

**Covered**: ✅ Yes - `sync_belgian_nodes()` wraps in try/except with rollback.

---

## Field Update Summary

| Field | Scenario | Update Rule | Status |
|-------|----------|-------------|--------|
| `public_key` | All | Never changes (PRIMARY KEY) | ✅ |
| `type` | Updated/Restored | Always from official map | ✅ |
| `adv_lat`, `adv_lon` | Updated/Restored | Always from official map | ✅ |
| `adv_name` | Updated | Discord wins if `discord_updated_date` > `updated_date` | ✅ |
| `city` | Updated | Discord wins if `discord_updated_date` > `updated_date` | ✅ |
| `params` | Updated | Discord wins if `discord_updated_date` > `updated_date` | ✅ |
| `last_advert` | Updated/Restored | Always from official map | ✅ |
| `inserted_date` | Updated/Restored | Always from official map | ✅ |
| `updated_date` | Updated/Restored | Always from official map | ✅ |
| `link` | Updated/Restored | Always from official map | ✅ |
| `source` | Updated/Restored | Preserve if `='discord'`, else from official map | ✅ |
| `inserted_by` | Updated/Restored | Always from official map | ✅ |
| `updated_by` | Updated/Restored | Always from official map | ✅ |
| `discord_owner_id` | All | Never updated by sync | ✅ |
| `discord_owner_name` | All | Never updated by sync | ✅ |
| `discord_updated_date` | All | Never updated by sync | ✅ |
| `synced_from_official` | Added/Updated | Always TRUE | ✅ |
| `last_sync_date` | All | Always CURRENT_TIMESTAMP | ✅ |
| `is_active` | Removed/Restored | FALSE when removed, TRUE when restored | ✅ |
| `removed_from_official` | Removed/Restored | TRUE when removed, FALSE when restored | ✅ |
| `removed_date` | Removed/Restored | Set when removed, NULL when restored | ✅ |

---

## Verification Checklist

- ✅ **Added Nodes**: Properly inserted with all fields
- ✅ **Removed Nodes**: Marked inactive, not deleted, ownership preserved
- ✅ **Restored Nodes**: Fully refreshed, ownership preserved, source preserved
- ✅ **Updated Nodes**: Immutable fields always updated, editable fields use conflict resolution
- ✅ **Discord Ownership**: Never modified by sync
- ✅ **Discord Source**: Preserved for Discord-registered nodes
- ✅ **Conflict Resolution**: Timestamp comparison works correctly
- ✅ **Error Handling**: Transactions, rollbacks, exception handling
- ✅ **Logging**: All changes logged to `node_changes` and `sync_history`
- ✅ **Edge Cases**: Duplicates, missing fields, Geopy failures, DB errors

---

## Conclusion

**Status**: ✅ **All scenarios are properly covered**

The sync logic handles all possible scenarios:
1. New nodes are added correctly
2. Removed nodes are preserved (inactive, not deleted)
3. Restored nodes are fully refreshed while preserving ownership
4. Updated nodes use proper conflict resolution
5. Date field changes (`updated_date`, `last_advert`) are always detected and reported
6. Discord ownership and source are always preserved
7. Error handling prevents data corruption
8. All changes are logged for audit trail
9. Sync notifications properly filter deactivated unclaimed Discord nodes

### Recent Enhancements (2026-01-02)

- ✅ **Date Field Priority**: `updated_date` and `last_advert` are now checked first in `merge_node_update()`, ensuring any change to these fields is reported as an update
- ✅ **Sync Notification Filtering**: Deactivated unclaimed Discord nodes are excluded from "Deactivated Nodes from Official Map" to prevent double-counting

The implementation matches the design document (`PROJECT_DATA_INTEGRATION_SCHEME.md`) and handles all edge cases appropriately.

