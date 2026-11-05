/** Firmware version from the `ver` reply ("v1.17.1 (Build: 14 Aug 2026)"). */

export interface FirmwareVersion {
  major: number;
  minor: number;
  patch: number;
  text: string;
}

/** `region def` arrived in MeshCore 1.16. */
const REGION_DEF_MIN = { major: 1, minor: 16 };

export const REGION_DEF_MIN_TEXT = "1.16";

/**
 * The version in a `ver` reply, or null when the reply carries none. A `v`-prefixed version wins
 * over other numbers (a fork's "2026.1 … v1.15" is 1.15).
 */
export function parseVersion(reply: string | null | undefined): FirmwareVersion | null {
  const text = String(reply || "");
  const m = /\bv(\d+)\.(\d+)(?:\.(\d+))?/i.exec(text) ?? /\bv?(\d+)\.(\d+)(?:\.(\d+))?/i.exec(text);
  if (!m) return null;
  return {
    major: Number(m[1]),
    minor: Number(m[2]),
    patch: m[3] ? Number(m[3]) : 0,
    text: m[0],
  };
}

export function supportsRegionDef(v: FirmwareVersion | null): boolean {
  if (!v) return false;
  if (v.major !== REGION_DEF_MIN.major) return v.major > REGION_DEF_MIN.major;
  return v.minor >= REGION_DEF_MIN.minor;
}
