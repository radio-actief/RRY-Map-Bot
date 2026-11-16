/** A small still map (no controls, no gestures): the pin and the municipality under it. */
import { useEffect, useRef, useState } from "preact/hooks";
import { PIN } from "../../app/MapView";
import { createMap, type MapEngine, type Removable } from "../../app/map-engine";
import { municipalityAt } from "../../core/geo";
import { homeRegionCode } from "../../core/regions";
import { t } from "../../i18n/t";
import { municipalities as municipalityList, store } from "../../state/store";

export function MiniMap() {
  const host = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapEngine | null>(null);
  const drawn = useRef<Removable[]>([]);
  const [ready, setReady] = useState(0);
  const { location, regions, anchor } = store.plan.value;
  const municipalities = municipalityList.value;
  const match = location && municipalities.length ? municipalityAt(location, municipalities) : null;

  useEffect(() => {
    let alive = true;
    createMap(host.current!, { center: { lat: 50.6, lon: 4.6 }, zoom: 8, interactive: false, controls: false })
      .then((map) => {
        if (!alive) return map.remove();
        mapRef.current = map;
        setReady((n) => n + 1);
      })
      .catch((e) => console.error("The map could not start", e));
    return () => {
      alive = false;
      mapRef.current?.remove();
      mapRef.current = null;
      drawn.current = [];
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    for (const d of drawn.current.splice(0)) d.remove();
    if (!location) return;
    if (match) drawn.current.push(map.addGeoJSON(match, { style: () => ({ className: "map-municipality" }), interactive: false }));
    drawn.current.push(map.addMarker(location, { ...PIN, interactive: false }));
    map.setView(location, 12);
    map.resize();
  }, [location, match, ready]);

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
