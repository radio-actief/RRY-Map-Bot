import {
  createApp,
  reactive,
  ref,
  computed,
  watch,
  onMounted,
  toRaw,
} from "../lib/vue.esm-browser.js";
import * as ntools from "./node-utils.js";
const apiUrl = "/api/v1/belgian-nodes";

const types = {
  1: "Client",
  2: "Repeater",
  3: "Room Server",
  4: "Sensor",
};

// Frequency Presets (matching backend config)
const FREQUENCY_PRESETS = [
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

// Format date as relative time (e.g., "5 days ago", "3 hours ago", "45 minutes ago")
function formatRelativeTime(dateString) {
  if (!dateString) return "N/A";

  const date = new Date(dateString);
  if (isNaN(date.getTime())) return "Invalid date";

  const now = new Date();
  const diffMs = now - date;

  // Handle future dates or very recent dates
  if (diffMs < 0) {
    // Future date - show as "in X time" or just show the date
    const fullDate = date.toLocaleString();
    const escapedFullDate = fullDate
      .replace(/&/g, "&amp;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
    return `<time title="${escapedFullDate}">${fullDate}</time>`;
  }

  const diffMinutes = Math.floor(diffMs / (1000 * 60));
  const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  let relativeText;
  if (diffMinutes < 1) {
    // Less than 1 minute: show "just now"
    relativeText = "just now";
  } else if (diffMinutes < 90) {
    // Less than 90 minutes: show minutes
    relativeText = `${diffMinutes} minute${diffMinutes !== 1 ? "s" : ""} ago`;
  } else if (diffHours < 24) {
    // Less than 1 day: show hours
    relativeText = `${diffHours} hour${diffHours !== 1 ? "s" : ""} ago`;
  } else {
    // 1 day or more: show days
    relativeText = `${diffDays} day${diffDays !== 1 ? "s" : ""} ago`;
  }

  // Full date/time for title attribute
  const fullDate = date.toLocaleString();

  // Escape HTML for title attribute
  const escapedFullDate = fullDate
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

  return `<time title="${escapedFullDate}">${relativeText}</time>`;
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
  "public_key",
  "type",
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

function getTable(node) {
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

      // Build footer with links
      let footerLinks = [];

      // Always show Analyzer link
      footerLinks.push(
        `<a href="${analyzerUrl}" target="_blank" rel="noopener noreferrer" style="color: #4CAF50; text-decoration: none; font-size: 0.75em;">
          <strong>Analyzer</strong>
        </a>`
      );

      // Add Claim link if unclaimed
      if (isUnclaimed) {
        footerLinks.push(
          `<a href="${discordServerUrl}" target="_blank" rel="noopener noreferrer" style="color: ${discordColor}; text-decoration: none; font-size: 0.75em;">
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
        const publicKey = node.public_key || "";
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
	App: recrof, <a target="_blank" href="https://www.paypal.com/donate/?business=DREHF5HM265ES&no_recurring=0&item_name=If+you+enjoy+my+work%2C+you+can+support+me+here%3A&currency_code=EUR">
	<strong>support my work</strong></a> |
	<a target="_blank" href="${deletionMailUrl
    .toString()
    .replaceAll("+", "%20")}"><strong>Node deletion request</strong></a>
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

let params = { lat: 50.75, lon: 4.471, zoom: 8 }; // Brussels, Belgium

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

// map.zoomControl.setPosition('bottomleft');
const icons = Object.fromEntries(
  [1, 2, 3, 4].map((id) => [
    id,
    L.icon({
      iconUrl: `img/node_types/${id}.svg`,
      iconSize: [32, 32],
      iconAnchor: [17, 17],
      popupAnchor: [0, -16],
    }),
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
      fromDate: "",
      clusteringZoom: 5,
      urlParams,
    }));

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
      app.fromDate = "2025-03-01";
      app.cityFilter = "";
      app.clusteringZoom = 5;
    }

    async function downloadNodes() {
      const nodesReq = await fetch(apiUrl);
      app.nodes = await nodesReq.json();
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

        let icon = icons[node.type.toString()];
        (app.nodesByType[node.type] ??= []).push(node);

        if (node.type === 1) {
          const label = ntools.getNameIconLabel(node.adv_name);
          const color = ntools.getColourForName(node.adv_name);
          icon = getSvgIconUrl(label, color);
        }

        const marker = (node.marker = L.marker([node.adv_lat, node.adv_lon], {
          icon,
          title: node.adv_name,
        }));

        node.coords = `${node.adv_lat.toFixed(4)}, ${node.adv_lon.toFixed(4)}`;
        node.lastAdvertDate = new Date(node.last_advert);
        node.insertDate = new Date(node.inserted_date);
        node.updatedDate = node.updated_date && new Date(node.updated_date);
        const popup = L.popup({
          minWidth: 350,
          maxWidth: 350,
          content: getTable(node),
        });
        marker.bindPopup(popup);

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
    }

    clearFilters();

    const filtersActive = computed(
      () =>
        app.filteredNodes.length &&
        app.nodes.length !== app.filteredNodes.length
    );

    watch(
      [() => app.nodeFilter, () => app.fromDate, () => app.cityFilter],
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
                  node.city.toLowerCase().includes(cityFilterLower)))
          );
        console.log("refresh", app.nodeFilter, app.filteredNodes.length);
        app.urlParams.nodes = app.nodeFilter.join(",");
        app.urlParams.date = app.fromDate;
        if (app.cityFilter) {
          app.urlParams.city = app.cityFilter;
        } else {
          delete app.urlParams.city;
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
      let statsString = `<span>total: <b>${nodes.length}</b></span>&nbsp;|`;
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

    onMounted(() => {
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
        refreshMap();
      });
    });

    window.refreshMap = refreshMap;
    return {
      app,
      refreshMap,
      stats,
      searchResults,
      filtersActive,
      showNode,
      highlightString,
      clearFilters,
    };
  },
}).mount("#app");
