/**
 * The plan (what the user wants on the repeater), the device snapshot a Read gives, the port of
 * the old page's read parsing (applyReadResultsToForm and its helpers) and the change summary.
 */
import { PROVINCE_NAMES } from "./be-regions";
import {
  buildName,
  buildPrefix,
  checkName,
  splitNameSuffixAndEmoji,
  type PowerEmoji,
  type PrefixFormat,
} from "./naming";
import { BEMESH_PRESET_TITLE, FIRMWARE_DEFAULT_RADIO, RADIO_PRESETS } from "./presets";
import {
  defaultRegionCode,
  deviceRegionsFromRead,
  HOME_OVERRIDE_OMIT,
  homeRegionCode,
  policyFor,
  policyFromDevice,
  regionsByState,
  type Anchor,
  type DeviceRegions,
  type RegionPolicy,
} from "./regions";
import type { Place } from "./search";
import { SETTINGS, validateSetting, type SettingKey } from "./settings";

export type Radio = { freq: number; sf: number; bw: number; cr: number };
export type AdvertLoc = "none" | "prefs" | "share";

export type Plan = {
  location: { lat: number; lon: number } | null;
  anchor: Anchor | null;
  advertLoc: AdvertLoc;
  prefixFormat: PrefixFormat;
  nameSuffix: string;
  power: PowerEmoji;
  radio: Radio;
  settings: Partial<Record<SettingKey, string | number>>;
  regions: RegionPolicy | null;
};

export type DeviceSnapshot = {
  name?: string;
  radio?: Plan["radio"];
  settings: Partial<Record<SettingKey, string | number>>;
  lat?: number;
  lon?: number;
  advertLoc?: Plan["advertLoc"];
  regions?: { home?: string; default?: string; allowed: string[]; denied: string[] };
  version?: string;
  role?: string;
  publicKey?: string;
  clock?: string;
  missing: string[];
};

const BY_KEY = new Map(SETTINGS.map((s) => [s.key, s]));
const BEMESH_RADIO = RADIO_PRESETS.find((p) => p.title === BEMESH_PRESET_TITLE)!;

/** The untouched old page: #BEmesh form defaults on the EU/UK Narrow radio, no location yet. */
export function defaultPlan(): Plan {
  const settings: Plan["settings"] = {};
  for (const s of SETTINGS) if (s.formDefault !== null) settings[s.key] = s.formDefault;
  return {
    location: null,
    anchor: null,
    advertLoc: "prefs",
    prefixFormat: "city",
    nameSuffix: "",
    power: "",
    radio: { freq: BEMESH_RADIO.freq, sf: BEMESH_RADIO.sf, bw: BEMESH_RADIO.bw, cr: BEMESH_RADIO.cr },
    settings,
    regions: null,
  };
}

// ---------------------------------------------------------------------------
// Derived values shared by the script builder and the summary

const FORMATS_FOR: Record<Anchor["mode"], PrefixFormat[]> = {
  city: ["city", "province", "country", "none"],
  province: ["province", "country", "none"],
  country: ["country", "none"],
};

/** Name prefix for the plan: empty without a location; a format the anchor lacks falls back to its own level. */
export function planPrefix(plan: Plan): string {
  const a = plan.anchor;
  if (!a) return "";
  const format = FORMATS_FOR[a.mode].includes(plan.prefixFormat) ? plan.prefixFormat : a.mode;
  return buildPrefix(format, a.place, a.province_code);
}

export function planName(plan: Plan): string {
  return buildName(planPrefix(plan), plan.nameSuffix, plan.power);
}

/** The name `set name` sends, or null when there is no suffix or the name breaks a firmware limit. */
export function sendableName(plan: Plan): string | null {
  if (!plan.nameSuffix.trim()) return null;
  const name = planName(plan);
  return checkName(name, plan.advertLoc !== "none").ok ? name : null;
}

/** Valid repeater coordinates: finite, and not the firmware's unset 0,0. */
export function hasValidCoords(lat: unknown, lon: unknown): boolean {
  return (
    typeof lat === "number" &&
    typeof lon === "number" &&
    Number.isFinite(lat) &&
    Number.isFinite(lon) &&
    !(lat === 0 && lon === 0)
  );
}

/**
 * A setting as the script uses it: the plan value (the form default when absent) normalised by
 * validateSetting; an invalid value is returned as entered. txPower without a value is null.
 */
export function settingValue(plan: Plan, key: SettingKey): string | number | null {
  const def = BY_KEY.get(key)!;
  const raw = plan.settings[key] ?? def.formDefault;
  if (raw === null || raw === undefined) return null;
  const r = validateSetting(key, String(raw));
  return r.ok ? r.value : raw;
}

/** Equal to the old page's firmware default table (numbers compared as numbers). */
export function isFirmwareDefault(key: SettingKey, value: string | number | null): boolean {
  const fw = BY_KEY.get(key)!.firmwareDefault;
  if (fw === null || value === null) return false;
  if (typeof fw === "number") return Math.abs(Number(value) - fw) < 1e-9;
  return String(value) === fw;
}

const round3 = (n: number) => Math.round(n * 1000) / 1000;

export function radioIsFirmwareDefault(r: Radio): boolean {
  const d = FIRMWARE_DEFAULT_RADIO;
  return round3(r.freq) === round3(d.freq) && round3(r.bw) === round3(d.bw) && r.sf === d.sf && r.cr === d.cr;
}

/** `freq,bw,sf,cr` as `set radio` takes it (bw with at most 3 decimals). */
export function formatRadio(r: Radio): string {
  return `${r.freq},${round3(r.bw)},${r.sf},${r.cr}`;
}

// ---------------------------------------------------------------------------
// Device read

/** Old stripCliReply: drop the firmware's leading `> ` and surrounding space. */
const strip = (reply: string) =>
  String(reply || "")
    .replace(/^\s*>\s*/, "")
    .trim();

const intOf = (s: string) => {
  const n = parseInt(s, 10);
  return Number.isFinite(n) ? n : undefined;
};
const floatOf = (s: string) => {
  const n = parseFloat(s);
  return Number.isFinite(n) ? n : undefined;
};

function parseRadio(s: string): Radio | undefined {
  const parts = s.split(",");
  if (parts.length < 4) return undefined;
  const r = {
    freq: parseFloat(parts[0]),
    bw: parseFloat(parts[1]),
    sf: parseInt(parts[2], 10),
    cr: parseInt(parts[3], 10),
  };
  if (![r.freq, r.bw, r.sf, r.cr].every(Number.isFinite)) return undefined;
  return { freq: r.freq, sf: r.sf, bw: r.bw, cr: r.cr };
}

/** Old snapDutycycleSelect: the nearest of the offered options. */
function snapDutycycle(s: string): string | undefined {
  const v = parseFloat(s.replace(/%$/, ""));
  if (!Number.isFinite(v)) return undefined;
  const options = [1, 10, 50, 100];
  return String(options.reduce((best, o) => (Math.abs(v - o) < Math.abs(v - best) ? o : best)));
}

function parseRegionList(s: string): string[] {
  if (!s || s === "-none-") return [];
  return s
    .split(",")
    .map((p) => p.trim())
    .filter(Boolean);
}

/** `home is X` / `default scope is X`; an unexpected reply is kept as is (old parseRegion*Name || value). */
const afterPrefix = (s: string, re: RegExp) => {
  const m = s.match(re);
  return m ? m[1].trim() || s : s;
};

type SettingParser = (s: string) => string | number | undefined;
const oneOf =
  (key: SettingKey): SettingParser =>
  (s) =>
    BY_KEY.get(key)!.options!.includes(s) ? s : undefined;

/** How each `get …` reply becomes a setting value (port of the applyReadResultsToForm branches). */
const SETTING_PARSERS: Partial<Record<SettingKey, SettingParser>> = {
  repeat: oneOf("repeat"),
  // The firmware sends newlines as '|'.
  ownerInfo: (s) => s.replace(/\|/g, "\n"),
  guestPassword: (s) => s,
  dutycycle: snapDutycycle,
  floodAdvertHours: intOf,
  // `get advert.interval` replies in minutes, the unit `set advert.interval` takes.
  advertIntervalMinutes: intOf,
  floodMaxUnscoped: intOf,
  floodMaxAdvert: intOf,
  floodMax: intOf,
  pathHashMode: oneOf("pathHashMode"),
  loopDetect: oneOf("loopDetect"),
  txdelay: floatOf,
  directTxdelay: floatOf,
  rxdelay: floatOf,
  radioRxgain: oneOf("radioRxgain"),
  txPower: intOf,
  intThresh: intOf,
  agcResetInterval: intOf,
  multiAcks: oneOf("multiAcks"),
};

/**
 * A snapshot from the replies to the read commands (command → raw reply). Commands without a
 * reply are left out; `missing` lists the commands the caller could not read. Replies that do
 * not parse leave their field unset.
 */
export function snapshotFromReplies(replies: Record<string, string>, missing: string[] = []): DeviceSnapshot {
  const get = (cmd: string) => (Object.prototype.hasOwnProperty.call(replies, cmd) ? strip(replies[cmd]) : undefined);
  const s: DeviceSnapshot = { settings: {}, missing: [...missing] };

  const name = get("get name");
  if (name !== undefined) s.name = name;
  const radio = get("get radio");
  if (radio !== undefined) s.radio = parseRadio(radio);
  if (!s.radio) delete s.radio;

  for (const def of SETTINGS) {
    const parse = SETTING_PARSERS[def.key];
    const reply = def.readCmd ? get(def.readCmd) : undefined;
    if (!parse || reply === undefined) continue;
    const v = parse(reply);
    if (v !== undefined) s.settings[def.key] = v;
  }

  const lat = get("get lat");
  const lon = get("get lon");
  if (lat !== undefined) s.lat = parseFloat(lat);
  if (lon !== undefined) s.lon = parseFloat(lon);
  const gps = get("gps advert");
  if (gps === "none" || gps === "prefs" || gps === "share") s.advertLoc = gps;

  const home = get("region home");
  const def = get("region default");
  const allowed = get("region list allowed");
  const denied = get("region list denied");
  if ([home, def, allowed, denied].some((v) => v !== undefined)) {
    s.regions = {
      ...(home !== undefined ? { home: afterPrefix(home, /^home is\s+(.+)$/i) } : {}),
      ...(def !== undefined ? { default: afterPrefix(def, /^default scope is\s+(.+)$/i) } : {}),
      allowed: allowed !== undefined ? parseRegionList(allowed) : [],
      denied: denied !== undefined ? parseRegionList(denied) : [],
    };
  }

  const version = get("ver");
  const role = get("get role");
  const publicKey = get("get public.key");
  const clock = get("clock");
  if (version !== undefined) s.version = version;
  if (role !== undefined) s.role = role;
  if (publicKey !== undefined) s.publicKey = publicKey;
  if (clock !== undefined) s.clock = clock;
  return s;
}

/** The device's regions for the script's removals (pass as buildScript's `device`). */
export function deviceRegionsFromSnapshot(s: DeviceSnapshot): DeviceRegions | undefined {
  const r = s.regions;
  return r ? deviceRegionsFromRead(r.allowed, r.denied, r.home ?? null, r.default ?? null) : undefined;
}

type Detection = { anchor: Anchor; format: PrefixFormat };

const cityAnchor = (place: Place): Anchor => ({ mode: "city", province_code: place.province_code, place });
const provinceAnchor = (code: string): Anchor => ({ mode: "province", province_code: code, place: null });
const COUNTRY: Anchor = { mode: "country", province_code: null, place: null };

/** Old detectLocationFromDeviceName: a BE-XXX- city prefix first, then a province, then BE-. */
function detectFromName(name: string, places: Place[]): Detection | null {
  const nameU = name.trim().toUpperCase();
  if (!nameU.startsWith("BE-")) return null;
  for (const place of places) {
    const prefix = buildPrefix("city", place, null);
    if (prefix && nameU.startsWith(prefix.toUpperCase())) return { anchor: cityAnchor(place), format: "city" };
  }
  for (const code of Object.keys(PROVINCE_NAMES)) {
    const prefix = buildPrefix("province", null, code);
    if (prefix && nameU.startsWith(prefix.toUpperCase())) return { anchor: provinceAnchor(code), format: "province" };
  }
  if (/^BE-[A-Z0-9]{2,5}-/i.test(name.trim())) return null;
  return { anchor: COUNTRY, format: "country" };
}

/** Old detectLocationFromRegionHints: the region home, then the allow list — a city, a province, then be. */
function detectFromRegions(home: string | undefined, allowed: string[], places: Place[]): Detection | null {
  const ordered: string[] = [];
  for (const raw of [home, ...allowed]) {
    const c = String(raw || "").trim();
    if (c && c !== "*" && !ordered.includes(c)) ordered.push(c);
  }
  for (const c of ordered) {
    const place = places.find((p) => p.city_code === c);
    if (place) return { anchor: cityAnchor(place), format: "city" };
  }
  const pc = ordered.find((c) => Object.prototype.hasOwnProperty.call(PROVINCE_NAMES, c));
  if (pc) return { anchor: provinceAnchor(pc), format: "province" };
  if (ordered.includes("be")) return { anchor: COUNTRY, format: "country" };
  return null;
}

/**
 * The plan a device read gives, starting from defaultPlan() (port of applyReadResultsToForm):
 * location from the name prefix or else the region hints, the name suffix and power emoji,
 * radio, settings, coordinates, advert location and the region policy. A name that does not
 * start with the detected prefix is kept whole (prefix format "none").
 */
export function planFromSnapshot(s: DeviceSnapshot, places: Place[]): Plan {
  const plan = defaultPlan();
  const name = (s.name ?? "").trim();
  const detection =
    (name ? detectFromName(name, places) : null) ||
    (s.regions ? detectFromRegions(s.regions.home, s.regions.allowed, places) : null);
  if (detection) {
    plan.anchor = detection.anchor;
    plan.prefixFormat = detection.format;
  }

  if (name) {
    const prefix = planPrefix(plan);
    let rest = name;
    if (prefix) {
      if (name.toUpperCase().startsWith(prefix.toUpperCase())) rest = name.slice(prefix.length);
      else plan.prefixFormat = "none";
    }
    const { suffix, power } = splitNameSuffixAndEmoji(rest);
    plan.nameSuffix = suffix;
    plan.power = power;
  }

  if (s.radio) plan.radio = { ...s.radio };
  plan.settings = { ...plan.settings, ...s.settings };
  if (hasValidCoords(s.lat, s.lon)) plan.location = { lat: s.lat!, lon: s.lon! };
  if (s.advertLoc) plan.advertLoc = s.advertLoc;
  if (plan.anchor) {
    plan.regions = s.regions ? policyFromDevice(plan.anchor, places, s.regions) : policyFor(plan.anchor, places);
  }
  return plan;
}

// ---------------------------------------------------------------------------
// Summary

export type Change = {
  group: "name" | "settings" | "location" | "regions";
  labelKey: string;
  to: string;
  from?: string;
};

const coords = (lat: number, lon: number) => `${lat}, ${lon}`;

/**
 * What the plan changes. Against a snapshot: each value that differs from the device (a value
 * the device did not report counts as a change when the script sets it). Without one: what the
 * script sets. The admin password is never listed; it is reported as kept or changed.
 */
export function summarize(
  plan: Plan,
  snapshot?: DeviceSnapshot,
): { changes: Change[]; adminPassword: "kept" | "changed" } {
  const changes: Change[] = [];
  const add = (group: Change["group"], labelKey: string, to: string, from: string | undefined, sent: boolean) => {
    if (from !== undefined ? from === to : !sent) return;
    changes.push(from !== undefined ? { group, labelKey, from, to } : { group, labelKey, to });
  };

  const name = sendableName(plan);
  if (name) add("name", "name", name, snapshot?.name, true);

  add(
    "settings",
    "radio",
    formatRadio(plan.radio),
    snapshot?.radio && formatRadio(snapshot.radio),
    !radioIsFirmwareDefault(plan.radio),
  );
  for (const def of SETTINGS) {
    if (def.key === "adminPassword") continue;
    const v = settingValue(plan, def.key);
    // No value means the script leaves it alone (txPower).
    if (v === null) continue;
    const text = String(v).trim();
    const sent = def.firmwareDefault === null ? text !== "" : !isFirmwareDefault(def.key, v);
    const from = snapshot?.settings[def.key];
    add("settings", def.key, text, from === undefined ? undefined : String(from).trim(), sent);
  }

  if (plan.location) {
    const { lat, lon } = plan.location;
    const from =
      snapshot && hasValidCoords(snapshot.lat, snapshot.lon) ? coords(snapshot.lat!, snapshot.lon!) : undefined;
    add("location", "location", coords(lat, lon), from, true);
  }
  add("location", "advertLoc", plan.advertLoc, snapshot?.advertLoc, plan.advertLoc !== "prefs");

  if (plan.anchor && plan.regions) {
    const p = plan.regions;
    const dev = snapshot?.regions;
    const { allowed, denied } = regionsByState(p);
    const list = (codes: string[]) =>
      codes
        .filter((c) => c !== "*")
        .sort()
        .join(", ");
    add("regions", "regionsAllowed", list(allowed), dev && list([...dev.allowed]), allowed.length > 0);
    add("regions", "regionsDenied", list(denied), dev && list([...dev.denied]), denied.length > 0);
    const flood = p.untaggedFlood ? "on" : "off";
    add("regions", "untaggedFlood", flood, dev && (dev.allowed.includes("*") ? "on" : "off"), !p.untaggedFlood);
    if (p.homeOverride !== HOME_OVERRIDE_OMIT) add("regions", "regionHome", homeRegionCode(p) ?? "*", dev?.home, true);
    add("regions", "regionDefault", defaultRegionCode(p) ?? "<null>", dev?.default, true);
  }

  const pw = String(plan.settings.adminPassword ?? "").trim();
  return { changes, adminPassword: pw ? "changed" : "kept" };
}
