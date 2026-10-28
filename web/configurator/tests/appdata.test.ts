import { beforeEach, describe, expect, it, vi } from "vitest";
import { ensureData, loadAppData, loadOnDemand, resetLoaded, type Loaders } from "../src/state/appdata";
import { defaultPlan } from "../src/core/plan";
import { store } from "../src/state/store";

const collection = { type: "FeatureCollection" as const, features: [] };

function loaders(overrides: Partial<Loaders> = {}): Loaders {
  return {
    places: vi.fn(async () => []),
    municipalities: vi.fn(async () => ({ type: "FeatureCollection" as const, features: [] })),
    provinces: vi.fn(async () => collection),
    gewesten: vi.fn(async () => collection),
    countries: vi.fn(async () => collection),
    nodes: vi.fn(async () => []),
    ...overrides,
  };
}

const settle = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => {
  resetLoaded();
  store.data.value = { failed: new Set() };
  store.step.value = "connect";
  store.plan.value = defaultPlan();
});

describe("loadAppData", () => {
  it("loads only the places at start; the rest waits until it is needed", async () => {
    const l = loaders();
    await loadAppData(l);
    expect(store.data.value.places).toEqual([]);
    expect(l.nodes).not.toHaveBeenCalled();
    expect(l.municipalities).not.toHaveBeenCalled();
    expect(l.countries).not.toHaveBeenCalled();
  });
});

describe("ensureData", () => {
  it("loads each data set once, however often it is asked for", async () => {
    const l = loaders();
    await ensureData(["countries", "provinces"], l);
    await ensureData(["countries", "provinces", "gewesten"], l);
    expect(l.countries).toHaveBeenCalledTimes(1);
    expect(l.gewesten).toHaveBeenCalledTimes(1);
    expect(store.data.value.provinces).toBe(collection);
  });

  it("records each failure by name and still loads the rest", async () => {
    const boom = async () => {
      throw new Error("down");
    };
    await ensureData(["nodes", "municipalities", "places", "gewesten"], loaders({ nodes: boom, municipalities: boom }));
    expect([...store.data.value.failed].sort()).toEqual(["municipalities", "nodes"]);
    expect(store.data.value.places).toEqual([]);
    expect(store.data.value.gewesten).toBe(collection);
  });
});

describe("loadOnDemand", () => {
  it("starts the borders and the node list once the user leaves Connect", async () => {
    const l = loaders();
    const stop = loadOnDemand(l);
    await settle();
    expect(l.municipalities).not.toHaveBeenCalled();
    expect(l.nodes).not.toHaveBeenCalled();
    store.step.value = "place";
    await settle();
    expect(l.municipalities).toHaveBeenCalledTimes(1);
    expect(l.nodes).toHaveBeenCalledTimes(1);
    stop();
  });

  it("or as soon as the plan has a location (a Read on Connect)", async () => {
    const l = loaders();
    const stop = loadOnDemand(l);
    store.plan.value = { ...defaultPlan(), location: { lat: 50.8, lon: 4.3 } };
    await settle();
    expect(l.municipalities).toHaveBeenCalledTimes(1);
    expect(l.nodes).toHaveBeenCalledTimes(1);
    stop();
  });
});
