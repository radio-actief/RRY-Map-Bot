/** Setting blocks: the five groups the guided flow recommends, counts and undoes as one. */
import type { Plan } from "./plan";
import { BEMESH_PRESET_TITLE, RADIO_PRESETS, type RadioPreset } from "./presets";
import { FLOOD_ALLOWANCE, SETTINGS, type SettingDef, type SettingKey } from "./settings";
import { SITE_PROFILES, siteOf, timingOf, withTiming, type SiteProfile } from "./site";

export type Block = "radio" | "advertising" | "repeating" | "timing" | "advanced";
export const BLOCKS: Block[] = ["radio", "advertising", "repeating", "timing", "advanced"];

const BY_KEY = new Map(SETTINGS.map((d) => [d.key, d]));
export const BEMESH_RADIO = RADIO_PRESETS.find((p) => p.title === BEMESH_PRESET_TITLE)!;

/** The settings of a block: the SETTINGS of that card. */
export function blockKeys(block: Block): SettingKey[] {
  return SETTINGS.filter((d: SettingDef) => d.card === block).map((d) => d.key);
}

/** Equal as text, or as numbers when both are numeric ("12" and 12.0). */
export function same(a: unknown, b: unknown): boolean {
  const x = String(a ?? "").trim();
  const y = String(b ?? "").trim();
  return x === y || (x !== "" && y !== "" && Number.isFinite(Number(x)) && Number(x) === Number(y));
}

export const sameRadio = (a: Plan["radio"], b: Plan["radio"]) =>
  a.freq === b.freq && a.sf === b.sf && a.bw === b.bw && a.cr === b.cr;

export const rawOf = (plan: Plan, key: SettingKey): string => String(plan.settings[key] ?? BY_KEY.get(key)!.formDefault ?? "");

/** The hop allowance level whose pair the plan holds, if any. */
export function allowanceOf(plan: Plan): keyof typeof FLOOD_ALLOWANCE | null {
  const found = (Object.keys(FLOOD_ALLOWANCE) as (keyof typeof FLOOD_ALLOWANCE)[]).find(
    (k) =>
      same(rawOf(plan, "floodMaxUnscoped"), FLOOD_ALLOWANCE[k][0]) &&
      same(rawOf(plan, "floodMaxAdvert"), FLOOD_ALLOWANCE[k][1]),
  );
  return found ?? null;
}

/** The plan with a preset's values and no custom state. */
export function withPreset(plan: Plan, p: RadioPreset): Plan {
  const { radioText: _text, radioCustom: _custom, ...rest } = plan;
  return { ...rest, radio: { freq: p.freq, sf: p.sf, bw: p.bw, cr: p.cr } };
}

const withSettings = (plan: Plan, settings: Plan["settings"]): Plan => ({
  ...plan,
  settings: { ...plan.settings, ...settings },
});

/** The plan with this block set to the #BEmesh recommendation. */
export function recommendedFor(plan: Plan, block: Block): Plan {
  if (block === "radio") {
    return withSettings(withPreset(plan, BEMESH_RADIO), { dutycycle: "10" });
  }
  if (block === "advertising") {
    const [unscoped, advert] = FLOOD_ALLOWANCE.average;
    return withSettings(plan, {
      floodAdvertHours: 47,
      advertIntervalMinutes: 0,
      floodMaxUnscoped: unscoped,
      floodMaxAdvert: advert,
      floodMax: 64,
    });
  }
  if (block === "repeating") return withSettings(plan, { repeat: "on", loopDetect: "minimal" });
  if (block === "timing") {
    const choice = siteOf(timingOf(plan));
    const profile: SiteProfile = choice in SITE_PROFILES ? (choice as SiteProfile) : "suburban";
    return withTiming(plan, { ...SITE_PROFILES[profile] });
  }
  return withSettings(plan, { pathHashMode: "1", radioRxgain: "on", intThresh: 0, agcResetInterval: 0, multiAcks: "0" });
}

export function recommendedForAll(plan: Plan): Plan {
  return BLOCKS.reduce(recommendedFor, plan);
}

/** Applying the recommendation would change nothing. */
export function isBlockRecommended(plan: Plan, block: Block): boolean {
  const rec = recommendedFor(plan, block);
  if (!blockKeys(block).every((k) => same(rawOf(plan, k), rawOf(rec, k)))) return false;
  return block !== "radio" || (sameRadio(plan.radio, rec.radio) && !plan.radioText && !plan.radioCustom);
}

/** Settings of the block that differ from start, plus one for the radio. The admin password is in no block. */
export function blockChanges(plan: Plan, start: Plan, block: Block): number {
  const settings = blockKeys(block).filter((k) => !same(rawOf(plan, k), rawOf(start, k))).length;
  const radio = block === "radio" && (!sameRadio(plan.radio, start.radio) || !!plan.radioText) ? 1 : 0;
  return settings + radio;
}

/** The plan with this block copied back from start; keys start does not hold are removed. */
export function undoBlock(plan: Plan, start: Plan, block: Block): Plan {
  const settings = { ...plan.settings };
  for (const k of blockKeys(block)) {
    if (k in start.settings) settings[k] = start.settings[k];
    else delete settings[k];
  }
  const next: Plan = { ...plan, settings };
  if (block !== "radio") return next;
  const { radioText: _text, radioCustom: _custom, ...rest } = next;
  return {
    ...rest,
    radio: { ...start.radio },
    ...(start.radioText ? { radioText: { ...start.radioText } } : {}),
    ...(start.radioCustom ? { radioCustom: start.radioCustom } : {}),
  };
}
