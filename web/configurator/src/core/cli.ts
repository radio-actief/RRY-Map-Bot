/**
 * The command script for a plan, in the old page's order (buildConfiguratorSections and
 * buildGeneralSettingsCli): name, settings, location, regions.
 */
import en from "../i18n/en.json";
import { encodeOwnerInfo } from "./naming";
import {
  formatRadio,
  hasValidCoords,
  isFirmwareDefault,
  radioIsFirmwareDefault,
  sendableName,
  settingValue,
  type Plan,
} from "./plan";
import { policyFor, regionCommandLines, type DeviceRegions } from "./regions";
import type { Place } from "./search";
import { adminPasswordCliLine, SETTINGS, type SettingKey } from "./settings";

export type ScriptGroup = { titleKey: "name" | "settings" | "location" | "regions"; lines: string[] };

/** The general settings in the old buildGeneralSettingsCli order (radio comes first). */
const SETTINGS_ORDER: SettingKey[] = [
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

function settingLine(plan: Plan, key: SettingKey, includeDefaults: boolean): string | null {
  const v = settingValue(plan, key);
  const cli = CLI_KEY.get(key)!;
  switch (key) {
    // Never revealed by the firmware: sent only when entered.
    case "adminPassword":
      return adminPasswordCliLine(String(v ?? ""));
    case "ownerInfo":
    case "guestPassword": {
      const text = String(v ?? "").trim();
      if (!text) return null;
      return `set ${cli} ${key === "ownerInfo" ? encodeOwnerInfo(text) : text}`;
    }
    case "txPower":
      return v === null || v === "" ? null : `set ${cli} ${v}`;
    default:
      return includeDefaults || !isFirmwareDefault(key, v) ? `set ${cli} ${v}` : null;
  }
}

/**
 * The script as groups. Values equal to the firmware default are left out unless
 * includeDefaults; `device` (the regions read from the repeater) adds the region removals.
 */
export function buildScript(
  plan: Plan,
  places: Place[],
  opts: { includeDefaults: boolean; device?: DeviceRegions },
): ScriptGroup[] {
  const { includeDefaults } = opts;
  const name = sendableName(plan);

  const settings: string[] = [];
  if (includeDefaults || !radioIsFirmwareDefault(plan.radio)) settings.push(`set radio ${formatRadio(plan.radio)}`);
  for (const key of SETTINGS_ORDER) {
    const line = settingLine(plan, key, includeDefaults);
    if (line) settings.push(line);
  }

  const location: string[] = [];
  if (plan.location && hasValidCoords(plan.location.lat, plan.location.lon)) {
    location.push(`set lat ${plan.location.lat}`, `set lon ${plan.location.lon}`);
  }
  if (includeDefaults || plan.advertLoc !== "prefs") location.push(`gps advert ${plan.advertLoc}`);

  const regions = plan.anchor
    ? regionCommandLines(plan.anchor, plan.regions ?? policyFor(plan.anchor, places), places, opts.device)
    : [];

  const groups: ScriptGroup[] = [
    { titleKey: "name", lines: name ? [`set name ${name}`] : [] },
    { titleKey: "settings", lines: settings },
    { titleKey: "location", lines: location },
    { titleKey: "regions", lines: regions },
  ];
  return groups.filter((g) => g.lines.length > 0);
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
