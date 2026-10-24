import { act, cleanup, fireEvent, render, screen } from "@testing-library/preact";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("leaflet", async () => await import("./fakes/leaflet"));

import { MapView } from "../src/app/MapView";
import { defaultPlan } from "../src/core/plan";
import { store } from "../src/state/store";
import { ofKind, resetFake } from "./fakes/leaflet";

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

// Groups are created once per map, in this order.
const bordersGroup = () => ofKind("group")[0];
const highlightGroup = () => ofKind("group")[1];
const regionsGroup = () => ofKind("group")[2];
const nodesGroup = () => ofKind("group")[3];

beforeEach(() => {
  resetFake();
  store.plan.value = defaultPlan();
  store.step.value = 2;
  store.layers.value = { nodes: true, borders: true };
  store.data.value = { failed: new Set() };
});
afterEach(cleanup);

describe("MapView", () => {
  it("a map click sets plan.location", () => {
    render(<MapView />);
    const map = ofKind("map")[0];
    act(() => map.fire("click", { latlng: { lat: 50.7, lng: 3.6 } }));
    expect(store.plan.value.location).toEqual({ lat: 50.7, lon: 3.6 });
  });

  it("a map click and a pin drag round the coordinates to 6 decimals, as the old page did", () => {
    render(<MapView />);
    act(() => ofKind("map")[0].fire("click", { latlng: { lat: 50.74755123456, lng: 3.602094999 } }));
    expect(store.plan.value.location).toEqual({ lat: 50.747551, lon: 3.602095 });
    const pin = ofKind("marker")[0];
    pin.getLatLng = () => ({ lat: 51.12345678, lng: 4.98765432 });
    act(() => pin.fire("dragend"));
    expect(store.plan.value.location).toEqual({ lat: 51.123457, lon: 4.987654 });
  });

  it("dragging the pin sets plan.location", () => {
    store.plan.value = { ...defaultPlan(), location: { lat: 50.7, lon: 3.6 } };
    render(<MapView />);
    const pin = ofKind("marker")[0];
    expect(pin.options.draggable).toBe(true);
    pin.getLatLng = () => ({ lat: 51, lng: 4 });
    act(() => pin.fire("dragend"));
    expect(store.plan.value.location).toEqual({ lat: 51, lon: 4 });
  });

  it("shows markers for repeaters and room servers within 25 km, not companions", () => {
    store.plan.value = { ...defaultPlan(), location: { lat: 50.7, lon: 3.6 } };
    store.data.value = {
      failed: new Set(),
      nodes: [node(1, "c", 50.71, 3.6), node(2, "r", 50.72, 3.6), node(3, "s", 50.7, 3.62), node(2, "far", 52, 5)],
    };
    render(<MapView />);
    expect(nodesGroup().children.filter((m) => m.tooltip)).toHaveLength(2);
    expect(screen.getByRole("checkbox", { name: "Nearby nodes (2)" })).toBeTruthy();
  });

  it("marks the switch unavailable and disabled when the data failed", () => {
    store.data.value = { failed: new Set(["nodes"]) };
    render(<MapView />);
    expect(screen.getByText(/Nearby nodes.*unavailable/)).toBeTruthy();
    expect((screen.getByRole("checkbox", { name: /Nearby nodes/ }) as HTMLInputElement).disabled).toBe(true);
    expect((screen.getByRole("checkbox", { name: "Borders" }) as HTMLInputElement).disabled).toBe(false);
  });

  it("toggling Borders updates store.layers and hides the outlines", () => {
    store.data.value = {
      failed: new Set(),
      provinces: { type: "FeatureCollection", features: [{ type: "Feature", properties: { code: "be-vov" }, geometry: square(3, 50) }] },
    };
    render(<MapView />);
    expect(bordersGroup().children.length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole("checkbox", { name: "Borders" }));
    expect(store.layers.value.borders).toBe(false);
    expect(bordersGroup().children).toHaveLength(0);
  });

  it("keeps the outlines when the pin moves; only the highlight follows it", () => {
    store.plan.value = { ...defaultPlan(), location: { lat: 50.5, lon: 3.5 } };
    store.data.value = {
      failed: new Set(),
      provinces: { type: "FeatureCollection", features: [{ type: "Feature", properties: { code: "be-vov" }, geometry: square(3, 50) }] },
      municipalities: { type: "FeatureCollection", features: [muni("beaaa", 3, 50), muni("bebbb", 8, 50)] } as never,
    };
    render(<MapView />);
    const outline = bordersGroup().children[0];
    expect(highlightGroup().children).toHaveLength(1);
    act(() => {
      store.plan.value = { ...store.plan.value, location: { lat: 50.5, lon: 8.5 } };
    });
    expect(bordersGroup().children).toHaveLength(1);
    expect(bordersGroup().children[0]).toBe(outline);
    expect((highlightGroup().children[0].args[0] as any).properties.city_code).toBe("bebbb");
  });

  it("highlights only the matched municipality", () => {
    store.plan.value = { ...defaultPlan(), location: { lat: 50.5, lon: 3.5 } };
    store.data.value = { failed: new Set(), municipalities: { type: "FeatureCollection", features: [muni("beaaa", 3, 50), muni("bebbb", 8, 50)] } as never };
    render(<MapView />);
    const highlighted = highlightGroup().children.filter((g) => g.options.className === "map-municipality");
    expect(highlighted).toHaveLength(1);
    expect((highlighted[0].args[0] as any).properties.city_code).toBe("beaaa");
  });

  it("colours allowed and denied regions on step 3 only", () => {
    store.step.value = 3;
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
    render(<MapView />);
    const cls = (c: string) => regionsGroup().children.filter((g) => g.options.className === c);
    expect(cls("map-region-allowed")).toHaveLength(1);
    expect(cls("map-region-denied")).toHaveLength(1);
    act(() => {
      store.step.value = 2;
    });
    expect(regionsGroup().children).toHaveLength(0);
  });

  it("draws larger regions first so a denied municipality shows on top of an allowed province", () => {
    store.step.value = 3;
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
    render(<MapView />);
    expect(regionsGroup().children.map((g) => g.options.className)).toEqual(["map-region-allowed", "map-region-denied"]);
  });

  it("re-measures the map when it is shown again", () => {
    store.step.value = 4;
    render(<MapView />);
    const map = ofKind("map")[0];
    const before = map.invalidated;
    act(() => {
      store.step.value = 3;
    });
    expect(map.invalidated).toBeGreaterThan(before);
  });
});
