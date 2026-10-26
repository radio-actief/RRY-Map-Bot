/** Setting blocks: the five groups the guided flow recommends, counts and undoes as one. */
import type { Plan } from "./plan";
import { BEMESH_PRESET_TITLE, RADIO_PRESETS, type RadioPreset } from "./presets";
import { FLOOD_ALLOWANCE, FLOOD_MAX, hopLevel, SETTINGS, type HopLevel, type SettingDef, type SettingKey } from "./settings";
import { SITE_PROFILES, withTiming } from "./site";

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
export function allowanceOf(plan: Plan): HopLevel | null {
  return hopLevel(rawOf(plan, "floodMaxUnscoped"), rawOf(plan, "floodMaxAdvert"));
}

/** Max flood hops set to the hop preset's while the plan follows it and the hop limits match one. */
export function followHops(plan: Plan): Plan {
  const level = plan.floodMaxFollow ? allowanceOf(plan) : null;
  return level ? { ...plan, settings: { ...plan.settings, floodMax: FLOOD_MAX[level] } } : plan;
}

/** The plan on a hop preset (and its max flood hops, when following). */
export function withAllowance(plan: Plan, level: HopLevel): Plan {
  const [floodMaxUnscoped, floodMaxAdvert] = FLOOD_ALLOWANCE[level];
  return followHops({ ...plan, settings: { ...plan.settings, floodMaxUnscoped, floodMaxAdvert } });
}

/** Follow the hop preset for max flood hops, or not; turning it off keeps the value. */
export function setFloodMaxFollow(plan: Plan, on: boolean): Plan {
  return followHops({ ...plan, floodMaxFollow: on });
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
    return withAllowance({ ...withSettings(plan, { floodAdvertHours: 47, advertIntervalMinutes: 0 }), floodMaxFollow: true }, "average");
  }
  if (block === "repeating") return withSettings(plan, { repeat: "on", loopDetect: "minimal" });
  if (block === "timing") return withTiming(plan, { ...SITE_PROFILES.suburban, rxdelay: 0 });
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
  if (block === "advertising") {
    const { floodMaxFollow: _follow, ...rest } = next;
    return start.floodMaxFollow === undefined ? rest : { ...rest, floodMaxFollow: start.floodMaxFollow };
  }
  if (block !== "radio") return next;
  const { radioText: _text, radioCustom: _custom, ...rest } = next;
  return {
    ...rest,
    radio: { ...start.radio },
    ...(start.radioText ? { radioText: { ...start.radioText } } : {}),
    ...(start.radioCustom ? { radioCustom: start.radioCustom } : {}),
  };
}
