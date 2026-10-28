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

// Page language: src/shared/i18n.js (loaded in <head>) fetches the messages and translates the static page first.
const I18N = window.BEmeshI18n;
await I18N.ready;
const t = I18N.t;

// MDI path (same as @mdi/js).
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
  if (!val) return t("map.na");
  const copyTitle =
    copyRole === "updater"
      ? t("map.copyUpdaterKey")
      : t("map.copyInserterKey");
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
    ? ` <a class="node-popup__map-jump" href="?node=${encodeURIComponent(val)}" title="${escapeAttrHtml(t("map.goToNode"))}" aria-label="${escapeAttrHtml(t("map.goToNode"))}"><svg width="14" height="14" viewBox="0 0 24 24" aria-hidden="true"><path d="${mdiOpenInNew}" fill="currentColor"/></svg></a>`
    : "";
  return copyable + gotoLink;
}

/** Node type name in the page language (1 client, 2 repeater, 3 room server, 4 sensor). */
const typeName = (n) => t(`map.type.${n}`);

/** Bootstrap Icons classes for node types (shown in popup header). */
function getNodeTypeMeta(node) {
  const raw = parseInt(String(node?.type ?? 1), 10);
  const typeNum = Number.isFinite(raw) && raw >= 1 && raw <= 4 ? raw : 1;
  const iconByType = {
    1: "bi bi-phone",
    2: "bi bi-broadcast-pin",
    3: "bi bi-people-fill",
    4: "bi bi-thermometer-half",
  };
  return {
    typeNum,
    icon: iconByType[typeNum] || iconByType[1],
    label: typeName(typeNum),
  };
}

/** Material icon + tooltip for map node `source`; shown in popup header (right). */
function getNodeSourceHeaderMeta(node) {
  const raw = node?.source;
  if (raw == null || String(raw).trim() === "") return null;
  const lowerVal = String(raw).toLowerCase().trim();
  const safeClass = /^[a-z0-9_-]+$/.test(lowerVal) ? lowerVal : "other";
  let tooltipText = "";
  let icon = "bi bi-tag";
  /** Optional link (e.g. uploader repo), same as table column. */
  let href = null;

  if (lowerVal === "uploader") {
    tooltipText = t("map.source.uploader");
    icon = "bi bi-cloud-upload";
  } else if (lowerVal === "app") {
    tooltipText = t("map.source.app");
    icon = "bi bi-grid-3x3-gap-fill";
  } else if (lowerVal === "web") {
    tooltipText = t("map.source.web");
    icon = "bi bi-globe";
  } else if (lowerVal === "discord") {
    tooltipText = t("map.source.discord");
    icon = "bi bi-chat-dots-fill";
  } else {
    const cap = lowerVal.charAt(0).toUpperCase() + lowerVal.slice(1);
    tooltipText = t("map.source.other", { name: cap });
    icon = "bi bi-database";
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
        `<span style="color: #4CAF50; font-weight: bold;">✓ ${escapeAttrHtml(t("map.copied"))}</span>`;
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
        `<span style="color: #f44336; font-weight: bold;">✗ ${escapeAttrHtml(t("map.copyFailed"))}</span>`;
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
      ? `<span class="node-qr-wrap-feedback node-qr-wrap-feedback--ok${inlineCls}"><i class="bi bi-check-lg" aria-hidden="true"></i> ${escapeAttrHtml(t("map.copied"))}</span>`
      : `<span class="node-qr-wrap-feedback node-qr-wrap-feedback--err${inlineCls}"><i class="bi bi-exclamation-triangle-fill" aria-hidden="true"></i> ${escapeAttrHtml(t("map.copyFailed"))}</span>`;
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
  bw: { labelKey: "map.radio.bw", unit: " kHz" },
  freq: { labelKey: "map.radio.freq", unit: "MHz" },
  sf: { labelKey: "map.radio.sf", unit: "" },
  cr: { labelKey: "map.radio.cr", unit: "" },
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
    return t("map.na");
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
    html += `<div>${escapeAttrHtml(t(meta.labelKey))}: ${numStr}${suffix}</div>`;
  }

  return html || t("map.na");
}

/** Parse API/DB timestamp as UTC epoch ms. Naive ``YYYY-MM-DD HH:MM:SS`` => UTC. */
function parseUtcMs(dateString) {
  if (dateString == null || dateString === "") return NaN;
  const s = String(dateString).trim();
  if (!s) return NaN;
  if (/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}$/.test(s)) {
    return Date.parse(s.replace(" ", "T") + "Z");
  }
  return Date.parse(s);
}

// Format date as relative time (upstream's units, worded by Intl.RelativeTimeFormat in the page language)
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
      return new Intl.RelativeTimeFormat(I18N.locale(), { numeric: "always" }).format(-count, unit.name);
    }
  }

  return t("map.justNow");
}

/** Tight relative labels for narrow UI (e.g. popup activity strip): no “ago”, short units. */
function timeAgoCompact(msec) {
  const seconds = Math.floor((Date.now() - msec) / 1000);
  if (seconds < 45) return t("map.ago.now");

  const tiers = [
    { limit: 31536000, unit: "y" },
    { limit: 2592000, unit: "mo" },
    { limit: 86400, unit: "d" },
    { limit: 3600, unit: "h" },
    { limit: 60, unit: "min" },
  ];

  for (const { limit, unit } of tiers) {
    const count = Math.floor(seconds / limit);
    if (count >= 1) return t(`map.ago.${unit}`, { count });
  }
  return t("map.ago.now");
}

function formatRelativeTimeCompact(dateString) {
  if (!dateString) return t("map.na");
  const ms = parseUtcMs(dateString);
  if (Number.isNaN(ms)) return t("map.invalidDate");
  const date = new Date(ms);
  const titleCET = formatInCET(date);
  const long = timeAgo(ms);
  const short = timeAgoCompact(ms);
  const tip = `${titleCET} · ${long}`;
  return `<time datetime="${escapeAttrHtml(dateString)}" title="${escapeAttrHtml(tip)}">${escapeAttrHtml(short)}</time>`;
}

// Format date in CET/CEST with timezone label (for tooltips and display)
// Note: timeZoneName cannot be used with dateStyle/timeStyle, so we use explicit options.
function formatInCET(date) {
  if (!(date instanceof Date) || isNaN(date.getTime())) return t("map.invalidDate");
  return new Intl.DateTimeFormat(I18N.locale(), {
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
  if (!dateString) return t("map.na");

  const ms = parseUtcMs(dateString);
  if (Number.isNaN(ms)) return t("map.invalidDate");

  const dt = new Date(ms);
  const titleCET = formatInCET(dt);
  return `<time datetime="${escapeAttrHtml(dateString)}" title="${escapeAttrHtml(titleCET)}">${timeAgo(
    ms,
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
  if (!text) return t("map.na");
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
      : t("map.clickToCopy");
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
    `<a href="#" class="coords-menu-toggle" onclick="event.preventDefault();event.stopPropagation();this.parentElement.classList.toggle('open');return false;" title="${escapeAttrHtml(t("map.coordsMenu"))}">${toggleLabelEscaped}</a>` +
    `<span class="coords-menu">${createCopyableElement(plain, t("map.copyCoords"))}<a href="${osm}" target="_blank" rel="noopener noreferrer">OpenStreetMap</a><a href="${gMap}" target="_blank" rel="noopener noreferrer">Google Maps</a><a href="${mapy}" target="_blank" rel="noopener noreferrer">Mapy.com</a></span>` +
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
  const name = (titleEl?.textContent || "").trim() || t("map.unnamed");
  const typeLabel =
    (
      typeIcon?.getAttribute("aria-label") ||
      typeIcon?.getAttribute("title") ||
      ""
    ).trim() || t("map.node");
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
  backdrop.setAttribute("aria-label", t("map.qrEnlarged", { name: ctx.name }));

  const panel = document.createElement("div");
  panel.className = "node-qr-enlarge-panel";
  panel.addEventListener("click", (e) => e.stopPropagation());

  const closeBtn = document.createElement("button");
  closeBtn.type = "button";
  closeBtn.className = "node-qr-enlarge-close";
  closeBtn.setAttribute("aria-label", t("map.close"));
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
    `<a href="#" class="node-popup-action node-popup-action--external node-popup-action--icon-only node-popup-analyzer-menu__toggle" onclick="event.preventDefault();event.stopPropagation();this.parentElement.classList.toggle('open');return false;" title="${escapeAttrHtml(t("map.analyzer"))}" aria-label="${escapeAttrHtml(t("map.analyzer"))}"><i class="bi bi-search" aria-hidden="true"></i></a>` +
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

/**
 * The node card grows once its QR code is drawn; pan again so it stays clear of the search box.
 * Call from a marker's popupopen, and stopWatchingPopupGrowth from popupclose.
 */
function watchPopupGrowth(marker, popup) {
  const root = marker.getPopup()?.getElement();
  if (!root || !("ResizeObserver" in window)) return;
  marker._popupResize?.disconnect();
  marker._popupResize = new ResizeObserver(() => {
    if (popup.isOpen()) popup._adjustPan();
  });
  marker._popupResize.observe(root);
}

function stopWatchingPopupGrowth(marker) {
  marker._popupResize?.disconnect();
  marker._popupResize = null;
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
    labelKey: "map.col.coords",
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
    labelKey: "map.col.name",
  },
  status: {
    labelKey: "map.col.freshness",
    value: (val) => {
      const desc = statusDesc(val);
      const statusClass =
        val && Object.prototype.hasOwnProperty.call(updateStatusDesc, val)
          ? `update-${val}`
          : "update-none";
      return `<span class="status-dot ${statusClass}" title="${escapeAttrHtml(desc)}"></span>`;
    },
  },
  inserted_date: {
    labelKey: "map.inserted",
    value: (val) => formatRelativeTime(val),
  },
  updated_date: {
    labelKey: "map.updated",
    value: (val) => formatRelativeTime(val),
  },
  last_advert: {
    labelKey: "map.lastAdvert",
    value: (val) => formatRelativeTime(val),
  },
  public_key: {
    labelKey: "map.publicKey",
    value: (val) =>
      createCopyableElement(val, shortenForDisplay(val.toUpperCase(), 22)),
  },
  inserted_by: {
    labelKey: "map.col.insertedBy",
    value: (val, node, nodes = []) =>
      formatInserterUpdater(val, nodes, node, "inserter"),
  },
  updated_by: {
    labelKey: "map.updatedBy",
    value: (val, node, nodes = []) =>
      formatInserterUpdater(val, nodes, node, "updater"),
  },
  type: {
    labelKey: "map.col.type",
    value: (val) => typeName(val),
  },
  params: {
    labelKey: "map.col.radio",
    value: (val) => formatRadioParams(val),
  },
  link: {
    labelKey: "map.col.link",
    value: (val) => {
      const link =
        typeof val === "string"
          ? val.startsWith("meshcore://")
            ? val
            : val
              ? `meshcore://${val}`
              : ""
          : "";
      if (!link) return t("map.na");
      return createCopyableElement(link, shortenForDisplay(link, 24));
    },
  },
  city: {
    labelKey: "map.col.city",
    value: (val) => (val ? I18N.municipalityName(val) : t("map.unknown")),
  },
  discord_owner_name: {
    labelKey: "map.col.owner",
    value: (val, node) => {
      // This function is only called if val exists (field is shown)
      const ownerId = node?.discord_owner_id;
      if (ownerId) {
        // Create clickable Discord DM link
        // discord:// works for desktop Discord app, https:// works for web
        return `<a href="https://discord.com/users/${ownerId}" target="_blank" title="${escapeAttrHtml(t("map.sendDm", { name: val }))}">@${val}</a>`;
      }
      return `@${val}`;
    },
  },
  source: {
    labelKey: "map.col.source",
    value: (val) => {
      if (!val) return t("map.na");
      const lowerVal = val.toLowerCase();
      // Capitalize first letter only
      const capitalizedVal =
        lowerVal.charAt(0).toUpperCase() + lowerVal.slice(1);

      // Define tooltip text based on source type
      let tooltipText = "";
      if (["uploader", "app", "web", "discord"].includes(lowerVal)) {
        tooltipText = escapeAttrHtml(t(`map.source.${lowerVal}`));
      }

      // Create the value with tooltip
      let valueHtml = `<span class="pointer-help" title="${tooltipText}" style="cursor: help; text-decoration: underline; text-decoration-style: dotted;">${capitalizedVal}</span>`;

      // If source is "uploader", add a clickable icon next to it
      if (lowerVal === "uploader") {
        valueHtml += ` <a href="https://github.com/recrof/map.meshcore.io-uploader" target="_blank" rel="noopener noreferrer" title="${escapeAttrHtml(t("map.uploaderOnGithub"))}" style="color: #4CAF50; text-decoration: none; margin-left: 4px;">🔗</a>`;
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
  const displayCity = city ? I18N.municipalityName(city) : t("map.unknown");
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
      label: t("map.inserted"),
      icon: "bi bi-rocket-takeoff",
    },
    {
      key: "updated_date",
      label: t("map.updated"),
      icon: "bi bi-arrow-repeat",
    },
    {
      key: "last_advert",
      label: t("map.lastAdvert"),
      icon: "bi bi-rss",
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
        `<span class="node-popup__activity-icon" aria-hidden="true"><i class="${icon}"></i></span>` +
        `<span class="node-popup__activity-copy">` +
        `<span class="node-popup__activity-label">${escapeAttrHtml(label)}</span>` +
        `<span class="node-popup__activity-value">${valueHtml}</span>` +
        `</span></div>`
      );
    })
    .join("");

  return `<div class="node-popup__activity" role="list" aria-label="${escapeAttrHtml(t("map.datesLabel"))}">${cells}</div>`;
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
      `<div class="node-popup__panel-kicker"><span class="node-popup__panel-icon" aria-hidden="true"><i class="bi bi-sliders" aria-hidden="true"></i></span><span>${escapeAttrHtml(t("map.radio"))}</span></div>` +
      `<div class="node-popup__panel-body"><span class="node-popup__muted">${escapeAttrHtml(t("map.notSpecified"))}</span></div></div>`
    );
  }
  const preset = matchFrequencyPreset(params);
  if (preset) {
    const presetTitle = escapeAttrHtml(presetHoverDetailsText(preset));
    return (
      `<div class="node-popup__panel-block">` +
      `<div class="node-popup__panel-kicker"><span class="node-popup__panel-icon" aria-hidden="true"><i class="bi bi-sliders" aria-hidden="true"></i></span><span>${escapeAttrHtml(t("map.radio"))}</span></div>` +
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
      `<span class="node-popup__chip">${escapeAttrHtml(t("map.chip.bw", { bw: String(bw) }))}</span>`,
    );
  }
  if (Number.isFinite(cr)) {
    chips.push(
      `<span class="node-popup__chip">CR\u00a0${escapeAttrHtml(String(cr))}</span>`,
    );
  }
  const inner = chips.length
    ? `<div class="node-popup__radio-custom"><span class="node-popup__chip-hint node-popup__chip-hint--lead">${escapeAttrHtml(t("map.custom"))}</span><div class="node-popup__chip-row">${chips.join("")}</div></div>`
    : `<span class="node-popup__muted">${escapeAttrHtml(t("map.notSpecified"))}</span>`;
  return (
    `<div class="node-popup__panel-block">` +
    `<div class="node-popup__panel-kicker"><span class="node-popup__panel-icon" aria-hidden="true"><i class="bi bi-sliders" aria-hidden="true"></i></span><span>${escapeAttrHtml(t("map.radio"))}</span></div>` +
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
        `<div class="node-popup__panel-kicker"><span class="node-popup__panel-icon" aria-hidden="true"><i class="bi bi-key" aria-hidden="true"></i></span><span>${escapeAttrHtml(t("map.publicKey"))}</span></div>` +
        `<div class="node-popup__panel-body"><div class="node-popup__pk-wrap" title="${escapeAttrHtml(t("map.copyPublicKey"))}">${copyHtml}</div></div></div>`,
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
      inner = `<div class="node-popup__prov-row"><span class="node-popup__prov-label">${escapeAttrHtml(t("map.addedUpdatedBy"))}</span><span class="node-popup__prov-value">${formatInserterUpdater(ins, nodes, node, "inserter")}</span></div>`;
    } else {
      if (insPresent) {
        inner += `<div class="node-popup__prov-row"><span class="node-popup__prov-label">${escapeAttrHtml(t("map.addedBy"))}</span><span class="node-popup__prov-value">${formatInserterUpdater(ins, nodes, node, "inserter")}</span></div>`;
      }
      if (updPresent) {
        inner += `<div class="node-popup__prov-row"><span class="node-popup__prov-label">${escapeAttrHtml(t("map.updatedBy"))}</span><span class="node-popup__prov-value">${formatInserterUpdater(upd, nodes, node, "updater")}</span></div>`;
      }
    }
    blocks.push(
      `<div class="node-popup__panel-block">` +
        `<div class="node-popup__panel-kicker"><span class="node-popup__panel-icon" aria-hidden="true"><i class="bi bi-clock-history" aria-hidden="true"></i></span><span>${escapeAttrHtml(t("map.uploaderIdentity"))}</span></div>` +
        `<div class="node-popup__panel-body node-popup__panel-body--prov">${inner}</div></div>`,
    );
  }

  const owner = node.discord_owner_name?.trim();
  if (owner) {
    const oid = node.discord_owner_id;
    const at = escapeAttrHtml(owner);
    const linkBody =
      oid != null && String(oid).trim() !== ""
        ? `<a class="node-popup__discord-user" href="https://discord.com/users/${encodeURIComponent(String(oid))}" target="_blank" rel="noopener noreferrer" title="${escapeAttrHtml(t("map.dmOwner"))}" aria-label="${escapeAttrHtml(t("map.dmOwner"))}">@${at}</a>`
        : `<span class="node-popup__discord-user node-popup__discord-user--bare">@${at}</span>`;
    blocks.push(
      `<div class="node-popup__panel-block node-popup__panel-block--owner">` +
        `<div class="node-popup__panel-kicker"><span class="node-popup__panel-icon node-popup__panel-icon--discord" aria-hidden="true"><i class="bi bi-shield-check" aria-hidden="true"></i></span><span>${escapeAttrHtml(t("map.claimedBy"))}</span></div>` +
        `<div class="node-popup__panel-body">${linkBody}</div></div>`,
    );
  }

  return `<section class="node-popup__panel" aria-label="${escapeAttrHtml(t("map.panelLabel"))}">${blocks.join("")}</section>`;
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
          `<div class="node-popup__pk-wrap" title="${escapeAttrHtml(t("map.copyPublicKey"))}">` +
          `<span class="node-qr-card__field-text">` +
          `<span class="node-qr-card__field-slice">${escapeAttrHtml(display)}</span>` +
          `</span></div></div>` +
          `<span class="node-qr-card__hint">${escapeAttrHtml(t("map.publicKey"))}</span>`
        );
      })()
    : `<div class="node-qr-card__bar-start" aria-hidden="true"></div>`;
  const escapedMc = escapeAttrHtml(meshcoreCopyLink);
  const linkSnippet = shortenForDisplay(meshcoreCopyLink, 26);
  const qrBlock = qrUri
    ? `<div class="node-qr-card"${dataPublicKeyAttr} role="button" tabindex="0" aria-label="${escapeAttrHtml(t("map.copyLink"))}" data-meshcore-copy="${escapedMc}"><div class="node-qr-card__header">${qrHeaderPk}</div><div class="node-qr-card__inner"><div class="node-qr-slot" data-meshcore-link="${escapeAttrHtml(qrUri)}"></div></div><div class="node-qr-card__footer"><div class="node-qr-card__bar-start"><div class="node-popup__pk-wrap" title="${escapeAttrHtml(t("map.copyLink"))}"><span class="node-qr-card__field-text"><span class="node-qr-card__field-slice">${escapeAttrHtml(linkSnippet)}</span></span></div></div><span class="node-qr-card__hint">${escapeAttrHtml(t("map.link"))}</span></div></div>`
    : "";

  const statusKey = node.status || "none";
  const freshness = statusDesc(statusKey);
  const statusDotClass =
    statusKey &&
    Object.prototype.hasOwnProperty.call(updateStatusDesc, statusKey)
      ? `update-${statusKey}`
      : "update-none";
  const typeMeta = getNodeTypeMeta(node);
  const displayName = node.adv_name?.trim() ? node.adv_name : t("map.unnamed");

  const sourceMeta = getNodeSourceHeaderMeta(node);
  const sourceHeaderEl = sourceMeta
    ? (() => {
        const inner = `<i class="${sourceMeta.icon}" aria-hidden="true"></i>`;
        const cls = `node-popup__source-icon node-popup__source-icon--${sourceMeta.safeClass}`;
        const tip = escapeAttrHtml(t("map.sourceType", { text: sourceMeta.tooltipText }));
        return sourceMeta.href
          ? `<a class="${cls}" href="${escapeAttrHtml(sourceMeta.href)}" target="_blank" rel="noopener noreferrer" title="${tip}" aria-label="${tip}">${inner}</a>`
          : `<span class="${cls}" title="${tip}" aria-label="${tip}">${inner}</span>`;
      })()
    : "";

  const headerHtml =
    `<header class="node-popup__header">` +
    `<span class="node-popup__type-icon" title="${escapeAttrHtml(typeMeta.label)}" aria-label="${escapeAttrHtml(typeMeta.label)}"><i class="${typeMeta.icon}" aria-hidden="true"></i></span>` +
    `<span class="node-popup__freshness" title="${escapeAttrHtml(t("map.freshness", { desc: freshness }))}" aria-label="${escapeAttrHtml(t("map.freshness", { desc: freshness }))}"><span class="status-dot ${statusDotClass}"></span></span>` +
    `<div class="node-popup__head-text">` +
    `<h3 class="node-popup__title" title="${escapeAttrHtml(t("map.nameLabel", { name: displayName }))}" aria-label="${escapeAttrHtml(t("map.nameLabel", { name: displayName }))}">${escapeAttrHtml(displayName)}</h3>` +
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
            `<td><b>${escapeAttrHtml(t(columns[key].labelKey))}</b></td><td>${
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
          footerCenter = `<a href="javascript:void(0)" class="node-popup-action node-popup-action--claim" onclick="window.claimNode('${publicKey}')">${escapeAttrHtml(t("map.claim"))}</a>`;
        } else {
          const nodeOwnerId = node.discord_owner_id;
          const currentUserId = authState.user?.id;

          if (
            nodeOwnerId &&
            currentUserId &&
            String(nodeOwnerId) === String(currentUserId)
          ) {
            footerCenter = `<a href="javascript:void(0)" class="node-popup-action node-popup-action--danger" onclick="window.unclaimNode('${publicKey}')">${escapeAttrHtml(t("map.unclaim"))}</a>`;
          }
        }
      } else if (isUnclaimed) {
        footerCenter = `<a href="/auth/login" class="node-popup-action node-popup-action--claim">${escapeAttrHtml(t("map.claim"))}</a>`;
      }

      const source = (node.source || "").toLowerCase();
      const isNotDiscordSource =
        source !== "discord" &&
        (source === "app" || source === "uploader" || source === "web");

      const delUrl = escapeAttrHtml(getDeletionMailUrl(node));
      const footerEnd = isNotDiscordSource
        ? `<a href="${delUrl}" class="node-popup-action node-popup-action--danger node-popup-action--icon-only" title="${escapeAttrHtml(t("map.requestDeletion"))}" aria-label="${escapeAttrHtml(t("map.requestDeletion"))}"><i class="bi bi-trash" aria-hidden="true"></i></a>`
        : "";

      return `<nav class="node-popup-actions" aria-label="${escapeAttrHtml(t("map.actions"))}"><div class="node-popup-actions__row"><div class="node-popup-actions__slot node-popup-actions__slot--start">${footerStart}</div><div class="node-popup-actions__slot node-popup-actions__slot--center">${footerCenter}</div><div class="node-popup-actions__slot node-popup-actions__slot--end">${footerEnd}</div></div></nav>`;
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
  const dateMs = parseUtcMs(date);

  return !Number.isNaN(dateMs) && dateMs > Date.now() - daysMs;
};

// Get the most recent date from a node's date fields
// Returns the date as an ISO string, or null if no valid dates found
function getMostRecentDate(node) {
  const dates = [
    node.inserted_date,
    node.updated_date,
    node.last_advert,
  ].filter((date) => date != null && date !== "");

  if (dates.length === 0) return null;

  const timestamps = dates
    .map((date) => parseUtcMs(date))
    .filter((ms) => !Number.isNaN(ms));
  if (timestamps.length === 0) return null;
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
  const updateEpoch = parseUtcMs(node.updated_date);
  if (Number.isNaN(updateEpoch)) return "none";
  const now = Date.now();
  if (updateEpoch < now - getDaysEpochMsec(20)) return "extinct";
  if (updateEpoch < now - getDaysEpochMsec(10)) return "old";
  if (updateEpoch < now - getDaysEpochMsec(5)) return "stale";
  return "recent";
}

/** The claim API answers in English: its known messages get the page language, anything else shows as sent. */
const API_ERRORS = {
  "Not authenticated": "map.api.notAuthenticated",
  "Failed to claim node. Node may not exist, may already be claimed, or may be inactive.": "map.claim.failedDefault",
  "Failed to unclaim node.": "map.unclaim.failedDefault",
};
function apiErrorText(message, fallbackKey) {
  if (!message) return t(fallbackKey);
  return Object.prototype.hasOwnProperty.call(API_ERRORS, message) ? t(API_ERRORS[message]) : message;
}

// Update status descriptions (matches upstream)
const updateStatusDesc = {
  none: "map.status.none",
  recent: "map.status.recent",
  stale: "map.status.stale",
  old: "map.status.old",
  extinct: "map.status.extinct",
};

/** Freshness description for an update status in the page language. */
function statusDesc(key) {
  return Object.prototype.hasOwnProperty.call(updateStatusDesc, key) ? t(updateStatusDesc[key]) : t("map.na");
}

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

const appAttribution = t("map.attribution", {
  recrof: `<a target="_blank" href="https://github.com/sponsors/recrof?frequency=one-time&sponsor=recrof"><strong>recrof</strong></a>`,
  radioActief: `<a target="_blank" href="https://github.com/radio-actief"><strong>Radio-Actief</strong></a>`,
});

const baseMapSelected =
  localStorage.getItem("baseMapSelected") || "OpenStreetMap";
const baseMaps = {
  OpenStreetMap: L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    className: "osm-tiles",
    attribution: `${t("map.tiles")}: &copy; <a href="http://www.openstreetmap.org/copyright">OpenStreetMap</a> | ${appAttribution}`,
  }),
  "Esri Satellite": L.tileLayer(
    "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
    {
      maxZoom: 18,
      attribution: `${t("map.tiles")}: &copy; Esri | ${t("map.sources")}: Esri, DigitalGlobe, GeoEye, i-cubed, USDA FSA, USGS, AEX, Getmapping, Aerogrid, IGN, IGP, swisstopo, GIS Users | ${appAttribution}`,
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
L.control.zoom({ position: "bottomleft", zoomInTitle: t("zoom.in"), zoomOutTitle: t("zoom.out") }).addTo(map);
window.BEmeshMapShade.attach(L, map, baseMaps.OpenStreetMap, {
  position: "bottomleft",
});
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
      filterMenuOpen: false,
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
          autoPanPaddingTopLeft: [10, 100],
          autoPanPaddingBottomRight: [10, 10],
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
        watchPopupGrowth(marker, nodePopup);
      });
      marker.on("popupclose", function () {
        delete app.urlParams.node;
        stopWatchingPopupGrowth(marker);
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

      if (!confirm(t("map.claim.confirm"))) {
        return;
      }

      try {
        const res = await fetch(`/api/v1/nodes/${publicKey}/claim`, {
          method: "POST",
          credentials: "include",
        });
        const data = await res.json();

        if (res.ok && data.success) {
          alert(t("map.claim.done"));
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
            const message = t("map.claim.membership");
            if (confirm(message + "\n\n" + t("map.claim.openInvite"))) {
              window.open(data.discord_invite_url, "_blank");
            }
          } else {
            const errorMsg = apiErrorText(data.error, "map.claim.failedDefault");
            alert(t("map.claim.failed", { error: errorMsg }));
          }
        }
      } catch (e) {
        console.error("Error claiming node:", e);
        const supportLink =
          "https://discord.com/channels/1391758345622257665/1454797139959091412";
        alert(t("map.claim.network", { link: supportLink }));
      }
    }

    // Unclaim a node
    async function unclaimNode(publicKey) {
      if (!auth.authenticated) {
        return;
      }

      if (!confirm(t("map.unclaim.confirm"))) {
        return;
      }

      try {
        const res = await fetch(`/api/v1/nodes/${publicKey}/unclaim`, {
          method: "POST",
          credentials: "include",
        });
        const data = await res.json();

        if (res.ok && data.success) {
          alert(t("map.unclaim.done"));
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
          const errorMsg = apiErrorText(data.error, "map.unclaim.failedDefault");
          if (data.error === "You do not own this node.") {
            alert(t("map.unclaim.notOwner"));
          } else if (data.error === "Node not found.") {
            alert(t("map.unclaim.notFound"));
          } else {
            alert(t("map.unclaim.failed", { error: errorMsg }));
          }
        }
      } catch (e) {
        console.error("Error unclaiming node:", e);
        const supportLink =
          "https://discord.com/channels/1391758345622257665/1454797139959091412";
        alert(t("map.unclaim.network", { link: supportLink }));
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
      if (!k) return null;
      const exact = nodes.find((n) => normalizePubKey(n.public_key) === k);
      if (exact) return exact;
      // A key prefix (as in the Discord digest links) opens the node only when
      // exactly one node starts with it.
      if (k.length >= 12 && k.length < 64 && /^[0-9a-f]+$/.test(k)) {
        const matches = nodes.filter((n) =>
          normalizePubKey(n.public_key).startsWith(k),
        );
        if (matches.length === 1) return matches[0];
      }
      return null;
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
        autoPanPaddingTopLeft: [10, 100],
        autoPanPaddingBottomRight: [10, 10],
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
        watchPopupGrowth(tempMarker, deepLinkPopup);
      });
      tempMarker.on("popupclose", () => {
        delete app.urlParams.node;
        stopWatchingPopupGrowth(tempMarker);
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
            node.lastAdvertDate = new Date(parseUtcMs(node.last_advert));
            node.insertDate = new Date(parseUtcMs(node.inserted_date));
            const updatedMs = parseUtcMs(node.updated_date);
            node.updatedDate =
              node.updated_date && !Number.isNaN(updatedMs)
                ? new Date(updatedMs)
                : null;

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
        alert(t("map.loadFailed", { error: e.message || e, link: supportLink }));
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
        filtersRestrictMapView() ||
        app.clusteringZoom !== DEFAULT_CLUSTERING_ZOOM,
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

      const num = (n) => I18N.number(n);
      const dot = (type, count) =>
        `<span class="count-item pointer-help" title="${escapeAttrHtml(t(`map.total.${type}`))}"><i class="dot dot-${type}" aria-hidden="true"></i><b>${num(count)}</b></span>`;
      let statsString = `<span>${t("map.nodeCount", { count: nodes.length, n: num(nodes.length) })}</span>`;
      statsString += dot(1, companionsCount);
      statsString += dot(2, repeatersCount);
      statsString += dot(3, roomServersCount);
      if (sensorsCount > 0) {
        statsString += dot(4, sensorsCount);
      }

      result.push(statsString);
      const recent = (key, count) =>
        `<span class="pointer-help" title="${escapeAttrHtml(t(`map.added.${key}`))}">${escapeAttrHtml(t(`map.added.${key}.short`))} <b>${num(count)}</b></span>`;
      result.push(recent("24h", c1));
      result.push(recent("7d", c7));
      result.push(recent("30d", c30));

      return result;
    });

    // Phone chip: total and nodes added in the last 7 days
    const totals = computed(() => {
      const nodes = app.nodes;
      if (!nodes || !nodes.length) return null;
      const t7 = Date.now() - 7 * 86400000;
      let week = 0;
      for (const n of nodes) {
        const ins = n.insertDate || new Date(n.inserted_date);
        if (ins.getTime() > t7) week++;
      }
      return { total: nodes.length, week };
    });

    // Personal stats for logged-in user
    const myNodesCount = computed(() =>
      !auth.authenticated || !auth.user
        ? 0
        : app.nodes.filter(
            (node) =>
              node.discord_owner_id &&
              String(node.discord_owner_id) === String(auth.user.id),
          ).length,
    );

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

    let removeFilterMenuInteractionGuards = null;
    let removeViewportListeners = null;

    watch(
      myNodesCount,
      (n) => window.BEmeshTopbar?.setMyNodes(n),
      { immediate: true },
    );

    onMounted(() => {
      window.BEmeshTopbar?.init();
      function onMapLayoutRefresh() {
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

      // Check for URL parameters indicating errors
      const loginReturnParams = new URLSearchParams(window.location.search);
      const error = loginReturnParams.get("error");
      const inviteUrl = loginReturnParams.get("invite_url");

      if (error === "not_guild_member" && inviteUrl) {
        const message = t("map.claim.membership");
        if (confirm(message + "\n\n" + t("map.claim.openInvite"))) {
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
          const type = Number(targetNode.type) || 1;
          if (app.nodeFilter.length > 0 && !app.nodeFilter.map(Number).includes(type)) {
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

      // Filter menu open/close (replaces the former Beer `data-ui` behavior).
      // The menu visibility is bound to app.filterMenuOpen via :class="{active}".
      // Close it on an outside click or Escape. The toggle button uses
      // @click.stop, so its own clicks never reach these document listeners;
      // clicks inside the menu (checkboxes, sliders) keep it open.
      function filterMenuOutsideClose(e) {
        if (!app.filterMenuOpen) return;
        const menu = document.getElementById("node-filter");
        if (menu && menu.contains(e.target)) return;
        app.filterMenuOpen = false;
      }
      function filterMenuEscClose(e) {
        if (e.key === "Escape") {
          app.filterMenuOpen = false;
        }
      }
      document.addEventListener("click", filterMenuOutsideClose);
      document.addEventListener("bemesh:menu-opened", () => {
        app.filterMenuOpen = false;
      });
      document.addEventListener("keydown", filterMenuEscClose);

      removeFilterMenuInteractionGuards = () => {
        document.removeEventListener("click", filterMenuOutsideClose);
        document.removeEventListener("keydown", filterMenuEscClose);
      };
    });

    onBeforeUnmount(() => {
      removeViewportListeners?.();
      removeViewportListeners = null;
      removeFilterMenuInteractionGuards?.();
      removeFilterMenuInteractionGuards = null;
    });

    window.refreshMap = refreshMap;
    return {
      t,
      num: (n) => I18N.number(n),
      app,
      auth,
      refreshMap,
      stats,
      totals,
      myNodesCount,
      searchResults,
      filtersActive,
      showNode,
      highlightString,
      clearFilters,
      checkAuth,
      claimNode,
      unclaimNode,
    };
  },
}).mount("#app");
