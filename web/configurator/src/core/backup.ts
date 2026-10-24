/**
 * Backup files: v2 holds the plan; v1 is the old page's export (form field ids → values),
 * which still imports.
 */
import type { PowerEmoji } from "./naming";
import { prefixFormatFromLegacy } from "./naming";
import { defaultPlan, hasValidCoords, type Plan, type Radio } from "./plan";
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

export function exportBackup(plan: Plan): { app: string; version: number; plan: Plan } {
  return { app: APP, version: VERSION, plan: structuredClone(plan) };
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

export function importBackup(json: unknown, places: Place[]): Plan {
  if (!isObject(json) || json.app !== APP || typeof json.version !== "number")
    throw new BackupError("backup.error.unknown");
  if (json.version > VERSION) throw new BackupError("backup.error.newer");
  if (json.version === VERSION) return planFromV2(json.plan);
  if (json.version === 1 && isObject(json.fields)) return planFromV1(json.fields, places);
  throw new BackupError("backup.error.invalid");
}

function planFromV2(raw: unknown): Plan {
  const ok =
    isObject(raw) &&
    isObject(raw.radio) &&
    ["freq", "sf", "bw", "cr"].every((k) => typeof (raw.radio as Record<string, unknown>)[k] === "number") &&
    isObject(raw.settings) &&
    typeof raw.nameSuffix === "string" &&
    typeof raw.power === "string" &&
    typeof raw.prefixFormat === "string" &&
    typeof raw.advertLoc === "string" &&
    (raw.location === null || isObject(raw.location)) &&
    (raw.anchor === null || isObject(raw.anchor)) &&
    (raw.regions === null || isObject(raw.regions));
  if (!ok) throw new BackupError("backup.error.invalid");
  return structuredClone(raw) as Plan;
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

const POWER: PowerEmoji[] = ["🌞", "⚡", "🔋", "👀"];

/** Old parseCoordInput: a decimal comma is accepted. */
function coord(raw: unknown): number | null {
  const text = String(raw ?? "")
    .trim()
    .replace(",", ".");
  if (!text) return null;
  const n = Number(text);
  return Number.isFinite(n) ? n : null;
}

/** Old RADIO_FIELD_SPECS: all four fields must be valid, or none is used. */
function radioFromFields(f: Record<string, unknown>): Radio | null {
  const num = (id: string, min: number, max: number, integer: boolean) => {
    const raw = String(f[id] ?? "").trim();
    if (!raw) return null;
    const v = integer ? parseInt(raw, 10) : parseFloat(raw);
    return Number.isFinite(v) && v >= min && v <= max ? v : null;
  };
  const freq = num("setting-radio-freq", 150, 2500, false);
  const sf = num("setting-radio-sf", 5, 12, true);
  const bw = num("setting-radio-bw", 7, 500, false);
  const cr = num("setting-radio-cr", 5, 8, true);
  if (freq === null || sf === null || bw === null || cr === null) return null;
  return { freq, sf, bw: Math.round(bw * 1000) / 1000, cr };
}

/**
 * The plan an old page export describes. The location is the first search choice for the
 * `city-search` text; `setting-radio-preset` indexes the old 13-entry preset list and is
 * ignored: the radio comes from the four radio fields (the plan's EU/UK Narrow when unset).
 */
function planFromV1(f: Record<string, unknown>, places: Place[]): Plan {
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
  plan.power = POWER.includes(power) ? power : "";

  plan.radio = radioFromFields(f) ?? plan.radio;

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
