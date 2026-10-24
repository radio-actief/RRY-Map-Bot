import { beforeEach, describe, expect, it } from "vitest";
import { loadAppData, type Loaders } from "../src/state/appdata";
import { store } from "../src/state/store";

const collection = { type: "FeatureCollection" as const, features: [] };

function loaders(overrides: Partial<Loaders> = {}): Loaders {
  return {
    places: async () => [],
    municipalities: async () => ({ type: "FeatureCollection", features: [] }),
    provinces: async () => collection,
    gewesten: async () => collection,
    countries: async () => collection,
    nodes: async () => [],
    ...overrides,
  };
}

beforeEach(() => {
  store.data.value = { failed: new Set() };
});

describe("loadAppData", () => {
  it("loads everything, municipalities only once the deferred step runs", async () => {
    const deferred: (() => void)[] = [];
    await loadAppData(loaders(), (run) => deferred.push(run));
    expect(store.data.value.places).toEqual([]);
    expect(store.data.value.nodes).toEqual([]);
    expect(store.data.value.provinces).toBe(collection);
    expect(store.data.value.countries).toBe(collection);
    expect(store.data.value.municipalities).toBeUndefined();
    deferred.forEach((run) => run());
    await new Promise((r) => setTimeout(r, 0));
    expect(store.data.value.municipalities).toBeDefined();
    expect(store.data.value.failed.size).toBe(0);
  });

  it("records each failure by name and still loads the rest", async () => {
    const boom = async () => {
      throw new Error("down");
    };
    const deferred: (() => void)[] = [];
    await loadAppData(loaders({ nodes: boom, municipalities: boom }), (run) => deferred.push(run));
    deferred.forEach((run) => run());
    await new Promise((r) => setTimeout(r, 0));
    expect([...store.data.value.failed].sort()).toEqual(["municipalities", "nodes"]);
    expect(store.data.value.places).toEqual([]);
    expect(store.data.value.gewesten).toBe(collection);
  });
});
