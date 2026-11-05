/** Repeater naming and text limits (MeshCore CommonCLI.h / AdvertDataHelpers.cpp). */
import type { Place } from "./search";

/** Advert is 32 bytes: 1 type byte + 8 location bytes + name. */
export const NAME_MAX_WITH_LOCATION = 23;
/** node_name[32] holds 31 bytes plus the terminator. */
export const NAME_MAX = 31;
/** owner_info[120] holds 119 bytes plus the terminator. */
export const OWNER_INFO_MAX = 119;
/** Auto-generated prefix segment, e.g. "BE-RON-". */
const PREFIX_MAX = 7;
/** Characters `set name` rejects ("Error, bad chars"). */
const BAD_NAME_CHARS = ["[", "]", "\\", ":", ",", "?", "*"];
/** Control characters: the firmware ends a command at CR, so none may sit inside a value. */
const CONTROL_CHARS = /[\x00-\x1f\x7f]/g;

export type PrefixFormat = "city" | "province" | "country" | "none";
export type PowerEmoji = "🌞" | "⚡" | "🔋" | "👀" | "";

/** The power/type emoji a name can end with. */
export const POWER_EMOJIS: Exclude<PowerEmoji, "">[] = ["🌞", "⚡", "🔋", "👀"];
const encoder = new TextEncoder();

export function utf8Bytes(s: string): number {
  return encoder.encode(s).length;
}

/** Longest leading part of `s` (whole code points) that fits in `maxBytes`. */
export function trimUtf8ToMaxBytes(s: string, maxBytes: number): string {
  if (maxBytes <= 0) return "";
  if (utf8Bytes(s) <= maxBytes) return s;
  let out = "";
  let used = 0;
  for (const ch of s) {
    const n = utf8Bytes(ch);
    if (used + n > maxBytes) break;
    out += ch;
    used += n;
  }
  return out;
}

/** Maps the old page's `#name-location-mode` option values (backups) to a PrefixFormat. */
export function prefixFormatFromLegacy(value: string): PrefixFormat {
  switch (value) {
    case "city":
    case "province":
    case "country":
    case "none":
      return value;
    default:
      return "city";
  }
}

function citySegment(cityCode: string | undefined): string {
  return cityCode ? cityCode.replace(/^be/i, "").toUpperCase() : "";
}

function provinceSegment(provinceCode: string | null | undefined): string {
  return provinceCode ? provinceCode.replace(/^be-/i, "").toUpperCase() : "";
}

/** Trim and ensure a single trailing "-", within the 7-byte prefix budget. */
function normalizePrefix(raw: string): string {
  let core = raw.trim().replace(/-+$/, "");
  if (!core) return "";
  core = trimUtf8ToMaxBytes(core, PREFIX_MAX - 1);
  return core ? core + "-" : "";
}

export function buildPrefix(
  format: PrefixFormat,
  place: Place | null,
  provinceCode: string | null,
): string {
  if (format === "none") return "";
  if (format === "country") return normalizePrefix("BE-");
  if (format === "province") {
    const seg = provinceSegment(place ? place.province_code : provinceCode);
    return seg ? normalizePrefix("BE-" + seg + "-") : "";
  }
  const seg = place ? citySegment(place.city_code) : "";
  return seg ? normalizePrefix("BE-" + seg + "-") : "";
}

export function buildName(prefix: string, suffix: string, power: PowerEmoji): string {
  return prefix + suffix.trim() + power;
}

/** Splits a device name into the part before the trailing power emoji and that emoji. */
export function splitNameSuffixAndEmoji(name: string): { suffix: string; power: PowerEmoji } {
  for (const mark of POWER_EMOJIS) {
    if (name.endsWith(mark)) return { suffix: name.slice(0, -mark.length), power: mark };
  }
  return { suffix: name, power: "" };
}

/** Whether `text` holds a control character (a newline is allowed when `newlineOk`). */
export function hasControlChars(text: string, newlineOk = false): boolean {
  const found = text.match(CONTROL_CHARS) ?? [];
  return found.some((c) => !(newlineOk && c === "\n"));
}

/**
 * A name against the firmware limits. `badChars` lists the characters `set name` rejects and any
 * control character (`controlChars` tells the two apart for the message).
 */
export function checkName(
  name: string,
  advertHasLocation: boolean,
): { bytes: number; max: number; badChars: string[]; controlChars: boolean; ok: boolean } {
  const bytes = utf8Bytes(name);
  const max = advertHasLocation ? NAME_MAX_WITH_LOCATION : NAME_MAX;
  const controls = [...new Set(name.match(CONTROL_CHARS) ?? [])];
  const badChars = [...BAD_NAME_CHARS.filter((c) => name.includes(c)), ...controls];
  return { bytes, max, badChars, controlChars: controls.length > 0, ok: bytes <= max && badChars.length === 0 };
}

/** The firmware turns '|' into a newline, so newlines are sent as '|'. */
export function encodeOwnerInfo(text: string): string {
  return text.replace(/\r\n|\r|\n/g, "|");
}

export function checkOwnerInfo(text: string): { bytes: number; max: 119; ok: boolean } {
  const bytes = utf8Bytes(encodeOwnerInfo(text));
  return { bytes, max: OWNER_INFO_MAX, ok: bytes <= OWNER_INFO_MAX };
}
