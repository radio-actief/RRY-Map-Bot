/* The configurator's own settings in browser storage. The device hub hands them, once, to the
 * configurator on an address of its own (web/configurator/src/state/moved.ts): browser storage is
 * kept per address, and these were kept on the map's until then. */

/** The settings: theme, map layers, "include defaults" on Send, the console's command log. */
export const CONFIGURATOR_PREFS = [
  "configurator.theme",
  "configurator.layers",
  "configurator.includeDefaults",
  "configurator.serialShowCommandLog",
];

/** Longer values are not handed over (none of the settings is near this). */
export const PREF_MAX_LENGTH = 2000;

/** {key: value or null} of these settings in `storage`; null for an unreadable or too long one. */
export function readPrefs(storage) {
  const values = {};
  for (const key of CONFIGURATOR_PREFS) {
    let v = null;
    try {
      v = storage?.getItem(key) ?? null;
    } catch {
      v = null;
    }
    values[key] = typeof v === "string" && v.length <= PREF_MAX_LENGTH ? v : null;
  }
  return values;
}
