# RRY-Map-Bot Instructions

## Overview

This Discord bot helps you manage Belgian MeshCore network nodes. You can search for nodes, claim ownership, and update node information.

## Commands

### `/search` - Search Nodes
Search for Belgian MeshCore nodes by name, public key, type, city, frequency, or owner.

**Examples**:
- `/search query:USER_R1` - Find nodes with "USER_R1" in the name
- `/search type:companion city:Brussels` - Find companion nodes in Brussels
- `/search owner:@username` - Find nodes owned by a specific user

### `/claim` - Claim a Node
Claim ownership of a node by its name or public key.

**Example**: `/claim query:USER_R1_Home`

### `/manage` - Manage Your Nodes

#### `/manage list`
List all nodes you've claimed (including inactive ones).

#### `/manage update`
Update your node's properties:
- Name
- City
- Frequency preset or parameters

**Example**: `/manage update query:USER_R1 name:My_New_Node preset:"EU/UK (Narrow) / Switzerland"`

#### `/manage unclaim`
Remove your ownership claim from a node.

**Example**: `/manage unclaim query:USER_R1`

### `/stats` - Statistics
View Belgian MeshCore node statistics (total nodes, by type, by city, etc.).

## Node Types

- 📱 **Companion** (Type 1)
- 📡 **Repeater** (Type 2)
- 💾 **Room Server** (Type 3)
- 🌡️ **Sensor** (Type 4)

## Frequency Presets

The bot recognizes standard MeshCore frequency presets. When updating frequency parameters, you can either:
- Select a preset name (e.g., "EU/UK (Narrow) / Switzerland")
- Specify individual parameters (freq, sf, bw, cr)

## Important Notes

- **Inactive Nodes**: Nodes removed from the official map are marked inactive and won't appear in search results
- **Ownership**: Only you can update nodes you've claimed
- **Immutable Fields**: Public key, coordinates, and node type cannot be changed
- **Real-time Updates**: Changes are immediately visible on the web map at map.axistem.eu

## Need Help?

For more information, visit the project repository or contact the administrators.

---

*Last Updated: 2025-12-31*

