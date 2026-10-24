/** Runtime data loaders. */
import type { MeshNode, MunicipalityFeature } from "./geo";
import type { Place } from "./search";

export type GeoJsonCollection = { type: "FeatureCollection"; features: unknown[] };

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to load ${url}: HTTP ${res.status}`);
  return (await res.json()) as T;
}

export const loadPlaces = () => getJson<Place[]>("/data/be-locode.json");
export const loadMunicipalities = () =>
  getJson<{ type: "FeatureCollection"; features: MunicipalityFeature[] }>("/data/be-municipalities.geojson");
export const loadProvinces = () => getJson<GeoJsonCollection>("/data/be-provinces.geojson");
export const loadGewesten = () => getJson<GeoJsonCollection>("/data/be-gewesten.geojson");
export const loadCountries = () => getJson<GeoJsonCollection>("/data/countries.geojson");
export const loadNodes = () => getJson<MeshNode[]>("/api/v1/belgian-nodes");
