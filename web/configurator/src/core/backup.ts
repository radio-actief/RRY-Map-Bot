/**
 * Backup files: v2 holds the plan; v1 is the old page's export (form field ids → values),
 * which still imports.
 */
import { hasControlChars, POWER_EMOJIS, prefixFormatFromLegacy, type PowerEmoji } from "./naming";
import { defaultPlan, hasValidCoords, type Plan, type Radio } from "./plan";
import { checkRadioValue, RADIO_FIELD_SPECS, type RadioFieldId } from "./presets";
import { anchorFromChoice, applyLegacyPolicyFields, policyFor } from "./regions";
import { locationChoices, type Place } from "./search";
import { validateSetting, type SettingKey } from "./settings";

const APP = "bemesh-configurator";
const VERSION = 2;

/** Thrown for a file that is not a configurator backup; `key` is the en.json message key. */
export class BackupError extends Error {
  constructor(public readonly key: "backup.error.unknown" | "backup.error.newer" | "backup.error.invalid") {
    super(key);
    this.name = "BackupError";
  }
}

/** The backup file for a plan; the access list is left out, as it belongs to one repeater. */
export function exportBackup(plan: Plan): { app: string; version: number; plan: Plan } {
  const { acl: _acl, ...rest } = plan;
  return { app: APP, version: VERSION, plan: structuredClone(rest) };
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

export function importBackup(json: unknown, places: Place[]): Plan {
  if (!isObject(json) || json.app !== APP || typeof json.version !== "number")
    throw new BackupError("backup.error.unknown");
  if (json.version > VERSION) throw new BackupError("backup.error.newer");
  if (json.version === VERSION) return withoutLowDutycycle(planFromV2(json.plan));
  if (json.version === 1 && isObject(json.fields)) return withoutLowDutycycle(planFromV1(json.fields, places));
  throw new BackupError("backup.error.invalid");
}

/** Older backups may hold 1 %; the firmware raises anything under 10 % to 10 % at every start. */
function withoutLowDutycycle(plan: Plan): Plan {
  if (plan.settings.dutycycle !== "1") return plan;
  return { ...plan, settings: { ...plan.settings, dutycycle: "10" } };
}

const isNum = (v: unknown) => typeof v === "number" && Number.isFinite(v);

/**
 * Whether any string in `v` (at any depth) holds a control character. The firmware ends a command
 * at CR, so such a value would run its tail as a command of its own; `newlineOk` allows newlines.
 */
function controlText(v: unknown, newlineOk = false): boolean {
  if (typeof v === "string") return hasControlChars(v, newlineOk);
  if (Array.isArray(v)) return v.some((x) => controlText(x));
  if (isObject(v)) return Object.values(v).some((x) => controlText(x));
  return false;
}
const oneOf = (v: unknown, values: readonly unknown[]) => values.includes(v);

function validAnchor(a: unknown): boolean {
  if (a === null) return true;
  return (
    isObject(a) &&
    oneOf(a.mode, ["city", "province", "country"]) &&
    (a.province_code === null || typeof a.province_code === "string") &&
    (a.mode === "city" ? isObject(a.place) && typeof a.place.city_code === "string" : a.place === null)
  );
}

const REGION_CODE = /^[a-z0-9-]{1,30}$/;

/** A free region row needs a valid region code and a parent that is a valid code or null (top level). */
function validFreeRow(r: unknown): boolean {
  if (!isObject(r) || r.group !== "free") return true;
  return (
    typeof r.code === "string" &&
    REGION_CODE.test(r.code) &&
    (r.parent === null || (typeof r.parent === "string" && REGION_CODE.test(r.parent)))
  );
}

/** Each free row's code is on no other row. */
function uniqueFreeCodes(rows: unknown[]): boolean {
  const codes = rows.map((r) => (isObject(r) ? r.code : undefined));
  const once = (code: unknown) => codes.filter((c) => c === code).length === 1;
  return rows.every((r) => !isObject(r) || r.group !== "free" || once(r.code));
}

function planFromV2(raw: unknown): Plan {
  const ok =
    isObject(raw) &&
    isObject(raw.radio) &&
    ["freq", "sf", "bw", "cr"].every((k) => isNum((raw.radio as Record<string, unknown>)[k])) &&
    isObject(raw.settings) &&
    typeof raw.nameSuffix === "string" &&
    oneOf(raw.power, ["", ...POWER_EMOJIS]) &&
    oneOf(raw.prefixFormat, ["city", "province", "country", "none"]) &&
    oneOf(raw.advertLoc, ["none", "prefs", "share"]) &&
    (raw.location === null || (isObject(raw.location) && isNum(raw.location.lat) && isNum(raw.location.lon))) &&
    validAnchor(raw.anchor) &&
    (raw.regions === null ||
      (isObject(raw.regions) &&
        Array.isArray(raw.regions.rows) &&
        raw.regions.rows.every(validFreeRow) &&
        uniqueFreeCodes(raw.regions.rows)));
  if (!ok) throw new BackupError("backup.error.invalid");
  // Owner info may hold newlines (sent as '|'); nothing else may hold a control character.
  const { settings, ...rest } = raw;
  const badSetting = Object.entries(settings as Record<string, unknown>).some(([k, v]) =>
    controlText(v, k === "ownerInfo"),
  );
  if (badSetting || controlText(rest)) throw new BackupError("backup.error.invalid");
  const { acl: _acl, ...plan } = structuredClone(raw) as Plan;
  return plan;
}

// ---------------------------------------------------------------------------
// v1 (old page field ids)

/** Old form field id → setting key. */
const V1_SETTINGS: [string, SettingKey][] = [
  ["setting-repeat", "repeat"],
  ["setting-owner-info", "ownerInfo"],
  ["setting-admin-password", "adminPassword"],
  ["setting-guest-password", "guestPassword"],
  ["setting-dutycycle", "dutycycle"],
  ["setting-flood-advert-interval", "floodAdvertHours"],
  ["setting-advert-interval", "advertIntervalMinutes"],
  ["setting-flood-max-unscoped", "floodMaxUnscoped"],
  ["setting-flood-max-advert", "floodMaxAdvert"],
  ["setting-flood-max", "floodMax"],
  ["setting-path-hash-mode", "pathHashMode"],
  ["setting-loop-detect", "loopDetect"],
  ["setting-txdelay", "txdelay"],
  ["setting-direct-txdelay", "directTxdelay"],
  ["setting-rxdelay", "rxdelay"],
  ["setting-radio-rxgain", "radioRxgain"],
  ["setting-radio-txpower", "txPower"],
  ["setting-int-thresh", "intThresh"],
  ["setting-agc-reset", "agcResetInterval"],
  ["setting-multi-acks", "multiAcks"],
];

/**
 * The previous configurator page's radio preset list, in its order:
 * a v1 `setting-radio-preset` value is an index into this list, not into RADIO_PRESETS.
 */
const LEGACY_RADIO_PRESETS: Radio[] = [
  { freq: 915.8, sf: 10, bw: 250, cr: 5 }, // Australia
  { freq: 916.675, sf: 7, bw: 62.5, cr: 8 }, // Australia: Victoria
  { freq: 869.618, sf: 8, bw: 62.5, cr: 8 }, // EU/UK (Narrow)
  { freq: 869.525, sf: 11, bw: 250, cr: 5 }, // EU/UK (Long Range)
  { freq: 869.525, sf: 10, bw: 250, cr: 5 }, // EU/UK (Medium Range)
  { freq: 869.525, sf: 7, bw: 62.5, cr: 5 }, // Czech Republic (Narrow)
  { freq: 433.65, sf: 11, bw: 250, cr: 5 }, // EU 433MHz (Long Range)
  { freq: 917.375, sf: 11, bw: 250, cr: 5 }, // New Zealand
  { freq: 917.375, sf: 7, bw: 62.5, cr: 5 }, // New Zealand (Narrow)
  { freq: 433.375, sf: 9, bw: 62.5, cr: 6 }, // Portugal 433
  { freq: 869.618, sf: 7, bw: 62.5, cr: 6 }, // Portugal 868
  { freq: 910.525, sf: 7, bw: 62.5, cr: 5 }, // USA/Canada (Recommended)
  { freq: 920.25, sf: 11, bw: 250, cr: 5 }, // Vietnam
];

/** Old parseCoordInput: a decimal comma is accepted. */
function coord(raw: unknown): number | null {
  const text = String(raw ?? "")
    .trim()
    .replace(",", ".");
  if (!text) return null;
  const n = Number(text);
  return Number.isFinite(n) ? n : null;
}

/**
 * The radio the old page used (getRadioSettings): the four radio fields for the "custom"
 * preset, else the old preset at that index (stale field values ignored). Null when that
 * gives nothing valid. The UI matches the values to RADIO_PRESETS (custom when none fits).
 */
function radioFromV1(f: Record<string, unknown>): Radio | null {
  const preset = String(f["setting-radio-preset"] ?? "");
  if (preset === "custom") return radioFromFields(f);
  const p = /^\d+$/.test(preset) ? LEGACY_RADIO_PRESETS[Number(preset)] : undefined;
  return p ? { ...p } : null;
}

/** Old RADIO_FIELD_SPECS: all four fields must be valid, or none is used. */
function radioFromFields(f: Record<string, unknown>): Radio | null {
  const num = (id: string, field: RadioFieldId) => {
    const raw = String(f[id] ?? "").trim();
    if (!raw) return null;
    const v = RADIO_FIELD_SPECS[field].integer ? parseInt(raw, 10) : parseFloat(raw);
    return checkRadioValue(field, v);
  };
  const freq = num("setting-radio-freq", "freq");
  const sf = num("setting-radio-sf", "sf");
  const bw = num("setting-radio-bw", "bw");
  const cr = num("setting-radio-cr", "cr");
  if (freq === null || sf === null || bw === null || cr === null) return null;
  return { freq, sf, bw, cr };
}

/**
 * The plan an old page export describes. The location is the first search choice for the
 * `city-search` text; the radio follows radioFromV1 (the plan's EU/UK Narrow when it gives none).
 */
function planFromV1(f: Record<string, unknown>, places: Place[]): Plan {
  if (Object.entries(f).some(([id, v]) => controlText(v, id === "setting-owner-info"))) {
    throw new BackupError("backup.error.invalid");
  }
  const plan = defaultPlan();
  const text = (id: string) => (typeof f[id] === "string" ? (f[id] as string) : "");

  const choice = locationChoices(text("city-search"), places)[0];
  plan.anchor = choice ? anchorFromChoice(choice) : null;
  const lat = coord(f["setting-lat"]);
  const lon = coord(f["setting-lon"]);
  plan.location = hasValidCoords(lat, lon) ? { lat: lat!, lon: lon! } : null;
  const loc = text("setting-advert-loc");
  if (loc === "none" || loc === "prefs" || loc === "share") plan.advertLoc = loc;

  if (text("name-location-mode")) plan.prefixFormat = prefixFormatFromLegacy(text("name-location-mode"));
  plan.nameSuffix = text("name-suffix");
  const power = text("name-power-emoji") as PowerEmoji;
  plan.power = POWER_EMOJIS.includes(power as Exclude<PowerEmoji, "">) ? power : "";

  plan.radio = radioFromV1(f) ?? plan.radio;

  for (const [id, key] of V1_SETTINGS) {
    if (!Object.prototype.hasOwnProperty.call(f, id)) continue;
    const raw = String(f[id] ?? "");
    const r = validateSetting(key, raw);
    if (!r.ok) plan.settings[key] = raw;
    else if (r.value === null) delete plan.settings[key];
    else plan.settings[key] = r.value;
  }

  plan.regions = plan.anchor ? applyLegacyPolicyFields(policyFor(plan.anchor, places), f) : null;
  return plan;
}
