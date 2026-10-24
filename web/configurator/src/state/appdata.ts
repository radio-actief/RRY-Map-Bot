/** Loads the runtime data into store.data; every failure is recorded by name and the rest still loads. */
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

type Name = keyof Loaders;

async function load(name: Name, loaders: Loaders): Promise<void> {
  try {
    const value = await loaders[name]();
    store.data.value = { ...store.data.value, [name]: value };
  } catch {
    const failed = new Set(store.data.value.failed).add(name);
    store.data.value = { ...store.data.value, failed } satisfies AppData;
  }
}

/** Resolves when everything but the municipalities is loaded; those follow once the browser is idle. */
export async function loadAppData(
  loaders: Loaders = defaultLoaders,
  defer: (run: () => void) => void = deferToIdle,
): Promise<void> {
  defer(() => void load("municipalities", loaders));
  await Promise.all((["places", "provinces", "gewesten", "countries", "nodes"] as const).map((n) => load(n, loaders)));
}

function deferToIdle(run: () => void): void {
  if (typeof requestIdleCallback === "function") requestIdleCallback(run, { timeout: 2000 });
  else setTimeout(run, 0);
}
