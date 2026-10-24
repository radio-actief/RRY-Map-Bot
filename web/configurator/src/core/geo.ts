/** Distances, nearby nodes, municipality lookup and geographic neighbours. */
import type { Place } from "./search";

export type LatLon = { lat: number; lon: number };

export type MeshNode = {
  public_key: string;
  type: number;
  adv_name: string;
  adv_lat: number;
  adv_lon: number;
};

type Ring = number[][];
export type MunicipalityFeature = {
  type: "Feature";
  properties: {
    nis5: string;
    plaats: string;
    gemeente: string;
    province_code: string;
    city_code: string;
  };
  geometry:
    | { type: "Polygon"; coordinates: Ring[] }
    | { type: "MultiPolygon"; coordinates: Ring[][] };
};

/** Max distance (km) for neighbouring municipalities / province hints. */
export const NEIGHBOR_RADIUS_KM = 25;
/** Max municipality rows in the policy scope. */
export const NEIGHBOR_SCOPE_MAX_CITIES = 10;

export function haversineKm(a: LatLon, b: LatLon): number {
  const R = 6371;
  const toR = Math.PI / 180;
  const dLat = (b.lat - a.lat) * toR;
  const dLon = (b.lon - a.lon) * toR;
  const h =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(a.lat * toR) * Math.cos(b.lat * toR) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Repeaters (2) and room servers (3) within km of center, nearest first. */
export function nodesWithin(nodes: MeshNode[], center: LatLon, km = NEIGHBOR_RADIUS_KM): MeshNode[] {
  return nodes
    .filter((n) => n.type === 2 || n.type === 3)
    .map((n) => ({ n, d: haversineKm(center, { lat: n.adv_lat, lon: n.adv_lon }) }))
    .filter((x) => x.d <= km)
    .sort((a, b) => a.d - b.d)
    .map((x) => x.n);
}

function inRing(p: LatLon, ring: Ring): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > p.lat !== yj > p.lat && p.lon < ((xj - xi) * (p.lat - yi)) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

/** Outer ring minus holes. */
function inPolygon(p: LatLon, rings: Ring[]): boolean {
  if (!rings.length || !inRing(p, rings[0])) return false;
  for (let i = 1; i < rings.length; i++) if (inRing(p, rings[i])) return false;
  return true;
}

export function municipalityAt(p: LatLon, features: MunicipalityFeature[]): MunicipalityFeature | null {
  for (const f of features) {
    const g = f.geometry;
    const polys = g.type === "Polygon" ? [g.coordinates] : g.coordinates;
    if (polys.some((rings) => inPolygon(p, rings))) return f;
  }
  return null;
}

const finite = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n);

/**
 * Nearest other places within NEIGHBOR_RADIUS_KM by haversine distance, deduped by
 * city_code, at most NEIGHBOR_SCOPE_MAX_CITIES.
 */
export function findGeographicNeighbors(place: Place, places: Place[]): { place: Place; km: number }[] {
  if (!finite(place.lat) || !finite(place.lon)) return [];
  const scored: { place: Place; km: number }[] = [];
  for (const o of places) {
    if (o.city_code === place.city_code) continue;
    if (!finite(o.lat) || !finite(o.lon)) continue;
    scored.push({ place: o, km: haversineKm(place, o) });
  }
  scored.sort((a, b) => a.km - b.km);
  const out: { place: Place; km: number }[] = [];
  const seen = new Set<string>();
  for (const s of scored) {
    if (s.km > NEIGHBOR_RADIUS_KM) break;
    if (seen.has(s.place.city_code)) continue;
    seen.add(s.place.city_code);
    out.push(s);
    if (out.length >= NEIGHBOR_SCOPE_MAX_CITIES) break;
  }
  return out;
}
