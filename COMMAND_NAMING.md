# Discord Bot Command Naming

**Date**: 2026-01-04  
**Status**: Proposal - Ready for Review

## Overview

This document outlines the proposed command structure for the RRY-Map-Bot Discord bot, moving from the current `/manage` group structure to a more intuitive `/node` group structure.

---

## Proposed Command Structure

### Top-Level Commands (Read Operations)
1. `/search` - Search Belgian MeshCore nodes
2. `/recent` - List recently added and updated nodes (last 24 hours)
3. `/mynodes` - List all your claimed nodes (including inactive ones)

### `/stats` Group (Statistics Commands)
1. `/stats overview` - Show Belgian MeshCore node statistics (main stats)
2. `/stats cities` - List all cities with node counts, sorted by coverage *(NEW)*
3. `/stats frequencies` - Show detailed frequency preset statistics broken down by node type *(NEW)*

### `/node` Group (Write Operations)
1. `/node claim` - Claim ownership of an existing unclaimed node
2. `/node register` - Register a new node (or claim if already exists)
3. `/node update` - Update node properties
4. `/node unclaim` - Remove ownership claim from a node
5. `/node delete` - Permanently delete a node you own

---

## Current vs Proposed Structure

### Current Structure
```
/search
/claim
/register
/stats
/recent
/manage list
/manage update
/manage unclaim
/manage delete
```

### Proposed Structure
```
/search
/recent
/mynodes
/stats overview (main stats - replaces /stats)
/stats cities (NEW)
/stats frequencies (NEW)
/node claim
/node register
/node update
/node unclaim
/node delete
```

---

## Key Changes

### 1. Write Operations → `/node` Group
- **Current**: `/claim`, `/register`, `/manage update`, `/manage unclaim`, `/manage delete`
- **Proposed**: All moved to `/node` group (`/node claim`, `/node register`, etc.)
- **Rationale**: Makes it explicit these are node operations, easier to discover

### 2. List Command → `/mynodes`
- **Current**: `/manage list`
- **Proposed**: `/mynodes`
- **Rationale**: More intuitive, matches old bot's `/my_nodes` pattern

### 3. New Utility Commands (as `/stats` subcommands)
- **`/stats cities`**: List all cities with node counts (sorted by coverage)
- **`/stats frequencies`**: Show frequency preset statistics broken down by node type

---

## Command Behavior

### `/node claim` vs `/node register`

**Primary Use Case:**
- Users should **primarily use `/node claim`** for claiming existing unclaimed nodes
- `/node register` is for **registering new nodes** that don't exist yet

**Smart Behavior:**
- If user accidentally uses `/node register` on an existing node:
  - Bot detects the node already exists
  - Automatically claims it instead of creating duplicate
  - Shows appropriate message to user

**User Flow:**
1. User finds unclaimed node via `/search`
2. User uses `/node claim` to claim it
3. If user tries `/node register` on existing node → auto-claims (smart fallback)

---

## New Utility Commands (as `/stats` Subcommands)

### `/stats cities` - List Cities with Node Counts

**Purpose**: Show all cities that have nodes, sorted by node count (descending).

**Display Format**:
- List format: `City Name: **count** nodes`
- Sorted by count (highest first)
- Paginated if many cities (show top 20-30 per message)
- Shows total number of cities at the end

**Example Output**:
```
📍 Cities with Nodes

• Brussels: **15** nodes
• Antwerp: **8** nodes
• Ghent: **5** nodes
• Leuven: **3** nodes
...

Total: 25 cities
```

**Response**: Public (visible to channel)

---

### `/stats frequencies` - Detailed Frequency Statistics by Node Type

**Purpose**: Show frequency preset and custom frequency distribution broken down by node type.

**Display Format**:
- Separate sections for each node type (Companions, Repeaters, Room Servers, Sensors)
- For each type, show:
  - Top presets used (with counts)
  - Custom frequency count
  - Total nodes of that type
- If a type has no nodes, skip it

**Example Output**:
```
📻 Frequency Statistics by Node Type

📱 Companions (15 nodes)
• EU/UK (Narrow): **8**
• Custom: **4**
• Unknown: **3**

📡 Repeaters (25 nodes)
• EU/UK (Long Range): **15**
• EU/UK (Narrow): **7**
• Custom: **3**

💾 Room Servers (5 nodes)
• EU/UK (Narrow): **5**

🌡️ Sensors (9 nodes)
• EU/UK (Narrow): **6**
• Custom: **2**
• Unknown: **1**
```

**Response**: Public (visible to channel)

---

## Benefits of New Structure

1. ✅ **Clearer Intent**: `/node` prefix makes it obvious these modify nodes
2. ✅ **Better Grouping**: All node modifications in one place
3. ✅ **More Intuitive**: `/mynodes` is clearer than `/manage list`
4. ✅ **Consistent**: All write operations follow same pattern (`/node <action>`)
5. ✅ **Discoverable**: Users type `/node` and see all actions
6. ✅ **Additional Utilities**: New commands provide useful insights

---

## Migration Considerations

### Breaking Changes
- `/claim` → `/node claim` (breaking)
- `/register` → `/node register` (breaking)
- `/stats` → `/stats overview` (breaking - `/stats` becomes a group)
- `/manage list` → `/mynodes` (breaking)
- `/manage update` → `/node update` (breaking)
- `/manage unclaim` → `/node unclaim` (breaking)
- `/manage delete` → `/node delete` (breaking)

### Migration Strategy

**Approach: Direct Replacement** ✅ **Selected**
- Update all commands at once
- Directly implement new `/node` commands, no references to old commands
- Update documentation immediately
- Announce change in Discord

---

## Search Enhancements

### `/search` Additional Optional Parameters
- **Purpose**: Enhance `/search` command with additional filtering options
- **Implementation**: Add optional boolean parameters:
  - `claimed` (optional boolean) - Filter by claim status:
    - `true` - Show only claimed nodes
    - `false` - Show only unclaimed nodes
    - Not specified - Show both claimed and unclaimed nodes
  - `inactive` (optional boolean) - Filter by active/inactive status:
    - `true` - Show only inactive nodes
    - `false` or not specified - Show only active nodes (default behavior)
- **Status**: ✅ **To be implemented** - Provides convenient way to filter by ownership and activity status
- **Note**: By default, `/search` only shows active nodes. Set `inactive: true` to include inactive nodes.

---

## Decisions Made

1. **Old commands as aliases?** ❌ **No** - Direct implementation of new `/node` commands, no references to old commands
2. **Should `/mynodes` show inactive nodes?** ✅ **Yes** - Users should see all their nodes (including inactive ones)
3. **Should `/stats cities` show all cities or only top N?** ✅ **All** - Show all cities with pagination if needed
4. **Should `/stats frequencies` be a separate command or part of `/stats`?** ✅ **Subcommand of `/stats`** - Groups statistics-related commands together

---

## Implementation Notes

1. **Command Registration**: Register `/node` as a group with subcommands
2. **Backward Compatibility**: Consider keeping old commands as aliases (optional)
3. **Documentation**: Update all documentation immediately
4. **User Communication**: Announce the change clearly in Discord

---

## Summary

**Current State**: Commands are functional but could be more intuitive and better organized.

**Proposed Solution**: 
- Move all write operations to `/node` group
- Rename `/manage list` to `/mynodes`
- Add utility commands `/stats cities` and `/stats frequencies` as subcommands of `/stats`

**Result**: More intuitive, discoverable, and consistent command structure that clearly separates read and write operations.

---

*Last Updated: 2026-01-04*

