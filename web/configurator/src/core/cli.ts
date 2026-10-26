/**
 * The command script for a plan, in the old page's order (buildConfiguratorSections and
 * buildGeneralSettingsCli): name, settings, location, regions, then the access list.
 */
import en from "../i18n/en.json";
import { aclLines } from "./acl";
import { same, sameRadio } from "./blocks";
import { encodeOwnerInfo } from "./naming";
import {
  formatRadio,
  isFirmwareDefault,
  radioIsFirmwareDefault,
  sendableLocation,
  sendableName,
  settingValue,
  type DeviceSnapshot,
  type Plan,
} from "./plan";
import { expectedRegions, policyFor, regionCommandLines, regionsMatch, type DeviceRegions } from "./regions";
import type { Place } from "./search";
import { adminPasswordCliLine, SETTINGS, type SettingKey } from "./settings";

export type ScriptGroup = { titleKey: "name" | "settings" | "location" | "regions" | "acl"; lines: string[] };

/** The general settings in the old buildGeneralSettingsCli order (radio comes first). */
export const SETTINGS_ORDER: SettingKey[] = [
  "repeat",
  "ownerInfo",
  "adminPassword",
  "guestPassword",
  "dutycycle",
  "floodAdvertHours",
  "advertIntervalMinutes",
  "floodMaxUnscoped",
  "floodMaxAdvert",
  "floodMax",
  "pathHashMode",
  "loopDetect",
  "txdelay",
  "directTxdelay",
  "rxdelay",
  "radioRxgain",
  "txPower",
  "intThresh",
  "agcResetInterval",
  "multiAcks",
];

const CLI_KEY = new Map(SETTINGS.map((s) => [s.key, s.cliKey]));

/** One setting's line, or null. Invalid values (see planErrors) are never sent. */
function settingLine(plan: Plan, key: SettingKey, includeDefaults: boolean): string | null {
  const v = settingValue(plan, key);
  if (v === null) return null;
  const cli = CLI_KEY.get(key)!;
  switch (key) {
    // Never revealed by the firmware: sent only when entered.
    case "adminPassword":
      return adminPasswordCliLine(String(v));
    case "ownerInfo": {
      const text = String(v).trim();
      return text ? `set ${cli} ${encodeOwnerInfo(text)}` : null;
    }
    case "guestPassword": {
      const text = String(v).trim();
      return text ? `set ${cli} ${text}` : null;
    }
    case "txPower":
      return `set ${cli} ${v}`;
    default:
      return includeDefaults || !isFirmwareDefault(key, v) ? `set ${cli} ${v}` : null;
  }
}

/**
 * The repeater already holds this setting's value. The admin password is never read, so never
 * held; the duty cycle compares with the value read, not the snapped one; text compares as text.
 */
function settingHeld(plan: Plan, key: SettingKey, snapshot: DeviceSnapshot): boolean {
  const v = settingValue(plan, key);
  if (key === "adminPassword") return false;
  if (key === "dutycycle") return snapshot.dutycycleRaw !== undefined && same(v, snapshot.dutycycleRaw);
  if (!Object.prototype.hasOwnProperty.call(snapshot.settings, key)) return false;
  if (key === "guestPassword" || key === "ownerInfo") return String(v ?? "").trim() === String(snapshot.settings[key]).trim();
  return same(v, snapshot.settings[key]);
}

/**
 * The script as groups. Values equal to the firmware default are left out unless
 * includeDefaults; `device` (the regions read from the repeater) adds the region removals.
 * With `snapshot` (a Read of this repeater) every line whose value the repeater already holds
 * is left out, the regions go only when they differ (as a whole, and only with `device`), and
 * the access list group holds the `setperm` lines that turn the read list into the plan's.
 */
export function buildScript(
  plan: Plan,
  places: Place[],
  opts: { includeDefaults: boolean; device?: DeviceRegions; snapshot?: DeviceSnapshot },
): ScriptGroup[] {
  const { includeDefaults, snapshot: snap } = opts;
  const name = sendableName(plan);

  const settings: string[] = [];
  const radioHeld = !!snap?.radio && sameRadio(plan.radio, snap.radio);
  if ((includeDefaults || !radioIsFirmwareDefault(plan.radio)) && !radioHeld) {
    settings.push(`set radio ${formatRadio(plan.radio)}`);
  }
  for (const key of SETTINGS_ORDER) {
    const line = settingLine(plan, key, includeDefaults);
    if (line && !(snap && settingHeld(plan, key, snap))) settings.push(line);
  }

  const location: string[] = [];
  const coords = sendableLocation(plan);
  const coordsHeld = !!snap && !!coords && same(coords.lat, snap.lat) && same(coords.lon, snap.lon);
  if (coords && !coordsHeld) location.push(`set lat ${coords.lat}`, `set lon ${coords.lon}`);
  if ((includeDefaults || plan.advertLoc !== "prefs") && plan.advertLoc !== snap?.advertLoc) {
    location.push(`gps advert ${plan.advertLoc}`);
  }

  let regions: string[] = [];
  if (plan.anchor) {
    const policy = plan.regions ?? policyFor(plan.anchor, places);
    const held =
      !!snap?.regions &&
      !!opts.device &&
      regionsMatch(expectedRegions(plan.anchor, policy, places), snap.regions, opts.device);
    if (!held) regions = regionCommandLines(plan.anchor, policy, places, opts.device);
  }

  const groups: ScriptGroup[] = [
    { titleKey: "name", lines: name && name !== snap?.name ? [`set name ${name}`] : [] },
    { titleKey: "settings", lines: settings },
    { titleKey: "location", lines: location },
    { titleKey: "regions", lines: regions },
  ];
  if (snap?.acl && plan.acl) groups.push({ titleKey: "acl", lines: aclLines(snap.acl, plan.acl) });
  return groups.filter((g) => g.lines.length > 0);
}

/** The name, settings and location lines of the full script (every setting) that the snapshot leaves out. */
export function unchangedCount(plan: Plan, places: Place[], snapshot: DeviceSnapshot): number {
  const count = (groups: ScriptGroup[]) =>
    groups.filter((g) => g.titleKey !== "regions" && g.titleKey !== "acl").reduce((n, g) => n + g.lines.length, 0);
  return (
    count(buildScript(plan, places, { includeDefaults: true })) -
    count(buildScript(plan, places, { includeDefaults: true, snapshot }))
  );
}

const GROUP_TITLES = en as Record<string, string>;

/** The script text: a `# <title>` comment above each group, groups separated by a blank line. */
export function scriptText(
  groups: ScriptGroup[],
  title: (key: ScriptGroup["titleKey"]) => string = (k) => GROUP_TITLES[`script.group.${k}`] ?? k,
): string {
  return groups.map((g) => [`# ${title(g.titleKey)}`, ...g.lines].join("\n")).join("\n\n");
}

/** The lines Apply sends: no comments, no blank lines. */
export function commandLines(groups: ScriptGroup[]): string[] {
  return groups
    .flatMap((g) => g.lines)
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("#"));
}
