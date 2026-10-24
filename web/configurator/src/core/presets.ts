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
