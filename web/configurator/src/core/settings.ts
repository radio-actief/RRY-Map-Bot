/** Settings registry: CLI keys, read commands, ranges, defaults and validation. */
import { encodeOwnerInfo, hasControlChars, utf8Bytes } from "./naming";
import { BEMESH_PRESET_TITLE } from "./presets";

export type SettingKey =
  | "repeat"
  | "ownerInfo"
  | "guestPassword"
  | "adminPassword"
  | "dutycycle"
  | "floodAdvertHours"
  | "advertIntervalMinutes"
  | "floodMaxUnscoped"
  | "floodMaxAdvert"
  | "floodMax"
  | "pathHashMode"
  | "loopDetect"
  | "txdelay"
  | "directTxdelay"
  | "rxdelay"
  | "radioRxgain"
  | "intThresh"
  | "agcResetInterval"
  | "multiAcks"
  | "txPower";

export type SettingDef = {
  key: SettingKey;
  readCmd?: string;
  cliKey: string;
  card: "access" | "radio" | "advertising" | "owner" | "repeating" | "advanced";
  /** MeshCore firmware default: decides which lines the script omits. */
  firmwareDefault: string | number | null;
  /** Value the form offers when the field is left empty. */
  formDefault: string | number | null;
  range?: { min: number; max: number; step?: number };
  options?: string[];
  helpKey: string;
};

const def = (
  key: SettingKey,
  cliKey: string,
  card: SettingDef["card"],
  firmwareDefault: SettingDef["firmwareDefault"],
  formDefault: SettingDef["formDefault"],
  extra: Partial<SettingDef> = {},
  readCmd: string | undefined = `get ${cliKey}`,
): SettingDef => ({
  key,
  cliKey,
  card,
  firmwareDefault,
  formDefault,
  helpKey: `help.${key}`,
  ...(readCmd ? { readCmd } : {}),
  ...extra,
});

export const SETTINGS: SettingDef[] = [
  def("repeat", "repeat", "repeating", "on", "on", { options: ["on", "off"] }),
  def("ownerInfo", "owner.info", "owner", null, ""),
  def("guestPassword", "guest.password", "access", null, ""),
  def("adminPassword", "password", "access", null, "", {}, undefined),
  def("dutycycle", "dutycycle", "radio", "50", "10", { options: ["1", "10", "50", "100"] }),
  def("floodAdvertHours", "flood.advert.interval", "advertising", 47, 47, { range: { min: 3, max: 168 } }),
  def("advertIntervalMinutes", "advert.interval", "advertising", 0, 0, { range: { min: 60, max: 240, step: 2 } }),
  def("floodMaxUnscoped", "flood.max.unscoped", "repeating", 64, 12, { range: { min: 0, max: 64 } }),
  def("floodMaxAdvert", "flood.max.advert", "repeating", 8, 8, { range: { min: 0, max: 64 } }),
  def("floodMax", "flood.max", "repeating", 64, 64, { range: { min: 0, max: 64 } }),
  def("pathHashMode", "path.hash.mode", "repeating", "0", "1", { options: ["0", "1", "2"] }),
  def("loopDetect", "loop.detect", "repeating", "off", "minimal", {
    options: ["off", "minimal", "moderate", "strict"],
  }),
  def("txdelay", "txdelay", "repeating", 0.5, 0.5, { range: { min: 0, max: 2 } }),
  def("directTxdelay", "direct.txdelay", "repeating", 0.2, 0.2, { range: { min: 0, max: 2 } }),
  def("rxdelay", "rxdelay", "advanced", 0, 0, { range: { min: 0, max: 20 } }),
  def("radioRxgain", "radio.rxgain", "advanced", "on", "on", { options: ["on", "off"] }),
  def("intThresh", "int.thresh", "advanced", 0, 0, { range: { min: 0, max: 255 } }),
  def("agcResetInterval", "agc.reset.interval", "advanced", 0, 0, { range: { min: 0, max: 255, step: 4 } }),
  def("multiAcks", "multi.acks", "advanced", "0", "0", { options: ["0", "1"] }),
  def("txPower", "tx", "radio", null, null, { range: { min: 1, max: 22 } }, "get tx"),
];

const BY_KEY = new Map(SETTINGS.map((s) => [s.key, s]));

export const ADMIN_PASSWORD_MAX_BYTES = 15;
/** guest_password[16] holds 15 bytes plus the terminator. */
export const GUEST_PASSWORD_MAX_BYTES = 15;

export type ValidateResult = { ok: true; value: string | number | null } | { ok: false; errorKey: string };

const fail = (errorKey: string): ValidateResult => ({ ok: false, errorKey });

/**
 * Validates one field and returns the normalised value: text trimmed, empty numeric
 * input replaced by the form default, advert interval rounded to even, AGC reset
 * floored to a multiple of 4 (1-3 become 4), rxdelay rounded to one decimal.
 * Out-of-range input is rejected, not clamped.
 */
export function validateSetting(key: SettingKey, raw: string): ValidateResult {
  const s = BY_KEY.get(key);
  if (!s) return fail("unknown");
  const text = String(raw ?? "");

  if (key === "adminPassword") {
    const pw = text.trim();
    if (hasControlChars(pw)) return fail("controlChars");
    if (utf8Bytes(pw) > ADMIN_PASSWORD_MAX_BYTES) return fail("tooLong");
    return { ok: true, value: pw };
  }
  if (key === "guestPassword") {
    const pw = text.trim();
    if (hasControlChars(pw)) return fail("controlChars");
    if (utf8Bytes(pw) > GUEST_PASSWORD_MAX_BYTES) return fail("guestPasswordTooLong");
    return { ok: true, value: pw };
  }
  // Newlines are sent as '|'; any other control character would break the command line.
  if (key === "ownerInfo") {
    const info = text.trim();
    return hasControlChars(encodeOwnerInfo(info)) ? fail("controlChars") : { ok: true, value: info };
  }

  const v = text.trim();
  if (s.options) {
    return s.options.includes(v) ? { ok: true, value: v } : fail("option");
  }

  if (v === "") return { ok: true, value: key === "txPower" ? null : (s.formDefault ?? s.firmwareDefault) };
  const isDecimal = key === "txdelay" || key === "directTxdelay" || key === "rxdelay";
  const n = Number(v);
  if (!Number.isFinite(n) || (!isDecimal && !Number.isInteger(n))) return fail("number");
  const range = s.range!;

  // Features that can be switched off with 0 accept it besides their normal range.
  const zeroOff = key === "floodAdvertHours" || key === "advertIntervalMinutes" || key === "agcResetInterval";
  if (!(zeroOff && n === 0) && (n < range.min || n > range.max)) return fail("range");

  if (key === "advertIntervalMinutes") return { ok: true, value: Math.round(n / 2) * 2 };
  if (key === "agcResetInterval") return { ok: true, value: n === 0 ? 0 : Math.max(4, n - (n % 4)) };
  if (key === "rxdelay") return { ok: true, value: Math.round(n * 10) / 10 };
  return { ok: true, value: n };
}

/**
 * `password …` line for the admin password field, or null when it is empty.
 * The firmware never reveals the current password, so an empty field must
 * leave it alone rather than reset it to the factory "password".
 */
export function adminPasswordCliLine(value: string): string | null {
  const pw = String(value || "").trim();
  return pw ? `password ${pw}` : null;
}

/** #BEmesh recommended settings applied via the recommendation dialog. */
export const RECOMMENDED_SETTINGS = {
  radioPresetName: BEMESH_PRESET_TITLE,
  dutycycle: "10",
  floodAdvertHours: 47,
  advertIntervalMinutes: 0,
  floodMax: 64,
  pathHashMode: "1",
  loopDetect: "minimal",
};

/** Flood hop allowance presets: [flood.max.unscoped, flood.max.advert]. */
export const FLOOD_ALLOWANCE = {
  minimal: [4, 6],
  average: [8, 12],
  extended: [16, 24],
  full: [64, 64],
};
