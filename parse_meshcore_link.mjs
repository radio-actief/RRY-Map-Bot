#!/usr/bin/env node

/**
 * Standalone parser for meshcore:// links
 * Simulates what happens when a link is uploaded via the web interface (RRY-Map-Bot)
 * This is what the /api/v1/nodes endpoint would parse
 */

import { BufferUtils, Packet, Advert } from "@liamcottle/meshcore.js";

const meshcoreLink = process.argv[2];

if (!meshcoreLink || !meshcoreLink.startsWith("meshcore://")) {
  console.error('Usage: node parse_meshcore_link.mjs "meshcore://..."');
  console.error(
    "\nThis simulates what happens when you upload a link via the web interface"
  );
  console.error("(RRY-Map-Bot -> /api/v1/nodes endpoint)");
  process.exit(1);
}

console.log("═══════════════════════════════════════════════════════════════");
console.log("  MESHCORE:// LINK PARSER (Web Interface Simulation)");
console.log("═══════════════════════════════════════════════════════════════");
console.log("");
console.log("This simulates what the server does when you upload via:");
console.log("  RRY-Map-Bot -> POST /api/v1/nodes");
console.log("");

// Strip meshcore:// prefix (what server does)
const hexData = meshcoreLink.replace("meshcore://", "");
console.log("📦 INPUT DATA");
console.log("  Link length:", meshcoreLink.length, "characters");
console.log("  Hex data length:", hexData.length, "characters");
console.log("  Expected bytes:", hexData.length / 2);
console.log("");

// Convert hex to bytes (server does this)
const rawPacket = BufferUtils.hexToBytes(hexData);
console.log("📥 PACKET DECODING");
console.log("  Raw packet bytes:", rawPacket.length);
console.log("");

// Parse packet (server uses Packet.fromBytes())
const packet = Packet.fromBytes(rawPacket);
console.log("📋 PACKET STRUCTURE");
console.log("  Header:", "0x" + packet.header.toString(16).padStart(2, "0"));
console.log("  Route Type:", packet.route_type_string);
console.log("  Payload Type:", packet.payload_type_string);
console.log("  Payload Version:", packet.payload_version);
console.log("  Path Length:", packet.path?.length || 0);
console.log("  Payload Length:", packet.payload?.length || 0);
console.log("");

if (packet.payload_type_string !== "ADVERT") {
  console.error("❌ ERROR: This is not an ADVERT packet!");
  console.error("   Payload type:", packet.payload_type_string);
  process.exit(1);
}

// Parse ADVERT (server does this)
const advert = Advert.fromBytes(packet.payload);
console.log("🔍 ADVERT PARSING");
console.log("  Public Key:", BufferUtils.bytesToHex(advert.publicKey));
console.log("  Timestamp:", advert.timestamp);
console.log(
  "  Timestamp (date):",
  new Date(advert.timestamp * 1000).toISOString()
);
console.log(
  "  Signature:",
  BufferUtils.bytesToHex(advert.signature).substring(0, 32) + "..."
);
console.log("");

// Parse app data (server extracts this)
const parsed = advert.parsed;
console.log("📊 EXTRACTED NODE DATA");
console.log("  Type:", parsed.type);
console.log("  Name:", parsed.name);
if (parsed.lat !== undefined) {
  // Coordinates are stored as signed 32-bit integers (microdegrees)
  // Need to divide by 1,000,000 to get decimal degrees
  const latDecimal = parsed.lat / 1000000;
  const lonDecimal = parsed.lon / 1000000;
  console.log("  Latitude (raw):", parsed.lat, "(microdegrees)");
  console.log("  Latitude (decimal):", latDecimal.toFixed(6), "°");
  console.log("  Longitude (raw):", parsed.lon, "(microdegrees)");
  console.log("  Longitude (decimal):", lonDecimal.toFixed(6), "°");
}
if (parsed.elevation !== undefined) {
  console.log("  Elevation:", parsed.elevation, "m");
}
console.log("");

// Verify signature (server validates this)
const isVerified = advert.isVerified();
console.log("🔐 SIGNATURE VERIFICATION");
console.log("  Signature Valid:", isVerified ? "✓ YES" : "✗ NO");
if (!isVerified) {
  console.log("  ⚠️  WARNING: Invalid signature - server may reject this!");
}
console.log("");

// What gets stored in database
console.log("💾 WHAT GETS STORED IN DATABASE");
console.log('  source: "app"  (manual upload via web interface)');
console.log("  public_key:", BufferUtils.bytesToHex(advert.publicKey));
console.log("  type:", parsed.type);
console.log("  adv_name:", parsed.name);
if (parsed.lat !== undefined && parsed.lon !== undefined) {
  const latDecimal = parsed.lat / 1000000;
  const lonDecimal = parsed.lon / 1000000;
  console.log(
    "  adv_lat:",
    latDecimal,
    "(converted from",
    parsed.lat,
    "microdegrees)"
  );
  console.log(
    "  adv_lon:",
    lonDecimal,
    "(converted from",
    parsed.lon,
    "microdegrees)"
  );
}
console.log("  last_advert:", new Date(advert.timestamp * 1000).toISOString());
console.log("  link:", meshcoreLink.substring(0, 50) + "...");
console.log("");

// Summary
console.log("═══════════════════════════════════════════════════════════════");
console.log("  SUMMARY");
console.log("═══════════════════════════════════════════════════════════════");
console.log("  Node Name:", parsed.name);
console.log("  Node Type:", parsed.type);
console.log("  Public Key:", BufferUtils.bytesToHex(advert.publicKey));
if (parsed.lat !== undefined && parsed.lon !== undefined) {
  const latDecimal = parsed.lat / 1000000;
  const lonDecimal = parsed.lon / 1000000;
  console.log(
    "  Location:",
    `${latDecimal.toFixed(6)}, ${lonDecimal.toFixed(6)}`
  );
  console.log(
    "  Google Maps:",
    `https://www.google.com/maps?q=${latDecimal},${lonDecimal}`
  );
}
console.log("  Last Advert:", new Date(advert.timestamp * 1000).toISOString());
console.log("  Signature Valid:", isVerified ? "✓" : "✗");
console.log("");
console.log('This node would be stored with source: "app" (not "uploader")');
console.log("No expiration - persists until manually removed");
console.log("");
console.log("ℹ️  NOTE: Coordinates are stored as microdegrees (int32)");
console.log("   and must be divided by 1,000,000 to get decimal degrees.");
