/**
 * The configurator's maps on the tool pages' map engine (src/map-engine/): MapLibre where the browser
 * has WebGL 2, else Leaflet, with the same base maps, controls, shade switch and keyboard. Both load
 * only when a map is made (their own chunks); Leaflet is the npm package Vite bundles.
 */
import { createMapEngine, type EngineOptions, type MapEngine } from "../../../../src/map-engine/index.js";
import "../../../../src/shared/map-shade.js";
import "../../../../src/shared/map-engine.css";
import { t } from "../i18n/t";

export type { AreaLayer, Bounds, GeoFeature, Mark, MapEngine, Removable, Spot } from "../../../../src/map-engine/index.js";

const loaders = {
  maplibre: () => import("../../../../src/map-engine/maplibre-engine.js").then((m) => m.createMapLibreEngine),
  leaflet: async () => {
    const [mod, engine] = await Promise.all([
      import("leaflet"),
      import("../../../../src/map-engine/leaflet-engine.js"),
      import("leaflet/dist/leaflet.css"),
    ]);
    // the namespace has Leaflet's functions; a bundle that only gives a default has them there
    const L = typeof (mod as { map?: unknown }).map === "function" ? mod : (mod as unknown as { default: unknown }).default;
    return (container: HTMLElement, options: EngineOptions) => engine.createLeafletEngine(container, { ...options, leaflet: L });
  },
};

/** A map in `container` (zoom as Leaflet counts it). */
export function createMap(container: HTMLElement, options: Omit<EngineOptions, "t">): Promise<MapEngine> {
  return createMapEngine(container, { t, attribution: "", ...options }, { load: loaders });
}
