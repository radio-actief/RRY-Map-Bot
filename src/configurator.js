(function () {
  function rryDataUrl(filename) {
    var p = window.location.pathname || "";
    if (/\.html?$/i.test(p)) {
      return "./data/" + filename;
    }
    if (
      /(?:^|\/)(region-map|configurator|region-configurator)(?:\/|$)/.test(p)
    ) {
      return "/data/" + filename;
    }
    return "./data/" + filename;
  }

  let CITIES = [];
  fetch(rryDataUrl("be-locode.json"))
    .then(function (r) {
      if (!r.ok) return [];
      return r.json().catch(function () {
        return [];
      });
    })
    .then(function (data) {
      CITIES = Array.isArray(data) ? data : [];
      var inp = document.getElementById("city-search");
      if (inp)
        inp.placeholder =
          "Search here ; i.e. Vlaams-Brabant, be-vbr, België, or a municipality…";
    })
    .catch(function () {
      CITIES = [];
      var inp = document.getElementById("city-search");
      if (inp) inp.placeholder = "Could not load locations — try again later.";
    });

  const PROVINCE_NAMES = {
    "be-van": "Antwerpen",
    "be-vbr": "Vlaams-Brabant",
    "be-vov": "Oost-Vlaanderen",
    "be-vwv": "West-Vlaanderen",
    "be-vli": "Limburg",
    "be-bru": "Brussel",
    "be-wbr": "Waals-Brabant",
    "be-wht": "Henegouwen",
    "be-wlg": "Luik",
    "be-wna": "Namen",
    "be-wlx": "Luxemburg",
  };

  /**
   * Land borders between Belgian provinces (ISO 3166-2:BE MeshCore codes).
   * Used for neighbour-province policy rows instead of centroid + radius,
   * which missed real borders (e.g. West Flanders ↔ East Flanders).
   */
  const PROVINCE_ADJACENCY = {
    "be-van": ["be-vbr", "be-vov", "be-vli"],
    "be-vbr": [
      "be-van",
      "be-vli",
      "be-vov",
      "be-wbr",
      "be-bru",
      "be-wht",
      "be-wlg",
    ],
    "be-vov": ["be-vwv", "be-van", "be-vbr", "be-vli", "be-wht"],
    "be-vwv": ["be-vov", "be-wht"],
    "be-vli": ["be-van", "be-vbr", "be-vov", "be-wlg"],
    "be-bru": ["be-vbr", "be-wbr"],
    "be-wbr": ["be-vbr", "be-bru", "be-wht", "be-wna", "be-wlg"],
    "be-wht": ["be-vwv", "be-vov", "be-vbr", "be-wbr", "be-wna", "be-wlg"],
    "be-wlg": ["be-vli", "be-vbr", "be-wbr", "be-wna", "be-wlx", "be-wht"],
    "be-wna": ["be-wbr", "be-wht", "be-wlg", "be-wlx"],
    "be-wlx": ["be-wna", "be-wlg"],
  };

  const input = document.getElementById("city-search");
  const dropdown = document.getElementById("city-dropdown");
  const resultCard = document.getElementById("result-card");
  const resultGrid = document.getElementById("result-grid");
  const commandsCard = document.getElementById("commands-card");
  const commandsBlock = document.getElementById("commands-block");
  const copyBtn = document.getElementById("copy-btn");
  const cliShowDefaultsEl = document.getElementById("cli-show-defaults");
  const policyCard = document.getElementById("policy-card");
  const policyGridsContainer = document.getElementById(
    "policy-grids-container",
  );
  const namePrefixPreviewEl = document.getElementById("name-prefix-preview");
  const nameLocationModeWrapEl = document.getElementById(
    "name-location-mode-wrap",
  );
  const nameLocationModeEl = document.getElementById("name-location-mode");
  const nameSuffixEl = document.getElementById("name-suffix");
  const namePowerEmojiEl = document.getElementById("name-power-emoji");
  const namePreviewEl = document.getElementById("name-preview");
  const namePreviewMetaEl = document.getElementById("name-preview-meta");
  const namePreviewNoteEl = document.getElementById("name-preview-note");
  const settingDutycycleEl = document.getElementById("setting-dutycycle");
  const settingPathHashModeEl = document.getElementById(
    "setting-path-hash-mode",
  );
  const settingLoopDetectEl = document.getElementById("setting-loop-detect");
  const settingRepeatEl = document.getElementById("setting-repeat");
  const settingOwnerInfoEl = document.getElementById("setting-owner-info");
  const settingAdminPasswordEl = document.getElementById(
    "setting-admin-password",
  );
  const settingGuestPasswordEl = document.getElementById(
    "setting-guest-password",
  );
  const settingTxdelayEl = document.getElementById("setting-txdelay");
  const settingDirectTxdelayEl = document.getElementById(
    "setting-direct-txdelay",
  );
  const settingFloodAdvertIntervalEl = document.getElementById(
    "setting-flood-advert-interval",
  );
  const settingAdvertIntervalEl = document.getElementById(
    "setting-advert-interval",
  );
  const settingFloodMaxUnscopedEl = document.getElementById(
    "setting-flood-max-unscoped",
  );
  const settingFloodMaxAdvertEl = document.getElementById(
    "setting-flood-max-advert",
  );
  const settingRadioPresetEl = document.getElementById("setting-radio-preset");
  const settingRadioCustomWrapEl = document.getElementById(
    "setting-radio-custom-wrap",
  );
  const settingRadioFreqEl = document.getElementById("setting-radio-freq");
  const settingRadioSfEl = document.getElementById("setting-radio-sf");
  const settingRadioBwEl = document.getElementById("setting-radio-bw");
  const settingRadioCrEl = document.getElementById("setting-radio-cr");
  const settingRadioErrorEl = document.getElementById("setting-radio-error");

  let selectionMode = "none";
  let selectedProvinceCode = null;
  let selectedCity = null;
  let activeIndex = -1;
  let lastMatches = [];
  let lastNeighbors = [];
  let lastHasCoords = false;
  let namePreviewState = {
    name: "",
    isValid: false,
    totalBytes: 0,
    message: "Pick a location first to build a name.",
  };

  function provinceCentroid(pc) {
    let sumLat = 0;
    let sumLon = 0;
    let n = 0;
    for (let i = 0; i < CITIES.length; i++) {
      const r = CITIES[i];
      if (r.province_code !== pc) continue;
      if (
        r.lat == null ||
        r.lon == null ||
        !Number.isFinite(r.lat) ||
        !Number.isFinite(r.lon)
      )
        continue;
      sumLat += r.lat;
      sumLon += r.lon;
      n++;
    }
    if (!n) return { lat: 50.5, lon: 4.35 };
    return { lat: sumLat / n, lon: sumLon / n };
  }

  function getAnchor() {
    if (selectionMode === "city" && selectedCity)
      return {
        mode: "city",
        province_code: selectedCity.province_code,
        row: selectedCity,
      };
    if (selectionMode === "province" && selectedProvinceCode)
      return {
        mode: "province",
        province_code: selectedProvinceCode,
        row: null,
      };
    if (selectionMode === "country")
      return { mode: "country", province_code: null, row: null };
    return null;
  }

  function neighborSeedRow(anchor) {
    if (!anchor) return null;
    if (anchor.mode === "city" && anchor.row) return anchor.row;
    if (anchor.mode === "province") {
      const c = provinceCentroid(anchor.province_code);
      return {
        lat: c.lat,
        lon: c.lon,
        province_code: anchor.province_code,
        city_code: "__province_centroid__",
        plaats: "",
      };
    }
    return {
      lat: 50.5,
      lon: 4.35,
      province_code: "be-vbr",
      city_code: "__be_centroid__",
      plaats: "",
    };
  }

  function normalize(s) {
    return (s || "")
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "");
  }

  function cityMatchesQuery(c, q) {
    if (
      normalize(c.plaats).includes(q) ||
      normalize(c.gemeente).includes(q) ||
      normalize(c.city_code).includes(q)
    )
      return true;
    const al = c.search_aliases;
    if (!al || !Array.isArray(al) || !al.length) return false;
    for (let i = 0; i < al.length; i++) {
      if (normalize(al[i]).includes(q)) return true;
    }
    return false;
  }

  function filterLocationChoices(query) {
    if (!query || query.length < 2) return [];
    const q = normalize(query);
    const out = [];
    const seen = new Set();

    const belMatch =
      q === "be" ||
      normalize("belgium").includes(q) ||
      normalize("belgie").includes(q) ||
      normalize("belgië").includes(q) ||
      normalize("belgique").includes(q);
    if (belMatch) {
      out.push({
        type: "country",
        code: "be",
        label: "België (be) · country",
      });
      seen.add("__country_be__");
    }

    const provKeys = Object.keys(PROVINCE_NAMES);
    for (let pi = 0; pi < provKeys.length; pi++) {
      if (out.length >= 16) break;
      const pc = provKeys[pi];
      const pn = PROVINCE_NAMES[pc];
      if (normalize(pc).includes(q) || normalize(pn).includes(q)) {
        if (seen.has("p:" + pc)) continue;
        seen.add("p:" + pc);
        out.push({
          type: "province",
          code: pc,
          label: pn + " (" + pc + ") · province",
        });
      }
    }

    for (let ci = 0; ci < CITIES.length && out.length < 16; ci++) {
      const c = CITIES[ci];
      if (cityMatchesQuery(c, q)) {
        if (seen.has("c:" + c.city_code)) continue;
        seen.add("c:" + c.city_code);
        out.push({
          type: "place",
          code: c.city_code,
          row: c,
          label:
            c.plaats +
            " (" +
            c.city_code +
            ") · " +
            (PROVINCE_NAMES[c.province_code] || c.province_code),
        });
      }
    }
    return out;
  }

  function renderDropdown(matches) {
    lastMatches = matches;
    if (!matches.length) {
      dropdown.style.display = "none";
      return;
    }
    dropdown.innerHTML = matches
      .map(function (item, i) {
        const safeLabel = escapeHtml(item.label || "");
        return (
          '<div class="search-dropdown-item" data-index="' +
          i +
          '" data-choice-type="' +
          escapeHtml(item.type) +
          '">' +
          '<span class="search-dropdown-place">' +
          safeLabel +
          "</span></div>"
        );
      })
      .join("");
    dropdown.style.display = "block";
    activeIndex = 0;
    dropdown
      .querySelectorAll(".search-dropdown-item")
      .forEach(function (el, i) {
        el.classList.toggle("active", i === 0);
        el.addEventListener("click", function () {
          const idx = parseInt(el.dataset.index, 10);
          const item = lastMatches[idx];
          if (!item) return;
          if (item.type === "country") selectCountryBe();
          else if (item.type === "province") selectProvince(item.code);
          else if (item.type === "place" && item.row) selectCity(item.row);
        });
      });
  }

  function escapeHtml(s) {
    const d = document.createElement("div");
    d.textContent = s || "";
    return d.innerHTML;
  }

  function haversineKm(lat1, lon1, lat2, lon2) {
    const R = 6371;
    const toR = Math.PI / 180;
    const dLat = (lat2 - lat1) * toR;
    const dLon = (lon2 - lon1) * toR;
    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(lat1 * toR) *
        Math.cos(lat2 * toR) *
        Math.sin(dLon / 2) *
        Math.sin(dLon / 2);
    return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
  }

  /** Max distance (km) for neighbouring municipalities / province hints. */
  const NEIGHBOR_RADIUS_KM = 25;
  /** Max municipality rows in the policy scope (codes panel lists the full radius). */
  const NEIGHBOR_SCOPE_MAX_CITIES = 10;

  /**
   * Nearest other cities by haversine distance, deduped by city_code.
   * @param {object} city — selected row with lat/lon
   * @param {{ maxKm?: number, maxCount?: number }} [opts]
   * @returns {{ c: object, km: number }[]}
   */
  function findGeographicNeighbors(city, opts) {
    opts = opts || {};
    const maxKm =
      opts.maxKm != null && Number.isFinite(opts.maxKm) ? opts.maxKm : Infinity;
    const maxCount =
      opts.maxCount != null && Number.isFinite(opts.maxCount)
        ? opts.maxCount
        : Infinity;
    if (
      city.lat == null ||
      city.lon == null ||
      !Number.isFinite(city.lat) ||
      !Number.isFinite(city.lon) ||
      !CITIES.length
    )
      return [];
    const scored = [];
    for (let i = 0; i < CITIES.length; i++) {
      const o = CITIES[i];
      if (o.city_code === city.city_code) continue;
      if (
        o.lat == null ||
        o.lon == null ||
        !Number.isFinite(o.lat) ||
        !Number.isFinite(o.lon)
      )
        continue;
      const km = haversineKm(city.lat, city.lon, o.lat, o.lon);
      scored.push({ c: o, km });
    }
    scored.sort(function (a, b) {
      return a.km - b.km;
    });
    const out = [];
    const seen = new Set();
    for (let i = 0; i < scored.length; i++) {
      if (scored[i].km > maxKm) break;
      const code = scored[i].c.city_code;
      if (seen.has(code)) continue;
      seen.add(code);
      out.push(scored[i]);
      if (out.length >= maxCount) break;
    }
    return out;
  }

  function resultRow(label, name, code) {
    return (
      '<div class="result-item"><span class="result-item-label">' +
      escapeHtml(label) +
      '</span><span class="result-item-value">' +
      escapeHtml(name) +
      ' <span class="result-code-inline">(' +
      escapeHtml(code) +
      ")</span></span></div>"
    );
  }

  function chosenLocationRowsHTML(c) {
    const prov = PROVINCE_NAMES[c.province_code] || c.province_code;
    return (
      resultRow("Province", prov, c.province_code) +
      resultRow("Municipality", c.plaats, c.city_code)
    );
  }

  function chosenLocationRowsFromAnchor(anchor) {
    if (!anchor) return "";
    if (anchor.mode === "country") return resultRow("Country", "België", "be");
    if (anchor.mode === "province" && anchor.province_code) {
      const n = PROVINCE_NAMES[anchor.province_code] || anchor.province_code;
      return resultRow("Province", n, anchor.province_code);
    }
    if (anchor.mode === "city" && anchor.row)
      return chosenLocationRowsHTML(anchor.row);
    return "";
  }

  const COUNTRY_CLI = [
    ["Country (CLI)", "Netherlands", "nl"],
    ["Country (CLI)", "Luxembourg", "lu"],
    ["Country (CLI)", "France", "fr"],
    ["Country (CLI)", "Germany", "de"],
    ["Country (CLI)", "Belgium", "be"],
  ];

  const NEIGHBOR_COUNTRY_CODES = ["nl", "lu", "fr", "de"];

  const CLI_ORDER_FIRST = ["eu", "bx", "nl", "lu", "fr", "de", "be"];

  /** Flood advert with lat/lon: 32 − 1 − 8 = 23 UTF-8 bytes for the name. */
  const NAME_ADVERT_MAX_UTF8 = 23;
  /** Firmware stores node_name in char node_name[32] (31 chars + null). */
  const NAME_FIRMWARE_MAX_UTF8 = 31;
  /** Prefix segment in repeater names (e.g. BE-RON-). */
  const NAME_PREFIX_MAX_UTF8 = 7;

  function nameByteLength(value) {
    const s = String(value || "");
    if (typeof TextEncoder !== "undefined") {
      return new TextEncoder().encode(s).length;
    }
    return unescape(encodeURIComponent(s)).length;
  }

  function citySegment(cityCode) {
    if (!cityCode) return "";
    return String(cityCode).replace(/^be/i, "").toUpperCase();
  }

  function provinceSegment(provinceCode) {
    if (!provinceCode) return "";
    return String(provinceCode).replace(/^be-/i, "").toUpperCase();
  }

  function getCurrentLocationMode() {
    return nameLocationModeEl ? nameLocationModeEl.value : "";
  }

  function setCurrentLocationMode(mode) {
    if (nameLocationModeEl) {
      nameLocationModeEl.value = mode;
    }
  }

  /** Normalize an auto-generated prefix (city/province/country): trim and ensure trailing "-". */
  function normalizePrefix(raw) {
    let core = String(raw || "")
      .trim()
      .replace(/-+$/, "");
    if (!core) return "";
    core = trimUtf8ToMaxBytes(core, NAME_PREFIX_MAX_UTF8 - 1);
    if (!core) return "";
    const withDash = core + "-";
    if (nameByteLength(withDash) <= NAME_PREFIX_MAX_UTF8) {
      return withDash;
    }
    core = trimUtf8ToMaxBytes(core, NAME_PREFIX_MAX_UTF8 - 1);
    return core ? core + "-" : "";
  }

  function getEffectivePrefix(anchor) {
    if (!anchor) return "";
    const mode = getCurrentLocationMode() || defaultLocationMode(anchor);
    return buildNamePrefix(anchor, mode);
  }

  function syncPrefixField(anchor) {
    if (!namePrefixPreviewEl) return;
    namePrefixPreviewEl.readOnly = true;
    namePrefixPreviewEl.setAttribute("readonly", "");
    if (!anchor) {
      namePrefixPreviewEl.value = "";
      namePrefixPreviewEl.title = "Choose a location to generate a prefix.";
      return;
    }
    const mode = getCurrentLocationMode() || defaultLocationMode(anchor);
    namePrefixPreviewEl.value = buildNamePrefix(anchor, mode);
    namePrefixPreviewEl.title =
      "Max " + NAME_PREFIX_MAX_UTF8 + " UTF-8 bytes; trailing dash included.";
  }

  function resetNamingForLocation(anchor) {
    if (!anchor) {
      syncPrefixField(null);
      return;
    }
    const def = defaultLocationMode(anchor);
    setCurrentLocationMode(def);
    syncPrefixField(anchor);
  }

  function availableLocationModes(anchor) {
    if (!anchor) return [];
    if (anchor.mode === "city") {
      return ["city", "province", "country", "none"];
    }
    if (anchor.mode === "province") {
      return ["province", "country", "none"];
    }
    if (anchor.mode === "country") {
      return ["country", "none"];
    }
    return [];
  }

  function defaultLocationMode(anchor) {
    if (!anchor) return "";
    if (anchor.mode === "city") return "city";
    if (anchor.mode === "province") return "province";
    if (anchor.mode === "country") return "country";
    return "";
  }

  function refreshLocationModeOptions(anchor) {
    const available = new Set(availableLocationModes(anchor));
    if (nameLocationModeWrapEl) {
      nameLocationModeWrapEl.hidden = false;
    }
    if (nameLocationModeEl) {
      const options = nameLocationModeEl.options;
      for (let i = 0; i < options.length; i++) {
        const opt = options[i];
        opt.hidden = false;
        opt.disabled = anchor
          ? !available.has(opt.value)
          : opt.value !== "none";
      }
    }
    const current = getCurrentLocationMode();
    if (!anchor) {
      if (current !== "none") {
        setCurrentLocationMode("none");
      }
      syncPrefixField(null);
      return;
    }
    if (!available.has(current)) {
      setCurrentLocationMode(defaultLocationMode(anchor));
      syncPrefixField(anchor);
    }
  }

  function buildNamePrefix(anchor, mode) {
    if (!anchor) return "";
    if (mode === "none") return "";
    if (mode === "country") return normalizePrefix("BE-");
    if (mode === "province") {
      const pCode =
        anchor.mode === "province"
          ? anchor.province_code
          : anchor.row
            ? anchor.row.province_code
            : "";
      const pSeg = provinceSegment(pCode);
      return pSeg ? normalizePrefix("BE-" + pSeg + "-") : "";
    }
    if (mode === "city") {
      const cSeg = anchor.row ? citySegment(anchor.row.city_code) : "";
      return cSeg ? normalizePrefix("BE-" + cSeg + "-") : "";
    }
    return "";
  }

  function trimUtf8ToMaxBytes(str, maxBytes) {
    const s = String(str || "");
    if (maxBytes <= 0) return "";
    if (nameByteLength(s) <= maxBytes) return s;
    for (let i = s.length - 1; i >= 0; i--) {
      const part = s.slice(0, i);
      if (nameByteLength(part) <= maxBytes) return part;
    }
    return "";
  }

  function clampNamingInput(anchor) {
    if (!nameSuffixEl) return;
    const prefix = getEffectivePrefix(anchor);
    const emoji = namePowerEmojiEl ? namePowerEmojiEl.value || "" : "";
    const maxSuffixBytes =
      NAME_FIRMWARE_MAX_UTF8 - nameByteLength(prefix) - nameByteLength(emoji);
    const trimmed = trimUtf8ToMaxBytes(nameSuffixEl.value, maxSuffixBytes);
    if (trimmed !== nameSuffixEl.value) {
      nameSuffixEl.value = trimmed;
    }
  }

  function buildRepeaterName(anchor) {
    const prefix = getEffectivePrefix(anchor);
    const suffix = nameSuffixEl ? String(nameSuffixEl.value || "").trim() : "";
    const emoji = namePowerEmojiEl ? namePowerEmojiEl.value || "" : "";
    const name = prefix + suffix + emoji;
    const prefixBytes = nameByteLength(prefix);
    const suffixBytes = nameByteLength(suffix);
    const emojiBytes = nameByteLength(emoji);
    const totalBytes = nameByteLength(name);
    const hasSuffix = suffixBytes > 0;
    const fitsAdvert = totalBytes <= NAME_ADVERT_MAX_UTF8;
    const isValid = hasSuffix && totalBytes <= NAME_FIRMWARE_MAX_UTF8;
    const advertName = trimUtf8ToMaxBytes(name, NAME_ADVERT_MAX_UTF8);
    return {
      prefix: prefix,
      suffix: suffix,
      emoji: emoji,
      name: name,
      advertName: advertName,
      prefixBytes: prefixBytes,
      suffixBytes: suffixBytes,
      emojiBytes: emojiBytes,
      totalBytes: totalBytes,
      hasSuffix: hasSuffix,
      fitsAdvert: fitsAdvert,
      isValid: isValid,
    };
  }

  /** MeshCore: set radio freq,bw,sf,cr (MHz, kHz; SF 5–12; CR 5–8; BW 7–500). */
  const FREQUENCY_PRESETS = [
    { name: "Australia", freq: 915.8, sf: 10, bw: 250, cr: 5 },
    { name: "Australia: Victoria", freq: 916.675, sf: 7, bw: 62.5, cr: 8 },
    { name: "EU/UK (Narrow)", freq: 869.618, sf: 8, bw: 62.5, cr: 8 },
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

  const RADIO_FIELD_SPECS = {
    freq: { label: "Freq (MHz)", min: 150, max: 2500, integer: false },
    sf: { label: "SF", min: 5, max: 12, integer: true },
    bw: { label: "BW (kHz)", min: 7, max: 500, integer: false, maxDecimals: 3 },
    cr: { label: "CR", min: 5, max: 8, integer: true },
  };

  /**
   * #BEmesh preferred radio preset on load (EU/UK Narrow: 869.618 MHz narrowband).
   * Differs from MeshCore firmware `set radio` default (see FIRMWARE_DEFAULT_RADIO).
   */
  const DEFAULT_RADIO_PRESET_INDEX = Math.max(
    0,
    FREQUENCY_PRESETS.findIndex(function (p) {
      return p.name === "EU/UK (Narrow)";
    }),
  );

  /**
   * MeshCore firmware defaults for other settings (docs.meshcore.io/cli_commands).
   * Used only to omit unchanged lines from general-settings CLI output.
   */
  const FIRMWARE_DEFAULTS = {
    repeat: "on",
    txdelay: 0.5,
    directTxdelay: 0.2,
    floodAdvertHours: 47,
    advertIntervalMinutes: 0,
    floodMaxUnscoped: 64,
    floodMaxAdvert: 8,
    pathHashMode: "0",
    dutycycle: "50",
    loopDetect: "off",
    adminPassword: "password",
  };

  /**
   * Effective MeshCore radio default for CLI omission: same narrowband plan as
   * EU/UK Narrow but CR 5 (docs list 869.525,250,11,5 for generic `set radio`;
   * #BEmesh treats 869.618 / 62.5 / SF8 / CR5 as the practical firmware default).
   */
  const FIRMWARE_DEFAULT_RADIO = {
    freq: 869.618,
    bw: 62.5,
    sf: 8,
    cr: 5,
  };

  /** Configurator form default when a numeric field is left empty (not firmware). */
  const FLOOD_ADVERT_INTERVAL_FORM_DEFAULT = 47;
  const FLOOD_MAX_UNSCOPED_FORM_DEFAULT = 12;
  const FLOOD_MAX_ADVERT_FORM_DEFAULT = 8;

  function roundToMaxDecimals(value, maxDecimals) {
    const factor = Math.pow(10, maxDecimals);
    return Math.round(Number(value) * factor) / factor;
  }

  function formatDecimalMaxPlaces(value, maxDecimals) {
    const rounded = roundToMaxDecimals(value, maxDecimals);
    const fixed = rounded.toFixed(maxDecimals);
    return fixed.replace(/\.?0+$/, "");
  }

  function formatRadioCliNumber(value, maxDecimals) {
    const n = Number(value);
    if (maxDecimals != null) {
      return formatDecimalMaxPlaces(n, maxDecimals);
    }
    if (Number.isInteger(n) || Math.abs(n - Math.round(n)) < 1e-9) {
      const rounded = Math.round(n);
      return Math.abs(n - rounded) < 1e-9 ? String(rounded) : String(n);
    }
    return String(n);
  }

  function formatRadioCliLine(params) {
    return (
      "set radio " +
      formatRadioCliNumber(params.freq) +
      "," +
      formatRadioCliNumber(params.bw, 3) +
      "," +
      formatRadioCliNumber(params.sf) +
      "," +
      formatRadioCliNumber(params.cr)
    );
  }

  function clampRadioBwInput() {
    if (!settingRadioBwEl) return;
    const raw = String(settingRadioBwEl.value || "").trim();
    if (!raw) return;
    const parsed = parseFloat(raw);
    if (Number.isNaN(parsed)) return;
    const formatted = formatDecimalMaxPlaces(parsed, 3);
    if (formatted !== raw) {
      settingRadioBwEl.value = formatted;
    }
  }

  function parseRadioField(el, spec) {
    if (!el) {
      return { ok: false, error: spec.label + " is required." };
    }
    const raw = String(el.value || "").trim();
    if (!raw) {
      return { ok: false, error: spec.label + " is required." };
    }
    let value = spec.integer ? parseInt(raw, 10) : parseFloat(raw);
    if (Number.isNaN(value)) {
      return { ok: false, error: spec.label + " must be a number." };
    }
    if (spec.integer && !Number.isInteger(value)) {
      return { ok: false, error: spec.label + " must be a whole number." };
    }
    if (value < spec.min || value > spec.max) {
      return {
        ok: false,
        error:
          spec.label +
          " must be between " +
          spec.min +
          " and " +
          spec.max +
          ".",
      };
    }
    if (spec.maxDecimals != null && !spec.integer) {
      value = roundToMaxDecimals(value, spec.maxDecimals);
      const formatted = formatDecimalMaxPlaces(value, spec.maxDecimals);
      if (el.value !== formatted) {
        el.value = formatted;
      }
    }
    return { ok: true, value: value };
  }

  function isCustomRadioPreset() {
    return settingRadioPresetEl && settingRadioPresetEl.value === "custom";
  }

  function getPresetRadioByIndex(index) {
    const p = FREQUENCY_PRESETS[index];
    if (!p) return null;
    return { freq: p.freq, bw: p.bw, sf: p.sf, cr: p.cr };
  }

  function getFirmwareDefaultRadioParams() {
    return FIRMWARE_DEFAULT_RADIO;
  }

  function radioParamsMatch(a, b) {
    if (!a || !b) return false;
    return (
      roundToMaxDecimals(a.freq, 3) === roundToMaxDecimals(b.freq, 3) &&
      roundToMaxDecimals(a.bw, 3) === roundToMaxDecimals(b.bw, 3) &&
      a.sf === b.sf &&
      a.cr === b.cr
    );
  }

  function delayFactorsEqual(a, b) {
    return Math.abs(Number(a) - Number(b)) < 1e-9;
  }

  function fillCustomRadioFields(params) {
    if (!params) return;
    if (settingRadioFreqEl) settingRadioFreqEl.value = String(params.freq);
    if (settingRadioSfEl) settingRadioSfEl.value = String(params.sf);
    if (settingRadioBwEl) {
      settingRadioBwEl.value = formatDecimalMaxPlaces(params.bw, 3);
    }
    if (settingRadioCrEl) settingRadioCrEl.value = String(params.cr);
  }

  function getRadioSettings() {
    if (!settingRadioPresetEl) {
      return {
        valid: true,
        params: getPresetRadioByIndex(DEFAULT_RADIO_PRESET_INDEX),
      };
    }
    if (!isCustomRadioPreset()) {
      const idx = parseInt(settingRadioPresetEl.value, 10);
      const params = getPresetRadioByIndex(idx);
      if (!params) {
        return { valid: false, errors: ["Select a radio preset."] };
      }
      return { valid: true, params: params };
    }
    const errors = [];
    const freq = parseRadioField(settingRadioFreqEl, RADIO_FIELD_SPECS.freq);
    const bw = parseRadioField(settingRadioBwEl, RADIO_FIELD_SPECS.bw);
    const sf = parseRadioField(settingRadioSfEl, RADIO_FIELD_SPECS.sf);
    const cr = parseRadioField(settingRadioCrEl, RADIO_FIELD_SPECS.cr);
    [freq, bw, sf, cr].forEach(function (r) {
      if (!r.ok) errors.push(r.error);
    });
    if (errors.length) {
      return { valid: false, errors: errors };
    }
    return {
      valid: true,
      params: {
        freq: freq.value,
        bw: bw.value,
        sf: sf.value,
        cr: cr.value,
      },
    };
  }

  function refreshRadioSettingsUi() {
    const isCustom = isCustomRadioPreset();
    if (settingRadioCustomWrapEl) {
      settingRadioCustomWrapEl.hidden = !isCustom;
    }
    const radio = getRadioSettings();
    if (settingRadioErrorEl) {
      if (isCustom && !radio.valid) {
        settingRadioErrorEl.hidden = false;
        settingRadioErrorEl.textContent = radio.errors.join(" ");
      } else {
        settingRadioErrorEl.hidden = true;
        settingRadioErrorEl.textContent = "";
      }
    }
    const invalid = isCustom && !radio.valid;
    function onCustomRadioFieldInput() {
      if (settingRadioBwEl) clampRadioBwInput();
      refreshConfiguratorOutputs();
    }

    [
      settingRadioFreqEl,
      settingRadioSfEl,
      settingRadioBwEl,
      settingRadioCrEl,
    ].forEach(function (el) {
      if (el) el.classList.toggle("is-invalid", invalid);
    });
    return radio;
  }

  function initRadioPresetSelect() {
    if (!settingRadioPresetEl) return;
    settingRadioPresetEl.innerHTML = "";
    for (let i = 0; i < FREQUENCY_PRESETS.length; i++) {
      const p = FREQUENCY_PRESETS[i];
      const opt = document.createElement("option");
      opt.value = String(i);
      opt.textContent =
        p.name +
        " — " +
        p.freq +
        " MHz / SF" +
        p.sf +
        " / " +
        p.bw +
        " kHz / CR" +
        p.cr;
      settingRadioPresetEl.appendChild(opt);
    }
    const customOpt = document.createElement("option");
    customOpt.value = "custom";
    customOpt.textContent = "Custom";
    settingRadioPresetEl.appendChild(customOpt);
    settingRadioPresetEl.value = String(DEFAULT_RADIO_PRESET_INDEX);
    settingRadioPresetEl.dataset.lastPreset = String(
      DEFAULT_RADIO_PRESET_INDEX,
    );
    refreshRadioSettingsUi();
  }

  function parseTxDelayFactor(el, fallback) {
    if (!el) return fallback;
    const raw = String(el.value || "").trim();
    if (!raw) return fallback;
    const v = parseFloat(raw);
    if (!Number.isFinite(v)) return fallback;
    return Math.min(2, Math.max(0, v));
  }

  function parseFloodAdvertHours(el) {
    const fallback = FLOOD_ADVERT_INTERVAL_FORM_DEFAULT;
    if (!el) return fallback;
    const raw = String(el.value || "").trim();
    if (!raw) return fallback;
    const v = parseInt(raw, 10);
    if (!Number.isFinite(v)) return fallback;
    return Math.min(168, Math.max(3, v));
  }

  function parseZeroHopAdvertMinutes(el) {
    if (!el) return 0;
    const raw = String(el.value || "").trim();
    if (!raw) return 0;
    const v = parseInt(raw, 10);
    if (!Number.isFinite(v) || v <= 0) return 0;
    const clamped = Math.min(240, Math.max(60, v));
    return clamped - (clamped % 2);
  }

  function parseFloodMaxHops(el, fallback) {
    if (!el) return fallback;
    const raw = String(el.value || "").trim();
    if (!raw) return fallback;
    const v = parseInt(raw, 10);
    if (!Number.isFinite(v)) return fallback;
    return Math.min(64, Math.max(0, v));
  }

  function buildGeneralSettingsCli(showDefaults) {
    const lines = [];
    const fw = FIRMWARE_DEFAULTS;
    const firmwareRadio = getFirmwareDefaultRadioParams();
    const radio = getRadioSettings();

    const includeRadio =
      showDefaults ||
      Boolean(
        radio.valid &&
        radio.params &&
        !radioParamsMatch(radio.params, firmwareRadio),
      );
    if (includeRadio && radio.valid && radio.params) {
      lines.push(formatRadioCliLine(radio.params));
    }

    const repeat = settingRepeatEl ? settingRepeatEl.value : fw.repeat;
    if (showDefaults || repeat !== fw.repeat) {
      lines.push("set repeat " + (repeat === "off" ? "off" : "on"));
    }

    const ownerInfo = settingOwnerInfoEl
      ? String(settingOwnerInfoEl.value || "").trim()
      : "";
    if (ownerInfo) {
      lines.push("set owner.info " + ownerInfo);
    }

    const adminPassword = settingAdminPasswordEl
      ? String(settingAdminPasswordEl.value || "").trim()
      : "";
    if (showDefaults) {
      lines.push("password " + (adminPassword || fw.adminPassword));
    } else if (adminPassword && adminPassword !== fw.adminPassword) {
      lines.push("password " + adminPassword);
    }

    const guestPassword = settingGuestPasswordEl
      ? String(settingGuestPasswordEl.value || "").trim()
      : "";
    if (guestPassword) {
      lines.push("set guest.password " + guestPassword);
    }

    const txdelay = parseTxDelayFactor(settingTxdelayEl, fw.txdelay);
    if (showDefaults || !delayFactorsEqual(txdelay, fw.txdelay)) {
      lines.push("set txdelay " + txdelay);
    }

    const directTxdelay = parseTxDelayFactor(
      settingDirectTxdelayEl,
      fw.directTxdelay,
    );
    if (showDefaults || !delayFactorsEqual(directTxdelay, fw.directTxdelay)) {
      lines.push("set direct.txdelay " + directTxdelay);
    }

    const floodAdvertHours = parseFloodAdvertHours(
      settingFloodAdvertIntervalEl,
    );
    if (showDefaults || floodAdvertHours !== fw.floodAdvertHours) {
      lines.push("set flood.advert.interval " + floodAdvertHours);
    }

    const advertInterval = parseZeroHopAdvertMinutes(settingAdvertIntervalEl);
    if (showDefaults || advertInterval !== fw.advertIntervalMinutes) {
      lines.push("set advert.interval " + advertInterval);
    }

    const floodMaxUnscoped = parseFloodMaxHops(
      settingFloodMaxUnscopedEl,
      FLOOD_MAX_UNSCOPED_FORM_DEFAULT,
    );
    if (showDefaults || floodMaxUnscoped !== fw.floodMaxUnscoped) {
      lines.push("set flood.max.unscoped " + floodMaxUnscoped);
    }

    const floodMaxAdvert = parseFloodMaxHops(
      settingFloodMaxAdvertEl,
      FLOOD_MAX_ADVERT_FORM_DEFAULT,
    );
    if (showDefaults || floodMaxAdvert !== fw.floodMaxAdvert) {
      lines.push("set flood.max.advert " + floodMaxAdvert);
    }

    const pathMode = settingPathHashModeEl
      ? settingPathHashModeEl.value
      : fw.pathHashMode;
    if (showDefaults || pathMode !== fw.pathHashMode) {
      lines.push("set path.hash.mode " + pathMode);
    }

    const dutycycle = settingDutycycleEl
      ? settingDutycycleEl.value
      : fw.dutycycle;
    if (showDefaults || dutycycle !== fw.dutycycle) {
      lines.push("set dutycycle " + dutycycle);
    }

    const loopDetect = settingLoopDetectEl
      ? settingLoopDetectEl.value
      : fw.loopDetect;
    if (showDefaults || loopDetect !== fw.loopDetect) {
      lines.push("set loop.detect " + loopDetect);
    }

    return lines.join("\n");
  }

  function refreshNamingUi(anchor) {
    clampNamingInput(anchor);
    refreshLocationModeOptions(anchor);
    syncPrefixField(anchor);
    const state = buildRepeaterName(anchor);
    namePreviewState = state;

    if (nameSuffixEl) {
      nameSuffixEl.removeAttribute("maxlength");
      nameSuffixEl.title =
        "Up to " +
        NAME_FIRMWARE_MAX_UTF8 +
        " UTF-8 bytes total (firmware); " +
        NAME_ADVERT_MAX_UTF8 +
        " bytes if advertising with location";
    }

    const overAdvert =
      state.totalBytes > NAME_ADVERT_MAX_UTF8 &&
      state.totalBytes <= NAME_FIRMWARE_MAX_UTF8;
    const overFirmware = state.totalBytes > NAME_FIRMWARE_MAX_UTF8;

    if (namePreviewEl) {
      if (!state.name) {
        namePreviewEl.textContent = "—";
        namePreviewEl.classList.remove("is-warning");
      } else if (overAdvert) {
        namePreviewEl.textContent = state.name;
        namePreviewEl.classList.add("is-warning");
      } else {
        namePreviewEl.textContent = state.name;
        namePreviewEl.classList.remove("is-warning");
      }
    }
    if (namePreviewMetaEl) {
      let metaText = "";
      let isWarning = false;
      let isError = false;
      if (!state.hasSuffix) {
        metaText = "Add a custom name to generate the command.";
        isError = true;
      } else if (overFirmware) {
        metaText =
          state.totalBytes +
          " / " +
          NAME_FIRMWARE_MAX_UTF8 +
          " bytes. Too long for firmware; shorten the extra name.";
        isError = true;
      } else if (overAdvert) {
        metaText = state.totalBytes + " / " + NAME_FIRMWARE_MAX_UTF8 + " bytes";
        isWarning = true;
      } else if (state.hasSuffix) {
        metaText = state.totalBytes + " / " + NAME_ADVERT_MAX_UTF8 + " bytes";
      }
      namePreviewMetaEl.textContent = metaText;
      namePreviewMetaEl.classList.toggle("is-error", isError);
      namePreviewMetaEl.classList.toggle("is-warning", isWarning);
    }
    if (namePreviewNoteEl) {
      const showNote =
        state.hasSuffix && state.totalBytes > NAME_ADVERT_MAX_UTF8;
      if (showNote) {
        namePreviewNoteEl.hidden = false;
        namePreviewNoteEl.classList.add("is-warning");
        namePreviewNoteEl.innerHTML =
          "The firmware accepts up to " +
          NAME_FIRMWARE_MAX_UTF8 +
          " bytes in the firmware and for the <code>set name</code> command. " +
          "However, <b>flood adverts</b> with location are limited to " +
          NAME_ADVERT_MAX_UTF8 +
          " bytes: " +
          '<code class="config-naming-preview-advert">' +
          escapeHtml(state.advertName) +
          "</code>";
      } else {
        namePreviewNoteEl.hidden = true;
        namePreviewNoteEl.classList.remove("is-warning");
        namePreviewNoteEl.textContent = "";
      }
    }
  }

  function neighborCountryLabel(code) {
    for (let i = 0; i < COUNTRY_CLI.length; i++) {
      if (COUNTRY_CLI[i][2] === code) return COUNTRY_CLI[i][1];
    }
    return code;
  }

  function sortCodesForCli(codes) {
    const set = new Set(codes);
    const out = [];
    CLI_ORDER_FIRST.forEach(function (c) {
      if (set.has(c)) {
        out.push(c);
        set.delete(c);
      }
    });
    return out.concat(Array.from(set).sort());
  }

  function withoutStar(codes) {
    return codes.filter(function (c) {
      return c !== "*";
    });
  }

  function starFirst(sorted) {
    const idx = sorted.indexOf("*");
    if (idx <= 0) return sorted;
    return ["*"].concat(
      sorted.filter(function (c) {
        return c !== "*";
      }),
    );
  }

  function findCityByCode(code) {
    if (!code || !CITIES || !CITIES.length) return null;
    for (let i = 0; i < CITIES.length; i++) {
      if (CITIES[i].city_code === code) return CITIES[i];
    }
    return null;
  }

  /** Home-override select: omit `region home` from generated CLI entirely. */
  const HOME_OVERRIDE_OMIT = "__nohome__";

  function expandedNameForRegionCode(code) {
    if (code === "*") return "wildcard root";
    if (code === "eu") return "European Union";
    if (code === "bx") return "Benelux";
    if (Object.prototype.hasOwnProperty.call(PROVINCE_NAMES, code)) {
      return PROVINCE_NAMES[code];
    }
    const cc = neighborCountryLabel(code);
    if (cc !== code) return cc;
    const row = findCityByCode(code);
    if (row && row.plaats) return row.plaats;
    return code;
  }

  function homeOverrideOptionLabel(code) {
    const name = expandedNameForRegionCode(code);
    if (name !== code) {
      return code + " (" + name + ")";
    }
    return code;
  }

  function addRegionCode(needed, code) {
    if (!code || needed.has(code)) return false;
    needed.add(code);
    return true;
  }

  /**
   * Add province/be ancestors for cities and be for provinces when those
   * codes appear in policy selections. Skips auto-adding ancestors for the
   * selected home city and home province so region put lines follow home
   * Allow checkboxes only.
   */
  function expandRegionNeeded(needed, anchor) {
    let changed = true;
    while (changed) {
      changed = false;
      const snap = Array.from(needed);
      for (let i = 0; i < snap.length; i++) {
        const c = snap[i];
        const row = findCityByCode(c);
        if (row) {
          const isHomeCity =
            anchor &&
            anchor.mode === "city" &&
            anchor.row &&
            c === anchor.row.city_code;
          if (!isHomeCity) {
            if (addRegionCode(needed, row.province_code)) changed = true;
            if (addRegionCode(needed, "be")) changed = true;
          }
        }
        if (Object.prototype.hasOwnProperty.call(PROVINCE_NAMES, c)) {
          const isHomeProv =
            anchor &&
            ((anchor.mode === "city" &&
              anchor.row &&
              c === anchor.row.province_code) ||
              (anchor.mode === "province" && c === anchor.province_code));
          if (!isHomeProv) {
            if (addRegionCode(needed, "be")) changed = true;
          }
        }
      }
    }
  }

  /**
   * Parent for country-level region put lines (nl, lu, fr, de, be).
   * Without eu/bx: omit parent (not under *). With eu/bx: Benelux members
   * under bx when both exist, else under eu or bx; FR/DE under eu only.
   */
  function countryPutParent(co, needed) {
    const benelux = co === "nl" || co === "be" || co === "lu";
    const frde = co === "fr" || co === "de";
    if (!needed.has("eu") && !needed.has("bx")) {
      return null;
    }
    if (benelux) {
      if (needed.has("eu") && needed.has("bx")) return "bx";
      if (needed.has("bx")) return "bx";
      if (needed.has("eu")) return "eu";
    }
    if (frde) {
      if (needed.has("eu")) return "eu";
      return null;
    }
    return null;
  }

  function buildOrderedRegionPutLines(needed, homeCityRow) {
    const lines = [];
    const structured = new Set();

    if (needed.has("eu")) {
      lines.push("region put eu");
      structured.add("eu");
    }
    if (needed.has("bx")) {
      if (needed.has("eu")) {
        lines.push("region put bx eu");
      } else {
        lines.push("region put bx");
      }
      structured.add("bx");
    }

    sortCodesForCli(
      ["nl", "lu", "fr", "de", "be"].filter(function (co) {
        return needed.has(co);
      }),
    ).forEach(function (co) {
      const parent = countryPutParent(co, needed);
      if (parent === null) {
        lines.push("region put " + co);
      } else {
        lines.push("region put " + co + " " + parent);
      }
      structured.add(co);
    });

    sortCodesForCli(
      Object.keys(PROVINCE_NAMES).filter(function (p) {
        return needed.has(p);
      }),
    ).forEach(function (p) {
      lines.push("region put " + p + " be");
      structured.add(p);
    });

    const cityRows = [];
    needed.forEach(function (c) {
      if (structured.has(c)) return;
      let row = findCityByCode(c);
      if (!row && homeCityRow && c === homeCityRow.city_code) row = homeCityRow;
      if (row) {
        cityRows.push({ code: c, prov: row.province_code });
      }
    });
    cityRows.sort(function (a, b) {
      return a.code.localeCompare(b.code);
    });
    cityRows.forEach(function (pair) {
      lines.push("region put " + pair.code + " " + pair.prov);
      structured.add(pair.code);
    });

    const misc = [];
    needed.forEach(function (c) {
      if (!structured.has(c)) misc.push(c);
    });
    misc.sort();
    misc.forEach(function (c) {
      lines.push("region put " + c + " *");
    });

    return lines;
  }

  function policyRow(labelHtml, code, opts) {
    opts = opts || {};
    const idBase = "pc_" + code.replace(/[^a-zA-Z0-9]/g, "_");
    const allowChk = opts.allow === false ? "" : " checked";
    const denyChk = opts.deny ? " checked" : "";
    const esc = escapeHtml(code);
    return (
      '<div class="policy-row">' +
      '<span class="policy-row-label">' +
      labelHtml +
      '</span><div class="policy-row-clear-slot" aria-hidden="true"></div><div class="policy-cell policy-cell--allow"><input type="checkbox" class="policy-allow" data-code="' +
      esc +
      '" id="' +
      idBase +
      '_a"' +
      allowChk +
      ' aria-label="Allow flood for ' +
      esc +
      '"></div><div class="policy-cell policy-cell--deny"><input type="checkbox" class="policy-deny" data-code="' +
      esc +
      '" id="' +
      idBase +
      '_d"' +
      denyChk +
      ' aria-label="Deny flood for ' +
      esc +
      '"></div></div>'
    );
  }

  function syncScopeMasters(subsection) {
    if (!subsection) return;
    const ma = subsection.querySelector(".policy-scope-master-allow");
    const md = subsection.querySelector(".policy-scope-master-deny");
    if (!ma || !md) return;

    const allowInputs = Array.from(
      subsection.querySelectorAll("input.policy-allow"),
    ).filter(function (el) {
      return !el.disabled;
    });
    const denyInputs = Array.from(
      subsection.querySelectorAll("input.policy-deny"),
    ).filter(function (el) {
      return !el.disabled;
    });

    ma.indeterminate = false;
    md.indeterminate = false;

    if (allowInputs.length > 0 && allowInputs.length === denyInputs.length) {
      const n = allowInputs.length;
      let cAllow = 0;
      let cDeny = 0;
      for (let i = 0; i < n; i++) {
        if (allowInputs[i].checked) cAllow++;
        if (denyInputs[i].checked) cDeny++;
      }
      if (!ma.disabled) {
        ma.checked = cAllow === n && cDeny === 0;
        if (cAllow > 0 && cAllow < n) ma.indeterminate = true;
      }
      if (!md.disabled) {
        md.checked = cDeny === n && cAllow === 0;
        if (cDeny > 0 && cDeny < n) md.indeterminate = true;
      }
      return;
    }

    if (!ma.disabled) {
      if (allowInputs.length === 0) {
        ma.checked = false;
      } else {
        const na = allowInputs.length;
        let cAllow = 0;
        for (let i = 0; i < na; i++) {
          if (allowInputs[i].checked) cAllow++;
        }
        ma.checked = cAllow === na;
        if (cAllow > 0 && cAllow < na) ma.indeterminate = true;
      }
    }
    if (!md.disabled) {
      if (denyInputs.length === 0) {
        md.checked = false;
      } else {
        const nd = denyInputs.length;
        let cDeny = 0;
        for (let i = 0; i < nd; i++) {
          if (denyInputs[i].checked) cDeny++;
        }
        md.checked = cDeny === nd;
        if (cDeny > 0 && cDeny < nd) md.indeterminate = true;
      }
    }
  }

  function homeAllowChecked(homeSub, code) {
    if (!homeSub || code == null || code === "") return false;
    const inputs = homeSub.querySelectorAll("input.policy-allow");
    for (let i = 0; i < inputs.length; i++) {
      if (inputs[i].getAttribute("data-code") === code) {
        return inputs[i].checked;
      }
    }
    return false;
  }

  function homeDenyChecked(homeSub, code) {
    if (!homeSub || code == null || code === "") return false;
    const inputs = homeSub.querySelectorAll("input.policy-deny");
    for (let i = 0; i < inputs.length; i++) {
      if (inputs[i].getAttribute("data-code") === code) {
        return inputs[i].checked;
      }
    }
    return false;
  }

  function homeAllowOrDenyChecked(homeSub, code) {
    return homeAllowChecked(homeSub, code) || homeDenyChecked(homeSub, code);
  }

  /**
   * Default region home when Home override is off: smallest Allow in home
   * table — city (only in city mode), province, then be. Country-only: be.
   */
  function deepestAllowedHomeRegionCode(anchor) {
    if (!anchor) return "*";
    const home = policyCard
      ? policyCard.querySelector('.policy-subsection[data-policy-scope="home"]')
      : null;
    if (anchor.mode === "country") {
      if (homeAllowChecked(home, "be")) return "be";
      return "*";
    }
    const chain = [];
    if (anchor.mode === "city" && anchor.row && anchor.row.city_code)
      chain.push(anchor.row.city_code);
    const pc =
      anchor.mode === "province"
        ? anchor.province_code
        : anchor.row && anchor.row.province_code;
    if (pc) chain.push(pc);
    chain.push("be");
    for (let i = 0; i < chain.length; i++) {
      if (homeAllowChecked(home, chain[i])) return chain[i];
    }
    return "*";
  }

  /**
   * Repopulate the home-override dropdown: No home, Default, every
   * Allow-checked scope, plus * (wildcard root). Option text shows full name
   * in brackets where known.
   */
  function refreshHomeOverrideSelect() {
    const sel = document.getElementById("policy-home-override-select");
    const ov = document.getElementById("policy-home-override");
    if (!sel || !policyCard) return;
    const prev = sel.value;
    const codes = [];
    const seen = new Set();
    policyCard
      .querySelectorAll("input.policy-allow:checked")
      .forEach(function (el) {
        const c = el.getAttribute("data-code");
        if (!c || seen.has(c)) return;
        seen.add(c);
        codes.push(c);
      });
    if (!seen.has("*")) {
      seen.add("*");
      codes.push("*");
    }
    const sorted = starFirst(sortCodesForCli(codes));
    sel.innerHTML = "";
    const opt0 = document.createElement("option");
    opt0.value = "";
    opt0.textContent = "Default";
    sel.appendChild(opt0);
    const optNoHome = document.createElement("option");
    optNoHome.value = HOME_OVERRIDE_OMIT;
    optNoHome.textContent = "No home";
    sel.appendChild(optNoHome);
    sorted.forEach(function (c) {
      const o = document.createElement("option");
      o.value = c;
      o.textContent = homeOverrideOptionLabel(c);
      sel.appendChild(o);
    });
    if (prev === HOME_OVERRIDE_OMIT) {
      sel.value = HOME_OVERRIDE_OMIT;
    } else if (prev && seen.has(prev)) {
      sel.value = prev;
    }
    if (ov) {
      sel.disabled = !ov.checked;
    }
  }

  /**
   * Full `region home …` line for the CLI, or null to omit the command.
   * Override off, or on with empty select → automatic smallest home Allow, else *.
   * Override on with "No home" → omit line. Override on with a code → that code.
   */
  function regionHomeLineForCli(anchor) {
    const ov = document.getElementById("policy-home-override");
    if (ov && ov.checked) {
      const sel = document.getElementById("policy-home-override-select");
      const v = sel && sel.value;
      if (v === HOME_OVERRIDE_OMIT) {
        return null;
      }
      if (!v) {
        return "region home " + deepestAllowedHomeRegionCode(anchor);
      }
      return "region home " + v;
    }
    return "region home " + deepestAllowedHomeRegionCode(anchor);
  }

  /**
   * Neighbour scopes: shown, and Allow/Deny enabled, only when the
   * matching home row (be / province / place) has Allow or Deny checked.
   * Otherwise the whole subsection is hidden and its checkboxes cleared.
   */
  function applyNeighborPolicyGating(anchor) {
    if (!policyCard || !anchor) return;
    const home = policyCard.querySelector(
      '.policy-subsection[data-policy-scope="home"]',
    );
    if (!home) return;

    const gateCountry = homeAllowOrDenyChecked(home, "be");
    const provCode =
      anchor.mode === "province"
        ? anchor.province_code
        : anchor.row
          ? anchor.row.province_code
          : null;
    const gateProvince = !!provCode && homeAllowOrDenyChecked(home, provCode);
    const gateCity =
      anchor.mode === "city" &&
      anchor.row &&
      homeAllowOrDenyChecked(home, anchor.row.city_code);

    const tiers = [
      ["neighbor-municipalities", gateCity],
      ["neighbor-provinces", gateProvince],
      ["neighbor-countries", gateCountry],
    ];

    for (let t = 0; t < tiers.length; t++) {
      const scopeKey = tiers[t][0];
      const gate = tiers[t][1];
      const sub = policyCard.querySelector(
        '.policy-subsection[data-policy-scope="' + scopeKey + '"]',
      );
      if (!sub) continue;

      if (gate) {
        sub.removeAttribute("hidden");
      } else {
        sub.setAttribute("hidden", "");
      }

      sub.querySelectorAll("input.policy-allow").forEach(function (el) {
        el.disabled = !gate;
        if (!gate) el.checked = false;
      });
      sub.querySelectorAll("input.policy-deny").forEach(function (el) {
        el.disabled = !gate;
        if (!gate) el.checked = false;
      });

      const ma = sub.querySelector(".policy-scope-master-allow");
      if (ma) {
        ma.disabled = !gate;
        if (!gate) {
          ma.checked = false;
          ma.indeterminate = false;
        }
      }
      const md = sub.querySelector(".policy-scope-master-deny");
      if (md) {
        md.disabled = !gate;
        if (!gate) {
          md.checked = false;
          md.indeterminate = false;
        }
      }
    }
  }

  function finalizePolicyUiChange() {
    if (!policyCard) return;
    const anchor = getAnchor();
    if (anchor) applyNeighborPolicyGating(anchor);
    policyCard.querySelectorAll(".policy-subsection").forEach(syncScopeMasters);
    refreshFoundCodesAndCli();
  }

  /**
   * @param {{ c: object, km: number }[]} neighborsScope — municipalities shown in policy (capped)
   * @param {{ c: object, km: number }[]} neighborsRadius — all within radius; provinces + empty checks
   */
  function renderPolicyGrids(
    anchor,
    neighborsScope,
    neighborsRadius,
    hasCoords,
  ) {
    if (!policyGridsContainer || !anchor) return;
    let html = "";
    const homeProvinceCode =
      anchor.mode === "province"
        ? anchor.province_code
        : anchor.row
          ? anchor.row.province_code
          : null;
    function addSubsection(title, rows, emptyNote, scopeKey, opts) {
      opts = opts || {};
      const skipIfEmpty = !!opts.skipIfEmpty;
      const subNoteHtml = opts.subNoteHtml || "";
      const scopeAttr = scopeKey
        ? ' data-policy-scope="' + escapeHtml(scopeKey) + '"'
        : "";
      const defaultAllow = scopeKey === "home";
      if (skipIfEmpty && (!rows || !rows.length)) {
        return;
      }
      html += '<div class="policy-subsection"' + scopeAttr + ">";
      if (!rows.length) {
        html +=
          '<div class="policy-subhead policy-subhead--empty"><h3 class="policy-subtitle">' +
          escapeHtml(title) +
          "</h3></div>";
        html +=
          '<p class="result-muted-note policy-empty">' +
          escapeHtml(emptyNote || "Nothing to list here.") +
          "</p></div>";
        return;
      }
      html +=
        '<div class="policy-subhead"><h3 class="policy-subtitle">' +
        escapeHtml(title) +
        "</h3></div>";
      if (subNoteHtml) {
        html += '<p class="policy-subsection-note">' + subNoteHtml + "</p>";
      }
      html +=
        '<div class="policy-table-head" role="row">' +
        '<div class="policy-head-scope" role="columnheader">Scope</div>' +
        '<div class="policy-head-clear-wrap" role="columnheader">' +
        '<button type="button" class="policy-head-clear-link" data-bulk="clear" aria-label="' +
        escapeHtml(title + " — clear all checkboxes in this scope") +
        '" title="Clear Allow and Deny in this scope">Clear scope</button>' +
        "</div>" +
        '<div class="policy-head-col" role="columnheader">' +
        '<span class="policy-head-label">Allow</span>' +
        '<input type="checkbox" class="policy-scope-master-allow" aria-label="' +
        escapeHtml(title + " — allow all in this scope") +
        '" title="Allow all in this scope">' +
        "</div>" +
        '<div class="policy-head-col" role="columnheader">' +
        '<span class="policy-head-label">Deny</span>' +
        '<input type="checkbox" class="policy-scope-master-deny" aria-label="' +
        escapeHtml(title + " — deny all in this scope") +
        '" title="Deny all in this scope">' +
        "</div></div>";
      rows.forEach(function (row) {
        const allow =
          row.allow !== undefined ? row.allow !== false : defaultAllow;
        const deny = !!row.deny;
        html += policyRow(row.label, row.code, {
          allow: allow,
          deny: deny,
        });
      });
      if (scopeKey === "home" && opts.homeOverrideFooter) {
        html +=
          '<div class="policy-home-override-wrap" role="group" aria-label="Home region override">' +
          '<label class="policy-home-override-label" for="policy-home-override">' +
          '<input type="checkbox" class="policy-home-override" id="policy-home-override">' +
          "<span>Home override</span></label>" +
          '<p class="policy-home-override-hint">' +
          escapeHtml(
            "By default, region home is the smallest scope with Allow checked in the table above. Check Home override if you want a different target.",
          ) +
          "</p>" +
          '<label class="policy-home-override-select-label" for="policy-home-override-select">' +
          "Target for region home</label>" +
          '<select id="policy-home-override-select" class="policy-home-override-select" disabled aria-label="Override region home code">' +
          '<option value="">Default</option>' +
          "</select></div>";
      }
      html += "</div>";
    }

    const homeRows = [{ label: "Belgium (be)", code: "be", allow: true }];
    let homeTitle = "Home scopes: country \u2192 province";
    if (anchor.mode === "country") {
      /* only be */
    } else if (anchor.mode === "province" && anchor.province_code) {
      const pc = anchor.province_code;
      homeRows.push({
        label:
          escapeHtml(PROVINCE_NAMES[pc] || pc) + " (" + escapeHtml(pc) + ")",
        code: pc,
        allow: true,
      });
    } else if (anchor.mode === "city" && anchor.row) {
      const city = anchor.row;
      homeTitle += " \u2192 municipality (UN/LOCODE)";
      homeRows.push({
        label:
          escapeHtml(PROVINCE_NAMES[city.province_code] || city.province_code) +
          " (" +
          escapeHtml(city.province_code) +
          ")",
        code: city.province_code,
        allow: true,
      });
      homeRows.push({
        label:
          escapeHtml(city.plaats) + " (" + escapeHtml(city.city_code) + ")",
        code: city.city_code,
        allow: false,
      });
    }

    addSubsection(homeTitle, homeRows, undefined, "home", {
      homeOverrideFooter: true,
    });

    const nEmptyGeo = !hasCoords
      ? "No coordinates for this location."
      : !neighborsRadius.length
        ? "No other mapped places within ~" + NEIGHBOR_RADIUS_KM + " km."
        : "";

    const npCodes = neighborProvincesFromNeighbors(
      neighborsRadius,
      homeProvinceCode,
    );

    const munNoteCity =
      escapeHtml(
        "Shows the nearest " +
          NEIGHBOR_SCOPE_MAX_CITIES +
          " municipalities within ~" +
          NEIGHBOR_RADIUS_KM +
          " km. See ",
      ) +
      "<code>Codes for this selection</code>" +
      escapeHtml(" for the full list inside that radius.");
    const munNoteProv = escapeHtml(
      "Optional: pick a municipality to populate distance-based neighbours. Province-only setups can skip this.",
    );

    addSubsection(
      "Neighbouring municipalities (by place)",
      neighborsScope.length > 0
        ? neighborsScope.map(function (item) {
            const o = item.c;
            const km = item.km;
            return {
              label:
                escapeHtml(o.plaats) +
                " (~" +
                Math.round(km) +
                " km) (" +
                escapeHtml(o.city_code) +
                ")",
              code: o.city_code,
            };
          })
        : [],
      nEmptyGeo || "No neighbouring municipalities in the dataset yet.",
      "neighbor-municipalities",
      {
        skipIfEmpty: anchor.mode === "city",
        subNoteHtml: anchor.mode === "city" ? munNoteCity : munNoteProv,
      },
    );

    addSubsection(
      "Neighbouring provinces (land borders)",
      npCodes.map(function (pc) {
        const name = PROVINCE_NAMES[pc] || pc;
        return {
          label: escapeHtml(name) + " (" + escapeHtml(pc) + ")",
          code: pc,
        };
      }),
      nEmptyGeo ||
        "No neighbouring provinces for this selection (none of the home province's land-border provinces have a mapped place within ~" +
          NEIGHBOR_RADIUS_KM +
          " km).",
      "neighbor-provinces",
      {
        skipIfEmpty: true,
        subNoteHtml: escapeHtml(
          "Land-border provinces of the home province, limited to those with at least one mapped municipality within ~" +
            NEIGHBOR_RADIUS_KM +
            " km of this selection (so the list matches where you are, not the whole province outline).",
        ),
      },
    );

    addSubsection(
      "Neighbour countries (CLI)",
      NEIGHBOR_COUNTRY_CODES.map(function (code) {
        return {
          label:
            escapeHtml(neighborCountryLabel(code)) +
            " (" +
            escapeHtml(code) +
            ")",
          code: code,
        };
      }),
      undefined,
      "neighbor-countries",
      {
        skipIfEmpty: true,
        subNoteHtml: escapeHtml(
          "Country rows only. For provinces or other scopes inside a neighbour, add those names manually (see that country’s mesh code list).",
        ),
      },
    );

    addSubsection(
      "Wider regions (CLI)",
      [
        { label: "European Union (eu)", code: "eu" },
        { label: "Benelux (bx)", code: "bx" },
      ],
      undefined,
      "wider",
    );

    policyGridsContainer.innerHTML = html;
    applyNeighborPolicyGating(anchor);
    policyGridsContainer
      .querySelectorAll(".policy-subsection")
      .forEach(syncScopeMasters);
  }

  function applyPolicyDefaults() {
    if (!policyCard) return;
    policyCard.querySelectorAll(".policy-subsection").forEach(function (sub) {
      const scope = sub.getAttribute("data-policy-scope");
      if (scope === "home") {
        sub.querySelectorAll("input.policy-allow").forEach(function (el) {
          const code = el.getAttribute("data-code");
          if (selectionMode === "country") {
            el.checked = code === "be";
          } else if (selectionMode === "province" && selectedProvinceCode) {
            el.checked = code === "be" || code === selectedProvinceCode;
          } else if (selectionMode === "city" && selectedCity) {
            const prov = selectedCity.province_code || "";
            el.checked = code === "be" || (prov && code === prov);
          } else {
            el.checked = false;
          }
        });
        sub.querySelectorAll("input.policy-deny").forEach(function (el) {
          el.checked = false;
        });
      } else {
        sub
          .querySelectorAll("input.policy-allow, input.policy-deny")
          .forEach(function (el) {
            el.checked = false;
          });
      }
    });
    const untagged = document.getElementById("policy-untagged-flood");
    if (untagged) untagged.checked = true;
    const ho = document.getElementById("policy-home-override");
    const hs = document.getElementById("policy-home-override-select");
    if (ho) ho.checked = false;
    if (hs) hs.value = "";
    finalizePolicyUiChange();
  }

  function refreshPolicySection(anchor) {
    if (!policyCard) return;
    policyCard.classList.add("visible");
    const emptyEl = document.getElementById("policy-scope-empty");
    const bodyEl = document.getElementById("policy-regions-body");
    if (!anchor) {
      if (emptyEl) {
        emptyEl.hidden = false;
      }
      if (bodyEl) {
        bodyEl.hidden = true;
      }
      if (policyGridsContainer) {
        policyGridsContainer.innerHTML = "";
      }
      return;
    }
    if (emptyEl) {
      emptyEl.hidden = true;
    }
    if (bodyEl) {
      bodyEl.hidden = false;
    }
  }

  function updateMeshcoreCliBlock(anchor) {
    if (!commandsBlock) return;

    const sections = [];
    if (namePreviewState && namePreviewState.isValid && namePreviewState.name) {
      sections.push("set name " + namePreviewState.name);
    }

    const showCliDefaults = Boolean(
      cliShowDefaultsEl && cliShowDefaultsEl.checked,
    );
    const setupLines = buildGeneralSettingsCli(showCliDefaults);
    if (setupLines) {
      sections.push(setupLines);
    }

    if (anchor) {
      refreshHomeOverrideSelect();
      const allowCodes = [];
      const denyCodes = [];
      if (policyCard) {
        policyCard
          .querySelectorAll("input.policy-allow:checked")
          .forEach(function (el) {
            allowCodes.push(el.getAttribute("data-code"));
          });
        policyCard
          .querySelectorAll("input.policy-deny:checked")
          .forEach(function (el) {
            denyCodes.push(el.getAttribute("data-code"));
          });
      }
      const untaggedEl = document.getElementById("policy-untagged-flood");
      const allowUntagged = !untaggedEl || untaggedEl.checked;
      let allowForCli = withoutStar(allowCodes);
      let denyForCli = withoutStar(denyCodes);
      if (allowUntagged) {
        allowForCli.push("*");
      } else {
        denyForCli.push("*");
      }
      const allowSorted = starFirst(sortCodesForCli(allowForCli));
      const denySorted = starFirst(sortCodesForCli(denyForCli));

      const needed = new Set();
      withoutStar(allowForCli).forEach(function (c) {
        needed.add(c);
      });
      withoutStar(denyForCli).forEach(function (c) {
        needed.add(c);
      });
      expandRegionNeeded(needed, anchor);
      const homeCityRow =
        anchor.mode === "city" && anchor.row ? anchor.row : null;
      const putLines = buildOrderedRegionPutLines(needed, homeCityRow).join(
        "\n",
      );
      const allowfLines = allowSorted
        .map((r) => `region allowf ${r}`)
        .join("\n");
      const denyfLines = denySorted.map((r) => `region denyf ${r}`).join("\n");

      const homeLine = regionHomeLineForCli(anchor);

      const regionBlocks = [];
      const putTrimmed = putLines.trim();
      if (putTrimmed) {
        regionBlocks.push(putTrimmed);
      }
      if (allowSorted.length > 0) {
        regionBlocks.push(allowfLines);
      }
      if (denyfLines) {
        regionBlocks.push(denyfLines);
      }
      let regionCmd = regionBlocks.length ? regionBlocks.join("\n\n") : "";
      if (regionCmd) {
        regionCmd += "\n\n";
      }
      if (homeLine) {
        regionCmd += homeLine + "\n\n";
      }
      regionCmd += "region save";
      sections.push(regionCmd);
    }

    commandsBlock.textContent = sections.join("\n\n");
  }

  /** @deprecated Use refreshConfiguratorOutputs — kept for call sites that only need CLI text. */
  function refreshMeshcoreCli() {
    refreshConfiguratorOutputs();
  }

  /**
   * Neighbour provinces for policy / “Codes for this selection”:
   * land borders (PROVINCE_ADJACENCY) ∩ provinces that actually appear
   * among municipalities within NEIGHBOR_RADIUS_KM of the seed point.
   * Pure adjacency alone lists every province sharing any border with the
   * home province (e.g. Limburg for all of East Flanders, including Ronse).
   */
  function neighborProvincesFromNeighbors(neighbors, homeProvinceCode) {
    const pc =
      homeProvinceCode != null && typeof homeProvinceCode === "string"
        ? homeProvinceCode.trim()
        : homeProvinceCode;
    if (!pc || !Object.prototype.hasOwnProperty.call(PROVINCE_ADJACENCY, pc)) {
      return [];
    }
    const adjacent = PROVINCE_ADJACENCY[pc];
    const nearbyProv = new Set();
    const arr = neighbors || [];
    for (let i = 0; i < arr.length; i++) {
      const ocp = arr[i].c.province_code;
      if (ocp && ocp !== pc) nearbyProv.add(ocp);
    }
    if (nearbyProv.size > 0) {
      const out = [];
      for (let j = 0; j < adjacent.length; j++) {
        const op = adjacent[j];
        if (nearbyProv.has(op)) out.push(op);
      }
      return out.sort();
    }
    return adjacent.slice().sort();
  }

  function neighborProvincesSectionHTML(neighbors, homeProvinceCode) {
    const codes = neighborProvincesFromNeighbors(neighbors, homeProvinceCode);
    const n = codes.length;
    if (!codes.length) {
      return (
        '<details class="result-neighbors-details result-province-neighbors">' +
        "<summary>" +
        escapeHtml("Neighbouring provinces (land borders)") +
        "</summary>" +
        '<p class="result-muted-note">' +
        escapeHtml(
          "No neighbouring provinces for this selection (none of the home province's land-border provinces have a mapped place within ~" +
            NEIGHBOR_RADIUS_KM +
            " km).",
        ) +
        "</p></details>"
      );
    }
    const sum =
      "Neighbouring provinces · " +
      n +
      (n === 1 ? " land border" : " land borders");
    return (
      '<details class="result-neighbors-details result-province-neighbors">' +
      "<summary>" +
      escapeHtml(sum) +
      "</summary>" +
      '<div class="result-neighbors-list">' +
      codes
        .map(function (pc) {
          const name = PROVINCE_NAMES[pc] || pc;
          return (
            '<div class="result-neighbor-card"><p class="result-neighbor-title">' +
            escapeHtml(name) +
            ' <span class="result-code-inline">(' +
            escapeHtml(pc) +
            ')</span> <span class="result-neighbor-distance">' +
            escapeHtml("· land border") +
            "</span></p></div>"
          );
        })
        .join("") +
      "</div></details>"
    );
  }

  function buildFoundCodesInnerHTML(anchor, neighbors, hasCoords) {
    let neighborSection = "";
    let neighborProvincesSection = "";
    const homeProv =
      anchor.mode === "province"
        ? anchor.province_code
        : anchor.row
          ? anchor.row.province_code
          : null;
    if (hasCoords) {
      if (neighbors.length) {
        const nMun = neighbors.length;
        const munLabel =
          nMun === 1 ? "1 municipality" : nMun + " municipalities";
        const detailsOpen = nMun <= 6 ? " open" : "";
        neighborSection =
          '<details class="result-neighbors-details"' +
          detailsOpen +
          ">" +
          "<summary>" +
          escapeHtml(
            "Neighbouring municipalities (~" +
              NEIGHBOR_RADIUS_KM +
              " km) · " +
              munLabel,
          ) +
          "</summary>" +
          '<div class="result-neighbors-list">' +
          neighbors
            .map(function (item) {
              const o = item.c;
              const km = item.km;
              return (
                '<div class="result-neighbor-card"><p class="result-neighbor-title">' +
                escapeHtml(o.plaats) +
                ' <span class="result-code-inline">(' +
                escapeHtml(o.city_code) +
                ')</span> <span class="result-neighbor-distance">· ~' +
                Math.round(km) +
                " km</span></p></div>"
              );
            })
            .join("") +
          "</div></details>";
      } else {
        neighborSection =
          '<details class="result-neighbors-details">' +
          "<summary>" +
          escapeHtml(
            "Neighbouring municipalities (~" + NEIGHBOR_RADIUS_KM + " km)",
          ) +
          "</summary>" +
          '<p class="result-muted-note">No other mapped places within ~' +
          NEIGHBOR_RADIUS_KM +
          " km.</p></details>";
      }
    } else {
      neighborSection =
        '<details class="result-neighbors-details">' +
        "<summary>" +
        escapeHtml(
          "Neighbouring municipalities (~" + NEIGHBOR_RADIUS_KM + " km)",
        ) +
        "</summary>" +
        '<p class="result-muted-note">No coordinates for this location — neighbours not computed.</p></details>';
    }
    if (homeProv) {
      neighborProvincesSection = neighborProvincesSectionHTML(
        neighbors,
        homeProv,
      );
    }

    return (
      '<div class="result-codes-section">' +
      '<h3 class="result-block-heading">Selected location</h3><div class="result-grid">' +
      chosenLocationRowsFromAnchor(anchor) +
      "</div></div>" +
      neighborProvincesSection +
      neighborSection
    );
  }

  function refreshConfiguratorOutputs() {
    const anchor = getAnchor();
    refreshNamingUi(anchor);
    refreshRadioSettingsUi();
    refreshPolicySection(anchor);
    if (resultGrid) {
      if (!anchor) {
        resultGrid.innerHTML = "";
      } else {
        resultGrid.innerHTML = buildFoundCodesInnerHTML(
          anchor,
          lastNeighbors,
          lastHasCoords,
        );
      }
    }
    updateMeshcoreCliBlock(anchor);
  }

  function locationSearchLabel() {
    if (selectionMode === "country") return "België (be)";
    if (selectionMode === "province" && selectedProvinceCode) {
      return PROVINCE_NAMES[selectedProvinceCode] || selectedProvinceCode;
    }
    if (selectionMode === "city" && selectedCity) return selectedCity.plaats;
    return "";
  }

  function clearLocationSelection() {
    selectionMode = "none";
    selectedProvinceCode = null;
    selectedCity = null;
    lastNeighbors = [];
    lastHasCoords = false;
  }

  function syncLocationSelectionFromSearch() {
    if (!getAnchor()) return;
    const q = String(input.value || "").trim();
    const label = locationSearchLabel();
    if (!q || (label && q !== label)) {
      clearLocationSelection();
      refreshConfiguratorOutputs();
    }
  }

  function refreshFoundCodesAndCli() {
    refreshConfiguratorOutputs();
  }

  function selectProvince(pc) {
    selectionMode = "province";
    selectedProvinceCode = pc;
    selectedCity = null;
    input.value = PROVINCE_NAMES[pc] || pc;
    dropdown.style.display = "none";

    const anchor = getAnchor();
    const seed = neighborSeedRow(anchor);
    const neighborsRadius = findGeographicNeighbors(seed, {
      maxKm: NEIGHBOR_RADIUS_KM,
    });
    const neighborsScope = neighborsRadius.slice(0, NEIGHBOR_SCOPE_MAX_CITIES);
    const hasCoords =
      seed.lat != null &&
      seed.lon != null &&
      Number.isFinite(seed.lat) &&
      Number.isFinite(seed.lon);

    lastNeighbors = neighborsRadius;
    lastHasCoords = hasCoords;

    renderPolicyGrids(anchor, neighborsScope, neighborsRadius, hasCoords);
    if (policyCard) policyCard.classList.add("visible");
    resetNamingForLocation(anchor);
    applyPolicyDefaults();
    resultCard.classList.add("visible");
    commandsCard.classList.add("visible");
    refreshConfiguratorOutputs();
  }

  function selectCountryBe() {
    selectionMode = "country";
    selectedProvinceCode = null;
    selectedCity = null;
    input.value = "België (be)";
    dropdown.style.display = "none";

    const anchor = getAnchor();
    const seed = neighborSeedRow(anchor);
    const neighborsRadius = findGeographicNeighbors(seed, {
      maxKm: NEIGHBOR_RADIUS_KM,
    });
    const neighborsScope = neighborsRadius.slice(0, NEIGHBOR_SCOPE_MAX_CITIES);
    const hasCoords =
      seed.lat != null &&
      seed.lon != null &&
      Number.isFinite(seed.lat) &&
      Number.isFinite(seed.lon);

    lastNeighbors = neighborsRadius;
    lastHasCoords = hasCoords;

    renderPolicyGrids(anchor, neighborsScope, neighborsRadius, hasCoords);
    if (policyCard) policyCard.classList.add("visible");
    resetNamingForLocation(anchor);
    applyPolicyDefaults();
    resultCard.classList.add("visible");
    commandsCard.classList.add("visible");
    refreshConfiguratorOutputs();
  }

  function selectCity(city) {
    selectionMode = "city";
    selectedProvinceCode = city.province_code;
    selectedCity = city;
    input.value = city.plaats;
    dropdown.style.display = "none";

    const anchor = getAnchor();
    const neighborsRadius = findGeographicNeighbors(city, {
      maxKm: NEIGHBOR_RADIUS_KM,
    });
    const neighborsScope = neighborsRadius.slice(0, NEIGHBOR_SCOPE_MAX_CITIES);
    const hasCoords =
      city.lat != null &&
      city.lon != null &&
      Number.isFinite(city.lat) &&
      Number.isFinite(city.lon);

    lastNeighbors = neighborsRadius;
    lastHasCoords = hasCoords;

    renderPolicyGrids(anchor, neighborsScope, neighborsRadius, hasCoords);
    if (policyCard) policyCard.classList.add("visible");
    resetNamingForLocation(anchor);
    applyPolicyDefaults();
    resultCard.classList.add("visible");
    commandsCard.classList.add("visible");
    refreshConfiguratorOutputs();
  }

  input.addEventListener("input", () => {
    syncLocationSelectionFromSearch();
    const matches = filterLocationChoices(input.value);
    renderDropdown(matches);
  });

  input.addEventListener("keydown", (e) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      activeIndex = Math.min(activeIndex + 1, dropdown.children.length - 1);
      dropdown
        .querySelectorAll(".search-dropdown-item")
        .forEach((el, i) => el.classList.toggle("active", i === activeIndex));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      activeIndex = Math.max(activeIndex - 1, 0);
      dropdown
        .querySelectorAll(".search-dropdown-item")
        .forEach((el, i) => el.classList.toggle("active", i === activeIndex));
    } else if (
      e.key === "Enter" &&
      dropdown.style.display !== "none" &&
      lastMatches[activeIndex]
    ) {
      e.preventDefault();
      const item = lastMatches[activeIndex];
      if (item.type === "country") selectCountryBe();
      else if (item.type === "province") selectProvince(item.code);
      else if (item.type === "place" && item.row) selectCity(item.row);
    } else if (e.key === "Escape") {
      dropdown.style.display = "none";
    }
  });

  input.addEventListener("focus", () => {
    const matches = filterLocationChoices(input.value);
    if (matches.length) renderDropdown(matches);
  });

  document.addEventListener("click", (e) => {
    if (!input.contains(e.target) && !dropdown.contains(e.target)) {
      dropdown.style.display = "none";
    }
  });

  copyBtn.addEventListener("click", () => {
    refreshFoundCodesAndCli();
    navigator.clipboard.writeText(commandsBlock.textContent).then(() => {
      copyBtn.textContent = "Copied";
      copyBtn.classList.add("copied");
      setTimeout(() => {
        copyBtn.textContent = "Copy commands";
        copyBtn.classList.remove("copied");
      }, 2000);
    });
  });

  if (cliShowDefaultsEl) {
    cliShowDefaultsEl.addEventListener("change", refreshConfiguratorOutputs);
  }

  const settingsCard = document.getElementById("settings-card");
  if (settingsCard) {
    settingsCard.addEventListener("input", function (e) {
      const t = e.target;
      if (t instanceof HTMLElement && t.id === "setting-radio-bw") {
        clampRadioBwInput();
      }
      refreshConfiguratorOutputs();
    });
    settingsCard.addEventListener("change", function (e) {
      const t = e.target;
      if (t instanceof HTMLElement && t.id === "setting-radio-bw") {
        clampRadioBwInput();
      }
      if (
        t instanceof HTMLElement &&
        t.id === "setting-radio-preset" &&
        settingRadioPresetEl
      ) {
        if (isCustomRadioPreset()) {
          const idx = parseInt(
            settingRadioPresetEl.dataset.lastPreset || "",
            10,
          );
          if (Number.isFinite(idx)) {
            fillCustomRadioFields(getPresetRadioByIndex(idx));
          }
        } else {
          settingRadioPresetEl.dataset.lastPreset = settingRadioPresetEl.value;
        }
      }
      refreshConfiguratorOutputs();
    });
  }

  const namingCard = document.getElementById("naming-card");
  if (namingCard) {
    namingCard.addEventListener("input", function (e) {
      const t = e.target;
      if (!(t instanceof HTMLElement)) return;
      if (t.id !== "name-suffix" && t.id !== "name-power-emoji") {
        return;
      }
      const anchor = getAnchor();
      clampNamingInput(anchor);
      refreshConfiguratorOutputs();
    });
    namingCard.addEventListener("change", function (e) {
      const t = e.target;
      if (!(t instanceof HTMLElement)) return;
      if (t.id !== "name-location-mode" && t.id !== "name-power-emoji") {
        return;
      }
      const anchor = getAnchor();
      if (t.id === "name-location-mode") {
        syncPrefixField(anchor);
      }
      clampNamingInput(anchor);
      refreshConfiguratorOutputs();
    });
  }

  initRadioPresetSelect();

  const untaggedFloodEl = document.getElementById("policy-untagged-flood");
  if (untaggedFloodEl) {
    untaggedFloodEl.addEventListener("change", function () {
      refreshConfiguratorOutputs();
    });
  }

  if (commandsCard) commandsCard.classList.add("visible");
  if (resultCard) resultCard.classList.add("visible");
  setCurrentLocationMode("none");
  refreshConfiguratorOutputs();

  if (policyCard) {
    policyCard.addEventListener("change", function (e) {
      const t = e.target;
      if (
        t instanceof HTMLSelectElement &&
        t.id === "policy-home-override-select"
      ) {
        finalizePolicyUiChange();
        return;
      }
      if (!(t instanceof HTMLInputElement) || t.type !== "checkbox") return;

      if (t.id === "policy-untagged-flood") {
        refreshConfiguratorOutputs();
        return;
      }

      if (t.classList.contains("policy-scope-master-allow")) {
        const subsection = t.closest(".policy-subsection");
        if (subsection) {
          if (t.checked) {
            subsection
              .querySelectorAll("input.policy-deny")
              .forEach(function (el) {
                if (!el.disabled) el.checked = false;
              });
            subsection
              .querySelectorAll("input.policy-allow")
              .forEach(function (el) {
                if (!el.disabled) el.checked = true;
              });
          } else {
            subsection
              .querySelectorAll("input.policy-allow")
              .forEach(function (el) {
                if (!el.disabled) el.checked = false;
              });
          }
          syncScopeMasters(subsection);
        }
        finalizePolicyUiChange();
        return;
      }
      if (t.classList.contains("policy-scope-master-deny")) {
        const subsection = t.closest(".policy-subsection");
        if (subsection) {
          if (t.checked) {
            subsection
              .querySelectorAll("input.policy-allow")
              .forEach(function (el) {
                if (!el.disabled) el.checked = false;
              });
            subsection
              .querySelectorAll("input.policy-deny")
              .forEach(function (el) {
                if (!el.disabled) el.checked = true;
              });
          } else {
            subsection
              .querySelectorAll("input.policy-deny")
              .forEach(function (el) {
                if (!el.disabled) el.checked = false;
              });
          }
          syncScopeMasters(subsection);
        }
        finalizePolicyUiChange();
        return;
      }

      if (t.classList.contains("policy-allow") && t.checked) {
        const code = t.getAttribute("data-code");
        if (code) {
          const d = policyCard.querySelector(
            'input.policy-deny[data-code="' + code + '"]',
          );
          if (d && !d.disabled) d.checked = false;
        }
      } else if (t.classList.contains("policy-deny") && t.checked) {
        const code = t.getAttribute("data-code");
        if (code) {
          const a = policyCard.querySelector(
            'input.policy-allow[data-code="' + code + '"]',
          );
          if (a && !a.disabled) a.checked = false;
        }
      }

      const sub = t.closest(".policy-subsection");
      if (sub) syncScopeMasters(sub);
      finalizePolicyUiChange();
    });

    policyCard.addEventListener("click", function (e) {
      const gBtn = e.target.closest(".policy-global-btn");
      if (gBtn && policyCard.contains(gBtn)) {
        e.preventDefault();
        const mode = gBtn.getAttribute("data-global-bulk");
        if (mode === "defaults") {
          applyPolicyDefaults();
          return;
        }
        if (mode === "allow") {
          const homeSub = policyCard.querySelector(
            '.policy-subsection[data-policy-scope="home"]',
          );
          if (homeSub) {
            homeSub
              .querySelectorAll("input.policy-deny")
              .forEach(function (el) {
                el.checked = false;
              });
            homeSub
              .querySelectorAll("input.policy-allow")
              .forEach(function (el) {
                el.checked = true;
              });
          }
          const widerSub = policyCard.querySelector(
            '.policy-subsection[data-policy-scope="wider"]',
          );
          if (widerSub) {
            widerSub
              .querySelectorAll("input.policy-deny")
              .forEach(function (el) {
                el.checked = false;
              });
            widerSub
              .querySelectorAll("input.policy-allow")
              .forEach(function (el) {
                el.checked = true;
              });
          }
          const anchorAllow = getAnchor();
          if (anchorAllow) applyNeighborPolicyGating(anchorAllow);
          policyCard
            .querySelectorAll("input.policy-allow")
            .forEach(function (el) {
              if (!el.disabled) el.checked = true;
            });
          policyCard
            .querySelectorAll("input.policy-deny")
            .forEach(function (el) {
              if (!el.disabled) el.checked = false;
            });
        } else if (mode === "deny") {
          const homeSubDeny = policyCard.querySelector(
            '.policy-subsection[data-policy-scope="home"]',
          );
          if (homeSubDeny) {
            homeSubDeny
              .querySelectorAll("input.policy-allow")
              .forEach(function (el) {
                el.checked = false;
              });
            homeSubDeny
              .querySelectorAll("input.policy-deny")
              .forEach(function (el) {
                el.checked = true;
              });
          }
          const anchorDeny = getAnchor();
          if (anchorDeny) applyNeighborPolicyGating(anchorDeny);
          policyCard
            .querySelectorAll("input.policy-deny")
            .forEach(function (el) {
              if (!el.disabled) el.checked = true;
            });
          policyCard
            .querySelectorAll("input.policy-allow")
            .forEach(function (el) {
              if (!el.disabled) el.checked = false;
            });
        } else if (mode === "clear") {
          policyCard
            .querySelectorAll("input.policy-allow, input.policy-deny")
            .forEach(function (el) {
              el.checked = false;
            });
          policyCard
            .querySelectorAll(
              ".policy-scope-master-allow, .policy-scope-master-deny",
            )
            .forEach(function (el) {
              el.checked = false;
              el.indeterminate = false;
            });
          const ho = document.getElementById("policy-home-override");
          const hs = document.getElementById("policy-home-override-select");
          if (ho) ho.checked = false;
          if (hs) hs.value = "";
        }
        finalizePolicyUiChange();
        return;
      }

      const btn = e.target.closest(".policy-head-clear-link");
      if (!btn || !policyCard.contains(btn)) return;
      e.preventDefault();
      const subsection = btn.closest(".policy-subsection");
      if (!subsection) return;
      const bulk = btn.getAttribute("data-bulk");
      if (bulk === "clear") {
        subsection
          .querySelectorAll("input.policy-allow, input.policy-deny")
          .forEach(function (el) {
            el.checked = false;
          });
        subsection
          .querySelectorAll(
            ".policy-scope-master-allow, .policy-scope-master-deny",
          )
          .forEach(function (el) {
            el.checked = false;
            el.indeterminate = false;
          });
        if (subsection.getAttribute("data-policy-scope") === "home") {
          const ho = document.getElementById("policy-home-override");
          const hs = document.getElementById("policy-home-override-select");
          if (ho) ho.checked = false;
          if (hs) hs.value = "";
        }
        syncScopeMasters(subsection);
      }
      finalizePolicyUiChange();
    });
  }
})();
