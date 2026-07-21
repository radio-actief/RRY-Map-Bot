(function () {
  const App = window.ConfiguratorApp;
  if (App && App.initDom) {
    App.initDom();
  }

  // Data-path helper is centralized in src/shared/be-regions.js (RRYRegions)
  // and re-exposed via App.rryDataUrl (src/configurator/dom.js). Delegate here
  // so the resolver lives in exactly one place.
  const rryDataUrl =
    (App && App.rryDataUrl) ||
    (window.RRYRegions && window.RRYRegions.rryDataUrl);

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
      if (App && App.state) App.state.CITIES = CITIES;
      var inp = document.getElementById("city-search");
      if (inp)
        inp.placeholder =
          "Search here ; i.e. Vlaams-Brabant, be-vbr, België, or a municipality…";
    })
    .catch(function () {
      CITIES = [];
      if (App && App.state) App.state.CITIES = CITIES;
      var inp = document.getElementById("city-search");
      if (inp) inp.placeholder = "Could not load locations — try again later.";
    });

  const PROVINCE_NAMES = App && App.PROVINCE_NAMES ? App.PROVINCE_NAMES : {
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
  const serialUsbBtn = document.getElementById("serial-usb-btn");
  const serialReadBtn = document.getElementById("serial-read-btn");
  const serialApplyBtn = document.getElementById("serial-apply-btn");
  const serialApplyBtn2 = document.getElementById("serial-apply-btn-2");
  const serialAdvertZerohopBtn = document.getElementById(
    "serial-advert-zerohop-btn",
  );
  const serialAdvertFloodBtn = document.getElementById(
    "serial-advert-flood-btn",
  );
  const serialConsoleForm = document.getElementById("serial-console-form");
  const serialConsoleInput = document.getElementById("serial-console-input");
  const serialConsoleSendBtn = document.getElementById("serial-console-send-btn");
  const serialConsoleClearBtn = document.getElementById(
    "serial-console-clear-btn",
  );
  const serialStatusEl = document.getElementById("serial-status");
  const serialApplyLogEl = document.getElementById("serial-apply-log");
  const serialShowCommandLogEl = document.getElementById("serial-show-command-log");
  const serialUnsupportedEl = document.getElementById("serial-unsupported");
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
  const settingFloodMaxEl = document.getElementById("setting-flood-max");
  const settingRxdelayEl = document.getElementById("setting-rxdelay");
  const settingRadioRxgainEl = document.getElementById("setting-radio-rxgain");
  const settingIntThreshEl = document.getElementById("setting-int-thresh");
  const settingAgcResetEl = document.getElementById("setting-agc-reset");
  const settingMultiAcksEl = document.getElementById("setting-multi-acks");
  const settingRadioPresetEl = document.getElementById("setting-radio-preset");
  const settingRadioCustomWrapEl = document.getElementById(
    "setting-radio-custom-wrap",
  );
  const settingRadioFreqEl = document.getElementById("setting-radio-freq");
  const settingRadioSfEl = document.getElementById("setting-radio-sf");
  const settingRadioBwEl = document.getElementById("setting-radio-bw");
  const settingRadioCrEl = document.getElementById("setting-radio-cr");
  const settingRadioTxpowerEl = document.getElementById("setting-radio-txpower");
  const settingRadioErrorEl = document.getElementById("setting-radio-error");
  const deviceInfoVersionEl = document.getElementById("device-info-version");
  const deviceInfoRoleEl = document.getElementById("device-info-role");
  const deviceInfoPubkeyEl = document.getElementById("device-info-pubkey");
  const deviceInfoClockEl = document.getElementById("device-info-clock");
  const deviceSyncClockBtn = document.getElementById("device-sync-clock-btn");
  const deviceCopyPubkeyBtn = document.getElementById("device-copy-pubkey-btn");
  const devicePrvkeyEl = document.getElementById("device-prvkey");
  const devicePrvkeyRevealBtn = document.getElementById(
    "device-prvkey-reveal-btn",
  );
  const devicePrvkeyCopyBtn = document.getElementById("device-prvkey-copy-btn");
  const deviceVanityBtn = document.getElementById("device-vanity-btn");
  const deviceRebootBtn = document.getElementById("device-reboot-btn");
  const deviceOtaBtn = document.getElementById("device-ota-btn");
  const deviceFactoryResetBtn = document.getElementById(
    "device-factory-reset-btn",
  );
  const configExportBtn = document.getElementById("config-export-btn");
  const configImportBtn = document.getElementById("config-import-btn");
  const configImportFileEl = document.getElementById("config-import-file");
  const settingLatEl = document.getElementById("setting-lat");
  const settingLonEl = document.getElementById("setting-lon");
  const settingAdvertLocEl = document.getElementById("setting-advert-loc");

  function positionApi() {
    return App && App.position ? App.position : null;
  }

  function getAdvertLocPolicy() {
    const api = positionApi();
    if (api) return api.getAdvertLocPolicy();
    return settingAdvertLocEl ? settingAdvertLocEl.value : "prefs";
  }

  function advertIncludesLocation() {
    const api = positionApi();
    if (api) return api.advertIncludesLocation();
    return getAdvertLocPolicy() !== "none";
  }

  function getFormCoords() {
    const api = positionApi();
    if (api) return api.getCoords();
    return { valid: false, lat: null, lon: null };
  }

  function coordsRequiredForApply() {
    return getAdvertLocPolicy() === "prefs" && !getFormCoords().valid;
  }

  function parseGpsAdvertReply(reply) {
    const r = String(reply || "")
      .trim()
      .replace(/^>\s*/, "");
    if (r === "none" || r === "share" || r === "prefs") return r;
    return null;
  }

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
  let serialApplyAbort = null;
  let serialApplying = false;
  let serialReading = false;
  let serialConsoleSending = false;
  let serialConsoleHistory = [];
  let serialConsoleHistoryBrowse = -1;
  const SERIAL_CONSOLE_HISTORY_MAX = 50;
  const SERIAL_LOG_VERBOSE_KEY = "configurator.serialShowCommandLog";

  function isSerialShowCommandLog() {
    return Boolean(serialShowCommandLogEl && serialShowCommandLogEl.checked);
  }

  function initSerialShowCommandLogToggle() {
    if (!serialShowCommandLogEl) return;
    try {
      serialShowCommandLogEl.checked =
        sessionStorage.getItem(SERIAL_LOG_VERBOSE_KEY) === "1";
    } catch (_e) {
      /* ignore */
    }
    serialShowCommandLogEl.addEventListener("change", function () {
      try {
        sessionStorage.setItem(
          SERIAL_LOG_VERBOSE_KEY,
          serialShowCommandLogEl.checked ? "1" : "0",
        );
      } catch (_e) {
        /* ignore */
      }
    });
  }

  function isSerialBusy() {
    return serialApplying || serialReading || serialConsoleSending;
  }

  const REPEATER_READ_COMMANDS = [
    "get name",
    "get radio",
    "get repeat",
    "get owner.info",
    "get guest.password",
    "get dutycycle",
    "get flood.advert.interval",
    "get advert.interval",
    "get flood.max.unscoped",
    "get flood.max.advert",
    "get flood.max",
    "get path.hash.mode",
    "get loop.detect",
    "get txdelay",
    "get direct.txdelay",
    "get rxdelay",
    "get radio.rxgain",
    "get tx",
    "get int.thresh",
    "get agc.reset.interval",
    "get multi.acks",
    "get lat",
    "get lon",
    "gps advert",
    "region home",
    "region list allowed",
    "region list denied",
    "ver",
    "get role",
    "get public.key",
    "clock",
  ];

  const NAME_POWER_EMOJI_VALUES = ["🌞", "⚡", "🔋", "👀"];

  function takeReadReply(byCmd, cmd, failures) {
    const entry = byCmd[cmd];
    if (!entry) {
      return undefined;
    }
    if (!entry.ok) {
      failures.push(cmd + ": " + (entry.reply || "failed"));
      return undefined;
    }
    return stripCliReply(entry.reply);
  }

  function splitNameSuffixAndEmoji(nameBody) {
    let body = String(nameBody || "");
    let emoji = "";
    for (let i = 0; i < NAME_POWER_EMOJI_VALUES.length; i++) {
      const mark = NAME_POWER_EMOJI_VALUES[i];
      if (body.endsWith(mark)) {
        emoji = mark;
        body = body.slice(0, -mark.length);
        break;
      }
    }
    return { body: body, emoji: emoji };
  }

  function openSettingsTier(tierId) {
    const el = document.getElementById(tierId);
    if (el instanceof HTMLDetailsElement) {
      el.open = true;
    }
  }

  function expandSettingsTiersAfterRead(flags) {
    // Expert fields were merged into the Advanced group; open it for either.
    if (flags && (flags.advanced || flags.expert)) {
      openSettingsTier("settings-tier-advanced");
    }
  }

  function scrollConfiguratorSection(sectionId) {
    const el = document.getElementById(sectionId);
    if (el && el.scrollIntoView) {
      el.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }
  }

  function getRepeaterSerial() {
    return typeof window !== "undefined" ? window.RepeaterSerial : null;
  }

  function appendSerialLog(text, className) {
    if (!serialApplyLogEl) return;
    const line = document.createElement("div");
    line.className = "serial-apply-log-line" + (className ? " " + className : "");
    line.textContent = text;
    serialApplyLogEl.appendChild(line);
    serialApplyLogEl.scrollTop = serialApplyLogEl.scrollHeight;
  }

  function clearSerialLog() {
    if (serialApplyLogEl) {
      serialApplyLogEl.textContent = "";
    }
  }

  function setSerialStatus(state, label) {
    if (!serialStatusEl) return;
    serialStatusEl.textContent = label;
    serialStatusEl.dataset.state = state;
  }

  function validateCommandLinesForSerial(lines) {
    const rs = getRepeaterSerial();
    const maxLen = rs ? rs.MAX_LINE_LEN : 151;
    const tooLong = lines.filter(function (line) {
      return line.length > maxLen;
    });
    if (tooLong.length) {
      return {
        ok: false,
        message:
          tooLong.length +
          " command(s) exceed " +
          maxLen +
          " characters (room server limit). Shorten region names or split manually.",
        lines: tooLong,
      };
    }
    return { ok: true };
  }

  function syncSerialUsbToggleButton(connected, busy, supported) {
    if (!serialUsbBtn) return;
    const labelEl = serialUsbBtn.querySelector(".serial-usb-btn-label");
    const connectIcon = serialUsbBtn.querySelector(".serial-btn-icon--connect");
    const disconnectIcon = serialUsbBtn.querySelector(
      ".serial-btn-icon--disconnect",
    );
    if (connected) {
      serialUsbBtn.dataset.action = "disconnect";
      serialUsbBtn.classList.add("serial-btn-secondary");
      serialUsbBtn.classList.remove("serial-usb-toggle--connect");
      serialUsbBtn.classList.add("serial-usb-toggle--disconnect");
      serialUsbBtn.title = "Disconnect the USB serial session";
      serialUsbBtn.setAttribute("aria-label", "Disconnect USB");
      if (labelEl) labelEl.textContent = "Disconnect";
      if (connectIcon) connectIcon.hidden = true;
      if (disconnectIcon) disconnectIcon.hidden = false;
    } else {
      serialUsbBtn.dataset.action = "connect";
      serialUsbBtn.classList.remove("serial-btn-secondary");
      serialUsbBtn.classList.add("serial-usb-toggle--connect");
      serialUsbBtn.classList.remove("serial-usb-toggle--disconnect");
      serialUsbBtn.title =
        "Chrome or Edge on HTTPS or localhost; 115200 baud";
      serialUsbBtn.setAttribute("aria-label", "Connect USB");
      if (labelEl) labelEl.textContent = "Connect USB";
      if (connectIcon) connectIcon.hidden = false;
      if (disconnectIcon) disconnectIcon.hidden = true;
    }
    serialUsbBtn.disabled = !supported || busy;
  }

  function onSerialUsbToggleClick() {
    if (!serialUsbBtn || serialUsbBtn.disabled) return;
    if (serialUsbBtn.dataset.action === "disconnect") {
      disconnectSerialUsb();
    } else {
      connectSerialUsb();
    }
  }

  function updateUsbApplyUi(anchor) {
    const rs = getRepeaterSerial();
    const supported = rs && rs.isSupported();
    const busy = isSerialBusy();
    const connected = Boolean(rs && rs.isConnected());
    const consoleEnabled = supported && connected && !busy;
    if (serialUnsupportedEl) {
      serialUnsupportedEl.hidden = supported;
    }
    syncSerialUsbToggleButton(connected, busy, supported);
    if (serialReadBtn) {
      serialReadBtn.disabled = !supported || busy || !connected;
    }
    const advertEnabled = supported && !busy && rs && rs.isConnected();
    if (serialAdvertZerohopBtn) {
      serialAdvertZerohopBtn.disabled = !advertEnabled;
    }
    if (serialAdvertFloodBtn) {
      serialAdvertFloodBtn.disabled = !advertEnabled;
    }
    if (serialConsoleInput) {
      serialConsoleInput.disabled = !consoleEnabled;
    }
    if (serialConsoleSendBtn) {
      serialConsoleSendBtn.disabled = !consoleEnabled;
    }
    if (serialConsoleClearBtn) {
      serialConsoleClearBtn.disabled = !connected;
    }
    // Device-tools maintenance actions require an active connection.
    const deviceActionEnabled = supported && connected && !busy;
    [
      deviceSyncClockBtn,
      deviceRebootBtn,
      deviceOtaBtn,
      deviceFactoryResetBtn,
    ].forEach(function (btn) {
      if (btn) btn.disabled = !deviceActionEnabled;
    });
    if (serialApplyBtn) {
      const applyLines = buildConfiguratorCommandLines(anchor, {
        enforceFirmwareDefaults: true,
      });
      const hasCommands = applyLines.length > 0;
      const needsLocation = !anchor;
      const needsCoords = coordsRequiredForApply();
      serialApplyBtn.disabled =
        !supported ||
        busy ||
        !(rs && rs.isConnected()) ||
        !hasCommands ||
        needsLocation ||
        needsCoords;
      if (needsCoords && rs && rs.isConnected()) {
        serialApplyBtn.title =
          "Set latitude and longitude — advert location uses stored prefs.";
      } else if (needsLocation && rs && rs.isConnected()) {
        serialApplyBtn.title = "Choose a location for region scopes.";
      } else {
        serialApplyBtn.title = "";
      }
    }
    // Mirror the primary Apply button's state onto the preview-area duplicate.
    if (serialApplyBtn2) {
      if (serialApplyBtn) {
        serialApplyBtn2.disabled = serialApplyBtn.disabled;
        serialApplyBtn2.title = serialApplyBtn.title;
      } else {
        serialApplyBtn2.disabled = true;
      }
    }
    if (serialReading) {
      setSerialStatus("applying", "Reading…");
    } else if (rs && rs.isConnected() && !serialApplying) {
      setSerialStatus("connected", "Connected");
    } else if (serialApplying) {
      setSerialStatus("applying", "Applying…");
    } else if (supported) {
      setSerialStatus("disconnected", "Disconnected");
    }
  }

  async function connectSerialUsb() {
    const rs = getRepeaterSerial();
    if (!rs || !rs.isSupported()) return;
    try {
      clearSerialLog();
      appendSerialLog("Requesting USB port…");
      await rs.connect({ baudRate: rs.DEFAULT_BAUD });
      appendSerialLog("Connected at " + rs.DEFAULT_BAUD + " baud.");
      const probe = await rs.sendLine("ver");
      if (probe.reply) {
        appendSerialLog("Device: " + probe.reply);
      }
      updateUsbApplyUi(getAnchor());
      if (serialConsoleInput) {
        serialConsoleInput.focus({ preventScroll: true });
      }
      promptReadFromRepeater({ afterConnect: true });
    } catch (err) {
      appendSerialLog(
        "Connect failed: " + (err && err.message ? err.message : String(err)),
        "is-error",
      );
      setSerialStatus("disconnected", "Disconnected");
      updateUsbApplyUi(getAnchor());
    }
  }

  async function disconnectSerialUsb() {
    const rs = getRepeaterSerial();
    if (!rs) return;
    if (serialApplyAbort) {
      serialApplyAbort.abort();
      serialApplyAbort = null;
    }
    try {
      await rs.disconnect();
      appendSerialLog("Disconnected.");
    } catch (err) {
      appendSerialLog(
        "Disconnect error: " + (err && err.message ? err.message : String(err)),
        "is-error",
      );
    }
    serialApplying = false;
    serialReading = false;
    serialConsoleSending = false;
    setSerialStatus("disconnected", "Disconnected");
    updateUsbApplyUi(getAnchor());
  }

  function logSerialCommandReply(line, result, err) {
    appendSerialLog("> " + line);
    if (err) {
      appendSerialLog(
        "  -> " + (err && err.message ? err.message : String(err)),
        "is-error",
      );
      return;
    }
    if (result && result.reply) {
      appendSerialLog(
        "  -> " + result.reply,
        result.ok ? "is-ok" : "is-error",
      );
    } else if (result && !result.ok) {
      appendSerialLog("  -> (no reply)", "is-error");
    } else if (result) {
      appendSerialLog("  -> (ok)", "is-ok");
    }
  }

  function pushSerialConsoleHistory(cmd) {
    if (!cmd) return;
    const last = serialConsoleHistory[serialConsoleHistory.length - 1];
    if (last === cmd) return;
    serialConsoleHistory.push(cmd);
    if (serialConsoleHistory.length > SERIAL_CONSOLE_HISTORY_MAX) {
      serialConsoleHistory.shift();
    }
    serialConsoleHistoryBrowse = -1;
  }

  async function sendSerialConsoleCommand(line) {
    const rs = getRepeaterSerial();
    const cmd = String(line || "").trim();
    if (!rs || !rs.isConnected() || isSerialBusy() || !cmd) {
      return;
    }

    const maxLen = rs.MAX_LINE_LEN || 151;
    if (cmd.length > maxLen) {
      appendSerialLog(
        "Command too long (" + cmd.length + " > " + maxLen + ").",
        "is-error",
      );
      return;
    }

    serialConsoleSending = true;
    updateUsbApplyUi(getAnchor());

    try {
      const result = await rs.sendLine(cmd);
      logSerialCommandReply(cmd, result);
      pushSerialConsoleHistory(cmd);
    } catch (err) {
      logSerialCommandReply(cmd, null, err);
    } finally {
      serialConsoleSending = false;
      updateUsbApplyUi(getAnchor());
      if (serialConsoleInput) {
        serialConsoleInput.focus({ preventScroll: true });
      }
    }
  }

  function onSerialConsoleSubmit(ev) {
    if (ev && ev.preventDefault) {
      ev.preventDefault();
    }
    const value = serialConsoleInput ? serialConsoleInput.value : "";
    if (serialConsoleInput) {
      serialConsoleInput.value = "";
    }
    sendSerialConsoleCommand(value);
  }

  function onSerialConsoleKeydown(ev) {
    if (!serialConsoleInput || !serialConsoleHistory.length) {
      return;
    }
    if (ev.key === "ArrowUp") {
      ev.preventDefault();
      if (serialConsoleHistoryBrowse < 0) {
        serialConsoleHistoryBrowse = serialConsoleHistory.length - 1;
      } else if (serialConsoleHistoryBrowse > 0) {
        serialConsoleHistoryBrowse--;
      }
      serialConsoleInput.value =
        serialConsoleHistory[serialConsoleHistoryBrowse] || "";
    } else if (ev.key === "ArrowDown") {
      ev.preventDefault();
      if (serialConsoleHistoryBrowse < 0) {
        return;
      }
      if (serialConsoleHistoryBrowse >= serialConsoleHistory.length - 1) {
        serialConsoleHistoryBrowse = -1;
        serialConsoleInput.value = "";
      } else {
        serialConsoleHistoryBrowse++;
        serialConsoleInput.value =
          serialConsoleHistory[serialConsoleHistoryBrowse] || "";
      }
    }
  }

  async function sendRepeaterAdvert(kind) {
    const rs = getRepeaterSerial();
    if (!rs || !rs.isConnected() || isSerialBusy()) {
      return;
    }

    const cmd = kind === "zerohop" ? "advert.zerohop" : "advert";

    serialConsoleSending = true;
    updateUsbApplyUi(getAnchor());
    try {
      const result = await rs.sendLine(cmd);
      logSerialCommandReply(cmd, result);
      pushSerialConsoleHistory(cmd);
    } catch (err) {
      logSerialCommandReply(cmd, null, err);
    } finally {
      serialConsoleSending = false;
      updateUsbApplyUi(getAnchor());
    }
  }

  function stripCliReply(reply) {
    return String(reply || "")
      .replace(/^\s*>\s*/, "")
      .trim();
  }

  function indexResultsByCommand(results) {
    const map = Object.create(null);
    (results || []).forEach(function (entry) {
      if (entry && entry.line) {
        map[entry.line] = entry;
      }
    });
    return map;
  }

  function parseRegionNameList(reply) {
    const s = stripCliReply(reply);
    if (!s || s === "-none-") return [];
    return s
      .split(",")
      .map(function (part) {
        return part.trim();
      })
      .filter(Boolean);
  }

  function parseRegionHomeName(reply) {
    const s = stripCliReply(reply);
    const m = s.match(/^home is\s+(.+)$/i);
    if (!m) return "";
    return m[1].trim();
  }

  function snapDutycycleSelect(value) {
    const options = [1, 10, 50, 100];
    const v = parseFloat(String(value).replace(/%$/, ""));
    if (!Number.isFinite(v)) return null;
    let best = options[0];
    let bestDiff = Math.abs(v - best);
    for (let i = 1; i < options.length; i++) {
      const d = Math.abs(v - options[i]);
      if (d < bestDiff) {
        best = options[i];
        bestDiff = d;
      }
    }
    return String(best);
  }

  function setSelectIfPresent(el, value) {
    if (!el || value == null || value === "") return false;
    const v = String(value);
    for (let i = 0; i < el.options.length; i++) {
      if (el.options[i].value === v) {
        el.value = v;
        return true;
      }
    }
    return false;
  }

  function applyReadRadioToForm(reply) {
    const raw = stripCliReply(reply);
    const parts = raw.split(",");
    if (parts.length < 4) return false;
    const params = {
      freq: parseFloat(parts[0]),
      bw: parseFloat(parts[1]),
      sf: parseInt(parts[2], 10),
      cr: parseInt(parts[3], 10),
    };
    if (
      !Number.isFinite(params.freq) ||
      !Number.isFinite(params.bw) ||
      !Number.isFinite(params.sf) ||
      !Number.isFinite(params.cr)
    ) {
      return false;
    }
    if (!settingRadioPresetEl) return false;
    let matched = -1;
    for (let i = 0; i < FREQUENCY_PRESETS.length; i++) {
      if (radioParamsMatch(params, FREQUENCY_PRESETS[i])) {
        matched = i;
        break;
      }
    }
    if (matched >= 0) {
      settingRadioPresetEl.value = String(matched);
      settingRadioPresetEl.dataset.lastPreset = String(matched);
    } else {
      settingRadioPresetEl.value = "custom";
      fillCustomRadioFields(params);
    }
    refreshRadioSettingsUi();
    return true;
  }

  function applyReadNameToForm(deviceName, anchor) {
    const name = String(deviceName || "").trim();
    if (!name || !nameSuffixEl) {
      return { applied: false };
    }

    let remainder = name;
    let prefixMismatch = false;
    const prefix = anchor ? getEffectivePrefix(anchor) : "";

    if (anchor && prefix) {
      const nameU = name.toUpperCase();
      const prefixU = prefix.toUpperCase();
      if (nameU.indexOf(prefixU) === 0) {
        remainder = name.slice(prefix.length);
      } else {
        prefixMismatch = true;
        remainder = name;
      }
    }

    const split = splitNameSuffixAndEmoji(remainder);
    nameSuffixEl.value = split.body;
    if (namePowerEmojiEl) {
      if (split.emoji) {
        setSelectIfPresent(namePowerEmojiEl, split.emoji);
      } else {
        namePowerEmojiEl.value = "";
      }
    }

    return { applied: true, prefixMismatch: prefixMismatch };
  }

  /**
   * Detect #BEmesh location from a repeater name prefix (BE- / BE-XXX-).
   * City UN/LOCODE segment preferred over province when both could match (e.g. BRU).
   */
  function detectLocationFromDeviceName(deviceName) {
    const name = String(deviceName || "").trim();
    if (!name) return null;
    const nameU = name.toUpperCase();
    if (nameU.indexOf("BE-") !== 0) return null;
    if (!CITIES || !CITIES.length) return null;

    for (let i = 0; i < CITIES.length; i++) {
      const city = CITIES[i];
      const prefix = buildNamePrefix(
        {
          mode: "city",
          province_code: city.province_code,
          row: city,
        },
        "city",
      );
      if (!prefix) continue;
      if (nameU.indexOf(prefix.toUpperCase()) === 0) {
        return {
          choice: {
            type: "city",
            city: city,
            label: city.plaats,
          },
          mode: "city",
          prefix: prefix,
          locationLabel: city.plaats + " (" + city.city_code + ")",
          source: "name",
        };
      }
    }

    const provinceCodes = Object.keys(PROVINCE_NAMES);
    for (let i = 0; i < provinceCodes.length; i++) {
      const pc = provinceCodes[i];
      const prefix = buildNamePrefix(
        { mode: "province", province_code: pc, row: null },
        "province",
      );
      if (!prefix) continue;
      if (nameU.indexOf(prefix.toUpperCase()) === 0) {
        return {
          choice: {
            type: "province",
            code: pc,
            label: PROVINCE_NAMES[pc] || pc,
          },
          mode: "province",
          prefix: prefix,
          locationLabel: (PROVINCE_NAMES[pc] || pc) + " (" + pc + ")",
          source: "name",
        };
      }
    }

    if (/^BE-[A-Z0-9]{2,5}-/i.test(name)) {
      return null;
    }

    const countryPrefix = buildNamePrefix(
      { mode: "country", province_code: null, row: null },
      "country",
    );
    if (countryPrefix && nameU.indexOf(countryPrefix.toUpperCase()) === 0) {
      return {
        choice: { type: "country", label: "België (be)" },
        mode: "country",
        prefix: countryPrefix,
        locationLabel: "België (be)",
        source: "name",
      };
    }
    return null;
  }

  /** Fallback: pick location from region home / allow list when name has no BE- prefix. */
  function detectLocationFromRegionHints(homeRegion, allowed) {
    const ordered = [];
    function pushCode(code) {
      const c = String(code || "").trim();
      if (!c || c === "*" || ordered.indexOf(c) >= 0) return;
      ordered.push(c);
    }
    pushCode(homeRegion);
    (allowed || []).forEach(pushCode);
    if (!ordered.length) return null;

    for (let i = 0; i < ordered.length; i++) {
      const city = findCityByCode(ordered[i]);
      if (city) {
        return {
          choice: {
            type: "city",
            city: city,
            label: city.plaats,
          },
          mode: "city",
          prefix: buildNamePrefix(
            {
              mode: "city",
              province_code: city.province_code,
              row: city,
            },
            "city",
          ),
          locationLabel: city.plaats + " (" + city.city_code + ")",
          source: "regions",
        };
      }
    }

    for (let i = 0; i < ordered.length; i++) {
      const pc = ordered[i];
      if (!Object.prototype.hasOwnProperty.call(PROVINCE_NAMES, pc)) continue;
      return {
        choice: {
          type: "province",
          code: pc,
          label: PROVINCE_NAMES[pc] || pc,
        },
        mode: "province",
        prefix: buildNamePrefix(
          { mode: "province", province_code: pc, row: null },
          "province",
        ),
        locationLabel: (PROVINCE_NAMES[pc] || pc) + " (" + pc + ")",
        source: "regions",
      };
    }

    if (ordered.indexOf("be") >= 0) {
      return {
        choice: { type: "country", label: "België (be)" },
        mode: "country",
        prefix: buildNamePrefix(
          { mode: "country", province_code: null, row: null },
          "country",
        ),
        locationLabel: "België (be)",
        source: "regions",
      };
    }
    return null;
  }

  function locationDetectionMatchesAnchor(detection, anchor) {
    if (!detection || !anchor) return false;
    if (detection.choice.type === "city" && anchor.mode === "city" && anchor.row) {
      return anchor.row.city_code === detection.choice.city.city_code;
    }
    if (detection.choice.type === "province" && anchor.mode === "province") {
      return anchor.province_code === detection.choice.code;
    }
    if (detection.choice.type === "country" && anchor.mode === "country") {
      return true;
    }
    return false;
  }

  function applyDetectedLocationFromDevice(detection) {
    if (!detection || !detection.choice) return getAnchor();
    if (!locationDetectionMatchesAnchor(detection, getAnchor())) {
      commitLocationChoice(detection.choice, "keep");
    }
    if (detection.mode) {
      refreshLocationModeOptions(getAnchor());
      setCurrentLocationMode(detection.mode);
      syncPrefixField(getAnchor());
    }
    return getAnchor();
  }

  /** Ensure allow/deny rows exist for region codes present on the device but not in the default grids. */
  function ensureDeviceRegionScopeRows(codes) {
    if (!policyGridsContainer || !policyCard) return [];
    const wanted = [];
    const seen = new Set();
    (codes || []).forEach(function (code) {
      const c = String(code || "").trim();
      if (!c || c === "*" || seen.has(c)) return;
      seen.add(c);
      wanted.push(c);
    });
    if (!wanted.length) return [];

    const missing = wanted.filter(function (code) {
      return !policyCard.querySelector(
        'input.policy-allow[data-code="' + code.replace(/"/g, "") + '"]',
      );
    });
    if (!missing.length) return [];

    let scopesCol = policyGridsContainer.querySelector(
      ".policy-grids-col--scopes",
    );
    if (!scopesCol) {
      scopesCol = document.createElement("div");
      scopesCol.className = "policy-grids-col policy-grids-col--scopes";
      const layout = policyGridsContainer.querySelector(".policy-grids-layout");
      if (layout) layout.appendChild(scopesCol);
      else policyGridsContainer.appendChild(scopesCol);
    }

    let subsection = scopesCol.querySelector(
      '.policy-subsection[data-policy-scope="device"]',
    );
    if (!subsection) {
      subsection = document.createElement("div");
      subsection.className = "policy-subsection";
      subsection.setAttribute("data-policy-scope", "device");
      subsection.innerHTML =
        '<div class="policy-subhead"><h3 class="policy-subtitle">Scopes from device</h3></div>' +
        '<p class="policy-subsection-note">Region codes read from the repeater that are outside the usual neighbour lists for this location.</p>' +
        '<div class="policy-table-head" role="row">' +
        '<div class="policy-head-scope" role="columnheader">Scope</div>' +
        '<div class="policy-head-clear-wrap" role="columnheader"></div>' +
        '<div class="policy-head-col" role="columnheader"><span class="policy-head-label">Allow</span></div>' +
        '<div class="policy-head-col" role="columnheader"><span class="policy-head-label">Deny</span></div>' +
        "</div>";
      scopesCol.appendChild(subsection);
    }

    missing.forEach(function (code) {
      if (
        subsection.querySelector(
          'input.policy-allow[data-code="' + code.replace(/"/g, "") + '"]',
        )
      ) {
        return;
      }
      const name = expandedNameForRegionCode(code);
      const label =
        name !== code
          ? escapeHtml(name) + " (" + escapeHtml(code) + ")"
          : escapeHtml(code);
      subsection.insertAdjacentHTML(
        "beforeend",
        policyRow(label, code, { allow: false, deny: false }),
      );
    });

    syncScopeMasters(subsection);
    refreshHomeOverrideSelect();
    return missing;
  }

  function applyReadRegionsToPolicy(allowed, denied, homeRegion, anchor) {
    if (!policyCard || !anchor) {
      return { applied: false, reason: "no-location", missing: [] };
    }
    const allowedSet = new Set(allowed || []);
    const deniedSet = new Set(denied || []);
    const allCodes = [];
    allowedSet.forEach(function (c) {
      allCodes.push(c);
    });
    deniedSet.forEach(function (c) {
      allCodes.push(c);
    });
    if (homeRegion) allCodes.push(homeRegion);

    const missing = ensureDeviceRegionScopeRows(allCodes);

    policyCard.querySelectorAll("input.policy-allow").forEach(function (el) {
      const code = el.getAttribute("data-code");
      if (!code || el.disabled) return;
      el.checked = allowedSet.has(code);
    });
    policyCard.querySelectorAll("input.policy-deny").forEach(function (el) {
      const code = el.getAttribute("data-code");
      if (!code || el.disabled) return;
      el.checked = deniedSet.has(code);
    });

    const untagged = document.getElementById("policy-untagged-flood");
    if (untagged) {
      untagged.checked = allowedSet.has("*");
    }

    finalizePolicyUiChange();
    refreshHomeOverrideSelect();

    const ov = document.getElementById("policy-home-override");
    const sel = document.getElementById("policy-home-override-select");
    if (ov && sel && homeRegion) {
      const defaultHome = deepestAllowedHomeRegionCode(anchor);
      if (homeRegion === defaultHome) {
        ov.checked = false;
        sel.value = "";
      } else if (homeRegion === "*") {
        ov.checked = true;
        sel.value = HOME_OVERRIDE_OMIT;
      } else {
        ov.checked = true;
        let found = false;
        for (let i = 0; i < sel.options.length; i++) {
          if (sel.options[i].value === homeRegion) {
            sel.value = homeRegion;
            found = true;
            break;
          }
        }
        if (!found) {
          appendSerialLog(
            "Home region " +
              homeRegion +
              " is not in the policy list for this location.",
            "is-error",
          );
        }
      }
      sel.disabled = !ov.checked;
    }

    return { applied: true, missing: missing };
  }

  function applyReadResultsToForm(byCmd, anchor) {
    let updated = 0;
    const failures = [];
    const labels = [];
    const tierFlags = { advanced: false, expert: false };
    let scrollTarget = null;
    let namePrefixMismatch = false;
    let workingAnchor = anchor || getAnchor();

    function mark(label, tier) {
      labels.push(label);
      updated++;
      if (tier === "advanced") {
        tierFlags.advanced = true;
      } else if (tier === "expert") {
        tierFlags.expert = true;
      }
    }

    const nameValue = takeReadReply(byCmd, "get name", failures);
    const homeValue = takeReadReply(byCmd, "region home", failures);
    const allowedValue = takeReadReply(byCmd, "region list allowed", failures);
    const deniedValue = takeReadReply(byCmd, "region list denied", failures);
    const homeRegion =
      homeValue !== undefined ? parseRegionHomeName(homeValue) || homeValue : "";
    const allowed =
      allowedValue !== undefined ? parseRegionNameList(allowedValue) : [];
    const denied =
      deniedValue !== undefined ? parseRegionNameList(deniedValue) : [];

    const detection =
      (nameValue !== undefined
        ? detectLocationFromDeviceName(nameValue)
        : null) ||
      (homeValue !== undefined || allowedValue !== undefined
        ? detectLocationFromRegionHints(homeRegion, allowed)
        : null);

    if (detection) {
      workingAnchor = applyDetectedLocationFromDevice(detection);
      mark("Location", "general");
      scrollTarget = scrollTarget || "config-identity-block";
      appendSerialLog(
        "Detected location from " +
          (detection.source === "regions"
            ? "region home / allow list"
            : "name prefix " + (detection.prefix || "")) +
          ": " +
          detection.locationLabel +
          ".",
        "is-ok",
      );
    }

    if (nameValue !== undefined) {
      const nameResult = applyReadNameToForm(nameValue, workingAnchor);
      if (nameResult.applied) {
        mark("Name", "general");
        scrollTarget = scrollTarget || "config-identity-block";
        if (nameResult.prefixMismatch) {
          namePrefixMismatch = true;
        }
      }
    }

    const radioValue = takeReadReply(byCmd, "get radio", failures);
    if (radioValue !== undefined && applyReadRadioToForm(radioValue)) {
      mark("Radio", "general");
      if (isCustomRadioPreset()) {
        tierFlags.expert = true;
      }
      scrollTarget = scrollTarget || "general-card";
    }

    const repeatValue = takeReadReply(byCmd, "get repeat", failures);
    if (repeatValue !== undefined && settingRepeatEl) {
      if (repeatValue === "on" || repeatValue === "off") {
        settingRepeatEl.value = repeatValue;
        mark("Repeat mode", "general");
      }
    }

    const ownerValue = takeReadReply(byCmd, "get owner.info", failures);
    if (ownerValue !== undefined && settingOwnerInfoEl) {
      settingOwnerInfoEl.value = ownerValue.replace(/\|/g, " ");
      mark("Owner info", "general");
    }

    const guestValue = takeReadReply(byCmd, "get guest.password", failures);
    if (guestValue !== undefined && settingGuestPasswordEl) {
      settingGuestPasswordEl.value = guestValue;
      mark("Guest password", "general");
    }

    const dutycycleValue = takeReadReply(byCmd, "get dutycycle", failures);
    if (dutycycleValue !== undefined && settingDutycycleEl) {
      const snapped = snapDutycycleSelect(dutycycleValue);
      if (snapped && setSelectIfPresent(settingDutycycleEl, snapped)) {
        mark("Duty cycle", "general");
      }
    }

    const floodAdvertValue = takeReadReply(
      byCmd,
      "get flood.advert.interval",
      failures,
    );
    if (floodAdvertValue !== undefined && settingFloodAdvertIntervalEl) {
      const hours = parseInt(floodAdvertValue, 10);
      if (Number.isFinite(hours)) {
        settingFloodAdvertIntervalEl.value = String(hours);
        mark("Flood advert interval", "advanced");
      }
    }

    const advertValue = takeReadReply(byCmd, "get advert.interval", failures);
    if (advertValue !== undefined && settingAdvertIntervalEl) {
      const minutes = parseInt(advertValue, 10);
      if (Number.isFinite(minutes)) {
        const formMinutes = minutes > 0 ? minutes / 2 : 0;
        settingAdvertIntervalEl.value =
          formMinutes > 0 ? String(formMinutes) : "0";
        mark("Zero-hop advert interval", "advanced");
      }
    }

    const floodMaxUnscopedValue = takeReadReply(
      byCmd,
      "get flood.max.unscoped",
      failures,
    );
    if (floodMaxUnscopedValue !== undefined && settingFloodMaxUnscopedEl) {
      settingFloodMaxUnscopedEl.value = floodMaxUnscopedValue;
      mark("Flood max unscoped", "advanced");
    }

    const floodMaxAdvertValue = takeReadReply(
      byCmd,
      "get flood.max.advert",
      failures,
    );
    if (floodMaxAdvertValue !== undefined && settingFloodMaxAdvertEl) {
      settingFloodMaxAdvertEl.value = floodMaxAdvertValue;
      mark("Flood max advert", "advanced");
    }

    const floodMaxValue = takeReadReply(byCmd, "get flood.max", failures);
    if (floodMaxValue !== undefined && settingFloodMaxEl) {
      settingFloodMaxEl.value = floodMaxValue;
      mark("Flood max", "advanced");
    }

    const pathHashValue = takeReadReply(byCmd, "get path.hash.mode", failures);
    if (pathHashValue !== undefined && settingPathHashModeEl) {
      if (setSelectIfPresent(settingPathHashModeEl, pathHashValue)) {
        mark("Path hash mode", "advanced");
      }
    }

    const loopDetectValue = takeReadReply(byCmd, "get loop.detect", failures);
    if (loopDetectValue !== undefined && settingLoopDetectEl) {
      if (setSelectIfPresent(settingLoopDetectEl, loopDetectValue)) {
        mark("Loop detection", "advanced");
      }
    }

    const txdelayValue = takeReadReply(byCmd, "get txdelay", failures);
    if (txdelayValue !== undefined && settingTxdelayEl) {
      settingTxdelayEl.value = txdelayValue;
      mark("Tx delay", "expert");
    }

    const directTxdelayValue = takeReadReply(
      byCmd,
      "get direct.txdelay",
      failures,
    );
    if (directTxdelayValue !== undefined && settingDirectTxdelayEl) {
      settingDirectTxdelayEl.value = directTxdelayValue;
      mark("Direct tx delay", "expert");
    }

    const rxdelayValue = takeReadReply(byCmd, "get rxdelay", failures);
    if (rxdelayValue !== undefined && settingRxdelayEl) {
      settingRxdelayEl.value = rxdelayValue;
      mark("Rx delay", "expert");
    }

    const radioRxgainValue = takeReadReply(byCmd, "get radio.rxgain", failures);
    if (radioRxgainValue !== undefined && settingRadioRxgainEl) {
      if (
        (radioRxgainValue === "on" || radioRxgainValue === "off") &&
        setSelectIfPresent(settingRadioRxgainEl, radioRxgainValue)
      ) {
        mark("Radio RX gain", "expert");
      }
    }

    const txPowerValue = takeReadReply(byCmd, "get tx", failures);
    if (txPowerValue !== undefined && settingRadioTxpowerEl) {
      settingRadioTxpowerEl.value = txPowerValue;
      mark("TX power", "expert");
    }

    // Read-only device info (display only; not part of the config form).
    const verValue = takeReadReply(byCmd, "ver", failures);
    if (verValue !== undefined && deviceInfoVersionEl) {
      deviceInfoVersionEl.textContent = verValue || "—";
    }
    const roleValue = takeReadReply(byCmd, "get role", failures);
    if (roleValue !== undefined && deviceInfoRoleEl) {
      deviceInfoRoleEl.textContent = roleValue || "—";
    }
    const pubkeyValue = takeReadReply(byCmd, "get public.key", failures);
    if (pubkeyValue !== undefined && deviceInfoPubkeyEl) {
      deviceInfoPubkeyEl.textContent = pubkeyValue || "—";
    }
    const clockValue = takeReadReply(byCmd, "clock", failures);
    if (clockValue !== undefined && deviceInfoClockEl) {
      deviceInfoClockEl.textContent = clockValue || "—";
    }

    const intThreshValue = takeReadReply(byCmd, "get int.thresh", failures);
    if (intThreshValue !== undefined && settingIntThreshEl) {
      settingIntThreshEl.value = intThreshValue;
      mark("Interference threshold", "expert");
    }

    const agcResetValue = takeReadReply(
      byCmd,
      "get agc.reset.interval",
      failures,
    );
    if (agcResetValue !== undefined && settingAgcResetEl) {
      settingAgcResetEl.value = agcResetValue;
      mark("AGC reset", "expert");
    }

    const multiAcksValue = takeReadReply(byCmd, "get multi.acks", failures);
    if (multiAcksValue !== undefined && settingMultiAcksEl) {
      if (setSelectIfPresent(settingMultiAcksEl, multiAcksValue)) {
        mark("Multi-acks", "expert");
      }
    }

    const api = positionApi();
    const latValue = takeReadReply(byCmd, "get lat", failures);
    const lonValue = takeReadReply(byCmd, "get lon", failures);
    if (latValue !== undefined || lonValue !== undefined) {
      const lat = latValue !== undefined ? parseFloat(latValue) : NaN;
      const lon = lonValue !== undefined ? parseFloat(lonValue) : NaN;
      if (api) {
        if (api.hasValidCoords(lat, lon)) {
          api.setCoords(lat, lon, { source: "device" });
          mark("Coordinates", "general");
          scrollTarget = scrollTarget || "config-identity-block";
        } else if (latValue !== undefined && lonValue !== undefined) {
          api.setCoords(null, null, { source: null });
        }
      }
    }

    const advertLocValue = takeReadReply(byCmd, "gps advert", failures);
    if (advertLocValue !== undefined && settingAdvertLocEl) {
      const policy = parseGpsAdvertReply(advertLocValue);
      if (policy && setSelectIfPresent(settingAdvertLocEl, policy)) {
        mark("Advert location", "general");
        scrollTarget = scrollTarget || "config-identity-block";
      }
    }

    if (
      homeValue !== undefined ||
      allowedValue !== undefined ||
      deniedValue !== undefined
    ) {
      if (allowed.length) {
        appendSerialLog("Allowed regions: " + allowed.join(", "), "is-ok");
      } else if (allowedValue !== undefined) {
        appendSerialLog("Allowed regions: (none)", "is-ok");
      }
      if (denied.length) {
        appendSerialLog("Denied regions: " + denied.join(", "), "is-ok");
      } else if (deniedValue !== undefined) {
        appendSerialLog("Denied regions: (none)", "is-ok");
      }
      if (homeValue !== undefined) {
        appendSerialLog(
          "Home region: " + (homeRegion || "(wildcard)"),
          "is-ok",
        );
      }
      workingAnchor = getAnchor() || workingAnchor;
      const regionResult = applyReadRegionsToPolicy(
        allowed,
        denied,
        homeRegion,
        workingAnchor,
      );
      if (regionResult.applied) {
        mark("Region policy", "advanced");
        scrollTarget = scrollTarget || "policy-card";
        if (regionResult.missing && regionResult.missing.length) {
          appendSerialLog(
            "Added device region scope(s) to the form: " +
              regionResult.missing.join(", ") +
              ".",
            "is-ok",
          );
        }
      } else if (regionResult.reason === "no-location") {
        appendSerialLog(
          "Region policy not applied — name has no BE- location prefix and no matching region home/city; pick a location above to map allow/deny checkboxes.",
          "is-error",
        );
      }
    }

    expandSettingsTiersAfterRead(tierFlags);
    refreshConfiguratorOutputs();

    return {
      updated: updated,
      failures: failures,
      labels: labels,
      scrollTarget: scrollTarget,
      namePrefixMismatch: namePrefixMismatch,
      adminPasswordUnreadable: true,
    };
  }
  function closeSerialReadConfirmModal() {
    const modal = document.getElementById("serial-read-confirm-modal");
    if (modal) modal.hidden = true;
    document.body.classList.remove("config-confirm-modal-open");
  }

  function promptReadFromRepeater(options) {
    options = options || {};
    const rs = getRepeaterSerial();
    if (!rs || !rs.isConnected() || isSerialBusy()) return;

    const modal = document.getElementById("serial-read-confirm-modal");
    const hintEl = document.getElementById("serial-read-confirm-hint");
    const anchor = getAnchor();
    let hint =
      "This overwrites the form with values from the connected device. Admin password cannot be read from the device.";
    if (options.afterConnect) {
      hint =
        "USB connected. Read settings from the repeater now and overwrite the form? Admin password cannot be read from the device.";
    }
    if (anchor) {
      hint +=
        " Region allow/deny lists and home will be applied to the policy for your selected location.";
    } else {
      hint +=
        " Choose a location afterward to align region policy with the device.";
    }
    if (hintEl) hintEl.textContent = hint;
    if (!modal) {
      if (window.confirm(hint)) {
        performReadFromRepeater();
      }
      return;
    }
    modal.hidden = false;
    document.body.classList.add("config-confirm-modal-open");
    const confirmBtn = document.getElementById("serial-read-confirm-btn");
    if (confirmBtn) confirmBtn.focus({ preventScroll: true });
  }

  function initSerialReadConfirmModal() {
    const confirmBtn = document.getElementById("serial-read-confirm-btn");
    const modal = document.getElementById("serial-read-confirm-modal");
    if (confirmBtn) {
      confirmBtn.addEventListener("click", function () {
        closeSerialReadConfirmModal();
        performReadFromRepeater();
      });
    }
    if (modal) {
      modal
        .querySelectorAll("[data-serial-read-confirm-dismiss]")
        .forEach(function (el) {
          el.addEventListener("click", closeSerialReadConfirmModal);
        });
    }
    document.addEventListener("keydown", function (e) {
      if (e.key !== "Escape") return;
      const m = document.getElementById("serial-read-confirm-modal");
      if (m && !m.hidden) {
        closeSerialReadConfirmModal();
      }
    });
  }

  async function performReadFromRepeater() {
    const rs = getRepeaterSerial();
    if (!rs || !rs.isConnected() || !rs.queryCommands) return;
    if (isSerialBusy()) return;

    const anchor = getAnchor();

    serialReading = true;
    serialApplyAbort = new AbortController();
    updateUsbApplyUi(anchor);
    clearSerialLog();
    const verboseRead = isSerialShowCommandLog();
    if (verboseRead) {
      appendSerialLog(
        "Reading " + REPEATER_READ_COMMANDS.length + " setting(s)…",
      );
    }

    try {
      const results = await rs.queryCommands(REPEATER_READ_COMMANDS, {
        signal: serialApplyAbort.signal,
        onProgress: function (ev) {
          if (!verboseRead) return;
          if (ev.phase === "sending") {
            appendSerialLog("> " + ev.line);
          } else if (ev.phase === "done") {
            if (ev.reply) {
              appendSerialLog(
                "  -> " + ev.reply,
                ev.ok ? "is-ok" : "is-error",
              );
            } else if (!ev.ok) {
              appendSerialLog("  -> (no reply)", "is-error");
            }
          }
        },
      });
      const summary = applyReadResultsToForm(indexResultsByCommand(results), anchor);
      if (summary.labels.length) {
        appendSerialLog(
          "Updated " +
            summary.labels.length +
            " field group(s): " +
            summary.labels.join(", ") +
            ".",
          "is-ok",
        );
      } else {
        appendSerialLog(
          verboseRead
            ? "Read finished but no form fields were updated — check replies above."
            : "Read finished but no form fields were updated — enable Show command log for details.",
          "is-error",
        );
      }
      appendSerialLog(
        "Admin password was not read (not exposed by device firmware).",
        "is-muted",
      );
      if (summary.namePrefixMismatch) {
        appendSerialLog(
          "Device name does not match the location prefix — adjust the suffix, change location mode, or pick a matching location.",
          "is-error",
        );
      }
      if (summary.failures.length) {
        appendSerialLog(
          summary.failures.length +
            " command(s) failed or are unsupported on this firmware.",
          "is-error",
        );
      }
      if (summary.scrollTarget) {
        scrollConfiguratorSection(summary.scrollTarget);
      }
    } catch (err) {
      if (err && err.name === "AbortError") {
        appendSerialLog("Read cancelled.", "is-error");
      } else {
        appendSerialLog(
          "Read failed: " + (err && err.message ? err.message : String(err)),
          "is-error",
        );
      }
    } finally {
      serialReading = false;
      serialApplyAbort = null;
      updateUsbApplyUi(getAnchor());
    }
  }

  function readFromRepeater() {
    promptReadFromRepeater({ afterConnect: false });
  }

  async function offerRepeaterReboot(rs, appliedLines) {
    if (!rs || !rs.isConnected()) return;

    const needsRebootHint =
      appliedLines &&
      appliedLines.some(function (line) {
        return (
          /^set radio /.test(line) ||
          /^set freq /.test(line) ||
          /^set radio\.rxgain /.test(line)
        );
      });
    const msg = needsRebootHint
      ? "Configuration applied.\n\nReboot the repeater now? Radio or frequency changes need a reboot to take effect."
      : "Configuration applied.\n\nReboot the repeater now?";

    if (!window.confirm(msg)) {
      return;
    }

    appendSerialLog("> reboot");
    try {
      const result = await rs.sendLine("reboot", { timeoutMs: 3000 });
      if (result.reply) {
        appendSerialLog(
          "  -> " + result.reply,
          result.ok ? "is-ok" : "is-error",
        );
      } else {
        appendSerialLog("Reboot sent (device may disconnect).", "is-ok");
      }
    } catch (err) {
      appendSerialLog(
        "Reboot failed: " + (err && err.message ? err.message : String(err)),
        "is-error",
      );
    }
  }

  async function applyToRepeater() {
    const rs = getRepeaterSerial();
    if (!rs || !rs.isConnected()) return;

    const anchor = getAnchor();
    if (!anchor) {
      window.alert("Choose a location first — region scopes are required.");
      return;
    }
    if (!namePreviewState.isValid || !namePreviewState.name) {
      window.alert("Set a valid repeater name before applying.");
      return;
    }
    if (coordsRequiredForApply()) {
      window.alert(
        "Set latitude and longitude — advert location is set to prefs (stored coordinates).",
      );
      return;
    }

    const lines = buildConfiguratorCommandLines(anchor, {
      enforceFirmwareDefaults: true,
    });
    if (!lines.length) {
      window.alert("No commands to apply.");
      return;
    }

    const validation = validateCommandLinesForSerial(lines);
    if (!validation.ok) {
      window.alert(validation.message);
      return;
    }

    const previewLines = buildConfiguratorCommandLines(anchor, {
      enforceFirmwareDefaults: false,
    });
    const extraCount = Math.max(0, lines.length - previewLines.length);
    const msg =
      "Apply " +
      lines.length +
      " command(s) to the connected repeater?\n\n" +
      "This overwrites repeater settings. USB apply always includes MeshCore " +
      "firmware defaults" +
      (extraCount > 0
        ? " (" + extraCount + " more than the CLI preview)."
        : ".") +
      "\n\nContinue?";
    if (!window.confirm(msg)) {
      return;
    }

    serialApplying = true;
    serialApplyAbort = new AbortController();
    updateUsbApplyUi(anchor);
    clearSerialLog();
    appendSerialLog("Applying " + lines.length + " command(s)…");

    let applySucceeded = false;
    try {
      await rs.applyCommands(lines, {
        signal: serialApplyAbort.signal,
        onProgress: function (ev) {
          if (ev.phase === "sending") {
            appendSerialLog("> " + ev.line);
          } else if (ev.phase === "done") {
            if (ev.reply) {
              appendSerialLog("  -> " + ev.reply, ev.ok ? "is-ok" : "is-error");
            }
          }
        },
      });
      applySucceeded = true;
      appendSerialLog("Apply complete.", "is-ok");
    } catch (err) {
      if (err && err.name === "AbortError") {
        appendSerialLog("Apply cancelled.", "is-error");
      } else {
        const detail =
          err && err.line
            ? 'Failed on "' + err.line + '": '
            : "Apply failed: ";
        appendSerialLog(
          detail + (err && err.message ? err.message : String(err)),
          "is-error",
        );
      }
    } finally {
      serialApplying = false;
      serialApplyAbort = null;
      updateUsbApplyUi(getAnchor());
    }

    if (applySucceeded) {
      await offerRepeaterReboot(rs, lines);
    }
  }

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
    floodMax: 64,
    pathHashMode: "0",
    dutycycle: "50",
    loopDetect: "off",
    rxdelay: 0,
    radioRxgain: "on",
    intThresh: 0,
    agcResetInterval: 0,
    multiAcks: "0",
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
  const FLOOD_MAX_FORM_DEFAULT = 64;
  const LOOP_DETECT_FORM_DEFAULT = "minimal";
  const PATH_HASH_MODE_FORM_DEFAULT = "1";
  const DUTYCYCLE_FORM_DEFAULT = "10";

  /** #BEmesh recommended settings applied via the confirmation dialog. */
  const RECOMMENDED_SETTINGS = {
    radioPresetName: "EU/UK (Narrow)",
    dutycycle: "10",
    floodAdvertHours: 47,
    advertIntervalMinutes: 0,
    floodMax: 64,
    floodMaxUnscoped: 3,
    floodMaxAdvert: 5,
    pathHashMode: "1",
    loopDetect: "minimal",
  };

  function openRecommendedSettingsModal() {
    const modal = document.getElementById("recommended-settings-modal");
    if (!modal) return;
    modal.hidden = false;
    document.body.classList.add("config-confirm-modal-open");
    const confirmBtn = document.getElementById(
      "recommended-settings-confirm-btn",
    );
    if (confirmBtn) confirmBtn.focus({ preventScroll: true });
  }

  function closeRecommendedSettingsModal() {
    const modal = document.getElementById("recommended-settings-modal");
    if (!modal) return;
    modal.hidden = true;
    document.body.classList.remove("config-confirm-modal-open");
  }

  function applyRecommendedSettings() {
    const rec = RECOMMENDED_SETTINGS;
    const presetIndex = FREQUENCY_PRESETS.findIndex(function (p) {
      return p.name === rec.radioPresetName;
    });
    if (settingRadioPresetEl && presetIndex >= 0) {
      settingRadioPresetEl.value = String(presetIndex);
      settingRadioPresetEl.dataset.lastPreset = String(presetIndex);
    }
    if (settingDutycycleEl) {
      settingDutycycleEl.value = rec.dutycycle;
    }
    if (settingFloodAdvertIntervalEl) {
      settingFloodAdvertIntervalEl.value = String(rec.floodAdvertHours);
    }
    if (settingAdvertIntervalEl) {
      settingAdvertIntervalEl.value = String(rec.advertIntervalMinutes);
    }
    if (settingFloodMaxEl) {
      settingFloodMaxEl.value = String(rec.floodMax);
    }
    if (settingFloodMaxUnscopedEl) {
      settingFloodMaxUnscopedEl.value = String(rec.floodMaxUnscoped);
    }
    if (settingFloodMaxAdvertEl) {
      settingFloodMaxAdvertEl.value = String(rec.floodMaxAdvert);
    }
    if (settingPathHashModeEl) {
      settingPathHashModeEl.value = rec.pathHashMode;
    }
    if (settingLoopDetectEl) {
      settingLoopDetectEl.value = rec.loopDetect;
    }
    openSettingsTier("settings-tier-general");
    openSettingsTier("settings-tier-advanced");
    refreshRadioSettingsUi();
    refreshConfiguratorOutputs();
    closeRecommendedSettingsModal();
    scrollConfiguratorSection("settings-tier-general");
  }

  function initRecommendedSettingsUi() {
    const openBtn = document.getElementById("recommended-settings-btn");
    const confirmBtn = document.getElementById(
      "recommended-settings-confirm-btn",
    );
    const modal = document.getElementById("recommended-settings-modal");
    if (openBtn) {
      openBtn.addEventListener("click", openRecommendedSettingsModal);
    }
    if (confirmBtn) {
      confirmBtn.addEventListener("click", applyRecommendedSettings);
    }
    if (modal) {
      modal
        .querySelectorAll("[data-recommended-settings-dismiss]")
        .forEach(function (el) {
          el.addEventListener("click", closeRecommendedSettingsModal);
        });
    }
    document.addEventListener("keydown", function (e) {
      if (e.key !== "Escape") return;
      const m = document.getElementById("recommended-settings-modal");
      if (m && !m.hidden) {
        closeRecommendedSettingsModal();
      }
    });
  }

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
      opt.title =
        "LoRa " +
        p.freq +
        " MHz, SF" +
        p.sf +
        ", BW " +
        p.bw +
        " kHz, CR" +
        p.cr +
        " — applied via set radio (reboot required)";
      settingRadioPresetEl.appendChild(opt);
    }
    const customOpt = document.createElement("option");
    customOpt.value = "custom";
    customOpt.textContent = "Custom";
    customOpt.title =
      "Enter frequency, SF, BW, CR, and TX power yourself (set radio / set tx)";
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

  function parseRxdelayBase(el, fallback) {
    if (!el) return fallback;
    const raw = String(el.value || "").trim();
    if (!raw) return fallback;
    const v = parseFloat(raw);
    if (!Number.isFinite(v)) return fallback;
    return Math.min(20, Math.max(0, roundToMaxDecimals(v, 1)));
  }

  function parseAgcResetSeconds(el, fallback) {
    if (!el) return fallback;
    const raw = String(el.value || "").trim();
    if (!raw) return fallback;
    const v = parseInt(raw, 10);
    if (!Number.isFinite(v) || v <= 0) return 0;
    const clamped = Math.min(255, Math.max(4, v));
    return clamped - (clamped % 4);
  }

  function parseIntThresh(el, fallback) {
    if (!el) return fallback;
    const raw = String(el.value || "").trim();
    if (!raw) return fallback;
    const v = parseInt(raw, 10);
    if (!Number.isFinite(v)) return fallback;
    return Math.min(255, Math.max(0, v));
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

    const dutycycle = settingDutycycleEl
      ? settingDutycycleEl.value
      : DUTYCYCLE_FORM_DEFAULT;
    if (showDefaults || dutycycle !== fw.dutycycle) {
      lines.push("set dutycycle " + dutycycle);
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

    const floodMax = parseFloodMaxHops(
      settingFloodMaxEl,
      FLOOD_MAX_FORM_DEFAULT,
    );
    if (showDefaults || floodMax !== fw.floodMax) {
      lines.push("set flood.max " + floodMax);
    }

    const pathMode = settingPathHashModeEl
      ? settingPathHashModeEl.value
      : PATH_HASH_MODE_FORM_DEFAULT;
    if (showDefaults || pathMode !== fw.pathHashMode) {
      lines.push("set path.hash.mode " + pathMode);
    }

    const loopDetect = settingLoopDetectEl
      ? settingLoopDetectEl.value
      : LOOP_DETECT_FORM_DEFAULT;
    if (showDefaults || loopDetect !== fw.loopDetect) {
      lines.push("set loop.detect " + loopDetect);
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

    const rxdelay = parseRxdelayBase(settingRxdelayEl, fw.rxdelay);
    if (showDefaults || !delayFactorsEqual(rxdelay, fw.rxdelay)) {
      lines.push("set rxdelay " + formatDecimalMaxPlaces(rxdelay, 1));
    }

    const radioRxgain = settingRadioRxgainEl
      ? settingRadioRxgainEl.value
      : fw.radioRxgain;
    if (showDefaults || radioRxgain !== fw.radioRxgain) {
      lines.push("set radio.rxgain " + radioRxgain);
    }

    // TX power (dBm): CLI `set tx <n>`. Emit when the user entered a value.
    const txPowerRaw = settingRadioTxpowerEl
      ? String(settingRadioTxpowerEl.value).trim()
      : "";
    if (txPowerRaw !== "") {
      const txPowerNum = parseInt(txPowerRaw, 10);
      if (Number.isFinite(txPowerNum)) {
        lines.push("set tx " + txPowerNum);
      }
    }

    const intThresh = parseIntThresh(settingIntThreshEl, fw.intThresh);
    if (showDefaults || intThresh !== fw.intThresh) {
      lines.push("set int.thresh " + intThresh);
    }

    const agcReset = parseAgcResetSeconds(
      settingAgcResetEl,
      fw.agcResetInterval,
    );
    if (showDefaults || agcReset !== fw.agcResetInterval) {
      lines.push("set agc.reset.interval " + agcReset);
    }

    const multiAcks = settingMultiAcksEl
      ? settingMultiAcksEl.value
      : fw.multiAcks;
    if (showDefaults || multiAcks !== fw.multiAcks) {
      lines.push("set multi.acks " + multiAcks);
    }

    const coords = getFormCoords();
    if (coords.valid) {
      lines.push("set lat " + coords.lat);
      lines.push("set lon " + coords.lon);
    }

    const advertLoc = getAdvertLocPolicy();
    if (showDefaults) {
      if (advertLoc === "none") lines.push("gps advert none");
      else if (advertLoc === "share") lines.push("gps advert share");
      else lines.push("gps advert prefs");
    } else if (advertLoc === "none") {
      lines.push("gps advert none");
    } else if (advertLoc === "share") {
      lines.push("gps advert share");
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
      advertIncludesLocation() &&
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
        const byteLimit = advertIncludesLocation()
          ? NAME_ADVERT_MAX_UTF8
          : NAME_FIRMWARE_MAX_UTF8;
        metaText = state.totalBytes + " / " + byteLimit + " bytes";
      }
      namePreviewMetaEl.textContent = metaText;
      namePreviewMetaEl.classList.toggle("is-error", isError);
      namePreviewMetaEl.classList.toggle("is-warning", isWarning);
    }
    if (namePreviewNoteEl) {
      const showNote =
        advertIncludesLocation() &&
        state.hasSuffix &&
        state.totalBytes > NAME_ADVERT_MAX_UTF8;
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
      '<span class="policy-row-label" title="Region transport code ' +
      esc +
      ' — Allow/Deny maps to region allowf / denyf">' +
      labelHtml +
      '</span><div class="policy-row-clear-slot" aria-hidden="true"></div><div class="policy-cell policy-cell--allow"><input type="checkbox" class="policy-allow" data-code="' +
      esc +
      '" id="' +
      idBase +
      '_a"' +
      allowChk +
      ' aria-label="Allow flood for ' +
      esc +
      '" title="Allow flood for ' +
      esc +
      ' (CLI: region allowf ' +
      esc +
      ')"></div><div class="policy-cell policy-cell--deny"><input type="checkbox" class="policy-deny" data-code="' +
      esc +
      '" id="' +
      idBase +
      '_d"' +
      denyChk +
      ' aria-label="Deny flood for ' +
      esc +
      '" title="Deny flood for ' +
      esc +
      ' (CLI: region denyf ' +
      esc +
      ')"></div></div>'
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
    const columnHtml = { home: "", scopes: "" };
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
      const column = opts.column === "home" ? "home" : "scopes";
      const scrollClass =
        opts.scrollable && rows && rows.length > 6
          ? " policy-subsection--scroll"
          : "";
      const scopeAttr = scopeKey
        ? ' data-policy-scope="' + escapeHtml(scopeKey) + '"'
        : "";
      const defaultAllow = scopeKey === "home";
      if (skipIfEmpty && (!rows || !rows.length)) {
        return;
      }
      let subsectionHtml =
        '<div class="policy-subsection' + scrollClass + '"' + scopeAttr + ">";
      if (!rows.length) {
        subsectionHtml +=
          '<div class="policy-subhead policy-subhead--empty"><h3 class="policy-subtitle">' +
          escapeHtml(title) +
          "</h3></div>";
        subsectionHtml +=
          '<p class="result-muted-note policy-empty">' +
          escapeHtml(emptyNote || "Nothing to list here.") +
          "</p></div>";
        columnHtml[column] += subsectionHtml;
        return;
      }
      subsectionHtml +=
        '<div class="policy-subhead"><h3 class="policy-subtitle">' +
        escapeHtml(title) +
        "</h3></div>";
      if (subNoteHtml) {
        subsectionHtml +=
          '<p class="policy-subsection-note">' + subNoteHtml + "</p>";
      }
      subsectionHtml +=
        '<div class="policy-table-head" role="row">' +
        '<div class="policy-head-scope" role="columnheader">Scope</div>' +
        '<div class="policy-head-clear-wrap" role="columnheader">' +
        '<button type="button" class="policy-head-clear-link" data-bulk="clear" aria-label="' +
        escapeHtml(title + " — clear all checkboxes in this scope") +
        '" title="Clear Allow and Deny in this scope (neither allowf nor denyf for these codes)">Clear scope</button>' +
        "</div>" +
        '<div class="policy-head-col" role="columnheader">' +
        '<span class="policy-head-label" title="Allow flood packets tagged with this region (CLI: region allowf)">Allow</span>' +
        '<input type="checkbox" class="policy-scope-master-allow" aria-label="' +
        escapeHtml(title + " — allow all in this scope") +
        '" title="Allow flood for every row in this scope (region allowf)">' +
        "</div>" +
        '<div class="policy-head-col" role="columnheader">' +
        '<span class="policy-head-label" title="Block flood packets tagged with this region (CLI: region denyf)">Deny</span>' +
        '<input type="checkbox" class="policy-scope-master-deny" aria-label="' +
        escapeHtml(title + " — deny all in this scope") +
        '" title="Deny flood for every row in this scope (region denyf)">' +
        "</div></div>";
      rows.forEach(function (row) {
        const allow =
          row.allow !== undefined ? row.allow !== false : defaultAllow;
        const deny = !!row.deny;
        subsectionHtml += policyRow(row.label, row.code, {
          allow: allow,
          deny: deny,
        });
      });
      subsectionHtml += "</div>";
      columnHtml[column] += subsectionHtml;
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
      column: "home",
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
        column: "scopes",
        scrollable: true,
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
        column: "scopes",
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
        column: "scopes",
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
      { column: "scopes" },
    );

    policyGridsContainer.innerHTML =
      '<div class="policy-grids-layout">' +
      '<div class="policy-grids-col policy-grids-col--home">' +
      columnHtml.home +
      "</div>" +
      '<div class="policy-grids-col policy-grids-col--scopes">' +
      columnHtml.scopes +
      "</div></div>";
    applyNeighborPolicyGating(anchor);
    policyGridsContainer
      .querySelectorAll(".policy-subsection")
      .forEach(syncScopeMasters);
    refreshHomeOverrideSelect();
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
    const emptyEl = document.getElementById("policy-scope-empty");
    const bodyEl = document.getElementById("policy-regions-body");
    const headActions = document.getElementById("policy-head-actions");
    if (!anchor) {
      if (emptyEl) {
        emptyEl.hidden = false;
      }
      if (bodyEl) {
        bodyEl.hidden = true;
      }
      if (headActions) {
        headActions.hidden = true;
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
    if (headActions) {
      headActions.hidden = false;
    }
  }

  function buildRegionCommandLines(anchor) {
    if (!anchor) return [];

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
    const putLines = buildOrderedRegionPutLines(needed, homeCityRow);
    const lines = putLines.slice();
    allowSorted.forEach(function (r) {
      lines.push("region allowf " + r);
    });
    denySorted.forEach(function (r) {
      lines.push("region denyf " + r);
    });
    const homeLine = regionHomeLineForCli(anchor);
    if (homeLine) {
      lines.push(homeLine);
    }
    lines.push("region save");
    return lines;
  }

  function buildConfiguratorSections(anchor, options) {
    const enforceFirmwareDefaults = Boolean(
      options && options.enforceFirmwareDefaults,
    );
    const sections = [];
    if (namePreviewState && namePreviewState.isValid && namePreviewState.name) {
      sections.push("set name " + namePreviewState.name);
    }

    const setupLines = buildGeneralSettingsCli(enforceFirmwareDefaults);
    if (setupLines) {
      sections.push(setupLines);
    }

    if (anchor) {
      const regionLines = buildRegionCommandLines(anchor);
      if (regionLines.length) {
        sections.push(regionLines.join("\n"));
      }
    }
    return sections;
  }

  function buildConfiguratorCommandLines(anchor, options) {
    return buildConfiguratorSections(anchor, options)
      .join("\n")
      .split("\n")
      .map(function (line) {
        return line.trim();
      })
      .filter(function (line) {
        return line.length > 0 && line.charAt(0) !== "#";
      });
  }

  function updateMeshcoreCliBlock(anchor) {
    if (!commandsBlock) return;

    const showCliDefaults = Boolean(
      cliShowDefaultsEl && cliShowDefaultsEl.checked,
    );
    const sections = buildConfiguratorSections(anchor, {
      enforceFirmwareDefaults: showCliDefaults,
    });
    commandsBlock.textContent = sections.join("\n\n");
    updateUsbApplyUi(anchor);
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

  function selectLocation(anchor, label, coordMode) {
    if (label != null && input) {
      input.value = label;
    }
    dropdown.style.display = "none";

    const seed = neighborSeedRow(anchor);
    const neighborsRadius = findGeographicNeighbors(seed, {
      maxKm: NEIGHBOR_RADIUS_KM,
    });
    const neighborsScope = neighborsRadius.slice(0, NEIGHBOR_SCOPE_MAX_CITIES);
    const hasCoords =
      seed &&
      seed.lat != null &&
      seed.lon != null &&
      Number.isFinite(seed.lat) &&
      Number.isFinite(seed.lon);

    lastNeighbors = neighborsRadius;
    lastHasCoords = hasCoords;

    const api = positionApi();
    const mode = coordMode || "seed";
    if (api && mode === "seed" && hasCoords) {
      api.setCoords(seed.lat, seed.lon, { source: "search" });
    }

    renderPolicyGrids(anchor, neighborsScope, neighborsRadius, hasCoords);
    refreshPolicySection(anchor);
    resetNamingForLocation(anchor);
    applyPolicyDefaults();
    if (resultCard) resultCard.classList.add("visible");
    if (commandsCard) commandsCard.classList.add("visible");
    refreshConfiguratorOutputs();
  }

  let pendingLocationChoice = null;

  function formatCoordPair(lat, lon) {
    const api = positionApi();
    if (api && typeof api.formatCoord === "function") {
      return api.formatCoord(lat) + ", " + api.formatCoord(lon);
    }
    return Number(lat).toFixed(6) + ", " + Number(lon).toFixed(6);
  }

  function coordsNearlyEqual(a, b) {
    if (!a || !b) return false;
    return (
      Math.abs(Number(a.lat) - Number(b.lat)) < 1e-6 &&
      Math.abs(Number(a.lon) - Number(b.lon)) < 1e-6
    );
  }

  function locationChoiceToAnchor(choice) {
    if (!choice) return null;
    if (choice.type === "city" && choice.city) {
      return {
        mode: "city",
        province_code: choice.city.province_code,
        row: choice.city,
      };
    }
    if (choice.type === "province" && choice.code) {
      return {
        mode: "province",
        province_code: choice.code,
        row: null,
      };
    }
    if (choice.type === "country") {
      return { mode: "country", province_code: null, row: null };
    }
    return null;
  }

  function defaultCenterLabel(anchor) {
    if (anchor && anchor.mode === "city" && anchor.row) {
      return "City center (" + anchor.row.plaats + ")";
    }
    if (anchor && anchor.mode === "province" && anchor.province_code) {
      return (
        "Province center (" +
        (PROVINCE_NAMES[anchor.province_code] || anchor.province_code) +
        ")"
      );
    }
    return "Belgium center";
  }

  function commitLocationChoice(choice, coordMode) {
    if (!choice) return;
    if (choice.type === "city" && choice.city) {
      selectionMode = "city";
      selectedProvinceCode = choice.city.province_code;
      selectedCity = choice.city;
    } else if (choice.type === "province" && choice.code) {
      selectionMode = "province";
      selectedProvinceCode = choice.code;
      selectedCity = null;
    } else if (choice.type === "country") {
      selectionMode = "country";
      selectedProvinceCode = null;
      selectedCity = null;
    } else {
      return;
    }
    selectLocation(getAnchor(), choice.label, coordMode);
  }

  function closeLocationCoordsModal() {
    const modal = document.getElementById("location-coords-modal");
    if (modal) modal.hidden = true;
    document.body.classList.remove("config-confirm-modal-open");
    pendingLocationChoice = null;
  }

  function openLocationCoordsModal(existing, seed, anchor) {
    const modal = document.getElementById("location-coords-modal");
    const currentEl = document.getElementById("location-coords-current");
    const defaultEl = document.getElementById("location-coords-default");
    const defaultLabelEl = document.getElementById(
      "location-coords-default-label",
    );
    if (!modal) return;
    if (currentEl) {
      currentEl.textContent = formatCoordPair(existing.lat, existing.lon);
    }
    if (defaultEl) {
      defaultEl.textContent = formatCoordPair(seed.lat, seed.lon);
    }
    if (defaultLabelEl) {
      defaultLabelEl.textContent = defaultCenterLabel(anchor);
    }
    modal.hidden = false;
    document.body.classList.add("config-confirm-modal-open");
    const keepBtn = document.getElementById("location-coords-keep-btn");
    if (keepBtn) keepBtn.focus({ preventScroll: true });
  }

  function requestSelectLocation(choice) {
    const anchor = locationChoiceToAnchor(choice);
    if (!anchor) return;
    const seed = neighborSeedRow(anchor);
    const hasSeed =
      seed &&
      seed.lat != null &&
      seed.lon != null &&
      Number.isFinite(seed.lat) &&
      Number.isFinite(seed.lon);
    const existing = getFormCoords();

    if (
      existing.valid &&
      hasSeed &&
      !coordsNearlyEqual(
        { lat: existing.lat, lon: existing.lon },
        { lat: seed.lat, lon: seed.lon },
      )
    ) {
      pendingLocationChoice = { choice: choice, seed: seed, anchor: anchor };
      openLocationCoordsModal(existing, seed, anchor);
      return;
    }

    commitLocationChoice(choice, hasSeed ? "seed" : "keep");
  }

  function initLocationCoordsModal() {
    const keepBtn = document.getElementById("location-coords-keep-btn");
    const useDefaultBtn = document.getElementById(
      "location-coords-use-default-btn",
    );
    const modal = document.getElementById("location-coords-modal");
    if (keepBtn) {
      keepBtn.addEventListener("click", function () {
        const pending = pendingLocationChoice;
        if (!pending || !pending.choice) return;
        const choice = pending.choice;
        pendingLocationChoice = null;
        const modal = document.getElementById("location-coords-modal");
        if (modal) modal.hidden = true;
        document.body.classList.remove("config-confirm-modal-open");
        commitLocationChoice(choice, "keep");
      });
    }
    if (useDefaultBtn) {
      useDefaultBtn.addEventListener("click", function () {
        const pending = pendingLocationChoice;
        if (!pending || !pending.choice) return;
        const choice = pending.choice;
        pendingLocationChoice = null;
        const modal = document.getElementById("location-coords-modal");
        if (modal) modal.hidden = true;
        document.body.classList.remove("config-confirm-modal-open");
        commitLocationChoice(choice, "seed");
      });
    }
    if (modal) {
      modal
        .querySelectorAll("[data-location-coords-dismiss]")
        .forEach(function (el) {
          el.addEventListener("click", closeLocationCoordsModal);
        });
    }
    document.addEventListener("keydown", function (e) {
      if (e.key !== "Escape") return;
      const m = document.getElementById("location-coords-modal");
      if (m && !m.hidden) {
        closeLocationCoordsModal();
      }
    });
  }

  function selectProvince(pc) {
    requestSelectLocation({
      type: "province",
      code: pc,
      label: PROVINCE_NAMES[pc] || pc,
    });
  }

  function selectCountryBe() {
    requestSelectLocation({
      type: "country",
      label: "België (be)",
    });
  }

  function selectCity(city) {
    requestSelectLocation({
      type: "city",
      city: city,
      label: city.plaats,
    });
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
        copyBtn.textContent = "Copy command script";
        copyBtn.classList.remove("copied");
      }, 2000);
    });
  });

  if (cliShowDefaultsEl) {
    cliShowDefaultsEl.addEventListener("change", refreshConfiguratorOutputs);
  }

  if (serialUsbBtn) {
    serialUsbBtn.addEventListener("click", onSerialUsbToggleClick);
  }
  if (serialReadBtn) {
    serialReadBtn.addEventListener("click", readFromRepeater);
  }
  if (serialAdvertZerohopBtn) {
    serialAdvertZerohopBtn.addEventListener("click", function () {
      sendRepeaterAdvert("zerohop");
    });
  }
  if (serialAdvertFloodBtn) {
    serialAdvertFloodBtn.addEventListener("click", function () {
      sendRepeaterAdvert("flood");
    });
  }
  if (serialApplyBtn) {
    serialApplyBtn.addEventListener("click", applyToRepeater);
  }
  if (serialApplyBtn2) {
    serialApplyBtn2.addEventListener("click", applyToRepeater);
  }
  if (serialConsoleForm) {
    serialConsoleForm.addEventListener("submit", onSerialConsoleSubmit);
  }
  if (serialConsoleInput) {
    serialConsoleInput.addEventListener("keydown", onSerialConsoleKeydown);
  }
  if (serialConsoleClearBtn) {
    serialConsoleClearBtn.addEventListener("click", function () {
      clearSerialLog();
      if (serialConsoleInput) {
        serialConsoleInput.focus({ preventScroll: true });
      }
    });
  }

  // ---------------------------------------------------------------------------
  // Device tools: info, identity, config backup, and maintenance actions.
  // ---------------------------------------------------------------------------
  function setButtonSpanText(btn, text) {
    if (!btn) return;
    const span = btn.querySelector("span");
    if (span) span.textContent = text;
  }

  function flashButtonSpan(btn, text, revertText, ms) {
    if (!btn) return;
    const span = btn.querySelector("span");
    if (!span) return;
    const original = revertText || span.textContent;
    span.textContent = text;
    setTimeout(function () {
      span.textContent = original;
    }, ms || 1600);
  }

  async function runDeviceCommand(cmd, opts) {
    opts = opts || {};
    const rs = getRepeaterSerial();
    if (!rs || !rs.isConnected()) {
      appendSerialLog("Connect over USB first.", "is-err");
      return null;
    }
    if (isSerialBusy()) {
      appendSerialLog("Busy — wait for the current action to finish.", "is-err");
      return null;
    }
    try {
      appendSerialLog("> " + cmd);
      const res = await rs.sendLine(cmd, opts.sendOptions);
      if (res.reply) {
        appendSerialLog(res.reply, res.ok ? "is-ok" : "is-err");
      }
      if (!res.ok) {
        appendSerialLog((opts.label || "Command") + " failed.", "is-err");
      } else if (opts.successMsg) {
        appendSerialLog(opts.successMsg, "is-ok");
      }
      return res;
    } catch (err) {
      appendSerialLog(
        (opts.label || "Command") +
          " error: " +
          (err && err.message ? err.message : String(err)),
        "is-err",
      );
      return null;
    } finally {
      updateUsbApplyUi(getAnchor());
    }
  }

  if (deviceSyncClockBtn) {
    deviceSyncClockBtn.addEventListener("click", async function () {
      const epoch = Math.floor(Date.now() / 1000);
      await runDeviceCommand("time " + epoch, {
        label: "Clock sync",
        successMsg: "Device clock set to computer time.",
      });
      const r = await runDeviceCommand("clock", { label: "Clock" });
      if (r && r.ok && r.reply && deviceInfoClockEl) {
        deviceInfoClockEl.textContent = r.reply;
      }
    });
  }

  if (deviceCopyPubkeyBtn) {
    deviceCopyPubkeyBtn.addEventListener("click", function () {
      const pk = deviceInfoPubkeyEl
        ? deviceInfoPubkeyEl.textContent.trim()
        : "";
      if (!pk || pk === "—") {
        appendSerialLog(
          "Read from the device first to load the public key.",
          "is-err",
        );
        return;
      }
      navigator.clipboard.writeText(pk);
      flashButtonSpan(deviceCopyPubkeyBtn, "Copied", "Copy public key");
    });
  }

  async function ensurePrivateKeyLoaded() {
    if (!devicePrvkeyEl) return "";
    if (devicePrvkeyEl.value) return devicePrvkeyEl.value;
    const res = await runDeviceCommand("get prv.key", {
      label: "Read private key",
    });
    if (res && res.ok && res.reply) {
      devicePrvkeyEl.value = res.reply.trim();
    }
    return devicePrvkeyEl.value || "";
  }

  if (devicePrvkeyRevealBtn) {
    devicePrvkeyRevealBtn.addEventListener("click", async function () {
      if (!devicePrvkeyEl) return;
      if (devicePrvkeyEl.type === "password") {
        await ensurePrivateKeyLoaded();
        devicePrvkeyEl.type = "text";
        setButtonSpanText(devicePrvkeyRevealBtn, "Hide");
      } else {
        devicePrvkeyEl.type = "password";
        setButtonSpanText(devicePrvkeyRevealBtn, "Reveal");
      }
    });
  }

  if (devicePrvkeyCopyBtn) {
    devicePrvkeyCopyBtn.addEventListener("click", async function () {
      const key = await ensurePrivateKeyLoaded();
      if (!key) {
        appendSerialLog(
          "No private key available (connect and read first).",
          "is-err",
        );
        return;
      }
      navigator.clipboard.writeText(key);
      flashButtonSpan(devicePrvkeyCopyBtn, "Copied", "Copy");
    });
  }

  if (deviceRebootBtn) {
    deviceRebootBtn.addEventListener("click", function () {
      if (!window.confirm("Reboot the device now?")) return;
      runDeviceCommand("reboot", {
        label: "Reboot",
        successMsg: "Reboot sent (device may disconnect).",
        sendOptions: { timeoutMs: 3000 },
      });
    });
  }

  if (deviceOtaBtn) {
    deviceOtaBtn.addEventListener("click", function () {
      if (
        !window.confirm(
          "Start over-the-air firmware update?\n\nThe device enters OTA mode; follow your board's firmware upload steps (see MeshCore FAQ).",
        )
      ) {
        return;
      }
      runDeviceCommand("start ota", {
        label: "Start OTA",
        successMsg: "OTA mode requested.",
      });
    });
  }

  if (deviceFactoryResetBtn) {
    deviceFactoryResetBtn.addEventListener("click", function () {
      if (
        !window.confirm(
          "FACTORY RESET\n\nThis erases the identity (private key) and ALL settings from the device. This cannot be undone. Continue?",
        )
      ) {
        return;
      }
      if (
        !window.confirm(
          "Are you absolutely sure? The device identity will be permanently lost.",
        )
      ) {
        return;
      }
      runDeviceCommand("erase", {
        label: "Factory reset",
        successMsg: "Erase sent. Reboot the device to finish.",
      });
    });
  }

  // Config backup: export/import the form fields as JSON.
  function collectConfigFieldValues() {
    const data = {};
    const main = document.getElementById("config-main");
    if (!main) return data;
    main
      .querySelectorAll("input[id], select[id], textarea[id]")
      .forEach(function (el) {
        if (el.type === "file" || el.type === "button") return;
        if (el.readOnly) return;
        if (el.type === "checkbox") {
          data[el.id] = el.checked;
        } else {
          data[el.id] = el.value;
        }
      });
    return data;
  }

  function applyConfigFieldValues(data) {
    if (!data || typeof data !== "object") return;
    Object.keys(data).forEach(function (id) {
      const el = document.getElementById(id);
      if (!el) return;
      if (el.type === "checkbox") {
        el.checked = Boolean(data[id]);
      } else {
        el.value = data[id];
      }
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
    });
    if (typeof refreshConfiguratorOutputs === "function") {
      refreshConfiguratorOutputs();
    }
  }

  if (configExportBtn) {
    configExportBtn.addEventListener("click", function () {
      const payload = {
        app: "bemesh-configurator",
        version: 1,
        exportedAt: new Date().toISOString(),
        fields: collectConfigFieldValues(),
      };
      const blob = new Blob([JSON.stringify(payload, null, 2)], {
        type: "application/json",
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "bemesh-repeater-config.json";
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(function () {
        URL.revokeObjectURL(url);
      }, 1000);
    });
  }

  if (configImportBtn && configImportFileEl) {
    configImportBtn.addEventListener("click", function () {
      configImportFileEl.click();
    });
    configImportFileEl.addEventListener("change", function () {
      const file = configImportFileEl.files && configImportFileEl.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = function () {
        try {
          const parsed = JSON.parse(String(reader.result || "{}"));
          const fields = parsed && parsed.fields ? parsed.fields : parsed;
          applyConfigFieldValues(fields);
          appendSerialLog("Configuration imported from file.", "is-ok");
        } catch (err) {
          appendSerialLog(
            "Import failed: " +
              (err && err.message ? err.message : String(err)),
            "is-err",
          );
        }
        configImportFileEl.value = "";
      };
      reader.readAsText(file);
    });
  }

  // Vanity public key generation (Ed25519 via tweetnacl).
  function bytesToHex(bytes) {
    let s = "";
    for (let i = 0; i < bytes.length; i++) {
      s += bytes[i].toString(16).padStart(2, "0");
    }
    return s;
  }

  function generateVanityKey() {
    const nacl = window.nacl;
    if (!nacl || !nacl.sign || !nacl.sign.keyPair) {
      appendSerialLog("Key generation library not loaded.", "is-err");
      return;
    }
    const raw = window.prompt(
      "Vanity public key: enter a hex prefix (1-4 chars, 0-9 a-f). Longer prefixes take much longer.",
      "",
    );
    if (raw == null) return;
    const prefix = raw.trim().toLowerCase();
    if (!/^[0-9a-f]{1,4}$/.test(prefix)) {
      appendSerialLog("Invalid prefix — use 1-4 hex characters.", "is-err");
      return;
    }
    appendSerialLog(
      "Generating an identity whose public key starts with '" +
        prefix +
        "'… this can take a while.",
    );
    if (deviceVanityBtn) deviceVanityBtn.disabled = true;
    const maxAttempts = 5000000;
    let attempts = 0;
    const start = Date.now();
    function finish() {
      if (deviceVanityBtn) deviceVanityBtn.disabled = false;
    }
    function batch() {
      for (let i = 0; i < 400; i++) {
        attempts++;
        const kp = nacl.sign.keyPair();
        const pubHex = bytesToHex(kp.publicKey);
        if (pubHex.startsWith(prefix)) {
          const prvHex = bytesToHex(kp.secretKey);
          const secs = ((Date.now() - start) / 1000).toFixed(1);
          appendSerialLog(
            "Found after " + attempts + " tries in " + secs + "s.",
            "is-ok",
          );
          appendSerialLog("New public key: " + pubHex, "is-ok");
          finish();
          const write = window.confirm(
            "Found a matching key!\n\nPublic key:\n" +
              pubHex +
              "\n\nWrite this new identity to the connected device now? " +
              "(runs 'set prv.key', then reboot to apply)",
          );
          if (write) {
            runDeviceCommand("set prv.key " + prvHex, {
              label: "Set identity",
              successMsg: "Identity written. Reboot the device to apply.",
            });
          } else {
            appendSerialLog("Generated key discarded.");
          }
          return;
        }
        if (attempts >= maxAttempts) {
          appendSerialLog(
            "Gave up after " + attempts + " attempts. Try a shorter prefix.",
            "is-err",
          );
          finish();
          return;
        }
      }
      if (attempts % 8000 === 0) {
        appendSerialLog("… " + attempts + " keys tried");
      }
      setTimeout(batch, 0);
    }
    batch();
  }

  if (deviceVanityBtn) {
    deviceVanityBtn.addEventListener("click", generateVanityKey);
  }

  window.addEventListener("beforeunload", function () {
    const rs = getRepeaterSerial();
    if (rs && rs.isConnected()) {
      rs.disconnect();
    }
  });

  const generalCard = document.getElementById("general-card");
  if (generalCard) {
    generalCard.addEventListener("input", function (e) {
      const t = e.target;
      if (t instanceof HTMLElement && t.id === "setting-radio-bw") {
        clampRadioBwInput();
      }
      if (
        t instanceof HTMLElement &&
        (t.id === "name-suffix" || t.id === "name-power-emoji")
      ) {
        const anchor = getAnchor();
        clampNamingInput(anchor);
      }
      refreshConfiguratorOutputs();
    });
    generalCard.addEventListener("change", function (e) {
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
      if (
        t instanceof HTMLElement &&
        (t.id === "name-location-mode" || t.id === "name-power-emoji")
      ) {
        const anchor = getAnchor();
        if (t.id === "name-location-mode") {
          syncPrefixField(anchor);
        }
        clampNamingInput(anchor);
      }
      refreshConfiguratorOutputs();
    });
  }

  initRadioPresetSelect();
  initSerialShowCommandLogToggle();
  initRecommendedSettingsUi();
  initLocationCoordsModal();
  initSerialReadConfirmModal();

  if (App && App.position && App.position.init) {
    App.position.init(function () {
      refreshConfiguratorOutputs();
    });
  }

  const untaggedFloodEl = document.getElementById("policy-untagged-flood");
  if (untaggedFloodEl) {
    untaggedFloodEl.addEventListener("change", function () {
      refreshConfiguratorOutputs();
    });
  }

  if (commandsCard) commandsCard.classList.add("visible");
  if (resultCard) resultCard.classList.add("visible");
  if (policyCard) policyCard.classList.add("visible");
  refreshPolicySection(null);
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

      if (t.id === "policy-home-override") {
        refreshHomeOverrideSelect();
        finalizePolicyUiChange();
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
