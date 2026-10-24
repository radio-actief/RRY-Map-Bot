/** Site profiles: the three timing settings a repeater gets from where it stands. */
import { settingValue, type DeviceSnapshot, type Plan } from "./plan";

export type SiteProfile = "hilltop" | "foothills" | "suburban" | "local";
/** A profile, the timing the device had ("own"), or anything else ("custom"). */
export type SiteChoice = SiteProfile | "own" | "custom";
export type Timing = { txdelay: number; directTxdelay: number; rxdelay: number };

export const SITE_PROFILES: Record<SiteProfile, Timing> = {
  hilltop: { txdelay: 2, directTxdelay: 2, rxdelay: 3 },
  foothills: { txdelay: 1.5, directTxdelay: 1, rxdelay: 3 },
  suburban: { txdelay: 0.8, directTxdelay: 0.4, rxdelay: 3 },
  local: { txdelay: 0.3, directTxdelay: 0.1, rxdelay: 3 },
};

/** What the firmware ships with. */
export const FIRMWARE_TIMING: Timing = { txdelay: 0.5, directTxdelay: 0.2, rxdelay: 0 };

const KEYS = ["txdelay", "directTxdelay", "rxdelay"] as const;

function numberOr(v: string | number | null, fallback: number): number {
  if (v === null) return fallback;
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

/** The plan's timing as the script sends it; a value that cannot be sent counts as the firmware's. */
export function timingOf(plan: Plan): Timing {
  return {
    txdelay: numberOr(settingValue(plan, "txdelay"), FIRMWARE_TIMING.txdelay),
    directTxdelay: numberOr(settingValue(plan, "directTxdelay"), FIRMWARE_TIMING.directTxdelay),
    rxdelay: numberOr(settingValue(plan, "rxdelay"), FIRMWARE_TIMING.rxdelay),
  };
}

const same = (a: Timing, b: Timing) => KEYS.every((k) => a[k] === b[k]);

/** The choice a timing amounts to: a profile, else the reference ("own"), else "custom". */
export function siteOf(timing: Timing, reference: Timing): SiteChoice {
  for (const [name, t] of Object.entries(SITE_PROFILES) as [SiteProfile, Timing][]) {
    if (same(timing, t)) return name;
  }
  return same(timing, reference) ? "own" : "custom";
}

export function timingFor(choice: SiteProfile | "own", reference: Timing): Timing {
  return choice === "own" ? reference : SITE_PROFILES[choice];
}

export function withTiming(plan: Plan, timing: Timing): Plan {
  return { ...plan, settings: { ...plan.settings, ...timing } };
}

/** The timing "own" stands for: the device's, where the Read gave a value. */
export function siteReference(snapshot: DeviceSnapshot | null): Timing {
  const s = snapshot?.settings ?? {};
  return {
    txdelay: numberOr(s.txdelay ?? null, FIRMWARE_TIMING.txdelay),
    directTxdelay: numberOr(s.directTxdelay ?? null, FIRMWARE_TIMING.directTxdelay),
    rxdelay: numberOr(s.rxdelay ?? null, FIRMWARE_TIMING.rxdelay),
  };
}
