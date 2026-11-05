/** Site profiles: the three timing settings a repeater gets from where it stands. */
import { settingValue, type DeviceSnapshot, type Plan } from "./plan";

export type SiteProfile = "hilltop" | "foothills" | "suburban" | "local";
/** A profile, or any other timing ("custom"). */
export type SiteChoice = SiteProfile | "custom";
export type Timing = { txdelay: number; directTxdelay: number; rxdelay: number };
/** What a profile sets: the two transmit delays. RX delay (experimental, off in the firmware) is no part of it. */
export type Delays = Pick<Timing, "txdelay" | "directTxdelay">;

export const SITE_PROFILES: Record<SiteProfile, Delays> = {
  hilltop: { txdelay: 2, directTxdelay: 2 },
  foothills: { txdelay: 1.5, directTxdelay: 1 },
  suburban: { txdelay: 0.8, directTxdelay: 0.4 },
  local: { txdelay: 0.3, directTxdelay: 0.1 },
};

/** What the firmware ships with. */
export const FIRMWARE_TIMING: Timing = { txdelay: 0.5, directTxdelay: 0.2, rxdelay: 0 };

const KEYS = ["txdelay", "directTxdelay"] as const;

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

const same = (a: Delays, b: Delays) => KEYS.every((k) => a[k] === b[k]);

/** The choice a timing amounts to by its transmit delays: a profile, else "custom". */
export function siteOf(timing: Timing): SiteChoice {
  for (const [name, t] of Object.entries(SITE_PROFILES) as [SiteProfile, Delays][]) {
    if (same(timing, t)) return name;
  }
  return "custom";
}

export function withTiming(plan: Plan, timing: Partial<Timing>): Plan {
  return { ...plan, settings: { ...plan.settings, ...timing } };
}

/** The transmit delays "custom" goes back to: the device's, where the Read gave a value, else the firmware's. */
export function siteReference(snapshot: DeviceSnapshot | null): Delays {
  const s = snapshot?.settings ?? {};
  return {
    txdelay: numberOr(s.txdelay ?? null, FIRMWARE_TIMING.txdelay),
    directTxdelay: numberOr(s.directTxdelay ?? null, FIRMWARE_TIMING.directTxdelay),
  };
}
