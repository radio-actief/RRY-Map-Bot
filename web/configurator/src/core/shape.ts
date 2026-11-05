/** Belgium's provinces as small SVG paths, for the Companion page's "where this region reaches" shapes. */

type Ring = [number, number][];
type Geometry = { type: "Polygon"; coordinates: Ring[] } | { type: "MultiPolygon"; coordinates: Ring[][] };
type Feature = { properties?: { code?: string }; geometry: Geometry };

export type ProvinceShapes = { viewBox: string; paths: Record<string, string> };

const WIDTH = 100;

const polygonsOf = (g: Geometry): Ring[][] => (g.type === "Polygon" ? [g.coordinates] : g.coordinates);

/**
 * One path per province code, in a viewBox WIDTH wide: longitude scaled by the cosine of the middle
 * latitude so the country keeps its shape; north is up.
 */
export function provinceShapes(collection: { features: unknown[] }): ProvinceShapes {
  const features = collection.features as Feature[];
  let [minLon, maxLon, minLat, maxLat] = [Infinity, -Infinity, Infinity, -Infinity];
  for (const f of features) {
    for (const poly of polygonsOf(f.geometry)) {
      for (const [lon, lat] of poly.flat()) {
        minLon = Math.min(minLon, lon);
        maxLon = Math.max(maxLon, lon);
        minLat = Math.min(minLat, lat);
        maxLat = Math.max(maxLat, lat);
      }
    }
  }
  const kx = Math.cos((((minLat + maxLat) / 2) * Math.PI) / 180);
  const scale = WIDTH / ((maxLon - minLon) * kx);
  const x = (lon: number) => ((lon - minLon) * kx * scale).toFixed(1);
  const y = (lat: number) => ((maxLat - lat) * scale).toFixed(1);
  const paths: Record<string, string> = {};
  for (const f of features) {
    const code = f.properties?.code;
    if (!code) continue;
    paths[code] = polygonsOf(f.geometry)
      .flatMap((poly) => poly.map((ring) => `M${ring.map(([lon, lat]) => `${x(lon)} ${y(lat)}`).join("L")}Z`))
      .join("");
  }
  return { viewBox: `0 0 ${WIDTH} ${Math.ceil((maxLat - minLat) * scale)}`, paths };
}
