# Command Restructure Testing Guide

**Date**: 2026-01-04  
**Purpose**: Comprehensive testing checklist for the new command structure

---

## Pre-Testing Checklist

Before starting, ensure:
- [v] Bot is running and connected to Discord
- [v] Bot has proper permissions (`applications.commands` scope)
- [v] You have access to a test Discord server
- [v] You have at least one node in the database (for testing)
- [v] You have a test Discord account that can own nodes

---

## Phase 1: Verify Old Commands Are Removed

### Test: Old Commands Should Not Exist
- [v] Try `/claim` - Should **NOT** appear in command list
- [v] Try `/register` - Should **NOT** appear in command list
- [v] Try `/manage list` - Should **NOT** appear in command list
- [v] Try `/manage update` - Should **NOT** appear in command list
- [v] Try `/manage unclaim` - Should **NOT** appear in command list
- [v] Try `/manage delete` - Should **NOT** appear in command list
- [v] Try `/stats overview` - Should **NOT** appear (now just `/stats`)

**Expected Result**: None of these commands should be available. If any appear, the old commands weren't fully removed.

---

## Phase 2: Test `/node` Group Commands

### 2.1 Test `/node claim`
- [v] Type `/node claim` - Command should appear
- [v] Use `/node claim query:<partial_node_name>` on an **unclaimed** node
  - [v] Should successfully claim the node
  - [v] Should show embed with format: `{icon} Node Claimed`
  - [v] Should show Public Key, Node Name, Node Type in Inline 1
  - [v] Should show Location (city), Source Type, Claimed By in Inline 2
  - [v] Footer should reference `/mynodes` and `/node update`
- [v] Try claiming an **already claimed** node
  - [v] Should show error: "This node is already claimed by..."
- [v] Try claiming with **multiple matches**
  - [v] Should show list of matching nodes and ask to be more specific (this post has old formatting, updating to a new formatting style with embeds)
- [v] Try claiming with **no matches**
  - [v] Should show: "Node not found in Belgian database."

### 2.2 Test `/node register`
- [v] Type `/node register` - Command should appear
- [v] Register a **new node** (doesn't exist in database)
  - [v] Should successfully register
  - [v] Should show embed: `{icon} Node Registered`
  - [v] Should auto-claim the node
- [v] Register a node that **already exists but is unclaimed**
  - [v] If details match: Should auto-claim with existing details
  - [v] If details don't match: Should show choice prompt (Use Existing/Use New)
- [v] Register a node that **already exists and is claimed by you**
  - [v] Should show: "Node Already Owned" message
- [v] Register a node that **already exists and is claimed by someone else**
  - [v] Should show error: "This node is already claimed by another user."
- [ ] Register an **inactive node** (previously removed)
  - [v] Should show reactivation confirmation prompt
  - [v] Test "Yes, Reactivate" button
  - [v] Test "Cancel" button

### 2.3 Test `/node update`
- [v] Type `/node update` - Command should appear
- [v] Update a node you **own**
  - [v] Update name only
  - [v] Update city only
  - [v] Update coordinates (latitude/longitude)
  - [v] Update frequency preset
  - [v] Update custom frequency parameters
  - [v] Update multiple fields at once
  - [v] Verify embed shows: Changed Detail, Old Value, New Value
  - [v] Verify coordinates show as "Hidden" → "Updated" (not actual values)
- [v] Try updating a node you **don't own**
  - [v] Should show error: "You don't own this node."
- [v] Try updating with **multiple matches**
  - [v] Should show list and ask to be more specific
- [v] Try updating with **no matches**
  - [v] Should show: "Node not found."

### 2.4 Test `/node unclaim`
- [v] Type `/node unclaim` - Command should appear
- [v] Unclaim a node you **own**
  - [v] Should show confirmation prompt with full node details
  - [v] Test "Yes, Unclaim" button
  - [v] Should show embed: `{icon} Node Unclaimed`
  - [v] Should show "Status: Unclaimed" instead of "Claimed by:"
- [ ] Try unclaiming a node you **don't own**
  - [ ] Should show error: "You don't own this node."
- [v] Test "Cancel" button on confirmation

### 2.5 Test `/node delete`
- [v] Type `/node delete` - Command should appear
- [v] Delete a **Discord-registered** node you own
  - [v] Should show confirmation prompt with full node details
  - [v] Title should be: "🗑️ ⚠️ Confirm Deletion"
  - [v] Test "Yes, Delete" button
  - [v] Should show embed: "🗑️ Node Deleted"
  - [v] Footer should say: "This node has been permanently removed from the database."
- [v] Try deleting a node you **don't own**
  - [v] Should show error about ownership
- [v] Try deleting a node from **official map** (not Discord-registered)
  - [v] Should show error: "Cannot delete node: [reason]"
- [v] Test "Cancel" button on confirmation

---

## Phase 3: Test `/mynodes` Command

### Test `/mynodes`
- [v] Type `/mynodes` - Command should appear
- [v] If you **own nodes**:
  - [v] Should show all your nodes (active + inactive)
  - [v] Title: "Your registered Nodes (#)"
  - [v] Description: "Nodes registered to @yourname"
  - [v] Each node should show:
    - [v] Line 1: `{icon} HEX HEAD - Node Name`
    - [v] Line 2: `📍 City (coords) | 📅 Most recent date`
    - [v] Line 3: `📻 Frequency: ... | ℹ️ Source: ...`
  - [v] Footer: "Use `/search` more precisely to get a detailed node view"
  - [v] Response should be **ephemeral** (only you can see it)
- [v] If you **don't own nodes**:
  - [v] Should show: "Your registered Nodes (0)"
  - [v] Description: "You don't own any nodes."

---

## Phase 4: Test `/stats` Commands

### 4.1 Test `/stats` (Main Statistics)
- [v] Type `/stats` - Command should appear as top-level command
- [v] Execute `/stats`
  - [v] Should show main statistics embed
  - [v] Title: "📊 Belgian MeshCore Registry Statistics"
  - [v] Description: Link to Belgian MeshCore Network
  - [v] Inline 1: Nodes, Node Types, Frequency Presets
  - [v] Inline 2: Most Covered Cities (first), Coverage, Users
  - [v] Inline 3: Recent Activity (first position)
  - [v] Activity field should show: "X in the last 24 hours", "X in the last 7 days", "X in the last 30 days"
  - [v] Footer: Statistics from Official MeshCore map...
  - [v] Response should be **public** (visible to channel)

### 4.2 Test `/stats-cities`
- [v] Type `/stats-cities` - Command should appear as top-level command
- [v] Execute `/stats-cities`
  - [v] Should list all cities with node counts
  - [v] Title: "📍 Cities with Nodes"
  - [v] Format: `• City Name: **count** nodes`
  - [v] Sorted by count (highest first)
  - [v] If > 30 cities: Should paginate (show footer with page info)
  - [v] Footer: "Total: X cities" or "Showing 1-30 of X cities"
  - [v] Response should be **public**

### 4.3 Test `/stats-frequencies`
- [v] Type `/stats-frequencies` - Command should appear as top-level command
- [v] Execute `/stats-frequencies`
  - [v] Should show frequency stats by node type
  - [v] Title: "📻 Frequency Statistics by Node Type"
  - [v] Should show sections for each type (Companions, Repeaters, Room Servers, Sensors)
  - [v] Each section should show:
    - [v] Type icon and total count: `📱 Companions (X nodes)`
    - [v] Preset counts: `• Preset Name: **count**`
    - [v] Custom count: `• Custom: **count**`
    - [v] Unknown count: `• Unknown: **count**`
  - [v] Types with 0 nodes should be skipped
  - [v] Response should be **public**

### 4.4 Test `/stats-source` (NEW)
- [v] Type `/stats-source` - Command should appear as top-level command
- [v] Execute `/stats-source`
  - [v] Should show node statistics by source type
  - [v] Title: "📊 Node Statistics by Source"
  - [v] Should show each source type with count and percentage
  - [v] Format: `• **Source Name:** count (X.X%)`
  - [v] Should show: Discord, App, Uploader, Web, Unknown (if applicable)
  - [v] Should show "Total Active Nodes" field
  - [v] Footer: "Source indicates where the node was originally registered"
  - [v] Response should be **public**

---

## Phase 5: Test Enhanced `/search` Command

### 5.1 Test Basic Search (No New Parameters)
- [v] Type `/search` - Command should appear
- [v] Search with `query` only
  - [v] Should work as before
- [v] Search with `node_type` filter
  - [v] Should filter correctly
- [v] Search with `city` filter
  - [v] Should filter correctly
- [v] Search with `frequency_preset` filter
  - [v] Should filter correctly
- [v] Search with `owner` filter
  - [v] Should filter correctly

### 5.2 Test `claimed` Parameter
- [v] Search with `claimed: true`
  - [v] Should **only** show claimed nodes (have Discord owner)
- [v] Search with `claimed: false`
  - [v] Should **only** show unclaimed nodes (no Discord owner)
- [v] Search with `claimed` not specified
  - [v] Should show **both** claimed and unclaimed nodes
- [v] Combine `claimed` with other filters
  - [v] Test `claimed: true` + `node_type`
  - [v] Test `claimed: false` + `city`
  - [v] Verify filters work together correctly

### 5.3 Test `inactive` Parameter
- [v] Search with `inactive: false` (or not specified)
  - [v] Should **only** show active nodes (default behavior)
- [v] Search with `inactive: true`
  - [v] Should **only** show inactive nodes (not include active)
- [v] Combine `inactive` with other filters
  - [v] Test `inactive: true` + `claimed: true`
  - [v] Test `inactive: true` + `node_type`
  - [v] Verify filters work together correctly

### 5.4 Test `source` Parameter (NEW)
- [v] Search with `source: Discord`
  - [v] Should **only** show nodes with source = "discord"
- [v] Search with `source: App`
  - [v] Should **only** show nodes with source = "app"
- [v] Search with `source: Uploader`
  - [v] Should **only** show nodes with source = "uploader"
- [v] Search with `source: Web`
  - [v] Should **only** show nodes with source = "web"
- [v] Search with `source: Unknown`
  - [v] Should **only** show nodes with NULL, empty, or "unknown" source
- [v] Combine `source` with other filters
  - [v] Test `source: Discord` + `claimed: true`
  - [v] Test `source: App` + `node_type`
  - [v] Verify filters work together correctly
- [v] Verify source appears in search query description

### 5.5 Test Search Results Format
- [v] Single result:
  - [v] Should show full node details
  - [v] Description: `**NODENAME** `HEX HEAD` (type) details found by <@user>`
  - [v] Footer should reference `/node claim` if unclaimed, or `/node update` if claimed
- [v] Multiple results:
  - [v] Should use simplified format (3 lines per node)
  - [v] Should show owner: ` - 👤 @DiscordOwner` (or omit if unclaimed)
  - [v] Should **NOT** show coordinates
  - [v] Should paginate if > 25 results
- [v] No results:
  - [v] Should show appropriate message

---

## Phase 6: Test `/recent` Command (Unchanged)

### Test `/recent`
- [v] Type `/recent` - Command should appear
- [v] Execute `/recent`
  - [v] Should show nodes updated in last 24 hours
  - [v] Should use same format as `/search` multiple results
  - [v] Should show owner (or omit if unclaimed)
  - [v] Should **NOT** show coordinates
  - [v] Response should be **public**

---

## Phase 7: Test Command Visibility

### Test Response Visibility
- [v] `/node claim` - Should be **public** (visible to channel)
- [v] `/node register` - Should be **public** (visible to channel)
- [v] `/node update` - Should be **public** (visible to channel)
- [v] `/node unclaim` - Confirmation: **ephemeral**, Success: **public**
- [v] `/node delete` - Confirmation: **ephemeral**, Success: **public**
- [v] `/mynodes` - Should be **ephemeral** (only you can see)
- [v] `/stats` - Should be **public**
- [v] `/stats-cities` - Should be **public**
- [v] `/stats-frequencies` - Should be **public**
- [v] `/search` - Single result: **public**, Multiple results: **public**
- [v] `/recent` - Should be **public**

---

## Phase 8: Test Error Handling

### Test Error Messages
- [ ] Invalid node type - Should show clear error
- [ ] Invalid frequency preset - Should show clear error
- [ ] Node not found - Should show appropriate message
- [ ] Multiple matches - Should list nodes and ask to be more specific
- [ ] Permission errors (don't own node) - Should show clear error
- [ ] Database errors - Should show generic error (not expose internals)

---

## Phase 9: Test Command Autocomplete

### Test Command Discovery
- [ ] Type `/` in Discord
  - [ ] Should see `/node` group with subcommands (claim, register, update, unclaim, delete)
  - [ ] Should see `/stats` as top-level command
  - [ ] Should see `/stats-cities` as top-level command
  - [ ] Should see `/stats-frequencies` as top-level command
  - [ ] Should see `/stats-source` as top-level command
  - [ ] Should see `/search`, `/mynodes`, `/recent` as top-level
  - [ ] Should **NOT** see old commands (`/claim`, `/register`, `/manage`, `/stats overview`, etc.)

### Test Parameter Autocomplete
- [ ] `/node register` - Should show node_type and frequency_preset dropdowns
- [ ] `/node update` - Should show preset dropdown
- [ ] `/search` - Should show node_type, frequency_preset, and source dropdowns
- [ ] `/search` - Should show `claimed` and `inactive` as boolean options

---

## Phase 10: Test Logging

### Verify Command Logging
Check bot logs/console output for:
- [ ] `NODE_CLAIM` - Appears when using `/node claim`
- [ ] `NODE_REGISTER` - Appears when using `/node register`
- [ ] `NODE_UPDATE` - Appears when using `/node update`
- [ ] `NODE_UNCLAIM` - Appears when using `/node unclaim`
- [ ] `NODE_DELETE` - Appears when using `/node delete`
- [ ] `MYNODES` - Appears when using `/mynodes`
- [ ] `STATS` - Appears when using `/stats` (main command)
- [ ] `STATS_CITIES` - Appears when using `/stats-cities`
- [ ] `STATS_FREQUENCIES` - Appears when using `/stats-frequencies`
- [ ] `STATS_SOURCE` - Appears when using `/stats-source`
- [ ] `SEARCH` - Appears when using `/search`
- [ ] `RECENT` - Appears when using `/recent`

**Note**: Old log names (`CLAIM`, `REGISTER`, `MANAGE_*`, `STATS_OVERVIEW`) should **NOT** appear.

---

## Phase 11: Test Edge Cases

### Test Edge Cases
- [ ] Search with **all filters** at once (query, node_type, city, frequency_preset, owner, claimed, inactive, source)
- [ ] Search with **empty query** but filters
- [ ] Update node with **no changes** (same values)
- [ ] Claim node that was **just unclaimed**
- [ ] Register node with **very long name**
- [ ] Register node with **special characters** in name
- [ ] Search for node with **no city** set
- [ ] Search for node with **no frequency params**
- [ ] Search for node with **no source** (NULL/Unknown)
- [ ] `/stats-cities` with **0 cities** in database
- [ ] `/stats-frequencies` with **0 nodes** of a type
- [ ] `/stats-source` with **0 nodes** of a source type
- [ ] `/mynodes` with **many nodes** (test pagination if applicable)

---

## Phase 12: Test Interactive Views

### Test Button Interactions
- [ ] `/node register` - "Use Existing Details" button
- [ ] `/node register` - "Use New Details" button
- [ ] `/node register` - Reactivation confirmation buttons
- [ ] `/node unclaim` - Confirmation buttons
- [ ] `/node delete` - Confirmation buttons
- [ ] Test button **timeout** (wait 5 minutes)
  - [ ] Buttons should be disabled
  - [ ] Should show timeout message

### Test View Permissions
- [ ] Try clicking buttons on **someone else's** prompt
  - [ ] Should show: "This prompt is not for you."

---

## Quick Test Checklist (Minimal)

If you're short on time, test these critical items:

1. [ ] **Old commands don't exist** - Try `/claim`, `/register`, `/manage list`, `/stats overview` - should fail
2. [ ] **New commands exist** - Try `/node claim`, `/mynodes`, `/stats`, `/stats-cities`, `/stats-frequencies`, `/stats-source` - should work
3. [ ] **Basic functionality** - Claim a node, update it, unclaim it
4. [ ] **Search enhancements** - Test `claimed: true`, `inactive: true`, and `source: Discord` parameters
5. [ ] **Stats commands** - Test `/stats`, `/stats-cities`, `/stats-frequencies`, and `/stats-source`
6. [ ] **Command visibility** - Verify `/mynodes` is ephemeral, others are public

---

## Expected Issues to Watch For

### Common Issues
1. **Commands not appearing** - May need to wait up to 1 hour for Discord to sync, or re-invite bot
2. **"Command not found"** - Check bot logs for sync errors
3. **Parameter errors** - Verify function signatures match
4. **Database errors** - Check database connection and schema
5. **Permission errors** - Verify bot has `applications.commands` scope

### Debugging Tips
- Check bot console logs for errors
- Verify command registration in `on_ready()` output
- Test in a private channel first
- Use Discord's command autocomplete to verify commands exist
- Check database directly if data seems wrong

---

## Success Criteria

✅ **All tests pass** when:
- All old commands are removed
- All new commands work correctly
- All parameters work as expected
- All error handling works
- All logging is correct
- All response visibility is correct
- No errors in bot logs

---

*Good luck with testing! Report any issues you find.*

