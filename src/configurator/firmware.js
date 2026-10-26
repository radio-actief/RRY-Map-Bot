/**
 * Firmware version from the `ver` reply ("v1.17.1 (Build: 14 Aug 2026)").
 */
(function (App) {
  "use strict";

  /** `region def` arrived in MeshCore 1.16. */
  const REGION_DEF_MIN = { major: 1, minor: 16 };

  /** {major, minor, patch, text} or null when the reply carries no version. */
  function parseVersion(reply) {
    const m = /\bv?(\d+)\.(\d+)(?:\.(\d+))?/i.exec(String(reply || ""));
    if (!m) return null;
    return {
      major: Number(m[1]),
      minor: Number(m[2]),
      patch: m[3] ? Number(m[3]) : 0,
      text: m[0],
    };
  }

  function supportsRegionDef(v) {
    if (!v) return false;
    if (v.major !== REGION_DEF_MIN.major) return v.major > REGION_DEF_MIN.major;
    return v.minor >= REGION_DEF_MIN.minor;
  }

  App.firmware = {
    REGION_DEF_MIN_TEXT: "1.16",
    parseVersion: parseVersion,
    supportsRegionDef: supportsRegionDef,
  };
})(window.ConfiguratorApp);
