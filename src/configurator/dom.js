/**
 * DOM refs, shared state, and layout helpers for the repeater configurator.
 */
(function (global) {
  "use strict";

  const App = (global.ConfiguratorApp = global.ConfiguratorApp || {});

  App.state = {
    CITIES: [],
    selectionMode: "none",
    selectedProvinceCode: null,
    selectedCity: null,
    activeIndex: -1,
    lastMatches: [],
    lastNeighbors: [],
    lastHasCoords: false,
    namePreviewState: {
      name: "",
      isValid: false,
      totalBytes: 0,
      message: "Pick a location first to build a name.",
    },
    serialApplyAbort: null,
    serialApplying: false,
    serialReading: false,
    serialConsoleSending: false,
    serialConsoleHistory: [],
    serialConsoleHistoryBrowse: -1,
  };

  App.PROVINCE_NAMES = {
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

  App.PROVINCE_ADJACENCY = {
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

  App.SERIAL_CONSOLE_HISTORY_MAX = 50;
  App.SERIAL_LOG_VERBOSE_KEY = "configurator.serialShowCommandLog";
  App.REPEATER_READ_COMMANDS = [
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
    "get lat",
    "get lon",
    "gps advert",
    "region home",
    "region list allowed",
    "region list denied",
  ];
  App.NAME_POWER_EMOJI_VALUES = ["🌞", "⚡", "🔋", "👀"];

  App.dom = {};

  App.rryDataUrl = function (filename) {
    const p = window.location.pathname || "";
    if (/\.html?$/i.test(p)) {
      return "./data/" + filename;
    }
    if (
      /(?:^|\/)(region-map|configurator|region-configurator)(?:\/|$)/.test(p)
    ) {
      return "/data/" + filename;
    }
    return "./data/" + filename;
  };

  App.initDom = function () {
    const D = App.dom;
    D.input = document.getElementById("city-search");
    D.dropdown = document.getElementById("city-dropdown");
    D.resultCard = document.getElementById("result-card");
    D.resultGrid = document.getElementById("result-grid");
    D.commandsCard = document.getElementById("commands-card");
    D.commandsBlock = document.getElementById("commands-block");
    D.copyBtn = document.getElementById("copy-btn");
    D.cliShowDefaultsEl = document.getElementById("cli-show-defaults");
    D.serialUsbBtn = document.getElementById("serial-usb-btn");
    D.serialReadBtn = document.getElementById("serial-read-btn");
    D.serialApplyBtn = document.getElementById("serial-apply-btn");
    D.serialAdvertZerohopBtn = document.getElementById("serial-advert-zerohop-btn");
    D.serialAdvertFloodBtn = document.getElementById("serial-advert-flood-btn");
    D.serialConsoleForm = document.getElementById("serial-console-form");
    D.serialConsoleInput = document.getElementById("serial-console-input");
    D.serialConsoleSendBtn = document.getElementById("serial-console-send-btn");
    D.serialConsoleClearBtn = document.getElementById("serial-console-clear-btn");
    D.serialStatusEl = document.getElementById("serial-status");
    D.serialApplyLogEl = document.getElementById("serial-apply-log");
    D.serialShowCommandLogEl = document.getElementById("serial-show-command-log");
    D.serialUnsupportedEl = document.getElementById("serial-unsupported");
    D.policyCard = document.getElementById("policy-card");
    D.policyGridsContainer = document.getElementById("policy-grids-container");
    D.generalCard = document.getElementById("general-card");
    D.identityBlock = document.getElementById("config-identity-block");
    D.namePrefixPreviewEl = document.getElementById("name-prefix-preview");
    D.nameLocationModeWrapEl = document.getElementById("name-location-mode-wrap");
    D.nameLocationModeEl = document.getElementById("name-location-mode");
    D.nameSuffixEl = document.getElementById("name-suffix");
    D.namePowerEmojiEl = document.getElementById("name-power-emoji");
    D.namePreviewEl = document.getElementById("name-preview");
    D.namePreviewMetaEl = document.getElementById("name-preview-meta");
    D.namePreviewNoteEl = document.getElementById("name-preview-note");
    D.settingDutycycleEl = document.getElementById("setting-dutycycle");
    D.settingPathHashModeEl = document.getElementById("setting-path-hash-mode");
    D.settingLoopDetectEl = document.getElementById("setting-loop-detect");
    D.settingRepeatEl = document.getElementById("setting-repeat");
    D.settingOwnerInfoEl = document.getElementById("setting-owner-info");
    D.settingAdminPasswordEl = document.getElementById("setting-admin-password");
    D.settingGuestPasswordEl = document.getElementById("setting-guest-password");
    D.settingTxdelayEl = document.getElementById("setting-txdelay");
    D.settingDirectTxdelayEl = document.getElementById("setting-direct-txdelay");
    D.settingFloodAdvertIntervalEl = document.getElementById(
      "setting-flood-advert-interval",
    );
    D.settingAdvertIntervalEl = document.getElementById("setting-advert-interval");
    D.settingFloodMaxUnscopedEl = document.getElementById(
      "setting-flood-max-unscoped",
    );
    D.settingFloodMaxAdvertEl = document.getElementById("setting-flood-max-advert");
    D.settingFloodMaxEl = document.getElementById("setting-flood-max");
    D.settingRxdelayEl = document.getElementById("setting-rxdelay");
    D.settingRadioRxgainEl = document.getElementById("setting-radio-rxgain");
    D.settingIntThreshEl = document.getElementById("setting-int-thresh");
    D.settingAgcResetEl = document.getElementById("setting-agc-reset");
    D.settingMultiAcksEl = document.getElementById("setting-multi-acks");
    D.settingRadioPresetEl = document.getElementById("setting-radio-preset");
    D.settingRadioCustomWrapEl = document.getElementById("setting-radio-custom-wrap");
    D.settingRadioFreqEl = document.getElementById("setting-radio-freq");
    D.settingRadioSfEl = document.getElementById("setting-radio-sf");
    D.settingRadioBwEl = document.getElementById("setting-radio-bw");
    D.settingRadioCrEl = document.getElementById("setting-radio-cr");
    D.settingRadioErrorEl = document.getElementById("setting-radio-error");
    D.settingLatEl = document.getElementById("setting-lat");
    D.settingLonEl = document.getElementById("setting-lon");
    D.settingAdvertLocEl = document.getElementById("setting-advert-loc");
    D.positionMapModalEl = document.getElementById("position-map-modal");
  };

  App.openSettingsTier = function (tierId) {
    const el = document.getElementById(tierId);
    if (el instanceof HTMLDetailsElement) {
      el.open = true;
    }
  };

  App.expandSettingsTiersAfterRead = function (flags) {
    if (flags && flags.advanced) {
      App.openSettingsTier("settings-tier-advanced");
    }
    if (flags && flags.expert) {
      App.openSettingsTier("settings-tier-expert");
    }
  };

  App.scrollConfiguratorSection = function (sectionId) {
    const el = document.getElementById(sectionId);
    if (el && el.scrollIntoView) {
      el.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }
  };

  App.getRepeaterSerial = function () {
    return typeof global !== "undefined" ? global.RepeaterSerial : null;
  };

  App.loadCities = function () {
    fetch(App.rryDataUrl("be-locode.json"))
      .then(function (r) {
        if (!r.ok) return [];
        return r.json().catch(function () {
          return [];
        });
      })
      .then(function (data) {
        App.state.CITIES = Array.isArray(data) ? data : [];
        if (App.dom.input) {
          App.dom.input.placeholder =
            "Search here ; i.e. Vlaams-Brabant, be-vbr, België, or a municipality…";
        }
      })
      .catch(function () {
        App.state.CITIES = [];
        if (App.dom.input) {
          App.dom.input.placeholder =
            "Could not load locations — try again later.";
        }
      });
  };
})(window);
