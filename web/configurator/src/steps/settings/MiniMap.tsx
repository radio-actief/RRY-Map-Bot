/** A small Leaflet map without interaction: tiles, the pin and the municipality under it. */
import * as L from "leaflet";
import type { GeoJsonObject } from "geojson";
import { useEffect, useRef } from "preact/hooks";
import { ATTRIBUTION, pinIcon, TILE_URL } from "../../app/MapView";
import { municipalityAt } from "../../core/geo";
import { homeRegionCode } from "../../core/regions";
import { t } from "../../i18n/t";
import { municipalities as municipalityList, store } from "../../state/store";

export function MiniMap() {
  const host = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const group = useRef<L.LayerGroup | null>(null);
  const { location, regions, anchor } = store.plan.value;
  const municipalities = municipalityList.value;
  const match = location && municipalities.length ? municipalityAt(location, municipalities) : null;

  useEffect(() => {
    const map = L.map(host.current!, {
      zoomControl: false,
      dragging: false,
      scrollWheelZoom: false,
      doubleClickZoom: false,
      boxZoom: false,
      keyboard: false,
      touchZoom: false,
    });
    map.setView([50.6, 4.6], 8);
    L.tileLayer(TILE_URL, { attribution: ATTRIBUTION, maxZoom: 19 }).addTo(map);
    group.current = L.layerGroup().addTo(map);
    mapRef.current = map;
    return () => {
      map.remove();
      mapRef.current = null;
      group.current = null;
    };
  }, []);

  useEffect(() => {
    const g = group.current;
    const map = mapRef.current;
    if (!g || !map) return;
    g.clearLayers();
    if (!location) return;
    if (match) {
      L.geoJSON(match as unknown as GeoJsonObject, { className: "map-municipality", interactive: false } as L.GeoJSONOptions).addTo(g);
    }
    L.marker([location.lat, location.lon], { interactive: false, keyboard: false, icon: pinIcon() }).addTo(g);
    map.setView([location.lat, location.lon], 12);
    map.invalidateSize();
  }, [location, match]);

  const home = regions ? homeRegionCode(regions) : null;
  const place = match?.properties.gemeente ?? anchor?.place?.plaats ?? "";
  return (
    <div class="mini-map" role="img" aria-label={t("settings.summary.preview")}>
      <div class="mini-map-canvas" ref={host} />
      <span class="mini-map-caption">
        {location
          ? place
            ? t(home ? "settings.map.caption" : "settings.map.captionNoHome", { place, code: home ?? "" })
            : null
          : t("settings.map.nothing")}
      </span>
    </div>
  );
}
