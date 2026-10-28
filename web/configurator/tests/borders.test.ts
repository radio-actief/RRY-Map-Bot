import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { loadMunicipalities } from "../src/core/data";
import { decodeBorders, decodePolyline, type WebBorders } from "../src/core/borders";
import { municipalityAt, type MunicipalityFeature } from "../src/core/geo";
import type { Place } from "../src/core/search";

const DATA = resolve(__dirname, "../../../data");
const read = (name: string) => JSON.parse(readFileSync(resolve(DATA, name), "utf8"));

describe("decodePolyline", () => {
  it("decodes Google's example into [lon, lat] points", () => {
    expect(decodePolyline("_p~iF~ps|U_ulLnnqC_mqNvxq`@")).toEqual([
      [-120.2, 38.5],
      [-120.95, 40.7],
      [-126.453, 43.252],
    ]);
  });
  it("decodes an empty string to no points", () => {
    expect(decodePolyline("")).toEqual([]);
  });
});

describe("the browser copy of the municipality borders", () => {
  const full: MunicipalityFeature[] = read("be-municipalities.geojson").features;
  const web = read("be-municipalities.web.json") as WebBorders;
  const features = decodeBorders(web);

  it("is several times smaller than the full borders and has the same 565 municipalities", () => {
    const size = (n: string) => readFileSync(resolve(DATA, n)).length;
    expect(size("be-municipalities.web.json") * 5).toBeLessThan(size("be-municipalities.geojson"));
    expect(features).toHaveLength(565);
    expect(features.map((f) => f.properties)).toEqual(full.map((f) => f.properties));
    for (const f of features) {
      const polys = f.geometry.type === "Polygon" ? [f.geometry.coordinates] : f.geometry.coordinates;
      for (const rings of polys) for (const ring of rings) expect(ring.length).toBeGreaterThanOrEqual(4);
    }
  });

  it("puts every place's own point in the same municipality as the full borders", () => {
    const places: Place[] = read("be-locode.json");
    let same = 0;
    let checked = 0;
    for (const p of places) {
      const a = municipalityAt(p, full);
      if (!a) continue;
      checked++;
      if (municipalityAt(p, features)?.properties.city_code === a.properties.city_code) same++;
    }
    expect(checked).toBeGreaterThan(500);
    expect(same / checked).toBeGreaterThan(0.995);
  });
});

describe("loadMunicipalities", () => {
  it("fetches the browser copy, not the full borders, and hands back GeoJSON features", async () => {
    const body = { format: "be-municipalities-web/1", precision: 5, features: [{ p: { city_code: "bex" }, g: [["_p~iF~ps|U_ulLnnqC_mqNvxq`@"]] }] };
    const fetch = vi.fn(async () => new Response(JSON.stringify(body)));
    vi.stubGlobal("fetch", fetch);
    try {
      const got = await loadMunicipalities();
      expect(fetch).toHaveBeenCalledWith("/data/be-municipalities.web.json");
      expect(got.type).toBe("FeatureCollection");
      expect(got.features[0].geometry).toEqual({ type: "Polygon", coordinates: [[[-120.2, 38.5], [-120.95, 40.7], [-126.453, 43.252]]] });
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
