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

  it("measures distances on the ground", () => {
    expect(geo.distanceKm({ lat: 50.85, lon: 4.35 }, { lat: 50.85, lon: 4.35 })).toBe(0);
    // Brussels to Antwerp, about 41 km
    expect(geo.distanceKm({ lat: 50.8467, lon: 4.3525 }, { lat: 51.2194, lon: 4.4025 })).toBeCloseTo(41.6, 0);
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
  it("default to OpenFreeMap's grey Positron, dark with the map's shade; Liberty as Streets", () => {
    expect(basemaps.readBaseMap(storage(null), { vector: true })).toBe("openfreemap");
    expect(basemaps.styleFor("openfreemap", { dark: false, t })).toBe("https://tiles.openfreemap.org/styles/positron");
    expect(basemaps.styleFor("streets", { dark: false, t })).toBe("https://tiles.openfreemap.org/styles/liberty");
    expect(basemaps.baseMapLabel("streets", (k: string) => (k === "map.base.streets" ? "Straten" : k))).toBe("Straten");
    expect(basemaps.baseMapLabel("versatiles", t)).toBe("VersaTiles");
    expect(basemaps.styleFor("openfreemap", { dark: true, t })).toBe("https://tiles.openfreemap.org/styles/dark");
    expect(basemaps.styleFor("versatiles", { dark: true, t })).toBe("https://tiles.versatiles.org/assets/styles/colorful-dark/style.json");
  });

  it("offer all four with WebGL and the two raster maps on the Leaflet map", () => {
    expect(basemaps.baseMapIds({ vector: true })).toEqual(["openfreemap", "streets", "versatiles", "osm", "satellite"]);
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

  it("label in one family: Noto Sans Regular, Italic for water, as each glyph host names it", () => {
    const style = (glyphs: string) => ({
      glyphs,
      layers: [
        { id: "label_city_capital", type: "symbol", layout: { "text-font": ["Noto Sans Bold"] } },
        { id: "water_name_point_label", type: "symbol", "source-layer": "water_name", layout: { "text-font": ["Noto Sans Regular"] } },
        { id: "road", type: "line", paint: {} },
      ],
    });
    const ofm = basemaps.normalizeFonts(style("https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf"));
    expect(ofm.layers[0].layout["text-font"]).toEqual(["Noto Sans Regular"]);
    expect(ofm.layers[1].layout["text-font"]).toEqual(["Noto Sans Italic"]);
    const vt = basemaps.normalizeFonts(style("https://tiles.versatiles.org/assets/glyphs/{fontstack}/{range}.pbf"));
    expect(vt.layers.map((l: { layout?: Record<string, unknown> }) => l.layout?.["text-font"])).toEqual([["noto_sans_regular"], ["noto_sans_regular_italic"], undefined]);
  });

  it("tune OpenFreeMap's dark style to the site's ink, with town names a phone can read", () => {
    const style = {
      glyphs: "https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf",
      layers: [
        { id: "background", type: "background", paint: { "background-color": "rgb(12,12,12)" } },
        { id: "water", type: "fill", paint: { "fill-color": "x" } },
        { id: "landcover_wood", type: "fill", paint: { "fill-color": "x", "fill-pattern": "wood-pattern" } },
        { id: "highway_minor", type: "line", paint: { "line-color": "x" } },
        { id: "highway_motorway_inner", type: "line", paint: { "line-color": ["interpolate", ["linear"], ["zoom"], 5.8, "a", 6, "b"] } },
        { id: "railway_dashline", type: "line", paint: { "line-color": "x" } },
        { id: "boundary_country_z5-", type: "line", paint: { "line-color": "x" } },
        { id: "place_town", type: "symbol", layout: { "text-field": "{name}", "text-size": 10 }, paint: { "text-color": "x" } },
        { id: "place_village", type: "symbol", layout: { "text-field": "{name}", "text-size": 10 }, paint: { "text-color": "x" } },
      ],
    };
    const tuned = basemaps.prepareStyle("openfreemap", style, { dark: true });
    const by = Object.fromEntries(tuned.layers.map((l: { id: string }) => [l.id, l])) as Record<string, { paint: Record<string, unknown>; layout: Record<string, unknown> }>;
    expect(by.background.paint["background-color"]).toBe("#12161F");
    expect(by.water.paint["fill-color"]).toBe("#1A202C");
    expect(by.landcover_wood.paint).toEqual({ "fill-color": "#12161F" });
    expect(by.highway_minor.paint["line-color"]).toBe("#2D3748");
    expect(by.highway_motorway_inner.paint["line-color"]).toBe("#4A5568");
    expect(by.railway_dashline.paint["line-color"]).toBe("#12161F");
    expect(by["boundary_country_z5-"].paint["line-color"]).toBe("#4A5568");
    expect(by.place_town.paint).toMatchObject({ "text-color": "#A0AEC0", "text-halo-color": "#12161F" });
    expect(by.place_village.paint["text-color"]).toBe("#718096");
    // bigger than the style's 10 px at the zooms a phone shows towns
    const size = by.place_town.layout["text-size"] as unknown[];
    expect(size[0]).toBe("interpolate");
    expect(Math.min(...(size.slice(3).filter((_, i) => i % 2 === 1) as number[]))).toBeGreaterThanOrEqual(12);
    // the light styles keep their colours
    const light = basemaps.prepareStyle("openfreemap", { glyphs: "", layers: [{ id: "background", type: "background", paint: { "background-color": "#fff" } }] }, { dark: false });
    expect(light.layers[0].paint["background-color"]).toBe("#fff");
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

// @ts-ignore plain JS module of the map page
import { prefersReducedMotion } from "../../../src/map-engine/motion.js";

describe("reduced motion", () => {
  it("follows the browser's prefers-reduced-motion, and is off without matchMedia", () => {
    const win = (reduce: boolean) => ({ matchMedia: (q: string) => ({ matches: reduce && q === "(prefers-reduced-motion: reduce)" }) });
    expect(prefersReducedMotion(win(true))).toBe(true);
    expect(prefersReducedMotion(win(false))).toBe(false);
    expect(prefersReducedMotion({})).toBe(false);
    expect(prefersReducedMotion({ matchMedia: () => { throw new Error("x"); } })).toBe(false);
  });

  it("makes both engines jump instead of fly, and MapLibre fade nothing", () => {
    const ml = read("src/map-engine/maplibre-engine.js");
    expect(ml).toMatch(/prefersReducedMotion\(\) \? \{ fadeDuration: 0, reduceMotion: true \}/);
    expect(ml).toMatch(/if \(prefersReducedMotion\(\)\) \{\s*map\.jumpTo/);
    expect(ml).toMatch(/prefersReducedMotion\(\) \? "jumpTo" : "easeTo"/);
    const lf = read("src/map-engine/leaflet-engine.js");
    expect(lf).toMatch(/if \(prefersReducedMotion\(\)\) \{\s*map\.setView\(\[spot\.lat, spot\.lon\], z, \{ animate: false \}\)/);
    expect(lf).toMatch(/zoomAnimation: false, fadeAnimation: false, markerZoomAnimation: false/);
  });
});

describe("the region map on the map engine", () => {
  it("bounds GeoJSON features, collections and geometries", () => {
    const poly = { type: "Polygon", coordinates: [[[3, 50], [5, 50], [5, 51.5], [3, 51.5], [3, 50]]] };
    expect(geo.boundsOfGeoJSON(poly)).toEqual([[50, 3], [51.5, 5]]);
    const fc = { type: "FeatureCollection", features: [{ type: "Feature", geometry: poly }, { type: "Feature", geometry: { type: "Point", coordinates: [6, 49] } }] };
    expect(geo.boundsOfGeoJSON(fc)).toEqual([[49, 3], [51.5, 6]]);
    expect(geo.boundsOfGeoJSON({ type: "FeatureCollection", features: [] })).toBeNull();
  });

  it("loads no map library itself: the engine brings MapLibre, or Leaflet without WebGL", () => {
    const html = read("region-map.html");
    expect(html).not.toMatch(/leaflet|maplibre/i);
    expect(html).toMatch(/<script type="module" src="\.\/src\/region-map\.js"><\/script>/);
    expect(html).toMatch(/src\/shared\/map-engine\.css/);
    const js = read("src/region-map.js");
    expect(js).toMatch(/import \{ createMapEngine, preloadEngine \} from "\.\/map-engine\/index\.js"/);
    expect(js).not.toMatch(/\bL\.[a-zA-Z]|window\.L\b/);
  });

  it("finds the engine's texts in the shared messages, which every tool page loads", () => {
    const shared = JSON.parse(read("src/shared/i18n/shared.en.json"));
    for (const f of ["src/map-engine/maplibre-engine.js", "src/map-engine/leaflet-engine.js", "src/map-engine/basemaps.js"]) {
      const keys = [...read(f).matchAll(/\bt\(\s*"([\w.-]+)"/g)].map((m) => m[1]);
      expect(keys.filter((k) => !(k in shared)), f).toEqual([]);
    }
  });
});

describe("map labels in the page language", () => {
  const OFM = "https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf";
  const VT = "https://tiles.versatiles.org/assets/glyphs/{fontstack}/{range}.pbf";
  const ofmName = ["case", ["has", "name:nonlatin"], ["concat", ["get", "name:latin"], "\n", ["get", "name:nonlatin"]], ["coalesce", ["get", "name_en"], ["get", "name"]]];
  const style = (glyphs: string) => ({
    glyphs,
    layers: [
      { id: "place_city", type: "symbol", layout: { "text-field": ofmName, "text-transform": "uppercase" } },
      { id: "water_name", type: "symbol", "source-layer": "water_name", layout: { "text-field": ["get", "name"] } },
      { id: "shield", type: "symbol", layout: { "text-field": ["to-string", ["get", "ref"]] } },
      { id: "house", type: "symbol", layout: { "text-field": "{housenumber}" } },
    ],
  });

  it("take the language's name, else the local name, on OpenFreeMap (OpenMapTiles)", () => {
    expect(basemaps.nameField("tiles.openfreemap.org", "nl")).toEqual(["coalesce", ["get", "name:nl"], ["get", "name"]]);
    expect(basemaps.nameField("tiles.openfreemap.org", "fr")).toEqual(["coalesce", ["get", "name:fr"], ["get", "name"]]);
    expect(basemaps.nameField("tiles.openfreemap.org", "en")).toEqual(["coalesce", ["get", "name:en"], ["get", "name_en"], ["get", "name"]]);
    expect(basemaps.nameField("tiles.openfreemap.org", "de")).toEqual(["get", "name"]);
    const s = basemaps.localizeLabels(style(OFM), "fr");
    expect(s.layers.map((l: { layout: Record<string, unknown> }) => l.layout["text-field"])).toEqual([
      ["coalesce", ["get", "name:fr"], ["get", "name"]],
      ["coalesce", ["get", "name:fr"], ["get", "name"]],
      ["to-string", ["get", "ref"]],
      "{housenumber}",
    ]);
  });

  it("on VersaTiles (Shortbread: name, name_en) English where there is one, else the local name", () => {
    expect(basemaps.nameField("tiles.versatiles.org", "en")).toEqual(["coalesce", ["get", "name_en"], ["get", "name"]]);
    expect(basemaps.nameField("tiles.versatiles.org", "nl")).toEqual(["get", "name"]);
    const s = basemaps.localizeLabels(style(VT), "en");
    expect(s.layers[0].layout["text-field"]).toEqual(["coalesce", ["get", "name_en"], ["get", "name"]]);
  });

  it("are part of every vector style the map loads, and the tuned dark style writes names as they are", () => {
    const s = basemaps.prepareStyle("openfreemap", style(OFM), { dark: true, lang: "nl" });
    expect(s.layers[0].layout).toMatchObject({ "text-field": ["coalesce", ["get", "name:nl"], ["get", "name"]], "text-transform": "none" });
    const light = basemaps.prepareStyle("openfreemap", style(OFM), { dark: false, lang: "nl" });
    expect(light.layers[0].layout["text-field"]).toEqual(["coalesce", ["get", "name:nl"], ["get", "name"]]);
    // the page language changes in place (the configurator): the map loads its style again
    expect(read("src/map-engine/maplibre-engine.js")).toMatch(/BEmeshI18n\?\.onChange\?\.\(\(\) => loadBase\(\)\)/);
    expect(read("src/map-engine/maplibre-engine.js")).toMatch(/prepareStyle\(baseId, style, \{ dark, lang: globalThis\.BEmeshI18n\?\.lang \?\? "en" \}\)/);
  });
});
