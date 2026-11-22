/**
 * The one-time move of the configurator's settings to its own address. Browser storage is kept per
 * address: until the configurator had an address of its own, its settings (theme, map layers,
 * "include defaults", the console's command log) and the remembered device were kept on the map's.
 * On its first visit here it asks the map's device hub for them and copies each one this address
 * doesn't have yet, so nothing set here is overwritten; a remembered device is taken when it is
 * newer than the one here. Then it marks the move done ("configurator.moved") and never asks again.
 * The map's address keeps its copy (the map's pages read the theme there). No answer (the hub not
 * reachable, the configurator not shown yet): nothing is marked, and the next visit asks again.
 */
import { CONFIGURATOR_PREFS, PREF_MAX_LENGTH } from "../../../../src/shared/configurator-prefs.js";
import { LAST_KEY, readLast } from "../../../../src/shared/device-message.js";
import type { Hub } from "./hub";
import { prefs } from "./store";

export const MOVED_KEY = "configurator.moved";
/** How long the hub may take to answer (its frame loads first). */
export const MOVE_WAIT_MS = 6000;

type Prefs = Pick<typeof prefs, "get" | "set">;
type Store = Pick<Storage, "getItem" | "setItem">;

export type MoveResult = { status: "moved"; copied: string[] } | { status: "already" } | { status: "noAnswer" };

function storageOrNull(): Store | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

/** Copies the settings from the map's address once (see above). */
export async function moveSettings(hub: Hub, p: Prefs = prefs, storage: Store | null = storageOrNull(), waitMs = MOVE_WAIT_MS): Promise<MoveResult> {
  if (p.get(MOVED_KEY)) return { status: "already" };
  const [answer, last] = await Promise.all([
    hub.ask({ kind: "bemesh.configurator.prefs.query", v: 1 }, "bemesh.configurator.prefs", waitMs),
    hub.ask({ kind: "bemesh.device.getLast", v: 1 }, "bemesh.device.last", waitMs),
  ]);
  const values = answer?.values;
  if (!values || typeof values !== "object") return { status: "noAnswer" };
  const copied: string[] = [];
  for (const key of CONFIGURATOR_PREFS) {
    const v = (values as Record<string, unknown>)[key];
    if (typeof v !== "string" || v.length > PREF_MAX_LENGTH || p.get(key) !== null) continue;
    p.set(key, v);
    copied.push(key);
  }
  // The remembered device, checked by the convention's own rules; only a newer one replaces ours.
  const theirs = last ? readLast({ getItem: () => JSON.stringify(last.last ?? null), setItem: () => {} }) : null;
  const ours = readLast(storage);
  if (theirs && (!ours || theirs.at > ours.at)) {
    try {
      storage?.setItem(LAST_KEY, JSON.stringify(theirs));
      copied.push(LAST_KEY);
    } catch {
      /* blocked storage */
    }
  }
  p.set(MOVED_KEY, new Date().toISOString());
  return { status: "moved", copied };
}
