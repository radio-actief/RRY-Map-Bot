/** Quick check-up: what differs between the plan and the #BEmesh recommendation, and applying it. */
import { t } from "../i18n/t";
import { allowanceOf, BLOCKS, blockKeys, rawOf, recommendedForAll, same, sameRadio } from "./blocks";
import { formatRadio, planName, planPrefix, prefixFormatsFor, type Plan } from "./plan";
import { defaultRegionCode, homeRegionCode, keepRows, policyFor, regionsByState, type RegionPolicy } from "./regions";
import type { Place } from "./search";
import { SETTINGS, type SettingKey } from "./settings";
import { SITE_PROFILES, siteOf, timingOf } from "./site";

export type CheckupGroup = "name" | "radio" | "advertising" | "repeating" | "regions" | "advanced";

export type CheckupLine = {
  id: string;
  group: CheckupGroup;
  labelKey: string;
  from: string;
  to: string;
  ticked: boolean;
  disabled?: boolean;
  noteKey?: string;
  detail?: { adds: string[]; denies: string[] };
  /** Regions line: the repeater's own regions the recommendation leaves out, each to keep or discard. */
  removable?: string[];
};

const HOPS: SettingKey[] = ["floodMaxUnscoped", "floodMaxAdvert"];
const TIMING: SettingKey[] = ["txdelay", "directTxdelay", "rxdelay"];
const BY_KEY = new Map(SETTINGS.map((d) => [d.key, d]));
/** The settings the check-up covers: those of the four blocks (no passwords, no owner info). */
const BLOCK_KEYS = new Set<string>(BLOCKS.flatMap(blockKeys));
/** A BE-…- prefix kept in the name's own part (old naming, or a place that is not the anchor). */
const OLD_PREFIX = /^BE-([A-Z0-9]{2,5}-)?/;

/** The plan with the anchor's recommended prefix; an old BE-…- prefix in the own part is dropped. */
function withRecommendedName(plan: Plan): Plan {
  if (!plan.anchor) return plan;
  const own = plan.nameSuffix.trim();
  const stripped = planPrefix(plan) ? own : own.replace(OLD_PREFIX, "");
  const nameSuffix = stripped && stripped !== own ? stripped : plan.nameSuffix;
  return { ...plan, prefixFormat: prefixFormatsFor(plan.anchor)[0], nameSuffix };
}

/** The recommendation the check-up compares with: every block, the name, and the default policy plus the own regions not discarded. */
function recommended(plan: Plan, places: Place[], discard: Set<string> = new Set()): Plan {
  const rec = recommendedForAll(plan);
  return plan.anchor ? withRecommendedName({ ...rec, regions: recommendedRegions(plan, places, discard) }) : rec;
}

function valueText(key: SettingKey, raw: string): string {
  return BY_KEY.get(key)!.options?.includes(raw) ? t(`opt.${key}.${raw}`) : raw;
}

function hopsText(plan: Plan): string {
  const pair = `(${rawOf(plan, "floodMaxUnscoped")} / ${rawOf(plan, "floodMaxAdvert")})`;
  const level = allowanceOf(plan);
  return level ? t(`settings.allowance.${level}`, { pair }) : t("checkup.hops.custom", { pair });
}

function timingText(plan: Plan): string {
  const timing = timingOf(plan);
  const choice = siteOf(timing);
  const site = choice in SITE_PROFILES ? t(`site.${choice}`) : t("site.custom");
  return t("checkup.timing.value", { site, tx: timing.txdelay, direct: timing.directTxdelay, rx: timing.rxdelay });
}

const homeText = (p: RegionPolicy | null) => (p ? (homeRegionCode(p) ?? "*") : t("settings.none"));

/** The codes a policy defines: rows with Allow or Deny, and every free row. */
const defined = (p: RegionPolicy | null) =>
  new Set((p?.rows ?? []).filter((r) => r.allow || r.deny || r.group === "free").map((r) => r.code));

const sameSet = (a: string[], b: string[]) => a.length === b.length && a.every((c) => b.includes(c));

function regionsDiffer(cur: RegionPolicy | null, rec: RegionPolicy): boolean {
  if (!cur) return true;
  const a = regionsByState(cur);
  const b = regionsByState(rec);
  return (
    !sameSet(a.allowed, b.allowed) ||
    !sameSet(a.denied, b.denied) ||
    homeRegionCode(cur) !== homeRegionCode(rec) ||
    defaultRegionCode(cur) !== defaultRegionCode(rec) ||
    cur.untaggedFlood !== rec.untaggedFlood
  );
}

/** The plan's regions the default policy leaves out. */
function removable(plan: Plan, policy: RegionPolicy): string[] {
  const inPolicy = defined(policy);
  return [...defined(plan.regions)].filter((c) => !inPolicy.has(c));
}

/** The default policy with the plan's own regions on top, except the discarded ones. */
function recommendedRegions(plan: Plan, places: Place[], discard: Set<string>): RegionPolicy {
  const policy = policyFor(plan.anchor!, places);
  if (!plan.regions) return policy;
  const keep = removable(plan, policy).filter((c) => !discard.has(c));
  return keep.length ? keepRows(policy, plan.regions, keep) : policy;
}

/** Kept regions that still go, because the region they depend on is discarded. */
export function regionsGoingToo(plan: Plan, places: Place[], discard: Set<string>): string[] {
  if (!plan.anchor || !plan.regions) return [];
  const after = defined(recommendedRegions(plan, places, discard));
  return removable(plan, policyFor(plan.anchor, places)).filter((c) => !discard.has(c) && !after.has(c));
}

/** Shown when the regions differ with every own region kept, or when there are own regions to discard. */
function regionsLine(plan: Plan, places: Place[]): CheckupLine | null {
  const base = { id: "regions", group: "regions" as const, labelKey: "summary.regionHome", from: homeText(plan.regions) };
  if (!plan.anchor) return { ...base, to: "", ticked: false, disabled: true, noteKey: "checkup.needLocation" };
  const policy = recommendedRegions(plan, places, new Set());
  const own = removable(plan, policyFor(plan.anchor, places));
  const differs = regionsDiffer(plan.regions, policy);
  if (!differs && !own.length) return null;
  const cur = plan.regions ? regionsByState(plan.regions) : { allowed: [], denied: [] };
  const next = regionsByState(policy);
  return {
    ...base,
    to: homeText(policy),
    ticked: differs,
    detail: {
      adds: next.allowed.filter((c) => !cur.allowed.includes(c)),
      denies: next.denied.filter((c) => !cur.denied.includes(c)),
    },
    ...(own.length ? { removable: own } : {}),
  };
}

/** Each difference between the plan and the #BEmesh recommendation, in group order. */
export function checkupLines(plan: Plan, places: Place[]): CheckupLine[] {
  const rec = recommended(plan, places);
  const lines: CheckupLine[] = [];
  if (plan.anchor && plan.nameSuffix.trim() && planName(plan) !== planName(rec)) {
    lines.push({
      id: "name",
      group: "name",
      labelKey: "summary.name",
      from: planName(plan),
      to: planName(rec),
      ticked: false,
      noteKey: "checkup.nameNote",
    });
  }
  const differs = (keys: SettingKey[]) => keys.some((k) => !same(rawOf(plan, k), rawOf(rec, k)));
  for (const block of BLOCKS) {
    if (block === "advanced") {
      const regions = regionsLine(plan, places);
      if (regions) lines.push(regions);
    }
    if (block === "radio" && !sameRadio(plan.radio, rec.radio)) {
      lines.push({
        id: "radio",
        group: "radio",
        labelKey: "summary.radio",
        from: formatRadio(plan.radio),
        to: formatRadio(rec.radio),
        ticked: true,
      });
    }
    for (const key of blockKeys(block)) {
      if (key === HOPS[0] && differs(HOPS)) {
        lines.push({
          id: "hops",
          group: block,
          labelKey: "settings.hopAllowance",
          from: hopsText(plan),
          to: hopsText(rec),
          ticked: true,
        });
      } else if (key === TIMING[0] && differs(TIMING)) {
        lines.push({
          id: "timing",
          group: block,
          labelKey: "settings.timing",
          from: timingText(plan),
          to: timingText(rec),
          ticked: true,
          noteKey: "checkup.timingNote",
        });
      } else if (!HOPS.includes(key) && !TIMING.includes(key) && differs([key])) {
        lines.push({
          id: key,
          group: block,
          labelKey: `setting.${key}`,
          from: valueText(key, rawOf(plan, key)),
          to: valueText(key, rawOf(rec, key)),
          ticked: true,
        });
      }
    }
  }
  return lines;
}

/** The plan with the lines whose ids are given set to the recommendation; nothing else changes. `discard`: own regions not to keep. */
export function applyCheckup(plan: Plan, places: Place[], ids: Set<string>, discard: Set<string> = new Set()): Plan {
  const rec = recommended(plan, places, discard);
  let next: Plan = { ...plan, settings: { ...plan.settings } };
  const take = (keys: SettingKey[]) => {
    for (const k of keys) next.settings[k] = rec.settings[k];
  };
  for (const id of ids) {
    if (id === "name" && plan.anchor) next = { ...next, prefixFormat: rec.prefixFormat, nameSuffix: rec.nameSuffix };
    else if (id === "radio") {
      const { radioText: _text, radioCustom: _custom, ...rest } = next;
      next = { ...rest, radio: { ...rec.radio } };
    } else if (id === "regions" && plan.anchor) next = { ...next, regions: rec.regions };
    else if (id === "hops") take(HOPS);
    else if (id === "timing") take(TIMING);
    else if (BLOCK_KEYS.has(id)) take([id as SettingKey]);
  }
  return next;
}

/** Lines ticked by default (disabled ones left out), per group, and whether the name differs. */
export function checkupCounts(lines: CheckupLine[]): {
  total: number;
  perGroup: Partial<Record<CheckupGroup, number>>;
  nameDiffers: boolean;
} {
  const perGroup: Partial<Record<CheckupGroup, number>> = {};
  let total = 0;
  for (const l of lines) {
    if (!l.ticked || l.disabled) continue;
    total++;
    perGroup[l.group] = (perGroup[l.group] ?? 0) + 1;
  }
  return { total, perGroup, nameDiffers: lines.some((l) => l.group === "name") };
}
