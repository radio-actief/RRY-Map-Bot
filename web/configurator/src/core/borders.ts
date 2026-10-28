/**
 * The browser copy of the municipality borders (data/be-municipalities.web.json, built by
 * scripts/generate-be-municipalities-web.py): simplified to about 20 m, every ring an encoded
 * polyline. The backend geocoder keeps the full data/be-municipalities.geojson.
 */
import type { MunicipalityFeature } from "./geo";

export type WebBorders = {
  format: string;
  precision: number;
  features: { p: MunicipalityFeature["properties"]; g: string[][] }[];
};

/** One encoded polyline (Google's algorithm, lat then lon) as GeoJSON [lon, lat] points. */
export function decodePolyline(s: string, precision = 5): number[][] {
  const factor = 10 ** precision;
  const out: number[][] = [];
  let i = 0;
  let lat = 0;
  let lon = 0;
  const next = () => {
    let shift = 0;
    let result = 0;
    let b: number;
    do {
      b = s.charCodeAt(i++) - 63;
      result |= (b & 0x1f) << shift;
      shift += 5;
    } while (b >= 0x20);
    return result & 1 ? ~(result >> 1) : result >> 1;
  };
  while (i < s.length) {
    lat += next();
    lon += next();
    out.push([lon / factor, lat / factor]);
  }
  return out;
}

/** The borders as GeoJSON features: a Polygon, or a MultiPolygon for a municipality in parts. */
export function decodeBorders(w: WebBorders): MunicipalityFeature[] {
  return w.features.map((f) => {
    const polys = f.g.map((rings) => rings.map((r) => decodePolyline(r, w.precision)));
    return {
      type: "Feature",
      properties: f.p,
      geometry: polys.length === 1 ? { type: "Polygon", coordinates: polys[0] } : { type: "MultiPolygon", coordinates: polys },
    };
  });
}
