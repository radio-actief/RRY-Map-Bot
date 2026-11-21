// Builds data/be-province-hulls.geojson: per province an area around its places in
// data/be-locode.json (Turf's concave hull with edges up to 50 km, else the convex hull). The
// region map draws these only when the province outlines (data/be-provinces.geojson) can't be
// loaded. Run it again after be-locode.json changes. Turf is needed only here, not in the page:
//   npm install --prefix <dir> @turf/turf@7.2.0
//   NODE_PATH=<dir>/node_modules node scripts/generate-be-province-hulls.mjs
import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const turf = createRequire(import.meta.url)("@turf/turf");

const window = {};
vm.runInNewContext(readFileSync(join(root, "src/shared/be-regions.js"), "utf8"), { window });
const { PROVINCE_CODES } = window.RRYRegions;

const places = JSON.parse(readFileSync(join(root, "data/be-locode.json"), "utf8")).filter((loc) => loc.lat && loc.lon);

/** The area around `points` as the region map built it: concave first, convex when that fails. */
function hull(points) {
  if (points.length < 3) return null;
  const fc = turf.featureCollection(points.map((p) => turf.point([p.lon, p.lat])));
  let area = null;
  try {
    area = turf.concave(fc, { maxEdge: 50, units: "kilometers" });
  } catch {
    /* too few distinct points */
  }
  if (!area) {
    try {
      area = turf.convex(fc);
    } catch {
      /* none */
    }
  }
  return area;
}

const features = [];
for (const code of PROVINCE_CODES) {
  const area = hull(places.filter((loc) => loc.province_code === code));
  if (area) features.push({ type: "Feature", geometry: area.geometry, properties: { ...area.properties, code } });
}
writeFileSync(join(root, "data/be-province-hulls.geojson"), JSON.stringify({ type: "FeatureCollection", features }) + "\n");
console.log(`data/be-province-hulls.geojson: ${features.length} provinces`);
