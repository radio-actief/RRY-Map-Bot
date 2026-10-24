/** Radio presets: snapshot of the official MeshCore suggested radio settings. */
import presets from "./radio-presets.json";

/**
 * Source: https://api.meshcore.nz/api/v1/config (config.suggested_radio_settings.entries).
 * Refresh the snapshot with `node scripts/update-radio-presets.mjs`.
 */
export type RadioPreset = { title: string; freq: number; sf: number; bw: number; cr: number };

export const RADIO_PRESETS: RadioPreset[] = presets;

/** The #BEmesh radio plan. */
export const BEMESH_PRESET_TITLE = "EU/UK (Narrow)";

/**
 * Effective MeshCore radio default for CLI omission: the EU/UK Narrow plan with
 * CR 5, which #BEmesh treats as the practical firmware default.
 */
export const FIRMWARE_DEFAULT_RADIO = { freq: 869.618, bw: 62.5, sf: 8, cr: 5 };

export function presetForRadio(r: {
  freq: number;
  sf: number;
  bw: number;
  cr: number;
}): RadioPreset | null {
  return (
    RADIO_PRESETS.find(
      (p) => p.freq === r.freq && p.sf === r.sf && p.bw === r.bw && p.cr === r.cr,
    ) ?? null
  );
}

export type RadioFieldId = "freq" | "sf" | "bw" | "cr";

/** Limits of the four custom radio fields (the old page's RADIO_FIELD_SPECS). */
export const RADIO_FIELD_SPECS: Record<RadioFieldId, { min: number; max: number; integer: boolean; maxDecimals?: number }> = {
  freq: { min: 150, max: 2500, integer: false },
  sf: { min: 5, max: 12, integer: true },
  bw: { min: 7, max: 500, integer: false, maxDecimals: 3 },
  cr: { min: 5, max: 8, integer: true },
};

/** A value inside its field's limits, with bandwidth rounded to its decimals; null when it is not. */
export function checkRadioValue(id: RadioFieldId, value: number): number | null {
  const spec = RADIO_FIELD_SPECS[id];
  if (!Number.isFinite(value) || value < spec.min || value > spec.max) return null;
  if (spec.integer && !Number.isInteger(value)) return null;
  if (spec.maxDecimals === undefined) return value;
  const f = 10 ** spec.maxDecimals;
  return Math.round(value * f) / f;
}

/** Strict parse of typed text for one radio field; null when it is empty, not a number or out of range. */
export function parseRadioField(id: RadioFieldId, text: string): number | null {
  const v = text.trim();
  return v === "" ? null : checkRadioValue(id, Number(v));
}
