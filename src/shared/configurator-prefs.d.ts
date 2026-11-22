type Store = Pick<Storage, "getItem">;
export const CONFIGURATOR_PREFS: string[];
export const PREF_MAX_LENGTH: number;
/** {key: value or null} of the configurator's settings in `storage`. */
export function readPrefs(storage: Store | null): Record<string, string | null>;
