import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  findGeographicNeighbors,
  haversineKm,
  municipalityAt,
  nodesWithin,
  type MeshNode,
  type MunicipalityFeature,
} from "../src/core/geo";
import { loadNodes, loadPlaces } from "../src/core/data";
import { GEWEST_OF_PROVINCE, PROVINCE_ADJACENCY, PROVINCE_NAMES } from "../src/core/be-regions";
import type { Place } from "../src/core/search";

const PLACES: Place[] = JSON.parse(readFileSync(resolve(process.cwd(), "data/be-locode.json"), "utf8"));
const FEATURES: MunicipalityFeature[] = JSON.parse(
  readFileSync(resolve(__dirname, "fixtures/municipalities-3.json"), "utf8"),
).features;

describe("haversineKm", () => {
  it("is zero for the same point and ~111 km per degree of latitude", () => {
    expect(haversineKm({ lat: 50, lon: 4 }, { lat: 50, lon: 4 })).toBe(0);
    expect(haversineKm({ lat: 50, lon: 4 }, { lat: 51, lon: 4 })).toBeCloseTo(111.19, 1);
  });
});

describe("municipalityAt", () => {
  it("finds Ronse", () => {
    expect(municipalityAt({ lat: 50.7461, lon: 3.6012 }, FEATURES)?.properties.city_code).toBe("beron");
  });
  it("returns null in the North Sea", () => {
    expect(municipalityAt({ lat: 51.6, lon: 2.5 }, FEATURES)).toBeNull();
  });
  it("excludes holes and handles MultiPolygon", () => {
    const square = (a: number, b: number) => [[a, a], [b, a], [b, b], [a, b], [a, a]];
    const f = (geometry: MunicipalityFeature["geometry"]): MunicipalityFeature => ({
      type: "Feature",
      properties: { nis5: "1", plaats: "x", gemeente: "x", province_code: "p", city_code: "x" },
      geometry,
    });
    const donut = f({ type: "Polygon", coordinates: [square(0, 10), square(4, 6)] });
    expect(municipalityAt({ lat: 5, lon: 5 }, [donut])).toBeNull();
    expect(municipalityAt({ lat: 2, lon: 2 }, [donut])).toBe(donut);
    const multi = f({ type: "MultiPolygon", coordinates: [[square(0, 1)], [square(20, 30)]] });
    expect(municipalityAt({ lat: 25, lon: 25 }, [multi])).toBe(multi);
  });
});

describe("nodesWithin", () => {
  const c = { lat: 50.75, lon: 3.6 };
  const node = (type: number, dLat: number, key: string): MeshNode => ({
    public_key: key,
    type,
    adv_name: key,
    adv_lat: c.lat + dLat,
    adv_lon: c.lon,
  });
  it("keeps 10 km repeaters and room servers, drops 30 km and companions, sorts by distance", () => {
    const far = node(2, 30 / 111.19, "far");
    const near10 = node(2, 10 / 111.19, "near10");
    const companion = node(1, 1 / 111.19, "companion");
    const room = node(3, 5 / 111.19, "room");
    expect(nodesWithin([far, near10, companion, room], c).map((n) => n.public_key)).toEqual(["room", "near10"]);
  });
});

describe("findGeographicNeighbors", () => {
  it("lists Kluisbergen near Ronse, nearest first, at most 10", () => {
    const ronse = PLACES.find((p) => p.city_code === "beron")!;
    const result = findGeographicNeighbors(ronse, PLACES);
    expect(result.map((r) => r.place.plaats)).toContain("Kluisbergen");
    expect(result.length).toBeLessThanOrEqual(10);
    expect(result.every((r) => r.km <= 25 && r.place.city_code !== "beron")).toBe(true);
    expect(result.map((r) => r.km)).toEqual([...result.map((r) => r.km)].sort((a, b) => a - b));
  });
});

describe("be-regions", () => {
  it("re-exports the shared region data", () => {
    expect(PROVINCE_NAMES["be-vov"]).toBe("Oost-Vlaanderen");
    expect(GEWEST_OF_PROVINCE["be-vov"]).toBe("be-vlg");
    expect(PROVINCE_ADJACENCY["be-vov"]).toContain("be-vwv");
  });
});

describe("data loaders", () => {
  afterEach(() => vi.unstubAllGlobals());
  it("resolves the parsed JSON on 200", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => [{ a: 1 }] });
    vi.stubGlobal("fetch", fetchMock);
    expect(await loadPlaces()).toEqual([{ a: 1 }]);
    expect(fetchMock).toHaveBeenCalledWith("/data/be-locode.json");
  });
  it("rejects with an Error naming the URL on 404", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 404, json: async () => ({}) }));
    await expect(loadNodes()).rejects.toThrow("/api/v1/belgian-nodes");
  });
});
