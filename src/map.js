import {
  createApp,
  reactive,
  ref,
  computed,
  watch,
  onMounted,
  onBeforeUnmount,
  nextTick,
  toRaw,
} from "../lib/vue.esm-browser.js";
import * as ntools from "./node-utils.js";

// MDI paths (same as @mdi/js – use with Vue :d="mdiChartLine" etc.)
const mdiChartLine =
  "M16,11.78L20.24,4.45L21.97,5.45L16.74,14.5L10.23,10.75L5.46,19H22V21H2V3H4V17.54L9.5,8L16,11.78Z";
const mdiLogout =
  "M17 7L15.59 8.41L18.17 11H8V13H18.17L15.59 15.58L17 17L22 12M4 5H12V3H4C2.9 3 2 3.9 2 5V19C2 20.1 2.9 21 4 21H12V19H4V5Z";
const mdiCounter =
  "M4,4H20A2,2 0 0,1 22,6V18A2,2 0 0,1 20,20H4A2,2 0 0,1 2,18V6A2,2 0 0,1 4,4M4,6V18H11V6H4M20,18V6H18.76C19,6.54 18.95,7.07 18.95,7.13C18.88,7.8 18.41,8.5 18.24,8.75L15.91,11.3L19.23,11.28L19.24,12.5L14.04,12.47L14,11.47C14,11.47 17.05,8.24 17.2,7.95C17.34,7.67 17.91,6 16.5,6C15.27,6.05 15.41,7.3 15.41,7.3L13.87,7.31C13.87,7.31 13.88,6.65 14.25,6H13V18H15.58L15.57,17.14L16.54,17.13C16.54,17.13 17.45,16.97 17.46,16.08C17.5,15.08 16.65,15.08 16.5,15.08C16.37,15.08 15.43,15.13 15.43,15.95H13.91C13.91,15.95 13.95,13.89 16.5,13.89C19.1,13.89 18.96,15.91 18.96,15.91C18.96,15.91 19,17.16 17.85,17.63L18.37,18H20M8.92,16H7.42V10.2L5.62,10.76V9.53L8.76,8.41H8.92V16Z";
const mdiWeb =
  "M16.36,14C16.44,13.34 16.5,12.68 16.5,12C16.5,11.32 16.44,10.66 16.36,10H19.74C19.9,10.64 20,11.31 20,12C20,12.69 19.9,13.36 19.74,14M14.59,19.56C15.19,18.45 15.65,17.25 15.97,16H18.92C17.96,17.65 16.43,18.93 14.59,19.56M14.34,14H9.66C9.56,13.34 9.5,12.68 9.5,12C9.5,11.32 9.56,10.65 9.66,10H14.34C14.43,10.65 14.5,11.32 14.5,12C14.5,12.68 14.43,13.34 14.34,14M12,19.96C11.17,18.76 10.5,17.43 10.09,16H13.91C13.5,17.43 12.83,18.76 12,19.96M8,8H5.08C6.03,6.34 7.57,5.06 9.4,4.44C8.8,5.55 8.35,6.75 8,8M5.08,16H8C8.35,17.25 8.8,18.45 9.4,19.56C7.57,18.93 6.03,17.65 5.08,16M4.26,14C4.1,13.36 4,12.69 4,12C4,11.31 4.1,10.64 4.26,10H7.64C7.56,10.66 7.5,11.32 7.5,12C7.5,12.68 7.56,13.34 7.64,14M12,4.03C12.83,5.23 13.5,6.57 13.91,8H10.09C10.5,6.57 11.17,5.23 12,4.03M18.92,8H15.97C15.65,6.75 15.19,5.55 14.59,4.44C16.43,5.07 17.96,6.34 18.92,8M12,2C6.47,2 2,6.5 2,12A10,10 0 0,0 12,22A10,10 0 0,0 22,12A10,10 0 0,0 12,2Z";
const mdiFileDocument =
  "M13,9H18.5L13,3.5V9M6,2H14L20,8V20A2,2 0 0,1 18,22H6C4.89,22 4,21.1 4,20V4C4,2.89 4.89,2 6,2M15,18V16H6V18H15M18,14V12H6V14H18Z";
const apiUrl = "/api/v1/belgian-nodes";

const types = {
  1: "Client",
  2: "Repeater",
  3: "Room Server",
  4: "Sensor",
};

// Frequency Presets (fallback - matching backend config)
// Will be replaced by dynamic presets from API if available
let FREQUENCY_PRESETS = [
  { name: "Australia", freq: 915.8, sf: 10, bw: 250, cr: 5 },
  { name: "Australia: Victoria", freq: 916.675, sf: 7, bw: 62.5, cr: 8 },
  {
    name: "EU/UK (Narrow)",
    freq: 869.618,
    sf: 8,
    bw: 62.5,
    cr: 8,
  },
  { name: "EU/UK (Long Range)", freq: 869.525, sf: 11, bw: 250, cr: 5 },
  { name: "EU/UK (Medium Range)", freq: 869.525, sf: 10, bw: 250, cr: 5 },
  { name: "Czech Republic (Narrow)", freq: 869.525, sf: 7, bw: 62.5, cr: 5 },
  { name: "EU 433MHz (Long Range)", freq: 433.65, sf: 11, bw: 250, cr: 5 },
  { name: "New Zealand", freq: 917.375, sf: 11, bw: 250, cr: 5 },
  { name: "New Zealand (Narrow)", freq: 917.375, sf: 7, bw: 62.5, cr: 5 },
  { name: "Portugal 433", freq: 433.375, sf: 9, bw: 62.5, cr: 6 },
  { name: "Portugal 868", freq: 869.618, sf: 7, bw: 62.5, cr: 6 },
  { name: "USA/Canada (Recommended)", freq: 910.525, sf: 7, bw: 62.5, cr: 5 },
  { name: "Vietnam", freq: 920.25, sf: 11, bw: 250, cr: 5 },
];

// Fetch presets from API (upstream approach with our endpoint)
let presetsFetched = false;
async function getPresets() {
  // If already fetched, return cached presets
  if (presetsFetched && FREQUENCY_PRESETS.length > 0) {
    return FREQUENCY_PRESETS;
  }

  try {
    const res = await fetch("/api/v1/config");
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    }
    const config = await res.json();
    const presetsApi = config.config.suggested_radio_settings.entries;

    // Transform API format to our format
    // Handle both string and number formats (official API uses strings)
    FREQUENCY_PRESETS = presetsApi.map((p) => ({
      name: p.title,
      desc: p.description,
      freq:
        typeof p.frequency === "string" ? parseFloat(p.frequency) : p.frequency,
      sf:
        typeof p.spreading_factor === "string"
          ? parseInt(p.spreading_factor, 10)
          : p.spreading_factor,
      bw:
        typeof p.bandwidth === "string" ? parseFloat(p.bandwidth) : p.bandwidth,
      cr:
        typeof p.coding_rate === "string"
          ? parseInt(p.coding_rate, 10)
          : p.coding_rate,
    }));

    presetsFetched = true;
    console.log("Loaded presets from API:", FREQUENCY_PRESETS.length);
    return FREQUENCY_PRESETS;
  } catch (e) {
    console.warn("Failed to fetch presets from API, using fallback:", e);
    // Keep fallback presets (already in FREQUENCY_PRESETS)
    presetsFetched = false;
    return FREQUENCY_PRESETS;
  }
}

// Copy to clipboard with confirmation
function copyToClipboard(text, element) {
  navigator.clipboard
    .writeText(text)
    .then(() => {
      // Show confirmation
      const originalText = element.innerHTML;
      element.innerHTML =
        '<span style="color: #4CAF50; font-weight: bold;">✓ Copied!</span>';
      element.style.cursor = "pointer";

      // Reset after 3 seconds
      setTimeout(() => {
        element.innerHTML = originalText;
      }, 3000);
    })
    .catch((err) => {
      console.error("Failed to copy:", err);
      const originalText = element.innerHTML;
      element.innerHTML =
        '<span style="color: #f44336; font-weight: bold;">✗ Failed</span>';
      setTimeout(() => {
        element.innerHTML = originalText;
      }, 3000);
    });
}

// Event delegation for copy clicks
function setupCopyHandlers() {
  // Use event delegation on document to handle dynamically created elements
  document.addEventListener("click", function (e) {
    if (e.target && e.target.classList.contains("copyable")) {
      const text = e.target.getAttribute("data-copy");
      if (text) {
        copyToClipboard(text, e.target);
      }
    }
  });
}

// Match frequency preset
function matchFrequencyPreset(params) {
  if (!params || typeof params !== "object") return null;

  const freq = parseFloat(params.freq);
  const sf = parseInt(params.sf);
  const bw = parseFloat(params.bw);
  const cr = parseInt(params.cr);

  if (isNaN(freq) || isNaN(sf) || isNaN(bw) || isNaN(cr)) return null;

  for (const preset of FREQUENCY_PRESETS) {
    if (
      Math.abs(freq - preset.freq) < 0.001 &&
      sf === preset.sf &&
      Math.abs(bw - preset.bw) < 0.001 &&
      cr === preset.cr
    ) {
      return preset;
    }
  }
  return null;
}

// Format radio params display
function formatRadioParams(params) {
  if (
    !params ||
    typeof params !== "object" ||
    Object.keys(params).length === 0
  ) {
    return "N/A";
  }

  const preset = matchFrequencyPreset(params);
  const freq = parseFloat(params.freq);
  const sf = parseInt(params.sf);
  const bw = parseFloat(params.bw);
  const cr = parseInt(params.cr);

  let html = "";

  if (preset) {
    html += `<div><b>${preset.name}</b></div>`;
  } else {
    html += `<div><b>Custom params</b></div>`;
  }

  html += `<div>Frequency: ${isNaN(freq) ? "N/A" : freq + "MHz"}</div>`;
  html += `<div>Bandwidth: ${isNaN(bw) ? "N/A" : bw + "kHz"}</div>`;
  html += `<div>Coding rate: ${isNaN(cr) ? "N/A" : cr}</div>`;
  html += `<div>Spreading factor: ${isNaN(sf) ? "N/A" : sf}</div>`;

  return html;
}

// Format date as relative time (exact upstream implementation)
function timeAgo(msec) {
  const seconds = Math.floor((Date.now() - msec) / 1000);

  const units = [
    { name: "year", limit: 31536000 },
    { name: "month", limit: 2592000 },
    { name: "day", limit: 86400 },
    { name: "hour", limit: 3600 },
    { name: "minute", limit: 60 },
    { name: "second", limit: 1 },
  ];

  for (const unit of units) {
    const count = Math.floor(seconds / unit.limit);

    if (count >= 1) {
      return `${count} ${unit.name}${count > 1 ? "s" : ""} ago`;
    }
  }

  return "just now";
}

// Helper function to format date string with timeAgo
function formatRelativeTime(dateString) {
  if (!dateString) return "N/A";

  const date = new Date(dateString);
  if (isNaN(date.getTime())) return "Invalid date";

  const dt = new Date(dateString);
  return `<time datetime="${dateString}" title="${dt.toLocaleString()}">${timeAgo(
    dt.getTime()
  )}</time>`;
}

// Create clickable copy element
function createCopyableElement(text, displayText = null) {
  if (!text) return "N/A";
  const display = displayText || text;
  // Escape HTML and quotes for data attribute
  const escapedText = String(text)
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
  const escapedDisplay = String(display)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
  return `<span class="copyable" data-copy="${escapedText}" style="cursor: pointer; color: #2196F3; text-decoration: underline;" title="Click to copy">${escapedDisplay}</span>`;
}

const columnOrder = [
  "adv_name",
  "type",
  "status",
  "public_key",
  "city",
  "coords",
  "discord_owner_name",
  "params",
  "link",
  "inserted_date",
  "updated_date",
  "last_advert",
  "discord_updated_date",
  "inserted_by",
  "updated_by",
  "source",
];
const columns = {
  coords: {
    label: "Coordinates",
    value: (val) =>
      `<a target="_blank" href="https://google.com/maps/place/${val.replace(
        " ",
        ""
      )}">${val}</a>`,
  },
  adv_name: {
    label: "Name",
  },
  status: {
    label: "Update status",
    value: (val) => updateStatusDesc[val] || "N/A",
  },
  inserted_date: {
    label: "Inserted date",
    value: (val) => formatRelativeTime(val),
  },
  updated_date: {
    label: "Updated date",
    value: (val) => formatRelativeTime(val),
  },
  last_advert: {
    label: "Last advert",
    value: (val) => formatRelativeTime(val),
  },
  public_key: {
    label: "Public key",
    value: (val) => createCopyableElement(val, val.toUpperCase()),
  },
  inserted_by: {
    label: "Inserted by",
    value: (val) =>
      val ? createCopyableElement(val, val.toUpperCase()) : "N/A",
  },
  updated_by: {
    label: "Updated by",
    value: (val) =>
      val ? createCopyableElement(val, val.toUpperCase()) : "N/A",
  },
  type: {
    label: "Node type",
    value: (val) => types[val],
  },
  params: {
    label: "Radio params",
    value: (val) => formatRadioParams(val),
  },
  link: {
    label: "Meshcore link",
    value: (val) => createCopyableElement(val, val),
  },
  city: {
    label: "City",
    value: (val) => val || "Unknown",
  },
  discord_owner_name: {
    label: "Discord Owner",
    value: (val, node) => {
      // This function is only called if val exists (field is shown)
      const ownerId = node?.discord_owner_id;
      if (ownerId) {
        // Create clickable Discord DM link
        // discord:// works for desktop Discord app, https:// works for web
        return `<a href="https://discord.com/users/${ownerId}" target="_blank" title="Send DM to ${val}">@${val}</a>`;
      }
      return `@${val}`;
    },
  },
  discord_updated_date: {
    label: "Last Discord Update",
    value: (val) => formatRelativeTime(val),
  },
  source: {
    label: "Source",
    value: (val) => {
      if (!val) return "N/A";
      const lowerVal = val.toLowerCase();
      // Capitalize first letter only
      const capitalizedVal =
        lowerVal.charAt(0).toUpperCase() + lowerVal.slice(1);

      // Define tooltip text based on source type
      let tooltipText = "";
      if (lowerVal === "uploader") {
        tooltipText = "Uploader: Auto-uploaded via MeshCore map uploader tool";
      } else if (lowerVal === "app") {
        tooltipText = "App: Added via a MeshCore app";
      } else if (lowerVal === "web") {
        tooltipText = "Web: Added via legacy official map";
      } else if (lowerVal === "discord") {
        tooltipText = "Discord: Added via Discord";
      }

      // Create the value with tooltip
      let valueHtml = `<span class="pointer-help" title="${tooltipText}" style="cursor: help; text-decoration: underline; text-decoration-style: dotted;">${capitalizedVal}</span>`;

      // If source is "uploader", add a clickable icon next to it
      if (lowerVal === "uploader") {
        valueHtml += ` <a href="https://github.com/recrof/map.meshcore.dev-uploader" target="_blank" rel="noopener noreferrer" title="View MeshCore map uploader on GitHub" style="color: #4CAF50; text-decoration: none; margin-left: 4px;">🔗</a>`;
      }

      return valueHtml;
    },
  },
};

function getSvgIconUrl(text, color) {
  const svg = `
	<svg width="512" height="512" xmlns="http://www.w3.org/2000/svg" >
		<style>
		text { font: bold 150pt sans-serif; fill: #fff; }
		</style>
		<ellipse cx="50%" cy="50%" rx="50%" ry="50%" fill="${color}"/>
		<text x="50%" y="50%" dominant-baseline="middle" text-anchor="middle">${text}</text>
	</svg>`;

  return L.icon({
    iconUrl: URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" })),
    iconSize: [32, 32],
    iconAnchor: [17, 17],
    popupAnchor: [0, -16],
  });
}

function clearLocationHash() {
  history.pushState("", document.title, location.pathname + location.search);
}

function getTable(node, authState = null) {
  // Map node type to analyzer URL type
  // User specified: companions (type 1), repeaters (type 2), rooms (type 3), sensors (type 5)
  const typeMap = {
    1: "companions",
    2: "repeaters",
    3: "rooms",
    4: "sensors",
  };

  const analyzerType = typeMap[node.type] || "companions";
  const analyzerUrl = `https://analyzer.letsmesh.net/nodes/${analyzerType}?public_key=${node.public_key}`;

  return (
    '<table class="node-info"><tbody>' +
    "<tr>" +
    columnOrder
      .flatMap((key) => {
        // Special handling for discord_owner_name - only show if there's an actual owner
        const shouldShow =
          key === "discord_owner_name"
            ? node.discord_owner_name && node.discord_owner_name.trim() !== ""
            : node[key];

        if (shouldShow) {
          return [
            `<td><b>${columns[key].label}</b></td><td>${
              columns[key].value
                ? columns[key].value(node[key], node)
                : node[key]
            }</td>`,
          ];
        }
        return [];
      })
      .join("</tr><tr>") +
    "</tr>" +
    "</tbody></table>" +
    (() => {
      // Check if node is unclaimed
      const isUnclaimed =
        !node.discord_owner_name || node.discord_owner_name.trim() === "";
      const discordServerUrl = "https://discord.gg/kvybAgqnhD";
      const discordColor = "#5865F2"; // Discord purple/burple color
      const publicKey = node.public_key || "";

      // Build footer with links
      let footerLinks = [];

      // Always show Analyzer link
      footerLinks.push(
        `<a href="${analyzerUrl}" target="_blank" rel="noopener noreferrer" style="color: #4CAF50; text-decoration: none; font-size: 0.75em;">
          <strong>Analyzer</strong>
        </a>`
      );

      // Add Claim/Unclaim link based on authentication and ownership
      if (authState && authState.authenticated) {
        // User is authenticated - show claim/unclaim based on ownership
        if (isUnclaimed) {
          // Unclaimed node - show claim button
          footerLinks.push(
            `<a href="javascript:void(0)" onclick="window.claimNode('${publicKey}')" style="color: ${discordColor}; text-decoration: none; font-size: 0.75em; cursor: pointer;">
              <strong>Claim</strong>
            </a>`
          );
        } else {
          // Check if current user owns this node
          const nodeOwnerId = node.discord_owner_id;
          const currentUserId = authState.user?.id;

          // Only show unclaim button if the current user is the owner
          if (
            nodeOwnerId &&
            currentUserId &&
            String(nodeOwnerId) === String(currentUserId)
          ) {
            footerLinks.push(
              `<a href="javascript:void(0)" onclick="window.unclaimNode('${publicKey}')" style="color: #f44336; text-decoration: none; font-size: 0.75em; cursor: pointer;">
                <strong>Unclaim</strong>
              </a>`
            );
          }
        }
      } else if (isUnclaimed) {
        // Not authenticated and unclaimed - redirect to login
        footerLinks.push(
          `<a href="/auth/login" style="color: ${discordColor}; text-decoration: none; font-size: 0.75em; cursor: pointer;">
            <strong>Claim</strong>
          </a>`
        );
      }

      // Add Request deletion link if source is app, uploader, or web (not discord)
      const source = (node.source || "").toLowerCase();
      const isNotDiscordSource =
        source !== "discord" &&
        (source === "app" || source === "uploader" || source === "web");

      if (isNotDiscordSource) {
        const emailSubject = encodeURIComponent(
          "MeshCore Map node deletion request"
        );
        const emailBody = encodeURIComponent(
          `Please delete my node(s) from MeshCore Map database\n` +
            `MeshCore link(s) or Public key(s):\n\n` +
            `${publicKey}\n\n` +
            `*** IMPORTANT ***\n` +
            `if you have multiple nodes to delete, put them into single email, delimited by newline. public key is enough, you don't need to add name or screenshot of the node.`
        );
        const mailtoUrl = `mailto:recrof@gmail.com?subject=${emailSubject}&body=${emailBody}`;

        footerLinks.push(
          `<a href="${mailtoUrl}" style="color: #f44336; text-decoration: none; font-size: 0.75em;">
            <strong>Request deletion</strong>
          </a>`
        );
      }

      // Create equal-width columns for buttons
      const numLinks = footerLinks.length;
      const columnWidth = numLinks > 0 ? `${100 / numLinks}%` : "100%";

      return `<div style="margin-top: 5px; padding-top: 5px; padding-bottom: 5px; border-top: 1px solid #ddd;">
        <table style="width: 100%; border-collapse: collapse;">
          <tr>
            ${footerLinks
              .map(
                (link) =>
                  `<td style="width: ${columnWidth}; text-align: center; padding: 0 5px;">
                ${link}
              </td>`
              )
              .join("")}
          </tr>
        </table>
      </div>`;
    })()
  );
}

// Initialize copy handlers when DOM is ready
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", setupCopyHandlers);
} else {
  setupCopyHandlers();
}

window.isNewerThan = (date, days) => {
  const daysMs = 1000 * 3600 * 24 * days;
  const dateMs = new Date(date).getTime();

  return dateMs > Date.now() - daysMs;
};

// Get the most recent date from all 4 date fields for a node
// Returns the date as an ISO string, or null if no valid dates found
function getMostRecentDate(node) {
  const dates = [
    node.inserted_date,
    node.updated_date,
    node.last_advert,
    node.discord_updated_date,
  ].filter((date) => date != null && date !== "");

  if (dates.length === 0) return null;

  // Convert all dates to timestamps and find the maximum
  const timestamps = dates.map((date) => new Date(date).getTime());
  const mostRecentTimestamp = Math.max(...timestamps);

  // Return as ISO string for consistency with node date format
  return new Date(mostRecentTimestamp).toISOString();
}

// Get node update status (exact upstream implementation - day-based)
function getDaysEpochMsec(days) {
  return days * 24 * 60 * 60 * 1000;
}

function getNodeUpdateStatus(node) {
  if (node.source !== "uploader") return "none";
  const updateEpoch = new Date(node.updated_date).getTime();
  if (updateEpoch < Date.now() - getDaysEpochMsec(20)) return "extinct";
  else if (updateEpoch < Date.now() - getDaysEpochMsec(10)) return "old";
  else if (updateEpoch < Date.now() - getDaysEpochMsec(5)) return "stale";

  return "recent";
}

// Update status descriptions (exact upstream - note: 'manualy' is typo in upstream)
const updateStatusDesc = {
  none: "manualy added",
  recent: "updated recently",
  stale: "updated while ago",
  old: "not updated",
  extinct: "will be deleted soon",
};

const deletionMailUrl = new URL("mailto:recrof@gmail.com");
deletionMailUrl.searchParams.append(
  "subject",
  "MeshCore Map node deletion request"
);
deletionMailUrl.searchParams.append(
  "body",
  "Please delete my node from MeshCore Map database\n" +
    "MeshCore link: <please insert meshcore:// link here>\n"
);

const appAttribution = `
	Original map by <a target="_blank" href="https://github.com/sponsors/recrof?frequency=one-time&sponsor=recrof"><strong>recrof</strong></a> | Modified by the <a target="_blank" href="https://github.com/radio-actief"><strong>Radio-Actief.be</strong></a> community
`;

const baseMapSelected =
  localStorage.getItem("baseMapSelected") || "OpenStreetMap";
const baseMaps = {
  OpenStreetMap: L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution: `Tiles: &copy; <a href="http://www.openstreetmap.org/copyright">OpenStreetMap</a> | ${appAttribution}`,
  }),
  "Esri Satellite": L.tileLayer(
    "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
    {
      maxZoom: 18,
      attribution: `Tiles: &copy; Esri | Sources: Esri, DigitalGlobe, GeoEye, i-cubed, USDA FSA, USGS, AEX, Getmapping, Aerogrid, IGN, IGP, swisstopo, GIS Users | ${appAttribution}`,
    }
  ),
};

let params = { lat: 50.75, lon: 4.471, zoom: 9 }; // Brussels, Belgium

const urlParams = Object.fromEntries(new URLSearchParams(location.search));
if (Number(urlParams.lat) && Number(urlParams.lon) && Number(urlParams.zoom)) {
  params = urlParams;
}

// console.log(params);

const map = (window.leafletMap = leaflet
  .map("map", {
    minZoom: 2,
    maxBounds: [
      [-90, -180], // top left
      [90, 200], // bottom right
    ],
    layers: baseMaps[baseMapSelected],
    zoomControl: false,
  })
  .setView([params.lat, params.lon], params.zoom));

map.on("baselayerchange", function (ev) {
  localStorage.setItem("baseMapSelected", ev.name);
});

L.control.layers(baseMaps, null, { position: "bottomleft" }).addTo(map);

// Footer (Website, Docs, Discord, GitHub) in Leaflet bottom-left, below the layers control
const FooterControl = L.Control.extend({
  onAdd: function () {
    const div = L.DomUtil.create("div", "app-footer leaflet-control");
    div.innerHTML = `
      <a href="https://radio-actief.be" class="app-footer-link" title="Radio-Actief website" target="_blank" rel="noopener noreferrer">
        <svg class="app-footer-icon" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><path d="${mdiWeb}" fill="currentColor"/></svg>
      </a>
      <a href="https://radioactief.axistem.eu" class="app-footer-link" title="Documentation" target="_blank" rel="noopener noreferrer">
        <svg class="app-footer-icon" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><path d="${mdiFileDocument}" fill="currentColor"/></svg>
      </a>
      <a href="https://discord.gg/kvybAgqnhD" class="app-footer-link" title="Join our Discord server" target="_blank" rel="noopener noreferrer">
        <img src="./img/discord-logo.svg" alt="Discord server">
      </a>
      <a href="https://github.com/radio-actief/RRY-Map-Bot" class="app-footer-link" title="Go to Radio-Actief GitHub repo" target="_blank" rel="noopener noreferrer">
        <img src="./lib/images/github-mark.svg" alt="GitHub">
      </a>
    `;
    return div;
  },
});
new FooterControl({ position: "bottomleft" }).addTo(map);

// map.zoomControl.setPosition('bottomleft');
// Icon structure: nested by update status, then by node type (upstream implementation)
const icons = Object.fromEntries(
  ["none", "recent", "stale", "old", "extinct"].map((color) => [
    color,
    Object.fromEntries(
      [1, 2, 3, 4].map((id) => [
        id,
        L.icon({
          iconUrl: `img/node_types/${id}.svg`,
          iconSize: [32, 32],
          iconAnchor: [17, 17],
          popupAnchor: [0, -16],
          className: `update-${color}`,
        }),
      ])
    ),
  ])
);

createApp({
  setup() {
    const app = (window.app = reactive({
      nodes: [],
      nodesByType: {},
      filteredNodes: [],
      search: "",
      cityFilter: "",
      nodeFilter: [],
      sourceFilter: ["discord", "app", "uploader"],
      claimedFilter: ["claimed", "unclaimed"],
      fromDate: "",
      clusteringZoom: 11,
      urlParams,
      loading: false,
    }));

    // Authentication state
    const auth = reactive({
      authenticated: false,
      user: null,
      loading: true,
    });

    // Check authentication status
    async function checkAuth() {
      try {
        const res = await fetch("/auth/me", { credentials: "include" });
        const data = await res.json();
        auth.authenticated = data.authenticated || false;
        auth.user = data.user || null;
      } catch (e) {
        console.error("Error checking auth:", e);
        auth.authenticated = false;
        auth.user = null;
      } finally {
        auth.loading = false;
      }
    }

    // Claim a node
    async function claimNode(publicKey) {
      if (!auth.authenticated) {
        // Redirect directly to login (alert would be invisible due to instant redirect)
        window.location.href = "/auth/login";
        return;
      }

      if (
        !confirm(
          "Claim this node?\n\nYou will become the owner and can edit its details."
        )
      ) {
        return;
      }

      try {
        const res = await fetch(`/api/v1/nodes/${publicKey}/claim`, {
          method: "POST",
          credentials: "include",
        });
        const data = await res.json();

        if (res.ok && data.success) {
          alert(
            "✓ Node claimed successfully!\n\nYou are now the owner of this node."
          );
          // Reload nodes to reflect changes
          await downloadNodes();
          refreshMap();
          // Update marker glows and any open popups
          app.nodes.forEach((node) => {
            // Update marker glow (claimed = yellow, user-owned = purple)
            if (node.marker) {
              const isOwned =
                auth.authenticated &&
                auth.user &&
                node.discord_owner_id &&
                String(node.discord_owner_id) === String(auth.user.id);
              const isClaimed = Boolean(node.discord_owner_id);

              const iconElement = node.marker._icon;
              if (iconElement) {
                if (isClaimed) iconElement.classList.add("claimed");
                else iconElement.classList.remove("claimed");
                if (isOwned) iconElement.classList.add("user-owned");
                else iconElement.classList.remove("user-owned");
              }
            }
            // Update popup
            if (node.popup && node.popup.isOpen()) {
              node.popup.setContent(getTable(node, auth));
            }
          });
        } else {
          // Handle specific error cases
          if (res.status === 403 && data.discord_invite_url) {
            const message = `⚠️ Discord Server Membership Required\n\n${data.error}\n\nTo claim nodes, you must be a member of our Discord server.\n\nAfter joining, please log out and log back in to refresh your membership status.`;
            if (confirm(message + "\n\nOpen Discord invite in a new tab?")) {
              window.open(data.discord_invite_url, "_blank");
            }
          } else {
            const errorMsg = data.error || "Failed to claim node";
            alert(
              `❌ Unable to Claim Node\n\n${errorMsg}\n\nPlease check that:\n• The node exists and is active\n• The node is not already claimed by someone else`
            );
          }
        }
      } catch (e) {
        console.error("Error claiming node:", e);
        const supportLink =
          "https://discord.com/channels/1391758345622257665/1454797139959091412";
        alert(
          `❌ Network Error\n\nUnable to claim node due to a connection error.\n\nIf this issue persists, please report it in our Discord support channel:\n${supportLink}`
        );
      }
    }

    // Unclaim a node
    async function unclaimNode(publicKey) {
      if (!auth.authenticated) {
        return;
      }

      if (
        !confirm(
          "Unclaim this node?\n\nYou will lose ownership and anyone will be able to claim it."
        )
      ) {
        return;
      }

      try {
        const res = await fetch(`/api/v1/nodes/${publicKey}/unclaim`, {
          method: "POST",
          credentials: "include",
        });
        const data = await res.json();

        if (res.ok && data.success) {
          alert(
            "✓ Node unclaimed successfully!\n\nThe node is now available for others to claim."
          );
          // Reload nodes to reflect changes
          await downloadNodes();
          refreshMap();
          // Update marker glows and any open popups
          app.nodes.forEach((node) => {
            // Update marker glow (claimed = yellow, user-owned = purple)
            if (node.marker) {
              const isOwned =
                auth.authenticated &&
                auth.user &&
                node.discord_owner_id &&
                String(node.discord_owner_id) === String(auth.user.id);
              const isClaimed = Boolean(node.discord_owner_id);

              const iconElement = node.marker._icon;
              if (iconElement) {
                if (isClaimed) iconElement.classList.add("claimed");
                else iconElement.classList.remove("claimed");
                if (isOwned) iconElement.classList.add("user-owned");
                else iconElement.classList.remove("user-owned");
              }
            }
            // Update popup
            if (node.popup && node.popup.isOpen()) {
              node.popup.setContent(getTable(node, auth));
            }
          });
        } else {
          const errorMsg = data.error || "Failed to unclaim node";
          if (data.error === "You do not own this node.") {
            alert(
              `❌ Ownership Error\n\n${errorMsg}\n\nYou can only unclaim nodes that you own.`
            );
          } else if (data.error === "Node not found.") {
            alert(
              `❌ Node Not Found\n\n${errorMsg}\n\nThe node may have been deleted or the identifier is incorrect.`
            );
          } else {
            alert(
              `❌ Unable to Unclaim Node\n\n${errorMsg}\n\nPlease try again or contact support if the issue persists.`
            );
          }
        }
      } catch (e) {
        console.error("Error unclaiming node:", e);
        const supportLink =
          "https://discord.com/channels/1391758345622257665/1454797139959091412";
        alert(
          `❌ Network Error\n\nUnable to unclaim node due to a connection error.\n\nIf this issue persists, please report it in our Discord support channel:\n${supportLink}`
        );
      }
    }

    // Check if user owns a node
    async function checkOwnership(publicKey) {
      if (!auth.authenticated) {
        return false;
      }

      try {
        const res = await fetch(`/api/v1/nodes/${publicKey}/ownership`, {
          credentials: "include",
        });
        const data = await res.json();
        return data.owned || false;
      } catch (e) {
        console.error("Error checking ownership:", e);
        return false;
      }
    }

    async function refreshMap({ clusteringZoom = 0 } = {}) {
      markerClusterGroup.clearLayers();
      const nodes =
        app.filteredNodes.length > 0 ? app.filteredNodes : app.nodes;

      map.removeLayer(markerClusterGroup);

      if (clusteringZoom) {
        markerClusterGroup = L.markerClusterGroup({
          disableClusteringAtZoom: clusteringZoom,
        });
      }

      for (const node of nodes) {
        // Only add markers that exist (nodes with valid coordinates have markers)
        if (node.marker) {
          markerClusterGroup.addLayer(toRaw(node.marker));
        }
      }

      map.addLayer(markerClusterGroup);

      // Update marker glows after markers are added to map
      setTimeout(() => {
        nodes.forEach((node) => {
          if (node.marker) {
            const isOwned =
              auth.authenticated &&
              auth.user &&
              node.discord_owner_id &&
              String(node.discord_owner_id) === String(auth.user?.id);

            const iconElement = node.marker._icon;
            if (iconElement) {
              const isClaimed = Boolean(node.discord_owner_id);
              if (isClaimed) iconElement.classList.add("claimed");
              else iconElement.classList.remove("claimed");
              if (isOwned) iconElement.classList.add("user-owned");
              else iconElement.classList.remove("user-owned");
            }
          }
        });
      }, 50);
    }

    function showNode(node) {
      if (!node.marker) {
        console.warn(
          `Cannot show node ${
            node.adv_name || node.public_key
          }: missing marker (no coordinates)`
        );
        return;
      }
      node.marker.openPopup();
      map.flyTo(node.marker.getLatLng(), 19);
      app.search = "";
    }

    function highlightString(source, toHighlight) {
      const escapedSource = source
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;");
      const matchIndex = source
        .toLowerCase()
        .indexOf(toHighlight.toLowerCase());
      const highlightString =
        matchIndex >= 0
          ? source.substring(matchIndex, matchIndex + toHighlight.length)
          : toHighlight;
      return escapedSource.replace(
        highlightString,
        `<b>${highlightString}</b>`
      );
    }

    function clearFilters() {
      app.nodeFilter = [1, 2, 3, 4];
      app.sourceFilter = ["discord", "app", "uploader"];
      app.claimedFilter = ["claimed", "unclaimed"];
      app.fromDate = "2025-03-01";
      app.cityFilter = "";
      app.clusteringZoom = 11;
      // Clear filtered nodes to show all nodes
      app.filteredNodes = [];
      // Clear URL parameters
      delete app.urlParams.nodes;
      delete app.urlParams.source;
      delete app.urlParams.claimed;
      delete app.urlParams.date;
      delete app.urlParams.city;
      app.urlParams.cluster = 11;
      // Refresh the map
      refreshMap({ clusteringZoom: 11 });
    }

    async function downloadNodes() {
      try {
        app.loading = true;
        const nodesReq = await fetch(apiUrl);
        app.nodes = await nodesReq.json();

        // Fetch presets from API (similar to upstream)
        getPresets()
          .then((presets) => {
            // Presets are now loaded and cached in FREQUENCY_PRESETS
            console.log("Presets ready:", presets.length);
          })
          .catch((err) => {
            console.warn("Preset loading error (using fallback):", err);
          });

        for (const node of app.nodes) {
          // Skip nodes without valid coordinates
          if (node.adv_lat == null || node.adv_lon == null) {
            console.warn(
              `Skipping node ${
                node.adv_name || node.public_key
              }: missing coordinates`
            );
            continue;
          }

          const updateStatus = getNodeUpdateStatus(node);
          let icon = icons[updateStatus][node.type.toString()];

          (app.nodesByType[node.type] ??= []).push(node);

          if (node.type === 1) {
            const label = ntools.getNameIconLabel(node.adv_name);
            const color = ntools.getColourForName(node.adv_name);
            icon = getSvgIconUrl(label, color);
          }

          // Check if node is owned by current user (purple glow) or claimed by anyone (yellow glow)
          const isOwned =
            auth.authenticated &&
            auth.user &&
            node.discord_owner_id &&
            String(node.discord_owner_id) === String(auth.user.id);
          const isClaimed = Boolean(node.discord_owner_id);

          // Store ownership status on node for later updates
          node.isOwned = isOwned;

          // Add className to icon for claimed (yellow) and/or user-owned (purple) glow
          if (isClaimed || isOwned) {
            const iconUrl = icon.options?.iconUrl || icon._iconUrl || "";
            const iconSize = icon.options?.iconSize ||
              icon._iconSize || [32, 32];
            const iconAnchor = icon.options?.iconAnchor ||
              icon._iconAnchor || [17, 17];
            const popupAnchor = icon.options?.popupAnchor ||
              icon._popupAnchor || [0, -16];
            const existingClassName = icon.options?.className || "";
            const extraClasses = [
              isClaimed ? "claimed" : "",
              isOwned ? "user-owned" : "",
            ]
              .filter(Boolean)
              .join(" ");
            const newClassName = existingClassName
              ? `${existingClassName} ${extraClasses}`.trim()
              : extraClasses;

            icon = L.icon({
              iconUrl: iconUrl,
              iconSize: iconSize,
              iconAnchor: iconAnchor,
              popupAnchor: popupAnchor,
              className: newClassName,
            });
          }

          const marker = (node.marker = L.marker([node.adv_lat, node.adv_lon], {
            icon,
            title: node.adv_name,
          }));

          node.status = updateStatus;
          node.coords = `${node.adv_lat.toFixed(4)}, ${node.adv_lon.toFixed(
            4
          )}`;
          node.lastAdvertDate = new Date(node.last_advert);
          node.insertDate = new Date(node.inserted_date);
          node.updatedDate = node.updated_date && new Date(node.updated_date);
          // Create popup - will be updated when auth state changes
          const popup = L.popup({
            minWidth: 350,
            maxWidth: 350,
            content: getTable(node, auth),
          });
          marker.bindPopup(popup);

          // Store reference to node for popup updates
          node.popup = popup;

          // Re-setup copy handlers when popup opens (for dynamically created content)
          marker.on("popupopen", function () {
            // Small delay to ensure popup content is in DOM
            setTimeout(() => {
              const popupContent = popup.getElement();
              if (popupContent) {
                const copyableElements =
                  popupContent.querySelectorAll(".copyable");
                copyableElements.forEach((el) => {
                  if (!el.hasAttribute("data-handler-setup")) {
                    el.setAttribute("data-handler-setup", "true");
                  }
                });
              }
            }, 100);
          });
        }

        // Update marker glows for claimed (yellow) and user-owned (purple) after all markers are created
        setTimeout(() => {
          app.nodes.forEach((node) => {
            if (node.marker) {
              const isOwned =
                auth.authenticated &&
                auth.user &&
                node.discord_owner_id &&
                String(node.discord_owner_id) === String(auth.user.id);
              const isClaimed = Boolean(node.discord_owner_id);

              const iconElement = node.marker._icon;
              if (iconElement) {
                if (isClaimed) {
                  iconElement.classList.add("claimed");
                } else {
                  iconElement.classList.remove("claimed");
                }
                if (isOwned) {
                  iconElement.classList.add("user-owned");
                } else {
                  iconElement.classList.remove("user-owned");
                }
              }
            }
          });
        }, 100);
      } catch (e) {
        console.error("Error loading map nodes:", e);
        const supportLink =
          "https://discord.com/channels/1391758345622257665/1454797139959091412";
        alert(
          `❌ Failed to Load Map Data\n\nUnable to load nodes from the server.\n\nError: ${
            e.message || e
          }\n\nIf this issue persists, please report it in our Discord support channel:\n${supportLink}`
        );
      } finally {
        app.loading = false;
      }
    }

    clearFilters();

    const filtersActive = computed(
      () =>
        app.filteredNodes.length &&
        app.nodes.length !== app.filteredNodes.length
    );

    watch(
      [
        () => app.nodeFilter,
        () => app.sourceFilter,
        () => app.claimedFilter,
        () => app.fromDate,
        () => app.cityFilter,
      ],
      () => {
        const fromDate = new Date(app.fromDate);
        const cityFilterLower = app.cityFilter.toLowerCase().trim();
        app.filteredNodes = app.nodeFilter
          .flatMap((type) => app.nodesByType[type])
          .filter(
            (node) =>
              node &&
              (node.updatedDate
                ? node.updatedDate > fromDate
                : node.insertDate > fromDate) &&
              (!cityFilterLower ||
                (node.city &&
                  node.city.toLowerCase().includes(cityFilterLower))) &&
              (app.sourceFilter.length === 0 ||
                (node.source &&
                  (app.sourceFilter.includes(node.source.toLowerCase()) ||
                    (app.sourceFilter.includes("app") &&
                      (node.source.toLowerCase() === "app" ||
                        node.source.toLowerCase() === "web"))))) &&
              (app.claimedFilter.length === 0 ||
                (app.claimedFilter.includes("claimed") &&
                  node.discord_owner_name &&
                  node.discord_owner_name.trim() !== "") ||
                (app.claimedFilter.includes("unclaimed") &&
                  (!node.discord_owner_name ||
                    node.discord_owner_name.trim() === "")))
          );
        console.log(
          "refresh",
          app.nodeFilter,
          app.sourceFilter,
          app.claimedFilter,
          app.filteredNodes.length
        );
        app.urlParams.nodes = app.nodeFilter.join(",");
        app.urlParams.date = app.fromDate;
        if (app.cityFilter) {
          app.urlParams.city = app.cityFilter;
        } else {
          delete app.urlParams.city;
        }
        if (app.sourceFilter.length > 0) {
          app.urlParams.source = app.sourceFilter.join(",");
        } else {
          delete app.urlParams.source;
        }
        if (app.claimedFilter.length > 0) {
          app.urlParams.claimed = app.claimedFilter.join(",");
        } else {
          delete app.urlParams.claimed;
        }
        refreshMap({ download: false });
      }
    );

    watch(
      () => app.clusteringZoom,
      () => {
        app.urlParams.cluster = app.clusteringZoom;
        refreshMap({ download: false, clusteringZoom: app.clusteringZoom });
      }
    );

    const stats = computed(() => {
      const nodes = app.nodes;

      if (!nodes) return [];

      const result = [];

      // Count nodes by type
      const companionsCount = nodes.filter((n) => n.type === 1).length;
      const repeatersCount = nodes.filter((n) => n.type === 2).length;
      const roomServersCount = nodes.filter((n) => n.type === 3).length;
      const sensorsCount = nodes.filter((n) => n.type === 4).length;

      // Build stats string
      let statsString = `<span>all nodes: <b>${nodes.length}</b></span>&nbsp;|`;
      statsString += ` <i class="node-type pointer-help" title="Total client nodes">person</i><b>${companionsCount}</b>&nbsp;|`;
      statsString += ` <i class="node-type pointer-help" title="Total repeater nodes">cell_tower</i><b>${repeatersCount}</b>&nbsp;|`;
      statsString += ` <i class="node-type pointer-help" title="Total room server nodes">forum</i><b>${roomServersCount}</b>`;

      // Add sensors only if count > 0
      if (sensorsCount > 0) {
        statsString += `&nbsp;| <img src="img/node_types/4.svg" class="node-type pointer-help" style="width: 24px; height: 24px; vertical-align: middle; margin-left: 7px; margin-right: 4px;" title="Total sensor nodes" alt="Sensor"><b>${sensorsCount}</b>`;
      }

      result.push(statsString);
      // Count nodes active in last 24 hours (based on most recent date)
      const active24h = app.nodes.filter((n) => {
        const mostRecent = getMostRecentDate(n);
        return mostRecent && isNewerThan(mostRecent, 1);
      }).length;
      result.push(
        `<span class="pointer-help" title="Devices active in last 24 hours">24h: <b>${active24h}</b></span>`
      );

      // Count nodes active in last 7 days (based on most recent date)
      const active7d = app.nodes.filter((n) => {
        const mostRecent = getMostRecentDate(n);
        return mostRecent && isNewerThan(mostRecent, 7);
      }).length;
      result.push(
        `<span class="pointer-help" title="Devices active in last 7 days">7d: <b>${active7d}</b></span>`
      );

      // Count nodes active in last 30 days (based on most recent date)
      const active30d = app.nodes.filter((n) => {
        const mostRecent = getMostRecentDate(n);
        return mostRecent && isNewerThan(mostRecent, 30);
      }).length;
      result.push(
        `<span class="pointer-help" title="Devices active in last 30 days">30d: <b>${active30d}</b></span>`
      );

      return result;
    });

    // Personal stats for logged-in user
    const personalStats = computed(() => {
      if (!auth.authenticated || !auth.user) {
        return [];
      }

      // Filter nodes owned by current user
      const userNodes = app.nodes.filter(
        (node) =>
          node.discord_owner_id &&
          String(node.discord_owner_id) === String(auth.user.id)
      );

      if (userNodes.length === 0) {
        return [
          `<span class="pointer-help" title="Your owned nodes">my nodes: <b>0</b></span>`,
        ];
      }

      const result = [];

      // Count nodes by type
      const companionsCount = userNodes.filter((n) => n.type === 1).length;
      const repeatersCount = userNodes.filter((n) => n.type === 2).length;
      const roomServersCount = userNodes.filter((n) => n.type === 3).length;
      const sensorsCount = userNodes.filter((n) => n.type === 4).length;

      // Build personal stats string (black color, not green)
      let statsString = `<span class="pointer-help" title="Your owned nodes">my nodes: <b>${userNodes.length}</b></span>&nbsp;|`;
      if (companionsCount > 0) {
        statsString += ` <i class="node-type pointer-help" title="Your client nodes">person</i><b>${companionsCount}</b>`;
      }
      if (repeatersCount > 0) {
        statsString += `&nbsp;| <i class="node-type pointer-help" title="Your repeater nodes">cell_tower</i><b>${repeatersCount}</b>`;
      }
      if (roomServersCount > 0) {
        statsString += `&nbsp;| <i class="node-type pointer-help" title="Your room server nodes">forum</i><b>${roomServersCount}</b>`;
      }
      if (sensorsCount > 0) {
        statsString += `&nbsp;| <img src="img/node_types/4.svg" class="node-type pointer-help" style="width: 24px; height: 24px; vertical-align: middle; margin-left: 7px; margin-right: 4px;" title="Your sensor nodes" alt="Sensor"><b>${sensorsCount}</b>`;
      }

      result.push(statsString);

      // Count user's nodes active in last 24 hours, 7 days, and 30 days
      const active24h = userNodes.filter((n) => {
        const mostRecent = getMostRecentDate(n);
        return mostRecent && isNewerThan(mostRecent, 1);
      }).length;

      const active7d = userNodes.filter((n) => {
        const mostRecent = getMostRecentDate(n);
        return mostRecent && isNewerThan(mostRecent, 7);
      }).length;

      const active30d = userNodes.filter((n) => {
        const mostRecent = getMostRecentDate(n);
        return mostRecent && isNewerThan(mostRecent, 30);
      }).length;

      // Show stats only if > 0 (hide if 0)
      if (active24h > 0) {
        result.push(
          `<span class="pointer-help" title="Your nodes active in last 24 hours">24h: <b>${active24h}</b></span>`
        );
      }

      if (active7d > 0) {
        result.push(
          `<span class="pointer-help" title="Your nodes active in last 7 days">7d: <b>${active7d}</b></span>`
        );
      }

      if (active30d > 0) {
        result.push(
          `<span class="pointer-help" title="Your nodes active in last 30 days">30d: <b>${active30d}</b></span>`
        );
      }

      return result;
    });

    const searchResults = computed(() => {
      if (!app.search) {
        return [];
      }

      // Search through all nodes, not just filtered ones
      const searchTerm = app.search.toLowerCase();
      return app.nodes
        .filter((node) => {
          // Search by node name
          if (node.adv_name?.toLowerCase().includes(searchTerm)) {
            return true;
          }
          // Search by public key (substring match, not just prefix)
          if (node.public_key?.toLowerCase().includes(searchTerm)) {
            return true;
          }
          // Search by city
          if (node.city?.toLowerCase().includes(searchTerm)) {
            return true;
          }
          // Search by Discord owner name
          if (node.discord_owner_name?.toLowerCase().includes(searchTerm)) {
            return true;
          }
          return false;
        })
        .toSorted((a, b) => a.adv_name.localeCompare(b.adv_name))
        .slice(0, 20);
    });

    let markerClusterGroup = L.markerClusterGroup({
      disableClusteringAtZoom: app.clusteringZoom,
    });

    watch(
      () => app.urlParams,
      () => {
        history.replaceState({}, "", `/?${new URLSearchParams(app.urlParams)}`);
      },
      { deep: true }
    );

    map.on("moveend", function (e) {
      const pos = map.getCenter();
      const zoom = map.getZoom();
      app.urlParams.zoom = zoom;
      app.urlParams.lat = pos.lat.toFixed(4);
      app.urlParams.lon = pos.lng.toFixed(4);
    });

    // Expose functions globally for onclick handlers
    window.claimNode = claimNode;
    window.unclaimNode = unclaimNode;

    // Function to adjust search field position based on stats bar height (mobile only)
    function adjustSearchPosition() {
      const searchField = document.querySelector(".search");
      if (!searchField) return;
      if (window.innerWidth > 768) {
        searchField.style.removeProperty("top");
        return;
      }
      const statsBar = document.querySelector(".stats");
      if (!statsBar) return;
      const statsHeight = statsBar.offsetHeight;
      // Only set top when we have a real height; otherwise keep CSS fallback to avoid search above bar on init
      if (statsHeight > 0) {
        searchField.style.top = `${statsHeight + 4}px`;
      } else {
        searchField.style.removeProperty("top");
      }
    }

    let resizeObserver = null;

    onMounted(() => {
      window.addEventListener("resize", adjustSearchPosition);

      // Run after layout so stats bar has its height (fixes mobile init: search was above top bar)
      nextTick(() => {
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            adjustSearchPosition();
          });
        });
      });

      // When stats bar height changes (e.g. auth loads, second row appears), update search position
      const statsBar = document.querySelector(".stats");
      if (statsBar && typeof ResizeObserver !== "undefined") {
        resizeObserver = new ResizeObserver(() => adjustSearchPosition());
        resizeObserver.observe(statsBar);
      }

      // Also adjust when auth state changes (affects stats bar height)
      watch(
        () => auth.authenticated,
        () => {
          nextTick(() => requestAnimationFrame(adjustSearchPosition));
        }
      );

      // Check for URL parameters indicating errors
      const urlParams = new URLSearchParams(window.location.search);
      const error = urlParams.get("error");
      const inviteUrl = urlParams.get("invite_url");

      if (error === "not_guild_member" && inviteUrl) {
        const message =
          "⚠️ Discord Server Membership Required\n\nTo claim nodes, you must be a member of our Discord server.\n\nAfter joining, please log out and log back in to refresh your membership status.";
        if (confirm(message + "\n\nOpen Discord invite in a new tab?")) {
          window.open(inviteUrl, "_blank");
        }
        // Clean up URL
        window.history.replaceState(
          {},
          document.title,
          window.location.pathname
        );
      }

      // Check authentication status first
      checkAuth().then(() => {
        // Watch for auth changes and update popups and markers
        watch(
          () => auth.authenticated,
          () => {
            // Update all open popups when auth state changes
            app.nodes.forEach((node) => {
              if (node.popup && node.popup.isOpen()) {
                node.popup.setContent(getTable(node, auth));
              }

              // Update marker glow (claimed = yellow, user-owned = purple)
              if (node.marker) {
                const isOwned =
                  auth.authenticated &&
                  auth.user &&
                  node.discord_owner_id &&
                  String(node.discord_owner_id) === String(auth.user.id);
                const isClaimed = Boolean(node.discord_owner_id);

                const iconElement = node.marker._icon;
                if (iconElement) {
                  if (isClaimed) iconElement.classList.add("claimed");
                  else iconElement.classList.remove("claimed");
                  if (isOwned) iconElement.classList.add("user-owned");
                  else iconElement.classList.remove("user-owned");
                }
              }
            });
          }
        );

        // Also watch for user changes (in case user ID changes)
        watch(
          () => auth.user?.id,
          () => {
            // Update marker glows when user changes
            app.nodes.forEach((node) => {
              if (node.marker) {
                const isOwned =
                  auth.authenticated &&
                  auth.user &&
                  node.discord_owner_id &&
                  String(node.discord_owner_id) === String(auth.user?.id);
                const isClaimed = Boolean(node.discord_owner_id);

                const iconElement = node.marker._icon;
                if (iconElement) {
                  if (isClaimed) iconElement.classList.add("claimed");
                  else iconElement.classList.remove("claimed");
                  if (isOwned) iconElement.classList.add("user-owned");
                  else iconElement.classList.remove("user-owned");
                }
              }
            });
          }
        );
      });

      downloadNodes().then(() => {
        if (urlParams.nodes) {
          app.nodeFilter = urlParams.nodes.split(",");
        }
        if (urlParams.date) {
          app.fromDate = urlParams.date;
        }
        if (urlParams.cluster) {
          app.clusteringZoom = urlParams.cluster;
        }
        if (urlParams.city) {
          app.cityFilter = urlParams.city;
        }
        if (urlParams.source) {
          app.sourceFilter = urlParams.source.split(",");
        }
        if (urlParams.claimed) {
          app.claimedFilter = urlParams.claimed.split(",");
        }
        refreshMap();
      });

      // Fix: Prevent menu from closing when clicking on input fields
      // This fixes the bug where clicking on city filter jumps to date field
      const menu = document.getElementById("node-filter");
      if (menu) {
        // Prevent clicks inside menu from closing it, but allow buttons to work
        const stopMenuClose = (e) => {
          // Allow button clicks to work normally
          if (e.target.tagName === "BUTTON" || e.target.closest("button")) {
            return; // Don't stop propagation for buttons
          }
          // Stop propagation for input fields and their containers
          if (e.target.tagName === "INPUT" || e.target.closest(".field")) {
            e.stopPropagation();
            e.stopImmediatePropagation();
          }
        };

        menu.addEventListener("click", stopMenuClose, true); // Use capture phase
        menu.addEventListener("mousedown", stopMenuClose, true);
        menu.addEventListener("mouseup", stopMenuClose, true);

        // Specifically handle city input - ensure it gets focus on click
        const cityInput = document.getElementById("city-filter-input");
        if (cityInput) {
          // Handle click with higher priority
          cityInput.addEventListener(
            "click",
            (e) => {
              e.stopPropagation();
              e.stopImmediatePropagation();
              // Immediately focus the input
              cityInput.focus();
            },
            true
          ); // Capture phase - runs before other handlers

          cityInput.addEventListener(
            "mousedown",
            (e) => {
              e.stopPropagation();
              e.stopImmediatePropagation();
              // Focus on mousedown (before click)
              setTimeout(() => {
                cityInput.focus();
              }, 0);
            },
            true
          );

          // Also handle focus event to prevent it from being stolen
          cityInput.addEventListener("focus", (e) => {
            e.stopPropagation();
          });
        }

        // Also handle date input to prevent it from stealing focus
        const dateInput = menu.querySelector('input[type="date"]');
        if (dateInput) {
          dateInput.addEventListener("focus", (e) => {
            // Only allow focus if city input is not being clicked
            const cityInput = document.getElementById("city-filter-input");
            if (cityInput && cityInput === document.activeElement) {
              // Don't steal focus from city input
              return;
            }
          });
        }
      }
    });

    onBeforeUnmount(() => {
      window.removeEventListener("resize", adjustSearchPosition);
      if (resizeObserver) {
        resizeObserver.disconnect();
        resizeObserver = null;
      }
    });

    window.refreshMap = refreshMap;
    return {
      app,
      auth,
      refreshMap,
      stats,
      personalStats,
      searchResults,
      filtersActive,
      showNode,
      highlightString,
      clearFilters,
      checkAuth,
      claimNode,
      unclaimNode,
      mdiChartLine,
      mdiLogout,
      mdiCounter,
    };
  },
}).mount("#app");
