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
  const serialConnectBtn = document.getElementById("serial-connect-btn");
  const serialDisconnectBtn = document.getElementById("serial-disconnect-btn");
  const serialReadBtn = document.getElementById("serial-read-btn");
  const serialApplyBtn = document.getElementById("serial-apply-btn");
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
    "get int.thresh",
    "get agc.reset.interval",
    "get multi.acks",
    "region home",
    "region list allowed",
    "region list denied",
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
    if (flags && flags.advanced) {
      openSettingsTier("settings-tier-advanced");
    }
    if (flags && flags.expert) {
      openSettingsTier("settings-tier-expert");
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

  function updateUsbApplyUi(anchor) {
    const rs = getRepeaterSerial();
    const supported = rs && rs.isSupported();
    const busy = isSerialBusy();
    const connected = Boolean(rs && rs.isConnected());
    const consoleEnabled = supported && connected && !busy;
    if (serialUnsupportedEl) {
      serialUnsupportedEl.hidden = supported;
    }
    if (serialConnectBtn) {
      serialConnectBtn.disabled = !supported || busy;
    }
    if (serialDisconnectBtn) {
      serialDisconnectBtn.disabled =
        !supported || busy || !(rs && rs.isConnected());
    }
    if (serialReadBtn) {
      serialReadBtn.disabled = !supported || busy || !(rs && rs.isConnected());
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
    if (serialApplyBtn) {
      const applyLines = buildConfiguratorCommandLines(anchor, {
        enforceFirmwareDefaults: true,
      });
      const hasCommands = applyLines.length > 0;
      const needsLocation = !anchor;
      serialApplyBtn.disabled =
        !supported ||
        busy ||
        !(rs && rs.isConnected()) ||
        !hasCommands ||
        needsLocation;
      if (needsLocation && rs && rs.isConnected()) {
        serialApplyBtn.title = "Choose a location for region scopes.";
      } else {
        serialApplyBtn.title = "";
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
        serialConsoleInput.focus();
      }
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
        serialConsoleInput.focus();
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
      if (name.indexOf(prefix) === 0) {
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

  function applyReadRegionsToPolicy(allowed, denied, homeRegion, anchor) {
    if (!policyCard || !anchor) {
      return { applied: false, reason: "no-location" };
    }
    const allowedSet = new Set(allowed || []);
    const deniedSet = new Set(denied || []);

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

    return { applied: true };
  }

  function applyReadResultsToForm(byCmd, anchor) {
    let updated = 0;
    const failures = [];
    const labels = [];
    const tierFlags = { advanced: false, expert: false };
    let scrollTarget = null;
    let namePrefixMismatch = false;

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
    if (nameValue !== undefined) {
      const nameResult = applyReadNameToForm(nameValue, anchor);
      if (nameResult.applied) {
        mark("Name", "general");
        scrollTarget = scrollTarget || "naming-card";
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
      scrollTarget = scrollTarget || "settings-card";
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
    if (
      pathHashValue !== undefined &&
      setSelectIfPresent(settingPathHashModeEl, pathHashValue)
    ) {
      mark("Path hash mode", "advanced");
    }

    const loopValue = takeReadReply(byCmd, "get loop.detect", failures);
    if (
      loopValue !== undefined &&
      setSelectIfPresent(settingLoopDetectEl, loopValue)
    ) {
      mark("Loop detection", "advanced");
    }

    const txdelayValue = takeReadReply(byCmd, "get txdelay", failures);
    if (txdelayValue !== undefined && settingTxdelayEl) {
      settingTxdelayEl.value = txdelayValue;
      mark("TX delay", "expert");
    }

    const directTxdelayValue = takeReadReply(
      byCmd,
      "get direct.txdelay",
      failures,
    );
    if (directTxdelayValue !== undefined && settingDirectTxdelayEl) {
      settingDirectTxdelayEl.value = directTxdelayValue;
      mark("Direct TX delay", "expert");
    }

    const rxdelayValue = takeReadReply(byCmd, "get rxdelay", failures);
    if (rxdelayValue !== undefined && settingRxdelayEl) {
      settingRxdelayEl.value = rxdelayValue;
      mark("RX delay", "expert");
    }

    const rxgainValue = takeReadReply(byCmd, "get radio.rxgain", failures);
    if (
      rxgainValue !== undefined &&
      setSelectIfPresent(settingRadioRxgainEl, rxgainValue)
    ) {
      mark("Radio RX gain", "expert");
    }

    const intThreshValue = takeReadReply(byCmd, "get int.thresh", failures);
    if (intThreshValue !== undefined && settingIntThreshEl) {
      settingIntThreshEl.value = intThreshValue;
      mark("Interference threshold", "expert");
    }

    const agcValue = takeReadReply(byCmd, "get agc.reset.interval", failures);
    if (agcValue !== undefined && settingAgcResetEl) {
      settingAgcResetEl.value = agcValue;
      mark("AGC reset interval", "expert");
    }

    const multiAcksValue = takeReadReply(byCmd, "get multi.acks", failures);
    if (multiAcksValue !== undefined && settingMultiAcksEl) {
      const n = parseInt(multiAcksValue, 10);
      if (Number.isFinite(n)) {
        setSelectIfPresent(settingMultiAcksEl, n > 0 ? "1" : "0");
        mark("Multi-acks", "expert");
      }
    }

    const homeValue = takeReadReply(byCmd, "region home", failures);
    const allowedValue = takeReadReply(byCmd, "region list allowed", failures);
    const deniedValue = takeReadReply(byCmd, "region list denied", failures);
    const homeRegion =
      homeValue !== undefined ? parseRegionHomeName(homeValue) || homeValue : "";
    const allowed =
      allowedValue !== undefined ? parseRegionNameList(allowedValue) : [];
    const denied =
      deniedValue !== undefined ? parseRegionNameList(deniedValue) : [];

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
      const regionResult = applyReadRegionsToPolicy(
        allowed,
        denied,
        homeRegion,
        anchor,
      );
      if (regionResult.applied) {
        mark("Region policy", "advanced");
        scrollTarget = scrollTarget || "policy-card";
      } else if (regionResult.reason === "no-location") {
        appendSerialLog(
          "Region policy not applied — pick a location in section 1 to map allow/deny checkboxes.",
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

  async function readFromRepeater() {
    const rs = getRepeaterSerial();
    if (!rs || !rs.isConnected() || !rs.queryCommands) return;

    const anchor = getAnchor();
    const msg =
      "Read current settings from the connected repeater?\n\n" +
      "This updates the form. Admin password cannot be read from the device." +
      (anchor
        ? " Region allow/deny lists and home will be applied to the policy for your selected location."
        : " Choose a location afterward to align region policy with the device.");
    if (!window.confirm(msg)) {
      return;
    }

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
        copyBtn.textContent = "Copy command script";
        copyBtn.classList.remove("copied");
      }, 2000);
    });
  });

  if (cliShowDefaultsEl) {
    cliShowDefaultsEl.addEventListener("change", refreshConfiguratorOutputs);
  }

  if (serialConnectBtn) {
    serialConnectBtn.addEventListener("click", connectSerialUsb);
  }
  if (serialDisconnectBtn) {
    serialDisconnectBtn.addEventListener("click", disconnectSerialUsb);
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
        serialConsoleInput.focus();
      }
    });
  }

  window.addEventListener("beforeunload", function () {
    const rs = getRepeaterSerial();
    if (rs && rs.isConnected()) {
      rs.disconnect();
    }
  });

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
          openSettingsTier("settings-tier-expert");
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
  initSerialShowCommandLogToggle();

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
