import {
  createApp,
  reactive,
  computed,
  watch,
  onMounted,
  onBeforeUnmount,
  nextTick,
  markRaw,
  shallowRef,
} from "../lib/vue.esm-browser.prod.js";
import * as ntools from "./node-utils.js";

// MDI paths (same as @mdi/js – use with Vue :d="mdiChartLine" etc.)
const mdiChartLine =
  "M16,11.78L20.24,4.45L21.97,5.45L16.74,14.5L10.23,10.75L5.46,19H22V21H2V3H4V17.54L9.5,8L16,11.78Z";
const mdiLogout =
  "M17 7L15.59 8.41L18.17 11H8V13H18.17L15.59 15.58L17 17L22 12M4 5H12V3H4C2.9 3 2 3.9 2 5V19C2 20.1 2.9 21 4 21H12V19H4V5Z";
const mdiCounter =
  "M4,4H20A2,2 0 0,1 22,6V18A2,2 0 0,1 20,20H4A2,2 0 0,1 2,18V6A2,2 0 0,1 4,4M4,6V18H11V6H4M20,18V6H18.76C19,6.54 18.95,7.07 18.95,7.13C18.88,7.8 18.41,8.5 18.24,8.75L15.91,11.3L19.23,11.28L19.24,12.5L14.04,12.47L14,11.47C14,11.47 17.05,8.24 17.2,7.95C17.34,7.67 17.91,6 16.5,6C15.27,6.05 15.41,7.3 15.41,7.3L13.87,7.31C13.87,7.31 13.88,6.65 14.25,6H13V18H15.58L15.57,17.14L16.54,17.13C16.54,17.13 17.45,16.97 17.46,16.08C17.5,15.08 16.65,15.08 16.5,15.08C16.37,15.08 15.43,15.13 15.43,15.95H13.91C13.91,15.95 13.95,13.89 16.5,13.89C19.1,13.89 18.96,15.91 18.96,15.91C18.96,15.91 19,17.16 17.85,17.63L18.37,18H20M8.92,16H7.42V10.2L5.62,10.76V9.53L8.76,8.41H8.92V16Z";
const mdiOpenInNew =
  "M19 19H5V5h7V3H5c-1.11 0-2 .9-2 2v14c0 1.1.89 2 2 2h14c1.1 0 2-.9 2-2v-7h-2v7zM14 3v2h3.59l-9.83 9.83 1.41 1.41L19 6.41V10h2V3h-7z";
const apiUrl = "/api/v1/belgian-nodes";

function normalizePubKeyForCompare(key) {
  return (key || "").toLowerCase().replace(/\s/g, "");
}

function formatInserterUpdater(
  val,
  nodes = [],
  currentNode = null,
  copyRole = "inserter",
) {
  if (!val) return "N/A";
  const copyTitle =
    copyRole === "updater"
      ? "Copy updater public key"
      : "Copy inserter public key";
  const copyable = createCopyableElement(
    val,
    shortenForDisplay(val.toUpperCase(), 18),
    { copyTitle },
  );
  const k = normalizePubKeyForCompare(val);
  const isSameNode =
    currentNode && normalizePubKeyForCompare(currentNode.public_key) === k;
  const inDb =
    !isSameNode &&
    nodes.some((n) => normalizePubKeyForCompare(n.public_key) === k);
  const gotoLink = inDb
    ? ` <a class="node-popup__map-jump" href="?node=${encodeURIComponent(val)}" title="Go to node on map" aria-label="Go to node on map"><svg width="14" height="14" viewBox="0 0 24 24" aria-hidden="true"><path d="${mdiOpenInNew}" fill="currentColor"/></svg></a>`
    : "";
  return copyable + gotoLink;
}

const types = {
  1: "Client",
  2: "Repeater",
  3: "Room Server",
  4: "Sensor",
};

/** Material Symbols ligatures (Beer.css / map page font). */
function getNodeTypeMeta(node) {
  const raw = parseInt(String(node?.type ?? 1), 10);
  const typeNum = Number.isFinite(raw) && raw >= 1 && raw <= 4 ? raw : 1;
  const iconByType = {
    1: "smartphone",
    2: "hub",
    3: "groups",
    4: "sensors",
  };
  return {
    typeNum,
    icon: iconByType[typeNum] || iconByType[1],
    label: types[typeNum] || types[1],
  };
}

/** Material icon + tooltip for map node `source`; shown in popup header (right). */
function getNodeSourceHeaderMeta(node) {
  const raw = node?.source;
  if (raw == null || String(raw).trim() === "") return null;
  const lowerVal = String(raw).toLowerCase().trim();
  const safeClass = /^[a-z0-9_-]+$/.test(lowerVal) ? lowerVal : "other";
  let tooltipText = "";
  let icon = "label";
  /** Optional link (e.g. uploader repo), same as table column. */
  let href = null;

  if (lowerVal === "uploader") {
    tooltipText = "Uploader: Auto-uploaded via MeshCore map uploader tool";
    icon = "cloud_upload";
  } else if (lowerVal === "app") {
    tooltipText = "App: Added via a MeshCore app";
    icon = "apps";
  } else if (lowerVal === "web") {
    tooltipText = "Web: Added via legacy official map";
    icon = "language";
  } else if (lowerVal === "discord") {
    tooltipText = "Discord: Added via Discord";
    icon = "forum";
  } else {
    const cap = lowerVal.charAt(0).toUpperCase() + lowerVal.slice(1);
    tooltipText = `Source: ${cap}`;
    icon = "database";
  }

  return { safeClass, icon, tooltipText, href };
}

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

/** Flash `<i>check</i> Copied!` inside `.node-qr-card__field-text` when present (else whole `node-popup__pk-wrap`). */
function copyToClipboardWithQrWrapFeedback(text, wrapEl) {
  if (text == null || text === "") return;
  const plain = String(text);
  const doFlash = (ok) => {
    if (!wrapEl) return;
    const fieldEl =
      wrapEl.querySelector?.(".node-qr-card__field-text") || wrapEl;
    const original = fieldEl.innerHTML;
    const inlineCls = fieldEl.classList.contains("node-qr-card__field-text")
      ? " node-qr-wrap-feedback--inline"
      : "";
    const inner = ok
      ? `<span class="node-qr-wrap-feedback node-qr-wrap-feedback--ok${inlineCls}"><i aria-hidden="true">check</i> Copied!</span>`
      : `<span class="node-qr-wrap-feedback node-qr-wrap-feedback--err${inlineCls}"><i aria-hidden="true">error</i> Failed</span>`;
    let frozenH = null;
    if (fieldEl.classList.contains("node-qr-card__field-text")) {
      frozenH = fieldEl.getBoundingClientRect().height;
      fieldEl.style.height = `${frozenH}px`;
      fieldEl.style.boxSizing = "border-box";
    }
    fieldEl.innerHTML = inner;
    clearTimeout(fieldEl._qrFieldFlashTimer);
    fieldEl._qrFieldFlashTimer = setTimeout(() => {
      fieldEl.innerHTML = original;
      if (frozenH != null) {
        fieldEl.style.height = "";
        fieldEl.style.boxSizing = "";
      }
    }, 2500);
  };
  navigator.clipboard
    .writeText(plain)
    .then(() => doFlash(true))
    .catch((err) => {
      console.error("Failed to copy:", err);
      doFlash(false);
    });
}

// Copy via PointerEvent (Firefox deprecates reading MouseEvent.mozInputSource on
// legacy click paths; pointerup uses PointerEvent.pointerType). Capture phase
// so Leaflet popup stopPropagation on bubble still sees this first.
function setupCopyHandlers() {
  function handleCopyPointer(e) {
    if (!e.isPrimary) return;
    if (e.pointerType === "mouse" && e.button !== 0) return;
    const copyEl = e.target?.closest?.(".copyable");
    if (!copyEl) return;
    const text = copyEl.getAttribute("data-copy");
    if (!text) return;
    e.preventDefault();
    e.stopPropagation();
    copyToClipboard(text, copyEl);
  }

  if (typeof PointerEvent !== "undefined") {
    document.addEventListener("pointerup", handleCopyPointer, {
      capture: true,
    });
  } else {
    document.addEventListener(
      "click",
      function (e) {
        const copyEl = e.target?.closest?.(".copyable");
        if (!copyEl) return;
        const text = copyEl.getAttribute("data-copy");
        if (!text) return;
        e.preventDefault();
        e.stopPropagation();
        copyToClipboard(text, copyEl);
      },
      true,
    );
  }
}

function nodeQrCardCopyFromEvent(card, link) {
  const wrap = card.querySelector(".node-qr-card__footer .node-popup__pk-wrap");
  copyToClipboardWithQrWrapFeedback(link, wrap);
}

function getMeshcoreLinkToCopyFromQrCard(card) {
  const packed = card?.getAttribute?.("data-meshcore-copy")?.trim();
  if (packed) return packed;
  const slot = card?.querySelector?.(".node-qr-slot[data-meshcore-link]");
  return slot?.getAttribute("data-meshcore-link")?.trim() || "";
}

function setupNodeQrCardHandlers() {
  function onPointerUp(e) {
    if (!e.isPrimary) return;
    if (e.pointerType === "mouse" && e.button !== 0) return;
    const card = e.target.closest?.(".node-qr-card");
    if (!card) return;
    if (e.target.closest?.(".node-qr-card__header")) {
      const pk = card.getAttribute("data-public-key")?.trim();
      if (!pk) return;
      const wrap = card.querySelector(
        ".node-qr-card__header .node-popup__pk-wrap",
      );
      if (!wrap) return;
      e.preventDefault();
      e.stopPropagation();
      copyToClipboardWithQrWrapFeedback(pk, wrap);
      return;
    }
    if (e.target.closest?.(".node-qr-card__footer")) {
      const link = getMeshcoreLinkToCopyFromQrCard(card);
      if (!link) return;
      const wrap = card.querySelector(
        ".node-qr-card__footer .node-popup__pk-wrap",
      );
      if (!wrap) return;
      e.preventDefault();
      e.stopPropagation();
      copyToClipboardWithQrWrapFeedback(link, wrap);
      return;
    }
    if (!e.target.closest?.(".node-qr-card__inner")) return;
    const slotEl = e.target.closest?.(".node-qr-slot");
    if (slotEl) {
      const uri = slotEl.getAttribute("data-meshcore-link")?.trim();
      if (!uri) return;
      e.preventDefault();
      e.stopPropagation();
      void openQrEnlargeOverlay(slotEl, uri);
      return;
    }
    const link = getMeshcoreLinkToCopyFromQrCard(card);
    if (!link) return;
    e.preventDefault();
    e.stopPropagation();
    nodeQrCardCopyFromEvent(card, link);
  }

  if (typeof PointerEvent !== "undefined") {
    document.addEventListener("pointerup", onPointerUp, { capture: true });
  } else {
    document.addEventListener(
      "click",
      (e) => {
        const card = e.target.closest?.(".node-qr-card");
        if (!card) return;
        if (e.target.closest?.(".node-qr-card__header")) {
          const pk = card.getAttribute("data-public-key")?.trim();
          if (!pk) return;
          const wrap = card.querySelector(
            ".node-qr-card__header .node-popup__pk-wrap",
          );
          if (!wrap) return;
          e.preventDefault();
          e.stopPropagation();
          copyToClipboardWithQrWrapFeedback(pk, wrap);
          return;
        }
        if (e.target.closest?.(".node-qr-card__footer")) {
          const link = getMeshcoreLinkToCopyFromQrCard(card);
          if (!link) return;
          const wrap = card.querySelector(
            ".node-qr-card__footer .node-popup__pk-wrap",
          );
          if (!wrap) return;
          e.preventDefault();
          e.stopPropagation();
          copyToClipboardWithQrWrapFeedback(link, wrap);
          return;
        }
        if (!e.target.closest?.(".node-qr-card__inner")) return;
        const slotEl = e.target.closest?.(".node-qr-slot");
        if (slotEl) {
          const uri = slotEl.getAttribute("data-meshcore-link")?.trim();
          if (!uri) return;
          e.preventDefault();
          e.stopPropagation();
          void openQrEnlargeOverlay(slotEl, uri);
          return;
        }
        const link = getMeshcoreLinkToCopyFromQrCard(card);
        if (!link) return;
        e.preventDefault();
        e.stopPropagation();
        nodeQrCardCopyFromEvent(card, link);
      },
      true,
    );
  }

  document.addEventListener(
    "keydown",
    (e) => {
      if (e.key !== "Enter" && e.key !== " ") return;
      const el = document.activeElement;
      if (!el?.classList?.contains?.("node-qr-card")) return;
      const link = getMeshcoreLinkToCopyFromQrCard(el);
      if (!link) return;
      e.preventDefault();
      e.stopPropagation();
      nodeQrCardCopyFromEvent(el, link);
    },
    true,
  );
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

/** Presets whose center frequency matches (±1 kHz tolerance). */
function findPresetsByFrequency(mhz) {
  if (!Number.isFinite(mhz)) return [];
  return FREQUENCY_PRESETS.filter((p) => Math.abs(mhz - p.freq) < 0.001);
}

function presetHoverDetailsText(preset) {
  return `${preset.name} — ${preset.freq} MHz / BW ${preset.bw} kHz / SF${preset.sf} / CR${preset.cr}`;
}

function formatFrequencyKnownTooltip(presets) {
  if (!presets.length) return "";
  return presets.map((p) => presetHoverDetailsText(p)).join("\n\n");
}

const radioParamDesc = {
  bw: { label: "Bandwidth", unit: " kHz" },
  freq: { label: "Frequency", unit: "MHz" },
  sf: { label: "Spreading factor", unit: "" },
  cr: { label: "Coding rate", unit: "" },
};

function escapeAttrHtml(text) {
  return String(text).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

// Radio params: named preset only when params exactly match a known preset;
// otherwise list freq/cr/sf/bw only (no "Custom" label). Missing params → N/A.
function formatRadioParams(params) {
  if (
    !params ||
    typeof params !== "object" ||
    Object.keys(params).length === 0
  ) {
    return "N/A";
  }

  const preset = matchFrequencyPreset(params);
  if (preset) {
    return escapeAttrHtml(preset.name);
  }

  const freq = parseFloat(params.freq);
  const sf = parseInt(params.sf, 10);
  const bw = parseFloat(params.bw);
  const cr = parseInt(params.cr, 10);

  const lines = [
    ["freq", freq],
    ["cr", cr],
    ["sf", sf],
    ["bw", bw],
  ];
  let html = "";
  for (const [k, val] of lines) {
    const meta = radioParamDesc[k];
    if (!meta || (typeof val === "number" && Number.isNaN(val))) continue;
    const numStr = escapeAttrHtml(String(val));
    const suffix = meta.unit ? escapeAttrHtml(meta.unit) : "";
    html += `<div>${escapeAttrHtml(meta.label)}: ${numStr}${suffix}</div>`;
  }

  return html || "N/A";
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

/** Tight relative labels for narrow UI (e.g. popup activity strip): no “ago”, short units. */
function timeAgoCompact(msec) {
  const seconds = Math.floor((Date.now() - msec) / 1000);
  if (seconds < 45) return "now";

  const tiers = [
    { limit: 31536000, suf: "y" },
    { limit: 2592000, suf: "mo" },
    { limit: 86400, suf: "d" },
    { limit: 3600, suf: "h" },
    { limit: 60, suf: "min" },
  ];

  for (const { limit, suf } of tiers) {
    const count = Math.floor(seconds / limit);
    if (count >= 1) return `${count}${suf}`;
  }
  return "now";
}

function formatRelativeTimeCompact(dateString) {
  if (!dateString) return "N/A";
  const date = new Date(dateString);
  if (isNaN(date.getTime())) return "Invalid date";
  const titleCET = formatInCET(date);
  const long = timeAgo(date.getTime());
  const short = timeAgoCompact(date.getTime());
  const tip = `${titleCET} · ${long}`;
  return `<time datetime="${escapeAttrHtml(dateString)}" title="${escapeAttrHtml(tip)}">${escapeAttrHtml(short)}</time>`;
}

// Format date in CET/CEST with timezone label (for tooltips and display)
// Note: timeZoneName cannot be used with dateStyle/timeStyle, so we use explicit options.
function formatInCET(date) {
  if (!(date instanceof Date) || isNaN(date.getTime())) return "Invalid date";
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Brussels",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    timeZoneName: "short",
  }).format(date);
}

// Helper function to format date string with timeAgo; tooltip shows exact time in CET
function formatRelativeTime(dateString) {
  if (!dateString) return "N/A";

  const date = new Date(dateString);
  if (isNaN(date.getTime())) return "Invalid date";

  const dt = new Date(dateString);
  const titleCET = formatInCET(dt);
  return `<time datetime="${dateString}" title="${titleCET}">${timeAgo(
    dt.getTime(),
  )}</time>`;
}

// Shorten long strings for display (full value still used for copy)
function shortenForDisplay(str, maxLen = 24) {
  if (!str || str.length <= maxLen) return str;
  const s = String(str);
  const head = Math.ceil((maxLen - 1) / 2);
  const tail = maxLen - 1 - head;
  return s.slice(0, head) + "\u2026" + s.slice(-tail);
}

// Create clickable copy element
// options: { hintStyle, extraClasses, dataHint, copyTitle } — copyTitle overrides default "Click to copy" tooltip.
function createCopyableElement(text, displayText = null, options = null) {
  if (!text) return "N/A";
  const display = displayText || text;
  const opts = options && typeof options === "object" ? options : {};
  const hintStyle = !!opts.hintStyle;
  const extraClasses = opts.extraClasses
    ? String(opts.extraClasses).trim()
    : "";
  const dataHint = opts.dataHint != null ? String(opts.dataHint) : "";

  const escapedText = String(text)
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
  const escapedDisplay = String(display)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
  const dataHintAttr = dataHint
    ? ` data-hint="${escapeAttrHtml(dataHint)}"`
    : "";

  const classes = ["copyable"];
  if (hintStyle) classes.push("node-qr-card__hint-copy");
  if (extraClasses) {
    for (const c of extraClasses.split(/\s+/)) {
      if (c) classes.push(c);
    }
  }
  const styleAttr = hintStyle
    ? ""
    : ` style="cursor: pointer; color: #2196F3; text-decoration: underline;"`;

  const titleRaw =
    opts.copyTitle != null && String(opts.copyTitle).trim() !== ""
      ? String(opts.copyTitle).trim()
      : "Click to copy";
  const titleAttr = escapeAttrHtml(titleRaw);

  return `<span class="${classes.join(" ")}" data-copy="${escapedText}"${styleAttr}${dataHintAttr} title="${titleAttr}">${escapedDisplay}</span>`;
}

/**
 * Copy-coordinates + map links menu. `toggleLabelEscaped` is visible link text (already
 * passed through escapeAttrHtml); lat/lon drive copy + external URLs.
 */
function buildCoordsMenuWrapFromLatLon(latN, lonN, toggleLabelEscaped) {
  const plain = `${latN}, ${lonN}`;
  const osm = `https://www.openstreetmap.org/?mlat=${latN}&mlon=${lonN}&zoom=15`;
  const gMap = `https://www.google.com/maps/place/${latN},${lonN}`;
  const mapy = `https://mapy.com/?q=${latN},${lonN}`;
  return (
    `<span class="coords-menu-wrap">` +
    `<a href="#" class="coords-menu-toggle" onclick="event.preventDefault();event.stopPropagation();this.parentElement.classList.toggle('open');return false;" title="Copy coordinates &amp; open in maps">${toggleLabelEscaped}</a>` +
    `<span class="coords-menu">${createCopyableElement(plain, "Copy coordinates")}<a href="${osm}" target="_blank" rel="noopener noreferrer">OpenStreetMap</a><a href="${gMap}" target="_blank" rel="noopener noreferrer">Google Maps</a><a href="${mapy}" target="_blank" rel="noopener noreferrer">Mapy.com</a></span>` +
    `</span>`
  );
}

const QR_CODE_MODULE_URL = "https://cdn.jsdelivr.net/npm/qrcode@1.5.4/+esm";
const NODE_QR_WIDTH_PX = 128;
/** Pixel width for the enlarged QR modal (independent of popup QR size). */
const NODE_QR_ENLARGE_PX = 400;

let _qrEnlargeTeardown = null;

function closeQrEnlargeOverlay() {
  if (_qrEnlargeTeardown) {
    _qrEnlargeTeardown();
    _qrEnlargeTeardown = null;
  }
}

/** Read node label lines from the open Leaflet popup DOM (same source as the small QR card). */
function collectQrEnlargeContext(slot) {
  const popup = slot?.closest?.(".node-popup");
  const card = slot?.closest?.(".node-qr-card");
  const titleEl = popup?.querySelector?.(".node-popup__title");
  const typeIcon = popup?.querySelector?.(".node-popup__type-icon");
  const name = (titleEl?.textContent || "").trim() || "Unnamed node";
  const typeLabel =
    (
      typeIcon?.getAttribute("aria-label") ||
      typeIcon?.getAttribute("title") ||
      ""
    ).trim() || "Node";
  const publicKey = (card?.getAttribute("data-public-key") || "").trim();
  return { name, typeLabel, publicKey };
}

/**
 * Full-screen style overlay with the same QR at NODE_QR_ENLARGE_PX (400px).
 */
async function openQrEnlargeOverlay(slot, link) {
  const trimmed = link?.trim();
  if (!trimmed) return;
  closeQrEnlargeOverlay();

  const ctx = collectQrEnlargeContext(slot);

  const backdrop = document.createElement("div");
  backdrop.className = "node-qr-enlarge-backdrop";
  backdrop.setAttribute("role", "dialog");
  backdrop.setAttribute("aria-modal", "true");
  backdrop.setAttribute("aria-label", `Enlarged QR code — ${ctx.name}`);

  const panel = document.createElement("div");
  panel.className = "node-qr-enlarge-panel";
  panel.addEventListener("click", (e) => e.stopPropagation());

  const closeBtn = document.createElement("button");
  closeBtn.type = "button";
  closeBtn.className = "node-qr-enlarge-close";
  closeBtn.setAttribute("aria-label", "Close");
  closeBtn.textContent = "\u00d7";

  const titleEl = document.createElement("h2");
  titleEl.className = "node-qr-enlarge-title";
  titleEl.textContent = ctx.name;

  const typeEl = document.createElement("p");
  typeEl.className = "node-qr-enlarge-subtitle";
  typeEl.textContent = ctx.typeLabel;

  const pkWrap = document.createElement("div");
  pkWrap.className = "node-qr-enlarge-pk-wrap";
  const pkEl = document.createElement("p");
  pkEl.className = "node-qr-enlarge-pk";
  pkEl.textContent = ctx.publicKey || "\u2014";
  pkWrap.appendChild(pkEl);

  const wrap = document.createElement("div");
  wrap.className = "node-qr-enlarge-qr";

  panel.appendChild(closeBtn);
  panel.appendChild(titleEl);
  panel.appendChild(typeEl);
  panel.appendChild(pkWrap);
  panel.appendChild(wrap);
  backdrop.appendChild(panel);
  document.body.appendChild(backdrop);

  const onKeyDoc = (e) => {
    if (e.key === "Escape") {
      e.preventDefault();
      closeQrEnlargeOverlay();
    }
  };

  const teardown = () => {
    document.removeEventListener("keydown", onKeyDoc);
    backdrop.remove();
    _qrEnlargeTeardown = null;
  };

  closeBtn.addEventListener("click", () => closeQrEnlargeOverlay());
  backdrop.addEventListener("click", () => closeQrEnlargeOverlay());
  document.addEventListener("keydown", onKeyDoc);
  _qrEnlargeTeardown = teardown;

  const targetW = NODE_QR_ENLARGE_PX;
  const existingSvg = slot?.querySelector?.("svg.node-qr");
  if (existingSvg) {
    const clone = existingSvg.cloneNode(true);
    clone.removeAttribute("style");
    clone.setAttribute("width", String(targetW));
    clone.setAttribute("height", String(targetW));
    clone.style.shapeRendering = "crispEdges";
    clone.style.display = "block";
    clone.style.margin = "0 auto";
    clone.classList.add("node-qr--enlarged");
    wrap.appendChild(clone);
    closeBtn.focus();
    return;
  }

  try {
    const mod = await import(QR_CODE_MODULE_URL);
    const QRCode = mod.default;
    const svg = await QRCode.toString(trimmed, {
      type: "svg",
      width: targetW,
      margin: 1,
      errorCorrectionLevel: "H",
      color: { dark: "#000000", light: "#ffffff" },
    });
    if (!backdrop.isConnected) return;
    wrap.innerHTML = svg;
    const svgEl = wrap.querySelector("svg");
    if (svgEl) {
      svgEl.classList.add("node-qr", "node-qr--enlarged");
      svgEl.setAttribute(
        "style",
        "shape-rendering:crispEdges;max-width:100%;height:auto;display:block;margin:0 auto",
      );
    }
    closeBtn.focus();
  } catch (e) {
    console.warn("QR enlarge failed:", e);
    teardown();
  }
}

function meshcoreContactLink(node) {
  if (!node?.link || typeof node.link !== "string") return null;
  const s = node.link.trim();
  if (!s) return null;
  return s.startsWith("meshcore://") ? s : `meshcore://${s}`;
}

/** 32-byte Ed25519 public key as 64 hex chars (see MeshCore/docs/qr_codes.md). */
function normalizeMeshcorePublicKeyHex(node) {
  let pk = (node?.public_key || "")
    .replace(/\s/g, "")
    .replace(/-/g, "")
    .toLowerCase();
  if (pk.startsWith("0x")) pk = pk.slice(2);
  if (/^[0-9a-f]{64}$/.test(pk)) return pk;
  return null;
}

/** Footer “Analyzer” dropdown: Let's Mesh (typed URL) + ON8AR (pubkey-only). */
function buildAnalyzerFooterMenu(node, letsMeshUrl) {
  const pkHex = normalizeMeshcorePublicKeyHex(node);
  const on8arPk =
    pkHex ||
    String(node?.public_key ?? "")
      .trim()
      .replace(/^0x/i, "")
      .replace(/\s/g, "");
  const on8arUrl = `https://analyzer.on8ar.eu/#/nodes/${encodeURIComponent(on8arPk)}`;
  const lm = escapeAttrHtml(letsMeshUrl);
  const o8 = escapeAttrHtml(on8arUrl);
  return (
    `<span class="coords-menu-wrap node-popup-analyzer-menu">` +
    `<a href="#" class="node-popup-action node-popup-action--external node-popup-action--icon-only node-popup-analyzer-menu__toggle" onclick="event.preventDefault();event.stopPropagation();this.parentElement.classList.toggle('open');return false;" title="Choose network analyzer" aria-label="Choose network analyzer"><i aria-hidden="true">search</i></a>` +
    `<span class="coords-menu" role="menu">` +
    `<a role="menuitem" href="${lm}" target="_blank" rel="noopener noreferrer">Let\u2019s Mesh Analyzer</a>` +
    `<a role="menuitem" href="${o8}" target="_blank" rel="noopener noreferrer">ON8AR Analyzer</a>` +
    `</span></span>`
  );
}

/**
 * Payload for QR: MeshCore mobile expects meshcore://contact/add?... (not the packed node.link blob).
 * https://github.com/meshcore-dev/MeshCore/blob/main/docs/qr_codes.md#add-contact
 */
function meshcoreQrUri(node) {
  const pk = normalizeMeshcorePublicKeyHex(node);
  const typeRaw = parseInt(String(node?.type ?? 1), 10);
  const typeNum = Number.isFinite(typeRaw)
    ? Math.min(4, Math.max(1, typeRaw))
    : 1;
  if (pk) {
    const name = ((node?.adv_name || "Contact").trim() || "Contact").slice(
      0,
      200,
    );
    return `meshcore://contact/add?name=${encodeURIComponent(name)}&public_key=${pk}&type=${typeNum}`;
  }
  return meshcoreContactLink(node);
}

async function fillNodeQrSlotFromPopup(popupContentRoot) {
  if (!popupContentRoot) return;
  const slot = popupContentRoot.querySelector(
    ".node-qr-slot[data-meshcore-link]",
  );
  if (!slot) return;
  const link = slot.getAttribute("data-meshcore-link");
  if (!link) return;
  try {
    const mod = await import(QR_CODE_MODULE_URL);
    const QRCode = mod.default;
    const svg = await QRCode.toString(link, {
      type: "svg",
      width: NODE_QR_WIDTH_PX,
      margin: 1,
      errorCorrectionLevel: "H",
      color: { dark: "#000000", light: "#ffffff" },
    });
    // Leaflet may call the popup content function again (pan/zoom/setView), replacing
    // the DOM while we awaited the QR module — only paint if this link's slot still exists.
    const live = popupContentRoot.querySelector(
      ".node-qr-slot[data-meshcore-link]",
    );
    if (
      !live ||
      live.getAttribute("data-meshcore-link") !== link ||
      !live.isConnected
    ) {
      return;
    }
    live.innerHTML = svg;
    const svgEl = live.querySelector("svg");
    if (svgEl) {
      svgEl.classList.add("node-qr");
      svgEl.setAttribute(
        "style",
        "shape-rendering:crispEdges;max-width:100%;height:auto;display:block;margin:0 auto",
      );
    }
  } catch (e) {
    console.warn("QR code failed:", e);
    const live = popupContentRoot.querySelector(
      ".node-qr-slot[data-meshcore-link]",
    );
    if (live && live.getAttribute("data-meshcore-link") === link) {
      live.innerHTML = "";
      live.style.display = "none";
    }
  }
}

function bindPopupQrRefill(popup, getContentRoot) {
  if (!popup || popup._qrRefillBound) return;
  popup._qrRefillBound = true;
  popup.on("contentupdate", () => {
    requestAnimationFrame(() => {
      fillNodeQrSlotFromPopup(getContentRoot());
    });
  });
}

const columnOrder = ["link"];
const columns = {
  coords: {
    label: "Coordinates",
    value: (val, node) => {
      if (node?.adv_lat != null && node?.adv_lon != null) {
        const latN = Number(node.adv_lat);
        const lonN = Number(node.adv_lon);
        if (Number.isFinite(latN) && Number.isFinite(lonN)) {
          return buildCoordsMenuWrapFromLatLon(
            latN,
            lonN,
            escapeAttrHtml(`${latN}, ${lonN}`),
          );
        }
      }
      const compact = String(val || "").replace(/\s/g, "");
      const parts = compact.split(",");
      const lat = parts[0]?.trim();
      const lon = parts[1]?.trim();
      if (!lat || !lon) {
        return `<a target="_blank" rel="noopener noreferrer" href="https://www.google.com/maps/place/${compact}">${escapeAttrHtml(
          val,
        )}</a>`;
      }
      const latN = Number(lat);
      const lonN = Number(lon);
      if (Number.isNaN(latN) || Number.isNaN(lonN)) {
        return escapeAttrHtml(val);
      }
      return buildCoordsMenuWrapFromLatLon(
        latN,
        lonN,
        escapeAttrHtml(`${latN}, ${lonN}`),
      );
    },
  },
  adv_name: {
    label: "Name",
  },
  status: {
    label: "Freshness",
    value: (val) => {
      const desc = updateStatusDesc[val] || "N/A";
      const statusClass =
        val && Object.prototype.hasOwnProperty.call(updateStatusDesc, val)
          ? `update-${val}`
          : "update-none";
      return `<span class="status-dot ${statusClass}" title="${escapeAttrHtml(desc)}"></span>`;
    },
  },
  inserted_date: {
    label: "Inserted",
    value: (val) => formatRelativeTime(val),
  },
  updated_date: {
    label: "Updated",
    value: (val) => formatRelativeTime(val),
  },
  last_advert: {
    label: "Last advert",
    value: (val) => formatRelativeTime(val),
  },
  public_key: {
    label: "Public key",
    value: (val) =>
      createCopyableElement(val, shortenForDisplay(val.toUpperCase(), 22)),
  },
  inserted_by: {
    label: "Inserted by",
    value: (val, node, nodes = []) =>
      formatInserterUpdater(val, nodes, node, "inserter"),
  },
  updated_by: {
    label: "Updated by",
    value: (val, node, nodes = []) =>
      formatInserterUpdater(val, nodes, node, "updater"),
  },
  type: {
    label: "Type",
    value: (val) => types[val],
  },
  params: {
    label: "Radio params",
    value: (val) => formatRadioParams(val),
  },
  link: {
    label: "Meshcore link",
    value: (val) => {
      const link =
        typeof val === "string"
          ? val.startsWith("meshcore://")
            ? val
            : val
              ? `meshcore://${val}`
              : ""
          : "";
      if (!link) return "N/A";
      return createCopyableElement(link, shortenForDisplay(link, 24));
    },
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
        valueHtml += ` <a href="https://github.com/recrof/map.meshcore.io-uploader" target="_blank" rel="noopener noreferrer" title="View MeshCore map uploader on GitHub" style="color: #4CAF50; text-decoration: none; margin-left: 4px;">🔗</a>`;
      }

      return valueHtml;
    },
  },
};

const svgIconHtmlCache = new Map();

function escapeXmlText(s) {
  return String(s).replace(
    /[<>&]/g,
    (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;" })[c],
  );
}

function getSvgIcon(text, color, updateStatus) {
  const status = updateStatus || "none";
  const cacheKey = `${text}|${color}|${status}`;
  let icon = svgIconHtmlCache.get(cacheKey);
  if (!icon) {
    const html = `<svg viewBox="0 0 512 512" xmlns="http://www.w3.org/2000/svg"><ellipse cx="256" cy="256" rx="256" ry="256" fill="${color}"/><text x="256" y="256" dominant-baseline="central" text-anchor="middle" fill="#fff" font-size="150" font-weight="bold" font-family="sans-serif">${escapeXmlText(
      text,
    )}</text></svg>`;
    icon = L.divIcon({
      html,
      className: `svg-node-icon update-${status}`,
      iconSize: [32, 32],
      iconAnchor: [17, 17],
      popupAnchor: [0, -16],
    });
    svgIconHtmlCache.set(cacheKey, icon);
  }
  return icon;
}

function clearLocationHash() {
  history.pushState("", document.title, location.pathname + location.search);
}

/** City under the node title; click opens the same coords/menu as the former coords row. */
function buildHeaderCityLineHtml(node) {
  const cityRaw = node?.city;
  const city = cityRaw != null ? String(cityRaw).trim() : "";
  const displayCity = city || "Unknown";
  const latN = node?.adv_lat != null ? Number(node.adv_lat) : NaN;
  const lonN = node?.adv_lon != null ? Number(node.adv_lon) : NaN;
  if (Number.isFinite(latN) && Number.isFinite(lonN)) {
    return (
      `<div class="node-popup__cityline">` +
      buildCoordsMenuWrapFromLatLon(latN, lonN, escapeAttrHtml(displayCity)) +
      `</div>`
    );
  }
  return `<div class="node-popup__cityline node-popup__cityline--plain">${escapeAttrHtml(displayCity)}</div>`;
}

/** Inserted / updated / last advert in one strip under the header. */
function buildNodeActivityStripHtml(node) {
  const items = [
    {
      key: "inserted_date",
      label: "Inserted",
      icon: "rocket_launch",
    },
    {
      key: "updated_date",
      label: "Updated",
      icon: "autorenew",
    },
    {
      key: "last_advert",
      label: "Last advert",
      icon: "rss_feed",
    },
  ];

  const cells = items
    .map(({ key, label, icon }) => {
      const val = node[key];
      const valueHtml =
        key === "inserted_date" ||
        key === "updated_date" ||
        key === "last_advert"
          ? formatRelativeTimeCompact(val)
          : columns[key]?.value
            ? columns[key].value(val, node)
            : escapeAttrHtml(String(val ?? ""));
      return (
        `<div class="node-popup__activity-item" role="listitem">` +
        `<span class="node-popup__activity-icon" aria-hidden="true"><i>${icon}</i></span>` +
        `<span class="node-popup__activity-copy">` +
        `<span class="node-popup__activity-label">${escapeAttrHtml(label)}</span>` +
        `<span class="node-popup__activity-value">${valueHtml}</span>` +
        `</span></div>`
      );
    })
    .join("");

  return `<div class="node-popup__activity" role="list" aria-label="Node dates: inserted, updated, last advert">${cells}</div>`;
}

function buildRadioParamsPanelHtml(node) {
  const params = node.params;
  if (
    !params ||
    typeof params !== "object" ||
    Object.keys(params).length === 0
  ) {
    return (
      `<div class="node-popup__panel-block">` +
      `<div class="node-popup__panel-kicker"><span class="node-popup__panel-icon" aria-hidden="true"><i>tune</i></span><span>Radio</span></div>` +
      `<div class="node-popup__panel-body"><span class="node-popup__muted">Not specified</span></div></div>`
    );
  }
  const preset = matchFrequencyPreset(params);
  if (preset) {
    const presetTitle = escapeAttrHtml(presetHoverDetailsText(preset));
    return (
      `<div class="node-popup__panel-block">` +
      `<div class="node-popup__panel-kicker"><span class="node-popup__panel-icon" aria-hidden="true"><i>tune</i></span><span>Radio</span></div>` +
      `<div class="node-popup__panel-body"><span class="node-popup__radio-preset" title="${presetTitle}">${escapeAttrHtml(preset.name)}</span></div></div>`
    );
  }
  const freq = parseFloat(params.freq);
  const sf = parseInt(params.sf, 10);
  const bw = parseFloat(params.bw);
  const cr = parseInt(params.cr, 10);
  const chips = [];
  if (Number.isFinite(freq)) {
    const freqPresetTooltip = formatFrequencyKnownTooltip(
      findPresetsByFrequency(freq),
    );
    const freqTitle = freqPresetTooltip
      ? ` title="${escapeAttrHtml(freqPresetTooltip)}"`
      : "";
    chips.push(
      `<span class="node-popup__chip"${freqTitle}>${escapeAttrHtml(String(freq))}\u00a0MHz</span>`,
    );
  }
  if (Number.isFinite(sf)) {
    chips.push(
      `<span class="node-popup__chip">SF\u00a0${escapeAttrHtml(String(sf))}</span>`,
    );
  }
  if (Number.isFinite(bw)) {
    chips.push(
      `<span class="node-popup__chip">${escapeAttrHtml(String(bw))}\u00a0kHz BW</span>`,
    );
  }
  if (Number.isFinite(cr)) {
    chips.push(
      `<span class="node-popup__chip">CR\u00a0${escapeAttrHtml(String(cr))}</span>`,
    );
  }
  const inner = chips.length
    ? `<div class="node-popup__radio-custom"><span class="node-popup__chip-hint node-popup__chip-hint--lead">Custom</span><div class="node-popup__chip-row">${chips.join("")}</div></div>`
    : `<span class="node-popup__muted">Not specified</span>`;
  return (
    `<div class="node-popup__panel-block">` +
    `<div class="node-popup__panel-kicker"><span class="node-popup__panel-icon" aria-hidden="true"><i>tune</i></span><span>Radio</span></div>` +
    `<div class="node-popup__panel-body">${inner}</div></div>`
  );
}

function buildNodeIdentityPanelHtml(
  node,
  nodes = [],
  skipPublicKeyBlock = false,
) {
  const blocks = [];

  if (node.public_key && !skipPublicKeyBlock) {
    const pk = String(node.public_key);
    const display = shortenForDisplay(pk.toUpperCase(), 26);
    const copyHtml = createCopyableElement(pk, display);
    blocks.push(
      `<div class="node-popup__panel-block">` +
        `<div class="node-popup__panel-kicker"><span class="node-popup__panel-icon" aria-hidden="true"><i>key</i></span><span>Public key</span></div>` +
        `<div class="node-popup__panel-body"><div class="node-popup__pk-wrap" title="${escapeAttrHtml("Copy public key")}">${copyHtml}</div></div></div>`,
    );
  }

  blocks.push(buildRadioParamsPanelHtml(node));

  const ins = node.inserted_by;
  const upd = node.updated_by;
  const insPresent = ins && String(ins).trim();
  const updPresent = upd && String(upd).trim();
  if (insPresent || updPresent) {
    const same =
      insPresent &&
      updPresent &&
      normalizePubKeyForCompare(ins) === normalizePubKeyForCompare(upd);
    let inner = "";
    if (same) {
      inner = `<div class="node-popup__prov-row"><span class="node-popup__prov-label">Added &amp; updated by</span><span class="node-popup__prov-value">${formatInserterUpdater(ins, nodes, node, "inserter")}</span></div>`;
    } else {
      if (insPresent) {
        inner += `<div class="node-popup__prov-row"><span class="node-popup__prov-label">Added by</span><span class="node-popup__prov-value">${formatInserterUpdater(ins, nodes, node, "inserter")}</span></div>`;
      }
      if (updPresent) {
        inner += `<div class="node-popup__prov-row"><span class="node-popup__prov-label">Updated by</span><span class="node-popup__prov-value">${formatInserterUpdater(upd, nodes, node, "updater")}</span></div>`;
      }
    }
    blocks.push(
      `<div class="node-popup__panel-block">` +
        `<div class="node-popup__panel-kicker"><span class="node-popup__panel-icon" aria-hidden="true"><i>history</i></span><span>Uploader identity</span></div>` +
        `<div class="node-popup__panel-body node-popup__panel-body--prov">${inner}</div></div>`,
    );
  }

  const owner = node.discord_owner_name?.trim();
  if (owner) {
    const oid = node.discord_owner_id;
    const at = escapeAttrHtml(owner);
    const linkBody =
      oid != null && String(oid).trim() !== ""
        ? `<a class="node-popup__discord-user" href="https://discord.com/users/${encodeURIComponent(String(oid))}" target="_blank" rel="noopener noreferrer" title="Send private message to owner via Discord" aria-label="Send private message to owner via Discord">@${at}</a>`
        : `<span class="node-popup__discord-user node-popup__discord-user--bare">@${at}</span>`;
    blocks.push(
      `<div class="node-popup__panel-block node-popup__panel-block--owner">` +
        `<div class="node-popup__panel-kicker"><span class="node-popup__panel-icon node-popup__panel-icon--discord" aria-hidden="true"><i>verified_user</i></span><span>Claimed by</span></div>` +
        `<div class="node-popup__panel-body">${linkBody}</div></div>`,
    );
  }

  return `<section class="node-popup__panel" aria-label="Keys, ownership, and radio">${blocks.join("")}</section>`;
}

function getTable(node, authState = null, nodes = []) {
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

  const qrUri = meshcoreQrUri(node);
  /** Packed `meshcore://…` blob for clipboard; QR still uses add-contact URI when possible. */
  const meshcoreCopyLink = meshcoreContactLink(node) || qrUri;
  const pkRaw =
    node.public_key != null && String(node.public_key).trim() !== ""
      ? String(node.public_key)
      : "";
  const dataPublicKeyAttr = pkRaw
    ? ` data-public-key="${escapeAttrHtml(pkRaw)}"`
    : "";
  const qrHeaderPk = pkRaw
    ? (() => {
        const display = shortenForDisplay(pkRaw.toUpperCase(), 26);
        return (
          `<div class="node-qr-card__bar-start">` +
          `<div class="node-popup__pk-wrap" title="${escapeAttrHtml("Copy public key")}">` +
          `<span class="node-qr-card__field-text">` +
          `<span class="node-qr-card__field-slice">${escapeAttrHtml(display)}</span>` +
          `</span></div></div>` +
          `<span class="node-qr-card__hint">Public key</span>`
        );
      })()
    : `<div class="node-qr-card__bar-start" aria-hidden="true"></div>`;
  const escapedMc = escapeAttrHtml(meshcoreCopyLink);
  const linkSnippet = shortenForDisplay(meshcoreCopyLink, 26);
  const qrBlock = qrUri
    ? `<div class="node-qr-card"${dataPublicKeyAttr} role="button" tabindex="0" aria-label="Copy MeshCore link" data-meshcore-copy="${escapedMc}"><div class="node-qr-card__header">${qrHeaderPk}</div><div class="node-qr-card__inner"><div class="node-qr-slot" data-meshcore-link="${escapeAttrHtml(qrUri)}"></div></div><div class="node-qr-card__footer"><div class="node-qr-card__bar-start"><div class="node-popup__pk-wrap" title="${escapeAttrHtml("Copy MeshCore link")}"><span class="node-qr-card__field-text"><span class="node-qr-card__field-slice">${escapeAttrHtml(linkSnippet)}</span></span></div></div><span class="node-qr-card__hint">MeshCore link</span></div></div>`
    : "";

  const statusKey = node.status || "none";
  const statusDesc = updateStatusDesc[statusKey] || "N/A";
  const statusDotClass =
    statusKey &&
    Object.prototype.hasOwnProperty.call(updateStatusDesc, statusKey)
      ? `update-${statusKey}`
      : "update-none";
  const typeMeta = getNodeTypeMeta(node);
  const displayName = node.adv_name?.trim() ? node.adv_name : "Unnamed node";

  const sourceMeta = getNodeSourceHeaderMeta(node);
  const sourceHeaderEl = sourceMeta
    ? (() => {
        const inner = `<i aria-hidden="true">${sourceMeta.icon}</i>`;
        const cls = `node-popup__source-icon node-popup__source-icon--${sourceMeta.safeClass}`;
        const t = escapeAttrHtml(`Source type: ${sourceMeta.tooltipText}`);
        return sourceMeta.href
          ? `<a class="${cls}" href="${escapeAttrHtml(sourceMeta.href)}" target="_blank" rel="noopener noreferrer" title="${t}" aria-label="${t}">${inner}</a>`
          : `<span class="${cls}" title="${t}" aria-label="${t}">${inner}</span>`;
      })()
    : "";

  const headerHtml =
    `<header class="node-popup__header">` +
    `<span class="node-popup__type-icon" title="${escapeAttrHtml(typeMeta.label)}" aria-label="${escapeAttrHtml(typeMeta.label)}"><i aria-hidden="true">${typeMeta.icon}</i></span>` +
    `<span class="node-popup__freshness" title="${escapeAttrHtml(`Freshness: ${statusDesc}`)}" aria-label="${escapeAttrHtml(`Freshness: ${statusDesc}`)}"><span class="status-dot ${statusDotClass}"></span></span>` +
    `<div class="node-popup__head-text">` +
    `<h3 class="node-popup__title" title="${escapeAttrHtml(`Name: ${displayName}`)}" aria-label="${escapeAttrHtml(`Name: ${displayName}`)}">${escapeAttrHtml(displayName)}</h3>` +
    buildHeaderCityLineHtml(node) +
    `</div>` +
    sourceHeaderEl +
    `</header>`;

  return (
    `<div class="node-popup" data-status="${escapeAttrHtml(statusKey)}">` +
    headerHtml +
    buildNodeActivityStripHtml(node) +
    qrBlock +
    '<div class="node-popup__body">' +
    buildNodeIdentityPanelHtml(node, nodes, !!qrUri) +
    (() => {
      const linkCells = columnOrder
        .flatMap((key) => {
          if (key === "link" && qrUri) return [];
          const shouldShow = node[key];
          if (!shouldShow) return [];
          return [
            `<td><b>${escapeAttrHtml(columns[key].label)}</b></td><td>${
              columns[key].value
                ? columns[key].value(node[key], node, nodes)
                : escapeAttrHtml(String(node[key] ?? ""))
            }</td>`,
          ];
        })
        .join("</tr><tr>");
      return linkCells
        ? `<table class="node-info node-info--extras"><tbody><tr>${linkCells}</tr></tbody></table>`
        : "";
    })() +
    "</div>" +
    (() => {
      const isUnclaimed =
        !node.discord_owner_name || node.discord_owner_name.trim() === "";
      const publicKey = node.public_key || "";

      const footerStart = buildAnalyzerFooterMenu(node, analyzerUrl);

      let footerCenter = "";
      if (authState && authState.authenticated) {
        if (isUnclaimed) {
          footerCenter = `<a href="javascript:void(0)" class="node-popup-action node-popup-action--claim" onclick="window.claimNode('${publicKey}')">Claim</a>`;
        } else {
          const nodeOwnerId = node.discord_owner_id;
          const currentUserId = authState.user?.id;

          if (
            nodeOwnerId &&
            currentUserId &&
            String(nodeOwnerId) === String(currentUserId)
          ) {
            footerCenter = `<a href="javascript:void(0)" class="node-popup-action node-popup-action--danger" onclick="window.unclaimNode('${publicKey}')">Unclaim</a>`;
          }
        }
      } else if (isUnclaimed) {
        footerCenter = `<a href="/auth/login" class="node-popup-action node-popup-action--claim">Claim</a>`;
      }

      const source = (node.source || "").toLowerCase();
      const isNotDiscordSource =
        source !== "discord" &&
        (source === "app" || source === "uploader" || source === "web");

      const delUrl = escapeAttrHtml(getDeletionMailUrl(node));
      const footerEnd = isNotDiscordSource
        ? `<a href="${delUrl}" class="node-popup-action node-popup-action--danger node-popup-action--icon-only" title="Request deletion" aria-label="Request deletion"><i aria-hidden="true">delete</i></a>`
        : "";

      return `<nav class="node-popup-actions" aria-label="Node actions"><div class="node-popup-actions__row"><div class="node-popup-actions__slot node-popup-actions__slot--start">${footerStart}</div><div class="node-popup-actions__slot node-popup-actions__slot--center">${footerCenter}</div><div class="node-popup-actions__slot node-popup-actions__slot--end">${footerEnd}</div></div></nav>`;
    })() +
    "</div>"
  );
}

// Initialize copy handlers when DOM is ready
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", () => {
    setupCopyHandlers();
    setupNodeQrCardHandlers();
  });
} else {
  setupCopyHandlers();
  setupNodeQrCardHandlers();
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
  const src = node.source != null ? String(node.source) : "";
  if (!src || src[0] !== "u") return "none";
  const updateEpoch = new Date(node.updated_date).getTime();
  if (Number.isNaN(updateEpoch)) return "none";
  const now = Date.now();
  if (updateEpoch < now - getDaysEpochMsec(20)) return "extinct";
  if (updateEpoch < now - getDaysEpochMsec(10)) return "old";
  if (updateEpoch < now - getDaysEpochMsec(5)) return "stale";
  return "recent";
}

// Update status descriptions (matches upstream)
const updateStatusDesc = {
  none: "manually added",
  recent: "updated recently",
  stale: "updated while ago",
  old: "not updated",
  extinct: "will be deleted soon",
};

function getDeletionMailUrl(node) {
  const deletionMailUrl = new URL("mailto:recrof@gmail.com");
  deletionMailUrl.searchParams.append(
    "subject",
    "MeshCore Map node deletion request",
  );
  deletionMailUrl.searchParams.append(
    "body",
    [
      "Please delete my node(s) from MeshCore Map database",
      "MeshCore link(s) or Public key(s):",
      "",
      node ? node.public_key || "" : "",
      "",
      "*** IMPORTANT ***",
      "if you have multiple nodes to delete, put them into single email, delimited by newline. public key is enough, you don't need to add name or screenshot of the node.",
    ].join("\n"),
  );
  return deletionMailUrl
    .toString()
    .replaceAll("+", "%20")
    .replaceAll("\n", "%0A");
}

const appAttribution = `
	Original map by <a target="_blank" href="https://github.com/sponsors/recrof?frequency=one-time&sponsor=recrof"><strong>recrof</strong></a> | Modified by the <a target="_blank" href="https://github.com/radio-actief"><strong>Radio-Actief</strong></a> community
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
    },
  ),
};

let params = { lat: 50.75, lon: 4.471, zoom: 9 }; // Brussels, Belgium

const urlParams = Object.fromEntries(new URLSearchParams(location.search));
/* Shareable links may use public_key; map focus + URL sync use node */
if (urlParams.public_key && !urlParams.node) {
  urlParams.node = String(urlParams.public_key);
}
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

/** Leaflet popup width: desktop keeps 350px; narrow / touch viewports avoid horizontal overflow. */
function getLeafletNodePopupSize() {
  if (typeof window === "undefined") return { minWidth: 350, maxWidth: 350 };
  const w = window.innerWidth;
  let coarse = false;
  try {
    coarse = window.matchMedia("(pointer: coarse)").matches;
  } catch {
    coarse = false;
  }
  const compact = w <= 640 || (coarse && w <= 900);
  if (!compact) return { minWidth: 350, maxWidth: 350 };
  const maxW = Math.max(220, Math.min(350, w - 28));
  const minW = Math.min(300, maxW);
  return { minWidth: minW, maxWidth: maxW };
}

map.on("baselayerchange", function (ev) {
  localStorage.setItem("baseMapSelected", ev.name);
});

// Map type (layers) above zoom in/out (bottom-left)
L.control.layers(baseMaps, null, { position: "bottomleft" }).addTo(map);
L.control.zoom({ position: "bottomleft" }).addTo(map);
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
      ]),
    ),
  ]),
);

createApp({
  setup() {
    const nodesRef = shallowRef([]);
    const nodesByTypeRef = shallowRef({});
    const filteredNodesRef = shallowRef([]);

    const app = (window.app = reactive({
      search: "",
      cityFilter: "",
      nodeFilter: [],
      sourceFilter: ["app", "uploader"],
      claimedFilter: ["claimed", "unclaimed"],
      fromDate: "",
      fromInsertDate: "",
      clusteringZoom: 11,
      urlParams,
      loading: false,
      freqFilter: [],
      availableFreqs: [],
    }));

    Object.defineProperty(app, "nodes", {
      get: () => nodesRef.value,
      set: (v) => {
        nodesRef.value = v;
      },
    });
    Object.defineProperty(app, "nodesByType", {
      get: () => nodesByTypeRef.value,
      set: (v) => {
        nodesByTypeRef.value = v;
      },
    });
    Object.defineProperty(app, "filteredNodes", {
      get: () => filteredNodesRef.value,
      set: (v) => {
        filteredNodesRef.value = v;
      },
    });

    /** URL sync: only non-default filter values (see clearFilters). */
    const DEFAULT_MAP_DATE_STR = "2025-03-01";
    const DEFAULT_CLUSTERING_ZOOM = 11;
    const DEFAULT_SOURCE_FILTER = ["app", "uploader"];
    const DEFAULT_CLAIMED_FILTER = ["claimed", "unclaimed"];

    function filterArraysEqualAsSets(a, b) {
      if (a.length !== b.length) return false;
      const sa = new Set(a.map((x) => String(x)));
      return b.every((x) => sa.has(String(x)));
    }

    function isDefaultSourceFilter(sel) {
      return filterArraysEqualAsSets(sel, DEFAULT_SOURCE_FILTER);
    }

    function isDefaultClaimedFilter(sel) {
      return filterArraysEqualAsSets(sel, DEFAULT_CLAIMED_FILTER);
    }

    const ALL_NODE_TYPE_KEYS = ["1", "2", "3", "4"];

    /** True when at least one band is unchecked (empty selection = no restriction, same as “all”). */
    function freqFilterIsRestrictive() {
      const avail = app.availableFreqs;
      if (!avail.length) return false;
      if (!app.freqFilter.length) return false;
      if (app.freqFilter.length !== avail.length) return true;
      const selected = new Set(app.freqFilter.map((x) => Number(x)));
      return !avail.every((f) => selected.has(Number(f)));
    }

    /** Empty or all four node types → same as “no nodes= restriction” in the URL. */
    function nodeFilterIsAllTypes() {
      if (!app.nodeFilter.length) return true;
      if (app.nodeFilter.length !== 4) return false;
      const set = new Set(app.nodeFilter.map((t) => String(Number(t))));
      return ALL_NODE_TYPE_KEYS.every((k) => set.has(k));
    }

    /** When true, map must use filteredNodes only (even if empty); never fall back to all nodes. */
    function filtersRestrictMapView() {
      if (!nodeFilterIsAllTypes()) return true;
      if (
        app.sourceFilter.length > 0 &&
        !isDefaultSourceFilter(app.sourceFilter)
      ) {
        return true;
      }
      if (
        app.claimedFilter.length > 0 &&
        !isDefaultClaimedFilter(app.claimedFilter)
      ) {
        return true;
      }
      if ((app.cityFilter || "").trim()) return true;
      if (freqFilterIsRestrictive()) return true;
      if (
        String(app.fromDate ?? "").trim() &&
        app.fromDate !== DEFAULT_MAP_DATE_STR
      ) {
        return true;
      }
      const ins = String(app.fromInsertDate ?? "").trim();
      if (ins && ins !== DEFAULT_MAP_DATE_STR) return true;
      return false;
    }

    // Authentication state
    const auth = reactive({
      authenticated: false,
      user: null,
      loading: true,
    });

    const markerToNode = new WeakMap();

    function ensurePopup(marker) {
      if (!marker || marker._popupBound) return;
      const node = markerToNode.get(marker);
      if (!node) return;
      const nodePopup = markRaw(
        L.popup({
          ...getLeafletNodePopupSize(),
          content: () => getTable(node, auth, app.nodes),
        }),
      );
      marker.bindPopup(nodePopup);
      marker._popupBound = true;
      bindPopupQrRefill(nodePopup, () =>
        marker
          .getPopup()
          ?.getElement()
          ?.querySelector(".leaflet-popup-content"),
      );
      marker.on("popupopen", function () {
        if (node.public_key) {
          app.urlParams.node = node.public_key;
        }
        setTimeout(() => {
          const root = marker.getPopup()?.getElement();
          if (!root) return;
          const content = root.querySelector(".leaflet-popup-content");
          fillNodeQrSlotFromPopup(content);
        }, 100);
      });
      marker.on("popupclose", function () {
        delete app.urlParams.node;
      });
    }

    function attachClusterClickHandler(group) {
      group.on("click", function (e) {
        const m = e.layer;
        if (
          m &&
          m instanceof L.Marker &&
          typeof m.getAllChildMarkers !== "function"
        ) {
          ensurePopup(m);
          m.openPopup();
        }
      });
    }

    function refreshOpenPopups() {
      for (const node of app.nodes) {
        const p = node.marker?.getPopup?.();
        if (p && p.isOpen()) {
          p.setContent(() => getTable(node, auth, app.nodes));
          p.update();
        }
      }
    }

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
          "Claim this node?\n\nYou will become the owner and can edit its details.",
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
            "✓ Node claimed successfully!\n\nYou are now the owner of this node.",
          );
          // Reload nodes to reflect changes
          await downloadNodes();
          await nextTick();
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
          });
          refreshOpenPopups();
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
              `❌ Unable to Claim Node\n\n${errorMsg}\n\nPlease check that:\n• The node exists and is active\n• The node is not already claimed by someone else`,
            );
          }
        }
      } catch (e) {
        console.error("Error claiming node:", e);
        const supportLink =
          "https://discord.com/channels/1391758345622257665/1454797139959091412";
        alert(
          `❌ Network Error\n\nUnable to claim node due to a connection error.\n\nIf this issue persists, please report it in our Discord support channel:\n${supportLink}`,
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
          "Unclaim this node?\n\nYou will lose ownership and anyone will be able to claim it.",
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
            "✓ Node unclaimed successfully!\n\nThe node is now available for others to claim.",
          );
          // Reload nodes to reflect changes
          await downloadNodes();
          await nextTick();
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
          });
          refreshOpenPopups();
        } else {
          const errorMsg = data.error || "Failed to unclaim node";
          if (data.error === "You do not own this node.") {
            alert(
              `❌ Ownership Error\n\n${errorMsg}\n\nYou can only unclaim nodes that you own.`,
            );
          } else if (data.error === "Node not found.") {
            alert(
              `❌ Node Not Found\n\n${errorMsg}\n\nThe node may have been deleted or the identifier is incorrect.`,
            );
          } else {
            alert(
              `❌ Unable to Unclaim Node\n\n${errorMsg}\n\nPlease try again or contact support if the issue persists.`,
            );
          }
        }
      } catch (e) {
        console.error("Error unclaiming node:", e);
        const supportLink =
          "https://discord.com/channels/1391758345622257665/1454797139959091412";
        alert(
          `❌ Network Error\n\nUnable to unclaim node due to a connection error.\n\nIf this issue persists, please report it in our Discord support channel:\n${supportLink}`,
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

    let pendingClusterPopupCleanup = null;

    function normalizePubKey(key) {
      return (key || "").toLowerCase().replace(/\s/g, "");
    }
    function findNodeByPubKey(nodes, key) {
      const k = normalizePubKey(key);
      return k
        ? (nodes.find((n) => normalizePubKey(n.public_key) === k) ?? null)
        : null;
    }

    async function refreshMap({
      clusteringZoom = 0,
      targetNodeKey = null,
    } = {}) {
      if (pendingClusterPopupCleanup) {
        pendingClusterPopupCleanup();
        pendingClusterPopupCleanup = null;
      }

      let nodes;
      if (filtersRestrictMapView()) {
        nodes = app.filteredNodes;
      } else {
        nodes =
          app.filteredNodes.length > 0 ? app.filteredNodes : app.nodes;
      }
      if (targetNodeKey) {
        const target = findNodeByPubKey(app.nodes, targetNodeKey);
        if (target && !nodes.includes(target)) {
          nodes = [...nodes, target];
        }
      }

      map.removeLayer(markerClusterGroup);

      markerClusterGroup = L.markerClusterGroup({
        disableClusteringAtZoom: clusteringZoom || app.clusteringZoom,
        chunkedLoading: true,
      });
      attachClusterClickHandler(markerClusterGroup);

      const markers = nodes.map((n) => n.marker).filter(Boolean);
      markerClusterGroup.addLayers(markers);

      map.addLayer(markerClusterGroup);

      const urlNodeKey = normalizePubKey(
        app.urlParams.node || new URLSearchParams(location.search).get("node"),
      );
      if (urlNodeKey) {
        markerClusterGroup.on("clusterclick", function (e) {
          const markers = e.layer.getAllChildMarkers();
          const targetMarker = markers.find((m) => {
            const node = app.nodes.find((n) => n.marker === m);
            return node && normalizePubKey(node.public_key) === urlNodeKey;
          });
          if (targetMarker) {
            let done = false;
            const cluster = markerClusterGroup;
            const onExpand = () => {
              if (done) return;
              done = true;
              pendingClusterPopupCleanup = null;
              cluster.off("spiderfied", onExpand);
              map.off("moveend", onExpand);
              if (targetMarker._map && cluster.hasLayer(targetMarker)) {
                setTimeout(() => {
                  try {
                    ensurePopup(targetMarker);
                    targetMarker.openPopup();
                  } catch (_) {}
                }, 100);
              }
            };
            pendingClusterPopupCleanup = () => {
              done = true;
              cluster.off("spiderfied", onExpand);
              map.off("moveend", onExpand);
            };
            cluster.once("spiderfied", onExpand);
            map.once("moveend", onExpand);
          }
        });
      }

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
          }: missing marker (no coordinates)`,
        );
        return;
      }
      ensurePopup(node.marker);
      node.marker.openPopup();
      map.flyTo(node.marker.getLatLng(), 19);
      app.search = "";
    }

    /** Focus map on node and open popup when arriving via ?node=<public_key>. */
    function focusNodeFromUrl(node) {
      const lat = node.adv_lat;
      const lon = node.adv_lon;
      if (lat == null || lon == null) return;

      const typeKey = String(node.type || 1);
      const icon = icons.none?.[typeKey] ?? icons.none["1"];
      const tempMarker = L.marker([lat, lon], { icon, title: node.adv_name });
      const deepLinkPopup = L.popup({
        ...getLeafletNodePopupSize(),
        content: () => getTable(node, auth, app.nodes),
      });
      tempMarker.bindPopup(deepLinkPopup);
      bindPopupQrRefill(deepLinkPopup, () =>
        tempMarker
          .getPopup()
          ?.getElement()
          ?.querySelector(".leaflet-popup-content"),
      );
      tempMarker.on("popupopen", () => {
        setTimeout(() => {
          fillNodeQrSlotFromPopup(
            tempMarker
              .getPopup()
              ?.getElement()
              ?.querySelector(".leaflet-popup-content"),
          );
        }, 0);
      });
      tempMarker.on("popupclose", () => {
        delete app.urlParams.node;
        map.removeLayer(tempMarker);
      });

      map.addLayer(tempMarker);
      map.invalidateSize();

      const zoom = 18;
      const target = L.latLng(lat, lon);
      map.setView(target, zoom, { animate: false });
      // Centering the node leaves the tall popup crowding the top; bias view so the
      // marker sits ~3/4 down the map pane (room above for popup).
      const size = map.getSize();
      if (size.x > 0 && size.y > 0) {
        const verticalFraction = 3 / 4;
        const biasPx = size.y * 0.5 - size.y * verticalFraction;
        const newCenter = map.containerPointToLatLng(
          L.point(size.x / 2, size.y / 2 + biasPx),
        );
        map.setView(newCenter, zoom, { animate: false });
      }

      const openPopup = () => {
        map.off("moveend", openPopup);
        try {
          tempMarker.openPopup();
        } catch {}
      };
      map.once("moveend", openPopup);
      setTimeout(openPopup, 400);
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
        `<b>${highlightString}</b>`,
      );
    }

    function clearFilters() {
      app.nodeFilter = [1, 2, 3, 4];
      app.sourceFilter = [...DEFAULT_SOURCE_FILTER];
      app.claimedFilter = [...DEFAULT_CLAIMED_FILTER];
      app.fromDate = DEFAULT_MAP_DATE_STR;
      app.fromInsertDate = DEFAULT_MAP_DATE_STR;
      app.cityFilter = "";
      app.freqFilter =
        app.availableFreqs.length > 0 ? [...app.availableFreqs] : [];
      app.clusteringZoom = DEFAULT_CLUSTERING_ZOOM;
      // Clear filtered nodes to show all nodes
      app.filteredNodes = [];
      // Clear URL parameters
      delete app.urlParams.nodes;
      delete app.urlParams.node;
      delete app.urlParams.source;
      delete app.urlParams.claimed;
      delete app.urlParams.date;
      delete app.urlParams.dateInsert;
      delete app.urlParams.city;
      delete app.urlParams.freq;
      delete app.urlParams.cluster;
      // Filter watch refreshes the map when nodeFilter / source / … change.
    }

    async function downloadNodes() {
      try {
        app.loading = true;
        const [nodesReq] = await Promise.all([
          fetch(apiUrl),
          getPresets().catch((err) => {
            console.warn("Preset loading error (using fallback):", err);
          }),
        ]);
        app.nodes = await nodesReq.json();

        const byType = {};
        const freqSet = new Set();
        const CHUNK_SIZE = 2000;
        const list = app.nodes;

        for (let offset = 0; offset < list.length; offset += CHUNK_SIZE) {
          const end = Math.min(offset + CHUNK_SIZE, list.length);
          if (offset > 0) await new Promise((r) => setTimeout(r, 0));

          for (let i = offset; i < end; i++) {
            const node = list[i];
            if (node.adv_lat == null || node.adv_lon == null) {
              console.warn(
                `Skipping node ${
                  node.adv_name || node.public_key
                }: missing coordinates`,
              );
              continue;
            }

            const updateStatus = getNodeUpdateStatus(node);
            const typeKey = String(node.type || 1);
            let icon =
              icons[updateStatus]?.[typeKey] ??
              icons.none?.[typeKey] ??
              icons.none["1"];

            (byType[node.type] ??= []).push(node);

            if (node.type === 1) {
              const label = ntools.getNameIconLabel(node.adv_name);
              const color = ntools.getColourForName(node.adv_name);
              icon = getSvgIcon(label, color, updateStatus);
            }

            const isOwned =
              auth.authenticated &&
              auth.user &&
              node.discord_owner_id &&
              String(node.discord_owner_id) === String(auth.user.id);
            const isClaimed = Boolean(node.discord_owner_id);

            node.isOwned = isOwned;

            if (
              (isClaimed || isOwned) &&
              icon.options &&
              Object.prototype.hasOwnProperty.call(icon.options, "iconUrl") &&
              icon.options.iconUrl
            ) {
              const iconUrl = icon.options.iconUrl;
              const iconSize = icon.options.iconSize || [32, 32];
              const iconAnchor = icon.options.iconAnchor || [17, 17];
              const popupAnchor = icon.options.popupAnchor || [0, -16];
              const existingClassName = icon.options.className || "";
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
                iconUrl,
                iconSize,
                iconAnchor,
                popupAnchor,
                className: newClassName,
              });
            }

            const marker = (node.marker = markRaw(
              L.marker([node.adv_lat, node.adv_lon], {
                icon,
                title: node.adv_name,
              }),
            ));

            markerToNode.set(marker, node);

            node.status = updateStatus;
            node.coords = `${node.adv_lat.toFixed(4)}, ${node.adv_lon.toFixed(
              4,
            )}`;
            node.lastAdvertDate = new Date(node.last_advert);
            node.insertDate = new Date(node.inserted_date);
            node.updatedDate = node.updated_date && new Date(node.updated_date);

            const f = node.params?.freq;
            if (f != null && !Number.isNaN(Number(f))) {
              freqSet.add(Math.floor(Number(f)));
            }
          }
        }

        nodesByTypeRef.value = byType;
        app.availableFreqs = [...freqSet].sort((a, b) => a - b);

        const freqFromUrl = String(urlParams.freq ?? "").trim();
        if (
          !freqFromUrl &&
          app.freqFilter.length === 0 &&
          app.availableFreqs.length > 0
        ) {
          app.freqFilter = [...app.availableFreqs];
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
          }\n\nIf this issue persists, please report it in our Discord support channel:\n${supportLink}`,
        );
      } finally {
        app.loading = false;
      }
    }

    // Declare before clearFilters() / refreshMap() so it's in scope when they run
    let markerClusterGroup = L.markerClusterGroup({
      disableClusteringAtZoom: app.clusteringZoom,
      chunkedLoading: true,
    });
    attachClusterClickHandler(markerClusterGroup);

    // Apply URL params to initial state (before clearFilters would overwrite)
    const hasUrlParams =
      urlParams.nodes ||
      urlParams.node ||
      urlParams.public_key ||
      urlParams.cluster ||
      urlParams.date ||
      urlParams.dateInsert ||
      urlParams.city ||
      urlParams.source ||
      urlParams.claimed ||
      urlParams.freq;
    if (hasUrlParams) {
      if (urlParams.nodes) app.nodeFilter = urlParams.nodes.split(",");
      if (urlParams.date) app.fromDate = urlParams.date;
      if (urlParams.dateInsert) app.fromInsertDate = urlParams.dateInsert;
      if (urlParams.cluster)
        app.clusteringZoom = Number(urlParams.cluster) || 11;
      if (urlParams.city) app.cityFilter = urlParams.city;
      if (urlParams.source) app.sourceFilter = urlParams.source.split(",");
      if (urlParams.claimed) app.claimedFilter = urlParams.claimed.split(",");
      if (urlParams.freq) {
        app.freqFilter = urlParams.freq
          .split(",")
          .map((x) => Number(x))
          .filter((n) => !Number.isNaN(n));
      }
    } else {
      clearFilters();
    }

    if (!String(app.fromDate ?? "").trim()) {
      app.fromDate = DEFAULT_MAP_DATE_STR;
    }
    if (!String(app.fromInsertDate ?? "").trim()) {
      app.fromInsertDate = DEFAULT_MAP_DATE_STR;
    }
    if (!String(urlParams.nodes ?? "").trim()) {
      app.nodeFilter = [1, 2, 3, 4];
    }

    const filtersActive = computed(
      () =>
        app.filteredNodes.length &&
        app.nodes.length !== app.filteredNodes.length,
    );

    watch(
      [
        () => app.nodeFilter,
        () => app.sourceFilter,
        () => app.claimedFilter,
        () => app.fromDate,
        () => app.fromInsertDate,
        () => app.cityFilter,
        () => app.freqFilter,
        () => app.nodes.length,
      ],
      () => {
        if (!app.nodeFilter.length) {
          app.nodeFilter.push(1, 2, 3, 4);
        }
        const fromDate = new Date(app.fromDate);
        const fromInsertDate = new Date(app.fromInsertDate);
        const cityFilterLower = app.cityFilter.toLowerCase().trim();
        const hasInsertFilter =
          app.fromInsertDate &&
          app.fromInsertDate.trim() !== "" &&
          !isNaN(fromInsertDate.getTime());
        const hasFreqFilter = freqFilterIsRestrictive();
        const freqSet = hasFreqFilter
          ? new Set(app.freqFilter.map((x) => Number(x)))
          : null;
        // One entry per type (avoids duplicates when nodeFilter has 2 and "2", or repeated URL values)
        const uniqueTypeKeys = [
          ...new Set(app.nodeFilter.map((t) => String(Number(t)))),
        ];
        const merged = uniqueTypeKeys
          .flatMap((type) => {
            const arr = app.nodesByType[type] ?? app.nodesByType[Number(type)];
            return Array.isArray(arr) ? arr : [];
          })
          .filter(
            (node) =>
              node &&
              (node.updatedDate
                ? node.updatedDate > fromDate
                : node.insertDate > fromDate) &&
              (!hasInsertFilter || node.insertDate > fromInsertDate) &&
              (!hasFreqFilter ||
                (node.params?.freq != null &&
                  freqSet.has(Math.floor(Number(node.params.freq))))) &&
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
                    node.discord_owner_name.trim() === ""))),
          );
        const seenPk = new Set();
        filteredNodesRef.value = merged.filter((node) => {
          const k = node?.public_key;
          if (k == null || seenPk.has(k)) return false;
          seenPk.add(k);
          return true;
        });
        if (nodeFilterIsAllTypes()) {
          delete app.urlParams.nodes;
        } else {
          app.urlParams.nodes = app.nodeFilter.map((t) => String(t)).join(",");
        }
        if (
          String(app.fromDate ?? "").trim() &&
          app.fromDate !== DEFAULT_MAP_DATE_STR
        ) {
          app.urlParams.date = app.fromDate;
        } else {
          delete app.urlParams.date;
        }
        const ins = String(app.fromInsertDate ?? "").trim();
        if (ins && ins !== DEFAULT_MAP_DATE_STR) {
          app.urlParams.dateInsert = app.fromInsertDate;
        } else {
          delete app.urlParams.dateInsert;
        }
        if (app.cityFilter) {
          app.urlParams.city = app.cityFilter;
        } else {
          delete app.urlParams.city;
        }
        if (
          app.sourceFilter.length > 0 &&
          !isDefaultSourceFilter(app.sourceFilter)
        ) {
          app.urlParams.source = app.sourceFilter.join(",");
        } else {
          delete app.urlParams.source;
        }
        if (
          app.claimedFilter.length > 0 &&
          !isDefaultClaimedFilter(app.claimedFilter)
        ) {
          app.urlParams.claimed = app.claimedFilter.join(",");
        } else {
          delete app.urlParams.claimed;
        }
        if (freqFilterIsRestrictive()) {
          app.urlParams.freq = app.freqFilter.join(",");
        } else {
          delete app.urlParams.freq;
        }
        if (app.clusteringZoom === DEFAULT_CLUSTERING_ZOOM) {
          delete app.urlParams.cluster;
        } else {
          app.urlParams.cluster = app.clusteringZoom;
        }
        refreshMap({ download: false });
      },
      { immediate: true },
    );

    watch(
      () => app.clusteringZoom,
      () => {
        if (app.clusteringZoom === DEFAULT_CLUSTERING_ZOOM) {
          delete app.urlParams.cluster;
        } else {
          app.urlParams.cluster = app.clusteringZoom;
        }
        refreshMap({ download: false, clusteringZoom: app.clusteringZoom });
      },
    );

    const stats = computed(() => {
      const nodes = app.nodes;

      if (!nodes || !nodes.length) return [];

      const now = Date.now();
      const msPerDay = 86400000;
      const t1 = now - msPerDay;
      const t7 = now - 7 * msPerDay;
      const t30 = now - 30 * msPerDay;
      let c1 = 0;
      let c7 = 0;
      let c30 = 0;

      for (let i = 0; i < nodes.length; i++) {
        const ins = nodes[i].insertDate || new Date(nodes[i].inserted_date);
        const insertMs = ins.getTime();
        if (Number.isNaN(insertMs)) continue;
        if (insertMs > t1) c1++;
        if (insertMs > t7) c7++;
        if (insertMs > t30) c30++;
      }

      const result = [];
      const companionsCount = nodes.filter((n) => n.type === 1).length;
      const repeatersCount = nodes.filter((n) => n.type === 2).length;
      const roomServersCount = nodes.filter((n) => n.type === 3).length;
      const sensorsCount = nodes.filter((n) => n.type === 4).length;

      let statsString = `<span>all nodes: <b>${nodes.length}</b></span>&nbsp;|`;
      statsString += ` <i class="node-type pointer-help" title="Total client nodes">person</i><b>${companionsCount}</b>&nbsp;|`;
      statsString += ` <i class="node-type pointer-help" title="Total repeater nodes">cell_tower</i><b>${repeatersCount}</b>&nbsp;|`;
      statsString += ` <i class="node-type pointer-help" title="Total room server nodes">forum</i><b>${roomServersCount}</b>`;

      if (sensorsCount > 0) {
        statsString += `&nbsp;| <img src="img/node_types/4.svg" class="node-type pointer-help" style="width: 24px; height: 24px; vertical-align: middle; margin-left: 7px; margin-right: 4px;" title="Total sensor nodes" alt="Sensor"><b>${sensorsCount}</b>`;
      }

      result.push(statsString);
      result.push(
        `<span class="pointer-help" title="Nodes added in last 24 hours">24h: <b>${c1}</b></span>`,
      );
      result.push(
        `<span class="pointer-help" title="Nodes added in last 7 days">7d: <b>${c7}</b></span>`,
      );
      result.push(
        `<span class="pointer-help" title="Nodes added in last 30 days">30d: <b>${c30}</b></span>`,
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
          String(node.discord_owner_id) === String(auth.user.id),
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
          `<span class="pointer-help" title="Your nodes active in last 24 hours">24h: <b>${active24h}</b></span>`,
        );
      }

      if (active7d > 0) {
        result.push(
          `<span class="pointer-help" title="Your nodes active in last 7 days">7d: <b>${active7d}</b></span>`,
        );
      }

      if (active30d > 0) {
        result.push(
          `<span class="pointer-help" title="Your nodes active in last 30 days">30d: <b>${active30d}</b></span>`,
        );
      }

      return result;
    });

    const searchResults = computed(() => {
      if (!app.search) {
        return [];
      }

      const searchIn =
        app.filteredNodes.length > 0 ? app.filteredNodes : app.nodes;
      const searchTerm = app.search.toLowerCase();
      return searchIn
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

    watch(
      () => app.urlParams,
      () => {
        history.replaceState({}, "", `/?${new URLSearchParams(app.urlParams)}`);
      },
      { deep: true },
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

    // Keep search below .stats: bar height changes with viewport, auth row, and wrapped chips
    function adjustSearchPosition() {
      const statsBar = document.querySelector(".stats");
      const body = document.body;
      if (!statsBar || !body.classList.contains("map-page")) return;
      const statsHeight = statsBar.offsetHeight;
      if (statsHeight > 0) {
        body.style.setProperty("--stats-bar-height", `${statsHeight}px`);
      }
    }

    let resizeObserver = null;
    let removeFilterMenuInteractionGuards = null;
    let removeViewportListeners = null;

    onMounted(() => {
      function onMapLayoutRefresh() {
        adjustSearchPosition();
        try {
          map.invalidateSize({ animate: false });
        } catch {
          /* ignore */
        }
      }

      window.addEventListener("resize", onMapLayoutRefresh);

      const vv = window.visualViewport;
      if (vv) {
        vv.addEventListener("resize", onMapLayoutRefresh);
        vv.addEventListener("scroll", onMapLayoutRefresh);
      }

      function onOrientationChange() {
        window.setTimeout(onMapLayoutRefresh, 350);
      }
      window.addEventListener("orientationchange", onOrientationChange);

      removeViewportListeners = () => {
        window.removeEventListener("resize", onMapLayoutRefresh);
        if (vv) {
          vv.removeEventListener("resize", onMapLayoutRefresh);
          vv.removeEventListener("scroll", onMapLayoutRefresh);
        }
        window.removeEventListener("orientationchange", onOrientationChange);
      };

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
        resizeObserver = new ResizeObserver(() => onMapLayoutRefresh());
        resizeObserver.observe(statsBar);
      }

      // Also adjust when auth state changes (affects stats bar height)
      watch(
        () => auth.authenticated,
        () => {
          nextTick(() => requestAnimationFrame(adjustSearchPosition));
        },
      );

      // Check for URL parameters indicating errors
      const loginReturnParams = new URLSearchParams(window.location.search);
      const error = loginReturnParams.get("error");
      const inviteUrl = loginReturnParams.get("invite_url");

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
          window.location.pathname,
        );
      }

      // Check authentication status first
      checkAuth().then(() => {
        // Watch for auth changes and update popups and markers
        watch(
          () => auth.authenticated,
          () => {
            refreshOpenPopups();

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
                  if (isClaimed) iconElement.classList.add("claimed");
                  else iconElement.classList.remove("claimed");
                  if (isOwned) iconElement.classList.add("user-owned");
                  else iconElement.classList.remove("user-owned");
                }
              }
            });
          },
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
          },
        );
      });

      downloadNodes().then(() => {
        const qp = app.urlParams;
        if (qp.nodes) {
          app.nodeFilter = qp.nodes.split(",");
        }
        if (qp.date) {
          app.fromDate = qp.date;
        }
        if (qp.dateInsert) {
          app.fromInsertDate = qp.dateInsert;
        }
        if (qp.cluster) {
          app.clusteringZoom = Number(qp.cluster) || 11;
        }
        if (qp.city) {
          app.cityFilter = qp.city;
        }
        if (qp.source) {
          app.sourceFilter = qp.source.split(",");
        }
        if (qp.claimed) {
          app.claimedFilter = qp.claimed.split(",");
        }
        if (qp.freq) {
          app.freqFilter = qp.freq
            .split(",")
            .map((x) => Number(x))
            .filter((n) => !Number.isNaN(n));
        }

        const searchParams = new URLSearchParams(location.search);
        const nodeKey = (
          searchParams.get("node") ||
          searchParams.get("public_key") ||
          ""
        ).trim();
        let targetNode = nodeKey ? findNodeByPubKey(app.nodes, nodeKey) : null;
        if (
          targetNode &&
          (targetNode.adv_lat == null || targetNode.adv_lon == null)
        ) {
          targetNode = null;
        }
        if (targetNode) {
          const type = String(Number(targetNode.type) || 1);
          if (app.nodeFilter.length > 0 && !app.nodeFilter.includes(type)) {
            app.nodeFilter = [...app.nodeFilter, type];
          }
        }

        nextTick(() => {
          refreshMap({ targetNodeKey: nodeKey || undefined });
        });

        if (nodeKey && !targetNode) {
          console.warn(
            `[Map] Node not found for ?node=${nodeKey.slice(0, 16)}... (${app.nodes.length} nodes loaded)`,
          );
        }
        if (targetNode) {
          nextTick(() => {
            setTimeout(() => focusNodeFromUrl(targetNode), 150);
          });
        }
      });

      // Fix slider fill: Beer CSS updates ---start/---end on input; when menu opens
      // the slider may not have been painted yet. Trigger input to refresh the fill.
      const menu = document.getElementById("node-filter");
      if (menu) {
        const observer = new MutationObserver(() => {
          if (menu.classList.contains("active")) {
            const slider = document.getElementById("clustering-zoom-slider");
            if (slider) {
              // Small delay so Beer CSS can measure after menu is visible
              setTimeout(() => {
                slider.dispatchEvent(new Event("input", { bubbles: true }));
              }, 10);
            }
          }
        });
        observer.observe(menu, {
          attributes: true,
          attributeFilter: ["class"],
        });
        onBeforeUnmount(() => observer.disconnect());
      }

      // Beer adds document.body "click" in CAPTURE phase (beer.min.js addEventListener(..., true)).
      // Its handler runs before the event reaches checkboxes inside #node-filter and schedules
      // closing the menu ~90ms later — so the drawer vanished on every in-menu click/release.
      // Register our listener at mount (before Beer attaches when the menu opens) with
      // capture: true so we run first on body; stopImmediatePropagation skips only Beer's
      // body listener — propagation continues to descendants so inputs still work.
      function filterMenuBodyClickGuard(e) {
        const menu = document.getElementById("node-filter");
        if (!menu?.classList.contains("active")) return;
        if (menu.contains(e.target)) {
          e.stopImmediatePropagation();
        }
      }
      document.body.addEventListener("click", filterMenuBodyClickGuard, true);

      removeFilterMenuInteractionGuards = () => {
        document.body.removeEventListener(
          "click",
          filterMenuBodyClickGuard,
          true,
        );
      };
    });

    onBeforeUnmount(() => {
      removeViewportListeners?.();
      removeViewportListeners = null;
      document.body.style.removeProperty("--stats-bar-height");
      removeFilterMenuInteractionGuards?.();
      removeFilterMenuInteractionGuards = null;
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
