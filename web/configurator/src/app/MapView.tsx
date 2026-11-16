/**
 * The map: location pin, 25 km ring, nearby nodes, borders and (Regions step) region colours, on the
 * tool pages' map engine (./map-engine: MapLibre, or Leaflet without WebGL).
 * On the Companion page it shows no repeater pin or nodes, only the area of the region in focus.
 */
import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import { GEWEST_NAMES } from "../core/be-regions";
import { municipalityAt, nodesWithin, NEIGHBOR_RADIUS_KM, roundCoord, type LatLon } from "../core/geo";
import { regionsByState } from "../core/regions";
import { t } from "../i18n/t";
import { isWide, municipalities as municipalityList, setLocation, store } from "../state/store";
import { settleAfterKeyboard } from "../../../../src/shared/viewport-settle.js";
import { boundsOfGeoJSON } from "../../../../src/map-engine/geo.js";
import { centreInView, fitInView } from "./map-insets";
import { createMap, type AreaLayer, type Bounds, type GeoFeature, type MapEngine, type Mark, type Removable } from "./map-engine";

const BELGIUM: LatLon = { lat: 50.6, lon: 4.6 };
const PIN_ZOOM = 11;

type Feature = GeoFeature;
const featuresOf = (data: unknown): Feature[] =>
  Array.isArray(data) ? (data as Feature[]) : ((data as { features?: Feature[] } | undefined)?.features ?? []);

/** The phone sheet's height change takes 0.25s (app.css); refit after it. */
const SHEET_SETTLE_MS = 300;

/** The gold location pin (css: .map-pin). */
export const PIN = { className: "map-pin", html: "<span></span>", size: [28, 36] as [number, number], anchor: [14, 36] as [number, number] };

/** A repeater (▲) or room server (■) near the pin, its name on hover. */
const nodeMark = (type: number, name: string) => {
  const repeater = type === 2;
  return {
    className: `map-node ${repeater ? "map-node-repeater" : "map-node-room"}`,
    html: repeater ? "▲" : "■",
    size: [18, 18] as [number, number],
    interactive: false,
    tooltip: name,
  };
};

const removeAll = (list: Removable[]) => {
  for (const item of list.splice(0)) item.remove();
};

export function MapView() {
  const host = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapEngine | null>(null);
  /** Bumped once the map is in, so the drawing effects run (the engine loads on its own). */
  const [ready, setReady] = useState(0);
  /** The outlined area's bounds, refitted when the phone sheet changes height. */
  const focusBounds = useRef<Bounds | null>(null);
  const drawn = useRef<{ nodes: Removable[]; borders: Removable[]; highlight: Removable[]; regions: Removable[]; focus: Removable[] }>({
    nodes: [],
    borders: [],
    highlight: [],
    regions: [],
    focus: [],
  });
  const pin = useRef<{ marker: Mark; ring: Removable } | null>(null);
  const fromMap = useRef<unknown>(null);

  const plan = store.plan.value;
  const step = store.step.value;
  const companion = store.task.value === "companion";
  const hidden = isWide(step) && !companion;
  const layers = store.layers.value;
  const data = store.data.value;
  const location = companion ? null : plan.location;
  const failed = data.failed;

  const nearby = useMemo(
    () => (location && data.nodes ? nodesWithin(data.nodes, location, NEIGHBOR_RADIUS_KM) : []),
    [location, data.nodes],
  );
  const municipalities = municipalityList.value;
  const sheetHeight = store.sheet.value;
  const focus = companion ? store.companionFocus.value : step === "regions" ? store.regionFocus.value : null;

  /** Each region code's areas: a municipality's polygons, or the country, province, gewest or EU outline. */
  const areas = useMemo(() => {
    const byCode = new Map<string, Feature[]>();
    const put = (code: string, f: Feature) => byCode.set(code, [...(byCode.get(code) ?? []), f]);
    for (const f of [...featuresOf(data.countries), ...featuresOf(data.provinces), ...featuresOf(data.gewesten)]) {
      byCode.set(String(f.properties?.code), [f]);
    }
    for (const f of municipalities as unknown as Feature[]) put(String(f.properties?.city_code), f);
    return byCode;
  }, [municipalities, data.countries, data.provinces, data.gewesten]);

  useEffect(() => {
    let alive = true;
    let detachKeyboard = () => {};
    const start = store.plan.peek().location;
    // Controls bottom left, beside the docked panel (top right on a phone: app.css).
    createMap(host.current!, { center: start ?? BELGIUM, zoom: start ? PIN_ZOOM : 8 })
      .then((map) => {
        if (!alive) return map.remove();
        // Only Place moves the pin with a click: elsewhere a stray click would silently change the regions.
        map.on("click", (e) => {
          if (store.step.peek() === "place" && store.task.peek() === "repeater") pick(e.lat, e.lon);
        });
        mapRef.current = map;
        // the page's map, for the browser checks (as on the map page and the region map)
        (window as unknown as { bemeshMap?: MapEngine }).bemeshMap = map;
        // The phone keyboard changes the visible height: re-measure, and undo a shifted page once it closes.
        detachKeyboard = settleAfterKeyboard(() => map.resize());
        setReady((n) => n + 1);
      })
      .catch((e) => console.error("The map could not start", e));
    return () => {
      alive = false;
      detachKeyboard();
      mapRef.current?.remove();
      mapRef.current = null;
      pin.current = null;
    };
  }, []);

  /** A map click or pin drag (to 6 decimals): the pin stays where the user put it, without recentring. */
  function pick(lat: number, lon: number) {
    const next = { lat: roundCoord(lat), lon: roundCoord(lon) };
    fromMap.current = next;
    setLocation(next);
  }

  // Pin and ring follow plan.location.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (!location) {
      pin.current?.marker.remove();
      pin.current?.ring.remove();
      pin.current = null;
      return;
    }
    const ring = () => map.addCircle(location, NEIGHBOR_RADIUS_KM * 1000, { className: "map-ring", dashArray: "6 6", fill: false });
    if (pin.current) {
      pin.current.marker.setLatLng(location);
      pin.current.ring.remove();
      pin.current.ring = ring();
    } else {
      const marker = map.addMarker(location, { ...PIN, draggable: true, title: t("map.pin") });
      marker.on("dragend", () => {
        const p = marker.getLatLng();
        pick(p.lat, p.lon);
      });
      pin.current = { marker, ring: ring() };
    }
    // A searched place or "use my location": centre it where the panel doesn't cover it.
    if (location !== fromMap.current) centreInView(map, location, Math.max(map.getZoom(), PIN_ZOOM));
  }, [location, ready]);

  // Repeaters and room servers near the pin.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    removeAll(drawn.current.nodes);
    if (!layers.nodes) return;
    for (const n of nearby) drawn.current.nodes.push(map.addMarker({ lat: n.adv_lat, lon: n.adv_lon }, nodeMark(n.type, n.adv_name)));
  }, [nearby, layers.nodes, ready]);

  // Country, province and gewest outlines; they do not change with the pin.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    removeAll(drawn.current.borders);
    if (!layers.borders) return;
    // The European Union shares most of its edge with the countries; only its fill is drawn.
    const countries = featuresOf(data.countries).filter((f) => f.properties?.code !== "eu");
    if (countries.length) {
      drawn.current.borders.push(map.addGeoJSON(countries, { style: () => ({ className: "map-outline-country", fill: false, weight: 2 }), interactive: false }));
    }
    for (const c of [data.provinces, data.gewesten]) {
      if (c) drawn.current.borders.push(map.addGeoJSON(c, { style: () => ({ className: "map-outline", fill: false, weight: 1 }), interactive: false }));
    }
  }, [layers.borders, data.countries, data.provinces, data.gewesten, ready]);

  // The municipality under the pin.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    removeAll(drawn.current.highlight);
    if (!layers.borders) return;
    const match = location && municipalities.length ? municipalityAt(location, municipalities) : null;
    if (match) drawn.current.highlight.push(map.addGeoJSON(match, { style: () => ({ className: "map-municipality" }), interactive: false }));
  }, [layers.borders, municipalities, location, ready]);

  // Regions step: allowed / denied region polygons; a click on one shows its row (and a second click lets go).
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    removeAll(drawn.current.regions);
    if (companion || step !== "regions" || !plan.regions) return;
    const { allowed, denied } = regionsByState(plan.regions);
    // Largest area first (eu, country, gewest, province, municipality), so a smaller area stays visible on top.
    const countryCodes = new Set(featuresOf(data.countries).map((f) => String(f.properties?.code)));
    const cities = new Set((municipalities as unknown as Feature[]).map((f) => String(f.properties?.city_code)));
    const level = (code: string) =>
      cities.has(code) ? 2 : GEWEST_NAMES[code] ? 0 : code === "eu" ? -2 : countryCodes.has(code) ? -1 : 1;
    // The fill of allowed areas: country and wider, province and gewest, municipality. Only the most
    // specific allowed level on the map is filled; the wider allowed areas keep their outline.
    const tier = (code: string) => (level(code) <= -1 ? "wide" : level(code) >= 2 ? "municipality" : "area");
    const RANK = { wide: 0, area: 1, municipality: 2 };
    const shown = allowed.filter((code) => areas.has(code));
    const finest = Math.max(-1, ...shown.map((code) => RANK[tier(code)]));
    const allowedClass = (code: string) =>
      RANK[tier(code)] < finest ? "map-region-allowed map-region-outline" : `map-region-allowed map-region-${tier(code)}`;
    const wanted = [
      ...denied.map((code) => ({ code, className: "map-region-denied" })),
      ...allowed.map((code) => ({ code, className: allowedClass(code) })),
    ].sort((a, b) => level(a.code) - level(b.code));
    const look = new Map<Feature, { code: string; className: string }>();
    for (const w of wanted) for (const f of areas.get(w.code) ?? []) look.set(f, w);
    if (!look.size) return;
    drawn.current.regions.push(
      map.addGeoJSON([...look.keys()], {
        style: (f) => ({ className: look.get(f)?.className }),
        onClick: (f) => {
          const code = look.get(f)?.code ?? null;
          store.regionFocus.value = store.regionFocus.peek() === code ? null : code;
        },
      }),
    );
  }, [companion, step, plan.regions, municipalities, areas, data.countries, ready]);

  // Regions step: the focused row's area; Companion page: the region of the place or channel. Outlined, with the map zoomed to it.
  useEffect(() => {
    const map = mapRef.current;
    removeAll(drawn.current.focus);
    focusBounds.current = null;
    if (!map || !focus) return;
    const fs = areas.get(focus);
    if (!fs?.length) return;
    const layer: AreaLayer = map.addGeoJSON(fs, { style: () => ({ className: "map-region-focus" }), interactive: false });
    drawn.current.focus.push(layer);
    const bounds = boundsOfGeoJSON(fs);
    if (!bounds) return;
    focusBounds.current = bounds;
    // The panel covers part of the map (docked on the left, the phone sheet below): fit into what
    // stays visible. A full sheet comes down to half first, so the area isn't a speck in a strip,
    // except on the Companion page, where the full sheet holds the channels people came for: there
    // the area fits the whole map, and refits when they lower the sheet.
    fitInView(map, bounds, 13, () => {
      if (companion || store.sheet.peek() !== "full" || !document.querySelector(".panel.sheet.full")) return false;
      store.sheet.value = "half";
      return true;
    });
  }, [focus, areas, companion, ready]);

  // The sheet moved (by hand, or lowered above): refit the outlined area once, after the sheet's
  // own animation. Never moves the sheet itself, so a sheet raised by hand stays raised.
  useEffect(() => {
    const map = mapRef.current;
    const bounds = focusBounds.current;
    if (!map || !bounds || !focus) return;
    const id = setTimeout(() => fitInView(map, bounds, 13), SHEET_SETTLE_MS);
    return () => clearTimeout(id);
  }, [sheetHeight]);

  // The container is hidden on the wide steps (Advanced, Send); the map must re-measure when it comes back.
  useEffect(() => {
    if (!hidden) mapRef.current?.resize();
  }, [hidden]);

  const nodesFailed = failed.has("nodes");
  const bordersFailed = ["countries", "provinces", "gewesten", "municipalities"].every((n) => failed.has(n));
  const toggle = (key: "nodes" | "borders") => (store.layers.value = { ...store.layers.peek(), [key]: !store.layers.peek()[key] });

  return (
    <div class="map-container" hidden={hidden}>
      <div class="map-canvas" ref={host} />
      <svg class="map-defs" width="0" height="0" aria-hidden="true">
        <defs>
          <pattern id="map-hatch" width="8" height="8" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <line x1="0" y1="0" x2="0" y2="8" style="stroke: var(--bad); stroke-width: 3; stroke-opacity: 0.55" />
          </pattern>
        </defs>
      </svg>
      <fieldset class="map-layers glass" aria-label={t("map.layers")}>
        {companion ? null : (
          <label class={nodesFailed ? "disabled" : ""}>
            <input type="checkbox" checked={layers.nodes && !nodesFailed} disabled={nodesFailed} onChange={() => toggle("nodes")} />
            {nodesFailed ? `${t("map.nodes")} ${t("map.unavailable")}` : t("map.nearbyNodes", { count: nearby.length })}
          </label>
        )}
        <label class={bordersFailed ? "disabled" : ""}>
          <input type="checkbox" checked={layers.borders && !bordersFailed} disabled={bordersFailed} onChange={() => toggle("borders")} />
          {bordersFailed ? `${t("map.borders")} ${t("map.unavailable")}` : t("map.borders")}
        </label>
      </fieldset>
    </div>
  );
}
