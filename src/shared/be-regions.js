/**
 * Shared Belgian region data + data-path helper for the tool pages.
 *
 * Single source of truth for province codes/names/adjacency and the
 * be-locode data URL resolver, previously duplicated across
 * configurator (src/configurator/dom.js) and region-map.html.
 *
 * Exposed as window.RRYRegions (plain globals, no bundler needed).
 */
(function (global) {
  "use strict";

  /**
   * Resolve a /data/<filename> URL that works whether the page is served at a
   * clean route (/region-map, /configurator) or as a static .html file.
   * Relative "./data/" from a clean route like /region-map/ would wrongly
   * resolve to /region-map/data/…, so use an absolute path there.
   */
  function rryDataUrl(filename) {
    var p = (global.location && global.location.pathname) || "";
    if (/\.html?$/i.test(p)) {
      return "./data/" + filename;
    }
    if (/(?:^|\/)(region-map|configurator|region-configurator)(?:\/|$)/.test(p)) {
      return "/data/" + filename;
    }
    return "./data/" + filename;
  }

  var PROVINCE_NAMES = {
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

  /** Canonical display/iteration order. */
  var PROVINCE_CODES = [
    "be-van",
    "be-vbr",
    "be-vov",
    "be-vwv",
    "be-vli",
    "be-bru",
    "be-wbr",
    "be-wht",
    "be-wlg",
    "be-wna",
    "be-wlx",
  ];

  var PROVINCE_ADJACENCY = {
    "be-van": ["be-vbr", "be-vov", "be-vli"],
    "be-vbr": ["be-van", "be-vli", "be-vov", "be-wbr", "be-bru", "be-wht", "be-wlg"],
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

  /** Province label tooltips anchor at the administrative capital (from be-locode pins). */
  var PROVINCE_CAPITAL_LATLNG = {
    "be-van": [51.22111, 4.39971],
    "be-vbr": [50.8792, 4.70117],
    "be-vov": [51.05383, 3.72501],
    "be-vwv": [51.20855, 3.22677],
    "be-vli": [50.93037, 5.3378],
    "be-bru": [50.84674, 4.35249],
    "be-wbr": [50.71697, 4.61042],
    "be-wht": [50.45496, 3.95196],
    "be-wlg": [50.64509, 5.57361],
    "be-wna": [50.46653, 4.86619],
    "be-wlx": [49.68346, 5.81677],
  };

  global.RRYRegions = {
    rryDataUrl: rryDataUrl,
    PROVINCE_NAMES: PROVINCE_NAMES,
    PROVINCE_CODES: PROVINCE_CODES,
    PROVINCE_ADJACENCY: PROVINCE_ADJACENCY,
    PROVINCE_CAPITAL_LATLNG: PROVINCE_CAPITAL_LATLNG,
  };
})(window);
