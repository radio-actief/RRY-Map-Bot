// Map maths both map engines share (no engine needed): zoom levels, web mercator, circles and lines.
//
// The page, its URL (zoom=) and its clustering slider count zoom as Leaflet does, on 256 px tiles.
// MapLibre counts on 512 px tiles: the same scale is one level lower there.
export const toMapZoom = (zoom) => zoom - 1;
export const fromMapZoom = (zoom) => zoom + 1;

/**
 * MapLibre clusters at tile zooms up to clusterMaxZoom. The page clusters below `until` (Leaflet's
 * disableClusteringAtZoom): -1 means no clustering at all.
 */
export function clusterMaxZoomFor(until) {
  const z = toMapZoom(Number(until)) - 1;
  return Number.isFinite(z) && z >= 0 ? z : -1;
}

/** A longitude in -180..180 (180 itself stays), as Leaflet's wrapNum(lng, [-180, 180], true). */
export function wrapLon(lon) {
  if (lon === 180) return 180;
  return ((((lon + 180) % 360) + 360) % 360) - 180;
}

/** Five decimals (about a metre), as the map's menu and the planning tools write a spot. */
export const roundCoord = (x) => Math.round(x * 1e5) / 1e5;

const R = 6378137; // web mercator (EPSG:3857)
const MAX_LAT = 85.0511287798;
const EARTH = 6371000; // Leaflet's CRS.Earth radius, for distances on the ground

/** {lat, lon} to web mercator metres {x, y}. */
export function project({ lat, lon }) {
  const d = Math.PI / 180;
  const sin = Math.sin(Math.max(Math.min(MAX_LAT, lat), -MAX_LAT) * d);
  return { x: R * lon * d, y: (R * Math.log((1 + sin) / (1 - sin))) / 2 };
}

/** Web mercator metres {x, y} to {lat, lon}. */
export function unproject({ x, y }) {
  const d = 180 / Math.PI;
  return { lat: (2 * Math.atan(Math.exp(y / R)) - Math.PI / 2) * d, lon: (x * d) / R };
}

/**
 * The point `meters` from [lon, lat] towards `bearing` (degrees) along a straight map line: web
 * mercator keeps angles, so the line goes straight on the map, like the coverage estimate's rays.
 */
export function destination([lon, lat], bearing, meters) {
  const origin = project({ lat, lon });
  const scale = 1 / Math.cos((lat * Math.PI) / 180);
  const radians = (bearing * Math.PI) / 180;
  return unproject({ x: origin.x + Math.sin(radians) * meters * scale, y: origin.y + Math.cos(radians) * meters * scale });
}

/** The point a share (0..1) along the straight map line from a to b. */
export function interpolate(a, b, share) {
  const pa = project(a);
  const pb = project(b);
  return unproject({ x: pa.x + (pb.x - pa.x) * share, y: pa.y + (pb.y - pa.y) * share });
}

/** A circle of `meters` around the centre on the ground, as a closed ring of [lon, lat] (GeoJSON). */
export function circleRing({ lat, lon }, meters, steps = 128) {
  const d = Math.PI / 180;
  const lat1 = lat * d;
  const lon1 = lon * d;
  const a = meters / EARTH;
  const ring = [];
  for (let i = 0; i <= steps; i++) {
    const brg = ((i % steps) / steps) * 2 * Math.PI;
    const lat2 = Math.asin(Math.sin(lat1) * Math.cos(a) + Math.cos(lat1) * Math.sin(a) * Math.cos(brg));
    const lon2 = lon1 + Math.atan2(Math.sin(brg) * Math.sin(a) * Math.cos(lat1), Math.cos(a) - Math.sin(lat1) * Math.sin(lat2));
    ring.push([lon2 / d, lat2 / d]);
  }
  return ring;
}

/** A Leaflet-style dash pattern ("6 4", in pixels) as MapLibre's, in line widths. */
export function dashInLineWidths(dashArray, weight) {
  if (!dashArray) return null;
  const parts = String(dashArray).split(/[\s,]+/).map(Number).filter((n) => Number.isFinite(n) && n >= 0);
  if (!parts.length || !(weight > 0)) return null;
  return parts.map((n) => n / weight);
}

/** [[south, west], [north, east]] around the given points ({lat, lon}). */
export function boundsOf(points) {
  let s = Infinity, w = Infinity, n = -Infinity, e = -Infinity;
  for (const p of points) {
    s = Math.min(s, p.lat);
    n = Math.max(n, p.lat);
    w = Math.min(w, p.lon);
    e = Math.max(e, p.lon);
  }
  return [[s, w], [n, e]];
}

/** The distance on the ground between two spots, in km (haversine). */
export function distanceKm(a, b) {
  const d = Math.PI / 180;
  const dLat = (b.lat - a.lat) * d;
  const dLon = (b.lon - a.lon) * d;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * d) * Math.cos(b.lat * d) * Math.sin(dLon / 2) ** 2;
  return (2 * EARTH * Math.asin(Math.min(1, Math.sqrt(h)))) / 1000;
}

/** [[south, west], [north, east]] around a GeoJSON object (feature, collection or geometry); null when empty. */
export function boundsOfGeoJSON(geojson) {
  let s = Infinity, w = Infinity, n = -Infinity, e = -Infinity;
  const visit = (c) => {
    if (typeof c?.[0] === "number") {
      const [lon, lat] = c;
      if (lat < s) s = lat;
      if (lat > n) n = lat;
      if (lon < w) w = lon;
      if (lon > e) e = lon;
    } else if (Array.isArray(c)) c.forEach(visit);
  };
  const walk = (g) => {
    if (!g) return;
    if (g.type === "FeatureCollection") g.features?.forEach(walk);
    else if (g.type === "Feature") walk(g.geometry);
    else if (g.type === "GeometryCollection") g.geometries?.forEach(walk);
    else visit(g.coordinates);
  };
  (Array.isArray(geojson) ? geojson : [geojson]).forEach(walk);
  return Number.isFinite(s) ? [[s, w], [n, e]] : null;
}
