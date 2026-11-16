import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
/* eslint-disable @typescript-eslint/ban-ts-comment */
// @ts-ignore plain JS module of the map page
import * as geo from "../../../src/map-engine/geo.js";

const read = (f: string) => readFileSync(resolve(process.cwd(), f), "utf8");

describe("the map engines' shared maths", () => {
  it("counts zoom as the page does (256 px tiles), MapLibre one level lower", () => {
    expect(geo.toMapZoom(9)).toBe(8);
    expect(geo.fromMapZoom(8)).toBe(9);
    expect(geo.fromMapZoom(geo.toMapZoom(12.5))).toBe(12.5);
  });

  it("clusters below the slider's zoom, and not at all for the coverage's reachable-only view", () => {
    // Leaflet's disableClusteringAtZoom 11: clusters up to zoom 10, i.e. MapLibre tile zoom 9
    expect(geo.clusterMaxZoomFor(11)).toBe(9);
    expect(geo.clusterMaxZoomFor(8)).toBe(6);
    expect(geo.clusterMaxZoomFor(1)).toBe(-1);
    expect(geo.clusterMaxZoomFor(0)).toBe(-1);
    expect(geo.clusterMaxZoomFor(NaN)).toBe(-1);
  });

  it("wraps longitudes as Leaflet's wrapNum and rounds a spot to five decimals", () => {
    expect(geo.wrapLon(4.35)).toBeCloseTo(4.35, 10);
    expect(geo.wrapLon(364.35)).toBeCloseTo(4.35, 10);
    expect(geo.wrapLon(-185)).toBeCloseTo(175, 10);
    expect(geo.wrapLon(180)).toBe(180);
    expect(geo.roundCoord(50.8987654)).toBe(50.89877);
  });

  it("projects to web mercator and back", () => {
    const p = geo.project({ lat: 50.85, lon: 4.35 });
    expect(p.x).toBeCloseTo(484239.78, 1);
    expect(p.y).toBeCloseTo(6594803.23, 1);
    const back = geo.unproject(p);
    expect(back.lat).toBeCloseTo(50.85, 9);
    expect(back.lon).toBeCloseTo(4.35, 9);
  });

  it("draws the coverage's direction line straight on the map and finds points along a line", () => {
    const east = geo.destination([4.35, 50.85], 90, 10000);
    expect(east.lat).toBeCloseTo(50.85, 6);
    expect(east.lon).toBeGreaterThan(4.35);
    const north = geo.destination([4.35, 50.85], 0, 10000);
    expect(north.lon).toBeCloseTo(4.35, 9);
    expect(north.lat).toBeGreaterThan(50.85);
    const mid = geo.interpolate({ lat: 50, lon: 4 }, { lat: 51, lon: 5 }, 0.5);
    expect(mid.lon).toBeCloseTo(4.5, 9);
    expect(mid.lat).toBeGreaterThan(50.5); // mercator: the middle of the map line lies north of the mean
    expect(geo.interpolate({ lat: 50, lon: 4 }, { lat: 51, lon: 5 }, 0)).toMatchObject({ lon: 4 });
  });

  it("rings a circle of the given radius on the ground, closed", () => {
    const ring = geo.circleRing({ lat: 50.85, lon: 4.35 }, 40000, 64);
    expect(ring).toHaveLength(65);
    expect(ring[0]).toEqual(ring[64]);
    // the northernmost point is 40 km north: 0.3597 degrees of latitude
    expect(ring[0][1] - 50.85).toBeCloseTo(0.3597, 3);
    expect(ring[0][0]).toBeCloseTo(4.35, 9);
  });

  it("turns Leaflet's dash pattern in pixels into MapLibre's in line widths", () => {
    expect(geo.dashInLineWidths("6 4", 2)).toEqual([3, 2]);
    expect(geo.dashInLineWidths("8 6", 3)).toEqual([8 / 3, 2]);
    expect(geo.dashInLineWidths(null, 3)).toBeNull();
    expect(geo.dashInLineWidths("", 3)).toBeNull();
  });

  it("bounds a set of points", () => {
    expect(geo.boundsOf([{ lat: 50, lon: 5 }, { lat: 51, lon: 4 }])).toEqual([[50, 4], [51, 5]]);
  });
});

describe("the map page's engine files", () => {
  it("keep MapLibre's licence next to its vendored build", () => {
    expect(read("lib/maplibre-gl.LICENSE.txt")).toMatch(/Copyright \(c\) 2023, MapLibre contributors/);
    expect(read("lib/maplibre-gl.mjs").slice(0, 200)).toMatch(/MapLibre GL JS[\s\S]*v6\.16\.0/);
    expect(read("lib/maplibre-gl-worker.mjs").slice(0, 200)).toMatch(/v6\.16\.0/);
  });
});

// @ts-ignore plain JS module of the map page
import * as basemaps from "../../../src/map-engine/basemaps.js";
// @ts-ignore plain JS module of the map page
import { createMapEngine, preloadEngine, webglAvailable } from "../../../src/map-engine/index.js";

const storage = (value: string | null) => {
  const data = new Map<string, string>(value === null ? [] : [["baseMapSelected", value]]);
  return { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v), data };
};
const t = (k: string) => ({ "map.tiles": "Tiles", "map.sources": "Sources" })[k] ?? k;

describe("the base maps", () => {
  it("default to OpenFreeMap's vector style, light or dark with the map's shade", () => {
    expect(basemaps.readBaseMap(storage(null), { vector: true })).toBe("openfreemap");
    expect(basemaps.styleFor("openfreemap", { dark: false, t })).toBe("https://tiles.openfreemap.org/styles/liberty");
    expect(basemaps.styleFor("openfreemap", { dark: true, t })).toBe("https://tiles.openfreemap.org/styles/dark");
    expect(basemaps.styleFor("versatiles", { dark: true, t })).toBe("https://tiles.versatiles.org/assets/styles/colorful-dark/style.json");
  });

  it("offer all four with WebGL and the two raster maps on the Leaflet map", () => {
    expect(basemaps.baseMapIds({ vector: true })).toEqual(["openfreemap", "versatiles", "osm", "satellite"]);
    expect(basemaps.baseMapIds({ vector: false })).toEqual(["osm", "satellite"]);
  });

  it("read the Leaflet map's stored names and a vector choice without WebGL", () => {
    expect(basemaps.readBaseMap(storage("OpenStreetMap"), { vector: true })).toBe("openfreemap");
    expect(basemaps.readBaseMap(storage("Esri Satellite"), { vector: true })).toBe("satellite");
    expect(basemaps.readBaseMap(storage("Esri Satellite"), { vector: false })).toBe("satellite");
    expect(basemaps.readBaseMap(storage("versatiles"), { vector: false })).toBe("osm");
    expect(basemaps.readBaseMap(storage("osm"), { vector: true })).toBe("osm");
    expect(basemaps.readBaseMap(storage("<script>"), { vector: true })).toBe("openfreemap");
    const s = storage(null);
    basemaps.storeBaseMap(s, "versatiles");
    expect(s.data.get("baseMapSelected")).toBe("versatiles");
    expect(basemaps.readBaseMap({ getItem: () => { throw new Error("blocked"); } }, { vector: true })).toBe("openfreemap");
  });

  it("credit OpenStreetMap and Esri as the Leaflet map did, and darken only OpenStreetMap's tiles", () => {
    const osm = basemaps.styleFor("osm", { dark: true, t });
    expect(osm.sources.base.tiles).toEqual(["https://tile.openstreetmap.org/{z}/{x}/{y}.png"]);
    expect(osm.sources.base.attribution).toMatch(/OpenStreetMap/);
    expect(osm.layers.find((l: { id: string }) => l.id === "base").paint["raster-brightness-max"]).toBe(0);
    const light = basemaps.styleFor("osm", { dark: false, t });
    expect(light.layers.find((l: { id: string }) => l.id === "base").paint).toEqual({});
    const sat = basemaps.styleFor("satellite", { dark: true, t });
    expect(sat.sources.base.tiles[0]).toMatch(/^https:\/\/server\.arcgisonline\.com\//);
    expect(sat.sources.base.maxzoom).toBe(18);
    expect(sat.sources.base.attribution).toMatch(/Esri/);
    expect(sat.layers.find((l: { id: string }) => l.id === "base").paint).toEqual({});
  });

  it("only name hosts the page policy allows", () => {
    const text = read("src/map-engine/basemaps.js");
    const hosts = new Set([...text.matchAll(/https:\/\/([a-z0-9.-]+)\//g)].map((m) => m[1]));
    expect([...hosts].sort()).toEqual(["server.arcgisonline.com", "tile.openstreetmap.org", "tiles.openfreemap.org", "tiles.versatiles.org", "www.openstreetmap.org"]);
  });
});

describe("choosing the map engine", () => {
  const container = () => {
    const el = document.createElement("div");
    el.className = "map";
    return el;
  };
  const calls: string[] = [];
  const load = (maplibre: () => unknown) => ({
    maplibre: async () => async () => { calls.push("maplibre"); return maplibre(); },
    leaflet: async () => async () => { calls.push("leaflet"); return { kind: "leaflet" }; },
  });

  it("uses MapLibre where WebGL 2 works", async () => {
    calls.length = 0;
    const engine = await createMapEngine(container(), {}, { webgl: () => true, load: load(() => ({ kind: "maplibre" })) });
    expect(engine.kind).toBe("maplibre");
    expect(calls).toEqual(["maplibre"]);
  });

  it("loads only the Leaflet map without WebGL", async () => {
    calls.length = 0;
    const engine = await createMapEngine(container(), {}, { webgl: () => false, load: load(() => ({ kind: "maplibre" })) });
    expect(engine.kind).toBe("leaflet");
    expect(calls).toEqual(["leaflet"]);
  });

  it("falls back to the Leaflet map, on a clean container, when MapLibre fails to start", async () => {
    calls.length = 0;
    const el = container();
    const engine = await createMapEngine(el, {}, {
      webgl: () => true,
      load: load(() => {
        el.classList.add("maplibregl-map");
        el.append(document.createElement("canvas"));
        throw new Error("Failed to initialize WebGL");
      }),
    });
    expect(engine.kind).toBe("leaflet");
    expect(calls).toEqual(["maplibre", "leaflet"]);
    expect(el.children).toHaveLength(0);
    expect(el.className).toBe("map");
  });

  it("finds no WebGL where the canvas gives no context, or throws", () => {
    const doc = (getContext: () => unknown) => ({ createElement: () => ({ getContext }) }) as unknown as Document;
    expect(webglAvailable(doc(() => null))).toBe(false);
    expect(webglAvailable(doc(() => { throw new Error("no"); }))).toBe(false);
    expect(webglAvailable(doc(() => ({})))).toBe(true);
  });
});

// @ts-ignore plain JS module of the map page
import * as images from "../../../src/map-engine/node-images.js";

describe("the MapLibre markers' look from the page's CSS", () => {
  it("splits a computed filter into pixel tints and drop shadows", () => {
    const f = images.parseFilter(
      "saturate(5) hue-rotate(260deg) drop-shadow(rgba(240, 200, 80, 0.55) 0px 0px 3px) drop-shadow(rgba(240, 200, 80, 0.45) 0px 0px 6px)",
    );
    expect(f.tint).toHaveLength(2);
    expect(f.shadows).toEqual([
      { x: 0, y: 0, blur: 3, color: "rgba(240, 200, 80, 0.55)" },
      { x: 0, y: 0, blur: 6, color: "rgba(240, 200, 80, 0.45)" },
    ]);
    // as written in the stylesheet, the colour last
    expect(images.parseFilter("drop-shadow(0 0 4px rgba(88, 101, 242, 0.65))").shadows).toEqual([{ x: 0, y: 0, blur: 4, color: "rgba(88, 101, 242, 0.65)" }]);
    expect(images.parseFilter("none")).toEqual({ tint: [], shadows: [] });
    expect(images.parseFilter("blur(2px) grayscale(100) contrast(16)").tint).toHaveLength(2);
  });

  it("tints pixels as the CSS filter functions do, leaving transparent ones alone", () => {
    const px = new Uint8ClampedArray([102, 123, 137, 255, 9, 9, 9, 0]);
    images.tintPixels(px, images.parseFilter("grayscale(100)").tint);
    expect(px[0]).toBe(px[1]);
    expect(px[1]).toBe(px[2]);
    expect([...px.slice(4)]).toEqual([9, 9, 9, 0]);
    const grey = new Uint8ClampedArray([100, 100, 100, 255]);
    images.tintPixels(grey, images.parseFilter("saturate(5) hue-rotate(260deg)").tint);
    expect([...grey]).toEqual([100, 100, 100, 255]); // grey stays grey
    const c = new Uint8ClampedArray([200, 100, 100, 255]);
    images.tintPixels(c, images.parseFilter("contrast(16)").tint);
    expect([...c]).toEqual([255, 0, 0, 255]);
  });

  it("names each look's image and reads it back, whatever the companion's initials hold", () => {
    const looks = [
      { type: 2, status: "recent", mark: "claimed" },
      { type: 4, status: "none", mark: "" },
      { type: 1, status: "old", mark: "user-owned", label: "J|", color: "hsl(12deg, 60%, 50%)" },
      { type: 1, status: "none", mark: "", label: "🐝", color: "hsl(300deg, 60%, 50%)" },
    ];
    for (const look of looks) {
      const back = images.parseNodeImageId(images.nodeImageId(look));
      expect(back).toMatchObject({ status: look.status, mark: look.mark, ...(look.label != null ? { label: look.label, color: look.color } : { type: look.type }) });
    }
    expect(images.nodeImageId(looks[1])).not.toBe(images.nodeImageId({ ...looks[1], mark: "claimed" }));
  });

  it("finds the rim colour in a box-shadow", () => {
    expect(images.shadowColour("rgb(26, 32, 44) 0px 0px 0px 2px", "x")).toBe("rgb(26, 32, 44)");
    expect(images.shadowColour("none", "x")).toBe("x");
  });
});

describe("the map shade switch without Leaflet", () => {
  it("toggles map-dark on the container, tells the map and stores the override", async () => {
    localStorage.clear();
    document.documentElement.removeAttribute("data-theme");
    // @ts-ignore plain JS script of the pages (it sets window.BEmeshMapShade)
    await import("../../../src/shared/map-shade.js");
    const shade = (window as unknown as { BEmeshMapShade: { watch: (el: HTMLElement, fn: (s: string) => void) => { button: HTMLButtonElement; detach: () => void } } }).BEmeshMapShade;
    const el = document.createElement("div");
    const seen: string[] = [];
    const sw = shade.watch(el, (s) => seen.push(s));
    expect(seen).toEqual(["light"]);
    expect(sw.button.getAttribute("aria-label")).toBe("Dark map (follows the theme)");
    sw.button.click();
    expect(seen).toEqual(["light", "dark"]);
    expect(el.classList.contains("map-dark")).toBe(true);
    expect(localStorage.getItem("bemesh.mapShade")).toBe("dark");
    expect(sw.button.getAttribute("aria-label")).toBe("Light map");
    sw.button.click();
    expect(localStorage.getItem("bemesh.mapShade")).toBeNull();
    sw.detach();
    expect(el.classList.contains("map-dark")).toBe(false);
  });
});

describe("the map page loads its map engine without holding up the page", () => {
  const html = read("index.html");
  const mapJs = read("src/map.js");

  it("has neither Leaflet nor MapLibre in its <head>: the engine loads from src/map.js", () => {
    expect(html).not.toMatch(/leaflet|maplibre/i);
    expect(read("src/map-engine/index.js")).toMatch(/import\("\.\/maplibre-engine\.js"\)/);
    expect(read("src/map-engine/index.js")).toMatch(/import\("\.\/leaflet-engine\.js"\)/);
    expect(mapJs).not.toMatch(/^\s*import[^;]*(leaflet|maplibre-gl)/m);
  });

  it("asks for the nodes and the engine before it waits for its language", () => {
    const wait = mapJs.indexOf("await I18N.ready");
    expect(mapJs.indexOf("const nodesRequest = fetch(apiUrl)")).toBeGreaterThan(0);
    expect(mapJs.indexOf("const nodesRequest = fetch(apiUrl)")).toBeLessThan(wait);
    expect(mapJs.indexOf("preloadEngine()")).toBeLessThan(wait);
    // the Vue app mounts without waiting for the map, which starts once the page has painted
    expect(mapJs).not.toMatch(/await\s+(mapReady|createMapEngine)/);
    expect(mapJs).toMatch(/const mapReady = afterFirstPaint\(\)\.then\(\(\) => createMapEngine\(/);
  });

  it("uses no Leaflet API itself: everything goes through the engine", () => {
    for (const f of ["src/map.js", "src/coverage/planning.js"]) {
      expect(read(f), f).not.toMatch(/\bL\.[a-zA-Z]|window\.L\b|leafletMap/);
    }
  });
});

describe("preloading MapLibre", () => {
  it("only hints the files (fetched, not run), and only where a WebGL 2 context can be made", () => {
    const doc = document.implementation.createHTMLDocument("x");
    preloadEngine(doc, { webgl: () => false });
    expect(doc.head.querySelectorAll("link")).toHaveLength(0);
    preloadEngine(doc, { webgl: () => true });
    preloadEngine(doc, { webgl: () => true });
    const links = [...doc.head.querySelectorAll("link")].map((l) => `${l.rel} ${l.getAttribute("href")?.replace(/^.*\/(lib|src)\//, "$1/")}`);
    expect(links).toEqual(["modulepreload lib/maplibre-gl.mjs", "modulepreload src/map-engine/maplibre-engine.js", "preload lib/css/maplibre-gl.css"]);
  });
});
