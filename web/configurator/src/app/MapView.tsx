/** The Leaflet map: location pin, 25 km ring, nearby nodes, borders and (Regions step) region colours. */
import * as L from "leaflet";
import "leaflet/dist/leaflet.css";
import type { GeoJsonObject } from "geojson";
import { useEffect, useMemo, useRef } from "preact/hooks";
import "../../../../src/shared/map-shade.js";
import { GEWEST_NAMES } from "../core/be-regions";
import { municipalityAt, nodesWithin, NEIGHBOR_RADIUS_KM, roundCoord, type LatLon } from "../core/geo";
import { regionsByState } from "../core/regions";
import { t } from "../i18n/t";
import { isWide, municipalities as municipalityList, setLocation, store } from "../state/store";

export const TILE_URL = "https://tile.openstreetmap.org/{z}/{x}/{y}.png";
export const ATTRIBUTION = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';
const BELGIUM: L.LatLngTuple = [50.6, 4.6];
const PIN_ZOOM = 11;

declare global {
  interface Window {
    BEmeshMapShade: { attach(l: typeof L, map: L.Map, tiles: L.TileLayer, opts?: { position?: L.ControlPosition }): () => void };
  }
}

type Feature = { type: "Feature"; properties?: Record<string, unknown>; geometry: unknown };
const featuresOf = (data: unknown): Feature[] =>
  Array.isArray(data) ? (data as Feature[]) : ((data as { features?: Feature[] } | undefined)?.features ?? []);

const asLatLng = (p: LatLon): L.LatLngTuple => [p.lat, p.lon];

/** The gold location pin. */
export const pinIcon = (): L.DivIcon =>
  L.divIcon({ className: "map-pin", html: "<span></span>", iconSize: [28, 36], iconAnchor: [14, 36] });

function nodeIcon(type: number): L.DivIcon {
  const repeater = type === 2;
  return L.divIcon({
    className: `map-node ${repeater ? "map-node-repeater" : "map-node-room"}`,
    html: repeater ? "▲" : "■",
    iconSize: [18, 18],
  });
}

/** GeoJSON options are handed to each path, so className applies at creation; the typings omit it. */
const pathClass = (className: string, extra: L.GeoJSONOptions = {}): L.GeoJSONOptions =>
  ({ className, interactive: false, ...extra }) as L.GeoJSONOptions;

function tooltipFor(name: string): HTMLElement {
  const el = document.createElement("span");
  el.textContent = name;
  return el;
}

export function MapView() {
  const host = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const groups = useRef<{
    nodes: L.LayerGroup;
    borders: L.LayerGroup;
    highlight: L.LayerGroup;
    regions: L.LayerGroup;
    focus: L.LayerGroup;
  } | null>(null);
  const pin = useRef<{ marker: L.Marker; ring: L.Circle } | null>(null);
  const fromMap = useRef<unknown>(null);

  const plan = store.plan.value;
  const step = store.step.value;
  const layers = store.layers.value;
  const data = store.data.value;
  const location = plan.location;
  const failed = data.failed;

  const nearby = useMemo(
    () => (location && data.nodes ? nodesWithin(data.nodes, location, NEIGHBOR_RADIUS_KM) : []),
    [location, data.nodes],
  );
  const municipalities = municipalityList.value;
  const focus = store.regionFocus.value;

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
    const map = L.map(host.current!, { zoomControl: true });
    const start = store.plan.peek().location;
    map.setView(start ? asLatLng(start) : BELGIUM, start ? PIN_ZOOM : 8);
    const tiles = L.tileLayer(TILE_URL, { attribution: ATTRIBUTION, maxZoom: 19, className: "osm-tiles" }).addTo(map);
    const detachShade = window.BEmeshMapShade.attach(L, map, tiles, { position: "topright" });
    groups.current = {
      borders: L.layerGroup().addTo(map),
      highlight: L.layerGroup().addTo(map),
      regions: L.layerGroup().addTo(map),
      nodes: L.layerGroup().addTo(map),
      focus: L.layerGroup().addTo(map),
    };
    // Only Place moves the pin with a click: elsewhere a stray click would silently change the regions.
    map.on("click", (e: L.LeafletMouseEvent) => {
      if (store.step.peek() === "place") pick(e.latlng.lat, e.latlng.lng);
    });
    mapRef.current = map;
    return () => {
      detachShade();
      map.remove();
      mapRef.current = null;
      groups.current = null;
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
    const ll = asLatLng(location);
    if (pin.current) {
      pin.current.marker.setLatLng(ll);
      pin.current.ring.setLatLng(ll);
    } else {
      const marker = L.marker(ll, { draggable: true, title: t("map.pin"), icon: pinIcon() }).addTo(map);
      marker.on("dragend", () => {
        const p = marker.getLatLng();
        pick(p.lat, p.lng);
      });
      const ring = L.circle(ll, {
        radius: NEIGHBOR_RADIUS_KM * 1000,
        className: "map-ring",
        dashArray: "6 6",
        fill: false,
        interactive: false,
      }).addTo(map);
      pin.current = { marker, ring };
    }
    if (location !== fromMap.current) map.setView(ll, Math.max(map.getZoom?.() ?? 0, PIN_ZOOM));
  }, [location]);

  // Repeaters and room servers near the pin.
  useEffect(() => {
    const g = groups.current?.nodes;
    if (!g) return;
    g.clearLayers();
    if (!layers.nodes) return;
    for (const n of nearby) {
      L.marker([n.adv_lat, n.adv_lon], { icon: nodeIcon(n.type), keyboard: false })
        .bindTooltip(tooltipFor(n.adv_name))
        .addTo(g);
    }
  }, [nearby, layers.nodes]);

  // Country, province and gewest outlines; they do not change with the pin.
  useEffect(() => {
    const g = groups.current?.borders;
    if (!g) return;
    g.clearLayers();
    if (!layers.borders) return;
    // The European Union shares most of its edge with the countries; only its fill is drawn.
    for (const f of featuresOf(data.countries).filter((f) => f.properties?.code !== "eu")) {
      L.geoJSON(f as GeoJsonObject, pathClass("map-outline-country", { style: () => ({ fill: false, weight: 2 }) })).addTo(g);
    }
    for (const c of [data.provinces, data.gewesten]) {
      if (c) L.geoJSON(c as GeoJsonObject, pathClass("map-outline", { style: () => ({ fill: false, weight: 1 }) })).addTo(g);
    }
  }, [layers.borders, data.countries, data.provinces, data.gewesten]);

  // The municipality under the pin.
  useEffect(() => {
    const g = groups.current?.highlight;
    if (!g) return;
    g.clearLayers();
    if (!layers.borders) return;
    const match = location && municipalities.length ? municipalityAt(location, municipalities) : null;
    if (match) L.geoJSON(match as unknown as GeoJsonObject, pathClass("map-municipality")).addTo(g);
  }, [layers.borders, municipalities, location]);

  // Regions step: allowed / denied region polygons; a click on one shows its row (and a second click lets go).
  useEffect(() => {
    const g = groups.current?.regions;
    if (!g) return;
    g.clearLayers();
    if (step !== "regions" || !plan.regions) return;
    const { allowed, denied } = regionsByState(plan.regions);
    // Largest area first (eu, country, gewest, province, municipality), so a smaller area stays visible on top.
    const countryCodes = new Set(featuresOf(data.countries).map((f) => String(f.properties?.code)));
    const cities = new Set((municipalities as unknown as Feature[]).map((f) => String(f.properties?.city_code)));
    const level = (code: string) =>
      cities.has(code) ? 2 : GEWEST_NAMES[code] ? 0 : code === "eu" ? -2 : countryCodes.has(code) ? -1 : 1;
    const wanted = [
      ...denied.map((code) => ({ code, className: "map-region-denied" })),
      ...allowed.map((code) => ({ code, className: "map-region-allowed" })),
    ].sort((a, b) => level(a.code) - level(b.code));
    for (const { code, className } of wanted) {
      for (const f of areas.get(code) ?? []) {
        L.geoJSON(f as GeoJsonObject, pathClass(className, { interactive: true }))
          .on("click", () => (store.regionFocus.value = store.regionFocus.peek() === code ? null : code))
          .addTo(g);
      }
    }
  }, [step, plan.regions, municipalities, areas, data.countries]);

  // Regions step: the focused row's area, outlined, with the map zoomed to it.
  useEffect(() => {
    const g = groups.current?.focus;
    if (!g) return;
    g.clearLayers();
    if (step !== "regions" || !focus) return;
    const fs = areas.get(focus);
    if (!fs?.length) return;
    const layers = fs.map((f) => L.geoJSON(f as GeoJsonObject, pathClass("map-region-focus")).addTo(g));
    const bounds = layers.slice(1).reduce((b, l) => b.extend(l.getBounds()), layers[0].getBounds());
    mapRef.current?.fitBounds(bounds, { padding: [24, 24], maxZoom: 13 });
  }, [step, focus, areas]);

  // The container is hidden on the wide steps (Advanced, Send); Leaflet must re-measure when it comes back.
  useEffect(() => {
    if (!isWide(step)) mapRef.current?.invalidateSize();
  }, [isWide(step)]);

  const nodesFailed = failed.has("nodes");
  const bordersFailed = ["countries", "provinces", "gewesten", "municipalities"].every((n) => failed.has(n));
  const toggle = (key: "nodes" | "borders") => (store.layers.value = { ...store.layers.peek(), [key]: !store.layers.peek()[key] });

  return (
    <div class="map-container" hidden={isWide(step)}>
      <div class="map-canvas" ref={host} />
      <svg class="map-defs" width="0" height="0" aria-hidden="true">
        <defs>
          <pattern id="map-hatch" width="8" height="8" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <line x1="0" y1="0" x2="0" y2="8" style="stroke: var(--bad); stroke-width: 3; stroke-opacity: 0.55" />
          </pattern>
        </defs>
      </svg>
      <fieldset class="map-layers" aria-label={t("map.layers")}>
        <label class={nodesFailed ? "disabled" : ""}>
          <input type="checkbox" checked={layers.nodes && !nodesFailed} disabled={nodesFailed} onChange={() => toggle("nodes")} />
          {nodesFailed ? `${t("map.nodes")} ${t("map.unavailable")}` : t("map.nearbyNodes", { count: nearby.length })}
        </label>
        <label class={bordersFailed ? "disabled" : ""}>
          <input type="checkbox" checked={layers.borders && !bordersFailed} disabled={bordersFailed} onChange={() => toggle("borders")} />
          {bordersFailed ? `${t("map.borders")} ${t("map.unavailable")}` : t("map.borders")}
        </label>
      </fieldset>
    </div>
  );
}
