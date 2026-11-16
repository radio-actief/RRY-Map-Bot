import { act, cleanup, fireEvent, render, screen } from "@testing-library/preact";
import type { ComponentChild } from "preact";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The map engine (MapLibre, or Leaflet without WebGL) is recorded, not drawn.
vi.mock("../src/app/map-engine", async () => await import("./fakes/map-engine"));

import { MapView } from "../src/app/MapView";
import { defaultPlan } from "../src/core/plan";
import { store } from "../src/state/store";
import { engines, resetFakeEngine } from "./fakes/map-engine";

const node = (type: number, name: string, lat: number, lon: number) => ({
  public_key: name,
  type,
  adv_name: name,
  adv_lat: lat,
  adv_lon: lon,
});
const square = (x: number, y: number) => ({
  type: "Polygon" as const,
  coordinates: [[[x, y], [x + 1, y], [x + 1, y + 1], [x, y + 1], [x, y]]],
});
const muni = (city_code: string, x: number, y: number) => ({
  type: "Feature" as const,
  properties: { nis5: city_code, plaats: city_code, gemeente: city_code, province_code: "be-vov", city_code },
  geometry: square(x, y),
});

const map = () => engines[0];
/** Renders and lets the map engine come in (it loads on its own). */
async function show(ui: ComponentChild = <MapView />) {
  const out = render(ui as never);
  await act(async () => {});
  return out;
}
const codeOf = (f: { feature: { properties?: Record<string, any> } }) => String(f.feature.properties?.code ?? f.feature.properties?.city_code);

beforeEach(() => {
  resetFakeEngine();
  store.plan.value = defaultPlan();
  store.step.value = "place";
  store.layers.value = { nodes: true, borders: true };
  store.data.value = { failed: new Set() };
  store.regionFocus.value = null;
});
afterEach(cleanup);

describe("MapView", () => {
  it("keeps the map's controls in their usual corner (app.css: beside the docked panel, top right on a phone)", async () => {
    await show();
    expect(engines).toHaveLength(1);
    expect(map().options.controls ?? "bottom-left").toBe("bottom-left");
    expect(map().options.center).toEqual({ lat: 50.6, lon: 4.6 });
    expect(map().options.zoom).toBe(8);
  });

  it("a map click sets plan.location", async () => {
    await show();
    act(() => map().fire("click", { lat: 50.7, lon: 3.6 }));
    expect(store.plan.value.location).toEqual({ lat: 50.7, lon: 3.6 });
  });

  it("a map click moves the pin only on Place; elsewhere it leaves the pin and the regions alone", async () => {
    await show();
    act(() => map().fire("click", { lat: 50.7, lon: 3.6 }));
    const before = store.plan.value;
    for (const step of ["connect", "name", "regions"] as const) {
      act(() => {
        store.step.value = step;
      });
      act(() => map().fire("click", { lat: 51.2, lon: 4.4 }));
      expect(store.plan.value).toBe(before);
    }
    act(() => {
      store.step.value = "place";
    });
    act(() => map().fire("click", { lat: 51.2, lon: 4.4 }));
    expect(store.plan.value.location).toEqual({ lat: 51.2, lon: 4.4 });
  });

  it("a map click and a pin drag round the coordinates to 6 decimals, as the old page did", async () => {
    await show();
    act(() => map().fire("click", { lat: 50.74755123456, lon: 3.602094999 }));
    expect(store.plan.value.location).toEqual({ lat: 50.747551, lon: 3.602095 });
    const pin = map().live().marks.find((m) => m.options.className === "map-pin")!;
    pin.getLatLng = () => ({ lat: 51.12345678, lon: 4.98765432 });
    act(() => pin.fire("dragend"));
    expect(store.plan.value.location).toEqual({ lat: 51.123457, lon: 4.987654 });
  });

  it("dragging the pin sets plan.location; the pin has its 25 km ring", async () => {
    store.plan.value = { ...defaultPlan(), location: { lat: 50.7, lon: 3.6 } };
    await show();
    const pin = map().live().marks.find((m) => m.options.className === "map-pin")!;
    expect(pin.options.draggable).toBe(true);
    expect(pin.options.title).toBeTruthy();
    expect(map().live().circles.map((c) => [c.meters, c.style.className])).toEqual([[25000, "map-ring"]]);
    pin.getLatLng = () => ({ lat: 51, lon: 4 });
    act(() => pin.fire("dragend"));
    expect(store.plan.value.location).toEqual({ lat: 51, lon: 4 });
  });

  it("shows markers for repeaters and room servers within 25 km, not companions", async () => {
    store.plan.value = { ...defaultPlan(), location: { lat: 50.7, lon: 3.6 } };
    store.data.value = {
      failed: new Set(),
      nodes: [node(1, "c", 50.71, 3.6), node(2, "r", 50.72, 3.6), node(3, "s", 50.7, 3.62), node(2, "far", 52, 5)],
    };
    await show();
    const nodes = map().live().marks.filter((m) => /map-node/.test(m.options.className));
    expect(nodes.map((m) => m.options.tooltip).sort()).toEqual(["r", "s"]);
    expect(screen.getByRole("checkbox", { name: "Nearby nodes (2)" })).toBeTruthy();
  });

  it("marks the switch unavailable and disabled when the data failed", async () => {
    store.data.value = { failed: new Set(["nodes"]) };
    await show();
    expect(screen.getByText(/Nearby nodes.*unavailable/)).toBeTruthy();
    expect((screen.getByRole("checkbox", { name: /Nearby nodes/ }) as HTMLInputElement).disabled).toBe(true);
    expect((screen.getByRole("checkbox", { name: "Borders" }) as HTMLInputElement).disabled).toBe(false);
  });

  it("toggling Borders updates store.layers and hides the outlines", async () => {
    store.data.value = {
      failed: new Set(),
      provinces: { type: "FeatureCollection", features: [{ type: "Feature", properties: { code: "be-vov" }, geometry: square(3, 50) }] },
    };
    await show();
    expect(map().classed("map-outline").length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole("checkbox", { name: "Borders" }));
    expect(store.layers.value.borders).toBe(false);
    expect(map().classed("map-outline")).toHaveLength(0);
  });

  it("keeps the outlines when the pin moves; only the highlight follows it", async () => {
    store.plan.value = { ...defaultPlan(), location: { lat: 50.5, lon: 3.5 } };
    store.data.value = {
      failed: new Set(),
      provinces: { type: "FeatureCollection", features: [{ type: "Feature", properties: { code: "be-vov" }, geometry: square(3, 50) }] },
      municipalities: { type: "FeatureCollection", features: [muni("beaaa", 3, 50), muni("bebbb", 8, 50)] } as never,
    };
    await show();
    const outline = map().classed("map-outline")[0].area;
    expect(map().classed("map-municipality")).toHaveLength(1);
    act(() => {
      store.plan.value = { ...store.plan.value, location: { lat: 50.5, lon: 8.5 } };
    });
    expect(map().classed("map-outline")).toHaveLength(1);
    expect(map().classed("map-outline")[0].area).toBe(outline);
    expect(map().classed("map-municipality").map(codeOf)).toEqual(["bebbb"]);
  });

  it("highlights only the matched municipality", async () => {
    store.plan.value = { ...defaultPlan(), location: { lat: 50.5, lon: 3.5 } };
    store.data.value = { failed: new Set(), municipalities: { type: "FeatureCollection", features: [muni("beaaa", 3, 50), muni("bebbb", 8, 50)] } as never };
    await show();
    expect(map().classed("map-municipality").map(codeOf)).toEqual(["beaaa"]);
  });

  it("colours allowed and denied regions on the Regions step only", async () => {
    store.step.value = "regions";
    store.plan.value = {
      ...defaultPlan(),
      regions: {
        rows: [
          { code: "beaaa", labelKey: "", label: "A", group: "municipality", allow: true, deny: false },
          { code: "be-vov", labelKey: "", label: "P", group: "province", allow: false, deny: true },
        ],
        untaggedFlood: false,
        homeOverride: null,
        defaultScope: null,
      },
    };
    store.data.value = {
      failed: new Set(),
      municipalities: { type: "FeatureCollection", features: [muni("beaaa", 3, 50)] } as never,
      provinces: { type: "FeatureCollection", features: [{ type: "Feature", properties: { code: "be-vov" }, geometry: square(3, 50) }] },
    };
    await show();
    expect(map().classed("map-region-allowed").map(codeOf)).toEqual(["beaaa"]);
    expect(map().classed("map-region-denied").map(codeOf)).toEqual(["be-vov"]);
    act(() => {
      store.step.value = "place";
    });
    expect([...map().classed("map-region-allowed"), ...map().classed("map-region-denied")]).toHaveLength(0);
  });

  it("draws larger regions first so a denied municipality shows on top of an allowed province", async () => {
    store.step.value = "regions";
    store.plan.value = {
      ...defaultPlan(),
      regions: {
        rows: [
          { code: "beaaa", labelKey: "", label: "A", group: "municipality", allow: false, deny: true },
          { code: "be-vov", labelKey: "", label: "P", group: "province", allow: true, deny: false },
        ],
        untaggedFlood: false,
        homeOverride: null,
        defaultScope: null,
      },
    };
    store.data.value = {
      failed: new Set(),
      municipalities: { type: "FeatureCollection", features: [muni("beaaa", 3, 50)] } as never,
      provinces: { type: "FeatureCollection", features: [{ type: "Feature", properties: { code: "be-vov" }, geometry: square(3, 50) }] },
    };
    await show();
    const regions = map().live().areas.find((a) => a.options.onClick)!;
    expect(regions.features.map((f) => f.className)).toEqual(["map-region-allowed map-region-area", "map-region-denied"]);
  });

  it("fills allowed areas by level, the most specific one only: country and wider, province and gewest, municipality", async () => {
    const regions = (rows: [string, string][]) => ({
      rows: rows.map(([code, group]) => ({ code, labelKey: "", label: code, group, allow: true, deny: false })),
      untaggedFlood: false,
      homeOverride: null,
      defaultScope: null,
    });
    store.step.value = "regions";
    store.data.value = {
      failed: new Set(),
      municipalities: { type: "FeatureCollection", features: [muni("beaaa", 3, 50)] } as never,
      provinces: { type: "FeatureCollection", features: [{ type: "Feature", properties: { code: "be-vov" }, geometry: square(3, 50) }] },
      countries: { type: "FeatureCollection", features: [{ type: "Feature", properties: { code: "be" }, geometry: square(2, 49) }] },
    };
    store.plan.value = { ...defaultPlan(), regions: regions([["be", "country"]]) as never };
    await show();
    const classes = () => map().live().areas.find((a) => a.options.onClick)!.features.map((f) => `${codeOf(f)} ${f.className}`);
    expect(classes()).toEqual(["be map-region-allowed map-region-wide"]);
    act(() => void (store.plan.value = { ...defaultPlan(), regions: regions([["be", "country"], ["be-vov", "province"], ["beaaa", "municipality"]]) as never }));
    expect(classes()).toEqual([
      "be map-region-allowed map-region-outline",
      "be-vov map-region-allowed map-region-outline",
      "beaaa map-region-allowed map-region-municipality",
    ]);
  });

  it("draws a country outline per country when borders are on", async () => {
    store.data.value = {
      failed: new Set(),
      countries: {
        type: "FeatureCollection",
        features: [
          { type: "Feature", properties: { code: "be", name: "Belgium" }, geometry: square(3, 50) },
          { type: "Feature", properties: { code: "fr", name: "France" }, geometry: square(0, 46) },
        ],
      },
    };
    await show();
    const outlines = map().classed("map-outline-country");
    expect(outlines.map(codeOf)).toEqual(["be", "fr"]);
    expect(outlines[0].style).toMatchObject({ fill: false, weight: 2 });
    expect(outlines[0].area.options.interactive).toBe(false);
    fireEvent.click(screen.getByRole("checkbox", { name: "Borders" }));
    expect(map().classed("map-outline-country")).toHaveLength(0);
  });

  it("fills allowed countries under the gewest, province and municipality fills", async () => {
    store.step.value = "regions";
    store.plan.value = {
      ...defaultPlan(),
      regions: {
        rows: [
          { code: "beaaa", labelKey: "", label: "A", group: "municipality", allow: false, deny: true },
          { code: "be-vov", labelKey: "", label: "P", group: "province", allow: true, deny: false },
          { code: "be", labelKey: "", label: "Belgium", group: "country", allow: true, deny: false },
          { code: "fr", labelKey: "", label: "France", group: "country", allow: true, deny: false },
        ],
        untaggedFlood: false,
        homeOverride: null,
        defaultScope: null,
      },
    };
    store.data.value = {
      failed: new Set(),
      municipalities: { type: "FeatureCollection", features: [muni("beaaa", 3, 50)] } as never,
      provinces: { type: "FeatureCollection", features: [{ type: "Feature", properties: { code: "be-vov" }, geometry: square(3, 50) }] },
      countries: {
        type: "FeatureCollection",
        features: [
          { type: "Feature", properties: { code: "be", name: "Belgium" }, geometry: square(2, 49) },
          { type: "Feature", properties: { code: "fr", name: "France" }, geometry: square(0, 46) },
        ],
      },
    };
    await show();
    const kids = map().live().areas.find((a) => a.options.onClick)!.features;
    // only the most specific allowed level (the province) is filled; the countries keep their outline
    expect(kids.map((f) => f.className)).toEqual([
      "map-region-allowed map-region-outline",
      "map-region-allowed map-region-outline",
      "map-region-allowed map-region-area",
      "map-region-denied",
    ]);
    const codes = kids.map(codeOf);
    expect(codes.slice(0, 2).sort()).toEqual(["be", "fr"]);
    expect(codes.slice(2)).toEqual(["be-vov", "beaaa"]);
  });

  it("a focused region row outlines its area and zooms the map to it, on the Regions step", async () => {
    store.step.value = "regions";
    store.plan.value = {
      ...defaultPlan(),
      regions: {
        rows: [
          { code: "beaaa", labelKey: "", label: "A", group: "municipality", allow: true, deny: false },
          { code: "bebbb", labelKey: "", label: "B", group: "neighbourMunicipality", allow: false, deny: false },
        ],
        untaggedFlood: false,
        homeOverride: null,
        defaultScope: null,
      },
    };
    store.data.value = {
      failed: new Set(),
      municipalities: { type: "FeatureCollection", features: [muni("beaaa", 3, 50), muni("bebbb", 4, 50)] } as never,
    };
    await show();
    expect(map().classed("map-region-focus")).toHaveLength(0);
    // Not set rows have an area too: focusing one outlines it.
    act(() => {
      store.regionFocus.value = "bebbb";
    });
    expect(map().classed("map-region-focus").map(codeOf)).toEqual(["bebbb"]);
    expect(map().fitted).not.toBeNull();
    expect(map().fitted!.bounds).toEqual([[50, 4], [51, 5]]);
    act(() => {
      store.regionFocus.value = null;
    });
    expect(map().classed("map-region-focus")).toHaveLength(0);
    act(() => {
      store.regionFocus.value = "beaaa";
      store.step.value = "name";
    });
    expect(map().classed("map-region-focus")).toHaveLength(0);
  });

  it("a click on a region area on the map focuses its row, and a second click lets go", async () => {
    store.step.value = "regions";
    store.plan.value = {
      ...defaultPlan(),
      regions: {
        rows: [{ code: "beaaa", labelKey: "", label: "A", group: "municipality", allow: true, deny: false }],
        untaggedFlood: false,
        homeOverride: null,
        defaultScope: null,
      },
    };
    store.data.value = {
      failed: new Set(),
      municipalities: { type: "FeatureCollection", features: [muni("beaaa", 3, 50)] } as never,
    };
    await show();
    const [area] = map().classed("map-region-allowed");
    expect(area.area.options.onClick).toBeTruthy();
    act(() => area.area.click(area.feature as never));
    expect(store.regionFocus.value).toBe("beaaa");
    const [again] = map().classed("map-region-allowed");
    act(() => again.area.click(again.feature as never));
    expect(store.regionFocus.value).toBeNull();
  });

  it("draws no border line for the European Union", async () => {
    store.data.value = {
      failed: new Set(),
      countries: {
        type: "FeatureCollection",
        features: [
          { type: "Feature", properties: { code: "be", name: "Belgium" }, geometry: square(3, 50) },
          { type: "Feature", properties: { code: "eu", name: "European Union" }, geometry: square(0, 46) },
        ],
      },
    };
    await show();
    expect(map().classed("map-outline-country").map(codeOf)).toEqual(["be"]);
  });

  it("fills the European Union under the countries", async () => {
    store.step.value = "regions";
    store.plan.value = {
      ...defaultPlan(),
      regions: {
        rows: [
          { code: "be", labelKey: "", label: "Belgium", group: "country", allow: false, deny: true },
          { code: "eu", labelKey: "", label: "European Union", group: "country", allow: true, deny: false },
        ],
        untaggedFlood: false,
        homeOverride: null,
        defaultScope: null,
      },
    };
    store.data.value = {
      failed: new Set(),
      countries: {
        type: "FeatureCollection",
        features: [
          { type: "Feature", properties: { code: "be", name: "Belgium" }, geometry: square(2, 49) },
          { type: "Feature", properties: { code: "eu", name: "European Union" }, geometry: square(0, 46) },
        ],
      },
    };
    await show();
    const kids = map().live().areas.find((a) => a.options.onClick)!.features;
    expect(kids.map((f) => [codeOf(f), f.className])).toEqual([
      ["eu", "map-region-allowed map-region-wide"],
      ["be", "map-region-denied"],
    ]);
  });

  it("renders the map without countries when they failed to load", async () => {
    store.data.value = { failed: new Set(["countries"]) };
    await show();
    expect(map().live().areas).toHaveLength(0);
    expect((screen.getByRole("checkbox", { name: "Borders" }) as HTMLInputElement).disabled).toBe(false);
  });

  it("hides the map on the wide steps (Settings and Send)", async () => {
    const { container } = await show();
    const box = () => (container.querySelector(".map-container") as HTMLElement).hidden;
    expect(box()).toBe(false);
    for (const [step, hidden] of [["settings", true], ["name", false], ["send", true], ["regions", false]] as const) {
      act(() => void (store.step.value = step));
      expect(box()).toBe(hidden);
    }
  });

  it("re-measures the map when it is shown again", async () => {
    store.step.value = "settings";
    await show();
    const before = map().resized;
    act(() => {
      store.step.value = "regions";
    });
    expect(map().resized).toBeGreaterThan(before);
  });

  it("takes the map down when the view goes", async () => {
    const { unmount } = await show();
    act(() => unmount());
    expect(map().removed).toBe(true);
  });
});
