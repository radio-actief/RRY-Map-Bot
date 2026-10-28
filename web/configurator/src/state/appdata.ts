/**
 * Loads the runtime data into store.data when it is needed: the places at start, the outlines when
 * the map starts, the municipality borders and the node list once the user leaves Connect or the
 * plan has a location. Each set loads once; a failure is recorded by name and the rest still loads.
 */
import { effect } from "@preact/signals";
import { loadCountries, loadGewesten, loadMunicipalities, loadNodes, loadPlaces, loadProvinces } from "../core/data";
import { store, type AppData } from "./store";

export type Loaders = {
  places: typeof loadPlaces;
  municipalities: typeof loadMunicipalities;
  provinces: typeof loadProvinces;
  gewesten: typeof loadGewesten;
  countries: typeof loadCountries;
  nodes: typeof loadNodes;
};

const defaultLoaders: Loaders = {
  places: loadPlaces,
  municipalities: loadMunicipalities,
  provinces: loadProvinces,
  gewesten: loadGewesten,
  countries: loadCountries,
  nodes: loadNodes,
};

export type DataName = keyof Loaders;

const loading = new Map<DataName, Promise<void>>();

async function load(name: DataName, loaders: Loaders): Promise<void> {
  try {
    const value = await loaders[name]();
    store.data.value = { ...store.data.value, [name]: value };
  } catch {
    const failed = new Set(store.data.value.failed).add(name);
    store.data.value = { ...store.data.value, failed } satisfies AppData;
  }
}

/** Start loading each named set that has not started yet; resolves once all of them are loaded or failed. */
export function ensureData(names: DataName[], loaders: Loaders = defaultLoaders): Promise<void> {
  for (const n of names) if (!loading.has(n)) loading.set(n, load(n, loaders));
  return Promise.all(names.map((n) => loading.get(n))).then(() => undefined);
}

/** At start: the places (search, Read). */
export function loadAppData(loaders: Loaders = defaultLoaders): Promise<void> {
  return ensureData(["places"], loaders);
}

/** The borders and the node list, once the user leaves Connect or the plan has a location. Returns a stop function. */
export function loadOnDemand(loaders: Loaders = defaultLoaders): () => void {
  return effect(() => {
    if (store.step.value !== "connect" || store.plan.value.location) void ensureData(["municipalities", "nodes"], loaders);
  });
}

/** Forget what was loaded (tests). */
export function resetLoaded(): void {
  loading.clear();
}
